import "./confianza.css";
import { esc } from "../dom";
import { texto as t, onLangChange } from "../idioma";
import { respuestasConfianza, type Respuesta, type EstadoRespuesta } from "../respuestas-confianza";
import type { Ref } from "../../workers/enlaces/src/conteo";

type Servicio = typeof respuestasConfianza;
/** Montar una vez; repintar nunca registra listeners ni envía nada. */
export function montarConfianza(box: HTMLElement, ref: Ref, servicio: Servicio = respuestasConfianza): void {
  if (box.dataset.montada || !servicio.disponible(ref)) return;
  box.dataset.montada = "1";
  let estado: EstadoRespuesta | "lista" = servicio.confirmada(ref) ? "recibida" : "lista";
  let seleccion: Respuesta | undefined;
  function pintar(): void {
    box.hidden = !servicio.disponible(ref);
    if (box.hidden) return;
    const bloqueada = estado === "pendiente" || estado === "recibida";
    box.innerHTML = `<form class="confianza-form"><fieldset ${bloqueada ? "disabled" : ""} aria-describedby="confianza-nota confianza-estado">
      <legend>${esc(t("trustQuestion"))}</legend>
      <p class="note" id="confianza-nota">${esc(t("trustOptional"))}</p>
      <div class="confianza-opciones">${([["yes", "trustYes"], ["no", "trustNo"], ["unsure", "trustUnsure"]] as const).map(([v, k]) =>
        `<label><input type="radio" name="trust" value="${v}" required ${seleccion === v ? "checked" : ""}> ${esc(t(k))}</label>`).join("")}</div>
      <button type="submit" class="ghost" ${bloqueada ? "disabled" : ""}>${esc(t(estado === "incierta" ? "trustRetry" : "trustSend"))}</button>
      </fieldset><p class="note" id="confianza-estado" role="status" aria-live="polite">${esc(
        estado === "recibida" ? t("trustReceived") : estado === "incierta" ? t("trustUnknown") : estado === "pendiente" ? t("trustSending") : estado === "bloqueada" ? t("trustBlocked") : "",
      )}</p></form>`;
  }
  box.addEventListener("change", (e) => {
    const input = e.target;
    if (input instanceof HTMLInputElement && input.name === "trust") seleccion = input.value as Respuesta;
  });
  box.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!seleccion || estado === "pendiente" || estado === "recibida") return;
    estado = "pendiente";
    pintar();
    void servicio.enviar(ref, seleccion).then((s) => { estado = s; pintar(); });
  });
  onLangChange(pintar);
  pintar();
}
