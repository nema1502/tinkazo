/**
 * El puente entre lo que pasa en la herramienta (pasar la lista, avisar el sello, avisar el resultado) y el panel de quien
 * organiza: guarda en qué paso está el sorteo de la empresa y quién tiene que oír cada cambio. El panel dibuja el paso
 * (`lineaDelPaso`, `botonDelPaso`) y nunca pinta por su cuenta lo que otro pintó, así que nada se pisa.
 *
 * Nunca lleva el token de la sala, la clave de los nombres ni el token de la sesión: solo textos, números y cuentas públicas.
 */
import type { EstadoDeAltaPremio } from "./en-curso";

/** Una ganadora en la fila del panel: su cuenta, cómo se la llama, si ya se le avisó en el celular y qué dijo el acceso. */
export interface FilaDeGanadora {
  cuenta: string;
  nombre: string;
  avisada: boolean;
  alta: EstadoDeAltaPremio | "esperando";
  /** El código de entrega de esta ganadora, si ya se tiene. Solo en las campañas de premio en mano, y vive en la memoria de la pestaña. */
  codigo?: string;
}

export type PasoDelPuente =
  | { paso: "nada" }
  | { paso: "leyendo" }
  | { paso: "en-el-sorteo"; n: number }
  | { paso: "no-leyo" }
  /** La lista o las ganadoras que tiene la sala mezclan cuentas con líneas de persona: reintentar no lo cambia, así que no hay botón. */
  | { paso: "lista-rara" }
  | { paso: "pocos"; n: number }
  | { paso: "otra-cuenta"; fin: string }
  | { paso: "lista-sellada"; soltable: boolean }
  | { paso: "otra-red"; modo: string }
  | { paso: "version-distinta" }
  | { paso: "sin-conexion" }
  | { paso: "avisando" | "no-avisamos" | "comprobando" | "avisada" | "sala-borrada" | "otro-sorteo" | "sorteo-pendiente" }
  /** La sala ya no acepta el token de esta compu: otra compu tomó la campaña con la misma cuenta. */
  | { paso: "tomada" }
  /** Hay una sala en esta compu pero todavía no se sabe que esta cuenta la mueve (sin sesión, o sin completar): hace falta entrar. */
  | { paso: "entrar-para-seguir" }
  | { paso: "no-comprobo" | "aviso-roto" }
  | { paso: "sello-por-confirmar" }
  | { paso: "tarde" | "lista-cambio" | "otra-lista" }
  | { paso: "ganadoras"; n: number }
  | { paso: "boton-avisar" }
  | { paso: "mandando" | "boton-resultado" | "guardar-sorteo" }
  /**
   * Con `enMano` el premio se entrega en persona: no hay billetera ni pago, la línea es la de entregar y nada habla de recibir.
   * Solo lo pone quien leyó que todas las ganadoras son líneas de persona. `sinCodigos` es que se pidieron los códigos de
   * entrega todas las veces que se podía y no se pudieron leer: entonces el panel ofrece pedirlos de nuevo. `sinAviso` es que
   * el último aviso a una ganadora no se pudo marcar: el panel lo dice junto a las filas y el botón sigue para probar de nuevo.
   */
  | { paso: "resultado"; filas: FilaDeGanadora[]; otraBilletera: boolean; enMano?: true; sinCodigos?: true; sinAviso?: true };

/**
 * ¿Le falta al panel avisarle algo a los celulares? Si es así, dejar la campaña ahora los dejaría sin su sello o sin su
 * resultado, así que antes hay que preguntar.
 *
 * Con la lista sellada y el sorteo sin hacer, el resultado todavía no salió: sea cual sea el paso, el panel se lo debe a
 * los celulares. Con el sorteo hecho también se pregunta, salvo cuando el resultado ya está a la vista con todas las
 * ganadoras avisadas o cuando la sala ya fue borrada, que no tiene a quién mandarle nada.
 */
export function avisosPendientes(p: PasoDelPuente, sorteoHecho: boolean): boolean {
  if (!sorteoHecho) return true;
  if (p.paso === "sala-borrada") return false;
  if (p.paso === "resultado") return p.filas.some((f) => !f.avisada);
  return true;
}

/**
 * ¿Se pierden códigos de entrega si se deja la campaña ahora? Con el resultado en mano a la vista, sí: el panel es lo único
 * que se los muestra a quien organiza, y los lee con lo que esa compu guarda de la campaña. Marcar a una ganadora como
 * avisada no quiere decir que el premio se entregó, así que vale también con todas marcadas, y por eso es una pregunta
 * aparte de `avisosPendientes`. Con una campaña de cuentas no hay códigos y nunca se pierde nada.
 */
export function seVanLosCodigos(p: PasoDelPuente): boolean {
  return p.paso === "resultado" && p.enMano === true;
}

/** Lo que el panel puede pedirle a quien tiene la lógica de cada paso. Cada módulo registra la suya. */
export interface AccionesDelPuente {
  reintentarPaso?: () => void;
  soltarYPasar?: () => void;
  avisarCelulares?: () => void;
  /** Vuelve a preguntarle a la sala en qué quedó el sello, cuando ya no contestó tras varios intentos. */
  comprobarDeNuevo?: () => void;
  mandarResultado?: () => void;
  avisarA?: (cuenta: string) => void;
  /** Vuelve a pedir los códigos de entrega cuando no se pudieron leer. */
  verCodigos?: () => void;
  reintentarAlta?: (cuenta: string) => void;
  cambiarDeCuenta?: () => void;
}

let actual: PasoDelPuente = { paso: "nada" };
let acciones: AccionesDelPuente = {};
/** Por qué hay que sellar de nuevo (lista cambiada, fuera de hora…): se queda a la vista hasta el próximo sello. */
let rechazo: PasoDelPuente | null = null;
const oyentes = new Set<() => void>();

export const pasoDelPuente = (): PasoDelPuente => actual;
export const accionesDelPuente = (): AccionesDelPuente => acciones;

/** Cambia el paso y avisa a quien escucha. */
export function ponerPaso(p: PasoDelPuente): void {
  actual = p;
  for (const f of [...oyentes]) f();
}

/** La línea del último rechazo del sello, si todavía vale. Pasar la lista la deja a la vista en lugar de la de siempre. */
export const rechazoDelPuente = (): PasoDelPuente | null => rechazo;

/** Anota (o borra, con `null`) el rechazo del sello que tiene que seguir a la vista. */
export function ponerRechazo(p: PasoDelPuente | null): void {
  rechazo = p;
}

/** Suma las acciones que sabe hacer un módulo. */
export function registrarAcciones(a: AccionesDelPuente): void {
  acciones = { ...acciones, ...a };
}

/** Escucha los cambios de paso. Devuelve cómo dejar de escuchar. */
export function alCambiarElPuente(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}

/** Vuelve todo a como estaba al abrir la página. Lo usan las pruebas y el panel al olvidar la campaña. */
export function reiniciarElPuente(): void {
  actual = { paso: "nada" };
  acciones = {};
  rechazo = null;
  oyentes.clear();
}

/** La clave de texto y lo que se reemplaza en ella, o `null` si el paso no dice nada. */
export interface LineaDelPaso {
  clave: string;
  vars: Record<string, string>;
}

/** ¿El servicio del acceso dijo que no a esta ganadora y reintentar no cambia nada? */
const conFalloFinal = (f: FilaDeGanadora): boolean => f.alta !== "esperando" && f.alta.estado === "fallo" && f.alta.final === true;

export function lineaDelPaso(p: PasoDelPuente): LineaDelPaso | null {
  const sin = (clave: string): LineaDelPaso => ({ clave, vars: {} });
  switch (p.paso) {
    case "nada":
    case "boton-avisar":
    case "boton-resultado":
    case "mandando":
      return null;
    case "resultado":
      // El premio en mano se entrega en el evento: una sola línea verdadera en todos los estados, nunca la de recibir ni la de avisar a Tinkazo.
      if (p.enMano) return sin(p.filas.length > 0 && p.filas.every((f) => f.codigo !== undefined) ? "cpoEntregaConCodigo" : "cpoEntregaEnMano");
      // Con otra billetera, o con una ganadora que el servicio dijo que no (un fallo final), hay una sola línea de apoyo: la de
      // avisarle a Tinkazo, no esa y la de los celulares.
      return sin(p.otraBilletera || p.filas.some(conFalloFinal) ? "cpoAvisaleATinkazo" : "cpoCelularesResultado");
    case "leyendo":
      return sin("cpoLeyendo");
    case "en-el-sorteo":
      return { clave: "cpoEnElSorteo", vars: { n: String(p.n) } };
    case "no-leyo":
      return sin("cpoNoLeyo");
    case "lista-rara":
      return sin("cpoListaRara");
    case "pocos":
      return p.n <= 2 ? sin("cpoPocos") : { clave: "cpoPocosPremios", vars: { n: String(p.n) } };
    case "otra-cuenta":
      return { clave: "cpoEntraCon", vars: { fin: p.fin } };
    case "lista-sellada":
      return sin("cpoListaSellada");
    case "otra-red":
      return { clave: "cpoOtroModo", vars: { modo: p.modo } };
    case "version-distinta":
      return sin("cpoVersionDistinta");
    case "sin-conexion":
      return sin("cpoSinConexion");
    case "avisando":
      return sin("cpoAvisando");
    case "no-avisamos":
      return sin("cpoNoAvisamos");
    case "comprobando":
      return sin("cpoComprobando");
    case "no-comprobo":
      return sin("cpoNoComprobo");
    case "aviso-roto":
      return sin("cpoAvisoRoto");
    case "avisada":
      return sin("cpoCelularesSellada");
    case "sala-borrada":
      return sin("cpoSeBorro");
    case "tomada":
      return sin("cpoTomadaL");
    case "entrar-para-seguir":
      return sin("cpoEntrarParaSeguir");
    case "otro-sorteo":
      return sin("cpoOtroSorteo");
    case "sorteo-pendiente":
      return sin("cpoSorteoPendiente");
    case "sello-por-confirmar":
      return sin("cpoSelloPorConfirmar");
    case "tarde":
      return sin("cpoTarde");
    case "lista-cambio":
      return sin("cpoListaCambio");
    case "otra-lista":
      return sin("cpoOtraLista");
    case "ganadoras":
      return p.n === 1 ? sin("cpoGanadoras1") : { clave: "cpoGanadorasN", vars: { n: String(p.n) } };
    case "guardar-sorteo":
      return sin("cpoGuardarSorteo");
  }
}

/** El botón principal que lleva cada paso, si lo lleva: la clave de su texto y qué acción del puente llama. */
export type AccionSinArgumentos =
  | "reintentarPaso"
  | "soltarYPasar"
  | "avisarCelulares"
  | "comprobarDeNuevo"
  | "mandarResultado"
  | "cambiarDeCuenta";

export function botonDelPaso(p: PasoDelPuente): { clave: string; accion: AccionSinArgumentos } | null {
  switch (p.paso) {
    case "no-leyo":
    case "sin-conexion":
      return { clave: "cpoReintentar", accion: "reintentarPaso" };
    case "otra-cuenta":
      return { clave: "cpoCambiarCuenta", accion: "cambiarDeCuenta" };
    case "entrar-para-seguir":
      return { clave: "cpoCmEntrar", accion: "cambiarDeCuenta" };
    case "lista-sellada":
      return p.soltable ? { clave: "cpoPasar", accion: "soltarYPasar" } : null;
    // Un sello que la sala no aceptó: se suelta (si el show ya pasó, también) y la lista se vuelve a pasar para sellar de nuevo.
    case "otra-lista":
    case "tarde":
    case "lista-cambio":
    case "ganadoras":
      return { clave: "cpoPasar", accion: "soltarYPasar" };
    case "no-comprobo":
      return { clave: "cpoReintentar", accion: "comprobarDeNuevo" };
    case "boton-avisar":
      return { clave: "cpoAvisarCelulares", accion: "avisarCelulares" };
    case "boton-resultado":
      return { clave: "cpoMandarResultado", accion: "mandarResultado" };
    default:
      return null;
  }
}
