import { $ } from "../dom";
import { eventoError, type AccionError } from "./error-accion";
import { enEnsayo, enStand } from "../ensayo-modo";
import { onLangChange, t } from "../i18n";
import { app } from "../state";
import { mantenerDespierta, soltarDespierta } from "./despierta";
import { type Paso, claveDelPaso, detalleDeLista, lineaDelPaso, pasoDe, relojDe } from "./pasos";
import { esResultadoDeTurnos } from "../modos/turnos";
import { modesVisible } from "../modos/bandera";
import { contar, seCuentaPorPersona } from "../participaciones";
import { canonicalList } from "../protocol/canonical";

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
 *   Compartir, como una barra de progreso en cuatro tramos y no como cuatro
 *   cajitas: no es nada para apretar. El actual resaltado y los hechos con ✓.
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
  /** La línea lleva las dos cuentas (personas y participaciones o turnos): en el celular vale hasta dos renglones. */
  doble: boolean;
  /** "0:25" mientras corre la cuenta regresiva de la ronda; si no, vacío. */
  reloj: string;
}

/** Los textos que tapan toda la página: con uno abierto la barra se va. */
const SUPERPUESTOS = ".modal-back, .cuenta-lista, .game-card, .cortina, .espera, .sala, .stand-sala.grande";

let segundos: () => number = () => 0;
let listo = false;

/** El botón de verdad que se vigila, y si se ve entero. Mientras no se sabe, se supone que sí: la barra no parpadea. */
let observado: HTMLButtonElement | null = null;
let alVista = true;
let io: IntersectionObserver | null = null;
let moBoton: MutationObserver | null = null;
/** El botón de la lista de equipos con cupón y sus contenedores: si aparece, desaparece o se esconde, la barra se recalcula. */
let moLista: MutationObserver | null = null;
let listaObservada: Element | null = null;

/**
 * La página ya no existe: el ambiente de una prueba se desarmó (sin `document`) y los observadores de la barra, que siguen
 * vivos, avisaron igual. Sin nada que mirar no hay nada que hacer. En el navegador `document` siempre está: nunca corta.
 */
const sinPagina = (): boolean => typeof document === "undefined";

function vigilarListaDeCupones(): void {
  const b = document.getElementById("eq-lista");
  if (b === listaObservada) return;
  moLista?.disconnect();
  listaObservada = b;
  if (!b) return;
  moLista ??= new MutationObserver(render);
  // Hasta el cuerpo no: la propia barra cambia sus clases, y eso no tiene que volver a despertar este cálculo.
  for (let el: HTMLElement | null = b; el && el !== document.body; el = el.parentElement) moLista.observe(el, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
}

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

/**
 * La barra solo existe en la herramienta, en la pestaña del sorteo nuevo y fuera
 * de la demo, que se hace sola. En el modo stand sale solo antes de empezar la
 * ronda (con la lista escrita, "Empezar la ronda" queda más abajo en el celular):
 * después la ronda corre sola y la barra hablaría de sellos, números y
 * comprobantes que ahí no hay.
 */
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
 * (`draw.ts` esconde uno y muestra el otro); en el ensayo, "Probar otro juego",
 * que es su final.
 *
 * Sin cuenta también: "Sellar la lista" abre la ventana para entrar, con su
 * motivo (`main.ts`), y eso es lo que sigue. Hasta el 22 de octubre de 2026 la
 * barra no salía sin cuenta, y en el celular "Sellar" quedaba una pantalla más
 * abajo sin que nada lo ofreciera (diseño del onboarding).
 */
function botonDe(paso: Paso): HTMLButtonElement | null {
  switch (paso) {
    case 4: {
      const fin = document.body.dataset.ensayo === "1" ? document.getElementById("ens-otro") : null;
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
 * Si el panel de equipos ya ofrece usar los que tienen cupón como lista, manda esa: la barra no propone "Pegar
 * lista" a la vez (una sola acción principal por paso, docs/ux.md). El botón se ve cuando la sala está abierta y
 * hay al menos un equipo con cupón.
 */
export function mandaListaDeCupones(): boolean {
  const b = document.getElementById("eq-lista");
  if (!(b instanceof HTMLButtonElement)) return false;
  // No alcanza con que el botón no esté escondido: si un contenedor suyo lo está (el panel plegado o la sala cerrada), nadie lo ve.
  for (let el: HTMLElement | null = b; el; el = el.parentElement) if (el.hidden) return false;
  return typeof b.checkVisibility === "function" ? b.checkVisibility() : true;
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
  // En el stand la barra es solo para empezar la ronda: ni "Pegar lista" ni nada de después.
  const botonReal = enStand() && (paso !== 2 || app.frozen) ? null : botonDe(paso);
  // Con equipos con cupón, manda usar esa lista que ofrece el panel.
  const boton = paso === 1 && mandaListaDeCupones() ? null : botonReal;
  const restan = paso === 3 ? segundos() : 0;
  // En el paso 2 el botón también se apaga cuando falta una segunda persona (participants.ts): eso no es que se esté
  // sellando, y la barra sigue diciendo qué hay en la lista. Se cuenta con la misma regla que apaga el botón.
  const ta2 = paso === 2 ? (document.getElementById("ta") as HTMLTextAreaElement | null) : null;
  const faltaOtraPersona = !!ta2 && contar(canonicalList(ta2.value), modesVisible()).personas < 2;
  const apagado = (boton?.disabled ?? false) && !faltaOtraPersona;
  const clave = claveDelPaso(paso, { segundos: restan, apagado, ganadores: app.drawn?.winners.length ?? 1, turnos: esResultadoDeTurnos() });
  let detalle = clave ? t(clave).replace("{n}", String(n)) : "";
  let doble = false;
  // Con los modos a la vista, o sin ellos con una lista que es un reparto entero (`seCuentaPorPersona` sin modos, como
  // la cuenta del cuadro y la cabecera después de sellar), la barra cuenta personas y líneas: en un orden de turnos
  // las líneas son turnos, y con varias participaciones son participaciones, no personas.
  const turnosActivo = document.getElementById("btn-turnos")?.getAttribute("aria-pressed") === "true";
  const lineasDelCuadro = clave === "sigLista" ? canonicalList((document.getElementById("ta") as HTMLTextAreaElement | null)?.value ?? "") : [];
  if (clave === "sigLista" && (turnosActivo || modesVisible() || seCuentaPorPersona(lineasDelCuadro, false))) {
    // Las personas se cuentan con la misma función que el resto, desde el cuadro: leer el texto de las
    // fichas dependía de cómo se pintan y podía contar distinto que el cuadro y el resumen.
    const personas = contar(lineasDelCuadro, true).personas;
    if (personas > 0 && personas < n) {
      doble = true;
      detalle = turnosActivo
        ? t(personas === 1 ? "sigListaTurnosUno" : "sigListaTurnos").replace("{p}", String(personas)).replace("{n}", String(n))
        : t(personas === 1 ? "sigListaPartUno" : "sigListaPart").replace("{p}", String(personas)).replace("{n}", String(n));
    }
  }
  // Antes de sellar, qué se sortea: sellar lo fija, y desde la barra no se ve el campo. En el ensayo no se nombra
  // el premio que falta: nada se sella de verdad. En un orden de turnos no hay premio que nombrar.
  // En el stand no hay premio: la línea dice solo cuántas personas hay.
  if (clave === "sigLista") detalle = enStand() || turnosActivo ? detalle : detalleDeLista(detalle, (document.getElementById("prize") as HTMLInputElement | null)?.value ?? "", enEnsayo() ? null : t("sigSinPremio"));
  return { paso, boton, clave, detalle, doble, reloj: restan > 0 ? relojDe(restan) : "" };
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

/**
 * El indicador de arriba: cuatro tramos. El hecho va lleno y con ✓ delante del nombre, el actual lleno de otro color y
 * con el nombre en negrita, y lo que falta apagado. Sin números: la barra de abajo dice "Paso 2 de 4".
 */
function pintarPasos(paso: Paso): void {
  // Al final del ensayo no queda nada por hacer (no hay qué compartir): los cuatro tramos van hechos.
  const final = paso === 4 && enEnsayo();
  for (const li of document.querySelectorAll<HTMLElement>("#pasos li")) {
    const n = Number(li.dataset.paso);
    const estado = final || n < paso ? "hecho" : n === paso ? "actual" : "falta";
    li.classList.toggle("hecho", estado === "hecho");
    li.classList.toggle("actual", estado === "actual");
    if (estado === "actual") li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    const marca = li.querySelector(".p-n");
    if (marca) marca.textContent = estado === "hecho" ? "✓" : "";
    const e = li.querySelector(".p-e");
    if (e) e.textContent = estado === "hecho" ? t("pasoHecho") : estado === "actual" ? t("pasoActual") : "";
  }
}

/** La línea de la barra: "Paso 3 de 4: esperando el número, 0:25". */
const linea = (s: Toca): string => enStand() ? s.detalle.replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : lineaDelPaso(t("sigPaso").replace("{n}", String(s.paso)), s.detalle, s.reloj);

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
  if (enStand()) {
    $("sig-aviso").textContent = s.detalle;
    return;
  }
  $("sig-aviso").textContent = s.clave === "sigRonda" ? `${t("sigPaso").replace("{n}", String(s.paso))}. ${t("sigAvisoRonda")}` : `${t("sigPaso").replace("{n}", String(s.paso))}. ${s.detalle}.`;
}

function pintarBarra(s: Toca, mostrar: boolean): void {
  const bar = $("siguiente");
  const btn = $<HTMLButtonElement>("sig-btn");
  if (s.boton) {
    // Sin cuenta, el botón de verdad ya dice "Entrar para sellar" (wallet-ui.ts): la barra copia lo que dice.
    const texto = s.boton.textContent?.trim() ?? "";
    if (btn.textContent !== texto) btn.textContent = texto;
    btn.disabled = s.boton.disabled;
    btn.classList.toggle("lista", s.boton.classList.contains("lista"));
    const l = linea(s);
    const p = $("sig-paso");
    if (p.textContent !== l) p.textContent = l;
    // Con las dos cuentas, hasta dos renglones en el celular (styles.css): sin reparto, un solo renglón como siempre.
    p.classList.toggle("doble", s.doble);
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
  if (!listo || sinPagina()) return;
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
 * El alto de la cinta de versión nueva cuando va pegada arriba (pantallas
 * angostas, donde la cabecera se queda en su lugar), que la publica en
 * `--cinta-alto` (version-nueva.ts). Sin la cinta, o dentro de la cabecera fija
 * (que ya la cuenta en su alto), vale cero.
 */
function altoCinta(): number {
  return Number.parseFloat(document.documentElement.style.getPropertyValue("--cinta-alto")) || 0;
}

/**
 * Mide la barra y arma el observador: el botón "se ve" si entra entero en la
 * pantalla, sin la cabecera fija (en pantallas anchas) ni la cinta de versión
 * nueva pegada arriba (en las angostas), que le tapan el borde de arriba.
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
  const arriba = (cab && getComputedStyle(cab).position === "sticky" ? Math.ceil(cab.getBoundingClientRect().height) : 0) + altoCinta();
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
 * (sin contar la cabecera fija, la cinta de versión nueva pegada arriba ni la
 * propia barra), se lo lleva a la pantalla;
 * con el movimiento reducido, sin animación.
 *
 * Si el sorteo arrancó desde la espera en grande, la pantalla es ella: se le
 * ofrece el mensaje primero (`tinkazo:error`), y si lo muestra, con la acción
 * para reintentar, la página de atrás no se mueve (espera.ts).
 */
export function verError(mensaje: HTMLElement, accion?: AccionError, segunda?: AccionError): void {
  const enGrande = eventoError(mensaje.textContent?.trim() ?? "", accion, segunda);
  if (!document.dispatchEvent(enGrande)) return;
  const r = mensaje.getBoundingClientRect();
  const cab = document.querySelector("header");
  const arriba = (cab && getComputedStyle(cab).position === "sticky" ? cab.getBoundingClientRect().height : 0) + altoCinta();
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
  // El botón de la lista de equipos vive adentro del panel: hay que descubrirlo cuando el panel aparece y vigilarlo desde ahí.
  vigilarListaDeCupones();
  const descubreLista = new MutationObserver(() => {
    if (sinPagina()) return;
    const antes = listaObservada;
    vigilarListaDeCupones();
    if (listaObservada !== antes) render();
  });
  descubreLista.observe(document.body, { childList: true, subtree: true });
  // Ventanas, tarjeta y cortina se agregan al cuerpo; el estadio es fijo y cambia de estilo.
  general.observe(document.body, { childList: true, attributes: true, attributeFilter: ["data-vista", "data-tab", "data-sesion", "data-ensayo", "data-stand"] });
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
