import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { confirmarEventoSql, reservarEventoSql, salaDelIntentoSql, soltarEventoSql } from "../../workers/sala/src/campana";
import type { CampanaFirmada } from "../../workers/sala/src/campana";
import { crearSalaDeCampana, type PuertoDeCupos, type PuertoDeSalas } from "../../workers/sala/src/creacion";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";

/**
 * Cómo nace la sala de una campaña cuando la respuesta se pierde por el camino: el pedido repetido, con el mismo token que
 * inventó quien organiza, recibe la misma sala. Con los cupos de verdad (SQL en memoria) y salas de mentira.
 */

const DIA = Date.UTC(2027, 3, 12, 12);
const EVENTO = "feria-del-libro";
const TOKEN_UNO = "A".repeat(22);
const TOKEN_DOS = "B".repeat(22);
const VIDA = 86_400_000;

const campana = { evento: EVENTO } as unknown as CampanaFirmada;
const huellaDe = async (token: string): Promise<string> => `huella-${token}`;

function mundo(): {
  cupos: PuertoDeCupos;
  salas: PuertoDeSalas;
  vivas: Set<string>;
  creadas: string[];
  crear: (a: { token: string; propio: boolean; anterior?: string | null }) => ReturnType<typeof crearSalaDeCampana>;
} {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
  const vivas = new Set<string>();
  const creadas: string[] = [];
  const cupos: PuertoDeCupos = {
    reservarCampana: async (evento, reemplazo) => reservarEventoSql(sql, evento, DIA, reemplazo),
    confirmarCampana: async (evento, reserva, sala, huella) => confirmarEventoSql(sql, evento, { reserva, sala, huella, ahora: DIA }),
    soltarCampana: async (evento, reserva) => soltarEventoSql(sql, evento, reserva),
    salaDelIntento: async (evento, huella) => salaDelIntentoSql(sql, evento, huella),
  };
  const salas: PuertoDeSalas = {
    viva: async (id) => vivas.has(id),
    crearCampana: async (id) => {
      vivas.add(id);
      return true;
    },
    cerrar: async (id) => void vivas.delete(id),
  };
  return {
    cupos,
    salas,
    vivas,
    creadas,
    crear: (a) => {
      let n = creadas.length;
      return crearSalaDeCampana({
        cupos,
        salas,
        c: campana,
        vida: VIDA,
        token: a.token,
        propio: a.propio,
        anterior: a.anterior ?? null,
        huellaDe,
        nuevoId: () => {
          const id = `Sala000${n++}`;
          creadas.push(id);
          return id;
        },
      });
    },
  };
}

describe("repetir el pedido de crear la sala de una campaña", () => {
  it("si la respuesta se perdió, el mismo token recibe la misma sala y no crea otra", async () => {
    const m = mundo();
    const primera = await m.crear({ token: TOKEN_UNO, propio: true });
    expect(primera).toEqual({ ok: true, id: "Sala0000", creadaEn: null });
    const repetida = await m.crear({ token: TOKEN_UNO, propio: true });
    expect(repetida).toEqual({ ok: true, id: "Sala0000", creadaEn: DIA });
    expect(m.creadas).toEqual(["Sala0000"]);
  });

  it("otro token, o un token que inventó la sala, sigue recibiendo ya-existe sin decir nada de la sala", async () => {
    const m = mundo();
    await m.crear({ token: TOKEN_UNO, propio: true });
    expect(await m.crear({ token: TOKEN_DOS, propio: true })).toEqual({ ok: false, motivo: "ya-existe" });
    expect(await m.crear({ token: TOKEN_UNO, propio: false })).toEqual({ ok: false, motivo: "ya-existe" });
  });

  it("si esa sala ya no vive, el mismo token no la recupera", async () => {
    const m = mundo();
    await m.crear({ token: TOKEN_UNO, propio: true });
    m.vivas.clear();
    expect(await m.crear({ token: TOKEN_UNO, propio: true })).toEqual({ ok: false, motivo: "ya-existe" });
  });

  it("con la reserva todavía en curso no entrega ninguna sala", async () => {
    const m = mundo();
    expect(await m.cupos.reservarCampana(EVENTO, null)).toMatchObject({ ok: true });
    expect(await m.crear({ token: TOKEN_UNO, propio: true })).toEqual({ ok: false, motivo: "ya-existe" });
  });
});
