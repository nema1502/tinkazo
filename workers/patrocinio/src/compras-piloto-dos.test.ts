import { readFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { COBROS, montarPagos } from "./cobros-prueba";
import { type Env, leerConfig } from "./config";
import { compraCerradaDe } from "./rutas-altas";

/**
 * El piloto de esta semana: la compra con QR se abre con una LISTA de dos cuentas, nunca con el valor que la abre a
 * todos. Con la lista, solo esas dos empiezan una compra. Un valor vacío no abre a nadie, y uno mal escrito o con una
 * cuenta mal copiada CIERRA la compra entera. `todos` queda rechazado (cierra) salvo que se pida además con
 * `COMPRAS_QR_TODOS = "1"`. Los números de la semana: `RESERVA_CARGA_CREDITOS = "8400"` y `RECARGO_QR = "4:0.50"`.
 */

const cuenta = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
const [ANA, BETO, NORA] = [cuenta(11), cuenta(12), cuenta(13)] as [string, string, string];
/** Una cuenta mal copiada: la de Beto con la última letra cambiada (la suma de control no da). */
const MAL_COPIADA = `${BETO.slice(0, -1)}${BETO.endsWith("A") ? "B" : "A"}`;

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "10" };

describe("la lista de dos cuentas", () => {
  it("solo esas dos empiezan una compra; otra cuenta da fuera-del-piloto", async () => {
    const m = montarPagos({ ...ABIERTA, COMPRAS_QR_PILOTO: `${ANA},${BETO}` });
    expect(m.cfg.faltaAltas).toEqual([]);
    const [ana, beto, nora] = [m.persona("usr_ana", ANA), m.persona("usr_beto", BETO), m.persona("usr_nora", NORA)];
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect((await m.empezar(beto.token, "alta")).estado).toBe(200);
    expect(await m.empezar(nora.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.estado(nora.token)).toMatchObject({ estado: 200, cuerpo: { compraQr: { puede: false, motivo: "fuera-del-piloto" } } });
  });

  it("vacía no abre a nadie", async () => {
    for (const vacia of ["", " ", ","]) {
      const m = montarPagos({ ...ABIERTA, COMPRAS_QR_PILOTO: vacia });
      const ana = m.persona("usr_ana", ANA);
      expect(await m.empezar(ana.token, "alta"), JSON.stringify(vacia)).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    }
  });

  it("mal escrita o con una cuenta mal copiada cierra la compra entera, también para las cuentas bien escritas", async () => {
    for (const mal of [`${ANA},${MAL_COPIADA}`, `${ANA};${BETO}`, `${ANA} ${BETO}`, `${ANA},beto`, "Todos", `todos,${ANA}`]) {
      const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, ...ABIERTA, COMPRAS_QR_PILOTO: mal });
      expect(cfg.faltaAltas, mal).toEqual(["compras-qr-piloto"]);
      expect(cfg.comprasQrTodos, mal).toBe(false);
      expect(compraCerradaDe(cfg), mal).toBe("compras-cerradas");
      const m = montarPagos({ ...ABIERTA, COMPRAS_QR_PILOTO: mal });
      const ana = m.persona("usr_ana", ANA);
      // Ni sumada a mano a la lista entra: lo mal escrito se arregla antes de vender.
      m.cupos.transaccion(() => m.compras.sumarPiloto(ANA, m.hora()));
      expect(await m.empezar(ana.token, "alta"), mal).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
      expect((await m.puerta.resumen()).faltaAltas, mal).toEqual(["compras-qr-piloto"]);
    }
  });

  it("todos queda rechazado sin COMPRAS_QR_TODOS en 1, y con él abre a cualquier cuenta", async () => {
    for (const flag of [undefined, "", "0", "si", "true", " 1"]) {
      const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", ...ABIERTA, COMPRAS_QR_PILOTO: "todos", ...(flag === undefined ? {} : { COMPRAS_QR_TODOS: flag }) });
      expect(cfg.comprasQrTodos, String(flag)).toBe(false);
      expect(cfg.faltaAltas, String(flag)).toEqual(["compras-qr-piloto"]);
    }
    const m = montarPagos({ ...ABIERTA, COMPRAS_QR_PILOTO: "todos", COMPRAS_QR_TODOS: "1" });
    expect(m.cfg.comprasQrTodos).toBe(true);
    expect(m.cfg.faltaAltas).toEqual([]);
    const nora = m.persona("usr_nora", NORA);
    expect((await m.empezar(nora.token, "alta")).estado).toBe(200);
  });
});

describe("los números de esta semana en el archivo de la red principal", () => {
  const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const mainnet = texto.slice(texto.indexOf("[env.mainnet.vars]"));
  const vars = Object.fromEntries([...mainnet.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"$/gm)].map((x) => [x[1] as string, x[2] as string]));

  it("RESERVA_CARGA_CREDITOS en 8400, RECARGO_QR en 4:0.50, la venta cerrada y sin todos", () => {
    expect(vars.RESERVA_CARGA_CREDITOS).toBe("8400");
    expect(vars.RECARGO_QR).toBe("4:0.50");
    expect(vars.COMPRAS_QR).toBe("0");
    expect(vars.COMPRAS_QR_PILOTO).toBe("");
    expect(vars.COMPRAS_QR_TODOS).toBeUndefined();
    // La cuenta de cobros nueva, propia y con su suma de control: con ALTAS_PAGO en "0" no vende, solo se lee.
    expect(vars.CUENTA_COBROS).toBe("GDMIGGM2J7GL24JL3UB5DLSTMMWFP5XTE3SDTTDZSPUFH7VMKFINKAO6");
    expect(vars.ALTAS_PAGO).toBe("0");
    expect(leerConfig(vars)).toMatchObject({ reservaCargaCreditos: 8400, recargoQr: { primera: 40_000_000, siguientes: 5_000_000 }, comprasQr: false, comprasQrTodos: false, altasPago: false, cuentaCobros: vars.CUENTA_COBROS, faltaAltas: [] });
  });

  it("con esos números, el primer paquete por QR sale 8 dólares: 4 del paquete y 4 de recargo; el de diez, 10,50 después", async () => {
    const m = montarPagos({ ...ABIERTA, PRECIOS: vars.PRECIOS as string, RECARGO_QR: vars.RECARGO_QR as string, RESERVA_CARGA_CREDITOS: vars.RESERVA_CARGA_CREDITOS as string, COMPRAS_QR_PILOTO: ANA });
    const ana = m.persona("usr_ana", ANA);
    expect(await m.empezar(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { permiso: { recargo: "4", total: "8", primera: true } } });
    await m.cargar(ana.token, "alta");
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "8", precio: "4", recargo: "4" } } });
    const recargo = m.cfg.recargoQr as NonNullable<typeof m.cfg.recargoQr>;
    expect(recargo.siguientes).toBe(5_000_000);
    expect(Number.isInteger(recargo.primera) && Number.isInteger(recargo.siguientes)).toBe(true);
  });
});
