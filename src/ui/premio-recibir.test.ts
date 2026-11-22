// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_PREMIOS, sustituir } from "../campana/textos-premios";
import { abrirPremioDeLaCampana, type DepsDePremio, type ResultadoDeActivacion } from "./premio-recibir";
import { txUrl } from "../stellar/config";

/**
 * La pantalla de quien ganó un premio de una campaña (`premio-recibir.ts`), con la red de mentira.
 *
 * Un toque = abrir la línea (es la única firma del ganador: el claim lo llama la entrega programada,
 * issue #176). En camino mientras el premio no está pagado, Listo cuando la red lo dice, con el enlace a
 * la transacción. Y en la misma ventana, Tus premios: la lista leída de la red con `get_prize`, sin servidor.
 */

const CUENTA = "GCCIWHCU5XZ4VAK2GAFJBBTJJXIWPWBPK56JOGEPS6N6LP7AYLILD7F3";
const CONTRATO = "CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY";
const PROMO = "8";
const HASTA = 1_800_000_000_000;
const FECHA = "16/12/2026";
const TX = "3f1055d5";
const DOLLAR_STROOPS = "100000000";

type VistaDeLaPantalla = Awaited<ReturnType<NonNullable<DepsDePremio["premios"]>>>;

/** La vista de una promoción con un solo premio de la cuenta, en el estado que se le pide. */
const elPremio = (estado: "recibido" | "por-recibir" | "volvio", monto: string | null = DOLLAR_STROOPS): VistaDeLaPantalla => ({
  ok: true,
  premios: [{ puesto: 0, monto, estado, hastaMs: estado === "por-recibir" ? HASTA : null }],
});

const h = vi.hoisted(() => ({
  premios: vi.fn(),
  activar: vi.fn(),
  tx: vi.fn(),
  cada: vi.fn(),
  pausa: vi.fn(),
}));

/** Los reemplazos de la ventana: sin red, sin billetera y con el reloj en la mano de la prueba. */
const deps = (): Partial<DepsDePremio> => ({
  red: "testnet",
  cuenta: CUENTA,
  contrato: CONTRATO,
  promo: PROMO,
  recibirHastaMs: HASTA,
  premios: h.premios,
  activar: h.activar,
  txDelPago: h.tx,
  ahora: () => 1_700_000_000_000,
  pausa: h.pausa,
  cada: (f: () => void, ms: number) => h.cada(f, ms) as unknown as () => void,
  fecha: () => FECHA,
});

/** El texto de los textos de la pantalla, en español, con los {huecos} llenos. */
const tx = (clave: string, vars: Record<string, string> = {}): string => sustituir(TEXTOS_PREMIOS.es[clave] ?? "", vars);

/** Dos vueltas de microtareas: la primera lectura de la red (de mentira) ya quedó pintada. */
const drenar = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** La ventana abierta y sus piezas, ya pintadas. */
async function abrir(vista: VistaDeLaPantalla, resultado: ResultadoDeActivacion = "activada"): Promise<{ raiz: HTMLElement; principal: HTMLButtonElement }> {
  h.premios.mockResolvedValue(vista);
  h.activar.mockResolvedValue(resultado);
  expect(abrirPremioDeLaCampana({ cuenta: CUENTA, contrato: CONTRATO, promo: PROMO, recibirHastaMs: HASTA }, deps())).toBe(true);
  await drenar();
  const raiz = document.querySelector<HTMLElement>('[data-premio="ventana"]') as HTMLElement;
  expect(raiz).not.toBeNull();
  return { raiz, principal: raiz.querySelector<HTMLButtonElement>('[data-premio="principal"]') as HTMLButtonElement };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_CAMPANAS", "1");
  h.premios.mockReset();
  h.activar.mockReset();
  h.tx.mockReset();
  h.cada.mockReset();
  h.pausa.mockReset();
  h.tx.mockResolvedValue(null);
  document.body.replaceChildren();
});

describe("la pantalla de quien ganó", () => {
  it("abre con Ganaste y el monto, y un solo botón para Recibir", async () => {
    const { raiz, principal } = await abrir(elPremio("por-recibir"));
    expect(raiz.querySelector('[data-premio="gano-titulo"]')?.textContent).toBe(tx("prGanoTitulo"));
    expect(raiz.querySelector('[data-premio="gano-monto"]')?.textContent).toBe(tx("prGanoMonto", { monto: "10" }));
    expect(principal.textContent).toBe(tx("prRecibirBtn"));
    // Un solo botón: no hay Mandar ni carga en este modo.
    expect(raiz.querySelectorAll("button").length).toBe(1);
  });

  it("el toque abre la línea con activar, y nada más firmar: nunca un claim", async () => {
    const { principal } = await abrir(elPremio("por-recibir"));
    await principal.click();
    expect(h.activar).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    // Después del toque, la pantalla dice que el premio está en camino y mira la red por su cuenta.
    expect(document.querySelector('[data-premio="en-camino"]')).not.toBeNull();
    expect(document.querySelector('[data-premio="en-camino-linea"]')?.textContent).toBe(tx("prEnCaminoLinea"));
    // El observador quedó mirando con el reloj que le inyectaron.
    expect(h.cada).toHaveBeenCalledTimes(1);
    expect(h.activar).toHaveBeenCalledTimes(1);
  });

  it("en la línea sin premio sin estado: monto sin saber y Recibir igual", async () => {
    const { raiz, principal } = await abrir({ ok: true, premios: [{ puesto: null, monto: null, estado: "por-recibir", hastaMs: HASTA }] });
    expect(raiz.querySelector('[data-premio="gano-monto"]')).toBeNull();
    expect(principal.textContent).toBe(tx("prRecibirBtn"));
    // La lista lo dice igual: por recibir, hasta la fecha de la campaña.
    expect(raiz.querySelector('[data-premio="lista"]')?.textContent).toContain(tx("prEstadoPorRecibir", { fecha: FECHA }));
  });

  it("cada resultado de la línea, en palabras simples y con qué hacer", async () => {
    const casos: Array<[string, string, string]> = [
      ["no-aprobada", "prLineaNoAprobada", tx("prOtraVez")],
      ["ahora-no", "prLineaAhoraNo", tx("prOtraVez")],
      ["no-coincide", "prLineaNoCoincide", tx("prOtraVez")],
      ["no-coincide-tope", "prLineaNoCoincideTope", tx("prOtraVez")],
      ["no-patrocina", "prLineaNoPatrocina", tx("prOtraVez")],
      ["sin-xlm", "prLineaSinXlm", tx("prOtraVez")],
      ["otra-red", "prLineaOtraRed", tx("prOtraVez")],
      ["sin-red", "prLineaSinRed", tx("prOtraVez")],
      ["no-salio", "prLineaNoSalio", tx("prOtraVez")],
      ["no-corre", "prLineaNoCorre", tx("prOtraVez")],
      ["apagada", "prLineaApagada", tx("prOtraVez")],
      ["cuenta-creandose", "prLineaCuentaCreandose", tx("prVolverAMirar")],
      ["proteger", "prLineaProteger", tx("prOtraVez")],
      ["enviada", "prLineaEnviada", tx("prVolverAMirar")],
      ["en-curso", "prLineaEnCurso", tx("prVolverAMirar")],
      ["hecho", "prLineaHecho", tx("prVolverAMirar")],
    ];
    for (const [resultado, clave, principalEsperada] of casos) {
      h.premios.mockReset();
      h.activar.mockReset();
      document.body.replaceChildren();
      h.premios.mockResolvedValue(elPremio("por-recibir"));
      h.activar.mockResolvedValue(resultado as never);
      expect(abrirPremioDeLaCampana({ cuenta: CUENTA, contrato: CONTRATO, promo: PROMO, recibirHastaMs: HASTA }, deps())).toBe(true);
      await drenar();
      const principal = document.querySelector<HTMLButtonElement>('[data-premio="principal"]') as HTMLButtonElement;
      await principal.click();
      await Promise.resolve();
      await Promise.resolve();
      const pantalla = document.querySelector('[data-premio="linea"]') as HTMLElement;
      expect(pantalla, resultado).not.toBeNull();
      expect(pantalla.querySelector('[data-premio="linea-texto"]')?.textContent, resultado).toBe(tx(clave));
      expect((pantalla.querySelector('[data-premio="principal"]') as HTMLButtonElement).textContent, resultado).toBe(principalEsperada);
    }
  });

  it("en camino, y cuando la red dice que el premio está pagado: Listo, con el enlace a la transacción", async () => {
    const { principal, raiz } = await abrir(elPremio("por-recibir"));
    h.tx.mockResolvedValue(TX);
    await principal.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.tx).not.toHaveBeenCalled();
    // El primer toque del reloj: la promoción todavía no está pagada, la pantalla no cambia.
    const mira = h.cada.mock.calls[0]?.[0] as () => void;
    await mira();
    expect(document.querySelector('[data-premio="en-camino"]')).not.toBeNull();
    // La entrega programada pagó el premio: la próxima mirada ve Paid y pinta Listo, con el enlace.
    h.premios.mockResolvedValue(elPremio("recibido"));
    await mira();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('[data-premio="listo"]')).not.toBeNull();
    expect(document.querySelector('[data-premio="listo-linea"]')?.textContent).toBe(tx("prListoLinea"));
    const enlace = document.querySelector<HTMLAnchorElement>('[data-premio="listo-enlace"]');
    expect(enlace?.href).toBe(txUrl(TX, "testnet"));
    expect(enlace?.textContent).toBe(tx("prListoEnlaceTx"));
    expect(h.tx).toHaveBeenCalledTimes(1);
    // Ya no mira: el premio está pagado y la pantalla queda.
    expect(h.cada).toHaveBeenCalledTimes(1);
    expect(raiz).not.toBeNull();
  });

  it("repinta solo cuando el estado cambia: dos miradas iguales no tocan la pantalla", async () => {
    const { principal } = await abrir(elPremio("por-recibir"));
    await principal.click();
    await Promise.resolve();
    await Promise.resolve();
    const mira = h.cada.mock.calls[0]?.[0] as () => void;
    const antes = document.body.innerHTML;
    // La primera mirada del observador: sigue igual.
    await mira();
    expect(document.body.innerHTML).toBe(antes);
    // El mismo estado otra vez: tampoco.
    await mira();
    expect(document.body.innerHTML).toBe(antes);
  });

  it("el premio que volvió a la empresa se dice en la pantalla, sin Recibir", async () => {
    const { raiz } = await abrir(elPremio("volvio"));
    expect(raiz.querySelector('[data-premio="volvio"]')).not.toBeNull();
    expect(raiz.querySelector('[data-premio="volvio-linea"]')?.textContent).toBe(tx("prVolvioLinea"));
    expect(raiz.querySelector('[data-premio="principal"]')).toBeNull();
  });

  it("un premio que ya estaba pagado abre en Listo", async () => {
    h.tx.mockResolvedValue(TX);
    const { raiz } = await abrir(elPremio("recibido"));
    expect(raiz.querySelector('[data-premio="listo"]')).not.toBeNull();
  });

  it("la lectura de la red falla: lo dice en palabras y deja probar otra vez", async () => {
    // La primera lectura no contestó y la segunda sí: la pantalla dice por qué y deja probar.
    h.premios.mockResolvedValueOnce({ ok: false, error: "red-caida" } as unknown as VistaDeLaPantalla);
    h.premios.mockResolvedValue(elPremio("por-recibir"));
    expect(abrirPremioDeLaCampana({ cuenta: CUENTA, contrato: CONTRATO, promo: PROMO, recibirHastaMs: HASTA }, deps())).toBe(true);
    await drenar();
    const fallo = document.querySelector('[data-premio="leer-error"]') as HTMLElement;
    expect(fallo).not.toBeNull();
    expect(fallo.querySelector('[data-premio="leer-error-linea"]')?.textContent).toBe(tx("prErrRed"));
    await (document.querySelector<HTMLButtonElement>('[data-premio="principal"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    // La segunda lectura salió: la pantalla sigue con el premio.
    expect(document.querySelector('[data-premio="gano-titulo"]')).not.toBeNull();
  });

  it("una cuenta sin premio a su nombre: no hay nada que recibir, y la fila vacía lo dice", async () => {
    const { raiz } = await abrir({ ok: true, premios: [] });
    expect(raiz.querySelector('[data-premio="sin-premio"]')).not.toBeNull();
    expect(raiz.querySelector('[data-premio="sin-premio-linea"]')?.textContent).toBe(tx("prSinPremioLinea"));
    expect(raiz.querySelector('[data-premio="principal"]')).toBeNull();
  });

  it("Tus premios está en la misma ventana, con todos los premios de la cuenta", async () => {
    const { raiz } = await abrir({
      ok: true,
      premios: [
        { puesto: 0, monto: "100000000", estado: "recibido", hastaMs: null },
        { puesto: 2, monto: "1000000", estado: "por-recibir", hastaMs: HASTA },
        { puesto: 4, monto: "5000000", estado: "volvio", hastaMs: null },
      ],
    });
    const lista = raiz.querySelector('[data-premio="lista"]') as HTMLElement;
    expect(lista).not.toBeNull();
    expect(lista.textContent).toContain(tx("prPremiosTitulo"));
    expect(lista.textContent).toContain(tx("prEstadoRecibido"));
    expect(lista.textContent).toContain(tx("prEstadoPorRecibir", { fecha: FECHA }));
    expect(lista.textContent).toContain(tx("prEstadoVolvio"));
    expect(lista.textContent).toContain("10");
    expect(lista.textContent).toContain("0,1");
  });

  it("en el modo de solo recibir: sin Mandar, sin carga, sin dirección para traer saldo", async () => {
    const { raiz } = await abrir(elPremio("recibido"));
    const texto = raiz.textContent ?? "";
    expect(texto).not.toContain("Mandar");
    expect(texto).not.toContain("Cargar");
    expect(raiz.querySelector('[data-saldo]')).toBeNull();
    expect(raiz.querySelector("code")).toBeNull();
  });
});
