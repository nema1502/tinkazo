import { describe, expect, it, vi } from "vitest";
import * as comision from "../src/campana/comision.ts";
import * as red from "../src/campana/comision-red.ts";
import { cuentaDePrueba } from "../src/campana/cuentas-de-prueba.ts";
import * as config from "../src/stellar/comision-config.ts";
import * as portero from "../src/stellar/pago-portero.ts";
import * as pagos from "../src/stellar/pagos.ts";
import * as retiro from "../src/stellar/retiro-config.ts";
import {
  SALIDA,
  codigoDeSalida,
  compararConElSitio,
  informeDeComision,
  leerArchivo,
  leerOpciones,
  textoDelInforme,
} from "./campana-comision.mjs";

/**
 * El guion de quien activa campañas, con la red de mentira: lo que calcula es lo que calcula el sitio (comparten los archivos de
 * \`src\`), los códigos de salida no se confunden y cada comprobación dice lo suyo. Sin red y sin leer archivos de entorno.
 */

const modulos = { comision, red, config, retiro, pagos, portero };
const RECIBE = cuentaDePrueba(2);
const COBROS = cuentaDePrueba(1);
const ORGANIZADORA = cuentaDePrueba(5);
const OTRA = cuentaDePrueba(6);
const ABRE = Date.parse("2026-11-21T14:00:00Z");
const DE_120 = { evento: "evento-uno", premios: ["1200000000"], abreMs: ABRE, organizadora: ORGANIZADORA };
const NOTA = comision.notaDeLaComision("evento-uno");
const OPCIONES = { pb: "200", minimo: "1.50", costo: "0.50", cuenta: RECIBE, cobros: COBROS, portero: "https://portero.ejemplo", sitio: null };

const pago = (monto, cuando = "2026-11-21T15:00:00Z", de = ORGANIZADORA, ficha = "10") => ({
  type: "payment",
  transaction_successful: true,
  to: RECIBE,
  from: de,
  asset_type: "credit_alphanum4",
  asset_code: pagos.USDC_MAINNET.code,
  asset_issuer: pagos.USDC_MAINNET.issuer,
  amount: monto,
  created_at: cuando,
  paging_token: ficha,
  transaction_hash: "a".repeat(64),
  transaction: { successful: true, memo_type: "id", memo: NOTA },
});

const cuentaConSaldo = (saldo, extra = {}) => ({
  balances: [
    { asset_type: "native", balance: "5.0000000" },
    { asset_type: "credit_alphanum4", asset_code: pagos.USDC_MAINNET.code, asset_issuer: pagos.USDC_MAINNET.issuer, balance: saldo, is_authorized: true, ...extra },
  ],
});

/** La red de mentira: lo que Horizon y el servicio contestan, y lo que se les pidió. */
function mundo(cambios = {}) {
  const m = {
    pagos: [],
    recibe: cuentaConSaldo("0.0000000"),
    organizadora: cuentaConSaldo("130.0000000"),
    cupo: { red: "mainnet", pagos: { premio: true, retiro: true, costoRetiro: { monto: 5_000_000 }, enCurso: null } },
    caida: false,
    pedidos: [],
    ...cambios,
  };
  m.fetch = vi.fn(async (url) => {
    const u = String(url);
    m.pedidos.push(u);
    if (m.caida) throw new Error("corte");
    const json = (x, estado = 200) => new Response(JSON.stringify(x), { status: estado });
    if (u.includes("/v1/patrocinio/cupo")) return json(m.cupo);
    if (u.includes(`/accounts/${RECIBE}/payments`)) return json({ _embedded: { records: m.pagos } });
    if (u.endsWith(`/accounts/${RECIBE}`)) return m.recibe === null ? json({}, 404) : json(m.recibe);
    if (u.endsWith(`/accounts/${ORGANIZADORA}`)) return json(m.organizadora);
    return json({}, 404);
  });
  return m;
}

const informe = (m, datos = DE_120, opciones = OPCIONES, extra = {}) => informeDeComision(datos, opciones, { fetch: m.fetch, modulos, ...extra });

describe("las opciones", () => {
  it("lo que no viene por opción sale del entorno", () => {
    const o = leerOpciones(["campana.json", "--pb", "250"], {
      VITE_COMISION_PB: "200",
      VITE_COMISION_MINIMO: "1.50",
      VITE_COMISION_CUENTA: RECIBE,
      VITE_RETIRO_COSTO: "0.50",
      VITE_RETIRO_CUENTA: COBROS,
    });
    expect(o).toMatchObject({ archivo: "campana.json", pb: "250", minimo: "1.50", cuenta: RECIBE, costo: "0.50", cobros: COBROS, sinRed: false });
  });

  it("sin archivo, con una opción que no existe o sin valor, es un error de uso sin escribir valores", () => {
    expect(leerOpciones([], {}).error).toContain("falta el archivo");
    expect(leerOpciones(["a.json", "--nada"], {}).error).toContain("--nada");
    expect(leerOpciones(["a.json", "--pb"], {}).error).toContain("--pb");
    expect(leerOpciones(["a.json", "b.json"], {}).error).toContain("un solo archivo");
  });

  it("--sin-red y --json son banderas", () => {
    expect(leerOpciones(["a.json", "--sin-red", "--json"], {})).toMatchObject({ sinRed: true, json: true });
  });
});

describe("el archivo", () => {
  it("el firmado y la campaña suelta dan lo mismo", () => {
    const suelto = leerArchivo(JSON.stringify(DE_120));
    const firmado = leerArchivo(JSON.stringify({ texto: JSON.stringify(DE_120), firma: "F" }));
    expect(firmado).toEqual(suelto);
  });

  it("algo que no es un JSON da null", () => {
    expect(leerArchivo("esto no es un archivo")).toBeNull();
    expect(leerArchivo(JSON.stringify({ texto: "no", firma: "F" }))).toBeNull();
  });
});

describe("el cálculo", () => {
  it("sin red dice los mismos números que el panel y la misma nota", async () => {
    const m = mundo();
    const i = await informe(m, DE_120, OPCIONES, { sinRed: true });
    expect(i.premios).toBe(1_200_000_000n);
    expect(i.comision).toBe(24_000_000n);
    expect(i.aCargar).toBe(1_224_000_000n);
    expect(i.nota).toBe(comision.notaDeLaComision("evento-uno"));
    expect(i.llegaALaCuenta).toBe(19_000_000n);
    expect(i.costoALosCobros).toBe(5_000_000n);
    expect(i.porcentaje).toBe("2 %");
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("tres eventos: el guion da la nota del panel, la de un cálculo hecho aparte, distintas y fuera de las órdenes", async () => {
    // Los números esperados salen de otra implementación del mismo cálculo (sha256 del evento, ocho bytes, entre 2^40 y 10^15).
    const esperadas = { "evento-dos": "660590431597163", "evento-tres": "808092575541719", "prueba-cuatro": "118947189815483" };
    const m = mundo();
    const vistas = [];
    for (const [evento, nota] of Object.entries(esperadas)) {
      const i = await informe(m, { ...DE_120, evento }, OPCIONES, { sinRed: true });
      expect(i.nota, evento).toBe(nota);
      expect(i.nota, evento).toBe(comision.notaDeLaComision(evento));
      expect(BigInt(i.nota) >= 1n << 40n, evento).toBe(true);
      expect(i.enlace, evento).toContain(`memo=${nota}`);
      vistas.push(i.nota);
    }
    expect(new Set(vistas).size).toBe(3);
  });

  it("el archivo firmado y el suelto dan la misma nota", async () => {
    const m = mundo();
    const a = await informe(m, leerArchivo(JSON.stringify(DE_120)), OPCIONES, { sinRed: true });
    const b = await informe(m, leerArchivo(JSON.stringify({ texto: JSON.stringify(DE_120), firma: "F" })), OPCIONES, { sinRed: true });
    expect(a.nota).toBe(b.nota);
  });

  it("un premio de 1 paga el mínimo: 1,50 y se cargan 2,50", async () => {
    const i = await informe(mundo(), { ...DE_120, premios: ["10000000"] }, OPCIONES, { sinRed: true });
    expect(i.comision).toBe(15_000_000n);
    expect(i.aCargar).toBe(25_000_000n);
  });

  it("un archivo que no es una campaña lanza", async () => {
    await expect(informe(mundo(), { evento: "MAL" })).rejects.toThrow("forma de una campaña");
  });

  it("una configuración mala lanza sin escribir su valor", async () => {
    const malo = { ...OPCIONES, minimo: "1.49" };
    await expect(informe(mundo(), DE_120, malo)).rejects.toThrow("camino del retiro");
    await expect(informe(mundo(), DE_120, { ...OPCIONES, pb: "5000" })).rejects.toThrow("puntos básicos");
    await expect(informe(mundo(), DE_120, { ...OPCIONES, cuenta: COBROS })).rejects.toThrow("de cobros");
    try {
      await informe(mundo(), DE_120, { ...OPCIONES, pb: "5000" });
    } catch (e) {
      expect(String(e.message)).not.toContain("5000");
    }
  });
});

describe("lo que dice la red", () => {
  it("un pago que llega al umbral es pagada y sale con 0", async () => {
    const m = mundo({ pagos: [pago("1.9000000")] });
    const i = await informe(m);
    expect(i.estado).toBe("pagada");
    expect(codigoDeSalida(i)).toBe(SALIDA.pagada);
  });

  it("sin pagos es sin pagar y sale con 3", async () => {
    const i = await informe(mundo());
    expect(i.estado).toBe("sin-pagar");
    expect(codigoDeSalida(i)).toBe(SALIDA.sinPagar);
  });

  it("con la red caída no se pudo mirar y sale con 2", async () => {
    const i = await informe(mundo({ caida: true }));
    expect(i.estado).toBe("sin-mirar");
    expect(codigoDeSalida(i)).toBe(SALIDA.noSePudo);
  });

  it("--sin-red sale con 4 y nunca con 0", async () => {
    const i = await informe(mundo(), DE_120, OPCIONES, { sinRed: true });
    expect(codigoDeSalida(i)).toBe(SALIDA.soloCalculo);
    expect(SALIDA.soloCalculo).not.toBe(SALIDA.pagada);
  });

  it("lista cada pago que cuenta con su hash, su monto, su fecha y de quién", async () => {
    const m = mundo({ pagos: [pago("1.9000000", "2026-11-21T15:00:00Z", OTRA)] });
    const i = await informe(m);
    expect(i.pagos).toEqual([{ hash: "a".repeat(64), monto: 19_000_000n, cuando: Date.parse("2026-11-21T15:00:00Z") / 1000, de: OTRA }]);
    const texto = textoDelInforme(i);
    expect(texto).toContain("a".repeat(64));
    expect(texto).toContain(OTRA);
    expect(texto).toContain("2026-11-21T15:00:00Z");
  });

  it("dice cuánto se pagó de más, para devolverlo", async () => {
    const m = mundo({ pagos: [pago("1.9000000", undefined, ORGANIZADORA, "2"), pago("2.4000000", undefined, ORGANIZADORA, "1")] });
    const i = await informe(m);
    expect(i.suma).toBe(43_000_000n);
    expect(i.excedente).toBe(24_000_000n);
    expect(textoDelInforme(i)).toContain("Se pagó de más: 2,40");
  });

  it("avisa si el evento ya tenía pagos de antes de abrirse esta campaña", async () => {
    const m = mundo({ pagos: [pago("1.9000000", "2026-11-19T15:00:00Z")] });
    const i = await informe(m);
    expect(i.deAntes).toHaveLength(1);
    expect(textoDelInforme(i)).toContain("AVISO");
  });

  it("un pago con otra nota no cuenta", async () => {
    const otro = pago("1.9000000");
    otro.transaction.memo = "710126854477770";
    const i = await informe(mundo({ pagos: [otro] }));
    expect(i.estado).toBe("sin-pagar");
  });
});

describe("lo que rompe el día", () => {
  it("la cuenta que recibe sin la línea del dólar digital se dice", async () => {
    const m = mundo({ recibe: { balances: [{ asset_type: "native", balance: "5.0000000" }] } });
    expect((await informe(m)).comprobaciones.cuentaQueRecibe.estado).toBe("sin-linea");
  });

  it("la cuenta que recibe que no existe se dice, y la que está lista también", async () => {
    expect((await informe(mundo({ recibe: null }))).comprobaciones.cuentaQueRecibe.estado).toBe("no-existe");
    expect((await informe(mundo())).comprobaciones.cuentaQueRecibe.estado).toBe("lista");
  });

  it("una línea sin autorizar se dice", async () => {
    const m = mundo({ recibe: cuentaConSaldo("0.0000000", { is_authorized: false }) });
    expect((await informe(m)).comprobaciones.cuentaQueRecibe.estado).toBe("sin-autorizar");
  });

  it("el servicio que atiende retiros con ese costo, y el que no", async () => {
    expect((await informe(mundo())).comprobaciones.servicio.estado).toBe("atiende");
    const apagado = mundo({ cupo: { red: "mainnet", pagos: { premio: true, retiro: false, costoRetiro: { monto: 5_000_000 }, enCurso: null } } });
    expect((await informe(apagado)).comprobaciones.servicio.estado).toBe("no-atiende");
    const otro = mundo({ cupo: { red: "mainnet", pagos: { premio: true, retiro: true, costoRetiro: { monto: 7_000_000 }, enCurso: null } } });
    expect((await informe(otro)).comprobaciones.servicio.estado).toBe("no-atiende");
  });

  it("sin la dirección del servicio no se comprueba y lo dice", async () => {
    const i = await informe(mundo(), DE_120, { ...OPCIONES, portero: "" });
    expect(i.comprobaciones.servicio.estado).toBe("sin-direccion");
  });

  it("la cuenta de quien organiza con los premios más el cobro alcanza, y sin ellos dice cuánto falta", async () => {
    expect((await informe(mundo())).comprobaciones.organizadora.estado).toBe("alcanza");
    const corta = await informe(mundo({ organizadora: cuentaConSaldo("100.0000000") }));
    expect(corta.comprobaciones.organizadora).toMatchObject({ estado: "falta", falta: 224_000_000n });
    expect(textoDelInforme(corta)).toContain("le faltan 22,40");
  });

  it("un archivo sin la cuenta de quien organiza no la comprueba", async () => {
    const { organizadora: _sin, ...sinCuenta } = DE_120;
    const i = await informe(mundo(), sinCuenta);
    expect(i.comprobaciones.organizadora.estado).toBe("sin-cuenta-organizadora");
  });
});

describe("el plan B", () => {
  it("deja el enlace de pago con la cuenta, el monto y la nota como número", async () => {
    const i = await informe(mundo(), DE_120, OPCIONES, { sinRed: true });
    expect(i.enlace).toContain("web+stellar:pay?");
    expect(i.enlace).toContain(`destination=${RECIBE}`);
    expect(i.enlace).toContain("amount=2.40");
    expect(i.enlace).toContain(`memo=${NOTA}`);
    expect(i.enlace).toContain("memo_type=MEMO_ID");
    expect(textoDelInforme(i, "CODIGO")).toContain("CODIGO");
  });

  it("el enlace del guion es el mismo que arma el panel", async () => {
    const i = await informe(mundo(), DE_120, OPCIONES, { sinRed: true });
    expect(i.enlace).toBe(comision.enlaceDePago(RECIBE, 24_000_000n, NOTA, pagos.USDC_MAINNET));
  });
});

describe("compararlo con el sitio", () => {
  const publicado = { pb: "200", minimo: "15000000", cuenta: RECIBE, costo: "5000000" };
  const sitioCon = (cuerpo, estado = 200) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: estado }));

  it("lo que publica el sitio y lo que se le pasó coinciden: sin diferencias", async () => {
    expect(await compararConElSitio(OPCIONES, "https://sitio.ejemplo", modulos, sitioCon(publicado))).toEqual([]);
  });

  it("si difiere, dice qué campo y no su valor", async () => {
    const d = await compararConElSitio({ ...OPCIONES, pb: "250" }, "https://sitio.ejemplo", modulos, sitioCon(publicado));
    expect(d).toHaveLength(1);
    expect(d[0]).toContain("pb");
    expect(d[0]).not.toContain("250");
  });

  it("si el sitio no publica comision.json, lo dice", async () => {
    expect(await compararConElSitio(OPCIONES, "https://sitio.ejemplo", modulos, sitioCon({}, 404))).toHaveLength(1);
  });
});
