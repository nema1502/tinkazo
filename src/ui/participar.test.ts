// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campana } from "../campana/modelo";
import { abrirElPremioDeLaCampana, type DepsDelPremioDelCelular } from "./participar";
import type { DepsDePremio } from "./premio-recibir";

/**
 * La entrada del premio desde el celular de una campaña (`participar.html`): el gancho de «si ganó» que
 * dejó el registro (#172) abre la pantalla del ganador con los datos de la campaña y la cuenta de la
 * sesión, detrás de la bandera de campañas. Sin sesión o sin contrato de premios, no abre nada.
 */

const CUENTA = "GCCIWHCU5XZ4VAK2GAFJBBTJJXIWPWBPK56JOGEPS6N6LP7AYLILD7F3";

const campana = (premios: Partial<Pick<Campana, "contrato" | "promo" | "recibirHastaMs">> = {}): Campana =>
  ({
    v: 1,
    evento: "feria",
    red: "testnet",
    estado: "sorteada",
    empresa: { nombre: "La Feria", logo: null, color: null },
    lugar: { es: "La plaza", en: "The square" },
    zona: "America/La_Paz",
    premios: [100000000n],
    abreMs: 1,
    cierraMs: 2,
    sorteoMs: 3,
    entrada: "google",
    pasos: [],
    bases: { es: "bases", en: "bases" },
    anotadas: 10,
    contrato: "CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY",
    promo: "8",
    comprobante: null,
    ...premios,
  }) as unknown as Campana;

const h = vi.hoisted(() => ({ premios: vi.fn() }));

const deps = (): Partial<DepsDePremio> => ({
  premios: h.premios.mockResolvedValue({ ok: true, premios: [{ puesto: 0, monto: "100000000", estado: "por-recibir", hastaMs: 1_800_000_000_000 }] }),
  activar: vi.fn().mockResolvedValue("activada"),
  fecha: () => "16/12/2026",
  cada: () => () => undefined,
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_CAMPANAS", "1");
  document.body.replaceChildren();
});

describe("la entrada del premio desde el celular", () => {
  it("abre la pantalla con los datos de la campaña y la cuenta de la sesión", async () => {
    const d: DepsDelPremioDelCelular = { campana: campana(), cuenta: CUENTA };
    expect(abrirElPremioDeLaCampana(d, deps())).toBe(true);
    // La primera lectura de la red (de mentira) ya quedó pintada. La pantalla va en diferido (un
    // import() dinámico): se espera a que los import dinámicos resuelvan antes de mirar el DOM.
    await vi.dynamicImportSettled();
    const raiz = document.querySelector<HTMLElement>('[data-premio="ventana"]');
    expect(raiz).not.toBeNull();
    expect(raiz?.querySelector('[data-premio="gano-titulo"]')).not.toBeNull();
  });

  it("con la bandera apagada no abre nada", () => {
    vi.stubEnv("VITE_CAMPANAS", "0");
    expect(abrirElPremioDeLaCampana({ campana: campana(), cuenta: CUENTA }, deps())).toBe(false);
    expect(document.querySelector('[data-premio="ventana"]')).toBeNull();
  });

  it("una campaña sin premio o sin contrato de premios no abre la pantalla", () => {
    expect(abrirElPremioDeLaCampana({ campana: campana({ promo: null }), cuenta: CUENTA }, deps())).toBe(false);
    expect(abrirElPremioDeLaCampana({ campana: campana({ contrato: null }), cuenta: CUENTA }, deps())).toBe(false);
    expect(document.querySelector('[data-premio="ventana"]')).toBeNull();
  });

  it("sin sesión (quien entró desde otro equipo todavía no entró acá) no abre nada", () => {
    expect(abrirElPremioDeLaCampana({ campana: campana(), cuenta: null }, deps())).toBe(false);
    expect(document.querySelector('[data-premio="ventana"]')).toBeNull();
  });
});
