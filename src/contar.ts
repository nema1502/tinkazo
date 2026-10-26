/**
 * El contador del embudo: cuántas veces se usa cada paso del sorteo, nunca quién.
 *
 * Conectar una cuenta, preparar la lista, mostrarla, sellar, sortear,
 * compartir, y que alguien abra el comprobante y lo verifique: cada paso manda
 * a `c.tinkazo.app/v1/contar` el nombre del evento y, a lo sumo, una o dos
 * propiedades de una lista cerrada (`workers/enlaces/src/conteo.ts`, que da
 * también los tipos: lo que no está en la lista no compila). El Worker guarda
 * solo la suma de cada día, y la publica.
 *
 * Lo que nunca sale: nombres, la lista, su huella, la cuenta, la hora, ni nada
 * que una un paso con el siguiente. Fuera de la cadena no hay forma de seguir
 * a una persona, a propósito (arquitectura de métricas, §4.1). Al compartir,
 * abrir o verificar va la referencia pública del sorteo (red, contrato y
 * número), que ya está en la cadena.
 *
 * Las mismas reglas que `analytics.ts`: solo en tinkazo.app (ni localhost, ni
 * las vistas previas, ni las pruebas), ni desde un navegador automatizado, ni
 * si el navegador pide que no lo sigan. La demo y el ensayo no son uso de
 * verdad: de la práctica sale solo `practice_done` (llegó al ganador) y
 * `tutorial_open` (pedir ayuda). Se manda con `sendBeacon` y un cuerpo de
 * texto: sin consulta previa y sin esperar nada. Si falla, no pasa nada.
 *
 * Es chico y se importa donde se usa, no con `import()`: un paso puede pasar
 * justo antes de irse de la página (el viaje a Google), y `sendBeacon` tiene
 * que salir en ese mismo instante. Los términos lo cuentan en "Y además"
 * (`tmMore2`); si esto cambia, cambian ellos.
 */
import { type ClaveDeError, ERRORES, type Evento, type PropsDe, type Ref } from "../workers/enlaces/src/conteo";
import { sinGrabar } from "./ensayo-modo";

/**
 * Adónde se manda. Vacío: no sale nada. Pasa a ser
 * `https://c.tinkazo.app/v1/contar` cuando el Worker esté desplegado con el
 * contador (el despliegue espera el ok de Nicolás; ver
 * `workers/enlaces/README.md`).
 *
 * Al prenderlo (no antes del 3 de noviembre de 2026), en el mismo cambio: la URL
 * acá; `tmMore2` (es y en, y su texto de respaldo en terminos.html) pasa del
 * futuro al presente y deja de decir que hoy no se cuenta nada; y `tmMore4`
 * lleva la fecha de ese día. Mientras esté vacío, los términos dicen que todavía
 * no se cuenta nada, y una prueba de `src/contar.test.ts` lo vigila.
 */
export const CONTADOR: string = "";

const HOST = "tinkazo.app";
/** El tope del Worker, en bytes. Los cuerpos son ASCII: un carácter, un byte. */
const MAX = 512;

let destino = CONTADOR;

/** Solo para las pruebas: otro destino. */
export function probarCon(url: string): void {
  destino = url;
}

type Nav = Pick<Navigator, "doNotTrack"> & { globalPrivacyControl?: boolean; webdriver?: boolean };

/** Si este navegador cuenta: el sitio de verdad, una persona y no un navegador automatizado, y sin pedir lo contrario. */
export function puedeContar(where: Pick<Location, "hostname">, nav: Nav): boolean {
  if (where.hostname !== HOST) return false;
  return nav.globalPrivacyControl !== true && nav.doNotTrack !== "1" && nav.webdriver !== true;
}

/**
 * Lo que pasa en esta pestaña es práctica: la demo (`?demo=`) o el ensayo. Es lo
 * mismo que no grabar (`sinGrabar` de `src/ensayo-modo.ts`, que también recuerda el
 * ensayo en la memoria de la página cuando el almacenamiento no responde).
 */
export function enPractica(): boolean {
  return sinGrabar();
}

/** Lo único que sale de la práctica: que llegó al ganador, y que alguien pidió ayuda. */
const DE_LA_PRACTICA: ReadonlySet<Evento> = new Set<Evento>(["practice_done", "tutorial_open"]);

/** El cuerpo que se manda: `{e, p?, ref?}`, sin nada más. */
export function cuerpo<E extends Evento>(e: E, p: PropsDe<E>, ref?: Ref): string {
  const props = p as Record<string, string>;
  return JSON.stringify({
    e,
    ...(Object.keys(props).length ? { p: props } : {}),
    ...(ref ? { ref: { net: ref.net, contract: ref.contract, id: ref.id } } : {}),
  });
}

function enviar(texto: string): boolean {
  try {
    return typeof navigator.sendBeacon === "function" && navigator.sendBeacon(destino, texto);
  } catch {
    return false;
  }
}

/**
 * Cuenta un paso. Devuelve si salió (o si sale cuando la página se vea, si el
 * navegador la tenía adelantada). Nunca falla.
 */
export function contar<E extends Evento>(e: E, p: PropsDe<E>, ref?: Ref): boolean {
  try {
    if (!destino || !puedeContar(location, navigator)) return false;
    if (enPractica() && !DE_LA_PRACTICA.has(e)) return false;
    const texto = cuerpo(e, p, ref);
    if (texto.length > MAX) return false;
    // Una página adelantada (prerender) todavía no la vio nadie: sale si se muestra.
    const doc = document as Document & { prerendering?: boolean };
    if (doc.prerendering) {
      doc.addEventListener("prerenderingchange", () => void enviar(texto), { once: true });
      return true;
    }
    return enviar(texto);
  } catch {
    return false;
  }
}

/**
 * Lo que ya se contó en esta pestaña, por su clave: vive en `sessionStorage`,
 * no sale del navegador y se va al cerrar la pestaña.
 */
const CONTADOS = "tinkazo.contados";

function contados(): string[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(CONTADOS) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Cuenta un paso una sola vez por pestaña y por `clave`: la primera cuenta
 * conectada, la primera lista, el mismo comprobante abierto otra vez. Si no
 * salió (por las reglas de arriba), no queda anotado.
 */
export function contarUnaVez<E extends Evento>(clave: string, e: E, p: PropsDe<E>, ref?: Ref): boolean {
  const ya = contados();
  if (ya.includes(clave) || !contar(e, p, ref)) return false;
  try {
    sessionStorage.setItem(CONTADOS, JSON.stringify([...ya, clave].slice(-100)));
  } catch {
    /* sin almacenamiento, puede contarse de nuevo al recargar: nada más */
  }
  return true;
}

/* ------------------------------------------------------------------ la cuenta */

const ENTRANDO = "tinkazo.entrando";
/** Lo que puede durar la ida y vuelta a Google. */
const ENTRADA_VIVE_MS = 15 * 60_000;

/**
 * Esta pestaña se va a Google a entrar. Al volver, la sesión se retoma igual
 * que al recargar; esta marca dice que es una cuenta recién conectada.
 */
export function marcarEntrada(): void {
  try {
    sessionStorage.setItem(ENTRANDO, String(Date.now()));
  } catch {
    /* sin almacenamiento, la vuelta no se cuenta */
  }
}

/** Si esta pestaña se fue a Google a entrar hace poco. La marca vale una vez. */
export function tomarEntrada(): boolean {
  try {
    const desde = Number(sessionStorage.getItem(ENTRANDO));
    sessionStorage.removeItem(ENTRANDO);
    return desde > 0 && Date.now() - desde < ENTRADA_VIVE_MS;
  } catch {
    return false;
  }
}

/** La primera cuenta conectada de la pestaña, por la vía. Retomar una sesión no pasa por acá. */
export function contarEntrada(kind: PropsDe<"account_connected">["kind"]): boolean {
  return contarUnaVez("account_connected", "account_connected", { kind });
}

/* ------------------------------------------------------------------ el sorteo */

/** La clave de `errorKey` (`src/stellar/errores.ts`) tal cual, o `unknown` si la lista cerrada no la tiene. */
export function errorContable(clave: string): ClaveDeError {
  return (ERRORES as readonly string[]).includes(clave) ? (clave as ClaveDeError) : "unknown";
}

/** La referencia de un sorteo anclado, si la tiene entera. */
export function refDe(x: { net?: string | undefined; contract?: string | undefined; id?: string | number | bigint | undefined }): Ref | undefined {
  if ((x.net !== "mainnet" && x.net !== "testnet") || !x.contract || x.id === undefined || x.id === "") return undefined;
  return { net: x.net, contract: x.contract, id: String(x.id) };
}

/** La clave de un sorteo para no contar dos veces lo mismo en la pestaña. */
const claveDe = (ref: Ref): string => `${ref.net}:${ref.contract}:${ref.id}`;

/** Que el ensayo o la demo llegaron al ganador: una vez por pestaña. */
export function contarPractica(kind: PropsDe<"practice_done">["kind"]): boolean {
  return contarUnaVez(`practice_done:${kind}`, "practice_done", { kind });
}

/* ------------------------------------------------------ abrir un comprobante */

export type Via = PropsDe<"proof_open">["via"];

/**
 * Por dónde se abrió un comprobante: la marca `o` que deja el QR (`o=qr`) o la
 * página del enlace corto (`o=short`); sin marca, el enlace largo.
 */
export function viaDe(search: string): Via {
  const o = new URLSearchParams(search).get("o");
  return o === "qr" ? "qr" : o === "short" ? "short" : "long";
}

/** Saca la marca de la dirección: si alguien copia el enlace de la barra, no viaja con él. */
export function quitarMarca(): void {
  try {
    const q = new URLSearchParams(location.search);
    if (!q.has("o")) return;
    q.delete("o");
    const s = q.toString();
    history.replaceState(history.state, "", `${location.pathname}${s ? `?${s}` : ""}${location.hash}`);
  } catch {
    /* la marca queda: a lo sumo, otra apertura se cuenta por la misma vía */
  }
}

/** Un comprobante o un enlace corto de este sitio, sin el fragmento. */
const DEL_SITIO = /^https?:\/\/[^/?#]+\/(?:verificar\.html|evento\.html|c\/[0-9A-Za-z]{8})(?:\?[^#]*)?$/;

/**
 * El enlace que va en un QR, con la marca `o=qr` antes del `#`: así la página
 * sabe que se abrió desde el QR. Solo en los comprobantes de este sitio; otro
 * enlace (la ronda del faro, la lista) queda igual. La marca no lleva nada de
 * nadie, y la analítica corta el `?` antes de contar visitas.
 */
export function marcarQr(enlace: string): string {
  const corte = enlace.indexOf("#");
  const base = corte < 0 ? enlace : enlace.slice(0, corte);
  if (!DEL_SITIO.test(base) || /[?&]o=/.test(base)) return enlace;
  return `${base}${base.includes("?") ? "&" : "?"}o=qr${corte < 0 ? "" : enlace.slice(corte)}`;
}

/** Se abrió un comprobante anclado: una vez por pestaña y por sorteo. */
export function contarApertura(via: Via, ref: Ref): boolean {
  return contarUnaVez(`proof_open:${claveDe(ref)}`, "proof_open", { via }, ref);
}

/** Se abrió un enlace de evento: varios sorteos, sin una referencia sola. `clave` evita contarlo dos veces en la pestaña. */
export function contarAperturaDeEvento(via: Via, clave: string): boolean {
  return contarUnaVez(`proof_open:evento:${clave}`, "proof_open", { via });
}

/** Cómo terminó la verificación de un sorteo anclado: una vez por pestaña, sorteo y veredicto. */
export function contarVeredicto(verdict: PropsDe<"proof_verdict">["verdict"], ref: Ref): boolean {
  return contarUnaVez(`proof_verdict:${verdict}:${claveDe(ref)}`, "proof_verdict", { verdict }, ref);
}
