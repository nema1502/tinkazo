/**
 * El celular de mentira para las pruebas de la lectura de la cuenta y de sus avisos (`celular-cuenta.test.ts` y
 * `celular-otro-lado.test.ts`): la página de verdad (`participar.html`) con la sala, la sesión y el reloj falsos. Solo lo
 * usan las pruebas, dentro de jsdom y con `vi.useFakeTimers()`; nada de la página lo importa.
 */

import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import { montarCelular, type DepsDelCelular, type EstadoPropio, type EstadoPublico } from "./celular";
import { campanaDeEjemplo } from "./ejemplo";
import { TEXTOS_CAMPANA } from "./textos";

export const AHORA = Date.UTC(2026, 10, 21, 18);
export const CUENTA = `G${"A".repeat(55)}`;
export const OTRA_CUENTA = `G${"B".repeat(55)}`;
export const SESION = { cuenta: CUENTA, nombre: "Ana P." };

usarTextos(TEXTOS_CAMPANA);

const main = /<main[\s\S]*<\/main>/.exec(readFileSync("participar.html", "utf8"))?.[0] ?? "";

export const asentar = async (): Promise<void> => {
  for (let vuelta = 0; vuelta < 10; vuelta += 1) await Promise.resolve();
};

/** Deja pasar el tiempo del reloj falso, también para las promesas que se resuelven en el camino. */
export const pasar = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await asentar();
};

export const publico = (): EstadoPublico => ({ fase: "abierta", total: 37, cierraMs: campanaDeEjemplo(AHORA).cierraMs, pase: "vale" });

export const propio = (fase: EstadoPropio["fase"] = "abierta"): EstadoPropio => ({
  fase,
  total: 37,
  cierraMs: campanaDeEjemplo(AHORA).cierraMs,
  anotada: true,
});

export const lectura = (estado: LecturaDelCelular["estado"], resto: Partial<LecturaDelCelular> = {}): LecturaDelCelular => ({
  estado,
  protegida: false,
  correoDeLaSesionConfirmado: false,
  puedeMandar: false,
  correoTapado: null,
  limite: false,
  ...resto,
});

/** Una lectura que contesta lo que diga la lista, una por llamada, y repite la última. */
export const lecturasDe = (...respuestas: LecturaDelCelular[]) => {
  let n = 0;
  return vi.fn(async () => respuestas[Math.min(n++, respuestas.length - 1)] as LecturaDelCelular);
};

export interface Mundo {
  raiz: HTMLElement;
  deps: DepsDelCelular;
  vista: ReturnType<typeof montarCelular>;
  disparar: (ms: number) => Promise<void>;
  volver: () => Promise<void>;
  ponerVisible: (valor: boolean) => void;
}

/**
 * Monta la página. Con `relojReal` el reloj de la página es el del sistema falso (el que avanza con los temporizadores);
 * sin él, la hora queda quieta en `AHORA`.
 */
export async function prepararCelular(cambios: Partial<DepsDelCelular> = {}, relojReal = false): Promise<Mundo> {
  document.body.innerHTML = main;
  setLang("es");
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const campana = campanaDeEjemplo(AHORA);
  const callbacks = new Map<number, () => void>();
  let visible = true;
  let alVolver: () => void = () => undefined;
  const deps: DepsDelCelular = {
    tx: texto,
    idioma: getLang,
    campana,
    enApp: false,
    ahora: relojReal ? () => Date.now() : () => AHORA,
    publico: async () => publico(),
    sesion: async () => null,
    entrar: async () => SESION,
    anotar: async () => ({ ok: true, ya: false }),
    yo: async () => ({ ...propio(), anotada: false }),
    resultado: async () => ({ ganadoras: [CUENTA], comprobante: "/verificar.html?demo=1" }),
    recibir: () => undefined,
    salir: async () => undefined,
    costoDelRetiro: () => "0,50",
    enlace: () => "https://tinkazo.app/participar.html?demo=campana",
    cada: (f, ms) => {
      callbacks.set(ms, f);
      return () => {
        if (callbacks.get(ms) === f) callbacks.delete(ms);
      };
    },
    visible: () => visible,
    alVolver: (f) => {
      alVolver = f;
      return () => undefined;
    },
    vibrar: () => undefined,
    movimientoReducido: () => false,
    memoria: null,
    sala: campana.evento,
    ...cambios,
  };
  const vista = montarCelular(raiz, deps);
  await asentar();
  return {
    raiz,
    deps,
    vista,
    disparar: async (ms) => {
      callbacks.get(ms)?.();
      await asentar();
    },
    volver: async () => {
      alVolver();
      await asentar();
    },
    ponerVisible: (valor) => {
      visible = valor;
    },
  };
}

/** Un toque en la página: lo que el aviso mira para no cambiar un botón bajo un dedo. */
export function tocar(raiz: HTMLElement): void {
  raiz.querySelector("h1")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}
