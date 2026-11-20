// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Otro nombre, debajo del cuadro de la lista (`participants.ts`), con el markup de verdad de `index.html`. Es para quien no
 * sabe que cada nombre va en su renglón: baja de renglón y deja el cursor listo para escribir. Se ve desde el primer nombre,
 * se esconde con el cuadro cerrado o de solo lectura, y nunca es el botón de color.
 */

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const cssCampana = readFileSync(join(process.cwd(), "src/campana/campana-sala.css"), "utf8");

const ta = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
const boton = (): HTMLButtonElement => document.getElementById("btn-otro-nombre") as HTMLButtonElement;

const escribir = (valor: string): void => {
  ta().value = valor;
  ta().dispatchEvent(new Event("input", { bubbles: true }));
};

/** Monta la herramienta como la página: el markup, la lista y Cuántos ganan. */
async function montar(): Promise<typeof import("./participants")> {
  vi.resetModules();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const p = await import("./participants");
  const g = await import("./ganadores");
  p.bindParticipants();
  g.montarGanadores();
  p.renderNames();
  return p;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("el botón en el markup", () => {
  it("va justo debajo del cuadro, es un botón blanco y nace escondido", async () => {
    await montar();
    expect(ta().nextElementSibling).toBe(boton());
    expect(boton().type).toBe("button");
    expect(boton().classList.contains("ghost")).toBe(true);
    expect(boton().classList.contains("mini")).toBe(true);
    expect(boton().classList.contains("primary")).toBe(false);
    expect(/id="btn-otro-nombre"[^>]*\shidden/.test(pagina)).toBe(true);
  });

  it("el más es un dibujo que el lector de pantalla no lee y el texto va en su span traducible", async () => {
    await montar();
    expect(boton().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const texto = boton().querySelector("span[data-i]");
    expect(texto?.getAttribute("data-i")).toBe("otroNombre");
    expect(texto?.textContent).toBe("Otro nombre");
  });
});

describe("cuándo se ve", () => {
  it("con la lista vacía no se ve", async () => {
    await montar();
    expect(boton().hidden).toBe(true);
  });

  it("con un nombre se ve", async () => {
    await montar();
    escribir("Ana");
    expect(boton().hidden).toBe(false);
  });

  it("si se borra todo vuelve a esconderse", async () => {
    await montar();
    escribir("Ana");
    escribir("");
    expect(boton().hidden).toBe(true);
  });

  it("con el cuadro de solo lectura, como en el ensayo, no se ve", async () => {
    const p = await montar();
    escribir("Ana\nBeto");
    ta().readOnly = true;
    p.renderNames();
    expect(boton().hidden).toBe(true);
  });

  it("con la lista cerrada (el cuadro apagado) no se ve, y vuelve al abrirla", async () => {
    const p = await montar();
    escribir("Ana\nBeto");
    p.cerrarLista(true);
    expect(ta().disabled).toBe(true);
    expect(boton().hidden).toBe(true);
    p.cerrarLista(false);
    expect(boton().hidden).toBe(false);
  });

  it("dentro de la campaña y en el stand lo esconde una regla aparte", () => {
    expect(cssCampana).toContain("body:has(#cpo-panel) #btn-otro-nombre { display: none !important; }");
    expect(css).toContain('body[data-stand="1"] #btn-otro-nombre { display: none !important; }');
  });

  it("mide 48 px de alto, para el pulgar", () => {
    expect(css).toMatch(/\.otro-nombre \{[^}]*min-height: 48px/);
  });
});

describe("al tocarlo", () => {
  it("suma un solo salto de renglón al final", async () => {
    await montar();
    escribir("Ana\nBeto");
    boton().click();
    expect(ta().value).toBe("Ana\nBeto\n");
  });

  it("deja el foco en el cuadro con el cursor al final", async () => {
    await montar();
    escribir("Ana\nBeto");
    boton().click();
    expect(document.activeElement).toBe(ta());
    expect(ta().selectionStart).toBe(ta().value.length);
    expect(ta().selectionEnd).toBe(ta().value.length);
  });

  it("dos toques seguidos no dejan dos renglones vacíos", async () => {
    await montar();
    escribir("Ana");
    boton().click();
    boton().click();
    expect(ta().value).toBe("Ana\n");
  });

  it("si el cuadro ya termina en un renglón vacío no suma otro", async () => {
    await montar();
    escribir("Ana\nBeto\n");
    boton().click();
    expect(ta().value).toBe("Ana\nBeto\n");
    expect(document.activeElement).toBe(ta());
  });

  it("la lista no cambia: un renglón vacío no es nadie", async () => {
    const p = await montar();
    escribir("Ana\nBeto\nCarla");
    const antes = p.parseNames();
    boton().click();
    expect(p.parseNames()).toEqual(antes);
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 3 personas");
  });

  it("avisa con el input de siempre cuando suma el renglón, para que sigan el borrador y el resumen", async () => {
    await montar();
    escribir("Ana");
    let avisos = 0;
    ta().addEventListener("input", () => avisos++);
    boton().click();
    boton().click();
    expect(avisos).toBe(1);
  });

  it("lo que se escribe después cae en el renglón nuevo", async () => {
    const p = await montar();
    escribir("Ana");
    boton().click();
    escribir(`${ta().value}Beto`);
    expect(p.parseNames()).toEqual(["Ana", "Beto"]);
  });
});
