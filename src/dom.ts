/** Acceso tipado a elementos por id. Falla ruidosamente si el markup cambió. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} no existe en el documento`);
  return el as T;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escapa texto para insertarlo en innerHTML. */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c] ?? c);
