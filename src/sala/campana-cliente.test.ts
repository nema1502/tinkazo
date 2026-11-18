import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SOSIEGO_MS,
  TOPE_ALTA_MS,
  TOPE_PEDIDO_MS,
  TOPE_TOQUE_MS,
  anotarmeEnCampana,
  cuentaValida,
  estadoPublico,
  miEstado,
  resultadoDeCampana,
  type AltaEnCampana,
  type CuerpoDeAlta,
  type SosiegoDelAlta,
} from "./campana";
import { fetchFalso, type Llamada, type Paso } from "./fetch-falso";

const CUENTA = `G${"A".repeat(55)}`;
const SERVICIO = "https://servicio.example.org";
const SALA = "ABCDEFGH";
const TOKEN = `tok_${"x".repeat(30)}`;
const CUERPO: CuerpoDeAlta = { token: TOKEN, d: "D".repeat(40), llave: "L".repeat(22), p: "ABCDEFGHIJKL" };
const INICIO = 1_800_000_000_000;

/** Deja correr el reloj falso hasta que todo lo pendiente termine. */
async function correr<T>(promesa: Promise<T>, ms = 300_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promesa;
}

const error = (estado: number, motivo: string, cabeceras?: Record<string, string>): Paso => ({
  estado,
  cuerpo: { error: motivo },
  ...(cabeceras ? { cabeceras } : {}),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(INICIO);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Corrida {
  resultado: AltaEnCampana;
  llamadas: Llamada[];
  avisos: { aviso: string; en: number }[];
}

async function alta(
  pasos: Paso[],
  o: { azar?: number; inicio?: number; sosiego?: SosiegoDelAlta } = {},
): Promise<Corrida> {
  const { f, llamadas } = fetchFalso(pasos);
  const avisos: { aviso: string; en: number }[] = [];
  const promesa = anotarmeEnCampana(
    SERVICIO,
    SALA,
    CUERPO,
    { fetch: f, azar: () => o.azar ?? 0.5 },
    (aviso) => avisos.push({ aviso, en: Date.now() }),
    { ...(o.inicio === undefined ? {} : { inicio: o.inicio }), ...(o.sosiego ? { sosiego: o.sosiego } : {}) },
  );
  const resultado = await correr(promesa);
  return { resultado, llamadas, avisos };
}

describe("anotarmeEnCampana: lo que contesta la sala", () => {
  const filas: { nombre: string; paso: Paso; esperado: AltaEnCampana }[] = [
    {
      nombre: "201 con cuenta es un alta nueva",
      paso: { estado: 201, cuerpo: { cuenta: CUENTA } },
      esperado: { ok: true, cuenta: CUENTA, ya: false },
    },
    {
      nombre: "200 con ya es que ya estaba",
      paso: { estado: 200, cuerpo: { cuenta: CUENTA, ya: true } },
      esperado: { ok: true, cuenta: CUENTA, ya: true },
    },
    { nombre: "200 sin ya no se entiende", paso: { estado: 200, cuerpo: { cuenta: CUENTA } }, esperado: { ok: false, motivo: "otro" } },
    { nombre: "201 sin cuenta no se entiende", paso: { estado: 201, cuerpo: {} }, esperado: { ok: false, motivo: "otro" } },
    {
      nombre: "201 con una cuenta en minúsculas no se entiende",
      paso: { estado: 201, cuerpo: { cuenta: CUENTA.toLowerCase() } },
      esperado: { ok: false, motivo: "otro" },
    },
    { nombre: "429 llena es llena", paso: error(429, "llena"), esperado: { ok: false, motivo: "llena" } },
    { nombre: "409 cerrada es cerro", paso: error(409, "cerrada"), esperado: { ok: false, motivo: "cerro" } },
    { nombre: "404 es cerro", paso: error(404, "no-existe"), esperado: { ok: false, motivo: "cerro" } },
    { nombre: "409 pase es pase", paso: error(409, "pase"), esperado: { ok: false, motivo: "pase" } },
    { nombre: "409 quitada es quitada", paso: error(409, "quitada"), esperado: { ok: false, motivo: "quitada" } },
    { nombre: "401 sesion es sesion", paso: error(401, "sesion"), esperado: { ok: false, motivo: "sesion" } },
    { nombre: "400 forma es sesion", paso: error(400, "forma"), esperado: { ok: false, motivo: "sesion" } },
    { nombre: "403 otra-app es otro y no sesion", paso: error(403, "otra-app"), esperado: { ok: false, motivo: "otro" } },
    { nombre: "403 solo-google es solo-google", paso: error(403, "solo-google"), esperado: { ok: false, motivo: "solo-google" } },
    { nombre: "409 ajena es otro", paso: error(409, "ajena"), esperado: { ok: false, motivo: "otro" } },
    { nombre: "403 origen es otro", paso: error(403, "origen"), esperado: { ok: false, motivo: "otro" } },
    {
      nombre: "un cuerpo que no se entiende con otro estado es otro",
      paso: { estado: 418, texto: "soy una tetera" },
      esperado: { ok: false, motivo: "otro" },
    },
    {
      nombre: "429 cupo-conexion es wifi, sin esperar",
      paso: error(429, "cupo-conexion", { "Retry-After": "600" }),
      esperado: { ok: false, motivo: "wifi" },
    },
    {
      nombre: "429 rechazos es espera marcada por rechazos y no wifi, sin esperar",
      paso: error(429, "rechazos", { "Retry-After": "600" }),
      esperado: { ok: false, motivo: "espera", porRechazos: true },
    },
    { nombre: "503 sin-pollar es proveedor, sin esperar", paso: error(503, "sin-pollar"), esperado: { ok: false, motivo: "proveedor" } },
  ];
  for (const fila of filas) {
    it(fila.nombre, async () => {
      const r = await alta([fila.paso]);
      expect(r.resultado).toEqual(fila.esperado);
      expect(r.llamadas).toHaveLength(1);
      expect(r.avisos).toEqual([]);
    });
  }
});

describe("anotarmeEnCampana: lo que se repite solo", () => {
  const nueva: Paso = { estado: 201, cuerpo: { cuenta: CUENTA } };

  it("con 429 rapido tres veces y después 201 devuelve ok y avisa mucha a los 10, 20 y 31,5 segundos", async () => {
    const r = await alta([error(429, "rapido"), error(429, "rapido"), error(429, "rapido"), nueva]);
    expect(r.resultado).toEqual({ ok: true, cuenta: CUENTA, ya: false });
    expect(r.avisos.map((a) => a.aviso)).toEqual(["mucha", "mucha", "mucha"]);
    // La última espera llega al cambio de minuto (a los 60 segundos) más un poco de azar.
    expect(r.llamadas.map((l) => (l.en - INICIO) / 1000)).toEqual([0, 10, 30, 61.5]);
  });

  it("con el azar al mínimo y el primer pedido a los 5 segundos del minuto, el último pedido de rapido ya cruzó el minuto", async () => {
    vi.setSystemTime(INICIO + 5_000);
    const r = await alta([error(429, "rapido")], { azar: 0 });
    expect(r.llamadas).toHaveLength(4);
    // Sin estirar la última espera, los cuatro pedidos caían entre el segundo 5 y el 50 del mismo minuto.
    expect((r.llamadas[3]?.en ?? 0) - INICIO).toBeGreaterThanOrEqual(60_000);
  });

  it("la espera de rapido que dice la sala no se estira hasta el minuto antes de la última", async () => {
    const r = await alta([error(429, "rapido", { "Retry-After": "12" }), error(429, "rapido"), nueva]);
    expect(r.llamadas.slice(0, 2).map((l) => (l.en - INICIO) / 1000)).toEqual([0, 12]);
  });

  it("con Retry-After de 12 el segundo pedido sale a los 12 segundos y no a los 10", async () => {
    const r = await alta([error(429, "rapido", { "Retry-After": "12" }), nueva]);
    expect(r.llamadas.map((l) => (l.en - INICIO) / 1000)).toEqual([0, 12]);
  });

  it("con Retry-After de 600 el segundo pedido sale a los 30 segundos", async () => {
    const r = await alta([error(429, "rapido", { "Retry-After": "600" }), nueva]);
    expect(r.llamadas.map((l) => (l.en - INICIO) / 1000)).toEqual([0, 30]);
  });

  it("con 429 rapido cuatro veces devuelve wifi tras cuatro pedidos", async () => {
    const r = await alta([error(429, "rapido")]);
    expect(r.resultado).toEqual({ ok: false, motivo: "wifi" });
    expect(r.llamadas).toHaveLength(4);
  });

  it("con 409 sin-billetera avisa creando a los 6 y 15 segundos y al final da cuentas", async () => {
    const r = await alta([error(409, "sin-billetera")]);
    expect(r.resultado).toEqual({ ok: false, motivo: "cuentas" });
    expect(r.avisos.map((a) => a.aviso)).toEqual(["creando", "creando"]);
    expect(r.llamadas.map((l) => (l.en - INICIO) / 1000)).toEqual([0, 6, 21]);
  });

  it("un toque con 409 sin-billetera hace tres pedidos: gasta tres de los cinco rechazos de la ficha", async () => {
    const r = await alta([error(409, "sin-billetera")]);
    expect(r.llamadas).toHaveLength(3);
  });

  it("si el tope de intentos llega después de sin-billetera, dice cuentas y no espera", async () => {
    const r = await alta([error(409, "sin-billetera"), error(429, "rechazos")]);
    expect(r.resultado).toEqual({ ok: false, motivo: "cuentas", porRechazos: true });
    expect(r.llamadas).toHaveLength(2);
  });

  it("si el tope de intentos llega después de otra familia, sigue diciendo espera", async () => {
    const r = await alta([error(502, "pollar"), error(429, "rechazos")]);
    expect(r.resultado).toEqual({ ok: false, motivo: "espera", porRechazos: true });
  });

  it("con 502 pollar cuatro veces devuelve proveedor y avisa mucha", async () => {
    const r = await alta([error(502, "pollar")]);
    expect(r.resultado).toEqual({ ok: false, motivo: "proveedor" });
    expect(r.avisos.map((a) => a.aviso)).toEqual(["mucha", "mucha", "mucha"]);
    expect(r.llamadas.map((l) => (l.en - INICIO) / 1000)).toEqual([0, 5, 15, 35]);
  });

  it("un 500 con un cuerpo de texto se repite y después anota", async () => {
    const r = await alta([{ estado: 500, texto: "error interno" }, nueva]);
    expect(r.resultado).toEqual({ ok: true, cuenta: CUENTA, ya: false });
    expect(r.llamadas).toHaveLength(2);
    expect(r.avisos.map((a) => a.aviso)).toEqual(["mucha"]);
  });

  it("un 503 con una página HTML se repite y al final da proveedor", async () => {
    const r = await alta([{ estado: 503, texto: "<html>Service Unavailable</html>" }]);
    expect(r.resultado).toEqual({ ok: false, motivo: "proveedor" });
    expect(r.llamadas).toHaveLength(4);
  });

  it("con el azar en los extremos la primera espera de rapido queda entre 7,5 y 12,5 segundos", async () => {
    const separacion = (c: Corrida): number => (c.llamadas[1]?.en ?? 0) - (c.llamadas[0]?.en ?? 0);
    expect(separacion(await alta([error(429, "rapido"), nueva], { azar: 0 }))).toBe(7_500);
    expect(separacion(await alta([error(429, "rapido"), nueva], { azar: 1 }))).toBe(12_500);
  });

  it("el cuerpo se repite igual en cada intento", async () => {
    const r = await alta([error(502, "pollar"), nueva]);
    expect(r.llamadas[0]?.init.body).toBe(r.llamadas[1]?.init.body);
  });
});

describe("anotarmeEnCampana: lo que pasa sin respuesta", () => {
  it("un pedido sin respuesta en 25 segundos se manda una vez más a los 3 segundos", async () => {
    const r = await alta(["colgado", { estado: 201, cuerpo: { cuenta: CUENTA } }]);
    expect(r.resultado).toEqual({ ok: true, cuenta: CUENTA, ya: false });
    expect(r.llamadas.map((l) => (l.en - INICIO) / 1000)).toEqual([0, TOPE_ALTA_MS / 1000 + 3]);
  });

  it("un tope y después un 200 ya devuelve ok con ya falso, porque la persona se acaba de anotar", async () => {
    const r = await alta(["colgado", { estado: 200, cuerpo: { cuenta: CUENTA, ya: true } }]);
    expect(r.resultado).toEqual({ ok: true, cuenta: CUENTA, ya: false });
  });

  it("dos topes seguidos dan red con exactamente dos pedidos", async () => {
    const r = await alta(["colgado"]);
    expect(r.resultado).toEqual({ ok: false, motivo: "red" });
    expect(r.llamadas).toHaveLength(2);
  });

  it("un corte de red y después un 201 anota con un solo reenvío", async () => {
    const r = await alta(["corte", { estado: 201, cuerpo: { cuenta: CUENTA } }]);
    expect(r.resultado).toEqual({ ok: true, cuenta: CUENTA, ya: false });
    expect(r.llamadas).toHaveLength(2);
  });

  it("sin sin respuesta previa, un 200 ya sigue siendo ya", async () => {
    const r = await alta([{ estado: 200, cuerpo: { cuenta: CUENTA, ya: true } }]);
    expect(r.resultado).toEqual({ ok: true, cuenta: CUENTA, ya: true });
  });
});

describe("anotarmeEnCampana: los topes por toque", () => {
  it("pasado el tope del toque no arranca otro pedido y devuelve el final de la familia", async () => {
    const r = await alta([error(429, "rapido")], { inicio: INICIO - (TOPE_TOQUE_MS - 5_000) });
    expect(r.resultado).toEqual({ ok: false, motivo: "wifi" });
    expect(r.llamadas).toHaveLength(1);
  });

  it("un pedido sin respuesta pasado el tope del toque no se reenvía", async () => {
    const r = await alta(["colgado"], { inicio: INICIO - (TOPE_TOQUE_MS - 5_000) });
    expect(r.resultado).toEqual({ ok: false, motivo: "red" });
    expect(r.llamadas).toHaveLength(1);
  });

  it("si el toque anterior terminó en un final de familia hace menos de 60 segundos, hace un solo pedido", async () => {
    const sosiego: SosiegoDelAlta = { finalDeFamiliaEn: INICIO - 10_000 };
    const r = await alta([error(502, "pollar")], { sosiego });
    expect(r.resultado).toEqual({ ok: false, motivo: "proveedor" });
    expect(r.llamadas).toHaveLength(1);
    expect(r.avisos).toEqual([]);
  });

  it("pasados los 60 segundos del sosiego vuelve a reintentar", async () => {
    const sosiego: SosiegoDelAlta = { finalDeFamiliaEn: INICIO - SOSIEGO_MS - 1 };
    const r = await alta([error(502, "pollar")], { sosiego });
    expect(r.llamadas).toHaveLength(4);
  });

  it("un final de familia deja la hora del sosiego y un alta lograda la borra", async () => {
    const sosiego: SosiegoDelAlta = { finalDeFamiliaEn: null };
    await alta([error(429, "rapido")], { sosiego });
    expect(sosiego.finalDeFamiliaEn).not.toBeNull();
    sosiego.finalDeFamiliaEn = Date.now() - SOSIEGO_MS - 1;
    await alta([{ estado: 201, cuerpo: { cuenta: CUENTA } }], { sosiego });
    expect(sosiego.finalDeFamiliaEn).toBeNull();
  });
});

describe("anotarmeEnCampana: el token", () => {
  it("el token va solo en el cuerpo del alta y nada se escribe en la consola", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    const r = await alta([error(502, "pollar"), { estado: 201, cuerpo: { cuenta: CUENTA } }]);
    for (const llamada of r.llamadas) {
      expect(llamada.url).not.toContain(TOKEN);
      expect(JSON.stringify(llamada.init.headers ?? {})).not.toContain(TOKEN);
      expect(String(llamada.init.body)).toContain(TOKEN);
      expect(llamada.init.method).toBe("POST");
    }
    for (const espia of consola) expect(espia).not.toHaveBeenCalled();
  });

  it("el alta no manda cabecera de tipo application/json, para no pedir permiso antes", async () => {
    const r = await alta([{ estado: 201, cuerpo: { cuenta: CUENTA } }]);
    const cabeceras = new Headers(r.llamadas[0]?.init.headers);
    expect(cabeceras.get("Content-Type")).toBeNull();
  });

  it("el cuerpo trae token, d, llave y p, y p va en null si no hay pase", async () => {
    const { f, llamadas } = fetchFalso([{ estado: 201, cuerpo: { cuenta: CUENTA } }]);
    await correr(anotarmeEnCampana(SERVICIO, SALA, { ...CUERPO, p: null }, { fetch: f }));
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ token: TOKEN, d: CUERPO.d, llave: CUERPO.llave, p: null });
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/alta`);
  });
});

describe("estadoPublico", () => {
  const bueno = { fase: "abierta", total: 37, cierraMs: 1_800_000_100_000, pase: "vale", quitadas: { repetida: 1 }, vias: { google: 3 } };

  it("manda p en la dirección solo si hay pase", async () => {
    const con = fetchFalso([{ estado: 200, cuerpo: bueno }]);
    await estadoPublico(SERVICIO, SALA, "ABCDEFGHIJKL", { fetch: con.f });
    expect(con.llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/estado?p=ABCDEFGHIJKL`);
    const sin = fetchFalso([{ estado: 200, cuerpo: bueno }]);
    await estadoPublico(SERVICIO, SALA, null, { fetch: sin.f });
    expect(sin.llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/estado`);
  });

  it("deja solo los cuatro campos que usa el celular", async () => {
    const r = await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 200, cuerpo: bueno }]).f });
    expect(r).toEqual({ fase: "abierta", total: 37, cierraMs: 1_800_000_100_000, pase: "vale" });
  });

  it("con una fase que no existe da red", async () => {
    const r = await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 200, cuerpo: { ...bueno, fase: "dormida" } }]).f });
    expect(r).toBe("red");
  });

  it("con un total que no es un entero da red", async () => {
    const r = await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 200, cuerpo: { ...bueno, total: 1.5 } }]).f });
    expect(r).toBe("red");
  });

  it("con un pase que no es uno de los tres da red", async () => {
    const r = await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 200, cuerpo: { ...bueno, pase: "quizas" } }]).f });
    expect(r).toBe("red");
  });

  it("con 404 da terminada", async () => {
    const r = await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([error(404, "no-existe")]).f });
    expect(r).toBe("terminada");
  });

  it("con un 500 o una respuesta que no es JSON da red", async () => {
    expect(await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 500, texto: "caído" }]).f })).toBe("red");
    expect(await estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 200, texto: "no es json" }]).f })).toBe("red");
  });

  it("sin respuesta en 8 segundos da red", async () => {
    const { f, llamadas } = fetchFalso(["colgado"]);
    const promesa = estadoPublico(SERVICIO, SALA, null, { fetch: f });
    expect(await correr(promesa, TOPE_PEDIDO_MS)).toBe("red");
    expect(llamadas).toHaveLength(1);
  });
});

describe("miEstado", () => {
  const bueno = { fase: "sorteada", total: 40, cierraMs: 1_800_000_100_000, anotada: true };

  it("trae quitada, gano y avisado cuando vienen con su tipo", async () => {
    const r = await miEstado(SERVICIO, SALA, CUENTA, "L".repeat(22), {
      fetch: fetchFalso([{ estado: 200, cuerpo: { ...bueno, quitada: "evento", gano: true, avisado: true, puesto: 2 } }]).f,
    });
    expect(r).toEqual({ ...bueno, quitada: "evento", gano: true, avisado: true });
  });

  it("no trae gano si la sala manda gano como texto", async () => {
    const r = await miEstado(SERVICIO, SALA, CUENTA, "L".repeat(22), {
      fetch: fetchFalso([{ estado: 200, cuerpo: { ...bueno, gano: "si", avisado: "si", quitada: "inventado" } }]).f,
    });
    expect(r).toEqual(bueno);
  });

  it("manda la cuenta y la llave en el cuerpo, sin cabecera de tipo", async () => {
    const { f, llamadas } = fetchFalso([{ estado: 200, cuerpo: bueno }]);
    await miEstado(SERVICIO, SALA, CUENTA, "L".repeat(22), { fetch: f });
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/yo`);
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ cuenta: CUENTA, llave: "L".repeat(22) });
    expect(new Headers(llamadas[0]?.init.headers).get("Content-Type")).toBeNull();
  });

  it("sin anotada booleana da red, con 404 terminada y sin respuesta en 8 segundos red", async () => {
    const sinAnotada = { fase: "abierta", total: 1, cierraMs: 1 };
    expect(await miEstado(SERVICIO, SALA, CUENTA, "L".repeat(22), { fetch: fetchFalso([{ estado: 200, cuerpo: sinAnotada }]).f })).toBe("red");
    expect(await miEstado(SERVICIO, SALA, CUENTA, "L".repeat(22), { fetch: fetchFalso([error(404, "no-existe")]).f })).toBe("terminada");
    const promesa = miEstado(SERVICIO, SALA, CUENTA, "L".repeat(22), { fetch: fetchFalso(["colgado"]).f });
    expect(await correr(promesa, TOPE_PEDIDO_MS)).toBe("red");
  });
});

describe("resultadoDeCampana", () => {
  it("con 404 sin-resultado da null", async () => {
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([error(404, "sin-resultado")]).f })).toBeNull();
  });

  it("con 404 no-existe da terminada", async () => {
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([error(404, "no-existe")]).f })).toBe("terminada");
  });

  it("devuelve las ganadoras y el comprobante", async () => {
    const cuerpo = { sorteo: "9", ganadoras: [CUENTA], comprobante: "/verificar.html?id=9" };
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([{ estado: 200, cuerpo }]).f })).toEqual({
      ganadoras: [CUENTA],
      comprobante: "/verificar.html?id=9",
    });
  });

  it("un comprobante que no empieza con la página de verificar da null", async () => {
    const cuerpo = { ganadoras: [CUENTA], comprobante: "https://otro.example.org/x" };
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([{ estado: 200, cuerpo }]).f })).toEqual({
      ganadoras: [CUENTA],
      comprobante: null,
    });
  });

  it("una lista de ganadoras con algo que no es una cuenta da red", async () => {
    const cuerpo = { ganadoras: [CUENTA, "hola"], comprobante: null };
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([{ estado: 200, cuerpo }]).f })).toBe("red");
  });
});

describe("cuentaValida", () => {
  it("acepta una G de 56 caracteres en mayúsculas y rechaza minúsculas, 55 caracteres y lo que no es texto", () => {
    expect(cuentaValida(CUENTA)).toBe(true);
    expect(cuentaValida(CUENTA.toLowerCase())).toBe(false);
    expect(cuentaValida(CUENTA.slice(1))).toBe(false);
    expect(cuentaValida(`G${"1".repeat(55)}`)).toBe(false);
    expect(cuentaValida(null)).toBe(false);
  });
});
