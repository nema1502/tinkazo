// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JUEGOS_DEL_SELECTOR, semillaDelJuego, trazaDelShow } from "./music-traza";

/**
 * Lo que suena hoy en producción no cambia sin medirlo y sin oídos. Esta prueba corre un show completo de cada uno de
 * los diez juegos del selector, con reloj falso, la misma semilla por juego y un guion que incluye los tropiezos del
 * procesador (160, 320 y 640 ms), la pestaña escondida y un tirón de la red, y compara nota por nota lo que la música
 * le programa al audio con la referencia de `music-referencia.json`, que salió de correr este mismo guion con el
 * código de la rama principal antes del motor por capas.
 *
 * Los cambios del adelgazado de capas y de la bajada rápida del margen viven detrás del interruptor
 * `?musicagracia=1`, apagado por defecto: apagado, la traza es idéntica. Si algún día la música cambia a propósito
 * (porque alguien la escuchó y la eligió), la referencia se rehace en el mismo cambio.
 */

type Referencia = Record<string, { eventos: number; notas: number; sha256: string }>;
const referencia = JSON.parse(readFileSync(resolve(process.cwd(), "src/music-referencia.json"), "utf8")) as Referencia;
const huella = (eventos: string[]): string => createHash("sha256").update(eventos.join("\n")).digest("hex");

describe("con el interruptor apagado, la música programa lo mismo que hoy", () => {
  it("la referencia trae los diez juegos del selector", () => {
    expect(Object.keys(referencia).sort()).toEqual([...JUEGOS_DEL_SELECTOR].sort());
  });

  it.each(JUEGOS_DEL_SELECTOR)("%s: mismas notas, mismos tiempos, mismas conexiones", async (juego) => {
    const t = await trazaDelShow(juego, semillaDelJuego(juego));
    expect({ eventos: t.eventos.length, notas: t.notas, sha256: huella(t.eventos) }).toEqual(referencia[juego]);
  });

  it("la misma corrida dos veces da lo mismo (el guion no depende del azar ni del reloj de verdad)", async () => {
    const a = await trazaDelShow("race", 99);
    const b = await trazaDelShow("race", 99);
    expect(huella(a.eventos)).toBe(huella(b.eventos));
  });
});

describe("con el interruptor prendido, el adelgazado sí cambia lo que se programa", () => {
  it("la carrera con el procesador frenado programa distinto: menos capas y más por delante", async () => {
    const apagado = await trazaDelShow("race", semillaDelJuego("race"));
    const prendido = await trazaDelShow("race", semillaDelJuego("race"), undefined, async () => {
      (await import("./music-margen")).prenderAdelgazado(true);
    });
    expect(huella(prendido.eventos)).not.toBe(huella(apagado.eventos));
    expect(prendido.notas).toBeLessThan(apagado.notas);
  });
});
