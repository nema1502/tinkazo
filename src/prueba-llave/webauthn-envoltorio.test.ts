import { describe, expect, it } from "vitest";
import { conNombreVisible, largoDelIdDeUsuario, TOPE_DEL_ID_DE_USUARIO, USUARIO_DE_LA_LLAVE, type ImplementacionDeWebAuthn } from "./webauthn-envoltorio";

function falsa(): { impl: ImplementacionDeWebAuthn; registros: unknown[]; autenticaciones: unknown[] } {
  const registros: unknown[] = [];
  const autenticaciones: unknown[] = [];
  const impl = {
    startRegistration: async (o: unknown) => {
      registros.push(o);
      return { id: "cred" };
    },
    startAuthentication: async (o: unknown) => {
      autenticaciones.push(o);
      return { id: "cred" };
    },
  } as unknown as ImplementacionDeWebAuthn;
  return { impl, registros, autenticaciones };
}

const RAYA = String.fromCharCode(8212);
const nombreDelKit = `llave ${RAYA} 25/11/2026 12:00:00`;
const opciones = {
  challenge: "abc",
  rp: { id: "ejemplo.org", name: "Tinkazo prueba" },
  user: { id: "bGxhdmU6MTox", name: nombreDelKit, displayName: nombreDelKit },
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
};

describe("el envoltorio de WebAuthn", () => {
  it("cambia el nombre visible de la llave y deja el identificador del usuario como está", async () => {
    const { impl, registros } = falsa();
    await conNombreVisible(impl, "Llave de prueba de Tinkazo").startRegistration({ optionsJSON: opciones as never });
    const o = registros[0] as { optionsJSON: typeof opciones };
    expect(o.optionsJSON.user.name).toBe("Llave de prueba de Tinkazo");
    expect(o.optionsJSON.user.displayName).toBe("Llave de prueba de Tinkazo");
    expect(o.optionsJSON.user.id).toBe(opciones.user.id);
    expect(o.optionsJSON.rp).toEqual(opciones.rp);
    expect(o.optionsJSON.challenge).toBe("abc");
  });

  it("no cambia el objeto que recibe y pasa las demás opciones tal cual", async () => {
    const { impl, registros } = falsa();
    await conNombreVisible(impl, "Otro").startRegistration({ optionsJSON: opciones as never, useAutoRegister: true });
    expect(opciones.user.name).toContain(RAYA);
    expect((registros[0] as { useAutoRegister: boolean }).useAutoRegister).toBe(true);
  });

  it("la autenticación pasa sin cambios", async () => {
    const { impl, autenticaciones } = falsa();
    const pedido = { optionsJSON: { challenge: "x", rpId: "ejemplo.org" } as never };
    await conNombreVisible(impl, "Otro").startAuthentication(pedido);
    expect(autenticaciones[0]).toBe(pedido);
  });
});

describe("el aviso de la autenticación y el contador", () => {
  const pedido = { optionsJSON: { challenge: "x", rpId: "ejemplo.org" } as never };

  it("el aviso corre con la respuesta y se espera antes de devolverla", async () => {
    const { impl } = falsa();
    const w = conNombreVisible(impl, "Otro");
    const orden: string[] = [];
    w.armar(async (r) => {
      orden.push(`aviso ${r.id}`);
      await new Promise((ok) => setTimeout(ok, 5));
      orden.push("aviso listo");
    });
    const r = await w.startAuthentication(pedido);
    orden.push("devuelta");
    expect(r.id).toBe("cred");
    expect(orden).toEqual(["aviso cred", "aviso listo", "devuelta"]);
  });

  it("vale para un solo uso", async () => {
    const { impl } = falsa();
    const w = conNombreVisible(impl, "Otro");
    let veces = 0;
    w.armar(async () => void veces++);
    await w.startAuthentication(pedido);
    await w.startAuthentication(pedido);
    expect(veces).toBe(1);
  });

  it("desarmado no corre, y un error del aviso sale tal cual", async () => {
    const { impl } = falsa();
    const w = conNombreVisible(impl, "Otro");
    let veces = 0;
    w.armar(async () => void veces++);
    w.desarmar();
    await w.startAuthentication(pedido);
    expect(veces).toBe(0);
    const error = new Error("no hay cuenta");
    w.armar(async () => {
      throw error;
    });
    await expect(w.startAuthentication(pedido)).rejects.toBe(error);
  });

  it("si la persona cancela, el aviso sigue armado hasta que se desarma", async () => {
    const cancelada = Object.assign(new Error("cancelada"), { name: "NotAllowedError" });
    const impl = { startRegistration: async () => ({ id: "x" }), startAuthentication: async () => Promise.reject(cancelada) } as unknown as ImplementacionDeWebAuthn;
    const w = conNombreVisible(impl, "Otro");
    let veces = 0;
    w.armar(async () => void veces++);
    await expect(w.startAuthentication(pedido)).rejects.toBe(cancelada);
    expect(veces).toBe(0);
    w.desarmar();
  });

  it("cuenta cada vez que se pide la llave y el registro no cuenta", async () => {
    const { impl } = falsa();
    const w = conNombreVisible(impl, "Otro");
    expect(w.autenticaciones()).toBe(0);
    await w.startAuthentication(pedido);
    await w.startAuthentication(pedido);
    await w.startRegistration({ optionsJSON: opciones as never });
    expect(w.autenticaciones()).toBe(2);
  });
});

describe("el identificador del usuario", () => {
  it("con el nombre corto y el peor azar posible queda lejos del tope de 64 bytes", () => {
    const peorAzar = 0.00000123456789012345678;
    expect(largoDelIdDeUsuario(USUARIO_DE_LA_LLAVE, 1_800_000_000_000, peorAzar)).toBeLessThanOrEqual(TOPE_DEL_ID_DE_USUARIO);
    expect(largoDelIdDeUsuario(USUARIO_DE_LA_LLAVE, 1_800_000_000_000, 1.2345678901234567e-7)).toBeLessThanOrEqual(TOPE_DEL_ID_DE_USUARIO);
    expect(largoDelIdDeUsuario(USUARIO_DE_LA_LLAVE, 1_800_000_000_000, 0.1234567890123456)).toBeLessThan(50);
  });

  it("el nombre es corto y en ASCII", () => {
    expect(USUARIO_DE_LA_LLAVE).toMatch(/^[a-z]{1,10}$/);
  });
});
