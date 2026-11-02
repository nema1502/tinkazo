import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey, esNoDelPortero, esNoQueBloquea } from "./errores";
import { ErrorPortero, TOPE_CUPO_MS, TOPE_CUPO_TRAS_CAIDA_MS, crearPollar, crearPortero, elegirPatrocinador, errorDeRespuesta, esErrorDelPortero, estadoDelPatrocinio, fechaDelCupo, fechaOCercana, leerCupo, olvidarElEstado, olvidarLaCaida, textoDelCupo, ultimoEstado, urlDelPortero } from "./patrocinador";

const URL = "http://127.0.0.1:8794";
const CUENTA = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const HASH = "ab".repeat(32);

const cupo = (extra: Record<string, unknown> = {}) => ({
  prendido: true,
  rige: "portero",
  red: "testnet",
  mes: "2026-11",
  sellos: { usados: 2, max: 20, quedan: 18 },
  sorteos: { usados: 2, max: 40, quedan: 38 },
  liberaEn: Date.UTC(2026, 11, 1),
  ...extra,
});

const responder = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  olvidarElEstado();
  olvidarLaCaida();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("urlDelPortero", () => {
  it("sin la variable no hay portero", () => {
    vi.stubEnv("VITE_PATROCINIO_URL", "");
    expect(urlDelPortero()).toBeNull();
  });
  it("le saca la barra del final", () => {
    vi.stubEnv("VITE_PATROCINIO_URL", `${URL}/`);
    expect(urlDelPortero()).toBe(URL);
  });
});

describe("leerCupo: primero rige, después prendido", () => {
  it("rige pollar sigue con Pollar sin mirar prendido (el Worker lo manda en falso)", () => {
    expect(leerCupo(200, { rige: "pollar", prendido: false, motivo: "pollar" })).toEqual({ rige: "pollar", configurado: true });
    expect(leerCupo(200, { rige: "pollar", prendido: true })).toEqual({ rige: "pollar", configurado: true });
  });
  it("rige portero y prendido: paga el portero, con el cupo", () => {
    const e = leerCupo(200, cupo());
    expect(e.rige).toBe("portero");
    if (e.rige === "portero") expect(e.cupo.sellos.quedan).toBe(18);
  });
  it("rige portero y prendido en falso: cerrado, con el motivo", () => {
    for (const motivo of ["config", "apagado", "fondo"] as const) expect(leerCupo(200, cupo({ prendido: false, motivo }))).toEqual({ rige: "cerrado", motivo });
    expect(leerCupo(200, cupo({ prendido: false }))).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
  });
  it("lo que no se entiende es cerrado", () => {
    expect(leerCupo(500, cupo())).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
    expect(leerCupo(429, { motivo: "cupo-ip" })).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
    expect(leerCupo(200, { rige: "otro", prendido: true })).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
    expect(leerCupo(200, null)).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
  });
});

describe("estadoDelPatrocinio", () => {
  it("sin portero configurado rige Pollar y no consulta nada", async () => {
    const f = vi.fn();
    expect(await estadoDelPatrocinio("G", { url: null, fetch: f as unknown as typeof fetch })).toEqual({ rige: "pollar", configurado: false });
    expect(f).not.toHaveBeenCalled();
  });
  it("consulta /cupo con la cuenta y guarda lo que supo un rato", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => responder(200, cupo()));
    const o = { url: URL, fetch: f as unknown as typeof fetch };
    const a = await estadoDelPatrocinio(CUENTA, o);
    const b = await estadoDelPatrocinio(CUENTA, o);
    expect(a).toEqual(b);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[0]).toBe(`${URL}/v1/patrocinio/cupo?cuenta=${CUENTA}`);
    await estadoDelPatrocinio(CUENTA, { ...o, forzar: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("si el Worker no contesta, cerrado ante la duda, y no se queda guardado", async () => {
    const f = vi.fn(async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    const o = { url: URL, fetch: f as unknown as typeof fetch };
    expect(await estadoDelPatrocinio(CUENTA, o)).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
    expect(ultimoEstado(CUENTA)).toBeNull();
    f.mockImplementation(async () => responder(200, cupo()));
    expect((await estadoDelPatrocinio(CUENTA, o)).rige).toBe("portero");
  });
  it("si contesta algo que no es JSON, cerrado", async () => {
    const f = async () => new Response("<html>1102</html>", { status: 503 });
    expect(await estadoDelPatrocinio(CUENTA, { url: URL, fetch: f as unknown as typeof fetch })).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
  });
});

describe("elegirPatrocinador", () => {
  const billetera = { signAndSubmit: vi.fn(async () => HASH) };
  beforeEach(() => billetera.signAndSubmit.mockClear());

  it("rige pollar: el camino de hoy, firma y manda de una vez", async () => {
    const f = async () => responder(200, { rige: "pollar", prendido: false, motivo: "pollar" });
    const p = await elegirPatrocinador("G", billetera, { url: URL, fetch: f as unknown as typeof fetch });
    expect(p.nombre).toBe("pollar");
    expect(p.firmaAntes).toBe(false);
    expect(await p.mandar("XDR")).toEqual({ status: "PENDING", hash: HASH });
    expect(billetera.signAndSubmit).toHaveBeenCalledWith("XDR");
  });
  it("sin portero configurado: Pollar, sin ninguna consulta", async () => {
    const f = vi.fn();
    const p = await elegirPatrocinador("G", billetera, { url: null, fetch: f as unknown as typeof fetch });
    expect(p.nombre).toBe("pollar");
    expect(f).not.toHaveBeenCalled();
  });
  it("rige portero y prendido: el portero, que se firma antes", async () => {
    const f = async () => responder(200, cupo());
    const p = await elegirPatrocinador("G", billetera, { url: URL, fetch: f as unknown as typeof fetch });
    expect(p.nombre).toBe("portero");
    expect(p.firmaAntes).toBe(true);
  });
  it("portero apagado, sin configuración o sin fondo: cerrado antes de pedir ninguna firma", async () => {
    for (const cuerpo of [cupo({ prendido: false, motivo: "apagado" }), cupo({ prendido: false, motivo: "config" }), cupo({ prendido: false, motivo: "fondo" })]) {
      olvidarElEstado();
      const f = async () => responder(200, cuerpo);
      await expect(elegirPatrocinador("G", billetera, { url: URL, fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ name: "ErrorPortero", motivo: "cerrado" });
    }
  });
  it("Worker caído: cerrado ante la duda, también antes de pedir la firma", async () => {
    const caido = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    await expect(elegirPatrocinador("G", billetera, { url: URL, fetch: caido as unknown as typeof fetch })).rejects.toMatchObject({ motivo: "cerrado" });
    expect(billetera.signAndSubmit).not.toHaveBeenCalled();
  });
});

describe("el portero: mandar", () => {
  const mandar = (f: (url: string, init: RequestInit) => Promise<Response>) => crearPortero(URL, { fetch: f as unknown as typeof fetch }).mandar("XDRFIRMADO");

  it("200 devuelve el hash y cómo la tomó la red, y manda el XDR en JSON", async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => responder(200, { hash: HASH.toUpperCase(), status: "PENDING", quedan: 17, quedanSorteos: 37 }));
    expect(await mandar(f)).toEqual({ status: "PENDING", hash: HASH });
    const [direccion, init] = f.mock.calls[0] as [string, RequestInit];
    expect(direccion).toBe(`${URL}/v1/patrocinio`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ xdr: "XDRFIRMADO" });
  });
  it("DUPLICATE se respeta", async () => {
    expect((await mandar(async () => responder(200, { hash: HASH, status: "DUPLICATE" }))).status).toBe("DUPLICATE");
  });
  it("un 200 sin hash no se toma por bueno", async () => {
    await expect(mandar(async () => responder(200, { status: "PENDING" }))).rejects.toMatchObject({ motivo: "interno" });
  });
  it("después de mandar, lo que queda baja sin preguntar otra vez", async () => {
    const ver = vi.fn(async (_u: string, i?: RequestInit) => (i?.method === "POST" ? responder(200, { hash: HASH, status: "PENDING", quedan: 17, quedanSorteos: 37 }) : responder(200, cupo())));
    const o = { url: URL, fetch: ver as unknown as typeof fetch };
    await estadoDelPatrocinio(CUENTA, o);
    await crearPortero(URL, o).mandar("X");
    const e = ultimoEstado(CUENTA);
    expect(e && e.rige === "portero" && e.cupo.sellos.quedan).toBe(17);
    expect(e && e.rige === "portero" && e.cupo.sorteos.quedan).toBe(37);
  });

  it("429 cupo-cuenta: sellos o sorteos, con cuándo vuelve", async () => {
    const liberaEn = Date.UTC(2026, 11, 1);
    for (const que of ["sellos", "sorteos"] as const) {
      const e = await mandar(async () => responder(429, { motivo: "cupo-cuenta", que, liberaEn, max: 20 })).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErrorPortero);
      expect(e).toMatchObject({ motivo: "cupo-cuenta", estado: 429, que, liberaEn, max: 20, reintentable: false });
      expect(errorKey(e)).toBe(que === "sorteos" ? "porteroCupoSorteos" : "porteroCupoSellos");
      expect(esNoQueBloquea(e)).toBe(true);
    }
  });
  it("503 fondo y 503 apagado: ahora no se puede, sin culpar a la persona", async () => {
    for (const motivo of ["fondo", "apagado"]) {
      const e = await mandar(async () => responder(503, { motivo, rige: "ninguno" })).catch((x: unknown) => x);
      expect(e).toMatchObject({ motivo, estado: 503, reintentable: false });
      expect(errorKey(e)).toBe("porteroFondo");
    }
  });
  it("400 no-permitida y 403 cuenta-ajena: esta cuenta no", async () => {
    const a = await mandar(async () => responder(400, { motivo: "no-permitida", razon: "firma" })).catch((x: unknown) => x);
    const b = await mandar(async () => responder(403, { motivo: "cuenta-ajena" })).catch((x: unknown) => x);
    expect(errorKey(a)).toBe("porteroAjena");
    expect(errorKey(b)).toBe("porteroAjena");
    expect(esNoQueBloquea(a) && esNoQueBloquea(b)).toBe(true);
  });
  it("una comisión pedida de más o una ventana vencida se arreglan armando de nuevo: red ocupada", async () => {
    const a = await mandar(async () => responder(400, { motivo: "no-permitida", razon: "fee-alta", detalle: "inclusion" })).catch((x: unknown) => x);
    const b = await mandar(async () => responder(400, { motivo: "no-permitida", razon: "ventana", detalle: "vencida" })).catch((x: unknown) => x);
    const c = await mandar(async () => responder(400, { motivo: "fee-alta", detalle: "recursos" })).catch((x: unknown) => x);
    const d = await mandar(async () => responder(400, { motivo: "rechazada", codigo: "tx_bad_seq" })).catch((x: unknown) => x);
    for (const e of [a, b, c, d]) expect(errorKey(e)).toBe("busy");
    expect(esNoQueBloquea(a) || esNoQueBloquea(b)).toBe(false);
  });
  it("400 fallaria lleva el error del contrato: se lee como cualquier otro", async () => {
    const e = await mandar(async () => responder(400, { motivo: "fallaria", detalle: "HostError: Error(Contract, #5)" })).catch((x: unknown) => x);
    expect(errorKey(e)).toBe("roundTooSoon");
  });
  it("502 red: se puede mandar la misma otra vez, y cuenta como corte de red", async () => {
    const e = await mandar(async () => responder(502, { motivo: "red", detalle: "TRY_AGAIN_LATER" })).catch((x: unknown) => x);
    expect(e).toMatchObject({ motivo: "red", reintentable: true });
    expect(errorKey(e, { enLinea: true })).toBe("rpcDown");
    expect(errorKey(e, { enLinea: false })).toBe("offline");
  });
  it("un corte de red al mandar sale tal cual, para tratarlo como que quizás llegó", async () => {
    await expect(mandar(async () => Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow("Failed to fetch");
  });
  it("sin cuerpo, el estado dice qué fue", () => {
    expect(errorDeRespuesta(502, null).motivo).toBe("red");
    expect(errorDeRespuesta(500, null).motivo).toBe("interno");
    expect(errorDeRespuesta(418, null).motivo).toBe("desconocido");
  });
  it("el error se reconoce por nombre y forma", () => {
    expect(esErrorDelPortero(new ErrorPortero("fondo", 503))).toBe(true);
    expect(esNoDelPortero({ name: "ErrorPortero", motivo: "fondo", estado: 503 })).toBe(true);
    expect(esNoDelPortero(new Error("fondo"))).toBe(false);
  });
});

describe("la fecha en que vuelve el cupo", () => {
  it("se dice en el día de UTC, en los dos idiomas", () => {
    const ms = Date.UTC(2026, 11, 1);
    expect(fechaDelCupo(ms, "es")).toBe("1 de diciembre");
    expect(fechaDelCupo(ms, "en")).toBe("December 1");
  });
});

describe("crearPollar", () => {
  it("consulta con el mismo estado que el portero", async () => {
    const f = async () => responder(200, cupo());
    const p = crearPollar({ signAndSubmit: async () => HASH }, { url: URL, fetch: f as unknown as typeof fetch });
    expect((await p.consultar(CUENTA)).rige).toBe("portero");
  });
});

describe("las bajas del cliente del portero", () => {
  it("origen, restaurar, tamano y xdr no son de la cuenta: caen en el aviso general, no en 'esta cuenta no puede'", async () => {
    const casos: Array<[number, Record<string, unknown>]> = [
      [403, { motivo: "origen" }],
      [400, { motivo: "no-permitida", razon: "restaurar" }],
      [400, { motivo: "no-permitida", razon: "tamano" }],
      [400, { motivo: "no-permitida", razon: "xdr" }],
    ];
    for (const [estado, cuerpo] of casos) {
      const e = errorDeRespuesta(estado, cuerpo);
      expect(errorKey(e), JSON.stringify(cuerpo)).toBe("unknown");
      expect(esNoQueBloquea(e), JSON.stringify(cuerpo)).toBe(false);
    }
    // Y lo que sí es de la cuenta sigue igual.
    expect(errorKey(errorDeRespuesta(400, { motivo: "no-permitida", razon: "firma" }))).toBe("porteroAjena");
    expect(errorKey(errorDeRespuesta(403, { motivo: "cuenta-ajena" }))).toBe("porteroAjena");
  });

  it("un día que no se puede decir (0, negativo, que no es número, fuera de rango) es 'primero del mes que viene'", () => {
    const cerca = "el mes que viene";
    for (const malo of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 8.7e15, "x", null, undefined]) expect(fechaOCercana(malo, "es", cerca)).toBe(cerca);
    expect(fechaOCercana(Date.UTC(2026, 11, 1), "es", cerca)).toBe("1 de diciembre");
  });

  it("la línea del cupo con liberaEn inválido dice 'el mes que viene' y no una fecha rara", () => {
    const decir = (k: string): string => ({ cupoCero: "Vuelven el {fecha}.", "errAnchor.cupoPronto": "mes que viene" })[k] ?? k;
    const estado = { rige: "portero", cupo: { sellos: { usados: 20, max: 20, quedan: 0 }, sorteos: { usados: 0, max: 40, quedan: 40 }, liberaEn: Number.NaN } } as const;
    expect(textoDelCupo(estado, "es", decir)).toBe("Vuelven el mes que viene.");
  });

  it("leerCupo sin 'sellos' no inventa un cupo de cero: cerrado, y la línea no se muestra", () => {
    const e = leerCupo(200, { rige: "portero", prendido: true });
    expect(e).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
    expect(textoDelCupo(e, "es", (k) => k)).toBeNull();
    expect(leerCupo(200, { rige: "portero", prendido: true, sellos: { usados: 1, max: 20 } })).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
    expect(leerCupo(200, { rige: "portero", prendido: true, sellos: { quedan: 0, max: 20, usados: 20 } }).rige).toBe("portero");
  });

  it("con una consulta en curso, 'forzar' la espera en vez de saltarla", async () => {
    let suelta: (r: Response) => void = () => undefined;
    const f = vi.fn(() => new Promise<Response>((r) => (suelta = r)));
    const o = { url: URL, fetch: f as unknown as typeof fetch };
    const a = estadoDelPatrocinio(CUENTA, o);
    const b = estadoDelPatrocinio(CUENTA, { ...o, forzar: true });
    suelta(responder(200, cupo()));
    expect((await a).rige).toBe("portero");
    expect(await b).toEqual(await a);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("con el Worker colgado, la espera entera es una sola vez por carga; después, corta; y una respuesta la restablece", async () => {
    vi.useFakeTimers();
    try {
      const colgado = vi.fn((_u: string, i?: RequestInit) => new Promise<Response>((_r, rechazar) => i?.signal?.addEventListener("abort", () => rechazar(new DOMException("abort", "AbortError")))));
      const o = { url: URL, fetch: colgado as unknown as typeof fetch, forzar: true };
      let listo = false;
      const primera = estadoDelPatrocinio(CUENTA, o).then((x) => ((listo = true), x));
      await vi.advanceTimersByTimeAsync(TOPE_CUPO_MS - 1);
      expect(listo).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await primera).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
      // La segunda ya no espera los 6 s.
      listo = false;
      const segunda = estadoDelPatrocinio(CUENTA, o).then((x) => ((listo = true), x));
      await vi.advanceTimersByTimeAsync(TOPE_CUPO_TRAS_CAIDA_MS + 1);
      expect(listo).toBe(true);
      expect(await segunda).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
      // Una respuesta del Worker vuelve a los 6 s.
      const vivo = vi.fn(async () => responder(200, cupo()));
      await estadoDelPatrocinio(CUENTA, { ...o, fetch: vivo as unknown as typeof fetch });
      listo = false;
      const tercera = estadoDelPatrocinio(CUENTA, o).then((x) => ((listo = true), x));
      await vi.advanceTimersByTimeAsync(TOPE_CUPO_TRAS_CAIDA_MS + 1);
      expect(listo).toBe(false);
      await vi.advanceTimersByTimeAsync(TOPE_CUPO_MS);
      await tercera;
    } finally {
      vi.useRealTimers();
    }
  });

  it("con la dirección de la cuenta vacía y un portero configurado no se consulta nada", async () => {
    const f = vi.fn();
    const billetera = { signAndSubmit: vi.fn(async () => HASH) };
    await expect(elegirPatrocinador("", billetera, { url: URL, fetch: f as unknown as typeof fetch })).rejects.toMatchObject({ name: "ErrorPortero", motivo: "cerrado" });
    expect(f).not.toHaveBeenCalled();
    // Sin portero configurado no cambia nada: Pollar, como siempre.
    expect((await elegirPatrocinador("", billetera, { url: null, fetch: f as unknown as typeof fetch })).nombre).toBe("pollar");
  });
});
