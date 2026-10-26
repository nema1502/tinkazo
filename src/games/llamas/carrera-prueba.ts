import { writeStory } from "../drama";
import { azarDe, sembrar } from "../pixi/kit/azar";
import type { Contexto } from "../pixi/kit/tipos";
import { TEXTOS_CARRERA } from "./carrera-textos";

/** Lo que comparten las pruebas de la carrera: una lista de nombres, una ronda y un contexto como el que arma el kit. */
export const BASE = ["María Quispe Mamani", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas", "Sofía Aguilar", "Miguel Arce", "Valeria Condori", "Óscar Limachi", "Elena Condori", "Franco Ibáñez", "Daniela Cruz", "Paola Mendoza", "Andrés Nina", "Rosa Apaza", "Pedro Huanca", "Camila Rios", "Ignacio Soliz", "Tatiana Vega", "Nicolás Peña", "Fernanda Gutiérrez Pérez", "Álvaro Toledo", "Beatriz Salas", "Ramiro Paz", "Julia Vera", "Hugo Zapata", "Irma Cori", "Sergio Luna", "Wara Quispe", "Tomás Arias", "Noelia Reyes"];
export const nombresDe = (n: number): string[] => Array.from({ length: n }, (_, i) => `${BASE[i % BASE.length]}${i >= BASE.length ? ` ${Math.floor(i / BASE.length) + 1}` : ""}`);
export const hex = (s: number): string => Array.from({ length: 16 }, (_, i) => ((s * 2654435761 + i * 40503) >>> 0).toString(16).padStart(8, "0")).join("").slice(0, 128);

export function ctxDe(n: number, semilla: number, idioma: "es" | "en" = "es"): Contexto {
  const ronda = hex(semilla);
  const nombres = nombresDe(n);
  const rng = sembrar(parseInt(ronda.slice(0, 8), 16));
  const dic = TEXTOS_CARRERA[idioma];
  const gana = Math.floor(azarDe(ronda, "ganadora") * n);
  return {
    nombres, ganadores: [gana], ronda, rng, idioma,
    txt: (clave, ...args) => {
      const v = dic[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (e) => azarDe(ronda, `race:${e}`),
    historia: (a, g) => writeStory(rng, a, g),
  };
}

