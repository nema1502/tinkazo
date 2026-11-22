import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * Todo el recinto puede salir por un mismo grupo de direcciones (la sede detrás de una sola conexión): el tope de altas
 * nuevas de la ruta de campaña se mide por grupo de IP y tiene que dejar entrar al evento entero. Ciento cincuenta
 * personas detrás de la misma dirección, y de la misma red IPv6 /64, entran todas (issue #168).
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const IP = "190.129.10.20";

describe("150 altas desde un mismo grupo de IP", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    sala = await campanaAbierta(mundo, AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function total(): Promise<number> {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`);
    return ((await r.json()) as { total: number }).total;
  }

  it("ciento cincuenta personas detrás de la misma dirección entran todas", async () => {
    for (let n = 1; n <= 150; n++) {
      const r = await altaDe(mundo, sala.id, personaDePrueba(mundo, n), { ip: IP });
      expect(r.status).toBe(201);
      expect(((await r.json()) as { cuenta: string }).cuenta).toMatch(/^G/);
    }
    expect(await total()).toBe(150);
  });

  it("ciento cincuenta direcciones del mismo bloque IPv6 /64 entran todas", async () => {
    for (let n = 1; n <= 150; n++) {
      const r = await altaDe(mundo, sala.id, personaDePrueba(mundo, n), { ip: `2001:db8:1:2::${n}` });
      expect(r.status).toBe(201);
    }
    expect(await total()).toBe(150);
  });
});
