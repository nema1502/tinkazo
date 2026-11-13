import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA } from "../alta-textos";
import { TEXTOS_ALTA_PAGO } from "../alta-textos-pago";
import { TEXTOS_ALTA_SIN_PAGO, TEXTOS_ALTA_SIN_VENTA } from "../alta-textos-sin-pago";
import { T } from "../i18n";
import type { OrdenDePago } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import { ACCESO_LIBRE, type AccesoEnLaVista, type EntradaVista, type PagoEnLaVista, type Texto, pagoInicial, vistaDe } from "./cuenta-lista-estado";
import { type EstadoDelPaquete, type FaseDelPaquete, paqueteInicial, vistaDelPaquete } from "./pago-paquete";

/**
 * Comprar tiene que verse simple: quien compra algo nuevo y ve una pantalla llena de texto se va. En cada estado de la
 * compra (el primer paquete en «Dejá tu cuenta lista» y la ventana de sumar sorteos), como mucho un título corto (hasta 6
 * palabras), una sola línea a la vista (hasta 14 palabras: la ayuda, o lo que pasó, o el error, nunca dos) y una sola
 * acción principal. Los datos para pagar van como datos, con su rótulo. Todo lo demás va plegado en Más detalles.
 */

const IDIOMAS = ["es", "en"] as const;
const palabras = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** El texto como se ve con la compra prendida en el build: el de la compra, no su variante sin compra. */
const texto = (l: "es" | "en", k: string): string => String(TEXTOS_ALTA_PAGO[l][k] ?? TEXTOS_ALTA[l][k] ?? T[l][k] ?? "");
const poner = (l: "es" | "en", x: Texto): string => Object.entries(x.vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), texto(l, x.clave));

const ALTA: ProductoALaVenta = { id: "alta", usdc: "3", sorteos: 3, dias: 90 };
const P10: ProductoALaVenta = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
const P50: ProductoALaVenta = { id: "p50", usdc: "25", sorteos: 50, dias: 365 };
const orden = (producto = "alta", usdc = "3"): OrdenDePago => ({
  id: "ABCD2345",
  producto,
  usdc,
  sorteos: 3,
  destino: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  nota: "tk:o:ABCD2345",
  memoId: memoIdDe("ABCD2345") as string,
  enlace: "web+stellar:pay?destination=GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  vence: Date.UTC(2026, 10, 19, 15, 0),
});

const MARCAS: Partial<PagoEnLaVista>[] = [
  {},
  { buscando: true },
  { buscando: true, noVisto: true },
  { noVisto: true },
  { tarda: true, noVisto: true },
  { tarda: true, noLlego: true },
  { falta: { recibido: "1.5", total: "3" } },
  { falta: { recibido: "1.5", total: "3" }, buscando: true },
  { vencida: true },
  { vencida: true, falta: { recibido: "1.5", total: "3" } },
];
const ERRORES: [Texto | null, AccesoEnLaVista["arreglo"]][] = [
  [null, "probar"],
  [{ clave: "pagoErrRed" }, "probar"],
  [{ clave: "altaErrServicio" }, "probar"],
  [{ clave: "pagoNoALaVenta" }, "probar"],
  [{ clave: "pagoErrOrden" }, "ninguno"],
  [{ clave: "clErrSesion" }, "entrar"],
  [{ clave: "altaErrCuentaDeOtro" }, "ninguno"],
];
/**
 * El error de una cuenta unida al acceso de otra es del paso de la cuenta (lo usa también el cupón, con su prueba) y se
 * revisa a mano: va igual en una sola línea, pero su largo no lo decide la compra.
 */
const LARGO_AJENO = new Set(["altaErrCuentaDeOtro"]);

const base: EntradaVista = {
  activacion: "falta",
  proteccion: "falta",
  correoConfirmado: false,
  tieneLlaves: false,
  unicoNavegador: true,
  corre: null,
  lento: false,
  falla: null,
  aviso: null,
  para: "entrada",
  celular: true,
  hayDesbloqueo: true,
  desbloqueoFallo: false,
  eligioCorreo: false,
  correoSesion: "n•••@gmail.com",
  correoCuenta: "",
  entroConCorreo: false,
  codigo: null,
  codigoRecargado: false,
  campoOk: false,
  sinPedidoVeces: 0,
  puedePasarAPrueba: true,
  primerOficialPendiente: false,
};

/** Cada estado de la compra del primer paquete, en los dos idiomas, con la cuenta activada o no. */
function estadosDelPaso(): EntradaVista[] {
  const out: EntradaVista[] = [];
  for (const idioma of IDIOMAS)
    for (const activacion of ["falta", "lista"] as const)
      for (const alta of [ALTA, null])
        for (const fase of ["ofrecer", "pidiendo", "pagando"] as const)
          for (const marcas of fase === "pagando" ? MARCAS : [{}])
            for (const [error, arreglo] of ERRORES) {
              // Sin nada a la venta y sin una compra frenada es la caja del cupón de siempre, no una pantalla de la compra.
              if (!alta && fase === "ofrecer" && !error) continue;
              const pago: PagoEnLaVista = { ...pagoInicial(idioma, alta), fase, orden: fase === "pagando" ? orden() : null, ...marcas, error, arreglo };
              out.push({ ...base, activacion, acceso: { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", pago } });
            }
  return out;
}

/** Cada estado de la ventana de sumar sorteos. */
function estadosDeLaVentana(): EstadoDelPaquete[] {
  const out: EstadoDelPaquete[] = [];
  const fases: FaseDelPaquete[] = ["leyendo", "elegir", "pidiendo", "pagando", "listo", "sin-venta"];
  for (const idioma of IDIOMAS)
    for (const fase of fases)
      for (const paquetes of [[], [P10], [P10, P50]])
        for (const marcas of fase === "pagando" ? MARCAS : [{}])
          for (const [error, arreglo] of ERRORES)
            for (const quedan of fase === "listo" ? [null, 1, 13] : [null])
              out.push({ ...paqueteInicial(idioma, "a•••@gmail.com"), fase, paquetes, elegido: paquetes[0] ?? null, orden: fase === "pagando" ? orden("p10", "9") : null, ...marcas, error, arreglo: arreglo === "entrar" ? "ninguno" : arreglo, quedan } as EstadoDelPaquete);
  return out;
}

describe("comprar se ve simple", () => {
  it("«Dejá tu cuenta lista», en cada estado de la compra: un título corto, una sola línea a la vista y una principal", () => {
    let filas = 0;
    for (const e of estadosDelPaso()) {
      const l = e.acceso?.pago?.idioma ?? "es";
      const vista = vistaDe(e);
      const caja = vista.cajas.find((c) => c.abierta);
      if (!caja) continue;
      const quien = JSON.stringify({ l, activacion: e.activacion, pago: { ...e.acceso?.pago, medios: undefined } });
      filas++;
      expect(palabras(String(T[l][caja.titulo])), quien).toBeLessThanOrEqual(6);
      const lineas = [...caja.textos, ...(caja.nota ? [caja.nota] : []), ...(caja.error ?? [])];
      expect(lineas.length, quien).toBeLessThanOrEqual(1);
      for (const x of lineas) if (!LARGO_AJENO.has(x.clave)) expect(palabras(poner(l, x)), `${quien} ${x.clave}: ${poner(l, x)}`).toBeLessThanOrEqual(14);
      expect(caja.cierre ?? [], quien).toEqual([]);
      if (vista.principal) expect(palabras(poner(l, vista.principal)), quien).toBeLessThanOrEqual(8);
    }
    expect(filas).toBeGreaterThan(300);
  });

  it("la ventana de sumar sorteos, en cada estado: un título corto, una sola línea a la vista y una principal", () => {
    let filas = 0;
    for (const e of estadosDeLaVentana()) {
      const l = e.idioma;
      const v = vistaDelPaquete(e);
      const quien = JSON.stringify({ ...e, paquetes: e.paquetes.map((p) => p.id), orden: !!e.orden });
      filas++;
      expect(palabras(String(T[l].cupoOfSumar)), quien).toBeLessThanOrEqual(6);
      const lineas = [...v.textos, ...(v.nota ? [v.nota] : []), ...(v.error ? [v.error] : [])];
      expect(lineas.length, quien).toBeLessThanOrEqual(1);
      for (const x of lineas) if (!LARGO_AJENO.has(x.clave)) expect(palabras(poner(l, x)), `${quien} ${x.clave}: ${poner(l, x)}`).toBeLessThanOrEqual(14);
      expect(v.cierre, quien).toEqual([]);
      expect(v.principal, quien).toBeTruthy();
    }
    expect(filas).toBeGreaterThan(300);
  });

  it("pagando, lo que no hace falta para pagar va plegado en Más detalles, y los datos van como datos", () => {
    for (const l of IDIOMAS) {
      const pago: PagoEnLaVista = { ...pagoInicial(l, ALTA), fase: "pagando", orden: orden() };
      const caja = vistaDe({ ...base, acceso: { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", pago } }).cajas[0];
      expect(caja?.titulo).toBe("pagoTitulo");
      // La línea nueva, la de pagar desde tu app. Plegado, lo que no hace falta para pagar.
      const plegado = ["pagoParaCuenta", "pagoVence", "compraNotaMemo", "compraSinDolares"];
      expect(caja?.textos.map((x) => x.clave)).toEqual(["compraAppLinea"]);
      expect(caja?.pago?.detalles.map((x) => x.clave)).toEqual(plegado);
      const ventana = vistaDelPaquete({ ...paqueteInicial(l, "a•••@gmail.com"), fase: "pagando", paquetes: [P10], elegido: P10, orden: orden("p10", "9") });
      expect(ventana.textos.map((x) => x.clave)).toEqual(["compraAppLinea"]);
      expect(ventana.panel?.detalles.map((x) => x.clave)).toEqual(plegado);
      for (const k of ["pagoCuenta", "pagoMonto", "compraNotaRotulo", "pagoQrAyuda", "pagoMasDetalles"]) expect(palabras(String(T[l][k])), `${l} ${k}`).toBeLessThanOrEqual(6);
    }
  });

  it("el enlace de cambio, Estoy en Bolivia, va dentro del panel y antes de los datos: no suma una línea ni otra principal", () => {
    for (const l of IDIOMAS) {
      const pago: PagoEnLaVista = { ...pagoInicial(l, ALTA), fase: "pagando", orden: orden(), cambio: true };
      const vista = vistaDe({ ...base, acceso: { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", pago } });
      expect(vista.cajas[0]?.pago?.cambio).toEqual({ clave: "compraEstoy" });
      expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["compraAppLinea"]);
      expect(vista.principal?.accion).toBe("ya-pague");
      const sin = vistaDe({ ...base, acceso: { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", pago: { ...pago, cambio: false } } });
      expect(sin.cajas[0]?.pago?.cambio ?? null).toBeNull();
      const ventana = vistaDelPaquete({ ...paqueteInicial(l, "a•••@gmail.com"), fase: "pagando", paquetes: [P10], elegido: P10, orden: orden("p10", "9"), cambio: true });
      expect(ventana.panel?.cambio).toEqual({ clave: "compraEstoy" });
      expect(vistaDelPaquete({ ...paqueteInicial(l, "a•••@gmail.com"), fase: "pagando", paquetes: [P10], elegido: P10, orden: orden("p10", "9") }).panel?.cambio ?? null).toBeNull();
    }
  });

  it("sin cupón y con el primer paquete a la venta: una sola línea, y lo demás plegado", () => {
    for (const activacion of ["falta", "lista"] as const) {
      const pago: PagoEnLaVista = pagoInicial("es", ALTA);
      const caja = vistaDe({ ...base, activacion, acceso: { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", pago } }).cajas[0];
      expect(caja?.textos.map((x) => x.clave)).toEqual([activacion === "lista" ? "altaYaActivada" : "altaTexto"]);
      expect(caja?.cierre ?? []).toEqual([]);
      expect(caja?.detalles?.map((x) => x.clave)).toEqual(activacion === "lista" ? ["altaNoTengo"] : ["altaPrimerPaqueteNota", "altaNoTengo"]);
    }
  });

  it("en los textos de la compra no hay comillas angulares ni punto y coma, en ninguna de las dos lenguas", () => {
    for (const fuente of [TEXTOS_ALTA, TEXTOS_ALTA_PAGO, TEXTOS_ALTA_SIN_PAGO, TEXTOS_ALTA_SIN_VENTA])
      for (const l of IDIOMAS) for (const [k, s] of Object.entries(fuente[l])) expect(s, `${l} ${k}`).not.toMatch(/[«»;]/);
  });
});
