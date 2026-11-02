// Lo común de los guiones de prueba del portero: hablar con TESTNET y con nada más.
// No hay forma de apuntarlo a otra red: la frase de red, los RPC y el grifo están escritos acá.
import { Keypair, Networks, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";

export const FRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON = "https://horizon-testnet.stellar.org";
export const GRIFO = "https://friendbot.stellar.org";
export const servidor = new rpc.Server(RPC_URL);

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una cuenta nueva con 10.000 XLM de prueba del grifo de testnet. */
export async function conGrifo(kp) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${GRIFO}/?addr=${kp.publicKey()}`);
    if (r.ok) return;
    await dormir(2000);
  }
  throw new Error(`el grifo no fondeó ${kp.publicKey()}`);
}

/** Manda una transacción firmada y espera a que la red la cierre. Devuelve la respuesta de getTransaction. */
export async function enviarYEsperar(tx) {
  const r = await servidor.sendTransaction(tx);
  if (r.status !== "PENDING" && r.status !== "DUPLICATE") throw new Error(`la red no la tomó: ${r.status} ${r.errorResult?.result?.()?.switch?.()?.name ?? ""}`);
  const c = await servidor.pollTransaction(r.hash, { attempts: 40, sleepStrategy: () => 1500 });
  if (c.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`falló en la red: ${c.status}`);
  return c;
}

/**
 * Crea una cuenta con 0 XLM cuyo patrocinador de reservas es `patrocinador`,
 * como las que abre Pollar: begin/end sponsoring con la cuenta nueva y el patrocinador firmando.
 */
export async function crearCuentaPatrocinada(patrocinador, nueva) {
  const cuenta = await servidor.getAccount(patrocinador.publicKey());
  const tx = new TransactionBuilder(cuenta, { fee: "10000", networkPassphrase: FRASE })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: nueva.publicKey() }))
    .addOperation(Operation.createAccount({ destination: nueva.publicKey(), startingBalance: "0" }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: nueva.publicKey() }))
    .setTimeout(120)
    .build();
  tx.sign(patrocinador, nueva);
  await enviarYEsperar(tx);
}

export function leerJson(ruta, fs) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

export { Keypair };
