import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { type Entry, winnerLabel } from "./history";

/** Mis sorteos con un orden de turnos: «Turnos: 12 personas» en lugar de los nombres unidos con comas. */

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const entrada = (over: Partial<Entry>): Entry => ({
  organizer: WHO,
  listHash: "aa",
  count: 10,
  numWinners: 1,
  round: 100,
  sealedAt: 1_000,
  prize: "",
  ...over,
});
const personas = (n: number): string[] => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`);

describe("winnerLabel con un orden de turnos", () => {
  it("12 personas: «Turnos: 12 personas», no los doce nombres", () => {
    const e = entrada({ count: 12, numWinners: 12, prize: "Turnos de limpieza", winners: personas(12) });
    expect(winnerLabel(e)).toBe("Turnos: 12 personas");
    expect(winnerLabel(e)).not.toContain("Participante");
  });

  it("300 personas: una frase corta, no una fila de 300 nombres", () => {
    const e = entrada({ count: 300, numWinners: 300, prize: "Turnos", winners: personas(300) });
    expect(winnerLabel(e)).toBe("Turnos: 300 personas");
  });

  it("también cuando solo se sabe el puesto (lo trajo la cadena) y en inglés al revés de «ganó»", () => {
    const e = entrada({ count: 5, numWinners: 5, prize: "Turns", winnerIdx: [3, 0, 1, 4, 2] });
    expect(winnerLabel(e)).toBe("Turnos: 5 personas");
    expect(T.en.turnsHist).toBe("Turns: {n} people");
    expect(T.es.turnsHist).toBe("Turnos: {n} personas");
  });

  it("un sorteo común sigue diciendo los nombres: 3 poleras entre 3, o turnos de 3 entre 12", () => {
    expect(winnerLabel(entrada({ count: 3, numWinners: 3, prize: "3 poleras", winners: ["Ana", "Beto", "Carla"] }))).toBe("Ana, Beto, Carla");
    expect(winnerLabel(entrada({ count: 12, numWinners: 3, prize: "Turnos de limpieza", winners: ["Ana", "Beto", "Carla"] }))).toBe("Ana, Beto, Carla");
  });

  it("un orden de turnos que todavía no se sorteó sigue pendiente", () => {
    expect(winnerLabel(entrada({ count: 12, numWinners: 12, prize: "Turnos" }))).toBe(T.es.histPending);
  });
});

describe("Mis sorteos con varias participaciones por persona", () => {
  // Ana con 2, Beto con 1 y Carla con 2: 3 personas y 5 líneas, como lo cuentan la espera, la foto y la verificación.
  const repartida = ["Ana Quispe (1/2)", "Ana Quispe (2/2)", "Beto Rojas", "Carla Suarez (1/2)", "Carla Suarez (2/2)"];
  const conModo = "https://tinkazo.app/verificar.html?modo=varias#rX";

  it("un sorteo hecho con el modo dice las dos cuentas, como la verificación de su enlace", async () => {
    const { cuentaDeLaEntrada } = await import("./history");
    const e = entrada({ count: 5, numWinners: 1, prize: "Polera", names: repartida, winners: ["Ana Quispe (2/2)"], proof: conModo });
    expect(cuentaDeLaEntrada(e)).toBe("3 personas, 5 participaciones");
  });

  it("un orden repartido dice cuántas personas y cuántos turnos", () => {
    const e = entrada({
      count: 5,
      numWinners: 5,
      prize: "Turnos",
      names: repartida,
      winners: repartida,
      proof: "https://tinkazo.app/verificar.html?modo=turnos#rX",
    });
    expect(winnerLabel(e)).toBe("Turnos: 3 personas, 5 turnos");
  });

  it("sin el modo, o sin la lista en este equipo, cada línea es una persona, como siempre", async () => {
    const { cuentaDeLaEntrada } = await import("./history");
    const comun = ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Otro"];
    expect(cuentaDeLaEntrada(entrada({ count: 3, names: comun, proof: "https://tinkazo.app/verificar.html#rX" }))).toBe("3 personas");
    expect(cuentaDeLaEntrada(entrada({ count: 5, proof: conModo }))).toBe("5 personas");
    expect(winnerLabel(entrada({ count: 3, numWinners: 3, prize: "Turnos", names: comun, winners: comun }))).toBe("Turnos: 3 personas");
  });

  it("la frase del orden repartido está en los dos idiomas", () => {
    expect(T.es.turnsHistPart).toBe("Turnos: {n} personas, {k} turnos");
    expect(T.en.turnsHistPart).toBe("Turns: {n} people, {k} turns");
  });
});
