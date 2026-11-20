// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { network } from "../stellar/config";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type CuentaDelPaso, GUARDA_DE_TOQUE_MS, type SalidasDelPaso, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";
import { FIRST_OFFICIAL_KEY, confirmarPrimerSelloOficial, haceFaltaConfirmar, marcarPrimerOficial, yaConfirmoPrimerOficial } from "./modo-ui";

/**
 * La pantalla que el issue #82 quita entre el cupón y el primer sello: al entrar sin lista, el final del paso
 * («Tu cuenta está lista») muestra el texto del registro público del primer sello y Seguir lo marca visto. Así el
 * primer sello sigue sin otra confirmación: se ahorra el toque de «Vas a sellar en modo Oficial → Sellar».
 *
 * Acá el cable es el de verdad (el de `cuenta-lista-flujo.ts`): `pendiente` y `marcar` son los de modo-ui, no
 * simulacros. La mitad del paso está en `cuenta-lista.test.ts` (con un `marcar` propio) y la del diálogo en
 * `modo-ui-confirmar.test.ts`; esta prueba une las dos con la llave real del navegador.
 */

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, network: { ...o.network, name: "mainnet" as const } };
});

const LISTA: EstadoOficial = { activacion: "lista", proteccion: "lista", correoConfirmado: true, tieneLlaves: true, unicoNavegador: true, correoDeLaCuenta: "nora@gmail.com" };

function cuentaSimulada(): CuentaDelPaso {
  const estado = { ...LISTA };
  return {
    estadoOficial: vi.fn(async () => {
      return { ...estado };
    }),
    activarCuenta: vi.fn(async () => "activada" as const),
    alCambiarLaCuenta: () => () => undefined,
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => true),
    mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
    confirmarCodigoParaEsteAparato: vi.fn(async () => true),
    protegerConPasskey: vi.fn(async () => true),
    mandarCodigoDeProteccion: vi.fn(async () => undefined),
    confirmarCodigoDeProteccion: vi.fn(async () => true),
  };
}

function salidasSimuladas(): SalidasDelPaso {
  return { cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() };
}

/** El mismo cable que arma `cuenta-lista-flujo.ts` para el paso. */
const primerOficialDeVerdad = { pendiente: () => haceFaltaConfirmar(network.name, yaConfirmoPrimerOficial()), marcar: marcarPrimerOficial };

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const textoDe = (): string => raiz()?.textContent ?? "";
const dialogo = (): Element | null => document.querySelector(".dlg-card");
const botonDelDialogo = (texto: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>(".dlg-card button")].find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay un botón "${texto}"`);
  return b;
};
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

/** Abre el paso al final de la entrada, como al entrar sin lista (`revisarCuentaOficial`, para «entrada»). */
async function abrirAlFinal(o: Partial<Parameters<typeof abrirCuentaLista>[2]> = {}): Promise<{ promesa: Promise<boolean> }> {
  const promesa = abrirCuentaLista(cuentaSimulada(), salidasSimuladas(), {
    para: "entrada",
    correo: "nora@gmail.com",
    celular: false,
    inicial: { activacion: "lista", proteccion: "lista" },
    ...o,
  });
  await pasa();
  return { promesa };
}

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  localStorage.clear();
  document.body.innerHTML = `<header id="cab">cabecera</header><main id="pagina"><button id="btn-freeze">Sellar la lista</button><button id="btn-pegar">Pegar lista</button></main>`;
});

afterEach(async () => {
  // Si una prueba dejó el paso abierto, se cierra con su salida.
  if (raiz()) {
    const b = [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((x) => x.textContent === t("acctSignOut"));
    b?.click();
    await vi.advanceTimersByTimeAsync(10);
  }
  aceptarClicsDePrueba(false);
  vi.useRealTimers();
});

describe("una pantalla menos entre el cupón y el primer sello", () => {
  it("al entrar sin lista: el texto del registro está en el final de entrada, Seguir lo marca y el primer sello no pregunta (1 toque)", async () => {
    expect(primerOficialDeVerdad.pendiente()).toBe(true);
    const { promesa } = await abrirAlFinal({ primerOficial: primerOficialDeVerdad });
    // S3: la información del registro público se muestra antes del primer sello.
    expect(textoDe()).toContain("Solo se publica el sello, nunca los nombres.");
    expect(principal().textContent).toBe(t("clSeguir"));
    // Toque 1: Seguir.
    principal().click();
    expect(localStorage.getItem(FIRST_OFFICIAL_KEY)).not.toBeNull();
    expect(primerOficialDeVerdad.pendiente()).toBe(false);
    await expect(promesa).resolves.toBe(true);
    // Toque del primer sello: ninguno. La compuerta de `freeze.ts` sigue sin preguntar.
    expect(dialogo()).toBeNull();
    await expect(confirmarPrimerSelloOficial()).resolves.toBe(true);
    expect(dialogo()).toBeNull();
  });

  it("sin la marca del final de entrada (como antes del arreglo), el primer sello pide su confirmación: 2 toques", async () => {
    const { promesa } = await abrirAlFinal();
    // El final de entrada no trae el texto ni marca: la pantalla de antes.
    expect(textoDe()).not.toContain(t("clPrimerSello"));
    // Toque 1: Seguir, sin marca.
    principal().click();
    await expect(promesa).resolves.toBe(true);
    expect(localStorage.getItem(FIRST_OFFICIAL_KEY)).toBeNull();
    // Toque 2: «Vas a sellar en modo Oficial → Sellar».
    const sello = confirmarPrimerSelloOficial();
    expect(dialogo()).not.toBeNull();
    expect(document.querySelector(".dlg-h")?.textContent).toBe(t("firstOfficialTitle"));
    botonDelDialogo(t("firstOfficialSeal")).click();
    await expect(sello).resolves.toBe(true);
    expect(localStorage.getItem(FIRST_OFFICIAL_KEY)).not.toBeNull();
    expect(dialogo()).toBeNull();
  });
});
