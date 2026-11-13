// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El botón Quiero comprobarlo de la verificación era un enlace a `#sec-checks`. El cambio de fragmento recargaba la
 * página (`hashchange`), y la recarga leía `#sec-checks` como comprobante: salía en rojo Algo no cuadra, a todo el que
 * lo tocaba. Ahora el botón lleva a las comprobaciones sin tocar el enlace, y solo un fragmento que es un comprobante
 * vuelve a verificar la página.
 */

const pagina = readFileSync(join(process.cwd(), "verificar.html"), "utf8");

beforeAll(() => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/verificar.html?lang=es");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

async function montar(): Promise<typeof import("./verify")> {
  await import("./i18n");
  return import("./verify");
}

describe("Quiero comprobarlo", () => {
  it("lleva a las comprobaciones sin cambiar el enlace", async () => {
    const vistos: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      vistos.push(this.id);
    };
    await montar();
    const antes = location.href;
    const boton = document.getElementById("btn-comprobar") as HTMLAnchorElement;
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    boton.dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(true);
    expect(location.href).toBe(antes);
    expect(vistos).toContain("sec-checks");
  });
});

describe("un cambio del fragmento con la página abierta", () => {
  it("vuelve a verificar solo si el fragmento nuevo es un comprobante", async () => {
    const { alCambiarElFragmento } = await montar();
    const recargar = vi.fn();
    alCambiarElFragmento("#sec-checks", recargar);
    alCambiarElFragmento("", recargar);
    alCambiarElFragmento("#", recargar);
    expect(recargar).not.toHaveBeenCalled();
    alCambiarElFragmento("#zAbc", recargar);
    alCambiarElFragmento("#rAbc", recargar);
    expect(recargar).toHaveBeenCalledTimes(2);
  });
});
