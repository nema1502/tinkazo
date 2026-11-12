#!/usr/bin/env node
/**
 * Prepara, en testnet, todo lo que hace falta para probar a mano los premios pagados (docs/premios.md).
 *
 * Crea cuentas nuevas (con el grifo de testnet), un activo de prueba propio, TKUSD, y deja:
 *   - la cuenta de quien organiza, con 1.000 TKUSD, que es la que sella y paga;
 *   - un ganador que puede cobrar (tiene la línea de TKUSD activada);
 *   - un ganador que no (existe, pero no activó TKUSD): el sitio tiene que decirlo antes de pedir la firma;
 *   - un ganador cuya cuenta todavía no existe en la red.
 *
 * Solo testnet. Las llaves salen por pantalla y no se guardan: son de prueba, no las reutilices en ningún otro lado.
 *
 * Uso:
 *   node scripts/pagos-testnet.mjs
 * y sigue lo que imprime.
 */
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const GRIFO = "https://friendbot.stellar.org";

async function fondear(llave) {
  const r = await fetch(`${GRIFO}/?addr=${llave.publicKey()}`);
  if (!r.ok) throw new Error(`el grifo de testnet contestó ${r.status}`);
}

async function mandar(llave, operaciones) {
  const cuenta = await (await fetch(`${HORIZON}/accounts/${llave.publicKey()}`)).json();
  let tx = new TransactionBuilder(new Account(llave.publicKey(), cuenta.sequence), { fee: "1000", networkPassphrase: Networks.TESTNET });
  for (const o of operaciones) tx = tx.addOperation(o);
  const firmada = tx.setTimeout(60).build();
  firmada.sign(llave);
  const r = await fetch(`${HORIZON}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: firmada.toXDR() }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j.extras?.result_codes ?? j));
}

const emisor = Keypair.random();
const organiza = Keypair.random();
const conLinea = Keypair.random();
const sinLinea = Keypair.random();
const sinCuenta = Keypair.random();
const TKUSD = new Asset("TKUSD", emisor.publicKey());

console.error("Creando las cuentas en testnet…");
await Promise.all([emisor, organiza, conLinea, sinLinea].map(fondear));
await mandar(organiza, [Operation.changeTrust({ asset: TKUSD })]);
await mandar(conLinea, [Operation.changeTrust({ asset: TKUSD })]);
await mandar(emisor, [Operation.payment({ destination: organiza.publicKey(), asset: TKUSD, amount: "1000" })]);

console.log(`
1. En .env.local (y reiniciá pnpm dev):

   VITE_STELLAR_NETWORK=testnet
   VITE_PAGOS=1
   VITE_PAGOS_ACTIVO=TKUSD:${emisor.publicKey()}

2. Quien organiza (sella y paga) es ${organiza.publicKey()}, con 1.000 TKUSD.
   Para entrar con esa cuenta: en la consola del navegador, con el sitio abierto,

   localStorage.setItem("tinkazo.guest.secret.testnet", "${organiza.secret()}")

   recargá y entrá con "Cuenta de prueba". (O importá esa llave en Varial, antes Freighter, en testnet.)

3. Pegá esta lista, poné "50 USDC" como premio (el monto se propone de ahí), sellala y sorteá con 3 ganadores:

${conLinea.publicKey()}
${sinLinea.publicKey()}
${sinCuenta.publicKey()}

   - la primera cuenta puede cobrar: "Pagar premio" la paga y pasa a Pagado;
   - la segunda existe pero no activó TKUSD: el sitio lo dice antes de pedir la firma y ofrece "Avisarle";
   - la tercera todavía no existe en la red: lo mismo.
   Los pagos se ven en https://stellar.expert/explorer/testnet/account/${organiza.publicKey()}
`);
