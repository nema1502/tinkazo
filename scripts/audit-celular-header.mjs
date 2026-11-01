#!/usr/bin/env node
/** Cabecera real con estados sintéticos: no autentica, firma ni escribe en servicios externos. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { findChrome, sleep } from "./lib/browser.mjs";
// PLAYWRIGHT_PATH permite usar una instalación existente, sin cambiar dependencias.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "playwright");

const args = process.argv.slice(2);
const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
if (args.includes("--help")) {
  console.log("Uso: node scripts/audit-celular-header.mjs [--base http://127.0.0.1:5173] [--out .evidence/celular/header/after] [--screenshots docs/capturas/celular/header/after] [--widths 320,360,375,414,1024,1440] [--source REF] [--compare-css ARCHIVO_BASE]\nRequiere Vite (importa los módulos TS de producción). Estados sintéticos, Chrome limpio, sin servicios externos. CDP_PORT selecciona el puerto exclusivo.");
  process.exit(0);
}
const base = opt("--base", "http://127.0.0.1:5173");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error("Usá un servidor local, nunca producción.");
const out = opt("--out", ".evidence/celular/header/after");
const shots = opt("--screenshots", "docs/capturas/celular/header/after");
// No permite que un error de invocación deje evidencia fuera de la unidad.
if (!out.startsWith(".evidence/celular/header/") || !shots.startsWith("docs/capturas/celular/header/")) throw new Error("Rutas fuera de la unidad header.");
await mkdir(out, { recursive: true });
await mkdir(shots, { recursive: true });
const widths = opt("--widths", "320,360,375,414,1024,1440").split(",").map(Number);
const baselineCss = args.includes('--compare-css') ? await readFile(opt('--compare-css'), 'utf8') : null;
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) console.log(`✗ ${name}: ${JSON.stringify(detail)}`); };
const hashes = {};
for (const p of ["index.html", "src/styles.css", "src/ui/cuenta-chip.ts", "src/ui/menu.ts", "scripts/audit-celular-header.mjs"]) {
  hashes[p] = createHash("sha256").update(await readFile(p)).digest("hex");
}
const chrome = await chromium.launch({ executablePath:findChrome(), headless:true, args:[`--remote-debugging-port=${Number(process.env.CDP_PORT || 9611)}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const browser = {
  async open() {
    const context = await chrome.newContext();
    const page = await context.newPage();
    // La otra unidad puede escribir mientras medimos: evita recargas HMR, no los módulos reales.
    await page.addInitScript(() => {
      const Original = window.WebSocket;
      window.WebSocket = class extends Original {
        constructor(url, protocols) {
          if (protocols === 'vite-hmr') return Object.assign(new EventTarget(), { readyState:1, send() {}, close() {} });
          super(url, protocols);
        }
      };
    });
    const cdp = await context.newCDPSession(page);
    const exceptions = [];
    page.on('pageerror', e => exceptions.push(e.message));
    return {
      exceptions,
      send: (method, params) => method === 'Page.close' ? context.close() : method === 'Page.navigate' ? page.goto(params.url, {waitUntil:'load'}) : cdp.send(method, params),
      eval: expression => page.evaluate(expression),
      async screenshot(path) {
        const {data} = await cdp.send('Page.captureScreenshot', {format:'png'});
        await writeFile(path, Buffer.from(data,'base64'));
      },
      async waitFor(expression, timeout) {
        const start=Date.now();
        while(Date.now()-start<timeout) {
          try { if(await page.evaluate(expression)) return {ok:true}; } catch { /* navegación en curso */ }
          await sleep(50);
        }
        return {ok:false};
      },
    };
  },
  close: () => chrome.close(),
};
try {
  for (const page of ["/", "/juegos.html"]) for (const lang of ["es", "en"]) for (const theme of ["light", "dark"]) for (const width of widths) {
    const r = await browser.open("about:blank");
    await r.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width <= 760 });
    await r.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.clear(); sessionStorage.clear(); const original = window.fetch; window.fetch = (url, opts) => { const u = new URL(typeof url === 'string' ? url : url.url, location.href); return u.origin === location.origin ? original(url, opts) : Promise.reject(new Error('Auditor: servicio externo bloqueado')); };` });
    await r.send("Network.enable");
    await r.send("Network.setBlockedURLs", { urls: ["https://*", "http://localhost:*/api/*"] });
    await r.send("Page.navigate", { url: `${base}${page}?lang=${lang}&theme=${theme}` });
    if (!(await r.waitFor("document.querySelector('header .cuenta-chip') && document.querySelector('.mas-lista a[href=\"/#como-se-usa\"]')", 15000)).ok) throw new Error(`No arrancó ${page}`);
    for (const state of ["fuera", "conectando", "retomando", "dentro", "red-incorrecta"]) {
      // Reutiliza la fábrica y normalización reales, no una copia del HTML del chip.
      await r.eval(`(async () => {
        const { crearChip } = await import('/src/ui/cuenta-chip.ts');
        const { estadoCuenta } = await import('/src/ui/cuenta-estado.ts');
        const { texto } = await import('/src/idioma.ts');
        const state = ${JSON.stringify(state)};
        const box = document.querySelector('#wallet-box') || document.querySelector('.pg-auth').parentElement;
        if (box.id) box.replaceChildren(); else box.querySelector('.pg-auth').remove();
        const e = estadoCuenta({ sesion: ['dentro','red-incorrecta'].includes(state) ? { label:'Google', address:'fixture', name:'ana@example.invalid', mail:'ana@example.invalid' } : null, conectando:state==='conectando', retomando:state==='retomando' });
        if (box.id && e.estado === 'dentro') {
          const net = document.createElement('span'); net.className = 'netbadge' + (state === 'red-incorrecta' ? ' bad' : ''); net.textContent = texto('netTest'); box.append(net);
        }
        const chip = crearChip(e, { tx:texto, ...(box.id ? {} : { enlace:'/#sortear' }) });
        if (!box.id) chip.classList.add('pg-auth'); box.append(chip);
      })()`);
      const label = `${page} ${width} ${lang} ${theme} ${state}`;
      const probe = `(() => {
        const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
        const logo=document.querySelector('.wordmark'), langs=document.querySelector('.langs'), chip=document.querySelector('header .cuenta-chip'), nav=document.querySelector('.topnav');
        const items=[logo,...langs.querySelectorAll('button'),chip,...nav.querySelectorAll(':scope > a, .mas-btn')].filter(el=>el.getBoundingClientRect().width);
        const boxes=items.map(rect);
        const overlaps=boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1));
        const hit=items.every(el=> { const b=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)); });
        const row1=[logo,langs,chip].map(rect);
        const row2=[nav.querySelector('.nav-app'),nav.querySelector('a[href="/#mis-sorteos"]'),nav.querySelector('.mas-btn')].map(rect);
        return {row1,row2, boxes, overlaps:overlaps.length,hit, scroll:document.documentElement.scrollWidth-innerWidth, email:document.querySelector('header').textContent.includes('@'), small:boxes.filter(b=>b.w<44 || b.h<44), clipped:boxes.filter(b=>b.x<0 || b.right>innerWidth+0.1), nav:rect(nav), header:rect(document.querySelector('header')), fixed:getComputedStyle(document.querySelector('header')).position};
      })()`;
      const geometry = await r.eval(probe);
      // Compara los mismos estados públicos de escritorio con una copia aislada del CSS anterior.
      if (baselineCss && width > 760) {
        await r.eval(`(() => {
          const style=document.querySelector('style[data-vite-dev-id$="/src/styles.css"]');
          window.__headerCss=style.textContent; style.textContent=${JSON.stringify(baselineCss)};
          const side=document.querySelector('.header-lado'); if(side) side.setAttribute('style','display:flex; gap:14px; align-items:center');
        })()`);
        const previous = await r.eval(probe);
        await r.eval(`(() => { document.querySelector('style[data-vite-dev-id$="/src/styles.css"]').textContent=window.__headerCss; document.querySelector('.header-lado')?.removeAttribute('style'); })()`);
        check(`${label}: geometría pública idéntica a la base`, JSON.stringify(previous) === JSON.stringify(geometry), {previous,current:geometry});
      }
      if (width <= 760) check(`${label}: exactamente dos filas y orden`, geometry.row1.every(b => b.y < geometry.row2[0].y && b.bottom <= geometry.row2[0].y + 1) && Math.max(...geometry.row1.map(b=>b.y)) < Math.min(...geometry.row1.map(b=>b.bottom)) && geometry.row2.every(b => Math.abs(b.y-geometry.row2[0].y)<1) && geometry.row2.every((b,i,a)=>i===0 || b.x>=a[i-1].right), geometry);
      check(`${label}: sin recorte, solapamiento ni scroll; blancos 44×44; correo ausente`, !geometry.overlaps && geometry.hit && geometry.scroll <= 1 && (width > 760 || !geometry.small.length) && !geometry.clipped.length && !geometry.email, geometry);
      if (width === 1440) check(`${label}: escritorio conserva cabecera fija de una fila`, geometry.fixed === 'sticky' && geometry.nav.y < geometry.row1[0].bottom, geometry);
      // Solo seis capturas representativas por corrida; conserva los errores en el JSON completo.
      if (page === "/" && width === 320 && ((lang === "es" && theme === "light") || (lang === "en" && theme === "dark" && state === "dentro"))) await r.screenshot(join(shots, `${width}-${lang}-${theme}-${state}.png`));
    }
    if (width <= 760) {
      const menu = await r.eval(`(() => {
        const btn=document.querySelector('.mas-btn'), mas=btn.parentElement;
        const open=()=>btn.getAttribute('aria-expanded')==='true' && mas.classList.contains('abierto');
        btn.click(); const a=open(); btn.click(); const b=!open(); btn.click(); document.body.click(); const c=!open();
        btn.click(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); const d=!open() && document.activeElement===btn;
        btn.click(); const list=document.querySelector('.mas-lista').getBoundingClientRect(); const fits=list.left>=0 && list.right<=innerWidth;
        const link=document.querySelector('.mas-lista a'); link.addEventListener('click',e=>e.preventDefault(),{once:true}); link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        const e=!open(); btn.click(); return {toggle:a&&b,outside:c,escape:d,link:e,fits};
      })()`);
      check(`${page} ${width} ${lang} ${theme}: Más conserva cierres y lista accesible`, Object.values(menu).every(Boolean), menu);
      await r.send("Emulation.setDeviceMetricsOverride", {width:1024,height:844,deviceScaleFactor:1,mobile:false});
      await r.waitFor("document.querySelector('.mas-btn').getAttribute('aria-expanded')==='false'", 2000);
      check(`${page} ${width} ${lang} ${theme}: Más cierra al pasar a escritorio`, await r.eval("document.querySelector('.mas-btn').getAttribute('aria-expanded')==='false'"));
    }
    check(`${page} ${width} ${lang} ${theme}: sin excepciones de ejecución`, !r.exceptions.length, r.exceptions);
    console.log(`Medido ${page} ${width} ${lang} ${theme}`);
    await r.send("Page.close");
  }
} finally { await browser.close(); }
const summary = { source:opt("--source", "sin-ref"), hashes, browser:process.env.CHROME, profile:"Chromium headless, emulación de viewport; no dispositivos físicos", checks, failures:checks.filter(c=>!c.ok).length };
await writeFile(join(out, "summary.json"), JSON.stringify(summary,null,2)+"\n");
console.log(`${checks.length} comprobaciones; ${summary.failures} fallos`);
process.exitCode = summary.failures ? 1 : 0;
