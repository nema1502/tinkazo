import type { Beacon, Game } from "../state";

/**
 * La tarjeta de "¿por qué se llama así?".
 *
 * Nadie va a leer un párrafo en medio de un sorteo. Lo que sí pasa es que
 * alguien saca una foto de la pantalla y después la mira. Por eso esta tarjeta
 * aparece **después** del ganador, cuando la tensión ya pasó, y nunca antes.
 *
 * Tres reglas que no se negocian:
 *
 * 1. **Ningún dato sin fuente primaria.** Esto lo va a leer alguien que sabe
 *    más de Stellar que nosotros. Un dato inventado nos deja sin credibilidad
 *    justo donde el producto la necesita.
 * 2. **Dos frases.** Si no entra en dos frases, el dato no sirve para esto.
 * 3. **Bilingüe en el mismo cambio**, como todo lo visible.
 *
 * La tarjeta se sortea con la ronda, así que es determinista como el resto: la
 * misma ronda muestra siempre la misma, y un organizador que sortea cada
 * semana va viendo distintas.
 */

export interface Lore {
  /** Clave de la pregunta que pica la curiosidad. */
  q: string;
  /** Clave del cuerpo. Dos frases. */
  a: string;
  /** La fuente primaria. Sin esto la tarjeta no existe. */
  href: string;
  /** De dónde sale el dato, para mostrarlo. */
  src: string;
  /** Color de la pestaña, de la paleta de la casa. */
  hue: "magenta" | "orange" | "teal" | "purple" | "yellow";
}

/**
 * Las tarjetas, por juego. Las de `any` salen con cualquiera.
 *
 * Cada texto vive en `src/i18n.ts` bajo la clave que dice acá. El comentario
 * de cada entrada anota la cita textual que se verificó en la fuente.
 */
export const LORE: Record<string, Lore[]> = {
  any: [
    {
      // "tinkazo. I. 1. m. Bo. tinca, presentimiento." y
      // "tincazo. Golpe que se da haciendo resbalar con violencia, sobre la
      //  yema del pulgar, el envés de la última falange de otro dedo."
      q: "loreTinkazoQ",
      a: "loreTinkazoA",
      href: "https://www.asale.org/damer/tinkazo",
      src: "asale.org · Diccionario de americanismos",
      hue: "magenta",
    },
    {
      q: "loreDrandQ",
      a: "loreDrandA",
      href: "https://docs.drand.love/blog/2023/10/16/quicknet-is-live/",
      src: "docs.drand.love",
      hue: "purple",
    },
  ],
  stellar: [
    {
      // "An anchor is a Stellar-specific term for the on and off-ramps that
      //  connect the Stellar network to traditional financial rails."
      q: "loreAnchorQ",
      a: "loreAnchorA",
      href: "https://developers.stellar.org/docs/learn/fundamentals/anchors",
      src: "developers.stellar.org",
      hue: "purple",
    },
    {
      // En el XDR del protocolo: `Asset path<5>`.
      q: "loreHopsQ",
      a: "loreHopsA",
      href: "https://github.com/stellar/stellar-xdr/blob/curr/Stellar-transaction.x",
      src: "stellar-xdr · Stellar-transaction.x",
      hue: "teal",
    },
  ],
  ledger: [
    {
      // "At 1:14pm Pacific time, May 15th, the Stellar network halted for
      //  67 minutes due to an inability to reach consensus."
      q: "loreHaltQ",
      a: "loreHaltA",
      href: "https://stellar.org/blog/developers/may-15th-network-halt",
      src: "stellar.org · informe del 15 de mayo de 2019",
      hue: "orange",
    },
    {
      // Protocolo 23, activo desde el 3 de septiembre de 2025.
      q: "loreCloseQ",
      a: "loreCloseA",
      href: "https://stellar.org/blog/developers/announcing-protocol-23",
      src: "stellar.org · Protocolo 23",
      hue: "teal",
    },
  ],
  race: [
    {
      // "The Japanese soroban is the smallest and simplest abacus. Developed
      //  in the 14th century and still in use today, its design is compact and
      //  minimalist, focused on doing the essentials, and doing them well."
      q: "loreSorobanQ",
      a: "loreSorobanA",
      href: "https://stellar.org/blog/developers/soroban-a-new-smart-contract-standard",
      src: "stellar.org · por qué Soroban",
      hue: "orange",
    },
  ],
  rockets: [
    {
      q: "loreAirdropQ",
      a: "loreAirdropA",
      href: "https://stellar.org/blog/foundation-news/keybase-stellar-lumens-spacedrop",
      src: "stellar.org · el airdrop de Keybase",
      hue: "magenta",
    },
  ],
  wheel: [
    {
      // El costo mínimo de una operación: "each would pay the minimum
      //  inclusion fee of 100 stroops (.00001 XLM)".
      q: "loreStroopQ",
      a: "loreStroopA",
      href: "https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering",
      src: "developers.stellar.org · comisiones",
      hue: "yellow",
    },
  ],
  pasanaku: [
    {
      // "pasanacu. sust. masc. Bo. Juego que consiste en sortear el dinero de
      //  las cuotas semanales o mensuales de los participantes."
      q: "lorePasanakuQ",
      a: "lorePasanakuA",
      href: "https://www.asale.org/damer/pasanacu",
      src: "asale.org · Diccionario de americanismos",
      hue: "orange",
    },
    {
      // "One base reserve is currently 0.5 XLM".
      q: "loreTrustlineQ",
      a: "loreTrustlineA",
      href: "https://developers.stellar.org/docs/learn/fundamentals/lumens",
      src: "developers.stellar.org · reservas",
      hue: "teal",
    },
    {
      // Etimología del diccionario: "Del aim. y quech. wawa, niño".
      q: "loreAguayoQ",
      a: "loreAguayoA",
      href: "https://www.asale.org/damer/aguayo",
      src: "asale.org · Diccionario de americanismos",
      hue: "yellow",
    },
  ],
  teleferico: [
    {
      // "Bolivia is home to Mi Teleférico, the world's biggest urban ropeway
      //  network. A total of ten lines connect the cities of La Paz and El Alto"
      // y "detachable 10-passenger gondola lifts [...] 1,396 cabins". Las
      // líneas se llaman por su color: Roja, Amarilla, Verde, Azul y seis más.
      q: "loreTelefericoQ",
      a: "loreTelefericoA",
      href: "https://www.doppelmayr.com/en/reference-projects/reference-project-mi-teleferico/",
      src: "doppelmayr.com · Mi Teleférico",
      hue: "teal",
    },
  ],
};

/**
 * La tarjeta de este sorteo. Sale de la ronda, así que es parte del
 * comprobante: quien rehace el sorteo ve la misma.
 */
export function loreFor(game: Game, beacon: Beacon): Lore | null {
  const pool = [...(LORE[game] ?? []), ...(LORE.any ?? [])];
  if (!pool.length) return null;
  const k = parseInt(beacon.randomness.slice(-4), 16) % pool.length;
  return pool[k] ?? null;
}
