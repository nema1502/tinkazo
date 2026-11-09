// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { app } from "../state";
import { FIRST_OFFICIAL_KEY, confirmarPrimerSelloOficial, marcarSellandoAhora } from "./modo-ui";

/**
 * La confirmación de la primera vez que se sella en Oficial, con el diálogo de verdad. Va antes de cerrar la lista y de
 * tocar la red (`freeze.ts`), así que acá se mira lo que decide: sellar sigue, "Pasar a Prueba" y cerrar frenan, y
 * una vez confirmada no vuelve a preguntar.
 */

const h = vi.hoisted(() => ({ red: "mainnet" as "mainnet" | "testnet", cambios: [] as string[] }));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    network: {
      ...o.network,
      get name() {
        return h.red;
      },
    },
    changeMode: (r: string) => {
      h.cambios.push(r);
      return true;
    },
  };
});

const boton = (texto: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>(".dlg-card button")].find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay un botón "${texto}"`);
  return b;
};
const hayDialogo = (): boolean => document.querySelector(".dlg-card") !== null;

/** Si la promesa ya se resolvió (y con qué), sin esperar de más. */
async function estado(p: Promise<boolean>): Promise<boolean | "pendiente"> {
  return Promise.race([p, new Promise<"pendiente">((r) => setTimeout(() => r("pendiente"), 20))]);
}

beforeEach(() => {
  h.red = "mainnet";
  h.cambios = [];
  app.frozen = null;
  app.drawn = null;
  marcarSellandoAhora(false);
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("la confirmación del primer sello en Oficial", () => {
  it("espera a la persona: no se resuelve sola, y al tocar Sellar sigue y recuerda que ya se confirmó", async () => {
    const p = confirmarPrimerSelloOficial();
    expect(hayDialogo()).toBe(true);
    expect(document.querySelector(".dlg-h")?.textContent).toBe(T.es.firstOfficialTitle);
    expect(await estado(p)).toBe("pendiente");
    boton(T.es.firstOfficialSeal as string).click();
    expect(await p).toBe(true);
    expect(localStorage.getItem(FIRST_OFFICIAL_KEY)).not.toBeNull();
    expect(hayDialogo()).toBe(false);
    expect(h.cambios).toEqual([]);
  });

  it("\"Pasar a Prueba\" no sella: resuelve falso, pide el modo de Prueba y no deja marcada la confirmación", async () => {
    const p = confirmarPrimerSelloOficial();
    boton(T.es.firstOfficialToTest as string).click();
    expect(await p).toBe(false);
    expect(h.cambios).toEqual(["testnet"]);
    expect(localStorage.getItem(FIRST_OFFICIAL_KEY)).toBeNull();
    expect(hayDialogo()).toBe(false);
  });

  it("cerrar el diálogo no sella ni cambia de modo, y se vuelve a preguntar la próxima vez", async () => {
    const p = confirmarPrimerSelloOficial();
    document.querySelector<HTMLButtonElement>('.dlg-card [data-dlg="x"]')?.click();
    expect(await p).toBe(false);
    expect(h.cambios).toEqual([]);
    expect(localStorage.getItem(FIRST_OFFICIAL_KEY)).toBeNull();
    const otra = confirmarPrimerSelloOficial();
    expect(hayDialogo()).toBe(true);
    expect(await estado(otra)).toBe("pendiente");
  });

  it("Escape cierra el diálogo como cerrarlo: no sella", async () => {
    const p = confirmarPrimerSelloOficial();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await p).toBe(false);
    expect(h.cambios).toEqual([]);
  });

  it("ya confirmada en este navegador, sella sin preguntar", async () => {
    localStorage.setItem(FIRST_OFFICIAL_KEY, "1");
    expect(await confirmarPrimerSelloOficial()).toBe(true);
    expect(hayDialogo()).toBe(false);
  });

  it("en Prueba no pregunta nunca", async () => {
    h.red = "testnet";
    expect(await confirmarPrimerSelloOficial()).toBe(true);
    expect(hayDialogo()).toBe(false);
  });

  it("la respuesta se da una sola vez: tocar Sellar y que el diálogo se cierre no la cambia", async () => {
    const p = confirmarPrimerSelloOficial();
    boton(T.es.firstOfficialSeal as string).click();
    // El cierre del diálogo avisa de nuevo (`onCerrar`), pero ya se contestó que sí.
    expect(await p).toBe(true);
  });
});
