// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T, setLang } from "../i18n";
import { app } from "../state";
import { saveSessionKind } from "../stellar/session-store";
import { MARCA_INGRESAR } from "./cuenta-estado";
import { CLAVE_PASO_CUPON } from "../stellar/cupon-paso-guardado";
import { abrirHojaDeModo, cambioBloqueado, haceFaltaConfirmar, marcarSellandoAhora, otroModo, pasarAModo, puedeCambiarDeModo } from "./modo-ui";

const h = vi.hoisted(() => ({
  red: "testnet" as "mainnet" | "testnet",
  cambios: [] as string[],
  destinos: [] as (string | undefined)[],
  cambia: true,
  tipo: "sin" as "sin" | "propia" | "sitio" | "prueba",
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    network: {
      ...o.network,
      get name() {
        return h.red;
      },
    },
    changeMode: (r: string, hash?: string) => {
      h.cambios.push(r);
      h.destinos.push(hash);
      return h.cambia;
    },
  };
});

vi.mock("../stellar/wallet-lite", () => ({
  activeWallet: () =>
    h.tipo === "sin"
      ? null
      : {
          address: "GAAA",
          kind: h.tipo === "prueba" ? "guest" : "external",
          label: h.tipo === "prueba" ? "Cuenta de prueba" : h.tipo === "propia" ? "Varial" : "Google",
          ...(h.tipo === "sitio" ? { submitsItself: true } : {}),
        },
}));

describe("la hoja para cambiar de modo", () => {
  it("un sorteo sellado esperando su número bloquea el cambio", () => {
    expect(cambioBloqueado({ names: ["Ana"] }, null)).toBe(true);
    expect(cambioBloqueado({ names: ["Ana"] }, { winners: [0] })).toBe(false);
    expect(cambioBloqueado(null, null)).toBe(false);
  });

  it("la confirmación es solo la primera vez y solo en Oficial", () => {
    expect(haceFaltaConfirmar("mainnet", false)).toBe(true);
    expect(haceFaltaConfirmar("mainnet", true)).toBe(false);
    expect(haceFaltaConfirmar("testnet", false)).toBe(false);
  });

  it("el otro modo es siempre el contrario", () => {
    expect(otroModo("testnet")).toBe("mainnet");
    expect(otroModo("mainnet")).toBe("testnet");
  });
});

describe("la guarda del cambio de modo, en un solo lugar", () => {
  beforeEach(() => {
    h.red = "testnet";
    h.cambios = [];
    h.destinos = [];
    h.cambia = true;
    h.tipo = "sin";
    setLang("es");
    history.replaceState(null, "", "/");
    localStorage.clear();
    app.frozen = null;
    app.drawn = null;
    marcarSellandoAhora(false);
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  it("con un sorteo sellado esperando su número no se cambia de modo", () => {
    app.frozen = { names: ["Ana", "Beto"] } as unknown as typeof app.frozen;
    expect(puedeCambiarDeModo()).toBe(false);
    expect(pasarAModo("mainnet")).toBe(false);
    expect(h.cambios).toEqual([]);
  });

  it("mientras se sella tampoco, aunque el sello todavía no haya entrado: la hoja lo dice con el botón apagado", () => {
    marcarSellandoAhora(true);
    expect(puedeCambiarDeModo()).toBe(false);
    expect(pasarAModo("mainnet")).toBe(false);
    expect(h.cambios).toEqual([]);
    abrirHojaDeModo();
    const boton = document.querySelector<HTMLButtonElement>(".modo-card .modo-cambiar");
    expect(boton?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".modo-card .modo-cupon")?.disabled).toBe(true);
    expect(document.querySelector(".modo-bloqueo")?.textContent).toBe(T.es.modeSwitchBlocked);
    // Y si el botón se tocara igual (el foco, un lector de pantalla), la guarda no deja pasar.
    boton?.dispatchEvent(new Event("click"));
    expect(h.cambios).toEqual([]);
  });

  it("terminado el sello o ya sorteado, se cambia", () => {
    marcarSellandoAhora(true);
    marcarSellandoAhora(false);
    expect(pasarAModo("mainnet")).toBe(true);
    app.frozen = { names: ["Ana", "Beto"] } as unknown as typeof app.frozen;
    app.drawn = { winners: [0] } as unknown as typeof app.drawn;
    expect(pasarAModo("testnet")).toBe(true);
    expect(h.cambios).toEqual(["mainnet", "testnet"]);
  });

  it("en Prueba ofrece Tengo un cupón: pasa a Oficial y deja pedido el campo del cupón", () => {
    abrirHojaDeModo();
    const cupon = document.querySelector<HTMLButtonElement>(".modo-card .modo-cupon");
    expect(cupon?.textContent).toBe(T.es.modeHaveCoupon);
    expect(T.en.modeHaveCoupon).toBe("I have a coupon");
    cupon?.click();
    expect(h.cambios).toEqual(["mainnet"]);
    expect(h.destinos).toEqual(["sortear"]);
    expect(sessionStorage.getItem(CLAVE_PASO_CUPON)).toBe("1");
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBe("1");
  });

  it("Tengo un cupón conserva uno bien formado que ya venía en la dirección", () => {
    history.replaceState(null, "", "/?red=prueba#cupon=K7M29QXA4HTR");
    abrirHojaDeModo();
    document.querySelector<HTMLButtonElement>(".modo-card .modo-cupon")?.click();
    expect(h.cambios).toEqual(["mainnet"]);
    // Sin destino forzado, changeMode conserva el fragmento y Oficial lee el cupón como siempre.
    expect(h.destinos).toEqual([undefined]);
    expect(sessionStorage.getItem(CLAVE_PASO_CUPON)).toBe("1");
    // La puerta de #sortear no corresponde a esta dirección: el enlace del cupón ya tiene su propia entrada.
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBeNull();
  });

  it("con una cuenta de Oficial para retomar, el cupón no deja una marca de ingresar", () => {
    saveSessionKind("google", "mainnet");
    abrirHojaDeModo();
    document.querySelector<HTMLButtonElement>(".modo-card .modo-cupon")?.click();
    expect(h.destinos).toEqual(["sortear"]);
    expect(sessionStorage.getItem(CLAVE_PASO_CUPON)).toBe("1");
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBeNull();
  });

  it("volver a Prueba limpia un campo del cupón que no se llegó a usar", () => {
    sessionStorage.setItem(CLAVE_PASO_CUPON, "1");
    expect(pasarAModo("testnet")).toBe(true);
    expect(sessionStorage.getItem(CLAVE_PASO_CUPON)).toBeNull();
  });

  it("sin cuenta en el otro modo, un cambio que recarga abre #sortear y deja la marca de ingresar", () => {
    expect(pasarAModo("mainnet")).toBe(true);
    expect(h.destinos).toEqual(["sortear"]);
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBe("1");
  });

  it.each([
    ["sitio", "mainnet", true],
    ["sitio", "testnet", true],
    ["propia", "mainnet", false],
    ["propia", "testnet", false],
    ["prueba", "mainnet", true],
    ["prueba", "testnet", false],
  ] as const)("con una cuenta %s al pasar a %s, la marca de ingresar es %s", (tipo, target, esperada) => {
    h.tipo = tipo;
    h.red = target === "mainnet" ? "testnet" : "mainnet";
    expect(pasarAModo(target)).toBe(true);
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBe(esperada ? "1" : null);
  });

  it("con cuenta en el otro modo no pide entrar de nuevo ni cambia el destino", () => {
    saveSessionKind("google", "mainnet");
    expect(pasarAModo("mainnet")).toBe(true);
    expect(h.destinos).toEqual([undefined]);
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBeNull();
  });

  it("si el cambio no recarga, no deja la marca de ingresar", () => {
    h.cambia = false;
    expect(pasarAModo("mainnet")).toBe(false);
    expect(sessionStorage.getItem(MARCA_INGRESAR)).toBeNull();
  });

  it.each([
    ["es", "testnet", "Cada modo tiene su propia cuenta. En Oficial vas a entrar una vez más, y tu cuenta de Prueba sigue acá cuando vuelvas."],
    ["es", "mainnet", "Cada modo tiene su propia cuenta. En Prueba vas a entrar una vez más, y tu cuenta de Oficial sigue acá cuando vuelvas."],
    ["en", "testnet", "Each mode has its own account. You'll sign in once more in Live, and your Test account will still be here when you come back."],
    ["en", "mainnet", "Each mode has its own account. You'll sign in once more in Test, and your Live account will still be here when you come back."],
  ] as const)("la hoja avisa la cuenta del otro modo en %s desde %s", (lang, red, texto) => {
    h.tipo = "sitio";
    h.red = red;
    setLang(lang);
    abrirHojaDeModo();
    expect(document.querySelector(".modo-cuenta")?.textContent).toBe(texto);
  });

  it("con una billetera propia no avisa de otra cuenta en ninguno de los dos sentidos", () => {
    h.tipo = "propia";
    for (const red of ["testnet", "mainnet"] as const) {
      h.red = red;
      abrirHojaDeModo();
      expect(document.querySelector(".modo-cuenta")).toBeNull();
    }
  });

  it.each([
    ["es", "La Cuenta de prueba es solo de Prueba. En Oficial entrás con Google."],
    ["en", "The test account only works in Test. In Live, sign in with Google."],
  ] as const)("con la Cuenta de prueba explica cómo entrar en Oficial en %s", (lang, texto) => {
    h.tipo = "prueba";
    h.red = "testnet";
    setLang(lang);
    abrirHojaDeModo();
    expect(document.querySelector(".modo-cuenta")?.textContent).toBe(texto);
  });

  it("la hoja no habla de otra cuenta si todavía no hay una abierta", () => {
    abrirHojaDeModo();
    expect(document.querySelector(".modo-cuenta")).toBeNull();
  });

  it("en Oficial no ofrece otra vez la acción del cupón", () => {
    h.red = "mainnet";
    abrirHojaDeModo();
    expect(document.querySelector(".modo-card .modo-cupon")).toBeNull();
  });
});
