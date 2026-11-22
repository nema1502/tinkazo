// @vitest-environment jsdom
/**
 * La cuenta regresiva y el resultado a tiempo en la página del celular: qué pantalla sale con la lista sellada, a qué hora
 * mira cada tramo, cuándo se muestra el resultado y cómo se reparten la espera la tarjeta de confirmar y la cuenta.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../idioma";
import { roundAt } from "../protocol/quicknet-hora";
import { despiertaPedida } from "../ui/despierta";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import type { AccionesDeLaCuenta, DepsDelCelular, EstadoPropio } from "./celular";
import { AHORA, CUENTA, OTRA_CUENTA, SESION, asentar, lectura, lecturasDe, pasar as pasarElReloj, prepararCelular, propio } from "./celular-falso";
import { horaDeLaRondaMs, MARGEN_DEL_SHOW_MS, VENTANA_LENTA_HASTA_MS, VENTANA_RAPIDA_MS } from "./empieza-ritmo";
import { horaTexto } from "./formato";
import { campanaDeEjemplo } from "./ejemplo";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";
import { TEXTOS_EMPIEZA } from "./textos-empieza";

// Lo que la página baja con import() llega en unos pocos turnos si ya está cargado.
await import("./empieza");
await import("./confirmar");
await import("../ui/despierta");

const es = TEXTOS_EMPIEZA.es;
/** La sala va cinco segundos adelantada sobre este reloj. */
const DESFASE = 5_000;
/** La ronda de este sorteo, y su hora en la hora de la sala. */
const RONDA = roundAt(AHORA / 1000 + 600) + 1;
const T = horaDeLaRondaMs(RONDA);
/** El instante, en el reloj del celular, en que empieza la ventana rápida. */
const INICIO = T - DESFASE + MARGEN_DEL_SHOW_MS;

const asentarTodo = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  await asentar();
};
const pasar = async (ms: number): Promise<void> => {
  await pasarElReloj(ms);
  await asentarTodo();
};
/** Pone el reloj del celular para que falten `ms` hasta la hora de la ronda en la hora de la sala. */
const faltan = (ms: number): void => void vi.setSystemTime(T - DESFASE - ms);
const hasta = (ms: number): void => void vi.setSystemTime(ms);

const sellada = (cambios: Partial<EstadoPropio> = {}): EstadoPropio => ({ ...propio("sellada"), ronda: RONDA, horaSala: Date.now() + DESFASE, ...cambios });

interface Montaje {
  mundo: Awaited<ReturnType<typeof prepararCelular>>;
  registro: { ms: number; modo?: string }[];
  yo: ReturnType<typeof vi.fn>;
  resultado: ReturnType<typeof vi.fn>;
}

/** La página con la lista sellada y la sala que dice la ronda (o no, según `estado`). El reloj corre con el falso. */
async function montar(o: { estado?: () => EstadoPropio; resultado?: () => unknown; cambios?: Partial<DepsDelCelular> } = {}): Promise<Montaje> {
  const registro: Montaje["registro"] = [];
  const yo = vi.fn(async () => (o.estado ?? sellada)());
  const resultado = vi.fn(async () => (o.resultado ? o.resultado() : null));
  const cada: DepsDelCelular["cada"] = (f, ms, modo) => {
    // Solo las consultas: el reloj de la cuenta regresiva (1 s) y el de la señal de Al día (5 s) no piden nada.
    if (ms !== 1_000 && ms !== 5_000) registro.push({ ms, ...(modo ? { modo } : {}) });
    const reloj = setInterval(f, ms);
    return () => clearInterval(reloj);
  };
  // La ventana rápida va encendida (en el código está apagada) y sin retraso al azar: así cada tramo arranca justo al empezar.
  const mundo = await prepararCelular({ sesion: async () => SESION, yo, resultado: resultado as never, cada, ventanaRapida: true, azar: () => 0, ...o.cambios }, true);
  await asentarTodo();
  return { mundo, registro, yo, resultado };
}

const adentro = (raiz: HTMLElement): HTMLElement => raiz.querySelector<HTMLElement>("#cmp-adentro") as HTMLElement;
const cuentaDe = (raiz: HTMLElement): string => raiz.querySelector("#cmp-adentro .cmp-cuenta-regresiva")?.textContent ?? "";
const lineaDe = (raiz: HTMLElement): string => raiz.querySelector("#cmp-adentro .cmp-apoyo")?.textContent ?? "";
const gano = (raiz: HTMLElement): string => raiz.querySelector("#cmp-estado h1")?.textContent ?? "";
const principalesVisibles = (raiz: HTMLElement): Element[] => [...raiz.querySelectorAll(".primary")].filter((e) => e.closest("[hidden]") === null);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("con una sala que no dice la ronda, la página es la de siempre", () => {
  it("la espera sigue con su señal y su línea de fase, sin cuenta regresiva ni pantalla encendida", async () => {
    const { mundo } = await montar({ estado: () => propio("sellada") });
    expect(adentro(mundo.raiz).querySelector(".cmp-cuenta-regresiva")).toBeNull();
    expect(adentro(mundo.raiz).querySelector(".cmp-al-dia")).not.toBeNull();
    expect(adentro(mundo.raiz).querySelector("#cmp-fase")?.textContent).toContain(TEXTOS_CAMPANA.es.cpSellada);
    expect(despiertaPedida()).toBe(false);
  });

  it("consulta lo propio como siempre y nunca pide el resultado antes de que lo diga", async () => {
    const { registro, resultado, yo } = await montar({ estado: () => propio("sellada") });
    await pasar(5 * 60_000);
    expect(registro.every((r) => r.ms === 15_000 && r.modo === undefined)).toBe(true);
    expect(resultado).not.toHaveBeenCalled();
    expect(yo.mock.calls.length).toBeGreaterThan(10);
  });
});

describe("la pantalla El sorteo está por empezar", () => {
  it("con la lista sellada y la ronda: título, cuenta regresiva y una línea, sin nada para tocar", async () => {
    faltan(40_000);
    const { mundo } = await montar();
    expect(adentro(mundo.raiz).querySelector("h1")?.textContent).toBe(es.ceTitulo);
    expect(cuentaDe(mundo.raiz)).toBe("Empieza en 0:40");
    expect(lineaDe(mundo.raiz)).toBe(es.ceMira);
    expect(adentro(mundo.raiz).querySelector("button")).toBeNull();
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
    expect(adentro(mundo.raiz).querySelector("[role=timer]")).not.toBeNull();
    // La señal de Al día no se muestra junto a la cuenta regresiva.
    expect(adentro(mundo.raiz).querySelector(".cmp-al-dia")).toBeNull();
  });

  it("en inglés dice lo mismo con sus palabras", async () => {
    faltan(40_000);
    const { mundo } = await montar();
    setLang("en");
    mundo.vista.pintar();
    expect(adentro(mundo.raiz).querySelector("h1")?.textContent).toBe(TEXTOS_EMPIEZA.en.ceTitulo);
    expect(cuentaDe(mundo.raiz)).toBe("Starts in 0:40");
    expect(lineaDe(mundo.raiz)).toBe(TEXTOS_EMPIEZA.en.ceMira);
    setLang("es");
  });

  it("el número cambia cada segundo en su mismo elemento", async () => {
    faltan(40_000);
    const { mundo } = await montar();
    const numero = adentro(mundo.raiz).querySelector(".cmp-numero");
    expect(numero?.textContent).toBe("0:40");
    await pasar(1_000);
    expect(adentro(mundo.raiz).querySelector(".cmp-numero")).toBe(numero);
    expect(numero?.textContent).toBe("0:39");
    await pasar(9_000);
    expect(numero?.textContent).toBe("0:30");
  });

  it("con más de diez minutos por delante dice a qué hora es y no muestra números, y al bajar de diez aparece la cuenta", async () => {
    faltan(11 * 60_000);
    const { mundo } = await montar();
    const hora = horaTexto(T, campanaDeEjemplo(AHORA).zona, "es");
    expect(cuentaDe(mundo.raiz)).toBe((TEXTOS_CAMPANA.es.cpSorteoA ?? "").replace("{hora}", hora));
    expect(adentro(mundo.raiz).querySelector(".cmp-numero")).toBeNull();
    await pasar(61_000);
    expect(cuentaDe(mundo.raiz)).toMatch(/^Empieza en 9:\d\d$/u);
  });

  it("en cero no dice que empieza ni muestra números", async () => {
    faltan(2_000);
    const { mundo } = await montar();
    expect(cuentaDe(mundo.raiz)).toBe("Empieza en 0:02");
    await pasar(3_000);
    expect(cuentaDe(mundo.raiz)).toBe("");
    expect(adentro(mundo.raiz).querySelector<HTMLElement>(".cmp-cuenta-regresiva")?.hidden).toBe(true);
    expect(adentro(mundo.raiz).querySelector("h1")?.textContent).toBe(es.ceTitulo);
    expect(lineaDe(mundo.raiz)).toBe(es.ceMira);
  });

  it("sin la hora de la sala no hay números, y la página sigue con la consulta propia", async () => {
    faltan(5_000);
    const { mundo, registro, resultado } = await montar({ estado: () => ({ ...sellada(), horaSala: undefined }) });
    expect(adentro(mundo.raiz).querySelector(".cmp-numero")).toBeNull();
    expect(cuentaDe(mundo.raiz)).toContain(horaTexto(T, campanaDeEjemplo(AHORA).zona, "es"));
    await pasar(5 * 60_000);
    expect(resultado).not.toHaveBeenCalled();
    expect(registro.every((r) => r.ms === 15_000 && r.modo === undefined)).toBe(true);
    expect(lineaDe(mundo.raiz)).toBe(es.ceMira);
  });

  it.each([-180_000, 0, 180_000])("con el reloj del celular corrido %i ms, la cuenta y la ventana son las de la sala", async (corrimiento) => {
    // La hora de la sala es la verdadera, y el celular marca la verdadera más el corrimiento.
    const verdadera = T - 40_000;
    hasta(verdadera + corrimiento);
    const { mundo, resultado } = await montar({ estado: () => sellada({ horaSala: Date.now() - corrimiento }), resultado: () => null });
    expect(cuentaDe(mundo.raiz)).toBe("Empieza en 0:40");
    // La ventana del resultado empieza veinte segundos después de la hora de la ronda en la hora de la sala, no del celular.
    await pasar(59_000);
    expect(resultado).not.toHaveBeenCalled();
    await pasar(10_000);
    expect(resultado).toHaveBeenCalled();
  });
});

describe("la cuenta usada en otro navegador, justo antes del sorteo", () => {
  const apoyoDeOtroLado = (raiz: HTMLElement): string | null => raiz.querySelector("#cmp-adentro .cmp-otro-lado")?.textContent ?? null;

  it("la cuenta regresiva suma el aviso de que quizás haya que recibir el premio en el otro navegador", async () => {
    faltan(40_000);
    const { mundo } = await montar({ cambios: { cuenta: { leer: lecturasDe(lectura("sin-forma")) } } });
    await pasar(100);
    expect(apoyoDeOtroLado(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtroLadoAdentro);
    // La línea de siempre queda, y la pantalla sigue sin nada para tocar.
    expect(lineaDe(mundo.raiz)).toBe(es.ceMira);
    expect(cuentaDe(mundo.raiz)).toMatch(/^Empieza en 0:\d\d$/u);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(0);
    expect(adentro(mundo.raiz).querySelector("button")).toBeNull();
  });

  it("en inglés lo dice en inglés", async () => {
    faltan(40_000);
    let leida = false;
    const leer = vi.fn(async () => {
      leida = true;
      return lectura("sin-forma");
    });
    const { mundo } = await montar({ cambios: { cuenta: { leer } } });
    expect(leida).toBe(true);
    setLang("en");
    mundo.vista.pintar();
    expect(apoyoDeOtroLado(mundo.raiz)).toBe(TEXTOS_CAMPANA.en.cpOtroLadoAdentro);
    setLang("es");
  });

  it("con una cuenta lista, o sin saber cómo está, no se suma nada", async () => {
    faltan(40_000);
    const lista = await montar({ cambios: { cuenta: { leer: lecturasDe(lectura("lista", { protegida: true, correoDeLaSesionConfirmado: true })) } } });
    await pasar(100);
    expect(apoyoDeOtroLado(lista.mundo.raiz)).toBeNull();
    const sin = await montar();
    expect(apoyoDeOtroLado(sin.mundo.raiz)).toBeNull();
  });
});

describe("cuándo consulta la página", () => {
  it("hasta veinte segundos después de la hora, la consulta propia de siempre y nunca el resultado", async () => {
    hasta(INICIO - 50_000);
    const { registro, resultado, yo } = await montar({ resultado: () => ({ ganadoras: [CUENTA], comprobante: null }) });
    const antes = yo.mock.calls.length;
    await pasar(49_000);
    expect(resultado).not.toHaveBeenCalled();
    expect(yo.mock.calls.length).toBeGreaterThan(antes);
    expect(registro.every((r) => r.ms === 15_000 && r.modo === undefined)).toBe(true);
  });

  it("la ventana rápida mira el resultado cada 8 segundos, con azar, y deja la consulta propia", async () => {
    hasta(INICIO - 5_000);
    const { registro, resultado, yo } = await montar();
    await pasar(5_000 + 100);
    expect(registro.at(-1)).toEqual({ ms: 8_000, modo: "azar" });
    // El primer pedido sale al empezar el tramo (sin retraso al azar en esta prueba) y después sigue cada 8 segundos.
    const alEmpezar = resultado.mock.calls.length;
    expect(alEmpezar).toBe(1);
    const propias = yo.mock.calls.length;
    await pasar(40_000);
    expect(resultado.mock.calls.length - alEmpezar).toBeGreaterThanOrEqual(4);
    expect(resultado.mock.calls.length - alEmpezar).toBeLessThanOrEqual(5);
    expect(yo.mock.calls.length).toBe(propias);
  });

  it("el primer pedido de la ventana se reparte al azar entre los celulares: ninguno arranca todos juntos", async () => {
    const primeros: number[] = [];
    for (const azar of [0, 0.25, 0.5, 0.75, 0.999]) {
      hasta(INICIO + 1_000);
      const { resultado } = await montar({ cambios: { azar: () => azar } });
      const llamadas = resultado.mock.calls.length;
      let t = 0;
      while (resultado.mock.calls.length === llamadas && t < 9_000) {
        await pasar(100);
        t += 100;
      }
      primeros.push(t);
      document.body.innerHTML = "";
      vi.clearAllTimers();
    }
    // Cada celular arranca cuando le toca, repartidos de cero a un período (8 segundos), y ninguno pasa de él.
    expect(primeros[0]).toBeLessThanOrEqual(100);
    expect(primeros[2]).toBeGreaterThanOrEqual(3_900);
    expect(primeros[2]).toBeLessThanOrEqual(4_100);
    expect(primeros[4]).toBeGreaterThanOrEqual(7_900);
    expect(primeros[4]).toBeLessThanOrEqual(8_100);
    expect(primeros).toEqual([...primeros].sort((a, b) => a - b));
    expect(new Set(primeros).size).toBe(5);
  });

  it("apagada la ventana rápida (como está en el código), la cuenta regresiva sale igual y la página sigue con la consulta propia", async () => {
    hasta(INICIO + 1_000);
    const { mundo, registro, resultado, yo } = await montar({ cambios: { ventanaRapida: undefined } });
    expect(adentro(mundo.raiz).querySelector(".cmp-cuenta-regresiva")).not.toBeNull();
    const propias = yo.mock.calls.length;
    await pasar(5 * 60_000);
    expect(resultado).not.toHaveBeenCalled();
    expect(yo.mock.calls.length).toBeGreaterThan(propias + 5);
    expect(registro.every((r) => r.ms === 15_000 && r.modo === undefined)).toBe(true);
  });

  it("a los 150 segundos baja a uno cada 15 y a los diez minutos vuelve a la consulta propia", async () => {
    hasta(INICIO - 5_000);
    const { registro, yo } = await montar();
    await pasar(5_000 + VENTANA_RAPIDA_MS + 2);
    expect(registro.at(-1)).toEqual({ ms: 15_000, modo: "azar" });
    await pasar(VENTANA_LENTA_HASTA_MS - VENTANA_RAPIDA_MS);
    expect(registro.at(-1)).toEqual({ ms: 15_000 });
    const antes = yo.mock.calls.length;
    await pasar(15_000);
    expect(yo.mock.calls.length).toBeGreaterThan(antes);
  });

  it("un celular que supo de la lista tarde empieza la ventana cuando lo supo", async () => {
    hasta(INICIO + 30_000);
    const { registro, resultado } = await montar();
    await pasar(1);
    expect(registro.at(-1)).toEqual({ ms: 8_000, modo: "azar" });
    await pasar(8_001);
    expect(resultado).toHaveBeenCalled();
  });

  it("pasados 150 segundos sin resultado, la línea dice que está tardando", async () => {
    hasta(INICIO - 5_000);
    const { mundo } = await montar();
    await pasar(5_000 + VENTANA_RAPIDA_MS - 1_000);
    expect(lineaDe(mundo.raiz)).toBe(es.ceMira);
    await pasar(2_000);
    expect(lineaDe(mundo.raiz)).toBe(es.ceTarda);
  });

  it("con la pestaña escondida no consulta, y al volver mira el resultado", async () => {
    hasta(INICIO + 1_000);
    const { mundo, resultado } = await montar();
    mundo.ponerVisible(false);
    await pasar(60_000);
    expect(resultado).not.toHaveBeenCalled();
    mundo.ponerVisible(true);
    await mundo.volver();
    await asentarTodo();
    expect(resultado).toHaveBeenCalledTimes(1);
  });
});

describe("el resultado, nunca antes que la pantalla grande", () => {
  it("se muestra recién cuando la sala lo trae, sin importar qué hora marque el reloj", async () => {
    hasta(INICIO + 1_000);
    let hayResultado = false;
    const { mundo, resultado } = await montar({ resultado: () => (hayResultado ? { ganadoras: [CUENTA], comprobante: "/verificar.html?demo=1" } : null) });
    await pasar(30_000);
    expect(resultado.mock.calls.length).toBeGreaterThan(2);
    expect(gano(mundo.raiz)).not.toBe(TEXTOS_CAMPANA.es.cpGanaste);
    expect(adentro(mundo.raiz).hidden).toBe(false);
    hayResultado = true;
    await pasar(10_000);
    expect(gano(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpGanaste);
    expect(adentro(mundo.raiz).hidden).toBe(true);
  });

  it("quien no está entre las elegidas ve que salió otra persona", async () => {
    hasta(INICIO + 1_000);
    const { mundo } = await montar({ resultado: () => ({ ganadoras: [OTRA_CUENTA], comprobante: null }) });
    await pasar(10_000);
    expect(gano(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtraPersona);
  });

  it("una falla de red al pedir el resultado no cambia la pantalla y se vuelve a intentar", async () => {
    hasta(INICIO + 1_000);
    let n = 0;
    const { mundo, resultado } = await montar({ resultado: () => (++n < 3 ? "red" : { ganadoras: [CUENTA], comprobante: null }) });
    await pasar(8_001);
    expect(gano(mundo.raiz)).not.toBe(TEXTOS_CAMPANA.es.cpGanaste);
    await pasar(24_000);
    expect(resultado.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(gano(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpGanaste);
  });
});

describe("la pantalla no se apaga", () => {
  it("se pide con la lista sellada y la ronda, se suelta con el resultado", async () => {
    faltan(40_000);
    let hayResultado = false;
    const { mundo } = await montar({ resultado: () => (hayResultado ? { ganadoras: [CUENTA], comprobante: null } : null) });
    expect(despiertaPedida()).toBe(true);
    hayResultado = true;
    await pasar(61_000);
    expect(gano(mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpGanaste);
    expect(despiertaPedida()).toBe(false);
  });

  it("se suelta al desmontar la página", async () => {
    faltan(40_000);
    const { mundo } = await montar();
    expect(despiertaPedida()).toBe(true);
    mundo.vista.desmontar();
    await asentarTodo();
    expect(despiertaPedida()).toBe(false);
  });

  it("antes de sellar no se pide", async () => {
    const { mundo } = await montar({ estado: () => propio("abierta") });
    expect(adentro(mundo.raiz).hidden).toBe(false);
    expect(despiertaPedida()).toBe(false);
  });
});

describe("la tarjeta de confirmar el correo y la cuenta regresiva se reparten la espera", () => {
  const FALTA = lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" });
  const LISTA = lectura("lista", { protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true });
  const acciones = (): AccionesDeLaCuenta => ({
    puedeDesbloqueo: vi.fn(async () => false),
    mandarCodigo: vi.fn(async () => undefined),
    confirmarCodigo: vi.fn(async (): Promise<LecturaDelCelular> => LISTA),
    usarDesbloqueo: vi.fn(async () => true),
    alCambiar: vi.fn(() => () => undefined),
  });
  const cuenta = (raiz: HTMLElement): HTMLElement => raiz.querySelector<HTMLElement>("#cmp-cuenta") as HTMLElement;

  async function conTarjeta(leer: ReturnType<typeof lecturasDe> = lecturasDe(FALTA)): Promise<Montaje & { acciones: AccionesDeLaCuenta }> {
    const a = acciones();
    const m = await montar({ cambios: { cuenta: { leer, confirmar: async () => a } } });
    await pasar(3_000);
    return { ...m, acciones: a };
  }

  it("sin un código en juego manda la cuenta, y Confirmar mi correo es un enlace de texto debajo", async () => {
    faltan(40_000);
    const { mundo } = await conTarjeta();
    expect(adentro(mundo.raiz).querySelector("h1")?.textContent).toBe(es.ceTitulo);
    expect(adentro(mundo.raiz).classList.contains("cmp-regresiva-chica")).toBe(false);
    expect(mundo.raiz.classList.contains("cmp-tarjeta-enlace")).toBe(true);
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(false);
    expect(cuenta(mundo.raiz).hidden).toBe(false);
    expect(cuenta(mundo.raiz).querySelector(".primary")?.textContent).toBe(TEXTOS_CONFIRMAR.es.ccConfirmar);
    // Las reglas del sorteo van al pie, debajo del enlace.
    expect(mundo.raiz.querySelector("#cmp-pie .cmp-reglas")).not.toBeNull();
    expect(adentro(mundo.raiz).querySelector(".cmp-reglas")).toBeNull();
  });

  it("al empezar a confirmar, la cuenta baja a un rótulo chico y la tarjeta es lo principal", async () => {
    faltan(40_000);
    const { mundo, acciones: a } = await conTarjeta();
    cuenta(mundo.raiz).querySelector<HTMLButtonElement>(".primary")?.click();
    await pasar(100);
    expect(a.mandarCodigo).toHaveBeenCalledTimes(1);
    expect(mundo.raiz.classList.contains("cmp-tarjeta-enlace")).toBe(false);
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(true);
    expect(adentro(mundo.raiz).classList.contains("cmp-regresiva-chica")).toBe(true);
    expect(adentro(mundo.raiz).querySelector("h1")).toBeNull();
    expect(cuentaDe(mundo.raiz)).toMatch(/^Empieza en 0:\d\d$/u);
    expect(cuenta(mundo.raiz).querySelector("h2")?.textContent).toBe(TEXTOS_CONFIRMAR.es.ccCodigoT);
    // La cuenta sigue contando aunque sea chica.
    const antes = cuentaDe(mundo.raiz);
    await pasar(3_000);
    expect(cuentaDe(mundo.raiz)).not.toBe(antes);
  });

  it("una sola acción principal a la vista en cada momento", async () => {
    faltan(40_000);
    const { mundo } = await conTarjeta();
    // La tarjeta como enlace es la única acción, y no hay barra de Confirmar.
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
    cuenta(mundo.raiz).querySelector<HTMLButtonElement>(".primary")?.click();
    await pasar(100);
    expect(principalesVisibles(mundo.raiz)).toHaveLength(1);
  });

  it("al llegar el resultado la tarjeta se va", async () => {
    hasta(INICIO + 1_000);
    let hayResultado = false;
    const a = acciones();
    const m = await montar({
      resultado: () => (hayResultado ? { ganadoras: [OTRA_CUENTA], comprobante: null } : null),
      cambios: { cuenta: { leer: lecturasDe(FALTA), confirmar: async () => a } },
    });
    await pasar(3_000);
    expect(cuenta(m.mundo.raiz).hidden).toBe(false);
    hayResultado = true;
    await pasar(10_000);
    expect(gano(m.mundo.raiz)).toBe(TEXTOS_CAMPANA.es.cpOtraPersona);
    expect(cuenta(m.mundo.raiz).hidden).toBe(true);
    expect(m.mundo.raiz.classList.contains("cmp-tarjeta-enlace")).toBe(false);
  });

  it("con un código mandado hace menos de cinco minutos, una recarga abre la tarjeta como principal", async () => {
    faltan(40_000);
    sessionStorage.setItem("tinkazo.cmp.codigo", String(Date.now() - 60_000));
    const { mundo } = await conTarjeta();
    expect(adentro(mundo.raiz).classList.contains("cmp-regresiva-chica")).toBe(true);
    expect(mundo.raiz.classList.contains("cmp-con-tarjeta")).toBe(true);
  });
});

describe("el peso de la página", () => {
  const resolver = (desde: string, especificador: string): string | null => {
    const base = resolve(dirname(desde), especificador);
    for (const candidato of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
    }
    return null;
  };
  /** Todo lo que la página importa sin import(). */
  const delaPagina = (): string[] => {
    const vistos = new Set<string>();
    const pendientes = [resolve("src/participar.ts")];
    while (pendientes.length > 0) {
      const archivo = pendientes.pop() as string;
      if (vistos.has(archivo) || !archivo.endsWith(".ts")) continue;
      vistos.add(archivo);
      const codigo = readFileSync(archivo, "utf8");
      for (const m of codigo.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gmu)) {
        const r = resolver(archivo, m[1] ?? "");
        if (r) pendientes.push(r);
      }
    }
    return [...vistos].map((f) => f.replace(/\\/gu, "/"));
  };

  it("la cuenta regresiva se baja con import() y no está en lo que la página importa de entrada", () => {
    const archivos = delaPagina();
    expect(archivos.filter((f) => /\/campana\/(?:empieza|empieza-ritmo|textos-empieza)\.ts$/u.test(f))).toEqual([]);
    const celular = readFileSync("src/campana/celular.ts", "utf8");
    expect(celular).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']\.\/(?:empieza|empieza-ritmo|textos-empieza)["']/mu);
    expect(celular).toMatch(/import\(["']\.\/empieza["']\)/u);
    // La pantalla encendida la pide la cuenta regresiva, ya bajada: la página no importa nada de eso.
    expect(celular).not.toMatch(/ui\/despierta/u);
    expect(readFileSync("src/campana/empieza.ts", "utf8")).toMatch(/from "\.\.\/ui\/despierta"/u);
  });

  it("la página no trae quicknet.ts: la hora de una ronda sale de quicknet-hora, que no importa nada", () => {
    const archivos = delaPagina();
    expect(archivos.filter((f) => /\/protocol\/quicknet\.ts$/u.test(f))).toEqual([]);
    expect(readFileSync("src/protocol/quicknet-hora.ts", "utf8")).not.toMatch(/^import\s/mu);
    expect(readFileSync("src/campana/empieza-ritmo.ts", "utf8")).toMatch(/from "\.\.\/protocol\/quicknet-hora"/u);
    expect(readFileSync("src/campana/empieza-ritmo.ts", "utf8")).not.toMatch(/protocol\/quicknet"/u);
  });
});

describe("con 300 celulares a la vez", () => {
  it("el peor minuto de la ventana rápida no pasa de 2.550 consultas", () => {
    // Cada celular elige su ritmo una vez (8 segundos con 20 % de azar) y su fase, como la página de verdad.
    let semilla = 20_261_127;
    const azar = (): number => {
      semilla = (Math.imul(semilla, 1_664_525) + 1_013_904_223) >>> 0;
      return semilla / 2 ** 32;
    };
    const CELULARES = 300;
    const minutos = new Array<number>(Math.ceil(VENTANA_RAPIDA_MS / 60_000) + 1).fill(0);
    for (let i = 0; i < CELULARES; i += 1) {
      const cada = Math.round(8_000 * (0.8 + azar() * 0.4));
      for (let t = azar() * cada; t < VENTANA_RAPIDA_MS; t += cada) {
        const minuto = Math.floor(t / 60_000);
        minutos[minuto] = (minutos[minuto] ?? 0) + 1;
      }
    }
    // El primer minuto entero de la ventana es el peor caso posible.
    expect(Math.max(...minutos.slice(0, 2))).toBeLessThanOrEqual(2_550);
    expect(minutos[0]).toBeGreaterThan(2_000);
  });
});
