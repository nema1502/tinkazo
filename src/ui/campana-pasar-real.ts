/**
 * Las dependencias reales de pasar la lista de una campaña al cuadro del sorteo (`campana-pasar.ts`): el cuadro de la
 * herramienta, la sala de la campaña, las etiquetas y el premio. El panel de quien organiza las trae con `depsDelPanel`.
 */
import deployments from "../stellar/deployments.json";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { conSorteoSinResolver, entradaDelEvento, guardarSorteoDeCampana, salaDeCampanaActiva } from "../campana/en-curso";
import { premioParaElCuadro } from "../campana/formato";
import { ponerPaso } from "../campana/puente";
import { descifrarEquipo, revisarEquipo } from "../equipos/datos";
import { ponerEtiquetas } from "../equipos/etiquetas";
import { getLang, t } from "../i18n";
import { bytesToHex } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { type RedDeCampana, leerOrganizadora, leerTodasLasAnotadas } from "../sala/campana-org";
import { app } from "../state";
import { network } from "../stellar/config";
import { fijarPorCampana, ponerGanadores } from "./ganadores";
import { listaBloqueada, parseNames, setList } from "./participants";
import { actualizarLugares, ponerPremio } from "./premios";
import { modoTurnosActivo, ponerModoTurnos } from "./turnos";
import { claveDeSellar, currentSession } from "./wallet-ui";
import { type DepsDelPaso, type PasoDeLaCampana, type ContextoDelPaso, crearPaso } from "./campana-pasar";
import type { SalaDeCampana } from "../sala/campana-org";

const huellaDe = (lineas: readonly string[]): string => bytesToHex(listHash([...lineas]));

/** El contrato de cada red, tal como lo lee la sala para comprobar el sello. */
function contratoDeLaRed(red: RedDeCampana): string | null {
  const d = deployments as unknown as Record<string, { contractId?: string | null } | null | undefined>;
  return d[red]?.contractId ?? null;
}

/**
 * Fija o suelta la cantidad de ganadoras de la campaña, y los campos de premio por lugar la siguen: con la campaña no se
 * ofrecen (se sella su premio, el que firmó la sala) y sin ella vuelven los de la cantidad de ahora. Fijar la cantidad no
 * avisa con un evento, así que hay que decírselo a los campos.
 */
function fijarCantidadDeLaCampana(si: boolean): void {
  fijarPorCampana(si);
  actualizarLugares();
}

export function depsDelPasoReales(): DepsDelPaso {
  return {
    ahora: () => Date.now(),
    leer: (s) => leerTodasLasAnotadas(s),
    descifrar: descifrarEquipo,
    nombreYFiltro: (datos) => {
      const r = revisarEquipo(datos);
      return r ? { nombre: r.equipo.nombre.trim(), revisar: r.revisar } : null;
    },
    organizadora: async (s) => {
      const r = await leerOrganizadora(s);
      return r === null || (typeof r === "string" && r.startsWith("G") && r.length === 56) ? { cuenta: r } : null;
    },
    cuenta: () => currentSession()?.address ?? null,
    red: () => network.name,
    contrato: () => network.contractId,
    contratoDeLaRed,
    nombreDelModo: (red) => TEXTOS_SALA_CAMPANA[getLang()][red === "mainnet" ? "cpoModoMain" : "cpoModoTest"] ?? "",
    listaBloqueada,
    sorteado: () => app.drawn !== null,
    listaDelCuadro: parseNames,
    huella: huellaDe,
    modoTurnos: modoTurnosActivo,
    ponerModoTurnos,
    ponerEtiquetas,
    setList: (texto) => setList(texto),
    ponerPremio,
    ponerGanadores,
    fijarPorCampana: fijarCantidadDeLaCampana,
    entrada: (red, evento) => entradaDelEvento(red, evento),
    guardar: guardarSorteoDeCampana,
    persona: (n) => (TEXTOS_SALA_CAMPANA[getLang()].cpoPersona ?? "").replace("{n}", String(n)),
    botonDeSellar: () => t(claveDeSellar()),
    premioEnEspanol: premioParaElCuadro,
    esperar: (ms) => new Promise<void>((seguir) => void setTimeout(seguir, ms)),
    poner: ponerPaso,
  };
}

let pasoUnico: PasoDeLaCampana | null = null;

/** El paso de esta página: uno solo, para que las llamadas se serialicen aunque vengan de lugares distintos. */
export function pasoReal(): PasoDeLaCampana {
  pasoUnico ??= crearPaso(depsDelPasoReales());
  return pasoUnico;
}

/** Lo que llama el panel al cerrar y con cada cambio de la lista. Sin contexto (otras pruebas), no hace nada. */
export async function alCerrarReal(s: SalaDeCampana, _filas: unknown, ctx?: ContextoDelPaso): Promise<void> {
  if (!ctx) return;
  await pasoReal().correr(s, ctx);
}

/** La lista que hubiera en el cuadro sin sellar ya no es la de la campaña: se vacía y su entrada pierde la huella. */
function soltarLaListaDelCuadro(): void {
  const sala = salaDeCampanaActiva(network.name);
  const e = sala ? entradaDelEvento(network.name, sala.evento) : null;
  if (e && !conSorteoSinResolver(e)) guardarSorteoDeCampana({ ...e, huella: "" });
  if (!listaBloqueada()) setList("");
}

/** Quien organiza volvió a abrir la inscripción: se corta el paso en curso y se vacía lo que había pasado. */
export function alReabrirReal(): void {
  pasoReal().cancelar();
  fijarCantidadDeLaCampana(false);
  soltarLaListaDelCuadro();
}

/**
 * Entró otra cuenta y la campaña salió de la vista: se corta el paso en curso y, si la lista que había en el cuadro era la que
 * esta campaña pasó, se vacía, así la otra cuenta no ve los nombres de una lista que no es suya. Lo guardado de la campaña (la
 * sala, su token y lo recordado del sorteo) no se toca: al volver la cuenta dueña se retoma.
 */
export function alApartarReal(s: SalaDeCampana): void {
  pasoReal().cancelar();
  fijarCantidadDeLaCampana(false);
  const e = entradaDelEvento(s.red, s.evento, undefined, null);
  if (e !== null && e.huella !== "" && e.huella === huellaDe(parseNames()) && !listaBloqueada()) setList("");
}

/** Se dejó la campaña: el cuadro es el de siempre y la cantidad de ganadoras se puede cambiar. */
export function alOlvidarReal(): void {
  pasoReal().cancelar();
  fijarCantidadDeLaCampana(false);
}

/** Si lo que está en el cuadro es la lista que esta campaña pasó antes de recargar. */
export function listaPasadaReal(s: SalaDeCampana): boolean {
  const e = entradaDelEvento(s.red, s.evento);
  return e !== null && e.huella !== "" && e.huella === huellaDe(parseNames());
}

/**
 * Si la lista no se puede cambiar: se está sellando o ya está sellada con la lista de la campaña, o su sorteo salió hacia la
 * sala y todavía no tiene una decisión final.
 */
export function listaTrabadaReal(): boolean {
  if (listaBloqueada()) return true;
  const sala = salaDeCampanaActiva(network.name);
  const e = sala ? entradaDelEvento(network.name, sala.evento) : null;
  return e !== null && conSorteoSinResolver(e) && e.aviso !== "hecho";
}
