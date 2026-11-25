import { PACES, type Frozen, type Game, type Pace } from "../state";
import { sha256 } from "@noble/hashes/sha2.js";
import { acortarEspectador, actualizarCorto, cortoGuardado, esCortoDe, rutaDe } from "../enlace-corto";
import { anotarQrMostrado, anotarVersion, delSello, type EnlaceMostrado } from "./espectadores-de-la-sala";
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
  /**
   * De quién son esos nombres: 1 si son de personas (una campaña de empresa) y 0 si son de equipos. Quien mira ve los
   * dos en la pantalla de la sala, pero el celular solo comparte los de equipos (`espectador.ts`): sin esta marca (un
   * enlace de una sala anterior) no se sabe de qué son y no se comparte ninguno.
   */
  q?: 0 | 1;
  /**
   * 1 si la sala sigue la línea de tiempo común (`arranque-del-show.ts`) y elige cuándo grabar con celulares mirando
   * (`puerta-de-la-grabacion.ts`): el celular juega a la par. Sin esto (una sala con el sitio de antes), el celular
   * espera lo grabado como antes.
   */
  h?: 1;
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
/** El fragmento del espectador: los datos y, si el enlace corto puede cambiar, su id, su clave y su contador (`c.ts`). */
const FRAGMENTO = /^#espectador=([A-Za-z0-9_-]+)(?:\.([0-9A-Za-z]{8})\.([A-Za-z0-9_-]{22})\.(\d{1,9}))?$/;

/** La referencia al enlace corto que puede cambiar, si el fragmento la trae: la vista lo vuelve a leer antes del show. */
export function refDelEnlace(hash: string = location.hash): { id: string; clave: string; n: number } | null {
  const m = FRAGMENTO.exec(hash);
  return m?.[2] && m[3] && m[4] ? { id: m[2], clave: m[3], n: Number(m[4]) } : null;
}

/**
 * El enlace corto con el que entró este celular, o null si no se debe compartir. Solo se comparte un corto que no puede
 * cambiar. El del QR de la sala sí puede: quien organiza lo reescribe cuando la sala pasa al premio siguiente, y quien
 * recibiera ese enlace vería otro sorteo distinto del que dice el mensaje. `c.ts` marca ese caso con la referencia en el
 * fragmento, y con ella no hay corto: se comparte el enlace completo del comprobante, que no cambia nunca. Sin la
 * referencia, sale de lo que este equipo recordó al abrir el corto (`abrir`, en `c.ts`, que no recuerda los que pueden
 * cambiar), buscado con los datos del fragmento tal como llegaron: así el corto es el de este sorteo y no el de otro.
 * Sin lo recordado (almacenamiento bloqueado o vaciado) tampoco hay corto. Solo lee: no escribe ni va a la red, y nunca
 * devuelve un corto de otro origen.
 */
export function cortoDelEnlace(hash: string = location.hash, origen: string = location.origin): string | null {
  const m = FRAGMENTO.exec(hash);
  if (!m?.[1] || m[2]) return null;
  try {
    // Con los datos tal como están en el fragmento: ya releídos serían otros y darían otra llave.
    const g = cortoGuardado(`${origen}/#espectador=${m[1]}`);
    return g && esCortoDe(g.corto, origen) ? g.corto : null;
  } catch {
    return null;
  }
}

export function datosDelEnlace(hash: string = location.hash): DatosEspectador | null {
  const m = FRAGMENTO.exec(hash);
  if (!m?.[1]) return null;
  try {
    const j = JSON.parse(deB64url(m[1])) as Partial<DatosEspectador> & { v?: unknown };
    if (j.v !== VERSION) return null;
    const { r, g, p, w, z, n, net, k, i, e, h, q } = j;
    if (!Number.isSafeInteger(r) || (r as number) < 1) return null;
    if (typeof g !== "string" || !ES_JUEGO.test(g)) return null;
    // Sin `Object.hasOwn`: hay navegadores en uso que no lo traen.
    if (typeof p !== "string" || !Object.prototype.hasOwnProperty.call(PACES, p)) return null;
    if (!nombresValidos(n)) return null;
    if (!Number.isInteger(w) || (w as number) < 1 || (w as number) > n.length) return null;
    if (z !== undefined && (typeof z !== "string" || z.length > 200)) return null;
    if (typeof i !== "string" || !ES_ID.test(i) || !contratoOficial(net, k)) return null;
    if (h !== undefined && h !== 1) return null;
    if (q !== undefined && q !== 0 && q !== 1) return null;
    const datos: DatosEspectador = { r: r as number, g: g as Game, p: p as Pace, w: w as number, n, net: net as NetworkName, k: k as string, i };
    if (z) datos.z = z;
    if (h === 1) datos.h = 1;
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
      if (pares.length) {
        datos.e = pares;
        if (q === 0 || q === 1) datos.q = q;
      }
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
  /** Si esos nombres son de personas (los de una campaña de empresa) y no de equipos. */
  personas?: boolean;
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
    // El celular mira lo grabado en la red de este sorteo, para soltar su final y comprobar que es este.
    net: d.red,
    k: d.contrato,
    i: String(f.raffleId),
    // La sala sigue la línea de tiempo común: el celular juega a la par.
    h: 1,
  };
  const equipos = d.equipo ? f.names.flatMap((c): [string, string][] => {
    const nombre = d.equipo?.(c);
    return nombre ? [[c, nombre]] : [];
  }) : [];
  if (equipos.length) {
    datos.e = equipos;
    datos.q = d.personas ? 1 : 0;
  }
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
    // Se cambió el juego con el QR a la vista y no se pudo reescribir el enlace de antes: este QR es nuevo.
    `<p class="espera-qr-anterior" hidden>${esc(t("espQrJuegoAnterior"))}</p>` +
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

/** La huella de una ruta: lo que se recuerda de cada enlace para no armar otro con lo mismo (la ruta lleva los nombres). */
const huellaDe = (ruta: string): string => Array.from(sha256(new TextEncoder().encode(ruta)).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
/** Lo que da `hacer`, o null si falla de cualquier modo: el QR dice que no salió y ofrece probar de nuevo, nunca se rompe. */
async function intentar<T>(hacer: () => Promise<T>): Promise<T | null> {
  try {
    return await hacer();
  } catch {
    return null;
  }
}

/** El enlace corto de un enlace mostrado. */
const cortoDe = (e: Pick<EnlaceMostrado, "id" | "clave">): string => `${location.origin}/c/${e.id}#${e.clave}`;

/**
 * El QR del espectador en la espera en grande, con lo de ahora. Lleva SOLO el enlace corto: los nombres viajan cifrados
 * y la clave va en el QR. El enlace largo los lleva legibles (en base64, que cualquiera decodifica de una foto de la
 * pantalla), así que nunca se dibuja.
 *
 * Lo que ya se mostró de este sello se recuerda (`espectadores-de-la-sala.ts`):
 *
 * - Con lo mismo que un enlace ya mostrado (volver a abrir la espera), el mismo QR.
 * - Con otro juego o duración, si el enlace a la vista se puede reescribir (el servicio lo dijo al crearlo), se reescribe
 *   ese y los demás que se puedan: el QR no cambia, y quien ya escaneó lo relee antes del show (`espectador.ts`).
 * - Si no (el servicio de hoy, o la reescritura no salió), uno nuevo, para quienes escaneen después. Si antes ya se vio
 *   otro que no se pudo reescribir, debajo del QR se dice que quienes ya escanearon lo ven con el juego anterior.
 *
 * Mientras el servicio contesta se ve que se está preparando; si no sale, no hay QR: lo dice y ofrece Probar de nuevo.
 * Si mientras tanto se pidió otro (cambió el juego), el anterior no se dibuja. Devuelve el enlace que quedó dibujado, o
 * null.
 */
export async function armarQrDeEspectador(capa: HTMLElement, datos: DatosEspectador, sello: { raffleId?: bigint } | null = null): Promise<string | null> {
  const figura = capa.querySelector<HTMLElement>(".espera-qr");
  const img = figura?.querySelector("img");
  if (!(figura && img instanceof HTMLImageElement)) return null;
  const enlace = enlaceEspectador(datos);
  // Lo que se pidió último manda: si el juego cambia mientras llega el corto del anterior, ese ya no se dibuja.
  if (figura.dataset.pedido === enlace && figura.dataset.estado !== "fallo") return figura.dataset.enlace ?? null;
  figura.dataset.pedido = enlace;
  const otra = figura.querySelector<HTMLButtonElement>(".espera-qr-otra");
  if (otra) otra.onclick = () => {
    delete figura.dataset.pedido;
    void armarQrDeEspectador(capa, datos, sello);
  };
  const anterior = figura.querySelector<HTMLElement>(".espera-qr-anterior");
  const ruta = rutaDe(enlace) ?? "";
  const huella = huellaDe(ruta);
  const vistos = delSello(sello)?.enlaces ?? [];
  const sigue = (): boolean => capa.isConnected && figura.dataset.pedido === enlace;

  // Lo mismo que uno ya mostrado: ese QR.
  const igual = vistos.find((e) => e.huella === huella);
  // Uno a la vista que se puede reescribir: se reescriben todos los que se puedan, y el QR queda.
  const aLaVista = vistos.find((e) => e.cambia && figura.dataset.enlace === cortoDe(e));
  let corto: string | null = null;
  let quedanViejos = false;
  if (igual) {
    corto = cortoDe(igual);
    quedanViejos = vistos.some((e) => e.huella !== huella);
  } else if (aLaVista) {
    let todos = true;
    for (const e of vistos) {
      const r = e.cambia ? await intentar(() => actualizarCorto({ ...e, borrar: e.permiso }, enlace)) : null;
      if (r?.ok) {
        anotarVersion(sello ?? {}, e.id, r.version, r.n);
        if (sello) anotarQrMostrado(sello, datos.g, datos.p, { ...e, version: r.version, n: r.n, largo: r.largo, huella });
      } else todos = false;
    }
    if (!sigue()) return null;
    const reescrito = delSello(sello)?.enlaces.find((e) => e.id === aLaVista.id && e.huella === huella);
    if (reescrito) {
      corto = cortoDe(reescrito);
      quedanViejos = !todos;
    }
  }
  if (!corto) {
    delete figura.dataset.enlace;
    ponerEstado(figura, "preparando");
    const nuevo = await intentar(() => acortarEspectador(enlace));
    if (!sigue()) return null;
    if (!nuevo || !(await pintarQr(img, nuevo.corto, ladoDelQr(innerWidth, innerHeight)))) {
      if (sigue()) ponerEstado(figura, "fallo");
      return null;
    }
    if (!sigue()) return null;
    corto = nuevo.corto;
    quedanViejos = vistos.length > 0;
    if (sello) anotarQrMostrado(sello, datos.g, datos.p, { id: nuevo.id, clave: nuevo.clave, permiso: nuevo.borrar, cambia: nuevo.cambia, version: nuevo.version, largo: nuevo.largo, n: nuevo.n, huella });
  } else if (figura.dataset.enlace !== corto) {
    if (!(await pintarQr(img, corto, ladoDelQr(innerWidth, innerHeight)))) {
      if (sigue()) ponerEstado(figura, "fallo");
      return null;
    }
    if (!sigue()) return null;
  }
  figura.dataset.enlace = corto;
  ponerEstado(figura, "listo");
  if (anterior) anterior.hidden = !quedanViejos;
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
