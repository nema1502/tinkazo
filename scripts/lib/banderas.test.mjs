// Prueba las piezas de scripts/check-banderas.mjs (scripts/lib/banderas.mjs): leer la tabla de
// docs/operacion.md, sacar las variables de un código empaquetado y compararlas. Sin red.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { archivosDeLaPortada, comparar, leerTabla, referenciasRelativas, sacarVariables } from "./banderas.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));

const TABLA = [
  "# Operación",
  "",
  "## Las banderas del sitio y su estado en producción",
  "",
  "Leído del sitio publicado el 25 de noviembre de 2026.",
  "",
  "| Variable | Sin la variable | En producción | Qué cambia |",
  "|---|---|---|---|",
  "| `VITE_PAGOS` | apagada | `1` | Pagar premio |",
  "| `VITE_STELLAR_NETWORK` | Prueba | `mainnet` | La red |",
  "| `VITE_COMISION_PB` | apagada | definida | El cobro |",
  "| `VITE_EQUIPOS` | prendida | sin definir | Equipos |",
  "",
  "## Otra sección",
  "",
  "| `VITE_OTRA` | x | `1` | y |",
].join("\n");

describe("leerTabla", () => {
  it("lee las filas, la fecha de lectura y se detiene en la sección siguiente", () => {
    const t = leerTabla(TABLA);
    expect(t.encontrada).toBe(true);
    expect(t.problemas).toEqual([]);
    expect(t.lectura).toBe("25 de noviembre de 2026");
    expect(t.filas.map((f) => [f.variable, f.produccion])).toEqual([
      ["VITE_PAGOS", "1"],
      ["VITE_STELLAR_NETWORK", "mainnet"],
      ["VITE_COMISION_PB", "definida"],
      ["VITE_EQUIPOS", "sin definir"],
    ]);
    expect(t.filas[3].sinLaVariable).toBe("prendida");
  });

  it("avisa si falta la sección, la fecha o una fila repetida", () => {
    expect(leerTabla("# nada").encontrada).toBe(false);
    const sinFecha = TABLA.replace("Leído del sitio publicado el 25 de noviembre de 2026.", "");
    expect(leerTabla(sinFecha).problemas.join(" ")).toContain("Leído del sitio publicado");
    const repetida = TABLA.replace("| `VITE_EQUIPOS`", "| `VITE_PAGOS` | apagada | `1` | otra vez |\n| `VITE_EQUIPOS`");
    expect(leerTabla(repetida).problemas.join(" ")).toContain("VITE_PAGOS está dos veces");
  });

  it("lee la tabla real de docs/operacion.md sin problemas", () => {
    const md = readFileSync(resolve(aqui, "../../docs/operacion.md"), "utf8");
    const t = leerTabla(md);
    expect(t.problemas).toEqual([]);
    expect(t.filas.length).toBeGreaterThan(20);
  });
});

describe("sacarVariables", () => {
  const OBJETO =
    "{BASE_URL:`/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,VITE_ALTA:`1`,VITE_COMISION_PB:`200`," +
    "VITE_VERCEL_GIT_COMMIT_MESSAGE:`arregla VITE_PAGOS: 9 y {algo}`,VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG:`{\"a\":{\"b\":1}}`," +
    "VITE_PAGOS:`1`,VITE_STELLAR_NETWORK:`mainnet`}";

  it("lee clave por clave: las llaves y los dos puntos dentro de un valor no engañan", () => {
    const v = sacarVariables(`var e=${OBJETO};f(e.VITE_PAGOS)`);
    expect([...v.keys()]).toEqual(["VITE_ALTA", "VITE_COMISION_PB", "VITE_PAGOS", "VITE_STELLAR_NETWORK"]);
    expect(v.get("VITE_PAGOS")).toBe("1");
    expect(v.get("VITE_STELLAR_NETWORK")).toBe("mainnet");
  });

  it("no devuelve nunca las variables del sistema", () => {
    const v = sacarVariables(OBJETO);
    expect([...v.keys()].some((k) => k.startsWith("VITE_VERCEL_"))).toBe(false);
  });

  it("entiende comillas simples, dobles y acentos graves, y los escapes", () => {
    const v = sacarVariables(`{BASE_URL:'/',VITE_A:'uno',VITE_B:"dos",VITE_C:\`tr\\\`es\`,VITE_D:'',DEV:!0}`);
    expect(v.get("VITE_A")).toBe("uno");
    expect(v.get("VITE_B")).toBe("dos");
    expect(v.get("VITE_C")).toBe("tr`es");
    expect(v.get("VITE_D")).toBe("");
  });

  it("entiende las claves entre comillas", () => {
    const v = sacarVariables(`{"BASE_URL":"/","VITE_A":"1"}`);
    expect(v.get("VITE_A")).toBe("1");
  });

  it("devuelve null si no hay objeto o si no se puede leer entero", () => {
    expect(sacarVariables("console.log(1)")).toBeNull();
    expect(sacarVariables("{BASE_URL:`/`,VITE_A:f(1)}")).toBeNull();
  });

  it("toma la primera copia que se lee bien", () => {
    const v = sacarVariables("{BASE_URL:`/`,VITE_A:f(1)} y {BASE_URL:`/`,VITE_A:`1`}");
    expect(v.get("VITE_A")).toBe("1");
  });
});

describe("archivosDeLaPortada y referenciasRelativas", () => {
  it("saca el script de entrada y los modulepreload, y nada más", () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-AB.js"></script>' +
      '<link rel="modulepreload" crossorigin href="/assets/otro-CD.js">' +
      '<link rel="stylesheet" href="/assets/x.css"><script src="/suelto.js"></script>';
    expect(archivosDeLaPortada(html)).toEqual(["/assets/index-AB.js", "/assets/otro-CD.js"]);
  });

  it("encuentra los archivos que un código nombra con ./", () => {
    expect(referenciasRelativas('import("./uno-AB.js");from"./dos-CD.js";x="./nada.css"').sort()).toEqual(["dos-CD.js", "uno-AB.js"]);
  });
});

describe("comparar", () => {
  const tabla = leerTabla(TABLA).filas;
  const sitio = (o) => new Map(Object.entries(o));

  it("pasa cuando la tabla coincide", () => {
    const r = comparar(tabla, sitio({ VITE_PAGOS: "1", VITE_STELLAR_NETWORK: "mainnet", VITE_COMISION_PB: "200" }));
    expect(r.fallas).toEqual([]);
    expect(r.filas.find((f) => f.variable === "VITE_EQUIPOS").estado).toBe("sin definir, así que está prendida por defecto (prendida)");
  });

  it("falla por una fila con otro valor", () => {
    const r = comparar(tabla, sitio({ VITE_PAGOS: "0", VITE_STELLAR_NETWORK: "mainnet", VITE_COMISION_PB: "200" }));
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toContain("VITE_PAGOS");
  });

  it("falla por una variable que la tabla dice sin definir y el sitio trae", () => {
    const r = comparar(tabla, sitio({ VITE_PAGOS: "1", VITE_STELLAR_NETWORK: "mainnet", VITE_COMISION_PB: "200", VITE_EQUIPOS: "1" }));
    expect(r.fallas.join(" ")).toContain("VITE_EQUIPOS");
  });

  it("falla por una definida que falta o viene vacía", () => {
    expect(comparar(tabla, sitio({ VITE_PAGOS: "1", VITE_STELLAR_NETWORK: "mainnet" })).fallas.join(" ")).toContain("VITE_COMISION_PB");
    expect(comparar(tabla, sitio({ VITE_PAGOS: "1", VITE_STELLAR_NETWORK: "mainnet", VITE_COMISION_PB: "" })).fallas.join(" ")).toContain("vacía");
  });

  it("falla por una variable del sitio que la tabla no nombra, e ignora las del sistema", () => {
    const r = comparar(
      tabla,
      sitio({ VITE_PAGOS: "1", VITE_STELLAR_NETWORK: "mainnet", VITE_COMISION_PB: "200", VITE_NUEVA: "1", VITE_VERCEL_ENV: "production" }),
    );
    expect(r.fallas).toHaveLength(1);
    expect(r.fallas[0]).toContain("VITE_NUEVA");
    expect(r.fallas[0]).not.toContain("VITE_VERCEL");
  });

  it("nunca escribe el valor de una reservada ni de una que la tabla no nombra", () => {
    const secreto = "pub_ABCDEF1234567890SECRETO";
    const r = comparar(tabla, sitio({ VITE_PAGOS: "1", VITE_STELLAR_NETWORK: "mainnet", VITE_COMISION_PB: secreto, VITE_NUEVA: secreto, VITE_EQUIPOS: secreto }));
    const todo = JSON.stringify(r);
    expect(todo).not.toContain("SECRETO");
  });
});
