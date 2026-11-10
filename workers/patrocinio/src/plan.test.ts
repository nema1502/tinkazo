import { beforeEach, describe, expect, it } from "vitest";
import { leerConfig } from "./config";
import { ESPERA_PLAN_MS, PAUSA_TRAS_FALLA_MS, Planes, TECHO_CUPO_PLAN, VIGENCIA_PLAN_MS, VIGENCIA_SIN_PLAN_MS, leerCuentaUrl, leerPlan } from "./plan";

const BASE = "https://cuenta.tinkazo.app";
const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const DIA = 86_400_000;
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const activo = (vence: number, sellos = 50, sorteos = 100) => ({ activo: true, vence, cupo: { sellos, sorteos } });

/** Un `fetch` de mentira: anota a qué URL le preguntaron y contesta lo que se le diga. */
function falso(responder: (url: string, n: number) => Promise<Response> | Response) {
  const llamadas: string[] = [];
  const f = (async (entrada: unknown, init?: RequestInit) => {
    llamadas.push(String(entrada));
    expect(init?.method).toBe("GET");
    return responder(String(entrada), llamadas.length);
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

let ahora = T0;
const armar = (f: typeof fetch, avisos: Array<[string, unknown]> = [], espera?: number) =>
  new Planes(BASE, f, () => ahora, (e, d) => void avisos.push([e, d]), espera);

beforeEach(() => {
  ahora = T0;
});

describe("lo que dice el Worker de la cuenta", () => {
  it("un plan activo da su cupo y su vencimiento", async () => {
    const m = falso(() => json(activo(T0 + 10 * DIA)));
    expect(await armar(m.f).cupoDe(A)).toEqual({ sellos: 50, sorteos: 100, vence: T0 + 10 * DIA });
    expect(m.llamadas).toEqual([`${BASE}/v1/cuenta/${A}/plan`]);
  });

  it("sin plan, o con un plan que ya venció, no da nada", async () => {
    expect(await armar(falso(() => json({ activo: false })).f).cupoDe(A)).toBeNull();
    expect(await armar(falso(() => json(activo(T0))).f).cupoDe(A)).toBeNull();
    expect(await armar(falso(() => json(activo(T0 - DIA))).f).cupoDe(A)).toBeNull();
  });

  it("una respuesta que no tiene la forma de siempre no es «sin plan»: es una falla", () => {
    const rota = [
      null,
      "plan",
      {},
      { activo: "si" },
      { activo: true },
      { activo: true, vence: "mañana", cupo: { sellos: 50, sorteos: 100 } },
      { activo: true, vence: T0 + DIA },
      { activo: true, vence: T0 + DIA, cupo: { sellos: 50 } },
      { activo: true, vence: T0 + DIA, cupo: { sellos: 50.5, sorteos: 100 } },
      { activo: true, vence: T0 + DIA, cupo: { sellos: -1, sorteos: 100 } },
      { activo: true, vence: T0 + DIA, cupo: { sellos: "50", sorteos: "100" } },
      { activo: true, vence: Number.NaN, cupo: { sellos: 50, sorteos: 100 } },
      { activo: true, vence: T0 + DIA, cupo: { sellos: TECHO_CUPO_PLAN + 1, sorteos: 100 } },
      { activo: true, vence: T0 + DIA, cupo: { sellos: 50, sorteos: 1e9 } },
    ];
    for (const x of rota) expect(leerPlan(x, T0), JSON.stringify(x)).toMatchObject({ ok: false });
    expect(leerPlan(activo(T0 + DIA), T0)).toEqual({ ok: true, cupo: { sellos: 50, sorteos: 100, vence: T0 + DIA } });
    expect(leerPlan({ activo: false }, T0)).toEqual({ ok: true, cupo: null });
  });
});

describe("la caché en memoria", () => {
  it("un plan activo se recuerda cinco minutos y después se vuelve a preguntar", async () => {
    const m = falso(() => json(activo(T0 + 10 * DIA)));
    const planes = armar(m.f);
    await planes.cupoDe(A);
    ahora += VIGENCIA_PLAN_MS - 1;
    expect(await planes.cupoDe(A)).toMatchObject({ sellos: 50 });
    expect(m.llamadas).toHaveLength(1);
    ahora += 1;
    await planes.cupoDe(A);
    expect(m.llamadas).toHaveLength(2);
  });

  it("nunca se recuerda un plan más allá de su vencimiento", async () => {
    const m = falso(() => json(activo(T0 + 2 * 60_000)));
    const planes = armar(m.f);
    expect(await planes.cupoDe(A)).not.toBeNull();
    ahora = T0 + 2 * 60_000 - 1;
    expect(await planes.cupoDe(A)).not.toBeNull();
    expect(m.llamadas).toHaveLength(1);
    // Venció: se pregunta de nuevo, y un plan con ese vencimiento ya no da nada.
    ahora = T0 + 2 * 60_000;
    expect(await planes.cupoDe(A)).toBeNull();
    expect(m.llamadas).toHaveLength(2);
  });

  it("«sin plan» se recuerda poco (un minuto): quien compra el plan y vuelve no espera cinco", async () => {
    let tiene = false;
    const m = falso(() => json(tiene ? activo(T0 + 30 * DIA) : { activo: false }));
    const planes = armar(m.f);
    expect(VIGENCIA_SIN_PLAN_MS).toBeLessThan(VIGENCIA_PLAN_MS);
    expect(await planes.cupoDe(A)).toBeNull();
    tiene = true;
    ahora += VIGENCIA_SIN_PLAN_MS - 1;
    expect(await planes.cupoDe(A)).toBeNull();
    expect(m.llamadas).toHaveLength(1);
    ahora += 1;
    expect(await planes.cupoDe(A)).toMatchObject({ sellos: 50 });
    expect(m.llamadas).toHaveLength(2);
  });

  it("cada cuenta tiene la suya", async () => {
    const m = falso((url) => json(url.includes(A) ? activo(T0 + DIA) : { activo: false }));
    const planes = armar(m.f);
    expect(await planes.cupoDe(A)).not.toBeNull();
    expect(await planes.cupoDe(B)).toBeNull();
    expect(await planes.cupoDe(A)).not.toBeNull();
    expect(await planes.cupoDe(B)).toBeNull();
    expect(m.llamadas).toHaveLength(2);
  });

  it("treinta preguntas a la vez por la misma cuenta hacen una sola consulta", async () => {
    const m = falso(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return json(activo(T0 + DIA));
    });
    const planes = armar(m.f);
    const rs = await Promise.all(Array.from({ length: 30 }, () => planes.cupoDe(A)));
    expect(rs.every((x) => x?.sellos === 50)).toBe(true);
    expect(m.llamadas).toHaveLength(1);
  });

  it("no crece sin fin: con miles de cuentas se olvidan las más viejas", async () => {
    const m = falso(() => json({ activo: false }));
    const planes = armar(m.f);
    const cuentas = Array.from({ length: 5_100 }, (_, i) => `G${String(i).padStart(55, "0")}`);
    for (const c of cuentas) await planes.cupoDe(c);
    expect(m.llamadas).toHaveLength(5_100);
    await planes.cupoDe(cuentas[5_099] as string);
    expect(m.llamadas).toHaveLength(5_100);
    await planes.cupoDe(cuentas[0] as string);
    expect(m.llamadas).toHaveLength(5_101);
  });
});

describe("cuando el Worker de la cuenta no contesta, nunca se bloquea nada", () => {
  it("un fetch que se corta da null y no lanza", async () => {
    const m = falso(() => Promise.reject(new TypeError("fetch failed")));
    const avisos: Array<[string, unknown]> = [];
    expect(await armar(m.f, avisos).cupoDe(A)).toBeNull();
    expect(avisos).toEqual([["plan-sin-respuesta", { motivo: "red" }]]);
  });

  it("un 500, un 429, un 404 o una página que no es JSON dan null", async () => {
    for (const r of [() => json({ error: "libro" }, 503), () => json({ error: "x" }, 500), () => json({ error: "cupo-ip" }, 429), () => json({}, 404), () => new Response("<html>", { status: 200 }), () => new Response("", { status: 200 })]) {
      expect(await armar(falso(r).f).cupoDe(A)).toBeNull();
    }
  });

  it("una respuesta enorme se descarta", async () => {
    const m = falso(() => new Response(JSON.stringify({ activo: true, vence: T0 + DIA, cupo: { sellos: 50, sorteos: 100 }, relleno: "x".repeat(5_000) })));
    const avisos: Array<[string, unknown]> = [];
    expect(await armar(m.f, avisos).cupoDe(A)).toBeNull();
    expect(avisos).toEqual([["plan-sin-respuesta", { motivo: "largo" }]]);
  });

  it("si tarda más del tiempo máximo (1,5 s) da null: se corta la consulta, no se espera", async () => {
    expect(ESPERA_PLAN_MS).toBe(1_500);
    let cortada = false;
    const f = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_ok, no) => {
        init?.signal?.addEventListener("abort", () => {
          cortada = true;
          no(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof fetch;
    const avisos: Array<[string, unknown]> = [];
    const antes = Date.now();
    expect(await armar(f, avisos, 30).cupoDe(A)).toBeNull();
    expect(Date.now() - antes).toBeLessThan(500);
    expect(cortada).toBe(true);
    expect(avisos).toEqual([["plan-sin-respuesta", { motivo: "tiempo" }]]);
  });

  it("un fetch que ignora la señal y no vuelve tampoco cuelga a nadie", async () => {
    const f = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    expect(await armar(f, [], 30).cupoDe(A)).toBeNull();
  });

  it("tras una falla no se vuelve a preguntar por nadie durante 30 s: una caída cuesta una espera, no una por pedido", async () => {
    let cae = true;
    const m = falso(() => (cae ? Promise.reject(new TypeError("caído")) : json(activo(T0 + DIA))));
    const planes = armar(m.f);
    expect(await planes.cupoDe(A)).toBeNull();
    expect(await planes.cupoDe(B)).toBeNull();
    expect(await planes.cupoDe(A)).toBeNull();
    expect(m.llamadas).toHaveLength(1);
    cae = false;
    ahora += PAUSA_TRAS_FALLA_MS - 1;
    expect(await planes.cupoDe(A)).toBeNull();
    expect(m.llamadas).toHaveLength(1);
    ahora += 1;
    expect(await planes.cupoDe(A)).toMatchObject({ sellos: 50 });
    expect(m.llamadas).toHaveLength(2);
  });

  it("durante la caída, un plan que ya se conocía sigue valiendo hasta que se acabe lo recordado", async () => {
    let cae = false;
    const m = falso(() => (cae ? Promise.reject(new TypeError("caído")) : json(activo(T0 + 10 * DIA))));
    const planes = armar(m.f);
    expect(await planes.cupoDe(A)).not.toBeNull();
    cae = true;
    ahora += VIGENCIA_PLAN_MS - 1;
    expect(await planes.cupoDe(A)).not.toBeNull();
    ahora += 1;
    expect(await planes.cupoDe(A)).toBeNull();
    expect(await planes.cupoDe(B)).toBeNull();
  });

  it("la aviso no lleva cuentas ni direcciones", async () => {
    const avisos: Array<[string, unknown]> = [];
    await armar(falso(() => Promise.reject(new TypeError(`no llego a ${BASE}/v1/cuenta/${A}/plan`))).f, avisos).cupoDe(A);
    const texto = JSON.stringify(avisos);
    expect(texto).not.toContain(A);
    expect(texto).not.toContain(BASE);
  });
});

describe("la dirección del Worker de la cuenta (CUENTA_URL)", () => {
  it("vacía no consulta nada: es lo de siempre", () => {
    for (const v of [undefined, "", "   "]) {
      expect(leerCuentaUrl(v)).toBeNull();
      expect(leerConfig({ CUENTA_URL: v }).cuentaUrl).toBeNull();
    }
    expect(leerConfig({}).cuentaUrl).toBeNull();
  });

  it("acepta https, con o sin barra final, y localhost para probar", () => {
    expect(leerCuentaUrl("https://cuenta.tinkazo.app")).toBe(BASE);
    expect(leerCuentaUrl(" https://cuenta.tinkazo.app/ ")).toBe(BASE);
    expect(leerCuentaUrl("http://localhost:8794")).toBe("http://localhost:8794");
    expect(leerCuentaUrl("http://127.0.0.1:8794/")).toBe("http://127.0.0.1:8794");
    expect(leerConfig({ CUENTA_URL: BASE }).cuentaUrl).toBe(BASE);
  });

  it("lo que no sirve se ignora en lugar de apuntar a cualquier lado", () => {
    for (const mala of ["cuenta.tinkazo.app", "http://cuenta.tinkazo.app", "ftp://cuenta.tinkazo.app", "https://cuenta.tinkazo.app/v1", "https://cuenta.tinkazo.app?x=1", "https://usuario:clave@cuenta.tinkazo.app", "https://", "no es una url"]) {
      expect(leerCuentaUrl(mala), mala).toBeNull();
    }
  });
});
