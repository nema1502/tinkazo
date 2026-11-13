// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { T } from "../i18n";
import { TEXTOS_ALTA } from "../alta-textos";
import { TEXTOS_ALTA_CUENTA } from "../alta-textos-cuenta";
import { TEXTOS_ALTA_PASO } from "../alta-textos-paso";
import { TEXTOS_ALTA_SIN_PAGO } from "../alta-textos-sin-pago";
import { TEXTOS_EQUIPOS } from "../equipos/textos";
import { TEXTOS_MODO_OFICIAL } from "../i18n-modo-oficial";
import { TEXTOS_CREADORES } from "../marca-creadores-textos";
import { TEXTOS_PAGOS } from "./pagos-textos";
import { cuadroEsDeEquipos, esListaDeEquipos, ponerEtiquetas } from "../equipos/etiquetas";

/**
 * Los textos que hablan de la lista dicen persona y personas con una lista común, y equipo y equipos cuando la lista es
 * de los equipos con cupón (issue 25). Una sola fuente por frase: la palabra la elige el texto según la lista que está
 * en el cuadro, no según las etiquetas que el navegador recuerda. Después de sortear con equipos y pegar otra lista de
 * personas, las etiquetas viejas siguen en memoria y los textos tienen que seguir hablando de personas.
 */

const ENLACE = "https://tinkazo.app/c/abc";
const CONDORES = "GAAA1111111111111111111111111111111111111111111111111111111111";
const VICUNAS = "GBBB2222222222222222222222222222222222222222222222222222222222";

const etiquetas = (): Map<string, string> =>
  new Map([
    [CONDORES, "Los Cóndores"],
    [VICUNAS, "Las Vicuñas"],
  ]);

/** El cuadro de la lista, como el de la herramienta: lo que tenga escrito es la lista de la que hablan los textos. */
function cuadro(...lineas: string[]): void {
  let ta = document.getElementById("ta") as HTMLTextAreaElement | null;
  if (!ta) {
    ta = document.createElement("textarea");
    ta.id = "ta";
    document.body.append(ta);
  }
  ta.value = lineas.join("\n");
}

afterEach(() => {
  // Las etiquetas y el cuadro son estado global: sin esto, una prueba contamina a la siguiente.
  ponerEtiquetas(new Map());
  document.body.innerHTML = "";
});

describe("los textos de la lista con una lista común (sin equipos)", () => {
  it("againLeft cuenta personas, en los dos idiomas", () => {
    expect(T.es.againLeft(1)).toBe("Queda 1 persona sin premio.");
    expect(T.es.againLeft(3)).toBe("Quedan 3 personas sin premio.");
    expect(T.en.againLeft(1)).toBe("1 person is left without a prize.");
    expect(T.en.againLeft(3)).toBe("3 people are left without a prize.");
  });

  it("againFew habla de una sola persona, en los dos idiomas", () => {
    expect(T.es.againFew(1)).toBe("Queda una sola persona sin premio: para otro sorteo, usá otra lista.");
    expect(T.en.againFew(1)).toBe("Only one person is left without a prize: for another draw, use another list.");
  });

  it("el mensaje para quien salió dice entre cuántas personas, en los dos idiomas", () => {
    expect(T.es.tellBody("Ana", "", 12, ENLACE, false)).toContain("entre 12 personas");
    expect(T.en.tellBody("Ana", "", 12, ENLACE, false)).toContain("out of 12 people");
  });

  it("el resumen del sello cuenta personas, en los dos idiomas", () => {
    expect(T.es.sellarResumen(18, 1, "Termo")).toContain("18 personas, 1 ganador");
    expect(T.en.sellarResumen(18, 1, "Termo")).toContain("18 people, 1 winner");
  });

  it("la barra dice lista de personas, en los dos idiomas", () => {
    expect(T.es.sigLista).toBe("lista de {n} personas");
    expect(T.en.sigLista).toBe("list of {n} people");
  });

  it("el aviso de que ya entraste habla de la lista de personas, en los dos idiomas", () => {
    expect(T.es.yaEntraste).toBe("Ya entraste. Sellá tu lista de {n} personas.");
    expect(T.en.yaEntraste).toBe("You're in. Seal your list of {n} people.");
  });

  it("el motivo para entrar habla de la lista de personas, en los dos idiomas", () => {
    expect(T.es.loginParaSellar).toContain("Para sellar tu lista de {n} personas");
    expect(T.en.loginParaSellar).toContain("To seal your list of {n} people");
  });

  it("la cuenta de junto al cuadro cuenta personas, en los dos idiomas", () => {
    expect(T.es.listaCuenta).toBe("Lista de {n} personas");
    expect(T.es.listaCuentaUna).toBe("Lista de 1 persona");
    expect(T.en.listaCuenta).toBe("List of {n} people");
    expect(T.en.listaCuentaUna).toBe("List of 1 person");
  });

  it("quienes ya ganaron se cuentan como personas cuando son más de tres, en los dos idiomas", () => {
    expect(T.es.againQuitados(["Ana", "Beto", "Carla", "Dora"], 6)).toBe("4 personas ya ganaron y no están en esta lista. Quedan 6.");
    expect(T.en.againQuitados(["Ana", "Beto", "Carla", "Dora"], 6)).toBe("4 people already won and are off this list. 6 left.");
  });
});

describe("los textos de la lista cuando el cuadro tiene la lista de los equipos con cupón", () => {
  const conEquipos = (): void => {
    ponerEtiquetas(etiquetas());
    cuadro(CONDORES, VICUNAS);
  };

  it("el cuadro es de equipos solo si cada línea es la cuenta de un equipo conocido", () => {
    conEquipos();
    expect(cuadroEsDeEquipos()).toBe(true);
    expect(esListaDeEquipos([CONDORES, VICUNAS])).toBe(true);
  });

  it("againLeft cuenta equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.againLeft(1)).toBe("Queda 1 equipo sin premio.");
    expect(T.es.againLeft(3)).toBe("Quedan 3 equipos sin premio.");
    expect(T.en.againLeft(1)).toBe("1 team is left without a prize.");
    expect(T.en.againLeft(3)).toBe("3 teams are left without a prize.");
  });

  it("againFew habla de un solo equipo, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.againFew(1)).toBe("Queda un solo equipo sin premio: para otro sorteo, usá otra lista.");
    expect(T.en.againFew(1)).toBe("Only one team is left without a prize: for another draw, use another list.");
  });

  it("el mensaje para quien salió dice entre cuántos equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.tellBody("Los Cóndores", "", 12, ENLACE, false)).toContain("entre 12 equipos");
    expect(T.es.tellBody("Los Cóndores", "", 12, ENLACE, false)).not.toContain("personas");
    expect(T.en.tellBody("Los Cóndores", "", 12, ENLACE, false)).toContain("out of 12 teams");
    expect(T.en.tellBody("Los Cóndores", "", 12, ENLACE, false)).not.toContain("people");
  });

  it("el resumen del sello cuenta equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.sellarResumen(18, 1, "Termo")).toContain("18 equipos, 1 ganador");
    expect(T.es.sellarResumen(18, 1, "Termo")).not.toContain("personas");
    expect(T.en.sellarResumen(18, 1, "Termo")).toContain("18 teams, 1 winner");
    expect(T.en.sellarResumen(18, 1, "Termo")).not.toContain("people");
  });

  it("la barra dice lista de equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.sigLista).toBe("lista de {n} equipos");
    expect(T.en.sigLista).toBe("list of {n} teams");
  });

  it("el aviso de que ya entraste habla de la lista de equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.yaEntraste).toBe("Ya entraste. Sellá tu lista de {n} equipos.");
    expect(T.en.yaEntraste).toBe("You're in. Seal your list of {n} teams.");
  });

  it("el motivo para entrar habla de la lista de equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.loginParaSellar).toContain("Para sellar tu lista de {n} equipos");
    expect(T.es.loginParaSellar).not.toContain("personas");
    expect(T.en.loginParaSellar).toContain("To seal your list of {n} teams");
    expect(T.en.loginParaSellar).not.toContain("people");
  });

  it("la cuenta de junto al cuadro cuenta equipos, en los dos idiomas", () => {
    conEquipos();
    expect(T.es.listaCuenta).toBe("Lista de {n} equipos");
    expect(T.es.listaCuentaUna).toBe("Lista de 1 equipo");
    expect(T.en.listaCuenta).toBe("List of {n} teams");
    expect(T.en.listaCuentaUna).toBe("List of 1 team");
  });

  it("quienes ya ganaron se cuentan como equipos cuando son más de tres, y con uno a tres se dicen por su nombre", () => {
    conEquipos();
    expect(T.es.againQuitados(["Los Cóndores", "Las Vicuñas", "Los Zorros", "Las Llamas"], 6)).toBe("4 equipos ya ganaron y no están en esta lista. Quedan 6.");
    expect(T.en.againQuitados(["Los Cóndores", "Las Vicuñas", "Los Zorros", "Las Llamas"], 6)).toBe("4 teams already won and are off this list. 6 left.");
    expect(T.es.againQuitados(["Los Cóndores", "Las Vicuñas"], 6)).toBe("Los Cóndores y Las Vicuñas ya ganaron y no están en esta lista. Quedan 6.");
    expect(T.en.againQuitados(["Los Cóndores"], 6)).toBe("Los Cóndores already won and is off this list. 6 left.");
  });
});

describe("la palabra sigue a la lista del cuadro y no a las etiquetas que quedaron", () => {
  /** Los textos de la lista, en un idioma, tal como salen con lo que haya en el cuadro. */
  const textos = (l: "es" | "en"): string[] => [
    T[l].againLeft(3),
    T[l].againFew(1),
    T[l].tellBody("Ana", "", 12, ENLACE, false),
    T[l].sellarResumen(12, 1, "Termo"),
    String(T[l].sigLista),
    String(T[l].yaEntraste),
    String(T[l].loginParaSellar),
    String(T[l].listaCuenta),
    String(T[l].listaCuentaUna),
    T[l].againQuitados(["Ana", "Beto", "Carla", "Dora"], 6),
  ];

  it("con etiquetas de un sorteo anterior y una lista de personas en el cuadro, todo dice personas", () => {
    ponerEtiquetas(etiquetas());
    cuadro("Ana", "Beto", "Carla");
    expect(cuadroEsDeEquipos()).toBe(false);
    for (const x of textos("es")) expect(x, x).not.toMatch(/equipo/i);
    for (const x of textos("en")) expect(x, x).not.toMatch(/team/i);
    expect(T.es.sigLista).toBe("lista de {n} personas");
    expect(T.en.sigLista).toBe("list of {n} people");
    expect(T.es.againLeft(3)).toBe("Quedan 3 personas sin premio.");
  });

  it("con etiquetas viejas y el cuadro vacío, o sin cuadro en la página, dice personas", () => {
    ponerEtiquetas(etiquetas());
    // Sin cuadro: una página que no es la herramienta.
    expect(cuadroEsDeEquipos()).toBe(false);
    expect(T.es.sigLista).toBe("lista de {n} personas");
    cuadro();
    expect(cuadroEsDeEquipos()).toBe(false);
    expect(T.en.yaEntraste).toBe("You're in. Seal your list of {n} people.");
  });

  it("una lista con un equipo y una persona no es de equipos", () => {
    ponerEtiquetas(etiquetas());
    cuadro(CONDORES, "Beto");
    expect(cuadroEsDeEquipos()).toBe(false);
    expect(T.es.sellarResumen(2, 1, "")).toContain("2 personas");
  });

  it("sin etiquetas, una lista que parece de cuentas sigue siendo de personas", () => {
    cuadro(CONDORES, VICUNAS);
    expect(cuadroEsDeEquipos()).toBe(false);
    expect(T.es.listaCuenta).toBe("Lista de {n} personas");
  });

  it("el cuadro se lee al momento: al cambiar la lista cambia la palabra, sin repintar nada", () => {
    ponerEtiquetas(etiquetas());
    cuadro(CONDORES, VICUNAS);
    expect(T.es.sigLista).toBe("lista de {n} equipos");
    cuadro("Ana", "Beto");
    expect(T.es.sigLista).toBe("lista de {n} personas");
    cuadro(VICUNAS, CONDORES);
    expect(T.es.sigLista).toBe("lista de {n} equipos");
  });

  it("con la lista a mano, el parámetro manda sobre el cuadro", () => {
    ponerEtiquetas(etiquetas());
    cuadro("Ana", "Beto");
    expect(T.es.againLeft(3, true)).toBe("Quedan 3 equipos sin premio.");
    expect(T.en.againFew(1, true)).toContain("Only one team");
    expect(T.es.sellarResumen(3, 1, "Termo", undefined, true)).toContain("3 equipos");
    expect(T.es.againQuitados(["Ana", "Beto", "Carla", "Dora"], 6, true)).toContain("4 equipos ya ganaron");
    cuadro(CONDORES, VICUNAS);
    expect(T.es.againLeft(3, false)).toBe("Quedan 3 personas sin premio.");
    expect(T.en.againQuitados(["A", "B", "C", "D"], 6, false)).toContain("4 people already won");
  });
});

describe("las claves que miran la lista son de solo lectura", () => {
  const CLAVES = ["listaCuenta", "listaCuentaUna", "loginParaSellar", "sigLista", "yaEntraste"];

  it("son las mismas en los dos idiomas", () => {
    const de = (l: "es" | "en"): string[] =>
      Object.keys(T[l])
        .filter((k) => typeof Object.getOwnPropertyDescriptor(T[l], k)?.get === "function")
        .sort();
    expect(de("es")).toEqual(CLAVES);
    expect(de("en")).toEqual(CLAVES);
  });

  it("ningún archivo de textos que se mezcla con Object.assign las define: si lo hiciera, el sitio fallaría al cargar", () => {
    const mezclados = [TEXTOS_CREADORES, TEXTOS_EQUIPOS, TEXTOS_PAGOS, TEXTOS_ALTA, TEXTOS_ALTA_SIN_PAGO, TEXTOS_ALTA_CUENTA, TEXTOS_ALTA_PASO, TEXTOS_MODO_OFICIAL];
    for (const archivo of mezclados) {
      for (const l of ["es", "en"] as const) {
        for (const k of CLAVES) expect(Object.keys(archivo[l]), `${l}.${k}`).not.toContain(k);
      }
    }
  });
});
