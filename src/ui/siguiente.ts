import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app } from "../state";
import { mantenerDespierta, soltarDespierta } from "./despierta";
import { type Paso, claveDelPaso, detalleDeLista, lineaDelPaso, pasoDe, relojDe } from "./pasos";

/**
 * Lo que sigue: que en cada paso se vea cuál es la acción principal.
 *
 * Una prueba con alguien que usaba la herramienta por primera vez (19 de
 * octubre de 2026), mirando la espera de la ronda: "me cuesta encontrar el
 * botón del siguiente [...] no sé cuál es el siguiente". El botón de sortear
 * quedaba a pantalla y media de la caja de la espera, y el de otro premio a más
 * de una pantalla del ganador. El orden de la página (index.html) lo arregla en
 * parte; esto es lo demás:
 *
 * - El indicador de pasos de arriba: 1 Lista, 2 Sellar, 3 Sortear, 4
 *   Compartir. El actual resaltado y los hechos con ✓.
 * - Una barra fija abajo con la acción del paso. Es la red de seguridad: sale
 *   solo cuando el botón de verdad queda fuera de la pantalla, así nunca hay
 *   dos botones iguales a la vista, y su clic es un clic en el de verdad, así
 *   que la lógica no se repite en ningún lado.
 *
 * Nada de esto decide ni cambia el sorteo: mira qué paso toca y lo señala.
 * Tampoco depende de `freeze.ts` ni de `draw.ts`: ellos le avisan cuando algo
 * cambia (`actualizarPaso`), y la cuenta regresiva se la pasa `main.ts`.
 */

/** Qué toca ahora y con qué botón se hace. */
interface Toca {
  paso: Paso;
  /** El botón de verdad. Sin botón (la lista todavía no alcanza, o falta la cuenta) no hay barra. */
  boton: HTMLButtonElement | null;
  /** De qué se trata el paso. Cambia con el paso y no con el reloj: es lo que se anuncia. */
  clave: string;
  detalle: string;
  /** "0:25" mientras corre la cuenta regresiva de la ronda; si no, vacío. */
  reloj: string;
}

/** Los textos que tapan toda la página: con uno abierto la barra se va. */
const SUPERPUESTOS = ".modal-back, .game-card, .cortina, .espera, .sala";

let segundos: () => number = () => 0;
let listo = false;

/** El botón de verdad que se vigila, y si se ve entero. Mientras no se sabe, se supone que sí: la barra no parpadea. */
let observado: HTMLButtonElement | null = null;
let alVista = true;
let io: IntersectionObserver | null = null;
let moBoton: MutationObserver | null = null;

/** Alto de la barra, medido: cambia según el ancho. Lo usan el relleno de la página y el aviso flotante. */
let alto = 0;
let ultimaClave = "";

/**
 * Mide la barra y deja su alto en `--sig-alto`: de ahí salen el aire de abajo
 * de la página y el lugar del aviso flotante. Se vuelve a medir al ponerla,
 * con su texto ya escrito: vacía mide menos (en el celular la línea del paso
 * queda sobre el botón) y el pie de la página quedaba a medias detrás de ella.
 */
function medirBarra(): void {
  const h = Math.ceil($("siguiente").offsetHeight);
  if (h === alto) return;
  alto = h;
  document.documentElement.style.setProperty("--sig-alto", `${h}px`);
}

/** Cuánto tiene que llevar el botón fuera de la pantalla, y la pantalla quieta, para que entre la barra (ms). */
const DEMORA = 250;
const QUIETO = 150;
let quiereDesde = 0;
let ultimoScroll = 0;
let reintento = 0;

/** Cuántos nombres hay en la lista: los que dibuja `renderNames`, sin pedirle nada a `participants.ts`. */
const nombres = (): number => document.getElementById("names")?.childElementCount ?? 0;

/** La barra solo existe en la herramienta, en la pestaña del sorteo nuevo y fuera de la demo, que se hace sola. */
function activa(): boolean {
  const d = document.body.dataset;
  return d.vista === "app" && d.tab === "nuevo" && d.demo !== "1";
}

/** Estadio, tarjeta del juego, cortina, ventanas y la espera en grande: nada de esto va con la barra encima. */
function ocupado(): boolean {
  return document.querySelector(SUPERPUESTOS) !== null || $("stadium").style.display === "block";
}

/** La barra se va a encender si hace falta: `freeze.ts` no mueve la pantalla por su cuenta cuando sí. */
export const barraActiva = (): boolean => listo && activa();

/**
 * El botón de verdad que hace avanzar cada paso. En el 1, "Pegar lista". En el
 * 4, "Siguiente premio" si queda con quién sortear y, si no, el del comprobante
 * (`draw.ts` esconde uno y muestra el otro); en el ensayo, "Sortear con mi
 * lista", que es su final.
 *
 * Sin cuenta también: "Sellar la lista" abre la ventana para entrar, con su
 * motivo (`main.ts`), y eso es lo que sigue. Hasta el 22 de octubre de 2026 la
 * barra no salía sin cuenta, y en el celular "Sellar" quedaba una pantalla más
 * abajo sin que nada lo ofreciera (diseño del onboarding).
 */
function botonDe(paso: Paso): HTMLButtonElement | null {
  switch (paso) {
    case 4: {
      const fin = document.body.dataset.ensayo === "1" ? document.getElementById("ens-mio") : null;
      if (fin instanceof HTMLButtonElement) return fin;
      const sin = $<HTMLButtonElement>("btn-again-sin");
      const sigue = $("again-row").style.display !== "none" && sin.style.display !== "none";
      return sigue ? sin : $<HTMLButtonElement>("btn-proof");
    }
    case 3:
      return $<HTMLButtonElement>("btn-draw");
    case 2:
      return $<HTMLButtonElement>("btn-freeze");
    default: {
      const pegar = $<HTMLButtonElement>("btn-pegar");
      return pegar.disabled ? null : pegar;
    }
  }
}

/** El paso en que está el sorteo ahora (lo usa el tutorial para abrir en su tarjeta). */
export function pasoActual(): Paso {
  if (!listo) return 1;
  return calcular().paso;
}

/**
 * En qué paso está el sorteo y qué botón lo hace avanzar.
 *
 * El paso 4 empieza cuando el resultado ya se ve, no cuando se sabe: mientras
 * corre el juego, `app.drawn` está puesto pero la sala todavía no vio al
 * ganador.
 */
function calcular(): Toca {
  const revelado = app.drawn !== null && $("winner-box").style.display === "block";
  const n = nombres();
  const paso = pasoDe({ nombres: n, sellada: app.frozen !== null, revelado });
  const boton = botonDe(paso);
  const restan = paso === 3 ? segundos() : 0;
  const clave = claveDelPaso(paso, { segundos: restan, apagado: boton?.disabled ?? false, ganadores: app.drawn?.winners.length ?? 1 });
  let detalle = clave ? t(clave).replace("{n}", String(n)) : "";
  // Antes de sellar, qué se sortea: sellar lo fija, y desde la barra no se ve el campo.
  if (clave === "sigLista") detalle = detalleDeLista(detalle, (document.getElementById("prize") as HTMLInputElement | null)?.value ?? "", t("sigSinPremio"));
  return { paso, boton, clave, detalle, reloj: restan > 0 ? relojDe(restan) : "" };
}

/**
 * Avisa a la página cuando cambia de qué se trata el paso (`tinkazo:paso`), con
 * el paso y su clave: lo escuchan la línea que guía el ensayo y los números del
 * tutorial. Nunca con cada segundo de la cuenta.
 */
let ultimoAvisado = "";
function avisarPaso(s: Toca): void {
  const clave = `${s.paso}:${s.clave}`;
  if (clave === ultimoAvisado) return;
  ultimoAvisado = clave;
  document.dispatchEvent(new CustomEvent("tinkazo:paso", { detail: { paso: s.paso, clave: s.clave } }));
}

/** El indicador de arriba: hecho con ✓, el actual resaltado y lo que falta con su número. */
function pintarPasos(paso: Paso): void {
  for (const li of document.querySelectorAll<HTMLElement>("#pasos li")) {
    const n = Number(li.dataset.paso);
    const estado = n < paso ? "hecho" : n === paso ? "actual" : "falta";
    li.classList.toggle("hecho", estado === "hecho");
    li.classList.toggle("actual", estado === "actual");
    if (estado === "actual") li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    const num = li.querySelector(".p-n");
    if (num) num.textContent = estado === "hecho" ? "✓" : String(n);
    const e = li.querySelector(".p-e");
    if (e) e.textContent = estado === "hecho" ? t("pasoHecho") : estado === "actual" ? t("pasoActual") : "";
  }
}

/** La línea de la barra: "Paso 3 de 4 · Esperando la ronda · 0:25". */
const linea = (s: Toca): string => lineaDelPaso(t("sigPaso").replace("{n}", String(s.paso)), s.detalle, s.reloj);

/**
 * El cambio de paso, dicho con calma (`role="status"`, polite). Solo cuando
 * cambia de qué se trata, nunca con cada segundo de la cuenta: un lector de
 * pantalla leyendo el reloj cuatro veces por segundo no deja escuchar nada.
 */
function anunciar(s: Toca): void {
  const clave = `${s.paso}:${s.clave}`;
  if (clave === ultimaClave) return;
  const primera = ultimaClave === "";
  ultimaClave = clave;
  // Lo primero que se calcula al abrir la página no es un cambio: nadie lo anuncia.
  if (primera) return;
  // Sin texto (el paso 1) se vacía el aviso: volver al mismo paso con las mismas palabras tiene que ser un cambio
  // de nuevo, o el lector de pantalla no lo repite.
  if (!s.clave) {
    $("sig-aviso").textContent = "";
    return;
  }
  $("sig-aviso").textContent = s.clave === "sigRonda" ? `${t("sigPaso").replace("{n}", String(s.paso))}. ${t("sigAvisoRonda")}` : `${t("sigPaso").replace("{n}", String(s.paso))}. ${s.detalle}.`;
}

function pintarBarra(s: Toca, mostrar: boolean): void {
  const bar = $("siguiente");
  const btn = $<HTMLButtonElement>("sig-btn");
  if (s.boton) {
    // Sin cuenta, "Sellar la lista" está apagado (aria-disabled) y tocarlo abre la ventana para entrar: la barra dice lo
    // que va a pasar y no promete un sello (26 de octubre de 2026).
    const pideCuenta = s.paso === 2 && s.boton.getAttribute("aria-disabled") === "true";
    const texto = pideCuenta ? t("sigEntrarSellar") : (s.boton.textContent?.trim() ?? "");
    if (btn.textContent !== texto) btn.textContent = texto;
    btn.disabled = s.boton.disabled;
    btn.classList.toggle("lista", s.boton.classList.contains("lista"));
    const l = linea(s);
    const p = $("sig-paso");
    if (p.textContent !== l) p.textContent = l;
  }
  const entra = mostrar && !bar.classList.contains("on");
  // Si la barra se va con el foco adentro (se llegó con el teclado y la rueda llevó el botón de verdad a la
  // vista), el foco pasa al botón de verdad: apagar una región con el foco adentro lo deja en el aire.
  if (!mostrar && s.boton && bar.contains(document.activeElement)) s.boton.focus({ preventScroll: true });
  bar.classList.toggle("on", mostrar);
  // Escondida de verdad: ni el foco ni el lector la encuentran.
  bar.inert = !mostrar;
  document.body.classList.toggle("con-siguiente", mostrar);
  if (entra) medirBarra();
}

function render(): void {
  if (!listo) return;
  // Con la lista sellada, la pantalla no se apaga: la espera del número, el juego y el
  // resultado se miran en el celular o se proyectan desde él. Se suelta al pasar a otra lista.
  if (app.frozen) mantenerDespierta("sorteo");
  else soltarDespierta("sorteo");
  const s = calcular();
  pintarPasos(s.paso);
  anunciar(s);
  avisarPaso(s);
  vigilar(activa() ? s.boton : null);
  const quiere = activa() && s.boton !== null && !ocupado() && !alVista;
  const puesta = $("siguiente").classList.contains("on");
  let mostrar = quiere && puesta;
  if (!quiere) quiereDesde = 0;
  else if (!puesta) {
    // Para salir se esconde enseguida; para entrar se espera a que el botón
    // lleve un rato fuera y la pantalla esté quieta. Sin esto la barra entraba
    // y salía en medio del desplazamiento con que la página lleva al botón
    // (al sellar), un parpadeo justo en el momento que más se mira.
    const ahora = performance.now();
    if (!quiereDesde) quiereDesde = ahora;
    const falta = Math.max(DEMORA - (ahora - quiereDesde), QUIETO - (ahora - ultimoScroll));
    if (falta <= 0) mostrar = true;
    else {
      clearTimeout(reintento);
      reintento = window.setTimeout(render, falta + 5);
    }
  }
  pintarBarra(s, mostrar);
}

/** Cambia el botón que se vigila: el observador de la vista y el de sus cambios. */
function vigilar(boton: HTMLButtonElement | null): void {
  if (boton === observado) return;
  if (observado) io?.unobserve(observado);
  moBoton?.disconnect();
  observado = boton;
  // Hasta que el observador diga otra cosa se supone lo que ya se veía: sin
  // barra, que el botón nuevo se ve (no entra de golpe); con barra, que sigue
  // fuera (no se va para volver, como cuando el sello pasa a la espera).
  alVista = !$("siguiente").classList.contains("on");
  if (!boton) return;
  io?.observe(boton);
  moBoton?.observe(boton, { attributes: true, attributeFilter: ["disabled", "aria-disabled", "class", "style"], childList: true, characterData: true, subtree: true });
}

/**
 * Mide la barra y arma el observador: el botón "se ve" si entra entero en la
 * pantalla, sin la cabecera fija (en pantallas anchas) que le tapa el borde de
 * arriba.
 *
 * El borde de abajo no descuenta el lugar de la barra, y es a propósito: un
 * botón que cabe entero en la pantalla se ve esté donde esté, y la barra se
 * esconde. Si la barra se quedara hasta que el botón saliera de su franja, lo
 * tendría a medio tapar detrás, con los dos botones iguales a la vista. Con
 * esto, la barra solo está cuando el botón de verdad no se ve entero, y nunca
 * lo tapa.
 */
function armar(): void {
  medirBarra();
  // Sin `IntersectionObserver` (un navegador muy viejo) no hay barra: el botón de verdad sigue donde está y el
  // resto del sitio funciona igual. La barra es una red de seguridad, no puede romper lo que protege.
  if (typeof IntersectionObserver === "undefined") return;
  const cab = document.querySelector("header");
  const arriba = cab && getComputedStyle(cab).position === "sticky" ? Math.ceil(cab.getBoundingClientRect().height) : 0;
  io?.disconnect();
  io = new IntersectionObserver(
    (entradas) => {
      const e = entradas[entradas.length - 1];
      if (!e) return;
      const entero = e.isIntersecting && e.intersectionRatio >= 0.98;
      if (entero === alVista) return;
      alVista = entero;
      render();
    },
    { rootMargin: `${-arriba}px 0px 0px 0px`, threshold: [0, 0.5, 0.98, 1] },
  );
  if (observado) io.observe(observado);
}

/** Que se vuelva a mirar qué paso toca. Lo llaman `freeze.ts` y `draw.ts` cuando algo cambia. */
export function actualizarPaso(): void {
  render();
}

/**
 * Un error que la herramienta escribe junto al botón de verdad ("No pude
 * hablar con la red de Stellar"). Si la persona apretó el de la barra, ese
 * botón está fuera de la pantalla y el error también: quedaba a la vista un
 * botón que volvía a estar disponible sin decir por qué. Si el mensaje no se ve
 * (sin contar la cabecera fija ni la propia barra), se lo lleva a la pantalla;
 * con el movimiento reducido, sin animación.
 *
 * Si el sorteo arrancó desde la espera en grande, la pantalla es ella: se le
 * ofrece el mensaje primero (`tinkazo:error`), y si lo muestra, con la acción
 * para reintentar, la página de atrás no se mueve (espera.ts).
 */
export function verError(mensaje: HTMLElement): void {
  const enGrande = new CustomEvent("tinkazo:error", { detail: mensaje.textContent?.trim() ?? "", cancelable: true });
  if (!document.dispatchEvent(enGrande)) return;
  const r = mensaje.getBoundingClientRect();
  const cab = document.querySelector("header");
  const arriba = cab && getComputedStyle(cab).position === "sticky" ? cab.getBoundingClientRect().height : 0;
  const abajo = innerHeight - ($("siguiente").classList.contains("on") ? alto : 0);
  if (r.top >= arriba && r.bottom <= abajo) return;
  const reducido = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  mensaje.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "center" });
}

/**
 * Se llama una vez, con la herramienta ya armada. `segundos` es la cuenta
 * regresiva de la ronda (la de `freeze.ts`).
 */
export function initSiguiente(opciones: { segundos: () => number }): void {
  segundos = opciones.segundos;
  $("sig-btn").addEventListener("click", () => {
    // Un clic en el de verdad: hace lo mismo, con el mismo permiso del gesto.
    const real = observado;
    if (!real || real.disabled) return;
    real.click();
    // La barra se va al apretarlo y el foco no puede quedar en el aire: va al botón de verdad.
    real.focus({ preventScroll: true });
  });
  addEventListener("scroll", () => (ultimoScroll = performance.now()), { passive: true });
  moBoton = new MutationObserver(render);
  const general = new MutationObserver(render);
  // Ventanas, tarjeta y cortina se agregan al cuerpo; el estadio es fijo y cambia de estilo.
  general.observe(document.body, { childList: true, attributes: true, attributeFilter: ["data-vista", "data-tab", "data-sesion", "data-ensayo"] });
  general.observe($("stadium"), { attributes: true, attributeFilter: ["style"] });
  // La lista cambia sin que nadie toque el sello: pasar de 1 a 2 nombres es pasar de paso.
  general.observe($("names"), { childList: true });
  // El premio está en la línea del paso 2: se rehace al escribirlo, al tocar uno de los premios o cuando la página lo pone.
  $("prize").addEventListener("input", render);
  $("prize").addEventListener("tinkazo:premio", render);
  $("prize-chips").addEventListener("click", () => queueMicrotask(render));
  // El sello se apaga y se prende sin cambiar de botón; la puerta, al conectar la cuenta.
  general.observe($("sec-participants"), { attributes: true, subtree: true, attributeFilter: ["class"] });
  onLangChange(render);
  let cuadro = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => {
      armar();
      render();
    });
  });
  // La barra cambia de alto mientras está puesta: el botón pasa de "Sellar la lista" a "Se habilita en 0:25" y la
  // línea del paso se acomoda. Medirla solo al entrar dejaba el aire de abajo de la página en el alto de antes, y el
  // pie quedaba hasta 8 px debajo de la barra (audit-flujo, "sellada y esperando", 26 de octubre de 2026).
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(medirBarra).observe($("siguiente"));
  listo = true;
  armar();
  render();
}
