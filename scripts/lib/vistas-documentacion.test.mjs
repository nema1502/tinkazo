import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validarVistas } from "./vistas.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (...partes) => readFileSync(join(aqui, "..", "..", ...partes), "utf8").replace(/\r\n/g, "\n");

/** Las recetas de la cabecera del guion: cada objeto que empieza con {"nombre" (puede ocupar varios renglones). */
function recetasDeLaCabecera() {
  const cabecera = leer("scripts", "capturar-vistas.mjs").split("*/")[0];
  const renglones = cabecera.split("\n").map((r) => r.replace(/^\s*\*\s?/, "").trim());
  const desde = renglones.findIndex((r) => r.startsWith("Recetas"));
  const recetas = [];
  let actual = "";
  for (const r of renglones.slice(desde)) {
    if (!actual && !r.startsWith('{"nombre"')) continue;
    actual = actual ? `${actual} ${r}` : r;
    try {
      recetas.push(JSON.parse(actual));
      actual = "";
    } catch {
      /* sigue en el renglón de abajo */
    }
  }
  return { recetas, sobrante: actual };
}

describe("las recetas de la cabecera del guion", () => {
  const { recetas, sobrante } = recetasDeLaCabecera();

  it("todas se leen como JSON y pasan la validación de verdad", () => {
    expect(sobrante).toBe("");
    expect(recetas.length).toBeGreaterThanOrEqual(7);
    const { errores } = validarVistas(recetas);
    expect(errores).toEqual([]);
  });

  it("la espera de la demostración llega a la capa grande: toca su botón hasta que aparece el reloj", () => {
    const espera = recetas.find((r) => r.nombre === "espera-demo");
    expect(espera.ruta).toBe("/?demo=wheel&lead=45");
    expect(espera.pausaMs).toBe(4000);
    expect(espera.pasos).toEqual([
      { accion: "esperar", selector: "#btn-espera" },
      { accion: "clicHasta", selector: "#btn-espera", hasta: ".espera-reloj" },
    ]);
  });

  it("la espera con 150 personas usa ?n= y los mismos pasos", () => {
    const base = recetas.find((r) => r.nombre === "espera-demo");
    const con150 = recetas.find((r) => r.nombre === "espera-demo-150");
    expect(con150.ruta).toBe("/?demo=wheel&lead=45&n=150");
    expect(con150.pasos).toEqual(base.pasos);
    expect(con150.pausaMs).toBe(base.pausaMs);
  });

  it("el resultado de la demostración espera al ganador y recién después desplaza la caja", () => {
    const r = recetas.find((x) => x.nombre === "resultado-demo");
    expect(r.pasos).toEqual([
      { accion: "esperar", selector: ".winner-name" },
      { accion: "pausa", ms: 1500 },
      { accion: "desplazar", selector: "#winner-box" },
    ]);
    expect(r.esperar).toBeUndefined();
  });

  it("ninguna receta desplaza sin haber esperado antes algo de la página", () => {
    for (const r of recetas) {
      const pasos = r.pasos ?? [];
      pasos.forEach((p, i) => {
        if (p.accion !== "desplazar") return;
        expect(pasos.slice(0, i).some((q) => q.accion === "esperar" || q.accion === "clicHasta"), r.nombre).toBe(true);
      });
    }
  });
});

describe("el ejemplo del comentario del flujo de auditores", () => {
  /** El comando de `gh workflow run`, con sus renglones unidos por la barra invertida. */
  function ejemplo() {
    const renglones = leer(".github", "workflows", "auditores.yml").split("\n");
    const i = renglones.findIndex((r) => r.startsWith("#   gh workflow run auditores.yml"));
    expect(i).toBeGreaterThan(0);
    const partes = [];
    for (let j = i; j < renglones.length; j++) {
      const sinMarca = renglones[j].replace(/^#\s*/, "");
      partes.push(sinMarca.replace(/\s*\\$/, ""));
      if (!sinMarca.endsWith("\\")) break;
    }
    return partes.join(" ");
  }

  it("si se copia entero lleva la rama, el entorno y las vistas, sin un numeral que lo corte", () => {
    const comando = ejemplo();
    expect(comando).toContain("-f rama=main");
    expect(comando).toContain("-f entorno=VITE_CAMPANAS=1");
    expect(comando).toContain("-f vistas='[");
    expect(comando).not.toContain(" #");
  });
});

describe("la documentación del modo de capturas", () => {
  const flujo = leer(".github", "workflows", "auditores.yml");
  const arquitectura = leer("docs", "architecture.md");
  const decision = arquitectura.split("\n").find((r) => r.startsWith("| D-12 |")) ?? "";

  it("la decisión de la revisión repartida cuenta el modo de capturas: los tres datos, el artefacto y la advertencia", () => {
    expect(decision).toContain("capturar-vistas.mjs");
    for (const dato of ["`vistas`", "`rama`", "`entorno`"]) expect(decision).toContain(dato);
    expect(decision).toContain("capturas-vistas");
    expect(decision).toMatch(/un día/);
    expect(decision).toMatch(/personas reales/);
    expect(decision).toMatch(/caché de pnpm/);
  });

  it("la decisión cuenta por qué desde la rama principal no se construye otra rama y qué referencias no se aceptan", () => {
    expect(decision).toMatch(/lanzada desde la rama principal solo construye la principal/);
    expect(decision).toMatch(/token de la corrida/);
    expect(decision).toMatch(/pull\/N/);
    expect(decision).not.toMatch(/donde lo leería después la revisión de esa rama/);
  });

  /** Los renglones de comando de un comentario: sin la marca de comentario y con la barra de continuación. */
  function comandosDeComentario(texto, desde, marca) {
    const renglones = texto.split("\n");
    const i = renglones.findIndex((r) => r.includes(desde));
    expect(i, desde).toBeGreaterThanOrEqual(0);
    const salida = [];
    for (let j = i + 1; j < renglones.length; j++) {
      const r = renglones[j];
      if (!r.startsWith(marca)) break;
      const sin = r.slice(marca.length);
      if (!sin.startsWith("   ")) break;
      salida.push(sin.slice(3));
    }
    return salida.join("\n");
  }

  const hayBash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";
  const sintaxis = (comandos) => spawnSync("bash", ["-n"], { input: comandos, encoding: "utf8" });

  it.skipIf(!hayBash)("el uso del guion se puede copiar en una terminal de bash y empieza por construir el sitio", () => {
    const comandos = comandosDeComentario(leer("scripts", "capturar-vistas.mjs"), " * Uso:", " *");
    expect(comandos).toMatch(/^pnpm build$/m);
    expect(comandos.indexOf("pnpm build")).toBeLessThan(comandos.indexOf("pnpm preview"));
    const r = sintaxis(comandos);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.skipIf(!hayBash)("el ejemplo del flujo se puede copiar en una terminal de bash", () => {
    const comandos = comandosDeComentario(flujo, "que muestra `gh run list`):", "#");
    expect(comandos).toContain("gh workflow run auditores.yml");
    expect(comandos).toContain("gh run download");
    expect(comandos).not.toMatch(/[<>]/);
    const r = sintaxis(comandos);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("la cabecera del guion avisa, bien arriba, que no se capturan datos de personas reales", () => {
    const arriba = leer("scripts", "capturar-vistas.mjs").split("\n").slice(0, 12).join("\n");
    expect(arriba).toMatch(/nunca/i);
    expect(arriba).toMatch(/personas reales/);
  });
});
