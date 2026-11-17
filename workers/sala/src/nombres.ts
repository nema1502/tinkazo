/**
 * Las altas de nombres de una sala, sin depender de Cloudflare. Recibe la función que corre SQL para poder probarse
 * con SQLite en Node. El nombre llega cifrado y acá nunca se descifra.
 *
 * En las salas de la forma 2, el celular manda además una huella del nombre calculada con la clave del QR y una
 * llave propia al azar. La huella del nombre impide repetirlo dentro de esa sala. De la llave se guarda solo su
 * huella SHA-256: identifica al celular para que su nueva alta corrija la anterior en lugar de sumar otra persona.
 * Quien organiza puede quitar la fila y con ella se va esa huella, así que el celular puede anotarse otra vez.
 *
 * Las salas anteriores no cambian de tabla ni de reglas: aceptan el texto plano de siempre y el cuerpo JSON nuevo,
 * del que solo usan `d`. Viven a lo sumo diez horas, así que esta compatibilidad cubre el despliegue.
 */
import { ES_HUELLA_NOMBRE, ES_TOKEN, MAX_NOMBRES, nombreCifradoValido } from "./logica";
import type { Ejecutar } from "./registro";

/** La marca que queda en la tabla `sala` de las salas con una alta por celular y nombres únicos. */
export const FORMA_NOMBRES = "2";
/** Correcciones con cambio de nombre que puede hacer un celular en una sala. Volver a mandar el mismo no cuenta. */
export const MAX_CORRECCIONES = 5;

export interface NombreDeSala {
  n: number;
  d: string;
  /** Los números que este celular tuvo antes y que esta fila reemplaza. */
  r?: number[];
}

export type MensajeDeNombre =
  | { t: "nombre"; n: number; d: string; r?: number[] }
  | { t: "quitado"; n: number };

export type ResultadoDeNombre =
  | { ok: true; n: number; creada: boolean; r?: number[]; avisos: MensajeDeNombre[] }
  | { ok: false; motivo: "forma" | "llena" | "rapido" | "repetido" | "correcciones" };

/** Las tablas de una sala nueva. Las salas viejas no pasan por acá: conservan su tabla de dos columnas. */
export function crearTablasDeNombres(sql: Ejecutar): void {
  sql("CREATE TABLE IF NOT EXISTS nombres (n INTEGER PRIMARY KEY AUTOINCREMENT, d TEXT NOT NULL, h TEXT, llave TEXT, r TEXT)");
  sql("CREATE UNIQUE INDEX IF NOT EXISTS nombres_h_unica ON nombres(h) WHERE h IS NOT NULL");
  sql("CREATE UNIQUE INDEX IF NOT EXISTS nombres_llave_unica ON nombres(llave) WHERE llave IS NOT NULL");
}

interface Alta {
  d: string;
  h?: string;
  llave?: string;
}

/**
 * Lee el texto plano anterior o el JSON nuevo. En una sala vieja solo importa `d`, incluso si el JSON trae campos de
 * más. En una nueva, `h` y `llave` son obligatorios y tienen que tener su forma exacta.
 */
function leerAlta(cuerpo: string, nueva: boolean): Alta | null {
  const texto = cuerpo.trim();
  let x: unknown = texto;
  if (texto.startsWith("{")) {
    try {
      x = JSON.parse(texto);
    } catch {
      return null;
    }
  }
  if (typeof x === "string") return !nueva && nombreCifradoValido(x) ? { d: x } : null;
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.d !== "string" || !nombreCifradoValido(o.d)) return null;
  if (!nueva) return { d: o.d };
  if (typeof o.h !== "string" || !ES_HUELLA_NOMBRE.test(o.h) || typeof o.llave !== "string" || !ES_TOKEN.test(o.llave)) return null;
  return { d: o.d, h: o.h, llave: o.llave };
}

async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Los números guardados en `r`. La escritura es interna; si algo no cuadra no se devuelve una forma distinta. */
function numeros(r: string | null): number[] {
  if (!r) return [];
  try {
    const x = JSON.parse(r) as unknown;
    return Array.isArray(x) ? x.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Anota o corrige un nombre. Desde el cálculo de la huella de la llave hasta las escrituras no hay otra espera:
 * dentro del Durable Object dos altas no pueden cruzarse entre la lectura y el cambio.
 */
export async function anotarNombre(sql: Ejecutar, cuerpo: string, nueva: boolean, porMinuto: () => boolean): Promise<ResultadoDeNombre> {
  const alta = leerAlta(cuerpo, nueva);
  if (!alta) return { ok: false, motivo: "forma" };
  if (!porMinuto()) return { ok: false, motivo: "rapido" };

  if (!nueva) {
    const hay = sql<{ c: number }>("SELECT COUNT(*) AS c FROM nombres")[0]?.c ?? 0;
    if (hay >= MAX_NOMBRES) return { ok: false, motivo: "llena" };
    const n = sql<{ n: number }>("INSERT INTO nombres (d) VALUES (?) RETURNING n", alta.d)[0]?.n;
    if (typeof n !== "number") throw new Error("el alta no devolvió su número");
    return { ok: true, n, creada: true, avisos: [{ t: "nombre", n, d: alta.d }] };
  }

  // Las comprobaciones de `leerAlta` garantizan estos dos campos en una sala nueva.
  const h = alta.h as string;
  const llave = await sha256Hex(alta.llave as string);
  const propia = sql<{ n: number; h: string | null; r: string | null }>("SELECT n, h, r FROM nombres WHERE llave = ?", llave)[0];

  if (propia) {
    // Reintentar con el nombre que ya quedó no cambia nada ni gasta una de las cinco correcciones.
    if (propia.h === h) return { ok: true, n: propia.n, creada: false, avisos: [] };
    const repetida = sql<{ n: number }>("SELECT n FROM nombres WHERE h = ? AND n <> ?", h, propia.n)[0];
    if (repetida) return { ok: false, motivo: "repetido" };
    const anteriores = numeros(propia.r);
    if (anteriores.length >= MAX_CORRECCIONES) return { ok: false, motivo: "correcciones" };
    const r = [...anteriores, propia.n];
    sql("DELETE FROM nombres WHERE n = ?", propia.n);
    const n = sql<{ n: number }>("INSERT INTO nombres (d, h, llave, r) VALUES (?, ?, ?, ?) RETURNING n", alta.d, h, llave, JSON.stringify(r))[0]?.n;
    if (typeof n !== "number") throw new Error("la corrección no devolvió su número");
    return {
      ok: true,
      n,
      creada: false,
      r,
      avisos: [
        { t: "quitado", n: propia.n },
        { t: "nombre", n, d: alta.d, r },
      ],
    };
  }

  const hay = sql<{ c: number }>("SELECT COUNT(*) AS c FROM nombres")[0]?.c ?? 0;
  if (hay >= MAX_NOMBRES) return { ok: false, motivo: "llena" };
  if (sql<{ n: number }>("SELECT n FROM nombres WHERE h = ?", h)[0]) return { ok: false, motivo: "repetido" };
  const n = sql<{ n: number }>("INSERT INTO nombres (d, h, llave) VALUES (?, ?, ?) RETURNING n", alta.d, h, llave)[0]?.n;
  if (typeof n !== "number") throw new Error("el alta no devolvió su número");
  return { ok: true, n, creada: true, avisos: [{ t: "nombre", n, d: alta.d }] };
}

/** Los nombres posteriores a `desde`. Solo la forma nueva tiene columna `r`; la vieja conserva su consulta original. */
export function leerNombres(sql: Ejecutar, desde: number, nueva: boolean): NombreDeSala[] {
  if (!nueva) return sql<NombreDeSala>("SELECT n, d FROM nombres WHERE n > ? ORDER BY n LIMIT ?", desde, MAX_NOMBRES);
  const filas = sql<{ n: number; d: string; r: string | null }>("SELECT n, d, r FROM nombres WHERE n > ? ORDER BY n LIMIT ?", desde, MAX_NOMBRES);
  return filas.map((fila) => {
    const r = numeros(fila.r);
    return { n: fila.n, d: fila.d, ...(r.length ? { r } : {}) };
  });
}
