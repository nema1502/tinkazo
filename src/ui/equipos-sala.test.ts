// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de equipos de quien organiza, con un DOM de mentira y la red simulada: abrir el registro, aceptar, mirar
 * quién ya sorteó, dar cupones (solo a quien le toca), qué se ve si la cuenta del evento es la de Google y la lista
 * que sale de los cupones.
 */

const h = vi.hoisted(() => ({ app: { frozen: null as unknown } }));
vi.mock("../state", () => ({ app: h.app }));
vi.mock("./participants", () => ({ setList: () => undefined }));
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { t } from "../i18n";
import { cifrarEquipo, descifrarEquipo } from "../equipos/datos";
import { type Pago } from "../equipos/horizon";
import { CUPON_MONTO, EVENTO_POR_DEFECTO, memoCupon } from "../equipos/modelo";
import type { Aprobacion } from "../equipos/envio";
import { type DepsDelPanel, crearPanelDeEquipos, initEquiposSala } from "./equipos-sala";
import type { Escucha, EquipoDeSala, Sala } from "../sala/cliente";


const cuenta = (): string => Keypair.random().publicKey();
const EVENTO = cuenta();
const SALA: Sala = { id: "AbCd1234", token: "T".repeat(22), clave: "A".repeat(22), vence: Date.now() + 3_600_000, servicio: "https://s.test" };

const almacenFalso = (): Storage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
};

function pago(id: number, a: string, de = EVENTO): Pago {
  return { orden: BigInt(id), hash: `hash${id}`, creado: "", de, a, monto: CUPON_MONTO, nativo: true, memo: memoCupon(EVENTO_POR_DEFECTO) };
}

interface Mundo {
  deps: DepsDelPanel;
  escucha: () => Escucha;
  pagos: Pago[];
  /** Las cuentas que "ya sortearon" en el contrato. */
  sortearon: Set<string>;
  activas: Map<string, boolean>;
  estados: Array<[number, string]>;
  armadas: string[][];
  aprobacion: { r: Aprobacion };
  lista: string[];
  etiquetas: Map<string, string>[];
  sellada: { si: boolean };
  quitados: number[];
}

function mundo(): Mundo {
  let escucha: Escucha | null = null;
  const m: Mundo = {
    deps: undefined as never,
    escucha: () => escucha as Escucha,
    pagos: [],
    sortearon: new Set(),
    activas: new Map(),
    estados: [],
    armadas: [],
    aprobacion: { r: { tipo: "enviado", hash: "TXHASH" } },
    lista: [],
    etiquetas: [],
    sellada: { si: false },
    quitados: [],
  };
  m.deps = {
    tx: t,
    cuentaDeLaSesion: () => null,
    crearSala: async () => SALA,
    cerrarSala: async () => true,
    configurar: async () => true,
    escuchar: ((_s: Sala, e: Escucha) => {
      escucha = e;
      return { parar: () => undefined, consultar: async () => undefined };
    }) as never,
    cambiarEstado: (async (_s: Sala, n: number, estado: string) => {
      m.estados.push([n, estado]);
      return true;
    }) as never,
    quitar: (async (_s: Sala, n: number) => {
      m.quitados.push(n);
      return true;
    }) as never,
    descifrar: descifrarEquipo,
    pagos: async () => [...m.pagos],
    sorteos: async (cs) => ({
      porCuenta: new Map(cs.filter((c) => m.sortearon.has(c)).map((c) => [c, { id: "1", contrato: "C", sellado: 1, prize: "" }])),
      truncado: false,
    }),
    activas: async (cs) => new Map(cs.map((c) => [c, m.activas.get(c) ?? true])),
    leerCuenta: async () => ({ existe: true, secuencia: "10", xlm: 5 }),
    armar: async (p) => {
      m.armadas.push([...p.destinos]);
      return { xdr: "XDR-DE-PRUEBA", destinos: [...p.destinos], memo: memoCupon(p.evento) };
    },
    aprobar: async () => m.aprobacion.r,
    ponerLista: (texto) => {
      if (m.sellada.si) return false;
      m.lista = texto.split("\n");
      return true;
    },
    ponerEtiquetas: (e) => void m.etiquetas.push(new Map(e)),
    qr: async () => undefined,
    precargarQr: async () => undefined,
    cada: () => () => undefined,
    esperar: async () => undefined,
    almacen: almacenFalso(),
    origen: () => "https://tinkazo.app",
    passphrase: "Test SDF Network ; September 2015",
    verCuenta: (c) => `https://explorador/cuenta/${c}`,
    verTransaccion: (x) => `https://explorador/tx/${x}`,
    portapapeles: async () => true,
  };
  return m;
}

async function equipoLlega(m: Mundo, n: number, cuentaDelEquipo: string, nombre: string, estado = "solicitud", v = n): Promise<void> {
  const d = await cifrarEquipo(SALA.clave, { nombre, integrantes: ["Ana", "Beto"] });
  m.escucha().alEquipo?.({ n, cuenta: cuentaDelEquipo, d, estado, v } satisfies EquipoDeSala);
}

const $q = <T extends HTMLElement>(p: ReturnType<typeof crearPanelDeEquipos>, sel: string): T => p.raiz.querySelector<T>(sel) as T;
const filas = (p: ReturnType<typeof crearPanelDeEquipos>): HTMLElement[] => [...p.raiz.querySelectorAll<HTMLElement>("#eq-equipos > li")];
const espera = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function abrirRegistro(m: Mundo, modo: "sorteo" | "cupon"): Promise<ReturnType<typeof crearPanelDeEquipos>> {
  const p = crearPanelDeEquipos(m.deps);
  document.body.append(p.raiz);
  p.raiz.hidden = false;
  $q<HTMLInputElement>(p, "#eq-cuenta").value = EVENTO;
  $q<HTMLInputElement>(p, `input[name="eq-modo"][value="${modo}"]`).checked = true;
  $q<HTMLButtonElement>(p, "#eq-abrir").click();
  await vi.waitFor(() => expect($q(p, "#eq-sala").hidden).toBe(false));
  return p;
}

beforeEach(() => {
  document.body.innerHTML = "";
  h.app.frozen = null;
});

describe("abrir el registro de equipos", () => {
  it("pide una cuenta y un evento que sirvan antes de abrir nada", async () => {
    const m = mundo();
    const crear = vi.spyOn(m.deps, "crearSala");
    const p = crearPanelDeEquipos(m.deps);
    document.body.append(p.raiz);
    $q<HTMLInputElement>(p, "#eq-cuenta").value = "GMALA";
    $q<HTMLButtonElement>(p, "#eq-abrir").click();
    expect($q(p, "#eq-error").textContent).toBe(t("eqErrCuenta"));
    $q<HTMLInputElement>(p, "#eq-cuenta").value = EVENTO;
    $q<HTMLInputElement>(p, "#eq-evento").value = "Space Apps";
    $q<HTMLButtonElement>(p, "#eq-abrir").click();
    expect($q(p, "#eq-error").textContent).toBe(t("eqErrEvento"));
    expect(crear).not.toHaveBeenCalled();
  });

  it("propone el evento de Space Apps y, por defecto, el modo con sorteo propio", () => {
    const p = crearPanelDeEquipos(mundo().deps);
    expect($q<HTMLInputElement>(p, "#eq-evento").value).toBe(EVENTO_POR_DEFECTO);
    expect($q<HTMLInputElement>(p, 'input[name="eq-modo"][value="sorteo"]').checked).toBe(true);
  });

  it("abre la sala, la configura con el modo y la cuenta del evento, y muestra el QR", async () => {
    const m = mundo();
    const configurar = vi.spyOn(m.deps, "configurar");
    const p = await abrirRegistro(m, "sorteo");
    expect(configurar).toHaveBeenCalledWith(SALA, { modo: "sorteo", evento: EVENTO_POR_DEFECTO, cuenta: EVENTO });
    expect($q(p, "#eq-config").hidden).toBe(true);
    expect($q(p, "#eq-cuenta-n").textContent).toBe(t("eqVacia"));
    expect(JSON.parse(m.deps.almacen.getItem("tinkazo.equipos.sala") ?? "{}").config.modo).toBe("sorteo");
  });

  it("si la sala no guarda la configuración, se cierra y se dice", async () => {
    const m = mundo();
    m.deps.configurar = async () => false;
    const cerrar = vi.spyOn(m.deps, "cerrarSala");
    const p = crearPanelDeEquipos(m.deps);
    $q<HTMLInputElement>(p, "#eq-cuenta").value = EVENTO;
    $q<HTMLButtonElement>(p, "#eq-abrir").click();
    await vi.waitFor(() => expect($q(p, "#eq-error").textContent).toBe(t("eqErrConfigurar")));
    expect(cerrar).toHaveBeenCalled();
    expect($q(p, "#eq-sala").hidden).toBe(true);
  });
});

describe("los equipos que se anotan", () => {
  it("aparecen con su nombre, sus integrantes y la cuenta acortada; el nombre va como texto, nunca como HTML", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const g = cuenta();
    await equipoLlega(m, 1, g, "<img src=x onerror=alert(1)>Cóndores");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    const fila = filas(p)[0] as HTMLElement;
    expect(fila.querySelector(".eq-nombre")?.textContent).toContain("Cóndores");
    expect(fila.querySelector("img")).toBeNull();
    expect(fila.textContent).toContain("Ana, Beto");
    expect(fila.querySelector(".eq-cuenta")?.textContent).toBe(`${g.slice(0, 4)}…${g.slice(-4)}`);
    expect(fila.dataset.estado).toBe("solicitud");
    expect($q(p, "#eq-cuenta-n").textContent).toBe(t("eqCuenta1"));
  });

  it("lo que no se puede leer (otra clave) no se muestra y se saca de la sala", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    m.escucha().alEquipo?.({ n: 7, cuenta: cuenta(), d: "AAAA", estado: "solicitud", v: 1 });
    await vi.waitFor(() => expect(m.quitados).toEqual([7]));
    expect(filas(p)).toHaveLength(0);
  });

  it("un nombre con una palabra fea queda para revisar, y no sale hasta que quien organiza lo deja", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    await equipoLlega(m, 1, cuenta(), "Los pendejos");
    await vi.waitFor(() => expect($q(p, "#eq-para-revisar").hidden).toBe(false));
    expect(filas(p)).toHaveLength(0);
    expect($q(p, "#eq-para-revisar-lista").textContent).not.toContain("pendejos");
    ($q(p, "#eq-para-revisar-lista button") as HTMLButtonElement).click();
    expect(filas(p)).toHaveLength(1);
    expect(filas(p)[0]?.textContent).toContain("Los pendejos");
  });

  it("quien organiza acepta un equipo y la sala lo guarda", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    await equipoLlega(m, 1, cuenta(), "Cóndores");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    const aceptar = [...(filas(p)[0] as HTMLElement).querySelectorAll("button")].find((b) => b.textContent === t("eqAceptar")) as HTMLButtonElement;
    aceptar.click();
    await vi.waitFor(() => expect(m.estados).toContainEqual([1, "aceptado"]));
    await vi.waitFor(() => expect(filas(p)[0]?.dataset.estado).toBe("aceptado"));
  });

  it("'Aceptar a todos' acepta a todos los que esperan, y es la acción que se marca", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    await equipoLlega(m, 1, cuenta(), "Uno");
    await equipoLlega(m, 2, cuenta(), "Dos");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    const todos = $q<HTMLButtonElement>(p, "#eq-aceptar-todos");
    expect(todos.hidden).toBe(false);
    expect(todos.textContent).toBe(t("eqAceptarTodos").replace("{n}", "2"));
    expect(todos.dataset.sugerida).toBe("1");
    expect($q<HTMLButtonElement>(p, "#eq-dar").dataset.sugerida).toBe("");
    todos.click();
    await vi.waitFor(() => expect(m.estados.filter(([, e]) => e === "aceptado")).toHaveLength(2));
  });

  it("un equipo quitado desde otra pantalla desaparece", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    await equipoLlega(m, 1, cuenta(), "Uno");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    m.escucha().alEquipoQuitado?.(1);
    expect(filas(p)).toHaveLength(0);
  });
});

describe("con sorteo propio: el cupón solo va a quien ya sorteó", () => {
  it("marca 'ya sorteó' a los aceptados que sellaron un sorteo con su cuenta y le avisa a la sala", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const a = cuenta();
    const b = cuenta();
    const c = cuenta();
    await equipoLlega(m, 1, a, "Sí sorteó", "aceptado");
    await equipoLlega(m, 2, b, "No sorteó", "aceptado");
    await equipoLlega(m, 3, c, "Sorteó pero sin aceptar", "solicitud");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(3));
    m.sortearon = new Set([a, c]);
    await p.revisar(true);
    const estado = (n: number): string | undefined => filas(p).find((f) => f.dataset.n === String(n))?.dataset.estado;
    expect(estado(1)).toBe("sorteo");
    expect(estado(2)).toBe("aceptado");
    expect(estado(3)).toBe("solicitud");
    expect(m.estados).toContainEqual([1, "sorteo"]);
    expect(m.estados.find(([n]) => n === 2)).toBeUndefined();
    expect(m.estados.find(([n]) => n === 3)).toBeUndefined();
    expect($q<HTMLButtonElement>(p, "#eq-dar").textContent).toBe(t("eqDarCupones").replace("{n}", "1"));
  });

  it("'Dar cupones' arma UNA transacción solo con los que cumplen", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const a = cuenta();
    const b = cuenta();
    await equipoLlega(m, 1, a, "Sí sorteó", "aceptado");
    await equipoLlega(m, 2, b, "No sorteó", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    m.sortearon = new Set([a]);
    // La red muestra el cupón en cuanto se manda.
    m.deps.aprobar = async () => {
      m.pagos.push(pago(100, a));
      return { tipo: "enviado", hash: "TXHASH" };
    };
    await p.darCupones();
    expect(m.armadas).toEqual([[a]]);
    expect(filas(p).find((f) => f.dataset.n === "1")?.dataset.estado).toBe("cupon");
    expect(filas(p).find((f) => f.dataset.n === "2")?.dataset.estado).toBe("aceptado");
    expect($q(p, "#eq-progreso").textContent).toContain(t("eqCuponesListos").replace("{n}", "1"));
    expect($q<HTMLAnchorElement>(p, "#eq-progreso a").href).toBe("https://explorador/tx/TXHASH");
    expect(m.estados).toContainEqual([1, "cupon"]);
  });

  it("si nadie cumple, no arma nada y lo dice", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    await equipoLlega(m, 1, cuenta(), "No sorteó", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    await p.darCupones();
    expect(m.armadas).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqSinQuienDar"));
  });

  it("una cuenta que todavía no existe en la red no recibe el cupón y se avisa, sin fallar", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const viva = cuenta();
    const nueva = cuenta();
    m.activas.set(nueva, false);
    await equipoLlega(m, 1, viva, "Activa", "aceptado");
    await equipoLlega(m, 2, nueva, "Nueva", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    m.sortearon = new Set([viva, nueva]);
    await p.revisar(true);
    const fila = filas(p).find((f) => f.dataset.n === "2") as HTMLElement;
    expect(fila.textContent).toContain(t("eqInactiva"));
    m.deps.aprobar = async () => {
      m.pagos.push(pago(5, viva));
      return { tipo: "enviado", hash: "H" };
    };
    await p.darCupones();
    expect(m.armadas).toEqual([[viva]]);
  });

  it("si la lectura de los sorteos falla, no se afirma nada: se avisa y nadie recibe el cupón", async () => {
    const m = mundo();
    m.deps.sorteos = async () => null;
    const p = await abrirRegistro(m, "sorteo");
    await equipoLlega(m, 1, cuenta(), "Uno", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    await p.revisar(true);
    expect($q(p, "#eq-error").textContent).toBe(t("eqSorteosNoLeidos"));
    await p.darCupones();
    expect(m.armadas).toEqual([]);
  });
});

describe("el modo de reserva: cupón gratis", () => {
  it("a todos los anotados, sin pedir ningún sorteo", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const a = cuenta();
    const b = cuenta();
    // En este modo la sala los deja directamente 'aceptado'.
    await equipoLlega(m, 1, a, "Uno", "aceptado");
    await equipoLlega(m, 2, b, "Dos", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    expect($q<HTMLButtonElement>(p, "#eq-aceptar-todos").hidden).toBe(true);
    expect(filas(p)[0]?.textContent).toContain(t("eqEstAnotado"));
    m.deps.aprobar = async () => {
      m.pagos.push(pago(1, a), pago(2, b));
      return { tipo: "enviado", hash: "H" };
    };
    await p.darCupones();
    expect(m.armadas).toEqual([[a, b]]);
    expect(filas(p).map((f) => f.dataset.estado)).toEqual(["cupon", "cupon"]);
  });
});

describe("aprobar los cupones", () => {
  it("con la cuenta de Google no se firma: se muestra el código para Stellar Lab y la explicación", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    await equipoLlega(m, 1, cuenta(), "Uno", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    m.aprobacion.r = { tipo: "a-mano", xdr: "XDR-DE-PRUEBA", porque: "pollar" };
    await p.darCupones();
    const caja = $q(p, "#eq-xdr");
    expect(caja.hidden).toBe(false);
    expect($q<HTMLTextAreaElement>(p, "#eq-xdr-texto").value).toBe("XDR-DE-PRUEBA");
    expect($q(p, "#eq-xdr-porque").textContent).toBe(t("eqXdrPollar"));
    expect($q<HTMLAnchorElement>(p, "#eq-xdr-lab").href).toContain("lab.stellar.org");
    // «Ya la envié» vuelve a mirar la red.
    $q<HTMLButtonElement>(p, "#eq-xdr-ya").click();
    expect($q(p, "#eq-xdr").hidden).toBe(true);
  });

  it("si la red no la acepta, dice por qué", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    await equipoLlega(m, 1, cuenta(), "Uno", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    m.aprobacion.r = { tipo: "fallo", motivo: "sin-saldo" };
    await p.darCupones();
    expect($q(p, "#eq-error").textContent).toBe(t("eqErrSinSaldo"));
    expect($q<HTMLButtonElement>(p, "#eq-dar").disabled).toBe(false);
  });

  it("si la cuenta del evento no existe en la red, no arma nada", async () => {
    const m = mundo();
    m.deps.leerCuenta = async () => ({ existe: false });
    const p = await abrirRegistro(m, "cupon");
    await equipoLlega(m, 1, cuenta(), "Uno", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    await p.darCupones();
    expect(m.armadas).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqErrCuentaEvento"));
  });

  it("con más de 100 equipos manda la primera tanda y avisa cuántos quedan", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const todas = Array.from({ length: 103 }, cuenta);
    // Nombres sin números: el filtro de palabras deshace las cifras por letras, y alguno de "Equipo 87" podría quedar para revisar.
    const letra = (k: number): string => String.fromCharCode(97 + (k % 26));
    for (const [i, c] of todas.entries()) await equipoLlega(m, i + 1, c, `Equipo ${letra(i)}${letra(Math.floor(i / 26) + 11)}`, "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(103));
    m.deps.aprobar = async () => {
      todas.slice(0, 100).forEach((c, i) => m.pagos.push(pago(i + 1, c)));
      return { tipo: "enviado", hash: "H" };
    };
    await p.darCupones();
    expect(m.armadas[0]).toHaveLength(100);
    expect($q(p, "#eq-progreso").textContent).toContain(t("eqCuponesTanda").replace("{n}", "100").replace("{m}", "3"));
  });
});

describe("la lista que se sella sale de los cupones", () => {
  async function conCupones(m: Mundo): Promise<{ p: ReturnType<typeof crearPanelDeEquipos>; a: string; b: string; c: string }> {
    const p = await abrirRegistro(m, "cupon");
    const [a, b, c] = [cuenta(), cuenta(), cuenta()] as [string, string, string];
    await equipoLlega(m, 1, a, "Primeros en anotarse", "aceptado");
    await equipoLlega(m, 2, b, "Segundos", "aceptado");
    await equipoLlega(m, 3, c, "Sin cupón", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(3));
    // El cupón llegó primero a los segundos.
    m.pagos.push(pago(10, b), pago(20, a));
    await p.revisar(true);
    return { p, a, b, c };
  }

  it("las cuentas, una por línea, en el orden en que recibieron el cupón; el nombre queda como etiqueta", async () => {
    const m = mundo();
    const { p, a, b } = await conCupones(m);
    const boton = $q<HTMLButtonElement>(p, "#eq-lista");
    expect(boton.hidden).toBe(false);
    boton.click();
    expect(m.lista).toEqual([b, a]);
    expect([...(m.etiquetas[0]?.entries() ?? [])]).toEqual([
      [b, "Segundos"],
      [a, "Primeros en anotarse"],
    ]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqListaPuesta").replace("{n}", "2"));
  });

  it("con la lectura de la red en curso, espera a que termine y recién arma la lista", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const [a, b] = [cuenta(), cuenta()] as [string, string];
    await equipoLlega(m, 1, a, "Primeros", "aceptado");
    await equipoLlega(m, 2, b, "Segundos", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    // La lectura de los pagos tarda: un toque en «Usar los equipos con cupón como lista» no puede decir «hacen falta dos».
    let soltar: (x: Pago[]) => void = () => undefined;
    m.deps.pagos = () => new Promise<Pago[]>((r) => (soltar = r));
    const lectura = p.revisar(true);
    const lista = p.usarComoLista();
    expect(m.lista).toEqual([]);
    expect($q(p, "#eq-error").textContent).not.toBe(t("eqListaPocos"));
    soltar([pago(10, a), pago(20, b)]);
    await lectura;
    await lista;
    expect(m.lista).toEqual([a, b]);
  });

  it("con la lista ya sellada no se cambia y se explica", async () => {
    const m = mundo();
    const { p } = await conCupones(m);
    m.sellada.si = true;
    $q<HTMLButtonElement>(p, "#eq-lista").click();
    expect(m.lista).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqListaSellada"));
  });

  it("con menos de dos equipos con cupón no arma la lista", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const a = cuenta();
    await equipoLlega(m, 1, a, "Solo", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    m.pagos.push(pago(1, a));
    await p.revisar(true);
    $q<HTMLButtonElement>(p, "#eq-lista").click();
    expect(m.lista).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqListaPocos"));
  });
});

describe("cerrar y retomar", () => {
  it("cerrar el registro lo borra y vuelve a la configuración", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    $q<HTMLButtonElement>(p, "#eq-cerrar").click();
    await vi.waitFor(() => expect($q(p, "#eq-sala").hidden).toBe(true));
    expect($q(p, "#eq-config").hidden).toBe(false);
    expect(m.deps.almacen.getItem("tinkazo.equipos.sala")).toBeNull();
    expect($q(p, "#eq-error").textContent).toBe(t("eqCerradaMsg"));
  });

  it("si se recarga la pantalla, el registro sigue donde estaba", async () => {
    const m = mundo();
    await abrirRegistro(m, "sorteo");
    document.body.innerHTML = "";
    const otra = crearPanelDeEquipos(m.deps);
    expect($q(otra, "#eq-sala").hidden).toBe(false);
    expect($q(otra, "#eq-config").hidden).toBe(true);
  });
});

describe("la bandera", () => {
  const armarPagina = (): void => {
    document.body.innerHTML = '<div id="origenes"></div><button id="btn-stand"></button>';
  };

  it("apagada (por defecto) no agrega ni un elemento a la herramienta", () => {
    armarPagina();
    const antes = document.body.innerHTML;
    expect(initEquiposSala(mundo().deps)).toBeNull();
    expect(document.body.innerHTML).toBe(antes);
  });

  it("prendida, agrega el enlace «Tengo equipos» y el panel, plegado", async () => {
    armarPagina();
    vi.stubEnv("VITE_EQUIPOS", "1");
    const panel = initEquiposSala(mundo().deps);
    vi.unstubAllEnvs();
    expect(panel).not.toBeNull();
    const entrada = document.getElementById("btn-equipos") as HTMLButtonElement;
    expect(entrada.textContent).toBe(t("eqEntrada"));
    expect(document.getElementById("equipos-panel")?.hidden).toBe(true);
    entrada.click();
    expect(document.getElementById("equipos-panel")?.hidden).toBe(false);
    expect(entrada.getAttribute("aria-expanded")).toBe("true");
    await espera();
  });
});
