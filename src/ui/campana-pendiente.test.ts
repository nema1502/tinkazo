// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CLAVE_DEL_BORRADOR } from "../campana/borrador";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { DIRECCION_DE_LA_CAMPANA, empresaDelBorrador, pintarAvisoEnPrueba } from "./campana-pendiente";

/** El aviso de la campaña por activar en el modo Prueba: la nombra, lleva a Oficial con un toque y se puede dejar. */

const BORRADOR = JSON.stringify({ evento: "panaderia-la-estrella-x", empresa: { nombre: "Panadería La Estrella" } });

function deps(): { almacen: Storage; idas: string[]; tx: (clave: string) => string; ir: (d: string) => void } {
  const idas: string[] = [];
  return { almacen: localStorage, idas, tx: (clave) => TEXTOS_SALA_CAMPANA.es[clave] ?? clave, ir: (d) => void idas.push(d) };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<main><section class="hero hero-portada">Sorteos justos</section></main>';
});

describe("el aviso de la campaña por activar en Prueba", () => {
  it("sin borrador no pinta nada", () => {
    expect(pintarAvisoEnPrueba(document, deps())).toBeNull();
    expect(document.getElementById("cpo-pendiente")).toBeNull();
    expect(document.querySelector<HTMLElement>(".hero-portada")?.style.display).toBe("");
  });

  it("arriba de todo: la nombra, una línea, un solo botón principal que lleva a Oficial, y la portada de arriba se esconde", () => {
    localStorage.setItem(CLAVE_DEL_BORRADOR, BORRADOR);
    const d = deps();
    pintarAvisoEnPrueba(document, d);
    const aviso = document.querySelector("main")?.firstElementChild as HTMLElement;
    expect(aviso.id).toBe("cpo-pendiente");
    expect(aviso.querySelector("h2")?.textContent).toBe("La campaña de Panadería La Estrella está lista");
    expect(aviso.querySelector(".cpo-linea")?.textContent).toBe("Solo se activa en el modo oficial.");
    const principales = [...aviso.querySelectorAll<HTMLButtonElement>("button.primary")];
    expect(principales.map((b) => b.textContent)).toEqual(["Ir a mi campaña"]);
    expect(document.querySelector<HTMLElement>(".hero-portada")?.style.display).toBe("none");
    principales[0]?.click();
    expect(d.idas).toEqual([DIRECCION_DE_LA_CAMPANA]);
    expect(DIRECCION_DE_LA_CAMPANA).toBe("/?campana&red=oficial");
  });

  it("Dejar esta campaña borra el borrador, saca el aviso y devuelve la portada", () => {
    localStorage.setItem(CLAVE_DEL_BORRADOR, BORRADOR);
    pintarAvisoEnPrueba(document, deps());
    const dejar = [...document.querySelectorAll<HTMLButtonElement>("#cpo-pendiente button")].find((b) => b.textContent === "Dejar esta campaña");
    expect(dejar?.className).toBe("enlace");
    dejar?.click();
    expect(localStorage.getItem(CLAVE_DEL_BORRADOR)).toBeNull();
    expect(document.getElementById("cpo-pendiente")).toBeNull();
    expect(document.querySelector<HTMLElement>(".hero-portada")?.style.display).toBe("");
  });

  it("un borrador roto, vacío o sin empresa no avisa nada", () => {
    for (const crudo of ["basura", "{}", "[]", JSON.stringify({ evento: "x" }), JSON.stringify({ evento: "x", empresa: { nombre: " " } })]) {
      localStorage.setItem(CLAVE_DEL_BORRADOR, crudo);
      expect(pintarAvisoEnPrueba(document, deps()), crudo).toBeNull();
      expect(document.getElementById("cpo-pendiente")).toBeNull();
    }
  });

  it("es solo de la portada: una demostración o la herramienta no lo llevan encima", () => {
    localStorage.setItem(CLAVE_DEL_BORRADOR, BORRADOR);
    pintarAvisoEnPrueba(document, deps());
    expect(document.getElementById("cpo-pendiente")?.classList.contains("portada-only")).toBe(true);
  });

  it("no se pinta dos veces", () => {
    localStorage.setItem(CLAVE_DEL_BORRADOR, BORRADOR);
    pintarAvisoEnPrueba(document, deps());
    expect(pintarAvisoEnPrueba(document, deps())).toBeNull();
    expect(document.querySelectorAll("#cpo-pendiente")).toHaveLength(1);
  });

  it("el nombre de la empresa sale del borrador, y uno que no se lee no inventa nada", () => {
    expect(empresaDelBorrador(BORRADOR)).toBe("Panadería La Estrella");
    expect(empresaDelBorrador("{")).toBeNull();
    expect(empresaDelBorrador(JSON.stringify({ empresa: { nombre: "  " } }))).toBeNull();
  });

  it("en inglés también dice lo suyo", () => {
    for (const clave of ["cpoBorradorT", "cpoDejar", "cpoIrACampana"]) {
      expect(TEXTOS_SALA_CAMPANA.en[clave], clave).toBeTruthy();
      expect(TEXTOS_SALA_CAMPANA.es[clave], clave).toBeTruthy();
    }
    expect(TEXTOS_SALA_CAMPANA.en.cpoBorradorT).toBe("{empresa}'s campaign is ready");
  });
});
