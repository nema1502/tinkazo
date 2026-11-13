// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de equipos de quien organiza, con un DOM de mentira y la red simulada: abrir el registro, aceptar, mirar
 * quién ya sorteó, dar cupones (solo a quien le toca), qué se ve si la cuenta del evento es la de Google y la lista
 * que sale de los cupones.
 */

const h = vi.hoisted(() => ({ app: { frozen: null as unknown }, red: null as "testnet" | "mainnet" | null, oficial: null as boolean | null }));
vi.mock("../state", () => ({ app: h.app }));
// El modo de la pestaña, que las pruebas de "una sala es del modo en que se abrió" cambian a mano.
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get hayModoOficial() {
      return h.oficial ?? real.hayModoOficial;
    },
    network: new Proxy(real.network, { get: (t, k) => (k === "name" && h.red ? h.red : Reflect.get(t, k)) }),
  };
});
vi.mock("./participants", () => ({ setList: () => undefined }));
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { t } from "../i18n";
import { cifrarEquipo, descifrarEquipo } from "../equipos/datos";
import { type Pago } from "../equipos/horizon";
import { CUPON_MONTO, EVENTO_POR_DEFECTO, memoCupon } from "../equipos/modelo";
import type { Aprobacion } from "../equipos/envio";
import { type DepsDelPanel, crearPanelDeEquipos, initEquiposSala } from "./equipos-sala";
import { crearPantallaDelStand } from "./pantalla-stand";
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
  /** El reloj de la pantalla del stand. */
  ahora: number;
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
    ahora: new Date(2026, 10, 14, 17, 30, 0).getTime(),
  };
  m.deps = {
    tx: t,
    ahora: () => m.ahora,
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
    pantalla: (datos) =>
      crearPantallaDelStand({
        tx: t,
        idioma: () => "es",
        datos,
        qr: async () => undefined,
        ahora: () => m.ahora,
        cada: () => () => undefined,
        ventana: () => ({ ancho: 1920, alto: 1080 }),
      }),
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
  h.red = null;
  h.oficial = null;
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

  it("si todos ya tienen su cupón, lo dice así y no que no hay a quién darle", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const a = cuenta();
    const b = cuenta();
    await equipoLlega(m, 1, a, "Primeros", "aceptado");
    await equipoLlega(m, 2, b, "Segundos", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    // Los dos ya recibieron el suyo: la red lo muestra y la pantalla lo sube a la sala.
    m.pagos.push(pago(10, a), pago(20, b));
    await p.revisar(true);
    await p.darCupones();
    expect(m.armadas).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqTodosConCupon"));
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

  it("una cuenta mal escrita se deja afuera, se dice cuál es y los demás reciben su cupón", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const buena1 = cuenta();
    const buena2 = cuenta();
    const g = cuenta();
    // La última letra cambiada: tiene la forma de una cuenta, pero Stellar la rechazaría y tiraría abajo toda la tanda.
    const mala = `${g.slice(0, 55)}${g[55] === "A" ? "B" : "A"}`;
    await equipoLlega(m, 1, buena1, "Los Cóndores", "aceptado");
    await equipoLlega(m, 2, mala, "Los Pumas", "aceptado");
    await equipoLlega(m, 3, buena2, "Los Halcones", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(3));
    // La mala se marca en la lista antes de dar los cupones, para poder quitarla.
    expect(filas(p).find((f) => f.dataset.n === "2")?.textContent).toContain(t("eqCuentaMala"));
    expect(filas(p).find((f) => f.dataset.n === "1")?.textContent).not.toContain(t("eqCuentaMala"));
    m.deps.aprobar = async () => {
      m.pagos.push(pago(1, buena1), pago(2, buena2));
      return { tipo: "enviado", hash: "TXHASH" };
    };
    await p.darCupones();
    expect(m.armadas).toEqual([[buena1, buena2]]);
    expect(m.estados).toContainEqual([1, "cupon"]);
    expect(m.estados).toContainEqual([3, "cupon"]);
    expect(m.estados.find(([n]) => n === 2)).toBeUndefined();
    const nota = $q(p, "#eq-progreso").textContent ?? "";
    expect(nota).toContain(t("eqCuponesListos").replace("{n}", "2"));
    expect(nota).toContain("Los Pumas");
    expect($q(p, "#eq-error").hidden).toBe(true);
  });

  it("si solo queda una cuenta mala, no se arma nada y se dice cuál es, no «sin conexión»", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const g = cuenta();
    await equipoLlega(m, 1, `${g.slice(0, 55)}${g[55] === "A" ? "B" : "A"}`, "Los Pumas", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    await p.darCupones();
    expect(m.armadas).toEqual([]);
    expect($q(p, "#eq-error").textContent).toContain("Los Pumas");
    expect($q(p, "#eq-error").textContent).not.toBe(t("eqErrRed"));
  });

  it("con una cuenta mal copiada y otra sin activar, se dicen las dos notas, en la lista y al dar los cupones", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const g = cuenta();
    const nueva = cuenta();
    m.activas.set(nueva, false);
    await equipoLlega(m, 1, `${g.slice(0, 55)}${g[55] === "A" ? "B" : "A"}`, "Los Pumas", "aceptado");
    await equipoLlega(m, 2, nueva, "Los Halcones", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    await p.revisar(true);
    const nota = $q(p, "#eq-progreso").textContent ?? "";
    expect(nota).toContain("Los Pumas");
    expect(nota).toContain(t("eqNoActivas").replace("{n}", "1"));
    await p.darCupones();
    expect(m.armadas).toEqual([]);
    const error = $q(p, "#eq-error").textContent ?? "";
    expect(error).toContain("Los Pumas");
    expect(error).toContain(t("eqNoActivas").replace("{n}", "1"));
  });

  it("un error que no es de conexión no se muestra como «No hay conexión»", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    await equipoLlega(m, 1, cuenta(), "Uno", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    m.deps.armar = async () => {
      throw new Error("destination is invalid");
    };
    await p.darCupones();
    expect($q(p, "#eq-error").textContent).toBe(t("eqErrInesperado"));
    // Un fallo de conexión de verdad sí.
    m.deps.armar = async () => {
      throw new TypeError("Failed to fetch");
    };
    await p.darCupones();
    expect($q(p, "#eq-error").textContent).toBe(t("eqErrRed"));
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
    // A la vista, solo la línea llana y el botón para seguir.
    expect($q(p, "#eq-xdr-porque").textContent).toBe(t("eqXdrPollar"));
    // Los pasos con el código van plegados, para quien quiera el detalle.
    const detalle = caja.querySelector("details") as HTMLElement;
    expect(detalle.querySelector("summary")?.textContent).toBe(t("eqXdrDetalle"));
    // El renglón dice qué hay que hacer ahí adentro, no que es un detalle opcional: sin esos pasos no hay aprobación.
    expect(detalle.querySelector("summary")?.textContent).toBe("Cómo aprobarlos");
    expect(detalle.textContent).toContain(t("eqXdrPasos"));
    expect($q<HTMLTextAreaElement>(p, "#eq-xdr-texto").value).toBe("XDR-DE-PRUEBA");
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

  it("el botón de la lista sale con los pagos, sin esperar a los sorteos que tardan", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const [a, b] = [cuenta(), cuenta()] as [string, string];
    await equipoLlega(m, 1, a, "Primeros", "aceptado");
    await equipoLlega(m, 2, b, "Segundos", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    m.pagos.push(pago(10, a), pago(20, b));
    // Los sorteos tardan: la lectura queda en curso.
    let soltar: (x: Awaited<ReturnType<DepsDelPanel["sorteos"]>>) => void = () => undefined;
    m.deps.sorteos = () => new Promise((r) => (soltar = r));
    const lectura = p.revisar(true);
    // Los cupones ya están a la vista: el botón no espera a los sorteos.
    await vi.waitFor(() => expect($q<HTMLButtonElement>(p, "#eq-lista").hidden).toBe(false));
    soltar({ porCuenta: new Map(), truncado: false });
    await lectura;
    // Y la lista sale igual, en el orden en que llegaron los cupones.
    $q<HTMLButtonElement>(p, "#eq-lista").click();
    expect(m.lista).toEqual([a, b]);
  });

  it("tras recargar, el botón se ve enseguida si la sala ya dice que hay cupones", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    // La red tarda, pero la sala ya trae el punto: se recargó con los cupones repartidos.
    m.deps.pagos = () => new Promise<Pago[]>(() => undefined);
    await equipoLlega(m, 1, cuenta(), "Primeros", "cupon");
    await equipoLlega(m, 2, cuenta(), "Segundos", "cupon");
    await vi.waitFor(() => expect($q(p, "#eq-cuenta-n").textContent).toContain("2"));
    expect($q<HTMLButtonElement>(p, "#eq-lista").hidden).toBe(false);
    p.detener();
  });

  it("un equipo que entra después de la foto de cuentas entra a la lista si su pago ya viene en la respuesta", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const [a, b, c] = [cuenta(), cuenta(), cuenta()] as [string, string, string];
    await equipoLlega(m, 1, a, "Primeros", "cupon");
    await equipoLlega(m, 2, b, "Segundos", "cupon");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    // La lectura sale con la foto de A y B; C entra al panel mientras la red contesta, y su pago ya viene en esa respuesta.
    let soltar: (x: Pago[]) => void = () => undefined;
    m.deps.pagos = () => new Promise<Pago[]>((r) => (soltar = r));
    const lectura = p.revisar(true);
    await equipoLlega(m, 3, c, "Terceros", "cupon");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(3));
    soltar([pago(10, a), pago(20, b), pago(30, c)]);
    await lectura;
    $q<HTMLButtonElement>(p, "#eq-lista").click();
    await vi.waitFor(() => expect(m.lista).toEqual([a, b, c]));
  });

  it("un equipo que entra después de la última lectura terminada hace leer de nuevo antes de armar la lista, y el botón muestra que trabaja", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const [a, b, c] = [cuenta(), cuenta(), cuenta()] as [string, string, string];
    await equipoLlega(m, 1, a, "Primeros", "cupon");
    await equipoLlega(m, 2, b, "Segundos", "cupon");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    m.pagos.push(pago(10, a), pago(20, b), pago(30, c));
    await p.revisar(true);
    // C entra después de esa lectura, con su cupón ya en la red.
    await equipoLlega(m, 3, c, "Terceros", "cupon");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(3));
    let soltar: (x: Pago[]) => void = () => undefined;
    let lecturas = 0;
    m.deps.pagos = () => {
      lecturas++;
      return new Promise<Pago[]>((r) => (soltar = r));
    };
    const boton = $q<HTMLButtonElement>(p, "#eq-lista");
    boton.click();
    await vi.waitFor(() => expect(lecturas).toBe(1));
    expect(boton.disabled).toBe(true);
    expect(boton.textContent).toBe(t("eqRevisando"));
    // Un segundo toque mientras espera no lanza otra lectura.
    boton.click();
    void p.usarComoLista();
    expect(lecturas).toBe(1);
    soltar([pago(10, a), pago(20, b), pago(30, c)]);
    await vi.waitFor(() => expect(m.lista).toEqual([a, b, c]));
    expect(boton.disabled).toBe(false);
    expect(boton.textContent).toBe(t("eqUsarLista"));
  });

  it("un equipo que figura con cupón en la sala pero no se lee en la red no entra a la lista, y eso se avisa", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const [a, b, c] = [cuenta(), cuenta(), cuenta()] as [string, string, string];
    await equipoLlega(m, 1, a, "Primeros", "cupon");
    await equipoLlega(m, 2, b, "Segundos", "cupon");
    await equipoLlega(m, 3, c, "Terceros", "cupon");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(3));
    // De C no hay pago en la red: nunca entra solo por lo que dice la sala.
    m.pagos.push(pago(10, a), pago(20, b));
    await p.usarComoLista();
    expect(m.lista).toEqual([a, b]);
    expect(m.lista).not.toContain(c);
    expect($q(p, "#eq-error").textContent).toContain(t("eqListaPuesta").replace("{n}", "2"));
    expect($q(p, "#eq-error").textContent).toContain(t("eqListaSinConfirmar1"));
  });

  it("con la lista ya sellada no se cambia y se explica", async () => {
    const m = mundo();
    const { p } = await conCupones(m);
    m.sellada.si = true;
    $q<HTMLButtonElement>(p, "#eq-lista").click();
    expect(m.lista).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqListaSellada"));
  });

  it("si los pagos no se pudieron leer, ni da cupones ni arma la lista con lo que ya conocía, y lo dice", async () => {
    const m = mundo();
    const { p, c } = await conCupones(m);
    // Horizon deja de contestar: lo que se sabía de antes puede estar incompleto.
    m.deps.pagos = async () => null;
    await p.revisar(true);
    expect($q(p, "#eq-error").textContent).toBe(t("eqPagosNoLeidos"));
    expect($q<HTMLButtonElement>(p, "#eq-dar").disabled).toBe(true);
    expect($q<HTMLButtonElement>(p, "#eq-lista").disabled).toBe(true);
    // Aunque se llame igual (un toque que llegó antes de pintar): ni la lista ni el cupón para `c`.
    await p.usarComoLista();
    expect(m.lista).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqPagosNoLeidos"));
    await p.darCupones();
    expect(m.armadas).toEqual([]);
    expect($q(p, "#eq-error").textContent).toBe(t("eqPagosNoLeidos"));
    // Cuando la red vuelve a contestar, todo vuelve.
    m.deps.pagos = async () => [...m.pagos];
    await p.revisar(true);
    expect($q<HTMLButtonElement>(p, "#eq-lista").disabled).toBe(false);
    await p.darCupones();
    expect(m.armadas).toEqual([[c]]);
  });

  it("con tantos pagos que no se leen en una vuelta, sigue leyendo enseguida y mientras tanto no deja armar la lista", async () => {
    const m = mundo();
    const { p, a, b } = await conCupones(m);
    let pendientes = 2;
    m.deps.pagos = async () => (pendientes > 0 ? null : [...m.pagos]);
    m.deps.pagosPendientes = () => pendientes > 0;
    const esperas: number[] = [];
    let seguir: () => void = () => undefined;
    m.deps.esperar = (ms) => {
      esperas.push(ms);
      return new Promise<void>((r) => (seguir = r));
    };
    await p.revisar(true);
    expect($q(p, "#eq-error").textContent).toBe(t("eqPagosLeyendo"));
    expect($q<HTMLButtonElement>(p, "#eq-lista").disabled).toBe(true);
    await p.usarComoLista();
    expect(m.lista).toEqual([]);
    // La próxima vuelta no espera la revisión periódica (20 s).
    expect(esperas).toHaveLength(1);
    expect(esperas[0]).toBeLessThan(20_000);
    pendientes = 1;
    seguir();
    await vi.waitFor(() => expect(esperas).toHaveLength(2));
    pendientes = 0;
    seguir();
    await vi.waitFor(() => expect($q<HTMLButtonElement>(p, "#eq-lista").disabled).toBe(false));
    expect($q(p, "#eq-error").hidden).toBe(true);
    expect(esperas).toHaveLength(2);
    await p.usarComoLista();
    expect(m.lista).toEqual([b, a]);
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

  it("la lista ocupa buena parte del alto: con 26 equipos se trabaja sin una caja de dos", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/equipos/equipos.css", "utf8");
    const regla = /\.eq-equipos\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(Number(/max-height:\s*([\d.]+)vh/.exec(regla)?.[1] ?? 0)).toBeGreaterThanOrEqual(60);
  });
});

describe("las lecturas que quedan esperando", () => {
  it("si los pagos fallan, las de sorteos y cuentas no quedan sin nadie que las atienda", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const g = cuenta();
    m.activas.set(g, false);
    await equipoLlega(m, 1, g, "Uno", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    m.deps.pagos = async () => {
      throw new Error("pagos caídos");
    };
    m.deps.sorteos = async () => {
      throw new Error("sorteos caídos");
    };
    m.deps.activas = async () => {
      throw new Error("cuentas caídas");
    };
    await expect(p.revisar(true)).rejects.toThrow("pagos caídos");
    // Si alguna de las que esperaban quedara sin destino, la prueba terminaría con un rechazo sin atrapar.
    await espera(20);
  });

  it("una lectura de cuentas de la sala anterior no escribe sobre la sala nueva", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    const g = cuenta();
    let soltarVieja: () => void = () => undefined;
    m.deps.activas = () =>
      new Promise<Map<string, boolean | null>>((r) => {
        soltarVieja = () => r(new Map([[g, true]]));
      });
    await equipoLlega(m, 1, g, "Los Cóndores", "aceptado");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(1));
    $q<HTMLButtonElement>(p, "#eq-cerrar").click();
    await vi.waitFor(() => expect($q(p, "#eq-sala").hidden).toBe(true));
    $q<HTMLButtonElement>(p, "#eq-abrir").click();
    await vi.waitFor(() => expect($q(p, "#eq-sala").hidden).toBe(false));
    m.activas.set(g, false);
    m.deps.activas = async (cs) => new Map(cs.map((c) => [c, m.activas.get(c) ?? true] as [string, boolean]));
    await equipoLlega(m, 1, g, "Los Cóndores", "aceptado");
    await vi.waitFor(() => expect(filas(p)[0]?.textContent).toContain(t("eqInactiva")));
    // La lectura vieja recién contesta, diciendo que la cuenta sí está activa: no vale para esta sala.
    soltarVieja();
    await espera(20);
    expect(filas(p)[0]?.textContent).toContain(t("eqInactiva"));
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

describe("la sala es del modo en que se abrió", () => {
  const CLAVE = "tinkazo.equipos.sala";

  it("la sala guardada lleva su modo", async () => {
    h.red = "testnet";
    const m = mundo();
    await abrirRegistro(m, "sorteo");
    expect(JSON.parse(m.deps.almacen.getItem(CLAVE) ?? "{}").red).toBe("testnet");
  });

  it("al cambiar de modo y recargar, la sala del otro modo no se retoma y se borra", async () => {
    h.red = "testnet";
    const m = mundo();
    await abrirRegistro(m, "sorteo");
    expect(m.deps.almacen.getItem(CLAVE)).not.toBeNull();
    // Pasa a Oficial: la pestaña recarga en el otro modo con la misma memoria de la pestaña.
    h.red = "mainnet";
    document.body.innerHTML = "";
    const otra = crearPanelDeEquipos(m.deps);
    expect($q(otra, "#eq-sala").hidden).toBe(true);
    expect($q(otra, "#eq-config").hidden).toBe(false);
    expect(m.deps.almacen.getItem(CLAVE)).toBeNull();
  });

  it("y a la inversa: la sala de Oficial no se retoma en Prueba", async () => {
    h.red = "mainnet";
    const m = mundo();
    await abrirRegistro(m, "cupon");
    h.red = "testnet";
    document.body.innerHTML = "";
    const otra = crearPanelDeEquipos(m.deps);
    expect($q(otra, "#eq-sala").hidden).toBe(true);
    expect(m.deps.almacen.getItem(CLAVE)).toBeNull();
  });

  it("el enlace que se copia lleva el modo de la sala solo cuando existe el modo Oficial", async () => {
    const copiados: string[] = [];
    for (const [oficial, red, esperado] of [
      [true, "testnet", "prueba"],
      [true, "mainnet", "oficial"],
      [false, "testnet", null],
    ] as const) {
      h.red = red;
      h.oficial = oficial;
      const m = mundo();
      m.deps.portapapeles = async (x: string) => {
        copiados.push(x);
        return true;
      };
      const p = await abrirRegistro(m, "sorteo");
      $q<HTMLButtonElement>(p, "#eq-copiar").click();
      await vi.waitFor(() => expect(copiados.length).toBeGreaterThan(0));
      expect(new URL(copiados.pop() as string).searchParams.get("red")).toBe(esperado);
      document.body.innerHTML = "";
    }
  });

  it("en el mismo modo, la sala se retoma", async () => {
    h.red = "mainnet";
    const m = mundo();
    await abrirRegistro(m, "sorteo");
    document.body.innerHTML = "";
    const otra = crearPanelDeEquipos(m.deps);
    expect($q(otra, "#eq-sala").hidden).toBe(false);
  });

  it("una sala guardada sin modo es de Prueba: sigue retomándose en Prueba y no pasa a Oficial", async () => {
    h.red = "testnet";
    const m = mundo();
    await abrirRegistro(m, "sorteo");
    const vieja = JSON.parse(m.deps.almacen.getItem(CLAVE) ?? "{}");
    delete vieja.red;
    m.deps.almacen.setItem(CLAVE, JSON.stringify(vieja));
    document.body.innerHTML = "";
    expect($q(crearPanelDeEquipos(m.deps), "#eq-sala").hidden).toBe(false);
    h.red = "mainnet";
    document.body.innerHTML = "";
    expect($q(crearPanelDeEquipos(m.deps), "#eq-sala").hidden).toBe(true);
    expect(m.deps.almacen.getItem(CLAVE)).toBeNull();
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

describe("«Tengo equipos» no está en el camino del sorteo común", () => {
  /** La lista con su pliegue de opciones, como `index.html`: el panel va arriba del cuadro y el enlace dentro del pliegue. */
  const armarConPliegue = (): void => {
    document.body.innerHTML =
      '<div id="origenes"></div><button id="btn-stand"></button>' +
      '<details class="mas" id="mas-opciones"><summary>Opciones</summary><div class="field" id="otra-opcion"></div></details>';
  };

  it("el enlace va dentro del pliegue de opciones, y no junto al del stand", () => {
    armarConPliegue();
    vi.stubEnv("VITE_EQUIPOS", "1");
    initEquiposSala(mundo().deps);
    vi.unstubAllEnvs();
    const entrada = document.getElementById("btn-equipos") as HTMLButtonElement;
    expect(entrada.closest("#mas-opciones")).not.toBeNull();
    expect(document.getElementById("btn-stand")?.nextElementSibling).not.toBe(entrada);
    // El pliegue cerrado esconde el enlace: nadie lo ve en el camino común.
    expect((document.getElementById("mas-opciones") as HTMLDetailsElement).open).toBe(false);
  });

  it("al tocarlo se abre el panel y se lo lleva a la vista, porque está arriba del cuadro", async () => {
    armarConPliegue();
    const llevado = vi.fn();
    Element.prototype.scrollIntoView = llevado;
    vi.stubEnv("VITE_EQUIPOS", "1");
    const panel = initEquiposSala(mundo().deps);
    vi.unstubAllEnvs();
    (document.getElementById("btn-equipos") as HTMLButtonElement).click();
    expect(panel?.raiz.hidden).toBe(false);
    expect(llevado).toHaveBeenCalled();
    await espera();
  });

  it("si se recarga con el registro abierto, el pliegue se abre: el enlace no queda escondido con el panel a la vista", async () => {
    const m = mundo();
    await abrirRegistro(m, "sorteo");
    armarConPliegue();
    vi.stubEnv("VITE_EQUIPOS", "1");
    const panel = initEquiposSala(m.deps);
    vi.unstubAllEnvs();
    expect(panel?.raiz.hidden).toBe(false);
    const entrada = document.getElementById("btn-equipos") as HTMLButtonElement;
    expect(entrada.getAttribute("aria-expanded")).toBe("true");
    expect((document.getElementById("mas-opciones") as HTMLDetailsElement).open).toBe(true);
  });

  it("sin registro abierto, el pliegue sigue cerrado", () => {
    armarConPliegue();
    vi.stubEnv("VITE_EQUIPOS", "1");
    initEquiposSala(mundo().deps);
    vi.unstubAllEnvs();
    expect((document.getElementById("mas-opciones") as HTMLDetailsElement).open).toBe(false);
  });

  it("el desplazamiento al abrir el panel respeta el movimiento reducido", async () => {
    for (const [reducido, comportamiento] of [[true, "auto"], [false, "smooth"]] as const) {
      armarConPliegue();
      const llevado = vi.fn();
      Element.prototype.scrollIntoView = llevado;
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: reducido && q.includes("reduce"), media: q }));
      vi.stubEnv("VITE_EQUIPOS", "1");
      initEquiposSala(mundo().deps);
      vi.unstubAllEnvs();
      (document.getElementById("btn-equipos") as HTMLButtonElement).click();
      expect(llevado, String(reducido)).toHaveBeenCalledWith({ behavior: comportamiento, block: "nearest" });
      vi.unstubAllGlobals();
      await espera();
    }
  });

  it("sin el pliegue en la página (otra pantalla), queda junto al enlace del stand como antes", () => {
    document.body.innerHTML = '<div id="origenes"></div><button id="btn-stand"></button>';
    vi.stubEnv("VITE_EQUIPOS", "1");
    initEquiposSala(mundo().deps);
    vi.unstubAllEnvs();
    expect(document.getElementById("btn-stand")?.nextElementSibling?.id).toBe("btn-equipos");
  });
});

describe("la pantalla del stand", () => {
  const pantalla = (): HTMLElement => document.getElementById("pantalla-stand") as HTMLElement;
  const tarjetas = (): HTMLElement[] => [...pantalla().querySelectorAll<HTMLElement>(".stp-equipo")];

  it("se abre desde el panel con los equipos, su estado y cuántos tienen cupón, sin lo que hay que revisar", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const a = cuenta();
    await equipoLlega(m, 1, a, "Las Wawas", "aceptado");
    await equipoLlega(m, 2, cuenta(), "Los Cóndores");
    await equipoLlega(m, 3, cuenta(), "Los pendejos");
    await vi.waitFor(() => expect(filas(p)).toHaveLength(2));
    await vi.waitFor(() => expect($q(p, "#eq-para-revisar").hidden).toBe(false));
    m.pagos.push(pago(100, a));
    await p.revisar(true);
    $q<HTMLButtonElement>(p, "#eq-pantalla").click();
    expect(pantalla().hidden).toBe(false);
    expect(pantalla().getAttribute("role")).toBe("dialog");
    expect(tarjetas().map((li) => [li.querySelector(".stp-nombre")?.textContent, li.dataset.estado])).toEqual([
      ["Las Wawas", "cupon"],
      ["Los Cóndores", "anotado"],
    ]);
    expect(tarjetas()[0]?.querySelector(".stp-chip")?.textContent).toBe(t("eqStCupon"));
    expect(pantalla().querySelector("#stp-cupones-n")?.textContent).toBe(t("eqStCuponesN").replace("{c}", "1").replace("{n}", "2"));
    expect(pantalla().querySelector("#stp-cupones-t")?.textContent).toBe(t("eqStCuponesT"));
    // Una sola cosa para tocar.
    expect(pantalla().querySelectorAll("button")).toHaveLength(1);
    // Sin hora fijada, no hay cuenta regresiva.
    expect((pantalla().querySelector("#stp-reloj") as HTMLElement).hidden).toBe(true);
  });

  it("un equipo que llega con la pantalla abierta aparece en ella", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "cupon");
    $q<HTMLButtonElement>(p, "#eq-pantalla").click();
    expect((pantalla().querySelector("#stp-vacia") as HTMLElement).hidden).toBe(false);
    await equipoLlega(m, 1, cuenta(), "Byte Club", "aceptado");
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(1));
    expect(tarjetas()[0]?.dataset.estado).toBe("anotado");
    expect((pantalla().querySelector("#stp-vacia") as HTMLElement).hidden).toBe(true);
  });

  it("con la hora del sorteo fijada muestra cuánto falta, y la hora queda guardada en la pestaña", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const hora = $q<HTMLInputElement>(p, "#eq-hora");
    hora.value = "18:00";
    hora.dispatchEvent(new Event("change"));
    $q<HTMLButtonElement>(p, "#eq-pantalla").click();
    const reloj = pantalla().querySelector("#stp-reloj") as HTMLElement;
    expect(reloj.hidden).toBe(false);
    expect(reloj.querySelector("#stp-reloj-n")?.textContent).toBe(t("eqStFaltan").replace("{t}", "30:00"));
    expect(JSON.parse(m.deps.almacen.getItem("tinkazo.equipos.sala") ?? "{}").hora).toBe("18:00");
    // Pasada la hora, lo dice.
    m.ahora = new Date(2026, 10, 14, 18, 0, 5).getTime();
    p.pintar();
    expect(reloj.querySelector("#stp-reloj-n")?.textContent).toBe(t("eqStLlego"));
  });

  it("el instante se calcula al fijar la hora: al pasar la medianoche no salta a «faltan 23 horas»", async () => {
    const m = mundo();
    m.ahora = new Date(2026, 10, 14, 23, 0, 0).getTime();
    const p = await abrirRegistro(m, "sorteo");
    const hora = $q<HTMLInputElement>(p, "#eq-hora");
    hora.value = "23:50";
    hora.dispatchEvent(new Event("change"));
    $q<HTMLButtonElement>(p, "#eq-pantalla").click();
    const n = pantalla().querySelector("#stp-reloj-n") as HTMLElement;
    expect(n.textContent).toBe(t("eqStFaltan").replace("{t}", "50:00"));
    expect(JSON.parse(m.deps.almacen.getItem("tinkazo.equipos.sala") ?? "{}").instante).toBe(new Date(2026, 10, 14, 23, 50).getTime());
    // Pasada la hora y también la medianoche, sigue diciendo que llegó.
    m.ahora = new Date(2026, 10, 14, 23, 55, 0).getTime();
    p.pintar();
    expect(n.textContent).toBe(t("eqStLlego"));
    m.ahora = new Date(2026, 10, 15, 0, 10, 0).getTime();
    p.pintar();
    expect(n.textContent).toBe(t("eqStLlego"));
    // Y si se recarga la pestaña, la hora guardada sigue siendo la misma.
    document.body.innerHTML = "";
    const otra = crearPanelDeEquipos(m.deps);
    document.body.append(otra.raiz);
    $q<HTMLButtonElement>(otra, "#eq-pantalla").click();
    expect((pantalla().querySelector("#stp-reloj-n") as HTMLElement).textContent).toBe(t("eqStLlego"));
  });

  it("«Volver al panel» y Escape la cierran y devuelven el foco al botón", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    const abrir = $q<HTMLButtonElement>(p, "#eq-pantalla");
    abrir.click();
    (pantalla().querySelector(".stp-cerrar") as HTMLButtonElement).click();
    expect(pantalla().hidden).toBe(true);
    expect(document.activeElement).toBe(abrir);
    abrir.click();
    dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(pantalla().hidden).toBe(true);
  });

  it("al cerrar el registro, la pantalla se va", async () => {
    const m = mundo();
    const p = await abrirRegistro(m, "sorteo");
    $q<HTMLButtonElement>(p, "#eq-pantalla").click();
    $q<HTMLButtonElement>(p, "#eq-cerrar").click();
    await vi.waitFor(() => expect(pantalla().hidden).toBe(true));
  });
});
