import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  VENTANA_CAMPANA_MS,
  anotarPersona,
  crearTablasDeCampana,
  type AltaDePersona,
} from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
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
 * El cupo y el tope de la ruta de alta de campaña (issue #168): la sala llena no anota a nadie más, y el tope de altas
 * nuevas por conexión es el cupo del evento más un margen, no un número fijo.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);

describe("el cupo de la sala, por el alta de campaña", () => {
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

  it("la alta con la sala llena da llena, y ni esa ni las siguientes escriben", async () => {
    const tope = (await import("../../workers/sala/src/campana")).CAMPANA_MAX;
    for (let n = 1; n <= tope; n++) {
      const r = await altaDe(mundo, sala.id, personaDePrueba(mundo, n));
      expect(r.status).toBe(201);
    }
    expect(await total()).toBe(tope);
    const deMás = await altaDe(mundo, sala.id, personaDePrueba(mundo, tope + 1));
    expect(deMás.status).toBe(429);
    expect(await deMás.json()).toEqual({ error: "llena" });
    for (let n = tope + 1; n <= tope + 5; n++) {
      expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, n))).status).toBe(429);
    }
    expect(await total()).toBe(tope);
  });
});

/* ------------------------------------------------ el tope dinámico por conexión */

/** Las altas de campaña contra un SQLite de verdad, con huellas inventadas y sin llamadas al proveedor. */
function nuevaSala(): { sql: Ejecutar } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => {
    return db.prepare(consulta).all(...p) as unknown as T[];
  };
  crearTablasDeCampana(sql);
  sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?)", String(0));
  return { sql };
}

const T0 = 1_000 * VENTANA_CAMPANA_MS;
const huella = (s: string): string => createHash("sha256").update(s).digest("hex");
const cuentaN = (i: number): string => `G${String(i).padStart(55, "B")}`;
const siempre = (): boolean => true;

function alta(o: Partial<AltaDePersona> = {}): AltaDePersona {
  return {
    persona: huella("persona-1"),
    cuenta: cuentaN(1),
    d: "datos-cifrados-de-prueba",
    llave: huella("llave-1"),
    grupo: "conexion-1",
    ahora: T0,
    via: "google",
    ...o,
  };
}

describe("el tope de altas por conexión es el cupo del evento más un margen", () => {
  /** El módulo de la sala, cargado tarde: el tope dinámico todavía no existe cuando la prueba lo busca (rojo). */
  async function campana(): Promise<
    typeof import("../../workers/sala/src/campana") & {
      altasDeCampanaPorConexion?: (cupo: number) => number;
      MARGEN_DE_ALTAS_CAMPANA?: number;
    }
  > {
    return (await import("../../workers/sala/src/campana")) as typeof import("../../workers/sala/src/campana");
  }

  it("el tope sale del cupo del evento más un margen fijo", async () => {
    const m = await campana();
    expect(m.MARGEN_DE_ALTAS_CAMPANA).toBeGreaterThan(0);
    expect(m.altasDeCampanaPorConexion?.(0)).toBe(m.MARGEN_DE_ALTAS_CAMPANA);
    expect(m.altasDeCampanaPorConexion?.(m.CAMPANA_MAX)).toBe(m.CAMPANA_MAX + m.MARGEN_DE_ALTAS_CAMPANA);
  });

  it("una conexión entra hasta el tope y la alta siguiente de la misma conexión espera", async () => {
    const m = await campana();
    const tope = m.altasDeCampanaPorConexion?.(m.CAMPANA_MAX) ?? 0;
    const { sql } = nuevaSala();
    // La conexión ya trae el tope menos una alta de esta ventana.
    sql(
      "INSERT INTO ritmo (grupo, ventana, altas, envios) VALUES (?, ?, ?, ?)",
      "conexion-1",
      Math.floor(T0 / VENTANA_CAMPANA_MS),
      tope - 1,
      tope - 1,
    );
    expect(anotarPersona(sql, alta(), siempre).ok).toBe(true);
    expect(sql<{ n: number }>("SELECT COUNT(*) AS n FROM equipos WHERE cuenta = ?", cuentaN(1))[0]?.n).toBe(1);
    // La alta siguiente de esa conexión ya no entra: el tope de la ventana está lleno, y la sala no cambia.
    const segunda = anotarPersona(sql, alta({ persona: huella("persona-2"), cuenta: cuentaN(2), llave: huella("llave-2") }), siempre);
    expect(segunda).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    if (!("esperaS" in segunda)) throw new Error("la respuesta de tope trae cuánto esperar");
    expect(segunda.esperaS).toBeGreaterThan(0);
    expect(sql<{ n: number }>("SELECT COUNT(*) AS n FROM equipos")[0]?.n).toBe(1);
  });

  it("pasada la ventana de diez minutos la conexión vuelve a tener su tope entero", async () => {
    const m = await campana();
    const tope = m.altasDeCampanaPorConexion?.(m.CAMPANA_MAX) ?? 0;
    const { sql } = nuevaSala();
    sql(
      "INSERT INTO ritmo (grupo, ventana, altas, envios) VALUES (?, ?, ?, ?)",
      "conexion-1",
      Math.floor(T0 / VENTANA_CAMPANA_MS),
      tope,
      tope,
    );
    expect(anotarPersona(sql, alta(), siempre)).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    const despues = T0 + VENTANA_CAMPANA_MS;
    expect(
      anotarPersona(sql, alta({ ahora: despues }), siempre).ok,
    ).toBe(true);
  });
});
