import { premiosDeLaCuentaDeLaRed, type VistaDeLosPremios } from "../campana/premios-de-la-cuenta";
import { claveDelResultadoDeLaLinea, textoDelPremio } from "../campana/textos-premios";
import { campanasActivo } from "../campana/bandera";
import { esc } from "../dom";
import { getLang } from "../idioma";
import { network, txUrl, RPC_URLS, type NetworkName } from "../stellar/config";
import { type ResultadoDeLinea } from "../stellar/linea-propia";
import type { ResultadoDeActivarUsdc } from "../stellar/wallet-pollar";
import { contratoDePremios, passphraseDe, type ContratoDePremios } from "../stellar/oficiales";
import type { ErrorDeLaPromocion } from "../stellar/premios";
import { abrirDialogo, type Dialogo } from "./dialogo";
import { filasDeLosPremios, montoLegible, type FilaDeLosPremios } from "./premios-lista";
/**
 * La pantalla del celular de quien ganó un premio de una campaña (issue #175), abierta con el gancho de
 * «si ganó» que dejó el registro (issue #172).
 *
 * Un toque = abrir la línea: la única firma del ganador es `activarUsdc` (con el proveedor) o la línea
 * propia (`linea-propia.ts`), de la misma manera que la ventana del saldo la pide. El reclamo NO lo firma
 * acá: lo llama la entrega programada (issue #176), y mientras tanto la pantalla muestra que el premio
 * está en camino y mira la red por su cuenta, cada tanto, con el reloj que le inyectan.
 *
 * La red es la única fuente: la promoción y el estado de cada premio se leen del contrato de premios con
 * `get_prize` (`campana/premios-de-la-cuenta.ts`), sin servidor. Y en la misma ventana está Tus premios:
 * la lista entera de la cuenta, leída de la red.
 *
 * Modo de solo recibir: nada de Mandar, ni de cargar dólares, ni de la dirección de la cuenta. Cada
 * pantalla dice un título (Ganaste, siempre arriba cuando hay un premio a la vista), una línea y, cuando
 * hay algo que tocar, una sola acción principal. Lo que cambia en la red se repinta solo cuando cambia:
 * dos miradas que ven lo mismo no tocan la pantalla.
 */

/** Cómo terminó el toque que abre la línea: suyos, del proveedor, o que no salió. */
export type ResultadoDeActivacion = ResultadoDeLinea | ResultadoDeActivarUsdc | "no-salio";

/** Lo que la ventana le pide al sitio. En las pruebas, un reemplazo. */
export interface DepsDePremio {
  red: NetworkName;
  /** La cuenta con que entró la persona: la de la sesión del proveedor, sea acá o en otro equipo. */
  cuenta: string;
  /** El contrato de premios de la campaña y el número de su promoción, como los dice la campaña. */
  contrato: string;
  promo: string;
  /** Hasta cuándo se puede recibir el premio (ms), como lo dijo la campaña. */
  recibirHastaMs: number;
  /** Los premios de la cuenta, leídos de la red en el momento. Nunca lanza. */
  premios: () => Promise<VistaDeLosPremios>;
  /** Abre la línea del dólar digital: la única firma que pide la pantalla. */
  activar: () => Promise<ResultadoDeActivacion>;
  /** El hash de la transacción que pagó el premio, cuando se la sabe. `null` o sin esto: todavía no. */
  txDelPago?: () => Promise<string | null>;
  /** El reloj, inyectado. */
  ahora: () => number;
  pausa: (ms: number) => Promise<void>;
  cada: (f: () => void, ms: number) => () => void;
  /** La fecha límite escrita para mostrar. Sin esto, la fecha corta del idioma de la pantalla. */
  fecha?: (hastaMs: number) => string;
}

/** Lo que cualquier entrada necesita para abrir la pantalla: la cuenta y la promoción de la campaña. */
export interface DatosDelPremio {
  cuenta: string;
  contrato: string;
  promo: string;
  recibirHastaMs: number;
}

/** Cuánto espera el observador entre dos miradas de la red (30 segundos: el claim llega por su cuenta). */
const CADA_MS = 30_000;

type Pantalla = "mirando" | "leer-error" | "sin-premio" | "recibir" | "activando" | "linea" | "en-camino" | "listo" | "volvio";

interface Ventana {
  d: Dialogo;
  boton: HTMLButtonElement;
  hacer: (() => void) | null;
  deps: DepsDePremio;
  abierta: boolean;
  /** Lo que la pantalla dice ahora, y lo que necesitó para decirlo. */
  estado: { pantalla: Pantalla; resultado: ResultadoDeActivacion | null; error: ErrorDeLaPromocion | null };
  /** La última buena lectura de la red: la que pinta Ganaste y Tus premios. */
  ultimaBuena: VistaDeLosPremios | null;
  /** La línea ya se abrió: mientras la red diga Por recibir, la pantalla dice En camino. */
  activada: boolean;
  /** El enlace a la transacción del pago, cuando se sabe mostrar. */
  enlace: string | null;
  /** Qué hay pintado, para repintar solo cuando cambia. */
  mostrado: string;
  /** Si el observador está mirando, y cómo para de mirar. */
  observando: boolean;
  parar: (() => void) | null;
}

const tx = (clave: string, vars: Record<string, string> = {}): string => textoDelPremio(clave, vars);

const idiomaDe = (): "es" | "en" => (getLang() === "en" ? "en" : "es");

/** La fecha límite escrita: la corta del idioma de la pantalla, como le gusta verla a la persona. */
const fechaCorta = (ms: number): string => new Intl.DateTimeFormat(getLang(), { dateStyle: "short" }).format(ms);

/** Los renglones de Tus premios, de la última buena lectura de la red. */
function filasDe(v: Ventana): FilaDeLosPremios[] {
  if (!v.ultimaBuena?.ok) return [];
  return filasDeLosPremios({ premios: v.ultimaBuena, idioma: idiomaDe(), fecha: v.deps.fecha ?? fechaCorta }).filas;
}

/** La firma de lo que hay en pantalla: cambia cuando lo que la persona ve tiene que cambiar. */
function firmaDe(v: Ventana): string {
  return JSON.stringify({ pantalla: v.estado.pantalla, resultado: v.estado.resultado, error: v.estado.error, filas: filasDe(v), enlace: v.enlace });
}

/** Mira la red y decide qué pantalla toca. Nunca repinta dos veces la misma cosa. */
async function mirar(v: Ventana): Promise<void> {
  let vista: VistaDeLosPremios;
  try {
    vista = await v.deps.premios();
  } catch {
    vista = { ok: false, error: "red-caida" };
  }
  if (!v.abierta) return;
  if (!vista.ok) {
    poner(v, vista, { pantalla: "leer-error", error: vista.error });
    return;
  }
  const primero = vista.premios[0];
  if (vista.premios.length === 0) {
    poner(v, vista, { pantalla: "sin-premio" });
    return;
  }
  if (primero?.estado === "volvio") {
    dejarDeMirar(v);
    poner(v, vista, { pantalla: "volvio" });
    return;
  }
  if (primero?.estado === "recibido") {
    dejarDeMirar(v);
    poner(v, vista, { pantalla: "listo" });
    void averiguarElEnlace(v);
    return;
  }
  // Por recibir: con la línea ya abierta es En camino, hasta que la red diga otra cosa.
  poner(v, vista, { pantalla: v.activada ? "en-camino" : "recibir" });
}

/** Cambia lo que la pantalla dice y repinta solo si lo que se ve cambió. */
function poner(v: Ventana, vista: VistaDeLosPremios | null, cambios: { pantalla: Pantalla; resultado?: ResultadoDeActivacion | null; error?: ErrorDeLaPromocion | null }): void {
  if (vista !== null && vista.ok) v.ultimaBuena = vista;
  v.estado = { pantalla: cambios.pantalla, resultado: cambios.resultado ?? null, error: cambios.error ?? null };
  pintar(v);
}

/** El premio quedó: pagado o devuelto, no hay nada más que mirar. */
function dejarDeMirar(v: Ventana): void {
  v.parar?.();
  v.parar = null;
  v.observando = false;
}

/**
 * Repinta la ventana: Ganaste arriba (con el monto, si la red lo dijo), la línea de lo que pasa, la
 * acción principal dentro del paso que la pide y, siempre, Tus premios.
 */
function pintar(v: Ventana): void {
  if (!v.abierta) return;
  const firma = firmaDe(v);
  if (firma === v.mostrado) return;
  v.mostrado = firma;
  const filas = filasDe(v);
  const monto = filas.length > 0 ? filas[0]?.monto ?? null : null;
  const secciones: string[] = [];
  if (filas.length > 0) {
    secciones.push(
      `<section class="pr-gano" data-premio="gano">` +
      `<h3 class="pr-titulo" data-premio="gano-titulo">${esc(tx("prGanoTitulo"))}</h3>` +
      (monto === null ? "" : `<p class="pr-monto" data-premio="gano-monto">${esc(tx("prGanoMonto", { monto }))}</p>`) +
      `</section>`,
    );
  }
  /** La acción principal, si hay algo que tocar: va adentro del paso, con su texto y su hacer. */
  let principal: { texto: string; hacer: () => void } | null = null;
  const claveDelError = v.estado.error === "red-caida" || v.estado.error === "sin-estado" ? "prErrRed" : "prErrRaro";
  switch (v.estado.pantalla) {
    case "mirando":
      secciones.push(`<p class="pr-lead" data-premio="mirando">${esc(tx("prMirando"))}</p>`);
      break;
    case "leer-error":
      secciones.push(
        `<section class="pr-paso" data-premio="leer-error">` +
        `<p class="pr-lead" data-premio="leer-error-linea">${esc(tx(claveDelError))}</p></section>`,
      );
      principal = { texto: tx("prOtraVez"), hacer: () => void mirar(v) };
      break;
    case "sin-premio":
      secciones.push(
        `<section class="pr-paso" data-premio="sin-premio">` +
        `<p class="pr-lead" data-premio="sin-premio-linea">${esc(tx("prSinPremioLinea"))}</p></section>`,
      );
      break;
    case "recibir":
      secciones.push(`<section class="pr-paso" data-premio="recibir"></section>`);
      principal = { texto: tx("prRecibirBtn"), hacer: () => void pedirLaLinea(v) };
      break;
    case "activando":
      secciones.push(`<section class="pr-paso" data-premio="activando"><p class="pr-lead">${esc(tx("prActivando"))}</p></section>`);
      break;
    case "linea": {
      const clave = claveDelResultadoDeLaLinea(v.estado.resultado ?? "");
      const vuelveAMirar = v.estado.resultado === "enviada" || v.estado.resultado === "en-curso" || v.estado.resultado === "hecho" || v.estado.resultado === "cuenta-creandose";
      secciones.push(
        `<section class="pr-paso" data-premio="linea">` +
        `<p class="pr-lead" data-premio="linea-texto">${esc(tx(clave))}</p></section>`,
      );
      principal = vuelveAMirar ? { texto: tx("prVolverAMirar"), hacer: () => void mirar(v) } : { texto: tx("prOtraVez"), hacer: () => void pedirLaLinea(v) };
      break;
    }
    case "en-camino":
      secciones.push(
        `<section class="pr-paso" data-premio="en-camino">` +
        `<p class="pr-lead" data-premio="en-camino-linea">${esc(tx("prEnCaminoLinea"))}</p></section>`,
      );
      break;
    case "listo":
      secciones.push(
        `<section class="pr-paso" data-premio="listo">` +
        `<p class="pr-lead" data-premio="listo-linea">${esc(tx("prListoLinea"))}</p>` +
        (v.enlace === null ? "" : `<a class="pr-enlace" data-premio="listo-enlace" href="${esc(v.enlace)}" target="_blank" rel="noopener">${esc(tx("prListoEnlaceTx"))}</a>`) +
        `</section>`,
      );
      break;
    case "volvio":
      secciones.push(
        `<section class="pr-paso" data-premio="volvio">` +
        `<p class="pr-lead" data-premio="volvio-linea">${esc(tx("prVolvioLinea"))}</p></section>`,
      );
      break;
  }
  // Tus premios, en la misma ventana: la lista entera de la cuenta, leída de la red.
  secciones.push(
    `<section class="pr-premios" data-premio="lista">` +
    `<h4 class="pr-lista-titulo">${esc(tx("prPremiosTitulo"))}</h4>` +
    (filas.length === 0
      ? `<p class="pr-lead">${esc(tx("prPremiosVacio"))}</p>`
      : `<ul class="pr-lista">${filas.map((f) => {
          const texto = textoDelPremio(f.texto.clave, f.texto.vars ?? {});
          return `<li class="pr-premio">${f.monto === null ? "" : `<b class="pr-premio-monto">${esc(f.monto)}</b> `}${esc(texto)}</li>`;
        }).join("")}</ul>`) +
    `</section>`,
  );
  v.d.cuerpo.innerHTML = `<article class="pr-ventana" data-premio="ventana">${secciones.join("")}</article>`;
  // La principal va dentro del paso que la pide; sin acción, no hay botón que engañe.
  if (principal) {
    v.boton.textContent = principal.texto;
    if (!v.boton.isConnected) v.d.cuerpo.querySelector(`[data-premio="${v.estado.pantalla}"]`)?.append(v.boton);
    v.hacer = principal.hacer;
  } else {
    v.hacer = null;
    v.boton.remove();
  }
}

/** El toque: abre la línea con activar y sigue sola. Los resultados que esperan se dicen con su botón. */
async function pedirLaLinea(v: Ventana): Promise<void> {
  v.estado = { pantalla: "activando", resultado: null, error: null };
  pintar(v);
  const r: ResultadoDeActivacion = await v.deps.activar().catch(() => "no-salio" as const);
  if (!v.abierta) return;
  if (r === "activada") {
    v.activada = true;
    poner(v, null, { pantalla: "en-camino" });
    ponerElObservador(v);
    return;
  }
  poner(v, null, { pantalla: "linea", resultado: r });
}

/** El observador del premio: mira la red cada tanto, con el reloj que le inyectaron. */
function ponerElObservador(v: Ventana): void {
  if (v.observando || !v.abierta) return;
  v.observando = true;
  v.parar = v.deps.cada(() => {
    if (v.abierta && v.observando) void mirar(v);
  }, CADA_MS);
}

/** El enlace a la transacción del pago, cuando se lo puede saber. Sin él, Listo igual. */
async function averiguarElEnlace(v: Ventana): Promise<void> {
  if (!v.deps.txDelPago) return;
  const hash = await Promise.resolve(v.deps.txDelPago()).then((valor) => valor ?? null).catch(() => null);
  if (!hash || !v.abierta || v.estado.pantalla !== "listo") return;
  v.enlace = txUrl(hash, v.deps.red);
  pintar(v);
}

/** El reloj del sitio. */
const reloj = {
  ahora: () => Date.now(),
  pausa: (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms)),
  cada: (f: () => void, ms: number): (() => void) => {
    const t = setInterval(f, ms);
    return () => clearInterval(t);
  },
};

/** Los datos que la campaña le pasa a la ventana, con las dependencias que faltan compuestas encima. */
function depsDe(o: DatosDelPremio, deps: Partial<DepsDePremio>): DepsDePremio {
  return {
    red: network.name,
    ...reloj,
    ...deps,
    ...o,
  } as DepsDePremio;
}

/**
 * Abre la pantalla del premio. Con la bandera de campañas apagada no abre nada. `deps` reemplaza lo del
 * sitio (en las pruebas). Devuelve si abrió, para que la entrada sepa si toca seguir.
 */
export function abrirPremioDeLaCampana(o: DatosDelPremio, deps: Partial<DepsDePremio> = {}): boolean {
  if (!campanasActivo()) return false;
  const v: Ventana = {
    d: undefined as unknown as Dialogo,
    boton: undefined as unknown as HTMLButtonElement,
    hacer: null,
    deps: depsDe(o, deps),
    abierta: true,
    estado: { pantalla: "mirando", resultado: null, error: null },
    ultimaBuena: null,
    activada: false,
    enlace: null,
    mostrado: "",
    observando: false,
    parar: null,
  };
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "dlg-main";
  boton.dataset.premio = "principal";
  v.boton = boton;
  boton.addEventListener("click", () => v.hacer?.());
  v.d = abrirDialogo({
    titulo: tx("prGanoTitulo"),
    onCerrar: () => {
      v.abierta = false;
      v.parar?.();
    },
  });
  v.d.card.classList.add("dlg-premio");
  pintar(v);
  void mirar(v);
  return true;
}

/**
 * Lo que el sitio le da a la ventana, para abrir de verdad. La línea la abre el proveedor (activarUsdc)
 * o la billetera propia; los premios se leen del contrato de premios de la campaña; y el pago se busca en
 * Horizon de la cuenta, para el enlace a la transacción cuando el premio está en tu cuenta.
 */
export function depsDelSitio(o: DatosDelPremio): DepsDePremio {
  // El contrato de premios de la campaña: el designado por la tabla de la red, o el que la campaña misma
  // nombró (con el RPC y la frase de la red, sin el código, porque la puerta del premio ya lo designó).
  const contrato: ContratoDePremios = contratoDePremios(network.name, o.contrato) ?? {
    red: network.name,
    contractId: o.contrato,
    rpcUrl: RPC_URLS[network.name],
    passphrase: passphraseDe(network.name),
  };
  return {
    red: network.name,
    cuenta: o.cuenta,
    contrato: o.contrato,
    promo: o.promo,
    recibirHastaMs: o.recibirHastaMs,
    premios: () => premiosDeLaCuentaDeLaRed({ contrato, promo: o.promo, cuenta: o.cuenta, recibirHastaMs: o.recibirHastaMs }),
    txDelPago: async () => {
      const [{ pagosEntrantes }, { contextoHorizon }] = await Promise.all([import("../../workers/cuenta/src/pagos"), import("../stellar/carga")]);
      const lectura = await pagosEntrantes(o.cuenta, contextoHorizon(), (acumulados) => acumulados.some((p) => p.de === o.contrato)).catch(() => ({ ok: false }) as const);
      if (!lectura.ok) return null;
      return lectura.valor.find((p) => p.de === o.contrato)?.tx ?? null;
    },
    activar: async () => {
      const [{ activeWallet }, { submitsItself, pollarWallet }, { activarLineaPropia }] = await Promise.all([
        import("../stellar/wallet-lite"),
        import("../stellar/wallet-pollar"),
        import("../stellar/linea-propia"),
      ]);
      const w = activeWallet();
      if (!w?.address) return "sin-red";
      if (submitsItself(w)) return pollarWallet.activarUsdc();
      return activarLineaPropia(network.name, w.address, w);
    },
    fecha: fechaCorta,
    ...reloj,
  };
}
