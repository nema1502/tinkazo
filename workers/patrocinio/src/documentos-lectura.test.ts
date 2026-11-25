// Que lo que se dice de la clave de solo lectura (issue 219) esté entero y en su orden en el README del portero y en la
// hoja de operación: la tabla de administración no se parte, y el orden en que se cargan las claves está escrito. Se
// leen los archivos tal como están. Ninguna prueba lee un secreto: los nombres sí, los valores nunca.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raiz = fileURLToPath(new URL("../../../", import.meta.url));
const leer = (ruta: string): string => readFileSync(join(raiz, ruta), "utf8").replace(/\r\n/g, "\n");

const readme = leer("workers/patrocinio/README.md");
const hoja = leer("docs/operacion.md");

/** El texto de una sección `##` o `###` del documento, hasta el próximo encabezado del mismo nivel o de uno mayor. */
function seccion(texto: string, encabezado: string): string {
  const inicio = texto.indexOf(`\n${encabezado}\n`);
  expect(inicio, `falta el encabezado ${encabezado}`).toBeGreaterThan(-1);
  const nivel = encabezado.match(/^#+/)![0].length;
  const resto = texto.slice(inicio + encabezado.length + 2);
  const fin = resto.search(new RegExp(`\\n#{1,${nivel}} `));
  return fin < 0 ? resto : resto.slice(0, fin);
}

describe("README del portero: la administración y la clave de solo lectura", () => {
  it("la tabla de administración no se parte: su encabezado y su línea de columnas van pegados", () => {
    const admin = seccion(readme, "## Administración");
    const lineas = admin.split("\n");
    const encabezado = lineas.findIndex((l) => l.startsWith("| Pedido | Qué hace |"));
    expect(encabezado).toBeGreaterThan(-1);
    expect(lineas[encabezado + 1]).toBe("| --- | --- |");
    // Cada fila de la tabla sigue a la anterior, sin renglones de otra cosa en el medio.
    const tabla: string[] = [];
    for (const fila of lineas.slice(encabezado + 2)) {
      if (!fila.startsWith("|")) break;
      tabla.push(fila);
    }
    expect(tabla.length).toBeGreaterThanOrEqual(6);
    expect(tabla.some((f) => f.includes("`POST /v1/patrocinio/apagar`"))).toBe(true);
    expect(tabla.some((f) => f.includes("`GET /v1/patrocinio/exportar`"))).toBe(true);
  });

  it("dice qué abre la clave de solo lectura y qué no", () => {
    const lectura = seccion(readme, "## Lectura del estado");
    expect(lectura).toContain("TOKEN_LECTURA");
    expect(lectura).toContain("`GET /v1/patrocinio/estado`");
    expect(lectura).toMatch(/no puede apagar/);
    expect(lectura).toMatch(/exportar/);
  });

  it("dice en qué orden se carga: primero el portero, después el vigilante y al final GitHub", () => {
    const lectura = seccion(readme, "## Lectura del estado");
    const portero = lectura.indexOf("secret put TOKEN_LECTURA");
    const vigilante = lectura.indexOf("PORTERO_TOKEN_LECTURA");
    const github = lectura.indexOf("PORTERO_MAINNET_TOKEN_LECTURA");
    expect(portero).toBeGreaterThan(-1);
    expect(vigilante).toBeGreaterThan(portero);
    expect(github).toBeGreaterThan(vigilante);
    expect(lectura).toMatch(/hoja de operación/);
  });
});

describe("hoja de operación: el orden de la clave de solo lectura", () => {
  const orden = seccion(hoja, "### La clave de solo lectura del portero: en qué orden se carga");

  it("los tres pasos van en orden: el portero, el vigilante y al final el secreto de GitHub", () => {
    const portero = orden.search(/\n1\. \*\*En el portero/);
    const vigilante = orden.search(/\n2\. \*\*En el vigilante/);
    const github = orden.search(/\n3\. \*\*En GitHub/);
    expect(portero).toBeGreaterThan(-1);
    expect(vigilante).toBeGreaterThan(portero);
    expect(github).toBeGreaterThan(vigilante);
    expect(orden.slice(portero, vigilante)).toContain("secret put TOKEN_LECTURA");
    expect(orden.slice(vigilante, github)).toContain("secret put PORTERO_TOKEN_LECTURA");
    expect(orden.slice(github)).toContain("PORTERO_MAINNET_TOKEN_LECTURA");
  });

  it("dice qué pasa si se invierte el orden y cómo se vuelve atrás", () => {
    expect(orden).toMatch(/401/);
    expect(orden).toMatch(/Al vigilante le falta la clave del portero/);
    expect(orden).toMatch(/borrar/i);
  });

  it("dice que la clave de lectura es distinta de la de operar y que se prueba antes de seguir", () => {
    expect(orden).toMatch(/distinta/);
    expect(orden).toMatch(/401/);
    expect(orden).toMatch(/apagar/);
  });

  it("dice que no se hace antes de los eventos ni durante uno, y que hace falta la palabra de quien mantiene el proyecto", () => {
    expect(orden).toMatch(/palabra de quien mantiene el proyecto/);
    expect(orden).toMatch(/evento/);
  });
});
