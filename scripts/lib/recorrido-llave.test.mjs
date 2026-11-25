import { describe, expect, it } from "vitest";
import { armarDatos, CHECKS_INFORMATIVOS, CHECKS_PRINCIPALES, checksDeOtroAparato, codigoDeSalida, ESTADOS_DE_FALLA, esperarEstado, tocar } from "./recorrido-llave.mjs";

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
  const bien = ["previo", "carga", "crear", "sellar", "sortear", "coincide", "verificacion-ok"].map((nombre) => ({ nombre, ok: true }));

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

  it("1 si la página no cargó, aunque no haya fallas ni otros checks", () => {
    const checks = [{ nombre: "previo", ok: true }, { nombre: "carga", ok: false }];
    expect(codigoDeSalida({ checks, fallas: [] })).toBe(1);
  });

  it("1 si se acabó el tiempo después de crear: lo que nunca se midió cuenta como falla", () => {
    const checks = [{ nombre: "previo", ok: true }, { nombre: "carga", ok: true }, { nombre: "crear", ok: true }, { nombre: "tope", ok: false }];
    expect(codigoDeSalida({ checks, fallas: [] })).toBe(1);
  });

  it("1 si falta un check principal aunque los que hay estén bien", () => {
    for (const falta of ["previo", "carga", "crear", "sellar", "sortear", "coincide", "verificacion-ok"]) {
      expect(codigoDeSalida({ checks: bien.filter((c) => c.nombre !== falta), fallas: [] })).toBe(1);
    }
  });

  it("2 si lo único que falló es el servicio de azar público", () => {
    const checks = bien.map((c) => (["sortear", "coincide", "verificacion-ok"].includes(c.nombre) ? { ...c, ok: false } : c));
    expect(codigoDeSalida({ checks, fallas: [{ motivo: "ronda" }] })).toBe(2);
    expect(codigoDeSalida({ checks, fallas: [{ motivo: "ronda" }, { motivo: "simulacion" }] })).toBe(1);
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

describe("los checks de entrar desde otro aparato", () => {
  const bien = () => ({
    a: { contractId: "CCUENTA", selloId: "7", ledger: 500 },
    historial: { estado: "cuenta-lista", contractId: "CCUENTA", entrada: { fuente: "historial", ledgerDeNacimiento: 500, desbloqueos: 1 }, sello: { id: "8", desbloqueos: 1 } },
    rpc: { estado: "cuenta-lista", contractId: "CCUENTA", entrada: { fuente: "rpc", ledgerDeNacimiento: 500, desbloqueos: 1 } },
    sinCuenta: { estado: "sin-cuenta" },
    anfitriones: ["localhost", "horizon-testnet.stellar.org", "soroban-testnet.stellar.org"],
  });
  const por = (d) => Object.fromEntries(checksDeOtroAparato(d).map((c) => [c.nombre, c.ok]));

  it("con todo bien dan los siete, y son los informativos", () => {
    const r = checksDeOtroAparato(bien());
    expect(r.map((c) => c.nombre)).toEqual(CHECKS_INFORMATIVOS);
    expect(r.every((c) => c.ok)).toBe(true);
  });

  it("los informativos no están entre los principales: no cambian el código de salida", () => {
    for (const n of CHECKS_INFORMATIVOS) expect(CHECKS_PRINCIPALES).not.toContain(n);
  });

  it("otro-aparato falla si no llegó a la cuenta lista", () => {
    expect(por({ ...bien(), historial: { estado: "sin-cuenta" } })["otro-aparato"]).toBe(false);
  });

  it("misma-cuenta pide que las dos entradas den la dirección de la cuenta original", () => {
    const d = bien();
    d.rpc.contractId = "COTRA";
    expect(por(d)["misma-cuenta"]).toBe(false);
    expect(por({ ...bien(), a: {} })["misma-cuenta"]).toBe(false);
  });

  it("un-desbloqueo-al-entrar falla con dos desbloqueos en cualquiera de las dos entradas", () => {
    const d = bien();
    d.rpc.entrada.desbloqueos = 2;
    expect(por(d)["un-desbloqueo-al-entrar"]).toBe(false);
  });

  it("segundo-sello pide un sello distinto del primero y con un desbloqueo", () => {
    const d = bien();
    d.historial.sello.id = "7";
    expect(por(d)["segundo-sello"]).toBe(false);
    const e = bien();
    e.historial.sello.desbloqueos = 2;
    expect(por(e)["segundo-sello"]).toBe(false);
    expect(por({ ...bien(), historial: { ...bien().historial, sello: null } })["segundo-sello"]).toBe(false);
  });

  it("dos-fuentes pide cada fuente en su entrada y el ledger de la creación original en las dos", () => {
    const d = bien();
    d.rpc.entrada.ledgerDeNacimiento = 501;
    expect(por(d)["dos-fuentes"]).toBe(false);
    const e = bien();
    e.rpc.entrada.fuente = "historial";
    expect(por(e)["dos-fuentes"]).toBe(false);
  });

  it("sin-cuenta pide llegar a esa pantalla con una llave ajena", () => {
    expect(por({ ...bien(), sinCuenta: { estado: "no-aparece" } })["sin-cuenta"]).toBe(false);
  });

  it("sin-indice falla si algún pedido fue al índice ajeno, o si no se anotó ningún pedido", () => {
    expect(por({ ...bien(), anfitriones: ["localhost", "testnet.mercurydata.app"] })["sin-indice"]).toBe(false);
    expect(por({ ...bien(), anfitriones: [] })["sin-indice"]).toBe(false);
  });

  it("las pantallas nuevas cuentan como cortes de la espera", () => {
    for (const e of ["sin-cuenta", "vencida", "no-se-comprobo"]) expect(ESTADOS_DE_FALLA).toContain(e);
  });
});

describe("el código de salida con la entrada desde otro aparato", () => {
  const bien = ["previo", "carga", "crear", "sellar", "sortear", "coincide", "verificacion-ok"].map((nombre) => ({ nombre, ok: true }));

  it("una falla de red al entrar cuenta como falla ajena: da 2 y no 1", () => {
    const checks = bien.map((c) => (c.nombre === "sortear" ? { ...c, ok: false } : c));
    expect(codigoDeSalida({ checks, fallas: [{ paso: "entrar", motivo: "red" }] })).toBe(2);
    expect(codigoDeSalida({ checks, fallas: [{ paso: "sortear", motivo: "red" }] })).toBe(1);
  });

  it("los pasos informativos que fallan no cambian el código", () => {
    const informativos = CHECKS_INFORMATIVOS.map((nombre) => ({ nombre, ok: false }));
    expect(codigoDeSalida({ checks: [...bien, ...informativos], fallas: [{ paso: "entrar", motivo: "sin-cuenta" }] })).toBe(0);
  });
});
