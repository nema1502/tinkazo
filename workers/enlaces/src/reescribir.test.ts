import { describe, expect, it } from "vitest";
import { REESCRIBIR_HORAS, REESCRITURAS_MAX, decidirReescritura, etiqueta, type FilaQueCambia } from "./reescribir";

/**
 * Quién puede reescribir un enlace y cuándo (`reescribir.ts`): solo el que nació para cambiar (el del QR de
 * espectadores), con su permiso, unas horas después de creado, sin pisar una versión más nueva y con un tope.
 */

const CREADO = 1_800_000_000_000;
const FILA: FilaQueCambia = { borrar: "huella-del-permiso", cambia: 1, version: 3, cambios: 2, creado: CREADO };

describe("reescribir un enlace", () => {
  it("con su permiso y su versión, sale con la versión siguiente", () => {
    expect(decidirReescritura(FILA, "huella-del-permiso", '"3"', CREADO + 60_000)).toEqual({ ok: true, version: 4 });
    // Sin pedir versión también sale: gana el último.
    expect(decidirReescritura(FILA, "huella-del-permiso", null, CREADO + 60_000)).toEqual({ ok: true, version: 4 });
    expect(etiqueta(4)).toBe('"4"');
  });

  it("no existe, otro permiso, no nació para cambiar", () => {
    expect(decidirReescritura(null, "x", null, CREADO)).toMatchObject({ ok: false, estado: 404 });
    expect(decidirReescritura(FILA, "otra-huella", null, CREADO)).toMatchObject({ ok: false, estado: 403 });
    // Un comprobante (o cualquier enlace creado sin pedir que cambie) no se reescribe nunca.
    expect(decidirReescritura({ ...FILA, cambia: 0 }, "huella-del-permiso", null, CREADO)).toMatchObject({ ok: false, estado: 409, error: "no-cambia" });
  });

  it("con una versión vieja no pisa la más nueva", () => {
    expect(decidirReescritura(FILA, "huella-del-permiso", '"2"', CREADO)).toMatchObject({ ok: false, estado: 412 });
  });

  it("vence unas horas después de creado, y tiene un tope de cambios", () => {
    expect(decidirReescritura(FILA, "huella-del-permiso", null, CREADO + REESCRIBIR_HORAS * 3_600_000 + 1)).toMatchObject({ ok: false, estado: 409, error: "vencido" });
    expect(decidirReescritura({ ...FILA, cambios: REESCRITURAS_MAX }, "huella-del-permiso", null, CREADO)).toMatchObject({ ok: false, estado: 429, error: "tope" });
  });
});
