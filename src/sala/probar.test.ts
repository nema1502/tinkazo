import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La prueba de punta a punta de la sala (`workers/sala/probar.mjs`) no se corre acá:
 * necesita un Worker en marcha y crea salas de verdad. Esta prueba cuida la parte del
 * tope de 240 nombres por minuto: espera al comienzo de un minuto antes de las altas y
 * manda las 245 en tandas de a 25 en paralelo, para que caigan en la misma ventana
 * también contra producción.
 */
const fuente = readFileSync(new URL("../../workers/sala/probar.mjs", import.meta.url), "utf8");

describe("la prueba del tope por minuto de la sala", () => {
  it("espera al comienzo de un minuto antes de la primera alta con cuenta", () => {
    const dormir = fuente.indexOf("await sleep(61_000 - (Date.now() % 60_000));");
    const primerAlta = fuente.indexOf('post(id, "Ana", llaveAna)');
    expect(dormir).toBeGreaterThan(-1);
    // La espera va antes de las altas, no recién delante de las 245: así el repetido,
    // la corrección y Beto gastan lugares de la misma ventana que va a frenar el tope.
    expect(dormir).toBeLessThan(primerAlta);
  });

  it("manda las 245 de a 25 en paralelo y ya no de a una", () => {
    const desde = fuente.indexOf("// 6. Tope por minuto");
    const hasta = fuente.indexOf('check("el tope es de 240 nombres');
    const tope = fuente.slice(desde, hasta);
    expect(tope).toContain("for (let i = 0; i < 245; i += 25) {");
    expect(tope).toContain("Math.min(245, i + 25)");
    expect(tope).toContain("tanda.push(post(id, `Persona ${j}`))");
    expect(tope).toContain("await Promise.all(tanda)");
    expect(tope).not.toContain("for (let i = 0; i < 245; i++) {");
  });

  it("la afirmación no cambió: entre 236 y 240 entran y al menos 7 frenados por rapido", () => {
    expect(fuente).toContain("ok >= 236 && ok <= 240 && rapido >= 7");
    expect(fuente).toContain('error === "rapido"');
  });
});