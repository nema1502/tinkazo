/**
 * Pinta la sección "Para creadores" de marca.html: la guía de CapCut, los diez guiones y, cuando el kit
 * está publicado (`KIT_PUBLICADO`), la lista de clips y de logos animados con sus enlaces de descarga.
 * Los datos están en `marca-creadores.ts`; los rótulos fijos, en `marca-creadores-textos.ts` (por `data-i`).
 */
import { type Lang, getLang, onLangChange, texto } from "./idioma";
import {
  CLIPS,
  GUIONES,
  KIT_PUBLICADO,
  LOGOS_ANIMADOS,
  type Guion,
  archivoBucle,
  archivoGuion,
  archivoSubtitulos,
  guionComoTexto,
  pasosActuales,
  urlEjemplo,
  urlKit,
} from "./marca-creadores";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, clase?: string, contenido?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (contenido !== undefined) e.textContent = contenido;
  return e;
}

function enlace(href: string, rotulo: string, archivo: string): HTMLAnchorElement {
  const a = el("a", "mini", rotulo);
  a.href = href;
  a.download = archivo;
  return a;
}

const segundos = (n: number): string => `${String(n).replace(".", getLang() === "es" ? "," : ".")} ${texto("crSeg")}`;

function bloque(titulo: string, cuerpo: HTMLElement): HTMLElement {
  const d = el("div", "cr-bloque");
  d.append(el("h4", undefined, titulo), cuerpo);
  return d;
}

function lista(items: string[], ordenada = false): HTMLElement {
  const l = el(ordenada ? "ol" : "ul", "cr-lista");
  for (const i of items) l.append(el("li", undefined, i));
  return l;
}

function pintarGuion(g: Guion, lang: Lang, abierto: boolean, estado: HTMLElement | null): HTMLElement {
  const d = el("details", "cr-guion");
  d.dataset.juego = g.juego;
  d.open = abierto;
  const clip = CLIPS.find((c) => c.juego === g.juego);
  const resumen = el("summary");
  resumen.append(el("span", "cr-nombre", clip?.nombre[lang] ?? g.juego), el("span", "cr-titulo", g.titulo[lang]));
  d.append(resumen);
  const cuerpo = el("div", "cr-cuerpo");
  cuerpo.append(bloque(texto("crGancho"), el("p", "cr-gancho", g.gancho[lang])));
  cuerpo.append(bloque(texto("crVoz"), el("p", undefined, g.voz[lang])));
  cuerpo.append(bloque(texto("crMomentos"), lista(g.momentos.map((m) => `${m.t.replace(" a ", ` ${texto("crSeg")} a `)} ${texto("crSeg")}: ${m[lang]}`))));
  cuerpo.append(bloque(texto("crPantalla"), lista(g.pantalla.map((l) => `${segundos(l.desde)} a ${segundos(l.hasta)}: ${l[lang]}`))));
  cuerpo.append(bloque(texto("crCierre"), el("p", undefined, g.cierre[lang])));
  cuerpo.append(bloque(texto("crToque"), el("p", undefined, g.toque[lang])));
  cuerpo.append(bloque(texto("crDescripcion"), el("p", "cr-hashtags", `tinkazo.app @tinkazo.app ${g.hashtags}`)));
  if (!KIT_PUBLICADO) {
    // Sin clips para bajar todavía: el ejemplo del juego, para grabar la pantalla.
    const p = el("p", undefined, `${texto("crEjemploB")} `);
    const a = el("a", undefined, urlEjemplo(g.juego).replace("https://", ""));
    a.href = urlEjemplo(g.juego);
    a.target = "_blank";
    a.rel = "noopener";
    p.append(a);
    cuerpo.append(bloque(texto("crEjemplo"), p));
  }
  const acciones = el("div", "cr-acciones");
  const copiar = el("button", "mini", texto("crCopiar"));
  copiar.type = "button";
  copiar.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(guionComoTexto(g, getLang()));
      if (estado) estado.textContent = `${texto("crCopiado")}: ${g.titulo[getLang()]}`;
    } catch {
      if (estado) estado.textContent = texto("crNoCopio");
    }
  });
  acciones.append(copiar);
  if (KIT_PUBLICADO) {
    if (clip) acciones.append(enlace(urlKit(clip.archivo), texto("crClipBajar"), clip.archivo));
    acciones.append(enlace(urlKit(archivoGuion(g, lang)), texto("crBajarGuion"), archivoGuion(g, lang)));
    acciones.append(enlace(urlKit(archivoSubtitulos(g, "es")), texto("crSubEs"), archivoSubtitulos(g, "es")));
    acciones.append(enlace(urlKit(archivoSubtitulos(g, "en")), texto("crSubEn"), archivoSubtitulos(g, "en")));
  }
  cuerpo.append(acciones);
  d.append(cuerpo);
  return d;
}

function pintarClips(lang: Lang): void {
  const cont = document.getElementById("cr-clips");
  if (!cont) return;
  cont.replaceChildren();
  for (const c of CLIPS) {
    const fig = el("figure", "marca-par cr-clip");
    const vista = el("div", "marca-vista cr-poster");
    const img = el("img");
    img.src = `/kit-clips/${c.juego}.webp`;
    img.width = 270;
    img.height = 480;
    img.alt = "";
    img.loading = "lazy";
    vista.append(img);
    const pie = el("figcaption", undefined, `${c.nombre[lang]} (${segundos(c.seg)}${c.mb ? `, ${c.mb.toFixed(1)} MB` : ""})`);
    pie.id = `cr-clip-${c.juego}`;
    const acciones = el("div", "marca-descargas");
    const bajar = enlace(urlKit(c.archivo), texto("crClipBajar"), c.archivo);
    bajar.setAttribute("aria-describedby", pie.id);
    const bucle = enlace(urlKit(archivoBucle(c)), texto("crClipBucle"), archivoBucle(c));
    bucle.setAttribute("aria-describedby", pie.id);
    acciones.append(bajar, bucle);
    fig.append(vista, pie, acciones);
    cont.append(fig);
  }
}

function pintarLogos(): void {
  const cont = document.getElementById("cr-logos");
  if (!cont) return;
  cont.replaceChildren();
  const lang = getLang();
  const claves = { oscuro: "crLogoOscuro", claro: "crLogoClaro", verde: "crLogoVerde", alfa: "crLogoAlfa" } as const;
  const grupos: Array<[string, typeof LOGOS_ANIMADOS]> = [
    [texto("crLogoEntrada"), LOGOS_ANIMADOS.filter((l) => l.tipo === "entrada")],
    [texto("crLogoSalida"), LOGOS_ANIMADOS.filter((l) => l.tipo === "salida" && l.idioma === lang)],
  ];
  for (const [titulo, logos] of grupos) {
    const bloqueLogos = el("div", "cr-bloque");
    bloqueLogos.append(el("h4", undefined, titulo));
    const acciones = el("div", "marca-descargas cr-logo-links");
    for (const l of logos) acciones.append(enlace(urlKit(l.archivo), texto(claves[l.fondo]), l.archivo));
    bloqueLogos.append(acciones);
    cont.append(bloqueLogos);
  }
}

/** Arma la sección y la vuelve a pintar cuando cambia el idioma, sin cerrar los guiones que quien lee tenía abiertos. */
export function iniciarCreadores(): void {
  const raiz = document.getElementById("creadores");
  if (!raiz) return;
  const abiertos = new Set<string>();
  const pintar = (): void => {
    const lang = getLang();
    const estado = document.getElementById("cr-estado");
    for (const d of raiz.querySelectorAll<HTMLDetailsElement>("details.cr-guion")) if (d.open && d.dataset.juego) abiertos.add(d.dataset.juego);
    for (const d of raiz.querySelectorAll<HTMLDetailsElement>("details.cr-guion")) if (!d.open && d.dataset.juego) abiertos.delete(d.dataset.juego);
    // Lo que se baja solo se ofrece cuando los archivos están publicados.
    // La bajada promete clips solo cuando se pueden bajar.
    const bajada = raiz.querySelector<HTMLElement>("[data-i=crB], [data-i=crBListo]");
    if (bajada && KIT_PUBLICADO) {
      bajada.dataset.i = "crBListo";
      bajada.textContent = texto("crBListo");
    }
    const aviso = document.getElementById("cr-aviso");
    if (aviso) aviso.hidden = KIT_PUBLICADO;
    const descargas = document.getElementById("cr-descargas");
    if (descargas) descargas.hidden = !KIT_PUBLICADO;
    if (KIT_PUBLICADO) {
      pintarClips(lang);
      pintarLogos();
    }
    const pasos = document.getElementById("cr-pasos");
    if (pasos) {
      pasos.replaceChildren();
      for (const p of pasosActuales()) pasos.append(el("li", undefined, p[lang]));
    }
    const guiones = document.getElementById("cr-guiones");
    if (guiones) {
      guiones.replaceChildren();
      for (const g of GUIONES) guiones.append(pintarGuion(g, lang, abiertos.has(g.juego), estado));
    }
  };
  pintar();
  onLangChange(pintar);
}
