import { puede3D, usa3D } from "../games/engine";
import { ofrece3D } from "../games/tres/ofrecidos";
import { onLangChange, t } from "../i18n";
import { app, instantMode, motionReduced, params, setVer3D } from "../state";

/**
 * "En 3D / En 2D": el interruptor del selector. Los juegos con versión en 3D aprobada (`ofrece3D`) se ven en 3D por defecto
 * donde el equipo y la conexión lo aguantan (`games/permite3d.ts`); el interruptor aparece con ellos y sirve para volver al
 * 2D (y para prenderlo de nuevo). Recuerda la elección en este navegador: quien nunca lo tocó sigue la regla por defecto, y
 * quien lo apagó lo tiene apagado. En los equipos que no pueden no aparece y el show es 2D. Con `?motor=` en la dirección
 * manda la dirección y tampoco aparece. No cambia nada del sorteo: solo cómo se dibuja el juego.
 */
export function pintarVer3D(): void {
  const fila = document.getElementById("ver3d-row");
  const boton = document.getElementById("btn-3d");
  if (!fila || !boton) return;
  // Con movimiento reducido o `?instant=1` no hay show, y sin show no hay nada que ver en 3D.
  const ofrecer = ofrece3D(app.game) && puede3D() && !motionReduced() && !instantMode && !params.get("motor");
  fila.hidden = !ofrecer;
  const on = usa3D(app.game);
  boton.textContent = t(on ? "ver3dOn" : "ver3dOff");
  boton.setAttribute("aria-pressed", String(on));
}

export function iniciarVer3D(): void {
  const boton = document.getElementById("btn-3d");
  if (!boton) return;
  boton.addEventListener("click", () => {
    const on = !usa3D(app.game);
    setVer3D(on);
    pintarVer3D();
    // Lo que pesa (three.js) se baja ahora, con la sala todavía leyendo, y no al empezar el show.
    if (on && puede3D() && ofrece3D(app.game)) {
      if (app.game === "race") void import("../games/llamas/carrera-3d").catch(() => undefined);
      else void import("../games/tres/registro").then((m) => m.precargar3D(app.game)).catch(() => undefined);
    }
  });
  pintarVer3D();
  onLangChange(pintarVer3D);
}
