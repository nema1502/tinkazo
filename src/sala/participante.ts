import { validarRondaDeSala } from "../../workers/sala/src/logica";
import type { RondaDeSala } from "../../workers/sala/src/logica";
import { listHash, canonicalList } from "../protocol/canonical";
import { select } from "../protocol/select";
import { cifrarNombre, descifrarNombre } from "./cifra";

/**
 * El participante de los juegos interactivos, visto desde su celular: entra por el QR de la sala
 * (el enlace de siempre, con la clave después del `#`), se anota con su nombre, ve la lista en vivo
 * y, cuando la pantalla comparte la ronda que decide, calcula su resultado personal.
 *
 * A diferencia de la pantalla (`cliente.ts`), el participante no tiene el token de la sala: solo lee
 * `GET /vivo` (nombres cifrados, estado y ronda compartida) y manda su nombre cifrado. La clave del
 * QR descifra los nombres acá, en el navegador, igual que en la pantalla: el servicio no puede leerlos.
 */

/** Cada cuánto el celular consulta la sala mientras no hay WebSocket para él. */
export const SONDEO_PARTICIPANTE_MS = 3_000;

export type RondaViva = RondaDeSala;

/** El estado del flujo, tal como lo cuenta la sala. */
export type EstadoDeLaLista = "abierta" | "cerrada";

export interface Dependencias {
  fetch?: typeof fetch;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/* ----------------------------------------------------------- anotarse */

export type Anotacion = { ok: true; n: number } | { ok: false; motivo: "red" | string };

/** El nombre del participante, cifrado con la clave del QR: el servicio guarda bytes que no puede leer. */
export async function anotarseEnSala(id: string, clave: string, nombre: string, servicio: string, dep: Dependencias = {}): Promise<Anotacion> {
  const f = dep.fetch ?? fetch;
  const d = await cifrarNombre(clave, nombre);
  try {
    const r = await f(`${servicio}/v1/sala/${id}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: d });
    if (r.status === 201) {
      const { n } = (await r.json()) as { n: number };
      return { ok: true, n };
    }
    const motivo = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "otro";
    return { ok: false, motivo };
  } catch {
    return { ok: false, motivo: "red" };
  }
}

/* ------------------------------------------------------------- el vivo */

export interface Vivo {
  hay: number;
  estado: EstadoDeLaLista;
  /** La ronda compartida que decide, o `null` si la pantalla todavía no la mandó. */
  ronda: RondaViva | null;
  /** Los números que hay ahora en la sala: si uno de los que ya viste falta, lo quitaron. */
  ns: number[];
  /** Los nombres cifrados que cambiaron desde la última consulta. */
  nombres: { n: number; d: string }[];
}

/** Lo que hay en la sala ahora: un pedido, sin token. `null` si la sala ya no está o no contesta. */
export async function leerVivo(id: string, desde: number, servicio: string, dep: Dependencias = {}): Promise<Vivo | null> {
  try {
    const r = await (dep.fetch ?? fetch)(`${servicio}/v1/sala/${id}/vivo?desde=${desde}`);
    if (!r.ok) return null;
    const v = (await r.json()) as Partial<Vivo>;
    if (typeof v.hay !== "number" || (v.estado !== "abierta" && v.estado !== "cerrada") || !Array.isArray(v.nombres) || !Array.isArray(v.ns)) return null;
    return { hay: v.hay, estado: v.estado, ronda: v.ronda ? validarRondaDeSala(v.ronda) : null, ns: v.ns, nombres: v.nombres };
  } catch {
    return null;
  }
}

export interface EscuchaDeParticipante {
  /** Llegó un nombre que esta clave sí descifra (nuevo, o al volver a pedir los que ya había). Cada `n` se avisa una sola vez. */
  alNombre: (n: number, nombre: string) => void;
  /** Un nombre que ya había se quitó de la sala: la lista del celular tiene que quedarse igual a la que se sella. */
  alQuitado?: (n: number) => void;
  /** La ronda que decide cambió (por primera vez, o la pantalla volvió a compartirla). */
  alRonda?: (r: RondaViva) => void;
  /** La lista quedó cerrada: ya no entra nadie. */
  alCierre?: () => void;
  /** La sala se cerró o venció: no hay más que mirar. */
  alVencida?: () => void;
}

/**
 * Sigue la sala desde el celular: consulta cada 3 s lo que cambia y avisa los nombres descifrados
 * (los de otra clave no se muestran), la ronda compartida y el cierre de la lista. Devuelve cómo parar.
 */
export function seguirVivo(id: string, clave: string, servicio: string, e: EscuchaDeParticipante, dep: Dependencias = {}): { parar: () => void } {
  const poner = dep.setTimeout ?? setTimeout;
  const sacar = dep.clearTimeout ?? clearTimeout;
  let parado = false;
  let desde = 0;
  const vistos = new Set<number>();
  let ultimaRonda: RondaViva | null = null;
  let cerrada = false;
  let sondeo: ReturnType<typeof setTimeout> | undefined;

  const mismaRonda = (a: RondaViva, b: RondaViva): boolean => a.r === b.r && a.k === b.k && a.randomness === b.randomness && a.listHash === b.listHash;

  const mirar = async (): Promise<void> => {
    if (parado) return;
    const v = await leerVivo(id, desde, servicio, dep);
    if (parado) return;
    if (v === null) {
      // Sin respuesta buena: la sala se cerró (404), venció o no hay red. Un 404 no vuelve.
      parado = true;
      e.alVencida?.();
      return;
    }
    for (const { n, d } of v.nombres) {
      // Los que ya se avisaron no vuelven (el cursor manda, y un pedido repetido no repite el aviso).
      if (vistos.has(n)) continue;
      const nombre = await descifrarNombre(clave, d);
      if (parado) return;
      if (nombre === null) continue;
      vistos.add(n);
      desde = Math.max(desde, n);
      e.alNombre(n, nombre);
    }
    if (v.ronda && (!ultimaRonda || !mismaRonda(ultimaRonda, v.ronda))) {
      ultimaRonda = v.ronda;
      e.alRonda?.(v.ronda);
    }
    if (v.estado === "cerrada" && !cerrada) {
      cerrada = true;
      e.alCierre?.();
    }
    // Un nombre que ya se avisó y ya no está: lo quitaron (el filtro de la pantalla, o a mano).
    const ahora = new Set(v.ns);
    for (const n of vistos) {
      if (!ahora.has(n)) {
        vistos.delete(n);
        e.alQuitado?.(n);
      }
    }
    if (!parado) sondeo = poner(mirar, SONDEO_PARTICIPANTE_MS);
  };

  void mirar();
  return {
    parar: (): void => {
      parado = true;
      sacar(sondeo);
    },
  };
}

/* --------------------------------------------------- el enlace del QR */

/** Lo que viaja en el enlace del participante: la sala y la clave del QR, en el fragmento. */
export interface DatosParticipante {
  id: string;
  clave: string;
}

const VERSION_ENLACE = 1;

function aB64url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * El enlace que lleva el QR de la sala para los celulares: esta misma página del sitio, con el id
 * y la clave en el fragmento (que ningún navegador manda a un servidor). La clave es la misma del
 * QR del stand: con ella el celular descifra los nombres de la lista.
 */
export function enlaceDeParticipante(d: DatosParticipante, origen = location.origin): string {
  return `${origen}/#participante=${aB64url(JSON.stringify({ v: VERSION_ENLACE, ...d }))}`;
}

/** Los datos que trae el fragmento `#participante=…`, o `null` si no es ese enlace o está roto. */
export function datosDeParticipante(hash: string = location.hash): DatosParticipante | null {
  const m = /^#participante=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    const j = JSON.parse(deB64url(m[1])) as Partial<DatosParticipante> & { v?: unknown };
    if (j.v !== VERSION_ENLACE) return null;
    if (typeof j.id !== "string" || !/^[0-9A-Za-z]{8}$/.test(j.id)) return null;
    if (typeof j.clave !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(j.clave)) return null;
    return { id: j.id, clave: j.clave };
  } catch {
    return null;
  }
}

/* -------------------------------------------------- el resultado personal */

/** El nombre sin distinguir mayúsculas ni espacios de más (la misma normalización de la pantalla del stand). */
function claveDe(nombre: string): string {
  return nombre.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function bytesDeHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export type ResultadoPersonal = "te-toco" | "no-gano" | "lista-distinta";

/**
 * Quienes salieron, con el mismo select del protocolo, o `null` si la lista del celular (los nombres
 * que descifró de la sala, en el orden en que entraron) no es exactamente la que se selló — la huella
 * compartida lo comprueba. Si no cuadra, o la ronda está mal formada, no hay ganadores que mostrar:
 * la vista nunca inventa un resultado.
 */
export function ganadoresDe(nombres: string[], ronda: RondaViva): string[] | null {
  const lista = canonicalList(nombres.join("\n"));
  if (lista.length < 2) return null;
  const hash = listHash(lista);
  const hashHex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hashHex !== ronda.listHash) return null;
  const randomness = bytesDeHex(ronda.randomness);
  if (!randomness || ronda.k < 1 || ronda.k > lista.length) return null;
  let idx: number[];
  try {
    idx = select(randomness, hash, lista.length, ronda.k);
  } catch {
    return null;
  }
  return idx.map((i) => lista[i] as string);
}

/**
 * «Me tocó» o «no ganó», con los mismos ganadores que ve cualquiera: si la lista no cuadra con la
 * que se selló, no afirma nada.
 */
export function resultadoPersonal(nombres: string[], ronda: RondaViva, miNombre: string): ResultadoPersonal {
  const ganadores = ganadoresDe(nombres, ronda);
  if (!ganadores) return "lista-distinta";
  const mios = claveDe(miNombre);
  return ganadores.some((g) => claveDe(g) === mios) ? "te-toco" : "no-gano";
}
