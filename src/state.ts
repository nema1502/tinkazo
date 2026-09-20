/** `race` y `stellar` son la misma carrera con distinto escenario. */
export type Game = "race" | "stellar" | "wheel";

/** Ronda de quicknet ya publicada y verificada. */
export interface Beacon {
  round: number;
  /** `sha256(signature)`, en hex. Igual al `randomness` de drand. */
  randomness: string;
  /** Firma G1 comprimida (48 bytes) en hex. */
  signature: string;
}

export interface Frozen {
  names: string[];
  /** `list_hash` en hex (protocolo §1). */
  listHash: string;
  /** Instante del sello (Unix, segundos). */
  ts: number;
  at: string;
  prize: string;
  /** Ronda objetivo de quicknet (protocolo §3). */
  round: number;
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

/**
 * Segundos entre el sello y la ronda objetivo. 45 s por defecto: margen sobre
 * los 30 s que exige el contrato. `?lead=N` (mínimo 3) acorta la espera en
 * demos del modo libre.
 */
export const LEAD_SECONDS = Math.max(3, Number(params.get("lead")) || 45);

export const SAMPLE = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];

export const avatar = (name: string, size: number): string =>
  `https://api.dicebear.com/9.x/adventurer-neutral/svg?size=${size}&seed=${encodeURIComponent(name)}`;
