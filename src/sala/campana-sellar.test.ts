import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { canonicalList, listHash } from "../protocol/canonical";
import { roundTime } from "../protocol/quicknet";
import {
  MARGEN_DE_RONDA_MS,
  VENTANA_CAMPANA_MS,
  anotarPersona,
  crearTablasDeCampana,
  estadoDeCelular,
  guardarResultado,
  listaDeLaCampana,
  quitarPersona,
  sellar as sellarALaHora,
  type AltaDePersona,
} from "../../workers/sala/src/campana";
import type { SelloEnLaRed } from "../../workers/sala/src/cadena";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";

/** La ronda de drand de los sellos de estas pruebas, y la hora (en ms) en que sale. */
const RONDA = 30_000_000;
const SALE_LA_RONDA = roundTime(RONDA) * 1000;
/** Lo que hace el panel: avisa a la sala apenas sella, con la ronda todavía a 40 segundos. */
const AL_SELLAR = SALE_LA_RONDA - 40_000;

/** El sellado como lo pide el panel: a tiempo, antes de que salga la ronda. */
const sellar = (sql: Ejecutar, sorteo: string, sello: SelloEnLaRed) => sellarALaHora(sql, sorteo, sello, AL_SELLAR);

const T0 = 1_000 * VENTANA_CAMPANA_MS;
const CIERRA = T0 + 3_600_000;
const LLEGADA = [3, 1, 2] as const;
const ORGANIZADORA = `G${"O".repeat(55)}`;
const huella = (s: string): string => createHash("sha256").update(s).digest("hex");
const cuentaN = (i: number): string => `G${String(i).padStart(55, "B")}`;
const siempre = (): boolean => true;

function nuevaSala(): { sql: Ejecutar; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => {
    return db.prepare(consulta).all(...p) as unknown as T[];
  };
  crearTablasDeCampana(sql);
  // Lo que la sala guardó del archivo firmado: dos premios.
  sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?), ('premios', '2')", String(CIERRA));
  return { sql, db };
}

function alta(i: number): AltaDePersona {
  return {
    persona: huella(`persona-${i}`),
    cuenta: cuentaN(i),
    d: "datos-cifrados-de-prueba",
    llave: huella(`llave-${i}`),
    grupo: "conexion-1",
    ahora: T0,
    via: "google",
  };
}

function salaConTres(fase: "abierta" | "cerrada" = "cerrada"): Ejecutar {
  const { sql } = nuevaSala();
  for (const i of LLEGADA) expect(anotarPersona(sql, alta(i), siempre).ok).toBe(true);
  sql("UPDATE sala SET v = ? WHERE k = 'fase'", fase);
  return sql;
}

function ordenada(): string[] {
  return listaDeLaCampana(LLEGADA.map(cuentaN));
}

function selloPara(lista: readonly string[]): SelloEnLaRed {
  return {
    listHash: Buffer.from(listHash([...lista])).toString("hex"),
    count: lista.length,
    numWinners: 2,
    sorteado: false,
    organizador: ORGANIZADORA,
    ronda: RONDA,
  };
}

function valor(sql: Ejecutar, clave: string): string | undefined {
  return sql<{ v: string }>("SELECT v FROM sala WHERE k = ?", clave)[0]?.v;
}

function resultado(
  sql: Ejecutar,
  ganadores: readonly number[] = [2, 0],
  comprobante = "/verificar.html#comprobante-inicial",
  sorteo = "42",
) {
  return guardarResultado(sql, { sorteo, ganadores, numWinners: 2, comprobante });
}

describe("el sellado y el resultado comprobados en la red", () => {
  it("la lista ordena, quita repetidas y queda igual al pasar por la lista canónica del sitio", () => {
    const lista = listaDeLaCampana([cuentaN(3), cuentaN(1), cuentaN(3), cuentaN(2)]);
    expect(lista).toEqual([cuentaN(1), cuentaN(2), cuentaN(3)]);
    expect(canonicalList(lista.join("\n"))).toEqual(lista);
  });

  it("sella con la huella de las tres cuentas ordenadas y guarda esa lista", () => {
    const sql = salaConTres();
    const lista = ordenada();
    expect(sellar(sql, "42", selloPara(lista))).toEqual({ ok: true });
    expect(valor(sql, "fase")).toBe("sellada");
    expect(valor(sql, "sorteo")).toBe("42");
    expect(JSON.parse(valor(sql, "lista") ?? "null") as unknown).toEqual(lista);
  });

  it("rechaza un sello con una cuenta de menos o una de más y conserva la fase cerrada", () => {
    const sql = salaConTres();
    const lista = ordenada();
    expect(sellar(sql, "42", selloPara(lista.slice(1)))).toEqual({ ok: false, motivo: "lista-distinta" });
    expect(sellar(sql, "42", selloPara([...lista, cuentaN(4)]))).toEqual({
      ok: false,
      motivo: "lista-distinta",
    });
    expect(valor(sql, "fase")).toBe("cerrada");
  });

  it("rechaza la huella de las mismas cuentas en orden de llegada", () => {
    const sql = salaConTres();
    const llegada = LLEGADA.map(cuentaN);
    expect(selloPara(llegada).listHash).not.toBe(selloPara(ordenada()).listHash);
    expect(sellar(sql, "42", selloPara(llegada))).toEqual({ ok: false, motivo: "lista-distinta" });
    expect(valor(sql, "fase")).toBe("cerrada");
  });

  it("no sella cuando la fase todavía es abierta", () => {
    const sql = salaConTres("abierta");
    expect(sellar(sql, "42", selloPara(ordenada()))).toEqual({ ok: false, motivo: "fase" });
    expect(valor(sql, "fase")).toBe("abierta");
  });

  it("después de sellar no deja anotar ni quitar a nadie", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", selloPara(ordenada())).ok).toBe(true);
    expect(anotarPersona(sql, alta(4), siempre)).toEqual({ ok: false, motivo: "cerrada" });
    expect(quitarPersona(sql, 1, "otro")).toEqual({ ok: false, motivo: "fase" });
  });

  it("traduce los índices 2 y 0 con la lista sellada y pasa a sorteada", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", selloPara(ordenada())).ok).toBe(true);
    expect(resultado(sql)).toEqual({ ok: true, primera: true });
    expect(JSON.parse(valor(sql, "ganadoras") ?? "null") as unknown).toEqual([cuentaN(3), cuentaN(1)]);
    expect(valor(sql, "fase")).toBe("sorteada");
  });

  it("rechaza otro sorteo, un índice inexistente y una cantidad distinta de ganadores", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", selloPara(ordenada())).ok).toBe(true);
    expect(resultado(sql, [2, 0], undefined, "43")).toEqual({ ok: false, motivo: "fase" });
    expect(resultado(sql, [3, 0])).toEqual({ ok: false, motivo: "distinto" });
    expect(resultado(sql, [0])).toEqual({ ok: false, motivo: "distinto" });
    expect(valor(sql, "fase")).toBe("sellada");
  });

  it("repite el mismo resultado solo para cambiar el comprobante y rechaza otros ganadores", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", selloPara(ordenada())).ok).toBe(true);
    expect(resultado(sql)).toEqual({ ok: true, primera: true });
    const nuevo = "/verificar.html#comprobante-con-transaccion";
    expect(resultado(sql, [2, 0], nuevo)).toEqual({ ok: true, primera: false });
    expect(valor(sql, "comprobante")).toBe(nuevo);
    expect(resultado(sql, [0, 2], nuevo)).toEqual({ ok: false, motivo: "distinto" });
    expect(resultado(sql, [2, 0], nuevo, "43")).toEqual({ ok: false, motivo: "distinto" });
  });

  it("el celular de una ganadora ve que ganó y su puesto con su propia llave", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", selloPara(ordenada())).ok).toBe(true);
    expect(resultado(sql).ok).toBe(true);
    expect(estadoDeCelular(sql, cuentaN(3), huella("llave-3"))).toMatchObject({
      fase: "sorteada",
      anotada: true,
      gano: true,
      puesto: 0,
    });
    expect(estadoDeCelular(sql, cuentaN(1), huella("llave-1"))).toMatchObject({ gano: true, puesto: 1 });
  });
});

describe("el sello atado a lo que firmó la empresa", () => {
  const conGanadores = (lista: readonly string[], numWinners: number): SelloEnLaRed => ({ ...selloPara(lista), numWinners });

  it("un sello con más ganadoras que premios firmados se rechaza y la campaña sigue cerrada", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", conGanadores(ordenada(), 3))).toEqual({ ok: false, motivo: "ganadores-distintos" });
    expect(valor(sql, "fase")).toBe("cerrada");
    expect(valor(sql, "lista")).toBeUndefined();
  });

  it("un sello con menos ganadoras que premios firmados también se rechaza", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", conGanadores(ordenada(), 1))).toEqual({ ok: false, motivo: "ganadores-distintos" });
    expect(sellar(sql, "42", conGanadores(ordenada(), 0))).toEqual({ ok: false, motivo: "ganadores-distintos" });
    expect(valor(sql, "fase")).toBe("cerrada");
  });

  it("con el rechazo a la vista se puede reintentar con el sello bueno", () => {
    const sql = salaConTres();
    expect(sellar(sql, "41", conGanadores(ordenada(), 3)).ok).toBe(false);
    expect(sellar(sql, "42", selloPara(ordenada()))).toEqual({ ok: true });
    expect(valor(sql, "sorteo")).toBe("42");
  });

  it("sin la cantidad de premios guardada no se sella: no hay con qué comparar", () => {
    const sql = salaConTres();
    sql("DELETE FROM sala WHERE k = 'premios'");
    expect(sellar(sql, "42", selloPara(ordenada()))).toEqual({ ok: false, motivo: "ganadores-distintos" });
    expect(valor(sql, "fase")).toBe("cerrada");
  });

  it("si la campaña nombra a quien sella, un sello de otra cuenta o sin cuenta legible se rechaza", () => {
    const sql = salaConTres();
    sql("INSERT INTO sala (k, v) VALUES ('organizadora', ?)", ORGANIZADORA);
    const otra = { ...selloPara(ordenada()), organizador: cuentaN(7) };
    expect(sellar(sql, "42", otra)).toEqual({ ok: false, motivo: "organizador-distinto" });
    expect(sellar(sql, "42", { ...otra, organizador: null })).toEqual({ ok: false, motivo: "organizador-distinto" });
    expect(valor(sql, "fase")).toBe("cerrada");
  });

  it("si la campaña nombra a quien sella, el sello de esa cuenta entra", () => {
    const sql = salaConTres();
    sql("INSERT INTO sala (k, v) VALUES ('organizadora', ?)", ORGANIZADORA);
    expect(sellar(sql, "42", selloPara(ordenada()))).toEqual({ ok: true });
  });

  it("si la campaña no nombra a nadie, el sello de cualquier cuenta entra", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", { ...selloPara(ordenada()), organizador: cuentaN(7) })).toEqual({ ok: true });
    const otra = salaConTres();
    expect(sellar(otra, "42", { ...selloPara(ordenada()), organizador: null })).toEqual({ ok: true });
  });

  it("la huella es la de las anotadas que no fueron quitadas, ordenadas por cuenta", () => {
    const sql = salaConTres("abierta");
    expect(quitarPersona(sql, 1, "repetida").ok).toBe(true);
    sql("UPDATE sala SET v = 'cerrada' WHERE k = 'fase'");
    // La cuenta quitada es la primera que se anotó (n = 1): la 3.
    const sinQuitada = listaDeLaCampana([cuentaN(1), cuentaN(2)]);
    expect(sellar(sql, "42", selloPara(ordenada()))).toEqual({ ok: false, motivo: "lista-distinta" });
    expect(sellar(sql, "42", selloPara(sinQuitada))).toEqual({ ok: true });
    expect(JSON.parse(valor(sql, "lista") ?? "null") as unknown).toEqual(sinQuitada);
  });

  it("al guardar el resultado, una cantidad de ganadoras distinta de los premios firmados no se guarda", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", selloPara(ordenada())).ok).toBe(true);
    const r = guardarResultado(sql, { sorteo: "42", ganadores: [2, 0, 1], numWinners: 3, comprobante: "/verificar.html#x" });
    expect(r).toEqual({ ok: false, motivo: "distinto" });
    expect(valor(sql, "fase")).toBe("sellada");
  });
});

describe("el sello llega antes de que exista la semilla", () => {
  it("con la ronda a más de un período, el sello entra", () => {
    const sql = salaConTres();
    expect(sellarALaHora(sql, "42", selloPara(ordenada()), SALE_LA_RONDA - MARGEN_DE_RONDA_MS)).toEqual({ ok: true });
  });

  it("con la ronda a menos de un período, el sello se rechaza y la campaña sigue cerrada", () => {
    const sql = salaConTres();
    const r = sellarALaHora(sql, "42", selloPara(ordenada()), SALE_LA_RONDA - MARGEN_DE_RONDA_MS + 1);
    expect(r).toEqual({ ok: false, motivo: "ronda-pasada" });
    expect(valor(sql, "fase")).toBe("cerrada");
  });

  it("con la ronda ya salida, quien eligió entre varios sellos de la misma lista no puede avisar el que le conviene", () => {
    const sql = salaConTres();
    expect(sellarALaHora(sql, "42", selloPara(ordenada()), SALE_LA_RONDA + 60_000)).toEqual({
      ok: false,
      motivo: "ronda-pasada",
    });
    expect(valor(sql, "sorteo")).toBeUndefined();
  });

  it("un sello ya sorteado en la red se rechaza aunque la hora diga otra cosa", () => {
    const sql = salaConTres();
    expect(sellar(sql, "42", { ...selloPara(ordenada()), sorteado: true })).toEqual({ ok: false, motivo: "ronda-pasada" });
  });

  it("rechazado por la ronda, se puede reintentar con un sello nuevo a tiempo", () => {
    const sql = salaConTres();
    expect(sellarALaHora(sql, "41", selloPara(ordenada()), SALE_LA_RONDA).ok).toBe(false);
    expect(sellar(sql, "42", selloPara(ordenada()))).toEqual({ ok: true });
    expect(valor(sql, "sorteo")).toBe("42");
  });
});
