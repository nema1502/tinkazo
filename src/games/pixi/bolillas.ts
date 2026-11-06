import { Container, Graphics } from "pixi.js";
import { INK, crearJuego } from "./kit";
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

/**
 * Bolillas: la escena.
 *
 * La tierra, el círculo de tiza y las canicas que el plan sembró (`bolillas-plan.ts`), que trae
 * también la geometría de cada tiro: la canica de la pegadora vuela del punto de largada al impacto,
 * la golpeada sale cruzando la tiza por donde el plan dijo, y el tiro se desvía hasta donde él dijo.
 * Al cierre, la canica que gana rueda hasta la orilla y titila en la tiza. Nada decide por su cuenta:
 * la misma ronda dibuja lo mismo cuadro por cuadro, y saltar el show a cualquier segundo da lo mismo
 * que llegar mirando.
 *
 * Todo lo demás (el montaje, la cámara, el foco, los subtítulos, el contador y el cierre) lo hace el
 * kit (`./kit`). El polvo, el scuff de la tierra y el clic de canica contra canica se suman en la
 * escena del juego (T2); acá no hay ningún sonido que decida nada.
 */
interface Escena {
  fondo: Graphics;
  mundo: Container;
  /** Un chip por canica (la figura con cara y nombre), creado cuando se ve por primera vez. */
  chips: Map<number, Container>;
  /** Los dibujos de las canicas, por su asiento (y la canica de la pegadora en el -1). */
  bol: Map<number, Graphics>;
  m: Mapeo;
}

/** Lo que dura el vuelo de la canica de la pegadora antes del impacto (y su resbalón después). */
const TIRADOR = 0.55;
const T_DESVIO = 0.45;

export const bolillasPixi = crearJuego<Datos, Escena>({
  id: "bolillas",
  textos: TEXTOS,
  plan: planBolillas,

  arma(k, _plan, previa) {
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
    // La tiza: el círculo que decide, dibujado en el fondo para que ninguna toma lo pierda.
    fondo.circle(m.cx, m.cy, CIRCULO_R * m.e).stroke({ width: Math.max(2, 5 * p.k), color: 0xf6f2e8, alpha: S.dark ? 0.85 : 0.95 });
    fondo.circle(m.cx, m.cy, CIRCULO_R * m.e * 0.995).fill({ color: S.dark ? 0x4a3624 : 0xc9a877, alpha: 0.35 });
    k.cam.cut(m.cx, m.cy, 1);
    return { fondo, mundo, chips: new Map(), bol: new Map(), m };
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;

    // Las canicas de los que juegan: adentro en su lugar, la golpeada volando hasta la tiza, la ganadora titilando.
    d.canicas.forEach((persona, slot) => {
      const tray = trayectoriaDe(d, slot, t);
      let g = e.bol.get(slot);
      if (!g) {
        g = canica(0.5 * e.m.e * CANICA_R);
        e.bol.set(slot, g);
        e.mundo.addChild(g);
      }
      const w = aMundo(e.m, tray.p);
      // El titileo: la canica que gana quiero cruzar y no cruza; la escena la menea sobre la orilla.
      const tilta = tray.estado === "titila" && t < d.duracion ? Math.sin((t - d.casi.t) * 9) * 0.14 : tray.estado === "afuera" ? 0.35 : 0;
      g.position.set(w.x, w.y - g.height * 0.4);
      g.rotation = tilta;
      g.visible = tray.estado !== "afuera" || t < d.duracion + 2;
      if (g.visible) g.alpha = tray.estado === "afuera" ? 0.35 : 1;

      let chip = e.chips.get(persona);
      if (!chip) {
        chip = k.S.chip(k.nombres[persona] ?? "", k.escalaDeFigura());
        e.chips.set(persona, chip);
        e.mundo.addChild(chip);
      }
      chip.visible = g.visible && tray.estado !== "afuera";
      chip.position.set(w.x - chip.width / 2, w.y - g.height - chip.height * 0.85);
      if (k.coronado && persona === d.ganador) chip.scale.set(1.2);
    });
    for (const [persona, chip] of e.chips) {
      if (!d.canicas.includes(persona)) chip.visible = false;
    }

    // La canica de la pegadora: vuela del punto de largada al impacto y después se desvía hasta su freno.
    let tiroVivo: (typeof d.tiros)[number] | undefined;
    for (const tiro of d.tiros) {
      if (t >= tiro.t - TIRADOR && t <= tiro.t + T_DESVIO) {
        tiroVivo = tiro;
        break;
      }
    }
    const tirador = e.bol.get(-1) ?? canica(0.42 * e.m.e * CANICA_R);
    if (!e.bol.has(-1)) {
      e.bol.set(-1, tirador);
      e.mundo.addChild(tirador);
    }
    if (tiroVivo) {
      const f = t > tiroVivo.t ? Math.min(1, (t - tiroVivo.t) / T_DESVIO) : Math.max(0, (t - (tiroVivo.t - TIRADOR)) / TIRADOR);
      const despues = t > tiroVivo.t;
      const de = despues ? tiroVivo.impacto : tiroVivo.desde;
      const hasta = despues ? tiroVivo.deflexion.hasta : tiroVivo.impacto;
      const dir = unitarioDe(despues ? { x: hasta.x - de.x, y: hasta.y - de.y } : { x: hasta.x - de.x, y: hasta.y - de.y });
      const w = aMundo(e.m, { x: de.x + dir.x * f * Math.hypot(hasta.x - de.x, hasta.y - de.y), y: de.y + dir.y * f * Math.hypot(hasta.x - de.x, hasta.y - de.y) });
      tirador.position.set(w.x, w.y - tirador.height * 0.4);
      tirador.visible = true;
    } else {
      tirador.visible = false;
    }
  },
});

/** Una canica de vidrio, en píxeles de mundo: el cuerpo con el brillo arriba. */
function canica(r: number): Graphics {
  return new Graphics()
    .circle(0, r, r)
    .fill(0x8fd0c8)
    .stroke({ width: Math.max(1, r * 0.35), color: INK })
    .circle(-r * 0.3, r - r * 0.35, r * 0.28)
    .fill({ color: 0xffffff, alpha: 0.5 });
}
