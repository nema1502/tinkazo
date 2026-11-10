// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T, t } from "../i18n";
import { guardarEquipoLocal } from "./celular";
import { generarClave } from "../sala/cifra";
import { descifrarEquipo } from "./datos";
import type { SalaDeRegistro } from "./enlace";
import { type DepsDelRegistro, PREGUNTAR_CADA_MS, montarRegistro } from "./registro";
import type { ConfigEquipos, EstadoEquipo } from "./modelo";

/**
 * La página del celular del encargado (`equipos.html`), con el markup de verdad y la sala simulada: la cuenta, el
 * equipo, y lo que se ve según cómo armó el registro quien organiza.
 */

const cuenta = (): string => Keypair.random().publicKey();
const EVENTO = cuenta();
const SALA: SalaDeRegistro = { id: "AbCd1234", clave: generarClave(), servicio: "https://s.test" };
const CONFIG = (modo: ConfigEquipos["modo"]): ConfigEquipos => ({ modo, evento: "space-apps-scz-2026", cuenta: EVENTO });

const html = readFileSync("equipos.html", "utf8");
const main = /<main>[\s\S]*<\/main>/.exec(html)?.[0] ?? "";

const memoria = (): Storage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
};

interface Mundo {
  deps: DepsDelRegistro;
  raiz: HTMLElement;
  /** Lo que la sala dice del equipo de esta cuenta. */
  sala: { estado: EstadoEquipo | null | "red" };
  altas: Array<{ cuenta: string; d: string; llave?: string }>;
  reloj: { f: () => void; parado: boolean };
  fuera: { destino: string };
}

async function montar(o: Partial<DepsDelRegistro> & { modo?: ConfigEquipos["modo"]; estado?: EstadoEquipo | null | "red"; config?: ConfigEquipos | null } = {}): Promise<Mundo> {
  document.body.innerHTML = main;
  const raiz = document.querySelector<HTMLElement>(".eqp") as HTMLElement;
  const m: Mundo = {
    deps: undefined as never,
    raiz,
    sala: { estado: o.estado === undefined ? null : o.estado },
    altas: [],
    reloj: { f: () => undefined, parado: false },
    fuera: { destino: "" },
  };
  const local = memoria();
  m.deps = {
    tx: t,
    sala: SALA,
    activo: true,
    red: "testnet",
    hayGoogle: true,
    cuentaRecordada: async () => null,
    entrarConGoogle: async () => cuenta(),
    leerPublico: async () => ({ ok: true, config: o.config === undefined ? CONFIG(o.modo ?? "sorteo") : o.config, equipos: 0 }),
    anotar: async (_s, _i, c, d, llave) => {
      m.altas.push({ cuenta: c, d, llave });
      m.sala.estado = (o.modo ?? "sorteo") === "sorteo" ? "solicitud" : "aceptado";
      return { ok: true, n: 1, estado: m.sala.estado };
    },
    leerEstado: async () => (m.sala.estado === null ? null : m.sala.estado === "red" ? "red" : { n: 1, estado: m.sala.estado }),
    cifrar: (await import("./datos")).cifrarEquipo,
    local,
    sesion: memoria(),
    irAlSorteo: () => {
      m.fuera.destino = "/#sortear";
    },
    cada: (f) => {
      m.reloj.f = f;
      return () => {
        m.reloj.parado = true;
      };
    },
    visible: () => true,
    ...o,
  } as DepsDelRegistro;
  montarRegistro(raiz, m.deps);
  return m;
}

const q = <T2 extends HTMLElement>(m: Mundo, id: string): T2 => m.raiz.querySelector<T2>(`#${id}`) as T2;
const vista = (m: Mundo): string => ["eqp-cuenta", "eqp-datos", "eqp-estado"].find((id) => !q(m, id).hidden) ?? "ninguna";
const mensaje = (m: Mundo): string => q(m, "eqp-msg").textContent ?? "";
const escribir = (m: Mundo, id: string, v: string): void => void (q<HTMLInputElement>(m, id).value = v);

async function llenar(m: Mundo, nombre = "Los Cóndores", integrantes = ["Ana", "Beto", "Carla"]): Promise<void> {
  escribir(m, "eqp-nombre", nombre);
  for (let i = 0; i < 5; i++) escribir(m, `eqp-i${i}`, integrantes[i] ?? "");
  q<HTMLFormElement>(m, "eqp-form").requestSubmit();
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("el markup de la página", () => {
  it("cada clave que usa existe en español y en inglés", () => {
    const claves = [...html.matchAll(/data-i(?:-ph)?="([^"]+)"/g)].map((x) => x[1] as string);
    const codigo = ["src/equipos/registro.ts", "src/equipos-registro.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    claves.push(...[...codigo.matchAll(/"(eqp[A-Za-z]+)"/g)].map((x) => x[1] as string));
    expect(claves.length).toBeGreaterThan(20);
    const faltan = claves.filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string");
    expect(faltan).toEqual([]);
  });
  it("no usa el punto medio ni tecnicismos en lo que se lee", () => {
    for (const l of ["es", "en"] as const) {
      for (const [k, v] of Object.entries(T[l])) {
        if (!/^eqp?[A-Z]/.test(k) || typeof v !== "string") continue;
        expect(v, `${l} ${k}`).not.toMatch(/·|\bdrand\b|\bhash\b|\bbytes?\b|\bstroops?\b|\bXDR\b|\bledger\b|\bsha\b/i);
      }
    }
  });
});

describe("antes de pedir nada", () => {
  it("un enlace incompleto lo dice", async () => {
    const m = await montar({ sala: null });
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpIncompleto")));
    expect(vista(m)).toBe("ninguna");
  });
  it("con la bandera apagada el registro no está abierto", async () => {
    const m = await montar({ activo: false });
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpSinRegistro")));
    expect(vista(m)).toBe("ninguna");
  });
  it("si la sala no contesta, el error trae un botón para probar de nuevo", async () => {
    let caida = true;
    const m = await montar({ leerPublico: async () => (caida ? { ok: false, motivo: "red" } : { ok: true, config: CONFIG("cupon"), equipos: 0 }) });
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpRed")));
    const b = q<HTMLButtonElement>(m, "eqp-reintentar");
    expect(b.hidden).toBe(false);
    expect(b.textContent).toBe(t("eqpReintentar"));
    caida = false;
    b.click();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    expect(q<HTMLButtonElement>(m, "eqp-reintentar").hidden).toBe(true);
  });
  it("«Probar de nuevo» no lanza dos cargas a la vez, y la respuesta que vale es la de esa carga", async () => {
    let llamadas = 0;
    let soltar: () => void = () => undefined;
    const m = await montar({
      leerPublico: async () => {
        llamadas++;
        if (llamadas === 1) return { ok: false, motivo: "red" };
        return new Promise((r) => {
          soltar = () => r({ ok: true, config: CONFIG("cupon"), equipos: 0 });
        }) as never;
      },
    });
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpRed")));
    const b = q<HTMLButtonElement>(m, "eqp-reintentar");
    b.click();
    b.click();
    await vi.waitFor(() => expect(llamadas).toBe(2));
    expect(b.disabled).toBe(true);
    soltar();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    expect(llamadas).toBe(2);
  });
  it("una sala cerrada, una sala sin armar y una sin red se dicen distinto", async () => {
    const m1 = await montar({ leerPublico: async () => ({ ok: false, motivo: "cerrada" }) });
    await vi.waitFor(() => expect(mensaje(m1)).toBe(t("eqpCerrada")));
    const m2 = await montar({ config: null });
    await vi.waitFor(() => expect(mensaje(m2)).toBe(t("eqpSinRegistro")));
    const m3 = await montar({ leerPublico: async () => ({ ok: false, motivo: "red" }) });
    await vi.waitFor(() => expect(mensaje(m3)).toBe(t("eqpRed")));
  });
});

describe("tu cuenta", () => {
  it("sin cuenta, lo primero es la cuenta: la que recibe el cupón y cobra el premio", async () => {
    const m = await montar();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    expect(m.raiz.querySelector("#eqp-cuenta p")?.textContent).toBe(T.es.eqpCuentaB);
    expect(q<HTMLButtonElement>(m, "eqp-google").hidden).toBe(false);
  });
  it("entrar con Google lleva al equipo", async () => {
    const g = cuenta();
    const m = await montar({ entrarConGoogle: async () => g });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    q<HTMLButtonElement>(m, "eqp-google").click();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-datos"));
    expect(q(m, "eqp-tu-cuenta").textContent).toContain(`${g.slice(0, 4)}…${g.slice(-4)}`);
  });
  it("la ventana bloqueada o cerrada se dice, y se puede volver a intentar", async () => {
    let motivo = "popup-blocked";
    const m = await montar({
      entrarConGoogle: async () => {
        throw new Error(motivo);
      },
    });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    q<HTMLButtonElement>(m, "eqp-google").click();
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpErrVentana")));
    motivo = "popup-closed";
    q<HTMLButtonElement>(m, "eqp-google").click();
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpErrCerroVentana")));
    motivo = "otra";
    q<HTMLButtonElement>(m, "eqp-google").click();
    await vi.waitFor(() => expect(mensaje(m)).toBe(t("eqpErrGoogle")));
    expect(q<HTMLButtonElement>(m, "eqp-google").disabled).toBe(false);
  });
  it("sin Google en este sitio, solo queda pegar la cuenta", async () => {
    const m = await montar({ hayGoogle: false });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    expect(q<HTMLButtonElement>(m, "eqp-google").hidden).toBe(true);
  });
  it("una cuenta de Stellar pegada: la mala se rechaza y la buena sigue", async () => {
    const g = cuenta();
    const m = await montar();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-cuenta"));
    q<HTMLButtonElement>(m, "eqp-otra").click();
    expect(q(m, "eqp-form-cuenta").hidden).toBe(false);
    escribir(m, "eqp-g", "GMALA");
    q<HTMLFormElement>(m, "eqp-form-cuenta").requestSubmit();
    expect(mensaje(m)).toBe(t("eqpErrCuenta"));
    // Con la forma de una cuenta pero la última letra cambiada: se dice que está mal copiada.
    escribir(m, "eqp-g", `${g.slice(0, 55)}${g[55] === "A" ? "B" : "A"}`);
    q<HTMLFormElement>(m, "eqp-form-cuenta").requestSubmit();
    expect(mensaje(m)).toBe(t("eqpErrCuentaCopiada"));
    expect(vista(m)).toBe("eqp-cuenta");
    escribir(m, "eqp-g", ` ${g} `);
    q<HTMLFormElement>(m, "eqp-form-cuenta").requestSubmit();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-datos"));
  });
  it("una cuenta que el navegador ya recuerda salta ese paso", async () => {
    const m = await montar({ cuentaRecordada: async () => cuenta() });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-datos"));
  });
});

describe("anotar al equipo", () => {
  async function hastaElFormulario(o: Parameters<typeof montar>[0] = {}): Promise<{ m: Mundo; g: string }> {
    const g = cuenta();
    const m = await montar({ cuentaRecordada: async () => g, ...o });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-datos"));
    return { m, g };
  }

  it("el botón dice 'Anotar al equipo' en el modo de reserva y 'Pedir participar' con sorteo propio", async () => {
    expect(q((await hastaElFormulario({ modo: "cupon" })).m, "eqp-enviar").textContent).toBe(t("eqpAnotar"));
    expect(q((await hastaElFormulario({ modo: "sorteo" })).m, "eqp-enviar").textContent).toBe(t("eqpPedir"));
  });

  it("la cuenta viaja en claro y los nombres cifrados con la clave del QR: la sala no los puede leer", async () => {
    const { m, g } = await hastaElFormulario({ modo: "cupon" });
    await llenar(m);
    await vi.waitFor(() => expect(m.altas).toHaveLength(1));
    const alta = m.altas[0] as { cuenta: string; d: string };
    expect(alta.cuenta).toBe(g);
    expect(alta.d).not.toMatch(/Cóndores|Ana|Beto/);
    expect(await descifrarEquipo(SALA.clave, alta.d)).toEqual({ nombre: "Los Cóndores", integrantes: ["Ana", "Beto", "Carla"] });
    expect(await descifrarEquipo(generarClave(), alta.d)).toBeNull();
  });

  it("modo de reserva: 'Tu equipo quedó anotado. Tu cupón llega a tu cuenta cuando quien organiza los reparta'", async () => {
    const { m } = await hastaElFormulario({ modo: "cupon" });
    await llenar(m);
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-estado"));
    expect(q(m, "eqp-estado-t").textContent).toBe("Tu equipo quedó anotado");
    expect(q(m, "eqp-estado-b").textContent).toBe("Tu cupón llega a tu cuenta cuando quien organiza los reparta.");
    expect(q<HTMLButtonElement>(m, "eqp-sorteo").hidden).toBe(true);
  });

  it("el título acompaña el punto del equipo: anotado y con cupón", async () => {
    const { m } = await hastaElFormulario({ modo: "cupon" });
    expect(m.raiz.querySelector("h1")?.textContent).toBe(t("eqpTitulo"));
    await llenar(m);
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-estado"));
    expect(m.raiz.querySelector("h1")?.textContent).toBe(t("eqpListo"));
    m.sala.estado = "cupon";
    m.reloj.f();
    await vi.waitFor(() => expect(m.raiz.querySelector("h1")?.textContent).toBe(t("eqpCuponT")));
  });

  it("con sorteo propio queda como solicitud: 'Pedimos participar'", async () => {
    const { m } = await hastaElFormulario({ modo: "sorteo" });
    await llenar(m);
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-estado"));
    expect(q(m, "eqp-estado-t").textContent).toBe(t("eqpSolicitud"));
    expect(q<HTMLButtonElement>(m, "eqp-sorteo").hidden).toBe(true);
  });

  it("pide un nombre, al menos dos integrantes y nada de enlaces; no manda nada hasta que esté bien", async () => {
    const { m } = await hastaElFormulario();
    await llenar(m, " ", ["Ana", "Beto"]);
    expect(mensaje(m)).toBe(t("eqpErrNombre"));
    await llenar(m, "Equipo", ["Ana"]);
    expect(mensaje(m)).toBe(t("eqpErrPocos"));
    await llenar(m, "Equipo", ["Ana", "ana", " "]);
    expect(mensaje(m)).toBe(t("eqpErrPocos"));
    await llenar(m, "Mirá tinkazo.app", ["Ana", "Beto"]);
    expect(mensaje(m)).toBe(t("eqpErrEnlace"));
    await llenar(m, "x".repeat(40), ["y".repeat(31), "Beto"]);
    expect(mensaje(m)).toBe(t("eqpErrLargo"));
    expect(m.altas).toEqual([]);
  });

  it("lo que contesta la sala se traduce", async () => {
    for (const [motivo, clave] of [
      ["cerrada", "eqpCerrada"],
      ["sin-registro", "eqpSinRegistro"],
      ["llena", "eqpErrLlena"],
      ["rapido", "eqpErrRapido"],
      ["red", "eqpRed"],
      ["forma", "eqpErrOtro"],
    ] as const) {
      const { m } = await hastaElFormulario({ anotar: async () => ({ ok: false, motivo }) });
      await llenar(m);
      await vi.waitFor(() => expect(mensaje(m)).toBe(t(clave)));
      expect(vista(m)).toBe("eqp-datos");
      expect(q<HTMLButtonElement>(m, "eqp-enviar").disabled).toBe(false);
    }
  });

  it("manda la llave de este celular, y al recargar la página corrige los datos con la misma", async () => {
    const { m, g } = await hastaElFormulario({ modo: "cupon" });
    await llenar(m);
    await vi.waitFor(() => expect(m.altas).toHaveLength(1));
    const llave = m.altas[0]?.llave;
    expect(llave).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    const otra = await montar({ cuentaRecordada: async () => g, modo: "cupon", estado: "aceptado", local: m.deps.local });
    await vi.waitFor(() => expect(vista(otra)).toBe("eqp-estado"));
    q<HTMLButtonElement>(otra, "eqp-cambiar").click();
    await llenar(otra, "Los Cóndores Andinos");
    await vi.waitFor(() => expect(otra.altas).toHaveLength(1));
    expect(otra.altas[0]?.llave).toBe(llave);
  });

  it("si la cuenta ya está anotada desde otro celular, lo dice en llano; y el tope de la red también", async () => {
    for (const [motivo, clave] of [
      ["ajena", "eqpErrAjena"],
      ["cupo-conexion", "eqpErrCupoConexion"],
    ] as const) {
      const { m } = await hastaElFormulario({ anotar: async () => ({ ok: false, motivo }) });
      await llenar(m);
      await vi.waitFor(() => expect(mensaje(m)).toBe(t(clave)));
      expect(vista(m)).toBe("eqp-datos");
      expect(q<HTMLButtonElement>(m, "eqp-enviar").disabled).toBe(false);
    }
    expect(T.es.eqpErrAjena).toBe("Esta cuenta ya está anotada desde otro celular. Pedile a quien organiza que la quite de la lista y volvé a anotarte.");
  });

  it("si la sala ya conoce a este equipo (por ejemplo, desde otro celular), va directo al estado", async () => {
    const g = cuenta();
    const m = await montar({ cuentaRecordada: async () => g, estado: "aceptado", modo: "sorteo" });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-estado"));
    expect(q(m, "eqp-estado-t").textContent).toBe(t("eqpAceptadoT"));
  });
});

describe("el camino con sorteo propio", () => {
  async function anotado(): Promise<{ m: Mundo; g: string }> {
    const g = cuenta();
    const m = await montar({ cuentaRecordada: async () => g, modo: "sorteo" });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-datos"));
    await llenar(m);
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-estado"));
    return { m, g };
  }

  it("cuando lo aceptan: 'Hacé tu primer sorteo con Tinkazo' y 'Para entrar al sorteo del stand, tu equipo hace primero un sorteo con Tinkazo. Es gratis.'", async () => {
    const { m } = await anotado();
    m.sala.estado = "aceptado";
    m.reloj.f();
    await vi.waitFor(() => expect(q(m, "eqp-estado-t").textContent).toBe("Hacé tu primer sorteo con Tinkazo"));
    expect(q(m, "eqp-estado-b").textContent).toBe("Para entrar al sorteo del stand, tu equipo hace primero un sorteo con Tinkazo. Es gratis.");
    expect(q<HTMLButtonElement>(m, "eqp-sorteo").hidden).toBe(false);
    expect(q<HTMLButtonElement>(m, "eqp-sorteo").textContent).toBe(t("eqpHacerSorteo"));
  });

  it("el botón deja la lista con los integrantes y el premio '¿Quién presenta primero?' (editable) y abre el sorteo", async () => {
    const { m } = await anotado();
    m.sala.estado = "aceptado";
    m.reloj.f();
    await vi.waitFor(() => expect(q<HTMLButtonElement>(m, "eqp-sorteo").hidden).toBe(false));
    q<HTMLButtonElement>(m, "eqp-sorteo").click();
    expect(JSON.parse(m.deps.sesion.getItem("tinkazo.borrador") ?? "{}")).toEqual({ texto: "Ana\nBeto\nCarla", premio: "¿Quién presenta primero?", nw: "1" });
    expect(m.deps.sesion.getItem("tinkazo.abrir")).toBe("app");
    expect(m.fuera.destino).toBe("/#sortear");
  });

  it("al volver con su sorteo ya sellado en este navegador: 'Listo: tu equipo ya sorteó', con el enlace a su comprobante", async () => {
    const { m, g } = await anotado();
    m.sala.estado = "aceptado";
    m.deps.local.setItem(
      "tinkazo.history.testnet",
      JSON.stringify([{ organizer: g, id: "7", sealedAt: 100, proof: "https://tinkazo.app/verificar.html#abc" }]),
    );
    m.reloj.f();
    await vi.waitFor(() => expect(q(m, "eqp-estado-t").textContent).toBe("Listo: tu equipo ya sorteó"));
    const enlace = q<HTMLAnchorElement>(m, "eqp-comprobante");
    expect(enlace.hidden).toBe(false);
    expect(enlace.getAttribute("href")).toBe("https://tinkazo.app/verificar.html#abc");
    expect(q<HTMLButtonElement>(m, "eqp-sorteo").hidden).toBe(true);
  });

  it("cuando quien organiza lo marca como 'ya sorteó' sin comprobante local, el enlace lleva a Mis sorteos", async () => {
    const { m } = await anotado();
    m.sala.estado = "sorteo";
    m.reloj.f();
    await vi.waitFor(() => expect(q(m, "eqp-estado-t").textContent).toBe(t("eqpSorteoT")));
    expect(q<HTMLAnchorElement>(m, "eqp-comprobante").getAttribute("href")).toBe("/#mis-sorteos");
  });

  it("cuando llega el cupón: 'Tu cupón llegó' y deja de preguntar", async () => {
    const { m } = await anotado();
    m.sala.estado = "cupon";
    m.reloj.f();
    await vi.waitFor(() => expect(q(m, "eqp-estado-t").textContent).toBe(t("eqpCuponT")));
    expect(m.reloj.parado).toBe(true);
  });

  it("si quien organiza lo quitó de la lista, lo dice y deja anotarlo otra vez", async () => {
    const { m } = await anotado();
    m.sala.estado = null;
    m.reloj.f();
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-datos"));
    expect(mensaje(m)).toBe(t("eqpQuitado"));
  });

  it("no pregunta con la página en segundo plano, y un corte de red no cambia lo que se ve", async () => {
    const { m } = await anotado();
    m.sala.estado = "red";
    m.reloj.f();
    await espera();
    expect(q(m, "eqp-estado-t").textContent).toBe(t("eqpSolicitud"));
    expect(PREGUNTAR_CADA_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("'Cambiar los nombres del equipo' vuelve al formulario con lo que se había escrito", async () => {
    const { m } = await anotado();
    q<HTMLButtonElement>(m, "eqp-cambiar").click();
    expect(vista(m)).toBe("eqp-datos");
    expect(q<HTMLInputElement>(m, "eqp-nombre").value).toBe("Los Cóndores");
    expect(q<HTMLInputElement>(m, "eqp-i2").value).toBe("Carla");
  });

  it("'Cambiar los nombres' trae lo guardado aunque la página se haya recargado en el medio", async () => {
    const g = cuenta();
    const m = await montar({ cuentaRecordada: async () => g, estado: "aceptado", modo: "cupon" });
    await vi.waitFor(() => expect(vista(m)).toBe("eqp-estado"));
    // Al entrar directo al estado no hay nada en memoria: lo que vale es lo que este celular guardó.
    guardarEquipoLocal({ nombre: "Los Cóndores", integrantes: ["Ana", "Beto", "Carla"], cuenta: g, sala: SALA.id }, m.deps.local);
    q<HTMLButtonElement>(m, "eqp-cambiar").click();
    expect(vista(m)).toBe("eqp-datos");
    expect(q<HTMLInputElement>(m, "eqp-nombre").value).toBe("Los Cóndores");
    expect(q<HTMLInputElement>(m, "eqp-i2").value).toBe("Carla");
  });
});

const espera = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
