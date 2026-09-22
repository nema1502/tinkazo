/**
 * Cuánta renta le queda al contrato antes de que la red lo archive.
 *
 * Lo que el contrato guarda en la cadena paga alquiler. Si nadie lo extiende,
 * la entrada se archiva: el sorteo no se pierde, pero deja de leerse hasta que
 * alguien pague por restaurarlo. Y eso pasaría un martes cualquiera, sin aviso,
 * salvo que alguien esté mirando. Esto es ese alguien.
 *
 * Mira las dos entradas que sostienen el producto: la instancia del contrato y
 * su código. Sale con código 1 si a alguna le quedan menos días que el umbral,
 * así que sirve para encadenar en la integración continua o en una tarea
 * programada.
 *
 * Uso:
 *   node scripts/check-renta.mjs                    # todas las redes con contrato
 *   node scripts/check-renta.mjs --red testnet
 *   node scripts/check-renta.mjs --dias 45          # avisar con más anticipación
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Address, xdr } from "@stellar/stellar-sdk";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};
/** Un ledger cada cinco segundos: 17 280 por día. */
const LEDGERS_POR_DIA = 17_280;

const args = process.argv.slice(2);
const opcion = (nombre, def) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const UMBRAL = Number(opcion("--dias", "30"));
const SOLO = opcion("--red", null);

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "error del RPC");
  return body.result;
}

const claveInstancia = (contrato) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contrato).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXdr("base64");

const claveCodigo = (hash) =>
  xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash })).toXdr("base64");

const dias = (ledgers) => ledgers / LEDGERS_POR_DIA;

function fecha(ledgersRestantes) {
  const cuando = new Date(Date.now() + ledgersRestantes * 5000);
  return cuando.toISOString().slice(0, 10);
}

async function revisar(red, contrato) {
  const url = RPC[red];
  const { sequence } = await rpc(url, "getLatestLedger", {});

  const inst = await rpc(url, "getLedgerEntries", { keys: [claveInstancia(contrato)] });
  const entrada = inst.entries?.[0];
  if (!entrada) {
    console.log(`  ${red}: la instancia no está en la cadena (¿archivada, o red equivocada?)`);
    return false;
  }
  const datos = xdr.LedgerEntryData.fromXdr(entrada.xdr, "base64");
  const valor = datos.contractData.val;
  const ejecutable = valor.instance.executable;
  const filas = [["instancia", Number(entrada.liveUntilLedgerSeq)]];

  if (ejecutable.type === "contractExecutableWasm") {
    const codigo = await rpc(url, "getLedgerEntries", {
      keys: [claveCodigo(ejecutable.wasmHash)],
    });
    const e = codigo.entries?.[0];
    filas.push(["código", e ? Number(e.liveUntilLedgerSeq) : 0]);
  }

  let alarma = false;
  for (const [que, hasta] of filas) {
    const restan = hasta - Number(sequence);
    const d = dias(restan);
    const estado = d < UMBRAL ? "EXTENDER" : "ok";
    if (d < UMBRAL) alarma = true;
    console.log(
      `  ${red} · ${que.padEnd(9)} ${estado.padEnd(9)} ${d.toFixed(1).padStart(6)} días ` +
      `(hasta el ledger ${hasta}, ~${fecha(restan)})`,
    );
  }
  return alarma;
}

async function main() {
  const despliegues = JSON.parse(await readFile(join(RAIZ, "src/stellar/deployments.json"), "utf8"));
  const redes = Object.entries(despliegues).filter(
    ([red, d]) => d?.contractId && RPC[red] && (!SOLO || SOLO === red),
  );
  if (redes.length === 0) {
    console.log("No hay contrato desplegado en ninguna red configurada.");
    return;
  }
  console.log(`Renta del contrato · avisa por debajo de ${UMBRAL} días\n`);
  let alarma = false;
  for (const [red, d] of redes) {
    console.log(`${red}: ${d.contractId}`);
    try {
      alarma = (await revisar(red, d.contractId)) || alarma;
    } catch (e) {
      console.log(`  ${red}: no se pudo preguntar (${e.message})`);
      alarma = true;
    }
  }
  if (alarma) {
    console.log(
      "\nPara extender:  stellar contract extend --id <contrato> --ledgers-to-extend 2073600" +
      " --durability persistent --source <cuenta> --network <red>",
    );
    process.exitCode = 1;
  } else {
    console.log("\nTodo con renta de sobra.");
  }
}

await main();
