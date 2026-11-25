import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  FichasVerificadas,
  MEMORIA_DE_FICHA_MS,
  RECHAZOS_POR_CONEXION,
  RECHAZOS_POR_FICHA,
  REINGRESOS_POR_PERSONA_POR_HORA,
  VENTANA_CAMPANA_MS,
  anotarPersona,
  antesDeVerificar,
  contarRechazo,
  crearTablasDeCampana,
  prealtaDeCampana,
  quitarPersona,
  reingresoDeCampana,
  siYaEsta,
  topeDeConexion,
  type AltaDePersona,
} from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";

/** Los topes de rechazos y de reingresos contra un SQLite de verdad, con huellas inventadas y sin llamadas al proveedor. */
function nuevaSala(): Ejecutar {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => {
    return db.prepare(consulta).all(...p) as unknown as T[];
  };
  crearTablasDeCampana(sql);
  sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?)", String(T0 + 3_600_000));
  return sql;
}

const T0 = 1_000 * VENTANA_CAMPANA_MS;
const HORA = 3_600_000;
const huella = (s: string): string => createHash("sha256").update(s).digest("hex");
const cuentaN = (i: number): string => `G${String(i).padStart(55, "B")}`;
const siempre = (): boolean => true;

function alta(i: number, ahora = T0): AltaDePersona {
  return {
    persona: huella(`persona-${i}`),
    cuenta: cuentaN(i),
    d: "datos-cifrados-de-prueba",
    llave: huella(`llave-${i}-0`),
    grupo: "conexion-1",
    ahora,
    via: "google",
  };
}

const entrada = (i: number, k: number, ahora = T0) => ({
  persona: huella(`persona-${i}`),
  llave: huella(`llave-${i}-${k}`),
  grupo: "conexion-1",
  ahora,
});

describe("las fichas verificadas hace poco", () => {
  it("recuerda la persona de una ficha un minuto y después la suelta", () => {
    const fichas = new FichasVerificadas();
    fichas.recordar("f1", "persona-1", T0, T0 + HORA);
    expect(fichas.personaDe("f1", T0 + MEMORIA_DE_FICHA_MS - 1)).toBe("persona-1");
    expect(fichas.personaDe("f1", T0 + MEMORIA_DE_FICHA_MS)).toBeNull();
    expect(fichas.cantidad).toBe(0);
  });

  it("no la recuerda más allá del vencimiento de su sesión", () => {
    const fichas = new FichasVerificadas();
    fichas.recordar("f1", "persona-1", T0, T0 + 10_000);
    expect(fichas.personaDe("f1", T0 + 9_999)).toBe("persona-1");
    expect(fichas.personaDe("f1", T0 + 10_000)).toBeNull();
  });

  it("una ficha que no se conoce da null", () => {
    expect(new FichasVerificadas().personaDe("f1", T0)).toBeNull();
  });

  it("con el máximo lleno suelta primero las vencidas y después la más vieja, y nunca pasa del máximo", () => {
    const fichas = new FichasVerificadas(3);
    fichas.recordar("vieja", "p", T0, T0 + HORA);
    fichas.recordar("a", "p", T0 + 1, T0 + HORA);
    fichas.recordar("b", "p", T0 + 2, T0 + HORA);
    fichas.recordar("c", "p", T0 + 3, T0 + HORA);
    expect(fichas.cantidad).toBe(3);
    expect(fichas.personaDe("vieja", T0 + 3)).toBeNull();
    expect(fichas.personaDe("c", T0 + 3)).toBe("p");
    // Con todas vencidas, entra la nueva y se van las demás.
    fichas.recordar("d", "p", T0 + 5 * MEMORIA_DE_FICHA_MS, T0 + 10 * HORA);
    expect(fichas.cantidad).toBe(1);
  });
});

describe("el tope de rechazos por ficha y por conexión", () => {
  it("una ficha repetida suma una sola vez a la conexión", () => {
    const sql = nuevaSala();
    for (let i = 0; i < 50; i++) contarRechazo(sql, "conexion-1", "ficha-mala", T0);
    expect(sql<{ n: number }>("SELECT n FROM campana_rechazos")[0]?.n).toBe(1);
    expect(sql<{ n: number }>("SELECT n FROM campana_rechazos_ficha")[0]?.n).toBe(50);
  });

  it("fichas distintas suman cada una a la conexión", () => {
    const sql = nuevaSala();
    for (let i = 0; i < 10; i++) contarRechazo(sql, "conexion-1", `ficha-${i}`, T0);
    expect(sql<{ n: number }>("SELECT n FROM campana_rechazos")[0]?.n).toBe(10);
  });

  it("la ficha cortada da rechazos y las demás fichas de la misma conexión siguen pasando", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazo(sql, "conexion-1", "ficha-mala", T0);
    const cortada = antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-mala", paseVale: true, ahora: T0 });
    expect(cortada).toEqual({ ok: false, motivo: "rechazos", esperaS: VENTANA_CAMPANA_MS / 1000 });
    expect(antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-buena", paseVale: true, ahora: T0 })).toEqual({ ok: true });
  });

  it("la ficha vuelve a poder pasar en la ventana siguiente", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazo(sql, "conexion-1", "ficha-mala", T0);
    const siguiente = T0 + VENTANA_CAMPANA_MS;
    expect(antesDeVerificar(sql, { grupo: "conexion-1", ficha: "ficha-mala", paseVale: true, ahora: siguiente })).toEqual({ ok: true });
  });

  it("lo que se rechaza antes de llamar (fase y pase) no suma a ningún tope", () => {
    const sql = nuevaSala();
    sql("UPDATE sala SET v = 'cerrada' WHERE k = 'fase'");
    for (let i = 0; i < 1_000; i++) antesDeVerificar(sql, { grupo: "conexion-1", ficha: `f${i}`, paseVale: false, ahora: T0 });
    sql("UPDATE sala SET v = 'abierta' WHERE k = 'fase'");
    for (let i = 0; i < 1_000; i++) antesDeVerificar(sql, { grupo: "conexion-1", ficha: `f${i}`, paseVale: false, ahora: T0 });
    expect(sql("SELECT * FROM campana_rechazos")).toEqual([]);
    expect(sql("SELECT * FROM campana_rechazos_ficha")).toEqual([]);
  });

  it("una ficha reconocida pasa el tope agotado de la conexión, pero no el de su propia ficha", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `ficha-${i}`, T0);
    const datos = { grupo: "conexion-1", ficha: "ficha-buena", paseVale: true, ahora: T0 };
    expect(antesDeVerificar(sql, datos).ok).toBe(false);
    expect(antesDeVerificar(sql, { ...datos, reconocida: true })).toEqual({ ok: true });
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazo(sql, "conexion-1", "ficha-buena", T0);
    expect(antesDeVerificar(sql, { ...datos, reconocida: true }).ok).toBe(false);
  });

  it("un rechazo sin contar la conexión suma a la ficha y deja la conexión como estaba", () => {
    const sql = nuevaSala();
    contarRechazo(sql, "conexion-1", "ficha-espera", T0, false);
    contarRechazo(sql, "conexion-1", "ficha-espera", T0, false);
    expect(sql<{ n: number }>("SELECT n FROM campana_rechazos_ficha WHERE ficha = 'ficha-espera'")[0]?.n).toBe(2);
    expect(sql("SELECT * FROM campana_rechazos")).toEqual([]);
  });

  it("300 fichas que esperan su cuenta no frenan a la persona 301", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `espera-${i}`, T0, false);
    expect(topeDeConexion(sql, "conexion-1", T0)).toEqual({ ok: true });
    const nueva = { grupo: "conexion-1", ficha: "espera-300", paseVale: true, ahora: T0 };
    expect(antesDeVerificar(sql, nueva)).toEqual({ ok: true });
    // La que sigue esperando su cuenta vuelve a pasar en su segundo pedido.
    expect(antesDeVerificar(sql, { ...nueva, ficha: "espera-0" })).toEqual({ ok: true });
  });

  it("la ficha que espera su cuenta se frena a la sexta, y la conexión sigue libre", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_FICHA; i++) contarRechazo(sql, "conexion-1", "ficha-espera", T0, false);
    const dato = { grupo: "conexion-1", ficha: "ficha-espera", paseVale: true, ahora: T0 };
    expect(antesDeVerificar(sql, dato)).toEqual({ ok: false, motivo: "rechazos", esperaS: VENTANA_CAMPANA_MS / 1000 });
    expect(topeDeConexion(sql, "conexion-1", T0)).toEqual({ ok: true });
    expect(antesDeVerificar(sql, { ...dato, ficha: "otra" })).toEqual({ ok: true });
  });

  it("los rechazos de verdad siguen sumando a la conexión como antes", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `mala-${i}`, T0);
    expect(topeDeConexion(sql, "conexion-1", T0).ok).toBe(false);
  });

  it("topeDeConexion mira solo la conexión", () => {
    const sql = nuevaSala();
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `ficha-${i}`, T0);
    expect(topeDeConexion(sql, "conexion-1", T0).ok).toBe(false);
    expect(topeDeConexion(sql, "conexion-2", T0)).toEqual({ ok: true });
  });
});

describe("el reingreso antes de llamar al proveedor", () => {
  const preparar = (): { sql: Ejecutar; fichas: FichasVerificadas } => {
    const sql = nuevaSala();
    expect(anotarPersona(sql, alta(1), siempre).ok).toBe(true);
    return { sql, fichas: new FichasVerificadas() };
  };
  const previa = (ficha: string, k: number, ahora = T0) => ({
    grupo: "conexion-1",
    ficha,
    llave: huella(`llave-1-${k}`),
    paseVale: true,
    ahora,
  });

  it("con una ficha desconocida no hay reingreso: sigue la verificación", () => {
    const { sql, fichas } = preparar();
    expect(prealtaDeCampana(sql, fichas, previa("f1", 1))).toEqual({ ok: true, cuenta: null });
  });

  it("con la ficha de una sesión verificada hace menos de un minuto, devuelve la cuenta y cambia la llave", () => {
    const { sql, fichas } = preparar();
    expect(reingresoDeCampana(sql, fichas, { ...entrada(1, 1), ficha: "f1", vence: T0 + HORA })).toEqual({
      ok: true,
      cuenta: cuentaN(1),
    });
    const r = prealtaDeCampana(sql, fichas, previa("f1", 2, T0 + 30_000));
    expect(r).toEqual({ ok: true, cuenta: cuentaN(1) });
    expect(sql<{ llave: string }>("SELECT llave FROM equipos")[0]?.llave).toBe(huella("llave-1-2"));
  });

  it("pasado el minuto la ficha ya no se reconoce", () => {
    const { sql, fichas } = preparar();
    reingresoDeCampana(sql, fichas, { ...entrada(1, 1), ficha: "f1", vence: T0 + HORA });
    expect(prealtaDeCampana(sql, fichas, previa("f1", 2, T0 + MEMORIA_DE_FICHA_MS))).toEqual({ ok: true, cuenta: null });
  });

  it("la ficha reconocida pasa aunque el tope de rechazos de la conexión esté agotado", () => {
    const { sql, fichas } = preparar();
    reingresoDeCampana(sql, fichas, { ...entrada(1, 1), ficha: "f1", vence: T0 + HORA });
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `mala-${i}`, T0);
    expect(prealtaDeCampana(sql, fichas, previa("f1", 2))).toEqual({ ok: true, cuenta: expect.any(String) });
    expect(prealtaDeCampana(sql, fichas, previa("desconocida", 2)).ok).toBe(false);
  });

  it("si la persona fue quitada, la ficha reconocida contesta quitada sin pasar al proveedor", () => {
    const { sql, fichas } = preparar();
    reingresoDeCampana(sql, fichas, { ...entrada(1, 1), ficha: "f1", vence: T0 + HORA });
    expect(quitarPersona(sql, 1, "otro").ok).toBe(true);
    expect(prealtaDeCampana(sql, fichas, previa("f1", 2))).toEqual({ ok: false, motivo: "quitada" });
  });

  it("la ficha reconocida de una persona quitada no gasta el tope de la conexión ni los envíos", () => {
    const { sql, fichas } = preparar();
    reingresoDeCampana(sql, fichas, { ...entrada(1, 1), ficha: "f1", vence: T0 + HORA });
    expect(quitarPersona(sql, 1, "otro").ok).toBe(true);
    const antes = sql("SELECT * FROM ritmo");
    for (let i = 0; i < 50; i++) prealtaDeCampana(sql, fichas, previa("f1", 2));
    expect(sql("SELECT * FROM ritmo")).toEqual(antes);
    expect(sql("SELECT * FROM campana_rechazos")).toEqual([]);
  });

  it("una persona que ya no está y no salió con motivo sigue a la verificación, con el tope de la conexión", () => {
    const { sql, fichas } = preparar();
    fichas.recordar("f9", huella("persona-9"), T0, T0 + HORA);
    expect(prealtaDeCampana(sql, fichas, previa("f9", 2))).toEqual({ ok: true, cuenta: null });
    for (let i = 0; i < RECHAZOS_POR_CONEXION; i++) contarRechazo(sql, "conexion-1", `mala-${i}`, T0);
    expect(prealtaDeCampana(sql, fichas, previa("f9", 2)).ok).toBe(false);
  });

  it("con la campaña cerrada ni la ficha reconocida reingresa", () => {
    const { sql, fichas } = preparar();
    reingresoDeCampana(sql, fichas, { ...entrada(1, 1), ficha: "f1", vence: T0 + HORA });
    sql("UPDATE sala SET v = 'cerrada' WHERE k = 'fase'");
    expect(prealtaDeCampana(sql, fichas, previa("f1", 2))).toEqual({ ok: false, motivo: "cerrada" });
  });

  it("un reingreso que pasa el tope de la hora da cupo-conexion y no recuerda la ficha", () => {
    const { sql, fichas } = preparar();
    for (let k = 1; k <= REINGRESOS_POR_PERSONA_POR_HORA; k++) expect(siYaEsta(sql, entrada(1, k))?.ok).toBe(true);
    const r = reingresoDeCampana(sql, fichas, { ...entrada(1, 99), ficha: "f1", vence: T0 + HORA });
    expect(r).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(fichas.cantidad).toBe(0);
  });
});

describe("el tope de reingresos de cada persona", () => {
  it("seis por hora: el séptimo da cupo-conexion con lo que falta de la hora y no escribe nada", () => {
    const sql = nuevaSala();
    anotarPersona(sql, alta(1), siempre);
    for (let k = 1; k <= REINGRESOS_POR_PERSONA_POR_HORA; k++) {
      expect(siYaEsta(sql, entrada(1, k, T0 + k))).toEqual({ ok: true, cuenta: cuentaN(1) });
    }
    const antes = sql("SELECT * FROM equipos");
    const r = siYaEsta(sql, entrada(1, 77, T0 + 10));
    expect(r).toEqual({ ok: false, motivo: "cupo-conexion", esperaS: Math.ceil((HORA - ((T0 + 10) % HORA)) / 1000) });
    expect(sql("SELECT * FROM equipos")).toEqual(antes);
    expect(sql<{ llave: string }>("SELECT llave FROM equipos")[0]?.llave).toBe(huella(`llave-1-${REINGRESOS_POR_PERSONA_POR_HORA}`));
  });

  it("al repetir el alta completo, pasado el tope da cupo-conexion y no cambia la llave", () => {
    const sql = nuevaSala();
    anotarPersona(sql, alta(1), siempre);
    for (let k = 1; k <= REINGRESOS_POR_PERSONA_POR_HORA; k++) {
      expect(anotarPersona(sql, { ...alta(1), llave: huella(`llave-1-${k}`) }, siempre)).toMatchObject({ ok: true, ya: true });
    }
    const r = anotarPersona(sql, { ...alta(1), llave: huella("llave-1-77") }, siempre);
    expect(r).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(sql<{ llave: string }>("SELECT llave FROM equipos")[0]?.llave).toBe(huella(`llave-1-${REINGRESOS_POR_PERSONA_POR_HORA}`));
  });

  it("el tope es de cada persona y se renueva con la hora", () => {
    const sql = nuevaSala();
    anotarPersona(sql, alta(1), siempre);
    anotarPersona(sql, alta(2), siempre);
    for (let k = 1; k <= REINGRESOS_POR_PERSONA_POR_HORA; k++) siYaEsta(sql, entrada(1, k));
    expect(siYaEsta(sql, entrada(1, 77))?.ok).toBe(false);
    expect(siYaEsta(sql, entrada(2, 1))?.ok).toBe(true);
    expect(siYaEsta(sql, entrada(1, 78, T0 + HORA))?.ok).toBe(true);
  });

  it("una persona que no está anotada da null y no gasta el tope", () => {
    const sql = nuevaSala();
    expect(siYaEsta(sql, entrada(9, 1))).toBeNull();
    expect(sql("SELECT * FROM campana_reingresos")).toEqual([]);
  });
});
