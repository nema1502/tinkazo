/** Los colores del papel picado. El blanco se ve sobre el bloque de cualquier empresa y el acento no. */
const COLORES = [
  "var(--magenta)",
  "#fff",
  "var(--cmp-rojo)",
  "var(--cmp-naranja)",
  "var(--cmp-amarillo)",
  "var(--cmp-verde)",
  "var(--cmp-azul)",
  "var(--cmp-morado)",
];

/** El festejo grande reparte la caída entre más de dos segundos y termina antes de los 2,6 s. */
export const FESTEJO_GRANDE = {
  cantidad: 30,
  retrasoMaxMs: 700,
  duracionMinMs: 1100,
  duracionMaxMs: 1900,
} as const;

/** El festejo chico es un solo soplo de papelitos, de menos de un segundo. */
const FESTEJO_CHICO = { cantidad: 12, duracionMs: 600 } as const;

/** El retraso y la duración de un papelito: se reparten por su lugar, sin azar, para que cada corrida sea igual. */
function tiemposDelPapelito(indice: number, grande: boolean): { retrasoMs: number; duracionMs: number } {
  if (!grande) return { retrasoMs: (indice % 6) * 35, duracionMs: FESTEJO_CHICO.duracionMs };
  const { cantidad, retrasoMaxMs, duracionMinMs, duracionMaxMs } = FESTEJO_GRANDE;
  const pasos = cantidad - 1;
  // Multiplicar por 11 recorre todos los lugares sin repetir, así los largos y los cortos se mezclan.
  const lugarDeLaCaida = (indice * 11) % cantidad;
  return {
    retrasoMs: Math.round((indice * retrasoMaxMs) / pasos),
    duracionMs: Math.round(duracionMinMs + (lugarDeLaCaida * (duracionMaxMs - duracionMinMs)) / pasos),
  };
}

/** Celebra con un tilde y papelitos de colores, sin sonido ni objetos que representen plata. */
export function festejar(
  raiz: HTMLElement,
  o: { grande: boolean; reducido: boolean; vibrar: (p: number[]) => void },
): void {
  raiz.querySelector(":scope > .cmp-festejo")?.remove();
  const festejo = document.createElement("div");
  festejo.className = o.grande ? "cmp-festejo cmp-festejo-grande" : "cmp-festejo";
  festejo.setAttribute("aria-hidden", "true");
  // Si la pantalla ya tiene su tilde grande, es esa la que salta. Si no, aparece una encima y se va.
  const marca = raiz.querySelector<HTMLElement>(".cmp-marca");
  if (marca) {
    marca.classList.add("cmp-tilde");
  } else {
    const tilde = document.createElement("span");
    tilde.className = "cmp-tilde";
    tilde.textContent = "✓";
    festejo.append(tilde);
  }
  raiz.append(festejo);
  o.vibrar(o.grande ? [80, 60, 80, 60, 80] : [60]);
  if (o.reducido) return;
  const cantidad = o.grande ? FESTEJO_GRANDE.cantidad : FESTEJO_CHICO.cantidad;
  for (let indice = 0; indice < cantidad; indice += 1) {
    const { retrasoMs, duracionMs } = tiemposDelPapelito(indice, o.grande);
    const papelito = document.createElement("span");
    papelito.className = "cmp-papelito";
    papelito.style.left = `${(indice * 37 + 7) % 100}%`;
    papelito.style.background = COLORES[indice % COLORES.length] ?? "var(--magenta)";
    papelito.style.animationDelay = `${retrasoMs}ms`;
    papelito.style.animationDuration = `${duracionMs}ms`;
    festejo.append(papelito);
    window.setTimeout(() => papelito.remove(), retrasoMs + duracionMs + 220);
  }
}
