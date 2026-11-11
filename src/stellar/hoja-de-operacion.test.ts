import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La hoja de operación del portero de mainnet (`docs/operacion.md`) y el README del portero (`workers/patrocinio/README.md`)
 * dicen lo mismo, y lo que hace el código del portero, en lo que se usa el día de un evento: qué limita las consultas del
 * cupo y qué hacer si el acceso de alguien quedó en otra cuenta. Se leen los archivos tal como están escritos.
 */

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8");
const hoja = leer("docs/operacion.md");
const readme = leer("workers/patrocinio/README.md");
const porIp = leer("workers/patrocinio/src/por-ip.ts");
const rutasAltas = leer("workers/patrocinio/src/rutas-altas.ts");

/** Un número como se escribe en los documentos: con punto de miles (3.000). */
const conPunto = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Las consultas del cupo por dirección y por hora, en mainnet y en testnet, como las fija `cupoPorHora`. */
function cupoPorHora(): { mainnet: string; testnet: string } {
  const m = /return red === "mainnet" \? (\d+) : (\d+);/.exec(porIp);
  if (!m) throw new Error("cupoPorHora cambió de forma: actualizar esta prueba");
  return { mainnet: conPunto(Number(m[1])), testnet: conPunto(Number(m[2])) };
}

/** La sección del README sobre la regla de límite de Cloudflare. */
function seccionDeLaRegla(): string {
  const desde = readme.indexOf("## La regla de límite de Cloudflare");
  expect(desde).toBeGreaterThan(-1);
  const hasta = readme.indexOf("\n## ", desde + 1);
  return readme.slice(desde, hasta < 0 ? undefined : hasta);
}

/** La línea de un texto que dice que el cupo no pasa por la regla. */
const lineaDelCupo = (texto: string): string => texto.split("\n").find((l) => l.includes("`GET /v1/patrocinio/cupo` no pasa por")) ?? "";

describe("la regla de límite de Cloudflare delante del portero de mainnet", () => {
  it("la hoja y el README dicen las mismas rutas y los mismos números", () => {
    const regla = hoja.split("\n").find((l) => l.includes("**La regla de límite de Cloudflare**")) ?? "";
    for (const [nombre, texto] of [
      ["hoja", regla],
      ["README", seccionDeLaRegla()],
    ] as const) {
      expect(texto, nombre).toContain("pm.tinkazo.app");
      expect(texto, nombre).toMatch(/`POST \/v1\/alta\/estado` y `(POST )?\/v1\/alta\/cupon`/);
      expect(texto, nombre).toContain("60 pedidos en 10 segundos");
      expect(texto, nombre).toMatch(/20 (pedidos )?en 10 segundos para `POST \/v1\/patrocinio`/);
    }
  });

  it("las consultas del cupo no pasan por la regla: las limita el propio portero, con el número de `cupoPorHora`", () => {
    const n = cupoPorHora();
    for (const [nombre, texto] of [
      ["hoja", hoja],
      ["README", seccionDeLaRegla()],
    ] as const) {
      const linea = lineaDelCupo(texto);
      expect(linea, nombre).not.toBe("");
      expect(linea, nombre).toContain(n.mainnet);
      expect(linea, nombre).toContain("por dirección y por hora");
    }
    expect(lineaDelCupo(readme)).toContain(n.testnet);
    // Ninguna regla de Cloudflare sugerida para el cupo.
    expect(readme).not.toMatch(/uri\.path eq "\/v1\/patrocinio\/cupo"/);
  });
});

describe("el acceso que quedó en otra cuenta", () => {
  it("la hoja dice qué mirar en el registro, con lo que anota el portero, y cómo admitir a mano", () => {
    expect(rutasAltas).toContain('this.registrar("error-alta", { motivo: "cuenta-de-otro" })');
    const durante = hoja.slice(hoja.indexOf("## Durante el evento"), hoja.indexOf("## Después del evento"));
    expect(durante).toContain('`{"evento":"error-alta","motivo":"cuenta-de-otro"}`');
    expect(durante).toMatch(/node scripts\/cupones\.mjs admitir --cuenta G\.\.\. --sorteos \d+ --dias \d+ --ref \S+/);
    expect(durante).toContain("«Dejá tu cuenta lista»");
  });
});
