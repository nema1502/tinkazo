import { describe, expect, it } from "vitest";
import { type CasoRed, type Diagnostico, type Nivel } from "../stellar/chequeo-red";
import { T } from "../i18n";
import { type ContextoDelPanel, NOMBRE_DE_ACCION, TEXTO_DE_ACCION, panelDe, respuestaDelBoton } from "./red-acciones";

/**
 * Para cada uno de los cinco casos: qué se dice y cuál es la única acción principal,
 * en testnet y en mainnet. Con las dos reglas de Fable del 25 de octubre de 2026:
 *
 * 1. El caso 5 (protocolo cambiado) es un aviso amarillo que nunca frena por sí solo;
 *    solo frena, en rojo, si la simulación del sello falla.
 * 2. En mainnet, en los casos 1 y 4, antes de "Seguir sin sello" se ofrece "Sellar
 *    pagando con mi cuenta" si la cuenta tiene saldo suficiente. "Seguir sin sello"
 *    queda como última opción.
 */

const diag = (caso: CasoRed | null, nivel: Nivel, o: Partial<Diagnostico> = {}): Diagnostico => ({
  nivel,
  caso,
  casos: caso ? [{ caso, nivel }] : [],
  red: "testnet",
  rpc: "https://soroban-testnet.stellar.org",
  pagador: "patrocinado",
  costoXlm: 69,
  rojoXlm: 33,
  ms: 300,
  ledger: 5_391_787,
  protocolo: 29,
  inclusionP90: 100,
  saldoXlm: null,
  restaurar: false,
  sinInternet: false,
  sinChequeo: false,
  motivo: "ok",
  hora: 0,
  ...o,
});

const ctx = (o: Partial<ContextoDelPanel> = {}): ContextoDelPanel => ({ red: "testnet", intentos: 0, grifo: true, saldoXlm: null, costoXlm: 69, ...o });

describe("verde y amarillo: se puede sellar", () => {
  it("verde no dice nada y la acción es sellar", () => {
    const p = panelDe(diag(null, "verde"), ctx());
    expect(p).toMatchObject({ nivel: "verde", frase: "", principal: "sellar", secundarias: [], bloquea: false });
  });

  it("sin internet o sin poder chequear tampoco hay un caso que decir", () => {
    expect(panelDe(diag(null, "verde", { sinInternet: true }), ctx()).frase).toBe("");
    expect(panelDe(diag(null, "verde", { sinChequeo: true }), ctx()).frase).toBe("");
  });

  it("caso 3, saturada: amarillo, su frase y la acción es sellar", () => {
    const p = panelDe(diag("saturada", "amarillo"), ctx());
    expect(p).toMatchObject({ nivel: "amarillo", caso: "saturada", frase: "redSaturada", principal: "sellar", secundarias: [], bloquea: false });
  });

  it("caso 5, protocolo cambiado y la simulación anduvo: amarillo, se puede sellar igual", () => {
    const p = panelDe(diag("protocolo", "amarillo", { protocolo: 31 }), ctx());
    expect(p).toMatchObject({ nivel: "amarillo", frase: "redProtocolo", aparte: "redProtocoloSigue", principal: "sellar", bloquea: false });
  });

  it("caso 1 en el medio, y la red lenta: amarillo y se sella", () => {
    expect(panelDe(diag("costo-alto", "amarillo", { costoXlm: 6 }), ctx())).toMatchObject({ frase: "redCostoMedio", principal: "sellar", bloquea: false });
    expect(panelDe(diag("rpc-caido", "amarillo"), ctx())).toMatchObject({ frase: "redAmarilla", principal: "sellar", bloquea: false });
  });
});

describe("caso 1: el costo pasa el tope del patrocinador", () => {
  it("testnet: 'Sellar con saldo de prueba' (con carga previa si no alcanza) y 'Seguir sin sello' aparte", () => {
    const sinSaldo = panelDe(diag("costo-alto", "rojo"), ctx());
    expect(sinSaldo).toMatchObject({ nivel: "rojo", frase: "redCostoAlto", principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"], bloquea: true, cargaPrevia: true });
    // Con saldo de sobra no hace falta cargar nada.
    expect(panelDe(diag("costo-alto", "rojo"), ctx({ saldoXlm: 10_000 })).cargaPrevia).toBe(false);
    expect(TEXTO_DE_ACCION("sellar-con-mi-cuenta", "testnet")).toBe("redAccSaldoPrueba");
  });

  it("testnet con el grifo apagado cae a la regla de mainnet: solo con saldo propio", () => {
    expect(panelDe(diag("costo-alto", "rojo"), ctx({ grifo: false })).principal).toBe("seguir-sin-sello");
    expect(panelDe(diag("costo-alto", "rojo"), ctx({ grifo: false, saldoXlm: 500 })).principal).toBe("sellar-con-mi-cuenta");
  });

  it("mainnet con saldo suficiente: 'Sellar pagando con mi cuenta' primero, 'Seguir sin sello' al final", () => {
    const p = panelDe(diag("costo-alto", "rojo", { red: "mainnet", costoXlm: 0.5 }), ctx({ red: "mainnet", grifo: false, saldoXlm: 3, costoXlm: 0.5 }));
    expect(p).toMatchObject({ principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"], bloquea: true, cargaPrevia: false });
    expect(TEXTO_DE_ACCION("sellar-con-mi-cuenta", "mainnet")).toBe("redAccMiCuenta");
  });

  it("mainnet con saldo justo (el doble del costo) alcanza; con menos, no", () => {
    const c = (saldoXlm: number) => ctx({ red: "mainnet", grifo: false, saldoXlm, costoXlm: 0.5 });
    expect(panelDe(diag("costo-alto", "rojo", { red: "mainnet" }), c(1)).principal).toBe("sellar-con-mi-cuenta");
    expect(panelDe(diag("costo-alto", "rojo", { red: "mainnet" }), c(0.99)).principal).toBe("seguir-sin-sello");
  });

  it("mainnet sin saldo (o sin saber el saldo): 'Seguir sin sello', y es la única acción", () => {
    for (const saldoXlm of [0, null]) {
      const p = panelDe(diag("costo-alto", "rojo", { red: "mainnet" }), ctx({ red: "mainnet", grifo: false, saldoXlm }));
      expect(p).toMatchObject({ principal: "seguir-sin-sello", secundarias: [], bloquea: true });
    }
  });

  it("si pide restaurar, ninguna cuenta lo arregla: 'Seguir sin sello', con 'Probar ahora' aparte", () => {
    const p = panelDe(diag("costo-alto", "rojo", { restaurar: true }), ctx({ saldoXlm: 10_000 }));
    expect(p).toMatchObject({ principal: "seguir-sin-sello", secundarias: ["reintentar"] });
  });

  it("reintentar no se ofrece: la red promedia unas 2,7 horas", () => {
    const p = panelDe(diag("costo-alto", "rojo"), ctx());
    expect([p.principal, ...p.secundarias]).not.toContain("reintentar");
    expect(p.reintentaSola).toBe(false);
  });
});

describe("caso 2: Stellar no contesta", () => {
  it("'Probar ahora' mientras quedan intentos, y la app vuelve a probar sola", () => {
    for (const intentos of [0, 1, 2]) {
      const p = panelDe(diag("rpc-caido", "rojo", { costoXlm: null }), ctx({ intentos }));
      expect(p).toMatchObject({ frase: "redSinRpc", principal: "reintentar", reintentaSola: true, bloquea: true });
    }
  });

  it("después de tres intentos, 'Seguir sin sello' pasa a ser la principal y 'Probar ahora' queda aparte", () => {
    const p = panelDe(diag("rpc-caido", "rojo", { costoXlm: null }), ctx({ intentos: 3 }));
    expect(p).toMatchObject({ frase: "redSinRpcFin", principal: "seguir-sin-sello", secundarias: ["reintentar"], reintentaSola: false });
  });

  it("es igual en mainnet", () => {
    expect(panelDe(diag("rpc-caido", "rojo", { red: "mainnet" }), ctx({ red: "mainnet", grifo: false })).principal).toBe("reintentar");
  });
});

describe("caso 4: sin saldo", () => {
  it("testnet: 'Cargar saldo de prueba', con 'Seguir sin sello' aparte", () => {
    const p = panelDe(diag("sin-saldo", "rojo", { pagador: "propio", saldoXlm: 0 }), ctx());
    expect(p).toMatchObject({ frase: "redSinSaldo", principal: "cargar-saldo", secundarias: ["seguir-sin-sello"], bloquea: true });
  });

  it("mainnet, la cuenta no alcanza: 'Seguir sin sello' y nada más (no hay grifo)", () => {
    const p = panelDe(diag("sin-saldo", "rojo", { red: "mainnet", pagador: "propio", saldoXlm: 0.01, costoXlm: 0.09 }), ctx({ red: "mainnet", grifo: false, saldoXlm: 0.01, costoXlm: 0.09 }));
    expect(p).toMatchObject({ principal: "seguir-sin-sello", secundarias: [] });
  });

  it("mainnet, el patrocinador no tiene saldo pero la cuenta sí: 'Sellar pagando con mi cuenta' primero", () => {
    const p = panelDe(diag("sin-saldo", "rojo", { red: "mainnet", pagador: "patrocinado" }), ctx({ red: "mainnet", grifo: false, saldoXlm: 5, costoXlm: 0.2 }));
    expect(p).toMatchObject({ principal: "sellar-con-mi-cuenta", secundarias: ["seguir-sin-sello"] });
  });
});

describe("caso 5: solo frena si la simulación falla", () => {
  it("rojo: 'Seguir sin sello' como principal y 'Probar ahora' aparte", () => {
    const p = panelDe(diag("protocolo", "rojo", { costoXlm: null }), ctx());
    expect(p).toMatchObject({ nivel: "rojo", frase: "redProtocolo", principal: "seguir-sin-sello", secundarias: ["reintentar"], bloquea: true });
    expect(p.aparte).toBeUndefined();
  });
});

describe("una sola acción principal, y 'Seguir sin sello' nunca es la principal si hay otra cosa que hacer", () => {
  const casos: CasoRed[] = ["costo-alto", "rpc-caido", "sin-saldo", "protocolo"];
  for (const red of ["testnet", "mainnet"] as const) {
    for (const caso of casos) {
      it(`${red} / ${caso}`, () => {
        const c = ctx({ red, grifo: red === "testnet", saldoXlm: red === "mainnet" ? 50 : null, costoXlm: 0.3 });
        const p = panelDe(diag(caso, "rojo", { red, costoXlm: caso === "rpc-caido" ? null : 40 }), c);
        // Una sola principal; las demás van aparte y sin repetirse.
        expect(new Set([p.principal, ...p.secundarias]).size).toBe(1 + p.secundarias.length);
        if (p.principal === "seguir-sin-sello") {
          // Es la última opción: lo único que queda, o lo que hay después de agotar lo demás.
          expect(p.secundarias.every((a) => a === "reintentar")).toBe(true);
        } else {
          // Si hay otra cosa, "Seguir sin sello" va al final de las secundarias (o ni aparece).
          expect(p.secundarias.at(-1) === "seguir-sin-sello" || !p.secundarias.includes("seguir-sin-sello")).toBe(true);
        }
      });
    }
  }
});

describe("la respuesta del botón '¿La red está bien?'", () => {
  it("verde: la frase de siempre", () => {
    expect(respuestaDelBoton(diag(null, "verde"), panelDe(diag(null, "verde"), ctx()))).toEqual({ clave: "redVerde", nivel: "verde" });
  });

  it("amarillo: la razón en una frase (la general si anda lenta)", () => {
    const lenta = diag("rpc-caido", "amarillo");
    expect(respuestaDelBoton(lenta, panelDe(lenta, ctx()))).toEqual({ clave: "redAmarilla", nivel: "amarillo" });
    const sat = diag("saturada", "amarillo");
    expect(respuestaDelBoton(sat, panelDe(sat, ctx())).clave).toBe("redSaturada");
    const proto = diag("protocolo", "amarillo");
    expect(respuestaDelBoton(proto, panelDe(proto, ctx()))).toMatchObject({ clave: "redProtocolo", aparte: "redProtocoloSigue" });
  });

  it("rojo: 'Hoy no se puede sellar: ' y la frase del caso", () => {
    const rojo = diag("costo-alto", "rojo");
    expect(respuestaDelBoton(rojo, panelDe(rojo, ctx()))).toEqual({ clave: "redRoja", motivo: "redCostoAlto", nivel: "rojo" });
  });

  it("sin internet: el aviso de siempre", () => {
    const off = diag(null, "verde", { sinInternet: true });
    expect(respuestaDelBoton(off, panelDe(off, ctx())).clave).toBe("errAnchor.offline");
  });
});

describe("los textos: es y en, sin tecnicismos", () => {
  const claves = new Set<string>(["redAmarilla", "redVerde", "redRoja", "redSaturada", "redSinSaldo", "redSinRpc", "redSinRpcFin", "redCostoAlto", "redCostoMedio", "redProtocolo", "redProtocoloSigue"]);
  for (const red of ["testnet", "mainnet"] as const) {
    for (const a of ["sellar", "reintentar", "sellar-con-mi-cuenta", "cargar-saldo", "seguir-sin-sello"] as const) claves.add(TEXTO_DE_ACCION(a, red));
  }

  it("cada texto existe en los dos idiomas", () => {
    for (const k of claves) {
      expect(typeof T.es[k], `es.${k}`).toBe("string");
      expect(typeof T.en[k], `en.${k}`).toBe("string");
    }
  });

  it("nada de RPC, fee, stroops ni XLM en lo que se lee", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of claves) {
        expect(String(T[l][k]), `${l}.${k}`).not.toMatch(/\bRPC\b|\bfee\b|stroop|XLM|hash|firma|drand/i);
      }
    }
  });

  it("los nombres de las acciones para el registro son distintos", () => {
    expect(new Set(Object.values(NOMBRE_DE_ACCION)).size).toBe(Object.keys(NOMBRE_DE_ACCION).length);
  });
});
