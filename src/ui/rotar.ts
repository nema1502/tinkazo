// La palabra del sticker de la portada ("Sorteá para tu meetup", "…tu clase",
// "…tu evento") cambia una vuelta y se queda en la primera. Con movimiento
// reducido no cambia: la frase entera ya dice lo mismo.
export const ROTATE_PAUSE_MS = 2400;
const FADE_MS = 250;

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
    el.classList.add("fading");
    setTimeout(() => {
      el.textContent = wordAt(words, step);
      el.classList.remove("fading");
    }, FADE_MS);
    if (step === words.length) clearInterval(timer);
  }, ROTATE_PAUSE_MS);
}
