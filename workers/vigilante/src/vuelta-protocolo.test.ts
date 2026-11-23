// El paso del protocolo y de los costos en el vigilante (issue 220), de punta a punta con la red de mentira: la línea
// base pedida al portero (sin llaves), el RPC de cada red simulado, el KV, el correo y Telegram de mentira. Nada toca
// una red de verdad, y nada cruza con la vuelta del portero: es un paso propio, al lado.
import { describe, expect, it } from "vitest";
import type { Dependencias, Entorno, Libro } from "./vuelta";
import { CLAVE_PROTOCOLO, RUTA_LINEA_BASE, pasoProtocolo } from "./vuelta-protocolo";

// ---------- las figuras: libro, correo, red ----------

const AHORA = Date.UTC(2026, 10, 20, 12, 0, 0);
const PORTERO = "https://pm.tinkazo.app";
const DESTINO = "dueno@example.org";
const BOT = "123456:token-inventado-del-bot";
const CHAT = "987654321";

class LibroFalso implements Libro {
  datos = new Map<string, string>();
  lecturas = 0;
  escrituras = 0;
  fallaLectura = false;
  fallaEscritura = false;
  async get(clave: string): Promise<string | null> {
    this.lecturas += 1;
    if (this.fallaLectura) throw new Error("kv-caido");
    return this.datos.get(clave) ?? null;
  }
  async put(clave: string, valor: string): Promise<void> {
    this.escrituras += 1;
    if (this.fallaEscritura) throw new Error("kv-caido");
    this.datos.set(clave, valor);
  }
}

class CorreoFalso {
  enviados: Array<{ subject: string; text: string; to: string[] }> = [];
  falla: string | null = null;
  async send(m: { subject: string; text: string; to: string[] }): Promise<{ messageId: string }> {
    if (this.falla) throw Object.assign(new Error(`falla del correo: ${this.falla}`), { code: this.falla });
    this.enviados.push(m);
    return { messageId: `id-${this.enviados.length}` };
  }
}

/** Los parámetros de la red de mentira: lo mismo que espera la línea base de mentira, en las dos redes. */
const PARAMETROS = {
  contract_ledger_cost_v0: { fee_write_ledger_entry: "1250", fee_disk_read1_kb: "223" },
  state_archival: { max_entry_ttl: 3110400 },
};
const lineaBaseDeMentira = (protocolo = 29) => ({
  version: 1,
  updated: "2026-11-20T00:00:00.000Z",
  networks: { testnet: { params: { protocol_version: protocolo, ...PARAMETROS } }, mainnet: { params: { protocol_version: 29, ...PARAMETROS } } },
});

interface Encendido {
  /** Qué contesta la ruta de la línea base. Por omisión, la de mentira. */
  base?: unknown;
  /** La ruta no contesta ("corte") o contesta con ese código. */
  fallaBase?: "corte" | number;
  /** Cómo queda cada red al leerla: su protocolo y parámetros que reemplazan a los de siempre. */
  porRed?: Partial<Record<"testnet" | "mainnet", { protocolo?: number; extras?: Record<string, unknown> }>>;
  /** El RPC no contesta ("corte"). */
  fallaRpc?: boolean;
  fallaCorreo?: string | null;
  fallaTelegram?: boolean;
  /** Sin AVISAR_A ni binding: no hay por dónde avisar. */
  sinCanales?: boolean;
  conTelegram?: boolean;
  fallaLectura?: boolean;
  fallaEscritura?: boolean;
}

function mundo(o: Encendido = {}) {
  const libro = new LibroFalso();
  libro.fallaLectura = o.fallaLectura === true;
  libro.fallaEscritura = o.fallaEscritura === true;
  const correo = new CorreoFalso();
  correo.falla = o.fallaCorreo ?? null;
  const pedidos: Array<{ url: string; init?: RequestInit }> = [];
  const telegram: string[] = [];

  const fetchFalso = async (url: string | URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    pedidos.push({ url: String(url), init });
    const laUrl = String(url);
    if (laUrl.includes("api.telegram.org/bot")) {
      if (o.fallaTelegram) return new Response("no", { status: 500 });
      const cuerpo = (await new Response(init?.body).json()) as { text: string };
      telegram.push(cuerpo.text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (laUrl.includes(RUTA_LINEA_BASE)) {
      if (o.fallaBase === "corte") throw new Error("corte con la línea base");
      if (typeof o.fallaBase === "number") return new Response("no", { status: o.fallaBase });
      return new Response(JSON.stringify(o.base ?? lineaBaseDeMentira()), { status: 200 });
    }
    // El RPC: JSON-RPC para las dos redes, con los parámetros de la red que toca.
    if (o.fallaRpc) throw new Error("corte de red de mentira");
    const pedido = JSON.parse(String(init?.body)) as { method: string };
    const redPedido = laUrl.includes("soroban-testnet") ? "testnet" : "mainnet";
    const conf = o.porRed?.[redPedido as "testnet" | "mainnet"] ?? {};
    const protocolo = conf.protocolo ?? 29;
    const valores = { ...PARAMETROS, ...(conf.extras ?? {}) };
    if (pedido.method === "getLatestLedger") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sequence: 900, protocolVersion: protocolo, closeTime: 1000 } }), { status: 200 });
    }
    if (pedido.method === "getLedgerEntries") {
      const entradas = Object.entries(valores).map(([nombre, valor]) => ({
        keyJson: { config_setting: { config_setting_id: nombre } },
        dataJson: { config_setting: { [nombre]: valor } },
        lastModifiedLedgerSeq: 899,
      }));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { entries: entradas } }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "método desconocido" } }), { status: 200 });
  };

  const registros: string[] = [];
  const env: Entorno = {
    MEMORIA: libro,
    PORTERO_URL: PORTERO,
    ...(o.sinCanales ? {} : { CORREO: correo, AVISAR_A: DESTINO }),
    ...(o.conTelegram ? { TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_CHAT_ID: CHAT } : {}),
  };
  let corriendo = AHORA;
  const dep: Dependencias = {
    fetch: fetchFalso,
    ahora: () => corriendo,
    registrar: (evento, datos) => registros.push(`${evento} ${JSON.stringify(datos ?? {})}`),
  };
  const rpcLlamados = () => pedidos.filter((p) => !p.url.includes(RUTA_LINEA_BASE) && !p.url.includes("api.telegram.org")).length;
  const avisadoEn = () => JSON.parse(libro.datos.get(CLAVE_PROTOCOLO) ?? "{}");
  return {
    env,
    dep,
    libro,
    correo,
    pedidos,
    registros,
    telegram,
    rpcLlamados,
    avisadoEn,
    avanzar: (ms: number) => {
      corriendo += ms;
    },
    paso: () => pasoProtocolo(env, dep, { dormir: () => Promise.resolve() }),
  };
}

// ---------- el paso completo ----------

describe("el paso del protocolo con todo en orden", () => {
  it("le pide la línea base al portero sin ninguna llave, mira las dos redes y no avisa nada ni escribe el KV", async () => {
    const m = mundo();
    await m.paso();
    const base = m.pedidos.find((p) => p.url.includes(RUTA_LINEA_BASE))!;
    const cabeceras = (base.init?.headers ?? {}) as Record<string, unknown>;
    expect(Object.keys(cabeceras).some((h) => h.toLowerCase() === "authorization")).toBe(false);
    // El RPC: dos redes, dos pedidos chicos cada una (el ledger nuevo y los ajustes).
    expect(m.rpcLlamados()).toBe(4);
    expect(m.correo.enviados).toEqual([]);
    expect(m.libro.datos.has(CLAVE_PROTOCOLO)).toBe(false);
    // Y la ronda queda anotada, con lo que se miró.
    expect(m.registros).toContain(`protocolo ${JSON.stringify({ avisos: 0, errores: 0 })}`);
  });

  it("la línea base no responde: no se pide nada a la red y no se marca nada por avisado", async () => {
    const m = mundo({ fallaBase: 500, porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.registros.join("\n")).toContain("protocolo-sin-base");
    expect(m.rpcLlamados()).toBe(0);
    expect(m.correo.enviados).toEqual([]);
    expect(m.libro.datos.has(CLAVE_PROTOCOLO)).toBe(false);
    // Cambia lo dado de la base por un corte: lo mismo.
    const m2 = mundo({ fallaBase: "corte" });
    await m2.paso();
    expect(m2.registros.join("\n")).toContain("protocolo-sin-base");
    expect(m2.rpcLlamados()).toBe(0);
  });

  it("sin canales para avisar, el paso no pide nada y termina", async () => {
    const m = mundo({ sinCanales: true, porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.registros.join("\n")).toContain("protocolo");
    expect(m.pedidos).toEqual([]);
    expect(m.correo.enviados).toEqual([]);
    expect(m.libro.datos.has(CLAVE_PROTOCOLO)).toBe(false);
  });

  it("el KV no se puede leer: no se sabe qué ya se avisó, así que no se pide nada y no se avisa nada", async () => {
    const m = mundo({ fallaLectura: true, porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.registros.join("\n")).toContain("error-kv");
    expect(m.rpcLlamados()).toBe(0);
    expect(m.correo.enviados).toEqual([]);
    expect(m.libro.escrituras).toBe(0);
  });
});

describe("los cambios de la red", () => {
  it("un protocolo nuevo avisa por correo una sola vez: la vuelta siguiente, con lo mismo, no repite", async () => {
    const m = mundo({ porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
    const aviso = m.correo.enviados[0]!;
    expect(aviso.to).toEqual([DESTINO]);
    expect(aviso.subject).toMatch(/cambió de protocolo/);
    expect(aviso.subject).toContain("testnet");
    expect(aviso.text).toContain("protocol_version");
    expect(aviso.text).toContain("29");
    expect(aviso.text).toContain("30");
    expect(aviso.text).toContain("--actualizar-base --red testnet");
    // Lo avisado queda anotado en su propia entrada del KV, sin tocar la memoria de la vuelta.
    expect(m.libro.datos.has("memoria")).toBe(false);
    expect(m.avisadoEn().el.testnet).toBeDefined();
    // La misma red, el mismo protocolo: nada.
    await m.avanzar(600_000);
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("un costo que cambia avisa por correo una sola vez, con el nombre del parámetro y el antes y el ahora", async () => {
    const m = mundo({ porRed: { mainnet: { extras: { contract_ledger_cost_v0: { fee_write_ledger_entry: "2000", fee_disk_read1_kb: "223" } } } } });
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
    const aviso = m.correo.enviados[0]!;
    expect(aviso.subject).toMatch(/cambió los costos/);
    expect(aviso.subject).toContain("mainnet");
    expect(aviso.text).toContain("contract_ledger_cost_v0");
    expect(aviso.text).toContain("1250");
    expect(aviso.text).toContain("2000");
    await m.avanzar(600_000);
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
  });

  it("el aviso sale también por Telegram, una vez por red que cambió", async () => {
    const m = mundo({ conTelegram: true, porRed: { testnet: { protocolo: 30 }, mainnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.correo.enviados).toHaveLength(2);
    expect(m.correo.enviados.map((a) => a.subject).map((a) => (a.includes("testnet") ? "testnet" : "mainnet")).sort()).toEqual(["mainnet", "testnet"]);
    expect(m.telegram).toHaveLength(2);
    expect(m.telegram[0]).toContain("protocol_version");
  });

  it("con la red caída dice por qué no pudo leer, no avisa cambio, y la vuelta siguiente (regresada la red) avisa", async () => {
    const m = mundo({ fallaRpc: true, porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.correo.enviados).toEqual([]);
    const fallado = m.registros.join("\n");
    expect(fallado).toContain("protocolo-sin-red");
    expect(fallado).toContain("testnet");
    expect(fallado).toContain("corte de red de mentira");
    expect(fallado).toContain("getLatestLedger");
    expect(m.libro.datos.has(CLAVE_PROTOCOLO)).toBe(false);
    // La red vuelve y esta vez cambiada: el aviso sale como nuevo, porque nada se avisó.
    const m2 = mundo({ porRed: { testnet: { protocolo: 30 } } });
    m2.libro.datos.set(CLAVE_PROTOCOLO, m.libro.datos.get(CLAVE_PROTOCOLO) ?? "{}");
    await m2.paso();
    expect(m2.correo.enviados).toHaveLength(1);
  });

  it("con el correo caído, el aviso no se da por avisado y sale de vuelta en la corrida siguiente", async () => {
    const m = mundo({ fallaCorreo: "SIN_TELEGRAM", porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.correo.enviados).toEqual([]);
    expect(m.registros.join("\n")).toContain("error-envio");
    expect(m.libro.datos.has(CLAVE_PROTOCOLO)).toBe(false);
    m.correo.falla = null;
    await m.avanzar(600_000);
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.correo.enviados[0]!.subject).toMatch(/cambió de protocolo/);
  });

  it("con telegram caído y el correo bien, el aviso se repite en la vuelta siguiente (mejor repetido que perdido)", async () => {
    const m = mundo({ conTelegram: true, fallaTelegram: true, porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.libro.datos.has(CLAVE_PROTOCOLO)).toBe(false);
    await m.avanzar(600_000);
    await m.paso();
    expect(m.correo.enviados).toHaveLength(2);
  });

  it("la red vuelve a lo que ya se avisó y no se repite nada: una vez por cambio", async () => {
    const cambia = mundo({ porRed: { testnet: { protocolo: 30 } } });
    await cambia.paso();
    expect(cambia.correo.enviados).toHaveLength(1);
    // El RPC se atrasa y contesta lo viejo (protocolo 29, igual a la base): sin aviso, y lo avisado queda.
    const atrasado = mundo({ porRed: {} });
    atrasado.libro.datos.set(CLAVE_PROTOCOLO, cambia.libro.datos.get(CLAVE_PROTOCOLO) ?? "{}");
    await atrasado.paso();
    expect(atrasado.correo.enviados).toEqual([]);
    expect(atrasado.avisadoEn().el.testnet).toEqual(cambia.avisadoEn().el.testnet);
  });

  it("el KV no se puede escribir donde se marca lo avisado: queda anotado y el aviso se repite", async () => {
    const m = mundo({ fallaEscritura: true, porRed: { testnet: { protocolo: 30 } } });
    await m.paso();
    expect(m.correo.enviados).toHaveLength(1);
    expect(m.registros.join("\n")).toContain("error-kv");
    await m.avanzar(600_000);
    await m.paso();
    // Mejor un aviso repetido que uno perdido: sale otra vez.
    expect(m.correo.enviados).toHaveLength(2);
  });
});
