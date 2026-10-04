/**
 * Comprobante: todo lo necesario para rehacer un sorteo, en un enlace.
 *
 * Va en el fragmento de la URL (después del `#`) por una razón concreta: el
 * fragmento no viaja al servidor. Los nombres de los participantes nunca salen
 * del navegador de quien abre el enlace, ni siquiera a los registros de Vercel.
 *
 * Se comprime con deflate porque una lista de 200 nombres en JSON crudo hace
 * una URL que WhatsApp corta. Si el navegador no trae `CompressionStream`, se
 * guarda sin comprimir y el enlace sigue funcionando, solo más largo.
 */

/** Versión del formato. Sube si cambia la forma, no si cambia el contenido. */
export const PROOF_VERSION = 2;

export interface Proof {
  v: number;
  /** Lista canónica, en orden. Es lo que se vuelve a hashear al verificar. */
  names: string[];
  /** Ronda objetivo de quicknet. */
  round: number;
  /** Premio, si el organizador lo escribió. */
  prize?: string;
  /** Momento del sello (Unix, segundos). */
  sealedAt?: number;
  /** Red de Stellar, si el sorteo quedó anclado. */
  net?: string;
  /** Dirección del contrato. */
  contract?: string;
  /** Id del sorteo en el contrato, como texto porque es un u64. */
  id?: string;
  /**
   * Firma de la ronda, comprimida en hex. Va siempre, esté anclado o no: así
   * la matemática se puede rehacer aunque el RPC no conteste o la entrada se
   * archive. El veredicto verde sigue exigiendo que la cadena atestigüe la lista.
   */
  signature?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function through(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const hasCompression = (): boolean => typeof CompressionStream === "function";

/** Serializa un comprobante al texto que va después del `#`. */
export async function encodeProof(proof: Proof): Promise<string> {
  return encodeFragment(proof);
}

/** Cualquier valor al texto que va después del `#`: comprimido si conviene. */
async function encodeFragment(value: unknown): Promise<string> {
  const json = enc.encode(JSON.stringify(value));
  if (!hasCompression()) return "r" + toBase64Url(json);
  const packed = await through(new Blob([json as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw")));
  // Si comprimir no ayuda (listas muy cortas), se guarda crudo.
  return packed.length < json.length ? "z" + toBase64Url(packed) : "r" + toBase64Url(json);
}

/** Lo contrario de `encodeFragment`. Lanza si el texto no tiene el formato. */
async function decodeFragment(fragment: string): Promise<unknown> {
  const raw = fragment.replace(/^#/, "");
  if (raw.length < 2) throw new Error("proof-empty");
  const kind = raw[0];
  const body = fromBase64Url(raw.slice(1));
  let json: Uint8Array;
  if (kind === "z") {
    if (!hasCompression()) throw new Error("proof-no-decompression");
    json = await through(new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
  } else if (kind === "r") {
    json = body;
  } else {
    throw new Error("proof-unknown-format");
  }
  return JSON.parse(dec.decode(json)) as unknown;
}

/**
 * La lista para revisar antes de sellar.
 *
 * Es la defensa contra inflar la lista: se le muestra a la sala antes del
 * sello, con un QR para que cada uno se busque en su celular. Viaja en el
 * fragmento del enlace, igual que el comprobante, así que no pasa por ningún
 * servidor. No prueba nada por sí sola: lo que la ata al sorteo es que la
 * huella que se sella empiece igual que la que se mostró.
 */
export interface ListPreview {
  v: 1;
  kind: "lista";
  names: string[];
  /** Cuándo se armó la vista, en segundos. */
  at: number;
  prize?: string;
}

/** El enlace a la lista para revisar antes de sellar. */
export async function previewUrl(names: string[], prize = "", base = location.origin): Promise<string> {
  const p: ListPreview = { v: 1, kind: "lista", names, at: Math.floor(Date.now() / 1000), ...(prize ? { prize } : {}) };
  return `${base}/lista.html#${await encodeFragment(p)}`;
}

/** Lee una lista para revisar. Lanza si el enlace no trae una. */
export async function decodePreview(fragment: string): Promise<ListPreview> {
  const v = (await decodeFragment(fragment)) as Partial<ListPreview> | null;
  if (!v || v.kind !== "lista" || !Array.isArray(v.names) || v.names.some((n) => typeof n !== "string")) {
    throw new Error("preview-malformed");
  }
  return v as ListPreview;
}

/** Lee un comprobante. Lanza si el texto no es un comprobante válido. */
export async function decodeProof(fragment: string): Promise<Proof> {
  const parsed = (await decodeFragment(fragment)) as Proof;
  if (!Array.isArray(parsed.names) || typeof parsed.round !== "number") {
    throw new Error("proof-malformed");
  }
  return parsed;
}

/** Enlace completo a la página de verificación. */
export async function proofUrl(proof: Proof, base = location.origin): Promise<string> {
  return `${base}/verificar.html#${await encodeProof(proof)}`;
}

/** El mismo comprobante como archivo, para quien prefiera guardarlo. */
export function proofFile(proof: Proof): Blob {
  return new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" });
}

/** Está anclado en Stellar y por lo tanto se puede leer del contrato. */
export const isAnchored = (p: Proof): boolean => !!(p.net && p.contract && p.id);
