import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El auditor de detallitos no se corre acá (pide un navegador y producción):
 * esta prueba cuida que no se despegue del sitio. D06 espera el aviso con coma
 * ("Termo, 18 personas"), que es lo que arma `history.ts` (el punto medio se
 * sacó de todo lo visible). D08 mide la regla de hoy del enlace del ejemplo
 * (`participants.ts`): con el cuadro vacío, en red con contrato y fuera de
 * práctica, abriendo en limpio y esperando a que la herramienta lo pinte.
 */
describe("el auditor de detallitos acompaña al sitio", () => {
  const auditor = readFileSync(new URL("../scripts/audit-detalles.mjs", import.meta.url), "utf8");
  const participantes = readFileSync(new URL("./ui/participants.ts", import.meta.url), "utf8");
  const historial = readFileSync(new URL("./ui/history.ts", import.meta.url), "utf8");

  it("D06 espera el aviso con coma, como lo arma el sitio", () => {
    expect(historial).toContain('${e.count} ${t("histPeople")}');
    expect(auditor).toContain("Termo, 18 personas");
    expect(auditor).not.toContain("Termo · 18 personas");
  });

  it("D08 abre en limpio y espera a que aparezca el enlace antes de medirlo", () => {
    const d08 = auditor.slice(auditor.indexOf("D08:"));
    expect(d08).toContain("localStorage.clear(); true");
    expect(d08).toContain('visible("#btn-ensayo")');
    expect(d08).toContain("el enlace del ejemplo aparece");
  });

  it("D08 mide la regla de hoy del enlace del ejemplo", () => {
    expect(participantes).toContain("anchoringAvailable && vacia && !enPractica()");
    const d08 = auditor.slice(auditor.indexOf("D08:"));
    expect(d08).toContain("con el cuadro vacío se ve, con nombres no, y vuelve al vaciarlo");
    expect(d08).toContain('"Cargar ejemplo" no se ve en una red con contrato');
  });
});
