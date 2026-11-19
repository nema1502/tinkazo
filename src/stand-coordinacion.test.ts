import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLAVE_ETIQUETAS } from "./equipos/etiquetas";
import { EVENTO_POR_DEFECTO, MAX_NOTA_BYTES, bytesDe, memoCupon } from "./equipos/modelo";
import { modoDeRampa, monedasActivas, planDelEquipo } from "./stellar/cuenta-config";
import { pagosActivos } from "./stellar/pagos-bandera";

/**
 * Las piezas del stand de Space Apps (equipos con cupón, premios pagados, saldo y plan) se construyeron por separado:
 * esta prueba ata lo que tienen que compartir para que no se desarmen sin que nadie lo note.
 */

const raiz = (archivo: string): string => readFileSync(join(process.cwd(), archivo), "utf8");

describe("las piezas del stand hablan entre sí", () => {
  it("el evento es el de Space Apps y su nota de cupón mide justo lo que admite la red", () => {
    expect(EVENTO_POR_DEFECTO).toBe("space-apps-scz-2026");
    expect(memoCupon(EVENTO_POR_DEFECTO)).toBe("tk:cupon:space-apps-scz-2026");
    expect(bytesDe(memoCupon(EVENTO_POR_DEFECTO))).toBe(MAX_NOTA_BYTES);
  });

  it("el nombre del equipo y el panel de ganadores usan la misma clave local", () => {
    expect(CLAVE_ETIQUETAS).toBe("tinkazo.equipos.etiquetas");
    // La clave que inventó el panel de ganadores ya no existe en el código.
    expect(raiz("src/ui/panel-ganadores.ts")).not.toContain('"tinkazo.etiquetas"');
    expect(raiz("docs/premios.md")).not.toContain('localStorage["tinkazo.etiquetas"]');
  });

  it("los premios pagados no se prenden con la bandera de los equipos", () => {
    expect(pagosActivos({ VITE_EQUIPOS: "1" })).toBe(false);
    expect(pagosActivos({})).toBe(false);
  });

  it("la bandera de los equipos sola no prende nada más: ni pagos, ni monedas, ni rampa, ni plan", () => {
    vi.stubEnv("VITE_EQUIPOS", "1");
    try {
      expect(pagosActivos()).toBe(false);
      expect(monedasActivas()).toBe(false);
      expect(modoDeRampa()).toBe("apagada");
      expect(planDelEquipo()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("todas las banderas del stand están documentadas en .env.example", () => {
    const env = raiz(".env.example");
    for (const bandera of ["VITE_EQUIPOS", "VITE_PAGOS", "VITE_PAGOS_ACTIVO", "VITE_PAGOS_CUENTAS", "VITE_MONEDAS", "VITE_CUENTA_URL", "VITE_RAMPA", "VITE_PLAN_EQUIPO", "VITE_CUENTA_PLANES"]) {
      expect(env, bandera).toMatch(new RegExp(`^${bandera}=`, "m"));
    }
  });

  it("la nota de la documentación dice quién firma el pago del premio", () => {
    expect(raiz("docs/premios.md")).toContain("lo firma la billetera de quien organiza");
    expect(raiz("docs/legal.md")).toContain("lo firma la billetera de quien organiza");
  });
});
