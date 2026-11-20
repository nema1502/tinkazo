import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REINGRESOS_POR_PERSONA_POR_HORA, MEMORIA_DE_FICHA_MS } from "../../workers/sala/src/campana";
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
 * Quien ya está anotada puede volver a entrar (otro celular, la página recargada), pero con su propio tope por hora, y mientras
 * la ficha sea la que ya se verificó hace menos de un minuto no se vuelve a llamar al proveedor.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const llaveN = (n: number): string => `celular${n}`.padEnd(22, "x");
const VERIFY = "/v3/tokens/verify";

interface Yo {
  anotada: boolean;
}

describe("el reingreso de quien ya está anotada", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let anotada: PersonaDePrueba;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    sala = await campanaAbierta(mundo, AHORA);
    anotada = personaDePrueba(mundo, 1);
    expect((await altaDe(mundo, sala.id, anotada)).status).toBe(201);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const reingresar = (n: number, persona = anotada): Promise<Response> =>
    altaDe(mundo, sala.id, persona, { cuerpo: { llave: llaveN(n) } });

  async function veSuEstado(persona: PersonaDePrueba, llave: string): Promise<boolean> {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/yo`, { cuerpo: { cuenta: persona.cuenta, llave } });
    return ((await r.json()) as Yo).anotada;
  }

  it("el tope es de seis reingresos por persona y por hora", () => {
    expect(REINGRESOS_POR_PERSONA_POR_HORA).toBe(6);
  });

  it("los seis primeros reingresos entran y devuelven su cuenta con ya", async () => {
    for (let n = 2; n <= 1 + REINGRESOS_POR_PERSONA_POR_HORA; n++) {
      const r = await reingresar(n);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ cuenta: anotada.cuenta, ya: true });
    }
  });

  it("el séptimo da cupo-conexion con cuánto esperar y no cambia la llave del celular", async () => {
    for (let n = 2; n <= 1 + REINGRESOS_POR_PERSONA_POR_HORA; n++) await reingresar(n);
    const ultimo = llaveN(1 + REINGRESOS_POR_PERSONA_POR_HORA);
    const r = await reingresar(50);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "cupo-conexion" });
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await veSuEstado(anotada, ultimo)).toBe(true);
    expect(await veSuEstado(anotada, llaveN(50))).toBe(false);
  });

  it("repetir el alta en bucle no escribe nada más allá del tope: la versión de la fila deja de subir", async () => {
    for (let n = 2; n <= 1 + REINGRESOS_POR_PERSONA_POR_HORA; n++) await reingresar(n);
    const lista = async (): Promise<unknown> => {
      const r = await mundo.pedir(`/v1/sala/${sala.id}/equipos?desde=0`, { cabeceras: { Authorization: `Bearer ${sala.token}` } });
      return r.json();
    };
    const antes = await lista();
    for (let n = 100; n < 150; n++) expect((await reingresar(n)).status).toBe(429);
    expect(await lista()).toEqual(antes);
  });

  it("el tope es de cada persona: otra persona no se ve afectada", async () => {
    for (let n = 2; n <= 2 + REINGRESOS_POR_PERSONA_POR_HORA; n++) await reingresar(n);
    const otra = personaDePrueba(mundo, 2);
    expect((await altaDe(mundo, sala.id, otra)).status).toBe(201);
    expect((await reingresar(2, otra)).status).toBe(200);
  });

  it("con otra sesión de la misma persona (otro celular) también cuenta para su tope", async () => {
    const otraSesion: PersonaDePrueba = { ...anotada, token: `tok_otro_celular_${"z".repeat(24)}` };
    mundo.proveedor.sesiones.set(otraSesion.token, { usuario: anotada.usuario, contenido: { wallet: anotada.cuenta } });
    for (let n = 2; n <= 1 + REINGRESOS_POR_PERSONA_POR_HORA; n++) {
      expect((await reingresar(n, otraSesion)).status).toBe(200);
    }
    expect((await reingresar(60, otraSesion)).status).toBe(429);
    expect((await reingresar(61)).status).toBe(429);
  });

  it("pasada la hora la persona vuelve a poder reingresar", async () => {
    for (let n = 2; n <= 2 + REINGRESOS_POR_PERSONA_POR_HORA; n++) await reingresar(n);
    vi.setSystemTime(AHORA + 3_600_000);
    expect((await reingresar(70)).status).toBe(200);
  });

  it("con la misma ficha dentro del minuto no se vuelve a llamar al proveedor", async () => {
    expect(mundo.proveedor.llamadas[VERIFY]).toBe(1);
    for (let n = 2; n <= 5; n++) {
      vi.setSystemTime(AHORA + n * 5_000);
      expect((await reingresar(n)).status).toBe(200);
    }
    expect(mundo.proveedor.llamadas[VERIFY]).toBe(1);
  });

  it("con el proveedor caído, la ficha verificada hace menos de un minuto igual reingresa", async () => {
    mundo.proveedor.caido = true;
    vi.setSystemTime(AHORA + MEMORIA_DE_FICHA_MS - 1);
    const r = await reingresar(2);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cuenta: anotada.cuenta, ya: true });
  });

  it("pasado el minuto la ficha se vuelve a verificar con el proveedor", async () => {
    vi.setSystemTime(AHORA + MEMORIA_DE_FICHA_MS);
    expect((await reingresar(2)).status).toBe(200);
    expect(mundo.proveedor.llamadas[VERIFY]).toBe(2);
  });

  it("a quien quitaron con motivo no le sirve reingresar con la misma ficha", async () => {
    const quitar = await mundo.pedir(`/v1/sala/${sala.id}/campana/quitar`, {
      cuerpo: { n: 1, motivo: "evento" },
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
    expect(quitar.status).toBe(204);
    const r = await reingresar(2);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "quitada" });
  });
});
