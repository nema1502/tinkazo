import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { IP, LOTE, SECRETO_CUPON, T0, codigo, montarAltas, tokenDe } from "./altas-prueba";
import { mostrar } from "./altas";
import { DIA_MS, leerConfig } from "./config";
import { PorIp } from "./por-ip";
import { ALTAS_POR_IP_HORA, FALLIDOS_POR_IP_HORA, FALLIDOS_POR_USUARIO_HORA, TOKENS_NUEVOS_POR_IP_HORA, atenderAlta } from "./rutas-altas";

const HORA = 3_600_000;
const C1 = codigo(1);
const C2 = codigo(2);
const C3 = codigo(3);

describe("el camino entero, con la cuenta abierta al entrar (fondeo inmediato)", () => {
  it("estado sin acceso, canje, activar y lista", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);

    expect(await m.estado(ana.token)).toEqual({
      estado: 200,
      cuerpo: { acceso: "ninguno", cuenta: ana.cuenta, abierta: false, pedido: null, sorteos: { quedan: 0, proximoVence: null }, orden: null, fondeo: "inmediato" },
    });
    // Sin acceso no se mete a nadie en el libro.
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(false);

    // El código como lo escribe la persona, con guiones y en minúsculas.
    expect(await m.cupon(ana.token, mostrar(C1).toLowerCase())).toEqual({
      estado: 200,
      cuerpo: { ok: true, repetido: false, sorteosSumados: 3, sorteos: { quedan: 3, proximoVence: { fecha: T0 + 60 * DIA_MS, cuantos: 3 } }, sigue: "activar" },
    });
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "cupon", cuenta: ana.cuenta, abierta: false, sorteos: { quedan: 3 } } });

    // Se activó: la cuenta existe en la red.
    m.abiertas.add(ana.cuenta as string);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "cupon", abierta: true } });
    // El mismo cupón otra vez: lo mismo, sin gastar otro uso, y ya está lista.
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: true, sorteosSumados: 0, sorteos: { quedan: 3 }, sigue: "lista" } });
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ creados: 1, canjeados: 1 });
  });

  it("sin billetera todavía: el canje vale y sigue crear-billetera; cuando aparece, estado la ata y la mete en el libro", async () => {
    const m = montarAltas();
    const beto = m.persona("usr_beto", null);
    await m.lote([C1]);
    expect(await m.cupon(beto.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true, sigue: "crear-billetera", sorteos: { quedan: 3 } } });
    const g = Keypair.random().publicKey();
    m.pm.billeteras.set("usr_beto", g);
    expect(await m.estado(beto.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "cupon", cuenta: g, sorteos: { quedan: 3 } } });
    expect(m.cupos.estaEnElLibro(g)).toBe(true);
    expect(m.cupos.quedan({ cuenta: g }, m.hora()).quedan).toBe(3);
  });

  it("con fondeo diferido, después del canje sigue abrir", async () => {
    const m = montarAltas({ POLLAR_FONDEO: "diferido" });
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { sigue: "abrir" } });
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { fondeo: "diferido" } });
  });

  it("la cuenta que trae el verify se usa sin preguntarle a users", async () => {
    const m = montarAltas();
    const g = Keypair.random().publicKey();
    m.pm.sesiones.set(tokenDe("usr_eva"), { usuario: "usr_eva", wallet: { publicKey: g, chain: "STELLAR" } });
    await m.lote([C1]);
    expect(await m.cupon(tokenDe("usr_eva"), C1)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    expect(m.cupos.estaEnElLibro(g)).toBe(true);
    expect(m.pm.llamadas).not.toContain("/v3/users");
  });

  it("una cuenta que administración admitió a mano tiene acceso admin", async () => {
    const m = montarAltas();
    const nico = m.persona("usr_nico");
    const g = nico.cuenta as string;
    m.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES (?, 'admin', 'admin:x', ?, NULL, 'abierta', ?, ?)", `cuenta:${g}`, g, T0, T0);
    m.cupos.admitir(g, "admin", T0);
    m.cupos.otorgar({ usuario: `cuenta:${g}`, cuenta: g, origen: "admin", ref: "admin:x", sorteos: 20, dias: 30 }, T0);
    expect(await m.estado(nico.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "admin", cuenta: g, sorteos: { quedan: 20 } } });
  });
});

describe("cada error", () => {
  it("sin token, o con uno de forma rara, 401 sesion sin llamar a Pollar", async () => {
    const m = montarAltas();
    expect(await m.cupon(null, C1)).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    expect(await m.estado("raro")).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    expect(m.pm.llamadas).toHaveLength(0);
  });

  it("un token que Pollar no reconoce es 401; de otra app, 403; Pollar caído, 502", async () => {
    const m = montarAltas();
    expect(await m.estado(tokenDe("nadie"))).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    m.pm.sesiones.set(tokenDe("otra"), { usuario: "usr_otra", app: "app_de_otro" });
    expect(await m.cupon(tokenDe("otra"), C1)).toEqual({ estado: 403, cuerpo: { motivo: "otra-app" } });
    m.pm.sesiones.set(tokenDe("prueba"), { usuario: "usr_prueba", red: "testnet" });
    expect(await m.estado(tokenDe("prueba"))).toEqual({ estado: 403, cuerpo: { motivo: "otra-app" } });
    m.persona("usr_ana");
    m.pm.caido = true;
    expect(await m.cupon(tokenDe("usr_ana"), C1)).toEqual({ estado: 502, cuerpo: { motivo: "pollar" } });
  });

  it("un código mal escrito es 400 forma, sin tocar nada", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    for (const c of ["K7M2", "K7M29QXA4HTRX", 12, null, ""]) expect(await m.cupon(ana.token, c)).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
  });

  it("no existe, vencido, anulado, usado por otra persona y otro del mismo lote", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.lote([C1, C2, C3]);
    expect(await m.cupon(ana.token, codigo(99))).toEqual({ estado: 404, cuerpo: { motivo: "cupon-no-existe" } });
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    expect(await m.cupon(beto.token, C1)).toEqual({ estado: 409, cuerpo: { motivo: "cupon-usado" } });
    expect(await m.cupon(ana.token, C2)).toEqual({ estado: 409, cuerpo: { motivo: "lote-usado" } });
    m.altas.anular({ lote: LOTE });
    expect(await m.cupon(beto.token, C3)).toEqual({ estado: 410, cuerpo: { motivo: "cupon-anulado" } });

    const n = montarAltas();
    const eva = n.persona("usr_eva");
    await n.lote([C1]);
    n.mover(31 * DIA_MS);
    expect(await n.cupon(eva.token, C1)).toEqual({ estado: 410, cuerpo: { motivo: "cupon-vencido", vence: T0 + 30 * DIA_MS } });
  });

  it("si users no contesta, o no trae la fila, es 502 y el cupón no se gasta", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    m.pm.usersCaido = true;
    expect(await m.cupon(ana.token, C1)).toEqual({ estado: 502, cuerpo: { motivo: "pollar" } });
    m.pm.usersCaido = false;
    m.pm.billeteras.delete("usr_ana");
    expect(await m.cupon(ana.token, C1)).toEqual({ estado: 502, cuerpo: { motivo: "pollar" } });
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ canjeados: 0 });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM altas").toArray()[0]?.n).toBe(0);
    m.pm.billeteras.set("usr_ana", ana.cuenta);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
  });

  it("si la red no contesta, el canje vale igual y sigue activar", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    m.red.caida = true;
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true, sigue: "activar" } });
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { abierta: false } });
  });
});

describe("apagado", () => {
  it("con ALTAS=0, 503 apagado y no se le pregunta nada a Pollar", async () => {
    const m = montarAltas({ ALTAS: "0" });
    const ana = m.persona("usr_ana");
    expect(await m.estado(ana.token)).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
    expect(await m.cupon(ana.token, C1)).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
    expect(m.pm.llamadas).toHaveLength(0);
  });

  it("en testnet ALTAS se ignora: apagado", async () => {
    const m = montarAltas({ RED: "testnet" });
    expect(await m.estado(m.persona("usr_ana").token)).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
  });

  it("sin Pollar, sin la app, sin el secreto de los cupones o con uno corto, 503 apagado por la configuración", async () => {
    for (const m of [montarAltas({}, { sinPollar: true }), montarAltas({ POLLAR_APP_ID: "" }), montarAltas({}, { cuponSecreto: null }), montarAltas({}, { cuponSecreto: "corto" }), montarAltas({ POLLAR_FONDEO: "otro" })]) {
      expect(await m.cupon(m.persona("usr_ana").token, C1)).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "config" } });
      expect(m.pm.llamadas).toHaveLength(0);
    }
  });
});

describe("los intentos", () => {
  it(`${FALLIDOS_POR_USUARIO_HORA} fallidos por persona y por hora; después 429, aunque el código sea bueno`, async () => {
    expect(FALLIDOS_POR_USUARIO_HORA).toBe(5);
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    for (let i = 0; i < 5; i++) expect((await m.cupon(ana.token, codigo(100 + i))).estado).toBe(404);
    const r = await m.cupon(ana.token, C1);
    expect(r).toMatchObject({ estado: 429, cuerpo: { motivo: "intentos" } });
    const reintentarEn = Number(r.cuerpo.reintentarEn);
    expect(reintentarEn).toBeGreaterThan(m.hora());
    expect(reintentarEn).toBeLessThanOrEqual(m.hora() + HORA);
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ canjeados: 0 });
    m.mover(HORA + 1);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
  });

  it("los códigos mal escritos también cuentan; el canje repetido no", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    for (let i = 0; i < 10; i++) expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    for (let i = 0; i < 5; i++) expect((await m.cupon(ana.token, "xx")).estado).toBe(400);
    expect((await m.cupon(ana.token, C1)).estado).toBe(429);
  });

  it("dos teléfonos con la misma dirección no se traban: el que se equivoca no frena al otro", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.lote([C1, C2]);
    for (let i = 0; i < 5; i++) await m.cupon(ana.token, codigo(200 + i));
    expect((await m.cupon(ana.token, C1)).estado).toBe(429);
    expect(await m.cupon(beto.token, C2)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    expect((await m.estado(beto.token)).estado).toBe(200);
  });

  it("200 pedidos sin token y 200 con tokens inventados desde la misma dirección no traban a quien ya entró: estado y canje siguen", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    // Ana ya entró: Pollar dio su sesión por buena.
    expect((await m.estado(ana.token)).estado).toBe(200);
    // Sin token o con forma rara: 401, sin preguntarle a Pollar y sin contar nada.
    for (let i = 0; i < 200; i++) expect((await m.estado(null)).estado).toBe(401);
    for (let i = 0; i < 200; i++) expect((await m.cupon(i % 2 ? "raro" : null, C2)).estado).toBe(401);
    // Con forma de token, inventados (también de la app de Prueba): 401 o 403, y suman en su contador aparte.
    for (let i = 0; i < 100; i++) expect((await m.estado(tokenDe(`nadie${i}`))).estado).toBe(401);
    for (let i = 0; i < 100; i++) {
      m.pm.sesiones.set(tokenDe(`prueba${i}`), { usuario: `usr_prueba${i}`, red: "testnet" });
      expect((await m.estado(tokenDe(`prueba${i}`))).estado).toBe(403);
    }
    // Pasado el minuto que Pollar recuerda la sesión, ana sigue siendo ana: estado y canje.
    m.mover(2 * 60_000);
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "ninguno" } });
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: false } });
  });

  it("200 sin token no traban a quien recién llega: su primera sesión se verifica", async () => {
    const m = montarAltas();
    for (let i = 0; i < 300; i++) await m.estado(null);
    const beto = m.persona("usr_beto");
    expect((await m.estado(beto.token)).estado).toBe(200);
  });

  it(`${TOKENS_NUEVOS_POR_IP_HORA} tokens con forma que Pollar rechaza: un token nuevo de esa dirección ya no se pregunta, uno ya verificado sí`, async () => {
    expect(TOKENS_NUEVOS_POR_IP_HORA).toBe(200);
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    expect((await m.estado(ana.token)).estado).toBe(200);
    for (let i = 0; i < 200; i++) expect((await m.estado(tokenDe(`nadie${i}`))).estado).toBe(401);
    const antes = m.pm.llamadas.length;
    const nuevo = m.persona("usr_nuevo");
    const r = await m.estado(nuevo.token);
    expect(r).toMatchObject({ estado: 429, cuerpo: { motivo: "intentos" } });
    expect(Number(r.cuerpo.reintentarEn)).toBeLessThanOrEqual(m.hora() + HORA);
    expect(m.pm.llamadas.length).toBe(antes);
    // La sesión ya verificada no se traba; otra dirección sigue; pasada la hora, también el nuevo.
    expect((await m.estado(ana.token)).estado).toBe(200);
    expect((await m.estado(nuevo.token, "190.129.10.21")).estado).toBe(200);
    // Una IPv6 cuenta por su bloque /64.
    for (let i = 0; i < 200; i++) await m.estado(tokenDe(`otro${i}`), `2800:cd0:1:2::${i.toString(16)}`);
    const tercero = m.persona("usr_tercero");
    expect((await m.estado(tercero.token, "2800:cd0:1:2::ffff")).estado).toBe(429);
    m.mover(HORA + 1);
    expect((await m.estado(tercero.token, "2800:cd0:1:2::ffff")).estado).toBe(200);
  });

  it(`${FALLIDOS_POR_IP_HORA} códigos fallidos por dirección traban el canje de esa dirección, también para un token nuevo; estado sigue`, async () => {
    expect(FALLIDOS_POR_IP_HORA).toBe(200);
    const m = montarAltas();
    await m.lote([C1]);
    // Cuarenta cuentas, cinco códigos fallidos cada una.
    for (let k = 0; k < 40; k++) {
      const p = m.persona(`usr_adivina${k}`);
      for (let i = 0; i < 5; i++) expect((await m.cupon(p.token, codigo(1000 + k * 5 + i))).estado).toBe(404);
    }
    const eva = m.persona("usr_eva");
    expect(await m.cupon(eva.token, C1)).toMatchObject({ estado: 429, cuerpo: { motivo: "intentos" } });
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ canjeados: 0 });
    expect((await m.estado(eva.token)).estado).toBe(200);
    // Desde otra dirección canjea.
    expect((await m.cupon(eva.token, C1, "190.129.10.21")).estado).toBe(200);
  });
});

describe("a la vez", () => {
  it("dos personas con el mismo cupón al mismo tiempo: una lo canjea y la otra da cupon-usado", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.lote([C1]);
    const [a, b] = await Promise.all([m.cupon(ana.token, C1), m.cupon(beto.token, C1)]);
    expect([a.estado, b.estado].sort()).toEqual([200, 409]);
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ canjeados: 1 });
  });

  it("la misma persona con dos toques: un canje, el otro repetido", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    const res = await Promise.all([m.cupon(ana.token, C1), m.cupon(ana.token, C1)]);
    expect(res.map((r) => r.cuerpo.repetido).sort()).toEqual([false, true]);
    expect(m.cupos.quedan({ cuenta: ana.cuenta as string }, m.hora()).quedan).toBe(3);
  });

  it("veinte personas con códigos distintos del mismo lote a la vez: veinte canjes", async () => {
    const m = montarAltas();
    const gente = Array.from({ length: 20 }, (_, i) => m.persona(`usr_${i}`));
    await m.lote(gente.map((_, i) => codigo(300 + i)));
    const res = await Promise.all(gente.map((p, i) => m.cupon(p.token, codigo(300 + i))));
    expect(res.every((r) => r.estado === 200)).toBe(true);
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ canjeados: 20 });
  });
});

describe("la bitácora", () => {
  it("nunca lleva el token, el id de la persona, el código ni la cuenta", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana_secreta");
    await m.lote([C1]);
    await m.cupon(ana.token, codigo(55));
    await m.cupon(ana.token, C1);
    await m.estado(ana.token);
    m.pm.caido = true;
    await m.cupon(tokenDe("usr_otro_secreto"), C2);
    m.pm.caido = false;
    const todo = JSON.stringify(m.anotado);
    expect(m.anotado.some(([e]) => e === "alta-canje")).toBe(true);
    for (const prohibido of [ana.token, "usr_ana_secreta", "usr_otro_secreto", C1, C2, codigo(55), mostrar(C1), ana.cuenta as string, SECRETO_CUPON]) expect(todo).not.toContain(prohibido);
  });
});

describe("la puerta del Worker (atenderAlta)", () => {
  const cfgMainnet = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
  const pedido = (ruta: string, init: RequestInit & { origen?: string | null } = {}) => {
    const h = new Headers(init.headers);
    if (init.origen !== null) h.set("Origin", init.origen ?? "https://tinkazo.app");
    h.set("CF-Connecting-IP", IP);
    return new Request(`https://pm.tinkazo.app${ruta}`, { method: init.method ?? "POST", headers: h, body: init.body });
  };
  const espia = () => {
    const vistos: Array<{ accion: string; token: string | null; ip: string; cuerpo: unknown }> = [];
    return { vistos, llamar: async (accion: "estado" | "cupon", p: { token: string | null; ip: string; cuerpo: unknown }) => (vistos.push({ accion, ...p }), { estado: 200, cuerpo: { visto: accion } }) };
  };

  it("en testnet no atiende: la ruta sigue sin existir, como hoy", async () => {
    const e = espia();
    expect(await atenderAlta(pedido("/v1/alta/estado", { body: "{}" }), leerConfig({ RED: "testnet", ALTAS: "1" }), e.llamar, new PorIp())).toBeNull();
    expect(e.vistos).toHaveLength(0);
  });

  it("el preflight suma Authorization a las cabeceras permitidas, con el origen del sitio", async () => {
    const r = (await atenderAlta(pedido("/v1/alta/cupon", { method: "OPTIONS" }), cfgMainnet, espia().llamar, new PorIp())) as Response;
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
  });

  it("pasa el token de la cabecera, la dirección y el cuerpo; el token nunca va en la dirección", async () => {
    const e = espia();
    const r = (await atenderAlta(pedido("/v1/alta/cupon", { headers: { Authorization: "Bearer tok_abc", "Content-Type": "application/json" }, body: JSON.stringify({ cupon: "K7M2-9QXA-4HTR" }) }), cfgMainnet, e.llamar, new PorIp())) as Response;
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    expect(e.vistos).toEqual([{ accion: "cupon", token: "tok_abc", ip: IP, cuerpo: { cupon: "K7M2-9QXA-4HTR" } }]);
    // Sin cabecera, sin token; con el cuerpo vacío, {}.
    await atenderAlta(pedido("/v1/alta/estado"), cfgMainnet, e.llamar, new PorIp());
    expect(e.vistos[1]).toEqual({ accion: "estado", token: null, ip: IP, cuerpo: {} });
  });

  it("los errores de la puerta: apagado, origen, método, cuerpo, tamaño, ruta y una excepción", async () => {
    const e = espia();
    const estado = async (req: Request, cfg = cfgMainnet, llamar = e.llamar) => {
      const r = (await atenderAlta(req, cfg, llamar, new PorIp())) as Response;
      return [r.status, await r.json()];
    };
    expect(await estado(pedido("/v1/alta/estado", { body: "{}" }), leerConfig({ RED: "mainnet", ALTAS: "0" }))).toEqual([503, { motivo: "apagado" }]);
    expect(await estado(pedido("/v1/alta/estado", { body: "{}", origen: "https://otro.example" }))).toEqual([403, { motivo: "origen" }]);
    expect(await estado(pedido("/v1/alta/estado", { body: "{}", origen: null }))).toEqual([403, { motivo: "origen" }]);
    expect(await estado(pedido("/v1/alta/estado", { method: "GET" }))).toEqual([405, { motivo: "metodo" }]);
    expect(await estado(pedido("/v1/alta/cupon", { body: "no es json" }))).toEqual([400, { motivo: "cuerpo" }]);
    expect(await estado(pedido("/v1/alta/cupon", { body: "[1]" }))).toEqual([400, { motivo: "cuerpo" }]);
    expect(await estado(pedido("/v1/alta/cupon", { body: JSON.stringify({ cupon: "x".repeat(5000) }) }))).toEqual([400, { motivo: "cuerpo" }]);
    expect(await estado(pedido("/v1/alta/otra", { body: "{}" }))).toEqual([404, { motivo: "no-existe" }]);
    expect(
      await estado(pedido("/v1/alta/estado", { body: "{}" }), cfgMainnet, async () => {
        throw new Error("algo");
      }),
    ).toEqual([500, { motivo: "interno" }]);
    expect(e.vistos).toHaveLength(0);
  });

  it(`muchos pedidos de una dirección en la hora dan 429 cupo-ip: ${ALTAS_POR_IP_HORA}, para todo un stand que sale por la misma`, async () => {
    expect(ALTAS_POR_IP_HORA).toBe(3000);
    const e = espia();
    const porIp = new PorIp();
    let ultimo: Response | null = null;
    for (let i = 0; i < ALTAS_POR_IP_HORA + 1; i++) ultimo = await atenderAlta(pedido("/v1/alta/estado", { body: "{}" }), cfgMainnet, e.llamar, porIp);
    expect(ultimo?.status).toBe(429);
    expect(await ultimo?.json()).toMatchObject({ motivo: "cupo-ip" });
    expect(e.vistos).toHaveLength(ALTAS_POR_IP_HORA);
  });
});
