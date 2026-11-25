import {
  CAPAS_SHOW,
  IDENTIDADES,
  IDENTIDADES_DEL_SELECTOR,
  MOVIMIENTO_DEL_SHOW,
  SEGUNDO_DEL_GOLPE,
  SEMILLA_DE_LA_ESCUCHA,
  HORA_DEL_SOLO_BOMBO,
  armarBanda,
  nivelDelShow,
  perfilDeIdentidad,
  rematDeHoyEn,
  tocarMusicaEn,
  type CapaShow,
  type IdentidadDelJuego,
} from "../music";
import { idiomaDeLaEscucha, nombreDeJuego, texto, type IdiomaEscucha } from "./escucha-textos";

/**
 * La página de escucha: las candidatas de música por juego, armadas con el secuenciador de
 * `src/music.ts` (síntesis, sin samples), con su ruleta de votos manual y sin prender nada en el sitio:
 * ninguna música nueva suena en producción hasta que el dueño la escuche y la elija acá.
 *
 * Está aparte del selector y de cualquier enlace del sitio: solo abre con `?escucha=1`, como la bandera
 * de `videoDescarga` en `src/flags.ts`. Por lo mismo no va en el build de producción: hay que sumarla a
 * `rollupOptions.input` de `vite.config.ts` cuando el dueño la pida en su máquina.
 */

/** Qué fase (o el show entero) se toca, con desde cuándo y cuánto dura, en segundos desde el inicio del show. */
export type FaseDeEscucha = CapaShow | "todo";

export function tramoDeFase(fase: FaseDeEscucha): { desde: number; dura: number } {
  const { espera, tension, remate, festejo } = MOVIMIENTO_DEL_SHOW;
  if (fase === "espera") return { desde: 0, dura: espera };
  if (fase === "tension") return { desde: espera, dura: tension };
  // El momento del ganador termina justo en el golpe: el remate entra con él en la pieza completa.
  if (fase === "remate") return { desde: espera + tension, dura: remate };
  if (fase === "festejo") return { desde: SEGUNDO_DEL_GOLPE, dura: festejo };
  return { desde: 0, dura: SEGUNDO_DEL_GOLPE + festejo };
}

/** La bandera de la página: sin `?escucha=1` el dueño ve solo la nota de que está apagada. */
export function escuchaPrendida(busqueda: string = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(busqueda).get("escucha") === "1";
}

/* ------------------------------------------------------- la ruleta de votos */

const CLAVE_VOTOS = "tinkazo.escucha.votos";
export type Votos = Record<string, number>;

/** El almacén donde viven los votos, o null en pruebas: cada votación se anota en este navegador, a mano. */
export const almacenDeVotos = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** Los votos de este navegador: {juego: cuenta}. */
export function votosDe(almacen: Storage | null = almacenDeVotos()): Votos {
  if (!almacen) return {};
  try {
    const crudo = almacen.getItem(CLAVE_VOTOS);
    if (!crudo) return {};
    const datos = JSON.parse(crudo) as unknown;
    if (!datos || typeof datos !== "object") return {};
    const votos: Votos = {};
    for (const [juego, n] of Object.entries(datos)) if (typeof n === "number" && n >= 0) votos[juego] = n;
    return votos;
  } catch {
    return {};
  }
}

/** Un voto más (o menos) para un juego, anotado en el almacén. Devuelve los votos de después. */
export function votar(juego: string, delta: 1 | -1, almacen: Storage | null = almacenDeVotos()): Votos {
  const votos = votosDe(almacen);
  const n = Math.max(0, (votos[juego] ?? 0) + delta);
  if (n === 0) delete votos[juego];
  else votos[juego] = n;
  try {
    almacen?.setItem(CLAVE_VOTOS, JSON.stringify(votos));
  } catch {
    /* que no se anote no rompe la escucha */
  }
  return votos;
}

/* --------------------------------------------------------------- el audio */

/**
 * Renderiza el tramo de una fase con la identidad del juego, en un contexto sin conexión: la misma banda y el
 * mismo secuenciador que la página (`tocarMusicaEn`), con el remate del ganador en el golpe cuando el tramo lo
 * toca. Devuelve null si este navegador no sabe renderizar (las pruebas corren sin audio).
 */
export async function renderizarFase(fase: FaseDeEscucha, id: IdentidadDelJuego): Promise<AudioBuffer | null> {
  const Offline = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return null;
  const { desde, dura } = tramoDeFase(fase);
  try {
    const ctx = new Offline(2, Math.ceil(44100 * dura), 44100);
    tocarMusicaEn(ctx, ctx.destination, {
      seed: SEMILLA_DE_LA_ESCUCHA,
      perfil: perfilDeIdentidad(id),
      segundos: dura,
      nivel: (t: number): number => nivelDelShow(t + desde),
      // Los últimos tres segundos del ganador son solo el bombo, como en el show (`musicFinal`).
      soloBomboDesde: HORA_DEL_SOLO_BOMBO >= desde ? HORA_DEL_SOLO_BOMBO - desde : undefined,
    });
    if (fase !== "espera" && fase !== "tension") rematDeHoyEn(armarBanda(ctx, ctx.destination, SEMILLA_DE_LA_ESCUCHA, 1), SEGUNDO_DEL_GOLPE - desde);
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

let suenaAhora: AudioBufferSourceNode | null = null;

let contextoDeEscucha: AudioContext | null = null;

/** Hace sonar un buffer ya renderizado, parando el anterior: una pieza a la vez, como en el parlante del stand. */
export function hacerSonar(buffer: AudioBuffer): boolean {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    if (!contextoDeEscucha) contextoDeEscucha = new Ctor();
    if (suenaAhora) {
      suenaAhora.stop();
      suenaAhora = null;
    }
    const src = contextoDeEscucha.createBufferSource();
    src.buffer = buffer;
    src.connect(contextoDeEscucha.destination);
    src.start();
    suenaAhora = src;
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- la página */

/** Calcula los votos de un juego con una orden de votación, para la tarjeta y para la prueba. */
export const votosDelJuego = (votos: Votos, juego: string): number => votos[juego] ?? 0;

export interface OpcionesEscucha {
  lang: IdiomaEscucha;
  prendida: boolean;
  votos: Votos;
  /** Anota un voto más y devuelve los votos nuevos. */
  votarMas: (juego: string) => Votos;
  /** Anota un voto menos y devuelve los votos nuevos. */
  votarMenos: (juego: string) => Votos;
  /** Renderiza y hace sonar una pieza (la página real); en pruebas siembra un aviso al llamar. */
  reproducir: (fase: FaseDeEscucha, juego: string) => void;
}

/** Arma la página entera en el documento. Es lo único que hace `escucha.ts` al cargar. */
export function armarEscucha(doc: Document, o: OpcionesEscucha): void {
  doc.title = texto(o.lang, "titulo");
  doc.documentElement.lang = o.lang;
  const raiz = doc.getElementById("escucha");
  if (!raiz) return;
  const t = (clave: Parameters<typeof texto>[1]): string => texto(o.lang, clave);

  if (!o.prendida) {
    raiz.innerHTML = `<p class="apagada">${t("apagada")}</p>`;
    return;
  }

  const encabezado = doc.createElement("header");
  encabezado.innerHTML = `<h1>${t("titulo")}</h1><p>${t("subtitulo")}</p><p class="nota">${t("notaSemilla")}</p><p class="nota">${t("etiquetaTexto")}</p><p class="aviso-sin-audio">${t("sinAudio")}</p>`;
  raiz.append(encabezado);
  // El adelgazado de capas nace apagado: desde acá se abre un show de prueba con él prendido para escucharlo.
  const prueba = doc.createElement("p");
  prueba.className = "nota";
  const enlace = doc.createElement("a");
  enlace.className = "prueba-adelgazado";
  enlace.href = `/?demo=race&lead=3&musicagracia=1${o.lang === "en" ? "&lang=en" : ""}`;
  enlace.textContent = t("probarAdelgazado");
  prueba.append(enlace);
  encabezado.append(prueba);

  let ponerTitulo = true;
  for (const id of Object.values(IDENTIDADES)) {
    // Los diez del selector van primero. Los que salieron de él, abajo y con su título.
    if (ponerTitulo && !IDENTIDADES_DEL_SELECTOR.includes(id.juego)) {
      ponerTitulo = false;
      const titulo = doc.createElement("p");
      titulo.className = "grupo";
      titulo.textContent = t("fueraDelSelector");
      raiz.append(titulo);
    }
    const nombre = nombreDeJuego(id.juego, o.lang);
    const tarjeta = doc.createElement("section");
    tarjeta.className = "tarjeta";
    tarjeta.dataset.juego = id.juego;

    const cabeza = doc.createElement("h2");
    cabeza.textContent = nombre;
    tarjeta.append(cabeza);

    const [largada, grupo, recta] = id.bpm;
    const datos = doc.createElement("p");
    datos.className = "datos";
    datos.textContent = `${t("tempo")}: ${largada} / ${grupo} / ${recta}`;
    tarjeta.append(datos);

    const etiquetas = doc.createElement("p");
    etiquetas.className = "etiquetas";
    etiquetas.innerHTML = `${t("ritmos")}: ${id.ritmos.map((r) => `<span class="chip">${r}</span>`).join(" ")}. ${t("instrumentos")}: ${id.instrumentos.map((d) => `<span class="chip">${d}</span>`).join(" ")}`;
    tarjeta.append(etiquetas);

    const capas = doc.createElement("div");
    capas.className = "capas";
    const capaTexto: Record<Exclude<FaseDeEscucha, "todo">, Parameters<typeof texto>[1]> = {
      espera: "capaEspera",
      tension: "capaTension",
      remate: "capaGanador",
      festejo: "capaFestejo",
    };
    for (const fase of [...CAPAS_SHOW, "todo"] as FaseDeEscucha[]) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "tocar";
      b.dataset.fase = fase;
      b.textContent = fase === "todo" ? `▶ ${t("btnTodo")}` : `▶ ${t(capaTexto[fase])}`;
      b.addEventListener("click", () => o.reproducir(fase, id.juego));
      capas.append(b);
    }
    tarjeta.append(capas);

    const ruleta = doc.createElement("div");
    ruleta.className = "ruleta";
    const cuenta = doc.createElement("span");
    cuenta.className = "votos";
    cuenta.textContent = `${votosDelJuego(o.votos, id.juego)} ${t("votos")}`;
    const mas = doc.createElement("button");
    mas.type = "button";
    mas.className = "voto-mas";
    mas.textContent = t("votar");
    const menos = doc.createElement("button");
    menos.type = "button";
    menos.className = "voto-menos";
    menos.textContent = t("quitar");
    const alVotar = (f: (juego: string) => Votos): void => {
      const nuevos = f(id.juego);
      cuenta.textContent = `${votosDelJuego(nuevos, id.juego)} ${t("votos")}`;
    };
    mas.addEventListener("click", () => alVotar(o.votarMas));
    menos.addEventListener("click", () => alVotar(o.votarMenos));
    ruleta.append(mas, cuenta, menos);
    tarjeta.append(ruleta);

    raiz.append(tarjeta);
  }
}

/** Lo que la página hace al cargar: medir la bandera, el idioma, los votos, y armar. */
export function montarEscucha(doc: Document): void {
  const lang = idiomaDeLaEscucha();
  armarEscucha(doc, {
    lang,
    prendida: escuchaPrendida(),
    votos: votosDe(),
    reproducir: (fase, juego) => {
      const id = IDENTIDADES[juego];
      if (!id) return;
      void renderizarFase(fase, id).then((buffer) => {
        if (buffer) hacerSonar(buffer);
      });
    },
    votarMas: (juego) => votar(juego, 1),
    votarMenos: (juego) => votar(juego, -1),
  });
}

if (typeof document !== "undefined" && document.getElementById("escucha")) montarEscucha(document);
