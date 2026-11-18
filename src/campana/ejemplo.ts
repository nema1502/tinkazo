/**
 * Configuración local de una campaña de muestra.
 * Permite trabajar en la pantalla previa sin pedir una respuesta al servicio.
 */

import { network } from "../stellar/config";
import type { Campana } from "./modelo";

/** Devuelve una campaña válida con horarios relativos al momento recibido. */
export function campanaDeEjemplo(ahora: number): Campana {
  const sorteoMs = ahora + 4 * 60 * 60 * 1000;
  return {
    v: 1,
    evento: "evento-ejemplo",
    red: network.name,
    estado: "abierta",
    empresa: { nombre: "Empresa de ejemplo", logo: null, color: "verde" },
    lugar: { es: "Evento de ejemplo", en: "Sample event" },
    zona: "America/La_Paz",
    premios: [400000000n],
    abreMs: ahora - 60 * 60 * 1000,
    cierraMs: ahora + 3 * 60 * 60 * 1000,
    sorteoMs,
    recibirHastaMs: sorteoMs + 180 * 24 * 60 * 60 * 1000,
    entrada: "google",
    pasos: [
      {
        tipo: "instagram",
        url: "https://www.instagram.com/ejemplo",
        texto: { es: "Seguí a {empresa} en Instagram", en: "Follow {empresa} on Instagram" },
      },
      {
        tipo: "youtube",
        url: "https://www.youtube.com/c/ejemplo",
        texto: { es: "Suscribite al canal de {empresa} en YouTube", en: "Subscribe to {empresa}'s YouTube channel" },
      },
      { tipo: "texto", url: null, texto: { es: "Pasá por el stand a saludar", en: "Stop by the stand to say hi" } },
    ],
    bases: {
      es: "Participar es gratis. La lista cierra antes del sorteo.",
      en: "Taking part is free. The list closes before the draw.",
    },
    anotadas: 37,
    contrato: null,
    promo: null,
    comprobante: null,
  };
}
