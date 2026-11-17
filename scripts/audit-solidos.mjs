#!/usr/bin/env node
/**
 * El auditor de sólidos de la carrera: que nada atraviese nada.
 *
 * Sin navegador: arma cada ronda con el plan (`planCarrera`), el lugar de cada llama con el módulo puro que dibuja la escena
 * (`crearTrayectorias`) y la lista de rocas, y mide a 60 cuadros por segundo, desde la salida hasta la meta, cuánto se encima cada
 * cuerpo con cada sólido y con cada otro cuerpo. La geometría es genérica (`scripts/lib/solidos.mjs`): cualquier juego que vuelque
 * sus cuerpos y sus sólidos en el plano del mundo entra con el mismo medidor; la carrera es la primera que lo usa
 * (`scripts/lib/solidos-carrera.mjs`), con la huella del 3D, que es la más grande.
 *
 * Las filas: llama-roca, llama-mata, llama-piedrita (la piedra chica que se salta: las patas por encima, sin ningún roce), llama-poste,
 * llama-cerca, llama-valla sin permiso (los saltos que no saltan y los choques que
 * pasan su máximo), llama-echada, echada-echada (dos que descansan, mientras dura el grupo), llama-llama en el grupo (la regla M8 de
 * la dirección), llama-llama al pasar a los carriles, llama-piedra del cerro (las piedras que caen en la recta, contra todas las
 * finalistas), cruces (pares de finalistas que cambian de lado durante el paso a los carriles, que tienen que dar cero) y reproducible.
 * Antes de la salida, en las tandas: llama-llama en el corral antes de la salida (dos que ya cruzaron el portón), llama-llama en las
 * tandas (la que sale contra las que esperan su turno y contra otra que sale, antes del portón) y llama-echada en las tandas (la que sale
 * contra las que no pasaron, echadas en su lugar). Las tres cuentan: la cámara de las tandas las tiene a la vista.
 *
 * Columnas que no cambian el veredicto: en cuántas rondas pasó, cuántos episodios hubo (un par que pasa el umbral en cuadros
 * seguidos) y cuánto duró el más largo; los cruces y las vallas, que son puntuales, solo dicen en cuántas rondas. Y una línea con
 * las rocas y las matas por ronda en cada pantalla.
 *
 * Uso:
 *   node scripts/audit-solidos.mjs [--rondas 300] [--n 8,18,30,60,200] [--motor 3d|2d] [--json archivo]
 *   CDP_PORT=<puerto> node scripts/audit-solidos.mjs --navegador [--base http://localhost:4173] [--motores pixi,3d] [--vistas 1366x768,390x844]
 *     [--semillas 7a1,c33] [--n 8,18,60] [--json archivo]
 *
 * Con `--navegador` mide lo que la escena dibujó de verdad, en el sitio construido (`?pose=1&auditar=solidos`, con el reloj en turbo): que
 * los sólidos fijos que dibujó el motor sean los que calculó la escena (a medio píxel en el piso y con su alto; en el 3D se leen de las
 * instancias de three.js) y que en lo dibujado nada atraviese nada (`scripts/lib/solidos-navegador.mjs`). Llama contra llama sale aparte,
 * a mirar: es de otro plan.
 *
 * Las rondas se reparten entre las cuatro pantallas (1366x768, 1920x1080, 844x390 y 390x844). Con `--motor 2d` los cuerpos y las
 * piedras del cerro se miden con la huella y el tamaño del 2D (las rocas, igual que en la escena, se siembran con la del 3D). Sale con
 * código 1 si alguna fila que cuenta se pasa de su umbral.
 */
import { writeFileSync } from "node:fs";
import { cargarCarrera } from "./lib/delatores-carrera.mjs";
import { cargarSolidos, medirRonda, PANTALLAS_SOLIDOS, rocasPorRonda, sumarRocas } from "./lib/solidos-carrera.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const rondas = Number(opt("--rondas", "300"));
const tamanos = opt("--n", "8,18,30,60,200").split(",").map(Number);
const jsonSalida = opt("--json", "");
const motor = opt("--motor", "3d");
if (motor !== "3d" && motor !== "2d") {
  console.error(`--motor tiene que ser 3d o 2d, no ${motor}`);
  process.exit(2);
}

const checks = [];
const check = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok, detalle });
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
};
const f = (x, d = 2) => Number(x).toFixed(d);
/**
 * Las filas que cuentan para el veredicto. Las de las tandas (`medirTandas` en `scripts/lib/solidos-carrera.mjs`) antes se miraban sin
 * contar: la que sale de su lugar atravesaba a las que esperan en ocho de cada diez carreras con 60 personas, a la vista de la cámara, y el
 * cero del veredicto no lo decía.
 */
const CUENTA = ["llama-roca", "llama-mata", "llama-piedrita", "llama-poste", "llama-cerca", "llama-valla sin permiso", "llama-echada", "echada-echada", "llama-llama en el corral antes de la salida", "llama-llama en las tandas", "llama-echada en las tandas", "llama-llama en el grupo", "llama-llama al pasar a los carriles", "llama-piedra del cerro", "cruces", "choques que pasan su máximo", "saltos que no saltan"];
/** Las filas puntuales: cada cruce y cada salto es un hecho de un instante, sin episodios que contar. */
const PUNTUALES = new Set(["cruces", "llama-valla sin permiso", "choques que pasan su máximo", "saltos que no saltan"]);
const filaVacia = () => ({ cuadros: 0, peor: 0, ronda: 0, t: 0, quien: null, otro: null, rondas: 0, episodios: 0, largo: 0 });

const lib = await cargarCarrera();
const M = await cargarSolidos();

if (args.includes("--navegador")) {
  const { launch, sleep } = await import("./lib/browser.mjs");
  const { relojTurbo } = await import("./lib/reloj-turbo.mjs");
  const { medirVolcadoCarrera } = await import("./lib/solidos-navegador.mjs");
  const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
  const motores = opt("--motores", "pixi,3d").split(",");
  const vistas = opt("--vistas", "1366x768,390x844").split(",").map((v) => v.split("x").map(Number));
  const semillas = opt("--semillas", "7a1,c33").split(",");
  const ns = (args.includes("--n") ? opt("--n", "8,18,60") : "8,18,60").split(",").map(Number);
  const hex64 = (s) => (s.replace(/[^0-9a-f]/gi, "").toLowerCase().repeat(64) || "a").slice(0, 64);
  process.env.TINKAZO_GPU = "1";
  const FILAS = ["llama-roca", "llama-mata", "llama-piedrita", "llama-piedra del cerro", "choques que pasan su máximo"];
  const total = {};
  const corridas = [];
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9842), width: 1366, height: 768 });
  try {
    for (const motor of motores) {
      const tot = (total[motor] = { filas: Object.fromEntries([...FILAS, "llama-llama (a mirar)"].map((k) => [k, { cuadros: 0, peor: 0, donde: "" }])), piso: 0, altoMin: Infinity, altoMax: 0, sinPareja: 0, cuadros: 0, tropiezos: 0 });
      for (const [W, H] of vistas) {
        for (const n of ns) {
          for (const s of semillas) {
            const sem = hex64(s);
            const page = await browser.open("about:blank");
            await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < H });
            await page.send("Page.addScriptToEvaluateOnNewDocument", { source: relojTurbo({ lote: 8 }) });
            await page.send("Page.navigate", { url: `${base}/?pose=1&semilla=${sem}&ganador=${sem}&n=${n}&motor=${motor}&auditar=solidos&lang=es` });
            let listo = false;
            for (let i = 0; i < 600 && !listo; i++) {
              await sleep(500);
              try {
                listo = (await page.send("Runtime.evaluate", { expression: "!!(window.__solidos && window.__solidos.done)", returnByValue: true }, 10_000)).result?.value === true;
              } catch {
                /* ocupada */
              }
            }
            const donde = `${motor} ${W}x${H} ${n} personas, semilla ${s}`;
            if (!listo) {
              check(`${donde}: termina`, false, "la carrera no llegó al final");
              try { await page.send("Page.close"); } catch { /* ya cerrada */ }
              continue;
            }
            const v = JSON.parse((await page.send("Runtime.evaluate", { expression: "JSON.stringify(window.__solidos)", returnByValue: true }, 60_000)).result.value);
            try { await page.send("Page.close"); } catch { /* ya cerrada */ }
            const m = medirVolcadoCarrera(M, v);
            corridas.push({ donde, filas: m.filas, fijos: m.fijos, cuadros: v.cuadros.length, motor: v.motor, tropiezo: v.tropiezo });
            if (v.motor !== (motor === "3d" ? "3d" : "pixi")) check(`${donde}: dibuja con el motor pedido`, false, `dibujó con ${v.motor}`);
            tot.cuadros += v.cuadros.length;
            if (v.tropiezo) tot.tropiezos++;
            for (const [k, f] of Object.entries(m.filas)) {
              const tf = tot.filas[k];
              tf.cuadros += f.cuadros;
              if (f.peor > tf.peor) Object.assign(tf, { peor: f.peor, donde: `${donde} a los ${f.t.toFixed(2)} s, llama ${f.quien}` });
            }
            tot.piso = Math.max(tot.piso, m.fijos.piso);
            tot.altoMin = Math.min(tot.altoMin, m.fijos.altoMin);
            tot.altoMax = Math.max(tot.altoMax, m.fijos.altoMax);
            tot.sinPareja += m.fijos.sinPareja;
            console.log(`  ${donde}: ${v.cuadros.length} cuadros, ${m.fijos.dibujados} sólidos fijos dibujados${v.tropiezo ? ", con tropiezo" : ""}`);
          }
        }
      }
      console.log(`\n${motor === "3d" ? "3D" : "2D"}, con navegador: ${tot.cuadros} cuadros volcados, ${tot.tropiezos} carreras con tropiezo`);
      check(`${motor}: lo dibujado es lo calculado`, tot.piso <= 0.5 && tot.sinPareja === 0 && tot.altoMax <= 1.02 && (tot.altoMin === Infinity || tot.altoMin >= 0.98), `en el piso ${f(tot.piso, 3)} px como mucho, el alto dibujado de ${f(tot.altoMin === Infinity ? 1 : tot.altoMin, 3)} a ${f(tot.altoMax || 1, 3)} veces el calculado, ${tot.sinPareja} sin pareja`);
      for (const k of FILAS) {
        const tf = tot.filas[k];
        check(`${motor}: ${k}`, tf.cuadros === 0, tf.cuadros ? `${tf.cuadros} cuadros · peor ${f(tf.peor * 100, 0)} % · ${tf.donde}` : "sin cuadros");
      }
      const ll = tot.filas["llama-llama (a mirar)"];
      console.log(`  · llama-llama, a mirar (es de otro plan): ${ll.cuadros} cuadros${ll.cuadros ? `, peor ${f(ll.peor * 100, 0)} %` : ""}`);
    }
  } finally {
    await browser.close();
  }
  const malos = checks.filter((c) => !c.ok);
  console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
  if (jsonSalida) writeFileSync(jsonSalida, JSON.stringify({ navegador: true, checks, total, corridas }, null, 1));
  emitirJson({ auditor: "audit-solidos", objetivo: "race", navegador: true, checks });
  process.exit(malos.length ? 1 : 0);
}
const datos = {};
const rocasDatos = {};

console.log(`\nSólidos de la carrera, sin navegador: ${rondas} rondas por cantidad, repartidas entre ${PANTALLAS_SOLIDOS.map(([w, h]) => `${w}x${h}`).join(", ")}, a 60 cuadros por segundo, con la huella del ${motor === "2d" ? "2D" : "3D"}`);
for (const n of tamanos) {
  const filas = {};
  const rocasN = new Map();
  let tAbrePrimera = 0;
  let tropiezos = 0;
  for (let i = 1; i <= rondas; i++) {
    const [W, H] = PANTALLAS_SOLIDOS[(i - 1) % PANTALLAS_SOLIDOS.length];
    const { datos: d, filas: deLaRonda, rocas } = medirRonda(M, lib, n, i, W, H, { motor });
    if (i === 1) tAbrePrimera = d.tAbre;
    if (rocas.tropiezo) tropiezos++;
    sumarRocas(rocasN, `${W}x${H}`, rocas);
    for (const [clave, fila] of Object.entries(deLaRonda)) {
      const total = (filas[clave] ??= filaVacia());
      total.cuadros += fila.cuadros;
      if (fila.peor > total.peor) Object.assign(total, { peor: fila.peor, ronda: fila.ronda, t: fila.t, quien: fila.quien, otro: fila.otro });
      if (fila.cuadros > 0) total.rondas++;
      total.episodios += fila.episodios ?? 0;
      total.largo = Math.max(total.largo, fila.largo ?? 0);
    }
    // La valla se anota en dos filas propias; la fila madre queda como su suma, con el peor de las dos.
    {
      const madre = (filas["llama-valla sin permiso"] ??= filaVacia());
      const salto = filas["saltos que no saltan"], choque = filas["choques que pasan su máximo"];
      madre.cuadros = (salto?.cuadros ?? 0) + (choque?.cuadros ?? 0);
      const peorFila = (salto?.peor ?? 0) >= (choque?.peor ?? 0) ? salto : choque;
      if (peorFila && peorFila.peor > madre.peor) Object.assign(madre, { peor: peorFila.peor, ronda: peorFila.ronda, t: peorFila.t, quien: peorFila.quien });
      madre.peor = Math.max(salto?.peor ?? 0, choque?.peor ?? 0);
      if ((deLaRonda["saltos que no saltan"]?.cuadros ?? 0) + (deLaRonda["choques que pasan su máximo"]?.cuadros ?? 0) > 0) madre.rondas++;
    }
  }
  console.log(`\n${n} personas (la recta de la primera ronda se abre a los ${f(tAbrePrimera, 1)} s)`);
  for (const clave of CUENTA) {
    const fila = filas[clave] ?? filaVacia();
    // Lo que no cambia el veredicto: en cuántas rondas pasó y, en las filas que se miran cuadro a cuadro, los episodios.
    const columnas = !fila.cuadros
      ? ""
      : PUNTUALES.has(clave)
        ? `; en ${fila.rondas} de ${rondas} rondas`
        : `; en ${fila.rondas} de ${rondas} rondas, ${fila.episodios} episodios, el más largo de ${f(fila.largo / 60)} s`;
    if (clave === "cruces") {
      const detalle = fila.cuadros
        ? `${fila.cuadros} pares cruzados, peor ronda con ${f(fila.peor, 0)} pares, ronda ${fila.ronda} a los ${f(fila.t, 1)} s${columnas}`
        : "sin pares cruzados";
      check(clave, fila.cuadros === 0, detalle);
      continue;
    }
    const detalle = fila.cuadros
      ? `${fila.cuadros} cuadros encimados · peor ${f(fila.peor * 100, 0)} % · ronda ${fila.ronda} a los ${f(fila.t, 1)} s · llama ${fila.quien}${fila.otro !== null && fila.otro !== undefined ? ` contra ${fila.otro}` : ""}${columnas}`
      : `sin cuadros encimados · peor ${f(fila.peor * 100, 0)} %`;
    check(clave, fila.cuadros === 0, detalle);
  }
  // Informativo: cuántas rocas y matas quedan por ronda en cada pantalla, para ver si un cambio en la pista las barre.
  const porPantalla = rocasPorRonda(rocasN);
  console.log(`  rocas y matas por ronda: ${porPantalla.map((r) => `${r.pantalla} ${f(r.rocas, 1)} rocas y ${f(r.matas, 1)} matas`).join(", ")}`);
  console.log(`  rondas con tropiezo en una piedrita: ${tropiezos} de ${rondas}`);
  datos[n] = filas;
  rocasDatos[n] = porPantalla;
}

// La misma ronda da los mismos números, medida dos veces.
{
  const [W, H] = PANTALLAS_SOLIDOS[0];
  const a = medirRonda(M, lib, 18, 1, W, H, { motor }).filas;
  const b = medirRonda(M, lib, 18, 1, W, H, { motor }).filas;
  check("reproducible: la misma ronda da los mismos números", JSON.stringify(a) === JSON.stringify(b), "18 personas, ronda 1, 1366x768");
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
if (jsonSalida) writeFileSync(jsonSalida, JSON.stringify({ motor, checks, datos, rocas: rocasDatos }, null, 1));
emitirJson({ auditor: "audit-solidos", objetivo: "race", motor, checks, datos });
process.exit(malos.length ? 1 : 0);
