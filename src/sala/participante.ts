import { validarRondaDeSala } from "../../workers/sala/src/logica";
import type { RondaDeSala } from "../../workers/sala/src/logica";
import { listHash, canonicalList } from "../protocol/canonical";
import { select } from "../protocol/select";
import { cifrarNombre, descifrarNombre, generarClave, huellaNombre } from "./cifra";

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
  /** La llave de este celular. Por defecto, la que guarda el navegador para esa sala; en las pruebas, una por celular. */
  llave?: string;
}

/* ----------------------------------------------------------- anotarse */

export type Anotacion = { ok: true; n: number } | { ok: false; motivo: "red" | string };

/** Las llaves de esta pestaña, por sala: valen aunque el navegador no deje guardar nada. */
const LLAVES = new Map<string, string>();
const ES_LLAVE = /^[A-Za-z0-9_-]{22}$/;

/**
 * La llave al azar de este celular para una sala (16 bytes, como la de la página del stand). La sala guarda solo su
 * huella y la usa para saber que una nueva alta del mismo celular corrige la anterior en lugar de sumar a otra persona.
 * Se guarda en el navegador para que valga también después de recargar la página.
 */
function llaveDelCelular(id: string): string {
  const enMemoria = LLAVES.get(id);
  if (enMemoria) return enMemoria;
  const clave = `tk-participante:${id}`;
  let llave: string | null = null;
  try {
    const guardada = localStorage.getItem(clave);
    if (guardada && ES_LLAVE.test(guardada)) llave = guardada;
  } catch {
    /* sin almacenamiento: vale la de esta pestaña */
  }
  if (!llave) {
    llave = generarClave();
    try {
      localStorage.setItem(clave, llave);
    } catch {
      /* sin almacenamiento: vale la de esta pestaña */
    }
  }
  LLAVES.set(id, llave);
  return llave;
}

/**
 * El nombre del participante, cifrado con la clave del QR: el servicio guarda bytes que no puede leer. Va con la huella
 * del nombre (para que no se repita en la sala) y la llave de este celular, que es lo que pide toda sala nueva. La sala
 * contesta 201 cuando entra y 200 cuando el mismo celular vuelve a mandar su nombre o lo corrige: las dos salen bien.
 */
export async function anotarseEnSala(id: string, clave: string, nombre: string, servicio: string, dep: Dependencias = {}): Promise<Anotacion> {
  const f = dep.fetch ?? fetch;
  const d = await cifrarNombre(clave, nombre);
  const h = await huellaNombre(clave, nombre);
  const llave = dep.llave ?? llaveDelCelular(id);
  try {
    const r = await f(`${servicio}/v1/sala/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ d, h, llave }),
    });
    if (r.status === 201 || r.status === 200) {
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
  /**
   * Los números que hay ahora en la sala: si uno de los que ya viste falta, lo quitaron. `null` si el servicio no los
   * manda: entonces no se puede saber a quién quitaron, pero el resto de la vista sigue igual.
   */
  ns: number[] | null;
  /** Los nombres cifrados que cambiaron desde la última consulta. */
  nombres: { n: number; d: string }[];
}

/**
 * Lo que hay en la sala ahora: un pedido, sin token. `"no-existe"` si la sala contesta que ya no está (se cerró o
 * venció), y `null` si el pedido falló de otra forma (sin red, un error del servicio, una respuesta que no se entiende):
 * eso puede pasar una vez y no dice que la sala se haya cerrado.
 */
export async function leerVivo(id: string, desde: number, servicio: string, dep: Dependencias = {}): Promise<Vivo | "no-existe" | null> {
  try {
    const r = await (dep.fetch ?? fetch)(`${servicio}/v1/sala/${id}/vivo?desde=${desde}`);
    if (r.status === 404 || r.status === 410) return "no-existe";
    if (!r.ok) return null;
    const v = (await r.json()) as Partial<Vivo>;
    if (typeof v.hay !== "number" || (v.estado !== "abierta" && v.estado !== "cerrada") || !Array.isArray(v.nombres)) return null;
    const ns = Array.isArray(v.ns) ? v.ns.filter((n): n is number => typeof n === "number") : null;
    return { hay: v.hay, estado: v.estado, ronda: v.ronda ? validarRondaDeSala(v.ronda) : null, ns, nombres: v.nombres };
  } catch {
    return null;
  }
}

/** Cuántos pedidos fallidos seguidos aguanta el celular antes de dar la sala por perdida. */
export const FALLOS_ANTES_DE_RENDIRSE = 5;

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
  let fallos = 0;

  const mismaRonda = (a: RondaViva, b: RondaViva): boolean => a.r === b.r && a.k === b.k && a.randomness === b.randomness && a.listHash === b.listHash;

  const mirar = async (): Promise<void> => {
    if (parado) return;
    const v = await leerVivo(id, desde, servicio, dep);
    if (parado) return;
    if (v === "no-existe") {
      // La sala contestó que ya no está: se cerró o venció, y eso no vuelve.
      parado = true;
      e.alVencida?.();
      return;
    }
    if (v === null) {
      // Un corte de red o un error suelto no saca a nadie: se vuelve a pedir, y recién tras varios seguidos se deja.
      fallos++;
      if (fallos >= FALLOS_ANTES_DE_RENDIRSE) {
        parado = true;
        e.alVencida?.();
        return;
      }
      sondeo = poner(mirar, SONDEO_PARTICIPANTE_MS);
      return;
    }
    fallos = 0;
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
    // Un nombre que ya se avisó y ya no está: lo quitaron (el filtro de la pantalla, o a mano). Sin la lista de números
    // de la sala no hay cómo saberlo, y no se quita a nadie. Va antes de la ronda: la pantalla quita lo que no sella justo
    // antes de compartirla, y si la ronda llegara primero el celular la calcularía con un nombre de más.
    if (v.ns) {
      const ahora = new Set(v.ns);
      for (const n of vistos) {
        if (!ahora.has(n)) {
          vistos.delete(n);
          e.alQuitado?.(n);
        }
      }
    }
    if (v.ronda && (!ultimaRonda || !mismaRonda(ultimaRonda, v.ronda))) {
      ultimaRonda = v.ronda;
      e.alRonda?.(v.ronda);
    }
    if (v.estado === "cerrada" && !cerrada) {
      cerrada = true;
      e.alCierre?.();
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

/**
 * Los nombres que ve el celular en el orden en que entraron a la sala (por su número), que es el orden con el que la
 * pantalla sella. El celular los junta de a pedazos: su propio nombre lo pone apenas la sala lo acepta, antes de que el
 * sondeo traiga a quienes entraron un instante antes. La huella depende del orden, así que el de llegada no sirve.
 */
export function listaEnOrden(nombres: ReadonlyMap<number, string>): string[] {
  return [...nombres.entries()].sort((a, b) => a[0] - b[0]).map(([, nombre]) => nombre);
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
