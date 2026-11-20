/**
 * Un sello que falló en la cadena y no se pudo probar en el primer intento (el RPC trajo el FAILED sin el sobre, sin el
 * resultado o sin la hora) no se da por perdido: la alarma vuelve a preguntar unas veces. Si nunca se puede probar, o si
 * el tope del día niega la devolución, queda anotado para devolverlo a mano.
 */
import { describe, expect, it } from "vitest";
import { escena } from "./devolucion-prueba";
import { DEVOLUCIONES_POR_DIA, ESPERA_ENTRE_PRUEBAS_MS, INTENTOS_DE_PRUEBA } from "./servicio";

const sinDatos = { status: "FAILED" as const, feeCharged: 6_000 };

describe("una falla que no se pudo probar se vuelve a mirar", () => {
  it("el RPC trajo el FAILED sin el sobre: la alarma vuelve a preguntar y, cuando trae todo, el sorteo vuelve", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    s.e.red.consultas.set(a.hash, sinDatos);
    s.pasaLaEspera();
    // Queda trabajo para la alarma aunque ya no haya nada en el aire.
    expect(await m.reconciliar()).toBe(true);
    expect(s.e.cupos.buscar(a.hash)?.estado).toBe("fallo");
    expect(s.quedan(org)).toBe(0);
    expect(s.e.anotado).toContainEqual({ evento: "sello-fallido", datos: { hash: a.hash.slice(0, 8), motivo: "sin-datos" } });
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toMatchObject([{ hash: a.hash, cuenta: org.publicKey(), motivo: "sin-datos", intentos: 1 }]);

    // Antes de la espera entre pruebas no se vuelve a preguntar.
    const antes = s.e.red.preguntas.length;
    s.e.ahora += 1_000;
    await m.reconciliar();
    expect(s.e.red.preguntas.length).toBe(antes);

    // La red ahora trae todo: se prueba, vuelve el sorteo y no queda nada pendiente.
    s.entroTarde(a);
    s.e.ahora += ESPERA_ENTRE_PRUEBAS_MS;
    expect(await m.reconciliar()).toBe(false);
    expect(s.quedan(org)).toBe(1);
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toEqual([]);
    expect(s.e.anotado.filter((x) => x.evento === "sorteo-devuelto")).toHaveLength(1);
  });

  it("si nunca trae los datos, después de los intentos queda para devolver a mano, en el exporte y en el estado", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    s.e.red.consultas.set(a.hash, sinDatos);
    s.pasaLaEspera();
    await m.reconciliar();
    for (let i = 1; i < INTENTOS_DE_PRUEBA; i++) {
      s.e.ahora += ESPERA_ENTRE_PRUEBAS_MS;
      await m.reconciliar();
    }
    const preguntas = s.e.red.preguntas.filter((h) => h === a.hash).length;
    expect(preguntas).toBe(INTENTOS_DE_PRUEBA);
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toMatchObject([{ hash: a.hash, motivo: "sin-probar", intentos: INTENTOS_DE_PRUEBA }]);
    expect(s.e.anotado).toContainEqual({ evento: "sello-sin-probar", datos: { hash: a.hash.slice(0, 8), intentos: INTENTOS_DE_PRUEBA } });
    // Ya no se pregunta más, y la alarma no queda prendida por esto.
    s.e.ahora += ESPERA_ENTRE_PRUEBAS_MS;
    expect(await m.reconciliar()).toBe(false);
    expect(s.e.red.preguntas.filter((h) => h === a.hash).length).toBe(preguntas);
    expect(s.quedan(org)).toBe(0);
    expect((await m.estado()).cuerpo).toMatchObject({ porDevolver24h: 1 });
  });

  it("una falla probada que no es por la ronda (entró a tiempo) no se vuelve a mirar", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    s.entroTarde(a, 31);
    s.pasaLaEspera();
    expect(await m.reconciliar()).toBe(false);
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toEqual([]);
  });

  it("un corte de la red al volver a preguntar cuenta como intento: no se pregunta para siempre", async () => {
    const s = escena();
    const org = s.admitida(1);
    const m = await s.portero();
    const a = s.sello(org);
    await m.procesar(a.xdr);
    s.e.red.consultas.set(a.hash, sinDatos);
    s.pasaLaEspera();
    await m.reconciliar();
    s.e.red.caida = true;
    for (let i = 1; i < INTENTOS_DE_PRUEBA; i++) {
      s.e.ahora += ESPERA_ENTRE_PRUEBAS_MS;
      await m.reconciliar();
    }
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toMatchObject([{ hash: a.hash, motivo: "sin-probar" }]);
  });
});

describe("lo que el tope niega queda anotado para devolverlo a mano", () => {
  it("la cuarta del día de una cuenta: no vuelve sola, queda en el exporte y en el estado", async () => {
    const s = escena();
    const org = s.admitida(10);
    const m = await s.portero();
    for (let i = 0; i < DEVOLUCIONES_POR_DIA; i++) {
      const t = s.sello(org);
      await m.procesar(t.xdr);
      s.entroTarde(t);
    }
    s.pasaLaEspera();
    await m.reconciliar();
    const cuarto = s.sello(org);
    await m.procesar(cuarto.xdr);
    s.entroTarde(cuarto);
    s.pasaLaEspera();
    expect(await m.reconciliar()).toBe(false);
    expect(s.quedan(org)).toBe(9);
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toMatchObject([{ hash: cuarto.hash, cuenta: org.publicKey(), motivo: "tope" }]);
    expect(s.e.cupos.resumen(s.e.ahora)).toMatchObject({ devueltos24h: DEVOLUCIONES_POR_DIA, porDevolver24h: 1 });
  });
});
