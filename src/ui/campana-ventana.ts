import { esVentanaDeGoogle, soltarVentana } from "../campana/invitada";

/**
 * Si esta pestaña es la ventana de Google que abrió la página de una campaña (`marcarVentana` de `src/campana/invitada.ts`),
 * no es para usar la herramienta: dice que vuelvan a la pestaña del sorteo y trata de cerrarse.
 *
 * Con `?premio=1` nunca: esa pestaña vino a recibir, no es la ventana de Google. Y como la página de la campaña también deja
 * la marca en su propia pestaña, acá se suelta: así quien gana y entra desde esa misma pestaña no ve la capa en la
 * recarga siguiente. La página de la campaña la pone justo antes de abrir Google y la borra de su pestaña justo después,
 * en el mismo toque.
 */
export interface DepsDeLaVentana {
  sesion: Pick<Storage, "getItem" | "removeItem"> | null;
  ahora: number;
  pideElPremio: boolean;
  pintar: (texto: string) => void;
  cerrar: () => void;
  /** Esta carga era la ventana de Google: el flujo de la cuenta no abre su paso en ella. */
  callar: () => void;
  tx: (clave: string) => string;
}

export function atenderVentanaDeGoogle(d: DepsDeLaVentana): boolean {
  if (!d.sesion) return false;
  if (d.pideElPremio) {
    soltarVentana(d.sesion);
    return false;
  }
  if (!esVentanaDeGoogle(d.sesion, d.ahora)) return false;
  soltarVentana(d.sesion);
  d.callar();
  d.pintar(d.tx("clVentanaLista"));
  d.cerrar();
  return true;
}

/** La capa que tapa la herramienta en esa pestaña: el texto grande y centrado, del color del tema, encima de todo. */
export function pintarCapa(texto: string): void {
  const capa = document.createElement("div");
  capa.className = "campana-ventana";
  capa.setAttribute("role", "status");
  capa.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;"
    + "padding:16px;background:var(--paper);color:var(--ink)";
  const p = document.createElement("p");
  p.style.cssText = "margin:0;max-width:20ch;text-align:center;font-size:clamp(24px, 6vw, 44px);line-height:1.2";
  p.textContent = texto;
  capa.append(p);
  document.body.append(capa);
}

/** Trata de cerrar la pestaña. Si el navegador no la deja (no la abrió un script), queda la capa con el texto. */
export function cerrarVentana(): void {
  try {
    window.close();
  } catch {
    /* queda la capa */
  }
}
