import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La prueba de control carga en frío el SDK de Stellar, como anchor.test.ts.
vi.setConfig({ testTimeout: 30_000 });

/** El cliente del contrato: si se pide, es que se iba a mandar algo a la cadena. */
const h = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("./stellar/contract", async (orig) => {
  const real = await orig<typeof import("./stellar/contract")>();
  return { ...real, getClient: () => h.getClient() };
});

/**
 * El ensayo nunca graba nada, aunque haya una cuenta abierta.
 *
 * Hasta el 22 de octubre de 2026, con una cuenta abierta, "Cargar ejemplo" y
 * "Sellar" grababan de verdad en la cadena, a nombre de quien probaba y con
 * comisión, un sorteo de dieciocho nombres inventados. El ensayo lo reemplaza,
 * y estas pruebas cuidan las dos llaves: la decisión (`sinGrabar`, que miran el
 * sello, el sorteo, Mis sorteos, el premio recordado, el enlace corto y el
 * borrador) y la capa que habla con la cadena, que se niega aunque algún camino
 * nuevo se olvide de mirar.
 */

/** Una pestaña: la dirección y su `sessionStorage`. `roto` hace que el almacenamiento tire, como una ventana privada con todo bloqueado. */
function pestana(search = "", roto = false): Map<string, string> {
  const datos = new Map<string, string>();
  vi.stubGlobal("location", { search });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => {
      if (roto) throw new Error("SecurityError");
      return datos.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (roto) throw new Error("SecurityError");
      datos.set(k, v);
    },
    removeItem: (k: string) => {
      if (roto) throw new Error("SecurityError");
      datos.delete(k);
    },
  });
  return datos;
}

async function modo() {
  vi.resetModules();
  return import("./ensayo-modo");
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("qué no se graba", () => {
  it("un sorteo de verdad se graba", async () => {
    pestana();
    const m = await modo();
    expect(m.enEnsayo()).toBe(false);
    expect(m.sinGrabar()).toBe(false);
  });

  it("la demo no se graba", async () => {
    pestana("?demo=race&lead=3");
    const m = await modo();
    expect(m.sinGrabar()).toBe(true);
  });

  it("el ensayo no se graba, y al salir vuelve a grabarse", async () => {
    const datos = pestana();
    const m = await modo();
    m.marcarEnsayo(true);
    expect(m.enEnsayo()).toBe(true);
    expect(m.sinGrabar()).toBe(true);
    // Vive en la pestaña, no en la dirección: el navegador no lo autocompleta en el evento.
    expect([...datos.values()]).toEqual(["1"]);
    m.marcarEnsayo(false);
    expect(m.enEnsayo()).toBe(false);
    expect(m.sinGrabar()).toBe(false);
    expect(datos.size).toBe(0);
  });

  it("se recuerda al recargar la pestaña", async () => {
    const datos = pestana();
    (await modo()).marcarEnsayo(true);
    // La página nueva lee lo que quedó en la pestaña.
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => datos.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
    const m = await modo();
    expect(m.sinGrabar()).toBe(true);
  });

  it("sin almacenamiento, el ensayo igual nunca graba", async () => {
    pestana("", true);
    const m = await modo();
    expect(() => m.marcarEnsayo(true)).not.toThrow();
    expect(m.enEnsayo()).toBe(true);
    expect(m.sinGrabar()).toBe(true);
  });

  it("en Node, sin dirección ni almacenamiento, no se rompe", async () => {
    const m = await modo();
    expect(m.sinGrabar()).toBe(false);
  });
});

describe("la lista del ensayo", () => {
  it("son dieciocho nombres de la fauna de Bolivia, sin repetidos, que no son los de la demo", async () => {
    pestana();
    const { LISTA_ENSAYO } = await modo();
    const { SAMPLE } = await import("./state");
    expect(LISTA_ENSAYO).toHaveLength(18);
    expect(new Set(LISTA_ENSAYO).size).toBe(18);
    expect(LISTA_ENSAYO.filter((n) => SAMPLE.includes(n))).toEqual([]);
    // Un animal y un nombre: nadie de la sala se llama "Llama Lupe".
    for (const n of LISTA_ENSAYO) expect(n).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
  });
});

describe("la capa que habla con la cadena se niega en el ensayo", () => {
  const args = { organizer: "G".padEnd(56, "A"), listHash: new Uint8Array(32), count: 18, numWinners: 1, round: 1, meta: "Termo" };

  it("sellar: no pide el contrato ni manda nada, aunque haya cuenta", async () => {
    pestana();
    h.getClient.mockReset();
    vi.resetModules();
    (await import("./ensayo-modo")).marcarEnsayo(true);
    const { sealOnChain, SIN_GRABAR } = await import("./ui/anchor");
    const pasos: string[] = [];
    await expect(sealOnChain(args, (p) => void pasos.push(p))).rejects.toThrow(SIN_GRABAR);
    expect(h.getClient).not.toHaveBeenCalled();
    expect(pasos).toEqual([]);
  });

  it("sortear: tampoco", async () => {
    pestana();
    h.getClient.mockReset();
    vi.resetModules();
    (await import("./ensayo-modo")).marcarEnsayo(true);
    const { drawOnChain, SIN_GRABAR } = await import("./ui/anchor");
    await expect(drawOnChain(7n, new Uint8Array(96), () => undefined)).rejects.toThrow(SIN_GRABAR);
    expect(h.getClient).not.toHaveBeenCalled();
  });

  it("en la demo, lo mismo", async () => {
    pestana("?demo=wheel");
    h.getClient.mockReset();
    vi.resetModules();
    const { sealOnChain, SIN_GRABAR } = await import("./ui/anchor");
    await expect(sealOnChain(args, () => undefined)).rejects.toThrow(SIN_GRABAR);
    expect(h.getClient).not.toHaveBeenCalled();
  });

  it("fuera del ensayo, el sello sí va a la cadena (la prueba de arriba no pasa por casualidad)", async () => {
    pestana();
    vi.stubGlobal("document", { dispatchEvent: () => true, getElementById: () => null, addEventListener: () => undefined, removeEventListener: () => undefined });
    h.getClient.mockReset();
    h.getClient.mockRejectedValue(new Error("sin red en la prueba"));
    vi.resetModules();
    const { sealOnChain } = await import("./ui/anchor");
    await expect(sealOnChain(args, () => undefined)).rejects.toThrow();
    expect(h.getClient).toHaveBeenCalled();
  });
});

describe("cada lugar que graba pregunta lo mismo", () => {
  // freeze.ts y draw.ts no se pueden montar sin la página: se mira su fuente.
  const fuente = (f: string): string => readFileSync(new URL(f, import.meta.url), "utf8");

  it("el sello va a la cadena solo si se puede grabar", () => {
    const f = fuente("./ui/freeze.ts");
    // Con cuenta y que se pueda grabar; "seguir sin sello" (la red no deja sellar) es lo único que lo apaga después.
    expect(f).toContain("const conCuenta = canAnchor() && !sinGrabar();");
    expect(f).toContain("const anchoring = conCuenta && !sinSello;");
    expect(f).toMatch(/if \(!sinGrabar\(\)\) \{\s+recordarPremio\(prize\);/);
    expect(f).toContain("const who = sinGrabar() ? undefined : currentSession()?.address;");
  });

  it("el sorteo no anota en Mis sorteos ni arma el enlace corto", () => {
    const d = fuente("./ui/draw.ts");
    expect(d).toContain("const who = sinGrabar() ? undefined : currentSession()?.address;");
    expect(d).toContain("const puedeAcortar = (): boolean => !sinGrabar() && !!proofLink;");
    expect(d).toContain("corto: !sinGrabar()");
    // `params.has("demo")` queda solo para lo que es de la demo sola (contar que llegó al ganador), nunca para no grabar.
    const deLaDemo = d.split(/\r?\n/).filter((l) => /params\.has\("demo"\)/.test(l));
    expect(deLaDemo.every((l) => /contarPractica\("demo"\)/.test(l)), deLaDemo.join("\n")).toBe(true);
  });

  it("la lista del ensayo no pisa el borrador, y la cuenta no precalienta el sello", () => {
    const p = fuente("./ui/participants.ts");
    // guardarBorrador, olvidarBorrador y reponerBorrador.
    expect(p.match(/if \(sinGrabar\(\)/g)?.length).toBe(3);
    expect(p).toContain("if (sinGrabar() || listaCerrada() || $<HTMLTextAreaElement>(\"ta\").value.trim()) return;");
    expect(fuente("./ui/wallet-ui.ts")).toContain("if (!sinGrabar() && canAnchor() && session?.address === para) precalentarSello();");
  });

  it("\"Cargar ejemplo\" no se ve nunca en una red con contrato", () => {
    expect(fuente("./ui/participants.ts")).toContain('$("btn-sample").style.display = anchoringAvailable || !vacia ? "none" : "";');
  });
});
