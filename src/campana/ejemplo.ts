/**
 * Configuración local de una campaña de muestra.
 * Permite trabajar en las pantallas sin pedirle nada al servicio.
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
    empresa: { nombre: "Alcancía Andina", logo: null, color: "verde" },
    lugar: { es: "Hackathon", en: "Hackathon" },
    zona: "America/La_Paz",
    premios: [400000000n],
    abreMs: ahora - 60 * 60 * 1000,
    cierraMs: ahora + 3 * 60 * 60 * 1000,
    sorteoMs,
    recibirHastaMs: sorteoMs + 180 * 24 * 60 * 60 * 1000,
    entrada: "google",
    pasos: [
      { tipo: "instagram", url: "https://www.instagram.com/", texto: { es: "", en: "" } },
      { tipo: "tiktok", url: "https://www.tiktok.com/", texto: { es: "", en: "" } },
      { tipo: "x", url: "https://x.com/", texto: { es: "", en: "" } },
    ],
    bases: {
      es: "Participar es gratis y no hace falta comprar nada. Seguir a Alcancía Andina en sus redes es un pedido y no cambia quién gana.",
      en:
        "Taking part is free and you don't need to buy anything. " +
        "Following Alcancía Andina on social media is a request and doesn't change who wins.",
    },
    anotadas: 37,
    contrato: null,
    promo: null,
    comprobante: null,
  };
}
