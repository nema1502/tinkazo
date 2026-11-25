#!/usr/bin/env node
/**
 * El recorrido automático de la prueba de la llave (issue 301): en Chrome sin pantalla y con un autenticador virtual, crea
 * una llave, sella una lista, espera el sorteo, comprueba el comprobante y deja un archivo con lo que cobró la red en cada
 * paso. Las cifras son de la red de prueba y no se proyectan a otra.
 *
 *   node scripts/recorrido-llave.mjs --base http://localhost:4173 --salida medidas-llave.json
 *   opciones: --sin-otro-aparato, --tope-min 20, --tope-otro-min 6
 *
 * Después del recorrido principal prueba entrar desde otro aparato, sin ningún índice ajeno. Corre varios navegadores, uno
 * después del otro y nunca dos a la vez, cada uno con su perfil nuevo:
 *   A  el recorrido de siempre. Al terminar se leen las credenciales de su autenticador virtual.
 *   B  otro aparato: sin nada guardado de la página y con la misma credencial, como cuando el teléfono y la computadora
 *      comparten las llaves. Entra con la búsqueda en el historial, sella, y vuelve a entrar con la búsqueda en el RPC.
 *   C  una llave que no tiene cuenta: tiene que llegar a la pantalla de que no hay cuenta.
 *
 * La página de prueba se arma con `VITE_PRUEBA_LLAVE=1 pnpm build` y se sirve con `pnpm preview`. Sale con 0 si la prueba
 * dio bien, con 1 si falló y con 2 si no se pudo medir (la red de prueba cambió o el grifo, la red o el servicio de azar
 * no contestaron). Los pasos de otro aparato son informativos: se anotan y se muestran, y no cambian el código de salida.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/browser.mjs";
import { controlPrevio } from "./lib/previo-llave.mjs";
import { armarDatos, checksDeOtroAparato, codigoDeSalida, esperarEstado, tocar } from "./lib/recorrido-llave.mjs";
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
const topeOtroMs = Number(opt("--tope-otro-min", "6")) * 60_000;
const puertoBase = Number(process.env.CDP_PORT || 9222);

const checks = [];
const check = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? "ok " : "MAL"} ${nombre}${detalle ? `: ${detalle}` : ""}`);
};

const OPCIONES_DEL_AUTENTICADOR = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

/** Abre un Chrome con su perfil nuevo, le pone un autenticador virtual y corre `fn`. El Chrome se cierra siempre. */
async function conNavegador(puerto, fn) {
  const browser = await launch({ port: puerto, width: 412, height: 915 });
  try {
    const cdp = await browser.open("about:blank");
    // Una pestaña de Chrome sin pantalla puede creerse sin foco: el desbloqueo falla con NotAllowedError.
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.send("Page.bringToFront");
    await cdp.send("WebAuthn.enable", { enableUI: false });
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: OPCIONES_DEL_AUTENTICADOR });
    return await fn({ cdp, authenticatorId });
  } finally {
    await browser.close();
  }
}

/** Anota los anfitriones a los que la página hace pedidos, para comprobar que ninguno es un índice ajeno. */
async function anotarAnfitriones(cdp) {
  const vistos = new Set();
  cdp.ws.addEventListener("message", (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.method === "Network.requestWillBeSent") vistos.add(new URL(m.params.request.url).hostname);
    } catch {
      /* un mensaje que no es de red */
    }
  });
  await cdp.send("Network.enable");
  return vistos;
}

const leerMedidas = (cdp) => cdp.eval("JSON.parse(JSON.stringify(window.__pruebaLlave?.medidas ?? null))");
const abrir = (cdp, parametros = "") => cdp.send("Page.navigate", { url: `${base}/prueba/llave/?lang=es${parametros}` });

/** Una llave que no tiene cuenta en la red: la clave P-256 sale de Node y se exporta en el formato que pide el protocolo. */
function credencialAjena(rpId) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    credentialId: randomBytes(32).toString("base64"),
    isResidentCredential: true,
    rpId,
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    userHandle: randomBytes(16).toString("base64"),
    signCount: 0,
  };
}

const inicio = Date.now();
const previo = await controlPrevio();
check("previo", previo.salida === 0, previo.salida === 0 ? "" : `${previo.motivo}: ${previo.fallas.join(" / ")}`);

let medidas = null;
let verificacion = null;
let otroAparato = null;
let segundoSello = null;
let navegador = "";
let codigo = 0;
let fallasDeOtro = [];
// Lo que se lleva del primer navegador a los otros.
const deA = { credenciales: [], contractId: "", selloId: "", ledger: null };

if (previo.salida !== 0) {
  codigo = 2;
} else {
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

  await conNavegador(puertoBase, async ({ cdp, authenticatorId }) => {
    navegador = String(await cdp.eval("navigator.userAgent"));

    const principal = async () => {
      await abrir(cdp);
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
      medidas = await leerMedidas(cdp);
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
      medidas = medidas ?? (await leerMedidas(cdp).catch(() => null));
    }
    medidas = medidas ?? (await leerMedidas(cdp).catch(() => null));
    if (vencido && !checks.some((c) => c.nombre === "tope")) check("tope", false, "se acabó el tiempo");

    // Lo que hace falta para los otros navegadores: las llaves del autenticador y los datos de la primera cuenta.
    if (checks.find((c) => c.nombre === "crear")?.ok) {
      try {
        deA.credenciales = (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials ?? [];
      } catch (e) {
        console.log(`no se pudieron leer las llaves del autenticador: ${e.message}`);
      }
      deA.contractId = medidas?.cuenta?.contractId ?? "";
      deA.ledger = medidas?.cuenta?.ledger ?? null;
      deA.selloId = medidas?.sello?.id ?? "";
    }
    if (cdp.exceptions.length) console.log(`excepciones de la página: ${cdp.exceptions.slice(0, 3).join(" | ")}`);
  });

  // Otro aparato: navegadores nuevos, uno después del otro, sin nada guardado de la página.
  if (!sinOtroAparato && !vencido && deA.credenciales.length > 0) {
    const t0 = Date.now();
    const origen = new URL(base).origin;
    const hostDeLaPagina = new URL(base).hostname;
    const anfitriones = new Set();
    const resultado = { a: { contractId: deA.contractId, selloId: deA.selloId, ledger: deA.ledger }, historial: null, rpc: null, sinCuenta: null };
    const restanteOtro = () => topeOtroMs - (Date.now() - t0);

    /** Entra con la llave en una página nueva. Si la red todavía no muestra la cuenta, se vuelve a probar una vez a los 15 s. */
    const entrar = async (cdp, parametros) => {
      await abrir(cdp, parametros);
      const r = await esperarEstado(cdp, ["inicio"], 30_000);
      if (!r.ok) return { estado: r.estado, ok: false };
      await tocar(cdp, "#secundario");
      let e = await esperarEstado(cdp, ["cuenta-lista"], 60_000);
      const motivo = async () => String(await cdp.eval("window.__pruebaLlave?.error ?? ''").catch(() => ""));
      if (!e.ok && e.estado === "no-aparece" && (await motivo()).startsWith("red") && restanteOtro() > 90_000) {
        await sleep(15_000);
        await tocar(cdp, "#principal");
        e = await esperarEstado(cdp, ["cuenta-lista"], 60_000);
      }
      const m = await leerMedidas(cdp).catch(() => null);
      return {
        estado: e.estado,
        ok: e.ok,
        contractId: String(await cdp.eval("window.__pruebaLlave?.contractId ?? ''").catch(() => "")),
        entrada: m?.entrada ?? null,
        error: await motivo(),
        fallas: m?.fallas ?? [],
      };
    };

    try {
      await conNavegador(puertoBase + 1, async ({ cdp, authenticatorId }) => {
        const vistos = await anotarAnfitriones(cdp);
        for (const credential of deA.credenciales) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });

        // La búsqueda en el historial, y con esa misma entrada un segundo sello desde el otro aparato.
        resultado.historial = await entrar(cdp, "&fuente=historial");
        fallasDeOtro.push(...(resultado.historial.fallas ?? []));
        if (resultado.historial.ok) {
          await tocar(cdp, "#principal");
          const s = await esperarEstado(cdp, ["esperando"], 120_000);
          const m2 = await leerMedidas(cdp).catch(() => null);
          resultado.historial.sello = s.ok ? { id: m2?.sello?.id ?? "", desbloqueos: m2?.sello?.desbloqueos ?? 0 } : null;
          segundoSello = s.ok ? (m2?.sello?.cobro ?? null) : null;
        }

        // Sin nada guardado otra vez, la búsqueda en el RPC con la misma llave.
        await cdp.send("Storage.clearDataForOrigin", { origin: origen, storageTypes: "indexeddb,local_storage" });
        resultado.rpc = await entrar(cdp, "&fuente=rpc");
        fallasDeOtro.push(...(resultado.rpc.fallas ?? []));
        for (const h of vistos) anfitriones.add(h);
      });
    } catch (e) {
      console.log(`otro aparato: ${e.message}`);
      resultado.error = e.message;
    }

    // Una llave que no tiene cuenta: tiene que llegar a la pantalla de que no hay cuenta, nunca a una cuenta ajena.
    try {
      await conNavegador(puertoBase + 2, async ({ cdp, authenticatorId }) => {
        const vistos = await anotarAnfitriones(cdp);
        await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: credencialAjena(hostDeLaPagina) });
        await abrir(cdp);
        const r = await esperarEstado(cdp, ["inicio"], 30_000);
        if (r.ok) {
          await tocar(cdp, "#secundario");
          const e = await esperarEstado(cdp, ["sin-cuenta"], 60_000);
          resultado.sinCuenta = { estado: e.estado, error: String(await cdp.eval("window.__pruebaLlave?.error ?? ''").catch(() => "")) };
        } else {
          resultado.sinCuenta = { estado: r.estado };
        }
        for (const h of vistos) anfitriones.add(h);
      });
    } catch (e) {
      console.log(`llave sin cuenta: ${e.message}`);
      resultado.sinCuenta = { estado: null, error: e.message };
    }

    for (const c of checksDeOtroAparato({ ...resultado, anfitriones: [...anfitriones] })) check(c.nombre, c.ok, c.detalle);
    otroAparato = {
      resultado: resultado.historial?.ok ? "ok" : "fallo",
      minutos: Math.round((Date.now() - t0) / 6000) / 10,
      entradas: { historial: resultado.historial, rpc: resultado.rpc },
      sinCuenta: resultado.sinCuenta,
      error: resultado.error ?? null,
    };
  }

  codigo = codigoDeSalida({ checks, fallas: [...(medidas?.fallas ?? []), ...fallasDeOtro], previo });
}

const datos = armarDatos({ medidas, previo: previo.datos, navegador, virtual: true, segundos: (Date.now() - inicio) / 1000, otroAparato, segundoSello, verificacion });
writeFileSync(salida, `${JSON.stringify(datos, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
console.log(`medidas en ${salida}`);
emitirJson({ auditor: "recorrido-llave", objetivo: "prueba/llave", checks, datos: { codigo, previo: previo.motivo } });
process.exit(codigo);
