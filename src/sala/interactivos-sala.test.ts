import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalList, listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/quicknet";
import { descifrarNombre } from "./cifra";
import { cerrarListaEnSala, compartirRonda, crearSala, escucharSala, quitarNombreEnSala, type Sala } from "./cliente";
import { BASE_LOCAL, montarMundo, type MundoDeSala } from "./mundo-sala";
import { anotarseEnSala, ganadoresDe, listaEnOrden, resultadoPersonal, seguirVivo, type RondaViva } from "./participante";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * Los juegos interactivos contra el código de la sala de verdad (workers/sala), entero en esta máquina: el SQLite de cada
 * sala es real y la red es un llamado directo al Worker. Así lo que ve el celular es lo que contesta el servicio, sin una
 * sala de mentira en el medio que pueda decir otra cosa.
 */

const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);

/** El fetch de la pantalla y de los celulares, que le pega al Worker local con el mismo método, cabeceras y cuerpo. */
function redDe(mundo: MundoDeSala): typeof fetch {
  return (async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(String(url));
    const cuerpo = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const cabeceras = { ...(init.headers as Record<string, string> | undefined) };
    return mundo.pedir(`${u.pathname}${u.search}`, { metodo: init.method ?? "GET", cuerpo, cabeceras });
  }) as typeof fetch;
}

/** La llave de cada celular de la prueba: una por teléfono, como en la sala de verdad. */
const llaveDe = (i: number): string => `celular${i}`.padEnd(22, "x");

interface Vivo {
  hay: number;
  estado: string;
  ns: number[];
  nombres: { n: number; d: string }[];
}

describe("la sala de verdad y el celular del participante", () => {
  let mundo: MundoDeSala;
  let red: typeof fetch;
  let sala: Sala;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(AHORA);
    mundo = await montarMundo();
    red = redDe(mundo);
    sala = await crearSala({ fetch: red }, BASE_LOCAL);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const vivo = async (): Promise<Vivo> => (await (await red(`${BASE_LOCAL}/v1/sala/${sala.id}/vivo?desde=0`)).json()) as Vivo;

  it("el celular se anota en una sala nueva: entra con 201 y el mismo nombre otra vez desde ese celular no suma a nadie", async () => {
    await expect(anotarseEnSala(sala.id, sala.clave, "Ana", BASE_LOCAL, { fetch: red, llave: llaveDe(1) })).resolves.toEqual({ ok: true, n: 1 });
    await expect(anotarseEnSala(sala.id, sala.clave, "Ana", BASE_LOCAL, { fetch: red, llave: llaveDe(1) })).resolves.toEqual({ ok: true, n: 1 });
    expect((await vivo()).hay).toBe(1);
  });

  it("otro celular con el mismo nombre no entra, y lo dice", async () => {
    await anotarseEnSala(sala.id, sala.clave, "Ana", BASE_LOCAL, { fetch: red, llave: llaveDe(1) });
    await expect(anotarseEnSala(sala.id, sala.clave, " ANA ", BASE_LOCAL, { fetch: red, llave: llaveDe(2) })).resolves.toEqual({
      ok: false,
      motivo: "repetido",
    });
  });

  it("lo que mira el celular trae los números que siguen en la sala, y el que se quitó ya no está", async () => {
    await anotarseEnSala(sala.id, sala.clave, "Ana", BASE_LOCAL, { fetch: red, llave: llaveDe(1) });
    await anotarseEnSala(sala.id, sala.clave, "Beto", BASE_LOCAL, { fetch: red, llave: llaveDe(2) });
    const antes = await vivo();
    expect(antes.estado).toBe("abierta");
    expect(antes.hay).toBe(2);
    expect(antes.ns).toEqual([1, 2]);
    expect(antes.nombres.map((x) => x.n)).toEqual([1, 2]);
    await expect(quitarNombreEnSala(sala, 1, { fetch: red })).resolves.toBe(true);
    const despues = await vivo();
    expect(despues.hay).toBe(1);
    expect(despues.ns).toEqual([2]);
  });

  /** Espera a que algo pase: los sondeos corren con el reloj de la prueba y el descifrado con WebCrypto de verdad. */
  async function hasta(condicion: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condicion(); i++) {
      await vi.advanceTimersByTimeAsync(50);
      await crypto.subtle.digest("SHA-256", new Uint8Array(0));
    }
    if (!condicion()) throw new Error("no pasó lo que se esperaba");
  }

  it("de punta a punta: dos celulares se anotan, quien organiza cierra y comparte la ronda, y cada celular ve su resultado", async () => {
    // Quien organiza escucha la sala como el panel: sin WebSocket en la prueba, consulta cada 3 s con su token.
    const enPantalla = new Map<number, string>();
    const sinSocket = (): WebSocket => {
      throw new Error("sin socket en la prueba");
    };
    const pantalla = escucharSala(
      sala,
      { alNombre: (n, d) => void descifrarNombre(sala.clave, d).then((x) => x !== null && enPantalla.set(n, x)) },
      { fetch: red, socket: sinSocket },
    );
    const celulares = ["Ana", "Beto"].map((nombre, i) => {
      const visto = { nombres: new Map<number, string>(), cerrada: false, ronda: null as RondaViva | null, vencida: false };
      const s = seguirVivo(sala.id, sala.clave, BASE_LOCAL, {
        alNombre: (n, x) => void visto.nombres.set(n, x),
        alQuitado: (n) => void visto.nombres.delete(n),
        alCierre: () => {
          visto.cerrada = true;
        },
        alRonda: (r) => {
          visto.ronda = r;
        },
        alVencida: () => {
          visto.vencida = true;
        },
      }, { fetch: red });
      return { nombre, llave: llaveDe(i + 1), visto, s };
    });

    for (const c of celulares) {
      await expect(anotarseEnSala(sala.id, sala.clave, c.nombre, BASE_LOCAL, { fetch: red, llave: c.llave })).resolves.toMatchObject({ ok: true });
    }
    await hasta(() => enPantalla.size === 2);
    for (const c of celulares) await hasta(() => c.visto.nombres.size === 2);

    // Cerrar la lista: la sala lo confirma y los celulares se enteran.
    await expect(cerrarListaEnSala(sala, { fetch: red })).resolves.toBe(true);
    for (const c of celulares) await hasta(() => c.visto.cerrada);
    // Ya nadie más entra.
    await expect(anotarseEnSala(sala.id, sala.clave, "Carla", BASE_LOCAL, { fetch: red, llave: llaveDe(3) })).resolves.toEqual({
      ok: false,
      motivo: "cerrada",
    });

    // La ronda de ejemplo, armada como la arma el panel: la huella de la lista que ve la pantalla, en el orden en que entraron.
    const enOrden = [...enPantalla.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    const lista = canonicalList(enOrden.join("\n"));
    const ronda: RondaViva = { r: 1, randomness: "ab".repeat(32), listHash: bytesToHex(listHash(lista)), k: 1 };
    await expect(compartirRonda(sala, ronda, { fetch: red })).resolves.toBe(true);
    for (const c of celulares) await hasta(() => c.visto.ronda !== null);

    const sale = ganadoresDe(lista, ronda)?.[0];
    expect(sale, "la ronda tiene un ganador").toBeTruthy();
    for (const c of celulares) {
      expect(c.visto.vencida, c.nombre).toBe(false);
      expect(c.visto.ronda).toEqual(ronda);
      const propio = resultadoPersonal([...c.visto.nombres.values()], ronda, c.nombre);
      expect(propio, c.nombre).toBe(c.nombre === sale ? "te-toco" : "no-gano");
    }
    pantalla.parar();
    for (const c of celulares) c.s.parar();
  });

  it("un celular que pone su propio nombre antes de ver a quien entró un instante antes llega igual a la lista sellada", async () => {
    await anotarseEnSala(sala.id, sala.clave, "Ana", BASE_LOCAL, { fetch: red, llave: llaveDe(1) });
    const propio = await anotarseEnSala(sala.id, sala.clave, "Beto", BASE_LOCAL, { fetch: red, llave: llaveDe(2) });
    expect(propio).toEqual({ ok: true, n: 2 });
    // Como la vista: el propio nombre entra al mapa apenas la sala lo acepta, y Ana llega después con el sondeo.
    const vistos = new Map<number, string>([[2, "Beto"]]);
    let ronda: RondaViva | null = null;
    const s = seguirVivo(sala.id, sala.clave, BASE_LOCAL, {
      alNombre: (n, x) => void vistos.set(n, x),
      alRonda: (r) => {
        ronda = r;
      },
    }, { fetch: red });
    await hasta(() => vistos.size === 2);
    expect([...vistos.values()], "el orden de llegada no es el de la sala").toEqual(["Beto", "Ana"]);
    await expect(cerrarListaEnSala(sala, { fetch: red })).resolves.toBe(true);
    const sellada: RondaViva = { r: 1, randomness: "cd".repeat(32), listHash: bytesToHex(listHash(["Ana", "Beto"])), k: 1 };
    await expect(compartirRonda(sala, sellada, { fetch: red })).resolves.toBe(true);
    await hasta(() => ronda !== null);
    expect(listaEnOrden(vistos)).toEqual(["Ana", "Beto"]);
    expect(resultadoPersonal(listaEnOrden(vistos), sellada, "Beto")).not.toBe("lista-distinta");
    s.parar();
  });

  it("lo que la pantalla quita justo antes de compartir la ronda ya no está cuando el celular la calcula", async () => {
    for (const [i, nombre] of ["Ana", "Beto", "pendejo"].entries()) {
      await anotarseEnSala(sala.id, sala.clave, nombre, BASE_LOCAL, { fetch: red, llave: llaveDe(i + 1) });
    }
    const vistos = new Map<number, string>();
    let alSortear: ReturnType<typeof resultadoPersonal> | null = null;
    const s = seguirVivo(sala.id, sala.clave, BASE_LOCAL, {
      alNombre: (n, x) => void vistos.set(n, x),
      alQuitado: (n) => void vistos.delete(n),
      // Lo que pinta la vista en el momento en que le llega la ronda.
      alRonda: (r) => {
        alSortear = resultadoPersonal(listaEnOrden(vistos), r, "Ana");
      },
    }, { fetch: red });
    await hasta(() => vistos.size === 3);
    // Como el panel al sellar: saca de la sala lo que quedó para revisar y enseguida comparte la ronda, antes del sondeo siguiente.
    await expect(cerrarListaEnSala(sala, { fetch: red })).resolves.toBe(true);
    await expect(quitarNombreEnSala(sala, 3, { fetch: red })).resolves.toBe(true);
    const sellada: RondaViva = { r: 1, randomness: "ef".repeat(32), listHash: bytesToHex(listHash(["Ana", "Beto"])), k: 1 };
    await expect(compartirRonda(sala, sellada, { fetch: red })).resolves.toBe(true);
    await hasta(() => alSortear !== null);
    expect(alSortear).not.toBe("lista-distinta");
    expect(listaEnOrden(vistos)).toEqual(["Ana", "Beto"]);
    s.parar();
  });
});
