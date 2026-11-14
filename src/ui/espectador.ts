import { esc } from "../dom";
import { getLang, setLang, t, T, type Lang } from "../i18n";
import { app, PACES, setPace, type Beacon, type Game, type Pace } from "../state";
import { beep, note } from "../sound";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf, roundTime } from "../protocol/quicknet";
import { verifyRoundAsync } from "../protocol/firma";
import { select } from "../protocol/select";
import { listHash } from "../protocol/canonical";
import { cintas } from "./espera";
import { acortar, enlaceParaElQr } from "../enlace-corto";
import { pintarQr } from "./qr";

/**
 * El modo espectador: el mismo sorteo, retransmitido sin servidor nuevo.
 *
 * Durante la espera de un sorteo real, la vista grande muestra un QR con un
 * enlace a esta misma página. El enlace lleva, cifrado si sale el corto
 * (`enlace-corto.ts`), la ronda de drand que va a decidir, el juego, el ritmo,
 * los ganadores que se sortean, el premio y los nombres de la lista sellada.
 * Quien lo escanea abre esta vista: la misma cuenta regresiva, y al nacer la
 * ronda trae él mismo el beacon de los relays públicos (el mismo camino que
 * `resolveBeacon` en `draw.ts`), lo verifica, calcula los ganadores con
 * `select` y lanza el mismo show, cuadro por cuadro: el resultado ya está
 * decidido por la ronda, y la animación solo lo narra (`docs/juegos.md`).
 *
 * Es una vista de solo-lectura: no hay botones de sellar ni de sortear, no
 * toca la cadena, no graba nada y no cuenta métricas. El ganador no existe
 * hasta que nace la ronda: la vista no lo puede revelar antes, porque no lo
 * tiene. Si el beacon falla, dice el motivo y ofrece reintentar.
 *
 * El show se lanza con `verDeNuevo` (`draw.ts`), el lanzador de "Ver la
 * animación igual": recibe lo que ya está decidido (`app.frozen` +
 * `app.drawn`) y solo juega, sin tocar el comprobante, el historial ni la
 * página de resultados. No abre en el modo stand (el faro no comparte
 * semilla, y la espera del stand no arma el enlace).
 */

/** Lo que viaja en el enlace del espectador, todo en el fragmento. */
export interface DatosEspectador {
  /** La ronda de quicknet que va a decidir. */
  r: number;
  /** El juego elegido al sellar. */
  g: Game;
  /** El ritmo del show. */
  p: Pace;
  /** Cuántos ganadores se sortean (los premios del sello). */
  w: number;
  /** El premio, si hay. */
  z?: string;
  /** La lista sellada: la misma que hash-ea el sello (protocolo §1). */
  n: string[];
}

const VERSION = 1;
/** Lo que el QR espera al enlace corto antes de salir con el largo (`pantalla.ts`). */
const ESPERA_CORTO_MS = 2_000;

/* ------------------------------------------------------------------ base64url */

const aB64url = (texto: string): string => {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  // De a pedazos: `String.fromCharCode` con la lista entera puede reventar la pila con listas grandes.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const deB64url = (s: string): string => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/* ------------------------------------------------------- el enlace */

/**
 * El enlace del espectador: esta misma página, con los datos en el fragmento.
 * El navegador no manda el fragmento a ningún servidor, y el enlace corto lo
 * cifra antes de guardarlo (`enlace-corto.ts`), así que los nombres viajan
 * protegidos igual que en el comprobante.
 */
export function enlaceEspectador(datos: DatosEspectador, origen = location.origin): string {
  return `${origen}/#espectador=${aB64url(JSON.stringify({ v: VERSION, ...datos }))}`;
}

/**
 * Los datos que trae el fragmento `#espectador=…`, o null si no es un enlace
 * de espectador o está roto: nunca abre una vista a medio armar.
 */
export function datosDelEnlace(hash: string = location.hash): DatosEspectador | null {
  const m = /^#espectador=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    const j = JSON.parse(deB64url(m[1])) as Partial<DatosEspectador> & { v?: unknown };
    if (j.v !== VERSION) return null;
    const { r, g, p, w, z, n } = j;
    if (!Number.isInteger(r) || (r as number) < 1) return null;
    if (typeof g !== "string" || typeof p !== "string" || !(p in PACES)) return null;
    if (!Array.isArray(n) || !n.length || !n.every((x) => typeof x === "string" && x.length >= 2)) return null;
    if (!Number.isInteger(w) || (w as number) < 1 || (w as number) > n.length) return null;
    if (z !== undefined && typeof z !== "string") return null;
    const datos: DatosEspectador = { r: r as number, g: g as Game, p: p as Pace, w: w as number, n: n as string[] };
    if (z) datos.z = z;
    return datos;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ el beacon */

/**
 * Obtiene la ronda, verifica su firma y arma el beacon: el mismo camino del
 * organizador (`resolveBeacon` en `draw.ts`), con los relays públicos. El
 * modo stand no pasa por acá: la espera del stand no comparte enlace.
 */
async function traerBeacon(round: number, onAttempt: (attempt: number, total: number) => void): Promise<Beacon> {
  const { signature } = await fetchRound(round, { onAttempt });
  if (!(await verifyRoundAsync(round, signature))) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

/* ----------------------------------------------------------- la vista */

/**
 * Abre la vista de espectador: la misma espera en grande que ve la sala
 * (misma cuenta, mismo premio, mismos nombres pasando), con el rótulo de
 * solo-lectura, y al nacer la ronda el show. Si ya nació (el QR del
 * resultado), arranca enseguida. Devuelve si la abrió.
 */
export function abrirEspectador(datos: DatosEspectador, lang: Lang = getLang()): boolean {
  if (document.querySelector(".espectador")) return false;
  setLang(lang);
  // El show tiene que salir con el mismo ritmo y el mismo juego que el del organizador.
  setPace(datos.p);
  app.game = datos.g;
  const round = datos.r;
  const capa = document.createElement("div");
  capa.className = "espera espectador";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", t("espVistaEspectador"));
  capa.tabIndex = -1;
  capa.innerHTML =
    `<div class="espera-top"><span class="sticker">${esc(t("espVistaEspectador"))}</span></div>` +
    `<p class="espera-lectura">${esc(t("espLectura"))}</p>` +
    (datos.z ? `<p class="espera-premio">${esc(t("cortinaSe"))} <b>${esc(datos.z)}</b></p>` : "") +
    `<div class="espera-reloj mono">0:00</div>` +
    `<p class="espera-t">${esc(t("espFaltan"))}</p>` +
    // Lo que pasa cuando nace el número: la cortina, o el error con su reintento.
    `<div class="espera-sigue" hidden></div>` +
    `<div class="espera-nombres">${cintas(datos.n)}</div>`;
  document.body.appendChild(capa);
  capa.focus({ preventScroll: true });

  const reloj = capa.querySelector<HTMLElement>(".espera-reloj");
  const debajo = capa.querySelector<HTMLElement>(".espera-t");
  const sigue = capa.querySelector<HTMLElement>(".espera-sigue");
  let timer = 0;
  let ultimoTic = -1;

  const cerrar = (): void => {
    window.clearInterval(timer);
    removeEventListener("keydown", tecla);
    capa.remove();
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  addEventListener("keydown", tecla);

  /**
   * Nació la ronda: trae el beacon él mismo, calcula los ganadores con la
   * matemática del protocolo y lanza el show. Nada de sellar, grabar ni
   * contar: el espectador solo mira.
   */
  const nacio = async (): Promise<void> => {
    if (reloj) reloj.hidden = true;
    if (debajo) debajo.hidden = true;
    if (sigue) {
      sigue.hidden = false;
      sigue.innerHTML =
        `<p class="cortina-t" role="status">${esc(t("cortinaNumero"))}</p>` +
        `<span class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></span>`;
    }
    try {
      const beacon = await traerBeacon(round, (attempt, total) => {
        if (attempt > 1 && sigue) sigue.textContent = T[getLang()].drandTry(attempt, total);
      });
      const hash = bytesToHex(listHash(datos.n));
      const winners = select(hexToBytes(beacon.randomness), hexToBytes(hash), datos.n.length, datos.w);
      app.frozen = { names: datos.n, listHash: hash, ts: roundTime(round), at: "-", prize: datos.z ?? "", round };
      app.drawn = { beacon, winners };
      // El show tapa la espera, igual que en la sala. `verDeNuevo` solo juega:
      // no revela resultados ni toca la cadena.
      const { verDeNuevo } = await import("./draw");
      verDeNuevo();
    } catch (e) {
      if (!sigue) return;
      sigue.innerHTML =
        `<p class="espera-motivo" role="alert">${esc(t(e instanceof Error && e.message === "bad-signature" ? "badSig" : "drandDown"))}</p>` +
        `<button class="primary espera-accion" type="button">${esc(t("drawRetry"))}</button>`;
      const b = sigue.querySelector<HTMLButtonElement>(".espera-accion");
      b?.addEventListener("click", () => void nacio());
      b?.focus({ preventScroll: true });
    }
  };

  const tick = (): void => {
    const s = Math.max(0, roundTime(round) - Math.floor(Date.now() / 1000));
    if (reloj) reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    // Los mismos tonos de la espera del organizador: la cuenta se oye igual.
    if (s <= 5 && s > 0 && s !== ultimoTic) {
      ultimoTic = s;
      beep(note(12 - s * 2), 0.18, "triangle", 0.05);
    }
    if (s === 0) {
      window.clearInterval(timer);
      void nacio();
    }
  };
  tick();
  timer = window.setInterval(tick, 250);
  return true;
}

/* --------------------------------------------------------------- el QR */

/**
 * El QR del espectador en la espera en grande (`espera.ts`), junto a la
 * cuenta: el enlace largo sale enseguida; si el corto llega a tiempo, ese es
 * el que se dibuja (los nombres viajan cifrados y el QR se lee desde el
 * fondo). Si el enlace no entra en un QR (una lista enorme sin corto), la
 * figura queda escondida: el enlace no deja de existir, pero un QR roto no.
 */
export async function armarQrDeEspectador(capa: HTMLElement, datos: DatosEspectador): Promise<void> {
  const figura = capa.querySelector<HTMLElement>(".espera-qr");
  const img = figura?.querySelector("img");
  if (!(figura && img instanceof HTMLImageElement)) return;
  const enlace = enlaceEspectador(datos);
  const { ahora, despues } = await enlaceParaElQr(enlace, acortar(enlace), ESPERA_CORTO_MS);
  if (!capa.isConnected) return;
  if (!(await pintarQr(img, ahora))) return;
  figura.hidden = false;
  // El corto que llegó tarde reemplaza al largo, como en el resultado.
  const corto = await despues.catch(() => null);
  if (corto && capa.isConnected && img.isConnected) void pintarQr(img, corto);
}

/**
 * El panel del QR del espectador, que abre el botón «QR para ver en vivo» de
 * la pantalla del resultado (`pantalla.ts`): el mismo enlace, para que quien
 * llegó tarde vea el mismo show. El QR no espera más de dos segundos al corto
 * (`pantalla.ts`) y nunca va a un servicio ajeno a dibujarse.
 */
export function abrirPanelQrEspectador(enlace: string): void {
  if (!enlace || document.querySelector(".espectador-qr")) return;
  const capa = document.createElement("div");
  capa.className = "espectador-qr";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", t("espQrT"));
  capa.innerHTML =
    `<div class="espectador-qr-caja">` +
    `<p class="espectador-qr-t">${esc(t("espQrT"))}</p>` +
    `<p class="espectador-qr-sub">${esc(t("espQrSub"))}</p>` +
    `<img alt="" />` +
    `<button class="ghost" type="button" data-cerrar>${esc(t("salaCerrar"))}</button>` +
    `</div>`;
  document.body.appendChild(capa);
  const cerrar = (): void => {
    removeEventListener("keydown", tecla);
    capa.remove();
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  addEventListener("keydown", tecla);
  capa.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", cerrar);
  capa.querySelector<HTMLButtonElement>("[data-cerrar]")?.focus({ preventScroll: true });
  const img = capa.querySelector("img");
  void (async () => {
    const { ahora, despues } = await enlaceParaElQr(enlace, acortar(enlace), ESPERA_CORTO_MS);
    if (!capa.isConnected || !(img instanceof HTMLImageElement)) return;
    // No entra (una lista enorme sin corto): el panel se va en vez de mostrar un QR roto.
    if (!(await pintarQr(img, ahora))) {
      cerrar();
      return;
    }
    const corto = await despues.catch(() => null);
    if (corto && capa.isConnected && img.isConnected) void pintarQr(img, corto);
  })();
}
