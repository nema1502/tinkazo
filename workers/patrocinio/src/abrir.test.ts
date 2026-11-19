// La segunda etapa de las altas: el servidor abre la cuenta de quien tiene acceso con `POST /v3/wallets/fund` (Pollar deja un
// pedido que la persona aprueba), por `POST /v1/alta/abrir`. Con un Pollar de mentira: ninguna prueba toca la red.
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { IP, SECRETO_POLLAR, T0, codigo, montarAltas, tokenDe } from "./altas-prueba";
import { leerConfig } from "./config";
import { Pollar } from "./pollar";
import { PorIp } from "./por-ip";
import { POLLAR_SERVIDOR } from "./servidores";
import { ESPERA_ABRIR_MS, atenderAlta } from "./rutas-altas";

const C1 = codigo(1);
const APP = "app_mainnet_inventada";
const G = Keypair.random().publicKey();

const resp = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function pollarCon(responder: (url: URL, init?: RequestInit) => Response) {
  const llamadas: Array<{ url: string; init: RequestInit | undefined }> = [];
  const anotado: Array<[string, unknown]> = [];
  const p = new Pollar({
    secreto: SECRETO_POLLAR,
    appId: APP,
    fetch: async (url, init) => (llamadas.push({ url, init }), responder(new URL(url), init)),
    reloj: () => T0,
    registrar: (e, d) => void anotado.push([e, d]),
  });
  return { p, llamadas, anotado };
}

describe("Pollar.abrir: POST /v3/wallets/fund", () => {
  it("manda la cuenta con la llave en x-pollar-api-key y un 202 es un pedido con su requestId", async () => {
    const { p, llamadas } = pollarCon(() => resp(202, { code: "SERVER_WALLET_ACCOUNT_REQUESTED", success: true, content: { publicKey: G, requestId: "req_123" } }));
    expect(await p.abrir(G)).toEqual({ ok: true, estado: "pedido", pedido: "req_123" });
    expect(llamadas).toHaveLength(1);
    const [l] = llamadas;
    expect(l?.url).toBe(`${POLLAR_SERVIDOR}/v3/wallets/fund`);
    expect(l?.init?.method).toBe("POST");
    expect(new Headers(l?.init?.headers).get("x-pollar-api-key")).toBe(SECRETO_POLLAR);
    expect(JSON.parse(String(l?.init?.body))).toEqual({ publicKey: G });
  });

  it("200 o 409 WALLET_ALREADY_FUNDED es abierta", async () => {
    expect(await pollarCon(() => resp(200, { code: "SERVER_WALLET_FUNDED", success: true, content: { publicKey: G, startingBalance: "0" } })).p.abrir(G)).toEqual({ ok: true, estado: "abierta" });
    expect(await pollarCon(() => resp(409, { code: "WALLET_ALREADY_FUNDED", success: false })).p.abrir(G)).toEqual({ ok: true, estado: "abierta" });
  });

  it("402 es sin créditos, 404 WALLET_NOT_FOUND es sin billetera, y lo demás es Pollar", async () => {
    expect(await pollarCon(() => resp(402, { code: "SDK_CREDITS_INSUFFICIENT", success: false })).p.abrir(G)).toEqual({ ok: false, motivo: "sin-creditos" });
    expect(await pollarCon(() => resp(404, { code: "WALLET_NOT_FOUND", success: false })).p.abrir(G)).toEqual({ ok: false, motivo: "sin-billetera" });
    for (const [s, code] of [
      [404, "APP_WALLET_NOT_FOUND"],
      [400, "TX_EXTERNAL_WALLET_SERVER_SIGN"],
      [403, "FORBIDDEN"],
      [502, "FUND_XLM_FAILED"],
      [500, "X"],
    ] as const) {
      const { p, anotado } = pollarCon(() => resp(s, { code, success: false }));
      expect(await p.abrir(G), `${s} ${code}`).toEqual({ ok: false, motivo: "pollar" });
      expect(anotado).toEqual([["error-pollar", { llamada: "fund", codigo: `${s}-${code}` }]]);
    }
  });

  it("un 202 sin requestId, con otra cuenta o sin success no se toma como pedido", async () => {
    const otra = Keypair.random().publicKey();
    for (const cuerpo of [
      { code: "SERVER_WALLET_ACCOUNT_REQUESTED", success: true, content: { publicKey: G } },
      { code: "SERVER_WALLET_ACCOUNT_REQUESTED", success: true, content: { publicKey: otra, requestId: "req_1" } },
      { code: "SERVER_WALLET_ACCOUNT_REQUESTED", success: true, content: { publicKey: G, requestId: "con espacios" } },
      { code: "OTRO", success: true, content: { publicKey: G, requestId: "req_1" } },
      { code: "SERVER_WALLET_ACCOUNT_REQUESTED", success: false, content: { publicKey: G, requestId: "req_1" } },
    ]) {
      expect(await pollarCon(() => resp(202, cuerpo)).p.abrir(G), JSON.stringify(cuerpo)).toEqual({ ok: false, motivo: "pollar" });
    }
  });

  it("una cuenta que no es una G válida no llama a nadie", async () => {
    const { p, llamadas } = pollarCon(() => resp(202, {}));
    expect(await p.abrir("GNOESUNACUENTA")).toEqual({ ok: false, motivo: "pollar" });
    expect(llamadas).toHaveLength(0);
  });

  it("Pollar que no contesta es Pollar, y la bitácora nunca lleva la cuenta ni la llave", async () => {
    const { p, anotado } = pollarCon(() => {
      throw new TypeError(`fallo ${G} ${SECRETO_POLLAR}`);
    });
    expect(await p.abrir(G)).toEqual({ ok: false, motivo: "pollar" });
    expect(JSON.stringify(anotado)).not.toContain(G);
    expect(JSON.stringify(anotado)).not.toContain(SECRETO_POLLAR);
  });
});

describe("POST /v1/alta/abrir", () => {
  const conCupon = async (env: Record<string, string> = { POLLAR_FONDEO: "diferido" }) => {
    const m = montarAltas(env);
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    return { m, ana };
  };

  it("con fondeo diferido y acceso: pide abrir la cuenta, guarda el pedido y sigue contando como alta sin activar", async () => {
    const { m, ana } = await conCupon();
    const piso = m.puerta.piso(m.hora());
    expect(await m.abrir(ana.token)).toEqual({ estado: 200, cuerpo: { estado: "pedido" } });
    expect(m.pm.fondeos).toEqual([{ publicKey: ana.cuenta }]);
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ estado: "pedida", pedido: `req_${(ana.cuenta as string).slice(1, 9)}` });
    expect(m.puerta.piso(m.hora())).toBe(piso);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { pedido: `req_${(ana.cuenta as string).slice(1, 9)}`, abierta: false } });
    // La bitácora dice qué pasó, nunca la cuenta, el pedido ni la persona.
    expect(m.anotado).toContainEqual(["alta-abrir", { resultado: "pedido" }]);
    expect(JSON.stringify(m.anotado)).not.toContain(ana.cuenta as string);
    expect(JSON.stringify(m.anotado)).not.toContain("usr_ana");
  });

  it("una vez por minuto por persona: antes, 429 espera sin llamar a Pollar", async () => {
    const { m, ana } = await conCupon();
    expect((await m.abrir(ana.token)).estado).toBe(200);
    const r = await m.abrir(ana.token);
    expect(r).toEqual({ estado: 429, cuerpo: { motivo: "espera", reintentarEn: T0 + ESPERA_ABRIR_MS } });
    expect(m.pm.fondeos).toHaveLength(1);
    m.mover(ESPERA_ABRIR_MS);
    expect(await m.abrir(ana.token)).toEqual({ estado: 200, cuerpo: { estado: "pedido" } });
    expect(m.pm.fondeos).toHaveLength(2);
    expect(ESPERA_ABRIR_MS).toBe(60_000);
  });

  it("sin acceso, 403 sin-acceso sin llamar a Pollar", async () => {
    const m = montarAltas({ POLLAR_FONDEO: "diferido" });
    const beto = m.persona("usr_beto");
    expect(await m.abrir(beto.token)).toEqual({ estado: 403, cuerpo: { motivo: "sin-acceso" } });
    expect(m.pm.fondeos).toHaveLength(0);
  });

  it("con acceso y sin billetera todavía, 409 sin-billetera sin llamar a wallets/fund", async () => {
    const m = montarAltas({ POLLAR_FONDEO: "diferido" });
    const eva = m.persona("usr_eva", null);
    await m.lote([C1]);
    await m.cupon(eva.token, C1);
    expect(await m.abrir(eva.token)).toEqual({ estado: 409, cuerpo: { motivo: "sin-billetera" } });
    expect(m.pm.fondeos).toHaveLength(0);
  });

  it("la cuenta ya existe en la red: abierta, sin llamar a Pollar, y deja de contar en el piso", async () => {
    const { m, ana } = await conCupon();
    const piso = m.puerta.piso(m.hora());
    m.abiertas.add(ana.cuenta as string);
    expect(await m.abrir(ana.token)).toEqual({ estado: 200, cuerpo: { estado: "abierta" } });
    expect(m.pm.fondeos).toHaveLength(0);
    expect(m.puerta.piso(m.hora())).toBe(piso - m.cfg.creditosPorAlta);
  });

  it("con fondeo inmediato no hace falta: no llama a wallets/fund", async () => {
    const { m, ana } = await conCupon({});
    expect(await m.abrir(ana.token)).toEqual({ estado: 200, cuerpo: { estado: "no-hace-falta" } });
    expect(m.pm.fondeos).toHaveLength(0);
  });

  it("Pollar dice que ya está abierta: abierta; sin créditos, 503; sin billetera, 409; otra cosa, 502", async () => {
    const casos: Array<[{ status: number; code: string }, unknown]> = [
      [{ status: 409, code: "WALLET_ALREADY_FUNDED" }, { estado: 200, cuerpo: { estado: "abierta" } }],
      [{ status: 402, code: "SDK_CREDITS_INSUFFICIENT" }, { estado: 503, cuerpo: { motivo: "sin-creditos" } }],
      [{ status: 404, code: "WALLET_NOT_FOUND" }, { estado: 409, cuerpo: { motivo: "sin-billetera" } }],
      [{ status: 502, code: "FUND_XLM_FAILED" }, { estado: 502, cuerpo: { motivo: "pollar" } }],
    ];
    for (const [respuesta, esperado] of casos) {
      const { m, ana } = await conCupon();
      m.pm.fondeo = () => respuesta;
      expect(await m.abrir(ana.token), respuesta.code).toEqual(esperado);
      // Un pedido que no salió no queda guardado.
      expect(m.cupos.altaDe("usr_ana")?.pedido).toBeNull();
    }
  });

  it("sin sesión, 401; con las altas apagadas, 503; y la cuenta sale de Pollar, nunca del cuerpo", async () => {
    const { m } = await conCupon();
    expect(await m.abrir(null)).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    expect(await m.abrir(tokenDe("usr_nadie"))).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    const otra = Keypair.random().publicKey();
    expect((await m.puerta.abrir({ token: tokenDe("usr_ana"), ip: IP, cuerpo: { cuenta: otra } })).estado).toBe(200);
    expect(m.pm.fondeos).not.toContainEqual({ publicKey: otra });
    const apagado = montarAltas({ ALTAS: "0", POLLAR_FONDEO: "diferido" });
    expect(await apagado.abrir(tokenDe("usr_ana"))).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
  });

  it("la puerta del Worker atiende /v1/alta/abrir solo en mainnet", async () => {
    const pedido = () => new Request("https://pm.tinkazo.app/v1/alta/abrir", { method: "POST", headers: { Origin: "https://tinkazo.app", "CF-Connecting-IP": IP, Authorization: "Bearer tok_abc" }, body: "{}" });
    const vistos: string[] = [];
    const llamar = async (accion: string) => (vistos.push(accion), { estado: 200, cuerpo: { estado: "pedido" } });
    const r = (await atenderAlta(pedido(), leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" }), llamar, new PorIp())) as Response;
    expect([r.status, await r.json()]).toEqual([200, { estado: "pedido" }]);
    expect(vistos).toEqual(["abrir"]);
    expect(await atenderAlta(pedido(), leerConfig({ RED: "testnet", ALTAS: "1" }), llamar, new PorIp())).toBeNull();
  });
});
