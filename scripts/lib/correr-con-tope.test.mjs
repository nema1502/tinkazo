// Prueba la corrida con tope del prevuelo con procesos de node de verdad, cortos.
import { describe, expect, it } from "vitest";
import { correrConTope } from "./correr-con-tope.mjs";

const node = JSON.stringify(process.execPath);

describe("correrConTope", () => {
  it("una orden que termina a tiempo da su código y no se marca por tiempo", async () => {
    const r = await correrConTope(process.execPath, ["-e", "console.log('hola'); process.exit(3)"], { tope: 30_000 });
    expect(r).toMatchObject({ codigo: 3, porTiempo: false, error: "hola" });
  });

  it("al vencer el tope, con shell, mata también lo que corre debajo y avisa que fue por tiempo", async () => {
    // Con shell, el proceso directo es el cmd (o sh) y node corre debajo: si solo muriera el de arriba,
    // node seguiría con las salidas abiertas y esto tardaría los 60 segundos.
    const desde = Date.now();
    const r = await correrConTope(`${node} -e "setTimeout(() => {}, 60000)"`, [], { tope: 1500, shell: true });
    expect(r.porTiempo).toBe(true);
    expect(Date.now() - desde).toBeLessThan(20_000);
  });

  it("una orden que no existe da codigo null y el error", async () => {
    const r = await correrConTope("orden-que-no-existe-en-ninguna-maquina", [], { tope: 10_000 });
    expect(r.codigo).toBeNull();
    expect(r.error).toMatch(/ENOENT/);
  });
});
