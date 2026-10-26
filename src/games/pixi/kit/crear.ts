import type { Texture } from "pixi.js";
import { writeStory } from "../../drama";
import { tiemposFoco } from "../foco";
import { CHIP_SCALE, anfitrionTinkazo, type Anfitrion, type Enfoque } from "./anfitrion";
import { azarDe } from "./azar";
import { crearDirector, type Pantalla } from "./director";
import { figurasDe, tamanoMinimoFigura } from "./figuras";
import { crearGuion, type EjecutorGuion } from "./guion";
import { crearMarcadorVista } from "./marcador-vista";
import { tamanoLetra } from "./nombres";
import { crearSonido } from "./sonido";
import type { Contexto, DefJuego, Kit, Lanzador, Plan } from "./tipos";

/**
 * `crearJuego`: el pegamento que cada juego repetía a mano.
 *
 * Un juego escribe su plan (puro), su escena y su cuadro. Esto escribe una vez:
 *
 * - **montar**, y con `?instant=1` o movimiento reducido, cerrar sin dibujar
 *   (`done()` siempre llega);
 * - **la historia y el azar**: el plan pide la historia cuando le toca, así
 *   `rng` se gasta en el mismo orden que antes. El kit nunca llama a `rng`;
 * - **la duración**, con lo que se sostiene el foco, para el selector;
 * - **el guion**, con su cola, y la cámara con los cinco arcos;
 * - **la coronación con foco**: la música se corta, el silencio, el golpe a la
 *   hora del foco, el cartel después; **saltar** va directo al golpe;
 * - **el bucle** y el cierre, y volver a armar la escena si cambia el tamaño.
 *
 * La coronación es la de `sapo.ts`, `oruro.ts` y `chovena.ts`: ver
 * `foco-juegos.test.ts`. Todo sale de la hora del juego (`dt`).
 */
export function crearJuego<P, E>(def: DefJuego<P, E>, anf: Anfitrion = anfitrionTinkazo): Lanzador {
  return async (nombres, ganadores, baliza, listo) => {
    let saltarFn = (): void => {};
    const S = await anf.montar(baliza, listo, () => saltarFn(), { musica: def.musica });
    if (!S) {
      listo();
      return;
    }

    /* ----------------------------------------------------------- el contexto */
    const idioma = anf.idioma();
    const txt = (clave: string, ...args: readonly unknown[]): string => {
      const v = def.textos?.[idioma][clave];
      if (typeof v === "function") return v(...args);
      if (typeof v === "string") return v;
      return anf.frase(clave, args) ?? clave;
    };
    const azar = (etiqueta: string): number => azarDe(baliza.randomness, `${def.id}:${etiqueta}`);
    const ctx: Contexto = {
      nombres, ganadores, ronda: baliza.randomness, rng: S.rng, idioma, txt, azar,
      historia: (actores, ganador) => writeStory(S.rng, actores, ganador),
    };

    /* -------------------------------------------------------------- el plan */
    let plan: Plan<P>;
    try {
      plan = def.plan(ctx);
    } catch {
      S.cleanup();
      return;
    }
    if (plan.marcas) for (const [clave, valor] of Object.entries(plan.marcas)) S.mark(clave, valor);
    S.mark("arco", plan.arco);
    const conFoco = def.foco !== false;
    const F = conFoco ? tiemposFoco(plan.arco) : { golpe: 0, placa: 0 };
    anf.duracion(plan.duracion, anf.espera + F.placa);

    /* ----------------------------------------------------------- las figuras */
    // La hoja de emblemas viaja aparte: se espera un momento y, si no llegó, todos con su cara.
    if (def.figuras === "emblemas") await Promise.race([anf.emblemas.cargar().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 1500))]);
    const figuras = figurasDe(nombres, baliza.randomness, def.figuras ?? "caras", anf.emblemas.lista());
    const propias: Texture[] = [];
    const memoFigura = new Map<number, Texture>();
    S.onCleanup(() => {
      for (const tx of propias) tx.destroy(true);
      propias.length = 0;
    });
    const figura = (i: number): Texture => {
      let tx = memoFigura.get(i);
      if (!tx) {
        const f = figuras[i];
        if (f?.tipo === "emblema") {
          tx = anf.emblemas.textura(anf.emblemas.lienzo(f.emblema, 128));
          propias.push(tx);
        } else tx = S.face(nombres[i] ?? "");
        memoFigura.set(i, tx);
      }
      return tx;
    };

    /* ---------------------------------------------------------------- el kit */
    let t = 0;
    let tHold = 0;
    let coronado = false;
    let muerto = false;
    let escena: E | undefined;
    // `?auditar=nino`: la verdad del plan en cada instante, para la prueba del niño (`audit-nino`).
    // `duracion` es la hora del golpe (el 100 %): `audit-nino` para al 25 % y al 60 % de ella.
    if (anf.auditar() === "nino") (window as unknown as { __nino: unknown }).__nino = { sinLetras: false, duracion: plan.duracion + F.golpe / anf.ritmo(), t: () => t, verdad: () => plan.respuestas(t) };
    const sonido = crearSonido(anf.voz);
    const k: Kit = {
      S, cam: S.cam, nombres, ganadores, ronda: baliza.randomness, idioma,
      get t() { return t; },
      get coronado() { return coronado; },
      get escena() { return escena; },
      txt, azar, sonido, figuras, figura,
      calor: (c) => anf.calor(c),
      // La cara de un chip mide 16 px de diseño por la escala del estadio: la escala que la deja en el tamaño de una figura.
      escalaDeFigura: () => tamanoMinimoFigura(S.u(), S.compartir) / (16 * CHIP_SCALE * S.u() * (S.compartir ? 1.2 : 1)),
      letra: (rol) => tamanoLetra(rol, S.u(), S.compartir),
      pantalla: () => ({ w: S.sw(), h: S.sh(), k: S.u(), top: S.top(), bottom: S.sh() - S.bottom(), retrato: S.portrait() }),
    };
    const pantalla = (): Pantalla => {
      const p = k.pantalla();
      return { w: p.w, h: p.h, k: p.k, zona: { x0: 0, y0: p.top, x1: p.w, y1: p.bottom }, placaBajo: S.placaBajo(ganadores.length) };
    };

    const guion = crearGuion<Kit>(plan.guion);
    const ejecutor: EjecutorGuion<Kit> = {
      decir: (texto, calor, grito) => S.say(texto, calor, grito),
      hacer: (fn) => fn(k),
    };
    const director = crearDirector(plan, { cam: S.cam, kit: k, pantalla, marcar: (clave, valor) => S.mark(clave, valor), ritmo: () => anf.ritmo() });

    /* --------------------------------------------------------------- la escena */
    // El único contador, arriba a la izquierda: lo dibuja el kit, así ningún juego tiene otro.
    const marcadorUI = crearMarcadorVista(S, () => txt("marcadorQuedan"));
    escena = def.arma(k, plan);
    S.onResize(() => {
      escena = def.arma(k, plan, escena);
      marcadorUI.rearmar();
    });
    const crownUI = S.crown(nombres, ganadores, conFoco);
    const enfoque = (): Enfoque => ({ arco: plan.arco, ...plan.momentos.foco(k) });

    /** El golpe: el anuncio, la fanfarria y el acercamiento. Cae a la hora del foco, nunca antes. */
    const corona = (): void => {
      if (coronado) return;
      coronado = true;
      S.say(anf.anuncio(nombres, ganadores), 1);
      sonido.fanfarria();
      director.golpe();
    };
    // Saltar es ir al golpe: el silencio del foco no se espera, y lo que quedaba por decir se tira.
    saltarFn = (): void => {
      if (coronado || muerto) return;
      guion.saltar();
      t = plan.duracion + F.golpe / anf.ritmo();
      tHold = Math.max(tHold, F.golpe);
      corona();
    };

    /* ---------------------------------------------------------------- el bucle */
    S.run((dt, ahora) => {
      t += dt;
      // El respiro: la música se corta antes del golpe y vuelve con el remate.
      S.breath(t, plan.respiro ?? plan.duracion);
      guion.avanzar(t, ejecutor);
      if (t >= plan.duracion) {
        tHold += dt * anf.ritmo();
        if (tHold >= F.golpe) corona();
      }
      director.cuadro(t);
      S.cam.update(dt);
      S.cam.apply(S.scene, S.sw(), S.sh(), ahora);
      def.cuadro(k, plan, escena as E, t);
      marcadorUI.pintar(coronado ? 1 : Math.max(1, Math.round(plan.marcador(t))));
      if (t >= plan.duracion) crownUI.at(t - plan.duracion, true, conFoco ? enfoque() : null);
      if (tHold >= anf.espera + F.placa) {
        muerto = true;
        S.cleanup();
      }
    });
  };
}
