import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cifrarEquipo } from "../equipos/datos";
import { campanaDeEjemplo } from "../campana/ejemplo";
import { Keypair } from "@stellar/stellar-sdk";
import {
  BASE_LOCAL,
  firmarParaLaPrueba,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type SalaDeCampana as SalaDelMundo,
} from "../sala/mundo-sala";
import {
  crearStandDeCampana,
  CLAVE_DEL_STAND,
  leerEnlaceDelStand,
  type AvisoDelStand,
  type DatosDelProyector,
  type DepsDelStandDeCampana,
  type EstadoDeSaldo,
} from "./stand-campana";
import { TEXTOS_STAND_CAMPANA } from "./stand-campana-textos";

/**
 * El stand de campaña contra el servicio de la sala entero, en Node (`mundo-sala.ts`): abrir con y sin depósito,
 * con otra billetera, recargar sin perder la clave, quitar con motivo y cerrar. Una diferencia entre lo que el
 * stand manda y lo que el servicio entiende rompe una prueba acá y no el día del evento.
 */

vi.mock("cloudflare:workers", async () => await import("../sala/cloudflare-falso"));

const AHORA = Date.UTC(2026, 10, 21, 18, 0);
const ID = "AbCd1234";

let mundo: MundoDeSala;
let sala: SalaDelMundo;
let pedidos: string[];

/** El `fetch` del navegador, llevado al servicio: los pedidos quedan anotados para comprobar que no se mandan. */
function fetchDelServicio(): typeof fetch {
  return async (url, init) => {
    const u = new URL(String(url));
    const cuerpo = typeof init?.body === "string" ? init.body : undefined;
    pedidos.push(`${init?.method ?? "GET"} ${u.pathname}${u.search}`);
    const cabeceras = new Headers(init?.headers ?? undefined);
    return mundo.pedir(`${u.pathname}${u.search}`, {
      metodo: init?.method ?? "GET",
      ...(cuerpo === undefined ? {} : { cuerpo: JSON.parse(cuerpo) as unknown }),
      // La IP es la conexión desde donde llega, como en el navegador de la feria.
      cabeceras: { "CF-Connecting-IP": "190.129.10.20", Authorization: cabeceras.get("Authorization") ?? "", "Content-Type": cabeceras.get("Content-Type") ?? "" },
      base: u.origin,
    });
  };
}

interface MundoDePrueba {
  /** Sin pantalla en estas pruebas: el mundo del stand es el modelo, y el DOM se prueba en la suya. */
  raiz: null;
  aviso: () => AvisoDelStand;
  disparar: (ms: number) => Promise<void>;
  mover: (ms: number) => void;
  pedidosLeidos: () => string[];
  almacen: Storage;
  ponerSaldo: (e: EstadoDeSaldo) => void;
  ponerCuenta: (cuenta: string | null) => void;
}

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });

async function abrirSala(organizadora: string): Promise<SalaDelMundo> {
  const campana = campanaDeEjemplo(AHORA) as unknown as Record<string, unknown>;
  const archivo = {
    ...campana,
    evento: "feria-del-libro",
    premios: (campana.premios as bigint[]).map(String),
    abre_ms: campana.abreMs,
    cierra_ms: campana.cierraMs,
    sorteo_ms: campana.sorteoMs,
    recibir_hasta_ms: campana.recibirHastaMs,
    organizadora,
  };
  const r = await mundo.pedir("/v1/campana", { cuerpo: firmarParaLaPrueba(mundo.llavePrivada, archivo) });
  if (r.status !== 201) throw new Error(`la campaña de prueba no se creó: ${r.status}`);
  const s = (await r.json()) as SalaDelMundo;
  const abierta = await mundo.pedir(`/v1/sala/${s.id}/campana/fase`, {
    metodo: "PUT",
    cuerpo: { fase: "abierta" },
    cabeceras: { Authorization: `Bearer ${s.token}` },
  });
  if (abierta.status !== 204) throw new Error(`la campaña de prueba no abrió: ${abierta.status}`);
  return s;
}

/** El servidor simulado con la sala abierta y el stand montado encima. */
async function preparar(
  opciones: { cuenta?: string | null; saldo?: EstadoDeSaldo; claveRecargada?: string } = {},
): Promise<MundoDePrueba> {
  const operadora = Keypair.random().publicKey();
  mundo = await montarMundo();
  sala = await abrirSala(operadora);
  pedidos = [];
  const almacen = clavesDePrueba();
  if (opciones.claveRecargada) almacen.setItem(CLAVE_DEL_STAND(sala.id), opciones.claveRecargada);
  let aviso: AvisoDelStand = { vista: "chequeando" };
  const cadaDe = new Map<number, Set<() => void>>();
  const deps: DepsDelStandDeCampana = {
    ahora: () => Date.now(),
    cada: (fn, ms) => {
      const lista = cadaDe.get(ms) ?? new Set<() => void>();
      lista.add(fn);
      cadaDe.set(ms, lista);
      return () => lista.delete(fn);
    },
    fetch: fetchDelServicio(),
    qr: async (img, enlace) => void (img.alt = enlace),
    cuenta: () => opciones.cuenta === undefined ? operadora : opciones.cuenta,
    saldo: async () => opciones.saldo ?? { tipo: "ok", saldo: 10_000_000_000n },
    idioma: () => "es",
    tx: (c) => TEXTOS_STAND_CAMPANA.es[c] ?? "",
    almacen,
    origen: () => "https://tinkazo.app",
    servicio: BASE_LOCAL,
    notificar: (a) => void (aviso = a),
  };
  crearStandDeCampana(leerEnlaceDelStand(`?c=feria-del-libro&s=${sala.id}`, `#${sala.token}`)!, deps);
  const disparar = async (ms: number): Promise<void> => {
    for (const fn of [...(cadaDe.get(ms) ?? [])]) fn();
    // El Worker contesta en macrotareas (el SQLite y sus avisos): el reloj de verdad de los timers sigue.
    for (let vuelta = 0; vuelta < 20; vuelta += 1) await new Promise<void>((r) => setTimeout(r, 0));
  };
  await disparar(1000);
  await disparar(5000);
  return {
    raiz: null,
    aviso: () => aviso,
    disparar,
    mover: (ms: number): void => void vi.setSystemTime(Date.now() + ms),
    pedidosLeidos: () => pedidos,
    almacen,
    ponerSaldo: (e) => void (opciones.saldo = e),
    ponerCuenta: (c) => void (opciones.cuenta = c),
  };
}

/** El aviso abierto con sus datos, o un error que dice lo que había. */
function abiertaDe(m: MundoDePrueba): { vista: "abierta"; datos: DatosDelProyector } {
  const aviso = m.aviso();
  if (aviso.vista !== "abierta") throw new Error(`no abrió: ${JSON.stringify(aviso)}`);
  return aviso;
}

function clavesDePrueba(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: () => null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  } as Storage;
}

/** Una persona anotada, como la manda su celular con la clave del QR del stand; el número sale de la lista con el token. */
async function anotarPersona(clave: string, nombre: string): Promise<{ cuenta: string; n: number }> {
  const persona = personaDePrueba(mundo, Math.floor(Math.random() * 1_000_000));
  const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/alta`, {
    cuerpo: { token: persona.token, d: await cifrarEquipo(clave, { nombre, integrantes: [] }), llave: persona.llave },
    cabeceras: { "CF-Connecting-IP": "190.129.10.20" },
  });
  if (r.status !== 201) throw new Error(`no se anotó: ${r.status}`);
  await r.json();
  const lista = await mundo.pedir(`/v1/sala/${sala.id}/equipos?desde=0`, { cabeceras: { Authorization: `Bearer ${sala.token}` } });
  const filas = (await lista.json()) as { n: number; cuenta: string; d: string; estado: string; v: number }[];
  const mia = filas.find((f) => f.cuenta === persona.cuenta);
  if (!mia) throw new Error(`su fila no está: ${JSON.stringify(filas).slice(0, 200)}`);
  return { cuenta: persona.cuenta, n: mia.n };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.clearAllTimers();
});

describe("abrir el stand con el servidor de la sala", () => {
  it("abre con el depósito hecho y la billetera del operador; el QR sale con su pase y su clave", async () => {
    const m = await preparar();
    if (m.aviso().vista !== "abierta") expect.fail(`DEBUG ${JSON.stringify(m.aviso())} pedidos=${JSON.stringify(m.pedidosLeidos())}`);
    expect(m.aviso().vista).toBe("abierta");
    expect(m.almacen.getItem(CLAVE_DEL_STAND(sala.id))).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    const datos = abiertaDe(m).datos;
    const enlace = new URL(datos.enlace ?? "");
    expect(enlace.searchParams.get("c")).toBe("feria-del-libro");
    expect(enlace.searchParams.get("s")).toBe(sala.id);
    expect(enlace.searchParams.get("p")).toMatch(/^[A-Za-z0-9_-]{12}$/u);
    expect(enlace.hash.slice(1)).toBe(m.almacen.getItem(CLAVE_DEL_STAND(sala.id)));
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/estado?p=${enlace.searchParams.get("p")}`);
    expect(r.status).toBe(200);
  });

  it("sin depósito, lo dice y el QR no sale: nada se manda a la sala", async () => {
    const m = await preparar({ saldo: { tipo: "ok", saldo: 3n * 10_000_000n } });
    expect(m.aviso()).toEqual({ vista: "fallo", texto: "El premio no está depositado. Faltan 37 dólares digitales." });
    // Un fallo no lleva datos: sin QR, sin lista.
    expect("datos" in (m.aviso() as object)).toBe(false);
    expect(m.pedidosLeidos().join("\n")).not.toContain("/campana/pase");
    expect(m.pedidosLeidos().join("\n")).not.toContain("/equipos");
  });

  it("con otra billetera, lo dice con el final de la cuenta esperada y no abre", async () => {
    const m = await preparar({ cuenta: Keypair.random().publicKey() });
    const aviso = m.aviso();
    expect(aviso.vista).toBe("fallo");
    const fin = (aviso as { texto: string }).texto;
    expect(fin.startsWith("La billetera no es la del operador (…")).toBe(true);
    expect(m.pedidosLeidos().join("\n")).not.toContain("/campana/pase");
  });

  it("recargar sin perder la clave: otro stand en el mismo navegador usa la misma clave", async () => {
    const primera = await preparar();
    const guardada = primera.almacen.getItem(CLAVE_DEL_STAND(sala.id));
    expect(guardada).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    // La recarga: el mismo navegador y el mismo enlace de la dirección, un stand nuevo.
    const segunda = await preparar({ claveRecargada: guardada ?? undefined });
    const datos = abiertaDe(segunda).datos;
    expect(new URL(datos.enlace ?? "").hash).toBe(`#${guardada}`);
  });

  it("la lista que llega se descifra; quitar con su motivo y cerrar dejan la sala como se espera", async () => {
    const m = await preparar();
    const datos0 = abiertaDe(m).datos;
    const claveDelQr = datos0?.enlace ? new URL(datos0.enlace).hash.slice(1) : "";
    expect(claveDelQr).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    const a = await anotarPersona(claveDelQr, "Ana");
    const b = await anotarPersona(claveDelQr, "Beto");
    await m.disparar(5000);
    const datos = abiertaDe(m).datos;
    expect(datos.filas.map((f) => [f.n, f.nombre])).toEqual([[a.n, "Ana"], [b.n, "Beto"]]);
    expect(datos.van).toBe("2 personas van");
    // Quitar con su motivo: la sala lo guarda y la lista se ajusta.
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/quitar`, {
      metodo: "POST",
      cuerpo: { n: b.n, motivo: "pidio" },
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
    expect(r.status).toBe(204);
    await m.disparar(5000);
    const datos2 = abiertaDe(m).datos;
    expect(datos2.filas.map((f) => f.nombre)).toEqual(["Ana"]);
    expect(datos2.van).toBe("Una persona va");
    // Cerrar: la fase queda cerrada y el QR deja de salir.
    const r2 = await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo: { fase: "cerrada" },
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
    expect(r2.status).toBe(204);
    await m.disparar(5000);
    const datos3 = abiertaDe(m).datos;
    expect(datos3.cerrado).toBe(true);
    expect(datos3.enlace).toBeNull();
  });
});

describe("la sesión cerrada de la sala rechaza altas después", () => {
  it("con la inscripción cerrada, el celular ya no se anota", async () => {
    const m = await preparar();
    const datos = abiertaDe(m).datos;
    const claveDelQr = new URL(datos.enlace ?? "").hash.slice(1);
    await mundo.pedir(`/v1/sala/${sala.id}/campana/fase`, {
      metodo: "PUT",
      cuerpo: { fase: "cerrada" },
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    });
    const persona = personaDePrueba(mundo, 42);
    const r = await mundo.pedir(`/v1/sala/${sala.id}/campana/alta`, {
      cuerpo: { token: persona.token, d: await cifrarEquipo(claveDelQr, { nombre: "Tarde", integrantes: [] }), llave: persona.llave },
      cabeceras: { "CF-Connecting-IP": "190.129.10.20" },
    });
    // Cerrada la inscripción, la sala rechaza el alta con su motivo.
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
