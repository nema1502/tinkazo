import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { FORMA_NOMBRES, MAX_CORRECCIONES, anotarNombre, crearTablasDeNombres, leerNombres } from "../../workers/sala/src/nombres";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import { cifrarNombre, generarClave, huellaNombre } from "./cifra";

/** Las reglas del alta de nombres con un SQLite de verdad, sin Worker ni red. */

function nuevaSala(nueva = true): { sql: Ejecutar; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
  sql("CREATE TABLE sala (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  if (nueva) {
    crearTablasDeNombres(sql);
    sql("INSERT INTO sala (k, v) VALUES ('forma', ?)", FORMA_NOMBRES);
  } else {
    sql("CREATE TABLE nombres (n INTEGER PRIMARY KEY AUTOINCREMENT, d TEXT NOT NULL)");
  }
  return { sql, db };
}

const siempre = (): boolean => true;
const llaveNueva = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
const claveA = generarClave();
const claveB = generarClave();

async function cuerpo(nombre: string, llave: string, clave = claveA): Promise<string> {
  return JSON.stringify({ d: await cifrarNombre(clave, nombre), h: await huellaNombre(clave, nombre), llave });
}

async function alta(sql: Ejecutar, nombre: string, llave: string, nueva = true, clave = claveA) {
  return anotarNombre(sql, await cuerpo(nombre, llave, clave), nueva, siempre);
}

const filas = (sql: Ejecutar) => sql<{ n: number; d: string; h: string | null; llave: string | null; r: string | null }>("SELECT * FROM nombres ORDER BY n");

describe("una alta por celular y nombres que no se repiten", () => {
  it("la misma sala rechaza el mismo nombre normalizado desde otro celular, y otra sala lo acepta", async () => {
    const { sql } = nuevaSala();
    expect(await alta(sql, "Ana Pérez", llaveNueva())).toMatchObject({ ok: true, creada: true });
    expect(await alta(sql, " ana  pérez ", llaveNueva())).toEqual({ ok: false, motivo: "repetido" });
    expect(filas(sql)).toHaveLength(1);

    const { sql: otra } = nuevaSala();
    expect(await alta(otra, "Ana Pérez", llaveNueva(), true, claveB)).toMatchObject({ ok: true, creada: true });
    expect(filas(otra)).toHaveLength(1);
  });

  it("la misma llave corrige borrando e insertando, conserva la historia y no guarda la llave", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const primera = await alta(sql, "Ana", llave);
    if (!primera.ok) throw new Error("no se anotó");
    const corregida = await alta(sql, "Ana Quispe", llave);
    expect(corregida).toMatchObject({ ok: true, creada: false, r: [primera.n] });
    if (!corregida.ok) return;
    expect(corregida.avisos[0]).toEqual({ t: "quitado", n: primera.n });
    expect(corregida.avisos[1]).toMatchObject({ t: "nombre", n: corregida.n, r: [primera.n] });
    expect(filas(sql)).toHaveLength(1);
    expect(filas(sql)[0]?.llave).toBe(createHash("sha256").update(llave).digest("hex"));
    expect(JSON.stringify(filas(sql))).not.toContain(llave);
    expect(leerNombres(sql, 0, true)).toEqual([{ n: corregida.n, d: filas(sql)[0]?.d, r: [primera.n] }]);

    expect(await alta(sql, "Beto", llaveNueva())).toMatchObject({ ok: true, creada: true });
    expect(filas(sql)).toHaveLength(2);
  });

  it("permite cinco correcciones, frena la sexta y no cobra volver a mandar el mismo nombre", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const primera = await alta(sql, "Nombre 0", llave);
    if (!primera.ok) throw new Error("no se anotó");
    expect(await alta(sql, " nombre   0 ", llave)).toMatchObject({ ok: true, n: primera.n, creada: false, avisos: [] });

    let ultimo = primera.n;
    for (let i = 1; i <= MAX_CORRECCIONES; i++) {
      const r = await alta(sql, `Nombre ${i}`, llave);
      expect(r).toMatchObject({ ok: true, creada: false });
      if (r.ok) {
        expect(r.r).toHaveLength(i);
        ultimo = r.n;
      }
    }
    expect(await alta(sql, "NOMBRE 5", llave)).toMatchObject({ ok: true, n: ultimo, creada: false, avisos: [] });
    expect(await alta(sql, "Nombre 6", llave)).toEqual({ ok: false, motivo: "correcciones" });
    expect(filas(sql)).toHaveLength(1);
  });

  it("una corrección hacia el nombre de otro celular deja la fila vieja intacta", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await alta(sql, "Ana", llaveNueva());
    await alta(sql, "Beto", llave);
    const antes = filas(sql);
    expect(await alta(sql, " ana ", llave)).toEqual({ ok: false, motivo: "repetido" });
    expect(filas(sql)).toEqual(antes);
  });

  it("si quien organiza quita la fila, ese celular puede anotarse otra vez", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const primera = await alta(sql, "Ana", llave);
    if (!primera.ok) throw new Error("no se anotó");
    sql("DELETE FROM nombres WHERE n = ?", primera.n);
    expect(await alta(sql, "Ana", llave)).toMatchObject({ ok: true, creada: true });
    expect(filas(sql)).toHaveLength(1);
  });
});

describe("la compatibilidad con las salas anteriores", () => {
  it("una sala vieja acepta texto plano y JSON, y sigue sin rechazar repetidos", async () => {
    const { sql } = nuevaSala(false);
    const d = await cifrarNombre(claveA, "Ana");
    expect(await anotarNombre(sql, d, false, siempre)).toMatchObject({ ok: true, creada: true });
    expect(await anotarNombre(sql, await cuerpo(" ana ", llaveNueva()), false, siempre)).toMatchObject({ ok: true, creada: true });
    expect(filas(sql)).toHaveLength(2);
    expect(leerNombres(sql, 0, false).every((x) => x.r === undefined)).toBe(true);
  });

  it("una sala nueva rechaza el alta sin huella o sin llave", async () => {
    const { sql } = nuevaSala();
    const d = await cifrarNombre(claveA, "Ana");
    const h = await huellaNombre(claveA, "Ana");
    for (const c of [d, JSON.stringify({ d, h }), JSON.stringify({ d, llave: llaveNueva() }), JSON.stringify({ d, h: "corta", llave: llaveNueva() })]) {
      expect(await anotarNombre(sql, c, true, siempre)).toEqual({ ok: false, motivo: "forma" });
    }
    expect(filas(sql)).toEqual([]);
  });
});
