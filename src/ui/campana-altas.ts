/**
 * Avisa al servicio que da el acceso qué cuentas ganaron, para que puedan activarse y recibir su premio sin cupón.
 *
 * Sale de la lista sellada y del resultado que la sala confirmó (nunca del cuadro de la pantalla ni de un campo editable),
 * de a una cuenta por vez y en orden de puesto, y solo con la sesión de Google de quien organiza. Nada de esto frena el pago
 * del premio ni el aviso a los celulares. Todo lo de afuera entra por `DepsDeLasAltas`, para probarlo sin red ni reloj.
 *
 * Cada puesto termina en un estado final o queda para reintentar: la fila lo dice (`cpoPuedeRecibir`, `cpoNoSePudo`) y
 * ofrece Probar de nuevo solo cuando probar de nuevo puede cambiar algo.
 */
import type { EstadoDeAltaPremio } from "../campana/en-curso";
import type { ResultadoDeAltaPremio } from "../stellar/alta-api";

export interface DepsDeLasAltas {
  /** El token de la sesión de Google de quien organiza, o `null` si entró con otra billetera. Nunca se muestra ni se guarda. */
  token: () => Promise<string | null>;
  /** Si el servicio atiende hoy el alta de quien ganó (`/cupo`). `null`: no se pudo saber, que no es lo mismo que apagado. */
  abierta: () => Promise<boolean | null>;
  admitir: (token: string, p: { sorteo: string; puesto: number; cuenta: string }) => Promise<ResultadoDeAltaPremio>;
  ahora: () => number;
  esperar: (ms: number) => Promise<void>;
  /** Lo que se recuerda por puesto, para retomar después de una recarga. */
  estados: () => Record<string, EstadoDeAltaPremio>;
  guardar: (puesto: number, estado: EstadoDeAltaPremio) => void;
}

/** Cuánto se espera antes de cada reintento de un fallo de red, del servicio de la cuenta o de los topes. */
const ESPERAS_MS = [2_000, 5_000, 10_000] as const;
/** La grabación del sorteo va aparte: el servicio contesta `sin-sortear` hasta que entra. Se vuelve a probar cada tanto. */
const ESPERA_SIN_SORTEAR_MS = 10_000;
const VIDA_SIN_SORTEAR_MS = 120_000;
const ESPERA_MINIMA_MS = 2_000;
const ESPERA_MAXIMA_MS = 60_000;

/** Los motivos con los que reintentar no cambia nada: el servicio dijo que no, y dirá lo mismo. */
const FINALES: readonly string[] = ["no-es-nuestro", "sin-acceso", "sorteo-ajeno", "forma", "puesto", "puesto-usado", "cuenta-de-otro", "otra-app"];
const DE_RED: readonly string[] = ["red", "pollar"];
const DE_TOPE: readonly string[] = ["intentos", "cupo-ip"];

export function esFinal(e: EstadoDeAltaPremio | undefined): boolean {
  return e !== undefined && (e.estado === "puede" || e.estado === "apagado" || (e.estado === "fallo" && e.final === true));
}

export interface AltasDelSorteo {
  /** Avisa los puestos que todavía no tienen un estado final, de a uno y en orden. Una sola corrida a la vez. */
  iniciar: (sorteo: string, ganadoras: readonly string[], alCambiar: () => void) => Promise<void>;
  /** Vuelve a probar un puesto que no salió. */
  reintentar: (puesto: number) => Promise<void>;
  /** Vuelve a probar los puestos que esperaban a que la grabación del sorteo entrara. */
  alGuardarElSorteo: () => void;
}

export function crearAltas(d: DepsDeLasAltas): AltasDelSorteo {
  let corriendo: Promise<void> | null = null;
  let actual: { sorteo: string; ganadoras: readonly string[]; alCambiar: () => void } | null = null;
  /** Despierta la espera de un puesto que contestó sin-sortear: la grabación del sorteo ya entró. */
  let alGrabar: (() => void) | null = null;

  const poner = (puesto: number, e: EstadoDeAltaPremio): void => {
    d.guardar(puesto, e);
    actual?.alCambiar();
  };

  /** Un puesto, con sus reintentos. */
  async function alta(token: string, sorteo: string, puesto: number, cuenta: string): Promise<void> {
    let reintentos = 0;
    const desde = d.ahora();
    for (;;) {
      const r = await d.admitir(token, { sorteo, puesto, cuenta });
      if ("estado" in r) return poner(puesto, { estado: "puede" });
      if (r.error === "apagado") return poner(puesto, { estado: "apagado" });
      if (FINALES.includes(r.error)) return poner(puesto, { estado: "fallo", motivo: r.error, final: true });
      if (r.error === "sin-sortear") {
        if (d.ahora() - desde >= VIDA_SIN_SORTEAR_MS) return poner(puesto, { estado: "fallo", motivo: r.error });
        await Promise.race([
          d.esperar(ESPERA_SIN_SORTEAR_MS),
          new Promise<void>((seguir) => {
            alGrabar = seguir;
          }),
        ]);
        alGrabar = null;
        continue;
      }
      const reintentable = DE_RED.includes(r.error) || DE_TOPE.includes(r.error);
      const espera = ESPERAS_MS[reintentos];
      if (!reintentable || espera === undefined) return poner(puesto, { estado: "fallo", motivo: r.error });
      reintentos++;
      const hasta = r.error === "intentos" || r.error === "cupo-ip" ? (r.reintentarEn ?? 0) - d.ahora() : espera;
      await d.esperar(Math.min(ESPERA_MAXIMA_MS, Math.max(ESPERA_MINIMA_MS, hasta)));
    }
  }

  /** Pregunta a `/cupo` con los mismos reintentos que un pedido de alta: un corte no deja a nadie sin su acceso. */
  async function saberSiEstaAbierta(): Promise<boolean | null> {
    for (let reintentos = 0; ; reintentos++) {
      const r = await d.abierta();
      const espera = ESPERAS_MS[reintentos];
      if (r !== null || espera === undefined) return r;
      await d.esperar(espera);
    }
  }

  async function correr(sorteo: string, ganadoras: readonly string[], soloPuesto?: number): Promise<void> {
    const token = await d.token();
    // Con otra billetera no hay sesión de Google: cero llamadas, y el resultado dice que se avise a Tinkazo.
    if (token === null) return;
    const estados = d.estados();
    const pendientes = ganadoras.map((_, i) => i).filter((i) => (soloPuesto === undefined ? !esFinal(estados[String(i)]) : i === soloPuesto));
    if (pendientes.length === 0) return;
    const abierta = await saberSiEstaAbierta();
    // El servicio dijo que no atiende el alta: no hay nada que mostrar, y no se recuerda como final, así que al recargar se
    // vuelve a preguntar (puede haberse prendido). Si no se pudo saber, cada puesto queda para reintentar.
    if (abierta === false) return;
    if (abierta === null) {
      for (const puesto of pendientes) poner(puesto, { estado: "fallo", motivo: "red" });
      return;
    }
    for (const puesto of pendientes) {
      const cuenta = ganadoras[puesto];
      if (cuenta === undefined) continue;
      // El token se pide de nuevo en cada puesto: la sesión puede haberse renovado mientras tanto.
      const fresco = (await d.token()) ?? token;
      await alta(fresco, sorteo, puesto, cuenta);
    }
  }

  const iniciar = (sorteo: string, ganadoras: readonly string[], alCambiar: () => void): Promise<void> => {
    actual = { sorteo, ganadoras, alCambiar };
    if (corriendo) return corriendo;
    const corrida = correr(sorteo, ganadoras).finally(() => {
      corriendo = null;
    });
    corriendo = corrida;
    return corrida;
  };

  return {
    iniciar,
    async reintentar(puesto) {
      if (!actual) return;
      const { sorteo, ganadoras } = actual;
      await correr(sorteo, ganadoras, puesto);
    },
    alGuardarElSorteo() {
      // Un puesto que esperaba la grabación vuelve a probarse apenas el sorteo queda grabado, sin esperar a su reloj.
      if (alGrabar) return alGrabar();
      if (!actual || corriendo) return;
      const sinGrabar = Object.values(d.estados()).some((e) => e.estado === "fallo" && e.motivo === "sin-sortear");
      if (sinGrabar) void iniciar(actual.sorteo, actual.ganadoras, actual.alCambiar);
    },
  };
}
