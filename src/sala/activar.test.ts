import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notaDeLaComision } from "../campana/comision";
import { USDC_MAINNET } from "../stellar/pagos";
import { DIAS_PARA_CERRAR, EMISOR_USDC, activarCampana, configDeActivar, nombreImita } from "../../workers/sala/src/activar";import { firmaCanonica, verificarFirma } from "../../workers/sala/src/firma";
import {
  HORA_DE_LA_PRUEBA,
  LLAVE_AUTO_PUBLICA,
  PORTERO,
  SECRETO_DE_SALA,
  UMBRAL_DE_DOS,
  VARIABLES_DE_ACTIVAR,
  montarMundoDeActivar,
  type MundoDeActivar,
} from "./activar-mundo";
import { firmarParaLaPrueba, personaDePrueba } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * `POST /v1/activar`: la sala firma sola la campaña cuando comprueba en la red que la comisión del evento se pagó desde la
 * cuenta de Google de quien organiza. Todo con una sala, un Horizon y un portero de mentira, sin red y sin reloj real.
 */
const EVENTO = "casa-andina-k7p2";

let m: MundoDeActivar;

/** El cuerpo del pedido: el texto de la campaña y la sesión de quien organiza. */
const pedido = (cambios: Record<string, unknown> = {}, sesion: string = m.organizadora.token) => ({
  texto: JSON.stringify(m.campana(cambios)),
  sesion,
});

async function montar(extra: Record<string, string> = {}): Promise<void> {
  m = await montarMundoDeActivar(extra);
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

/** Deja pagada la comisión del evento y contesta el pedido. */
async function activarPagada(cambios: Record<string, unknown> = {}): Promise<Response> {
  m.horizon.pagos = [m.pagoCompleto(EVENTO)];
  return m.activar(pedido(cambios));
}

describe("activar con el pago hecho", () => {
  it("firma el JSON compacto con la llave automática y la firma se verifica con la pública derivada", async () => {
    const r = await activarPagada();
    expect(r.status).toBe(200);
    const c = (await r.json()) as { texto: string; firma: string; evento: string; organizadora: string };
    expect(c.evento).toBe(EVENTO);
    expect(c.organizadora).toBe(m.organizadora.cuenta);
    expect(c.texto).toBe(JSON.stringify(m.campana()));
    expect(c.firma).toMatch(/^[0-9a-f]{128}$/);
    expect(verificarFirma(c.texto, c.firma, LLAVE_AUTO_PUBLICA)).toBe(true);
  });

  it("el texto que vuelve es compacto aunque el pedido venga con espacios y renglones", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const texto = JSON.stringify(m.campana(), null, 2);
    const r = await m.activar({ texto, sesion: m.organizadora.token });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { texto: string }).texto).toBe(JSON.stringify(m.campana()));
  });

  it("varios pagos del mismo evento suman hasta el umbral", async () => {
    // El umbral de esta campaña es 1,50: dos pagos de 0,75 lo alcanzan justo.
    expect(UMBRAL_DE_DOS).toBe(15_000_000n);
    m.horizon.pagos = [
      m.pagoCompleto(EVENTO, { monto: "0.7500000" }),
      m.pagoCompleto(EVENTO, { monto: "0.7500000", cuandoS: Math.floor(HORA_DE_LA_PRUEBA / 1000) - 7_200 }),
    ];
    const r = await m.activar(pedido());
    expect(r.status).toBe(200);
  });

  it("dos pagos que no llegan al umbral juntos no alcanzan", async () => {
    m.horizon.pagos = [
      m.pagoCompleto(EVENTO, { monto: "0.7500000" }),
      m.pagoCompleto(EVENTO, { monto: "0.7499999", cuandoS: Math.floor(HORA_DE_LA_PRUEBA / 1000) - 7_200 }),
    ];
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("un pago sobrado también sirve", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { monto: "40.0000000" })];
    expect((await m.activar(pedido())).status).toBe(200);
  });

  it("con premios chicos, la comisión es el mínimo y alcanza el pago del mínimo menos el costo del retiro", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { monto: "1.0000000" })];
    const r = await m.activar(pedido({ premios: ["10000000"] }));
    expect(r.status).toBe(200);
  });

  it("repetir el mismo pedido da la misma firma y le repite el acceso al portero sin cambiar nada", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const a = (await (await m.activar(pedido())).json()) as { firma: string; texto: string };
    const b = (await (await m.activar(pedido())).json()) as { firma: string; texto: string };
    expect(b).toEqual(a);
    expect(m.portero.llamadas).toHaveLength(2);
    expect(m.portero.llamadas[1]).toEqual(m.portero.llamadas[0]);
  });

  it("le pide acceso al portero con el secreto de la sala y la cuenta y el evento, antes de firmar", async () => {
    await activarPagada();
    expect(m.portero.llamadas).toHaveLength(1);
    const llamada = m.portero.llamadas[0];
    expect(llamada?.cabeceras["x-sala-secreto"]).toBe(SECRETO_DE_SALA);
    expect(llamada?.cuerpo).toEqual({ cuenta: m.organizadora.cuenta, evento: EVENTO });
  });

  it("la cuenta sale de la billetera del proveedor cuando la sesión no la trae", async () => {
    const sinCuenta = personaDePrueba(m.mundo, 2, { wallet: null });
    m.mundo.proveedor.billeteras.set(sinCuenta.usuario, m.organizadora.cuenta);
    m.mundo.proveedor.sesiones.set(sinCuenta.token, { usuario: sinCuenta.usuario, contenido: { wallet: null } });
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido({}, sinCuenta.token))).status).toBe(200);
  });
});

describe("sin el pago", () => {
  it("sin ningún pago da 402 no-pagada con lo que falta y la nota, y no firma ni llama al portero", async () => {
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "no-pagada", falta: UMBRAL_DE_DOS.toString(), nota: notaDeLaComision(EVENTO) });
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("un pago de menos dice cuánto falta", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { monto: "1.0000000" })];
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "no-pagada", falta: (UMBRAL_DE_DOS - 10_000_000n).toString() });
  });

  it("un pago de otra cuenta no cuenta", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: Keypair.random().publicKey() })];
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("un pago de otro evento no cuenta", async () => {
    m.horizon.pagos = [m.pagoCompleto("casa-andina-zzzz")];
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("un pago de hace más de 30 días no cuenta", async () => {
    const viejo = Math.floor(HORA_DE_LA_PRUEBA / 1000) - 31 * 86_400;
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { cuandoS: viejo })];
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("un pago de justo menos de 30 días sí cuenta", async () => {
    const casi = Math.floor(HORA_DE_LA_PRUEBA / 1000) - 29 * 86_400;
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { cuandoS: casi })];
    expect((await m.activar(pedido())).status).toBe(200);
  });

  it("una nota de texto con el mismo número no cuenta: tiene que ser una nota numérica", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { tipoDeNota: "text" })];
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("otro activo con el mismo código, otro emisor o un pago fallido no cuentan", async () => {
    m.horizon.pagos = [
      m.pagoCompleto(EVENTO, { emisor: Keypair.random().publicKey() }),
      m.pagoCompleto(EVENTO, { codigo: "EURC" }),
      m.pagoCompleto(EVENTO, { exitoso: false }),
      m.pagoCompleto(EVENTO, { to: Keypair.random().publicKey() }),
    ];
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("los pagos de otras cuentas no le suman a quien organiza", async () => {
    const otra = Keypair.random().publicKey();
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: otra }), m.pagoCompleto(EVENTO, { monto: "0.5000000" })];
    expect((await m.activar(pedido())).status).toBe(402);
  });
});

describe("cuando la red no ayuda no se firma", () => {
  it("con Horizon caído da 502 red y no llama al portero", async () => {
    m.horizon.caido = true;
    const r = await m.activar(pedido());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "red" });
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("con más pagos de los que se alcanzan a mirar y sin llegar al umbral da 502 red", async () => {
    const reciente = Math.floor(HORA_DE_LA_PRUEBA / 1000) - 60;
    m.horizon.pagos = Array.from({ length: 600 }, () => m.pagoCompleto("casa-andina-zzzz", { cuandoS: reciente }));
    const r = await m.activar(pedido());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "red" });
    expect(m.horizon.paginasPedidas).toBe(3);
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("si el pago está dentro de las primeras tres páginas, firma aunque haya más", async () => {
    const reciente = Math.floor(HORA_DE_LA_PRUEBA / 1000) - 60;
    const relleno = Array.from({ length: 450 }, () => m.pagoCompleto("casa-andina-zzzz", { cuandoS: reciente }));
    m.horizon.pagos = [...relleno, m.pagoCompleto(EVENTO), ...relleno];
    expect((await m.activar(pedido())).status).toBe(200);
  });

  it("muchos pagos chicos de otras cuentas a la de Tinkazo no tapan el pago de la empresa", async () => {
    const despues = Math.floor(HORA_DE_LA_PRUEBA / 1000) - 60;
    const relleno = Array.from({ length: 700 }, () => m.pagoCompleto("relleno", { from: Keypair.random().publicKey(), monto: "0.0100000", cuandoS: despues }));
    m.horizon.pagos = [...relleno, m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido())).status).toBe(200);
    expect(m.horizon.cuentasMiradas).toEqual([m.organizadora.cuenta]);
  });

  it("la cuenta de quien organiza que no existe en la red no pagó nada: 402 sin dudar", async () => {
    m.horizon.pagosSinCuenta = true;
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "no-pagada" });
  });

  it("una cuenta con páginas llenas pero todas viejas termina en 402 sin dudar", async () => {
    const viejo = Math.floor(HORA_DE_LA_PRUEBA / 1000) - 40 * 86_400;
    m.horizon.pagos = Array.from({ length: 600 }, () => m.pagoCompleto("casa-andina-zzzz", { cuandoS: viejo }));
    expect((await m.activar(pedido())).status).toBe(402);
  });

  it("con el portero caído da 502 acceso y no firma", async () => {
    m.portero.modo = "corte";
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "acceso" });
  });

  it("si el portero rechaza da 502 acceso y no firma", async () => {
    m.portero.modo = "rechaza";
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "acceso" });
  });

  it("con el tope del día del portero lleno da 429 cupo-portero con la espera hasta que se libera, y no firma", async () => {
    m.portero.modo = "cupo";
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "cupo-portero" });
    expect(r.headers.get("Retry-After")).toBe(String(2 * 3_600));
  });

  it("con Horizon sin la cuenta de quien organiza (404) no hay fondos", async () => {
    m.horizon.saldo = null;
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "sin-fondos" });
  });
});

describe("los fondos", () => {
  it("con menos dólares que el total de los premios da 402 sin-fondos y dice cuánto falta", async () => {
    m.horizon.saldo = "99.0000000";
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "sin-fondos", falta: "10000000" });
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("con justo el total de los premios alcanza", async () => {
    m.horizon.saldo = "100.0000000";
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido())).status).toBe(200);
  });
});

describe("la sesión", () => {
  it("una sesión que el proveedor no conoce da 401 sesion", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido({}, "tok_desconocida_xxxxxxxxxxxxxxxxxxxx"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "sesion" });
  });

  it("una sesión sin forma de ficha da 401 sesion sin llamar al proveedor", async () => {
    const r = await m.activar(pedido({}, "corta"));
    expect(r.status).toBe(401);
    expect(m.mundo.proveedor.llamadas["/v3/tokens/verify"] ?? 0).toBe(0);
  });

  it("una sesión de correo da 403 no-google", async () => {
    const correo = personaDePrueba(m.mundo, 5, { authProvider: "email" });
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: correo.cuenta })];
    const r = await m.activar({ texto: JSON.stringify(m.campana({ organizadora: correo.cuenta })), sesion: correo.token });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "no-google" });
  });

  it("cuando rechaza por la vía deja una sola línea con el valor saneado y el modo, y nada de la persona", async () => {
    const espia = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const correo = personaDePrueba(m.mundo, 5, { authProvider: "EMAIL" });
      m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: correo.cuenta })];
      const r = await m.activar({ texto: JSON.stringify(m.campana({ organizadora: correo.cuenta })), sesion: correo.token });
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "no-google" });
      const lineas = espia.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("via-rechazada"));
      expect(lineas).toEqual([JSON.stringify({ evento: "via-rechazada", datos: { valor: "email", modo: "estricto" } })]);
      for (const secreto of [correo.token, correo.cuenta, correo.usuario, "190.129.10.20"]) expect(lineas[0]).not.toContain(secreto);
    } finally {
      espia.mockRestore();
    }
  });

  it("una sesión de Google no deja la línea de la vía rechazada", async () => {
    const espia = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const google = personaDePrueba(m.mundo, 5, { authProvider: "GOOGLE" });
      m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: google.cuenta })];
      await m.activar({ texto: JSON.stringify(m.campana({ organizadora: google.cuenta })), sesion: google.token });
      expect(espia.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("via-rechazada"))).toEqual([]);
    } finally {
      espia.mockRestore();
    }
  });

  it("una sesión que no dice por dónde entró tampoco pasa en modo estricto", async () => {
    const sinDato = personaDePrueba(m.mundo, 6, { authProvider: undefined });
    const r = await m.activar({ texto: JSON.stringify(m.campana({ organizadora: sinDato.cuenta })), sesion: sinDato.token });
    expect(r.status).toBe(403);
  });

  it("con la lista de la sala en modo suave, la activación sigue pidiendo Google", async () => {
    await montar({ SOLO_GOOGLE: "suave" });
    const sinDato = personaDePrueba(m.mundo, 6, { authProvider: undefined });
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { from: sinDato.cuenta })];
    const r = await m.activar({ texto: JSON.stringify(m.campana({ organizadora: sinDato.cuenta })), sesion: sinDato.token });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "no-google" });
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("una sesión de otra cuenta que la del archivo da 403 organizadora", async () => {
    const otra = personaDePrueba(m.mundo, 7);
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido({}, otra.token));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "organizadora" });
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("el proveedor caído da 502 red", async () => {
    m.mundo.proveedor.caido = true;
    const r = await m.activar(pedido());
    expect(r.status).toBe(502);
  });

  it("sin la llave secreta del proveedor da 503 sin-pollar", async () => {
    await montar({ POLLAR_SECRETO: "" });
    const r = await m.activar(pedido());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "sin-pollar" });
  });
});

describe("el texto de la campaña", () => {
  const rechazada = async (cambios: Record<string, unknown>, campo: string): Promise<void> => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido(cambios));
    expect(r.status, campo).toBe(400);
    expect(await r.json()).toEqual({ error: "forma", campo });
    expect(m.portero.llamadas).toHaveLength(0);
  };

  it("un premio de menos de un dólar digital no se firma", async () => {
    await rechazada({ premios: ["9000000", "9000000"] }, "premios");
  });

  it("un premio de más de 10.000 dólares digitales no se firma", async () => {
    await rechazada({ premios: ["100000100000"] }, "premios");
  });

  it("los premios de montos distintos no se firman", async () => {
    await rechazada({ premios: ["500000000", "600000000"] }, "premios");
  });

  it("más de diez premios o ninguno no se firman", async () => {
    await rechazada({ premios: Array.from({ length: 11 }, () => "500000000") }, "premios");
    await rechazada({ premios: [] }, "premios");
  });

  it("un premio con fracción de centavo no se firma", async () => {
    await rechazada({ premios: ["500000001"] }, "premios");
  });

  it("el límite de 10.000 dólares por premio sí entra, con diez premios", async () => {
    m.horizon.saldo = "1000000.0000000";
    const premios = Array.from({ length: 10 }, () => "100000000000");
    // La comisión de un millón de dólares es de 20.000: el pago de esta prueba alcanza con ese monto.
    m.horizon.pagos = [m.pagoCompleto(EVENTO, { monto: "20000.0000000" })];
    expect((await m.activar(pedido({ premios }))).status).toBe(200);
  });

  it("un nombre de empresa con Tinkazo no se firma, ni con acentos, mayúsculas o signos", async () => {
    for (const nombre of ["Tinkazo", "TÍNKAZO Premios", "Mi t.i.n.k.a.z.o", "Los tinkazo"]) {
      await rechazada({ empresa: { nombre, logo: null, color: "verde" } }, "empresa.nombre");
    }
  });

  it("tampoco con letras anchas, de fórmula, cirílicas, griegas o cifras en lugar de letras", async () => {
    const disfraces = [
      "Ｔｉｎｋａｚｏ", // letras anchas
      "\u{1d42d}\u{1d422}\u{1d427}\u{1d424}\u{1d41a}\u{1d433}\u{1d428}", // negritas de fórmula
      "Tinkаzо", // a y o cirílicas
      "Tιnkαzο", // iota, alfa y ómicron griegas
      "T1nkaz0",
      "TINK​AZO", // con un espacio invisible
    ];
    for (const nombre of disfraces) {
      expect(nombreImita(nombre), nombre).toBe(true);
      await rechazada({ empresa: { nombre, logo: null, color: "verde" } }, "empresa.nombre");
    }
  });

  it("un nombre sin la palabra pasa", () => {
    for (const nombre of ["Casa Andina", "Tinka", "Kazo SRL"]) expect(nombreImita(nombre), nombre).toBe(false);
  });

  it("una campaña de la red de prueba da 400 red", async () => {
    const r = await m.activar(pedido({ red: "testnet" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "red" });
  });

  it("solo entrada con Google, abierta, sin anotadas ni contrato, promo o comprobante", async () => {
    await rechazada({ entrada: "google-correo" }, "entrada");
    await rechazada({ estado: "cerrada" }, "estado");
    await rechazada({ anotadas: 3 }, "anotadas");
    await rechazada({ contrato: `C${"A".repeat(55)}` }, "contrato");
    await rechazada({ promo: "12" }, "promo");
    await rechazada({ comprobante: "/verificar.html" }, "comprobante");
  });

  it("sin la cuenta de quien organiza no se firma", async () => {
    await rechazada({ organizadora: null }, "organizadora");
  });

  it("el cierre tiene que caer en los próximos 7 días y el sorteo hasta un día después", async () => {
    const dia = 86_400_000;
    await rechazada({ cierra_ms: HORA_DE_LA_PRUEBA + 7 * dia + 1, sorteo_ms: HORA_DE_LA_PRUEBA + 7 * dia + 2 }, "cierra_ms");
    await rechazada({ cierra_ms: HORA_DE_LA_PRUEBA - 1 }, "cierra_ms");
    await rechazada({ sorteo_ms: HORA_DE_LA_PRUEBA + 3_600_000 + dia + 1 }, "sorteo_ms");
    await rechazada({ sorteo_ms: HORA_DE_LA_PRUEBA + 3_599_999 }, "sorteo_ms");
  });

  it("el cierre a los 7 días justos y el sorteo un día después entran", async () => {
    const dia = 86_400_000;
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const cierre = HORA_DE_LA_PRUEBA + 7 * dia;
    expect((await m.activar(pedido({ cierra_ms: cierre, sorteo_ms: cierre + dia }))).status).toBe(200);
  });

  it("un cuerpo sin texto, sin sesión o sin JSON da 400 forma", async () => {
    const sinTexto = await m.activar({ sesion: m.organizadora.token });
    expect(sinTexto.status).toBe(400);
    expect(await sinTexto.json()).toEqual({ error: "forma", campo: "texto" });
    const sinSesion = await m.activar({ texto: JSON.stringify(m.campana()) });
    expect(sinSesion.status).toBe(400);
    expect(await sinSesion.json()).toEqual({ error: "forma", campo: "sesion" });
    const noJson = await m.activar({ texto: "esto no es JSON", sesion: m.organizadora.token });
    expect(noJson.status).toBe(400);
  });

  it("el cuerpo vacío es la pregunta del panel: con el portero atendiendo da 400 forma sin mirar la red ni el proveedor", async () => {
    const r = await m.activar({});
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma", campo: "texto" });
    expect(m.horizon.paginasPedidas).toBe(0);
    // Al portero se le pregunta con el secreto y un cuerpo vacío, que no escribe nada.
    expect(m.portero.llamadas).toEqual([{ cabeceras: expect.objectContaining({ "x-sala-secreto": SECRETO_DE_SALA }), cuerpo: {} }]);
  });

  it("la pregunta del panel da 503 sin-portero si el portero no atiende a la sala", async () => {
    for (const modo of ["rechaza", "apagado", "corte"] as const) {
      await montar();
      m.portero.modo = modo;
      const r = await m.activar({});
      expect(r.status, modo).toBe(503);
      expect(await r.json(), modo).toEqual({ error: "sin-portero" });
    }
  });

  it("que el portero atiende se recuerda un minuto, y que no atiende no se recuerda", async () => {
    m.portero.modo = "rechaza";
    expect((await m.activar({})).status).toBe(503);
    m.portero.modo = "ok";
    expect((await m.activar({})).status).toBe(400);
    m.portero.modo = "rechaza";
    expect((await m.activar({})).status).toBe(400);
    expect(m.portero.llamadas).toHaveLength(2);
    vi.setSystemTime(HORA_DE_LA_PRUEBA + 61_000);
    expect((await m.activar({})).status).toBe(503);
    expect(m.portero.llamadas).toHaveLength(3);
  });

  it("sin las llaves, la pregunta del panel dice sin-llave y no llama al portero", async () => {
    await montar({ CAMPANAS_LLAVE_AUTO: "" });
    const r = await m.activar({});
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "sin-llave" });
    expect(m.portero.llamadas).toEqual([]);
  });

  it("un cuerpo de más de 24.000 bytes se rechaza sin leerlo", async () => {
    const r = await m.activar({ texto: "x".repeat(24_001), sesion: m.organizadora.token });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma", campo: "cuerpo" });
  });

  it("sin Content-Length el cuerpo no se lee", async () => {
    const r = await m.mundo.pedir("/v1/activar", { metodo: "POST", cabeceras: { "content-type": "application/json" } });
    expect(r.status).toBe(400);
  });
});

describe("el servicio apagado o sin llaves", () => {
  it("sin ACTIVAR_AL_PAGAR en 1 contesta 503 apagada, aun con todo lo demás puesto", async () => {
    for (const valor of ["0", "", "true"]) {
      await montar({ ACTIVAR_AL_PAGAR: valor });
      const r = await m.activar(pedido());
      expect(r.status, valor).toBe(503);
      expect(await r.json()).toEqual({ error: "apagada" });
    }
  });

  it("con la comisión mal escrita también queda apagado: nunca se firma con un monto dudoso", async () => {
    const mal: Record<string, string>[] = [
      { COMISION_PB: "0" },
      { COMISION_PB: "mucho" },
      { COMISION_MINIMO: "1.00" },
      { COSTO_RETIRO: "0" },
      { COMISION_CUENTA: "GABC" },
      { PORTERO_URL: "http://pm.tinkazo.app" },
    ];
    for (const cambio of mal) {
      await montar(cambio);
      expect((await m.activar(pedido())).status, JSON.stringify(cambio)).toBe(503);
    }
  });

  it("sin el secreto de la llave automática contesta 503 sin-llave", async () => {
    await montar({ CAMPANAS_LLAVE_AUTO: "" });
    const r = await m.activar(pedido());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "sin-llave" });
  });

  it("con una llave automática mal escrita tampoco firma", async () => {
    for (const llave of ["abc", "z".repeat(64), "A".repeat(64)]) {
      await montar({ CAMPANAS_LLAVE_AUTO: llave });
      expect((await m.activar(pedido())).status, llave).toBe(503);
    }
  });

  it("sin el secreto compartido con el portero contesta 503 sin-llave y no firma", async () => {
    await montar({ SALA_SECRETO: "" });
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "sin-llave" });
  });

  it("con un secreto compartido más corto que el que acepta el portero tampoco firma", async () => {
    await montar({ SALA_SECRETO: "s".repeat(31) });
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "sin-llave" });
    expect(m.horizon.paginasPedidas).toBe(0);
    await montar({ SALA_SECRETO: "s".repeat(32) });
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido())).status).toBe(200);
  });

  it("un origen que no es del sitio da 403 y el pedido de comprobación responde con la política de orígenes", async () => {
    const r = await m.mundo.pedir("/v1/activar", { cuerpo: pedido(), cabeceras: { Origin: "https://otro.example" } });
    expect(r.status).toBe(403);
    const opciones = await m.mundo.pedir("/v1/activar", { metodo: "OPTIONS" });
    expect(opciones.status).toBe(204);
    expect(opciones.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  it("un pedido que no es POST no existe", async () => {
    const r = await m.mundo.pedir("/v1/activar", { metodo: "GET" });
    expect(r.status).toBe(404);
  });
});

describe("los topes", () => {
  it("una misma cuenta activa hasta 5 campañas distintas por día y la sexta da 429 con espera", async () => {
    m.horizon.pagos = [];
    for (let i = 0; i < 5; i++) {
      const evento = `casa-andina-aaa${i}`;
      m.horizon.pagos.push(m.pagoCompleto(evento));
      expect((await m.activar(pedido({ evento }))).status, evento).toBe(200);
    }
    const sexto = "casa-andina-aaa9";
    m.horizon.pagos.push(m.pagoCompleto(sexto));
    const r = await m.activar(pedido({ evento: sexto }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "cupo-cuenta" });
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("repetir un evento que ya se activó hoy no gasta lugar", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    for (let i = 0; i < 8; i++) expect((await m.activar(pedido())).status).toBe(200);
  });

  it("al día siguiente el tope de la cuenta vuelve a cero", async () => {
    for (let i = 0; i < 5; i++) {
      const evento = `casa-andina-bbb${i}`;
      m.horizon.pagos.push(m.pagoCompleto(evento));
      await m.activar(pedido({ evento }));
    }
    vi.setSystemTime(HORA_DE_LA_PRUEBA + 25 * 3_600_000);
    const evento = "casa-andina-bbb9";
    m.horizon.pagos.push(m.pagoCompleto(evento, { cuandoS: Math.floor((HORA_DE_LA_PRUEBA + 25 * 3_600_000) / 1000) - 60 }));
    const r = await m.activar(
      pedido({ evento, cierra_ms: HORA_DE_LA_PRUEBA + 26 * 3_600_000, sorteo_ms: HORA_DE_LA_PRUEBA + 27 * 3_600_000 }),
    );
    expect(r.status).toBe(200);
  });

  it("repetir una sesión mala 5 veces la corta: la sexta da 429 rechazos sin llamar al proveedor", async () => {
    const mala = "tok_desconocida_xxxxxxxxxxxxxxxxxxxx";
    for (let i = 0; i < 5; i++) expect((await m.activar(pedido({}, mala))).status).toBe(401);
    const llamadas = m.mundo.proveedor.llamadas["/v3/tokens/verify"] ?? 0;
    const sexta = await m.activar(pedido({}, mala));
    expect(sexta.status).toBe(429);
    expect(await sexta.json()).toEqual({ error: "rechazos" });
    expect(Number(sexta.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(m.mundo.proveedor.llamadas["/v3/tokens/verify"] ?? 0).toBe(llamadas);
  });

  it("una sesión mala no le quita el lugar a quien organiza bien desde la misma conexión", async () => {
    for (let i = 0; i < 6; i++) await m.activar(pedido({}, `tok_mala_${i}_xxxxxxxxxxxxxxxxxxxxxxxx`));
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido())).status).toBe(200);
  });

  it("una conexión que pide demasiado en diez minutos recibe 429 cupo-conexion", async () => {
    let ultimo: Response | null = null;
    for (let i = 0; i < 61; i++) ultimo = await m.activar(pedido(), { ip: "190.129.77.7" });
    expect(ultimo?.status).toBe(429);
    expect(await ultimo?.json()).toEqual({ error: "cupo-conexion" });
    // Otra conexión sigue entrando.
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await m.activar(pedido(), { ip: "190.129.88.8" })).status).toBe(200);
  });
});

describe("crear la sala con lo que firmó la llave automática", () => {
  const crear = (m2: MundoDeActivar, archivo: { texto: string; firma: string }, base?: string) =>
    m2.mundo.pedir("/v1/campana", { cuerpo: archivo, ...(base ? { base } : {}) });

  it("POST /v1/campana acepta el archivo que firmó la llave automática, con la firma tal como la devuelve la activación", async () => {
    const r = await activarPagada();
    const archivo = (await r.json()) as { texto: string; firma: string };
    const sala = await crear(m, archivo);
    expect(sala.status).toBe(201);
  });

  it("también en un Worker desplegado, donde la llave de prueba no vale", async () => {
    const r = await activarPagada();
    const archivo = (await r.json()) as { texto: string; firma: string };
    const sala = await crear(m, archivo, "https://s.tinkazo.app");
    expect(sala.status).toBe(201);
  });

  it("la misma firma en base64url, que es como la escribe el firmador de siempre, vale igual", async () => {
    const r = await activarPagada();
    const archivo = (await r.json()) as { texto: string; firma: string };
    const bytes = firmaCanonica(archivo.firma);
    expect(bytes).toHaveLength(64);
    const base64 = Buffer.from(bytes ?? new Uint8Array()).toString("base64url");
    expect((await crear(m, { texto: archivo.texto, firma: base64 })).status).toBe(201);
  });

  it("sigue aceptando lo que firma la llave de siempre", async () => {
    const archivo = firmarParaLaPrueba(m.mundo.llavePrivada, m.campana({ evento: "casa-andina-sss1", red: "testnet" }));
    expect((await crear(m, archivo)).status).toBe(201);
  });

  it("sigue rechazando lo firmado por otra llave", async () => {
    const otra = ed25519.utils.randomSecretKey();
    const archivo = firmarParaLaPrueba(otra, m.campana({ evento: "casa-andina-ooo1" }));
    const r = await crear(m, archivo);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "firma" });
  });

  it("rechaza un texto cambiado después de firmar", async () => {
    const r = await activarPagada();
    const archivo = (await r.json()) as { texto: string; firma: string };
    const cambiado = archivo.texto.replace("Casa Andina", "Casa Andina SA");
    expect((await crear(m, { texto: cambiado, firma: archivo.firma })).status).toBe(403);
  });

  it("sin el secreto automático, la llave que salía de él ya no vale", async () => {
    const r = await activarPagada();
    const archivo = (await r.json()) as { texto: string; firma: string };
    await montar({ CAMPANAS_LLAVE_AUTO: "" });
    const sala = await crear(m, archivo);
    expect(sala.status).toBe(403);
    expect(await sala.json()).toEqual({ error: "firma" });
  });
});

describe("un pago sirve a un solo evento", () => {
  /** La activación directa, con topes de mentira: la nota queda tomada por el evento que diga la prueba. */
  async function activarConNota(duena: string | null): Promise<{ estado: number; cuerpo: Record<string, unknown>; tomadas: string[] }> {
    const tomadas: string[] = [];
    const r = await activarCampana(pedido(), {
      env: VARIABLES_DE_ACTIVAR,
      ahora: HORA_DE_LA_PRUEBA,
      ip: "190.129.10.20",
      f: (u, i) => fetch(u, i),
      proveedor: {
        verificar: async () => ({ ok: true, usuario: "usuario-1", vence: HORA_DE_LA_PRUEBA + 3_600_000, cuenta: m.organizadora.cuenta, via: "google" }),
        billeteraDe: async () => ({ ok: true, cuenta: m.organizadora.cuenta }),
      },
      topes: {
        antes: async () => ({ ok: true }),
        rechazo: async () => undefined,
        cuenta: async () => ({ ok: true }),
        anotar: async () => undefined,
        nota: async (nota, evento) => {
          tomadas.push(nota);
          return duena === null || duena === evento;
        },
        // Estos topes de mentira no hablan de la lista de Tus campañas: el evento es libre y guardarla siempre sale bien.
        eventoLibre: async () => true,
        guardarCampana: async () => ({ ok: true }),
      },
    });
    return { ...r, tomadas };
  }

  it("con la nota tomada por otro evento, el mismo pago no lo activa", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await activarConNota("otro-evento-con-la-misma-nota");
    expect(r.estado).toBe(402);
    expect(r.cuerpo).toMatchObject({ error: "no-pagada", nota: notaDeLaComision(EVENTO) });
    expect(r.tomadas).toEqual([notaDeLaComision(EVENTO)]);
    expect(m.portero.llamadas).toHaveLength(0);
  });

  it("con la nota libre o ya de este evento, firma", async () => {
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    expect((await activarConNota(null)).estado).toBe(200);
    expect((await activarConNota(EVENTO)).estado).toBe(200);
  });
});

describe("las formas fijas", () => {
  it("una firma hexadecimal solo vale en minúscula y de 128 caracteres", () => {
    const firma = "ab".repeat(64);
    expect(firmaCanonica(firma)).toHaveLength(64);
    expect(firmaCanonica(firma.toUpperCase())).toBeNull();
    expect(firmaCanonica(firma.slice(1))).toBeNull();
    expect(firmaCanonica(`${firma}0`)).toBeNull();
  });

  it("el emisor del dólar digital es el mismo que el del sitio", () => {
    expect(EMISOR_USDC).toBe(USDC_MAINNET.issuer);
  });

  /** Las variables del archivo de la sala, tal como se despliegan. */
  const variablesDelArchivo = (): Record<string, string> => {
    const toml = readFileSync(join(process.cwd(), "workers", "sala", "wrangler.toml"), "utf8");
    const vars: Record<string, string> = {};
    for (const linea of toml.split(/\r?\n/)) {
      const valor = /^([A-Z_]+)\s*=\s*"([^"]*)"/.exec(linea);
      if (valor?.[1] !== undefined) vars[valor[1]] = valor[2] ?? "";
    }
    return vars;
  };

  it("las variables del archivo de la sala traen la cuenta que cobra y dejan la activación lista para sus secretos", () => {
    const vars = variablesDelArchivo();
    expect(vars.ACTIVAR_AL_PAGAR).toBe("1");
    expect(vars.COMISION_PB).toBe("200");
    expect(vars.COMISION_MINIMO).toBe("1.50");
    expect(vars.COSTO_RETIRO).toBe("0.50");
    expect(vars.PORTERO_URL).toBe(PORTERO);
    // La sala se despliega tal como está el archivo: sin la cuenta que cobra, toda empresa que pagó vería que no se puede
    // activar. Es la misma cuenta que el sitio muestra para pagar la comisión, no una inventada.
    expect(vars.COMISION_CUENTA).toBe("GDJFIZCMUKQM3GHSIJXZ5CR7S2HRJB5GO5NUA2I55HVUV54FW32M2HYM");
    const config = configDeActivar(vars);
    expect(config).not.toBeNull();
    expect(config?.cuenta).toBe(vars.COMISION_CUENTA);
  });

  it("con el archivo tal cual y sin los secretos cargados, la activación no firma: 503 sin-llave", async () => {
    await montar({ ...variablesDelArchivo(), CAMPANAS_LLAVE_AUTO: "", SALA_SECRETO: "" });
    m.horizon.pagos = [m.pagoCompleto(EVENTO)];
    const r = await m.activar(pedido());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "sin-llave" });
    expect(m.horizon.paginasPedidas).toBe(0);
  });

  it("los sorteos que el portero da por una campaña llegan vivos al último día en que se puede sortear", () => {
    const toml = readFileSync(join(process.cwd(), "workers", "patrocinio", "wrangler.toml"), "utf8");
    const dias = toml.split(/\r?\n/).flatMap((l) => /^ORGANIZADORA_DIAS\s*=\s*"(\d+)"/.exec(l)?.[1] ?? []);
    expect(dias).toHaveLength(1);
    const valen = Number(dias[0]);
    // Se activa a lo sumo DIAS_PARA_CERRAR días antes del cierre y se sortea hasta un día después: con un día más de margen,
    // el sello del último día posible todavía encuentra los sorteos de la campaña. Más de 30 el portero no lo acepta.
    expect(valen).toBeGreaterThanOrEqual(DIAS_PARA_CERRAR + 2);
    expect(valen).toBeLessThanOrEqual(30);
  });

  it("el archivo de la sala no trae ninguno de los secretos", () => {
    const toml = readFileSync(join(process.cwd(), "workers", "sala", "wrangler.toml"), "utf8");
    for (const nombre of ["CAMPANAS_LLAVE_AUTO", "SALA_SECRETO", "POLLAR_SECRETO"]) {
      expect(toml, nombre).not.toMatch(new RegExp(`^${nombre}\\s*=`, "m"));
    }
  });
});
