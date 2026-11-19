import { describe, expect, it } from "vitest";
import type { EstadoDeAltaPremio } from "../campana/en-curso";
import type { MotivoDeAltaPremio, ResultadoDeAltaPremio } from "../stellar/alta-api";
import { type DepsDeLasAltas, crearAltas, esFinal } from "./campana-altas";

/**
 * Avisar al servicio del acceso las cuentas que ganaron, con un servicio y un reloj de mentira. Los reintentos, el orden y lo
 * que queda recordado por puesto están fijados acá; lo que dice la fila lo comprueba la prueba del panel.
 */

interface Mundo {
  d: DepsDeLasAltas;
  llamadas: { puesto: number; cuenta: string; sorteo: string }[];
  respuestas: ResultadoDeAltaPremio[];
  esperas: number[];
  estados: Record<string, EstadoDeAltaPremio>;
  token: string | null;
  abierta: boolean | null;
  /** Lo que contesta `/cupo` en cada pregunta, antes de caer en `abierta`: `null` es que no se pudo saber. */
  abiertas: (boolean | null)[];
  consultas: number;
  tokens: number;
  ahora: number;
  cambios: number;
}

const GANADORAS = ["GUNO", "GDOS", "GTRES"];
const bien: ResultadoDeAltaPremio = { estado: "admitida" };
const mal = (error: MotivoDeAltaPremio, reintentarEn?: number): ResultadoDeAltaPremio =>
  reintentarEn === undefined ? { error } : { error, reintentarEn };

function mundo(respuestas: ResultadoDeAltaPremio[] = []): Mundo {
  const m: Mundo = {
    d: undefined as never,
    llamadas: [],
    respuestas,
    esperas: [],
    estados: {},
    token: "token-de-sesion",
    abierta: true,
    abiertas: [],
    consultas: 0,
    tokens: 0,
    ahora: 1_800_000_000_000,
    cambios: 0,
  };
  m.d = {
    token: async () => {
      m.tokens++;
      return m.token;
    },
    abierta: async () => {
      m.consultas++;
      return m.abiertas.length > 0 ? (m.abiertas.shift() ?? null) : m.abierta;
    },
    admitir: async (_t, p) => {
      m.llamadas.push(p);
      return m.respuestas.shift() ?? bien;
    },
    ahora: () => m.ahora,
    esperar: async (ms) => {
      m.esperas.push(ms);
      m.ahora += ms;
    },
    estados: () => m.estados,
    guardar: (puesto, e) => {
      m.estados[String(puesto)] = e;
    },
  };
  return m;
}

const iniciar = (m: Mundo, sorteo = "777") => crearAltas(m.d).iniciar(sorteo, GANADORAS, () => void m.cambios++);

describe("las cuentas ganadoras al servicio del acceso", () => {
  it("con tres puestos hace tres llamadas, en orden, con la cuenta de cada puesto", async () => {
    const m = mundo();
    await iniciar(m);
    expect(m.llamadas).toEqual([
      { sorteo: "777", puesto: 0, cuenta: "GUNO" },
      { sorteo: "777", puesto: 1, cuenta: "GDOS" },
      { sorteo: "777", puesto: 2, cuenta: "GTRES" },
    ]);
    expect(Object.values(m.estados).every((e) => e.estado === "puede")).toBe(true);
  });

  it("con red dos veces y después admitida, hubo tres llamadas y la fila puede recibir", async () => {
    const m = mundo([mal("red"), mal("red"), bien]);
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.llamadas).toHaveLength(3);
    expect(m.estados["0"]).toEqual({ estado: "puede" });
    expect(m.esperas).toEqual([2_000, 5_000]);
  });

  it("con pollar espera 2, 5 y 10 segundos y después deja el puesto para reintentar a mano", async () => {
    const m = mundo([mal("pollar"), mal("pollar"), mal("pollar"), mal("pollar")]);
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.llamadas).toHaveLength(4);
    expect(m.esperas).toEqual([2_000, 5_000, 10_000]);
    expect(m.estados["0"]).toEqual({ estado: "fallo", motivo: "pollar" });
    expect(esFinal(m.estados["0"])).toBe(false);
  });

  it.each(["sin-acceso", "no-es-nuestro", "sorteo-ajeno", "forma", "puesto", "puesto-usado", "cuenta-de-otro", "otra-app"] as const)(
    "con %s hace una sola llamada y queda final: sin reintentar",
    async (motivo) => {
      const m = mundo([mal(motivo)]);
      await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
      expect(m.llamadas).toHaveLength(1);
      expect(m.estados["0"]).toEqual({ estado: "fallo", motivo, final: true });
      expect(esFinal(m.estados["0"])).toBe(true);
    },
  );

  it.each(["sesion", "cupo", "altas-pausadas"] as const)("con %s hace una llamada y deja Probar de nuevo", async (motivo) => {
    const m = mundo([mal(motivo)]);
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.llamadas).toHaveLength(1);
    expect(m.estados["0"]).toEqual({ estado: "fallo", motivo });
  });

  it("con intentos espera hasta la hora que dice el servicio, entre 2 segundos y un minuto", async () => {
    const m = mundo([mal("intentos", 1_800_000_000_000 + 30_000), mal("cupo-ip", 1_800_000_000_000 + 30_000 + 600_000), bien]);
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.esperas).toEqual([30_000, 60_000]);
    expect(m.estados["0"]).toEqual({ estado: "puede" });
  });

  it("con cupo-ip sin hora espera 2, 5 y 10 segundos y no tres veces el mínimo", async () => {
    const m = mundo([mal("cupo-ip"), mal("cupo-ip"), mal("cupo-ip"), bien]);
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.esperas).toEqual([2_000, 5_000, 10_000]);
    expect(m.estados["0"]).toEqual({ estado: "puede" });
  });

  it("con apagado en un puesto, la fila no muestra nada", async () => {
    const m = mundo([mal("apagado")]);
    await iniciar(m);
    expect(m.estados["0"]).toEqual({ estado: "apagado" });
  });

  it("un puesto que contestó apagado no es final: al recargar se vuelve a preguntar y avisa los tres puestos", async () => {
    const m = mundo([mal("apagado"), mal("apagado"), mal("apagado")]);
    await iniciar(m);
    expect(esFinal(m.estados["0"])).toBe(false);
    expect(m.llamadas).toHaveLength(3);
    await iniciar(m);
    expect(m.llamadas).toHaveLength(6);
    expect(Object.values(m.estados).every((e) => e.estado === "puede")).toBe(true);
  });

  it("con el servicio cerrado en /cupo no llama a nada y no recuerda nada como final", async () => {
    const m = mundo();
    m.abierta = false;
    await iniciar(m);
    expect(m.llamadas).toHaveLength(0);
    expect(m.consultas).toBe(1);
    expect(m.estados).toEqual({});
  });

  it("un servicio que estaba cerrado en /cupo se vuelve a preguntar al recargar", async () => {
    const m = mundo();
    m.abierta = false;
    await iniciar(m);
    m.abierta = true;
    await iniciar(m);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([0, 1, 2]);
  });

  it("con /cupo sin respuesta dos veces y después abierta, vuelve a preguntar con 2 y 5 segundos y avisa los tres puestos", async () => {
    const m = mundo();
    m.abiertas = [null, null, true];
    await iniciar(m);
    expect(m.consultas).toBe(3);
    expect(m.esperas).toEqual([2_000, 5_000]);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([0, 1, 2]);
    expect(Object.values(m.estados).every((e) => e.estado === "puede")).toBe(true);
  });

  it("con /cupo sin respuesta tras los reintentos, cada puesto queda para reintentar y no es final", async () => {
    const m = mundo();
    m.abierta = null;
    await iniciar(m);
    expect(m.consultas).toBe(4);
    expect(m.esperas).toEqual([2_000, 5_000, 10_000]);
    expect(m.llamadas).toHaveLength(0);
    expect(Object.values(m.estados)).toEqual([
      { estado: "fallo", motivo: "red" },
      { estado: "fallo", motivo: "red" },
      { estado: "fallo", motivo: "red" },
    ]);
    expect(Object.values(m.estados).some((e) => esFinal(e))).toBe(false);
  });

  it("tras un /cupo sin respuesta, Reintentar un puesto vuelve a preguntar y lo avisa", async () => {
    const m = mundo();
    m.abierta = null;
    const altas = crearAltas(m.d);
    await altas.iniciar("777", GANADORAS, () => undefined);
    m.abierta = true;
    await altas.reintentar(1);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([1]);
    expect(m.estados["1"]).toEqual({ estado: "puede" });
  });

  it("al recargar tras un /cupo sin respuesta, vuelve a llamar por los puestos que no salieron", async () => {
    const m = mundo();
    m.abierta = null;
    await iniciar(m);
    m.abierta = true;
    await iniciar(m);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([0, 1, 2]);
  });

  it("con otra billetera (sin token) hace cero llamadas", async () => {
    const m = mundo();
    m.token = null;
    await iniciar(m);
    expect(m.llamadas).toHaveLength(0);
    expect(m.estados).toEqual({});
  });

  it("con sin-sortear vuelve a probar cada 10 segundos durante 2 minutos y después deja Probar de nuevo", async () => {
    const m = mundo(Array.from({ length: 30 }, () => mal("sin-sortear")));
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.esperas.every((e) => e === 10_000)).toBe(true);
    expect(m.esperas.length).toBeGreaterThanOrEqual(11);
    expect(m.estados["0"]).toEqual({ estado: "fallo", motivo: "sin-sortear" });
  });

  it("con sin-sortear y después admitida, termina en puede", async () => {
    const m = mundo([mal("sin-sortear"), mal("sin-sortear"), bien]);
    await crearAltas(m.d).iniciar("777", ["GUNO"], () => undefined);
    expect(m.estados["0"]).toEqual({ estado: "puede" });
    expect(m.esperas).toEqual([10_000, 10_000]);
  });

  it("al recargar con un puesto sin terminar, vuelve a llamar solo por ese", async () => {
    const m = mundo();
    m.estados = { "0": { estado: "puede" }, "1": { estado: "fallo", motivo: "red" }, "2": { estado: "fallo", motivo: "sin-acceso", final: true } };
    await iniciar(m);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([1]);
  });

  it("reintentar un puesto vuelve a llamar solo por ese", async () => {
    const m = mundo([bien, mal("cupo")]);
    const altas = crearAltas(m.d);
    await altas.iniciar("777", ["GUNO", "GDOS"], () => undefined);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([0, 1]);
    expect(m.estados["1"]).toEqual({ estado: "fallo", motivo: "cupo" });
    await altas.reintentar(1);
    expect(m.llamadas.map((l) => l.puesto)).toEqual([0, 1, 1]);
    expect(m.estados["1"]).toEqual({ estado: "puede" });
  });

  it("avisa cada cambio para que la fila se vuelva a dibujar", async () => {
    const m = mundo();
    await iniciar(m);
    expect(m.cambios).toBe(3);
  });

  it("cuando la grabación del sorteo entra, un puesto que esperaba no espera su reloj", async () => {
    const m = mundo([mal("sin-sortear")]);
    const altas = crearAltas(m.d);
    m.d.esperar = () => new Promise<void>(() => undefined);
    const corrida = altas.iniciar("777", ["GUNO"], () => undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(m.llamadas).toHaveLength(1);
    altas.alGuardarElSorteo();
    await corrida;
    expect(m.llamadas).toHaveLength(2);
    expect(m.estados["0"]).toEqual({ estado: "puede" });
  });

  it("pide el token de la sesión en cada puesto, porque puede haberse renovado", async () => {
    const m = mundo();
    await iniciar(m);
    expect(m.tokens).toBe(4);
  });
});
