import { describe, expect, it } from "vitest";
import { armarDatos, codigoDeSalida, esperarEstado, tocar } from "./recorrido-llave.mjs";

/** Un CDP de mentira que anota lo que se le manda. */
function cdpFalso({ rect = { x: 50, y: 30, foco: true }, estados = [] } = {}) {
  const enviados = [];
  const cdp = {
    enviados,
    send: async (metodo, params) => {
      enviados.push({ metodo, params });
      return {};
    },
    eval: async (expresion) => {
      if (expresion.includes("getBoundingClientRect")) return rect;
      return estados.length ? estados[0] : null;
    },
    waitFor: async (expresion) => ({ ok: estados.length > 0, elapsed: 1, expresion }),
  };
  return cdp;
}

describe("tocar un botón con eventos de confianza", () => {
  it("mueve el ratón, aprieta y suelta en el centro, con botón izquierdo y un solo clic", async () => {
    const cdp = cdpFalso({ rect: { x: 206, y: 400, foco: true } });
    const r = await tocar(cdp, "#principal");
    expect(r.foco).toBe(true);
    expect(cdp.enviados.map((e) => e.params.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(cdp.enviados.every((e) => e.metodo === "Input.dispatchMouseEvent")).toBe(true);
    const [mover, apretar, soltar] = cdp.enviados.map((e) => e.params);
    expect(mover).toMatchObject({ x: 206, y: 400 });
    expect(apretar).toMatchObject({ x: 206, y: 400, button: "left", buttons: 1, clickCount: 1 });
    expect(soltar).toMatchObject({ x: 206, y: 400, button: "left", buttons: 0, clickCount: 1 });
  });

  it("anota si la página no tenía el foco", async () => {
    const r = await tocar(cdpFalso({ rect: { x: 1, y: 1, foco: false } }), "#principal");
    expect(r.foco).toBe(false);
  });

  it("si el botón no está a la vista, lanza y no manda ningún toque", async () => {
    const cdp = cdpFalso({ rect: null });
    await expect(tocar(cdp, "#principal")).rejects.toThrow("#principal");
    expect(cdp.enviados).toHaveLength(0);
  });

  it("el selector va escapado en la expresión", async () => {
    let expresion = "";
    const cdp = cdpFalso();
    const original = cdp.eval;
    cdp.eval = async (e) => {
      expresion = e;
      return original(e);
    };
    await tocar(cdp, '#a"b');
    expect(expresion).toContain(JSON.stringify('#a"b'));
  });
});

describe("esperar una pantalla", () => {
  it("llegó a una pedida: ok", async () => {
    const r = await esperarEstado(cdpFalso({ estados: ["cuenta-lista"] }), ["cuenta-lista"], 1000);
    expect(r).toEqual({ estado: "cuenta-lista", ok: true });
  });

  it("llegó a una de falla: no ok, y dice cuál", async () => {
    const r = await esperarEstado(cdpFalso({ estados: ["no-se-armo"] }), ["cuenta-lista"], 1000);
    expect(r).toEqual({ estado: "no-se-armo", ok: false });
  });

  it("se acabó el tiempo: no ok", async () => {
    const r = await esperarEstado(cdpFalso({ estados: [] }), ["cuenta-lista"], 1000);
    expect(r.ok).toBe(false);
  });
});

describe("el código de salida", () => {
  const bien = ["previo", "crear", "sellar", "sortear", "coincide", "verificacion-ok"].map((nombre) => ({ nombre, ok: true }));

  it("0 si lo principal dio bien, aunque otro aparato falle", () => {
    expect(codigoDeSalida({ checks: [...bien, { nombre: "otro-aparato", ok: false }], fallas: [] })).toBe(0);
  });

  it("1 si la prueba falló", () => {
    const checks = bien.map((c) => (c.nombre === "sellar" ? { ...c, ok: false } : c));
    expect(codigoDeSalida({ checks, fallas: [{ motivo: "simulacion-con-firma" }] })).toBe(1);
  });

  it("2 si el control previo no pudo medir, o si lo único que falló es el grifo", () => {
    expect(codigoDeSalida({ checks: bien, fallas: [], previo: { salida: 2 } })).toBe(2);
    const checks = bien.map((c) => (c.nombre === "crear" ? { ...c, ok: false } : c));
    expect(codigoDeSalida({ checks, fallas: [{ motivo: "grifo-limitado" }] })).toBe(2);
    expect(codigoDeSalida({ checks, fallas: [{ motivo: "grifo-caido" }, { motivo: "simulacion" }] })).toBe(1);
  });
});

describe("el archivo de medidas", () => {
  it("lleva el aviso de que las cifras son de la red de prueba y las secciones aunque falten", () => {
    const d = armarDatos({ medidas: null, previo: null, navegador: "Chrome", virtual: true, segundos: 12.4, otroAparato: null });
    expect(d.version).toBe(1);
    expect(d.red).toBe("testnet");
    expect(d.aviso).toContain("red de prueba");
    expect(d.segundos).toBe(12);
    expect(d.cuenta).toBeNull();
    expect(d.otroAparato).toBeNull();
    expect(d.fallas).toEqual([]);
  });

  it("junta lo medido y el segundo sello del otro aparato", () => {
    const medidas = { contrato: "C1", kit: "0.10.0", codigoCuenta: "ab", inicio: "2026-11-25T00:00:00.000Z", cuenta: { hash: "h" }, sello: { id: "1" }, sorteo: { coincide: true }, fallas: [{ paso: "x" }] };
    const d = armarDatos({ medidas, previo: { codigo: true }, navegador: "Chrome", virtual: true, segundos: 100, otroAparato: { resultado: "ok", minutos: 1 }, segundoSello: { totalStroops: 5 }, verificacion: { estado: "ok" } });
    expect(d.contrato).toBe("C1");
    expect(d.cuenta).toEqual({ hash: "h" });
    expect(d.otroAparato).toEqual({ resultado: "ok", minutos: 1, segundoSello: { totalStroops: 5 } });
    expect(d.verificacion).toEqual({ estado: "ok" });
    expect(d.fallas).toHaveLength(1);
  });
});
