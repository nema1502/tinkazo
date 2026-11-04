// Crea la cuenta patrocinadora del portero con su llave acotada, en testnet o en mainnet.
//
//   - P: la cuenta patrocinadora. Se crea con una llave propia que, al terminar, queda con peso 0.
//   - F: la llave fría de quien mantiene el proyecto, peso 2. Se pasa como dirección pública (G...):
//        este guion nunca ve su llave secreta, que se guarda fuera de la computadora.
//   - W: la llave del Worker, peso 1. Se genera acá; su secreta va al secreto CLAVE_PATROCINADOR.
//   - Umbrales: bajo 1, medio 2, alto 2. Un fee-bump pide el bajo (alcanza con W); un pago, el medio;
//     cambiar llaves, umbrales o vaciar la cuenta, el alto. W sola no puede sacar el dinero.
//
// Tres pasos, porque en mainnet hay que fondear P entre el primero y el segundo:
//
//   node crear-patrocinadora.mjs generar    --red mainnet --fria G... --privado <archivo fuera del repo>
//        Genera P y W, las guarda en el archivo privado y muestra la dirección de P (en testnet la fondea el grifo).
//   (mainnet) mandar a P unos 5 XLM desde la cuenta fría. Sin eso, el paso siguiente se niega.
//   node crear-patrocinadora.mjs configurar --red mainnet --privado <el mismo archivo>
//        Pone las llaves y los umbrales en UNA sola transacción, firmada con la llave de P, y lee la cadena para comprobar
//        que quedó lo que se quería. Si todo está bien borra la secreta de P del archivo: ya no sirve y no debe quedar.
//   node crear-patrocinadora.mjs comprobar  --red mainnet --cuenta G... [--fria G... --worker G...]
//        Solo lectura: muestra los pesos y umbrales que dice la cadena y, con --fria y --worker, falla si no son los esperados.
//
// El archivo privado no se imprime ni se versiona: tiene que estar fuera del repositorio (se rechaza una ruta adentro).
// Las llaves de testnet son de prueba; las de mainnet mueven dinero de verdad.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const REDES = {
  testnet: { horizon: "https://horizon-testnet.stellar.org", frase: Networks.TESTNET, grifo: "https://friendbot.stellar.org" },
  mainnet: { horizon: "https://horizon.stellar.org", frase: Networks.PUBLIC, grifo: null },
};

const args = process.argv.slice(2);
const orden = args[0];
const opcion = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const red = opcion("--red");

function salir(msg, codigo = 2) {
  console.error(msg);
  process.exit(codigo);
}

if (!REDES[red]) salir("falta --red testnet|mainnet");
const R = REDES[red];
const servidor = new Horizon.Server(R.horizon);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function rutaPrivada() {
  const r = opcion("--privado");
  if (!r) salir("falta --privado <archivo fuera del repositorio>");
  const abs = path.resolve(r);
  if (!path.relative(raiz, abs).startsWith("..")) salir("--privado tiene que estar FUERA del repositorio");
  return abs;
}

function esperadoEnCadena(cuenta, F, W) {
  const firmas = new Map(cuenta.signers.map((s) => [s.key, s.weight]));
  const problemas = [];
  if (firmas.get(F) !== 2) problemas.push(`la llave fría no pesa 2 (${firmas.get(F)})`);
  if (firmas.get(W) !== 1) problemas.push(`la llave del Worker no pesa 1 (${firmas.get(W)})`);
  if (firmas.get(cuenta.id) !== 0) problemas.push(`la llave propia de la cuenta no pesa 0 (${firmas.get(cuenta.id)})`);
  if (cuenta.signers.length !== 3) problemas.push(`hay ${cuenta.signers.length} firmantes, tienen que ser 3`);
  const u = cuenta.thresholds;
  if (u.low_threshold !== 1 || u.med_threshold !== 2 || u.high_threshold !== 2) problemas.push(`umbrales ${u.low_threshold}/${u.med_threshold}/${u.high_threshold}, tienen que ser 1/2/2`);
  return problemas;
}

if (orden === "generar") {
  const F = opcion("--fria");
  if (!F || !/^G[A-Z2-7]{55}$/.test(F)) salir("falta --fria G... (la dirección pública de la llave fría)");
  const privado = rutaPrivada();
  if (fs.existsSync(privado)) salir("el archivo privado ya existe: no se pisa. Si de verdad hay que rehacer, borralo a mano.");
  const P = Keypair.random();
  const W = Keypair.random();
  fs.mkdirSync(path.dirname(privado), { recursive: true });
  fs.writeFileSync(
    privado,
    JSON.stringify({ red, patrocinadora: P.publicKey(), secretaPatrocinadoraTemporal: P.secret(), fria: F, worker: W.publicKey(), secretaWorker: W.secret(), creado: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  if (R.grifo) {
    const r = await fetch(`${R.grifo}/?addr=${P.publicKey()}`);
    if (!r.ok) salir(`el grifo no fondeó la cuenta: ${r.status}`, 1);
    console.log("fondeada por el grifo de testnet");
  }
  console.log(`red: ${red}`);
  console.log(`cuenta patrocinadora (P): ${P.publicKey()}`);
  console.log(`llave del Worker (W), pública: ${W.publicKey()}`);
  console.log(`llave fría (F), pública: ${F}`);
  console.log(`secretas guardadas en ${privado} (no se imprimen)`);
  if (!R.grifo) console.log("Siguiente: mandar a P unos 5 XLM desde la cuenta fría, y correr `configurar`.");
} else if (orden === "configurar") {
  const privado = rutaPrivada();
  const d = JSON.parse(fs.readFileSync(privado, "utf8"));
  if (d.red !== red) salir(`el archivo es de ${d.red}, no de ${red}`);
  if (!d.secretaPatrocinadoraTemporal) salir("la secreta de P ya se borró: la cuenta ya está configurada. Usá `comprobar`.");
  const P = Keypair.fromSecret(d.secretaPatrocinadoraTemporal);
  let cuenta;
  try {
    cuenta = await servidor.loadAccount(P.publicKey());
  } catch {
    salir("P todavía no existe en la red: hay que mandarle XLM primero", 1);
  }
  const saldo = Number(cuenta.balances.find((b) => b.asset_type === "native")?.balance ?? 0);
  if (saldo < 4) salir(`P tiene ${saldo} XLM; hacen falta al menos 4 (2 de reserva con sus dos firmantes y margen para la comisión)`, 1);
  if (cuenta.signers.length > 1) salir("P ya tiene firmantes agregados; no se repite. Usá `comprobar`.", 1);
  const tx = new TransactionBuilder(cuenta, { fee: "1000", networkPassphrase: R.frase })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: d.fria, weight: 2 } }))
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: d.worker, weight: 1 } }))
    .addOperation(Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 2 }))
    .setTimeout(120)
    .build();
  tx.sign(P);
  const r = await servidor.submitTransaction(tx);
  console.log(`transacción: ${r.hash}`);
  const leida = await servidor.loadAccount(P.publicKey());
  const problemas = esperadoEnCadena(leida, d.fria, d.worker);
  if (problemas.length) salir(`LA CADENA NO DICE LO ESPERADO: ${problemas.join("; ")}`, 1);
  delete d.secretaPatrocinadoraTemporal;
  d.configurada = new Date().toISOString();
  d.transaccionDeConfiguracion = r.hash;
  fs.writeFileSync(privado, JSON.stringify(d, null, 2), { mode: 0o600 });
  console.log("OK: F pesa 2, W pesa 1, P pesa 0, umbrales 1/2/2. La secreta de P se borró del archivo.");
  console.log(`CUENTA_PATROCINADORA = ${P.publicKey()}`);
} else if (orden === "comprobar") {
  const G = opcion("--cuenta");
  if (!G) salir("falta --cuenta G...");
  const cuenta = await servidor.loadAccount(G);
  const pesos = cuenta.signers.map((s) => `${s.key.slice(0, 5)}…${s.key.slice(-4)}=${s.weight}`).join("  ");
  console.log(`firmantes: ${pesos}`);
  console.log(`umbrales (bajo/medio/alto): ${cuenta.thresholds.low_threshold}/${cuenta.thresholds.med_threshold}/${cuenta.thresholds.high_threshold}`);
  console.log(`saldo: ${cuenta.balances.find((b) => b.asset_type === "native")?.balance} XLM`);
  const F = opcion("--fria");
  const W = opcion("--worker");
  if (F && W) {
    const problemas = esperadoEnCadena(cuenta, F, W);
    if (problemas.length) salir(`MAL: ${problemas.join("; ")}`, 1);
    console.log("OK: es lo esperado");
  }
} else {
  salir("uso: generar | configurar | comprobar (ver el encabezado del archivo)");
}
