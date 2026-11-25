// Las cuentas nuevas de los últimos 60 minutos corridos, desde la consulta de uso del proveedor por ventana de tiempo
// (`GET /v3/billing/usage?from=…&to=…`). Una sola consulta, exacta aunque haya miles de firmas, recordada un minuto y
// nunca en el camino de un pago. Todo con un Pollar de mentira y datos inventados: ninguna prueba toca una red.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEMORIA_CUENTAS_MS, Pollar, VENTANA_CUENTAS_MINUTOS } from "./pollar";
import { POLLAR_SERVIDOR } from "./servidores";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const SECRETO = "sec_mainnet_prueba_inventada_0000000000";
const APP = "app_mainnet_inventada";
const iso = (ms: number) => new Date(ms).toISOString();

const uso = (events: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ code: "SERVER_BILLING_USAGE", success: true, content: { from: iso(T0 - 3_600_000), to: iso(T0), totalCredits: "0", events, ...extra } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const falla = (status: number) => new Response(JSON.stringify({ code: "DOWN", success: false }), { status, headers: { "Content-Type": "application/json" } });

function montar(responder: (url: URL) => Response | Promise<Response>, extra: { esperaMs?: number } = {}) {
  let ahora = T0;
  const llamadas: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const anotado: unknown[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    llamadas.push({ url: u, init });
    return responder(u);
  };
  const p = new Pollar({ secreto: SECRETO, appId: APP, fetch, reloj: () => ahora, registrar: (e, d) => anotado.push([e, d]), ...extra });
  return { p, llamadas, anotado, mover: (ms: number) => (ahora += ms) };
}

describe("Pollar.cuentasDeLaUltimaHora", () => {
  it("pide el uso de los últimos 60 minutos corridos, con from y to en ISO, y suma por el comienzo del nombre", async () => {
    expect(VENTANA_CUENTAS_MINUTOS).toBe(60);
    const { p, llamadas } = montar(() =>
      uso([
        { event: "wallet.created:STELLAR:COSIGNED", count: 12, credits: "180" },
        { event: "cosign.signature:STELLAR", count: 4000, credits: "80000" },
        { event: "account.active:monthly", count: 3, credits: "30" },
      ]),
    );
    expect(await p.cuentasDeLaUltimaHora()).toEqual({ ok: true, nuevas: 12, activaciones: 3 });
    expect(llamadas).toHaveLength(1);
    const u = llamadas[0]!.url;
    expect(u.origin + u.pathname).toBe(`${POLLAR_SERVIDOR}/v3/billing/usage`);
    expect(u.searchParams.get("from")).toBe(iso(T0 - 60 * 60_000));
    expect(u.searchParams.get("to")).toBe(iso(T0));
    // El parámetro `since` no acota nada en esta consulta: no se manda.
    expect(u.searchParams.has("since")).toBe(false);
    expect(new Headers(llamadas[0]!.init?.headers).get("x-pollar-api-key")).toBe(SECRETO);
  });

  it("una ventana sin cuentas da cero: es un dato", async () => {
    expect(await montar(() => uso([])).p.cuentasDeLaUltimaHora()).toEqual({ ok: true, nuevas: 0, activaciones: 0 });
  });

  it("lo recuerda un minuto: dos lecturas seguidas hacen una sola consulta, y pasado el minuto vuelve a consultar", async () => {
    let n = 5;
    const { p, llamadas, mover } = montar(() => uso([{ event: "wallet.created:STELLAR:COSIGNED", count: n }]));
    expect(await p.cuentasDeLaUltimaHora()).toMatchObject({ nuevas: 5 });
    n = 9;
    mover(MEMORIA_CUENTAS_MS - 1);
    expect(await p.cuentasDeLaUltimaHora()).toMatchObject({ nuevas: 5 });
    expect(llamadas).toHaveLength(1);
    mover(2);
    expect(await p.cuentasDeLaUltimaHora()).toMatchObject({ nuevas: 9 });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]!.url.searchParams.get("to")).toBe(iso(T0 + MEMORIA_CUENTAS_MS + 1));
  });

  it("lecturas a la vez comparten una sola consulta", async () => {
    const { p, llamadas } = montar(() => uso([{ event: "wallet.created:STELLAR:COSIGNED", count: 1 }]));
    const r = await Promise.all([p.cuentasDeLaUltimaHora(), p.cuentasDeLaUltimaHora(), p.cuentasDeLaUltimaHora()]);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(llamadas).toHaveLength(1);
  });

  it("si la consulta falla no hay conteo, y tampoco se insiste antes del minuto", async () => {
    const { p, llamadas, mover, anotado } = montar(() => falla(503));
    expect(await p.cuentasDeLaUltimaHora()).toEqual({ ok: false });
    expect(await p.cuentasDeLaUltimaHora()).toEqual({ ok: false });
    expect(llamadas).toHaveLength(1);
    // Queda anotado con un código fijo, sin datos.
    expect(anotado).toContainEqual(["error-pollar", { llamada: "usage", codigo: 503 }]);
    mover(MEMORIA_CUENTAS_MS + 1);
    await p.cuentasDeLaUltimaHora();
    expect(llamadas).toHaveLength(2);
  });

  it("si falta la lista de eventos, o un count no es un entero seguro mayor o igual a cero, no hay conteo", async () => {
    const malas = [
      uso(undefined),
      uso("no"),
      uso([{ event: "wallet.created:STELLAR:COSIGNED", count: -1 }]),
      uso([{ event: "wallet.created:STELLAR:COSIGNED", count: 1.5 }]),
      uso([{ event: "wallet.created:STELLAR:COSIGNED", count: "3" }]),
      uso([{ event: "wallet.created:STELLAR:COSIGNED" }]),
      new Response(JSON.stringify({ code: "OTRA_COSA", success: true, content: { events: [] } }), { status: 200 }),
      new Response("no es json", { status: 200 }),
    ];
    for (const r of malas) expect(await montar(() => r.clone()).p.cuentasDeLaUltimaHora()).toEqual({ ok: false });
  });

  it("si tarda más que la espera de siempre con el proveedor, no hay conteo y no se queda esperando", async () => {
    const { p, anotado } = montar(() => new Promise<Response>(() => {}), { esperaMs: 20 });
    expect(await p.cuentasDeLaUltimaHora()).toEqual({ ok: false });
    expect(anotado).toContainEqual(["error-pollar", { llamada: "usage", codigo: "tiempo" }]);
  });
});

describe("la consulta de uso nunca va en el camino de un pago", () => {
  it("solo la lectura del estado la pide: ningún otro archivo del servicio llama a cuentasDeLaUltimaHora", () => {
    const carpeta = dirname(fileURLToPath(import.meta.url));
    const quienes = readdirSync(carpeta)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => readFileSync(join(carpeta, f), "utf8").includes("cuentasDeLaUltimaHora"))
      .sort();
    expect(quienes).toEqual(["pollar.ts", "rutas-altas.ts"]);
    const rutas = readFileSync(join(carpeta, "rutas-altas.ts"), "utf8");
    expect(rutas.match(/cuentasDeLaUltimaHora\(\)/g)).toHaveLength(1);
    // Y esa única llamada está dentro de vigilancia(), la que lee el estado.
    const desde = rutas.indexOf("async vigilancia(): Promise<Record<string, unknown>>");
    expect(desde).toBeGreaterThan(-1);
    expect(rutas.indexOf("cuentasDeLaUltimaHora()")).toBeGreaterThan(desde);
    expect(rutas.indexOf("cuentasDeLaUltimaHora()")).toBeLessThan(rutas.indexOf("\n  async ", desde + 1));
  });
});
