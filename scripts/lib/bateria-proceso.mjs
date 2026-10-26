/**
 * Los procesos de la batería: correr un auditor, levantar la vista previa y
 * apagar solo lo propio.
 *
 * Nunca se mata "todos los Chrome": quien corre un auditor es un proceso de
 * Node que lanza su propio Chrome, así que se anota el PID de cada Node y de la
 * vista previa que se lanzó, y al cortar se baja ese árbol y nada más. En
 * Windows, `taskkill /T` lleva al Chrome del auditor consigo; el perfil
 * temporal lo borra la corrida siguiente (`limpiarViejos` en `browser.mjs`).
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { leerResumen } from "./resumen.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const aparte = process.platform !== "win32";

/** Los procesos que esta corrida lanzó y siguen vivos: la lista de lo que hay que apagar. */
const vivos = new Set();

/** Apaga un proceso y todo lo que lanzó. Solo por PID. */
export function matarArbol(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* ya había terminado */
  }
}

/** Apaga todo lo que esta corrida lanzó. */
export function matarTodos() {
  for (const pid of [...vivos]) {
    matarArbol(pid);
    vivos.delete(pid);
  }
}

/**
 * Corre un script de Node y devuelve `{ codigo, segundos, resumen, error, cola }`.
 * `resumen` es la línea JSON que dejó el auditor (o null); `cola`, las últimas
 * líneas de lo que escribió, para cuando se cae sin dejarla. Con `log`, la
 * salida entera se guarda ahí. Pasado `limiteMs`, lo corta.
 */
export function correrTarea({ script, args = [], env = {}, cwd = process.cwd(), limiteMs = 0, log = null }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const hijo = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: aparte,
      windowsHide: true,
    });
    if (hijo.pid) vivos.add(hijo.pid);
    let cola = "";
    let vencio = false;
    let salida = null;
    if (log) {
      mkdirSync(dirname(log), { recursive: true });
      salida = createWriteStream(log);
    }
    const juntar = (d) => {
      salida?.write(d);
      cola += d;
      if (cola.length > 262_144) cola = cola.slice(-262_144);
    };
    hijo.stdout.setEncoding("utf8");
    hijo.stderr.setEncoding("utf8");
    hijo.stdout.on("data", juntar);
    hijo.stderr.on("data", juntar);
    const reloj = limiteMs
      ? setTimeout(() => {
          vencio = true;
          matarArbol(hijo.pid);
        }, limiteMs)
      : null;
    let hecho = false;
    const fin = (codigo, errorDeArranque) => {
      if (hecho) return;
      hecho = true;
      if (reloj) clearTimeout(reloj);
      if (hijo.pid) vivos.delete(hijo.pid);
      salida?.end();
      const lineas = cola.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      resolve({
        codigo: codigo ?? -1,
        segundos: Math.round((Date.now() - t0) / 1000),
        resumen: leerResumen(cola),
        error: vencio ? `se pasó del límite de ${Math.round(limiteMs / 60_000)} min y se cortó` : (errorDeArranque ?? null),
        cola: lineas.slice(-12).map((l) => l.slice(0, 200)),
      });
    };
    hijo.once("error", (e) => fin(-1, `no arrancó: ${e.message}`));
    hijo.once("close", (codigo) => fin(codigo, null));
  });
}

/** ¿Hay algo escuchando en ese puerto, en IPv4 o en IPv6? */
export function escuchando(puerto) {
  const probar = (host) =>
    new Promise((ok) => {
      const s = net.connect({ port: puerto, host });
      s.setTimeout(500, () => {
        s.destroy();
        ok(false);
      });
      s.once("connect", () => {
        s.destroy();
        ok(true);
      });
      s.once("error", () => ok(false));
    });
  return Promise.all([probar("127.0.0.1"), probar("::1")]).then(([a, b]) => a || b);
}

/**
 * Levanta `vite preview` sobre `dist/` en el primer puerto libre de `desde` a
 * `hasta` (arranca en 4180 para no pisar los 4175 a 4179 de la cola de
 * baterías) y espera a que conteste. Devuelve `{ puerto, base, parar }`.
 */
export async function levantarPreview({ raiz, desde = 4180, hasta = 4199, esperaMs = 30_000 }) {
  const vite = join(raiz, "node_modules", "vite", "bin", "vite.js");
  for (let puerto = desde; puerto <= hasta; puerto++) {
    if (await escuchando(puerto)) continue;
    const hijo = spawn(process.execPath, [vite, "preview", "--port", String(puerto), "--strictPort"], {
      cwd: raiz,
      stdio: "ignore",
      detached: aparte,
      windowsHide: true,
    });
    if (hijo.pid) vivos.add(hijo.pid);
    let salio = false;
    hijo.once("exit", () => {
      salio = true;
    });
    const parar = () => {
      matarArbol(hijo.pid);
      vivos.delete(hijo.pid);
    };
    const t0 = Date.now();
    while (!salio && Date.now() - t0 < esperaMs) {
      try {
        const r = await fetch(`http://localhost:${puerto}/`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return { puerto, base: `http://localhost:${puerto}`, parar };
      } catch {
        /* todavía no levantó */
      }
      await sleep(300);
    }
    parar();
    // Salió sola (el puerto se tomó en el medio): se prueba con el que sigue.
    if (!salio) throw new Error(`la vista previa no contestó en ${esperaMs / 1000} s`);
  }
  throw new Error(`no hay un puerto libre entre ${desde} y ${hasta}`);
}
