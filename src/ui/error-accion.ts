/** Acción del error: comparte el gesto entre la página y la espera, sin repetir lógica. */
export interface AccionError {
  texto: string;
  ejecutar: () => void;
}

/** `detail` sigue siendo texto para los consumidores anteriores. */
export type EventoError = CustomEvent<string> & { accion?: AccionError; segunda?: AccionError };

/**
 * `segunda`: otra salida, menos importante que la principal (por ejemplo "Sortear pagando con mi cuenta"). Quien la
 * muestra la ejecuta y después hace lo mismo que con la principal: solo deja anotado el cambio.
 */
export function eventoError(texto: string, accion?: AccionError, segunda?: AccionError): EventoError {
  const evento: EventoError = new CustomEvent("tinkazo:error", { detail: texto, cancelable: true });
  if (accion) evento.accion = accion;
  if (segunda) evento.segunda = segunda;
  return evento;
}
