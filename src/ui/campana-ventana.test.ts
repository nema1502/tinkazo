// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import { CLAVE_VENTANA, esVentanaDeGoogle, marcarVentana } from "../campana/invitada";
import { atenderVentanaDeGoogle, esLaVentanaDeGoogleDeUnaCampana, LA_VENTANA_DE_GOOGLE_NO_RETOMA, pintarCapa } from "./campana-ventana";

/**
 * La pestaña que deja la ventana de Google (`atenderVentanaDeGoogle`): con la marca de la ventana vigente dice que
 * vuelvan al sorteo y se cierra. Nunca en la pestaña de quien vino a recibir un premio.
 */

const T0 = 1_800_000_000_000;
const MINUTO = 60_000;

function almacen(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

function deps(sesion: Storage | null, o: { pideElPremio?: boolean; ahora?: number } = {}) {
  return {
    sesion,
    ahora: o.ahora ?? T0,
    pideElPremio: o.pideElPremio ?? false,
    pintar: vi.fn(),
    cerrar: vi.fn(),
    callar: vi.fn(),
    tx: (clave: string) => clave,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("la pestaña que deja la ventana de Google", () => {
  it("con la marca vigente y sin premio: pinta la capa, se cierra, calla el paso, borra la marca y devuelve verdadero", () => {
    const a = almacen();
    marcarVentana(a, T0);
    const d = deps(a);
    expect(atenderVentanaDeGoogle(d)).toBe(true);
    expect(d.pintar).toHaveBeenCalledWith("clVentanaLista");
    expect(d.cerrar).toHaveBeenCalledTimes(1);
    expect(d.callar).toHaveBeenCalledTimes(1);
    expect(a.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("con el premio en la dirección: no pinta, no cierra, devuelve falso y la marca queda borrada", () => {
    const a = almacen();
    marcarVentana(a, T0);
    const d = deps(a, { pideElPremio: true });
    expect(atenderVentanaDeGoogle(d)).toBe(false);
    expect(d.pintar).not.toHaveBeenCalled();
    expect(d.cerrar).not.toHaveBeenCalled();
    expect(d.callar).not.toHaveBeenCalled();
    expect(esVentanaDeGoogle(a, T0)).toBe(false);
  });

  it("sin marca, con la marca vencida o sin almacenamiento: no hace nada", () => {
    const vencida = almacen();
    marcarVentana(vencida, T0);
    for (const d of [deps(almacen()), deps(vencida, { ahora: T0 + 10 * MINUTO + 1 }), deps(null)]) {
      expect(atenderVentanaDeGoogle(d)).toBe(false);
      expect(d.pintar).not.toHaveBeenCalled();
      expect(d.cerrar).not.toHaveBeenCalled();
      expect(d.callar).not.toHaveBeenCalled();
    }
  });

  it("la capa es una sola, con role status y el texto tal cual en español", () => {
    setLang("es");
    pintarCapa(t("clVentanaLista"));
    const capas = document.querySelectorAll('.campana-ventana[role="status"]');
    expect(capas.length).toBe(1);
    expect(capas[0]?.textContent).toBe("Listo. Volvé a la pestaña del sorteo.");
  });

  it("en inglés dice lo mismo, en inglés", () => {
    setLang("en");
    pintarCapa(t("clVentanaLista"));
    expect(document.querySelector(".campana-ventana")?.textContent).toBe("Done. Go back to the draw tab.");
    setLang("es");
  });
});

describe("reconocer la ventana de Google sin tocar nada", () => {
  it("con la marca vigente y sin premio es la ventana de Google, y no suelta la marca ni pinta nada", () => {
    const a = almacen();
    marcarVentana(a, T0);
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(a))).toBe(true);
    expect(esVentanaDeGoogle(a, T0)).toBe(true);
    expect(document.querySelector(".campana-ventana")).toBeNull();
  });

  it("viene encendido, y con el interruptor apagado la herramienta arranca como siempre aunque la marca esté vigente", () => {
    expect(LA_VENTANA_DE_GOOGLE_NO_RETOMA).toBe(true);
    const a = almacen();
    marcarVentana(a, T0);
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(a), true)).toBe(true);
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(a), false)).toBe(false);
  });

  it("sin marca, con la marca vencida, sin almacenamiento o con premio, no lo es", () => {
    const a = almacen();
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(a))).toBe(false);
    marcarVentana(a, T0);
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(a, { ahora: T0 + 11 * MINUTO }))).toBe(false);
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(null))).toBe(false);
    expect(esLaVentanaDeGoogleDeUnaCampana(deps(a, { pideElPremio: true }))).toBe(false);
  });
});
