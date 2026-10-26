import { describe, expect, it } from "vitest";
import {
  CostoAlto,
  type Diagnostico,
  type FuentesDelChequeo,
  type Pagador,
  chequearRed,
  costoDeSelloXlm,
  crearChequeo,
  esCostoAlto,
  llamarRpc,
  nivelDelCosto,
  simularConRpc,
  umbralesDe,
} from "./chequeo-red";
import { type RpcDeMentira, redFalsa } from "./rpc-falso";

/**
 * "¿La red está bien?" contra una red de mentira con las respuestas reales del 25
 * de octubre de 2026 (`fixtures/rpc-*.json`): el sello simulado cuesta hoy 0,0064 XLM;
 * `rpc-simulate-sello-caro.json` es el mismo con los 69 XLM de esa mañana. Sin red
 * de verdad: lo único que se toca es `fetch`.
 */

const AHORA = 1_792_982_600_000;
const SDF = "https://soroban-testnet.stellar.org";
const ANKR = "https://rpc.ankr.com/stellar_testnet_soroban";
const TESTNET = "Test SDF Network ; September 2015";

interface Opciones {
  pagador?: Pagador;
  red?: "testnet" | "mainnet";
  saldo?: () => Promise<number>;
  saturada?: boolean;
  sinInternet?: boolean;
}

function armar(rpcs: Record<string, RpcDeMentira>, o: Opciones = {}) {
  const falsa = redFalsa(rpcs, () => AHORA);
  const elegidos: { url: string; motivo: string }[] = [];
  const f: FuentesDelChequeo = {
    red: o.red ?? "testnet",
    passphrase: TESTNET,
    rpcs: Object.keys(rpcs),
    pagador: o.pagador ?? "patrocinado",
    llamar: (url, metodo) => llamarRpc(url, metodo, null, { fetchFn: falsa.fetch }),
    simular: (url) => simularConRpc(url, "AAAA", (u, m, p) => llamarRpc(u, m, p, { fetchFn: falsa.fetch })),
    ahora: () => AHORA,
    elegir: (url, motivo) => void elegidos.push({ url, motivo }),
    ...(o.saldo ? { saldo: o.saldo } : {}),
    ...(o.saturada ? { saturacionReciente: () => true } : {}),
    ...(o.sinInternet ? { sinInternet: () => true } : {}),
  };
  return { f, falsa, elegidos };
}

const bien: RpcDeMentira = {};
const dos = (a: RpcDeMentira, b: RpcDeMentira = bien): Record<string, RpcDeMentira> => ({ [SDF]: a, [ANKR]: b });

describe("los umbrales", () => {
  it("son los de la especificación, una constante por red", () => {
    expect(umbralesDe("testnet").red).toMatchObject({ topePollarXlm: 100, rojoXlm: 33, amarilloXlm: 5 });
    expect(umbralesDe("mainnet").red).toMatchObject({ topePollarXlm: 1, rojoXlm: 0.33, amarilloXlm: 0.26 });
    const c = umbralesDe("testnet").comun;
    expect(c).toMatchObject({ topeDeLlamadaMs: 4000, ledgerViejoS: 30, inclusionP90Stroops: 1000, cacheS: 60, margenDeSaldo: 2 });
    // La lista de versiones conocidas incluye el Protocolo 30 (Bell): la votación en testnet es el 3 de noviembre.
    expect(c.protocolosConocidos).toEqual([29, 30]);
  });

  it("con el factor del fee-bump, el rojo es lo que deja la oferta justo debajo del tope", () => {
    for (const red of ["testnet", "mainnet"] as const) {
      const u = umbralesDe(red).red;
      expect(u.rojoXlm * u.factorDelFeeBump).toBeLessThan(u.topePollarXlm);
      expect((u.rojoXlm + 0.5) * u.factorDelFeeBump).toBeGreaterThan(u.topePollarXlm * 0.99);
    }
  });

  it("nivelDelCosto: el rojo es solo del patrocinador y justo en el umbral todavía no pasa", () => {
    expect(nivelDelCosto(0.0064, "patrocinado", "testnet")).toBe("verde");
    expect(nivelDelCosto(5, "patrocinado", "testnet")).toBe("amarillo");
    expect(nivelDelCosto(33, "patrocinado", "testnet")).toBe("amarillo");
    expect(nivelDelCosto(33.01, "patrocinado", "testnet")).toBe("rojo");
    expect(nivelDelCosto(0.25, "patrocinado", "mainnet")).toBe("verde");
    expect(nivelDelCosto(0.26, "patrocinado", "mainnet")).toBe("amarillo");
    expect(nivelDelCosto(0.34, "patrocinado", "mainnet")).toBe("rojo");
    // Quien paga con su cuenta no tiene tope que se corte: a lo sumo, un aviso.
    expect(nivelDelCosto(69, "propio", "testnet")).toBe("amarillo");
    expect(nivelDelCosto(0.01, "propio", "mainnet")).toBe("verde");
  });

  it("el costo suma la inclusión, con la base de 100 stroops como piso", () => {
    expect(costoDeSelloXlm(64_099)).toBeCloseTo(0.00642, 5);
    expect(costoDeSelloXlm(64_099, 50)).toBeCloseTo(0.00642, 5);
    expect(costoDeSelloXlm(0, 5_000_000)).toBeCloseTo(0.5, 5);
  });
});

describe("todo bien", () => {
  it("con la respuesta real de hoy: verde, sin caso, y mide el costo del sello", async () => {
    const { f } = armar(dos(bien));
    const d = await chequearRed(f);
    expect(d.nivel).toBe("verde");
    expect(d.caso).toBeNull();
    expect(d.casos).toEqual([]);
    expect(d.rpc).toBe(SDF);
    expect(d.protocolo).toBe(29);
    expect(d.ledger).toBeGreaterThan(5_000_000);
    expect(d.costoXlm).toBeGreaterThan(0.005);
    expect(d.costoXlm).toBeLessThan(0.01);
    expect(d.inclusionP90).toBe(100);
    expect(d.sinChequeo).toBe(false);
  });

  it("mira solo el primer RPC si anda bien", async () => {
    const { f, falsa } = armar(dos(bien));
    await chequearRed(f);
    expect(new Set(falsa.pedidos.map((p) => p.url))).toEqual(new Set([SDF]));
    expect(falsa.pedidos.map((p) => p.metodo).sort()).toEqual(["getFeeStats", "getLatestLedger", "getNetwork", "simulateTransaction"]);
  });
});

describe("caso 1: el costo pasa el tope del patrocinador", () => {
  it("el sello de la mañana del 25 de octubre (69 XLM) es rojo y no deja sellar", async () => {
    const { f } = armar(dos({ simulacion: "caro" }));
    const d = await chequearRed(f);
    expect(d.nivel).toBe("rojo");
    expect(d.caso).toBe("costo-alto");
    expect(d.costoXlm).toBeCloseTo(69, 3);
    expect(d.rojoXlm).toBe(33);
  });

  it("en el medio es amarillo, y por encima del umbral rojo es rojo", async () => {
    const medio = await chequearRed(armar(dos({ minResourceFee: "60000000" })).f);
    expect([medio.nivel, medio.caso]).toEqual(["amarillo", "costo-alto"]);
    const justo = await chequearRed(armar(dos({ minResourceFee: "329999900" })).f);
    expect(justo.nivel).toBe("amarillo");
    const pasa = await chequearRed(armar(dos({ minResourceFee: "331000000" })).f);
    expect(pasa.nivel).toBe("rojo");
  });

  it("en mainnet los umbrales son otros: 0,3 XLM es amarillo y 4 XLM es rojo", async () => {
    const m = (fee: string) => chequearRed(armar(dos({ minResourceFee: fee }), { red: "mainnet" }).f);
    expect((await m("64099")).nivel).toBe("verde");
    expect((await m("3000000")).nivel).toBe("amarillo");
    expect((await m("40000000")).nivel).toBe("rojo");
  });

  it("si la simulación pide restaurar, también es el caso 1, aunque cueste poco", async () => {
    const d = await chequearRed(armar(dos({ simulacion: "restaurar" })).f);
    expect([d.nivel, d.caso, d.restaurar]).toEqual(["rojo", "costo-alto", true]);
  });

  it("con una cuenta que paga por sí misma el costo alto avisa pero no frena por tope", async () => {
    const { f } = armar(dos({ simulacion: "caro" }), { pagador: "propio", saldo: async () => 10_000 });
    const d = await chequearRed(f);
    expect([d.nivel, d.caso]).toEqual(["amarillo", "costo-alto"]);
  });
});

describe("caso 2: el RPC está caído o lento", () => {
  it("los dos caídos: rojo, y el motivo dice cuál falló y por qué", async () => {
    const { f } = armar(dos({ anda: "cortado" }, { anda: "503" }));
    const d = await chequearRed(f);
    expect([d.nivel, d.caso]).toEqual(["rojo", "rpc-caido"]);
    expect(d.motivo).toContain("soroban-testnet.stellar.org");
    expect(d.motivo).toContain("rpc.ankr.com");
    expect(d.rpc).toBe(SDF);
    expect(d.costoXlm).toBeNull();
  });

  it("los dos con 429, o con el tiempo agotado: lo mismo", async () => {
    for (const anda of ["429", "lento"] as const) {
      const d = await chequearRed(armar(dos({ anda }, { anda })).f);
      expect([d.nivel, d.caso], anda).toEqual(["rojo", "rpc-caido"]);
    }
  });

  it("si falla uno solo se cambia en silencio: verde, con el segundo", async () => {
    for (const anda of ["cortado", "429", "503", "lento"] as const) {
      const { f, elegidos } = armar(dos({ anda }));
      const d = await chequearRed(f);
      expect([d.nivel, d.caso, d.rpc], anda).toEqual(["verde", null, ANKR]);
      expect(elegidos.map((e) => e.url)).toEqual([ANKR]);
    }
  });

  it("un RPC con el ledger viejo no es el elegido si el otro anda", async () => {
    const { f, elegidos } = armar(dos({ ledgerHace: 90 }));
    const d = await chequearRed(f);
    expect([d.nivel, d.rpc]).toEqual(["verde", ANKR]);
    expect(elegidos).toHaveLength(1);
  });

  it("un RPC de otra red no sirve aunque conteste", async () => {
    const { f } = armar(dos({ passphrase: "Public Global Stellar Network ; September 2015" }));
    const d = await chequearRed(f);
    expect([d.nivel, d.rpc]).toEqual(["verde", ANKR]);
  });

  it("si el único que contesta tiene el ledger viejo, es amarillo (anda lenta) y puede sellar", async () => {
    const { f } = armar(dos({ ledgerHace: 45 }, { anda: "cortado" }));
    const d = await chequearRed(f);
    expect([d.nivel, d.caso, d.rpc]).toEqual(["amarillo", "rpc-caido", SDF]);
  });

  it("justo en 30 s de ledger todavía es verde", async () => {
    const d = await chequearRed(armar(dos({ ledgerHace: 30 })).f);
    expect(d.nivel).toBe("verde");
  });
});

describe("caso 3: la red está saturada", () => {
  it("la comisión de inclusión del p90 por encima de 1.000 stroops: amarillo", async () => {
    const d = await chequearRed(armar(dos({ p90: "5000" })).f);
    expect([d.nivel, d.caso, d.inclusionP90]).toEqual(["amarillo", "saturada", 5000]);
  });

  it("justo en 1.000 todavía no", async () => {
    expect((await chequearRed(armar(dos({ p90: "1000" })).f)).nivel).toBe("verde");
  });

  it("un TRY_AGAIN_LATER reciente también la marca, aunque el p90 esté tranquilo", async () => {
    const d = await chequearRed(armar(dos(bien), { saturada: true }).f);
    expect([d.nivel, d.caso]).toEqual(["amarillo", "saturada"]);
  });

  it("una red saturada con un costo que pasa el tope sigue siendo el caso 1: lo grave manda", async () => {
    const d = await chequearRed(armar(dos({ p90: "9000", simulacion: "caro" })).f);
    expect([d.nivel, d.caso]).toEqual(["rojo", "costo-alto"]);
    expect(d.casos.map((c) => c.caso).sort()).toEqual(["costo-alto", "saturada"]);
  });
});

describe("caso 4: la cuenta que paga por sí misma no tiene saldo", () => {
  it("con menos de dos veces el costo: rojo", async () => {
    const { f } = armar(dos(bien), { pagador: "propio", saldo: async () => 0.01 });
    const d = await chequearRed(f);
    expect([d.nivel, d.caso, d.saldoXlm]).toEqual(["rojo", "sin-saldo", 0.01]);
  });

  it("justo en el doble del costo alcanza", async () => {
    const costo = costoDeSelloXlm(64_099);
    const d = await chequearRed(armar(dos(bien), { pagador: "propio", saldo: async () => costo * 2 }).f);
    expect(d.nivel).toBe("verde");
  });

  it("con saldo de sobra: verde", async () => {
    const d = await chequearRed(armar(dos(bien), { pagador: "propio", saldo: async () => 9_999 }).f);
    expect([d.nivel, d.saldoXlm]).toEqual(["verde", 9_999]);
  });

  it("si no se sabe el saldo (-1) o la pregunta falla, no se afirma nada", async () => {
    for (const saldo of [async () => -1, async () => Promise.reject(new Error("Horizon caído"))]) {
      const d = await chequearRed(armar(dos(bien), { pagador: "propio", saldo }).f);
      expect([d.nivel, d.caso, d.saldoXlm]).toEqual(["verde", null, null]);
    }
  });

  it("con el patrocinador no se mira el saldo de la cuenta", async () => {
    let preguntas = 0;
    const d = await chequearRed(armar(dos(bien), { pagador: "patrocinado", saldo: async () => (preguntas++, 0) }).f);
    expect([d.nivel, preguntas]).toEqual(["verde", 0]);
  });
});

describe("caso 5: el protocolo cambió", () => {
  it("una versión que no conocemos es amarillo y NO frena: la simulación anduvo, se sella igual", async () => {
    const d = await chequearRed(armar(dos({ protocolo: 31 })).f);
    expect([d.nivel, d.caso, d.protocolo]).toEqual(["amarillo", "protocolo", 31]);
    expect(d.nivel).not.toBe("rojo");
  });

  it("las versiones 29 y 30 (Bell) son conocidas: verde", async () => {
    for (const protocolo of [29, 30]) {
      const d = await chequearRed(armar(dos({ protocolo })).f);
      expect([d.nivel, d.caso], String(protocolo)).toEqual(["verde", null]);
    }
  });

  it("solo frena si la simulación falla: rojo", async () => {
    const d = await chequearRed(armar(dos({ protocolo: 31, simulacion: "error" })).f);
    expect([d.nivel, d.caso]).toEqual(["rojo", "protocolo"]);
    expect(d.costoXlm).toBeNull();
    expect(d.motivo).toMatch(/simulación/);
  });

  it("una simulación ilegible (sin costo) también es rojo", async () => {
    const { f } = armar(dos(bien));
    f.simular = async () => simularConRpc(SDF, "AAAA", async () => ({ latestLedger: 1 }));
    const d = await chequearRed(f);
    expect([d.nivel, d.caso]).toEqual(["rojo", "protocolo"]);
  });

  it("un protocolo nuevo con la simulación bien y un costo alto: manda el costo, que es rojo", async () => {
    const d = await chequearRed(armar(dos({ protocolo: 31, simulacion: "caro" })).f);
    expect([d.nivel, d.caso]).toEqual(["rojo", "costo-alto"]);
  });
});

describe("el chequeo no es una puerta", () => {
  it("sin internet no dice que la red anda mal: lo cuenta el aviso de siempre", async () => {
    const { f, falsa } = armar(dos({ anda: "cortado" }), { sinInternet: true });
    const d = await chequearRed(f);
    expect([d.nivel, d.sinInternet, d.caso]).toEqual(["verde", true, null]);
    expect(falsa.pedidos).toHaveLength(0);
  });

  it("si el chequeo mismo se rompe, dice verde y lo anota", async () => {
    const { f } = armar(dos(bien));
    f.llamar = () => {
      throw new Error("un bug nuestro");
    };
    f.simular = () => {
      throw new Error("otro bug");
    };
    const d = await chequearRed(f);
    // Una excepción síncrona al preguntar no es un RPC caído: es un bug nuestro, y no frena nada.
    expect([d.nivel, d.sinChequeo]).toEqual(["verde", true]);
    const roto = armar(dos(bien)).f;
    Object.defineProperty(roto, "rpcs", {
      get() {
        throw new Error("bug");
      },
    });
    const d2 = await chequearRed(roto);
    expect([d2.nivel, d2.sinChequeo]).toEqual(["verde", true]);
    expect(d2.motivo).toMatch(/el chequeo falló/);
  });
});

describe("la caché de 60 segundos", () => {
  function conReloj() {
    let t = AHORA;
    let medidas = 0;
    const chequeo = crearChequeo(
      async () => {
        medidas++;
        return { ...(await chequearRed(armar(dos(bien)).f)), hora: t };
      },
      { ahora: () => t },
    );
    return { chequeo, avanzar: (ms: number) => void (t += ms), medidas: () => medidas };
  }

  it("dentro de los 60 s no vuelve a medir, y pasados sí", async () => {
    const c = conReloj();
    await c.chequeo.verificar();
    await c.chequeo.verificar();
    c.avanzar(59_000);
    await c.chequeo.verificar();
    expect(c.medidas()).toBe(1);
    c.avanzar(1_000);
    await c.chequeo.verificar();
    expect(c.medidas()).toBe(2);
  });

  it("forzar mide de nuevo; olvidar también", async () => {
    const c = conReloj();
    await c.chequeo.verificar();
    await c.chequeo.verificar({ forzar: true });
    expect(c.medidas()).toBe(2);
    c.chequeo.olvidar();
    expect(c.chequeo.ultimo()).toBeNull();
    await c.chequeo.verificar();
    expect(c.medidas()).toBe(3);
  });

  it("varios pedidos a la vez comparten la misma medición", async () => {
    const c = conReloj();
    const [a, b, d] = await Promise.all([c.chequeo.verificar(), c.chequeo.verificar({ forzar: true }), c.chequeo.verificar()]);
    expect(c.medidas()).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(d);
  });

  it("maxEdadMs acorta la caché (el chequeo al apretar Sellar acepta lo de hace poco)", async () => {
    const c = conReloj();
    await c.chequeo.verificar();
    c.avanzar(20_000);
    await c.chequeo.verificar({ maxEdadMs: 10_000 });
    expect(c.medidas()).toBe(2);
  });

  it("si la medición lanza, el error sale y el siguiente pedido vuelve a medir", async () => {
    let n = 0;
    const chequeo = crearChequeo(async () => {
      n++;
      if (n === 1) throw new Error("se rompió");
      return { ...(await chequearRed(armar(dos(bien)).f)) };
    });
    await expect(chequeo.verificar()).rejects.toThrow("se rompió");
    const d: Diagnostico = await chequeo.verificar();
    expect(d.nivel).toBe("verde");
    expect(n).toBe(2);
  });
});

describe("llamarRpc y simularConRpc", () => {
  it("un 429 o un 5xx con una página que no es JSON es un error del RPC", async () => {
    for (const anda of ["429", "503"] as const) {
      const falsa = redFalsa({ [SDF]: { anda } }, () => AHORA);
      await expect(llamarRpc(SDF, "getNetwork", null, { fetchFn: falsa.fetch })).rejects.toThrow(`HTTP ${anda}`);
    }
  });

  it("lee el costo de la simulación real y si pide restaurar", async () => {
    const falsa = redFalsa({ [SDF]: {}, [ANKR]: { simulacion: "restaurar" } }, () => AHORA);
    const llamar = (u: string, m: string, p: unknown) => llamarRpc(u, m, p, { fetchFn: falsa.fetch });
    expect(await simularConRpc(SDF, "AAAA", llamar)).toEqual({ minResourceFee: 64099, restaurar: false });
    expect(await simularConRpc(ANKR, "AAAA", llamar)).toMatchObject({ restaurar: true });
  });

  it("una simulación que falla devuelve el error, no lanza", async () => {
    const falsa = redFalsa({ [SDF]: { simulacion: "error" } }, () => AHORA);
    const m = await simularConRpc(SDF, "AAAA", (u, mm, p) => llamarRpc(u, mm, p, { fetchFn: falsa.fetch }));
    expect(m.error).toMatch(/HostError/);
    expect(m.minResourceFee).toBe(0);
  });
});

describe("CostoAlto", () => {
  it("se reconoce por el nombre y la forma", () => {
    const e = new CostoAlto(69.2);
    expect(esCostoAlto(e)).toBe(true);
    expect(esCostoAlto({ name: "CostoAlto", costoXlm: 3 })).toBe(true);
    expect(esCostoAlto(new Error("costo-alto"))).toBe(false);
    expect(esCostoAlto(null)).toBe(false);
    expect(e.message).toMatch(/costo-alto/);
  });
});
