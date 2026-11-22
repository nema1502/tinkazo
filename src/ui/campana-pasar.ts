/**
 * Pasar la lista cerrada de una campaña de empresa al cuadro del sorteo de siempre.
 *
 * Lo que se sella es exactamente lo que la sala va a comprobar: las cuentas anotadas y no quitadas, leídas de la sala (nunca
 * de las filas del panel, que esconden a quien se está quitando), ordenadas por cuenta con la misma función que usa la sala.
 * Los nombres viajan solo como etiquetas locales. Todo lo de afuera (la sala, el cuadro, el reloj) entra por `DepsDelPaso`,
 * para probarlo sin red ni pantalla.
 *
 * Una sola corrida a la vez: si llega otra llamada mientras corre, queda una pendiente y se corre al terminar. Reabrir o
 * dejar la campaña cancela la que está en curso, que no toca nada de lo que ya no le corresponde.
 */
import { type DatosDeAnotada, listaYEtiquetas } from "../campana/lista";
import {
  type SorteoDeCampana,
  conSorteoSinResolver,
} from "../campana/en-curso";
import { type PasoDelPuente, rechazoDelPuente } from "../campana/puente";
import type { Campana } from "../campana/modelo";
import type { DatosDeEquipo } from "../equipos/modelo";
import type { RedDeCampana, SalaDeCampana } from "../sala/campana-org";
import type { EquipoDeSala } from "../sala/cliente";

/** Cómo terminó una corrida del paso. */
export type FinDelPaso =
  | "pasada"
  | "en-espera"
  | "no-leyo"
  | "pocos"
  | "otra-cuenta"
  | "lista-sellada"
  | "otra-red"
  | "version-distinta"
  | "sin-conexion"
  | "cancelada";

/** Lo que el panel le da al paso en cada corrida: la campaña, lo que quien organiza ya dejó mostrar y las quitas en curso. */
export interface ContextoDelPaso {
  campana: Campana;
  mostradas: ReadonlySet<number>;
  /** Los números de quienes se están quitando (en Deshacer o ya mandadas sin confirmar). */
  quitasEnCurso: () => number[];
}

export interface DepsDelPaso {
  ahora: () => number;
  leer: (s: SalaDeCampana) => Promise<EquipoDeSala[] | null>;
  descifrar: (clave: string, d: string) => Promise<DatosDeEquipo | null>;
  /** El nombre y si el filtro lo marcó, de lo descifrado. */
  nombreYFiltro: (datos: DatosDeEquipo) => { nombre: string; revisar: boolean } | null;
  /** La cuenta que la campaña nombra para sellar (`null` si no nombra ninguna), o `null` si no se pudo leer. */
  organizadora: (s: SalaDeCampana) => Promise<{ cuenta: string | null } | null>;
  cuenta: () => string | null;
  /** La red de esta pestaña y el contrato que lee, y el contrato de cada red tal como lo lee la sala. */
  red: () => RedDeCampana;
  contrato: () => string | null;
  contratoDeLaRed: (red: RedDeCampana) => string | null;
  nombreDelModo: (red: RedDeCampana) => string;
  listaBloqueada: () => boolean;
  /** Si el sorteo de la pantalla ya se hizo: entonces el sello no se puede soltar. */
  sorteado: () => boolean;
  listaDelCuadro: () => string[];
  huella: (lineas: readonly string[]) => string;
  modoTurnos: () => boolean;
  ponerModoTurnos: (si: boolean) => void;
  /** Las etiquetas de la lista, con la palabra de lo que cuentan: las de una campaña son de personas. */
  ponerEtiquetas: (e: ReadonlyMap<string, string>, de?: "equipos" | "personas") => void;
  setList: (texto: string) => void;
  ponerPremio: (texto: string) => void;
  ponerGanadores: (n: number) => void;
  fijarPorCampana: (si: boolean) => void;
  entrada: (red: RedDeCampana, evento: string) => SorteoDeCampana | null;
  guardar: (e: SorteoDeCampana) => void;
  persona: (n: number) => string;
  /** El nombre del botón de sellar (cambia si todavía no se entró con una cuenta). */
  botonDeSellar: () => string;
  /** El premio de una campaña, siempre en español y sin separador de miles: así lo lee quien paga el premio. */
  premioEnEspanol: (unidades: bigint) => string;
  esperar: (ms: number) => Promise<void>;
  poner: (p: PasoDelPuente) => void;
}

const INTENTOS_DE_LECTURA = 3;
const ESPERA_ENTRE_LECTURAS_MS = 3_000;

interface Pedido {
  s: SalaDeCampana;
  ctx: ContextoDelPaso;
}

export interface PasoDeLaCampana {
  correr: (s: SalaDeCampana, ctx: ContextoDelPaso) => Promise<FinDelPaso>;
  /** Corta la corrida en curso y descarta la pendiente: no toca más el cuadro ni la entrada. */
  cancelar: () => void;
}

export function crearPaso(d: DepsDelPaso): PasoDeLaCampana {
  let generacion = 0;
  let corriendo: Promise<FinDelPaso> | null = null;
  let pendiente: Pedido | null = null;

  const tomarPendiente = (): Pedido | null => {
    const p = pendiente;
    pendiente = null;
    return p;
  };

  /** Una corrida entera. Todo cambio al cuadro y a la entrada pasa por `vigente`: una corrida cancelada no escribe nada. */
  async function una({ s, ctx }: Pedido, g: number): Promise<FinDelPaso> {
    const vigente = (): boolean => g === generacion;
    const campana = ctx.campana;
    const premios = campana.premios.length;
    const decir = (p: PasoDelPuente, fin: FinDelPaso): FinDelPaso => {
      if (!vigente()) return "cancelada";
      d.poner(p);
      return fin;
    };
    const entradaActual = (): SorteoDeCampana | null => d.entrada(s.red, s.evento);

    // La lista que ya está sellándose o sellada en el cuadro: si es la de esta campaña no se toca nada ni se dice nada.
    const bloqueada = (): FinDelPaso | null => {
      if (!d.listaBloqueada()) return null;
      const e = entradaActual();
      if (e && e.huella === d.huella(d.listaDelCuadro())) return "pasada";
      return decir({ paso: "lista-sellada", soltable: !d.sorteado() }, "lista-sellada");
    };
    const yaBloqueada = bloqueada();
    if (yaBloqueada) return yaBloqueada;

    // La sala es de una red y el sitio lee otra, o lee otro contrato: la sala no encontraría el sorteo y se perdería uno.
    if (s.red !== d.red()) return decir({ paso: "otra-red", modo: d.nombreDelModo(s.red) }, "otra-red");
    const contrato = d.contrato();
    if (contrato === null || contrato !== d.contratoDeLaRed(s.red)) return decir({ paso: "version-distinta" }, "version-distinta");

    decir({ paso: "leyendo" }, "pasada");

    // Quien se está quitando todavía está en la sala: se espera a que la sala lo confirme y se vuelve a leer. Mientras
    // tanto, la lista que hubiera en el cuadro ya no vale, y no puede sellarse con 90 segundos.
    const soltarCuadro = (): void => {
      if (!vigente() || d.listaBloqueada()) return;
      d.setList("");
      const e = entradaActual();
      if (e && !conSorteoSinResolver(e) && e.huella !== "") d.guardar({ ...e, huella: "" });
    };
    if (ctx.quitasEnCurso().length > 0) {
      soltarCuadro();
      return vigente() ? "en-espera" : "cancelada";
    }

    let leidas: EquipoDeSala[] | null = null;
    for (let intento = 0; intento < INTENTOS_DE_LECTURA && leidas === null; intento++) {
      if (intento > 0) await d.esperar(ESPERA_ENTRE_LECTURAS_MS);
      if (!vigente()) return "cancelada";
      leidas = await d.leer(s);
      if (!vigente()) return "cancelada";
    }
    if (leidas === null) return decir({ paso: "no-leyo" }, "no-leyo");

    if (leidas.length < Math.max(2, premios)) return decir({ paso: "pocos", n: Math.max(2, premios) }, "pocos");

    // La campaña puede nombrar con qué cuenta se sella: la sala rechaza otra, y eso cuesta un sorteo.
    const organizadora = await d.organizadora(s);
    if (!vigente()) return "cancelada";
    if (organizadora === null) return decir({ paso: "sin-conexion" }, "sin-conexion");
    const quienSella = organizadora.cuenta;
    if (quienSella !== null && d.cuenta() !== quienSella) {
      // Con otra cuenta no se ofrece sellar: la lista que hubiera en el cuadro se suelta (si no está sellándose).
      soltarCuadro();
      return decir({ paso: "otra-cuenta", fin: quienSella.slice(-4) }, "otra-cuenta");
    }

    const enCurso = new Set(ctx.quitasEnCurso());
    if (enCurso.size > 0 || leidas.some((f) => enCurso.has(f.n))) {
      soltarCuadro();
      return vigente() ? "en-espera" : "cancelada";
    }

    // Los nombres, solo como etiquetas: el que no se puede descifrar queda como Persona y su número de la sala.
    const porCuenta = new Map<string, DatosDeAnotada>();
    for (const fila of leidas) {
      const datos = await d.descifrar(s.clave, fila.d);
      if (!vigente()) return "cancelada";
      const leido = datos ? d.nombreYFiltro(datos) : null;
      porCuenta.set(fila.cuenta, {
        n: fila.n,
        nombre: leido?.nombre ?? "",
        revisar: leido?.revisar ?? false,
        mostrar: ctx.mostradas.has(fila.n),
      });
    }
    const armada = listaYEtiquetas(
      leidas.map((f) => f.cuenta),
      porCuenta,
      d.persona,
    );
    if (!armada) return decir({ paso: "no-leyo" }, "no-leyo");
    if (armada.lineas.length < Math.max(2, premios)) return decir({ paso: "pocos", n: Math.max(2, premios) }, "pocos");

    // Pudo empezar un sello, o una quita, mientras se leía y se descifraba.
    const ahoraBloqueada = bloqueada();
    if (ahoraBloqueada) return ahoraBloqueada;
    if (ctx.quitasEnCurso().length > 0) {
      soltarCuadro();
      return vigente() ? "en-espera" : "cancelada";
    }
    if (!vigente()) return "cancelada";

    // Con el orden de turnos prendido, el premio se cambia al sellar: se apaga antes de poner el premio de la campaña.
    if (d.modoTurnos()) d.ponerModoTurnos(false);
    d.ponerEtiquetas(armada.etiquetas, "personas");
    d.setList(armada.lineas.join("\n"));
    d.ponerPremio(d.premioEnEspanol(campana.premios[0] ?? 0n));
    d.ponerGanadores(premios);
    d.fijarPorCampana(true);
    const huella = d.huella(armada.lineas);
    const previa = entradaActual();
    // Un sorteo que salió hacia la sala sin respuesta definitiva se conserva: es lo que sabe a qué quedó atada la sala.
    const heredado = previa && conSorteoSinResolver(previa) ? previa : {};
    d.guardar({
      ...heredado,
      evento: s.evento,
      red: s.red,
      contrato,
      huella,
      premios,
      organizadora: quienSella,
      pasadaEn: d.ahora(),
    });
    // El motivo del último sello rechazado queda a la vista hasta el próximo sello, en lugar de la línea de siempre.
    const rechazo = rechazoDelPuente();
    return decir(rechazo ?? { paso: "en-el-sorteo", n: armada.lineas.length }, "pasada");
  }

  return {
    correr(s, ctx) {
      if (corriendo) {
        pendiente = { s, ctx };
        return corriendo;
      }
      const corrida = (async (): Promise<FinDelPaso> => {
        let fin: FinDelPaso = "pasada";
        let siguiente: Pedido | null = { s, ctx };
        while (siguiente) {
          fin = await una(siguiente, generacion);
          siguiente = tomarPendiente();
        }
        return fin;
      })().finally(() => {
        corriendo = null;
      });
      corriendo = corrida;
      return corrida;
    },
    cancelar() {
      generacion++;
      pendiente = null;
    },
  };
}
