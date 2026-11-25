/**
 * Las dependencias reales de lo que la herramienta le cuenta a la sala de la campaña (`campana-resultado.ts`): la sala que
 * recuerda esta compu, la pantalla del sorteo, el reloj de la ronda y el servicio del acceso. Se arma una sola vez al cargar
 * la página (`arrancarElPuente`), con la bandera de campañas prendida, y no depende de que el panel se monte: un aviso
 * pendiente sale igual después de una recarga o de volver de la ventana de Google sin `?campana`.
 */
import { type EstadoDeAltaPremio, cuentaConectada, entradaDelEvento, guardarSorteoDeCampana } from "../campana/en-curso";
import { registrarAcciones, ponerPaso } from "../campana/puente";
import { nombreDelEquipo } from "../equipos/etiquetas";
import { sinGrabar } from "../ensayo-modo";
import { listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/quicknet";
import { horaDeLaRonda, relojComprobado } from "../reloj-de-la-ronda";
import {
  type FaseDeSala,
  type MemoriaDeOrg,
  type SalaDeCampana,
  avisarEnSala,
  estadoConToken,
  guardarOrg,
  completarLaCuentaDeLaMemoria,
  guardarResultadoEnSala,
  leerOrg,
  ponerSellada,
  puedeMoverLaSala,
  resultadoDeSala,
} from "../sala/campana-org";
import { app } from "../state";
import { altaPremioAbierta, admitirPorPremio } from "../stellar/alta-api";
import { network } from "../stellar/config";
import { activeWallet } from "../stellar/wallet-lite";
import { type AltasDelSorteo, crearAltas } from "./campana-altas";
import {
  type DepsDelResultado,
  alRevelar,
  escucharComprobante,
  escucharSellos,
  pasoDelSelloPorConfirmar,
  registrarLasAcciones,
  retomarAlArrancar,
} from "./campana-resultado";
import { sorteoEnMarcha } from "./sorteo-en-marcha";

const ORDEN_DE_FASES: readonly FaseDeSala[] = ["lista", "abierta", "cerrada", "sellada", "sorteada"];

function almacen(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** La última hora que dijo la sala y cuándo (en el reloj de esta pestaña) la dijo. */
let horaDeLaSala: { ms: number; marca: number } | null = null;

/**
 * La hora para decidir si se llega a tiempo: la del reloj de la ronda (el que cuenta la espera). Si ese reloj todavía no se
 * midió, la compu puede estar atrasada y se mandarían avisos después de la ronda: se toma además la hora de la sala, la
 * cabecera de su última respuesta, y manda la más adelantada.
 */
function ahoraDeLaRonda(): number {
  const propia = horaDeLaRonda() * 1000;
  if (relojComprobado() || horaDeLaSala === null) return propia;
  return Math.max(propia, horaDeLaSala.ms + (performance.now() - horaDeLaSala.marca));
}

/**
 * La memoria de la sala solo si esta cuenta la puede mover: la que la organiza, o la campaña no nombra a nadie. Sin la cuenta
 * dueña conectada no sale ningún aviso de sellada ni de resultado con el token guardado, y una memoria de antes (sin cuenta
 * guardada) espera a que el panel la complete con la sesión.
 */
function memoriaPropia(): MemoriaDeOrg | null {
  const conectada = cuentaConectada();
  const memoria = leerOrg(almacen(), Date.now(), network.name, conectada);
  return memoria && puedeMoverLaSala(memoria.cuenta, conectada) ? memoria : null;
}

function salaGuardada(): SalaDeCampana | null {
  return memoriaPropia()?.sala ?? null;
}

const cuentaCorta = (cuenta: string): string => `${cuenta.slice(0, 4)}…${cuenta.slice(-4)}`;

/** Si quien organiza entró con la cuenta de Google: la billetera activa es la que da el token de la sesión. */
function sesionDeGoogle(): { tokenDeSesion: () => Promise<string | null> } | null {
  const w = activeWallet() as unknown as { tokenDeSesion?: () => Promise<string | null> } | null;
  return w && typeof w.tokenDeSesion === "function" ? { tokenDeSesion: () => w.tokenDeSesion?.() ?? Promise.resolve(null) } : null;
}

let altasReales: AltasDelSorteo | null = null;
let ganadorasDeLasAltas: readonly string[] = [];

function altas(sorteo: string): AltasDelSorteo {
  altasReales ??= crearAltas({
    token: async () => (await sesionDeGoogle()?.tokenDeSesion()) ?? null,
    abierta: () => altaPremioAbierta(activeWallet()?.address ?? ""),
    admitir: (token, p) => admitirPorPremio(token, p),
    ahora: () => Date.now(),
    esperar: (ms) => new Promise<void>((seguir) => void setTimeout(seguir, ms)),
    estados: () => altasGuardadas(),
    guardar: (puesto, estado) => {
      const e = entradaActual();
      if (e) guardarSorteoDeCampana({ ...e, sorteo: e.sorteo ?? sorteo, altas: { ...(e.altas ?? {}), [String(puesto)]: estado } });
    },
  });
  return altasReales;
}

function entradaActual() {
  const sala = salaGuardada();
  return sala ? entradaDelEvento(network.name, sala.evento) : null;
}

function altasGuardadas(): Record<string, EstadoDeAltaPremio> {
  return entradaActual()?.altas ?? {};
}

/**
 * Deja el cuadro listo para sellar de nuevo cuando la sala no aceptó el sello, también si el show ya pasó (la sala se pregunta
 * recién pasada la ronda): con un sorteo hecho en pantalla, es el mismo camino de Usar otra lista. Un juego en marcha o la
 * pantalla grande abierta no se cortan: ahí no hace nada, y el paso vuelve a decir que la lista está sellada.
 */
export async function soltarParaSellarDeNuevo(): Promise<void> {
  if (app.frozen === null) return void (await import("./freeze")).unfreeze("");
  if (sorteoEnMarcha(app.frozen) || document.fullscreenElement) return;
  if (app.drawn === null) return void (await import("./freeze")).unfreeze("");
  (await import("./draw")).newDraw("otraLista");
}

let depsUnicas: DepsDelResultado | null = null;

export function depsDelResultadoReales(): DepsDelResultado {
  depsUnicas ??= {
    sala: salaGuardada,
    faseDeLaSala: () => memoriaPropia()?.fase ?? null,
    fijarFase: (fase) => {
      const memoria = memoriaPropia();
      if (memoria && ORDEN_DE_FASES.indexOf(memoria.fase) < ORDEN_DE_FASES.indexOf(fase)) guardarOrg(almacen(), { ...memoria, fase });
    },
    entrada: entradaActual,
    guardar: guardarSorteoDeCampana,
    sellado: () => {
      const f = app.frozen;
      return f ? { raffleId: f.raffleId, names: f.names, sinSello: f.sinSello === true, round: f.round } : null;
    },
    sorteado: () => {
      const f = app.frozen;
      const d = app.drawn;
      if (!f || !d) return null;
      const ganadoras = d.noCoincide ? null : d.winners.map((i) => f.names[i]).filter((c): c is string => c !== undefined);
      return { guardado: d.guardado === true, ganadoras };
    },
    sinGrabar,
    contrato: () => network.contractId,
    ahora: ahoraDeLaRonda,
    anotarHoraDeLaSala: (ms) => {
      if (ms !== null) horaDeLaSala = { ms, marca: performance.now() };
    },
    huella: (names) => bytesToHex(listHash([...names])),
    ponerSellada: (s, sorteo, plazo) => ponerSellada(s, sorteo, {}, plazo),
    estado: (s) => estadoConToken(s),
    guardarResultado: (s, sorteo, comprobante) => guardarResultadoEnSala(s, sorteo, comprobante),
    // Una lista de ganadoras mezclada se trata como una lectura que falló. El paso del resultado la manda a su propio aviso más adelante.
    resultado: async (s) => {
      const leido = await resultadoDeSala(s);
      return leido === "mezclada" ? "red" : leido;
    },
    avisar: (s, cuenta) => avisarEnSala(s, cuenta),
    // Un juego en marcha o la pantalla grande abierta no se cortan: solo se muestra la línea.
    sePuedeSoltar: () => app.frozen !== null && app.drawn === null && !sorteoEnMarcha(app.frozen) && !document.fullscreenElement,
    soltarElSello: soltarParaSellarDeNuevo,
    nombreDe: (cuenta) => nombreDelEquipo(cuenta) ?? cuentaCorta(cuenta),
    sinPoderMoverLaSala: () => {
      const conectada = cuentaConectada();
      const memoria = leerOrg(almacen(), Date.now(), network.name, conectada);
      return memoria !== null && !puedeMoverLaSala(memoria.cuenta, conectada);
    },
    completarLaCuenta: () => completarLaCuentaDeLaMemoria(almacen(), Date.now(), network.name, cuentaConectada()),
    otraBilletera: () => sesionDeGoogle() === null,
    // Tras una recarga la sesión se retoma aparte (`wallet-ui.ts`): sin billetera activa todavía no se sabe cuál es.
    billeteraPendiente: () => activeWallet() === null,
    alLlegarLaSesion: (f) => {
      document.addEventListener("tinkazo:sesion", f);
      return () => document.removeEventListener("tinkazo:sesion", f);
    },
    iniciarAltas: (sorteo, ganadoras, alCambiar) => {
      ganadorasDeLasAltas = ganadoras;
      void altas(sorteo).iniciar(sorteo, ganadoras, alCambiar);
    },
    altasDe: altasGuardadas,
    esperar: (ms) => new Promise<void>((seguir) => void setTimeout(seguir, ms)),
  };
  return depsUnicas;
}

let arrancado = false;

/**
 * Todo lo que la herramienta hace por una campaña de empresa, sin esperar al panel: escuchar el sello (y el sello que entra
 * tarde), el comprobante que llega con la grabación del sorteo, y retomar lo que quedó a medias antes de una recarga. Sin una
 * sala de campaña activa en esta compu, ninguna de las escuchas hace nada.
 */
export function arrancarElPuente(): void {
  if (arrancado) return;
  arrancado = true;
  const d = depsDelResultadoReales();
  escucharSellos(d);
  escucharComprobante(d);
  registrarLasAcciones(d);
  registrarAcciones({
    reintentarAlta: (cuenta) => {
      const puesto = ganadorasDeLasAltas.indexOf(cuenta);
      const e = entradaActual();
      if (puesto >= 0 && e?.sorteo) void altas(e.sorteo).reintentar(puesto);
    },
  });
  document.addEventListener("tinkazo:comprobante", () => altasReales?.alGuardarElSorteo());
  // Sin la cuenta dueña conectada no se mueve nada: cuando llega la sesión se retoma lo que quedó esperando.
  document.addEventListener("tinkazo:sesion", () => alRetomarReal());
  retomarAlArrancar(d);
  void revisarElSelloPorConfirmar();
}

/** El panel retomó la sala: se retoma lo que quedó a medias con lo que el panel sabe ahora. */
export function alRetomarReal(): void {
  retomarAlArrancar(depsDelResultadoReales());
  void revisarElSelloPorConfirmar();
}

/** El resultado se revela (lo llama `reveal` con la promesa del comprobante). */
export function alRevelarReal(enlace: Promise<string>): void {
  void alRevelar(enlace, depsDelResultadoReales());
}

/**
 * Se recargó entre mandar el sello y que la red lo confirmara: el sello puede estar en la red sin número en la entrada. Si
 * hay un intento guardado para esta cuenta y esta lista, quien organiza tiene una sola acción, Sellar la lista, que lo
 * retoma. Pasada la ronda de ese intento, el sello ya no sirve para la campaña.
 */
async function revisarElSelloPorConfirmar(): Promise<void> {
  try {
    const e = entradaActual();
    const cuenta = activeWallet()?.address;
    if (!salaGuardada() || !e || e.huella === "" || !cuenta) return;
    const { parseNames } = await import("./participants");
    const seguro = await import("./sello-seguro");
    const pendiente = seguro.leerPendiente(cuenta, e.huella, network.name, network.contractId ?? "");
    const paso = pasoDelSelloPorConfirmar({
      huellaDelCuadro: bytesToHex(listHash(parseNames())),
      entrada: e,
      fase: memoriaPropia()?.fase ?? null,
      intento: pendiente ? { round: pendiente.intento.round } : null,
      ahora: ahoraDeLaRonda(),
    });
    if (paso) ponerPaso(paso);
  } catch {
    /* sin lo guardado no hay nada que decir */
  }
}
