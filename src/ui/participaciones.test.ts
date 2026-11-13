// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalList } from "../protocol/canonical";
import { contar } from "../participaciones";

/**
 * Las participaciones se eligen tocando (`participants.ts` + `src/participaciones.ts`), con el markup de verdad
 * de `index.html`: un botón debajo de la cuenta abre un panel con un contador por persona, y cada toque
 * reescribe el cuadro. Si una lista pegada ya trae un número al lado de los nombres, se pregunta con dos
 * botones antes de tocar nada. Solo se ve con la bandera de los modos nuevos o con `?modo=` en la dirección;
 * sin la una y sin la otra, la herramienta es la de siempre.
 */

const h = vi.hoisted(() => ({ tope: 300 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");

const ta = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
const aviso = (): HTMLElement => document.getElementById("participaciones-aviso") as HTMLElement;
const boton = (): HTMLButtonElement => document.getElementById("btn-varias") as HTMLButtonElement;
const panel = (): HTMLElement => document.getElementById("varias-panel") as HTMLElement;
const sellar = (): HTMLButtonElement => document.getElementById("btn-freeze") as HTMLButtonElement;

const escribir = (valor: string): void => {
  ta().value = valor;
  ta().dispatchEvent(new Event("input", { bubbles: true }));
};

const filas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".varias-fila")];
const filaDe = (nombre: string): HTMLElement => {
  const fila = filas().find((f) => f.querySelector(".varias-nombre")?.textContent === nombre);
  if (!fila) throw new Error(`No hay fila para ${nombre}`);
  return fila;
};
const numeroDe = (nombre: string): string => filaDe(nombre).querySelector(".varias-num b")?.textContent ?? "";
/** Un toque en el contador de una persona: la fila se vuelve a pintar, así que se busca de nuevo cada vez. */
const tocar = (nombre: string, lado: "mas" | "menos"): void => {
  filaDe(nombre).querySelector<HTMLButtonElement>(lado === "mas" ? ".varias-mas" : ".varias-menos")?.click();
};
const abrirPanel = (): void => boton().click();

/** Monta la herramienta con la dirección que se pida: sin parámetros (la de siempre) o con `?modo=varias`. */
async function montar(modo = ""): Promise<typeof import("./participants")> {
  vi.resetModules();
  sessionStorage.clear();
  history.replaceState(null, "", modo ? `/?modo=${modo}` : "/");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const p = await import("./participants");
  const g = await import("./ganadores");
  p.bindParticipants();
  g.montarGanadores();
  return p;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("sin la bandera y sin el parámetro, la herramienta es la de siempre", () => {
  it("ni el botón ni el panel ni la pregunta se ven, y la lista se lee como siempre", async () => {
    await montar();
    expect(boton().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(ta().placeholder).toBe("Un nombre por línea…");
    escribir("Ana, 3\nBeto, 2");
    expect(aviso().style.display).toBe("none");
    expect(boton().hidden).toBe(true);
    // Como hoy: el nombre es lo que va antes de la coma, y la cuenta habla de personas.
    const p = await import("./participants");
    expect(p.parseNames()).toEqual(["Ana", "Beto"]);
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 2 personas");
  });

  it("nombres con forma de sufijo son tres personas: se puede sellar, como siempre", async () => {
    await montar();
    escribir("Grupo (1/2)\nGrupo (2/2)\nOtro");
    expect(aviso().style.display).toBe("none");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 3 personas");
    expect(sellar().disabled).toBe(false);
  });

  it("una lista hecha toda de marcas que cierran cuenta igual antes y después de sellar", async () => {
    // La cabecera del selector y el resultado leen este reparto entero por persona aun sin modos: antes de sellar
    // la cuenta dice lo mismo, «2 personas, 5 participaciones», y no «5 personas».
    await montar();
    escribir("Mesa 1 (1/3)\nMesa 1 (2/3)\nMesa 1 (3/3)\nMesa 2 (1/2)\nMesa 2 (2/2)");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 2 personas, 5 participaciones");
    const { contar, seCuentaPorPersona } = await import("../participaciones");
    const lineas = ["Mesa 1 (1/3)", "Mesa 1 (2/3)", "Mesa 1 (3/3)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"];
    // La misma cuenta que usa la cabecera del selector después de sellar (freeze.ts).
    expect(contar(lineas, seCuentaPorPersona(lineas, false)).personas).toBe(2);
    // Se sigue pudiendo sellar, como siempre.
    expect(sellar().disabled).toBe(false);
  });
});

describe("el panel de contadores", () => {
  it("el botón aparece solo con los modos a la vista y con dos nombres o más", async () => {
    await montar("varias");
    expect(boton().hidden).toBe(true);
    escribir("Ana Quispe");
    expect(boton().hidden).toBe(true);
    escribir("Ana Quispe\nBeto Rojas");
    expect(boton().hidden).toBe(false);
    expect(boton().textContent).toBe("Alguien participa más de una vez");
    expect(panel().hidden).toBe(true);
  });

  it("al abrirlo, una fila por persona, todas en 1, y la cuenta en vivo", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas\nCarla Suarez");
    abrirPanel();
    expect(panel().hidden).toBe(false);
    expect(boton().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("varias-titulo")?.textContent).toBe("Cuántas veces participa cada persona");
    expect(filas().map((f) => f.querySelector(".varias-nombre")?.textContent)).toEqual(["Ana Quispe", "Beto Rojas", "Carla Suarez"]);
    expect(numeroDe("Ana Quispe")).toBe("1");
    expect(filaDe("Ana Quispe").querySelector<HTMLButtonElement>(".varias-menos")?.disabled).toBe(true);
    expect(filaDe("Ana Quispe").querySelector<HTMLButtonElement>(".varias-mas")?.disabled).toBe(false);
    expect(filaDe("Ana Quispe").querySelector(".varias-mas")?.getAttribute("aria-label")).toBe("Sumar una participación a Ana Quispe");
    expect(filaDe("Ana Quispe").querySelector(".varias-menos")?.getAttribute("aria-label")).toBe("Quitar una participación a Ana Quispe");
    expect(document.getElementById("varias-cuenta")?.textContent).toBe("3 personas, 3 participaciones");
  });

  it("más y menos reescriben el cuadro en el acto, y lo que se sella es eso", async () => {
    const p = await montar("varias");
    escribir("Ana Quispe\nBeto Rojas\nCarla Suarez");
    abrirPanel();
    tocar("Ana Quispe", "mas");
    tocar("Ana Quispe", "mas");
    expect(ta().value).toBe("Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto Rojas\nCarla Suarez");
    expect(canonicalList(ta().value)).toEqual(p.parseNames());
    expect(numeroDe("Ana Quispe")).toBe("3");
    expect(filaDe("Ana Quispe").querySelector(".varias-num")?.classList.contains("varias")).toBe(true);
    // La cuenta del panel coincide con contar() sobre lo que se sella.
    const cuenta = contar(p.parseNames());
    expect(cuenta).toEqual({ personas: 3, participaciones: 5 });
    expect(document.getElementById("varias-cuenta")?.textContent).toBe("3 personas, 5 participaciones");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 3 personas, 5 participaciones");
    // Bajar hasta 1 deja el nombre a secas, y el cuadro queda como la lista común, letra por letra.
    tocar("Ana Quispe", "menos");
    expect(ta().value).toBe("Ana Quispe (1/2)\nAna Quispe (2/2)\nBeto Rojas\nCarla Suarez");
    tocar("Ana Quispe", "menos");
    expect(ta().value).toBe("Ana Quispe\nBeto Rojas\nCarla Suarez");
    expect(canonicalList(ta().value)).toEqual(["Ana Quispe", "Beto Rojas", "Carla Suarez"]);
  });

  it("en el tope, el botón de sumar se apaga y debajo del número dice máximo", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    abrirPanel();
    for (let i = 0; i < 9; i++) tocar("Ana Quispe", "mas");
    expect(numeroDe("Ana Quispe")).toBe("10");
    expect(filaDe("Ana Quispe").querySelector<HTMLButtonElement>(".varias-mas")?.disabled).toBe(true);
    expect(filaDe("Ana Quispe").textContent).toContain("máximo");
    expect(canonicalList(ta().value)).toHaveLength(11);
  });

  it("editar el cuadro a mano con el panel abierto lo pone al día", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    abrirPanel();
    escribir("Ana Quispe (1/2)\nAna Quispe (2/2)\nBeto Rojas\nCarla Suarez");
    expect(numeroDe("Ana Quispe")).toBe("2");
    expect(filas()).toHaveLength(3);
    expect(document.getElementById("varias-cuenta")?.textContent).toBe("3 personas, 4 participaciones");
  });

  it("Listo pliega el panel y el botón lo vuelve a abrir", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    abrirPanel();
    document.getElementById("btn-varias-listo")?.click();
    expect(panel().hidden).toBe(true);
    expect(boton().getAttribute("aria-expanded")).toBe("false");
    abrirPanel();
    expect(panel().hidden).toBe(false);
  });

  it("con más de diez personas hay buscador, y filtra las filas sin tocar el cuadro", async () => {
    await montar("varias");
    const doce = Array.from({ length: 12 }, (_, i) => `Persona ${i + 1}`).join("\n");
    escribir(doce);
    abrirPanel();
    expect(document.getElementById("varias-buscar-fila")?.hidden).toBe(false);
    expect(filas()).toHaveLength(12);
    const buscar = document.getElementById("varias-buscar") as HTMLInputElement;
    buscar.value = "Persona 12";
    buscar.dispatchEvent(new Event("input", { bubbles: true }));
    expect(filas()).toHaveLength(1);
    expect(numeroDe("Persona 12")).toBe("1");
    expect(ta().value).toBe(doce);
    buscar.value = "Nadie Con Ese Nombre";
    buscar.dispatchEvent(new Event("input", { bubbles: true }));
    expect(filas()).toHaveLength(0);
    expect(document.getElementById("varias-sin")?.hidden).toBe(false);
  });

  it("sin buscador con diez personas o menos", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    abrirPanel();
    expect(document.getElementById("varias-buscar-fila")?.hidden).toBe(true);
  });

  it("una línea con dos comas entra al panel por el nombre que lee el sello, sin cartel", async () => {
    await montar("varias");
    escribir("Pérez, Ana, 2\nBeto Rojas");
    expect(document.getElementById("part-no-reparten")).toBeNull();
    abrirPanel();
    expect(filas().map((f) => f.querySelector(".varias-nombre")?.textContent)).toEqual(["Pérez", "Beto Rojas"]);
    tocar("Pérez", "mas");
    expect(ta().value).toBe("Pérez (1/2)\nPérez (2/2)\nBeto Rojas");
  });

  it("una persona repetida en dos líneas se junta en la primera al tocar el contador", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas\nAna Quispe");
    abrirPanel();
    expect(filas()).toHaveLength(2);
    tocar("Ana Quispe", "mas");
    expect(ta().value).toBe("Ana Quispe (1/2)\nAna Quispe (2/2)\nBeto Rojas");
  });
});

describe("«Alguien participa más de una vez» es un enlace chico, no un botón", () => {
  it("en el markup es un enlace como «Tengo un stand», no un botón de los grandes, y nace escondido", () => {
    const html = new DOMParser().parseFromString(pagina, "text/html");
    const abrir = html.getElementById("btn-varias") as HTMLElement;
    expect(abrir.classList.contains("enlace")).toBe(true);
    expect(abrir.classList.contains("ghost")).toBe(false);
    expect(abrir.classList.contains("part-abrir")).toBe(true);
    expect(abrir.hasAttribute("hidden")).toBe(true);
    expect(abrir.getAttribute("aria-controls")).toBe("varias-panel");
    // Igual que el enlace del stand, que está al lado.
    expect(html.getElementById("btn-stand")?.classList.contains("enlace")).toBe(true);
  });

  it("sigue abriendo el panel con un toque, y con la lista de dos nombres se ve", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    expect(boton().hidden).toBe(false);
    expect(boton().classList.contains("enlace")).toBe(true);
    abrirPanel();
    expect(panel().hidden).toBe(false);
  });
});

describe("la pregunta por los números que ya trae una lista pegada", () => {
  it("pregunta con dos botones y, con el sí, aplica los números y abre el panel", async () => {
    const p = await montar("varias");
    escribir("Ana Quispe, 3\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("");
    expect(aviso().textContent).toContain("Tu lista trae un número al lado de 2 nombres. ¿Son las veces que participa cada uno?");
    document.getElementById("btn-part-si")?.click();
    expect(ta().value).toBe("Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto Rojas (1/2)\nBeto Rojas (2/2)");
    expect(aviso().style.display).toBe("none");
    expect(panel().hidden).toBe(false);
    expect(sellar().disabled).toBe(false);
    expect(p.parseNames().length).toBe(5);
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 2 personas, 5 participaciones");
    expect(document.getElementById("sellar-resumen")?.textContent).toContain("2 personas, 5 participaciones");
  });

  it("una sola línea con número también pregunta", async () => {
    await montar("varias");
    escribir("Beto Rojas\nAna Quispe, 3");
    expect(aviso().style.display).toBe("");
    expect(aviso().textContent).toContain("Tu lista trae un número al lado de 1 nombre. ¿Son las veces que participa?");
  });

  it("si algún número pasa de 10 no se pregunta: es una edad, una mesa o un número de socio, no las veces que participa", async () => {
    await montar("varias");
    escribir("Ana Quispe, 25\nBeto Rojas");
    expect(aviso().style.display).toBe("none");
    // Un solo número fuera de 1 a 10 alcanza para no preguntar, aunque los otros sirvan.
    escribir("Ana Quispe, 3\nBeto Rojas, 31\nCarla Pérez, 2");
    expect(aviso().style.display).toBe("none");
    escribir("Ana Quispe, 3\nBeto Rojas, 11");
    expect(aviso().style.display).toBe("none");
    // Y la lista queda como está: nada se reparte sin que la persona lo pida.
    expect(ta().value).toBe("Ana Quispe, 3\nBeto Rojas, 11");
  });

  it("el cero tampoco son veces que participa: no se pregunta", async () => {
    await montar("varias");
    escribir("Ana Quispe, 0\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("none");
  });

  it("con todos los números entre 1 y 10, incluidos el 1 y el 10, sí se pregunta", async () => {
    await montar("varias");
    escribir("Ana Quispe, 1\nBeto Rojas, 10\nCarla Pérez");
    expect(aviso().style.display).toBe("");
    expect(aviso().textContent).toContain("Tu lista trae un número al lado de 2 nombres.");
  });

  it("al corregir la lista y quedar todos entre 1 y 10, la pregunta aparece; al volver a pasarse, se va", async () => {
    await montar("varias");
    escribir("Ana Quispe, 25\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("none");
    escribir("Ana Quispe, 5\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("");
    escribir("Ana Quispe, 5\nBeto Rojas, 20");
    expect(aviso().style.display).toBe("none");
  });

  it("con el no, la lista queda como está y por esa lista no se pregunta de nuevo", async () => {
    await montar("varias");
    escribir("Ana Quispe, 3\nBeto Rojas, 2");
    document.getElementById("btn-part-no")?.click();
    expect(ta().value).toBe("Ana Quispe, 3\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("none");
    expect(panel().hidden).toBe(true);
    // Volver a pintar la misma lista no trae la pregunta de vuelta.
    escribir("Ana Quispe, 3\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("none");
  });

  it("sin números no hay pregunta, y el botón del panel no cambia nada por su cuenta", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    expect(aviso().style.display).toBe("none");
    abrirPanel();
    expect(ta().value).toBe("Ana Quispe\nBeto Rojas");
  });

  it("aplicados los números, los parecidos se siguen avisando: «ana quispe» y «Ana Quispe»", async () => {
    await montar("varias");
    escribir("ana quispe, 2\nAna Quispe, 3");
    document.getElementById("btn-part-si")?.click();
    expect(ta().value).toContain("ana quispe (1/2)");
    expect(ta().value).toContain("Ana Quispe (3/3)");
    const nota = document.getElementById("csv-aviso");
    expect(nota?.style.display).toBe("");
    expect(nota?.textContent).toContain("parecen la misma persona");
  });
});

describe("para sellar una lista repartida hacen falta dos personas distintas", () => {
  it("una persona con varias participaciones no alcanza: el botón de sellar queda apagado y con su explicación", async () => {
    await montar("varias");
    escribir("Ana Quispe, 3");
    document.getElementById("btn-part-si")?.click();
    expect(ta().value).toBe("Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)");
    expect(sellar().disabled).toBe(true);
    expect(document.getElementById("freeze-hint")?.style.display).toBe("block");
    // Hay tres renglones: la explicación habla de personas, no de nombres.
    expect(document.getElementById("freeze-hint")?.textContent).toBe("Hacen falta al menos dos personas.");
    // Con otra persona, vuelve a poder sellarse.
    escribir(`${ta().value}\nBeto Rojas`);
    expect(sellar().disabled).toBe(false);
  });

  it("sufijos incompletos (una línea borrada a mano): sigue siendo una sola persona y no se puede sellar", async () => {
    await montar("varias");
    escribir("Ana (1/3)\nAna (3/3)");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 1 persona, 2 participaciones");
    expect(sellar().disabled).toBe(true);
    expect(document.getElementById("freeze-hint")?.style.display).toBe("block");
    // Con otra persona, vuelve a poder sellarse.
    escribir("Ana (1/3)\nAna (3/3)\nBeto");
    expect(sellar().disabled).toBe(false);
  });
});

describe("con «Orden de turnos» elegido, el mismo panel habla de turnos", () => {
  it("el botón, el título y la cuenta dicen turnos, y tocar suma turnos", async () => {
    await montar("varias");
    escribir("Ana Quispe\nBeto Rojas\nCarla Suarez");
    const { ponerModoTurnos } = await import("./turnos");
    ponerModoTurnos(true);
    expect(boton().hidden).toBe(false);
    expect(boton().textContent).toBe("Alguien tiene más de un turno");
    abrirPanel();
    expect(document.getElementById("varias-titulo")?.textContent).toBe("Cuántos turnos tiene cada persona");
    expect(filaDe("Ana Quispe").querySelector(".varias-mas")?.getAttribute("aria-label")).toBe("Sumar un turno a Ana Quispe");
    tocar("Ana Quispe", "mas");
    tocar("Carla Suarez", "mas");
    expect(ta().value).toBe("Ana Quispe (1/2)\nAna Quispe (2/2)\nBeto Rojas\nCarla Suarez (1/2)\nCarla Suarez (2/2)");
    expect(document.getElementById("varias-cuenta")?.textContent).toBe("3 personas, 5 turnos");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 3 personas, 5 turnos");
    // Apagado el modo, el panel vuelve a hablar de participaciones.
    ponerModoTurnos(false);
    expect(boton().textContent).toBe("Alguien participa más de una vez");
    expect(document.getElementById("varias-cuenta")?.textContent).toBe("3 personas, 5 participaciones");
  });

  it("una lista repartida con turnos: todas las cuentas dicen personas y turnos", async () => {
    await montar("varias");
    const { ponerModoTurnos } = await import("./turnos");
    ponerModoTurnos(true);
    escribir("Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 2 personas, 4 turnos");
    expect(document.getElementById("sellar-resumen")?.textContent).toBe(
      "2 personas, 4 turnos, turnos del 1 al 4. Quien tiene más de una participación recibe un turno por cada una. Al sellar, la lista queda cerrada.",
    );
  });
});

describe("el borrador guarda el modo de varias participaciones", () => {
  it("al volver de entrar, sin el parámetro, repone la lista repartida y el panel sigue a la vista", async () => {
    const p = await montar("varias");
    escribir("Ana Quispe\nBeto Rojas\nCarla Suarez");
    abrirPanel();
    tocar("Ana Quispe", "mas");
    tocar("Ana Quispe", "mas");
    p.guardarBorrador();
    const guardado = sessionStorage.getItem("tinkazo.borrador") as string;
    expect(JSON.parse(guardado)).toMatchObject({ modo: "varias" });

    // Volver de entrar con Google: la dirección es `/` y la página nace con el cuadro vacío.
    const otra = await montar();
    sessionStorage.setItem("tinkazo.borrador", guardado);
    otra.reponerBorrador();
    expect(ta().value).toBe("Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)\nBeto Rojas\nCarla Suarez");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 3 personas, 5 participaciones");
    expect(boton().hidden).toBe(false);
    expect(sellar().disabled).toBe(false);
    const { modesVisible } = await import("../modos/bandera");
    expect(modesVisible()).toBe(true);
  });

  it("una sola persona repartida no se puede sellar ni después de reponer el borrador", async () => {
    const p = await montar("varias");
    escribir("Ana Quispe\nBeto Rojas");
    abrirPanel();
    tocar("Ana Quispe", "mas");
    tocar("Ana Quispe", "mas");
    // Queda solo Ana, con tres participaciones: se guarda así y al volver sigue sin alcanzar.
    escribir("Ana Quispe (1/3)\nAna Quispe (2/3)\nAna Quispe (3/3)");
    p.guardarBorrador();
    const guardado = sessionStorage.getItem("tinkazo.borrador") as string;
    const otra = await montar();
    sessionStorage.setItem("tinkazo.borrador", guardado);
    otra.reponerBorrador();
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 1 persona, 3 participaciones");
    expect(sellar().disabled).toBe(true);
  });
});

describe("con la lista cerrada", () => {
  it("la pregunta se esconde, el botón se apaga y el panel se pliega", async () => {
    const p = await montar("varias");
    escribir("Ana Quispe, 3\nBeto Rojas, 2");
    expect(aviso().style.display).toBe("");
    abrirPanel();
    p.cerrarLista(true);
    expect(aviso().style.display).toBe("none");
    expect(boton().disabled).toBe(true);
    expect(boton().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
  });
});

describe("una tabla de dos columnas con enteros en la segunda: una pregunta, nunca un cambio", () => {
  const laVentana = (): boolean => !!document.querySelector(".imp-back");

  it("con ?modo=varias entra al cuadro como «Nombre, n» y la pregunta decide", async () => {
    const p = await montar("varias");
    p.loadFile("Ana, 3\nBeto, 2", "");
    expect(ta().value).toBe("Ana, 3\nBeto, 2");
    expect(laVentana()).toBe(false);
    expect(aviso().style.display).toBe("");
    document.getElementById("btn-part-si")?.click();
    expect(ta().value).toBe("Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto (1/2)\nBeto (2/2)");
  });

  it("con encabezado y con otros separadores, igual: el encabezado no entra", async () => {
    const p = await montar("varias");
    p.loadFile("Nombre,Cantidad\nAna Quispe,3\nBeto,2", "");
    expect(ta().value).toBe("Ana Quispe, 3\nBeto, 2");
    p.loadFile("Ana;3\nBeto;2", "");
    expect(ta().value).toBe("Ana, 3\nBeto, 2");
    p.loadFile("Ana\t3\nBeto\t2", "");
    expect(ta().value).toBe("Ana, 3\nBeto, 2");
  });

  it("con números que pasan de 10 también entra al cuadro tal cual, y no se pregunta nada", async () => {
    const p = await montar("varias");
    p.loadFile("Ana, 25\nBeto, 30", "");
    expect(laVentana()).toBe(false);
    expect(ta().value).toBe("Ana, 25\nBeto, 30");
    expect(aviso().style.display).toBe("none");
  });

  it("sin la bandera y sin el parámetro, la ventana de importar de siempre", async () => {
    const p = await montar();
    p.loadFile("Ana, 3\nBeto, 2", "");
    expect(ta().value).toBe("");
    expect(laVentana()).toBe(true);
  });

  it("si la segunda columna no es toda enteros, no es esto: la ventana de siempre", async () => {
    const p = await montar("varias");
    // Algo que no es un número.
    p.loadFile("Ana, 3\nBeto, dos", "");
    expect(laVentana()).toBe(true);
    expect(ta().value).toBe("");
    // Una celda vacía en la segunda columna.
    p.loadFile("Ana, 3\nBeto,", "");
    expect(laVentana()).toBe(true);
    // Tres columnas: la de siempre.
    p.loadFile("Ana, 3, algo\nBeto, 2, algo", "");
    expect(laVentana()).toBe(true);
  });
});
