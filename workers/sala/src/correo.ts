/**
 * El aviso por correo a quien gana, sin Cloudflare y sin red propia: lo usan `index.ts` y las pruebas en Node.
 *
 * Qué hace: para cada cuenta ganadora que la sala reservó, busca su correo en el proveedor de cuentas, arma un correo corto
 * y lo manda con el enlace de envío del Worker. Qué no hace: no guarda el correo ni el nombre en ningún lado, no los
 * escribe en el registro ni en un error y no los devuelve en ninguna respuesta. Lo único que la sala guarda es la marca de
 * que a esa cuenta ya se le intentó avisar (`reservarAvisosPorCorreo`, en `campana.ts`).
 *
 * Todo lo que falla (la búsqueda, el envío) se traga y deja solo un código fijo en el registro: quien gana se entera igual
 * por su celular, por la pantalla y por el aviso del stand.
 */
import { POLLAR_SERVIDOR, haciaServidorFijo } from "../../patrocinio/src/servidores";
import type { Fetch } from "../../patrocinio/src/servidores";
import { SITIO, esCuentaValida } from "./logica";

export type IdiomaDelCorreo = "es" | "en";
export type Registrar = (evento: string, datos?: Record<string, string | number>) => void;
/** Un pedido al proveedor de cuentas, con la llave ya puesta. Devuelve la respuesta tal cual, o lanza. */
export type Llamar = (ruta: string) => Promise<Response>;

/** Lo que se manda: el asunto, el texto plano y la misma carta en HTML. */
export interface ContenidoDelCorreo {
  asunto: string;
  texto: string;
  html: string;
}

/** Lo que hace falta para mandar un correo. La implementación real habla con el enlace de envío del Worker. */
export interface Mensajero {
  mandar: (para: string, contenido: ContenidoDelCorreo) => Promise<boolean>;
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

/** Las variables del Worker que deciden si el correo está prendido. */
export interface VariablesDeCorreo {
  CORREO?: EnlaceDeCorreo;
  CORREO_DE?: string;
  CORREO_GANADORAS?: string;
  POLLAR_SECRETO?: string;
}

/** Lo que se sabe de una cuenta ganadora para escribirle: solo para armar el correo, nunca se guarda. */
export interface DatosDeLaPersona {
  correo: string;
  nombre: string | null;
  idioma: IdiomaDelCorreo;
}

/** Una cuenta que la sala reservó para avisar, con su puesto (el premio que le toca si los montos son distintos). */
export interface CuentaParaAvisar {
  cuenta: string;
  puesto: number;
}

/** Lo que la sala le da al Worker para avisar: las cuentas reservadas y lo que dice la campaña firmada. */
export interface AvisoDeLaSala {
  cuentas: CuentaParaAvisar[];
  empresa: string;
  /** Los montos de los premios en unidades de siete decimales, como los firmó la empresa. */
  premios: string[];
}

/** Quién manda y a quién se le contesta. El remitente es una dirección del dominio habilitado para el envío. */
const NOMBRE_DEL_REMITENTE = "Tinkazo";
const RESPONDER_A = "hola@tinkazo.app";
/** Cuánto se espera al proveedor de cuentas, y cuánto de su respuesta se acepta. */
export const ESPERA_BUSQUEDA_MS = 6_000;
/**
 * Los topes del aviso entero. Cloudflare corta lo que sigue a la respuesta unos 30 segundos después de cerrarla: ninguna
 * cuenta nueva empieza pasado el presupuesto, y cada cuenta tiene su propio tope para que una sola lenta no frene a todas.
 */
export const PRESUPUESTO_DEL_AVISO_MS = 10_000;
export const TOPE_POR_CUENTA_MS = 10_000;
export const CUENTAS_A_LA_VEZ = 5;
const MAX_RESPUESTA = 400_000;
const MAX_EMPRESA = 60;
const MAX_NOMBRE = 40;
/** El campo de la fila del proveedor que trae la billetera principal de la persona. */
const CAMPO_DE_BILLETERA = "wallet_public_key";
/** El campo con todas las billeteras de la persona, y las cadenas que nombra el proveedor (una de otra cadena no cuenta). */
const CAMPO_DE_BILLETERAS = "wallets";
const OTRAS_CADENAS = ["SOLANA", "POLYGON", "ETHEREUM", "BASE", "ARBITRUM"];

/** Una dirección con forma de correo, sin espacios, comas, comillas ni signos que armen otro destinatario o una cabecera. */
const ES_CORREO =
  /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/u;

export function esCorreo(x: unknown): x is string {
  if (typeof x !== "string" || x.length > 254 || !ES_CORREO.test(x)) return false;
  // Sin punto al principio ni al final de la parte local, y sin dos puntos seguidos: no son direcciones que se entreguen.
  const local = x.slice(0, x.indexOf("@"));
  return !local.startsWith(".") && !local.endsWith(".") && !x.includes("..");
}

/** El correo está prendido solo con el interruptor en "1", el enlace de envío, un remitente válido y la llave del proveedor. */
export function correoPrendido(env: VariablesDeCorreo): boolean {
  if (env.CORREO_GANADORAS !== "1") return false;
  if (!env.CORREO || typeof env.CORREO.send !== "function") return false;
  if (!esCorreo(env.CORREO_DE)) return false;
  return typeof env.POLLAR_SECRETO === "string" && env.POLLAR_SECRETO.trim().length >= 16;
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
  return x
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** La página de esa campaña en el sitio, armada con el id de la sala: sin el pase y sin la clave. */
export function enlaceDeLaSala(id: string): string {
  return `${SITIO}/participar.html?s=${encodeURIComponent(id)}`;
}

/** Un `fetch` que solo llega al proveedor de cuentas, con la llave en la cabecera, con tope de tiempo y de tamaño. */
export function llamarAlProveedor(secreto: string, f: Fetch, esperaMs: number = ESPERA_BUSQUEDA_MS): Llamar {
  const haciaElServidor = haciaServidorFijo(POLLAR_SERVIDOR, f);
  return async (ruta) => {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), esperaMs);
    try {
      const cabeceras = new Headers({ Accept: "application/json" });
      cabeceras.set("x-pollar-api-key", secreto.trim());
      const res = await haciaElServidor(ruta, { method: "GET", headers: cabeceras, signal: control.signal });
      const texto = await res.text();
      if (texto.length > MAX_RESPUESTA) throw new Error("largo");
      return new Response(texto, { status: res.status });
    } finally {
      clearTimeout(temporizador);
    }
  };
}

/** El idioma de una fila: español salvo que diga inglés de forma clara en alguno de los campos de idioma que conoce. */
function idiomaDe(fila: Record<string, unknown>): IdiomaDelCorreo {
  for (const campo of ["language", "locale", "lang"]) {
    const valor = fila[campo];
    if (typeof valor === "string" && /^en(?:[-_][A-Za-z]{2,4})?$/iu.test(valor.trim())) return "en";
  }
  return "es";
}

/** Si una billetera de la lista de la fila (texto u objeto) es, entera, esta cuenta de Stellar. */
function esBilleteraDeLaCuenta(billetera: unknown, cuenta: string): boolean {
  if (typeof billetera === "string") return billetera === cuenta;
  if (typeof billetera !== "object" || billetera === null) return false;
  const o = billetera as Record<string, unknown>;
  if (o.chain !== undefined && String(o.chain).toUpperCase() !== "STELLAR") return false;
  if (o.network !== undefined && OTRAS_CADENAS.includes(String(o.network).trim().toUpperCase())) return false;
  return [o.publicKey, o.public_key, o.address].includes(cuenta);
}

/**
 * Si la fila es de esta cuenta: su billetera principal es exactamente la cuenta, o una de sus billeteras de Stellar lo es.
 * La principal puede ser de otra cadena, o no estar, mientras la de Stellar sí está en la lista.
 */
function esFilaDeLaCuenta(fila: Record<string, unknown>, cuenta: string): boolean {
  if (fila[CAMPO_DE_BILLETERA] === cuenta) return true;
  const billeteras = fila[CAMPO_DE_BILLETERAS];
  return Array.isArray(billeteras) && billeteras.slice(0, 20).some((b) => esBilleteraDeLaCuenta(b, cuenta));
}

/**
 * El correo de una cuenta ganadora, buscado por su cuenta en el proveedor. Se queda solo con la fila cuya billetera es
 * exactamente esa cuenta: la búsqueda también encuentra por un pedazo. Con cero filas exactas, con más de una, o sin un
 * correo con forma de correo, es `null`. Nunca lanza y nunca escribe lo que leyó: el registro lleva solo un código.
 */
export async function correoDeLaCuenta(
  cuenta: string,
  llamar: Llamar,
  registrar: Registrar = () => {},
): Promise<DatosDeLaPersona | null> {
  const sin = (codigo: string): null => {
    registrar("correo-busqueda", { codigo });
    return null;
  };
  if (!esCuentaValida(cuenta)) return sin("cuenta");
  let res: Response;
  let texto: string;
  try {
    res = await llamar(`/v3/users?q=${encodeURIComponent(cuenta)}&limit=200`);
    texto = await res.text();
  } catch {
    return sin("red");
  }
  if (res.status !== 200) return sin("estado");
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return sin("forma");
  }
  const raiz = cuerpo as { success?: unknown; code?: unknown; content?: { items?: unknown } } | null;
  const items = raiz?.content?.items;
  if (raiz?.success !== true || raiz.code !== "SERVER_SDK_USERS_LIST" || !Array.isArray(items)) return sin("forma");
  const filas = items.filter(
    (x): x is Record<string, unknown> => typeof x === "object" && x !== null && esFilaDeLaCuenta(x as Record<string, unknown>, cuenta),
  );
  if (filas.length === 0) return sin("sin-fila");
  const fila = filas[0];
  if (filas.length > 1 || !fila) return sin("filas-repetidas");
  const correo = fila.email;
  if (!esCorreo(correo)) return sin("sin-correo");
  const nombre = limpiarTexto(fila.first_name, MAX_NOMBRE);
  return { correo, nombre: nombre === "" ? null : nombre, idioma: idiomaDe(fila) };
}

/** Las palabras del correo, en los dos idiomas. Sin punto y coma, sin exclamaciones y sin palabras técnicas. */
const PALABRAS = {
  es: {
    asunto: "Ganaste el sorteo de {empresa}",
    saludo: "Hola {nombre}.",
    saludoSinNombre: "Hola.",
    ganaste: "Ganaste {premio} en el sorteo de {empresa}.",
    pedido: "Para recibirlo, abrí este enlace desde el mismo celular con el que te anotaste:",
    boton: "Recibir tu premio",
    cierre: "Recibir tu premio es gratis. Tinkazo nunca te pide una contraseña ni un pago.",
    dinero: "{monto} dólares digitales",
  },
  en: {
    asunto: "You won the {empresa} draw",
    saludo: "Hi {nombre}.",
    saludoSinNombre: "Hi.",
    ganaste: "You won {premio} in the {empresa} draw.",
    pedido: "To receive it, open this link on the same phone you signed up with:",
    boton: "Get your prize",
    cierre: "Receiving your prize is free. Tinkazo never asks you for a password or a payment.",
    dinero: "{monto} digital dollars",
  },
} as const;

/** Reemplaza cada `{clave}` por su valor. Con función, para que un `$` en el valor no se interprete. */
function llenar(plantilla: string, valores: Record<string, string>): string {
  return plantilla.replace(/\{(\w+)\}/gu, (marca, clave: string) => valores[clave] ?? marca);
}

/** Un monto en unidades de siete decimales, truncado a centavos, como lo escribe la pantalla de la campaña. */
function montoTexto(unidades: bigint, idioma: IdiomaDelCorreo): string {
  const entero = unidades / 10000000n;
  const centavos = (unidades % 10000000n) / 100000n;
  const numero = Number(entero) + Number(centavos) / 100;
  return new Intl.NumberFormat(idioma === "es" ? "es-BO" : "en-US", {
    minimumFractionDigits: centavos > 0n ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(numero);
}

/**
 * El premio que le toca a quien ganó, como texto: si todos los premios valen lo mismo, ese monto; si no, el de su puesto
 * (los premios van en el orden de los puestos). Sin un monto legible, un texto general que no promete una cifra.
 */
export function premioDelPuesto(premios: readonly string[], puesto: number, idioma: IdiomaDelCorreo): string {
  const montos: bigint[] = [];
  for (const premio of premios) {
    if (!/^\d{1,16}$/u.test(premio)) return idioma === "es" ? "tu premio" : "your prize";
    montos.push(BigInt(premio));
  }
  const primero = montos[0];
  if (primero === undefined) return idioma === "es" ? "tu premio" : "your prize";
  const igual = montos.every((monto) => monto === primero);
  const suyo = igual ? primero : (montos[puesto] ?? primero);
  return llenar(PALABRAS[idioma].dinero, { monto: montoTexto(suyo, idioma) });
}

/** Los datos que cambian de un correo a otro. El nombre y el premio son opcionales. */
export interface DatosDelTexto {
  nombre: string | null;
  premio: string;
  empresa: string;
  enlace: string;
}

/** El asunto, el texto plano y el HTML. El HTML lleva todo escapado, sin imágenes de afuera y sin nada que rastree. */
export function textoDelCorreo(idioma: IdiomaDelCorreo, datos: DatosDelTexto): ContenidoDelCorreo {
  const p = PALABRAS[idioma];
  const empresa = limpiarTexto(datos.empresa, MAX_EMPRESA) || NOMBRE_DEL_REMITENTE;
  const nombre = limpiarTexto(datos.nombre, MAX_NOMBRE);
  const premio = limpiarTexto(datos.premio, MAX_EMPRESA);
  const asunto = llenar(p.asunto, { empresa });
  const saludo = nombre === "" ? p.saludoSinNombre : llenar(p.saludo, { nombre });
  const ganaste = llenar(p.ganaste, { premio, empresa });
  const texto = [saludo, "", ganaste, "", p.pedido, datos.enlace, "", p.cierre].join("\n");
  const enlace = escaparHtml(datos.enlace);
  const parrafo = "font-size:17px;line-height:1.5;margin:0 0 16px;";
  const chico = "font-size:14px;line-height:1.5;margin:0 0 16px;";
  const boton =
    "display:inline-block;padding:16px 28px;background:#1f1b16;color:#ffffff;font-size:18px;" +
    "font-weight:bold;text-decoration:none;border-radius:10px;";
  const html = [
    "<!doctype html>",
    `<html lang="${idioma}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escaparHtml(asunto)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif;color:#1f1b16;">',
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;padding:24px;border-radius:12px;">',
    `<p style="${parrafo}">${escaparHtml(saludo)}</p>`,
    `<p style="${parrafo}">${escaparHtml(ganaste)}</p>`,
    `<p style="${parrafo}">${escaparHtml(p.pedido)}</p>`,
    `<p style="margin:24px 0;"><a href="${enlace}" style="${boton}">${escaparHtml(p.boton)}</a></p>`,
    `<p style="${chico}word-break:break-all;"><a href="${enlace}" style="color:#1f1b16;">${enlace}</a></p>`,
    `<p style="${chico}color:#5b554c;">${escaparHtml(p.cierre)}</p>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
  return { asunto, texto, html };
}

/**
 * El código de un error de envío, solo si tiene la forma de un código fijo (`E_DAILY_LIMIT_EXCEEDED`). El mensaje del
 * error puede traer la dirección: nunca se mira ni se escribe.
 */
function codigoDelError(e: unknown): string {
  const codigo = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && /^E_[A-Z0-9_]{1,60}$/u.test(codigo) ? codigo : "error";
}

/** El mensajero real: manda con el enlace de envío del Worker. `de` es una dirección del dominio habilitado. */
export function mensajeroDeCloudflare(enlace: EnlaceDeCorreo, de: string, registrar: Registrar = () => {}): Mensajero {
  return {
    async mandar(para, contenido) {
      try {
        await enlace.send({
          to: para,
          from: { email: de, name: NOMBRE_DEL_REMITENTE },
          subject: contenido.asunto,
          text: contenido.texto,
          html: contenido.html,
          replyTo: RESPONDER_A,
        });
        return true;
      } catch (e) {
        registrar("correo-envio", { codigo: codigoDelError(e) });
        return false;
      }
    },
  };
}

/** Lo que lee la campaña firmada para el correo: el nombre de la empresa y los montos. Sin lo uno o lo otro, vacío. */
export function datosDeLaCampana(texto: string | null): { empresa: string; premios: string[] } {
  if (texto === null) return { empresa: "", premios: [] };
  try {
    const datos = JSON.parse(texto) as { empresa?: { nombre?: unknown }; premios?: unknown };
    const premios = Array.isArray(datos.premios) ? datos.premios.filter((p): p is string => typeof p === "string") : [];
    return { empresa: limpiarTexto(datos.empresa?.nombre, MAX_EMPRESA), premios };
  } catch {
    return { empresa: "", premios: [] };
  }
}

/** Lo que hace falta para avisar a las cuentas que la sala reservó. */
export interface PedidoDeAviso {
  aviso: AvisoDeLaSala;
  enlace: string;
  llamar: Llamar;
  mensajero: Mensajero;
  registrar?: Registrar;
  /** Se llama con cada cuenta cuyo aviso ya se intentó, salga bien o mal, para que la sala deje su marca en "hecha". */
  terminada?: (cuenta: string) => Promise<void>;
  /** La hora actual, en milisegundos. Las pruebas la reemplazan. */
  ahora?: () => number;
  presupuestoMs?: number;
  topeCuentaMs?: number;
  cuentasALaVez?: number;
}

const TOPE_VENCIDO = Symbol("tope");

/** Espera una promesa, pero no más de `ms`: pasado ese tiempo devuelve `TOPE_VENCIDO` y la promesa sigue por su cuenta. */
async function conTope<T>(promesa: Promise<T>, ms: number): Promise<T | typeof TOPE_VENCIDO> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof TOPE_VENCIDO>((resolver) => {
    temporizador = setTimeout(() => resolver(TOPE_VENCIDO), ms);
  });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Avisa por correo a una cuenta reservada: busca su correo, arma el texto y lo manda. Devuelve si salió un correo.
 * Nunca lanza: lo que falla deja solo un código fijo en el registro.
 */
async function avisarACuenta(pedido: PedidoDeAviso, { cuenta, puesto }: CuentaParaAvisar): Promise<boolean> {
  const registrar = pedido.registrar ?? (() => {});
  try {
    const persona = await correoDeLaCuenta(cuenta, pedido.llamar, registrar);
    if (!persona) return false;
    const contenido = textoDelCorreo(persona.idioma, {
      nombre: persona.nombre,
      premio: premioDelPuesto(pedido.aviso.premios, puesto, persona.idioma),
      empresa: pedido.aviso.empresa,
      enlace: pedido.enlace,
    });
    return await pedido.mensajero.mandar(persona.correo, contenido);
  } catch {
    registrar("correo-envio", { codigo: "inesperado" });
    return false;
  }
}

/**
 * Avisa por correo a las cuentas reservadas, unas cuantas a la vez y dentro de un presupuesto de tiempo, porque el trabajo
 * en segundo plano se corta poco después de la respuesta. Una cuenta sin correo, o cuyo envío falla o tarda de más, no frena
 * a las demás y queda como intentada (\`terminada\`). Una cuenta que no alcanzó a empezar queda reservada, sin intentar, y se
 * reintenta la próxima vez que la sala reciba el resultado. Devuelve cuántos correos salieron. Nunca lanza.
 */
export async function avisarPorCorreo(pedido: PedidoDeAviso): Promise<number> {
  const registrar = pedido.registrar ?? (() => {});
  const ahora = pedido.ahora ?? Date.now;
  const limite = ahora() + (pedido.presupuestoMs ?? PRESUPUESTO_DEL_AVISO_MS);
  const topeCuenta = pedido.topeCuentaMs ?? TOPE_POR_CUENTA_MS;
  const cuentas = pedido.aviso.cuentas;
  let siguiente = 0;
  let enviados = 0;
  let intentadas = 0;
  const trabajador = async (): Promise<void> => {
    while (siguiente < cuentas.length && ahora() < limite) {
      const cuenta = cuentas[siguiente];
      siguiente += 1;
      if (!cuenta) continue;
      const salio = await conTope(avisarACuenta(pedido, cuenta), topeCuenta);
      if (salio === TOPE_VENCIDO) registrar("correo-envio", { codigo: "tiempo" });
      if (salio === true) enviados += 1;
      intentadas += 1;
      try {
        await pedido.terminada?.(cuenta.cuenta);
      } catch {
        registrar("correo-envio", { codigo: "marca" });
      }
    }
  };
  const cuantos = Math.max(1, Math.min(pedido.cuentasALaVez ?? CUENTAS_A_LA_VEZ, cuentas.length));
  await Promise.all(Array.from({ length: cuantos }, trabajador));
  registrar("correo-fin", { cuentas: cuentas.length, enviados, intentadas });
  return enviados;
}
