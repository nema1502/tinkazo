import type { Beacon } from "./protocol/legacy-v1";

export type Game = "race" | "wheel";

export interface Frozen {
  names: string[];
  digest: string;
  ts: number;
  at: string;
  prize: string;
}

export interface Drawn {
  beacon: Beacon;
  winners: number[];
}

/** Estado de la pantalla principal. Un solo sorteo por carga de página. */
export const app: { game: Game; frozen: Frozen | null; drawn: Drawn | null } = {
  game: "race",
  frozen: null,
  drawn: null,
};

/** Variables CSS de la paleta, en el orden que usan carriles y gajos. */
export const LCOLORS = ["--magenta", "--orange", "--teal", "--purple", "--yellow"] as const;

/** La ruleta se ve bien hasta esta cantidad de participantes. */
export const WHEEL_MAX = 24;

export const params = new URLSearchParams(location.search);

/** `?instant=1`: salta las animaciones (capturas y pruebas). */
export const instantMode = params.get("instant") === "1";

export const SAMPLE = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];

export const avatar = (name: string, size: number): string =>
  `https://api.dicebear.com/9.x/adventurer-neutral/svg?size=${size}&seed=${encodeURIComponent(name)}`;
