/** Acción del error: comparte el gesto entre la página y la espera, sin repetir lógica. */
export interface AccionError {
  texto: string;
  ejecutar: () => void;
}

/** `detail` sigue siendo texto para los consumidores anteriores. */
export type EventoError = CustomEvent<string> & { accion?: AccionError };

export function eventoError(texto: string, accion?: AccionError): EventoError {
  const evento: EventoError = new CustomEvent("tinkazo:error", { detail: texto, cancelable: true });
  if (accion) evento.accion = accion;
  return evento;
}
