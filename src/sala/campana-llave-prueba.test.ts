import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIDA_CAMPANA_MS, vidaDeCampana } from "../../workers/sala/src/campana";
import { esPedidoLocal, llaveDeCampanas, LLAVE_CAMPANAS_HEX } from "../../workers/sala/src/firma";
import { campanaDePrueba, firmarParaLaPrueba, montarMundo, type MundoDeSala } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * La llave de prueba reemplaza a la de Tinkazo solo en el servidor de desarrollo de esta máquina. En un Worker desplegado,
 * dos variables olvidadas no pueden dejar que firme campañas quien tenga la privada de prueba.
 */
const PRUEBA = "ab".repeat(32);
const OFICIAL = "cd".repeat(32);
const VARIABLES = { VIDA_PRUEBA_MS: "600000", LLAVE_CAMPANAS_PRUEBA: PRUEBA };
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);

describe("a quién le sirve la llave de prueba", () => {
  it("al servidor de desarrollo: localhost y 127.0.0.1, con cualquier puerto", () => {
    for (const direccion of ["http://localhost:8787/v1/campana", "http://127.0.0.1:8792/v1/campana", "http://127.0.0.1/v1/campana"]) {
      expect(esPedidoLocal(direccion), direccion).toBe(true);
      expect(llaveDeCampanas(VARIABLES, direccion, OFICIAL), direccion).toBe(PRUEBA);
    }
  });

  it("a un Worker desplegado no: con las dos variables puestas vale la llave de Tinkazo", () => {
    for (const direccion of ["https://s.tinkazo.app/v1/campana", "https://tinkazo-sala.example.workers.dev/v1/campana"]) {
      expect(esPedidoLocal(direccion), direccion).toBe(false);
      expect(llaveDeCampanas(VARIABLES, direccion, OFICIAL), direccion).toBe(OFICIAL);
    }
  });

  it("con la llave de Tinkazo sin escribir, un Worker desplegado no acepta ninguna campaña", () => {
    expect(llaveDeCampanas(VARIABLES, "https://s.tinkazo.app/v1/campana", null)).toBeNull();
  });

  it("un nombre que solo parece local no cuenta: se mira la máquina de verdad, no el texto de la dirección", () => {
    const parecidas = [
      "https://127.0.0.1.tinkazo.app/v1/campana",
      "https://localhost.tinkazo.app/v1/campana",
      "https://s.tinkazo.app/localhost/v1/campana",
      "https://s.tinkazo.app/v1/campana?host=127.0.0.1",
      "https://s.tinkazo.app/v1/campana#localhost",
      "https://127.0.0.1@s.tinkazo.app/v1/campana",
      "https://localhost:8787@tinkazo.app/v1/campana",
      "https://notlocalhost/v1/campana",
      "http://[::1]:8787/v1/campana",
      "http://0.0.0.0:8787/v1/campana",
      "no es una dirección",
      "",
    ];
    for (const direccion of parecidas) {
      expect(esPedidoLocal(direccion), direccion).toBe(false);
      expect(llaveDeCampanas(VARIABLES, direccion, OFICIAL), direccion).toBe(OFICIAL);
    }
  });

  it("hacen falta las dos variables: con una sola, ni en local sirve", () => {
    const local = "http://127.0.0.1:8792/v1/campana";
    expect(llaveDeCampanas({ VIDA_PRUEBA_MS: "600000" }, local, OFICIAL)).toBe(OFICIAL);
    expect(llaveDeCampanas({ LLAVE_CAMPANAS_PRUEBA: PRUEBA }, local, OFICIAL)).toBe(OFICIAL);
    expect(llaveDeCampanas({}, local, OFICIAL)).toBe(OFICIAL);
    expect(llaveDeCampanas({ VIDA_PRUEBA_MS: "", LLAVE_CAMPANAS_PRUEBA: PRUEBA }, local, OFICIAL)).toBe(OFICIAL);
  });

  it("sin variables vale la llave que está escrita en el código", () => {
    expect(llaveDeCampanas({}, "https://s.tinkazo.app/v1/campana")).toBe(LLAVE_CAMPANAS_HEX);
  });
});

describe("el Worker con la llave de prueba", () => {
  let mundo: MundoDeSala;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const cuerpo = () => firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA));

  it("en el servidor de desarrollo crea la campaña firmada con la llave de prueba", async () => {
    const r = await mundo.pedir("/v1/campana", { cuerpo: cuerpo() });
    expect(r.status).toBe(201);
  });

  it("con localhost también", async () => {
    const r = await mundo.pedir("/v1/campana", { cuerpo: cuerpo(), base: "http://localhost:8787" });
    expect(r.status).toBe(201);
  });

  it("en el Worker desplegado, con las dos variables puestas, la misma campaña no se acepta", async () => {
    const r = await mundo.pedir("/v1/campana", { cuerpo: cuerpo(), base: "https://s.tinkazo.app" });
    // Vale la llave de Tinkazo y no la de prueba: sin llave escrita no hay con qué comprobar, y con ella la firma no es la suya.
    expect(r.status).toBe(LLAVE_CAMPANAS_HEX === null ? 503 : 403);
    expect(await r.json()).toEqual({ error: LLAVE_CAMPANAS_HEX === null ? "sin-llave" : "firma" });
  });

  it("en el Worker desplegado no se crea ninguna sala ni se gasta un lugar del día", async () => {
    await mundo.pedir("/v1/campana", { cuerpo: cuerpo(), base: "https://s.tinkazo.app" });
    const reserva = await mundo.cupos().reservarCampana("feria-del-libro", null);
    expect(reserva).toMatchObject({ ok: true });
  });
});

describe("la vida corta de prueba de una campaña, también solo en local", () => {
  it("en el servidor de desarrollo, VIDA_PRUEBA_MS acorta la vida de la sala", () => {
    expect(vidaDeCampana({ VIDA_PRUEBA_MS: "600000" }, "http://127.0.0.1:8792/v1/campana")).toBe(600_000);
  });

  it("en un Worker desplegado, la misma variable no le corta la vida a la sala de un evento: 24 horas", () => {
    expect(vidaDeCampana({ VIDA_PRUEBA_MS: "3000" }, "https://s.tinkazo.app/v1/campana")).toBe(VIDA_CAMPANA_MS);
  });

  it("sin la variable, o con un valor fuera de rango, también 24 horas", () => {
    for (const valor of [undefined, "", "abc", "999", String(VIDA_CAMPANA_MS + 1)]) {
      expect(vidaDeCampana({ VIDA_PRUEBA_MS: valor }, "http://127.0.0.1:8792/v1/campana"), String(valor)).toBe(VIDA_CAMPANA_MS);
    }
  });

  it("el Worker decide la vida de la campaña con la dirección del pedido", () => {
    const fuente = readFileSync(join(process.cwd(), "workers", "sala", "src", "index.ts"), "utf8");
    expect(fuente).toContain("vidaDeCampana(env, req.url)");
  });
});

describe("el repositorio no trae las variables de prueba", () => {
  it("wrangler.toml no pone VIDA_PRUEBA_MS ni LLAVE_CAMPANAS_PRUEBA", () => {
    const toml = readFileSync(join(process.cwd(), "workers", "sala", "wrangler.toml"), "utf8");
    const sinComentarios = toml
      .split(/\r?\n/)
      .filter((linea) => !linea.trim().startsWith("#"))
      .join("\n");
    expect(sinComentarios).not.toContain("VIDA_PRUEBA_MS");
    expect(sinComentarios).not.toContain("LLAVE_CAMPANAS_PRUEBA");
  });

  it("el Worker elige la llave con llaveDeCampanas y la dirección del pedido, y no lee la variable de prueba por su cuenta", () => {
    const fuente = readFileSync(join(process.cwd(), "workers", "sala", "src", "index.ts"), "utf8");
    expect(fuente).toContain("llaveDeCampanas(env, req.url)");
    const usos = fuente.split(/\r?\n/).filter((linea) => linea.includes("env.LLAVE_CAMPANAS_PRUEBA"));
    expect(usos).toEqual([]);
    expect(fuente).not.toContain("LLAVE_CAMPANAS_HEX");
  });

  it("la llave pública de Tinkazo sigue sin escribirse en el código hasta que el equipo la genere", () => {
    expect(LLAVE_CAMPANAS_HEX === null || /^[0-9a-f]{64}$/.test(LLAVE_CAMPANAS_HEX)).toBe(true);
  });
});
