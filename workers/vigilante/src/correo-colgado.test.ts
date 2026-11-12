// Un envío de correo que se cuelga no puede cortar la vuelta: tiene 15 segundos, y si vence queda pendiente como
// cualquier otra falla. El reloj es de mentira (timers falsos de Vitest): ninguna prueba espera de verdad.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORREO_TIEMPO_MS } from "./envio";
import { CLAVE_DE_PRUEBA, estadoBien, mundoFalso } from "./mundo-falso";

afterEach(() => vi.useRealTimers());

const creditosBajos = () => estadoBien({ creditos: 2400, piso: 2000, margen: 400 });
const colgado = () => new Promise<never>(() => undefined);

/** Deja pasar `ms` de tiempo falso de a un segundo, para que los pasos de la vuelta alcancen a armar su espera. */
async function pasar(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 1000) await vi.advanceTimersByTimeAsync(1000);
}

// La ruta de prueba comprueba su clave con cuentas que corren fuera del hilo y terminan en una vuelta de verdad del
// lazo, no en el reloj falso. Si el reloj falso avanza antes de que terminen, la espera del correo todavía no está
// armada y nadie la vence nunca. Por eso esa prueba cede de verdad entre un paso y otro: el temporizador se guarda
// acá, antes de que ninguna prueba ponga el reloj falso.
const esperarDeVerdad = (() => {
  const real = setTimeout;
  return (ms: number) => new Promise<void>((listo) => { real(listo, ms); });
})();

/** Avanza el reloj falso de a un segundo hasta que `p` termine, cediendo de verdad entre pasos. Dice cuánto reloj pasó. */
async function hastaQueTermine<T>(p: Promise<T>, topeMs: number): Promise<{ valor: T; pasoMs: number }> {
  const fin: { listo: boolean; valor?: T; error?: unknown } = { listo: false };
  p.then((valor) => { fin.valor = valor; fin.listo = true; }, (error: unknown) => { fin.error = error; fin.listo = true; });
  await esperarDeVerdad(20);
  let pasoMs = 0;
  while (!fin.listo && pasoMs < topeMs) {
    await vi.advanceTimersByTimeAsync(1000);
    pasoMs += 1000;
    await esperarDeVerdad(2);
  }
  if (!fin.listo) throw new Error(`el pedido no terminó en ${topeMs} ms de reloj falso`);
  if (fin.error !== undefined) throw fin.error;
  return { valor: fin.valor as T, pasoMs };
}

describe("el envío de correo tiene un tope", () => {
  it("son 15 segundos", () => {
    expect(CORREO_TIEMPO_MS).toBe(15_000);
  });

  it("un correo que se cuelga no corta la vuelta: termina, queda pendiente y lo anota", async () => {
    vi.useFakeTimers();
    const m = mundoFalso({ estado: creditosBajos() });
    m.correo.send = colgado;
    const vuelta = m.vuelta();
    await pasar(CORREO_TIEMPO_MS + 2000);
    const termino = await Promise.race([vuelta.then(() => "terminó"), Promise.resolve().then(() => "colgada")]);
    expect(termino).toBe("terminó");
    const r = await vuelta;
    expect(r.salioBien).toBe(false);
    const guardado = await m.memoria();
    expect(guardado.pendientes).toHaveLength(1);
    expect(guardado.pendientes[0]!.canales).toEqual(["correo"]);
    expect(guardado.claves).toEqual(["creditos-bajos"]);
    expect(m.registro.join("\n")).toContain('"evento":"error-envio"');
    expect(m.registro.join("\n")).toContain("CORREO_TIEMPO");
  });

  it("no corta antes de tiempo: un correo lento que contesta a los 10 segundos sale bien", async () => {
    vi.useFakeTimers();
    const m = mundoFalso({ estado: creditosBajos() });
    const enviar = m.correo.send.bind(m.correo);
    m.correo.send = (mensaje) => new Promise<{ messageId: string }>((resolver) => setTimeout(() => resolver(enviar(mensaje)), 10_000));
    const vuelta = m.vuelta();
    await pasar(12_000);
    const r = await vuelta;
    expect(r.salioBien).toBe(true);
    expect(m.correo.enviados).toHaveLength(1);
    expect((await m.memoria()).pendientes).toEqual([]);
  });

  it("la vuelta siguiente lo reintenta y sale una sola vez", async () => {
    vi.useFakeTimers();
    const m = mundoFalso({ estado: creditosBajos() });
    const enviar = m.correo.send.bind(m.correo);
    m.correo.send = colgado;
    const primera = m.vuelta();
    await pasar(CORREO_TIEMPO_MS + 2000);
    await primera;
    m.correo.send = enviar;
    const segunda = m.vueltaEn(10);
    await pasar(1000);
    const r = await segunda;
    expect(r.salioBien).toBe(true);
    expect(m.correo.avisos).toHaveLength(1);
    expect((await m.memoria()).pendientes).toEqual([]);
  });

  it("si el correo se cuelga, Telegram sale igual y solo falta el correo", async () => {
    vi.useFakeTimers();
    const m = mundoFalso({ estado: creditosBajos(), conTelegram: true });
    m.correo.send = colgado;
    const vuelta = m.vuelta();
    await pasar(CORREO_TIEMPO_MS + 2000);
    await vuelta;
    expect(m.telegram.llamadas).toHaveLength(1);
    expect((await m.memoria()).pendientes[0]!.canales).toEqual(["correo"]);
  });

  it("también corta el aviso de prueba de la ruta", async () => {
    vi.useFakeTimers();
    const { servir, olvidarPrueba } = await import("./publica");
    olvidarPrueba();
    const m = mundoFalso();
    m.correo.send = colgado;
    const pedido = servir(new Request("https://vigilante.tinkazo.app/prueba", { method: "POST", headers: { Authorization: `Bearer ${CLAVE_DE_PRUEBA}` } }), m.env, m.dep);
    const { valor: r, pasoMs } = await hastaQueTermine(pedido, CORREO_TIEMPO_MS + 8000);
    // Corta al vencer el tope del correo: ni antes ni mucho después.
    expect(pasoMs).toBeGreaterThanOrEqual(CORREO_TIEMPO_MS);
    expect(pasoMs).toBeLessThanOrEqual(CORREO_TIEMPO_MS + 4000);
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ correo: "error", codigo: "CORREO_TIEMPO" });
  });
});
