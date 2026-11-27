import { Account, Keypair, MuxedAccount, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { NOTA_DE_PRUEBA, SALDO_INICIAL_DEL_DESTINO } from "./premio";
import { INCLUSION_BASE, RED_DE_PRUEBA } from "./red";
import { VIDA_DEL_SOBRE_S } from "./transacciones";

/**
 * A dónde se mandan las monedas de prueba. El destino sale del enlace de la página o lo arma la página en el momento: una
 * cuenta de prueba que pide nota. Desde una cuenta de contrato la nota no puede ser un texto: tiene que ser un número de 64
 * bits, y viaja dentro de una dirección M.
 */

export type TipoDeDestino = "G" | "M" | "C";

/** Lo que trae el enlace. */
export interface DestinoPedido {
  direccion: string;
  nota: bigint | null;
}

/** Su presencia es el modo premio de la página. */
export interface OpcionesDePremio {
  destino: DestinoPedido | null;
}

export interface Destino {
  /** Lo que va en la transferencia: la G, la M o la C. */
  hacia: string;
  /** La G o la C de abajo. */
  base: string;
  tipo: TipoDeDestino;
  nota: bigint | null;
  /** Los últimos cuatro caracteres de `base`. */
  fin: string;
  origen: "pagina" | "enlace";
}

export const NOTA_MAXIMA = 18_446_744_073_709_551_615n;

export type PedidoLeido = { ok: true; premio: OpcionesDePremio | null } | { ok: false; motivo: "destino" | "nota" };

/**
 * Lo que pide la dirección de la página. Sin `modo=premio` no se lee nada más. Un destino mal escrito o una nota que no entra
 * dan un error: nunca se adivina ni se arregla nada.
 */
export function leerPedidoDePremio(search: string): PedidoLeido {
  const q = new URLSearchParams(search);
  if (q.get("modo") !== "premio") return { ok: true, premio: null };
  const direccion = q.get("destino");
  const textoDeNota = q.get("nota");
  if (direccion === null) {
    return textoDeNota === null ? { ok: true, premio: { destino: null } } : { ok: false, motivo: "nota" };
  }
  const esG = StrKey.isValidEd25519PublicKey(direccion);
  const esM = StrKey.isValidMed25519PublicKey(direccion);
  const esC = StrKey.isValidContract(direccion);
  if (!esG && !esM && !esC) return { ok: false, motivo: "destino" };
  if (textoDeNota === null) return { ok: true, premio: { destino: { direccion, nota: null } } };
  if (!esG || !/^\d{1,20}$/.test(textoDeNota)) return { ok: false, motivo: "nota" };
  const nota = BigInt(textoDeNota);
  if (nota < 1n || nota > NOTA_MAXIMA) return { ok: false, motivo: "nota" };
  return { ok: true, premio: { destino: { direccion, nota } } };
}

/** La misma ruta en el modo premio y sin destino: solo conserva la lengua. */
export function rutaSinDestino(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  const nuevo = new URLSearchParams({ modo: "premio" });
  const lang = q.get("lang");
  if (lang) nuevo.set("lang", lang);
  return `${pathname}?${nuevo.toString()}`;
}

/** La dirección M de una G con un número de nota. */
export function direccionConNota(g: string, nota: bigint): string {
  return new MuxedAccount(new Account(g, "0"), nota.toString()).accountId();
}

/** El destino del enlace, o `a-si-misma` si es la propia cuenta. */
export function destinoDelEnlace(pedido: DestinoPedido, propia: string): Destino | { motivo: "a-si-misma" } {
  const d = pedido.direccion;
  if (StrKey.isValidMed25519PublicKey(d)) {
    const m = MuxedAccount.fromAddress(d, "0");
    const base = m.baseAccount().accountId();
    return { hacia: d, base, tipo: "M", nota: BigInt(m.id()), fin: base.slice(-4), origen: "enlace" };
  }
  if (StrKey.isValidContract(d)) {
    if (d === propia) return { motivo: "a-si-misma" };
    return { hacia: d, base: d, tipo: "C", nota: null, fin: d.slice(-4), origen: "enlace" };
  }
  if (pedido.nota !== null) {
    return { hacia: direccionConNota(d, pedido.nota), base: d, tipo: "M", nota: pedido.nota, fin: d.slice(-4), origen: "enlace" };
  }
  return { hacia: d, base: d, tipo: "G", nota: null, fin: d.slice(-4), origen: "enlace" };
}

/** El destino que arma la página: una cuenta de prueba que pide nota, con la nota de prueba. */
export function destinoDeLaPagina(g: string): Destino {
  return { hacia: direccionConNota(g, NOTA_DE_PRUEBA), base: g, tipo: "M", nota: NOTA_DE_PRUEBA, fin: g.slice(-4), origen: "pagina" };
}

/**
 * Crea la cuenta de prueba y le pone la marca de que pide nota. La marca es la que miran los servicios que pagan a otras
 * cuentas. La segunda operación la firma la cuenta nueva y la primera quien manda la transacción.
 */
export function armarCuentaQuePideNota(o: { origen: string; secuencia: string; destino: string }): string {
  return new TransactionBuilder(new Account(o.origen, o.secuencia), { fee: INCLUSION_BASE, networkPassphrase: RED_DE_PRUEBA.passphrase })
    .addOperation(Operation.createAccount({ destination: o.destino, startingBalance: SALDO_INICIAL_DEL_DESTINO }))
    .addOperation(Operation.manageData({ source: o.destino, name: "config.memo_required", value: "1" }))
    .setTimeout(VIDA_DEL_SOBRE_S)
    .build()
    .toXDR();
}

/** La llave de la cuenta de destino. Vive solo en memoria: las monedas que llegan ahí no las toca nadie después. */
export interface LlaveDeDestino {
  publica: string;
  /** Agrega su firma a una transacción en base64 y la devuelve en base64. */
  firmar(txXdr: string): string;
}

export function llaveDeDestinoNueva(): LlaveDeDestino {
  const par = Keypair.random();
  return {
    publica: par.publicKey(),
    firmar(txXdr: string): string {
      const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase);
      tx.sign(par);
      return tx.toXDR();
    },
  };
}

/**
 * Si una cuenta pide nota para recibir, según el historial de la red de prueba. `null` si no se pudo saber: una cuenta recién
 * creada puede no estar todavía, o el historial no contestar.
 */
export async function pideNota(cuenta: string, o: { fetchFn?: typeof fetch; topeMs?: number } = {}): Promise<boolean | null> {
  const f = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  try {
    const res = await f(`${RED_DE_PRUEBA.horizon}/accounts/${encodeURIComponent(cuenta)}`, { signal: AbortSignal.timeout(o.topeMs ?? 8_000) });
    if (res.status !== 200) return null;
    const c = (await res.json()) as { data?: Record<string, unknown> };
    return c.data?.["config.memo_required"] === "MQ==";
  } catch {
    return null;
  }
}
