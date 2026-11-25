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
