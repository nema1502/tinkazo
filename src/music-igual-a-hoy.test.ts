// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ESCENARIOS_DE_LA_MUSICA, JUEGOS_DEL_SELECTOR, semillaDelJuego, trazaDelEscenario, trazaDelShow } from "./music-traza";

/**
 * Lo que suena hoy en producción no cambia sin medirlo y sin oídos. Esta prueba corre un show completo de cada uno de
 * los diez juegos del selector, con reloj falso, la misma semilla por juego y un guion que incluye los tropiezos del
 * procesador (160, 320 y 640 ms), la pestaña escondida y un tirón de la red, y compara nota por nota lo que la música
 * le programa al audio con la referencia de `music-referencia.json`, que salió de correr este mismo guion con el
 * código de la rama principal antes del motor por capas (el commit queda anotado en `origen`).
 *
 * Los cambios del adelgazado de capas y de la bajada rápida del margen viven detrás del interruptor
 * `?musicagracia=1`, apagado por defecto: apagado, la traza es idéntica. Si algún día la música cambia a propósito
 * (porque alguien la escuchó y la eligió), la referencia se rehace en el mismo cambio.
 *
 * Además del show de siempre hay seis casos de la vida real que ese guion no ve: tres premios seguidos con la música
 * sin recargar, el arranque con la pestaña escondida, saltar el show a la mitad, un contexto que nace suspendido, la
 * vuelta a la pestaña con el contexto interrumpido (el iPhone) y la dirección con `?instant=1`.
 *
 * Para rehacer la referencia desde un commit de la rama principal: `node scripts/music-referencia.mjs <commit>`.
 * Esa corrida pone `MUSICA_REFERENCIA_SALIDA` y este mismo archivo, en vez de comparar, escribe lo que programa el código
 * de ese commit.
 */

interface Huella {
  eventos: number;
  notas: number;
  sha256: string;
}
interface Referencia {
  /** El commit de la rama principal con cuyo código se generó. */
  origen: string;
  juegos: Record<string, Huella>;
  escenarios: Record<string, Huella>;
}
const huella = (eventos: string[]): string => createHash("sha256").update(eventos.join("\n")).digest("hex");
const JUEGOS_DE_LOS_ESCENARIOS = ["race", "chovena", "sapo"] as const;
const salida = process.env.MUSICA_REFERENCIA_SALIDA;

if (salida) {
  // Modo generador: escribe la referencia con el código que esté en esta carpeta, sin comparar nada.
  describe("referencia de la música", () => {
    it("escribe lo que programa este código", async () => {
      const juegos: Record<string, Huella> = {};
      for (const juego of JUEGOS_DEL_SELECTOR) {
        const t = await trazaDelShow(juego, semillaDelJuego(juego));
        juegos[juego] = { eventos: t.eventos.length, notas: t.notas, sha256: huella(t.eventos) };
      }
      const escenarios: Record<string, Huella> = {};
      for (const e of ESCENARIOS_DE_LA_MUSICA) {
        for (const juego of JUEGOS_DE_LOS_ESCENARIOS) {
          const t = await trazaDelEscenario(e, juego);
          escenarios[`${e}/${juego}`] = { eventos: t.eventos.length, notas: t.notas, sha256: huella(t.eventos) };
        }
      }
      const origen = process.env.MUSICA_REFERENCIA_ORIGEN ?? "desconocido";
      writeFileSync(salida, `${JSON.stringify({ origen, juegos, escenarios } satisfies Referencia, null, 2)}
`);
    }, 600000);
  });
} else {
  const referencia = JSON.parse(readFileSync(resolve(process.cwd(), "src/music-referencia.json"), "utf8")) as Referencia;

  describe("con el interruptor apagado, la música programa lo mismo que hoy", () => {
    it("la referencia anota de qué commit de la rama principal sale", () => {
      expect(referencia.origen).toMatch(/^[0-9a-f]{40}$/);
    });

    it("la referencia trae los diez juegos del selector", () => {
      expect(Object.keys(referencia.juegos).sort()).toEqual([...JUEGOS_DEL_SELECTOR].sort());
    });

    it.each(JUEGOS_DEL_SELECTOR)("%s: mismas notas, mismos tiempos, mismas conexiones", async (juego) => {
      const t = await trazaDelShow(juego, semillaDelJuego(juego));
      expect({ eventos: t.eventos.length, notas: t.notas, sha256: huella(t.eventos) }).toEqual(referencia.juegos[juego]);
    });

    it("la misma corrida dos veces da lo mismo (el guion no depende del azar ni del reloj de verdad)", async () => {
      const a = await trazaDelShow("race", 99);
      const b = await trazaDelShow("race", 99);
      expect(huella(a.eventos)).toBe(huella(b.eventos));
    });
  });

  describe("con el interruptor apagado, los casos de la vida real suenan lo mismo que hoy", () => {
    it("la referencia trae todos los casos", () => {
      const esperados = ESCENARIOS_DE_LA_MUSICA.flatMap((e) => JUEGOS_DE_LOS_ESCENARIOS.map((j) => `${e}/${j}`));
      expect(Object.keys(referencia.escenarios).sort()).toEqual(esperados.sort());
    });

    const casos = ESCENARIOS_DE_LA_MUSICA.flatMap((e) => JUEGOS_DE_LOS_ESCENARIOS.map((j) => [e, j] as const));
    it.each(casos)("%s con %s: mismas notas, mismos tiempos, mismas conexiones", async (escenario, juego) => {
      const t = await trazaDelEscenario(escenario, juego);
      expect({ eventos: t.eventos.length, notas: t.notas, sha256: huella(t.eventos) }).toEqual(referencia.escenarios[`${escenario}/${juego}`]);
    });
  });
}

describe.skipIf(!!salida)("con el interruptor prendido, el adelgazado sí cambia lo que se programa", () => {
  it("la carrera con el procesador frenado programa distinto: menos capas y más por delante", async () => {
    const apagado = await trazaDelShow("race", semillaDelJuego("race"));
    const prendido = await trazaDelShow("race", semillaDelJuego("race"), undefined, async () => {
      (await import("./music-margen")).prenderAdelgazado(true);
    });
    expect(huella(prendido.eventos)).not.toBe(huella(apagado.eventos));
    expect(prendido.notas).toBeLessThan(apagado.notas);
  });
});
