// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Escucha, Sala } from "../sala/cliente";

const h = vi.hoisted(() => ({
  app: { frozen: null as unknown },
  escucha: null as Escucha | null,
  resolver: null as ((nombre: string | null) => void) | null,
}));

vi.mock("../state", () => ({ app: h.app }));
vi.mock("../ensayo-modo", () => ({ enStand: () => true }));
vi.mock("../i18n", () => ({ onLangChange: () => undefined, t: (k: string) => k }));
vi.mock("../sala/cifra", () => ({
  descifrarNombre: () =>
    new Promise<string | null>((resolver) => {
      h.resolver = resolver;
    }),
}));
vi.mock("../sala/cliente", () => ({
  cerrarSala: vi.fn(async () => true),
  crearSala: vi.fn(),
  enlaceDeSala: (s: Sala) => `${s.servicio}/${s.id}#${s.clave}`,
  escucharSala: (_s: Sala, e: Escucha) => {
    h.escucha = e;
    return { parar: () => undefined };
  },
  quitarNombreEnSala: vi.fn(async () => true),
}));
vi.mock("./participants", () => ({
  setList: (texto: string) => {
    (document.getElementById("ta") as HTMLTextAreaElement).value = texto;
  },
}));
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));
vi.mock("./stand", () => ({ alSalirDelStand: () => undefined, nombresParaLaSiguiente: () => undefined }));

import { initStandSala } from "./stand-sala";

const SALA: Sala = { id: "AbCd1234", token: "T".repeat(22), clave: "A".repeat(22), vence: Date.now() + 60_000, servicio: "https://sala.test" };

afterEach(() => sessionStorage.clear());

describe("quitar un nombre de la pantalla del stand", () => {
  it("un quitado que llega durante el descifrado no deja entrar el nombre viejo", async () => {
    document.body.innerHTML = `
      <textarea id="ta"></textarea>
      <div id="stand-sala">
        <button id="sala-crear"></button><button id="sala-cerrar"></button><button id="sala-grande"></button>
        <div id="sala-cerrada"></div><div id="sala-abierta"></div><p id="sala-error"></p>
        <img id="sala-qr-img"><p id="sala-estado"></p><p id="sala-cuenta"></p>
        <ul id="sala-nombres"></ul><div id="sala-revisar"></div><ul id="sala-revisar-lista"></ul>
      </div>`;
    sessionStorage.setItem("tinkazo.sala", JSON.stringify({ sala: SALA, dejados: [] }));
    initStandSala();
    document.dispatchEvent(new Event("tinkazo:stand"));
    expect(h.escucha).not.toBeNull();
    const escucha = h.escucha as Escucha;
    escucha.alNombre(7, "dato");
    expect(h.resolver).not.toBeNull();
    escucha.alQuitado?.(7);
    h.resolver?.("Ana");
    await Promise.resolve();
    await Promise.resolve();
    expect((document.getElementById("ta") as HTMLTextAreaElement).value).toBe("");
    expect(document.getElementById("sala-nombres")?.textContent).not.toContain("Ana");
    expect(document.getElementById("sala-revisar-lista")?.textContent).not.toContain("Ana");
    expect(document.getElementById("sala-cuenta")?.textContent).toBe("standSalaVacia");
  });
});
