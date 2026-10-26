import { type CasoRed, type Diagnostico, type Nivel, umbralesDe } from "../stellar/chequeo-red";
import type { NetworkName } from "../stellar/config";

/**
 * Qué se le dice a la persona y qué única acción se le ofrece, según cómo esté la red.
 *
 * Es la regla, sin pantalla: `red.ts` la dibuja. El orden de preferencia es siempre el
 * mismo (docs/ux.md, "Cuando la red falla"): reintentar → sellar con otra fuente de
 * comisión → "Seguir sin sello". Una sola acción principal por estado; "Seguir sin
 * sello" nunca es la principal si hay otra cosa que hacer, y siempre pide confirmar.
 *
 * Con una cuenta que paga por sí misma, o cuando el patrocinador no puede, "otra
 * fuente de comisión" es la cuenta de la persona:
 *
 * - en testnet, el grifo de prueba (cargar saldo y sellar);
 * - en mainnet no hay grifo: solo si esa cuenta ya tiene saldo suficiente (dos veces
 *   lo que cuesta sellar), "Sellar pagando con mi cuenta".
 */

export type AccionRed = "sellar" | "reintentar" | "sellar-con-mi-cuenta" | "cargar-saldo" | "seguir-sin-sello";

export interface ContextoDelPanel {
  red: NetworkName;
  /** Cuántas veces ya se probó de nuevo después de un RPC caído (0 al principio). */
  intentos: number;
  /** Hay grifo de prueba para cargar saldo: testnet con el grifo prendido. */
  grifo: boolean;
  /** Saldo de la cuenta en XLM, o null si no se sabe. */
  saldoXlm: number | null;
  /** Lo que cuesta sellar (el medido o uno estimado), para comparar con el saldo. */
  costoXlm: number | null;
}

export interface Panel {
  nivel: Nivel;
  caso: CasoRed | null;
  /** La frase de arriba: la clave del diccionario (las que llevan `{t}` se completan al dibujar). */
  frase: string;
  /** Una segunda frase corta, pegada a la primera (la del caso 5 en amarillo: "Se puede sellar igual."). */
  aparte?: string;
  /** La acción principal: es la que lleva el botón de sellar. */
  principal: AccionRed;
  /** Lo demás, en chiquito. */
  secundarias: AccionRed[];
  /** En rojo la acción del caso reemplaza a "Sellar la lista". */
  bloquea: boolean;
  /** "Sellar pagando con mi cuenta" en testnet: hay que cargar saldo de prueba antes. */
  cargaPrevia: boolean;
  /** Después de un corte, la app vuelve a probar sola cada 15 s (y vuelve a decirlo en la frase). */
  reintentaSola: boolean;
}

/** La clave del diccionario del texto de cada acción. */
export const TEXTO_DE_ACCION = (a: AccionRed, red: NetworkName): string => {
  switch (a) {
    case "sellar":
      return "freeze";
    case "reintentar":
      return "redAccProbar";
    case "sellar-con-mi-cuenta":
      return red === "testnet" ? "redAccSaldoPrueba" : "redAccMiCuenta";
    case "cargar-saldo":
      return "redAccCargar";
    case "seguir-sin-sello":
      return "redAccSinSello";
  }
};

/** El mismo texto, para el registro (sin acentos ni mayúsculas). */
export const NOMBRE_DE_ACCION: Record<AccionRed, string> = {
  sellar: "sellar",
  reintentar: "probar-ahora",
  "sellar-con-mi-cuenta": "sellar-con-mi-cuenta",
  "cargar-saldo": "cargar-saldo",
  "seguir-sin-sello": "seguir-sin-sello",
};

const FRASE_AMARILLA: Record<CasoRed, string> = {
  "costo-alto": "redCostoMedio",
  "rpc-caido": "redAmarilla",
  saturada: "redSaturada",
  "sin-saldo": "redSinSaldo",
  protocolo: "redProtocolo",
};

const FRASE_ROJA: Record<CasoRed, string> = {
  "costo-alto": "redCostoAlto",
  "rpc-caido": "redSinRpc",
  saturada: "redSaturada",
  "sin-saldo": "redSinSaldo",
  protocolo: "redProtocolo",
};

const sinPanel = (): Panel => ({
  nivel: "verde",
  caso: null,
  frase: "",
  principal: "sellar",
  secundarias: [],
  bloquea: false,
  cargaPrevia: false,
  reintentaSola: false,
});

/**
 * El panel de un diagnóstico. Verde no dice nada. Amarillo avisa y deja sellar. Rojo
 * pone la acción del caso en lugar de "Sellar la lista".
 */
export function panelDe(d: Diagnostico, c: ContextoDelPanel): Panel {
  // Sin internet o sin poder chequear: no hay un caso de la red que decir (el aviso de siempre alcanza).
  if (d.nivel === "verde" || !d.caso || d.sinInternet || d.sinChequeo) return sinPanel();

  if (d.nivel === "amarillo") {
    return {
      ...sinPanel(),
      nivel: "amarillo",
      caso: d.caso,
      frase: FRASE_AMARILLA[d.caso],
      // El caso 5 nunca frena por sí solo: se dice y se sella igual.
      ...(d.caso === "protocolo" ? { aparte: "redProtocoloSigue" } : {}),
    };
  }

  const max = umbralesDe(c.red).comun.reintentosAntesDeSinSello;
  const margen = umbralesDe(c.red).comun.margenDeSaldo;
  const puedePagar = c.saldoXlm !== null && c.costoXlm !== null && c.saldoXlm >= margen * c.costoXlm;
  const testnetConGrifo = c.red === "testnet" && c.grifo;
  const base: Panel = { ...sinPanel(), nivel: "rojo", caso: d.caso, frase: FRASE_ROJA[d.caso], bloquea: true };

  switch (d.caso) {
    case "rpc-caido": {
      // Reintentar, y después de tres veces, seguir sin sello.
      if (c.intentos < max) return { ...base, principal: "reintentar", reintentaSola: true };
      return { ...base, frase: "redSinRpcFin", principal: "seguir-sin-sello", secundarias: ["reintentar"] };
    }
    case "costo-alto": {
      // Restaurar el contrato no lo arregla ninguna cuenta: lo extiende quien mantiene el contrato.
      if (d.restaurar) return { ...base, principal: "seguir-sin-sello", secundarias: ["reintentar"] };
      // Reintentar no sirve: la red promedia unas 2,7 horas.
      if (testnetConGrifo) return { ...base, principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"], cargaPrevia: !puedePagar };
      if (puedePagar) return { ...base, principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"] };
      return { ...base, principal: "seguir-sin-sello" };
    }
    case "sin-saldo": {
      if (testnetConGrifo) return { ...base, principal: "cargar-saldo", secundarias: ["seguir-sin-sello"] };
      if (puedePagar) return { ...base, principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"] };
      return { ...base, principal: "seguir-sin-sello" };
    }
    case "protocolo":
      // Solo llega a rojo si la simulación falla: sellar no va a andar. Se puede volver a mirar.
      return { ...base, principal: "seguir-sin-sello", secundarias: ["reintentar"] };
    case "saturada":
      return sinPanel();
  }
}

/** Lo que dice el botón "¿La red está bien?": la clave, la frase del caso si es rojo y la segunda frase si la hay. */
export function respuestaDelBoton(d: Diagnostico, p: Panel): { clave: string; motivo?: string; aparte?: string; nivel: Nivel } {
  if (d.sinInternet) return { clave: "errAnchor.offline", nivel: "rojo" };
  if (p.nivel === "verde") return { clave: "redVerde", nivel: "verde" };
  if (p.nivel === "rojo") return { clave: "redRoja", motivo: p.frase, nivel: "rojo" };
  // Amarillo: la razón, en una frase (la de lento es la general).
  return { clave: p.frase, ...(p.aparte ? { aparte: p.aparte } : {}), nivel: "amarillo" };
}
