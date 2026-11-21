// @vitest-environment jsdom
/** El paso «Dejá tu cuenta lista» del celular de una campaña: activar y proteger antes de anotarse. */

import { describe, expect, it, vi } from "vitest";
import type { abrirCuentaLista, OpcionesDelPaso, SalidasDelPaso } from "../ui/cuenta-lista";
import type { Mock } from "vitest";
import { pasoDeLaCuenta, type BilleteraDeLaCuenta, type PiezasDeLaCuenta } from "./cuenta";

const CUENTA = `G${"A".repeat(55)}`;

function billetera(
  estado: { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" } = {
    activacion: "falta",
    proteccion: "no-se-sabe",
  },
): BilleteraDeLaCuenta {
  return {
    address: CUENTA,
    estadoOficialLocal: () => estado,
    estadoOficial: async () => ({
      activacion: estado.activacion === "falta" ? "falta" : "lista",
      proteccion: estado.proteccion === "lista" ? "lista" : "falta",
      correoConfirmado: true,
      tieneLlaves: true,
      unicoNavegador: true,
      correoDeLaCuenta: null,
    }),
    sesionViva: () => true,
  };
}

function armar(o: { red?: "mainnet" | "testnet"; billetera?: BilleteraDeLaCuenta | null; eleccion?: boolean } = {}): {
  piezas: PiezasDeLaCuenta;
  abrir: Mock<(cuenta: unknown, salidas: SalidasDelPaso, opciones: OpcionesDelPaso) => Promise<boolean>>;
} {
  const abrir = vi.fn(async (_cuenta: unknown, _salidas: SalidasDelPaso, _opciones: OpcionesDelPaso) => o.eleccion ?? true);
  return {
    abrir,
    piezas: {
      red: o.red ?? "mainnet",
      billetera: async () => (o.billetera === undefined ? billetera() : o.billetera),
      salidas: { cerrarSesion: async () => undefined },
      abrir: abrir as unknown as typeof abrirCuentaLista,
    },
  };
}

describe("pasoDeLaCuenta: la cuenta del celular queda lista antes de anotarse", () => {
  it("en la red de prueba no abre nada y sigue", async () => {
    const m = armar({ red: "testnet" });
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(true);
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("sin la sesión de cuentas del proveedor sigue sin abrir nada", async () => {
    const m = armar({ billetera: null });
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(true);
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("con la cuenta ya lista, por lo que se sabe sin red, sigue sin abrir el paso", async () => {
    const m = armar({ billetera: billetera({ activacion: "lista", proteccion: "lista" }) });
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(true);
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("con la cuenta sin activar abre el paso, a la vista como celular, y espera lo que la persona eligió", async () => {
    for (const eleccion of [true, false]) {
      const m = armar({ eleccion });
      await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(eleccion);
      expect(m.abrir).toHaveBeenCalledTimes(1);
      const opciones = m.abrir.mock.calls[0]?.[2] as OpcionesDelPaso;
      expect(opciones.para).toBe("entrada");
      expect(opciones.celular).toBe(true);
      // «Pasar a Prueba» no existe en una campaña de la red principal.
      const salidas = m.abrir.mock.calls[0]?.[1] as SalidasDelPaso;
      expect(salidas.puedePasarAPrueba?.()).toBe(false);
      // La cuenta que se le da al paso es la de la sesión, no una invención.
      const cuenta = m.abrir.mock.calls[0]?.[0] as { address: string };
      expect(cuenta.address).toBe(CUENTA);
    }
  });

  it("lo que la red dice después no cuenta para abrir: lo local alcanza", async () => {
    const b = billetera({ activacion: "falta", proteccion: "no-se-sabe" });
    const espía = vi.fn(b.estadoOficial);
    b.estadoOficial = espía;
    const m = armar({ billetera: b });
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(true);
    expect(m.abrir).toHaveBeenCalledTimes(1);
    expect(espía).not.toHaveBeenCalled();
  });

  it("lo que no se sabe por lo local se mira con la red antes de abrir", async () => {
    const b = billetera({ activacion: "no-se-sabe", proteccion: "no-se-sabe" });
    const m = armar({ billetera: b });
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(true);
    expect(m.abrir).toHaveBeenCalledTimes(1);
    expect((m.abrir.mock.calls[0]?.[2] as OpcionesDelPaso).inicial?.proteccion).toBe("falta");
    expect((m.abrir.mock.calls[0]?.[2] as OpcionesDelPaso).inicial?.activacion).toBe("lista");
  });

  it("lo que no se puede saber porque la red no contesta sigue, sin abrir el paso", async () => {
    const b = billetera({ activacion: "no-se-sabe", proteccion: "no-se-sabe" });
    b.estadoOficial = async () => {
      throw new Error("sin-red");
    };
    const m = armar({ billetera: b });
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(true);
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("el paso recibe las salidas de la campaña para cerrar la sesión", async () => {
    const cerrar = vi.fn(async () => undefined);
    const m = armar({ eleccion: false });
    m.piezas.salidas.cerrarSesion = cerrar;
    await expect(pasoDeLaCuenta(m.piezas)()).resolves.toBe(false);
    expect(m.abrir).toHaveBeenCalledTimes(1);
    const salidas = m.abrir.mock.calls[0]?.[1] as SalidasDelPaso;
    await salidas.cerrarSesion();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
});
