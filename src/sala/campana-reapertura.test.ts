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
 * Reabrir una campaña después de su hora de cierre (issue #168): sin una hora nueva, la sala no puede quedar abierta para
 * quien organiza y cerrada para todos los demás. O la reapertura trae una hora que vale, o se rechaza y nada cambia.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const HORA = 3_600_000;

describe("reabrir una campaña después de su hora de cierre", () => {
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

  function fase(cuerpo: Record<string, unknown>): Promise<Response> {
    return mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo,
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
  }

  async function estado(): Promise<{ fase: string; cierraMs: number }> {
    return (await (await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`)).json()) as { fase: string; cierraMs: number };
  }

  it("cerrada y con la hora vencida, reabrir sin hora nueva se rechaza y la sala sigue cerrada", async () => {
    expect((await fase({ fase: "cerrada" })).status).toBe(204);
    vi.setSystemTime(AHORA + HORA + 60_000);
    const r = await fase({ fase: "abierta" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma" });
    expect((await estado()).fase).toBe("cerrada");
    // Nadie queda con la sala abierta para quien organiza y cerrada para los demás: tampoco entra nadie.
    expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, 1))).status).toBe(409);
  });

  it("con una hora nueva que vale, reabrir deja entrar a la gente", async () => {
    expect((await fase({ fase: "cerrada" })).status).toBe(204);
    vi.setSystemTime(AHORA + HORA + 60_000);
    const nueva = AHORA + HORA + 60_000 + 15 * 60_000;
    expect((await fase({ fase: "abierta", cierraMs: nueva })).status).toBe(204);
    expect(await estado()).toMatchObject({ fase: "abierta", cierraMs: nueva });
    expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, 1))).status).toBe(201);
  });

  it("con la hora todavía por venir, reabrir sin hora nueva conserva la que había", async () => {
    expect((await fase({ fase: "cerrada" })).status).toBe(204);
    vi.setSystemTime(AHORA + 10 * 60_000);
    expect((await fase({ fase: "abierta" })).status).toBe(204);
    expect(await estado()).toMatchObject({ fase: "abierta", cierraMs: AHORA + HORA });
  });

  it("repetir abierta sin hora nueva con la hora vencida tampoco finge que la sala está abierta", async () => {
    vi.setSystemTime(AHORA + HORA + 60_000);
    expect((await fase({ fase: "abierta" })).status).toBe(400);
  });
});
