import { Container, Graphics } from "pixi.js";
import { INK, crearJuego } from "./kit";
import { lugares, plan__CAP__, tandaDe, type Datos } from "./__ID__-plan";
import { TEXTOS } from "./__ID__-textos";

/**
 * __NOMBRE__: la escena.
 *
 * Todo lo que no es dibujo lo hace el kit (`./kit`): el montaje, la cámara con
 * sus cinco arcos, el foco de quien gana, los subtítulos con cola, el sonido, el
 * contador (el único, arriba a la izquierda) y el cierre. Acá solo se dibuja la
 * mesa y los nombres como función del segundo `t`: la misma ronda dibuja lo
 * mismo cuadro por cuadro, y saltar el show a cualquier momento da lo mismo que
 * llegar mirando.
 *
 * Cada persona es una figura con cara y nombre, pegado al cuerpo: el chip del
 * estadio (`k.S.chip`) ya mide lo que pide la regla de letra (`kit/nombres.ts`)
 * y el estadio lo mete entero en la pantalla. Ningún número va en la escena: los
 * números van en el marcador.
 */
interface Escena {
  fondo: Graphics;
  capa: Container;
  /** Un chip por persona, creados cuando se ven por primera vez. */
  chips: Map<number, Container>;
}

export const __ID__Pixi = crearJuego<Datos, Escena>({
  id: "__ID__",
  textos: TEXTOS,
  plan: plan__CAP__,

  arma(k, _plan, previa) {
    const { S } = k;
    const p = k.pantalla();
    const fondo = previa?.fondo ?? new Graphics();
    const capa = previa?.capa ?? new Container();
    if (!previa) {
      S.bg.addChild(fondo);
      S.scene.addChild(capa);
    }
    fondo.clear().rect(0, 0, p.w, p.h).fill(S.dark ? 0x1b2340 : 0xdfe9f7);
    // Al cambiar de tamaño se tira lo viejo y los chips se piden de nuevo.
    capa.removeChildren().forEach((c) => c.destroy({ children: true }));
    const cy = (p.top + p.bottom) / 2;
    const mesa = new Graphics()
      .ellipse(p.w / 2, cy, p.w * 0.46, (p.bottom - p.top) * 0.46)
      .fill(S.dark ? 0x26305a : 0xc9d8f0)
      .stroke({ width: 4 * p.k, color: INK });
    capa.addChild(mesa);
    // La cámara parte del medio de la franja libre, sin viajar.
    k.cam.cut(p.w / 2, cy, 1);
    return { fondo, capa, chips: new Map() };
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const { S } = k;
    const p = k.pantalla();
    const enMesaFinal = t >= d.tFinal;
    const tanda = enMesaFinal ? [] : tandaDe(d.n, t, d.tTandas[0], d.tTandas[1]);
    const verlos = k.coronado ? [d.ganador] : enMesaFinal ? d.finalistas : tanda;
    const sitios = enMesaFinal || k.coronado ? lugares(p, d.finalistas.length) : lugares(p, tanda.length);

    for (const c of e.chips.values()) c.visible = false;
    verlos.forEach((i, j) => {
      let c = e.chips.get(i);
      if (!c) {
        // Una figura con cara y nombre: el chip, a la escala que la deja del tamaño mínimo de una figura.
        c = S.chip(k.nombres[i] ?? "", k.escalaDeFigura());
        e.chips.set(i, c);
        e.capa.addChild(c);
      }
      // Quien gana crece cuando cae el golpe.
      c.scale.set(k.coronado ? 1.5 : 1);
      const q = (k.coronado ? sitios[d.finalistas.indexOf(i)] : sitios[j]) ?? { x: p.w / 2, y: (p.top + p.bottom) / 2 };
      c.position.set(q.x - c.width / 2, q.y);
      c.visible = true;
    });
  },
});
