import { generarClave } from "./cifra";

/**
 * La sala, vista desde la pantalla del stand: crear la sala, recibir los
 * nombres cifrados por WebSocket (o consultando cada 3 s si se corta), quitar
 * uno y cerrar la sala. Habla con `workers/sala` (`s.tinkazo.app`).
 *
 * Solo alimenta rondas de ejemplo: lo que llega acá nunca va a un sorteo sellado.
 * La clave que descifra no pasa nunca por el servicio: la genera esta pestaña y
 * va en el QR, después del `#`.
 */

export const SERVICIO = "https://s.tinkazo.app";
/** Cada cuánto se consulta mientras el WebSocket está caído. */
export const SONDEO_MS = 3_000;
/** Cada cuánto se intenta reabrir el WebSocket cuando se cortó. */
export const REINTENTO_MS = 8_000;

/** El servicio que se usa: el de siempre, y en local (`localhost`) el que diga `?sala=` para probar con `wrangler dev`. */
export function servicioDeSala(): string {
  try {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      const otro = new URLSearchParams(location.search).get("sala");
      if (otro && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(otro)) return otro;
    }
  } catch {
    /* sin location (pruebas en Node) */
  }
  return SERVICIO;
}

export interface Sala {
  id: string;
  token: string;
  clave: string;
  /** Cuándo se borra sola (ms desde 1970). */
  vence: number;
  servicio: string;
}

/** Lo que se muestra en el QR: la página del celular, con la clave después del `#`. */
export const enlaceDeSala = (s: Pick<Sala, "id" | "clave" | "servicio">): string => `${s.servicio}/${s.id}#${s.clave}`;

export interface Dependencias {
  fetch?: typeof fetch;
  /** Abre un WebSocket (en las pruebas, uno falso). */
  socket?: (url: string) => WebSocket;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/** Crea la sala. Falla con el motivo del servicio (`cupo-ip`, `cupo-dia`, `red`…). */
export async function crearSala(dep: Dependencias = {}, servicio = servicioDeSala()): Promise<Sala> {
  const f = dep.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(`${servicio}/v1/sala`, { method: "POST" });
  } catch {
    throw new Error("red");
  }
  if (r.status !== 201) {
    const motivo = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "otro";
    throw new Error(motivo);
  }
  const { id, token, vence } = (await r.json()) as { id: string; token: string; vence: number };
  return { id, token, vence, clave: generarClave(), servicio };
}

const auth = (s: Sala): HeadersInit => ({ Authorization: `Bearer ${s.token}` });

/** Saca un nombre del objeto. `true` si el servicio lo confirmó (o la sala ya no estaba). */
export async function quitarNombreEnSala(s: Sala, n: number, dep: Dependencias = {}): Promise<boolean> {
  try {
    const r = await (dep.fetch ?? fetch)(`${s.servicio}/v1/sala/${s.id}/nombres/${n}`, { method: "DELETE", headers: auth(s) });
    return r.status === 204 || r.status === 404;
  } catch {
    return false;
  }
}

/** Cierra la sala y borra todo lo que tenía. `true` si quedó cerrada (o ya no estaba). */
export async function cerrarSala(s: Sala, dep: Dependencias = {}): Promise<boolean> {
  try {
    const r = await (dep.fetch ?? fetch)(`${s.servicio}/v1/sala/${s.id}`, { method: "DELETE", headers: auth(s) });
    return r.status === 204 || r.status === 404;
  } catch {
    return false;
  }
}

export type EstadoDeConexion = "conectando" | "en-vivo" | "sondeo";

export interface Escucha {
  /** Llegó un nombre cifrado (nuevo, o al volver a pedir los que ya había). Cada `n` se avisa una sola vez. */
  alNombre: (n: number, dato: string) => void;
  /** Alguien lo quitó (desde otra pestaña): ya no tiene que verse. */
  alQuitado?: (n: number) => void;
  alEstado?: (e: EstadoDeConexion) => void;
  /** La sala se cerró o venció: no hay más que escuchar. */
  alCerrada?: () => void;
  /**
   * Un equipo nuevo, o uno que cambió (sus datos o su estado). Cada versión `v` se avisa una sola vez. Solo se pide
   * a la sala si se pasa esto: el modo stand de los nombres no lo usa.
   */
  alEquipo?: (e: EquipoDeSala) => void;
  /** Un equipo se quitó (desde otra pestaña). */
  alEquipoQuitado?: (n: number) => void;
}

/** Un equipo tal como lo guarda la sala: la cuenta en claro y el resto cifrado con la clave del QR. */
export interface EquipoDeSala {
  n: number;
  cuenta: string;
  d: string;
  estado: string;
  /** Sube con cada cambio del equipo en la sala. */
  v: number;
}

/**
 * Escucha la sala. Abre el WebSocket y, si se corta o no abre, consulta cada
 * 3 s lo que falta y vuelve a intentarlo cada 8 s. Al reconectar pide todo lo
 * que no vio, así que no se pierde ningún nombre. Devuelve cómo parar.
 */
export function escucharSala(s: Sala, e: Escucha, dep: Dependencias = {}, vistos: Iterable<number> = []): { parar: () => void; consultar: () => Promise<void> } {
  const f = dep.fetch ?? fetch;
  const abrir = dep.socket ?? ((url: string) => new WebSocket(url));
  const poner = dep.setTimeout ?? setTimeout;
  const sacar = dep.clearTimeout ?? clearTimeout;
  const visto = new Set<number>(vistos);
  let ultimo = Math.max(0, ...visto);
  let parado = false;
  let estado: EstadoDeConexion = "conectando";
  let ws: WebSocket | null = null;
  let sondeo: ReturnType<typeof setTimeout> | undefined;
  let reintento: ReturnType<typeof setTimeout> | undefined;

  const cambiar = (nuevo: EstadoDeConexion): void => {
    if (estado === nuevo) return;
    estado = nuevo;
    e.alEstado?.(nuevo);
  };
  const recibir = (n: number, d: string): void => {
    if (visto.has(n)) return;
    visto.add(n);
    ultimo = Math.max(ultimo, n);
    e.alNombre(n, d);
  };
  const cerrada = (): void => {
    if (parado) return;
    parar();
    e.alCerrada?.();
  };
  /**
   * Lo más nuevo que trajo una consulta: la sala manda solo lo que cambió desde esa versión. Los mensajes del
   * socket no la mueven: uno que llega antes que la primera consulta no puede tapar a los equipos anteriores.
   */
  let desdeV = 0;
  /** La última versión que se avisó de cada equipo, para no repetir lo que ya llegó por el otro camino. */
  const versionDe = new Map<number, number>();
  const recibirEquipo = (x: EquipoDeSala): void => {
    if ((versionDe.get(x.n) ?? 0) >= x.v) return;
    versionDe.set(x.n, x.v);
    e.alEquipo?.(x);
  };

  /** Pide lo que falta. Sirve para recargar la pantalla, para el sondeo y para ponerse al día al reconectar. */
  const consultar = async (): Promise<void> => {
    if (parado) return;
    try {
      const r = await f(`${s.servicio}/v1/sala/${s.id}/nombres?desde=${ultimo}`, { headers: auth(s) });
      if (r.status === 404) return cerrada();
      if (!r.ok) return;
      for (const x of (await r.json()) as { n: number; d: string }[]) recibir(x.n, x.d);
      if (e.alEquipo) {
        const q = await f(`${s.servicio}/v1/sala/${s.id}/equipos?desde=${desdeV}`, { headers: auth(s) });
        if (q.status === 404) return cerrada();
        if (q.ok) {
          for (const x of (await q.json()) as EquipoDeSala[]) {
            desdeV = Math.max(desdeV, x.v);
            recibirEquipo(x);
          }
        }
      }
    } catch {
      /* sin red: se vuelve a intentar */
    }
  };

  const sondear = (): void => {
    if (parado || estado === "en-vivo") return;
    void consultar().finally(() => {
      if (!parado && estado !== "en-vivo") sondeo = poner(sondear, SONDEO_MS);
    });
  };

  const conectar = (): void => {
    if (parado) return;
    cambiar("conectando");
    let abierto = false;
    let socket: WebSocket;
    try {
      socket = abrir(`${s.servicio.replace(/^http/, "ws")}/v1/sala/${s.id}/pantalla`);
    } catch {
      return caer();
    }
    ws = socket;
    socket.addEventListener("open", () => {
      abierto = true;
      socket.send(JSON.stringify({ t: "hola", token: s.token }));
    });
    socket.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      let m: { t?: string; n?: number; d?: string; v?: number; cuenta?: string; estado?: string };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "listo") {
        cambiar("en-vivo");
        void consultar();
      } else if (m.t === "nombre" && typeof m.n === "number" && typeof m.d === "string") recibir(m.n, m.d);
      else if (m.t === "quitado" && typeof m.n === "number") e.alQuitado?.(m.n);
      else if (m.t === "equipo" && typeof m.n === "number" && typeof m.d === "string" && typeof m.v === "number" && typeof m.cuenta === "string" && typeof m.estado === "string")
        recibirEquipo({ n: m.n, cuenta: m.cuenta, d: m.d, estado: m.estado, v: m.v });
      else if (m.t === "equipo-quitado" && typeof m.n === "number") e.alEquipoQuitado?.(m.n);
    });
    socket.addEventListener("close", (ev: CloseEvent) => {
      if (ws !== socket) return;
      // 1000 es «cerrada» o «vencida»; 4000 es otra pantalla de la misma sala: esta no vuelve a pelear por ella.
      if (ev.code === 1000 && abierto) return cerrada();
      if (ev.code === 4000) return cambiar("sondeo");
      caer();
    });
    socket.addEventListener("error", () => undefined);
  };

  /** El WebSocket no abrió o se cortó: se consulta cada 3 s y se reintenta cada 8. */
  function caer(): void {
    if (parado) return;
    cambiar("sondeo");
    sacar(sondeo);
    sondear();
    sacar(reintento);
    reintento = poner(conectar, REINTENTO_MS);
  }

  function parar(): void {
    parado = true;
    sacar(sondeo);
    sacar(reintento);
    try {
      ws?.close(1000, "listo");
    } catch {
      /* ya cerrado */
    }
  }

  void consultar();
  conectar();
  return { parar, consultar };
}
