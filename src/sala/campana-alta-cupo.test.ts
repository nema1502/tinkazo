import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  CAMPANA_MAX,
  ENVIOS_CAMPANA_POR_CONEXION,
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
 * El cupo de la ruta de alta de campaña (issue #168): la sala llena no anota a nadie más. En un evento todas las personas
 * salen por la misma conexión del lugar, así que no hay un tope de altas nuevas por conexión: el cupo de la sala es el límite.
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

/* ------------------------------------------------ sin tope de altas por conexión */

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

describe("ninguna conexión frena por altas nuevas: en un evento todas salen por la misma", () => {
  it("una conexión que ya anotó muchas más personas que el cupo sigue entrando mientras haya lugar", () => {
    const { sql } = nuevaSala();
    sql(
      "INSERT INTO ritmo (grupo, ventana, altas, envios) VALUES (?, ?, ?, ?)",
      "conexion-1",
      Math.floor(T0 / VENTANA_CAMPANA_MS),
      5_000,
      0,
    );
    const r = anotarPersona(sql, alta(), siempre);
    expect(r.ok).toBe(true);
    expect(sql<{ n: number }>("SELECT COUNT(*) AS n FROM equipos WHERE cuenta = ?", cuentaN(1))[0]?.n).toBe(1);
  });

  it("lo único que corta a una conexión por cantidad es el cupo de la sala, que contesta llena", () => {
    const { sql } = nuevaSala();
    for (let i = 1; i <= CAMPANA_MAX; i++) {
      const r = anotarPersona(sql, alta({ persona: huella(`p${i}`), cuenta: cuentaN(i), llave: huella(`l${i}`) }), siempre);
      expect(r.ok).toBe(true);
    }
    const deMas = anotarPersona(
      sql,
      alta({ persona: huella("p-extra"), cuenta: cuentaN(CAMPANA_MAX + 1), llave: huella("l-extra") }),
      siempre,
    );
    expect(deMas).toEqual({ ok: false, motivo: "llena" });
  });
});

describe("el tope de envíos por conexión sigue como estaba", () => {
  const conEnvios = (envios: number) => {
    const { sql } = nuevaSala();
    sql(
      "INSERT INTO ritmo (grupo, ventana, altas, envios) VALUES (?, ?, ?, ?)",
      "conexion-1",
      Math.floor(T0 / VENTANA_CAMPANA_MS),
      0,
      envios,
    );
    return sql;
  };

  it("con un envío menos que el tope todavía anota", () => {
    expect(anotarPersona(conEnvios(ENVIOS_CAMPANA_POR_CONEXION - 1), alta(), siempre).ok).toBe(true);
  });

  it("con el tope cumplido contesta cupo-conexion y no anota", () => {
    const sql = conEnvios(ENVIOS_CAMPANA_POR_CONEXION);
    const r = anotarPersona(sql, alta(), siempre);
    expect(r).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(sql<{ n: number }>("SELECT COUNT(*) AS n FROM equipos")[0]?.n).toBe(0);
  });
});
