import { describe, expect, it } from "vitest";
import { RED_DE_PRUEBA } from "./red";
import { revisarNacimiento, revisarNacimientoDe, type Lecturas } from "./nacimiento";

const aBytes = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const union = (type: string, nombre: string, valor: unknown): Record<string, unknown> => ({ type, [nombre]: valor, value: valor });

/** Lecturas de mentira: lo "nativo" ya viene nativo y las direcciones ya vienen como texto. */
const LECTURAS: Lecturas = { nativo: (v) => v, direccion: (a) => String(a) };

const clave = (largo = 80, primero = 0x04): Uint8Array => {
  const b = new Uint8Array(largo).fill(9);
  b[0] = primero;
  return b;
};

interface Armado {
  codigo?: string;
  tipo?: string;
  desplegador?: string;
  firmantes?: unknown;
  politicas?: unknown;
  argumentos?: number;
}

function funcion(a: Armado = {}): unknown {
  const args: unknown[] = [a.firmantes ?? [["External", RED_DE_PRUEBA.verificador, clave()]], a.politicas ?? {}];
  const crear = {
    contractIdPreimage: union("contractIdPreimageFromAddress", "fromAddress", { address: a.desplegador ?? RED_DE_PRUEBA.desplegador, salt: new Uint8Array(32) }),
    executable: union("contractExecutableWasm", "wasmHash", null) as Record<string, unknown>,
    constructorArgs: a.argumentos === undefined ? args : args.slice(0, a.argumentos),
  };
  crear.executable = { type: "contractExecutableWasm", wasmHash: aBytes(a.codigo ?? RED_DE_PRUEBA.codigoCuenta) };
  return union(a.tipo ?? "hostFunctionTypeCreateContractV2", "createContractV2", crear);
}

function entrada(quien: string = RED_DE_PRUEBA.desplegador, debajo: unknown[] = [], tipo = "sorobanCredentialsAddress"): unknown {
  const nombre = tipo === "sorobanCredentialsAddressV2" ? "addressV2" : "address";
  return { credentials: union(tipo, nombre, { address: quien }), rootInvocation: { subInvocations: debajo } };
}

const revisar = (f: unknown, auth: unknown[] = [entrada()]): ReturnType<typeof revisarNacimientoDe> => revisarNacimientoDe(f, auth, LECTURAS);

describe("la cuenta nace como se dijo", () => {
  it("una creación como la del kit pasa", () => {
    expect(revisar(funcion())).toEqual({ ok: true });
  });

  it("también pasa con la autorización de la versión nueva de las credenciales", () => {
    expect(revisar(funcion(), [entrada(RED_DE_PRUEBA.desplegador, [], "sorobanCredentialsAddressV2")])).toEqual({ ok: true });
  });

  it("dos firmantes no pasan", () => {
    const dos = [
      ["External", RED_DE_PRUEBA.verificador, clave()],
      ["External", RED_DE_PRUEBA.verificador, clave()],
    ];
    expect(revisar(funcion({ firmantes: dos }))).toEqual({ ok: false, motivo: "no-es-un-solo-firmante" });
  });

  it("un firmante que no es una llave externa o que usa otro verificador no pasa", () => {
    expect(revisar(funcion({ firmantes: [["Delegated", RED_DE_PRUEBA.desplegador]] }))).toEqual({ ok: false, motivo: "firmante-no-externo" });
    expect(revisar(funcion({ firmantes: [["External", RED_DE_PRUEBA.contrato, clave()]] }))).toEqual({ ok: false, motivo: "otro-verificador" });
  });

  it("una llave que no es de 65 bytes más el identificador, o que no empieza en 0x04, no pasa", () => {
    expect(revisar(funcion({ firmantes: [["External", RED_DE_PRUEBA.verificador, clave(65)]] }))).toEqual({ ok: false, motivo: "clave-mal-formada" });
    expect(revisar(funcion({ firmantes: [["External", RED_DE_PRUEBA.verificador, clave(80, 0x02)]] }))).toEqual({ ok: false, motivo: "clave-mal-formada" });
  });

  it("una política no pasa", () => {
    expect(revisar(funcion({ politicas: { CAAAA: 1 } }))).toEqual({ ok: false, motivo: "trae-politicas" });
    expect(revisar(funcion({ politicas: new Map([["CAAAA", 1]]) }))).toEqual({ ok: false, motivo: "trae-politicas" });
    expect(revisar(funcion({ politicas: new Map() }))).toEqual({ ok: true });
  });

  it("otro código de cuenta no pasa", () => {
    expect(revisar(funcion({ codigo: "00".repeat(32) }))).toEqual({ ok: false, motivo: "otro-codigo" });
  });

  it("otro desplegador no pasa, ni en la dirección de la cuenta ni en la autorización", () => {
    const otro = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
    expect(revisar(funcion({ desplegador: otro }))).toEqual({ ok: false, motivo: "otro-desplegador" });
    expect(revisar(funcion(), [entrada(otro)])).toEqual({ ok: false, motivo: "autoriza-otro" });
  });

  it("no pasa con otra función del anfitrión, con argumentos de menos, ni con la autorización sin la forma exacta", () => {
    expect(revisar(funcion({ tipo: "hostFunctionTypeInvokeContract" }))).toEqual({ ok: false, motivo: "no-es-creacion-v2" });
    expect(revisar(funcion({ argumentos: 1 }))).toEqual({ ok: false, motivo: "argumentos-del-constructor" });
    expect(revisar(funcion(), [])).toEqual({ ok: false, motivo: "entradas-de-autorizacion" });
    expect(revisar(funcion(), [entrada(), entrada()])).toEqual({ ok: false, motivo: "entradas-de-autorizacion" });
    expect(revisar(funcion(), [entrada(RED_DE_PRUEBA.desplegador, [{}])])).toEqual({ ok: false, motivo: "autorizacion-con-llamadas-debajo" });
    expect(revisar(funcion(), [{ credentials: { type: "sorobanCredentialsSourceAccount" }, rootInvocation: { subInvocations: [] } }])).toEqual({ ok: false, motivo: "autorizacion-sin-direccion" });
  });

  it("lo que no es XDR no pasa y no lanza", () => {
    expect(revisarNacimiento("no es xdr", ["tampoco"])).toEqual({ ok: false, motivo: "xdr-ilegible" });
  });
});
