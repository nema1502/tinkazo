import { afterEach, describe, expect, it } from "vitest";
import { QUICKNET, roundTime } from "./protocol/quicknet";
import {
  IDA_Y_VUELTA_MAX_MS,
  PEDIR_ANTES_MS,
  RELAY_QUE_RETIENE,
  RETENIDO_SI_TARDA_MAS_MS,
  anclaDeLaRonda,
  anclaDeLaRondaUnaVez,
  anclaVirtual,
  desfaseDeLaRonda,
  horaDeLaRonda,
  medirElReloj,
  olvidarElReloj,
  salaALaParPorElAncla,
} from "./reloj-de-la-ronda";

/**
 * El reloj de la ronda (`reloj-de-la-ronda.ts`): cuándo nace un número, visto desde este aparato. Sin red: un servicio
 * de mentira que retiene el pedido de la ronda que todavía no nació, como hace el de Cloudflare, y relojes de mentira.
 */

const R = 32_254_977;
const NACE_MS = roundTime(R) * 1000;
const FIRMA = "ab".repeat(48);

/**
 * Un mundo de mentira: la hora de verdad (ms, la de la ronda), el reloj de pared del aparato (corrido `corrimiento`), el
 * reloj monótono (`performance.now`) y un servicio que tarda `ida` en recibir y `vuelta` en devolver. Un pedido de una
 * ronda que no nació espera a que nazca (más `aviso`, lo que tarda el servicio en enterarse); si faltan dos, 404.
 */
function mundo(o: { ida?: number; vuelta?: number; aviso?: number; corrimiento?: number; inicio?: number; latest?: number | null; mudo?: boolean } = {}) {
  const ida = o.ida ?? 40;
  const vuelta = o.vuelta ?? 40;
  const aviso = o.aviso ?? 80;
  let verdad = o.inicio ?? NACE_MS - 5_000;
  const pendientes: { at: number; fn: () => void }[] = [];
  const pedidos: { url: string; at: number }[] = [];
  const correr = (hasta: number): void => {
    for (;;) {
      pendientes.sort((a, b) => a.at - b.at);
      const p = pendientes[0];
      if (!p || p.at > hasta) break;
      pendientes.shift();
      verdad = Math.max(verdad, p.at);
      p.fn();
    }
    verdad = Math.max(verdad, hasta);
  };
  const dormir = (ms: number): Promise<void> => new Promise((r) => pendientes.push({ at: verdad + Math.max(0, ms), fn: r }));
  const nacidaHasta = (t: number): number => Math.floor((t / 1000 - QUICKNET.genesisTime) / QUICKNET.period) + 1;
  const fetchFn = ((url: string) => {
    pedidos.push({ url, at: verdad });
    return new Promise((resolve, reject) => {
      if (o.mudo) {
        pendientes.push({ at: verdad + ida + vuelta, fn: () => reject(new Error("red")) });
        return;
      }
      const llega = verdad + ida;
      const responder = (estado: number, cuerpo: unknown, en: number): void => {
        pendientes.push({ at: en + vuelta, fn: () => resolve({ ok: estado === 200, status: estado, json: async () => cuerpo } as Response) });
      };
      const m = /\/public\/(latest|\d+)$/.exec(url);
      pendientes.push({
        at: llega,
        fn: () => {
          const ahora = verdad;
          const ultima = nacidaHasta(ahora - aviso);
          if (m?.[1] === "latest") {
            responder(200, { round: o.latest ?? ultima, signature: FIRMA }, ahora);
            return;
          }
          const ronda = Number(m?.[1]);
          if (ronda <= ultima) responder(200, { round: ronda, signature: FIRMA }, ahora);
          else if (ronda === ultima + 1) responder(200, { round: ronda, signature: FIRMA }, roundTime(ronda) * 1000 + aviso);
          else responder(404, {}, ahora);
        },
      });
    });
  }) as unknown as typeof fetch;
  const corrimiento = o.corrimiento ?? 0;
  return {
    fetchFn,
    dormir,
    pedidos,
    /** El reloj monótono: la hora de verdad más una base cualquiera. */
    ahora: () => verdad + 123_456,
    /** El reloj de pared del aparato, en segundos. */
    pared: () => (verdad + corrimiento) / 1000,
    verdad: () => verdad,
    async esperar<T>(p: Promise<T>): Promise<T> {
      let listo = false;
      let valor: T | undefined;
      void p.then((v) => {
        listo = true;
        valor = v;
      });
      for (let i = 0; i < 400 && !listo; i++) {
        await Promise.resolve();
        await Promise.resolve();
        const proxima = pendientes.reduce((m, x) => Math.min(m, x.at), Infinity);
        if (proxima === Infinity) {
          await new Promise((r) => setTimeout(r, 0));
          continue;
        }
        correr(proxima);
        await new Promise((r) => setTimeout(r, 0));
      }
      return valor as T;
    },
  };
}

afterEach(() => olvidarElReloj());
// (olvidarElReloj también olvida las anclas pedidas.)

describe("el ancla: la llegada del propio pedido de la ronda", () => {
  it("el pedido sale un segundo y medio antes, espera el nacimiento y llega apenas después: retenido", async () => {
    const m = mundo();
    const a = await m.esperar(anclaDeLaRonda(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared }));
    expect(a).not.toBeNull();
    if (!a) return;
    expect(a.retenido).toBe(true);
    expect(a.firma).toBe(FIRMA);
    // Llegó después de nacer (nunca antes) y a lo sumo lo que tarda el servicio en enterarse y en volver.
    const llegadaVerdad = a.llegada - 123_456;
    expect(llegadaVerdad).toBeGreaterThanOrEqual(NACE_MS);
    expect(llegadaVerdad - NACE_MS).toBe(80 + 40);
    expect(a.idaYVuelta).toBe(80);
    // El pedido retenido salió 1,5 s antes; dos rondas viejas se pidieron justo antes, para medir la ida y vuelta.
    const retenido = m.pedidos.filter((p) => p.url.endsWith(`/public/${R}`));
    expect(retenido).toHaveLength(1);
    expect(NACE_MS - (retenido[0]?.at ?? 0)).toBeGreaterThanOrEqual(PEDIR_ANTES_MS - 100);
    expect(m.pedidos.every((p) => p.url.startsWith(RELAY_QUE_RETIENE))).toBe(true);
  });

  it("con el reloj atrasado el pedido sale tarde: llega en el acto y no queda como retenido, pero nunca antes de nacer", async () => {
    // El reloj del aparato dice 2,5 s menos que la verdad.
    const m = mundo({ corrimiento: -2_500 });
    const a = await m.esperar(anclaDeLaRonda(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared }));
    expect(a?.retenido).toBe(false);
    expect((a?.llegada ?? 0) - 123_456).toBeGreaterThanOrEqual(NACE_MS);
  });

  it("con el reloj adelantado el servicio contesta 404 (faltan dos rondas) y se vuelve a pedir hasta que retiene", async () => {
    const m = mundo({ corrimiento: 3_200 });
    const a = await m.esperar(anclaDeLaRonda(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared }));
    expect(a?.retenido).toBe(true);
    expect((a?.llegada ?? 0) - 123_456 - NACE_MS).toBe(120);
    expect(m.pedidos.filter((p) => p.url.endsWith(`/public/${R}`)).length).toBeGreaterThan(1);
  });

  it("una vuelta lenta no se toma por retenida: con 350 ms de ida y vuelta y la ronda ya nacida, llega en el acto", async () => {
    // El reloj atrasado medio segundo: el pedido sale con la ronda ya nacida y tarda solo su ida y vuelta.
    const m = mundo({ ida: 175, vuelta: 175, corrimiento: -2_000 });
    const a = await m.esperar(anclaDeLaRonda(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared }));
    expect(a?.idaYVuelta).toBe(350);
    expect(a?.retenido).toBe(false);
  });

  it("llama a fetch suelto, como pide el navegador: llamarlo como método de otro objeto lo rompe (Illegal invocation)", async () => {
    const m = mundo();
    let conOtroThis = 0;
    // El `fetch` del navegador falla si `this` es otro objeto: este hace lo mismo.
    const fetchDelNavegador = function (this: unknown, url: string) {
      if (this !== undefined && this !== globalThis) {
        conOtroThis++;
        return Promise.reject(new TypeError("Illegal invocation"));
      }
      return (m.fetchFn as unknown as (u: string) => Promise<Response>)(url);
    } as unknown as typeof fetch;
    const a = await m.esperar(anclaDeLaRonda(R, { fetchFn: fetchDelNavegador, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared }));
    expect(conOtroThis).toBe(0);
    expect(a?.retenido).toBe(true);
    const r = await m.esperar(medirElReloj({ fetchFn: fetchDelNavegador, dormir: m.dormir, ahora: m.ahora, pared: m.pared }));
    expect(conOtroThis).toBe(0);
    expect(r.comprobado).toBe(true);
  });

  it("una sola vez por ronda: la cuenta la pide temprano y el sorteo, que sale después (Rápido: medio segundo antes), recibe la misma", async () => {
    const m = mundo();
    const primera = anclaDeLaRondaUnaVez(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared });
    const segunda = anclaDeLaRondaUnaVez(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared });
    expect(segunda).toBe(primera);
    const a = await m.esperar(primera);
    expect(a?.retenido).toBe(true);
    expect(m.pedidos.filter((p) => p.url.endsWith(`/public/${R}`))).toHaveLength(1);
  });

  it("sin red no hay ancla: quien llama trae el número como siempre", async () => {
    const m = mundo({ mudo: true });
    const a = await m.esperar(anclaDeLaRonda(R, { fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, horaDeLaRonda: m.pared }));
    expect(a).toBeNull();
  });

  it("la sala va a la par por el ancla solo con el pedido retenido y una ida y vuelta corta", () => {
    const v = 1_000;
    expect(salaALaParPorElAncla({ llegada: v, retenido: true, idaYVuelta: 200, firma: null }, v)).toBe(true);
    expect(salaALaParPorElAncla({ llegada: v, retenido: true, idaYVuelta: IDA_Y_VUELTA_MAX_MS + 1, firma: null }, v)).toBe(false);
    expect(salaALaParPorElAncla({ llegada: v, retenido: false, idaYVuelta: 50, firma: null }, v)).toBe(false);
    expect(salaALaParPorElAncla({ llegada: v, retenido: true, idaYVuelta: null, firma: null }, v)).toBe(false);
    expect(salaALaParPorElAncla(null, v)).toBe(false);
    expect(RETENIDO_SI_TARDA_MAS_MS).toBe(300);
  });

  it("y solo si su número llegó cerca de su hora: un número que nace 1,8 s tarde no la deja a la par", async () => {
    // La sala midió su reloj con una ronda que nació a horario (`freeze.ts`, al abrir la cuenta): con ese piso sabe en
    // qué momento de su reloj monótono nace la ronda R, sin mirar su reloj de pared.
    const m = mundo({ inicio: NACE_MS - 20_000 });
    await m.esperar(medirElReloj({ fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, pared: m.pared }));
    const virtual = anclaVirtual(R);
    expect(virtual).not.toBeNull();
    const v = virtual ?? 0;
    const ancla = (tras: number) => ({ llegada: v + tras, retenido: true, idaYVuelta: 150, firma: FIRMA });
    // A horario: el pedido retenido llega con la ronda, a la par.
    expect(salaALaParPorElAncla(ancla(30), virtual)).toBe(true);
    // La ronda R llega al servicio 1,8 s tarde. El pedido de la sala también espera (retenido) y la ida y vuelta es corta,
    // pero llegó 1,8 s después de su hora: el celular, con su ancla virtual a horario, jugaría 0,6 s antes que ella.
    expect(salaALaParPorElAncla(ancla(1_800), virtual)).toBe(false);
    // Hasta la ida y vuelta más larga aceptada después de su hora, todavía a la par.
    expect(salaALaParPorElAncla(ancla(IDA_Y_VUELTA_MAX_MS), virtual)).toBe(true);
    expect(salaALaParPorElAncla(ancla(IDA_Y_VUELTA_MAX_MS + 1), virtual)).toBe(false);
    // Una llegada muy antes de su hora no puede ser: la medida no es de fiar (la compu durmió entre la medida y el sorteo).
    expect(salaALaParPorElAncla(ancla(-400), virtual)).toBe(false);
    // Sin el reloj medido con una ronda que nace no hay con qué compararla: tampoco va a la par. Con el reloj de pared
    // atrasado y sin medir, una respuesta lenta de una ronda ya nacida podía pasar por retenida.
    expect(salaALaParPorElAncla(ancla(30), null)).toBe(false);
  });
});

describe("la medida del reloj: una ronda que nace, vista desde acá", () => {
  it("corrige un reloj corrido con centésimas y deja un piso para la hora de la ronda", async () => {
    // El reloj del aparato adelanta 2,3 s, en el medio del período.
    const m = mundo({ corrimiento: 2_300, inicio: NACE_MS + 1_400 });
    const r = await m.esperar(medirElReloj({ fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, pared: m.pared }));
    expect(r.comprobado).toBe(true);
    // La medida dice lo que hay que sumarle al reloj del aparato: -2,3 s, con el aviso y la vuelta de error.
    expect(Math.abs(desfaseDeLaRonda() + 2.3)).toBeLessThan(0.15);
    expect(Math.abs(horaDeLaRonda(m.pared) - m.verdad() / 1000)).toBeLessThan(0.15);
    // El piso nunca pasa la hora de verdad: un ancla virtual para la ronda R cae a su hora o después.
    const virtual = anclaVirtual(R);
    expect(virtual).not.toBeNull();
    expect((virtual ?? 0) - 123_456).toBeGreaterThanOrEqual(NACE_MS);
  });

  it("si latest viene viejo (la caché de 2 s) y la siguiente ya nació, pasa a la que sigue", async () => {
    const m = mundo({ inicio: NACE_MS + 500, latest: R - 1 });
    const r = await m.esperar(medirElReloj({ fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, pared: m.pared }));
    expect(r.comprobado).toBe(true);
    expect(m.pedidos.some((p) => p.url.endsWith(`/public/${R + 1}`))).toBe(true);
    expect(Math.abs(desfaseDeLaRonda())).toBeLessThan(0.15);
  });

  it("sin red queda sin comprobar, con el desfase en cero y sin piso", async () => {
    const m = mundo({ mudo: true, corrimiento: 5_000 });
    const r = await m.esperar(medirElReloj({ fetchFn: m.fetchFn, dormir: m.dormir, ahora: m.ahora, pared: m.pared }));
    expect(r.comprobado).toBe(false);
    expect(desfaseDeLaRonda()).toBe(0);
    expect(anclaVirtual(R)).toBeNull();
  });
});
