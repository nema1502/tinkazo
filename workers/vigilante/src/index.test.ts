// El enchufe al Worker: lo que Cloudflare llama (el reloj y los pedidos) y que cada uno use las piezas de verdad.
// El `fetch` global se reemplaza por uno de mentira: ninguna prueba sale a una red de verdad.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { CLAVE_DE_OPERAR, CLAVE_DE_PRUEBA, PORTERO, T0, estadoBien, mundoFalso } from "./mundo-falso";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("scheduled: la vuelta del reloj", () => {
  it("corre una vuelta con el fetch y el reloj del Worker, y deja la hora anotada", async () => {
    const m = mundoFalso({ estado: estadoBien({ creditos: 2400, margen: 400 }) });
    const llamados: string[] = [];
    vi.stubGlobal("fetch", async (entrada: string | URL | Request, init?: RequestInit) => {
      llamados.push(String(entrada));
      return m.dep.fetch(entrada, init);
    });
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    await worker.scheduled({ scheduledTime: T0, cron: "*/10 * * * *" }, m.env, { waitUntil: () => undefined });
    expect(llamados).toEqual([`${PORTERO}/v1/patrocinio/estado`]);
    expect(m.correo.enviados).toHaveLength(1);
    expect((await m.memoria()).ultimaVuelta).toBe(new Date(T0).toISOString());
  });

  it("si la vuelta se cae por algo inesperado lo anota y deja que Cloudflare lo vea como falla", async () => {
    const registros: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: unknown) => void registros.push(String(l)));
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(estadoBien())));
    // Un entorno que revienta al tocarlo: algo que la vuelta no espera.
    const roto = new Proxy({}, { get: () => { throw new Error("entorno-roto"); } }) as never;
    await expect(worker.scheduled({ scheduledTime: T0, cron: "*/10 * * * *" }, roto, { waitUntil: () => undefined })).rejects.toThrow("entorno-roto");
    expect(registros.join("\n")).toContain("error-interno");
    vi.restoreAllMocks();
  });
});

describe("fetch: los pedidos", () => {
  it("GET / contesta con la hora de la última vuelta", async () => {
    const m = mundoFalso();
    await m.vuelta();
    const r = await worker.fetch(new Request("https://vigilante.tinkazo.app/"), m.env);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { salioBien: boolean }).salioBien).toBe(true);
  });

  it("POST /prueba usa el fetch del Worker para mirar al portero", async () => {
    const m = mundoFalso();
    const llamados: string[] = [];
    vi.stubGlobal("fetch", async (entrada: string | URL | Request, init?: RequestInit) => {
      llamados.push(String(entrada));
      return m.dep.fetch(entrada, init);
    });
    const r = await worker.fetch(new Request("https://vigilante.tinkazo.app/prueba", { method: "POST", headers: { Authorization: `Bearer ${CLAVE_DE_PRUEBA}` } }), m.env);
    expect(r.status).toBe(200);
    expect(llamados).toEqual([`${PORTERO}/v1/patrocinio/estado`]);
  });

  it("sin el KV conectado contesta como si no hubiera vuelta, sin detalles", async () => {
    const m = mundoFalso();
    const r = await worker.fetch(new Request("https://vigilante.tinkazo.app/"), { ...m.env, MEMORIA: undefined as never });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ servicio: "tinkazo-vigilante", ultimaVuelta: null, salioBien: false });
  });
});
