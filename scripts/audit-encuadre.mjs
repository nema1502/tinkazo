#!/usr/bin/env node
/**
 * El auditor de encuadre de la carrera: ¿la ganadora se ve entera, y el cartel
 * no tapa a nadie?
 *
 * Lo pidió el feedback de Alejandro (Vaquita y Pollar, 19 de octubre de 2026):
 * "¿probaron esto en mobile?". Con tres o cuatro personas cada llama mide más de
 * dos carriles de alto, y al final la ganadora quedaba cortada contra el borde
 * del celular y el cartel del ganador tapaba a la llama del carril de arriba.
 *
 * Con `?auditar=encuadre` la carrera anota, en la recta final, en la foto y en
 * la corona, dónde cae el cuerpo de cada llama en la pantalla (sin el nombre),
 * dónde está el cartel y dónde la caja del relator. En cada tamaño de pantalla,
 * con 2, 3, 4, 5 y 8 personas y en varias semillas (cambia el carril de la
 * ganadora y el arco), comprueba:
 *
 * - **La ganadora entera**, en toda la corona: adentro de la pantalla, debajo
 *   del cartel y encima del relator, también durante el golpe de la meta.
 * - **El cartel no tapa a ninguna otra llama** cuando la cámara ya llegó (desde
 *   1,8 s después del golpe): lo que queda de cada cuerpo debajo del cartel no
 *   pasa del 2%. Lo más tapado durante el golpe se informa aparte.
 * - **El cartel adentro de la pantalla.**
 * - **La ganadora no queda diminuta**: mide al menos el 10% del alto.
 * - **En la foto del duelo, las dos enteras** cuando la cámara ya llegó (la
 *   segunda mitad de la foto). Solo en las corridas con duelo.
 *
 * Los cuerpos son rectángulos (de la cola al hocico y de las orejas a la
 * sombra), así que mide de más: una llama "tapada" en un 2% puede no estarlo.
 *
 * Corre sin red, con la escena fija (`?pose=1&n=<personas>`), en la duración
 * rápida y con el reloj en turbo.
 * Con `--capturas <carpeta>` saca una foto de cada corrida a los `--en` segundos
 * del golpe (2,2 si no se pide otra cosa), para mirarla a ojo.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-encuadre.mjs [--base http://localhost:4173] [--n 2,3,4,5,8]
 *     [--tam 1440x900,1024x768,844x390,390x844] [--temas dark,light] [--semillas 3]
 *     [--capturas <carpeta>] [--en 2.2]
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const gentes = opt("--n", "2,3,4,5,8").split(",").map(Number);
const tams = opt("--tam", "1440x900,1024x768,844x390,390x844").split(",");
const temas = opt("--temas", "dark,light").split(",");
const SEMILLAS = Number(opt("--semillas", "3"));
const capturas = opt("--capturas", "");
const EN = Number(opt("--en", "2.2"));
/** Desde cuándo la cámara ya llegó al plano de la corona, en segundos después del golpe. */
const LLEGO = 1.8;
process.env.TINKAZO_GPU = "1";
if (capturas) mkdirSync(capturas, { recursive: true });

/**
 * El reloj en turbo, de a 1/64 de segundo por cuadro (exacto en binario). Con
 * `window.__alto`, se detiene cuando la corona pasa esos segundos, para la foto.
 */
const TURBO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0;
  const cbs = new Map();
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  window.__parado = false;
  const alto = () => {
    const e = window.__encuadre;
    const m = e && e.muestras[e.muestras.length - 1];
    return window.__alto !== undefined && !!m && m.fase === 'corona' && m.t >= window.__alto;
  };
  const bombear = () => {
    window.__parado = alto();
    for (let i = 0; i < 10 && cbs.size && !window.__parado; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 64;
      for (const cb of lote) { try { cb(virt); } catch (e) { window.__errores = (window.__errores || 0) + 1; } }
      window.__parado = alto();
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;

const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");

/** Qué parte de la caja `a` queda debajo de la caja `b`, por área de `a`. */
const tapada = (a, b) => {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return a[2] > 0 && a[3] > 0 ? (ix * iy) / (a[2] * a[3]) : 0;
};

async function correr(browser, { w, h, n, tema, seed, foto }) {
  const page = await browser.open("about:blank");
  const movil = Math.min(w, h) < 500;
  await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: movil ? 2 : 1, mobile: movil });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO + (foto ? `;window.__alto = ${EN};` : "") });
  // En la duración rápida: el encuadre del final no depende de cuánto dure la
  // carrera, y así cada corrida tarda la mitad.
  await page.send("Page.navigate", { url: `${base}/?pose=1&motor=pixi&pace=rapido&auditar=encuadre&n=${n}&theme=${tema}&semilla=${semilla(seed)}` });
  if (foto) {
    const parado = await page.waitFor("window.__parado === true", 120_000);
    if (parado.ok) {
      await sleep(300);
      await page.screenshot(foto);
      await page.eval("window.__alto = Infinity");
    }
  }
  const ok = await page.waitFor("window.__encuadre && window.__encuadre.listo", 120_000);
  const log = ok.ok ? JSON.parse(await page.eval("JSON.stringify(window.__encuadre)")) : null;
  const errores = Number(await page.eval("window.__errores || 0").catch(() => 0));
  const excepciones = [...page.exceptions];
  try {
    await page.send("Page.close");
  } catch {
    /* ya cerrada */
  }
  return { log, errores, excepciones };
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const filas = [];

const browser = await launch({ port: Number(process.env.CDP_PORT || 9481), width: 1440, height: 900 });
try {
  for (const tam of tams) {
    const [w, h] = tam.split("x").map(Number);
    for (const n of gentes) {
      for (const tema of temas) {
        // En el tema claro alcanza una semilla: el encuadre no depende del tema.
        const semillas = tema === temas[0] ? SEMILLAS : 1;
        for (let seed = 1; seed <= semillas; seed++) {
          const foto = capturas && seed === 1 ? join(capturas, `${tam}-n${n}-${tema}.png`) : "";
          const r = await correr(browser, { w, h, n, tema, seed, foto });
          const nombre = `${tam} · ${n} personas · ${tema} · semilla ${seed}`;
          if (!r.log) {
            console.log(`\n${nombre}`);
            check("la carrera corre y anota el encuadre", false, "no terminó en 120 s");
            continue;
          }
          const { ganadora: g, muestras } = r.log;
          const corona = muestras.filter((m) => m.fase === "corona");
          const conCartel = corona.filter((m) => m.cartel);
          const llego = conCartel.filter((m) => m.t >= LLEGO);
          console.log(`\n${nombre} · gana el carril ${g + 1} de ${r.log.n}${foto ? ` · ${foto}` : ""}`);
          if (r.errores + r.excepciones.length) check("sin errores", false, r.excepciones[0]?.slice(0, 100) ?? `${r.errores} errores`);
          if (!corona.length || !llego.length) {
            check("la corona se anota", false, `${corona.length} muestras, ${llego.length} con la cámara ya llegada`);
            continue;
          }
          // 1. La ganadora entera en pantalla, desde el golpe.
          let peorBorde = Infinity;
          for (const m of corona) {
            const [x, y, cw, ch] = m.cajas[g];
            peorBorde = Math.min(peorBorde, x, y, w - (x + cw), h - (y + ch));
          }
          check("la ganadora entera en la pantalla, desde el golpe", peorBorde >= -1, `lo más cerca de un borde: ${peorBorde.toFixed(1)} px`);
          // 2. Debajo del cartel y encima del relator.
          let pisaCartel = -Infinity, pisaRelator = -Infinity;
          for (const m of conCartel) {
            const [, y, , ch] = m.cajas[g];
            pisaCartel = Math.max(pisaCartel, m.cartel[1] + m.cartel[3] - y);
            if (m.relator && m.relator[3] > 0) pisaRelator = Math.max(pisaRelator, y + ch - m.relator[1]);
          }
          check(
            "la ganadora debajo del cartel y encima del relator",
            pisaCartel <= 1 && pisaRelator <= 1,
            `el cartel le llega a ${Math.max(0, pisaCartel).toFixed(1)} px, el relator a ${Math.max(0, pisaRelator).toFixed(1)} px`,
          );
          // 3. El cartel no tapa a otra, con la cámara ya en su lugar.
          let tapaLlego = 0, tapaGolpe = 0;
          for (const m of conCartel) {
            m.cajas.forEach((c, k) => {
              if (k === g) return;
              const t = tapada(c, m.cartel);
              tapaGolpe = Math.max(tapaGolpe, t);
              if (m.t >= LLEGO) tapaLlego = Math.max(tapaLlego, t);
            });
          }
          check("el cartel no tapa a ninguna otra llama", tapaLlego <= 0.02, `lo más tapado: ${pct(tapaLlego)} ya quieta, ${pct(tapaGolpe)} durante el golpe`);
          // 4. El cartel adentro de la pantalla.
          const c = llego[llego.length - 1].cartel;
          const cartelAdentro = c[0] >= -1 && c[1] >= -1 && c[0] + c[2] <= w + 1 && c[1] + c[3] <= h + 1;
          check("el cartel adentro de la pantalla", cartelAdentro, `${c.map(Math.round).join(", ")}`);
          // 5. Que no quede diminuta.
          const altos = llego.map((m) => m.cajas[g][3] / h).sort((a, b) => a - b);
          const alto = altos[Math.floor(altos.length / 2)];
          const enteras = llego[llego.length - 1].cajas.filter((cc) => cc[0] >= -1 && cc[1] >= -1 && cc[0] + cc[2] <= w + 1 && cc[1] + cc[3] <= h + 1).length;
          check("la ganadora no queda diminuta", alto >= 0.1, `mide el ${pct(alto)} del alto · ${enteras} de ${r.log.n} llamas enteras en pantalla · acercamiento ${llego[llego.length - 1].z}`);
          // 6. En la foto del duelo, las dos enteras cuando la cámara ya llegó
          // (la segunda mitad de la foto): la foto mira a las dos por igual.
          const fotos = muestras.filter((m) => m.fase === "foto");
          let fotoBorde = null;
          if (r.log.arco === "duelo" && fotos.length) {
            fotoBorde = Infinity;
            for (const m of fotos.slice(Math.floor(fotos.length / 2))) {
              for (const k of [g, r.log.rival]) {
                const [x, y, cw, ch] = m.cajas[k];
                fotoBorde = Math.min(fotoBorde, x, y, w - (x + cw), h - (y + ch));
              }
            }
            check("en la foto, las dos del duelo enteras", fotoBorde >= -1, `lo más cerca de un borde: ${fotoBorde.toFixed(1)} px`);
          }
          filas.push({ tam, n, tema, seed, carril: g + 1, arco: r.log.arco, borde: peorBorde, tapa: tapaLlego, golpe: tapaGolpe, alto, enteras, foto: fotoBorde });
        }
      }
    }
  }
} finally {
  await browser.close();
}

console.log("\nResumen (ya quieta):");
console.log("  pantalla    gente tema  sem carril arco        borde px  tapa   golpe  alto   enteras  foto px");
for (const f of filas) {
  console.log(
    `  ${f.tam.padEnd(10)} ${String(f.n).padStart(5)}  ${f.tema.padEnd(5)} ${String(f.seed).padStart(3)} ${String(f.carril).padStart(6)} ${f.arco.padEnd(10)} ${f.borde.toFixed(1).padStart(8)}  ${pct(f.tapa).padStart(5)}  ${pct(f.golpe).padStart(5)}  ${pct(f.alto).padStart(5)}  ${`${f.enteras}/${Math.min(8, f.n)}`.padStart(7)}  ${f.foto === null ? "·" : f.foto.toFixed(1)}`,
  );
}
const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
process.exit(malos.length ? 1 : 0);
