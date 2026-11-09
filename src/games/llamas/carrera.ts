import { Container, Graphics, Sprite, Text } from "pixi.js";
import { auditaCon, paceFactor, params } from "../../state";
import { colorDeNombre } from "../pixi/foco-vista";
import { crearJuego, minimoPx, nivelPorCantidad, planNombres, type Caja, type DefJuego, type FocoPunto, type Kit, type Nivel, type Zona } from "../pixi/kit";
import { anfitrionTinkazo } from "../pixi/kit/anfitrion";
import { CREAM, INK, YELLOW, contorno, hash, mountPixi } from "../pixi/stage";
import { camara3D, type Borla3D, type Corredora3D, type Efecto3D, type Fabrica3D, type Geometria3D, type Valla3D, type Vista3D, type ZonaSuelo } from "./carrera-3d-mapa";
import { LLEGADA_ANTES, cajaFinal2D, crearCamara3D, grupoFinal2D, zoomDeCaja, zoomFinal2D, type Camara3D, type Puesto } from "./carrera-camara";
import { unir } from "../pixi/encuadre";
import { tarjetaRetrato, type DisenoTarjeta } from "./carrera-tarjeta";
import { tiemposFoco } from "../pixi/foco";
import { ECHADA_DUR, FONDO_CARTEL, arribaDelCartel, carrilesDe, formaDe, hudDe, type Carriles, type Forma, type Pantalla } from "./carrera-forma";
import { LLEGADA_TARDE, crearCaminata, filaDeRango, ubicarTandas, type Caminata } from "./carrera-caminata";
import { CARRIL_DURA, CUERPO } from "./carrera-marcha";
import { ENSANCHE, SALTO_MEDIO } from "./carrera-obstaculos";
import { RECTA, alfabetico, planCarrera, type Datos, type EscenaCarrera } from "./carrera-show";
import { pisaA, metida, sitioLibre, RENGLONES_MAX, type CajaF } from "./carrera-fichas";
import { PASOS_POR_SEGUNDO, estadoNuevo, pasoDe, pasoFicha, type EstadoFicha } from "./carrera-fichas-mov";
import { crearLlamaAguayo } from "./llama-aguayo";
import { FICHA_ECHADA, luzDe } from "./carrera-luz";
import { TEXTOS_CARRERA } from "./carrera-textos";
import { MARCA_PORTON, type Tanda } from "./carrera-tandas";
import type { Terreno } from "./carrera-tiempos";
import { BORLA_RADIO, LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO, LLAMA_LARGO, PELAJES, crearBorla, crearLlama, crearManta, type Llama, type Momento } from "./llama";

/**
 * La carrera de llamas, sobre el kit (`pixi/kit`). El show es puro
 * (`carrera-show.ts`) y esta escena es una función de la hora del juego: el
 * kit lleva el reloj, la cámara con sus cinco arcos, el relator, el golpe y el
 * foco.
 *
 * Lo que se ve, sin leer (regla del niño, `docs/juegos.md`):
 *
 * - **Hacia dónde**: todo corre de izquierda a derecha, siempre. La cinta de
 *   arriba muestra el camino entero con sus terrenos, la bandera de la meta
 *   al final y, como cursor, la cara de quien va adelante.
 * - **Cuánto falta**: el cursor en la cinta, los postes que pasan, el suelo de
 *   cada terreno y, al final, el arco de la meta que se acerca.
 * - **Quién va adelante**: la de más a la derecha, con la borla amarilla (el
 *   único objeto que cambia de dueña) y la única ficha grande.
 * - **Qué pasó**: la que se echa se echa en el cuerpo (patas plegadas, gris,
 *   polvo) y se queda donde pasó, con su nombre.
 */

/** Dónde va la primera en la pantalla en la carrera nueva, en fracción del ancho (entre 0,62 y 0,82 según corre). */
const AIRE = 0.72;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const suave = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
/** Una subida suave de 0 a 1 (de quinto grado): continua en la velocidad y en la aceleración. */
const suave5 = (v: number): number => {
  const x = clamp01(v);
  return x * x * x * (x * (6 * x - 15) + 10);
};
const ease = (v: number): number => {
  const x = clamp01(v);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};

interface Etiqueta {
  raiz: Container;
  fondo: Graphics;
  texto: Text;
  /** El rótulo "ADELANTE" pegado a la izquierda de la ficha de quien va primera (celular): una palabra que contesta la pregunta sin mirar la raya. */
  rotulo: Container;
  rotuloTexto: Text;
  rotuloFondo: Graphics;
  /** Cuánto sobresale el rótulo a la izquierda de la ficha, en el espacio de la ficha (0 si no se muestra). */
  rotuloW: number;
  w: number;
  h: number;
  clave: string;
}

interface Corredora {
  persona: number;
  llama: Llama;
  raiz: Container;
  etiqueta: Etiqueta;
  fase: number;
  usada: boolean;
}

interface Posicion {
  x: number;
  y: number;
  esc: number;
  velocidad: number;
  momento: Momento;
  /** Las que esperan su tanda no se dibujan. */
  visible: boolean;
  /** Falso: todavía no tiene su nombre en la pista (el de las tandas está en el cartel). */
  etiquetar?: boolean;
  /** Cuánto se levanta del piso (el salto de la valla), en píxeles. */
  alza?: number;
}

function crearEscena(k: Kit, d: Datos, fabrica3d: Fabrica3D | null = null) {
  const S = k.S;
  const cam = k.cam;
  // La luz del tema (`carrera-luz.ts`): de día en el claro, el atardecer de siempre en el oscuro. Solo colores; el plan no la lee.
  const luz = luzDe(S.dark ? "oscuro" : "claro");
  const TERRENO_COLOR = luz.terreno;
  const TERRENO_ACENTO = luz.acento;
  // Los nombres se leen siempre: nada de desenfoque en los acercamientos (con 8 la escena quedaba borrosa un segundo).
  cam.noBlur();
  const names = d.names;
  const formasN = planNombres(names).formas;
  const pant = (): Pantalla => {
    const p = k.pantalla();
    return { w: p.w, h: p.h, u: p.k, retrato: p.retrato, top: p.top, bottom: p.bottom };
  };
  let P = pant();

  /* ----------------------------------------------------------------- capas */
  const cielo = new Container();
  const cieloFijo = new Graphics();
  const montes: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
  cielo.addChild(cieloFijo, ...montes);
  S.bg.addChild(cielo);
  const mundo = new Container();
  const suelo = new Graphics();
  const marcas = new Container();
  const porton = new Graphics();
  // La raya del frente (carrera nueva): una línea de luz en el hocico de la primera, debajo de las llamas.
  const raya = new Graphics();
  // Las estelas (carrera nueva): rayitas de velocidad detrás de cada llama que corre, para que se lea hacia dónde van sin leer.
  const estelas = new Graphics();
  // Los obstáculos de la recta (`carrera-obstaculos.ts`): piedras que caen y viento, debajo de las llamas. La valla es fija y va en las marcas.
  const obstaculosG = new Graphics();
  const corredoras = new Container();
  corredoras.sortableChildren = true;
  const borlaCapa = new Container();
  const etiquetas = new Container();
  // Las fichas se ordenan: la amarilla de quien va adelante arriba de todas, y la de quien se acaba de echar arriba de las comunes.
  etiquetas.sortableChildren = true;
  mundo.addChild(suelo, marcas, porton, raya, estelas, obstaculosG, corredoras, borlaCapa, etiquetas);
  S.scene.addChild(mundo);
  const hud = new Container();
  S.hud.addChild(hud);

  /** Los momentos de la recta que miran el auditor y las fotos del prototipo 3D. */
const HORAS_Q = [0.25, 0.5, 0.7, 0.88, 1];
/** Cuántas de las que cruzan detrás de quien gana protege la cámara debajo del cartel, además de ella: con más, el golpe no llega a su acercamiento (`audit-emocion`). */
const PROTEGE_DETRAS = 1;
/**
 * Cuánto se agranda la caja de un letrero del 3D (SALIDA, META) para las fichas de nombre, en altos de ficha: a los costados y arriba y abajo. El letrero cruza
 * la pantalla a unos 130 px por segundo y la ficha que no puede quedar encima tarda 0,3 s o más en correrse un renglón o en apagarse: dos altos (unos 50 px)
 * le dan ese tiempo.
 */
const MARGEN_LETRERO_X = 2;
const MARGEN_LETRERO_Y = 0.5;

/** El prototipo 3D (`?motor=3d`, carrera-3d.ts): si está, dibuja el estadio y las llamas; las fichas, la cinta y el cartel siguen siendo de acá. */
  let tres: Vista3D | null = null;
  /** La cámara del 3D (`carrera-camara.ts`): se arma con la pantalla de ahora y se rearma si cambia. */
  let director3D: Camara3D | null = null;
  /** La hora de juego en que cayó el golpe (`null` mientras no cae): la cámara pasa de la foto al festejo ahí. */
  let golpeEn: number | null = null;

  /* ------------------------------------------------------------- geometría */
  const nombrePx = (): number => k.letra("nombre");
  const medidor = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM });
  medidor.visible = false;
  const cache = new Map<string, number>();
  const ancho = (s: string, px: number): number => {
    const clave = `${px.toFixed(1)}|${s}`;
    let v = cache.get(clave);
    if (v === undefined) {
      medidor.style.fontSize = px;
      medidor.text = s;
      v = medidor.width;
      cache.set(clave, v);
    }
    return v;
  };
  const nivelDe = (vivas: number): Nivel => (vivas <= 8 ? 4 : vivas <= 14 ? 3 : 2);
  const textoDe = (i: number, nivel: Nivel): string => (formasN[i] as readonly string[])[nivel - 1] ?? names[i] ?? "";

  let forma: Forma;
  let carr: Carriles;
  let F0 = 0;
  let Xs = 0;
  let metaX = 0;
  let nombreW = 0;
  let gateX = 0;
  let arenaX = 0;
  let formaArena: Forma | null = null;
  /** Cuánto mide un cuerpo en la pantalla: la unidad del modelo, el 3,9 % del ancho (una llama del estadio de 1920). */
  const cuerpoPx = (): number => CUERPO * ENSANCHE * RECTA * P.w;
  function medirGeometria(): void {
    P = pant();
    const px = nombrePx();
    nombreW = 0;
    // El ancho de las fichas: el del nivel con que arrancan (con ocho o menos, el nombre entero), con un poco de aire para la ficha amarilla, que es más grande.
    const nivelInicial: Nivel = d.gente.length <= 8 ? 4 : 3;
    for (const g of d.gente) nombreW = Math.max(nombreW, ancho(textoDe(g, nivelInicial), px) * 1.15);
    forma = formaDe(P, Math.max(1, d.gente.length), px, nombreW);
    // El grupo ocupa su distancia de verdad (`carrera-orden.ts`), no los casilleros de la flecha: el largo y dónde va el frente salen de ahí.
    forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpoPx();
    const sobraGrupo = forma.arriba ? nombreW / 2 + forma.largo / 2 : nombreW + forma.largo;
    forma.ancla = Math.max(0.5 * P.w, Math.min(0.8 * P.w, forma.profundidad + sobraGrupo + 0.03 * P.w));
    carr = carrilesDe(P, d.lanes.length, px);
    F0 = -(60 * P.u + LLAMA_HOCICO * forma.esc);
    Xs = F0 + d.distAbre * P.w;
    metaX = Xs + RECTA * P.w + LLAMA_HOCICO * carr.esc;
    // Con tandas: el portón queda justo atrás del corral y la tanda que corre espera más atrás, en un grupo apretado sin nombres (están en el cartel).
    // En el celular la tanda que corre va debajo de su tarjeta de nombres: el grupo empieza donde ella termina (lo resuelve `ubicarTandas`).
    const hTarjeta = P.retrato && d.tandas.length ? Math.max(...d.tandas.map((h) => disenoTarjetaRetrato(alfabetico(names, h.miembros)).h)) : 0;
    const ub = ubicarTandas({ P, forma, F0, tam: d.tandas.length ? Math.max(...d.tandas.map((h) => h.miembros.length)) : 1, nombreW, hTarjeta });
    gateX = ub.gateX;
    if (d.tandas.length) {
      formaArena = ub.formaArena;
      arenaX = ub.arenaX;
    }
  }
  medirGeometria();
  const heatDe = new Map<number, number>();
  d.tandas.forEach((h, i) => h.miembros.forEach((m) => heatDe.set(m, i)));
  /** La caminata de las que pasan (`carrera-caminata.ts`): se arma de nuevo cuando cambia el tamaño de la pantalla. */
  let caminata: Caminata | null = null;
  const caminataDe = (): Caminata | null => {
    if (!formaArena || !d.tandas.length) return null;
    caminata ??= crearCaminata(d.tandas, {
      cuerpo: cuerpoPx(), arena: formaArena, arenaX, gateX, escCorral: forma.esc,
      corral: (persona) => corralDe(persona) ?? { x: F0, y: forma.yPie(0) },
    }, { llegarAntesDe: d.tSalida + LLEGADA_TARDE - 0.1 });
    return caminata;
  };
  const corralMemo = new Map<number, { x: number; y: number } | null>();
  const corralDe = (persona: number): { x: number; y: number } | null => {
    if (!corralMemo.has(persona)) corralMemo.set(persona, lugarEnGrupo(persona, d.tSalida));
    return corralMemo.get(persona) ?? null;
  };
  /** Dónde está el frente del grupo (el origen de la primera) en el mundo. */
  const xFrente = (t: number): number => F0 + d.dist(Math.min(t, d.tAbre)) * P.w;
  /** El mundo en x para un instante del grupo (de la línea de salida al comienzo de la recta). */
  const xDeT = (t: number): number => F0 + d.dist(t) * P.w;

  /* ------------------------------------------------------------- etiquetas */
  function crearEtiqueta(): Etiqueta {
    const raiz = new Container();
    const fondo = new Graphics();
    const texto = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM, stroke: contorno(20) });
    texto.anchor.set(0.5);
    const rotulo = new Container();
    const rotuloFondo = new Graphics();
    const rotuloTexto = S.text("", { fontSize: 12, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 2, join: "round" } });
    rotuloTexto.anchor.set(0.5);
    rotulo.addChild(rotuloFondo, rotuloTexto);
    rotulo.visible = false;
    raiz.addChild(fondo, texto, rotulo);
    return { raiz, fondo, texto, rotulo, rotuloTexto, rotuloFondo, rotuloW: 0, w: 0, h: 0, clave: "" };
  }
  function ponerEtiqueta(e: Etiqueta, s: string, px: number, estilo: "normal" | "lider" | "echada"): void {
    const clave = `${s}|${px.toFixed(1)}|${estilo}`;
    if (e.clave === clave) return;
    const conRotulo = d.nueva && P.retrato && estilo === "lider";
    e.clave = clave;
    const fs = estilo === "lider" ? px * 1.25 : px;
    e.texto.style.fontSize = fs;
    e.texto.style.fill = estilo === "lider" ? INK : CREAM;
    // La ficha amarilla lleva letra de tinta sin borde oscuro, en las dos carreras: tinta sobre amarillo ya tiene contraste
    // de sobra, y un borde de tinta sobre la tinta engorda las letras hasta que el nombre se vuelve una mancha que no se lee.
    // El trazo amarillo, del color de la ficha, no se ve: deja la letra tal cual.
    e.texto.style.stroke = estilo === "lider" ? { color: YELLOW, width: 1, join: "round" } : contorno(fs);
    e.texto.text = s;
    const w = e.texto.width + fs * 0.5;
    // La ficha amarilla tiene más aire arriba y abajo: la letra queda rodeada de amarillo y no del borde de tinta.
    const h = fs * (estilo === "lider" ? 1.6 : 1.28);
    e.w = w;
    e.h = h;
    e.texto.position.set(0, 0);
    e.fondo.clear();
    if (estilo === "lider") e.fondo.roundRect(-w / 2 + 3, -h / 2 + 3, w, h, h * 0.3).fill(INK).roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill(YELLOW).stroke({ width: Math.max(2, fs / 9), color: INK });
    else e.fondo.roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill({ color: estilo === "echada" ? FICHA_ECHADA : INK, alpha: estilo === "echada" ? luz.fichaEchadaAlfa : luz.fichaAlfa });
    // En el celular las llamas son chicas y las filas se apilan: la de adelante lleva la palabra pegada a su ficha, además de la raya y la manta.
    e.rotulo.visible = conRotulo;
    e.rotuloW = 0;
    if (conRotulo) {
      const rf = fs * 0.8;
      e.rotuloTexto.style.fontSize = rf;
      e.rotuloTexto.text = k.txt("carRotuloPunta");
      const rw = e.rotuloTexto.width + rf * 0.9, rh = rf * 1.35;
      e.rotuloFondo.clear().roundRect(-rw / 2, -rh / 2, rw, rh, rh * 0.3).fill(INK);
      e.rotulo.position.set(-w / 2 - rw / 2 + 3, 0);
      e.rotuloW = rw - 3;
    }
  }

  /* ------------------------------------------------------------ corredoras */
  const enUso = new Map<number, Corredora>();
  /** Dónde está cada ficha respecto de su llama (`carrera-fichas-mov.ts`): la decisión de no pisarse cambia de golpe y la ficha se desliza. */
  const fichasMov = new Map<number, EstadoFicha>();
  function tomar(persona: number): Corredora {
    let c = enUso.get(persona);
    if (c) return c;
    // La carrera nueva dibuja la llama de aguayo (la B del diseño); la de siempre, la de lana.
    const llama = (d.nueva ? crearLlamaAguayo : crearLlama)(S, { pelaje: PELAJES[persona % PELAJES.length] ?? 0xf3ead8, manta: S.color(persona) });
    const raiz = new Container();
    raiz.addChild(llama.root);
    const etiqueta = crearEtiqueta();
    corredoras.addChild(raiz);
    etiquetas.addChild(etiqueta.raiz);
    c = { persona, llama, raiz, etiqueta, fase: hash(persona, 7) * 6.28, usada: true };
    enUso.set(persona, c);
    return c;
  }
  /** Cuando una tanda termina, sus llamas se van: cada una tiene su pelaje y su manta, así que no se reusan. */
  function soltar(persona: number): void {
    const c = enUso.get(persona);
    if (!c) return;
    enUso.delete(persona);
    fichasMov.delete(persona);
    c.raiz.destroy({ children: true });
    c.etiqueta.raiz.destroy({ children: true });
  }

  /* ---------------------------------------------------------- posiciones */
  const VENTANA = 6;
  const DT = 0.05;
  /**
   * El grupo (`carrera-orden.ts`): la x de cada una es su distancia de verdad, en cuerpos desde el frente (el mismo cuerpo que usa la recta,
   * `carrera-marcha.ts`), y su fila es la que tiene al salir y no cambia en toda la carrera. Una se escapa, la alcanzan y la pasan por al lado,
   * y cuando una se echa las de atrás avanzan de a poco: nada se salta de un casillero a otro.
   */
  const genteSet = new Set(d.gente);
  /**
   * La fila de cada una: la del puesto con que sale, pero con las filas intercaladas (arriba, abajo, arriba...) para que la salida sea un
   * pelotón y no una escalera. Dos de la misma fila siguen a `filas` puestos una de otra: los nombres no se pisan.
   */
  const filaDe = (persona: number): number => filaDeRango(d.orden.rango(persona), forma.filas);
  /** Dónde va quien está en el grupo en `t` (desde el frente del grupo, que avanza parejo): fija desde que se abre la recta. */
  function lugarEnGrupo(persona: number, t: number): { x: number; y: number } | null {
    if (!genteSet.has(persona)) return null;
    const tt = Math.max(d.tSalida, Math.min(t, d.tAbre));
    return { x: xFrente(tt) + d.orden.puntaje(persona, tt) * cuerpoPx(), y: forma.yPie(filaDe(persona)) };
  }
  /**
   * El paso de las filas del grupo a los carriles de la recta (de a 1 cuerpo por segundo como mucho): empieza dos segundos antes de abrirse, sin pasar
   * de la salida ni, con tandas, de cuando terminan de entrar al corral las últimas en pasar por el portón (`Datos.tCarriles`), y dura `CARRIL_DURA`.
   */
  const fraccionMovida = (t: number): number => suave5((t - d.tCarriles) / CARRIL_DURA);

  /** Una persona de una tanda: espera su turno en el grupo apretado; si pasa, sale por el portón al corral; si no, se echa cuando se cierra. */
  function posicionEnTanda(persona: number, t: number): Posicion {
    const oculta: Posicion = { x: 0, y: 0, esc: forma.esc, velocidad: 0, momento: null, visible: false, etiquetar: false };
    const hi = heatDe.get(persona);
    if (hi === undefined || !formaArena) return oculta;
    const h = d.tandas[hi] as Tanda;
    if (t < h.t0 - 0.2) return oculta;
    const s = formaArena.slot(h.miembros.indexOf(persona));
    const xa = arenaX - s.dx, ya = formaArena.yPie(s.fila), ea = formaArena.esc;
    const j = h.pasan.indexOf(persona);
    if (j < 0) {
      if (t >= h.tFin + 1.2) return oculta;
      if (t >= h.tCierra) return { x: xa, y: ya, esc: ea, velocidad: 0, momento: { kind: "echada", p: (t - h.tCierra) / ECHADA_DUR }, visible: true, etiquetar: false };
      return { x: xa, y: ya, esc: ea, velocidad: 0.4, momento: null, visible: true, etiquetar: false };
    }
    const ts = h.salidas[j] as number;
    if (t < ts) return { x: xa, y: ya, esc: ea, velocidad: 0.4, momento: null, visible: true, etiquetar: false };
    // Sale del grupo de su tanda, pasa por el portón y va a su lugar en el corral caminando: un camino suave, a un cuerpo por segundo como
    // mucho y sin carreras al final (`carrera-caminata.ts`). Nadie se teletransporta de la tanda al grupo.
    const w = caminataDe()?.en(persona, t);
    if (!w) return oculta;
    return { x: w.x, y: w.y, esc: w.esc, velocidad: w.camina ? 1.4 : 0.35, momento: w.camina ? { kind: "trote", p: w.avance } : null, visible: true, etiquetar: w.avance >= 0.75 || d.lider(t) === persona };
  }

  /** La posición de `persona` en `t`, con su postura. */
  function posicion(persona: number, t: number): Posicion {
    if (d.tandas.length && t < d.tSalida) return posicionEnTanda(persona, t);
    const cae = d.tiempos.cae.get(persona) ?? Infinity;
    const carril = d.lanes.indexOf(persona);
    const corriendo: Momento = null;
    // Antes de la salida: en el corral, quietas, en el orden de salida.
    if (t < d.tSalida) {
      const lg = corralDe(persona) ?? { x: F0, y: forma.yPie(0) };
      return { x: lg.x, y: lg.y, esc: forma.esc, velocidad: 0.35, momento: corriendo, visible: true };
    }
    // Echada: se queda donde pasó, con un deslizón corto.
    if (t >= cae) {
      const lg = lugarEnGrupo(persona, cae) ?? { x: F0, y: forma.yPie(0) };
      const s = t - cae;
      // Frena hasta parar en 1,2 s (la velocidad del grupo baja pareja a cero): el grupo la rodea y la deja atrás.
      const v0 = (xFrente(cae) - xFrente(cae - 0.1)) / 0.1;
      const sd = Math.min(s, 1.2);
      const desliza = v0 * (sd - (sd * sd) / 2.4);
      return { x: lg.x + desliza, y: lg.y, esc: forma.esc, velocidad: 0, momento: { kind: "echada", p: s / ECHADA_DUR }, visible: true };
    }
    // Las últimas en pasar por el portón terminan de entrar al corral en los primeros segundos del grupo: caminan con el grupo ya en marcha, así que
    // lo que les falta se suma a su lugar (la caminata es respecto del corral, que se mueve con el frente). De 76 a 100 y de 126 a 200 nadie se echa
    // y la recta se abre en la salida: ahí lo que les falta se suma a su lugar en la recta. Llega a cero cuando llegan, así que se empalman solas.
    const tarde = d.tandas.length && t < cae ? caminataDe() : null;
    const w = tarde && t < tarde.llega(persona) ? tarde.en(persona, t) : null;
    const c = w ? corralDe(persona) : null;
    const falta = w && c ? { x: w.x - c.x, y: w.y - c.y } : null;
    if (t < d.tAbre || carril < 0) {
      const lg = lugarEnGrupo(persona, t) ?? { x: F0, y: forma.yPie(0) };
      if (w && falta) return { x: lg.x + falta.x, y: lg.y + falta.y, esc: w.esc, velocidad: w.camina ? 1.4 : 1, momento: w.camina ? { kind: "trote", p: w.avance } : corriendo, visible: true };
      // Las finalistas empiezan a pasar a su carril un poco antes de abrirse la recta (`CARRIL_ANTES`).
      const e0 = carril >= 0 ? fraccionMovida(t) : 0;
      if (e0 > 0) return { x: lg.x, y: lerp(lg.y, carr.yPie(carril), e0), esc: lerp(forma.esc, carr.esc, e0), velocidad: 1, momento: corriendo, visible: true };
      return { x: lg.x, y: lg.y, esc: forma.esc, velocidad: 1, momento: corriendo, visible: true };
    }
    // La recta: de la forma del grupo a su carril, sin frenar.
    const qq = d.q(t);
    // Las diferencias entre carriles se ensanchan un 70 % en la pantalla: así los adelantamientos se ven (el orden y la llegada son los del plan).
    const pq = d.final.pos(carril, qq);
    const xl = Xs + (qq + (pq - qq) * ENSANCHE) * RECTA * P.w;
    // La ráfaga corre a un grupo de carriles hacia un costado; la valla levanta a quien la salta (ambas del plan, `carrera-obstaculos.ts`).
    const yl = carr.yPie(carril) + (d.final.lateral?.(carril, qq) ?? 0) * carr.altoFila;
    const alza = (d.final.salto?.(carril, qq) ?? 0) * carr.altoFila;
    const e = fraccionMovida(t);
    const m = d.final.beatOf(carril, qq);
    // La x es continua con la del grupo (el mismo cuerpo, el mismo lugar al abrirse): no hace falta empalmar. Lo que cambia de fila a carril
    // (y de tamaño) lo hace de a poco.
    const lg = lugarEnGrupo(persona, d.tAbre) ?? { x: xl, y: yl };
    // La que todavía camina al corral: lo que le falta, y el tamaño de la caminata con lo que ya cambió de la fila al carril.
    if (w && falta) return { x: xl + falta.x, y: lerp(lg.y, yl, e) + falta.y, esc: w.esc + lerp(forma.esc, carr.esc, e) - forma.esc, velocidad: w.camina ? 1.4 : 1.1, momento: w.camina ? { kind: "trote", p: w.avance } : m, visible: true, alza };
    return { x: xl, y: lerp(lg.y, yl, e), esc: lerp(forma.esc, carr.esc, e), velocidad: e >= 1 ? (m?.kind === "plantada" ? 0 : 1.2) : 1.1, momento: m, visible: true, alza };
  }

  /* ------------------------------------------------------------ los obstáculos */
  /** Dónde está en el mundo el carril `kk` cuando la recta va en `q` (la misma cuenta que `posicion`). */
  const xCarril = (kk: number, q: number): number => Xs + (q + (d.final.pos(kk, q) - q) * ENSANCHE) * RECTA * P.w;
  /** Las vallas del plan, en el mundo: cruzan los carriles de la final. */
  function vallasDelPlan(): Valla3D[] {
    return (d.final.obstaculos ?? []).filter((o) => o.tipo === "salto").map((o) => ({ x: Xs + o.valla * RECTA * P.w, y0: carr.y0, y1: carr.y1, alto: 0.34 * carr.altoFila }));
  }
  /** Las piedras y la ráfaga que están pasando en `t`, tal como las ve el 2D y las dibuja el 3D. */
  function efectosEn(t: number): Efecto3D[] {
    const obs = d.final.obstaculos;
    if (!obs?.length || t < d.tAbre || t > d.tCrown) return [];
    const qq = d.q(t);
    const out: Efecto3D[] = [];
    obs.forEach((o, id) => {
      if (o.tipo === "piedras") {
        const qa = o.q - 0.05, qf = o.q + 0.1;
        if (qq < qa || qq > qf) return;
        const kk = o.carriles[0] as number;
        out.push({ tipo: "piedras", s: (qq - qa) / (qf - qa), x: xCarril(kk, o.q + 0.004) + (LLAMA_HOCICO + 30) * carr.esc, y: carr.yPie(kk), y1: 0, ancho: 0, lado: 0, id });
      } else if (o.tipo === "viento") {
        const qa = o.q - 0.02, qf = o.q + o.dur * 1.7;
        if (qq < qa || qq > qf) return;
        const xs = o.carriles.map((kk) => xCarril(kk, qq));
        out.push({ tipo: "viento", s: (qq - qa) / (qf - qa), x: xs.reduce((a, b) => a + b, 0) / xs.length, y: carr.yPie(Math.min(...o.carriles)), y1: carr.yPie(Math.max(...o.carriles)), ancho: 0.55 * P.w, lado: o.lado, id });
      }
    });
    return out;
  }
  /** Las personas a las que les está pasando algo en `t` (la piedra, la que salta mal, el grupo de la ráfaga): el director las incluye en el plano. */
  function enApuros(t: number): number[] {
    const obs = d.final.obstaculos;
    if (!obs?.length) return [];
    const qq = d.q(Math.max(t, d.tAbre));
    const out = new Set<number>();
    for (const o of obs) {
      if (o.tipo === "piedras") {
        if (qq > o.q - 0.03 && qq < o.q + 0.09) out.add(d.lanes[o.carriles[0] as number] as number);
      } else if (o.tipo === "salto") {
        for (const m of o.malas) if (qq > (o.llegan[m] as number) - 0.02 && qq < (o.llegan[m] as number) + 0.08) out.add(d.lanes[m] as number);
      } else if (qq > o.q - 0.01 && qq < o.q + o.dur * 1.4) for (const kk of o.carriles) out.add(d.lanes[kk] as number);
    }
    return [...out];
  }
  /** Una roca de seis puntas, irregular según `h`, centrada en (x, y). */
  const roca = (x: number, y: number, r: number, h: number, giro: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = giro + (i / 6) * Math.PI * 2;
      const rr = r * (0.72 + 0.4 * hash(i + 3, Math.floor(h * 97)));
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.82);
    }
    return pts;
  };
  function pintarObstaculos(t: number): void {
    obstaculosG.clear();
    const ef = efectosEn(t);
    if (!ef.length) return;
    const u = P.u;
    for (const f of ef) {
      const env = Math.sin(Math.PI * Math.min(1, f.s));
      if (f.tipo === "piedras") {
        for (let j = 0; j < 5; j++) {
          const dx = j === 0 ? 0 : (hash(f.id * 7 + j, 3) - 0.5) * 150 * u;
          const dy = j === 0 ? 0 : (hash(f.id * 5 + j, 9) - 0.5) * carr.altoFila * 0.7;
          const retraso = j === 0 ? 0 : hash(f.id * 3 + j, 1) * 0.06;
          const w = (f.s - retraso) / 0.3;
          if (w < 0) continue;
          const gx = f.x + dx, gy = f.y + dy;
          const r = (j === 0 ? 17 : 9 + 6 * hash(f.id + j, 2)) * u;
          if (w < 1) {
            // Cae del cerro: viene de arriba y de atrás, con su sombra creciendo en el piso.
            obstaculosG.ellipse(gx, gy, r * (0.5 + w), r * 0.3 * (0.5 + w)).fill({ color: 0x000000, alpha: 0.3 * w });
            obstaculosG.poly(roca(gx - (1 - w * w) * 70 * u, gy - (1 - w * w) * 430 * u, r, hash(f.id, j), w * 9)).fill(0x8d8478).stroke({ width: 2 * u, color: INK });
          } else {
            const v = (f.s - retraso - 0.3) / 0.45;
            if (v > 1) continue;
            const rebote = Math.abs(Math.sin(v * Math.PI * 2.6)) * Math.exp(-v * 3.2) * 36 * u;
            obstaculosG.ellipse(gx + v * 46 * u, gy, r, r * 0.3).fill({ color: 0x000000, alpha: 0.25 * (1 - v) });
            obstaculosG.poly(roca(gx + v * 46 * u, gy - rebote - r * 0.3, r, hash(f.id, j), v * 12)).fill(0x8d8478).stroke({ width: 2 * u, color: INK });
            if (v < 0.5) for (let i = 0; i < 4; i++) obstaculosG.circle(gx + (i - 1.5) * 18 * u, gy - 8 * u - v * 30 * u * (1 + (i % 2)), (9 + 36 * v) * u).fill({ color: 0xd9cdb4, alpha: 0.5 * (1 - v * 2) });
          }
        }
      } else {
        const yTop = f.y - carr.altoFila * 0.85, yBot = f.y1 + carr.altoFila * 0.15;
        for (let i = 0; i < 16; i++) {
          const yy = yTop + hash(f.id * 11 + i, 4) * (yBot - yTop);
          const fase = (hash(f.id * 13 + i, 6) + f.s * 2.6) % 1;
          const xx = f.x - f.ancho / 2 + fase * f.ancho;
          const largo = (60 + 90 * hash(f.id + i, 8)) * u;
          obstaculosG.moveTo(xx, yy + f.lado * fase * 14 * u).lineTo(xx + largo, yy + f.lado * (fase * 14 + 6) * u).stroke({ width: 2.4 * u, color: 0xffffff, alpha: 0.65 * env, cap: "round" });
        }
        for (let i = 0; i < 10; i++) {
          const yy = yTop + hash(f.id * 17 + i, 5) * (yBot - yTop);
          const fase = (hash(f.id * 19 + i, 7) + f.s * 1.8) % 1;
          const xx = f.x - f.ancho / 2 + fase * f.ancho;
          obstaculosG.poly(roca(xx, yy - Math.sin(fase * Math.PI) * 40 * u, 5 * u, hash(i, f.id), fase * 14)).fill({ color: i % 3 ? 0x6fae4a : 0xc9b27a, alpha: 0.85 * env });
        }
      }
    }
  }

  /* --------------------------------------------------------------- el suelo */
  function pintarSuelo(): void {
    const vz = cam.zoom || 1;
    const x0 = cam.x - P.w / (2 * vz) - 120;
    const x1 = cam.x + P.w / (2 * vz) + 120;
    const yTop = forma.y0 - 14 * P.u;
    const yBot = cam.y + P.h / (2 * vz) + 40;
    suelo.clear();
    type ZonaSuelo = { desde: number; hasta: number; tipo: Terreno | "corral" | "recta"; idx: number };
    const zonas: ZonaSuelo[] = [{ desde: -1e9, hasta: 0, tipo: "corral", idx: 0 }];
    d.tramos.forEach((tr, i) => zonas.push({ desde: i === 0 ? 0 : xDeT(tr.t0), hasta: xDeT(tr.t1), tipo: tr.terreno, idx: i + 1 }));
    zonas.push({ desde: d.tramos.length ? Xs : 0, hasta: 1e9, tipo: "recta", idx: 9 });
    if (!d.tramos.length) zonas[0] = { desde: -1e9, hasta: 0, tipo: "corral", idx: 0 };
    for (const z of zonas) {
      const a = Math.max(x0, z.desde), b = Math.min(x1, z.hasta);
      if (b <= a) continue;
      suelo.rect(a, yTop, b - a, yBot - yTop).fill(TERRENO_COLOR[z.tipo]);
      suelo.rect(a, yTop, b - a, 5 * P.u).fill({ color: 0x000000, alpha: 0.22 });
      const T = 150 * P.u;
      for (let i = Math.floor(a / T); i * T < b; i++) {
        for (let m = 0; m < 4; m++) {
          const r1 = hash(i * 31 + m, z.idx * 7 + 1), r2 = hash(i * 17 + m, z.idx * 5 + 3), r3 = hash(i * 13 + m, z.idx * 3 + 9);
          const px = i * T + r1 * T, py = lerp(forma.y0, forma.y1 + 30 * P.u, r2);
          if (px < a || px > b) continue;
          const c = TERRENO_ACENTO[z.tipo];
          if (z.tipo === "barro") suelo.ellipse(px, py, (16 + 22 * r3) * P.u, (5 + 5 * r3) * P.u).fill({ color: luz.charco, alpha: 0.55 });
          else if (z.tipo === "piedras") suelo.poly([px, py, px + 12 * P.u * r3 + 6 * P.u, py - 7 * P.u, px + 20 * P.u, py + 2 * P.u]).fill({ color: c, alpha: 0.75 }).stroke({ width: 1.5 * P.u, color: INK, alpha: 0.5 });
          else if (z.tipo === "viento") suelo.moveTo(px, py).lineTo(px + (28 + 40 * r3) * P.u, py - 2 * P.u).stroke({ width: 2 * P.u, color: 0xffffff, alpha: 0.5 });
          else if (z.tipo === "cuesta") suelo.moveTo(px, py).lineTo(px + 7 * P.u, py - 12 * P.u).moveTo(px + 6 * P.u, py).lineTo(px + 13 * P.u, py - 14 * P.u).stroke({ width: 2 * P.u, color: c, alpha: 0.85 });
          else suelo.circle(px, py, 2.5 * P.u).fill({ color: c, alpha: 0.4 });
        }
      }
    }
    // La recta: carriles con sus rayas.
    const aR = Math.max(x0, Xs - 160 * P.u);
    if (x1 > aR) {
      for (let j = 0; j <= carr.n; j++) {
        const y = carr.y0 + j * carr.altoFila;
        suelo.moveTo(aR, y).lineTo(x1, y).stroke({ width: 2.5 * P.u, color: 0xffffff, alpha: j === 0 || j === carr.n ? 0.8 : 0.4 });
      }
    }
    // Postes: uno cada 0,2 anchos, con una banderita del color del terreno. Pasan de derecha a izquierda.
    const gap = 0.2 * P.w;
    for (let i = Math.max(0, Math.floor((x0 - F0) / gap)); F0 + i * gap < x1; i++) {
      const px = F0 + i * gap + gap * 0.5;
      if (px < x0 || px > metaX - 40 * P.u) continue;
      const base = forma.y0 - 4 * P.u;
      const tr = d.tramos.find((t) => px >= xDeT(t.t0) && px < xDeT(t.t1));
      const col = TERRENO_ACENTO[px >= Xs ? "recta" : (tr?.terreno ?? "corral")];
      suelo.rect(px - 3 * P.u, base - 62 * P.u, 6 * P.u, 62 * P.u).fill(INK);
      suelo.poly([px + 3 * P.u, base - 62 * P.u, px + 32 * P.u, base - 52 * P.u, px + 3 * P.u, base - 40 * P.u]).fill(col).stroke({ width: 2 * P.u, color: INK });
    }
  }

  /* --------------------------------------------------- la salida y la meta */
  /** El rótulo META y dónde lo deja la pista: el cuadro lo corre hacia adentro de la pantalla (`acomodarMeta`). */
  let metaTxt: Text | null = null;
  /** El letrero SALIDA, en el mundo: las fichas de nombre no se le ponen encima mientras esté a la vista. */
  let salidaTxt: Text | null = null;
  let metaBase = { x: 0, y: 0 };
  function pintarMarcas(): void {
    marcas.removeChildren().forEach((c) => c.destroy({ children: true }));
    const g = new Graphics();
    const u = P.u;
    const y0 = forma.y0 - 14 * u, y1 = forma.y1 + 8 * u;
    // El corral: una cerca atrás de la línea de salida.
    const ancho = d.tandas.length ? -gateX + P.w * 0.7 : forma.profundidad + nombreW + 260 * u;
    for (let x = -ancho; x <= 0; x += 70 * u) g.rect(x - 3 * u, y0 - 26 * u, 6 * u, 36 * u).fill(0x6b4a2c).stroke({ width: 1.5 * u, color: INK });
    g.rect(-ancho, y0 - 20 * u, ancho, 5 * u).fill(0x8a6238).rect(-ancho, y0 - 6 * u, ancho, 5 * u).fill(0x8a6238);
    // La línea de salida.
    g.rect(-6 * u, y0, 12 * u, y1 - y0).fill(0xffffff);
    for (let y = y0, i = 0; y < y1; y += 12 * u, i++) if (i % 2) g.rect(-6 * u, y, 12 * u, 12 * u).fill(INK);
    // La meta: dos postes y un arco con cuadros.
    const pm = metaX;
    g.rect(pm - 7 * u, y0 - 70 * u, 14 * u, y1 - y0 + 70 * u).fill({ color: 0x000000, alpha: 0.0 });
    for (let y = y0, i = 0; y < y1; y += 14 * u, i++) {
      g.rect(pm - 14 * u, y, 14 * u, 14 * u).fill(i % 2 ? INK : 0xffffff);
      g.rect(pm, y, 14 * u, 14 * u).fill(i % 2 ? 0xffffff : INK);
    }
    g.rect(pm - 12 * u, y0 - 78 * u, 24 * u, 78 * u).fill(INK);
    g.rect(pm - 12 * u, y1, 24 * u, 12 * u).fill(INK);
    // Los portones de la recta: uno por carril, donde el grupo se abre. Cuántas pasan se cuenta con cosas, no con números.
    if (d.tiempos.echadas.length) {
      g.rect(Xs - 2 * u, carr.y0, 4 * u, carr.y1 - carr.y0).fill({ color: 0xffffff, alpha: 0.5 });
      for (let j = 0; j <= carr.n; j++) {
        const y = carr.y0 + j * carr.altoFila;
        g.rect(Xs - 3 * u, y - 30 * u, 6 * u, 32 * u).fill(INK);
        g.circle(Xs, y - 34 * u, 7 * u).fill(d.nueva ? CREAM : YELLOW).stroke({ width: 2.5 * u, color: INK });
      }
    }
    // Las vallas del salto: una cerca baja de lado a lado de los carriles, con rayas, y un poste en cada raya de carril.
    for (const v of vallasDelPlan()) {
      const largo = v.y1 - v.y0;
      g.roundRect(v.x - 5 * u, v.y0, 10 * u, largo, 4 * u).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
      for (let y = v.y0, i = 0; y < v.y1; y += 20 * u, i++) if (i % 2) g.rect(v.x - 5 * u, y, 10 * u, Math.min(20 * u, v.y1 - y)).fill(0xe8e2d4);
      for (let j = 0; j <= carr.n; j++) g.circle(v.x, v.y0 + j * carr.altoFila, 9 * u).fill(0x6b4a2c).stroke({ width: 2 * u, color: INK });
      g.rect(v.x - SALTO_MEDIO * RECTA * P.w, v.y0, 2 * SALTO_MEDIO * RECTA * P.w, largo).fill({ color: 0xffffff, alpha: 0.07 });
    }
    // En la carrera nueva el arco de la meta baja al borde de la pista: arriba quedaba debajo de la cabecera y se cortaba.
    const bajaMeta = d.nueva ? 88 * u : 0;
    g.roundRect(pm - 90 * u, y0 - 100 * u + bajaMeta, 180 * u, 38 * u, 8 * u).fill(0xffffff).stroke({ width: 3 * u, color: INK });
    for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) g.rect(pm - 90 * u + i * 20 * u, y0 - 100 * u + bajaMeta + j * 19 * u, 20 * u, 19 * u).fill(INK);
    marcas.addChild(g);
    const meta = S.text(k.txt("carRotuloMeta"), { fontSize: 34 * u, fontWeight: "900", fill: YELLOW, stroke: contorno(34 * u) });
    meta.anchor.set(0.5);
    // En la nueva, la palabra va al costado del arco: debajo quedaba la ganadora cruzando y la tapaba.
    // En el celular no hay lugar a la derecha del arco: la palabra va a su izquierda.
    if (d.nueva) meta.anchor.set(P.retrato ? 1 : 0, 0.5);
    metaBase = { x: d.nueva ? pm + (P.retrato ? -98 : 98) * u : pm, y: d.nueva ? y0 - 100 * u + bajaMeta + 19 * u : y0 - 118 * u };
    meta.position.set(metaBase.x, metaBase.y);
    metaTxt = meta;
    const salida = S.text(k.txt("carSalida").replace(/[¡!]/g, "").toUpperCase(), { fontSize: 26 * u, fontWeight: "900", fill: CREAM, stroke: contorno(26 * u) });
    salida.anchor.set(0, 0.5);
    salida.position.set(26 * u, y0 + 30 * u);
    salidaTxt = salida;
    marcas.addChild(meta, salida);
  }

  /**
   * META entera y a la vista: si su lugar en la pista cae debajo de la cabecera (el medallón de la cinta) o pegado a un borde, se corre
   * hacia adentro de lo que se ve; si habría que correrla más de cuatro veces su alto (la cámara se fue lejos), o ya cayó el golpe (el cartel de quien gana le tapa el lugar), se calla.
   */
  function acomodarMeta(t: number): void {
    const m = metaTxt;
    if (!m || m.destroyed) return;
    const lim = limites();
    // El medallón de la cinta cuelga más abajo que la cinta: META queda debajo de él, no detrás.
    const c = hudG.cinta;
    lim.y0 = Math.max(lim.y0, S.scene.pivot.y + (c.y + c.h / 2 + c.h * 0.72 + 5 * P.u - S.scene.position.y) / (S.scene.scale.x || 1));
    const w = m.width, h = m.height;
    const ax = m.anchor.x;
    m.visible = t < d.tCrown;
    if (!m.visible) return;
    // Todavía no entró (o ya salió) por el costado: es el mundo que pasa, no hay nada que acomodar.
    const cx = metaBase.x + (0.5 - ax) * w;
    if (cx < lim.x0 || cx > lim.x1 || w > lim.x1 - lim.x0) {
      m.position.set(metaBase.x, metaBase.y);
      return;
    }
    const izq = Math.min(Math.max(metaBase.x - ax * w, lim.x0), lim.x1 - w);
    const arriba = Math.min(Math.max(metaBase.y - h / 2, lim.y0), lim.y1 - h);
    if (Math.abs(arriba - (metaBase.y - h / 2)) > 4 * h) {
      m.visible = false;
      return;
    }
    m.position.set(izq + ax * w, arriba + h / 2);
  }

  /**
   * El letrero SALIDA no baja de la letra mínima en la pantalla, sea cual sea el plano: en el celular el plano del corral se achica (0,6) porque la tarjeta de
   * nombres ocupa el cielo, y a 26 de letra el letrero quedaba en 14,5 px durante más de siete segundos. Crece sobre su ancla (a la izquierda, centrado en su renglón).
   */
  function acomodarSalida(): void {
    const sal = salidaTxt;
    if (!sal || sal.destroyed) return;
    const real = (sal.style.fontSize as number) * (S.scene.scale.x || 1);
    sal.scale.set(Math.max(1, minimoPx("nombre", P.w, P.h) / real));
  }

  /* ------------------------------------------------------------- el cielo */
  function pintarCielo(): void {
    const u = P.u;
    cieloFijo.clear();
    const franjas = luz.franjas;
    franjas.forEach((c, i) => cieloFijo.rect(0, (P.h * i) / franjas.length, P.w, P.h / franjas.length + 1).fill(c));
    const sx = P.w * luz.sol.x, sy = P.h * luz.sol.y;
    // De día el sol lleva un halo de luz: un disco grande y casi transparente detrás.
    if (luz.sol.halo) cieloFijo.circle(sx, sy, 92 * u).fill({ color: luz.sol.color, alpha: 0.28 }).circle(sx, sy, 66 * u).fill({ color: luz.sol.color, alpha: 0.4 });
    cieloFijo.circle(sx, sy, 46 * u).fill({ color: luz.sol.color, alpha: luz.sol.alfa });
    const periodo = 1.4 * P.w;
    montes.forEach((m, j) => {
      m.clear();
      const base = P.h * 0.52;
      const col = luz.cerros[j % 2] as number;
      const picos = [0, 0.12, 0.26, 0.4, 0.55, 0.7, 0.86, 1.0];
      const pts = picos.map((p, i) => [p * periodo, base - (i % 2 ? 110 : 40 + hash(i, 5) * 80) * u] as const);
      m.poly([0, base, ...pts.flatMap(([x, y]) => [x, y]), periodo, base]).fill(col);
      m.rect(0, base - 1, periodo, P.h).fill(col);
      // Las cumbres altas, con nieve: el casquete sigue las dos laderas de la cumbre, hasta unos 26 u de caída.
      if (luz.nieve) {
        pts.forEach(([x, y], i) => {
          if (i === 0 || i === pts.length - 1 || base - y < 100 * u) return;
          const [xa, ya] = pts[i - 1] as readonly [number, number], [xb, yb] = pts[i + 1] as readonly [number, number];
          const fa = Math.min(0.5, (26 * u) / Math.max(1, Math.abs(ya - y))), fb = Math.min(0.5, (26 * u) / Math.max(1, Math.abs(yb - y)));
          const ax = x + (xa - x) * fa, ay = y + (ya - y) * fa, bx = x + (xb - x) * fb, by = y + (yb - y) * fb;
          // El borde de abajo va en zigzag: tres dientes de nieve entre una ladera y la otra.
          m.poly([ax, ay, x, y, bx, by, x + (bx - x) * 0.55, y + (by - y) * 0.62, x + (bx - x) * 0.2, y + (by - y) * 0.42, x - (x - ax) * 0.2, y + (ay - y) * 0.42, x - (x - ax) * 0.55, y + (ay - y) * 0.62]).fill(0xf4f7fb);
        });
      }
    });
  }

  /* ------------------------------------------------------------------ la cinta */
  const cinta = new Container();
  const cintaG = new Graphics();
  const cursor = new Container();
  const cursorAro = new Graphics();
  const cursorCara = new Sprite();
  const cursorMascara = new Graphics();
  cursor.addChild(cursorAro, cursorCara, cursorMascara);
  cursorCara.mask = cursorMascara;
  cinta.addChild(cintaG, cursor);
  hud.addChild(cinta);
  let hudG = hudDe(P);
  let cursorDe = -1;
  let cintaXa = 0;
  let cintaXb = 1;
  function pintarCinta(): void {
    hudG = hudDe(P);
    const c = hudG.cinta;
    const u = P.u;
    cintaG.clear();
    cintaG.roundRect(c.x0 - 4 * u, c.y - 4 * u, c.x1 - c.x0 + 8 * u, c.h + 8 * u, 10 * u).fill(INK);
    const r = c.h * 0.72;
    // El camino va entre el cursor del principio y la bandera del final: el cursor nunca queda cortado en el borde.
    cintaXa = c.x0 + r * 0.8;
    cintaXb = c.x1 - c.h * 0.95 - r * 0.3;
    const ancho = cintaXb - cintaXa;
    const x0 = cintaXa;
    for (const s of d.cinta) {
      const col = TERRENO_COLOR[s.tipo === "recta" ? "recta" : (s.terreno ?? "corral")];
      const a = x0 + s.f0 * ancho, b = x0 + s.f1 * ancho;
      cintaG.rect(a, c.y, b - a, c.h).fill(col);
      const ac = TERRENO_ACENTO[s.tipo === "recta" ? "recta" : (s.terreno ?? "corral")];
      if (s.tipo === "tandas") for (let x = a + 10 * u; x < b - 6 * u; x += 16 * u) cintaG.rect(x, c.y + c.h * 0.2, 3 * u, c.h * 0.6).fill({ color: INK, alpha: 0.8 });
      else if (s.tipo === "recta") for (let j = 1; j < 4; j++) cintaG.moveTo(a, c.y + (c.h * j) / 4).lineTo(b, c.y + (c.h * j) / 4).stroke({ width: 1.5 * u, color: 0xffffff, alpha: 0.5 });
      else if (s.terreno === "barro") for (let x = a + 8 * u; x < b - 6 * u; x += 22 * u) cintaG.ellipse(x, c.y + c.h * 0.65, 8 * u, 3 * u).fill({ color: luz.charco, alpha: 0.7 });
      else if (s.terreno === "piedras") for (let x = a + 8 * u; x < b - 6 * u; x += 20 * u) cintaG.circle(x, c.y + c.h * 0.6, 4.5 * u).fill({ color: ac, alpha: 0.85 });
      else if (s.terreno === "viento") for (let y = 1; y < 4; y++) cintaG.moveTo(a + 4 * u, c.y + (c.h * y) / 4).lineTo(b - 4 * u, c.y + (c.h * y) / 4 - 2 * u).stroke({ width: 1.8 * u, color: 0xffffff, alpha: 0.7 });
      else if (s.terreno === "cuesta") cintaG.poly([a, c.y + c.h, b, c.y + c.h, b, c.y + c.h * 0.2]).fill({ color: ac, alpha: 0.6 });
      if (s.f0 > 0) cintaG.moveTo(a, c.y).lineTo(a, c.y + c.h).stroke({ width: 2 * u, color: INK });
    }
    // La bandera de la meta, a cuadros, al final.
    const bx = cintaXb + r * 0.3;
    const cuadro = c.h / 4;
    cintaG.rect(bx - 3 * u, c.y - 2 * u, 3 * u, c.h + 4 * u).fill(INK);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cintaG.rect(bx + i * cuadro, c.y + j * cuadro, cuadro, cuadro).fill((i + j) % 2 ? INK : 0xffffff);
    cintaG.rect(bx, c.y, cuadro * 4, c.h).stroke({ width: 1.5 * u, color: INK });
    // Dónde queda la bandera, en píxeles de la pantalla: `audit-lavado.mjs` mide su contraste en el lienzo.
    S.mark("bandera", [bx, c.y, cuadro * 4, c.h].map((v) => Math.round(v)).join(","));
    // El cursor: la cara de quien va adelante.
    cursorAro.clear().circle(0, 0, r).fill(YELLOW).stroke({ width: 3 * u, color: INK });
    cursorMascara.clear().circle(0, 0, r * 0.82).fill(0xffffff);
    cursorCara.anchor.set(0.5);
    cursorCara.width = cursorCara.height = r * 1.64;
    cursorDe = -1;
  }

  /* -------------------------------------------------------- el cartel de nombres */
  const cartel = new Container();
  const cartelFondo = new Graphics();
  const cartelTextos: Text[] = [];
  cartel.addChild(cartelFondo);
  hud.addChild(cartel);
  let cartelClave = "";
  let cartelOrden: number[] = [];
  let cartelEstados: number[] = [];
  interface OpcionesCartel {
    lado: "centro" | "izquierda";
    /** 0 normal, 1 pasó (amarillo), 2 no pasó (apagado). */
    estado?: (i: number) => 0 | 1 | 2;
  }
  function ponerCartel(ids: readonly number[], alfa: number, op: OpcionesCartel = { lado: "centro" }): void {
    cartel.visible = alfa > 0.01 && ids.length > 0;
    cartel.alpha = alfa;
    if (!cartel.visible) return;
    const clave = `${ids.join(",")}|${P.w}x${P.h}|${op.lado}`;
    if (clave !== cartelClave) {
      cartelClave = clave;
      cartelEstados = [];
      disponerCartel(ids, op.lado);
    }
    if (op.estado) {
      cartelOrden.forEach((i, j) => {
        const e = op.estado?.(i) ?? 0;
        if (cartelEstados[j] === e) return;
        cartelEstados[j] = e;
        const t = cartelTextos[j];
        if (!t) return;
        t.style.fill = e === 1 ? YELLOW : CREAM;
        t.alpha = e === 2 ? 0.4 : 1;
      });
    }
  }
  /**
   * La tarjeta en un celular parado: la más chica que entra a lo ancho y no pasa del 25 % de la pantalla (`carrera-tarjeta.ts`). Hasta ahora
   * era una lista centrada o de media pantalla que tapaba el corral; ahora va arriba, en el cielo, y la cámara deja el corral debajo.
   */
  function disenoTarjetaRetrato(ordenados: readonly number[]): DisenoTarjeta {
    const minimo = minimoPx("nombre", P.w, P.h);
    return tarjetaRetrato({
      textos: ordenados.map((i) => names[i] ?? ""),
      cortos: ordenados.map((i) => textoDe(i, 3)),
      medir: (s2, px) => ancho(s2, px),
      w: P.w, h: P.h, u: P.u, pxNominal: Math.max(nombrePx(), minimo), pxMinimo: minimo,
    });
  }
  function disponerCartelRetrato(ordenados: readonly number[]): void {
    const u = P.u;
    const dis = disenoTarjetaRetrato(ordenados);
    while (cartelTextos.length < ordenados.length) {
      const t = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM, stroke: contorno(20) });
      t.anchor.set(0, 0.5);
      cartel.addChild(t);
      cartelTextos.push(t);
    }
    const x0 = (P.w - dis.w) / 2 + dis.padX;
    const y0 = hudG.bajo + 8 * u + dis.padY;
    let x = x0;
    for (let c = 0; c < dis.cols; c++) {
      let y = y0;
      for (let r = 0; r < dis.filas; r++) {
        const j = c * dis.filas + r;
        if (j >= ordenados.length) break;
        const lineas = dis.dosLineas[j] ? 2 : 1;
        const t = cartelTextos[j] as Text;
        t.visible = true;
        t.alpha = 1;
        t.style.fill = CREAM;
        t.style.fontSize = dis.px;
        t.style.stroke = contorno(dis.px);
        t.style.align = "left";
        // El texto tal como lo midió el diseño: entero, partido o, si es un nombre que ni así entra, cortado.
        t.text = dis.rotulos[j] ?? "";
        t.position.set(x, y + (lineas * dis.lineaH) / 2);
        y += lineas * dis.lineaH;
      }
      x += (dis.anchoCol[c] as number) + dis.gap;
    }
    cartelTextos.forEach((t, j) => {
      if (j >= ordenados.length) t.visible = false;
    });
    cartelFondo.clear().roundRect(x0 - dis.padX, y0 - dis.padY, dis.w, dis.h, 14 * u).fill({ color: INK, alpha: 1 }).stroke({ width: 3 * u, color: YELLOW });
  }
  /** Lo que mide de alto la tarjeta del celular con todos los nombres (sin tandas), para que la cámara deje el corral debajo. */
  let altoTarjetaMemo = { clave: "", alto: 0 };
  function altoTarjetaCorral(): number {
    if (!P.retrato || d.tandas.length) return 0;
    const clave = `${P.w}x${P.h}|${d.names.length}`;
    if (altoTarjetaMemo.clave !== clave) altoTarjetaMemo = { clave, alto: disenoTarjetaRetrato(alfabetico(names, d.names.map((_, i) => i))).h };
    return altoTarjetaMemo.alto;
  }
  function disponerCartel(ids: readonly number[], lado: "centro" | "izquierda"): void {
    const u = P.u;
    const ordenados = alfabetico(names, ids);
    cartelOrden = ordenados;
    if (P.retrato) {
      disponerCartelRetrato(ordenados);
      return;
    }
    const izq = lado === "izquierda";
    // El fondo del cartel empieza debajo del marcador QUEDAN (con su sombra), no sobre él; el piso del cartel no se mueve.
    const arriba = arribaDelCartel(P);
    const alto = Math.max(80, P.bottom - 14 * u - arriba);
    const area = izq
      ? { x: P.w * 0.02 + 22 * u, y: arriba, w: P.w * 0.34 - 44 * u, h: alto }
      : { x: P.w * 0.04, y: arriba, w: P.w * 0.92, h: alto };
    const minimo = minimoPx("nombre", P.w, P.h);
    let px = Math.max(nombrePx(), minimo);
    let diseno: { cols: number; filas: number; anchoCol: number; dosLineas: boolean[] } | null = null;
    for (let intento = 0; intento < 6 && !diseno; intento++) {
      const lineaH = px * 1.4;
      for (let cols = 1; cols <= 6 && !diseno; cols++) {
        const anchoCol = area.w / cols - 14 * u;
        const dos = ordenados.map((i) => ancho(names[i] ?? "", px) > anchoCol);
        const filasN = Math.ceil(ordenados.length / cols);
        let alto = 0;
        for (let c = 0; c < cols; c++) {
          let h = 0;
          for (let r = 0; r < filasN; r++) h += (dos[c * filasN + r] ? 2 : 1) * lineaH;
          alto = Math.max(alto, h);
        }
        if (alto <= area.h && dos.every((x, j) => !x || Math.max(...partirEn2(names[ordenados[j] as number] ?? "").map((l) => ancho(l, px))) <= anchoCol)) diseno = { cols, filas: filasN, anchoCol, dosLineas: dos };
      }
      if (!diseno) px = Math.max(minimo, px * 0.9);
    }
    // Si no entra de ninguna manera, en dos columnas (celular) o cuatro con los nombres partidos: nunca encimados.
    const colsRes = P.retrato ? 2 : 4;
    const dis = diseno ?? {
      cols: colsRes, filas: Math.ceil(ordenados.length / colsRes), anchoCol: area.w / colsRes - 14 * u,
      dosLineas: ordenados.map((i) => ancho(names[i] ?? "", px) > area.w / colsRes - 14 * u),
    };
    let maxW = 0;
    ordenados.forEach((i, j) => {
      const nm = names[i] ?? "";
      maxW = Math.max(maxW, dis.dosLineas[j] ? Math.max(...partirEn2(nm).map((s) => ancho(s, px))) : ancho(nm, px));
    });
    dis.anchoCol = Math.min(dis.anchoCol, maxW + 18 * u);
    while (cartelTextos.length < ordenados.length) {
      const t = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM, stroke: contorno(20) });
      t.anchor.set(0, 0.5);
      cartel.addChild(t);
      cartelTextos.push(t);
    }
    const lineaH = px * 1.4;
    let altoMax = 0;
    const ys: number[] = [];
    for (let c = 0; c < dis.cols; c++) {
      let y = 0;
      for (let r = 0; r < dis.filas; r++) {
        const j = c * dis.filas + r;
        if (j >= ordenados.length) break;
        const lineas = dis.dosLineas[j] ? 2 : 1;
        ys[j] = y + (lineas * lineaH) / 2;
        y += lineas * lineaH;
      }
      altoMax = Math.max(altoMax, y);
    }
    const ancho2 = dis.cols * dis.anchoCol + (dis.cols - 1) * 14 * u;
    const x0 = izq ? area.x : (P.w - ancho2) / 2;
    const y0 = izq ? area.y : area.y + (area.h - altoMax) / 2;
    cartelTextos.forEach((t, j) => {
      t.visible = j < ordenados.length;
      t.alpha = 1;
      t.style.fill = CREAM;
      if (!t.visible) return;
      const nombre = names[ordenados[j] as number] ?? "";
      t.style.fontSize = px;
      t.style.stroke = contorno(px);
      t.style.align = "left";
      t.text = dis.dosLineas[j] ? partirEn2(nombre).join("\n") : nombre;
      const c = Math.floor(j / dis.filas);
      t.position.set(x0 + c * (dis.anchoCol + 14 * u), y0 + (ys[j] as number));
    });
    cartelFondo.clear().roundRect(x0 - 22 * u, y0 - FONDO_CARTEL * u, ancho2 + 44 * u, altoMax + 2 * FONDO_CARTEL * u, 18 * u).fill({ color: INK, alpha: 1 }).stroke({ width: 3 * u, color: YELLOW });
  }

  /** El portón de las tandas: abierto mientras pasan, cerrado cuando las demás se echan. */
  function pintarPorton(t: number): void {
    porton.clear();
    if (!d.tandas.length) return;
    const u = P.u;
    const h = d.tandas.find((x) => t >= x.t0 - 0.3 && t < x.tFin);
    const cerrado = !!h && t >= h.tCierra;
    const ya = forma.y0 - 6 * u, yb = forma.y1 + 4 * u;
    porton.rect(gateX - 6 * u, ya - 34 * u, 12 * u, 42 * u).fill(0x6b4a2c).stroke({ width: 2 * u, color: INK });
    porton.rect(gateX - 6 * u, yb - 8 * u, 12 * u, 42 * u).fill(0x6b4a2c).stroke({ width: 2 * u, color: INK });
    if (cerrado) porton.rect(gateX - 4 * u, ya, 8 * u, yb - ya).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
    else {
      porton.rect(gateX - 4 * u, ya, 8 * u, 30 * u).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
      porton.rect(gateX - 4 * u, yb - 30 * u, 8 * u, 30 * u).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
    }
  }

  /** La dueña de la ficha amarilla y de la manta (`Datos.duena`): en la carrera nueva no parpadea en el acordeón. */
  /** Las horas en que cada una sale por el portón, de la primera a la última. */
  const salidasPorton = d.tandas.flatMap((h) => h.salidas).sort((a, b) => a - b);
  /**
   * Quién lleva la marca de ir adelante (la borla y la ficha amarilla). En el grupo y la recta, quien va adelante. Con tandas, quien pasa por el portón: se queda con ella
   * lo que tarda en cruzarlo (`MARCA_PORTON`) y después nadie la lleva hasta que pasa la siguiente. Antes la llevaba la última que había pasado hasta que pasaba otra, y se
   * veía a una corriendo sola por el campo con la borla mientras las demás esperaban en el corral.
   */
  const estable = (t: number): number => {
    const q = d.duena(t);
    if (!d.tandas.length || t >= d.tSalida || q < 0) return q;
    // En la de siempre, en las tandas no hay marca: pasaban de a una cada 1,2 s y el aro saltaba de una a otra. Quien pasa lo dicen el relator y el
    // cartel (su nombre en amarillo); la marca aparece con la salida, en quien va adelante.
    if (!d.nueva) return -1;
    let ultima = -Infinity;
    for (const s of salidasPorton) {
      if (s > t) break;
      ultima = s;
    }
    return t - ultima > MARCA_PORTON ? -1 : q;
  };

  /* ------------------------------------------------------------ la raya del frente */
  /**
   * La raya del frente (carrera nueva): una línea de luz amarilla en el hocico de la que va primera, de lado a lado de la pista.
   * Contesta cuánto le falta a cada una para alcanzarla y el instante en que la pasan. Sigue al hocico más adelantado de las que
   * corren, así que no salta: cuando dos se cruzan, la raya ya está en las dos.
   */
  let rayaX = 0;
  function pintarRaya(t: number): void {
    raya.clear();
    if (t < d.tSalida + 0.3 || t >= d.tCrown - LLEGADA_ANTES) return;
    const u = P.u;
    const vz = cam.zoom || 1;
    const y0 = (t >= d.tAbre ? carr.y0 : forma.y0) - 10 * u, y1 = (t >= d.tAbre ? carr.y1 : forma.y1) + 6 * u;
    const ancho = Math.max(3 * u, 3.2 / vz);
    raya.rect(rayaX - ancho * 3, y0, ancho * 6, y1 - y0).fill({ color: YELLOW, alpha: 0.2 });
    raya.rect(rayaX - ancho / 2, y0, ancho, y1 - y0).fill({ color: YELLOW, alpha: 0.95 });
    // Tres flechas a la derecha sobre la raya: la línea es vertical, y sin ellas una pantalla alta (el celular) parece correr hacia arriba.
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const y = y0 + (y1 - y0) * f;
      raya.poly([rayaX - 4 * u, y - 12 * u, rayaX + 18 * u, y, rayaX - 4 * u, y + 12 * u]).fill(YELLOW).stroke({ width: 2 * u, color: INK, join: "round" });
    }
  }

  /* --------------------------------------------------------------- la borla */
  // La carrera nueva cambia la borla por la manta amarilla en el lomo de quien va adelante (no tapa su cara) y la raya del frente.
  const borla: Container = d.nueva ? crearManta() : crearBorla();
  borlaCapa.addChild(borla);

  /* ------------------------------------------------------------- el cuadro */
  /** Una caja del cuerpo de quien corre, con el nombre: lo que no puede cortar la cámara. */
  const cuerpoDe = (p: Posicion, conNombre = false, quien?: number): Caja => {
    const w = LLAMA_LARGO * p.esc;
    const h = LLAMA_ALTO * p.esc + (conNombre ? forma.altoNombre : 0);
    // Con el nombre a la izquierda (celular), la caja también lo incluye: la cámara no lo corta.
    const izq = conNombre && quien !== undefined && p.esc === carr.esc && !carr.arriba ? (ancho(textoDe(quien, 4), nombrePx()) * 1.25 + nombrePx()) * 1.12 : 0;
    return { x: p.x + LLAMA_COLA * p.esc - izq, y: p.y - h, w: w + 6 * p.esc + izq, h };
  };

  interface Ficha {
    q: number;
    c: Corredora;
    p: Posicion;
    estilo: "normal" | "lider" | "echada";
    nv: Nivel;
    arriba: boolean;
    comp: number;
    esc: number;
    soyLider: boolean;
  }
  /** El ancla de la ficha de una llama: encima de su cabeza, la misma posición con que se dibuja. */
  const anclaFicha = (p: Posicion): { x: number; y: number } => ({ x: p.x + 6 * p.esc, y: p.y - LLAMA_ALTO * p.esc - 3 * P.u });
  /**
   * Cuánto se mueve el ancla de la ficha de `q` respecto del frente del grupo, en cuerpos por segundo, en el paso de la grilla de la hora `t` (`carrera-fichas-mov.ts`):
   * se calcula con la posición de la llama en las horas de la grilla, que es función de la hora, no con lo que hubo entre dos cuadros.
   */
  function velocidadDeAncla(q: number, t: number): number {
    const tg = pasoDe(t) / PASOS_POR_SEGUNDO, ta = tg - 1 / PASOS_POR_SEGUNDO;
    const p1 = posicion(q, tg), p0 = posicion(q, ta);
    if (!p1.visible || !p0.visible) return 0;
    const a1 = anclaFicha(p1), a0 = anclaFicha(p0);
    const dx = a1.x - (F0 + d.dist(tg) * P.w) - (a0.x - (F0 + d.dist(ta) * P.w));
    return (Math.hypot(dx, a1.y - a0.y) * PASOS_POR_SEGUNDO) / cuerpoPx();
  }
  /**
   * La ficha va con su llama y lo que la decisión de no pisar a otra cambia (un renglón, el modo, el nombre más corto) se desliza (`carrera-fichas-mov.ts`):
   * nunca salta. `quiere` es si la decisión la muestra; `llama(hora)` cuánto se mueve su ancla respecto del frente del grupo (cuerpos por segundo) en esa hora de la grilla
   * (cada paso que avanza la ficha pide la suya) y `cuerpo` los píxeles de un cuerpo en la pantalla.
   */
  function deslizarFicha(q: number, et: Etiqueta, ancla: { x: number; y: number }, quiere: boolean, t: number, llama: (hora: number) => number, cuerpo: number, lim: CajaF): boolean {
    const o = { ox: et.raiz.x - ancla.x, oy: et.raiz.y - ancla.y, visible: quiere, llama: llama(t), llamaEn: llama };
    const previo = fichasMov.get(q);
    const e = previo ? pasoFicha(previo, t, o, cuerpo) : estadoNuevo(t, o);
    fichasMov.set(q, e);
    et.raiz.alpha = e.alfa;
    et.raiz.visible = e.alfa > 0.01;
    if (!et.raiz.visible) return false;
    // Mientras se desliza, la ficha no se sale de lo que se ve de la pantalla (el deslizamiento llega un poco atrasado de lo que decidió `metida`):
    // el límite es continuo en la posición, así que tampoco salta.
    const esc = et.raiz.scale.x;
    const mitadW = (et.w * esc) / 2, izq = et.rotuloW * esc, mitadH = (et.h * esc) / 2;
    let x = ancla.x + e.ox, y = ancla.y + e.oy;
    const antes = { x, y };
    if (lim.x1 - lim.x0 > 2 * mitadW + izq) x = Math.max(lim.x0 + mitadW + izq, Math.min(lim.x1 - mitadW, x));
    if (lim.y1 - lim.y0 > 2 * mitadH) y = Math.max(lim.y0 + mitadH, Math.min(lim.y1 - mitadH, y));
    et.raiz.position.set(x, y);
    // Pegada al borde de la pantalla: la cámara la empuja (la ficha sigue al borde, que se mueve con la cámara); el auditor no la cuenta como un salto.
    return x !== antes.x || y !== antes.y;
  }
  /** Dónde va la ficha de una: arriba de la cabeza (proyector) o a la izquierda del cuerpo (celular), sin salirse de la pantalla ni meterse bajo la cabecera. */
  function ubicarFicha(et: Etiqueta, p: Posicion, arriba: boolean, comp: number, vz: number, lider = false): void {
    const esc = p.esc;
    let x: number, y: number;
    if (arriba) {
      x = p.x + 6 * esc;
      y = p.y - (LLAMA_ALTO * esc + (et.h * comp) / 2 + 3 * P.u);
    } else {
      x = p.x + (LLAMA_COLA * esc - 4 * P.u - (et.w * comp) / 2);
      y = p.y - (LLAMA_ALTO * esc) / 3;
      // La ficha amarilla es más grande, con sombra y borde, y la manta de quien va adelante flamea por detrás de la cola:
      // se corre hacia atrás lo que sobra, para que no tape el cuerpo ni se pegue a la manta.
      if (d.nueva && lider) x -= 8 * esc + 3 * P.u + 5 * comp;
    }
    // Ni debajo de la cabecera (la ficha amarilla es más alta que lo que se reservó).
    const arribaMin = limites().y0 + (et.h * comp) / 2;
    if (y < arribaMin) y = arribaMin;
    et.raiz.position.set(x, y);
  }
  /**
   * Lo que la pantalla deja ver del mundo, en coordenadas del mundo: debajo de la cabecera y encima del relator, sin pegarse a los bordes.
   * Se mide con lo que la cámara aplicó de verdad a la escena (`scene`: su acercamiento incluye el golpe y el de la emoción, que
   * `cam.zoom` no trae), no con la meta de la cámara.
   */
  /** Desde que cae el golpe las fichas no pasan de la parte de abajo del cartel de quien gana: los nombres de las que llegan detrás no quedan debajo de él. */
  function pisoDeFichas(): number {
    return k.coronado ? S.placaBajo(k.ganadores.length) + 4 * P.u : 0;
  }
  function limites(): CajaF {
    const sc = S.scene;
    const z = sc.scale.x || 1;
    const x = (px: number): number => sc.pivot.x + (px - sc.position.x) / z;
    const y = (py: number): number => sc.pivot.y + (py - sc.position.y) / z;
    return { x0: x(4 * P.u), x1: x(P.w - 4 * P.u), y0: y(Math.max(hudG.bajo + 3 * P.u, pisoDeFichas())), y1: y(P.bottom) };
  }
  /** Cuánto dura en pantalla la línea del relator que nombra a una (la echada, el cambio de punta). */
  const NOMBRADA_DUR = 2.5;
  /** Las que el relator nombra en `t`: su ficha no puede quedar tapada. */
  function nombradas(t: number): Set<number> {
    const s = new Set<number>();
    for (const e of d.tiempos.echadas) if (t >= e.t && t < e.t + NOMBRADA_DUR) s.add(e.quien);
    for (const c of d.cambiosDePunta) if (t >= c.t && t < c.t + NOMBRADA_DUR) s.add(c.quien);
    return s;
  }
  /**
   * Las fichas no se pisan, en las dos carreras. Se ubican de la que más manda a la que menos: la que el relator nombra ahora,
   * la amarilla, las que se echaron y después el resto, de adelante hacia atrás. La que pisa a una ya puesta (más del 10 % de la
   * más chica) pasa a un nombre más corto (solo la carrera nueva) y, si todavía pisa, se corre un renglón arriba o abajo, alternando,
   * sin irse más de dos renglones de su llama. Si no cabe, se calla ese cuadro. Una ficha que no entra entera en la pantalla se
   * corre hacia adentro, o se calla: nunca sale cortada. Es una función del cuadro, sin azar.
   */
  function resolverFichas(fichas: Ficha[], px: number, vz: number, nombrados: ReadonlySet<number>): void {
    const puestas: CajaF[] = [];
    const lim = limites();
    // El letrero SALIDA cuenta como una caja ya puesta mientras se ve: las fichas lo pisaban y quedaba «SALI» con un nombre encima.
    const sal = salidaTxt;
    if (sal && !sal.destroyed && marcas.visible && sal.visible) {
      const w = sal.width, h = sal.height;
      const c = { x0: sal.x - sal.anchor.x * w, y0: sal.y - sal.anchor.y * h, x1: sal.x + (1 - sal.anchor.x) * w, y1: sal.y + (1 - sal.anchor.y) * h };
      if (c.x1 > lim.x0 && c.x0 < lim.x1 && c.y1 > lim.y0 && c.y0 < lim.y1) puestas.push(c);
    }
    const caja = (f: Ficha): CajaF => {
      const et = f.c.etiqueta;
      const w = et.w * f.comp, h = et.h * f.comp;
      return { x0: et.raiz.x - w / 2 - et.rotuloW * f.comp, y0: et.raiz.y - h / 2, x1: et.raiz.x + w / 2, y1: et.raiz.y + h / 2 };
    };
    /** Mete la ficha en la pantalla; falso si no entra entera o habría que irse demasiado lejos de su llama. */
    const encajar = (f: Ficha): boolean => {
      const et = f.c.etiqueta;
      const m = metida(caja(f), lim);
      if (!m) return false;
      et.raiz.position.set(et.raiz.x + m.dx, et.raiz.y + m.dy);
      return true;
    };
    // La amarilla se ubica primero, pegada a su llama; la que el relator nombra busca lugar después, sin empujarla.
    const manda = (f: Ficha): number => (f.soyLider ? 5 : nombrados.has(f.q) ? 4 : f.estilo === "echada" ? 2 : 1);
    const orden = [...fichas].sort((a, b) => manda(b) - manda(a) || b.p.x - a.p.x);
    fichas: for (const f of orden) {
      const et = f.c.etiqueta;
      // Dónde cae su ficha sin más (y lo que ya se corrió para entrar en la pantalla): el tope de renglones cuenta desde ahí.
      let yNatural = et.raiz.y;
      if (!encajar(f)) {
        et.raiz.visible = false;
        continue;
      }
      let r = caja(f);
      let nv = f.nv;
      while (d.nueva && pisaA(r, puestas) && nv > 2 && !f.soyLider && f.estilo !== "echada") {
        nv = (nv - 1) as Nivel;
        ponerEtiqueta(et, textoDe(f.q, nv), px, f.estilo);
        ubicarFicha(et, f.p, f.arriba, f.comp, vz, f.soyLider);
        yNatural = et.raiz.y;
        if (!encajar(f)) {
          et.raiz.visible = false;
          continue fichas;
        }
        r = caja(f);
      }
      if (pisaA(r, puestas)) {
        if (nombrados.has(f.q) && !f.soyLider) {
          // La que el relator nombra busca lugar debajo de su llama (justo bajo las patas y, si no, un renglón abajo y después arriba); si no
          // entra con su nombre, pasa a su nombre de pila. Nunca empuja a la amarilla, y si no hay lugar se queda donde está, por encima de todas.
          const buscar = (): number | null => {
            const cab = caja(f);
            if (f.arriba) {
              const h = cab.y1 - cab.y0;
              const dyPies = f.p.y + 3 * P.u + h / 2 - et.raiz.y;
              const c = { ...cab, y0: cab.y0 + dyPies, y1: cab.y1 + dyPies };
              if (dyPies > 0 && et.raiz.y + dyPies - yNatural <= LLAMA_ALTO * f.p.esc + RENGLONES_MAX * (h + 1) && c.y0 >= lim.y0 && c.y1 <= lim.y1 && !pisaA(c, puestas)) return dyPies;
            }
            return sitioLibre(cab, puestas, lim, false, et.raiz.y - yNatural, true);
          };
          let dy = buscar();
          if (dy === null && nv > 2) {
            nv = 2;
            ponerEtiqueta(et, textoDe(f.q, nv), px, f.estilo);
            ubicarFicha(et, f.p, f.arriba, f.comp, vz, f.soyLider);
            yNatural = et.raiz.y;
            if (encajar(f)) {
              r = caja(f);
              dy = pisaA(r, puestas) ? buscar() : 0;
            }
          }
          if (dy !== null) et.raiz.y += dy;
        } else {
          // Un renglón arriba o abajo, alternando (sobre la cabeza, primero para arriba).
          const dy = sitioLibre(r, puestas, lim, f.arriba, et.raiz.y - yNatural);
          if (dy !== null) et.raiz.y += dy;
          else if (manda(f) < 4) {
            et.raiz.visible = false;
            continue;
          }
        }
      }
      puestas.push(caja(f));
      // El cuerpo de la amarilla también cuenta: ninguna otra ficha se le pone encima (la que se leía como suya era la de al lado).
      if (f.soyLider) {
        const b = cuerpoDe(f.p);
        puestas.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
      }
    }
  }

  /**
   * Para medir la marcha (`?auditar=marcha`, `scripts/audit-marcha.mjs`): en cada cuadro dibujado, la hora del juego y dónde está cada llama
   * en el mundo (los mismos números que reciben el 2D y el 3D). No cambia nada de lo que se dibuja.
   */
  const auditarMarcha = auditaCon("marcha");
  /**
   * Las fichas del 3D de este cuadro (persona, x, y, transparencia, x e y de la cabeza, escala, ancho, alto y ancho del rótulo de la izquierda), en píxeles de
   * pantalla, para la traza.
   */
  let fichas3Cuadro: number[][] = [];
  /** Las cajas de los letreros del 3D que se ven en este cuadro (x0, y0, x1, y1), en píxeles de pantalla, para la traza. */
  let letreros3Cuadro: number[][] = [];
  /** Las fichas de este cuadro que el borde de la pantalla dejó pegadas (para la traza). */
  const pegadas = new Set<number>();
  const trazaMarcha: { t: number; ref: number; llamas: [number, number, number, string | null, number][]; fichas: number[][]; letreros?: number[][] }[] = [];
  if (auditarMarcha) {
    (window as unknown as { __marcha: unknown }).__marcha = {
      cuadros: trazaMarcha,
      meta: () => ({ caminata: (() => { const c = caminataDe(); return c ? { tarde: Math.max(...d.gente.map((g) => c.llega(g))) - d.tSalida, escalaMax: Math.max(...d.gente.map((g) => c.escala(g))), largoMax: Math.max(...d.gente.map((g) => c.largo(g))), cuerpo: cuerpoPx() } : null; })(), causas: d.causas, cuerpo: cuerpoPx(), filaPx: carr.altoFila, n: d.n, gente: d.gente, lanes: d.lanes, campeona: d.campeona, tSalida: d.tSalida, tAbre: d.tAbre, tCrown: d.tCrown, w: P.w, h: P.h, recta: RECTA, xs: Xs, metaX, f0: F0, altoFila: carr.altoFila, altoLlama: forma.alto, escGrupo: forma.esc, escCarril: carr.esc, nueva: d.nueva, arco: d.final.story.arc, echadas: d.tiempos.echadas.map((e) => ({ t: e.t, quien: e.quien })), obstaculos: (d.final.obstaculos ?? []).map((o) => ({ tipo: o.tipo, tq: d.tDeQ(o.q), carriles: o.carriles, malas: o.malas })), cambiosDePunta: d.cambiosDePunta, tDeQ: [0.25, 0.5, 0.75, 0.9, 1].map((q) => d.tDeQ(q)) }),
    };
  }

  /** Lo más alto que salta quien gana en el festejo, `s` segundos después de cruzar, en píxeles del mundo: cada salto llega a esto y cada vez es más bajo. */
  function saltoFestejo(s: number): number {
    return s < 0 ? 0 : 20 * P.u * Math.max(0, 1 - s / 3);
  }

  function dibujar(t: number): void {
    const vz = cam.zoom || 1;
    if (!tres) pintarSuelo();
    const cuadroMarcha: [number, number, number, string | null, number][] = [];
    const gente3: Corredora3D[] = [];
    const fichas3: { et: Etiqueta; persona: number; comp: number; y: number; etiquetar: boolean; sinLugar: boolean; peso: number }[] = [];
    // El cielo se mueve con la cámara, más despacio.
    const periodo = 1.4 * P.w;
    const desp = -((cam.x * 0.12) % periodo);
    montes.forEach((m, j) => {
      m.position.set(desp + j * periodo - (j === 0 ? periodo : 0), 0);
      m.alpha = 1;
    });
    // Los que se ven: las del grupo y, con tandas, las de la tanda que corre (y las que se echaron en la anterior).
    const quienes = new Set<number>(d.gente.length ? d.gente : d.lanes);
    if (d.tandas.length && t < d.tSalida) for (const h of d.tandas) if (t >= h.t0 - 0.2 && t < h.tFin + 1.3) for (const m of h.miembros) quienes.add(m);
    for (const q of [...enUso.keys()]) if (!quienes.has(q)) soltar(q);
    const nVivas = d.tiempos.echadas.length ? d.vivas(t).length : d.lanes.length;
    const nivel = nivelDe(nVivas);
    const px = nombrePx();
    const lider = estable(t);
    const corona = t - d.tCrown;
    // La ficha grande pasa con la marca y la borla (o el aro) se desliza hasta ella.
    const bp = posicionBorla(t, lider);
    const duenia = bp?.duenia ?? lider;
    let rayaMax = -Infinity;
    estelas.clear();
    acomodarMeta(t);
    acomodarSalida();
    const fichas: Ficha[] = [];
    const deLlamas: { q: number; et: Etiqueta; p: Posicion; dentro: boolean }[] = [];
    const nombrados = nombradas(t);
    for (const q of quienes) {
      const c = tomar(q);
      const p = posicion(q, t);
      if (auditarMarcha && p.visible) cuadroMarcha.push([q, p.x, p.y, p.momento?.kind ?? null, p.alza ?? 0]);
      if (!p.visible) {
        c.raiz.visible = false;
        c.etiqueta.raiz.visible = false;
        c.etiqueta.raiz.alpha = 1;
        fichasMov.delete(q);
        continue;
      }
      const post = c.llama;
      if (d.nueva && p.momento?.kind !== "echada" && (!d.tandas.length || t >= d.tSalida)) {
        const xh = p.x + LLAMA_HOCICO * p.esc;
        if (xh > rayaMax) rayaMax = xh;
      }
      if (d.nueva && p.velocidad > 0.5 && p.momento?.kind !== "echada" && t >= d.tSalida + 0.3) {
        // Tres rayitas que se alargan con el paso, a la altura del lomo, del hocico a la cola y más atrás.
        const largo = (34 + 10 * Math.sin(t * 9 + c.fase)) * p.esc;
        for (const [a, h] of [[0.0, 52], [0.25, 36], [0.5, 22]] as const) {
          estelas.moveTo(p.x + (LLAMA_COLA - 4 - a * 30) * p.esc, p.y - h * p.esc).lineTo(p.x + (LLAMA_COLA - 4) * p.esc - largo * (1 - a * 0.5), p.y - h * p.esc).stroke({ width: Math.max(1.6 * P.u, 2.2 * p.esc), color: 0xffffff, alpha: 0.6, cap: "round" });
        }
      }
      if (p.momento?.kind === "trote") {
        // El polvo del trote: tres bocanadas detrás de las patas, que se agrandan y se desvanecen (función de la hora, sin azar).
        for (let i = 0; i < 3; i++) {
          const ciclo = (t * 2.2 + i / 3 + c.fase) % 1;
          estelas.circle(p.x + (LLAMA_COLA - 8 - ciclo * 46) * p.esc, p.y - (3 + ciclo * 14) * p.esc, (4 + ciclo * 9) * p.esc).fill({ color: 0xd9cdb4, alpha: 0.5 * (1 - ciclo) });
        }
      }
      c.raiz.visible = true;
      c.raiz.position.set(p.x, p.y - (p.alza ?? 0));
      c.raiz.scale.set(p.esc);
      const lying = p.momento?.kind === "echada";
      // La que se acaba de echar queda por encima de las que pasan: la echada no se tapa.
      const reciente = lying && (p.momento?.p ?? 9) < 4;
      c.raiz.zIndex = p.y + (reciente ? 1e5 : 0);
      const ph = t * (p.velocidad > 0.5 ? 13 : 5) + c.fase;
      let momento = p.momento;
      if (corona >= 0 && q === d.campeona) {
        // Festeja: salta.
        const s = corona;
        c.raiz.position.y = p.y - Math.abs(Math.sin(s * 7)) * saltoFestejo(s);
        momento = null;
      }
      post.pose(ph, corona >= 0 && q !== d.campeona ? 0 : p.velocidad, momento);
      if (tres) gente3.push({ persona: q, x: p.x, y: p.y, salto: p.y - c.raiz.position.y, esc: p.esc, velocidad: corona >= 0 && q !== d.campeona ? 0 : p.velocidad, momento, fase: ph });
      // La marca de la llama ("!", "?!") se lee desde el fondo: en la pantalla nunca mide menos que un nombre.
      if (post.marca.visible) post.marca.scale.set(Math.max(1, minimoPx("nombre", P.w, P.h) / (26 * p.esc * vz)));
      post.zz.scale.set(Math.max(1, Math.min(3, (0.016 * P.h) / (11 * p.esc * vz))));
      // La etiqueta: pegada al cuerpo.
      const et = c.etiqueta;
      // En los últimos 3 s nada marca a quien va adelante (ni la ficha amarilla ni la manta ni el aro): es el cabeza a cabeza.
      const soyLider = q === duenia && !lying && t < d.tCrown - LLEGADA_ANTES;
      const estilo = lying ? "echada" : soyLider ? "lider" : "normal";
      const nv: Nivel = lying ? 3 : nivel;
      ponerEtiqueta(et, textoDe(q, nv), px, estilo);
      // La ficha nunca se ve más chica que el piso del kit (16 px en el celular, el 2,6 % del alto en el proyector).
      const comp = Math.max(1, Math.min(2.2, minimoPx("nombre", P.w, P.h) / (px * vz)));
      et.raiz.scale.set(comp);
      const enCarril = t >= d.tAbre && d.lanes.includes(q);
      const arriba = enCarril ? carr.arriba : forma.arriba;
      const esc = p.esc;
      // Desde el golpe, la ficha de quien gana manda como la amarilla: con las demás alrededor perdía el lugar un cuadro sí y otro no, y quedaba a media luz.
      if (tres) fichas3.push({ et, persona: q, comp, y: p.y, etiquetar: false, sinLugar: false, peso: soyLider || (k.coronado && q === d.campeona) ? 3e6 : reciente ? 2e6 : 1e6 });
      else ubicarFicha(et, p, arriba, comp, vz, soyLider);
      et.raiz.zIndex = nombrados.has(q) ? 4e6 : soyLider ? 3e6 : reciente ? 2e6 : 1e6;
      // Las que quedaron lejos de la pantalla no se dibujan.
      const dentro = p.x > cam.x - P.w / (2 * vz) - 300 && p.x < cam.x + P.w / (2 * vz) + 300;
      c.raiz.visible = dentro;
      // En el celular no hay lugar para que los nombres de todas las que se echaron queden a la vista: a los 2,5 s se va la ficha y queda la llama echada.
      const sinLugar = P.retrato && lying && (p.momento?.p ?? 0) > 5;
      // Cuando cae el golpe, quien gana ya tiene su cartel: la ficha sobra (el nombre aparecía tres veces).
      const sobra = d.nueva && ((k.coronado && q === d.campeona) || p.x + LLAMA_HOCICO * p.esc < cam.x - P.w / (2 * vz) + 4 * P.u);
      et.raiz.visible = dentro && p.etiquetar !== false && !sinLugar && !sobra;
      if (tres) {
        const f = fichas3[fichas3.length - 1];
        if (f) {
          f.etiquetar = p.etiquetar !== false;
          f.sinLugar = sinLugar || sobra;
        }
      } else {
        if (et.raiz.visible) fichas.push({ q, c, p, estilo, nv, arriba, comp, esc, soyLider });
        deLlamas.push({ q, et, p, dentro });
      }
    }
    if (!tres) {
      resolverFichas(fichas, px, vz, nombrados);
      // Lo que decidió resolverFichas se aplica deslizando (M9): la ficha sigue a su llama y no salta de un cuadro al otro.
      const lim = limites();
      pegadas.clear();
      for (const r of deLlamas) {
        // La que se aleja de la pantalla se apaga como cualquiera que se calla (en 0,3 s), no de golpe.
        const quiere = r.et.raiz.visible && r.dentro;
        if (!r.dentro && !fichasMov.has(r.q)) {
          r.et.raiz.alpha = 1;
          r.et.raiz.visible = false;
          continue;
        }
        if (deslizarFicha(r.q, r.et, anclaFicha(r.p), quiere, t, (hora) => velocidadDeAncla(r.q, hora), cuerpoPx(), lim)) pegadas.add(r.q);
      }
    }
    pintarPorton(t);
    pintarObstaculos(t);
    if (Number.isFinite(rayaMax)) rayaX = rayaMax;
    // La borla: pasa de una a otra (se calculó antes del bucle).
    borla.visible = !!bp && t < d.tCrown - LLEGADA_ANTES && (!d.tandas.length || t >= ((d.tandas[0] as Tanda).salidas[0] as number));
    if (bp) {
      borla.position.set(bp.x, bp.y);
      borla.scale.set(bp.esc);
      if (d.nueva) (borla as Container & { flamea?(hora: number): void }).flamea?.(t);
    }
    if (d.nueva) pintarRaya(t);
    // En el celular el cartel de quien gana cae justo sobre la cinta: ya no hay nada que medir, y debajo del cartel asomaba a medias.
    cinta.visible = !(d.nueva && P.retrato && k.coronado);
    // La cinta: el cursor lleva la cara de quien va adelante.
    const c = hudG.cinta;
    // La cara del cursor es la de quien va adelante en la lista (no la que lleva la marca): sin marca no pasa a ser la de una finalista.
    const lid = d.duena(t) >= 0 ? d.duena(t) : (d.lanes[0] as number);
    if (cursorDe !== lid) {
      cursorDe = lid;
      cursorCara.texture = k.figura(lid);
      cursorCara.width = cursorCara.height = c.h * 0.72 * 1.64;
    }
    // En los últimos tres segundos la cinta no señala a nadie: el aro sigue el avance y la cara se apaga. Cuando la marca pasa a otra (la de siempre),
    // la cara no cambia de golpe: se apaga en 0,2 s, cambia y se prende en 0,2 s. En las tandas no hay marca y la cara no se ve.
    let fundido = 1;
    for (const m of d.marcas) fundido = Math.min(fundido, clamp01(Math.abs(t - m.t) / 0.2));
    const sinMarca = !d.nueva && d.tandas.length > 0 && t < d.tSalida;
    cursorCara.alpha = sinMarca ? 0 : d.cursor(t) * fundido;
    cursorCara.visible = cursorCara.alpha > 0.01;
    cursor.position.set(cintaXa + clamp01(d.frac(t)) * (cintaXb - cintaXa), c.y + c.h / 2);
    // El cartel de los nombres: del vuelo a la salida.
    if (d.tandas.length) {
      // Con tandas: los nombres de la tanda que corre, a un costado y en orden; quien pasa se pone amarilla y las demás se apagan.
      const hi = d.tanda(t);
      const h = hi >= 0 ? (d.tandas[hi] as Tanda) : null;
      const aparece = h ? suave((t - (h.t0 - 0.05)) / 0.25) * (1 - suave((t - (h.tFin - 0.2)) / 0.25)) : 0;
      ponerCartel(h?.miembros ?? [], aparece, {
        lado: "izquierda",
        estado: (i) => (h && h.pasan.some((p2, j) => p2 === i && (h.salidas[j] as number) <= t) ? 1 : h && t >= h.tCierra && h.noPasan.includes(i) ? 2 : 0),
      });
    } else {
      // Hasta 30: todos juntos, enteros, antes de la salida.
      const aparece = suave((t - (d.tVuelo - 0.3)) / 0.4) * (1 - suave((t - (d.tSalida - 0.15)) / 0.3));
      // Con 12 o menos, el cartel va a un costado (en el proyector) y no tapa al grupo.
      ponerCartel(d.names.map((_, i) => i), aparece, { lado: !P.retrato && d.gente.length <= 12 ? "izquierda" : "centro" });
    }
    // `ref` es el frente común del grupo en este cuadro (el camino que avanza igual para todas): contra él se mide lo que se mueve cada llama.
    if (tres) dibujar3D(t, gente3, fichas3, bp, corona);
    if (auditarMarcha) {
      // Las fichas, después de deslizar (M9): persona, x, y y transparencia (0 si no se ve).
      const cuadroFichas: number[][] = [];
      for (const r of deLlamas) cuadroFichas.push([r.q, r.et.raiz.x, r.et.raiz.y, r.et.raiz.visible ? r.et.raiz.alpha : 0, r.p.momento?.kind === "echada" ? 1 : 0, pegadas.has(r.q) ? 1 : 0]);
      trazaMarcha.push({ t, ref: F0 + d.dist(t) * P.w, llamas: cuadroMarcha, fichas: tres ? fichas3Cuadro : cuadroFichas, ...(tres ? { letreros: letreros3Cuadro } : {}) });
    }
  }

  /**
   * El cuadro del prototipo 3D: le pasa a la vista lo que el 2D ya puso (posiciones, posturas, cámara del director) y,
   * con la cámara de este cuadro, lleva cada ficha de nombre a donde cae la cabeza de su llama en la pantalla.
   */
  function dibujar3D(
    t: number,
    gente: Corredora3D[],
    fichas: { et: Etiqueta; persona: number; comp: number; y: number; etiquetar: boolean; sinLugar: boolean; peso: number }[],
    bp: { x: number; esc: number; pie: number; y: number; duenia: number; vuela?: boolean } | null,
    corona: number,
  ): void {
    if (!tres) return;
    const vz = cam.zoom || 1;
    const medir = auditaCon("3d");
    fichas3Cuadro = [];
    const medidas: { persona: number; px: number; alto: number; ancho: number; x: number; y: number }[] = [];
    const borla3: Borla3D | null = bp && borla.visible ? { x: bp.x, pie: bp.pie, alto: bp.pie - bp.y, radio: BORLA_RADIO * bp.esc, duenia: bp.duenia, manta: d.nueva, vuela: bp.vuela } : null;
    // La cámara: hasta que se abre la recta mira lo que mira el director del 2D; de ahí al festejo la lleva `carrera-camara.ts`, que solo lee
    // dónde pisa cada finalista (de la recta, de la llegada, de la foto y de la ganadora desde el golpe).
    if (k.coronado && golpeEn === null) golpeEn = t;
    const escMedia = gente.length ? gente.reduce((a, c) => a + c.esc, 0) / gente.length : 0.5;
    const base = camara3D({ x: cam.x, y: cam.y, zoom: vz, rot: cam.rot }, P.w, P.h, P.u, escMedia);
    // La cámara pide además dónde pisan en las horas de la grilla por las que pasa entre dos cuadros: no depende de los cuadros que hubo.
    // Quien gana lleva lo más alto de su salto del festejo: la cámara deja debajo del cartel su cabeza en lo alto del salto, no la que pisa el suelo
    // (el salto la subía por detrás del cartel y el auditor de emoción medía 21 % tapado).
    const puestosEn = (tt: number): Puesto[] => d.lanes.map((q) => {
      const p = posicion(q, tt);
      return { persona: q, x: p.x, y: p.y, esc: p.esc, salto: q === d.campeona ? saltoFestejo(tt - d.tCrown) : 0 };
    });
    const puestos = puestosEn(t);
    // La hora del golpe es la del kit (`crear.ts`): lo que tarda el foco, en segundos reales, pasa a hora de juego dividido por el ritmo.
    director3D ??= crearCamara3D({
      marco: { w: P.w, h: P.h, u: P.u }, tAbre: d.tAbre, tCrown: d.tCrown, tGolpe: d.tCrown + tiemposFoco(d.final.story.arc).golpe / paceFactor(), metaX,
      carriles: { y0: carr.y0, y1: carr.y1, n: carr.n, esc: carr.esc },
    });
    const dirigida = director3D.cuadro({ t, puestos, puestosEn, base, ganadora: d.campeona, golpeEn, bajoCartel: S.placaBajo(k.ganadores.length) + 4 * P.u });
    const pose = dirigida.plano === "base" ? null : dirigida.pose;
    tres.frame({ t, w: P.w, h: P.h, u: P.u, cam: { x: cam.x, y: cam.y, zoom: vz, rot: cam.rot }, pose, gente, borla: borla3, campeona: d.campeona, corona, horas: HORAS_Q.map((q) => d.tDeQ(q)), efectos: efectosEn(t) });
    // Los letreros SALIDA y META, mientras se ven, cuentan como cajas ya puestas (como SALIDA en el 2D): las fichas los tapaban.
    const letreros = tres.letreros();
    if (auditarMarcha) letreros3Cuadro = letreros.map((c) => [c.x0, c.y0, c.x1, c.y1]);
    // Las fichas no se pisan: la que manda (la del primero, después las recientes) se queda donde cae; la que choca con una puesta
    // se corre hacia arriba o hacia abajo por su alto y, si ni así cabe, no se muestra en ese cuadro.
    // Y ninguna ficha tapa la cabeza de otra llama (la perspectiva apila las filas, y la ficha de la de adelante caía sobre la de atrás).
    const puestas: { x0: number; y0: number; x1: number; y1: number; de?: number; cabeza?: boolean }[] = [];
    for (const f of fichas) {
      const pc = tres.pantallaDe(f.persona);
      if (!pc || pc.x < 0 || pc.x > P.w || pc.y < P.top || pc.y > P.bottom) continue;
      puestas.push({ de: f.persona, cabeza: true, x0: pc.x - pc.alto * 0.28, x1: pc.x + pc.alto * 0.28, y0: pc.y - pc.alto * 0.1, y1: pc.y + pc.alto * 0.3 });
    }
    for (const f of [...fichas].sort((a, b2) => b2.peso - a.peso)) {
      const pan = tres.pantallaDe(f.persona);
      const et = f.et;
      if (!pan) {
        et.raiz.visible = false;
        et.raiz.alpha = 1;
        fichasMov.delete(f.persona);
        continue;
      }
      const dentro = pan.x > -40 && pan.x < P.w + 40 && pan.y > P.top - 20 && pan.y < P.bottom + 40;
      // La ficha mide en la pantalla lo mismo que en el 2D (`comp` por el acercamiento) y se apoya sobre la cabeza. Con la cámara del
      // director 3D el acercamiento del 2D no cuenta (las llamas miden lo que mide la perspectiva): la letra es la legible de siempre.
      const e = f.comp * (pose ? 1 : vz);
      et.raiz.scale.set(e);
      // Entera en la pantalla: en el celular los de los bordes se cortaban.
      const mitad = (et.w * e) / 2 + 4 * P.u;
      // Con la cámara del director 3D ninguna ficha pasa por debajo de la cinta de arriba.
      const piso = Math.max(pose ? hudG.bajo + 3 * P.u : P.top, pisoDeFichas());
      et.raiz.position.set(Math.max(mitad, Math.min(P.w - mitad, pan.x)), Math.max(piso + (et.h * e) / 2, pan.y - (et.h * e) / 2 - 3 * P.u));
      et.raiz.zIndex = f.peso + pan.y;
      // Con la cámara del director 3D, las llamas que quedan lejos no llevan ficha: las de menos del 6 % del alto de la pantalla (en la recta y en la
      // llegada por igual: con la cámara de la meta de antes el umbral de la llegada era del 12 %, y de costado el carril del fondo quedaba justo en él y su nombre parpadeaba).
      const enCabeza = t >= d.tCrown - LLEGADA_ANTES;
      const minAlto = 0.06 * P.h;
      // Y en la llegada no se etiqueta a una echada: una que quedó atrás a la vista tenía su ficha flotando atenuada sobre el horizonte.
      const sigueEnCarrera = !enCabeza || (d.tiempos.cae.get(f.persona) ?? Infinity) > t;
      et.raiz.visible = dentro && f.etiquetar && !f.sinLugar && sigueEnCarrera && (!pose || pan.alto >= minAlto);
      // Ningún letrero a la vista queda debajo de una ficha, ni de la amarilla (con su rótulo de la izquierda). Con `margen`, la caja del letrero se agranda
      // `MARGEN_LETRERO_X` altos de ficha a los costados y `MARGEN_LETRERO_Y` arriba y abajo; sin él, se tocan cuando se pisan más de un píxel.
      const fw = et.w * e, fh = et.h * e, izq = et.rotuloW * e;
      const sobreLetrero = (r: { x0: number; y0: number; x1: number; y1: number }, margen: boolean): boolean => {
        const mx = margen ? MARGEN_LETRERO_X * fh : -1, my = margen ? MARGEN_LETRERO_Y * fh : -1;
        return letreros.some((l) => r.x0 - izq < l.x1 + mx && r.x1 > l.x0 - mx && r.y0 < l.y1 + my && r.y1 > l.y0 - my);
      };
      const ancla = { x: Math.max(mitad, Math.min(P.w - mitad, pan.x)), y: pan.y - 3 * P.u };
      // La que ya está a la vista junto a un letrero no se corre de renglón: se desliza más despacio de lo que el letrero cruza la pantalla y le pasaría por
      // encima. Se calla, y vuelve donde haya lugar cuando ya se apagó.
      const mov = fichasMov.get(f.persona);
      if (et.raiz.visible && mov && mov.alfa > 0 && sobreLetrero({ x0: ancla.x + mov.ox - fw / 2, y0: ancla.y + mov.oy - fh / 2, x1: ancla.x + mov.ox + fw / 2, y1: ancla.y + mov.oy + fh / 2 }, true)) et.raiz.visible = false;
      if (et.raiz.visible) {
        const w = fw, h = fh, y0 = et.raiz.y;
        const caja = (dx: number, dy: number): { x0: number; y0: number; x1: number; y1: number; de: number } => ({ x0: et.raiz.x + dx - w / 2, y0: y0 + dy - h / 2, x1: et.raiz.x + dx + w / 2, y1: y0 + dy + h / 2, de: f.persona });
        const tapaLetrero = (r: { x0: number; y0: number; x1: number; y1: number }): boolean => sobreLetrero(r, true);
        const choca = (r: { x0: number; y0: number; x1: number; y1: number }): boolean => tapaLetrero(r) || puestas.some((b2) => b2.de !== f.persona && !(f.peso >= 3e6 && b2.cabeza) && r.x0 < b2.x1 - 1 && r.x1 > b2.x0 + 1 && r.y0 < b2.y1 - 1 && r.y1 > b2.y0 + 1);
        const paso = h + 2 * P.u;
        // Primero arriba de su cabeza; si ahí no cabe, un escalón más arriba o abajo, y después corrida medio ancho a un lado.
        let lugar: { dx: number; dy: number } | undefined;
        for (const dy of [0, -paso, -2 * paso, paso, 2 * paso]) {
          for (const dx of [0, -w * 0.5, w * 0.5]) {
            if (!lugar && !choca(caja(dx, dy)) && y0 + dy - h / 2 > piso - 1 && et.raiz.x + dx - w / 2 > 0 && et.raiz.x + dx + w / 2 < P.w) lugar = { dx, dy };
          }
        }
        if (!lugar && f.peso >= 3e6 && !tapaLetrero(caja(0, 0))) lugar = { dx: 0, dy: 0 };
        if (!lugar) et.raiz.visible = false;
        else {
          et.raiz.x += lugar.dx;
          et.raiz.y = y0 + lugar.dy;
          puestas.push(caja(0, lugar.dy));
        }
      }
      // Lo que decidió la colocación se aplica deslizando (M9), en píxeles de pantalla y sin el frente del grupo (la cámara lo lleva todo).
      if (!dentro && !fichasMov.has(f.persona)) {
        et.raiz.alpha = 1;
        et.raiz.visible = false;
      } else deslizarFicha(f.persona, et, ancla, et.raiz.visible && dentro, t, () => 0, cuerpoPx() * vz, { x0: 4 * P.u, x1: P.w - 4 * P.u, y0: piso, y1: P.bottom });
      // Lo que el deslizamiento todavía no corrió (un corte de cámara, un letrero que cruza más rápido que el margen) se calla en ese cuadro.
      if (et.raiz.visible && sobreLetrero({ x0: et.raiz.x - fw / 2, y0: et.raiz.y - fh / 2, x1: et.raiz.x + fw / 2, y1: et.raiz.y + fh / 2 }, false)) et.raiz.visible = false;
      if (auditarMarcha) fichas3Cuadro.push([f.persona, et.raiz.x, et.raiz.y, et.raiz.visible ? et.raiz.alpha : 0, pan.x, pan.y, et.raiz.scale.x, et.w * e, et.h * e, et.rotuloW * e]);
      if (medir && et.raiz.visible) medidas.push({ persona: f.persona, px: et.texto.style.fontSize as number * e, alto: et.h * e, ancho: et.w * e, x: et.raiz.x, y: et.raiz.y });
    }
    if (medir) {
      (window as unknown as { __fichas3d: unknown }).__fichas3d = medidas;
      // Para el auditor de nombres: cuántas fichas se pisan entre sí, cuántas tapan la cabeza de otra llama y cuántas llamas con nombre se quedaron sin ficha.
      const rects = medidas.map((m) => {
        const et = fichas.find((f) => f.persona === m.persona)!.et;
        return { persona: m.persona, x0: et.raiz.x - m.ancho / 2, x1: et.raiz.x + m.ancho / 2, y0: et.raiz.y - m.alto / 2, y1: et.raiz.y + m.alto / 2 };
      });
      let entreSi = 0, sobreCabeza = 0;
      rects.forEach((a, i) => {
        for (let j = i + 1; j < rects.length; j++) {
          const b2 = rects[j]!;
          if (a.x0 < b2.x1 - 1 && a.x1 > b2.x0 + 1 && a.y0 < b2.y1 - 1 && a.y1 > b2.y0 + 1) entreSi++;
        }
        for (const f of fichas) {
          if (f.persona === a.persona) continue;
          const pan = tres?.pantallaDe(f.persona);
          if (!pan || pan.x < 0 || pan.x > P.w) continue;
          const h = pan.alto * 0.3;
          if (a.x0 < pan.x + h && a.x1 > pan.x - h && a.y0 < pan.y + h && a.y1 > pan.y - h * 0.3) sobreCabeza++;
        }
      });
      const sinFicha = fichas.filter((f) => f.etiquetar && !f.sinLugar && !f.et.raiz.visible && (tres?.pantallaDe(f.persona)?.x ?? -1) > 0 && (tres?.pantallaDe(f.persona)?.x ?? -1) < P.w).length;
      (window as unknown as { __solapes3d: unknown }).__solapes3d = { fichas: rects.length, entreSi, sobreCabeza, sinFicha };
    }
  }

  /**
   * Dónde va la borla: sobre el lomo de quien va adelante, o volando de una a otra. En la de siempre la ficha amarilla pasa a la nueva dueña en el
   * instante en que cambia la marca (cuando el relator lo dice) y la borla, o el aro del 3D, se desliza hasta ella (`vuela`). En la nueva, el 3D
   * no vuela: la ficha y el aro pasan apenas cambia quién va adelante.
   */
  function posicionBorla(t: number, lider: number): { x: number; y: number; esc: number; duenia: number; pie: number; vuela?: boolean } | null {
    if (lider < 0) return null;
    const sobre = (q: number): { x: number; y: number; esc: number; duenia: number; pie: number; vuela?: boolean } => {
      const p = posicion(q, t);
      // La manta se apoya en el lomo, atrás del cuello: no tapa la cara de quien va primera.
      if (d.nueva) return { x: p.x + 8 * p.esc, y: p.y - 47 * p.esc, esc: p.esc, duenia: q, pie: p.y };
      return { x: p.x - 2 * p.esc, y: p.y - 70 * p.esc, esc: Math.max(p.esc * 1.25, 0.8 * P.u), duenia: q, pie: p.y };
    };
    const vuelo = d.nueva ? 0.3 : 0.45;
    const antes = estable(t - vuelo);
    if (antes < 0 || antes === lider || t - vuelo < d.tSalida) return sobre(lider);
    let a = t - vuelo, b = t;
    for (let i = 0; i < 6; i++) {
      const m = (a + b) / 2;
      if (estable(m) === lider) b = m;
      else a = m;
    }
    const e = ease((t - b) / vuelo);
    const A = sobre(antes), B = sobre(lider);
    return { x: lerp(A.x, B.x, e), y: lerp(A.y, B.y, e) - Math.sin(Math.PI * e) * (d.nueva ? 30 : 46) * P.u, esc: lerp(A.esc, B.esc, e), duenia: lider, pie: lerp(A.pie, B.pie, e), vuela: !d.nueva && e < 1 };
  }

  /* ---------------------------------------------------------------- cámara */
  // La carrera nueva deja aire adelante: la primera va a 0,72 del ancho y, cuando acelera o la alcanzan, entre 0,62 y 0,82. La cámara sigue
  // al frente del grupo (`xFrente`), no a la primera: es función de la hora, saltar da lo mismo.
  const camX = (t: number): number => xFrente(t) - ((d.nueva ? AIRE : forma.ancla / P.w) - 0.5) * P.w;
  /**
   * El corral. En el celular parado la tarjeta de nombres ocupa el cielo, arriba: la cámara baja el corral y lo achica lo justo (no menos de
   * 0,6) para que quede entero debajo de ella. La tarjeta nunca tapa una llama.
   */
  const vistaCorral: () => { x: number; y: number; z: number } = () => {
    const hc = altoTarjetaCorral();
    if (!hc) return { x: camX(d.tSalida), y: P.h / 2, z: 1 };
    const yTop = hudG.bajo + 8 * P.u + hc + 14 * P.u;
    const z = Math.max(0.6, Math.min(1, (P.bottom - yTop) / (forma.y1 - forma.y0 + 20 * P.u)));
    return { x: camX(d.tSalida), y: forma.y0 - 14 * P.u - (yTop - P.h / 2) / z, z };
  };
  /** Con tandas: el portón a 0,7 del ancho, la tanda que espera a la izquierda del portón y el corral a la derecha (los nombres, en el costado izquierdo). */
  const vistaTanda = (): { x: number; y: number; z: number } => (P.retrato ? { x: gateX + 0.05 * P.w, y: P.h / 2, z: 0.52 } : { x: gateX - 0.2 * P.w, y: P.h / 2, z: 1 });
  function vistaPresentacion(t: number) {
    const v = d.tandas.length ? vistaTanda() : vistaCorral();
    const e = ease(t / d.tVuelo);
    const xA = metaX - 0.3 * P.w;
    // La carrera nueva no deja la cámara quieta mientras se leen los nombres: un acercamiento lento (6 %) hasta la salida. Con dos personas el
    // corral era lo único en pantalla y pasaba de 4 s sin que nada cambiara (`audit-rigor`).
    const respira = d.nueva && !d.tandas.length ? 0.06 * suave((t - d.tVuelo) / Math.max(1, d.tSalida - d.tVuelo)) : 0;
    return { x: lerp(xA, v.x, e), y: lerp(P.h / 2, v.y, e), z: lerp(0.62, v.z, e) + respira };
  }
  function vistaGrupo(t: number) {
    const g = { x: camX(t), y: P.h / 2, z: 1 };
    if (!altoTarjetaCorral()) return g;
    // Pasa del corral bajo la tarjeta al plano de siempre sin sacudón: dos segundos, con la tarjeta ya apagada.
    const c = vistaCorral();
    const k = suave((t - d.tSalida) / 2.2);
    return { x: g.x, y: lerp(c.y, g.y, k), z: lerp(c.z, g.z, k) };
  }
  /** Los cuerpos (y sus nombres) de las ocho en la recta. */
  function cajaDeLasOcho(t: number, solo?: readonly number[]): Caja[] {
    const quienes = solo ?? d.lanes;
    return quienes.map((q) => cuerpoDe(posicion(q, Math.max(t, d.tAbre)), true, q));
  }
  function cajaCarriles(t: number): Caja {
    const cajas = cajaDeLasOcho(t);
    const x0 = Math.min(...cajas.map((c) => c.x)) - 24 * P.u;
    const x1 = Math.max(...cajas.map((c) => c.x + c.w)) + 24 * P.u;
    const ancho = Math.max(x1 - x0, 0.55 * P.w);
    return { x: x0 + (x1 - x0) / 2 - ancho / 2, y: carr.y0 - forma.altoNombre, w: ancho, h: carr.y1 - carr.y0 + forma.altoNombre + 16 * P.u };
  }
  /**
   * Los últimos 3 s del 2D: el cabeza a cabeza se mira de más cerca (`ACERCA_FINAL_2D` veces el plano general que traía), centrado en el grupo de
   * punta que había al empezar y no en una sola: el 2D no tiene plano de frente. Sin ficha amarilla ni manta (se apagan a la misma hora).
   */
  let finalZ0: number | null = null;
  let finalGrupo: number[] | null = null;
  function cajaFinalDelGrupo(t: number): Caja | null {
    const tF = d.tCrown - LLEGADA_ANTES;
    if (t < tF) return null;
    if (finalZ0 === null || finalGrupo === null) {
      finalZ0 = zoomDeCaja(unir(cajasDelFrentePrevias(tF)), zona(), 40);
      finalGrupo = grupoFinal2D(d.lanes.map((q) => ({ q, nariz: posicion(q, tF).x + LLAMA_HOCICO * posicion(q, tF).esc })));
    }
    const grupo = finalGrupo.map((q) => cuerpoDe(posicion(q, t), true, q));
    return cajaFinal2D(grupo, zona(), zoomFinal2D(finalZ0, t, tF), 40);
  }
  function cajasDelFrente(t: number): Caja[] {
    const t2 = Math.max(t, d.tAbre);
    const final = cajaFinalDelGrupo(t2);
    return final ? [final] : cajasDelFrentePrevias(t2);
  }
  function cajasDelFrentePrevias(t: number): Caja[] {
    const t2 = Math.max(t, d.tAbre);
    // En el celular entran las ocho: con el nombre a la izquierda, las de atrás se cortaban contra el borde.
    const orden = P.retrato ? d.lanes : [...new Set([...d.vivas(t2).slice(0, 3), ...enApuros(t2)])];
    const cajas = cajaDeLasOcho(t2, orden);
    const m = { x: metaX - 30 * P.u, y: carr.y0 - 40 * P.u, w: 60 * P.u, h: carr.y1 - carr.y0 + 50 * P.u };
    return metaCerca(t2) ? [...cajas, m] : cajas;
  }
  const metaCerca = (t: number): boolean => d.frac(t) >= 0.86;
  function meta(): Caja {
    // En los últimos 3 s la cámara se acerca al grupo: la meta tiene que seguir entrando a lo ancho, pero no de arriba a abajo de todos los carriles.
    if (finalGrupo && k.t >= d.tCrown - LLEGADA_ANTES) {
      const ys = finalGrupo.map((q) => posicion(q, k.t).y);
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      return { x: metaX - 100 * P.u, y: cy - 60 * P.u, w: 140 * P.u, h: 120 * P.u };
    }
    return { x: metaX - 100 * P.u, y: carr.y0 - 130 * P.u, w: 140 * P.u, h: carr.y1 - carr.y0 + 150 * P.u };
  }
  function zona(): Zona {
    return { x0: 0, y0: hudG.bajo, x1: P.w, y1: P.bottom };
  }
  function caja(_t: number): Caja | null {
    return null;
  }
  function foco(): FocoPunto {
    const pan = tres?.pantallaDe(d.campeona);
    if (pan) return { x: pan.x, y: pan.y + pan.alto * 0.5, r: pan.alto * 0.62, color: colorDeNombre(names[d.campeona] ?? "") };
    const p = posicion(d.campeona, d.tCrown);
    const c = cuerpoDe(p);
    const s = cam.toScreen(c.x + c.w / 2, c.y + c.h * 0.55, P.w, P.h);
    const z = cam.zoom || 1;
    return { x: s.x, y: s.y, r: Math.max(c.w, c.h) * 0.6 * z, color: colorDeNombre(names[d.campeona] ?? "") };
  }
  /** En qué punto de la pantalla está quien va adelante (la que lleva la borla; al final, la campeona): lo lee la prueba del niño. */
  function puntoDelFrente(t: number): { x: number; y: number } | null {
    const q = t >= d.tCrown ? d.campeona : d.duena(t);
    const p = posicion(q, t);
    if (!p.visible) return null;
    const c = cuerpoDe(p);
    return cam.toScreen(c.x + c.w / 2, c.y + c.h * 0.55, P.w, P.h);
  }
  function protegida(): { caja: Caja; zona: Zona } | null {
    const p = posicion(d.campeona, d.tCrown);
    const c = cuerpoDe(p, true);
    // Con el pelotón apretado en la línea, la que llega pegada a la ganadora tiene que quedar debajo del cartel, con su nombre entero:
    // la caja suma a la que cruza justo detrás, con el nombre. Las fichas de las demás no bajan del cartel (`pisoDeFichas`).
    const todas = d.lanes
      .filter((q) => q !== d.campeona)
      .map((q) => ({ q, p: posicion(q, d.tCrown) }))
      .sort((a, b) => b.p.x - a.p.x)
      .slice(0, PROTEGE_DETRAS)
      .map((o) => cuerpoDe(o.p, true, o.q));
    const cajas = [{ x: c.x, y: c.y + c.h * 0.2, w: c.w, h: c.h * 0.8 }, ...todas];
    const x0 = Math.min(...cajas.map((b) => b.x)), y0 = Math.min(...cajas.map((b) => b.y));
    const x1 = Math.max(...cajas.map((b) => b.x + b.w)), y1 = Math.max(...cajas.map((b) => b.y + b.h));
    return { caja: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, zona: { x0: 8 * P.u, y0: S.placaBajo(k.ganadores.length) + 4 * P.u, x1: P.w - 8 * P.u, y1: P.bottom } };
  }

  /* -------------------------------------------------------------- reconstruir */
  function reconstruir(): void {
    medirGeometria();
    cache.clear();
    corralMemo.clear();
    fichasMov.clear();
    caminata = null;
    for (const c of enUso.values()) c.etiqueta.clave = "";
    pintarCielo();
    pintarMarcas();
    pintarCinta();
    cartelClave = "";
    director3D = null;
    finalZ0 = null;
    finalGrupo = null;
    tres?.reconstruir(geometria3D());
  }

  /** El mundo 2D que el prototipo 3D tiene que vestir: lo mismo que pinta `pintarSuelo` y `pintarMarcas`. */
  function geometria3D(): Geometria3D {
    const zonas: ZonaSuelo[] = [{ desde: -1e9, hasta: 0, tipo: "corral", color: TERRENO_COLOR.corral, acento: TERRENO_ACENTO.corral }];
    d.tramos.forEach((tr, i) => zonas.push({ desde: i === 0 ? 0 : xDeT(tr.t0), hasta: xDeT(tr.t1), tipo: tr.terreno, color: TERRENO_COLOR[tr.terreno], acento: TERRENO_ACENTO[tr.terreno] }));
    zonas.push({ desde: d.tramos.length ? Xs : 0, hasta: 1e9, tipo: "recta", color: TERRENO_COLOR.recta, acento: TERRENO_ACENTO.recta });
    return {
      w: P.w, h: P.h, u: P.u, F0, Xs, metaX, gateX, y0: forma.y0, y1: forma.y1, carY0: carr.y0, carY1: carr.y1, carN: carr.n, zonas,
      pasoPostes: 0.2 * P.w, conPorton: d.tandas.length > 0, conPortonesRecta: d.tiempos.echadas.length > 0,
      corral: d.tandas.length ? -gateX + P.w * 0.7 : forma.profundidad + nombreW + 260 * P.u,
      rotuloMeta: k.txt("carRotuloMeta"), rotuloSalida: k.txt("carSalida").replace(/[¡!]/g, "").toUpperCase(),
      vallas: vallasDelPlan(),
    };
  }
  reconstruir();

  // El prototipo 3D: si no arranca (sin WebGL, sin memoria), el 2D sigue como siempre y no se entera.
  if (fabrica3d) {
    try {
      tres = fabrica3d({
        lienzoPixi: S.view,
        geometria: geometria3D,
        colores: (persona) => ({ pelaje: PELAJES[persona % PELAJES.length] ?? 0xf3ead8, manta: S.color(persona) }),
        auditar: auditaCon("3d"),
        tema: luz.tema,
      });
      // El foco de la corona, el del 3D: solo acá, con el 3D ya arrancado. Si no arrancó, queda el del 2D.
      S.focoSobreTres();
      // El estadio y las llamas del 2D se apagan; las fichas de nombre pasan a la pantalla, sobre el 3D.
      cielo.visible = false;
      suelo.visible = false;
      marcas.visible = false;
      porton.visible = false;
      corredoras.visible = false;
      borlaCapa.visible = false;
      // Las piedras, la ráfaga, las estelas y la raya del 2D están dibujadas con la cámara del 2D: sobre el 3D quedarían corridas. El 3D dibuja
      // las suyas (`carrera-3d-obstaculos.ts`, el aro del que va adelante).
      obstaculosG.visible = false;
      estelas.visible = false;
      raya.visible = false;
      // Las fichas van sobre el 3D y debajo de la capa `hud` del andamiaje: así no se van con ella cuando, en el celular, entra el cartel de quien
      // gana (la capa se desvanece), y los nombres de las que llegan detrás se siguen leyendo.
      const raiz = S.app.stage;
      raiz.addChildAt(etiquetas, Math.max(0, raiz.getChildIndex(S.hud)));
      S.onCleanup(() => {
        etiquetas.parent?.removeChild(etiquetas);
        tres?.destruir();
      });
    } catch (err) {
      console.warn('[3d] no arrancó, sigue el 2D', err);
      tres = null;
    }
  }

  // Para el auditor de emoción: dónde queda quien gana en la pantalla. Sin su nombre: desde el golpe la ficha se va (el cartel ya dice
  // quién gana), y lo que no puede cortar ni tapar el cartel es su cuerpo.
  S.ganadorEn(() => {
    // Con el prototipo 3D la llama se ve por su cámara: de la cabeza al pie, con un ancho parecido a su alto.
    const pan = tres?.pantallaDe(d.campeona);
    if (tres) return pan ? { x: pan.x - pan.alto * 0.55, y: pan.y, w: pan.alto * 1.1, h: pan.alto } : null;
    const c = cuerpoDe(posicion(d.campeona, d.tCrown));
    const a = cam.toScreen(c.x, c.y, P.w, P.h), b = cam.toScreen(c.x + c.w, c.y + c.h, P.w, P.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  });

  /**
   * `?auditar=encuadre`, para `scripts/audit-encuadre.mjs`, `medir-escala-carrera.mjs` y `medir-final-carrera.mjs --navegador`: cuadro a
   * cuadro, dónde cae en la pantalla el cuerpo de cada finalista (sin su nombre), dónde está el cartel del ganador, la caja del relator y
   * la tarjeta de nombres, y cuál va primera según lo dibujado y según el plan. Solo lee: el 2D y el 3D dejan lo mismo, y lo que se
   * dibuja es lo que se mide (en el 3D, la cabeza y el pie de cada llama por la cámara de ese cuadro). Sin el parámetro no existe.
   */
  const auditoria = auditaCon("encuadre")
    ? {
      n: d.n,
      motor: (tres ? "3d" : "2d") as "2d" | "3d",
      ganadora: d.lanes.indexOf(d.campeona),
      rival: d.final.story.rival,
      arco: d.final.story.arc,
      tAbre: d.tAbre,
      tCrown: d.tCrown,
      tSalida: d.tSalida,
      foto: d.final.foto,
      tGolpe: null as number | null,
      pantalla: { w: P.w, h: P.h, retrato: P.retrato },
      muestras: [] as unknown[],
      listo: false,
    }
    : null;
  if (auditoria) {
    (window as unknown as { __encuadre: typeof auditoria }).__encuadre = auditoria;
    // El show termina solo, pocos segundos después del golpe: cuando cierra, ya no hay nada más que anotar.
    S.onCleanup(() => {
      auditoria.listo = true;
    });
  }
  let auditoriaT = -1;
  /** El rectángulo de un elemento de la página, `[x, y, w, h]` en píxeles de la pantalla, o `null` si no se ve. */
  const rectDe = (el: Element | null): number[] | null => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05 ? [b.x, b.y, b.width, b.height] : null;
  };
  function anotarEncuadre(t: number): void {
    if (!auditoria || auditoria.listo) return;
    if (k.coronado && auditoria.tGolpe === null) auditoria.tGolpe = t;
    const dg = auditoria.tGolpe === null ? t - d.tCrown - 99 : t - auditoria.tGolpe;
    const enRecta = t >= d.tAbre - 1;
    // Antes de la recta no hace falta cada cuadro: la tarjeta de nombres se mide diez veces por segundo.
    if (!enRecta && Math.floor(t * 10) === auditoriaT) return;
    auditoriaT = Math.floor(t * 10);
    const vz = cam.zoom || 1;
    const fase = auditoria.tGolpe !== null ? "corona" : t >= d.tCrown ? "silencio" : d.final.story.arc === "duelo" && t >= d.tDeQ(d.final.foto) ? "foto" : t >= d.tAbre ? "recta" : t >= d.tSalida ? "grupo" : "antes";
    const tr = (window as unknown as { __tinkazo?: { cartel?: () => { x: number; y: number; w: number; h: number } | null } }).__tinkazo;
    const ct = tr?.cartel?.() ?? null;
    const fondo = cartel.visible && cartel.alpha > 0.05 ? cartelFondo.getBounds() : null;
    const m: Record<string, unknown> = {
      t: dg,
      tj: t,
      fase,
      z: vz,
      tarjeta: fondo && fondo.width > 0 ? [fondo.x, fondo.y, fondo.width, fondo.height] : null,
      tarjetaAlfa: cartel.visible ? cartel.alpha : 0,
    };
    if (enRecta) {
      const zn = zona();
      m.cajas = d.lanes.map((q) => {
        if (tres) {
          const pan = tres.pantallaDe(q);
          return pan ? [pan.x - pan.alto * 0.55, pan.y, pan.alto * 1.1, pan.alto] : null;
        }
        const c = cuerpoDe(posicion(q, t));
        const a = cam.toScreen(c.x, c.y, P.w, P.h), b = cam.toScreen(c.x + c.w, c.y + c.h, P.w, P.h);
        return [a.x, a.y, b.x - a.x, b.y - a.y];
      });
      // El hocico de cada una en el mundo, tal como se dibuja: de ahí sale quién va primera en pantalla.
      m.narices = d.lanes.map((q) => {
        const p = posicion(q, t);
        return p.x + LLAMA_HOCICO * p.esc;
      });
      m.lider = d.lanes.indexOf(d.lider(t));
      m.zona = [zn.x0, zn.y0, zn.x1 - zn.x0, zn.y1 - zn.y0];
      m.cartel = ct ? [ct.x, ct.y, ct.w, ct.h] : null;
      m.relator = rectDe(document.querySelector(".commentary"));
    }
    auditoria.muestras.push(m);
  }

  const escena: EscenaCarrera & { rebuild(): void; draw(t: number): void } = {
    rebuild: reconstruir,
    draw: (t) => {
      dibujar(t);
      anotarEncuadre(t);
    },
    vistaPresentacion,
    vistaGrupo,
    cajaCarriles,
    cajasDelFrente,
    caja,
    zona,
    meta,
    foco,
    protegida,
    puntoDelFrente,
  };
  return escena;
}

/** Parte un nombre en dos líneas por el espacio más cercano al medio. */
function partirEn2(nombre: string): string[] {
  const p = nombre.split(" ");
  if (p.length < 2) return [nombre];
  let mejor = 1, dif = Infinity;
  for (let i = 1; i < p.length; i++) {
    const a = p.slice(0, i).join(" ").length, b = p.slice(i).join(" ").length;
    if (Math.abs(a - b) < dif) {
      dif = Math.abs(a - b);
      mejor = i;
    }
  }
  return [p.slice(0, mejor).join(" "), p.slice(mejor).join(" ")];
}

export type Escena = ReturnType<typeof crearEscena>;

const definicion = (fabrica3d: Fabrica3D | null): DefJuego<Datos, Escena> => ({
  id: "race",
  textos: TEXTOS_CARRERA,
  // `?carrera=nueva`: la carrera nueva, hasta que pase las compuertas. Sin la bandera, la de siempre.
  plan: (ctx) => planCarrera(ctx, { nueva: params.get("carrera") === "nueva" }),
  arma(k, plan, previa) {
    if (!previa) return crearEscena(k, plan.datos, fabrica3d);
    previa.rebuild();
    return previa;
  },
  cuadro(_k, _plan, escena, t) {
    escena.draw(t);
  },
});

export const carreraPixi = crearJuego<Datos, Escena>(definicion(null));

/**
 * El prototipo en 3D (`?motor=3d`, docs/motores.md): el mismo juego, con el lienzo de PixiJS transparente y la vista 3D
 * debajo. `index.ts` la pide solo cuando `engine.ts` lo permite, y trae three.js recién ahí.
 */
export const carreraPixi3D = (fabrica: Fabrica3D) => crearJuego<Datos, Escena>(definicion(fabrica), {
  ...anfitrionTinkazo,
  montar: (baliza, listo, alSaltar, o) => mountPixi(baliza, listo, alSaltar, { music: o.musica, transparente: true }),
});
