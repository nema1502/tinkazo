// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoDelPatrocinio } from "../stellar/patrocinador";

/**
 * Con las banderas de la venta prendidas (como se publican), la marca del piloto que se va con la página abierta: vence
 * a las seis horas, o se saca con ?piloto=no en otra pestaña del mismo navegador. Desde ese momento la línea del cupo es
 * la de producción: sin Sumar sorteos al lado y sin ofrecer sumar, apenas se vuelve a pintar. Lo que se leyó de la oferta
 * mientras la marca valía no alcanza para seguir mostrando la compra.
 *
 * La puerta del piloto, las banderas y la oferta son las de verdad (`venta-piloto.ts`, `alta-config.ts`, `alta-oferta.ts`),
 * con el entorno del build puesto a mano y un portero de mentira. Cada caso carga los módulos de nuevo, como una página
 * nueva.
 */

const PORTERO = "https://pm.tinkazo.app";
const PRENDIDAS: Record<string, string> = { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO, VITE_ALTA_PAGO: "1", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1", VITE_VENTA_ABIERTA: "" };
const CLAVE = "tinkazo.venta.piloto";
const HORA = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 14, 9);
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const PRECIOS = { red: "mainnet", pago: true, alta: { usdc: "4", sorteos: 3, dias: 90, pausado: false }, paquetes: [{ id: "p10", usdc: "10", sorteos: 10, dias: 365, pausado: false }] };
const PAGINA = '<main id="pagina"><input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-acciones"></div><div id="names"></div></main>';

const h = vi.hoisted(() => ({
  estado: null as unknown,
  preguntas: 0,
}));

vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: { ...real.network, name: "mainnet" } };
});
// La oferta de verdad, con un portero de mentira que vende un paquete y cuenta cuántas veces le preguntan.
vi.mock("../stellar/alta-oferta", async (orig) => {
  const real = await orig<typeof import("../stellar/alta-oferta")>();
  const porteroFalso = (async () => {
    h.preguntas++;
    return new Response(JSON.stringify(PRECIOS), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { ...real, leerOferta: (o: Parameters<typeof real.leerOferta>[0] = {}) => real.leerOferta({ fetch: porteroFalso, url: PORTERO, ...o }) };
});
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false, enPractica: () => false }));
vi.mock("../stellar/cobro-oficial", () => ({ cobroPorUso: () => true, redPrincipalConPollar: () => true, esCuentaDePollar: () => true }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ kind: "external", address: CUENTA }) }));
vi.mock("../stellar/patrocinador", async (orig) => ({
  ...(await orig<typeof import("../stellar/patrocinador")>()),
  urlDelPortero: () => PORTERO,
  estadoDelPatrocinio: async () => h.estado,
}));

function portero(quedan: number): EstadoDelPatrocinio {
  return {
    rige: "portero",
    cupo: { sellos: { usados: 0, max: 100, quedan: 50 }, sorteos: { usados: 0, max: 200, quedan: 100 }, liberaEn: Date.UTC(2026, 11, 1) },
    oficial: { acceso: true, sorteos: { quedan, proximoVence: null } },
  };
}

const visible = (el: HTMLElement | null): boolean => !!el && el.style.display !== "none" && !el.closest("[hidden]");
const botonDeSumar = (): HTMLElement | null => document.querySelector<HTMLElement>('button[data-accion="comprar"]');
const linea = (): string => document.getElementById("cupo-linea")?.textContent ?? "";
const pasa = (ms = 30): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
/** Lo que vuelve a pintar la línea sin preguntarle nada al portero: cambiar cuántos ganan. */
const repintar = (): void => void document.getElementById("nw")?.dispatchEvent(new Event("input"));

/** Una página nueva con las banderas prendidas, con la marca del piloto puesta a la hora `marca` (o sin marca). */
async function pagina(marca: number | null, quedan: number) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(PRENDIDAS)) vi.stubEnv(k, v);
  localStorage.clear();
  if (marca !== null) localStorage.setItem(CLAVE, String(marca));
  document.body.innerHTML = PAGINA;
  h.estado = portero(quedan);
  h.preguntas = 0;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  const state = await import("../state");
  state.app.frozen = null;
  const cupo = await import("./cupo-patrocinio");
  const config = await import("../stellar/alta-config");
  const { lineaDelCupoOficial } = await import("../stellar/cupo-oficial");
  cupo.iniciarCupo();
  await pasa();
  return { config, produccion: () => lineaDelCupoOficial(portero(quedan), "es", i18n.t, { pago: false }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("con las banderas prendidas, la marca del piloto que se va con la página abierta", () => {
  for (const quedan of [2, 1, 0]) {
    it(`vence a las seis horas: con ${quedan} sorteos, Sumar sorteos se va y la línea es la de producción`, async () => {
      const p = await pagina(T0, quedan);
      // Con la marca, el piloto: el botón al lado de la línea.
      expect(p.config.altaPagoActivo()).toBe(true);
      expect(visible(botonDeSumar())).toBe(true);
      vi.setSystemTime(T0 + 6 * HORA);
      repintar();
      await pasa();
      expect(p.config.altaPagoActivo()).toBe(false);
      expect(visible(botonDeSumar())).toBe(false);
      expect(linea()).toBe(p.produccion());
    });

    it(`se saca en otra pestaña: con ${quedan} sorteos, lo mismo`, async () => {
      const p = await pagina(T0, quedan);
      expect(visible(botonDeSumar())).toBe(true);
      localStorage.removeItem(CLAVE);
      repintar();
      await pasa();
      expect(visible(botonDeSumar())).toBe(false);
      expect(linea()).toBe(p.produccion());
    });
  }

  it("sin la marca desde la carga: ni una pregunta al portero por lo que se vende, ni botón, y la línea de producción", async () => {
    for (const quedan of [5, 2, 0]) {
      const p = await pagina(null, quedan);
      expect(h.preguntas, String(quedan)).toBe(0);
      expect(botonDeSumar(), String(quedan)).toBeNull();
      expect(linea(), String(quedan)).toBe(p.produccion());
    }
  });
});
