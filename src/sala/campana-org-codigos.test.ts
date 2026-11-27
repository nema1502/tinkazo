import { describe, expect, it } from "vitest";
import { type SalaDeCampana, codigosDeEntrega } from "./campana-org";

/**
 * El pedido de los códigos de entrega de una campaña de personas. La ruta, el token y cada respuesta se comprueban contra
 * lo que contesta la sala (200 con los códigos, 404 no-existe, 403 token, 409 no-es-de-personas y 409 fase). Con un
 * `fetch` de mentira, sin red ni reloj.
 */

const TOKEN = "T".repeat(22);
const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: TOKEN,
  clave: "C".repeat(22),
  vence: 1_900_000_000_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};

interface Llamada {
  metodo: string;
  url: string;
  auth: string | undefined;
  cache: RequestCache | undefined;
}
type Respuesta = Response | "caida";

function conFetch(respuestas: Respuesta[]): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({
      metodo: init?.method ?? "GET",
      url,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      cache: init?.cache,
    });
    const r = respuestas.shift();
    if (r === undefined || r === "caida") throw new Error("sin red");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Cache-Control": "no-store" } });

describe("los códigos de entrega que da la sala", () => {
  it("pide GET a la ruta de entrega con el token de la sala y devuelve los códigos en orden", async () => {
    const m = conFetch([json({ codigos: ["0421", "7310", "0007"] })]);
    expect(await codigosDeEntrega(SALA, { fetch: m.fetch })).toEqual(["0421", "7310", "0007"]);
    expect(m.llamadas).toEqual([
      { metodo: "GET", url: "https://s.tinkazo.app/v1/sala/AbCd1234/campana/entrega", auth: `Bearer ${TOKEN}`, cache: "no-store" },
    ]);
  });

  it("pide siempre sin cache: un código viejo guardado por el navegador nunca se entrega", async () => {
    const m = conFetch([json({ codigos: ["0421"] }), json({ error: "fase" }, 409)]);
    await codigosDeEntrega(SALA, { fetch: m.fetch });
    await codigosDeEntrega(SALA, { fetch: m.fetch });
    expect(m.llamadas.map((l) => l.cache)).toEqual(["no-store", "no-store"]);
  });

  it("cada motivo del contrato vuelve con su nombre", async () => {
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ error: "no-existe" }, 404)]).fetch })).toBe("no-existe");
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ error: "token" }, 403)]).fetch })).toBe("token");
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ error: "no-es-de-personas" }, 409)]).fetch })).toBe("no-es-de-personas");
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ error: "fase" }, 409)]).fetch })).toBe("fase");
  });

  it("un 409 con otro motivo es un rechazo, y un 500 o la red caída son red", async () => {
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ error: "otro" }, 409)]).fetch })).toBe("rechazo");
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ error: "sin-codigos" }, 500)]).fetch })).toBe("red");
    expect(await codigosDeEntrega(SALA, { fetch: conFetch(["caida"]).fetch })).toBe("red");
  });

  it("una respuesta buena que no cumple el contrato no sirve: es red", async () => {
    const mal: unknown[] = [
      { codigos: ["042"] },
      { codigos: ["04211"] },
      { codigos: ["04a1"] },
      { codigos: [421] },
      { codigos: ["0421", "0421"] },
      { codigos: [] },
      { codigos: "0421" },
      {},
      null,
    ];
    for (const cuerpo of mal) expect(await codigosDeEntrega(SALA, { fetch: conFetch([json(cuerpo)]).fetch })).toBe("red");
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([new Response("no es json", { status: 200 })]).fetch })).toBe("red");
  });

  it("un código con ceros a la izquierda se conserva como texto", async () => {
    expect(await codigosDeEntrega(SALA, { fetch: conFetch([json({ codigos: ["0000", "0100"] })]).fetch })).toEqual(["0000", "0100"]);
  });

  it("la señal de tiempo corta el pedido y cuenta como red", async () => {
    const f = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rechazar) => {
        init?.signal?.addEventListener("abort", () => rechazar(new Error("corte")));
      })) as unknown as typeof fetch;
    const control = new AbortController();
    const espera = codigosDeEntrega(SALA, { fetch: f, senal: () => control.signal });
    control.abort();
    expect(await espera).toBe("red");
  });
});
