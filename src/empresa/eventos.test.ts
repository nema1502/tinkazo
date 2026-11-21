import { describe, expect, it } from "vitest";
import { OTRA_CIUDAD, DEPARTAMENTOS, HORAS_DE_CIERRE, MAXIMO_DE_EVENTOS, diasDelCalendario, eventosIniciales, reducirEventos, type EventoDeEmpresa } from "./eventos";
import { fechaYHoraDe, sumarDias } from "../campana/crear/horas";

describe("los eventos de una campaña", () => {
  it("los nueve departamentos, ni uno más ni uno menos", () => {
    expect(DEPARTAMENTOS.slice().sort()).toEqual(
      ["Beni", "Chuquisaca", "Cochabamba", "La Paz", "Oruro", "Pando", "Potosí", "Santa Cruz", "Tarija"].sort(),
    );
    expect(DEPARTAMENTOS).not.toContain(OTRA_CIUDAD);
  });

  it("arranca con un solo evento y todo por elegir menos la hora y el cupo", () => {
    const eventos = eventosIniciales();
    expect(eventos.length).toBe(1);
    expect(eventos[0]).toEqual({ ciudad: "", lugar: "", dia: null, cierre: "18:00", cupo: 100 });
  });

  it("agregar y quitar: al menos uno y no más de los que se pueden", () => {
    const eventos = eventosIniciales();
    let mas = eventos;
    for (let i = 0; i < MAXIMO_DE_EVENTOS + 3; i++) mas = reducirEventos(mas, { tipo: "agregar" });
    expect(mas.length).toBe(MAXIMO_DE_EVENTOS);
    for (let i = 0; i < MAXIMO_DE_EVENTOS; i++) mas = reducirEventos(mas, { tipo: "quitar", n: 0 });
    expect(mas.length).toBe(1);
  });

  it("quitar saca el evento pedido y deja el resto en su orden", () => {
    const mas = reducirEventos(eventosIniciales(), { tipo: "agregar" });
    const conCiudades = reducirEventos(mas, { tipo: "ciudad", n: 0, v: "La Paz" });
    const sinElSegundo = reducirEventos(conCiudades, { tipo: "quitar", n: 1 });
    expect(sinElSegundo.length).toBe(1);
    expect(sinElSegundo[0]?.ciudad).toBe("La Paz");
  });

  it("ciudad, lugar, día y cierre se ponen en el evento pedido", () => {
    const eventos = eventosIniciales();
    const conTodo = reducirEventos(eventos, [
      { tipo: "ciudad", n: 0, v: OTRA_CIUDAD },
      { tipo: "lugar", n: 0, v: "Parque de las aguas" },
      { tipo: "dia", n: 0, v: "2027-03-14" },
      { tipo: "cierre", n: 0, v: "15:45" },
    ]);
    expect(conTodo[0]).toEqual({ ciudad: OTRA_CIUDAD, lugar: "Parque de las aguas", dia: "2027-03-14", cierre: "15:45", cupo: 100 });
  });

  it("el cupo se mueve con los botones y no pasa de sus límites", () => {
    let eventos: EventoDeEmpresa[] = [{ ciudad: "", lugar: "", dia: null, cierre: "18:00", cupo: 100 }];
    eventos = reducirEventos(eventos, { tipo: "cupo-mas", n: 0 });
    expect(eventos[0]?.cupo).toBe(105);
    eventos = reducirEventos(eventos, { tipo: "cupo-menos", n: 0 });
    expect(eventos[0]?.cupo).toBe(100);
    let tope: EventoDeEmpresa[] = [{ ciudad: "", lugar: "", dia: null, cierre: "18:00", cupo: 500 }];
    tope = reducirEventos(tope, { tipo: "cupo-mas", n: 0 });
    expect(tope[0]?.cupo).toBe(500);
    let piso: EventoDeEmpresa[] = [{ ciudad: "", lugar: "", dia: null, cierre: "18:00", cupo: 10 }];
    piso = reducirEventos(piso, { tipo: "cupo-menos", n: 0 });
    expect(piso[0]?.cupo).toBe(10);
  });

  it("reducir promete listas nuevas: la original queda igual", () => {
    const eventos = eventosIniciales();
    const cambiados = reducirEventos(eventos, { tipo: "cupo-mas", n: 0 });
    expect(eventos[0]?.cupo).toBe(100);
    expect(cambiados).not.toBe(eventos);
  });

  it("la hora de cierre viene en pasos de quince minutos, del día entero", () => {
    expect(HORAS_DE_CIERRE.length).toBe(96);
    expect(HORAS_DE_CIERRE[0]).toBe("00:00");
    expect(HORAS_DE_CIERRE[1]).toBe("00:15");
    expect(HORAS_DE_CIERRE[HORAS_DE_CIERRE.length - 1]).toBe("23:45");
    for (const hora of HORAS_DE_CIERRE) expect(hora).toMatch(/^([01]\d|2[0-3]):(00|15|30|45)$/u);
  });

  it("el calendario trae los próximos días, empezando por el de hoy en la zona", () => {
    const zona = "America/La_Paz";
    const ahora = Date.UTC(2027, 0, 1, 12, 0, 0);
    const dias = diasDelCalendario(ahora, zona);
    expect(dias.length).toBe(14);
    const hoy = fechaYHoraDe(ahora, zona).fecha;
    expect(dias[0]).toBe(hoy);
    expect(dias[1]).toBe(sumarDias(hoy, 1));
    expect(dias[13]).toBe(sumarDias(hoy, 13));
  });
});
