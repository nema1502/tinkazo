// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoDelPatrocinio } from "../stellar/patrocinador";

/**
 * La línea del cupo y sus dos líneas hermanas, con el cobro por uso del modo Oficial prendido y apagado. El portero y la
 * cuenta son de mentira.
 */

const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const h = vi.hoisted(() => ({
  cobro: true,
  pago: false,
  sesion: { kind: "external", address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H" } as { kind: string; address: string; aMano?: boolean } | null,
  estados: [] as unknown[],
  consultas: 0,
}));

vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false }));
vi.mock("../stellar/cobro-oficial", () => ({ cobroPorUso: () => h.cobro }));
vi.mock("../stellar/alta-config", () => ({ altaPagoActivo: () => h.pago }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("../stellar/patrocinador", async (orig) => {
  const real = await orig<typeof import("../stellar/patrocinador")>();
  return {
    ...real,
    urlDelPortero: () => "https://pm.ejemplo",
    estadoDelPatrocinio: async () => {
      h.consultas++;
      return h.estados.shift() ?? h.estados[0];
    },
  };
});

// Cada prueba arranca con los módulos nuevos: `iniciarCupo` deja oyentes en la página y en el cambio de idioma.
let app: (typeof import("../state"))["app"];
let iniciarCupo: (typeof import("./cupo-patrocinio"))["iniciarCupo"];
let setLang: (typeof import("../i18n"))["setLang"];

function portero(quedan: number, sellos = 50): EstadoDelPatrocinio {
  return {
    rige: "portero",
    cupo: { sellos: { usados: 0, max: 100, quedan: sellos }, sorteos: { usados: 0, max: 200, quedan: 100 }, liberaEn: Date.UTC(2026, 11, 1) },
    oficial: { acceso: true, sorteos: { quedan, proximoVence: { fecha: Date.UTC(2027, 0, 14, 16), cuantos: 3 } } },
  };
}

const sinOficial = (): EstadoDelPatrocinio => {
  const e = portero(5) as Extract<EstadoDelPatrocinio, { rige: "portero" }>;
  const { oficial: _o, ...resto } = e;
  return { ...resto, cupo: { ...e.cupo, sellos: { usados: 2, max: 20, quedan: 18 } } };
};

const texto = (id: string): string | null => {
  const el = document.getElementById(id);
  return el && el.style.display !== "none" ? el.textContent : null;
};
const esperar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sesionEvento = (): void => void document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
const ganan = (n: number): void => {
  const nw = document.getElementById("nw") as HTMLInputElement;
  nw.value = String(n);
  nw.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(async () => {
  vi.resetModules();
  ({ app } = await import("../state"));
  ({ iniciarCupo } = await import("./cupo-patrocinio"));
  ({ setLang } = await import("../i18n"));
  document.body.innerHTML = '<input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-row"><div id="again-acciones"></div></div><div id="names"></div>';
  h.cobro = true;
  h.pago = false;
  h.sesion = { kind: "external", address: CUENTA };
  h.estados = [portero(13)];
  h.consultas = 0;
  app.frozen = null;
});
afterEach(() => {
  app.frozen = null;
});

describe("el cupo oficial a la vista", () => {
  it("la línea dice cuántos sorteos oficiales quedan y cuándo vencen, y una nota dice cuánto gasta cada premio", async () => {
    iniciarCupo();
    await esperar();
    expect(texto("cupo-linea")).toBe("Te quedan 13 sorteos oficiales. 3 vencen el 14 de enero.");
    expect(texto("cupo-uso")).toBe("Cada premio que sorteás de a uno usa un sorteo. Si son iguales, poné cuántos ganan y es uno solo.");
    expect(document.getElementById("cupo-linea")?.nextElementSibling?.id).toBe("cupo-uso");
  });

  it("con más de 50 ganadores la nota dice que el sorteo usa 2, y vuelve al bajar", async () => {
    iniciarCupo();
    await esperar();
    ganan(51);
    expect(texto("cupo-uso")).toBe("Con más de 50 ganadores, este sorteo usa 2.");
    ganan(50);
    expect(texto("cupo-uso")).toBe("Cada premio que sorteás de a uno usa un sorteo. Si son iguales, poné cuántos ganan y es uno solo.");
  });

  it("con la lista sellada, la línea se esconde, se vuelve a preguntar y «Siguiente premio» dice cuántos quedan", async () => {
    iniciarCupo();
    await esperar();
    expect(h.consultas).toBe(1);
    h.estados = [portero(12)];
    app.frozen = { names: ["a", "b"], listHash: "x", ts: 0, at: "-", prize: "", round: 1 } as never;
    document.getElementById("names")?.appendChild(document.createElement("span"));
    await esperar();
    await esperar();
    expect(h.consultas).toBe(2);
    expect(texto("cupo-linea")).toBeNull();
    expect(texto("cupo-uso")).toBeNull();
    expect(texto("cupo-siguiente")).toBe("Te quedan 12 sorteos oficiales.");
    expect(document.getElementById("again-acciones")?.nextElementSibling?.id).toBe("cupo-siguiente");
  });

  it("no usa el número de antes del sello mientras llega el de ahora", async () => {
    iniciarCupo();
    await esperar();
    h.estados = [portero(12)];
    app.frozen = { names: ["a", "b"], listHash: "x", ts: 0, at: "-", prize: "", round: 1 } as never;
    document.getElementById("names")?.appendChild(document.createElement("span"));
    expect(texto("cupo-siguiente")).toBeNull();
  });

  it("con cero sorteos lo dice y no pone la nota de cuánto gasta cada premio", async () => {
    h.estados = [portero(0)];
    iniciarCupo();
    await esperar();
    expect(texto("cupo-linea")).toBe("Se te acabaron los sorteos oficiales. Usá otro cupón o seguí gratis en Prueba.");
    expect(texto("cupo-uso")).toBeNull();
  });

  it("con cero sorteos la línea pesa como un aviso, no como una nota gris; con uno o más, vuelve a ser nota", async () => {
    h.estados = [portero(0)];
    iniciarCupo();
    await esperar();
    const linea = document.getElementById("cupo-linea") as HTMLElement;
    expect(linea.classList.contains("cupo-linea--cero")).toBe(true);
    document.dispatchEvent(new CustomEvent("tinkazo:patrocinio", { detail: { cuenta: CUENTA, estado: portero(1) } }));
    expect(linea.classList.contains("cupo-linea--cero")).toBe(false);
    // Con el cobro por uso apagado nunca.
    h.cobro = false;
    document.dispatchEvent(new CustomEvent("tinkazo:patrocinio", { detail: { cuenta: CUENTA, estado: portero(0) } }));
    expect(linea.classList.contains("cupo-linea--cero")).toBe(false);
  });

  it("en inglés", async () => {
    iniciarCupo();
    await esperar();
    setLang("en");
    expect(texto("cupo-linea")).toBe("You have 13 Live draws left. 3 expire on January 14.");
    setLang("es");
  });

  it("con el cobro por uso apagado la línea es la de siempre y no aparece ninguna otra", async () => {
    h.cobro = false;
    h.estados = [sinOficial()];
    iniciarCupo();
    await esperar();
    expect(texto("cupo-linea")).toBe("Te quedan 18 sorteos gratis este mes.");
    expect(document.getElementById("cupo-uso")).toBeNull();
    expect(document.getElementById("cupo-siguiente")).toBeNull();
    app.frozen = { names: ["a", "b"], listHash: "x", ts: 0, at: "-", prize: "", round: 1 } as never;
    document.getElementById("names")?.appendChild(document.createElement("span"));
    await esperar();
    expect(h.consultas).toBe(1);
    expect(document.getElementById("cupo-siguiente")).toBeNull();
  });

  it("con el cobro por uso, un portero que no manda lo oficial no muestra «sorteos gratis este mes»", async () => {
    h.estados = [sinOficial()];
    iniciarCupo();
    await esperar();
    expect(texto("cupo-linea")).toBeNull();
  });

  it("con una billetera propia no hay ninguna línea", async () => {
    h.sesion = { kind: "external", address: CUENTA, aMano: true };
    iniciarCupo();
    await esperar();
    sesionEvento();
    await esperar();
    expect(texto("cupo-linea")).toBeNull();
    expect(document.getElementById("cupo-uso")).toBeNull();
  });
});
