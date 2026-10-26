#!/usr/bin/env node
/**
 * La prueba del niño: el auditor.
 *
 * La regla (la del niño, en `docs/juegos.md`): cualquier cuadro del juego,
 * sin leer, dice quién va adelante, hacia dónde van, cuánto falta y qué acaba de
 * pasar. Sin esta prueba la regla es una opinión. Cómo corre, en tres pasos y sin
 * llamar a ninguna API (no hace falta llave ni cuesta):
 *
 * 1. **Capturar.** Por semilla y por tamaño (proyector 1920x1080 oscuro; celular 390x844
 *    claro), corre el show con el reloj en turbo, lo para al 25 % y al 60 % de su
 *    duración y un segundo después del golpe, esconde el subtítulo, y en cada parada
 *    saca dos fotos: con letras (la edad de 9) y sin ninguna (la de 5: el estadio no
 *    dibuja ningún texto del motor). En cada parada guarda también la verdad del plan,
 *    `window.__nino.verdad()` (el contrato del kit, `kit/respuestas.ts`). Deja en la
 *    carpeta `preguntas.json` (ids, fotos y las cuatro preguntas: nada más), el
 *    `prompt-nino.md` fijo y, aparte, en `oculto/verdad.json`, la verdad.
 * 2. **Describir.** Un modelo que solo ve las fotos, el describidor (uno barato que lea
 *    imágenes; desempata otro más fuerte), lee `preguntas.json` y escribe `respuestas-modelo.json`. Las fotos
 *    que fallan se repiten con otro describidor en `respuestas-desempate.json`.
 * 3. **Juzgar.** `--juzgar <carpeta>` compara con la verdad y da el veredicto con cifras.
 *
 * `--control` corre la carrera de producción de hoy, la que no se entendía: si la
 * prueba la aprueba, la prueba está mal. Con `--control --juzgar` el éxito se invierte.
 *
 * Uso:
 *   pnpm preview --port 4192 &
 *   CDP_PORT=9692 node scripts/audit-nino.mjs ruleta --personas 18 --semillas 2 --base http://localhost:4192
 *   ... el describidor contesta (scripts/prompt-nino.md) ...
 *   node scripts/audit-nino.mjs --juzgar docs/capturas/nino/ruleta
 *   CDP_PORT=9692 node scripts/audit-nino.mjs --control --semillas 2 --base http://localhost:4192
 *   node scripts/audit-nino.mjs --control --juzgar docs/capturas/nino/control
 *
 * Opciones: `--personas 18`, `--semillas 8`, `--tamanos 1080,390`, `--solo-letras`,
 * `--out <carpeta>` (por defecto `docs/capturas/nino/<juego>`, sin versionar), `--json`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { juegosDelKit } from "./lib/juegos.mjs";
import {
  PUNTOS,
  TAMANOS,
  VARIANTES,
  armarPreguntas,
  horaDeParada,
  idDeCaptura,
  idDeJuego,
  juzgar,
  lineaDeFoto,
  semillaDe,
} from "./lib/nino.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const CON_VALOR = new Set(["--personas", "--semillas", "--base", "--out", "--juzgar", "--tamanos"]);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1] ?? ""));
const control = args.includes("--control");
const dirJuzgar = opt("--juzgar", null);
const personas = Number(opt("--personas", "18"));
const semillas = Number(opt("--semillas", "8"));
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const tamanos = TAMANOS.filter((t) => opt("--tamanos", "1080,390").split(",").includes(t.id));
const variantes = VARIANTES.filter((v) => !(v.sinLetras && args.includes("--solo-letras")));

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const leer = (ruta) => JSON.parse(readFileSync(ruta, "utf8"));

/* ================================================================== juzgar */

async function juzgarCarpeta(carpeta) {
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
  const esControl = control || verdad.control === true;
  const cuenta = (n) => `${n} de ${v.semillas}`;

  console.log(`\nprueba del niño · ${verdad.juego}${esControl ? " (control: la carrera de hoy)" : ""} · ${verdad.personas} personas · ${v.semillas} semillas · ${v.fotos.length} fotos`);
  for (const f of v.fotos.filter((x) => !x.pasa)) console.log(`    ${lineaDeFoto(f)}`);
  for (const c of v.corridas) console.log(`  semilla ${c.semilla}: ${c.pasa ? "pasa" : "no pasa"} (${Object.entries(c.edades).map(([e, ok]) => `${e === "letras" ? "9 años" : "5 años"} ${ok ? "sí" : "no"}`).join(", ")})`);

  check("todas las fotos tienen respuesta", v.sinRespuesta === 0, v.sinRespuesta ? `${v.sinRespuesta} sin respuesta` : `${v.fotos.length} de ${v.fotos.length}`);
  if (esControl) {
    check(
      "control: la carrera de hoy NO aprueba la prueba",
      !v.pasa,
      v.pasa ? `la aprobó (${cuenta(v.pasan)} corridas): la prueba está mal` : `${cuenta(v.pasan)} corridas pasan, hacen falta ${v.minimo}: la prueba ve el problema`,
    );
  } else {
    if ("letras" in v.porEdad) check("N1 · 9 años, con letras", v.porEdad.letras >= v.minimo, `${cuenta(v.porEdad.letras)} corridas pasan (mínimo ${v.minimo})`);
    if ("sin" in v.porEdad) check("N2 · 5 años, sin letras", v.porEdad.sin >= v.minimo, `${cuenta(v.porEdad.sin)} corridas pasan (mínimo ${v.minimo})`);
    check("el juego pasa en las dos edades", v.pasa, `${cuenta(v.pasan)} corridas pasan (mínimo ${v.minimo})`);
  }

  const aciertos = Object.fromEntries(["adelante", "hacia", "falta", "paso"].map((k) => [k, `${v.fotos.filter((f) => f.aciertos[k]).length}/${v.fotos.length}`]));
  console.log(`  aciertos por pregunta: ${Object.entries(aciertos).map(([k, x]) => `${k} ${x}`).join(" · ")}`);
  const repetir = v.fotos.filter((f) => !f.pasa && !f.desempatada).map((f) => f.id);
  writeFileSync(join(dir, "repetir.json"), `${JSON.stringify({ nota: "Fotos que fallaron con el primer describidor: que otro, más fuerte, las describa y escriba respuestas-desempate.json con el mismo formato.", ids: repetir }, null, 2)}\n`);
  writeFileSync(join(dir, "veredicto.json"), `${JSON.stringify({ juego: verdad.juego, control: esControl, personas: verdad.personas, ...v }, null, 2)}\n`);
  if (repetir.length) console.log(`  ${repetir.length} fotos para repetir con otro describidor: ${join(dir, "repetir.json")}`);

  const malos = checks.filter((c) => !c.ok);
  console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
  emitirJson({
    auditor: "audit-nino",
    objetivo: esControl ? "control" : verdad.juego,
    checks,
    datos: { personas: verdad.personas, semillas: v.semillas, pasan: v.pasan, minimo: v.minimo, porEdad: v.porEdad, aciertos, fotos: v.fotos.map((f) => ({ id: f.id, semilla: f.semilla, tamano: f.tamano, punto: f.punto, variante: f.variante, buenos: f.buenos, total: f.total })) },
  });
  process.exit(malos.length ? 1 : 0);
}

if (dirJuzgar) await juzgarCarpeta(dirJuzgar);

/* ================================================================ capturar */

if (!control && !cual) {
  console.error("uso: node scripts/audit-nino.mjs <juego|todos> [--personas 18] [--semillas 8] [--base URL] [--out carpeta]\n     node scripts/audit-nino.mjs --juzgar <carpeta>\n     node scripts/audit-nino.mjs --control");
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

/** Sin subtítulo en las dos fotos; sin la barra de arriba en la de sin letras. */
const CSS = "#commentary{display:none!important} html.nino-sin .st-top, html.nino-sin #stadium button{visibility:hidden!important}";

async function pararEn(page, hora) {
  await page.eval(`window.__reloj.meta = ${hora}; 0`);
  const r = await page.waitFor(`window.__reloj.parado && window.__nino.t() >= ${hora}`, 90_000);
  if (!r.ok) throw new Error(`el show no llegó a los ${hora.toFixed(1)} s de juego`);
  await sleep(100);
}

async function foto(page, ruta, sinLetras) {
  await page.eval(`(() => { window.__nino.sinLetras = ${sinLetras}; document.documentElement.classList.toggle('nino-sin', ${sinLetras}); if (window.__ninoRepintar) window.__ninoRepintar(); return 0; })()`);
  await sleep(250);
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(ruta, Buffer.from(data, "base64"));
}

/** Una corrida: una semilla en un tamaño. Devuelve las capturas que sacó, con su verdad. */
async function correr(browser, { juego, semilla, tam, dir }) {
  const hex = semillaDe(semilla);
  const page = await browser.open("about:blank");
  const salida = {};
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: tam.ancho, height: tam.alto, deviceScaleFactor: 1, mobile: tam.celular });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RELOJ });
    const url = `${base}/?pose=${juego === "race" ? "1" : juego}&motor=pixi&pace=normal&auditar=nino&n=${personas}&theme=${tam.tema}&semilla=${hex}&ganador=${hex}`;
    await page.send("Page.navigate", { url });
    const ok = await page.waitFor("window.__nino && window.__nino.duracion > 0 && window.__pose", 90_000);
    if (!ok.ok) throw new Error(`el juego no dejó window.__nino (¿se pidió ?auditar=nino? ¿el juego expone el gancho?)`);
    await page.eval(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(CSS)}; document.head.appendChild(s); return 0; })()`);
    const duracion = await page.eval("window.__nino.duracion");
    for (const punto of PUNTOS) {
      await pararEn(page, horaDeParada(punto, duracion));
      for (const v of variantes) {
        const id = idDeCaptura({ juego, semilla, tamano: tam.id, punto: punto.id, variante: v.id });
        await foto(page, join(dir, "capturas", `${id}.png`), v.sinLetras);
        const estado = JSON.parse(await page.eval("JSON.stringify({ verdad: window.__nino.verdad(), t: window.__nino.t(), nombres: window.__pose.names, ganadores: window.__pose.winners })"));
        salida[id] = { semilla, tamano: tam.id, punto: punto.id, variante: v.id, duracion, ...estado };
      }
    }
    await page.eval("(() => { window.__nino.sinLetras = false; if (window.__ninoRepintar) window.__ninoRepintar(); return 0; })()");
  } finally {
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
  return salida;
}

async function capturarJuego(browser, juego, dir) {
  mkdirSync(join(dir, "capturas"), { recursive: true });
  mkdirSync(join(dir, "oculto"), { recursive: true });
  const capturas = {};
  console.log(`\n${juego} · ${personas} personas · ${semillas} semillas · ${tamanos.map((t) => t.id).join(" y ")}`);
  for (let s = 1; s <= semillas; s++) {
    for (const tam of tamanos) {
      try {
        Object.assign(capturas, await correr(browser, { juego, semilla: s, tam, dir }));
        check(`semilla ${s}, ${tam.ancho}x${tam.alto}: las tres paradas`, true, `${PUNTOS.length * variantes.length} fotos`);
      } catch (e) {
        check(`semilla ${s}, ${tam.ancho}x${tam.alto}: las tres paradas`, false, String(e.message ?? e));
      }
    }
  }
  const esperadas = semillas * tamanos.length * PUNTOS.length * variantes.length;
  writeFileSync(join(dir, "preguntas.json"), `${JSON.stringify(armarPreguntas(capturas), null, 2)}\n`);
  copyFileSync(new URL("prompt-nino.md", import.meta.url), join(dir, "prompt-nino.md"));
  writeFileSync(join(dir, "oculto", "verdad.json"), `${JSON.stringify({ version: 1, juego, control, personas, semillas, base, generado: new Date().toISOString(), capturas }, null, 2)}\n`);
  check("las fotos pedidas están todas", Object.keys(capturas).length === esperadas, `${Object.keys(capturas).length} de ${esperadas}`);
  console.log(`  ${Object.keys(capturas).length} fotos y sus preguntas en ${dir}\n  que el describidor las describa (${join(dir, "prompt-nino.md")}) y después: node scripts/audit-nino.mjs ${control ? "--control " : ""}--juzgar ${dir}`);
}

const juegos = control ? ["race"] : cual === "todos" ? ["wheel", ...juegosDelKit()] : [idDeJuego(cual)];
/** Dónde queda cada juego: `--out` (con una subcarpeta por juego si son varios) o `docs/capturas/nino/<juego>`. */
const carpetaDe = (juego) => {
  const o = opt("--out", null);
  if (o) return resolve(juegos.length > 1 ? join(o, juego) : o);
  return resolve(join("docs", "capturas", "nino", control ? "control" : juego));
};
const browser = await launch({ port: Number(process.env.CDP_PORT || 9690), width: 1920, height: 1080 });
try {
  for (const juego of juegos) await capturarJuego(browser, juego, carpetaDe(juego));
} finally {
  await browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "CON FALLAS" : "CAPTURAS LISTAS"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
emitirJson({ auditor: "audit-nino", objetivo: control ? "control" : (cual ?? ""), checks });
process.exit(malos.length ? 1 : 0);
