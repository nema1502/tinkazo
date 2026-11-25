// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
/** La persona sale del campo: `hacia` es lo que recibe el foco, si algo lo recibe. */
const salir = (campo: HTMLInputElement, hacia: HTMLElement | null = null): void => {
  campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: hacia }));
};
const escribirYSalir = (campo: HTMLInputElement, valor: string): void => {
  escribir(campo, valor);
  salir(campo);
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
    escribirYSalir(premio(), "Polera");
    expect(aviso().hidden).toBe(true);
    escribirYSalir(premio(), "50 USD");
    expect(aviso().hidden).toBe(false);
    expect(avisoDePlataVisible()).toBe(true);
    // Lleva a armar la campaña.
    expect(aviso().querySelector("a")?.getAttribute("href")).toBe("/crear-campana.html");
    // Y se va si se borra el monto.
    escribirYSalir(premio(), "Termo");
    expect(aviso().hidden).toBe(true);
  });

  it("no aparece mientras se escribe: no empuja Sellar la lista. Aparece al salir del campo", () => {
    montarAvisoDePlata(true);
    escribir(premio(), "5");
    escribir(premio(), "50");
    escribir(premio(), "50 USD");
    expect(aviso().hidden).toBe(true);
    salir(premio());
    expect(aviso().hidden).toBe(false);
  });

  it("si el foco va a un botón o a un enlace no aparece en ese momento: la persona ya está tocando otra cosa", () => {
    montarAvisoDePlata(true);
    const sellar = document.getElementById("btn-freeze") as HTMLButtonElement;
    escribir(premio(), "50 USD");
    salir(premio(), sellar);
    expect(aviso().hidden).toBe(true);
    // Pasa de un campo a otro de la misma lista: sigue siendo escribir, y el aviso espera.
    const lugares = document.getElementById("prize-lugares") as HTMLElement;
    lugares.hidden = false;
    lugares.innerHTML = '<input data-lugar="2" type="text" />';
    salir(premio(), lugares.querySelector("input"));
    expect(aviso().hidden).toBe(false);
  });

  it("con las campañas cerradas no aparece nunca, ni escribiendo un monto", () => {
    montarAvisoDePlata(false);
    escribirYSalir(premio(), "50 USD");
    expect(aviso().hidden).toBe(true);
    expect(avisoDePlataVisible()).toBe(false);
  });

  it("también mira los campos de los demás lugares", () => {
    montarAvisoDePlata(true);
    const lugares = document.getElementById("prize-lugares") as HTMLElement;
    lugares.hidden = false;
    lugares.innerHTML = '<input data-lugar="2" type="text" />';
    escribirYSalir(lugares.querySelector("input") as HTMLInputElement, "20 dólares");
    expect(aviso().hidden).toBe(false);
  });

  it("no aparece en los modos de turnos ni de amigo secreto: ahí el campo es el nombre del orden", () => {
    montarAvisoDePlata(true);
    for (const modo of ["turnos", "amigo"]) {
      (document.getElementById("modo-botones") as HTMLElement).dataset.modo = modo;
      escribirYSalir(premio(), "");
      escribirYSalir(premio(), "50 USD");
      expect(aviso().hidden, modo).toBe(true);
    }
    (document.getElementById("modo-botones") as HTMLElement).dataset.modo = "sorteo";
    escribirYSalir(premio(), "");
    escribirYSalir(premio(), "50 USD");
    expect(aviso().hidden).toBe(false);
  });

  it("se cierra, no vuelve en la sesión y sigue cerrado al recargar la página", () => {
    montarAvisoDePlata(true);
    escribirYSalir(premio(), "50 USD");
    (document.getElementById("prize-plata-x") as HTMLButtonElement).click();
    expect(aviso().hidden).toBe(true);
    escribirYSalir(premio(), "");
    escribirYSalir(premio(), "100 USD");
    expect(aviso().hidden).toBe(true);
    // Otra carga de la página dentro de la misma pestaña.
    reiniciarAvisoDePlata();
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    montarAvisoDePlata(true);
    escribirYSalir(premio(), "50 USD");
    expect(aviso().hidden).toBe(true);
  });

  it("al cerrarlo el foco no vuelve a un campo de texto: en un celular abriría el teclado", () => {
    montarAvisoDePlata(true);
    escribirYSalir(premio(), "50 USD");
    const x = document.getElementById("prize-plata-x") as HTMLButtonElement;
    x.focus();
    x.click();
    const activo = document.activeElement;
    expect(activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement).toBe(false);
    expect(aviso().hidden).toBe(true);
  });

  it("el enlace a armar la campaña abre en otra pestaña y no saca a quien organiza de la lista que está armando", () => {
    const enlaceDelAviso = aviso().querySelector("a");
    expect(enlaceDelAviso?.getAttribute("target")).toBe("_blank");
    expect(enlaceDelAviso?.getAttribute("rel")).toContain("noopener");
    const discreto = document.querySelector(".premio-campana a");
    expect(discreto?.getAttribute("target")).toBe("_blank");
    expect(discreto?.getAttribute("rel")).toContain("noopener");
  });

  it("sin almacenamiento sigue funcionando: el cierre vale mientras dura la página", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("sin almacenamiento");
    };
    try {
      montarAvisoDePlata(true);
      escribirYSalir(premio(), "50 USD");
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
    escribirYSalir(premio(), "50 USD");
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

  it("está junto al campo y marcado: con las campañas cerradas lo esconde la regla de la bandera", () => {
    expect(enlace().hasAttribute("data-campana-enlace")).toBe(true);
    expect(enlace().hidden).toBe(false);
    expect(enlace().closest(".field")?.querySelector("#prize")).not.toBeNull();
    expect(enlace().querySelector("a")?.getAttribute("href")).toBe("/crear-campana.html");
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
        // El aviso sí dice dinero: es justo lo que le explica a quien escribe un monto (ver la prueba de abajo).
        const vedadas = k === "plAviso" ? /rifa|loter|raffle|ticket|boleto|apuesta|suerte|plata|cash/i : /rifa|loter|raffle|ticket|boleto|apuesta|suerte|plata|dinero|money|cash/i;
        expect(v, `${l}.${k}`).not.toMatch(vedadas);
      }
    }
  });

  it("el aviso pregunta si el premio es dinero, que es lo que se entiende, y no si tiene valor", () => {
    expect(T.es.plAviso).toBe("¿El premio es dinero? Con una campaña, quien gana lo recibe en dólares digitales.");
    expect(T.en.plAviso).toBe("Is the prize money? With a campaign, the winner gets it in digital dollars.");
    expect(html).toContain(`data-i="plAviso">${T.es.plAviso}<`);
  });
});
