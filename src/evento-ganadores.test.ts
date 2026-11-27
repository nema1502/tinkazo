import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "./i18n";
import { cuentaDePrueba, lineaDePrueba } from "./campana/cuentas-de-prueba";
import { ganadoresDelEnlaceCoinciden, ganadoresRehechos, ganadorasPorLugar, htmlDeQuienGano, quienEnLaTarjeta } from "./evento-tarjeta";

/**
 * Quién salió y entre cuántos en la tarjeta de cada sorteo del evento (`quienEnLaTarjeta`): la cuenta y los nombres
 * con la misma lectura por persona, calculada una sola vez. Se prueba lo que dice, sin abrir la página.
 */
describe("la tarjeta del evento y la marca de la línea sellada", () => {
  it("sin modos, una lista común con «Grupo 4 (1/2)» y «Grupo 4 (2/2)» se muestra tal cual", () => {
    const s = { names: ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Ana", "Beto"], ganadores: ["Grupo 4 (1/2)", "Grupo 4 (2/2)"] };
    expect(quienEnLaTarjeta("es", s, false, false)).toEqual({ personas: 4, participaciones: 4, ganadores: ["Grupo 4 (1/2)", "Grupo 4 (2/2)"] });
  });

  it("con el modo a la vista y un reparto, nombra a la persona y junta a quien salió más de una vez", () => {
    const s = { names: ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla"], ganadores: ["Ana (1/3)", "Beto", "Ana (3/3)"] };
    expect(quienEnLaTarjeta("es", s, true, false)).toEqual({ personas: 3, participaciones: 5, ganadores: ["Ana (2 veces)", "Beto"] });
    expect(quienEnLaTarjeta("en", s, true, false).ganadores).toEqual(["Ana (2 times)", "Beto"]);
    // El mismo reparto sin el modo (el enlace del evento no lo lleva): cada línea tal cual, y la cuenta lo mismo.
    expect(quienEnLaTarjeta("es", s, false, false)).toEqual({ personas: 5, participaciones: 5, ganadores: ["Ana (1/3)", "Beto", "Ana (3/3)"] });
  });

  it("sin modos, un reparto entero se cuenta y se nombra por persona, las dos cosas", () => {
    const s = { names: ["Mesa 1 (1/2)", "Mesa 1 (2/2)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"], ganadores: ["Mesa 1 (2/2)", "Mesa 2 (1/2)"] };
    expect(quienEnLaTarjeta("es", s, false, false)).toEqual({ personas: 2, participaciones: 4, ganadores: ["Mesa 1", "Mesa 2"] });
  });

  it("en un orden de turnos no se junta a nadie: cada turno es su renglón", () => {
    const s = { names: ["Ana (1/2)", "Ana (2/2)", "Beto"], ganadores: ["Ana (2/2)", "Beto", "Ana (1/2)"] };
    expect(quienEnLaTarjeta("es", s, true, true).ganadores).toEqual(["Ana", "Beto", "Ana"]);
  });

  it("la página del evento la llama con los modos que valen ahí", () => {
    const codigo = readFileSync("src/evento.ts", "utf8");
    expect(codigo).toContain('quienEnLaTarjeta(getLang(), s, requestedMode() === "varias" || modesFlagOn(), turnos)');
  });
});

describe("el evento con una lista de personas", () => {
  const lineas = [1, 2, 3, 4].map((n) => lineaDePrueba(n));

  it("lo que se comprueba es el lugar: el nombre que trae el enlace no cambia el resultado", () => {
    expect(ganadoresDelEnlaceCoinciden(lineas, [3, 1], ["Lugar 4 de la lista", "Nora"])).toBe(true);
    expect(ganadoresDelEnlaceCoinciden(lineas, [3, 1], ["Nora", "Beto"])).toBe(true);
    // Un nombre inventado, uno vacío o una línea pegada a mano no pasan a verde ni a rojo nada: no se comparan con nada.
    expect(ganadoresDelEnlaceCoinciden(lineas, [3, 1], ["Alguien que no se anotó", ""])).toBe(true);
    expect(ganadoresDelEnlaceCoinciden(lineas, [3], [lineas[3] as string])).toBe(true);
  });

  it("sigue exigiendo que haya ganadoras y que el enlace diga la misma cantidad", () => {
    expect(ganadoresDelEnlaceCoinciden(lineas, [3, 1], ["Nora"])).toBe(false);
    expect(ganadoresDelEnlaceCoinciden(lineas, [], [])).toBe(false);
  });

  it("con una lista de nombres exige el nombre exacto, como siempre", () => {
    const nombres = ["Ana", "Beto", "Nora"];
    expect(ganadoresDelEnlaceCoinciden(nombres, [2, 0], ["Nora", "Ana"])).toBe(true);
    expect(ganadoresDelEnlaceCoinciden(nombres, [2, 0], ["Beto", "Ana"])).toBe(false);
    expect(ganadoresDelEnlaceCoinciden(nombres, [2, 0], ["Nora", "ana"])).toBe(false);
    expect(ganadoresDelEnlaceCoinciden(nombres, [2, 0], ["Nora", ""])).toBe(false);
  });

  it("en una lista mezclada, quien ganó con un nombre o una cuenta sigue pidiendo el texto exacto", () => {
    const mezcla = [lineas[0] as string, "Ana", cuentaDePrueba(1)];
    expect(ganadoresDelEnlaceCoinciden(mezcla, [0, 1], ["Cualquiera", "Ana"])).toBe(true);
    expect(ganadoresDelEnlaceCoinciden(mezcla, [0, 1], ["Cualquiera", "Beto"])).toBe(false);
    expect(ganadoresDelEnlaceCoinciden(mezcla, [2], ["Cualquiera"])).toBe(false);
  });

  it("lo que se muestra de quien salió es el lugar, nunca la línea", () => {
    expect(ganadoresRehechos(lineas, [3, 1])).toEqual(["Lugar 4", "Lugar 2"]);
    expect(ganadoresRehechos(["Ana", "Beto"], [1])).toEqual(["Beto"]);
  });

  it("la página del evento compara y muestra con esas dos", () => {
    const codigo = readFileSync("src/evento.ts", "utf8");
    expect(codigo).toContain("ganadoresDelEnlaceCoinciden(r.nombres, r.ganadores, ganadoresDelEnlace)");
    expect(codigo).toContain("ganadoresRehechos(r.nombres, r.ganadores)");
  });
});

/**
 * El renglón de quién ganó en la tarjeta del evento. Con una lista de personas lo comprobado es el lugar de cada ganadora
 * en la lista sellada, que sale de rehacer el sorteo. El nombre del enlace lo escribió quien compartió: va al lado, fuera
 * de la negrita, y nunca decide nada. Con nombres o cuentas el renglón es el de siempre.
 */
describe("el renglón de quién ganó en la tarjeta del evento", () => {
  const lineas = [1, 2, 3, 4].map((n) => lineaDePrueba(n));
  const deSiempre = (rotulo: string, nombres: string[]): string =>
    `<p class="ev-gana"><span class="kicker">${rotulo}</span> <b>${nombres.map((n) => `<bdi>${n}</bdi>`).join(", ")}</b></p>`;

  it("una lista de nombres o de cuentas no pasa por el lugar: el renglón es el de siempre", () => {
    expect(ganadorasPorLugar(["Ana", "Beto", "Nora"], [2], ["Nora"])).toBeNull();
    expect(ganadorasPorLugar([cuentaDePrueba(1), cuentaDePrueba(2)], [1], [cuentaDePrueba(2)])).toBeNull();
    expect(ganadorasPorLugar(["Ana", "Beto"], null, ["Beto"])).toBeNull();
    expect(htmlDeQuienGano("Ganó", ["Nora"], null)).toBe(deSiempre("Ganó", ["Nora"]));
    expect(htmlDeQuienGano("Ganaron", [cuentaDePrueba(2), "Ana & <Beto>"], null)).toBe(
      deSiempre("Ganaron", [cuentaDePrueba(2), "Ana &amp; &lt;Beto&gt;"]),
    );
  });

  it("con una lista de personas, lo comprobado es el lugar y el nombre del enlace va al lado", () => {
    expect(ganadorasPorLugar(lineas, [3, 1], ["Nora", "Beto"])).toEqual([
      { comprobado: "Lugar 4 de la lista", dicho: "Nora" },
      { comprobado: "Lugar 2 de la lista", dicho: "Beto" },
    ]);
  });

  it("un nombre inventado en el enlace no sale como comprobado: queda fuera de la negrita", () => {
    const filas = ganadorasPorLugar(lineas, [3], ["Presidenta de la comunidad"]);
    expect(filas).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "Presidenta de la comunidad" }]);
    const html = htmlDeQuienGano("Ganó", ["Presidenta de la comunidad"], filas);
    expect(html).toBe('<p class="ev-gana"><span class="kicker">Ganó</span> <b><bdi>Lugar 4 de la lista</bdi></b> (<bdi>Presidenta de la comunidad</bdi>)</p>');
    const enNegrita = [...html.matchAll(/<b>(.*?)<\/b>/gu)].map((m) => m[1]).join(" ");
    expect(enNegrita).not.toContain("Presidenta");
  });

  it("si el enlace ya dice el lugar, o no dice nada, o trae una línea, queda solo el lugar", () => {
    expect(ganadorasPorLugar(lineas, [3], ["Lugar 4 de la lista"])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "" }]);
    expect(ganadorasPorLugar(lineas, [3], ["Spot 4 on the list"])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "" }]);
    expect(ganadorasPorLugar(lineas, [3], ["Lugar 4"])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "" }]);
    expect(ganadorasPorLugar(lineas, [3], [""])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "" }]);
    expect(ganadorasPorLugar(lineas, [3], [lineas[3] as string])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "" }]);
    const html = htmlDeQuienGano("Ganó", [], ganadorasPorLugar(lineas, [3], [lineas[3] as string]));
    expect(html).toBe('<p class="ev-gana"><span class="kicker">Ganó</span> <b><bdi>Lugar 4 de la lista</bdi></b></p>');
    expect(html).not.toContain("p1:");
  });

  it("un enlace que dice otro lugar no lo hace pasar por comprobado", () => {
    expect(ganadorasPorLugar(lineas, [3], ["Lugar 1 de la lista"])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "Lugar 1 de la lista" }]);
  });

  it("mientras el sorteo no se rehizo bien no hay lugar que mostrar: el nombre del enlace va sin negrita y nunca una línea", () => {
    const filas = ganadorasPorLugar(lineas, null, ["Nora", lineas[0] as string, ""]);
    expect(filas).toEqual([{ comprobado: "", dicho: "Nora" }]);
    const html = htmlDeQuienGano("Ganó", ["Nora"], filas);
    expect(html).toBe('<p class="ev-gana"><span class="kicker">Ganó</span> <bdi>Nora</bdi></p>');
    expect(html).not.toContain("<b>");
    // Sin nada que mostrar, el renglón no queda con el rótulo solo.
    expect(htmlDeQuienGano("Ganó", [], ganadorasPorLugar(lineas, null, [lineas[0] as string]))).toBe("");
  });

  it("en una lista mezclada, quien ganó con un nombre sale con su nombre comprobado", () => {
    const mezcla = [lineas[0] as string, "Ana", lineas[1] as string];
    expect(ganadorasPorLugar(mezcla, [1, 2], ["Ana", "Nora"])).toEqual([
      { comprobado: "Ana", dicho: "" },
      { comprobado: "Lugar 3 de la lista", dicho: "Nora" },
    ]);
  });

  it("un texto del enlace que lleva una línea adentro tampoco se muestra", () => {
    expect(ganadorasPorLugar(lineas, [3], [`Nora ${lineas[3] as string}`])).toEqual([{ comprobado: "Lugar 4 de la lista", dicho: "" }]);
    expect(ganadorasPorLugar(lineas, null, [`Nora ${lineas[3] as string}`])).toEqual([]);
  });

  it("la página del evento arma el renglón con esas dos y muestra el lugar solo con el ganador en verde", () => {
    const codigo = readFileSync("src/evento.ts", "utf8");
    expect(codigo).toContain('ganadorasPorLugar(f?.r.nombres.length ? f.r.nombres : s.names, f?.ganador === "ok" ? f.r.ganadores : null, s.ganadores)');
    expect(codigo).toContain("htmlDeQuienGano(");
    expect(codigo).not.toContain('<p class="ev-gana">');
  });
});
