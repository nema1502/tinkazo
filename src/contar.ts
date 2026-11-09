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
 * que una un paso con el siguiente. Al conectar la cuenta y al sellar va además
 * de qué enlace se llegó (`?o=`: portada, aula, meetup, ruleta, eventos, un
 * comprobante o un video), una palabra de una lista cerrada. Fuera de la cadena no hay forma de seguir
 * a una persona, a propósito (arquitectura de métricas, §4.1). Al compartir,
 * abrir o verificar va la referencia pública del sorteo (red, contrato y
 * número), que ya está en la cadena.
 *
 * Las mismas reglas que `analytics.ts`: solo en tinkazo.app (ni localhost, ni
 * las vistas previas, ni las pruebas), ni desde un navegador automatizado, ni
 * si el navegador pide que no lo sigan. La demo y el ensayo no son uso de
 * verdad: de la práctica sale solo `practice_done` (llegó al ganador),
 * `tutorial_open` (pedir ayuda) y `preview_own_list` (probar con la lista
 * propia). Se manda con `sendBeacon` y un cuerpo de
 * texto: sin consulta previa y sin esperar nada. Si falla, no pasa nada.
 *
 * Es chico y se importa donde se usa, no con `import()`: un paso puede pasar
 * justo antes de irse de la página (el viaje a Google), y `sendBeacon` tiene
 * que salir en ese mismo instante. Los términos lo cuentan en "Y además"
 * (`tmMore2`); si esto cambia, cambian ellos.
 */
import { type ClaveDeError, ERRORES, ERRORES_DEL_PORTERO, type Evento, ORIGENES, type Origen, type PropsDe, type Ref } from "../workers/enlaces/src/conteo";
import { sinGrabar } from "./ensayo-modo";

/**
 * Adónde se manda: el contador del Worker de `workers/enlaces` (ver su README).
 * Vacío, no sale nada.
 *
 * Esta URL solo se sube al sitio después de desplegar el Worker: si el sitio la
 * manda antes, cada conteo cae en el Worker de los enlaces cortos, que lo
 * rechaza, y ese pedido igual cuenta para el tope de 100.000 pedidos por día
 * que la cuenta de Cloudflare comparte con los enlaces. Por eso el orden es
 * Worker, protección de cuota y recién después el sitio.
 *
 * Para apagarlo: vaciarla acá, y en el mismo cambio devolver `tmMore2` y
 * `tmMore4` (es y en, y su texto de respaldo en terminos.html) a lo que decían
 * antes: que todavía no se cuenta nada. Una prueba de `src/contar.test.ts`
 * vigila que los términos y esta URL digan lo mismo.
 */
export const CONTADOR: string = "https://c.tinkazo.app/v1/contar";

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

/** Lo único que sale de la práctica: que llegó al ganador, que alguien pidió ayuda y que probó el show con su lista. */
const DE_LA_PRACTICA: ReadonlySet<Evento> = new Set<Evento>(["practice_done", "tutorial_open", "preview_own_list"]);

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
  return contarUnaVez("account_connected", "account_connected", { kind, from: origenActual() });
}

/* ------------------------------------------------------------------ el sorteo */

/** El motivo del no del portero del patrocinio (`ErrorPortero`, por su forma: este archivo no baja nada más) para la lista cerrada. */
export function motivoContableDelPortero(e: unknown): (typeof ERRORES_DEL_PORTERO)[number] | null {
  const x = e as { name?: unknown; motivo?: unknown; estado?: unknown; razon?: unknown; detalle?: unknown } | null;
  if (!x || typeof x !== "object" || x.name !== "ErrorPortero" || typeof x.motivo !== "string" || typeof x.estado !== "number") return null;
  if (x.razon === "fee-alta") return "fee-alta";
  switch (x.motivo) {
    case "cupo-cuenta":
    case "cupo-ip":
    case "fondo":
    case "apagado":
    case "cuenta-ajena":
    case "no-permitida":
    case "fee-alta":
      return x.motivo;
    case "red":
    case "interno":
      return "portero-red";
    case "cerrado":
      // El servicio no se pudo usar: por qué lo dijo `/cupo`, o que no contestó.
      return x.detalle === "config" ? "config" : x.detalle === "apagado" ? "apagado" : x.detalle === "fondo" ? "fondo" : "portero-red";
    default:
      return null;
  }
}

/**
 * La clave de `errorKey` (`src/stellar/errores.ts`) tal cual, o `unknown` si la lista cerrada no la tiene. Si el error
 * es un no del portero del patrocinio, se cuenta su motivo: la clave de `errorKey` junta varios en una sola frase.
 */
export function errorContable(clave: string, error?: unknown): ClaveDeError {
  const motivo = error === undefined ? null : motivoContableDelPortero(error);
  if (motivo) return motivo;
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
 * Por dónde se abrió un comprobante: la marca `o` que deja el QR (`o=qr`), la
 * página del enlace corto (`o=short`) o el cartel de un video (`o=video`); sin
 * marca, el enlace largo.
 */
export function viaDe(search: string): Via {
  const o = new URLSearchParams(search).get("o");
  return o === "qr" ? "qr" : o === "short" ? "short" : o === "video" ? "video" : "long";
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

/* ------------------------------------------------------------- de dónde se llegó */

const ORIGEN = "tinkazo.origen";

/** Si no hay almacenamiento, el origen vive mientras viva la página. */
let origenEnMemoria: Origen | null = null;

const esOrigen = (x: unknown): x is Origen => typeof x === "string" && (ORIGENES as readonly string[]).includes(x);

/**
 * La marca `?o=` de una dirección, si es una de la lista cerrada (`ORIGENES`). `qr`, `short` y cualquier otra palabra
 * no son un origen: `qr` y `short` dicen por dónde se abrió un comprobante (`viaDe`), no de qué página se llegó.
 */
export function origenDe(search: string): Origen | null {
  const o = new URLSearchParams(search).get("o");
  return esOrigen(o) ? o : null;
}

/**
 * Recuerda de dónde se llegó a esta pestaña, para que el origen siga contando aunque la persona se mueva dentro del
 * sitio. Se llama una vez al abrir la portada. La marca puede viajar dentro de un enlace con `conOrigen` (para no
 * depender de la pestaña, que se pierde al saltar de WhatsApp a Chrome); acá solo se guarda mientras esta pestaña viva. Una marca nueva reemplaza a
 * la anterior. La marca queda en la dirección: las páginas de aula la leen para su ajuste inicial.
 */
export function recordarOrigen(search: string = location.search): Origen | null {
  const o = origenDe(search);
  if (!o) return null;
  origenEnMemoria = o;
  try {
    sessionStorage.setItem(ORIGEN, o);
  } catch {
    /* sin almacenamiento, vale lo que se guardó en memoria */
  }
  return o;
}

/** De dónde se llegó a esta pestaña; `home` si no traía marca. */
export function origenActual(): Origen {
  try {
    const v = sessionStorage.getItem(ORIGEN);
    if (esOrigen(v)) return v;
  } catch {
    /* se sigue con la memoria */
  }
  return origenEnMemoria ?? "home";
}

/** Solo para las pruebas: olvida el origen guardado en memoria. */
export function olvidarOrigen(): void {
  origenEnMemoria = null;
  try {
    sessionStorage.removeItem(ORIGEN);
  } catch {
    /* nada que olvidar */
  }
}

/**
 * La misma dirección con la marca `o=<origen>` antes del `#`, para los enlaces que cambian de navegador ("Abrir en
 * Chrome") o llevan de un comprobante a la herramienta ("Hacer mi sorteo"). Sin `origen`, lleva el de esta pestaña,
 * y si ese es `home` no agrega nada (es lo que se asume sin marca). Reemplaza cualquier marca `o` que ya
 * trajera y deja intacto todo lo demás de la dirección.
 */
export function conOrigen(enlace: string, origen: Origen = origenActual()): string {
  const corte = enlace.indexOf("#");
  const fragmento = corte < 0 ? "" : enlace.slice(corte);
  const base = corte < 0 ? enlace : enlace.slice(0, corte);
  const q = base.indexOf("?");
  const ruta = q < 0 ? base : base.slice(0, q);
  const partes = (q < 0 ? "" : base.slice(q + 1)).split("&").filter((x) => x && !/^o=/.test(x));
  if (origen !== "home") partes.push(`o=${origen}`);
  return `${ruta}${partes.length ? `?${partes.join("&")}` : ""}${fragmento}`;
}
