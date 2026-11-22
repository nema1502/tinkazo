import { describe, expect, it } from "vitest";
import { DOLAR } from "../campana/comision";
import { campanaDeEjemplo } from "../campana/ejemplo";
import { cifrarEquipo } from "../equipos/datos";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { fetchFalso, type Llamada, type Paso } from "../sala/fetch-falso";
import {
  CLAVE_DEL_STAND,
  crearStandDeCampana,
  filasDelStand,
  leerEnlaceDelStand,
  type AvisoDelStand,
  type DatosDelProyector,
  type DepsDelStandDeCampana,
  type EnlaceDelStand,
  type EstadoDeSaldo,
} from "./stand-campana";
import { TEXTOS_STAND_CAMPANA } from "./stand-campana-textos";

/**
 * El modelo del stand de una campaña, con el servicio de mentira (`fetch-falso`): abrir con sus comprobaciones,
 * la clave del QR que sobrevive a una recarga, el pase que rota con su ventana de dos minutos, la lista que se
 * lee cada 5 segundos y se descifra, quitar con motivo y cerrar. Los textos que se comparan están escritos a
 * mano: son lo que lee la persona.
 */

const AHORA = Date.UTC(2026, 10, 21, 18, 0);
const CUENTA = cuentaDePrueba(1);
const OTRA_CUENTA = cuentaDePrueba(2);
const TOKEN = "T".repeat(22);
const SERVICIO = "https://s.tinkazo.app";
const CLAVE_STAND = "c".repeat(22);
const ID = "AbCd1234";
const ENLACE: EnlaceDelStand = { evento: "evento-uno", sala: ID, token: TOKEN };

const json = (cuerpo: unknown, estado = 200): Paso => ({ estado, cuerpo });
const vacia = (estado: number): Paso => ({ estado });

/** El archivo firmado que la sala guarda, en la forma completa que el sitio sabe leer. */
function archivoDe(cambios: Record<string, unknown> = {}): string {
  const c = campanaDeEjemplo(AHORA) as unknown as Record<string, unknown>;
  return JSON.stringify({
    ...c,
    evento: "evento-uno",
    premios: (c.premios as bigint[]).map(String),
    abre_ms: c.abreMs,
    cierra_ms: c.cierraMs,
    sorteo_ms: c.sorteoMs,
    recibir_hasta_ms: c.recibirHastaMs,
    organizadora: CUENTA,
    ...cambios,
  });
}

const respuestaDeCampana = (texto: string): Paso => ({ estado: 200, cuerpo: { texto, firma: "F".repeat(86) } });
const estadoDe = (fase: string, total: number): Paso => ({
  estado: 200,
  cuerpo: { fase, total, cierraMs: AHORA + 3_600_000, quitadas: { repetida: 0, evento: 0, pidio: 0, otro: 0 } },
});
const filaDe = (n: number, v: number, d: string): Record<string, unknown> => ({ n, cuenta: cuentaDePrueba(n), d, estado: "aceptado", v });
const paseDe = (p: string, hasta: number): Paso => ({ estado: 200, cuerpo: { p, hasta } });
/** Respuestas fijas por ruta, para las 204 (sin cuerpo), que el constructor de Response tira con guion. */
function fetchConFijas(
  base: typeof fetch,
  fijas: Record<string, Response>,
  anotadas: Llamada[],
): typeof fetch {
  return async (url, init) => {
    const dirección = String(url);
    const fija = fijas[dirección.replace(`${SERVICIO}/v1/sala/${ID}`, "")];
    if (!fija) return base(dirección, init);
    anotadas.push({
      url: dirección,
      init: init ?? {},
      ruta: new URL(dirección).pathname.split("/").pop() ?? "",
      en: 0,
    });
    return fija.clone();
  };
}
/** Respuestas sin cuerpo (204): el guion de mentira no las puede armar, porque el constructor de Response las tira. */
const SIN_CUERPO = (estado: number): Response => new Response(null, { status: estado });
const cifradoPara = (nombre: string): Promise<string> => cifrarEquipo(CLAVE_STAND, { nombre, integrantes: [] });

/** Lleva las esperas de la red y del descifrado: micro y macrotareas, con el reloj de verdad de los timers. */
async function asentar(): Promise<void> {
  for (let vuelta = 0; vuelta < 20; vuelta += 1) await new Promise<void>((r) => setTimeout(r, 0));
}

interface Mundo {
  tiempo: () => number;
  llamadas: Llamada[];
  avisos: AvisoDelStand[];
  almacen: Storage;
  mover: (ms: number) => void;
  disparar: (ms: number) => Promise<void>;
  ponerSaldo: (estado: EstadoDeSaldo) => void;
  ponerCuenta: (cuenta: string | null) => void;
}

/** Arma el stand con su guion de la sala, su cuenta de billetera y su saldo de mentira. */
async function crear(
  guion: Record<string, Paso[]>,
  extras: Partial<DepsDelStandDeCampana> = {},
  opciones: { enlace?: EnlaceDelStand; cuenta?: string | null; saldo?: EstadoDeSaldo; idioma?: "es" | "en"; fijas?: Record<string, Response> } = {},
): Promise<{ mundo: Mundo; stand: ReturnType<typeof crearStandDeCampana> }> {
  const f = fetchFalso(guion);
  let base = f.f;
  if (opciones.fijas) base = fetchConFijas(f.f, opciones.fijas, f.llamadas);
  let tiempo = AHORA;
  let saldo: EstadoDeSaldo = opciones.saldo ?? { tipo: "ok", saldo: 2_000_000_000n };
  let cuenta: string | null = opciones.cuenta === undefined ? CUENTA : opciones.cuenta;
  let idioma: "es" | "en" = opciones.idioma ?? "es";
  const almacen = crearAlmacen();
  almacen.setItem(CLAVE_DEL_STAND(ID), CLAVE_STAND);
  const cadaDe = new Map<number, Set<() => void>>();
  const avisos: AvisoDelStand[] = [];
  const deps: DepsDelStandDeCampana = {
    ahora: () => tiempo,
    cada: (fn, ms) => {
      const lista = cadaDe.get(ms) ?? new Set<() => void>();
      lista.add(fn);
      cadaDe.set(ms, lista);
      return () => lista.delete(fn);
    },
    fetch: base,
    qr: async () => undefined,
    cuenta: () => cuenta,
    saldo: async () => saldo,
    idioma: () => idioma,
    tx: (clave) => TEXTOS_STAND_CAMPANA[idioma][clave] ?? "",
    almacen,
    origen: () => "https://tinkazo.app",
    servicio: SERVICIO,
    notificar: (aviso) => avisos.push(aviso),
    ...extras,
  };
  const stand = crearStandDeCampana(opciones.enlace ?? ENLACE, deps);
  return {
    stand,
    mundo: {
      tiempo: () => tiempo,
      llamadas: f.llamadas,
      avisos,
      almacen,
      mover: (ms) => void (tiempo += ms),
      disparar: async (ms) => {
        for (const fn of [...(cadaDe.get(ms) ?? [])]) fn();
        await asentar();
      },
      ponerSaldo: (e) => void (saldo = e),
      ponerCuenta: (c) => void (cuenta = c),
    },
  };
}

function crearAlmacen(): Storage {
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

/** El último aviso del stand. */
function ultimo(mundo: Mundo): AvisoDelStand {
  const aviso = mundo.avisos[mundo.avisos.length - 1];
  if (aviso === undefined) throw new Error("no avisó nada");
  return aviso;
}

/** El texto de un aviso de fallo. */
function textoDe(aviso: AvisoDelStand): string {
  if (aviso.vista !== "fallo") throw new Error(`no es un fallo: ${JSON.stringify(aviso)}`);
  return aviso.texto;
}

function datosDe(aviso: AvisoDelStand): { vista: "abierta"; datos: DatosDelProyector } {
  if (aviso.vista !== "abierta") throw new Error(`no está abierta: ${JSON.stringify(aviso)}`);
  return aviso;
}

const ruta = (l: Llamada): string => l.url.replace(`${SERVICIO}/v1/sala/${ID}`, "");
const conCuerpo = (l: Llamada): Record<string, unknown> => JSON.parse(String(l.init.body)) as Record<string, unknown>;
const enlaceDe = (aviso: AvisoDelStand): string | null => (aviso.vista === "abierta" ? aviso.datos.enlace : null);

describe("el enlace del stand", () => {
  it("trae el evento, la sala y el token del stand después del #", () => {
    expect(leerEnlaceDelStand("?c=evento-uno&s=AbCd1234", `#${TOKEN}`)).toEqual(ENLACE);
  });
  it("sin el evento, con una sala rara o con un token que no vale, no hay stand", () => {
    expect(leerEnlaceDelStand("?s=AbCd1234", `#${TOKEN}`)).toBeNull();
    expect(leerEnlaceDelStand("?c=evento-uno&s=exacto", `#${TOKEN}`)).toBeNull();
    expect(leerEnlaceDelStand("?c=evento-uno&s=AbCd1234", "#corto")).toBeNull();
  });
});

describe("abrir el stand", () => {
  it("con el premio depositado y la billetera del operador abre: guarda la clave y avisa", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    await asentar();
    const aviso = ultimo(mundo);
    if (aviso.vista !== "abierta") throw new Error(`falló: ${JSON.stringify(aviso)}`);
    expect(aviso.vista).toBe("abierta");
  });

  it("reusa la clave que ya estaba guardada en ese navegador, como en una recarga", async () => {
    const { stand } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    await asentar();
    expect(stand.clave()).toBe(CLAVE_STAND);
    const { stand: retomado } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    await asentar();
    expect(retomado.clave()).toBe(CLAVE_STAND);
  });

  it("sin depósito dice cuánto falta y no abre", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    mundo.ponerSaldo({ tipo: "ok", saldo: 3n * DOLAR });
    await asentar();
    expect(ultimo(mundo)).toEqual({ vista: "fallo", texto: "El premio no está depositado. Faltan 37 dólares digitales." });
    // No pidió pase: sin abrir no hay código.
    expect(mundo.llamadas.map(ruta)).toEqual(["/campana", "/campana"]);
  });

  it("con una cuenta que todavía no existe en la red, lo dice y no abre", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    mundo.ponerSaldo({ tipo: "sin-cuenta" });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("La cuenta de quien organizó todavía no existe en la red.");
  });

  it("sin la línea de dólares digitales, lo dice y no abre", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    mundo.ponerSaldo({ tipo: "sin-linea" });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("La cuenta de quien organizó todavía no puede recibir dólares digitales.");
  });

  it("con la red caída, lo dice y no abre", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] });
    mundo.ponerSaldo({ tipo: "sin-red" });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("Sin conexión con la red. Probá otra vez.");
  });

  it("sin billetera conectada, lo dice y no abre", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] }, {}, { cuenta: null });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("No está la billetera del operador. Conectala y abrí de nuevo.");
    expect(mundo.llamadas.map(ruta)).toEqual(["/campana", "/campana"]);
  });

  it("con otra billetera, lo dice con el final de la cuenta que esperaba y no abre", async () => {
    const { mundo } = await crear({ campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] }, {}, { cuenta: OTRA_CUENTA });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe(`La billetera no es la del operador (…${CUENTA.slice(-4)}).`);
  });

  it("una campaña que no nombra a quien organizó no abre y lo dice", async () => {
    const { mundo } = await crear({
      campana: [respuestaDeCampana(archivoDe({ organizadora: null })), respuestaDeCampana(archivoDe({ organizadora: null }))],
    });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("La campaña no nombra la cuenta de quien organizó.");
  });

  it("el evento del enlace tiene que ser el de la sala", async () => {
    const { mundo } = await crear(
      { campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())] },
      {},
      { enlace: { evento: "otro-evento", sala: ID, token: TOKEN } },
    );
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("Este enlace no corresponde a la campaña de esta sala.");
  });

  it("una sala que no está o una red que no contesta, lo dice y no abre", async () => {
    const { mundo } = await crear({ campana: [json({ error: "no-existe" }, 404), json({ error: "no-existe" }, 404)] });
    await asentar();
    expect(textoDe(ultimo(mundo))).toBe("La sala no contestó. Probá otra vez.");
    const { mundo: sinRed } = await crear({ campana: ["corte", "corte"] });
    await asentar();
    expect(textoDe(ultimo(sinRed))).toBe("Sin conexión con la red. Probá otra vez.");
  });
});

describe("el QR con el pase que rota", () => {
  it("muestra el enlace del celular con el evento, la sala, el pase, la red y la clave después del #", async () => {
    const { mundo, stand } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      pase: [paseDe("AAAAAAAAAAAA", AHORA + 120_000)],
    });
    await asentar();
    const enlace = new URL(enlaceDe(ultimo(mundo)) ?? "");
    expect(enlace.pathname).toBe("/participar.html");
    expect(enlace.searchParams.get("c")).toBe("evento-uno");
    expect(enlace.searchParams.get("s")).toBe(ID);
    expect(enlace.searchParams.get("p")).toBe("AAAAAAAAAAAA");
    expect(enlace.searchParams.get("red")).toBe("prueba");
    expect(enlace.hash).toBe(`#${stand.clave()}`);
  });

  it("se vuelve a pintar cuando cambia el código: la ventana vence y llega un pase distinto", async () => {
    const paseRuta = [paseDe("AAAAAAAAAAAA", AHORA + 120_000)];
    const { mundo, stand } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      pase: paseRuta,
    });
    await asentar();
    const antes = enlaceDe(ultimo(mundo));
    expect(antes).toContain("p=AAAAAAAAAAAA");
    // Dentro de la ventana no se pide otro pase: el código es el mismo.
    mundo.mover(60_000);
    await mundo.disparar(1000);
    expect(mundo.llamadas.filter((l) => ruta(l) === "/campana/pase")).toHaveLength(1);
    expect(enlaceDe(ultimo(mundo))).toBe(antes);
    // La ventana vence a los dos minutos: el pase nuevo cambia el código y la clave sigue.
    mundo.mover(60_000);
    paseRuta.push(paseDe("BBBBBBBBBBBB", mundo.tiempo() + 120_000));
    await mundo.disparar(1000);
    const despues = enlaceDe(ultimo(mundo));
    expect(despues).toContain("p=BBBBBBBBBBBB");
    expect(despues).not.toBe(antes);
    expect(despues?.endsWith(`#${stand.clave()}`)).toBe(true);
  });

  it("si la sala repite el mismo pase, el código queda como estaba y no lo pide cada segundo", async () => {
    const paseRuta = [paseDe("AAAAAAAAAAAA", AHORA + 120_000)];
    const { mundo } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      pase: paseRuta,
    });
    await asentar();
    const antes = enlaceDe(ultimo(mundo));
    mundo.mover(120_000);
    paseRuta.push(paseDe("AAAAAAAAAAAA", AHORA + 120_000));
    await mundo.disparar(1000);
    expect(enlaceDe(ultimo(mundo))).toBe(antes);
    expect(mundo.llamadas.filter((l) => ruta(l) === "/campana/pase")).toHaveLength(2);
    await mundo.disparar(1000);
    expect(mundo.llamadas.filter((l) => ruta(l) === "/campana/pase")).toHaveLength(2);
  });

  it("si el pase no llega, el QR sale de la vista y vuelve cuando la sala contesta", async () => {
    const paseRuta: Paso[] = ["corte"];
    const { mundo } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      pase: paseRuta,
    });
    await asentar();
    expect(enlaceDe(ultimo(mundo))).toBeNull();
    paseRuta.push(paseDe("AAAAAAAAAAAA", AHORA + 120_000));
    mundo.mover(10_000);
    await mundo.disparar(1000);
    expect(enlaceDe(ultimo(mundo))).not.toBeNull();
  });
});

describe("la lista que se lee cada 5 segundos", () => {
  it("descifra los nombres, cuenta a todas y deja lo feo y lo repetido para revisar", async () => {
    const [dAna, dBeto, dFea, dRepetida, dRota] = await Promise.all([
      cifradoPara("Ana"),
      cifradoPara("Beto"),
      cifradoPara("Ana Puta"),
      cifradoPara("ana"),
      Promise.resolve("roto"),
    ]);
    const { mundo } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado: [estadoDe("abierta", 5)],
      // La sala devuelve la página de la vuelta y una vacía para terminar: el guion de la mentira repite el último paso.
      equipos: [json([filaDe(1, 1, dAna), filaDe(2, 2, dBeto), filaDe(3, 3, dFea), filaDe(4, 4, dRepetida), filaDe(5, 5, dRota)]), json([])],
    });
    await asentar();
    const datos = datosDe(ultimo(mundo)).datos;
    expect(datos.van).toBe("5 personas van");
    expect(datos.filas.map((f) => [f.n, f.nombre])).toEqual([[1, "Ana"], [2, "Beto"], [5, ""]]);
    expect(datos.revisar.map((f) => [f.n, f.nombre, f.revisar])).toEqual([[3, "Ana Puta", true], [4, "ana", true]]);
  });

  it("mientras no llega nadie, la lista está vacía y dice que nadie va", async () => {
    const { mundo } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado: [estadoDe("abierta", 0)],
      equipos: [json([])],
    });
    await asentar();
    const datos = datosDe(ultimo(mundo)).datos;
    expect(datos.van).toBe("Todavía no va nadie");
    expect(datos.filas).toEqual([]);
    expect(datos.revisar).toEqual([]);
  });

  it("cuando la sala no contesta, conserva lo que tenía y avisa; al volver, se arregla", async () => {
    const dAna = await cifradoPara("Ana");
    const dBeto = await cifradoPara("Beto");
    const estado: Paso[] = [estadoDe("abierta", 2), "corte", estadoDe("abierta", 1)];
    const equipos: Paso[] = [
      json([filaDe(1, 1, dAna), filaDe(2, 2, dBeto)]),
      json([]),
      json([filaDe(1, 1, dAna)]),
      json([]),
    ];
    const { mundo } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado,
      equipos,
    });
    await asentar();
    expect(datosDe(ultimo(mundo)).datos.van).toBe("2 personas van");
    mundo.mover(5000);
    await mundo.disparar(5000);
    expect(datosDe(ultimo(mundo)).datos.caido).toBe(true);
    expect(datosDe(ultimo(mundo)).datos.filas.map((f) => f.nombre)).toEqual(["Ana", "Beto"]);
    await mundo.disparar(5000);
    const despues = datosDe(ultimo(mundo)).datos;
    expect(despues.caido).toBe(false);
    expect(despues.van).toBe("Una persona va");
  });
});

describe("quitar con motivo y cerrar", () => {
  it("quitar manda el número y el motivo a la sala; la lista se ajusta con la lectura que sigue", async () => {
    const dAna = await cifradoPara("Ana");
    const dBeto = await cifradoPara("Beto");
    const estado: Paso[] = [estadoDe("abierta", 2), estadoDe("abierta", 1)];
    const equipos: Paso[] = [
      json([filaDe(1, 1, dAna), filaDe(2, 2, dBeto)]),
      json([]),
      json([filaDe(1, 1, dAna)]),
      json([]),
    ];
    const quitar: Paso[] = [vacia(204)];
    const { mundo, stand } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado,
      equipos,
    }, {}, { fijas: { "/campana/quitar": SIN_CUERPO(204) } });
    await asentar();
    expect(datosDe(ultimo(mundo)).datos.filas.map((f) => f.nombre)).toEqual(["Ana", "Beto"]);
    expect(await stand.quitar(2, "pidio")).toBe(true);
    const pedido = mundo.llamadas.find((l) => ruta(l) === "/campana/quitar");
    expect(pedido && conCuerpo(pedido)).toEqual({ n: 2, motivo: "pidio" });
    expect(pedido?.init.headers as Record<string, string>).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    // Lo que se quitó sale enseguida de la vista; el total se corrige con la lectura que sigue.
    await asentar();
    expect(datosDe(ultimo(mundo)).datos.filas.map((f) => f.nombre)).toEqual(["Ana"]);
    expect(datosDe(ultimo(mundo)).datos.van).toBe("2 personas van");
    await mundo.disparar(5000);
    expect(datosDe(ultimo(mundo)).datos.van).toBe("Una persona va");
  });

  it("si la sala no acepta la quita, la lista queda como estaba", async () => {
    const dAna = await cifradoPara("Ana");
    const estado: Paso[] = [estadoDe("abierta", 1)];
    const equipos: Paso[] = [json([filaDe(1, 1, dAna)]), json([])];
    const { mundo, stand } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado,
      equipos,
      quitar: [json({ error: "otro" }, 400)],
    });
    await asentar();
    expect(await stand.quitar(1, "otro")).toBe("rechazo");
    const datos = datosDe(ultimo(mundo)).datos;
expect(datos.filas.map((f) => f.nombre)).toEqual(["Ana"]);
    expect(datos.van).toBe("Una persona va");
  });

  it("cerrar manda la fase cerrada a la sala y el QR deja de salir", async () => {
    const dAna = await cifradoPara("Ana");
    const { mundo, stand } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado: [estadoDe("abierta", 1)],
      equipos: [json([filaDe(1, 1, dAna)]), json([])],
      pase: [paseDe("AAAAAAAAAAAA", AHORA + 120_000)],
    }, {}, { fijas: { "/campana/fase": SIN_CUERPO(204) } });
    await asentar();
    expect(enlaceDe(ultimo(mundo))).not.toBeNull();
    expect(await stand.cerrar()).toBe(true);
    const pedido = mundo.llamadas.find((l) => ruta(l) === "/campana/fase");
    expect(pedido && conCuerpo(pedido)).toEqual({ fase: "cerrada" });
    const datos = datosDe(ultimo(mundo)).datos;
    expect(datos.cerrado).toBe(true);
    expect(datos.enlace).toBeNull();
    // Cerrado, ya no se pide pase.
    const pases = mundo.llamadas.filter((l) => ruta(l) === "/campana/pase").length;
    mundo.mover(120_000);
    await mundo.disparar(1000);
    expect(mundo.llamadas.filter((l) => ruta(l) === "/campana/pase")).toHaveLength(pases);
  });

  it("si la sala no acepta el cierre, el stand lo dice", async () => {
    const dAna = await cifradoPara("Ana");
    const { mundo, stand } = await crear({
      campana: [respuestaDeCampana(archivoDe()), respuestaDeCampana(archivoDe())],
      estado: [estadoDe("abierta", 1)],
      equipos: [json([filaDe(1, 1, dAna)]), json([])],
      pase: [paseDe("AAAAAAAAAAAA", AHORA + 120_000)],
      fase: [json({ error: "transicion" }, 400)],
    });
    await asentar();
    expect(await stand.cerrar()).toBe("rechazo");
    expect(datosDe(ultimo(mundo)).datos.aviso).toBe("No se pudo cerrar. Probá otra vez.");
  });
});

describe("los veredictos de cada fila", () => {
  it("los repetidos se miran igual sin mayúsculas ni espacios de más, y quedan para revisar", () => {
    const nombres = new Map<number, string | null>([[1, "Ana López"], [2, "ana  lópez"], [3, "Beto"], [4, null]]);
    const filas = filasDelStand(nombres);
    expect(filas.map((f) => [f.n, f.nombre, f.revisar])).toEqual([
      [1, "Ana López", false],
      [2, "ana  lópez", true],
      [3, "Beto", false],
      [4, "", false],
    ]);
  });
});
