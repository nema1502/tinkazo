import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOLAR, comisionDe, notaDeLaComision, umbralPagado } from "../campana/comision";
import { PREMIOS_CON_ENVIO_MAXIMOS, leerParaActivar } from "../../workers/sala/src/activar";
import { verificarFirma } from "../../workers/sala/src/firma";
import {
  HORA_DE_LA_PRUEBA,
  LLAVE_AUTO_PUBLICA,
  PREMIO,
  SECRETO_DE_SALA,
  UMBRAL_DE_DOS,
  montarMundoDeActivar,
  type MundoDeActivar,
} from "./activar-mundo";
import { personaDePrueba } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * `POST /v1/activar` con una campaña de personas que reparte dólares digitales: la gente se anota con Google y no recibe
 * ninguna cuenta, y quien organiza le manda el premio a cada persona que gana. La sala la firma sola, como a una de cuentas,
 * solo si tiene las campañas de personas prendidas, con hasta 8 premios y exigiendo en la cuenta los premios más el costo de
 * mandar cada uno. El premio en mano sigue sin activarse solo, y una campaña de cuentas no cambia en nada.
 */
const EVENTO = "casa-andina-k7p2";
const CLIENTE = "cliente-de-prueba.apps.example.org";
const PRENDIDAS = { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE };
const DE_PERSONAS = { identidad: "persona" };
const EN_MANO = { identidad: "persona", premio_en_mano: { es: "Auriculares", en: "Headphones" }, premios: ["0", "0"] };
/** Tantos premios de 50 dólares digitales, como los escribe el archivo. */
const premiosDe = (cuantos: number): string[] => Array.from({ length: cuantos }, () => PREMIO.toString());

let m: MundoDeActivar;

async function montar(extra: Record<string, string> = PRENDIDAS): Promise<void> {
  m = await montarMundoDeActivar(extra);
}

/** El cuerpo del pedido: el texto de la campaña (de personas, si no se dice otra cosa) y la sesión de quien organiza. */
const pedido = (cambios: Record<string, unknown> = DE_PERSONAS, sesion: string = m.organizadora.token) => ({
  texto: JSON.stringify(m.campana(cambios)),
  sesion,
});

/** El texto de la campaña con esos cambios, para el lector. */
const texto = (cambios: Record<string, unknown>): string => JSON.stringify(m.campana(cambios));

/** Nada de la red, del portero ni del proveedor de cuentas se miró. */
function nadieFueConsultado(): void {
  expect(m.horizon.cuentasMiradas).toEqual([]);
  expect(m.horizon.paginasPedidas).toBe(0);
  expect(m.portero.llamadas).toEqual([]);
  expect(m.mundo.proveedor.llamadas["/v3/tokens/verify"] ?? 0).toBe(0);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HORA_DE_LA_PRUEBA);
  await montar();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("activar una campaña de personas con premios en dólares", () => {
  it("con las personas prendidas y el pago hecho firma con la llave automática, y el texto firmado lleva la identidad", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(200);
    const c = (await r.json()) as { texto: string; firma: string; evento: string; organizadora: string };
    expect(c.evento).toBe(EVENTO);
    expect(c.organizadora).toBe(m.organizadora.cuenta);
    expect(c.texto).toBe(JSON.stringify(m.campana(DE_PERSONAS)));
    const firmado = JSON.parse(c.texto) as Record<string, unknown>;
    expect(firmado.identidad).toBe("persona");
    expect(firmado.premios).toEqual(premiosDe(2));
    expect("premio_en_mano" in firmado).toBe(false);
    expect(c.firma).toMatch(/^[0-9a-f]{128}$/);
    expect(verificarFirma(c.texto, c.firma, LLAVE_AUTO_PUBLICA)).toBe(true);
  });

  it("con lo firmado la sala crea una sala de personas", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const archivo = (await (await m.activar(pedido())).json()) as { texto: string; firma: string };
    const creada = await m.mundo.pedir("/v1/campana", { cuerpo: { texto: archivo.texto, firma: archivo.firma } });
    expect(creada.status).toBe(201);
    const { id } = (await creada.json()) as { id: string };
    expect(m.mundo.ejecutar(`sala:${id}`, "SELECT v FROM sala WHERE k = 'identidad'")).toEqual([{ v: "persona" }]);
  });

  it("le pide al portero el acceso de quien organiza, con su cuenta y el evento, y de nadie más", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido())).status).toBe(200);
    expect(m.portero.llamadas).toHaveLength(1);
    expect(m.portero.llamadas[0]?.cabeceras["x-sala-secreto"]).toBe(SECRETO_DE_SALA);
    expect(m.portero.llamadas[0]?.cuerpo).toEqual({ cuenta: m.organizadora.cuenta, evento: EVENTO });
  });

  it("repetir el mismo pedido da la misma firma", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const a = (await (await m.activar(pedido())).json()) as { firma: string; texto: string };
    const b = (await (await m.activar(pedido())).json()) as { firma: string; texto: string };
    expect(b).toEqual(a);
  });
});

describe("con las campañas de personas apagadas en la sala", () => {
  const apagadas: [string, Record<string, string>][] = [
    ["sin ninguna de las dos variables", {}],
    ["DIFERIDA en 0", { DIFERIDA: "0", GOOGLE_CLIENT_ID: CLIENTE }],
    ["DIFERIDA con otro valor que 1", { DIFERIDA: "true", GOOGLE_CLIENT_ID: CLIENTE }],
    ["sin el identificador de Google", { DIFERIDA: "1", GOOGLE_CLIENT_ID: "" }],
  ];

  for (const [nombre, extra] of apagadas) {
    it(`${nombre}: 503 personas-apagadas sin mirar la sesión ni la red, y al prenderlas el mismo pedido firma`, async () => {
      await montar(extra);
      m.horizon.pagos = [m.pagoCompleto(EVENTO)];
      const r = await m.activar(pedido());
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: "personas-apagadas" });
      nadieFueConsultado();
      // Prenderlas no pide nada más: el pedido de antes, con el mismo pago, ahora se firma.
      m.mundo.env.DIFERIDA = "1";
      m.mundo.env.GOOGLE_CLIENT_ID = CLIENTE;
      expect((await m.activar(pedido())).status).toBe(200);
    });
  }

  it("una sesión que el proveedor no conoce recibe lo mismo, sin contar como rechazo", async () => {
    await montar({});
    const mala = "tok_desconocida_xxxxxxxxxxxxxxxxxxxx";
    for (let i = 0; i < 7; i++) {
      const r = await m.activar(pedido(DE_PERSONAS, mala));
      expect(r.status, `pedido ${i}`).toBe(503);
      expect(await r.json()).toEqual({ error: "personas-apagadas" });
    }
    nadieFueConsultado();
  });

  it("una campaña de cuentas se activa igual, con el campo de la identidad o sin él", async () => {
    await montar({});
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido({}))).status).toBe(200);
    expect((await m.activar(pedido({ identidad: "cuenta" }))).status).toBe(200);
  });
});

describe("el premio en mano sigue sin activarse solo", () => {
  const interruptores: [string, Record<string, string>][] = [
    ["con las personas prendidas", PRENDIDAS],
    ["con las personas apagadas", {}],
  ];

  for (const [nombre, extra] of interruptores) {
    it(`${nombre} da 400 forma con el campo premio_en_mano, sin mirar la sesión ni la red`, async () => {
      await montar(extra);
      m.horizon.pagos = [m.pagoCompleto(EVENTO)];
      const r = await m.activar(pedido(EN_MANO));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "forma", campo: "premio_en_mano" });
      nadieFueConsultado();
    });
  }
});

describe("lo de siempre vale igual en una campaña de personas", () => {
  it("sin el pago da 402 no-pagada con lo que falta y la nota, y no llama al portero", async () => {
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "no-pagada", falta: UMBRAL_DE_DOS.toString(), nota: notaDeLaComision(EVENTO) });
    expect(m.portero.llamadas).toEqual([]);
  });

  it("el costo del servicio es el de una campaña de cuentas: un pago de menos dice la misma diferencia", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { monto: "1.0000000" })];
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "no-pagada", falta: (UMBRAL_DE_DOS - 10_000_000n).toString() });
  });

  it("con la sesión de otra cuenta que la del archivo da 403 organizadora", async () => {
    const otra = personaDePrueba(m.mundo, 7);
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido(DE_PERSONAS, otra.token));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "organizadora" });
    expect(m.portero.llamadas).toEqual([]);
  });

  it("una sesión que el proveedor no conoce da 401 sesion", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido(DE_PERSONAS, "tok_desconocida_xxxxxxxxxxxxxxxxxxxx"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "sesion" });
  });
});

describe("los fondos de una campaña de personas", () => {
  it("con dos premios de 50 y el envío a 0,50 hacen falta 101: con 100 y con 100,9999999 no alcanza, con 101 sí", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    m.horizon.saldo = "100.0000000";
    const soloLosPremios = await m.activar(pedido());
    expect(soloLosPremios.status).toBe(402);
    expect(await soloLosPremios.json()).toEqual({ error: "sin-fondos", falta: "10000000" });
    m.horizon.saldo = "100.9999999";
    const casi = await m.activar(pedido());
    expect(casi.status).toBe(402);
    expect(await casi.json()).toEqual({ error: "sin-fondos", falta: "1" });
    expect(m.portero.llamadas).toEqual([]);
    m.horizon.saldo = "101.0000000";
    expect((await m.activar(pedido())).status).toBe(200);
  });

  it("el envío se cuenta una vez por premio: con ocho premios de 50 hacen falta 404", async () => {
    const ocho = Array.from({ length: 8 }, () => PREMIO);
    const umbral = umbralPagado(comisionDe(ocho, 200n, 15_000_000n), 5_000_000n);
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { monto: `${umbral / DOLAR}.${(umbral % DOLAR).toString().padStart(7, "0")}` })];
    m.horizon.saldo = "403.9999999";
    const casi = await m.activar(pedido({ ...DE_PERSONAS, premios: premiosDe(8) }));
    expect(casi.status).toBe(402);
    expect(await casi.json()).toEqual({ error: "sin-fondos", falta: "1" });
    m.horizon.saldo = "404.0000000";
    expect((await m.activar(pedido({ ...DE_PERSONAS, premios: premiosDe(8) }))).status).toBe(200);
  });

  it("una campaña de cuentas sigue pidiendo solo los premios: con 100 alcanza", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    m.horizon.saldo = "100.0000000";
    expect((await m.activar(pedido({}))).status).toBe(200);
    expect((await m.activar(pedido({ identidad: "cuenta" }))).status).toBe(200);
  });
});

describe("el tope de premios de una campaña de personas", () => {
  it("son ocho", () => {
    expect(PREMIOS_CON_ENVIO_MAXIMOS).toBe(8);
  });

  it("el lector rechaza nueve y diez por el campo premios, y acepta de uno a ocho", () => {
    for (const cuantos of [9, 10]) {
      expect(leerParaActivar(texto({ ...DE_PERSONAS, premios: premiosDe(cuantos) }), HORA_DE_LA_PRUEBA), String(cuantos)).toEqual({
        ok: false,
        error: "forma",
        campo: "premios",
      });
    }
    for (const cuantos of [1, 2, 8]) {
      const leida = leerParaActivar(texto({ ...DE_PERSONAS, premios: premiosDe(cuantos) }), HORA_DE_LA_PRUEBA);
      expect(leida, String(cuantos)).toMatchObject({ ok: true, identidad: "persona" });
      if (leida.ok) expect(leida.premios).toHaveLength(cuantos);
    }
  });

  it("una campaña de cuentas sigue llevando hasta diez", () => {
    for (const cambios of [{}, { identidad: "cuenta" }, { identidad: null }]) {
      for (const cuantos of [9, 10]) {
        const leida = leerParaActivar(texto({ ...cambios, premios: premiosDe(cuantos) }), HORA_DE_LA_PRUEBA);
        expect(leida.ok, `${JSON.stringify(cambios)} con ${cuantos}`).toBe(true);
      }
    }
  });

  it("el pedido con nueve premios da 400 forma con el campo premios, sin mirar la sesión ni la red", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido({ ...DE_PERSONAS, premios: premiosDe(9) }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma", campo: "premios" });
    nadieFueConsultado();
  });
});

describe("lo que devuelve el lector de campañas que se activan solas", () => {
  const CLAVES_DE_CUENTAS = ["cierraMs", "compacto", "evento", "lista", "ok", "organizadora", "premios", "sorteoMs"];

  it("una campaña de cuentas trae exactamente las claves de siempre", () => {
    for (const cambios of [{}, { identidad: "cuenta" }]) {
      const leida = leerParaActivar(texto(cambios), HORA_DE_LA_PRUEBA);
      expect(leida.ok, JSON.stringify(cambios)).toBe(true);
      expect(Object.keys(leida).sort(), JSON.stringify(cambios)).toEqual(CLAVES_DE_CUENTAS);
    }
  });

  it("una de personas suma solo la identidad, y lo demás es lo mismo que en la de cuentas", () => {
    const deCuentas = leerParaActivar(texto({}), HORA_DE_LA_PRUEBA);
    const dePersonas = leerParaActivar(texto(DE_PERSONAS), HORA_DE_LA_PRUEBA);
    expect(Object.keys(dePersonas).sort()).toEqual([...CLAVES_DE_CUENTAS, "identidad"].sort());
    expect(dePersonas).toMatchObject({ ok: true, identidad: "persona" });
    if (!deCuentas.ok || !dePersonas.ok) throw new Error("las dos campañas tienen que leerse");
    expect(dePersonas.compacto).toBe(JSON.stringify(m.campana(DE_PERSONAS)));
    expect({ ...dePersonas, compacto: "", identidad: undefined }).toEqual({ ...deCuentas, compacto: "", identidad: undefined });
  });

  it("los premios en cero sin premio en mano no se activan, con identidad de persona o sin ella", () => {
    for (const cambios of [{ ...DE_PERSONAS, premios: ["0", "0"] }, { premios: ["0", "0"] }]) {
      expect(leerParaActivar(texto(cambios), HORA_DE_LA_PRUEBA), JSON.stringify(cambios)).toEqual({ ok: false, error: "forma", campo: "premios" });
    }
  });

  it("las demás reglas valen igual: red principal, un mismo monto y la cuenta de quien organiza escrita", () => {
    expect(leerParaActivar(texto({ ...DE_PERSONAS, red: "testnet" }), HORA_DE_LA_PRUEBA)).toEqual({ ok: false, error: "red", campo: "red" });
    expect(leerParaActivar(texto({ ...DE_PERSONAS, premios: ["500000000", "600000000"] }), HORA_DE_LA_PRUEBA)).toEqual({
      ok: false,
      error: "forma",
      campo: "premios",
    });
    expect(leerParaActivar(texto({ ...DE_PERSONAS, organizadora: null }), HORA_DE_LA_PRUEBA)).toEqual({ ok: false, error: "forma", campo: "organizadora" });
  });
});
