import { app } from "../state";
import { campanasActivo } from "../campana/bandera";
import { VIDA_PREMIO_MS, esInvitada, leerPremio, marcarPremio, soltarInvitada, soltarPremio } from "../campana/invitada";
import { compraQrActiva } from "../stellar/alta-config";
import { network } from "../stellar/config";
import { enPractica, sinGrabar } from "../ensayo-modo";
import { activeWallet } from "../stellar/wallet-lite";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import type { Acceso, ReclamoDelRegalo, ResultadoDeAlta } from "../stellar/alta-api";
import type { Para } from "./cuenta-lista-estado";
import type { OpcionesDelPaso } from "./cuenta-lista";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import { consumirPasoDelCupon, hayPedidoDePasoDelCupon } from "./cupon-paso";
import { pideElPremioAqui } from "./premio-pide";

/**
 * Cuándo se abre «Dejá tu cuenta lista» (`cuenta-lista.ts`), y las compuertas del sello y del sorteo.
 *
 * Aplica solo con las cuatro juntas: modo Oficial (la red principal), una cuenta de Google o de correo (la billetera de
 * Pollar), fuera de la demo, del ensayo y del stand, y con la sesión abierta. Si no, todo devuelve «sigue» sin bajar
 * ningún módulo nuevo: en Prueba y con Freighter el sitio se porta como siempre. Lo primero que se mira es la red.
 *
 * Los momentos:
 * - al entrar y al retomar la sesión (`revisarCuentaOficial`), si falta algo, salvo con un sorteo sellado sin sortear o
 *   con la espera, la tarjeta del juego, la cortina o el estadio a la vista («Nada se abre solo», `docs/ux.md`);
 * - al tocar «Sellar la lista» (`cuentaListaParaGrabar("sello")`), revisando con tope de 4 segundos si la memoria no
 *   dice que está lista;
 * - al sortear (`cuentaListaParaGrabar("sorteo")`), solo con la memoria y sin red: el sorteo se lanza solo desde la
 *   espera;
 * - cuando el sello o el sorteo fallan por la cuenta (`abrirParaElError`, desde `proteger-flujo.ts`).
 *
 * Quien participó en el sorteo de una empresa (la marca de invitada de `src/campana/invitada.ts`) no organiza: lo que se
 * abre solo (al entrar y al retomar la sesión) se queda cerrado, salvo la entrada de quien ganó, que lo pide con su
 * permiso (`permitirPasoDelPremio`). Lo que pide un toque (sellar, sortear, arreglar el error, Tus dólares) sigue
 * abriéndose: sellar, sortear o arreglar el error es organizar, y suelta la marca.
 */

/** Lo que el flujo le mira a la billetera de Pollar sin cargar su módulo (ya está cargado si es la activa). */
interface BilleteraOficial {
  submitsItself: true;
  address: string | null;
  label: string;
  estadoOficialLocal(): { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" };
  estadoOficial(fresco?: boolean): Promise<EstadoOficial>;
}

function billetera(): BilleteraOficial | null {
  const w = activeWallet() as unknown as Partial<BilleteraOficial> | null;
  if (!w || w.submitsItself !== true || typeof w.estadoOficialLocal !== "function" || typeof w.estadoOficial !== "function") return null;
  return w as BilleteraOficial;
}

/**
 * La sesión que ve el acceso al modo Oficial: el token, si sigue abierta y la cuenta. Pagar con el saldo (`pagar`) va
 * solo si la billetera activa es la del proveedor, la de Google o de correo: con cualquier otra, no se ofrece.
 */
function sesionDelAcceso(wp: typeof import("../stellar/wallet-pollar"), ui: typeof import("./wallet-ui")): import("./cuenta-lista-acceso").SesionDelAcceso {
  return {
    token: () => wp.pollarWallet.tokenDeSesion(),
    sesionViva: () => wp.pollarWallet.sesionViva(),
    cuenta: () => ui.currentSession()?.address ?? null,
    ...(activeWallet() === wp.pollarWallet ? { pagar: (p: Parameters<typeof wp.pollarWallet.pagarOrden>[0]) => wp.pollarWallet.pagarOrden(p) } : {}),
  };
}

/** El paso aplica: modo Oficial, cuenta de Google o de correo con la sesión abierta, y no es la demo, el ensayo ni el stand. */
export function aplica(): boolean {
  if (network.name !== "mainnet") return false;
  if (sinGrabar()) return false;
  const w = billetera();
  return !!w && !!w.address;
}

/** Sin red: la memoria dice que falta activar la cuenta. Es lo que mira el sorteo, que puede lanzarse sin un toque. */
export function faltaEnLaMemoria(): boolean {
  if (!aplica()) return false;
  try {
    return billetera()?.estadoOficialLocal().activacion === "falta";
  } catch {
    return false;
  }
}

/** Algo le falta a la cuenta. Lo que no se sabe no cuenta: se vuelve a mirar al sellar. */
export function faltaAlgo(e: EstadoOficial): boolean {
  return e.activacion === "falta" || e.activacion === "preparando" || e.activacion === "fallo" || e.proteccion === "falta" || e.proteccion === "aparato-nuevo" || e.proteccion === "sin-forma";
}

/** Lo que tapa la página para la sala, o un sorteo sellado sin sortear: el paso no se abre solo encima. */
const SALA = ".espera, .game-card, .cortina, .sala, .stand-sala.grande";
export function nadaSeAbreSolo(): boolean {
  if (app.frozen && !app.drawn) return true;
  return typeof document !== "undefined" && document.querySelector(SALA) !== null;
}

/** Quien participó en el sorteo de una empresa, en este navegador y en las últimas 48 horas. Sin las campañas, nunca. */
function invitada(): boolean {
  if (!campanasActivo()) return false;
  try {
    return esInvitada(localStorage, Date.now());
  } catch {
    return false;
  }
}

/** Sellar, sortear o arreglar el error es organizar: quien lo pide con un toque deja de ser solo invitada. */
function soltarLaMarca(): void {
  try {
    soltarInvitada(localStorage);
  } catch {
    /* sin almacenamiento, no hay marca que soltar */
  }
}

function pestana(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * El permiso de la entrada del premio vale para una cuenta. Vive en la memoria de la página y también en la pestaña por 30
 * minutos (`invitada.ts`): sobrevive a una recarga y se copia a la ventana de Google que esa pestaña abre. Con `null` se
 * apaga: la cuenta cambió, se cerró la sesión o terminó el paso.
 */
let cuentaDelPremio: string | null = null;
/** Hasta cuándo vale el permiso de la memoria: los mismos 30 minutos de la marca de la pestaña, y no más. */
let venceElPremio = 0;
export function permitirPasoDelPremio(cuenta: string | null): void {
  cuentaDelPremio = cuenta;
  venceElPremio = cuenta === null ? 0 : Date.now() + VIDA_PREMIO_MS;
  const p = pestana();
  if (!p) return;
  if (cuenta === null) soltarPremio(p);
  else marcarPremio(p, Date.now(), cuenta);
}

/** Esta pestaña espera a quien ganó: el permiso queda pendiente hasta la primera sesión, que lo toma para su cuenta. */
export function esperarAQuienGano(): void {
  const p = pestana();
  if (p) marcarPremio(p, Date.now());
}

/** El permiso vale para la cuenta de ahora: el de la memoria, o el de la pestaña (que, pendiente, se queda con la primera). */
export function pasoDelPremio(): boolean {
  const cuenta = billetera()?.address ?? null;
  // El permiso de la memoria vence con el de la pestaña: pasados los 30 minutos, quien sigue acá organiza como siempre.
  if (cuentaDelPremio !== null && Date.now() >= venceElPremio) cuentaDelPremio = null;
  if (cuentaDelPremio !== null) return cuenta === cuentaDelPremio;
  const p = pestana();
  const marca = p ? leerPremio(p, Date.now()) : null;
  if (!marca) return false;
  if (marca.cuenta !== null) return cuenta === marca.cuenta;
  if (cuenta !== null) permitirPasoDelPremio(cuenta);
  return true;
}

/** En esta carga se atendió la ventana de Google (`campana-ventana.ts`): esa pestaña no es para usar la herramienta. */
let ventanaAtendida = false;
export function callarPasoEnEstaCarga(): void {
  ventanaAtendida = true;
}

/**
 * Nada de lo que se abre solo se abre en esta carga: mandan la entrada del premio (su permiso, o la dirección que todavía la
 * pide) o la ventana de Google. Sin esto, el paso de quien organiza le ganaría a la ventana del premio.
 */
function cedeAlPremio(): boolean {
  return ventanaAtendida || pasoDelPremio() || pideElPremioAqui();
}

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, no) => {
    reloj = setTimeout(() => no(new Error("tope")), ms);
  });
  return Promise.race([p, tope]).finally(() => clearTimeout(reloj));
}

export const TOPE_AL_ENTRAR_MS = 8_000;
export const TOPE_AL_SELLAR_MS = 4_000;

type Extra = Pick<OpcionesDelPaso, "inicial" | "volverA" | "alSeguir" | "alAbrir" | "cupon">;

/** Cómo terminó el intento de abrir el paso: se abrió (y la promesa dice qué eligió la persona) o no se pudo bajar. */
type Apertura = { abrio: true; eleccion: Promise<boolean> } | { abrio: false };

/**
 * Baja lo que el paso necesita y lo abre, sin esperar a que se cierre. Si la descarga falla (el wifi de un evento), lo
 * dice con un aviso que ofrece volver a cargar la página, y no se abre: en Oficial no se sigue, pero tampoco en silencio.
 */
async function prepararPaso(para: Para, extra: Extra = {}): Promise<Apertura> {
  let mods: [
    typeof import("./cuenta-lista"),
    typeof import("../stellar/wallet-pollar"),
    typeof import("./wallet-ui"),
    typeof import("./modo-ui"),
    typeof import("./cuenta-lista-acceso"),
  ];
  let alSeguir = extra.alSeguir;
  try {
    mods = await Promise.all([
      import("./cuenta-lista"),
      import("../stellar/wallet-pollar"),
      import("./wallet-ui"),
      import("./modo-ui"),
      import("./cuenta-lista-acceso"),
    ]);
    if (para === "entrada-con-lista" && !alSeguir) {
      // Sella en el mismo toque del botón del final: `freeze` ya tiene que estar cargado.
      const { freeze } = await import("./freeze");
      alSeguir = () => void freeze();
    }
  } catch (e) {
    console.warn("[tinkazo] no se pudo bajar el paso de la cuenta", e);
    avisarQueNoCargo();
    return { abrio: false };
  }
  const [{ abrirCuentaLista }, wp, ui, modo, { fuenteDelAcceso }] = mods;
  // La activación lee la transacción con el SDK de Stellar: se baja mientras la persona mira el paso.
  void import("@stellar/stellar-sdk").catch(() => undefined);
  try {
    const sesion = ui.currentSession();
    const porCorreo = wp.pollarWallet.label === "Email";
    // El acceso al modo Oficial (W3): el servidor, con el token de la sesión verificada, o cerrado sin él.
    const acceso = fuenteDelAcceso(sesionDelAcceso(wp, ui));
    const eleccion = abrirCuentaLista(
      wp.pollarWallet,
      {
        // Quien cierra la sesión se lleva el permiso del premio: el de la cuenta siguiente es otro.
        cerrarSesion: () => {
          permitirPasoDelPremio(null);
          return ui.cerrarSesion();
        },
        pasarAPrueba: () => void modo.pasarAModo("testnet"),
        practicarEnPrueba: () => void modo.practicarEnPrueba(),
        puedePasarAPrueba: () => modo.puedeCambiarDeModo(),
        // Con el correo, la ventana abre con el correo a la vista (detrás de Otras formas de entrar, desplegado).
        entrarDeNuevo: () => (porCorreo ? ui.openPicker({ otras: true }) : ui.entrar()),
      },
      {
        para,
        correo: sesion?.mail,
        viaCorreo: porCorreo,
        direccion: sesion?.address ?? null,
        puedeUsarDesbloqueo: () => wp.puedeUsarDesbloqueo(),
        primerOficial: { pendiente: () => modo.haceFaltaConfirmar(network.name, modo.yaConfirmoPrimerOficial()), marcar: () => modo.marcarPrimerOficial() },
        inicial: extra.inicial,
        volverA: extra.volverA,
        alAbrir: extra.alAbrir,
        alSeguir,
        acceso,
        cupon: extra.cupon,
      },
    );
    return { abrio: true, eleccion };
  } catch (e) {
    console.warn("[tinkazo] no se pudo abrir el paso de la cuenta", e);
    avisarQueNoCargo();
    return { abrio: false };
  }
}

/** Abre el paso y espera lo que elija la persona: `true` si siguió con la cuenta lista. Si no se pudo abrir, `false`. */
async function abrirPaso(para: Para, extra: Extra = {}): Promise<boolean> {
  const a = await prepararPaso(para, extra);
  return a.abrio ? a.eleccion : false;
}

/** Hay una lista lista para sellar: dos nombres o más, sin sorteo sellado y fuera de la práctica (como `avisarQueYaEntro`). */
async function hayListaLista(): Promise<boolean> {
  if (app.frozen || enPractica()) return false;
  try {
    const { parseNames } = await import("./participants");
    return parseNames().length >= 2;
  } catch {
    return false;
  }
}

/**
 * Al entrar o al retomar la sesión: si a la cuenta le falta algo, abre el paso. Si lo local ya dice que falta activar
 * (lo normal en una cuenta nueva), se abre enseguida, sin esperar la red; si no, se revisa de fondo con tope de 8
 * segundos y se abre solo si falta algo. Devuelve si lo abrió: si no se pudo bajar, `false` y el aviso de volver a cargar
 * (no espera a que se cierre).
 */
export async function revisarCuentaOficial(origen: "entrada" | "retomar"): Promise<boolean> {
  // La entrada del premio o la ventana de Google mandan: el paso se abre por el botón de quien ganó, con textos de premio.
  if (cedeAlPremio()) return false;
  if (!aplica() || nadaSeAbreSolo()) return false;
  const w = billetera();
  if (!w) return false;
  // La acción Tengo un cupón pidió este campo antes de recargar en Oficial. La elección se consume solo si el paso abre:
  // si la descarga falla, la próxima carga todavía tiene que poder abrirlo.
  if (hayPedidoDePasoDelCupon()) {
    // Lo pidió un toque (Tengo un cupón): quien lo pidió organiza, y la marca de invitada ya no va.
    soltarLaMarca();
    const a = await prepararPaso("entrada", { cupon: "escribir" });
    if (a.abrio) consumirPasoDelCupon();
    return a.abrio;
  }
  // Quien participó no organiza: lo que se abre solo se queda cerrado.
  if (invitada()) return false;
  let inicial: Partial<EstadoOficial> | null;
  const local = w.estadoOficialLocal();
  if (local.activacion === "falta") inicial = { activacion: "falta" };
  else {
    if (local.activacion === "lista" && local.proteccion === "lista") return false;
    let e: EstadoOficial;
    try {
      e = await conTope(w.estadoOficial(true), TOPE_AL_ENTRAR_MS);
    } catch {
      return false;
    }
    if (!faltaAlgo(e)) return false;
    if (!aplica() || nadaSeAbreSolo()) return false;
    inicial = e;
  }
  const para: Para = origen === "entrada" && (await hayListaLista()) ? "entrada-con-lista" : "entrada";
  // Devuelve si se abrió de verdad (después de bajarlo), no si la persona ya terminó.
  return (await prepararPaso(para, { inicial })).abrio;
}

/** Sabe decir, sin red, si el paso se va a abrir apenas entra: así la página no anuncia la entrada dos veces. */
export function vaAAbrirseAlEntrar(): boolean {
  if (!aplica() || cedeAlPremio() || invitada()) return false;
  try {
    return billetera()?.estadoOficialLocal().activacion === "falta";
  } catch {
    return false;
  }
}

export interface ParaGrabar {
  volverA?: HTMLElement | null;
  /** Mientras se revisa la cuenta (hasta 4 segundos), el botón queda apagado y dice «Revisando tu cuenta…». */
  alRevisar?: (revisando: boolean) => void;
  /** Lo que hace el botón del final dentro de su toque (pedir la pantalla completa). */
  alSeguir?: () => void;
  /** Al abrirse el paso (soltar lo que pidió el toque de antes). */
  alAbrir?: () => void;
}

/**
 * La compuerta del sello y del sorteo: `true` si se puede seguir en Oficial. Fuera del modo Oficial o sin cuenta de
 * Pollar, siempre `true` y sin esperar nada. Con todo listo en memoria, `true` sin esperar. Para el sello, si la memoria
 * no lo sabe, revisa con tope de 4 segundos; para el sorteo, solo la memoria. Si falta algo o no se pudo saber, abre el
 * paso y devuelve lo que la persona eligió en él.
 */
export async function cuentaListaParaGrabar(para: "sello" | "sorteo", o: ParaGrabar = {}): Promise<boolean> {
  if (!aplica()) return true;
  const w = billetera();
  if (!w) return true;
  soltarLaMarca();
  const local = w.estadoOficialLocal();
  if (para === "sorteo") {
    if (local.activacion !== "falta") return true;
    return abrirPaso("sorteo", { ...o, inicial: { activacion: "falta" } });
  }
  if (local.activacion === "lista" && local.proteccion === "lista") return true;
  o.alRevisar?.(true);
  let e: EstadoOficial | null = null;
  try {
    e = await conTope(w.estadoOficial(true), TOPE_AL_SELLAR_MS);
  } catch {
    e = null;
  } finally {
    o.alRevisar?.(false);
  }
  if (e && e.activacion === "lista" && e.proteccion === "lista") return true;
  return abrirPaso("sello", { ...o, inicial: e });
}

/**
 * «Tus dólares digitales» con una cuenta de Google o de correo a la que le falta algo para recibir (crearse o
 * protegerse): el paso, abierto por el toque de la persona. Se abre como al entrar, con Seguir al final. `true` si siguió
 * con la cuenta lista. Solo con el permiso de la entrada del premio se abre para recibir (`premio`): sin cupón, sin compra y
 * sin Pasar a Prueba. La marca de invitada sola no alcanza: quien participó y no ganó nada no recibe un premio, y puede
 * organizar, así que ve el paso de siempre. Siempre viene de un toque, así que la marca de invitada no lo frena.
 */
export async function abrirDesdeTusDolares(): Promise<boolean> {
  if (!aplica()) return false;
  const recibe = pasoDelPremio();
  const siguio = await abrirPaso(recibe ? "premio" : "entrada");
  // Con la cuenta lista el permiso ya no hace falta: se apaga, y la marca de la pestaña con él.
  if (recibe && siguio) permitirPasoDelPremio(null);
  return siguio;
}

/**
 * El sello o el sorteo fallaron por la cuenta (falta protegerla, confirmar este navegador, activarla o el acceso al modo
 * Oficial): el paso. Con `cupon: "escribir"` («Usar un cupón» de la ventana «Se te acabaron»), abre en el campo del cupón.
 */
export async function abrirParaElError(para: "sello" | "sorteo", volverA: HTMLElement | null, o: Pick<OpcionesDelPaso, "cupon"> = {}): Promise<boolean> {
  if (!aplica()) return false;
  soltarLaMarca();
  return abrirPaso(para, { volverA, ...(o.cupon ? { cupon: o.cupon } : {}) });
}

/**
 * «Sumar sorteos» con la cuenta ya lista (la ventana de los paquetes, `pago-paquete.ts`), con el servidor de las altas y
 * la sesión de ahora. Lo abren «Se te acabaron los sorteos oficiales» y la línea del cupo. Sin la compra en el build, o
 * fuera de Oficial con una cuenta de Google o de correo, no abre nada. `true` si llegó el pago. Nunca lanza.
 */
export async function abrirSumarSorteos(o: { producto?: string | null } = {}): Promise<boolean> {
  if (!aplica()) return false;
  let mods: [typeof import("./pago-paquete"), typeof import("../stellar/wallet-pollar"), typeof import("./wallet-ui"), typeof import("./cuenta-lista-acceso"), typeof import("./cuenta-estado")];
  try {
    mods = await Promise.all([import("./pago-paquete"), import("../stellar/wallet-pollar"), import("./wallet-ui"), import("./cuenta-lista-acceso"), import("./cuenta-estado")]);
  } catch (e) {
    console.warn("[tinkazo] no se pudo bajar la ventana de sumar sorteos", e);
    avisarQueNoCargo();
    return false;
  }
  const [paquete, wp, ui, { fuenteDelAcceso }, { ocultarCorreo }] = mods;
  try {
    const sesion = sesionDelAcceso(wp, ui);
    const acceso = fuenteDelAcceso(sesion);
    if (typeof acceso !== "object") return false;
    const { oferta, orden, pago, saldo } = acceso;
    if (!oferta || !orden || !pago) return false;
    // La compra con QR, solo con su bandera en el build: apagada, no se baja nada ni se pregunta nada.
    const qr = compraQrActiva() ? await compraConQr(wp, ui, sesion, { oferta, refrescarCupo: () => acceso.refrescarCupo() }) : null;
    // Con una compra con QR ya cargada el dinero puede estar en camino: Tu compra la retoma donde quedó.
    const enCurso = qr?.compraQr.abierta?.cargada ? qr.compraQr.abierta.producto : null;
    if (qr && enCurso) {
      qr.alQr(enCurso);
      return false;
    }
    return await paquete.abrirSumarSorteos(
      { oferta: () => oferta(), orden: (p) => orden(p), pago: (id) => pago(id), refrescarCupo: () => acceso.refrescarCupo(), ...(saldo ? { saldo } : {}), ...(acceso.preguntarAntesDePagar ? { preguntarAntesDePagar: true } : {}) },
      { correo: ocultarCorreo(ui.currentSession()?.mail ?? ""), producto: o.producto ?? null, ...(qr ? { alQr: qr.alQr, medio: qr.medio } : {}) },
    );
  } catch (e) {
    console.warn("[tinkazo] no se pudo abrir la ventana de sumar sorteos", e);
    return false;
  }
}

/**
 * El acceso del servidor con la sesión de ahora, solo si sabe pedir el regalo; si no, `null`. Fuera de Oficial con una
 * cuenta de Google o de correo, o si no se pudo bajar, también `null`. Nunca lanza.
 */
async function accesoConRegalo(): Promise<{ cuenta: string; acceso: import("./cuenta-lista").AccesoDelPaso } | null> {
  if (!aplica()) return null;
  try {
    const [wp, ui, { fuenteDelAcceso }] = await Promise.all([
      import("../stellar/wallet-pollar"),
      import("./wallet-ui"),
      import("./cuenta-lista-acceso"),
    ]);
    const cuenta = ui.currentSession()?.address ?? null;
    const acceso = fuenteDelAcceso(sesionDelAcceso(wp, ui));
    return cuenta && typeof acceso === "object" && acceso.reclamar ? { cuenta, acceso } : null;
  } catch {
    return null;
  }
}

/**
 * Lo que dice del regalo la única lectura del estado por sesión: cuántos sorteos puede recibir ahora (`disponible`, o
 * `null`) y si se sabe que la cuenta nunca tuvo sorteos oficiales (`nuncaTuvo`, `null` si no se sabe).
 */
export interface LecturaDelRegalo {
  disponible: number | null;
  nuncaTuvo: boolean | null;
}

const SIN_LECTURA: LecturaDelRegalo = { disponible: null, nuncaTuvo: null };

/** Los accesos que llegan con sorteos: el cupón y la compra. */
const LLEGAN_CON_SORTEOS: readonly Acceso[] = ["cupon", "pago"];
/** Los accesos que nacen sin sorteos: el alta del regalo (`admin`) y la de quien ganó un premio. */
const NACEN_SIN_SORTEOS: readonly Acceso[] = ["admin", "premio"];

/**
 * Si la cuenta tuvo sorteos oficiales alguna vez, por el acceso y el regalo. Con el cupón o la compra, sí. Con un alta
 * que nace sin sorteos y el regalo todavía sin recibir (`bienvenida` en el estado, que el servidor manda hasta que lo
 * recibe), nunca. Lo demás no se sabe.
 */
function nuncaTuvoSorteos(acceso: Acceso, sinRecibirElRegalo: boolean): boolean | null {
  if (LLEGAN_CON_SORTEOS.includes(acceso)) return false;
  return sinRecibirElRegalo && NACEN_SIN_SORTEOS.includes(acceso) ? true : null;
}

/** Lo que se supo del regalo en esta carga de la página, por cuenta: una sola lectura del estado por sesión. */
let regaloSabido: { cuenta: string; promesa: Promise<LecturaDelRegalo> } | null = null;

/**
 * Lo que dice del regalo el servidor para la persona de esta sesión. Lo pregunta una sola vez por cuenta en esta carga
 * de la página (lo llaman la línea del cupo con cero sorteos y «Se te acabaron»). Sin el regalo en el servidor (el de
 * antes, que no lo manda), sin respuesta o con cualquier duda, nada se sabe. Una lectura que no salió (sin red, el
 * servicio) no se recuerda: la próxima vez se pregunta de nuevo. Nunca lanza.
 */
export async function leerElRegalo(): Promise<LecturaDelRegalo> {
  const a = await accesoConRegalo();
  if (!a) return SIN_LECTURA;
  if (regaloSabido?.cuenta === a.cuenta) return regaloSabido.promesa;
  const sabido: { cuenta: string; promesa: Promise<LecturaDelRegalo> } = { cuenta: a.cuenta, promesa: Promise.resolve(SIN_LECTURA) };
  const olvidar = (): LecturaDelRegalo => {
    if (regaloSabido === sabido) regaloSabido = null;
    return SIN_LECTURA;
  };
  sabido.promesa = a.acceso.estado().then((r) => {
    if (!r.ok) return olvidar();
    if (r.datos.acceso === "ninguno") return SIN_LECTURA;
    const b = r.datos.bienvenida;
    return { disponible: b?.estado === "lista" ? b.sorteos : null, nuncaTuvo: nuncaTuvoSorteos(r.datos.acceso, b !== undefined) };
  }, olvidar);
  regaloSabido = sabido;
  return sabido.promesa;
}

/** Si la persona de esta sesión puede recibir el regalo ahora: cuántos sorteos trae, o `null` (`leerElRegalo`). */
export async function regaloDisponible(): Promise<number | null> {
  return (await leerElRegalo()).disponible;
}

/**
 * Cómo salió «Recibirlos»: `dado` con sorteos para sellar, `sin-sorteos` si el servidor contestó pero no quedaron (hoy
 * no se da, o ya lo había recibido), y `error` si no se supo (sin red, el servicio, o no hay cómo pedirlo).
 */
export type ReciboDelRegalo = "dado" | "sin-sorteos" | "error";

/**
 * «Recibirlos»: pide el regalo para la cuenta que ya tiene el acceso y vuelve a preguntar el cupo (la línea se entera
 * sola). Si el servidor contestó, en esta carga no se vuelve a ofrecer: lo da una vez por persona, y si hoy no se da, la
 * línea vuelve a la de siempre. Si no se supo, se puede ofrecer otra vez (la próxima lectura pregunta). Nunca lanza.
 */
export async function recibirRegalo(): Promise<ReciboDelRegalo> {
  const a = await accesoConRegalo();
  if (!a?.acceso.reclamar) return "error";
  // Mientras se pide, no se ofrece. Si nunca tuvo sorteos, se sigue sabiendo hasta que lleguen.
  const antes = regaloSabido?.cuenta === a.cuenta ? regaloSabido.promesa : Promise.resolve(SIN_LECTURA);
  const pedido: { cuenta: string; promesa: Promise<LecturaDelRegalo> } = {
    cuenta: a.cuenta,
    promesa: antes.then((l) => ({ disponible: null, nuncaTuvo: l.nuncaTuvo }), () => SIN_LECTURA),
  };
  regaloSabido = pedido;
  let r: ResultadoDeAlta<ReclamoDelRegalo> | null = null;
  try {
    r = await a.acceso.reclamar();
    a.acceso.refrescarCupo();
  } catch {
    r = null;
  }
  if (r?.ok) {
    if (r.datos.sorteos.quedan <= 0) return "sin-sorteos";
    if (regaloSabido === pedido) pedido.promesa = Promise.resolve({ disponible: null, nuncaTuvo: false });
    return "dado";
  }
  if (regaloSabido === pedido) regaloSabido = null;
  return "error";
}

/** Olvida lo que se supo del regalo (las pruebas). */
export function olvidarElRegalo(): void {
  regaloSabido = null;
}

/**
 * Tu compra con el QR del banco desde Sumar sorteos (`compra-entrada.ts`): si el servidor se la ofrece a esta cuenta, el
 * medio deducido y quién abre la ventana con el paquete elegido. `null` si no se ofrece o no se pudo bajar. Solo se llama
 * con la compra con QR en el build.
 */
async function compraConQr(
  wp: typeof import("../stellar/wallet-pollar"),
  ui: typeof import("./wallet-ui"),
  sesion: import("./cuenta-lista-acceso").SesionDelAcceso,
  acceso: { oferta: () => Promise<import("../stellar/alta-oferta").Oferta>; refrescarCupo: () => void },
): Promise<{ alQr: (producto: string) => void; medio: "qr" | "app"; compraQr: import("../stellar/alta-api").CompraQrDelEstado } | null> {
  try {
    const [{ entradaDeLaCompra, abrirTuCompra }, { porteroDeLaCompra }] = await Promise.all([import("./compra-entrada"), import("./cuenta-lista-acceso")]);
    const portero = porteroDeLaCompra(sesion);
    const entrada = await entradaDeLaCompra({ estado: () => portero.estado() });
    if (!entrada) return null;
    const alQr = (producto: string): void => {
      void (async () => {
        const oferta = await acceso.oferta();
        const elegido = [...(oferta.alta ? [oferta.alta] : []), ...oferta.paquetes].find((x) => x.id === producto);
        if (!elegido) return;
        abrirTuCompra({
          producto: elegido,
          oferta,
          compraQr: entrada.compraQr,
          billetera: wp.pollarWallet,
          portero,
          cuenta: () => ui.currentSession()?.address ?? null,
          marcaDelPago: (nota) => wp.leerMarcaDelPago(nota),
          afuera: (accion) => void afueraDeLaCompra(accion, wp, ui),
          alCerrar: (s) => {
            if (s.pago?.fase === "listo") acceso.refrescarCupo();
          },
        });
      })().catch((e: unknown) => {
        console.warn("[tinkazo] no se pudo abrir Tu compra", e);
        avisarQueNoCargo();
      });
    };
    return { alQr, medio: entrada.medio, compraQr: entrada.compraQr };
  } catch (e) {
    console.warn("[tinkazo] no se pudo bajar la compra con QR", e);
    return null;
  }
}

/** Lo que sigue fuera de Tu compra: entrar de nuevo, proteger la cuenta o usar un cupón. Lo demás solo cierra. */
async function afueraDeLaCompra(accion: import("./compra-qr").AccionDeAfuera, wp: typeof import("../stellar/wallet-pollar"), ui: typeof import("./wallet-ui")): Promise<void> {
  if (accion === "entrar") return void (wp.pollarWallet.label === "Email" ? ui.openPicker({ otras: true }) : ui.entrar());
  if (accion === "proteger") return void (await abrirDesdeTusDolares());
  if (accion === "usar-cupon") return void (await abrirParaElError("sello", null, { cupon: "escribir" }));
}
