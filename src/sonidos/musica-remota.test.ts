import { afterEach, describe, expect, it, vi } from "vitest";
import { JUEGOS_CON_MUSICA, urlMusica } from "./musica-remota";

const sitio = { hostname: "tinkazo.app", ahorraDatos: false };

describe("musica-remota", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("en tinkazo.app y en www, la dirección del servicio", () => {
    expect(urlMusica("race", sitio)).toBe("https://m.tinkazo.app/race.mp3");
    expect(urlMusica("toborochi", { ...sitio, hostname: "www.tinkazo.app" })).toBe("https://m.tinkazo.app/toborochi.mp3");
  });

  it("los diez juegos tienen su dirección", () => {
    expect(JUEGOS_CON_MUSICA).toHaveLength(10);
    for (const j of JUEGOS_CON_MUSICA) expect(urlMusica(j, sitio)).toBe(`https://m.tinkazo.app/${j}.mp3`);
  });

  it.each(["localhost", "127.0.0.1", "tinkazo.vercel.app", "otro.com", "m.tinkazo.app", "tinkazo.app.malo.com", "evil-tinkazo.app", ""])("host %s: null", (hostname) => {
    expect(urlMusica("race", { hostname, ahorraDatos: false })).toBeNull();
  });

  it("con ahorro de datos: null", () => {
    expect(urlMusica("race", { ...sitio, ahorraDatos: true })).toBeNull();
  });

  it("un juego sin cama: null", () => {
    for (const j of ["", "stellar", "../race", "race.mp3", "RACE", "quien"]) expect(urlMusica(j, sitio)).toBeNull();
  });

  it("sin entorno dado lee el navegador: ahí manda location.hostname", () => {
    vi.stubGlobal("location", { hostname: "tinkazo.app" });
    vi.stubGlobal("navigator", { connection: { saveData: false } });
    expect(urlMusica("pinata")).toBe("https://m.tinkazo.app/pinata.mp3");
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    expect(urlMusica("pinata")).toBeNull();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-data") }));
    expect(urlMusica("pinata")).toBeNull();
    vi.stubGlobal("location", { hostname: "localhost" });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(urlMusica("pinata")).toBeNull();
  });

  it("sin location (pruebas en node): null y sin romper", () => {
    expect(urlMusica("race")).toBeNull();
  });
});
