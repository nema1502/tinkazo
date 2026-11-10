import { candidataDe, esEleccion, PERFIL_BASE, PIEZAS, type CandidataMusica, type Eleccion, type PerfilMusica, type Pieza } from "./carrera";
import { BOMBO_Y_BAJO, ELEGIDAS } from "./carrera-elegidas";

/**
 * Qué candidata de la carrera suena en cada pieza.
 *
 * Es la elección de `carrera-elegidas.ts` (la que se eligió escuchando), y nada más, salvo en una prueba: con `?auditar=...` en la
 * dirección, `?sonido=pasos:b,musica:a` hace sonar esas candidatas para que los auditores de sonido y de mezcla las
 * midan en la carrera de verdad, o para ensayar con el parlante del stand. Sin `?auditar` la dirección no cambia
 * nada, así que nadie en producción oye otra cosa que lo elegido. Solo la carrera: los otros juegos no consultan nada.
 *
 * Es puro: no toca el audio. El juego que suena se avisa con `avisarJuego` (desde `sonidoDelJuego`).
 */

let enCarrera = false;

/** El juego que va a sonar: solo la carrera (`race`) tiene candidatas. */
export function avisarJuego(juego: string | null): void {
  enCarrera = juego === "race";
}

/** Lo que pide la dirección: `?sonido=pieza:eleccion,pieza:eleccion`, y solo si trae `?auditar`. */
export function pedidoDeLaDireccion(busqueda: string): Partial<Record<Pieza, Eleccion>> {
  const q = new URLSearchParams(busqueda);
  if (q.get("auditar") === null) return {};
  const out: Partial<Record<Pieza, Eleccion>> = {};
  for (const par of (q.get("sonido") ?? "").split(",")) {
    const [pieza, e] = par.split(":");
    if (pieza && e && (PIEZAS as readonly string[]).includes(pieza) && esEleccion(e)) out[pieza as Pieza] = e;
  }
  return out;
}

let pedido: Partial<Record<Pieza, Eleccion>> | null = null;
const delPedido = (): Partial<Record<Pieza, Eleccion>> => {
  if (pedido) return pedido;
  let busqueda = "";
  try {
    busqueda = typeof location !== "undefined" ? location.search : "";
  } catch {
    busqueda = "";
  }
  pedido = pedidoDeLaDireccion(busqueda);
  return pedido;
};

/** Para las pruebas: vuelve a leer la dirección o fija un pedido. */
export function reiniciarPedido(p: Partial<Record<Pieza, Eleccion>> | null = null): void {
  pedido = p;
}

/** `base` (lo de hoy con el arreglo nuevo) solo lo leen la música y el final: en las demás piezas no reemplaza ningún sonido. */
const usaBase = (pieza: Pieza): boolean => pieza === "musica" || pieza === "final";

/** La elección de una pieza: `hoy` si el juego que suena no es la carrera, o si pide `base` en una pieza que no lo usa. */
export function eleccionDe(pieza: Pieza): Eleccion {
  if (!enCarrera) return "hoy";
  const e = delPedido()[pieza] ?? ELEGIDAS[pieza];
  return e === "base" && !usaBase(pieza) ? "hoy" : e;
}

/** Una de las tres candidatas (no `hoy` ni `base`). */
const esCandidata = (e: Eleccion): boolean => e === "a" || e === "b" || e === "c";

/** El arreglo de la música de la carrera, o `null` si suena la de siempre. */
export function perfilDeMusica(): PerfilMusica | null {
  const e = eleccionDe("musica");
  if (e === "hoy") return null;
  if (e === "base") return PERFIL_BASE;
  return (candidataDe("musica", e) as CandidataMusica | undefined)?.perfil ?? null;
}

/** `true` si el golpe del ganador es el de una candidata (o el de hoy con el arreglo del parlante, en "ninguno") y no el de siempre. */
export const golpePropio = (): boolean => enCarrera && (esCandidata(eleccionDe("final")) || eleccionDe("final") === "base");

/** `true` si el festejo es el de una candidata y no el de siempre. */
export const festejoPropio = (): boolean => enCarrera && esCandidata(eleccionDe("festejo"));

/**
 * `true` si la carrera suena con alguna candidata: entonces la mezcla lleva un techo (ver `destinoDeMezcla` en `src/sound.ts`).
 * Cuentan solo las elecciones que de verdad reemplazan un sonido (`eleccionDe` ya trata como `hoy` un `base` fuera de la música y el final).
 */
export const hayCandidatas = (): boolean => enCarrera && PIEZAS.some((p) => eleccionDe(p) !== "hoy");

/**
 * `true` si se eligió escuchando la mezcla del bombo y del bajo para parlante chico (`carrera-elegidas.ts`). Entonces vale
 * en la música de los diez juegos, con o sin candidatas. Mientras no elija, esa mezcla solo suena con el arreglo de una
 * candidata de la carrera y todo lo demás suena como antes.
 */
export const bomboYBajoChico = (): boolean => BOMBO_Y_BAJO === "chico";

/** `true` si el final trae su propio silencio: el bombo que crece, el clic y el corte de la banda antes del golpe. */
export const finalPropio = (): boolean => enCarrera && eleccionDe("final") !== "hoy";
