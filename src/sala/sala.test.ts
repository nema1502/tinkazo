import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CIFRA_JS, TEXTOS, paginaCelular } from "../../workers/sala/src/pagina";
import { VentanaPorMinuto, horaUtc, intentarAlta, grupoDeIp, nombreCifradoValido, origenPermitido } from "../../workers/sala/src/logica";
import { cifrarNombre, descifrarNombre, generarClave } from "./cifra";
import { MAX_NOMBRE, hayPalabraFea, llevaEnlace, revisarNombre } from "./filtro";
import { crearSala, enlaceDeSala, escucharSala, type Sala } from "./cliente";

/** El cifrado de la página del celular, tal cual va dentro del HTML. */
const celular = new Function(`${CIFRA_JS}; return { cifrar, b64, deB64 };`)() as {
  cifrar: (clave: string, texto: string) => Promise<string>;
};

describe("el cifrado de los nombres", () => {
  it("la clave son 16 bytes en 22 caracteres base64url", () => {
    expect(generarClave()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generarClave()).not.toBe(generarClave());
  });

  it("ida y vuelta, con tildes, ñ y emojis", async () => {
    const k = generarClave();
    for (const n of ["Ana", "José Ñandú", "Zoë 🦙", "Quispe Mamani"]) expect(await descifrarNombre(k, await cifrarNombre(k, n))).toBe(n);
  });

  it("lo que cifra la página del celular lo descifra la pantalla", async () => {
    const k = generarClave();
    for (const n of ["María", "Ñuflo de Chaves", "Pepe 🎉"]) expect(await descifrarNombre(k, await celular.cifrar(k, n))).toBe(n);
  });

  it("con otra clave o con bytes rotos no descifra", async () => {
    const d = await cifrarNombre(generarClave(), "Ana");
    expect(await descifrarNombre(generarClave(), d)).toBeNull();
    expect(await descifrarNombre(generarClave(), "AAAA")).toBeNull();
    expect(await descifrarNombre(generarClave(), "no es base64!!")).toBeNull();
  });

  it("lo cifrado es base64url y el servicio lo acepta por su forma, aun con 40 caracteres de 4 bytes", async () => {
    const k = generarClave();
    const d = await cifrarNombre(k, "🦙".repeat(40));
    expect(nombreCifradoValido(d)).toBe(true);
    expect(d.length).toBeLessThanOrEqual(342);
    expect(d).not.toContain("🦙");
  });
});

describe("las formas que acepta el servicio", () => {
  it("rechaza lo que no es un nombre cifrado", () => {
    for (const x of ["", "hola mundo!", "A".repeat(400), "AAAA", "ñ".repeat(60)]) expect(nombreCifradoValido(x)).toBe(false);
  });
  it("solo crea salas el sitio, las vistas de Vercel y localhost", () => {
    expect(origenPermitido("https://tinkazo.app")).toBe(true);
    expect(origenPermitido("https://tinkazo-git-rama-nema.vercel.app")).toBe(true);
    expect(origenPermitido("http://localhost:5173")).toBe(true);
    expect(origenPermitido("https://tinkazo.app.malo.com")).toBe(false);
    expect(origenPermitido("https://ejemplo.com")).toBe(false);
    expect(origenPermitido(null)).toBe(false);
  });
  it("en IPv6 cuenta el bloque /64", () => {
    expect(grupoDeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(grupoDeIp("2001:db8:1:2::1"));
    expect(grupoDeIp("1.2.3.4")).toBe("1.2.3.4");
  });
  it("el tope de 120 por minuto se reinicia al minuto siguiente", () => {
    const v = new VentanaPorMinuto(120);
    for (let i = 0; i < 120; i++) expect(v.intentar(1_000)).toBe(true);
    expect(v.intentar(1_000)).toBe(false);
    expect(v.intentar(61_000)).toBe(true);
  });
  it("5 salas por dirección y por hora, en un almacén que sobrevive a dormirse", () => {
    // El almacén es el SQLite del objeto: se comparte entre «despertares», no vive en la instancia.
    const filas = new Map<string, number>();
    const almacen = () => ({
      leer: (g: string, h: number) => filas.get(`${g}|${h}`) ?? 0,
      sumar: (g: string, h: number) => void filas.set(`${g}|${h}`, (filas.get(`${g}|${h}`) ?? 0) + 1),
      olvidarAntes: (h: number) => {
        for (const k of [...filas.keys()]) if (Number(k.split("|")[1]) < h) filas.delete(k);
      },
    });
    for (let i = 0; i < 5; i++) expect(intentarAlta(almacen(), "a", 0, 5)).toBe(true);
    // El objeto se duerme y despierta (otro `almacen()` sobre las mismas filas): la sexta sigue frenada.
    expect(intentarAlta(almacen(), "a", 1_000, 5)).toBe(false);
    expect(intentarAlta(almacen(), "b", 1_000, 5)).toBe(true);
    // Pasada la hora se puede de nuevo, y las filas viejas se borran.
    expect(horaUtc(3_600_000)).toBe(1);
    expect(intentarAlta(almacen(), "a", 3_600_000, 5)).toBe(true);
    expect([...filas.keys()].every((k) => k.endsWith("|1"))).toBe(true);
  });
});

describe("la página del celular", () => {
  const html = paginaCelular();
  it("pesa menos de 15 KB comprimida", () => {
    expect(gzipSync(html).length).toBeLessThan(15 * 1024);
  });
  it("está en español y en inglés, con el aviso de privacidad del celular", () => {
    expect(TEXTOS.es.aviso).toBe("Tu nombre o apodo se ve en la pantalla grande del stand, en una ronda de ejemplo, y se borra cuando cierran la sala o a las 10 horas.");
    expect(TEXTOS.en.aviso).toBe("Your name or nickname shows on the booth's big screen, in a sample round, and is deleted when the room is closed or after 10 hours.");
    expect(Object.keys(TEXTOS.es).sort()).toEqual(Object.keys(TEXTOS.en).sort());
  });
  it("no carga nada de afuera ni nombra al sistema", () => {
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img/);
    const visibles = JSON.stringify(TEXTOS);
    expect(visibles).not.toMatch(/drand|hash|bytes|firma|AES|cifr|servidor|raffle|rifa|apuest|·/i);
  });
  it("el JS de adentro es sintaxis válida", () => {
    const js = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("el filtro de nombres", () => {
  it("deja pasar nombres de verdad, también los que se parecen a una palabra fea", () => {
    for (const n of ["Ana Quispe", "Pedro", "Vergara", "María José", "Computadora", "Cumbia", "Dick", "Gil", "Escobar", "Assunta", "Cocoa", "Ñuflo"]) {
      expect(revisarNombre(n)).toEqual({ estado: "ok", nombre: n });
    }
  });
  it("manda a revisar lo que coincide, aunque lo disfracen", () => {
    for (const n of ["puta", "PuTa", "p.u.t.a", "p u t a", "puuuuta", "mi3rda", "hijo de puta", "H1j0 d3 pvt4".replace("pvt4", "put4"), "FUCK you", "f u c k", "Sh!t", "n1gg3r", "pendeJo", "cu1o".replace("cu1o", "cul0")]) {
      expect(hayPalabraFea(n), n).toBe(true);
      expect(revisarNombre(n).estado, n).toBe("revisar");
    }
  });
  it("descarta enlaces, correos y cuentas", () => {
    for (const n of ["https://malo.com", "www.malo.com", "mira malo.xyz", "yo@correo.com", "t.me/grupo", "wa.me/591"]) {
      expect(llevaEnlace(n), n).toBe(true);
      expect(revisarNombre(n)).toEqual({ estado: "descartar", motivo: "enlace" });
    }
  });
  it("descarta lo vacío y lo de más de 40 caracteres", () => {
    expect(revisarNombre("   ")).toEqual({ estado: "descartar", motivo: "vacio" });
    expect(revisarNombre("​​")).toEqual({ estado: "descartar", motivo: "vacio" });
    expect(revisarNombre("a".repeat(MAX_NOMBRE + 1))).toEqual({ estado: "descartar", motivo: "largo" });
    expect(revisarNombre("a".repeat(MAX_NOMBRE)).estado).toBe("ok");
    expect(revisarNombre("🦙".repeat(MAX_NOMBRE)).estado).toBe("ok");
  });
  it("saca los invisibles y los saltos de línea: entra una sola línea", () => {
    expect(revisarNombre("A​na\n\nQuispe‮")).toEqual({ estado: "ok", nombre: "Ana Quispe" });
  });
});

/* ------------------------------------------------------- el cliente, con falsos */

class SocketFalso {
  static ultimo: SocketFalso | null = null;
  enviados: string[] = [];
  oyentes: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public url: string) {
    SocketFalso.ultimo = this;
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.oyentes[t] ??= []).push(f);
  }
  send(d: string): void {
    this.enviados.push(d);
  }
  close(): void {}
  emitir(t: string, e: unknown = {}): void {
    for (const f of this.oyentes[t] ?? []) f(e);
  }
}

const sala: Sala = { id: "AbCd1234", token: "t".repeat(22), clave: "c".repeat(22), vence: 0, servicio: "http://sala.test" };
const respuesta = (cuerpo: unknown, status = 200): Response => new Response(JSON.stringify(cuerpo), { status });

describe("el cliente de la sala", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    SocketFalso.ultimo = null;
  });
  afterEach(() => vi.useRealTimers());

  it("el QR lleva la página del celular y la clave después del #", () => {
    expect(enlaceDeSala(sala)).toBe(`http://sala.test/AbCd1234#${"c".repeat(22)}`);
  });

  it("crear la sala devuelve id y token del servicio, y una clave que se genera acá", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ id: "ZZzz1111", token: "x".repeat(22), vence: 5 }, 201));
    const s = await crearSala({ fetch: f }, "http://sala.test");
    expect(f).toHaveBeenCalledWith("http://sala.test/v1/sala", { method: "POST" });
    expect(s.id).toBe("ZZzz1111");
    expect(s.clave).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // La clave nunca viaja al servicio.
    expect(JSON.stringify(f.mock.calls)).not.toContain(s.clave);
  });

  it("crear dice el motivo si el servicio dice que no, y «red» si no hay red", async () => {
    await expect(crearSala({ fetch: vi.fn().mockResolvedValue(respuesta({ error: "cupo-ip" }, 429)) }, "http://x")).rejects.toThrow("cupo-ip");
    await expect(crearSala({ fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }, "http://x")).rejects.toThrow("red");
  });

  it("se presenta con el token en el primer mensaje, nunca en la dirección", async () => {
    const f = vi.fn().mockResolvedValue(respuesta([]));
    const alNombre = vi.fn();
    escucharSala(sala, { alNombre }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket });
    const s = SocketFalso.ultimo as SocketFalso;
    expect(s.url).toBe("ws://sala.test/v1/sala/AbCd1234/pantalla");
    expect(s.url).not.toContain(sala.token);
    s.emitir("open");
    expect(JSON.parse(s.enviados[0] as string)).toEqual({ t: "hola", token: sala.token });
  });

  it("un nombre por el socket llega una sola vez, aunque también lo traiga la consulta", async () => {
    const f = vi.fn().mockResolvedValue(respuesta([{ n: 1, d: "uno" }]));
    const alNombre = vi.fn();
    const alEstado = vi.fn();
    escucharSala(sala, { alNombre, alEstado }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("message", { data: JSON.stringify({ t: "listo", hay: 0 }) });
    s.emitir("message", { data: JSON.stringify({ t: "nombre", n: 1, d: "uno" }) });
    s.emitir("message", { data: JSON.stringify({ t: "nombre", n: 2, d: "dos" }) });
    await vi.advanceTimersByTimeAsync(10);
    expect(alNombre.mock.calls).toEqual([[1, "uno"], [2, "dos"]]);
    expect(alEstado).toHaveBeenLastCalledWith("en-vivo");
  });

  it("si el socket se corta consulta cada 3 s y no pierde ningún nombre al volver", async () => {
    let n = 0;
    const f = vi.fn().mockImplementation(async () => respuesta(n > 0 ? [{ n, d: `d${n}` }] : []));
    const alNombre = vi.fn();
    const alEstado = vi.fn();
    escucharSala(sala, { alNombre, alEstado }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket });
    const s = SocketFalso.ultimo as SocketFalso;
    s.emitir("open");
    s.emitir("message", { data: JSON.stringify({ t: "listo" }) });
    s.emitir("close", { code: 1006 });
    expect(alEstado).toHaveBeenLastCalledWith("sondeo");
    n = 1;
    await vi.advanceTimersByTimeAsync(3_100);
    expect(alNombre).toHaveBeenCalledWith(1, "d1");
    n = 2;
    await vi.advanceTimersByTimeAsync(3_100);
    expect(alNombre).toHaveBeenCalledWith(2, "d2");
    // A los 8 s intenta reabrir el socket.
    const antes = SocketFalso.ultimo;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(SocketFalso.ultimo).not.toBe(antes);
  });

  it("al recargar la pantalla pide todo desde cero y sigue con lo que ya tenía", async () => {
    const f = vi.fn().mockResolvedValue(respuesta([{ n: 5, d: "cinco" }, { n: 6, d: "seis" }]));
    const alNombre = vi.fn();
    escucharSala(sala, { alNombre }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket }, [5]);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.mock.calls[0]?.[0]).toContain("desde=5");
    expect(alNombre.mock.calls).toEqual([[6, "seis"]]);
  });

  it("si la sala ya no existe (404) avisa y para", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ error: "no-existe" }, 404));
    const alCerrada = vi.fn();
    escucharSala(sala, { alNombre: vi.fn(), alCerrada }, { fetch: f, socket: (u) => new SocketFalso(u) as unknown as WebSocket });
    await vi.advanceTimersByTimeAsync(10);
    expect(alCerrada).toHaveBeenCalledTimes(1);
  });
});
