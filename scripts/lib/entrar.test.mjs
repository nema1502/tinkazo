// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearChip } from "../../src/ui/cuenta-chip";
import { BOTON_ENTRAR_JS, HAY_BOTON_ENTRAR_JS, SELECTOR_CHIP_ENTRAR, TOCAR_ENTRAR_JS } from "./entrar.mjs";

/** Evalúa una expresión de las que los auditores le mandan a la página, sobre el documento de la prueba. */
const evaluar = (expresion) => (0, eval)(expresion);

const tx = (clave) => clave;
const dentro = { estado: "dentro", via: "prueba", nombre: "Ana", inicial: "A", foto: "", direccion: "" };

/**
 * La caja de la cabecera como la arma `pintarCuenta` con el modo Oficial a la vista: el botón del modo primero y el chip
 * de la cuenta después, hecho con el código del sitio.
 */
function armarCaja(estado) {
  document.body.innerHTML = '<div class="auth" id="wallet-box"></div><div id="gate"></div>';
  const caja = document.getElementById("wallet-box");
  const modo = document.createElement("button");
  modo.type = "button";
  modo.className = "netbadge con-modo";
  modo.textContent = "Prueba";
  caja.appendChild(modo);
  const chip = crearChip(estado, { tx });
  caja.appendChild(chip);
  return { caja, modo, chip };
}

function armarPuerta() {
  const puerta = document.getElementById("gate");
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Entrar";
  puerta.appendChild(b);
  return b;
}

/**
 * jsdom no hace diseño: `getClientRects()` siempre vuelve vacío. Esto lo hace como un navegador para lo único que importa
 * acá: un elemento escondido con `display:none`, él o cualquiera de sus padres, no tiene rectángulos, y uno que se ve tiene uno.
 */
function simularDiseno() {
  return vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function () {
    for (let n = this; n instanceof Element; n = n.parentElement) {
      if (getComputedStyle(n).display === "none") return [];
    }
    return [{ x: 0, y: 0, width: 100, height: 48 }];
  });
}

describe("el botón de entrar de los auditores", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    simularDiseno();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("con el botón del modo primero en la caja, encuentra el chip Entrar y no el del modo", () => {
    const { modo, chip } = armarCaja({ estado: "fuera" });
    expect(document.querySelector("#wallet-box button")).toBe(modo);
    expect(evaluar(BOTON_ENTRAR_JS)).toBe(chip);
    expect(evaluar(BOTON_ENTRAR_JS)).not.toBe(modo);
    expect(chip.matches(SELECTOR_CHIP_ENTRAR)).toBe(true);
  });

  it("tocarlo llama al clic del chip y no al del botón del modo", () => {
    const { modo, chip } = armarCaja({ estado: "fuera" });
    const tocados = [];
    modo.addEventListener("click", () => tocados.push("modo"));
    chip.addEventListener("click", () => tocados.push("entrar"));
    expect(evaluar(TOCAR_ENTRAR_JS)).toBe(true);
    expect(tocados).toEqual(["entrar"]);
  });

  it("sin botón del modo (una sola red) encuentra el chip igual", () => {
    document.body.innerHTML = '<div id="wallet-box"></div>';
    const chip = crearChip({ estado: "fuera" }, { tx });
    document.getElementById("wallet-box").appendChild(chip);
    expect(evaluar(BOTON_ENTRAR_JS)).toBe(chip);
  });

  it("el botón del cuadro de la herramienta va primero, y es el mismo orden de siempre", () => {
    const { chip } = armarCaja({ estado: "fuera" });
    const delCuadro = armarPuerta();
    expect(evaluar(BOTON_ENTRAR_JS)).toBe(delCuadro);
    expect(evaluar(BOTON_ENTRAR_JS)).not.toBe(chip);
    const tocados = [];
    delCuadro.addEventListener("click", () => tocados.push("cuadro"));
    chip.addEventListener("click", () => tocados.push("chip"));
    expect(evaluar(TOCAR_ENTRAR_JS)).toBe(true);
    expect(tocados).toEqual(["cuadro"]);
  });

  it("con la puerta escondida (display:none) toma el chip de la cabecera y no el botón de la puerta", () => {
    const { chip } = armarCaja({ estado: "fuera" });
    const delCuadro = armarPuerta();
    document.getElementById("gate").style.display = "none";
    expect(evaluar(BOTON_ENTRAR_JS)).toBe(chip);
    expect(evaluar(BOTON_ENTRAR_JS)).not.toBe(delCuadro);
    const tocados = [];
    delCuadro.addEventListener("click", () => tocados.push("cuadro"));
    chip.addEventListener("click", () => tocados.push("chip"));
    expect(evaluar(TOCAR_ENTRAR_JS)).toBe(true);
    expect(tocados).toEqual(["chip"]);
  });

  it("con la puerta escondida y la cuenta ya adentro, no hay botón de entrar", () => {
    armarCaja(dentro);
    armarPuerta();
    document.getElementById("gate").style.display = "none";
    expect(evaluar(BOTON_ENTRAR_JS)).toBeNull();
    expect(evaluar(HAY_BOTON_ENTRAR_JS)).toBe(false);
    expect(evaluar(TOCAR_ENTRAR_JS)).toBe(false);
  });

  it("la puerta que se ve vuelve a tener el primer lugar cuando deja de estar escondida", () => {
    const { chip } = armarCaja({ estado: "fuera" });
    const delCuadro = armarPuerta();
    const puerta = document.getElementById("gate");
    puerta.style.display = "none";
    expect(evaluar(BOTON_ENTRAR_JS)).toBe(chip);
    puerta.style.display = "";
    expect(evaluar(BOTON_ENTRAR_JS)).toBe(delCuadro);
  });

  it("mientras la cuenta conecta, retoma o ya está adentro, no hay botón de entrar y la espera sigue", () => {
    for (const estado of [{ estado: "conectando" }, { estado: "retomando" }, dentro]) {
      armarCaja(estado);
      expect(evaluar(HAY_BOTON_ENTRAR_JS), estado.estado).toBe(false);
      expect(evaluar(BOTON_ENTRAR_JS), estado.estado).toBeNull();
      expect(evaluar(TOCAR_ENTRAR_JS), estado.estado).toBe(false);
    }
  });

  it("la espera se cumple cuando el chip pasa a Entrar", () => {
    armarCaja({ estado: "retomando" });
    expect(evaluar(HAY_BOTON_ENTRAR_JS)).toBe(false);
    armarCaja({ estado: "fuera" });
    expect(evaluar(HAY_BOTON_ENTRAR_JS)).toBe(true);
  });
});

describe("ningún guion toca el primer botón de la caja de la cabecera", () => {
  // Vitest corre desde la raíz del repositorio. `import.meta.url` no sirve acá: con jsdom no es una ruta de archivo.
  const carpeta = join(process.cwd(), "scripts");
  const guiones = readdirSync(carpeta)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => ({ f, texto: readFileSync(join(carpeta, f), "utf8") }));

  it("hay guiones que mirar", () => {
    expect(guiones.length).toBeGreaterThan(20);
  });

  it("`#wallet-box button` a secas no aparece: el botón del modo se nombra con su clase y el de entrar sale de entrar.mjs", () => {
    const sueltos = [];
    for (const { f, texto } of guiones) {
      texto.split("\n").forEach((linea, i) => {
        if (/#wallet-box button(?!\.netbadge)/.test(linea)) sueltos.push(`${f}:${i + 1}`);
      });
    }
    expect(sueltos).toEqual([]);
  });

  it("los guiones que conectan una cuenta tocan el botón con la pieza compartida", () => {
    for (const f of ["audit-ui.mjs", "audit-modos.mjs", "audit-flujo.mjs", "audit-detalles.mjs"]) {
      const texto = guiones.find((g) => g.f === f)?.texto ?? "";
      expect(texto, f).toMatch(/from "\.\/lib\/entrar\.mjs"/);
      expect(texto, f).toMatch(/TOCAR_ENTRAR_JS/);
    }
  });
});
