#!/usr/bin/env node
/**
 * Corre `probar.mjs` contra el Worker de la sala levantado en esta máquina con `wrangler dev`, con todo lo de afuera imitado
 * (ver `entrada.mjs`): sin red, sin secretos reales, sin tocar la nube.
 *
 *   node workers/sala/prueba-local/correr.mjs                solo lo de Tus campañas (unos 3 minutos)
 *   node workers/sala/prueba-local/correr.mjs --completo     la prueba de siempre y además lo de Tus campañas (unos 6 minutos)
 *
 * Las llaves salen al azar en cada corrida y no se guardan: la de firmar queda en el entorno de la prueba y la pública en la
 * configuración temporal, dentro de `.wrangler/prueba-local/` (que git ignora). Termina con el código de `probar.mjs`.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { AQUI, RAIZ, SALA, levantar } from "./servidor.mjs";

const completo = process.argv.includes("--completo");
const hexa = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const secreta = ed25519.utils.randomSecretKey();
const publica = hexa(ed25519.getPublicKey(secreta));
const carpeta = join(RAIZ, ".wrangler", "prueba-local", `corrida-${Date.now()}`);
mkdirSync(carpeta, { recursive: true });

let servidor = null;
const apagar = () => servidor?.apagar();
process.on("SIGINT", () => {
  apagar();
  process.exit(130);
});

try {
  servidor = await levantar({
    main: join(AQUI, "entrada.mjs"),
    persistir: join(carpeta, "almacen"),
    carpeta,
    extra: {
      VIDA_PRUEBA_MS: "600000",
      LLAVE_CAMPANAS_PRUEBA: publica,
      // Un valor inventado en el momento: la sala solo lo usa para armar el cliente del proveedor, que acá es una imitación.
      POLLAR_SECRETO: `prueba-local-${hexa(crypto.getRandomValues(new Uint8Array(12)))}`,
    },
  });
  console.log(`wrangler dev arriba en ${servidor.base} (pid ${servidor.pid}, ${servidor.wrangler})`);
  const args = [join(SALA, "probar.mjs"), servidor.base, completo ? "--tus-campanas" : "--solo-tus-campanas"];
  const codigo = await new Promise((listo) => {
    const hijo = spawn(process.execPath, args, {
      stdio: "inherit",
      env: { ...process.env, CAMPANA_LLAVE_PRUEBA: hexa(secreta) },
    });
    hijo.on("exit", (c) => listo(c ?? 1));
  });
  apagar();
  console.log(`\nSalida de wrangler en ${servidor.registro}`);
  process.exit(codigo);
} catch (e) {
  apagar();
  console.error(String(e?.message ?? e));
  process.exit(2);
}
