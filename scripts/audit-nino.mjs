#!/usr/bin/env node
/**
 * La prueba del niño: el auditor.
 *
 * La regla (la del niño, en `docs/juegos.md`): una sola vara, la de alguien de 7
 * años o más. Cualquier cuadro del juego, sin leer el relator, muestra si ya ganó
 * alguien, cuánto falta, qué acaba de pasar, adónde mirar y lo propio de su forma
 * (quién va adelante, quiénes siguen, qué está señalado o quién tiene más). Sin esta
 * prueba la regla es una opinión. Cómo corre, en tres pasos y sin llamar a ninguna
 * API (no hace falta llave ni cuesta):
 *
 * 1. **Capturar.** Por semilla y por tamaño (proyector 1920x1080 oscuro; celular 390x844
 *    claro), corre el show con el reloj en turbo y lo para al 25 % y al 60 % de su
 *    duración y un segundo después del golpe. En cada parada saca tres cuadros (0,6 s
 *    antes, 0,3 s antes y el momento), con el subtítulo escondido y con los nombres
 *    (quien tiene 7 años los lee): el del momento es **la foto** (`gano`, `falta` y
 *    `propia`, y `olor`) y los tres juntos, uno al lado del otro, son **la tira** (`paso`
 *    y `mirar`; un chico mira movimiento). La tira se arma en una pestaña en blanco con
 *    un canvas, sin dependencias. En cada parada guarda también la verdad del plan,
 *    `window.__nino.verdad()`, y la forma del juego, `window.__nino.forma` (el contrato del
 *    kit, `kit/respuestas.ts`). Deja en la carpeta `preguntas.json` (ids, imágenes y
 *    preguntas: nada más), el `prompt-nino.md` fijo y, aparte, en `oculto/verdad.json`,
 *    la verdad.
 * 2. **Describir.** Un modelo que solo ve las imágenes, el describidor (uno barato que lea
 *    imágenes; desempata otro más fuerte), lee `preguntas.json` y escribe `respuestas-modelo.json`.
 *    Las que fallan se repiten con otro describidor en `respuestas-desempate.json`.
 * 3. **Juzgar.** `--juzgar <carpeta>` compara con la verdad y da el veredicto con cifras,
 *    por arco (ver `scripts/lib/nino.mjs`).
 *
 * Dos controles, para saber que la prueba misma anda:
 *   `--control`           la carrera de hoy, la que no se entendía: tiene que REPROBAR.
 *   `--control-positivo`  la ruleta: tiene que APROBAR.
 *   `--controles`         corre los dos; al juzgar, dice «prueba sana» solo si el negativo
 *                         reprueba y el positivo aprueba. Si alguno se da vuelta, sale con error.
 *
 * Uso:
 *   pnpm preview --port 4192 &
 *   CDP_PORT=9692 node scripts/audit-nino.mjs ruleta --personas 18 --semillas 2 --base http://localhost:4192
 *   ... el describidor contesta (scripts/prompt-nino.md) ...
 *   node scripts/audit-nino.mjs --juzgar docs/capturas/nino/ruleta
 *   CDP_PORT=9692 node scripts/audit-nino.mjs --controles --semillas 2 --base http://localhost:4192
 *   node scripts/audit-nino.mjs --controles --juzgar docs/capturas/nino
 *
 * Opciones: `--personas 18`, `--semillas 8`, `--tamanos 1080,390`,
 * `--out <carpeta>` (por defecto `docs/capturas/nino/<juego>`, sin versionar), `--json`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { juegosDelKit } from "./lib/juegos.mjs";
import {
  CLAVES,
  CUADROS_ATRAS,
  FORMAS,
  PUNTOS,
  TAMANOS,
  armarPreguntas,
  horasDeLosCuadros,
  idDeCaptura,
  idDeJuego,
  juzgar,
  juzgarControles,
  lineaDeMomento,
  semillaDe,
} from "./lib/nino.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const CON_VALOR = new Set(["--personas", "--semillas", "--base", "--out", "--juzgar", "--tamanos", "--motor"]);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1] ?? ""));
const controles = args.includes("--controles");
const controlNegativo = args.includes("--control") || controles;
const controlPositivo = args.includes("--control-positivo") || controles;
const dirJuzgar = opt("--juzgar", null);
const personas = Number(opt("--personas", "18"));
const semillas = Number(opt("--semillas", "8"));
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
// `--motor 3d`: la carrera en 3D (docs/motores.md); por defecto el motor de todos.
const motor = opt("--motor", "pixi");
const tamanos = TAMANOS.filter((t) => opt("--tamanos", "1080,390").split(",").includes(t.id));

const OLOR = "olor a apuesta: ninguna imagen parece casino ni juego de apuestas";
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const leer = (ruta) => JSON.parse(readFileSync(ruta, "utf8"));

/** Los controles viven en carpetas con nombre propio: el negativo en `control` y el positivo en `control-positivo`. */
const CARPETA_CONTROL = { negativo: "control", positivo: "control-positivo" };
const JUEGO_CONTROL = { negativo: "race", positivo: "wheel" };

/* ================================================================== juzgar */

/** Juzga una carpeta, imprime y suma sus comprobaciones. Devuelve el veredicto y de qué clase de corrida era. */
function juzgarCarpeta(carpeta, { silencioso = false } = {}) {
  const dir = resolve(carpeta);
  const verdad = leer(join(dir, "oculto", "verdad.json"));
  const rutaResp = join(dir, "respuestas-modelo.json");
  if (!existsSync(rutaResp)) {
    console.error(`falta ${rutaResp}: que el describidor conteste con scripts/prompt-nino.md`);
    process.exit(2);
  }
  const respuestas = leer(rutaResp);
  const rutaDes = join(dir, "respuestas-desempate.json");
  const desempate = existsSync(rutaDes) ? leer(rutaDes) : {};
  const v = juzgar({ capturas: verdad.capturas, respuestas, desempate });
  // Las carpetas viejas decían `control: true`: era el negativo.
  const clase = verdad.control === true ? "negativo" : verdad.control || null;
  const cuenta = (n) => `${n} de ${v.semillas}`;
  const etiqueta = clase === "negativo" ? " (control negativo: la carrera de hoy)" : clase === "positivo" ? " (control positivo: la ruleta)" : "";
  const formas = [...new Set(Object.values(verdad.capturas).map((c) => c.forma))].join(", ");

  console.log(`\nprueba del niño · ${verdad.juego}${etiqueta} · forma ${formas} · ${verdad.personas} personas · ${v.semillas} semillas · ${v.momentos.length} momentos`);
  for (const m of v.momentos.filter((x) => !x.pasa)) console.log(`    ${lineaDeMomento(m)}`);
  for (const c of v.corridas) console.log(`  semilla ${c.semilla}: ${c.pasa ? "pasa" : `no pasa (${c.falla.join("; ")})`}`);

  check(`${verdad.juego}: todas las imágenes tienen respuesta`, v.sinRespuesta === 0, v.sinRespuesta ? `${v.sinRespuesta} momentos sin respuesta` : `${v.momentos.length} de ${v.momentos.length}`);
  if (clase === "negativo") {
    check(
      "control negativo: la carrera de hoy NO aprueba la prueba",
      !v.pasa,
      v.pasa ? `la aprobó (${cuenta(v.pasan)} semillas): la prueba está mal` : `${cuenta(v.pasan)} semillas pasan, hacen falta ${v.minimo}: la prueba ve el problema`,
    );
  } else if (clase === "positivo") {
    check(
      "control positivo: la ruleta APRUEBA la prueba",
      v.pasa,
      v.pasa ? `${cuenta(v.pasan)} semillas pasan (mínimo ${v.minimo})` : `la reprobó (${cuenta(v.pasan)} semillas, hacen falta ${v.minimo}): la prueba está mal`,
    );
  } else {
    check("N1 · se entiende a los 7 años", v.pasa, `${cuenta(v.pasan)} semillas pasan (mínimo ${v.minimo})`);
    check("ningún cuadro antes del golpe dice que ya se sabe quién gana", v.graves === 0, v.graves ? `${v.graves} momentos con un «si» antes del golpe: la presentación delata` : "");
    // El olor a apuesta va aparte: la boleta lo busca por su nombre («olor») y no cambia el veredicto del niño ni la salida.
    if (v.olor.respondidas > 0) check(OLOR, v.olor.aprobada, v.olor.aprobada ? `${v.olor.respondidas} de ${v.olor.respondidas} dicen que no` : `${v.olor.conOlor} de ${v.olor.respondidas} dicen que sí`);
  }

  const total = v.momentos.length;
  const aciertos = Object.fromEntries(CLAVES.map((k) => [k, `${v.momentos.filter((m) => m.aciertos[k]).length}/${total}`]));
  const decisivas = Object.fromEntries(CLAVES.map((k) => {
    const de = v.momentos.filter((m) => m.decide.includes(k));
    return [k, `${de.filter((m) => m.aciertos[k]).length}/${de.length}`];
  }));
  console.log(`  aciertos por pregunta (los que deciden): ${CLAVES.map((k) => `${k} ${decisivas[k]}`).join(" · ")}`);
  console.log(`  aciertos por pregunta (todas las paradas): ${CLAVES.map((k) => `${k} ${aciertos[k]}`).join(" · ")}`);
  console.log(`  olor a apuesta (aparte, no entra en el veredicto): ${v.olor.respondidas === 0 ? "sin respuestas" : v.olor.aprobada ? `aprobada, ${v.olor.respondidas} de ${v.olor.respondidas} dicen que no` : `${v.olor.conOlor} de ${v.olor.respondidas} dicen que sí`}`);

  const repetir = [...new Set(v.momentos.filter((m) => !m.pasa && !m.desempatado).flatMap((m) => m.ids))];
  if (!silencioso) {
    writeFileSync(join(dir, "repetir.json"), `${JSON.stringify({ nota: "Imágenes de los momentos que fallaron con el primer describidor: que otro, más fuerte, las describa y escriba respuestas-desempate.json con el mismo formato.", ids: repetir }, null, 2)}\n`);
    writeFileSync(join(dir, "veredicto.json"), `${JSON.stringify({ juego: verdad.juego, control: clase, formas, personas: verdad.personas, ...v }, null, 2)}\n`);
    if (repetir.length) console.log(`  ${repetir.length} imágenes para repetir con otro describidor: ${join(dir, "repetir.json")}`);
  }
  return { v, clase, verdad, aciertos, decisivas };
}

function cierre(objetivo, datos) {
  // El olor se informa pero no decide: no cambia el estado de salida.
  const malos = checks.filter((c) => !c.ok && c.name !== OLOR);
  console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
  emitirJson({ auditor: "audit-nino", objetivo, checks, datos });
  process.exit(malos.length ? 1 : 0);
}

if (dirJuzgar) {
  if (controles) {
    // Los dos controles juntos: `--controles --juzgar <carpeta con control/ y control-positivo/>`.
    const raiz = resolve(dirJuzgar);
    const neg = juzgarCarpeta(join(raiz, CARPETA_CONTROL.negativo));
    const pos = juzgarCarpeta(join(raiz, CARPETA_CONTROL.positivo));
    const j = juzgarControles({ negativo: neg.v, positivo: pos.v });
    console.log("");
    check("prueba sana: el control negativo reprueba y el positivo aprueba", j.sana, j.sana ? "la carrera de hoy reprueba y la ruleta aprueba" : j.problemas.join("; "));
    if (!j.sana) console.log("  ERROR: la prueba se rompió, no el juego. No uses este resultado para juzgar ningún juego hasta arreglarla.");
    cierre("controles", { sana: j.sana, negativo: { pasan: neg.v.pasan, minimo: neg.v.minimo }, positivo: { pasan: pos.v.pasan, minimo: pos.v.minimo } });
  } else {
    const r = juzgarCarpeta(dirJuzgar);
    cierre(r.clase ? `control-${r.clase}` : r.verdad.juego, {
      personas: r.verdad.personas,
      semillas: r.v.semillas,
      pasan: r.v.pasan,
      minimo: r.v.minimo,
      graves: r.v.graves,
      olor: { aprobada: r.v.olor.respondidas ? r.v.olor.aprobada : null, fotos: r.v.olor.respondidas, conOlor: r.v.olor.conOlor },
      aciertos: r.aciertos,
      decisivas: r.decisivas,
      momentos: r.v.momentos.map((m) => ({ semilla: m.semilla, tamano: m.tamano, punto: m.punto, pasa: m.pasa })),
    });
  }
}

/* ================================================================ capturar */

if (!controlNegativo && !controlPositivo && !cual) {
  console.error("uso: node scripts/audit-nino.mjs <juego|todos> [--personas 18] [--semillas 8] [--base URL] [--out carpeta]\n     node scripts/audit-nino.mjs --juzgar <carpeta>\n     node scripts/audit-nino.mjs --control | --control-positivo | --controles   [--juzgar <carpeta>]");
  process.exit(2);
}
// El motor nuevo dibuja con WebGL: sin la placa de video Chrome lo hace por software.
process.env.TINKAZO_GPU = "1";

/**
 * El reloj en turbo (como el de `audit-emocion`), con una meta: cuando la hora del
 * juego (`window.__nino.t()`) llega a `meta`, el reloj se congela y el cuadro queda
 * quieto para la foto. Arranca con meta 0: en cuanto el juego monta, se frena en su
 * primer cuadro, así la meta del 25 % llega antes de que el show pase de largo.
 */
const RELOJ = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0;
  const cbs = new Map();
  const R = (window.__reloj = { meta: 0, parado: false, cuadros: 0 });
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const llego = () => { const N = window.__nino; return R.meta !== null && !!N && typeof N.t === 'function' && N.t() >= R.meta; };
  const bombear = () => {
    for (let i = 0; i < 20 && cbs.size; i++) {
      if (llego()) break;
      const lote = [...cbs.values()];
      cbs.clear();
      virt += STEP;
      R.cuadros++;
      for (const cb of lote) { try { cb(virt); } catch (e) { console.error(e); } }
    }
    R.parado = llego();
    RAF(bombear);
  };
  RAF(bombear);
})()`;

/**
 * Sin subtítulo en las fotos. El subtítulo se esconde con `visibility`, no con `display: none`: la guardia de los
 * nombres del estadio mide dónde empieza (`offsetTop`), y con `display: none` vale 0 y todo chip con nombre se daba por
 * tapado y no se dibujaba (el Toborochi salía sin un solo nombre en la foto con letras).
 */
const CSS = "#commentary{visibility:hidden!important}";

/** El ancho de cada cuadro de la tira, a lo sumo: tres de 1920 serían una imagen de 5800 px que el describidor reduce de todos modos. */
const ANCHO_CUADRO_MAX = 960;
const SEPARACION = 12;

async function pararEn(page, hora) {
  await page.eval(`window.__reloj.meta = ${hora}; 0`);
  const r = await page.waitFor(`window.__reloj.parado && window.__nino.t() >= ${hora}`, 90_000);
  if (!r.ok) throw new Error(`el show no llegó a los ${hora.toFixed(1)} s de juego`);
  await sleep(100);
}

/** El cuadro quieto de este instante, en PNG base64. */
async function cuadro(page) {
  await page.eval("(() => { if (window.__ninoRepintar) window.__ninoRepintar(); return 0; })()");
  await sleep(200);
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  return data;
}

/**
 * La tira: los tres cuadros del mismo tamaño, uno al lado del otro, de izquierda a derecha (el último es el momento),
 * con un hueco gris entre ellos. Se arma en una pestaña en blanco con un canvas y sale un PNG: sin dependencias.
 */
async function armarTira(lienzo, cuadros) {
  const data = await lienzo.eval(`(async (fuentes) => {
    const imgs = await Promise.all(fuentes.map((s) => new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('un cuadro de la tira no cargó'));
      i.src = 'data:image/png;base64,' + s;
    })));
    const ancho = Math.min(imgs[0].naturalWidth, ${ANCHO_CUADRO_MAX});
    const alto = Math.round(imgs[0].naturalHeight * ancho / imgs[0].naturalWidth);
    const c = document.createElement('canvas');
    c.width = ancho * imgs.length + ${SEPARACION} * (imgs.length - 1);
    c.height = alto;
    const g = c.getContext('2d');
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, k) => g.drawImage(im, k * (ancho + ${SEPARACION}), 0, ancho, alto));
    return c.toDataURL('image/png').split(',')[1];
  })(${JSON.stringify(cuadros)})`);
  if (typeof data !== "string" || data.length < 1000) throw new Error("la tira salió vacía");
  return data;
}

/** Una corrida: una semilla en un tamaño. Devuelve las capturas que sacó (foto y tira de cada parada), con su verdad. */
async function correr(browser, lienzo, { juego, semilla, tam, dir, clase }) {
  const hex = semillaDe(semilla);
  const page = await browser.open("about:blank");
  const salida = {};
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: tam.ancho, height: tam.alto, deviceScaleFactor: 1, mobile: tam.celular });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RELOJ });
    const url = `${base}/?pose=${juego === "race" ? "1" : juego}&motor=${motor}&pace=normal&auditar=nino&n=${personas}&theme=${tam.tema}&semilla=${hex}&ganador=${hex}`;
    await page.send("Page.navigate", { url });
    const ok = await page.waitFor("window.__nino && window.__nino.duracion > 0 && window.__pose", 90_000);
    if (!ok.ok) throw new Error(`el juego no dejó window.__nino (¿se pidió ?auditar=nino? ¿el juego expone el gancho?)`);
    const forma = await page.eval("window.__nino.forma");
    if (!FORMAS.includes(forma)) throw new Error(`el juego no declara su forma en window.__nino.forma (dice ${JSON.stringify(forma)}; tiene que ser una de ${FORMAS.join(", ")})`);
    await page.eval(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(CSS)}; document.head.appendChild(s); return 0; })()`);
    const duracion = await page.eval("window.__nino.duracion");
    for (const punto of PUNTOS) {
      // Tres paradas por momento: 0,6 s antes, 0,3 s antes y el momento. El del momento es también la foto.
      const cuadros = [];
      for (const hora of horasDeLosCuadros(punto, duracion)) {
        await pararEn(page, hora);
        cuadros.push(await cuadro(page));
      }
      const estado = JSON.parse(await page.eval("JSON.stringify({ verdad: window.__nino.verdad(), t: window.__nino.t(), nombres: window.__pose.names, ganadores: window.__pose.winners, grupos: window.__nino.grupos ?? null })"));
      const tira = await armarTira(lienzo, cuadros);
      for (const [imagen, png] of [["foto", cuadros[cuadros.length - 1]], ["tira", tira]]) {
        const id = idDeCaptura({ juego, semilla, tamano: tam.id, punto: punto.id, imagen });
        writeFileSync(join(dir, "capturas", `${id}.png`), Buffer.from(png, "base64"));
        salida[id] = { semilla, tamano: tam.id, punto: punto.id, imagen, forma, duracion, ...estado };
      }
    }
  } finally {
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
  return salida;
}

async function capturarJuego(browser, juego, dir, clase) {
  mkdirSync(join(dir, "capturas"), { recursive: true });
  mkdirSync(join(dir, "oculto"), { recursive: true });
  const capturas = {};
  const lienzo = await browser.open("about:blank");
  console.log(`\n${juego}${clase ? ` (control ${clase})` : ""} · ${personas} personas · ${semillas} semillas · ${tamanos.map((t) => t.id).join(" y ")}`);
  try {
    for (let s = 1; s <= semillas; s++) {
      for (const tam of tamanos) {
        try {
          Object.assign(capturas, await correr(browser, lienzo, { juego, semilla: s, tam, dir, clase }));
          check(`${juego}: semilla ${s}, ${tam.ancho}x${tam.alto}: las tres paradas con su tira`, true, `${PUNTOS.length * 2} imágenes`);
        } catch (e) {
          check(`${juego}: semilla ${s}, ${tam.ancho}x${tam.alto}: las tres paradas con su tira`, false, String(e.message ?? e));
        }
      }
    }
  } finally {
    try {
      await lienzo.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
  const esperadas = semillas * tamanos.length * PUNTOS.length * 2;
  writeFileSync(join(dir, "preguntas.json"), `${JSON.stringify(armarPreguntas(capturas), null, 2)}\n`);
  copyFileSync(new URL("prompt-nino.md", import.meta.url), join(dir, "prompt-nino.md"));
  writeFileSync(join(dir, "oculto", "verdad.json"), `${JSON.stringify({ version: 2, juego, control: clase ?? false, personas, semillas, base, generado: new Date().toISOString(), capturas }, null, 2)}\n`);
  check(`${juego}: las imágenes pedidas están todas`, Object.keys(capturas).length === esperadas, `${Object.keys(capturas).length} de ${esperadas}`);
  console.log(`  ${Object.keys(capturas).length} imágenes y sus preguntas en ${dir}\n  que el describidor las describa (${join(dir, "prompt-nino.md")}) y después: node scripts/audit-nino.mjs --juzgar ${dir}`);
}

/** Qué se captura: [juego, carpeta, clase de control]. */
const pedidos = [];
if (controlNegativo || controlPositivo) {
  const raiz = resolve(opt("--out", join("docs", "capturas", "nino")));
  const dosControles = controlNegativo && controlPositivo;
  for (const clase of ["negativo", "positivo"]) {
    if ((clase === "negativo" && !controlNegativo) || (clase === "positivo" && !controlPositivo)) continue;
    // Con un solo control, `--out` es su carpeta; con los dos, es la raíz de ambas.
    pedidos.push([JUEGO_CONTROL[clase], dosControles || !opt("--out", null) ? join(raiz, CARPETA_CONTROL[clase]) : raiz, clase]);
  }
} else {
  const juegos = cual === "todos" ? ["wheel", ...juegosDelKit()] : [idDeJuego(cual)];
  /** Dónde queda cada juego: `--out` (con una subcarpeta por juego si son varios) o `docs/capturas/nino/<juego>`. */
  const carpetaDe = (juego) => {
    const o = opt("--out", null);
    if (o) return resolve(juegos.length > 1 ? join(o, juego) : o);
    return resolve(join("docs", "capturas", "nino", juego));
  };
  for (const juego of juegos) pedidos.push([juego, carpetaDe(juego), null]);
}
const browser = await launch({ port: Number(process.env.CDP_PORT || 9690), width: 1920, height: 1080 });
try {
  for (const [juego, dir, clase] of pedidos) await capturarJuego(browser, juego, dir, clase);
} finally {
  await browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "CON FALLAS" : "CAPTURAS LISTAS"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
emitirJson({ auditor: "audit-nino", objetivo: controlNegativo || controlPositivo ? "controles" : (cual ?? "") });
process.exit(malos.length ? 1 : 0);
