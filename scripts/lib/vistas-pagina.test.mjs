import { describe, expect, it } from "vitest";
import { CLIC_HASTA, FALLO, clicHasta, evidenciaDelFallo } from "./vistas-pagina.mjs";

/** Un reloj de mentira: cada espera lo adelanta, así la prueba no espera de verdad. */
function mundo({ apareceEnElClic = Infinity, clicsQueFallan = [] } = {}) {
  const m = { ahora: 0, clics: 0, esperas: [], fallo: null };
  m.deps = {
    ahora: () => m.ahora,
    async clic() {
      m.clics++;
      if (clicsQueFallan.includes(m.clics)) throw new Error("no se vio el botón");
    },
    async estaVisible(_page, sel, ms) {
      m.esperas.push([sel, ms]);
      m.ahora += ms;
      return m.clics >= apareceEnElClic;
    },
    revisar() {
      if (m.fallo) throw new Error(m.fallo);
    },
  };
  return m;
}

describe("clicHasta: el clic que se repite hasta que algo cambie", () => {
  it("si aparece a la primera, hace un solo clic y espera como mucho un segundo", async () => {
    const m = mundo({ apareceEnElClic: 1 });
    await clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps);
    expect(m.clics).toBe(1);
    expect(m.esperas).toEqual([[".reloj", CLIC_HASTA.esperaMs]]);
    expect(CLIC_HASTA.esperaMs).toBe(1000);
  });

  it("si el primer clic se perdió, repite hasta que aparezca", async () => {
    const m = mundo({ apareceEnElClic: 3 });
    const intentos = await clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps);
    expect(intentos).toBe(3);
    expect(m.clics).toBe(3);
  });

  it("con tope: si nunca aparece falla con un mensaje claro después de unos 20 s", async () => {
    const m = mundo();
    await expect(clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps)).rejects.toThrow(/#btn.*20 s.*\.reloj/);
    expect(m.ahora).toBeGreaterThanOrEqual(CLIC_HASTA.topeMs);
    expect(m.ahora).toBeLessThan(CLIC_HASTA.topeMs + 2 * CLIC_HASTA.esperaMs);
    expect(CLIC_HASTA.topeMs).toBe(20_000);
  });

  it("si el botón mismo no está, el error del clic sale tal cual y no se reintenta", async () => {
    const m = mundo({ clicsQueFallan: [1] });
    await expect(clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps)).rejects.toThrow("no se vio el botón");
    expect(m.clics).toBe(1);
  });

  it("corta enseguida si la revisión de la página dice que algo salió mal", async () => {
    const m = mundo();
    m.fallo = "la página quiso ir a otro sitio";
    await expect(clicHasta({}, { selector: "#btn", hasta: ".reloj" }, m.deps)).rejects.toThrow("otro sitio");
    expect(m.clics).toBe(0);
  });
});

describe("evidenciaDelFallo: qué había en pantalla cuando una vista falló", () => {
  const paginaCon = ({ href = "http://localhost:4173/seguridad.html", texto = "Seguridad\n\n  Qué impide   el protocolo" } = {}) => ({
    async eval(expr) {
      if (expr.includes("location.href")) return href;
      if (expr.includes("innerText")) return texto;
      throw new Error(`no esperaba ${expr}`);
    },
  });

  it("saca la foto con el nombre del fallo y anota la dirección y el comienzo del texto", async () => {
    const fotos = [];
    const r = await evidenciaDelFallo(paginaCon(), async (archivo) => fotos.push(archivo), "portada-FALLO.png");
    expect(fotos).toEqual(["portada-FALLO.png"]);
    expect(r).toEqual({ archivoDelFallo: "portada-FALLO.png", direccionEnElFallo: "http://localhost:4173/seguridad.html", textoVisible: "Seguridad Qué impide el protocolo" });
  });

  it("el texto se corta en 300 caracteres y junta los espacios", async () => {
    const r = await evidenciaDelFallo(paginaCon({ texto: `${"a".repeat(200)}\n\n${"b".repeat(400)}` }), async () => undefined, "x-FALLO.png");
    expect(r.textoVisible).toHaveLength(FALLO.textoMax);
    expect(FALLO.textoMax).toBe(300);
    expect(r.textoVisible.startsWith(`${"a".repeat(200)} b`)).toBe(true);
  });

  it("si la foto falla, igual devuelve la dirección y el texto, y no lanza", async () => {
    const r = await evidenciaDelFallo(paginaCon(), async () => {
      throw new Error("la página no contestó");
    }, "x-FALLO.png");
    expect(r.archivoDelFallo).toBeNull();
    expect(r.direccionEnElFallo).toContain("seguridad.html");
    expect(r.textoVisible).toContain("Seguridad");
  });

  it("si leer la dirección o el texto falla, devuelve lo demás y no lanza", async () => {
    const page = {
      async eval() {
        throw new Error("la página se cerró");
      },
    };
    const r = await evidenciaDelFallo(page, async () => undefined, "x-FALLO.png");
    expect(r).toEqual({ archivoDelFallo: "x-FALLO.png", direccionEnElFallo: null, textoVisible: null });
  });

  it("una foto que nunca termina no cuelga el informe: corta a los pocos segundos", async () => {
    const t0 = Date.now();
    const r = await evidenciaDelFallo(paginaCon(), () => new Promise(() => undefined), "x-FALLO.png", 50);
    expect(r.archivoDelFallo).toBeNull();
    expect(r.direccionEnElFallo).toContain("seguridad.html");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
