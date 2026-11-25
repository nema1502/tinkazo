import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lo que el flujo `auditores.yml` promete, leído como texto: quién corre con qué datos, con qué permisos
 * y sin qué. Es un guion de seguridad (construye una rama cualquiera en una máquina de GitHub), así que
 * estas pruebas frenan un cambio que lo debilite sin que nadie lo note.
 */
const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (...partes) => readFileSync(join(aqui, "..", "..", ...partes), "utf8").replace(/\r\n/g, "\n");
const flujo = leer(".github", "workflows", "auditores.yml");

/** Los trabajos: nombre y texto de cada uno (de su renglón de nombre al del siguiente). */
function trabajos() {
  const renglones = flujo.split("\n");
  const desde = renglones.findIndex((r) => r === "jobs:");
  expect(desde).toBeGreaterThan(0);
  const salida = {};
  let actual = null;
  for (const r of renglones.slice(desde + 1)) {
    const cabecera = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(r);
    if (cabecera) {
      actual = cabecera[1];
      salida[actual] = [];
    } else if (actual) salida[actual].push(r);
  }
  return Object.fromEntries(Object.entries(salida).map(([k, v]) => [k, v.join("\n")]));
}

/** Los pasos de un trabajo: cada bloque que empieza con `      - `. */
function pasos(trabajo) {
  const salida = [];
  for (const r of trabajo.split("\n")) {
    if (/^ {6}- /.test(r)) salida.push([r]);
    else if (salida.length) salida[salida.length - 1].push(r);
  }
  return salida.map((p) => p.join("\n"));
}

/** El texto de cada `run:` del flujo (de una línea o de un bloque con `|`). */
function comandos() {
  const renglones = flujo.split("\n");
  const salida = [];
  for (let i = 0; i < renglones.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(renglones[i]);
    if (!m) continue;
    if (m[2] === "|" || m[2] === ">") {
      const sangria = m[1].length;
      const bloque = [];
      for (let j = i + 1; j < renglones.length; j++) {
        const r = renglones[j];
        if (r.trim() && r.length - r.trimStart().length <= sangria) break;
        bloque.push(r);
      }
      salida.push(bloque.join("\n"));
    } else salida.push(m[2]);
  }
  return salida;
}

describe("el flujo de auditores a pedido: seguridad", () => {
  it("ningún comando lleva una expresión con datos de entrada", () => {
    const cmds = comandos();
    expect(cmds.length).toBeGreaterThan(5);
    for (const c of cmds) expect(c).not.toMatch(/\$\{\{[^}]*\b(inputs|github\.event|github\.head_ref|github\.ref_name)\b/);
  });

  it("los permisos son de solo lectura y no hay ninguno de escritura", () => {
    expect(flujo).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(flujo).not.toMatch(/^\s*[a-z-]+: write\s*$/m);
    expect(flujo).not.toMatch(/\bwrite-all\b/);
    expect(flujo).not.toMatch(/\bsecrets\./);
  });

  it("todos los checkout dejan de guardar el token", () => {
    const todos = Object.values(trabajos()).flatMap(pasos).filter((p) => p.includes("uses: actions/checkout@"));
    expect(todos.length).toBe(4);
    for (const p of todos) expect(p).toMatch(/^\s*persist-credentials: false$/m);
  });

  it("el trabajo de capturas no usa la caché de pnpm", () => {
    const capturas = trabajos().capturas;
    expect(capturas).toBeDefined();
    expect(capturas).toContain("actions/setup-node@");
    expect(capturas).not.toMatch(/^\s*cache:/m);
    expect(capturas).not.toMatch(/cache-dependency-path/);
  });

  it("el artefacto de las capturas se guarda un solo día", () => {
    const subida = pasos(trabajos().capturas).find((p) => p.includes("upload-artifact"));
    expect(subida).toContain("name: capturas-vistas");
    expect(subida).toMatch(/^\s*retention-days: 1$/m);
  });

  it("las acciones van fijadas por SHA", () => {
    const usos = flujo.split("\n").filter((r) => /^\s*(- )?uses:/.test(r));
    expect(usos.length).toBeGreaterThan(5);
    for (const u of usos) expect(u).toMatch(/uses: [\w./-]+@[0-9a-f]{40}\b/);
  });

  it("la cabecera avisa, bien arriba, que no se capturan datos de personas reales", () => {
    const arriba = flujo.split("\n").slice(0, 12).join("\n");
    expect(arriba).toMatch(/nunca/i);
    expect(arriba).toMatch(/personas reales/);
  });
});

describe("el flujo de auditores a pedido: quién corre cuándo", () => {
  const t = trabajos();
  const condicion = (nombre) => /^ {4}if: (.*)$/m.exec(t[nombre])?.[1] ?? "";

  it("construir y la matriz de auditores corren solo cuando no llega ninguno de los tres datos", () => {
    for (const dato of ["vistas", "rama", "entorno"]) expect(condicion("construir")).toContain(`inputs.${dato} == ''`);
    expect(t.auditar).toMatch(/^ {4}needs: construir$/m);
    expect(condicion("auditar")).toBe("");
  });

  it("el trabajo de capturas corre solo con vistas y solo a mano", () => {
    expect(condicion("capturas")).toContain("github.event_name == 'workflow_dispatch'");
    expect(condicion("capturas")).toContain("inputs.vistas != ''");
  });

  it("rama o entorno sin vistas falla enseguida con un mensaje claro", () => {
    const c = condicion("datos-a-medias");
    expect(c).toContain("github.event_name == 'workflow_dispatch'");
    expect(c).toContain("inputs.vistas == ''");
    expect(c).toContain("inputs.rama != ''");
    expect(c).toContain("inputs.entorno != ''");
    expect(t["datos-a-medias"]).toMatch(/::error::/);
    expect(t["datos-a-medias"]).toMatch(/exit 1/);
    expect(t["datos-a-medias"]).not.toContain("actions/checkout");
  });

  it("la corrida normal sigue igual: construye con la caché, sube el sitio y la matriz tiene sus quince auditores", () => {
    expect(t.construir).toMatch(/^\s*cache: pnpm$/m);
    expect(t.construir).toContain("pnpm build");
    expect(t.construir).toMatch(/name: sitio-dist/);
    expect(t.auditar.match(/^ {10}- id: /gm)).toHaveLength(15);
    expect(flujo).toMatch(/^ {2}pull_request:\n {4}paths:\n {6}- \.github\/workflows\/auditores\.yml$/m);
  });
});
