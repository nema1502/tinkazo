import type { Cobro } from "./cobro";
import type { IntentoDeGrifo } from "./pagador";
import { RED_DE_PRUEBA, TTL_MINIMO_PERSISTENTE } from "./red";

/**
 * Lo que mide la prueba, con la forma del archivo que deja el recorrido automático. Son cifras de la red de prueba: no
 * se trasladan a otra red, y el archivo lo dice en `aviso`.
 */

export const VERSION_DEL_KIT = "0.10.0";

export interface PasoDeCuenta {
  contractId: string;
  hash: string;
  ledger: number;
  segundos: number;
  cobro: Cobro;
}

export interface PasoDeSello {
  id: string;
  ronda: number;
  hash: string;
  segundos: number;
  desbloqueos: number;
  cobro: Cobro;
}

export interface PasoDeSorteo {
  ganadores: string[];
  /** El ganador que sacó el contrato es el mismo que se rehace con la firma de la ronda. */
  coincide: boolean;
  hash: string;
  segundosDesdeLaRonda: number;
  cobro: Cobro;
}

/** Cómo salió entrar desde otro aparato con la misma llave. */
export interface PasoDeEntrada {
  /** De dónde salió la pista de nacimiento (`historial`, `rpc` o `local`), o `ninguna` si no se llegó a una. */
  fuente: string;
  ledgerDeNacimiento: number | null;
  segundosBuscando: number;
  /** Cuántas veces pidió la llave el desbloqueo al entrar: tiene que ser una. `null` si no se llegó a saber. */
  desbloqueos: number | null;
  /** Por qué no se entró, o `null` si se entró. */
  motivo: string | null;
}

export interface FallaMedida {
  paso: string;
  motivo: string;
  conFoco: boolean;
  detalle?: string;
}

export interface Medidas {
  version: 1;
  red: "testnet";
  contrato: string;
  kit: string;
  codigoCuenta: string;
  aviso: string;
  ttlMinimoPersistente: number;
  inclusionFijada: number;
  inicio: string;
  pagador: { segundosGrifo: number; intentos: IntentoDeGrifo[] } | null;
  cuenta: PasoDeCuenta | null;
  sello: PasoDeSello | null;
  sorteo: PasoDeSorteo | null;
  entrada: PasoDeEntrada | null;
  fallas: FallaMedida[];
}

export function medidasVacias(ahora: Date = new Date()): Medidas {
  return {
    version: 1,
    red: "testnet",
    contrato: RED_DE_PRUEBA.contrato,
    kit: VERSION_DEL_KIT,
    codigoCuenta: RED_DE_PRUEBA.codigoCuenta,
    aviso: "Cifras de la red de prueba. No se proyectan a la red principal.",
    ttlMinimoPersistente: TTL_MINIMO_PERSISTENTE,
    inclusionFijada: 100,
    inicio: ahora.toISOString(),
    pagador: null,
    cuenta: null,
    sello: null,
    sorteo: null,
    entrada: null,
    fallas: [],
  };
}

/** El archivo, con los enteros grandes como texto. */
export function aJson(m: Medidas): string {
  return JSON.stringify(m, (_clave, valor: unknown) => (typeof valor === "bigint" ? valor.toString() : valor), 2);
}
