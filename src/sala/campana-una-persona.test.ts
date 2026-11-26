import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENVIOS_CAMPANA_POR_CONEXION, RECHAZOS_POR_CONEXION, RECHAZOS_POR_FICHA } from "../../workers/sala/src/campana";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  sesionDePrueba,
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

  it("con más sesiones sin cuenta que el tope de rechazos de la conexión, todas esperan su cuenta y la persona que sigue entra", async () => {
    // Un recinto entero con cuentas nuevas detrás de la misma wifi: cada sesión es buena y solo falta su cuenta.
    for (let i = 0; i <= RECHAZOS_POR_CONEXION; i++) {
      const persona = personaDePrueba(mundo, 1000 + i, { wallet: null });
      mundo.proveedor.billeteras.set(persona.usuario, null);
      const r = await altaDe(mundo, sala.id, persona);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "sin-billetera" });
    }
    const conCuenta = await altaDe(mundo, sala.id, personaDePrueba(mundo, 2000));
    expect(conCuenta.status).toBe(201);
  }, 60_000);

  it("con tantas sesiones que el proveedor rechaza de verdad como el tope de la conexión, la que sigue recibe rechazos", async () => {
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) {
      // Una sesión que el proveedor no conoce: lo que cuenta es que costó una llamada y la rechazó.
      const token = sesionDePrueba(`desconocida${i}`);
      const r = await altaDe(mundo, sala.id, { ...personaDePrueba(mundo, 3000 + i), token });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).not.toBe(429);
    }
    const siguiente = await altaDe(mundo, sala.id, personaDePrueba(mundo, 4000));
    expect(siguiente.status).toBe(429);
    expect(await siguiente.json()).toEqual({ error: "rechazos" });
  }, 60_000);

  it("dos pedidos a la vez de la misma persona anotan una sola vez", async () => {
    const persona = personaDePrueba(mundo, 5);
    const [primero, segundo] = await Promise.all([
      altaDe(mundo, sala.id, persona),
      altaDe(mundo, sala.id, otraSesion(persona, 1)),
    ]);
    // Uno entra como nueva y el otro se encuentra ya anotado: nunca hay dos filas para la misma persona.
    expect([primero.status, segundo.status].sort()).toEqual([200, 201]);
    const cuerpo = async (r: Response): Promise<{ cuenta: string; ya?: boolean }> => (await r.json()) as never;
    const a = await cuerpo(primero);
    expect(a.cuenta).toBe(persona.cuenta);
    const b = await cuerpo(segundo);
    expect(b.cuenta).toBe(persona.cuenta);
    expect([a.ya, b.ya].filter(Boolean)).toHaveLength(1);
    const estado = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`);
    expect(((await estado.json()) as { total: number }).total).toBe(1);
  });
});
