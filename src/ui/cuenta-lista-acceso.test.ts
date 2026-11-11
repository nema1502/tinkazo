import { beforeEach, describe, expect, it, vi } from "vitest";
import { banderasDeAlta } from "../stellar/alta-config";

/**
 * De dónde saca el paso el acceso al modo Oficial (`cuenta-lista-acceso.ts`): el modo según la red y las banderas del
 * build (W3), y el acceso de verdad, que sin el token de la sesión verificada no le pregunta nada a nadie.
 */

const h = vi.hoisted(() => ({ olvidar: vi.fn(), estado: vi.fn(async () => ({ rige: "pollar", configurado: false })) }));
vi.mock("../stellar/patrocinador", () => ({ olvidarElEstado: () => h.olvidar(), estadoDelPatrocinio: (...a: unknown[]) => h.estado(...(a as [])) }));

const { accesoDelServidor, fuenteDelAcceso, modoDelAcceso } = await import("./cuenta-lista-acceso");

const URL_PORTERO = "https://pm.prueba.invalid";
const TOKEN = "token-de-la-sesion-de-prueba-0123456789";
const PORTERO = "https://pm.tinkazo.app";

beforeEach(() => {
  h.olvidar.mockReset();
  h.estado.mockClear();
});

describe("el modo del acceso (W3)", () => {
  it.each([
    ["testnet", {}, "libre"],
    ["testnet", { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO }, "libre"],
    ["mainnet", {}, "cerrado"],
    ["mainnet", { VITE_ALTA: "0" }, "cerrado"],
    // La bandera a medio poner (sin la dirección del portero) no abre nada.
    ["mainnet", { VITE_ALTA: "1" }, "cerrado"],
    ["mainnet", { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO }, "servidor"],
    ["mainnet", { VITE_ALTA_LIBRE: "1" }, "libre"],
    // Las dos juntas activarían sin acceso: el plan B1 no vale con el acceso por cupón, y pregunta al servidor.
    ["mainnet", { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO, VITE_ALTA_LIBRE: "1" }, "servidor"],
    ["mainnet", { VITE_ALTA: "1", VITE_ALTA_LIBRE: "1" }, "cerrado"],
  ] as const)("%s con %j: %s", (red, env, modo) => {
    expect(modoDelAcceso(red, banderasDeAlta(env, red))).toBe(modo);
  });

  it("con el acceso por cupón apagado y sin el plan B1, en la red principal no hay de dónde activar", () => {
    expect(modoDelAcceso("mainnet", { alta: false, libre: false, pago: false, sorteoServidor: false })).toBe("cerrado");
  });

  it("lo que recibe el paso: el servidor, o cómo se porta sin él", () => {
    const sesion = { token: async () => TOKEN, sesionViva: () => true, cuenta: () => "GAAA" };
    expect(fuenteDelAcceso(sesion, "cerrado")).toBe("cerrado");
    expect(fuenteDelAcceso(sesion, "libre")).toBe("libre");
    expect(typeof fuenteDelAcceso(sesion, "servidor")).toBe("object");
  });
});

describe("el acceso del servidor", () => {
  const respuesta = (cuerpo: unknown, estado = 200) => ({ status: estado, json: async () => cuerpo }) as unknown as Response;

  it("sin token no se le pregunta nada: con la sesión abierta, «probá de nuevo»; cerrada, entrar de nuevo", async () => {
    const f = vi.fn(async () => respuesta({}));
    const viva = accesoDelServidor({ token: async () => null, sesionViva: () => true, cuenta: () => "GAAA" }, { url: URL_PORTERO, fetch: f });
    expect(await viva.estado()).toMatchObject({ ok: false, clave: "altaErrServicio", motivo: "sin-token" });
    expect(await viva.canjear("K7M29QXA4HTR")).toMatchObject({ ok: false, clave: "altaErrServicio" });
    const muerta = accesoDelServidor({ token: async () => null, sesionViva: () => false, cuenta: () => "GAAA" }, { url: URL_PORTERO, fetch: f });
    expect(await muerta.estado()).toMatchObject({ ok: false, clave: "clErrSesion" });
    // Si pedir el token se rompe, tampoco.
    const rota = accesoDelServidor({ token: async () => Promise.reject(new Error("x")), sesionViva: () => true, cuenta: () => null }, { url: URL_PORTERO, fetch: f });
    expect(await rota.canjear("K7M29QXA4HTR")).toMatchObject({ ok: false });
    expect(f).not.toHaveBeenCalled();
  });

  it("con token: va solo en la cabecera, y el cupón en el cuerpo, nunca en la dirección", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => respuesta({ ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }));
    const a = accesoDelServidor({ token: async () => TOKEN, sesionViva: () => true, cuenta: () => "GAAA" }, { url: URL_PORTERO, fetch: f as unknown as typeof fetch });
    const r = await a.canjear("K7M29QXA4HTR");
    expect(r).toMatchObject({ ok: true, datos: { sigue: "activar", sorteosSumados: 3 } });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(`${URL_PORTERO}/v1/alta/cupon`);
    expect(String(url)).not.toContain(TOKEN);
    expect(String(url)).not.toContain("K7M2");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({ cupon: "K7M29QXA4HTR" });
  });

  it("si el servidor ata el acceso a otra cuenta que la de la sesión, se dice como «cuenta de otro», sin la cuenta en el texto", async () => {
    const SESION = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const OTRA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
    const cuerpo = (cuenta: string | null) => ({ acceso: "cupon", cuenta, abierta: true, pedido: null, sorteos: { quedan: 3, proximoVence: null }, orden: null, fondeo: "inmediato" });
    const otra = accesoDelServidor({ token: async () => TOKEN, sesionViva: () => true, cuenta: () => SESION }, { url: URL_PORTERO, fetch: vi.fn(async () => respuesta(cuerpo(OTRA))) as unknown as typeof fetch });
    const r = await otra.estado();
    expect(r).toMatchObject({ ok: false, clave: "altaErrCuentaDeOtro", motivo: "cuenta-de-otro" });
    expect(JSON.stringify(r)).not.toContain(OTRA);
    expect(JSON.stringify(r)).not.toContain(SESION);
    // La misma cuenta, o una que el servidor todavía no ató (sin billetera), sigue como siempre.
    for (const c of [SESION, null]) {
      const a = accesoDelServidor({ token: async () => TOKEN, sesionViva: () => true, cuenta: () => SESION }, { url: URL_PORTERO, fetch: vi.fn(async () => respuesta(cuerpo(c))) as unknown as typeof fetch });
      expect(await a.estado(), String(c)).toMatchObject({ ok: true, datos: { acceso: "cupon" } });
    }
  });

  it("refrescar el cupo olvida lo recordado y pregunta de nuevo, forzado, por la cuenta de la sesión", () => {
    const a = accesoDelServidor({ token: async () => TOKEN, sesionViva: () => true, cuenta: () => "GBBB" });
    a.refrescarCupo();
    expect(h.olvidar).toHaveBeenCalledTimes(1);
    expect(h.estado).toHaveBeenCalledWith("GBBB", { forzar: true });
  });
});
