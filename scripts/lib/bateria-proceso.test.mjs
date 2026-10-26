import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { correrTarea, escuchando } from "./bateria-proceso.mjs";

let dir;
const script = (nombre, cuerpo) => {
  const ruta = join(dir, nombre);
  writeFileSync(ruta, cuerpo);
  return ruta;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tinkazo-bateria-test-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("correr un auditor como proceso", () => {
  it("lee el resumen que deja al final, con la salida de texto antes", async () => {
    const s = script(
      "bueno.mjs",
      `for (let i = 0; i < 500; i++) console.log("  ✓ comprobación " + i);
       console.log(JSON.stringify({ auditor: "falso", objetivo: process.argv[2], aprobadas: 500, total: 500, fallas: [], segundos: 1 }));`,
    );
    const r = await correrTarea({ script: s, args: ["trompo"] });
    expect(r.codigo).toBe(0);
    expect(r.error).toBeNull();
    expect(r.resumen).toMatchObject({ auditor: "falso", objetivo: "trompo", aprobadas: 500 });
  });

  it("le pasa el entorno propio, por ejemplo su puerto de DevTools", async () => {
    const s = script("env.mjs", `console.log(JSON.stringify({ auditor: "e", objetivo: process.env.CDP_PORT, aprobadas: 1, total: 1, fallas: [], segundos: 0 }));`);
    const r = await correrTarea({ script: s, env: { CDP_PORT: "9690" } });
    expect(r.resumen.objetivo).toBe("9690");
  });

  it("un auditor que se cae sin resumen deja el código y las últimas líneas", async () => {
    const s = script("cae.mjs", `console.log("empezó"); console.error("Error: no encontré Chrome"); process.exit(3);`);
    const r = await correrTarea({ script: s });
    expect(r.codigo).toBe(3);
    expect(r.resumen).toBeNull();
    expect(r.cola.join("\n")).toContain("no encontré Chrome");
  });

  it("guarda la salida entera en el archivo de registro", async () => {
    const s = script("log.mjs", `console.log("línea uno"); console.log("línea dos");`);
    const log = join(dir, "logs", "uno.log");
    await correrTarea({ script: s, log });
    expect(readFileSync(log, "utf8")).toContain("línea dos");
  });

  it("lo que pasa del límite se corta y queda dicho", async () => {
    const s = script("cuelga.mjs", `console.log("colgado"); setInterval(() => {}, 1000);`);
    const t0 = Date.now();
    const r = await correrTarea({ script: s, limiteMs: 600 });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.error).toMatch(/se pasó del límite/);
    expect(r.resumen).toBeNull();
  }, 20_000);

  it("un script que no existe falla sin dejar la batería colgada", async () => {
    const r = await correrTarea({ script: join(dir, "no-existe.mjs") });
    expect(r.codigo).not.toBe(0);
    expect(r.resumen).toBeNull();
  });
});

describe("saber si un puerto está tomado", () => {
  it("ve el que tiene algo escuchando y el que no", async () => {
    const servidor = net.createServer();
    await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
    const { port } = servidor.address();
    expect(await escuchando(port)).toBe(true);
    await new Promise((ok) => servidor.close(ok));
    expect(await escuchando(port)).toBe(false);
  });
});
