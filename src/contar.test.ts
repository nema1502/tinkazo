import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarConteo } from "../workers/enlaces/src/conteo";
import { T } from "./i18n";
import deployments from "./stellar/deployments.json";
import {
  CONTADOR,
  contar,
  contarApertura,
  contarAperturaDeEvento,
  contarEntrada,
  contarPractica,
  contarUnaVez,
  contarVeredicto,
  cuerpo,
  enPractica,
  errorContable,
  marcarEntrada,
  marcarQr,
  probarCon,
  puedeContar,
  quitarMarca,
  refDe,
  tomarEntrada,
  viaDe,
} from "./contar";

const DESTINO = "https://c.tinkazo.app/v1/contar";
// El contrato vigente de testnet, leído de deployments.json y no copiado: así no caduca cuando se reemplaza.
const CONTRATO = deployments.testnet.contractId;
const REF = { net: "testnet", contract: CONTRATO, id: "278" } as const;

class Almacen {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

let enviados: Array<{ url: string; texto: unknown }>;
let almacen: Almacen;
let reemplazos: string[];
let alMostrarse: Array<() => void>;

/** Una pestaña de mentira: dónde está, qué pide el navegador, su almacenamiento y lo que sale por `sendBeacon`. */
function pestaña(op: { host?: string; search?: string; nav?: Record<string, unknown>; prerendering?: boolean } = {}): void {
  enviados = [];
  almacen = new Almacen();
  reemplazos = [];
  alMostrarse = [];
  vi.stubGlobal("location", { hostname: op.host ?? "tinkazo.app", search: op.search ?? "", pathname: "/verificar.html", hash: "#r1abc" });
  vi.stubGlobal("navigator", {
    doNotTrack: null,
    sendBeacon: (url: string, texto: unknown) => {
      enviados.push({ url, texto });
      return true;
    },
    ...op.nav,
  });
  vi.stubGlobal("document", {
    prerendering: op.prerendering ?? false,
    addEventListener: (_tipo: string, fn: () => void) => alMostrarse.push(fn),
  });
  vi.stubGlobal("sessionStorage", almacen);
  vi.stubGlobal("history", { state: null, replaceState: (_s: unknown, _t: string, url: string) => reemplazos.push(url) });
}

const leidos = (): unknown[] => enviados.map((x) => JSON.parse(String(x.texto)));

beforeEach(() => {
  probarCon(DESTINO);
  pestaña();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  probarCon("");
});

describe("lo que manda el sitio", () => {
  it("pasa la validación del Worker, en cada forma en que lo mandan los ganchos", () => {
    const cuerpos = [
      cuerpo("account_connected", { kind: "google" }),
      cuerpo("account_connected", { kind: "email" }),
      cuerpo("account_connected", { kind: "freighter" }),
      cuerpo("account_connected", { kind: "test" }),
      cuerpo("list_ready", { source: "typed", size: "10-49" }),
      cuerpo("list_ready", { source: "luma", size: "50-199" }),
      cuerpo("list_shown", {}),
      cuerpo("seal_sent", { network: "testnet" }),
      cuerpo("seal_confirmed", { network: "mainnet" }),
      cuerpo("seal_failed", { network: "testnet", error: errorContable("noFunds") }),
      cuerpo("draw_confirmed", { network: "testnet" }),
      cuerpo("draw_failed", { network: "testnet", error: "rpcDown" }),
      cuerpo("draw_failed", { network: "testnet", error: errorContable("una clave nueva") }),
      cuerpo("share", { channel: "copy" }, REF),
      cuerpo("share", { channel: "qr_big" }),
      cuerpo("share", { channel: "event" }),
      cuerpo("share", { channel: "whatsapp" }, REF),
      cuerpo("share", { channel: "native" }, REF),
      cuerpo("proof_open", { via: "qr" }, REF),
      cuerpo("proof_open", { via: "short" }),
      cuerpo("proof_verdict", { verdict: "green" }, REF),
      cuerpo("practice_done", { kind: "demo" }),
      cuerpo("tutorial_open", { step: "2", from: "button" }),
      cuerpo("tutorial_open", { step: "1" }),
    ];
    for (const c of cuerpos) expect(validarConteo(JSON.parse(c)), c).toMatchObject({ ok: true });
  });

  it("es solo el evento, sus propiedades y la referencia del sorteo", () => {
    expect(JSON.parse(cuerpo("list_shown", {}))).toEqual({ e: "list_shown" });
    expect(JSON.parse(cuerpo("share", { channel: "copy" }, { ...REF, extra: "x" } as typeof REF))).toEqual({
      e: "share",
      p: { channel: "copy" },
      ref: REF,
    });
  });
});

describe("cuándo se manda", () => {
  it("con sendBeacon, como texto, al contador", () => {
    expect(contar("seal_sent", { network: "testnet" })).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.url).toBe(DESTINO);
    expect(typeof enviados[0]?.texto).toBe("string");
    expect(leidos()[0]).toEqual({ e: "seal_sent", p: { network: "testnet" } });
  });

  it("sin la dirección del contador no sale nada (así queda hasta desplegar el Worker)", () => {
    probarCon("");
    expect(contar("seal_sent", { network: "testnet" })).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  it("solo en tinkazo.app", () => {
    for (const host of ["localhost", "127.0.0.1", "tinkazo.vercel.app", "tinkazo-git-algo.vercel.app", "www.tinkazo.app"]) {
      pestaña({ host });
      expect(contar("list_shown", {}), host).toBe(false);
      expect(enviados).toHaveLength(0);
    }
  });

  it("nunca si el navegador pide que no lo sigan, ni desde un navegador automatizado", () => {
    for (const nav of [{ doNotTrack: "1" }, { globalPrivacyControl: true }, { webdriver: true }]) {
      pestaña({ nav });
      expect(contar("list_shown", {}), JSON.stringify(nav)).toBe(false);
      expect(enviados).toHaveLength(0);
    }
    expect(puedeContar({ hostname: "tinkazo.app" }, { doNotTrack: null })).toBe(true);
    expect(puedeContar({ hostname: "tinkazo.app" }, { doNotTrack: "0", globalPrivacyControl: false, webdriver: false })).toBe(true);
  });

  it("en la demo, solo que llegó al ganador y pedir ayuda", () => {
    pestaña({ search: "?demo=wheel" });
    expect(enPractica()).toBe(true);
    for (const e of ["list_shown", "seal_sent", "share"] as const) {
      const r = e === "list_shown" ? contar(e, {}) : e === "seal_sent" ? contar(e, { network: "testnet" }) : contar(e, { channel: "copy" });
      expect(r, e).toBe(false);
    }
    expect(contarEntrada("google")).toBe(false);
    expect(contarPractica("demo")).toBe(true);
    expect(contar("tutorial_open", { step: "1", from: "end" })).toBe(true);
    expect(leidos()).toEqual([
      { e: "practice_done", p: { kind: "demo" } },
      { e: "tutorial_open", p: { step: "1", from: "end" } },
    ]);
  });

  it("en el ensayo (la marca de la pestaña), lo mismo", () => {
    almacen.setItem("tinkazo.ensayo", "1");
    expect(enPractica()).toBe(true);
    expect(contar("list_shown", {})).toBe(false);
    expect(contarPractica("practice")).toBe(true);
    almacen.removeItem("tinkazo.ensayo");
    expect(enPractica()).toBe(false);
    expect(contar("list_shown", {})).toBe(true);
  });

  it("si sendBeacon falla o no existe, no pasa nada", () => {
    pestaña({ nav: { sendBeacon: () => { throw new Error("no"); } } });
    expect(contar("list_shown", {})).toBe(false);
    pestaña({ nav: { sendBeacon: undefined } });
    expect(contar("list_shown", {})).toBe(false);
  });

  it("una página adelantada (prerender) manda recién cuando se muestra", () => {
    pestaña({ prerendering: true });
    expect(contar("list_shown", {})).toBe(true);
    expect(enviados).toHaveLength(0);
    alMostrarse.forEach((f) => f());
    expect(leidos()).toEqual([{ e: "list_shown" }]);
  });
});

describe("una sola vez por pestaña", () => {
  it("lo que tiene clave se cuenta una vez", () => {
    expect(contarUnaVez("x", "list_shown", {})).toBe(true);
    expect(contarUnaVez("x", "list_shown", {})).toBe(false);
    expect(contarUnaVez("y", "list_shown", {})).toBe(true);
    expect(enviados).toHaveLength(2);
  });

  it("si no salió, no queda anotado", () => {
    probarCon("");
    expect(contarUnaVez("x", "list_shown", {})).toBe(false);
    probarCon(DESTINO);
    expect(contarUnaVez("x", "list_shown", {})).toBe(true);
  });

  it("la primera cuenta conectada, por la vía que sea", () => {
    expect(contarEntrada("google")).toBe(true);
    expect(contarEntrada("email")).toBe(false);
    expect(leidos()).toEqual([{ e: "account_connected", p: { kind: "google" } }]);
  });

  it("la apertura de un comprobante, una vez por sorteo; el veredicto, una vez por sorteo y por veredicto", () => {
    expect(contarApertura("qr", REF)).toBe(true);
    expect(contarApertura("long", REF)).toBe(false);
    expect(contarApertura("long", { ...REF, id: "279" })).toBe(true);
    expect(contarVeredicto("error", REF)).toBe(true);
    expect(contarVeredicto("green", REF)).toBe(true);
    expect(contarVeredicto("green", REF)).toBe(false);
    expect(contarAperturaDeEvento("short", "testnet:x:1")).toBe(true);
    expect(contarAperturaDeEvento("short", "testnet:x:1")).toBe(false);
    expect(leidos()).toEqual([
      { e: "proof_open", p: { via: "qr" }, ref: REF },
      { e: "proof_open", p: { via: "long" }, ref: { ...REF, id: "279" } },
      { e: "proof_verdict", p: { verdict: "error" }, ref: REF },
      { e: "proof_verdict", p: { verdict: "green" }, ref: REF },
      { e: "proof_open", p: { via: "short" } },
    ]);
  });

  it("lo anotado vive en la pestaña y no lleva nada de nadie", () => {
    contarEntrada("test");
    contarApertura("qr", REF);
    const anotado = almacen.getItem("tinkazo.contados") ?? "";
    expect(JSON.parse(anotado)).toEqual(["account_connected", `proof_open:testnet:${CONTRATO}:278`]);
  });
});

describe("la ida y vuelta a Google", () => {
  it("la marca vale una vez", () => {
    expect(tomarEntrada()).toBe(false);
    marcarEntrada();
    expect(tomarEntrada()).toBe(true);
    expect(tomarEntrada()).toBe(false);
  });

  it("y vence a los 15 minutos", () => {
    const ahora = vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    marcarEntrada();
    ahora.mockReturnValue(1_000_000_000 + 16 * 60_000);
    expect(tomarEntrada()).toBe(false);
  });
});

describe("por dónde se abrió un comprobante", () => {
  it("la marca del QR o del enlace corto; sin marca, el largo", () => {
    expect(viaDe("")).toBe("long");
    expect(viaDe("?o=qr")).toBe("qr");
    expect(viaDe("?lang=en&o=short&theme=dark")).toBe("short");
    expect(viaDe("?o=otra")).toBe("long");
  });

  it("la marca sale de la dirección y lo demás queda", () => {
    pestaña({ search: "?lang=en&o=qr" });
    quitarMarca();
    expect(reemplazos).toEqual(["/verificar.html?lang=en#r1abc"]);
    pestaña({ search: "?o=short" });
    quitarMarca();
    expect(reemplazos).toEqual(["/verificar.html#r1abc"]);
    pestaña({ search: "?lang=en" });
    quitarMarca();
    expect(reemplazos).toEqual([]);
  });

  it("el QR de un comprobante del sitio lleva la marca antes del #", () => {
    expect(marcarQr("https://tinkazo.app/verificar.html#r1abc")).toBe("https://tinkazo.app/verificar.html?o=qr#r1abc");
    expect(marcarQr("https://tinkazo.app/evento.html?lang=en#e1x")).toBe("https://tinkazo.app/evento.html?lang=en&o=qr#e1x");
    expect(marcarQr("https://tinkazo.app/c/AbCd1234#k_-9")).toBe("https://tinkazo.app/c/AbCd1234?o=qr#k_-9");
    expect(marcarQr("http://localhost:4173/verificar.html#r1")).toBe("http://localhost:4173/verificar.html?o=qr#r1");
    // Ya marcado, otra página o la ronda del faro: igual.
    for (const igual of [
      "https://tinkazo.app/verificar.html?o=qr#r1abc",
      "https://tinkazo.app/lista.html#l1abc",
      "https://tinkazo.app/c/corto#k",
      "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/1000",
      "",
    ]) {
      expect(marcarQr(igual)).toBe(igual);
    }
  });
});

describe("la referencia de un sorteo", () => {
  it("solo si está entera y en una red del contrato", () => {
    expect(refDe({ net: "testnet", contract: CONTRATO, id: 278n })).toEqual(REF);
    expect(refDe({ net: "testnet", contract: CONTRATO, id: "278" })).toEqual(REF);
    expect(refDe({ net: "testnet", contract: CONTRATO })).toBeUndefined();
    expect(refDe({ net: "testnet", contract: "", id: "1" })).toBeUndefined();
    expect(refDe({ net: "futurenet", contract: CONTRATO, id: "1" })).toBeUndefined();
    expect(refDe({ net: "testnet", contract: CONTRATO, id: "" })).toBeUndefined();
    expect(refDe({})).toBeUndefined();
  });

  it("un error que la lista no conoce se cuenta como unknown", () => {
    expect(errorContable("noFunds")).toBe("noFunds");
    expect(errorContable("userRejected")).toBe("userRejected");
    expect(errorContable("algo nuevo")).toBe("unknown");
  });
});

describe("los términos dicen lo que hace el contador", () => {
  it("con el contador apagado dicen que todavía no se cuenta nada, y con el contador prendido ya no lo dicen", () => {
    // Al prender CONTADOR hay que cambiar tmMore2 y tmMore4 en el mismo cambio (es, en y terminos.html): ver src/contar.ts.
    const apagado = CONTADOR === "";
    expect(/todavía no se cuenta nada/.test(String(T.es.tmMore2)), "es").toBe(apagado);
    expect(/None of this is counted yet/.test(String(T.en.tmMore2)), "en").toBe(apagado);
  });
});
