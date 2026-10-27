import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FALLAS, emitirJson, esResumen, leerResumen, normalizar, quiereJson, resumenDe } from "./resumen.mjs";
import { BOTON_APAGADO_JS, FUERA_DEL_SELECTOR, LOS_DIEZ, SELECTOR, detalleDelBoton, juegosDe } from "./juegos.mjs";
import { MAX_DESTELLOS, comprobacionesDePantalla, hayHallazgo } from "./pantalla-comprobaciones.mjs";

afterEach(() => vi.restoreAllMocks());

describe("el resumen de una línea de un auditor", () => {
  it("cuenta aprobadas y total, y deja solo las fallas con nombre y detalle", () => {
    const r = resumenDe({
      auditor: "audit-ui",
      objetivo: "sitio",
      segundos: 210.4,
      checks: [
        { name: "a", ok: true, detail: "" },
        { name: "b", ok: false, detail: "se cortó el texto" },
        { name: "c", ok: true },
      ],
    });
    expect(r).toEqual({
      auditor: "audit-ui",
      objetivo: "sitio",
      aprobadas: 2,
      total: 3,
      fallas: [{ nombre: "b", detalle: "se cortó el texto" }],
      segundos: 210,
    });
    expect(esResumen(r)).toBe(true);
  });

  it("entiende los nombres de campo de todos los auditores y antepone el grupo", () => {
    expect(normalizar({ nombre: "x", ok: false, detalle: "d" })).toEqual({ nombre: "x", ok: false, detalle: "d" });
    expect(normalizar({ grupo: "race", name: "reproducible", ok: true, detail: "" }).nombre).toBe("race: reproducible");
  });

  it("acorta lo largo y junta los espacios, para que el resumen siga siendo corto", () => {
    const n = normalizar({ name: "n".repeat(500), ok: false, detail: "línea 1\n   línea 2 " + "x".repeat(500) });
    expect(n.nombre.length).toBeLessThanOrEqual(160);
    expect(n.detalle.length).toBeLessThanOrEqual(240);
    expect(n.detalle).not.toContain("\n");
  });

  it("con cientos de fallas detalla las primeras y cuenta las demás sin perder el total", () => {
    const checks = Array.from({ length: 250 }, (_, i) => ({ name: `f${i}`, ok: false, detail: "" }));
    const r = resumenDe({ auditor: "a", objetivo: "o", checks, segundos: 1 });
    expect(r.total).toBe(250);
    expect(r.aprobadas).toBe(0);
    expect(r.fallas).toHaveLength(MAX_FALLAS + 1);
    expect(r.fallas.at(-1).nombre).toBe(`… y ${250 - MAX_FALLAS} fallas más`);
  });

  it("deja `datos` en la línea cuando el auditor los trae, y nada cuando no", () => {
    const con = resumenDe({ auditor: "a", objetivo: "o", checks: [], segundos: 1, datos: { zoom: { race: { min: 1.8 } } } });
    expect(con.datos).toEqual({ zoom: { race: { min: 1.8 } } });
    expect("datos" in resumenDe({ auditor: "a", objetivo: "o", checks: [], segundos: 1 })).toBe(false);
  });

  it("sin comprobaciones no inventa ninguna", () => {
    expect(resumenDe({ auditor: "a", objetivo: "o", checks: [], segundos: 0 })).toMatchObject({ aprobadas: 0, total: 0, fallas: [] });
  });
});

describe("--json", () => {
  it("lo reconoce en cualquier lugar de los argumentos", () => {
    expect(quiereJson(["race", "--base", "http://x", "--json"])).toBe(true);
    expect(quiereJson(["race", "--base", "http://x"])).toBe(false);
  });

  it("imprime exactamente una línea JSON válida, y solo si se pidió", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(emitirJson({ auditor: "a", objetivo: "o", checks: [{ name: "x", ok: true }], args: [] })).toBeNull();
    expect(log).not.toHaveBeenCalled();
    const r = emitirJson({ auditor: "a", objetivo: "o", checks: [{ name: "x", ok: true }], args: ["--json"], segundos: 3 });
    expect(log).toHaveBeenCalledTimes(1);
    const linea = String(log.mock.calls[0][0]);
    expect(linea).not.toContain("\n");
    expect(JSON.parse(linea)).toEqual(r);
  });
});

describe("leer el resumen de la salida de un auditor", () => {
  const bueno = { auditor: "audit-ui", objetivo: "sitio", aprobadas: 1, total: 1, fallas: [], segundos: 2 };

  it("toma la última línea que sea un resumen, con miles de líneas de texto antes", () => {
    const texto = [...Array.from({ length: 3000 }, (_, i) => `  ✓ comprobación ${i}`), "", "APROBADO: 1/1", JSON.stringify(bueno), ""].join("\r\n");
    expect(leerResumen(texto)).toEqual(bueno);
  });

  it("ignora otras líneas JSON que no son un resumen (pantalla imprime una por resultado)", () => {
    const texto = [JSON.stringify(bueno), JSON.stringify({ juego: "race", ok: true, destellos: { peorPorSegundo: 0 } }), "{ no es json }"].join("\n");
    expect(leerResumen(texto)).toEqual(bueno);
  });

  it("sin resumen devuelve null", () => {
    expect(leerResumen("RECHAZADO: 0/3\n")).toBeNull();
    expect(leerResumen("")).toBeNull();
    expect(esResumen({ auditor: "a", aprobadas: "1", total: 1, fallas: [] })).toBe(false);
  });
});

describe("los juegos de un `todos`", () => {
  it("son los ocho del selector, sin ninguno de los que salieron", () => {
    expect(SELECTOR).toHaveLength(8);
    expect(juegosDe("todos")).toEqual(SELECTOR);
    expect(juegosDe()).toEqual(SELECTOR);
    for (const j of FUERA_DEL_SELECTOR) expect(SELECTOR).not.toContain(j);
  });

  it("«diez» suma De pie y El Trueque, que salieron del selector pero siguen auditándose", () => {
    expect(LOS_DIEZ).toHaveLength(10);
    expect(juegosDe("diez")).toEqual([...SELECTOR, "quien", "trueque"]);
    expect(new Set(LOS_DIEZ).size).toBe(10);
  });

  it("cada auditor que acepta «todos» resuelve el pedido con juegosDe, así «diez» funciona en todos", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["audit-emocion", "audit-delatores", "audit-identidad", "audit-legible", "audit-mezcla", "audit-rigor", "audit-sound", "audit-pantalla"]) {
      const src = readFileSync(new URL(`../${f}.mjs`, import.meta.url), "utf8");
      expect(src, f).toContain("juegosDe(");
      expect(src, f).not.toMatch(/=== "todos" \? (TODOS|SELECTOR|JUEGOS)/);
    }
  });

  it("una lista con comas se respeta tal cual, incluso con juegos fuera del selector", () => {
    expect(juegosDe("trompo, tombola")).toEqual(["trompo", "tombola"]);
  });

  it("devuelve una copia: tocar el resultado no cambia la lista de todos", () => {
    juegosDe("todos").pop();
    expect(SELECTOR).toHaveLength(8);
  });
});

describe("qué es un botón apagado del selector (audit-game y audit-ui)", () => {
  const apagado = (b, cs) => {
    const antes = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => cs;
    try {
      return (0, eval)(BOTON_APAGADO_JS)(b);
    } finally {
      globalThis.getComputedStyle = antes;
    }
  };

  it("el atributo hidden, display none y visibility hidden del propio botón lo apagan", () => {
    expect(apagado({ hidden: true }, { display: "block", visibility: "visible" })).toBe(true);
    expect(apagado({ hidden: false }, { display: "none", visibility: "visible" })).toBe(true);
    expect(apagado({ hidden: false }, { display: "block", visibility: "hidden" })).toBe(true);
  });

  it("un botón visible no está apagado", () => {
    expect(apagado({ hidden: false }, { display: "flex", visibility: "visible" })).toBe(false);
  });

  it("los dos auditores usan la misma definición y ninguno tiene la suya a mano", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["audit-game.mjs", "audit-ui.mjs"]) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      expect(src, f).toContain("BOTON_APAGADO_JS");
      expect(src, f).not.toContain("button:not([hidden])");
    }
  });
});

describe("el detalle de la comprobación 7 de audit-game (el botón del selector)", () => {
  it("un botón visible dice su nombre y nada más", () => {
    expect(detalleDelBoton({ text: "  Trompo  ", apagado: false }, "trompo")).toBe('"Trompo"');
  });

  it("un botón oculto dice que el juego está apagado, con el nombre", () => {
    const d = detalleDelBoton({ text: "Trompo", apagado: true }, "trompo");
    expect(d).toContain('"Trompo"');
    expect(d).toContain("apagado");
  });

  it("un botón que falta sigue diciendo cuál falta, y no dice apagado", () => {
    const d = detalleDelBoton(undefined, "tombola");
    expect(d).toBe("falta #g-tombola");
    expect(d).not.toContain("apagado");
  });
});

describe("las comprobaciones de pantalla", () => {
  const bien = { juego: "race", res: "1920x1080", tema: "dark", ok: true, destellos: { peorPorSegundo: 1 }, contraste: { sinContorno: [], medidos: 12 } };

  it("un juego sano da dos comprobaciones aprobadas", () => {
    const c = comprobacionesDePantalla(bien);
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.ok)).toBe(true);
    expect(c[0].name).toContain("race 1920x1080 dark");
    expect(hayHallazgo(bien)).toBe(false);
  });

  it("más de tres destellos por segundo, o un texto sin contorno, fallan", () => {
    const mal = { ...bien, destellos: { peorPorSegundo: MAX_DESTELLOS + 1 }, contraste: { sinContorno: [{}], medidos: 3 } };
    const c = comprobacionesDePantalla(mal);
    expect(c.map((x) => x.ok)).toEqual([false, false]);
    expect(hayHallazgo(mal)).toBe(true);
    expect(hayHallazgo({ ...bien, destellos: { peorPorSegundo: MAX_DESTELLOS } })).toBe(false);
  });

  it("si el estadio no apareció, falla con el motivo", () => {
    const c = comprobacionesDePantalla({ juego: "sapo", res: "1280x720", ok: false, motivo: "el estadio no apareció" });
    expect(c).toEqual([{ name: "sapo 1280x720: el estadio aparece", ok: false, detail: "el estadio no apareció" }]);
  });
});
