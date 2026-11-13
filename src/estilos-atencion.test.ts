// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  animarEntradaIngreso,
  animarSalidaIngreso,
  destrabarCtas,
  iniciarDestelloPie,
  iniciarHoverVivo,
  iniciarTemblorHero,
} from "./estilos-atencion";

/**
 * Las animaciones de atención (`estilos-atencion.ts`): decoración que avisa por
 * dónde empezar y qué se puede tocar. Ninguna decide nada del sorteo y ninguna
 * corre con movimiento reducido: ni se arman sus temporizadores. El CSS de
 * todas vive en `styles.css` (bloque "Animaciones de atención"), y las pruebas
 * controlan los tiempos con temporizadores falsos.
 */

const h = vi.hoisted(() => ({ reduce: false, hover: true }));

/** El hero de la portada: el botón grande de entrar y "Probar con un ejemplo". */
function armarHero(): void {
  document.body.innerHTML =
    `<div class="hero-ctas">` +
    `<a class="primary cta" href="#sortear" data-cta-entrar><span class="cta-t">Entrar con Google y sortear</span></a>` +
    `<button type="button" data-entrar-ensayo>Probar con un ejemplo</button>` +
    `</div>`;
}

/** El pie de una página cualquiera: el badge con el que cruza el destello. */
function armarPie(): void {
  document.body.innerHTML = `<footer><div class="bar"><span data-i="footR">Hecho con ♥ en Bolivia</span></div></footer>`;
}

/** Las tarjetas del selector de juegos de la portada, con su captura adentro. */
function armarPortadaJuegos(): void {
  document.body.innerHTML = ["race", "sapo"]
    .map((g) => `<a href="/?demo=${g}" class="tarjeta"><img class="pj-img" src="/juegos/portada/${g}.webp" alt="" /></a>`)
    .join("");
}

/** La ventana de ingreso, como la arma `wallet-ui.ts` (`showModal`). */
function armarModal(): { back: HTMLElement; card: HTMLElement } {
  const back = document.createElement("div");
  back.className = "modal-back";
  const card = document.createElement("div");
  card.className = "modal-card login";
  back.appendChild(card);
  document.body.appendChild(back);
  return { back, card };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = "";
  h.reduce = false;
  h.hover = true;
  // jsdom no tiene matchMedia: el módulo consulta movimiento reducido y hover.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? h.reduce : q.includes("(hover: hover)") ? h.hover : false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("el temblor de los botones del hero", () => {
  it("tras ~8 s de inactividad tiemblan los dos, y la sacudida se corta sola y rearma", () => {
    armarHero();
    const [cta, ensayo] = ([...document.querySelectorAll("[data-cta-entrar], [data-entrar-ensayo]")] as [HTMLElement, HTMLElement]);
    const limpiar = iniciarTemblorHero();
    vi.advanceTimersByTime(7990);
    expect(cta.classList.contains("temblor")).toBe(false);
    vi.advanceTimersByTime(10);
    // Los dos a la vez: avisar por dónde empezar.
    expect(cta.classList.contains("temblor")).toBe(true);
    expect(ensayo.classList.contains("temblor")).toBe(true);
    // La sacudida dura ~0,5 s: se corta sola y rearma la espera.
    vi.advanceTimersByTime(600);
    expect(cta.classList.contains("temblor")).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(cta.classList.contains("temblor")).toBe(true);
    limpiar();
  });

  it("cualquier interacción corta el temblor en el acto y rearma el temporizador", () => {
    armarHero();
    const cta = document.querySelector("[data-cta-entrar]") as HTMLElement;
    iniciarTemblorHero();
    vi.advanceTimersByTime(8000);
    expect(cta.classList.contains("temblor")).toBe(true);
    document.dispatchEvent(new Event("pointermove"));
    expect(cta.classList.contains("temblor")).toBe(false);
    // La sacudida no vuelve a su tiempo: empezó a contar de nuevo.
    vi.advanceTimersByTime(7990);
    expect(cta.classList.contains("temblor")).toBe(false);
    vi.advanceTimersByTime(10);
    expect(cta.classList.contains("temblor")).toBe(true);
  });

  it("con movimiento reducido no tiembla nunca, ni arma temporizadores", () => {
    h.reduce = true;
    armarHero();
    iniciarTemblorHero();
    vi.advanceTimersByTime(60000);
    for (const b of document.querySelectorAll<HTMLElement>(".hero-ctas *")) expect(b.classList.contains("temblor")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("el destello del pie", () => {
  it("cada ~4 s el brillo cruza el badge y se apaga solo", () => {
    armarPie();
    const pie = document.querySelector('[data-i="footR"]') as HTMLElement;
    const limpiar = iniciarDestelloPie();
    vi.advanceTimersByTime(3990);
    expect(pie.classList.contains("destello")).toBe(false);
    vi.advanceTimersByTime(10);
    expect(pie.classList.contains("destello")).toBe(true);
    // El cruce dura ~0,8 s: se apaga solo, no queda glow permanente.
    vi.advanceTimersByTime(800);
    expect(pie.classList.contains("destello")).toBe(false);
    // Y vuelve a los ~4 s de nuevo (la segunda pasada arranca a los 8 s).
    vi.advanceTimersByTime(3200);
    expect(pie.classList.contains("destello")).toBe(true);
    vi.advanceTimersByTime(800);
    expect(pie.classList.contains("destello")).toBe(false);
    // La limpieza apaga el ciclo para siempre.
    limpiar();
    vi.advanceTimersByTime(8000);
    expect(pie.classList.contains("destello")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("con movimiento reducido no hay destello", () => {
    h.reduce = true;
    armarPie();
    iniciarDestelloPie();
    vi.advanceTimersByTime(12000);
    expect(document.querySelector('[data-i="footR"]')?.classList.contains("destello")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("el hover vivo de las capturas", () => {
  it("al pasar por encima de una tarjeta, esa captura se anima; al salir, vuelve", () => {
    armarPortadaJuegos();
    const [race, sapo] = [...document.querySelectorAll(".tarjeta")] as [HTMLElement, HTMLElement];
    iniciarHoverVivo(".tarjeta");
    race.dispatchEvent(new Event("pointerenter"));
    // Solo la tarjeta hovered: la otra queda quieta.
    expect(race.classList.contains("hover-vivo")).toBe(true);
    expect(sapo.classList.contains("hover-vivo")).toBe(false);
    race.dispatchEvent(new Event("pointerleave"));
    expect(race.classList.contains("hover-vivo")).toBe(false);
  });

  it("en pantalla táctil no hay hover, y no aplica", () => {
    h.hover = false;
    armarPortadaJuegos();
    const race = document.querySelector(".tarjeta") as HTMLElement;
    iniciarHoverVivo(".tarjeta");
    race.dispatchEvent(new Event("pointerenter"));
    expect(race.classList.contains("hover-vivo")).toBe(false);
  });

  it("con movimiento reducido no aplica tampoco", () => {
    h.reduce = true;
    armarPortadaJuegos();
    const race = document.querySelector(".tarjeta") as HTMLElement;
    iniciarHoverVivo(".tarjeta");
    race.dispatchEvent(new Event("pointerenter"));
    expect(race.classList.contains("hover-vivo")).toBe(false);
  });
});

describe("la entrada y la salida de la ventana de ingreso", () => {
  it("al abrir, el fondo entra con fade y el panel sube (clases que conecta el CSS)", () => {
    const { back, card } = armarModal();
    animarEntradaIngreso(back);
    expect(back.classList.contains("ingreso-entra")).toBe(true);
    // El panel es el que sube: la clase del fondo es la que engancha la animación de la tarjeta.
    expect(back.contains(card)).toBe(true);
    expect(card.className).toContain("modal-card login");
  });

  it("al cerrar, sale más corto y el nodo se quita después; una segunda llamada no lo duplica", () => {
    const { back } = armarModal();
    animarSalidaIngreso(back);
    expect(back.classList.contains("ingreso-sale")).toBe(true);
    expect(back.isConnected).toBe(true);
    animarSalidaIngreso(back);
    vi.advanceTimersByTime(149);
    expect(back.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(back.isConnected).toBe(false);
    // Cerrar una capa ya quitada no rompe nada.
    animarSalidaIngreso(back);
  });

  it("con movimiento reducido no hay transición: el nodo se quita al instante", () => {
    h.reduce = true;
    const { back } = armarModal();
    animarEntradaIngreso(back);
    expect(back.classList.contains("ingreso-entra")).toBe(false);
    animarSalidaIngreso(back);
    expect(back.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("el FOUC de la recarga de la portada", () => {
  it("el JS destraba el texto de sesión del botón grande cuando ya lo decidió", () => {
    armarHero();
    const cta = document.querySelector("[data-cta-entrar]") as HTMLElement;
    expect(cta.hasAttribute("data-cta-listo")).toBe(false);
    destrabarCtas();
    expect(cta.hasAttribute("data-cta-listo")).toBe(true);
  });

  it("el HTML estático no trae estados de transición de sesión pintados", () => {
    // Sin los comentarios: son documentación, no lo que se ve.
    const html = readFileSync("index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "");
    // "Retomando…" y "Conectando…" son estados que solo puede pintar el JS: si el HTML los traiga, se ven mal un instante.
    expect(html).not.toContain("Retomando");
    expect(html).not.toContain("Conectando");
  });

  it("styles.css esconde el texto de sesión hasta la destraba, y la caja de la cuenta guarda su lugar", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("[data-cta-entrar]:not([data-cta-listo]) .cta-t { visibility: hidden; }");
    expect(css).toContain(".auth:empty { visibility: hidden;");
    // Y todas las animaciones nuevas se apagan con movimiento reducido.
    for (const clave of [
      ".espera-juegos.pase .espera-juego-op { transition: none; }",
      ".hero-ctas .temblor { animation: none; }",
      "[data-i=\"footR\"].destello::after { animation: none; content: none; }",
      ".modal-back.ingreso-entra, .modal-back.ingreso-entra .modal-card.login,",
    ]) expect(css).toContain(clave);
    for (const clave of ["@keyframes temblor-atencion", "@keyframes destello-atencion", "@keyframes ken-burns-atencion", "@keyframes ingreso-entra-fondo", "@keyframes ingreso-entra-panel"]) {
      expect(css).toContain(clave);
    }
  });
});
