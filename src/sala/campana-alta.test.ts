import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPANA_MAX,
  RECHAZOS_POR_CONEXION,
  VENTANA_CAMPANA_MS,
  anotarPersona,
  antesDeVerificar,
  contarRechazo,
  crearTablasDeCampana,
  estadoDeCelular,
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

/** Las altas de campaña contra un SQLite de verdad, con huellas inventadas y sin llamadas al proveedor. */
function nuevaSala(): { sql: Ejecutar; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => {
    return db.prepare(consulta).all(...p) as unknown as T[];
  };
  crearTablasDeCampana(sql);
  sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?)", String(CIERRA));
  return { sql, db };
}

const T0 = 1_000 * VENTANA_CAMPANA_MS;
const CIERRA = T0 + 3_600_000;
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

const total = (sql: Ejecutar, tabla: string): number => {
  return sql<{ c: number }>(`SELECT COUNT(*) AS c FROM ${tabla}`)[0]?.c ?? 0;
};

describe("el alta de una persona con la sesión ya verificada", () => {
  it("anota una vez, deja la llave y suma el contador de la vía", () => {
    const { sql } = nuevaSala();
    const r = anotarPersona(sql, alta(), siempre);
    expect(r).toMatchObject({ ok: true, cuenta: cuentaN(1), ya: false, n: 1 });
    expect(sql("SELECT cuenta, estado, llave FROM equipos")).toEqual([
      { cuenta: cuentaN(1), estado: "aceptado", llave: huella("llave-1") },
    ]);
    expect(sql("SELECT persona, cuenta FROM personas")).toEqual([{ persona: huella("persona-1"), cuenta: cuentaN(1) }]);
    expect(Number(sql<{ v: string }>("SELECT v FROM sala WHERE k = 'via-google'")[0]?.v)).toBe(1);
  });

  it("la misma persona con otra llave reingresa sin duplicarse y cambia la huella del celular", () => {
    const { sql } = nuevaSala();
    const primera = anotarPersona(sql, alta(), siempre);
    const segunda = anotarPersona(sql, alta({ llave: huella("llave-2") }), siempre);
    expect(segunda).toMatchObject({ ok: true, cuenta: cuentaN(1), ya: true });
    if (!primera.ok || !segunda.ok) throw new Error("el alta de prueba no entró");
    expect(segunda.n).toBe(primera.n);
    expect(total(sql, "equipos")).toBe(1);
    expect(total(sql, "personas")).toBe(1);
    expect(sql<{ llave: string }>("SELECT llave FROM equipos")[0]?.llave).toBe(huella("llave-2"));
  });

  it("la misma cuenta con otra persona da ajena", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    const r = anotarPersona(sql, alta({ persona: huella("persona-2"), llave: huella("llave-2") }), siempre);
    expect(r).toEqual({ ok: false, motivo: "ajena" });
    expect(total(sql, "equipos")).toBe(1);
  });

  it("con la campaña cerrada, la comprobación previa y el alta dan cerrada", () => {
    const { sql } = nuevaSala();
    sql("UPDATE sala SET v = 'cerrada' WHERE k = 'fase'");
    expect(antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-1", paseVale: true, ahora: T0 })).toEqual({
      ok: false,
      motivo: "cerrada",
    });
    expect(anotarPersona(sql, alta(), siempre)).toEqual({ ok: false, motivo: "cerrada" });
  });

  it("con el pase comprobado como inválido, la comprobación previa da pase", () => {
    const { sql } = nuevaSala();
    expect(antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-1", paseVale: false, ahora: T0 })).toEqual({
      ok: false,
      motivo: "pase",
    });
  });

  it("el rechazo 301 de una conexión espera el resto de la ventana y después vuelve a entrar", () => {
    const { sql } = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `ficha-${i}`, T0);
    expect(antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-nueva", paseVale: true, ahora: T0 })).toEqual({
      ok: false,
      motivo: "rechazos",
      esperaS: VENTANA_CAMPANA_MS / 1000,
    });
    const siguiente = T0 + VENTANA_CAMPANA_MS;
    expect(antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-nueva", paseVale: true, ahora: siguiente })).toEqual({
      ok: true,
    });
  });

  it("una persona o una cuenta con motivo de salida da quitada", () => {
    const a = nuevaSala();
    a.sql(
      "INSERT INTO campana_quitadas (cuenta, persona, llave, motivo) VALUES (?, ?, ?, 'prueba')",
      cuentaN(9),
      huella("persona-1"),
      huella("llave-9"),
    );
    expect(anotarPersona(a.sql, alta(), siempre)).toEqual({ ok: false, motivo: "quitada" });
    const b = nuevaSala();
    b.sql(
      "INSERT INTO campana_quitadas (cuenta, persona, llave, motivo) VALUES (?, ?, ?, 'prueba')",
      cuentaN(1),
      huella("persona-9"),
      huella("llave-9"),
    );
    expect(anotarPersona(b.sql, alta(), siempre)).toEqual({ ok: false, motivo: "quitada" });
  });

  it("150 altas de una misma conexión en el mismo minuto entran todas", () => {
    const { sql } = nuevaSala();
    for (let i = 0; i < 150; i++) {
      const entrada = alta({ persona: huella(`persona-${i}`), cuenta: cuentaN(i), llave: huella(`llave-${i}`) });
      expect(anotarPersona(sql, entrada, siempre).ok).toBe(true);
    }
    expect(total(sql, "equipos")).toBe(150);
    expect(sql("SELECT altas, envios FROM ritmo")).toEqual([{ altas: 150, envios: 150 }]);
  });

  it("el ritmo de la sala da rapido y no se consulta cuando la campaña está cerrada", () => {
    const { sql } = nuevaSala();
    let llamadas = 0;
    const frenada = (): boolean => {
      llamadas++;
      return false;
    };
    expect(anotarPersona(sql, alta(), frenada)).toEqual({ ok: false, motivo: "rapido" });
    expect(llamadas).toBe(1);
    sql("UPDATE sala SET v = 'cerrada' WHERE k = 'fase'");
    expect(anotarPersona(sql, alta({ cuenta: cuentaN(2), persona: huella("persona-2") }), frenada)).toEqual({
      ok: false,
      motivo: "cerrada",
    });
    expect(llamadas).toBe(1);
  });

  it("la alta 301 da llena", () => {
    const { sql } = nuevaSala();
    for (let i = 0; i < CAMPANA_MAX; i++) {
      const entrada = alta({ persona: huella(`persona-${i}`), cuenta: cuentaN(i), llave: huella(`llave-${i}`) });
      expect(anotarPersona(sql, entrada, siempre).ok).toBe(true);
    }
    const extra = alta({ persona: huella("persona-extra"), cuenta: cuentaN(301), llave: huella("llave-extra") });
    expect(anotarPersona(sql, extra, siempre)).toEqual({ ok: false, motivo: "llena" });
  });

  it("dos altas seguidas de la misma persona dejan una sola fila", () => {
    const { sql } = nuevaSala();
    const entrada = alta();
    expect(anotarPersona(sql, entrada, siempre)).toMatchObject({ ok: true, ya: false });
    expect(anotarPersona(sql, entrada, siempre)).toMatchObject({ ok: true, ya: true });
    expect(total(sql, "equipos")).toBe(1);
    expect(total(sql, "personas")).toBe(1);
  });

  it("el estado reconoce solo la llave correcta y nunca devuelve el número de anotación", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    expect(estadoDeCelular(sql, cuentaN(1), huella("llave-1"))).toEqual({
      fase: "abierta",
      total: 1,
      cierraMs: CIERRA,
      anotada: true,
    });
    const otro = estadoDeCelular(sql, cuentaN(1), huella("llave-2"));
    expect(otro).toEqual({ fase: "abierta", total: 1, cierraMs: CIERRA, anotada: false });
    expect(otro).not.toHaveProperty("n");
  });
});

/** El día y la hora de las pruebas de contrato: el reloj lo mueve cada prueba. */
const AHORA_CONTRATO = Date.UTC(2026, 10, 21, 15, 0, 0);
const CIERRA_CONTRATO = AHORA_CONTRATO + 3_600_000;
const VERIFY = "/v3/tokens/verify";

describe("el contrato del alta de campaña en la sala (issue #168, residual en sala)", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA_CONTRATO);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function total(): Promise<number> {
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado`);
    return ((await r.json()) as { total: number }).total;
  }

  it("un instante antes del cierre todavía entra, y desde la hora de cierre da cerrada sin llamar al proveedor", async () => {
    mundo = await montarMundo();
    sala = await campanaAbierta(mundo, AHORA_CONTRATO);
    vi.setSystemTime(CIERRA_CONTRATO - 1);
    expect((await altaDe(mundo, sala.id, personaDePrueba(mundo, 1))).status).toBe(201);
    const antes = mundo.proveedor.llamadas[VERIFY] ?? 0;
    vi.setSystemTime(CIERRA_CONTRATO);
    const tarde = await altaDe(mundo, sala.id, personaDePrueba(mundo, 2));
    expect(tarde.status).toBe(409);
    expect(await tarde.json()).toEqual({ error: "cerrada" });
    // Fuera de hora no se pregunta nada a nadie: la campaña ya no recibe a nadie.
    expect(mundo.proveedor.llamadas[VERIFY] ?? 0).toBe(antes);
    expect(await total()).toBe(1);
  });

  it("pasada la hora de cierre, una persona nueva recibe cerrada sin ninguna llamada al proveedor, con o sin cuenta", async () => {
    mundo = await montarMundo();
    sala = await campanaAbierta(mundo, AHORA_CONTRATO);
    vi.setSystemTime(CIERRA_CONTRATO + 5 * 60_000);
    const conCuenta = personaDePrueba(mundo, 3);
    const sinCuenta = personaDePrueba(mundo, 4, { wallet: null });
    mundo.proveedor.billeteras.set(sinCuenta.usuario, null);
    for (const persona of [conCuenta, sinCuenta]) {
      const r = await altaDe(mundo, sala.id, persona);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "cerrada" });
    }
    // Ninguna ruta del proveedor, ni la que verifica la sesión ni la que busca la cuenta.
    expect(mundo.proveedor.llamadas).toEqual({});
    expect(await total()).toBe(0);
  });

  it("el código del QR de otro evento no sirve; con el pase de esta sala la misma persona entra", async () => {
    mundo = await montarMundo({ PASE: "1" });
    sala = await campanaAbierta(mundo, AHORA_CONTRATO);
    const otra = await campanaAbierta(mundo, AHORA_CONTRATO, { evento: "otra-feria" });
    const pase = async (cual: SalaDeCampana): Promise<string> => {
      const r = await mundo.pedir(`/v1/sala/${cual.id}/campana/pase`, {
        cabeceras: { Authorization: `Bearer ${cual.token}` },
      });
      expect(r.status).toBe(200);
      return ((await r.json()) as { p: string }).p;
    };
    const paseAjeno = await pase(otra);
    const pasePropio = await pase(sala);
    expect(paseAjeno).not.toBe(pasePropio);
    const persona = personaDePrueba(mundo, 1);
    const ajeno = await altaDe(mundo, sala.id, persona, { cuerpo: { p: paseAjeno } });
    expect(ajeno.status).toBe(409);
    expect(await ajeno.json()).toEqual({ error: "pase" });
    const propio = await altaDe(mundo, sala.id, persona, { cuerpo: { p: pasePropio } });
    expect(propio.status).toBe(201);
  });
});
