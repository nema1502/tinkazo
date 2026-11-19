// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { CompraQrDelEstado, EstadoDeAlta, ResultadoDeAlta } from "../stellar/alta-api";
import { compraQrActiva } from "../stellar/alta-config";
import { entradaDeLaCompra } from "./compra-entrada";

/**
 * Cómo se llega a Tu compra desde Sumar sorteos (`compra-entrada.ts`). Con la compra con QR apagada en el build, ni una
 * petición nueva: no se pregunta el estado. Prendida, el medio sale de lo que dice el servidor de esta cuenta, y una
 * compra ya cargada siempre sigue por el QR.
 */

const BASE: EstadoDeAlta = { acceso: "pago", cuenta: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", abierta: true, pedido: null, sorteos: { quedan: 1, proximoVence: null }, orden: null, fondeo: "inmediato" };
const QR: CompraQrDelEstado = { puede: true, motivo: null, abierta: null, terminar: false, minimoBs: 0, recargoPendiente: null };
const conQr = (c: Partial<CompraQrDelEstado> | null): (() => Promise<ResultadoDeAlta<EstadoDeAlta>>) =>
  vi.fn(async () => ({ ok: true as const, datos: c === null ? BASE : { ...BASE, compraQr: { ...QR, ...c } } }));

describe("la entrada a Tu compra", () => {
  it("con la compra con QR apagada en este build: null sin preguntar nada", async () => {
    expect(compraQrActiva()).toBe(false);
    const estado = conQr({});
    expect(await entradaDeLaCompra({ estado })).toBeNull();
    expect(estado).not.toHaveBeenCalled();
  });

  it("prendida: en Bolivia el QR, afuera otra app, los dos con el cambio a un toque", async () => {
    expect(await entradaDeLaCompra({ estado: conQr({}), enElBuild: true, almacen: null, zona: "America/La_Paz" })).toMatchObject({ medio: "qr" });
    expect(await entradaDeLaCompra({ estado: conQr({}), enElBuild: true, almacen: null, zona: "Europe/Berlin" })).toMatchObject({ medio: "app" });
  });

  it("prendida: el servidor que no la ofrece a esta cuenta, el estado sin compraQr o que no llega: como hoy", async () => {
    expect(await entradaDeLaCompra({ estado: conQr({ puede: false, motivo: "fuera-del-piloto" }), enElBuild: true, almacen: null, zona: "America/La_Paz" })).toBeNull();
    expect(await entradaDeLaCompra({ estado: conQr(null), enElBuild: true, almacen: null, zona: "America/La_Paz" })).toBeNull();
    const sinRed = vi.fn(async () => ({ ok: false as const, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 }));
    expect(await entradaDeLaCompra({ estado: sinRed, enElBuild: true, almacen: null, zona: "America/La_Paz" })).toBeNull();
    const nunca = vi.fn(() => new Promise<ResultadoDeAlta<EstadoDeAlta>>(() => undefined));
    expect(await entradaDeLaCompra({ estado: nunca, enElBuild: true, almacen: null, zona: "America/La_Paz", topeMs: 5 })).toBeNull();
  });

  it("con una compra con QR ya cargada, siempre por el QR: el dinero puede estar en camino", async () => {
    const abierta = { producto: "p10", desde: 1, recargo: "0.5", total: "10.5", primera: false, cargada: true };
    const guardado = new Map([["tinkazo:medio-de-pago", "app"]]);
    const almacen = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
    expect(await entradaDeLaCompra({ estado: conQr({ abierta, terminar: true }), enElBuild: true, almacen, zona: "Europe/Berlin" })).toMatchObject({ medio: "qr", compraQr: { abierta } });
  });
});
