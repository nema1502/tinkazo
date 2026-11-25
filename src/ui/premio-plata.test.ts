// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mostrarEnlacesDeCampana } from "../campana/bandera";
import { T } from "../i18n";
import { avisoDePlataVisible, montarAvisoDePlata, parecePremioEnPlata, reiniciarAvisoDePlata } from "./premio-plata";

/**
 * El aviso del premio en plata (25 de noviembre de 2026). Quien escribe qué sortea y pone un monto ("50 USD") ve, debajo del
 * campo, que una campaña de empresa se lo paga a quien gana. Es un aviso que se cierra y no vuelve en la sesión: nunca frena
 * Sellar la lista ni suma un segundo botón principal. Solo existe con las campañas abiertas y solo en el modo de sortear premios.
 */
const html = readFileSync("index.html", "utf8");

const premio = (): HTMLInputElement => document.getElementById("prize") as HTMLInputElement;
const aviso = (): HTMLElement => document.getElementById("prize-plata") as HTMLElement;
const escribir = (campo: HTMLInputElement, valor: string): void => {
  campo.value = valor;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  sessionStorage.clear();
  reiniciarAvisoDePlata();
});
afterEach(() => reiniciarAvisoDePlata());

describe("qué es un premio en plata", () => {
  it("reconoce un monto con su unidad, en las formas que ya reconoce Pagar premio", () => {
    for (const texto of ["50 USD", "USDC 50", "$50", "12,5 dólares", "Tarjeta de regalo USD 25", "Entrada $10"]) {
      expect(parecePremioEnPlata(texto), texto).toBe(true);
    }
  });

  it("no se dispara con un premio común ni con un número suelto", () => {
    for (const texto of ["", "Polera", "Libro", "2 entradas", "Kit de bienvenida", "10 stickers"]) {
      expect(parecePremioEnPlata(texto), texto).toBe(false);
    }
  });
});

describe("el aviso debajo del campo del premio", () => {
  it("nace escondido y, con las campañas abiertas, aparece al escribir un monto", () => {
    montarAvisoDePlata(true);
    expect(aviso().hidden).toBe(true);
    escribir(premio(), "Polera");
    expect(aviso().hidden).toBe(true);
    escribir(premio(), "50 USD");
    expect(aviso().hidden).toBe(false);
    expect(avisoDePlataVisible()).toBe(true);
    // Lleva a armar la campaña.
    expect(aviso().querySelector("a")?.getAttribute("href")).toBe("/crear-campana.html");
    // Y se va si se borra el monto.
    escribir(premio(), "Termo");
    expect(aviso().hidden).toBe(true);
  });

  it("con las campañas cerradas no aparece nunca, ni escribiendo un monto", () => {
    montarAvisoDePlata(false);
    escribir(premio(), "50 USD");
    expect(aviso().hidden).toBe(true);
    expect(avisoDePlataVisible()).toBe(false);
  });

  it("también mira los campos de los demás lugares", () => {
    montarAvisoDePlata(true);
    const lugares = document.getElementById("prize-lugares") as HTMLElement;
    lugares.hidden = false;
    lugares.innerHTML = '<input data-lugar="2" type="text" />';
    escribir(lugares.querySelector("input") as HTMLInputElement, "20 dólares");
    expect(aviso().hidden).toBe(false);
  });

  it("no aparece en los modos de turnos ni de amigo secreto: ahí el campo es el nombre del orden", () => {
    montarAvisoDePlata(true);
    for (const modo of ["turnos", "amigo"]) {
      (document.getElementById("modo-botones") as HTMLElement).dataset.modo = modo;
      escribir(premio(), "");
      escribir(premio(), "50 USD");
      expect(aviso().hidden, modo).toBe(true);
    }
    (document.getElementById("modo-botones") as HTMLElement).dataset.modo = "sorteo";
    escribir(premio(), "");
    escribir(premio(), "50 USD");
    expect(aviso().hidden).toBe(false);
  });

  it("se cierra, no vuelve en la sesión y sigue cerrado al recargar la página", () => {
    montarAvisoDePlata(true);
    escribir(premio(), "50 USD");
    (document.getElementById("prize-plata-x") as HTMLButtonElement).click();
    expect(aviso().hidden).toBe(true);
    escribir(premio(), "");
    escribir(premio(), "100 USD");
    expect(aviso().hidden).toBe(true);
    // Otra carga de la página dentro de la misma pestaña.
    reiniciarAvisoDePlata();
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    montarAvisoDePlata(true);
    escribir(premio(), "50 USD");
    expect(aviso().hidden).toBe(true);
  });

  it("sin almacenamiento sigue funcionando: el cierre vale mientras dura la página", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("sin almacenamiento");
    };
    try {
      montarAvisoDePlata(true);
      escribir(premio(), "50 USD");
      (document.getElementById("prize-plata-x") as HTMLButtonElement).click();
      expect(aviso().hidden).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("nunca frena Sellar la lista ni suma un botón principal", () => {
    montarAvisoDePlata(true);
    const sellar = document.getElementById("btn-freeze") as HTMLButtonElement;
    const antes = sellar.disabled;
    escribir(premio(), "50 USD");
    expect(aviso().hidden).toBe(false);
    expect(sellar.disabled).toBe(antes);
    expect(aviso().querySelector(".primary")).toBeNull();
    expect(aviso().getAttribute("role")).toBe("status");
    // El cierre se toca con el pulgar.
    expect(document.getElementById("prize-plata-x")?.getAttribute("aria-label") ?? "").not.toBe("");
  });
});

describe("el enlace discreto a la campaña", () => {
  const enlace = (): HTMLElement => document.querySelector<HTMLElement>(".premio-campana") as HTMLElement;

  it("está junto al campo, escondido hasta que las campañas estén abiertas", () => {
    expect(enlace().hasAttribute("data-campana-enlace")).toBe(true);
    expect(enlace().hidden).toBe(true);
    expect(enlace().closest(".field")?.querySelector("#prize")).not.toBeNull();
    expect(enlace().querySelector("a")?.getAttribute("href")).toBe("/crear-campana.html");
    mostrarEnlacesDeCampana(document, true);
    expect(enlace().hidden).toBe(false);
  });

  it("es un enlace con forma de enlace, no un botón", () => {
    expect(enlace().querySelector("a.enlace")).not.toBeNull();
    expect(enlace().querySelector("button, .primary, .ghost")).toBeNull();
  });
});

describe("los textos, en los dos idiomas", () => {
  const CLAVES = ["plEnlace", "plAviso", "plCerrar"];

  it("existen en español y en inglés, y el HTML dice lo mismo que el diccionario", () => {
    for (const k of CLAVES) {
      expect(typeof T.es[k], `es.${k}`).toBe("string");
      expect(typeof T.en[k], `en.${k}`).toBe("string");
      expect(T.en[k], k).not.toBe(T.es[k]);
    }
    for (const k of ["plEnlace", "plAviso"]) {
      expect(html.match(new RegExp(`data-i="${k}">([^<]+)<`))?.[1], k).toBe(T.es[k]);
    }
    expect(html).toContain('data-i-aria="plCerrar"');
  });

  it("sin comillas angulares, punto y coma ni las palabras que no van", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const v = T[l][k] as string;
        expect(v, `${l}.${k}`).not.toMatch(/[«»;]/);
        expect(v, `${l}.${k}`).not.toMatch(/rifa|loter|raffle|ticket|boleto|apuesta|suerte|plata|dinero|money|cash/i);
      }
    }
  });
});
