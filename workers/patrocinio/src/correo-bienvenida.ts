/**
 * El correo de bienvenida de la red principal: el texto, el HTML y el mensajero que lo entrega con el enlace de envío de
 * Cloudflare. Sin red, sin reloj propio y sin importar nada: lo usan el objeto del portero, las pruebas y el guion que
 * escribe los archivos para mirarlos a tamaño real (`ver-correo-bienvenida.mjs`, con Node y sin compilar).
 *
 * Qué no hace: no guarda la dirección ni el nombre, no los escribe en el registro ni en un error y no los devuelve. El
 * mensajero devuelve solo si salió o el código fijo del error de Cloudflare (`E_DAILY_LIMIT_EXCEEDED`): el mensaje de un
 * error puede traer la dirección, así que nunca se mira.
 *
 * Las copias chicas de `esCorreo`, `limpiarTexto` y `escaparHtml` son las de la sala (`workers/sala/src/correo.ts`): la
 * sala no se toca y los dos Workers no comparten código.
 */

export type IdiomaDelCorreo = "es" | "en";

/** Lo que se manda: el asunto, el texto plano y la misma carta en HTML. */
export interface ContenidoDelCorreo {
  asunto: string;
  texto: string;
  html: string;
}

/** Lo que cambia de un correo a otro. El nombre es opcional: sin nombre, el saludo va solo. */
export interface DatosDeBienvenida {
  nombre: string | null;
  /** Los sorteos oficiales del regalo, los del derecho que se dio. */
  sorteos: number;
  /** Hasta cuándo valen, en ms: el vencimiento del derecho. */
  vence: number;
}

/** El enlace de envío de Cloudflare (`[[send_email]]`), con la forma que usa este Worker. */
export interface EnlaceDeCorreo {
  send(mensaje: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  }): Promise<unknown>;
}

/** Cómo terminó un envío: salió, o el código fijo del error (nunca su mensaje). */
export type ResultadoDelEnvio = { ok: true } | { ok: false; codigo: string };

/** Quien manda el correo. La implementación real habla con el enlace de envío del Worker; las pruebas, con uno de mentira. */
export interface Mensajero {
  mandar(para: string, contenido: ContenidoDelCorreo): Promise<ResultadoDelEnvio>;
}

/** La entrada al sitio en la red principal, sin nada que rastree. */
export const ENLACE_OFICIAL = "https://tinkazo.app/?red=oficial";
/** El nombre que ve la persona como remitente. La dirección es la de `CORREO_DE`, del dominio habilitado para el envío. */
export const NOMBRE_DEL_REMITENTE = "Tinkazo";
/** Lo más que se espera al enlace de envío por un correo. */
export const TOPE_ENVIO_MS = 10_000;
/** Lo más largo que se acepta del nombre de pila. */
export const MAX_NOMBRE = 40;
/** La zona de la fecha del correo: la de quien organiza en Bolivia, como el sitio. */
const ZONA = "America/La_Paz";

/** Una dirección con forma de correo, sin espacios, comas, comillas ni signos que armen otro destinatario o una cabecera. */
const ES_CORREO = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/u;

export function esCorreo(x: unknown): x is string {
  if (typeof x !== "string" || x.length > 254 || !ES_CORREO.test(x)) return false;
  // Sin punto al principio ni al final de la parte local, y sin dos puntos seguidos: no son direcciones que se entreguen.
  const local = x.slice(0, x.indexOf("@"));
  return !local.startsWith(".") && !local.endsWith(".") && !x.includes("..");
}

/**
 * Deja un texto de una sola línea y sin nada que no se vea: los controles y los separadores de línea pasan a espacio, los
 * invisibles y los que cambian el sentido de lectura se quitan, y los espacios se juntan. Con tope de largo.
 */
export function limpiarTexto(x: unknown, maximo: number): string {
  if (typeof x !== "string") return "";
  const limpio = x
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[\p{Cf}\p{Co}\p{Cs}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(limpio).slice(0, maximo).join("").trim();
}

/** El texto listo para ir dentro de HTML. */
export function escaparHtml(x: string): string {
  return x.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}

/**
 * Las palabras del correo. Cortas, sin punto y coma, sin exclamaciones, sin comillas angulares y sin palabras técnicas. Sin
 * el nombre de ningún proveedor ni aliado. En inglés, draw.
 */
const PALABRAS = {
  es: {
    asunto: "Tu cuenta oficial de Tinkazo está lista",
    saludo: "Hola {nombre}.",
    saludoSinNombre: "Hola.",
    lista: "Tu cuenta oficial está lista. Tenés {cuantos} hasta el {fecha}.",
    uno: "1 sorteo gratis",
    varios: "{n} sorteos gratis",
    boton: "Organizar mi primer sorteo",
    gratis: "Participar y comprobar es gratis, siempre.",
    ajeno: "Si no fuiste vos, ignorá este correo.",
  },
  en: {
    asunto: "Your Tinkazo Live account is ready",
    saludo: "Hi {nombre}.",
    saludoSinNombre: "Hi.",
    lista: "Your Live account is ready. You have {cuantos} until {fecha}.",
    uno: "1 free draw",
    varios: "{n} free draws",
    boton: "Run my first draw",
    gratis: "Taking part and checking are always free.",
    ajeno: "If this wasn't you, ignore this email.",
  },
} as const;

/** Reemplaza cada `{clave}` por su valor. Con función, para que un `$` en el valor no se interprete. */
function llenar(plantilla: string, valores: Record<string, string>): string {
  return plantilla.replace(/\{(\w+)\}/gu, (marca, clave: string) => valores[clave] ?? marca);
}

/** Hasta cuándo valen los sorteos de un regalo dado ahora: los días de la configuración, en ms. */
export function venceDelRegalo(ahora: number, dias: number): number {
  return ahora + dias * 86_400_000;
}

/** La fecha como la lee una persona, en la zona de Bolivia: 19 de enero de 2027, o January 19, 2027. */
export function fechaDelCorreo(ms: number, idioma: IdiomaDelCorreo): string {
  const forma: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric", timeZone: ZONA };
  return new Intl.DateTimeFormat(idioma === "es" ? "es-BO" : "en-US", forma).format(new Date(ms));
}

/** Las frases de un idioma, ya llenas. El nombre ya viene limpio. */
function frases(idioma: IdiomaDelCorreo, nombre: string, datos: DatosDeBienvenida) {
  const p = PALABRAS[idioma];
  const n = Math.max(1, Math.floor(datos.sorteos));
  const cuantos = n === 1 ? p.uno : llenar(p.varios, { n: String(n) });
  return {
    asunto: p.asunto,
    saludo: nombre === "" ? p.saludoSinNombre : llenar(p.saludo, { nombre }),
    lista: llenar(p.lista, { cuantos, fecha: fechaDelCorreo(datos.vence, idioma) }),
    cuantos,
    boton: p.boton,
    gratis: p.gratis,
    ajeno: p.ajeno,
  };
}

type Frases = ReturnType<typeof frases>;

function textoPlano(f: Frases): string {
  return [f.saludo, "", f.lista, "", `${f.boton}:`, ENLACE_OFICIAL, "", f.gratis, "", f.ajeno].join("\n");
}

/** Los colores del tema claro de la marca (`docs/marca.md`), con tinta sobre el amarillo del botón. */
const TINTA = "#191919";
const TINTA_2 = "#4b4437";
const PAPEL = "#fff6e9";
const MAGENTA = "#e93d9c";
const AMARILLO = "#ffc629";

/** Una tarjeta del correo, en un idioma. Todo lo que cambia va escapado. */
function tarjeta(idioma: IdiomaDelCorreo, f: Frases, separada: boolean): string {
  const parrafo = "font-size:17px;line-height:1.5;margin:0 0 16px;";
  const caja =
    `max-width:480px;margin:${separada ? "24px" : "0"} auto 0;background:#ffffff;border:3px solid ${TINTA};` +
    `border-radius:12px;box-shadow:6px 6px 0 ${TINTA};padding:24px;`;
  const boton =
    `display:inline-block;padding:16px 28px;background:${AMARILLO};color:${TINTA};border:3px solid ${TINTA};border-radius:10px;` +
    `box-shadow:3px 3px 0 ${TINTA};font-size:18px;font-weight:bold;text-decoration:none;`;
  // La cifra de sorteos va en negrita: es lo que la persona busca con la vista.
  const lista = escaparHtml(f.lista).replace(escaparHtml(f.cuantos), `<strong>${escaparHtml(f.cuantos)}</strong>`);
  return [
    `<div lang="${idioma}" style="${caja}">`,
    `  <p style="margin:0 0 20px;font-size:28px;font-weight:900;letter-spacing:0.02em;">TINKA<span style="color:${MAGENTA};">ZO</span></p>`,
    `  <p style="${parrafo}">${escaparHtml(f.saludo)}</p>`,
    `  <p style="${parrafo}">${lista}</p>`,
    `  <p style="margin:24px 0;"><a href="${escaparHtml(ENLACE_OFICIAL)}" style="${boton}">${escaparHtml(f.boton)}</a></p>`,
    `  <p style="font-size:15px;line-height:1.5;margin:0 0 12px;">${escaparHtml(f.gratis)}</p>`,
    `  <p style="font-size:14px;line-height:1.5;margin:0;color:${TINTA_2};">${escaparHtml(f.ajeno)}</p>`,
    "</div>",
  ].join("\n");
}

function paginaHtml(idioma: IdiomaDelCorreo, asunto: string, tarjetas: string[]): string {
  return [
    "<!doctype html>",
    `<html lang="${idioma}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escaparHtml(asunto)}</title>`,
    "</head>",
    `<body style="margin:0;padding:24px 16px;background:${PAPEL};font-family:Arial,Helvetica,sans-serif;color:${TINTA};">`,
    ...tarjetas,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * El asunto, el texto plano y el HTML del correo de bienvenida. Con idioma, en ese idioma. Sin idioma (la ficha de la
 * persona no lo dice), los dos en el mismo correo, español primero. El asunto nunca lleva el nombre. Sin imágenes, sin
 * fuentes de afuera y sin nada que rastree: el único enlace es la entrada al sitio.
 */
export function textoDeBienvenida(idioma: IdiomaDelCorreo | null, datos: DatosDeBienvenida): ContenidoDelCorreo {
  const nombre = limpiarTexto(datos.nombre, MAX_NOMBRE);
  if (idioma !== null) {
    const f = frases(idioma, nombre, datos);
    return { asunto: f.asunto, texto: textoPlano(f), html: paginaHtml(idioma, f.asunto, [tarjeta(idioma, f, false)]) };
  }
  const es = frases("es", nombre, datos);
  const en = frases("en", nombre, datos);
  const asunto = `${es.asunto} / ${en.asunto}`;
  return {
    asunto,
    texto: [textoPlano(es), "", "------", "", textoPlano(en)].join("\n"),
    html: paginaHtml("es", asunto, [tarjeta("es", es, false), tarjeta("en", en, true)]),
  };
}

/**
 * El código de un error de envío, solo si tiene la forma de un código fijo (`E_DAILY_LIMIT_EXCEEDED`). El mensaje del
 * error puede traer la dirección: nunca se mira ni se escribe.
 */
export function codigoDelError(e: unknown): string {
  const codigo = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && /^E_[A-Z0-9_]{1,60}$/u.test(codigo) ? codigo : "error";
}

const VENCIDO = Symbol("tope");

/** Espera una promesa, pero no más de `ms`: pasado ese tiempo devuelve `alVencer` y la promesa sigue por su cuenta. */
export async function conTope<T, U>(promesa: Promise<T>, ms: number, alVencer: U): Promise<T | U> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof VENCIDO>((resolver) => {
    temporizador = setTimeout(() => resolver(VENCIDO), ms);
  });
  try {
    const r = await Promise.race([promesa, limite]);
    return r === VENCIDO ? alVencer : (r as T);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * El mensajero real: manda con el enlace de envío del Worker, desde `de` (una dirección del dominio habilitado, que es
 * también a donde llegan las respuestas). Nunca lanza: un envío que falla devuelve su código fijo, y uno que no termina
 * en `TOPE_ENVIO_MS` devuelve `tiempo`.
 */
export function mensajeroDeCloudflare(enlace: EnlaceDeCorreo, de: string, topeMs: number = TOPE_ENVIO_MS): Mensajero {
  return {
    async mandar(para, contenido) {
      const envio = (async (): Promise<ResultadoDelEnvio> => {
        try {
          await enlace.send({
            to: para,
            from: { email: de, name: NOMBRE_DEL_REMITENTE },
            subject: contenido.asunto,
            text: contenido.texto,
            html: contenido.html,
            replyTo: de,
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, codigo: codigoDelError(e) };
        }
      })();
      return conTope<ResultadoDelEnvio, ResultadoDelEnvio>(envio, topeMs, { ok: false, codigo: "tiempo" });
    },
  };
}

/** Si el enlace de envío está y tiene la forma que se usa. Sin él, el correo no se prende. */
export function esEnlaceDeCorreo(x: unknown): x is EnlaceDeCorreo {
  return typeof x === "object" && x !== null && typeof (x as { send?: unknown }).send === "function";
}
