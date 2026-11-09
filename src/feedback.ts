import { getLang, onLangChange, type Lang } from "./idioma";

/**
 * El formulario para opinar, en Tally: un enlace y nada más. Sin ventanas que
 * salten, sin avisos y sin el script de Tally en el sitio. Se ofrece en el pie y
 * al final del resultado, después de todo lo demás, y nunca durante el juego.
 * Quien ya lo abrió desde el resultado no lo vuelve a ver ahí.
 *
 * El enlace dice de qué parte venís y qué juego usaste. Nunca lleva la lista ni
 * un nombre. La llave de la API de Tally no hace falta acá ni va al repositorio.
 */
const FORMULARIO: Record<Lang, string> = {
  es: "https://tally.so/r/KpzoAA",
  en: "https://tally.so/r/LD9GBj",
};

export const CLAVE_FEEDBACK = "tinkazo.feedback";

export function enlaceDeFeedback(lang: Lang, desde: string, juego?: string): string {
  const url = new URL(FORMULARIO[lang]);
  url.searchParams.set("desde", desde);
  if (juego) url.searchParams.set("juego", juego);
  return url.href;
}

function yaLoAbrio(): boolean {
  try {
    return localStorage.getItem(CLAVE_FEEDBACK) === "1";
  } catch {
    return false;
  }
}

function recordarQueLoAbrio(): void {
  try {
    localStorage.setItem(CLAVE_FEEDBACK, "1");
  } catch {
    /* sin almacenamiento, el enlace vuelve a estar en el próximo resultado, y no molesta */
  }
}

/** De dónde viene la opinión del resultado: la demo y el ensayo no se confunden con un sorteo de verdad. */
export function origenDelResultado(demo: boolean, ensayo: boolean): "resultado" | "demo" | "ensayo" {
  return demo ? "demo" : ensayo ? "ensayo" : "resultado";
}

/**
 * Le pone a cada `a[data-feedback]` el formulario de su idioma. `juego` y `origen` los da la herramienta; las
 * páginas de lectura no tienen.
 */
export function iniciarFeedback(juego?: () => string, origen?: () => string): void {
  const enlaces = [...document.querySelectorAll<HTMLAnchorElement>("a[data-feedback]")];
  const desdeDe = (a: HTMLAnchorElement): string => {
    const desde = a.dataset.feedback ?? "pie";
    return desde === "resultado" ? (origen?.() ?? desde) : desde;
  };
  const apuntar = (a: HTMLAnchorElement): void => {
    a.href = enlaceDeFeedback(getLang(), desdeDe(a), a.dataset.feedback === "resultado" ? juego?.() : undefined);
  };
  const apuntarTodos = (): void => enlaces.forEach(apuntar);
  apuntarTodos();
  onLangChange(apuntarTodos);
  for (const a of enlaces) {
    // Con el juego de ahora: el enlace se armó antes de elegirlo. El clic del medio, "abrir en otra pestaña"
    // y "copiar dirección" no pasan por `click`, así que se apunta también antes.
    for (const ev of ["pointerdown", "focus", "contextmenu"]) a.addEventListener(ev, () => apuntar(a));
    const abrio = (): void => {
      apuntar(a);
      // La demo y el ensayo no gastan el "una sola vez": la opinión que más vale es la del primer sorteo de verdad.
      if (desdeDe(a) !== "resultado") return;
      recordarQueLoAbrio();
      a.hidden = true;
    };
    a.addEventListener("click", abrio);
    a.addEventListener("auxclick", (e) => {
      if (e.button === 1) abrio();
    });
    if (a.dataset.feedback === "resultado") a.hidden = yaLoAbrio();
  }
}
