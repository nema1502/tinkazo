import { describe, expect, it } from "vitest";
import type { VistaDeCuenta } from "../../workers/cuenta/src/reglas";
import { T } from "../i18n";
import { con, fechaLarga, monedasHtml, planHtml, saldoHtml, tienditaHtml } from "./monedas-vista";

const txDe = (l: "es" | "en") => (k: string): string => {
  const v = T[l][k];
  return typeof v === "string" ? v : k;
};
const es = txDe("es");
const en = txDe("en");

const vista = (extra: Partial<VistaDeCuenta> = {}): VistaDeCuenta => ({
  cuenta: "G".padEnd(56, "A"),
  saldo: 70,
  hechos: {},
  historial: [],
  canjes: [],
  catalogo: [
    { codigo: "chocolate", es: "Un chocolate", en: "A chocolate", costo: 20 },
    { codigo: "stickers", es: "Stickers", en: "Stickers", costo: 50 },
    { codigo: "logo-en-el-show", es: "Tu logo en el show", en: "Your logo on the show", costo: 100 },
  ],
  plan: null,
  ...extra,
});

describe("Tus monedas", () => {
  it("dice el saldo, qué suma monedas y que no se cambian por dinero", () => {
    const h = monedasHtml(vista(), es);
    expect(h).toContain("70 monedas");
    expect(h).toContain("Hacer tu primer sorteo: +20");
    expect(h).toContain("Tus primeros dólares digitales: +50");
    expect(h).toContain("Activar el plan del equipo: +50");
    expect(h).toContain("Comprobar un resultado: +5, hasta 5 veces");
    expect(h).toContain("Invitar a un equipo que sortea: +10, próximamente");
    expect(h).toContain("Las monedas no se cambian por dinero: sirven dentro de Tinkazo.");
    expect(h).toContain("nunca compran chances en un sorteo");
  });

  it("lo mismo en inglés", () => {
    const h = monedasHtml(vista(), en);
    expect(h).toContain("70 coins");
    expect(h).toContain("Coins can't be exchanged for money: they're used inside Tinkazo.");
    expect(h).toContain("never buy chances in a draw");
  });

  it("marca lo que ya se hizo, también para quien no ve", () => {
    const h = monedasHtml(vista({ hechos: { primera_carga: 1, comprobar: 5, primer_sorteo: 1 } }), es);
    expect(h.match(/class="mon-regla hecha"/g)).toHaveLength(3);
    expect(h).toContain("ya lo hiciste");
    // Comprobar a medias no está hecho.
    expect(monedasHtml(vista({ hechos: { comprobar: 3 } }), es)).not.toContain("hecha");
  });

  it("mientras carga o si no se pudo leer, no inventa un saldo", () => {
    expect(monedasHtml("cargando", es)).toContain("Mirando tus monedas");
    expect(monedasHtml("cargando", es)).not.toContain("monedas</b>");
    const roto = monedasHtml("error", es);
    expect(roto).toContain("No pudimos leer tus monedas");
    expect(roto).toContain("no se cambian por dinero");
  });
});

describe("Tu tiendita", () => {
  it("dice qué le alcanza y cuánto le falta para cada cosa", () => {
    const h = tienditaHtml(vista(), { idioma: "es", qr: false }, es);
    expect(h).toContain("Un chocolate, 20 monedas");
    expect(h).toMatch(/Un chocolate[^]*?te alcanza/);
    expect(h).toMatch(/Stickers, 50 monedas[^]*?te alcanza/);
    expect(h).toMatch(/Tu logo en el show, 100 monedas[^]*?te faltan 30/);
  });

  it("usa los nombres del idioma", () => {
    expect(tienditaHtml(vista(), { idioma: "en", qr: false }, en)).toContain("A chocolate, 20 coins");
  });

  it("el código del stand sale solo si se pide, y se puede ocultar", () => {
    expect(tienditaHtml(vista(), { idioma: "es", qr: false }, es)).not.toContain('class="tienda-qr"');
    expect(tienditaHtml(vista(), { idioma: "es", qr: false }, es)).toContain("Mostrar mi código");
    const con_ = tienditaHtml(vista(), { idioma: "es", qr: true }, es);
    expect(con_).toContain('class="tienda-qr"');
    expect(con_).toContain("Ocultar mi código");
  });

  it("lista lo ya canjeado con su fecha", () => {
    const h = tienditaHtml(vista({ canjes: [{ codigo: "chocolate", costo: 20, ms: Date.UTC(2026, 10, 14, 15) }] }), { idioma: "es", qr: false }, es);
    expect(h).toContain("Lo que ya canjeaste");
    expect(h).toContain("14 de noviembre de 2026");
  });

  it("escapa lo que viene del Worker", () => {
    const h = tienditaHtml(vista({ catalogo: [{ codigo: "x", es: '<img src=x onerror="alert(1)">', en: "x", costo: 5 }] }), { idioma: "es", qr: false }, es);
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img");
  });

  it("no sale mientras carga o si falló", () => {
    expect(tienditaHtml("cargando", { idioma: "es", qr: false }, es)).toBe("");
    expect(tienditaHtml("error", { idioma: "es", qr: false }, es)).toBe("");
  });
});

describe("el plan del equipo en el panel", () => {
  const plan = { inicio: Date.UTC(2026, 10, 14, 15), vence: Date.UTC(2026, 11, 14, 15), tx: "a".repeat(64) };

  it("con plan dice cuándo vence y cuántos sorteos propios lleva", () => {
    const h = planHtml(vista({ plan }), { idioma: "es", sePuedeComprar: true, sorteos: 3 }, es);
    expect(h).toContain("Tu plan del equipo vence el 14 de diciembre de 2026.");
    expect(h).toContain("Sorteos propios con el plan: 3");
    expect(h).toContain("Renovar el plan, 5 USDC");
  });

  it("si no se pudieron contar los sorteos, muestra solo el vencimiento", () => {
    const h = planHtml(vista({ plan }), { idioma: "es", sePuedeComprar: false, sorteos: null }, es);
    expect(h).toContain("vence el");
    expect(h).not.toContain("Sorteos propios");
    expect(h).not.toContain('data-k="plan"');
  });

  it("sin plan, ofrece comprarlo solo si la compra está prendida", () => {
    expect(planHtml(vista(), { idioma: "es", sePuedeComprar: true, sorteos: null }, es)).toContain("Plan del equipo, 5 USDC");
    expect(planHtml(vista(), { idioma: "es", sePuedeComprar: false, sorteos: null }, es)).toBe("");
  });

  it("con la fecha en inglés", () => {
    expect(fechaLarga(plan.vence, "en")).toBe("December 14, 2026");
    expect(planHtml(vista({ plan }), { idioma: "en", sePuedeComprar: false, sorteos: null }, en)).toContain("Your team plan expires on December 14, 2026.");
  });
});

describe("Cargá tu saldo en el panel", () => {
  it("es un botón, con el aviso cuando llegaron los primeros dólares", () => {
    expect(saldoHtml({ aviso: "" }, es)).toContain('data-k="saldo"');
    expect(saldoHtml({ aviso: "" }, es)).not.toContain("saldo-aviso");
    expect(saldoHtml({ aviso: "Tus primeros dólares digitales llegaron" }, es)).toContain("Tus primeros dólares digitales llegaron");
  });
});

describe("con()", () => {
  it("rellena todos los huecos, también los repetidos", () => {
    expect(con("{n} y {n}, {max}", { n: 1, max: "dos" })).toBe("1 y 1, dos");
  });
});
