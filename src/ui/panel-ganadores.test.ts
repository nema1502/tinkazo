// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_ETIQUETAS, ponerEtiquetas } from "../equipos/etiquetas";
import { setLang } from "../i18n";
import { txUrl } from "../stellar/config";
import type { LecturaDePago } from "../stellar/pagos";
import { PLAZO_DE_PAGO_S } from "../stellar/pagos";
import type { BusquedaDePago, LectorDePagos } from "../stellar/pagos-red";
import { FILAS_A_LA_VISTA, etiquetaGuardada, hayCuentas, montarGanadores, type OpcionesDeGanadores } from "./panel-ganadores";

const ORG = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const EMISOR = "GCQPYIVQSYUCGFCGTZ7KTLEZ62PML72P6XND4V2YQLRFK22QQJRPFIAE";
const [A, B, C] = [Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey()] as [string, string, string];
const HASH = "ab".repeat(32);
const SORTEO = 1_793_000_000;
const corta = (g: string): string => `${g.slice(0, 4)}…${g.slice(-4)}`;

const PAGADO: LecturaDePago = { tipo: "pagado", hash: HASH, monto: "50.0000000", cuando: SORTEO + 3600, de: ORG };

/** Un lector que contesta lo que diga `porCuenta` y anota cada pedido. */
function lectorFalso(porCuenta: Record<string, LecturaDePago>): { lector: LectorDePagos; pedidos: Array<{ b: BusquedaDePago; forzar: boolean }> } {
  const pedidos: Array<{ b: BusquedaDePago; forzar: boolean }> = [];
  const lector: LectorDePagos = async (b, forzar = false) => {
    pedidos.push({ b, forzar });
    return porCuenta[b.destino] ?? { tipo: "no-hay" };
  };
  return { lector, pedidos };
}

function montar(over: Partial<OpcionesDeGanadores> & { entradas?: string[] } = {}): { raiz: HTMLElement; panel: ReturnType<typeof montarGanadores> } {
  const raiz = document.createElement("section");
  document.body.append(raiz);
  const { entradas = [A, B, C, "Ana Mamani"], ...resto } = over;
  const panel = montarGanadores(raiz, {
    red: "testnet",
    raffleId: "777",
    premio: "50 USDC",
    activo: { code: "TKUSD", issuer: EMISOR },
    ganadores: entradas.map((entrada, puesto) => ({ puesto, entrada })),
    sorteoEn: SORTEO,
    desde: SORTEO - 600,
    pagadoras: new Set([ORG]),
    lector: lectorFalso({}).lector,
    ahora: () => SORTEO + 3600,
    etiquetaDe: () => undefined,
    ...resto,
  });
  return { raiz, panel };
}

const filas = (raiz: HTMLElement): HTMLElement[] => [...raiz.querySelectorAll<HTMLElement>(".gan-fila")];
const visibles = (raiz: HTMLElement): HTMLElement[] => filas(raiz).filter((f) => !f.hidden);
const estado = (fila: HTMLElement): string => fila.querySelector(".gan-est")?.textContent ?? "";
const esperar = async (raiz: HTMLElement): Promise<void> => {
  await vi.waitFor(() => expect(raiz.textContent).not.toContain("Consultando"));
};

beforeEach(() => {
  document.body.replaceChildren();
  setLang("es");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("el panel de ganadores", () => {
  it("una fila por ganador, con su puesto, su nombre o su cuenta acortada y el estado de su pago", async () => {
    const { raiz } = montar({ lector: lectorFalso({ [A]: PAGADO, [B]: { tipo: "no-hay" }, [C]: { tipo: "sin-consulta" } }).lector });
    expect(filas(raiz)).toHaveLength(4);
    await esperar(raiz);
    const [a, b, c, d] = filas(raiz) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(a.textContent).toContain("#1");
    expect(a.querySelector(".gan-nombre")?.textContent).toBe(corta(A));
    expect(estado(a)).toBe("Pagado");
    expect(estado(b)).toBe("Pendiente");
    expect(estado(c)).toBe("Sin consulta");
    // Una entrada que no es una cuenta la entrega quien organiza, y se muestra tal cual.
    expect(d.querySelector(".gan-nombre")?.textContent).toBe("Ana Mamani");
    expect(estado(d)).toBe("Lo entrega quien organiza");
  });

  it("el título, el premio y cuántos van pagados", async () => {
    const { raiz } = montar({ lector: lectorFalso({ [A]: PAGADO }).lector });
    await esperar(raiz);
    expect(raiz.querySelector(".gan-titulo")?.textContent).toBe("Ganadores y premios");
    expect(raiz.querySelector(".gan-premio")?.textContent).toBe("Premio: 50 USDC");
    expect(raiz.querySelector(".gan-resumen")?.textContent).toBe("Pagados: 1 de 3");
  });

  it("sin título cuando la página ya lo trae, y sin premio si no se sorteó uno", () => {
    const { raiz } = montar({ sinTitulo: true, premio: "" });
    expect((raiz.querySelector(".gan-titulo") as HTMLElement).hidden).toBe(true);
    expect((raiz.querySelector(".gan-premio") as HTMLElement).hidden).toBe(true);
  });

  it("Pagado dice cuánto y cuándo, y enlaza al pago en el explorador de la red", async () => {
    const { raiz } = montar({ lector: lectorFalso({ [A]: PAGADO }).lector });
    await esperar(raiz);
    const det = filas(raiz)[0]?.querySelector(".gan-det") as HTMLElement;
    expect(det.textContent).toContain("50 TKUSD");
    expect(det.textContent).toContain("2026");
    const enlace = det.querySelector("a") as HTMLAnchorElement;
    expect(enlace.href).toBe(txUrl(HASH, "testnet"));
    expect(enlace.target).toBe("_blank");
    expect(enlace.rel).toContain("noopener");
  });

  it("Pendiente dice hasta cuándo hay plazo; Vencido, que pasó y no se pagó", async () => {
    const pendiente = montar({ lector: lectorFalso({}).lector, ahora: () => SORTEO + 3600 });
    await esperar(pendiente.raiz);
    expect(estado(filas(pendiente.raiz)[0] as HTMLElement)).toBe("Pendiente");
    expect(filas(pendiente.raiz)[0]?.querySelector(".gan-det")?.textContent).toMatch(/^Plazo hasta el .*2026/);

    const vencido = montar({ lector: lectorFalso({}).lector, ahora: () => SORTEO + PLAZO_DE_PAGO_S + 1 });
    await esperar(vencido.raiz);
    expect(estado(filas(vencido.raiz)[0] as HTMLElement)).toBe("Vencido");
    expect(filas(vencido.raiz)[0]?.querySelector(".gan-det")?.textContent).toContain("todavía no se pagó");
  });

  it("con la red caída nunca dice Vencido, pase el tiempo que pase", async () => {
    const caida: LectorDePagos = async () => ({ tipo: "sin-consulta" });
    const { raiz } = montar({ lector: caida, ahora: () => SORTEO + PLAZO_DE_PAGO_S * 10 });
    await esperar(raiz);
    expect(estado(filas(raiz)[0] as HTMLElement)).toBe("Sin consulta");
    expect(raiz.textContent).not.toContain("Vencido");
    expect(filas(raiz)[0]?.querySelector(".gan-det")?.textContent).toContain("Actualizar");
  });

  it("mientras mira la red, lo dice", () => {
    const sinRespuesta: LectorDePagos = () => new Promise(() => undefined);
    const { raiz } = montar({ lector: sinRespuesta });
    expect(estado(filas(raiz)[0] as HTMLElement)).toBe("Consultando…");
  });

  it("pregunta a la red una vez por cada cuenta, con la nota del puesto y las cuentas que pagan", async () => {
    const { lector, pedidos } = lectorFalso({});
    const { raiz } = montar({ lector, pagadoras: new Set([ORG, B]) });
    await esperar(raiz);
    expect(pedidos).toHaveLength(3);
    expect(pedidos.every((p) => !p.forzar)).toBe(true);
    expect(pedidos.map((p) => p.b.destino)).toEqual([A, B, C]);
    expect(pedidos.map((p) => p.b.nota)).toEqual(["tk:premio:777:0", "tk:premio:777:1", "tk:premio:777:2"]);
    expect(pedidos[0]?.b).toMatchObject({ red: "testnet", activo: { code: "TKUSD", issuer: EMISOR }, pagadoras: [ORG, B], desde: SORTEO - 600 });
  });

  it("no hay más de cuatro preguntas a la red a la vez", async () => {
    let enCurso = 0;
    let maximo = 0;
    const lector: LectorDePagos = async () => {
      enCurso++;
      maximo = Math.max(maximo, enCurso);
      await new Promise((r) => setTimeout(r, 5));
      enCurso--;
      return { tipo: "no-hay" };
    };
    const cuentas = Array.from({ length: 12 }, () => Keypair.random().publicKey());
    const { raiz } = montar({ lector, entradas: cuentas });
    await esperar(raiz);
    expect(maximo).toBe(4);
  });

  it("lo que viene de la lista se muestra como texto, nunca como marcado", async () => {
    const { raiz } = montar({ entradas: ['<img src=x onerror="alert(1)">', A] });
    await esperar(raiz);
    expect(raiz.querySelector("img")).toBeNull();
    expect(filas(raiz)[0]?.querySelector(".gan-nombre")?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it("con una etiqueta local, la muestra con la cuenta al lado", async () => {
    const { raiz } = montar({ etiquetaDe: (c) => (c === A ? "Equipo Cohete" : undefined) });
    await esperar(raiz);
    const f = filas(raiz)[0] as HTMLElement;
    expect(f.querySelector(".gan-nombre")?.textContent).toBe("Equipo Cohete");
    expect(f.querySelector(".gan-cuenta")?.textContent).toBe(corta(A));
    expect(f.querySelector(".gan-quien")?.getAttribute("title")).toBe(A);
  });
});

describe("el buscador y 'Ver los N'", () => {
  const cuentas = Array.from({ length: FILAS_A_LA_VISTA + 2 }, () => Keypair.random().publicKey());
  const etiquetas = (c: string): string => `Equipo ${cuentas.indexOf(c) + 1}`;

  it("hasta diez ganadores no hay buscador ni 'Ver los N'", () => {
    const { raiz } = montar({ entradas: cuentas.slice(0, 10) });
    expect((raiz.querySelector(".gan-buscar") as HTMLElement).hidden).toBe(true);
    expect((raiz.querySelector(".gan-vertodos") as HTMLElement).hidden).toBe(true);
    expect(visibles(raiz)).toHaveLength(10);
  });

  it("con más de diez, el buscador por nombre y diez filas a la vista", () => {
    const { raiz } = montar({ entradas: cuentas, etiquetaDe: etiquetas });
    const buscador = raiz.querySelector(".gan-buscar") as HTMLInputElement;
    expect(buscador.hidden).toBe(false);
    expect(buscador.placeholder).toBe("Buscá por nombre");
    expect(buscador.getAttribute("aria-label")).toBe("Buscá por nombre");
    expect(visibles(raiz)).toHaveLength(10);
    const ver = raiz.querySelector(".gan-vertodos") as HTMLButtonElement;
    expect(ver.hidden).toBe(false);
    expect(ver.textContent).toBe("Ver los 12 ganadores");
  });

  it("'Ver los 12 ganadores' muestra todos, y 'Ver menos' los vuelve a diez", () => {
    const { raiz } = montar({ entradas: cuentas, etiquetaDe: etiquetas });
    const ver = raiz.querySelector(".gan-vertodos") as HTMLButtonElement;
    ver.click();
    expect(visibles(raiz)).toHaveLength(12);
    expect(ver.textContent).toBe("Ver menos");
    ver.click();
    expect(visibles(raiz)).toHaveLength(10);
  });

  it("buscar por nombre trae las que coinciden, también las que no estaban a la vista, sin tildes ni mayúsculas", () => {
    const { raiz } = montar({ entradas: cuentas, etiquetaDe: etiquetas });
    const buscador = raiz.querySelector(".gan-buscar") as HTMLInputElement;
    buscador.value = "EQUIPO 12";
    buscador.dispatchEvent(new Event("input"));
    expect(visibles(raiz).map((f) => f.dataset.puesto)).toEqual(["11"]);
    expect((raiz.querySelector(".gan-vertodos") as HTMLElement).hidden).toBe(true);
    // Por la cuenta también.
    buscador.value = (cuentas[3] as string).slice(-6).toLowerCase();
    buscador.dispatchEvent(new Event("input"));
    expect(visibles(raiz).map((f) => f.dataset.puesto)).toEqual(["3"]);
  });

  it("si nadie coincide lo dice, y al borrar vuelve todo", () => {
    const { raiz } = montar({ entradas: cuentas, etiquetaDe: etiquetas });
    const buscador = raiz.querySelector(".gan-buscar") as HTMLInputElement;
    buscador.value = "zzzz";
    buscador.dispatchEvent(new Event("input"));
    expect(visibles(raiz)).toHaveLength(0);
    const nadie = raiz.querySelector(".gan-nadie") as HTMLElement;
    expect(nadie.hidden).toBe(false);
    expect(nadie.textContent).toBe("Nadie con ese nombre entre los ganadores.");
    buscador.value = "";
    buscador.dispatchEvent(new Event("input"));
    expect(visibles(raiz)).toHaveLength(10);
    expect(nadie.hidden).toBe(true);
  });
});

describe("Actualizar", () => {
  it("vuelve a preguntar por todas las cuentas, forzando, y el botón se apaga mientras tanto", async () => {
    const { lector, pedidos } = lectorFalso({});
    const { raiz, panel } = montar({ lector });
    await esperar(raiz);
    const boton = raiz.querySelector(".gan-actualizar") as HTMLButtonElement;
    expect(boton.textContent).toBe("Actualizar");
    pedidos.length = 0;
    boton.click();
    expect(boton.disabled).toBe(true);
    expect(boton.textContent).toBe("Actualizando…");
    await vi.waitFor(() => expect(boton.disabled).toBe(false));
    expect(boton.textContent).toBe("Actualizar");
    expect(pedidos).toHaveLength(3);
    expect(pedidos.every((p) => p.forzar)).toBe(true);
    await panel.actualizar();
  });

  it("si el pago apareció, el estado cambia a Pagado", async () => {
    let pagado = false;
    const lector: LectorDePagos = async (b) => (pagado && b.destino === B ? PAGADO : { tipo: "no-hay" });
    const { raiz } = montar({ lector });
    await esperar(raiz);
    expect(estado(filas(raiz)[1] as HTMLElement)).toBe("Pendiente");
    pagado = true;
    (raiz.querySelector(".gan-actualizar") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(estado(filas(raiz)[1] as HTMLElement)).toBe("Pagado"));
    expect(raiz.querySelector(".gan-resumen")?.textContent).toBe("Pagados: 1 de 3");
  });

  it("una lista de solo nombres no tiene qué actualizar", () => {
    const { raiz } = montar({ entradas: ["Ana", "Luis"] });
    expect((raiz.querySelector(".gan-actualizar") as HTMLElement).hidden).toBe(true);
    expect(raiz.querySelector(".gan-nota")?.textContent).toBe("");
  });
});

describe("'Pagar premio' para quien organiza", () => {
  it("sin la función de pagar, el panel es de solo lectura", async () => {
    const { raiz } = montar();
    await esperar(raiz);
    expect(raiz.querySelector(".gan-pagar")).toBeNull();
  });

  it("cada cuenta que todavía no cobró tiene su botón; la ya pagada y el que no es cuenta, no", async () => {
    const { raiz } = montar({ lector: lectorFalso({ [A]: PAGADO }).lector, pagar: () => undefined });
    await esperar(raiz);
    const botones = filas(raiz).map((f) => f.querySelector<HTMLButtonElement>(".gan-pagar"));
    expect(botones[0]?.hidden).toBe(true);
    expect(botones[1]?.hidden).toBe(false);
    expect(botones[1]?.textContent).toBe("Pagar premio");
    expect(botones[2]?.hidden).toBe(false);
    expect(botones[3]).toBeNull();
  });

  it("mientras mira la red, todavía no se ofrece pagar", () => {
    const { raiz } = montar({ lector: () => new Promise(() => undefined), pagar: () => undefined });
    expect(filas(raiz)[0]?.querySelector<HTMLButtonElement>(".gan-pagar")?.hidden).toBe(true);
  });

  it("al tocarlo, abre el pago de esa fila con su nota, y avisa cuando termina para volver a mirar la red", async () => {
    const pedidos: string[] = [];
    const lector: LectorDePagos = async (b, forzar) => {
      pedidos.push(`${b.nota}${forzar ? "!" : ""}`);
      return { tipo: "no-hay" };
    };
    let terminar: () => void = () => undefined;
    const llamadas: Array<{ puesto: number; cuenta: string; nombre: string; nota: string; caja: HTMLElement }> = [];
    const { raiz } = montar({
      lector,
      etiquetaDe: (c) => (c === B ? "Equipo Cohete" : undefined),
      pagar: (fila, caja, alTerminar) => {
        llamadas.push({ ...fila, caja });
        terminar = alTerminar;
      },
    });
    await esperar(raiz);
    pedidos.length = 0;
    filas(raiz)[1]?.querySelector<HTMLButtonElement>(".gan-pagar")?.click();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ puesto: 1, cuenta: B, nombre: "Equipo Cohete", nota: "tk:premio:777:1" });
    expect(llamadas[0]?.caja).toBe(filas(raiz)[1]?.querySelector(".gan-pago"));

    vi.useFakeTimers();
    terminar();
    expect(pedidos).toEqual([]);
    await vi.advanceTimersByTimeAsync(2600);
    expect(pedidos).toEqual(["tk:premio:777:1!"]);
  });
});

describe("el idioma y los datos de afuera", () => {
  it("al cambiar a inglés, todo el panel cambia", async () => {
    const { raiz } = montar({ lector: lectorFalso({ [A]: PAGADO }).lector, pagar: () => undefined });
    await esperar(raiz);
    setLang("en");
    expect(raiz.querySelector(".gan-titulo")?.textContent).toBe("Winners and prizes");
    expect(raiz.querySelector(".gan-premio")?.textContent).toBe("Prize: 50 USDC");
    expect(raiz.querySelector(".gan-resumen")?.textContent).toBe("Paid: 1 of 3");
    expect(estado(filas(raiz)[0] as HTMLElement)).toBe("Paid");
    expect(estado(filas(raiz)[1] as HTMLElement)).toBe("Pending");
    expect(estado(filas(raiz)[3] as HTMLElement)).toBe("Handed over by the organizer");
    expect(raiz.querySelector(".gan-actualizar")?.textContent).toBe("Refresh");
    expect(filas(raiz)[1]?.querySelector(".gan-pagar")?.textContent).toBe("Pay prize");
    setLang("es");
    expect(estado(filas(raiz)[0] as HTMLElement)).toBe("Pagado");
  });

  it("hayCuentas dice si hay algo que pagar", () => {
    expect(hayCuentas(["Ana", "Luis"])).toBe(false);
    expect(hayCuentas(["Ana", A])).toBe(true);
    expect(hayCuentas([])).toBe(false);
    expect(hayCuentas(["G" + "A".repeat(55)])).toBe(false);
  });

  it("la etiqueta es la que escribe el registro de equipos (misma clave) y nunca rompe", () => {
    ponerEtiquetas(new Map());
    sessionStorage.removeItem(CLAVE_ETIQUETAS);
    expect(etiquetaGuardada(A)).toBeUndefined();
    // Lo que dejó el registro en la pestaña: la clave y la forma son las de `equipos/etiquetas.ts`.
    sessionStorage.setItem(CLAVE_ETIQUETAS, JSON.stringify([[A, "  Equipo Cohete  "], [B, 7]]));
    expect(etiquetaGuardada(A)).toBe("Equipo Cohete");
    expect(etiquetaGuardada(B)).toBeUndefined();
    expect(etiquetaGuardada(C)).toBeUndefined();
    sessionStorage.setItem(CLAVE_ETIQUETAS, "no es json");
    expect(etiquetaGuardada(A)).toBeUndefined();
    // Lo que el registro puso en memoria en esta página también vale, sin pasar por el almacenamiento.
    ponerEtiquetas(new Map([[C, "Los Cóndores"]]));
    expect(etiquetaGuardada(C)).toBe("Los Cóndores");
    expect(sessionStorage.getItem(CLAVE_ETIQUETAS)).toContain("Los Cóndores");
    ponerEtiquetas(new Map());
    sessionStorage.removeItem(CLAVE_ETIQUETAS);
  });
});
