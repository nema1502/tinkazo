/**
 * Lo que el build comprueba del modo premios (`VITE_RAMPA=premios`, `cuenta-config.ts`) antes de armar el sitio. Lo lee
 * `vite.config.ts`, que no puede traer la configuración del navegador: importa solo la puerta de la venta
 * (`venta-piloto.ts`, que no importa nada).
 *
 * El modo premios deja ver el saldo y recibir, y nada más: Mandar se niega y la puerta del premio frena el sello y el
 * sorteo de una cuenta que puede guardar dinero (`wallet-pollar.ts`). Dos cosas de la venta lo contradicen, y las dos
 * firman con la misma cuenta y el mismo voto por hash de siempre:
 *
 * - pagar un paquete con el saldo de la cuenta (`pagarOrden`), que no pasa por la puerta del premio: la compra con QR
 *   carga dólares en la cuenta y los paga con ese pago, así que frenarlo rompería la compra;
 * - la compra con QR, que además prende la carga con bolivianos: trae dinero a una cuenta que el modo promete cuidar.
 *
 * Por eso el build no sale con el modo premios junto con alguna de las dos: obliga a elegir cuál va. No toca ninguna
 * bandera. Devuelve lo que está mal, en español y sin los valores de las variables (una dirección o una llave no se
 * escribe en la bitácora de un build). Vacío: el entorno está bien.
 *
 * Acá vive también el control del costo del retiro (`problemasDelRetiro` y `avisosDelRetiro`, que leen sus dos variables
 * con `retiro-config.ts`): el costo y el modo premios son de la misma cuenta de Google, y se comprueban juntos.
 *
 * Con el voto por contenido (`VITE_VOTO_POR_CONTENIDO=1`, issue 180) el navegador deja de aprobar solo lo que pide el
 * servidor de cuentas y vota lo que armó la página. `problemasDelVoto` frena el build con un valor que la dejaría apagada
 * sin aviso y con lo que firma sin pasar por esa regla en la red principal: pagar con el saldo, la compra con QR, la carga
 * con bolivianos y el modo recibir, que deja Mandar abierto por fuera del modo premios. Con la variable vacía o en `0` no
 * mira nada más.
 *
 * Con pagar con Google (`VITE_PAGAR_CON_GOOGLE=1`) quien organiza carga dólares y paga el premio desde su cuenta de
 * Google. El retiro de quien ganó no depende de esta bandera: va con el voto y el costo (`problemasDelRetiro`).
 * `problemasDePagarConGoogle` frena el build con un valor que la dejaría apagada sin aviso y con lo que le falta o la
 * contradice: el voto por contenido, el modo premios, los premios pagados, la dirección del portero de la red principal
 * (que manda lo firmado) y la venta que paga con el saldo o con QR. Con la variable vacía o en `0` no mira nada más.
 */

import { HOSTS_DEL_PORTERO_OFICIAL, esUrlDePorteroOficial } from "./alta-build";
import { pagosActivos } from "./pagos-bandera";
import { comisionDelBuild, leerMinimo, leerPb, minimoPosible } from "./comision-config";
import { TOPE_DEL_COSTO, STROOPS_POR_DOLAR, leerElCosto, leerLaCuenta } from "./retiro-config";
import { banderasDeVenta } from "./venta-piloto";

/** El modo de la rampa que pide el entorno, escrito como lo lee `modoDeRampa` (`cuenta-config.ts`). */
const modoPedido = (env: Record<string, string | undefined>): string => (env.VITE_RAMPA ?? "").trim().toLowerCase();

const pideElModoPremios = (env: Record<string, string | undefined>): boolean => modoPedido(env) === "premios";

const pideElModoPollar = (env: Record<string, string | undefined>): boolean => modoPedido(env) === "pollar";

/** `meru` es el otro nombre de `recibir`, como en `modoDeRampa`. */
const pideElModoRecibir = (env: Record<string, string | undefined>): boolean => ["recibir", "meru"].includes(modoPedido(env));

export function problemasDePremios(env: Record<string, string | undefined>): string[] {
  if (!pideElModoPremios(env)) return [];
  const venta = banderasDeVenta(env);
  const problemas: string[] = [];
  if (venta.saldo) {
    problemas.push(
      "VITE_RAMPA=premios no va junto con VITE_PAGO_CON_SALDO=1: pagar con el saldo firma con la cuenta que guarda el premio y no pasa por la puerta del premio. Se elige cuál va en este sitio.",
    );
  }
  if (venta.qr) {
    problemas.push(
      "VITE_RAMPA=premios no va junto con VITE_COMPRA_QR=1: la compra con QR carga dólares en la cuenta y los paga con el saldo, y el modo premios solo deja recibir. Se elige cuál va en este sitio.",
    );
  }
  return problemas;
}

/** Lo que el control del costo del retiro necesita de afuera del entorno. */
export interface OpcionesDelRetiro {
  /**
   * La `CUENTA_COBROS` de la red principal que tiene el portero (`workers/patrocinio/wrangler.toml`), leída por quien
   * llama con `cuentaDeCobrosDelPortero`. `null` si no se pudo leer o está vacía.
   */
  cuentaDeCobros: string | null;
}

/**
 * Lo que el build comprueba del costo del retiro (`VITE_RETIRO_COSTO` y `VITE_RETIRO_CUENTA`, `retiro-config.ts`) antes
 * de armar el sitio. Devuelve lo que está mal, en español y sin los valores de las variables. Vacío: puede salir.
 *
 * Frena el build cuando una de las dos está mal escrita (el monto, o una cuenta que no es una dirección G de verdad),
 * cuando la cuenta está puesta y el costo no (no se sabe cuánto cobrar), y cuando la cuenta puesta no es la de cobros del
 * portero, letra por letra (el costo tiene que llegar a donde el portero lo reconoce), también con el costo en cero.
 * Cuando el costo se cobra de verdad (un monto mayor que cero y la cuenta), frena además si:
 *
 * - no se pudo leer la cuenta de cobros del portero, y entonces no hay con qué compararla;
 * - falta `VITE_VOTO_POR_CONTENIDO=1`: sin el voto por contenido, la cuenta de Google firmaría el pago sin mirar qué es;
 * - falta `VITE_PATROCINIO_URL_MAINNET`: sin el portero de la red principal no hay quien mande el retiro.
 *
 * Con el costo puesto y sin la cuenta el build sale y no se cobra nada (`avisosDelRetiro` lo deja dicho).
 */
export function problemasDelRetiro(env: Record<string, string | undefined>, opciones: OpcionesDelRetiro): string[] {
  const problemas: string[] = [];
  const costo = leerElCosto(env.VITE_RETIRO_COSTO);
  const cuenta = leerLaCuenta(env.VITE_RETIRO_CUENTA);
  if (costo.tipo === "mal-escrito") {
    problemas.push("VITE_RETIRO_COSTO está mal escrita: va un monto en dólares con punto y hasta 7 decimales, sin signo, sin letras y sin coma.");
  }
  if (costo.tipo === "sobre-el-tope") {
    problemas.push(`VITE_RETIRO_COSTO pasa el tope de ${TOPE_DEL_COSTO / STROOPS_POR_DOLAR} dólares: arriba de eso es un error de escritura.`);
  }
  if (cuenta.tipo === "invalida") {
    problemas.push("VITE_RETIRO_CUENTA no es una cuenta de Stellar válida: tiene que ser una dirección que empieza con G, con sus 56 caracteres.");
  }
  if (cuenta.tipo === "valida" && costo.tipo === "vacio") {
    problemas.push(
      "VITE_RETIRO_CUENTA está puesta sin VITE_RETIRO_COSTO: no se sabe cuánto cobrar. " +
        "Se pone el monto, o se vacía la cuenta para no cobrar.",
    );
  }
  // La cuenta puesta es siempre la de cobros del portero, se cobre o no: una cuenta distinta no sale ni con el costo en cero.
  if (cuenta.tipo === "valida" && opciones.cuentaDeCobros !== null && cuenta.cuenta !== opciones.cuentaDeCobros) {
    problemas.push(
      "VITE_RETIRO_CUENTA no es la CUENTA_COBROS del portero (workers/patrocinio/wrangler.toml): " +
        "el costo tiene que llegar a la cuenta que el portero reconoce.",
    );
  }
  if (costo.tipo !== "valido" || costo.stroops === 0n || cuenta.tipo !== "valida") return problemas;
  if (opciones.cuentaDeCobros === null) {
    problemas.push(
      "No se pudo leer CUENTA_COBROS de workers/patrocinio/wrangler.toml: " +
        "sin ella no se puede comprobar que el costo llegue a la cuenta del portero.",
    );
  }
  if (env.VITE_VOTO_POR_CONTENIDO !== "1") {
    problemas.push(
      "El costo del retiro necesita VITE_VOTO_POR_CONTENIDO=1: " +
        "sin el voto por contenido, la cuenta de Google firmaría el retiro sin comprobar qué paga.",
    );
  }
  if ((env.VITE_PATROCINIO_URL_MAINNET ?? "").trim() === "") {
    problemas.push("El costo del retiro necesita VITE_PATROCINIO_URL_MAINNET: sin el portero de la red principal no hay quien mande el retiro.");
  }
  return problemas;
}

/**
 * Lo que el build avisa y no frena: el costo puesto sin la cuenta. El sitio sale y no cobra nada ni dice nada del costo,
 * que es lo que se pidió, pero queda dicho en la bitácora para que no pase por olvido. Sin los valores de las variables.
 */
export function avisosDelRetiro(env: Record<string, string | undefined>): string[] {
  const costo = leerElCosto(env.VITE_RETIRO_COSTO);
  const sinCuenta = leerLaCuenta(env.VITE_RETIRO_CUENTA).tipo === "vacia";
  if (costo.tipo !== "valido" || costo.stroops === 0n || !sinCuenta) return [];
  return ["VITE_RETIRO_COSTO está puesta sin VITE_RETIRO_CUENTA: no se cobra nada y el sitio no dice nada del costo."];
}

/**
 * Lo que frena el build por el voto por contenido (`VITE_VOTO_POR_CONTENIDO`, `cuenta-config.ts`). Devuelve lo que está
 * mal, en español y sin los valores de las variables. Vacío: el entorno está bien.
 *
 * - Un valor que no es `1`, `0` ni vacío («true», «on», « 1») la dejaría apagada sin que nadie se enterara: no sale.
 * - Con `1`, no sale si además está prendido lo que firma con la misma cuenta sin pasar por la regla del voto y nadie
 *   probó así en la red principal: pagar con el saldo (`VITE_PAGO_CON_SALDO=1`), la compra con QR (`VITE_COMPRA_QR=1`, que
 *   además carga dólares y los paga con ese saldo), la carga con bolivianos (`VITE_RAMPA=pollar`) y Mandar, que en el modo
 *   `recibir` queda abierto y firma un pago, algo que la regla del voto no deja pasar: siempre fallaría.
 *
 * Con un valor que no vale solo dice eso: las combinaciones se miran con un `1` exacto, que es el único valor que
 * prende la bandera en el sitio. La combinación que se espera, `VITE_RAMPA=premios` (donde Mandar no existe) con
 * `VITE_VOTO_POR_CONTENIDO=1` y sin la venta, no tiene ningún problema.
 */
export function problemasDelVoto(env: Record<string, string | undefined>): string[] {
  const valor = env.VITE_VOTO_POR_CONTENIDO;
  if (valor === undefined || valor.trim() === "" || valor === "0") return [];
  if (valor !== "1") {
    return ["VITE_VOTO_POR_CONTENIDO solo acepta 1 o 0 (vacía es apagada): con otro valor la bandera queda apagada sin aviso."];
  }
  const venta = banderasDeVenta(env);
  const problemas: string[] = [];
  if (venta.saldo) {
    problemas.push(
      "VITE_VOTO_POR_CONTENIDO=1 no va junto con VITE_PAGO_CON_SALDO=1: pagar con el saldo pasaría por el voto a mano " +
        "y nadie lo probó así en la red principal. Se elige cuál va en este sitio.",
    );
  }
  if (venta.qr) {
    problemas.push(
      "VITE_VOTO_POR_CONTENIDO=1 no va junto con VITE_COMPRA_QR=1: la compra con QR carga dólares en la cuenta y los paga " +
        "con el saldo, y nada de eso se probó con el voto a mano en la red principal. Se elige cuál va en este sitio.",
    );
  }
  if (pideElModoPollar(env)) {
    problemas.push(
      "VITE_VOTO_POR_CONTENIDO=1 no va junto con VITE_RAMPA=pollar: la carga con bolivianos no se probó con el voto a mano " +
        "en la red principal. Se elige cuál va en este sitio.",
    );
  }
  if (pideElModoRecibir(env)) {
    problemas.push(
      "VITE_VOTO_POR_CONTENIDO=1 no va junto con VITE_RAMPA=recibir: Mandar queda abierto en ese modo y firma un pago, " +
        "que la regla del voto no deja pasar, así que siempre fallaría. Se elige cuál va en este sitio.",
    );
  }
  return problemas;
}

/**
 * Lo que frena el build por pagar con Google (`VITE_PAGAR_CON_GOOGLE`, `cuenta-config.ts`). Devuelve lo que está mal, en
 * español y sin los valores de las variables. Vacío: el entorno está bien.
 *
 * - Un valor que no es `1`, `0` ni vacío (`true`, `on`, ` 1`) la dejaría apagada sin que nadie se enterara: no sale.
 * - Con `1`, no sale sin `VITE_VOTO_POR_CONTENIDO=1` (sin él, la cuenta firmaría el pago sin comprobar qué paga), sin
 *   `VITE_RAMPA=premios` (las pantallas de cargar y de pagar se arman sobre ese modo), sin `VITE_PAGOS=1` (no aparecería
 *   Pagar premio) ni sin `VITE_PATROCINIO_URL_MAINNET` (el pago lo manda el portero de la red principal). La dirección se
 *   lee como el sitio (sin espacios ni barras al final: `patrocinio-config.ts`) y tiene que ser la del portero oficial
 *   (`esUrlDePorteroOficial`): una barra sola deja al sitio sin portero, y otra dirección recibiría los pagos firmados.
 * - Con `1`, no sale junto con lo que contradice la regla: pagar con el saldo (`VITE_PAGO_CON_SALDO=1`) y la compra con QR
 *   (`VITE_COMPRA_QR=1`), que firman con la misma cuenta sin pasar por la regla del pago de un premio.
 *
 * Con un valor que no vale solo dice eso: las combinaciones se miran con un `1` exacto, que es el único valor que prende
 * la bandera en el sitio. El costo del retiro (`problemasDelRetiro`) y el modo premios (`problemasDePremios`) son
 * controles aparte, que se suman en `vite.config.ts`.
 */
export function problemasDePagarConGoogle(env: Record<string, string | undefined>): string[] {
  const valor = env.VITE_PAGAR_CON_GOOGLE;
  if (valor === undefined || valor.trim() === "" || valor === "0") return [];
  if (valor !== "1") {
    return ["VITE_PAGAR_CON_GOOGLE solo acepta 1 o 0 (vacía es apagada): con otro valor la bandera queda apagada sin aviso."];
  }
  const problemas: string[] = [];
  if (env.VITE_VOTO_POR_CONTENIDO !== "1") {
    problemas.push(
      "VITE_PAGAR_CON_GOOGLE=1 necesita VITE_VOTO_POR_CONTENIDO=1: " +
        "sin el voto por contenido, la cuenta de Google firmaría el pago del premio sin comprobar qué paga.",
    );
  }
  if (!pideElModoPremios(env)) {
    problemas.push(
      "VITE_PAGAR_CON_GOOGLE=1 necesita VITE_RAMPA=premios: " +
        "las pantallas de cargar y de pagar se arman sobre ese modo, y con otro la bandera quedaría apagada sin aviso.",
    );
  }
  if (!pagosActivos(env)) {
    problemas.push("VITE_PAGAR_CON_GOOGLE=1 necesita VITE_PAGOS=1: sin los premios pagados no aparece Pagar premio.");
  }
  const portero = (env.VITE_PATROCINIO_URL_MAINNET ?? "").trim().replace(/\/+$/, "");
  if (portero === "") {
    problemas.push(
      "VITE_PAGAR_CON_GOOGLE=1 necesita VITE_PATROCINIO_URL_MAINNET: " +
        "sin el portero de la red principal no hay quien mande el pago del premio.",
    );
  } else if (!esUrlDePorteroOficial(portero)) {
    problemas.push(
      "VITE_PAGAR_CON_GOOGLE=1 manda el pago firmado a VITE_PATROCINIO_URL_MAINNET, y esa dirección no es la del portero " +
        `de la red principal: tiene que ser https, sin ruta ni consulta, en ${HOSTS_DEL_PORTERO_OFICIAL.join(" o ")}.`,
    );
  }
  const venta = banderasDeVenta(env);
  if (venta.saldo) {
    problemas.push(
      "VITE_PAGAR_CON_GOOGLE=1 no va junto con VITE_PAGO_CON_SALDO=1: pagar con el saldo firma con la misma cuenta " +
        "sin pasar por la regla del pago de un premio ni del retiro. Se elige cuál va en este sitio.",
    );
  }
  if (venta.qr) {
    problemas.push(
      "VITE_PAGAR_CON_GOOGLE=1 no va junto con VITE_COMPRA_QR=1: la compra con QR carga dólares en la cuenta y los paga " +
        "con el saldo, sin pasar por la regla del pago de un premio ni del retiro. Se elige cuál va en este sitio.",
    );
  }
  return problemas;
}

/** Lo que el control de la comisión necesita de afuera del entorno: lo que dice el portero de la red principal. */
export interface OpcionesDeLaComision {
  /** Las cuentas del portero (patrocinadora, cobros y sorteadora) de `workers/patrocinio/wrangler.toml`, o `null` si no se pudo leer. */
  cuentasDelPortero: string[] | null;
  /** El `COSTO_RETIRO` del portero en stroops, o `null` si no se pudo leer. */
  costoDelPortero: bigint | null;
  /** Si el portero atiende retiros (`RETIROS` en `1`), o `null` si no se pudo leer. */
  retirosDelPortero: boolean | null;
}

/**
 * Lo que frena el build por lo que Tinkazo cobra a una campaña (`VITE_COMISION_PB`, `VITE_COMISION_MINIMO` y
 * `VITE_COMISION_CUENTA`, `comision-config.ts`). Devuelve lo que está mal, en español y sin los valores de las variables.
 * Vacío: puede salir. Con las tres vacías no mira nada.
 *
 * - Las tres van juntas: con una sola o con dos, no sale.
 * - Los puntos básicos son un entero de 1 a 1.000 y el mínimo está en dólares con punto y hasta dos decimales.
 * - El mínimo no baja de lo que el camino del retiro puede pagar (el costo del retiro más 1 dólar digital).
 * - La cuenta es una dirección válida, distinta de la de cobros del retiro y de las cuentas del portero.
 * - Hace falta pagar con Google, el costo del retiro cobrándose y, del lado del portero de la red principal, el mismo costo
 *   y los retiros prendidos: con otro costo o con los retiros apagados el panel nunca podría pagar.
 * - Lo último: lo que pasa estos controles tiene que prender de verdad en el sitio. Nunca sale algo que quedaría apagado.
 */
export function problemasDeLaComision(env: Record<string, string | undefined>, opciones: OpcionesDeLaComision): string[] {
  const pb = leerPb(env.VITE_COMISION_PB);
  const minimo = leerMinimo(env.VITE_COMISION_MINIMO);
  const cuenta = leerLaCuenta(env.VITE_COMISION_CUENTA);
  const hay = [pb.tipo !== "vacio", minimo.tipo !== "vacio", cuenta.tipo !== "vacia"];
  if (!hay.some(Boolean)) return [];
  const problemas: string[] = [];
  if (!hay.every(Boolean)) {
    problemas.push("La comisión de las campañas pide VITE_COMISION_PB, VITE_COMISION_MINIMO y VITE_COMISION_CUENTA juntas: falta alguna.");
  }
  if (pb.tipo === "mal-escrito") {
    problemas.push("VITE_COMISION_PB está mal escrita: va un entero de 1 a 1000 (200 es el 2 %), sin signo, sin letras y sin coma.");
  }
  if (minimo.tipo === "mal-escrito") {
    problemas.push("VITE_COMISION_MINIMO está mal escrita: va un monto en dólares con punto y hasta 2 decimales, mayor que cero.");
  }
  if (cuenta.tipo === "invalida") {
    problemas.push("VITE_COMISION_CUENTA no es una cuenta de Stellar válida: tiene que ser una dirección que empieza con G, con sus 56 caracteres.");
  }
  const costo = leerElCosto(env.VITE_RETIRO_COSTO);
  const costoCobrado = costo.tipo === "valido" && costo.stroops > 0n && leerLaCuenta(env.VITE_RETIRO_CUENTA).tipo === "valida" ? costo.stroops : null;
  if (env.VITE_PAGAR_CON_GOOGLE !== "1") {
    problemas.push("La comisión de las campañas necesita VITE_PAGAR_CON_GOOGLE=1: la empresa la paga con su cuenta de Google.");
  }
  if (costoCobrado === null) {
    problemas.push("La comisión de las campañas necesita el costo del retiro cobrándose (VITE_RETIRO_COSTO y VITE_RETIRO_CUENTA): viaja por ese camino.");
  } else if (minimo.tipo === "valido" && minimo.valor < minimoPosible(costoCobrado)) {
    problemas.push("VITE_COMISION_MINIMO no alcanza para el camino del retiro: tiene que ser por lo menos el costo del retiro más 1 dólar.");
  }
  if (cuenta.tipo === "valida") {
    if (cuenta.cuenta === (env.VITE_RETIRO_CUENTA ?? "").trim()) {
      problemas.push("VITE_COMISION_CUENTA no puede ser la cuenta de cobros del retiro: tiene que ser una cuenta común, solo para comisiones.");
    }
    if (opciones.cuentasDelPortero === null) {
      problemas.push(
        "No se pudo leer las cuentas del portero de workers/patrocinio/wrangler.toml: " +
          "sin ellas no se puede comprobar que VITE_COMISION_CUENTA sea una cuenta común.",
      );
    } else if (opciones.cuentasDelPortero.includes(cuenta.cuenta)) {
      problemas.push("VITE_COMISION_CUENTA es una de las cuentas del portero (workers/patrocinio/wrangler.toml): tiene que ser una cuenta común.");
    }
  }
  if (costoCobrado !== null) {
    if (opciones.costoDelPortero === null || opciones.retirosDelPortero === null) {
      problemas.push("No se pudo leer COSTO_RETIRO ni RETIROS de workers/patrocinio/wrangler.toml: sin ellos no se puede comprobar que el portero atienda el cobro.");
    } else {
      if (opciones.costoDelPortero !== costoCobrado) {
        problemas.push("El costo del retiro del sitio no es el COSTO_RETIRO del portero (workers/patrocinio/wrangler.toml): el portero rechazaría el cobro.");
      }
      if (!opciones.retirosDelPortero) {
        problemas.push("El portero de la red principal tiene los retiros apagados (RETIROS en workers/patrocinio/wrangler.toml): el cobro no saldría.");
      }
    }
  }
  // Lo que pasa todos los controles tiene que prender en el sitio: nunca sale algo que allá quedaría apagado.
  if (problemas.length === 0 && comisionDelBuild(env) === null) {
    problemas.push("La comisión de las campañas quedaría apagada en el sitio con esta configuración: alguna variable no cuadra con el costo del retiro.");
  }
  return problemas;
}
