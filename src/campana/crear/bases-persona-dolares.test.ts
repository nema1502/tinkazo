import { describe, expect, it } from "vitest";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { CLAVES_DE_LAS_BASES, basesAutomaticas, type DatosDeLasBases } from "./bases";

/**
 * Las bases que se escriben solas en una campaña de personas con el premio en dólares: se entra con la cuenta de Google, el premio
 * es en dólares digitales, quien gana muestra su código y lo recibe en la dirección que indique. No hablan de una cuenta de
 * Tinkazo, de los 7 días ni de retirar. Las de una campaña de cuentas y las de premio en mano no cambian.
 */

const dic = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";
const SORTEO = Date.UTC(2026, 10, 21, 22, 30);
const datos = (cambio: Partial<DatosDeLasBases> = {}): DatosDeLasBases => ({
  marca: "Alcancía Andina",
  ganan: 3,
  monto: 40,
  sorteoMs: SORTEO,
  zona: "America/La_Paz",
  conRedes: true,
  costo: { es: null, en: null },
  personas: true,
  ...cambio,
});

/** Los renglones que escribe este modo, sin el sexto: ese sale de una clave cuyo texto no es de esta prueba. */
const sinElSexto = (bases: string): string => bases.split("\n").filter((_, i) => i !== 5).join("\n");

describe("las bases de una campaña de personas con el premio en dólares", () => {
  it("en español, con 3 premios y con redes, son estos ocho renglones", () => {
    expect(basesAutomaticas(datos(), dic).es.split("\n")).toEqual([
      "Participar es gratis y es una vez por persona, entrando con tu cuenta de Google.",
      "Para participar hay que estar en el evento. Seguir a Alcancía Andina en sus redes es un pedido y no cambia quién gana.",
      "Se sortean 3 premios de 40 dólares digitales entre todas las personas anotadas. El sorteo es a las 18:30 y cualquiera puede comprobar el resultado.",
      "Quien gana le muestra su código a Alcancía Andina el día del evento y le pasa la dirección donde recibe dólares digitales. Alcancía Andina le manda el premio ahí. Si no se presenta ese día, Alcancía Andina decide qué hacer con el premio.",
      "Recibir el premio es gratis.",
      dic("es", "ccBase6Mano"),
      "Alcancía Andina pone los premios y responde por ellos. Tinkazo es la herramienta que hace el sorteo.",
      dic("es", "ccBase8"),
    ]);
  });

  it("en inglés, con un premio y sin redes, son estos ocho renglones", () => {
    expect(basesAutomaticas(datos({ ganan: 1, conRedes: false }), dic).en.split("\n")).toEqual([
      "Taking part is free, once per person, signing in with your Google account.",
      "To take part you must be at the event.",
      "One prize of 40 digital dollars is drawn among everyone signed up. The draw is at 18:30 and anyone can check the result.",
      "The winner shows their code to Alcancía Andina on the day of the event and gives them the address where they receive digital dollars. Alcancía Andina sends the prize there. If the winner doesn't come forward that day, Alcancía Andina decides what to do with the prize.",
      "Receiving the prize is free.",
      dic("en", "ccBase6Mano"),
      "Alcancía Andina provides the prizes and answers for them. Tinkazo is the tool that runs the draw.",
      dic("en", "ccBase8"),
    ]);
  });

  it("con un premio dice uno y con varios dice cuántos, en los dos idiomas", () => {
    const uno = basesAutomaticas(datos({ ganan: 1 }), dic);
    const varios = basesAutomaticas(datos({ ganan: 8, monto: 5 }), dic);
    expect(uno.es.split("\n")[2]).toBe("Se sortea un premio de 40 dólares digitales entre todas las personas anotadas. El sorteo es a las 18:30 y cualquiera puede comprobar el resultado.");
    expect(uno.en.split("\n")[2]).toBe("One prize of 40 digital dollars is drawn among everyone signed up. The draw is at 18:30 and anyone can check the result.");
    expect(varios.es.split("\n")[2]).toBe("Se sortean 8 premios de 5 dólares digitales entre todas las personas anotadas. El sorteo es a las 18:30 y cualquiera puede comprobar el resultado.");
    expect(varios.en.split("\n")[2]).toBe("8 prizes of 5 digital dollars are drawn among everyone signed up. The draw is at 18:30 and anyone can check the result.");
  });

  it("con redes el segundo renglón dice que seguir es un pedido, y sin redes no", () => {
    expect(basesAutomaticas(datos({ conRedes: true }), dic).es.split("\n")[1]).toBe(
      "Para participar hay que estar en el evento. Seguir a Alcancía Andina en sus redes es un pedido y no cambia quién gana.",
    );
    expect(basesAutomaticas(datos({ conRedes: false }), dic).es.split("\n")[1]).toBe("Para participar hay que estar en el evento.");
    expect(basesAutomaticas(datos({ conRedes: true }), dic).en.split("\n")[1]).toBe(
      "To take part you must be at the event. Following Alcancía Andina on social media is a request and doesn't change who wins.",
    );
    expect(basesAutomaticas(datos({ conRedes: false }), dic).en.split("\n")[1]).toBe("To take part you must be at the event.");
  });

  it("el sexto renglón sale de la clave de qué guarda Tinkazo, leída del diccionario", () => {
    const b = basesAutomaticas(datos(), dic);
    expect(b.es.split("\n")[5]).toBe(TEXTOS_CREAR_CAMPANA.es.ccBase6Mano);
    expect(b.en.split("\n")[5]).toBe(TEXTOS_CREAR_CAMPANA.en.ccBase6Mano);
    expect(b.es.split("\n")[5]?.length).toBeGreaterThan(10);
  });

  it("no nombran una cuenta de Tinkazo, los 7 días ni el retiro, aunque el sitio cobre por retirar", () => {
    for (const costo of [{ es: null, en: null }, { es: "0,50", en: "0.50" }]) {
      const b = basesAutomaticas(datos({ costo }), dic);
      expect(sinElSexto(b.es)).not.toMatch(/cuenta de Tinkazo|7 días|retir|vuelve a/iu);
      expect(sinElSexto(b.en)).not.toMatch(/Tinkazo account|7 days|withdraw|goes back/iu);
      // Recibir es gratis y nada más: el costo de mandar cada premio lo pone quien organiza.
      expect(b.es.split("\n")[4]).toBe("Recibir el premio es gratis.");
      expect(b.en.split("\n")[4]).toBe("Receiving the prize is free.");
    }
  });

  it("el renglón de la entrega dice dirección y no cuenta, y nombra a la marca las tres veces", () => {
    const b = basesAutomaticas(datos({ marca: "JBL y Compañía" }), dic);
    const [es, en] = [b.es.split("\n")[3] ?? "", b.en.split("\n")[3] ?? ""];
    expect(es).toContain("la dirección donde recibe dólares digitales");
    expect(en).toContain("the address where they receive digital dollars");
    expect(es).not.toMatch(/cuenta/iu);
    expect(en).not.toMatch(/account/iu);
    expect(es.split("JBL y Compañía")).toHaveLength(4);
    expect(en.split("JBL y Compañía")).toHaveLength(4);
    expect(`${b.es}\n${b.en}`).not.toMatch(/\{\w+\}/u);
  });

  it("cada idioma tiene ocho renglones y entra en el tope del modelo", () => {
    const b = basesAutomaticas(datos({ marca: "x".repeat(40), ganan: 8, monto: 1000 }), dic);
    expect(b.es.split("\n")).toHaveLength(8);
    expect(b.en.split("\n")).toHaveLength(8);
    expect(b.es.length).toBeLessThanOrEqual(6000);
    expect(b.en.length).toBeLessThanOrEqual(6000);
  });
});

describe("los otros dos modos no cambian", () => {
  it("sin la marca de personas son las bases de una campaña de cuentas", () => {
    const { personas: _sin, ...deCuentas } = datos();
    const b = basesAutomaticas(deCuentas, dic);
    expect(b.es.split("\n")[3]).toBe(
      "El premio llega a tu cuenta de Tinkazo. Tenés 7 días para recibirlo. Si no lo recibís en ese plazo, el premio vuelve a Alcancía Andina.",
    );
    expect(b.es.split("\n")[5]).toBe(dic("es", "ccBase6"));
    expect(b.es).not.toContain("muestra su código");
  });

  it("con el premio escrito mandan las de premio en mano, aunque venga la marca de personas", () => {
    const enMano = basesAutomaticas(datos({ premioEnMano: "Auriculares" }), dic);
    const { personas: _sin, ...sinMarca } = datos({ premioEnMano: "Auriculares" });
    expect(enMano).toEqual(basesAutomaticas(sinMarca, dic));
    expect(enMano.es.split("\n")[3]).toBe("El premio se entrega en mano en el evento, a la persona que ganó. Si no está, Alcancía Andina decide qué hacer con él.");
    expect(enMano.es).not.toContain("dólares");
  });

  it("un premio escrito en null no es premio en mano: con la marca de personas valen las de dólares", () => {
    const b = basesAutomaticas(datos({ premioEnMano: null }), dic);
    expect(b.es.split("\n")[3]).toContain("le muestra su código");
  });
});

describe("las claves nuevas del armador", () => {
  it("el renglón de la entrega está entre las claves de las bases, y todas existen en los dos idiomas", () => {
    expect(CLAVES_DE_LAS_BASES).toContain("ccBase4Persona");
    for (const clave of CLAVES_DE_LAS_BASES) {
      expect(TEXTOS_CREAR_CAMPANA.es[clave], clave).toBeTruthy();
      expect(TEXTOS_CREAR_CAMPANA.en[clave], clave).toBeTruthy();
    }
  });

  it("dicen esto, en español y en inglés", () => {
    const { es, en } = TEXTOS_CREAR_CAMPANA;
    expect(es.ccBase4Persona).toBe(
      "Quien gana le muestra su código a {marca} el día del evento y le pasa la dirección donde recibe dólares digitales. {marca} le manda el premio ahí. Si no se presenta ese día, {marca} decide qué hacer con el premio.",
    );
    expect(en.ccBase4Persona).toBe(
      "The winner shows their code to {marca} on the day of the event and gives them the address where they receive digital dollars. {marca} sends the prize there. If the winner doesn't come forward that day, {marca} decides what to do with the prize.",
    );
    expect(es.ccCostoEnvios).toBe("Envío de los premios");
    expect(en.ccCostoEnvios).toBe("Sending the prizes");
    expect(es.ccResumenConGoogle).toBe("La gente se anota con Google. Después del sorteo le mandás el premio a cada persona que gana.");
    expect(en.ccResumenConGoogle).toBe("People sign up with Google. After the draw you send the prize to each winner.");
  });

  it("no llevan signos prohibidos ni palabras técnicas", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const clave of ["ccBase4Persona", "ccCostoEnvios", "ccResumenConGoogle"]) {
        const texto = TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;«»"“”—–·→¡!]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(/\b(?:billetera|wallet|cadena|blockchain|firma|signature|token|contrato|contract|usdc|stellar)\b/iu);
      }
    }
  });
});
