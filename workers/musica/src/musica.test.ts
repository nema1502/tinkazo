import { beforeEach, describe, expect, it } from "vitest";
import { type Fetcher, type Fuente, type ObjetoR2, ORIGENES, fuenteDeAssets, leerRange, servir } from "./logica";

const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

type Probada = Fuente & { pedidos: string[] };

/** Una R2 de mentira con un solo archivo: race.mp3, de 100 bytes. */
function falsaR2(): Probada {
  const pedidos: string[] = [];
  const objeto = (offset = 0, length = BYTES.length, conRango = false): ObjetoR2 => ({
    size: BYTES.length,
    httpEtag: '"abc"',
    body: new Response(BYTES.slice(offset, offset + length)).body,
    ...(conRango ? { range: { offset, length } } : {}),
  });
  return {
    pedidos,
    async get(key, opciones) {
      pedidos.push(`get ${key}`);
      if (key !== "race.mp3") return null;
      const r = opciones?.range;
      if (!r) return objeto();
      if ("suffix" in r) return objeto(BYTES.length - r.suffix, r.suffix, true);
      const largo = Math.min(r.length ?? BYTES.length - r.offset, BYTES.length - r.offset);
      return objeto(r.offset, largo, true);
    },
    async head(key) {
      pedidos.push(`head ${key}`);
      return key === "race.mp3" ? { size: BYTES.length, httpEtag: '"abc"' } : null;
    },
  };
}

/**
 * Los archivos propios del Worker de mentira, tal como se portan en `wrangler dev`: el archivo
 * entero aunque se pida un tramo, sin `Content-Length` en el que confiar.
 */
function falsoAssets(): Probada {
  const pedidos: string[] = [];
  const fetcher: Fetcher = {
    async fetch(req) {
      const ruta = new URL(req.url).pathname.slice(1);
      pedidos.push(`${req.method} ${ruta}`);
      if (ruta !== "race.mp3") return new Response("no", { status: 404 });
      const base = { ETag: '"abc"', "Content-Type": "audio/mpeg" };
      if (req.method === "HEAD") return new Response(null, { status: 200, headers: base });
      return new Response(BYTES, { status: 200, headers: base });
    },
  };
  return { ...fuenteDeAssets(fetcher), pedidos } as Probada;
}

// El mismo contrato con las dos fuentes. `pedidos` de la de assets lo cuenta el Fetcher, no la fuente.
function fabrica(nombre: string): () => Probada {
  if (nombre === "R2") return falsaR2;
  return () => {
    const pedidos: string[] = [];
    const base = falsoAssets();
    return {
      pedidos,
      get: (k, o) => (pedidos.push(`get ${k}`), base.get(k, o)),
      head: (k) => (pedidos.push(`head ${k}`), base.head(k)),
    };
  };
}

let falsa: () => Probada = falsaR2;

const pedir = (ruta: string, init: RequestInit & { origen?: string | null } = {}, env: Probada = falsa()) => {
  const { origen = "https://tinkazo.app", headers, ...resto } = init;
  const h = new Headers(headers);
  if (origen) h.set("Origin", origen);
  return servir(new Request(`https://m.tinkazo.app${ruta}`, { ...resto, headers: h }), env);
};

describe.each(["R2", "archivos propios"])("fuente: %s", (nombre) => {
  beforeEach(() => {
    falsa = fabrica(nombre);
  });

  describe("música: quién puede pedirla", () => {
    it("el sitio recibe el archivo con sus cabeceras", async () => {
      const r = await pedir("/race.mp3");
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(r.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(r.headers.get("Accept-Ranges")).toBe("bytes");
      expect(r.headers.get("Content-Length")).toBe("100");
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
      expect(r.headers.get("Vary")).toBe("Origin");
      expect(r.headers.get("ETag")).toBe('"abc"');
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES);
    });

    it("www.tinkazo.app también, y el CORS devuelve su propio origen", async () => {
      const r = await pedir("/race.mp3", { origen: "https://www.tinkazo.app" });
      expect(r.status).toBe(200);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://www.tinkazo.app");
    });

    it("sin Origin: 403, en español, sin guardarse en ningún caché y sin tocar el bucket", async () => {
      const env = falsa();
      const r = await pedir("/race.mp3", { origen: null }, env);
      expect(r.status).toBe(403);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
      expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
      const texto = await r.text();
      expect(texto.trim().split("\n")).toHaveLength(1);
      expect(texto).toContain("es del sitio");
      expect(env.pedidos).toEqual([]);
    });

    it.each(["https://otra.com", "http://tinkazo.app", "https://tinkazo.app.malo.com", "https://evil-tinkazo.app", "https://tinkazo.app:8443", "null", "https://tinkazo.vercel.app"])(
      "origen %s: 403",
      async (origen) => {
        const r = await pedir("/race.mp3", { origen });
        expect(r.status).toBe(403);
        expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
      },
    );

    it("la lista de orígenes buenos es solo la del sitio", () => {
      expect([...ORIGENES]).toEqual(["https://tinkazo.app", "https://www.tinkazo.app"]);
    });
  });

  describe("música: qué se sirve", () => {
    it("un archivo que no existe: 404, aun siendo del sitio", async () => {
      const r = await pedir("/sapo.mp3");
      expect(r.status).toBe(404);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
    });

    it.each(["/", "/race", "/race.wav", "/race.mp3/extra", "/Race.mp3", "/a/b.mp3", "/v1/lista", "/%2e%2e%2frace.mp3"])("ruta %s: 404 sin tocar el bucket", async (ruta) => {
      const env = falsa();
      const r = await pedir(ruta, {}, env);
      expect(r.status).toBe(404);
      expect(env.pedidos).toEqual([]);
    });

    it("HEAD: mismas cabeceras, sin cuerpo", async () => {
      const r = await pedir("/race.mp3", { method: "HEAD" });
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(r.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(r.headers.get("Accept-Ranges")).toBe("bytes");
      expect(r.headers.get("Content-Length")).toBe("100");
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://tinkazo.app");
      expect(await r.text()).toBe("");
    });

    it("HEAD con otro origen o sin origen: 403; de un archivo que no existe: 404", async () => {
      expect((await pedir("/race.mp3", { method: "HEAD", origen: "https://otra.com" })).status).toBe(403);
      expect((await pedir("/race.mp3", { method: "HEAD", origen: null })).status).toBe(403);
      expect((await pedir("/sapo.mp3", { method: "HEAD" })).status).toBe(404);
    });

    it.each(["POST", "PUT", "DELETE", "PATCH"])("%s: 405, no hay subida por HTTP", async (method) => {
      const r = await pedir("/race.mp3", { method, ...(method === "DELETE" ? {} : { body: "x" }) });
      expect(r.status).toBe(405);
      expect(r.headers.get("Allow")).toBe("GET, HEAD");
    });

    it("no hay listado", async () => {
      for (const ruta of ["/", "/?list", "/?prefix=r"]) expect((await pedir(ruta)).status).toBe(404);
    });
  });

  describe("música: tramos (Range)", () => {
    it("bytes=10-19: 206 con Content-Range", async () => {
      const r = await pedir("/race.mp3", { headers: { Range: "bytes=10-19" } });
      expect(r.status).toBe(206);
      expect(r.headers.get("Content-Range")).toBe("bytes 10-19/100");
      expect(r.headers.get("Content-Length")).toBe("10");
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES.slice(10, 20));
    });

    it("bytes=90-: hasta el final; bytes=-5: los últimos cinco", async () => {
      const a = await pedir("/race.mp3", { headers: { Range: "bytes=90-" } });
      expect(a.headers.get("Content-Range")).toBe("bytes 90-99/100");
      const b = await pedir("/race.mp3", { headers: { Range: "bytes=-5" } });
      expect(b.headers.get("Content-Range")).toBe("bytes 95-99/100");
    });

    it("un tramo imposible: 416; una cabecera rara se ignora y va entero", async () => {
      expect((await pedir("/race.mp3", { headers: { Range: "bytes=20-10" } })).status).toBe(416);
      expect((await pedir("/race.mp3", { headers: { Range: "bytes=-" } })).status).toBe(416);
    expect((await pedir("/race.mp3", { headers: { Range: "bytes=500-600" } })).status).toBe(416);
      const r = await pedir("/race.mp3", { headers: { Range: "bytes=0-5,10-15" } });
      expect(r.status).toBe(200);
    });

    it("leerRange", () => {
      expect(leerRange(null)).toBeNull();
      expect(leerRange("bytes=0-99")).toEqual({ offset: 0, length: 100 });
      expect(leerRange("bytes=5-")).toEqual({ offset: 5 });
      expect(leerRange("bytes=-8")).toEqual({ suffix: 8 });
      expect(leerRange("bytes=-0")).toBe("mal");
      expect(leerRange("items=1-2")).toBeNull();
    });
  });
});
