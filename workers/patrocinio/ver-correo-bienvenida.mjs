// Escribe el correo de bienvenida en seis archivos para mirarlo a tamaño real, sin mandar nada ni llamar a nadie:
// en español, en inglés y los dos juntos, cada uno en HTML y en texto plano. Usa la misma función que arma el correo
// en el portero (src/correo-bienvenida.ts), así lo que se mira es lo que sale.
//
//   node ver-correo-bienvenida.mjs [carpeta] [--sin-nombre] [--sorteos N] [--dias N]
//
// Sin carpeta, escribe en una carpeta nueva dentro de la temporal del sistema y dice cuál. Los HTML se abren en el
// navegador, en celular y en escritorio, con el sistema en tema claro y en oscuro.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textoDeBienvenida, venceDelRegalo } from "./src/correo-bienvenida.ts";

const argumentos = process.argv.slice(2);
const valorDe = (bandera, porDefecto) => {
  const i = argumentos.indexOf(bandera);
  const n = i >= 0 ? Number(argumentos[i + 1]) : porDefecto;
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
};
const sueltos = argumentos.filter((a, i) => !a.startsWith("--") && !["--sorteos", "--dias"].includes(argumentos[i - 1] ?? ""));
const carpeta = sueltos[0] ? path.resolve(sueltos[0]) : fs.mkdtempSync(path.join(os.tmpdir(), "correo-bienvenida-"));
fs.mkdirSync(carpeta, { recursive: true });

const datos = {
  nombre: argumentos.includes("--sin-nombre") ? null : "Quinua",
  sorteos: valorDe("--sorteos", 3),
  vence: venceDelRegalo(Date.now(), valorDe("--dias", 60)),
};

for (const [sufijo, idioma] of [["es", "es"], ["en", "en"], ["dos", null]]) {
  const c = textoDeBienvenida(idioma, datos);
  fs.writeFileSync(path.join(carpeta, `bienvenida-${sufijo}.html`), c.html, "utf8");
  fs.writeFileSync(path.join(carpeta, `bienvenida-${sufijo}.txt`), `Asunto: ${c.asunto}\n\n${c.texto}\n`, "utf8");
}
console.log(`Seis archivos en ${carpeta}`);
