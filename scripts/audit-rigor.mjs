#!/usr/bin/env node
/**
 * El auditor exigente.
 *
 * `audit-game.mjs` comprueba que el juego no decida nada y que el sorteo cierre.
 * Este mira lo que `docs/juegos.md` dejaba en "lo que el auditor no puede ver",
 * y que hasta ahora dependía de que alguien lo mirara a ojo antes de subir:
 *
 *   - que la misma ronda dibuje **los mismos cuadros**, no una animación
 *     parecida: la promesa de que el recorrido es reproducible;
 *   - que ningún juego toque `Math.random()`;
 *   - que nunca pasen más de cuatro segundos sin que cambie la pantalla, y que
 *     haya un hecho nuevo cada dos segundos y medio;
 *   - que no haya cuadros vacíos, que corra fluido, y que el cartel del ganador
 *     se lea desde el fondo de la sala;
 *   - que saltar en cualquier momento cierre, que al terminar no quede nada
 *     corriendo, y que la duración elegida se cumpla.
 *
 * Cómo lo logra: antes de que cargue la página se cambia el reloj. Cada cuadro
 * de animación avanza exactamente un sesentavo de segundo, sin importar cuánto
 * tardó de verdad, y la huella de la pantalla se toma adentro de la página cada
 * seis cuadros. Así dos corridas se comparan cuadro contra cuadro, y lo que se
 * mide no depende de lo cargada que esté la máquina que audita.
 *
 * Corre sin red: usa la escena fija de `?pose=<juego>`, con una ronda de
 * verdad ya cerrada.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-rigor.mjs [juego|todos] [--base http://localhost:4173]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const TODOS = ["race", "stellar", "ledger", "pasanaku", "teleferico", "tombola", "rockets", "wheel"];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--base" && args[args.indexOf(a) - 1] !== "--out") ?? "todos";
const juegos = cual === "todos" ? TODOS : [cual];
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas/rigor");

/** Lo que el selector de duración promete, en segundos. Debe coincidir con `PACES`. */
const PACES = { rapido: 20, normal: 30, epico: 42 };

/**
 * El reloj virtual avanza de a 1/64 de segundo, no 1/60. Un sesentavo no es
 * exacto en binario: sumado cuadro a cuadro, la resta entre dos marcas de
 * tiempo dependía de en qué instante del reloj arrancaba el juego, y en un
 * juego con física eso movía un píxel de vez en cuando entre dos corridas. Un
 * sesenta y cuatroavo es exacto, y las restas dan siempre lo mismo.
 */
const HZ = 64;
/** Cada cuántos cuadros se toma la huella: 6 cuadros son casi 0,1 s de juego. */
const CADA = 6;
const SEG_POR_MUESTRA = CADA / HZ;

/**
 * Se inyecta antes que cualquier script de la página.
 *
 * `requestAnimationFrame` deja de entregar la hora real: entrega un reloj que
 * avanza 1/60 s por cuadro. `performance.now()` devuelve lo mismo, porque la
 * carrera lo lee directo. Un bombeo con el rAF de verdad es el que despacha los
 * cuadros, así que la página sigue pintando y se la puede mirar.
 */
const PRELUDIO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const STEP = 1000 / ${HZ};
  let virt = 0, id = 0;
  const cbs = new Map();
  const tk = {
    virt: () => virt, pend: () => cbs.size, pendAntes: 0, frames: 0, reales: [],
    randoms: 0, muestras: [], carteles: [], errores: [], visto: false, cerro: -1,
    hechos: [], f0: -1,
  };
  window.__tk = tk;
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;

  const r0 = Math.random;
  Math.random = function () {
    if (tk.visto && tk.cerro < 0) tk.randoms++;
    return r0.call(Math);
  };

  // Los hechos que percibe la sala: cada sonido que arranca y cada cambio del
  // comentario, en tiempo de juego.
  const anotar = (que) => { if (tk.visto && tk.cerro < 0) tk.hechos.push({ t: virt / 1000, que }); };
  const start0 = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) { anotar('sonido'); return start0.apply(this, a); };
  let comentario = '';

  const off = document.createElement('canvas');
  off.width = 32; off.height = 18;
  const oc = off.getContext('2d', { willReadFrequently: true });
  // Devuelve la huella en grises y si hay una banda amarilla ancha: una fila
  // con nueve celdas amarillas seguidas, más de un cuarto del ancho.
  const huella = (cv) => {
    oc.clearRect(0, 0, 32, 18);
    oc.drawImage(cv, 0, 0, 32, 18);
    const d = oc.getImageData(0, 0, 32, 18).data;
    let s = '', banda = false;
    for (let y = 0; y < 18; y++) {
      let corre = 0;
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0;
        s += (l >> 4).toString(16);
        const am = d[i] > 215 && d[i + 1] > 160 && d[i + 1] < 225 && d[i + 2] < 110;
        corre = am ? corre + 1 : 0;
        if (corre >= 9) banda = true;
      }
    }
    return { s, banda };
  };

  // El cartel del ganador: la banda amarilla ancha. Se mide una sola vez, a
  // resolución completa, la primera vez que aparece entero.
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // El cartel del ganador: el rectángulo que drawWinnerPlate anota en el
  // lienzo. Buscarlo por el color no alcanzaba: el aguayo del Pasanaku tiene
  // una franja del mismo amarillo, y el auditor la medía como si fuera el
  // cartel. Adentro del rectángulo sí se mide por píxeles: la tinta, su alto
  // y su contraste contra el fondo, que es lo que ve la sala.
  const medirCartel = (cv) => {
    const r = (cv.dataset.cartel || '').split(',').map(Number);
    if (r.length !== 4 || r.some((v) => !Number.isFinite(v)) || r[2] < 4 || r[3] < 4) return null;
    const W = cv.width, H = cv.height;
    const [rx, ry, rw, rh] = r;
    const x0 = Math.max(0, Math.round(rx)), y0 = Math.max(0, Math.round(ry));
    const x1 = Math.min(W, Math.round(rx + rw)), y1 = Math.min(H, Math.round(ry + rh));
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const ww = x1 - x0;
    // Sin el borde de tinta del cartel, que no es texto.
    const pad = Math.max(6, Math.round(rh * 0.07));
    let t0 = 1e9, t1 = -1, nT = 0, lT = 0, nF = 0, lF = 0;
    for (let y = pad; y < y1 - y0 - pad; y++) {
      let tintaFila = 0;
      for (let x = pad; x < ww - pad; x += 2) {
        const i = (y * ww + x) * 4;
        const L = lum(d[i], d[i + 1], d[i + 2]);
        if (L < 0.08) { nT++; lT += L; tintaFila++; }
        else if (L > 0.3) { nF++; lF += L; }
      }
      if (tintaFila > 3) { t0 = Math.min(t0, y); t1 = Math.max(t1, y); }
    }
    if (!nF || !nT) return null;
    const Lf = lF / nF, Lt = lT / nT;
    return {
      ancho: (x1 - x0) / W, alto: (y1 - y0) / H,
      tinta: t1 > t0 ? (t1 - t0) / H : 0,
      contraste: (Math.max(Lf, Lt) + 0.05) / (Math.min(Lf, Lt) + 0.05),
      bordes: { izq: rx < 6, der: rx + rw > W - 8, arr: ry < 6, aba: ry + rh > H - 8 },
    };
  };

  let ultimo = realNow();
  let midio = false;
  const bombear = () => {
    const ahora = realNow();
    const st = document.getElementById('stadium');
    const visible = !!st && st.style.display === 'block';
    // Las huellas se cuentan desde el primer cuadro del juego, no desde que
    // abrió la página: si no, dos corridas se comparan en instantes distintos.
    if (visible && !tk.visto) {
      tk.visto = true;
      tk.f0 = tk.frames;
      // Un cartel anotado por un juego anterior no cuenta.
      const cv0 = st.querySelector('canvas');
      if (cv0) cv0.dataset.cartel = '';
    }
    if (tk.visto && !visible && tk.cerro < 0) tk.cerro = virt;
    if (cbs.size) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += STEP;
      tk.frames++;
      // El cuadro en que el auditor leyó el lienzo entero no cuenta: ese
      // tiempo es del auditor, no del juego.
      if (visible && !midio) tk.reales.push(ahora - ultimo);
      midio = false;
      for (const cb of lote) {
        try { cb(virt); } catch (e) { tk.errores.push(String(e && e.stack || e)); }
      }
      if (visible) {
        const txt = (document.querySelector('.commentary') || {}).textContent || '';
        if (txt && txt !== comentario) { comentario = txt; anotar('comentario'); }
      }
      if (visible && (tk.frames - tk.f0) % ${CADA} === 0) {
        const cv = st.querySelector('canvas');
        if (cv && cv.width > 0) {
          const { s } = huella(cv);
          tk.muestras.push({ f: tk.frames, h: s });
          // Mientras está el cartel se lo mide una muestra de cada tres, a
          // resolución completa. Después se toma la mediana de lo que vio la
          // sala, y no el primer cuadro, en el que todavía está entrando.
          if (cv.dataset.cartel && tk.muestras.length % 3 === 0) {
            const m = medirCartel(cv);
            midio = true;
            if (m && m.ancho > 0.3) tk.carteles.push({ ...m, t: virt / 1000 });
          }
        }
      }
    }
    if (!tk.visto) tk.pendAntes = cbs.size;
    ultimo = ahora;
    RAF(bombear);
  };
  RAF(bombear);
})()`;

const checks = [];
let grupo = "";
const check = (name, ok, detail = "") => {
  checks.push({ grupo, name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

const urlDe = (juego, extra = "") =>
  `${base}/?pose=${juego === "race" ? "1" : juego}${extra}`;

/**
 * Corre la escena de un juego con el reloj cambiado y devuelve lo que midió.
 * `saltarA` son segundos de juego en los que se aprieta "saltar".
 */
async function correr(browser, juego, { pace = "normal", tema = "dark", ancho = 1280, alto = 720, saltarA = null, captura = null, gente = 0 } = {}) {
  const page = await browser.open("about:blank");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO });
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 500,
  });
  await page.send("Page.navigate", { url: urlDe(juego, `&theme=${tema}&pace=${pace}${gente ? `&n=${gente}` : ""}`) });

  const arranco = await page.waitFor("window.__tk && window.__tk.visto", 30_000);
  let salto = null;
  const t0 = Date.now();
  let cerro = false;
  while (arranco.ok && Date.now() - t0 < 180_000) {
    const e = JSON.parse(await page.eval(`JSON.stringify({ v: __tk.virt(), c: __tk.cerro, cartel: __tk.carteles.length > 2 })`));
    if (e.c >= 0) { cerro = true; break; }
    if (saltarA !== null && salto === null && e.v / 1000 >= saltarA) {
      await page.eval(`document.getElementById('st-skip').click(); true`);
      salto = { v: e.v / 1000, real: Date.now() };
    }
    if (captura && e.cartel && !captura.hecha) {
      await page.screenshot(captura.path);
      captura.hecha = true;
    }
    await sleep(120);
  }
  await sleep(300);
  const tk = JSON.parse(await page.eval(`JSON.stringify({
    frames: __tk.frames, reales: __tk.reales, randoms: __tk.randoms,
    muestras: __tk.muestras, carteles: __tk.carteles, errores: __tk.errores,
    hechos: __tk.hechos, cerro: __tk.cerro, pend: __tk.pend(), pendAntes: __tk.pendAntes,
    overflow: document.body.style.overflow,
    oculto: document.getElementById('stadium').style.display !== 'block',
    pantallaCompleta: !!document.fullscreenElement,
  })`));
  const excepciones = [...page.exceptions];
  try {
    await page.send("Page.close");
  } catch {
    /* ya cerrada */
  }
  // Con `--volcar`, cada corrida queda escrita, no sólo la primera: para ver
  // por qué falló la de tema claro o la de celular sin adivinar.
  if (args.includes("--volcar")) {
    await mkdir(outDir, { recursive: true });
    const nombre = `${juego}-${tema}-${ancho}x${alto}-${pace}${gente ? `-n${gente}` : ""}${saltarA !== null ? "-salto" : ""}.json`;
    await writeFile(join(outDir, nombre), JSON.stringify({
      hechos: tk.hechos,
      cambios: tk.muestras.slice(1).map((m, i) => [+((i + 1) * SEG_POR_MUESTRA).toFixed(1), +cambio(tk.muestras[i].h, m.h).toFixed(4)]),
      medio: tk.muestras.map((m, i) => [+((i + 1) * SEG_POR_MUESTRA).toFixed(1), +cambio(tk.muestras[Math.max(0, i - 5)].h, m.h).toFixed(4)]),
    }));
  }
  return {
    arranco: arranco.ok, cerro, salto, excepciones, ...tk,
    cartel: resumirCartel(tk.carteles),
    // Las miniaturas del selector tienen su propio bucle, que sigue vivo
    // durante el juego sin pintar. Lo que cuenta es lo que el juego dejó de más.
    sobran: tk.pend - tk.pendAntes,
    duracion: tk.cerro >= 0 ? tk.cerro / 1000 : null,
    cierreReal: salto ? (Date.now() - salto.real) / 1000 : null,
  };
}

/**
 * Lo que vio la sala del cartel: la mediana de las mediciones, sin el primer
 * medio segundo, en el que todavía entra y el nombre aparece de a poco.
 */
function resumirCartel(ms) {
  if (!ms.length) return null;
  const t0 = ms[0].t;
  const firmes = ms.filter((m) => m.t >= t0 + 0.5);
  const usar = firmes.length ? firmes : ms;
  const med = (k) => [...usar.map((m) => m[k])].sort((a, b) => a - b)[Math.floor(usar.length / 2)];
  return {
    ancho: med("ancho"), alto: med("alto"), tinta: med("tinta"), contraste: med("contraste"),
    bordes: {
      izq: usar.some((m) => m.bordes.izq), der: usar.some((m) => m.bordes.der),
      arr: usar.some((m) => m.bordes.arr), aba: usar.some((m) => m.bordes.aba),
    },
    medidas: usar.length,
  };
}

/** Cuánto cambió la pantalla entre dos huellas, de 0 a 1. */
function cambio(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16));
  return s / (a.length * 15);
}

/**
 * Qué es "cambiar". Un píxel de cada cuatrocientos no es una novedad que se
 * vea desde el fondo, y la cuenta de las huellas cuantizadas a dieciséis
 * niveles de gris tiene ruido: 0,004 es el piso de lo que se ve.
 */
const QUIETO = 0.004;
const HECHO = 0.02;

function ritmo(muestras, hechos = [], fin = Infinity) {
  const d = [];
  for (let i = 1; i < muestras.length; i++) d.push(cambio(muestras[i - 1].h, muestras[i].h));
  // El tramo más largo sin cambio que se vea. Contra medio segundo atrás y no
  // contra el décimo anterior: una cámara que se acerca despacio cambia poco
  // de un décimo al otro, pero en medio segundo se nota, y eso sí es algo que
  // la sala ve moverse.
  const medio = Math.round(0.5 / SEG_POR_MUESTRA);
  let peor = 0, corre = 0, dondePeor = 0;
  for (let i = 1; i < muestras.length; i++) {
    const x = cambio(muestras[Math.max(0, i - medio)].h, muestras[i].h);
    if (x < QUIETO) {
      corre++;
      if (corre > peor) { peor = corre; dondePeor = i - corre; }
    } else corre = 0;
  }
  // Los hechos que la sala percibe: un sonido que arranca, una línea nueva
  // del comentario, o un salto de la pantalla después de un rato quieta. Dos
  // a menos de un cuarto de segundo son el mismo hecho: un acorde no son tres.
  const visuales = [];
  for (let i = 3; i < d.length; i++) {
    if (d[i] >= HECHO && d[i - 1] < HECHO && d[i - 2] < HECHO && d[i - 3] < HECHO) visuales.push((i + 1) * SEG_POR_MUESTRA);
  }
  const ts = [...hechos.map((h) => h.t), ...visuales].filter((t) => t <= fin).sort((a, b) => a - b);
  // Contra el último que quedó, no contra el anterior de la lista: si no, una
  // seguidilla de clics cada décimo se come segundos enteros.
  const unicos = [];
  for (const t of ts) if (!unicos.length || t - unicos[unicos.length - 1] > 0.25) unicos.push(t);
  // Desde que arranca hasta el revelado: el cartel se sostiene a propósito.
  const gaps = unicos.slice(1).map((t, k) => t - unicos[k]);
  const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : Infinity;
  let hueco = unicos.length ? unicos[0] : Infinity, dondeHueco = 0;
  gaps.forEach((g, k) => { if (g > hueco) { hueco = g; dondeHueco = unicos[k]; } });
  // Un cuadro vacío: todas las celdas del mismo gris.
  const vacios = muestras.filter((m, i) => i > 5 && new Set(m.h).size <= 1).length;
  return {
    peorQuieto: peor * SEG_POR_MUESTRA,
    dondeQuieto: dondePeor * SEG_POR_MUESTRA,
    hechos: unicos.length,
    medianaEntreHechos: med,
    hueco,
    dondeHueco,
    vacios,
  };
}

function fluidez(reales) {
  const r = reales.slice(10);
  if (!r.length) return { fps: 0, p95: Infinity };
  const media = r.reduce((a, b) => a + b, 0) / r.length;
  const p95 = [...r].sort((a, b) => a - b)[Math.floor(r.length * 0.95)];
  return { fps: 1000 / media, p95 };
}

async function auditar(browser, juego) {
  grupo = juego;
  console.log(`\n${juego}`);
  await mkdir(outDir, { recursive: true });

  // ------------------------------------------------ 1. dos corridas iguales
  const a = await correr(browser, juego, { captura: { path: join(outDir, `${juego}-cartel.png`) } });
  const b = await correr(browser, juego);
  check("la escena arranca y cierra sola", a.arranco && a.cerro, a.duracion ? `${a.duracion.toFixed(1)} s de juego` : "no cerró");
  if (!a.arranco || !a.cerro) return;
  // La corrida entera queda escrita, para poder mirar qué pasó en un hueco
  // sin volver a correr nada: cuándo sonó algo, qué dijo el comentario y
  // cuánto cambió la pantalla en cada décimo de segundo.
  await writeFile(join(outDir, `${juego}-corrida.json`), JSON.stringify({
    duracion: a.duracion,
    hechos: a.hechos,
    cambios: a.muestras.slice(1).map((m, i) => [+((i + 1) * SEG_POR_MUESTRA).toFixed(1), +cambio(a.muestras[i].h, m.h).toFixed(4)]),
  }));

  const n = Math.min(a.muestras.length, b.muestras.length);
  const difieren = [];
  for (let i = 0; i < n; i++) {
    if (a.muestras[i].h !== b.muestras[i].h) {
      difieren.push({ t: (i + 1) * SEG_POR_MUESTRA, cuanto: cambio(a.muestras[i].h, b.muestras[i].h) });
    }
  }
  // Dónde difieren, en la grilla de 32 por 18: sin eso, encontrar la causa es
  // adivinar.
  let donde = "";
  if (difieren.length) {
    const i = Math.round(difieren[0].t / SEG_POR_MUESTRA) - 1;
    const ha = a.muestras[i].h, hb = b.muestras[i].h;
    const celdas = [];
    for (let j = 0; j < ha.length; j++) if (ha[j] !== hb[j]) celdas.push(`${Math.round(((j % 32) + 0.5) / 32 * 100)}%,${Math.round((Math.floor(j / 32) + 0.5) / 18 * 100)}%`);
    donde = ` · en ${celdas.slice(0, 6).join(" ")}`;
  }
  check(
    "la misma ronda dibuja los mismos cuadros",
    difieren.length === 0 && a.muestras.length === b.muestras.length,
    difieren.length
      ? `${difieren.length} de ${n} huellas distintas: ${difieren.slice(0, 4).map((x) => `${x.t.toFixed(1)} s (${(x.cuanto * 100).toFixed(2)}%)`).join(", ")}${donde}`
      : `${n} huellas idénticas en las dos corridas`,
  );
  check("el juego no llama a Math.random()", a.randoms === 0, `${a.randoms} llamadas`);

  // --------------------------------------------------------------- 2. ritmo
  const r = ritmo(a.muestras, a.hechos, a.duracion);
  check(
    "nunca pasan más de 4 s sin que cambie la pantalla",
    r.peorQuieto <= 4,
    `el tramo más quieto dura ${r.peorQuieto.toFixed(1)} s, desde los ${r.dondeQuieto.toFixed(1)} s`,
  );
  check(
    "hay un hecho nuevo cada 2,5 s, y nunca 4 s sin ninguno",
    r.medianaEntreHechos <= 2.5 && r.hueco <= 4,
    `${r.hechos} hechos · mediana ${Number.isFinite(r.medianaEntreHechos) ? r.medianaEntreHechos.toFixed(2) : "—"} s · el hueco más largo ${r.hueco.toFixed(1)} s, desde los ${r.dondeHueco.toFixed(1)} s`,
  );
  check("ningún cuadro queda vacío", r.vacios === 0, `${r.vacios} cuadros de un solo color`);

  // El relator no tartamudea: dos líneas a menos de tres décimos es una
  // condición de ventana en vez de un cierre, disparando en cada cuadro. Así
  // se encontró el nudo del Pasanaku cambiando de frase ocho veces seguidas.
  const dichos = a.hechos.filter((h) => h.que === "comentario").map((h) => h.t);
  const pegados = dichos.slice(1).map((t, i) => t - (dichos[i] ?? 0)).filter((g) => g < 0.3);
  check(
    "el relator no tartamudea",
    pegados.length === 0,
    pegados.length ? `${pegados.length} líneas pisadas a menos de 0,3 s` : `${dichos.length} líneas, ninguna encima de otra`,
  );

  // ------------------------------------------------------------ 3. fluidez
  const f = fluidez(a.reales);
  check(
    "corre fluido",
    f.fps >= 30 && f.p95 <= 80,
    `${f.fps.toFixed(0)} cuadros por segundo, el 95% en menos de ${f.p95.toFixed(0)} ms`,
  );

  // -------------------------------------------------- 4. el cartel, de lejos
  // Un nombre proyectado se lee desde el fondo si ocupa al menos un 4,5% del
  // alto de la pantalla: a 720 son 32 píxeles, que a un cuarto de escala
  // todavía son ocho. Y el contraste de la tinta sobre el amarillo tiene que
  // pasar el 4,5:1 de WCAG, que es para texto chico: un proyector lava el
  // negro y nunca da el contraste que dice el archivo.
  const c = a.cartel;
  check(
    "el nombre del ganador se lee desde el fondo",
    !!c && c.tinta >= 0.045,
    c ? `la tinta ocupa el ${(c.tinta * 100).toFixed(1)}% del alto` : "no se encontró el cartel",
  );
  check(
    "la tinta del cartel contrasta 4,5:1 o más",
    !!c && c.contraste >= 4.5,
    c ? `${c.contraste.toFixed(1)}:1` : "no se encontró el cartel",
  );

  // ----------------------------------------- 5. al terminar no queda nada
  check(
    "al terminar no queda nada corriendo",
    a.sobran <= 0 && a.oculto && a.overflow === "" && !a.pantallaCompleta,
    `bucles de más ${a.sobran} · estadio ${a.oculto ? "oculto" : "visible"} · overflow "${a.overflow}"`,
  );
  check(
    "sin excepciones",
    a.excepciones.length + a.errores.length + b.excepciones.length + b.errores.length === 0,
    [...a.excepciones, ...a.errores].slice(0, 1).join(" ").slice(0, 120),
  );

  // --------------------------------------- 6. saltar en cualquier momento
  // Al 10%, en la mitad y al 90%. Cerrar no es instantáneo a propósito: el
  // cartel se sostiene tres segundos reales para que la sala lo lea. Más de
  // seis es que el salto no hizo nada.
  const total = a.duracion;
  for (const frac of [0.1, 0.5, 0.9]) {
    const s = await correr(browser, juego, { saltarA: total * frac });
    check(
      `saltar al ${Math.round(frac * 100)}% cierra`,
      s.cerro && s.salto && s.cierreReal <= 6 && s.sobran <= 0 && s.overflow === "" && s.excepciones.length === 0,
      s.salto ? `cerró ${s.cierreReal?.toFixed(1)} s después` : "no se llegó a saltar",
    );
  }

  // -------------------------------------------------- 7. duración elegida
  // Cuánto dura el show en cada posición del selector, contra lo prometido.
  // Hasta un 20% de diferencia: el tope de estiramiento (×2,2) existe para
  // que un juego corto no se vuelva cámara lenta, y ese juego queda corto.
  const durs = { normal: a.duracion };
  for (const p of ["rapido", "epico"]) durs[p] = (await correr(browser, juego, { pace: p })).duracion;
  const lejos = Object.entries(durs).filter(([p, d]) => !d || Math.abs(d - PACES[p]) / PACES[p] > 0.2);
  check(
    "dura lo que se eligió en el selector",
    lejos.length === 0,
    Object.entries(durs).map(([p, d]) => `${p} ${d ? d.toFixed(1) : "?"}/${PACES[p]} s`).join(" · "),
  );

  // ------------------------------------------------- 8. celular y tema claro
  // Las mismas medidas donde más se rompen: vertical, y sobre fondo claro.
  for (const [como, opts] of [
    ["en celular", { ancho: 390, alto: 844 }],
    ["en tema claro", { tema: "light" }],
  ]) {
    const x = await correr(browser, juego, { ...opts, captura: { path: join(outDir, `${juego}-${como.replace(/ /g, "-")}.png`) } });
    const rx = ritmo(x.muestras, x.hechos, x.duracion);
    const cx = x.cartel;
    const sale = cx && cx.bordes.izq && cx.bordes.der;
    check(
      `${como}: cierra, se mueve y el cartel se lee`,
      x.cerro && rx.peorQuieto <= 4 && rx.vacios === 0 && !!cx && !sale && cx.contraste >= 4.5 && x.excepciones.length === 0,
      cx
        ? `quieto ${rx.peorQuieto.toFixed(1)} s · cartel ${(cx.ancho * 100).toFixed(0)}% de ancho · ${cx.contraste.toFixed(1)}:1${sale ? " · SE SALE" : ""}`
        : "no se encontró el cartel",
    );
  }

  // ------------------------------------------------- 9. con dos y con muchos
  // La pregunta que estaba en la lista de "revisalo vos": ¿funciona con dos
  // personas y con doscientas? Con dos, que el juego tenga qué mostrar; con
  // doscientas, que no se ahogue. La ruleta llega a veinticuatro por diseño:
  // arriba de eso el sorteo pasa solo al Cierre de Libro.
  const tope = juego === "wheel" ? 24 : 200;
  for (const gente of [2, tope]) {
    const x = await correr(browser, juego, { gente });
    const rx = ritmo(x.muestras, x.hechos, x.duracion);
    const fx = fluidez(x.reales);
    const cx = x.cartel;
    check(
      `con ${gente}: cierra, se mueve, fluye y el cartel se lee`,
      x.cerro && rx.peorQuieto <= 4 && rx.hueco <= 4 && fx.fps >= 30 && !!cx && cx.tinta >= 0.045 && x.excepciones.length + x.errores.length === 0,
      cx
        ? `quieto ${rx.peorQuieto.toFixed(1)} s · hueco ${rx.hueco.toFixed(1)} s · ${fx.fps.toFixed(0)} cps · tinta ${(cx.tinta * 100).toFixed(1)}%`
        : `no se encontró el cartel${x.excepciones[0] ? ` · ${x.excepciones[0].slice(0, 80)}` : ""}`,
    );
  }

  return { ritmo: r, fluidez: f, cartel: c, duraciones: durs };
}

const informe = {};
const browser = await launch({ port: Number(process.env.CDP_PORT || 9361), width: 1280, height: 720 });
try {
  // `--gente N`: una sola corrida con N personas, para afinar un caso sin
  // correr las once. Muestra el ritmo y deja la corrida escrita.
  const gente = Number(opt("--gente", "0"));
  if (gente > 0) {
    for (const j of juegos) {
      grupo = j;
      console.log(`\n${j} con ${gente}`);
      const x = await correr(browser, j, { gente });
      const rx = ritmo(x.muestras, x.hechos, x.duracion);
      const fx = fluidez(x.reales);
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, `${j}-n${gente}-corrida.json`), JSON.stringify({
        duracion: x.duracion,
        hechos: x.hechos,
        medio: x.muestras.map((m, i) => [+((i + 1) * SEG_POR_MUESTRA).toFixed(2), +cambio(x.muestras[Math.max(0, i - 5)].h, m.h).toFixed(4)]),
      }));
      check(
        `con ${gente}: cierra, se mueve, fluye y el cartel se lee`,
        x.cerro && rx.peorQuieto <= 4 && rx.hueco <= 4 && fx.fps >= 30 && !!x.cartel && x.cartel.tinta >= 0.045,
        `quieto ${rx.peorQuieto.toFixed(1)} s desde los ${rx.dondeQuieto.toFixed(1)} · hueco ${rx.hueco.toFixed(1)} s · ${fx.fps.toFixed(0)} cps`,
      );
    }
  } else {
    for (const j of juegos) informe[j] = await auditar(browser, j).catch((e) => {
      check("la auditoría corrió sin caerse", false, e.message);
      return null;
    });
  }
} finally {
  browser.close();
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "informe.json"), JSON.stringify({ checks, informe }, null, 2));

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
if (malos.length) for (const m of malos) console.log(`  ✗ ${m.grupo}: ${m.name}${m.detail ? ` · ${m.detail}` : ""}`);
process.exit(malos.length ? 1 : 0);
