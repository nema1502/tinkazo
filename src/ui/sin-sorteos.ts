import { t } from "../i18n";
import { type Acceso, consultarAcceso } from "../stellar/acceso-oficial";
import { type Oferta, leerOferta } from "../stellar/alta-oferta";
import { esNoDelPortero } from "../stellar/errores";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import type { LecturaDelRegalo, ReciboDelRegalo } from "./cuenta-lista-flujo";
import { abrirDialogo, botonPrincipal, lineaDeEstado } from "./dialogo";
import { practicarEnPrueba, puedeCambiarDeModo } from "./modo-ui";
import { mostrarSinPatrocinio } from "./red";
import { currentSession } from "./wallet-ui";

/**
 * Las compuertas del acceso con el cobro por uso del modo Oficial (`cobro-oficial.ts`), con lo que ve la persona. Solo
 * las llama quien ya sabe que rige el cobro (`freeze.ts` y `draw.ts`); la decisión, sin pantalla, es de
 * `stellar/acceso-oficial.ts`. Ninguna pide una firma: dicen si se puede pedir.
 *
 * - Sin acceso: se abre «Dejá tu cuenta lista» (`abrirParaElError` de `cuenta-lista-flujo.ts`), donde se usa el cupón o
 *   se compra el primer paquete. Al volver, se pregunta de nuevo al portero: lo que diga el paso no alcanza.
 * - Sin sorteos que alcancen para el sello: la ventana «Se te acabaron los sorteos oficiales». Con el regalo de quien
 *   entra con su cuenta todavía sin recibir, la principal es «Recibirlos» (no es un cobro): al llegar, se vuelve a mirar.
 *   Sin el regalo y sin nada a la venta, la principal es «Sortear en Prueba», que pasa a Prueba y entra solo con la
 *   cuenta de prueba, con la lista intacta. Con un paquete a la venta, la principal es «Sumar sorteos», que no cobra:
 *   abre la ventana de los paquetes (`pago-paquete.ts`), y Prueba queda a la vista como segunda. El cupón va siempre
 *   como enlace chico. Al llegar el pago se vuelve a mirar y, con sorteos que alcancen, se sella.
 * - Llegó al tope de sellos del mes, o el portero no contesta: la caja de la red, con su frase y su acción.
 */

export interface OpcionesDeLaCompuerta {
  /** A dónde vuelve el foco al cerrarse el paso de la cuenta. */
  volverA?: HTMLElement | null;
  /** Mientras se le pregunta al portero (hasta 6 segundos la primera vez). */
  alRevisar?: (revisando: boolean) => void;
  /** La persona eligió «Usar un cupón» (la caja de la red): sin acceso, el paso abre en el campo del cupón. */
  cupon?: boolean;
}

/** Cuántas veces se vuelve a mirar después de que la persona usó el paso, como mucho: nunca un ir y venir sin fin. */
const VUELTAS = 3;

async function revisar(para: "sello" | "sorteo", ganadores: number | undefined, o: OpcionesDeLaCompuerta): Promise<Acceso> {
  o.alRevisar?.(true);
  try {
    // Siempre lo de ahora: lo que se supo hace un rato puede ser de antes del último sello.
    return await consultarAcceso(currentSession()?.address, para, ganadores, { forzar: true });
  } finally {
    o.alRevisar?.(false);
  }
}

/**
 * Abre «Dejá tu cuenta lista» para conseguir el acceso. `true` si la persona siguió; si salió o no bajó, `false`. Con
 * `cupon`, la persona eligió «Usar un cupón»: el paso abre directo en el campo del cupón (o con el que ya tenga guardado).
 */
async function abrirElPaso(para: "sello" | "sorteo", volverA: HTMLElement | null | undefined, cupon = false): Promise<boolean> {
  let flujo: typeof import("./cuenta-lista-flujo");
  try {
    flujo = await import("./cuenta-lista-flujo");
  } catch {
    avisarQueNoCargo();
    return false;
  }
  return cupon ? flujo.abrirParaElError(para, volverA ?? null, { cupon: "escribir" }) : flujo.abrirParaElError(para, volverA ?? null);
}

export type EleccionSinSorteos = "cupon" | "prueba" | "cerrar" | "comprar" | "regalo";

/**
 * De dónde saca la ventana lo que se vende, el regalo y si la cuenta nunca tuvo sorteos oficiales. Sin decirlo, del
 * servidor (las pruebas los reemplazan). Con `aviso`, la clave del texto que dice por qué no llegó el regalo que se acaba
 * de pedir, en lugar del de siempre.
 */
export interface OpcionesDeSeAcabaron {
  oferta?: () => Promise<Oferta>;
  regalo?: () => Promise<number | null>;
  nuncaTuvo?: () => Promise<boolean | null>;
  aviso?: string;
}

/** Lo que no se sabe del regalo: ni regalo disponible ni si la cuenta tuvo sorteos. */
const SIN_LECTURA: LecturaDelRegalo = { disponible: null, nuncaTuvo: null };

/**
 * Lo que dice del regalo la única lectura del estado por cuenta (`leerElRegalo` del flujo): cuántos sorteos puede recibir
 * ahora y si se sabe que nunca tuvo sorteos oficiales. Si no se puede bajar o no contesta, nada: la ventana de siempre.
 */
async function lecturaDeLaSesion(): Promise<LecturaDelRegalo> {
  try {
    return await (await import("./cuenta-lista-flujo")).leerElRegalo();
  } catch {
    return SIN_LECTURA;
  }
}

/**
 * «Recibirlos» desde «Se te acabaron»: pide el regalo y dice cómo salió (`recibirRegalo` del flujo). Si no se puede bajar,
 * el aviso de que no cargó y `no-cargo`: ahí no hay nada que volver a ofrecer.
 */
async function recibirElRegalo(): Promise<ReciboDelRegalo | "no-cargo"> {
  try {
    return await (await import("./cuenta-lista-flujo")).recibirRegalo();
  } catch {
    avisarQueNoCargo();
    return "no-cargo";
  }
}

/**
 * «Se te acabaron» hasta que la persona elige algo que no es un regalo que no llegó: si toca «Recibirlos» y no llega, la
 * ventana vuelve a abrirse con lo que pasó, nunca se cierra callada. Sin red o sin servicio dice que no se pudo (y, si el
 * regalo sigue disponible, «Recibirlos» vuelve a estar para probar de nuevo); si el servidor contestó sin sorteos, que hoy
 * ya se entregaron. Cada vuelta espera a que la persona elija: cerrar la ventana termina. `recibido`: llegó el regalo.
 */
async function elegirSinSorteos(): Promise<Exclude<EleccionSinSorteos, "regalo"> | "recibido"> {
  let aviso: string | undefined;
  for (;;) {
    const eleccion = await abrirSeAcabaron(aviso ? { aviso } : {});
    if (eleccion !== "regalo") return eleccion;
    const r = await recibirElRegalo();
    if (r === "dado") return "recibido";
    if (r === "no-cargo") return "cerrar";
    aviso = r === "error" ? "cupoOfRegaloError" : "altaBienvenidaLlena";
  }
}

/**
 * Cuánto espera «Se te acabaron», como mucho, el regalo, lo que se vende y si nunca tuvo sorteos antes de mostrar sus
 * botones. Casi siempre ya están leídos y no espera nada.
 */
export const TOPE_DE_LECTURA_MS = 1_200;

/** El enlace chico de la ventana: un botón con forma de texto subrayado. */
function enlaceChico(texto: string, accion: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "login-link sin-sorteos-enlace";
  b.dataset.accion = accion;
  b.textContent = texto;
  return b;
}

/**
 * La ventana «Se te acabaron los sorteos oficiales». Devuelve lo que eligió la persona: «Recibirlos» (el regalo),
 * «Sortear en Prueba» (ya pedido el cambio de modo), «Sumar sorteos» (solo si el servidor vende un paquete ahora),
 * «Tengo un cupón» o cerrarla.
 *
 * Un título, una línea y un botón principal, en este orden:
 * - Con el regalo de quien entra con su cuenta disponible: «Ya podés recibir tus 3 sorteos gratis.», con «Recibirlos»
 *   como principal y «Sortear en Prueba» a la vista. Sumar sorteos no va: el regalo no se cobra y, si al recibirlo no
 *   alcanza, la ventana vuelve con lo que se vende.
 * - Sin venta: «En Prueba funciona igual, pero no cuenta…», con «Sortear en Prueba» como principal.
 * - Con venta: «Sumá más para que este cuente…», con «Sumar sorteos» como principal y «Sortear en Prueba» a la vista.
 * - Si se sabe que nunca tuvo sorteos oficiales, el título dice «Todavía no tenés sorteos oficiales», con lo del caso.
 *   Sin el regalo y sin venta, la línea dice que hoy ya se entregaron y que se pueden recibir más tarde.
 *
 * Puede estar proyectada frente a la sala: comprar nunca va de entrada, solo cuando el servidor dice que se vende.
 * «Sortear en Prueba» nunca va gris: con la guarda del cambio de modo cerrada no se muestra, y sin regalo ni venta el
 * cupón pasa a ser la principal para que la ventana tenga siempre una acción. Con `aviso`, su texto queda en la línea
 * pase lo que pase con el regalo y lo que se vende: es lo que la persona tiene que leer.
 *
 * Los botones salen cuando se sabe el regalo, lo que se vende y si nunca tuvo sorteos, o al tope con lo que se sepa
 * (`TOPE_DE_LECTURA_MS`). Mientras tanto, solo la línea de espera. Lo que llega después del tope no cambia la principal
 * que ya está a la vista: se suma como segunda, y el regalo con su línea.
 */
export function abrirSeAcabaron(o: OpcionesDeSeAcabaron = {}): Promise<EleccionSinSorteos> {
  return new Promise((resolve) => {
    let listo = false;
    const terminar = (e: EleccionSinSorteos): void => {
      if (listo) return;
      listo = true;
      resolve(e);
    };
    const dlg = abrirDialogo({ titulo: t("cupoOfCeroTitulo"), onCerrar: () => terminar("cerrar") });
    dlg.card.classList.add("sin-sorteos");
    const titulo = dlg.card.querySelector<HTMLElement>(".dlg-h");
    const texto = document.createElement("p");
    if (o.aviso) texto.setAttribute("role", "alert");
    dlg.cuerpo.appendChild(texto);
    const elegir = (e: EleccionSinSorteos, despues?: () => void) => (): void => {
      terminar(e);
      dlg.cerrar();
      despues?.();
    };
    let prueba: HTMLButtonElement | null = null;
    if (puedeCambiarDeModo()) {
      prueba = document.createElement("button");
      prueba.type = "button";
      prueba.dataset.accion = "prueba";
      prueba.textContent = t("pagoSortearEnPrueba");
      prueba.addEventListener("click", elegir("prueba", () => void practicarEnPrueba()));
    }
    const cupon = enlaceChico(t("altaTengoCupon"), "cupon");
    cupon.addEventListener("click", elegir("cupon"));
    /** Lo que se supo después de abrir: el regalo disponible, el botón de sumar y si nunca tuvo sorteos. */
    let regalo: number | null = null;
    let sumar: HTMLButtonElement | null = null;
    let nunca = false;
    let recibir: HTMLButtonElement | null = null;
    /**
     * La principal que ya se ve. Lo que llega después no la cambia: un botón que salta bajo el dedo lleva a donde la
     * persona no quería (a Prueba, sin el regalo). Lo que llega tarde se suma como segunda.
     */
    let fija: HTMLButtonElement | null = null;
    /** Arma el título, la línea y el pie con lo que se sabe: una sola principal por caso. */
    const pintar = (): void => {
      if (titulo) titulo.textContent = t(nunca ? "pagoNuncaTuvoTitulo" : "cupoOfCeroTitulo");
      const conRegalo = regalo !== null ? recibir : null;
      const principal = fija ?? conRegalo ?? sumar ?? prueba ?? cupon;
      fija = principal;
      // Quien nunca tuvo sorteos y no tiene el regalo a mano es porque hoy ya se entregaron: lo mismo que el final del
      // paso de la cuenta, para que sepa que los va a recibir.
      const sinElDeHoy = `${t("altaBienvenidaLlena")} ${t("altaBienvenidaMasTarde")}`;
      const deSiempre = conRegalo
        ? t("cupoOfRegaloListo").replace("{n}", String(regalo))
        : principal === sumar
          ? t("cupoOfCeroTexto")
          : nunca
            ? sinElDeHoy
            : t("cupoOfCeroTextoSinVenta");
      texto.textContent = o.aviso ? t(o.aviso) : deSiempre;
      for (const b of [recibir, sumar, prueba]) if (b) b.className = b === principal ? "dlg-main" : "mini ghost";
      cupon.className = principal === cupon ? "dlg-main" : "login-link sin-sorteos-enlace";
      // Con el regalo, Sumar sorteos no va (salvo que ya fuera la principal cuando llegó).
      const resto = [recibir, conRegalo && principal !== sumar ? null : sumar, prueba, cupon];
      dlg.pie.replaceChildren(principal, ...resto.filter((b): b is HTMLButtonElement => b !== null && b !== principal));
    };
    // Mientras llega lo que decide la principal, nada que se pueda tocar: solo la línea de espera.
    let pintada = false;
    const espera = lineaDeEstado();
    espera.textContent = t("clRevisando");
    texto.hidden = true;
    dlg.pie.replaceChildren(espera);
    const alSaber = (): void => {
      if (!listo && pintada) pintar();
    };
    // Una sola lectura del regalo para las dos preguntas, y solo si alguna falta.
    let lectura: Promise<LecturaDelRegalo> | null = null;
    const leer = (): Promise<LecturaDelRegalo> => (lectura ??= lecturaDeLaSesion());
    // El regalo (casi siempre ya está leído: la línea del cupo lo pidió antes).
    const regaloLeido = (o.regalo ?? (() => leer().then((l) => l.disponible)))().then(
      (n) => {
        if (listo || n === null || !(n > 0)) return;
        regalo = n;
        recibir = botonPrincipal(t("cupoOfRecibir"));
        recibir.dataset.accion = "regalo";
        recibir.addEventListener("click", elegir("regalo"));
        alSaber();
      },
      () => undefined,
    );
    // Si nunca tuvo sorteos oficiales, de la misma lectura del regalo: cambia el título.
    const nuncaLeido = (o.nuncaTuvo ?? (() => leer().then((l) => l.nuncaTuvo)))().then(
      (v) => {
        if (listo || v !== true) return;
        nunca = true;
        alSaber();
      },
      () => undefined,
    );
    // Lo que se vende (casi siempre ya está leído: la línea del cupo lo pidió antes).
    const ofertaLeida = (o.oferta ?? leerOferta)().then(
      (oferta) => {
        if (listo || oferta.paquetes.length === 0) return;
        sumar = botonPrincipal(t("cupoOfSumar"));
        sumar.dataset.accion = "comprar";
        sumar.addEventListener("click", elegir("comprar"));
        alSaber();
      },
      () => undefined,
    );
    // Los botones salen cuando se sabe todo, o al tope con lo que se sepa.
    let tope: ReturnType<typeof setTimeout> | undefined;
    const alTope = new Promise<void>((r) => {
      tope = setTimeout(r, TOPE_DE_LECTURA_MS);
    });
    void Promise.race([Promise.all([regaloLeido, nuncaLeido, ofertaLeida]), alTope]).then(() => {
      clearTimeout(tope);
      if (listo) return;
      pintada = true;
      texto.hidden = false;
      pintar();
    });
  });
}

/** «Sumar sorteos» desde «Se te acabaron»: la ventana de los paquetes. `true` si llegó el pago. */
async function sumarSorteos(): Promise<boolean> {
  try {
    const flujo = await import("./cuenta-lista-flujo");
    return await flujo.abrirSumarSorteos();
  } catch {
    avisarQueNoCargo();
    return false;
  }
}

/** El no del portero, o del candado de antes de la firma, es que no quedan sorteos oficiales que alcancen. */
export const esSinSorteos = (e: unknown): boolean => esNoDelPortero(e) && e.motivo === "sin-sorteos";

/** Después de un sello que no salió por falta de sorteos: la ventana y, si elige «Tengo un cupón», el paso. */
export async function alQuedarseSinSorteos(o: OpcionesDeLaCompuerta = {}): Promise<void> {
  const eleccion = await elegirSinSorteos();
  if (eleccion === "cupon") await abrirElPaso("sello", o.volverA, true);
  else if (eleccion === "comprar") await sumarSorteos();
}

/**
 * La compuerta del sello: `true` si se puede pedir la firma. Si no, ya dijo por qué (o abrió lo que hace falta) y
 * devuelve `false`.
 */
export async function accesoParaSellar(ganadores: number, o: OpcionesDeLaCompuerta = {}): Promise<boolean> {
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    const a = await revisar("sello", ganadores, o);
    switch (a.que) {
      case "sigue":
        return true;
      case "sin-acceso":
        // La primera vez, el paso de la cuenta. Si sale de él, o volvió y sigue sin acceso, se dice por qué no se selló.
        if (vuelta === 0 && (await abrirElPaso("sello", o.volverA, o.cupon === true))) continue;
        await mostrarSinPatrocinio({ motivo: "ajena" });
        return false;
      case "sin-sorteos": {
        const eleccion = await elegirSinSorteos();
        if (eleccion === "cupon" && (await abrirElPaso("sello", o.volverA, true))) continue;
        // Llegó el pago de un paquete: se vuelve a mirar, y con sorteos que alcancen se sella.
        if (eleccion === "comprar" && (await sumarSorteos())) continue;
        // Llegó el regalo: se vuelve a mirar, y con sorteos que alcancen se sella.
        if (eleccion === "recibido") continue;
        return false;
      }
      case "tope-mes":
        await mostrarSinPatrocinio({ motivo: "cupo-cuenta", que: "sellos", ...(a.liberaEn !== undefined ? { liberaEn: a.liberaEn } : {}) });
        return false;
      case "cerrado":
        await mostrarSinPatrocinio({ motivo: "cerrado" });
        return false;
    }
  }
  return false;
}

/**
 * La compuerta del sorteo: el acceso, y nada más. Si no deja seguir, la clave de lo que se le dice a la persona (quien
 * llama la escribe donde va el error del sorteo).
 */
export async function accesoParaSortear(o: OpcionesDeLaCompuerta = {}): Promise<{ sigue: true } | { sigue: false; clave: string }> {
  let a = await revisar("sorteo", undefined, o);
  if (a.que === "sin-acceso" && (await abrirElPaso("sorteo", o.volverA))) a = await revisar("sorteo", undefined, o);
  if (a.que === "sigue") return { sigue: true };
  return { sigue: false, clave: a.que === "sin-acceso" ? "errAnchor.porteroSinAlta" : "errAnchor.porteroFondoSorteo" };
}
