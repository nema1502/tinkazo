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
 * La alta de campaña cuenta en la vigilancia de firmas como activación explicada (issue #168): cada alta nueva es la que
 * costó la sesión de Google, así que explica una firma. Lo que queda anotado son solo cifras: esta prueba mira lo que la
 * sala Contestó de sus conteos, y la prueba del módulo (workers/sala/src/vigilancia-campana.test.ts) mira lo que se
 * guarda de verdad.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);
const DIA = new Date(AHORA).toISOString().slice(0, 10);

/** El conteo de activaciones que la sala ya sabe leer, si existe. */
async function activaciones(mundo: MundoDeSala, id: string): Promise<Record<string, unknown>> {
  const sala = mundo.sala(id) as unknown as { activacionesDeCampana?: () => Promise<unknown> };
  if (typeof sala.activacionesDeCampana !== "function") throw new Error("la sala no sabe contar sus activaciones");
  return (await sala.activacionesDeCampana()) as Record<string, unknown>;
}

describe("la vigilancia de las altas de campaña", () => {
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

  it("cada alta nueva suma una activación explicada, y el reingreso no suma", async () => {
    for (let n = 1; n <= 3; n++) expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, n))).status).toBe(201);
    expect(await activaciones(mundo, sala.id)).toMatchObject({ ok: true, [DIA]: 3 });
    // La misma persona en otro celular reingresa, pero la activación ya se contó una sola vez.
    const otra = await altaDe(mundo, sala.id, personaDePrueba(mundo, 1), { cuerpo: { llave: "otroCelular".padEnd(22, "x") } });
    expect(otra.status).toBe(200);
    expect(((await otra.json()) as { ya: boolean }).ya).toBe(true);
    expect(await activaciones(mundo, sala.id)).toMatchObject({ ok: true, [DIA]: 3 });
  });

  it("el conteo solo trae días y cantidades: nada de datos de persona", async () => {
    for (let n = 1; n <= 2; n++) expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, n))).status).toBe(201);
    const conteo = await activaciones(mundo, sala.id);
    expect(Object.keys(conteo)).toEqual(["ok", DIA]);
    expect(conteo[DIA]).toBe(2);
    expect(JSON.stringify(conteo)).not.toMatch(/usuario|tok_|G[A-Z2-7]{55}|llave/i);
  });

  it("una sala creada antes del cambio, sin la tabla del conteo, anota igual y empieza a contar", async () => {
    // El almacén de una sala que ya existía el día de desplegar: sus tablas se crearon sin la del conteo.
    mundo.ejecutar(`sala:${sala.id}`, "DROP TABLE campana_activaciones");
    for (let n = 1; n <= 2; n++) {
      const r = await altaDe(mundo, sala.id, personaDePrueba(mundo, n));
      expect(r.status).toBe(201);
      expect(((await r.json()) as { ya: boolean }).ya).toBe(false);
    }
    expect(await activaciones(mundo, sala.id)).toMatchObject({ ok: true, [DIA]: 2 });
    // La persona quedó en la lista: reingresar la reconoce.
    const otra = await altaDe(mundo, sala.id, personaDePrueba(mundo, 1), { cuerpo: { llave: "otroCelular".padEnd(22, "x") } });
    expect(((await otra.json()) as { ya: boolean }).ya).toBe(true);
  });

  it("si el conteo falla, la persona queda anotada y recibe su respuesta de siempre", async () => {
    mundo.ejecutar(`sala:${sala.id}`, "DROP TABLE campana_activaciones");
    // Un conteo que no se puede escribir: una vista en el lugar de la tabla.
    mundo.ejecutar(`sala:${sala.id}`, "CREATE VIEW campana_activaciones AS SELECT '2026-01-01' AS dia, 1 AS n");
    const r = await altaDe(mundo, sala.id, personaDePrueba(mundo, 1));
    expect(r.status).toBe(201);
    const estado = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`);
    expect(((await estado.json()) as { total: number }).total).toBe(1);
  });
});
