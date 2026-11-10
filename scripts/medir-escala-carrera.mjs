#!/usr/bin/env node
/**
 * La escala de la carrera de llamas: cuántos píxeles de alto miden las finalistas en la recta, las de punta en los últimos 3 s
 * y la ganadora en el festejo, en 1080p y en el celular, y cuánto de la pantalla tapa la tarjeta de nombres en el celular.
 *
 *   CDP_PORT=9760 node scripts/medir-escala-carrera.mjs [--base http://localhost:4173] [--semillas 16]
 *     [--personas 8,18,60] [--motores pixi,3d] [--vistas proyector,celular] [--json archivo]
 *
 * Con Chrome y la placa de video, el reloj en turbo (como `audit-emocion`), `?auditar=encuadre,camara` y 16 semillas por tamaño,
 * en 2D (`pixi`) y en 3D. No mira la imagen: lee de la carrera (`window.__encuadre`, ver `carrera.ts`) dónde cae en la pantalla
 * la caja de cada llama en cada cuadro (el 2D por su cámara; el 3D, de la cabeza al pie por la cámara de ese cuadro) y el
 * fondo de la tarjeta de nombres. Las metas son las de la sección 4 de la dirección (`scripts/lib/escala-carrera.mjs`): en
 * 1080p, la mediana de la recta de 150 px o más, ninguna bajo 100, las de punta de 200 a 450 en los últimos 3 s y la ganadora de
 * 300 o más en el festejo; en el celular, las de la recta de 70 px o más y la tarjeta en el 25 % de la pantalla o menos.
 * Imprime las tablas y sale con error (1) si alguna meta no se cumple o si una corrida no se pudo medir (sin gancho, o el
 * motor pedido no fue el que dibujó). Un Chrome a la vez y con su propio puerto: `CDP_PORT`.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { launch } from "./lib/browser.mjs";
import { alturasPorTramo, estadisticas, evaluarEscala, tarjetaEnPantalla } from "./lib/escala-carrera.mjs";
import { tablaDeMetas } from "./lib/drama-show.mjs";
import { esperarRam } from "./lib/ram.mjs";
import { relojTurbo } from "./lib/reloj-turbo.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
process.env.TINKAZO_GPU = "1";
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const semillas = Number(opt("--semillas", "16"));
const personas = opt("--personas", "8,18,60").split(",").map(Number);
const motores = opt("--motores", "pixi,3d").split(",");
const json = opt("--json", "");
const VISTAS = {
  proyector: { w: 1920, h: 1080, movil: false, dpr: 1 },
  celular: { w: 390, h: 844, movil: true, dpr: 2 },
};
const vistas = opt("--vistas", "proyector,celular").split(",");
const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");
const TURBO = relojTurbo();

const salida = {};
const fallan = [];
await esperarRam();
const chrome = await launch({ port: Number(process.env.CDP_PORT || 9760), width: 1280, height: 720 });
try {
  for (const motor of motores) {
    for (const vista of vistas) {
      const v = VISTAS[vista];
      for (const n of personas) {
        const recta = [], final = [], festejo = [];
        let tarjetaMax = 0, sobre = 0, visible = 0, sinCorrer = 0, sinVer = 0;
        const porSemilla = [];
        for (let i = 1; i <= semillas; i++) {
          console.log(`  corrida ${i}/${semillas} (${motor}, ${vista}, ${n} personas)`);
          const page = await chrome.open("about:blank");
          await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.movil, screenWidth: v.w, screenHeight: v.h });
          await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
          await page.send("Page.navigate", { url: `${base}/?pose=1&n=${n}&motor=${motor}&pace=normal&auditar=encuadre,camara&semilla=${semilla(i)}` });
          const ok = await page.waitFor("window.__encuadre && window.__encuadre.listo", 180_000);
          const log = ok.ok ? JSON.parse(await page.eval("JSON.stringify(window.__encuadre)")) : null;
          try {
            await page.send("Page.close");
          } catch {
            /* ya cerrada */
          }
          // El gancho tiene que estar y el motor tiene que ser el pedido: si el 3D cae al 2D, no es una medida del 3D.
          if (!log || (motor === "3d") !== (log.motor === "3d")) {
            sinCorrer++;
            continue;
          }
          const a = alturasPorTramo(log.muestras, { tAbre: log.tAbre, tCrown: log.tCrown, ganadora: log.ganadora, w: v.w, h: v.h });
          recta.push(...a.recta);
          final.push(...a.final);
          festejo.push(...a.festejo);
          sinVer += a.sinVer;
          const t = tarjetaEnPantalla(log.muestras, v.w, v.h);
          tarjetaMax = Math.max(tarjetaMax, t.maximo);
          sobre = Math.max(sobre, t.segundosSobre);
          visible = Math.max(visible, t.segundosVisible);
          porSemilla.push({ semilla: i, ganadora: log.ganadora, arco: log.arco, recta: estadisticas(a.recta).mediana, festejo: estadisticas(a.festejo).mediana, tarjeta: t.maximo });
        }
        const a = { recta: estadisticas(recta), final: estadisticas(final), festejo: estadisticas(festejo) };
        // La tarjeta solo se exige en el celular.
        const t = vista === "celular" ? { maximo: tarjetaMax, segundosSobre: sobre, segundosVisible: visible } : null;
        const metas = evaluarEscala(vista, a, t);
        if (sinCorrer) metas.push({ clave: "sinCorrer", nombre: "corridas que no se pudieron medir (sin gancho o el motor no fue el pedido)", valor: sinCorrer, texto: `${sinCorrer} de ${semillas}`, meta: "ninguna", ok: false });
        const titulo = `\n${motor === "3d" ? "3D" : "2D (PixiJS)"}, ${vista === "celular" ? "celular 390x844" : "1080p"}, ${n} personas, ${semillas} semillas, reloj en turbo (${a.recta.n} medidas de la recta, ${sinVer} fuera de la vista)`;
        console.log(tablaDeMetas(metas, titulo));
        for (const m of metas.filter((x) => !x.ok)) fallan.push(`${motor === "3d" ? "3D" : "2D"}, ${vista}, ${n} personas: ${m.nombre} ${m.texto} (meta ${m.meta})`);
        salida[`${motor}-${vista}-n${n}`] = { recta: a.recta, final: a.final, festejo: a.festejo, tarjeta: t, sinCorrer, sinVer, metas, porSemilla };
      }
    }
  }
} finally {
  await chrome.close();
}

console.log(`\n${fallan.length ? "NO CUMPLE" : "CUMPLE"}: ${fallan.length} medida(s) fuera de la meta`);
for (const f of fallan) console.log(`  ✗ ${f}`);
if (json) {
  writeFileSync(json, JSON.stringify({ ...salida, fallan }, null, 1));
  console.log(`detalle en ${json}`);
}
process.exit(fallan.length ? 1 : 0);
