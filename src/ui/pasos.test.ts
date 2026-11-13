import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { acortarPremio, claveDelPaso, detalleDeLista, lineaDelPaso, pasoDe, premioQueEntra, relojDe } from "./pasos";

describe("en qué paso está el sorteo", () => {
  it("sin dos nombres todavía es la lista", () => {
    expect(pasoDe({ nombres: 0, sellada: false, revelado: false })).toBe(1);
    expect(pasoDe({ nombres: 1, sellada: false, revelado: false })).toBe(1);
  });

  it("con la lista lista, lo que toca es sellar", () => {
    expect(pasoDe({ nombres: 2, sellada: false, revelado: false })).toBe(2);
    expect(pasoDe({ nombres: 200, sellada: false, revelado: false })).toBe(2);
  });

  it("sellada, lo que toca es sortear, y sigue siéndolo mientras corre el juego", () => {
    expect(pasoDe({ nombres: 18, sellada: true, revelado: false })).toBe(3);
  });

  it("el paso 4 empieza cuando el resultado se ve", () => {
    expect(pasoDe({ nombres: 18, sellada: true, revelado: true })).toBe(4);
  });

  it("el siguiente premio vuelve al sellado: la lista nueva ya no está sellada", () => {
    expect(pasoDe({ nombres: 16, sellada: false, revelado: false })).toBe(2);
  });
});

describe("de qué se trata cada paso", () => {
  const ok = { segundos: 0, apagado: false, ganadores: 1 };

  it("cada paso tiene su texto, y el de la cuenta no cambia con el reloj", () => {
    // El 1 también: la barra ofrece "Pegar lista" cuando el botón queda fuera de la pantalla.
    expect(claveDelPaso(1, ok)).toBe("sigPegar");
    expect(claveDelPaso(2, ok)).toBe("sigLista");
    expect(claveDelPaso(2, { ...ok, apagado: true })).toBe("sigSellando");
    expect(claveDelPaso(3, { ...ok, segundos: 25, apagado: true })).toBe("sigEspera");
    expect(claveDelPaso(3, { ...ok, segundos: 24, apagado: true })).toBe("sigEspera");
    expect(claveDelPaso(3, ok)).toBe("sigRonda");
    expect(claveDelPaso(3, { ...ok, apagado: true })).toBe("sigSorteando");
    expect(claveDelPaso(4, ok)).toBe("sigGano");
    expect(claveDelPaso(4, { ...ok, ganadores: 2 })).toBe("sigGanaron");
    // Un orden de turnos no tiene ganadores, aunque salga toda la lista.
    expect(claveDelPaso(4, { ...ok, ganadores: 12, turnos: true })).toBe("sigTurnos");
  });

  it("un orden que no entra en la red no está sellando, aunque el botón esté apagado: dice el tope", () => {
    expect(claveDelPaso(2, { ...ok, apagado: true, noCabe: true })).toBe("sigTope");
    // Aunque el botón se viera prendido, si no entra no se puede sellar.
    expect(claveDelPaso(2, { ...ok, noCabe: true })).toBe("sigTope");
    // Fuera del paso 2 no cambia nada.
    expect(claveDelPaso(3, { ...ok, noCabe: true })).toBe("sigRonda");
    expect(claveDelPaso(2, { ...ok, apagado: true, noCabe: false })).toBe("sigSellando");
  });

  it("todos esos textos existen en los dos idiomas", () => {
    const claves = ["sigPegar", "sigLista", "sigSellando", "sigTope", "sigEspera", "sigRonda", "sigSorteando", "sigGano", "sigGanaron", "sigTurnos", "sigAvisoRonda"];
    const faltan = (["es", "en"] as const).flatMap((l) => claves.filter((k) => typeof T[l][k] !== "string" || !(T[l][k] as string).trim()).map((k) => `${l}.${k}`));
    expect(faltan).toEqual([]);
  });
});

describe("la línea de la barra", () => {
  it("el reloj sale con minutos y segundos de dos cifras", () => {
    expect(relojDe(0)).toBe("0:00");
    expect(relojDe(25)).toBe("0:25");
    expect(relojDe(65)).toBe("1:05");
    expect(relojDe(600)).toBe("10:00");
  });

  it("nombra el paso, de qué se trata y, si corre, la cuenta", () => {
    expect(lineaDelPaso("Paso 3 de 4", "Esperando la ronda", "0:25")).toBe("Paso 3 de 4: esperando la ronda, 0:25");
    expect(lineaDelPaso("Paso 4 de 4", "Ya salió el ganador")).toBe("Paso 4 de 4: ya salió el ganador");
    // Una frase: ni mayúsculas, ni punto medio, ni el detalle numérico tocado.
    expect(lineaDelPaso("Paso 2 de 4", "18 personas, Laptop")).toBe("Paso 2 de 4: 18 personas, Laptop");
    expect(lineaDelPaso("Step 2 of 4", "Sealing the list")).toBe("Step 2 of 4: sealing the list");
  });

  it("antes de sellar, la línea dice qué se sortea, o que no hay premio (D19)", () => {
    expect(detalleDeLista("12 personas", "Termo", "sin premio")).toBe("12 personas, Termo");
    expect(detalleDeLista("12 personas", "   ", "sin premio")).toBe("12 personas, sin premio");
    expect(detalleDeLista("12 people", "", "no prize")).toBe("12 people, no prize");
    // Los espacios de más no ocupan lugar.
    expect(detalleDeLista("12 personas", "  Kit   de  bienvenida ", "sin premio")).toBe("12 personas, Kit de bienvenida");
  });

  it("en el ensayo no se nombra el premio que falta: nada se sella de verdad", () => {
    expect(detalleDeLista("18 personas", "", null)).toBe("18 personas");
    expect(detalleDeLista("18 personas", "Laptop", null)).toBe("18 personas, Laptop");
  });

  it("un premio largo se corta entre palabras con puntos suspensivos", () => {
    const largo = "Una notebook con su mochila y el cargador";
    const d = detalleDeLista("12 personas", largo, "sin premio");
    expect(d).toBe("12 personas, Una notebook con…");
    expect(Array.from(d.split(", ")[1] ?? "").length).toBeLessThanOrEqual(18);
  });

  it("el caso del issue 26: nunca queda una palabra por la mitad", () => {
    // Antes salía "¿Quién presenta p…".
    expect(detalleDeLista("lista de 5 personas", "¿Quién presenta primero?", "sin premio")).toBe("lista de 5 personas, ¿Quién presenta…");
    // Con lugar de sobra, el premio va entero: el tope solo lo pone quien llama.
    expect(detalleDeLista("lista de 5 personas", "¿Quién presenta primero?", "sin premio", 60)).toBe("lista de 5 personas, ¿Quién presenta primero?");
  });

  it("si ni la primera palabra entra, queda solo la lista y no se dice que no hay premio", () => {
    expect(detalleDeLista("12 personas", "Supercalifragilísticoespialidoso", "sin premio")).toBe("12 personas");
    expect(detalleDeLista("2 personas", "🎁".repeat(20), "-")).toBe("2 personas");
    expect(detalleDeLista("12 personas", "Supercalifragilísticoespialidoso", null)).toBe("12 personas");
  });
});

describe("acortarPremio: se corta en el último espacio que entra", () => {
  it("lo que entra queda como está, con los espacios de más fuera", () => {
    expect(acortarPremio("Termo", 18)).toBe("Termo");
    expect(acortarPremio("  Kit   de  bienvenida ", 18)).toBe("Kit de bienvenida");
    // Justo en el tope entra: no se corta de más.
    expect(acortarPremio("Dieciocho letras ok", 19)).toBe("Dieciocho letras ok");
    expect(acortarPremio("Dieciocho letras ok", 18)).toBe("Dieciocho letras…");
  });

  it("varias palabras: corta en el último espacio y cuenta los puntos suspensivos", () => {
    expect(acortarPremio("¿Quién presenta primero?", 18)).toBe("¿Quién presenta…");
    expect(acortarPremio("Una notebook con su mochila y el cargador", 18)).toBe("Una notebook con…");
    expect(acortarPremio("Una notebook con su mochila y el cargador", 25)).toBe("Una notebook con su…");
    // Dos palabras que ocupan justo el tope con los puntos: entra.
    expect(acortarPremio("Entradas dobles para el show", 17)).toBe("Entradas dobles…");
  });

  it("una sola palabra larga no se parte: no queda nada", () => {
    expect(acortarPremio("Supercalifragilísticoespialidoso", 18)).toBe("");
    expect(acortarPremio("Supercalifragilísticoespialidoso", 31)).toBe("");
    expect(acortarPremio("Supercalifragilísticoespialidoso", 32)).toBe("Supercalifragilísticoespialidoso");
    // La primera palabra no entra aunque las siguientes sean cortas.
    expect(acortarPremio("Electrodomésticos para la casa", 10)).toBe("");
  });

  it("cuenta letras, no unidades: las tildes y los emojis valen una", () => {
    // 18 letras con tilde justas: entra sin cortar.
    expect(acortarPremio("Camión de juguetes ñ", 20)).toBe("Camión de juguetes ñ");
    // Diez emojis y nueve espacios son 19 letras: con 18 se cortan en el espacio y quedan nueve emojis.
    expect(acortarPremio(Array(10).fill("🎁").join(" "), 18)).toBe(`${Array(9).fill("🎁").join(" ")}…`);
    // Un emoji compuesto (bandera) no se parte nunca: se corta solo entre palabras.
    expect(acortarPremio("🇧🇴 Viaje a Uyuni con hospedaje", 12)).toBe("🇧🇴 Viaje a…");
    // Una letra con tilde escrita en dos piezas (a y acento) tampoco se parte.
    const cadena = "Cámara de fotos instantanea";
    const corte = acortarPremio(cadena, 14);
    expect(corte).toBe("Cámara de…");
  });

  it("con signos de pregunta o exclamación al principio, cuenta y corta igual", () => {
    expect(acortarPremio("¡Gran premio sorpresa para todos!", 20)).toBe("¡Gran premio…");
    expect(acortarPremio("¿Quién presenta primero?", 6)).toBe("");
    expect(acortarPremio("¿Quién presenta primero?", 7)).toBe("¿Quién…");
  });

  it("no deja una coma ni un punto colgando delante de los puntos suspensivos", () => {
    expect(acortarPremio("Una notebook, con mochila y cargador", 17)).toBe("Una notebook…");
    expect(acortarPremio("Premio: una bici nueva", 9)).toBe("Premio…");
    expect(acortarPremio("Sorteo - gran final del año", 8)).toBe("Sorteo…");
  });

  it("vacío o solo espacios: vacío", () => {
    expect(acortarPremio("", 18)).toBe("");
    expect(acortarPremio("   \n ", 18)).toBe("");
  });

  it("nunca devuelve más del tope ni una palabra por la mitad, para cualquier tope", () => {
    const frases = [
      "¿Quién presenta primero?",
      "Una notebook con su mochila y el cargador",
      "Supercalifragilísticoespialidoso",
      "🎁 Kit de bienvenida 🎁 para la comunidad entera",
      "Cámara de fotos instantanea con rollo",
      "A B C D E F G H I J K L M N",
      "¡Gran premio sorpresa para todos!!",
    ];
    for (const frase of frases) {
      const limpia = frase.trim().replace(/\s+/g, " ");
      for (let max = 1; max <= 60; max++) {
        const r = acortarPremio(frase, max);
        const donde = `${frase} (${max}): ${r}`;
        expect(Array.from(r).length, donde).toBeLessThanOrEqual(max);
        if (r === "" || r === limpia) continue;
        expect(r.endsWith("…"), donde).toBe(true);
        const trozo = r.slice(0, -1);
        // Lo que queda son palabras enteras del principio: el resto empieza en un espacio.
        expect(limpia.startsWith(trozo), donde).toBe(true);
        expect(limpia.charAt(trozo.length), donde).toMatch(/\s|[,.:\-–—]/);
      }
    }
  });
});

describe("premioQueEntra: qué texto probar según lo que midió la pantalla", () => {
  const premio = "Una notebook con su mochila y el cargador";

  it("si el premio entero entra, es lo único que se prueba", () => {
    const probados: string[] = [];
    const r = premioQueEntra(premio, (t) => (probados.push(t), true));
    expect(r).toBe(premio);
    expect(probados).toEqual([premio]);
  });

  it("si no entra, devuelve la versión más larga cortada entre palabras que sí entra", () => {
    const esperado: Array<[number, string]> = [
      [3, ""],
      [4, "Una…"],
      [10, "Una…"],
      [16, "Una notebook…"],
      [17, "Una notebook con…"],
      [19, "Una notebook con…"],
      [20, "Una notebook con su…"],
      [25, "Una notebook con su…"],
      [30, "Una notebook con su mochila y…"],
      [40, "Una notebook con su mochila y el…"],
    ];
    for (const [ancho, texto] of esperado) {
      expect(premioQueEntra(premio, (t) => Array.from(t).length <= ancho), `ancho ${ancho}`).toBe(texto);
    }
  });

  it("si ni la primera palabra entra, devuelve vacío", () => {
    expect(premioQueEntra(premio, () => false)).toBe("");
    expect(premioQueEntra("Supercalifragilísticoespialidoso", (t) => t.length <= 10)).toBe("");
  });

  it("prueba pocas veces aunque el premio tenga muchas palabras, y nunca más del tope de vueltas", () => {
    const largo = Array.from({ length: 30 }, (_, i) => `p${i}`).join(" ");
    let vueltas = 0;
    premioQueEntra(largo, (t) => (vueltas++, t.length <= 40));
    // El entero, y después una búsqueda por mitades: unas siete pruebas, no treinta.
    expect(vueltas).toBeLessThanOrEqual(8);
    vueltas = 0;
    premioQueEntra(Array.from({ length: 5000 }, (_, i) => `p${i}`).join(" "), (t) => (vueltas++, t.length <= 40));
    expect(vueltas).toBeLessThanOrEqual(14);
  });

  it("vacío no prueba nada", () => {
    let vueltas = 0;
    expect(premioQueEntra("  ", () => (vueltas++, true))).toBe("");
    expect(vueltas).toBe(0);
  });
});

describe("la línea de la barra con el premio", () => {
  it("la línea del paso 2 entra en un celular de 320 px con un premio corto", () => {
    // 292 px de ancho útil, a unos 6,3 px por letra normal de 13 px (la barra baja a 13 px en 340 px o menos).
    for (const l of ["es", "en"] as const) {
      const s = (k: string): string => T[l][k] as string;
      const paso = s("sigPaso").replace("{n}", "2");
      const lista = s("sigLista").replace("{n}", "18");
      const linea = lineaDelPaso(paso, detalleDeLista(lista, "Termo", s("sigSinPremio")));
      const sinPremio = lineaDelPaso(paso, detalleDeLista(lista, "", s("sigSinPremio")));
      expect(Math.max(linea.length, sinPremio.length), l).toBeLessThanOrEqual(46);
    }
  });

  it("con las dos cuentas, la línea del paso 2 entra en dos renglones de un celular de 320 px", () => {
    // Los mismos 46 caracteres por renglón de la prueba de arriba, partiendo por los espacios como el navegador:
    // una palabra que no entra baja entera al renglón siguiente. Cuentas de cuatro cifras, las más largas
    // razonables para una sala, y el premio más largo que deja pasar detalleDeLista.
    const renglones = (texto: string, ancho = 46): number => {
      let n = 1;
      let usado = 0;
      for (const palabra of texto.split(" ")) {
        const largo = Array.from(palabra).length;
        if (usado === 0) usado = largo;
        else if (usado + 1 + largo <= ancho) usado += 1 + largo;
        else {
          n++;
          usado = largo;
        }
      }
      return n;
    };
    // Un premio de muchas palabras y uno de una sola palabra larga, que no se puede partir.
    const premios = ["Una notebook con su mochila y el cargador", "Supercalifragilístico", ""];
    for (const l of ["es", "en"] as const) {
      const s = (k: string): string => T[l][k] as string;
      const paso = s("sigPaso").replace("{n}", "2");
      for (const clave of ["sigListaPart", "sigListaPartUno", "sigListaTurnos", "sigListaTurnosUno"]) {
        const cuentas = s(clave).replace("{p}", "9999").replace("{n}", "9999");
        // Con varias participaciones se nombra el premio (o "sin premio"); un orden de turnos no lo lleva.
        const detalles = clave.startsWith("sigListaPart") ? premios.map((p) => detalleDeLista(cuentas, p, s("sigSinPremio"))) : [cuentas];
        for (const detalle of detalles) {
          const linea = lineaDelPaso(paso, detalle);
          expect(renglones(linea), `${l}: ${linea}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("los textos del indicador y de la barra existen en los dos idiomas, con su número", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of ["paso1", "paso2", "paso3", "paso4", "pasosAria", "pasoHecho", "pasoActual", "sigRegion"]) {
        expect(typeof T[l][k], `${l}.${k}`).toBe("string");
      }
      expect(T[l].sigPaso, l).toContain("{n}");
      expect(T[l].sigLista, l).toContain("{n}");
      expect(T[l].sigListaPart, l).toContain("{p}");
      expect(T[l].sigListaPart, l).toContain("{n}");
    }
  });
});

describe("la lista sellada", () => {
  it("la cuenta regresiva del botón de sortear dice cuánto falta", () => {
    expect(T.es.drawIn("0:25")).toBe("Se habilita en 0:25");
    expect(T.en.drawIn("0:25")).toBe("Unlocks in 0:25");
  });

  it("el juego elegido y 'Cambiar de juego' existen en los dos idiomas", () => {
    for (const l of ["es", "en"] as const) {
      expect(typeof T[l].juegoElegido, `${l}.juegoElegido`).toBe("string");
      expect(typeof T[l].cambiarJuego, `${l}.cambiarJuego`).toBe("string");
    }
  });
});

describe("lo que sigue después del ganador", () => {
  it("el botón dice 'siguiente' y cuántos quedan, en los dos idiomas", () => {
    expect(T.es.againSin(16)).toMatch(/Siguiente premio/);
    expect(T.es.againSin(16)).toMatch(/16/);
    expect(T.en.againSin(16)).toMatch(/Next prize/);
    expect(T.en.againSin(16)).toMatch(/16/);
  });

  it("el contador no se separa de su número: en un celular angosto el botón se parte en 'Siguiente premio' y '(quedan 16)', nunca queda '16)' solo", () => {
    // A 360 y 375 px el botón no entra en un renglón. Con un espacio común entre la palabra y el número, el segundo renglón podía quedar con el número suelto.
    expect(T.es.againSin(16)).toBe("Siguiente premio (quedan\xa016)");
    expect(T.en.againSin(16)).toBe("Next prize (16\xa0left)");
  });

  it("el título y el aviso de cuántos quedan existen en los dos idiomas", () => {
    for (const l of ["es", "en"] as const) {
      expect(typeof T[l].againTitle).toBe("string");
      expect(typeof T[l].againTitleFin).toBe("string");
      expect(T[l].againLeft(16)).toMatch(/16/);
      expect(T[l].againLeft(1)).toMatch(/1/);
    }
  });
});
