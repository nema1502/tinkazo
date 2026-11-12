import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aplicarExclusiones,
  esArchivoDeTextos,
  hallazgosEnTexto,
  lineaDe,
  literalesDeCodigo,
  revisarRaiz,
  textosDeHtml,
} from "./escritura.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(aqui, "..", "check-escritura.mjs");

// Los dos signos se arman con su código para que este archivo no los lleve escritos de más.
const AB = "«";
const CE = "»";
const PC = ";";

const tipos = (texto, opciones) => hallazgosEnTexto(texto, opciones).map((h) => h.tipo);

describe("las comillas angulares", () => {
  it("encuentra la de apertura y la de cierre, con su posición", () => {
    const h = hallazgosEnTexto(`Tocá ${AB}Sellar${CE} ya`);
    expect(h.map((x) => x.tipo)).toEqual(["comillas", "comillas"]);
    expect(h.map((x) => x.indice)).toEqual([5, 12]);
  });

  it("también las simples y las que se escriben como entidad", () => {
    expect(tipos("‹a›")).toEqual(["comillas", "comillas"]);
    expect(tipos("&laquo;a&raquo; &lsaquo;b&rsaquo;")).toHaveLength(4);
    expect(tipos("&#171;a&#187; &#xAB;b&#xbb; &#0171;")).toHaveLength(5);
  });

  it("un texto sin ellas no da nada", () => {
    expect(hallazgosEnTexto("Tocá Sellar la lista. Dice “hola” y \"chau\".")).toEqual([]);
  });
});

describe("el punto y coma", () => {
  it("lo encuentra en una oración", () => {
    expect(tipos(`Se sella la lista${PC} después se espera`)).toEqual(["puntoycoma"]);
  });

  it("las entidades HTML no cuentan, aunque terminen en punto y coma", () => {
    expect(hallazgosEnTexto("Nora&nbsp;y&nbsp;Ana &amp; Beto &#39;x&#39; &eacute; &#x27;")).toEqual([]);
  });

  it("pero la entidad del propio punto y coma sí cuenta, porque se ve", () => {
    expect(tipos("uno&semi; dos")).toEqual(["puntoycoma"]);
    expect(tipos("uno&#59; dos")).toEqual(["puntoycoma"]);
    expect(tipos("uno&#x3B; dos")).toEqual(["puntoycoma"]);
  });

  it("los parecidos de otras escrituras también", () => {
    expect(tipos("uno; dos")).toEqual(["puntoycoma"]);
    expect(tipos("uno； dos")).toEqual(["puntoycoma"]);
  });

  it("no cuenta el de un estilo en línea ni el de un tipo de contenido", () => {
    expect(hallazgosEnTexto("position:fixed;left:-9999px;top:0;opacity:0")).toEqual([]);
    expect(hallazgosEnTexto('<p style="font-weight:800;color:var(--magenta-ink)">Hola</p>')).toEqual([]);
    expect(hallazgosEnTexto("text/plain;charset=UTF-8")).toEqual([]);
    expect(hallazgosEnTexto("data:image/svg+xml;base64,AAAA")).toEqual([]);
    expect(hallazgosEnTexto("--tinte: #fff;\n  margin: 0 auto;\n  color: red;")).toEqual([]);
  });

  it("una oración con dos puntos delante no se confunde con un estilo", () => {
    expect(tipos(`Ojo: listo${PC} luego sigue`)).toEqual(["puntoycoma"]);
    expect(tipos(`Atención: tocá el botón${PC} después esperá`)).toEqual(["puntoycoma"]);
  });

  it("en un texto suelto pide al menos dos palabras, para no confundirse con código", () => {
    expect(hallazgosEnTexto(`a${PC}b`)).toEqual([]);
    expect(hallazgosEnTexto(`for (let i = 0${PC} i < n${PC} i++)`)).toEqual([]);
    expect(hallazgosEnTexto(`const x = a => b${PC} return x`)).toEqual([]);
    expect(tipos(`Hola${PC} chau`)).toEqual(["puntoycoma"]);
  });

  it("en un diccionario no pide nada más: cualquier punto y coma cuenta", () => {
    expect(tipos(`Listo${PC}`, { diccionario: true })).toEqual(["puntoycoma"]);
    expect(tipos(`a${PC}b`, { diccionario: true })).toEqual(["puntoycoma"]);
    expect(hallazgosEnTexto("position:fixed;left:0", { diccionario: true })).toEqual([]);
  });

  it("mezcla de los dos signos, en orden de aparición", () => {
    const h = hallazgosEnTexto(`Dice ${AB}hola${CE}${PC} y sigue`);
    expect(h.map((x) => x.tipo)).toEqual(["comillas", "comillas", "puntoycoma"]);
    expect(h.map((x) => x.indice)).toEqual([...h.map((x) => x.indice)].sort((a, b) => a - b));
  });
});

describe("las cadenas de un archivo de código", () => {
  it("toma lo que está entre comillas, con su línea, y no los comentarios", () => {
    const src = [
      `// ${AB}en un comentario${CE} no cuenta`,
      "const a = 'primero';",
      `/* ${AB}ni en un bloque${CE}`,
      "   que sigue */",
      'const b = "segundo";',
    ].join("\n");
    const l = literalesDeCodigo(src);
    expect(l.map((x) => x.texto)).toEqual(["primero", "segundo"]);
    expect(l.map((x) => x.linea)).toEqual([2, 5]);
  });

  it("interpreta los escapes: una comilla angular escrita con su código se ve igual", () => {
    const src = String.raw`const a = "«hola»"; const b = "x\x3by"; const c = "\u{3b}"; const d = "l1\nl2";`;
    const l = literalesDeCodigo(src).map((x) => x.texto);
    expect(l).toEqual([`${AB}hola${CE}`, "x;y", ";", "l1\nl2"]);
  });

  it("una expresión regular con comillas adentro no abre una cadena", () => {
    const src = ['const e = s.replace(/["\'<>&]/g, "");', 'const f = a / b + "dividido";', "const g = x.split(/;\\s*/);"].join("\n");
    const l = literalesDeCodigo(src).map((x) => x.texto);
    expect(l).toEqual(["", "dividido"]);
  });

  it("una plantilla deja un hueco en cada ${} y entrega aparte las cadenas de adentro", () => {
    const src = "const t = `Con algo en ${col} (${n === 1 ? \"un sorteo\" : `${n} sorteos`}) fin`;";
    const l = literalesDeCodigo(src);
    const textos = l.map((x) => x.texto.replace(//g, "#"));
    expect(textos).toContain("Con algo en # (#) fin");
    expect(textos).toContain("un sorteo");
    expect(textos).toContain("# sorteos");
  });

  it("la línea de un hallazgo en una plantilla de varias líneas es la de adentro", () => {
    const src = ["const t = `primera", "segunda", `tercera ${AB}x${CE}`, "cuarta`;"].join("\n");
    const [seg] = literalesDeCodigo(src);
    const i = seg.texto.indexOf(AB);
    expect(seg.linea).toBe(1);
    expect(lineaDe(seg, i)).toBe(3);
  });

  it("un escape de salto de línea no suma línea", () => {
    const [seg] = literalesDeCodigo(String.raw`const a = "uno\ndos ` + AB + `";`);
    expect(lineaDe(seg, seg.texto.indexOf(AB))).toBe(1);
  });

  it("marca las cadenas que son argumento de console, que no lee nadie", () => {
    const l = literalesDeCodigo('console.warn("[x] aviso; se reintenta", e);\nconst z = "otra cosa";');
    expect(l[0]).toMatchObject({ texto: "[x] aviso; se reintenta", enConsola: true });
    expect(l[1]).toMatchObject({ texto: "otra cosa", enConsola: false });
  });

  it("no se cuelga ni falla con una cadena sin cerrar, y la marca", () => {
    const l = literalesDeCodigo('const a = "sin cerrar\nconst b = `tampoco');
    expect(l.map((x) => x.sinCerrar)).toEqual([true, true]);
    expect(literalesDeCodigo('const a = "cerrada";')[0].sinCerrar).toBe(false);
    expect(() => literalesDeCodigo("const r = /sin cerrar")).not.toThrow();
  });
});

describe("el texto de una página HTML", () => {
  const html = [
    "<!doctype html>",
    '<html lang="es"><head>',
    "<title>Un título</title>",
    '<meta name="viewport" content="width=device-width; initial-scale=1" />',
    `<meta name="description" content="Se describe${PC} así" />`,
    '<meta property="og:title" content="Para redes" />',
    "<style>.x { color: red; }</style>",
    `<!-- ${AB}comentario${CE}${PC} -->`,
    "</head><body>",
    '<img src="a.png" alt="Dibujo de una llama" class="uno dos">',
    "<p>Texto con <b>negrita</b>",
    "y otra línea.</p>",
    '<button aria-label="Cerrar la ventana" title="Cerrar">x</button>',
    '<input placeholder="Escribí acá">',
    `<script>const a = "${AB}x${CE}${PC} y";</script>`,
    "</body></html>",
  ].join("\n");
  const t = textosDeHtml(html);
  const todo = t.map((x) => x.texto).join("\n");

  it("lee el texto de los nodos y los atributos que se leen", () => {
    for (const esperado of ["Un título", "Se describe", "Para redes", "Dibujo de una llama", "Texto con", "negrita", "Cerrar la ventana", "Cerrar", "Escribí acá"]) {
      expect(todo).toContain(esperado);
    }
  });

  it("no lee scripts, estilos, comentarios ni metas que no son de texto", () => {
    expect(todo).not.toContain("color: red");
    expect(todo).not.toContain("comentario");
    expect(todo).not.toContain("device-width");
    expect(todo).not.toContain("const a");
    expect(todo).not.toContain("uno dos");
  });

  it("cada texto trae su línea", () => {
    expect(t.find((x) => x.texto === "Un título").linea).toBe(3);
    expect(t.find((x) => x.texto === "Dibujo de una llama").linea).toBe(10);
    const parrafo = t.find((x) => x.texto.includes("otra línea"));
    expect(lineaDe(parrafo, parrafo.texto.indexOf("otra"))).toBe(12);
  });

  it("un atributo con un signo mayor adentro no rompe la lectura de la etiqueta", () => {
    const x = textosDeHtml(`<link rel="icon" href='data:image/svg+xml,<svg viewBox="0 0 1 1"><g/></svg>'>\n<p>Después de eso${PC} sigue</p>`);
    const joined = x.map((y) => y.texto).join("|");
    expect(joined).toContain("Después de eso");
    expect(joined).not.toContain("viewBox");
  });

  it("lee los textos de los datos estructurados, sin las direcciones", () => {
    const x = textosDeHtml(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","url":"https://tinkazo.app/a?x=1;y=2","mainEntity":[{"name":"¿Es gratis?","text":"Sí, siempre."}]}</script>',
    );
    const joined = x.map((y) => y.texto);
    expect(joined).toContain("¿Es gratis?");
    expect(joined).toContain("Sí, siempre.");
    expect(joined.join("|")).not.toContain("tinkazo.app");
    expect(joined.join("|")).not.toContain("FAQPage");
  });

  it("el código de un bloque de CDATA de un SVG no es texto", () => {
    const x = textosDeHtml("<svg><style><![CDATA[.a{fill:red;}]]></style><title>Una llama</title></svg>");
    expect(x.map((y) => y.texto).join("|")).toBe("Una llama");
  });
});

describe("qué archivos son diccionarios", () => {
  it("los de textos del sitio sí, el resto no", () => {
    for (const r of ["src/i18n.ts", "src/i18n-modo-oficial.ts", "src/alta-textos-paso.ts", "src/equipos/textos.ts", "src/marca-creadores-textos.ts", "src/verificacion-textos.ts", "src/games/pixi/kit/respuestas.ts", "src/games/pixi/kit/guion.ts", "src/modos/mensajes.ts"]) {
      expect(esArchivoDeTextos(r), r).toBe(true);
    }
    for (const r of ["src/main.ts", "src/dom.ts", "src/ui/freeze.ts", "src/games/pixi/stage.ts"]) {
      expect(esArchivoDeTextos(r), r).toBe(false);
    }
  });
});

describe("las exclusiones con su porqué", () => {
  const h = (archivo, texto) => ({ archivo, linea: 3, tipo: "puntoycoma", texto, fragmento: texto });
  const lista = [
    { archivo: "src/stellar/", contiene: "Network ; September", porque: "identificador exacto de la red" },
    { archivo: "src/ui/freeze.ts", contiene: "no entró", porque: "va al registro del navegador" },
    { archivo: "src/viejo.ts", contiene: "ya no existe", porque: "caso que se fue" },
  ];

  it("separa lo excluido, por archivo exacto o por carpeta, y avisa de las que no se usaron", () => {
    const r = aplicarExclusiones(
      [h("src/stellar/config.ts", "Test SDF Network ; September 2015"), h("src/ui/freeze.ts", "el sello no entró; se reintenta"), h("src/ui/freeze.ts", "otra cosa; distinta"), h("src/stellar2/x.ts", "Test SDF Network ; September")],
      lista,
    );
    expect(r.vigentes.map((x) => x.texto)).toEqual(["otra cosa; distinta", "Test SDF Network ; September"]);
    expect(r.excluidos).toHaveLength(2);
    expect(r.excluidos[0].porque).toBe("identificador exacto de la red");
    expect(r.sinUso.map((x) => x.archivo)).toEqual(["src/viejo.ts"]);
  });

  it("una exclusión sin porqué no vale", () => {
    expect(() => aplicarExclusiones([], [{ archivo: "src/x.ts", contiene: "a" }])).toThrow(/porque/);
    expect(() => aplicarExclusiones([], [{ archivo: "src/x.ts", contiene: "a", porque: " " }])).toThrow(/porque/);
  });
});

describe("la revisión de una carpeta entera", () => {
  let raiz;
  const escribir = (rel, txt) => {
    mkdirSync(dirname(join(raiz, rel)), { recursive: true });
    writeFileSync(join(raiz, rel), txt);
  };
  const correr = (...extra) => spawnSync(process.execPath, [SCRIPT, "--raiz", raiz, "--exclusiones", join(raiz, "exclusiones.json"), ...extra], { encoding: "utf8" });

  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), "tinkazo-escritura-test-"));
    escribir("exclusiones.json", JSON.stringify({ exclusiones: [] }));
    escribir("src/i18n.ts", `export const T = {\n  es: {\n    hola: "Pegá la lista",\n  },\n  en: {\n    hola: "Paste the list",\n  },\n};\n`);
    escribir("index.html", `<h1>Un sorteo que se comprueba</h1>\n<p>Tocá <strong>Sellar la lista</strong>.</p>\n`);
    escribir("src/otro.test.ts", `it("dice ${AB}esto${CE}${PC} y aquello", () => {});\n`);
    escribir("src/comentado.ts", `// ${AB}solo un comentario${CE}${PC} nada más\nexport const x = 1;\n`);
    escribir("docs/guia.html", `<p>${AB}docs${CE}${PC} no se mira</p>\n`);
    escribir("scripts/otro.mjs", `export const t = "${AB}scripts${CE}${PC} no se mira";\n`);
    escribir("README.md", `${AB}readme${CE}${PC} no se mira\n`);
    escribir("public/emblemas/LICENCIA-X.txt", `${AB}licencia${CE}${PC} de terceros\n`);
    escribir("public/marca/preguntas.txt", `1. Una pregunta\n2. Otra\n`);
  });
  afterAll(() => rmSync(raiz, { recursive: true, force: true }));

  it("una carpeta limpia pasa, y no mira pruebas, comentarios, docs, scripts, README ni licencias", () => {
    const r = correr();
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain("APROBADO");
    const rev = revisarRaiz(raiz, { exclusiones: [] });
    expect(rev.hallazgos).toEqual([]);
  });

  it("falla con un texto del diccionario, en las dos lenguas, y dice archivo y línea", () => {
    escribir(
      "src/i18n.ts",
      `export const T = {\n  es: {\n    hola: "Pegá la lista",\n    nota: "Tocá ${AB}Sellar${CE} ya",\n  },\n  en: {\n    hola: "Paste the list${PC} then wait",\n    uso: (n: number) => \`\${n === 1 ? "one draw${PC} done" : "draws"}\`,\n  },\n};\n`,
    );
    const r = correr();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("src/i18n.ts:4");
    expect(r.stdout).toContain("src/i18n.ts:7");
    expect(r.stdout).toContain("src/i18n.ts:8");
    expect(r.stdout).toContain("RECHAZADO");
  });

  it("falla con un texto de una página, de un atributo y de un archivo descargable", () => {
    escribir("index.html", `<h1>Un sorteo</h1>\n<p>Tocá ${AB}Sellar${CE}.</p>\n<img src="a.png" alt="Dibujo${PC} de una llama">\n`);
    escribir("public/marca/preguntas.txt", `1. Una pregunta${PC} dos cosas\n`);
    const r = correr();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("index.html:2");
    expect(r.stdout).toContain("index.html:3");
    expect(r.stdout).toContain("public/marca/preguntas.txt:1");
  });

  it("con --informe lista todo agrupado por archivo, con los totales, y sale con 0", () => {
    const r = correr("--informe");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/src\/i18n\.ts/);
    expect(r.stdout).toMatch(/index\.html/);
    expect(r.stdout).toMatch(/Total/);
  });

  it("con --json da lo mismo en un documento para máquinas, y sale con 0", () => {
    const r = correr("--json");
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.total).toBeGreaterThan(0);
    expect(j.comillas + j.puntoYComa).toBe(j.total);
    const i18n = j.archivos.find((a) => a.archivo === "src/i18n.ts");
    expect(i18n.hallazgos.map((x) => x.linea)).toEqual([4, 4, 7, 8]);
    expect(i18n.hallazgos[0]).toMatchObject({ tipo: "comillas" });
  });

  it("una exclusión con su porqué saca el hallazgo, y una que no se usa se avisa", () => {
    escribir("exclusiones.json", JSON.stringify({ exclusiones: [{ archivo: "public/marca/preguntas.txt", contiene: "dos cosas", porque: "prueba" }, { archivo: "src/nada.ts", contiene: "x", porque: "prueba" }] }));
    const r = correr("--informe");
    expect(r.stdout).not.toContain("public/marca/preguntas.txt");
    expect(r.stdout).toContain("src/nada.ts");
  });

});

/**
 * La compuerta: la suite entera exige que lo que lee la persona no lleve comillas angulares ni punto y coma.
 * Como `pnpm test` la corre la CI en cada cambio, un texto nuevo con alguno de los dos signos rompe la subida, y el
 * mensaje dice el archivo y la línea de cada falta. Se reescribe la frase (docs/marca.md, "Cómo se escribe"). Solo si
 * la cadena no la lee nadie se agrega a `escritura-exclusiones.json`, con su porqué.
 */
describe("el repositorio de verdad", () => {
  const raiz = resolve(aqui, "..", "..");
  const exclusiones = JSON.parse(readFileSync(join(aqui, "escritura-exclusiones.json"), "utf8")).exclusiones;
  const revision = revisarRaiz(raiz, { exclusiones });
  const nombre = { comillas: "comillas angulares", puntoycoma: "punto y coma" };

  it("no tiene comillas angulares ni punto y coma en lo que lee la persona", () => {
    const faltas = revision.hallazgos.map((h) => `${h.archivo}:${h.linea}  ${nombre[h.tipo] ?? h.tipo}  ${h.fragmento}`);
    expect(faltas, "Reescribí cada frase con las reglas de docs/marca.md. Con pnpm check:escritura --informe sale la lista agrupada.").toEqual([]);
  });

  it("el lector no se pierde en ningún archivo, así que el control no tiene huecos", () => {
    const perdidos = revision.sinCerrar.map((s) => `${s.archivo}:${s.linea}`);
    expect(perdidos, "Hay una cadena que no cierra: el lector pudo perderse en ese archivo y dejar textos sin mirar.").toEqual([]);
  });

  it("revisa de verdad los archivos de textos y las páginas", () => {
    expect(revision.archivos).toBeGreaterThan(300);
  });
});

describe("los demás lugares donde hay texto", () => {
  let raiz;
  const escribir = (rel, txt) => {
    mkdirSync(dirname(join(raiz, rel)), { recursive: true });
    writeFileSync(join(raiz, rel), txt);
  };
  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), "tinkazo-escritura-otros-"));
    escribir("public/manifest.webmanifest", JSON.stringify({ name: "Tinkazo", description: `Sorteos${PC} y más`, start_url: "/;x", shortcuts: [{ name: `Atajo ${AB}uno${CE}`, url: "/a" }] }, null, 2));
    escribir("public/404.html", `<h1>Esta página no existe${PC} volvé</h1>\n`);
    escribir("public/marca/afiche.svg", `<svg><title>Un afiche${PC} de prueba</title><path d="M0 0;"/></svg>\n`);
    escribir("public/marca/sub/leeme.txt", `Una línea\n${AB}otra${CE}\n`);
    escribir("public/marca/cartel.pdf", `${AB}no es texto${CE}${PC}`);
    escribir("src/ui/algo.ts", `const css = "position:fixed;left:0";\nconst url = "data:text/plain;base64,AAAA";\nconst u = \`texto \${a}; y más\`;\nconst r = /["'];/;\nconsole.log("debug${PC} dos palabras");\n`);
    escribir("src/ui/oracion.ts", `export const aviso = "Se guardó${PC} ya podés seguir";\n`);
    escribir("src/.oculta/x.ts", `export const a = "Una cosa${PC} otra cosa";\n`);
    escribir("src/node_modules/y.ts", `export const a = "Una cosa${PC} otra cosa";\n`);
  });
  afterAll(() => rmSync(raiz, { recursive: true, force: true }));

  it("mira el manifiesto, la página de error, el SVG y los .txt de marca, y solo eso", () => {
    const { hallazgos } = revisarRaiz(raiz, { exclusiones: [] });
    const por = (a) => hallazgos.filter((h) => h.archivo === a);
    expect(por("public/manifest.webmanifest").map((h) => h.tipo).sort()).toEqual(["comillas", "comillas", "puntoycoma"]);
    expect(por("public/404.html")).toHaveLength(1);
    expect(por("public/marca/afiche.svg")).toHaveLength(1);
    expect(por("public/marca/afiche.svg")[0].linea).toBe(1);
    expect(por("public/marca/sub/leeme.txt").map((h) => h.linea)).toEqual([2, 2]);
    expect(hallazgos.some((h) => h.archivo.endsWith(".pdf"))).toBe(false);
  });

  it("en el código no cuenta un estilo, una dirección de datos, una regex ni una cadena de console", () => {
    const { hallazgos, consola } = revisarRaiz(raiz, { exclusiones: [] });
    expect(hallazgos.filter((h) => h.archivo === "src/ui/algo.ts")).toHaveLength(1);
    expect(hallazgos.find((h) => h.archivo === "src/ui/algo.ts").linea).toBe(3);
    expect(consola).toBe(1);
    expect(hallazgos.filter((h) => h.archivo === "src/ui/oracion.ts")).toHaveLength(1);
  });

  it("no entra en las carpetas ocultas ni en las dependencias", () => {
    const { hallazgos } = revisarRaiz(raiz, { exclusiones: [] });
    expect(hallazgos.some((h) => h.archivo.includes(".oculta") || h.archivo.includes("node_modules"))).toBe(false);
  });
});

describe("las exclusiones del repositorio", () => {
  const archivo = resolve(aqui, "escritura-exclusiones.json");
  const { exclusiones } = JSON.parse(readFileSync(archivo, "utf8"));

  it("cada una dice por qué y apunta a un archivo o carpeta que existe", () => {
    expect(exclusiones.length).toBeGreaterThan(0);
    for (const e of exclusiones) {
      expect(String(e.porque ?? "").trim().length, e.archivo).toBeGreaterThan(20);
      expect(existsSync(resolve(aqui, "..", "..", e.archivo)), e.archivo).toBe(true);
    }
    expect(() => aplicarExclusiones([], exclusiones)).not.toThrow();
  });
});
