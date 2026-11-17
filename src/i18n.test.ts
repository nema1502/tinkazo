import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { T } from "./i18n";
import { HAY_MODO_OFICIAL, TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";

/**
 * La regla del repositorio: toda cadena visible nueva va en español y en
 * inglés en el mismo cambio. El tipo del diccionario no lo exige ·tiene una
 * firma de índice·, así que una clave olvidada en un idioma compilaba y en
 * pantalla aparecía la clave cruda.
 */
describe("diccionario", () => {
  it("los dos idiomas tienen exactamente las mismas claves", () => {
    const soloEs = Object.keys(T.es).filter((k) => !(k in T.en));
    const soloEn = Object.keys(T.en).filter((k) => !(k in T.es));
    expect({ soloEs, soloEn }).toEqual({ soloEs: [], soloEn: [] });
  });

  it("cada clave es del mismo tipo en los dos idiomas", () => {
    const distintas = Object.keys(T.es).filter((k) => {
      const a = T.es[k];
      const b = T.en[k];
      return Array.isArray(a) !== Array.isArray(b) || typeof a !== typeof b;
    });
    expect(distintas).toEqual([]);
  });

  it("ninguna cadena queda vacía", () => {
    const vacias = (["es", "en"] as const).flatMap((l) =>
      Object.entries(T[l])
        .filter(([, v]) => (typeof v === "string" && !v.trim()) || (Array.isArray(v) && (v.length === 0 || v.some((x) => !x.trim()))))
        .map(([k]) => `${l}.${k}`),
    );
    expect(vacias).toEqual([]);
  });

  it("la cuenta de prueba se presenta como Invitado para no repetir el nombre del modo", () => {
    expect(T.es.cuentaViaPruebaC).toBe("Invitado");
    expect(T.en.cuentaViaPruebaC).toBe("Guest");
    expect(T.es.cuentaViaPruebaC).not.toBe(T.es.modeTest);
    expect(T.en.cuentaViaPruebaC).not.toBe(T.en.modeTest);
  });

  it("Sapo: the drop line names the prize, never the co-winner, the tally counts, 'almost' and the frog's lip exist", () => {
    // Al caer el co-ganador la línea dice su número de premio: no hay nombre que decir.
    expect(T.es.cSapDone(2)).toMatch(/premio 2/i);
    expect(T.en.cSapDone(2)).toMatch(/prize 2/i);
    expect(T.es.cSapTally(1, 2)).toBe("Premio 1 de 2");
    expect(T.en.cSapTally(1, 2)).toBe("Prize 1 of 2");
    for (const k of ["cSapAlmost", "cSapLip"]) {
      expect(T.es[k]).toBeTruthy();
      expect(T.en[k]).toBeTruthy();
    }
  });

  it("la barra del sorteo dice número público, sin 'ronda' ni '#'", () => {
    // `${t("seed")} ${ronda}` arriba del estadio y en el rótulo del sorteo, y
    // `cWheelRound` en el motor anterior. "Ronda" es la palabra de drand, y "#"
    // ya es el número del sorteo en Mis sorteos ("Sorteo #12").
    for (const l of ["es", "en"] as const) {
      for (const k of ["seed", "cWheelRound"]) {
        const v = T[l][k] as string;
        expect(v).not.toMatch(/ronda|round|#/i);
        expect(v).toMatch(/número público|public number/i);
      }
    }
  });

  it("Trompo: el cierre nombra a quien gana sin repetir el GANA del cartel", () => {
    // El cartel de la corona dice "GANA" y el nombre; con "¡GANA X!" en la caja
    // de abajo la pantalla decía dos veces lo mismo (revisión visual, 21 de
    // octubre de 2026). Con dos premios tiene que nombrar a los dos: lo mira
    // audit-game.
    for (const l of ["es", "en"] as const) {
      for (let i = 0; i < 40; i++) {
        const uno = T[l].cTroWin("Lucía Flores"), dos = T[l].cTroWin("Ana y Beto", true);
        expect(uno).toContain("Lucía Flores");
        expect(dos).toContain("Ana y Beto");
        expect(uno + dos).not.toMatch(/\bganan?\b|\bwins?\b|\bwinners?\b/i);
      }
    }
  });

  it("Teleférico: la última estación dice lo mismo que el contador", () => {
    // Al llegar con tres o más arriba no puede decir "quedan dos"; con dos, sí.
    // Las variantes salen al azar: se prueban muchas veces.
    for (let i = 0; i < 60; i++) {
      for (const left of [3, 4, 20]) {
        expect(T.es.cTelLast(left)).not.toMatch(/dos/i);
        expect(T.en.cTelLast(left)).not.toMatch(/two/i);
      }
      expect(T.es.cTelLast(2)).toMatch(/QUEDAN DOS|Última estación/);
      expect(T.en.cTelLast(2)).toMatch(/TWO LEFT|Last station/);
      // Los que se bajan juntos se nombran todos, y los que no entran se cuentan.
      expect(T.es.cTelOffN(["Ana", "Iván"], 0)).toMatch(/Ana e Iván/);
      expect(T.en.cTelOffN(["Ana", "Bea", "Ciro"], 15)).toMatch(/Ana, Bea, Ciro and 15 more/);
      expect(T.es.cTelOffN(["Ana", "Bea", "Ciro"], 15)).toMatch(/Ana, Bea, Ciro y 15 más/);
    }
  });

  it("con modo Oficial, los modos se llaman Prueba y Oficial, sin nombres técnicos ni promesas de que algo no se borra", () => {
    // El diccionario con el modo Oficial puesto: son los textos que se ven cuando la lista oficial tiene contrato en la red real.
    const conModo = (l: "es" | "en"): Record<string, unknown> => ({ ...T[l], ...TEXTOS_MODO_OFICIAL[l] });
    expect(conModo("es").netTest).toBe("Prueba");
    expect(conModo("es").netMain).toBe("Oficial");
    expect(conModo("en").netTest).toBe("Test");
    expect(conModo("en").netMain).toBe("Live");
    for (const l of ["es", "en"] as const) {
      for (const k of ["netTest", "netMain", "netTestHint", "netMainHint", "modeOfficialBody", "modeTestBody", "sealModeOfficial", "sealModeTest", "firstOfficialBody", "acctNetTest", "acctNetMain", "wrongNetwork", "loginTestnet", "guestHint", "guestReady", "guestTestnetOnly", "cfDura3"] as const) {
        const v = conModo(l)[k] as string;
        expect(v, `${l}.${k}`).not.toMatch(/testnet|mainnet/i);
        expect(v, `${l}.${k}`).not.toMatch(/para siempre|no se borra|never deleted|forever/i);
      }
    }
  });

  it("con modo Oficial, Cómo funciona y Seguridad hablan de los dos modos y conservan la fecha en que se borra la red de prueba", () => {
    const conModo = (l: "es" | "en"): Record<string, unknown> => ({ ...T[l], ...TEXTOS_MODO_OFICIAL[l] });
    expect(conModo("es").cfDura3 as string).toContain("16 de diciembre de 2026");
    expect(conModo("en").cfDura3 as string).toContain("December 16, 2026");
    expect(conModo("es").cfDura3 as string).toContain("modo Oficial");
    expect(conModo("en").cfDura3 as string).toContain("Live mode");
    expect(conModo("es").sgLimit3 as string).toContain("modo Prueba");
    expect(conModo("en").sgLimit3 as string).toContain("Test mode");
    expect(conModo("es").sgLimit3 as string).not.toContain("hoy el contrato está en testnet");
    expect(conModo("en").sgLimit3 as string).not.toContain("today the contract is on testnet");
  });

  // El día que la lista oficial tenga contrato en la red real, esta deja de correr y corre la de abajo: el diccionario lleva los del modo Oficial.
  it.runIf(!HAY_MODO_OFICIAL)("sin contrato en la red real, el diccionario dice lo que decía antes del modo Oficial", () => {
    // deployments.json trae mainnet en null: nada de "En el modo Prueba", que le haría pensar a quien lee que hay otro modo.
    expect(T.es.netTest).toBe("Modo prueba");
    expect(T.en.netTest).toBe("Test mode");
    expect(T.es.fotoPrueba).toBe("modo prueba");
    expect(T.es.acctNetMain).toBe("Red principal");
    for (const l of ["es", "en"] as const) {
      for (const k of ["nextBody", "verifN3", "tmMore3"]) expect(T[l][k] as string, `${l}.${k}`).not.toMatch(/En el modo Prueba|In Test mode/);
    }
    expect(T.es.nextBody as string).toContain("Hoy el costo de la red lo paga Tinkazo y el sitio funciona en modo prueba");
    expect(T.es.verifN3 as string).toContain("Hoy Tinkazo funciona en modo prueba");
    expect(T.es.tmMore3 as string).toContain("Hoy funciona en modo prueba");
    expect(T.en.verifN3 as string).toContain("runs in test mode today");
  });

  it("los textos del modo Oficial pisan claves que ya existen y están en los dos idiomas", () => {
    expect(Object.keys(TEXTOS_MODO_OFICIAL.es).sort()).toEqual(Object.keys(TEXTOS_MODO_OFICIAL.en).sort());
    for (const l of ["es", "en"] as const) {
      for (const k of Object.keys(TEXTOS_MODO_OFICIAL[l])) {
        expect(typeof T[l][k], `${l}.${k} ya existe`).toBe("string");
        // Con contrato en la red real, el diccionario ya los lleva puestos: se mira abajo.
        if (!HAY_MODO_OFICIAL) expect(TEXTOS_MODO_OFICIAL[l][k], `${l}.${k} cambia`).not.toBe(T[l][k]);
      }
    }
  });

  it.runIf(HAY_MODO_OFICIAL)("con contrato en la red real, el diccionario lleva los textos del modo Oficial", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of Object.keys(TEXTOS_MODO_OFICIAL[l])) {
        // Esta frase depende del modo activo, no solo de que Oficial exista. Tiene su prueba propia abajo.
        if (k === "cuentaPideGoogle") continue;
        expect(T[l][k], `${l}.${k}`).toBe(TEXTOS_MODO_OFICIAL[l][k]);
      }
    }
  });

  describe("con contrato en la red real", () => {
    afterEach(() => {
      vi.doUnmock("./stellar/deployments.json");
      vi.resetModules();
    });

    it("el diccionario lleva los nombres Prueba y Oficial, y las páginas de lectura hablan del modo Prueba", async () => {
      const real = (await import("./stellar/deployments.json")).default;
      vi.resetModules();
      vi.doMock("./stellar/deployments.json", () => ({
        default: { ...real, mainnet: { contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", rpcUrl: "https://rpc.example" } },
      }));
      const { T: conOficial } = await import("./i18n");
      expect(conOficial.es.netTest).toBe("Prueba");
      expect(conOficial.es.netMain).toBe("Oficial");
      expect(conOficial.en.netTest).toBe("Test");
      expect(conOficial.en.netMain).toBe("Live");
      expect(conOficial.es.nextBody as string).toContain("En el modo Prueba, guardá");
      expect(conOficial.en.tmMore3 as string).toContain("In Test mode, keep");
      expect(conOficial.es.loginTestnet).toBe("Prueba");
      expect(conOficial.es.cfDura3 as string).toContain("modo Oficial");
    });
  });

  describe("la puerta de Google en cada modo", () => {
    afterEach(() => {
      vi.doUnmock("./stellar/deployments.json");
      vi.resetModules();
      vi.unstubAllGlobals();
    });

    it("en Oficial pide dejar la cuenta lista y en Prueba conserva el texto de siempre, con el mismo contrato disponible", async () => {
      expect(TEXTOS_MODO_OFICIAL.es.cuentaPideGoogle).toBe("Para sortear con tu lista, entrá con Google y dejá tu cuenta lista.");
      expect(TEXTOS_MODO_OFICIAL.en.cuentaPideGoogle).toBe("To draw with your list, sign in with Google and get your account ready.");

      const real = (await import("./stellar/deployments.json")).default;
      const lista = {
        ...real,
        mainnet: { contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", rpcUrl: "https://rpc.example" },
      };
      vi.resetModules();
      vi.doMock("./stellar/deployments.json", () => ({ default: lista }));
      vi.stubGlobal("location", { search: "", hash: "" });
      const { T: enPrueba } = await import("./i18n");
      expect(enPrueba.es.cuentaPideGoogle).toBe("Para sortear con tu lista, entrá con Google: es gratis y tu cuenta se crea sola.");
      expect(enPrueba.en.cuentaPideGoogle).toBe("To draw with your list, sign in with Google: it's free and your account is created for you.");

      vi.resetModules();
      vi.stubGlobal("location", { search: "?red=oficial", hash: "#sortear" });
      const { T: enOficial } = await import("./i18n");
      expect(enOficial.es.cuentaPideGoogle).toBe(TEXTOS_MODO_OFICIAL.es.cuentaPideGoogle);
      expect(enOficial.en.cuentaPideGoogle).toBe(TEXTOS_MODO_OFICIAL.en.cuentaPideGoogle);
    });
  });

  it("en inglés ningún número se une con \"a\" (\"4 a 30\"): es la palabra del español, y en inglés se lee \"4 to 30\"", () => {
    const sueltas = Object.entries(T.en)
      .flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as const] : Array.isArray(v) ? v.map((x) => [k, x] as const) : []))
      .filter(([, v]) => /\d\s+a\s+\d/.test(v))
      .map(([k]) => k);
    expect(sueltas).toEqual([]);
  });

  it("la línea de \"gratis\" junto a \"Sellar la lista\" dice que no es para entrada paga ni para apuestas, y enlaza los términos (docs/legal.md, medida 5)", () => {
    expect(T.es.freeRule).toMatch(/gratis/i);
    expect(T.es.freeRule).toMatch(/entrada paga/i);
    expect(T.es.freeRule).toMatch(/apuestas/i);
    expect(T.es.freeRule).toContain("/terminos.html");
    expect(T.en.freeRule).toMatch(/free/i);
    expect(T.en.freeRule).toMatch(/paid entry/i);
    expect(T.en.freeRule).toMatch(/gambling/i);
    expect(T.en.freeRule).toContain("/terminos.html");
  });

  it("el rótulo del pliegue nombra el premio y el CSV, no la cantidad que quedó afuera", () => {
    expect(T.es.masOpciones).toMatch(/premio/i);
    expect(T.es.masOpciones).not.toMatch(/ganan/i);
    expect(T.es.masOpciones).toMatch(/CSV/);
    expect(T.en.masOpciones).toMatch(/prize/i);
    expect(T.en.masOpciones).not.toMatch(/win/i);
    expect(T.en.masOpciones).toMatch(/CSV/);
  });

  it("Sapo: what gets thrown is a ring, never a chip or a token", () => {
    for (const l of ["es", "en"] as const) {
      const textos = Object.entries(T[l])
        .filter(([k]) => k.startsWith("cSap"))
        .flatMap(([, v]) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []));
      expect(textos.filter((x) => /ficha|token|chip/i.test(x))).toEqual([]);
    }
  });

  it("la caja de fondos en el modo oficial informa falta de saldo, no un intento fallido", () => {
    // El título no puede sonar a fallo: todavía no se intentó nada, la cuenta no tiene saldo para la comisión.
    expect(T.es.fundTitleMain).toMatch(/saldo/i);
    expect(T.es.fundTitleMain).not.toMatch(/no se pudo|falló|fallo/i);
    expect(T.en.fundTitleMain).toMatch(/balance/i);
    expect(T.en.fundTitleMain).not.toMatch(/couldn't|failed|failure/i);
    // Coherente con el cuerpo de la caja: habla de la comisión de la red.
    expect(T.es.fundTitleMain).toMatch(/comisión/i);
    expect(T.en.fundTitleMain).toMatch(/fee/i);
  });

  it("en los textos fijos, las comillas dobles quedan solo en el aviso de marca de Stellar, que es el texto legal aprobado", () => {
    // Un botón, una opción de otra aplicación o una palabra citada se nombran sin comillas (docs/marca.md). Fuera de
    // las etiquetas de HTML, que llevan las suyas en los atributos. Los textos que llevan adentro algo que pegó la
    // persona son funciones y no entran acá: el único con comillas es pegSueltas, que tiene su prueba abajo.
    const conComillas: string[] = [];
    for (const l of ["es", "en"] as const) {
      for (const [k, v] of Object.entries(T[l])) {
        const textos = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
        if (textos.some((x) => /["“”„]/.test(x.replace(/<[^>]+>/g, "")))) conComillas.push(`${l}.${k}`);
      }
    }
    expect(conComillas).toEqual(["en.tmStellarMarca"]);
  });

  it("en texto plano, un botón cuyo nombre es una frase se presenta como botón", () => {
    // Con Mostrar en grande seguido de una coma, el botón parecía el primero de una lista de cuatro.
    expect(T.es.sorEvU1B).toMatch(new RegExp(`^Tocá ${T.es.pantallaBtn} y el premio`));
    expect(T.en.sorEvU1B).toMatch(new RegExp(`^Tap ${T.en.pantallaBtn} and the prize`));
  });

  it("los avisos de una lista numerada se leen bien aunque lo pegado traiga números o dos puntos", () => {
    for (const l of ["es", "en"] as const) {
      const L = T[l];
      // La línea con su número adentro de la frase cortaba la oración en el punto del 1.
      const varias = L.pegNumeracion(6, "1. Ana Quispe", "Ana Quispe");
      expect(varias, l).toContain("Ana Quispe");
      expect(varias, l).not.toContain("1. Ana");
      expect(L.pegNumeracion(1, "1. Ana Quispe", "Ana Quispe"), l).not.toMatch(/Por ejemplo|For example/);
      // Lo que no tenía número suele ser el título del grupo, con sus dos puntos. Es lo único del diccionario que va
      // entre comillas dobles: así se ve dónde empieza y dónde termina lo que pegó la persona.
      expect(L.pegSueltas(1, "Lista del viernes:"), l).toContain("“Lista del viernes:”");
      expect(L.pegSueltas(3, "Lista del viernes:"), l).toContain("“Lista del viernes:”");
      expect(L.pegSueltas(3, "Lista del viernes:"), l).toMatch(/^3 /);
    }
  });

  it("términos y verificación: cada referencia apunta a lo que corresponde, igual en las dos lenguas", () => {
    // Sin la clave que va después del #, ni Tinkazo puede abrir la copia: es el resto del enlace, no lo de antes.
    expect(T.es.tmCortoB).toContain("Alcanza con lo que va antes del #, y sin el resto ni nosotros podemos abrirla.");
    expect(T.en.tmCortoB).toContain("The part before the # is enough, and without the rest not even we can open it.");
    // {id} es el número de este sorteo, no el de un contrato.
    expect(T.es.vTechContratoRetirado).toContain("y este sorteo es el {id}.");
    expect(T.en.vTechContratoRetirado).toContain("and this draw is {id}.");
  });

  it("términos en inglés: lo que guarda este navegador y lo que lleva el comprobante, como dice el español", () => {
    // Todo lo de esa lista vive en el almacenamiento del navegador, no en el equipo entero.
    expect(T.es.tmQ4B).toContain("En este navegador quedan tus preferencias");
    expect(T.en.tmQ4B).toContain("This browser keeps your preferences");
    // El comprobante es el receipt en el resto del inglés. La prueba es la que publica la ronda, otra cosa.
    expect(T.es.tmQ3C).toMatch(/^El comprobante lleva los nombres/);
    expect(T.en.tmQ3C).toMatch(/^The receipt carries the names/);
  });

  it("términos: la comisión la paga Tinkazo de su saldo, sin un fondo que se pueda leer como de otro", () => {
    expect(T.es.tmMore1).toContain("Para cuidar el saldo con que Tinkazo la paga, ese servicio anota");
    expect(T.en.tmMore1).toContain("To protect the balance Tinkazo pays it from, that service records");
    // También el diccionario de siempre, que el del modo Oficial tapa: si vuelve a quedar a la vista, dice lo mismo.
    const fuente = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
    for (const nuevo of ["para cuidar el saldo con que Tinkazo la paga, cuenta", "to protect the balance Tinkazo pays it from, it counts"]) {
      expect(fuente.includes(nuevo), nuevo).toBe(true);
    }
    for (const viejo of ["el fondo que la paga", "the fund that pays it", "This device keeps", "The proof carries"]) {
      expect(fuente.includes(viejo), viejo).toBe(false);
    }
  });

});

describe("el modo espectador", () => {
  const CLAVES = [
    "espQrT", "espVistaEspectador", "espLectura", "espProbar", "espSinNumero", "espTarda", "espNoCoincide",
    "espQrPreparando", "espQrFallo", "espEnlaceRoto", "espIrALaPagina", "espFinSiguiente", "espVerDeNuevo", "espHacerElTuyo",
    "espMiraLaSala",
  ];

  it("sus textos existen en los dos idiomas", () => {
    for (const k of CLAVES) {
      expect(typeof T.es[k], `es.${k}`).toBe("string");
      expect(typeof T.en[k], `en.${k}`).toBe("string");
      expect(T.es[k] as string).toBeTruthy();
      expect(T.en[k] as string).toBeTruthy();
    }
  });

  it("sin comillas angulares, sin punto y coma y sin palabras técnicas", () => {
    for (const k of CLAVES) {
      for (const lang of ["es", "en"] as const) {
        const texto = T[lang][k] as string;
        expect(texto, `${lang}.${k}`).not.toMatch(/[«»;]/);
        expect(texto, `${lang}.${k}`).not.toMatch(/drand|beacon|hash|firma|signature|blockchain|Stellar|token|rifa|raffle|ticket|boleto|loter/i);
      }
    }
  });

  it("el QR del espectador va solo en la espera: la pantalla del resultado lleva uno solo, el del comprobante", () => {
    expect(T.es.espQrBoton).toBeUndefined();
    expect(T.en.espQrBoton).toBeUndefined();
  });
});

/**
 * La decisión sobre cómo se identifica quien se anota (issue 87): para verse en
 * la sala de nombres y para comprobar un sorteo no hace falta nada, y solamente
 * el registro de equipos de un evento con cupón pide una cuenta. Todo texto que
 * dice que quien participa no necesita nada nombra esa excepción, en los dos
 * idiomas, y el HTML de la portada dice lo mismo que el diccionario.
 */
describe("la excepción del registro de equipos con cupón, donde se dice que no hace falta cuenta", () => {
  const indexHtml = readFileSync("index.html", "utf8");

  it("el paso 1 de la portada y la nota del sellado nombran la excepción, en los dos idiomas", () => {
    for (const k of ["s1b", "como2N"] as const) {
      expect(T.es[k], `es.${k}`).toMatch(/cupón/);
      expect(T.en[k], `en.${k}`).toMatch(/coupon/i);
    }
    expect(T.es.s1b, "es.s1b").toMatch(/comprobar/);
    expect(T.en.s1b, "en.s1b").toMatch(/check/i);
  });

  it("las bases del sorteo, antes de sellar, nombran la excepción en los dos idiomas", () => {
    const pre = { prize: "Termo", count: 18, winners: 1, verifyUrl: "https://tinkazo.app" };
    expect(T.es.rulesPre(pre), "es.rulesPre").toMatch(/cupones/);
    expect(T.en.rulesPre(pre), "en.rulesPre").toMatch(/coupons/i);
  });

  it("el HTML de la portada dice lo mismo que el diccionario en español", () => {
    for (const k of ["s1b", "como2N"] as const) {
      const enElHtml = indexHtml.match(new RegExp(`data-i="${k}">([^<]+)<`))?.[1];
      expect(enElHtml, k).toBe(T.es[k]);
    }
  });
});
