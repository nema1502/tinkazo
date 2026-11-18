import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  CAMPANAS_POR_DIA,
  ESPERA_RESERVA_MS,
  confirmarEventoSql,
  reservarEventoSql,
  salaDelIntentoSql,
  soltarEventoSql,
} from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";

function nuevaBase(): Ejecutar {
  const db = new DatabaseSync(":memory:");
  return <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
}

const DIA = Date.UTC(2027, 3, 12, 12);
const SIGUIENTE = DIA + 86_400_000;

/** La huella del token de una sala, inventada para la prueba: en el Worker es el SHA-256 del token. */
const huellaDe = (sala: string): string => `huella-del-token-de-${sala}`;

/** Lo que trae quien comprobó que la sala ya no existe y presenta su token. */
const conSuToken = (sala: string): { sala: string; huella: string } => ({ sala, huella: huellaDe(sala) });

/** Confirma una reserva con la sala de ese nombre y la huella de su token. */
function confirmar(sql: Ejecutar, evento: string, reserva: string, sala: string, ahora = DIA): boolean {
  return confirmarEventoSql(sql, evento, { reserva, sala, huella: huellaDe(sala), ahora });
}

/** Reserva y confirma un evento con la sala de ese nombre: lo que hace el Worker cuando todo sale bien. */
function crearEvento(sql: Ejecutar, evento: string, sala: string, ahora = DIA): void {
  const r = reservarEventoSql(sql, evento, ahora);
  if (!r.ok) throw new Error(`no se pudo reservar ${evento}`);
  expect(confirmar(sql, evento, r.reserva, sala, ahora)).toBe(true);
}

describe("el permiso de un evento de campaña", () => {
  it("la primera reserva entra y trae su reserva", () => {
    const sql = nuevaBase();
    const r = reservarEventoSql(sql, "feria-del-libro", DIA);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.reserva).toMatch(/^[0-9a-f]{32}$/);
  });

  it("con la reserva en curso, otro pedido da ya-existe sin sala", () => {
    const sql = nuevaBase();
    reservarEventoSql(sql, "feria-del-libro", DIA);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + 1_000)).toEqual({ ok: false, motivo: "ya-existe", sala: null });
  });

  it("una reserva sin confirmar se da por abandonada pasado el tiempo y entonces se reemplaza", () => {
    const sql = nuevaBase();
    reservarEventoSql(sql, "feria-del-libro", DIA);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + ESPERA_RESERVA_MS - 1).ok).toBe(false);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + ESPERA_RESERVA_MS)).toMatchObject({ ok: true });
  });

  it("confirmada con su sala, otro pedido da ya-existe con el id de esa sala", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    expect(reservarEventoSql(sql, "feria-del-libro", DIA)).toEqual({ ok: false, motivo: "ya-existe", sala: "AbCd1234" });
  });

  it("una sala confirmada no se reemplaza si quien llama no dice que esa sala ya no existe", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    expect(reservarEventoSql(sql, "feria-del-libro", DIA, null).ok).toBe(false);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA, conSuToken("OtraSala")).ok).toBe(false);
  });

  it("si esa sala ya no existe y se trae su token, el evento se reserva de nuevo y queda ligado a la nueva", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    const r = reservarEventoSql(sql, "feria-del-libro", DIA + 5_000, conSuToken("AbCd1234"));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("no se reservó");
    expect(confirmar(sql, "feria-del-libro", r.reserva, "NuEvA567", DIA + 5_000)).toBe(true);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + 9_000)).toEqual({ ok: false, motivo: "ya-existe", sala: "NuEvA567" });
  });

  it("una sala muerta no se reemplaza sin la huella de su token: el archivo firmado solo no alcanza", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    const sinToken = reservarEventoSql(sql, "feria-del-libro", DIA + 5_000, { sala: "AbCd1234", huella: "otra-huella" });
    expect(sinToken).toEqual({ ok: false, motivo: "ya-existe", sala: "AbCd1234" });
  });

  it("después de un reemplazo vale el token de la sala nueva, no el de la vieja", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    const r = reservarEventoSql(sql, "feria-del-libro", DIA + 5_000, conSuToken("AbCd1234"));
    if (!r.ok) throw new Error("no se reservó");
    expect(confirmar(sql, "feria-del-libro", r.reserva, "NuEvA567", DIA + 5_000)).toBe(true);
    const conLaVieja = { sala: "NuEvA567", huella: huellaDe("AbCd1234") };
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + 9_000, conLaVieja).ok).toBe(false);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + 9_000, conSuToken("NuEvA567"))).toMatchObject({ ok: true });
  });

  it("soltar la reserva deja el evento libre, y la reserva ya confirmada no se suelta", () => {
    const sql = nuevaBase();
    const r = reservarEventoSql(sql, "feria-del-libro", DIA);
    if (!r.ok) throw new Error("no se reservó");
    soltarEventoSql(sql, "feria-del-libro", r.reserva);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA)).toMatchObject({ ok: true });
    crearEvento(sql, "otro-evento", "AbCd1234");
    soltarEventoSql(sql, "otro-evento", "cualquiera");
    expect(reservarEventoSql(sql, "otro-evento", DIA)).toMatchObject({ ok: false, motivo: "ya-existe" });
  });

  it("un reemplazo que falla al crear y se suelta no deja el evento libre para quien solo tiene el archivo", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    const r = reservarEventoSql(sql, "feria-del-libro", DIA + 5_000, conSuToken("AbCd1234"));
    if (!r.ok) throw new Error("no se reservó");
    soltarEventoSql(sql, "feria-del-libro", r.reserva);
    // Sin token, ni siquiera pasado el tiempo de una reserva abandonada.
    for (const cuando of [DIA + 6_000, DIA + 5_000 + ESPERA_RESERVA_MS + 1]) {
      expect(reservarEventoSql(sql, "feria-del-libro", cuando)).toEqual({ ok: false, motivo: "ya-existe", sala: "AbCd1234" });
      expect(reservarEventoSql(sql, "feria-del-libro", cuando, { sala: "AbCd1234", huella: "otra-huella" }).ok).toBe(false);
    }
    // Quien organiza, con su token, puede volver a intentar.
    const otra = reservarEventoSql(sql, "feria-del-libro", DIA + 7_000, conSuToken("AbCd1234"));
    expect(otra).toMatchObject({ ok: true });
    // La reserva soltada ya no confirma nada.
    expect(confirmar(sql, "feria-del-libro", r.reserva, "Cualquiera", DIA + 7_000)).toBe(false);
  });

  it("un reemplazo cortado entre reservar y confirmar tampoco deja el evento a quien solo tiene el archivo", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + 5_000, conSuToken("AbCd1234"))).toMatchObject({ ok: true });
    // Nadie confirma ni suelta: pasa la espera de una reserva abandonada.
    const tarde = DIA + 5_000 + ESPERA_RESERVA_MS + 1;
    expect(reservarEventoSql(sql, "feria-del-libro", tarde)).toEqual({ ok: false, motivo: "ya-existe", sala: "AbCd1234" });
    expect(reservarEventoSql(sql, "feria-del-libro", tarde, conSuToken("AbCd1234"))).toMatchObject({ ok: true });
  });

  it("una reserva ya usada no confirma otra vez, y el reemplazo confirmado trae el instante de la sala nueva", () => {
    const sql = nuevaBase();
    crearEvento(sql, "feria-del-libro", "AbCd1234");
    const r = reservarEventoSql(sql, "feria-del-libro", DIA + 5_000, conSuToken("AbCd1234"));
    if (!r.ok) throw new Error("no se reservó");
    expect(confirmar(sql, "feria-del-libro", r.reserva, "NuEvA567", DIA + 6_000)).toBe(true);
    expect(confirmar(sql, "feria-del-libro", r.reserva, "OtraMas1", DIA + 7_000)).toBe(false);
    expect(salaDelIntentoSql(sql, "feria-del-libro", huellaDe("NuEvA567"))).toEqual({ sala: "NuEvA567", enMs: DIA + 6_000 });
  });

  it("confirmar con una reserva que no es la vigente da falso y no toca nada", () => {
    const sql = nuevaBase();
    const primera = reservarEventoSql(sql, "feria-del-libro", DIA);
    if (!primera.ok) throw new Error("no se reservó");
    const tomada = reservarEventoSql(sql, "feria-del-libro", DIA + ESPERA_RESERVA_MS);
    expect(tomada).toMatchObject({ ok: true });
    expect(confirmar(sql, "feria-del-libro", primera.reserva, "SalaVieja", DIA + ESPERA_RESERVA_MS)).toBe(false);
    expect(reservarEventoSql(sql, "feria-del-libro", DIA + ESPERA_RESERVA_MS + 1)).toEqual({
      ok: false,
      motivo: "ya-existe",
      sala: null,
    });
  });

  it("el cupo del día cuenta solo las salas confirmadas: las reservas sueltas no gastan nada", () => {
    const sql = nuevaBase();
    for (let i = 0; i < CAMPANAS_POR_DIA + 5; i++) {
      const r = reservarEventoSql(sql, `intento-${i}`, DIA);
      if (!r.ok) throw new Error("el cupo no tendría que haberse gastado");
      soltarEventoSql(sql, `intento-${i}`, r.reserva);
    }
    for (let i = 0; i < CAMPANAS_POR_DIA; i++) crearEvento(sql, `feria-${i}`, `Sala${String(i).padStart(4, "0")}`);
    expect(reservarEventoSql(sql, "feria-de-ciencias", DIA)).toEqual({ ok: false, motivo: "cupo-campanas" });
  });

  it("la campaña 21 del día da cupo-campanas y al día siguiente vuelve a haber lugar", () => {
    const sql = nuevaBase();
    for (let i = 0; i < CAMPANAS_POR_DIA; i++) crearEvento(sql, `feria-${i}`, `Sala${String(i).padStart(4, "0")}`);
    expect(reservarEventoSql(sql, "feria-de-ciencias", DIA)).toEqual({ ok: false, motivo: "cupo-campanas" });
    expect(reservarEventoSql(sql, "feria-de-ciencias", SIGUIENTE)).toMatchObject({ ok: true });
  });

  it("reemplazar una sala que ya no existe gasta otro lugar del día: la nueva también se creó", () => {
    const sql = nuevaBase();
    for (let i = 0; i < CAMPANAS_POR_DIA - 1; i++) crearEvento(sql, `feria-${i}`, `Sala${String(i).padStart(4, "0")}`);
    const r = reservarEventoSql(sql, "feria-0", DIA, conSuToken("Sala0000"));
    if (!r.ok) throw new Error("todavía había lugar");
    expect(confirmar(sql, "feria-0", r.reserva, "NuEvA567", DIA)).toBe(true);
    expect(reservarEventoSql(sql, "feria-0", DIA, conSuToken("NuEvA567"))).toEqual({ ok: false, motivo: "cupo-campanas" });
    expect(reservarEventoSql(sql, "feria-nueva", DIA)).toEqual({ ok: false, motivo: "cupo-campanas" });
  });

  it("sin lugar en el día, el evento con su sala vieja queda como estaba y no se pierde", () => {
    const sql = nuevaBase();
    for (let i = 0; i < CAMPANAS_POR_DIA; i++) crearEvento(sql, `feria-${i}`, `Sala${String(i).padStart(4, "0")}`);
    expect(reservarEventoSql(sql, "feria-0", DIA, conSuToken("Sala0000"))).toEqual({ ok: false, motivo: "cupo-campanas" });
    expect(reservarEventoSql(sql, "feria-0", DIA)).toEqual({ ok: false, motivo: "ya-existe", sala: "Sala0000" });
    // Al día siguiente hay lugar de nuevo y el mismo evento se reserva otra vez.
    expect(reservarEventoSql(sql, "feria-0", SIGUIENTE, conSuToken("Sala0000"))).toMatchObject({ ok: true });
  });
});
