// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bienvenida, EstadoDeAlta, ReclamoDelRegalo, ResultadoDeAlta } from "../stellar/alta-api";

/**
 * El regalo fuera del paso (`regaloDisponible` y `recibirRegalo` de `cuenta-lista-flujo.ts`), para la línea del cupo y
 * «Se te acabaron»: una sola lectura del estado por cuenta en la carga de la página, y nada fuera de Oficial con una
 * cuenta de Google o de correo. El servidor y la sesión son de mentira.
 */

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  cuenta: "GAAA",
  conReclamar: true,
  bienvenida: { estado: "lista", sorteos: 3 } as Bienvenida | null,
  accesoDelEstado: "cupon" as EstadoDeAlta["acceso"],
  estados: 0,
  reclamos: 0,
  refrescos: 0,
  /** Cómo contesta el estado: bien, con un error del servicio, o lanzando (sin red). */
  estadoFalla: null as null | "servicio" | "lanza",
  /** Cómo contesta el pedido del regalo: con los sorteos, sin sorteos (lleno), con un error o lanzando. */
  reclamo: "dado" as "dado" | "lleno" | "servicio" | "lanza",
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get network() {
      return { ...o.network, name: h.red };
    },
  };
});
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false, enPractica: () => false }));
vi.mock("../stellar/wallet-lite", () => ({
  activeWallet: () => ({ submitsItself: true, address: h.cuenta, estadoOficialLocal: () => ({}), estadoOficial: async () => ({}) }),
}));
vi.mock("../stellar/wallet-pollar", () => ({ pollarWallet: { label: "Google", tokenDeSesion: async () => "t", sesionViva: () => true } }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: h.cuenta, mail: "ana@mail.com" }) }));
vi.mock("./cuenta-lista-acceso", () => ({
  fuenteDelAcceso: () => {
    const sorteos = { quedan: 3, proximoVence: null };
    const estado = async (): Promise<ResultadoDeAlta<EstadoDeAlta>> => {
      h.estados++;
      if (h.estadoFalla === "lanza") throw new TypeError("Failed to fetch");
      if (h.estadoFalla === "servicio") return { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };
      const datos: EstadoDeAlta = {
        acceso: h.accesoDelEstado,
        cuenta: h.cuenta,
        abierta: true,
        pedido: null,
        sorteos,
        orden: null,
        fondeo: "inmediato",
      };
      return { ok: true, datos: h.bienvenida ? { ...datos, bienvenida: h.bienvenida } : datos };
    };
    const reclamar = async (): Promise<ResultadoDeAlta<ReclamoDelRegalo>> => {
      h.reclamos++;
      if (h.reclamo === "lanza") throw new TypeError("Failed to fetch");
      if (h.reclamo === "servicio") return { ok: false, clave: "altaSinActivarAhora", vars: {}, motivo: "altas-pausadas", estado: 503 };
      if (h.reclamo === "lleno") {
        const cero = { quedan: 0, proximoVence: null };
        return { ok: true, datos: { ok: true, repetido: false, sorteosSumados: 0, sorteos: cero, regalo: "lleno", sigue: "lista" } };
      }
      return { ok: true, datos: { ok: true, repetido: false, sorteosSumados: 3, sorteos, regalo: "dado", sigue: "lista" } };
    };
    return {
      estado,
      canjear: async () => ({ ok: false, clave: "x", vars: {}, motivo: "x", estado: 0 }),
      cuponGuardado: () => null,
      guardarCupon: () => undefined,
      olvidarCupon: () => undefined,
      refrescarCupo: () => void h.refrescos++,
      cuenta: () => h.cuenta,
      ...(h.conReclamar ? { reclamar } : {}),
    };
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.red = "mainnet";
  h.cuenta = "GAAA";
  h.conReclamar = true;
  h.bienvenida = { estado: "lista", sorteos: 3 };
  h.accesoDelEstado = "cupon";
  h.estados = 0;
  h.reclamos = 0;
  h.refrescos = 0;
  h.estadoFalla = null;
  h.reclamo = "dado";
});

const flujo = () => import("./cuenta-lista-flujo");

describe("el regalo fuera del paso", () => {
  it("listo: cuántos sorteos trae, con una sola lectura del estado por cuenta", async () => {
    const f = await flujo();
    expect(await f.regaloDisponible()).toBe(3);
    expect(await f.regaloDisponible()).toBe(3);
    expect(await f.regaloDisponible()).toBe(3);
    expect(h.estados).toBe(1);
  });

  it("con otra cuenta en la sesión, se pregunta por esa", async () => {
    const f = await flujo();
    await f.regaloDisponible();
    h.cuenta = "GBBB";
    await f.regaloDisponible();
    expect(h.estados).toBe(2);
  });

  it("lleno, sin el campo (el servicio de antes) o sin acceso: no hay regalo que ofrecer", async () => {
    for (const armar of [
      () => (h.bienvenida = { estado: "llena", sorteos: 3 }),
      () => (h.bienvenida = null),
      () => (h.accesoDelEstado = "ninguno"),
    ]) {
      vi.resetModules();
      h.bienvenida = { estado: "lista", sorteos: 3 };
      h.accesoDelEstado = "cupon";
      armar();
      const f = await flujo();
      expect(await f.regaloDisponible()).toBeNull();
    }
  });

  // Quien activó con el regalo lleno quedó con un alta que el servidor nombra `admin`: cuando el regalo vuelve a estar,
  // se le ofrece igual. `gratis` se tolera si llega.
  it.each(["admin", "gratis"] as const)("con el acceso %s y el regalo listo, cuántos sorteos trae", async (acceso) => {
    h.accesoDelEstado = acceso;
    const f = await flujo();
    expect(await f.regaloDisponible()).toBe(3);
  });

  it.each(["admin", "gratis"] as const)("con el acceso %s y el regalo lleno, no hay regalo que ofrecer", async (acceso) => {
    h.accesoDelEstado = acceso;
    h.bienvenida = { estado: "llena", sorteos: 3 };
    const f = await flujo();
    expect(await f.regaloDisponible()).toBeNull();
  });

  it("un acceso que no sabe pedir el regalo no pregunta nada", async () => {
    h.conReclamar = false;
    const f = await flujo();
    expect(await f.regaloDisponible()).toBeNull();
    expect(h.estados).toBe(0);
  });

  it("fuera de Oficial no pregunta nada", async () => {
    h.red = "testnet";
    const f = await flujo();
    expect(await f.regaloDisponible()).toBeNull();
    expect(h.estados).toBe(0);
  });

  it("«Recibirlos» lo pide una vez, refresca el cupo y no se vuelve a ofrecer en esta carga", async () => {
    const f = await flujo();
    expect(await f.regaloDisponible()).toBe(3);
    expect(await f.recibirRegalo()).toBe("dado");
    expect(h.reclamos).toBe(1);
    expect(h.refrescos).toBe(1);
    expect(await f.regaloDisponible()).toBeNull();
    expect(h.estados).toBe(1);
  });

  it("sin cómo pedirlo, «Recibirlos» no hace nada", async () => {
    h.conReclamar = false;
    const f = await flujo();
    expect(await f.recibirRegalo()).toBe("error");
    expect(h.reclamos).toBe(0);
  });

  it("si el servidor contestó sin sorteos, dice sin-sorteos y no se vuelve a ofrecer en esta carga", async () => {
    h.reclamo = "lleno";
    const f = await flujo();
    expect(await f.regaloDisponible()).toBe(3);
    expect(await f.recibirRegalo()).toBe("sin-sorteos");
    expect(await f.regaloDisponible()).toBeNull();
    expect(h.estados).toBe(1);
  });

  it("si el pedido no salió, dice error y la próxima lectura vuelve a preguntar", async () => {
    h.reclamo = "servicio";
    const f = await flujo();
    expect(await f.regaloDisponible()).toBe(3);
    expect(await f.recibirRegalo()).toBe("error");
    expect(await f.regaloDisponible()).toBe(3);
    expect(h.estados).toBe(2);
  });

  it("si el pedido lanza, dice error sin lanzar y el regalo se puede ofrecer de nuevo", async () => {
    h.reclamo = "lanza";
    const f = await flujo();
    expect(await f.recibirRegalo()).toBe("error");
    expect(await f.regaloDisponible()).toBe(3);
  });

  it("una lectura del estado con error no se recuerda: la siguiente pregunta de nuevo", async () => {
    h.estadoFalla = "servicio";
    const f = await flujo();
    expect(await f.regaloDisponible()).toBeNull();
    h.estadoFalla = null;
    expect(await f.regaloDisponible()).toBe(3);
    expect(h.estados).toBe(2);
  });

  it("una lectura del estado que lanza tampoco se recuerda", async () => {
    h.estadoFalla = "lanza";
    const f = await flujo();
    expect(await f.regaloDisponible()).toBeNull();
    h.estadoFalla = null;
    expect(await f.regaloDisponible()).toBe(3);
    expect(h.estados).toBe(2);
  });

  it("una lectura que salió bien sin regalo sí se recuerda", async () => {
    h.bienvenida = null;
    const f = await flujo();
    expect(await f.regaloDisponible()).toBeNull();
    expect(await f.regaloDisponible()).toBeNull();
    expect(h.estados).toBe(1);
  });
});

describe("si la cuenta nunca tuvo sorteos oficiales, de la misma lectura", () => {
  it.each([
    // El alta del regalo y la de quien ganó nacen sin sorteos: con el regalo sin recibir, nunca tuvo.
    ["admin", { estado: "lista", sorteos: 3 }, true],
    ["admin", { estado: "llena", sorteos: 3 }, true],
    ["premio", { estado: "llena", sorteos: 3 }, true],
    // Con el regalo ya recibido (o el servicio de antes, sin el campo), no se sabe.
    ["admin", null, null],
    // El cupón y la compra traen sorteos: tuvo, aunque el regalo siga sin recibir.
    ["cupon", { estado: "lista", sorteos: 3 }, false],
    ["pago", null, false],
    // Lo que no se conoce no se adivina.
    ["gratis", { estado: "lista", sorteos: 3 }, null],
    ["ninguno", { estado: "lista", sorteos: 3 }, null],
  ] as const)("con el acceso %s y el regalo %j: %s", async (acceso, bienvenida, nunca) => {
    h.accesoDelEstado = acceso;
    h.bienvenida = bienvenida;
    const f = await flujo();
    expect((await f.leerElRegalo()).nuncaTuvo).toBe(nunca);
    // Una sola lectura del estado para las dos preguntas.
    await f.regaloDisponible();
    expect(h.estados).toBe(1);
  });

  it("fuera de Oficial no se sabe y no pregunta nada", async () => {
    h.red = "testnet";
    h.accesoDelEstado = "admin";
    const f = await flujo();
    expect(await f.leerElRegalo()).toEqual({ disponible: null, nuncaTuvo: null });
    expect(h.estados).toBe(0);
  });

  it("al recibir el regalo ya tuvo, y si no llegó sigue sin tener", async () => {
    h.accesoDelEstado = "admin";
    const f = await flujo();
    expect((await f.leerElRegalo()).nuncaTuvo).toBe(true);
    expect(await f.recibirRegalo()).toBe("dado");
    expect(await f.leerElRegalo()).toEqual({ disponible: null, nuncaTuvo: false });
    vi.resetModules();
    h.reclamo = "lleno";
    const g = await flujo();
    expect((await g.leerElRegalo()).nuncaTuvo).toBe(true);
    expect(await g.recibirRegalo()).toBe("sin-sorteos");
    expect(await g.leerElRegalo()).toEqual({ disponible: null, nuncaTuvo: true });
  });
});
