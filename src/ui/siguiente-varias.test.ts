// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La barra de lo que sigue cuenta personas con la misma función que el cuadro y el resumen
 * (`contar(canonicalList(ta.value), true)`), no leyendo el texto de las fichas: el texto de una
 * ficha puede traer la cuenta de participaciones al lado, y la barra contaba otra cosa.
 */

const CUERPO_PART = (premio: string) =>
  '<div id="stadium"></div><div id="winner-box"></div>' +
  '<textarea id="ta">Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto</textarea>' +
  // Las fichas dicen otra cosa a propósito: la barra no tiene que contar desde acá.
  '<div id="names"><i>Ana, primera</i><i>Ana, segunda</i><i>Ana, tercera</i><i>Beto</i></div>' +
  `<input id="prize" value="${premio}"><div id="prize-chips"></div>` +
  '<section id="sec-participants"></section><button id="btn-freeze">Sellar la lista</button>' +
  '<div id="siguiente"><span id="sig-paso"></span><button id="sig-btn"></button></div><span id="sig-aviso"></span>' +
  '<ol id="pasos"></ol>';

/** El cuerpo con una sola persona, Ana, con tres participaciones: tres líneas en el cuadro y tres fichas. */
const SOLO_ANA = (premio: string) =>
  CUERPO_PART(premio)
    .replace('<textarea id="ta">Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto</textarea>', '<textarea id="ta">Ana (1/3)\nAna (2/3)\nAna (3/3)</textarea>')
    .replace("<i>Beto</i>", "");

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/?modo=varias&lang=es");
  sessionStorage.clear();
  document.body.innerHTML = CUERPO_PART("Una pizza");
});

describe("la barra de lo que sigue con varias participaciones", () => {
  it("cuenta las personas del cuadro, no el texto de las fichas", async () => {
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    // Dos personas (Ana con tres participaciones y Beto), cuatro líneas.
    expect(document.getElementById("sig-paso")?.textContent).toContain("2 personas, 4 participaciones");
  });

  it("con las dos cuentas, la línea vale hasta dos renglones", async () => {
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    // Con un reparto (Ana con tres participaciones y Beto) lleva la clase: la frase puede ocupar dos renglones.
    expect(document.getElementById("sig-paso")?.classList.contains("doble")).toBe(true);
  });

  it("si la lista vuelve a ser común, el mismo renglón pierde la clase doble", async () => {
    await import("../i18n");
    const { initSiguiente, actualizarPaso } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    const linea = document.getElementById("sig-paso") as HTMLElement;
    expect(linea.classList.contains("doble")).toBe(true);
    // Se borran las marcas en el cuadro: cuatro personas, una línea cada una.
    (document.getElementById("ta") as HTMLTextAreaElement).value = "Ana\nBeto\nCarla\nDora";
    actualizarPaso();
    // El mismo elemento, no uno nuevo: la clase se saca sobre el que ya estaba.
    expect(document.getElementById("sig-paso")).toBe(linea);
    expect(linea.textContent).toContain("lista de 4 personas");
    expect(linea.classList.contains("doble")).toBe(false);
  });

  it("sin reparto, la línea de siempre en un solo renglón", async () => {
    history.replaceState(null, "", "/?lang=es");
    sessionStorage.clear();
    document.body.innerHTML = CUERPO_PART("Una pizza").replace(
      '<textarea id="ta">Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto</textarea>',
      "<textarea id=\"ta\">Ana\nBeto\nCarla\nDora</textarea>",
    );
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    expect(document.getElementById("sig-paso")?.textContent).toContain("lista de 4 personas");
    expect(document.getElementById("sig-paso")?.classList.contains("doble")).toBe(false);
  });

  it("sin modos, una lista hecha toda de marcas que cierran cuenta como la cabecera después de sellar", async () => {
    history.replaceState(null, "", "/?lang=es");
    sessionStorage.clear();
    const mesas = ["Mesa 1 (1/3)", "Mesa 1 (2/3)", "Mesa 1 (3/3)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"];
    document.body.innerHTML = CUERPO_PART("Una pizza")
      .replace('<textarea id="ta">Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto</textarea>', `<textarea id="ta">${mesas.join("\n")}</textarea>`)
      .replace(/<div id="names">.*?<\/div>/, `<div id="names">${mesas.map((m) => `<i>${m}</i>`).join("")}</div>`);
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    expect(document.getElementById("sig-paso")?.textContent).toContain("2 personas, 5 participaciones");
  });

  it("una sola persona con varias participaciones se dice en singular, en los dos idiomas", async () => {
    document.body.innerHTML = SOLO_ANA("Una pizza");
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    expect(document.getElementById("sig-paso")?.textContent).toContain("1 persona, 3 participaciones");
    expect(document.getElementById("sig-paso")?.textContent).not.toContain("1 personas");
  });

  it("con el botón apagado porque falta otra persona, la barra no dice que se está sellando", async () => {
    // Lo que hace la lista con una sola persona: apaga «Sellar» (participants.ts). Eso no es sellar.
    document.body.innerHTML = SOLO_ANA("Una pizza");
    (document.getElementById("btn-freeze") as HTMLButtonElement).disabled = true;
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    const linea = document.getElementById("sig-paso")?.textContent ?? "";
    expect(linea).toContain("1 persona, 3 participaciones");
    expect(linea).not.toMatch(/sellando/i);
  });

  it("con dos personas y el botón apagado, sí se está sellando", async () => {
    (document.getElementById("btn-freeze") as HTMLButtonElement).disabled = true;
    await import("../i18n");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    expect(document.getElementById("sig-paso")?.textContent).toMatch(/sellando la lista/i);
  });

  it("en inglés y en un orden de turnos, también en singular", async () => {
    history.replaceState(null, "", "/?modo=turnos&lang=en");
    document.body.innerHTML = SOLO_ANA("Turns") + '<button id="btn-turnos" aria-pressed="true"></button>';
    await import("../i18n");
    const { setLang } = await import("../idioma");
    setLang("en");
    const { initSiguiente } = await import("./siguiente");
    initSiguiente({ segundos: () => 0 });
    expect(document.getElementById("sig-paso")?.textContent).toContain("1 person, 3 turns");
    expect(document.getElementById("sig-paso")?.textContent).not.toContain("1 people");
  });
});
