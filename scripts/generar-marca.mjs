/** Deriva descargas del icono original sin modificarlo ni usar fuentes externas. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
const destino = new URL("../public/marca/", import.meta.url);
mkdirSync(destino, { recursive: true });
const icono = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const grupo = icono.match(/<g[\s\S]*<\/g>/)[0];
writeFileSync(new URL("llama.svg", destino), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n  ${grupo}\n</svg>\n`);
const rects = [...grupo.matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
const n = 2048, raw = Buffer.alloc(n * (n * 4 + 1));
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const u = ((x + .5) / 4 - 256) / 14 + 11, v = ((y + .5) / 4 - 256) / 14 + 11;
  if (rects.some(([rx, ry, w, h]) => u >= rx && u < rx + w && v >= ry && v < ry + h)) {
    const i = y * (n * 4 + 1) + 1 + x * 4;
    raw.set([233, 61, 156, 255], i);
  }
}
function chunk(tipo, datos) {
  const contenido = Buffer.concat([Buffer.from(tipo), datos]);
  let crc = 0xffffffff;
  for (const b of contenido) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const salida = Buffer.alloc(datos.length + 12);
  salida.writeUInt32BE(datos.length); contenido.copy(salida, 4);
  salida.writeUInt32BE((crc ^ 0xffffffff) >>> 0, salida.length - 4);
  return salida;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(new URL("llama.png", destino), Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
for (const [lang, frase] of [["es", "Sorteo verificable con"], ["en", "Verifiable draw with"]]) {
  writeFileSync(new URL(`sello-${lang}.svg`, destino), `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="280" viewBox="0 0 960 280" role="img" aria-labelledby="titulo" xml:lang="${lang}">
<title id="titulo">${frase} Tinkazo</title>
<path fill="#191919" d="M12 12h936v256H12z M18 18v244h924V18z" fill-rule="evenodd"/>
<g transform="translate(0 12) scale(.5)">${grupo}</g>
<g fill="#191919" font-family="system-ui, sans-serif"><text x="270" y="108" font-size="42" font-weight="700">${frase}</text><text x="266" y="196" font-size="80" font-weight="900" letter-spacing="-1.6">Tinka<tspan fill="#e93d9c">zo</tspan></text></g>
</svg>\n`);
}
console.log("Marca: SVG 512×512, PNG RGBA 2048×2048 y sellos ES/EN 960×280.");
