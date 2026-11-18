/**
 * La entrada de quien ganó un premio (`/?red=oficial&premio=1`): abre la ventana del saldo, que lleva al paso de la cuenta
 * con textos de premio, y deja el permiso del paso a nombre de esa cuenta. Sin DOM ni red: lo que toca la página llega por
 * `DepsDelPremio` (las reales salen de `campana-arranque.ts`, las pruebas pasan las suyas).
 *
 * Sin sesión no abre ninguna ventana ni empuja nada: la portada ya muestra su botón de entrar con Google, que abre Google
 * con el toque de la persona, y cuando llega la sesión se abre el saldo.
 */
export interface DepsDelPremio {
  /** Esta página recibió la entrada del premio y puede atenderla (`pideElPremioAqui`). */
  pideElPremio: () => boolean;
  cuentaDeLaSesion: () => string | null;
  /** Avisa cada vez que cambia la sesión: la cuenta, o `null` si se cerró. */
  alEntrar: (f: (cuenta: string | null) => void) => void;
  /** La sala, la espera o un sorteo sellado tapan la página: no se abre nada encima. */
  nadaSeAbreSolo: () => boolean;
  /** Deja el permiso pendiente en esta pestaña hasta la primera sesión (la ventana de Google la copia). */
  esperarla: () => void;
  /** El permiso del paso para una cuenta. Con `null`, se apaga. */
  permitir: (cuenta: string | null) => void;
  abrir: (cuenta: string) => void;
  quitarDeLaDireccion: () => void;
}

export function arrancarPremio(d: DepsDelPremio): void {
  if (!d.pideElPremio()) return;
  // Una recarga no vuelve a abrir la ventana sola: `premio` sale de la dirección y queda `red`. Todo va en el mismo turno
  // y sin esperar nada, así que el flujo de la cuenta no ve un hueco entre la dirección limpia y el permiso.
  d.quitarDeLaDireccion();
  let abierta: string | null = null;
  const alCambiar = (cuenta: string | null): void => {
    if (abierta !== null) {
      // Otra cuenta, o ninguna, después de abrir: el permiso era de la cuenta que ganó.
      if (cuenta !== abierta) d.permitir(null);
      return;
    }
    if (!cuenta) return;
    // La primera sesión decide: el permiso es suyo aunque la sala tape la página (ahí no se abre nada encima, ni ahora ni
    // después, y la persona llega al paso por Tus dólares).
    abierta = cuenta;
    d.permitir(cuenta);
    if (!d.nadaSeAbreSolo()) d.abrir(cuenta);
  };
  const ya = d.cuentaDeLaSesion();
  if (ya) alCambiar(ya);
  else d.esperarla();
  d.alEntrar(alCambiar);
}
