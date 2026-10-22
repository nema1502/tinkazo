#!/usr/bin/env node
/**
 * Los detallitos de la experiencia, uno por uno.
 *
 * Nicolás, 21 de octubre de 2026: "detallitos que son bonitos y ahorran tiempo
 * o hacen mejor la experiencia de usuario". Un buscador los encontró usando la
 * herramienta de verdad, un revisor los filtró, y cada uno se arregló con su
 * propio cambio (docs/ux.md, "Los detallitos"). Esto mide que sigan arreglados.
 *
 * Corre en el modo libre, sin Stellar ni cuenta: abre la herramienta, quita la
 * puerta como los demás auditores del modo libre y hace lo que haría una
 * persona. Cada detallito es una entrada de DETALLES, con sus comprobaciones y
 * una captura por pantalla y por tema en `--out`. Con `--prefijo antes` sobre
 * una versión vieja, las mismas capturas sirven para comparar.
 *
 * Uso:
 *   node scripts/audit-detalles.mjs [--base http://localhost:4173] [--out DIR]
 *                                   [--vistas 1280x720,390x844] [--temas dark,light]
 *                                   [--solo D01,D03] [--prefijo despues]
 *
 * Un Chrome a la vez y con su propio puerto: CDP_PORT=<puerto> node ...
 * Sale con código 1 si algo falla.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = opt("base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("out", "docs/capturas/detalles");
const vistas = opt("vistas", "1280x720,390x844").split(",").map((s) => {
  const [w, h] = s.split("x").map(Number);
  return { etiqueta: s, w, h, celular: w <= 700 };
});
const temas = opt("temas", "dark").split(",");
const solo = opt("solo", "") ? opt("solo", "").split(",") : null;
const prefijo = opt("prefijo", "");
mkdirSync(outDir, { recursive: true });

let fallas = 0;
let pasan = 0;
const check = (nombre, ok, detalle = "") => {
  if (ok) pasan++;
  else fallas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
};

const NL = JSON.stringify("\n");
const js = (v) => JSON.stringify(v);

/** Una pestaña nueva con la pantalla y el tema pedidos, en la herramienta. */
async function abrir(browser, v, tema, query = "", hash = "#sortear") {
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.celular, screenWidth: v.w, screenHeight: v.h });
  const sep = query ? "&" : "?";
  await page.send("Page.navigate", { url: `${base}/${query}${sep}theme=${tema}&lang=es${hash}` });
  await page.waitFor("document.readyState === 'complete'", 20000);
  await sleep(900);
  return page;
}

/** Sin cuenta, el botón de sellar queda detrás de la puerta: el modo libre arma el mismo flujo (como audit-espera). */
const libre = (page) =>
  page.eval(
    "document.querySelector('#sec-participants .body').classList.remove('locked'); document.getElementById('btn-freeze').removeAttribute('aria-disabled'); document.getElementById('gate').style.display = 'none'; document.getElementById('onboard').style.display = 'none'; true",
  );

/** Escribe en el cuadro como si se tecleara: el evento `input` es el de siempre. */
const escribir = (page, texto) =>
  page.eval(`(() => { const ta = document.getElementById('ta'); ta.value = ${js(texto)}; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

/** Sella la lista del cuadro en el modo libre y espera a que se vea la lista sellada. */
async function sellar(page) {
  await page.eval("document.getElementById('btn-freeze').click(); true");
  const ok = await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'", 15000);
  if (!ok.ok) throw new Error("no se selló la lista");
  await sleep(700);
}

/** Lanza el sorteo apenas nace el número y salta el juego hasta el resultado. */
async function sortearYSaltar(page) {
  const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 25000);
  if (!nacio.ok) throw new Error("no nació el número");
  await page.eval("document.getElementById('btn-draw').click(); true");
  const show = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 40000);
  if (!show.ok) throw new Error("no arrancó el show");
  await sleep(700);
  await page.eval("document.getElementById('st-skip')?.click(); true");
  const fin = await page.waitFor("document.getElementById('winner-box').style.display === 'block' && document.getElementById('stadium').style.display !== 'block'", 30000);
  if (!fin.ok) throw new Error("no llegó el resultado");
}

/**
 * Pega de verdad, con el portapapeles y Ctrl+V, en el cuadro: el evento `paste`
 * trae el texto y, si la página no lo intercepta, el navegador lo pega
 * (`insertFromPaste`). Chrome sin interfaz no deja escribir el portapapeles si
 * la página no tiene el foco: se le simula.
 */
async function pegar(page, texto) {
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const origin = new URL(base).origin;
  await page.send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => undefined);
  const ok = await page.eval(`navigator.clipboard.writeText(${js(texto)}).then(() => true, () => false)`);
  if (!ok) throw new Error("no se pudo escribir el portapapeles");
  await page.eval("document.getElementById('ta').focus(); true");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
  await sleep(400);
}

/**
 * Entra con la cuenta de prueba y devuelve su dirección (del panel de la
 * cuenta). Con `?grifo=0` la cuenta se arma en el navegador y no se le pide
 * nada a la red: alcanza para Mis sorteos, no para sellar.
 */
async function cuentaDePrueba(page) {
  await page.waitFor("document.querySelector('#gate button')", 20000);
  await page.eval("document.querySelector('#gate button').click(); true");
  await page.waitFor("document.querySelector('.login-opt')", 15000);
  await page.eval("[...document.querySelectorAll('.login-opt')].find((e) => /prueba|Test account/.test(e.textContent))?.click(); true");
  const entro = await page.waitFor("!document.querySelector('.modal-back') && document.querySelector('#wallet-box .hello')", 60000);
  if (!entro.ok) throw new Error("no entró la cuenta de prueba");
  await page.eval("document.querySelector('#wallet-box .hello').click(); true");
  const panel = await page.waitFor("document.querySelector('.acct-short[title]')", 15000);
  if (!panel.ok) throw new Error("no se abrió el panel de la cuenta");
  const addr = await page.eval("document.querySelector('.acct-short').title");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(300);
  return addr;
}

const visible = (sel) => `(() => { const e = document.querySelector(${js(sel)}); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; })()`;
const foco = (page) => page.eval("document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName)");

async function captura(page, id, v, tema, que = "") {
  const nombre = [prefijo, id, que, v.etiqueta, tema].filter(Boolean).join("-");
  await page.screenshot(join(outDir, `${nombre}.png`));
}

/**
 * Los detallitos. Cada uno recibe el navegador, la pantalla y el tema, y deja
 * sus comprobaciones y sus capturas. Cada pestaña es nueva: no se arrastra
 * nada de uno a otro (el `sessionStorage` es de cada pestaña).
 */
const DETALLES = {
  D01: {
    que: "con la lista sellada, lo que se ve es lo que se selló",
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema, "?lead=30");
      try {
        await libre(page);
        await escribir(page, Array.from({ length: 22 }, (_, i) => `Persona ${i + 1}`).join("\n"));
        await page.eval("document.getElementById('prize').value = 'Termo'; true");
        await sellar(page);
        const n0 = await page.eval("document.getElementById('names').childElementCount");
        // Lo que antes cambiaba la lista ya sellada.
        await page.eval("document.getElementById('btn-sample').click(); document.getElementById('csv-edit').click(); true");
        await sleep(300);
        const st = JSON.parse(
          await page.eval(`JSON.stringify({
            n: document.getElementById('names').childElementCount,
            ta: document.getElementById('ta').value.split(${NL}).length,
            cerrados: ['ta', 'prize', 'nw', 'csv', 'csv-luma'].every((id) => document.getElementById(id).disabled),
          })`),
        );
        check(`${quien} · "Cargar ejemplo" y "Editar selección" no cambian la lista sellada`, n0 === 22 && st.n === 22 && st.ta === 22, `${n0} → ${st.n} nombres`);
        check(`${quien} · el cuadro, el premio, la cantidad y los archivos quedan cerrados`, st.cerrados);
        await page.eval("document.getElementById('btn-sala').click(); true");
        const sala = await page.waitFor("document.querySelector('.sala .sala-nombres li')", 8000);
        await sleep(900);
        const s = sala.ok
          ? JSON.parse(
              await page.eval(
                "JSON.stringify({ sticker: document.querySelector('.sala .sticker').textContent, n: document.querySelectorAll('.sala .sala-nombres li').length, huella: document.querySelector('.sala .sala-huella b').textContent, sello: document.getElementById('k-digest').textContent })",
              ),
            )
          : {};
        check(`${quien} · "Mostrar la lista a la sala" muestra la sellada`, sala.ok && s.n === 22 && /sellada/i.test(s.sticker) && s.sello.startsWith(s.huella), sala.ok ? `"${s.sticker}" · ${s.n} nombres · huella ${s.huella} / sello ${s.sello}` : "no se abrió");
        await captura(page, "D01", v, tema, "sala");
        await page.eval("document.querySelector('.sala [data-cerrar]')?.click(); true");
        await sleep(300);
        check(`${quien} · al cerrarla, el foco vuelve al botón`, (await foco(page)) === "btn-sala", `foco en ${await foco(page)}`);
        await page.eval("document.getElementById('sec-participants').scrollIntoView({ block: 'start' }); true");
        await sleep(300);
        await captura(page, "D01", v, tema, "sellada");
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D03: {
    que: "la lista sin sellar vuelve al recargar",
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema);
      try {
        await escribir(page, Array.from({ length: 12 }, (_, i) => `Nombre ${i + 1}`).join("\n"));
        await page.eval(
          "(() => { [...document.querySelectorAll('#prize-chips button')].find((b) => /Termo/.test(b.textContent))?.click(); const nw = document.getElementById('nw'); nw.value = '2'; nw.dispatchEvent(new Event('change', { bubbles: true })); return true; })()",
        );
        await sleep(700);
        await page.send("Page.reload");
        await page.waitFor("document.readyState === 'complete'", 20000);
        await sleep(1000);
        const st = JSON.parse(
          await page.eval(
            "JSON.stringify({ n: document.getElementById('names').childElementCount, premio: document.getElementById('prize').value, nw: document.getElementById('nw').value, aviso: (document.getElementById('csv-aviso') || {}).textContent || '' })",
          ),
        );
        check(`${quien} · después de recargar vuelven los 12 nombres, el premio y la cantidad`, st.n === 12 && st.premio === "Termo" && st.nw === "2", `${st.n} nombres · "${st.premio}" · ${st.nw}`);
        check(`${quien} · y lo dice`, /Recuperamos/.test(st.aviso), st.aviso ? `"${st.aviso}"` : "sin aviso");
        await page.eval("(document.getElementById('csv-aviso') || document.getElementById('ta')).scrollIntoView({ block: 'center' }); true");
        await sleep(300);
        await captura(page, "D03", v, tema, "recargado");
        // La demo no repone nada.
        await page.send("Page.navigate", { url: `${base}/?demo=race&instant=1&theme=${tema}` });
        await page.waitFor("document.readyState === 'complete'", 20000);
        await sleep(400);
        check(`${quien} · la demo no repone nada`, (await page.eval("document.getElementById('prize').value")) === "");
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D11: {
    que: "después del ganador, la acción que sigue con el foco",
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema, "?lead=3&pace=rapido");
      try {
        await libre(page);
        await page.eval("document.getElementById('btn-sample').click(); true");
        await sellar(page);
        await sortearYSaltar(page);
        await sleep(1400);
        const f = await foco(page);
        const barra = await page.eval("document.getElementById('siguiente').classList.contains('on')");
        check(`${quien} · un momento después del resultado, el foco está en "Siguiente premio"`, f === (barra ? "sig-btn" : "btn-again-sin"), `foco en ${f}${barra ? " (con la barra)" : ""}`);
        // Sin la espera en grande, el resultado queda en la página, como siempre (D04 es solo desde la espera).
        check(`${quien} · sin la espera en grande, el resultado no se abre en grande`, !(await page.eval("!!document.querySelector('.pantalla')")));
        const espera = await page.eval("document.getElementById('wait-left').textContent");
        check(`${quien} · la caja de la espera dice que ya se sorteó`, espera === "Ya se sorteó", `"${espera}"`);
        await captura(page, "D11", v, tema, "resultado");
        await page.eval("document.getElementById('wait-box').scrollIntoView({ block: 'center' }); true");
        await sleep(400);
        await captura(page, "D11", v, tema, "espera");
        await page.eval("document.getElementById('btn-again-sin').scrollIntoView({ block: 'center' }); true");
        await sleep(400);
        await page.eval("document.getElementById('l-en').click(); true");
        await sleep(300);
        const en = JSON.parse(await page.eval("JSON.stringify({ espera: document.getElementById('wait-left').textContent, foco: document.activeElement && document.activeElement.id })"));
        check(`${quien} · en inglés también, y cambiar de idioma no mueve el foco`, en.espera === "Already drawn" && en.foco === f, `"${en.espera}" · foco en ${en.foco}`);
        await page.eval("document.getElementById('l-es').click(); true");
        // Cambiar de idioma vuelve a pintar la puerta: el modo libre se arma de nuevo.
        await libre(page);
        // El siguiente premio: la caja vuelve a contar, y si el foco ya está en algo, no se lo quita.
        await page.eval("document.getElementById('btn-again-sin').click(); true");
        await sleep(400);
        await sellar(page);
        const cuenta = await page.eval("document.getElementById('wait-left').textContent");
        check(`${quien} · con la lista sellada otra vez, la caja vuelve a contar`, /^\d+:\d\d$|^Ya nació/.test(cuenta), `"${cuenta}"`);
        await sortearYSaltar(page);
        await page.eval("document.getElementById('btn-grande').focus({ preventScroll: true }); true");
        await sleep(1400);
        check(`${quien} · si el foco ya está en otro botón, no se lo quita`, (await foco(page)) === "btn-grande", `foco en ${await foco(page)}`);
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D09: {
    que: "una lista numerada de WhatsApp entra sin los números, y los repetidos se dicen",
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema);
      try {
        const lista = ["*Sorteo del meetup* 🎁", "1. Ana Quispe", "2. Luis Mamani", "3. Carla Flores", "4. ana quispe", "5. Diego Rojas", "9. Ana Quispe"].join("\n");
        await pegar(page, lista);
        const st = JSON.parse(
          await page.eval(
            "JSON.stringify({ chips: [...document.querySelectorAll('#names i')].map((i) => i.textContent), aviso: document.getElementById('csv-aviso').textContent, visible: getComputedStyle(document.getElementById('csv-aviso')).display !== 'none' })",
          ),
        );
        const conNumero = st.chips.filter((c) => /^\s*\d/.test(c));
        check(`${quien} · los nombres entran sin el número, y "9. Ana Quispe" no es otra persona`, conNumero.length === 0 && st.chips.length === 6, `${st.chips.length} nombres: ${st.chips.join(" · ")}`);
        check(
          `${quien} · el aviso dice qué se sacó, la línea sin número y los repetidos`,
          st.visible && /numeración de 6 líneas/.test(st.aviso) && /no tenía número/.test(st.aviso) && /dos veces igual/.test(st.aviso) && /parecen la misma persona/.test(st.aviso),
          `"${st.aviso}"`,
        );
        await page.eval("document.getElementById('csv-aviso').scrollIntoView({ block: 'center' }); true");
        await sleep(300);
        await captura(page, "D09", v, tema, "numerada");
        // Se deshace como cualquier pegar.
        await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2, commands: ["undo"] });
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
        await sleep(300);
        check(`${quien} · Ctrl+Z deshace lo pegado`, (await page.eval("document.getElementById('ta').value")) === "");
        // Una lista sin numerar se pega como siempre, y los repetidos también se dicen.
        await pegar(page, "Ana Quispe\nLuis Mamani\nAna Quispe\nana quispe");
        const st2 = JSON.parse(await page.eval("JSON.stringify({ ta: document.getElementById('ta').value, aviso: document.getElementById('csv-aviso').textContent })"));
        check(`${quien} · una lista sin numerar entra tal cual, con el aviso de los repetidos`, st2.ta === "Ana Quispe\nLuis Mamani\nAna Quispe\nana quispe" && /dos veces igual/.test(st2.aviso) && /parecen la misma persona/.test(st2.aviso), `"${st2.aviso}"`);
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D14: {
    que: "el nombre del evento se escribe encima de la fecha y se guarda con Enter",
    async correr(browser, v, tema, quien) {
      // La cuenta de prueba con el grifo apagado: se arma en el navegador, sin pedirle nada a la red.
      const page = await abrir(browser, v, tema, "?grifo=0");
      try {
        // Las pestañas comparten el almacenamiento: sin la cuenta, los sorteos ni los eventos de una corrida anterior.
        await page.eval("localStorage.clear(); true");
        await page.send("Page.reload");
        await page.waitFor("document.readyState === 'complete'", 20000);
        await sleep(900);
        const addr = await cuentaDePrueba(page);
        const ahora = Math.floor(Date.now() / 1000);
        const filas = [
          { organizer: addr, listHash: "a".repeat(64), count: 12, numWinners: 1, round: 33000001, sealedAt: ahora - 3600, prize: "Termo", winners: ["Ana Quispe"], proof: "https://tinkazo.app/verificar.html#p=uno" },
          { organizer: addr, listHash: "b".repeat(64), count: 11, numWinners: 1, round: 33000101, sealedAt: ahora - 3000, prize: "Polera", winners: ["Luis Mamani"], proof: "https://tinkazo.app/verificar.html#p=dos" },
        ];
        await page.eval(`localStorage.setItem('tinkazo.history.testnet', ${js(JSON.stringify(filas))}); localStorage.removeItem('tinkazo.eventos.testnet'); true`);
        await page.send("Page.navigate", { url: `${base}/?grifo=0&theme=${tema}&lang=es#mis-sorteos` });
        await page.waitFor("document.readyState === 'complete'", 20000);
        const hay = await page.waitFor("document.querySelector('[data-nombrar]')", 30000);
        if (!hay.ok) throw new Error('no apareció "Ponerle nombre"');
        await page.eval("document.querySelector('[data-nombrar]').click(); true");
        await sleep(500);
        const a = JSON.parse(
          await page.eval(
            "JSON.stringify((() => { const f = document.activeElement; return { id: f && f.id, marcado: f && f.value ? f.value.slice(f.selectionStart, f.selectionEnd) : '' }; })())",
          ),
        );
        check(`${quien} · "Ponerle nombre" deja el campo con el foco y la fecha marcada`, /^evn-n-/.test(a.id) && /^Sorteos del /.test(a.marcado), `foco en ${a.id} · marcado "${a.marcado}"`);
        await captura(page, "D14", v, tema, "ponerle-nombre");
        await page.send("Input.insertText", { text: "Meetup n8n Bolivia" });
        await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await sleep(500);
        const b = JSON.parse(
          await page.eval(
            "JSON.stringify({ nombres: JSON.parse(localStorage.getItem('tinkazo.eventos.testnet') || '[]').map((e) => e.nombre), foco: document.activeElement && document.activeElement.textContent, aviso: (document.querySelector('.evn-aviso') || {}).textContent || '' })",
          ),
        );
        check(`${quien} · Enter guarda el nombre y lo dice`, b.nombres[0] === "Meetup n8n Bolivia" && /Nombre guardado/.test(b.aviso), `${js(b.nombres)} · "${b.aviso}"`);
        check(`${quien} · y el foco pasa a "Compartir el evento"`, /Compartir el evento/.test(b.foco || ""), `foco en "${b.foco}"`);
        await captura(page, "D14", v, tema, "guardado");
        // Escribir otro y salir del campo sin tocar "Guardar": no se pierde.
        await page.eval("const c = document.querySelector('.evn-card input'); c.focus(); c.select(); true");
        await page.send("Input.insertText", { text: "Meetup n8n" });
        await page.eval("document.querySelector('.evn-card input').blur(); true");
        await sleep(300);
        await page.send("Page.reload");
        await page.waitFor("document.readyState === 'complete'", 20000);
        await page.waitFor("document.querySelector('.evn-card input')", 30000);
        const c = await page.eval("document.querySelector('.evn-card input').value");
        check(`${quien} · lo escrito sin tocar "Guardar" sigue después de recargar`, c === "Meetup n8n", `"${c}"`);
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D18: {
    que: '"Pegar lista" es un botón y lleva al cuadro',
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema);
      try {
        const b = JSON.parse(
          await page.eval(
            "JSON.stringify((() => { const b = document.getElementById('btn-pegar'); if (!b) return null; const r = b.getBoundingClientRect(); return { tag: b.tagName, alto: Math.round(r.height), cursor: getComputedStyle(b).cursor }; })())",
          ),
        );
        check(`${quien} · es un botón de verdad, de 44 px o más, con la manito`, !!b && b.tag === "BUTTON" && b.alto >= 44 && b.cursor === "pointer", b ? `${b.tag} · ${b.alto} px · cursor ${b.cursor}` : "no está #btn-pegar");
        await escribir(page, "Ana Quispe\nLuis Mamani");
        await page.eval("window.scrollTo(0, 0); document.getElementById('btn-pegar')?.click(); true");
        await sleep(700);
        const f = JSON.parse(
          await page.eval(
            "JSON.stringify((() => { const ta = document.getElementById('ta'); const r = ta.getBoundingClientRect(); return { foco: document.activeElement === ta, alFinal: ta.selectionStart === ta.value.length, aLaVista: r.top < innerHeight && r.bottom > 0 }; })())",
          ),
        );
        check(`${quien} · tocarlo deja el cuadro con el foco, a la vista y con el cursor al final`, f.foco && f.alFinal && f.aLaVista, js(f));
        await captura(page, "D18", v, tema, "pegar");
        // Una lista pegada al final empieza en otro renglón: no se pega al último nombre.
        await pegar(page, "Carla Flores\nDiego Rojas");
        const nombres = await page.eval("[...document.querySelectorAll('#names i')].map((i) => i.textContent).join(' · ')");
        check(`${quien} · lo que se pega al final empieza en un renglón nuevo`, nombres === "Ana Quispe · Luis Mamani · Carla Flores · Diego Rojas", nombres);
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D17: {
    que: '"Entrar y sortear" al final de la demo abre la ventana de ingreso',
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema, "?demo=race&instant=1&lead=3", "");
      try {
        const fin = await page.waitFor(visible(".demo-fin a.cta"), 60000);
        if (!fin.ok) throw new Error("la demo no llegó al final");
        await page.eval("document.querySelector('.demo-fin').scrollIntoView({ block: 'center' }); true");
        await sleep(400);
        await captura(page, "D17", v, tema, "fin-de-la-demo");
        await page.eval("document.querySelector('.demo-fin a.cta').click(); true");
        await page.waitFor("location.search === '' && location.hash === '#sortear' && document.readyState === 'complete'", 20000);
        const ventana = await page.waitFor("document.querySelector('.modal-card.login')", 15000);
        check(`${quien} · lleva a la herramienta con la ventana para elegir una cuenta`, ventana.ok, ventana.ok ? `a los ${ventana.elapsed} ms` : "llegó a la puerta sin la ventana");
        await sleep(600);
        await captura(page, "D17", v, tema, "ventana");
        // Una sola vez: al recargar, la puerta queda como siempre.
        await page.send("Page.reload");
        await page.waitFor("document.readyState === 'complete'", 20000);
        await sleep(2500);
        check(`${quien} · y una sola vez: al recargar no vuelve a abrirse`, !(await page.eval("!!document.querySelector('.modal-card.login')")));
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D19: {
    que: "la barra dice qué se sortea antes de sellar",
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema);
      try {
        await libre(page);
        await escribir(page, Array.from({ length: 12 }, (_, i) => `Nombre ${i + 1}`).join("\n"));
        await page.eval("window.scrollTo(0, 0); true");
        await sleep(900);
        const linea = () => page.eval("document.getElementById('sig-paso').textContent");
        const sin = await linea();
        check(`${quien} · sin premio, la línea lo dice`, /12 personas · sin premio$/.test(sin), `"${sin}"`);
        await captura(page, "D19", v, tema, "sin-premio");
        await page.eval("(() => { const p = document.getElementById('prize'); p.value = 'Termo'; p.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
        await sleep(200);
        const con = await linea();
        await page.eval("[...document.querySelectorAll('#prize-chips button')].find((b) => /Polera/.test(b.textContent))?.click(); true");
        await sleep(200);
        const chip = await linea();
        check(`${quien} · al escribir el premio o tocar uno, la línea cambia`, /· Termo$/.test(con) && /· Polera$/.test(chip), `"${con}" → "${chip}"`);
        await captura(page, "D19", v, tema, "con-premio");
        if (v.celular) {
          // El ancho más chico que se mira (audit-flujo --solo-anchos): la línea entra entera, con un premio corto.
          await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true, screenWidth: 320, screenHeight: 700 });
          await page.eval("window.scrollTo(0, 0); true");
          await sleep(900);
          const m = JSON.parse(await page.eval("JSON.stringify((() => { const e = document.getElementById('sig-paso'); return { entra: e.scrollWidth <= e.clientWidth + 1, barra: document.getElementById('siguiente').classList.contains('on'), texto: e.textContent, scroll: document.documentElement.scrollWidth > innerWidth }; })())"));
          check(`${quien} · a 320 px la línea entra entera y no hay scroll de costado`, m.entra && !m.scroll, `"${m.texto}"${m.barra ? " (con la barra)" : ""}`);
        }
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },

  D08: {
    que: '"Cargar ejemplo" solo con el cuadro vacío',
    async correr(browser, v, tema, quien) {
      const page = await abrir(browser, v, tema);
      try {
        const vacio = await page.eval(visible("#btn-sample"));
        await escribir(page, "Ana Quispe\nLuis Mamani");
        const conNombres = await page.eval(visible("#btn-sample"));
        await page.eval("document.getElementById('sec-participants').scrollIntoView({ block: 'start' }); true");
        await sleep(300);
        await captura(page, "D08", v, tema, "con-nombres");
        await escribir(page, "");
        const otraVez = await page.eval(visible("#btn-sample"));
        check(`${quien} · con el cuadro vacío se ve, con nombres no, y vuelve al vaciarlo`, vacio && !conNombres && otraVez, `${vacio} → ${conNombres} → ${otraVez}`);
      } finally {
        await page.send("Page.close").catch(() => undefined);
      }
    },
  },
};

const browser = await launch({ width: 1280, height: 900 });
try {
  for (const [id, d] of Object.entries(DETALLES)) {
    if (solo && !solo.includes(id)) continue;
    console.log(`\n${id} · ${d.que}`);
    for (const tema of temas) {
      for (const v of vistas) {
        const quien = `${v.etiqueta} ${tema}`;
        try {
          await d.correr(browser, v, tema, quien);
        } catch (e) {
          check(`${quien} · ${id}`, false, e.message);
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${fallas ? `✗ ${fallas} fallas` : "✓ todo bien"} · ${pasan} comprobaciones bien · capturas en ${outDir}`);
process.exit(fallas ? 1 : 0);
