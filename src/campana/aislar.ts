/**
 * Lo que la página de una campaña de personas hace antes de dejar entrar al guion de Google: pasa a no mandar de dónde viene
 * (`no-referrer`) en todo lo que pida desde ese momento, no solo en la etiqueta del guion. Así lo que Google pide después de
 * dibujar el botón no lleva la dirección de la campaña.
 *
 * La dirección de la barra no se toca: tiene que seguir trayendo el enlace entero. Quien abre el enlace desde la cámara o desde
 * una aplicación de mensajes y lo pasa al navegador, o lo copia para otra persona, o vuelve a la pestaña sin su historial, tiene
 * que seguir entrando a la misma campaña. El pase del QR vence en pocos minutos y la clave de los nombres no sirve sin la lista
 * cifrada, que Google no ve.
 *
 * La campaña de siempre no pasa por acá: sus direcciones y su política de referencia no cambian en nada.
 */

export interface EntornoDeLaPagina {
  documento: Document;
}

const delNavegador = (): EntornoDeLaPagina => ({ documento: document });

/** Manda la página a no decir de dónde viene. Se puede llamar más de una vez. */
export function aislarDelGuion(e: EntornoDeLaPagina = delNavegador()): void {
  const { head } = e.documento;
  if (!head || head.querySelector('meta[name="referrer"][content="no-referrer"]')) return;
  const meta = e.documento.createElement("meta");
  meta.name = "referrer";
  meta.content = "no-referrer";
  head.appendChild(meta);
}
