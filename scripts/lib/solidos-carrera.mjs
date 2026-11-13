/**
 * El adaptador de la carrera para el auditor de sólidos: arma, sin navegador, los cuerpos (cada llama, con la huella del 3D o la del 2D)
 * y los sólidos (las rocas y las matas de la lista, los postes del portón de la recta, la cerca del corral, las vallas y las piedras del
 * cerro) de una ronda, y los mide cuadro a cuadro a 60 por segundo con la geometría de `solidos.mjs`.
 *
 * La geometría es la de la escena sin Pixi (la misma que usa `carrera-caminata-datos.ts`): pantalla, forma del grupo y carriles, y el
 * lugar de cada llama sale de `crearTrayectorias`, el módulo puro que dibuja la escena. La huella es la del 3D, la más grande: atrás 36,
 * adelante 38, medio 13 y alto 100 del dibujo, por el tamaño de cada llama y por `TAM3D`, con el medio pasado al fondo del mundo 2D.
 *
 * Cada fila trae, además de los cuadros y el peor, dos columnas que no cambian el veredicto: los episodios (un par, una llama con
 * otra o con un sólido, que pasa el umbral en cuadros seguidos: si baja y vuelve a pasarlo es otro) y el más largo, en cuadros. Un
 * episodio que sigue abierto cuando la fila deja de mirar (se abre la recta, las finalistas pasan el portón o termina la ronda) se
 * cierra ahí y cuenta con lo que duró hasta entonces: lo que se vio, se vio, aunque la medida se corte. Las filas puntuales (los
 * cruces y las vallas) no tienen episodios: cada cruce y cada salto ya es uno.
 */
import { resolve } from "node:path";
import { rondaDe } from "./delatores-carrera.mjs";
import { contarCruces, encimado, encimadoCuerpos, UMBRALES } from "./solidos.mjs";

/** Las pantallas que mide el auditor sin navegador: el proyector, el escritorio, la tableta acostada y el celular parado. */
export const PANTALLAS_SOLIDOS = [[1366, 768], [1920, 1080], [844, 390], [390, 844]];

export async function cargarSolidos({ raiz = process.cwd() } = {}) {
  const { runnerImport } = await import("vite");
  const cargar = async (ruta) => (await runnerImport(resolve(raiz, ruta), { configFile: false, logLevel: "silent" })).module;
  const [show, trayectorias, rocas, forma, marcha, obstaculos, base, mapa, caminata, filas, vista, piedritas, tarjeta, letra, nombres] = await Promise.all([
    cargar("src/games/llamas/carrera-show.ts"),
    cargar("src/games/llamas/carrera-trayectorias.ts"),
    cargar("src/games/llamas/carrera-rocas.ts"),
    cargar("src/games/llamas/carrera-forma.ts"),
    cargar("src/games/llamas/carrera-marcha.ts"),
    cargar("src/games/llamas/carrera-obstaculos.ts"),
    cargar("src/games/llamas/carrera-base.ts"),
    cargar("src/games/llamas/carrera-3d-mapa.ts"),
    cargar("src/games/llamas/carrera-caminata.ts"),
    cargar("src/games/llamas/carrera-filas.ts"),
    cargar("src/games/llamas/carrera-obstaculos-vista.ts"),
    cargar("src/games/llamas/carrera-piedritas.ts"),
    cargar("src/games/llamas/carrera-tarjeta.ts"),
    cargar("src/games/pixi/kit/nombres.ts"),
    cargar("src/games/nombres.ts"),
  ]);
  return { planCarrera: show.planCarrera, ...trayectorias, ...rocas, ...forma, CUERPO: marcha.CUERPO, CARRIL_DURA: marcha.CARRIL_DURA, ENSANCHE: obstaculos.ENSANCHE, RECTA: base.RECTA, TAM3D: mapa.TAM3D, ZC: mapa.ZC, altoPostePorton: mapa.altoPostePorton, ...caminata, formaDelGrupo: filas.formaDelGrupo, crearVistaObstaculos: vista.crearVistaObstaculos, sembrarPiedritas: piedritas.sembrarPiedritas, descartarPiedritas: piedritas.descartarPiedritas, cajaDePatas: piedritas.cajaDePatas, crucesDe: piedritas.crucesDe, elegirTropiezo: piedritas.elegirTropiezo, victimaDelTropiezo: piedritas.victimaDelTropiezo, paresDelTropiezo: piedritas.paresDelTropiezo, piedritaEn: piedritas.piedritaEn, TROPIEZO_CABEZA: piedritas.TROPIEZO_CABEZA, alfabetico: base.alfabetico, tarjetaRetrato: tarjeta.tarjetaRetrato, minimoPx: letra.minimoPx, tamanoLetra: letra.tamanoLetra, planNombres: nombres.planNombres };
}

/**
 * La huella de una llama de tamaño `esc` en cada motor, en píxeles del mundo 2D: la caja en el piso (atrás, adelante y medio fondo) y el
 * alto. En el 3D, la de `PUNTOS_LLAMA` agrandada por `TAM3D`, con el fondo pasado del mundo 3D al 2D (`ZC`): es la más grande y la que
 * mide el auditor si no se le pide otra. En el 2D, de la cola al hocico del dibujo (`LLAMA_COLA` y `LLAMA_HOCICO`) y su alto (`LLAMA_ALTO`).
 */
export function huellaDe(M, motor, esc) {
  if (motor === "2d") return { atras: 26 * esc, adelante: 40 * esc, medio: 13 * esc, alto: 92 * esc };
  return { atras: 36 * esc * M.TAM3D, adelante: 38 * esc * M.TAM3D, medio: (13 * esc * M.TAM3D) / M.ZC, alto: 100 * esc * M.TAM3D };
}

/**
 * Una piedra del cerro (`Efecto3D.piedras`) como sólido de cada motor. En el 3D es una esfera de radio `r` por su tamaño: en el piso, la
 * elipse de la esfera pasada al mundo 2D. En el 2D es el dibujo plano de radio `r2`, con su sombra de medio radio de fondo y su alto.
 */
export function piedraComoSolido(M, motor, p) {
  if (motor === "2d") {
    const r = p.r2 * p.k, z0 = Math.max(0, p.alto - p.r);
    return { forma: "elipse", x: p.x, y: p.y, a: r, b: 0.5 * r, giro: 0, z0, z1: z0 + 1.64 * r };
  }
  const r = p.r * p.k;
  return { forma: "elipse", x: p.x, y: p.y, a: r, b: r / M.ZC, giro: 0, z0: p.alto - r, z1: p.alto + r };
}

const vacia = () => ({ cuadros: 0, peor: 0, ronda: 0, t: 0, quien: null, otro: null, episodios: 0, largo: 0 });
function anotar(f, valor, ronda, t, quien, otro) {
  if (valor > 0) f.cuadros++;
  if (valor > f.peor) Object.assign(f, { peor: valor, ronda, t, quien, otro });
}

/**
 * Lleva los episodios de una ronda. `marcar(fila, par, i)` se llama una vez por cuadro `i` en que el par pasa el umbral de esa fila:
 * si el mismo par lo había pasado en el cuadro anterior, el episodio sigue; si no, empieza uno nuevo.
 */
function crearEpisodios() {
  const abiertos = new Map();
  return (fila, par, i) => {
    let e = abiertos.get(fila)?.get(par);
    if (e && e.ultimo === i - 1) {
      e.ultimo = i;
      e.largo++;
    } else {
      if (!abiertos.has(fila)) abiertos.set(fila, new Map());
      abiertos.get(fila).set(par, (e = { ultimo: i, largo: 1 }));
      fila.episodios++;
    }
    if (e.largo > fila.largo) fila.largo = e.largo;
  };
}
/** La clave de un par de llamas, igual en los dos órdenes. */
const parDe = (p, q) => (p < q ? `${p}|${q}` : `${q}|${p}`);

/** Cuántas rocas y cuántas matas tiene una lista. */
export function contarRocas(rocas) {
  let r = 0, m = 0;
  for (const x of rocas) {
    if (x.tipo === "roca") r++;
    else m++;
  }
  return { rocas: r, matas: m };
}

/** Suma a `acumulado` (un Map por pantalla) las rocas y las matas de una ronda medida en `pantalla`. */
export function sumarRocas(acumulado, pantalla, { rocas, matas }) {
  const a = acumulado.get(pantalla) ?? { rondas: 0, rocas: 0, matas: 0 };
  acumulado.set(pantalla, { rondas: a.rondas + 1, rocas: a.rocas + rocas, matas: a.matas + matas });
}

/** Las rocas y las matas por ronda de cada pantalla, en el orden en que aparecieron. */
export function rocasPorRonda(acumulado) {
  return [...acumulado].map(([pantalla, a]) => ({ pantalla, rondas: a.rondas, rocas: a.rocas / a.rondas, matas: a.matas / a.rondas }));
}

/**
 * El alto de la tarjeta de nombres más alta de las tandas en un celular parado, como la arma la escena (`disenoTarjetaRetrato` y `hTarjeta` en
 * `carrera.ts`), con el ancho de los textos aproximado (un poco más de media letra por carácter): la tanda que corre va debajo de ella. La
 * misma cuenta que `altoTarjetaTandas` de `carrera-caminata-datos.ts`, acá con lo que tiene también una versión de antes. Fuera del celular
 * parado, o sin tandas, 0.
 */
export function altoTarjeta(M, d, P) {
  if (!P.retrato || !d.tandas.length) return 0;
  const formas = M.planNombres(d.names).formas;
  const minimo = M.minimoPx("nombre", P.w, P.h);
  return Math.max(...d.tandas.map((h) => {
    const ordenados = M.alfabetico(d.names, h.miembros);
    return M.tarjetaRetrato({
      textos: ordenados.map((i) => d.names[i] ?? ""),
      cortos: ordenados.map((i) => formas[i]?.[2] ?? d.names[i] ?? ""),
      medir: (texto, px) => texto.length * px * 0.56,
      w: P.w, h: P.h, u: P.u, pxNominal: Math.max(M.tamanoLetra("nombre", P.u), minimo), pxMinimo: minimo,
    }).h;
  }));
}

/** La geometría de una pantalla y la lista de rocas que le toca, con las trayectorias armadas. */
export function armarCarrera(M, d, W, H) {
  const u = W < H ? Math.min(W / 420, H / 900) : H / 720;
  const P = { w: W, h: H, u, retrato: W < H, top: 60 * u, bottom: H - 90 * u };
  const cuerpo = M.CUERPO * M.ENSANCHE * M.RECTA * W;
  // El grupo con las filas repartidas según el carril, como en la escena: la forma puede tener filas de más que la de siempre.
  const grupo = M.formaDelGrupo({ P, d, nombrePx: 16 * u, nombreW: 110 * u, cuerpoPx: cuerpo });
  const forma = grupo.forma;
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const carr = M.carrilesDe(P, d.lanes.length, 16 * u);
  const F0 = -(60 * u + M.LLAMA_HOCICO * forma.esc);
  const Xs = F0 + d.distAbre * W;
  const metaX = Xs + M.RECTA * W + M.LLAMA_HOCICO * carr.esc;
  const xDeT = (t) => F0 + d.dist(t) * W;
  let cam = null;
  // Las piedritas que se saltan: ninguna mientras se siembran las rocas, como en la escena; después, las que quedan.
  let piedritas = [];
  let tropiezo = null;
  const tr = M.crearTrayectorias(d, {
    F0, Xs, ancho: W, cuerpo, forma, carr, filaDeLugar: grupo.filaDeLugar,
    get caminata() {
      return cam;
    },
    get piedritas() {
      return piedritas;
    },
    get tropiezo() {
      return tropiezo;
    },
  });
  let ub = null;
  if (d.tandas.length) {
    ub = M.ubicarTandas({ P, forma, F0, tam: Math.max(...d.tandas.map((h) => h.miembros.length)), nombreW: 110 * u, hTarjeta: altoTarjeta(M, d, P) });
    // Como en la escena: cada una elige por dónde entra al corral mirando los lugares de las demás y de qué lado de su fila va.
    cam = M.crearCaminata(d.tandas, {
      cuerpo, arena: ub.formaArena, arenaX: ub.arenaX, gateX: ub.gateX, escCorral: forma.esc, retrato: P.retrato,
      corral: (p) => tr.lugarEnGrupo(p, d.tSalida) ?? { x: F0, y: forma.yPie(0) },
      lugar: typeof tr.sinCaminata === "function" ? (p, t) => tr.sinCaminata(p, t) : undefined,
      frente: typeof tr.frente === "function" ? (t) => tr.frente(t) : undefined,
      abre: d.tAbre,
      subfila: (p) => tr.signoDe(p) * tr.delta(),
    }, { llegarAntesDe: d.tSalida + M.LLEGADA_TARDE - 0.1 });
  }
  const zonas = [{ desde: -1e9, hasta: 0, tipo: "corral" }];
  d.tramos.forEach((tramo, i) => zonas.push({ desde: i === 0 ? 0 : xDeT(tramo.t0), hasta: xDeT(tramo.t1), tipo: tramo.terreno }));
  zonas.push({ desde: d.tramos.length ? Xs : 0, hasta: 1e9, tipo: "recta" });
  // La lista de rocas: desde el paso de la siembra nueva sale de la semilla de la ronda y de las trayectorias; antes, la de siempre.
  let rocas;
  if (typeof M.sembrarRocas === "function" && d.semillaRocas !== undefined) {
    const muestras = tr.muestras(d.tSalida, M.finDeLaSiembra ? M.finDeLaSiembra(d) : d.tAbre, 1 / 30);
    rocas = M.sembrarRocas({
      semilla: d.semillaRocas,
      zonas: d.tramos.map((tramo, i) => ({ desde: i === 0 ? 0 : xDeT(tramo.t0), hasta: xDeT(tramo.t1), tipo: tramo.terreno })),
      filasY: Array.from({ length: forma.filas }, (_, f) => forma.yPie(f)),
      y0: forma.y0, y1: forma.y1,
      huella: { atras: 36 * forma.esc * M.TAM3D, adelante: 38 * forma.esc * M.TAM3D, medio: (13 * forma.esc * M.TAM3D) / M.ZC, alto: 100 * forma.esc * M.TAM3D },
      cuerpo,
      esc: forma.esc,
      muestras,
      echadas: d.tiempos.echadas.map((e) => ({ quien: e.quien, t: e.t })),
      bandas: typeof tr.bandas === "function" ? tr.bandas() : undefined,
    });
  } else {
    rocas = M.rocasDeHoy({ zonas, y0: forma.y0, y1: forma.y1, u, F0, corral: forma.profundidad + 110 * u + 260 * u, metaX });
  }
  // Las piedritas, con la misma cuenta que la escena (`carrera.ts`, `listaRocas`): se siembran y se tira la que alguien pisaría sin saltar.
  if (typeof M.sembrarPiedritas === "function" && d.semillaRocas !== undefined) {
    const zonasG = d.tramos.map((tramo, i) => ({ desde: i === 0 ? 0 : xDeT(tramo.t0), hasta: xDeT(tramo.t1), tipo: tramo.terreno }));
    const candidatas = M.sembrarPiedritas({
      semilla: d.semillaRocas, zonas: zonasG, filasY: Array.from({ length: forma.filas }, (_, f) => forma.yPie(f)),
      esc: forma.esc, cuerpo, profundidad: forma.profundidad,
      velocidades: d.tramos.map((tramo, i) => ((zonasG[i]?.hasta ?? 0) - (zonasG[i]?.desde ?? 0)) / Math.max(1e-9, tramo.t1 - tramo.t0)),
    });
    piedritas = candidatas;
    const conBrincos = tr.muestras(d.tSalida, M.finDeLaSiembra ? M.finDeLaSiembra(d) : d.tAbre, 1 / 30);
    piedritas = M.descartarPiedritas(candidatas, conBrincos);
    // El tropiezo, como en la escena: el de la víctima del plan (de la semilla, sin la pantalla), si en esta pantalla cruza su piedrita.
    if (typeof M.elegirTropiezo === "function") {
      const victima = M.victimaDelTropiezo({ semilla: d.semillaRocas, tramos: d.tramos, gente: d.gente, cae: (p) => d.tiempos.cae.get(p) ?? Infinity });
      tropiezo = M.elegirTropiezo(
        { semilla: d.semillaRocas, piedritas, rocas, altoFila: forma.altoFila, muestras: conBrincos, desde: d.tSalida, paso: 1 / 30, victima },
        M.crucesDe(piedritas, conBrincos, d.tSalida, 1 / 30),
      );
    }
  }
  // Lo que se ve de los obstáculos de la recta, con la misma geometría que la escena (`carrera.ts`): de ahí salen las piedras del cerro.
  const vista = M.crearVistaObstaculos?.(d, {
    xs: Xs, largo: M.RECTA * W, ancho: W, esc: carr.esc, u, altoFila: carr.altoFila,
    yPie: (k) => carr.yPie(k), piso: (k, t) => tr.piso(k, t), escEn: (k, t) => tr.escEn(k, t),
  }) ?? null;
  return { P, u, forma, carr, F0, Xs, metaX, tr, rocas, zonas, vista, piedritas, tropiezo, ub, cam };
}

/**
 * Mide una ronda en una pantalla y devuelve sus filas: cuántos cuadros se enciman, el peor, la hora y quién, y los episodios. Si
 * recibe `info`, le deja cuántas rocas y cuántas matas tiene la lista de la ronda. Con `motor: "2d"` mide con la huella y las piedras
 * del 2D; si no, con las del 3D, que son las más grandes. Las rocas se siembran igual en los dos: la escena las siembra con la huella del 3D.
 */
export function medirRondaSolidos(M, d, W, H, ronda = 0, info = null, { motor = "3d" } = {}) {
  const { u, forma, carr, Xs, tr, rocas, vista, piedritas, tropiezo, ub, cam } = armarCarrera(M, d, W, H);
  if (info) info.tropiezo = !!tropiezo;
  if (info) Object.assign(info, contarRocas(rocas));
  const filas = {
    "llama-roca": vacia(), "llama-mata": vacia(), "llama-poste": vacia(), "llama-cerca": vacia(),
    "llama-valla sin permiso": vacia(), "llama-echada": vacia(), "echada-echada": vacia(), "llama-llama en el grupo": vacia(),
    "llama-llama al pasar a los carriles": vacia(), "choques que pasan su máximo": vacia(), "saltos que no saltan": vacia(),
    "llama-piedra del cerro": vacia(), "llama-piedrita": vacia(), "cruces": vacia(),
    "llama-llama en el corral antes de la salida": vacia(), "llama-llama en las tandas": vacia(), "llama-echada en las tandas": vacia(),
  };
  const episodio = crearEpisodios();
  if (ub) medirTandas(M, d, ub, cam, motor, ronda, filas, episodio);
  const personas = [...new Set([...d.gente, ...d.lanes])];
  const muestras = tr.muestras(d.tSalida, d.tCrown, 1 / 60);
  const N = (muestras.get(personas[0])?.length ?? 0) / 4;
  const cae = (p) => d.tiempos.cae.get(p) ?? Infinity;
  const cuerpoDe = (p, a, i) => {
    const h = huellaDe(M, motor, a[i * 4 + 3]);
    return { x: a[i * 4], y: a[i * 4 + 1], atras: h.atras, adelante: h.adelante, medio: h.medio, z0: a[i * 4 + 2], z1: a[i * 4 + 2] + h.alto };
  };
  // Los postes del portón de la recta y la cerca del corral, como cajas.
  const postes = [];
  if (d.tiempos.echadas.length) {
    const altoFilaCarr = (carr.y1 - carr.y0) / Math.max(1, carr.n);
    for (let j = 0; j <= carr.n; j++) postes.push({ forma: "caja", x0: Xs - 3 * u, x1: Xs + 3 * u, y0: carr.y0 + j * altoFilaCarr - 2.5 * u, y1: carr.y0 + j * altoFilaCarr + 2.5 * u, z0: 0, z1: 39 * u, interno: j > 0 });
  }
  const cercas = [
    { forma: "caja", x0: -1e6, x1: 0, y0: forma.y0 - 14 * u - 2.5 * u, y1: forma.y0 - 14 * u + 2.5 * u, z0: 0, z1: 48 * u },
    { forma: "caja", x0: -1e6, x1: 0, y0: forma.y1 + 8 * u - 2.5 * u, y1: forma.y1 + 8 * u + 2.5 * u, z0: 0, z1: 48 * u },
  ];
  const vallas = (d.final.obstaculos ?? []).filter((o) => o.tipo === "salto").map((o) => ({
    x: Xs + o.valla * M.RECTA * W, malas: new Set(o.malas), llegan: o.llegan,
    solido: { forma: "caja", x0: Xs + o.valla * M.RECTA * W - 3.9 * u, x1: Xs + o.valla * M.RECTA * W + 3.9 * u, y0: carr.y0, y1: carr.y1, z0: 0, z1: 0.34 * carr.altoFila },
  }));
  const rocasPorX = [...rocas].sort((a, b) => a.x - b.x);
  for (let i = 0; i < N; i++) {
    const t = d.tSalida + i / 60;
    const cuerpos = new Map(personas.map((p) => [p, cuerpoDe(p, muestras.get(p), i)]));
    // Rocas y matas: toda la carrera, a todas, también a la echada mientras se desliza y después, quieta. Antes se dejaba de mirar al
    // abrirse la recta, y el auditor con navegador encontró a una finalista que todavía cruzaba el pedregal mientras pasaba a su carril,
    // dentro de una roca. Las rocas están solo en sus tramos: lo lejos se salta por x.
    {
      for (const p of personas) {
        const c = cuerpos.get(p);
        for (let k = 0; k < rocasPorX.length; k++) {
          const r = rocasPorX[k];
          if (r.x + Math.max(r.a, r.b) < c.x - c.atras) continue;
          if (r.x - Math.max(r.a, r.b) > c.x + c.adelante) break;
          if (Math.abs(r.y - c.y) > Math.max(r.a, r.b) + c.medio) continue;
          const valor = encimado(c, { forma: "elipse", ...r, z0: 0, z1: r.alto });
          if (valor > UMBRALES.solido) {
            const fila = filas[r.tipo === "roca" ? "llama-roca" : "llama-mata"];
            anotar(fila, valor, ronda, t, p, null);
            episodio(fila, `${p}|r${k}`, i);
          }
        }
      }
    }
    // Las piedritas que se saltan: es un salto, así que no se les permite nada. Como la piedrita queda debajo de la panza, lo que la puede
    // tocar son las patas: se mira la caja de las patas del 3D (la más grande) a la altura del brinco, contra todas, mientras dura el grupo.
    // La del tropiezo se mira donde está a cada hora (sale despedida), y a la víctima, en su tropezón, se le permite un golpe de hasta el 35 %.
    if (piedritas?.length && t < d.tAbre) {
      for (const p of personas) {
        const a = muestras.get(p);
        if (!a) continue;
        const x = a[i * 4], y = a[i * 4 + 1], alza = a[i * 4 + 2], esc = a[i * 4 + 3];
        for (const [k, r0] of piedritas.entries()) {
          const pr = M.piedritaEn ? M.piedritaEn(r0, tropiezo, k, t, forma.altoFila) : r0;
          const r = { ...r0, x: pr.x, y: pr.y };
          if (Math.abs(r.x - x) > r.a + 120 * esc || alza >= r.alto) continue;
          const c = M.cajaDePatas(x, y, esc);
          const valor = encimado({ x, y, atras: x - c.x0, adelante: c.x1 - x, medio: y - c.y0, z0: alza, z1: alza + 1e6 }, { forma: "elipse", ...r, z0: 0, z1: r.alto });
          if (!(valor > 0)) continue;
          if (tropiezo && tropiezo.quien === p && tropiezo.piedrita === k && t > tropiezo.t - 0.2 && t < tropiezo.t + M.TROPIEZO_CABEZA) {
            if (valor > UMBRALES.choque) anotar(filas["choques que pasan su máximo"], valor, ronda, t, p, null);
            continue;
          }
          anotar(filas["llama-piedrita"], valor, ronda, t, p, null);
          episodio(filas["llama-piedrita"], `${p}|p${k}`, i);
        }
      }
    }
    // La echada: la que sigue corriendo contra la que descansa.
    const descansan = personas.filter((p) => cae(p) <= t);
    if (descansan.length) {
      for (const p of personas) {
        if (cae(p) <= t) continue;
        const c = cuerpos.get(p);
        for (const e of descansan) {
          const ce = cuerpos.get(e);
          if (Math.abs(c.x - ce.x) > c.adelante + ce.atras + 4) continue;
          const valor = encimadoCuerpos(c, ce);
          if (valor > UMBRALES.cuerpo) {
            anotar(filas["llama-echada"], valor, ronda, t, p, e);
            episodio(filas["llama-echada"], `${p}|${e}`, i);
          }
        }
      }
    }
    // Echada contra echada: dos que descansan, mientras dura el grupo. Ningún par de esta fila entra en otra: llama-echada es la que
    // corre contra la que descansa, y llama contra llama mira solo a las que corren.
    if (t < d.tAbre && descansan.length > 1) {
      const quietas = descansan.map((p) => [p, cuerpos.get(p)]).sort((a, b) => a[1].x - b[1].x);
      for (let a = 0; a < quietas.length; a++) {
        for (let b = a + 1; b < quietas.length; b++) {
          const [p, c] = quietas[a], [q, cq] = quietas[b];
          if (cq.x - cq.atras > c.x + c.adelante) break;
          const valor = encimadoCuerpos(c, cq);
          if (valor <= UMBRALES.cuerpo) continue;
          anotar(filas["echada-echada"], valor, ronda, t, p, q);
          episodio(filas["echada-echada"], parDe(p, q), i);
        }
      }
    }
    // Cuerpo contra cuerpo: en el grupo, y aparte al pasar a los carriles.
    const enCarriles = t >= d.tCarriles;
    const lista = personas.filter((p) => cae(p) > t).map((p) => [p, cuerpos.get(p)]).sort((a, b) => a[1].x - b[1].x);
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
        const [p, c] = lista[a], [q, cq] = lista[b];
        if (cq.x - cq.atras > c.x + c.adelante) break;
        const valor = encimadoCuerpos(c, cq);
        if (valor <= UMBRALES.cuerpo) continue;
        const clave = enCarriles && d.lanes.includes(p) && d.lanes.includes(q) ? "llama-llama al pasar a los carriles" : "llama-llama en el grupo";
        if (clave === "llama-llama en el grupo" && t >= d.tAbre) continue;
        anotar(filas[clave], valor, ronda, t, p, q);
        episodio(filas[clave], parDe(p, q), i);
      }
    }
    // Las piedras del cerro, en la recta: cada piedra que se ve contra cada finalista, también la víctima. Son las mismas que dibujan
    // el 2D y el 3D (`Efecto3D.piedras`), cada una con su tamaño en el motor que se mide.
    if (vista && t >= d.tAbre) {
      for (const f of vista.efectos(t)) {
        if (f.tipo !== "piedras" || !f.piedras) continue;
        f.piedras.forEach((pd, j) => {
          if (!pd.visible) return;
          const s = piedraComoSolido(M, motor, pd);
          for (const p of d.lanes) {
            const c = cuerpos.get(p);
            if (!c) continue;
            const valor = encimado(c, s);
            if (valor > UMBRALES.solido) {
              anotar(filas["llama-piedra del cerro"], valor, ronda, t, p, null);
              episodio(filas["llama-piedra del cerro"], `${p}|c${f.id}.${j}`, i);
            }
          }
        });
      }
    }
    // Los postes del portón, cuando las finalistas cruzan a la recta.
    if (postes.length && t > d.tCarriles && t < d.tDeQ(0.25)) {
      for (const p of d.lanes) {
        const c = cuerpos.get(p);
        if (!c) continue;
        postes.forEach((s, j) => {
          const alto = s.interno && M.altoPostePorton ? M.altoPostePorton(t, d.tAbre) * 30 * u : s.z1;
          const valor = encimado(c, { ...s, z1: alto });
          if (valor > UMBRALES.solido) {
            anotar(filas["llama-poste"], valor, ronda, t, p, null);
            episodio(filas["llama-poste"], `${p}|${j}`, i);
          }
        });
        cercas.forEach((s, j) => {
          const valor = encimado(c, s);
          if (valor > UMBRALES.solido) {
            anotar(filas["llama-cerca"], valor, ronda, t, p, null);
            episodio(filas["llama-cerca"], `${p}|${j}`, i);
          }
        });
      }
    }
  }
  // Los cruces del paso a los carriles: pares de finalistas cuyo orden de lado al empezar el paso difiere del de al terminar.
  // En esta fila, `cuadros` cuenta pares cruzados y `peor` es la peor ronda, también en pares.
  {
    const ladoEn = (t) => d.lanes.map((p) => tr.posicion(p, t).y);
    const cruces = contarCruces(ladoEn(d.tCarriles), ladoEn(d.tCarriles + M.CARRIL_DURA));
    if (cruces > 0) {
      filas.cruces.cuadros += cruces;
      if (cruces > filas.cruces.peor) Object.assign(filas.cruces, { peor: cruces, ronda, t: d.tCarriles });
    }
  }
  // Las vallas, en el instante en que cada carril la cruza: quien salta tiene que pasar por encima; a quien salta mal le está
  // permitido un choque de hasta el 35 %.
  for (const v of vallas) {
    d.lanes.forEach((p, k) => {
      const tLlega = d.tDeQ(v.llegan[k] ?? 0);
      const pos = tr.posicion(p, tLlega);
      const h = huellaDe(M, motor, pos.esc);
      const c = { x: pos.x, y: pos.y, atras: h.atras, adelante: h.adelante, medio: h.medio, z0: pos.alza ?? 0, z1: (pos.alza ?? 0) + h.alto };
      const valor = encimado(c, v.solido);
      if (valor <= UMBRALES.solido) return;
      if (v.malas.has(k)) {
        if (valor > UMBRALES.choque) anotar(filas["choques que pasan su máximo"], valor, ronda, tLlega, p, null);
      } else anotar(filas["saltos que no saltan"], valor, ronda, tLlega, p, null);
    });
  }
  return filas;
}

/**
 * Dónde está `persona` de la tanda `h` antes de la salida, con la cuenta de la escena de antes de `enTanda` (aparece 0,2 s antes de su cartel y
 * la echada se va 1,2 s después de que termina su tanda): para medir con estas mismas filas una versión que todavía no la tenía.
 */
function enTandaDeAntes(h, persona, t, arena, arenaX, cam) {
  if (t < h.t0 - 0.2) return { que: "oculta" };
  const s = arena.slot(h.miembros.indexOf(persona));
  const lugar = { x: arenaX - s.dx, y: arena.yPie(s.fila), esc: arena.esc, avance: 0 };
  const j = h.pasan.indexOf(persona);
  if (j < 0) {
    if (t >= h.tFin + 1.2) return { que: "oculta" };
    return t >= h.tCierra ? { que: "echada", ...lugar, desde: h.tCierra } : { que: "espera", ...lugar, desde: h.t0 };
  }
  if (t < h.salidas[j]) return { que: "espera", ...lugar, desde: h.t0 };
  const w = cam?.en(persona, t);
  if (!w) return { que: "oculta" };
  return { que: w.camina ? "camina" : "corral", x: w.x, y: w.y, esc: w.esc, desde: h.salidas[j], avance: w.avance };
}

/**
 * Las tandas, antes de la salida del grupo, con la misma cuenta que dibuja la escena (`enTanda`): de la primera tanda a la salida, a 60 cuadros
 * por segundo. Tres filas, las tres desde el 10 % (la misma cuenta que la de en el grupo, que empieza en la salida) y las tres para el veredicto:
 * dos que ya cruzaron el portón (las que caminan al corral y las que ya están en él) una contra otra (llama-llama en el corral antes de la
 * salida); las demás de pie de las tandas una contra otra (llama-llama en las tandas: la que sale contra las que esperan y contra otra que
 * sale), sin las que esperan entre ellas, que están casi pegadas a propósito; y las de pie contra las que no pasaron y están echadas en su
 * lugar (llama-echada en las tandas). Antes se medía solo desde la salida.
 */
function medirTandas(M, d, ub, cam, motor, ronda, filas, episodio) {
  const tandaDe = new Map();
  d.tandas.forEach((h, k) => h.miembros.forEach((m) => tandaDe.set(m, k)));
  const todas = [...tandaDe.keys()];
  const enTanda = typeof M.enTanda === "function" ? M.enTanda : enTandaDeAntes;
  const t0 = Math.min(...d.tandas.map((h) => h.t0)) - (M.ANTES_DEL_CARTEL ?? 0.2);
  const N = Math.max(0, Math.ceil((d.tSalida - t0) * 60));
  for (let i = 0; i < N; i++) {
    const t = t0 + i / 60;
    const paradas = [];
    const echadas = [];
    for (const p of todas) {
      const k = tandaDe.get(p);
      const e = enTanda(d.tandas[k], p, t, ub.formaArena, ub.arenaX, cam, d.tandas[k - 1]);
      if (e.que === "oculta") continue;
      const h = huellaDe(M, motor, e.esc);
      const c = { x: e.x, y: e.y, atras: h.atras, adelante: h.adelante, medio: h.medio, z0: 0, z1: h.alto };
      if (e.que === "echada") echadas.push([p, c]);
      else paradas.push([p, c, e.que === "espera", e.x >= ub.gateX]);
    }
    paradas.sort((a, b) => a[1].x - b[1].x);
    for (let a = 0; a < paradas.length; a++) {
      for (let b = a + 1; b < paradas.length; b++) {
        const [p, c, esperaP, cruzoP] = paradas[a], [q, cq, esperaQ, cruzoQ] = paradas[b];
        if (cq.x - cq.atras > c.x + c.adelante) break;
        if (esperaP && esperaQ) continue;
        const valor = encimadoCuerpos(c, cq);
        if (valor <= UMBRALES.cuerpo) continue;
        const fila = filas[cruzoP && cruzoQ ? "llama-llama en el corral antes de la salida" : "llama-llama en las tandas"];
        anotar(fila, valor, ronda, t, p, q);
        episodio(fila, `t${parDe(p, q)}`, i);
      }
    }
    for (const [p, c] of paradas) {
      for (const [e, ce] of echadas) {
        if (Math.abs(c.x - ce.x) > c.adelante + ce.atras + 4) continue;
        const valor = encimadoCuerpos(c, ce);
        if (valor <= UMBRALES.cuerpo) continue;
        anotar(filas["llama-echada en las tandas"], valor, ronda, t, p, e);
        episodio(filas["llama-echada en las tandas"], `t${p}|${e}`, i);
      }
    }
  }
}

/** La ronda `i` con `n` personas, medida en la pantalla `W` por `H` con la huella de `motor`, con cuántas rocas y matas tiene su lista. */
export function medirRonda(M, lib, n, i, W, H, { motor = "3d" } = {}) {
  const { ctx } = rondaDe(lib, n, i);
  const d = M.planCarrera(ctx).datos;
  const rocas = {};
  return { datos: d, filas: medirRondaSolidos(M, d, W, H, i, rocas, { motor }), rocas };
}
