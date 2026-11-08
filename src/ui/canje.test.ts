// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, TOKEN, mundoFalso } from "../../workers/cuenta/src/mundo-falso";
import { setLang } from "../i18n";
import { abrirCanje } from "./canje";

/**
 * "Canjear" (`canje.ts`), la pantalla de quien atiende el stand, contra el Worker de verdad con un libro de mentira:
 * se pega la cuenta, se ve el saldo, se elige qué se lleva y se marca el canje. Una sola acción principal.
 */

const EQUIPO = Keypair.random().publicKey();

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
const campo = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const escribir = (el: HTMLInputElement, valor: string): void => {
  el.value = valor;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const radios = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('input[name="canje-item"]')];

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  setLang("es");
  vi.stubEnv("VITE_MONEDAS", "1");
  vi.stubEnv("VITE_CUENTA_URL", BASE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function conSaldo(saldo: number) {
  const m = await mundoFalso({ horizon: { cuentas: [EQUIPO] } });
  m.poner(EQUIPO, { saldo });
  vi.stubGlobal("fetch", m.fetch);
  return m;
}

describe("canjear en el stand", () => {
  it("con las monedas apagadas no abre nada", () => {
    vi.stubEnv("VITE_MONEDAS", "");
    abrirCanje();
    expect(dialogo()).toBeNull();
  });

  it("pega la cuenta, ve el saldo y lo que le alcanza, y canjea con un solo botón", async () => {
    const m = await conSaldo(70);
    abrirCanje();
    expect(principal().disabled).toBe(true);
    escribir(campo("canje-token"), TOKEN);
    escribir(campo("canje-cuenta"), EQUIPO);
    await vi.waitFor(() => expect(document.querySelector('[data-canje="saldo"]')?.textContent).toBe("Tiene 70 monedas."));
    // Chocolate (20) y stickers (50) alcanzan; el logo (100) y el cartel (200), no.
    expect(radios().map((r) => [r.value, r.disabled])).toEqual([
      ["chocolate", false],
      ["stickers", false],
      ["logo-en-el-show", true],
      ["nombre-en-el-cartel", true],
    ]);
    expect(radios()[0]?.checked).toBe(true);
    expect(principal().textContent).toBe("Canjear: Un chocolate");
    expect(principal().disabled).toBe(false);

    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Listo: Un chocolate. Le quedan 50 monedas."));
    expect(m.guardada(EQUIPO)?.saldo).toBe(50);
    expect(m.guardada(EQUIPO)?.canjes[0]).toMatchObject({ codigo: "chocolate", costo: 20 });
    // Queda el código recordado para el próximo, y el botón pasa a "Otro canje".
    expect(sessionStorage.getItem("tinkazo.canje.token")).toBe(TOKEN);
    expect(principal().textContent).toBe("Otro canje");
  });

  it("acepta lo que muestra el QR del participante: un enlace de pago, o 'stellar:' y la cuenta", async () => {
    await conSaldo(30);
    abrirCanje();
    escribir(campo("canje-token"), TOKEN);
    escribir(campo("canje-cuenta"), `stellar:${EQUIPO}`);
    await vi.waitFor(() => expect(document.querySelector('[data-canje="saldo"]')?.textContent).toBe("Tiene 30 monedas."));
  });

  it("algo que no es una cuenta lo dice y no deja canjear", async () => {
    await conSaldo(70);
    abrirCanje();
    escribir(campo("canje-token"), TOKEN);
    escribir(campo("canje-cuenta"), "hola");
    expect(document.querySelector('[data-canje="saldo"]')?.textContent).toBe("Esa no parece una cuenta de Tinkazo.");
    expect(principal().disabled).toBe(true);
  });

  it("si no le alcanza para nada, no se puede elegir y el botón queda apagado", async () => {
    await conSaldo(10);
    abrirCanje();
    escribir(campo("canje-token"), TOKEN);
    escribir(campo("canje-cuenta"), EQUIPO);
    await vi.waitFor(() => expect(document.querySelector('[data-canje="saldo"]')?.textContent).toBe("Tiene 10 monedas."));
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect(principal().disabled).toBe(true);
  });

  it("con un código que no es de quien organiza lo dice y no descuenta", async () => {
    const m = await conSaldo(70);
    abrirCanje();
    escribir(campo("canje-token"), "un-codigo-cualquiera-de-prueba-123");
    escribir(campo("canje-cuenta"), EQUIPO);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Ese código no es de quien organiza."));
    expect(m.guardada(EQUIPO)?.saldo).toBe(70);
    expect(sessionStorage.getItem("tinkazo.canje.token")).toBeNull();
  });

  it("si la red falla y se vuelve a tocar, el canje se reintenta con el mismo identificador y no descuenta dos veces", async () => {
    const m = await conSaldo(100);
    const ids: string[] = [];
    let primera = true;
    vi.stubGlobal("fetch", (async (u: string | URL | Request, i?: RequestInit) => {
      if (String(u).endsWith("/canje")) {
        ids.push((JSON.parse(String(i?.body)) as { id: string }).id);
        // El Worker recibe el canje y lo hace, pero la respuesta no llega.
        if (primera) {
          primera = false;
          await m.fetch(u, i);
          throw new Error("se cortó la red");
        }
      }
      return m.fetch(u, i);
    }) as typeof fetch);
    abrirCanje();
    escribir(campo("canje-token"), TOKEN);
    escribir(campo("canje-cuenta"), EQUIPO);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("No se pudo canjear ahora. Probá de nuevo."));
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("Ese canje ya estaba hecho"));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(m.guardada(EQUIPO)?.saldo).toBe(80);
  });

  it("'Otro canje' limpia la cuenta para el que sigue", async () => {
    await conSaldo(70);
    abrirCanje();
    escribir(campo("canje-token"), TOKEN);
    escribir(campo("canje-cuenta"), EQUIPO);
    await vi.waitFor(() => expect(principal().disabled).toBe(false));
    principal().click();
    await vi.waitFor(() => expect(principal().textContent).toBe("Otro canje"));
    principal().click();
    expect(campo("canje-cuenta").value).toBe("");
    expect(estado()).toBe("");
    expect(principal().textContent).toBe("Canjear");
    expect(principal().disabled).toBe(true);
  });

  it("sin cámara en el navegador, queda solo pegar la cuenta", () => {
    abrirCanje();
    expect(document.querySelector('[data-canje="escanear"]')).toBeNull();
  });

  it("recuerda el código de organización en esa pestaña", () => {
    sessionStorage.setItem("tinkazo.canje.token", TOKEN);
    abrirCanje();
    expect(campo("canje-token").value).toBe(TOKEN);
  });
});
