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
  parseNames: () => (document.getElementById("ta") as HTMLTextAreaElement).value.split("\n").filter((l) => l.trim()),
  setList: (texto: string) => {
    (document.getElementById("ta") as HTMLTextAreaElement).value = texto;
  },
}));
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));
vi.mock("./stand", () => ({
  alAvisarEnStand: () => undefined,
  alPreguntarPorElQr: () => undefined,
  alSalirDelStand: () => undefined,
  nombresParaLaSiguiente: () => undefined,
  otraRonda: vi.fn(),
  repintarGuia: () => undefined,
  soltarResultadoDelStand: vi.fn(() => true),
}));

import { initStandSala } from "./stand-sala";

const SALA: Sala = { id: "AbCd1234", token: "T".repeat(22), clave: "A".repeat(22), vence: Date.now() + 60_000, servicio: "https://sala.test" };

afterEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
});

/** La página mínima de la sala, con el botón de empezar la ronda y la alternativa de escribir a mano. */
function armarPagina(): void {
  document.body.innerHTML = `
    <textarea id="ta"></textarea>
    <button id="btn-freeze" class="ghost"></button>
    <div id="stand-sala">
      <button id="sala-cerrar"></button><button id="sala-grande"></button>
      <div id="sala-cerrada">
        <button id="sala-crear"></button>
        <button id="stand-a-mano"></button>
      </div>
      <div id="sala-abierta"></div><p id="sala-error"></p>
      <img id="sala-qr-img"><p id="sala-estado"></p><p id="sala-cuenta"></p>
      <ul id="sala-nombres"></ul><div id="sala-revisar"></div><ul id="sala-revisar-lista"></ul>
    </div>`;
}

describe("quitar un nombre de la pantalla del stand", () => {
  it("un quitado que llega durante el descifrado no deja entrar el nombre viejo", async () => {
    armarPagina();
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

describe("el botón de color del stand", () => {
  it("con menos de dos personas, Mostrar el QR es el de color", () => {
    armarPagina();
    initStandSala();
    const boton = document.getElementById("sala-crear") as HTMLButtonElement;
    expect(boton.classList.contains("primary")).toBe(true);
    expect(boton.classList.contains("ghost")).toBe(false);
  });

  it("al entrar al stand con la lista vacía, Mostrar el QR queda con color", () => {
    armarPagina();
    initStandSala();
    const boton = document.getElementById("sala-crear") as HTMLButtonElement;
    boton.className = "ghost";
    document.dispatchEvent(new Event("tinkazo:stand"));
    expect(boton.classList.contains("primary")).toBe(true);
    expect(boton.classList.contains("ghost")).toBe(false);
  });

  it("con dos o más personas, el color pasa a Empezar la ronda", () => {
    armarPagina();
    initStandSala();
    const empezar = document.getElementById("btn-freeze") as HTMLButtonElement;
    empezar.className = "primary";
    document.dispatchEvent(new Event("tinkazo:paso"));
    const boton = document.getElementById("sala-crear") as HTMLButtonElement;
    expect(boton.classList.contains("ghost")).toBe(true);
    expect(boton.classList.contains("primary")).toBe(false);
  });

  it("escribir los nombres a mano lleva el foco al cuadro", () => {
    armarPagina();
    initStandSala();
    (document.getElementById("stand-a-mano") as HTMLButtonElement).click();
    expect(document.activeElement).toBe(document.getElementById("ta"));
  });
});
