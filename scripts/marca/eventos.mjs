/**
 * Los eventos de comunidad que muestra la página de marca: el enlace oficial de cada uno y su código QR, para
 * escanearlo desde una pantalla o un afiche. El QR es solo ese enlace (nada de Tinkazo adentro) y lo arma
 * `qr.mjs`, el mismo de los impresos: nivel Q, zona tranquila blanca de 4 módulos y módulos en tinta oscura.
 */
import { aD, num } from "./base.mjs";
import { cmdsQr, matrizQr, ZONA } from "./qr.mjs";

/** La página oficial del DevFest Tarija 2026, donde se reserva el lugar. */
export const URL_DEVFEST = "https://gdg.community.dev/events/details/google-gdg-tarija-presents-devfest-tarija-2026/";
/** La edición local de Santa Cruz de la Sierra en el sitio oficial del NASA Space Apps Challenge 2026. */
export const URL_SPACE_APPS_SCZ = "https://www.spaceappschallenge.org/2026/local-events/santa-cruz-de-la-sierra/";

/** Cada evento: carpeta y nombre de su QR en public/marca/, el enlace oficial y lo que dice el SVG para quien no lo ve. */
export const EVENTOS_QR = [
  { id: "devfest-tarija-2026", carpeta: "devfest", url: URL_DEVFEST, titulo: "Código QR del enlace para reservar lugar en el DevFest Tarija 2026" },
  { id: "space-apps-santa-cruz-2026", carpeta: "space-apps", url: URL_SPACE_APPS_SCZ, titulo: "Código QR de la página oficial de la edición de Santa Cruz de la Sierra del NASA Space Apps Challenge 2026" },
];

/** La ruta dentro de public/marca/ del QR de un evento. */
export const rutaQrEvento = (e) => `${e.carpeta}/qr-${e.id}.svg`;

/** Cada módulo mide MODULO unidades: el QR mide (módulos + 8) * 10 de lado, con su borde blanco incluido. */
const MODULO = 10;

/** El SVG del QR de una dirección: fondo blanco, zona tranquila de 4 módulos y un solo trazo oscuro (`class="qr"`). */
export function svgQrEvento(url, titulo) {
  const { n } = matrizQr(url);
  const lado = (n + 2 * ZONA) * MODULO;
  const q = cmdsQr(url, ZONA * MODULO, ZONA * MODULO, n * MODULO);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(lado)}" height="${num(lado)}" viewBox="0 0 ${num(lado)} ${num(lado)}" role="img" aria-labelledby="titulo">
<title id="titulo">${titulo}</title>
<rect width="${num(lado)}" height="${num(lado)}" fill="#ffffff"/>
<path class="qr" d="${aD(q.cmds)}" fill="#191919"/>
</svg>
`;
}
