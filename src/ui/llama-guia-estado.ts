import type { PoseDeLlama } from "./llama-poses";

/**
 * Lo que la llama que acompaña calcula sin tocar la página (`llama-guia.ts` la dibuja): dónde va en el camino y qué
 * pose y qué lugar le tocan en cada pantalla de la compra y de la carga.
 *
 * El camino tiene una parada por tramo y termina en una bandera. La llama está en la parada de su tramo y camina un
 * poco en cada pantalla del tramo (`avance`, de 0 a 1). Al terminar el último tramo llega a la bandera.
 */

/** Los tramos, en el orden en que pueden venir. Cada uno es una clave del diccionario (su nombre para el lector de pantalla). */
export const ORDEN_DE_TRAMOS = ["tramoCuenta", "tramoIdentidad", "tramoMonto", "tramoPago", "tramoCamino"] as const;
export type ClaveDeTramo = (typeof ORDEN_DE_TRAMOS)[number];

/**
 * Los recorridos largos. La primera compra con QR tiene cuatro tramos y las siguientes, ya verificada, dos. La carga con
 * bolivianos tiene cuatro, y tres si la persona ya está verificada.
 */
export type Recorrido = "compra" | "compraSiguiente" | "carga" | "cargaVerificada";

export const TRAMOS: Readonly<Record<Recorrido, readonly ClaveDeTramo[]>> = {
  compra: ["tramoCuenta", "tramoIdentidad", "tramoPago", "tramoCamino"],
  compraSiguiente: ["tramoPago", "tramoCamino"],
  carga: ["tramoIdentidad", "tramoMonto", "tramoPago", "tramoCamino"],
  cargaVerificada: ["tramoMonto", "tramoPago", "tramoCamino"],
};

const entre = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Dónde va la llama, en % del camino: 0 en la primera parada y 100 en la bandera. `paso` va de 1 a `total` y `avance`
 * de 0 a 1 dentro del tramo. Lo que se pasa de los bordes queda en el borde.
 */
export function posicion(paso: number, total: number, avance = 0): number {
  if (!(total >= 1)) return 0;
  const p = entre(Math.round(paso), 1, total);
  const a = entre(Number.isFinite(avance) ? avance : 0, 0, 1);
  return Math.round(((p - 1 + a) / total) * 10000) / 100;
}

/** Las paradas del camino, en %: la del tramo 1 en 0, y una cada `100 / total`. La bandera queda en 100. */
export function paradas(total: number): number[] {
  if (!(total >= 1)) return [];
  return Array.from({ length: Math.round(total) }, (_, i) => Math.round((i / Math.round(total)) * 10000) / 100);
}

/**
 * El avance dentro del tramo En camino según la etapa del dinero: de 0 a 0,75, así la llama no llega a la bandera hasta
 * que la compra o la carga terminan de verdad.
 */
export function avanceDeEtapa(hechas: number, etapas: number): number {
  if (!(etapas >= 1)) return 0;
  return Math.round(entre(hechas / etapas, 0, 1) * 0.75 * 100) / 100;
}

/** El lugar de la llama en una pantalla. */
export interface Lugar {
  /** El tramo de la pantalla. `null`: sin camino (la primera pantalla de la carga), o el de antes si `quedarse`. */
  readonly tramo: ClaveDeTramo | null;
  readonly avance: number;
  readonly pose: PoseDeLlama;
  /** Una falla o una espera sin pantalla propia: la llama no avanza ni vuelve, se queda donde estaba. */
  readonly quedarse?: boolean;
  /** El avance lo da la etapa del dinero en camino (`avanceDeEtapa`); el de la tabla es el de la primera etapa. */
  readonly porEtapa?: boolean;
}

const en = (tramo: ClaveDeTramo, avance: number, pose: PoseDeLlama): Lugar => ({ tramo, avance, pose });
const porEtapa = (pose: PoseDeLlama): Lugar => ({ tramo: "tramoCamino", avance: 0, pose, porEtapa: true });
const FALLA: Lugar = { tramo: null, avance: 0, pose: "preocupa", quedarse: true };

/**
 * Las pantallas de la primera compra con QR (la ventana Tu compra, con la verificación adentro) y de las siguientes.
 * CL-* son las cajas de Dejá tu cuenta lista. SIN-CONEXION vale para cualquier pantalla que se quedó sin red.
 */
export const PANTALLAS_DE_COMPRA = [
  "CL-OFERTA", "CL-COMPRA", "CL-PROTEGER", "CL-PAQUETE",
  "CQ-ESPERA", "CQ-VERIF", "CQ-ID", "CQ-ID-ESPERA", "CQ-ID-BLOQUEADA", "CQ-ID-VENCIDA", "CQ-REVISION", "CQ-RECHAZO",
  "CQ-DATOS", "CQ-SEGIP", "CQ-SEGIP-NO", "CQ-ALTA",
  "CQ-PREP", "CQ-PRECIO", "CQ-PRECIO-VENCIDO", "CQ-SALDO", "CQ-APP", "CQ-QR", "CQ-QR-FALTA", "CQ-QR-VENCIDO-ABIERTA",
  "CQ-QR-VENCIDO-CERRADA", "CQ-YAPAGASTE", "CQ-ESPERA-PAGO",
  "CQ-CAMINO", "CQ-ANTES", "CQ-APROBAR", "CQ-APROBAR-NOSALIO", "CQ-LLEGO", "CQ-MENOS", "CQ-PAGANDO", "CQ-LISTO",
  "CQ-SINQR", "CQ-NOVENDE", "CQ-FRENADA", "CQ-FALLO", "CQ-RARO", "CQ-DESCONOCIDO", "SIN-CONEXION",
] as const;
export type PantallaDeCompra = (typeof PANTALLAS_DE_COMPRA)[number];

/** Las pantallas de Cargar con bolivianos. V1-ESPERA es V1 mientras espera que la verificación termine en la otra pestaña. */
export const PANTALLAS_DE_CARGA = [
  "C1", "C2", "V0", "V1", "V1-ESPERA", "V2", "V3", "V4", "P1", "M1", "M2", "Q1", "Q0", "Q2", "E1", "A0", "A1", "L1",
  "F1", "F2", "X1", "SIN-CONEXION",
] as const;
export type PantallaDeCarga = (typeof PANTALLAS_DE_CARGA)[number];

/** Qué pose y qué lugar le toca a la llama en cada pantalla. */
export const POSE_DE_PANTALLA: { readonly compra: Readonly<Record<PantallaDeCompra, Lugar>>; readonly carga: Readonly<Record<PantallaDeCarga, Lugar>> } = {
  compra: {
    "CL-OFERTA": en("tramoCuenta", 0, "saluda"),
    "CL-COMPRA": en("tramoCuenta", 0.33, "anima"),
    "CL-PROTEGER": en("tramoCuenta", 0.66, "anima"),
    "CL-PAQUETE": en("tramoIdentidad", 0, "anima"),
    "CQ-ESPERA": { tramo: null, avance: 0, pose: "espera", quedarse: true },
    "CQ-VERIF": en("tramoIdentidad", 0, "anima"),
    "CQ-ID": en("tramoIdentidad", 0.25, "anima"),
    "CQ-ID-ESPERA": en("tramoIdentidad", 0.25, "espera"),
    "CQ-ID-BLOQUEADA": en("tramoIdentidad", 0.25, "anima"),
    "CQ-ID-VENCIDA": FALLA,
    "CQ-REVISION": en("tramoIdentidad", 0.25, "espera"),
    "CQ-RECHAZO": FALLA,
    "CQ-DATOS": en("tramoIdentidad", 0.5, "anima"),
    "CQ-SEGIP": en("tramoIdentidad", 0.65, "anima"),
    "CQ-SEGIP-NO": FALLA,
    "CQ-ALTA": en("tramoIdentidad", 0.8, "anima"),
    "CQ-PREP": en("tramoPago", 0, "anima"),
    "CQ-PRECIO": en("tramoPago", 0.2, "anima"),
    "CQ-PRECIO-VENCIDO": en("tramoPago", 0.2, "anima"),
    "CQ-SALDO": en("tramoPago", 0.5, "anima"),
    "CQ-APP": en("tramoPago", 0.5, "anima"),
    "CQ-QR": en("tramoPago", 0.5, "anima"),
    "CQ-QR-FALTA": FALLA,
    "CQ-QR-VENCIDO-ABIERTA": FALLA,
    "CQ-QR-VENCIDO-CERRADA": FALLA,
    "CQ-YAPAGASTE": en("tramoPago", 0.5, "anima"),
    "CQ-ESPERA-PAGO": en("tramoPago", 0.8, "espera"),
    "CQ-CAMINO": porEtapa("espera"),
    "CQ-ANTES": porEtapa("anima"),
    "CQ-APROBAR": porEtapa("anima"),
    "CQ-APROBAR-NOSALIO": FALLA,
    "CQ-LLEGO": en("tramoCamino", 0.9, "anima"),
    "CQ-MENOS": FALLA,
    "CQ-PAGANDO": en("tramoCamino", 0.95, "espera"),
    "CQ-LISTO": en("tramoCamino", 1, "festeja"),
    "CQ-SINQR": FALLA,
    "CQ-NOVENDE": FALLA,
    "CQ-FRENADA": FALLA,
    "CQ-FALLO": FALLA,
    "CQ-RARO": FALLA,
    "CQ-DESCONOCIDO": FALLA,
    "SIN-CONEXION": FALLA,
  },
  carga: {
    C1: { tramo: null, avance: 0, pose: "saluda" },
    C2: porEtapa("anima"),
    V0: en("tramoIdentidad", 0, "anima"),
    V1: en("tramoIdentidad", 0.25, "anima"),
    "V1-ESPERA": en("tramoIdentidad", 0.25, "espera"),
    V2: en("tramoIdentidad", 0.5, "anima"),
    V3: en("tramoIdentidad", 0.65, "anima"),
    V4: en("tramoIdentidad", 0.8, "anima"),
    P1: en("tramoMonto", 0, "anima"),
    M1: en("tramoMonto", 0.33, "anima"),
    M2: en("tramoMonto", 0.66, "anima"),
    Q1: en("tramoPago", 0.3, "anima"),
    Q0: en("tramoPago", 0.3, "anima"),
    Q2: en("tramoPago", 0.8, "espera"),
    E1: porEtapa("espera"),
    A0: porEtapa("anima"),
    A1: porEtapa("anima"),
    L1: en("tramoCamino", 1, "festeja"),
    F1: FALLA,
    F2: FALLA,
    X1: FALLA,
    "SIN-CONEXION": FALLA,
  },
};

/** Los caminos felices, en orden: la llama nunca vuelve atrás en ellos. */
export const CAMINO_FELIZ: { readonly compra: readonly PantallaDeCompra[]; readonly carga: readonly PantallaDeCarga[] } = {
  compra: [
    "CL-OFERTA", "CL-COMPRA", "CL-PROTEGER", "CL-PAQUETE", "CQ-VERIF", "CQ-ID", "CQ-ID-ESPERA", "CQ-DATOS", "CQ-SEGIP",
    "CQ-ALTA", "CQ-PREP", "CQ-PRECIO", "CQ-QR", "CQ-ESPERA-PAGO", "CQ-CAMINO", "CQ-ANTES", "CQ-APROBAR", "CQ-LLEGO",
    "CQ-PAGANDO", "CQ-LISTO",
  ],
  carga: ["C1", "V0", "V1", "V1-ESPERA", "V2", "V3", "V4", "P1", "M1", "M2", "Q1", "Q2", "E1", "A0", "A1", "L1"],
};

/** Dónde está la llama en una pantalla de un recorrido: lo que `acompanar` necesita, salvo la línea. */
export interface LugarEnRecorrido {
  readonly pose: PoseDeLlama;
  readonly paso?: number;
  readonly total?: number;
  readonly avance?: number;
  readonly tramos?: readonly ClaveDeTramo[];
  readonly quedarse?: boolean;
}

/**
 * La pose y el lugar de una pantalla dentro de un recorrido. El número de tramo sale del recorrido: la misma pantalla
 * de pago es el tramo 3 de 4 en la primera compra y el 1 de 2 en las siguientes. Una pantalla de un tramo que el
 * recorrido no tiene (la verificación, para quien ya está verificada) deja a la llama al principio del tramo que sigue.
 * `avance` pisa el de la tabla: es para las pantallas que avanzan por etapa (`avanceDeEtapa`).
 */
export function lugarEnRecorrido(recorrido: "compra" | "compraSiguiente", pantalla: PantallaDeCompra, opciones?: { avance?: number }): LugarEnRecorrido;
export function lugarEnRecorrido(recorrido: "carga" | "cargaVerificada", pantalla: PantallaDeCarga, opciones?: { avance?: number }): LugarEnRecorrido;
export function lugarEnRecorrido(recorrido: Recorrido, pantalla: string, opciones: { avance?: number } = {}): LugarEnRecorrido {
  const tabla: Readonly<Record<string, Lugar>> = recorrido === "carga" || recorrido === "cargaVerificada" ? POSE_DE_PANTALLA.carga : POSE_DE_PANTALLA.compra;
  const lugar = tabla[pantalla];
  if (!lugar) return { pose: "anima" };
  if (lugar.quedarse) return { pose: lugar.pose, quedarse: true };
  if (lugar.tramo === null) return { pose: lugar.pose };
  const tramos = TRAMOS[recorrido];
  let i = tramos.indexOf(lugar.tramo);
  let avance = opciones.avance ?? lugar.avance;
  if (i < 0) {
    const orden = ORDEN_DE_TRAMOS.indexOf(lugar.tramo);
    i = tramos.findIndex((t) => ORDEN_DE_TRAMOS.indexOf(t) > orden);
    avance = 0;
    if (i < 0) {
      i = tramos.length - 1;
      avance = 1;
    }
  }
  return { pose: lugar.pose, paso: i + 1, total: tramos.length, avance: entre(avance, 0, 1), tramos };
}
