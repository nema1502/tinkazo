import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarRondaDeSala } from "../../workers/sala/src/logica";
import { listHash } from "../protocol/canonical";
import { select } from "../protocol/select";
import { cifrarNombre, generarClave, huellaNombre } from "./cifra";
import { cerrarListaEnSala, compartirRonda, escucharSala, type Sala } from "./cliente";
import { anotarseEnSala, datosDeParticipante, enlaceDeParticipante, ganadoresDe, resultadoPersonal, seguirVivo, type RondaViva } from "./participante";

/**
 * El flujo interactivo de la sala (juegos interactivos, Kahoot-like): la pantalla comparte la ronda que
 * decide (la del sello, o la de ejemplo del stand), cierra la lista y cada celular ve su resultado
 * personal. Los nombres siguen cifrados con la clave del QR: el servicio no puede leerlos.
 */

const sala: Sala = { id: "AbCd1234", token: "t".repeat(22), clave: "c".repeat(22), vence: 0, servicio: "http://sala.test" };
const respuesta = (cuerpo: unknown, status = 200): Response => new Response(JSON.stringify(cuerpo), { status });

/* ------------------------------------------------------- el estado del sorteo */

describe("la ronda que comparte la pantalla", () => {
  const buena = { r: 42_000, randomness: "a".repeat(64), listHash: "b".repeat(64), k: 1 };
  it("acepta la ronda, el número público, la huella de la lista y los ganadores", () => {
    expect(validarRondaDeSala(buena)).toEqual(buena);
  });
  it("rechaza lo que no cuadra, y no cambia nada de lo que llega de más", () => {
    expect(validarRondaDeSala(null)).toBeNull();
    expect(validarRondaDeSala("ronda")).toBeNull();
    expect(validarRondaDeSala({ ...buena, randomness: "a".repeat(63) })).toBeNull();
    expect(validarRondaDeSala({ ...buena, randomness: "g".repeat(64) })).toBeNull();
    expect(validarRondaDeSala({ ...buena, listHash: "b".repeat(64) + "!" })).toBeNull();
    expect(validarRondaDeSala({ ...buena, r: 0 })).toBeNull();
    expect(validarRondaDeSala({ ...buena, r: 1.5 })).toBeNull();
    expect(validarRondaDeSala({ ...buena, k: 0 })).toBeNull();
    expect(validarRondaDeSala({ ...buena, k: 301 })).toBeNull();
    expect(validarRondaDeSala({ ...buena, extra: 1 })).toBeNull();
  });
});

/* --------------------------------------------------- la pantalla y el cliente */

class SocketFalso {
  static ultimo: SocketFalso | null = null;
  enviados: string[] = [];
  oyentes: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public url: string) {
    SocketFalso.ultimo = this;
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.oyentes[t] ??= []).push(f);
  }
  send(d: string): void {
    this.enviados.push(d);
  }
  close(): void {}
  emitir(t: string, e: unknown = {}): void {
    for (const f of this.oyentes[t] ?? []) f(e);
  }
}

describe("la pantalla comparte la ronda y cierra la lista", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    SocketFalso.ultimo = null;
  });
  afterEach(() => vi.useRealTimers());

  it("la ronda que llega por el socket avisa una sola vez, y también al presentarse", async () => {
    const f = vi.fn().mockResolvedValue(respuesta([]));
    const alRonda = vi.fn();
    const alCierreLista = vi.fn();
    const ronda = { r: 7, randomness: "a".repeat(64), listHash: "b".repeat(64), k: 2 };
    escucharSala(sala, { alNombre: vi.fn(), alRonda, alCierreLista }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("message", { data: JSON.stringify({ t: "listo", hay: 0, estado: "abierta", ronda: null }) });
    s.emitir("message", { data: JSON.stringify({ t: "ronda", ...ronda }) });
    await vi.advanceTimersByTimeAsync(10);
    expect(alRonda).toHaveBeenCalledTimes(1);
    expect(alRonda).toHaveBeenCalledWith(ronda);
    // Al volver a presentarse (recarga), el listo trae la ronda que ya se compartió.
    s.emitir("message", { data: JSON.stringify({ t: "listo", hay: 3, estado: "abierta", ronda }) });
    expect(alRonda).toHaveBeenCalledTimes(2);
    expect(alCierreLista).not.toHaveBeenCalled();
  });

  it("el cierre de lista llega por el socket y por el listo", async () => {
    const f = vi.fn().mockResolvedValue(respuesta([]));
    const alCierreLista = vi.fn();
    escucharSala(sala, { alNombre: vi.fn(), alCierreLista }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("message", { data: JSON.stringify({ t: "listo", hay: 0, estado: "abierta", ronda: null }) });
    s.emitir("message", { data: JSON.stringify({ t: "lista-cerrada" }) });
    s.emitir("message", { data: JSON.stringify({ t: "listo", hay: 4, estado: "cerrada", ronda: null }) });
    await vi.advanceTimersByTimeAsync(10);
    expect(alCierreLista).toHaveBeenCalledTimes(2);
  });

  it("compartir la ronda va con el token y sin la clave de los nombres", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const ronda = { r: 9, randomness: "a".repeat(64), listHash: "b".repeat(64), k: 3 };
    await expect(compartirRonda(sala, ronda, { fetch: f })).resolves.toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://sala.test/v1/sala/AbCd1234/ronda");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(ronda);
    expect(JSON.stringify(init)).toContain(sala.token);
    expect(JSON.stringify(init)).not.toContain(sala.clave);
  });

  it("cerrar la lista va con el token; sin respuesta buena, avisa que no", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(cerrarListaEnSala(sala, { fetch: f })).resolves.toBe(true);
    expect(f).toHaveBeenCalledWith("http://sala.test/v1/sala/AbCd1234/cierre", { method: "POST", headers: { Authorization: `Bearer ${sala.token}` } });
    await expect(cerrarListaEnSala(sala, { fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) })).resolves.toBe(false);
  });

  it("un 404 al cerrar la lista no es una lista cerrada: vuelve aparte, para decirlo", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ error: "no-existe" }, 404));
    await expect(cerrarListaEnSala(sala, { fetch: f })).resolves.toBe("no-existe");
    await expect(cerrarListaEnSala(sala, { fetch: vi.fn().mockResolvedValue(respuesta({ error: "token" }, 403)) })).resolves.toBe(false);
  });

  it("un 404 al compartir la ronda vuelve aparte, y otro fallo es un fallo común", async () => {
    const ronda = { r: 9, randomness: "a".repeat(64), listHash: "b".repeat(64), k: 3 };
    const noEsta = vi.fn().mockResolvedValue(respuesta({ error: "no-existe" }, 404));
    await expect(compartirRonda(sala, ronda, { fetch: noEsta })).resolves.toBe("no-existe");
    await expect(compartirRonda(sala, ronda, { fetch: vi.fn().mockResolvedValue(new Response("no", { status: 500 })) })).resolves.toBe(false);
  });
});

/* --------------------------------------------------------- el participante */

describe("el enlace del participante", () => {
  it("ida y vuelta: el enlace lleva el id de la sala y la clave en el fragmento, que ningún servidor ve", () => {
    const enlace = enlaceDeParticipante({ id: "AbCd1234", clave: "c".repeat(22) }, "https://tinkazo.app");
    expect(enlace).toMatch(/^https:\/\/tinkazo\.app\/#participante=[A-Za-z0-9_-]+$/);
    expect(datosDeParticipante(new URL(enlace).hash)).toEqual({ id: "AbCd1234", clave: "c".repeat(22) });
  });
  it("rechaza lo que no es un enlace de participante, o lo está roto", () => {
    expect(datosDeParticipante("#sortear")).toBeNull();
    expect(datosDeParticipante("#espectador=abc")).toBeNull();
    expect(datosDeParticipante("#participante=abc")).toBeNull();
    expect(datosDeParticipante("")).toBeNull();
    // Un payload válido en base64 pero con un id o una clave mal formados.
    const roto = Buffer.from(JSON.stringify({ v: 1, id: "corto", clave: "c".repeat(22) })).toString("base64url");
    expect(datosDeParticipante(`#participante=${roto}`)).toBeNull();
  });
});

describe("el participante se anota", () => {
  it("manda su nombre cifrado con la clave del QR", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ n: 1 }, 201));
    const r = await anotarseEnSala(sala.id, sala.clave, "Ana Quispe", sala.servicio, { fetch: f });
    expect(r).toEqual({ ok: true, n: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://sala.test/v1/sala/AbCd1234");
    expect(init.method).toBe("POST");
    expect(String(init.body)).not.toContain("Ana");
    const { d } = JSON.parse(String(init.body)) as { d: string };
    expect(await descifra(sala.clave, d)).toBe("Ana Quispe");
  });
  it("manda el JSON que pide una sala nueva: el nombre cifrado, su huella con la clave del QR y la llave del celular", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ n: 1 }, 201));
    await anotarseEnSala(sala.id, sala.clave, "Ana Quispe", sala.servicio, { fetch: f });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const cuerpo = JSON.parse(String(init.body)) as { d: string; h: string; llave: string };
    expect(Object.keys(cuerpo).sort()).toEqual(["d", "h", "llave"]);
    expect(cuerpo.h).toBe(await huellaNombre(sala.clave, "Ana Quispe"));
    expect(cuerpo.llave).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it("el mismo celular manda siempre la misma llave en la misma sala", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ n: 1 }, 201));
    await anotarseEnSala("LlAv1234", sala.clave, "Ana", sala.servicio, { fetch: f });
    await anotarseEnSala("LlAv1234", sala.clave, "Ana Quispe", sala.servicio, { fetch: f });
    const llaves = f.mock.calls.map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as { llave: string }).llave);
    expect(llaves[0]).toBe(llaves[1]);
  });
  it("toma como bien el 200 de la sala, que es la respuesta al mismo celular que vuelve a mandar su nombre", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ n: 4, r: [2] }, 200));
    await expect(anotarseEnSala(sala.id, sala.clave, "Ana", sala.servicio, { fetch: f })).resolves.toEqual({ ok: true, n: 4 });
  });
  it("dice el motivo cuando la sala no lo acepta, y «red» si no hay red", async () => {
    await expect(anotarseEnSala(sala.id, sala.clave, "Ana", sala.servicio, { fetch: vi.fn().mockResolvedValue(respuesta({ error: "cerrada" }, 409)) })).resolves.toEqual({ ok: false, motivo: "cerrada" });
    await expect(anotarseEnSala(sala.id, sala.clave, "Ana", sala.servicio, { fetch: vi.fn().mockResolvedValue(respuesta({ error: "llena" }, 429)) })).resolves.toEqual({ ok: false, motivo: "llena" });
    await expect(anotarseEnSala(sala.id, sala.clave, "Ana", sala.servicio, { fetch: vi.fn().mockRejectedValue(new TypeError("no hay red")) })).resolves.toEqual({ ok: false, motivo: "red" });
  });
  async function descifra(clave: string, dato: string): Promise<string | null> {
    return await import("./cifra").then((m) => m.descifrarNombre(clave, dato));
  }
});

describe("el participante sigue la sala", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /**
   * Espera a que algo pase: descifrar nombres usa crypto de verdad, y hay que darle vueltas al bucle. Cada vuelta pasa
   * también por el mismo grupo de hilos donde corre el descifrado: con la máquina cargada, la espera se estira al mismo
   * ritmo y no se acaba antes de que lleguen los nombres (con vueltas de reloj falso solamente, se acababa en unos
   * 20 ms y a veces llegaba un solo nombre de los dos).
   */
  async function hasta(condicion: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condicion(); i++) {
      await vi.advanceTimersByTimeAsync(50);
      await crypto.subtle.digest("SHA-256", new Uint8Array(0));
    }
  }

  it("pide /vivo sin token, descifra los nombres y avanza el cursor", async () => {
    const clave = generarClave();
    const d1 = await cifrarNombre(clave, "Ana");
    const d2 = await cifrarNombre(clave, "Beto");
    let desdePedido = "";
    const f = vi.fn().mockImplementation(async (url: string) => {
      desdePedido = String(url).split("desde=")[1] ?? "";
      return respuesta({ hay: 2, estado: "abierta", ronda: null, ns: [1, 2], nombres: [{ n: 1, d: d1 }, { n: 2, d: d2 }] });
    });
    const alNombre = vi.fn();
    const s = seguirVivo(sala.id, clave, sala.servicio, { alNombre }, { fetch: f });
    await hasta(() => alNombre.mock.calls.length === 2);
    expect(alNombre.mock.calls).toEqual([[1, "Ana"], [2, "Beto"]]);
    // Cada nombre se avisa una sola vez, aunque el pedido repita lo que ya llegó.
    await hasta(() => f.mock.calls.length >= 2);
    expect(alNombre.mock.calls).toEqual([[1, "Ana"], [2, "Beto"]]);
    expect(desdePedido).toBe("2");
    s.parar();
  });

  it("la ronda compartida y el cierre de lista llegan por el mismo sondeo", async () => {
    const clave = generarClave();
    const ronda = { r: 5, randomness: "a".repeat(64), listHash: "b".repeat(64), k: 1 };
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 0, estado: "cerrada", ronda, ns: [], nombres: [] }));
    const alRonda = vi.fn();
    const alCierre = vi.fn();
    const s = seguirVivo(sala.id, clave, sala.servicio, { alNombre: vi.fn(), alRonda, alCierre }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(alRonda).toHaveBeenCalledWith(ronda);
    expect(alCierre).toHaveBeenCalledTimes(1);
    s.parar();
  });

  it("si la sala ya no existe (404) avisa y para", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ error: "no-existe" }, 404));
    const alVencida = vi.fn();
    const s = seguirVivo(sala.id, generarClave(), sala.servicio, { alNombre: vi.fn(), alVencida }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(alVencida).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f).toHaveBeenCalledTimes(1);
    s.parar();
  });

  it("si la sala contesta que se fue (410) también avisa y para", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ error: "no-existe" }, 410));
    const alVencida = vi.fn();
    const s = seguirVivo(sala.id, generarClave(), sala.servicio, { alNombre: vi.fn(), alVencida }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(alVencida).toHaveBeenCalledTimes(1);
    s.parar();
  });

  it("sin la lista de números en la respuesta, sigue la sala igual y no da nada por cerrado", async () => {
    const clave = generarClave();
    const d1 = await cifrarNombre(clave, "Ana");
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 1, estado: "abierta", ronda: null, nombres: [{ n: 1, d: d1 }] }));
    const alNombre = vi.fn();
    const alVencida = vi.fn();
    const alQuitado = vi.fn();
    const s = seguirVivo(sala.id, clave, sala.servicio, { alNombre, alVencida, alQuitado }, { fetch: f });
    await hasta(() => f.mock.calls.length >= 3);
    expect(alNombre.mock.calls).toEqual([[1, "Ana"]]);
    expect(alVencida).not.toHaveBeenCalled();
    expect(alQuitado).not.toHaveBeenCalled();
    s.parar();
  });

  it("un error del servicio no saca a nadie: vuelve a pedir", async () => {
    const clave = generarClave();
    const d1 = await cifrarNombre(clave, "Ana");
    let pedido = 0;
    const f = vi.fn().mockImplementation(async () => {
      pedido++;
      if (pedido === 1) return new Response("no", { status: 500 });
      return respuesta({ hay: 1, estado: "abierta", ronda: null, ns: [1], nombres: [{ n: 1, d: d1 }] });
    });
    const alNombre = vi.fn();
    const alVencida = vi.fn();
    const s = seguirVivo(sala.id, clave, sala.servicio, { alNombre, alVencida }, { fetch: f });
    await hasta(() => alNombre.mock.calls.length === 1);
    expect(alNombre).toHaveBeenCalledWith(1, "Ana");
    expect(alVencida).not.toHaveBeenCalled();
    s.parar();
  });

  it("un corte de red tampoco: vuelve a pedir cada 3 s", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const alVencida = vi.fn();
    const s = seguirVivo(sala.id, generarClave(), sala.servicio, { alNombre: vi.fn(), alVencida }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f).toHaveBeenCalledTimes(2);
    expect(alVencida).not.toHaveBeenCalled();
    s.parar();
  });

  it("tras cinco pedidos fallidos seguidos deja de mirar y lo avisa una vez", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const alVencida = vi.fn();
    const s = seguirVivo(sala.id, generarClave(), sala.servicio, { alNombre: vi.fn(), alVencida }, { fetch: f });
    await vi.advanceTimersByTimeAsync(4 * 3_000 + 10);
    expect(f).toHaveBeenCalledTimes(5);
    expect(alVencida).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f).toHaveBeenCalledTimes(5);
    s.parar();
  });

  it("una respuesta buena vuelve a poner en cero la cuenta de fallos", async () => {
    let pedido = 0;
    // Cuatro fallos, una buena y otros cuatro fallos: nunca cinco seguidos.
    const f = vi.fn().mockImplementation(async () => {
      pedido++;
      if (pedido === 5) return respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] });
      if (pedido <= 9) throw new TypeError("Failed to fetch");
      return respuesta({ hay: 0, estado: "abierta", ronda: null, ns: [], nombres: [] });
    });
    const alVencida = vi.fn();
    const s = seguirVivo(sala.id, generarClave(), sala.servicio, { alNombre: vi.fn(), alVencida }, { fetch: f });
    await vi.advanceTimersByTimeAsync(9 * 3_000 + 10);
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(alVencida).not.toHaveBeenCalled();
    s.parar();
  });

  it("un nombre que la pantalla quitó deja de verse: la lista del celular sigue siendo la que se sella", async () => {
    const clave = generarClave();
    const d1 = await cifrarNombre(clave, "Ana");
    const d2 = await cifrarNombre(clave, "Beto");
    let pedido = 0;
    const f = vi.fn().mockImplementation(async () => {
      pedido++;
      return pedido === 1
        ? respuesta({ hay: 2, estado: "abierta", ronda: null, ns: [1, 2], nombres: [{ n: 1, d: d1 }, { n: 2, d: d2 }] })
        : respuesta({ hay: 1, estado: "abierta", ronda: null, ns: [2], nombres: [] });
    });
    const alNombre = vi.fn();
    const alQuitado = vi.fn();
    const s = seguirVivo(sala.id, clave, sala.servicio, { alNombre, alQuitado }, { fetch: f });
    await hasta(() => alNombre.mock.calls.length === 2);
    await hasta(() => f.mock.calls.length >= 2);
    expect(alQuitado).toHaveBeenCalledWith(1);
    // Y no vuelve a avisar al que quedó (el sondeo lo trae entero, por el ns).
    const antes = alNombre.mock.calls.length;
    await hasta(() => f.mock.calls.length >= 3);
    expect(alNombre.mock.calls.length).toBe(antes);
    s.parar();
  });

  it("los nombres de otra clave no se muestran", async () => {
    const d1 = await cifrarNombre(generarClave(), "Otra");
    const f = vi.fn().mockResolvedValue(respuesta({ hay: 1, estado: "abierta", ronda: null, ns: [1], nombres: [{ n: 1, d: d1 }] }));
    const alNombre = vi.fn();
    const s = seguirVivo(sala.id, generarClave(), sala.servicio, { alNombre }, { fetch: f });
    await vi.advanceTimersByTimeAsync(10);
    expect(alNombre).not.toHaveBeenCalled();
    s.parar();
  });
});

describe("el resultado personal", () => {
  const nombres = ["Ana", "Beto", "Carla", "Dani"];
  const hash = Buffer.from(listHash(nombres)).toString("hex");
  /** La ronda de prueba: los ganadores salen de select, como en un sorteo de verdad. */
  function rondaDe(k: number, randomness = "c".repeat(64)): { ronda: RondaViva; ganadores: string[] } {
    const ronda = { r: 1, randomness, listHash: hash, k };
    const bytes = Uint8Array.from(randomness.match(/../g) as string[], (h) => parseInt(h, 16));
    const idx = select(bytes, new Uint8Array(Buffer.from(hash, "hex")), nombres.length, k);
    return { ronda, ganadores: idx.map((i) => nombres[i] as string) };
  }

  it("si su nombre sale, «te tocó»; si no, «no ganó»", () => {
    const { ronda, ganadores } = rondaDe(2);
    expect(ganadores.length).toBe(2);
    const ganador = ganadores[0] as string;
    const otro = nombres.find((n) => !ganadores.includes(n)) as string;
    expect(resultadoPersonal(nombres, ronda, ganador)).toBe("te-toco");
    expect(resultadoPersonal(nombres, ronda, otro)).toBe("no-gano");
  });

  it("no distingue mayúsculas ni espacios de más", () => {
    const { ronda, ganadores } = rondaDe(1);
    const ganador = ganadores[0] as string;
    expect(resultadoPersonal(nombres, ronda, `  ${ganador.toLocaleUpperCase()}  `)).toBe("te-toco");
  });

  it("con todos como ganadores, todos ven «te tocó»", () => {
    const { ronda } = rondaDe(nombres.length);
    for (const n of nombres) expect(resultadoPersonal(nombres, ronda, n)).toBe("te-toco");
  });

  it("si la lista del celular no es la que se selló, no afirma nada", () => {
    const { ronda } = rondaDe(1);
    expect(resultadoPersonal(["Ana", "Beto", "Carla"], ronda, "Ana")).toBe("lista-distinta");
    // La lista vacía tampoco puede decidir.
    expect(resultadoPersonal([], ronda, "Ana")).toBe("lista-distinta");
  });

  it("una ronda mal formada no decide nada", () => {
    const { ronda } = rondaDe(1);
    const mala = { r: 1, randomness: "c".repeat(64), listHash: hash, k: 99 };
    expect(resultadoPersonal(nombres, mala, "Ana")).toBe("lista-distinta");
    const truncada = { r: 1, randomness: "", listHash: hash, k: 1 };
    expect(resultadoPersonal(nombres, truncada, "Ana")).toBe("lista-distinta");
  });

  it("los ganadores salen con el mismo select, para mostrarlos en el celular", () => {
    const { ronda, ganadores } = rondaDe(2);
    expect(ganadoresDe(nombres, ronda)).toEqual(ganadores);
    // Sin lista sellable, no hay ganadores que mostrar.
    expect(ganadoresDe(["Ana"], ronda)).toBeNull();
    expect(ganadoresDe(nombres, { ...ronda, listHash: "b".repeat(64) })).toBeNull();
  });
});
