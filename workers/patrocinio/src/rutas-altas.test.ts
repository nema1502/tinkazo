import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { IP, LOTE, SECRETO_CUPON, T0, codigo, montarAltas, tokenDe } from "./altas-prueba";
import { mostrar } from "./altas";
import { AltasPorPremio } from "./altas-premio";
import { DIA_MS, leerConfig } from "./config";
import { MEMORIA_SESION_MS } from "./pollar";
import { PorIp } from "./por-ip";
import { type PedidoDePago, UsoDePagos } from "./pagos-uso";
import { ErrorDeRed } from "./red";
import {
  ALTAS_POR_IP_HORA,
  CONSULTAS_PREMIO_DE_MAS,
  FALLIDOS_POR_IP_HORA,
  FALLIDOS_POR_USUARIO_HORA,
  PuertaAltas,
  TOKENS_NUEVOS_POR_IP_HORA,
  type AccionAlta,
  type PedidoAlta,
  atenderAlta,
} from "./rutas-altas";
import type { SorteoEnRed } from "./sorteadora";
import { sqlQueFallaEn } from "./sqlite-prueba";

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
      cuerpo: {
        acceso: "ninguno",
        cuenta: ana.cuenta,
        abierta: false,
        pedido: null,
        sorteos: { quedan: 0, proximoVence: null },
        orden: null,
        fondeo: "inmediato",
        // Sin alta y con créditos de sobra: puede recibir el regalo de bienvenida.
        bienvenida: { estado: "lista", sorteos: 3 },
      },
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

describe("la cuenta atada y la de la sesión", () => {
  it("si el alta ya tiene una cuenta atada y Pollar dice otra en esta sesión, /estado da 409 cuenta-de-otro sin escribir nada", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    const antes = m.cupos.altaDe("usr_ana");
    expect(antes?.cuenta).toBe(ana.cuenta);

    // La sesión vuelve a verificarse (pasó la memoria) y ahora Pollar dice otra billetera.
    const otra = Keypair.random().publicKey();
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(ana.token, { usuario: "usr_ana", wallet: { publicKey: otra, chain: "STELLAR" } });
    const tablas = JSON.stringify(m.cupos.exportar(true));
    expect(await m.estado(ana.token)).toEqual({ estado: 409, cuerpo: { motivo: "cuenta-de-otro" } });
    expect(m.cupos.estaEnElLibro(otra)).toBe(false);
    expect(m.cupos.altaDe("usr_ana")).toEqual(antes);
    expect(JSON.stringify(m.cupos.exportar(true))).toBe(tablas);
    expect(m.anotado.some(([e, d]) => e === "error-alta" && d?.motivo === "cuenta-de-otro")).toBe(true);

    // Con la misma que la atada, como siempre.
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(ana.token, { usuario: "usr_ana", wallet: { publicKey: ana.cuenta as string, chain: "STELLAR" } });
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "cupon", cuenta: ana.cuenta } });
    // Y si el verify no trae la billetera, vale la atada, como siempre.
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(ana.token, { usuario: "usr_ana" });
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "cupon", cuenta: ana.cuenta } });
  });

  it("si el alta ya tiene una cuenta atada y Pollar dice otra en esta sesión, /cupon da 409 cuenta-de-otro sin escribir nada", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    await m.lote([C2], { lote: "otro" });
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    const antes = m.cupos.altaDe("usr_ana");
    expect(antes?.cuenta).toBe(ana.cuenta);

    // La billetera de esta sesión es otra, que todavía no se abrió en la red: antes contestaba sigue «activar» por la
    // atada, y el sitio votaba la activación de una cuenta que no está en el libro.
    const otra = Keypair.random().publicKey();
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(ana.token, { usuario: "usr_ana", wallet: { publicKey: otra, chain: "STELLAR" } });
    const tablas = JSON.stringify(m.cupos.exportar(true));
    expect(await m.cupon(ana.token, C2)).toEqual({ estado: 409, cuerpo: { motivo: "cuenta-de-otro" } });
    expect(await m.cupon(ana.token, C1)).toEqual({ estado: 409, cuerpo: { motivo: "cuenta-de-otro" } });
    expect(m.cupos.estaEnElLibro(otra)).toBe(false);
    expect(m.cupos.altaDe("usr_ana")).toEqual(antes);
    expect(JSON.stringify(m.cupos.exportar(true))).toBe(tablas);
    expect(m.anotado.some(([e, d]) => e === "error-alta" && d?.motivo === "cuenta-de-otro")).toBe(true);

    // Con la misma que la atada, el canje sigue como siempre.
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(ana.token, { usuario: "usr_ana", wallet: { publicKey: ana.cuenta as string, chain: "STELLAR" } });
    expect(await m.cupon(ana.token, C2)).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: false } });
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

  it(`muchos pedidos de una dirección en la hora dan 429 cupo-ip: ${ALTAS_POR_IP_HORA}, para una sala que sale por la misma`, async () => {
    expect(ALTAS_POR_IP_HORA).toBe(20_000);
    const e = espia();
    const porIp = new PorIp();
    let ultimo: Response | null = null;
    for (let i = 0; i < ALTAS_POR_IP_HORA + 1; i++) ultimo = await atenderAlta(pedido("/v1/alta/estado", { body: "{}" }), cfgMainnet, e.llamar, porIp);
    expect(ultimo?.status).toBe(429);
    expect(await ultimo?.json()).toMatchObject({ motivo: "cupo-ip" });
    expect(e.vistos).toHaveLength(ALTAS_POR_IP_HORA);
  });

  /** Lo que llega al objeto, con cualquier ruta de las altas. */
  const alObjeto = () => {
    const vistos: AccionAlta[] = [];
    return { vistos, llamar: async (accion: AccionAlta, _p: PedidoAlta) => (vistos.push(accion), { estado: 200, cuerpo: { ok: true } }) };
  };
  /** Un pedido de una persona de la sala a una ruta de las altas, desde la misma dirección que todas. */
  const deLaSala = (ruta: string, persona: number) => pedido(ruta, { headers: { Authorization: `Bearer tok_${persona}` }, body: "{}" });

  it("una sala de 150 personas por la misma dirección en una hora: sus 150 pedidos del regalo pasan todos", async () => {
    let ahora = T0;
    const porIp = new PorIp(() => ahora);
    const o = alObjeto();
    const estados: number[] = [];
    for (let i = 0; i < 150; i++) {
      estados.push(((await atenderAlta(deLaSala("/v1/alta/gratis", i), cfgMainnet, o.llamar, porIp)) as Response).status);
      // Los 150 repartidos en 59 minutos y medio, dentro de la misma hora.
      ahora += 23_800;
    }
    expect(ahora - T0).toBeLessThan(3_600_000);
    expect(estados).toEqual(Array<number>(150).fill(200));
    expect(o.vistos).toEqual(Array<AccionAlta>(150).fill("gratis"));
  });

  it("la misma sala preguntando el estado 40 veces cada una y activando pasa entera, más que el límite de antes", async () => {
    let ahora = T0;
    const porIp = new PorIp(() => ahora);
    const o = alObjeto();
    let frenados = 0;
    for (let i = 0; i < 150; i++) {
      for (let k = 0; k < 40; k++) if ((await atenderAlta(deLaSala("/v1/alta/estado", i), cfgMainnet, o.llamar, porIp))?.status !== 200) frenados++;
      if ((await atenderAlta(deLaSala("/v1/alta/gratis", i), cfgMainnet, o.llamar, porIp))?.status !== 200) frenados++;
      ahora += 23_800;
    }
    expect(frenados).toBe(0);
    // 6.150 pedidos en la hora: con las 3.000 de antes, la mitad de la sala se quedaba afuera.
    expect(o.vistos).toHaveLength(150 * 41);
    expect(o.vistos.length).toBeGreaterThan(3000);
  });
});

describe("la vigilancia y lo que falta con los pagos de premios y retiros", () => {
  const CONTRATO = `C${"A".repeat(55)}`;
  const LIM = { topePagos: 20_000_000, rechazosPorDia: 20 };
  const firma = (ms: number) => ({ event: "cosign.signature:STELLAR", amount: -20, createdAt: new Date(ms).toISOString() });
  let contador = 0;
  const hash = () => (++contador).toString(16).padStart(64, "0");

  /** Un pago reservado por el portero a esta hora, de una cuenta que estaba (o no) en el libro. */
  function reservar(uso: UsoDePagos, forma: "premio" | "retiro", delLibro: boolean, cuando: number): void {
    const pedido: PedidoDePago = {
      hash: hash(),
      envuelta: null,
      forma,
      cuenta: Keypair.random().publicKey(),
      delLibro,
      estimado: forma === "premio" ? 20_000 : 30_000,
      vence: 1,
      premio:
        forma === "premio"
          ? { contrato: CONTRATO, sorteo: "5", puesto: contador % 300, destino: Keypair.random().publicKey(), ganadores: 300 }
          : null,
      costo: forma === "retiro" ? 5_000_000 : null,
    };
    expect(uso.reservar(pedido, cuando, LIM)).toEqual({ ok: true, yaContado: false });
  }

  /** Las rutas de siempre, con las tablas de los pagos del mismo SQLite. */
  function conPagos(env: Parameters<typeof montarAltas>[0] = {}, opciones: Parameters<typeof montarAltas>[1] = {}) {
    const m = montarAltas(env, opciones);
    const uso = new UsoDePagos(m.sql);
    const puerta = new PuertaAltas({
      cfg: m.cfg,
      cupos: m.cupos,
      altas: m.altas,
      pollar: m.pollar,
      cuponSecreto: SECRETO_CUPON,
      red: m.red,
      reloj: m.hora,
      registrar: () => {},
      pagos: uso,
    });
    return { m, uso, puerta };
  }

  it("los premios y los retiros de cuentas del libro suman a las firmas explicadas y salen en firmasPagos, aparte de firmas", async () => {
    const { m, uso, puerta } = conPagos();
    reservar(uso, "premio", true, T0 - HORA);
    reservar(uso, "retiro", true, T0 - HORA);
    // Una cuenta de una billetera propia no le cuesta firmas a Pollar: no tapa nada.
    reservar(uso, "retiro", false, T0 - HORA);
    // Lo de antes del día no cuenta.
    reservar(uso, "retiro", true, T0 - 2 * DIA_MS);
    m.pm.movimientos = [firma(T0 - HORA), firma(T0 - HORA), firma(T0 - HORA)];
    const v = await puerta.vigilancia();
    expect(v).toEqual({
      firmasSinExplicar: 1,
      firmas: {
        cobradas: 3,
        explicadas: 2,
        sellos: 0,
        sorteos: 0,
        activaciones: 0,
        compras: 0,
        pagosConSaldo: 0,
        completo: true,
        desde: T0 - DIA_MS,
      },
      firmasPagos: { premios: 1, retiros: 1 },
      patrocinioPollar: { esperado: true, prendidos: [] },
    });
  });

  it("los renglones que lee el vigilante quedan como están: las mismas claves de firmas, con o sin pagos", async () => {
    const claves = ["activaciones", "cobradas", "completo", "compras", "desde", "explicadas", "pagosConSaldo", "sellos", "sorteos"];
    const { uso, puerta } = conPagos();
    reservar(uso, "retiro", true, T0 - HORA);
    expect(Object.keys((await puerta.vigilancia()).firmas as object).sort()).toEqual(claves);
    expect(Object.keys((await montarAltas().puerta.vigilancia()).firmas as object).sort()).toEqual(claves);
  });

  it("con las tablas y sin nada prendido ni nada en el día, la vigilancia es la de siempre: no aparece firmasPagos", async () => {
    const { m, puerta } = conPagos();
    const sinPagos = await montarAltas().puerta.vigilancia();
    expect(await puerta.vigilancia()).toEqual(sinPagos);
    expect(Object.keys(await puerta.vigilancia())).not.toContain("firmasPagos");
    expect(m.pm.llamadas.length).toBeGreaterThan(0);
  });

  it("con alguna forma prendida aparece firmasPagos aunque no haya nada: así quien opera lo ve en cero", async () => {
    const { puerta } = conPagos({ PAGOS_PREMIO: "1" });
    expect(await puerta.vigilancia()).toMatchObject({ firmasPagos: { premios: 0, retiros: 0 } });
  });

  it("sin las tablas la vigilancia no falla: firmasPagos en cero y el resto igual", async () => {
    const roto = sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS pagos_portero/);
    const { uso, puerta } = conPagos({ PAGOS_PREMIO: "1" }, { sql: roto });
    expect(uso.disponible()).toBe(false);
    expect(await puerta.vigilancia()).toMatchObject({ firmasSinExplicar: 0, firmasPagos: { premios: 0, retiros: 0 } });
  });

  it("faltaAltas dice tablas-pagos si las tablas de los pagos no se pudieron crear, y el resto de las rutas sigue andando", async () => {
    const roto = sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS pagos_portero/);
    const { m, uso, puerta } = conPagos({}, { sql: roto });
    expect(uso.faltan()).toContain("pagos_portero");
    expect(await puerta.resumen()).toMatchObject({ faltaAltas: ["tablas-pagos"] });
    // Las altas no se enteran: un cupón se sigue canjeando.
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    // Con las tablas bien, o sin la dependencia, no dice nada.
    expect(await conPagos().puerta.resumen()).not.toHaveProperty("faltaAltas");
    expect(await montarAltas().puerta.resumen()).not.toHaveProperty("faltaAltas");
  });
});

describe("el alta de quien ganó (POST /v1/alta/premio)", () => {
  const HUELLA = "ab".repeat(32);
  const RONDA = 77;
  const SORTEO = "5";
  const GANADORES = 3;

  /**
   * Las rutas de siempre con el alta de quien ganó prendida y un sorteo de mentira: lo que la red dice de cada sorteo se pone en
   * `sorteos`, y `lecturas` cuenta las veces que la puerta fue a leerlo.
   */
  function conPremio(env: Parameters<typeof montarAltas>[0] = {}, opciones: Parameters<typeof montarAltas>[1] = {}) {
    const m = montarAltas({ ALTAS_PREMIO: "1", ...env }, opciones);
    const altasPremio = new AltasPorPremio(m.sql, m.cupos);
    const sorteos = new Map<string, SorteoEnRed | null>();
    const lecturas: bigint[] = [];
    const red = { sorteoCaido: false };
    const patrocinadora = Keypair.random().publicKey();
    const puerta = new PuertaAltas({
      cfg: m.cfg,
      cupos: m.cupos,
      altas: m.altas,
      pollar: m.pollar,
      cuponSecreto: SECRETO_CUPON,
      red: m.red,
      reloj: m.hora,
      registrar: (e, d) => void m.anotado.push([e, d]),
      altasPremio,
      cuentaPatrocinadora: patrocinadora,
      leerSorteo: async (_origen, id) => {
        lecturas.push(id);
        if (red.sorteoCaido) throw new ErrorDeRed("lectura-sorteo");
        return sorteos.get(String(id)) ?? null;
      },
    });
    /**
     * Un sorteo ya sorteado de esta cuenta, con su sello pagado por el portero y atado a él (el portero pagó su `draw` con ese
     * sello). Con `atado` en falso, un sello de antes, que no sabe a qué sorteo respalda.
     */
    const ponerSorteo = (organizador: string, extra: Partial<SorteoEnRed> = {}, selloDelPortero = true, atado = true) => {
      sorteos.set(SORTEO, { id: BigInt(SORTEO), organizador, huellaLista: HUELLA, ronda: RONDA, ganadores: GANADORES, sorteado: true, ...extra });
      if (selloDelPortero) {
        const sello = "INSERT INTO sellos_portero (hash, organizador, huella_lista, ronda, ms) VALUES (?, ?, ?, ?, ?)";
        m.sql.exec(sello, "s".repeat(64), organizador, HUELLA, RONDA, T0);
        if (atado) {
          m.cupos.atarSorteo({ sello: "s".repeat(64), contrato: m.cfg.contractId as string, sorteo: SORTEO, draw: "d".repeat(64) }, T0);
        }
      }
    };
    /** Quien organiza: una persona con su cuenta en el libro y un sorteo suyo, sorteado y sellado por el portero. */
    const organiza = () => {
      const org = m.persona("usr_org");
      m.cupos.admitir(org.cuenta as string, "cupon", T0);
      ponerSorteo(org.cuenta as string);
      return org;
    };
    const pedir = (token: string | null, cuerpo: unknown) => puerta.atender("premio", { token, ip: IP, cuerpo });
    /** Pide el alta de `cuenta` en un puesto del sorteo de mentira (el 1 si no se dice). */
    const ped = (token: string | null, cuenta: unknown, puesto = 1) => pedir(token, { sorteo: SORTEO, puesto, cuenta });
    const filas = (tabla: string) => m.sql.exec(`SELECT * FROM ${tabla}`).toArray();
    return { m, puerta, altasPremio, sorteos, lecturas, red, patrocinadora, ponerSorteo, organiza, pedir, ped, filas };
  }

  it("admite a quien ganó con la sesión de quien organiza: su alta sin sorteos y su cuenta en el libro", async () => {
    const { m, organiza, filas, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    expect(await ped(org.token, gana.cuenta)).toEqual({ estado: 200, cuerpo: { estado: "admitida", repetido: false } });
    expect(filas("altas_premio")).toMatchObject([{ sorteo: SORTEO, puesto: 1, cuenta: gana.cuenta, organizador: org.cuenta }]);
    expect(m.cupos.estaEnElLibro(gana.cuenta as string)).toBe(true);
    expect(m.cupos.quedan({ cuenta: gana.cuenta as string }, m.hora()).quedan).toBe(0);
  });

  it("después, /estado de quien ganó dice acceso premio, sin sorteos y sin la cuenta abierta todavía", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    await ped(org.token, gana.cuenta);
    expect(await m.estado(gana.token)).toMatchObject({
      estado: 200,
      cuerpo: { acceso: "premio", cuenta: gana.cuenta, abierta: false, sorteos: { quedan: 0, proximoVence: null } },
    });
  });

  it("con la cuenta ya abierta en la red, el alta pasa a abierta y cuenta como activación; mientras no, suma al piso de créditos", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    await ped(org.token, gana.cuenta);
    expect(m.cupos.prometido(m.hora()).altas).toBe(1);
    m.mover(1000);
    m.abiertas.add(gana.cuenta as string);
    expect(await m.estado(gana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "premio", abierta: true } });
    expect(m.cupos.altaDeCuenta(gana.cuenta as string)?.estado).toBe("abierta");
    expect(m.cupos.prometido(m.hora()).altas).toBe(0);
    expect(m.cupos.firmasExplicadas(T0 - DIA_MS, { sorteos: false }).activaciones).toBe(1);
  });

  it("el mismo puesto con la misma cuenta otra vez da repetido, sin escribir ni volver a la red", async () => {
    const { m, organiza, filas, lecturas, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    await ped(org.token, gana.cuenta);
    const antes = JSON.stringify(m.cupos.exportar(true));
    expect(await ped(org.token, gana.cuenta)).toEqual({ estado: 200, cuerpo: { estado: "admitida", repetido: true } });
    expect(JSON.stringify(m.cupos.exportar(true))).toBe(antes);
    expect(filas("altas_premio")).toHaveLength(1);
    expect(lecturas).toHaveLength(1);
  });

  it("el mismo puesto con otra cuenta da 409 puesto-usado, y esa otra cuenta no entra", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    const otra = Keypair.random().publicKey();
    await ped(org.token, gana.cuenta);
    expect(await ped(org.token, otra)).toEqual({ estado: 409, cuerpo: { motivo: "puesto-usado" } });
    expect(m.cupos.estaEnElLibro(otra)).toBe(false);
  });

  it("(ataque) otro sorteo con la misma lista y la misma ronda, sellado por fuera, da no-es-nuestro: el sello respalda uno solo", async () => {
    const { m, organiza, sorteos, filas, ped, pedir } = conPremio();
    const org = organiza();
    // El contrato acepta otro sorteo con el mismo organizador, lista y ronda, pero el portero no pagó su draw con su sello.
    sorteos.set("6", { ...(sorteos.get(SORTEO) as SorteoEnRed), id: 6n });
    expect(await ped(org.token, m.persona("usr_g1").cuenta)).toMatchObject({ estado: 200 });
    const gemelo = m.persona("usr_g2").cuenta;
    expect(await pedir(org.token, { sorteo: "6", puesto: 1, cuenta: gemelo })).toEqual({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(filas("altas_premio").map((f) => f.sorteo)).toEqual([SORTEO]);
    expect(m.cupos.estaEnElLibro(gemelo as string)).toBe(false);
  });

  it("(ataque) un sello de antes, que no sabe a qué sorteo respalda, da 403 no-es-nuestro: falla cerrado", async () => {
    const { m, ponerSorteo, filas, ped } = conPremio();
    const org = m.persona("usr_org");
    m.cupos.admitir(org.cuenta as string, "cupon", T0);
    ponerSorteo(org.cuenta as string, {}, true, false);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("(ataque) otro organizador que pide un puesto que ya se dio no se entera: da sorteo-ajeno y no puesto-usado", async () => {
    const { m, organiza, ped } = conPremio();
    const dueno = organiza();
    await ped(dueno.token, m.persona("usr_gana").cuenta);
    const intruso = m.persona("usr_intruso");
    m.cupos.admitir(intruso.cuenta as string, "cupon", T0);
    expect(await ped(intruso.token, Keypair.random().publicKey())).toEqual({
      estado: 403,
      cuerpo: { motivo: "sorteo-ajeno", detalle: "otro-organizador" },
    });
  });

  it("una cuenta que ya está en el libro da ya-tiene-acceso sin escribir nada", async () => {
    const { m, organiza, filas, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    m.cupos.admitir(gana.cuenta as string, "admin", T0);
    expect(await ped(org.token, gana.cuenta)).toEqual({ estado: 200, cuerpo: { estado: "ya-tiene-acceso" } });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("una cuenta que ya existe en la red da no-hace-falta sin escribir nada, después de comprobar el sorteo", async () => {
    const { m, organiza, filas, lecturas, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    m.abiertas.add(gana.cuenta as string);
    expect(await ped(org.token, gana.cuenta)).toEqual({ estado: 200, cuerpo: { estado: "no-hace-falta" } });
    expect(filas("altas_premio")).toEqual([]);
    expect(m.cupos.estaEnElLibro(gana.cuenta as string)).toBe(false);
    expect(lecturas).toEqual([BigInt(SORTEO)]);
  });

  it("(ataque) con el sorteo de otro organizador no se revela si una cuenta usa Tinkazo: da sorteo-ajeno y no ya-tiene-acceso", async () => {
    const { m, organiza, ped } = conPremio();
    organiza();
    const intruso = m.persona("usr_intruso");
    m.cupos.admitir(intruso.cuenta as string, "cupon", T0);
    const ajena = Keypair.random().publicKey();
    m.cupos.admitir(ajena, "admin", T0);
    expect(await ped(intruso.token, ajena)).toEqual({ estado: 403, cuerpo: { motivo: "sorteo-ajeno", detalle: "otro-organizador" } });
  });

  it("(ataque) con el sorteo de otro organizador no se revela si una cuenta existe en la red, y no se gasta una lectura de esa cuenta", async () => {
    const { m, organiza, ped } = conPremio();
    organiza();
    const intruso = m.persona("usr_intruso");
    m.cupos.admitir(intruso.cuenta as string, "cupon", T0);
    const ajena = Keypair.random().publicKey();
    m.abiertas.add(ajena);
    const leidas: string[] = [];
    const leer = m.red.leerCuenta.bind(m.red);
    m.red.leerCuenta = async (g: string) => {
      leidas.push(g);
      return leer(g);
    };
    expect(await ped(intruso.token, ajena)).toEqual({ estado: 403, cuerpo: { motivo: "sorteo-ajeno", detalle: "otro-organizador" } });
    expect(leidas).not.toContain(ajena);
  });

  it("(ataque) con un sorteo que no existe, sin sortear o sin sello del portero tampoco se revela si la cuenta ya tiene acceso", async () => {
    const { m, organiza, sorteos, ponerSorteo, ped } = conPremio();
    const org = organiza();
    const ajena = Keypair.random().publicKey();
    m.cupos.admitir(ajena, "admin", T0);
    sorteos.delete(SORTEO);
    expect(await ped(org.token, ajena)).toEqual({ estado: 403, cuerpo: { motivo: "sorteo-ajeno", detalle: "no-existe" } });
    ponerSorteo(org.cuenta as string, { sorteado: false }, false);
    expect(await ped(org.token, ajena)).toEqual({ estado: 409, cuerpo: { motivo: "sin-sortear" } });
    m.sql.exec("DELETE FROM sellos_portero");
    ponerSorteo(org.cuenta as string, {}, false);
    expect(await ped(org.token, ajena)).toEqual({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
  });

  it("(ataque) con un sorteo propio no se pregunta sin fin por otras cuentas: pasados los ganadores y unas pocas más, 429 cupo sorteo", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    const leidas: string[] = [];
    const leer = m.red.leerCuenta.bind(m.red);
    m.red.leerCuenta = async (g: string) => {
      leidas.push(g);
      return leer(g);
    };
    for (let i = 0; i < GANADORES + CONSULTAS_PREMIO_DE_MAS; i++) {
      const ajena = Keypair.random().publicKey();
      m.abiertas.add(ajena);
      expect(await ped(org.token, ajena)).toEqual({ estado: 200, cuerpo: { estado: "no-hace-falta" } });
    }
    const otra = Keypair.random().publicKey();
    m.cupos.admitir(otra, "admin", T0);
    const leidasAntes = leidas.length;
    expect(await ped(org.token, otra)).toEqual({ estado: 429, cuerpo: { motivo: "cupo", que: "sorteo" } });
    expect(leidas).toHaveLength(leidasAntes);
  });

  it("el tope de lo que se dice sin dar un alta no lo gastan las altas dadas, y vuelve a las 24 horas", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    for (let i = 0; i < GANADORES + CONSULTAS_PREMIO_DE_MAS - 1; i++) {
      const ajena = Keypair.random().publicKey();
      m.cupos.admitir(ajena, "admin", T0);
      expect(await ped(org.token, ajena)).toEqual({ estado: 200, cuerpo: { estado: "ya-tiene-acceso" } });
    }
    expect(await ped(org.token, m.persona("usr_g1").cuenta, 0)).toEqual({ estado: 200, cuerpo: { estado: "admitida", repetido: false } });
    expect(await ped(org.token, m.persona("usr_g2").cuenta, 1)).toEqual({ estado: 200, cuerpo: { estado: "admitida", repetido: false } });
    const ultima = Keypair.random().publicKey();
    m.cupos.admitir(ultima, "admin", T0);
    expect(await ped(org.token, ultima, 2)).toEqual({ estado: 200, cuerpo: { estado: "ya-tiene-acceso" } });
    const sobra = Keypair.random().publicKey();
    m.cupos.admitir(sobra, "admin", T0);
    expect(await ped(org.token, sobra, 2)).toEqual({ estado: 429, cuerpo: { motivo: "cupo", que: "sorteo" } });
    m.mover(DIA_MS);
    expect(await ped(org.token, sobra, 2)).toEqual({ estado: 200, cuerpo: { estado: "ya-tiene-acceso" } });
  });

  it("si la red no contesta si la cuenta existe, se toma como que no existe y sigue", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    m.red.caida = true;
    expect(await ped(org.token, gana.cuenta)).toEqual({ estado: 200, cuerpo: { estado: "admitida", repetido: false } });
  });

  it("(ataque) quien organiza y no está en el libro da 403 sin-acceso", async () => {
    const { m, organiza, ped } = conPremio();
    organiza();
    const fuera = m.persona("usr_fuera");
    expect(await ped(fuera.token, Keypair.random().publicKey())).toEqual({ estado: 403, cuerpo: { motivo: "sin-acceso" } });
  });

  it("(ataque) un sorteo de otro organizador da 403 sorteo-ajeno", async () => {
    const { m, organiza, ponerSorteo, ped } = conPremio();
    const org = organiza();
    ponerSorteo(Keypair.random().publicKey(), {}, false);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({
      estado: 403,
      cuerpo: { motivo: "sorteo-ajeno", detalle: "otro-organizador" },
    });
  });

  it("(ataque) un sorteo que no existe da 403 sorteo-ajeno no-existe", async () => {
    const { m, organiza, sorteos, ped } = conPremio();
    const org = organiza();
    sorteos.delete(SORTEO);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({
      estado: 403,
      cuerpo: { motivo: "sorteo-ajeno", detalle: "no-existe" },
    });
  });

  it("(ataque) un sorteo sin sortear da 409 sin-sortear", async () => {
    const { m, organiza, ponerSorteo, ped } = conPremio();
    const org = organiza();
    ponerSorteo(org.cuenta as string, { sorteado: false }, false);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 409, cuerpo: { motivo: "sin-sortear" } });
  });

  it("(ataque) un puesto que no existe en el sorteo (igual a los ganadores) da 400 puesto", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    expect(await ped(org.token, m.persona("usr_gana").cuenta, GANADORES)).toEqual({ estado: 400, cuerpo: { motivo: "puesto" } });
  });

  it("(ataque) un sello que no pagó el portero da 403 no-es-nuestro", async () => {
    const { m, organiza, ponerSorteo, filas, ped } = conPremio();
    const org = organiza();
    m.sql.exec("DELETE FROM sellos_portero");
    ponerSorteo(org.cuenta as string, {}, false);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 403, cuerpo: { motivo: "no-es-nuestro" } });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("si no se puede leer el sorteo da 502 red y no escribe nada", async () => {
    const { m, organiza, red, filas, ped } = conPremio();
    const org = organiza();
    red.sorteoCaido = true;
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("con los créditos por debajo del piso da 503 altas-pausadas, sin escribir, y lo anota sin cuenta, sorteo ni puesto", async () => {
    const { m, organiza, filas, ped } = conPremio();
    const org = organiza();
    m.pm.creditos = 0;
    const gana = m.persona("usr_gana");
    expect(await ped(org.token, gana.cuenta)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(filas("altas_premio")).toEqual([]);
    expect(m.cupos.estaEnElLibro(gana.cuenta as string)).toBe(false);
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "piso", donde: "premio" }]);
  });

  it("con las altas pausadas a mano da 503 altas-pausadas sin escribir", async () => {
    const { m, organiza, filas, ped } = conPremio();
    const org = organiza();
    m.cupos.fijarAjuste("altas_pausadas", "1", T0);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("con la pausa de alta-premio da 503 apagado pausado, sin leer nada, y las altas de siempre siguen", async () => {
    const { m, organiza, lecturas, ped } = conPremio();
    const org = organiza();
    m.cupos.fijarAjuste("altas_premio_pausado", "1", T0);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "pausado" } });
    expect(lecturas).toEqual([]);
    await m.lote([C1]);
    expect(await m.cupon(m.persona("usr_ana").token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
  });

  it("sin la tabla (no se pudo crear) da 503 apagado config y el resto de las rutas sigue andando", async () => {
    const roto = sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS altas_premio/);
    const { m, organiza, altasPremio, puerta, ped } = conPremio({}, { sql: roto });
    const org = organiza();
    expect(altasPremio.disponible()).toBe(false);
    expect(await ped(org.token, m.persona("usr_gana").cuenta)).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "config" } });
    expect(await puerta.resumen()).toMatchObject({ faltaAltas: ["tablas-alta-premio"] });
    expect(puerta.altaPremioAtiende()).toBe(false);
  });

  it("(ataque) el tope de altas del día se mueve en caliente: pasado, 429 cupo dia con la hora en que se libera", async () => {
    const { m, organiza, altasPremio, ped } = conPremio();
    const org = organiza();
    m.cupos.fijarAjuste("altas_premio_dia", "2", T0);
    // Una de otro organizador: con el tope en 2, cada organizador tiene una por día y el día se llena entre los dos.
    const otra = { contrato: m.cfg.contractId as string, sorteo: "21", puesto: 0, ganadores: 3, sello: "sello-21" };
    const deOtro = { ...otra, cuenta: Keypair.random().publicKey(), organizador: Keypair.random().publicKey() };
    expect(altasPremio.admitir(deOtro, T0, { altasPremioDia: 2 }, () => null)).toMatchObject({ ok: true });
    expect(await ped(org.token, m.persona("usr_g0").cuenta, 0)).toMatchObject({ estado: 200 });
    expect(await ped(org.token, m.persona("usr_g1").cuenta)).toEqual({
      estado: 429,
      cuerpo: { motivo: "cupo", que: "dia", liberaEn: T0 + DIA_MS },
    });
  });

  it("(ataque) con el tope del día en 100, una cuenta que organiza da 20 altas: la 21 da 429 cupo organizador", async () => {
    const { m, organiza, sorteos, ped } = conPremio();
    const org = organiza();
    sorteos.set(SORTEO, { ...(sorteos.get(SORTEO) as SorteoEnRed), ganadores: 50 });
    for (let puesto = 0; puesto < 20; puesto++) {
      expect(await ped(org.token, Keypair.random().publicKey(), puesto)).toMatchObject({ estado: 200, cuerpo: { estado: "admitida" } });
    }
    expect(await ped(org.token, Keypair.random().publicKey(), 20)).toMatchObject({ estado: 429, cuerpo: { motivo: "cupo", que: "organizador" } });
  });

  it("(ataque) sin sesión da 401, y con la sesión de otra app 403", async () => {
    const { m, ped } = conPremio();
    const cuenta = m.persona("usr_gana").cuenta;
    expect(await ped(null, cuenta)).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    m.pm.sesiones.set(tokenDe("usr_otra"), { usuario: "usr_otra", app: "app_de_otro" });
    expect(await ped(tokenDe("usr_otra"), cuenta)).toEqual({ estado: 403, cuerpo: { motivo: "otra-app" } });
  });

  it("(ataque) la cuenta de quien organiza como ganadora da 400 forma propia", async () => {
    const { organiza, ped } = conPremio();
    const org = organiza();
    expect(await ped(org.token, org.cuenta)).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "propia" } });
  });

  it("(ataque) una cuenta del portero (la que paga, la sorteadora o la de cobros) como ganadora da 400 forma del-portero", async () => {
    const sorteadora = Keypair.random().publicKey();
    const cobros = Keypair.random().publicKey();
    const { organiza, patrocinadora, filas, ped } = conPremio({ CUENTA_SORTEADORA: sorteadora, CUENTA_COBROS: cobros });
    const org = organiza();
    for (const cuenta of [patrocinadora, sorteadora, cobros]) {
      expect(await ped(org.token, cuenta)).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "del-portero" } });
    }
    expect(filas("altas_premio")).toEqual([]);
  });

  it("el cuerpo sin la forma da 400 forma con el campo que falla, antes de preguntar la sesión", async () => {
    const { m, pedir } = conPremio();
    const cuenta = Keypair.random().publicKey();
    const forma = (cuerpo: unknown) => pedir(tokenDe("usr_nadie"), cuerpo);
    expect(await forma({ puesto: 1, cuenta })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "sorteo" } });
    expect(await forma({ sorteo: "0", puesto: 1, cuenta })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "sorteo" } });
    expect(await forma({ sorteo: SORTEO, puesto: -1, cuenta })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "puesto" } });
    expect(await forma({ sorteo: SORTEO, puesto: 300, cuenta })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "puesto" } });
    expect(await forma({ sorteo: SORTEO, puesto: "1", cuenta })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "puesto" } });
    expect(await forma({ sorteo: SORTEO, puesto: 1 })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "cuenta" } });
    expect(await forma({ sorteo: SORTEO, puesto: 1, cuenta: "GABC" })).toEqual({ estado: 400, cuerpo: { motivo: "forma", detalle: "cuenta" } });
    expect(m.pm.llamadas).toEqual([]);
  });

  it("(ataque) con el acceso atado a otra cuenta que la de esta sesión da 409 cuenta-de-otro, como /estado", async () => {
    const { m, organiza, filas, ped } = conPremio();
    const org = organiza();
    await m.lote([C1]);
    expect(await m.cupon(org.token, C1)).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(org.token, { usuario: "usr_org", wallet: { publicKey: Keypair.random().publicKey(), chain: "STELLAR" } });
    expect(await ped(org.token, Keypair.random().publicKey())).toEqual({ estado: 409, cuerpo: { motivo: "cuenta-de-otro" } });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("no deja nada de la cuenta, del sorteo ni del puesto en la bitácora", async () => {
    const { m, organiza, ped } = conPremio();
    const org = organiza();
    const gana = m.persona("usr_gana");
    await ped(org.token, gana.cuenta, 2);
    expect(m.anotado.filter(([evento]) => evento === "alta-premio")).toEqual([["alta-premio", undefined]]);
    const todo = JSON.stringify(m.anotado);
    for (const prohibido of [gana.cuenta as string, org.cuenta as string, org.token, gana.token, HUELLA]) expect(todo).not.toContain(prohibido);
  });

  it("altaPremioAtiende y altaPremioDelEstado dicen lo que ve el sitio: prendida, pausada y cuántas se dieron", async () => {
    const { m, organiza, puerta, ped } = conPremio();
    const org = organiza();
    expect(puerta.altaPremioAtiende()).toBe(true);
    expect(puerta.altaPremioDelEstado()).toEqual({ prendido: true, hoy: 0, cercaDelTope: false });
    await ped(org.token, m.persona("usr_gana").cuenta);
    expect(puerta.altaPremioDelEstado()).toEqual({ prendido: true, hoy: 1, cercaDelTope: false });
    m.cupos.fijarAjuste("altas_premio_pausado", "1", T0);
    expect(puerta.altaPremioAtiende()).toBe(false);
  });

  it("el estado avisa cuando las altas del día llegan al 80 por ciento del tope, y la bitácora lo anota al cruzarlo, sin cuentas", async () => {
    const { m, organiza, puerta, altasPremio, ped } = conPremio();
    const org = organiza();
    m.cupos.fijarAjuste("altas_premio_dia", "5", T0);
    // Tres altas de otros organizadores, cada uno con su sorteo: con el tope en 5, cada organizador tiene una por día.
    for (const sorteo of ["21", "22", "23"]) {
      const alta = { contrato: m.cfg.contractId as string, sorteo, puesto: 0, ganadores: 3, sello: `sello-${sorteo}` };
      const p = { ...alta, cuenta: Keypair.random().publicKey(), organizador: Keypair.random().publicKey() };
      expect(altasPremio.admitir(p, T0, { altasPremioDia: 5 }, () => null)).toMatchObject({ ok: true });
    }
    expect(puerta.altaPremioDelEstado()).toEqual({ prendido: true, hoy: 3, cercaDelTope: false });
    expect(m.anotado.filter(([e]) => e === "alerta-altas-premio")).toEqual([]);
    const gana = m.persona("usr_gana");
    expect(await ped(org.token, gana.cuenta, 0)).toMatchObject({ estado: 200, cuerpo: { estado: "admitida" } });
    expect(puerta.altaPremioDelEstado()).toEqual({ prendido: true, hoy: 4, cercaDelTope: true });
    expect(m.anotado.filter(([e]) => e === "alerta-altas-premio")).toEqual([["alerta-altas-premio", { hoy: 4, tope: 5 }]]);
  });

  it("con las altas pausadas a mano altaPremioAtiende dice que no, porque la ruta contestaría altas-pausadas", async () => {
    const { m, puerta } = conPremio();
    expect(puerta.altaPremioAtiende()).toBe(true);
    m.cupos.fijarAjuste("altas_pausadas", "1", T0);
    expect(puerta.altaPremioAtiende()).toBe(false);
  });

  it("con ALTAS_PREMIO apagada nada atiende: la puerta no la conoce y las otras rutas siguen como hoy", async () => {
    const apagada = conPremio({ ALTAS_PREMIO: "0" });
    expect(apagada.puerta.altaPremioAtiende()).toBe(false);
    expect(apagada.puerta.altaPremioDelEstado()).toEqual({ prendido: false, hoy: 0, cercaDelTope: false });
    const org = apagada.organiza();
    expect(await apagada.ped(org.token, Keypair.random().publicKey())).toEqual({
      estado: 503,
      cuerpo: { motivo: "apagado", detalle: "config" },
    });
  });
});

describe("la puerta del Worker para el alta de quien ganó", () => {
  const apagada = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
  const prendida = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", ALTAS_PREMIO: "1" });
  /** Un pedido de un navegador del sitio: con su origen, su dirección y, si se dice, la sesión. */
  const pedido = (ruta: string, init: { metodo?: string; cuerpo?: string; token?: string } = {}) => {
    const headers: Record<string, string> = { Origin: "https://tinkazo.app", "CF-Connecting-IP": IP };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    return new Request(`https://pm.tinkazo.app${ruta}`, { method: init.metodo ?? "POST", headers, ...(init.cuerpo ? { body: init.cuerpo } : {}) });
  };
  /** Lo que el objeto vería: cada acción con su sesión y su cuerpo. */
  const espia = () => {
    const vistos: Array<{ accion: string; token: string | null; cuerpo: unknown }> = [];
    const llamar = async (accion: string, p: { token: string | null; cuerpo: unknown }) => {
      vistos.push({ accion, token: p.token, cuerpo: p.cuerpo });
      return { estado: 200, cuerpo: {} };
    };
    return { vistos, llamar };
  };

  it("con ALTAS_PREMIO apagada la ruta no existe: 404 no-existe, sin llegar al objeto", async () => {
    expect(apagada.altasPremio).toBe(false);
    const e = espia();
    const r = (await atenderAlta(pedido("/v1/alta/premio", { cuerpo: "{}" }), apagada, e.llamar, new PorIp())) as Response;
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ motivo: "no-existe" });
    expect(e.vistos).toEqual([]);
  });

  it("con ALTAS_PREMIO apagada las demás rutas de /v1/alta siguen como hoy", async () => {
    const e = espia();
    for (const ruta of ["estado", "cupon", "abrir"]) {
      const r = (await atenderAlta(pedido(`/v1/alta/${ruta}`, { cuerpo: "{}" }), apagada, e.llamar, new PorIp())) as Response;
      expect(r.status).toBe(200);
    }
    expect(e.vistos.map((v) => v.accion)).toEqual(["estado", "cupon", "abrir"]);
  });

  it("con ALTAS_PREMIO prendida la ruta llega al objeto con la sesión y el cuerpo", async () => {
    expect(prendida.altasPremio).toBe(true);
    const e = espia();
    const cuerpo = { sorteo: "5", puesto: 1, cuenta: "G" };
    const req = pedido("/v1/alta/premio", { cuerpo: JSON.stringify(cuerpo), token: "tok_abc" });
    const r = (await atenderAlta(req, prendida, e.llamar, new PorIp())) as Response;
    expect(r.status).toBe(200);
    expect(e.vistos).toEqual([{ accion: "premio", token: "tok_abc", cuerpo }]);
  });

  it("el preflight de la ruta es el de siempre, con la variable apagada o prendida", async () => {
    for (const cfg of [apagada, prendida]) {
      const r = (await atenderAlta(pedido("/v1/alta/premio", { metodo: "OPTIONS" }), cfg, espia().llamar, new PorIp())) as Response;
      expect(r.status).toBe(204);
    }
  });
});
