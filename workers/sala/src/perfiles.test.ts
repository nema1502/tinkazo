import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as modulo from "./perfiles";
import { crearTablaDePerfiles, guardarPerfil, limpiarPerfil, perfilesPrendido } from "./perfiles";
import type { Ejecutar, ValorSql } from "./registro";

/**
 * El perfil de quien se anota con Google: qué prende guardarlo, cómo se limpia lo que trae el token y cómo queda en la
 * tabla. La tabla es un SQLite de verdad en memoria, con la misma función de consultas que usa el objeto de cupos.
 */

const CLIENTE = "cliente-de-prueba.apps.example.org";
const ID = "google:100000000000000000001";
const CORREO = "ana@example.org";
const FOTO = "https://fotos.example.org/a/ana=s96-c";
const CARITA = "\u{1F600}";

interface Fila {
  id: string;
  correo: string;
  nombre: string;
  foto: string;
  primera_ms: number;
  ultima_ms: number;
  veces: number;
}

interface Banco {
  sql: Ejecutar;
  /** Cada consulta que corrió después de crear la tabla, con sus parámetros. */
  consultas: { consulta: string; parametros: ValorSql[] }[];
  filas(): Fila[];
}

function banco(): Banco {
  const db = new DatabaseSync(":memory:");
  const consultas: Banco["consultas"] = [];
  const sql: Ejecutar = <T,>(consulta: string, ...parametros: ValorSql[]): T[] => {
    consultas.push({ consulta, parametros });
    return db.prepare(consulta).all(...parametros) as unknown as T[];
  };
  crearTablaDePerfiles(sql);
  consultas.length = 0;
  return { sql, consultas, filas: () => db.prepare("SELECT * FROM perfiles ORDER BY id").all() as unknown as Fila[] };
}

/** Lo que sale de un token verificado, con lo que cambie cada prueba. */
const datos = (cambios: Record<string, unknown> = {}): Parameters<typeof limpiarPerfil>[0] =>
  ({ usuario: ID, correo: CORREO, nombre: "Ana de Prueba", foto: FOTO, ...cambios }) as Parameters<typeof limpiarPerfil>[0];

describe("lo que hace el módulo y nada más", () => {
  it("exporta el interruptor, la tabla, la limpieza y el guardado, y ninguna otra cosa", () => {
    expect(Object.keys(modulo).sort()).toEqual(["crearTablaDePerfiles", "guardarPerfil", "limpiarPerfil", "perfilesPrendido"]);
  });

  it("su código no lee, no lista, no cuenta y no borra perfiles", () => {
    const fuente = readFileSync(fileURLToPath(new URL("./perfiles.ts", import.meta.url)), "utf8");
    expect(fuente).not.toMatch(/\b(SELECT|DELETE|DROP|ALTER|TRUNCATE|COUNT)\b/);
    // Dos sentencias en todo el archivo: la que crea la tabla y la que guarda.
    expect(fuente.match(/\bsql(?:<[^>]*>)?\(/g)).toHaveLength(2);
  });
});

describe("el interruptor de la sala", () => {
  const personas = { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE };

  it("solo el valor exacto 1 lo prende", () => {
    expect(perfilesPrendido({ ...personas, PERFILES: "1" })).toBe(true);
    expect(perfilesPrendido(personas)).toBe(false);
    for (const valor of ["", "0", "true", "si", "on", " 1", "1 ", "01", "1.0", "2"]) {
      expect(perfilesPrendido({ ...personas, PERFILES: valor }), JSON.stringify(valor)).toBe(false);
    }
  });

  it("sin las campañas de personas prendidas, la variable sola no prende nada", () => {
    expect(perfilesPrendido({ PERFILES: "1" })).toBe(false);
    expect(perfilesPrendido({ PERFILES: "1", DIFERIDA: "1" })).toBe(false);
    expect(perfilesPrendido({ PERFILES: "1", DIFERIDA: "1", GOOGLE_CLIENT_ID: "  " })).toBe(false);
    expect(perfilesPrendido({ PERFILES: "1", DIFERIDA: "0", GOOGLE_CLIENT_ID: CLIENTE })).toBe(false);
    expect(perfilesPrendido({ PERFILES: "1", GOOGLE_CLIENT_ID: CLIENTE })).toBe(false);
  });
});

describe("el archivo de la sala", () => {
  it("trae el interruptor apagado, justo debajo del identificador de Google", () => {
    const toml = readFileSync(fileURLToPath(new URL("../wrangler.toml", import.meta.url)), "utf8");
    const lineas = toml.split(/\r?\n/);
    expect(lineas.filter((l) => /^\s*PERFILES\s*=/.test(l))).toEqual(['PERFILES = "0"']);
    const variables = lineas.filter((l) => /^[A-Z_]+\s*=/.test(l));
    expect(variables[variables.indexOf('PERFILES = "0"') - 1]).toBe('GOOGLE_CLIENT_ID = ""');
    // Tal como está escrito, el archivo no prende nada: ni las campañas de personas ni los perfiles.
    const vars = Object.fromEntries(variables.map((l) => /^([A-Z_]+)\s*=\s*"([^"]*)"/.exec(l)?.slice(1, 3) ?? []));
    expect(perfilesPrendido(vars)).toBe(false);
    expect(perfilesPrendido({ ...vars, DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE })).toBe(false);
  });
});

describe("lo que dicen los documentos de la sala", () => {
  const leer = (ruta: string): string => readFileSync(fileURLToPath(new URL(`../../../${ruta}`, import.meta.url)), "utf8");
  const hoja = leer("docs/operacion.md");
  const readme = leer("workers/sala/README.md");
  /** Las celdas de la fila de una tabla que empieza por esa variable, o null si no hay ninguna. */
  const fila = (texto: string, variable: string): string[] | null => {
    const linea = texto.split(/\r?\n/).find((l) => l.startsWith(`| \`${variable}\` |`));
    return linea === undefined ? null : linea.split("|").slice(1, -1).map((c) => c.trim());
  };

  it("la hoja de operación trae los dos interruptores apagados, cada uno en su tabla", () => {
    // La tabla de banderas del sitio, con la misma forma que la fila de anotarse sin billetera.
    const delSitio = fila(hoja, "VITE_GUARDAR_PERFIL");
    expect(delSitio).toHaveLength(4);
    expect(delSitio?.slice(0, 3)).toEqual(["`VITE_GUARDAR_PERFIL`", "apagada, solo con `1`", "`sin definir`"]);
    expect(fila(hoja, "VITE_ANOTARSE_SIN_BILLETERA")?.slice(1, 3)).toEqual(delSitio?.slice(1, 3));
    // La tabla de las variables de la sala, con el mismo valor que trae su archivo.
    const deLaSala = fila(hoja, "PERFILES");
    expect(deLaSala).toHaveLength(3);
    expect(deLaSala?.slice(0, 2)).toEqual(["`PERFILES`", '`"0"`']);
    expect(leer("workers/sala/wrangler.toml")).toMatch(/^PERFILES = "0"\r?$/m);
  });

  /** El texto en un solo renglón: los párrafos del README vienen cortados y una frase puede caer en dos. */
  const plano = (texto: string): string => texto.replace(/\s+/g, " ");
  const documentos = [
    ["hoja de operación", plano(hoja)],
    ["README de la sala", plano(readme)],
  ] as const;
  /** Si el texto trae la frase. Se afirma sobre un sí o un no para que una falla nombre la frase y no vuelque el documento. */
  const dice = (texto: string, frase: string | RegExp): boolean => (typeof frase === "string" ? texto.includes(frase) : frase.test(texto));

  it("los dos dicen dónde se guarda, en qué orden se prende y se apaga, y que todavía no hay cómo leer ni borrar", () => {
    const frases: (string | RegExp)[] = [
      "la tabla `perfiles`",
      /no se borra con las? salas?/,
      "`PERFILES`",
      "`VITE_GUARDAR_PERFIL`",
      /\*\*Para prender\*\*.{0,120}primero la sala.{0,200}después el sitio/,
      /\*\*Para apagar\*\*.{0,120}primero el sitio/,
      "Todavía no hay herramienta para leer ni para borrar un perfil",
      "Un pedido de borrado se anota y se cumple cuando llegue esa herramienta",
    ];
    for (const [nombre, texto] of documentos) {
      for (const frase of frases) expect(dice(texto, frase), `${nombre}: ${String(frase)}`).toBe(true);
    }
  });

  it("ninguno sigue diciendo, sin más, que del token no se guarda nada", () => {
    const viejas = [
      "**Lo que no se guarda.**",
      "choca con la regla de no guardar nada que la identifique",
      "ni se guarda nada que lleve de una línea a una persona",
      "no se guarda nada para volver de una línea a una persona",
      "Tinkazo no guarda nada para comprobar quién es una persona a partir de su línea",
    ];
    // Lo que pasa con el interruptor apagado y prendido está dicho en los dos.
    const nuevas = [/Apagado\*{0,2}, .{0,200}no se guarda nada del token/, /Prendido\*{0,2}, .{0,300}el correo, el nombre y la dirección de la foto/];
    for (const [nombre, texto] of documentos) {
      for (const frase of viejas) expect(dice(texto, frase), `${nombre}: ${frase}`).toBe(false);
      for (const frase of nuevas) expect(dice(texto, frase), `${nombre}: ${String(frase)}`).toBe(true);
    }
  });
});

describe("la tabla de perfiles", () => {
  it("tiene siete columnas, con el identificador como clave y todo lo demás obligatorio", () => {
    const { sql } = banco();
    const columnas = sql<{ name: string; type: string; obligatoria: number; pk: number }>(
      'SELECT name, type, "notnull" AS obligatoria, pk FROM pragma_table_info(\'perfiles\')',
    );
    expect(columnas.map((c) => [c.name, c.type])).toEqual([
      ["id", "TEXT"],
      ["correo", "TEXT"],
      ["nombre", "TEXT"],
      ["foto", "TEXT"],
      ["primera_ms", "INTEGER"],
      ["ultima_ms", "INTEGER"],
      ["veces", "INTEGER"],
    ]);
    expect(columnas.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(["id"]);
    expect(columnas.filter((c) => c.name !== "id").every((c) => c.obligatoria === 1)).toBe(true);
  });

  it("crearla otra vez no borra lo guardado", () => {
    const b = banco();
    guardarPerfil(b.sql, { id: ID, correo: CORREO, nombre: "Ana", foto: FOTO }, 1_000);
    crearTablaDePerfiles(b.sql);
    crearTablaDePerfiles(b.sql);
    expect(b.filas()).toHaveLength(1);
  });
});

describe("limpiar lo que trae el token", () => {
  it("un perfil prolijo sale igual, con el usuario como identificador", () => {
    expect(limpiarPerfil(datos())).toEqual({ id: ID, correo: CORREO, nombre: "Ana de Prueba", foto: FOTO });
  });

  it("el identificador tiene que ser el de una cuenta de Google y medir hasta 262 caracteres", () => {
    const justo = `google:${"9".repeat(255)}`;
    expect(justo).toHaveLength(262);
    expect(limpiarPerfil(datos({ usuario: justo }))?.id).toBe(justo);
    for (const usuario of [`${justo}9`, "google:", "", "100000000000000000001", "Google:1", " google:1", "otro:1", "usuario1", 7, null, undefined]) {
      expect(limpiarPerfil(datos({ usuario })), JSON.stringify(usuario)).toBeNull();
    }
  });

  it("el correo queda sin espacios alrededor", () => {
    expect(limpiarPerfil(datos({ correo: "  ana@example.org \n" }))?.correo).toBe("ana@example.org");
  });

  it("un correo raro no deja guardar nada: ni el nombre ni la foto", () => {
    const largo = `${"a".repeat(242)}@example.org`;
    expect(largo).toHaveLength(254);
    expect(limpiarPerfil(datos({ correo: largo }))?.correo).toBe(largo);
    expect(limpiarPerfil(datos({ correo: "a@b" }))?.correo).toBe("a@b");
    const raros: unknown[] = [
      `a${largo}`,
      "",
      "   ",
      "ab",
      "a@",
      "@b",
      "@",
      "ana.example.org",
      "ana@@example.org",
      "ana@example@org",
      "ana @example.org",
      "ana@exam ple.org",
      "ana\t@example.org",
      "ana\n@example.org",
      "ana\u0000@example.org",
      "ana\u007f@example.org",
      "ana @example.org",
      "ana​@example.org",
      "ana‮@example.org",
      "ana\ud83d@example.org",
      7,
      null,
      undefined,
      { correo: CORREO },
      [CORREO],
    ];
    for (const correo of raros) expect(limpiarPerfil(datos({ correo })), JSON.stringify(correo)).toBeNull();
  });

  it("el nombre queda sin controles ni invisibles, con un solo espacio entre palabras y sin espacios alrededor", () => {
    const casos: [unknown, string][] = [
      ["Ana", "Ana"],
      ["  Ana   de \t Prueba \r\n", "Ana de Prueba"],
      ["Ana\nNora", "Ana Nora"],
      ["Ana  Nora", "Ana Nora"],
      ["Ana\u0000 \u0007 Nora\u001b", "Ana Nora"],
      ["A​n‍a‮⁦﻿", "Ana"],
      ["Be­to", "Beto"],
      ["Ana\ud83d", "Ana"],
      [`Ana ${CARITA}`, `Ana ${CARITA}`],
      ["Betó", "Betó"],
      ["", ""],
      [" \t\n​ ", ""],
      [7, ""],
      [null, ""],
      [undefined, ""],
      [{ nombre: "Ana" }, ""],
      [["Ana"], ""],
      [true, ""],
    ];
    for (const [nombre, limpio] of casos) expect(limpiarPerfil(datos({ nombre }))?.nombre, JSON.stringify(nombre)).toBe(limpio);
  });

  it("un nombre muy largo se corta a 120 puntos de código, sin partir un emoji ni dejar un espacio al final", () => {
    expect(limpiarPerfil(datos({ nombre: "a".repeat(500) }))?.nombre).toBe("a".repeat(120));
    expect(limpiarPerfil(datos({ nombre: "a".repeat(120) }))?.nombre).toBe("a".repeat(120));
    const caritas = limpiarPerfil(datos({ nombre: CARITA.repeat(200) }))?.nombre ?? "";
    expect(caritas).toBe(CARITA.repeat(120));
    expect(caritas).toHaveLength(240);
    // El corte cae justo después de un emoji: queda entero, no su primera mitad.
    const alFilo = limpiarPerfil(datos({ nombre: `${"a".repeat(119)}${CARITA}b` }))?.nombre ?? "";
    expect(alFilo).toBe(`${"a".repeat(119)}${CARITA}`);
    expect(Array.from(alFilo)).toHaveLength(120);
    expect(/\p{Cs}/u.test(alFilo)).toBe(false);
    expect(limpiarPerfil(datos({ nombre: `${"a".repeat(119)} bcd` }))?.nombre).toBe("a".repeat(119));
  });

  it("la foto se guarda solo si es una dirección https bien formada de hasta 600 caracteres", () => {
    const justa = `https://fotos.example.org/${"a".repeat(574)}`;
    expect(justa).toHaveLength(600);
    for (const foto of [FOTO, justa, "https://example.org", "https://example.org/a/b.jpg?s=96&c=1#x"]) {
      expect(limpiarPerfil(datos({ foto }))?.foto, foto).toBe(foto);
    }
    const malas: unknown[] = [
      `${justa}a`,
      "http://fotos.example.org/a.jpg",
      "HTTPS://fotos.example.org/a.jpg",
      "//fotos.example.org/a.jpg",
      "fotos.example.org/a.jpg",
      "/a.jpg",
      "https://",
      "https:///",
      "https://?a=1",
      "https:// fotos.example.org/a.jpg",
      "https://fotos.example.org/a b.jpg",
      " https://fotos.example.org/a.jpg",
      "https://fotos.example.org/a.jpg\n",
      "https://fotos.example.org/\u0000a.jpg",
      "https://fotos.example.org/​a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "ftp://fotos.example.org/a.jpg",
      "",
      7,
      null,
      undefined,
      { foto: FOTO },
      [FOTO],
    ];
    for (const foto of malas) {
      const limpio = limpiarPerfil(datos({ foto }));
      expect(limpio?.foto, JSON.stringify(foto)).toBe("");
      // Una foto que no sirve no impide guardar el resto.
      expect(limpio?.correo).toBe(CORREO);
    }
  });

  it("nunca lanza, le den lo que le den", () => {
    for (const cosa of [null, undefined, 7, "texto", [], {}]) {
      expect(limpiarPerfil(cosa as unknown as Parameters<typeof limpiarPerfil>[0]), JSON.stringify(cosa)).toBeNull();
    }
  });
});

describe("guardar un perfil", () => {
  const ana = { id: ID, correo: CORREO, nombre: "Ana de Prueba", foto: FOTO };
  const nora = { id: "google:100000000000000000002", correo: "nora@example.org", nombre: "Nora", foto: "" };

  /** Lo que hace la sala con un token verificado: limpia y, si queda un perfil, lo guarda. */
  const anotar = (b: Banco, crudos: Record<string, unknown>, ahora: number): { nueva: boolean } | null => {
    const perfil = limpiarPerfil(datos(crudos));
    return perfil === null ? null : guardarPerfil(b.sql, perfil, ahora);
  };

  it("una persona nueva deja una fila, con la misma hora en las dos marcas y una vez", () => {
    const b = banco();
    expect(guardarPerfil(b.sql, ana, 1_000)).toEqual({ nueva: true });
    expect(b.filas()).toEqual([{ ...ana, primera_ms: 1_000, ultima_ms: 1_000, veces: 1 }]);
  });

  it("la misma persona otra vez actualiza el correo, el nombre y la foto, suma una vez y conserva la primera hora", () => {
    const b = banco();
    guardarPerfil(b.sql, ana, 1_000);
    const cambiada = { id: ID, correo: "ana.nueva@example.org", nombre: "Ana", foto: "" };
    expect(guardarPerfil(b.sql, cambiada, 5_000)).toEqual({ nueva: false });
    expect(b.filas()).toEqual([{ ...cambiada, primera_ms: 1_000, ultima_ms: 5_000, veces: 2 }]);
    expect(guardarPerfil(b.sql, ana, 9_000)).toEqual({ nueva: false });
    expect(b.filas()).toEqual([{ ...ana, primera_ms: 1_000, ultima_ms: 9_000, veces: 3 }]);
  });

  it("dos personas son dos filas, y cada una lleva su cuenta", () => {
    const b = banco();
    expect(guardarPerfil(b.sql, ana, 1_000)).toEqual({ nueva: true });
    expect(guardarPerfil(b.sql, nora, 2_000)).toEqual({ nueva: true });
    expect(guardarPerfil(b.sql, nora, 3_000)).toEqual({ nueva: false });
    expect(b.filas()).toEqual([
      { ...ana, primera_ms: 1_000, ultima_ms: 1_000, veces: 1 },
      { ...nora, primera_ms: 2_000, ultima_ms: 3_000, veces: 2 },
    ]);
  });

  it("es una sola sentencia, y los datos viajan aparte de su texto", () => {
    const b = banco();
    guardarPerfil(b.sql, ana, 1_000);
    guardarPerfil(b.sql, ana, 2_000);
    expect(b.consultas).toHaveLength(2);
    for (const { consulta, parametros } of b.consultas) {
      expect(consulta).toMatch(/^INSERT INTO perfiles \(id, correo, nombre, foto, primera_ms, ultima_ms, veces\) VALUES \(\?, \?, \?, \?, \?, \?, 1\) /);
      expect(consulta).toContain(
        "ON CONFLICT(id) DO UPDATE SET correo = excluded.correo, nombre = excluded.nombre, foto = excluded.foto, " +
          "ultima_ms = excluded.ultima_ms, veces = veces + 1",
      );
      // La primera hora no está entre lo que se actualiza.
      expect(consulta.slice(consulta.indexOf("DO UPDATE"))).not.toContain("primera_ms");
      for (const valor of Object.values(ana)) expect(consulta).not.toContain(valor);
      expect(parametros.slice(0, 4)).toEqual([ana.id, ana.correo, ana.nombre, ana.foto]);
    }
    expect(b.consultas[0]?.parametros.slice(4)).toEqual([1_000, 1_000]);
    expect(b.consultas[1]?.parametros.slice(4)).toEqual([2_000, 2_000]);
  });

  it("las comillas y el texto con forma de SQL quedan guardados tal cual, sin romper nada", () => {
    const b = banco();
    const picaro = {
      id: "google:100000000000000000003",
      correo: "o'beto\"@example.org",
      nombre: "Beto'); DROP TABLE perfiles; --",
      foto: "https://fotos.example.org/a'b\"c.jpg?x=1;DROP%20TABLE%20perfiles",
    };
    expect(limpiarPerfil({ usuario: picaro.id, correo: picaro.correo, nombre: picaro.nombre, foto: picaro.foto })).toEqual(picaro);
    expect(guardarPerfil(b.sql, ana, 1_000)).toEqual({ nueva: true });
    expect(guardarPerfil(b.sql, picaro, 2_000)).toEqual({ nueva: true });
    expect(guardarPerfil(b.sql, { ...picaro, nombre: '" OR 1=1; UPDATE perfiles SET correo = \'x\'' }, 3_000)).toEqual({ nueva: false });
    expect(b.filas()).toEqual([
      { ...ana, primera_ms: 1_000, ultima_ms: 1_000, veces: 1 },
      { ...picaro, nombre: '" OR 1=1; UPDATE perfiles SET correo = \'x\'', primera_ms: 2_000, ultima_ms: 3_000, veces: 2 },
    ]);
  });

  it("los nombres con controles, con emoji o muy largos se guardan como salen de la limpieza", () => {
    const b = banco();
    expect(anotar(b, { nombre: `  Ana\u0000 ​de\tPrueba ${CARITA}\n` }, 1_000)).toEqual({ nueva: true });
    expect(b.filas()[0]?.nombre).toBe(`Ana de Prueba ${CARITA}`);
    expect(anotar(b, { nombre: CARITA.repeat(300) }, 2_000)).toEqual({ nueva: false });
    expect(b.filas()[0]?.nombre).toBe(CARITA.repeat(120));
    expect(anotar(b, { nombre: 7 }, 3_000)).toEqual({ nueva: false });
    expect(b.filas()[0]).toMatchObject({ nombre: "", veces: 3 });
  });

  it("una foto que no es https queda vacía, y el resto del perfil se guarda", () => {
    const b = banco();
    expect(anotar(b, { foto: "http://fotos.example.org/ana.jpg" }, 1_000)).toEqual({ nueva: true });
    expect(b.filas()).toEqual([{ id: ID, correo: CORREO, nombre: "Ana de Prueba", foto: "", primera_ms: 1_000, ultima_ms: 1_000, veces: 1 }]);
  });

  it("con un correo raro no se guarda nada", () => {
    const b = banco();
    for (const correo of ["ana@@example.org", "ana example.org", "", "ana\u0000@example.org"]) {
      expect(anotar(b, { correo }, 1_000), JSON.stringify(correo)).toBeNull();
    }
    expect(b.consultas).toEqual([]);
    expect(b.filas()).toEqual([]);
  });
});
