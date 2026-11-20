// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearPanelInteractivo, initOrganizadorInteractivo } from "./organizador";
import { anotarseEnSala, ganadoresDe, resultadoPersonal, seguirVivo } from "./participante";
import { bytesToHex } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { t, T } from "../i18n";

/**
 * El panel del organizador de los juegos interactivos (`sala/organizador.ts`): abre la sala, muestra
 * el QR del participante, ve la lista en vivo, cierra la lista, sella compartiendo la ronda y
 * anuncia. Acá corre contra una sala de mentira que cumple el protocolo de `workers/sala`, así que
 * la prueba de flujo completo pasa por el mismo camino que pasa en producción: el participante se
 * anota con su nombre cifrado, la pantalla lo descifra por el WebSocket, y el celular calcula su
 * resultado personal con la ronda compartida.
 */

vi.mock("../ui/qr", () => ({
  pintarQr: vi.fn(async (img: HTMLImageElement) => {
    img.setAttribute("src", "data:image/png;base64,qr");
    return true;
  }),
  precargarQr: vi.fn(async () => undefined),
}));

/* --------------------------------------------------- la sala de mentira */

function salaDeMentira() {
  const st = {
    id: "AbCd1234",
    token: "t".repeat(22),
    nombres: new Map<number, string>(),
    estado: "abierta" as "abierta" | "cerrada",
    ronda: null as { r: number; randomness: string; listHash: string; k: number } | null,
    seq: 0,
    borrada: false,
  };
  const sockets: SocketDeMentira[] = [];
  const json = (cuerpo: unknown, status = 200): Response => new Response(JSON.stringify(cuerpo), { status });
  const avisar = (m: object): void => {
    for (const s of sockets) if (s.presentada) s.recibir(JSON.stringify(m));
  };

  class SocketDeMentira {
    presentada = false;
    oyentes: Record<string, ((e: unknown) => void)[]> = {};
    constructor(public url: string) {
      sockets.push(this);
    }
    addEventListener(t: string, f: (e: unknown) => void): void {
      (this.oyentes[t] ??= []).push(f);
    }
    send(d: string): void {
      const m = JSON.parse(d) as { t?: string; token?: string };
      if (m.t === "hola" && m.token === st.token) {
        this.presentada = true;
        this.recibir(JSON.stringify({ t: "listo", hay: st.nombres.size, estado: st.estado, ronda: st.ronda }));
      }
    }
    close(): void {}
    emitir(t: string, e: unknown = {}): void {
      for (const f of this.oyentes[t] ?? []) f(e);
    }
    recibir(texto: string): void {
      for (const f of this.oyentes["message"] ?? []) f({ data: texto });
    }
  }

  const router = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const partes = u.pathname.split("/").filter(Boolean);
    const metodo = init?.method ?? "GET";
    const conToken = ((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") === `Bearer ${st.token}`;
    // Crear la sala.
    if (partes.length === 2 && metodo === "POST") return json({ id: st.id, token: st.token, vence: 9e15 }, 201);
    if (partes[1] !== "sala" || partes[2] !== st.id || st.borrada) return json({ error: "no-existe" }, 404);
    // Un nombre cifrado de un celular.
    if (partes.length === 3 && metodo === "POST") {
      if (st.estado === "cerrada") return json({ error: "cerrada" }, 409);
      const n = ++st.seq;
      st.nombres.set(n, String(init?.body));
      avisar({ t: "nombre", n, d: String(init?.body) });
      return json({ n }, 201);
    }
    if (partes.length === 3 && metodo === "DELETE") {
      st.borrada = true;
      st.nombres.clear();
      return new Response(null, { status: 204 });
    }
    if (partes[3] === "nombres" && partes.length === 4 && metodo === "GET") {
      if (!conToken) return json({ error: "token" }, 403);
      const desde = Number(u.searchParams.get("desde") ?? 0);
      return json([...st.nombres].filter(([n]) => n > desde).map(([n, d]) => ({ n, d })));
    }
    if (partes[3] === "nombres" && partes.length === 5 && metodo === "DELETE") {
      const n = Number(partes[4]);
      st.nombres.delete(n);
      avisar({ t: "quitado", n });
      return new Response(null, { status: 204 });
    }
    if (partes[3] === "vivo") {
      const desde = Number(u.searchParams.get("desde") ?? 0);
      return json({
        hay: st.nombres.size,
        estado: st.estado,
        ronda: st.ronda,
        ns: [...st.nombres.keys()],
        nombres: [...st.nombres].filter(([n]) => n > desde).map(([n, d]) => ({ n, d })),
      });
    }
    if (partes[3] === "ronda" && metodo === "PUT") {
      if (!conToken) return json({ error: "token" }, 403);
      st.ronda = JSON.parse(String(init?.body));
      avisar({ t: "ronda", ...st.ronda });
      return new Response(null, { status: 204 });
    }
    if (partes[3] === "cierre" && metodo === "POST") {
      if (!conToken) return json({ error: "token" }, 403);
      st.estado = "cerrada";
      avisar({ t: "lista-cerrada" });
      return new Response(null, { status: 204 });
    }
    return json({ error: "no-existe" }, 404);
  });

  return { st, router, sockets, SocketDeMentira };
}

/* ------------------------------------------------------- los ayudantes */

const SERVICIO = "http://sala.test";

/** El panel, con la sala de mentira por detrás. Devuelve también la clave que salió en el QR. */
function panelDe(sala: ReturnType<typeof salaDeMentira>) {
  const claves: { id: string; clave: string }[] = [];
  const panel = crearPanelInteractivo({
    tx: (k) => t(k),
    qr: async (img: HTMLImageElement) => {
      img.setAttribute("src", "data:image/png;base64,qr");
      return true;
    },
    enlaceDeParticipante: (d) => {
      claves.push({ ...d });
      return `${SERVICIO}/${d.id}#${d.clave}`;
    },
    servicio: SERVICIO,
    dep: { fetch: sala.router as unknown as typeof fetch, socket: (u) => new sala.SocketDeMentira(u) as unknown as WebSocket },
  });
  return { panel, clave: () => claves[0]?.clave ?? "" };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});

const boton = (raiz: HTMLElement, clase: string): HTMLButtonElement => raiz.querySelector<HTMLButtonElement>(clase) as HTMLButtonElement;
/**
 * Espera a que algo pase: descifrar nombres usa crypto de verdad, y hay que darle vueltas al bucle. Cada vuelta pasa
 * también por el mismo grupo de hilos donde corre el descifrado: con la máquina cargada, la espera se estira al mismo
 * ritmo que el descifrado y no se acaba antes de que lleguen los nombres (con vueltas de reloj falso solamente, se
 * acababa en unos 20 ms y el celular que entra tarde quedaba con la lista vacía).
 */
async function hasta(condicion: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condicion(); i++) {
    await vi.advanceTimersByTimeAsync(50);
    await crypto.subtle.digest("SHA-256", new Uint8Array(0));
  }
}

describe("el panel del organizador", () => {
  it("se abre cerrado, y «Abrir la sala» crea la sala y muestra el QR del participante", async () => {
    const sala = salaDeMentira();
    const { panel } = panelDe(sala);
    panel.abrir();
    expect(panel.abierta()).toBe(true);
    expect(panel.raiz.textContent).toContain(T.es.jiAbrir);
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sala.router).toHaveBeenCalledWith(`${SERVICIO}/v1/sala`, { method: "POST" });
    // El QR lleva el enlace del participante (con la clave), no la página del stand.
    expect(panel.raiz.querySelector<HTMLImageElement>(".ji-qr img")?.getAttribute("src")).toBeTruthy();
    expect(panel.raiz.textContent).toContain(T.es.jiQrSub);
  });

  it("con la sala abierta, el socket se presenta y el estado dice en vivo", async () => {
    const sala = salaDeMentira();
    const { panel } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.raiz.textContent).toContain(T.es.standSalaEnVivo);
  });

  it("los nombres que llegan se descifran y se ven; los repetidos van a «Para revisar»", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 1);
    expect([...panel.raiz.querySelectorAll(".ji-nombres .ji-nombre")].map((li) => li.textContent)).toEqual(["Ana"]);
    // El segundo Ana espera en «Para revisar», con su botón para mostrarlo.
    await hasta(() => panel.raiz.querySelectorAll(".ji-revisar-lista .ji-nombre").length === 1);
    expect(panel.raiz.textContent).toContain(T.es.standSalaRevisarT);
    expect([...panel.raiz.querySelectorAll(".ji-revisar-lista .ji-nombre")].map((li) => li.textContent)).toEqual(["Ana"]);
    boton(panel.raiz, ".ji-mostrar").click();
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 2);
    expect([...panel.raiz.querySelectorAll(".ji-nombres .ji-nombre")].map((li) => li.textContent)).toEqual(["Ana", "Ana"]);
  });

  it("un nombre con enlace se descarta y se quita de la sala solo", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "mira malo.xyz", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => sala.st.nombres.size === 0);
    expect(panel.raiz.querySelectorAll(".ji-nombres li").length).toBe(0);
  });

  it("quitar un nombre lo saca de la lista y de la sala", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 1);
    boton(panel.raiz, ".ji-quitar").click();
    await hasta(() => sala.st.nombres.size === 0);
    expect(panel.raiz.querySelectorAll(".ji-nombres li").length).toBe(0);
  });

  it("«Cerrar la lista» cierra, y «Sellar y anunciar» comparte la ronda y muestra quién salió", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await anotarseEnSala(sala.st.id, clave(), "Beto", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 2);
    // Antes de cerrar la lista no se puede sellar.
    expect(boton(panel.raiz, ".ji-sellar").disabled).toBe(true);
    boton(panel.raiz, ".ji-cerrar-lista").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sala.st.estado).toBe("cerrada");
    expect(panel.raiz.textContent).toContain(T.es.jiListaCerrada);
    expect(boton(panel.raiz, ".ji-sellar").disabled).toBe(false);
    boton(panel.raiz, ".ji-sellar").click();
    await vi.advanceTimersByTimeAsync(0);
    // La ronda compartida: la huella de la lista canónica de los dos nombres, con un número público de 32 bytes.
    const ronda = sala.st.ronda;
    expect(ronda).not.toBeNull();
    expect(ronda?.randomness).toMatch(/^[0-9a-f]{64}$/);
    const lista = ["Ana", "Beto"];
    expect(ronda?.listHash).toBe(bytesToHex(listHash(lista)));
    expect(ronda?.k).toBe(1);
    // El resultado en la pantalla: el nombre que salió, con el mismo select del protocolo.
    const sale = ganadoresDe(lista, ronda as never)?.[0] as string | undefined;
    expect(sale, "la ronda compartida tiene un ganador").toBeTruthy();
    expect(panel.raiz.textContent).toContain((T.es.jiResultadoT as string).replace("{n}", "2"));
    expect(panel.raiz.textContent).toContain(sale);
    expect(panel.raiz.textContent).toContain(T.es.jiRondaEjemplo);
  });

  it("con menos de dos nombres no se puede sellar, y lo dice", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 1);
    boton(panel.raiz, ".ji-cerrar-lista").click();
    await vi.advanceTimersByTimeAsync(0);
    boton(panel.raiz, ".ji-sellar").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sala.st.ronda).toBeNull();
    expect(panel.raiz.textContent).toContain(T.es.jiPocos);
  });

  it("si no se pudo compartir el número, lo dice y «Sellar» reintenta", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await anotarseEnSala(sala.st.id, clave(), "Beto", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 2);
    boton(panel.raiz, ".ji-cerrar-lista").click();
    await vi.advanceTimersByTimeAsync(0);
    sala.router.mockImplementationOnce(async () => new Response("no", { status: 500 }));
    boton(panel.raiz, ".ji-sellar").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.raiz.textContent).toContain(T.es.jiErrRonda);
    expect(sala.st.ronda).toBeNull();
    boton(panel.raiz, ".ji-sellar").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sala.st.ronda).not.toBeNull();
    expect(panel.raiz.textContent).not.toContain(T.es.jiErrRonda);
  });

  it("«Cerrar la sala» borra todo y el panel vuelve al principio", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 1);
    boton(panel.raiz, ".ji-cerrar-sala").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sala.st.borrada).toBe(true);
    expect(panel.raiz.textContent).toContain(T.es.jiAbrir);
  });

  it("Escape cierra el panel; la sala sigue (se vuelve a abrir con lo que había)", async () => {
    const sala = salaDeMentira();
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, { fetch: sala.router as unknown as typeof fetch });
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.abierta()).toBe(false);
    panel.abrir();
    expect(panel.raiz.querySelectorAll(".ji-nombres li").length).toBe(1);
  });

  it("el botón de la portada abre el panel", async () => {
    document.body.innerHTML = `<button class="enlace" type="button" id="btn-interactivos">Juegos interactivos</button>`;
    const sala = salaDeMentira();
    initOrganizadorInteractivo({
      tx: (k) => t(k),
      qr: async (img: HTMLImageElement) => {
        img.setAttribute("src", "data:image/png;base64,qr");
        return true;
      },
      enlaceDeParticipante: (d) => `${SERVICIO}/${d.id}#${d.clave}`,
      servicio: SERVICIO,
      dep: { fetch: sala.router as unknown as typeof fetch, socket: (u) => new sala.SocketDeMentira(u) as unknown as WebSocket },
    });
    document.getElementById("btn-interactivos")?.click();
    expect(document.querySelector(".ji-capa")).toBeTruthy();
  });
});

describe("el flujo completo: unirse, cerrar, sellar y el resultado personal", () => {
  it("dos celulares se suman, el organizador cierra y sella, y cada celular ve si le tocó", async () => {
    const sala = salaDeMentira();
    const dep = { fetch: sala.router as unknown as typeof fetch, socket: (u: string) => new sala.SocketDeMentira(u) as unknown as WebSocket };
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);

    // Los dos celulares: siguen /vivo con el cliente de participante de verdad.
    const celulares = ["Ana", "Beto"].map((nombre) => {
      const visto = { nombres: new Map<number, string>(), quitados: [] as number[], cerrada: false, ronda: null as null | { r: number; randomness: string; listHash: string; k: number }, vencida: false };
      const s = seguirVivo(sala.st.id, clave(), SERVICIO, {
        alNombre: (n, nom) => void visto.nombres.set(n, nom),
        alQuitado: (n) => void visto.quitados.push(n),
        alCierre: () => {
          visto.cerrada = true;
        },
        alRonda: (r) => {
          visto.ronda = r;
        },
        alVencida: () => {
          visto.vencida = true;
        },
      }, dep);
      return { nombre, visto, s };
    });

    // Cada uno se anota con su nombre, cifrado con la clave del QR.
    for (const c of celulares) {
      const r = await anotarseEnSala(sala.st.id, clave(), c.nombre, SERVICIO, dep);
      expect(r.ok).toBe(true);
    }
    // La pantalla los ve llegar (los descifra por el WebSocket).
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 2);
    // Y los celulares también, por el sondeo de /vivo.
    for (const c of celulares) await hasta(() => c.visto.nombres.size === 2);
    expect([...celulares[0]!.visto.nombres.values()].sort()).toEqual(["Ana", "Beto"]);

    // Cerrar la lista desde la pantalla; los celulares se enteran.
    boton(panel.raiz, ".ji-cerrar-lista").click();
    for (const c of celulares) await hasta(() => c.visto.cerrada);

    // Sellar y anunciar: la ronda compartida llega a los celulares.
    boton(panel.raiz, ".ji-sellar").click();
    for (const c of celulares) await hasta(() => c.visto.ronda !== null);

    const ronda = sala.st.ronda as { r: number; randomness: string; listHash: string; k: number };
    const lista = ["Ana", "Beto"];
    const sale = ganadoresDe(lista, ronda)?.[0] as string | undefined;
    expect(sale, "la ronda compartida tiene un ganador").toBeTruthy();
    // En la pantalla: el resultado con el nombre que salió.
    expect(panel.raiz.textContent).toContain((T.es.jiResultadoT as string).replace("{n}", "2"));
    expect(panel.raiz.textContent).toContain(sale);
    // En cada celular: el resultado personal, calculado con la misma matemática.
    for (const c of celulares) {
      const nombres = [...c.visto.nombres.values()];
      const esperado = resultadoPersonal(nombres, ronda, c.nombre);
      const texto = esperado === "te-toco" ? T.es.jiPTeToco : T.es.jiPNoGano;
      expect(texto, c.nombre).toBeTruthy();
      // Y el nombre que salió está en la lista que el celular reconstruyó.
      expect(nombres).toContain(sale);
    }
    for (const c of celulares) c.s.parar();
  });

  it("un celular que entra tarde reconstruye la lista y ve el mismo resultado", async () => {
    const sala = salaDeMentira();
    const dep = { fetch: sala.router as unknown as typeof fetch, socket: (u: string) => new sala.SocketDeMentira(u) as unknown as WebSocket };
    const { panel, clave } = panelDe(sala);
    panel.abrir();
    boton(panel.raiz, ".ji-abrir").click();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sala.sockets.at(-1) as InstanceType<typeof sala.SocketDeMentira>;
    socket.emitir("open");
    await vi.advanceTimersByTimeAsync(0);
    await anotarseEnSala(sala.st.id, clave(), "Ana", SERVICIO, dep);
    await anotarseEnSala(sala.st.id, clave(), "Beto", SERVICIO, dep);
    await hasta(() => panel.raiz.querySelectorAll(".ji-nombres li").length === 2);
    boton(panel.raiz, ".ji-cerrar-lista").click();
    await vi.advanceTimersByTimeAsync(0);
    boton(panel.raiz, ".ji-sellar").click();
    await vi.advanceTimersByTimeAsync(0);
    const ronda = sala.st.ronda as { r: number; randomness: string; listHash: string; k: number };

    // El que llegó tarde: pide todo desde cero y, con la ronda ya compartida, decide igual.
    const visto = { nombres: new Map<number, string>(), ronda: null as null | typeof ronda };
    const s = seguirVivo(sala.st.id, clave(), SERVICIO, {
      alNombre: (n, nom) => void visto.nombres.set(n, nom),
      alRonda: (r) => {
        visto.ronda = r;
      },
    }, dep);
    await hasta(() => visto.ronda !== null && visto.nombres.size === 2);
    // La lista reconstruida es la misma que la que se selló (los nombres, en el orden en que entraron).
    const nombres = [...visto.nombres.values()];
    expect(nombres).toEqual(["Ana", "Beto"]);
    const sale = ganadoresDe(nombres, ronda)?.[0] as string | undefined;
    expect(sale, "la ronda compartida tiene un ganador").toBeTruthy();
    // El resultado del celular coincide con el de la pantalla.
    expect(resultadoPersonal(nombres, ronda, sale as string)).toBe("te-toco");
    s.parar();
  });
});
