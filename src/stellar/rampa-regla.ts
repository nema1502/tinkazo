/**
 * La regla que aprueba los pasos de una carga que mueven dinero.
 *
 * Después de pagar, el dinero de la persona pasa por su cuenta de paso en Polygon: un permiso y un canje (si Stereum
 * entregó USDT0), y un permiso y un envío por el puente de Circle hasta su cuenta de Stellar. Cada paso es un pedido de
 * aprobación de Pollar que la persona aprueba con un toque. Antes de votar que sí, esta regla lee la transacción del
 * pedido por su cuenta (no se apoya solo en el kit, que también acepta una transferencia o un envío directo de POL) y
 * exige que sea exactamente el paso que la orden espera, contra contratos de una lista cerrada, con montos acotados y
 * hacia la cuenta de la persona.
 *
 * Lo que no reconoce no lo aprueba: el dinero queda retenido en la cuenta de paso, a salvo, y la regla se corrige con
 * el pedido real en la mano. La lista frena desde el primer día y se afloja con evidencia, nunca al revés.
 *
 * Todo es puro: no llama a nadie ni guarda nada. Los motivos son palabras fijas, y ni ellos ni los testigos llevan las
 * cuentas de la persona.
 */

import { leerOrden, queSeAprueba, type QueSeAprueba, type TramoDeOrden } from "./rampa-pollar";

/* ================================================================== la lista cerrada */

/**
 * Los únicos contratos contra los que se aprueba algo, cada uno confirmado en la fuente oficial y en la cadena el 11 de
 * noviembre de 2026. Una variante que Pollar podría usar (el USDC puenteado viejo, el mensajero de Circle con comisión
 * por adelantado, el enrutador universal de Uniswap con Permit2, las versiones anteriores) no está, y se rechaza.
 */
export const LISTA_CERRADA = Object.freeze({
  /** USDC nativo de Circle en Polygon: https://developers.circle.com/stablecoins/usdc-contract-addresses */
  usdcPolygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  /** USDT en Polygon, que hoy se llama USDT0: https://docs.usdt0.to/technical-documentation/deployments */
  usdt0Polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  /** SwapRouter02 de Uniswap en Polygon: https://developers.uniswap.org/llms.mdx/docs/protocols/v3/deployments/v3-polygon-deployments */
  enrutadorUniswap: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  /** TokenMessengerV2 de Circle en Polygon: https://developers.circle.com/cctp/evm-smart-contracts */
  mensajeroCircle: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  /** El dominio de Stellar en el puente de Circle: https://developers.circle.com/cctp/concepts/supported-chains-and-domains */
  dominioStellar: 27,
  /**
   * El CctpForwarder de Circle en Stellar (CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T) como bytes32. Circle
   * pide que quien recibe y quien termina el envío sean este contrato; con otro valor el dinero queda trabado para
   * siempre: https://developers.circle.com/cctp/references/stellar-contracts
   */
  reenviadorStellar: "0x72bd20ff2f8281801bb05b7c29179026933256fabafeb13e94efd8ddbcfcf291",
  /** Quien emite el USDC de Circle en Stellar: https://www.circle.com/.well-known/stellar.toml */
  emisorUsdcStellar: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
});

const USDC = LISTA_CERRADA.usdcPolygon.toLowerCase();
const USDT0 = LISTA_CERRADA.usdt0Polygon.toLowerCase();
const ENRUTADOR = LISTA_CERRADA.enrutadorUniswap.toLowerCase();
const MENSAJERO = LISTA_CERRADA.mensajeroCircle.toLowerCase();
const REENVIADOR = LISTA_CERRADA.reenviadorStellar.toLowerCase();
const POLYGON_PRINCIPAL = 137n;

const NOMBRES: Readonly<Record<string, string>> = {
  [USDC]: "USDC de Polygon",
  [USDT0]: "USDT0 de Polygon",
  [ENRUTADOR]: "enrutador de Uniswap",
  [MENSAJERO]: "mensajero de Circle",
  [REENVIADOR]: "reenviador de Circle en Stellar",
};

/** El nombre de un contrato de la lista cerrada, o `null` si no está en ella. Sirve para anotar sin anotar a nadie. */
export function nombreEnLaLista(direccion: unknown): string | null {
  return typeof direccion === "string" ? (NOMBRES[direccion.toLowerCase()] ?? null) : null;
}

/** Las llamadas que se aprueban, una por paso. Una transferencia (`0xa9059cbb`) o un envío directo de POL, nunca. */
const LLAMADA = {
  /** approve(address,uint256) */
  permiso: "0x095ea7b3",
  /** exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) de SwapRouter02 */
  canje: "0x04e45aaf",
  /**
   * depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes). Sin el gancho
   * (`depositForBurn`, `0x8e0250ee`) el reenviador de Stellar no sabe a qué cuenta mandar y el envío queda trabado.
   */
  envio: "0x779b432d",
} as const;

/* ================================================================== leer una transacción de Polygon */

interface TransaccionDePolygon {
  cadena: bigint;
  /** El contrato al que llama, en minúsculas. */
  a: string;
  valor: bigint;
  /** Los datos de la llamada, en minúsculas y con `0x`. */
  datos: string;
}

type Rlp = Uint8Array | Rlp[];

function bytesDeHex(x: string): Uint8Array | null {
  const h = x.replace(/^0x/i, "");
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) return null;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return b;
}
const hexDe = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const enteroDe = (b: Uint8Array) => (b.length === 0 ? 0n : BigInt(`0x${hexDe(b)}`));

function largoDe(b: Uint8Array, i: number, cuantos: number, fin: number): number | null {
  if (cuantos > 4 || i + cuantos > fin) return null;
  let n = 0;
  for (let k = 0; k < cuantos; k++) n = n * 256 + (b[i + k] as number);
  return n;
}

/** Un elemento RLP desde `i`, sin pasar de `fin`. */
function leerRlp(b: Uint8Array, i: number, fin: number): { item: Rlp; sigue: number } | null {
  if (i >= fin) return null;
  const x = b[i] as number;
  if (x < 0x80) return { item: b.subarray(i, i + 1), sigue: i + 1 };
  if (x <= 0xbf) {
    const corto = x <= 0xb7;
    const cuantos = corto ? 0 : x - 0xb7;
    const n = corto ? x - 0x80 : largoDe(b, i + 1, cuantos, fin);
    const desde = i + 1 + cuantos;
    if (n === null || desde + n > fin) return null;
    return { item: b.subarray(desde, desde + n), sigue: desde + n };
  }
  const corto = x <= 0xf7;
  const cuantos = corto ? 0 : x - 0xf7;
  const n = corto ? x - 0xc0 : largoDe(b, i + 1, cuantos, fin);
  const desde = i + 1 + cuantos;
  if (n === null || desde + n > fin) return null;
  const items: Rlp[] = [];
  let j = desde;
  while (j < desde + n) {
    const r = leerRlp(b, j, desde + n);
    if (!r) return null;
    items.push(r.item);
    j = r.sigue;
  }
  return { item: items, sigue: desde + n };
}

/**
 * Una transacción EIP-1559 sin firmar (tipo 2, nueve campos), o `null`. Sin lista de acceso, con destino y sin bytes
 * de más: es la forma de lo que firma una cuenta de paso.
 */
function leerTransaccion(x: unknown): TransaccionDePolygon | null {
  if (typeof x !== "string") return null;
  const b = bytesDeHex(x);
  if (!b || b.length < 2 || b[0] !== 2) return null;
  const r = leerRlp(b, 1, b.length);
  if (!r || r.sigue !== b.length || !Array.isArray(r.item) || r.item.length !== 9) return null;
  const campos = r.item;
  if (!campos.slice(0, 8).every((c) => c instanceof Uint8Array)) return null;
  const [cadena, , , , , a, valor, datos, acceso] = campos as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Rlp];
  if (a.length !== 20 || !Array.isArray(acceso) || acceso.length !== 0) return null;
  return { cadena: enteroDe(cadena), a: `0x${hexDe(a)}`, valor: enteroDe(valor), datos: `0x${hexDe(datos)}` };
}

/** Las palabras de 32 bytes que siguen al selector, o `null` si no son palabras enteras. */
function palabras(datos: string): string[] | null {
  const resto = datos.slice(10);
  if (resto.length % 64 !== 0) return null;
  return resto.match(/.{64}/g) ?? [];
}
const comoDireccion = (p: string): string | null => (p.startsWith("0".repeat(24)) ? `0x${p.slice(24)}` : null);
const comoEntero = (p: string): bigint => BigInt(`0x${p}`);
const cabe = (n: bigint, bits: number) => n < 1n << BigInt(bits);
const direccionEvm = (x: unknown): string | null => (typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x) ? x.toLowerCase() : null);

/** Un monto decimal del servidor (`"24.85"`) en unidades de 6 decimales, sin redondear para arriba. `null` si no lo es. */
function unidades6(x: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(x);
  if (!m) return null;
  return BigInt(m[1] as string) * 1_000_000n + BigInt((m[2] ?? "").slice(0, 6).padEnd(6, "0"));
}
const dolares = (unidades: bigint) => Number(unidades) / 1e6;

/* ================================================================== la regla */

export type MotivoContraElPaso =
  | "orden"
  | "pedido"
  | "cuenta"
  | "otro pedido"
  | "no pendiente"
  | "no es de Polygon"
  | "otra organización"
  | "tramo"
  | "cuenta que firma"
  | "transacción"
  | "otra llamada"
  | "fuera de la lista"
  | "monto"
  | "permiso de más"
  | "canje a otra cuenta"
  | "canje sin piso"
  | "envío a otro destino"
  | "comisión de más";

/** Algo que se anota para el registro y no frena: palabras fijas o números, nunca una cuenta de la persona. */
export interface Testigo {
  que: string;
  valor: string;
}

export type PasoRevisado =
  | { motivo: null; que: QueSeAprueba; /** Los dólares digitales que mueve o deja usar el paso. */ dolares: number; testigos: Testigo[] }
  | { motivo: MotivoContraElPaso; testigos: Testigo[] };

type Objeto = Record<string, unknown>;
const esObjeto = (x: unknown): x is Objeto => typeof x === "object" && x !== null && !Array.isArray(x);
const sinVoto = (p: Objeto) => p.activityId === null || p.activityId === undefined || p.activityId === "";
const CUENTA_G = /^G[A-Z2-7]{55}$/;

/**
 * Lo más que puede mover un paso: lo que planea el tramo, en unidades de 6 decimales, y nunca más dólares que los
 * bolivianos que se pagaron (un dólar digital nunca cuesta menos de un boliviano). Así el tope vale aunque el tramo
 * viniera en otra unidad.
 */
function topeDelTramo(stereum: TramoDeOrden, t: TramoDeOrden): bigint | null {
  const delTramo = unidades6(t.entraPlaneado);
  const bolivianos = unidades6(stereum.entraPlaneado);
  if (delTramo === null || bolivianos === null) return null;
  return delTramo < bolivianos ? delTramo : bolivianos;
}

/** El gancho que lee el reenviador de Circle: 24 bytes en cero, la versión 0, el largo y la cuenta G como texto. */
function ganchoEsLaCuenta(hex: string, cuenta: string): boolean {
  if (hex.length !== 2 * (32 + cuenta.length)) return false;
  if (hex.slice(0, 48) !== "0".repeat(48) || hex.slice(48, 56) !== "00000000") return false;
  if (Number.parseInt(hex.slice(56, 64), 16) !== cuenta.length) return false;
  const texto = (hex.slice(64).match(/.{2}/g) ?? []).map((h) => String.fromCharCode(Number.parseInt(h, 16))).join("");
  return texto === cuenta;
}

/**
 * Revisa un pedido de aprobación contra la orden que lo pide, la cuenta de Stellar de la persona y la organización de
 * esta sesión. Devuelve qué se aprueba si pasa, o el motivo si no. Se le pasa la versión del pedido que se va a votar
 * (la renovada, si se renovó), y después `verify` del kit tiene que dar bien y su propuesta pasar `motivoContraLaPropuesta`.
 *
 * Exige, en orden: la orden espera una aprobación y se lee como una carga; el pedido es el que espera, pendiente, una
 * transacción de Polygon de esta organización, sobre un canje o un envío y no sobre el tramo de Stereum; la transacción
 * es de la red principal, no manda POL, es la que dice el pedido y hace la llamada del paso; los contratos salen de la
 * lista cerrada; el permiso no pasa lo que lleva el tramo; el canje le llega a la cuenta de paso que firma con un piso
 * del 99 %; el envío va al dominio de Stellar y al reenviador de Circle, con la cuenta de la persona en el gancho y una
 * comisión de hasta el 1 %.
 */
export function revisarPaso(pedido: unknown, orden: unknown, cuenta: string, subOrg: string): PasoRevisado {
  const testigos: Testigo[] = [];
  const no = (motivo: MotivoContraElPaso): PasoRevisado => ({ motivo, testigos });

  const o = leerOrden(orden);
  if (!o || o.accion?.kind !== "COSIGN_APPROVAL" || ["completed", "failed", "refunded"].includes(o.estado)) return no("orden");
  if (!esObjeto(pedido)) return no("pedido");
  if (!CUENTA_G.test(cuenta)) return no("cuenta");
  const esperado = o.accion.cosignRequestId;
  if (typeof esperado !== "string" || esperado === "" || pedido.id !== esperado) return no("otro pedido");
  if (pedido.status !== "PENDING" || !sinVoto(pedido)) return no("no pendiente");
  if (pedido.kind !== "TX" || pedido.network !== "POLYGON") return no("no es de Polygon");
  if (!subOrg || pedido.subOrgId !== subOrg) return no("otra organización");
  testigos.push({ que: "intención", valor: typeof pedido.intent === "string" ? pedido.intent : "sin dato" });

  const t = o.tramos.find((x) => x.indice === o.accion?.legIndex);
  const que = t && (t.tipo === "SWAP" || t.tipo === "BRIDGE") ? queSeAprueba(t) : null;
  if (!t || !que) return no("tramo");
  const firmante = direccionEvm(pedido.signWith);
  if (!firmante) return no("cuenta que firma");
  testigos.push({ que: "cuenta que firma y fondos", valor: !t.fondos ? "sin dato" : t.fondos.direccion.toLowerCase() === firmante ? "coinciden" : "no coinciden" });

  const tx = leerTransaccion(pedido.unsignedPayload);
  if (!tx || tx.cadena !== POLYGON_PRINCIPAL || tx.valor !== 0n) return no("transacción");
  // Lo que el pedido dice que hace tiene que ser lo que hace (el kit lo exige también).
  const d = pedido.details;
  if (!esObjeto(d) || typeof d.to !== "string" || typeof d.data !== "string" || typeof d.value !== "string" || !/^\d+$/.test(d.value)) return no("transacción");
  if (d.to.toLowerCase() !== tx.a || d.data.toLowerCase() !== tx.datos || BigInt(d.value) !== tx.valor) return no("transacción");

  const llamada = tx.datos.slice(0, 10);
  const esperada = que === "cambio" ? LLAMADA.canje : que === "envio" ? LLAMADA.envio : LLAMADA.permiso;
  if (llamada !== esperada) return no("otra llamada");
  const args = palabras(tx.datos);
  if (!args) return no("transacción");
  const tope = topeDelTramo(o.tramos[0] as TramoDeOrden, t);
  if (tope === null) return no("monto");

  if (que === "permiso-cambio" || que === "permiso-envio") {
    // approve(quien, monto), sobre USDT0 para el enrutador en el canje, sobre USDC para el mensajero en el envío.
    if (args.length !== 2) return no("transacción");
    const quien = comoDireccion(args[0] as string);
    const monto = comoEntero(args[1] as string);
    if (!quien) return no("transacción");
    const [moneda, para] = que === "permiso-cambio" ? [USDT0, ENRUTADOR] : [USDC, MENSAJERO];
    if (tx.a !== moneda || quien !== para) return no("fuera de la lista");
    if (monto <= 0n) return no("monto");
    if (monto > tope) return no("permiso de más");
    return { motivo: null, que, dolares: dolares(monto), testigos };
  }

  if (que === "cambio") {
    // exactInputSingle((tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96))
    if (args.length !== 7) return no("transacción");
    const entra = comoDireccion(args[0] as string);
    const sale = comoDireccion(args[1] as string);
    const comision = comoEntero(args[2] as string);
    const receptor = comoDireccion(args[3] as string);
    const monto = comoEntero(args[4] as string);
    const piso = comoEntero(args[5] as string);
    const limite = comoEntero(args[6] as string);
    if (!entra || !sale || !receptor || !cabe(comision, 24) || !cabe(limite, 160)) return no("transacción");
    if (tx.a !== ENRUTADOR || entra !== USDT0 || sale !== USDC) return no("fuera de la lista");
    if (receptor !== firmante) return no("canje a otra cuenta");
    if (monto <= 0n || monto > tope) return no("monto");
    // Dólar contra dólar, los dos con 6 decimales: lo que sale no baja del 99 % de lo que entra.
    if (piso * 100n < monto * 99n) return no("canje sin piso");
    testigos.push({ que: "comisión del canje", valor: String(comision) }, { que: "límite de precio", valor: limite === 0n ? "ninguno" : "con límite" });
    return { motivo: null, que, dolares: dolares(monto), testigos };
  }

  // depositForBurnWithHook(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee,
  // minFinalityThreshold, hookData): ocho palabras de cabeza y el gancho detrás.
  if (args.length < 9) return no("transacción");
  const monto = comoEntero(args[0] as string);
  const dominio = comoEntero(args[1] as string);
  const recibe = `0x${args[2] as string}`;
  const quema = comoDireccion(args[3] as string);
  const termina = `0x${args[4] as string}`;
  const comision = comoEntero(args[5] as string);
  const rapidez = comoEntero(args[6] as string);
  const donde = comoEntero(args[7] as string);
  const largo = comoEntero(args[8] as string);
  if (!quema || !cabe(dominio, 32) || !cabe(rapidez, 32) || donde !== 256n || largo > 100_000n) return no("transacción");
  const palabrasDelGancho = Math.ceil(Number(largo) / 32);
  if (args.length !== 9 + palabrasDelGancho) return no("transacción");
  const relleno = args.slice(9).join("");
  if (!/^0*$/.test(relleno.slice(Number(largo) * 2))) return no("transacción");
  if (tx.a !== MENSAJERO || quema !== USDC) return no("fuera de la lista");
  if (dominio !== BigInt(LISTA_CERRADA.dominioStellar) || recibe !== REENVIADOR || termina !== REENVIADOR) return no("envío a otro destino");
  if (!ganchoEsLaCuenta(relleno.slice(0, Number(largo) * 2), cuenta)) return no("envío a otro destino");
  if (monto <= 0n || monto > tope) return no("monto");
  if (comision * 100n > monto) return no("comisión de más");
  testigos.push({ que: "rapidez del puente", valor: String(rapidez) }, { que: "comisión del puente", valor: `${Number((comision * 10_000n) / monto) / 100} %` });
  return { motivo: null, que, dolares: dolares(monto), testigos };
}

/** El motivo para no aprobar el paso, o `null` si pasa. Ver `revisarPaso`. */
export function motivoContraElPaso(pedido: unknown, orden: unknown, cuenta: string, subOrg: string): MotivoContraElPaso | null {
  return revisarPaso(pedido, orden, cuenta, subOrg).motivo;
}

/* ================================================================== lo que se estampa */

const claves = (o: Objeto) => Object.keys(o).sort().join(",");

/** La propuesta que arma `verify` del kit, si dio bien. */
function propuestaDe(verificacion: unknown): { path: unknown; body: Objeto; parametros: Objeto } | null {
  if (!esObjeto(verificacion) || verificacion.ok !== true || !esObjeto(verificacion.proposal)) return null;
  const body = verificacion.proposal.body;
  if (!esObjeto(body) || !esObjeto(body.parameters) || claves(body) !== "organizationId,parameters,timestampMs,type") return null;
  if (typeof body.timestampMs !== "string" || !/^\d+$/.test(body.timestampMs)) return null;
  return { path: verificacion.proposal.path, body, parametros: body.parameters };
}

/**
 * Lo que se va a estampar con la llave de este navegador es firmar exactamente la transacción revisada, con la cuenta de
 * paso del pedido y en esta organización, y nada más. El motivo si no, `null` si sí.
 */
export function motivoContraLaPropuesta(verificacion: unknown, pedido: unknown, subOrg: string): string | null {
  const prop = propuestaDe(verificacion);
  if (!prop || prop.path !== "/public/v1/submit/sign_transaction" || prop.body.type !== "ACTIVITY_TYPE_SIGN_TRANSACTION_V2") return "otra propuesta";
  const p = esObjeto(pedido) ? pedido : {};
  if (!subOrg || prop.body.organizationId !== subOrg || p.subOrgId !== subOrg) return "otra organización";
  const par = prop.parametros;
  if (claves(par) !== "signWith,type,unsignedTransaction" || par.type !== "TRANSACTION_TYPE_ETHEREUM") return "otra propuesta";
  if (typeof p.signWith !== "string" || par.signWith !== p.signWith) return "otra cuenta";
  const revisada = typeof p.unsignedPayload === "string" ? p.unsignedPayload.replace(/^0x/i, "").toLowerCase() : null;
  if (!revisada || par.unsignedTransaction !== revisada) return "otra transacción";
  const v = verificacion as Objeto;
  if (v.localHash !== undefined && v.localHash !== revisada) return "otra transacción";
  return null;
}

/* ================================================================== la cuenta de paso */

const CAMPOS_DE_CUENTA = ["curve", "pathFormat", "path", "addressFormat"] as const;

/** Las cuentas que pide derivar el pedido, con los cuatro campos que usa el kit, o `null` si no se lee. */
function derivacionDe(x: unknown): { walletId: string; accounts: Record<(typeof CAMPOS_DE_CUENTA)[number], string>[] } | null {
  if (typeof x !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(x);
  } catch {
    return null;
  }
  if (!esObjeto(v) || typeof v.walletId !== "string" || v.walletId === "" || !Array.isArray(v.accounts) || v.accounts.length === 0) return null;
  const accounts: Record<(typeof CAMPOS_DE_CUENTA)[number], string>[] = [];
  for (const a of v.accounts) {
    if (!esObjeto(a) || !CAMPOS_DE_CUENTA.every((k) => typeof a[k] === "string")) return null;
    accounts.push(Object.fromEntries(CAMPOS_DE_CUENTA.map((k) => [k, a[k] as string])) as Record<(typeof CAMPOS_DE_CUENTA)[number], string>);
  }
  return { walletId: v.walletId, accounts };
}

/** Dos valores iguales en contenido, sin importar el orden de las claves. */
function iguales(a: unknown, b: unknown): boolean {
  const normal = (x: unknown): unknown => (Array.isArray(x) ? x.map(normal) : esObjeto(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, normal(x[k])])) : x);
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}

/**
 * Crear la cuenta de paso no mueve dinero. Se aprueba solo un pedido de cuenta pendiente de esta organización, cuya
 * propuesta es crear exactamente las cuentas que pide, en esta organización. Se anotan la intención, la red y el
 * formato de las cuentas, que todavía no se vieron en una carga real.
 */
export function revisarCuentaDePaso(pedido: unknown, verificacion: unknown, subOrg: string): { motivo: string | null; testigos: Testigo[] } {
  const testigos: Testigo[] = [];
  const no = (motivo: string) => ({ motivo, testigos });
  if (!esObjeto(pedido)) return no("pedido");
  if (pedido.kind !== "ACCOUNT") return no("tipo");
  testigos.push({ que: "intención", valor: typeof pedido.intent === "string" ? pedido.intent : "sin dato" }, { que: "red", valor: typeof pedido.network === "string" ? pedido.network : "sin dato" });
  if (pedido.status !== "PENDING" || !sinVoto(pedido)) return no("no pendiente");
  if (!subOrg || pedido.subOrgId !== subOrg) return no("otra organización");
  const derivacion = derivacionDe(pedido.unsignedPayload);
  if (!derivacion) return no("derivación");
  testigos.push({ que: "formato", valor: [...new Set(derivacion.accounts.map((a) => a.addressFormat))].join(",") });
  const prop = propuestaDe(verificacion);
  if (!prop || prop.path !== "/public/v1/submit/create_wallet_accounts" || prop.body.type !== "ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS") return no("otra propuesta");
  if (prop.body.organizationId !== subOrg) return no("otra organización");
  if (!iguales(prop.parametros, derivacion)) return no("otras cuentas");
  return { motivo: null, testigos };
}

/** El motivo para no aprobar la cuenta de paso, o `null` si pasa. Ver `revisarCuentaDePaso`. */
export function motivoContraLaCuentaDePaso(pedido: unknown, verificacion: unknown, subOrg: string): string | null {
  return revisarCuentaDePaso(pedido, verificacion, subOrg).motivo;
}
