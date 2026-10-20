import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSULTA_LENTA_MS,
  CuentaNoLista,
  ESPERA_CUENTA_MS,
  EsperaCancelada,
  RESPIRO_MS,
  SEGUNDA_ESPERA_MS,
  conAyudaDeFondos,
  conCuentaLista,
  conTope,
  dormirCancelable,
  esperarCuenta,
  esperarHasta,
  type Ayuda,
  type EsperaDeCuenta,
  type PreparaCuenta,
} from "./reintento";

/** Un error de falta de saldo y otros que no lo son: lo único que `sinSaldo` mira es la clase. */
class SinSaldo extends Error {}
class RondaCerca extends Error {}
class RedCaida extends Error {}

/** Una `Ayuda` de testnet con una cuenta de Pollar, con cada pieza espiada. Se cambia lo que cada prueba necesite. */
function armar(cambios: Partial<Ayuda> = {}) {
  const orden: string[] = [];
  const ayuda: Ayuda = {
    esPollar: true,
    hayGrifo: true,
    sinSaldo: (e) => e instanceof SinSaldo,
    avisar: vi.fn(() => void orden.push("avisar")),
    cargar: vi.fn(async () => void orden.push("cargar")),
    esperar: vi.fn(async () => void orden.push("esperar")),
    sinRecurso: vi.fn(() => void orden.push("sinRecurso")),
    ...cambios,
  };
  return { ayuda, orden };
}

/** Una operación que falla con lo que se le diga, una vez cada uno, y después sale bien. */
function operacion<T>(...resultados: (T | Error)[]) {
  let n = 0;
  return vi.fn(async () => {
    const r = resultados[Math.min(n++, resultados.length - 1)] as T | Error;
    if (r instanceof Error) throw r;
    return r;
  });
}

describe("conAyudaDeFondos", () => {
  it("si sale bien al primer intento, no hace nada más", async () => {
    const { ayuda } = armar();
    const intento = operacion("sellado");
    await expect(conAyudaDeFondos(intento, ayuda)).resolves.toBe("sellado");
    expect(intento).toHaveBeenCalledTimes(1);
    expect(ayuda.avisar).not.toHaveBeenCalled();
    expect(ayuda.cargar).not.toHaveBeenCalled();
    expect(ayuda.esperar).not.toHaveBeenCalled();
    expect(ayuda.sinRecurso).not.toHaveBeenCalled();
  });

  describe("a) testnet, cuenta de Pollar, sin saldo", () => {
    it("llama una vez al grifo y reintenta una vez, en ese orden, y devuelve lo del reintento", async () => {
      const { ayuda, orden } = armar();
      const intento = operacion<string>(new SinSaldo("txInsufficientBalance"), "sellado");
      await expect(conAyudaDeFondos(intento, ayuda)).resolves.toBe("sellado");
      expect(ayuda.cargar).toHaveBeenCalledTimes(1);
      expect(intento).toHaveBeenCalledTimes(2);
      expect(orden).toEqual(["avisar", "cargar", "esperar"]);
      expect(ayuda.sinRecurso).not.toHaveBeenCalled();
    });

    it("avisa antes de cargar, para que la pantalla diga qué está pasando", async () => {
      const { ayuda, orden } = armar();
      await conAyudaDeFondos(operacion<string>(new SinSaldo("x"), "ok"), ayuda);
      expect(orden.indexOf("avisar")).toBeLessThan(orden.indexOf("cargar"));
    });
  });

  describe("b) si vuelve a fallar, el último recurso", () => {
    it("sigue sin saldo después del grifo: lanza el segundo error y avisa una vez, sin un tercer intento", async () => {
      const { ayuda } = armar();
      const segundo = new SinSaldo("segundo");
      const intento = operacion<string>(new SinSaldo("primero"), segundo);
      await expect(conAyudaDeFondos(intento, ayuda)).rejects.toBe(segundo);
      expect(intento).toHaveBeenCalledTimes(2);
      expect(ayuda.cargar).toHaveBeenCalledTimes(1);
      expect(ayuda.sinRecurso).toHaveBeenCalledTimes(1);
    });

    it("el grifo no contesta: lanza el error de verdad, avisa, y no reintenta ni espera", async () => {
      const original = new SinSaldo("txInsufficientBalance");
      const { ayuda } = armar({ cargar: vi.fn(async () => Promise.reject(new Error("friendbot-failed"))) });
      const intento = operacion<string>(original, "ok");
      await expect(conAyudaDeFondos(intento, ayuda)).rejects.toBe(original);
      expect(intento).toHaveBeenCalledTimes(1);
      expect(ayuda.esperar).not.toHaveBeenCalled();
      expect(ayuda.sinRecurso).toHaveBeenCalledTimes(1);
    });

    it("el reintento falla por otra cosa (la ronda quedó cerca): sale ese error y no se muestra la caja de fondos", async () => {
      const { ayuda } = armar();
      const otra = new RondaCerca("Error(Contract, #5)");
      await expect(conAyudaDeFondos(operacion<string>(new SinSaldo("x"), otra), ayuda)).rejects.toBe(otra);
      expect(ayuda.sinRecurso).not.toHaveBeenCalled();
    });
  });

  describe("c) mainnet: nunca hay grifo", () => {
    it("no llama al grifo, no avisa que prepara nada, no reintenta, y pide el último recurso", async () => {
      const original = new SinSaldo("txInsufficientBalance");
      const { ayuda } = armar({ hayGrifo: false });
      const intento = operacion<string>(original, "ok");
      await expect(conAyudaDeFondos(intento, ayuda)).rejects.toBe(original);
      expect(intento).toHaveBeenCalledTimes(1);
      expect(ayuda.cargar).not.toHaveBeenCalled();
      expect(ayuda.esperar).not.toHaveBeenCalled();
      expect(ayuda.avisar).not.toHaveBeenCalled();
      expect(ayuda.sinRecurso).toHaveBeenCalledTimes(1);
    });
  });

  describe("d) un error de otro tipo no se reintenta", () => {
    it.each([
      ["la red caída", new RedCaida("Failed to fetch")],
      ["la ronda cerca", new RondaCerca("Error(Contract, #5)")],
      ["un error cualquiera", new Error("boom")],
    ])("%s sale tal cual, sin grifo y sin último recurso", async (_nombre, error) => {
      const { ayuda } = armar();
      const intento = operacion<string>(error, "ok");
      await expect(conAyudaDeFondos(intento, ayuda)).rejects.toBe(error);
      expect(intento).toHaveBeenCalledTimes(1);
      expect(ayuda.avisar).not.toHaveBeenCalled();
      expect(ayuda.cargar).not.toHaveBeenCalled();
      expect(ayuda.sinRecurso).not.toHaveBeenCalled();
    });
  });

  describe("e) una wallet que no es de Pollar no cambia de comportamiento", () => {
    it("ni siquiera con falta de saldo: Freighter y la cuenta de prueba siguen como estaban", async () => {
      const original = new SinSaldo("txInsufficientBalance");
      const { ayuda } = armar({ esPollar: false });
      const intento = operacion<string>(original, "ok");
      await expect(conAyudaDeFondos(intento, ayuda)).rejects.toBe(original);
      expect(intento).toHaveBeenCalledTimes(1);
      expect(ayuda.avisar).not.toHaveBeenCalled();
      expect(ayuda.cargar).not.toHaveBeenCalled();
      expect(ayuda.esperar).not.toHaveBeenCalled();
      expect(ayuda.sinRecurso).not.toHaveBeenCalled();
    });

    it("tampoco en mainnet", async () => {
      const { ayuda } = armar({ esPollar: false, hayGrifo: false });
      await expect(conAyudaDeFondos(operacion<string>(new SinSaldo("x")), ayuda)).rejects.toBeInstanceOf(SinSaldo);
      expect(ayuda.sinRecurso).not.toHaveBeenCalled();
    });
  });

  it("nunca reintenta más de una vez, aunque todo falle por saldo", async () => {
    const { ayuda } = armar();
    const intento = vi.fn(async () => {
      throw new SinSaldo("siempre");
    });
    await expect(conAyudaDeFondos(intento, ayuda)).rejects.toBeInstanceOf(SinSaldo);
    expect(intento).toHaveBeenCalledTimes(2);
    expect(ayuda.cargar).toHaveBeenCalledTimes(1);
  });
});

describe("esperarHasta", () => {
  /** Un reloj de mentira: `dormir` lo adelanta y nadie espera de verdad. */
  function reloj() {
    let t = 0;
    return { ahora: () => t, dormir: async (ms: number) => void (t += ms), pasado: () => t };
  }

  it("devuelve verdadero apenas se cumple, sin dormir", async () => {
    const r = reloj();
    await expect(esperarHasta(async () => true, { cadaMs: 500, hastaMs: 5000, ...r })).resolves.toBe(true);
    expect(r.pasado()).toBe(0);
  });

  it("mira cada cadaMs hasta que se cumple", async () => {
    const r = reloj();
    let miradas = 0;
    const listo = async () => ++miradas >= 4;
    await expect(esperarHasta(listo, { cadaMs: 500, hastaMs: 5000, ...r })).resolves.toBe(true);
    expect(miradas).toBe(4);
    expect(r.pasado()).toBe(1500);
  });

  it("se rinde al llegar al tope y dice que no", async () => {
    const r = reloj();
    await expect(esperarHasta(async () => false, { cadaMs: 500, hastaMs: 2000, ...r })).resolves.toBe(false);
    expect(r.pasado()).toBeLessThanOrEqual(2000);
  });

  it("el tope es de tiempo de verdad: una consulta lenta no lo estira", async () => {
    const r = reloj();
    let miradas = 0;
    // Cada consulta tarda 900 ms de reloj, como una red lenta.
    const lenta = async () => {
      miradas++;
      await r.dormir(900);
      return false;
    };
    await expect(esperarHasta(lenta, { cadaMs: 500, hastaMs: 3000, ...r })).resolves.toBe(false);
    expect(r.pasado()).toBeLessThanOrEqual(3000 + 900);
    expect(miradas).toBeLessThan(6);
  });
});

describe("conTope", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("devuelve lo que llegó a tiempo y no deja el reloj corriendo", async () => {
    const p = conTope(new Promise<string>((r) => setTimeout(() => r("listo"), 100)), 1000, "tope");
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe("listo");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falla con el mensaje si no llega a tiempo", async () => {
    const p = conTope(new Promise<string>(() => undefined), 1000, "friendbot-timeout");
    const visto = p.then(
      () => "llegó",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(visto).resolves.toBe("friendbot-timeout");
  });

  it("si lo pedido falla antes del tope, sale ese error y no el del tope", async () => {
    const original = new Error("friendbot-failed");
    const p = conTope(Promise.reject(original), 1000, "tope");
    await expect(p).rejects.toBe(original);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Un reloj de mentira, con la lista de cuándo se consultó: `dormir` lo adelanta y nadie espera de verdad. */
function relojDeCuenta() {
  let t = 0;
  const consultas: number[] = [];
  const pausas: number[] = [];
  return {
    ahora: () => t,
    dormir: async (ms: number) => {
      pausas.push(ms);
      t += ms;
    },
    /** Marca una consulta en este instante. */
    marcar: () => void consultas.push(t),
    consultas,
    pausas,
    pasado: () => t,
  };
}

/** Una consulta que contesta lo que se le diga, una vez cada cosa, y después repite lo último. Un `Error` lanza. */
function consulta(r: ReturnType<typeof relojDeCuenta>, ...respuestas: (boolean | Error)[]) {
  let n = 0;
  return vi.fn(async () => {
    r.marcar();
    const x = respuestas[Math.min(n++, respuestas.length - 1)] as boolean | Error;
    if (x instanceof Error) throw x;
    return x;
  });
}

describe("esperarCuenta", () => {
  it("si la cuenta existe de entrada, vuelve sin esperar y sin avisar nada", async () => {
    const r = relojDeCuenta();
    const existe = consulta(r, true);
    const alEsperar = vi.fn();
    await expect(esperarCuenta({ existe, alEsperar, ...r })).resolves.toBe("existe");
    expect(existe).toHaveBeenCalledTimes(1);
    expect(alEsperar).not.toHaveBeenCalled();
    expect(r.pausas).toEqual([]);
  });

  it("si existe a los 3 intentos, avisa una vez y mira cada segundo", async () => {
    const r = relojDeCuenta();
    const existe = consulta(r, false, false, true);
    const alEsperar = vi.fn();
    await expect(esperarCuenta({ existe, alEsperar, ...r })).resolves.toBe("existe");
    expect(existe).toHaveBeenCalledTimes(3);
    expect(alEsperar).toHaveBeenCalledTimes(1);
    expect(r.consultas).toEqual([0, 1000, 2000]);
  });

  it("si no existe nunca, a los 90 segundos se rinde y dice que no llegó", async () => {
    const r = relojDeCuenta();
    const existe = consulta(r, false);
    const alEsperar = vi.fn();
    await expect(esperarCuenta({ existe, alEsperar, ...r })).resolves.toBe("no-llego");
    expect(ESPERA_CUENTA_MS).toBe(90_000);
    expect(r.pasado()).toBe(90_000);
    expect(alEsperar).toHaveBeenCalledTimes(1);
    // De a una por segundo: 0, 1, 2… 90 segundos.
    expect(existe).toHaveBeenCalledTimes(91);
  });

  it("nunca consulta más de una vez por segundo, aunque se le pida más seguido", async () => {
    const r = relojDeCuenta();
    const existe = consulta(r, false);
    await esperarCuenta({ existe, cadaMs: 10, hastaMs: 10_000, ...r });
    const seguidas = r.consultas.slice(1).map((t, i) => t - (r.consultas[i] as number));
    expect(Math.min(...seguidas)).toBeGreaterThanOrEqual(1000);
    expect(r.pausas.every((ms) => ms >= 1000)).toBe(true);
  });

  it("el tiempo es el que se pide", async () => {
    const r = relojDeCuenta();
    await expect(esperarCuenta({ existe: consulta(r, false), hastaMs: 3000, ...r })).resolves.toBe("no-llego");
    expect(r.consultas).toEqual([0, 1000, 2000, 3000]);
  });

  describe("un corte de red no corta la espera", () => {
    it("si la consulta falla a ratos, sigue y la encuentra cuando vuelve la red", async () => {
      const r = relojDeCuenta();
      const existe = consulta(r, new Error("Failed to fetch"), new Error("Failed to fetch"), false, new Error("Failed to fetch"), true);
      const alEsperar = vi.fn();
      await expect(esperarCuenta({ existe, alEsperar, ...r })).resolves.toBe("existe");
      expect(existe).toHaveBeenCalledTimes(5);
      expect(alEsperar).toHaveBeenCalledTimes(1);
    });

    it("si la red no contestó ni una vez, no afirma nada: sin-red, y no 'no llegó'", async () => {
      const r = relojDeCuenta();
      const existe = consulta(r, new Error("Failed to fetch"));
      await expect(esperarCuenta({ existe, hastaMs: 5000, ...r })).resolves.toBe("sin-red");
      expect(existe).toHaveBeenCalledTimes(6);
    });

    it("si la red dijo que no existía y después dejó de contestar, es 'no llegó'", async () => {
      const r = relojDeCuenta();
      const existe = consulta(r, false, new Error("Failed to fetch"));
      await expect(esperarCuenta({ existe, hastaMs: 5000, ...r })).resolves.toBe("no-llego");
    });

    it("avisa también cuando lo primero que pasa es un corte: la persona espera igual", async () => {
      const r = relojDeCuenta();
      const alEsperar = vi.fn();
      await esperarCuenta({ existe: consulta(r, new Error("x"), true), alEsperar, ...r });
      expect(alEsperar).toHaveBeenCalledTimes(1);
    });

    it("una consulta que se cuelga cuenta como un corte y no frena la espera", async () => {
      vi.useFakeTimers();
      try {
        let n = 0;
        // La primera no contesta nunca; la segunda dice que sí.
        const existe = vi.fn(() => (++n === 1 ? new Promise<boolean>(() => undefined) : Promise.resolve(true)));
        const corrida = esperarCuenta({ existe, ahora: () => Date.now() });
        await vi.advanceTimersByTimeAsync(CONSULTA_LENTA_MS + 1000);
        await expect(corrida).resolves.toBe("existe");
        expect(existe).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("se puede cancelar", () => {
    it("si ya estaba cancelada, no consulta", async () => {
      const r = relojDeCuenta();
      const existe = consulta(r, false);
      const control = new AbortController();
      control.abort();
      await expect(esperarCuenta({ existe, signal: control.signal, ...r })).resolves.toBe("cancelada");
      expect(existe).not.toHaveBeenCalled();
    });

    it("si se cancela mientras duerme entre una consulta y otra, sale en el acto", async () => {
      const control = new AbortController();
      const existe = vi.fn(async () => false);
      // Una pausa de verdad, que se corta con la cancelación.
      const dormir = (ms: number, signal?: AbortSignal) => {
        control.abort();
        return dormirCancelable(ms, signal);
      };
      const antes = Date.now();
      await expect(esperarCuenta({ existe, dormir, signal: control.signal })).resolves.toBe("cancelada");
      expect(existe).toHaveBeenCalledTimes(1);
      expect(Date.now() - antes).toBeLessThan(500);
    });

    it("si se cancela con una consulta en vuelo, no espera a que conteste", async () => {
      const control = new AbortController();
      const existe = vi.fn(() => new Promise<boolean>(() => undefined));
      const corrida = esperarCuenta({ existe, signal: control.signal });
      await Promise.resolve();
      control.abort();
      await expect(corrida).resolves.toBe("cancelada");
    });

    it("no deja oyentes colgados en la señal al terminar", async () => {
      const control = new AbortController();
      const quitados: string[] = [];
      const original = control.signal.removeEventListener.bind(control.signal);
      control.signal.removeEventListener = ((tipo: string, ...resto: unknown[]) => {
        quitados.push(tipo);
        return (original as (...a: unknown[]) => void)(tipo, ...resto);
      }) as typeof control.signal.removeEventListener;
      await esperarCuenta({ existe: async () => true, signal: control.signal });
      expect(quitados).toContain("abort");
    });
  });
});

describe("dormirCancelable", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("duerme lo pedido y no deja el reloj corriendo", async () => {
    let listo = false;
    void dormirCancelable(1000).then(() => (listo = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(listo).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(listo).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("se despierta apenas se cancela, y suelta el reloj", async () => {
    const control = new AbortController();
    let listo = false;
    void dormirCancelable(60_000, control.signal).then(() => (listo = true));
    await vi.advanceTimersByTimeAsync(10);
    control.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(listo).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("si ya estaba cancelada, no duerme", async () => {
    const control = new AbortController();
    control.abort();
    let listo = false;
    void dormirCancelable(60_000, control.signal).then(() => (listo = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(listo).toBe(true);
  });
});

/** Una cuenta que no existe, como la cuenta el SDK. */
class NoExiste extends Error {}

describe("conCuentaLista", () => {
  /** El armado de la espera, con cada pieza espiada. */
  function armar(esperas: EsperaDeCuenta[] = ["existe"], cambios: Partial<PreparaCuenta> = {}) {
    let n = 0;
    const llamadas: string[] = [];
    const prepara: PreparaCuenta = {
      esPollar: true,
      esperar: vi.fn(async (hastaMs: number) => {
        llamadas.push(`esperar(${hastaMs})`);
        return esperas[Math.min(n++, esperas.length - 1)] as EsperaDeCuenta;
      }),
      noExiste: (e) => e instanceof NoExiste,
      respirar: vi.fn(async (ms: number) => void llamadas.push(`respirar(${ms})`)),
      ...cambios,
    };
    return { prepara, llamadas };
  }
  /** Una operación que falla o sale bien según le toque. */
  function operacion<T>(llamadas: string[], ...resultados: (T | Error)[]) {
    let n = 0;
    return vi.fn(async () => {
      llamadas.push("operacion");
      const x = resultados[Math.min(n++, resultados.length - 1)] as T | Error;
      if (x instanceof Error) throw x;
      return x;
    });
  }

  it("con otra wallet no cambia nada: ni espera ni consulta", async () => {
    const { prepara } = armar(["existe"], { esPollar: false });
    const op = vi.fn(async () => "sellado");
    await expect(conCuentaLista(op, prepara)).resolves.toBe("sellado");
    expect(prepara.esperar).not.toHaveBeenCalled();
    // Tampoco se le cambia un error de cuenta inexistente: sale como llegó.
    const error = new NoExiste("Account not found");
    await expect(conCuentaLista(async () => Promise.reject(error), prepara)).rejects.toBe(error);
    expect(prepara.respirar).not.toHaveBeenCalled();
  });

  it("espera a que exista ANTES de la primera operación (antes de simular), y la hace una vez", async () => {
    const { prepara, llamadas } = armar();
    const op = operacion(llamadas, "sellado");
    await expect(conCuentaLista(op, prepara)).resolves.toBe("sellado");
    expect(llamadas).toEqual([`esperar(${ESPERA_CUENTA_MS})`, "operacion"]);
  });

  it("si pasan los 90 segundos, falla con 'la cuenta no está lista' y no simula nada", async () => {
    const { prepara, llamadas } = armar(["no-llego"]);
    const op = operacion(llamadas, "sellado");
    await expect(conCuentaLista(op, prepara)).rejects.toBeInstanceOf(CuentaNoLista);
    await expect(conCuentaLista(op, prepara)).rejects.toThrow("account-not-ready");
    expect(op).not.toHaveBeenCalled();
  });

  it("si la red no contestó, falla con un error de red, no con 'no está lista'", async () => {
    const { prepara } = armar(["sin-red"]);
    const error = await conCuentaLista(async () => "x", prepara).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(CuentaNoLista);
    expect((error as Error).message).toBe("account-check-network");
  });

  it("si se cancela la espera, falla con la cancelación", async () => {
    const { prepara, llamadas } = armar(["cancelada"]);
    const op = operacion(llamadas, "x");
    await expect(conCuentaLista(op, prepara)).rejects.toBeInstanceOf(EsperaCancelada);
    expect(op).not.toHaveBeenCalled();
  });

  describe("la red la mostró pero la simulación dice que no existe", () => {
    it("un respiro, se mira otra vez y se reintenta una vez: si ahora sale bien, sale bien", async () => {
      const { prepara, llamadas } = armar();
      const op = operacion<string>(llamadas, new NoExiste("Account not found: G…"), "sellado");
      await expect(conCuentaLista(op, prepara)).resolves.toBe("sellado");
      expect(llamadas).toEqual([
        `esperar(${ESPERA_CUENTA_MS})`,
        "operacion",
        `respirar(${RESPIRO_MS})`,
        `esperar(${SEGUNDA_ESPERA_MS})`,
        "operacion",
      ]);
    });

    it("si vuelve a fallar igual, es 'la cuenta no está lista', y no hay un tercer intento", async () => {
      const { prepara, llamadas } = armar();
      const op = operacion<string>(llamadas, new NoExiste("Account not found: G…"));
      await expect(conCuentaLista(op, prepara)).rejects.toBeInstanceOf(CuentaNoLista);
      expect(op).toHaveBeenCalledTimes(2);
    });

    it("si en el segundo intento falla por otra cosa, sale esa otra cosa", async () => {
      const { prepara, llamadas } = armar();
      const otra = new Error("HostError: Error(Contract, #5)");
      const op = operacion<string>(llamadas, new NoExiste("Account not found"), otra);
      await expect(conCuentaLista(op, prepara)).rejects.toBe(otra);
    });

    it("si la segunda espera tampoco la ve, no se reintenta", async () => {
      const { prepara, llamadas } = armar(["existe", "no-llego"]);
      const op = operacion<string>(llamadas, new NoExiste("Account not found"), "sellado");
      await expect(conCuentaLista(op, prepara)).rejects.toBeInstanceOf(CuentaNoLista);
      expect(op).toHaveBeenCalledTimes(1);
    });
  });

  it("un error de otro tipo no se reintenta ni espera de nuevo", async () => {
    const { prepara, llamadas } = armar();
    const error = new Error("HostError: Error(Contract, #5)");
    const op = operacion<string>(llamadas, error);
    await expect(conCuentaLista(op, prepara)).rejects.toBe(error);
    expect(op).toHaveBeenCalledTimes(1);
    expect(prepara.respirar).not.toHaveBeenCalled();
    expect(prepara.esperar).toHaveBeenCalledTimes(1);
  });
});
