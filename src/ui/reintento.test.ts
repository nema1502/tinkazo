import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conAyudaDeFondos, conTope, esperarHasta, type Ayuda } from "./reintento";

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
