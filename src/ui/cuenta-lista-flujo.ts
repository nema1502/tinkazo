import { t } from "../i18n";
import { app } from "../state";
import { compraQrActiva } from "../stellar/alta-config";
import { network } from "../stellar/config";
import { enPractica, sinGrabar } from "../ensayo-modo";
import { activeWallet } from "../stellar/wallet-lite";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import type { Para } from "./cuenta-lista-estado";
import type { OpcionesDelPaso } from "./cuenta-lista";
import { avisarQueNoCargo } from "./aviso-no-cargo";

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
  let mods: [typeof import("./cuenta-lista"), typeof import("../stellar/wallet-pollar"), typeof import("./wallet-ui"), typeof import("./modo-ui"), typeof import("./cuenta-estado"), typeof import("./cuenta-lista-acceso")];
  let alSeguir = extra.alSeguir;
  try {
    mods = await Promise.all([import("./cuenta-lista"), import("../stellar/wallet-pollar"), import("./wallet-ui"), import("./modo-ui"), import("./cuenta-estado"), import("./cuenta-lista-acceso")]);
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
  const [{ abrirCuentaLista }, wp, ui, modo, { claveDelAviso }, { fuenteDelAcceso }] = mods;
  // La activación lee la transacción con el SDK de Stellar: se baja mientras la persona mira el paso.
  void import("@stellar/stellar-sdk").catch(() => undefined);
  try {
    const sesion = ui.currentSession();
    // Se arma en cada pintada: con los botones ES y EN del paso, la línea cambia de idioma con todo lo demás.
    const aviso = (): string | undefined => {
      const e = ui.estadoDeLaCuenta();
      return e.estado === "dentro" ? `${t(claveDelAviso(e)).replace("{n}", e.nombre)}.` : undefined;
    };
    const porCorreo = wp.pollarWallet.label === "Email";
    // El acceso al modo Oficial (W3): el servidor, con el token de la sesión verificada, o cerrado sin él.
    const acceso = fuenteDelAcceso(sesionDelAcceso(wp, ui));
    const eleccion = abrirCuentaLista(
      wp.pollarWallet,
      {
        cerrarSesion: () => ui.cerrarSesion(),
        pasarAPrueba: () => void modo.pasarAModo("testnet"),
        puedePasarAPrueba: () => modo.puedeCambiarDeModo(),
        entrarDeNuevo: () => (porCorreo ? ui.openPicker() : ui.entrar()),
      },
      {
        para,
        correo: sesion?.mail,
        viaCorreo: porCorreo,
        aviso,
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
  if (!aplica() || nadaSeAbreSolo()) return false;
  const w = billetera();
  if (!w) return false;
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
  if (!aplica()) return false;
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
 * con la cuenta lista.
 */
export async function abrirDesdeTusDolares(): Promise<boolean> {
  if (!aplica()) return false;
  return abrirPaso("entrada");
}

/**
 * El sello o el sorteo fallaron por la cuenta (falta protegerla, confirmar este navegador, activarla o el acceso al modo
 * Oficial): el paso. Con `cupon: "escribir"` («Usar un cupón» de la ventana «Se te acabaron»), abre en el campo del cupón.
 */
export async function abrirParaElError(para: "sello" | "sorteo", volverA: HTMLElement | null, o: Pick<OpcionesDelPaso, "cupon"> = {}): Promise<boolean> {
  if (!aplica()) return false;
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
  if (accion === "entrar") return void (wp.pollarWallet.label === "Email" ? ui.openPicker() : ui.entrar());
  if (accion === "proteger") return void (await abrirDesdeTusDolares());
  if (accion === "usar-cupon") return void (await abrirParaElError("sello", null, { cupon: "escribir" }));
}
