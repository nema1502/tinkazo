import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { isSecretSanta, isSecretSantaPrize, paraQuien, reparto } from "./amigo";
import { isTurnOrder, isTurnPrize } from "./turnos";

describe("el nombre de un Amigo secreto", () => {
  it("empieza con Amigo secreto o Secret Santa, sin distinguir mayúsculas ni espacios al principio", () => {
    const nombres = [
      "Amigo secreto",
      "amigo secreto",
      "AMIGO SECRETO",
      "  Amigo secreto",
      "Amigo   secreto del trabajo",
      "Amigo secreto: 2026",
      "Amigo secreto2026",
      "Secret Santa",
      "secret santa",
      "SECRET SANTA",
      " Secret   Santa for the lab",
      "Secret Santa-2026",
      "Secret Santa2026",
    ];
    for (const nombre of nombres) expect(isSecretSantaPrize(nombre), nombre).toBe(true);
  });

  it("exige la frase completa al principio y no admite que siga con otra letra", () => {
    const nombres = ["", "   ", "Amigo", "El amigo secreto", "Amigo secretos", "Amigo secretoS", "Secret", "Secret Santas", "Secret SantaClaus", "Turnos"];
    for (const nombre of nombres) expect(isSecretSantaPrize(nombre), nombre).toBe(false);
  });
});

describe("el reconocimiento del sorteo", () => {
  it("requiere que salgan todas las personas, al menos dos, y el nombre del modo", () => {
    expect(isSecretSanta(18, 18, "Amigo secreto")).toBe(true);
    expect(isSecretSanta(18, 18, "Secret Santa")).toBe(true);
    expect(isSecretSanta(18, 17, "Amigo secreto")).toBe(false);
    expect(isSecretSanta(18, 18, "Turnos")).toBe(false);
    expect(isSecretSanta(1, 1, "Amigo secreto")).toBe(false);
    expect(isSecretSanta(0, 0, "Secret Santa")).toBe(false);
  });

  it("no se confunde con un orden de turnos en ninguna dirección", () => {
    for (const nombre of ["Amigo secreto", "Secret Santa"]) {
      expect(isSecretSanta(12, 12, nombre), nombre).toBe(true);
      expect(isTurnPrize(nombre), nombre).toBe(false);
      expect(isTurnOrder(12, 12, nombre), nombre).toBe(false);
    }
    for (const nombre of ["Turnos", "Turns"]) {
      expect(isTurnOrder(12, 12, nombre), nombre).toBe(true);
      expect(isSecretSantaPrize(nombre), nombre).toBe(false);
      expect(isSecretSanta(12, 12, nombre), nombre).toBe(false);
    }
  });
});

describe("el reparto del orden sellado", () => {
  const caso = vectors.cases.find((c) => c.k === vectors.count);
  if (!caso) throw new Error("Falta el caso con todas las personas en los vectores");

  it("con las 18 personas del vector, cada una le regala a la siguiente y la última a la primera", () => {
    expect(reparto(vectors.list, caso.winners)).toEqual([
      { from: "Ana Vargas", to: "Miguel Arce" },
      { from: "Miguel Arce", to: "Carlos Choque" },
      { from: "Carlos Choque", to: "Óscar Limachi" },
      { from: "Óscar Limachi", to: "María Quispe" },
      { from: "María Quispe", to: "Camila Suárez" },
      { from: "Camila Suárez", to: "Franco Ibáñez" },
      { from: "Franco Ibáñez", to: "Diego Rojas" },
      { from: "Diego Rojas", to: "Pablo Gutiérrez" },
      { from: "Pablo Gutiérrez", to: "Sofía Aguilar" },
      { from: "Sofía Aguilar", to: "Paola Mendoza" },
      { from: "Paola Mendoza", to: "Jorge Mamani" },
      { from: "Jorge Mamani", to: "Rodrigo Peña" },
      { from: "Rodrigo Peña", to: "Daniela Cruz" },
      { from: "Daniela Cruz", to: "Lucía Flores" },
      { from: "Lucía Flores", to: "Andrés Villca" },
      { from: "Andrés Villca", to: "Elena Condori" },
      { from: "Elena Condori", to: "Valeria Torrez" },
      { from: "Valeria Torrez", to: "Ana Vargas" },
    ]);
    expect(paraQuien(vectors.list, caso.winners, "Ana Vargas")).toBe("Miguel Arce");
    expect(paraQuien(vectors.list, caso.winners, "Valeria Torrez")).toBe("Ana Vargas");
    expect(paraQuien(vectors.list, caso.winners, "Nadie")).toBeNull();
  });

  it("de 2 a 300 personas, nadie se regala a sí mismo, todos dan y reciben una vez y hay una sola ronda", () => {
    for (let n = 2; n <= 300; n++) {
      const names = Array.from({ length: n }, (_, i) => `Persona ${i}`);
      const winners = names.map((_, i) => n - i - 1);
      const assignments = reparto(names, winners);
      expect(assignments, `${n} personas`).toHaveLength(n);
      expect(new Set(assignments.map((assignment) => assignment.from)).size, `${n} que dan`).toBe(n);
      expect(new Set(assignments.map((assignment) => assignment.to)).size, `${n} que reciben`).toBe(n);
      for (const assignment of assignments) expect(assignment.from, `${n} personas`).not.toBe(assignment.to);

      const next = new Map(assignments.map((assignment) => [assignment.from, assignment.to]));
      const first = assignments[0]?.from;
      if (first === undefined) throw new Error("Falta la primera persona del reparto");
      let current = first;
      const visited = new Set<string>();
      for (let step = 0; step < n; step++) {
        visited.add(current);
        current = next.get(current) ?? "";
      }
      expect(visited.size, `${n} lugares de la ronda`).toBe(n);
      expect(current, `${n} personas cierran una sola ronda`).toBe(first);
    }
  });

  it("el mismo orden da siempre el mismo reparto y no cambia las entradas", () => {
    const names = [...vectors.list];
    const winners = [...caso.winners];
    const namesBefore = [...names];
    const winnersBefore = [...winners];
    expect(reparto(names, winners)).toEqual(reparto(names, winners));
    expect(names).toEqual(namesBefore);
    expect(winners).toEqual(winnersBefore);
  });
});
