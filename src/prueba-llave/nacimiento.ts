import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { RED_DE_PRUEBA } from "./red";

/**
 * Antes de pagar la creación de la cuenta se mira, en el XDR que armó el kit, que la cuenta nace como se dijo: el código
 * que se espera, desde la dirección del desplegador compartido, con un solo firmante (la llave de la persona, por el
 * verificador conocido), sin políticas y con una sola entrada de autorización, la del desplegador y sin llamadas debajo.
 * Es la prueba en código de que Tinkazo no queda como firmante ni como administrador de la cuenta.
 *
 * La lectura es por forma, sin suponer los tipos exactos del XDR: `revisarNacimientoDe` recibe lo ya decodificado y se
 * prueba con objetos a mano. `revisarNacimiento` es la parte delgada que decodifica con el SDK.
 */

export type ResultadoDeNacimiento = { ok: true } | { ok: false; motivo: string };

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (typeof x === "object" && x !== null ? (x as Obj) : null);

/** La rama de una unión: el campo con su nombre o, si no, el genérico `value`. */
function rama(x: unknown, nombre: string): Obj | null {
  const o = obj(x);
  if (!o) return null;
  return obj(o[nombre]) ?? obj(o["value"]);
}

/** Los bytes de un valor del XDR nuevo: el propio arreglo o su `.value`. */
function bytesDe(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  const o = obj(v);
  if (o && o["value"] instanceof Uint8Array) return o["value"];
  return null;
}

const hex = (b: Uint8Array): string => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");

export interface Lecturas {
  /** De un valor `ScVal` a lo nativo. */
  nativo: (v: unknown) => unknown;
  /** De un `ScAddress` a su texto. */
  direccion: (a: unknown) => string;
}

const LECTURAS_DEL_SDK: Lecturas = {
  nativo: (v) => scValToNative(v as xdr.ScVal),
  direccion: (a) => Address.fromScAddress(a as xdr.ScAddress).toString(),
};

/** La dirección de quien firma una entrada de autorización, si es de dirección. */
function credencialesDe(entrada: unknown): Obj | null {
  const c = obj(obj(entrada)?.["credentials"]);
  if (!c) return null;
  if (c["type"] === "sorobanCredentialsAddress") return rama(c, "address");
  if (c["type"] === "sorobanCredentialsAddressV2") return rama(c, "addressV2");
  return null;
}

/** Revisa la creación ya decodificada: la función del anfitrión y las entradas de autorización. */
export function revisarNacimientoDe(func: unknown, auth: unknown[], l: Lecturas = LECTURAS_DEL_SDK): ResultadoDeNacimiento {
  const no = (motivo: string): ResultadoDeNacimiento => ({ ok: false, motivo });
  const f = obj(func);
  if (!f || f["type"] !== "hostFunctionTypeCreateContractV2") return no("no-es-creacion-v2");
  const crear = rama(f, "createContractV2");
  if (!crear) return no("sin-argumentos");

  const ejecutable = obj(crear["executable"]);
  if (!ejecutable || ejecutable["type"] !== "contractExecutableWasm") return no("no-es-wasm");
  const codigo = bytesDe(ejecutable["wasmHash"]);
  if (!codigo || hex(codigo) !== RED_DE_PRUEBA.codigoCuenta) return no("otro-codigo");

  const preimagen = obj(crear["contractIdPreimage"]);
  if (!preimagen || preimagen["type"] !== "contractIdPreimageFromAddress") return no("no-es-desde-direccion");
  const desde = rama(preimagen, "fromAddress");
  let quien = "";
  try {
    quien = l.direccion(desde?.["address"]);
  } catch {
    return no("direccion-ilegible");
  }
  if (quien !== RED_DE_PRUEBA.desplegador) return no("otro-desplegador");

  const args = crear["constructorArgs"];
  if (!Array.isArray(args) || args.length !== 2) return no("argumentos-del-constructor");
  let firmantes: unknown;
  let politicas: unknown;
  try {
    firmantes = l.nativo(args[0]);
    politicas = l.nativo(args[1]);
  } catch {
    return no("constructor-ilegible");
  }
  if (!Array.isArray(firmantes) || firmantes.length !== 1) return no("no-es-un-solo-firmante");
  const firmante: unknown = firmantes[0];
  if (!Array.isArray(firmante) || firmante.length !== 3 || firmante[0] !== "External") return no("firmante-no-externo");
  if (firmante[1] !== RED_DE_PRUEBA.verificador) return no("otro-verificador");
  const clave = bytesDe(firmante[2]);
  if (!clave || clave.length <= 65 || clave[0] !== 0x04) return no("clave-mal-formada");
  const cantidadDePoliticas = politicas instanceof Map ? politicas.size : Array.isArray(politicas) ? politicas.length : Object.keys(obj(politicas) ?? { x: 1 }).length;
  if (cantidadDePoliticas !== 0) return no("trae-politicas");

  if (auth.length !== 1) return no("entradas-de-autorizacion");
  const creds = credencialesDe(auth[0]);
  if (!creds) return no("autorizacion-sin-direccion");
  try {
    if (l.direccion(creds["address"]) !== RED_DE_PRUEBA.desplegador) return no("autoriza-otro");
  } catch {
    return no("direccion-ilegible");
  }
  const raiz = obj(obj(auth[0])?.["rootInvocation"]);
  const debajo = raiz?.["subInvocations"];
  if (!Array.isArray(debajo) || debajo.length !== 0) return no("autorizacion-con-llamadas-debajo");
  return { ok: true };
}

/** Revisa la creación tal como la entrega el kit: la función y las entradas, en base64. */
export function revisarNacimiento(funcB64: string, authB64: string[]): ResultadoDeNacimiento {
  try {
    const func = xdr.HostFunction.fromXDR(funcB64, "base64");
    const auth = authB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
    return revisarNacimientoDe(func, auth);
  } catch {
    return { ok: false, motivo: "xdr-ilegible" };
  }
}
