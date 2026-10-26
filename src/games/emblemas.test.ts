import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAVES, COLORES, COMBINACIONES, emblemaDe, emblemasDe } from "./emblemas";

const NOMBRES = [
  "Carlos Choque", "María Quispe", "Jorge Mamani", "Ana Vargas", "Óscar Limachi", "Valeria Torrez", "Miguel Arce",
  "Lucía Rojas", "Diego Flores", "Rosario Condori", "Álvaro Peña", "Camila Salvatierra", "Hugo Cuéllar", "Sofía Aguilera",
  "Mateo Rivero", "Daniela Justiniano", "Bruno Vaca", "Paola Chávez", "Iván Suárez", "Noelia Parada", "Raúl Mendoza",
  "Fabiola Barrón", "Gonzalo Ribera", "Karen Medina", "Julio Tapia", "Vanessa Egüez", "Pablo Lijerón", "Tania Roca",
  "Sergio Ayala", "Alejandra Cruz", "Ñusta", "🌸 Ana 🌸",
];

const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `${NOMBRES[i % NOMBRES.length] as string} ${i < NOMBRES.length ? "" : i}`.trim());

afterEach(() => vi.restoreAllMocks());

describe("emblemas: el catálogo", () => {
  it("tiene 32 claves distintas, en minúscula y sin acentos ni espacios", () => {
    expect(CLAVES.length).toBe(32);
    expect(new Set(CLAVES).size).toBe(32);
    for (const c of CLAVES) expect(c).toMatch(/^[a-z]+$/);
  });

  it("tiene ocho colores distintos de seis cifras", () => {
    expect(COLORES.length).toBe(8);
    expect(new Set(COLORES).size).toBe(8);
    for (const c of COLORES) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(COMBINACIONES).toBe(256);
  });
});

describe("emblemaDe", () => {
  it("es determinista: el mismo nombre y la misma ronda dan lo mismo", () => {
    for (const n of NOMBRES) expect(emblemaDe(n, 1234)).toEqual(emblemaDe(n, 1234));
  });

  it("devuelve una clave y un color del catálogo", () => {
    for (const n of NOMBRES) {
      const e = emblemaDe(n, 99);
      expect(CLAVES).toContain(e.clave);
      expect(COLORES).toContain(e.color);
      expect(COLORES[e.tono]).toBe(e.color);
    }
  });

  it("cambia con la ronda (el mismo grupo no se ve igual en dos sorteos)", () => {
    const a = NOMBRES.map((n) => emblemaDe(n, 100).clave);
    const b = NOMBRES.map((n) => emblemaDe(n, 101).clave);
    expect(a.filter((c, i) => c === b[i]).length).toBeLessThan(NOMBRES.length / 2);
  });

  it("acepta la ronda como número o como texto", () => {
    expect(emblemaDe("Ana", 7)).toEqual(emblemaDe("Ana", "7"));
    expect(() => emblemaDe("Ana", "ab12cd")).not.toThrow();
  });

  it("no distingue la forma Unicode del nombre ni los espacios de los bordes", () => {
    expect(emblemaDe("José", 5)).toEqual(emblemaDe("José", 5));
    expect(emblemaDe("  Ana  ", 5)).toEqual(emblemaDe("Ana", 5));
  });

  it("reparte parejo: ninguna clave se queda sin salir en 6400 nombres", () => {
    const veces = new Map<string, number>();
    for (let i = 0; i < 6400; i++) {
      const c = emblemaDe(`persona ${i}`, 42).clave;
      veces.set(c, (veces.get(c) ?? 0) + 1);
    }
    expect(veces.size).toBe(32);
    for (const v of veces.values()) expect(v).toBeGreaterThan(130); // el azar da unas 200 cada una
  });

  it("aguanta nombres de 1, 12 y 40 caracteres, con acentos y emojis", () => {
    for (const n of ["Ñ", "María Quispe", "María Fernanda Guadalupe Quispe Mamani Zu", "Maximiliano_Alexander_Constantino_Rosario", "🌸 Ana 🌸", ""]) {
      expect(CLAVES).toContain(emblemaDe(n, 3).clave);
    }
  });

  it("no usa Math.random", () => {
    const espia = vi.spyOn(Math, "random");
    emblemaDe("Ana", 1);
    emblemasDe(lista(40), 1);
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("emblemasDe", () => {
  it("hasta 32 personas nadie repite emblema, en cualquier ronda", () => {
    for (const n of [1, 2, 8, 18, 30, 31, 32]) {
      for (const ronda of [1, 2, 3, 12345, 99999999]) {
        const claves = emblemasDe(lista(n), ronda).map((e) => e.clave);
        expect(new Set(claves).size, `n=${n} ronda=${ronda}`).toBe(n);
      }
    }
  });

  it("con más de 32, ningún emblema se usa más de ceil(n/32) veces y nadie comparte emblema y color hasta 256", () => {
    for (const n of [33, 50, 60, 64, 100, 200, 256]) {
      const res = emblemasDe(lista(n), 777);
      const porClave = new Map<string, number>();
      for (const e of res) porClave.set(e.clave, (porClave.get(e.clave) ?? 0) + 1);
      expect(Math.max(...porClave.values()), `n=${n}`).toBeLessThanOrEqual(Math.ceil(n / 32));
      expect(new Set(res.map((e) => `${e.clave}|${e.color}`)).size, `n=${n}`).toBe(n);
    }
  });

  it("con más de 256 reparte parejo y no se cuelga", () => {
    const res = emblemasDe(lista(1000), 5);
    expect(res.length).toBe(1000);
    const porPar = new Map<string, number>();
    for (const e of res) porPar.set(`${e.clave}|${e.color}`, (porPar.get(`${e.clave}|${e.color}`) ?? 0) + 1);
    expect(Math.max(...porPar.values())).toBeLessThanOrEqual(Math.ceil(1000 / 256));
  });

  it("es determinista y no depende del orden de la lista", () => {
    const l = lista(30);
    const a = emblemasDe(l, 4321);
    expect(emblemasDe(l, 4321)).toEqual(a);
    const orden = l.map((_, i) => (i * 7 + 3) % l.length); // una permutación
    const b = emblemasDe(orden.map((i) => l[i] as string), 4321);
    orden.forEach((i, j) => expect(b[j]).toEqual(a[i]));
  });

  it("casi todos conservan el primer emblema que les toca solos", () => {
    const l = lista(10);
    const propios = l.map((n) => emblemaDe(n, 9).clave);
    const juntos = emblemasDe(l, 9).map((e) => e.clave);
    expect(juntos.filter((c, i) => c === propios[i]).length).toBeGreaterThanOrEqual(5);
  });

  it("dos nombres idénticos reciben emblemas distintos", () => {
    const [a, b] = emblemasDe(["Juan Pérez", "Juan Pérez"], 1);
    expect(a?.clave).not.toBe(b?.clave);
  });

  it("una lista vacía da una lista vacía", () => {
    expect(emblemasDe([], 1)).toEqual([]);
  });
});
