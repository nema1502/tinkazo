#!/usr/bin/env node
/**
 * El recorrido automático de la prueba de la llave (issue 301): en Chrome sin pantalla y con un autenticador virtual, crea
 * una llave, sella una lista, espera el sorteo, comprueba el comprobante y deja un archivo con lo que cobró la red en cada
 * paso. Las cifras son de la red de prueba y no se proyectan a otra.
 *
 *   node scripts/recorrido-llave.mjs --base http://localhost:4173 --salida medidas-llave.json
 *   opciones: --sin-otro-aparato, --tope-min 20, --tope-otro-min 4
 *
 * La página de prueba se arma con `VITE_PRUEBA_LLAVE=1 pnpm build` y se sirve con `pnpm preview`. Sale con 0 si la prueba
 * dio bien, con 1 si falló y con 2 si no se pudo medir (la red de prueba cambió o el grifo, la red o el servicio de azar
 * no contestaron). El paso de otro aparato nunca cambia el código de salida.
 */
import { writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/browser.mjs";
import { atrasoDelIndice, controlPrevio } from "./lib/previo-llave.mjs";
import { armarDatos, clasificarOtroAparato, codigoDeSalida, esperarEstado, tocar } from "./lib/recorrido-llave.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const salida = opt("--salida", "medidas-llave.json");
const sinOtroAparato = args.includes("--sin-otro-aparato");
const topeMs = Number(opt("--tope-min", "20")) * 60_000;
const topeOtroMs = Number(opt("--tope-otro-min", "4")) * 60_000;

const checks = [];
const check = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? "ok " : "MAL"} ${nombre}${detalle ? `: ${detalle}` : ""}`);
};

const inicio = Date.now();
const previo = await controlPrevio();
check("previo", previo.salida === 0, previo.salida === 0 ? "" : `${previo.motivo}: ${previo.fallas.join(" / ")}`);

let medidas = null;
let verificacion = null;
let otroAparato = null;
let segundoSello = null;
let navegador = "";
let codigo = 0;

if (previo.salida !== 0) {
  codigo = 2;
} else {
  const browser = await launch({ width: 412, height: 915 });
  try {
    const cdp = await browser.open("about:blank");
    // Una pestaña de Chrome sin pantalla puede creerse sin foco: el desbloqueo falla con NotAllowedError.
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.send("Page.bringToFront");
    await cdp.send("WebAuthn.enable", { enableUI: false });
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    navegador = String(await cdp.eval("navigator.userAgent"));

    const leerMedidas = async () => cdp.eval("JSON.parse(JSON.stringify(window.__pruebaLlave?.medidas ?? null))");
    const abrir = async () => {
      await cdp.send("Page.navigate", { url: `${base}/prueba/llave/?lang=es` });
    };

    // El tope cuenta de punta a punta y se mira antes de cada paso: nada queda corriendo de fondo cuando vence.
    let vencido = false;
    const restante = () => topeMs - (Date.now() - inicio);
    const hasta = (ms) => {
      if (restante() <= 0) {
        vencido = true;
        throw new Error("tope");
      }
      return Math.min(ms, restante());
    };

    const principal = async () => {
      await abrir();
      const r0 = await esperarEstado(cdp, ["inicio", "ya-hay-llave"], hasta(30_000));
      check("carga", r0.ok, r0.estado ?? "sin estado");
      if (!r0.ok) return;

      await tocar(cdp, "#principal");
      const crear = await esperarEstado(cdp, ["cuenta-lista"], hasta(150_000));
      check("crear", crear.ok, crear.estado ?? "sin estado");
      if (!crear.ok) return;

      await tocar(cdp, "#principal");
      const esperando = await esperarEstado(cdp, ["esperando"], hasta(120_000));
      check("sellar", esperando.ok, esperando.estado ?? "sin estado");
      if (!esperando.ok) return;

      const listo = await esperarEstado(cdp, ["listo"], hasta(300_000));
      medidas = await leerMedidas();
      check("sortear", listo.ok, listo.estado ?? "sin estado");
      check("coincide", medidas?.sorteo?.coincide === true, JSON.stringify(medidas?.sorteo?.ganadores ?? null));
      if (!listo.ok) return;

      const enlace = await cdp.eval("window.__pruebaLlave?.enlace ?? ''");
      await cdp.send("Page.navigate", { url: enlace });
      const veredicto = await cdp.waitFor(`(() => { const t = document.getElementById("verdict-title")?.textContent ?? ""; return t && !/^(Revisando el sorteo|Checking the draw)$/.test(t.trim()); })()`, hasta(60_000));
      await sleep(500);
      const clase = await cdp.eval(`document.getElementById("verdict")?.className ?? ""`);
      const texto = String(await cdp.eval(`document.getElementById("verdict-title")?.textContent ?? ""`)).trim();
      const estado = /\bok\b/.test(clase) ? "ok" : /\bpartial\b/.test(clase) ? "partial" : /\bbad\b/.test(clase) ? "bad" : "working";
      verificacion = { estado, texto };
      check("verificacion-ok", veredicto.ok && estado === "ok", `${estado}: ${texto}`);
      if (restante() <= 0 && !veredicto.ok) vencido = true;
    };

    try {
      await principal();
    } catch (e) {
      check("tope", false, e.message);
      vencido = true;
      medidas = medidas ?? (await leerMedidas().catch(() => null));
    }
    medidas = medidas ?? (await leerMedidas().catch(() => null));
    if (vencido && !checks.some((c) => c.nombre === "tope")) check("tope", false, "se acabó el tiempo");

    // Otro aparato: se borra lo guardado en la página y se entra con la llave que quedó en el autenticador.
    if (!sinOtroAparato && !vencido && checks.find((c) => c.nombre === "crear")?.ok) {
      const t0 = Date.now();
      const origen = new URL(base).origin;
      try {
        await cdp.send("Storage.clearDataForOrigin", { origin: origen, storageTypes: "indexeddb,local_storage" });
        await abrir();
        const r = await esperarEstado(cdp, ["inicio"], 30_000);
        if (r.ok) {
          await tocar(cdp, "#secundario");
          let intento = 0;
          let e = await esperarEstado(cdp, ["cuenta-lista"], 60_000);
          while (!e.ok && e.estado === "no-aparece" && intento < 3 && Date.now() - t0 < topeOtroMs) {
            intento++;
            await sleep(30_000);
            await tocar(cdp, "#principal");
            e = await esperarEstado(cdp, ["cuenta-lista"], 60_000);
          }
          if (e.ok) {
            const primero = medidas?.sello ?? null;
            await tocar(cdp, "#principal");
            const s = await esperarEstado(cdp, ["esperando"], 120_000);
            const m2 = await leerMedidas();
            segundoSello = s.ok ? (m2?.sello?.cobro ?? null) : null;
            check("segundo-sello", s.ok && m2?.sello?.id !== primero?.id, s.estado ?? "sin estado");
            otroAparato = { resultado: "ok", minutos: Math.round((Date.now() - t0) / 6000) / 10 };
          } else {
            // Qué dijo el kit y cuánto atraso hay ahora: el del control previo es de antes y de otra ruta del índice.
            const error = String(await cdp.eval("window.__pruebaLlave?.error ?? ''").catch(() => ""));
            const atrasoAhora = await atrasoDelIndice();
            const segundos = Math.round((Date.now() - t0) / 1000);
            otroAparato = {
              ...clasificarOtroAparato({ estado: e.estado, error, atrasoAhora, segundos }),
              minutos: Math.round(segundos / 6) / 10,
              atrasoDelIndice: previo.datos.atrasoDelIndice,
            };
          }
        } else {
          otroAparato = { resultado: "fallo", minutos: 0, estado: r.estado };
        }
      } catch (e) {
        otroAparato = { resultado: "fallo", minutos: Math.round((Date.now() - t0) / 6000) / 10, error: e.message };
      }
      check("otro-aparato", otroAparato?.resultado === "ok", otroAparato?.resultado ?? "");
    }

    if (cdp.exceptions.length) console.log(`excepciones de la página: ${cdp.exceptions.slice(0, 3).join(" | ")}`);
    codigo = codigoDeSalida({ checks, fallas: medidas?.fallas ?? [], previo });
  } finally {
    await browser.close();
  }
}

const datos = armarDatos({ medidas, previo: previo.datos, navegador, virtual: true, segundos: (Date.now() - inicio) / 1000, otroAparato, segundoSello, verificacion });
writeFileSync(salida, `${JSON.stringify(datos, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
console.log(`medidas en ${salida}`);
emitirJson({ auditor: "recorrido-llave", objetivo: "prueba/llave", checks, datos: { codigo, previo: previo.motivo } });
process.exit(codigo);
