import "./pagina";
import { $ } from "./dom";
import { onLangChange, texto as t } from "./idioma";
import { abrir, type Abierto } from "./enlace-corto";

/**
 * La página de un enlace corto: `tinkazo.app/c/<id>#<clave>`. En Vercel la sirve
 * la reescritura de `vercel.json`; en `pnpm dev` y `pnpm preview`, `vite.config.ts`.
 *
 * Trae el comprobante guardado en `c.tinkazo.app`, lo abre con la clave del
 * fragmento (que nunca sale del navegador) y va a su página, `verificar.html` o
 * `evento.html`, que rehacen todo igual que con el enlace largo: este paso no
 * decide nada. Mientras tanto dice que lo está abriendo; si no puede, dice por
 * qué con palabras de todos los días y ofrece volver a la portada.
 */

type Estado = "abriendo" | Extract<Abierto, { error: string }>["error"];

/** El título y la explicación de cada estado (las claves van entre comillas: así entran en los textos de la página). */
const TEXTOS: Record<Estado, readonly [string, string]> = {
  abriendo: ["cAbriendo", "cAbriendoB"],
  red: ["cRedT", "cRedB"],
  "no-existe": ["cNoExisteT", "cNoExisteB"],
  roto: ["cRotoT", "cRotoB"],
};

const id = /^\/c\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? "";
const clave = location.hash.slice(1);
let estado: Estado = "abriendo";

function pintar(): void {
  const [titulo, detalle] = TEXTOS[estado];
  document.body.dataset.estado = estado;
  $("c-titulo").textContent = t(titulo);
  $("c-detalle").textContent = t(detalle);
  $("c-puntos").style.display = estado === "abriendo" ? "" : "none";
  $("c-acciones").style.display = estado === "abriendo" ? "none" : "";
  // Una sola acción principal: con la red caída, probar de nuevo; si no, la portada.
  const red = estado === "red";
  $("c-otra").style.display = red ? "" : "none";
  $("c-portada").className = red ? "ghost" : "primary";
}

/**
 * Lo que la persona eligió en la dirección (idioma y tema) sigue en la página
 * del comprobante. Y por dónde llegó, para el contador del embudo
 * (src/contar.ts): desde el QR (`o=qr`, que trae el enlace corto del QR) o
 * desde el enlace corto (`o=short`). La página la saca de la dirección al abrir.
 */
function preferencias(): string {
  const q = new URLSearchParams(location.search);
  const sigue = new URLSearchParams();
  const lang = q.get("lang");
  const tema = q.get("theme");
  if (lang === "es" || lang === "en") sigue.set("lang", lang);
  if (tema === "light" || tema === "dark") sigue.set("theme", tema);
  sigue.set("o", q.get("o") === "qr" ? "qr" : "short");
  return `?${sigue.toString()}`;
}

async function intentar(): Promise<void> {
  estado = "abriendo";
  pintar();
  const r: Abierto = id && clave ? await abrir(id, clave) : { error: "roto" };
  if ("ruta" in r) {
    // La ruta ya viene revisada: verificar.html o evento.html de este sitio, con su fragmento.
    const corte = r.ruta.indexOf("#");
    location.replace(`${r.ruta.slice(0, corte)}${preferencias()}${r.ruta.slice(corte)}`);
    return;
  }
  estado = r.error;
  pintar();
  (estado === "red" ? $("c-otra") : $("c-portada")).focus({ preventScroll: true });
}

$("c-otra").addEventListener("click", () => void intentar());
onLangChange(pintar);
void intentar();
