import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buscarFaltas, compilar, literalesDe, textosDeHtml } from "./glosario.mjs";
import { leerResumen } from "./resumen.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(aqui, "..", "check-glosario.mjs");
const glosario = JSON.parse(readFileSync(join(aqui, "glosario-neutral.json"), "utf8"));
const entradas = compilar(glosario);
const faltasDe = (texto, nombres = glosario.nombresDeJuegos) => buscarFaltas([{ texto, linea: 1 }], entradas, nombres).filter((f) => f.estado !== "avisar");

describe("los textos de un archivo de código", () => {
  it("toma lo que está entre comillas, con su línea, y no los comentarios ni los nombres", () => {
    const src = [
      "// ahorita en un comentario no cuenta",
      "const ahorita = 1;",
      'const a = "primero";',
      "/* chamba",
      "   en un bloque */",
      "const b = 'segundo \\' con comilla';",
      "const c = `tercero ${n + 1} y ${f(`anidado`)} cuarto`;",
    ].join("\n");
    const l = literalesDe(src);
    expect(l.map((x) => x.texto)).toEqual(["primero", "segundo ' con comilla", "tercero   y   cuarto"]);
    expect(l.map((x) => x.linea)).toEqual([3, 6, 7]);
  });
});

describe("los textos de un HTML", () => {
  it("lee el texto y los atributos que se muestran, no los scripts, estilos ni comentarios", () => {
    const html = [
      "<!-- chamba en un comentario -->",
      '<style>.chamba { color: red }</style>',
      '<h1 title="Mirá esto" class="chamba">Hola</h1>',
      '<script>const chamba = "chamba";</script>',
      '<p>Un texto <b>con negrita</b></p>',
      '<img src="chamba.png" alt="Dibujo de una llama">',
    ].join("\n");
    const t = textosDeHtml(html);
    const todo = t.map((x) => x.texto).join("\n");
    expect(todo).toContain("Mirá esto");
    expect(todo).toContain("Un texto");
    expect(todo).toContain("Dibujo de una llama");
    expect(todo).not.toMatch(/chamba/);
    expect(t.find((x) => x.texto === "Dibujo de una llama").linea).toBe(6);
  });
});

describe("las palabras de la lista", () => {
  it("encuentra la palabra entera, con tilde, en cualquier caja", () => {
    expect(faltasDe("Esperá ahorita, nomás un momento").map((f) => f.encontrada)).toEqual(["ahorita", "nomás"]);
    expect(faltasDe("AHORITA").map((f) => f.encontrada)).toEqual(["AHORITA"]);
    expect(faltasDe("¡Qué chévere!")[0].alternativa).toMatch(/genial/);
  });

  it("no confunde una palabra con otra que la contiene", () => {
    expect(faltasDe("la leche, la noche y el coche")).toEqual([]);
    expect(faltasDe("una pauta para la economía")).toEqual([]);
    expect(faltasDe("sin tocar, el toque de color")).toEqual([]);
    expect(faltasDe("espera un toque")).toHaveLength(1);
  });

  it("el voseo se mantiene: no está en la lista", () => {
    expect(faltasDe("Pegá la lista, sorteá, tenés que elegir y podés probarlo si encontrás algo")).toEqual([]);
  });

  it("los nombres de los juegos no cuentan", () => {
    const con = buscarFaltas([{ texto: "Jugá a la Cancha de Totora", linea: 1 }], compilar({ entradas: [{ evitar: "cancha", alternativa: "campo" }] }), ["Cancha de Totora"]);
    expect(con).toEqual([]);
    const sin = buscarFaltas([{ texto: "Jugá a la Cancha de Totora", linea: 1 }], compilar({ entradas: [{ evitar: "cancha", alternativa: "campo" }] }), []);
    expect(sin).toHaveLength(1);
  });

  it("una entrada en `avisar` se devuelve marcada, para contarla sin fallar", () => {
    const f = buscarFaltas([{ texto: "plata de mentira", linea: 4 }], entradas, []);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ estado: "avisar", linea: 4 });
  });

  it("la lista tiene al menos quince entradas con alternativa, y todas compilan", () => {
    expect(glosario.entradas.length).toBeGreaterThanOrEqual(15);
    for (const e of glosario.entradas) {
      expect(e.alternativa, e.evitar).toBeTruthy();
      expect(() => new RegExp(e.evitar, "iu")).not.toThrow();
    }
  });
});

describe("el revisor entero, sobre una carpeta de prueba", () => {
  let raiz;
  const escribir = (rel, txt) => {
    mkdirSync(dirname(join(raiz, rel)), { recursive: true });
    writeFileSync(join(raiz, rel), txt);
  };
  const correr = (...extra) => spawnSync(process.execPath, [SCRIPT, "--raiz", raiz, ...extra], { encoding: "utf8" });

  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), "tinkazo-glosario-test-"));
    escribir("src/i18n.ts", 'export const T = {\n  es: {\n    hola: "Pegá la lista y sorteá",\n  },\n  en: {\n    hola: "Wait ahorita, plata",\n  },\n};\n');
    escribir("index.html", "<h1>Un sorteo que se comprueba</h1>\n");
    escribir("historia.html", "<p>Esperá ahorita, nomás un toque, a full</p>\n");
  });
  afterAll(() => rmSync(raiz, { recursive: true, force: true }));

  it("pasa sin palabras de la lista, aunque estén en inglés o en historia.html", () => {
    const r = correr();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("APROBADO");
  });

  it("falla con una palabra de la lista metida a propósito, en un HTML y en el diccionario", () => {
    escribir("index.html", "<h1>Un sorteo que se comprueba</h1>\n<p>Esperá ahorita</p>\n");
    let r = correr();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("index.html:2");
    expect(r.stdout).toContain("ahorita");

    escribir("index.html", "<h1>Un sorteo que se comprueba</h1>\n");
    escribir("src/i18n.ts", 'export const T = {\n  es: {\n    hola: "Pegá la lista",\n    chau: "Qué chévere",\n  },\n  en: {\n  },\n};\n');
    r = correr();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("src/i18n.ts:4");
    expect(r.stdout).toContain("genial");
  });

  it("con --json deja una línea de resumen al final, con la falla", () => {
    const r = correr("--json");
    const l = leerResumen(r.stdout);
    expect(l).toMatchObject({ auditor: "check-glosario" });
    expect(l.fallas).toHaveLength(1);
    expect(l.fallas[0].nombre).toContain("src/i18n.ts");
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe(JSON.stringify(l));
  });

  it("el repo de verdad pasa", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status, r.stdout).toBe(0);
  });
});
