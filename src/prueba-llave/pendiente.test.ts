import { describe, expect, it } from "vitest";
import {
  anotarRegistroDePremio,
  avanzarRegistro,
  borrarCreacionPendiente,
  borrarEnvioPendiente,
  borrarPremioPendiente,
  borrarSelloPendiente,
  guardarCreacionPendiente,
  guardarEnvioPendiente,
  guardarPremioPendiente,
  guardarSelloPendiente,
  leerCreacionPendiente,
  leerEnvioPendiente,
  leerPremioPendiente,
  leerRegistroDePremio,
  leerSelloPendiente,
  TOPE_DE_REGISTROS,
  type Almacen,
  type EnvioPendiente,
  type PremioPendiente,
  type RegistroDePremio,
  type SelloPendiente,
} from "./pendiente";

function almacenDeMemoria(): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
  };
}

const sello: SelloPendiente = { id: "12", ronda: 4_000_000, nombres: ["Ana", "Nora", "Beto"], hashSello: "ab".repeat(32), selladoEn: 1_800_000_000, credentialId: "cred" };

describe("el sello pendiente", () => {
  it("se guarda, se lee igual y se borra", () => {
    const a = almacenDeMemoria();
    expect(leerSelloPendiente(a)).toBeNull();
    guardarSelloPendiente(sello, a);
    expect(leerSelloPendiente(a)).toEqual(sello);
    borrarSelloPendiente(a);
    expect(leerSelloPendiente(a)).toBeNull();
  });

  it("lo que está mal formado se lee como que no hay nada", () => {
    const a = almacenDeMemoria();
    a.setItem("tinkazo.prueba-llave.sello", "no es json");
    expect(leerSelloPendiente(a)).toBeNull();
    a.setItem("tinkazo.prueba-llave.sello", JSON.stringify({ ...sello, id: "no es un numero" }));
    expect(leerSelloPendiente(a)).toBeNull();
    a.setItem("tinkazo.prueba-llave.sello", JSON.stringify({ ...sello, nombres: [1, 2] }));
    expect(leerSelloPendiente(a)).toBeNull();
  });

  it("sin almacenamiento, o con uno que lanza, no se rompe nada", () => {
    expect(() => guardarSelloPendiente(sello, null)).not.toThrow();
    expect(leerSelloPendiente(null)).toBeNull();
    const roto: Almacen = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(() => guardarSelloPendiente(sello, roto)).not.toThrow();
    expect(leerSelloPendiente(roto)).toBeNull();
    expect(() => borrarSelloPendiente(roto)).not.toThrow();
  });
});

describe("la creación pendiente", () => {
  it("se guarda, se lee y se borra", () => {
    const a = almacenDeMemoria();
    guardarCreacionPendiente({ credentialId: "cred", hashCreacion: "cd".repeat(32) }, a);
    expect(leerCreacionPendiente(a)).toEqual({ credentialId: "cred", hashCreacion: "cd".repeat(32) });
    borrarCreacionPendiente(a);
    expect(leerCreacionPendiente(a)).toBeNull();
  });
});

describe("el pago pendiente", () => {
  const premio: PremioPendiente = { contractId: "CCUENTA", hash: "ab".repeat(32), vence: 1_800_000_030, monto: "100000000", desdeMs: 1_800_000_000_000 };

  it("se guarda, se lee igual y se borra", () => {
    const a = almacenDeMemoria();
    expect(leerPremioPendiente(a)).toBeNull();
    guardarPremioPendiente(premio, a);
    expect(leerPremioPendiente(a)).toEqual(premio);
    borrarPremioPendiente(a);
    expect(leerPremioPendiente(a)).toBeNull();
  });

  it("lo mal formado se lee como que no hay nada", () => {
    const a = almacenDeMemoria();
    for (const malo of [{ ...premio, monto: "diez" }, { ...premio, vence: "pronto" }, { ...premio, hash: "" }, "no es objeto"]) {
      a.setItem("tinkazo.prueba-llave.premio", JSON.stringify(malo));
      expect(leerPremioPendiente(a)).toBeNull();
    }
    a.setItem("tinkazo.prueba-llave.premio", "no es json");
    expect(leerPremioPendiente(a)).toBeNull();
  });
});

describe("el envío pendiente", () => {
  const envio: EnvioPendiente = {
    contractId: "CCUENTA",
    hash: "cd".repeat(32),
    vence: 1_800_000_030,
    hacia: "MDESTINO",
    base: "GDESTINO",
    tipo: "M",
    origen: "pagina",
    nota: "1234567890",
    monto: "100000000",
    desdeMs: 1_800_000_000_000,
  };

  it("se guarda, se lee igual y se borra, con nota o sin ella", () => {
    const a = almacenDeMemoria();
    guardarEnvioPendiente(envio, a);
    expect(leerEnvioPendiente(a)).toEqual(envio);
    guardarEnvioPendiente({ ...envio, nota: null, tipo: "G" }, a);
    expect(leerEnvioPendiente(a)).toMatchObject({ nota: null, tipo: "G" });
    borrarEnvioPendiente(a);
    expect(leerEnvioPendiente(a)).toBeNull();
  });

  it("lo mal formado se lee como que no hay nada", () => {
    const a = almacenDeMemoria();
    for (const malo of [{ ...envio, tipo: "X" }, { ...envio, origen: "otro" }, { ...envio, nota: "abc" }, { ...envio, monto: 5 }, { ...envio, base: "" }]) {
      a.setItem("tinkazo.prueba-llave.envio", JSON.stringify(malo));
      expect(leerEnvioPendiente(a)).toBeNull();
    }
  });

  it("sin almacenamiento no se rompe nada", () => {
    expect(() => guardarEnvioPendiente(envio, null)).not.toThrow();
    expect(leerEnvioPendiente(null)).toBeNull();
  });
});

describe("el registro del premio de cada billetera", () => {
  const reg = (contractId: string, estado: RegistroDePremio["estado"], hashPremio: string | null = null, hashEnvio: string | null = null): RegistroDePremio => ({ contractId, estado, hashPremio, hashEnvio });

  it("el estado solo avanza: de por pagar a pagado a enviado, y nunca vuelve atrás", () => {
    const porPagar = reg("C1", "por-pagar");
    const pagado = reg("C1", "pagado", "h1");
    const enviado = reg("C1", "enviado", null, "h2");
    expect(avanzarRegistro(null, porPagar)).toEqual(porPagar);
    expect(avanzarRegistro(porPagar, pagado).estado).toBe("pagado");
    expect(avanzarRegistro(pagado, porPagar)).toEqual(pagado);
    expect(avanzarRegistro(enviado, pagado)).toEqual(enviado);
    expect(avanzarRegistro(enviado, porPagar).estado).toBe("enviado");
  });

  it("los hashes ya anotados no se borran", () => {
    const r = avanzarRegistro(reg("C1", "pagado", "h1"), reg("C1", "enviado", null, "h2"));
    expect(r).toEqual({ contractId: "C1", estado: "enviado", hashPremio: "h1", hashEnvio: "h2" });
  });

  it("se anota y se lee por billetera, sin mezclar", () => {
    const a = almacenDeMemoria();
    expect(leerRegistroDePremio("C1", a)).toBeNull();
    anotarRegistroDePremio(reg("C1", "por-pagar"), a);
    anotarRegistroDePremio(reg("C2", "pagado", "h"), a);
    anotarRegistroDePremio(reg("C1", "pagado", "h1"), a);
    anotarRegistroDePremio(reg("C1", "por-pagar"), a);
    expect(leerRegistroDePremio("C1", a)).toEqual(reg("C1", "pagado", "h1"));
    expect(leerRegistroDePremio("C2", a)).toEqual(reg("C2", "pagado", "h"));
  });

  it("no pasa de diez billeteras y se queda con las más nuevas", () => {
    const a = almacenDeMemoria();
    for (let i = 0; i < TOPE_DE_REGISTROS + 3; i++) anotarRegistroDePremio(reg(`C${i}`, "pagado", `h${i}`), a);
    expect(leerRegistroDePremio("C0", a)).toBeNull();
    expect(leerRegistroDePremio("C2", a)).toBeNull();
    expect(leerRegistroDePremio(`C${TOPE_DE_REGISTROS + 2}`, a)).not.toBeNull();
    expect(JSON.parse(a.getItem("tinkazo.prueba-llave.premios") ?? "[]")).toHaveLength(TOPE_DE_REGISTROS);
  });

  it("sin almacenamiento, o con uno roto, no se rompe nada", () => {
    expect(() => anotarRegistroDePremio(reg("C1", "pagado"), null)).not.toThrow();
    expect(leerRegistroDePremio("C1", null)).toBeNull();
    const a = almacenDeMemoria();
    a.setItem("tinkazo.prueba-llave.premios", "no es json");
    expect(leerRegistroDePremio("C1", a)).toBeNull();
    a.setItem("tinkazo.prueba-llave.premios", JSON.stringify([{ contractId: "C1", estado: "raro" }, reg("C9", "enviado")]));
    expect(leerRegistroDePremio("C1", a)).toBeNull();
    expect(leerRegistroDePremio("C9", a)?.estado).toBe("enviado");
  });
});
