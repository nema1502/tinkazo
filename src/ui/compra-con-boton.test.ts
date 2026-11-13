// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanjeDeCupon, EstadoDeAlta, OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import type { Oferta } from "../stellar/alta-oferta";
import type { EstadoDelPatrocinio } from "../stellar/patrocinador";
import type { EstadoOficial } from "../stellar/wallet-pollar";

/**
 * Un texto que ofrece comprar va siempre con un botón que de verdad lleva a comprar; con la compra apagada, ningún texto
 * ofrece comprar. Se mira en cada lugar donde el sitio puede ofrecerlo: «Dejá tu cuenta lista», la ventana «Se te
 * acabaron los sorteos oficiales» y la línea del cupo, con y sin un paquete a la venta, y en el diccionario entero de los
 * textos del cobro. En jsdom, con un servidor de mentira.
 */

const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ALTA = { id: "alta", usdc: "3", sorteos: 3, dias: 90 };
const P10 = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };

const h = vi.hoisted(() => ({
  pago: true,
  oferta: { alta: null, paquetes: [] } as Oferta,
  sumar: vi.fn(async () => false),
  estados: [] as unknown[],
}));

vi.mock("./qr", () => ({ pintarQr: vi.fn(async () => true) }));
vi.mock("../stellar/alta-config", () => ({
  BANDERAS_APAGADAS: { alta: false, libre: false, pago: false, sorteoServidor: false, qr: false },
  banderasDeAlta: () => ({ alta: true, libre: false, pago: h.pago, sorteoServidor: false, qr: false }),
  compraQrActiva: () => false,
  altaActiva: () => true,
  altaLibre: () => false,
  altaPagoActivo: () => h.pago,
  sorteoPorServidor: () => false,
}));
vi.mock("../stellar/alta-oferta", async (orig) => ({
  ...(await orig<typeof import("../stellar/alta-oferta")>()),
  leerOferta: async () => (h.pago ? h.oferta : { alta: null, paquetes: [] }),
}));
vi.mock("./cuenta-lista-flujo", () => ({ abrirSumarSorteos: (...a: unknown[]) => h.sumar(...(a as [])), abrirParaElError: vi.fn(async () => false) }));
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false, enPractica: () => false }));
vi.mock("../stellar/cobro-oficial", () => ({ cobroPorUso: () => true, redPrincipalConPollar: () => true, esCuentaDePollar: () => true }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ kind: "external", address: CUENTA }) }));
vi.mock("./modo-ui", () => ({ pasarAModo: vi.fn(), puedeCambiarDeModo: () => true }));
vi.mock("./red", () => ({ mostrarSinPatrocinio: vi.fn(async () => undefined) }));
vi.mock("../stellar/patrocinador", async (orig) => ({
  ...(await orig<typeof import("../stellar/patrocinador")>()),
  urlDelPortero: () => "https://pm.ejemplo",
  estadoDelPatrocinio: async () => h.estados[0],
}));

/**
 * Lo que ofrece comprar, en los dos idiomas: el primer paquete como opción, sumar sorteos, un precio. «Ya pagaste tu primer
 * paquete» no ofrece nada: por eso «o tu primer paquete».
 */
const OFRECE = /\bo tu primer paquete|sum[aá] (sorteos|más)|sumar sorteos|d[oó]lar|\bor your first pack|\badd (draws|more)\b|US\$|\{precio\}/i;

const visible = (el: Element): boolean => !el.closest("[hidden]") && (el as HTMLElement).style?.display !== "none";
/** Los textos a la vista que ofrecen comprar (no los botones: esos son la compra). */
const ofrecen = (raiz: ParentNode): string[] =>
  [...raiz.querySelectorAll<HTMLElement>("p, li, h2, h3, span, div")]
    .filter((el) => visible(el) && !el.closest("button, a") && [...el.childNodes].some((n) => n.nodeType === 3 && OFRECE.test(n.textContent ?? "")))
    .map((el) => el.textContent ?? "");
const botonesDeComprar = (raiz: ParentNode): HTMLButtonElement[] => [...raiz.querySelectorAll<HTMLButtonElement>('button[data-accion="comprar"]')].filter((b) => visible(b) && !b.disabled);

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });

/** Carga el sitio de nuevo, con la compra prendida o apagada en el build (el diccionario cambia al importarlo). */
async function cargar(pago: boolean) {
  vi.resetModules();
  h.pago = pago;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  return {
    i18n,
    cuentaLista: await import("./cuenta-lista"),
    sinSorteos: await import("./sin-sorteos"),
    cupo: await import("./cupo-patrocinio"),
    state: await import("../state"),
  };
}

function servidor(o: { compra: boolean; acceso?: EstadoDeAlta["acceso"] }) {
  const estadoDe = (): EstadoDeAlta => ({ acceso: o.acceso ?? "ninguno", cuenta: "GAAA", abierta: false, pedido: null, sorteos: { quedan: 0, proximoVence: null }, orden: null, fondeo: "inmediato" });
  const orden = vi.fn(async (): Promise<ResultadoDeAlta<OrdenDePago>> => ({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 }));
  const base = {
    estado: vi.fn(async () => ok(estadoDe())),
    canjear: vi.fn(async (): Promise<ResultadoDeAlta<CanjeDeCupon>> => ({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 })),
    cuponGuardado: vi.fn(() => null as string | null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => "GAAA"),
  };
  const compra = { oferta: vi.fn(async () => h.oferta), orden, pago: vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => ok({ pagada: false, recibido: "0", total: "3", minimo: "2.85" })) };
  return { acceso: o.compra ? { ...base, ...compra } : base, orden, base };
}

function cuentaFalsa(activacion: EstadoOficial["activacion"]) {
  const est: EstadoOficial = { activacion, proteccion: activacion === "lista" ? "lista" : "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
  return {
    est,
    cuenta: {
      estadoOficial: vi.fn(async () => ({ ...est })),
      activarCuenta: vi.fn(async () => "activada" as const),
      alCambiarLaCuenta: () => () => undefined,
      sesionViva: () => true,
      confirmarAparatoConDesbloqueo: vi.fn(async () => true),
      mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
      confirmarCodigoParaEsteAparato: vi.fn(async () => true),
      protegerConPasskey: vi.fn(async () => true),
      mandarCodigoDeProteccion: vi.fn(async () => undefined),
      confirmarCodigoDeProteccion: vi.fn(async () => true),
    },
  };
}

const pasa = (ms = 600): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const raiz = (): HTMLElement => document.querySelector(".cuenta-lista") as HTMLElement;

async function abrirElPaso(m: Awaited<ReturnType<typeof cargar>>, o: { compra: boolean; activacion: EstadoOficial["activacion"]; cupon?: boolean }) {
  const srv = servidor({ compra: o.compra });
  if (o.cupon) srv.base.cuponGuardado.mockReturnValue("ABCD2345WXYZ");
  const cf = cuentaFalsa(o.activacion);
  m.cuentaLista.aceptarClicsDePrueba(true);
  const salidas = { cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: () => true, entrarDeNuevo: vi.fn() };
  void m.cuentaLista.abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.est, acceso: srv.acceso as never });
  await pasa();
  return srv;
}

async function cerrarElPaso(m: Awaited<ReturnType<typeof cargar>>): Promise<void> {
  const r = document.querySelector(".cuenta-lista");
  if (r) {
    [...r.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === m.i18n.t("acctSignOut"))?.click();
    await pasa(20);
  }
  m.cuentaLista.aceptarClicsDePrueba(false);
}

function portero(quedan: number): EstadoDelPatrocinio {
  return {
    rige: "portero",
    cupo: { sellos: { usados: 0, max: 100, quedan: 50 }, sorteos: { usados: 0, max: 200, quedan: 100 }, liberaEn: Date.UTC(2026, 11, 1) },
    oficial: { acceso: true, sorteos: { quedan, proximoVence: null } },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 16, 15));
  document.body.innerHTML = '<main id="pagina"><input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-acciones"></div><div id="names"></div></main>';
  h.sumar.mockClear();
  h.oferta = { alta: null, paquetes: [] };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("con la compra prendida, todo texto que ofrece comprar tiene su botón, y el botón compra", () => {
  it("«Dejá tu cuenta lista», sin cupón: con el primer paquete a la venta, el texto que lo nombra va con su botón, que pide la orden", async () => {
    for (const activacion of ["falta", "lista"] as const) {
      const m = await cargar(true);
      h.oferta = { alta: ALTA, paquetes: [P10] };
      const srv = await abrirElPaso(m, { compra: true, activacion });
      const textos = ofrecen(raiz());
      expect(textos.length, activacion).toBeGreaterThan(0);
      const [comprar] = botonesDeComprar(raiz());
      expect(comprar, activacion).toBeTruthy();
      (comprar as HTMLButtonElement).click();
      await pasa();
      expect(srv.orden, activacion).toHaveBeenCalledWith("alta");
      await cerrarElPaso(m);
    }
  });

  it("«Dejá tu cuenta lista» sin nada a la venta, o con un cupón en mano: ningún texto ofrece comprar", async () => {
    for (const caso of [{ oferta: { alta: null, paquetes: [] }, cupon: false }, { oferta: { alta: ALTA, paquetes: [] }, cupon: true }]) {
      for (const activacion of ["falta", "lista"] as const) {
        const m = await cargar(true);
        h.oferta = caso.oferta;
        await abrirElPaso(m, { compra: true, activacion, cupon: caso.cupon });
        expect(ofrecen(raiz()), `${JSON.stringify(caso)} ${activacion}`).toEqual([]);
        expect(botonesDeComprar(raiz())).toEqual([]);
        await cerrarElPaso(m);
      }
    }
  });

  it("«Se te acabaron»: con un paquete a la venta, el texto que ofrece sumar va con su botón secundario, que abre la compra", async () => {
    const m = await cargar(true);
    h.oferta = { alta: null, paquetes: [P10] };
    const fin = m.sinSorteos.alQuedarseSinSorteos();
    await pasa(20);
    const dlg = document.querySelector(".sin-sorteos") as HTMLElement;
    expect(ofrecen(dlg).length).toBeGreaterThan(0);
    const [comprar] = botonesDeComprar(dlg);
    expect(comprar?.textContent).toBe("Organizá 10 sorteos oficiales por 9 dólares");
    // La principal sigue siendo el cupón: comprar nunca es la principal frente a la sala.
    expect(dlg.querySelector(".dlg-main")?.textContent).toBe(m.i18n.t("cupoOfUsarCupon"));
    expect(comprar?.classList.contains("dlg-main")).toBe(false);
    (comprar as HTMLButtonElement).click();
    await fin;
    expect(h.sumar).toHaveBeenCalledTimes(1);
  });

  it("«Se te acabaron» sin nada a la venta: ningún texto ofrece comprar", async () => {
    const m = await cargar(true);
    void m.sinSorteos.abrirSeAcabaron();
    await pasa(20);
    const dlg = document.querySelector(".sin-sorteos") as HTMLElement;
    expect(ofrecen(dlg)).toEqual([]);
    expect(botonesDeComprar(dlg)).toEqual([]);
    (dlg.querySelector('[data-dlg="x"]') as HTMLButtonElement).click();
  });

  it("la línea del cupo con pocos o ninguno: con un paquete a la venta, lo que ofrece va con «Sumar sorteos», que abre la compra", async () => {
    for (const quedan of [2, 1, 0]) {
      document.body.innerHTML = '<main id="pagina"><input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-acciones"></div><div id="names"></div></main>';
      const m = await cargar(true);
      m.state.app.frozen = null;
      h.oferta = { alta: null, paquetes: [P10] };
      h.estados = [portero(quedan)];
      m.cupo.iniciarCupo();
      await pasa(20);
      const linea = document.getElementById("cupo-linea") as HTMLElement;
      if (quedan !== 1) expect(OFRECE.test(linea.textContent ?? ""), `${quedan}: ${linea.textContent}`).toBe(true);
      const [sumar] = botonesDeComprar(document);
      expect(sumar?.id, String(quedan)).toBe("cupo-sumar");
      expect(sumar?.textContent).toBe(m.i18n.t("cupoOfSumar"));
      h.sumar.mockClear();
      (sumar as HTMLButtonElement).click();
      await pasa(20);
      expect(h.sumar, String(quedan)).toHaveBeenCalledTimes(1);
    }
  });

  it("con la marca del piloto en este navegador, Sumar sorteos aparece también con más de 2; sin la marca, o con la venta abierta para todos, no", async () => {
    const casos = [
      { marca: true, abierta: false, ve: true },
      { marca: false, abierta: false, ve: false },
      { marca: true, abierta: true, ve: false },
    ];
    for (const c of casos) {
      document.body.innerHTML = '<main id="pagina"><input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-acciones"></div><div id="names"></div></main>';
      localStorage.clear();
      // La marca guarda la hora en que se puso, y vale seis horas.
      if (c.marca) localStorage.setItem("tinkazo.venta.piloto", String(Date.now()));
      vi.stubEnv("VITE_VENTA_ABIERTA", c.abierta ? "1" : "");
      const m = await cargar(true);
      m.state.app.frozen = null;
      h.oferta = { alta: null, paquetes: [P10] };
      h.estados = [portero(5)];
      m.cupo.iniciarCupo();
      await pasa(20);
      const caso = JSON.stringify(c);
      expect(document.getElementById("cupo-linea")?.textContent, caso).toBe("Te quedan 5 sorteos oficiales.");
      const botones = botonesDeComprar(document);
      expect(botones.map((b) => b.id), caso).toEqual(c.ve ? ["cupo-sumar"] : []);
      expect(ofrecen(document), caso).toEqual([]);
      if (!c.ve) continue;
      h.sumar.mockClear();
      (botones[0] as HTMLButtonElement).click();
      await pasa(20);
      expect(h.sumar, caso).toHaveBeenCalledTimes(1);
    }
  });

  it("la línea del cupo sin nada a la venta, o con sorteos de sobra: ni texto que ofrezca ni botón", async () => {
    for (const [quedan, paquetes] of [
      [2, []],
      [0, []],
      [13, [P10]],
    ] as const) {
      document.body.innerHTML = '<main id="pagina"><input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-acciones"></div><div id="names"></div></main>';
      const m = await cargar(true);
      m.state.app.frozen = null;
      h.oferta = { alta: null, paquetes: [...paquetes] };
      h.estados = [portero(quedan)];
      m.cupo.iniciarCupo();
      await pasa(20);
      expect(ofrecen(document), `${quedan} ${paquetes.length}`).toEqual([]);
      expect(botonesDeComprar(document)).toEqual([]);
    }
  });
});

describe("con la compra apagada, ningún texto ofrece comprar", () => {
  it("en «Dejá tu cuenta lista», en «Se te acabaron» y en la línea del cupo", async () => {
    for (const activacion of ["falta", "lista"] as const) {
      const m = await cargar(false);
      h.oferta = { alta: ALTA, paquetes: [P10] };
      await abrirElPaso(m, { compra: false, activacion });
      expect(ofrecen(raiz()), activacion).toEqual([]);
      expect(botonesDeComprar(raiz())).toEqual([]);
      await cerrarElPaso(m);
    }
    const m = await cargar(false);
    h.oferta = { alta: ALTA, paquetes: [P10] };
    void m.sinSorteos.abrirSeAcabaron();
    await pasa(20);
    const dlg = document.querySelector(".sin-sorteos") as HTMLElement;
    expect(ofrecen(dlg)).toEqual([]);
    expect(botonesDeComprar(dlg)).toEqual([]);
    (dlg.querySelector('[data-dlg="x"]') as HTMLButtonElement).click();
    for (const quedan of [2, 0]) {
      document.body.innerHTML = '<main id="pagina"><input id="nw" value="1" /><p id="cupo-linea" style="display:none"></p><div id="again-acciones"></div><div id="names"></div></main>';
      const c = await cargar(false);
      c.state.app.frozen = null;
      h.estados = [portero(quedan)];
      c.cupo.iniciarCupo();
      await pasa(20);
      expect(ofrecen(document), String(quedan)).toEqual([]);
      expect(botonesDeComprar(document)).toEqual([]);
    }
  });
});

describe("el diccionario de los textos del cobro", () => {
  /**
   * Cada texto que ofrece comprar, y dónde está su botón. Uno nuevo que ofrezca comprar hace fallar esta prueba hasta que
   * se diga dónde va su botón (y se pruebe arriba).
   */
  const CON_SU_BOTON: Record<string, string> = {
    altaTexto: "«Dejá tu cuenta lista»: solo con el primer paquete a la venta, junto a su botón (sin venta, altaTextoSinVenta)",
    altaYaActivada: "«Dejá tu cuenta lista»: lo mismo, con la cuenta activada (sin venta, altaYaActivadaSinVenta)",
    altaPrimerPaquete: "es el botón",
    cupoOfPocos: "la línea del cupo, con «Sumar sorteos» al lado",
    cupoOfCeroSumar: "la línea del cupo, con «Sumar sorteos» al lado",
    cupoOfCeroTexto: "«Se te acabaron»: solo con un paquete a la venta, con su botón (sin venta, cupoOfCeroTextoSinVenta)",
    cupoOfVencidoTexto: "no se usa en ninguna pantalla",
    cupoOfSumar: "es el botón",
    cupoOfSumarPaquete: "es el botón",
    pagoDolares: "una pieza del botón",
    pagoUnDolar: "una pieza del botón",
    // Pagar con el saldo de la cuenta: solo dentro de la compra ya empezada (después de tocar su botón), y dicen el
    // saldo o el monto de la orden, cada uno junto a su principal.
    pagoSaldoTenes: "cómo pagar con el saldo, con Pagar con mi saldo al lado",
    pagoSaldoTenesUno: "cómo pagar con el saldo, con Pagar con mi saldo al lado",
    pagoSaldoConfirmar: "la confirmación del pago con el saldo, con su botón Pagar",
    pagoSaldoPagar: "es el botón",
    pagoSaldoCancelado: "el pago con el saldo no salió, con Pagar o el otro medio al lado",
    pagoSaldoNoSalio: "el pago con el saldo no salió, con Pagar o el otro medio al lado",
    pagoSaldoDestino: "el pago con el saldo no salió, con el otro medio al lado",
    pagoSaldoSinLinea: "el pago con el saldo no salió, con el otro medio al lado",
    pagoSaldoCorto: "el renglón del saldo que no alcanza, en los datos para pagar, con Ya pagué",
    pagoSaldoCortoUno: "el renglón del saldo que no alcanza, en los datos para pagar, con Ya pagué",
  };

  it("con la compra prendida, los que ofrecen comprar son estos y ninguno más", async () => {
    const m = await cargar(true);
    const { TEXTOS_ALTA } = await import("../alta-textos");
    const { TEXTOS_ALTA_PAGO } = await import("../alta-textos-pago");
    const { TEXTOS_ALTA_SIN_VENTA } = await import("../alta-textos-sin-pago");
    const claves = new Set([...Object.keys(TEXTOS_ALTA.es), ...Object.keys(TEXTOS_ALTA_PAGO.es), ...Object.keys(TEXTOS_ALTA_SIN_VENTA.es)]);
    const ofrecenComprar = [...claves].filter((k) => (["es", "en"] as const).some((l) => OFRECE.test(String(m.i18n.T[l][k] ?? "")))).sort();
    expect(ofrecenComprar).toEqual(Object.keys(CON_SU_BOTON).sort());
  });

  it("los no del portero, que van donde no hay botón de comprar, no ofrecen comprar ni con la compra prendida", async () => {
    const m = await cargar(true);
    for (const k of ["errAnchor.porteroSinAlta", "errAnchor.porteroSinSorteos"]) for (const l of ["es", "en"] as const) expect(String(m.i18n.T[l][k]), `${l} ${k}`).not.toMatch(OFRECE);
  });

  it("el que no se usa en ninguna pantalla, de verdad no se usa", () => {
    const fuentes: string[] = [];
    const recorrer = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/alta-textos/.test(f)) fuentes.push(readFileSync(p, "utf8"));
      }
    };
    recorrer("src");
    for (const [k, donde] of Object.entries(CON_SU_BOTON)) if (donde === "no se usa en ninguna pantalla") expect(fuentes.some((s) => s.includes(`"${k}"`)), k).toBe(false);
  });
});
