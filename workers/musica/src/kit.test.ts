import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import index from "./index";
import { esDelKit, servirKit } from "./kit";
import { type Fetcher, type Fuente, type ObjetoR2, fuenteDeAssets } from "./logica";

const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

/** Una fuente de mentira con un solo archivo del kit, `clave`, de 100 bytes. */
function falsa(clave: string): Fuente {
  const objeto = (offset = 0, length = BYTES.length, conRango = false): ObjetoR2 => ({
    size: BYTES.length,
    httpEtag: '"kit"',
    body: new Response(BYTES.slice(offset, offset + length)).body,
    ...(conRango ? { range: { offset, length } } : {}),
  });
  return {
    async get(key, opciones) {
      if (key !== clave) return null;
      const r = opciones?.range;
      if (!r) return objeto();
      if ("suffix" in r) return objeto(BYTES.length - r.suffix, r.suffix, true);
      const largo = Math.min(r.length ?? BYTES.length - r.offset, BYTES.length - r.offset);
      return objeto(r.offset, largo, true);
    },
    async head(key) {
      return key === clave ? { size: BYTES.length, httpEtag: '"kit"' } : null;
    },
  };
}

const pedir = (ruta: string, init: RequestInit = {}): Request => new Request(`https://m.tinkazo.app${ruta}`, init);

describe("el kit para creadores", () => {
  it("lo entrega a cualquiera, sin mirar el origen, como descarga y legible desde cualquier página", async () => {
    const f = falsa("kit/tinkazo-ruleta-9x16.mp4");
    for (const init of [{}, { headers: { Origin: "https://otra.com" } }, { headers: { Origin: "https://tinkazo.app" } }]) {
      const res = await servirKit(pedir("/kit/tinkazo-ruleta-9x16.mp4", init), f);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("video/mp4");
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="tinkazo-ruleta-9x16.mp4"');
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
      expect(res.headers.get("Content-Length")).toBe("100");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    }
  });

  it("HEAD da las mismas cabeceras sin cuerpo", async () => {
    const res = await servirKit(pedir("/kit/tinkazo-ruleta-9x16.mp4", { method: "HEAD" }), falsa("kit/tinkazo-ruleta-9x16.mp4"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("ETag")).toBe('"kit"');
    expect(await res.text()).toBe("");
  });

  it("acepta tramos (Range) para que el video de la página se pueda recorrer", async () => {
    const f = falsa("kit/tinkazo-ruleta-9x16.mp4");
    const res = await servirKit(pedir("/kit/tinkazo-ruleta-9x16.mp4", { headers: { Range: "bytes=10-19" } }), f);
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(10, 20));
    expect((await servirKit(pedir("/kit/tinkazo-ruleta-9x16.mp4", { headers: { Range: "bytes=50-10" } }), f)).status).toBe(416);
  });

  it("el tipo sale de la extensión", async () => {
    for (const [nombre, tipo] of [["a.webm", "video/webm"], ["a.png", "image/png"], ["a.srt", "application/x-subrip; charset=utf-8"], ["a.zip", "application/zip"], ["lista.json", "application/json; charset=utf-8"]] as const) {
      const res = await servirKit(pedir(`/kit/${nombre}`), falsa(`kit/${nombre}`));
      expect(res.headers.get("Content-Type"), nombre).toBe(tipo);
    }
  });

  it("lo que no es un archivo del kit con nombre simple es 404, y no hay listado ni recorridos de carpetas", async () => {
    const f = falsa("kit/a.mp4");
    for (const ruta of ["/kit/", "/kit", "/kit/a", "/kit/a.exe", "/kit/A.mp4", "/kit/../musica.mp3", "/kit/%2e%2e/a.mp4", "/kit/sub/a.mp4", "/kit/.oculto.mp4", "/otra/a.mp4"]) {
      expect((await servirKit(pedir(ruta), f)).status, ruta).toBe(404);
    }
    expect((await servirKit(pedir("/kit/no-esta.mp4"), f)).status).toBe(404);
  });

  it("solo se lee: cualquier otro método es 405", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await servirKit(pedir("/kit/a.mp4", { method }), falsa("kit/a.mp4"));
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
    }
  });

  it("con un bucket solo para el kit, las claves no llevan carpeta", async () => {
    const res = await servirKit(pedir("/kit/a.mp4"), falsa("a.mp4"), "");
    expect(res.status).toBe(200);
  });

  it("con los archivos propios del Worker, el archivo vive en camas/kit/", async () => {
    const pedidos: string[] = [];
    const assets: Fetcher = {
      async fetch(req) {
        const ruta = new URL(req.url).pathname.slice(1);
        pedidos.push(`${req.method} ${ruta}`);
        return ruta === "kit/a.mp4" ? new Response(BYTES, { status: 200, headers: { ETag: '"x"' } }) : new Response("no", { status: 404 });
      },
    };
    const res = await servirKit(pedir("/kit/a.mp4"), fuenteDeAssets(assets));
    expect(res.status).toBe(200);
    expect(pedidos).toEqual(["GET kit/a.mp4"]);
    expect((await servirKit(pedir("/kit/b.mp4"), fuenteDeAssets(assets))).status).toBe(404);
  });

  it("esDelKit separa lo del kit de la música", () => {
    expect(esDelKit("https://m.tinkazo.app/kit/a.mp4")).toBe(true);
    expect(esDelKit("https://m.tinkazo.app/race.mp3")).toBe(false);
    expect(esDelKit("https://m.tinkazo.app/kitchen.mp4")).toBe(false);
  });
});

describe("el Worker, con la música y el kit juntos", () => {
  const assets: Fetcher = {
    async fetch(req) {
      const ruta = new URL(req.url).pathname.slice(1);
      return ruta === "kit/a.mp4" || ruta === "race.mp3" ? new Response(BYTES, { status: 200 }) : new Response("no", { status: 404 });
    },
  };

  it("el kit sale sin origen y la música sigue pidiendo el del sitio", async () => {
    expect((await index.fetch(pedir("/kit/a.mp4"), { ASSETS: assets })).status).toBe(200);
    expect((await index.fetch(pedir("/race.mp3"), { ASSETS: assets })).status).toBe(403);
    expect((await index.fetch(pedir("/race.mp3", { headers: { Origin: "https://tinkazo.app" } }), { ASSETS: assets })).status).toBe(200);
  });

  it("con un bucket KIT, el kit sale de ahí y no de los archivos propios", async () => {
    const res = await index.fetch(pedir("/kit/a.mp4"), { KIT: falsa("a.mp4"), ASSETS: { fetch: async () => new Response("no", { status: 404 }) } });
    expect(res.status).toBe(200);
  });

  it("sin ninguna fuente, avisa que no está configurado", async () => {
    expect((await index.fetch(pedir("/kit/a.mp4"), {})).status).toBe(500);
  });
});

describe("el guion de subida del kit", () => {
  const guion = fileURLToPath(new URL("../subir-kit.mjs", import.meta.url));
  const correr = (...args: string[]) => spawnSync(process.execPath, [guion, ...args], { encoding: "utf8" });
  const carpeta = (archivos: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), "kit-"));
    for (const [n, c] of Object.entries(archivos)) writeFileSync(join(dir, n), c);
    return dir;
  };

  it("en seco revisa y muestra qué subiría, sin tocar nada", () => {
    const dir = carpeta({ "tinkazo-ruleta-9x16.mp4": "video", "entrada-oscuro.webm": "otro", "guion-ruleta.srt": "1" });
    try {
      const r = correr("--desde", dir, "--seco");
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("tinkazo-kit/tinkazo-ruleta-9x16.mp4");
      expect(r.stdout).toContain("lista.json");
      expect(r.stdout).toContain("3 archivos y lista.json");
      expect(existsSync(join(dir, "lista.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falla antes de subir nada si un nombre no sirve o un archivo está vacío", () => {
    const mal = carpeta({ "Bueno.mp4": "x", "ok.mp4": "x" });
    const vacio = carpeta({ "ok.mp4": "" });
    try {
      const a = correr("--desde", mal, "--seco");
      expect(a.status).toBe(1);
      expect(a.stderr).toContain("Bueno.mp4");
      const b = correr("--desde", vacio, "--seco");
      expect(b.status).toBe(1);
      expect(b.stderr).toContain("vacíos");
      expect(correr("--seco").status).toBe(1);
    } finally {
      rmSync(mal, { recursive: true, force: true });
      rmSync(vacio, { recursive: true, force: true });
    }
  });

  it("admite las mismas extensiones que el Worker", () => {
    const ext = (texto: string): string => /\.\(\?:([a-z0-9|]+)\)/.exec(texto)?.[1] ?? "";
    const delWorker = ext(readFileSync(new URL("./kit.ts", import.meta.url), "utf8"));
    const delGuion = ext(readFileSync(guion, "utf8"));
    expect(delWorker).not.toBe("");
    expect(delGuion).toBe(delWorker);
  });
});
