/**
 * Del formulario al archivo de la campaña y de vuelta. Todo es puro: el archivo que sale es exactamente el que aceptan los
 * dos lectores que ya existen (el de la sala y el del sitio), y antes de bajarlo la página lo pasa por el validador que los
 * junta. La firma no es de esta página: la pone Tinkazo.
 */

import type { Bilingue, ColorDeCampana, TipoDePaso } from "../modelo";
import { leerCampana, leerUrl } from "../modelo";
import { SIETE_DIAS_MS, UNIDADES_POR_DOLAR } from "./constantes";
import { basesFinales } from "./bases";
import {
  COLORES_EN_ORDEN,
  MAXIMO_DEL_LUGAR,
  type FormularioDeCampana,
  type NumeroDePaso,
  type OrigenDelArchivo,
  type PasoDelFormulario,
} from "./estado";
import { fechaYHoraDe, instantesDe, revisarHoras } from "./horas";
import { revisarEnlace, type MotivoDeEnlace, type ResultadoDeEnlace, type TipoDeRed } from "./redes";

/** Lo que falta o está mal, con el paso al que lleva y, si hay, el control que lo tiene. */
export interface Falta {
  paso: NumeroDePaso;
  clave: string;
  valores?: Record<string, string>;
  donde?: string;
}

/** Lo más largo que puede ser la parte del nombre en el evento: el resto es el sufijo, el día y la hora. */
const LARGO_DEL_NOMBRE_EN_EL_EVENTO = 19;
const EVENTO_DE_LA_VISTA = "mi-campana";

/** El nombre de una marca como parte de una dirección: minúsculas, sin tildes ni símbolos, y como mucho 19 caracteres. */
function parteDelNombre(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, LARGO_DEL_NOMBRE_EN_EL_EVENTO)
    .replace(/-+$/u, "");
  return limpio === "" ? "campana" : limpio;
}

/**
 * El evento sale de la marca, un sufijo que no cambia al editar, el día y la hora de abrir: dos campañas de la misma marca el
 * mismo día con otra hora, o dos marcas con nombres que se parecen, no pueden chocar. Siempre de 12 a 40 caracteres y termina
 * en número, como pide el modelo. Sin día (solo la vista), termina en el sufijo.
 */
export function eventoDe(f: Pick<FormularioDeCampana, "nombre" | "sufijo" | "fecha" | "abre">): string {
  const base = `${parteDelNombre(f.nombre.trim())}-${f.sufijo}`;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(f.fecha)) return base;
  const hora = /^\d{2}:\d{2}$/u.test(f.abre) ? f.abre.replace(":", "") : "0000";
  return `${base}-${f.fecha}-${hora}`;
}

/** El evento que lleva el archivo: el del archivo abierto mientras no cambien el nombre, el día ni la hora de abrir. */
export function eventoDelFormulario(f: FormularioDeCampana): string {
  const o = f.origen;
  if (o && o.nombre === f.nombre.trim() && o.fecha === f.fecha && o.abre === f.abre) return o.evento;
  return eventoDe(f);
}

/** Un premio por persona que gana, todos iguales, en unidades de siete decimales y como texto. */
export function premiosDe(monto: number, ganan: number): string[] {
  const cada = String(BigInt(monto) * UNIDADES_POR_DOLAR);
  return Array.from({ length: ganan }, () => cada);
}

/** Las dos lenguas de un pedido escrito: si una queda vacía se usa la otra. */
export function textoDelPedido(p: PasoDelFormulario): Bilingue {
  const es = p.texto.es.trim();
  const en = p.texto.en.trim();
  return { es: es || en, en: en || es };
}

/** Un pedido de red tal como venía escrito en el archivo que se abrió. */
interface PedidoAbierto {
  tipo: string;
  url: string;
  texto: Bilingue;
}

const PEDIDOS_POR_ORIGEN = new WeakMap<OrigenDelArchivo, PedidoAbierto[]>();

/** Los pedidos con enlace del archivo abierto, con la dirección y el texto exactos que traía. Se leen una sola vez. */
function pedidosAbiertos(origen: OrigenDelArchivo): PedidoAbierto[] {
  const sabidos = PEDIDOS_POR_ORIGEN.get(origen);
  if (sabidos) return sabidos;
  const lista: PedidoAbierto[] = [];
  try {
    const datos: unknown = JSON.parse(origen.texto);
    const pasos = esObjeto(datos) && Array.isArray(datos.pasos) ? (datos.pasos as unknown[]) : [];
    for (const p of pasos) {
      if (!esObjeto(p) || typeof p.tipo !== "string" || typeof p.url !== "string" || !esObjeto(p.texto)) continue;
      const { es, en } = p.texto;
      if (typeof es === "string" && typeof en === "string") lista.push({ tipo: p.tipo, url: p.url, texto: { es, en } });
    }
  } catch {
    /* un archivo que ya no se puede leer no aporta pedidos */
  }
  PEDIDOS_POR_ORIGEN.set(origen, lista);
  return lista;
}

/**
 * El pedido del archivo abierto que sigue igual en el formulario: el mismo tipo y la misma dirección que leyó el modelo.
 * Ese pedido se repite tal cual, sin limpiar la dirección ni acotar su largo: solo lo que alguien escribe se revisa.
 */
function pedidoAbiertoDe(f: FormularioDeCampana, tipo: TipoDeRed, url: string): PedidoAbierto | null {
  if (!f.origen) return null;
  return pedidosAbiertos(f.origen).find((o) => o.tipo === tipo && leerUrl(o.url, tipo) === url) ?? null;
}

/** Lo que dice un pedido de red: lo del archivo abierto que no se tocó vale tal cual, y lo escrito se revisa. */
export function lecturaDelPedido(f: FormularioDeCampana, tipo: TipoDeRed, url: string): ResultadoDeEnlace {
  const abierto = pedidoAbiertoDe(f, tipo, url);
  return abierto ? { ok: true, url: abierto.url } : revisarEnlace(tipo, url);
}

const CLAVE_DE_ENLACE: Record<Exclude<MotivoDeEnlace, "vacio">, string> = {
  "otra-red": "ccEnlaceOtraRed",
  mal: "ccEnlaceMal",
  corto: "ccEnlaceCorto",
};

function faltasDelPaso4(f: FormularioDeCampana): Falta[] {
  const faltas: Falta[] = [];
  f.pasos.forEach((p, i) => {
    const donde = `ccp-pedido-${i}`;
    if (p.tipo === "texto") {
      const t = textoDelPedido(p);
      if (t.es === "") faltas.push({ paso: 4, clave: "ccFaltaPedido", donde });
      return;
    }
    const lectura = lecturaDelPedido(f, p.tipo, p.url);
    if (lectura.ok) return;
    const clave = lectura.motivo === "vacio" ? "ccFaltaEnlace" : CLAVE_DE_ENLACE[lectura.motivo];
    faltas.push({ paso: 4, clave, donde, ...(lectura.motivo === "otra-red" ? { valores: { red: p.tipo } } : {}) });
  });
  return faltas;
}

const CLAVE_DE_HORA = {
  "falta-dia": "ccFaltaDia",
  "falta-hora": "ccFaltaHora",
  "abre-pasada": "ccCorregiAbre",
  "cierra-antes": "ccCorregiCierra",
  "cierra-lejos": "ccCierraLejos",
  "sorteo-antes": "ccCorregiSorteo",
  "sorteo-lejos": "ccSorteoLejos",
} as const;

/** Lo que falta en un paso. `automaticas` son las bases de ahora, para saber si las escritas quedaron desfasadas. */
export function faltasDelPaso(f: FormularioDeCampana, paso: NumeroDePaso, ahora: number, automaticas: Bilingue): Falta[] {
  if (paso === 1) return f.nombre.trim() === "" ? [{ paso, clave: "ccFaltaNombre", donde: "ccp-nombre" }] : [];
  if (paso === 2) {
    // Una campaña de personas no lleva montos: se escribe qué se lleva cada persona.
    if (f.premioEnMano !== undefined) return f.premioEnMano.trim() === "" ? [{ paso, clave: "ccFaltaPremioMano", donde: "ccp-premio-mano" }] : [];
    return f.monto === null ? [{ paso, clave: "ccFaltaMonto", donde: "ccp-monto" }] : [];
  }
  if (paso === 3) {
    const faltas: Falta[] = [];
    const hora = revisarHoras(f, ahora);
    if (hora) faltas.push({ paso, clave: CLAVE_DE_HORA[hora.problema], donde: hora.donde });
    if (f.lugar.trim() === "") faltas.push({ paso, clave: "ccFaltaLugar", donde: "ccp-lugar" });
    return faltas;
  }
  if (paso === 4) return faltasDelPaso4(f);
  if (paso === 5) {
    const { bases, desfasadas } = basesFinales(f.bases, automaticas);
    if (bases.es.trim() === "" || bases.en.trim() === "") return [{ paso, clave: "ccFaltaBases", donde: "ccp-bases" }];
    if (bases.es.length > 6000 || bases.en.length > 6000) return [{ paso, clave: "ccBasesLargas", donde: "ccp-bases" }];
    return desfasadas ? [{ paso, clave: "ccBasesCambiaron", donde: "ccp-bases" }] : [];
  }
  return [];
}

/** Lo que falta en todos los pasos, en orden. */
export function faltas(f: FormularioDeCampana, ahora: number, automaticas: Bilingue): Falta[] {
  return ([1, 2, 3, 4, 5] as const).flatMap((paso) => faltasDelPaso(f, paso, ahora, automaticas));
}

/** El pedido tal como viaja en el archivo. Uno que venía en el archivo abierto y no se tocó sale con su dirección y su texto. */
function pedidoDelArchivo(f: FormularioDeCampana, p: PasoDelFormulario): { tipo: TipoDePaso; url: string | null; texto: Bilingue } {
  if (p.tipo === "texto") return { tipo: "texto", url: null, texto: textoDelPedido(p) };
  const abierto = pedidoAbiertoDe(f, p.tipo, p.url);
  if (abierto) return { tipo: p.tipo, url: abierto.url, texto: abierto.texto };
  const lectura = revisarEnlace(p.tipo, p.url);
  return { tipo: p.tipo, url: lectura.ok ? lectura.url : p.url, texto: { es: "", en: "" } };
}

/** El lugar en las dos lenguas: el del archivo abierto, con su inglés propio, mientras el español no cambie. */
function lugarDelArchivo(f: FormularioDeCampana, lugar: string): Bilingue {
  const abierto = f.conservado?.lugar;
  return abierto && abierto.es.trim() === lugar ? { es: abierto.es, en: abierto.en } : { es: lugar, en: lugar };
}

/**
 * El objeto del archivo, con las claves en el orden de siempre. Solo con las faltas vacías: el que llama lo comprueba antes.
 * La red es la principal: el archivo es para el día del evento. Lo que trae un archivo abierto y esta página no edita
 * (cuenta que sella, contrato, promo, comprobante, plazo, entrada, estado, red, anotadas y el inglés del lugar) se repite tal cual.
 */
export function armarCampana(f: FormularioDeCampana, o: { bases: Bilingue; identidad?: "persona" }): Record<string, unknown> {
  const t = instantesDe(f);
  const abreMs = t?.abreMs ?? 0;
  const cierraMs = t?.cierraMs ?? 0;
  const sorteoMs = t?.sorteoMs ?? 0;
  const guardado = f.conservado;
  const recibirHasta = guardado?.recibirHastaMs && guardado.recibirHastaMs > sorteoMs ? guardado.recibirHastaMs : sorteoMs + SIETE_DIAS_MS;
  const lugar = f.lugar.trim();
  const archivo: Record<string, unknown> = {
    v: 1,
    evento: eventoDelFormulario(f),
    red: guardado?.red ?? "mainnet",
    estado: guardado?.estado ?? "abierta",
    empresa: { nombre: f.nombre.trim(), logo: f.logo ? { tipo: f.logo.tipo, datos: f.logo.datos } : null, color: f.color },
    lugar: lugarDelArchivo(f, lugar),
    zona: f.zona,
    premios: premiosDe(f.monto ?? 0, f.ganan),
    abre_ms: abreMs,
    cierra_ms: cierraMs,
    sorteo_ms: sorteoMs,
    recibir_hasta_ms: recibirHasta,
    entrada: guardado?.entrada ?? "google",
    pasos: f.pasos.map((p) => pedidoDelArchivo(f, p)),
    bases: { es: o.bases.es, en: o.bases.en },
    anotadas: guardado?.anotadas ?? 0,
    contrato: guardado?.contrato ?? null,
    promo: guardado?.promo ?? null,
    comprobante: guardado?.comprobante ?? null,
  };
  if (guardado?.organizadora) archivo.organizadora = guardado.organizadora;
  // Anotarse sin billetera: el campo solo va si se pidió en un formulario nuevo o si el archivo que se abrió ya lo traía. Con un
  // archivo abierto manda lo que el archivo decía: una campaña de cuentas no cambia por abrirla con la dirección de personas.
  if ((guardado ? guardado.identidad : o.identidad) === "persona") {
    archivo.identidad = "persona";
    // El premio en mano va escrito y los montos en cero, uno por persona. El inglés propio de un archivo abierto se repite mientras el
    // español no cambie, y si no el inglés repite el español.
    if (f.premioEnMano !== undefined) {
      const premio = f.premioEnMano.trim();
      const abierto = guardado?.premioEnMano;
      archivo.premio_en_mano = { es: premio, en: abierto && abierto.es.trim() === premio ? abierto.en : premio };
      archivo.premios = Array.from({ length: f.ganan }, () => "0");
    }
  }
  return archivo;
}

export interface MuestrasDeLaVista {
  nombre: boolean;
  premio: boolean;
  lugar: boolean;
  horas: boolean;
}

/**
 * Lo mismo para la vista: lo que falta o no sirve va de muestra, y dice qué es de muestra. Siempre es una campaña que el
 * lector del sitio acepta. Las horas de muestra salen de ahora (abre una hora antes, cierra tres después y el sorteo a las
 * cuatro) para que nunca queden en el pasado.
 */
export function campanaParaLaVista(
  f: FormularioDeCampana,
  o: { ahora: number; muestraMarca: string; muestraLugar: Bilingue; muestraPremio?: Bilingue; bases: Bilingue },
): { campana: Record<string, unknown>; muestras: MuestrasDeLaVista } {
  const nombre = f.nombre.trim();
  const lugar = f.lugar.trim();
  const horasBien = revisarHoras(f, o.ahora) === null ? instantesDe(f) : null;
  const abreMs = horasBien?.abreMs ?? o.ahora - 3_600_000;
  const cierraMs = horasBien?.cierraMs ?? o.ahora + 3 * 3_600_000;
  const sorteoMs = horasBien?.sorteoMs ?? o.ahora + 4 * 3_600_000;
  const pedidos = f.pasos
    .filter((p) => (p.tipo === "texto" ? textoDelPedido(p).es !== "" : lecturaDelPedido(f, p.tipo, p.url).ok))
    .map((p) => pedidoDelArchivo(f, p));
  const conBases = (texto: string, otro: string): string => (texto.trim() || otro.trim() || o.muestraMarca).slice(0, 6000);
  // Con el premio escrito la vista es la de una campaña de personas: sin premio todavía muestra uno de muestra.
  const enMano = f.premioEnMano !== undefined;
  const premioEscrito = f.premioEnMano?.trim() ?? "";
  const premioDeMuestra = o.muestraPremio ?? { es: "Premio", en: "Prize" };
  const campana: Record<string, unknown> = {
    v: 1,
    evento: nombre === "" || f.fecha === "" ? EVENTO_DE_LA_VISTA : eventoDelFormulario(f),
    red: "mainnet",
    estado: "abierta",
    empresa: { nombre: nombre || o.muestraMarca, logo: f.logo, color: f.color },
    lugar: lugar ? { es: lugar, en: lugar } : { es: o.muestraLugar.es, en: o.muestraLugar.en },
    zona: f.zona,
    premios: enMano ? Array.from({ length: f.ganan }, () => "0") : premiosDe(f.monto ?? 40, f.ganan),
    abre_ms: abreMs,
    cierra_ms: cierraMs,
    sorteo_ms: sorteoMs,
    recibir_hasta_ms: sorteoMs + SIETE_DIAS_MS,
    entrada: "google",
    pasos: pedidos,
    bases: { es: conBases(o.bases.es, o.bases.en), en: conBases(o.bases.en, o.bases.es) },
    anotadas: 0,
    contrato: null,
    promo: null,
    comprobante: null,
  };
  if (enMano) {
    campana.identidad = "persona";
    campana.premio_en_mano = premioEscrito === "" ? { es: premioDeMuestra.es, en: premioDeMuestra.en } : { es: premioEscrito, en: premioEscrito };
  }
  const premioDeMuestraAhora = enMano ? premioEscrito === "" : f.monto === null;
  return { campana, muestras: { nombre: nombre === "", premio: premioDeMuestraAhora, lugar: lugar === "", horas: horasBien === null } };
}

/** El paso al que lleva un campo que el lector rechazó. Lo que no es de ningún paso es un error del armado: se queda en el 6. */
export function pasoDelFallo(campo: string, conLogo: boolean): NumeroDePaso {
  if (["evento", "empresa", "empresa.nombre", "empresa.logo"].includes(campo)) return 1;
  if (campo === "premios" || campo === "premio_en_mano") return 2;
  if (["lugar", "zona", "abre_ms", "cierra_ms", "sorteo_ms", "recibir_hasta_ms", "horas"].includes(campo)) return 3;
  if (["pasos", "pasos.url", "pasos.texto"].includes(campo)) return 4;
  if (campo === "bases") return 5;
  if (campo === "texto") return conLogo ? 1 : 5;
  return 6;
}

/** Cuántos bytes lleva el pedido con que la sala recibe la campaña: el texto, la firma de Tinkazo y el intento. */
export function bytesDelPedido(texto: string): number {
  const cuerpo = JSON.stringify({ texto, firma: "A".repeat(86), intento: "A".repeat(22) });
  return new TextEncoder().encode(cuerpo).length;
}

/** El paso que más pesa en una campaña que no entra: el logo al 1, los enlaces al 4 y las bases al 5. */
export function pasoQueMasPesa(campana: Record<string, unknown>): NumeroDePaso {
  const empresa = campana.empresa as { logo: { datos: string } | null } | undefined;
  const logo = empresa?.logo?.datos.length ?? 0;
  const enlaces = JSON.stringify(campana.pasos ?? []).length;
  const bases = JSON.stringify(campana.bases ?? {}).length;
  if (logo >= enlaces && logo >= bases) return 1;
  return enlaces >= bases ? 4 : 5;
}

/**
 * Si la campaña no entra en lo que el servicio acepta, mide el texto (80.000 caracteres) y el pedido entero en bytes
 * (90.000), que es lo que de verdad recibe: cada tilde, comilla o salto pesa más de un byte. Los topes salen del servicio.
 */
export async function faltaDeTamano(texto: string, campana: Record<string, unknown>): Promise<Falta | null> {
  const { MAX_TEXTO_CAMPANA, MAX_CUERPO_CAMPANA } = await import("../../../workers/sala/src/campana");
  if (texto.length <= MAX_TEXTO_CAMPANA && bytesDelPedido(texto) <= MAX_CUERPO_CAMPANA) return null;
  return { paso: pasoQueMasPesa(campana), clave: "ccDemasiado" };
}

/** Lo más pesado que acepta la sala al activar, pedido entero en bytes: es menos que al crear, porque la sesión también viaja. */
export const MAX_CUERPO_DE_ACTIVAR = 24_000;
/** Lo que se reserva para el token de la sesión y la cuenta de quien organiza, que se suman al activar. */
const RESERVA_AL_ACTIVAR = 4_000;

/** Los bytes del pedido de activar con este texto: lo que de verdad recibe la sala, con la sesión y la cuenta todavía por sumar. */
export function bytesDelPedidoDeActivar(texto: string): number {
  const cuerpo = JSON.stringify({ texto, sesion: "A".repeat(RESERVA_AL_ACTIVAR) });
  return new TextEncoder().encode(cuerpo).length;
}

/**
 * Si la campaña no entra en lo que la sala acepta para activarla. Una con logo grande o bases largas se puede bajar, pero no
 * activar desde acá: se queda en el último paso, donde está Descargar, y dice qué achicar.
 */
export function faltaDeTamanoParaActivar(texto: string): Falta | null {
  return bytesDelPedidoDeActivar(texto) <= MAX_CUERPO_DE_ACTIVAR ? null : { paso: 6, clave: "ccDemasiadoActivar" };
}

/** El mismo objeto con las claves en orden y sin espacios: sirve para saber si dos archivos dicen lo mismo. */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (typeof valor === "object" && valor !== null) {
    const claves = Object.keys(valor).sort();
    return `{${claves.map((c) => `${JSON.stringify(c)}:${canonico((valor as Record<string, unknown>)[c])}`).join(",")}}`;
  }
  return JSON.stringify(valor) ?? "null";
}

/** Si el archivo que se abrió vino firmado y lo que se arma ahora dice exactamente lo mismo. */
export function sigueIgualQueElFirmado(f: FormularioDeCampana, armado: Record<string, unknown>): boolean {
  const origen = f.origen;
  if (!origen || origen.firma === null) return false;
  try {
    return canonico(JSON.parse(origen.texto)) === canonico(armado);
  } catch {
    return false;
  }
}

/** Si el archivo abierto estaba firmado y ahora cambió: hay que activarlo de nuevo. */
export function cambioUnaActivada(f: FormularioDeCampana, armado: Record<string, unknown>): boolean {
  return f.origen !== null && f.origen.firma !== null && !sigueIgualQueElFirmado(f, armado);
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Si dos listas de instantes del mismo formulario y del archivo son los mismos. */
function mismasHoras(f: FormularioDeCampana, abreMs: number, cierraMs: number, sorteoMs: number): boolean {
  const t = instantesDe(f);
  return t !== null && t.abreMs === abreMs && t.cierraMs === cierraMs && t.sorteoMs === sorteoMs;
}

export interface OpcionesDeApertura {
  zonaDelNavegador: string;
  red: "mainnet" | "testnet";
  /** El sufijo para un archivo cuyo evento no lo trae. */
  sufijo: string;
  /** Las bases que se escribirían solas con los datos del archivo, para saber si las del archivo son las de siempre. */
  automaticas: (f: FormularioDeCampana) => Bilingue;
}

/** El sufijo que ya trae un evento armado por esta página, o null. */
function sufijoDelEvento(evento: string): string | null {
  return /-([a-z0-9]{4})-\d{4}-\d{2}-\d{2}-\d{4}$/u.exec(evento)?.[1] ?? null;
}

/** Abre un archivo ya armado, firmado ({ texto, firma }) o no, y lo vuelve el formulario de los pasos. */
export function formularioDesdeTexto(crudo: string, o: OpcionesDeApertura): { ok: true; formulario: FormularioDeCampana } | { ok: false } {
  if (crudo.length > 200_000) return { ok: false };
  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return { ok: false };
  }
  let firma: string | null = null;
  let textoOriginal: string | null = null;
  if (esObjeto(datos) && typeof datos.texto === "string" && typeof datos.firma === "string") {
    firma = datos.firma;
    textoOriginal = datos.texto;
    try {
      datos = JSON.parse(datos.texto);
    } catch {
      return { ok: false };
    }
  }
  if (!esObjeto(datos)) return { ok: false };
  const lectura = leerCampana({ ...datos, red: o.red });
  if (!lectura.ok) return { ok: false };
  const c = lectura.campana;
  const abre = fechaYHoraDe(c.abreMs, c.zona);
  const cierra = fechaYHoraDe(c.cierraMs, c.zona);
  const sorteo = fechaYHoraDe(c.sorteoMs, c.zona);
  const primero = c.premios[0] ?? 0n;
  const iguales = c.premios.every((p) => p === primero) && primero % UNIDADES_POR_DOLAR === 0n;
  const color: ColorDeCampana | null = COLORES_EN_ORDEN.find((x) => x === c.empresa.color) ?? null;
  const base: FormularioDeCampana = {
    v: 1,
    paso: 1,
    visitado: 6,
    nombre: c.empresa.nombre,
    logo: c.empresa.logo
      ? { tipo: c.empresa.logo.tipo as "image/webp" | "image/png" | "image/jpeg", datos: c.empresa.logo.datos }
      : null,
    blanco: false,
    color,
    monto: iguales && c.premioEnMano === undefined ? Number(primero / UNIDADES_POR_DOLAR) : null,
    ...(c.premioEnMano !== undefined ? { premioEnMano: c.premioEnMano.es } : {}),
    otroMonto: false,
    ganan: c.premios.length,
    fecha: abre.fecha,
    abre: abre.hora,
    cierra: cierra.hora,
    sorteo: sorteo.hora,
    zona: c.zona,
    lugar: c.lugar.es.slice(0, MAXIMO_DEL_LUGAR),
    pasos: c.pasos.map((p) => {
      const distinto = p.tipo === "texto" && p.texto.es !== p.texto.en;
      return {
        tipo: p.tipo,
        url: p.url ?? "",
        texto: p.tipo === "texto" ? p.texto : { es: "", en: "" },
        editadoEs: distinto,
        editadoEn: distinto,
      };
    }),
    bases: { es: null, en: null, moldeEs: null, moldeEn: null },
    sufijo: sufijoDelEvento(c.evento) ?? o.sufijo,
    conservado: {
      organizadora: typeof datos.organizadora === "string" ? datos.organizadora : null,
      contrato: c.contrato,
      promo: c.promo,
      comprobante: c.comprobante,
      recibirHastaMs: c.recibirHastaMs,
      entrada: c.entrada,
      estado: c.estado,
      red: datos.red === "testnet" ? "testnet" : "mainnet",
      anotadas: c.anotadas,
      ...(c.identidad === "persona" ? { identidad: "persona" as const } : {}),
      ...(c.premioEnMano !== undefined ? { premioEnMano: { es: c.premioEnMano.es, en: c.premioEnMano.en } } : {}),
      lugar: { es: c.lugar.es, en: c.lugar.en },
    },
    origen: {
      texto: textoOriginal ?? JSON.stringify(datos),
      firma,
      evento: c.evento,
      nombre: c.empresa.nombre,
      fecha: abre.fecha,
      abre: abre.hora,
    },
  };
  // Un archivo cuyas horas no se pueden mostrar en un solo día con sus tres horas no se abre: se perderían sin avisar.
  if (!mismasHoras(base, c.abreMs, c.cierraMs, c.sorteoMs)) return { ok: false };
  const aut = o.automaticas(base);
  const igualES = c.bases.es === aut.es;
  const igualEN = c.bases.en === aut.en;
  const formulario: FormularioDeCampana = {
    ...base,
    bases: {
      es: igualES ? null : c.bases.es,
      en: igualEN ? null : c.bases.en,
      moldeEs: igualES ? null : aut.es,
      moldeEn: igualEN ? null : aut.en,
    },
  };
  return { ok: true, formulario };
}
