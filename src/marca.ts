import "./pagina";
import "./marca.css";
import { getLang, onLangChange, texto } from "./idioma";

const claves = ["maFondo", "maTarjeta", "maTinta", "maTinta2", "maApagado", "maMagenta", "maNaranja", "maTurquesa", "maAmarillo", "maMorado"];
const paletas = [
  ["paleta-clara", ["#fff6e9", "#ffffff", "#191919", "#4b4437", "#6b655b", "#e93d9c", "#ff7a1a", "#00a896", "#ffc629", "#6c4ce0"]],
  ["paleta-oscura", ["#171126", "#221a33", "#f6efe2", "#cfc6b4", "#97909f", "#ff5cb3", "#ff8b3d", "#17c3b2", "#ffd24d", "#9b7bff"]],
] as const;
const estado = document.querySelector<HTMLElement>("#marca-estado");
for (const [id, colores] of paletas) {
  const contenedor = document.getElementById(id);
  colores.forEach((hex, i) => {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.dataset.hex = hex;
    const muestra = document.createElement("span");
    muestra.className = "marca-color";
    muestra.style.backgroundColor = hex;
    muestra.setAttribute("aria-hidden", "true");
    const nombre = document.createElement("span");
    nombre.dataset.i = claves[i];
    nombre.textContent = texto(claves[i]!);
    const codigo = document.createElement("code");
    codigo.textContent = hex;
    boton.append(muestra, nombre, codigo);
    boton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(hex);
        if (estado) estado.textContent = `${texto("maCopiado")}: ${hex}`;
      } catch {
        if (estado) estado.textContent = texto("maError");
      }
    });
    contenedor?.append(boton);
  });
}
function actualizarSello(): void {
  const lang = getLang();
  const img = document.querySelector<HTMLImageElement>("#sello-vista");
  const enlace = document.querySelector<HTMLAnchorElement>("#sello-descarga");
  if (img) img.src = `/marca/sello-${lang}.svg`;
  if (enlace) {
    enlace.href = `/marca/sello-${lang}.svg`;
    enlace.download = `tinkazo-sello-${lang}.svg`;
  }
  if (estado) estado.textContent = "";
}
/** Los archivos que cambian con el idioma (stickers con texto, imágenes de redes, afiches, portada): {l} es es o en, y {en} es "-en" o nada. */
function actualizarArchivos(): void {
  const lang = getLang();
  const f = (v: string): string => v.replaceAll("{l}", lang).replaceAll("{en}", lang === "en" ? "-en" : "");
  for (const el of document.querySelectorAll<HTMLElement>("[data-src], [data-href], [data-download]")) {
    if (el instanceof HTMLImageElement && el.dataset.src) el.src = f(el.dataset.src);
    if (el instanceof HTMLAnchorElement) {
      if (el.dataset.href) el.href = f(el.dataset.href);
      if (el.dataset.download) el.download = f(el.dataset.download);
    }
  }
}
function actualizarTodo(): void {
  actualizarSello();
  actualizarArchivos();
}
actualizarTodo();
onLangChange(actualizarTodo);
