import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Los lugares donde la herramienta de siempre toca el sorteo de una empresa, leídos del código: son pocos y tienen que quedar
 * donde la lógica de la sala los espera. Si una de estas pruebas cambia, hay que mirar que fuera de una campaña todo siga igual.
 */

const leer = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const draw = leer("./draw.ts");
const freeze = leer("./freeze.ts");

/** El texto de una función hasta la que sigue: así lo que se mira está dentro de `reveal` y no en cualquier lado. */
function cuerpoDe(fuente: string, nombre: string): string {
  const desde = fuente.indexOf(`function ${nombre}(`);
  expect(desde, `no está function ${nombre}(`).toBeGreaterThan(-1);
  const siguiente = fuente.indexOf("\nfunction ", desde + 10);
  return fuente.slice(desde, siguiente === -1 ? undefined : siguiente);
}

describe("el resultado de una campaña en draw.ts", () => {
  const reveal = cuerpoDe(draw, "reveal");

  it("el aviso del resultado está dentro de reveal y después de armar el comprobante", () => {
    const comprobante = reveal.indexOf("const enlace = buildProof(");
    const aviso = reveal.indexOf("alRevelarReal(enlace)");
    expect(comprobante).toBeGreaterThan(-1);
    expect(aviso).toBeGreaterThan(comprobante);
  });

  it("el aviso solo sale si el sorteo es de una campaña", () => {
    expect(reveal).toMatch(/if \(deCampana\) void import\("\.\/campana-resultado-real"\)/u);
  });

  it("No está mira si el sorteo es de una campaña, también sin número de sorteo", () => {
    expect(reveal).toContain("const deCampana = esSorteoDeCampana(app.frozen?.raffleId) || campanaDeLaLista(app.frozen?.listHash ?? \"\") !== null;");
    expect(reveal).toMatch(/const reemplazo = !deCampana && /u);
  });

  it("el comprobante del sorteo grabado vuelve a mandarse por el evento tinkazo:comprobante, que ya despacha alGuardar", () => {
    expect(cuerpoDe(draw, "alGuardar")).toContain('new CustomEvent("tinkazo:comprobante", { detail: enlace })');
  });
});

describe("el sello de una campaña en freeze.ts", () => {
  it("el margen de una campaña sale de la entrada de esa lista y no de la bandera sola", () => {
    expect(freeze).toContain("const deLaCampana = anchoring ? campanaDeLaLista(hash) : null;");
    expect(freeze).toContain("Math.max(ANCHOR_LEAD_SECONDS, LEAD_SECONDS, deLaCampana === null ? 0 : CAMPANA_LEAD_SECONDS)");
  });

  it("la cantidad de ganadoras de una campaña es la de sus premios", () => {
    expect(freeze).toContain("deLaCampana === null ? Math.min(ganadoresPedidos(), names.length) : deLaCampana.premios");
  });

  it("los dos eventos que escucha la sala se siguen despachando", () => {
    expect(freeze).toContain('new CustomEvent("tinkazo:sellado")');
    expect(freeze).toContain('new CustomEvent("tinkazo:sello")');
  });
});
