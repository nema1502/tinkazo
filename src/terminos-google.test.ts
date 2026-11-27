import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIDA_CAMPANA_MS } from "../workers/sala/src/campana";
import { codigosDeEntrega, lineaDePersona } from "../workers/sala/src/linea-persona";
import { crearTablaDePerfiles } from "../workers/sala/src/perfiles";
import type { Ejecutar } from "../workers/sala/src/registro";
import { VIDA_MEMORIA_PERSONA_MS } from "./campana/memoria";
import { TEXTOS_CAMPANA } from "./campana/textos";
import { T } from "./i18n";
import { TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";

/**
 * Los Términos de quien se anota con su cuenta de Google. Cuando la sala y el sitio tienen prendido guardar el perfil, Tinkazo
 * guarda el correo, el nombre y la foto de esa persona: el recuadro lo dice, y la nota de los servicios deja de decir que no
 * hay ninguna base de participantes. Lo que el recuadro afirma y se puede comprobar contra el código se comprueba acá: si la
 * tabla de perfiles suma una columna, o la sala cambia lo que vive, esta prueba falla hasta que el texto lo diga.
 */

const IDIOMAS = ["es", "en"] as const;
const texto = (idioma: (typeof IDIOMAS)[number], clave: string): string => String(T[idioma][clave] ?? "");
const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const INICIO_ES =
  "No hay publicidad ni rastreadores que te sigan de un sitio a otro. Las listas y los nombres de un sorteo no quedan en ninguna base " +
  "que podamos leer. Si te anotás con tu cuenta de Google y la pantalla lo dice, guardamos tu correo, tu nombre y tu foto, como cuenta " +
  "el recuadro Si te anotás con tu cuenta de Google, más arriba.";
const INICIO_EN =
  "No ads and no trackers that follow you from site to site. The lists and names of a draw are not kept in any database we can read. " +
  "If you sign up with your Google account and the screen says so, we keep your email, name and photo, as the box If you sign up with " +
  "your Google account above explains.";

describe("los Términos: el recuadro de quien se anota con su cuenta de Google", () => {
  it("tiene su título y su texto en los dos idiomas", () => {
    expect(texto("es", "tmGoogleT")).toBe("Si te anotás con tu cuenta de Google");
    expect(texto("en", "tmGoogleT")).toBe("If you sign up with your Google account");
    for (const idioma of IDIOMAS) expect(texto(idioma, "tmGoogleB").length, idioma).toBeGreaterThan(600);
  });

  it("terminos.html lo trae justo debajo de Lo que se guarda en una campaña, con su id y el texto en español del diccionario", () => {
    const html = leer("terminos.html");
    const hallazgo =
      /<article class="nota" id="campana-datos">[\s\S]*?<\/article>\s*<article class="nota" id="campana-google">\s*<h3 data-i="tmGoogleT">([^<]*)<\/h3>\s*<p data-i="tmGoogleB">([^<]*)<\/p>\s*<\/article>/u.exec(
        html,
      );
    expect(hallazgo).not.toBeNull();
    expect(hallazgo?.[1]).toBe(texto("es", "tmGoogleT"));
    expect(hallazgo?.[2]).toBe(texto("es", "tmGoogleB"));
    // A la vista siempre: ni dentro de lo que depende de una bandera ni dentro de un plegado.
    const aLaVista = html.replace(/<template\b[\s\S]*?<\/template>/gu, "").replace(/<details\b[\s\S]*?<\/details>/gu, "");
    expect(aLaVista).toContain('id="campana-google"');
  });

  it("dice todo lo que guarda la tabla de perfiles, columna por columna", () => {
    let creada = "";
    const anotar: Ejecutar = (consulta) => {
      creada = consulta;
      return [];
    };
    crearTablaDePerfiles(anotar);
    const columnas = (/\(([\s\S]*)\)/u.exec(creada)?.[1] ?? "").split(",").map((columna) => columna.trim().split(/\s+/u)[0]);
    // Si esta lista cambia, el recuadro tiene que decir lo nuevo en el mismo cambio.
    expect(columnas).toEqual(["id", "correo", "nombre", "foto", "primera_ms", "ultima_ms", "veces"]);
    expect(texto("es", "tmGoogleB")).toContain(
      "Tinkazo guarda tu correo, tu nombre, la dirección de tu foto de perfil y el identificador de tu cuenta de Google, " +
        "con la fecha de la primera y de la última vez que te anotaste y cuántas veces lo hiciste: es tu cuenta de Tinkazo.",
    );
    expect(texto("en", "tmGoogleB")).toContain(
      "Tinkazo keeps your email, your name, the address of your profile photo and your Google account identifier, " +
        "with the date of the first and of the last time you signed up and how many times you did: that is your Tinkazo account.",
    );
  });

  it("se guarda solo cuando la pantalla lo dice, y la pantalla nombra lo mismo que el recuadro", () => {
    expect(texto("es", "tmGoogleB")).toContain("Cuando la pantalla donde te anotás lo dice, Tinkazo guarda");
    expect(texto("en", "tmGoogleB")).toContain("When the screen where you sign up says so, Tinkazo keeps");
    expect(TEXTOS_CAMPANA.es.cpEntrarNotaPerfil).toContain("Guardamos tu correo, tu nombre y tu foto.");
    expect(TEXTOS_CAMPANA.en.cpEntrarNotaPerfil).toContain("We keep your email, name and photo.");
  });

  it("dice para qué se usa, qué recibe quien organiza, dónde queda y cómo pedir que se borre, con el correo de contacto de la página", () => {
    const es = texto("es", "tmGoogleB");
    const en = texto("en", "tmGoogleB");
    expect(es).toContain("La usamos para saber quiénes usan Tinkazo y para escribirte por tus sorteos o por novedades del servicio.");
    expect(en).toContain("We use it to know who uses Tinkazo and to write to you about your draws or about news of the service.");
    // El nombre de la cuenta de Google viaja cifrado con la clave del enlace y quien organiza lo ve en la pantalla del evento.
    expect(es).toContain(
      "Quien organiza no recibe tu correo ni tu foto, y tu nombre sí puede verse en la pantalla del evento. " +
        "Fuera de eso, esos datos no se publican y no se venden.",
    );
    expect(en).toContain(
      "The organizer doesn't get your email or your photo. Your name may show on the event screen. " +
        "Apart from that, this data is not published or sold.",
    );
    for (const dicho of [es, en]) expect(dicho).not.toMatch(/no recibe esos datos|does not receive this data/u);
    // La pantalla donde la persona se anota dice lo mismo, con las mismas palabras.
    expect(TEXTOS_CAMPANA.es.cpQueGuardamosPerfil).toContain(
      "Quien organiza no recibe tu correo ni tu foto, y tu nombre sí puede verse en la pantalla del evento.",
    );
    expect(TEXTOS_CAMPANA.en.cpQueGuardamosPerfil).toContain(
      "The organizer doesn't get your email or your photo. Your name may show on the event screen.",
    );
    expect(es).toContain("Quedan guardados en Cloudflare hasta que pidas borrarlos: escribinos a hola@tinkazo.app desde ese correo.");
    expect(en).toContain("It is stored on Cloudflare until you ask us to delete it: write to hola@tinkazo.app from that email address.");
    // El mismo correo que la página da para escribir.
    for (const idioma of IDIOMAS) expect(texto(idioma, "tmMore5"), idioma).toContain("hola@tinkazo.app");
  });

  it("la línea de la lista no es el correo ni el identificador y cambia de una campaña a otra", async () => {
    const usuario = "google:108000000000000000001";
    const una = await lineaDePersona("00".repeat(32), usuario);
    const otra = await lineaDePersona("11".repeat(32), usuario);
    expect(una).not.toBe(otra);
    for (const linea of [una, otra]) {
      expect(linea).not.toContain(usuario);
      expect(linea).not.toContain("108000000000000000001");
      expect(linea).not.toContain("@");
    }
    expect(texto("es", "tmGoogleB")).toContain(
      "En la lista del sorteo no va nada de eso. Va una línea que te representa en esa campaña, que no es tu correo ni tu identificador " +
        "y es distinta en cada campaña, y tu nombre cifrado, igual que en las demás campañas. " +
        "En la red queda sellada solo la huella de la lista de esas líneas.",
    );
    expect(texto("en", "tmGoogleB")).toContain(
      "None of that goes into the draw list. The list holds a line that stands for you in that campaign, which is not your email or " +
        "your identifier and is different in every campaign, and your encrypted name, as in other campaigns. " +
        "Only a fingerprint of the list of those lines is sealed on the network.",
    );
  });

  it("quien gana tiene un código para mostrar, de cuatro cifras", async () => {
    const sal = "22".repeat(32);
    const ganadora = await lineaDePersona(sal, "google:108000000000000000002");
    expect((await codigosDeEntrega(sal, [ganadora]))[0]).toMatch(/^\d{4}$/u);
    expect(texto("es", "tmGoogleB")).toContain(
      "Si ganás, lo ves al abrir la página desde tu celular, con un código para mostrarle a quien organiza, que te entrega el premio. " +
        "Si el premio es en dólares digitales, te los manda a la cuenta que le indiques después de ver tu código.",
    );
    expect(texto("en", "tmGoogleB")).toContain(
      "If you win, you see it when you open the page on your phone, with a code to show the organizer, who gives you the prize. " +
        "If the prize is in digital dollars, they send it to the account you give them after checking your code.",
    );
    for (const idioma of IDIOMAS) expect(texto(idioma, "tmGoogleB"), idioma).not.toMatch(/en persona|in person/iu);
  });

  it("la sala vive 24 horas y el celular de una campaña de personas recuerda lo mismo: pasado ese tiempo la página ya no dice si ganaste", () => {
    expect(VIDA_CAMPANA_MS).toBe(24 * 3_600_000);
    // Lo que recuerda el celular en estas campañas dura lo que la sala: el texto no puede prometer más.
    expect(VIDA_MEMORIA_PERSONA_MS).toBe(VIDA_CAMPANA_MS);
    expect(texto("es", "tmGoogleB")).toMatch(
      /La sala de la campaña vive 24 horas como máximo: pasado ese tiempo, la página ya no puede decirte si ganaste\.$/u,
    );
    expect(texto("en", "tmGoogleB")).toMatch(
      /The campaign room lives 24 hours at most: after that, the page can no longer tell you whether you won\.$/u,
    );
    for (const idioma of IDIOMAS) expect(texto(idioma, "tmGoogleB"), idioma).not.toMatch(/salvo que|unless you had/iu);
  });

  it("no promete que no se guarda nada ni que no hay cuenta", () => {
    for (const idioma of IDIOMAS) {
      expect(texto(idioma, "tmGoogleB"), idioma).not.toMatch(/no guardamos|no se guarda nada|don't keep|nothing is kept|ninguna cuenta|any account/iu);
    }
  });

  it("sin palabras de la cadena ni signos que el sitio no usa, porque el recuadro está a la vista", () => {
    // La misma lista que mira sin-jerga-a-la-vista.test.ts en lo que se ve de los términos sin desplegar nada.
    const jerga = /\b(XLM|USDC|stroops?|testnet|mainnet|drand|hash(es)?|SHA|BLS|Soroban|ledger|Stellar|blockchain|billetera|wallet|token)\b/iu;
    for (const idioma of IDIOMAS) {
      for (const clave of ["tmGoogleT", "tmGoogleB"]) {
        expect(texto(idioma, clave), `${idioma}.${clave}`).not.toMatch(jerga);
        // Punto y coma, comillas, rayas, punto medio, exclamaciones y flechas, escritos por su número.
        expect(texto(idioma, clave), `${idioma}.${clave}`).not.toMatch(/[;«»"“”„—–·¡!]/u);
        expect(texto(idioma, clave), `${idioma}.${clave}`).not.toMatch(/[←-⇿⟵-⟿]/u);
        expect(texto(idioma, clave).trim(), `${idioma}.${clave}`).toBe(texto(idioma, clave));
      }
    }
  });
});

describe("los Términos: la nota de los servicios remite al recuadro de quienes se anotan con Google", () => {
  it("empieza con el texto nuevo en el diccionario del modo Oficial, y lo demás sigue como estaba", () => {
    expect(TEXTOS_MODO_OFICIAL.es.tmMore1?.startsWith(`${INICIO_ES} Durante un sorteo el sitio pide afuera el número que publica un faro público`)).toBe(true);
    expect(TEXTOS_MODO_OFICIAL.en.tmMore1?.startsWith(`${INICIO_EN} During a draw the site fetches the number a public beacon publishes`)).toBe(true);
    expect(TEXTOS_MODO_OFICIAL.es.tmMore1).toMatch(/Los topes por dirección IP se cuentan en memoria, y la dirección nunca se escribe en disco ni en registros\.$/u);
    expect(TEXTOS_MODO_OFICIAL.en.tmMore1).toMatch(/The limits per IP address are counted in memory, and the address is never written to disk or to logs\.$/u);
  });

  it("empieza con el texto nuevo también en el diccionario de siempre, en los dos idiomas", () => {
    // Se pregunta si está y no se compara el archivo entero: si falla, el mensaje no vuelca siete mil renglones.
    const fuente = leer("src/i18n.ts");
    const es = `tmMore1: "${INICIO_ES} Durante un sorteo el sitio pide afuera el número que publica un faro público`;
    const en = `tmMore1: "${INICIO_EN} During a draw the site fetches the number a public beacon publishes`;
    expect(fuente.includes(es), "src/i18n.ts, tmMore1 en español").toBe(true);
    expect(fuente.includes(en), "src/i18n.ts, tmMore1 en inglés").toBe(true);
  });

  it("ningún diccionario ni la página dicen ya que no hay una base de participantes que podamos leer", () => {
    for (const archivo of ["src/i18n.ts", "src/i18n-modo-oficial.ts", "terminos.html"]) {
      const contenido = leer(archivo);
      expect(contenido.includes("ni una base de datos de participantes que podamos leer"), archivo).toBe(false);
      expect(contenido.includes("no database of participants we can read"), archivo).toBe(false);
    }
  });

  it("nombra el recuadro por su título, letra por letra, en los dos idiomas", () => {
    expect(texto("es", "tmMore1")).toContain(`como cuenta el recuadro ${texto("es", "tmGoogleT")}, más arriba.`);
    expect(texto("en", "tmMore1")).toContain(`as the box ${texto("en", "tmGoogleT")} above explains.`);
  });

  it("no afirma que exista una lista ni que sea la única: dice lo que se guarda solo si la pantalla lo dice", () => {
    for (const archivo of ["src/i18n.ts", "src/i18n-modo-oficial.ts", "terminos.html"]) {
      const contenido = leer(archivo);
      expect(contenido.includes("La única lista de personas"), archivo).toBe(false);
      expect(contenido.includes("The only list of people"), archivo).toBe(false);
    }
    expect(texto("es", "tmMore1")).toContain("y la pantalla lo dice, guardamos");
    expect(texto("en", "tmMore1")).toContain("and the screen says so, we keep");
    for (const idioma of IDIOMAS) expect(texto(idioma, "tmMore1"), idioma).not.toMatch(/única|único|the only/iu);
  });

  it("terminos.html trae la nota con el mismo texto en español que el diccionario", () => {
    expect(leer("terminos.html").includes(`<li data-i="tmMore1">${texto("es", "tmMore1")}</li>`), "terminos.html, tmMore1").toBe(true);
  });
});

describe("los documentos dicen lo mismo que los Términos, con el interruptor apagado y prendido", () => {
  const sinSaltos = (ruta: string): string => leer(ruta).replace(/\s+/gu, " ");

  it("premios.md ya no afirma sin más que no se guarda el correo ni nada para volver a la persona", () => {
    const premios = sinSaltos("docs/premios.md");
    expect(premios.includes("y no queda guardado ni su correo ni su identificador."), "la frase de antes").toBe(false);
    expect(premios.includes("no se manda correo ni se guarda nada para volver a la persona"), "la frase de antes").toBe(false);
    expect(premios.includes("Con el interruptor del perfil apagado, que es como nace, no queda guardado ni su correo ni su identificador."), "apagado").toBe(true);
    expect(premios.includes("`PERFILES`") && premios.includes("`VITE_GUARDAR_PERFIL`"), "los dos interruptores").toBe(true);
    expect(premios.includes("la tabla `perfiles` del objeto de cupos, que no se borra con la sala"), "dónde queda").toBe(true);
  });

  it("legal.md cuenta el perfil entre los datos de los participantes y como excepción a no tener datos legibles", () => {
    const legal = sinSaltos("docs/legal.md");
    expect(legal.includes("**En una campaña que se anota con la cuenta de Google**"), "el punto nuevo").toBe(true);
    expect(legal.includes(`su recuadro ${texto("es", "tmGoogleT")}`), "nombra el recuadro de los términos").toBe(true);
    expect(legal.includes("Ya es así: el enlace corto guarda una copia cifrada que Tinkazo no puede leer, y la borra a pedido. Se mantiene cuando lleguen los correos. La excepción"), "la excepción").toBe(true);
    expect(legal.includes("tampoco tiene plazo"), "el plazo que falta").toBe(true);
  });

  it("operacion.md y legal.md no dicen que quien organiza no recibe nada: el nombre puede verse en la pantalla del evento", () => {
    for (const ruta of ["docs/operacion.md", "docs/legal.md"]) {
      const documento = sinSaltos(ruta);
      expect(documento.includes("Quien organiza no los recibe"), ruta).toBe(false);
      expect(documento.includes("Quien organiza no recibe el correo ni la foto, y el nombre sí puede verse en la pantalla del evento"), ruta).toBe(true);
    }
  });

  it("operacion.md, el README de la sala y premios.md cuentan que la pantalla dice que se guarda solo si la sala lo confirma", () => {
    const operacion = sinSaltos("docs/operacion.md");
    expect(operacion.includes("**La pantalla dice que se guarda solo si la sala lo confirma.**"), "operacion.md").toBe(true);
    expect(operacion.includes("trae `\"perfil\": true` únicamente con `PERFILES` prendida"), "operacion.md, el campo").toBe(true);
    expect(operacion.includes("`curl -s https://s.tinkazo.app/v1/sala/<id>/campana/estado`) tiene que traer `\"perfil\":true`"), "operacion.md, cómo se comprueba").toBe(true);
    const readme = sinSaltos("workers/sala/README.md");
    expect(readme.includes("**La pantalla dice que se guarda solo si la sala lo confirma.**"), "README de la sala").toBe(true);
    expect(readme.includes("suma `\"perfil\": true` (apagada, el campo no existe)"), "README de la sala, la ruta").toBe(true);
    expect(sinSaltos("docs/premios.md").includes("Esa página lo dice solo si la sala lo confirma en el estado público de la campaña"), "premios.md").toBe(true);
  });

  it("prd.md ya no dice sin más que no hay ninguna base de participantes que Tinkazo pueda leer", () => {
    const prd = sinSaltos("docs/prd.md");
    expect(prd.includes("No hay base de datos de participantes que Tinkazo pueda leer:"), "la frase de antes").toBe(false);
    expect(prd.includes("No hay base de datos de participantes que Tinkazo pueda leer, con una excepción que nace apagada"), "la excepción").toBe(true);
    expect(prd.includes("y todo se borra con la sala del evento, que vive 24 horas como máximo. En una campaña de personas"), "lo que no se borra con la sala").toBe(true);
  });
});

describe("los Términos: la descripción de la página habla de los nombres de la lista", () => {
  // Con el perfil guardado, Tinkazo tiene el nombre de quien se anota con Google. Lo que no puede leer son los nombres de la
  // lista de quien organiza, y la descripción que muestran los buscadores promete eso y nada más.
  it("dice solo que los nombres de la lista no se publican, sin afirmar que Tinkazo no los puede leer", () => {
    expect(texto("es", "descTerminos")).toContain("los nombres de su lista no se publican. ");
    expect(texto("en", "descTerminos")).toContain("names on their list are not published. ");
    expect(texto("es", "descTerminos")).not.toMatch(/puede leer|pueden leer/u);
    expect(texto("en", "descTerminos")).not.toMatch(/cannot read|can't read/u);
  });

  it("terminos.html la repite en la descripción, en los datos estructurados y en la vista previa al compartir", () => {
    const html = leer("terminos.html");
    const es = texto("es", "descTerminos");
    expect(html.includes(`<meta name="description" content="${es}" />`), "la meta description").toBe(true);
    expect(html.includes(`"description":"${es}"`), "los datos estructurados").toBe(true);
    expect(html, "terminos.html no afirma que Tinkazo no puede leer los nombres").not.toMatch(/Tinkazo no los puede leer|Tinkazo cannot read/u);
    for (const etiqueta of ['property="og:description"', 'name="twitter:description"']) {
      const contenido = new RegExp(`<meta ${etiqueta} content="([^"]*)"`, "u").exec(html)?.[1] ?? "";
      expect(contenido, etiqueta).toContain("the names on their list are not published.");
      expect(contenido, etiqueta).not.toMatch(/cannot read|can't read/u);
    }
  });
});
