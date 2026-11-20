import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENVIOS_CAMPANA_POR_CONEXION, RECHAZOS_POR_FICHA } from "../../workers/sala/src/campana";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type PersonaDePrueba,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * Todo el recinto sale por una sola conexión. Quien ya salió con su motivo, o quien entra con una sesión sin billetera, no
 * puede repetir su alta hasta agotar lo que comparte con las demás (los envíos de la conexión) ni hacer que la sala llame
 * al proveedor sin límite.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const VERIFY = "/v3/tokens/verify";
const USERS = "/v3/users";

describe("una sola persona no deja afuera a las demás", () => {
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

  /** Anota a una persona y después quien organiza la saca con un motivo. */
  async function anotadaYQuitada(n: number): Promise<PersonaDePrueba> {
    const persona = personaDePrueba(mundo, n);
    expect((await altaDe(mundo, sala.id, persona)).status).toBe(201);
    const quitar = await mundo.pedir(`/v1/sala/${sala.id}/campana/quitar`, {
      cuerpo: { n: 1, motivo: "evento" },
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
    expect(quitar.status).toBe(204);
    return persona;
  }

  /** Otra sesión de la misma persona del proveedor: un inicio de sesión nuevo, con su propia ficha. */
  function otraSesion(persona: PersonaDePrueba, k: number, contenido: Record<string, unknown> = { wallet: persona.cuenta }): PersonaDePrueba {
    const token = `tok_${persona.usuario}_sesion${k}_${"z".repeat(20)}`;
    mundo.proveedor.sesiones.set(token, { usuario: persona.usuario, contenido });
    return { ...persona, token };
  }

  it("quien salió y repite su alta con la misma sesión recibe quitada sin que la sala llame al proveedor", async () => {
    const quitada = await anotadaYQuitada(1);
    const antes = mundo.proveedor.llamadas[VERIFY] ?? 0;
    for (let i = 0; i < 20; i++) {
      const r = await altaDe(mundo, sala.id, quitada);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "quitada" });
    }
    expect(mundo.proveedor.llamadas[VERIFY] ?? 0).toBe(antes);
  });

  it("con una sesión nueva, quien salió pasa una vez por el proveedor y después la sala le contesta sin llamarlo", async () => {
    const quitada = await anotadaYQuitada(1);
    // La sesión nueva no trae la billetera: cada paso entero le pregunta la cuenta al proveedor.
    mundo.proveedor.billeteras.set(quitada.usuario, quitada.cuenta);
    const nueva = otraSesion(quitada, 1, { wallet: null });
    expect((await altaDe(mundo, sala.id, nueva)).status).toBe(409);
    expect(mundo.proveedor.llamadas[USERS]).toBe(1);
    for (let i = 0; i < 10; i++) expect((await altaDe(mundo, sala.id, nueva)).status).toBe(409);
    expect(mundo.proveedor.llamadas[USERS]).toBe(1);
  });

  it("quien salió y repite su alta más veces que los envíos de la conexión no deja afuera a una persona nueva", async () => {
    const quitada = await anotadaYQuitada(1);
    for (let k = 0; k <= ENVIOS_CAMPANA_POR_CONEXION; k++) {
      expect((await altaDe(mundo, sala.id, otraSesion(quitada, k))).status).toBe(409);
    }
    const nueva = await altaDe(mundo, sala.id, personaDePrueba(mundo, 2));
    expect(nueva.status).toBe(201);
  });

  it("una sesión sin billetera se le pregunta al proveedor como mucho cinco veces por ventana", async () => {
    const persona = personaDePrueba(mundo, 3, { wallet: null });
    mundo.proveedor.billeteras.set(persona.usuario, null);
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) {
      const r = await altaDe(mundo, sala.id, persona);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "sin-billetera" });
    }
    const corta = await altaDe(mundo, sala.id, persona);
    expect(corta.status).toBe(429);
    expect(await corta.json()).toEqual({ error: "rechazos" });
    expect(mundo.proveedor.llamadas[USERS]).toBe(RECHAZOS_POR_FICHA);
  });

  it("una sesión sin billetera que se repite no le cierra la puerta a las demás", async () => {
    const persona = personaDePrueba(mundo, 3, { wallet: null });
    mundo.proveedor.billeteras.set(persona.usuario, null);
    for (let i = 0; i < 3 * RECHAZOS_POR_FICHA; i++) await altaDe(mundo, sala.id, persona);
    expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, 4))).status).toBe(201);
  });
});
