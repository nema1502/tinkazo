import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAMPANAS_POR_DIA, ESPERA_RESERVA_MS } from "../../workers/sala/src/campana";
import { firmarParaLaPrueba, montarMundo, type MundoDeSala } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** El permiso de un evento con el Worker entero: se confirma con la sala creada y se deshace si la creación falla. */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);

const campana = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  evento: "feria-del-libro",
  red: "testnet",
  cierra_ms: AHORA + 3_600_000,
  sorteo_ms: AHORA + 7_200_000,
  premios: ["400000000", "200000000"],
  ...cambios,
});

interface Creada {
  id: string;
  token: string;
}

/** Manda el archivo firmado. `anterior` es el token de la sala que tenía el evento, si quien pide lo presenta. */
async function crear(mundo: MundoDeSala, datos: Record<string, unknown> = campana(), anterior?: string): Promise<Response> {
  const cabeceras: Record<string, string> = anterior === undefined ? {} : { Authorization: `Bearer ${anterior}` };
  return mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, datos), cabeceras });
}

async function creada(mundo: MundoDeSala, datos: Record<string, unknown> = campana(), anterior?: string): Promise<Creada> {
  const r = await crear(mundo, datos, anterior);
  expect(r.status).toBe(201);
  return (await r.json()) as Creada;
}

/** Quien organiza cierra su sala con su token. */
async function cerrar(mundo: MundoDeSala, sala: Creada): Promise<void> {
  const cierre = await mundo.pedir(`/v1/sala/${sala.id}`, {
    metodo: "DELETE",
    cabeceras: { Authorization: `Bearer ${sala.token}` },
  });
  expect(cierre.status).toBe(204);
}

/** Un token con la forma de uno de verdad que no es el de ninguna sala. */
const TOKEN_AJENO = "A".repeat(22);

describe("un evento firmado no queda quemado", () => {
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

  it("el archivo firmado crea la sala y entrega el token", async () => {
    const r = await creada(mundo);
    expect(r.id).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await mundo.sala(r.id).viva()).toBe(true);
  });

  it("un segundo pedido con el mismo archivo mientras la sala vive dice que ya existe y no da token", async () => {
    await creada(mundo);
    const otra = await crear(mundo);
    expect(otra.status).toBe(409);
    expect(await otra.json()).toEqual({ error: "ya-existe" });
  });

  it("el segundo pedido no crea otra sala: el evento sigue ligado a la primera", async () => {
    const primera = await creada(mundo);
    await crear(mundo);
    const reserva = await mundo.cupos().reservarCampana("feria-del-libro", null);
    expect(reserva).toEqual({ ok: false, motivo: "ya-existe", sala: primera.id });
  });

  it("si quien organiza cierra la sala, el mismo archivo firmado vuelve a servir con el token de esa sala", async () => {
    const primera = await creada(mundo);
    await cerrar(mundo, primera);
    expect(await mundo.sala(primera.id).viva()).toBe(false);
    const segunda = await creada(mundo, campana(), primera.token);
    expect(segunda.id).not.toBe(primera.id);
    expect(await mundo.sala(segunda.id).viva()).toBe(true);
  });

  it("si la sala venció con su alarma, el mismo archivo firmado vuelve a servir con el token de esa sala", async () => {
    const primera = await creada(mundo);
    await mundo.sala(primera.id).alarm();
    expect(await mundo.sala(primera.id).viva()).toBe(false);
    const segunda = await creada(mundo, campana(), primera.token);
    expect(segunda.id).not.toBe(primera.id);
  });

  it("quien copió el archivo público de una sala cerrada no se queda con el evento: ya-existe y sin token", async () => {
    const primera = await creada(mundo);
    const publico = await mundo.pedir(`/v1/sala/${primera.id}/campana`);
    const copiado = (await publico.json()) as { texto: string; firma: string };
    await cerrar(mundo, primera);
    const r = await mundo.pedir("/v1/campana", { cuerpo: copiado });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "ya-existe" });
  });

  it("con el token de otra sala, una sala muerta tampoco se reemplaza", async () => {
    const primera = await creada(mundo);
    await cerrar(mundo, primera);
    const r = await crear(mundo, campana(), TOKEN_AJENO);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "ya-existe" });
  });

  it("con la sala viva, presentar su token no crea otra", async () => {
    const primera = await creada(mundo);
    const r = await crear(mundo, campana(), primera.token);
    expect(r.status).toBe(409);
    expect(await mundo.cupos().reservarCampana("feria-del-libro", null)).toEqual({
      ok: false,
      motivo: "ya-existe",
      sala: primera.id,
    });
  });

  it("los intentos sin token sobre una sala cerrada no gastan el cupo del día y quien organizaba la recupera", async () => {
    const primera = await creada(mundo);
    await cerrar(mundo, primera);
    for (let i = 0; i < CAMPANAS_POR_DIA; i++) expect((await crear(mundo)).status).toBe(409);
    const recuperada = await creada(mundo, campana(), primera.token);
    expect(await mundo.sala(recuperada.id).viva()).toBe(true);
  });

  it("con todos los ids ocupados la creación da ocupado, y el mismo archivo se puede mandar de nuevo", async () => {
    mundo.fallas.crearCampana = "ocupado";
    const fallida = await crear(mundo);
    expect(fallida.status).toBe(503);
    expect(await fallida.json()).toEqual({ error: "ocupado" });
    mundo.fallas.crearCampana = "no";
    const buena = await creada(mundo);
    expect(await mundo.sala(buena.id).viva()).toBe(true);
  });

  it("con un corte al crear la sala el permiso se deshace y el mismo archivo se puede mandar de nuevo", async () => {
    mundo.fallas.crearCampana = "corte";
    const fallida = await crear(mundo);
    expect(fallida.status).toBe(503);
    mundo.fallas.crearCampana = "no";
    const buena = await creada(mundo);
    expect(await mundo.sala(buena.id).viva()).toBe(true);
  });

  it("una reserva abandonada por un corte del Worker se reemplaza pasado el minuto, no antes", async () => {
    await mundo.cupos().reservarCampana("feria-del-libro", null);
    const enCurso = await crear(mundo);
    expect(enCurso.status).toBe(409);
    vi.setSystemTime(AHORA + ESPERA_RESERVA_MS - 1);
    expect((await crear(mundo)).status).toBe(409);
    vi.setSystemTime(AHORA + ESPERA_RESERVA_MS);
    const buena = await creada(mundo);
    expect(await mundo.sala(buena.id).viva()).toBe(true);
  });

  it("el cupo del día cuenta solo las salas que de verdad se crearon", async () => {
    mundo.fallas.crearCampana = "ocupado";
    for (let i = 0; i < CAMPANAS_POR_DIA + 5; i++) {
      expect((await crear(mundo, campana({ evento: `intento-${i}` }))).status).toBe(503);
    }
    mundo.fallas.crearCampana = "no";
    for (let i = 0; i < CAMPANAS_POR_DIA; i++) await creada(mundo, campana({ evento: `evento-${i}` }));
    const demas = await crear(mundo, campana({ evento: "evento-de-mas" }));
    expect(demas.status).toBe(429);
    expect(demas.headers.get("Retry-After")).toBe("86400");
    expect(await demas.json()).toEqual({ error: "cupo-campanas" });
  });

  it("una sala cerrada sigue contando para el cupo del día: se creó", async () => {
    for (let i = 0; i < CAMPANAS_POR_DIA; i++) {
      const sala = await creada(mundo, campana({ evento: `evento-${i}` }));
      await mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: { Authorization: `Bearer ${sala.token}` } });
    }
    expect((await crear(mundo, campana({ evento: "evento-nuevo" }))).status).toBe(429);
  });
});
