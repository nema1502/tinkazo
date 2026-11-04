import { puede3D } from "../games/engine";
import { ofrece3D } from "../games/tres/ofrecidos";
import { onLangChange, t } from "../i18n";
import { app, instantMode, motionReduced, setVer3D, ver3D } from "../state";

/**
 * "Ver en 3D": el interruptor del selector. Aparece con cualquier juego que tenga versión en 3D aprobada (`ofrece3D`) y solo
 * si este equipo y esta conexión la aguantan (las mismas condiciones de `games/permite3d.ts`); apagado por defecto y
 * recordado en este navegador. No cambia nada del sorteo: solo cómo se dibuja el juego.
 */
export function pintarVer3D(): void {
  const fila = document.getElementById("ver3d-row");
  const boton = document.getElementById("btn-3d");
  if (!fila || !boton) return;
  // Con movimiento reducido o `?instant=1` no hay show, y sin show no hay nada que ver en 3D.
  const ofrecer = ofrece3D(app.game) && puede3D() && !motionReduced() && !instantMode;
  fila.hidden = !ofrecer;
  const on = ver3D();
  boton.textContent = t(on ? "ver3dOn" : "ver3dOff");
  boton.setAttribute("aria-pressed", String(on));
}

export function iniciarVer3D(): void {
  const boton = document.getElementById("btn-3d");
  if (!boton) return;
  boton.addEventListener("click", () => {
    const on = !ver3D();
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
