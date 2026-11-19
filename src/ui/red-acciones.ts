import { type CasoRed, type DetalleDelPatrocinio, type Diagnostico, type Nivel, umbralesDe } from "../stellar/chequeo-red";
import type { NetworkName } from "../stellar/config";
import type { EstadoDelPatrocinio } from "../stellar/patrocinador";

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

/**
 * `usar-cupon` existe solo con el cobro por uso del modo Oficial y una cuenta sin acceso: vuelve a sellar con el paso de
 * la cuenta abierto en el campo del cupón (`sin-sorteos.ts`).
 */
export type AccionRed = "sellar" | "reintentar" | "sellar-con-mi-cuenta" | "cargar-saldo" | "seguir-sin-sello" | "usar-cupon";

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
  /**
   * La red principal con una cuenta de Google o de correo (`redPrincipalConPollar`, `cobro-oficial.ts`), con o sin
   * banderas: ahí "Sellar pagando con mi cuenta" no existe (cada firma de esa cuenta le cuesta a Tinkazo). Sin esto,
   * como siempre.
   */
  sinPagoPropio?: boolean;
  /**
   * Rige el cobro por uso del modo Oficial (`cobroPorUso`, `cobro-oficial.ts`): si la cuenta no entra, la frase es la
   * del acceso al modo Oficial. Sin esto, la de siempre.
   */
  cobroPorUso?: boolean;
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
  /** Con `sin-patrocinio` y el cupo agotado: cuándo vuelve, en ms (la frase lleva el día). */
  liberaEn?: number;
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
    case "usar-cupon":
      return "cupoOfUsarCupon";
  }
};

/** El mismo texto, para el registro (sin acentos ni mayúsculas). */
export const NOMBRE_DE_ACCION: Record<AccionRed, string> = {
  sellar: "sellar",
  reintentar: "probar-ahora",
  "sellar-con-mi-cuenta": "sellar-con-mi-cuenta",
  "cargar-saldo": "cargar-saldo",
  "seguir-sin-sello": "seguir-sin-sello",
  "usar-cupon": "usar-cupon",
};

const FRASE_AMARILLA: Record<CasoRed, string> = {
  "costo-alto": "redCostoMedio",
  "rpc-caido": "redAmarilla",
  saturada: "redSaturada",
  "sin-saldo": "redSinSaldo",
  protocolo: "redProtocolo",
  "sin-patrocinio": "errAnchor.porteroFondo",
};

const FRASE_ROJA: Record<CasoRed, string> = {
  "costo-alto": "redCostoAlto",
  "rpc-caido": "redSinRpc",
  saturada: "redSaturada",
  "sin-saldo": "redSinSaldo",
  protocolo: "redProtocolo",
  "sin-patrocinio": "errAnchor.porteroFondo",
};

/**
 * La frase de lo que no cubre el portero, según por qué (las mismas claves que `errorKey` da a un no del portero). Con el
 * cobro por uso (`conCobroPorUso`), una cuenta que no entra es una cuenta sin acceso al modo Oficial todavía.
 */
export function fraseDelPatrocinio(p: DetalleDelPatrocinio | undefined, puedePagar: boolean, conCobroPorUso = false): string {
  switch (p?.motivo) {
    case "cupo-cuenta":
      return p.que === "sorteos" ? "errAnchor.porteroCupoSorteos" : "errAnchor.porteroCupoSellos";
    case "ajena":
      if (conCobroPorUso) return "errAnchor.porteroSinAlta";
      return puedePagar ? "errAnchor.porteroAjenaPropia" : "errAnchor.porteroAjena";
    default:
      return "errAnchor.porteroFondo";
  }
}

/**
 * Lo que dice el portero de esta cuenta y frena el sello antes de apretar (el chequeo de la red), o `null` si no frena.
 * Con el bloque `oficial`, los sellos que quedan son lo menor entre el mes y los sorteos oficiales.
 *
 * - Con el cobro por uso prendido (`conCobroPorUso`, `cobro-oficial.ts`), cero es el tope del mes solo si la cuenta tiene
 *   acceso y le quedan sorteos. Sin acceso o sin sorteos no frena acá: lo resuelve la compuerta del sello
 *   (`sin-sorteos.ts`), con la caja del cupón o «Se te acabaron».
 * - Con el cobro por uso apagado esa compuerta no corre, así que cero frena siempre, como antes: si no, una cuenta de
 *   Google sin acceso firmaría un sello que el portero rechaza, y esa firma cuesta igual. Ante la duda, frena.
 */
export function patrocinioQueFrena(estado: EstadoDelPatrocinio, conCobroPorUso = false): DetalleDelPatrocinio | null {
  if (estado.rige === "pollar") return null;
  if (estado.rige === "cerrado") return { motivo: "cerrado" };
  if (estado.cupo.sellos.quedan > 0) return null;
  const oficial = estado.oficial;
  if (conCobroPorUso && oficial && !(oficial.acceso && (oficial.sorteos?.quedan ?? 0) > 0)) return null;
  return { motivo: "cupo-cuenta", que: "sellos", liberaEn: estado.cupo.liberaEn };
}

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
  // En la red principal con una cuenta de Google o de correo no hay "pagar con mi cuenta": ni con saldo ni con grifo.
  const sinPagoPropio = c.sinPagoPropio === true;
  const puedePagar = !sinPagoPropio && c.saldoXlm !== null && c.costoXlm !== null && c.saldoXlm >= margen * c.costoXlm;
  const testnetConGrifo = !sinPagoPropio && c.red === "testnet" && c.grifo;
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
      // Se quedó sin con qué pagar quien paga la comisión por la persona (Pollar) y ella no tiene cómo pagar: no es su
      // cuenta, y decirle "tu cuenta no tiene saldo" la manda a cargar XLM a una cuenta que nunca los necesitó. Se puede
      // volver a probar (quien mantiene el servicio lo repone), o seguir sin sello.
      if (d.pagador === "patrocinado") return { ...base, frase: "redSinSaldoPatrocinio", principal: "reintentar", secundarias: ["seguir-sin-sello"] };
      return { ...base, principal: "seguir-sin-sello" };
    }
    case "sin-patrocinio": {
      // La red está bien y la comisión la cubre el portero, que hoy no puede. Si el motivo es del servicio
      // (no contesta, está caído, se quedó sin fondo o un error pasajero: `cerrado`, `fondo` o sin detalle),
      // se repone solo, así que la acción principal es volver a probar con el portero; sellar con la cuenta
      // propia queda como secundaria, nunca como principal. Sin reintento automático: lo toca la persona.
      // Si el motivo es de la cuenta (el cupo vuelve el mes que viene, o esta cuenta no entra), queda como
      // siempre: sellar con la propia si puede, y si no, seguir sin sello.
      const frase = fraseDelPatrocinio(d.patrocinio, puedePagar || testnetConGrifo, c.cobroPorUso === true);
      const conFecha = d.patrocinio?.liberaEn !== undefined ? { liberaEn: d.patrocinio.liberaEn } : {};
      const propia = { ...base, frase, ...conFecha };
      // Con el cobro por uso, una cuenta sin acceso al modo Oficial tiene otra cosa que hacer antes que seguir sin sello:
      // usar un cupón, que abre el paso de la cuenta en su campo. Sin firma: la compuerta del sello vuelve a preguntar.
      if (c.cobroPorUso === true && d.patrocinio?.motivo === "ajena") return { ...propia, principal: "usar-cupon", secundarias: ["seguir-sin-sello"] };
      const esDeLaCuenta = d.patrocinio?.motivo === "cupo-cuenta" || d.patrocinio?.motivo === "ajena";
      if (!esDeLaCuenta) {
        if (testnetConGrifo || puedePagar) return { ...propia, principal: "reintentar", secundarias: ["sellar-con-mi-cuenta", "seguir-sin-sello"], cargaPrevia: testnetConGrifo && !puedePagar };
        return { ...propia, principal: "reintentar", secundarias: ["seguir-sin-sello"] };
      }
      if (testnetConGrifo) return { ...propia, principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"], cargaPrevia: !puedePagar };
      if (puedePagar) return { ...propia, principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"] };
      return { ...propia, principal: "seguir-sin-sello" };
    }
    case "protocolo":
      // Solo llega a rojo si la simulación falla: sellar no va a andar. Se puede volver a mirar.
      return { ...base, principal: "seguir-sin-sello", secundarias: ["reintentar"] };
    case "saturada":
      return sinPanel();
  }
}

/**
 * Las frases rojas que ya dicen que hoy no se puede sellar: con "Hoy no se puede sellar:" delante quedaban
 * repetidas ("Hoy no se puede sellar: Hoy sellar cuesta más…", "…: Tu cuenta no tiene saldo para sellar.").
 */
const FRASES_QUE_BASTAN = new Set(["redCostoAlto", "redSinSaldo", "redSinSaldoPatrocinio", "errAnchor.porteroFondo", "errAnchor.porteroCupoSellos", "errAnchor.porteroCupoSorteos", "errAnchor.porteroAjena", "errAnchor.porteroAjenaPropia", "errAnchor.porteroSinAlta"]);

/** Lo que dice el botón "¿La red está bien?": la clave, la frase del caso si es rojo y la segunda frase si la hay. */
export function respuestaDelBoton(d: Diagnostico, p: Panel): { clave: string; motivo?: string; aparte?: string; nivel: Nivel } {
  if (d.sinInternet) return { clave: "errAnchor.offline", nivel: "rojo" };
  if (p.nivel === "verde") return { clave: "redVerde", nivel: "verde" };
  if (p.nivel === "rojo") return FRASES_QUE_BASTAN.has(p.frase) ? { clave: p.frase, nivel: "rojo" } : { clave: "redRoja", motivo: p.frase, nivel: "rojo" };
  // Amarillo: la razón, en una frase (la de lento es la general).
  return { clave: p.frase, ...(p.aparte ? { aparte: p.aparte } : {}), nivel: "amarillo" };
}
