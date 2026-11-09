// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { Equipo } from "../equipos/modelo";
import { type DatosDePantalla, PAGINA_CADA_MS, crearPantallaDelStand } from "./pantalla-stand";

/** La pantalla del stand por sí sola: las páginas cuando no entran todos, y la hora en cada idioma. */

const equipo = (n: number): Equipo => ({
  n,
  cuenta: `G${String(n).padStart(55, "A")}`,
  nombre: `Equipo ${n}`,
  integrantes: ["Ana", "Beto"],
  guardado: "aceptado",
  v: 1,
  revisar: false,
  activa: true,
});

function armar(datos: DatosDePantalla, idioma: "es" | "en" = "es") {
  const relojes = new Map<number, () => void>();
  const p = crearPantallaDelStand({
    tx: t,
    idioma: () => idioma,
    datos: () => datos,
    qr: async () => undefined,
    ahora: () => new Date(2026, 10, 14, 17, 30).getTime(),
    cada: (f, ms) => {
      relojes.set(ms, f);
      return () => relojes.delete(ms);
    },
    ventana: () => ({ ancho: 1920, alto: 1080 }),
  });
  return { p, relojes };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("la pantalla del stand", () => {
  it("con más equipos de los que entran, pasa de página y al dar la vuelta los mostró a todos", () => {
    const equipos = Array.from({ length: 60 }, (_, i) => equipo(i + 1));
    const { p, relojes } = armar({ enlace: "https://tinkazo.app/equipos.html?sala=x#k", modo: "cupon", equipos, evidencias: new Map(), instante: null });
    p.abrir();
    const nombres = (): string[] => [...p.raiz.querySelectorAll(".stp-nombre")].map((x) => x.textContent ?? "");
    const pagina = p.raiz.querySelector("#stp-pagina") as HTMLElement;
    expect(pagina.hidden).toBe(false);
    const total = Number(/de (\d+)/.exec(pagina.textContent ?? "")?.[1]);
    expect(total).toBeGreaterThan(1);
    const vistos = new Set(nombres());
    for (let i = 1; i < total; i++) {
      relojes.get(PAGINA_CADA_MS)?.();
      expect(pagina.textContent).toBe(t("eqStPagina").replace("{p}", String(i + 1)).replace("{t}", String(total)));
      for (const n of nombres()) vistos.add(n);
    }
    expect(vistos.size).toBe(60);
    // Y vuelve a la primera.
    relojes.get(PAGINA_CADA_MS)?.();
    expect(nombres()[0]).toBe("Equipo 1");
    p.cerrar();
    expect(relojes.size).toBe(0);
  });

  it("con pocos equipos no hay páginas", () => {
    const { p } = armar({ enlace: "x", modo: "cupon", equipos: [equipo(1), equipo(2)], evidencias: new Map(), instante: null });
    p.abrir();
    expect((p.raiz.querySelector("#stp-pagina") as HTMLElement).hidden).toBe(true);
    expect(p.raiz.querySelectorAll(".stp-equipo")).toHaveLength(2);
  });

  it("la hora se escribe como se lee en cada idioma", () => {
    const es = armar({ enlace: "x", modo: "cupon", equipos: [], evidencias: new Map(), instante: new Date(2026, 10, 14, 18, 0).getTime() }).p;
    es.abrir();
    expect(es.raiz.querySelector("#stp-reloj-t")?.textContent).toBe(t("eqStRelojT").replace("{h}", "18:00"));
    es.cerrar();
    document.body.innerHTML = "";
    const en = armar({ enlace: "x", modo: "cupon", equipos: [], evidencias: new Map(), instante: new Date(2026, 10, 14, 18, 0).getTime() }, "en").p;
    en.abrir();
    expect(en.raiz.querySelector("#stp-reloj-t")?.textContent).toMatch(/6:00\sPM/);
  });

  it("el reloj de cada segundo actualiza lo que falta", () => {
    let ahora = new Date(2026, 10, 14, 17, 59, 58).getTime();
    const relojes = new Map<number, () => void>();
    const p = crearPantallaDelStand({
      tx: t,
      idioma: () => "es",
      datos: () => ({ enlace: "x", modo: "cupon", equipos: [], evidencias: new Map(), instante: new Date(2026, 10, 14, 18, 0).getTime() }),
      qr: async () => undefined,
      ahora: () => ahora,
      cada: (f, ms) => {
        relojes.set(ms, f);
        return () => relojes.delete(ms);
      },
      ventana: () => ({ ancho: 1920, alto: 1080 }),
    });
    p.abrir();
    const n = p.raiz.querySelector("#stp-reloj-n") as HTMLElement;
    expect(n.textContent).toBe(t("eqStFaltan").replace("{t}", "0:02"));
    ahora += 2000;
    relojes.get(1000)?.();
    expect(n.textContent).toBe(t("eqStLlego"));
  });
});

describe("el alto de las tarjetas", () => {
  afterEach(() => vi.restoreAllMocks());

  it("se mide con la tarjeta que ocupa más renglones, no con el nombre de más caracteres", () => {
    // jsdom no calcula el diseño: cada tarjeta mide 50 px por palabra (un renglón por palabra), como si el lugar fuera angosto.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const palabras = this.classList.contains("stp-equipo") ? (this.querySelector(".stp-nombre")?.textContent ?? "").split(" ").length : 0;
      return { height: 50 * palabras, width: 100, top: 0, left: 0, right: 100, bottom: 50 * palabras, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    // Los de más caracteres son de una palabra (un renglón). El de cuatro renglones tiene menos letras y quedaría al final.
    const equipos = Array.from({ length: 60 }, (_, i) => ({ ...equipo(i + 1), nombre: `Nombre${"x".repeat(20)}${i}` }));
    const ancho = { ...equipo(61), nombre: "Una dos tres cuatro" };
    const { p } = armar({ enlace: "x", modo: "cupon", equipos: [...equipos, ancho], evidencias: new Map(), instante: null });
    p.abrir();
    const ol = p.raiz.querySelector("#stp-equipos") as HTMLElement;
    expect(ol.style.gridAutoRows).toBe("200px");
  });
});
