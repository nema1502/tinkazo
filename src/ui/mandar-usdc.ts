import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { type NetworkName, network } from "../stellar/config";
import { type ModoDeRampa, modoDeRampa } from "../stellar/cuenta-config";
import { esDeRed } from "../stellar/errores";
import { passphraseDe } from "../stellar/oficiales";
import { esDireccionG } from "../stellar/pagos";
import { mandarPago } from "../stellar/pagos-envio";
import {
  type CostoDelRetiro,
  type MotivoDeLaRegla,
  NOTA_DEL_RETIRO,
  type PedidoDelRetiro,
  VIDA_DEL_PAGO_S,
  leerPagoArmado,
  motivoContraElRetiro,
  notaParecidaAUnaOrden,
} from "../stellar/pagos-regla";
import { costoDelRetiro, cuentaDelRetiro, montoEnTexto } from "../stellar/retiro-config";
import { type CuentaMirada, type LecturaDeCuenta, mirarCuenta, usdcDeLaRed } from "../stellar/usdc-cuenta";
import { entornoDelBuild } from "../stellar/venta-piloto";
import { abrirDialogo, botonPrincipal, lineaDeEstado } from "./dialogo";
import { con } from "./monedas-vista";

/**
 * Mandar mis dólares digitales: de la cuenta de la persona a otra cuenta de Stellar (otra suya, o una app que los
 * cambie a bolivianos).
 *
 * La dirección y la nota se pegan (vienen de la otra app: es lo único que no es un botón) y el monto se elige con
 * botones: Todo, La mitad, y de a 1 dólar. Antes de dejar mandar se mira la cuenta de destino: si no puede recibir el
 * USDC de Circle, no se manda nada. El pago lo arma la página (un pago clásico, como el de un premio) y, con una cuenta
 * de Google o de correo, va por `signAndSubmit`, que la puerta de firmas confirma porque es la transacción que la
 * página acaba de armar. Con una billetera propia la firma la billetera y la página la manda. Tinkazo no cobra ni
 * guarda nada.
 *
 * Con `VITE_RAMPA=premios` Mandar no existe: la función que prepara el envío, la que lo manda y la que abre la ventana
 * se niegan (`mandarPermitido`), no solo se esconde el botón. Mandar vuelve cuando el sello y el sorteo se voten a mano.
 *
 * Con el costo del retiro configurado (`stellar/retiro-config.ts`) y una cuenta de Google, Mandar es un retiro: una sola
 * transacción con dos pagos de la misma moneda, primero lo que llega al destino (lo que sale de la cuenta menos el costo) y
 * después el costo exacto a la cuenta del costo. La persona elige cuánto sale de su cuenta y ve tres números antes de
 * confirmar: lo que sale, el costo y lo que llega. Lo que llega es siempre 1 dólar digital o más, también con Todo y con La
 * mitad, y si el saldo no alcanza no se arma nada y la pantalla lo dice. Antes de firmar, la transacción armada pasa por
 * `motivoContraElRetiro` y, si no es exactamente la pedida, no se manda. Los montos son siempre enteros en stroops
 * (siete decimales), nunca decimales de coma flotante. Sin el costo configurado, o con otra cuenta que no sea de Google,
 * Mandar es el de siempre: un solo pago y los mismos textos.
 */

const STROOPS = 10_000_000n;
const UN_DOLAR = STROOPS;
/** El máximo de una nota numérica de Stellar (un entero sin signo de 64 bits). */
const MAX_NOTA_ID = 18_446_744_073_709_551_615n;
/** Lo que cabe en una nota de texto, en bytes. */
const NOTA_MAX_BYTES = 28;
const COMISION = "1000";
const VALE_S = 600;

/* ------------------------------------------------------------------ lo puro */

/** La nota que pidió la app que recibe: ninguna, un número (como la piden muchos exchanges) o un texto corto. */
export type Nota = { tipo: "ninguna" } | { tipo: "id"; valor: string } | { tipo: "texto"; valor: string };

/** Lo pegado como nota, o `null` si no entra en una nota de Stellar. */
export function leerNota(crudo: string): Nota | null {
  const s = crudo.trim();
  if (s === "") return { tipo: "ninguna" };
  if (/^\d{1,20}$/.test(s) && BigInt(s) <= MAX_NOTA_ID) return { tipo: "id", valor: s };
  if (new TextEncoder().encode(s).length <= NOTA_MAX_BYTES) return { tipo: "texto", valor: s };
  return null;
}

/** Lo pegado como dirección, o `null` si no es una cuenta de Stellar (una `G…` con su control). */
export function leerDireccion(crudo: string): string | null {
  const s = crudo.trim();
  return esDireccionG(s) ? s : null;
}

/** La mitad de lo que hay, sin pasarse. */
export const mitadDe = (saldo: bigint): bigint => saldo / 2n;

/** Sumar o restar 1 dólar: nunca más que todo, ni menos que 1 dólar (o todo, si hay menos de 1). */
export function deAUnDolar(monto: bigint, signo: 1 | -1, saldo: bigint): bigint {
  const piso = saldo < UN_DOLAR ? saldo : UN_DOLAR;
  const siguiente = monto + BigInt(signo) * UN_DOLAR;
  if (siguiente > saldo) return saldo;
  if (siguiente < piso) return piso;
  return siguiente;
}

/* ------------------------------------------------------------ los montos de un retiro con costo */

/** Lo menos que tiene que llegar con un retiro con costo: 1 dólar digital. */
const LLEGA_MINIMO = UN_DOLAR;

/** Lo menos que tiene que salir de la cuenta para retirar con costo: el dólar que llega más el costo. */
export const minimoParaRetirar = (costo: bigint): bigint => costo + LLEGA_MINIMO;

/** ¿Alcanza `sale` para un retiro con costo? Lo que llega (`sale` menos el costo) tiene que ser 1 dólar o más. */
export const puedeRetirar = (sale: bigint, costo: bigint): boolean => sale >= minimoParaRetirar(costo);

/**
 * Por qué un saldo no alcanza para retirar: `costo` si ni siquiera cubre el costo (es igual o menor), `minimo` si lo
 * cubre pero lo que llegaría es menos de 1 dólar. `null` si alcanza.
 */
export function faltaParaRetirar(saldo: bigint, costo: bigint): "costo" | "minimo" | null {
  if (saldo <= costo) return "costo";
  return puedeRetirar(saldo, costo) ? null : "minimo";
}

/** Lo que llega con un retiro: lo que sale de la cuenta menos el costo, exacto en stroops. */
export const llegaDe = (sale: bigint, costo: bigint): bigint => sale - costo;

/** ¿Se ofrece La mitad? Solo si la mitad del saldo alcanza para retirar (lo que llega es 1 dólar o más). */
export const seOfreceLaMitad = (saldo: bigint, costo: bigint): boolean => puedeRetirar(mitadDe(saldo), costo);

/**
 * Sumar o restar 1 dólar a lo que sale de la cuenta, con costo: nunca más que todo el saldo ni menos de lo que hace falta
 * para que lleguen 1 dólar (el piso es el costo más 1 dólar, o todo el saldo si hay menos).
 */
export function deAUnDolarConCosto(monto: bigint, signo: 1 | -1, saldo: bigint, costo: bigint): bigint {
  const piso = minimoParaRetirar(costo);
  const siguiente = monto + BigInt(signo) * UN_DOLAR;
  if (siguiente > saldo) return saldo;
  if (siguiente < piso) return piso > saldo ? saldo : piso;
  return siguiente;
}

const siete = (s: bigint): string => `${s / STROOPS}.${(s % STROOPS).toString().padStart(7, "0")}`;

const stroopsDeHorizon = (m: string): bigint | null => {
  const x = /^(\d{1,13})(?:\.(\d{1,7}))?$/.exec(m);
  return x ? BigInt(x[1] as string) * STROOPS + BigInt((x[2] ?? "").padEnd(7, "0")) : null;
};

/** El USDC de Circle de la cuenta: saldo y lugar que le queda, o `null` si no tiene la línea autorizada. */
export function usdcDe(c: CuentaMirada, red: NetworkName): { saldo: bigint; lugar: bigint } | null {
  const usdc = usdcDeLaRed(red);
  const l = c.saldos.find((s) => s.code === usdc.code && s.issuer === usdc.issuer);
  if (!l || !l.autorizada) return null;
  const saldo = stroopsDeHorizon(l.saldo);
  const limite = stroopsDeHorizon(l.limite);
  if (saldo === null || limite === null) return null;
  return { saldo, lugar: limite - saldo };
}

/** ¿La cuenta de destino puede recibir este monto? */
export const puedeRecibir = (l: LecturaDeCuenta, red: NetworkName, monto: bigint): boolean => {
  if (typeof l !== "object") return false;
  const u = usdcDe(l, red);
  return u !== null && u.lugar >= monto;
};

export interface DatosDelEnvio {
  red: NetworkName;
  origen: string;
  destino: string;
  /**
   * En stroops (siete decimales). Es lo que sale de la cuenta: sin costo llega todo, y con costo llega lo que sale menos
   * el costo.
   */
  monto: bigint;
  nota: Nota;
  /**
   * El costo del retiro: cuánto y a qué cuenta común va. Sin él (ausente o `null`), un solo pago como siempre. Lo pone
   * `depsDelSitio` solo para una cuenta de Google en la red principal con el costo configurado, y nunca cuando el destino
   * es la propia cuenta del costo (pagar a Tinkazo no cobra costo).
   */
  costo?: CostoDelRetiro | null;
}

/** ¿Se puede mandar? No en el modo `premios`: ahí la cuenta solo ve su saldo y recibe. */
export const mandarPermitido = (modo: ModoDeRampa = modoDeRampa()): boolean => modo !== "premios";

/**
 * La nota que lleva el pago. Con costo y sin nota pedida, la fija del retiro (`tkz-retiro`): así ningún lector de órdenes
 * confunde el pago del costo con otra cosa. Sin costo, la que pegó la persona, tal cual.
 */
export function notaDelEnvio(d: Pick<DatosDelEnvio, "nota" | "costo">): Nota {
  return d.costo && d.nota.tipo === "ninguna" ? { tipo: "texto", valor: NOTA_DEL_RETIRO } : d.nota;
}

/** El costo tiene forma: un monto positivo, una cuenta común que no es la de quien manda ni su destino, y llega 1 dólar o más. */
function costoValido(d: DatosDelEnvio, costo: CostoDelRetiro): boolean {
  if (costo.stroops <= 0n || !esDireccionG(costo.destino) || costo.destino === d.origen || costo.destino === d.destino) return false;
  return llegaDe(d.monto, costo.stroops) >= LLEGA_MINIMO;
}

/**
 * Arma el pago sin firmarlo, con la secuencia de la cuenta. Sin costo, un `payment` de USDC de Circle con la nota pedida,
 * que vence a los 600 segundos. Con costo, dos `payment` de USDC de Circle en este orden fijo: lo que llega al destino y
 * después el costo exacto a la cuenta del costo, con la nota del retiro y vida de 240 segundos. En el modo `premios` se
 * niega: ningún camino arma un pago de esta cuenta, venga de donde venga la llamada.
 */
export async function armarEnvio(d: DatosDelEnvio, secuencia: string): Promise<string> {
  if (!mandarPermitido()) throw new Error("mandar: apagado");
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || d.origen === d.destino || d.monto <= 0n) throw new Error("mandar: datos inválidos");
  const costo = d.costo ?? null;
  if (costo !== null && !costoValido(d, costo)) throw new Error("mandar: datos inválidos");
  const usdc = usdcDeLaRed(d.red);
  const { Account, Asset, Memo, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const activo = new Asset(usdc.code, usdc.issuer);
  const b = new TransactionBuilder(new Account(d.origen, secuencia), { fee: COMISION, networkPassphrase: passphraseDe(d.red) }).addOperation(
    Operation.payment({ destination: d.destino, asset: activo, amount: siete(costo === null ? d.monto : llegaDe(d.monto, costo.stroops)) }),
  );
  if (costo !== null) b.addOperation(Operation.payment({ destination: costo.destino, asset: activo, amount: siete(costo.stroops) }));
  const nota = notaDelEnvio(d);
  if (nota.tipo === "id") b.addMemo(Memo.id(nota.valor));
  else if (nota.tipo === "texto") b.addMemo(Memo.text(nota.valor));
  return b.setTimeout(costo === null ? VALE_S : VIDA_DEL_PAGO_S).build().toXDR();
}

/** El retiro que se espera ver armado, con lo que llega y la nota que lleva. Es lo que pide la regla de los pagos. */
function pedidoDelRetiro(d: DatosDelEnvio, costo: CostoDelRetiro): PedidoDelRetiro {
  return { cuenta: d.origen, destino: d.destino, llega: llegaDe(d.monto, costo.stroops), nota: notaDelEnvio({ nota: d.nota, costo }), costo };
}

/**
 * ¿La transacción armada es exactamente el retiro pedido, y nada más? `null` si lo es o si no hay costo (un pago de los de
 * siempre no pasa por esta regla), y si no, el motivo en palabras fijas. Mira la hora de este equipo: la transacción
 * vence a los 240 segundos de armada y la regla acepta como mucho 300.
 */
export async function motivoContraElEnvio(xdr: string, d: DatosDelEnvio): Promise<MotivoDeLaRegla | null> {
  const costo = d.costo ?? null;
  if (costo === null) return null;
  const leido = await leerPagoArmado(xdr, passphraseDe(d.red));
  return motivoContraElRetiro(leido, pedidoDelRetiro(d, costo), { ahora: Math.floor(Date.now() / 1000) });
}

export type Preparado =
  | { ok: true; xdr: string }
  | { ok: false; motivo: "no-recibe" | "sin-saldo" | "sin-red" | "datos" | "apagado" | "sin-retiro" | "regla" };

/**
 * Mira las cuentas y arma el pago si va a entrar entero. No firma ni manda nada. El modo sale de `VITE_RAMPA`, no de quien
 * llama. Con costo mira también la cuenta del costo (si no puede recibirlo, `sin-retiro` y no se arma nada) y, ya armada,
 * pasa la transacción por la regla del retiro (si no es exactamente la pedida, `regla`).
 */
export async function prepararEnvio(d: DatosDelEnvio, mirar: (cuenta: string) => Promise<LecturaDeCuenta>): Promise<Preparado> {
  if (!mandarPermitido()) return { ok: false, motivo: "apagado" };
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || d.origen === d.destino || d.monto <= 0n) return { ok: false, motivo: "datos" };
  const costo = d.costo ?? null;
  if (costo !== null && !costoValido(d, costo)) return { ok: false, motivo: "datos" };
  const [origen, destino, cobros] = await Promise.all([
    mirar(d.origen),
    mirar(d.destino),
    costo === null ? Promise.resolve(null) : mirar(costo.destino),
  ]);
  if (origen === "sin-red" || destino === "sin-red" || cobros === "sin-red") return { ok: false, motivo: "sin-red" };
  const suyo = typeof origen === "object" ? usdcDe(origen, d.red) : null;
  if (!suyo || suyo.saldo < d.monto || typeof origen !== "object") return { ok: false, motivo: "sin-saldo" };
  if (!puedeRecibir(destino, d.red, costo === null ? d.monto : llegaDe(d.monto, costo.stroops))) return { ok: false, motivo: "no-recibe" };
  if (costo !== null && (cobros === null || !puedeRecibir(cobros, d.red, costo.stroops))) return { ok: false, motivo: "sin-retiro" };
  try {
    const xdr = await armarEnvio(d, origen.secuencia);
    if ((await motivoContraElEnvio(xdr, d)) !== null) return { ok: false, motivo: "regla" };
    return { ok: true, xdr };
  } catch {
    return { ok: false, motivo: "datos" };
  }
}

/** Cómo terminó: mandado, se está mandando (no se sabe todavía), no lo aprobó en su billetera, o no salió. */
export type ResultadoDelEnvio = "listo" | "en-curso" | "no-aprobado" | "no-salio";

/* ------------------------------------------------------------------ la ventana */

export interface DepsDeMandar {
  red: NetworkName;
  mirar(cuenta: string): Promise<LecturaDeCuenta>;
  /** Lo que hay en el portapapeles, o `null` si el navegador no deja leerlo. */
  pegar(): Promise<string | null>;
  /** Mira las cuentas y arma el pago (`prepararEnvio`). */
  preparar(d: DatosDelEnvio): Promise<Preparado>;
  /**
   * Firma y manda lo armado. Con el costo configurado, o con datos que traen un costo, antes de firmar vuelve a comprobar
   * que el costo de los datos es el que rige según la configuración y que lo armado es exactamente ese retiro.
   */
  enviar(xdr: string, origen: string, datos?: DatosDelEnvio): Promise<ResultadoDelEnvio>;
  /**
   * El costo del retiro de esta cuenta, o `null` si no se cobra. Sin esta función no hay costo. El del sitio devuelve el
   * costo solo para una cuenta de Google en la red principal con el costo configurado.
   */
  costo?(origen: string): Promise<CostoDelRetiro | null>;
}

/**
 * El costo del retiro que rige para la cuenta `origen`, sacado de la configuración del build y nunca de la pantalla: solo
 * para una cuenta de Google con sesión en la red principal y con el costo configurado. Si no, `null`.
 */
async function costoQueRige(origen: string): Promise<CostoDelRetiro | null> {
  // Sin costo configurado, o fuera de la red principal, no se cobra nada y ni se miran las billeteras.
  if (network.name !== "mainnet") return null;
  const entorno = entornoDelBuild();
  const stroops = costoDelRetiro(entorno);
  const cuenta = cuentaDelRetiro(entorno);
  if (stroops === null || cuenta === null) return null;
  const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
  const w = activeWallet();
  // Con una billetera propia, nunca costo: el retiro de esa billetera no pasa por Tinkazo.
  return w?.address === origen && submitsItself(w) ? { stroops, destino: cuenta } : null;
}

/** ¿Dos costos son el mismo? Los dos ninguno, o el mismo monto a la misma cuenta. */
const mismoCosto = (a: CostoDelRetiro | null, b: CostoDelRetiro | null): boolean =>
  a === null || b === null ? a === b : a.stroops === b.stroops && a.destino === b.destino;

/** Lo que usa la ventana en el sitio. Se exporta para probar que `enviar` se niega aunque se lo llame directo. */
export function depsDelSitio(): DepsDeMandar {
  const mirar = (cuenta: string): Promise<LecturaDeCuenta> => mirarCuenta(network.name, cuenta);
  return {
    red: network.name,
    mirar,
    preparar: (d) => prepararEnvio(d, mirar),
    costo: (origen) => costoQueRige(origen),
    async pegar() {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    },
    async enviar(xdr, origen, datos) {
      if (!mandarPermitido()) return "no-salio";
      const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
      const w = activeWallet();
      if (!w?.address || w.address !== origen) return "no-salio";
      // El costo que vale es el de la configuración, no el que diga la ventana: unos datos sin costo, con otro costo o
      // con costo para una billetera propia no se firman. Pagar a la propia cuenta del costo no lo cobra. Con costo, lo
      // armado tiene que ser exactamente el retiro pedido: si no, no se firma.
      const rige = await costoQueRige(origen);
      if (rige !== null || datos?.costo) {
        if (!datos || datos.origen !== origen) return "no-salio";
        const costo = rige !== null && datos.destino !== rige.destino ? rige : null;
        if (!mismoCosto(datos.costo ?? null, costo)) return "no-salio";
        if (costo !== null && (await motivoContraElEnvio(xdr, datos)) !== null) return "no-salio";
      }
      if (submitsItself(w)) {
        try {
          await w.signAndSubmit(xdr);
          return "listo";
        } catch (e) {
          // Una co-firma pendiente o un corte: no se sabe todavía, y no se manda de nuevo.
          return e instanceof Error && e.message === "pollar-pending" ? "en-curso" : esDeRed(e) ? "en-curso" : "no-salio";
        }
      }
      let firmado: string;
      try {
        firmado = (await w.signTransaction(xdr, { networkPassphrase: passphraseDe(network.name), address: origen })).signedTxXdr;
      } catch {
        return "no-aprobado";
      }
      const env = await mandarPago(network.name, firmado);
      if (env.ok) return "listo";
      return env.rechazo === "sin-respuesta" ? "en-curso" : "no-salio";
    },
  };
}

const formato = (s: bigint): string => new Intl.NumberFormat(getLang(), { maximumFractionDigits: 7 }).format(Number(s) / 1e7);
const corta = (g: string): string => `${g.slice(0, 4)}…${g.slice(-4)}`;
/** Un monto de un retiro con su unidad y siempre con dos decimales como mínimo (`0,50 dólares digitales`), exacto desde los stroops. */
const dolares = (s: bigint): string => con(t("saldoMonto"), { n: montoEnTexto(s, getLang()) });

/** Por qué no se pudo preparar el envío. */
type NoSePudo = Extract<Preparado, { ok: false }>["motivo"];

/** La clave del texto que dice por qué no se pudo preparar el envío. */
function claveDeQueNoSePudo(motivo: NoSePudo): "saldoMandarNoRecibe" | "saldoError" | "saldoRetiroNoDisponible" | "saldoMandarNoSalio" {
  if (motivo === "no-recibe") return "saldoMandarNoRecibe";
  if (motivo === "sin-red") return "saldoError";
  return motivo === "sin-retiro" ? "saldoRetiroNoDisponible" : "saldoMandarNoSalio";
}

/** Lo que dice la ventana cuando salió: lo mandado, y con costo también cuánto llega y a quién. */
function textoDeListo(datos: DatosDelEnvio): string {
  const costo = datos.costo ?? null;
  if (costo === null) return con(t("saldoMandarListo"), { n: formato(datos.monto) });
  return con(t("saldoRetiroListo"), { n: dolares(datos.monto), m: dolares(llegaDe(datos.monto, costo.stroops)), corta: corta(datos.destino) });
}

/**
 * Abre Mandar mis dólares digitales para la cuenta `address`, con `saldo` en stroops (lo que la ventana de los dólares
 * acaba de leer). `deps` reemplaza lo del sitio (en las pruebas).
 */
export function abrirMandar(o: { address: string; saldo: bigint }, parcial: Partial<DepsDeMandar> = {}): void {
  if (!mandarPermitido()) return;
  const deps: DepsDeMandar = { ...depsDelSitio(), ...parcial };
  const estado = {
    destino: null as string | null,
    lectura: null as LecturaDeCuenta | null,
    nota: { tipo: "ninguna" } as Nota,
    monto: o.saldo,
    fin: false,
    /** Mandando: hasta saber cómo terminó no se cambia nada. */
    enviando: false,
    abierta: true,
    pegarAMano: false,
    /** El costo del retiro de esta cuenta, o `null` si no se cobra. Hasta saber cuál es (`costoMirado`), no se manda. */
    costo: null as CostoDelRetiro | null,
    costoMirado: deps.costo === undefined,
    /** No se pudo saber si hay costo: no se manda nada y la ventana lo dice. */
    costoFallo: false,
  };
  const d = abrirDialogo({
    titulo: t("saldoMandarBtn"),
    onCerrar: () => {
      estado.abierta = false;
    },
  });
  const linea = lineaDeEstado();
  const boton = botonPrincipal(t("saldoMandarOk"));
  d.pie.append(linea, boton);
  // La ventana de Mandar lleva su propia clase: en laptop es más ancha y en el celular va abajo, al alcance del pulgar.
  d.card.classList.add("dlg-mandar");

  /** Lo que dice la línea de estado. Un error se pinta aparte para que no se lea como un texto común. */
  const decir = (texto: string, mala = false): void => {
    linea.textContent = texto;
    linea.classList.toggle("bad", mala);
  };

  /** El costo que rige ahora: el configurado, salvo que el destino sea la propia cuenta del costo (eso no es un retiro). */
  const costoVigente = (): CostoDelRetiro | null => (estado.costo !== null && estado.destino !== estado.costo.destino ? estado.costo : null);
  /** Lo que llega al destino con el monto elegido: lo mismo sin costo, y el monto menos el costo con costo. */
  const llegaAhora = (): bigint => {
    const costo = costoVigente();
    return costo === null ? estado.monto : llegaDe(estado.monto, costo.stroops);
  };
  /** Con costo, una nota de texto que se lee como una orden de compra no se manda: el costo se mezclaría con una orden. */
  const notaBloqueada = (): boolean => costoVigente() !== null && estado.nota.tipo === "texto" && notaParecidaAUnaOrden(estado.nota.valor);
  /** Con costo, por qué el saldo no alcanza para retirar, o `null` si alcanza. */
  const faltaSaldo = (): "costo" | "minimo" | null => {
    const costo = costoVigente();
    return costo === null || estado.fin ? null : faltaParaRetirar(o.saldo, costo.stroops);
  };

  const listo = (): boolean => {
    if (!estado.costoMirado || estado.destino === null || estado.lectura === null || estado.monto <= 0n) return false;
    const costo = costoVigente();
    if (costo !== null && (!puedeRetirar(estado.monto, costo.stroops) || notaBloqueada())) return false;
    return puedeRecibir(estado.lectura, deps.red, llegaAhora());
  };

  /** Lo que se dice cuando el saldo no alcanza para retirar: no se arma nada. */
  function textoDeQueNoAlcanza(falta: "costo" | "minimo", costo: bigint): string {
    const tiene = dolares(o.saldo);
    const cuesta = montoEnTexto(costo, getLang());
    if (falta === "costo") return con(t("saldoRetiroNoAlcanza"), { c: cuesta, n: tiene });
    return con(t("saldoRetiroMinimo"), { m: montoEnTexto(minimoParaRetirar(costo), getLang()), c: cuesta, n: tiene });
  }

  /** Los botones de monto: Todo, La mitad (si alcanza con costo) y de a un dólar. */
  function botonesDeMonto(quieto: string): string {
    const costo = costoVigente();
    const mitad = costo === null || seOfreceLaMitad(o.saldo, costo.stroops);
    const eligioTodo = estado.monto === o.saldo;
    const eligioLaMitad = estado.monto === mitadDe(o.saldo) && !eligioTodo;
    return (
      `<button type="button" class="mini" data-mandar="todo" aria-pressed="${eligioTodo}"${quieto}>${esc(t("saldoMandarTodo"))}</button>` +
      (mitad
        ? `<button type="button" class="mini" data-mandar="mitad" aria-pressed="${eligioLaMitad}"${quieto}>${esc(t("saldoMandarMitad"))}</button>`
        : "") +
      `<button type="button" class="mini" data-mandar="menos" aria-label="${esc(t("saldoMandarMenos"))}"${quieto}>-1</button>` +
      `<button type="button" class="mini" data-mandar="mas" aria-label="${esc(t("saldoMandarMas"))}"${quieto}>+1</button>`
    );
  }

  /** La fila de cuánto: sin costo, el monto y sus botones. Con costo, los tres números: lo que sale, el costo y lo que llega. */
  function filaDeCuanto(quieto: string): string {
    const costo = costoVigente();
    if (costo === null) {
      const monto = esc(con(t("saldoMonto"), { n: formato(estado.monto) }));
      return (
        `<div class="saldo-dato"><dt>${esc(t("saldoMandarCuanto"))}</dt><dd><b data-mandar="monto">${monto}</b></dd>` +
        `<dd class="saldo-montos">${botonesDeMonto(quieto)}</dd></div>`
      );
    }
    return (
      `<div class="saldo-dato"><dt>${esc(t("saldoRetiroSale"))}</dt><dd><b data-mandar="sale">${esc(dolares(estado.monto))}</b></dd>` +
      `<dd class="saldo-montos">${botonesDeMonto(quieto)}</dd></div>` +
      `<div class="saldo-dato"><dt>${esc(t("saldoRetiroCosto"))}</dt><dd><span data-mandar="costo">${esc(dolares(costo.stroops))}</span></dd></div>` +
      `<div class="saldo-dato"><dt>${esc(t("saldoRetiroLlega"))}</dt><dd><b data-mandar="llega">${esc(dolares(llegaAhora()))}</b></dd></div>`
    );
  }

  /** Lo que dice la línea de estado cuando ya se puede mandar: cuánto y a quién. */
  function resumenDe(destino: string): string {
    const costo = costoVigente();
    if (costo === null) return con(t("saldoMandarResumen"), { n: formato(estado.monto), corta: corta(destino) });
    return con(t("saldoRetiroResumen"), { n: dolares(estado.monto), c: dolares(costo.stroops), m: dolares(llegaAhora()), corta: corta(destino) });
  }

  /** Pinta la ventana. Con `resumen`, la línea de estado dice cuánto y a quién (si ya se puede mandar). */
  function pintar(resumen = false): void {
    if (!estado.abierta) return;
    const nota = estado.nota.tipo === "ninguna" ? t("saldoMandarSinNota") : estado.nota.valor;
    // Mandando, mandado o en camino: lo elegido queda a la vista, pero ya no se cambia.
    const quieto = estado.fin || estado.enviando ? " disabled" : "";
    const campo = (cual: "dir" | "nota", etiqueta: string): string =>
      estado.pegarAMano && !quieto
        ? `<input class="saldo-bs" data-mandar="campo-${cual}" type="text" autocomplete="off" spellcheck="false" aria-label="${esc(etiqueta)}" placeholder="${esc(etiqueta)}">`
        : "";
    const total = estado.fin ? "" : `<p class="saldo-total">${esc(con(t("saldoTenes"), { n: formato(o.saldo) }))}</p>`;
    const falta = faltaSaldo();
    const costoDeAhora = costoVigente();
    if (falta !== null && costoDeAhora !== null) {
      // El saldo no alcanza para un retiro: sin montos ni botón activo, y la pantalla dice por qué. No se arma nada.
      d.cuerpo.innerHTML = total;
      boton.disabled = true;
      linea.classList.remove("ok");
      decir(textoDeQueNoAlcanza(falta, costoDeAhora.stroops));
      return;
    }
    d.cuerpo.innerHTML =
      // El saldo de antes de mandar: después de mandado ya no es el que hay.
      total +
      `<section class="saldo-paso">` +
      `<dl class="saldo-datos">` +
      `<div class="saldo-dato"><dt>${esc(t("saldoMandarA"))}</dt><dd>` +
      (estado.destino ? `<code class="saldo-dir" data-mandar="dir">${esc(estado.destino)}</code>` : "") +
      `<button type="button" class="mini" data-mandar="pegar-dir"${quieto}>${esc(t("saldoMandarPegar"))}</button>${campo("dir", t("saldoMandarPegar"))}</dd></div>` +
      `<div class="saldo-dato"><dt>${esc(t("saldoNota"))}</dt><dd><span data-mandar="nota">${esc(nota)}</span>` +
      `<button type="button" class="mini" data-mandar="pegar-nota"${quieto}>${esc(t("saldoMandarNota"))}</button>${campo("nota", t("saldoMandarNota"))}</dd>` +
      `<dd class="saldo-pista">${esc(t("saldoMandarNotaAyuda"))}</dd></div>` +
      filaDeCuanto(quieto) +
      `</dl></section>`;
    const en = (k: string, f: () => void): void => d.cuerpo.querySelector<HTMLElement>(`[data-mandar="${k}"]`)?.addEventListener("click", f);
    en("pegar-dir", () => void pegar("dir"));
    en("pegar-nota", () => void pegar("nota"));
    en("todo", () => cambiarMonto(o.saldo));
    en("mitad", () => cambiarMonto(mitadDe(o.saldo)));
    en("menos", () => cambiarMonto(otroDolar(-1)));
    en("mas", () => cambiarMonto(otroDolar(1)));
    for (const cual of ["dir", "nota"] as const) {
      d.cuerpo.querySelector<HTMLInputElement>(`[data-mandar="campo-${cual}"]`)?.addEventListener("change", (ev) => void usar(cual, (ev.target as HTMLInputElement).value));
    }
    // Mientras se manda, el botón queda apagado: un segundo toque no arma otro envío.
    boton.disabled = estado.fin ? false : estado.enviando || !listo();
    if (resumen && !estado.fin && listo() && estado.destino) decir(resumenDe(estado.destino));
    if (estado.costoFallo) {
      linea.classList.remove("ok");
      decir(t("saldoRetiroNoDisponible"), true);
    }
  }

  /** Un dólar más o menos de lo que sale de la cuenta, con el piso que corresponde si hay costo. */
  function otroDolar(signo: 1 | -1): bigint {
    const costo = costoVigente();
    return costo === null ? deAUnDolar(estado.monto, signo, o.saldo) : deAUnDolarConCosto(estado.monto, signo, o.saldo, costo.stroops);
  }

  function cambiarMonto(m: bigint): void {
    if (estado.fin || estado.enviando) return;
    estado.monto = m;
    linea.classList.remove("ok");
    const noRecibe = estado.destino && estado.lectura !== null && !puedeRecibir(estado.lectura, deps.red, llegaAhora());
    if (noRecibe) decir(t("saldoMandarNoRecibe"), true);
    pintar(true);
  }

  /**
   * Cambia el destino. Si con eso cambia si hay costo (pagar a la propia cuenta del costo no lo cobra), lo elegido vuelve a
   * Todo: un monto que servía sin costo puede no servir con costo.
   */
  function fijarDestino(dir: string | null): void {
    const habiaCosto = costoVigente() !== null;
    estado.destino = dir;
    if ((costoVigente() !== null) !== habiaCosto) estado.monto = o.saldo;
  }

  async function pegar(cual: "dir" | "nota"): Promise<void> {
    if (estado.fin || estado.enviando) return;
    const texto = await deps.pegar();
    if (!estado.abierta) return;
    if (texto === null) {
      // El navegador no deja leer el portapapeles: un campo donde pegarlo.
      estado.pegarAMano = true;
      pintar();
      d.cuerpo.querySelector<HTMLInputElement>(`[data-mandar="campo-${cual}"]`)?.focus();
      return;
    }
    await usar(cual, texto);
  }

  async function usar(cual: "dir" | "nota", texto: string): Promise<void> {
    // Mandando, mandado o en camino: ya no se cambia nada.
    if (estado.fin || estado.enviando) return;
    linea.classList.remove("ok");
    if (cual === "nota") {
      const n = leerNota(texto);
      const sirve = n !== null && !(costoVigente() !== null && n.tipo === "texto" && notaParecidaAUnaOrden(n.valor));
      if (!sirve) decir(t("saldoMandarNotaMala"), true);
      else {
        estado.nota = n;
        decir("");
      }
      pintar(sirve);
      return;
    }
    const dir = leerDireccion(texto);
    estado.lectura = null;
    if (dir === null || dir === o.address) {
      fijarDestino(null);
      decir(t("saldoMandarNoRecibe"), true);
      pintar();
      return;
    }
    fijarDestino(dir);
    decir(t("saldoMandarMirando"));
    pintar();
    const l = await deps.mirar(dir);
    if (!estado.abierta || estado.destino !== dir) return;
    estado.lectura = l;
    if (l === "sin-red") decir(t("saldoError"), true);
    else if (notaBloqueada()) decir(t("saldoMandarNotaMala"), true);
    else if (puedeRecibir(l, deps.red, llegaAhora())) decir("");
    else decir(t("saldoMandarNoRecibe"), true);
    pintar(true);
  }

  boton.addEventListener("click", () => {
    if (boton.disabled) return;
    if (estado.fin) {
      d.cerrar();
      return;
    }
    void mandar();
  });

  async function mandar(): Promise<void> {
    if (estado.enviando || !listo() || !estado.destino) return;
    boton.disabled = true;
    linea.classList.remove("ok");
    decir(t("saldoMandarEnCurso"));
    estado.enviando = true;
    pintar();
    const datos: DatosDelEnvio = { red: deps.red, origen: o.address, destino: estado.destino, monto: estado.monto, nota: estado.nota };
    const costo = costoVigente();
    try {
      await enviarLoElegido(costo === null ? datos : { ...datos, costo });
    } finally {
      estado.enviando = false;
    }
    pintar();
  }

  async function enviarLoElegido(datos: DatosDelEnvio): Promise<void> {
    const p = await deps.preparar(datos).catch(() => ({ ok: false, motivo: "sin-red" }) as const);
    if (!estado.abierta) return;
    if (!p.ok) {
      // Si el destino ya no puede recibir, se vuelve a mirar: Mandar queda apagado hasta que pueda.
      if (p.motivo === "no-recibe") estado.lectura = await deps.mirar(datos.destino).catch(() => "sin-red" as const);
      if (!estado.abierta) return;
      decir(t(claveDeQueNoSePudo(p.motivo)), true);
      return;
    }
    const r = await deps.enviar(p.xdr, o.address, datos).catch(() => "no-salio" as const);
    if (!estado.abierta) return;
    if (r === "listo" || r === "en-curso") {
      // Mandado, o en camino: no se ofrece mandar de nuevo.
      estado.fin = true;
      boton.textContent = t("acctClose");
      decir(r === "listo" ? textoDeListo(datos) : t("saldoMandarEnCurso"));
      if (r === "listo") linea.classList.add("ok");
      return;
    }
    decir(t(r === "no-aprobado" ? "saldoActivarNoAprobado" : "saldoMandarNoSalio"), true);
  }

  pintar();
  // El costo del retiro de esta cuenta: hasta saberlo no se manda nada. Sin la función no hay costo. Si no se puede saber,
  // no se manda y se dice, porque mandar sin costo lo que tiene que llevarlo sería otro envío distinto del pedido.
  if (deps.costo !== undefined) {
    void deps.costo(o.address).then(
      (costo) => {
        if (!estado.abierta) return;
        estado.costo = costo;
        estado.costoMirado = true;
        if (costo === null && estado.destino === null) return;
        // Si el costo rige, lo elegido antes de saberlo vuelve a Todo: un monto que servía sin costo puede no servir con
        // costo. Una nota que no puede ir con costo se dice.
        if (costoVigente() !== null) estado.monto = o.saldo;
        if (notaBloqueada()) decir(t("saldoMandarNotaMala"), true);
        pintar(true);
      },
      () => {
        estado.costoFallo = true;
        pintar();
      },
    );
  }
}
