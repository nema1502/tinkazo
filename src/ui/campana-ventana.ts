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

/**
 * Si la ventana de Google de una campaña, al volver a la raíz del sitio, deja la herramienta quieta: no retoma la sesión del
 * proveedor ni baja su SDK (cada retomada son pedidos al servicio de cuentas por cada ingreso, justo cuando 150 celulares
 * entran juntos, y la ventana se cierra sola en cuanto Google termina).
 *
 * Eso no se pudo ver en un ingreso real: si el proveedor necesitara el SDK corriendo en la ventana de vuelta para cerrar el
 * ingreso, el celular quedaría esperando después de elegir la cuenta. La prueba entera (Entrar con Google, volver, Hola,
 * anotarse) se hace una vez con el sitio construido antes de publicar. Si falla, poner esto en `false` y la ventana vuelve a
 * arrancar la herramienta como antes del cambio, sin tocar nada más.
 */
export const LA_VENTANA_DE_GOOGLE_NO_RETOMA: boolean = true;

/**
 * ¿Esta pestaña es la ventana de Google de una campaña? Sin soltar la marca ni pintar nada: solo mirar, para que la
 * herramienta no retome en ella la sesión del proveedor (cada retomada son pedidos al servicio de cuentas, y la ventana se
 * cierra sola en cuanto Google termina). Con `?premio=1` nunca: esa pestaña vino a recibir. Con el interruptor apagado
 * (`LA_VENTANA_DE_GOOGLE_NO_RETOMA`) nunca: la herramienta arranca como siempre.
 */
export function esLaVentanaDeGoogleDeUnaCampana(
  d: Pick<DepsDeLaVentana, "sesion" | "ahora" | "pideElPremio">,
  noRetoma: boolean = LA_VENTANA_DE_GOOGLE_NO_RETOMA,
): boolean {
  if (!noRetoma || !d.sesion || d.pideElPremio) return false;
  return esVentanaDeGoogle(d.sesion, d.ahora);
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
