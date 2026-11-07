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
  finalistasDe,
  fichasDe,
  mapeoDe,
  planBolillas,
  trayectoriaDe,
  type Datos,
  type Mapeo,
} from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";
import {
  AGUAYO,
  CANICA_ESCALA,
  CHISPA_VIDA,
  ESTALLO_ALFA_BORDE,
  ESTALLO_ALFA_CORAZON,
  ESTALLO_ALFA_LINEA,
  SCUFF_VIDA,
  SEMILLA_FIJA,
  anuncioDeDiana,
  canicaDeManoDe,
  cercaDe,
  chispasDe,
  coloresCanica,
  dibujarCanica,
  dibujoDe,
  escalaChipDe,
  flashDe,
  golpesDe,
  manoDe,
  persecucionDe,
  palpitoDe,
  polvoDe,
  punteadoDe,
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
 * Cada turno es la cadena de la troya (S23) y la escena la anima tal cual la
 * contó el plan: la mano de quien tira larga su canica de mano desde afuera y
 * pega en **mi** canica (el primer golpe, blando: polvo, vidrio y un destello
 * corto); mi canica rueda y empuja a la del enemigo (el segundo golpe, fuerte:
 * encima de las mismas chispas de vidrio de S13, el estallido de pelea de S22
 * —estrella, líneas de velocidad y micro-sacudón—), y la del enemigo sale
 * adelante hasta cruzar la tiza (S21). Los dos golpes se oyen, el blando más
 * bajo que el clic de cristal del fuerte, y el golpe seco de la caída, todo por
 * la voz del kit.
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
  /** El anuncio de la diana del próximo tiro (el anillo con rayas, S19). */
  anuncio: Graphics;
  /** Los dibujos de las canicas, por su asiento (y la canica de la mano en el -1). */
  bol: Map<number, Graphics>;
  /** Los estallidos que ya sacudieron la escena (S22): el sacudón se pide una sola vez por golpe. */
  sacudidas: Set<string>;
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

/**
 * `?trazos=<grupos>`: el interruptor de diagnóstico de la sala, sin interfaz y sin ningún efecto cuando el parámetro no
 * está. Existe porque hay dos artefactos que se ven en el teléfono y no en el navegador sin placa (los rayos de color y
 * los contornos blancos sobre dos canicas): con esto la sala apaga un grupo por vez y el reporte dice cuál lo hace.
 * Los grupos: `fondo` (la tierra, la tiza y las marcas de la pegadora), `canica` (el vidrio de las canicas), `mano` (la
 * mano de la ñati y su canica de mano), `sombra`, `anuncio` (el anillo de la diana y sus rayas), `linea` (la punteada
 * negra del anuncio, S28), `fx` (polvo, chispas, estallido y estelas del cierre), `chips` (las fichas con nombre) y
 * `todo` (apaga la escena entera). Se combinan con comas: `?trazos=canica,fx`. Diagnóstico: se saca cuando el artefacto
 * esté identificado.
 */
const TRAZOS = new Set(
  (typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("trazos") ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean),
);

/** Si el grupo se dibuja en este arranque: `?trazos=<grupo>` lo apaga, y nada más cambia. */
const traza = (grupo: string): boolean => !TRAZOS.has("todo") && !TRAZOS.has(grupo);

const definicion = (tres?: Montaje3D<EntradaBolillas>): DefJuego<Datos, Escena> => ({
  id: "bolillas",
  textos: TEXTOS,
  plan: planBolillas,
  // Sin el foco de la casa: la sala leyó el resplandor del cierre como «esa bola blanca que sale al final está feo».
  // El foco está dimensionado sobre un cuerpo de persona (el radio de `momentos.foco`, ~40 unidades) y acá quien gana es
  // un vidrio de 18 px: sus rayos y sus ondas se comen el escenario para señalar algo que ya se ve. Sin foco, el cartel
  // sale como salía antes de que existiera, con su propio destello (`DefJuego.foco`).
  foco: false,

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
      // La marca del pie, punteada (S19): los puntos de la casa, no una línea de una pieza.
      for (const [q, r] of punteadoDe({ x: w.x - 2.6 * p.k, y: w.y }, { x: w.x + 2.6 * p.k, y: w.y }, 2.2 * p.k)) {
        fondo.moveTo(q.x, q.y).lineTo(r.x, r.y).stroke({ width: Math.max(1, 1.4 * p.k), color: 0xf6f2e8, alpha: 0.45 });
      }
    }
    const sombra = new Graphics();
    const fx = new Graphics();
    const mano = new Graphics();
    const anuncio = new Graphics();
    mundo.addChild(sombra, anuncio, fx, mano);
    k.cam.cut(m.cx, m.cy, 1);
    // El 3D (si está prendido y arrancó): el fondo y la tierra del 2D se apagan — las canicas las dibuja
    // three.js y los nombres siguen siendo chips de PixiJS proyectados sobre el mismo círculo.
    const v3 = previa ? previa.v3 : enchufar3D(S, tres);
    v3?.reconstruir?.();
    if (v3) {
      fondo.visible = false;
      S.bg.visible = false;
    } else if (!traza("fondo")) fondo.visible = false;
    const entrada3 = v3 ? previa?.entrada3 ?? entrada3Vacia() : null;
    const sacudidas = previa?.sacudidas ?? new Set<string>();
    return { fondo, mundo, sombra, fx, mano, anuncio, chips: new Map(), bol: new Map(), sacudidas, m, escala, v3, entrada3 };
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const S = k.S;
    const en3d = e.v3 != null;
    // Los dos golpes de la cadena (S23) vivos en este cuadro: la mano sobre mi canica y la mía sobre la del enemigo.
    const golpes = golpesDe(d, t);
    const mano = manoDe(d, t);
    const uTitila = (t - d.casi.t) / Math.max(0.001, d.duracion - d.casi.t);
    // Los finalistas del segundo (S15) envueltos en la puerta de la intro (S18): las fichas se ven durante el
    // arranque (quiénes juegan), desaparecen toda la troya y vuelven solo para los últimos tres.
    const fichas = fichasDe(d, t);
    // El anuncio de la diana (S19): el anillo con rayas alrededor de la canica que le va a tocar a la
    // pegadora, con su pulso que muere antes del golpe. La cuenta es la del arte puro; acá solo se dibuja.
    const digo = en3d ? null : anuncioDeDiana(d, t);
    e.anuncio.clear();
    if (digo) {
      const wa = aMundo(e.m, digo.tiro.impacto);
      const rA = digo.anillo * e.m.e * (1 + 0.22 * digo.pulso);
      if (traza("anuncio")) {
        e.anuncio
          .circle(wa.x, wa.y, rA)
          .stroke({ width: Math.max(1.5, 0.2 * CANICA_R * e.m.e * CANICA_ESCALA), color: 0xf6f2e8, alpha: (0.4 + 0.55 * digo.pulso) * (S.dark ? 0.9 : 1) });
        for (const ray of digo.rayas) {
          const caja = Math.cos(ray.a);
          const saba = Math.sin(ray.a);
          e.anuncio
            .moveTo(wa.x + caja * ray.de * e.m.e, wa.y + saba * ray.de * e.m.e)
            .lineTo(wa.x + caja * ray.hasta * e.m.e, wa.y + saba * ray.hasta * e.m.e)
            .stroke({ width: Math.max(2, 0.3 * CANICA_R * e.m.e * CANICA_ESCALA), color: ray.color, alpha: 0.55 + 0.4 * digo.pulso, cap: "round" });
        }
      }
      // La línea punteada negra (S28): qué canica va a golpear la que sale. Guiones parejos del arte puro (siempre el
      // mismo largo y el mismo aire, apartados del vidrio de las dos canicas), con el mismo grosor y punta redonda.
      // Un halo claro debajo y el trazo negro encima: sobre la tierra oscura el negro solo no se lee (S30).
      if (traza("linea")) {
        for (const [de, hasta] of digo.linea) {
          const wd = aMundo(e.m, de);
          const wh = aMundo(e.m, hasta);
          e.anuncio
            .moveTo(wd.x, wd.y)
            .lineTo(wh.x, wh.y)
            .stroke({ width: Math.max(3, 0.34 * CANICA_R * e.m.e * CANICA_ESCALA), color: 0xf6f2e8, alpha: 0.26 + 0.26 * digo.pulso, cap: "round" });
          e.anuncio
            .moveTo(wd.x, wd.y)
            .lineTo(wh.x, wh.y)
            .stroke({ width: Math.max(2, 0.2 * CANICA_R * e.m.e * CANICA_ESCALA), color: 0x14100c, alpha: 0.72 + 0.28 * digo.pulso, cap: "round" });
        }
      }
    }

    // Las sombras, abajo de todo: alguna canica nueva se agrega encima y las tapa bien.
    if (!en3d) e.sombra.clear();
    // El interruptor de diagnóstico (`?trazos=`): apaga capas enteras sin tocar lo que se dibuja.
    e.sombra.visible = traza("sombra");
    e.fx.visible = traza("fx");
    e.mano.visible = traza("mano");
    e.anuncio.visible = traza("anuncio") || traza("linea");

    // Las canicas de los que juegan: adentro en su lugar, la golpeada volando hasta la tiza, la ganadora titilando.
    // Con el 3D enchufado las dibuja three.js; acá quedan los chips con cara y nombre, sobre la misma proyección.
    d.canicas.forEach((persona, slot) => {
      // El dibujo de la canica (S25): entera mientras juega —adentro de la tiza, con aire para su cuerpo doblado
      // (S20)—, apagándose apenas cruza, y nada después: ni cuerpo, ni sombra, ni ficha. La cuenta es la misma que
      // usa el 3D (`dibujoDe`).
      const tray = trayectoriaDe(d, slot, t);
      const dib = dibujoDe(d, slot, t);
      // La canica que ya salió del dibujo no se ve más: sin cuerpo tampoco hay ficha (S25).
      const seVe = dib != null;
      // El dibujo de la canica: su radio del plan, agrandado por el multiplicador de la casa (S17).
      const rr = 0.5 * e.m.e * CANICA_R * CANICA_ESCALA;
      const w = dib ? aMundo(e.m, dib.p) : null;
      if (!en3d) {
        let g = e.bol.get(slot);
        if (!g) {
          g = canica(0.5 * e.m.e * CANICA_R * CANICA_ESCALA, coloresCanica(slot), INK);
          e.bol.set(slot, g);
          e.mundo.addChild(g);
        }
        // El vidrio se dibuja centrado en sus propias coordenadas (`dibujarCanica`): el nodo va en el punto de la canica
        // y no hay ninguna altura que compensar.
        g.visible = dib != null && traza("canica");
        if (dib && w) {
          // El titileo: la canica que gana quiero cruzar y no cruza; empujones cada vez más chicos que mueren en cero.
          g.rotation = dib.estado === "titila" ? titilazo(uTitila) : 0;
          // La palpitación del golpe: la canica que acaba de recibir uno —la mía con la mano, la del enemigo con la mía.
          g.scale.set(1 + 0.22 * palpitoDe(d, slot, t));
          g.position.set(w.x, w.y);
          // El velo de la salida: la que cruza la tiza se apaga en un parpadeo y no se vuelve a ver (S25).
          g.alpha = dib.velo;
          // La sombra blanda en la tierra: se va con su canica (S25).
          if (traza("sombra")) {
            e.sombra
              .ellipse(w.x + rr * 0.15, w.y + rr * 0.45, rr * 0.95, rr * 0.5)
              .fill({ color: 0x000000, alpha: 0.2 * dib.velo });
          }
        }
      }

      let chip = e.chips.get(persona);
      if (!chip) {
        chip = k.S.chip(k.nombres[persona] ?? "", e.escala);
        e.chips.set(persona, chip);
        e.mundo.addChild(chip);
      }
      // La coronación: el cartel del kit dice el nombre del ganador, y la ficha se retira — el nombre
      // aparece una sola vez (S12), no el cartel y la ficha superpuestos. Y las fichas solo muestran a
      // los finalistas (S15): durante la troya, el círculo queda sin nombres. La eliminada no deja rastro: si ya
      // salió del dibujo (S25), `seVe` la apaga y su ficha tampoco se ve.
      chip.visible = fichas.includes(persona) && seVe && tray.estado !== "afuera" && !(k.coronado && persona === d.ganador);
      chip.scale.set(1);
      // El interruptor de diagnóstico (`?trazos=chips`): las fichas son un grupo aparte del resto.
      if (!traza("chips")) chip.visible = false;
      if (w) chip.position.set(w.x - chip.width / 2, w.y - rr - chip.height * 0.85);
    });
    for (const [persona, chip] of e.chips) {
      if (!d.canicas.includes(persona)) chip.visible = false;
    }
    // El velo del acercamiento (S14): con la cámara del 3D de cerca de la ganadora, los chips —que el 2D proyecta
    // con la cámara del director— quedan mirando otra toma: se desvanecen mientras dura y vuelven al volver.
    if (en3d) {
      const velo = 1 - cercaDe(d, t);
      // El ganador no se desvanece: en el plano del cierre la sala tiene que ver a quién está mirando (S14).
      for (const [persona, chip] of e.chips) chip.alpha = persona === d.ganador ? Math.max(velo, 0.92) : velo;
    }

    // La canica de la mano (S23): sale de la largada del plan, pega en mi canica a la hora `tMano` (el primer impacto
    // de la cadena) y después deriva hasta `mano.hasta` y se apaga. Su vuelo y su deriva son de `canicaDeManoDe`: la
    // escena no tiene reloj propio para la mano. Con el 3D enchufado la dibuja three.js.
    if (!en3d) {
      const rr = 0.42 * e.m.e * CANICA_R * CANICA_ESCALA;
      let tirador = e.bol.get(-1);
      if (!tirador) {
        tirador = canica(rr, coloresCanica(-1), INK);
        e.bol.set(-1, tirador);
        e.mundo.addChild(tirador);
      }
      const enMano = traza("mano") ? canicaDeManoDe(d, t) : null;
      if (enMano) {
        const w = aMundo(e.m, enMano.p);
        tirador.position.set(w.x, w.y);
        tirador.rotation = 0;
        tirador.scale.set(1);
        tirador.alpha = enMano.velo;
        tirador.visible = true;
        if (traza("sombra")) {
          e.sombra
            .ellipse(w.x + rr * 0.15, w.y + rr * 0.45, rr * 0.9, rr * 0.5)
            .fill({ color: 0x000000, alpha: 0.2 * enMano.velo });
        }
      } else {
        tirador.visible = false;
      }
    }

    // Los golpes de la cadena, encima de todo y con el reloj del plan: el de la mano en `choque` (polvo, vidrio y un
    // destello blando) y el de mi canica en `empuje.donde` (lo mismo, más el estallido de pelea de S22).
    // Con el 3D enchufado los dibuja three.js.
    if (!en3d) {
      e.fx.clear();
      e.mundo.addChild(e.fx);
      for (const golpe of golpes) {
        const edad = golpe.edad;
        const w = aMundo(e.m, golpe.punto);
        // El scuff: la marca oscura donde rozó la tierra, que se desvanece.
        e.fx
          .ellipse(w.x, w.y + 1.5 * e.m.e * CANICA_R, CANICA_R * e.m.e * 1.05, CANICA_R * e.m.e * 0.5)
          .fill({ color: S.dark ? 0x241a10 : 0xa98a5c, alpha: 0.22 * (1 - edad / SCUFF_VIDA) });
        // El destello del impacto (S22, afinado en S26): un círculo chico y suave pegado a la canica golpeada —el de la
        // mano, más blando todavía (`brillo`)—, no la nube blanca que tapaba la escena.
        if (golpe.flash > 0) {
          const fl = flashDe(golpe);
          e.fx.circle(w.x, w.y, fl.r * e.m.e).fill({ color: 0xfff6dd, alpha: fl.alfa });
        }
        // La nube de polvo, corrida para donde viaja la canica golpeada.
        if (edad < 0.6) {
          for (const grano of polvoDe(golpe.semilla, golpe.punto, golpe.dir)) {
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
        // Las chispas del vidrio (S13), punteadas (S19): rayitos que saltan más vivos y mueren antes que el polvo —
        // cada uno viaja con su rumbo del plan, en tramos de tiza (nada de líneas de una pieza).
        if (edad < CHISPA_VIDA) {
          for (const chispa of chispasDe(golpe.semilla, golpe.punto, golpe.dir)) {
            if (edad >= chispa.vida) continue;
            const uv = edad / chispa.vida;
            const hx = w.x + chispa.dx * edad * e.m.e;
            const hy = w.y + chispa.dy * edad * e.m.e;
            const tx = hx - chispa.dx * chispa.largo * e.m.e;
            const ty = hy - chispa.dy * chispa.largo * e.m.e;
            for (const [q, r] of punteadoDe({ x: tx, y: ty }, { x: hx, y: hy }, Math.max(1, chispa.largo * e.m.e * 0.3))) {
              e.fx.moveTo(q.x, q.y).lineTo(r.x, r.y).stroke({ width: Math.max(1.5, 0.3 * CANICA_R * e.m.e * CANICA_ESCALA), color: 0xfff2bd, alpha: (1 - uv) * 0.8, cap: "round" });
              e.fx.moveTo(q.x, q.y).lineTo(r.x, r.y).stroke({ width: Math.max(0.8, 0.15 * CANICA_R * e.m.e * CANICA_ESCALA), color: 0xffffff, alpha: 1 - uv, cap: "round" });
            }
          }
        }
        // El estallido de pelea (S22) del segundo golpe: la estrella del destello, las líneas de velocidad que radian
        // del impacto y el micro-sacudón de la escena. Todo de `golpesDe`; acá solo se dibuja.
        const est = golpe.estallo;
        if (est && edad < est.vida) {
          const uv = edad / est.vida;
          const crece = 0.55 + 0.45 * (1 - uv);
          const estrella = (f: number): number[] =>
            est.estrella.flatMap((q) => [w.x + q.x * e.m.e * crece * f, w.y + q.y * e.m.e * crece * f]);
          // Un borde de la paleta de la casa y el corazón blanco: el destello del golpe de manga, doble y suave (S26).
          e.fx.poly(estrella(1)).fill({ color: AGUAYO[1], alpha: ESTALLO_ALFA_BORDE * (1 - uv) });
          e.fx.poly(estrella(0.6)).fill({ color: 0xfffdf2, alpha: ESTALLO_ALFA_CORAZON * (1 - uv) });
          // Las líneas de velocidad: cada una corre hacia afuera del impacto y se apaga con su vida.
          for (const linea of est.lineas) {
            const v = Math.min(1, edad / linea.vida);
            const cab = linea.de + linea.largo * v;
            const cola = cab - linea.largo * 0.55;
            const ca = Math.cos(linea.a);
            const sa = Math.sin(linea.a);
            const x0 = w.x + ca * cola * e.m.e;
            const y0 = w.y + sa * cola * e.m.e;
            const x1 = w.x + ca * cab * e.m.e;
            const y1 = w.y + sa * cab * e.m.e;
            const grosor = Math.max(1, linea.ancho * e.m.e);
            e.fx.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: grosor, color: AGUAYO[1], alpha: ESTALLO_ALFA_LINEA * 0.7 * (1 - v), cap: "round" });
            e.fx.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: grosor * 0.45, color: 0xffffff, alpha: ESTALLO_ALFA_LINEA * (1 - v), cap: "round" });
          }
          // El micro-sacudón (S22): una vez por golpe, con la fuerza del arte puro (el kit lo tiembla y lo apaga solo).
          const clave = `sacudon:${golpe.i}`;
          if (!e.sacudidas.has(clave)) {
            e.sacudidas.add(clave);
            k.cam.shake(est.sacudida * e.m.e);
          }
        }
      }

      // La persecución de la ganadora (S24): en una escena plana no hay punto de vista, así que la escena le pone
      // la velocidad —rayitas que se estiran para atrás mientras su canica rueda hacia la rival—. La cámara la
      // acerca el plan (la toma de `momentos`); acá solo se dibuja lo que el arte puro ya decidió.
      const persigue = persecucionDe(d, t);
      if (persigue && persigue.peso > 0) {
        const w = aMundo(e.m, persigue.p);
        const lado = { x: -persigue.dir.y, y: persigue.dir.x };
        for (const estela of persigue.estelas) {
          const base = {
            x: w.x - persigue.dir.x * estela.atras * e.m.e + lado.x * estela.lado * e.m.e,
            y: w.y - persigue.dir.y * estela.atras * e.m.e + lado.y * estela.lado * e.m.e,
          };
          const cola = { x: base.x - persigue.dir.x * estela.largo * e.m.e, y: base.y - persigue.dir.y * estela.largo * e.m.e };
          const vivo = 0.5 * persigue.peso * Math.max(0, 1 - estela.atras / 0.6);
          e.fx.moveTo(base.x, base.y).lineTo(cola.x, cola.y).stroke({ width: Math.max(1, 1.6 * e.m.e), color: 0xfff6dd, alpha: vivo, cap: "round" });
        }
      }
    }

    // La pegadora de ñati: entra, agarra por atrás con la pinza cerrada, suelta con el flick y se retira.
    // Con el 3D enchufado la dibuja three.js.
    if (!en3d) {
      e.mano.clear();
      e.mundo.addChild(e.mano);
      if (mano) {
        e.mano.alpha = mano.velo;
        const w = aMundo(e.m, mano.en);
        const rr = 0.42 * e.m.e * CANICA_R * CANICA_ESCALA;
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

/**
 * Una canica de vidrio, en píxeles de mundo: el cuerpo translúcido, la llama adentro y el brillo arriba. El dibujo entero
 * está centrado en `(0, 0)` (`dibujarCanica`), así que la escena pone este nodo en el punto de la canica y nada más: no
 * hay ninguna altura que compensar, y ningún arco hereda el punto de la forma anterior (el bug de dibujo de S13).
 */
function canica(r: number, arte: ArteCanica, tinta: number): Graphics {
  const g = new Graphics();
  dibujarCanica(g, r, arte, tinta);
  return g;
}
