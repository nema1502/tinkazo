/**
 * Las piezas del recorrido de recibir y mandar monedas de prueba (`scripts/recorrido-llave.mjs`) que no necesitan navegador:
 * preparar la cuenta de destino de prueba, leer los saldos y la nota en la red por un camino que no usa nada del código de
 * la página, y los checks.
 *
 * Las lecturas del recorrido salen por el mismo RPC que usa la página, pero con el SDK y sin importar nada de ella: así, si
 * la página leyera mal un saldo, el recorrido no heredaría el error.
 */
import { Account, Asset, humanizeEvents, Keypair, Networks, Operation, rpc as rpcDelSdk, scValToNative, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { RED } from "./previo-llave.mjs";

/** Lo que paga el premio de prueba y lo que recibe de saldo la cuenta de destino que arma la página, en la unidad mínima. */
export const MONTO_DEL_PREMIO = 100_000_000n;
export const SALDO_INICIAL_DEL_DESTINO_STROOPS = 20_000_000n;
/** La nota de la cuenta de destino que arma la página. */
export const NOTA_DE_PRUEBA = 1_234_567_890n;

const dormirDeVerdad = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamarRpc(fetchFn, metodo, params) {
  const res = await fetchFn(RED.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${j.error.code ?? ""} ${j.error.message ?? ""}`.trim());
  return j.result;
}

/**
 * Crea una cuenta de prueba con el grifo y le pone la marca de que pide nota. Espera a que el historial muestre la marca: sin
 * esa espera, la página podría leer la cuenta sin ella y mandar sin nota. La llave vive solo en la memoria de este guion.
 * Si algo de afuera no contesta devuelve `{ ajena: true, motivo }`: no es una falla de la prueba.
 * @param {{ fetchFn?: typeof fetch, dormir?: (ms: number) => Promise<void>, ahora?: () => number, par?: import("@stellar/stellar-sdk").Keypair }} [o]
 * @returns {Promise<{ publica: string, hash: string, segundos: number } | { ajena: true, motivo: string }>}
 */
export async function prepararDestino(o = {}) {
  const fetchFn = o.fetchFn ?? fetch;
  const dormir = o.dormir ?? dormirDeVerdad;
  const ahora = o.ahora ?? Date.now;
  const par = o.par ?? Keypair.random();
  const publica = par.publicKey();
  const inicio = ahora();
  const ajena = (motivo) => ({ ajena: true, motivo });

  let fondeada = false;
  let limitado = false;
  for (let i = 0; i < 3 && !fondeada; i++) {
    try {
      const res = await fetchFn(`${RED.friendbot}/?addr=${encodeURIComponent(publica)}`, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) limitado = true;
      if ((res.status >= 200 && res.status < 300) || res.status === 400) fondeada = true;
    } catch {
      /* un corte: se vuelve a probar */
    }
    if (!fondeada && i < 2) await dormir(5_000);
  }
  if (!fondeada) return ajena(limitado ? "grifo-limitado" : "grifo");

  const leerCuenta = async () => {
    try {
      const res = await fetchFn(`${RED.horizon}/accounts/${encodeURIComponent(publica)}`, { signal: AbortSignal.timeout(15_000) });
      return res.status === 200 ? await res.json() : null;
    } catch {
      return null;
    }
  };
  let cuenta = null;
  for (const limite = ahora() + 20_000; ahora() < limite; ) {
    cuenta = await leerCuenta();
    if (cuenta?.sequence) break;
    await dormir(1_000);
  }
  if (!cuenta?.sequence) return ajena("cuenta-sin-aparecer");

  const tx = new TransactionBuilder(new Account(publica, String(cuenta.sequence)), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: "config.memo_required", value: "1" }))
    .setTimeout(60)
    .build();
  tx.sign(par);
  const hash = Array.from(tx.hash(), (n) => n.toString(16).padStart(2, "0")).join("");
  try {
    const r = await llamarRpc(fetchFn, "sendTransaction", { transaction: tx.toXDR() });
    if (r.status === "ERROR") return ajena("rpc-ajeno");
  } catch {
    return ajena("rpc-ajeno");
  }

  let entro = false;
  for (const limite = ahora() + 30_000; ahora() < limite; ) {
    try {
      const r = await llamarRpc(fetchFn, "getTransaction", { hash });
      if (r.status === "SUCCESS") {
        entro = true;
        break;
      }
      if (r.status === "FAILED") return ajena("rpc-ajeno");
    } catch {
      /* se sigue preguntando */
    }
    await dormir(1_500);
  }
  if (!entro) return ajena("rpc-ajeno");

  for (const limite = ahora() + 30_000; ahora() < limite; ) {
    const c = await leerCuenta();
    if (c?.data?.["config.memo_required"] === "MQ==") return { publica, hash, segundos: Math.round((ahora() - inicio) / 1000) };
    await dormir(2_000);
  }
  return ajena("historial-sin-marca");
}

/**
 * Lo que hay en la red de las monedas de prueba de una billetera (`contrato`) y de una cuenta G (`cuenta`), leído por el RPC.
 * Sin entrada de saldo, la billetera tiene cero. Si el RPC todavía no llegó al ledger de `desdeLedger`, espera 3 s y vuelve a
 * leer, hasta tres veces más. Un corte lanza: quien llama lo anota como falla ajena.
 * @param {{ contrato?: string, cuenta?: string, desdeLedger?: number, servidor?: { getAssetBalance: Function, getAccountEntry: Function }, dormir?: (ms: number) => Promise<void> }} o
 * @returns {Promise<{ contrato: bigint | null, cuenta: bigint | null, latestLedger: number }>}
 */
export async function saldosEnLaRed(o) {
  const dormir = o.dormir ?? dormirDeVerdad;
  const servidor = o.servidor ?? new rpcDelSdk.Server(RED.rpc);
  const desdeLedger = o.desdeLedger ?? 0;
  for (let vuelta = 0; ; vuelta++) {
    let latestLedger = Number.MAX_SAFE_INTEGER;
    let contrato = null;
    if (o.contrato) {
      const r = await servidor.getAssetBalance(o.contrato, Asset.native(), Networks.TESTNET);
      latestLedger = Number(r?.latestLedger ?? 0);
      contrato = r?.balanceEntry ? BigInt(r.balanceEntry.amount) : 0n;
    }
    if (latestLedger < desdeLedger && vuelta < 3) {
      await dormir(3_000);
      continue;
    }
    let cuenta = null;
    if (o.cuenta) {
      try {
        const e = await servidor.getAccountEntry(o.cuenta);
        cuenta = BigInt(typeof e.balance === "function" ? e.balance() : e.balance);
      } catch {
        cuenta = null;
      }
    }
    return { contrato, cuenta, latestLedger: Number.isFinite(latestLedger) && latestLedger !== Number.MAX_SAFE_INTEGER ? latestLedger : 0 };
  }
}

/** Un entero de lo que devuelve `scValToNative`, o `null`. */
const entero = (x) => (typeof x === "bigint" ? x : typeof x === "number" && Number.isInteger(x) ? BigInt(x) : null);

/** De un dato ya decodificado de una transferencia: el monto y la nota. */
function transferenciaDeDato(dato) {
  const suelto = entero(dato);
  if (suelto !== null) return { monto: suelto, nota: null };
  if (typeof dato === "object" && dato !== null) {
    const monto = entero(dato.amount);
    if (monto !== null) return { monto, nota: entero(dato.to_muxed_id) };
  }
  return null;
}

/**
 * La nota que dejó la red en el evento de la transferencia de una transacción: primero en lo que contesta `getTransaction` y,
 * si no trae eventos, en `getEvents` desde el ledger de la transacción. `null` en `nota` si no hay ninguna.
 * @param {{ hash: string, activo?: string, fetchFn?: typeof fetch }} o
 * @returns {Promise<{ nota: bigint | null, monto: bigint | null, fuente: "transaccion" | "eventos" | null }>}
 */
export async function notaEnLaRed(o) {
  const fetchFn = o.fetchFn ?? fetch;
  const activo = o.activo ?? RED.activo;
  const tx = await llamarRpc(fetchFn, "getTransaction", { hash: o.hash });
  const grupos = tx?.events?.contractEventsXdr;
  if (Array.isArray(grupos)) {
    for (const grupo of grupos) {
      for (const b64 of Array.isArray(grupo) ? grupo : []) {
        try {
          const visto = humanizeEvents([xdr.ContractEvent.fromXDR(b64, "base64")])[0];
          if (visto && visto.contractId === activo && visto.topics[0] === "transfer") {
            const t = transferenciaDeDato(visto.data);
            if (t) return { nota: t.nota, monto: t.monto, fuente: "transaccion" };
          }
        } catch {
          /* un evento que no se entiende no cuenta */
        }
      }
    }
  }
  const ledger = Number(tx?.ledger ?? 0);
  if (ledger > 0) {
    const r = await llamarRpc(fetchFn, "getEvents", { startLedger: ledger, filters: [{ type: "contract", contractIds: [activo] }], pagination: { limit: 100 } });
    for (const e of r?.events ?? []) {
      if (e.txHash !== o.hash) continue;
      try {
        const temas = (e.topic ?? []).map((t) => scValToNative(xdr.ScVal.fromXDR(t, "base64")));
        if (temas[0] !== "transfer") continue;
        const t = transferenciaDeDato(scValToNative(xdr.ScVal.fromXDR(e.value, "base64")));
        if (t) return { nota: t.nota, monto: t.monto, fuente: "eventos" };
      } catch {
        /* un evento que no se entiende no cuenta */
      }
    }
  }
  return { nota: null, monto: null, fuente: null };
}

/** Los nombres de los checks de recibir y mandar monedas de prueba. Informativos mientras no cuenten en la salida. */
export const CHECKS_DE_PREMIO = [
  "premio-crear",
  "premio-recibir",
  "premio-pide-nota",
  "premio-sin-doble",
  "premio-mandar",
  "premio-un-desbloqueo",
  "premio-nota",
  "premio-saldos",
  "premio-sin-doble-tras-mandar",
  "premio-raiz",
];

const igual = (a, b) => typeof a === "bigint" && a === b;
const ver = (x) => (x === null || x === undefined ? "sin dato" : String(x));

/**
 * Los checks, a partir de lo que se midió en cada carga del navegador y de lo que dijo la red.
 * @param {{
 *   c1?: { estado?: string | null, medidas?: any },
 *   s1?: { contrato?: bigint | null },
 *   destinoAntes?: bigint | null,
 *   pideNota?: { estado?: string | null, medidas?: any },
 *   sPide?: { contrato?: bigint | null, cuenta?: bigint | null },
 *   c2?: { estado?: string | null, medidas?: any },
 *   s2?: { contrato?: bigint | null },
 *   enviado?: { estado?: string | null, medidas?: any },
 *   s3?: { contrato?: bigint | null, cuenta?: bigint | null },
 *   nota?: { nota?: bigint | null },
 *   c3?: { estado?: string | null, medidas?: any },
 *   s4?: { contrato?: bigint | null },
 * }} d
 */
export function checksDePremio(d) {
  const envio = d.enviado?.medidas?.envios?.[0];
  const checks = [
    { nombre: "premio-crear", ok: d.c1?.estado === "premio-listo", detalle: ver(d.c1?.estado) },
    { nombre: "premio-recibir", ok: igual(d.s1?.contrato, MONTO_DEL_PREMIO), detalle: `en la red ${ver(d.s1?.contrato)}` },
    {
      nombre: "premio-pide-nota",
      ok:
        d.pideNota?.estado === "pide-nota" &&
        igual(d.sPide?.contrato, MONTO_DEL_PREMIO) &&
        typeof d.destinoAntes === "bigint" &&
        d.sPide?.cuenta === d.destinoAntes &&
        Array.isArray(d.pideNota?.medidas?.envios) &&
        d.pideNota.medidas.envios.length === 0,
      detalle: `${ver(d.pideNota?.estado)}, billetera ${ver(d.sPide?.contrato)}, destino ${ver(d.sPide?.cuenta)} de ${ver(d.destinoAntes)}`,
    },
    {
      nombre: "premio-sin-doble",
      ok: d.c2?.estado === "premio-listo" && (d.c2?.medidas?.premio ?? null) === null && igual(d.s2?.contrato, MONTO_DEL_PREMIO),
      detalle: `${ver(d.c2?.estado)}, premio en esta carga ${d.c2?.medidas?.premio ? "sí" : "no"}, billetera ${ver(d.s2?.contrato)}`,
    },
    { nombre: "premio-mandar", ok: d.enviado?.estado === "enviado", detalle: ver(d.enviado?.estado) },
    { nombre: "premio-un-desbloqueo", ok: envio?.desbloqueos === 1, detalle: `${ver(envio?.desbloqueos)} desbloqueos` },
    { nombre: "premio-nota", ok: igual(d.nota?.nota, NOTA_DE_PRUEBA), detalle: `la red dice ${ver(d.nota?.nota)}` },
    {
      nombre: "premio-saldos",
      ok: igual(d.s3?.contrato, 0n) && igual(d.s3?.cuenta, SALDO_INICIAL_DEL_DESTINO_STROOPS + MONTO_DEL_PREMIO),
      detalle: `billetera ${ver(d.s3?.contrato)}, destino ${ver(d.s3?.cuenta)} de ${SALDO_INICIAL_DEL_DESTINO_STROOPS + MONTO_DEL_PREMIO}`,
    },
    {
      nombre: "premio-sin-doble-tras-mandar",
      ok: d.c3?.estado === "sin-monedas" && (d.c3?.medidas?.premio ?? null) === null && igual(d.s4?.contrato, 0n),
      detalle: `${ver(d.c3?.estado)}, billetera ${ver(d.s4?.contrato)}`,
    },
    { nombre: "premio-raiz", ok: envio?.raiz === "exacta", detalle: ver(envio?.raiz) },
  ];
  return checks;
}
