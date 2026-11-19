/**
 * La regla de la co-firma: cómo se compara lo que Pollar pide votar con lo que armó la página.
 *
 * Con una cuenta de Google o de correo en la red principal, quien vota la co-firma es el kit de Pollar, y su propia
 * revisión mira solo que el hash de la transacción del pedido sea el que el pedido dice. Nadie compara esa transacción
 * con la que armó Tinkazo. Esta pieza es la base de esa comparación: dice, campo por campo, si la transacción de un
 * pedido es la que se armó, y arma las líneas del testigo que lo cuentan en la consola.
 *
 * Todo es puro: no llama a nadie ni guarda nada, y no lanza (lo que no se puede leer se dice con `no-se-lee`). El SDK de
 * Stellar se baja recién al comparar. Las líneas del testigo y la lista de campos son palabras fijas y los tipos de las
 * operaciones: nunca una dirección ni un hash.
 *
 * Con el voto por contenido (issue 180) el navegador vota a mano y esta pieza le da la regla: qué se permite firmar
 * (`motivoContraLoPermitido`), si el pedido es el de la llamada y tiene la forma esperada (`motivoContraElPedido`,
 * `esDeEstaLlamada`), si su transacción es la armada (`compararConLaArmada`) y cómo terminó lo que se votó
 * (`desenlaceDelVoto`). Cada campo se compara en XDR, byte a byte, y ante cualquier duda la respuesta es que no es la
 * misma. Quien vota y estampa es `wallet-pollar.ts`: acá no se llama a nadie, salvo lo que se le pasa al desenlace.
 *
 * La línea del dólar digital la arma el proveedor y no hay una transacción de la página con qué compararla: tiene su regla
 * por forma (`leerLaLinea` y `motivoContraLaLinea`), con la forma que se midió en la red principal y nada más.
 */

import type { Transaction as TransaccionDelSdk, xdr } from "@stellar/stellar-sdk";
import type { PedidoDeCofirma } from "./wallet-pollar";

/**
 * Qué campo de la transacción difiere, con palabras fijas. `sobre`: el sobre no es del tipo de siempre. `envuelta`: otra
 * cuenta la envolvió para pagar la comisión. `hash`: el hash que dice el pedido no es el de la armada. `contrato`: los
 * recursos o la huella de lectura y escritura de una invocación. `no-se-lee`: algo no se pudo leer.
 */
export type CampoDistinto =
  | "sobre"
  | "envuelta"
  | "hash"
  | "cuenta"
  | "secuencia"
  | "comision"
  | "condiciones"
  | "nota"
  | "cantidad"
  | "operacion"
  | "contrato"
  | "no-se-lee";

/**
 * Cómo salió la comparación. Si es la misma: el hash de la armada (hexadecimal en minúscula) y cuántas firmas trae el
 * sobre del pedido. Si no: todos los campos que difieren, en un orden fijo (sobre o envuelta, hash, cuenta, secuencia,
 * comisión, condiciones, nota, cantidad u operación, contrato), los índices de las operaciones distintas y los tipos de
 * las operaciones del pedido.
 */
export type Comparacion =
  | { igual: true; hash: string; firmasEnElSobre: number }
  | { igual: false; campos: readonly CampoDistinto[]; operaciones: readonly number[]; tipos: readonly string[] };

type Sdk = typeof import("@stellar/stellar-sdk");

/** Lo que se lee de un sobre: su tipo, la transacción de adentro, cuántas firmas trae y los hashes. */
interface SobreLeido {
  /** 0 (el sobre viejo), 2 (el de siempre) o 5 (envuelto por otra cuenta que paga la comisión). */
  tipo: 0 | 2 | 5;
  /** La transacción de adentro: la misma si el sobre no viene envuelto. */
  interior: TransaccionDelSdk;
  /** Las firmas del sobre de afuera. */
  firmas: number;
  /** El hash del sobre de afuera, en hexadecimal minúscula, con la red que se pidió. */
  hash: string;
  /** El hash de la transacción de adentro. */
  hashInterior: string;
}

/** Los bytes de un hash, en hexadecimal en minúscula (sin `Buffer`, que en el navegador no está). */
const aHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Cualquier valor del SDK que sabe decirse en XDR. */
interface ConXdr {
  toXdr(formato: "base64"): string;
}

/** Dos valores son iguales si sus bytes en XDR lo son: nunca se comparan los campos ya leídos. */
const igualEnXdr = (a: ConXdr, b: ConXdr): boolean => a.toXdr("base64") === b.toXdr("base64");

/** Lee un sobre en base64 con el SDK. `null` si no hay, si no se lee o si no es de un tipo que se conozca. Nunca lanza. */
function leerSobre(sdk: Sdk, texto: string | undefined, passphrase: string): SobreLeido | null {
  if (!texto) return null;
  try {
    const t = sdk.TransactionBuilder.fromXDR(texto, passphrase);
    const sobre = t.toEnvelope();
    if (t instanceof sdk.FeeBumpTransaction) {
      if (sobre.type !== "envelopeTypeTxFeeBump") return null;
      const interior = t.innerTransaction;
      return { tipo: 5, interior, firmas: sobre.feeBump.signatures.length, hash: aHex(t.hash()), hashInterior: aHex(interior.hash()) };
    }
    const hash = aHex(t.hash());
    if (sobre.type === "envelopeTypeTx") return { tipo: 2, interior: t, firmas: sobre.v1.signatures.length, hash, hashInterior: hash };
    if (sobre.type === "envelopeTypeTxV0") return { tipo: 0, interior: t, firmas: sobre.v0.signatures.length, hash, hashInterior: hash };
    return null;
  } catch {
    return null;
  }
}

/** El cuerpo de la transacción de adentro, en XDR. `null` si el sobre no es de tipo 2 por dentro. */
function cuerpoDe(s: SobreLeido): xdr.Transaction | null {
  const sobre = s.interior.toEnvelope();
  return sobre.type === "envelopeTypeTx" ? sobre.v1.tx : null;
}

/**
 * Los campos que difieren entre dos cuerpos, cada uno en XDR, y los índices de las operaciones distintas. Con otra
 * cantidad de operaciones se dice solo `cantidad`: cuáles difieren ya no tiene sentido.
 */
function camposDistintos(armada: xdr.Transaction, pedido: xdr.Transaction): { campos: CampoDistinto[]; operaciones: number[] } {
  const campos: CampoDistinto[] = [];
  const operaciones: number[] = [];
  if (!igualEnXdr(armada.sourceAccount, pedido.sourceAccount)) campos.push("cuenta");
  if (armada.seqNum !== pedido.seqNum) campos.push("secuencia");
  if (armada.fee !== pedido.fee) campos.push("comision");
  if (!igualEnXdr(armada.cond, pedido.cond)) campos.push("condiciones");
  if (!igualEnXdr(armada.memo, pedido.memo)) campos.push("nota");
  if (armada.operations.length !== pedido.operations.length) {
    campos.push("cantidad");
  } else {
    armada.operations.forEach((op, i) => {
      const otra = pedido.operations[i];
      if (!otra || !igualEnXdr(op, otra)) operaciones.push(i);
    });
    if (operaciones.length > 0) campos.push("operacion");
  }
  if (!igualEnXdr(armada.ext, pedido.ext)) campos.push("contrato");
  return { campos, operaciones };
}

const NO_SE_LEE: Comparacion = { igual: false, campos: ["no-se-lee"], operaciones: [], tipos: [] };

/** Lo que dio la comparación y los dos sobres leídos, para que las líneas del testigo no los lean otra vez. */
interface Analisis {
  comparacion: Comparacion;
  armada: SobreLeido | null;
  pedido: SobreLeido | null;
}

function analizar(sdk: Sdk, armadaXdr: string, pedidoXdr: string | undefined, passphrase: string, payloadHash: string | undefined): Analisis {
  const armada = leerSobre(sdk, armadaXdr, passphrase);
  const pedido = leerSobre(sdk, pedidoXdr, passphrase);
  if (!armada || !pedido) return { comparacion: NO_SE_LEE, armada, pedido };
  const tipos = pedido.interior.operations.map((o) => o.type);
  const campos: CampoDistinto[] = [];
  let operaciones: number[] = [];
  // La armada nuestra tiene que ser de tipo 2, y un pedido de tipo 0 no tiene el mismo cuerpo que se pueda comparar.
  const sobreRaro = armada.tipo !== 2 || pedido.tipo === 0;
  if (sobreRaro) campos.push("sobre");
  else if (pedido.tipo === 5) campos.push("envuelta");
  if (payloadHash !== undefined && payloadHash.toLowerCase() !== armada.hash) campos.push("hash");
  if (!sobreRaro) {
    const a = cuerpoDe(armada);
    const v = cuerpoDe(pedido);
    if (!a || !v) return { comparacion: NO_SE_LEE, armada, pedido };
    const distintos = camposDistintos(a, v);
    campos.push(...distintos.campos);
    operaciones = distintos.operaciones;
    // Lo que decide es el cuerpo entero, byte a byte: los campos solo dicen qué difiere. Un cuerpo distinto que ningún
    // campo explica (un campo que esta lista no conoce) no es la misma transacción.
    if (distintos.campos.length === 0 && !igualEnXdr(a, v)) campos.push("no-se-lee");
  }
  if (campos.length === 0) return { comparacion: { igual: true, hash: armada.hash, firmasEnElSobre: pedido.firmas }, armada, pedido };
  return { comparacion: { igual: false, campos, operaciones, tipos }, armada, pedido };
}

/**
 * Compara la transacción del pedido con la que armó la página, campo por campo y en XDR: la cuenta de origen (una
 * dirección M de la misma cuenta es otra), la secuencia, la comisión, las condiciones, la nota, cada operación (cantidad,
 * orden y contenido) y los datos del contrato. Las firmas del sobre no deciden: no son parte de lo que se firma, solo se
 * cuentan. Un sobre envuelto en otra cuenta que paga la comisión dice `envuelta` y además compara la transacción de
 * adentro, para que se vea si adentro era la misma.
 *
 * `payloadHash` es el hash que dice el pedido: si viene y no es el de la armada con la frase de la red de la página,
 * suma `hash`. Sin pedido, o si algo no se lee, dice `no-se-lee`. Nunca lanza.
 */
export async function compararConLaArmada(
  armadaXdr: string,
  pedidoXdr: string | undefined,
  passphrase: string,
  payloadHash?: string,
): Promise<Comparacion> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    return analizar(sdk, armadaXdr, pedidoXdr, passphrase, payloadHash).comparacion;
  } catch {
    return NO_SE_LEE;
  }
}

/**
 * Los campos que difieren, para la consola: `ninguno` si es la misma, o la lista en su orden fijo separada por comas y,
 * donde son operaciones, con sus índices. Por ejemplo `secuencia, comision` u `operacion 0,2`.
 */
export function listarLosCampos(c: Comparacion): string {
  if (c.igual) return "ninguno";
  return c.campos.map((campo) => (campo === "operacion" ? `operacion ${c.operaciones.join(",")}` : campo)).join(", ");
}

/**
 * En una palabra qué tan distinta es: `misma transacción`, `mismas operaciones` (cambió algo del cuerpo o del sobre, pero
 * la cuenta y las operaciones son las mismas), `distinta` con los tipos de las operaciones del pedido, o `no se lee`.
 */
function resumenDe(c: Comparacion): string {
  if (c.igual) return "misma transacción";
  if (c.campos.includes("no-se-lee")) return "no se lee";
  const mismasOperaciones = !c.campos.some((campo) => campo === "sobre" || campo === "cuenta" || campo === "cantidad" || campo === "operacion");
  return mismasOperaciones ? "mismas operaciones" : `distinta (${c.tipos.join(",")})`;
}

/** La intención con que se pidió la firma: `sign` (solo firmar), `sign_and_send` (firmar y mandar) u otra. */
const intencionDe = (p: PedidoDeCofirma): string => (p.intent === "sign" || p.intent === "sign_and_send" ? p.intent : "otra");

/** Si el pedido se puede volver a pedir justo antes del voto (`refreshable`). */
const releibleDe = (p: PedidoDeCofirma): string => (p.refreshable === true ? "sí" : "no");

/** Cómo vino lo firmado: ninguna, simple (el sobre de siempre), envuelta o ilegible. */
function firmadaDe(sdk: Sdk, p: PedidoDeCofirma, passphrase: string): string {
  if (!p.signedXdr) return "ninguna";
  const s = leerSobre(sdk, p.signedXdr, passphrase);
  if (!s) return "ilegible";
  return s.tipo === 5 ? "envuelta" : "simple";
}

/**
 * Cómo se ata el hash con que Pollar dice haber mandado la transacción al de la que se tomó de referencia: ninguno (no
 * dice hash), `mismo-hash`, `otro-hash-atado` (lo firmado vino envuelto, con la de referencia adentro y ese hash por
 * fuera) u `otro-hash`. Sin referencia que comparar, `sin-comparar`.
 */
function envioDe(sdk: Sdk, p: PedidoDeCofirma, referencia: string | null, passphrase: string): string {
  const dicho = p.submit?.hash;
  if (!dicho) return "ninguno";
  if (referencia === null) return "sin-comparar";
  const hash = dicho.toLowerCase();
  if (hash === referencia) return "mismo-hash";
  const firmada = leerSobre(sdk, p.signedXdr, passphrase);
  return firmada?.tipo === 5 && firmada.hash === hash && firmada.hashInterior === referencia ? "otro-hash-atado" : "otro-hash";
}

/**
 * La línea del testigo de una firma del sello, del sorteo o de Mandar: qué tan distinto es lo que Pollar pidió votar de
 * lo que armó la página, con todos los campos que difieren, la intención, si el pedido se puede volver a pedir, cómo vino
 * lo firmado y cómo se ata el hash del envío. Sin direcciones ni hashes. Nunca lanza.
 *
 * `[tinkazo] testigo: <resumen> | distinto <campos o ninguno> | intención <...> | releíble <sí o no> | firmada <...> | envío <...>`
 */
export async function describirPedido(armadaXdr: string, p: PedidoDeCofirma, passphrase: string): Promise<string> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    const a = analizar(sdk, armadaXdr, p.unsignedPayload, passphrase, p.payloadHash);
    const partes = [
      resumenDe(a.comparacion),
      `distinto ${listarLosCampos(a.comparacion)}`,
      `intención ${intencionDe(p)}`,
      `releíble ${releibleDe(p)}`,
      `firmada ${firmadaDe(sdk, p, passphrase)}`,
      `envío ${envioDe(sdk, p, a.armada?.hash ?? null, passphrase)}`,
    ];
    return `[tinkazo] testigo: ${partes.join(" | ")}`;
  } catch {
    return "[tinkazo] testigo: no se lee";
  }
}

/** De quién es el origen de una operación: `propia` (la cuenta), `otra` o `ninguna` (sin origen propio, paga quien paga). */
function claseDelOrigen(origen: string | undefined, cuenta: string): string {
  if (origen === undefined) return "ninguna";
  return origen === cuenta ? "propia" : "otra";
}

/** Lo que se mira de una operación de línea de confianza (`changeTrust`). */
interface OperacionDeLinea {
  type: string;
  line?: unknown;
  limit?: unknown;
}

/** El límite máximo de una línea de confianza: el mayor que cabe en 64 bits, en la forma en que lo lee el SDK. */
const LIMITE_MAXIMO = "922337203685.4775807";

/** Si el activo de la operación es el de la red que se pidió (el código y quien lo emite), y de ningún otro modo. */
function esElActivo(linea: unknown, usdc: { code: string; issuer: string }): boolean {
  const a = linea as { code?: unknown; issuer?: unknown } | null;
  return !!a && typeof a === "object" && a.code === usdc.code && a.issuer === usdc.issuer;
}

/** El límite: `maximo`, `cero` u `otro`. Una línea con límite cero cerraría la línea de confianza. */
function limiteDe(limite: unknown): string {
  if (limite === LIMITE_MAXIMO) return "máximo";
  return typeof limite === "string" && Number(limite) === 0 ? "cero" : "otro";
}

/** Las condiciones de la transacción: solo de tiempo (o ninguna) u otras (de ledger, de secuencia o firmantes extra). */
function condicionesDe(c: xdr.Transaction): string {
  const k = c.cond;
  if (k.type !== "precondV2") return "solo-tiempo";
  const v = k.v2;
  const soloTiempo = v.ledgerBounds === null && v.minSeqNum === null && v.minSeqAge === 0n && v.minSeqLedgerGap === 0 && v.extraSigners.length === 0;
  return soloTiempo ? "solo-tiempo" : "otras";
}

/**
 * La línea del testigo del pedido de la línea del dólar digital: la arma Pollar y no hay una transacción de la página con
 * qué compararla, así que cuenta cómo es lo que votó el kit. Las operaciones con la clase de su origen (propia, otra o
 * ninguna), quién paga la transacción, si el activo es el de la red que se pidió y su límite, si lleva nota, si tiene
 * condiciones que no sean de tiempo, si vino envuelta, y lo mismo que el testigo del sello: la intención, si se puede
 * volver a pedir y cómo se ata el hash del envío (contra el de la transacción del propio pedido). Sin direcciones ni
 * hashes. Nunca lanza.
 *
 * `[tinkazo] testigo de la línea: <tipo(clase del origen)>,... | paga <propia u otra> | activo <circle u otro>`
 * `| límite <máximo, cero u otro> | nota <ninguna o alguna> | condiciones <solo-tiempo u otras>`
 * `| sobre <simple o envuelta> | intención <...> | releíble <...> | envío <...>`
 */
export async function describirLinea(
  p: PedidoDeCofirma,
  cuenta: string,
  passphrase: string,
  usdc: { code: string; issuer: string },
): Promise<string> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    const sobre = leerSobre(sdk, p.unsignedPayload, passphrase);
    const cola = [`intención ${intencionDe(p)}`, `releíble ${releibleDe(p)}`, `envío ${envioDe(sdk, p, sobre?.hash ?? null, passphrase)}`];
    const cuerpo = sobre === null || sobre.tipo === 0 ? null : cuerpoDe(sobre);
    if (sobre === null || cuerpo === null) return `[tinkazo] testigo de la línea: no se lee | ${cola.join(" | ")}`;
    const tx = sobre.interior;
    const operaciones = tx.operations.map((o) => `${o.type}(${claseDelOrigen(o.source, cuenta)})`).join(",");
    const lineas = tx.operations.filter((o) => o.type === "changeTrust") as unknown as OperacionDeLinea[];
    const activo = lineas.length === 0 ? "ninguno" : lineas.every((o) => esElActivo(o.line, usdc)) ? "circle" : "otro";
    const limites = new Set(lineas.map((o) => limiteDe(o.limit)));
    const limite = limites.size === 0 ? "ninguno" : limites.size === 1 ? [...limites].join("") : "otro";
    const partes = [
      operaciones || "ninguna",
      `paga ${tx.source === cuenta ? "propia" : "otra"}`,
      `activo ${activo}`,
      `límite ${limite}`,
      `nota ${tx.memo.type === "none" ? "ninguna" : "alguna"}`,
      `condiciones ${condicionesDe(cuerpo)}`,
      `sobre ${sobre.tipo === 5 ? "envuelta" : "simple"}`,
      ...cola,
    ];
    return `[tinkazo] testigo de la línea: ${partes.join(" | ")}`;
  } catch {
    return "[tinkazo] testigo de la línea: no se lee";
  }
}

/* ------------------------------------------------ el voto por contenido */

/** El texto de una negativa de la regla: no se votó porque no se pudo comprobar que fuera lo que armó la página. */
export const COFIRMA_DISTINTA = "tinkazo-cofirma-distinta";
/** La negativa que llegó al tope de la pestaña: desde ahí no se le pide nada más al servidor en esta pestaña. */
export const COFIRMA_TOPE = "tinkazo-cofirma-distinta-tope";
/** Cuántas negativas de la regla se admiten por pestaña: la que llega a este número ya sale con `COFIRMA_TOPE`. */
export const TOPE_DE_DISTINTAS = 2;
/** Cuántas veces se pregunta cómo terminó un envío y cada cuánto: lo mismo que espera el kit (`_awaitTxConfirmation`). */
export const CONSULTAS_DEL_ENVIO = 16;
export const ESPERA_ENTRE_CONSULTAS_MS = 2_500;

/** Lo que se le pidió al kit: solo firmar (`signTx`, y manda el portero) o firmar y mandar (`signAndSubmitTx`). */
export type IntencionDeFirma = "sign" | "sign_and_send";

/** Las funciones del contrato oficial que la página firma con el voto a mano: sellar la lista y sortear. */
const FUNCIONES_PERMITIDAS: readonly string[] = ["seal", "draw"];

/**
 * La lista de lo permitido: con el voto a mano, la página firma solo una invocación del contrato oficial (`contrato`)
 * con `seal` o `draw`, pagada por la cuenta de la sesión, en un sobre de los de siempre y con una sola operación.
 * Devuelve el motivo si el XDR no es eso, `null` si sí. Cuida de un error del propio código (que alguna vez llegue a
 * firmarse otra cosa), no de código ajeno en la página. Los pagos se suman aparte, cada uno con su propia revisión.
 * Nunca lanza: lo que no se lee no se permite.
 */
export async function motivoContraLoPermitido(
  armadaXdr: string,
  cuenta: string,
  contrato: string | null,
  passphrase: string,
): Promise<string | null> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    const s = leerSobre(sdk, armadaXdr, passphrase);
    if (!s || s.tipo !== 2) return "sobre";
    const tx = s.interior;
    if (tx.source !== cuenta) return "cuenta";
    if (!contrato) return "sin contrato";
    const op = tx.operations.length === 1 ? tx.operations[0] : undefined;
    if (!op || op.type !== "invokeHostFunction") return "operaciones";
    if (op.source !== undefined && op.source !== cuenta) return "cuenta";
    const funcion = op.func;
    if (funcion.type !== "hostFunctionTypeInvokeContract") return "función";
    if (sdk.Address.fromScAddress(funcion.invokeContract.contractAddress).toString() !== contrato) return "otro contrato";
    if (!FUNCIONES_PERMITIDAS.includes(funcion.invokeContract.functionName.toStringStrict())) return "función";
    return null;
  } catch {
    return "no se lee";
  }
}

/** La transacción que armó la página, leída: la cuenta que la paga y su hash con la frase de la red de la página. */
export interface ArmadaLeida {
  cuenta: string;
  hash: string;
}

/** Lee la armada. `null` si no es un sobre de los de siempre (tipo 2, sin envolver) o si no se lee. Nunca lanza. */
export async function leerLaArmada(armadaXdr: string, passphrase: string): Promise<ArmadaLeida | null> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    const s = leerSobre(sdk, armadaXdr, passphrase);
    if (!s || s.tipo !== 2) return null;
    return { cuenta: s.interior.source, hash: s.hash };
  } catch {
    return null;
  }
}

/** Lo que se espera del pedido: el id que devolvió la llamada, la cuenta de la sesión, la intención y la organización. */
export interface PedidoEsperado {
  id: string;
  cuenta: string;
  intencion: IntencionDeFirma;
  subOrg: string | null;
  /** El hash de la armada, en hexadecimal minúscula, con la frase de la red de la página. */
  hashDeLaArmada: string;
}

/**
 * ¿El pedido tiene la forma de lo que esta llamada pidió firmar? Devuelve el motivo si no, `null` si sí: es el pedido de
 * la llamada, pendiente, de una transacción de Stellar, con la intención pedida (y no una línea ni una cuenta nueva),
 * para firmar con la cuenta de la sesión, sin voto todavía, de esta organización, con su transacción y su hash, y ese
 * hash es el de la armada. El contenido lo decide `compararConLaArmada`: esto solo mira la forma. Palabras fijas.
 */
export function motivoContraElPedido(p: PedidoDeCofirma, e: PedidoEsperado): string | null {
  if (!e.cuenta.startsWith("G")) return "cuenta";
  if (p.id !== e.id) return "otro pedido";
  if (p.status !== "PENDING") return "estado";
  if (p.kind !== "TX" || p.network !== "STELLAR") return "tipo";
  if (p.intent !== e.intencion) return "intención";
  if (p.operation === "change_trust" || p.operation === "create_account") return "operación";
  if (p.signWith !== e.cuenta || (p.account !== undefined && p.account !== e.cuenta)) return "otra cuenta";
  if (p.activityId) return "ya votado";
  if (!e.subOrg || p.subOrgId !== e.subOrg) return "otra organización";
  // Lo que llega del servidor puede traer cualquier cosa: sin la transacción y el hash en texto, no se vota.
  if (typeof p.unsignedPayload !== "string" || p.unsignedPayload === "") return "sin transacción";
  if (typeof p.payloadHash !== "string" || p.payloadHash === "") return "sin transacción";
  if (p.payloadHash.toLowerCase() !== e.hashDeLaArmada) return "hash";
  return null;
}

/**
 * ¿Es claramente el pedido que abrió esta llamada? Solo ese se rechaza cuando la regla no lo vota (como hace el kit
 * después de una verificación que falló): el id que devolvió la llamada, de Stellar, pendiente y con la intención
 * pedida. En la línea, además, una línea (`change_trust`). En el sello y el sorteo, ni una línea ni una cuenta nueva.
 * Lo demás no se rechaza: puede ser de otro flujo, y vence solo.
 */
export function esDeEstaLlamada(p: PedidoDeCofirma, e: { id: string; intencion: IntencionDeFirma; linea: boolean }): boolean {
  if (p.id !== e.id || p.kind !== "TX" || p.network !== "STELLAR" || p.status !== "PENDING" || p.intent !== e.intencion) return false;
  return e.linea ? p.operation === "change_trust" : p.operation !== "change_trust" && p.operation !== "create_account";
}

/**
 * Por qué no se votó, para la consola: el motivo de la forma del pedido, si lo hay, y todos los campos de la transacción
 * que difieren, con los índices y los tipos de las operaciones cuando son ellas. Palabras fijas: nunca una dirección ni
 * un hash. Por ejemplo `secuencia, comision` u `operacion 0 | tipos manageData`.
 */
export function describirLaNegativa(motivo: string | null, c: Comparacion): string {
  const partes: string[] = [];
  if (motivo !== null) partes.push(motivo);
  if (!c.igual) {
    partes.push(listarLosCampos(c));
    if (c.campos.includes("operacion") || c.campos.includes("cantidad")) partes.push(`tipos ${c.tipos.join(",") || "ninguno"}`);
  }
  return partes.join(" | ") || "sin motivo";
}

/** Cómo terminó un envío, como lo dice `getTxStatus` del kit (lo que se mira). */
export interface EstadoDelEnvio {
  hash?: string | undefined;
  status: string;
  resultCode?: string | undefined;
  message?: string | undefined;
}

/** Lo que contesta `submitTx` del kit (lo que se mira). */
export interface EnvioDelKit {
  status?: string | undefined;
  hash?: string | undefined;
  resultCode?: string | undefined;
  code?: string | undefined;
  details?: string | undefined;
  message?: string | undefined;
}

/**
 * Lo que necesita el desenlace, sin el cliente, para poder probarlo solo: la intención y el hash de la armada, la frase
 * de la red, cómo preguntar por un hash (`getTxStatus`), cómo mandar una firmada (`submitTx`), cómo esperar, y si la
 * sesión sigue siendo la misma (el cliente y la cuenta con que se votó).
 */
export interface DepsDelDesenlace {
  intencion: IntencionDeFirma;
  hashDeLaArmada: string;
  passphrase: string;
  estado(hash: string): Promise<EstadoDelEnvio>;
  mandar(signedXdr: string): Promise<EnvioDelKit>;
  dormir(ms: number): Promise<void>;
  sigue(): boolean;
}

/**
 * Cómo terminó lo que se votó. `firmada`: la firma de la armada, para que la mande el portero. `entro`: la red la tomó,
 * con el hash de la armada. `fallo`: entró y falló, o la red no la tomó, con su código. `no-salio`: el pedido se cerró
 * sin aprobarse. `incierto`: ya se votó y no se sabe cómo terminó, con un motivo de palabras fijas.
 */
export type Desenlace =
  | { que: "firmada"; signedXdr: string }
  | { que: "entro"; hash: string }
  | { que: "fallo"; hash: string; resultCode?: string; code?: string; message?: string }
  | { que: "no-salio"; code: string; details?: string }
  | { que: "incierto"; motivo: string };

const incierto = (motivo: string): Desenlace => ({ que: "incierto", motivo });

/**
 * Lo que vuelve del voto, revisado. Desde que se votó nunca se dice que no se hizo nada sin saberlo: lo que no cierra es
 * incierto. Pendiente: incierto. Cerrado sin aprobar: `SDK_COSIGN_<estado>`, como el kit. Aprobado con `sign`: lo firmado
 * tiene que ser la armada (tipo 2, su hash). Aprobado con `sign_and_send`: el envío tiene que estar atado a la armada
 * (`desenlaceDelEnvio`). Nunca lanza.
 */
export async function desenlaceDelVoto(votado: PedidoDeCofirma, d: DepsDelDesenlace): Promise<Desenlace> {
  try {
    const estado = votado.status;
    if (estado === "PENDING" || typeof estado !== "string" || estado === "") return incierto("sin confirmar");
    const porQue = votado.failureReason ? { details: votado.failureReason } : {};
    if (estado !== "APPROVED") return { que: "no-salio", code: `SDK_COSIGN_${estado}`, ...porQue };
    const sdk = await import("@stellar/stellar-sdk");
    const firmada = leerSobre(sdk, votado.signedXdr, d.passphrase);
    if (d.intencion === "sign") {
      if (votado.signedXdr && firmada?.tipo === 2 && firmada.hash === d.hashDeLaArmada) return { que: "firmada", signedXdr: votado.signedXdr };
      return incierto("firmada distinta");
    }
    return await desenlaceDelEnvio(votado, firmada, d);
  } catch {
    return incierto("no se lee");
  }
}

/**
 * El desenlace de un voto que además manda. Un hash está atado a la armada si es el suyo, o si lo firmado vino envuelto
 * con la armada adentro y ese es el hash de afuera. Con el envío dicho y atado: `SUCCESS` entró, `FAILED` falló, y lo
 * demás se espera como el kit. Con un hash que no se ata, no se confía en lo que dice: se pregunta por la armada. Sin
 * envío y con lo firmado atado, se manda una vez. Sin nada de eso, incierto. El hash que sale es siempre el de la armada.
 */
async function desenlaceDelEnvio(votado: PedidoDeCofirma, firmada: SobreLeido | null, d: DepsDelDesenlace): Promise<Desenlace> {
  const armada = d.hashDeLaArmada;
  const atado = (hash: string): boolean => {
    const h = hash.toLowerCase();
    return h === armada || (firmada?.tipo === 5 && firmada.hash === h && firmada.hashInterior === armada);
  };
  const submit = votado.submit;
  if (submit) {
    const hash = submit.hash;
    if (!hash || !atado(hash)) return esperar(armada, d);
    if (submit.status === "SUCCESS") return { que: "entro", hash: armada };
    if (submit.status === "FAILED") return falloDe(armada, submit.resultCode, undefined, submit.message);
    return esperar(hash, d);
  }
  if (!votado.signedXdr) return incierto("sin envío");
  const firmadaAtada = firmada !== null && (firmada.tipo === 2 ? firmada.hash === armada : firmada.tipo === 5 && firmada.hashInterior === armada);
  if (!firmadaAtada) return incierto("firmada distinta");
  // Con otra sesión no se manda nada: el kit lo mandaría a nombre de quien esté ahora.
  if (!d.sigue()) return incierto("sesión cambiada");
  let r: EnvioDelKit;
  try {
    r = await d.mandar(votado.signedXdr);
  } catch {
    return incierto("sin confirmar");
  }
  if (r.status === "success") return { que: "entro", hash: armada };
  if (r.status === "error" && r.resultCode) return falloDe(armada, r.resultCode, r.code, r.message);
  return incierto("sin confirmar");
}

/** El fallo con el hash de la armada y solo los códigos que vinieron. */
function falloDe(hash: string, resultCode: string | undefined, code: string | undefined, message: string | undefined): Desenlace {
  return { que: "fallo", hash, ...(resultCode ? { resultCode } : {}), ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/**
 * Pregunta por `hash` hasta `CONSULTAS_DEL_ENVIO` veces, con `ESPERA_ENTRE_CONSULTAS_MS` antes de cada una, como el kit.
 * `SUCCESS` entró y `FAILED` falló. Una consulta que falla no corta: se vuelve a preguntar. Si cambió la sesión, o se
 * acabaron las vueltas, incierto: nunca un éxito sin que la red lo diga.
 */
async function esperar(hash: string, d: DepsDelDesenlace): Promise<Desenlace> {
  for (let i = 0; i < CONSULTAS_DEL_ENVIO; i++) {
    await d.dormir(ESPERA_ENTRE_CONSULTAS_MS);
    if (!d.sigue()) return incierto("sesión cambiada");
    let s: EstadoDelEnvio;
    try {
      s = await d.estado(hash);
    } catch {
      continue;
    }
    if (s.status === "SUCCESS") return { que: "entro", hash: d.hashDeLaArmada };
    if (s.status === "FAILED") return falloDe(d.hashDeLaArmada, s.resultCode, undefined, s.message);
  }
  return incierto("sin confirmar");
}

/* ------------------------------------------------ la línea del dólar digital */

/**
 * Una operación de la transacción de un pedido de la línea, con lo que mira la regla. `origen`: el origen propio de la
 * operación, si trae uno (una G, o una M si es una cuenta con número, que nunca es la de la persona). `patrocinada`: en
 * abrir el patrocinio, la cuenta patrocinada. `activo` y `limite`: en la línea de confianza, el tipo del activo, su
 * código, quien lo emite y el límite, como los lee el SDK.
 */
export interface OperacionDeLaLinea {
  tipo: string;
  origen?: string | undefined;
  patrocinada?: string | undefined;
  activo?: { tipo: string; codigo?: string | undefined; emisor?: string | undefined } | undefined;
  limite?: string | undefined;
}

/** La transacción de un pedido de la línea, leída con el SDK de Stellar y la frase de la red de la página. */
export interface LineaLeida {
  /** 0 (el sobre viejo), 2 (el de siempre) o 5 (envuelta por otra cuenta que paga la comisión). */
  sobre: 0 | 2 | 5;
  /** Quien paga la transacción: la cuenta de origen de la de adentro. */
  fuente: string;
  /** El hash del sobre de afuera, en hexadecimal minúscula: el que se estampa si se vota. */
  hash: string;
  /** El tipo de la nota, `none` si no trae. */
  nota: string;
  /**
   * Sin condiciones (tampoco límites de tiempo: los dos en cero no limitan nada, así arma el SDK una transacción sin ellos),
   * con límites de tiempo de verdad, u otras (de ledger, de secuencia, firmantes extra o datos de contrato).
   */
  condiciones: "ninguna" | "tiempo" | "otras";
  operaciones: readonly OperacionDeLaLinea[];
}

/** Límites de tiempo que no limitan nada: sin ellos, o con los dos en cero. */
const sinLimiteDeTiempo = (t: { minTime: bigint; maxTime: bigint } | null): boolean => t === null || (t.minTime === 0n && t.maxTime === 0n);

/** Las condiciones de una transacción, para la regla de la línea. Los datos de contrato cuentan como otras condiciones. */
function condicionesDeLaLinea(c: xdr.Transaction): LineaLeida["condiciones"] {
  if (c.ext.type !== "v0") return "otras";
  const k = c.cond;
  if (k.type === "precondNone") return "ninguna";
  if (k.type === "precondTime") return sinLimiteDeTiempo(k.timeBounds) ? "ninguna" : "tiempo";
  if (k.type !== "precondV2") return "otras";
  const v = k.v2;
  const soloTiempo = v.ledgerBounds === null && v.minSeqNum === null && v.minSeqAge === 0n && v.minSeqLedgerGap === 0 && v.extraSigners.length === 0;
  if (!soloTiempo) return "otras";
  return sinLimiteDeTiempo(v.timeBounds) ? "ninguna" : "tiempo";
}

/** Lo que la regla mira de una operación, según su tipo. Lo que no es de la línea queda solo con su tipo y su origen. */
function operacionDeLaLinea(sdk: Sdk, o: TransaccionDelSdk["operations"][number]): OperacionDeLaLinea {
  const base = { tipo: o.type, origen: o.source };
  if (o.type === "beginSponsoringFutureReserves") return { ...base, patrocinada: o.sponsoredId };
  if (o.type !== "changeTrust") return base;
  const linea = o.line;
  const activo = linea instanceof sdk.Asset ? { tipo: linea.getAssetType(), codigo: linea.getCode(), emisor: linea.getIssuer() } : { tipo: "otro" };
  return { ...base, activo, limite: o.limit };
}

/**
 * Lee la transacción de un pedido de la línea. Un sobre envuelto se lee por dentro y dice que vino envuelto (la regla no
 * lo vota). `null` si no hay transacción, si no se lee o si no es de un tipo que se conozca. Nunca lanza.
 */
export async function leerLaLinea(texto: string | undefined, passphrase: string): Promise<LineaLeida | null> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    const s = leerSobre(sdk, texto, passphrase);
    if (!s) return null;
    const cuerpo = cuerpoDe(s);
    const tx = s.interior;
    return {
      sobre: s.tipo,
      fuente: tx.source,
      hash: s.hash,
      nota: tx.memo.type,
      condiciones: cuerpo === null ? "otras" : condicionesDeLaLinea(cuerpo),
      operaciones: tx.operations.map((o) => operacionDeLaLinea(sdk, o)),
    };
  } catch {
    return null;
  }
}

/** Una operación sin origen propio la hace quien paga la transacción. Si trae uno, tiene que ser esa misma cuenta. */
const deQuienPaga = (origen: string | undefined, fuente: string): boolean => origen === undefined || origen === fuente;

/**
 * ¿Este pedido es exactamente la línea del dólar digital de esta cuenta, como la arma el proveedor? Devuelve el motivo si
 * no lo es, `null` si sí. Es una regla por forma, como la de la activación: no hay una transacción de la página con qué
 * comparar. La forma es la que se midió en la red principal el 18 de noviembre de 2026, y nada más.
 *
 * El pedido: pendiente, de Stellar, para firmar y mandar una línea, de esta cuenta, sin voto, de esta organización, con
 * su transacción y su hash. La transacción: un sobre de los de siempre (ni envuelto ni viejo), la paga otra cuenta G, sin
 * nota, sin condiciones (ni límites de tiempo), y exactamente tres operaciones en este orden: abrir el patrocinio de esta
 * cuenta (desde la que paga, o sin origen propio), la línea del activo `usdc` con el límite máximo desde esta cuenta, y
 * cerrar el patrocinio desde esta cuenta. Su hash, con la frase de la red de la página, es el que dice el pedido.
 *
 * Lo que la persona autoriza con su firma son la línea y el cierre del patrocinio: ninguna de las dos mueve dinero ni
 * cambia quién firma la cuenta. La comisión y la secuencia son de quien paga y no se miran. Lo que no estaba en la forma
 * medida no se vota, aunque parezca inofensivo: tampoco unos límites de tiempo. Palabras fijas, sin direcciones ni hashes.
 */
export function motivoContraLaLinea(
  p: PedidoDeCofirma,
  cuenta: string,
  tx: LineaLeida | null,
  subOrg: string | null,
  usdc: { code: string; issuer: string },
): string | null {
  if (!cuenta.startsWith("G")) return "cuenta";
  if (p.status !== "PENDING") return "estado";
  if (p.kind !== "TX" || p.network !== "STELLAR") return "tipo";
  if (p.intent !== "sign_and_send" || p.operation !== "change_trust") return "intención";
  if (p.account !== cuenta || p.signWith !== cuenta) return "otra cuenta";
  if (p.appPaysFee === false) return "no paga la app";
  if (p.activityId) return "ya votado";
  if (!subOrg || p.subOrgId !== subOrg) return "otra organización";
  if (typeof p.unsignedPayload !== "string" || p.unsignedPayload === "") return "sin transacción";
  if (typeof p.payloadHash !== "string" || p.payloadHash === "") return "sin transacción";
  if (!tx) return "no se lee";
  if (tx.sobre === 5) return "envuelta";
  if (tx.sobre !== 2) return "sobre";
  if (!tx.fuente.startsWith("G") || tx.fuente === cuenta) return "quién paga";
  if (tx.nota !== "none") return "nota";
  if (tx.condiciones !== "ninguna") return "condiciones";
  return motivoContraLasOperaciones(tx, cuenta, usdc) ?? (tx.hash === p.payloadHash.toLowerCase() ? null : "hash");
}

/** Las tres operaciones de la línea, en su orden. El motivo es una palabra fija o, si sobran o faltan, la lista de tipos. */
function motivoContraLasOperaciones(tx: LineaLeida, cuenta: string, usdc: { code: string; issuer: string }): string | null {
  const ops = tx.operaciones;
  const tipos = `operaciones: ${ops.map((o) => o.tipo).join(",") || "ninguna"}`;
  const abre = ops[0];
  const cierra = ops.at(-1);
  if (!abre || !cierra) return tipos;
  if (abre.tipo !== "beginSponsoringFutureReserves") return "sin patrocinio";
  if (cierra.tipo !== "endSponsoringFutureReserves") return "sin cerrar el patrocinio";
  const linea = ops.length === 3 ? ops[1] : undefined;
  if (!linea || linea.tipo !== "changeTrust") return tipos;
  if (abre.patrocinada !== cuenta) return "patrocina a otra cuenta";
  if (!deQuienPaga(abre.origen, tx.fuente)) return "quién patrocina";
  if (linea.origen !== cuenta) return "otra cuenta";
  const activo = linea.activo;
  if (!activo || activo.tipo !== "credit_alphanum4" || activo.codigo !== usdc.code) return "otro activo";
  if (activo.emisor !== usdc.issuer) return "otro emisor";
  if (linea.limite !== LIMITE_MAXIMO) return "límite";
  if (cierra.origen !== cuenta) return "quién cierra";
  return null;
}
