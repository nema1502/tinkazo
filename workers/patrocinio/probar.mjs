// Prueba el portero de punta a punta contra un `wrangler dev` y TESTNET (nunca otra red):
//
//   npx wrangler@4 dev --port 8793 --var POR_IP_POR_HORA:300     (desde esta carpeta, con .dev.vars)
//   node probar.mjs http://127.0.0.1:8793
//
// Antes, una sola vez: `node preparar-testnet.mjs` (crea la cuenta patrocinadora con su llave acotada).
//
// Hace un sello y un sorteo reales, patrocinados, con una cuenta de 0 XLM que abre la "billetera de
// Pollar de prueba"; prueba la lista blanca, la firma, las cuentas ajenas, el cupo, el tope general, el
// interruptor, el rechazo sin entrar, el mismo hash dos veces y la llave acotada (que con la llave del
// Worker no se puede sacar el dinero). Cada prueba imprime OK o FALLA y al final el total.
//
//   --ip          prueba aparte el tope por dirección (lo agota: reiniciar `wrangler dev` antes de volver a correr todo)
//   --llave-mala   contra un `wrangler dev` arrancado con `--var CLAVE_PATROCINADOR:no-es-una-llave`: /cupo tiene que decir
//                  prendido:false con motivo "config", no ofrecer un patrocinio que va a dar 503
//
// Gasta unos pocos centavos de XLM de prueba. El sello y el sorteo quedan en el contrato oficial de testnet
// con la marca "prueba-portero" en su meta.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Address, Asset, Contract, Keypair, Operation, TransactionBuilder, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { armar } from "./src/armar.ts";
import { FRASE, HORIZON, RPC_URL, conGrifo, crearCuentaPatrocinada, dormir, enviarYEsperar, servidor } from "./testnet.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] ?? "http://127.0.0.1:8793").replace(/\/$/, "");
const soloIp = process.argv.includes("--ip");
const soloLlaveMala = process.argv.includes("--llave-mala");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error("probar.mjs solo corre contra un wrangler dev local.");
  process.exit(2);
}
const llaves = JSON.parse(fs.readFileSync(path.join(aqui, ".prueba.json"), "utf8"));
const deployments = JSON.parse(fs.readFileSync(path.join(aqui, "../../src/stellar/deployments.json"), "utf8"));
const CONTRATO = deployments.testnet.contractId;
const OTRO_CONTRATO = deployments.testnet.anteriores[0].contractId;
const P = llaves.patrocinadora;
const F = Keypair.fromSecret(llaves.fria);
const W = Keypair.fromSecret(llaves.worker);
const S = Keypair.fromSecret(llaves.pollarDePrueba);
const ADMIN = llaves.adminToken;
const QUICKNET = { chain: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971", genesis: 1692803367, period: 3 };

let fallas = 0;
let total = 0;
function ver(nombre, ok, detalle = "") {
  total++;
  if (!ok) fallas++;
  console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${detalle ? ` (${detalle})` : ""}`);
}

// ---------- ayudas ----------

async function pedir(metodo, ruta, { cuerpo, admin, tipo = "application/json" } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { Origin: "https://tinkazo.app", ...(cuerpo !== undefined ? { "Content-Type": tipo } : {}), ...(admin ? { Authorization: `Bearer ${admin}` } : {}) },
    ...(cuerpo !== undefined ? { body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) } : {}),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { estado: r.status, json };
}
const pagar = (x) => pedir("POST", "/v1/patrocinio", { cuerpo: { xdr: x } });
const cupo = async (g) => (await pedir("GET", `/v1/patrocinio/cupo?cuenta=${g}`)).json;
const ajustar = (clave, valor) => pedir("PUT", "/v1/patrocinio/ajustes", { admin: ADMIN, cuerpo: { clave, valor } });
const modo = (accion) => pedir("POST", `/v1/patrocinio/${accion}`, { admin: ADMIN });

async function horizon(ruta) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(HORIZON + ruta);
    if (r.ok) return r.json();
    await dormir(1500);
  }
  return null;
}
async function saldoXlm(g) {
  const c = await horizon(`/accounts/${g}`);
  return c ? c.balances.find((b) => b.asset_type === "native").balance : null;
}

/** La cuenta en el RPC, con unos reintentos: una cuenta recién creada tarda un instante en verse. */
async function cuentaEnRpc(g) {
  for (let i = 0; i < 8; i++) {
    try {
      return await servidor.getAccount(g);
    } catch (e) {
      if (i === 7) throw e;
      await dormir(1500);
    }
  }
}

/** Una transacción de seal o draw armada como la del navegador: simulada contra testnet, con sus recursos, firmada, sin patrocinio. */
async function transaccion(metodo, args, kp, { saltoDeSecuencia = 0, firmantes = [kp] } = {}) {
  const cuenta = await cuentaEnRpc(kp.publicKey());
  const sec = saltoDeSecuencia ? new Account(kp.publicKey(), (BigInt(cuenta.sequenceNumber()) + BigInt(saltoDeSecuencia)).toString()) : cuenta;
  const armada = new TransactionBuilder(sec, { fee: "100", networkPassphrase: FRASE }).addOperation(new Contract(CONTRATO).call(metodo, ...args)).setTimeout(240).build();
  const lista = await servidor.prepareTransaction(armada);
  lista.sign(...firmantes);
  return { xdr: lista.toXDR(), hash: Buffer.from(lista.hash()).toString("hex") };
}

/** La misma transacción preparada pero declarando `veces` veces los recursos que simuló la red, firmada de nuevo. */
async function transaccionInflada(metodo, args, kp, veces) {
  const cuenta = await cuentaEnRpc(kp.publicKey());
  const armada = new TransactionBuilder(cuenta, { fee: "100", networkPassphrase: FRASE }).addOperation(new Contract(CONTRATO).call(metodo, ...args)).setTimeout(240).build();
  const lista = await servidor.prepareTransaction(armada);
  const env = xdr.TransactionEnvelope.fromXDR(lista.toXDR(), "base64");
  const t = env.value.tx;
  const extra = t.ext.value.resourceFee * BigInt(veces - 1);
  t.ext.value.resourceFee += extra;
  t.fee += Number(extra);
  const nueva = TransactionBuilder.fromXDR(env.toXDR("base64"), FRASE);
  nueva.sign(kp);
  return { xdr: nueva.toXDR(), hash: Buffer.from(nueva.hash()).toString("hex") };
}
const argsSeal = (kp, ronda, marca = 1) => [
  new Address(kp.publicKey()).toScVal(),
  nativeToScVal(new Uint8Array(32).fill(marca), { type: "bytes" }),
  nativeToScVal(5, { type: "u32" }),
  nativeToScVal(1, { type: "u32" }),
  nativeToScVal(BigInt(ronda), { type: "u64" }),
  nativeToScVal("prueba-portero", { type: "string" }),
];
const rondaEn = (ts) => Math.floor((ts - QUICKNET.genesis) / QUICKNET.period) + 1;
const tiempoDeRonda = (r) => QUICKNET.genesis + (r - 1) * QUICKNET.period;

async function crudo(tx) {
  const r = await (await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: { transaction: tx.toXDR() } }) })).json();
  let codigo = "";
  if (r.result?.errorResultXdr) {
    const res = xdr.TransactionResult.fromXDR(r.result.errorResultXdr, "base64").result;
    codigo = res.type === "txFailed" ? `${res.type}/${res.value[0]?.type}` : res.type;
  }
  return { status: r.result?.status, codigo };
}

async function nuevaCuentaCero() {
  const k = Keypair.random();
  await crearCuentaPatrocinada(S, k);
  return k;
}

// ---------- 0. el servicio ----------

console.log(`# portero en ${base} contra testnet; patrocinadora ${P}\n`);
let r = await pedir("GET", "/");
ver("el servicio contesta", r.estado === 200 && r.json?.servicio === "tinkazo-patrocinio");
r = await pedir("GET", `/v1/patrocinio/cupo?cuenta=${W.publicKey()}`);
ver("el cupo de una cuenta nueva: 20 sellos, 40 sorteos, prendido y rige el portero", r.estado === 200 && r.json?.sellos?.quedan === 20 && r.json?.sorteos?.quedan === 40 && (soloLlaveMala || r.json?.prendido === true) && r.json?.rige === "portero", JSON.stringify(r.json));
r = await pedir("GET", "/v1/patrocinio/cupo?cuenta=hola");
ver("el cupo de algo que no es una cuenta da 400", r.estado === 400);
r = await pedir("GET", "/otra-cosa");
ver("una ruta que no existe da 404", r.estado === 404);

if (soloLlaveMala) {
  r = await pedir("GET", `/v1/patrocinio/cupo?cuenta=${W.publicKey()}`);
  ver("llave mal pegada: /cupo dice prendido:false con motivo config (no ofrece un patrocinio que va a dar 503)", r.estado === 200 && r.json?.prendido === false && r.json?.motivo === "config", JSON.stringify(r.json));
  r = await pagar(armar({ firmante: Keypair.random(), contrato: CONTRATO }).xdr);
  ver("y un pedido real da 503 apagado, sin llave", r.estado === 503 && r.json?.motivo === "apagado" && r.json?.detalle === "sin-llave", JSON.stringify(r.json));
  r = await pedir("GET", "/v1/patrocinio/estado", { admin: ADMIN });
  ver("el estado con clave sigue contestando y dice que no hay llave", r.estado === 200 && r.json?.llave === null && typeof r.json?.alerta === "boolean", JSON.stringify(r.json));
  await modo("pollar");
  r = await pedir("GET", `/v1/patrocinio/cupo?cuenta=${W.publicKey()}`);
  ver("devuelto a Pollar, aun sin llave, rige pollar y prendido:false con motivo pollar", r.json?.prendido === false && r.json?.motivo === "pollar" && r.json?.rige === "pollar", JSON.stringify(r.json));
  await modo("encender");
  console.log(`\n${total - fallas} de ${total} pruebas en verde${fallas ? `; ${fallas} FALLAN` : ""}`);
  process.exit(fallas ? 1 : 0);
}

if (soloIp) {
  let limite = 0;
  for (let i = 0; i < 400 && !limite; i++) {
    const x = await pedir("POST", "/v1/patrocinio", { cuerpo: { xdr: "AAAA" } });
    if (x.estado === 429 && x.json?.motivo === "cupo-ip") limite = i + 1;
  }
  ver("el tope por dirección corta con 429 cupo-ip", limite > 0, `tras ${limite} pedidos`);
  console.log(`\n${total - fallas} de ${total} pruebas en verde`);
  process.exit(fallas ? 1 : 0);
}

// ---------- 1. la lista blanca: todo 400, sin gastar cupo ----------

const intruso = Keypair.random(); // no existe en la cadena: la lista blanca rechaza antes de mirar
const mal = [
  ["operación ajena (un pago)", { operacion: "pago" }],
  ["otra operación (bumpSequence)", { operacion: "bump" }],
  ["extend", { metodo: "extend" }],
  ["otro método", { metodo: "get_raffle" }],
  ["otro contrato", { contrato: OTRO_CONTRATO }],
  ["seal con organizer distinto del origen", { organizador: Keypair.random().publicKey() }],
  ["dos operaciones", { dosOperaciones: true }],
  ["operación con otro origen", { origenDeOperacion: Keypair.random().publicKey() }],
  ["ventana larga (1 hora)", { ventanaS: 3600 }],
  ["sin ventana", { ventanaS: 0 }],
  ["resourceFee sobre el tope", { resourceFee: 20_000_000 }],
  ["inclusión declarada de casi 1 XLM (el bump nunca ofrece eso)", { fee: 9_900_000 }],
  ["con memo", { memo: "hola" }],
  ["entradas para restaurar", { archivadas: [0] }],
  ["sin datos de recursos", { sinDatos: true }],
  ["sin firma", { firmaDe: "ninguna" }],
  ["firma de otra cuenta", { firmaDe: Keypair.random() }],
];
for (const [nombre, v] of mal) {
  const t = armar({ firmante: intruso, contrato: CONTRATO, ...v });
  r = await pagar(t.xdr);
  ver(`lista blanca: ${nombre} da 400`, r.estado === 400 && r.json?.motivo === "no-permitida", `${r.estado} ${r.json?.razon ?? r.json?.motivo}/${r.json?.detalle ?? ""}`);
}
r = await pagar("esto no es un XDR");
ver("lista blanca: XDR roto da 400", r.estado === 400);
r = await pedir("POST", "/v1/patrocinio", { cuerpo: { xdr: "A".repeat(9000) } });
ver("lista blanca: cuerpo de más de 8 KB da 400", r.estado === 400 && r.json?.razon === "tamano");
r = await pedir("POST", "/v1/patrocinio", { cuerpo: "{}" });
ver("lista blanca: cuerpo sin xdr da 400", r.estado === 400);
{
  // Un fee-bump ya armado (de la misma firma) y la firma de otra red.
  const interna = TransactionBuilder.fromXDR(armar({ firmante: intruso, contrato: CONTRATO }).xdr, FRASE);
  const envuelta = TransactionBuilder.buildFeeBumpTransaction(intruso, "1000", interna, FRASE);
  envuelta.sign(intruso);
  r = await pagar(envuelta.toXDR());
  ver("lista blanca: un fee-bump ya armado da 400", r.estado === 400 && r.json?.detalle === "fee-bump");
  r = await pagar(armar({ firmante: intruso, contrato: CONTRATO, passphrase: "Public Global Stellar Network ; September 2015" }).xdr);
  ver("lista blanca: firmada para otra red da 400", r.estado === 400 && r.json?.razon === "firma");
}
ver("el cupo del intruso quedó intacto", (await cupo(intruso.publicKey()))?.sellos?.usados === 0);
{
  const x = await fetch(base + "/v1/patrocinio", { method: "POST", headers: { Origin: "https://otro.example", "Content-Type": "application/json" }, body: JSON.stringify({ xdr: "AAAA" }) });
  ver("un pedido desde otro sitio da 403 origen", x.status === 403);
}

// ---------- 2. cuentas que no abrió nuestra app: 403 ----------

const propia = Keypair.random();
await conGrifo(propia);
{
  const ronda = rondaEn(Math.floor(Date.now() / 1000) + 60);
  const t = await transaccion("seal", argsSeal(propia, ronda, 2), propia);
  r = await pagar(t.xdr);
  ver("cuenta con llaves propias (fondeada por el grifo, sin patrocinador): 403 cuenta-ajena", r.estado === 403 && r.json?.motivo === "cuenta-ajena", `${r.estado} ${JSON.stringify(r.json)}`);
  ver("y no gastó cupo", (await cupo(propia.publicKey()))?.sellos?.usados === 0);
  const inexistente = Keypair.random();
  r = await pagar(armar({ firmante: inexistente, contrato: CONTRATO }).xdr);
  ver("cuenta que no existe en la red: 403 cuenta-ajena", r.estado === 403 && r.json?.motivo === "cuenta-ajena", `${r.estado} ${JSON.stringify(r.json)}`);
}

// ---------- 3. un sello y un sorteo reales, patrocinados, con una cuenta de 0 XLM ----------

const Q = await nuevaCuentaCero();
const saldoQ0 = await saldoXlm(Q.publicKey());
ver("la cuenta de prueba nace con 0 XLM, abierta por la billetera de Pollar de prueba", saldoQ0 !== null && Number(saldoQ0) === 0, `saldo ${saldoQ0}`);
const saldoP0 = await saldoXlm(P);

const ahoraS = Math.floor(Date.now() / 1000);
const ronda = rondaEn(ahoraS + 45);
const sello = await transaccion("seal", argsSeal(Q, ronda, 3), Q);
r = await pagar(sello.xdr);
ver("el sello real da 200 con el hash de la transacción interna", r.estado === 200 && r.json?.hash === sello.hash && (r.json?.status === "PENDING" || r.json?.status === "DUPLICATE"), `${r.estado} ${JSON.stringify(r.json)}`);
ver("quedan 19 sellos", r.json?.quedan === 19);
const respuestaSello = r.json;
r = await pagar(sello.xdr);
ver("el mismo hash otra vez devuelve el mismo resultado", r.estado === 200 && r.json?.hash === sello.hash && r.json?.quedan === 19, JSON.stringify(r.json));
let c = await cupo(Q.publicKey());
ver("y cuenta uno solo", c?.sellos?.usados === 1 && c?.sellos?.quedan === 19, JSON.stringify(c?.sellos));

const enRed = await servidor.pollTransaction(sello.hash, { attempts: 40, sleepStrategy: () => 1500 });
ver("el sello entró a la red (se busca por el hash de la transacción interna)", enRed.status === "SUCCESS", enRed.status);
const idSorteo = enRed.returnValue ? scValToNative(enRed.returnValue) : null;
ver("devolvió el número del sorteo", idSorteo !== null, String(idSorteo));
let h = await horizon(`/transactions/${sello.hash}`);
ver("lo pagó la cuenta patrocinadora, dentro de un fee-bump", h?.fee_account === P && h?.fee_bump_transaction?.hash && h?.inner_transaction?.hash === sello.hash && h?.successful === true, `fee_account ${h?.fee_account}`);
ver("la cuenta de quien sella sigue en 0 XLM", Number(await saldoXlm(Q.publicKey())) === 0);
const costoSello = Number(h?.fee_charged ?? 0);
const saldoP1 = await saldoXlm(P);
ver("el saldo de la patrocinadora bajó exactamente lo que cobró la red", Math.round((Number(saldoP0) - Number(saldoP1)) * 1e7) === costoSello, `bajó ${Math.round((Number(saldoP0) - Number(saldoP1)) * 1e7)} stroops, cobró ${costoSello}`);

// El sorteo: cuando nace la ronda.
const espera = tiempoDeRonda(ronda) + 4 - Math.floor(Date.now() / 1000);
if (espera > 0) {
  console.log(`   (esperando ${espera} s a que nazca la ronda ${ronda})`);
  await dormir(espera * 1000);
}
let firma = null;
for (let i = 0; i < 20 && !firma; i++) {
  for (const url of [`https://api.drand.sh/${QUICKNET.chain}/public/${ronda}`, `https://drand.cloudflare.com/${QUICKNET.chain}/public/${ronda}`]) {
    try {
      const j = await (await fetch(url)).json();
      if (typeof j.signature === "string" && j.signature.length === 96) {
        firma = j.signature;
        break;
      }
    } catch {}
  }
  if (!firma) await dormir(2000);
}
ver("se consiguió la firma de la ronda", !!firma);
let drawHash = null;
if (firma && idSorteo !== null) {
  const sig96 = bls12_381.G1.Point.fromHex(firma).toBytes(false);
  const sorteo = await transaccion("draw", [nativeToScVal(BigInt(idSorteo), { type: "u64" }), nativeToScVal(sig96, { type: "bytes" })], Q);
  r = await pagar(sorteo.xdr);
  ver("el sorteo real da 200 con su hash", r.estado === 200 && r.json?.hash === sorteo.hash, `${r.estado} ${JSON.stringify(r.json)}`);
  ver("quedan 39 sorteos", r.json?.quedanSorteos === 39, JSON.stringify(r.json));
  drawHash = sorteo.hash;
  const enRed2 = await servidor.pollTransaction(sorteo.hash, { attempts: 40, sleepStrategy: () => 1500 });
  ver("el sorteo entró a la red", enRed2.status === "SUCCESS", enRed2.status);
  h = await horizon(`/transactions/${sorteo.hash}`);
  ver("lo pagó también la cuenta patrocinadora", h?.fee_account === P && h?.inner_transaction?.hash === sorteo.hash, `fee_account ${h?.fee_account}`);
  ver("la cuenta de quien sortea sigue en 0 XLM", Number(await saldoXlm(Q.publicKey())) === 0);
  r = await pagar(sorteo.xdr);
  ver("repetir el sorteo ya hecho da el mismo resultado y no cuenta de nuevo", r.estado === 200 && r.json?.hash === sorteo.hash, JSON.stringify(r.json));
  ver("sortear no gastó sellos", (await cupo(Q.publicKey()))?.sellos?.usados === 1 && (await cupo(Q.publicKey()))?.sorteos?.usados === 1);
}

// ---------- 3b. recursos inflados contra la simulación ----------

{
  const R = await nuevaCuentaCero();
  const ronda3 = rondaEn(Math.floor(Date.now() / 1000) + 60);
  const inflada = await transaccionInflada("seal", argsSeal(R, ronda3, 11), R, 4);
  r = await pagar(inflada.xdr);
  ver("recursos declarados 4 veces la simulación: 400 fee-alta, sin contar ni mandar", r.estado === 400 && r.json?.motivo === "fee-alta", `${r.estado} ${JSON.stringify(r.json)}`);
  ver("y el cupo quedó intacto", (await cupo(R.publicKey()))?.sellos?.usados === 0);
}

// ---------- 3c. firmantes y umbrales leídos de la cadena ----------

let hashDeLaDosDeDos = null;
{
  // Una cuenta de 0 XLM abierta por la billetera de prueba, con la maestra en cero y dos firmantes de peso 1 con umbral 2.
  const Z = Keypair.random();
  await crearCuentaPatrocinada(S, Z);
  const A = Keypair.random();
  const B = Keypair.random();
  const cuentaS = await servidor.getAccount(S.publicKey());
  const conf = new TransactionBuilder(cuentaS, { fee: "10000", networkPassphrase: FRASE })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: Z.publicKey() }))
    .addOperation(Operation.setOptions({ source: Z.publicKey(), signer: { ed25519PublicKey: A.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ source: Z.publicKey(), signer: { ed25519PublicKey: B.publicKey(), weight: 1 } }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: Z.publicKey() }))
    .addOperation(Operation.setOptions({ source: Z.publicKey(), masterWeight: 0, lowThreshold: 2, medThreshold: 2, highThreshold: 2 }))
    .setTimeout(120)
    .build();
  conf.sign(S, Z);
  await enviarYEsperar(conf);
  const cz = await horizon(`/accounts/${Z.publicKey()}`);
  ver("la cuenta de dos firmas de dos quedó armada en la cadena (maestra 0, umbral 2)", cz?.thresholds?.med_threshold === 2 && cz?.signers?.length === 3 && cz?.signers?.find((x) => x.key === Z.publicKey())?.weight === 0, JSON.stringify(cz?.thresholds));

  const r3 = rondaEn(Math.floor(Date.now() / 1000) + 60);
  const soloA = await transaccion("seal", argsSeal(Z, r3, 12), Z, { firmantes: [A] });
  r = await pagar(soloA.xdr);
  ver("firmada solo por uno de los dos: 400 firma peso-insuficiente, sin contar", r.estado === 400 && r.json?.razon === "firma" && r.json?.detalle === "peso-insuficiente", `${r.estado} ${JSON.stringify(r.json)}`);
  const soloMaestra = await transaccion("seal", argsSeal(Z, r3, 12), Z, { firmantes: [Z] });
  r = await pagar(soloMaestra.xdr);
  ver("firmada solo por la maestra, que pesa 0: 400 firma", r.estado === 400 && r.json?.razon === "firma", `${r.estado} ${JSON.stringify(r.json)}`);
  ver("y no se contó nada", (await cupo(Z.publicKey()))?.sellos?.usados === 0);
  const ambas = await transaccion("seal", argsSeal(Z, r3, 12), Z, { firmantes: [A, B] });
  r = await pagar(ambas.xdr);
  ver("firmada por los dos: pasa y la paga la patrocinadora", r.estado === 200 && r.json?.hash === ambas.hash, `${r.estado} ${JSON.stringify(r.json)}`);
  const cierre = await servidor.pollTransaction(ambas.hash, { attempts: 40, sleepStrategy: () => 1500 });
  const hz = await horizon(`/transactions/${ambas.hash}`);
  ver("y entró a la red como un fee-bump de la patrocinadora", cierre.status === "SUCCESS" && hz?.fee_account === P && hz?.successful === true, `${cierre.status} ${hz?.fee_account}`);
  hashDeLaDosDeDos = ambas.hash;
}

// ---------- 4. rechazada sin entrar: el cupo vuelve ----------

{
  const R = await nuevaCuentaCero();
  const antes = await cupo(R.publicKey());
  const t = await transaccion("seal", argsSeal(R, rondaEn(Math.floor(Date.now() / 1000) + 60), 4), R, { saltoDeSecuencia: 10 });
  r = await pagar(t.xdr);
  ver("una transacción con la secuencia mal la rechaza la red antes de entrar", r.estado === 400 && r.json?.motivo === "rechazada", `${r.estado} ${JSON.stringify(r.json)}`);
  const despues = await cupo(R.publicKey());
  ver("y el cupo vuelve: no se contó", despues?.sellos?.usados === antes?.sellos?.usados && despues?.sellos?.usados === 0, JSON.stringify(despues?.sellos));
}

// ---------- 5. el cupo por cuenta y 6. el tope general (con ajustes en caliente) ----------

{
  const ronda5 = rondaEn(Math.floor(Date.now() / 1000) + 60);
  r = await ajustar("max_sellos_mes", 1);
  ver("ajustar el cupo con la clave de administración", r.estado === 200);
  const otro = await transaccion("seal", argsSeal(Q, ronda5, 5), Q);
  r = await pagar(otro.xdr);
  const hoy = new Date();
  const sigMes = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 1);
  ver("el sello que pasa del cupo da 429 con liberaEn y max", r.estado === 429 && r.json?.motivo === "cupo-cuenta" && r.json?.max === 1 && r.json?.liberaEn === sigMes, `${r.estado} ${JSON.stringify(r.json)}`);
  r = await ajustar("max_sellos_mes", 20);
  ver("y al volver a 20 vuelve a pasar", (await pagar(otro.xdr)).estado === 200);
  r = await ajustar("max_sellos_mes", -5);
  ver("un ajuste inválido da 400", r.estado === 400);
  r = await pedir("PUT", "/v1/patrocinio/ajustes", { cuerpo: { clave: "max_sellos_mes", valor: 1 } });
  ver("ajustar sin clave da 401", r.estado === 401);
  r = await pedir("PUT", "/v1/patrocinio/ajustes", { admin: "x".repeat(40), cuerpo: { clave: "max_sellos_mes", valor: 1 } });
  ver("ajustar con otra clave da 401", r.estado === 401);

  const T = await nuevaCuentaCero();
  await ajustar("tope_general_stroops", 1);
  const t = await transaccion("seal", argsSeal(T, rondaEn(Math.floor(Date.now() / 1000) + 60), 6), T);
  r = await pagar(t.xdr);
  ver("con el tope general en el piso, el sello da 503 fondo", r.estado === 503 && r.json?.motivo === "fondo", `${r.estado} ${JSON.stringify(r.json)}`);
  ver("y no se contó", (await cupo(T.publicKey()))?.sellos?.usados === 0);
  await ajustar("tope_general_stroops", 150_000_000);
}

// ---------- 7. el interruptor ----------

{
  const T = await nuevaCuentaCero();
  const t = await transaccion("seal", argsSeal(T, rondaEn(Math.floor(Date.now() / 1000) + 60), 7), T);
  await modo("apagar");
  r = await pagar(t.xdr);
  ver("apagado: 503 apagado", r.estado === 503 && r.json?.motivo === "apagado", JSON.stringify(r.json));
  c = await cupo(T.publicKey());
  ver("apagado: el cupo dice que no está prendido", c?.prendido === false);
  await modo("pollar");
  r = await pagar(t.xdr);
  c = await cupo(T.publicKey());
  ver("vuelto a Pollar: el portero no paga y el cupo dice rige pollar, prendido:false, motivo pollar", r.estado === 503 && c?.rige === "pollar" && c?.prendido === false && c?.motivo === "pollar", JSON.stringify(c));
  await modo("encender");
  c = await cupo(T.publicKey());
  ver("encendido de nuevo: prendido y rige el portero", c?.prendido === true && c?.rige === "portero");
  ver("y nada se contó mientras estuvo apagado", c?.sellos?.usados === 0);
}

// ---------- 8. administración y lo que se guarda ----------

r = await pedir("GET", "/v1/patrocinio/estado");
ver("el estado sin clave da 401", r.estado === 401);
r = await pedir("GET", "/v1/patrocinio/exportar");
ver("exportar sin clave da 401", r.estado === 401);
r = await pedir("GET", "/v1/patrocinio/estado", { admin: ADMIN });
ver("el estado con clave dice el saldo y el gasto", r.estado === 200 && r.json?.patrocinadora === P && r.json?.llave === W.publicKey() && Number(r.json?.balanceStroops) > 0 && r.json?.gasto24h > 0, JSON.stringify(r.json));
ver("el estado trae el saldo leído de la red y la alerta coherente con el umbral", typeof r.json?.alerta === "boolean" && r.json?.alerta === (Number(r.json?.balanceStroops) < r.json?.saldoAlertaStroops), `saldo ${r.json?.balanceStroops} umbral ${r.json?.saldoAlertaStroops} alerta ${r.json?.alerta}`);
{
  // La alarma del objeto cierra lo que quedó en el aire (se pidió apenas se reservó) y lo guardado para sorteos baja de 82.000.
  let est = r.json;
  for (let i = 0; i < 12 && est?.enElAire > 0; i++) {
    await dormir(5000);
    est = (await pedir("GET", "/v1/patrocinio/estado", { admin: ADMIN })).json;
  }
  ver("la alarma resolvió todo lo que quedó en el aire (nada colgado)", est?.enElAire === 0, `enElAire ${est?.enElAire}`);
  ver("lo guardado para sorteos es fijo: a lo sumo 82.000 stroops por sello sin sortear", est?.reservadoParaSorteos <= 82_000 * Math.max(1, est?.sellos24h ?? 1), `reservado ${est?.reservadoParaSorteos}, sellos ${est?.sellos24h}`);
  const f = (await pedir("GET", "/v1/patrocinio/exportar", { admin: ADMIN })).json?.tablas?.uso?.find((x) => x.hash === sello.hash);
  ver("el sello cerrado anotó lo que cobró la red y es el estimado nuevo, no el del cliente (menos de 200.000)", f?.estado === "ok" && f?.real > 0 && f?.estimado < 200_000, JSON.stringify(f));
}
r = await pedir("GET", "/v1/patrocinio/exportar", { admin: ADMIN });
const tablas = r.json?.tablas ?? {};
ver("el exporte trae el sello y el sorteo pagados", r.estado === 200 && tablas.uso?.some((f) => f.hash === sello.hash && f.metodo === "seal") && (!drawHash || tablas.uso?.some((f) => f.hash === drawHash && f.metodo === "draw")));
ver("el exporte no guarda nombres ni direcciones IP ni listas", !/"ip"|nombre|email|correo|127\.0\.0\.1/i.test(JSON.stringify(tablas)));
ver("una vez que la red lo cerró, se anota lo que cobró", (() => {
  const f = tablas.uso?.find((x) => x.hash === sello.hash);
  return f && (f.estado === "ok" || f.estado === "enviado");
})());

// ---------- 9. la llave acotada ----------

{
  const cuentaP = await servidor.getAccount(P);
  const fondoAntes = await saldoXlm(P);
  const intento = (ops, firmantes) => {
    const b = new TransactionBuilder(new Account(P, cuentaP.sequenceNumber()), { fee: "1000", networkPassphrase: FRASE });
    for (const o of ops) b.addOperation(o);
    const tx = b.setTimeout(120).build();
    tx.sign(...firmantes);
    return tx;
  };
  let x = await crudo(intento([Operation.payment({ destination: F.publicKey(), asset: Asset.native(), amount: "5" })], [W]));
  ver("3.8 la llave del Worker intenta un pago desde la cuenta patrocinadora: la red la rechaza (op_bad_auth)", x.status === "ERROR" && x.codigo === "txFailed/opBadAuth", `${x.status} ${x.codigo}`);
  x = await crudo(intento([Operation.accountMerge({ destination: W.publicKey() })], [W]));
  ver("3.8 intenta vaciarla con un accountMerge: la red la rechaza (op_bad_auth)", x.status === "ERROR" && x.codigo === "txFailed/opBadAuth", `${x.status} ${x.codigo}`);
  x = await crudo(intento([Operation.setOptions({ signer: { ed25519PublicKey: W.publicKey(), weight: 255 } })], [W]));
  ver("3.8 intenta darse más peso (setOptions): la red la rechaza (op_bad_auth)", x.status === "ERROR" && x.codigo === "txFailed/opBadAuth", `${x.status} ${x.codigo}`);
  x = await crudo(intento([Operation.setOptions({ masterWeight: 1, lowThreshold: 0, medThreshold: 0, highThreshold: 0 })], [W]));
  ver("3.8 intenta bajar los umbrales: la red la rechaza (op_bad_auth)", x.status === "ERROR" && x.codigo === "txFailed/opBadAuth", `${x.status} ${x.codigo}`);
  x = await crudo(intento([Operation.payment({ destination: F.publicKey(), asset: Asset.native(), amount: "5" })], [Keypair.fromSecret(llaves.worker), Keypair.random()]));
  ver("3.8 ni con una segunda firma cualquiera", x.status === "ERROR" && x.codigo === "txFailed/opBadAuth", `${x.status} ${x.codigo}`);
  // Y la fría sí puede: el dinero se puede mover, la cuenta no quedó trabada.
  const pago = intento([Operation.payment({ destination: F.publicKey(), asset: Asset.native(), amount: "5" })], [F]);
  let ok = false;
  try {
    await enviarYEsperar(pago);
    ok = true;
  } catch (e) {
    console.log("   ", String(e));
  }
  const fondoDespues = await saldoXlm(P);
  ver("la llave fría, de peso 2, sí mueve el dinero (5 XLM a la fría)", ok && Math.abs(Number(fondoAntes) - Number(fondoDespues) - 5) < 0.01, `${fondoAntes} -> ${fondoDespues}`);
}

console.log(`\n${total - fallas} de ${total} pruebas en verde${fallas ? `; ${fallas} FALLAN` : ""}`);
console.log(`   sello  ${sello.hash}\n   sorteo ${drawHash ?? "(no se hizo)"}\n   cuenta de 0 XLM ${Q.publicKey()}\n   sello de la cuenta de dos firmas de dos ${hashDeLaDosDeDos ?? "(no se hizo)"}`);
process.exit(fallas ? 1 : 0);
