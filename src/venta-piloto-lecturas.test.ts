import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Las tres banderas de la venta (`VITE_ALTA_PAGO`, `VITE_PAGO_CON_SALDO` y `VITE_COMPRA_QR`) se leen solo en la puerta
 * del piloto, `src/stellar/venta-piloto.ts`. Una lectura en otro lado, de `import.meta.env` o de un entorno, saltaría el
 * piloto y le mostraría la venta a todos los que abren el build. Se lee el código del sitio como texto, sin los
 * comentarios.
 */

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const PUERTA = "src/stellar/venta-piloto.ts";

/** Una de las tres, salvo cuando la sigue un `=`: ahí es un texto que nombra un valor («VITE_COMPRA_QR=1 necesita…»). */
const NOMBRE = /\bVITE_(?:ALTA_PAGO|PAGO_CON_SALDO|COMPRA_QR)\b(?!=)/g;
/** Las funciones de las banderas, llamadas con el entorno crudo del build: así se salta la marca del piloto. */
const CON_EL_ENTORNO_CRUDO = /\b(?:banderasDeVenta|banderasDeAlta|pagoConSaldoActivo|compraQrActiva|cobroEnElBuild|ventaALaVista|ventaAbiertaATodos|sumarConCualquierCupo)\(\s*(?:import\.meta\.env\b|entornoDelBuild\(\))/g;

/** El código sin sus comentarios. Un `//` después de dos puntos es una dirección (`https://`), no un comentario. */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** Las lecturas de las tres banderas en un código. */
function lecturas(codigo: string): string[] {
  return [...sinComentarios(codigo).matchAll(NOMBRE)].map((m) => m[0]);
}

function archivosDelSitio(dir: string): string[] {
  const fuera: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) fuera.push(...archivosDelSitio(ruta));
    else if (/\.ts$/.test(nombre) && !/\.test\.ts$/.test(nombre)) fuera.push(ruta);
  }
  return fuera;
}

const ARCHIVOS = [...archivosDelSitio(join(RAIZ, "src")), join(RAIZ, "vite.config.ts")].map((ruta) => ({ nombre: relative(RAIZ, ruta).split(sep).join("/"), codigo: readFileSync(ruta, "utf8") }));

describe("las tres banderas de la venta se leen solo en la puerta del piloto", () => {
  it("la prueba reconoce una lectura, y no un comentario ni un texto que nombra un valor", () => {
    expect(lecturas("const x = import.meta.env.VITE_COMPRA_QR;")).toEqual(["VITE_COMPRA_QR"]);
    expect(lecturas('const { VITE_ALTA_PAGO } = env; f(env["VITE_PAGO_CON_SALDO"]);')).toEqual(["VITE_ALTA_PAGO", "VITE_PAGO_CON_SALDO"]);
    expect(lecturas('const u = "https://pm.tinkazo.app"; const q = e.VITE_COMPRA_QR;')).toEqual(["VITE_COMPRA_QR"]);
    expect(lecturas("// VITE_COMPRA_QR\n/** `VITE_ALTA_PAGO` */\nconst a = 1;")).toEqual([]);
    expect(lecturas('p.push("VITE_COMPRA_QR=1 necesita VITE_PAGO_CON_SALDO=1: la compra");')).toEqual([]);
  });

  it("fuera de la puerta, ningún archivo del sitio las lee", () => {
    const fuera = ARCHIVOS.filter((a) => a.nombre !== PUERTA && lecturas(a.codigo).length > 0).map((a) => `${a.nombre}: ${lecturas(a.codigo).join(", ")}`);
    expect(fuera).toEqual([]);
  });

  it("la puerta lee las tres", () => {
    const puerta = ARCHIVOS.find((a) => a.nombre === PUERTA);
    expect(puerta, PUERTA).toBeTruthy();
    expect(new Set(lecturas(puerta?.codigo ?? ""))).toEqual(new Set(["VITE_ALTA_PAGO", "VITE_PAGO_CON_SALDO", "VITE_COMPRA_QR"]));
  });

  it("nadie fuera de la puerta les pasa el entorno crudo del build, que salta la marca del piloto", () => {
    const fuera = ARCHIVOS.filter((a) => a.nombre !== PUERTA).flatMap((a) => [...sinComentarios(a.codigo).matchAll(CON_EL_ENTORNO_CRUDO)].map((m) => `${a.nombre}: ${m[0]}`));
    expect(fuera).toEqual([]);
  });

  it("fuera de la puerta, banderasDeVenta se llama sin entorno (el del sitio) o con el que recibió quien la llama", () => {
    const fuera = ARCHIVOS.filter((a) => a.nombre !== PUERTA).flatMap((a) =>
      [...sinComentarios(a.codigo).matchAll(/\bbanderasDeVenta\(([^)]*)\)/g)].filter((m) => !["", "env"].includes((m[1] ?? "").trim())).map((m) => `${a.nombre}: ${m[0]}`),
    );
    expect(fuera).toEqual([]);
  });
});
