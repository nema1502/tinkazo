import { esc } from "../dom";
import { LEGIBLE } from "../games/pixi/letra";
import { t } from "../i18n";
import { modesVisible } from "../modos/bandera";
import { isTurnOrder, turnOrder } from "../modos/turnos";
import { nombreDePersona, seCuentaPorPersona } from "../participaciones";
import { etiquetaDe } from "../equipos/etiquetas";
import { app, avatar } from "../state";
import { acortar, enlaceParaElQr } from "../enlace-corto";
import { pintarQrDelComprobante } from "./qr";
import { claveDelSello, sinSelloAhora } from "./sin-sello-textos";
import { piezaParaLaSala } from "./logo-sorteo";

/**
 * Lo que el QR espera al enlace corto antes de salir con el largo. Si el corto
 * llega después, el QR cambia a él: es el que se lee desde el fondo.
 */
const ESPERA_CORTO_MS = 2_000;

/** Hasta cuántos ganadores salen cada uno con su cara; con más, una lista de renglones cortos (ver `mostrarResultado`). */
export const MAX_CON_CARA = 12;

/**
 * El resultado en grande, para el proyector: quién salió, qué se lleva, y el
 * QR del comprobante para que la sala lo compruebe desde el celular. Sin el
 * resto de la página alrededor, en pantalla completa si el navegador deja.
 *
 * Es el momento en que la sala saca el celular: el QR tiene que leerse desde
 * el fondo, así que es lo segundo más grande después del nombre. Con
 * `corto`, el QR lleva el enlace corto (enlace-corto.ts): de menos de cuarenta módulos por
 * lado y no de más de cien, se lee desde las sillas. El QR no lo espera más de
 * dos segundos (`ESPERA_CORTO_MS`): si no llegó, sale con el largo de siempre y
 * cambia al corto cuando llega; si el servicio no contesta, queda el largo.
 *
 * La abre el botón "Mostrar en grande" y, desde el 21 de octubre de 2026, el
 * final del show cuando el sorteo arrancó desde la espera en grande (`draw.ts`):
 * ahí el enlace llega después (el comprobante se arma aparte) y el QR aparece
 * cuando está. Las dos con el enlace corto, salvo en la demo: desde ese día
 * mostrar en grande arme el corto, y el final del show desde la
 * espera es mostrarlo en grande. `volverA` es lo que queda con el foco
 * al cerrar: "Siguiente premio", que es lo que sigue. Salir de la pantalla
 * completa también la cierra, como a la espera: Escape la suelta el navegador
 * sin avisarle a la página, y quedaba la vista en grande dentro de la ventana.
 */
export async function mostrarResultado(enlace: string | Promise<string>, op: { corto?: boolean; volverA?: HTMLElement } = {}): Promise<void> {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || document.querySelector(".pantalla")) return;
  const premio = frozen.prize;
  const n = drawn.winners.length;
  const varios = n > 1;
  // Con varios, el premio va una vez, arriba de las tarjetas, y cada tarjeta
  // lleva su número: repetido en cada una, partía los nombres y no entraban
  // todos (revisiones del 16 de octubre de 2026). Con más de cinco, en dos
  // columnas. Hasta el 22 de octubre de 2026 ese premio iba solo en la
  // calcomanía de arriba, en 11 px, y desde el fondo de la sala se leían los
  // nombres pero no qué se llevaban (evaluación de la subida 2, hallazgo 7):
  // ahora va en su propia línea, "Se llevan: …", con la letra de los nombres.
  const muchos = n > 5;
  // Con más de doce, las tarjetas con cara no entran ni en dos columnas (cien tarjetas son diez pantallas): una lista
  // de renglones cortos, número y nombre, en tantas columnas como entren, con la letra más grande que deje todos a la vista.
  // Un orden de turnos (`isTurnOrder`) va siempre en lista, con «Turno 1 ... Turno N» desde el primero, sin «Se llevan» ni
  // caras: lo que se lee desde el fondo es el orden.
  const turnos = isTurnOrder(frozen.names.length, n, premio);
  const lista = n > MAX_CON_CARA || turnos;
  // Un sorteo que se cuenta por persona muestra a la persona, sin el sufijo de la línea sellada, como el
  // resultado: la misma lectura que la cuenta (`seCuentaPorPersona`). Sin ella, cada línea tal cual se selló.
  const mostrar = (linea: string): string => (seCuentaPorPersona(frozen.names, modesVisible()) ? nombreDePersona(linea) : linea);
  // Los nombres en el orden del sorteo, tal cual salieron (`turnOrder`): la sala lee este arreglo, y cada renglón
  // pasa una sola vez por `mostrar`. Sin la lectura por persona (`seCuentaPorPersona`) cada línea queda tal cual se
  // selló, como en el resultado y la verificación.
  const orden = turnOrder(frozen.names, drawn.winners);
  // Un sorteo que se siguió sin sello no promete lo que no se puede comprobar: ni "comprobalo vos" ni "nadie eligió".
  const sinSello = sinSelloAhora(frozen);

  // "Siguiente premio (quedan 11)", si es lo que sigue: el mismo botón de la página, con su texto.
  const sig = op.volverA?.id === "btn-again-sin" && op.volverA.offsetParent !== null ? op.volverA : null;
  const siguiente = sig ? (sig.textContent ?? "").replace(/\s+/g, " ").trim() : "";

  const back = document.createElement("div");
  back.className = `sala pantalla${varios ? " varios" : ""}${muchos ? " muchos" : ""}${lista ? " lista" : ""}${turnos ? " turnos" : ""}`;
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", t("pantallaT"));
  back.innerHTML =
    `<div class="sala-top"><span class="sticker">${esc(t("pantallaT"))}</span>` +
    // Lo que sigue, a un toque desde la sala: con gente sin premio, "Siguiente premio" es el botón grande.
    (siguiente ? `<button class="primary pantalla-sig" type="button" data-siguiente>${esc(siguiente)}</button>` : "") +
    `<button class="ghost" type="button" data-cerrar>${esc(t("salaCerrar"))}</button></div>` +
    `<div class="pantalla-body">` +
    `<div class="pantalla-ganadores">` +
    (turnos
      ? `<p class="pantalla-llevan" data-i="turnsResultTitle">${esc(t("turnsResultTitle"))}</p>`
      : varios && premio
        ? `<p class="pantalla-llevan">${esc(t("pantallaLlevan"))} <b>${esc(premio)}</b></p>`
        : "") +
    (lista
      ? `<ol class="pantalla-lista">${orden
          .map((nombre, k) => {
            const num = turnos ? `<span data-i="turnsWord">${esc(t("turnsWord"))}</span> ${k + 1}` : `#${k + 1}`;
            return `<li class="pantalla-fila"><span class="pantalla-num" aria-hidden="true">${num}</span><span class="pantalla-nombre">${esc(mostrar(etiquetaDe(nombre)))}</span></li>`;
          })
          .join("")}</ol>`
      : drawn.winners
          .map((i, k) => {
            // Con equipos con cupón, la sala lee el nombre del equipo y no 56 letras de una cuenta.
            const nombre = mostrar(etiquetaDe(frozen.names[i] ?? ""));
            const pie = varios ? `#${k + 1}` : premio ? `${esc(t("winsPrize"))} ${esc(premio)}` : "";
            return (
              `<div class="pantalla-ganador"><img src="${avatar(nombre, 160)}" alt="" />` +
              `<div><p class="pantalla-nombre">${esc(nombre)}</p>${pie ? `<p class="pantalla-premio">${pie}</p>` : ""}</div></div>`
            );
          })
          .join("")) +
    `</div>` +
    `<aside class="pantalla-qr"><img alt="" /><p>${esc(t(claveDelSello("qrEnGrande", sinSello)))}</p><p class="mono">tinkazo.app</p></aside>` +
    `</div>` +
    `<p class="sala-pie${sinSello ? " sin-sello" : ""}">${esc(t(sinSello ? "redSinSelloEtiqueta" : turnos ? "turnsPie" : varios ? "imgPieVarios" : "pantallaPie"))}</p>`;
  document.body.appendChild(back);

  const ajustar = (): void => encajar(back, n);
  // El logo de la comunidad, en la barra de arriba después de la calcomanía. Va por DOM y no por `innerHTML`; al abrirse vuelve a medir.
  // No va en `.pantalla-ganadores`: ahí solo están los nombres.
  const logo = piezaParaLaSala(() => requestAnimationFrame(ajustar));
  if (logo) back.querySelector(".sala-top .sticker")?.after(logo);
  ajustar();
  // Al pasar a pantalla completa cambia el tamaño: se vuelve a medir.
  addEventListener("resize", ajustar);

  let cerrada = false;
  const cerrar = (): void => {
    if (cerrada) return;
    cerrada = true;
    back.remove();
    removeEventListener("keydown", tecla);
    removeEventListener("resize", ajustar);
    document.removeEventListener("fullscreenchange", pantalla);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    // A lo que sigue, a la vista si hacía falta; sin eso, al botón que la abrió.
    if (op.volverA && op.volverA.offsetParent !== null) op.volverA.focus();
    else document.getElementById("btn-grande")?.focus({ preventScroll: true });
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  let estuvo = !!document.fullscreenElement;
  const pantalla = (): void => {
    if (document.fullscreenElement) estuvo = true;
    else if (estuvo) cerrar();
  };
  addEventListener("keydown", tecla);
  document.addEventListener("fullscreenchange", pantalla);
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", cerrar);
  back.querySelector<HTMLButtonElement>("[data-siguiente]")?.addEventListener("click", () => {
    cerrar();
    sig?.click();
  });
  back.querySelector<HTMLButtonElement>("[data-cerrar]")?.focus();
  // Se pide con el clic todavía fresco: pasado ese momento, el navegador la niega.
  // Desde el show ya está puesta (la heredó de la espera) y no se pide.
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);

  // El comprobante se arma aparte después del sorteo: si todavía no está, el
  // cartel sale sin QR y no se queda esperando. Lo más grande que deje la
  // pantalla junto a los nombres: con cincuenta nombres el QR tiene más de
  // cien módulos por lado, y desde las sillas cada píxel cuenta.
  const img = back.querySelector<HTMLImageElement>(".pantalla-qr img");
  const celular = innerWidth <= 700;
  const lado = celular
    ? innerWidth * 0.7
    : muchos
      ? Math.min(innerHeight * 0.5, innerWidth * 0.28)
      : varios
        ? Math.min(innerHeight * 0.56, innerWidth * 0.32)
        : Math.min(innerHeight * 0.6, innerWidth * 0.36);
  const link = await Promise.resolve(enlace).catch(() => "");
  const { ahora, despues } = await enlaceParaElQr(link, link && op.corto && !cerrada ? acortar(link) : null, ESPERA_CORTO_MS);
  // Si se cerró mientras llegaba el comprobante o salía el corto, no hay nada que pintar.
  if (cerrada || !back.isConnected) return;
  const listo = ahora && img ? await pintarQrDelComprobante(img, ahora, lado) : false;
  if (!listo) back.querySelector(".pantalla-qr")?.remove();
  ajustar();
  if (!listo || !img) return;
  // El corto que llegó tarde reemplaza al largo.
  const corto = await despues;
  if (corto && !cerrada && back.isConnected && (await pintarQrDelComprobante(img, corto, lado))) ajustar();
}

/**
 * La letra de los nombres: la más grande con la que entran todos sin partir
 * una palabra a la mitad y sin salirse de la pantalla. Con tamaños fijos, a
 * 1280 × 720 no entraban cuatro ganadores con nombres largos y un apellido
 * se partía en "Gutiérre/z" (revisión del 16 de octubre de 2026). En el
 * celular la pantalla se puede desplazar: ahí solo cuenta que entre a lo ancho.
 */
function encajar(back: HTMLElement, n: number): void {
  const caja = back.querySelector<HTMLElement>(".pantalla-ganadores");
  const cuerpo = back.querySelector<HTMLElement>(".pantalla-body");
  if (!caja || !cuerpo) return;
  const celular = innerWidth <= 700;
  const nombres = [...back.querySelectorAll<HTMLElement>(".pantalla-nombre")];
  // En el celular, el orden de turnos se lee en una lista que se desplaza: cada nombre en su renglón. Un nombre
  // partido en dos no desborda a lo ancho, así que el ajuste lo daba por bueno y quedaba partido pudiendo entrar
  // en uno con una letra un poco más chica. Se cuenta en cuántos renglones sale cada nombre; sin medidas (el ensayo)
  // se da por bueno. En el resto la partición vale como siempre y nada cambia.
  const rango = document.createRange();
  const enUnRenglon = (e: HTMLElement): boolean => {
    rango.selectNodeContents(e);
    const renglones = rango.getClientRects().length;
    return renglones <= 1;
  };
  const listaDeTurnos = celular && back.classList.contains("turnos");
  const ponerLetra = (letra: number): void => caja.style.setProperty("--letra", `${letra}px`);
  const cabe = (letra: number, exigidos: readonly HTMLElement[]): boolean => {
    ponerLetra(letra);
    return (
      nombres.every((e) => e.scrollWidth <= e.clientWidth + 1) &&
      exigidos.every(enUnRenglon) &&
      cuerpo.scrollWidth <= cuerpo.clientWidth + 1 &&
      (celular || cuerpo.scrollHeight <= cuerpo.clientHeight + 1)
    );
  };
  const letra = letraDeLosNombres({
    tope: n === 1 ? 132 : n <= 5 ? 84 : back.classList.contains("lista") ? 40 : 52,
    // Los nombres no bajan de la letra secundaria de la sala (2,6 % del alto) mientras entren; en el celular, que se desplaza, vale el 14 de siempre.
    piso: celular ? 14 : Math.max(14, Math.round(innerHeight * LEGIBLE.fraccionSec)),
    pisoUnRenglon: listaDeTurnos ? PISO_UN_RENGLON : null,
    nombres,
    cabe,
    enUnRenglon: (l, e) => {
      ponerLetra(l);
      return enUnRenglon(e);
    },
  });
  caja.style.setProperty("--letra", `${letra}px`);
}

/**
 * La letra más chica con la que se busca, en el orden de turnos del celular, que cada nombre entre en un
 * renglón. Por debajo de esto la lista ya no se lee desde lejos: antes que achicar a todos por un nombre
 * largo, ese nombre se parte por sus espacios.
 */
export const PISO_UN_RENGLON = 22;

/**
 * La letra más grande entre `piso` y `tope` con la que `cabe` da verdadero, buscando a la mitad: `cabe`
 * tiene que ser monótona (si entra con una letra, entra con cualquiera más chica). Si no entra ni con el
 * piso, queda el piso.
 */
export function letraQueEntra(tope: number, piso: number, cabe: (letra: number) => boolean): number {
  if (cabe(tope)) return tope;
  let chico = piso;
  let grande = tope;
  while (grande - chico > 1) {
    const medio = Math.floor((chico + grande) / 2);
    if (cabe(medio)) chico = medio;
    else grande = medio;
  }
  return chico;
}

/**
 * La letra de los nombres de la pantalla grande, en dos pasadas cuando hay `pisoUnRenglon` (el orden de
 * turnos en el celular). Primero, con ese piso, exigiendo un renglón por nombre. Si con ese piso no entran
 * todos en un renglón, se exige el renglón solo a los que entran en uno con ese piso, con el piso de siempre:
 * la letra queda grande, los nombres que entraban siguen en un renglón y solo el largo se parte por sus
 * espacios. El conjunto se mide una vez, así que cada pasada es monótona (con una letra más chica nadie sale
 * de su renglón) y la búsqueda a la mitad sirve. Sin `pisoUnRenglon`, la búsqueda de siempre, sin exigirlo.
 * `cabe(letra, exigidos)` mide con esa letra, exigiendo un renglón a `exigidos`; `enUnRenglon(letra, nombre)`
 * dice si ese nombre sale en un renglón con esa letra.
 */
export function letraDeLosNombres<N>(op: {
  tope: number;
  piso: number;
  pisoUnRenglon: number | null;
  nombres: readonly N[];
  cabe: (letra: number, exigidos: readonly N[]) => boolean;
  enUnRenglon: (letra: number, nombre: N) => boolean;
}): number {
  const { tope, piso, pisoUnRenglon, nombres, cabe, enUnRenglon } = op;
  if (pisoUnRenglon !== null && pisoUnRenglon < tope) {
    const exigidos = nombres.filter((n) => enUnRenglon(pisoUnRenglon, n));
    if (exigidos.length === nombres.length && cabe(pisoUnRenglon, nombres)) {
      return letraQueEntra(tope, pisoUnRenglon, (letra) => cabe(letra, nombres));
    }
    if (exigidos.length) return letraQueEntra(tope, piso, (letra) => cabe(letra, exigidos));
  }
  return letraQueEntra(tope, piso, (letra) => cabe(letra, []));
}
