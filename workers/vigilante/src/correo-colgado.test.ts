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
    await pasar(CORREO_TIEMPO_MS + 2000);
    const r = await pedido;
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ correo: "error", codigo: "CORREO_TIEMPO" });
  });
});
