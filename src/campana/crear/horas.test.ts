import { describe, expect, it } from "vitest";
import {
  ajustarHoras,
  fechaYHoraDe,
  instanteDe,
  instantesDe,
  nombreCortoDeZona,
  proximaHoraDeCinco,
  revisarHoras,
  sumarDias,
  zonaDelNavegador,
} from "./horas";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const LA_PAZ = "America/La_Paz";
const dia = { fecha: "2026-11-21", abre: "10:00", cierra: "18:00", sorteo: "18:30", zona: LA_PAZ };

describe("instanteDe", () => {
  it("en America/La_Paz el 21 de noviembre a las 18:30 es las 22:30 en UTC", () => {
    expect(instanteDe("2026-11-21", "18:30", LA_PAZ)).toBe(Date.UTC(2026, 10, 21, 22, 30));
  });

  it("en una zona con horario de verano el instante tiene el desfase de ese día", () => {
    expect(instanteDe("2026-11-21", "12:00", "America/Santiago")).toBe(Date.UTC(2026, 10, 21, 15, 0));
    expect(instanteDe("2026-07-15", "12:00", "Europe/Madrid")).toBe(Date.UTC(2026, 6, 15, 10, 0));
  });

  it("la hora que no existe el día del cambio de horario da siempre el mismo instante", () => {
    const primero = instanteDe("2026-03-29", "02:30", "Europe/Madrid");
    expect(primero).not.toBeNull();
    expect(instanteDe("2026-03-29", "02:30", "Europe/Madrid")).toBe(primero);
  });

  it("lo que no tiene la forma de un día y una hora da null", () => {
    expect(instanteDe("2026-13-01", "10:00", LA_PAZ)).toBeNull();
    expect(instanteDe("2026-02-30", "10:00", LA_PAZ)).toBeNull();
    expect(instanteDe("2026-11-21", "25:00", LA_PAZ)).toBeNull();
    expect(instanteDe("", "10:00", LA_PAZ)).toBeNull();
    expect(instanteDe("2026-11-21", "10:00", "Marte/Nada")).toBeNull();
  });
});

describe("fechaYHoraDe", () => {
  it("devuelve el día y la hora que se eligieron", () => {
    const ms = instanteDe("2026-11-21", "18:30", LA_PAZ) ?? 0;
    expect(fechaYHoraDe(ms, LA_PAZ)).toEqual({ fecha: "2026-11-21", hora: "18:30" });
  });

  it("sumarDias pasa de fin de mes y de fin de año", () => {
    expect(sumarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("revisarHoras", () => {
  it("sin día dice que falta el día", () => {
    expect(revisarHoras({ ...dia, fecha: "" }, AHORA)).toEqual({ problema: "falta-dia", donde: "ccp-dia" });
  });

  it("sin alguna hora dice que faltan las horas", () => {
    expect(revisarHoras({ ...dia, cierra: "" }, AHORA)?.problema).toBe("falta-hora");
  });

  it("una hora de abrir que ya pasó pide corregir la de abrir", () => {
    expect(revisarHoras({ ...dia, fecha: "2026-11-18", abre: "10:00" }, AHORA)).toEqual({ problema: "abre-pasada", donde: "ccp-abre" });
  });

  it("cerrar a la misma hora que abre pide corregir la de cerrar", () => {
    expect(revisarHoras({ ...dia, cierra: "10:00" }, AHORA)).toEqual({ problema: "cierra-antes", donde: "ccp-cierra" });
  });

  it("un cierre de la mañana siguiente que queda a más de 12 horas dice que cierra lejos y no que cierra antes", () => {
    expect(revisarHoras({ ...dia, cierra: "09:00" }, AHORA)).toEqual({ problema: "cierra-lejos", donde: "ccp-cierra" });
  });

  it("abrir a las 20:00 y cerrar a las 18:00 del día siguiente son 22 horas: cierra lejos", () => {
    const noche = { ...dia, abre: "20:00", cierra: "18:00", sorteo: "18:30" };
    expect(revisarHoras(noche, AHORA)).toEqual({ problema: "cierra-lejos", donde: "ccp-cierra" });
  });

  it("un sorteo antes del cierre pide corregir la del sorteo", () => {
    expect(revisarHoras({ ...dia, sorteo: "09:00" }, AHORA)).toEqual({ problema: "sorteo-antes", donde: "ccp-sorteo" });
  });

  it("un sorteo a la misma hora del cierre está bien", () => {
    expect(revisarHoras({ ...dia, sorteo: "18:00" }, AHORA)).toBeNull();
  });

  it("un sorteo a más de 12 horas de abrir pide corregir la del sorteo", () => {
    expect(revisarHoras({ ...dia, abre: "08:00", sorteo: "21:00" }, AHORA)).toEqual({ problema: "sorteo-lejos", donde: "ccp-sorteo" });
  });

  it("con las tres en orden y en el futuro no hay nada que corregir", () => {
    expect(revisarHoras(dia, AHORA)).toBeNull();
  });
});

describe("un sorteo que cruza la medianoche", () => {
  const noche = { ...dia, abre: "22:00", cierra: "01:00", sorteo: "01:30" };

  it("22:00, 01:00 y 01:30 dan instantes en orden y el sorteo cae al día siguiente", () => {
    const t = instantesDe(noche);
    expect(t).not.toBeNull();
    expect(t?.abreMs).toBe(Date.UTC(2026, 10, 22, 2, 0));
    expect(t?.cierraMs).toBe(Date.UTC(2026, 10, 22, 5, 0));
    expect(t?.sorteoMs).toBe(Date.UTC(2026, 10, 22, 5, 30));
    expect(t?.cierraMasUno).toBe(true);
    expect(t?.sorteoMasUno).toBe(true);
    expect(revisarHoras(noche, AHORA)).toBeNull();
  });

  it("con las tres en el mismo día no marca ningún día de más", () => {
    const t = instantesDe(dia);
    expect(t?.cierraMasUno).toBe(false);
    expect(t?.sorteoMasUno).toBe(false);
  });
});

describe("ajustarHoras", () => {
  const hoy = { ...dia, fecha: "2026-11-18" };

  it("el próximo múltiplo de 5 minutos sale de la hora de la zona", () => {
    expect(proximaHoraDeCinco(AHORA, LA_PAZ)).toBe("11:05");
    expect(proximaHoraDeCinco(AHORA + 4 * 60_000, LA_PAZ)).toBe("11:05");
  });

  it("hoy con una hora de abrir que ya pasó la pone en la próxima de 5 minutos y corre el cierre y el sorteo", () => {
    expect(ajustarHoras(hoy, AHORA)).toEqual({ abre: "11:05", cierra: "19:05", sorteo: "19:35", ajustada: true });
  });

  it("hoy con la hora de abrir en el futuro no cambia nada", () => {
    expect(ajustarHoras({ ...hoy, abre: "14:00", cierra: "20:00", sorteo: "20:30" }, AHORA).ajustada).toBe(false);
  });

  it("otro día no cambia nada", () => {
    expect(ajustarHoras(dia, AHORA)).toEqual({ abre: "10:00", cierra: "18:00", sorteo: "18:30", ajustada: false });
  });
});

describe("la zona", () => {
  it("la del navegador es una zona que Intl acepta", () => {
    expect(() => new Intl.DateTimeFormat("es", { timeZone: zonaDelNavegador() })).not.toThrow();
  });

  it("el nombre corto es lo que va después de la barra, con espacios", () => {
    expect(nombreCortoDeZona("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(nombreCortoDeZona(LA_PAZ)).toBe("La Paz");
    expect(nombreCortoDeZona("UTC")).toBe("UTC");
  });
});
