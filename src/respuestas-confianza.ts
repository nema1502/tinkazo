import { cuerpo, enPractica, puedeContar } from "./contar";
import { SERVICIO_CONFIANZA } from "./confianza-activacion";
import { type PropsDe, type Ref, claveDeRef, validarConteo, validarRefConfianza } from "../workers/enlaces/src/conteo";

export type Respuesta = PropsDe<"proof_trust">["answer"];
export type EstadoRespuesta = "bloqueada" | "pendiente" | "recibida" | "incierta";
const MARCA = "tinkazo.confianza:";

/** Una instancia por página. El destino inyectable permite pruebas simuladas, no activa el sitio. */
export function crearRespuestas(destino = SERVICIO_CONFIANZA) {
  const recibidas = new Set<string>();
  const pendientes = new Set<string>();
  const clave = (ref: Ref): string => claveDeRef(ref);
  function confirmada(ref: Ref): boolean {
    const k = clave(ref);
    if (recibidas.has(k)) return true;
    try { return sessionStorage.getItem(MARCA + k) === "1"; } catch { return false; }
  }
  function disponible(ref: Ref): boolean {
    try {
      return !!destino && !!validarRefConfianza(ref) && puedeContar(location, navigator) && !enPractica()
        && !(document as Document & { prerendering?: boolean }).prerendering;
    } catch { return false; }
  }
  async function enviar(ref: Ref, answer: Respuesta): Promise<EstadoRespuesta> {
    if (!disponible(ref) || !validarConteo({ e: "proof_trust", p: { answer }, ref }).ok) return "bloqueada";
    if (confirmada(ref)) return "recibida";
    const k = clave(ref);
    if (pendientes.has(k)) return "pendiente";
    pendientes.add(k);
    try {
      const r = await fetch(destino, {
        method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: cuerpo("proof_trust", { answer }, ref),
      });
      if (r.status !== 204) return "incierta";
      recibidas.add(k);
      try { sessionStorage.setItem(MARCA + k, "1"); } catch { /* memoria de esta página */ }
      return "recibida";
    } catch { return "incierta"; }
    finally { pendientes.delete(k); }
  }
  return { disponible, confirmada, enviar };
}

export const respuestasConfianza = crearRespuestas();
