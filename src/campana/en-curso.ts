/**
 * Lo que la herramienta recuerda de un sorteo de empresa (una campaña con su sala): la huella de la lista que pasó el
 * panel, el número del sorteo sellado, el comprobante y a qué cuentas ganadoras ya se les avisó. Se guarda por evento y
 * no se pierde si la sala se cierra, porque el resultado puede llegar después.
 *
 * Este archivo lo importan `freeze.ts` y `draw.ts`, que están en la página de siempre: no importa nada pesado. Fuera de una
 * campaña (sin la bandera, sin sala de campaña activa, sin entrada de esa lista) todas las preguntas dan falso o `null` y
 * la herramienta se comporta exactamente como siempre. No guarda tokens ni nombres.
 */
import { network } from "../stellar/config";
import { activeWallet } from "../stellar/wallet-lite";
import { campanasActivo } from "./bandera";
import { seVeDesde } from "./de-quien";

export const CLAVE_SORTEOS = "tinkazo.campana.sorteos";
/** La clave de la sala de quien organiza (`sala/campana-org.ts`). Una prueba comprueba que sigan siendo la misma. */
export const CLAVE_DE_LA_SALA = "tinkazo.campana.org";
/** Dónde, dentro de esa misma clave, quedan las salas de otras cuentas de cada red (`CLAVE_DE_LAS_OTRAS_SALAS` de `sala/campana-org.ts`). */
export const CLAVE_DE_LAS_OTRAS = "otras";
/** Hasta cuántos eventos se recuerdan, el más nuevo primero. */
export const MAX_SORTEOS = 5;
/** Lo que vive una lista pasada sin sorteo: lo mismo que una sala de campaña. */
export const VIDA_CAMPANA_MS = 24 * 3_600_000;

export type RedDeCampana = "mainnet" | "testnet";

/**
 * Lo que dijo el servicio que da el acceso por un puesto ganador (`campana-altas.ts`). `puede`: admitida, ya tenía acceso
 * o no hace falta. `apagado`: la ruta está apagada y no hay nada que decir. `fallo`: otro motivo; `final` es que
 * reintentar no cambia nada.
 */
export interface EstadoDeAltaPremio {
  estado: "puede" | "apagado" | "fallo";
  motivo?: string;
  final?: boolean;
}

export interface SorteoDeCampana {
  evento: string;
  red: RedDeCampana;
  /** El contrato de esa red al pasar la lista: cada contrato numera sus sorteos desde 1. */
  contrato: string;
  /** La huella de las líneas que se pusieron en el cuadro, en hexadecimal (`bytesToHex(listHash(...))`). */
  huella: string;
  premios: number;
  organizadora: string | null;
  /** Cuándo se pasó la lista (ms). La entrada sin sorteo vence a las 24 horas. */
  pasadaEn: number;
  /** El sorteo sellado con esta lista que la sala va a tener, y su ronda. Se guardan antes de avisar. */
  sorteo?: string;
  ronda?: number;
  /**
   * Todos los sorteos que salieron hacia la sala sin una respuesta definitiva. La sala no dice a qué sorteo quedó atada:
   * con más de uno, una fase sellada no dice cuál es.
   */
  mandados?: string[];
  aviso?: "pendiente" | "hecho";
  /** La sala quedó sellada pero con más de un sorteo mandado: se sabe cuál al sortear, por el resultado que acepta. */
  duda?: boolean;
  /** El camino del comprobante (`/verificar.html…`) y si la sala ya lo tiene. */
  comprobante?: string;
  resultado?: "pendiente" | "hecho";
  /** Las cuentas ganadoras de la lista sellada, en orden de puesto, y lo que dijo el servicio del acceso de cada una. */
  ganadoras?: string[];
  altas?: Record<string, EstadoDeAltaPremio>;
}

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacenLocal(): Almacen | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const esTexto = (x: unknown): x is string => typeof x === "string";

function leerEntrada(x: unknown): SorteoDeCampana | null {
  if (!esObjeto(x)) return null;
  const { evento, red, contrato, huella, premios, organizadora, pasadaEn } = x;
  if (!esTexto(evento) || (red !== "mainnet" && red !== "testnet") || !esTexto(contrato) || !esTexto(huella)) return null;
  if (typeof premios !== "number" || !Number.isSafeInteger(premios) || typeof pasadaEn !== "number" || !Number.isFinite(pasadaEn)) return null;
  if (organizadora !== null && !esTexto(organizadora)) return null;
  const e: SorteoDeCampana = { evento, red, contrato, huella, premios, organizadora, pasadaEn };
  if (esTexto(x.sorteo)) e.sorteo = x.sorteo;
  if (typeof x.ronda === "number" && Number.isSafeInteger(x.ronda)) e.ronda = x.ronda;
  if (Array.isArray(x.mandados)) e.mandados = x.mandados.filter(esTexto).slice(0, 8);
  if (x.aviso === "pendiente" || x.aviso === "hecho") e.aviso = x.aviso;
  if (x.duda === true) e.duda = true;
  if (esTexto(x.comprobante)) e.comprobante = x.comprobante;
  if (x.resultado === "pendiente" || x.resultado === "hecho") e.resultado = x.resultado;
  if (Array.isArray(x.ganadoras)) e.ganadoras = x.ganadoras.filter(esTexto).slice(0, 32);
  if (esObjeto(x.altas)) {
    const altas: Record<string, EstadoDeAltaPremio> = {};
    for (const [puesto, v] of Object.entries(x.altas)) {
      if (!esObjeto(v) || (v.estado !== "puede" && v.estado !== "apagado" && v.estado !== "fallo")) continue;
      altas[puesto] = {
        estado: v.estado,
        ...(esTexto(v.motivo) ? { motivo: v.motivo.slice(0, 40) } : {}),
        ...(v.final === true ? { final: true } : {}),
      };
    }
    e.altas = altas;
  }
  return e;
}

/**
 * La cuenta con que se entró, o `null` si no hay sesión. Es con la que se decide qué campaña se ve desde esta compu: lo que
 * guardó otra cuenta no se ofrece ni se mueve (`de-quien.ts`).
 */
export function cuentaConectada(): string | null {
  return activeWallet()?.address ?? null;
}

/** Todo lo recordado, de cualquier cuenta, el más nuevo primero. Es lo que se reescribe: lo de otra cuenta se conserva. */
function leerTodasLasEntradas(a: Almacen | null): SorteoDeCampana[] {
  if (!a) return [];
  try {
    const x: unknown = JSON.parse(a.getItem(CLAVE_SORTEOS) ?? "[]");
    if (!Array.isArray(x)) return [];
    return x.map(leerEntrada).filter((e): e is SorteoDeCampana => e !== null).slice(0, MAX_SORTEOS);
  } catch {
    return [];
  }
}

/**
 * Lo recordado que se ve desde la cuenta conectada, el más nuevo primero. Lo que no se entiende se descarta; sin
 * almacenamiento, nada. Lo de otra cuenta no sale, pero sigue guardado.
 */
export function leerSorteosDeCampana(a: Almacen | null = almacenLocal(), cuenta: string | null = cuentaConectada()): SorteoDeCampana[] {
  return leerTodasLasEntradas(a).filter((e) => seVeDesde(e.organizadora, cuenta));
}

/**
 * Guarda la entrada de su red y su evento, reemplazando la anterior. Hasta cinco, la más nueva primero. Las de otras cuentas
 * no se tocan.
 */
export function guardarSorteoDeCampana(e: SorteoDeCampana, a: Almacen | null = almacenLocal()): void {
  if (!a) return;
  try {
    const otras = leerTodasLasEntradas(a).filter((x) => !(x.red === e.red && x.evento === e.evento));
    a.setItem(CLAVE_SORTEOS, JSON.stringify([e, ...otras].slice(0, MAX_SORTEOS)));
  } catch {
    /* sin lugar o bloqueado: la campaña anda igual, solo que no retoma */
  }
}

/** La entrada de ese evento en esa red que se ve desde la cuenta conectada, o `null`. */
export function entradaDelEvento(
  red: RedDeCampana,
  evento: string,
  a: Almacen | null = almacenLocal(),
  cuenta: string | null = cuentaConectada(),
): SorteoDeCampana | null {
  return leerSorteosDeCampana(a, cuenta).find((x) => x.red === red && x.evento === evento) ?? null;
}

/** Si la entrada tiene algún sorteo que salió hacia la sala sin una respuesta definitiva. */
export const conSorteoSinResolver = (e: SorteoDeCampana): boolean => e.sorteo !== undefined || (e.mandados?.length ?? 0) > 0;

const FASES_ACTIVAS: readonly string[] = ["abierta", "cerrada", "sellada", "sorteada"];

/**
 * La sala de campaña que esta compu tiene viva en esa red: su evento y su fase. Es lo que hace que haya una campaña
 * activa (sin ella, la herramienta no se entera de nada). Lee la memoria de quien organiza sin traer su módulo. La sala de
 * otra cuenta no cuenta como activa desde esta (y no se borra).
 */
export function salaDeCampanaActiva(
  red: RedDeCampana,
  ahora: number = Date.now(),
  a: Almacen | null = almacenLocal(),
  cuenta: string | null = cuentaConectada(),
): { evento: string; fase: string } | null {
  if (!a) return null;
  try {
    const todo: unknown = JSON.parse(a.getItem(CLAVE_DE_LA_SALA) ?? "{}");
    if (!esObjeto(todo)) return null;
    // La sala en curso y, si no es de esta cuenta, las de otras cuentas que quedaron a un costado (`sala/campana-org.ts`).
    const otras = esObjeto(todo[CLAVE_DE_LAS_OTRAS]) ? todo[CLAVE_DE_LAS_OTRAS][red] : undefined;
    const candidatas: unknown[] = [todo[red], ...(Array.isArray(otras) ? otras : [])];
    for (const memoria of candidatas) {
      if (!esObjeto(memoria) || !esObjeto(memoria.sala)) continue;
      const { evento, vence } = memoria.sala;
      if (!esTexto(evento) || typeof vence !== "number" || vence <= ahora) continue;
      if (!esTexto(memoria.fase) || !FASES_ACTIVAS.includes(memoria.fase)) continue;
      if (!seVeDesde(esTexto(memoria.cuenta) ? memoria.cuenta : null, cuenta)) continue;
      return { evento, fase: memoria.fase };
    }
    return null;
  } catch {
    return null;
  }
}

/** Si hay una sala de campaña activa en la red de esta pestaña, y se ve desde la cuenta conectada. */
export function hayCampanaActiva(ahora: number = Date.now(), a: Almacen | null = almacenLocal(), cuenta: string | null = cuentaConectada()): boolean {
  return campanasActivo() && salaDeCampanaActiva(network.name, ahora, a, cuenta) !== null;
}

const contratoDeAhora = (): string => network.contractId ?? "";

/**
 * La entrada de la lista que pasó el panel, si `hash` es su huella y esa lista todavía se puede sellar como la de la
 * campaña. Solo con la bandera, con una sala de campaña viva de ese evento en `cerrada`, con la entrada de esta red y este
 * contrato, sin resultado hecho, sin un sorteo sin resolver (un segundo sello de la misma lista no es el de la campaña) y
 * sin vencer. Fuera de eso, `null` y el margen de siempre.
 */
export function campanaDeLaLista(hash: string, ahora: number = Date.now(), a: Almacen | null = almacenLocal()): SorteoDeCampana | null {
  if (!campanasActivo()) return null;
  try {
    const sala = salaDeCampanaActiva(network.name, ahora, a);
    if (!sala || sala.fase !== "cerrada") return null;
    const e = entradaDelEvento(network.name, sala.evento, a);
    if (!e || e.huella !== hash || e.contrato !== contratoDeAhora()) return null;
    if (e.resultado === "hecho" || conSorteoSinResolver(e)) return null;
    return ahora - e.pasadaEn < VIDA_CAMPANA_MS ? e : null;
  } catch {
    return null;
  }
}

/**
 * Si `hash` es la huella de la lista que pasó el panel de una campaña que todavía no sorteó, tenga o no un sorteo mandado sin
 * respuesta. Es lo que decide que esa lista nunca se sortee sin sello ni sin cuenta: un sello dudoso no la convierte en una
 * lista común. A diferencia de `campanaDeLaLista`, no pregunta si el sello de ahora todavía serviría para la sala.
 */
export function esListaDeCampana(hash: string, ahora: number = Date.now(), a: Almacen | null = almacenLocal()): boolean {
  if (!campanasActivo()) return false;
  try {
    const sala = salaDeCampanaActiva(network.name, ahora, a);
    if (!sala || (sala.fase !== "cerrada" && sala.fase !== "sellada")) return false;
    const e = entradaDelEvento(network.name, sala.evento, a);
    if (!e || e.huella !== hash || e.contrato !== contratoDeAhora()) return false;
    return ahora - e.pasadaEn < VIDA_CAMPANA_MS;
  } catch {
    return false;
  }
}

/**
 * Si el cuadro del sorteo dejó de tener la lista que el panel pasó: la sala de una campaña está en `cerrada`, la entrada
 * recuerda una huella y `hash` es otra. Sellar así costaría un sorteo de quien organiza antes de que se note, porque la sala
 * rechazaría la lista. Sin la bandera, sin sala de campaña o con el cuadro vacío de huella (nada pasado), falso.
 */
export function listaCambiadaDeLaCampana(hash: string, ahora: number = Date.now(), a: Almacen | null = almacenLocal()): boolean {
  if (!campanasActivo()) return false;
  try {
    const sala = salaDeCampanaActiva(network.name, ahora, a);
    if (!sala || sala.fase !== "cerrada") return false;
    const e = entradaDelEvento(network.name, sala.evento, a);
    if (!e || e.huella === "" || e.huella === hash || e.contrato !== contratoDeAhora()) return false;
    return ahora - e.pasadaEn < VIDA_CAMPANA_MS;
  } catch {
    return false;
  }
}

/**
 * La entrada de un sorteo que ya se hizo en otra compu, armada con lo que la sala publica del resultado (el número del sorteo,
 * las ganadoras en orden y el comprobante). Con ella, la compu que toma la campaña (Usar en esta compu) retoma el paso de las
 * ganadoras: Avisar y el comprobante andan igual que en la compu donde se sorteó. No trae la huella de la lista ni la ronda,
 * porque esta compu nunca selló nada: sin la huella, ningún sello de acá se confunde con el de la campaña.
 */
export function entradaDeUnSorteoRecuperado(a: {
  evento: string;
  red: RedDeCampana;
  contrato: string;
  organizadora: string | null;
  ahora: number;
  resultado: { sorteo: string; ganadoras: readonly string[]; comprobante: string };
}): SorteoDeCampana {
  const { sorteo, ganadoras, comprobante } = a.resultado;
  return {
    evento: a.evento,
    red: a.red,
    contrato: a.contrato,
    huella: "",
    premios: ganadoras.length,
    organizadora: a.organizadora,
    pasadaEn: a.ahora,
    sorteo,
    aviso: "hecho",
    resultado: "hecho",
    comprobante,
    ganadoras: [...ganadoras],
  };
}

/**
 * Si el sorteo es de una campaña de empresa: alguna entrada de esta red y este contrato lo tiene entre los que salieron
 * hacia la sala. Sin la bandera, sin entradas o con un almacenamiento que lanza, falso.
 */
export function esSorteoDeCampana(raffleId: bigint | undefined, a: Almacen | null = almacenLocal(), cuenta: string | null = cuentaConectada()): boolean {
  if (raffleId === undefined || !campanasActivo()) return false;
  try {
    const id = String(raffleId);
    return leerSorteosDeCampana(a, cuenta).some(
      (e) => e.red === network.name && e.contrato === contratoDeAhora() && (e.sorteo === id || (e.mandados ?? []).includes(id)),
    );
  } catch {
    return false;
  }
}
