/**
 * Cómo nace la sala de una campaña firmada, sin depender de Cloudflare: lo que habla con los objetos entra como un
 * puerto, así se prueba en Node. `index.ts` lo usa con los objetos de verdad.
 *
 * El permiso del evento se da en dos tiempos. Se reserva antes de crear la sala y se confirma, con su id, recién cuando la
 * sala quedó creada. Si la creación falla se suelta la reserva. Un evento cuya reserva nunca llegó a confirmarse se vuelve a
 * usar con el mismo archivo firmado. Uno cuya sala se cerró o venció, también, pero solo presentando el token de esa sala:
 * el archivo firmado es público desde que la sala existe, y sin esa condición cualquiera que lo copió se quedaría con el
 * evento (y con un token nuevo) apenas quien organiza cierra por error. Mientras la sala vive, un segundo pedido no crea
 * otra ni recibe el token de quien organiza.
 *
 * Si quien organiza inventa el token y lo manda con el pedido (`propio`), repetir el pedido es seguro: cuando la respuesta
 * se perdió por el camino, el segundo pedido trae el mismo token, la sala viva lo reconoce por su huella y vuelve a
 * entregar esa misma sala. Sin ese token, el evento quedaría con una sala viva y sin dueño hasta que venza.
 */
import type { CampanaFirmada, ReemplazoDeSala, ReservaDeEvento } from "./campana";

/** Lo que se le pide al objeto de cupos. */
export interface PuertoDeCupos {
  reservarCampana(evento: string, reemplazo: ReemplazoDeSala | null): Promise<ReservaDeEvento>;
  /** Confirma la sala creada. Con el archivo firmado: de él salen la dueña del evento y la fila de Tus campañas. */
  confirmarCampana(evento: string, reserva: string, sala: string, huella: string, c: CampanaFirmada): Promise<boolean>;
  /** La sala confirmada del evento si su token tiene esta huella, con el instante en que se reservó. */
  salaDelIntento(evento: string, huella: string): Promise<{ sala: string; enMs: number } | null>;
  soltarCampana(evento: string, reserva: string): Promise<void>;
}

/** Lo que se le pide a las salas, por su id. */
export interface PuertoDeSalas {
  viva(id: string): Promise<boolean>;
  crearCampana(id: string, huella: string, c: CampanaFirmada, vida: number): Promise<boolean>;
  /** Cierra una sala con su token. */
  cerrar(id: string, token: string): Promise<unknown>;
}

export type CreacionDeCampana =
  | { ok: true; id: string; /** Si ya estaba creada: cuándo, para que `vence` sea el de esa sala y no uno nuevo. */ creadaEn: number | null }
  | { ok: false; motivo: "ya-existe" | "cupo-campanas" | "ocupado" };

/** Ids distintos que se prueban antes de rendirse: uno ocupado es rarísimo, cinco seguidos es un problema. */
export const INTENTOS_DE_ID = 5;

export async function crearSalaDeCampana(a: {
  cupos: PuertoDeCupos;
  salas: PuertoDeSalas;
  c: CampanaFirmada;
  vida: number;
  /** El token de quien organiza, ya inventado: acá solo se guarda su huella. */
  token: string;
  /** Si el token lo inventó quien organiza y vino en el pedido: solo entonces repetir el pedido devuelve la misma sala. */
  propio: boolean;
  /** El token de la sala anterior del evento que presentó quien pide, o null: solo con él se reemplaza una sala muerta. */
  anterior: string | null;
  huellaDe: (token: string) => Promise<string>;
  nuevoId: () => string;
}): Promise<CreacionDeCampana> {
  let permiso = await a.cupos.reservarCampana(a.c.evento, null);
  if (!permiso.ok && permiso.motivo === "ya-existe" && permiso.sala !== null && a.propio) {
    // El pedido de antes sí creó la sala y la respuesta no llegó: con el mismo token, es la misma persona y la misma sala.
    const previa = await a.cupos.salaDelIntento(a.c.evento, await a.huellaDe(a.token));
    if (previa && (await a.salas.viva(previa.sala))) return { ok: true, id: previa.sala, creadaEn: previa.enMs };
  }
  if (!permiso.ok && permiso.motivo === "ya-existe" && permiso.sala !== null && a.anterior !== null) {
    // Si la sala del evento ya no existe, quien trae su token toma su lugar con el mismo archivo firmado. Sin token, ni se
    // mira: la respuesta es la misma que con la sala viva y no dice nada de ella.
    if (!(await a.salas.viva(permiso.sala))) {
      const reemplazo = { sala: permiso.sala, huella: await a.huellaDe(a.anterior) };
      permiso = await a.cupos.reservarCampana(a.c.evento, reemplazo);
    }
  }
  if (!permiso.ok) return { ok: false, motivo: permiso.motivo };
  const huella = await a.huellaDe(a.token);
  let creada: string | null = null;
  try {
    for (let intento = 0; intento < INTENTOS_DE_ID && creada === null; intento++) {
      const id = a.nuevoId();
      if (await a.salas.crearCampana(id, huella, a.c, a.vida)) creada = id;
    }
  } catch {
    // Un corte al crear cuenta como no creada: el permiso se deshace y no queda nada reservado.
    creada = null;
  }
  if (creada === null) {
    await a.cupos.soltarCampana(a.c.evento, permiso.reserva);
    return { ok: false, motivo: "ocupado" };
  }
  if (!(await a.cupos.confirmarCampana(a.c.evento, permiso.reserva, creada, huella, a.c))) {
    // Otro pedido tomó el evento mientras tanto: esta sala sobra y su token no se entrega.
    await a.salas.cerrar(creada, a.token);
    return { ok: false, motivo: "ya-existe" };
  }
  return { ok: true, id: creada, creadaEn: null };
}
