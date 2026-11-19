import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La parte de pagos de la hoja de operación (`docs/operacion.md`, «La venta de paquetes, día a día») dice lo que hacen
 * la herramienta (`scripts/cupones.mjs`) y el portero: cada orden de la herramienta con sus opciones, cada ruta, cada
 * motivo de un pago suelto y los números que se usan para decidir. Se leen los archivos tal como están escritos.
 *
 * La orden `cerrar` de la herramienta, la ruta `ordenes/cerrar` y los motivos `repetido` y `cerrada` los trae el
 * portero que cierra los dos huecos de la venta, que se prende antes que ella. Lo que esta copia todavía no tiene se
 * comprueba en cuanto esté (`it.runIf`), y lo demás siempre.
 */

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8");
const hoja = leer("docs/operacion.md");
const herramienta = leer("scripts/cupones.mjs");
const cobros = leer("workers/patrocinio/src/cobros.ts");
const admin = leer("workers/patrocinio/src/admin.ts");
const rutasAltas = leer("workers/patrocinio/src/rutas-altas.ts");
const indice = leer("workers/patrocinio/src/index.ts");
const wrangler = leer("workers/patrocinio/wrangler.toml");

/** La sección de pagos, hasta el final de la hoja o la próxima sección del mismo nivel. */
function seccion(): string {
  const desde = hoja.indexOf("## La venta de paquetes, día a día");
  expect(desde, "la hoja tiene la sección de pagos").toBeGreaterThan(-1);
  const hasta = hoja.indexOf("\n## ", desde + 1);
  return hoja.slice(desde, hasta < 0 ? undefined : hasta);
}
const pagos = seccion();

/** Las líneas de uso de la herramienta: `node scripts/cupones.mjs <orden> --opción <valor> ...`. */
const AYUDA = /const AYUDA = `([\s\S]*?)`;/.exec(herramienta)?.[1] ?? "";
const usoDe = (orden: string): string | undefined => AYUDA.split("\n").find((l) => l.trim().startsWith(`node scripts/cupones.mjs ${orden} `) || l.trim() === `node scripts/cupones.mjs ${orden}`);
const tieneCerrar = usoDe("cerrar") !== undefined;

/** Los comandos de la herramienta que nombra la sección, con sus opciones. */
const comandos = [...pagos.matchAll(/`node scripts\/cupones\.mjs ([a-z]+)((?: --[a-z]+(?: [^`\s]+)?)*)`/g)].map((m) => ({ orden: m[1] as string, opciones: [...(m[2] ?? "").matchAll(/--([a-z]+)/g)].map((o) => o[1] as string) }));

/** Los motivos de un pago suelto que conoce el portero. */
const motivosDelPortero = (/export type MotivoSuelto = ([^;]+);/.exec(cobros)?.[1] ?? "").match(/"[a-z-]+"/g)?.map((x) => x.slice(1, -1)) ?? [];
const motivosDeLaHoja = [...pagos.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1] as string);

describe("la parte de pagos de la hoja de operación", () => {
  it("nombra las órdenes de la herramienta que se usan con los pagos", () => {
    expect(comandos.map((c) => c.orden).sort()).toEqual(expect.arrayContaining(["asignar", "cerrar", "devuelto", "sueltos"]));
  });

  it("cada orden de la herramienta que nombra existe, con esas opciones", () => {
    for (const c of comandos.filter((x) => x.orden !== "cerrar")) {
      const uso = usoDe(c.orden);
      expect(uso, c.orden).toBeDefined();
      for (const o of c.opciones) expect(uso, `${c.orden} --${o}`).toContain(`--${o} `);
    }
  });

  it.runIf(tieneCerrar)("cerrar existe en la herramienta, con sus opciones, y el portero tiene su ruta", () => {
    for (const c of comandos.filter((x) => x.orden === "cerrar")) for (const o of c.opciones) expect(usoDe("cerrar"), `cerrar --${o}`).toContain(`--${o} `);
    expect(admin).toContain('"/v1/admin/ordenes/cerrar"');
    expect(rutasAltas).toContain("orden-cerrada");
  });

  it("las rutas que nombra son las del portero", () => {
    expect(pagos).toContain("$P/v1/admin/ventas/pausar");
    expect(pagos).toContain("$P/v1/admin/ventas/reanudar");
    expect(admin).toContain('"/v1/admin/ventas/pausar"');
    expect(admin).toContain('"/v1/admin/ventas/reanudar"');
    expect(admin).toContain("{ ventaPausada }");
    for (const r of ["orden", "pago", "precios"]) expect(rutasAltas, r).toMatch(new RegExp(`\\|${r}\\b|${r}\\|`));
    expect(indice).toContain("exportar");
  });

  it("cada motivo de un pago suelto que conoce el portero tiene su renglón, con qué se hace", () => {
    expect(motivosDelPortero.length).toBeGreaterThanOrEqual(4);
    for (const m of motivosDelPortero) expect(motivosDeLaHoja, m).toContain(m);
    // Los dos que suma el portero de la venta van en la hoja desde ya.
    expect(motivosDeLaHoja).toEqual(expect.arrayContaining(["repetido", "cerrada"]));
  });

  it("los números para decidir son los del portero y la herramienta", () => {
    expect(cobros).toContain("export const PORCENTAJE_MINIMO = 95;");
    expect(pagos).toContain("95 %");
    expect(cobros).toContain("export const ORDEN_VIVE_MS = 72 * 3_600_000;");
    expect(pagos).toContain("72 horas");
    expect(cobros).toContain("export const ORDEN_CON_PAGO_VIVE_MS = 30 * 24 * 3_600_000;");
    expect(pagos).toContain("hasta 30 días");
    expect(wrangler).toMatch(/^CREDITOS_POR_SORTEO = "40"$/m);
    expect(wrangler).toMatch(/^CREDITOS_POR_ALTA = "30"$/m);
    expect(pagos).toContain("40 créditos por cada sorteo");
    expect(pagos).toContain("30 más mientras la cuenta no se active");
    expect(herramienta).toContain("const FORMA_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;");
    expect(pagos).toContain("hasta 64, empezando por una letra o un número");
  });

  it("los eventos del registro que nombra la prueba con plata existen en el portero", () => {
    const portero = [cobros, admin, rutasAltas, indice].join("\n");
    for (const e of ["alta-orden", "alta-pago", "pago-suelto", "admin-suelto", "error-config", "error-horizon"]) expect(portero, e).toContain(`"${e}"`);
    if (tieneCerrar) expect(portero).toContain('"admin-cerrada"');
  });

  it("los despliegues van con la versión probada de wrangler, la configuración y la red principal", () => {
    for (const l of pagos.split("\n").filter((x) => x.includes("wrangler"))) {
      expect(l).toContain("npx wrangler@4.160.0");
      expect(l).toContain("--config wrangler.toml");
      expect(l).toContain("--env mainnet");
    }
  });

  it("no ofrece marcar una orden pagada a mano: el pago se reconoce solo", () => {
    expect(pagos).not.toMatch(/cupones\.mjs pagada|qr-bs|a-mano/);
  });
});
