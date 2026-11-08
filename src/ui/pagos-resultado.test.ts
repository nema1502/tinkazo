// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T, setLang } from "../i18n";
import { app } from "../state";
import { TEXTOS_PAGOS } from "./pagos-textos";
import { mostrarPagosDelResultado } from "./pagos-resultado";

const cuenta = (): string => Keypair.random().publicKey();
/** La ronda de quicknet que nace ahora (la primera nació el 23 de agosto de 2023 y sale una cada 3 segundos). */
const rondaDeAhora = (): number => Math.floor((Date.now() / 1000 - 1_692_803_367) / 3) + 1;

/** Un sorteo sellado en la cadena y ya sorteado, con estos nombres en la lista y estos ganadores. */
function sortear(names: string[], winners: number[], over: { raffleId?: bigint | undefined; ronda?: number } = {}): void {
  const ronda = over.ronda ?? rondaDeAhora();
  delete over.ronda;
  app.frozen = { names, listHash: "ab".repeat(32), ts: 1_793_000_000, at: "", prize: "50 USDC", round: 100, raffleId: 777n, ...over } as NonNullable<typeof app.frozen>;
  if ("raffleId" in over && over.raffleId === undefined) delete (app.frozen as { raffleId?: bigint }).raffleId;
  app.drawn = { beacon: { round: ronda, randomness: "cd".repeat(32), signature: "ef".repeat(48) }, winners };
}

let pedidos: string[];

beforeEach(() => {
  document.body.innerHTML = '<div id="winner-box"><section class="pagos" id="pagos-box" style="display:none"></section></div>';
  setLang("es");
  pedidos = [];
  // Horizon sin pagos: la cuenta no recibió nada.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      pedidos.push(String(url));
      return new Response("{}", { status: 404 });
    }),
  );
  history.replaceState({}, "", "/");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  app.frozen = null;
  app.drawn = null;
});

const caja = (): HTMLElement => document.getElementById("pagos-box") as HTMLElement;

describe("el panel de ganadores en el resultado", () => {
  it("con la bandera apagada no pasa nada: ni panel ni un solo pedido a la red", async () => {
    sortear([cuenta(), cuenta()], [0, 1]);
    mostrarPagosDelResultado();
    expect(caja().style.display).toBe("none");
    expect(caja().childElementCount).toBe(0);
    expect(pedidos).toEqual([]);
  });

  it("con la bandera prendida y ganadores con cuenta, muestra una fila por ganador y mira la red de cada cuenta", async () => {
    vi.stubEnv("VITE_PAGOS", "1");
    const [a, b] = [cuenta(), cuenta()] as [string, string];
    sortear([a, "Ana Mamani", b], [0, 1, 2]);
    mostrarPagosDelResultado();
    expect(caja().style.display).toBe("block");
    expect(caja().querySelectorAll(".gan-fila")).toHaveLength(3);
    await vi.waitFor(() => expect(caja().textContent).not.toContain("Consultando"));
    // Solo las dos cuentas se miran en la red; Ana la entrega quien organiza.
    expect(pedidos).toHaveLength(2);
    expect(pedidos.every((u) => u.includes("/payments?join=transactions"))).toBe(true);
    expect(pedidos.some((u) => u.includes(`/accounts/${a}/`))).toBe(true);
    expect(pedidos.some((u) => u.includes(`/accounts/${b}/`))).toBe(true);
    // Una cuenta que no existe no recibió nada: pendiente dentro del plazo.
    expect(caja().textContent).toContain("Pendiente");
    expect(caja().textContent).not.toContain("Vencido");
    expect(caja().textContent).toContain("Lo entrega quien organiza");
    // Sin sesión abierta, es de solo lectura.
    expect(caja().querySelector(".gan-pagar")).toBeNull();
    expect(caja().querySelector(".gan-titulo")?.textContent).toBe("Ganadores y premios");
  });

  it("un sorteo de hace más de siete días, sin pago, aparece Vencido", async () => {
    vi.stubEnv("VITE_PAGOS", "1");
    sortear([cuenta()], [0], { ronda: 100 });
    mostrarPagosDelResultado();
    await vi.waitFor(() => expect(caja().textContent).toContain("Vencido"));
  });

  it("también se prende con la bandera del registro de equipos", async () => {
    vi.stubEnv("VITE_EQUIPOS", "1");
    sortear([cuenta()], [0]);
    mostrarPagosDelResultado();
    expect(caja().querySelectorAll(".gan-fila")).toHaveLength(1);
  });

  it("una lista de nombres no tiene panel: no hay a quién pagarle desde acá", async () => {
    vi.stubEnv("VITE_PAGOS", "1");
    sortear(["Ana", "Luis", "Marta"], [0, 1]);
    mostrarPagosDelResultado();
    expect(caja().style.display).toBe("none");
    expect(pedidos).toEqual([]);
  });

  it("un sorteo sin sello no tiene panel: la nota del pago lleva el número del sorteo", async () => {
    vi.stubEnv("VITE_PAGOS", "1");
    sortear([cuenta(), cuenta()], [0, 1], { raffleId: undefined });
    mostrarPagosDelResultado();
    expect(caja().style.display).toBe("none");
    expect(pedidos).toEqual([]);
  });

  it("la demo, que no graba nada, tampoco", async () => {
    vi.stubEnv("VITE_PAGOS", "1");
    history.replaceState({}, "", "/?demo=race");
    sortear([cuenta(), cuenta()], [0, 1]);
    mostrarPagosDelResultado();
    expect(caja().style.display).toBe("none");
    expect(pedidos).toEqual([]);
  });
});

describe("los textos y la página", () => {
  const dir = (...ruta: string[]): string => readFileSync(resolve(process.cwd(), ...ruta), "utf8");

  it("el español y el inglés tienen las mismas claves, con las mismas variables", () => {
    expect(Object.keys(TEXTOS_PAGOS.en).sort()).toEqual(Object.keys(TEXTOS_PAGOS.es).sort());
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
    for (const k of Object.keys(TEXTOS_PAGOS.es)) {
      expect(TEXTOS_PAGOS.es[k]?.trim(), k).toBeTruthy();
      expect(TEXTOS_PAGOS.en[k]?.trim(), k).toBeTruthy();
      expect(vars(TEXTOS_PAGOS.en[k] as string), k).toEqual(vars(TEXTOS_PAGOS.es[k] as string));
    }
  });

  it("están en el diccionario del sitio, en los dos idiomas", () => {
    for (const l of ["es", "en"] as const) for (const k of Object.keys(TEXTOS_PAGOS[l])) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_PAGOS[l][k]);
  });

  it("cada texto se usa en alguna parte, y cada clave que usa el código existe", () => {
    const fuentes = [dir("src/ui/panel-ganadores.ts"), dir("src/ui/pagar-premio.ts"), dir("verificar.html")].join("\n");
    const usadas = new Set([...fuentes.matchAll(/["'](pg[A-Z][A-Za-z0-9]*)["']/g)].map((m) => m[1] as string));
    for (const k of Object.keys(TEXTOS_PAGOS.es)) expect(usadas.has(k), `sin uso: ${k}`).toBe(true);
    for (const k of usadas) expect(TEXTOS_PAGOS.es[k], `sin texto: ${k}`).toBeTruthy();
  });

  it("la herramienta y la verificación tienen donde poner el panel", () => {
    expect(dir("index.html")).toMatch(/id="pagos-box"/);
    const verificar = dir("verificar.html");
    expect(verificar).toMatch(/id="sec-pagos"[^>]*display:none/);
    expect(verificar).toMatch(/id="pagos-cuerpo"/);
    expect(verificar).toContain('data-i="pgTitulo"');
  });

  it("la verificación solo baja el panel y sus textos con la bandera prendida: lo único que trae siempre es la bandera", () => {
    const verify = dir("src/verify.ts");
    expect(verify).not.toMatch(/from "\.\/ui\/(ganadores|pagos-comprobante|pagos-textos)"/);
    expect(verify).not.toMatch(/from "\.\/stellar\/pagos(-red|-envio)?"/);
    expect(verify).toMatch(/from "\.\/stellar\/pagos-bandera"/);
    expect(verify).toMatch(/if \(!pagosActivos\(\)\) return;\s*void import\("\.\/ui\/pagos-comprobante"\)/);
  });

  it("el botón de pagar está en el código que carga la herramienta solo con la bandera prendida", () => {
    const draw = dir("src/ui/draw.ts");
    expect(draw).toMatch(/if \(pagosActivos\(\)\) void import\("\.\/pagos-resultado"\)/);
  });
});
