import { Keypair, Networks } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { APP, LOTE, T0, codigo, montarAltas } from "./altas-prueba";
import { armar } from "./armar";
import { DIA_MS, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { MEMORIA_CREDITOS_MS, Pollar, ULTIMO_CREDITOS_MS } from "./pollar";
import type { Red } from "./red";
import { PISO_BASE, memoriaEnAjustes } from "./rutas-altas";
import { Portero, firmanteDe } from "./servicio";
import { sqlDePrueba } from "./sqlite-prueba";

const C1 = codigo(1);
const C2 = codigo(2);
/** Lo que pide un canje nuevo de un cupón de 3 sorteos, con los valores por defecto (40 por sorteo, 30 por alta). */
const CANJE = 3 * 40 + 30;
const MINUTO = 60_000;

describe("el piso de créditos", () => {
  it("es 40 por sorteo prometido sin usar ni vencer, 30 por alta sin activar y 300 de base", async () => {
    expect(PISO_BASE).toBe(300);
    const m = montarAltas();
    expect(await m.puerta.resumen()).toEqual({ creditos: 100_000, creditosLeidos: T0, piso: 300, margen: 99_700, altasPausadas: false });
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.lote([C1, C2], { lote: "uno" });
    await m.cupon(ana.token, C1);
    await m.lote([codigo(3)], { lote: "dos" });
    await m.cupon(beto.token, codigo(3));
    expect((await m.puerta.resumen()).piso).toBe(300 + 2 * CANJE);
    // Un sorteo usado deja de estar prometido.
    m.sql.exec("UPDATE derechos SET usados = 1 WHERE cuenta = ?", ana.cuenta);
    expect((await m.puerta.resumen()).piso).toBe(300 + 2 * CANJE - 40);
    // Una cuenta que ya existe en la red ya no es una activación pendiente.
    m.abiertas.add(ana.cuenta as string);
    await m.estado(ana.token);
    expect((await m.puerta.resumen()).piso).toBe(300 + 2 * CANJE - 40 - 30);
    // Lo vencido no está prometido.
    m.mover(61 * DIA_MS);
    expect((await m.puerta.resumen()).piso).toBe(300 + 30);
  });

  it("los valores por sorteo y por alta salen de la configuración", async () => {
    const m = montarAltas({ CREDITOS_POR_SORTEO: "20", CREDITOS_POR_ALTA: "45" });
    await m.lote([C1]);
    await m.cupon(m.persona("usr_ana").token, C1);
    expect((await m.puerta.resumen()).piso).toBe(300 + 3 * 20 + 45);
  });

  it("bajo el piso, 503 altas-pausadas y el cupón no se gasta; con lo justo, pasa", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.lote([C1, C2]);
    m.pm.creditos = 300 + CANJE - 1;
    expect(await m.cupon(ana.token, C1)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ canjeados: 0 });
    expect(m.sql.exec("SELECT usos FROM cupones").toArray().map((f) => f.usos)).toEqual([0, 0]);
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM altas").toArray()[0]?.n).toBe(0);
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "piso" }]);
    // Pausar no es un intento fallido: no traba a la persona.
    for (let i = 0; i < 6; i++) expect((await m.cupon(ana.token, C1)).estado).toBe(503);

    m.pm.creditos = 300 + CANJE;
    m.mover(MEMORIA_CREDITOS_MS + 1);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    // El segundo ya no entra: el piso subió con lo que se prometió al primero.
    expect(await m.cupon(beto.token, C2)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
  });

  it("un cupón para quien ya tiene alta pide solo sus sorteos", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1], { lote: "uno" });
    await m.lote([C2], { lote: "dos" });
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    // Ahora el piso es 300 + 150; un segundo cupón de la misma persona pide 120 más, no 150.
    m.pm.creditos = 300 + CANJE + 3 * 40;
    m.mover(MEMORIA_CREDITOS_MS + 1);
    expect((await m.cupon(ana.token, C2)).estado).toBe(200);
  });

  it("quien ya canjeó sigue: el canje repetido y el estado no miran el piso", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    await m.lote([C1]);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    m.pm.creditos = 0;
    m.mover(MEMORIA_CREDITOS_MS + 1);
    expect(await m.cupon(ana.token, C1)).toMatchObject({ estado: 200, cuerpo: { repetido: true } });
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "cupon", sorteos: { quedan: 3 } } });
    expect(await m.puerta.resumen()).toMatchObject({ creditos: 0, margen: -(300 + CANJE) });
  });

  it("quien ya canjeó sigue sellando aunque los créditos estén en cero: el sello no le pregunta a Pollar", async () => {
    const m = montarAltas();
    const org = Keypair.random();
    const ana = m.persona("usr_ana", org.publicKey());
    await m.lote([C1]);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    m.pm.creditos = 0;
    m.pm.caido = true;
    const enviados: string[] = [];
    const red: Red = {
      simular: async () => ({ ok: true, minResourceFee: 40_000 }),
      leerCuenta: async () => ({ patrocinador: null, balance: 100_000_000n }),
      enviar: async (x) => (enviados.push(x), { status: "PENDING" }),
      consultar: async () => ({ status: "NOT_FOUND" }),
    };
    // El mismo SQLite que el de las altas; el contrato y la frase de testnet para poder firmar con llaves de prueba.
    const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: APP }), contractId: deployments.testnet.contractId, passphrase: Networks.TESTNET };
    const portero = new Portero(cfg, m.cupos, red, await firmanteDe(Keypair.random().secret()), Keypair.random().publicKey(), () => Date.now());
    const antes = m.pm.llamadas.length;
    expect(await portero.procesar(armar({ contrato: deployments.testnet.contractId, firmante: org }).xdr)).toMatchObject({ estado: 200, cuerpo: { status: "PENDING" } });
    expect(enviados).toHaveLength(1);
    expect(m.pm.llamadas.length).toBe(antes);
    expect(m.cupos.quedan({ cuenta: org.publicKey() }, Date.now()).quedan).toBe(2);
  });

  it("sin respuesta de Pollar, el último valor vale 10 minutos; después, lo nuevo se pausa", async () => {
    const m = montarAltas();
    const gente = Array.from({ length: 4 }, (_, i) => m.persona(`usr_${i}`));
    await m.lote(gente.map((_, i) => codigo(10 + i)));
    m.pm.creditos = 5000;
    expect((await m.puerta.resumen()).creditos).toBe(5000);
    m.pm.creditosCaido = true;
    m.mover(5 * MINUTO);
    expect((await m.cupon(gente[0]!.token, codigo(10))).estado).toBe(200);
    m.mover(ULTIMO_CREDITOS_MS - 5 * MINUTO - 1000);
    expect((await m.cupon(gente[1]!.token, codigo(11))).estado).toBe(200);
    m.mover(2000);
    expect(await m.cupon(gente[2]!.token, codigo(12))).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "creditos" }]);
    expect(await m.puerta.resumen()).toMatchObject({ creditos: null, creditosLeidos: null, margen: null });
    // Vuelve Pollar: se lee de nuevo y sigue.
    m.pm.creditosCaido = false;
    m.mover(60_000);
    expect((await m.cupon(gente[3]!.token, codigo(13))).estado).toBe(200);
  });

  it("con las altas pausadas a mano, lo nuevo para y lo canjeado sigue", async () => {
    const m = montarAltas();
    const ana = m.persona("usr_ana");
    const beto = m.persona("usr_beto");
    await m.lote([C1, C2]);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    m.cupos.fijarAjuste("altas_pausadas", "1", T0);
    expect(await m.cupon(beto.token, C2)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "a-mano" }]);
    expect((await m.cupon(ana.token, C1)).estado).toBe(200);
    expect(await m.puerta.resumen()).toMatchObject({ altasPausadas: true });
    m.cupos.fijarAjuste("altas_pausadas", "0", T0);
    expect((await m.cupon(beto.token, C2)).estado).toBe(200);
  });

  it("el último saldo leído vive en los ajustes: sobrevive a que el objeto arranque de nuevo", async () => {
    const cupos = new Cupos(sqlDePrueba());
    const memoria = memoriaEnAjustes(cupos);
    expect(memoria.leer()).toBeNull();
    const respuesta = (caido: boolean) => async () =>
      caido ? new Response('{"code":"DOWN","success":false}', { status: 503 }) : new Response(JSON.stringify({ code: "SERVER_BILLING_CREDITS", success: true, content: { available: 4200 } }), { status: 200 });
    let ahora = T0;
    await new Pollar({ secreto: "sec_mainnet_prueba_inventada_0000000000", appId: APP, fetch: respuesta(false), reloj: () => ahora, memoriaCreditos: memoria }).creditos();
    expect(memoria.leer()).toEqual({ valor: 4200, ms: T0 });
    expect(cupos.ajuste("creditos_ultimo")).toBeDefined();
    ahora += 3 * MINUTO;
    const otra = new Pollar({ secreto: "sec_mainnet_prueba_inventada_0000000000", appId: APP, fetch: respuesta(true), reloj: () => ahora, memoriaCreditos: memoriaEnAjustes(cupos) });
    expect(await otra.creditos()).toEqual({ ok: true, disponibles: 4200, leido: T0, deMemoria: true });
    // Algo roto en el ajuste no es un saldo.
    cupos.fijarAjuste("creditos_ultimo", "roto", T0);
    expect(memoriaEnAjustes(cupos).leer()).toBeNull();
  });
});
