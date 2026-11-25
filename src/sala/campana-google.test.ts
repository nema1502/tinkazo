import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modoSoloGoogle, viaPermitida } from "../../workers/sala/src/campana";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * Solo entra quien el proveedor dice, exactamente, que es de Google. Una lista de lo permitido: lo que no se reconoce no
 * entra. El modo suave es solo un interruptor de emergencia y se cuenta aparte.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);

interface Estado {
  total: number;
  vias?: { google: number; sinDato: number };
}

describe("la lista de lo permitido", () => {
  it("en modo estricto solo Google entra", () => {
    expect(viaPermitida("google", "estricto")).toEqual({ ok: true, via: "google" });
    expect(viaPermitida("otra", "estricto")).toEqual({ ok: false });
    expect(viaPermitida(null, "estricto")).toEqual({ ok: false });
  });

  it("en modo suave entra Google y quien no dice por dónde entró, que se cuenta aparte, pero no otra vía", () => {
    expect(viaPermitida("google", "suave")).toEqual({ ok: true, via: "google" });
    expect(viaPermitida(null, "suave")).toEqual({ ok: true, via: "sin-dato" });
    expect(viaPermitida("otra", "suave")).toEqual({ ok: false });
  });

  it("el modo es suave solo con el valor exacto suave: sin valor o con cualquier otro es estricto", () => {
    expect(modoSoloGoogle("suave")).toBe("suave");
    for (const valor of [undefined, "", "estricto", "Suave", "SUAVE", " suave", "suave ", "1", "true", "no"]) {
      expect(modoSoloGoogle(valor), String(valor)).toBe("estricto");
    }
  });

  it("el valor por defecto del repositorio es estricto, nunca suave", () => {
    const toml = readFileSync(join(process.cwd(), "workers", "sala", "wrangler.toml"), "utf8");
    const lineas = toml.split(/\r?\n/).filter((linea) => /^\s*SOLO_GOOGLE\s*=/.test(linea));
    expect(lineas).toEqual(['SOLO_GOOGLE = "estricto"']);
  });
});

describe("el alta con la vía de la sesión", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;

  async function montar(extra: Record<string, string> = {}): Promise<void> {
    mundo = await montarMundo(extra);
    sala = await campanaAbierta(mundo, AHORA);
  }

  async function estado(): Promise<Estado> {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`, { cabeceras: { Authorization: `Bearer ${sala.token}` } });
    return (await r.json()) as Estado;
  }

  /** El alta de una persona cuya sesión trae este contenido en el campo de la vía. */
  async function altaConVia(n: number, contenido: Record<string, unknown>): Promise<{ estado: number; cuerpo: unknown }> {
    const persona = personaDePrueba(mundo, n, contenido);
    const r = await altaDe(mundo, sala.id, persona);
    return { estado: r.status, cuerpo: await r.json() };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sin configurar nada (el valor por defecto), una sesión que dice Google entra y se cuenta como Google", async () => {
    await montar();
    const r = await altaConVia(1, { authProvider: "google" });
    expect(r.estado).toBe(201);
    const e = await estado();
    expect(e.total).toBe(1);
    expect(e.vias).toEqual({ google: 1, sinDato: 0 });
  });

  it("una sesión que dice Google en mayúsculas o con espacios alrededor entra y se cuenta como Google", async () => {
    await montar();
    for (const [i, via] of ["GOOGLE", "Google", " google "].entries()) {
      expect((await altaConVia(i + 1, { authProvider: via })).estado, via).toBe(201);
    }
    const e = await estado();
    expect(e.total).toBe(3);
    expect(e.vias).toEqual({ google: 3, sinDato: 0 });
  });

  it("una sesión que dice EMAIL en mayúsculas no entra", async () => {
    await montar();
    expect(await altaConVia(1, { authProvider: "EMAIL" })).toEqual({ estado: 403, cuerpo: { error: "solo-google" } });
    expect((await estado()).total).toBe(0);
  });

  it("sin configurar nada, una sesión que no dice por dónde entró no se anota y da solo-google", async () => {
    await montar();
    const r = await altaConVia(1, { authProvider: undefined });
    expect(r).toEqual({ estado: 403, cuerpo: { error: "solo-google" } });
    const e = await estado();
    expect(e.total).toBe(0);
    expect(e.vias).toEqual({ google: 0, sinDato: 0 });
  });

  it("si el proveedor usa otro nombre para el campo, en estricto nadie entra", async () => {
    await montar();
    const r = await altaConVia(1, { authProvider: undefined, provider: "google" });
    expect(r.estado).toBe(403);
    expect((await estado()).total).toBe(0);
  });

  it("en estricto, cualquier otro texto en la vía da solo-google, escrito como se escriba", async () => {
    await montar();
    const otros = ["email", "wallet", "apple.com", "auth0|123", "github2", "EMAIL", "oidc", "github", "google.com", "googlex", "google-oauth2", "goo gle", "goo\u200Bgle"];
    for (const [i, via] of otros.entries()) {
      const r = await altaConVia(i + 1, { authProvider: via });
      expect(r, via).toEqual({ estado: 403, cuerpo: { error: "solo-google" } });
    }
    expect((await estado()).total).toBe(0);
  });

  it("en estricto, un número, un objeto o un texto vacío en la vía tampoco entran", async () => {
    await montar();
    const raros = [12, {}, ["google"], "", "  ", null];
    for (const [i, via] of raros.entries()) {
      const r = await altaConVia(i + 1, { authProvider: via });
      expect(r.estado, JSON.stringify(via)).toBe(403);
    }
    expect((await estado()).total).toBe(0);
  });

  it("un valor raro de la variable del Worker es estricto", async () => {
    await montar({ SOLO_GOOGLE: "Suave" });
    expect((await altaConVia(1, { authProvider: undefined })).estado).toBe(403);
    expect((await estado()).total).toBe(0);
  });

  it("en modo suave, quien no dice por dónde entró se anota y se cuenta aparte", async () => {
    await montar({ SOLO_GOOGLE: "suave" });
    expect((await altaConVia(1, { authProvider: undefined })).estado).toBe(201);
    expect((await altaConVia(2, { authProvider: "google" })).estado).toBe(201);
    const e = await estado();
    expect(e.total).toBe(2);
    expect(e.vias).toEqual({ google: 1, sinDato: 1 });
  });

  it("en modo suave, una vía que dice otra cosa no entra, ni siquiera con un valor raro", async () => {
    await montar({ SOLO_GOOGLE: "suave" });
    for (const [i, via] of ["email", "apple.com", "auth0|123", "github2", "google.com"].entries()) {
      const r = await altaConVia(i + 1, { authProvider: via });
      expect(r, via).toEqual({ estado: 403, cuerpo: { error: "solo-google" } });
    }
    expect((await estado()).total).toBe(0);
  });
});
