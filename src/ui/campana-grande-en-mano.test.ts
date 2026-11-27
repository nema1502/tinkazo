// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { campanaDeEjemplo } from "../campana/ejemplo";
import { TEXTOS_CAMPANA } from "../campana/textos";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { type DatosDeLaGrande, crearPantallaGrande } from "./campana-grande";

/**
 * La pantalla grande con una campaña de premio en mano: dice el premio escrito, para cuántas personas, y nunca un monto.
 * Una campaña de cuentas muestra lo de siempre.
 */

const AHORA = Date.UTC(2026, 10, 18, 15, 0);

function montar(campana: DatosDeLaGrande["campana"], idioma: "es" | "en" = "es"): HTMLElement {
  const grande = crearPantallaGrande({
    tx: (clave) => TEXTOS_SALA_CAMPANA[idioma][clave] ?? TEXTOS_CAMPANA[idioma][clave] ?? clave,
    idioma: () => idioma,
    datos: () => ({ campana, enlace: null, qrVigente: false, total: 4, cierraMs: AHORA + 3_600_000, cerrada: false }),
    qr: async () => true,
    ahora: () => AHORA,
    esperar: () => () => undefined,
    pantallaCompleta: async () => undefined,
    ventana: () => ({ ancho: 1920, alto: 1080 }),
  });
  grande.abrir(null);
  return document.querySelector<HTMLElement>(".cg-premio") as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("la pantalla grande y el premio en mano", () => {
  it("con varias personas dice el premio y para cuántas", () => {
    const c = { ...campanaDeEjemplo(AHORA), premios: [0n, 0n, 0n], premioEnMano: { es: "Auriculares", en: "Headphones" } };
    expect(montar(c).textContent).toBe("Auriculares, para 3 personas");
  });

  it("con una persona dice solo el premio, y en inglés el texto en inglés", () => {
    const c = { ...campanaDeEjemplo(AHORA), premios: [0n], premioEnMano: { es: "Auriculares", en: "Headphones" } };
    expect(montar(c, "en").textContent).toBe("Headphones");
  });

  it("no dice ningún monto ni dólares", () => {
    const c = { ...campanaDeEjemplo(AHORA), premios: [0n, 0n], premioEnMano: { es: "Una bici", en: "A bike" } };
    expect(montar(c).textContent).not.toMatch(/dólares|\$|\b0\b/u);
  });

  it("una campaña de cuentas muestra el monto de siempre", () => {
    const c = campanaDeEjemplo(AHORA);
    expect(montar(c).textContent).toMatch(/dólares digitales/u);
  });
});
