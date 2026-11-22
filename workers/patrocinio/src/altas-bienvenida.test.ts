/**
 * El regalo de bienvenida (`POST /v1/alta/gratis`): quien entra con su cuenta activa y recibe sus sorteos oficiales una vez,
 * sin cupón. Activar y regalar van separados: si el regalo no entra, la cuenta se activa igual. Sin red ni reloj real.
 */
import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { huella } from "./altas";
import { AltasPorPremio } from "./altas-premio";
import { IP, SECRETO_CUPON, T0, codigo, montarAltas } from "./altas-prueba";
import { montarPagos } from "./cobros-prueba";
import { ALTA_SIN_ABRIR_DIAS } from "./cupos";
import { DIA_MS, leerConfig } from "./config";
import { MEMORIA_CREDITOS_MS, MEMORIA_SESION_MS } from "./pollar";
import { PorIp } from "./por-ip";
import { ALTAS_PREMIO_GUARDADAS, atenderAlta, frenoEnCaliente, preciosPublicos } from "./rutas-altas";
import { Portero, firmanteDe } from "./servicio";
import type { Red } from "./red";

const HORA_MS = 3_600_000;
/** Lo que pide el regalo con los valores por defecto: 3 sorteos a 40 créditos. Activar pide 30 más. */
const REGALO = 3 * 40;
const ALTA = 30;
/** El margen del regalo por defecto, por encima del piso. */
const RESERVA = 3000;
const VENCE = T0 + 60 * DIA_MS;

/** Los sorteos dados por el regalo de una persona, con su dueño y su cuenta. */
const regalosDe = (m: ReturnType<typeof montarAltas>, usuario: string) =>
  m.sql.exec("SELECT usuario, cuenta, origen, sorteos FROM derechos WHERE ref = ?", `gratis:${usuario}`).toArray();
const cuantasAltas = (m: ReturnType<typeof montarAltas>) => Number(m.sql.exec("SELECT COUNT(*) AS n FROM altas").toArray()[0]?.n);

describe("POST /v1/alta/gratis", () => {
  it("activa la cuenta, da 3 sorteos oficiales por 60 días y devuelve sigue", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    expect(await m.gratis(ana.token)).toEqual({
      estado: 200,
      cuerpo: {
        ok: true,
        repetido: false,
        sorteosSumados: 3,
        sorteos: { quedan: 3, proximoVence: { fecha: VENCE, cuantos: 3 } },
        regalo: "dado",
        sigue: "activar",
      },
    });
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    expect(regalosDe(m, "usr_ana")).toEqual([{ usuario: "usr_ana", cuenta: ana.cuenta, origen: "gratis", sorteos: 3 }]);
    const cuerpo = { acceso: "admin", cuenta: ana.cuenta, sorteos: { quedan: 3 }, bienvenida: null };
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo });
    // Lo que se anota lleva solo cifras.
    expect(m.anotado).toContainEqual(["alta-bienvenida", { altaNueva: 1, sorteos: 3 }]);
  });

  it("con la cuenta ya abierta en la red, sigue es lista", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    m.abiertas.add(ana.cuenta as string);
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sigue: "lista" } });
    expect(m.cupos.altaDe("usr_ana")?.estado).toBe("abierta");
  });

  it("sin billetera todavía, recibe igual y la cuenta se ata cuando aparece", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana", null);
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sorteos: { quedan: 3 }, sigue: "crear-billetera" } });
    const g = Keypair.random().publicKey();
    m.pm.billeteras.set("usr_ana", g);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "admin", cuenta: g, sorteos: { quedan: 3 } } });
    expect(m.cupos.quedan({ cuenta: g }, m.hora()).quedan).toBe(3);
  });

  it("repetido no suma: la segunda vez dice ya, sin otro derecho", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.gratis(ana.token);
    const cuerpo = { ok: true, repetido: true, sorteosSumados: 0, sorteos: { quedan: 3 }, regalo: "ya" };
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo });
    expect(regalosDe(m, "usr_ana")).toHaveLength(1);
    expect(cuantasAltas(m)).toBe(1);
  });

  it("quien ganó un premio recibe sus 3 en esa misma alta", async () => {
    const m = montarAltas({ ALTAS_PREMIO: "1" });
    const gana = m.persona("usr_gana");
    const g = gana.cuenta as string;
    const premio = new AltasPorPremio(m.sql, m.cupos);
    const organizador = Keypair.random().publicKey();
    const pedido = { contrato: "contrato-de-prueba", sorteo: "7", puesto: 0, cuenta: g, organizador, ganadores: 3, sello: "a".repeat(64) };
    expect(premio.admitir(pedido, T0, { altasPremioDia: 100 }, () => null)).toMatchObject({ ok: true, estado: "admitida" });
    const antes = { acceso: "premio", sorteos: { quedan: 0 }, bienvenida: { estado: "lista", sorteos: 3 } };
    expect(await m.estado(gana.token)).toMatchObject({ cuerpo: antes });
    expect(await m.gratis(gana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sorteosSumados: 3, sorteos: { quedan: 3 } } });
    // En el alta de su premio, con su cuenta: no nace otra.
    expect(regalosDe(m, "usr_gana")).toEqual([{ usuario: `cuenta:${g}`, cuenta: g, origen: "gratis", sorteos: 3 }]);
    expect(cuantasAltas(m)).toBe(1);
    expect(await m.estado(gana.token)).toMatchObject({ cuerpo: { acceso: "premio", sorteos: { quedan: 3 }, bienvenida: null } });
    expect(await m.gratis(gana.token)).toMatchObject({ cuerpo: { regalo: "ya", sorteosSumados: 0 } });
  });

  it("quien ya canjeó un cupón también recibe sus 3, una sola vez", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([codigo(1)]);
    expect((await m.cupon(ana.token, codigo(1))).estado).toBe(200);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "cupon", bienvenida: { estado: "lista", sorteos: 3 } } });
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sorteosSumados: 3, sorteos: { quedan: 6 } } });
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "ya", sorteosSumados: 0, sorteos: { quedan: 6 } } });
    // El alta sigue siendo la del cupón.
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "cupon", sorteos: { quedan: 6 }, bienvenida: null } });
  });

  it("un alta gratis que se activó sin regalo lo recibe después, con otro toque", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    const lleno = { ok: true, repetido: false, sorteosSumados: 0, sorteos: { quedan: 0 }, regalo: "lleno", sigue: "activar" };
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: lleno });
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "admin", bienvenida: { estado: "llena", sorteos: 3 } } });
    m.cupos.fijarAjuste("bienvenida_cerrada", "0", T0);
    m.mover(DIA_MS);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "admin", bienvenida: { estado: "lista", sorteos: 3 } } });
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sorteosSumados: 3, sorteos: { quedan: 3 } } });
    expect(cuantasAltas(m)).toBe(1);
  });

  it("con la cuenta de otra persona, 409 cuenta-de-otro y nada escrito para quien la pide", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.gratis(ana.token);
    const beto = m.persona("usr_beto", ana.cuenta);
    expect(await m.gratis(beto.token)).toEqual({ estado: 409, cuerpo: { motivo: "cuenta-de-otro" } });
    expect(m.cupos.altaDe("usr_beto")).toBeNull();
    expect(regalosDe(m, "usr_beto")).toEqual([]);
    expect(m.anotado).toContainEqual(["error-alta", { motivo: "cuenta-de-otro" }]);
  });

  it("con el alta atada a otra cuenta que la de la sesión, 409 sin escribir", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    await m.gratis(ana.token);
    m.cupos.fijarAjuste("bienvenida_cerrada", "0", T0);
    // La sesión vuelve a verificarse (pasó su memoria) y ahora Pollar dice otra billetera.
    m.mover(MEMORIA_SESION_MS + 1);
    m.pm.sesiones.set(ana.token, { usuario: "usr_ana", wallet: { publicKey: Keypair.random().publicKey(), chain: "STELLAR" } });
    expect(await m.gratis(ana.token)).toEqual({ estado: 409, cuerpo: { motivo: "cuenta-de-otro" } });
    expect(regalosDe(m, "usr_ana")).toEqual([]);
  });

  it("dos pedidos a la vez de la misma persona dan un solo regalo", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const [a, b] = await Promise.all([m.gratis(ana.token), m.gratis(ana.token)]);
    const regalos = [a, b].map((x) => (x.cuerpo as { regalo: string }).regalo).sort();
    expect(regalos).toEqual(["dado", "ya"]);
    expect(regalosDe(m, "usr_ana")).toHaveLength(1);
    expect(m.cupos.quedan({ usuario: "usr_ana" }, m.hora()).quedan).toBe(3);
  });

  it("diez personas a la vez desde la misma conexión reciben las diez: sin tope por conexión", async () => {
    const m = montarAltas();
    const gente = Array.from({ length: 10 }, (_, i) => m.persona(`usr_${i}`));
    const res = await Promise.all(gente.map((x) => m.gratis(x.token, IP)));
    expect(res.map((x) => [x.estado, (x.cuerpo as { regalo: string }).regalo])).toEqual(Array.from({ length: 10 }, () => [200, "dado"]));
    expect(cuantasAltas(m)).toBe(10);
  });

  it("el piso frena el regalo pero la cuenta se activa igual, y lo anota una vez en el día", async () => {
    // Sin el margen del regalo, para mirar el piso solo (el margen tiene sus pruebas abajo).
    const m = montarAltas({ RESERVA_REGALO_CREDITOS: "0" });
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    // Alcanza para activar (300 de base más 30) y no para el regalo.
    m.pm.creditos = 300 + ALTA + REGALO - 1;
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { bienvenida: { estado: "llena", sorteos: 3 } } });
    const lleno = { ok: true, repetido: false, sorteosSumados: 0, regalo: "lleno", sigue: "activar" };
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: lleno });
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "admin", sorteos: { quedan: 0 }, bienvenida: { estado: "llena" } } });
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    await m.gratis(beto.token);
    expect(m.anotado.filter(([e]) => e === "alta-bienvenida-llena")).toEqual([["alta-bienvenida-llena", { causa: "piso" }]]);
    // Con créditos de vuelta, lo recibe.
    m.pm.creditos = 100_000;
    m.mover(MEMORIA_CREDITOS_MS + 1);
    expect(await m.gratis(ana.token)).toMatchObject({ cuerpo: { regalo: "dado", sorteos: { quedan: 3 } } });
  });

  it("si ni siquiera se puede activar, 503 bienvenida-llena sin escribir nada", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    m.pm.creditos = 300 + ALTA - 1;
    expect(await m.gratis(ana.token)).toEqual({ estado: 503, cuerpo: { motivo: "bienvenida-llena" } });
    expect(cuantasAltas(m)).toBe(0);
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(false);
  });

  it("el piso protege a quien ya tiene sorteos: el regalo no se come su lugar", async () => {
    // Sin el margen del regalo, para mirar el piso solo.
    const m = montarAltas({ RESERVA_REGALO_CREDITOS: "0" });
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    // Ana ya tiene 3 sorteos sin usar: el piso es 300 + 150.
    await m.gratis(ana.token);
    m.pm.creditos = 300 + (ALTA + REGALO) * 2 - 1;
    m.mover(MEMORIA_CREDITOS_MS + 1);
    expect(await m.gratis(beto.token)).toMatchObject({ cuerpo: { regalo: "lleno" } });
    expect(m.cupos.quedan({ usuario: "usr_ana" }, m.hora()).quedan).toBe(3);
  });

  it("con las altas pausadas a mano, 503 altas-pausadas; lo ya dado sigue", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.gratis(ana.token);
    m.cupos.fijarAjuste("altas_pausadas", "1", T0);
    expect(await m.gratis(beto.token)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.cupos.altaDe("usr_beto")).toBeNull();
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "a-mano", donde: "bienvenida" }]);
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "ya" } });
    expect(await m.estado(beto.token)).toMatchObject({ cuerpo: { bienvenida: { estado: "llena", sorteos: 3 } } });
    expect(m.puerta.bienvenidaPublica()).toBe(0);
  });

  it("el interruptor cerrado deja bienvenida en llena, no en null, y los precios en 0", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    expect(m.puerta.bienvenidaPublica()).toBe(3);
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "ninguno", bienvenida: { estado: "llena", sorteos: 3 } } });
    expect(m.puerta.bienvenidaPublica()).toBe(0);
    // Cerrado por la variable: igual, y sin preguntarle al objeto.
    const cerrada = montarAltas({ BIENVENIDA: "0" });
    expect(await cerrada.estado(cerrada.persona("usr_ana").token)).toMatchObject({ cuerpo: { bienvenida: { estado: "llena", sorteos: 3 } } });
    expect(preciosPublicos(cerrada.cfg)).toMatchObject({ bienvenida: 0 });
  });

  it("con el regalo cerrado por la variable, /gratis activa la cuenta y contesta regalo lleno", async () => {
    const m = montarAltas({ BIENVENIDA: "0" });
    const ana = m.persona("usr_ana");
    const lleno = { ok: true, repetido: false, sorteosSumados: 0, sorteos: { quedan: 0 }, regalo: "lleno", sigue: "activar" };
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: lleno });
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ motivo: "admin", estado: "autorizada" });
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    expect(regalosDe(m, "usr_ana")).toEqual([]);
    expect(m.anotado).toContainEqual(["alta-bienvenida-llena", { causa: "cerrado" }]);
    // Sigue sin recibirlo: /estado lo dice lleno, nunca null.
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { sorteos: { quedan: 0 }, bienvenida: { estado: "llena", sorteos: 3 } } });
  });

  it("con el regalo cerrado en caliente, /gratis activa con regalo lleno; la pausa a mano frena también activar", async () => {
    const m = montarAltas();
    const [ana, beto] = [m.persona("usr_ana"), m.persona("usr_beto")];
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "lleno", sorteosSumados: 0 } });
    expect(m.cupos.altaDe("usr_ana")?.estado).toBe("autorizada");
    m.cupos.fijarAjuste("altas_pausadas", "1", T0);
    expect(await m.gratis(beto.token)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.cupos.altaDe("usr_beto")).toBeNull();
  });

  it("un freno por día puesto en caliente frena el regalo y sacarlo lo vuelve a abrir", async () => {
    const m = montarAltas();
    const [ana, beto] = [m.persona("usr_ana"), m.persona("usr_beto")];
    m.cupos.fijarAjuste("bienvenida_dia", "1", T0);
    expect(await m.gratis(ana.token)).toMatchObject({ cuerpo: { regalo: "dado" } });
    expect(await m.gratis(beto.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "lleno" } });
    expect(m.anotado).toContainEqual(["alta-bienvenida-llena", { causa: "dia" }]);
    m.cupos.fijarAjuste("bienvenida_dia", "0", T0);
    expect(await m.gratis(beto.token)).toMatchObject({ cuerpo: { regalo: "dado" } });
  });

  it("el freno por hora es una ventana móvil", async () => {
    const m = montarAltas({ BIENVENIDA_HORA: "1" });
    const [ana, beto] = [m.persona("usr_ana"), m.persona("usr_beto")];
    expect(await m.gratis(ana.token)).toMatchObject({ cuerpo: { regalo: "dado" } });
    m.mover(HORA_MS - 1);
    expect(await m.gratis(beto.token)).toMatchObject({ cuerpo: { regalo: "lleno" } });
    m.mover(2);
    expect(await m.gratis(beto.token)).toMatchObject({ cuerpo: { regalo: "dado" } });
  });

  it("el freno por conexión, si se pone, cuenta por dirección", async () => {
    const m = montarAltas({ BIENVENIDA_POR_IP: "2" });
    const gente = Array.from({ length: 3 }, (_, i) => m.persona(`usr_${i}`));
    for (const x of gente.slice(0, 2)) expect(await m.gratis(x.token, IP)).toMatchObject({ cuerpo: { regalo: "dado" } });
    expect(await m.gratis(gente[2]!.token, IP)).toMatchObject({ cuerpo: { regalo: "lleno" } });
    expect(await m.gratis(gente[2]!.token, "200.87.1.1")).toMatchObject({ cuerpo: { regalo: "dado" } });
  });

  it("los frenos en caliente: un número desde 1 manda, 0 o algo mal escrito vuelve a la variable", () => {
    expect(frenoEnCaliente(undefined, null)).toBeNull();
    expect(frenoEnCaliente("5", null)).toBe(5);
    expect(frenoEnCaliente("0", null)).toBeNull();
    expect(frenoEnCaliente("0", 7)).toBe(7);
    expect(frenoEnCaliente("abc", 7)).toBe(7);
    expect(frenoEnCaliente("100001", null)).toBeNull();
  });

  it("los ajustes en caliente del regalo pasan por la ruta de ajustes, con su techo", async () => {
    const m = montarAltas();
    const red: Red = {
      simular: async () => ({ ok: true, minResourceFee: 40_000 }),
      leerCuenta: async () => null,
      enviar: async () => ({ status: "PENDING" }),
      consultar: async () => ({ status: "NOT_FOUND" }),
    };
    const p = new Portero(m.cfg, m.cupos, red, await firmanteDe(Keypair.random().secret()), Keypair.random().publicKey(), m.hora);
    expect(p.ajustar("bienvenida_cerrada", 1)).toBe(true);
    expect(m.cupos.ajuste("bienvenida_cerrada")).toBe("1");
    expect(p.ajustar("bienvenida_cerrada", 2)).toBe(false);
    expect(p.ajustar("bienvenida_dia", 30)).toBe(true);
    expect(p.ajustar("bienvenida_hora", 0)).toBe(true);
    expect(p.ajustar("bienvenida_ip", 100_001)).toBe(false);
    expect(p.ajustar("bienvenida_ip", 1.5)).toBe(false);
  });
});

describe("el margen del regalo", () => {
  /** Un saldo de Pollar como lo da `creditos()`, para mirar el freno de un alta de premio como lo mira su ruta. */
  const saldo = (disponibles: number, leido: number) => ({ ok: true as const, disponibles, leido, deMemoria: false });

  it("con el margen justo el regalo frena, la cuenta se activa igual y en la misma jugada un cupón y una orden pasan", async () => {
    const m = montarPagos();
    const [beto, ana, carla] = [m.persona("usr_beto"), m.persona("usr_ana"), m.persona("usr_carla")];
    await m.lote([codigo(1)]);
    // Un crédito menos de lo que pide el regalo de alguien sin alta: 300 de base, el alta, sus 3 sorteos y el margen.
    m.pm.creditos = 300 + ALTA + REGALO + RESERVA - 1;
    const lleno = { ok: true, repetido: false, sorteosSumados: 0, sorteos: { quedan: 0 }, regalo: "lleno" };
    expect(await m.puerta.gratis({ token: beto.token, ip: IP, cuerpo: {} })).toMatchObject({ estado: 200, cuerpo: lleno });
    expect(m.cupos.altaDe("usr_beto")?.estado).toBe("autorizada");
    expect(m.anotado).toContainEqual(["alta-bienvenida-llena", { causa: "margen" }]);
    // Los cupones y las órdenes miran el piso solo, sin el margen.
    expect(await m.cupon(ana.token, codigo(1))).toMatchObject({ estado: 200, cuerpo: { sorteosSumados: 3 } });
    expect(await m.orden(carla.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "alta" } } });
  });

  it("con un crédito más, el mismo regalo pasa", async () => {
    const m = montarAltas();
    m.pm.creditos = 300 + ALTA + REGALO + RESERVA;
    expect(await m.gratis(m.persona("usr_beto").token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sorteosSumados: 3 } });
  });

  it("con el margen justo, /estado dice llena a quien todavía no lo recibió", async () => {
    const m = montarAltas();
    m.pm.creditos = 300 + ALTA + REGALO + RESERVA - 1;
    expect(await m.estado(m.persona("usr_beto").token)).toMatchObject({ cuerpo: { bienvenida: { estado: "llena", sorteos: 3 } } });
  });

  it("la variable fija el margen: en 0 el regalo llega hasta el piso", async () => {
    const m = montarAltas({ RESERVA_REGALO_CREDITOS: "0" });
    expect(m.puerta.reservaRegalo()).toBe(0);
    m.pm.creditos = 300 + ALTA + REGALO;
    expect(await m.gratis(m.persona("usr_beto").token)).toMatchObject({ cuerpo: { regalo: "dado" } });
  });

  it("el ajuste en caliente cambia el margen sin desplegar", async () => {
    const m = montarAltas();
    m.pm.creditos = 300 + ALTA + REGALO + 500;
    m.cupos.fijarAjuste("reserva_regalo", "500", T0);
    expect(m.puerta.reservaRegalo()).toBe(500);
    expect(await m.gratis(m.persona("usr_beto").token)).toMatchObject({ cuerpo: { regalo: "dado" } });
  });

  it("el ajuste en 0, sin poner o por encima del techo vuelve al de la variable", () => {
    const m = montarAltas({ RESERVA_REGALO_CREDITOS: "1200" });
    expect(m.puerta.reservaRegalo()).toBe(1200);
    m.cupos.fijarAjuste("reserva_regalo", "800", T0);
    expect(m.puerta.reservaRegalo()).toBe(800);
    m.cupos.fijarAjuste("reserva_regalo", "0", T0);
    expect(m.puerta.reservaRegalo()).toBe(1200);
    m.cupos.fijarAjuste("reserva_regalo", "50001", T0);
    expect(m.puerta.reservaRegalo()).toBe(1200);
    m.cupos.fijarAjuste("reserva_regalo", "50000", T0);
    expect(m.puerta.reservaRegalo()).toBe(50_000);
  });

  it("la ruta de ajustes acepta el margen de 0 a 50.000, en enteros", async () => {
    const m = montarAltas();
    const red: Red = {
      simular: async () => ({ ok: true, minResourceFee: 40_000 }),
      leerCuenta: async () => null,
      enviar: async () => ({ status: "PENDING" }),
      consultar: async () => ({ status: "NOT_FOUND" }),
    };
    const p = new Portero(m.cfg, m.cupos, red, await firmanteDe(Keypair.random().secret()), Keypair.random().publicKey(), m.hora);
    expect(p.ajustar("reserva_regalo", 10_000)).toBe(true);
    expect(m.cupos.ajuste("reserva_regalo")).toBe("10000");
    expect(m.puerta.reservaRegalo()).toBe(10_000);
    expect(p.ajustar("reserva_regalo", 0)).toBe(true);
    expect(m.puerta.reservaRegalo()).toBe(RESERVA);
    expect(p.ajustar("reserva_regalo", 50_000)).toBe(true);
    expect(p.ajustar("reserva_regalo", 50_001)).toBe(false);
    expect(p.ajustar("reserva_regalo", 1.5)).toBe(false);
    expect(p.ajustar("reserva_regalo", -1)).toBe(false);
  });

  /** Personas nuevas, una tras otra, con 5.000 créditos y los valores de mainnet: cómo termina cada una. */
  const tanda = async (env: Record<string, string>, cuantas = 40) => {
    const m = montarAltas({ CREDITOS_POR_SORTEO: "40", CREDITOS_POR_ALTA: "30", ...env });
    m.pm.creditos = 5000;
    const fin: string[] = [];
    for (let i = 0; i < cuantas; i++) {
      const r = await m.gratis(m.persona(`usr_${i}`).token);
      fin.push(r.estado === 200 ? String((r.cuerpo as { regalo: unknown }).regalo) : String(r.cuerpo.motivo));
    }
    return fin;
  };

  it("con 5.000 créditos y el margen de 3.000 pasan 11 regalos y las 91 personas siguientes se activan sin regalo", async () => {
    const fin = await tanda({}, 105);
    expect(fin.filter((x) => x === "dado")).toHaveLength(11);
    // Después del regalo, activar deja solo el lugar de diez altas de premio: 5.000 - 30 >= 1.950 + 30 x 90 + 300.
    expect(fin.slice(0, 103)).toEqual([...Array<string>(11).fill("dado"), ...Array<string>(91).fill("lleno"), "bienvenida-llena"]);
  });

  it("con 5.000 créditos y el margen en 0 pasarían 31 regalos", async () => {
    const fin = await tanda({ RESERVA_REGALO_CREDITOS: "0" });
    expect(fin.slice(0, 33)).toEqual([...Array<string>(31).fill("dado"), "lleno", "bienvenida-llena"]);
  });

  it("con el regalo cerrado, la cuenta se activa aunque el saldo no llegue al margen del regalo", async () => {
    const m = montarAltas();
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    // Muy por debajo del piso más el margen de 3.000: alcanza para el alta y el lugar de diez altas de premio.
    m.pm.creditos = 300 + ALTAS_PREMIO_GUARDADAS * ALTA + ALTA;
    expect(await m.gratis(m.persona("usr_ana").token)).toMatchObject({ estado: 200, cuerpo: { regalo: "lleno", sorteosSumados: 0 } });
    expect(m.cupos.altaDe("usr_ana")?.estado).toBe("autorizada");
  });

  it("activar nunca pide más que regalar: con un margen del regalo chico, el lugar guardado es ese margen", async () => {
    const m = montarAltas();
    m.cupos.fijarAjuste("reserva_regalo", "100", T0);
    // Alcanza para el alta con el margen de 100, no para el regalo.
    m.pm.creditos = 300 + 100 + ALTA;
    expect(await m.gratis(m.persona("usr_ana").token)).toMatchObject({ estado: 200, cuerpo: { regalo: "lleno" } });
    expect(cuantasAltas(m)).toBe(1);
  });

  it("activar sin regalo deja el lugar de diez altas de premio: una tanda de activaciones no se come el de quien ganó", async () => {
    const m = montarAltas({ ALTAS_PREMIO: "1" });
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    // Alcanza para dos activaciones encima del piso y el lugar de las altas de premio.
    const creditos = 300 + ALTAS_PREMIO_GUARDADAS * ALTA + 2 * ALTA;
    m.pm.creditos = creditos;
    const gente = Array.from({ length: 3 }, (_, i) => m.persona(`usr_${i}`));
    const res: number[] = [];
    for (const x of gente) res.push((await m.gratis(x.token)).estado);
    expect(res).toEqual([200, 200, 503]);
    expect(cuantasAltas(m)).toBe(2);
    // Quien organiza nombra a quien ganó: su alta mira el piso solo, como en su ruta, y todavía tiene lugar.
    const premio = new AltasPorPremio(m.sql, m.cupos);
    const [g, organizador] = [Keypair.random().publicKey(), Keypair.random().publicKey()];
    const pedido = { contrato: "contrato-de-prueba", sorteo: "7", puesto: 0, cuenta: g, organizador, ganadores: 3, sello: "a".repeat(64) };
    const freno = () => (m.puerta.pausa(saldo(creditos, m.hora()), ALTA, m.hora()) ? ("altas-pausadas" as const) : null);
    expect(premio.admitir(pedido, m.hora(), { altasPremioDia: 100 }, freno)).toMatchObject({ ok: true, estado: "admitida" });
  });
});

describe("/v1/alta/estado con la bienvenida", () => {
  it("lista sin alta, null cuando ya lo recibió, y nunca escribe nada por mirarla", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "ninguno", bienvenida: { estado: "lista", sorteos: 3 } } });
    expect(cuantasAltas(m)).toBe(0);
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(false);
    await m.gratis(ana.token);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { bienvenida: null } });
  });

  it("llena con un freno lleno, aunque la persona todavía no tenga alta", async () => {
    const m = montarAltas({ BIENVENIDA_DIA: "1" });
    const [ana, beto] = [m.persona("usr_ana"), m.persona("usr_beto")];
    await m.gratis(ana.token);
    expect(await m.estado(beto.token)).toMatchObject({ cuerpo: { acceso: "ninguno", bienvenida: { estado: "llena", sorteos: 3 } } });
  });

  it("los sorteos del regalo salen de la variable", async () => {
    const m = montarAltas({ BIENVENIDA_SORTEOS: "5", BIENVENIDA_DIAS: "30" });
    const ana = m.persona("usr_ana");
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { bienvenida: { estado: "lista", sorteos: 5 } } });
    const sorteos = { quedan: 5, proximoVence: { fecha: T0 + 30 * DIA_MS } };
    expect(await m.gratis(ana.token)).toMatchObject({ cuerpo: { sorteosSumados: 5, sorteos } });
  });
});

describe("el piso y las altas sin abrir", () => {
  it("un alta sin abrir de 8 días deja de apartar créditos, ella y sus sorteos; una abierta, no", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    m.abiertas.add(beto.cuenta as string);
    await m.gratis(ana.token);
    await m.gratis(beto.token);
    expect((await m.puerta.resumen()).piso).toBe(300 + ALTA + REGALO + REGALO);
    m.mover(ALTA_SIN_ABRIR_DIAS * DIA_MS - 1);
    expect((await m.puerta.resumen()).piso).toBe(300 + ALTA + REGALO + REGALO);
    m.mover(DIA_MS + 1);
    // La de Ana, sin abrir, ya no cuenta; los sorteos de Beto, con su cuenta abierta, sí.
    expect((await m.puerta.resumen()).piso).toBe(300 + REGALO);
  });
});

describe("la configuración de la bienvenida", () => {
  it("abierta por defecto, sin frenos, con 3 sorteos por 60 días", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1" })).toMatchObject({
      bienvenida: true,
      bienvenidaSorteos: 3,
      bienvenidaDias: 60,
      bienvenidaDia: null,
      bienvenidaHora: null,
      bienvenidaPorIp: null,
      faltaAltas: [],
    });
  });

  it("los frenos en 0 o vacíos son sin tope, y un número es el tope", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", BIENVENIDA_DIA: "0", BIENVENIDA_HORA: "", BIENVENIDA_POR_IP: "30" });
    expect(cfg).toMatchObject({ bienvenida: true, bienvenidaDia: null, bienvenidaHora: null, bienvenidaPorIp: 30 });
  });

  it("solo un 0 la cierra, y solo en mainnet con las altas", () => {
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", BIENVENIDA: "0" }).bienvenida).toBe(false);
    expect(leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", BIENVENIDA: "1" }).bienvenida).toBe(true);
    expect(leerConfig({ RED: "mainnet", ALTAS: "0" }).bienvenida).toBe(false);
    expect(leerConfig({ RED: "testnet", ALTAS: "1" }).bienvenida).toBe(false);
  });

  it("con los sorteos o los días mal escritos la cierra y se anota", () => {
    const malas = [{ BIENVENIDA_SORTEOS: "11" }, { BIENVENIDA_SORTEOS: "0" }, { BIENVENIDA_DIAS: "3x" }];
    for (const env of malas) {
      const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", ...env });
      expect(cfg.bienvenida).toBe(false);
      expect(cfg.faltaAltas).toEqual(["bienvenida"]);
    }
  });

  it("un freno mal escrito queda suelto y se anota, sin cerrar el regalo", () => {
    const malos = [{ BIENVENIDA_DIA: "1.000" }, { BIENVENIDA_HORA: "1,000" }, { BIENVENIDA_POR_IP: "100001" }];
    for (const env of malos) {
      const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1", ...env });
      expect(cfg).toMatchObject({ bienvenida: true, bienvenidaDia: null, bienvenidaHora: null, bienvenidaPorIp: null });
      expect(cfg.faltaAltas).toEqual(["bienvenida"]);
    }
  });

  it("el margen del regalo: 3.000 por defecto, el de la variable hasta 50.000, y mal escrito el de por defecto y se anota", () => {
    const base = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1" };
    expect(leerConfig(base)).toMatchObject({ reservaRegalo: 3000, faltaAltas: [] });
    expect(leerConfig({ ...base, RESERVA_REGALO_CREDITOS: "0" })).toMatchObject({ reservaRegalo: 0, faltaAltas: [] });
    expect(leerConfig({ ...base, RESERVA_REGALO_CREDITOS: "50000" })).toMatchObject({ reservaRegalo: 50_000, faltaAltas: [] });
    for (const mal of ["50001", "3.000", "mucho"]) {
      const cfg = leerConfig({ ...base, RESERVA_REGALO_CREDITOS: mal });
      expect(cfg).toMatchObject({ bienvenida: true, reservaRegalo: 3000, faltaAltas: ["reserva-regalo"] });
    }
  });

  it("con un freno mal escrito, /estado sigue ofreciendo el regalo y /gratis lo da", async () => {
    const m = montarAltas({ BIENVENIDA_DIA: "1.000" });
    const ana = m.persona("usr_ana");
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "ninguno", bienvenida: { estado: "lista", sorteos: 3 } } });
    expect(await m.gratis(ana.token)).toMatchObject({ estado: 200, cuerpo: { regalo: "dado", sorteosSumados: 3 } });
  });
});

describe("GET /v1/alta/precios y la puerta de /v1/alta/gratis", () => {
  const pedido = (ruta: string, metodo = "POST") => {
    const h = new Headers({ Origin: "https://tinkazo.app", "CF-Connecting-IP": IP, Authorization: "Bearer tok_abc" });
    return new Request(`https://pm.tinkazo.app${ruta}`, { method: metodo, headers: h, body: metodo === "POST" ? "" : undefined });
  };
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app_1" });
  const nada = async () => ({ estado: 500, cuerpo: {} });

  it("precios dice los sorteos del regalo, lo que diga el objeto, y 0 si el objeto falla", async () => {
    const leer = async (consultar?: () => Promise<number>) => {
      const res = await atenderAlta(pedido("/v1/alta/precios", "GET"), cfg, nada, new PorIp(), nada, nada, consultar);
      return (await res?.json()) as Record<string, unknown>;
    };
    expect(await leer()).toMatchObject({ bienvenida: 3 });
    expect(await leer(async () => 3)).toMatchObject({ bienvenida: 3 });
    expect(await leer(async () => 0)).toMatchObject({ bienvenida: 0 });
    expect(
      await leer(async () => {
        throw new Error("caido");
      }),
    ).toMatchObject({ bienvenida: 0 });
  });

  it("POST /v1/alta/gratis pasa al objeto con el token, y su preflight contesta 204", async () => {
    const vistos: string[] = [];
    const llamar = async (accion: string, p: { token: string | null }) => {
      vistos.push(`${accion}:${p.token}`);
      return { estado: 200, cuerpo: { ok: true } };
    };
    const res = (await atenderAlta(pedido("/v1/alta/gratis"), cfg, llamar, new PorIp())) as Response;
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    expect(vistos).toEqual(["gratis:tok_abc"]);
    const pre = (await atenderAlta(pedido("/v1/alta/gratis", "OPTIONS"), cfg, llamar, new PorIp())) as Response;
    expect(pre.status).toBe(204);
    // El preflight deja pasar la cabecera de la sesión.
    expect([...pre.headers.values()].some((v) => /Authorization/i.test(v))).toBe(true);
    expect((await atenderAlta(pedido("/v1/alta/gratis", "GET"), cfg, llamar, new PorIp()))?.status).toBe(405);
  });
});

describe("la vuelta atrás: lo que deja escrito el regalo lo lee el código de antes", () => {
  /** Los motivos de alta que conocía el código de antes del regalo: `admitir` lanza con cualquier otro. */
  const MOTIVOS_DE_ANTES = ["cupon", "pago", "admin", "premio"];
  /**
   * Los accesos que entiende el sitio de antes del regalo (`ACCESOS` de `src/stellar/alta-api.ts` en main a4c9b445). Con
   * cualquier otro, el sitio no lee el estado. Copiados acá: el sitio de antes no cambia aunque cambie el de hoy.
   */
  const ACCESOS_DEL_SITIO_DE_ANTES = ["ninguno", "cupon", "pago", "admin", "premio"];

  it("el sitio de hoy sigue entendiendo todos los accesos del sitio de antes", () => {
    const fuente = readFileSync(new URL("../../../src/stellar/alta-api.ts", import.meta.url), "utf8");
    const lista = /const ACCESOS: readonly string\[\] = \[([^\]]*)\]/.exec(fuente)?.[1] ?? "";
    const delSitio = [...lista.matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
    for (const acceso of ACCESOS_DEL_SITIO_DE_ANTES) expect(delSitio).toContain(acceso);
  });

  it("/estado nunca contesta el acceso gratis: el alta con su regalo dice admin, que el sitio de antes conoce", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    expect(await m.gratis(ana.token)).toMatchObject({ cuerpo: { regalo: "dado" } });
    const { cuerpo } = await m.estado(ana.token);
    expect(cuerpo.acceso).toBe("admin");
    expect(ACCESOS_DEL_SITIO_DE_ANTES).toContain(cuerpo.acceso);
    // Lo demás que mira el sitio de antes para aceptar el estado.
    expect(typeof cuerpo.abierta).toBe("boolean");
    expect(["inmediato", "diferido"]).toContain(cuerpo.fondeo);
  });

  it("/estado nunca contesta el acceso gratis: el alta activada sin regalo también dice admin", async () => {
    const m = montarAltas({ BIENVENIDA: "0" });
    const ana = m.persona("usr_ana", null);
    expect(await m.gratis(ana.token)).toMatchObject({ cuerpo: { regalo: "lleno" } });
    const { cuerpo } = await m.estado(ana.token);
    expect(cuerpo.acceso).toBe("admin");
    expect(ACCESOS_DEL_SITIO_DE_ANTES).toContain(cuerpo.acceso);
  });

  it("el alta nace con un motivo que el código de antes conoce, y el derecho de origen gratis no rompe lo que ya existía", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana", null);
    await m.gratis(ana.token);
    const fila = m.sql.exec("SELECT motivo, ref, cuenta, estado FROM altas WHERE usuario = ?", "usr_ana").toArray()[0];
    expect(fila).toEqual({ motivo: "admin", ref: "gratis:usr_ana", cuenta: null, estado: "autorizada" });
    expect(MOTIVOS_DE_ANTES).toContain(fila?.motivo);
    // Las funciones de antes: leer el alta, atar la cuenta (mete al libro con el motivo del alta), contar y el piso.
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ motivo: "admin", estado: "autorizada" });
    const g = Keypair.random().publicKey();
    expect(m.cupos.atarCuenta("usr_ana", g, m.hora())).toBe("ok");
    expect(m.cupos.estaEnElLibro(g)).toBe(true);
    expect(m.cupos.quedan({ cuenta: g }, m.hora())).toMatchObject({ quedan: 3 });
    expect(m.cupos.prometido(m.hora())).toEqual({ sorteos: 3, altas: 1 });
    // Un cupón canjeado después, como lo haría el código de antes: suma a esa alta sin lanzar.
    await m.lote([codigo(1)]);
    const h = await huella(codigo(1), SECRETO_CUPON);
    expect(m.altas.canjear({ huella: h, usuario: "usr_ana", cuenta: g }, m.hora())).toMatchObject({ ok: true, sorteosSumados: 3 });
    expect(m.cupos.quedan({ cuenta: g }, m.hora()).quedan).toBe(6);
    // El exporte lleva las filas tal cual.
    expect(m.cupos.exportar(true).derechos?.map((d) => d.origen)).toEqual(["gratis", "cupon"]);
  });
});
