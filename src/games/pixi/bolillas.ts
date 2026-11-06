import { Container, Graphics } from "pixi.js";
import { isMuted } from "../../sound";
import { enchufar3D, entradaBase } from "../tres/enchufe";
import type { EntradaBolillas } from "../tres/bolillas-3d";
import type { Montaje3D, Vista3D } from "../tres/tipos";
import { INK, crearJuego, type DefJuego, type Lanzador } from "./kit";
import { anfitrionTinkazo, type Anfitrion } from "./kit/anfitrion";
import { mountPixi } from "./stage";
import {
  CANICA_R,
  CIRCULO_R,
  aMundo,
  mapeoDe,
  planBolillas,
  trayectoriaDe,
  unitarioDe,
  type Datos,
  type Mapeo,
} from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";
import {
  COLA_GOLPE,
  SEMILLA_FIJA,
  T_DESVIO,
  TIRADOR,
  coloresCanica,
  efectosDe,
  escalaChipDe,
  manoDe,
  polvoDe,
  tierraManchas,
  titilazo,
  tizaCirculo,
  type ArteCanica,
} from "./bolillas-arte";
import { eventosDe } from "./bolillas-sonido";

/**
 * Bolillas: la escena.
 *
 * La tierra sembrada de manchas, el círculo de tiza dibujado a mano alzada (el
 * trazo que decide, con su eco de doble línea) y la marca de tiza afuera, donde
 * se para la pegadora según el plan. Las canicas son de vidrio: cada asiento
 * lleva su color con la llama remolinando adentro, el brillo arriba y su sombra
 * blanda en la tierra, con el chip de la casa (la cara y el nombre) al lado para
 * la revelación. La pegadora tira con el agarre ñati —el interior del índice y
 * el exterior del pulgar—: la mano entra, agarra con la pinza cerrada y suelta
 * con el flick exactamente en la largada del plan.
 *
 * Los choques se ven y se escuchan: en el impacto la golpeada sale despedida
 * por donde el plan dijo (con el polvo y el scuff en la tierra, la palpitación
 * del golpe y el destello) mientras el tiro retrocede y se desvía; el clic de
 * cristal y su eco, y el golpe seco de la caída, salen por la voz del kit.
 * Al cierre, la canica que gana rueda hasta la orilla y titila en la tiza —
 * empujones cada vez más chicos que mueren en cero exacto— y se queda: ese es
 * el grito de la sala. Nada decide por su cuenta: la misma ronda dibuja lo
 * mismo cuadro por cuadro, y saltar el show a cualquier segundo da lo mismo
 * que llegar mirando.
 *
 * Todo lo demás (el montaje, la cámara, el foco, los subtítulos, el contador y
 * el cierre) lo hace el kit (`./kit`). El arte determinista vive en
 * `bolillas-arte.ts` y el sonido cosmético en `bolillas-sonido.ts`.
 */
interface Escena {
  fondo: Graphics;
  mundo: Container;
  /** Las sombras de las canicas en la tierra, debajo de todas. */
  sombra: Graphics;
  /** El polvo, el scuff y el destello de los choques, encima de todo. */
  fx: Graphics;
  /** La mano de la pegadora, encima de todo. */
  mano: Graphics;
  /** Un chip por canica (la figura con cara y nombre), creado cuando se ve por primera vez. */
  chips: Map<number, Container>;
  /** La escala de esos chips: la etiqueta más chica que se lee, en proporción al círculo (`escalaChipDe`). */
  escala: number;
  /** Los dibujos de las canicas, por su asiento (y la canica de la pegadora en el -1). */
  bol: Map<number, Graphics>;
  m: Mapeo;
  /** La vista 3D enchufada (solo con `?motor=3d`) y su entrada, que esta escena llena cuadro a cuadro. */
  v3: Vista3D<EntradaBolillas> | null;
  entrada3: EntradaBolillas | null;
}

/** La entrada vacía del 3D, armada acá: importa el tipo, no el módulo de three.js. */
function entrada3Vacia(): EntradaBolillas {
  return {
    t: 0, w: 0, h: 0, u: 1,
    cam: { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
    plan: null,
    mapeo: { cx: 0, cy: 0, e: 100 },
  };
}

/** Cuánto dura la marca del scuff de un impacto en la tierra. */
const SCUFF = 1.6;

const definicion = (tres?: Montaje3D<EntradaBolillas>): DefJuego<Datos, Escena> => ({
  id: "bolillas",
  textos: TEXTOS,
  plan: planBolillas,

  arma(k, plan, previa) {
    const { S } = k;
    const p = k.pantalla();
    const fondo = previa?.fondo ?? new Graphics();
    const mundo = previa?.mundo ?? new Container();
    if (!previa) {
      S.bg.addChild(fondo);
      S.scene.addChild(mundo);
    }
    fondo.clear().rect(0, 0, p.w, p.h).fill(S.dark ? 0x3a2a1c : 0xd8b98c);
    // Al cambiar de tamaño se tira lo viejo: el círculo y las canicas se piden de nuevo.
    mundo.removeChildren().forEach((c) => c.destroy({ children: true }));
    const m: Mapeo = mapeoDe(p);
    // La escala de las fichas del nombre: la etiqueta más chica que se lee, en proporción al círculo y
    // a la cantidad de gente (S11); antes salían al tamaño de la figura del kit y tapaban el círculo entero.
    const escala = escalaChipDe(p.k, m.e, plan.datos.n);
    // La tierra sembrada: manchas de tono, siempre las mismas (la semilla del show).
    const tierraOscura = S.dark ? 0x2c2013 : 0xc2a273;
    const tierraClara = S.dark ? 0x49361f : 0xe3c69b;
    for (const mancha of tierraManchas(SEMILLA_FIJA)) {
      fondo
        .circle(m.cx + mancha.x * m.e, m.cy + mancha.y * m.e, Math.max(1, mancha.r * m.e))
        .fill({ color: mancha.oscuro ? tierraOscura : tierraClara, alpha: mancha.a });
    }
    // El suelo pisado: adentro de la tiza la tierra queda más lisa (y más clara).
    fondo.circle(m.cx, m.cy, CIRCULO_R * m.e * 0.995).fill({ color: S.dark ? 0x4a3624 : 0xc9a877, alpha: 0.35 });
    // La tiza dibujada a mano alzada: un trazo con sus ondas, y el eco de la doble línea.
    const tiza = tizaCirculo(SEMILLA_FIJA);
    for (const eco of [1, 1.014]) {
      tiza.forEach((q, j) => {
        const w = aMundo(m, { x: q.x * eco, y: q.y * eco });
        if (j === 0) fondo.moveTo(w.x, w.y);
        else fondo.lineTo(w.x, w.y);
      });
      fondo.stroke({
        width: Math.max(2, (eco === 1 ? 5 : 2.4) * p.k),
        color: 0xf6f2e8,
        alpha: S.dark ? (eco === 1 ? 0.85 : 0.35) : eco === 1 ? 0.95 : 0.4,
      });
    }
    // Las marcas de la pegadora: los lugares donde se para a tirar, del plan (sin azar propio).
    const vistas = new Set<string>();
    for (const tiro of plan.datos.tiros) {
      const clave = `${Math.round(tiro.desde.x * 512)},${Math.round(tiro.desde.y * 512)}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      const w = aMundo(m, tiro.desde);
      fondo.circle(w.x, w.y, 3.6 * p.k).stroke({ width: Math.max(1, 1.6 * p.k), color: 0xf6f2e8, alpha: 0.55 });
      fondo.moveTo(w.x - 2.6 * p.k, w.y).lineTo(w.x + 2.6 * p.k, w.y).stroke({ width: Math.max(1, 1.4 * p.k), color: 0xf6f2e8, alpha: 0.45 });
    }
    const sombra = new Graphics();
    const fx = new Graphics();
    const mano = new Graphics();
    mundo.addChild(sombra, fx, mano);
    k.cam.cut(m.cx, m.cy, 1);
    // El 3D (si está prendido y arrancó): el fondo y la tierra del 2D se apagan — las canicas las dibuja
    // three.js y los nombres siguen siendo chips de PixiJS proyectados sobre el mismo círculo.
    const v3 = previa ? previa.v3 : enchufar3D(S, tres);
    v3?.reconstruir?.();
    if (v3) {
      fondo.visible = false;
      S.bg.visible = false;
    }
    const entrada3 = v3 ? previa?.entrada3 ?? entrada3Vacia() : null;
    return { fondo, mundo, sombra, fx, mano, chips: new Map(), bol: new Map(), m, escala, v3, entrada3 };
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const S = k.S;
    const en3d = e.v3 != null;
    const golpe = efectosDe(d, t);
    const mano = manoDe(d, t);
    const uTitila = (t - d.casi.t) / Math.max(0.001, d.duracion - d.casi.t);

    // Las sombras, abajo de todo: alguna canica nueva se agrega encima y las tapa bien.
    if (!en3d) e.sombra.clear();

    // Las canicas de los que juegan: adentro en su lugar, la golpeada volando hasta la tiza, la ganadora titilando.
    // Con el 3D enchufado las dibuja three.js; acá quedan los chips con cara y nombre, sobre la misma proyección.
    d.canicas.forEach((persona, slot) => {
      const tray = trayectoriaDe(d, slot, t);
      const seVe = tray.estado !== "afuera" || t < d.duracion + 2;
      const rr = 0.5 * e.m.e * CANICA_R;
      const w = aMundo(e.m, tray.p);
      if (!en3d) {
        let g = e.bol.get(slot);
        if (!g) {
          g = canica(0.5 * e.m.e * CANICA_R, coloresCanica(slot));
          e.bol.set(slot, g);
          e.mundo.addChild(g);
        }
        // El titileo: la canica que gana quiero cruzar y no cruza; empujones cada vez más chicos que mueren en cero.
        const tilta = tray.estado === "titila" ? titilazo(uTitila) : tray.estado === "afuera" ? 0.35 : 0;
        g.rotation = tilta;
        // La palpitación del golpe: solo a la canica que acaba de salir golpeada.
        g.scale.set(golpe && golpe.tiro.slot === slot ? 1 + 0.22 * golpe.squash : 1);
        g.position.set(w.x, w.y - rr * 1.08);
        g.visible = seVe;
        if (g.visible) g.alpha = tray.estado === "afuera" ? 0.35 : 1;
        // La sombra blanda en la tierra.
        if (g.visible) {
          e.sombra
            .ellipse(w.x + rr * 0.15, w.y + rr * 0.45, rr * 0.95, rr * 0.5)
            .fill({ color: 0x000000, alpha: tray.estado === "afuera" ? 0.08 : 0.2 });
        }
      }

      let chip = e.chips.get(persona);
      if (!chip) {
        chip = k.S.chip(k.nombres[persona] ?? "", e.escala);
        e.chips.set(persona, chip);
        e.mundo.addChild(chip);
      }
      // La coronación: el cartel del kit dice el nombre del ganador, y la ficha se retira — el nombre
      // aparece una sola vez (S12), no el cartel y la ficha superpuestos.
      chip.visible = seVe && tray.estado !== "afuera" && !(k.coronado && persona === d.ganador);
      chip.scale.set(1);
      chip.position.set(w.x - chip.width / 2, w.y - rr * 1.08 - chip.height * 0.85);
    });
    for (const [persona, chip] of e.chips) {
      if (!d.canicas.includes(persona)) chip.visible = false;
    }

    // La canica de la pegadora: vuela del punto de largada al impacto y después se desvía hasta su freno.
    // Con el 3D enchufado la dibuja three.js.
    if (!en3d) {
      let tiroVivo: (typeof d.tiros)[number] | undefined;
      for (const tiro of d.tiros) {
        if (t >= tiro.t - TIRADOR && t <= tiro.t + T_DESVIO) {
          tiroVivo = tiro;
          break;
        }
      }
      const tirador = e.bol.get(-1) ?? canica(0.42 * e.m.e * CANICA_R, coloresCanica(-1));
      if (!e.bol.has(-1)) {
        e.bol.set(-1, tirador);
        e.mundo.addChild(tirador);
      }
      if (tiroVivo) {
        const f = t > tiroVivo.t ? Math.min(1, (t - tiroVivo.t) / T_DESVIO) : Math.max(0, (t - (tiroVivo.t - TIRADOR)) / TIRADOR);
        const despues = t > tiroVivo.t;
        const de = despues ? tiroVivo.impacto : tiroVivo.desde;
        const hasta = despues ? tiroVivo.deflexion.hasta : tiroVivo.impacto;
        const dir = unitarioDe({ x: hasta.x - de.x, y: hasta.y - de.y });
        const rr = 0.42 * e.m.e * CANICA_R;
        const w = aMundo(e.m, {
          x: de.x + dir.x * f * Math.hypot(hasta.x - de.x, hasta.y - de.y),
          y: de.y + dir.y * f * Math.hypot(hasta.x - de.x, hasta.y - de.y),
        });
        // El retroceso del golpe: el tiro se corre para atrás del impacto, y el empujón muere con la cola.
        if (golpe && golpe.tiro === tiroVivo) {
          w.x += golpe.retro.x * e.m.e;
          w.y += golpe.retro.y * e.m.e;
        }
        tirador.position.set(w.x, w.y - rr * 1.08);
        tirador.rotation = 0;
        tirador.scale.set(1);
        tirador.visible = true;
        e.sombra
          .ellipse(w.x + rr * 0.15, w.y + rr * 0.45, rr * 0.9, rr * 0.5)
          .fill({ color: 0x000000, alpha: 0.2 });
      } else {
        tirador.visible = false;
      }
    }

    // El polvo, el scuff y el destello de los choques, encima de todo: cada uno con el reloj del plan.
    // Con el 3D enchufado los dibuja three.js.
    if (!en3d) {
      e.fx.clear();
      e.mundo.addChild(e.fx);
      d.tiros.forEach((tiro, i) => {
        const edad = t - tiro.t;
        if (edad < 0 || edad >= SCUFF) return;
        const w = aMundo(e.m, tiro.impacto);
        // El scuff: la marca oscura donde rozó la tierra, que se desvanece.
        e.fx
          .ellipse(w.x, w.y + 1.5 * e.m.e * CANICA_R, CANICA_R * e.m.e * 1.05, CANICA_R * e.m.e * 0.5)
          .fill({ color: S.dark ? 0x241a10 : 0xa98a5c, alpha: 0.22 * (1 - edad / SCUFF) });
        // El destello del impacto: sube de golpe y se muere con la palpitación.
        if (edad < COLA_GOLPE) {
          const flash = 1 - edad / COLA_GOLPE;
          e.fx
            .circle(w.x, w.y, CANICA_R * e.m.e * (1.2 + 0.9 * flash))
            .fill({ color: 0xfff6dd, alpha: 0.5 * flash });
        }
        // La nube de polvo, corrida para donde viaja la canica golpeada.
        if (edad < 0.6) {
          for (const grano of polvoDe(i, tiro.impacto, tiro.salida.dir)) {
            if (edad >= grano.vida) continue;
            const uv = edad / grano.vida;
            e.fx
              .circle(
                w.x + grano.dx * edad * e.m.e,
                w.y + grano.dy * edad * e.m.e,
                grano.r * e.m.e * (1 + uv * 2.2),
              )
              .fill({ color: S.dark ? 0x6b5230 : 0xd9c9a8, alpha: (1 - uv) * 0.55 });
          }
        }
      });
    }

    // La pegadora de ñati: entra, agarra por atrás con la pinza cerrada, suelta con el flick y se retira.
    // Con el 3D enchufado la dibuja three.js.
    if (!en3d) {
      e.mano.clear();
      e.mundo.addChild(e.mano);
      if (mano) {
        e.mano.alpha = mano.velo;
        const w = aMundo(e.m, mano.en);
        const rr = 0.42 * e.m.e * CANICA_R;
        const rh = 3.4 * rr; // la mano mide contra la canica que agarra
        // El brazo entra por el radial, desde afuera del círculo.
        const px = w.x + mano.radial.x * rh * 1.25;
        const py = w.y + mano.radial.y * rh * 1.25;
        const ax = w.x + mano.radial.x * rh * 6.5;
        const ay = w.y + mano.radial.y * rh * 6.5;
        e.mano.moveTo(ax, ay).lineTo(px, py).stroke({ width: rh * 0.7, color: INK, cap: "round" });
        e.mano.moveTo(ax, ay).lineTo(px, py).stroke({ width: rh * 0.52, color: S.color(2), cap: "round" });
        // La palma, detrás de la canica: el ñati agarra por atrás.
        e.mano.circle(px, py, rh * 0.62).fill(0xc68a5c).stroke({ width: Math.max(1, rh * 0.08), color: INK });
        // Índice y pulgar: casi juntos con la pinza cerrada, abiertos de golpe con el flick.
        const aparte = 0.32 + 0.85 * mano.pinza;
        const hacia = Math.atan2(-mano.radial.y, -mano.radial.x);
        for (const lado of [-1, 1]) {
          const a = hacia + lado * aparte;
          const tx = px + Math.cos(a) * rh * 1.05;
          const ty = py + Math.sin(a) * rh * 1.05;
          e.mano.moveTo(px, py).lineTo(tx, ty).stroke({ width: rh * 0.24, color: INK, cap: "round" });
          e.mano.moveTo(px, py).lineTo(tx, ty).stroke({ width: rh * 0.17, color: 0xc68a5c, cap: "round" });
        }
      } else {
        e.mano.alpha = 0;
      }
    }

    // El sonido de los choques, cosmético: por la voz del kit (muda con el estadio en silencio), una sola vez por evento.
    // Corre también con el 3D enchufado: es la única voz de sonido del juego.
    for (const ev of eventosDe(d, t, !isMuted())) {
      k.sonido.una(ev.clave, () => {
        const tocar = (): void => k.sonido.tono(ev.grado, ev.cat, { dur: ev.dur, timbre: ev.timbre, vol: ev.vol });
        if (ev.retrasoMs) k.sonido.despues(ev.retrasoMs, tocar);
        else tocar();
      });
    }

    // La entrada del 3D: el plan y el mapeo de este cuadro, sin crear objetos nuevos.
    if (e.v3 && e.entrada3) {
      const en = e.entrada3;
      Object.assign(en, entradaBase(S, t));
      en.plan = d;
      en.mapeo = e.m;
      e.v3.frame(en);
    }
  },
});

export const bolillasPixi = crearJuego<Datos, Escena>(definicion());

/** El mismo juego con el 3D debajo: lo lanza `src/games/tres/bolillas-3d.ts` (con `?motor=3d`; Bolillas nace apagada). */
const anfitrion3D: Anfitrion = { ...anfitrionTinkazo, montar: (baliza, listo, alSaltar, o) => mountPixi(baliza, listo, alSaltar, { music: o.musica, transparente: true }) };
export const bolillasPixi3D = (tres: Montaje3D<EntradaBolillas>): Lanzador => crearJuego<Datos, Escena>(definicion(tres), anfitrion3D);

/** Una canica de vidrio, en píxeles de mundo: el cuerpo translúcido, la llama adentro y el brillo arriba. */
function canica(r: number, arte: ArteCanica): Graphics {
  const g = new Graphics();
  // El vidrio: cuerpo y borde que refracta (un anillo más oscuro por dentro).
  g.circle(0, r, r).fill(arte.base);
  g.circle(0, r, r * 0.78).stroke({ width: Math.max(1, r * 0.2), color: arte.oscuro, alpha: 0.35 });
  // La llama remolinando adentro: dos vueltas del color del fuego.
  g.arc(0, r, r * 0.56, 0.4, 2.6).stroke({ width: Math.max(1, r * 0.3), color: arte.llama, alpha: 0.7, cap: "round" });
  g.arc(0, r, r * 0.3, 2.9, 5.2).stroke({ width: Math.max(1, r * 0.24), color: arte.llama2, alpha: 0.6, cap: "round" });
  // El brillo del vidrio, arriba a la izquierda.
  g.circle(-r * 0.3, r - r * 0.35, r * 0.28).fill({ color: 0xffffff, alpha: 0.5 });
  // El contorno de la casa.
  g.circle(0, r, r).stroke({ width: Math.max(1, r * 0.3), color: INK });
  return g;
}
