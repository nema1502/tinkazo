import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { corridasDe, resumenDeBoleta } from "./boleta.mjs";
import { escribirBoleta } from "./boleta-archivo.mjs";

const dir = mkdtempSync(join(tmpdir(), "boleta-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("escribirBoleta", () => {
  it("con el informe de la batería deja el .md y una boleta que resume a la línea JSON", () => {
    const informe = { auditores: [{ id: "audit-rigor", corridas: [{ objetivo: "wheel", aprobadas: 3, total: 3, fallas: [] }] }] };
    const r = escribirBoleta({ raiz: dir, juego: "wheel", corridas: corridasDe(informe), fecha: "2026-11-02" });
    expect(r.salida.replaceAll("\\", "/")).toMatch(/docs\/capturas\/boletas\/wheel\.md$/);
    expect(existsSync(r.salida)).toBe(true);
    expect(readFileSync(r.salida, "utf8")).toBe(r.md);
    const linea = resumenDeBoleta(r.boleta, 0);
    expect(linea.auditor).toBe("boleta");
    expect(linea.objetivo).toBe("wheel");
    expect(linea.total).toBe(9);
  });
});
