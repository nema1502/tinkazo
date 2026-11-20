import { esc } from "../dom";
import { onLangChange, t } from "../i18n";
import { canonicalList, listHash } from "../protocol/canonical";
import { pintarQr, precargarQr } from "../ui/qr";
import { descifrarNombre } from "./cifra";
import { revisarNombre } from "./filtro";
import {
  type Dependencias,
  type EstadoDeConexion,
  type Sala,
  cerrarListaEnSala,
  cerrarSala,
  compartirRonda,
  crearSala,
  escucharSala,
  quitarNombreEnSala,
} from "./cliente";
import { enlaceDeParticipante, ganadoresDe } from "./participante";
import type { RondaDeSala } from "../../workers/sala/src/logica";

/**
 * El panel del organizador de los juegos interactivos: la misma sala del stand
 * (`workers/sala`, nombres cifrados con la clave del QR) usada para el flujo
 * completo. Quien organiza abre la sala, muestra el QR del participante (el
 * enlace de esta misma página, con el id y la clave en el fragmento), ve la
 * lista en vivo, cierra la lista desde acá y, al sellar, comparte la ronda que
 * decide (el número y la huella de la lista) para que cada celular calcule y
 * vea su resultado personal (`sala/participante.ts`).
 *
 * Es una ronda de ejemplo, como el modo stand: el número no es público y no
 * queda comprobante — el panel lo dice cuando anuncia. La lista que se sella
 * es exactamente la de la sala (los nombres en el orden en que entraron): por
 * eso no se puede quitar nadie después de sellar, y los celulares que la
 * reconstruyen llegan a la misma huella o no afirman nada.
 *
 * La lista que ve el organizador corre por el mismo filtro de nombres del
 * stand (`sala/filtro.ts`): lo descartado se quita de la sala solo, y lo que
 * coincide con una palabra fea espera en «Para revisar». Todo entra por
 * `DepsDePanel`, para probarlo con una sala de mentira.
 */

export interface DepsDePanel {
  /** El idioma de ahora: las claves del diccionario, ya resueltas. */
  tx: (clave: string) => string;
  /** El QR para el enlace del participante. */
  qr: (img: HTMLImageElement, enlace: string, lado: number) => Promise<boolean>;
  /** El enlace que va en el QR (por defecto, esta página con el fragmento `#participante=…`). */
  enlaceDeParticipante?: (d: { id: string; clave: string }) => string;
  /** El servicio de la sala (por defecto, el de siempre: `sala/cliente.ts`). */
  servicio?: string;
  /** Las dependencias de la sala: en las pruebas, la sala de mentira. */
  dep?: Dependencias;
}

export interface PanelInteractivo {
  raiz: HTMLElement;
  abierta: () => boolean;
  abrir: (desde?: HTMLElement | null) => void;
  cerrar: () => void;
  /** Vuelve a pintar con lo último (un nombre, la ronda compartida, otro idioma). */
  pintar: () => void;
}

interface Entrada {
  nombre: string;
  estado: "ok" | "revisar";
  /** Igual a un nombre que ya estaba: espera en «Para revisar». */
  repetido?: boolean;
}

export function crearPanelInteractivo(deps: DepsDePanel): PanelInteractivo {
  const tx = deps.tx;
  const armarEnlace = deps.enlaceDeParticipante ?? ((d: { id: string; clave: string }) => enlaceDeParticipante(d));

  const raiz = document.createElement("div");
  raiz.className = "ji-capa";
  raiz.setAttribute("role", "dialog");
  raiz.setAttribute("aria-modal", "true");
  raiz.setAttribute("aria-label", tx("jiT"));
  raiz.hidden = true;
  raiz.innerHTML =
    `<div class="ji-caja">` +
    `<div class="ji-arriba"><h2 class="ji-t">${esc(tx("jiT"))}</h2>` +
    `<button class="ghost mini ji-panel-cerrar" type="button" aria-label="${esc(tx("salaCerrar"))}">✕</button></div>` +
    `<p class="note ji-b">${esc(tx("jiB"))}</p>` +
    `<div class="ji-inicio"><button class="primary ji-abrir" type="button">${esc(tx("jiAbrir"))}</button>` +
    `<p class="ji-error" hidden></p></div>` +
    `<div class="ji-viva" hidden>` +
    `<div class="ji-qr-fila"><div class="ji-qr"><img alt="" /><p class="ji-qr-sub">${esc(tx("jiQrSub"))}</p></div>` +
    `<div class="ji-lado"><p class="ji-estado" data-estado="conectando"></p>` +
    `<p class="ji-cuenta"></p>` +
    `<ol class="ji-nombres"></ol>` +
    `<div class="ji-revisar" hidden><h4>${esc(tx("standSalaRevisarT"))}</h4>` +
    `<p class="note">${esc(tx("standSalaRevisarB"))}</p><ol class="ji-revisar-lista"></ol></div>` +
    `<p class="ji-error" hidden></p>` +
    `<div class="ji-acciones"><button class="ghost ji-cerrar-lista" type="button">${esc(tx("jiCerrarLista"))}</button>` +
    `<button class="primary ji-sellar" type="button">${esc(tx("jiSellar"))}</button></div>` +
    `<p class="ji-cerrada" hidden>${esc(tx("jiListaCerrada"))}</p>` +
    `<div class="ji-resultado" hidden><p class="ji-res-t"></p><ul class="ji-res-nombres"></ul>` +
    `<p class="note ji-ejemplo">${esc(tx("jiRondaEjemplo"))}</p></div>` +
    `</div></div>` +
    `<div class="ji-pie"><button class="ghost ji-cerrar-sala" type="button">${esc(tx("standSalaCerrar"))}</button></div>` +
    `</div>`;

  const q = <T extends HTMLElement>(sel: string): T => raiz.querySelector<T>(sel) as T;

  let sala: Sala | null = null;
  let escucha: { parar: () => void } | null = null;
  const entradas = new Map<number, Entrada>();
  /** Los que quien atiende dejó pasar con «Mostrar». */
  const dejados = new Set<number>();
  const ilegibles = new Set<number>();
  let estadoRed: EstadoDeConexion = "conectando";
  let abierta = false;
  let volverA: HTMLElement | null = null;
  let cerrada = false;
  let compartida: RondaDeSala | null = null;
  let resultado: string[] | null = null;
  let sellando = false;
  let mensajeError = "";
  let siguienteRonda = 1;
  let qrDe = "";
  /** La sala contestó 404 al cierre o a la ronda: ese paso no existe acá, así que no se sigue probando. */
  let sinJuego = false;

  const claveDe = (nombre: string): string => nombre.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

  /** Los nombres que van a la lista sellada: los ok, en el orden en que entraron. */
  function nombresEnLista(): string[] {
    return [...entradas.entries()].filter(([, e]) => e.estado === "ok").sort((a, b) => a[0] - b[0]).map(([, e]) => e.nombre);
  }

  async function llego(n: number, dato: string): Promise<void> {
    const s = sala;
    if (!s || entradas.has(n) || compartida) return;
    const claro = await descifrarNombre(s.clave, dato);
    if (sala !== s) return;
    if (claro === null) {
      // De otra clave, o roto: no se muestra, y tampoco queda ocupando un lugar de los 400 de la sala.
      ilegibles.add(n);
      void quitarNombreEnSala(s, n, deps.dep);
      pintar();
      return;
    }
    const v = revisarNombre(claro);
    if (v.estado === "descartar") {
      void quitarNombreEnSala(s, n, deps.dep);
      return;
    }
    const repetido = !dejados.has(n) && [...entradas.values()].some((x) => claveDe(x.nombre) === claveDe(v.nombre));
    entradas.set(n, { nombre: v.nombre, estado: (v.estado === "revisar" || repetido) && !dejados.has(n) ? "revisar" : "ok", repetido });
    pintar();
  }

  function alQuitado(n: number): void {
    entradas.delete(n);
    dejados.delete(n);
    ilegibles.delete(n);
    pintar();
  }

  async function quitar(n: number): Promise<void> {
    const s = sala;
    const e = entradas.get(n);
    if (!s || !e) return;
    alQuitado(n);
    const bien = await quitarNombreEnSala(s, n, deps.dep);
    if (!bien) {
      // No se pudo sacar del objeto: vuelve a la lista y se avisa, para no perder el nombre en silencio.
      entradas.set(n, e);
      mensajeError = tx("standSalaErrQuitar");
      pintar();
    }
  }

  function mostrar(n: number): void {
    const e = entradas.get(n);
    if (!e || e.estado === "ok") return;
    e.estado = "ok";
    dejados.add(n);
    pintar();
  }

  function empezarAEscuchar(s: Sala): void {
    escucha?.parar();
    estadoRed = "conectando";
    escucha = escucharSala(
      s,
      {
        alNombre: (n, d) => void llego(n, d),
        alQuitado: alQuitado,
        alEstado: (e) => {
          estadoRed = e;
          pintar();
        },
        alCerrada: () => {
          // Venció (10 h) o la cerró otra pestaña: no hay más que escuchar.
          mensajeError = tx("standSalaVencida");
          olvidar();
          pintar();
        },
        alRonda: (r) => {
          // La compartió otra pestaña: el resultado es el mismo, la lista no cambió.
          compartida = r;
          resultado = ganadoresDe(nombresEnLista(), r);
          pintar();
        },
        alCierreLista: () => {
          cerrada = true;
          pintar();
        },
      },
      deps.dep,
    );
  }

  function olvidar(): void {
    escucha?.parar();
    escucha = null;
    sala = null;
    entradas.clear();
    dejados.clear();
    ilegibles.clear();
    cerrada = false;
    compartida = null;
    resultado = null;
    sellando = false;
    siguienteRonda = 1;
    qrDe = "";
    sinJuego = false;
  }

  /** El servicio no tiene este paso (o la sala ya no está): se dice una vez y los botones del juego quedan quietos. */
  function noDisponible(): void {
    sinJuego = true;
    mensajeError = tx("jiErrNoDisponible");
    pintar();
  }

  async function abrirSala(): Promise<void> {
    const boton = q<HTMLButtonElement>(".ji-abrir");
    boton.disabled = true;
    mensajeError = tx("standSalaCreando");
    pintar();
    void precargarQr();
    try {
      sala = await crearSala(deps.dep, deps.servicio);
      mensajeError = "";
      empezarAEscuchar(sala);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "otro";
      mensajeError = tx(motivo === "red" ? "standSalaErrRed" : motivo === "cupo-ip" ? "standSalaErrCupoIp" : motivo === "cupo-dia" ? "standSalaErrCupoDia" : "standSalaErrOtro");
    }
    boton.disabled = false;
    pintar();
  }

  async function cerrarLaLista(): Promise<void> {
    const s = sala;
    if (!s || cerrada || sinJuego) return;
    const boton = q<HTMLButtonElement>(".ji-cerrar-lista");
    boton.disabled = true;
    const bien = await cerrarListaEnSala(s, deps.dep);
    boton.disabled = false;
    if (bien === "no-existe") return noDisponible();
    if (!bien) {
      mensajeError = tx("standSalaErrCerrar");
      pintar();
      return;
    }
    cerrada = true;
    pintar();
  }

  /** La semilla de la ronda de ejemplo: 32 bytes del navegador, sin red y sin `Math.random`. */
  function semillaNueva(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sellar(): Promise<void> {
    const s = sala;
    if (!s || !cerrada || compartida || sellando || sinJuego) return;
    const lista = canonicalList(nombresEnLista().join("\n"));
    if (lista.length < 2) {
      mensajeError = tx("jiPocos");
      pintar();
      return;
    }
    sellando = true;
    mensajeError = "";
    pintar();
    // Lo que sigue en «Para revisar» no va a la lista sellada, pero los celulares lo ven en la sala y lo sumarían a la suya:
    // se quita de la sala antes de compartir la ronda, para que todos lleguen a la misma lista.
    for (const [n] of [...entradas.entries()].filter(([, e]) => e.estado === "revisar")) {
      const quitado = await quitarNombreEnSala(s, n, deps.dep);
      if (sala !== s) return;
      if (!quitado) {
        sellando = false;
        mensajeError = tx("standSalaErrQuitar");
        pintar();
        return;
      }
      alQuitado(n);
    }
    const ronda: RondaDeSala = {
      r: siguienteRonda++,
      randomness: semillaNueva(),
      listHash: Array.from(listHash(lista), (b) => b.toString(16).padStart(2, "0")).join(""),
      k: 1,
    };
    const bien = await compartirRonda(s, ronda, deps.dep);
    sellando = false;
    if (bien === "no-existe") {
      // La ronda no llegó a nadie: no existe, y reintentar daría el mismo 404.
      siguienteRonda--;
      return noDisponible();
    }
    if (!bien) {
      // Reintenta con el mismo botón: la ronda que no se compartió no existe para nadie.
      siguienteRonda--;
      mensajeError = tx("jiErrRonda");
      pintar();
      return;
    }
    compartida = ronda;
    resultado = ganadoresDe(lista, ronda);
    pintar();
  }

  async function cerrarLaSala(): Promise<void> {
    const s = sala;
    if (!s) return;
    const boton = q<HTMLButtonElement>(".ji-cerrar-sala");
    boton.disabled = true;
    const bien = await cerrarSala(s, deps.dep);
    boton.disabled = false;
    if (!bien) {
      mensajeError = tx("standSalaErrCerrar");
      pintar();
      return;
    }
    olvidar();
    pintar();
  }

  /** Una fila de nombres con su botón (y el de «Mostrar» para lo que espera revisión). */
  function fila(ol: HTMLElement, items: [number, Entrada][], conMostrar: boolean): void {
    const nuevo = document.createDocumentFragment();
    for (const [n, e] of items) {
      const li = document.createElement("li");
      const nombre = document.createElement("span");
      nombre.className = "ji-nombre";
      nombre.textContent = e.nombre;
      li.append(nombre);
      if (e.repetido) {
        const r = document.createElement("em");
        r.className = "ji-rep";
        r.textContent = tx("standSalaRepetido");
        li.append(r);
      }
      if (conMostrar) {
        const m = document.createElement("button");
        m.type = "button";
        m.className = "mini ji-mostrar";
        m.textContent = tx("standSalaMostrar");
        m.setAttribute("aria-label", `${tx("standSalaMostrar")}: ${e.nombre}`);
        m.addEventListener("click", () => mostrar(n));
        li.append(m);
      }
      // Sellada la lista no se quita nadie: los celulares ya calcularon con ella.
      if (!compartida) {
        const bq = document.createElement("button");
        bq.type = "button";
        bq.className = "mini ji-quitar";
        bq.textContent = tx("standSalaQuitar");
        bq.setAttribute("aria-label", `${tx("standSalaQuitar")}: ${e.nombre}`);
        bq.addEventListener("click", () => void quitar(n));
        li.append(bq);
      }
      nuevo.append(li);
    }
    ol.replaceChildren(nuevo);
  }

  function pintar(): void {
    const haySala = sala !== null;
    q<HTMLElement>(".ji-inicio").hidden = haySala;
    q<HTMLElement>(".ji-viva").hidden = !haySala;
    q<HTMLElement>(".ji-cerrar-sala").hidden = !haySala;
    for (const el of raiz.querySelectorAll<HTMLElement>(".ji-error")) {
      const aviso = mensajeError || (haySala && ilegibles.size > 20 ? tx("standSalaIlegibles") : "");
      el.textContent = aviso;
      el.hidden = !aviso;
    }
    if (!sala) return;
    const enlace = armarEnlace({ id: sala.id, clave: sala.clave });
    const img = q<HTMLImageElement>(".ji-qr img");
    img.setAttribute("aria-label", tx("standSalaQrAlt"));
    if (qrDe !== enlace) {
      qrDe = enlace;
      void deps.qr(img, enlace, 300);
    }
    q<HTMLElement>(".ji-estado").textContent = tx(estadoRed === "en-vivo" ? "standSalaEnVivo" : estadoRed === "sondeo" ? "standSalaSondeo" : "standSalaConectando");
    const ok = [...entradas.entries()].filter(([, e]) => e.estado === "ok");
    q<HTMLElement>(".ji-cuenta").textContent = ok.length === 1 ? tx("standSalaCuenta1") : ok.length ? tx("standSalaCuentaN").replace("{n}", String(ok.length)) : tx("standSalaVacia");
    fila(q<HTMLOListElement>(".ji-nombres"), ok, false);
    const revisar = [...entradas.entries()].filter(([, e]) => e.estado === "revisar");
    const cajaRevisar = q<HTMLElement>(".ji-revisar");
    cajaRevisar.hidden = revisar.length === 0;
    fila(q<HTMLOListElement>(".ji-revisar-lista"), revisar, true);
    q<HTMLButtonElement>(".ji-cerrar-lista").disabled = cerrada || !!compartida || sinJuego;
    const sellar = q<HTMLButtonElement>(".ji-sellar");
    sellar.disabled = !cerrada || !!compartida || sellando || sinJuego;
    sellar.textContent = tx(sellando ? "jiAnunciando" : "jiSellar");
    q<HTMLElement>(".ji-cerrada").hidden = !cerrada || !!compartida;
    const cajaRes = q<HTMLElement>(".ji-resultado");
    cajaRes.hidden = compartida === null;
    if (compartida) {
      const lista = canonicalList(nombresEnLista().join("\n"));
      q<HTMLElement>(".ji-res-t").textContent = tx("jiResultadoT").replace("{n}", String(lista.length));
      const ul = q<HTMLUListElement>(".ji-res-nombres");
      ul.replaceChildren(...(resultado ?? []).map((nombre) => {
        const li = document.createElement("li");
        li.textContent = nombre;
        return li;
      }));
    }
  }

  const tecla = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && abierta) cerrar();
  };

  function abrir(desde: HTMLElement | null = null): void {
    if (abierta) return;
    if (!raiz.isConnected) document.body.append(raiz);
    abierta = true;
    volverA = desde;
    raiz.hidden = false;
    addEventListener("keydown", tecla);
    pintar();
    (abierta && sala === null ? q<HTMLButtonElement>(".ji-abrir") : q<HTMLButtonElement>(".ji-panel-cerrar")).focus({ preventScroll: true });
  }

  function cerrar(): void {
    if (!abierta) return;
    abierta = false;
    raiz.hidden = true;
    removeEventListener("keydown", tecla);
    // La sala sigue: el organizador puede reabrir el panel con la lista que había.
    volverA?.focus({ preventScroll: true });
  }

  q<HTMLButtonElement>(".ji-abrir").addEventListener("click", () => void abrirSala());
  q<HTMLButtonElement>(".ji-cerrar-lista").addEventListener("click", () => void cerrarLaLista());
  q<HTMLButtonElement>(".ji-sellar").addEventListener("click", () => void sellar());
  q<HTMLButtonElement>(".ji-cerrar-sala").addEventListener("click", () => void cerrarLaSala());
  q<HTMLButtonElement>(".ji-panel-cerrar").addEventListener("click", () => cerrar());
  pintar();

  return { raiz, abierta: () => abierta, abrir, cerrar, pintar };
}

/**
 * El botón de la portada (`#btn-interactivos`): abre el panel la primera vez
 * que se lo pide y lo reutiliza después. Con otro idioma, el panel se repinta
 * con los textos de ese idioma.
 */
export function initOrganizadorInteractivo(deps: Partial<DepsDePanel> = {}): void {
  const boton = document.getElementById("btn-interactivos");
  if (!boton) return;
  let panel: PanelInteractivo | null = null;
  boton.addEventListener("click", () => {
    if (!panel) {
      panel = crearPanelInteractivo({ tx: t, qr: pintarQr, ...deps });
      onLangChange(() => panel?.pintar());
    }
    panel.abrir(boton);
  });
}
