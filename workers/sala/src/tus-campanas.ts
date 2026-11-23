/**
 * Tus campañas desde cualquier navegador: las dos rutas de la sala que le dicen a una cuenta cuáles son sus campañas
 * (`POST /v1/mis-campanas`) y le dan una para usar en esta compu (`POST /v1/campana/recuperar`). No depende de Cloudflare: lo
 * que habla con los objetos entra como un puerto, así se prueba en Node. `index.ts` lo arma con los objetos de verdad.
 *
 * Quién puede: solo una sesión que el proveedor verifica, que entró por Google y cuya cuenta es la dueña del evento. La cuenta
 * sale siempre del proveedor, nunca del pedido. Un evento ajeno, uno que no existe y uno que ya venció contestan lo mismo.
 * La clave que descifra los nombres nunca pasa por acá: no la tiene el servidor. Tampoco sale nunca el id de una sala que no
 * se entrega con una toma, ni el texto firmado de la lista.
 */
import { verificarCuentaDeCampanas } from "./activar";
import type { DepsDeCuenta, RespuestaDeActivar } from "./activar";
import type { FichaDeCampana, FilaDeLaLista, PreparacionDeToma } from "./activar-cupos";
import { ESPERA_RESERVA_MS, ES_EVENTO_CAMPANA } from "./campana";
import type { Fase } from "./campana";

/** El pedido de estas rutas pesa poco: la sesión mide hasta 4.096 caracteres. */
export const MAX_CUERPO_TUS_CAMPANAS = 6_000;
/** Cuántas campañas trae la lista como mucho. */
export const MAX_CAMPANAS_EN_LA_LISTA = 20;

/** Las dos rutas atienden solo con la variable en "1". Cambiarla es publicar otra vez: no es un botón para un evento en curso. */
export function tusCampanasPrendido(env: { TUS_CAMPANAS?: string }): boolean {
  return env.TUS_CAMPANAS === "1";
}

const error = (estado: number, codigo: string, extra: Record<string, unknown> = {}): RespuestaDeActivar => ({
  estado,
  cuerpo: { error: codigo, ...extra },
});

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Lo que dice la sala de sí misma cuando se le pregunta por la lista. Sin el texto, el id ni el token. */
export type ResumenDeSala =
  | { viva: false }
  | { viva: true; fase: Fase; total: number; organizadora: string | null };

/** Lo que la lista le pide a una sala. */
export interface SalaParaLaLista {
  resumenDeCampana(): Promise<ResumenDeSala>;
}

/** Lo que la toma le pide a una sala. */
export interface SalaParaLaToma {
  viva(): Promise<boolean>;
  cambiarToken(
    cuenta: string,
    huellaNueva: string,
    gen: number,
  ): Promise<{ ok: true; fase: Fase; vence: number } | { ok: false; motivo: string }>;
}

/** Lo que las rutas le piden al objeto de cupos. */
export interface CuposParaTus {
  campanasDeCuenta(cuenta: string): Promise<FilaDeLaLista[]>;
  campanaDeCuenta(cuenta: string, evento: string): Promise<FichaDeCampana | null>;
  prepararToma(cuenta: string, evento: string, huellaNueva: string): Promise<PreparacionDeToma>;
  confirmarToma(evento: string, gen: number): Promise<boolean>;
  reescribirHuella(evento: string, sala: string, huella: string): Promise<boolean>;
  /** Si toca mandar el aviso de esta toma (uno cada 10 minutos por campaña). Solo se pregunta si el aviso está prendido. */
  reservarCorreoDeToma(evento: string): Promise<boolean>;
}

export interface DepsDeTus {
  verificar: DepsDeCuenta;
  cupos: CuposParaTus;
  sala(id: string): SalaParaLaLista & SalaParaLaToma;
  /** Mira las salas anteriores a la dueña, antes de leer (ver `barrerSalasViejas`). */
  barrer(): Promise<unknown>;
  /** Un token de sala nuevo: 22 caracteres al azar. */
  nuevoToken(): string;
  huellaDe(token: string): Promise<string>;
  /** Si el aviso por correo de cada toma está prendido. */
  avisoDeTomaPrendido: boolean;
}

/** El pedido de quien organiza: la sesión y, para usar una campaña, el evento. */
export type PedidoDeTus =
  | { ok: true; sesion: string; evento: string | null }
  | { ok: false; respuesta: RespuestaDeActivar };

/**
 * Lee el cuerpo. Sin JSON o sin `sesion` de texto es 400; un evento con otra forma, 400 con el campo `evento`. La forma de
 * la sesión como token no se mira acá: sin forma de sesión de tres partes es 401 y no cuenta contra nadie (`verificarCuentaDeCampanas`).
 */
export function leerPedidoDeTus(cuerpo: unknown, conEvento: boolean): PedidoDeTus {
  if (!esObjeto(cuerpo)) return { ok: false, respuesta: error(400, "forma", { campo: "cuerpo" }) };
  if (typeof cuerpo.sesion !== "string") return { ok: false, respuesta: error(400, "forma", { campo: "sesion" }) };
  if (!conEvento) return { ok: true, sesion: cuerpo.sesion, evento: null };
  if (typeof cuerpo.evento !== "string" || !ES_EVENTO_CAMPANA.test(cuerpo.evento)) {
    return { ok: false, respuesta: error(400, "forma", { campo: "evento" }) };
  }
  return { ok: true, sesion: cuerpo.sesion, evento: cuerpo.evento };
}

/* ------------------------------------------------------------------------ la lista */

export type EstadoDeLaCampana = "viva" | "activada" | "terminada";

export interface CampanaDeLaLista {
  evento: string;
  empresa: string;
  zona: string;
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  estado: EstadoDeLaCampana;
  fase?: Fase;
  total?: number;
}

const ORDEN: Record<EstadoDeLaCampana, number> = { viva: 0, activada: 1, terminada: 2 };

/**
 * `POST /v1/mis-campanas`. El estado se calcula en este orden y la sala viva siempre gana: `viva` si el evento tiene una sala
 * viva cuya organizadora es esta cuenta (con su fase y cuántas personas hay), `terminada` si el evento se selló o no hay sala
 * viva y el cierre ya pasó, y `activada` si no hay sala viva y el cierre está por delante. Una sala viva que nombra a otra
 * cuenta, o a ninguna, no sale. Primero las vivas, después las activadas por hora de apertura y al final las terminadas, las
 * más nuevas primero. Hasta 20. Nunca devuelve el texto firmado, la firma, el id de la sala ni su token.
 */
export async function listarCampanas(sesion: string, d: DepsDeTus): Promise<RespuestaDeActivar> {
  const quien = await verificarCuentaDeCampanas(sesion, "listado", d.verificar);
  if (!quien.ok) return quien.respuesta;
  await d.barrer();
  const filas = await d.cupos.campanasDeCuenta(quien.cuenta);
  // Las salas que pueden estar vivas son las creadas en las últimas 24 horas: se miran las 20 más nuevas, en paralelo.
  const conSala = filas
    .filter((f): f is FilaDeLaLista & { sala: string } => f.sala !== null)
    .sort((a, b) => (b.salaEnMs ?? 0) - (a.salaEnMs ?? 0))
    .slice(0, MAX_CAMPANAS_EN_LA_LISTA);
  const resumenes = new Map<string, ResumenDeSala>();
  await Promise.all(
    conSala.map(async (f) => {
      resumenes.set(f.evento, await d.sala(f.sala).resumenDeCampana());
    }),
  );
  const lista: CampanaDeLaLista[] = [];
  for (const f of filas) {
    const base = { evento: f.evento, empresa: f.empresa, zona: f.zona, abreMs: f.abreMs, cierraMs: f.cierraMs, sorteoMs: f.sorteoMs };
    const resumen = resumenes.get(f.evento);
    if (resumen?.viva) {
      // Una sala viva de otra organizadora, o de ninguna, no es de esta cuenta: ni se nombra.
      if (resumen.organizadora === quien.cuenta) lista.push({ ...base, estado: "viva", fase: resumen.fase, total: resumen.total });
      continue;
    }
    lista.push({ ...base, estado: f.sellado || f.cierraMs <= d.verificar.ahora ? "terminada" : "activada" });
  }
  lista.sort((a, b) => {
    if (a.estado !== b.estado) return ORDEN[a.estado] - ORDEN[b.estado];
    return a.estado === "terminada" ? b.sorteoMs - a.sorteoMs : a.abreMs - b.abreMs;
  });
  return { estado: 200, cuerpo: { campanas: lista.slice(0, MAX_CAMPANAS_EN_LA_LISTA) } };
}

/* -------------------------------------------------------------------- usar en esta compu */

/** Lo que hace falta para avisarle por correo a quien organiza que su campaña se abrió en otra compu. Sin la dirección. */
export interface AvisoDeToma {
  evento: string;
  empresa: string;
  zona: string;
  ahora: number;
}

export interface ResultadoDeRecuperar {
  respuesta: RespuestaDeActivar;
  /** Solo después de una toma buena, con el aviso prendido y sin otro aviso de esta campaña en los últimos 10 minutos. */
  aviso?: AvisoDeToma;
}

const sinAviso = (respuesta: RespuestaDeActivar): ResultadoDeRecuperar => ({ respuesta });

/**
 * `POST /v1/campana/recuperar`. Con la sesión verificada y los topes por cuenta, busca la campaña de la cuenta y mira su
 * evento (`FichaDeCampana`):
 *
 * - Sin sala y sin reserva, o con una reserva vieja que nunca se confirmó: `terminada` si el evento se selló o el cierre pasó, y
 *   si no, `activada` con el texto y la firma. El sitio crea la sala por el camino de siempre.
 * - Con una reserva reciente: `ocupado`, se está creando la sala.
 * - Con una sala viva: la toma. Cambia el token y deja sin efecto el anterior (ver `tomar`).
 * - Con una sala muerta: `terminada` si el evento se selló o el cierre pasó. Si la dueña que guardó la sala no es esta
 *   cuenta (también si no hay dueña), `no-existe`. Si no, `activada` con el texto, la firma y `anterior`, el token con el que se
 *   reemplaza esa sala sin pedir el viejo.
 */
export async function recuperarCampana(sesion: string, evento: string, d: DepsDeTus): Promise<ResultadoDeRecuperar> {
  const quien = await verificarCuentaDeCampanas(sesion, "toma", d.verificar);
  if (!quien.ok) return sinAviso(quien.respuesta);
  await d.barrer();
  const cuenta = quien.cuenta;
  const ficha = await d.cupos.campanaDeCuenta(cuenta, evento);
  if (ficha === null) return sinAviso(error(404, "no-existe"));
  const ahora = d.verificar.ahora;
  const terminada = ficha.sellado || ficha.cierraMs <= ahora;

  if (!ficha.hayFila || (ficha.sala === null && ahora - (ficha.enMs ?? 0) >= ESPERA_RESERVA_MS)) {
    return sinAviso(terminada ? error(409, "terminada") : { estado: 200, cuerpo: { estado: "activada", texto: ficha.texto, firma: ficha.firma } });
  }
  if (ficha.sala === null) return sinAviso(error(409, "ocupado"));

  if (await d.sala(ficha.sala).viva()) return tomar(cuenta, evento, ficha, ficha.sala, d);
  return sinAviso(await ofrecerSalaMuerta(cuenta, evento, ficha, ficha.sala, terminada, d));
}

/** La rama de la sala muerta: se la libera con un token nuevo si es de esta cuenta y el evento sigue en pie. */
async function ofrecerSalaMuerta(
  cuenta: string,
  evento: string,
  ficha: FichaDeCampana,
  sala: string,
  terminada: boolean,
  d: DepsDeTus,
): Promise<RespuestaDeActivar> {
  if (terminada) return error(409, "terminada");
  if (ficha.duena !== cuenta) return error(404, "no-existe");
  const anterior = d.nuevoToken();
  if (!(await d.cupos.reescribirHuella(evento, sala, await d.huellaDe(anterior)))) return error(409, "ocupado");
  return { estado: 200, cuerpo: { estado: "activada", texto: ficha.texto, firma: ficha.firma, anterior } };
}

/**
 * La toma de una sala viva, sin carreras: `prepararToma` (dueña, pausa de 60 segundos, generación), `cambiarToken` en la sala y
 * `confirmarToma`. Si la sala dice que no existe porque murió en el medio, se sigue por la rama de la sala muerta. Si dice que
 * no existe y sigue viva, es que nombra a otra cuenta: `no-existe`, y el token no cambió.
 */
async function tomar(cuenta: string, evento: string, ficha: FichaDeCampana, id: string, d: DepsDeTus): Promise<ResultadoDeRecuperar> {
  const token = d.nuevoToken();
  const huella = await d.huellaDe(token);
  const preparada = await d.cupos.prepararToma(cuenta, evento, huella);
  if (!preparada.ok) {
    if (preparada.motivo === "pausa") return sinAviso({ ...error(429, "pausa"), esperaS: preparada.esperaS });
    return sinAviso(error(404, "no-existe"));
  }
  const sala = d.sala(id);
  const r = await sala.cambiarToken(cuenta, huella, preparada.gen);
  if (!r.ok) {
    if (r.motivo === "sellada") return sinAviso(error(409, "sellada"));
    if (r.motivo === "no-existe") {
      if (!(await sala.viva())) {
        const terminada = ficha.sellado || ficha.cierraMs <= d.verificar.ahora;
        return sinAviso(await ofrecerSalaMuerta(cuenta, evento, ficha, id, terminada, d));
      }
      return sinAviso(error(404, "no-existe"));
    }
    // `vieja`: otra toma ganó. `forma`: no pasa con lo que se manda. En los dos casos, esta toma no se hizo.
    return sinAviso(error(409, "ocupado"));
  }
  if (!(await d.cupos.confirmarToma(evento, preparada.gen))) return sinAviso(error(409, "ocupado"));
  const respuesta: RespuestaDeActivar = { estado: 200, cuerpo: { estado: "viva", id, token, vence: r.vence, fase: r.fase } };
  if (d.avisoDeTomaPrendido && (await d.cupos.reservarCorreoDeToma(evento))) {
    return { respuesta, aviso: { evento, empresa: ficha.empresa, zona: ficha.zona, ahora: d.verificar.ahora } };
  }
  return { respuesta };
}
