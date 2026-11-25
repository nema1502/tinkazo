import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFECTOS, TOPES, direccionDeVista, generarNombres, leerEntorno, leerVistas, problemaDeBase, problemaDeRama, problemaDeRuta, validarVistas } from "./vistas.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const guion = join(aqui, "..", "capturar-vistas.mjs");

const vista = (cambia = {}) => ({ nombre: "portada", ruta: "/", ...cambia });
const errores = (lista) => validarVistas(lista).errores;

describe("validar la lista de vistas", () => {
  it("una vista mínima vale y se completa con los valores de siempre", () => {
    const { vistas, errores: e } = validarVistas([vista()]);
    expect(e).toEqual([]);
    expect(vistas).toEqual([{ nombre: "portada", ruta: "/", ancho: DEFECTOS.ancho, alto: DEFECTOS.alto, tema: null, idioma: null, esperar: null, pausaMs: DEFECTOS.pausaMs, paginaEntera: false, pasos: [] }]);
  });

  it("una vista completa con todos los pasos vale", () => {
    const pasos = [
      { accion: "clic", selector: "#btn" },
      { accion: "escribir", selector: "#ta", texto: "Ana\nBeto" },
      { accion: "nombres", selector: "#ta", cantidad: 150 },
      { accion: "esperar", selector: "#lista-cuenta", ms: 5000 },
      { accion: "esperar", selector: "#x" },
      { accion: "pausa", ms: 1500 },
      { accion: "tecla", tecla: "Enter" },
      { accion: "desplazar", selector: "#winner-box" },
    ];
    const { vistas, errores: e } = validarVistas([vista({ ancho: 390, alto: 844, tema: "dark", idioma: "en", esperar: "main", pausaMs: 0, paginaEntera: true, pasos })]);
    expect(e).toEqual([]);
    expect(vistas[0].pasos).toHaveLength(8);
    expect(vistas[0].pasos[4].ms).toBe(DEFECTOS.esperarMs);
  });

  it("no acepta algo que no sea una lista, una lista vacía ni más de 40 vistas", () => {
    expect(errores({})).toEqual(["la lista de vistas tiene que ser un arreglo JSON de objetos"]);
    expect(errores([])).toEqual(["la lista de vistas está vacía"]);
    expect(errores(Array.from({ length: 41 }, (_, i) => vista({ nombre: `v${i}` }))).join(" ")).toContain("el tope es 40");
    expect(errores(Array.from({ length: 40 }, (_, i) => vista({ nombre: `v${i}` })))).toEqual([]);
  });

  it("rechaza rutas que salen del sitio servido", () => {
    for (const ruta of ["https://example.org/", "//example.org/x", "/\\example.org", "juegos.html", "", "/a b", "/x\n", "javascript:alert(1)", "/?a=1\\2", 5]) {
      expect(errores([vista({ ruta })]).length, JSON.stringify(ruta)).toBeGreaterThan(0);
    }
    expect(problemaDeRuta("/" + "a".repeat(TOPES.largoRuta))).toContain("pasar de");
    for (const ruta of ["/", "/juegos.html", "/?demo=wheel&instant=1&lead=3", "/?red=prueba#sortear", "/seguridad.html?lang=en"]) expect(problemaDeRuta(ruta), ruta).toBe("");
  });

  it("controla las medidas de la pantalla", () => {
    expect(errores([vista({ ancho: 279 })])[0]).toContain('"ancho"');
    expect(errores([vista({ ancho: 2561 })])[0]).toContain('"ancho"');
    expect(errores([vista({ alto: 100 })])[0]).toContain('"alto"');
    expect(errores([vista({ ancho: 390.5 })])[0]).toContain('"ancho"');
    expect(errores([vista({ ancho: "390" })])[0]).toContain('"ancho"');
    expect(errores([vista({ ancho: 280, alto: 2560 })])).toEqual([]);
  });

  it("controla tema, idioma, pausa y página entera", () => {
    expect(errores([vista({ tema: "azul" })])[0]).toContain('"tema"');
    expect(errores([vista({ idioma: "fr" })])[0]).toContain('"idioma"');
    expect(errores([vista({ pausaMs: 60_001 })])[0]).toContain('"pausaMs"');
    expect(errores([vista({ pausaMs: -1 })])[0]).toContain('"pausaMs"');
    expect(errores([vista({ paginaEntera: "si" })])[0]).toContain('"paginaEntera"');
    expect(errores([vista({ esperar: "" })])[0]).toContain('"esperar"');
  });

  it("el nombre se vuelve un archivo: sin barras ni repetidos", () => {
    for (const nombre of ["../x", "a/b", "a b", "", ".oculto", "x".repeat(65), 3]) expect(errores([vista({ nombre })]).length, String(nombre)).toBeGreaterThan(0);
    expect(errores([vista({ nombre: "Portada" }), vista({ nombre: "portada" })]).join(" ")).toContain("se repite");
    expect(errores([vista({ nombre: "portada-1440.claro_1" })])).toEqual([]);
  });

  it("rechaza campos desconocidos: un error de tipeo no se pierde en silencio", () => {
    expect(errores([vista({ pausa: 10 })])[0]).toContain('"pausa"');
    expect(errores([{ ...vista(), pasos: [{ accion: "clic", selector: "#a", ms: 5 }] }])[0]).toContain('"ms"');
  });

  it("controla los pasos: acción conocida, topes y nada que se ejecute", () => {
    const con = (...pasos) => errores([vista({ pasos })]);
    expect(con({ accion: "evaluar", codigo: "alert(1)" })[0]).toContain("accion");
    expect(con({ accion: "js", selector: "x" })[0]).toContain("accion");
    expect(con({ accion: "clic" })[0]).toContain('"selector"');
    expect(con({ accion: "clic", selector: "x".repeat(201) })[0]).toContain('"selector"');
    expect(con({ accion: "escribir", selector: "#ta" })[0]).toContain('"texto"');
    expect(con({ accion: "nombres", selector: "#ta", cantidad: 0 })[0]).toContain('"cantidad"');
    expect(con({ accion: "nombres", selector: "#ta", cantidad: 2001 })[0]).toContain('"cantidad"');
    expect(con({ accion: "pausa", ms: 60_001 })[0]).toContain('"ms"');
    expect(con({ accion: "esperar", selector: "#a", ms: 50 })[0]).toContain('"ms"');
    expect(con({ accion: "tecla", tecla: "F13" })[0]).toContain('"tecla"');
    expect(con({ accion: "tecla", tecla: "toString" })[0]).toContain('"tecla"');
    expect(con("clic")[0]).toContain("objeto");
    expect(errores([vista({ pasos: "clic" })])[0]).toContain("lista");
    expect(errores([vista({ pasos: Array.from({ length: 31 }, () => ({ accion: "pausa", ms: 1 })) })])[0]).toContain("tope es 30");
    expect(errores([vista({ pasos: Array.from({ length: 30 }, () => ({ accion: "pausa", ms: 1 })) })])).toEqual([]);
  });

  it("junta todos los problemas y dice en qué vista y en qué paso están", () => {
    const e = errores([vista({ ruta: "https://x.org" }), vista({ nombre: "b", ancho: 5, pasos: [{ accion: "clic" }] })]);
    expect(e.length).toBeGreaterThanOrEqual(3);
    expect(e.some((x) => x.startsWith("vista 1 (portada)") && x.includes('"ruta"'))).toBe(true);
    expect(e.some((x) => x.startsWith("vista 2 (b), paso 1"))).toBe(true);
    expect(validarVistas([vista({ ruta: "https://x.org" })]).vistas).toEqual([]);
  });

  it("limita lo que una vista puede esperar en total", () => {
    const pasos = Array.from({ length: 5 }, () => ({ accion: "pausa", ms: 60_000 }));
    expect(errores([vista({ pasos })])[0]).toContain("tope es 240 s");
  });

  it("leerVistas avisa de un JSON roto o vacío", () => {
    expect(leerVistas("").errores[0]).toContain("VISTAS_JSON vacía");
    expect(leerVistas("{no").errores[0]).toContain("no es un JSON válido");
    expect(leerVistas('[{"nombre":"a","ruta":"/"}]').errores).toEqual([]);
  });
});

describe("la dirección de cada vista", () => {
  const base = "http://localhost:4173";
  const v = (c) => validarVistas([vista(c)]).vistas[0];
  it("suma tema e idioma y conserva lo que trae la ruta, también el fragmento", () => {
    expect(direccionDeVista(v({ ruta: "/" }), base)).toBe("http://localhost:4173/");
    expect(direccionDeVista(v({ ruta: "/", tema: "dark" }), base)).toBe("http://localhost:4173/?theme=dark");
    expect(direccionDeVista(v({ ruta: "/?demo=wheel&instant=1&lead=3", tema: "light", idioma: "en" }), base)).toBe("http://localhost:4173/?demo=wheel&instant=1&lead=3&theme=light&lang=en");
    expect(direccionDeVista(v({ ruta: "/?red=prueba#sortear", idioma: "es" }), `${base}/`)).toBe("http://localhost:4173/?red=prueba&lang=es#sortear");
    expect(direccionDeVista(v({ ruta: "/seguridad.html" }), base)).toBe("http://localhost:4173/seguridad.html");
  });
  it("el tema de la vista manda sobre el de la ruta", () => {
    expect(direccionDeVista(v({ ruta: "/?theme=light", tema: "dark" }), base)).toBe("http://localhost:4173/?theme=dark");
  });
  it("la base tiene que ser http o https", () => {
    expect(problemaDeBase("http://localhost:4173")).toBe("");
    expect(problemaDeBase("https://example.org")).toBe("");
    expect(problemaDeBase("file:///etc")).toContain("http");
    expect(problemaDeBase("no es una dirección")).toContain("válida");
  });
});

describe("los nombres de prueba", () => {
  it("salen los pedidos, sin repetirse, siempre los mismos", () => {
    for (const n of [1, 2, 18, 150, 300, 2000]) {
      const lista = generarNombres(n);
      expect(lista).toHaveLength(n);
      expect(new Set(lista).size).toBe(n);
      expect(generarNombres(n)).toEqual(lista);
    }
  });
  it("con otra semilla salen otros", () => {
    expect(generarNombres(10, 1)).not.toEqual(generarNombres(10, 2));
  });
  it("de largos variados, con mayúscula, sin saltos de línea y de hasta 36 caracteres", () => {
    const lista = generarNombres(300);
    const largos = lista.map((x) => x.length);
    expect(Math.max(...largos)).toBeLessThanOrEqual(36);
    expect(Math.min(...largos)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...largos) - Math.min(...largos)).toBeGreaterThanOrEqual(15);
    for (const x of lista) {
      expect(x).toMatch(/^\p{Lu}/u);
      expect(x).not.toMatch(/[\n\r\t]/);
      expect(x).toBe(x.trim());
    }
    expect(lista.some((x) => /[áéíóúñ]/i.test(x))).toBe(true);
    expect(lista.some((x) => x.includes(" "))).toBe(true);
  });
  it("no sale ninguno de los nombres de ejemplo del sitio", () => {
    const ejemplo = ["ana", "beto", "nora"];
    const lista = generarNombres(2000).map((x) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
    for (const c of ejemplo) expect(lista, c).not.toContain(c);
  });
});

describe("las variables de construcción", () => {
  it("acepta VITE_ con valores simples", () => {
    expect(leerEntorno("VITE_CAMPANAS=1 VITE_X=a.b:c/d-e_f")).toEqual({ pares: [["VITE_CAMPANAS", "1"], ["VITE_X", "a.b:c/d-e_f"]], errores: [] });
    expect(leerEntorno("").pares).toEqual([]);
    expect(leerEntorno(undefined).pares).toEqual([]);
    expect(leerEntorno("  VITE_A=1 \n VITE_B=2  ").pares).toHaveLength(2);
    expect(leerEntorno("VITE_VACIA=").pares).toEqual([["VITE_VACIA", ""]]);
  });
  it("rechaza nombres que no empiezan con VITE_ y valores con signos raros", () => {
    for (const malo of ["PATH=/x", "VITE_a=1", "VITE_=1", "VITE_X", "=1", "VITE_X=a;b", "VITE_X=$(id)", "VITE_X=a b=c d", "VITE_X=`id`", "VITE_X=a'b", 'VITE_X="a"', "VITE_X=a&b", "VITE_X=a|b", "VITE_X=a>b", "VITE_X=a\\b", "VITE_X=a*b"]) {
      expect(leerEntorno(malo).errores.length, malo).toBeGreaterThan(0);
    }
    expect(leerEntorno("VITE_X=1 VITE_X=2").errores[0]).toContain("repetido");
    expect(leerEntorno(`VITE_X=${"a".repeat(201)}`).errores[0]).toContain("solo puede llevar");
    expect(leerEntorno(Array.from({ length: 21 }, (_, i) => `VITE_V${i}=1`).join(" ")).errores[0]).toContain("tope es 20");
  });
});

describe("la rama", () => {
  it("vacía vale (la misma de la corrida), y valen ramas, etiquetas y commits", () => {
    for (const r of ["", undefined, "main", "capturas-en-github", "usuario/arreglo-3", "v1.2.3", "cb7e69ef7affe04b394027441dfdc0b38da5a7bc"]) expect(problemaDeRama(r), String(r)).toBe("");
  });
  it("rechaza lo que no es un nombre de rama", () => {
    for (const r of ["-f", "a b", "a;b", "$(id)", "a..b", "a`b", "x".repeat(201), "a\nb"]) expect(problemaDeRama(r), r).not.toBe("");
  });
});

describe("el guion de línea de comandos, sin abrir el navegador", () => {
  const correr = (env, ...args) => spawnSync(process.execPath, [guion, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 20_000 });

  it("una lista que sale del sitio falla con un mensaje claro y el código 2", () => {
    const r = correr({ VISTAS_JSON: JSON.stringify([vista({ ruta: "https://example.org/" })]) }, "--validar");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("la lista de vistas no vale");
    expect(r.stderr).toContain('vista 1 (portada): "ruta" tiene que empezar con /');
  });

  it("también falla sin --validar, antes de abrir nada", () => {
    const r = correr({ VISTAS_JSON: "[{}]", CDP_PORT: "1" }, "--base", "http://localhost:4173", "--out", join(tmpdir(), "tinkazo-vistas-sin-abrir"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("la lista de vistas no vale");
  });

  it("una lista buena y un entorno bueno pasan, y las variables quedan en el archivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "tinkazo-vistas-"));
    try {
      const destino = join(dir, "env");
      const r = correr({ VISTAS_JSON: JSON.stringify([vista()]), ENTORNO: "VITE_CAMPANAS=1 VITE_OTRA=a.b", RAMA: "main" }, "--validar", "--entorno-en", destino);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("la lista vale: 1 vistas, 2 variables");
      expect(readFileSync(destino, "utf8")).toBe("VITE_CAMPANAS=1\nVITE_OTRA=a.b\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un entorno o una rama mal formados cortan antes de construir", () => {
    const buena = JSON.stringify([vista()]);
    const e = correr({ VISTAS_JSON: buena, ENTORNO: "PATH=/x" }, "--validar");
    expect(e.status).toBe(2);
    expect(e.stderr).toContain("las variables de construcción no valen");
    const r = correr({ VISTAS_JSON: buena, RAMA: "a;b" }, "--validar");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("la rama no vale");
  });

  it("sin lista dice qué falta", () => {
    const r = correr({}, "--validar");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("VISTAS_JSON vacía");
  });
});
