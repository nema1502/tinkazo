// Ensayo del portero YA DESPLEGADO, contra TESTNET: mide cuánto tarda en frío y en caliente, y si aparece el error 1102
// de Cloudflare (CPU del plan gratis). Es el dato que decide si el plan gratis alcanza o hace falta el de US$5.
//
//   node ensayo-remoto.mjs https://p.tinkazo.app [--quieto <minutos>] [--sellos <n>]
//
// Necesita `.prueba.json` (lo deja `preparar-testnet.mjs`; no se versiona) y que el portero acepte la billetera de
// fondos de prueba (`PATROCINADORES_APP`). Cada sello es real: gasta unos centavos de XLM de prueba y queda en el contrato
// oficial de testnet con la marca "prueba-portero". Nunca habla con mainnet.
//
// Qué hace:
//   1. /cupo antes (cuenta nueva de 0 XLM, abierta por la billetera de Pollar de prueba).
//   2. Si se pasa --quieto, espera esos minutos sin tocar el portero: así el primer pedido es "en frío" de verdad.
//   3. Manda un sello real (el primero, EN FRÍO) y tantos más como --sellos (por defecto 3, EN CALIENTE), midiendo cada uno.
//      Un error de red sin cuerpo ni cabeceras CORS es el signo del 1102: se cuenta aparte.
//   4. /cupo después. Imprime los hashes y comprueba en la cadena que la comisión la pagó la cuenta patrocinadora.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Address, Contract, Keypair, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { FRASE, HORIZON, crearCuentaPatrocinada, dormir, servidor } from "./testnet.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const argumentos = process.argv.slice(2);
const base = (argumentos.find((a) => a.startsWith("http")) ?? "").replace(/\/$/, "");
const opcion = (n, def) => (argumentos.includes(n) ? Number(argumentos[argumentos.indexOf(n) + 1]) : def);
if (!/^https:\/\/[a-z0-9.-]+$/.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error("uso: node ensayo-remoto.mjs https://p.tinkazo.app [--quieto <minutos>] [--sellos <n>]");
  process.exit(2);
}
const llaves = JSON.parse(fs.readFileSync(path.join(aqui, ".prueba.json"), "utf8"));
const deployments = JSON.parse(fs.readFileSync(path.join(aqui, "../../src/stellar/deployments.json"), "utf8"));
const CONTRATO = deployments.testnet.contractId;
const S = Keypair.fromSecret(llaves.pollarDePrueba);
const QUICKNET = { genesis: 1692803367, period: 3 };
const rondaEn = (ts) => Math.floor((ts - QUICKNET.genesis) / QUICKNET.period) + 1;

const argsSeal = (kp, ronda, marca) => [
  new Address(kp.publicKey()).toScVal(),
  nativeToScVal(new Uint8Array(32).fill(marca), { type: "bytes" }),
  nativeToScVal(5, { type: "u32" }),
  nativeToScVal(1, { type: "u32" }),
  nativeToScVal(BigInt(ronda), { type: "u64" }),
  nativeToScVal("prueba-portero", { type: "string" }),
];

async function sello(kp, marca) {
  const cuenta = await servidor.getAccount(kp.publicKey());
  const armada = new TransactionBuilder(cuenta, { fee: "100", networkPassphrase: FRASE })
    .addOperation(new Contract(CONTRATO).call("seal", ...argsSeal(kp, rondaEn(Math.floor(Date.now() / 1000) + 600), marca)))
    .setTimeout(240)
    .build();
  const lista = await servidor.prepareTransaction(armada);
  lista.sign(kp);
  return { xdr: lista.toXDR(), hash: Buffer.from(lista.hash()).toString("hex") };
}

async function pedir(metodo, ruta, cuerpo) {
  const t0 = performance.now();
  try {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { Origin: "https://tinkazo.app", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { estado: r.status, json, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    // Sin cuerpo ni cabeceras CORS desde un navegador, desde Node es un fallo de conexión o un 1102 sin cuerpo que se entienda.
    return { estado: 0, json: null, ms: Math.round(performance.now() - t0), error: String(e?.cause?.code ?? e?.name ?? e).slice(0, 60) };
  }
}

const cuentaNueva = Keypair.random();
await crearCuentaPatrocinada(S, cuentaNueva);
console.log(`# portero ${base} (testnet); cuenta de prueba de 0 XLM: ${cuentaNueva.publicKey()}`);
const antes = await pedir("GET", `/v1/patrocinio/cupo?cuenta=${cuentaNueva.publicKey()}`);
console.log(`cupo antes: ${antes.estado} en ${antes.ms} ms ${JSON.stringify(antes.json?.sellos ?? antes.json)} rige=${antes.json?.rige} prendido=${antes.json?.prendido}`);

const quieto = opcion("--quieto", 0);
const cuantos = opcion("--sellos", 3);
if (quieto > 0) {
  console.log(`quieto ${quieto} minutos sin tocar el portero…`);
  await dormir(quieto * 60_000);
}

const filas = [];
let m1102 = 0;
for (let i = 0; i < cuantos; i++) {
  // Cada sello se arma justo antes de mandarlo (la ventana de la transacción es corta y la secuencia avanza con cada uno);
  // armarlo habla con el RPC de la red, no con el portero, y no entra en lo que se mide.
  const t = await sello(cuentaNueva, 30 + i);
  const r = await pedir("POST", "/v1/patrocinio", { xdr: t.xdr });
  const etiqueta = i === 0 ? "EN FRÍO" : "en caliente";
  if (r.estado === 0) m1102++;
  filas.push({ etiqueta, estado: r.estado, ms: r.ms, hash: t.hash });
  console.log(`sello ${i + 1} (${etiqueta}): ${r.estado || "sin respuesta (" + r.error + ")"} en ${r.ms} ms ${r.json ? JSON.stringify({ status: r.json.status, motivo: r.json.motivo, quedan: r.json.quedan }) : ""}`);
  // El sello siguiente necesita el número de secuencia siguiente: se espera a que el anterior entre.
  if (r.estado === 200) await servidor.pollTransaction(t.hash, { attempts: 40, sleepStrategy: () => 1500 });
}
const despues = await pedir("GET", `/v1/patrocinio/cupo?cuenta=${cuentaNueva.publicKey()}`);
console.log(`cupo después: ${despues.estado} en ${despues.ms} ms ${JSON.stringify(despues.json?.sellos ?? despues.json)}`);

for (const f of filas.filter((x) => x.estado === 200)) {
  let h = null;
  for (let i = 0; i < 8 && !h; i++) {
    const r = await fetch(`${HORIZON}/transactions/${f.hash}`);
    if (r.ok) h = await r.json();
    else await dormir(1500);
  }
  console.log(`  ${f.hash}: ${h ? `fee-bump=${"fee_bump_transaction" in h} paga=${h.fee_account} origen=${h.source_account} comisión=${h.fee_charged} stroops` : "todavía no aparece en Horizon"}`);
}
const ms = filas.filter((x) => x.estado === 200).map((x) => x.ms);
console.log(`\nresumen: ${filas.length} sellos, ${ms.length} con 200, ${m1102} sin respuesta (posible 1102). En frío: ${filas[0]?.ms ?? "-"} ms; en caliente: ${ms.slice(1).join(", ") || "-"} ms.`);
process.exit(m1102 ? 1 : 0);
