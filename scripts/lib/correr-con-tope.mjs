/**
 * Corre una orden con un tope de tiempo y dice cómo terminó: el código, si se cortó por tiempo, cuánto
 * tardó y el último renglón que escribió. Al vencer el tope mata el árbol entero: en Windows, con
 * `shell`, matar el proceso mataba solo el cmd y lo de abajo (pnpm, Vitest) seguía corriendo de fondo.
 * Sin efectos al importarse.
 */
import { spawn, spawnSync } from "node:child_process";

export function correrConTope(orden, args, { tope, shell = false, cwd } = {}) {
  return new Promise((listo) => {
    const desde = Date.now();
    let porTiempo = false;
    let ultimo = "";
    const guardar = (d) => {
      ultimo = (ultimo + d).slice(-4000);
    };
    const hijo = spawn(orden, args, { cwd, shell, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    hijo.stdout.on("data", guardar);
    hijo.stderr.on("data", guardar);
    const reloj = setTimeout(() => {
      porTiempo = true;
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
        else process.kill(-hijo.pid, "SIGKILL");
      } catch {
        /* ya terminó */
      }
    }, tope);
    hijo.on("error", (e) => {
      clearTimeout(reloj);
      listo({ codigo: null, porTiempo: false, ms: Date.now() - desde, error: String(e) });
    });
    hijo.on("close", (codigo) => {
      clearTimeout(reloj);
      const renglon = ultimo.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
      listo({ codigo: codigo ?? 1, porTiempo, ms: Date.now() - desde, error: renglon.slice(0, 200) });
    });
  });
}
