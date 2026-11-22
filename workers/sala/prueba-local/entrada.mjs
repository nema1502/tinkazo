/**
 * La puerta de entrada del Worker de la sala SOLO para probarlo en esta máquina con `wrangler dev` (ver `correr.mjs`).
 *
 * No se despliega nunca: el despliegue usa `src/index.ts` por `wrangler.toml`. Acá se reexportan los mismos objetos
 * (`Sala` y `Cupos`) y el mismo `fetch` sin tocar una línea del código de la sala. Lo único distinto es lo que hay
 * AFUERA del Worker, que se reemplaza por una imitación local para no salir a la red ni gastar nada:
 *
 *  - el proveedor de cuentas: `POST /v3/tokens/verify` contesta según las sesiones que la prueba registre;
 *  - el RPC de la red de Stellar: `getLedgerEntries` contesta el sello que la prueba deje armado;
 *  - cualquier otra salida a internet se rechaza y se anota, así la prueba comprueba que no sale nada.
 *
 * La prueba arma estas imitaciones con pedidos a `/__prueba/...`, que solo atienden a localhost.
 */
import { Address, xdr } from "@stellar/stellar-sdk/base";
import deployments from "../../../src/stellar/deployments.json";
import { listHash } from "../../../src/protocol/canonical";
import real, { Cupos, Sala } from "../src/index.ts";

export { Cupos, Sala };

const HOST_POLLAR = "server.api.pollar.xyz";
const HOST_RPC = "rpc.prueba.invalid";

const sesiones = new Map();
const sellos = new Map();
const salidas = [];
let env = null;

const hexa = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const json = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

/** El proveedor de cuentas de mentira: solo las sesiones que la prueba registró. Una desconocida es un 401 de sesión. */
function pollarFalso(ruta, init) {
  if (ruta.pathname === "/v3/tokens/verify" && init?.method === "POST") {
    const token = JSON.parse(String(init.body ?? "{}")).token;
    const s = sesiones.get(token);
    if (!s) return json({ success: false, code: "SDK_AUTH_INVALID_TOKEN" }, 401);
    return json({
      success: true,
      code: "SERVER_TOKEN_VERIFIED",
      content: {
        userId: s.userId,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        applicationId: env?.POLLAR_APP_ID ?? "",
        network: "mainnet",
        wallet: [{ chain: "STELLAR", publicKey: s.cuenta }],
        authProvider: s.via,
      },
    });
  }
  return json({ success: false, code: "NO_EXISTE" }, 404);
}

/** El sello de un sorteo como lo guarda el contrato, y la instancia con el programa que la sala exige. */
function entradaDeLaRed(llave, direccion) {
  const k = xdr.LedgerKey.fromXDR(llave, "base64");
  if (k.type !== "contractData") return null;
  const clave = k.contractData.key;
  const dato = (val) =>
    xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({
        ext: xdr.ExtensionPoint.v0(),
        contract: k.contractData.contract,
        key: clave,
        durability: xdr.ContractDataDurability.persistent,
        val,
      }),
    ).toXDR("base64");
  const red = deployments[direccion];
  if (clave.type === "scvLedgerKeyContractInstance") {
    const ejecutable = xdr.ContractExecutable.contractExecutableWasm(Buffer.from(red.wasmSha256, "hex"));
    return dato(xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable: ejecutable, storage: null })));
  }
  if (clave.type !== "scvVec" || clave.vec.length !== 2) return null;
  const [nombre, id] = clave.vec;
  const sello = sellos.get(String(id.u64));
  if (String(nombre.sym) !== "Raffle" || !sello) return null;
  const campo = (k2, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k2), val: v });
  return dato(
    xdr.ScVal.scvMap([
      campo("count", xdr.ScVal.scvU32(sello.count)),
      campo("list_hash", xdr.ScVal.scvBytes(Buffer.from(sello.listHash, "hex"))),
      campo("num_winners", xdr.ScVal.scvU32(sello.numWinners)),
      campo("organizer", new Address(sello.organizer).toScVal()),
      campo("round", xdr.ScVal.scvU64(BigInt(sello.ronda))),
      campo("status", xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(sello.sorteado ? "Drawn" : "Sealed")])),
    ]),
  );
}

function rpcFalso(init) {
  const pedido = JSON.parse(String(init?.body ?? "{}"));
  if (pedido.method !== "getLedgerEntries") return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "metodo" } });
  const entries = [];
  for (const llave of pedido.params?.keys ?? []) {
    const xdrDeLaEntrada = entradaDeLaRed(llave, "mainnet");
    if (xdrDeLaEntrada) entries.push({ key: llave, xdr: xdrDeLaEntrada });
  }
  return json({ jsonrpc: "2.0", id: 1, result: { entries, latestLedger: 1 } });
}

globalThis.fetch = async (entrada, init) => {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  salidas.push(url.host);
  if (url.host === HOST_POLLAR) return pollarFalso(url, init);
  if (url.host === HOST_RPC) {
    try {
      return rpcFalso(init);
    } catch (e) {
      console.log("rpc de prueba: " + String(e?.message ?? e));
      throw e;
    }
  }
  return json({ error: "sin-salida-en-la-prueba" }, 599);
};

/** Los pedidos que arman las imitaciones: solo desde esta máquina. */
async function atenderPrueba(req, url) {
  const cuerpo = req.method === "POST" ? await req.json() : null;
  if (url.pathname === "/__prueba/sesiones") {
    sesiones.clear();
    for (const [token, datos] of Object.entries(cuerpo.sesiones)) sesiones.set(token, datos);
    return json({ n: sesiones.size });
  }
  if (url.pathname === "/__prueba/sello") {
    const lista = cuerpo.cuentas;
    sellos.set(String(cuerpo.sorteo), {
      count: lista.length,
      listHash: hexa(listHash(lista)),
      numWinners: cuerpo.numWinners,
      organizer: cuerpo.organizer,
      ronda: cuerpo.ronda,
      sorteado: cuerpo.sorteado === true,
    });
    return json({ ok: true });
  }
  if (url.pathname === "/__prueba/salidas") return json({ hosts: [...new Set(salidas)] });
  return json({ error: "no-existe" }, 404);
}

export default {
  async fetch(req, entorno, ctx) {
    env = entorno;
    const url = new URL(req.url);
    if (url.pathname.startsWith("/__prueba/") && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return atenderPrueba(req, url);
    return real.fetch(req, entorno, ctx);
  },
};
