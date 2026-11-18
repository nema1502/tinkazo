import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECHAZOS_POR_CONEXION, RECHAZOS_POR_FICHA } from "../../workers/sala/src/campana";
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
 * Todo el recinto sale por una sola conexión. El tope de rechazos de esa conexión protege las llamadas al proveedor, y una
 * persona no puede gastarlo para dejar afuera a las demás: repetir una ficha mala o mandar lo que se rechaza antes de llamar
 * no lo toca, y el número es de los que 150 personas honestas con algún error no alcanzan.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const IP = "190.129.10.20";

interface Estado {
  total: number;
  fase: string;
}

/** Una persona cuya sesión el proveedor no reconoce: su ficha es mala. */
const conFichaMala = (n: number): PersonaDePrueba => ({
  usuario: `mala${n}`,
  token: `tok_mala${n}_${"y".repeat(24)}`,
  cuenta: "",
  llave: `llavemala${n}`.padEnd(22, "x"),
});

describe("los rechazos de la conexión del recinto", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;

  async function montar(extra: Record<string, string> = {}): Promise<void> {
    mundo = await montarMundo(extra);
    sala = await campanaAbierta(mundo, AHORA);
  }

  async function total(): Promise<number> {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`);
    return ((await r.json()) as Estado).total;
  }

  async function entra(n: number): Promise<number> {
    return (await altaDe(mundo, sala.id, personaDePrueba(mundo, n))).status;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("el tope por conexión es de 300 y el de una ficha repetida es más bajo", () => {
    expect(RECHAZOS_POR_CONEXION).toBe(300);
    expect(RECHAZOS_POR_FICHA).toBeLessThan(RECHAZOS_POR_CONEXION);
  });

  it("repetir una ficha mala 200 veces no deja afuera a las demás: el tope de la ficha la corta a la sexta", async () => {
    await montar();
    const mala = conFichaMala(1);
    const estados: number[] = [];
    for (let i = 0; i < 200; i++) estados.push((await altaDe(mundo, sala.id, mala, { ip: IP })).status);
    expect(estados.slice(0, RECHAZOS_POR_FICHA)).toEqual(Array(RECHAZOS_POR_FICHA).fill(401));
    expect(new Set(estados.slice(RECHAZOS_POR_FICHA))).toEqual(new Set([429]));
    for (let n = 1; n <= 20; n++) expect(await entra(n)).toBe(201);
    expect(await total()).toBe(20);
  });

  it("la ficha repetida cortada contesta rechazos con cuánto esperar", async () => {
    await montar();
    const mala = conFichaMala(1);
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) await altaDe(mundo, sala.id, mala);
    const r = await altaDe(mundo, sala.id, mala);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rechazos" });
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("la respuesta 429 trae Retry-After y el servicio deja que otro origen la lea", async () => {
    await montar();
    const mala = conFichaMala(1);
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) await altaDe(mundo, sala.id, mala);
    const r = await altaDe(mundo, sala.id, mala);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).not.toBeNull();
    const expuestas = (r.headers.get("Access-Control-Expose-Headers") ?? "").split(",").map((x) => x.trim());
    expect(expuestas).toContain("Retry-After");
  });

  it("150 personas honestas que se equivocan una vez cada una entran todas", async () => {
    await montar();
    for (let n = 1; n <= 150; n++) {
      // Primero una sesión vencida o mal copiada, después la buena.
      expect((await altaDe(mundo, sala.id, conFichaMala(n))).status).toBe(401);
      expect(await entra(n)).toBe(201);
    }
    expect(await total()).toBe(150);
  });

  it("300 fichas distintas rechazadas por el proveedor gastan el tope y la siguiente espera", async () => {
    await montar();
    for (let n = 1; n <= RECHAZOS_POR_CONEXION; n++) {
      expect((await altaDe(mundo, sala.id, conFichaMala(n))).status).toBe(401);
    }
    const siguiente = await altaDe(mundo, sala.id, conFichaMala(RECHAZOS_POR_CONEXION + 1));
    expect(siguiente.status).toBe(429);
    expect(Number(siguiente.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await entra(1)).toBe(429);
  });

  it("con 299 rechazos la conexión todavía deja entrar", async () => {
    await montar();
    for (let n = 1; n < RECHAZOS_POR_CONEXION; n++) await altaDe(mundo, sala.id, conFichaMala(n));
    expect(await entra(1)).toBe(201);
  });

  it("pasada la ventana de diez minutos la conexión vuelve a tener su tope entero", async () => {
    await montar();
    for (let n = 1; n <= RECHAZOS_POR_CONEXION; n++) await altaDe(mundo, sala.id, conFichaMala(n));
    expect(await entra(1)).toBe(429);
    vi.setSystemTime(AHORA + 10 * 60_000);
    expect(await entra(2)).toBe(201);
  });

  it("lo que se rechaza antes de llamar al proveedor no gasta el tope: forma, fase y pase", async () => {
    await montar({ PASE: "1" });
    const pase = (await (await mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, { cabeceras: { Authorization: `Bearer ${sala.token}` } })).json()) as {
      p: string;
    };
    const informe = new Set<number>();
    for (let n = 1; n <= RECHAZOS_POR_CONEXION + 100; n++) {
      // Un token con forma de basura: el Worker lo rechaza antes de preguntar nada.
      const malformada = await altaDe(mundo, sala.id, conFichaMala(n), { cuerpo: { token: "corto", p: pase.p } });
      informe.add(malformada.status);
      // Sin el pase del QR.
      const sinPase = await altaDe(mundo, sala.id, conFichaMala(n));
      informe.add(sinPase.status);
      // Con un pase que no es de esta sala.
      const pasePropio = await altaDe(mundo, sala.id, conFichaMala(n), { cuerpo: { p: "AAAAAAAAAAAA" } });
      informe.add(pasePropio.status);
    }
    expect([...informe].sort()).toEqual([400, 409]);
    expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, 1), { cuerpo: { p: pase.p } })).status).toBe(201);
  });

  it("con la campaña cerrada el alta da cerrada sin gastar el tope, y al reabrirla la gente entra", async () => {
    await montar();
    const cabeceras = { Authorization: `Bearer ${sala.token}` };
    await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras });
    for (let n = 1; n <= RECHAZOS_POR_CONEXION + 100; n++) {
      expect((await altaDe(mundo, sala.id, conFichaMala(n))).status).toBe(409);
    }
    await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, { metodo: "PUT", cuerpo: { fase: "abierta" }, cabeceras });
    expect(await entra(1)).toBe(201);
  });

  it("una sesión que el proveedor deja pasar pero no es de Google cuenta una sola vez por ficha", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 1, { authProvider: "email" });
    const estados: number[] = [];
    for (let i = 0; i < 20; i++) estados.push((await altaDe(mundo, sala.id, persona)).status);
    expect(estados.slice(0, RECHAZOS_POR_FICHA)).toEqual(Array(RECHAZOS_POR_FICHA).fill(403));
    expect(new Set(estados.slice(RECHAZOS_POR_FICHA))).toEqual(new Set([429]));
    for (let n = 2; n <= 10; n++) expect(await entra(n)).toBe(201);
  });

  it("la persona ya verificada hace poco reingresa aunque el tope de la conexión esté agotado", async () => {
    await montar();
    const anotada = personaDePrueba(mundo, 1);
    expect((await altaDe(mundo, sala.id, anotada)).status).toBe(201);
    for (let n = 1; n <= RECHAZOS_POR_CONEXION; n++) await altaDe(mundo, sala.id, conFichaMala(n));
    expect(await entra(2)).toBe(429);
    const otra = await altaDe(mundo, sala.id, anotada, { cuerpo: { llave: "otroCelular".padEnd(22, "x") } });
    expect(otra.status).toBe(200);
    expect(await otra.json()).toEqual({ cuenta: anotada.cuenta, ya: true });
  });
});
