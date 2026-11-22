// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destinoDeRecibir } from "../campana/recibir";
import { T, setLang, t } from "../i18n";
import { network } from "../stellar/config";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type CuentaDelPaso, GUARDA_DE_TOQUE_MS, type OpcionesDelPaso, type SalidasDelPaso, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";

/**
 * La pared de quien ganó con una cuenta que se usó en otro navegador (`para: "premio"`, protección sin forma): dice dónde
 * abrirlo y da el enlace para llevarlo, con Mandarme el enlace donde se puede compartir y Copiar el enlace donde no. Nunca
 * Pasar a Prueba. Y para quien gana con una cuenta que falta confirmar, el código al correo va primero y el desbloqueo
 * queda de texto: solo con el correo confirmado se entra desde cualquier lado.
 */

const SIN_FORMA: EstadoOficial = { activacion: "lista", proteccion: "sin-forma", correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };
const FALTA: EstadoOficial = { activacion: "lista", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
const ORIGEN = "https://tinkazo.app";
const ENLACE = `${ORIGEN}${destinoDeRecibir(network.name)}`;

function cuentaSimulada(estado: EstadoOficial): CuentaDelPaso {
  return {
    estadoOficial: vi.fn(async () => ({ ...estado })),
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

function salidasSimuladas() {
  return {
    cerrarSesion: vi.fn(async () => undefined),
    pasarAPrueba: vi.fn(),
    puedePasarAPrueba: vi.fn(() => true),
    entrarDeNuevo: vi.fn(),
  } satisfies SalidasDelPaso;
}

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const botones = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const textoDe = (): string => raiz()?.textContent ?? "";
const campoEnlace = (): HTMLInputElement | null => raiz()?.querySelector<HTMLInputElement>("input.cl-enlace") ?? null;
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

async function abrir(estado: EstadoOficial, o: Partial<OpcionesDelPaso> = {}, celular = true) {
  const salidas = salidasSimuladas();
  const promesa = abrirCuentaLista(cuentaSimulada(estado), salidas, { para: "premio", correo: "nora@gmail.com", celular, inicial: estado, ...o });
  await pasa();
  return { salidas, promesa };
}

beforeEach(() => {
  vi.useFakeTimers();
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<header id="cab">cabecera</header><main id="pagina"></main>`;
});

afterEach(async () => {
  if (raiz()) {
    botones().find((x) => x.textContent === t("acctSignOut"))?.click();
    await vi.advanceTimersByTimeAsync(10);
  }
  aceptarClicsDePrueba(false);
  vi.useRealTimers();
});

describe("la pared del premio, con la cuenta usada en otro navegador", () => {
  it("dice dónde abrirlo y la principal es Mandarme el enlace donde se puede compartir, nunca Pasar a Prueba", async () => {
    const compartir = vi.fn(async () => undefined);
    await abrir(SIN_FORMA, { enlace: { compartir, copiar: null, origen: ORIGEN } });
    expect(raiz()?.querySelector(".cl-titulo")?.textContent).toBe(t("clSinFormaPremioTitulo"));
    expect(textoDe()).toContain(t("clSinFormaPremio"));
    expect(principal().textContent).toBe(t("clMandarmeEnlace"));
    expect(botones().some((b) => b.textContent === t("modeSwitchToTest") && !b.hidden)).toBe(false);
    expect(raiz()?.querySelectorAll(".cl-principal").length).toBe(1);
    principal().click();
    await pasa(10);
    expect(compartir).toHaveBeenCalledWith(ENLACE);
  });

  it("el contacto y la pista de las apps quedan plegados", async () => {
    await abrir(SIN_FORMA, { enlace: { compartir: null, copiar: null, origen: ORIGEN } });
    const pliegue = raiz()?.querySelector("details");
    expect(pliegue).not.toBeNull();
    expect(pliegue?.open).toBe(false);
    expect(pliegue?.textContent).toContain(t("clSinFormaPista"));
    expect(pliegue?.textContent).toContain(t("clContacto"));
  });

  it("si la persona cierra el menú de compartir, no pasa nada: sigue la misma principal y no se copia", async () => {
    const copiar = vi.fn(async () => undefined);
    const compartir = vi.fn(async () => {
      throw new DOMException("cerrado", "AbortError");
    });
    await abrir(SIN_FORMA, { enlace: { compartir, copiar, origen: ORIGEN } });
    principal().click();
    await pasa(10);
    expect(copiar).not.toHaveBeenCalled();
    expect(principal().textContent).toBe(t("clMandarmeEnlace"));
    expect(campoEnlace()).toBeNull();
  });

  it("si el navegador no deja compartir, pasa a copiar el enlace", async () => {
    const copiar = vi.fn(async () => undefined);
    const compartir = vi.fn(async () => {
      throw new DOMException("no", "NotAllowedError");
    });
    await abrir(SIN_FORMA, { enlace: { compartir, copiar, origen: ORIGEN } });
    principal().click();
    await pasa(10);
    expect(copiar).toHaveBeenCalledWith(ENLACE);
    expect(textoDe()).toContain(t("clEnlaceCopiado"));
    expect(principal().textContent).toBe(t("clCopiarEnlace"));
  });

  it("donde no se puede compartir, la principal es Copiar el enlace: lo copia y dice que lo abra en el otro navegador", async () => {
    const copiar = vi.fn(async () => undefined);
    await abrir(SIN_FORMA, { enlace: { compartir: null, copiar, origen: ORIGEN } });
    expect(principal().textContent).toBe(t("clCopiarEnlace"));
    principal().click();
    await pasa(10);
    expect(copiar).toHaveBeenCalledWith(ENLACE);
    expect(textoDe()).toContain(t("clEnlaceCopiado"));
    expect(campoEnlace()).toBeNull();
  });

  it("sin portapapeles, el enlace queda a la vista en un campo de solo lectura, ya elegido", async () => {
    await abrir(SIN_FORMA, { enlace: { compartir: null, copiar: null, origen: ORIGEN } });
    principal().click();
    await pasa(10);
    const campo = campoEnlace();
    expect(campo?.value).toBe(ENLACE);
    expect(campo?.readOnly).toBe(true);
    expect(document.activeElement).toBe(campo);
    expect(textoDe()).not.toContain(t("clEnlaceCopiado"));
  });

  it("el texto está en los dos idiomas", async () => {
    setLang("en");
    await abrir(SIN_FORMA, { enlace: { compartir: null, copiar: null, origen: ORIGEN } });
    expect(raiz()?.querySelector(".cl-titulo")?.textContent).toBe(T.en.clSinFormaPremioTitulo);
    expect(principal().textContent).toBe(T.en.clCopiarEnlace);
  });

  it("quien organiza sigue con Pasar a Prueba", async () => {
    await abrir(SIN_FORMA, { para: "entrada", enlace: { compartir: null, copiar: null, origen: ORIGEN } });
    expect(raiz()?.querySelector(".cl-titulo")?.textContent).toBe(t("clSinFormaTitulo"));
    expect(principal().textContent).toBe(t("modeSwitchToTest"));
  });
});

describe("quien ganó y tiene que confirmar el correo", () => {
  it("el código al correo de la sesión es lo principal y el desbloqueo queda de texto", async () => {
    await abrir(FALTA, { puedeUsarDesbloqueo: async () => true });
    expect(principal().textContent).toContain("nora@gmail.com".replace("nora", "n•••"));
    expect(botones().some((b) => b.textContent === t("clDesbloqueoCel") && b.classList.contains("cl-texto"))).toBe(true);
  });

  it("quien organiza sigue con el desbloqueo primero", async () => {
    await abrir(FALTA, { para: "entrada", puedeUsarDesbloqueo: async () => true });
    expect(principal().textContent).toBe(t("clDesbloqueoCel"));
  });
});
