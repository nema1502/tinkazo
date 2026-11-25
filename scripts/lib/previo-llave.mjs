/**
 * El control previo del recorrido de la prueba de la llave (issue 301), sin navegador: antes de abrir Chrome mira que la
 * red de prueba siga siendo la que la prueba espera y que lo que no es nuestro conteste.
 *
 * Sale con 0 si todo está bien y con 2 si no se puede medir, nunca con 1 (que es el de la prueba fallida):
 * - `la-red-de-prueba-cambio`: falta el código de la cuenta, el verificador o nuestro contrato, o el desplegador compartido
 *   ya no es el mismo (otra cantidad de firmantes o umbrales).
 * - `no-se-pudo-medir`: el grifo, la red o el servicio de azar público no contestan.
 *
 * Las direcciones son las de `src/prueba-llave/red.ts`: una prueba las compara.
 */
import { StrKey } from "@stellar/stellar-sdk";

export const RED = {
  rpc: "https://soroban-testnet.stellar.org",
  horizon: "https://horizon-testnet.stellar.org",
  friendbot: "https://friendbot.stellar.org",
  contrato: "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A",
  codigoCuenta: "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1",
  verificador: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  desplegador: "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N",
};

const DRAND = "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/latest";

const aBase64 = (hex) => Buffer.from(hex, "hex").toString("base64");
const hexDe = (bytes) => Buffer.from(bytes).toString("hex");

/** La llave del ledger del código de un contrato: LEDGER_ENTRY_TYPE 7 y el hash de 32 bytes. */
export function claveDeCodigo(hashHex) {
  return aBase64(`00000007${hashHex}`);
}

/**
 * La llave del ledger de la instancia de un contrato: CONTRACT_DATA (6), la dirección del contrato (tipo 1 y 32 bytes),
 * la clave de instancia (tipo de valor 20) y duración persistente (1).
 */
export function claveDeInstancia(contrato) {
  return aBase64(`00000006` + `00000001${hexDe(StrKey.decodeContract(contrato))}` + `00000014` + `00000001`);
}

async function json(fetchFn, url, init, topeMs = 15_000) {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(topeMs) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function rpc(fetchFn, metodo, params) {
  const r = await json(fetchFn, RED.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }) });
  if (r.error) throw new Error(`${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  return r.result;
}

/**
 * @param {{ fetchFn?: typeof fetch }} [o]
 * @returns {Promise<{ salida: 0 | 2, motivo: string | null, datos: Record<string, unknown>, fallas: string[] }>}
 */
export async function controlPrevio(o = {}) {
  const fetchFn = o.fetchFn ?? fetch;
  const cambio = [];
  const sinMedir = [];
  const datos = { codigo: false, verificador: false, contrato: false, desplegadorIntacto: false, friendbot: null, drand: false };
  try {
    await rpc(fetchFn, "getLatestLedger", {});
  } catch (e) {
    sinMedir.push(`la red de prueba no contesta: ${e.message}`);
  }

  try {
    // Cada una por su cuenta, porque el RPC no devuelve en orden lo que falta.
    const una = async (clave) => ((await rpc(fetchFn, "getLedgerEntries", { keys: [clave] })).entries ?? []).length > 0;
    datos.codigo = await una(claveDeCodigo(RED.codigoCuenta));
    datos.verificador = await una(claveDeInstancia(RED.verificador));
    datos.contrato = await una(claveDeInstancia(RED.contrato));
    if (!datos.codigo) cambio.push("no está el código de la cuenta");
    if (!datos.verificador) cambio.push("no está el verificador");
    if (!datos.contrato) cambio.push("no está el contrato de la prueba");
  } catch (e) {
    sinMedir.push(`no se pudo leer la red: ${e.message}`);
  }

  try {
    const res = await fetchFn(`${RED.horizon}/accounts/${RED.desplegador}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) cambio.push("el desplegador compartido ya no existe");
    else if (!res.ok) sinMedir.push(`el historial de la red contestó ${res.status}`);
    else {
      const c = await res.json();
      const firmantes = Array.isArray(c.signers) ? c.signers : [];
      const t = c.thresholds ?? {};
      datos.desplegadorIntacto = firmantes.length === 1 && firmantes[0].key === RED.desplegador && Number(firmantes[0].weight) === 1 && Number(t.low_threshold) === 0 && Number(t.med_threshold) === 0 && Number(t.high_threshold) === 0;
      if (!datos.desplegadorIntacto) cambio.push("el desplegador compartido cambió de firmantes o de umbrales");
    }
  } catch (e) {
    sinMedir.push(`no se pudo mirar el desplegador: ${e.message}`);
  }

  try {
    const res = await fetchFn(`${RED.friendbot}/`, { signal: AbortSignal.timeout(15_000) });
    datos.friendbot = res.status;
    if (res.status >= 500) sinMedir.push(`el grifo contestó ${res.status}`);
  } catch (e) {
    sinMedir.push(`el grifo no contesta: ${e.message}`);
  }

  try {
    const r = await json(fetchFn, DRAND, {});
    datos.drand = Number.isInteger(r.round);
    if (!datos.drand) sinMedir.push("el servicio de azar público contestó algo inesperado");
  } catch (e) {
    sinMedir.push(`el servicio de azar público no contesta: ${e.message}`);
  }

  if (cambio.length) return { salida: 2, motivo: "la-red-de-prueba-cambio", datos, fallas: cambio };
  if (sinMedir.length) return { salida: 2, motivo: "no-se-pudo-medir", datos, fallas: sinMedir };
  return { salida: 0, motivo: null, datos, fallas: [] };
}
