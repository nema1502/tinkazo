import { describe, expect, it } from "vitest";
import { corto } from "./carrera-base";
import { nombresDe } from "./carrera-prueba";
import { partirEnDos, tarjetaRetrato } from "./carrera-tarjeta";

/**
 * La tarjeta de nombres del celular: el 25 % de la pantalla como mucho (sección 4 de la dirección). El ancho de un texto se aproxima con
 * 0,56 veces el tamaño de letra por carácter (la letra negrita de la carrera mide eso en promedio); `medir-escala-carrera` lo comprueba
 * con la letra de verdad.
 */

const medir = (s: string, px: number): number => s.length * px * 0.56;
const PANTALLAS = [
  { w: 390, h: 844, u: 0.929 },
  { w: 414, h: 896, u: 0.987 },
  { w: 393, h: 852, u: 0.936 },
];

const tarjeta = (n: number, p: (typeof PANTALLAS)[number]) => {
  const textos = nombresDe(n);
  return tarjetaRetrato({ textos, cortos: textos.map(corto), medir, w: p.w, h: p.h, u: p.u, pxNominal: 17.6, pxMinimo: 16 });
};

describe("la tarjeta de nombres en un celular parado", () => {
  for (const p of PANTALLAS) {
    for (const n of [2, 5, 8, 12, 15, 18, 24, 30]) {
      it(`${p.w}x${p.h}, ${n} nombres: ocupa el 25 % de la pantalla o menos y entra a lo ancho`, () => {
        const d = tarjeta(n, p);
        expect(d.parte).toBeLessThanOrEqual(0.25);
        expect(d.w).toBeLessThanOrEqual(p.w * 0.97);
        // El tamaño que dice es el área de verdad.
        expect(d.parte).toBeCloseTo((d.w * d.h) / (p.w * p.h), 9);
      });
    }
  }

  it("la letra nunca baja de la mínima que se lee, ni sube de la de siempre", () => {
    for (const p of PANTALLAS) for (const n of [2, 8, 18, 30]) {
      const d = tarjeta(n, p);
      expect(d.px).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(d.px).toBeLessThanOrEqual(17.6 + 1e-9);
    }
  });

  it("con pocos nombres usa los nombres enteros; solo con muchos pasa a la forma corta", () => {
    expect(tarjeta(8, PANTALLAS[0] as (typeof PANTALLAS)[number]).corto).toBe(false);
    expect(tarjeta(18, PANTALLAS[0] as (typeof PANTALLAS)[number]).corto).toBe(false);
    expect(tarjeta(30, PANTALLAS[0] as (typeof PANTALLAS)[number]).corto).toBe(true);
  });

  it("cada columna lleva los renglones que le tocan y entran todos los nombres", () => {
    for (const n of [2, 5, 8, 12, 15, 18, 30]) {
      const d = tarjeta(n, PANTALLAS[0] as (typeof PANTALLAS)[number]);
      expect(d.cols * d.filas).toBeGreaterThanOrEqual(n);
      expect(d.cols * d.filas - n).toBeLessThan(d.filas);
      expect(d.anchoCol).toHaveLength(d.cols);
      expect(d.dosLineas).toHaveLength(n);
    }
  });

  it("un nombre más ancho que su columna se parte en dos renglones por el espacio del medio", () => {
    expect(partirEnDos("Fernanda Gutiérrez Pérez")).toEqual(["Fernanda", "Gutiérrez Pérez"]);
    expect(partirEnDos("Ana")).toEqual(["Ana"]);
    const textos = ["María Fernanda Quispe Mamani Condori", "Ana"];
    const d = tarjetaRetrato({ textos, cortos: ["María Q.", "Ana"], medir, w: 390, h: 844, u: 0.929, pxNominal: 17.6, pxMinimo: 16 });
    expect(d.dosLineas[0]).toBe(true);
    expect(d.dosLineas[1]).toBe(false);
  });

  it("cada nombre se dibuja con el texto que midió el diseño: entero, o partido en dos renglones", () => {
    for (const n of [5, 18, 30]) {
      const textos = nombresDe(n);
      const d = tarjetaRetrato({ textos, cortos: textos.map(corto), medir, w: 390, h: 844, u: 0.929, pxNominal: 17.6, pxMinimo: 16 });
      const usados = d.corto ? textos.map(corto) : textos;
      expect(d.rotulos).toHaveLength(n);
      d.rotulos.forEach((r, j) => {
        expect(r.split("\n"), `nombre ${j}`).toHaveLength(d.dosLineas[j] ? 2 : 1);
        expect(r.replace("\n", " "), `nombre ${j}`).toBe(usados[j]);
      });
    }
  });

  it("es una función de los nombres y de la pantalla: dos veces da lo mismo", () => {
    expect(tarjeta(18, PANTALLAS[0] as (typeof PANTALLAS)[number])).toEqual(tarjeta(18, PANTALLAS[0] as (typeof PANTALLAS)[number]));
  });
});

describe("un nombre que no entra ni partido en dos: la tarjeta no falla y todo cabe en la pantalla", () => {
  const chicas = [
    { w: 320, h: 568, u: 0.622 },
    { w: 390, h: 844, u: 0.929 },
  ];
  const otros = (n: number): string[] => nombresDe(n);
  const armar = (textos: string[], p: (typeof chicas)[number], cortos: string[] = textos.map(corto)) =>
    tarjetaRetrato({ textos, cortos, medir, w: p.w, h: p.h, u: p.u, pxNominal: 17.6, pxMinimo: 16 });

  /** Lo que mide de ancho el renglón más largo de un nombre, según el texto que el diseño dibuja. */
  const anchoDe = (r: string, px: number): number => Math.max(...r.split("\n").map((l) => medir(l, px)));

  for (const largo of [45, 80, 300]) {
    for (const p of chicas) {
      it(`${p.w}x${p.h}: un nombre de una sola palabra de ${largo} letras, solo y entre otros 8 y 30 nombres`, () => {
        const palabra = "Wolfeschlegelsteinhausenbergerdorff".repeat(Math.ceil(largo / 35)).slice(0, largo);
        expect(palabra).toHaveLength(largo);
        expect(palabra).not.toContain(" ");
        for (const otrosN of [0, 8, 30]) {
          const textos = otros(otrosN);
          const lugar = Math.floor(textos.length / 2);
          textos.splice(lugar, 0, palabra);
          const d = armar(textos, p);
          const donde = `${otrosN} nombres más`;
          // Entra a lo ancho de la pantalla, con todos sus renglones, y la tarjeta es una forma sana.
          expect(d.rotulos, donde).toHaveLength(textos.length);
          expect(d.w, donde).toBeLessThanOrEqual(p.w * 0.97);
          expect(Number.isFinite(d.h) && d.h > 0, donde).toBe(true);
          expect(d.parte, donde).toBeCloseTo((d.w * d.h) / (p.w * p.h), 9);
          // El nombre largo va en dos renglones como mucho, y cada renglón de cada nombre entra en su columna.
          expect((d.rotulos[lugar] as string).split("\n").length, donde).toBe(2);
          expect(d.dosLineas[lugar], donde).toBe(true);
          d.rotulos.forEach((r, j) => {
            const c = Math.floor(j / d.filas);
            expect(anchoDe(r, d.px), `${donde}: nombre ${j} (${r.length} caracteres)`).toBeLessThanOrEqual((d.anchoCol[c] as number) + 1e-6);
            expect(d.dosLineas[j], `${donde}: nombre ${j}`).toBe(r.includes("\n"));
          });
        }
      });
    }
  }

  it("un nombre de 45 letras se parte por las letras sin perder ninguna; uno de 80 se corta con «…» y los demás quedan enteros", () => {
    const p = chicas[0] as (typeof chicas)[number];
    const letras45 = "Abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrs";
    const letras80 = letras45 + letras45.slice(0, 35);
    expect(letras45).toHaveLength(45);
    expect(letras80).toHaveLength(80);
    const d45 = armar([letras45, "Ana", "Luis Pérez"], p);
    expect((d45.rotulos[0] as string).replace("\n", "")).toBe(letras45);
    expect(d45.rotulos.slice(1)).toEqual(["Ana", "Luis Pérez"]);
    const d80 = armar([letras80, "Ana", "Luis Pérez"], p);
    const r80 = d80.rotulos[0] as string;
    expect(r80.endsWith("…")).toBe(true);
    expect(letras80.startsWith((r80.split("\n")[0] as string))).toBe(true);
    expect(r80.replace("\n", "").replace("…", "").length).toBeLessThan(80);
    expect(d80.rotulos.slice(1).map((r) => r.replace("\n", " "))).toEqual(["Ana", "Luis Pérez"]);
  });

  it("si es lo único que hay, también entra", () => {
    for (const p of chicas) {
      const d = armar(["Z".repeat(200)], p);
      expect(d.rotulos).toHaveLength(1);
      expect(d.w).toBeLessThanOrEqual(p.w * 0.97);
      expect((d.rotulos[0] as string).endsWith("…")).toBe(true);
    }
  });

  it("los nombres de siempre no cambian: ninguno se corta ni se parte por las letras", () => {
    for (const p of chicas) for (const n of [2, 8, 18, 30]) {
      const textos = otros(n);
      const d = armar(textos, p);
      const usados = d.corto ? textos.map(corto) : textos;
      d.rotulos.forEach((r, j) => expect(r.replace("\n", " "), `${p.w}: nombre ${j}`).toBe(usados[j]));
    }
  });
});

