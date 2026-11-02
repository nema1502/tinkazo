import { describe, expect, it } from "vitest";
import {
  GRIS,
  ROJO,
  VERDE,
  armarBoleta,
  bayesMaximo,
  boletaMd,
  corridasDe,
  corridasDeTexto,
  deAuditor,
  estadoDe,
  esDelJuego,
  parteDeVeto,
  parteDeVolver,
  resumenDeBoleta,
  tarjetasDe,
} from "./boleta.mjs";

const c = (auditor, objetivo, fallas = [], extra = {}) => ({ auditor, objetivo, aprobadas: 5, total: 5 + fallas.length, fallas, segundos: 1, ...extra });
const f = (nombre, detalle = "") => ({ nombre, detalle });

/** Todo lo que la boleta de la ruleta necesita, sin una falla. */
const limpias = () => [
  c("audit-delatores", "wheel"),
  c("audit-rigor", "wheel"),
  c("audit-game", "wheel"),
  c("audit-nino", "wheel", [], { datos: { pasan: 2, semillas: 2, minimo: 2 } }),
  c("audit-identidad", "wheel"),
  c("audit-emocion", "wheel", [], { aprobadas: 5, total: 5 }),
  c("audit-legible", "wheel"),
  c("audit-mezcla", "wheel"),
  c("check-lore", "tarjetas"),
  c("smoke", "sitio"),
];
const LORE = `export const LORE = {
  wheel: [
    {
      q: "loreWheelQ",
      a: "loreWheelA",
      href: "https://ejemplo.org/rueda",
      src: "Una fuente",
    },
  ],
  race: [
    {
      q: "loreRaceQ",
      a: "loreRaceA",
      href: "https://ejemplo.org/carrera",
      src: "Otra",
    },
  ],
};`;
const vetosOk = { volver: { puntaje: 26, de: 30, fecha: "2026-11-02", patronOscuro: false }, cultural: { ok: true, fecha: "2026-11-02", nota: "con la tarjeta" }, momento: { ok: true, fecha: "2026-11-02" } };
const tarjetas = tarjetasDe(LORE, "wheel");

describe("la entrada", () => {
  it("lee el informe de la batería, una línea suelta y una lista", () => {
    const informe = { auditores: [{ id: "audit-ui", corridas: [{ objetivo: "sitio", aprobadas: 3, total: 3, fallas: [] }] }] };
    expect(corridasDe(informe)).toEqual([{ auditor: "audit-ui", objetivo: "sitio", aprobadas: 3, total: 3, fallas: [] }]);
    expect(corridasDe(c("audit-game", "wheel"))).toHaveLength(1);
    expect(corridasDe([c("a", "x"), c("b", "x")])).toHaveLength(2);
    expect(corridasDe(null)).toEqual([]);
    expect(corridasDe({ cualquier: "cosa" })).toEqual([]);
  });

  it("saca las líneas JSON de una salida de texto", () => {
    const texto = `hola\n${JSON.stringify(c("audit-nino", "wheel"))}\nchau\n{no es json}\n`;
    expect(corridasDeTexto(texto).map((x) => x.auditor)).toEqual(["audit-nino"]);
  });

  it("una falla es del juego si lleva su prefijo o ninguno, y no si lleva el de otro", () => {
    expect(esDelJuego(f("wheel: algo"), "wheel")).toBe(true);
    expect(esDelJuego(f("trompo: algo"), "wheel")).toBe(false);
    expect(esDelJuego(f("sin prefijo"), "wheel")).toBe(true);
    expect(esDelJuego(f("wheel pantalla: x"), "wheel")).toBe(true);
  });

  it("una corrida de todos cubre al juego, con las fallas que le tocan", () => {
    const a = deAuditor([c("audit-rigor", "todos", [f("trompo: mal"), f("wheel: peor")])], "audit-rigor", "wheel");
    expect(a.fallas.map((x) => x.nombre)).toEqual(["wheel: peor"]);
    expect(a.conCifra).toBe(false);
    expect(deAuditor([], "audit-rigor", "wheel")).toBeNull();
  });
});

describe("los vetos", () => {
  it("sin entrada es pendiente (gris); con ok, verde; con no, rojo", () => {
    expect(parteDeVeto({}, "cultural", "veto cultural").estado).toBe(GRIS);
    expect(parteDeVeto({}, "cultural", "veto cultural").texto).toMatch(/pendiente/);
    expect(parteDeVeto({ cultural: { ok: true } }, "cultural", "x").estado).toBe(VERDE);
    expect(parteDeVeto({ cultural: { ok: false } }, "cultural", "x").estado).toBe(ROJO);
  });

  it("una fila es roja si alguna parte lo es, gris si no hay rojas y alguna es gris", () => {
    expect(estadoDe([{ estado: VERDE }, { estado: GRIS }])).toBe(GRIS);
    expect(estadoDe([{ estado: GRIS }, { estado: ROJO }])).toBe(ROJO);
    expect(estadoDe([{ estado: VERDE }])).toBe(VERDE);
  });
});

describe("ganas de volver", () => {
  it("verde con 24 o más y sin patrón oscuro; rojo por menos o por patrón; gris sin entrada", () => {
    expect(parteDeVolver({}).estado).toBe(GRIS);
    expect(parteDeVolver({ volver: { puntaje: 24, de: 30, patronOscuro: false } }).estado).toBe(VERDE);
    expect(parteDeVolver({ volver: { puntaje: 23, de: 30, patronOscuro: false } }).estado).toBe(ROJO);
    expect(parteDeVolver({ volver: { puntaje: 28, de: 30, patronOscuro: true } }).estado).toBe(ROJO);
  });
});

describe("la boleta", () => {
  it("con todo en verde y los vetos, aprueba nueve de nueve", () => {
    const palabras = [c("audit-palabras", "wheel")];
    const b = armarBoleta({ juego: "wheel", corridas: [...limpias(), ...palabras], vetos: vetosOk, tarjetas, bayes: 11.4 });
    expect(b.filas).toHaveLength(9);
    expect(b.filas.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(b.filas.map((x) => x.estado)).toEqual(Array(9).fill(VERDE));
    expect(b.aprobadas).toBe(9);
    expect(b.aprueba).toBe(true);
    expect(b.filas[0].partes[0].texto).toMatch(/11,4 %/);
  });

  it("sin los vetos y sin el auditor de palabras quedan grises, y no aprueba", () => {
    const b = armarBoleta({ juego: "wheel", corridas: limpias(), vetos: {}, tarjetas });
    expect(b.filas[3].estado).toBe(GRIS); // momento: falta el veto
    expect(b.filas[5].estado).toBe(GRIS); // apuesta: sin auditor
    expect(b.filas[5].partes[0].texto).toMatch(/sin auditor/);
    expect(b.filas[6].estado).toBe(GRIS); // verdad: vocabulario y veto cultural
    expect(b.filas[0].partes[0].texto).toMatch(/sin cifra del Bayes/);
    expect(b.filas[8].estado).toBe(GRIS);
    expect(b.aprobadas).toBe(5);
    expect(b.aprueba).toBe(false);
    expect(b.rojas).toBe(0);
  });

  it("la mezcla que no corrió es gris, no roja", () => {
    const sin = limpias().filter((x) => x.auditor !== "audit-mezcla");
    const b = armarBoleta({ juego: "wheel", corridas: sin, vetos: vetosOk, tarjetas });
    expect(b.filas[4].estado).toBe(GRIS);
    expect(b.filas[4].partes.some((p) => p.estado === ROJO)).toBe(false);
  });

  it("una falla de Math.random pone en rojo la justicia y no toca la robustez", () => {
    const corridas = limpias().map((x) => (x.auditor === "audit-rigor" ? c("audit-rigor", "wheel", [f("wheel: el juego no llama a Math.random()", "3 llamadas")]) : x));
    const b = armarBoleta({ juego: "wheel", corridas, vetos: vetosOk, tarjetas });
    expect(b.filas[0].estado).toBe(ROJO);
    expect(b.filas[7].estado).not.toBe(ROJO);
    expect(b.rojas).toBe(1);
  });

  it("una falla de destellos va a la sala, y otra de rigor a la robustez", () => {
    const corridas = limpias().map((x) =>
      x.auditor === "audit-rigor" ? c("audit-rigor", "wheel", [f("wheel 1280x720 dark: a lo sumo 3 destellos por segundo"), f("wheel: saltar al 50% cierra")]) : x,
    );
    const b = armarBoleta({ juego: "wheel", corridas, vetos: vetosOk, tarjetas });
    expect(b.filas[4].estado).toBe(ROJO);
    expect(b.filas[7].estado).toBe(ROJO);
    expect(b.filas[0].estado).toBe(VERDE);
  });

  it("el ganador distinto del protocolo es una falla de justicia", () => {
    const corridas = limpias().map((x) => (x.auditor === "audit-game" ? c("audit-game", "wheel", [f("el ganador en pantalla es el que fijó el protocolo")]) : x));
    expect(armarBoleta({ juego: "wheel", corridas, tarjetas }).filas[0].estado).toBe(ROJO);
  });

  it("la prueba del niño: sin corrida es gris; si no pasa, roja; con el veredicto guardado, lo usa", () => {
    const sin = limpias().filter((x) => x.auditor !== "audit-nino");
    expect(armarBoleta({ juego: "wheel", corridas: sin, tarjetas }).filas[1].estado).toBe(GRIS);
    const mala = [...sin, c("audit-nino", "wheel", [f("N1 · se entiende a los 7 años", "0 de 2 corridas pasan")], { datos: { pasan: 0, semillas: 2, minimo: 2 } })];
    const fila = armarBoleta({ juego: "wheel", corridas: mala, tarjetas }).filas[1];
    expect(fila.estado).toBe(ROJO);
    expect(fila.partes[0].texto).toMatch(/0 de 2 corridas/);
    const guardada = armarBoleta({ juego: "wheel", corridas: sin, tarjetas, nino: { pasa: true, pasan: 2, semillas: 2, minimo: 2 } }).filas[1];
    expect(guardada.estado).toBe(VERDE);
  });

  it("la fuente caída de la tarjeta del juego es roja, y la de otro juego no cuenta", () => {
    const propia = limpias().map((x) => (x.auditor === "check-lore" ? c("check-lore", "tarjetas", [f("https://ejemplo.org/rueda respondió 404")]) : x));
    expect(armarBoleta({ juego: "wheel", corridas: propia, vetos: vetosOk, tarjetas }).filas[6].partes[0].estado).toBe(ROJO);
    const ajena = limpias().map((x) => (x.auditor === "check-lore" ? c("check-lore", "tarjetas", [f("https://ejemplo.org/carrera respondió 404")]) : x));
    expect(armarBoleta({ juego: "wheel", corridas: ajena, vetos: vetosOk, tarjetas }).filas[6].partes[0].estado).toBe(VERDE);
    expect(armarBoleta({ juego: "wheel", corridas: limpias(), tarjetas: [] }).filas[6].partes[0].estado).toBe(GRIS);
  });

  it("el auditor de palabras con hallazgos de apuesta pone en rojo la fila 6, y los de vocabulario la 7", () => {
    // Los nombres son los de verdad: `apuesta: <unidad>` y `vocabulario: <unidad>`; el juego va en el objetivo.
    const corridas = [...limpias(), c("audit-palabras", "wheel", [f("apuesta: wheel", "src/i18n.ts:10 «jackpot»"), f("vocabulario: wheel", "src/i18n.ts:20 «eliminado»")])];
    const b = armarBoleta({ juego: "wheel", corridas, vetos: vetosOk, tarjetas });
    expect(b.filas[5].estado).toBe(ROJO);
    expect(b.filas[6].estado).toBe(ROJO);
  });

  it("de una corrida de `todo` de palabras, cada juego toma solo las fallas de su unidad", () => {
    const todo = c("audit-palabras", "todo", [f("apuesta: race", "src/i18n.ts:10 «jackpot»"), f("vocabulario: sitio", "index.html:3 «drand»")]);
    expect(esDelJuego(f("apuesta: race"), "race")).toBe(true);
    expect(esDelJuego(f("apuesta: race"), "wheel")).toBe(false);
    expect(esDelJuego(f("vocabulario: sitio"), "wheel")).toBe(false);
    const deLaRuleta = armarBoleta({ juego: "wheel", corridas: [...limpias(), todo], vetos: vetosOk, tarjetas });
    expect(deLaRuleta.filas[5].estado).toBe(VERDE);
    expect(deLaRuleta.filas[6].estado).toBe(VERDE);
    const deLaCarrera = armarBoleta({ juego: "race", corridas: [...limpias().map((x) => ({ ...x, objetivo: x.objetivo === "wheel" ? "race" : x.objetivo })), todo], vetos: vetosOk, tarjetas: [] });
    expect(deLaCarrera.filas[5].partes[0].estado).toBe(ROJO);
  });

  it("la pregunta del olor a apuesta es de la fila 6 y no cuenta como falta de comprensión", () => {
    const olor = f("olor a apuesta: ninguna imagen parece casino ni juego de apuestas", "2 de 3 dicen que sí");
    const conOlor = [
      ...limpias().filter((x) => x.auditor !== "audit-nino"),
      c("audit-nino", "wheel", [olor], { datos: { pasan: 2, semillas: 2, minimo: 2, olor: { aprobada: false, fotos: 3, conOlor: 2 } } }),
      c("audit-palabras", "wheel"),
    ];
    const b = armarBoleta({ juego: "wheel", corridas: conOlor, vetos: vetosOk, tarjetas });
    expect(b.filas[1].estado).toBe(VERDE);
    expect(b.filas[1].partes[0].texto).toMatch(/pasa/);
    expect(b.filas[5].estado).toBe(ROJO);
    expect(b.filas[5].partes.at(-1).texto).toMatch(/olor/);
    // Una falla de comprensión de verdad sigue poniendo en rojo la fila 2.
    const noEntiende = conOlor.map((x) => (x.auditor === "audit-nino" ? { ...x, fallas: [olor, f("N1 · se entiende a los 7 años", "0 semillas pasan")] } : x));
    expect(armarBoleta({ juego: "wheel", corridas: noEntiende, vetos: vetosOk, tarjetas }).filas[1].estado).toBe(ROJO);
  });

  it("el olor sin respuestas es gris y con todas en no, verde", () => {
    const con = (olor) => [...limpias().filter((x) => x.auditor !== "audit-nino"), c("audit-nino", "wheel", [], { datos: { pasan: 2, semillas: 2, minimo: 2, olor } }), c("audit-palabras", "wheel")];
    expect(armarBoleta({ juego: "wheel", corridas: con({ aprobada: null, fotos: 0, conOlor: 0 }), vetos: vetosOk, tarjetas }).filas[5].estado).toBe(GRIS);
    expect(armarBoleta({ juego: "wheel", corridas: con({ aprobada: true, fotos: 3, conOlor: 0 }), vetos: vetosOk, tarjetas }).filas[5].estado).toBe(VERDE);
  });
});

describe("la salida", () => {
  it("el Markdown lleva ocho filas y la línea JSON tiene la forma de los auditores", () => {
    const b = armarBoleta({ juego: "wheel", corridas: limpias(), vetos: {}, tarjetas });
    const md = boletaMd(b, { fecha: "2026-11-02" });
    expect(md.split("\n").filter((l) => /^\| \d \|/.test(l))).toHaveLength(9);
    expect(md).toMatch(/NO APRUEBA: 5 de 9/);
    const r = resumenDeBoleta(b, 3.2);
    expect(r).toMatchObject({ auditor: "boleta", objetivo: "wheel", aprobadas: 5, total: 9, segundos: 3 });
    expect(r.fallas).toHaveLength(4);
    expect(r.datos.grises).toBe(4);
  });

  it("el Bayes máximo sale del detalle de delatores, hasta el 88 %, y sin detalle no hay cifra", () => {
    const d = { juegos: { "race-adivinador": { "carriles-8": { hasta: [{ q: 0.5, acierto: 0.12 }, { q: 0.88, acierto: 0.131 }, { q: 0.95, acierto: 0.5 }] }, "carriles-4": { hasta: [{ q: 0.5, acierto: 0.2 }] } } } };
    expect(bayesMaximo(d)).toBeCloseTo(20, 5);
    expect(bayesMaximo(null)).toBeNull();
    expect(bayesMaximo({ juegos: { wheel: {} } })).toBeNull();
  });
});
