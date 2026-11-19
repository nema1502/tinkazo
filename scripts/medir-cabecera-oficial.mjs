/**
 * Mide que, con el modo Oficial, la cuenta quede en la fila del logo en los anchos de celular y de tableta.
 *
 * Con la entrada de la red principal, la marca del modo es un botón que se ve en todos los anchos, y la
 * cabecera tiene que hacerle lugar sin mandar idioma, marca y cuenta a una segunda fila. Sin esa entrada
 * (como hoy en src/stellar/deployments.json) el botón no existe: por eso se mide sobre el build del ensayo,
 * que la trae inventada.
 *
 *   node scripts/ensayo-entrada-oficial.mjs --pasos build      (dice en qué carpeta temporal construyó)
 *   pnpm exec vite preview --outDir <esa carpeta> --port 4199 --strictPort &
 *   CDP_PORT=9771 node scripts/medir-cabecera-oficial.mjs --base http://localhost:4199 [--capturas carpeta]
 *
 * Mide en es y en, sin cuenta y con la cuenta de adentro (la cara y un nombre largo, puestos en la página: no
 * hace falta entrar). Sale con 1 si en algún ancho la cuenta cae a otra fila, si la página se corre de costado
 * o si la letra del botón baja de 14 px; con 2 si no encontró el botón (el build no trae el modo Oficial).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};
const base = opcion("--base", "http://localhost:4199").replace(/\/$/, "");
const capturas = opcion("--capturas", "");
const anchos = opcion("--anchos", "320,340,349,350,360,375,390,414,460,461,500,560,620,700,701,760,1101,1240,1439").split(",").map(Number);

const SONDA = `JSON.stringify((() => {
  const marca = document.querySelector('header .wordmark').getBoundingClientRect();
  const chip = document.querySelector('#wallet-box .cuenta-chip');
  const boton = document.querySelector('#wallet-box button.netbadge');
  const c = chip ? chip.getBoundingClientRect() : null;
  return {
    hayBoton: !!boton,
    letra: boton ? parseFloat(getComputedStyle(boton).fontSize) : 0,
    mismaFila: !!c && Math.abs(c.top + c.height / 2 - (marca.top + marca.height / 2)) < 20,
    cabecera: Math.round(document.querySelector('header').getBoundingClientRect().height),
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})())`;
// La cuenta de adentro, como la arma src/ui/cuenta-chip.ts, con un nombre de los largos.
const DENTRO = `(() => {
  const chip = document.querySelector('#wallet-box .cuenta-chip');
  chip.className = 'cuenta-chip dentro hello mini';
  chip.dataset.estado = 'dentro';
  chip.innerHTML = '<span class="cc-cara"><span class="hello-face cc-letra" aria-hidden="true">M</span></span><span class="cc-txt"><b class="cc-nombre">Mateo Emir Mejía Agreda</b><small class="cc-via"><span class="cc-via-l">Entraste con Google</span><span class="cc-via-c">Google</span></small></span>';
  return true;
})()`;

if (capturas) mkdirSync(capturas, { recursive: true });
const fallas = [];
let sinBoton = false;
const browser = await launch({ width: 390, height: 844 });
try {
  for (const lang of ["es", "en"]) {
    for (const w of anchos) {
      const p = await browser.open("about:blank");
      try {
        await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 2, mobile: w <= 760, screenWidth: w, screenHeight: 800 });
        await p.send("Page.navigate", { url: `${base}/?red=oficial&lang=${lang}&theme=light#sortear` });
        const listo = await p.waitFor("document.querySelector('#wallet-box .cuenta-chip') && document.querySelector('#wallet-box button.netbadge')", 15000);
        if (!listo.ok) {
          sinBoton = true;
          console.log(`${lang} ${w} px: no apareció el botón de la marca del modo`);
          continue;
        }
        await sleep(300);
        for (const estado of ["fuera", "dentro"]) {
          if (estado === "dentro") {
            await p.eval(DENTRO);
            await sleep(100);
          }
          const s = JSON.parse(await p.eval(SONDA));
          const ok = s.mismaFila && s.scrollX <= 1 && s.letra >= 14;
          console.log(`${ok ? "bien " : "MAL  "} ${lang} ${w} px, ${estado}: ${s.mismaFila ? "misma fila" : "OTRA FILA"}, cabecera ${s.cabecera} px, de costado ${s.scrollX} px, letra del botón ${s.letra} px`);
          if (!ok) fallas.push(`${lang} ${w} px ${estado}`);
          if (capturas) await p.screenshot(join(capturas, `cabecera-oficial-${lang}-${w}-${estado}.png`));
        }
      } finally {
        await p.send("Page.close").catch(() => undefined);
      }
    }
  }
} finally {
  await browser.close();
}
if (sinBoton) {
  console.error("No apareció el botón de la marca: ¿el build trae la entrada de la red principal? Mirá la cabecera de este archivo.");
  process.exit(2);
}
console.log(fallas.length ? `\n${fallas.length} ancho(s) con la fila partida: ${fallas.join("; ")}` : "\nLa cuenta queda en la fila del logo en todos los anchos medidos.");
process.exit(fallas.length ? 1 : 0);
