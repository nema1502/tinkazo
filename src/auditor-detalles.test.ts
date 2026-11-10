import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El auditor de detallitos no se corre acá (pide un navegador y producción):
 * esta prueba cuida que no se despegue del sitio. D06 espera el aviso con coma
 * ("Termo, 18 personas"), que es lo que arma `cuenta-entrada.ts` (el punto medio se
 * sacó de todo lo visible). D08 mide la regla de hoy del ejemplo
 * (`participants.ts`, `onboarding.ts`): con el cuadro vacío se ofrece (la
 * oferta de primera vez o el enlace de abajo, según la red), con nombres no,
 * al vaciarlo vuelve, y la oferta de arriba se puede cerrar y queda cerrada,
 * abriendo en limpio y esperando a que la herramienta lo pinte.
 */
describe("el auditor de detallitos acompaña al sitio", () => {
  const auditor = readFileSync(new URL("../scripts/audit-detalles.mjs", import.meta.url), "utf8");
  const participantes = readFileSync(new URL("./ui/participants.ts", import.meta.url), "utf8");
  const historial = readFileSync(new URL("./ui/cuenta-entrada.ts", import.meta.url), "utf8");

  it("D06 espera el aviso con coma, como lo arma el sitio", () => {
    expect(historial).toContain('${personas} ${t("histPeople")}');
    expect(auditor).toContain("Termo, 18 personas");
    expect(auditor).not.toContain("Termo · 18 personas");
  });

  it("D08 abre en limpio y espera a que aparezca la oferta antes de medirla", () => {
    const d08 = auditor.slice(auditor.indexOf("D08:"));
    expect(d08).toContain("localStorage.clear(); true");
    expect(d08).toContain('visible("#pv-ensayo")');
    expect(d08).toContain('visible("#btn-ensayo")');
    expect(d08).toContain('visible("#btn-sample")');
    expect(d08).toContain("con el cuadro vacío, el ejemplo se ofrece");
  });

  it("D08 mide la regla de hoy del ejemplo", () => {
    expect(participantes).toContain("anchoringAvailable && vacia && !enPractica()");
    const d08 = auditor.slice(auditor.indexOf("D08:"));
    expect(d08).toContain('visible("#primera-vez")');
    expect(d08).toContain("pv-cerrar");
    expect(d08).toContain("se ve la oferta de primera vez");
    expect(d08).toContain("con nombres en el cuadro, el ejemplo no se ofrece");
    expect(d08).toContain("vuelve la oferta de primera vez");
    expect(d08).toContain("se puede cerrar");
    expect(d08).toContain("vuelve el mismo de abajo");
  });
});
