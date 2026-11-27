import { esc } from "../dom";
import { hayLineasDePersona } from "../campana/forma-de-lista";
import { esLineaDePersona } from "../campana/forma-persona";
import { texto as t } from "../idioma";
import { isTurnOrder } from "../modos/turnos";
import { cierraComoReparto, nombreDePersona, salieronVariasVeces } from "../participaciones";
import { htmlDeTurnos } from "./lista-de-turnos";

/**
 * Lo que la página de verificación muestra en «Quién ganó» (`#v-winners`).
 *
 * Un sorteo común: una tarjeta por ganador, con su cara y «Se lleva: premio», como siempre.
 *
 * Un orden de turnos (`isTurnOrder`: ganan tantas personas como hay en la lista y el nombre empieza con «Turnos» o
 * «Turns»): la misma lista de turnos que la herramienta, `Turno 1 ... Turno N`. Con 300 personas una tarjeta por cada una
 * son decenas de miles de píxeles, y «Se lleva» no es lo que dice un orden. El comprobante no cambia de forma: el orden se
 * reconoce por la cantidad y el nombre que ya trae.
 *
 * Una línea de persona no nombra a nadie y nunca se muestra tal cual: se decide línea por línea, así que vale también con
 * una lista mezclada. Quien ganó con una línea dice «Lugar n de la lista», el lugar en la lista sellada que cualquiera
 * recalcula. Con una lista de cuentas o de nombres, todo sigue como siempre.
 *
 * Vive aparte, sin `state.ts` ni `i18n.ts` (la página de verificación no los carga): la cara de cada persona la pasa quien llama.
 * Para probar sin cargar toda la página.
 */
/** Cómo se nombra a quien ganó en una lista de personas: su lugar en la lista sellada, que empieza en 1. */
export function lugarDeLaLista(indice: number): string {
  return t("vLugarDeLaLista").replace("{n}", String(indice + 1));
}

/** Cómo se nombra a una persona en la lista sellada de la página: su lugar corto («Lugar 3»), que empieza en 1. */
export function lugarEnLaFila(indice: number): string {
  return t("vLugar").replace("{n}", String(indice + 1));
}

/** Lo que muestra la página de una fila de la lista: el lugar si es una línea de persona, y la fila tal cual si no. */
export function filaVisible(fila: string, indice: number): string {
  return esLineaDePersona(fila) ? lugarEnLaFila(indice) : fila;
}

export function htmlDeLosGanadores(
  names: readonly string[],
  winners: readonly number[],
  premio: string,
  avatar: (nombre: string, px: number) => string,
  porPersona = false,
): string {
  // Una línea de persona se nombra siempre por el lugar, también si la lista fuera un orden de turnos.
  const porLugar = hayLineasDePersona(names);
  // Sin título: el encabezado de la página (`#v-result-t`) ya dice «El orden de los turnos».
  if (!porLugar && isTurnOrder(names.length, winners.length, premio)) return htmlDeTurnos(names, winners, { titulo: false, sinSufijos: porPersona });
  // Con reparto que cierra, la tarjeta nombra a la persona, sin la marca de la línea sellada, como el resultado.
  const lecturaPorPersona = porPersona && cierraComoReparto(names);
  const mostrar = (linea: string, i: number): string =>
    esLineaDePersona(linea) ? lugarDeLaLista(i) : lecturaPorPersona ? nombreDePersona(linea) : linea;
  const tarjetas = winners
    .map((i) => {
      const name = mostrar(names[i] ?? "", i);
      return `<div class="winner-card">
        <img src="${avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name">${esc(name)}</p>
          ${premio ? `<p class="winner-prize">${esc(t("winsPrize"))} ${esc(premio)}</p>` : ""}
        </div>
      </div>`;
    })
    .join(" ");
  // Debajo, el aviso de quien salió más de una vez, como en la herramienta, con estilo de nota para que no parezca
  // otra tarjeta. Estas tarjetas no llevan el número de cada premio, así que el aviso no puede nombrarlos: dice
  // cuántas veces salió.
  const aviso = salieronVariasVeces(porLugar ? names.map((n, i) => filaVisible(n, i)) : names, winners, lecturaPorPersona)
    .map((v) => `<p class="again-note veces">${esc(t("salioVeces").replace(/\{(nombre|n)\}/g, (_, k: string) => (k === "nombre" ? v.nombre : String(v.veces))))}</p>`)
    .join("");
  return tarjetas + aviso;
}
