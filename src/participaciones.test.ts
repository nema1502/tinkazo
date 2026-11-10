import { describe, expect, it } from "vitest";
import { T, type RulesParams } from "./i18n";
import { canonicalList, encodeList, listHash } from "./protocol/canonical";
import { bytesToHex } from "./protocol/quicknet";
import {
  TOPE_POR_PERSONA,
  agruparPorPersona,
  canonicalDelReparto,
  cierraComoReparto,
  contar,
  esReparto,
  leerLinea,
  lineasConNumero,
  nombreDePersona,
  personasDelCuadro,
  ponerParticipaciones,
  renumerarSufijos,
  repartir,
  salieronVariasVeces,
  seCuentaPorPersona,
  sinLasPersonasQueSalieron,
  terminaEnNumero,
} from "./participaciones";

/**
 * El reparto de participaciones. La garantía de justicia, en cada caso: lo que queda en el cuadro, pasado por
 * `canonicalList` (lo que el sello normaliza), es exactamente lo que se sella, en el mismo orden.
 */

describe("leerLinea: «Nombre, n»", () => {
  it("el nombre va antes de la primera coma y n después de la última", () => {
    expect(leerLinea("Ana Quispe, 3")).toEqual({ nombre: "Ana Quispe", participaciones: 3 });
    expect(leerLinea("Ana Quispe,3")).toEqual({ nombre: "Ana Quispe", participaciones: 3 });
    expect(leerLinea("  Ana Quispe ,  3  ")).toEqual({ nombre: "Ana Quispe", participaciones: 3 });
    // «Rojas, Mateo, 3» no es un reparto: repartiría a «Rojas» con 3 y fundiría a dos personas en una.
    expect(leerLinea("Rojas, Mateo, 3")).toEqual({ nombre: "Rojas", participaciones: null });
  });

  it("sin coma no hay número: la línea es un nombre y nada más", () => {
    expect(leerLinea("Ana Quispe")).toEqual({ nombre: "Ana Quispe", participaciones: null });
    expect(leerLinea("Ana Quispe (1/3)")).toEqual({ nombre: "Ana Quispe (1/3)", participaciones: null });
  });

  it("lo que no es un entero de 1 al tope no cuenta", () => {
    expect(leerLinea("Ana, tres").participaciones).toBeNull();
    expect(leerLinea("Ana, 0").participaciones).toBeNull();
    expect(leerLinea("Ana, 2.5").participaciones).toBeNull();
    expect(leerLinea("Ana, -3").participaciones).toBeNull();
    expect(leerLinea("Ana, 1e2").participaciones).toBeNull();
    expect(leerLinea(`Ana, ${TOPE_POR_PERSONA + 1}`).participaciones).toBeNull();
    expect(leerLinea("Ana, 10").participaciones).toBe(TOPE_POR_PERSONA);
  });

  it("un nombre de menos de 2 caracteres no se sella: no se le reparte nada", () => {
    expect(leerLinea(", 3")).toEqual({ nombre: "", participaciones: null });
    expect(leerLinea("A, 3")).toEqual({ nombre: "A", participaciones: null });
  });

  it("los tabuladores no molestan: se recortan como los espacios", () => {
    expect(leerLinea("Ana Quispe\t,\t3")).toEqual({ nombre: "Ana Quispe", participaciones: 3 });
    // Sin coma no hay número, aunque haya tabulador de por medio.
    expect(leerLinea("Ana Quispe\t3").participaciones).toBeNull();
  });
});

describe("terminaEnNumero: el aviso es una oferta", () => {
  it("una coma y un número al final", () => {
    for (const linea of ["Ana, 3", "Ana,3", "Ana,  25  ", "Quispe, 25", "Ana, 0"]) expect(terminaEnNumero(linea), linea).toBe(true);
  });

  it("sin coma, sin número, con algo raro después de la coma o con más de una coma", () => {
    for (const linea of ["Ana", "Ana, tres", "Ana, 2.5", "Ana (1/3)", "Ana, 3 años", "Rojas, Mateo, 3", "Pérez, Ana, 2"])
      expect(terminaEnNumero(linea), linea).toBe(false);
  });

  it("cuenta cuántas líneas del texto la traen", () => {
    expect(lineasConNumero("Ana, 3\nBeto\nCarla, 2\nDario, 25")).toBe(3);
    expect(lineasConNumero("Ana\nBeto")).toBe(0);
  });
});

describe("ponerParticipaciones: el contador reescribe el cuadro en el acto", () => {
  it("subir: la línea pasa a ser una por participación, en su lugar", () => {
    expect(ponerParticipaciones("Beto Rojas\nAna Quispe\nCarla Flores", "Ana Quispe", 3)).toBe(
      "Beto Rojas\nAna Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nCarla Flores",
    );
  });

  it("bajar y volver a 1: con 1 queda el nombre a secas", () => {
    const enTres = "Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto Rojas";
    expect(ponerParticipaciones(enTres, "Ana Quispe", 2)).toBe("Ana Quispe (1/2)\nAna Quispe (2/2)\nBeto Rojas");
    expect(ponerParticipaciones(enTres, "Ana Quispe", 1)).toBe("Ana Quispe\nBeto Rojas");
  });

  it("el número se corta entre 1 y el tope", () => {
    const enDiez = ponerParticipaciones("Ana Quispe\nBeto Rojas", "Ana Quispe", 99);
    expect(enDiez.split("\n")).toHaveLength(11);
    expect(enDiez).toContain(`Ana Quispe (10/${TOPE_POR_PERSONA})`);
    expect(ponerParticipaciones("Ana Quispe\nBeto Rojas", "Ana Quispe", 0)).toBe("Ana Quispe\nBeto Rojas");
  });

  it("una persona repetida en dos líneas se junta en la primera, y el orden se conserva", () => {
    expect(ponerParticipaciones("Ana Quispe\nBeto Rojas\nAna Quispe", "Ana Quispe", 2)).toBe(
      "Ana Quispe (1/2)\nAna Quispe (2/2)\nBeto Rojas",
    );
    // Sus líneas ya repartidas, separadas por otra persona, también se juntan en la primera.
    expect(ponerParticipaciones("Ana Quispe (1/2)\nBeto Rojas\nAna Quispe (2/2)", "Ana Quispe", 3)).toBe(
      "Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto Rojas",
    );
  });

  it("los nombres con paréntesis propios se conservan enteros", () => {
    const texto = "Ana (La Grande)\nBeto Rojas";
    expect(ponerParticipaciones(texto, "Ana (La Grande)", 2)).toBe("Ana (La Grande) (1/2)\nAna (La Grande) (2/2)\nBeto Rojas");
    expect(ponerParticipaciones("Ana (La Grande) (1/2)\nAna (La Grande) (2/2)\nBeto Rojas", "Ana (La Grande)", 1)).toBe(texto);
  });

  it("las mayúsculas y los acentos del nombre quedan como estaban", () => {
    expect(ponerParticipaciones("MARÍA José Ñuñez\nBeto Rojas", "MARÍA José Ñuñez", 2)).toBe(
      "MARÍA José Ñuñez (1/2)\nMARÍA José Ñuñez (2/2)\nBeto Rojas",
    );
  });

  it("un nombre que ya parece un sufijo también responde al contador", () => {
    // La línea sellada se lee como «Ana (1/2)» con una participación escrita a mano: buscar a la persona
    // sacándole el sufijo no coincidía con ninguna línea y el contador no hacía nada.
    expect(ponerParticipaciones("Ana (1/2) (1/3)\nBeto Rojas", "Ana (1/2)", 2)).toBe(
      "Ana (1/2) (1/2)\nAna (1/2) (2/2)\nBeto Rojas",
    );
  });

  it("una línea con dos comas entra por el nombre que lee el sello", () => {
    expect(ponerParticipaciones("Pérez, Ana, 2\nBeto Rojas", "Pérez", 2)).toBe("Pérez (1/2)\nPérez (2/2)\nBeto Rojas");
  });

  it("si la persona no está, el texto no cambia", () => {
    const texto = "Ana Quispe\nBeto Rojas";
    expect(ponerParticipaciones(texto, "Carla Flores", 3)).toBe(texto);
  });

  it("lo que queda en el cuadro, pasado por canonicalList, es exactamente lo esperado", () => {
    const casos: Array<[string, string, number, string[]]> = [
      ["Ana Quispe\nBeto Rojas\nCarla Flores", "Ana Quispe", 3, ["Ana Quispe (1/3)", "Ana Quispe (2/3)", "Ana Quispe (3/3)", "Beto Rojas", "Carla Flores"]],
      ["Ana Quispe\nBeto Rojas\nCarla Flores", "Carla Flores", 2, ["Ana Quispe", "Beto Rojas", "Carla Flores (1/2)", "Carla Flores (2/2)"]],
      ["Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto Rojas", "Ana Quispe", 1, ["Ana Quispe", "Beto Rojas"]],
    ];
    for (const [texto, persona, n, esperado] of casos) {
      expect(canonicalList(ponerParticipaciones(texto, persona, n)), texto).toEqual(esperado);
    }
    // Con todas en 1, la lista que se sella es idéntica a la de la lista común.
    const comun = "Ana Quispe\nBeto Rojas\nCarla Flores";
    let texto = ponerParticipaciones(comun, "Ana Quispe", 3);
    texto = ponerParticipaciones(texto, "Carla Flores", 2);
    texto = ponerParticipaciones(texto, "Ana Quispe", 1);
    texto = ponerParticipaciones(texto, "Carla Flores", 1);
    expect(texto).toBe(comun);
    expect(canonicalList(texto)).toEqual(canonicalList(comun));
  });
});

describe("personasDelCuadro: las filas del panel salen del cuadro", () => {
  it("junta las líneas de cada persona, en el orden de la lista", () => {
    expect(personasDelCuadro("Beto Rojas\nAna Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nCarla Flores")).toEqual([
      { nombre: "Beto Rojas", veces: 1 },
      { nombre: "Ana Quispe", veces: 3 },
      { nombre: "Carla Flores", veces: 1 },
    ]);
  });

  it("una línea con comas entra por el nombre que lee el sello", () => {
    expect(personasDelCuadro("Pérez, Ana, 2\nBeto Rojas")).toEqual([
      { nombre: "Pérez", veces: 1 },
      { nombre: "Beto Rojas", veces: 1 },
    ]);
    expect(personasDelCuadro("")).toEqual([]);
  });
});

describe("repartir: el cuadro pasa a tener una línea por participación", () => {
  it("«Ana Quispe, 3» son tres líneas; quien no trae número queda como está", () => {
    expect(repartir("Ana Quispe, 3\nBeto")).toBe("Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto");
    expect(repartir("Beto\nAna Quispe, 3")).toBe("Beto\nAna Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)");
  });

  it("los repetidos se suman y el reparto queda en el lugar de la primera aparición", () => {
    expect(repartir("Ana, 3\nAna, 2")).toBe([1, 2, 3, 4, 5].map((k) => `Ana (${k}/5)`).join("\n"));
    expect(repartir("Ana, 2\nBeto\nAna, 3")).toBe(`${[1, 2, 3, 4, 5].map((k) => `Ana (${k}/5)`).join("\n")}\nBeto`);
    // Una línea sin número del mismo nombre vale una participación más.
    expect(repartir("Ana, 3\nAna")).toBe([1, 2, 3, 4].map((k) => `Ana (${k}/4)`).join("\n"));
  });

  it("una persona con una sola participación queda con su nombre a secas", () => {
    expect(repartir("Ana, 1")).toBe("Ana");
    expect(repartir("Ana, 1\nBeto, 1")).toBe("Ana\nBeto");
  });

  it("una lista donde todos tienen 1 queda idéntica, byte a byte: sin números no cambia nada", () => {
    const lista = "Ana Quispe\nBeto Rojas\nCarla Flores";
    expect(repartir(lista)).toBeNull();
    // Y la que trae «, 1» explícito sella lo mismo que hoy: la lista canónica no cambia.
    const conUnos = "Ana Quispe, 1\nBeto Rojas, 1";
    expect(canonicalList(conUnos).join("\n")).toBe(canonicalDelReparto(conUnos).join("\n"));
    expect(encodeList(canonicalList(conUnos))).toEqual(encodeList(canonicalDelReparto(conUnos)));
  });

  it("más del tope no se reparte: la línea queda como está (puede ser la edad o la mesa)", () => {
    expect(repartir("Ana, 11")).toBeNull();
    expect(repartir("Beto, 3\nAna, 11")).toBe("Beto (1/3)\nBeto (2/3)\nBeto (3/3)\nAna, 11");
  });

  it("«Apellido, Nombre, n» no se reparte: dos personas con el mismo apellido no se funden", () => {
    expect(repartir("Pérez, Ana, 2\nPérez, Luis, 3")).toBeNull();
    // Mezclada con líneas de una coma, la de dos comas queda como está y no cuenta para el aviso.
    expect(repartir("Pérez, Ana, 2\nBeto, 3")).toBe("Pérez, Ana, 2\nBeto (1/3)\nBeto (2/3)\nBeto (3/3)");
  });

  it("un nombre que ya se llama «Ana Quispe (1/3)» es un nombre más, no un sufijo", () => {
    expect(repartir("Ana Quispe (1/3)\nBeto, 2")).toBe("Ana Quispe (1/3)\nBeto (1/2)\nBeto (2/2)");
    // Y si choca con una línea del reparto, no se repite: el cuadro muestra lo que se sella.
    expect(repartir("Ana (1/3)\nAna, 3")).toBe("Ana (1/3)\nAna (2/3)\nAna (3/3)");
  });

  it("repartido una vez, ya está: la segunda no cambia nada", () => {
    const primera = repartir("Ana, 3\nBeto, 2");
    expect(primera).toBeTruthy();
    expect(repartir(primera as string)).toBeNull();
  });

  it("dos líneas que el sello funde en un solo nombre quedan en una sola: gana la primera", () => {
    const casos: Array<[string, string[]]> = [
      // El mismo nombre con notas distintas: el sello toma «Beto» una sola vez.
      ["Ana, 2\nBeto, mesa 1\nBeto, mesa 2", ["Ana (1/2)", "Ana (2/2)", "Beto"]],
      // El mismo nombre con nota y sin nota.
      ["Ana, 2\nBeto, mesa 1\nBeto", ["Ana (1/2)", "Ana (2/2)", "Beto"]],
      ["Ana, 2\nBeto\nBeto, mesa 1", ["Ana (1/2)", "Ana (2/2)", "Beto"]],
      // Una línea repartida y otra escrita a mano con el mismo nombre y el mismo sufijo.
      ["Beto, mesa 1\nAna, 2\nAna (1/2)", ["Beto", "Ana (1/2)", "Ana (2/2)"]],
      ["Ana (2/3)\nAna, 3", ["Ana (2/3)", "Ana (1/3)", "Ana (3/3)"]],
    ];
    for (const [texto, sellados] of casos) {
      const repartido = repartir(texto);
      expect(repartido, texto).not.toBeNull();
      const lineas = (repartido as string).split("\n").filter((l) => l.trim() !== "");
      // Ni una línea de más que el sello descarte, y los nombres en el mismo orden en que se sellan.
      expect(lineas, texto).toHaveLength(canonicalList(repartido as string).length);
      expect(canonicalList(repartido as string), texto).toEqual(sellados);
    }
    // Gana la primera línea de cada nombre, como en el sello.
    expect(repartir("Ana, 2\nBeto, mesa 1\nBeto, mesa 2")).toBe("Ana (1/2)\nAna (2/2)\nBeto, mesa 1");
  });

  it("la garantía de justicia: lo que queda en el cuadro es exactamente lo que se sella", () => {
    // Ninguna línea se corta ni se repite: todas quedan enteras, en su orden, y son las participaciones de cada persona.
    expect(canonicalDelReparto("Ana Quispe, 3\nBeto\nCarla, 2")).toEqual([
      "Ana Quispe (1/3)", "Ana Quispe (2/3)", "Ana Quispe (3/3)", "Beto", "Carla (1/2)", "Carla (2/2)",
    ]);
    expect(canonicalDelReparto("Rojas, Mateo, 3\nBeto, 2")).toEqual([
      "Rojas", "Beto (1/2)", "Beto (2/2)",
    ]);
    expect(canonicalDelReparto("Ana, 2\nAna\nBeto, 10")).toEqual([
      "Ana (1/3)", "Ana (2/3)", "Ana (3/3)", ...Array.from({ length: 10 }, (_, i) => `Beto (${i + 1}/10)`),
    ]);
    // Y la huella lo firma: lo que quedó en el cuadro después de repartir, pasada por `canonicalList`
    // (lo que el sello normaliza), da exactamente la huella del reparto esperado.
    const texto = "Ana Quispe, 3\nBeto\nCarla, 2";
    expect(bytesToHex(listHash(canonicalList(repartir(texto) as string)))).toBe(bytesToHex(listHash(canonicalDelReparto(texto))));
  });
});

describe("el tope es por persona", () => {
  it("sumar líneas de una misma persona no pasa del tope", () => {
    const tope = Array.from({ length: TOPE_POR_PERSONA }, (_, i) => `Ana (${i + 1}/${TOPE_POR_PERSONA})`).join("\n");
    expect(repartir("Ana, 10\nAna, 10")).toBe(tope);
    expect(repartir("Ana, 6\nAna, 7")).toBe(tope);
    expect(repartir("Ana, 3\nAna, 3")).toBe([1, 2, 3, 4, 5, 6].map((k) => `Ana (${k}/6)`).join("\n"));
  });
});

describe("nombreDePersona y agruparPorPersona: leer los sufijos", () => {
  it("el nombre de la persona es la línea sin su sufijo", () => {
    expect(nombreDePersona("Ana Quispe (2/3)")).toBe("Ana Quispe");
    expect(nombreDePersona("Ana Quispe")).toBe("Ana Quispe");
    expect(nombreDePersona("Ana Quispe (0/3)")).toBe("Ana Quispe (0/3)");
  });

  it("agrupa a quien tiene todas sus participaciones, del 1/m al m/m", () => {
    const nombres = ["Ana (1/3)", "Beto (1/2)", "Ana (2/3)", "Ana (3/3)", "Beto (2/2)"];
    expect(agruparPorPersona(nombres)).toEqual([
      { nombre: "Ana", puestos: [0, 2, 3], coherente: true },
      { nombre: "Beto", puestos: [1, 4], coherente: true },
    ]);
  });

  it("una línea sola sin sufijo es una persona con una participación", () => {
    expect(agruparPorPersona(["Ana", "Beto"])).toEqual([
      { nombre: "Ana", puestos: [0], coherente: true },
      { nombre: "Beto", puestos: [1], coherente: true },
    ]);
  });

  it("si los sufijos no cierran, no se inventa nada: cada línea queda tal cual", () => {
    // Falta la (2/3).
    expect(agruparPorPersona(["Ana (1/3)", "Ana (3/3)", "Beto"])).toEqual([
      { nombre: "Ana (1/3)", puestos: [0], coherente: false },
      { nombre: "Ana (3/3)", puestos: [1], coherente: false },
      { nombre: "Beto", puestos: [2], coherente: true },
    ]);
    // Una sola participación con sufijo de tres no agrupa a la persona con tres.
    expect(agruparPorPersona(["Ana (1/3)", "Ana", "Beto"])).toEqual([
      { nombre: "Ana (1/3)", puestos: [0], coherente: false },
      { nombre: "Ana", puestos: [1], coherente: false },
      { nombre: "Beto", puestos: [2], coherente: true },
    ]);
    // Totales distintos tampoco.
    expect(agruparPorPersona(["Ana (1/2)", "Ana (2/3)"])).toEqual([
      { nombre: "Ana (1/2)", puestos: [0], coherente: false },
      { nombre: "Ana (2/3)", puestos: [1], coherente: false },
    ]);
  });

  it("lo que no agrupa se muestra donde está en la lista sellada, y un grupo que cierra, en su primer puesto", () => {
    // Los sufijos de Ana no cierran: sus líneas no salen juntas antes que Beto, sino cada una en su puesto.
    const mezclados = ["Ana (1/3)", "Beto", "Ana (3/3)", "Carla"];
    expect(agruparPorPersona(mezclados)).toEqual([
      { nombre: "Ana (1/3)", puestos: [0], coherente: false },
      { nombre: "Beto", puestos: [1], coherente: true },
      { nombre: "Ana (3/3)", puestos: [2], coherente: false },
      { nombre: "Carla", puestos: [3], coherente: true },
    ]);
    // El orden en que se muestra (cada entrada, por su primer puesto) es el orden de la lista.
    expect(agruparPorPersona(mezclados).flatMap((g) => g.puestos)).toEqual([0, 1, 2, 3]);
    // Un grupo que sí cierra aparece una sola vez, en el puesto de su primera línea, entre líneas sueltas.
    const conGrupo = ["Ana (1/3)", "Beto (1/2)", "Beto (2/2)", "Ana (3/3)", "Carla (1/2)", "Carla (2/2)"];
    expect(agruparPorPersona(conGrupo)).toEqual([
      { nombre: "Ana (1/3)", puestos: [0], coherente: false },
      { nombre: "Beto", puestos: [1, 2], coherente: true },
      { nombre: "Ana (3/3)", puestos: [3], coherente: false },
      { nombre: "Carla", puestos: [4, 5], coherente: true },
    ]);
    expect(agruparPorPersona(conGrupo).map((g) => g.puestos[0])).toEqual([0, 1, 3, 4]);
  });

  it("el reparto y la agrupación se entienden: lo que uno escribe, el otro lo lee", () => {
    const texto = "Ana, 3\nBeto\nCarla, 2\nCarla";
    const sellado = canonicalDelReparto(texto);
    const grupos = agruparPorPersona(sellado);
    expect(grupos.map((g) => [g.nombre, g.puestos.length])).toEqual([
      ["Ana", 3],
      ["Beto", 1],
      ["Carla", 3],
    ]);
  });
});

describe("contar: personas y participaciones", () => {
  it("una lista común tiene las dos iguales", () => {
    expect(contar(["Ana", "Beto", "Carla"])).toEqual({ personas: 3, participaciones: 3 });
    expect(contar([])).toEqual({ personas: 0, participaciones: 0 });
  });

  it("una lista repartida dice las dos cosas", () => {
    const sellado = canonicalDelReparto("Ana, 3\nBeto\nCarla, 2");
    expect(contar(sellado)).toEqual({ personas: 3, participaciones: 6 });
  });

  it("con sufijos que no cierran, la persona es la misma: se cuenta por nombre base, como se quita", () => {
    expect(contar(["Ana (1/3)", "Ana (3/3)", "Beto"])).toEqual({ personas: 2, participaciones: 3 });
    // Una sola persona con muchas líneas no alcanza para sellar, aunque los sufijos no cierren.
    expect(contar(["Ana (1/3)", "Ana (3/3)"])).toEqual({ personas: 1, participaciones: 2 });
    expect(contar(["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Ana (1/2)", "Ana (2/2)"])).toEqual({ personas: 1, participaciones: 5 });
    // Y un nombre a mano con forma de sufijo no se cuenta como otra persona.
    expect(contar(["Ana", "Ana (1/2)", "Luis"])).toEqual({ personas: 2, participaciones: 3 });
  });

  it("sin leer por persona, la lista se cuenta como siempre: cada línea, una persona", () => {
    expect(contar(["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto"], false)).toEqual({ personas: 4, participaciones: 4 });
    expect(contar(["Grupo (1/2)", "Grupo (2/2)", "Otro"], false)).toEqual({ personas: 3, participaciones: 3 });
  });
});

describe("esReparto: las páginas que no conocen la bandera de quien selló", () => {
  it("un reparto entero: cada persona con todos sus sufijos y alguien con varias", () => {
    expect(esReparto(["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto (1/2)", "Beto (2/2)"])).toBe(true);
    expect(esReparto(["Grupo (1/2)", "Grupo (2/2)"])).toBe(true);
    expect(esReparto([])).toBe(false);
  });

  it("cualquier otra lista no lo es: tal cual, como llegó en la lista sellada", () => {
    // Una línea sin sufijo rompe el reparto: «Grupo (1/2)» puede ser solo un nombre.
    expect(esReparto(["Grupo (1/2)", "Grupo (2/2)", "Otro"])).toBe(false);
    // Sufijos que no cierran: falta el (2/3) de Ana y el (1/2) de Beto.
    expect(esReparto(["Ana (1/3)", "Ana (3/3)", "Beto (2/2)"])).toBe(false);
    // Nadie con varias: es una lista común con nombres que traen paréntesis.
    expect(esReparto(["Ana (1/1)", "Beto (1/1)"])).toBe(false);
    expect(esReparto(["Ana", "Beto"])).toBe(false);
  });
});

describe("cierraComoReparto: la lista sellada con el modo de varias participaciones", () => {
  const lista = ["Ana Quispe (1/3)", "Ana Quispe (2/3)", "Ana Quispe (3/3)", "Beto Rojas", "Carla Suárez (1/2)", "Carla Suárez (2/2)", "Dana Flores"];

  it("la lista de varias participaciones cierra: cada grupo coherente y alguien con más de una", () => {
    expect(cierraComoReparto(lista)).toBe(true);
  });

  it("con una línea de Ana borrada no cierra: su grupo queda incompleto", () => {
    expect(cierraComoReparto(["Ana Quispe (1/3)", "Ana Quispe (3/3)", "Beto Rojas", "Carla Suárez (1/2)", "Carla Suárez (2/2)", "Dana Flores"])).toBe(
      false,
    );
  });

  it("con un sufijo repetido no cierra: el grupo no trae del 1 al total sin repetir", () => {
    expect(cierraComoReparto(["Ana Quispe (1/3)", "Ana Quispe (1/3)", "Ana Quispe (3/3)", "Beto Rojas"])).toBe(false);
  });

  it("todos sin sufijo no cierra: nadie tiene más de una", () => {
    expect(cierraComoReparto(["Ana Quispe", "Beto Rojas", "Carla Suárez"])).toBe(false);
    expect(cierraComoReparto([])).toBe(false);
  });

  it("una lista común con forma de reparto también cierra: por eso además se exige el parámetro", () => {
    expect(cierraComoReparto(["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Otro", "Una más"])).toBe(true);
  });
});

describe("renumerarSufijos: borrar a mano una línea del reparto", () => {
  const cierran = (texto: string): boolean => agruparPorPersona(canonicalList(texto)).every((g) => g.coherente);

  it("borrar la del medio: «Ana (1/3)» y «Ana (3/3)» pasan a «Ana (1/2)» y «Ana (2/2)»", () => {
    const antes = "Ana (1/3)\nAna (3/3)\nBeto";
    expect(cierran(antes)).toBe(false);
    const despues = renumerarSufijos(antes);
    expect(despues).toBe("Ana (1/2)\nAna (2/2)\nBeto");
    expect(cierran(despues)).toBe(true);
    expect(contar(canonicalList(despues), true)).toEqual({ personas: 2, participaciones: 3 });
  });

  it("borrar la última o la primera también", () => {
    expect(renumerarSufijos("Ana (1/3)\nAna (2/3)\nBeto")).toBe("Ana (1/2)\nAna (2/2)\nBeto");
    expect(renumerarSufijos("Beto\nAna (2/3)\nAna (3/3)")).toBe("Beto\nAna (1/2)\nAna (2/2)");
  });

  it("cada persona queda en el lugar de su primera línea y las demás no se tocan", () => {
    const antes = "Carla\nAna (1/3)\nDani (1/2)\nAna (3/3)\nDani (2/2)";
    expect(renumerarSufijos(antes)).toBe("Carla\nAna (1/2)\nAna (2/2)\nDani (1/2)\nDani (2/2)");
  });

  it("lo que ya cierra, lo que no tiene sufijo y una línea suelta quedan idénticos", () => {
    for (const texto of ["Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto", "Ana\nBeto\nCarla", "Ana (2/3)\nBeto", "Grupo 4 (1/2)\nOtro", ""]) {
      expect(renumerarSufijos(texto), texto).toBe(texto);
    }
  });

  it("no inventa: totales distintos o una mezcla con el nombre a secas se dejan como están", () => {
    for (const texto of ["Ana (1/3)\nAna (2/2)\nBeto", "Ana (1/3)\nAna (3/3)\nAna"]) expect(renumerarSufijos(texto), texto).toBe(texto);
  });

  it("conserva lo que viene después de la coma en las líneas que no toca", () => {
    expect(renumerarSufijos("Beto, 3\nAna (1/3)\nAna (3/3)")).toBe("Beto, 3\nAna (1/2)\nAna (2/2)");
  });
});

describe("seCuentaPorPersona: la única regla para contar la lista sellada", () => {
  // El reparto de siempre con el modo de varias: Ana con tres, Beto y Carla con una y sin sufijo.
  const mixta = ["Ana Quispe (1/3)", "Ana Quispe (2/3)", "Ana Quispe (3/3)", "Beto Rojas", "Carla Suarez"];

  it("con los modos a la vista, un reparto con nombres a secas se cuenta por persona", () => {
    expect(seCuentaPorPersona(mixta, true)).toBe(true);
    expect(contar(mixta, seCuentaPorPersona(mixta, true))).toEqual({ personas: 3, participaciones: 5 });
  });

  it("con los modos apagados, la misma lista se cuenta como siempre: cada línea, una persona", () => {
    expect(seCuentaPorPersona(mixta, false)).toBe(false);
    expect(contar(mixta, seCuentaPorPersona(mixta, false))).toEqual({ personas: 5, participaciones: 5 });
  });

  it("un reparto entero se cuenta por persona con los modos o sin ellos, como en la verificación", () => {
    const entero = ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto (1/2)", "Beto (2/2)"];
    expect(seCuentaPorPersona(entero, false)).toBe(true);
    expect(seCuentaPorPersona(entero, true)).toBe(true);
  });

  it("sufijos que no cierran no se agrupan ni con los modos a la vista: lo mismo que la verificación", () => {
    expect(seCuentaPorPersona(["Ana (1/3)", "Ana (3/3)", "Beto"], true)).toBe(false);
    expect(seCuentaPorPersona(["Ana", "Beto", "Carla"], true)).toBe(false);
  });
});

describe("salieronVariasVeces: quien salió más de una vez", () => {
  const nombres = ["Ana (1/3)", "Beto", "Ana (2/3)", "Carla"];

  it("la persona entera, con cuántas veces y con qué premios", () => {
    expect(salieronVariasVeces(nombres, [2, 0])).toEqual([{ nombre: "Ana", veces: 2, puestos: [0, 1] }]);
    expect(salieronVariasVeces(nombres, [0, 1, 2, 3])).toEqual([{ nombre: "Ana", veces: 2, puestos: [0, 2] }]);
  });

  it("una vez cada una no es varias", () => {
    expect(salieronVariasVeces(nombres, [0, 1])).toEqual([]);
    expect(salieronVariasVeces(nombres, [])).toEqual([]);
  });

  it("sin leer por persona, nadie salió varias veces: como siempre", () => {
    expect(salieronVariasVeces(nombres, [0, 2], false)).toEqual([]);
  });
});

describe("sinLasPersonasQueSalieron: «No está» y «Siguiente premio» sacan a la persona entera", () => {
  const nombres = ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla"];

  it("sale con todas sus participaciones, no una por una", () => {
    expect(sinLasPersonasQueSalieron(nombres, [1])).toEqual(["Beto", "Carla"]);
    expect(sinLasPersonasQueSalieron(nombres, [0, 4])).toEqual(["Beto"]);
  });

  it("el reemplazo nunca es otra participación de quien no está: sus líneas ya no están", () => {
    const quedan = sinLasPersonasQueSalieron(nombres, [2]);
    expect(quedan.some((n) => nombreDePersona(n) === "Ana")).toBe(false);
  });

  it("una lista común se comporta como siempre: sale la línea que salió", () => {
    expect(sinLasPersonasQueSalieron(["Ana", "Beto", "Carla"], [0])).toEqual(["Beto", "Carla"]);
  });

  it("sin leer por persona, sale la línea que salió, aunque su persona tenga más líneas", () => {
    // Sale «Ana (2/3)» sola: sus otras dos líneas siguen, como siempre.
    expect(sinLasPersonasQueSalieron(nombres, [1], false)).toEqual(["Ana (1/3)", "Ana (3/3)", "Beto", "Carla"]);
    expect(sinLasPersonasQueSalieron(nombres, [0, 3], false)).toEqual(["Ana (2/3)", "Ana (3/3)", "Carla"]);
  });
});

describe("los textos no mienten: personas y participaciones", () => {
  const base: RulesParams = {
    prize: "Termo",
    count: 2,
    winners: 1,
    listHash: "ab".repeat(32),
    sealedAt: "9 de noviembre de 2026, 21:04:10 GMT-4",
    round: 32254977,
    roundAt: "9 de noviembre de 2026, 21:05:00 GMT-4",
    network: "testnet",
    verifyUrl: "https://tinkazo.app/como-funciona.html",
  };

  it("una lista común se lee como siempre: con las participaciones iguales, nada nuevo se agrega", () => {
    expect(T.es.sellarResumen(150, 100, "Termo", 150)).toBe(T.es.sellarResumen(150, 100, "Termo"));
    expect(T.es.summary("Ana", 12, "Pizza", "https://tinkazo.app/x", false, undefined, 12)).toBe(T.es.summary("Ana", 12, "Pizza", "https://tinkazo.app/x", false));
    expect(T.es.tellBody("Ana", "Pizza", 12, "https://tinkazo.app/x", false, false, 12)).toBe(T.es.tellBody("Ana", "Pizza", 12, "https://tinkazo.app/x", false, false));
    const deSiempre = T.es.rules({ ...base, raffleId: "12" });
    expect(T.es.rules({ ...base, raffleId: "12", entries: base.count })).toBe(deSiempre);
    expect(T.en.rules({ ...base, entries: base.count })).toBe(T.en.rules(base));
  });

  it("el resumen de antes de sellar dice las dos cuentas y lo que puede pasar", () => {
    expect(T.es.sellarResumen(2, 1, "Termo", 5)).toBe(
      "2 personas, 5 participaciones, 1 ganador, Termo. Quien tiene varias participaciones puede salir más de una vez. Al sellar, la lista queda cerrada.",
    );
    expect(T.en.sellarResumen(2, 1, "Termo", 5)).toContain("2 people, 5 entries");
    expect(T.en.sellarResumen(2, 1, "Termo", 5)).toContain("Anyone with several entries can come out more than once.");
  });

  it("las bases dicen las dos cuentas y que las participaciones no se venden", () => {
    const txt = T.es.rules({ ...base, entries: 5 });
    expect(txt).toContain("2 personas de la lista, con 5 participaciones: quien tiene varias puede salir más de una vez.");
    expect(txt).toContain("3. Las participaciones no se venden: las define quien organiza y figuran en la lista sellada.");
    expect(txt).toContain("8. Quien organiza responde por el premio.");
    const pre = T.es.rulesPre({ prize: "Termo", count: 2, winners: 1, verifyUrl: base.verifyUrl, entries: 5 });
    expect(pre).toContain("3. Las participaciones no se venden");
    expect(pre).toContain("7. Quien organiza responde por el premio.");
    expect(T.en.rules({ ...base, entries: 5 })).toContain("2 people on the list take part, with 5 entries");
    expect(T.en.rules({ ...base, entries: 5 })).toContain("Entries are not sold");
  });

  it("los mensajes dicen las dos cuentas: «entre 5 participaciones de 2 personas»", () => {
    expect(T.es.summary("Ana", 5, "Pizza", "https://tinkazo.app/x", false, false, 2)).toContain("entre 5 participaciones de 2 personas");
    expect(T.es.tellBody("Ana", "Pizza", 5, "https://tinkazo.app/x", false, false, 2)).toContain("entre 5 participaciones de 2 personas");
    expect(T.en.summary("Ana", 5, "Pizza", "https://tinkazo.app/x", false, false, 2)).toContain("out of 5 entries from 2 people");
    expect(T.en.tellBody("Ana", "Pizza", 5, "https://tinkazo.app/x", false, false, 2)).toContain("5 entries from 2 people");
  });

  it("las cuentas de la lista y del sello dicen las dos cosas", () => {
    expect(T.es.listaCuentaPart(2, 5)).toBe("Lista de 2 personas, 5 participaciones");
    expect(T.es.listaCuentaPart(1, 3)).toBe("Lista de 1 persona, 3 participaciones");
    expect(T.en.listaCuentaPart(2, 5)).toBe("List of 2 people, 5 entries");
    expect(T.es.kEntriesDe(2)).toBe("participaciones de 2 personas");
    expect(T.en.kEntriesDe(1)).toBe("entries from 1 person");
  });
});
