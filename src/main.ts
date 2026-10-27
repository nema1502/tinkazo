import "./styles.css";
import { $ } from "./dom";
import { chooseLang, initialLang, onLangChange, setLang, t } from "./i18n";
import { SAMPLE, app, currentPace, paceSeconds, paraCompartir, params, setPace, setParaCompartir, type Game, type Pace } from "./state";
import { soundLabel, toggleSound, unlockAudioOnGesture } from "./sound";
import { bindParticipants, loadSample, parseNames, renderNames, reponerBorrador } from "./ui/participants";
import { GAME_BUTTONS, cambiarJuego, copyRules, elegirJuego, freeze, refreshFreezeLabel, refrescarRecomendacion, secondsToRound, setGame } from "./ui/freeze";
import { initSiguiente } from "./ui/siguiente";
import { crearBotonesDelKit } from "./ui/botones-kit";
import { JUEGOS } from "./games/pixi/kit/catalogo";
import { initPlegables } from "./ui/plegable";
import { alApretarSellar, iniciarRed } from "./ui/red";
import { montarPremios } from "./ui/premios";
import { adelantarCorto, alTocarGanadores, contarCompartido, copySummary, draw, mostrarGrande, newDraw, recuperarLista, replayAnimation, reverify, shareProof } from "./ui/draw";
import { contarPractica } from "./contar";
import { skipGame } from "./games/overlay";
import { usePixi } from "./games/engine";
import { MARCA_INGRESAR, currentSession, entraConGoogle, entrar, estadoDeLaCuenta, initWalletUI, openPicker, pedirEntrar } from "./ui/wallet-ui";
import { initOnboarding } from "./ui/onboarding";
import { initEnsayo, salirDelEnsayo } from "./ui/ensayo";
import { initAvisoCuenta } from "./ui/aviso-cuenta";
import { abrirTutorial, initTutorial } from "./ui/tutorial";
import { enEnsayo } from "./ensayo-modo";
import { musicOn, toggleMusic } from "./music";
import { rotateWords } from "./ui/rotar";
import { initMenuMas } from "./ui/menu";
import { iniciarControlesDelEstadio } from "./ui/estadio-controles";
import { setVibracion, vibracionDisponible, vibracionOn, vibrar } from "./vibrar";

/** La marca que deja "Entrar y sortear" al final de la demo, sin cuenta: la herramienta abre con la ventana de ingreso. */
const INGRESAR = MARCA_INGRESAR;

// `?theme=light|dark` fuerza el tema (capturas).
const themeParam = params.get("theme");
if (themeParam === "light" || themeParam === "dark") document.documentElement.dataset.theme = themeParam;

// Textos que no viven en atributos data-i.
onLangChange(() => {
  $<HTMLTextAreaElement>("ta").placeholder = t("placeholder");
  $("src-label").textContent = t("src");
  const dl = $<HTMLAnchorElement>("drand-link");
  if (dl.href) dl.textContent = t("drandLink");
  if (app.frozen) $("frozen-ts").textContent = t("frozenAt") + " " + app.frozen.at;
  soundLabel();
});

// Controles
$("l-es").addEventListener("click", () => chooseLang("es"));
$("l-en").addEventListener("click", () => chooseLang("en"));
$("btn-sample").addEventListener("click", loadSample);
// Sin cuenta, el botón de sellar queda con aria-disabled (lo pone `applyGate`) y
// el clic abre la ventana para elegir una, que es lo que falta. Antes no hacía
// nada, y parecía un botón roto (evaluador visual, 21 de octubre de 2026).
$("btn-freeze").addEventListener("click", () => {
  if ($("btn-freeze").getAttribute("aria-disabled") === "true") {
    // La ventana dice para qué: sellar esta lista, que la espera acá. Al entrar, el foco vuelve a "Sellar la lista".
    const motivo = t("loginParaSellar").replace("{n}", String(parseNames().length));
    void openPicker({ motivo, volverA: $("btn-freeze") });
    return;
  }
  // Si la red no deja sellar, la acción del caso reemplaza a "Sellar la lista" y este clic es de ella.
  if (alApretarSellar()) return;
  void freeze();
});
// El ritmo del show. Se guarda, porque quien organiza suele querer siempre el
// mismo, y no cambia el resultado: el ganador ya estaba decidido.
const paceSel = $<HTMLSelectElement>("pace");
paceSel.value = currentPace();
/**
 * Las etiquetas llevan la duración: "Normal · 30 s".
 *
 * El selector dejó de ser un multiplicador y pasó a ser un objetivo de
 * segundos, y eso sólo sirve si se ve. El número sale de `PACES`, así que no
 * puede quedar desactualizado.
 */
function paceLabels(): void {
  for (const o of paceSel.options) {
    const p = o.value as Pace;
    const base = t(p === "rapido" ? "paceFast" : p === "normal" ? "paceNormal" : "paceEpic");
    o.textContent = `${base} · ${paceSeconds(p)} s`;
  }
}
onLangChange(paceLabels);
paceSel.addEventListener("change", () => {
  setPace(paceSel.value as Pace);
  // La línea del selector muestra la duración: se rehace con el ritmo nuevo.
  refrescarRecomendacion();
});

$("btn-hist-csv").addEventListener("click", () => {
  void import("./ui/history").then(async (h) => {
    const { currentSession } = await import("./ui/wallet-ui");
    const a = currentSession()?.address;
    if (a) h.downloadCsv(a);
  });
});
$("btn-hist-clear").addEventListener("click", () => {
  if (!confirm(t("histConfirm"))) return;
  void import("./ui/history").then(async (h) => {
    const { currentSession } = await import("./ui/wallet-ui");
    const a = currentSession()?.address;
    if (!a) return;
    h.forget(a);
    h.renderHistory(a);
  });
});

// Los juegos del kit tienen su botón desde el catálogo (los apagados, ocultos).
crearBotonesDelKit();
for (const [id, game] of GAME_BUTTONS) $(id).addEventListener("click", () => elegirJuego(game));
$("btn-cambiar").addEventListener("click", cambiarJuego);
initPlegables();
$("btn-draw").addEventListener("click", () => void draw());
// La lista a la vista de la sala, antes de sellar: el blindaje contra inflarla.
$("btn-sala").addEventListener("click", () => void import("./ui/sala").then((m) => m.mostrarLista()));
// Precargada con la página quieta: si se publica una versión nueva con la
// pestaña abierta, o se corta el wifi, el botón igual abre (QA, 16 de octubre).
setTimeout(() => void import("./ui/sala").catch(() => undefined), 4000);
$("btn-reverify").addEventListener("click", () => void reverify());
$("btn-replay").addEventListener("click", replayAnimation);
$("btn-again-sin").addEventListener("click", () => newDraw("sinGanadores"));
$("btn-again-nueva").addEventListener("click", () => newDraw("otraLista"));
$("btn-recuperar").addEventListener("click", recuperarLista);
$("btn-grande").addEventListener("click", mostrarGrande);
// Al apoyar el dedo o el mouse en compartir o en grande, el enlace corto ya sale: para el clic suele estar listo.
$("btn-grande").addEventListener("pointerdown", adelantarCorto);
$("btn-proof").addEventListener("pointerdown", adelantarCorto);
$("winner-cards").addEventListener("click", alTocarGanadores);
$<HTMLButtonElement>("btn-copy").addEventListener("click", (e) => void copySummary(e.currentTarget as HTMLButtonElement));
$<HTMLButtonElement>("btn-rules").addEventListener("click", (e) => void copyRules(e.currentTarget as HTMLButtonElement));
$("btn-proof").addEventListener("click", shareProof);
// El contador del embudo (src/contar.ts): avisarle al ganador también es compartir.
$("btn-whatsapp").addEventListener("click", () => contarCompartido("whatsapp"));
$("btn-email").addEventListener("click", () => contarCompartido("email"));
// El ensayo llegó al ganador (lo avisa su final, en draw.ts): es lo único que se cuenta de él.
document.addEventListener("tinkazo:ensayo-fin", () => contarPractica("practice"));
$("st-sound").addEventListener("click", toggleSound);
$("btn-sound").addEventListener("click", toggleSound);
/** El modo con música: andina con beat, que sigue la tensión del relator. */
const musicLabel = (): void => {
  $("btn-music").textContent = t(musicOn() ? "musicYes" : "musicNo");
};
$("btn-music").addEventListener("click", () => {
  toggleMusic();
  musicLabel();
});
musicLabel();
onLangChange(musicLabel);
/** El modo para compartir: más contraste y nombres más grandes en el show, por esta pestaña. */
const compartirLabel = (): void => {
  const on = paraCompartir();
  const b = $("btn-compartir");
  b.textContent = t(on ? "compartirOn" : "compartirOff");
  b.title = t("compartirTip");
  b.setAttribute("aria-pressed", String(on));
};
$("btn-compartir").addEventListener("click", () => {
  setParaCompartir(!paraCompartir());
  compartirLabel();
});
compartirLabel();
onLangChange(compartirLabel);
/** La vibración, solo donde el celular la ofrece: prendida por defecto, apagable. */
const vibrarLabel = (): void => {
  const b = $("btn-vibrar");
  b.textContent = t(vibracionOn() ? "vibOn" : "vibOff");
  b.setAttribute("aria-pressed", String(vibracionOn()));
};
if (vibracionDisponible()) {
  $("btn-vibrar").hidden = false;
  $("btn-vibrar").addEventListener("click", () => {
    setVibracion(!vibracionOn());
    vibrarLabel();
    vibrar("golpe");
  });
  vibrarLabel();
  onLangChange(vibrarLabel);
}
$("st-skip").addEventListener("click", skipGame);
// Los botones del estadio se esconden solos: en el proyector no son parte del juego.
iniciarControlesDelEstadio();
bindParticipants();
montarPremios();
// La lista que se estaba armando en esta pestaña, si se recargó o se volvió de entrar con Google.
reponerBorrador();
initVistas();
initWalletUI();
// El ensayo, si se recargó en él, después de la cuenta (la puerta) y antes de los pasos.
initEnsayo();
// El recordatorio de crear la cuenta, solo en el ensayo y una vez por sesión.
initAvisoCuenta();
// La red a la vista antes de sellar: "¿La red está bien?" y el aviso cuando algo anda mal.
iniciarRed({ sellar: (op) => freeze(op) });
ingresarSiLoPidio();
initMenuMas();
refreshFreezeLabel();
// Los pasos de arriba y la barra de "lo que sigue", con la herramienta ya armada.
initSiguiente({ segundos: secondsToRound });
// "¿Cómo se usa?" y la oferta de la primera vez, que miran en qué paso se está.
initTutorial();
initOnboarding(() => abrirTutorial("offer"));

/**
 * Las dos vistas de "/": la portada para quien llega, y la herramienta para
 * quien entra a sortear.
 *
 * Viven en la misma dirección a propósito: Google vuelve a "/" después del
 * login. "/" es siempre la portada, también con la cuenta abierta; la
 * herramienta se abre cuando se pide: "Sortear", "Mis sorteos", el botón
 * grande, o volver de elegir una cuenta (que deja una marca en la sesión del
 * navegador y sobrevive al redirect de Google). Tiene dos pestañas: el sorteo
 * nuevo y los sorteos de esa cuenta, que se traen de la cadena en cualquier
 * equipo. `#sortear`, `#mis-sorteos` y `#portada` eligen a mano.
 */
function initVistas(): void {
  type Tab = "nuevo" | "historial";
  const body = document.body;
  const deApp = ["demo", "pose", "instant"].some((k) => params.has(k));
  const marcar = (): void => {
    const hist = body.dataset.tab === "historial";
    $("tab-nuevo").setAttribute("aria-selected", String(!hist));
    $("tab-hist").setAttribute("aria-selected", String(hist));
    // En el menú, la página actual: Sortear o Mis sorteos, según la pestaña.
    const app = body.dataset.vista === "app";
    for (const [href, on] of [["/#sortear", app && !hist], ["/#mis-sorteos", app && hist]] as const) {
      const a = document.querySelector(`.topnav a[href="${href}"]`);
      if (on) a?.setAttribute("aria-current", "page");
      else a?.removeAttribute("aria-current");
    }
  };
  const setVista = (v: "portada" | "app", tab?: Tab): void => {
    const antes = body.dataset.vista;
    body.dataset.vista = v;
    if (tab) body.dataset.tab = tab;
    marcar();
    if (antes && antes !== v) scrollTo(0, 0);
  };
  const porHash = (): boolean => {
    const h = location.hash;
    if (h === "#sortear" || h === "#ta") setVista("app", "nuevo");
    else if (h === "#mis-sorteos") setVista("app", "historial");
    else if (h === "#portada") setVista("portada");
    else if (h === "#como-se-usa" || h === "#como-se-usa-fin") {
      // "Cómo se usa" del menú "Más", desde cualquier página (o del final de la
      // demo o del ensayo, `-fin`): la herramienta con el tutorial abierto. La
      // dirección vuelve a "#sortear": recargar no lo vuelve a abrir solo.
      history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
      setVista("app", "nuevo");
      void import("./ui/tutorial").then((m) => m.abrirTutorial(h === "#como-se-usa-fin" ? "end" : "menu"));
    } else return false;
    return true;
  };
  body.dataset.tab = "nuevo";
  body.dataset.sesion = "no";
  if (params.has("demo")) body.dataset.demo = "1";
  setVista(deApp ? "app" : "portada");
  porHash();
  addEventListener("hashchange", () => void porHash());
  $("tab-nuevo").addEventListener("click", () => {
    history.replaceState(null, "", "#sortear");
    setVista("app", "nuevo");
  });
  $("tab-hist").addEventListener("click", () => {
    history.replaceState(null, "", "#mis-sorteos");
    setVista("app", "historial");
  });
  $("hist-entrar").addEventListener("click", () => {
    void import("./ui/wallet-ui").then((w) => void w.openPicker());
  });
  // El botón grande: a la herramienta y, si no hay cuenta, directo a Google
  // (sin la ventana de cuatro caminos); sin Pollar o desde el navegador de una
  // app, la ventana. "Otras formas de entrar" abre la ventana de siempre.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a.cta[href="#sortear"]')) {
    a.addEventListener("click", (e) => {
      // Desde el ensayo, primero se sale de él: al volver, se sortea con la lista propia.
      if (enEnsayo()) {
        e.preventDefault();
        salirDelEnsayo({ conMiLista: true });
        return;
      }
      // Con la cuenta adentro, a la herramienta, como siempre.
      if (currentSession()) return;
      // Sin cuenta no se va a la herramienta hasta entrar: el enlace navegaba antes de que Google hiciera nada, y
      // quien tocaba "Entrar con Google" aterrizaba en el sorteo sin que Pollar se hubiera abierto (26 de octubre
      // de 2026). Al entrar, la página abre la herramienta sola (más abajo, `tinkazo:sesion`).
      e.preventDefault();
      void entrar().then(() => {
        if (currentSession()) history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
      });
    });
  }
  for (const b of document.querySelectorAll<HTMLElement>("[data-otras-formas]")) {
    b.addEventListener("click", () => {
      history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
      setVista("app", "nuevo");
      void openPicker();
    });
  }
  // El mismo botón al final de la demo navega (sale de `?demo=`), y caía en la
  // puerta sin la ventana de ingreso, justo cuando la persona se decidió
  // (buscador de detalles, D17). Se decide acá, en la página de la demo, que
  // ya terminó de retomar la sesión: sin cuenta, una marca en la pestaña, y la
  // página nueva abre la ventana (`ingresarSiLoPidio`). Decidirlo al cargar la
  // nueva no: retomar la cuenta de Google tarda hasta 8 s, y la ventana se
  // abría encima de una sesión que estaba volviendo.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a.cta[href="/#sortear"]')) {
    a.addEventListener("click", () => {
      if (currentSession()) return;
      try {
        sessionStorage.setItem(INGRESAR, "1");
      } catch {
        /* sin almacenamiento, la puerta tiene su botón */
      }
    });
  }
  // La G de Google en el botón grande, solo cuando va de verdad a Google (styles.css).
  body.dataset.google = entraConGoogle() ? "1" : "0";
  /**
   * El botón grande dice lo que va a pasar: con la cuenta abierta, "Ir a sortear"; sin ella, adónde va ("Entrar con
   * Google y sortear", o el de siempre sin Pollar); y mientras Google abre su ventana o la sesión guardada vuelve,
   * "Conectando…" o "Retomando tu cuenta…", sin la G y sin invitar a tocar otra vez. Lo mismo dice la cabecera.
   */
  const pintarCta = (): void => {
    const estado = estadoDeLaCuenta().estado;
    const ocupado = estado === "conectando" || estado === "retomando";
    const clave = estado === "conectando" ? "connecting" : estado === "retomando" ? "gateRetomando" : currentSession() ? "ctaGo" : entraConGoogle() ? "ctaGoogle" : "ctaHero";
    for (const el of document.querySelectorAll<HTMLElement>("[data-cta-entrar] .cta-t")) {
      const boton = el.closest<HTMLElement>("[data-cta-entrar]");
      // El botón no se achica mientras dice "Conectando…": lo que tiene al lado ("Probar con un ejemplo") no salta de
      // lugar y vuelve a saltar al terminar (en el celular "Entrar con Google y sortear" ocupa dos renglones y
      // "Conectando…" uno). Se mide antes de cambiar el texto, con el tamaño de siempre.
      if (boton && ocupado && !boton.style.minWidth) {
        const r = boton.getBoundingClientRect();
        boton.style.minWidth = `${Math.ceil(r.width)}px`;
        boton.style.minHeight = `${Math.ceil(r.height)}px`;
      }
      el.dataset.i = clave;
      el.textContent = t(clave);
      if (!boton) continue;
      if (ocupado) boton.setAttribute("aria-busy", "true");
      else {
        boton.removeAttribute("aria-busy");
        boton.style.minWidth = "";
        boton.style.minHeight = "";
      }
    }
  };
  document.addEventListener("tinkazo:cuenta", pintarCta);
  document.addEventListener("tinkazo:sesion", (e) => {
    const a = (e as CustomEvent<string | null>).detail;
    body.dataset.sesion = a ? "si" : "no";
    pintarCta();
    if (location.hash === "#portada") return;
    let pidio = false;
    try {
      pidio = sessionStorage.getItem("tinkazo.abrir") === "app";
      if (a && pidio) sessionStorage.removeItem("tinkazo.abrir");
    } catch {
      /* sin almacenamiento, la portada */
    }
    if (a && pidio) {
      setVista("app");
      avisarQueYaEntro();
    } else if (!a && !deApp && !/^#(sortear|mis-sorteos|ta)$/.test(location.hash)) setVista("portada");
  });
}

/**
 * Llegó desde el final de la demo o del ensayo sin cuenta: la entrada. Una sola vez. Con la ventana de la propia
 * página se abre sola; con Google no puede: sin un toque en esta página el navegador bloquea la ventana, así que la
 * puerta dice lo que hay que hacer y deja un solo botón con el foco (`pedirEntrar`).
 */
function ingresarSiLoPidio(): void {
  let pidio = false;
  try {
    pidio = sessionStorage.getItem(INGRESAR) === "1";
    sessionStorage.removeItem(INGRESAR);
  } catch {
    return;
  }
  if (pidio && location.hash === "#sortear" && !params.has("demo") && !enEnsayo() && !currentSession()) pedirEntrar();
}

/**
 * Recién entró (con la ventana o volviendo de Google) y tiene una lista lista:
 * "Ya entraste. Sellá tu lista de 20 personas.", arriba del botón, con el foco
 * en "Sellar la lista". Nunca sella solo: sellar es público y no se deshace.
 */
function avisarQueYaEntro(): void {
  const n = parseNames().length;
  const linea = document.getElementById("ya-entraste");
  if (!linea || n < 2 || app.frozen || enEnsayo()) return;
  linea.dataset.n = String(n);
  linea.textContent = t("yaEntraste").replace("{n}", String(n));
  linea.style.display = "";
  const sellar = $<HTMLButtonElement>("btn-freeze");
  // Con la ventana todavía abierta se espera a que cierre: si se abrió desde la
  // línea de la cuenta, el foco volvía a un botón que ya no está.
  const hasta = Date.now() + 60_000;
  const enfocar = (): void => {
    if (document.querySelector(".modal-back")) {
      if (Date.now() < hasta) setTimeout(enfocar, 200);
      return;
    }
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || a.offsetParent === null || a === sellar) sellar.focus({ preventScroll: true });
  };
  enfocar();
}

/* Modo demo y pose para capturas: `?demo=<juego>`, `?pose=1`, `?instant=1`. */
// Los diez del selector y los que salieron de él, que siguen abriendo con
// `?demo=` y `?pose=` mientras se decide si se borran: el Cierre de Libro, la
// carrera de cohetes y las balsas de totora (30 de septiembre de 2026), luz
// roja, luz verde (5 de octubre), la tómbola (20 de octubre), y el Aguayo y la
// Constelación, que El Trueque reemplaza (21 de octubre).
const GAMES: readonly Game[] = [...new Set<Game>(["race", "chovena", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien", "luz", "ledger", "rockets", "totora", "trueque", ...JUEGOS.map((j): Game => j.id)])];

async function autoDemo(mode: string): Promise<void> {
  loadSample();
  // `?nw=N` elige cuántos premios, para poder auditar el caso de varios
  // ganadores: hubo un sorteo de dos en el que el juego anunciaba uno solo.
  const nw = Number(params.get("nw"));
  const sel = document.getElementById("nw");
  if (nw >= 1 && nw <= 32 && sel instanceof HTMLSelectElement) sel.value = String(nw);
  await freeze();
  setGame((GAMES.find((g) => g === mode) ?? "race") as Game);
  // La ronda objetivo todavía no existe: esperar la cuenta regresiva.
  while (secondsToRound() > 0) await new Promise((r) => setTimeout(r, 250));
  await draw();
}

/**
 * Escena del estadio para capturas, sin red.
 *
 * `?pose=<juego>` levanta **ese** juego. Antes cualquier valor que no fuera
 * "stellar" caía en la carrera andina, así que las comprobaciones de tema claro,
 * tema oscuro y celular del auditor estaban mirando la carrera para los seis
 * juegos: nadie había visto nunca la ruleta ni el pasanaku en tema claro.
 *
 * `?ganador=<semilla>` cambia quién gana (src/pose.ts) y `?semilla=` la
 * historia que cuenta el juego; con el mismo valor de 64 hex en los dos, ganan
 * los mismos y se cuenta lo mismo que en un sorteo de verdad con ese número.
 */
async function poseScene(): Promise<void> {
  const fakeBeacon = { round: 32254977, randomness: "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829", signature: "a77a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac" };
  // `?semilla=<64 hex>` cambia la semilla de la escena fija: con una sola, el
  // director de emoción escribía siempre la misma historia y no había forma de
  // mirar los otros arcos. Sigue sin tocar la red ni sortear nada.
  const semilla = params.get("semilla") ?? "";
  if (/^[0-9a-f]{64}$/.test(semilla)) fakeBeacon.randomness = semilla;
  // `?n=<cantidad>` arma una lista de ese largo con los nombres de ejemplo
  // numerados, para medir cada juego con dos personas y con doscientas sin
  // tocar la red. Es solo para la escena fija: no sella ni sortea nada.
  const cantidad = Math.max(0, Math.min(2000, Math.floor(Number(params.get("n")) || 0)));
  const base = cantidad
    ? Array.from({ length: cantidad }, (_, i) => {
      const vuelta = Math.floor(i / SAMPLE.length);
      return `${SAMPLE[i % SAMPLE.length]}${vuelta ? ` ${vuelta + 1}` : ""}`;
    })
    : SAMPLE;
  // `?extremos=1`: los nombres difíciles (de 1 y de 40 caracteres, con acentos,
  // con emojis, sin espacios) en lugar de otros tantos de la lista, para ver
  // que se leen enteros sin cortarse. El ganador (el puesto 3) no se toca.
  const L = params.get("extremos") === "1"
    ? base.map((nm, i) => ({ 5: "Ñ", 7: "Alvaro", 8: "Maximiliano_Alexander_Constantino_Rosario", 11: "María Fernanda Guadalupe Quispe Mamani Zu", 14: "🌸 Ana 🌸", 16: "Álvaro" } as Record<number, string>)[i] ?? nm)
    : base;
  // `?nw=N` también acá: la escena fija con varios premios, sin red, para
  // auditar cómo anuncia cada juego a cada ganador.
  const premios = Math.max(1, Math.min(L.length, Math.floor(Number(params.get("nw")) || 1)));
  // Quiénes ganan: los de siempre, repartidos por la lista, o con
  // `?ganador=<semilla>` los que daría el protocolo con esa semilla, para que
  // el auditor de delatores vea al ganador en cualquier puesto. Solo la escena
  // fija lo lee; un sorteo de verdad no pasa por acá (src/pose.ts). Se carga
  // aparte: quien entra a sortear no lo descarga.
  const W3 = (await import("./pose")).poseWinners(L, premios, params.get("ganador"));
  app.frozen = { names: L, listHash: "32e2099c7a8dde7b6892523dc7d3e34ac06a972fd67f142186c58dced51a21ef", ts: 0, at: "-", prize: "", round: 32254977 };
  app.drawn = { beacon: fakeBeacon, winners: W3 };
  // Para los auditores: la lista y los ganadores de esta escena, tal cual.
  (window as unknown as { __pose?: { names: string[]; winners: number[] } }).__pose = { names: L, winners: W3 };
  const cual = params.get("pose") ?? "1";
  const nada = (): void => {};
  // La escena fija en el motor nuevo, salvo con `?motor=clasico` o sin WebGL.
  if (usePixi()) {
    const juego = (cual === "1" ? "race" : cual) as Game;
    const px = await import("./games/pixi");
    if (await px.playPixi(juego, L, W3, fakeBeacon, nada)) return;
  }
  if (cual === "wheel") {
    (await import("./games/wheel")).wheelSpin(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "ledger") {
    (await import("./games/ledger")).ledgerClose(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "pasanaku") {
    (await import("./games/pasanaku")).pasanaku(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "teleferico") {
    (await import("./games/cablecar")).cableCar(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "tombola") {
    (await import("./games/tombola")).tombola(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "stellar") {
    (await import("./games/constellation")).stellarConstellation(L, W3, fakeBeacon, nada);
    return;
  }
  // "rockets" es la carrera con la piel espacial; cualquier otro valor, la andina.
  (await import("./games/race")).stadiumRace(L, W3, fakeBeacon, nada, cual === "rockets" ? "stellar" : "andes");
}

renderNames();
unlockAudioOnGesture();
// Cada juego muestra en su botón lo que hace. Los nombres solos no le dicen
// nada a quien llega por primera vez.
void import("./ui/thumbs").then((m) => m.initThumbs(GAMES));
// Siempre se aplica el diccionario al cargar, también en español: si no, el
// texto que se ve sale del markup y los dos archivos se separan sin que se note.
setLang(initialLang());
// La palabra del sticker rota después de traducir: el texto sale del diccionario.
rotateWords();
// El contador va aparte y después: no frena la página y queda en su propio
// archivo, chico, en vez de darle su nombre al código común.
void import("./analytics").then((m) => m.countVisits());
const demoMode = params.get("demo");
if (demoMode) setTimeout(() => void autoDemo(demoMode), 300);
if (params.get("pose")) setTimeout(() => void poseScene(), 300);
