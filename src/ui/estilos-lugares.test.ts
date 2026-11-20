import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Las reglas de estilo de los premios por lugar y de la puerta que no se ven sin navegador: se fija que estén, con su
 * valor. Cómo quedan de verdad en un celular o en un proyector se mira con capturas.
 */
const css = readFileSync("src/styles.css", "utf8");

describe("la línea del lugar en el resultado", () => {
  it("deja aire arriba para que la tarjeta girada no le tape las letras", () => {
    expect(css).toContain(".lugar-actual { margin-top: 18px; }");
  });
});

describe("el premio de cada lugar en la pantalla grande", () => {
  it("se lee como texto, sin la letra de máquina ni el aire entre letras del número", () => {
    expect(css).toContain(".pantalla.varios .pantalla-premio.por-lugar { font-family: inherit; letter-spacing: normal; }");
  });
});

describe("los campos de premio por lugar", () => {
  it("van separados, no pegados con los bordes dobles", () => {
    expect(css).toContain(".premio-lugares { display: grid; gap: 8px; margin-top: 8px; }");
  });

  it("escondidos se esconden, aunque la caja sea una grilla", () => {
    expect(css).toContain(".premio-lugares[hidden] { display: none; }");
  });

  it("cada campo con su rótulo al lado, en un renglón", () => {
    expect(css).toContain(".premio-fila { display: flex; align-items: center; gap: 8px; }");
  });
});

describe("la puerta con la cuenta en el otro modo", () => {
  it("el enlace al otro modo queda a la altura de su botón y con aire hasta el borde", () => {
    expect(css).toContain(".gate .enlace { margin: 0 8px 0 0; }");
  });

  it("con la puerta a la vista, la invitación de primera vez no aparece debajo", () => {
    expect(css).toContain('.gate.otro-modo:not([style*="none"]) ~ #primera-vez { display: none !important; }');
    // Y la puerta va antes que la invitación en la página, que es lo que pide el selector de hermanos.
    const pagina = readFileSync("index.html", "utf8");
    expect(pagina.indexOf('id="gate"')).toBeLessThan(pagina.indexOf('id="primera-vez"'));
  });
});

describe("el aviso de que los premios no entran", () => {
  const pagina = readFileSync("index.html", "utf8");

  it("se ve como un aviso, con la letra de la tinta y su marca, no como una ayuda gris", () => {
    expect(pagina).toContain('<p class="note aviso-premio" id="prize-largo"');
    expect(css).toContain(".note.aviso-premio { color: var(--ink); font-weight: 700; border-left: 4px solid var(--orange); padding-left: 10px; }");
  });

  it("el campo que no entra se ve marcado", () => {
    expect(css).toContain('#prize[aria-invalid="true"], .premio-lugares input[aria-invalid="true"] { box-shadow: 0 0 0 3px var(--orange); }');
  });
});
