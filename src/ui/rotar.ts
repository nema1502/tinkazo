// La palabra del sticker de la portada ("Sorteá para tu meetup", "…tu clase",
// "…tu evento") cambia una vuelta y se queda en la primera. Con movimiento
// reducido no cambia: la frase entera ya dice lo mismo.
//
// Cambia dándose vuelta, como un cartelito (la regla `.rotating` de
// styles.css): se pone de canto, cambia y vuelve. Antes se fundía, y a mitad
// del fundido la palabra quedaba casi transparente sobre el turquesa, con un
// contraste de 1,2 a 1 (lo midió audit-ui el 21 de octubre de 2026). De canto
// no se ve, pero lo que se ve tiene siempre el color de la letra.
export const ROTATE_PAUSE_MS = 2400;
/** Lo que tarda en ponerse de canto (la transición de styles.css dura un poco menos). */
const FLIP_MS = 200;

/** "meetup|clase|evento" → ["meetup", "clase", "evento"]. */
export function splitWords(list: string | undefined): string[] {
  return (list ?? "").split("|").map((w) => w.trim()).filter(Boolean);
}

/** La palabra de la vuelta `step`. Después de la última vuelve a la primera. */
export function wordAt(words: string[], step: number): string {
  return words[step % words.length] ?? "";
}

export function rotateWords(root: ParentNode = document): void {
  const el = root.querySelector<HTMLElement>(".rotating[data-words]");
  const words = splitWords(el?.dataset.words);
  if (!el || words.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    el.classList.add("girando");
    setTimeout(() => {
      el.textContent = wordAt(words, step);
      el.classList.remove("girando");
    }, FLIP_MS);
    if (step === words.length) clearInterval(timer);
  }, ROTATE_PAUSE_MS);
}
