import { PACES, type Frozen, type Game, type Pace } from "../state";
import { acortar } from "../enlace-corto";
import { esc } from "../dom";
import { t } from "../i18n";
import { pintarQr } from "./qr";
import { contratoOficial, type ContratoOficial } from "../stellar/oficiales";
import type { NetworkName } from "../stellar/config";

/**
 * El enlace de la vista de espectador (`espectador.ts`) y su QR en la espera en grande (`espera.ts`).
 *
 * Va todo en el fragmento de la página de la herramienta (`/#espectador=…`), que el navegador no le manda a ningún
 * servidor. Lleva lo que hace falta para contar el mismo sorteo que la sala: la ronda que decide, el juego, el ritmo,
 * cuántos premios, el premio y la lista sellada (los mismos nombres que la sala ve pasar en la espera), y la red, el
 * contrato y el número del sorteo en Stellar: el celular espera a que quede grabado (`espectador-cadena.ts`), como la
 * sala, y comprueba que es este. Con equipos, el nombre de cada uno, que vive solo en el navegador de quien organiza
 * (`equipos/etiquetas.ts`).
 *
 * Solo hay enlace con el sorteo sellado en Stellar. Sin el número no hay cómo saber cuándo la sala lanza el sorteo (el
 * celular coronaría antes) ni con qué comparar lo que trae el enlace: cualquiera podría armar uno con otra lista o
 * con una ronda ya pasada, cambiar el orden hasta que gane quien quiera y mostrarlo con la marca de Tinkazo.
 *
 * El QR lleva solo el enlace corto (`enlace-corto.ts`): el servicio guarda el enlace cifrado y la clave viaja solo en
 * el QR, como el comprobante. Quien escanea ve los nombres, los mismos que pasan por la pantalla de la sala. El enlace
 * largo nunca se dibuja: en una foto de la pantalla, los nombres se leerían sin escanear nada.
 */

/** Lo que viaja en el enlace del espectador, todo en el fragmento. */
export interface DatosEspectador {
  /** La ronda de quicknet que va a decidir. */
  r: number;
  /** El juego elegido. */
  g: Game;
  /** El ritmo del show. */
  p: Pace;
  /** Cuántos ganadores se sortean. */
  w: number;
  /** El premio, si hay. */
  z?: string;
  /** La lista sellada: la misma que hash-ea el sello (protocolo §1). */
  n: string[];
  /** El sorteo sellado en Stellar: la red, el contrato oficial y el número del sorteo. */
  net: NetworkName;
  k: string;
  i: string;
  /** Los nombres de los equipos con cupón, de las cuentas de la lista: `[cuenta, nombre]`. */
  e?: [string, string][];
}

const VERSION = 1;
/** Un juego que se puede nombrar en el enlace: letras, números y guiones, nada que se pueda colar en una dirección. */
const ES_JUEGO = /^[a-z0-9-]{2,32}$/;
const ES_ID = /^[0-9]{1,20}$/;

/* ------------------------------------------------------------------ base64url */

const aB64url = (texto: string): string => {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  // De a pedazos: `String.fromCharCode` con la lista entera puede reventar la pila con listas grandes.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const deB64url = (s: string): string => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

/* ------------------------------------------------------------------ el enlace */

/** El enlace del espectador: esta misma página, con los datos en el fragmento. */
export function enlaceEspectador(datos: DatosEspectador, origen = location.origin): string {
  return `${origen}/#espectador=${aB64url(JSON.stringify({ v: VERSION, ...datos }))}`;
}

/** Los nombres de una lista sellada: los de la herramienta (`canonicalList`), sin repetidos ni saltos de línea. */
function nombresValidos(n: unknown): n is string[] {
  if (!Array.isArray(n) || n.length < 2) return false;
  const vistos = new Set<string>();
  for (const x of n) {
    if (typeof x !== "string" || x.trim() !== x || x.length < 2 || /[\r\n]/.test(x) || vistos.has(x)) return false;
    vistos.add(x);
  }
  return true;
}

/**
 * Los datos que trae el fragmento `#espectador=…`, o null si no es un enlace de espectador o está roto: nunca abre una
 * vista a medio armar. Tiene que nombrar un sorteo de un contrato oficial de Tinkazo (`stellar/oficiales.ts`): sin eso
 * no hay con qué comparar la lista, y no se abre.
 */
export function datosDelEnlace(hash: string = location.hash): DatosEspectador | null {
  const m = /^#espectador=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    const j = JSON.parse(deB64url(m[1])) as Partial<DatosEspectador> & { v?: unknown };
    if (j.v !== VERSION) return null;
    const { r, g, p, w, z, n, net, k, i, e } = j;
    if (!Number.isSafeInteger(r) || (r as number) < 1) return null;
    if (typeof g !== "string" || !ES_JUEGO.test(g)) return null;
    // Sin `Object.hasOwn`: hay navegadores en uso que no lo traen.
    if (typeof p !== "string" || !Object.prototype.hasOwnProperty.call(PACES, p)) return null;
    if (!nombresValidos(n)) return null;
    if (!Number.isInteger(w) || (w as number) < 1 || (w as number) > n.length) return null;
    if (z !== undefined && (typeof z !== "string" || z.length > 200)) return null;
    if (typeof i !== "string" || !ES_ID.test(i) || !contratoOficial(net, k)) return null;
    const datos: DatosEspectador = { r: r as number, g: g as Game, p: p as Pace, w: w as number, n, net: net as NetworkName, k: k as string, i };
    if (z) datos.z = z;
    if (e !== undefined) {
      if (!Array.isArray(e)) return null;
      const deLaLista = new Set(n);
      const pares: [string, string][] = [];
      for (const par of e) {
        if (!Array.isArray(par) || par.length !== 2) return null;
        const [cuenta, nombre] = par as unknown[];
        if (typeof cuenta !== "string" || typeof nombre !== "string" || !deLaLista.has(cuenta) || !nombre.trim()) return null;
        pares.push([cuenta, nombre.trim().slice(0, 60)]);
      }
      if (pares.length) datos.e = pares;
    }
    return datos;
  } catch {
    return null;
  }
}

/** El contrato oficial del sorteo del enlace, o null si no es uno de Tinkazo. */
export function contratoDelEnlace(d: DatosEspectador): ContratoOficial | null {
  return contratoOficial(d.net, d.k);
}

/** Lo que la espera sabe del sorteo para armar el enlace. */
export interface DeLaEspera {
  juego: Game;
  ritmo: Pace;
  /** Cuántos premios se sortean (los del sello, sin pasar de la lista). */
  premios: number;
  red: NetworkName;
  /** El contrato con el que se selló en esta red, si hay. */
  contrato: string | null;
  /** El nombre del equipo de una cuenta, si este navegador lo conoce (`equipos/etiquetas.ts`). */
  equipo?: (cuenta: string) => string | undefined;
}

/**
 * Los datos del enlace del espectador para la lista sellada `f`, o null si no está sellada en Stellar con un contrato
 * oficial de esta red: sin eso no hay QR (el celular rechaza cualquier otro, `datosDelEnlace`).
 */
export function datosDeLaEspera(f: Frozen, d: DeLaEspera): DatosEspectador | null {
  if (f.raffleId === undefined || !d.contrato || !contratoOficial(d.red, d.contrato)) return null;
  const datos: DatosEspectador = {
    r: f.round,
    g: d.juego,
    p: d.ritmo,
    w: Math.min(Math.max(1, d.premios), f.names.length),
    ...(f.prize ? { z: f.prize } : {}),
    n: f.names,
    // El celular espera a que quede grabado, como la sala, y en la red de este sorteo.
    net: d.red,
    k: d.contrato,
    i: String(f.raffleId),
  };
  const equipos = d.equipo ? f.names.flatMap((c): [string, string][] => {
    const nombre = d.equipo?.(c);
    return nombre ? [[c, nombre]] : [];
  }) : [];
  if (equipos.length) datos.e = equipos;
  return datos;
}

/* ------------------------------------------------------------------ el QR */

/** El lado del QR de la espera: lo que deja la pantalla, para que se lea desde las sillas. */
export function ladoDelQr(ancho: number, alto: number): number {
  if (ancho <= 700) return Math.round(Math.min(ancho * 0.46, 220));
  return Math.round(Math.max(150, Math.min(alto * 0.24, ancho * 0.16, 300)));
}

/** Los estados del QR de la espera: preparando el enlace corto, listo, o no salió (con su botón para probar de nuevo). */
export type EstadoDelQr = "preparando" | "listo" | "fallo";

/** El lugar del QR del espectador en la espera en grande, antes de que llegue el enlace corto. */
export function figuraDelQrHtml(): string {
  return (
    `<figure class="espera-qr" data-estado="preparando">` +
    `<img alt="" hidden />` +
    `<figcaption hidden>${esc(t("espQrT"))}</figcaption>` +
    `<p class="espera-qr-estado" role="status">${esc(t("espQrPreparando"))}</p>` +
    `<button class="ghost espera-qr-otra" type="button" hidden>${esc(t("espProbar"))}</button>` +
    `</figure>`
  );
}

/** Pone el QR en un estado: qué se ve y qué no. */
function ponerEstado(figura: HTMLElement, estado: EstadoDelQr): void {
  figura.dataset.estado = estado;
  figura.hidden = false;
  const img = figura.querySelector<HTMLElement>("img");
  const pie = figura.querySelector<HTMLElement>("figcaption");
  const linea = figura.querySelector<HTMLElement>(".espera-qr-estado");
  const otra = figura.querySelector<HTMLElement>(".espera-qr-otra");
  if (img) img.hidden = estado !== "listo";
  if (pie) pie.hidden = estado !== "listo";
  if (linea) {
    linea.hidden = estado === "listo";
    linea.textContent = estado === "fallo" ? t("espQrFallo") : t("espQrPreparando");
  }
  if (otra) otra.hidden = estado !== "fallo";
}

/**
 * El QR del espectador en la espera en grande. Lleva SOLO el enlace corto: los nombres viajan cifrados y la clave va
 * en el QR. El enlace largo los lleva legibles (en base64, que cualquiera decodifica de una foto de la pantalla), así
 * que nunca se dibuja. Mientras el servicio contesta (`acortar`, con su propia espera) se ve que se está preparando;
 * si no sale, no hay QR: lo dice y ofrece Probar de nuevo. Si mientras tanto se pidió otro (cambió el juego), el
 * anterior no se dibuja. Devuelve el enlace que quedó dibujado, o null.
 */
export async function armarQrDeEspectador(capa: HTMLElement, datos: DatosEspectador): Promise<string | null> {
  const figura = capa.querySelector<HTMLElement>(".espera-qr");
  const img = figura?.querySelector("img");
  if (!(figura && img instanceof HTMLImageElement)) return null;
  const enlace = enlaceEspectador(datos);
  // Lo que se pidió último manda: si el juego cambia mientras llega el corto del anterior, ese ya no se dibuja.
  figura.dataset.pedido = enlace;
  delete figura.dataset.enlace;
  ponerEstado(figura, "preparando");
  const otra = figura.querySelector<HTMLButtonElement>(".espera-qr-otra");
  if (otra) otra.onclick = () => void armarQrDeEspectador(capa, datos);
  const corto = (await acortar(enlace).catch(() => null))?.corto ?? null;
  if (!capa.isConnected || figura.dataset.pedido !== enlace) return null;
  if (!corto || !(await pintarQr(img, corto, ladoDelQr(innerWidth, innerHeight)))) {
    if (figura.dataset.pedido === enlace) ponerEstado(figura, "fallo");
    return null;
  }
  if (!capa.isConnected || figura.dataset.pedido !== enlace) return null;
  figura.dataset.enlace = corto;
  ponerEstado(figura, "listo");
  return corto;
}

/** Esconde el QR del espectador (todavía no se sabe si el sorteo queda sellado): nada que escanear. */
export function esconderQrDeEspectador(capa: HTMLElement): void {
  const figura = capa.querySelector<HTMLElement>(".espera-qr");
  if (!figura) return;
  delete figura.dataset.pedido;
  delete figura.dataset.enlace;
  figura.hidden = true;
}
