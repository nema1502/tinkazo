import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { type HorizonFalso, type OpcionesDelHorizonFalso, type PagoFalso, horizonFalso } from "./horizon-falso";
import { PorIp } from "./por-ip";
import { DIA_MS, cuentaVacia, memoDePlan } from "./reglas";
import { type Dependencias, type Entorno, type Libro, PLAN_CACHE_S, PLAN_POR_HORA, servir } from "./servidor";

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const PLANES = Keypair.random().publicKey();
const TOKEN = "token-de-quien-organiza-0123456789";
const OTRO_TOKEN = "otro-token-que-no-es-de-nadie-9876";
const SITIO = "https://tinkazo.app";
const HOY = 1_790_000_000_000;

const sha256Hex = async (t: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");

class LibroFalso implements Libro {
  datos = new Map<string, string>();
  escrituras = 0;
  async get(k: string): Promise<string | null> {
    return this.datos.get(k) ?? null;
  }
  async put(k: string, v: string): Promise<void> {
    this.escrituras++;
    this.datos.set(k, v);
  }
}

interface Mundo {
  libro: LibroFalso;
  env: Entorno;
  dep: Dependencias;
  horizon: HorizonFalso;
  reloj: { ahora: number };
  pedir: (ruta: string, init?: { metodo?: string; cuerpo?: unknown; origen?: string | null; token?: string; ip?: string; crudo?: string }) => Promise<Response>;
  /** Lo que hay guardado de una cuenta. */
  guardada: (cuenta: string) => ReturnType<typeof JSON.parse> | null;
  poner: (cuenta: string, datos: object) => void;
}

async function mundo(o: { horizon?: OpcionesDelHorizonFalso; env?: Partial<Entorno> } = {}): Promise<Mundo> {
  const libro = new LibroFalso();
  const horizon = horizonFalso({ cuentas: [YO, OTRA], ...o.horizon });
  const reloj = { ahora: HOY };
  const env: Entorno = {
    CUENTAS: libro,
    RED: "testnet",
    CUENTA_PLANES: PLANES,
    HUELLAS_ORGANIZADORES: await sha256Hex(TOKEN),
    ...o.env,
  };
  const dep: Dependencias = { fetch: horizon.fetch, ahora: () => reloj.ahora, leer: new PorIp(), escribir: new PorIp(), canjes: new PorIp(), planes: new PorIp() };
  const pedir: Mundo["pedir"] = (ruta, init = {}) => {
    const { metodo = init.cuerpo !== undefined || init.crudo !== undefined ? "POST" : "GET", cuerpo, origen = SITIO, token, ip = "1.2.3.4", crudo } = init;
    const h = new Headers({ "CF-Connecting-IP": ip });
    if (origen) h.set("Origin", origen);
    if (token) h.set("Authorization", `Bearer ${token}`);
    let body: string | undefined;
    if (metodo === "POST") {
      body = crudo ?? JSON.stringify(cuerpo ?? {});
      h.set("Content-Length", String(new TextEncoder().encode(body).length));
      h.set("Content-Type", "application/json");
    }
    return servir(new Request(`https://cuenta.tinkazo.app${ruta}`, { method: metodo, headers: h, ...(body !== undefined ? { body } : {}) }), env, dep);
  };
  return {
    libro,
    env,
    dep,
    horizon,
    reloj,
    pedir,
    guardada: (c) => {
      const x = libro.datos.get(`c:${c}`);
      return x ? JSON.parse(x) : null;
    },
    poner: (c, datos) => void libro.datos.set(`c:${c}`, JSON.stringify({ ...cuentaVacia(), ...datos })),
  };
}

const pago = (extra: Partial<PagoFalso> = {}): PagoFalso => ({ de: OTRA, a: YO, monto: "5.0000000", tx: "a".repeat(64), ...extra });
const cuerpoDe = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

describe("la puerta", () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await mundo();
  });

  it("solo habla con el sitio, las vistas de Vercel y localhost", async () => {
    for (const origen of [SITIO, "https://www.tinkazo.app", "https://tinkazo-git-rama-x.vercel.app", "http://localhost:5173"]) {
      expect((await m.pedir(`/v1/monedas/${YO}`, { origen })).status, origen).toBe(200);
    }
    for (const origen of ["https://evil.example", "https://tinkazo.app.evil.com", "http://tinkazo.app", null]) {
      expect((await m.pedir(`/v1/monedas/${YO}`, { origen })).status, String(origen)).toBe(403);
    }
  });

  it("contesta la consulta previa del navegador con el origen permitido", async () => {
    const r = await m.pedir(`/v1/monedas/${YO}/evento`, { metodo: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(SITIO);
    expect(r.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    const ajeno = await m.pedir(`/v1/monedas/${YO}/evento`, { metodo: "OPTIONS", origen: "https://evil.example" });
    expect(ajeno.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rechaza una cuenta que no es una cuenta, y las rutas que no existen", async () => {
    expect((await m.pedir("/v1/monedas/hola")).status).toBe(400);
    expect((await m.pedir(`/v1/monedas/${YO.toLowerCase()}`)).status).toBe(400);
    expect((await m.pedir(`/v1/otra/${YO}`)).status).toBe(404);
    expect((await m.pedir("/v1/monedas")).status).toBe(404);
    expect((await m.pedir(`/v1/monedas/${YO}/regalar`, { cuerpo: {} })).status).toBe(404);
    expect((await m.pedir(`/v1/monedas/${YO}`, { metodo: "POST", cuerpo: {} })).status).toBe(405);
  });

  it("no guarda en ningún caché", async () => {
    expect((await m.pedir(`/v1/monedas/${YO}`)).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("leer una cuenta", () => {
  it("una cuenta nueva tiene cero monedas, el catálogo de siempre, y leerla no escribe nada", async () => {
    const m = await mundo();
    const r = await m.pedir(`/v1/monedas/${YO}`);
    expect(r.status).toBe(200);
    const c = await cuerpoDe(r);
    expect(c).toMatchObject({ cuenta: YO, saldo: 0, hechos: {}, historial: [], canjes: [], plan: null });
    expect((c.catalogo as { codigo: string; costo: number }[]).map((x) => [x.codigo, x.costo])).toEqual([
      ["chocolate", 20],
      ["stickers", 50],
      ["logo-en-el-show", 100],
      ["nombre-en-el-cartel", 200],
    ]);
    expect(m.libro.escrituras).toBe(0);
  });

  it("el catálogo sale de la variable CANJES", async () => {
    const m = await mundo({ env: { CANJES: JSON.stringify([{ codigo: "taza", es: "Una taza", en: "A mug", costo: 30 }]) } });
    const c = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}`));
    expect(c.catalogo).toEqual([{ codigo: "taza", es: "Una taza", en: "A mug", costo: 30 }]);
  });

  it("corta al pasar el tope por dirección", async () => {
    const m = await mundo();
    for (let i = 0; i < 240; i++) expect((await m.pedir(`/v1/monedas/${YO}`)).status).toBe(200);
    const r = await m.pedir(`/v1/monedas/${YO}`);
    expect(r.status).toBe(429);
    expect((await m.pedir(`/v1/monedas/${YO}`, { ip: "9.9.9.9" })).status).toBe(200);
  });
});

describe("ganar monedas", () => {
  it("el primer sorteo suma 20 una sola vez", async () => {
    const m = await mundo();
    const uno = await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primer_sorteo" } });
    expect(uno.status).toBe(200);
    expect(await cuerpoDe(uno)).toEqual({ acreditado: true, monedas: 20, saldo: 20 });
    const dos = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primer_sorteo" } }));
    expect(dos).toEqual({ acreditado: false, motivo: "ya", saldo: 20 });
    expect(m.guardada(YO)).toMatchObject({ saldo: 20, hechos: { primer_sorteo: 1 } });
    expect(m.libro.escrituras).toBe(1);
  });

  it("comprobar suma 5 hasta cinco veces, y el mismo resultado no suma dos veces", async () => {
    const m = await mundo();
    const e = (ref?: string) => m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "comprobar", ...(ref ? { ref } : {}) } });
    expect(await cuerpoDe(await e("testnet:1"))).toMatchObject({ acreditado: true, saldo: 5 });
    expect(await cuerpoDe(await e("testnet:1"))).toMatchObject({ acreditado: false, motivo: "ya", saldo: 5 });
    for (const n of [2, 3, 4, 5]) expect(await cuerpoDe(await e(`testnet:${n}`))).toMatchObject({ acreditado: true });
    expect(await cuerpoDe(await e("testnet:6"))).toMatchObject({ acreditado: false, motivo: "tope", saldo: 25 });
  });

  it("solo se piden las reglas abiertas: el plan, invitar y las que no existen no", async () => {
    const m = await mundo();
    for (const tipo of ["plan", "invitar", "registro", "sorteo", "", 5, null]) {
      const r = await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo } });
      expect(r.status, String(tipo)).toBe(400);
      expect(await cuerpoDe(r)).toEqual({ error: "tipo" });
    }
    expect(m.libro.escrituras).toBe(0);
  });

  it("no acepta una referencia rara ni un cuerpo roto ni uno enorme", async () => {
    const m = await mundo();
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "comprobar", ref: "con espacios" } })).status).toBe(400);
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "comprobar", ref: 5 } })).status).toBe(400);
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { crudo: "{" })).status).toBe(400);
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { crudo: "[1]" })).status).toBe(400);
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { crudo: JSON.stringify({ tipo: "comprobar", x: "y".repeat(600) }) })).status).toBe(413);
  });

  it("una cuenta que no existe en la red no suma", async () => {
    const m = await mundo({ horizon: { cuentas: [] } });
    const r = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primer_sorteo" } }));
    expect(r).toEqual({ acreditado: false, motivo: "sin-cuenta", saldo: 0 });
    expect(m.libro.escrituras).toBe(0);
  });

  it("con Horizon caído no suma ni inventa", async () => {
    const m = await mundo({ horizon: { caido: true } });
    const r = await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primer_sorteo" } });
    expect(r.status).toBe(502);
    expect(m.libro.escrituras).toBe(0);
  });

  it("corta al pasar el tope de escrituras por dirección", async () => {
    const m = await mundo();
    for (let i = 0; i < 60; i++) await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "comprobar", ref: `r${i}` } });
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "comprobar", ref: "otra" } })).status).toBe(429);
  });
});

describe("la primera carga se comprueba en la red", () => {
  it("sin pago no suma, por más que el navegador diga que cargó", async () => {
    const m = await mundo();
    const r = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primera_carga", pagado: true, monto: "100" } }));
    expect(r).toEqual({ acreditado: false, motivo: "sin-pago", saldo: 0 });
    expect(m.libro.escrituras).toBe(0);
  });

  it("con un pago de USDC de 1 o más suma 50, y no una segunda vez", async () => {
    const m = await mundo({ horizon: { pagos: { [YO]: [pago()] } } });
    const uno = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primera_carga" } }));
    expect(uno).toEqual({ acreditado: true, monedas: 50, saldo: 50 });
    const dos = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primera_carga" } }));
    expect(dos).toEqual({ acreditado: false, motivo: "ya", saldo: 50 });
    // La segunda vez ni le preguntó a la red.
    expect(m.horizon.pedidos).toHaveLength(1);
  });

  it("un pago de menos de 1 USDC, de un premio de Tinkazo o de otro emisor no cuenta", async () => {
    for (const p of [pago({ monto: "0.5000000" }), pago({ memo: "tk:premio:3:0" }), pago({ emisor: Keypair.random().publicKey() })]) {
      const m = await mundo({ horizon: { pagos: { [YO]: [p] } } });
      const r = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primera_carga" } }));
      expect(r).toMatchObject({ acreditado: false, motivo: "sin-pago" });
    }
  });

  it("con Horizon caído da error y no suma", async () => {
    const m = await mundo({ horizon: { caido: true } });
    expect((await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primera_carga" } })).status).toBe(502);
    expect(m.libro.escrituras).toBe(0);
  });

  it("lee la red de la variable RED", async () => {
    const m = await mundo({ env: { RED: "mainnet" }, horizon: { red: "mainnet", pagos: { [YO]: [pago()] } } });
    expect(await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/evento`, { cuerpo: { tipo: "primera_carga" } }))).toMatchObject({ acreditado: true });
    expect(m.horizon.pedidos[0]).toContain("https://horizon.stellar.org/");
  });
});

describe("la tiendita: el canje", () => {
  it("sin huellas cargadas en el Worker no hay canjes", async () => {
    const m = await mundo({ env: { HUELLAS_ORGANIZADORES: "" } });
    m.poner(YO, { saldo: 100 });
    const r = await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" }, token: TOKEN });
    expect(r.status).toBe(503);
    expect(m.guardada(YO).saldo).toBe(100);
  });

  it("el navegador de quien participa, sin token o con uno que no es, no canjea", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 100 });
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" } })).status).toBe(401);
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" }, token: OTRO_TOKEN })).status).toBe(403);
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" }, token: "corto" })).status).toBe(403);
    // La huella no es un token: mandar la huella tampoco sirve.
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" }, token: await sha256Hex(TOKEN) })).status).toBe(403);
    expect(m.guardada(YO).saldo).toBe(100);
  });

  it("quien organiza canjea: descuenta, anota con la hora y el historial lo muestra", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 70 });
    m.reloj.ahora = HOY + 5000;
    const r = await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate", id: "stand-0001-abcdef" }, token: TOKEN });
    expect(r.status).toBe(200);
    expect(await cuerpoDe(r)).toEqual({ ok: true, repetido: false, canje: { codigo: "chocolate", costo: 20, ms: HOY + 5000 }, saldo: 50 });
    const vista = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}`));
    expect(vista.saldo).toBe(50);
    expect(vista.canjes).toEqual([{ codigo: "chocolate", costo: 20, ms: HOY + 5000 }]);
    expect(vista.historial).toEqual([{ tipo: "canje:chocolate", monedas: -20, ms: HOY + 5000 }]);
  });

  it("sin monedas suficientes responde 409 con lo que falta y no descuenta", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 12 });
    const r = await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" }, token: TOKEN });
    expect(r.status).toBe(409);
    expect(await cuerpoDe(r)).toEqual({ error: "saldo", saldo: 12, falta: 8 });
    expect(m.guardada(YO).saldo).toBe(12);
    // Una cuenta que nunca tuvo nada también: falta todo.
    const nueva = await m.pedir(`/v1/monedas/${OTRA}/canje`, { cuerpo: { codigo: "stickers" }, token: TOKEN });
    expect(await cuerpoDe(nueva)).toEqual({ error: "saldo", saldo: 0, falta: 50 });
    expect(m.guardada(OTRA)).toBeNull();
  });

  it("repetir el mismo identificador no descuenta dos veces", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 100 });
    const pedir = () => m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate", id: "stand-0001-abcdef" }, token: TOKEN });
    expect(await cuerpoDe(await pedir())).toMatchObject({ ok: true, repetido: false, saldo: 80 });
    expect(await cuerpoDe(await pedir())).toMatchObject({ ok: true, repetido: true, saldo: 80 });
    expect(m.guardada(YO).saldo).toBe(80);
    expect(m.guardada(YO).canjes).toHaveLength(1);
    // Con otro identificador es otro canje.
    expect(await cuerpoDe(await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate", id: "stand-0002-abcdef" }, token: TOKEN }))).toMatchObject({ saldo: 60 });
  });

  it("un código que no está en la tiendita, o un identificador raro, no canjean", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 1000 });
    for (const codigo of ["una-chance", "chances", "", undefined, 5]) {
      expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo }, token: TOKEN })).status, String(codigo)).toBe(400);
    }
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate", id: "corto" }, token: TOKEN })).status).toBe(400);
    expect(m.guardada(YO).saldo).toBe(1000);
  });

  it("acepta varios organizadores y usa los canjes de la variable", async () => {
    const m = await mundo({
      env: {
        HUELLAS_ORGANIZADORES: `${await sha256Hex(OTRO_TOKEN)}, ${await sha256Hex(TOKEN)}`,
        CANJES: JSON.stringify([{ codigo: "taza", es: "Una taza", en: "A mug", costo: 30 }]),
      },
    });
    m.poner(YO, { saldo: 100 });
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "taza" }, token: OTRO_TOKEN })).status).toBe(200);
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "taza" }, token: TOKEN })).status).toBe(200);
    expect(m.guardada(YO).saldo).toBe(40);
    expect((await m.pedir(`/v1/monedas/${YO}/canje`, { cuerpo: { codigo: "chocolate" }, token: TOKEN })).status).toBe(400);
  });

  it("no hay ningún camino para comprar monedas, pasarlas a otra cuenta o comprar chances", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 500 });
    for (const accion of ["comprar", "transferir", "regalar", "chances", "retirar"]) {
      expect((await m.pedir(`/v1/monedas/${YO}/${accion}`, { cuerpo: { cantidad: 100, a: OTRA }, token: TOKEN })).status, accion).toBe(404);
    }
    expect(m.guardada(YO).saldo).toBe(500);
    expect(m.guardada(OTRA)).toBeNull();
  });
});

describe("el plan del equipo", () => {
  const pagoDePlan = (extra: Partial<PagoFalso> = {}): PagoFalso => ({ de: OTRA, a: PLANES, monto: "5.0000000", memo: memoDePlan(YO), tx: "p".repeat(64), ms: HOY - 1000, ...extra });
  const planes = (...ps: PagoFalso[]): OpcionesDelHorizonFalso => ({ cuentas: [YO, OTRA], pagos: { [PLANES]: ps } });
  const activar = (m: Mundo, cuenta = YO) => m.pedir(`/v1/plan/${cuenta}/activar`, { cuerpo: {} });

  it("sin la cuenta de planes configurada está apagado", async () => {
    const m = await mundo({ env: { CUENTA_PLANES: "" }, horizon: planes(pagoDePlan()) });
    const r = await activar(m);
    expect(r.status).toBe(503);
    expect(await cuerpoDe(r)).toEqual({ error: "apagado" });
    const mala = await mundo({ env: { CUENTA_PLANES: "no-es-una-cuenta" }, horizon: planes(pagoDePlan()) });
    expect((await activar(mala)).status).toBe(503);
  });

  it("sin pago no activa nada", async () => {
    const m = await mundo({ horizon: planes() });
    expect(await cuerpoDe(await activar(m))).toEqual({ activado: false, motivo: "sin-pago", saldo: 0 });
    expect(m.libro.escrituras).toBe(0);
  });

  it("con el pago de 5 USDC y la nota de la cuenta, activa 30 días y regala 50 monedas", async () => {
    const m = await mundo({ horizon: planes(pagoDePlan()) });
    const r = await cuerpoDe(await activar(m));
    expect(r).toEqual({ activado: true, plan: { inicio: HOY, vence: HOY + 30 * DIA_MS, tx: "p".repeat(64) }, monedas: 50, saldo: 50 });
    expect(m.guardada(YO)).toMatchObject({ saldo: 50, hechos: { plan: 1 }, plan: { inicio: HOY, vence: HOY + 30 * DIA_MS, tx: "p".repeat(64) } });
    expect(m.libro.datos.get(`t:${"p".repeat(64)}`)).toBe(YO);
    const vista = await cuerpoDe(await m.pedir(`/v1/monedas/${YO}`));
    expect(vista.plan).toEqual({ inicio: HOY, vence: HOY + 30 * DIA_MS, tx: "p".repeat(64) });
    expect(await cuerpoDe(await m.pedir(`/v1/plan/${YO}`))).toEqual({ plan: { inicio: HOY, vence: HOY + 30 * DIA_MS, tx: "p".repeat(64) } });
  });

  it("apretar 'Ya pagué' otra vez no activa ni regala dos veces", async () => {
    const m = await mundo({ horizon: planes(pagoDePlan()) });
    await activar(m);
    const escrituras = m.libro.escrituras;
    const otra = await cuerpoDe(await activar(m));
    expect(otra).toMatchObject({ activado: false, motivo: "ya", saldo: 50, plan: { vence: HOY + 30 * DIA_MS } });
    expect(m.libro.escrituras).toBe(escrituras);
    expect(m.guardada(YO).saldo).toBe(50);
  });

  it("un segundo pago renueva: suma 30 días al vencimiento y no regala otras 50 monedas", async () => {
    const m = await mundo({ horizon: planes(pagoDePlan(), pagoDePlan({ tx: "q".repeat(64), ms: HOY - 500 })) });
    const uno = await cuerpoDe(await activar(m));
    expect(uno).toMatchObject({ activado: true, monedas: 50 });
    const dos = await cuerpoDe(await activar(m));
    expect(dos).toMatchObject({ activado: true, monedas: 0, saldo: 50, plan: { inicio: HOY, vence: HOY + 60 * DIA_MS } });
    expect((await cuerpoDe(await activar(m))).motivo).toBe("ya");
  });

  it("no cuentan los pagos con la nota de otra cuenta, sin nota, de menos de 5 ni los que no son USDC", async () => {
    const m = await mundo({
      horizon: planes(
        pagoDePlan({ memo: memoDePlan(OTRA), tx: "1".repeat(64) }),
        pagoDePlan({ memo: undefined, tx: "2".repeat(64) }),
        pagoDePlan({ monto: "4.9999999", tx: "3".repeat(64) }),
        pagoDePlan({ codigo: "EURC", tx: "4".repeat(64) }),
        pagoDePlan({ exitoso: false, tx: "5".repeat(64) }),
        pagoDePlan({ a: OTRA, tx: "6".repeat(64) }),
      ),
    });
    expect(await cuerpoDe(await activar(m))).toMatchObject({ activado: false, motivo: "sin-pago" });
  });

  it("un pago que ya activó el plan de otra cuenta no vale para esta", async () => {
    const m = await mundo({ horizon: planes(pagoDePlan()) });
    m.libro.datos.set(`t:${"p".repeat(64)}`, OTRA);
    const r = await cuerpoDe(await activar(m));
    expect(r).toMatchObject({ activado: false, motivo: "ya", plan: null });
    expect(m.guardada(YO)).toBeNull();
  });

  it("con Horizon caído da error y no activa", async () => {
    const m = await mundo({ horizon: { ...planes(pagoDePlan()), caido: true } });
    expect((await activar(m)).status).toBe(502);
    expect(m.libro.escrituras).toBe(0);
  });

  it("vencido el plan, la cuenta ya no lo tiene a la vista", async () => {
    const m = await mundo({ horizon: planes(pagoDePlan()) });
    await activar(m);
    m.reloj.ahora = HOY + 31 * DIA_MS;
    expect((await cuerpoDe(await m.pedir(`/v1/monedas/${YO}`))).plan).toBeNull();
    expect(await cuerpoDe(await m.pedir(`/v1/plan/${YO}`))).toEqual({ plan: null });
  });
});

describe("el plan para el portero: GET /v1/cuenta/<cuenta>/plan", () => {
  const ruta = (cuenta = YO) => `/v1/cuenta/${cuenta}/plan`;
  const planVigente = (vence: number) => ({ plan: { inicio: HOY - DIA_MS, vence, tx: "p".repeat(64), usadas: ["p".repeat(64)] } });

  it("con el plan activo dice hasta cuándo y qué cupo da", async () => {
    const m = await mundo();
    m.poner(YO, planVigente(HOY + 10 * DIA_MS));
    const r = await m.pedir(ruta());
    expect(r.status).toBe(200);
    expect(await cuerpoDe(r)).toEqual({ activo: true, vence: HOY + 10 * DIA_MS, cupo: { sellos: 50, sorteos: 100 } });
  });

  it("es público: no pide Origin (lo consulta otro Worker) y no filtra nada más de la cuenta", async () => {
    const m = await mundo();
    m.poner(YO, { ...planVigente(HOY + DIA_MS), saldo: 70, canjes: [{ codigo: "chocolate", costo: 20, ms: HOY }] });
    for (const origen of [null, SITIO, "https://evil.example"]) {
      const r = await m.pedir(ruta(), { origen });
      expect(r.status, String(origen)).toBe(200);
      expect(Object.keys(await cuerpoDe(r)).sort()).toEqual(["activo", "cupo", "vence"]);
    }
  });

  it("vencido, o justo en el instante del vencimiento, dice que no está activo", async () => {
    const m = await mundo();
    m.poner(YO, planVigente(HOY - 1));
    expect(await cuerpoDe(await m.pedir(ruta()))).toEqual({ activo: false });
    m.poner(YO, planVigente(HOY));
    expect(await cuerpoDe(await m.pedir(ruta()))).toEqual({ activo: false });
  });

  it("una cuenta que nunca vimos no está activa, y preguntar no escribe nada", async () => {
    const m = await mundo();
    const r = await m.pedir(ruta(OTRA));
    expect(r.status).toBe(200);
    expect(await cuerpoDe(r)).toEqual({ activo: false });
    expect(m.libro.escrituras).toBe(0);
    expect(m.libro.datos.size).toBe(0);
  });

  it("una cuenta con monedas pero sin plan no está activa", async () => {
    const m = await mundo();
    m.poner(YO, { saldo: 120 });
    expect(await cuerpoDe(await m.pedir(ruta()))).toEqual({ activo: false });
  });

  it("la respuesta se puede guardar un rato corto; los errores, no", async () => {
    const m = await mundo();
    m.poner(YO, planVigente(HOY + DIA_MS));
    expect((await m.pedir(ruta())).headers.get("Cache-Control")).toBe(`public, max-age=${PLAN_CACHE_S}`);
    expect(PLAN_CACHE_S).toBeLessThanOrEqual(60);
    expect((await m.pedir(ruta("hola"))).headers.get("Cache-Control")).toBe("no-store");
  });

  it("tras pagar y activar el plan, el portero lo ve; y 30 días después, ya no", async () => {
    const pago: PagoFalso = { de: OTRA, a: PLANES, monto: "5.0000000", memo: memoDePlan(YO), tx: "p".repeat(64), ms: HOY - 1000 };
    const m = await mundo({ horizon: { cuentas: [YO, OTRA], pagos: { [PLANES]: [pago] } } });
    expect(await cuerpoDe(await m.pedir(ruta()))).toEqual({ activo: false });
    expect((await m.pedir(`/v1/plan/${YO}/activar`, { cuerpo: {} })).status).toBe(200);
    expect(await cuerpoDe(await m.pedir(ruta()))).toEqual({ activo: true, vence: HOY + 30 * DIA_MS, cupo: { sellos: 50, sorteos: 100 } });
    m.reloj.ahora = HOY + 30 * DIA_MS;
    expect(await cuerpoDe(await m.pedir(ruta()))).toEqual({ activo: false });
  });

  it("una cuenta mal escrita da 400, otro método 405 y una ruta de más 404", async () => {
    const m = await mundo();
    expect((await m.pedir(ruta("hola"))).status).toBe(400);
    expect((await m.pedir(ruta(YO.toLowerCase()))).status).toBe(400);
    const post = await m.pedir(ruta(), { metodo: "POST", cuerpo: {} });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, OPTIONS");
    expect((await m.pedir(`${ruta()}/mas`)).status).toBe(404);
    expect((await m.pedir(`/v1/cuenta/${YO}`)).status).toBe(404);
  });

  it("si el libro no contesta, 503 y no una respuesta que parezca 'sin plan'", async () => {
    const m = await mundo();
    m.libro.get = async () => {
      throw new Error("kv caído");
    };
    const r = await m.pedir(ruta());
    expect(r.status).toBe(503);
    expect(await cuerpoDe(r)).toEqual({ error: "libro" });
  });

  it("tiene su propio tope por dirección y no le gasta pedidos a las monedas", async () => {
    const m = await mundo();
    for (let i = 0; i < PLAN_POR_HORA; i++) m.dep.planes.toca("1.2.3.4", PLAN_POR_HORA);
    const r = await m.pedir(ruta());
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("3600");
    expect((await m.pedir(`/v1/monedas/${YO}`)).status).toBe(200);
    expect((await m.pedir(ruta(), { ip: "5.6.7.8" })).status).toBe(200);
  });

  it("contesta la consulta previa del navegador", async () => {
    const m = await mundo();
    expect((await m.pedir(ruta(), { metodo: "OPTIONS" })).status).toBe(204);
  });
});
