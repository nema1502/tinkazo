// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { campanasActivo, mostrarEnlacesDeCampana } from "./campana/bandera";
import { TEXTOS_SALA_CAMPANA } from "./campana/textos-sala";
import { T, t } from "./i18n";
import { pintarCancelarEnPortada } from "./ui/cancelar-en-portada";

/**
 * La portada de tres puertas (25 de noviembre de 2026): sortear con tu lista, tengo un stand y soy una empresa. Cada una
 * es una tarjeta con su imagen, un título, una línea y su acción. La acción principal de la portada sigue siendo el botón
 * de entrar de arriba, y la puerta de las empresas respeta el mecanismo de siempre: nace escondida y solo se muestra con
 * las campañas abiertas, sin dejar hueco cuando está cerrada.
 */
const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/styles.css", "utf8");

const cuerpo = (): string => html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const puertas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".hero .puertas > .puerta")];

beforeEach(() => {
  document.body.innerHTML = cuerpo();
});

describe("las tres puertas de la portada", () => {
  it("hay tres, dentro del hero, cada una con imagen, título, línea y una sola acción", () => {
    const lista = puertas();
    expect(lista).toHaveLength(3);
    for (const p of lista) {
      expect(p.querySelector(".puerta-media"), p.className).not.toBeNull();
      expect(p.querySelectorAll("h2.puerta-t"), p.className).toHaveLength(1);
      expect(p.querySelectorAll("p.puerta-b"), p.className).toHaveLength(1);
      expect(p.querySelectorAll(".puerta-a"), p.className).toHaveLength(1);
      // Ninguna es una acción principal: la de la portada es el botón de entrar.
      expect(p.querySelector(".primary"), p.className).toBeNull();
    }
  });

  it("las imágenes traen su ancho y su alto y se cargan diferidas, salvo la del hero", () => {
    for (const img of document.querySelectorAll<HTMLImageElement>(".puertas img")) {
      expect(img.getAttribute("width"), img.src).toMatch(/^\d+$/);
      expect(img.getAttribute("height"), img.src).toMatch(/^\d+$/);
      expect(img.getAttribute("loading"), img.src).toBe("lazy");
      expect(img.getAttribute("decoding"), img.src).toBe("async");
      expect(img.getAttribute("alt"), img.src).toBe("");
    }
    // Una captura por tema, como las de la grilla de juegos.
    expect(document.querySelectorAll(".puertas .pj-osc").length).toBe(document.querySelectorAll(".puertas .pj-cla").length);
    const primera = document.querySelector<HTMLImageElement>(".hero-shot img");
    expect(primera?.hasAttribute("loading")).toBe(false);
  });

  it("el botón de entrar sigue siendo la acción principal del hero y el único de color", () => {
    const hero = document.querySelector(".hero")!;
    expect(hero.querySelectorAll(".primary")).toHaveLength(1);
    const entrar = hero.querySelector<HTMLElement>(".hero-ctas [data-cta-entrar]");
    expect(entrar?.classList.contains("primary")).toBe(true);
    // Y lo que viene justo después es el renglón de Otras formas de entrar, como antes.
    expect(hero.querySelector(".hero-ctas")?.nextElementSibling?.matches("p.hero-otras")).toBe(true);
  });

  it("el stand y el ensayo conservan sus marcas dentro del hero, donde los buscan los guiones", () => {
    expect(document.querySelectorAll(".hero [data-entrar-stand]")).toHaveLength(1);
    expect(document.querySelectorAll(".hero [data-entrar-ensayo]")).toHaveLength(1);
    expect(document.querySelector(".puerta-stand [data-entrar-stand]")).not.toBeNull();
    expect(document.querySelector(".puerta-lista [data-entrar-ensayo]")).not.toBeNull();
  });
});

describe("la puerta de las empresas respeta las campañas abiertas", () => {
  const empresa = (): HTMLElement => document.querySelector<HTMLElement>(".puerta-empresa")!;

  it("la puerta nace a la vista y marcada: ya no la destapa ningún guion", () => {
    expect(empresa().hasAttribute("data-campana-enlace")).toBe(true);
    expect(empresa().hasAttribute("hidden")).toBe(false);
    expect(document.querySelectorAll("[data-campana-enlace][hidden]")).toHaveLength(0);
    // El guion de siempre queda para las páginas que no traen la bandera en html y no cambia lo que ya se ve.
    mostrarEnlacesDeCampana(document, true);
    expect(empresa().hidden).toBe(false);
  });

  it("la tercera puerta lleva a armar la campaña", () => {
    expect(empresa().querySelector<HTMLAnchorElement>("a.puerta-a")?.getAttribute("href")).toBe("/crear-campana.html");
  });

  it("sin hueco: con la bandera cerrada son dos columnas y con la abierta, tres desde 860 px", () => {
    expect(css).toMatch(/^ {2}\.puertas \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/m);
    expect(css).not.toMatch(/\.puertas:has\(> \.puerta\[hidden\]\)/);
    const abierto =
      css.match(/@media \(min-width: 860px\) \{\s*html\[data-campanas="1"\] \.puertas, html\[data-campanas="true"\] \.puertas \{([^}]*)\}/)?.[1] ?? "";
    expect(abierto).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  });
});

describe("la bandera de las campañas se decide antes del primer pintado", () => {
  // Lo que hace Vite con el HTML al construir: cambia %NOMBRE% por el valor de la variable, y si no existe lo deja como está.
  const construido = (valor: string | undefined): string => html.replace("%VITE_CAMPANAS%", valor ?? "%VITE_CAMPANAS%");
  const selectorCerrado = (): string => {
    const m = css.match(
      /^ {2}(html\[data-campanas\]:not\(\[data-campanas="1"\]\):not\(\[data-campanas="true"\]\) \[data-campana-enlace\]) \{ display: none; \}/m,
    );
    expect(m, "falta la regla que esconde lo de empresas con la bandera cerrada").not.toBeNull();
    return m![1] as string;
  };
  const marcados = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-campana-enlace]")];
  /** Arma la página como queda al construir con ese valor: el atributo de html y el cuerpo. */
  const armar = (valor: string | undefined): void => {
    const doc = new DOMParser().parseFromString(construido(valor), "text/html");
    document.documentElement.setAttribute("data-campanas", doc.documentElement.getAttribute("data-campanas") ?? "");
    document.body.innerHTML = doc.body.innerHTML;
  };

  it("index.html lleva la bandera en el elemento html, con la misma variable que lee bandera.ts", () => {
    expect(html).toMatch(/<html [^>]*data-campanas="%VITE_CAMPANAS%"/);
    expect(readFileSync("src/campana/bandera.ts", "utf8")).toContain("import.meta.env.VITE_CAMPANAS");
  });

  it("hay seis lugares marcados (cabecera dos, puerta, final de la portada, aviso de Sortear y pie) y ninguno nace con hidden", () => {
    armar("1");
    expect(marcados()).toHaveLength(6);
    expect(marcados().filter((e) => e.hasAttribute("hidden"))).toHaveLength(0);
    // Todo enlace a armar una campaña está dentro de un lugar marcado, o es el del aviso del premio (que se muestra solo).
    for (const a of document.querySelectorAll<HTMLElement>('a[href="/crear-campana.html"]')) {
      expect(a.closest("[data-campana-enlace], #prize-plata") ?? a.matches("[data-campana-enlace]"), a.outerHTML).toBeTruthy();
    }
  });

  it("con la bandera abierta (1 o true) la regla no esconde nada y se ven las tres puertas", () => {
    for (const v of ["1", "true"]) {
      expect(campanasActivo(v), v).toBe(true);
      armar(v);
      expect(document.querySelectorAll(selectorCerrado()), v).toHaveLength(0);
      expect(puertas(), v).toHaveLength(3);
    }
  });

  it("con la bandera cerrada, vacía o sin definir la regla esconde los seis y quedan dos puertas, sin hueco", () => {
    for (const v of ["", "0", "false", "si", undefined]) {
      expect(campanasActivo(v), String(v)).toBe(false);
      armar(v);
      const escondidos = [...document.querySelectorAll<HTMLElement>(selectorCerrado())];
      expect(escondidos, String(v)).toHaveLength(6);
      const quedan = puertas().filter((p) => !escondidos.includes(p));
      expect(quedan.map((p) => p.className), String(v)).toEqual(["puerta puerta-lista", "puerta puerta-stand"]);
    }
  });
});

describe("la tarjeta de campaña de ejemplo", () => {
  it("se hace con HTML y CSS, sin imagen, y dice que es un ejemplo con una marca inventada", () => {
    const tarjeta = document.querySelector(".puerta-empresa .cp-ejemplo")!;
    expect(tarjeta).not.toBeNull();
    expect(tarjeta.querySelector("img")).toBeNull();
    expect(tarjeta.querySelector(".cp-franja")).not.toBeNull();
    expect(tarjeta.querySelector(".cp-logo")).not.toBeNull();
    expect(tarjeta.querySelector(".cp-premio strong")).not.toBeNull();
    expect(tarjeta.querySelector(".cp-gente")).not.toBeNull();
    expect(tarjeta.querySelector<HTMLElement>(".cp-rotulo")?.dataset.i).toBe("peRotulo");
    expect(T.es.peRotulo).toBe("Ejemplo");
    expect(T.en.peRotulo).toBe("Example");
    expect(T.es.peMarca).toBe("Tu marca");
  });

  it("el estado lleva ícono y texto, nunca solo color", () => {
    const estado = document.querySelector(".cp-estado")!;
    expect(estado.querySelector("svg")).not.toBeNull();
    expect(estado.querySelector("span")?.textContent?.trim()).toBe(T.es.peEstado);
  });
});

describe("los textos de las puertas, en los dos idiomas", () => {
  const CLAVES = [
    "ptListaT", "ptListaB", "ptStandT", "ptStandB", "ptEmpresaT", "ptEmpresaB", "ptEmpresaA",
    "peRotulo", "peMarca", "peLugar", "pePremioN", "pePremioM", "peEstado", "peGente",
    "s1c", "pasoMas", "s2b", "s3b", "navEmpresasC", "ctaEmpresa",
  ];

  it("cada una existe en español y en inglés", () => {
    for (const k of CLAVES) {
      expect(typeof T.es[k], `es.${k}`).toBe("string");
      expect(typeof T.en[k], `en.${k}`).toBe("string");
      expect(T.en[k], k).not.toBe(T.es[k]);
    }
  });

  it("el HTML dice lo mismo que el diccionario en español", () => {
    for (const k of CLAVES) {
      const enElHtml = html.match(new RegExp(`data-i="${k}">([^<]+)<`))?.[1];
      expect(enElHtml, k).toBe(T.es[k]);
    }
  });

  it("sin comillas angulares ni punto y coma, y sin las palabras que no van", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const v = T[l][k] as string;
        expect(v, `${l}.${k}`).not.toMatch(/[«»;—–]/);
        expect(v, `${l}.${k}`).not.toMatch(/rifa|loter|raffle|ticket|boleto|apuesta|suerte/i);
      }
    }
  });
});

describe("la tarjeta de ejemplo dice lo mismo en los dos idiomas", () => {
  it("el premio son dólares digitales también en inglés", () => {
    expect(T.es.pePremioN).toBe("3 premios de");
    expect(T.es.pePremioM).toBe("40 dólares digitales");
    expect(T.en.pePremioN).toBe("3 prizes of");
    expect(T.en.pePremioM).toBe("40 digital dollars");
  });

  it("el estado usa la palabra de la tarjeta real de una campaña abierta, en español y en inglés", () => {
    expect(TEXTOS_SALA_CAMPANA.es.cpoAbiertaHasta.startsWith(T.es.peEstado)).toBe(true);
    expect(TEXTOS_SALA_CAMPANA.en.cpoAbiertaHasta.startsWith(T.en.peEstado)).toBe(true);
  });
});

describe("cada puerta dice lo que hace su botón, en los dos idiomas", () => {
  it("el título dice para quién es y el botón cumple lo que el título promete", () => {
    expect(T.es.ptListaT).toBe("Mirá cómo es");
    expect(T.es.ptStandT).toBe("Para tu stand o tu feria");
    expect(T.es.ptEmpresaT).toBe("Para tu empresa");
    expect(T.en.ptListaT).toBe("See how it works");
    expect(T.en.ptStandT).toBe("For your booth or fair");
    expect(T.en.ptEmpresaT).toBe("For your company");
    // El ejemplo no usa tu lista: la línea no promete pegar nombres.
    expect(T.es.ptListaB).not.toMatch(/pegá|tu lista/i);
    expect(T.en.ptListaB).not.toMatch(/paste|your list/i);
    // En el stand la gente se anota y mira la ronda: no juega.
    expect(T.es.ptStandB).toMatch(/mira la ronda/);
    expect(T.en.ptStandB).toMatch(/watch the round/);
  });

  it("la tarjeta de ejemplo no cuenta personas: dice que participar es gratis", () => {
    expect(T.es.peGente).toBe("Participar es gratis");
    expect(T.en.peGente).toBe("Joining is free");
    expect(T.en.pePremioM).not.toMatch(/digital dollars/i);
  });
});

describe("los pasos 01 a 03 de la portada", () => {
  it("el paso 2 y el paso 3 dicen por qué es justo, sin hablar de un número que no se explica", () => {
    expect(T.es.s2b).toBe("Queda cerrada antes del sorteo: nadie la puede cambiar sin que se note.");
    expect(T.es.s3b).toBe("Gana quien sale de un número que nadie elige.");
    expect(T.en.s2b).toBe("It is locked before the draw: nobody can change it without it showing.");
    expect(T.en.s3b).toMatch(/nobody picks/);
  });

  it("cada uno trae un dibujo o una captura, un título y una línea", () => {
    const pasos = [...document.querySelectorAll<HTMLElement>(".steps > article")];
    expect(pasos).toHaveLength(3);
    for (const p of pasos) {
      const media = p.querySelector(".paso-media");
      expect(media, p.textContent ?? "").not.toBeNull();
      // Lo decorativo no se lee: el título y la línea ya dicen el paso.
      expect(media?.getAttribute("aria-hidden")).toBe("true");
      expect(media?.querySelector("svg, img"), p.textContent ?? "").not.toBeNull();
      expect(p.querySelectorAll("h3")).toHaveLength(1);
    }
  });

  it("los tres son dibujos del mismo estilo, sin capturas, y el sello usa la llama del símbolo de la página", () => {
    for (const p of document.querySelectorAll<HTMLElement>(".steps > article")) {
      expect(p.querySelector(".paso-media svg"), p.textContent ?? "").not.toBeNull();
      expect(p.querySelector("img"), p.textContent ?? "").toBeNull();
      expect(p.querySelector(".paso-media svg")?.getAttribute("viewBox")).toBe("0 0 64 64");
    }
    expect(document.querySelector(".paso-sello use")?.getAttribute("href")).toBe("#llama");
    expect(document.getElementById("llama")).not.toBeNull();
  });

  it("van sin caja ni sombra, con el dibujo de 64 px al lado del texto", () => {
    const regla = css.match(/\.steps article \{([^}]*)\}/)?.[1] ?? "";
    expect(regla).toMatch(/grid-template-columns: 64px/);
    expect(regla).not.toMatch(/box-shadow|border:|background/);
    expect(css).toMatch(/\.steps \.paso-media \{ width: 64px; height: 64px;/);
  });

  it("no usa los stickers de la colección", () => {
    expect(html.slice(html.indexOf('class="steps'), html.indexOf('id="juegos"'))).not.toContain("marca/coleccion");
  });

  it("la línea de cada paso es corta y el detalle del primero va plegado, con su texto en los dos idiomas", () => {
    for (const k of ["s1c", "s2b", "s3b"] as const) {
      // El paso 2 dice que se nota si alguien cambia la lista, que es lo que cuenta la página de seguridad: lleva unas palabras más.
      const tope = k === "s2b" ? 72 : 60;
      expect((T.es[k] as string).length, k).toBeLessThanOrEqual(tope);
      expect((T.en[k] as string).length, k).toBeLessThanOrEqual(tope);
    }
    const detalle = document.querySelector<HTMLDetailsElement>(".steps details.paso-mas");
    expect(detalle).not.toBeNull();
    expect(detalle?.open).toBe(false);
    expect(detalle?.querySelector('[data-i="s1b"]')).not.toBeNull();
    for (const k of ["s1c", "pasoMas"]) {
      expect(typeof T.es[k]).toBe("string");
      expect(typeof T.en[k]).toBe("string");
    }
  });
});

describe("la portada en el celular y en la laptop", () => {
  const bloque = (inicio: RegExp): string => {
    const i = css.search(inicio);
    expect(i, String(inicio)).toBeGreaterThan(-1);
    let nivel = 0;
    for (let j = css.indexOf("{", i); j < css.length; j++) {
      if (css[j] === "{") nivel++;
      if (css[j] === "}" && --nivel === 0) return css.slice(i, j + 1);
    }
    return "";
  };

  it("hasta 859 px, y en laptops bajas, cada puerta es un renglón con miniatura de 64 px y título, sin la línea", () => {
    const b = bloque(/@media \(max-width: 859px\), \(min-width: 860px\) and \(max-height: 820px\) \{\s*\.puerta \{ display: grid;/);
    expect(b).toMatch(/\.puerta \{ display: grid; grid-template-columns: 64px/);
    expect(b).toMatch(/\.puerta-b \{ display: none; \}/);
    expect(b).toMatch(/\.puerta-empresa \.cp-ejemplo \{ display: none; \}/);
    expect(b).toMatch(/\.puerta-ico \{ display: grid;/);
  });

  it("la puerta de las empresas trae su ícono decorativo, que solo el renglón muestra", () => {
    const ico = document.querySelector(".puerta-empresa .puerta-ico");
    expect(ico?.getAttribute("aria-hidden")).toBe("true");
    expect(ico?.querySelector("svg")).not.toBeNull();
    expect(css).toMatch(/\.puerta-ico \{ display: none; \}/);
  });

  it("el orden del HTML es el que se ve en el celular: botón, renglón de otras formas de entrar y después las puertas", () => {
    const copia = document.querySelector(".hero-portada .hero-copy")!;
    const hijos = [...copia.children].map((e) => e.className || e.tagName.toLowerCase());
    expect(hijos.slice(0, 4)).toEqual(["h1", "lead", "hero-ctas", "hero-otras"]);
    const ctas = document.querySelector(".hero-portada .hero-ctas")!;
    const puertas = document.querySelector(".hero-portada .puertas")!;
    expect(ctas.nextElementSibling?.matches("p.hero-otras")).toBe(true);
    // Las puertas vienen después de todo el texto del hero, nunca entre el botón y su renglón.
    expect(copia.compareDocumentPosition(puertas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mientras se termina de entrar, el renglón que lleva Cancelar es el hermano siguiente del botón y viene antes de las puertas", () => {
    pintarCancelarEnPortada(document, { terminando: true, cancelar: () => undefined, tx: t });
    const cancelar = document.querySelector<HTMLElement>(".hero-portada button[data-cancelar-entrada]")!;
    expect(cancelar).not.toBeNull();
    const ctas = document.querySelector(".hero-portada .hero-ctas")!;
    const puertas = document.querySelector(".hero-portada .puertas")!;
    const renglon = cancelar.closest("p")!;
    expect(ctas.nextElementSibling).toBe(renglon);
    expect(ctas.compareDocumentPosition(cancelar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancelar.compareDocumentPosition(puertas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Ni la nota ni la firma de la red se interponen entre el botón y su renglón.
    expect(document.querySelector(".hero-portada .hero-note")!.compareDocumentPosition(renglon) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("el CSS del celular no reordena el texto del hero ni las puertas: ni order, ni display: contents, ni una regla para Cancelar", () => {
    expect(css).not.toMatch(/\.hero-portada \.hero-copy \{ display: contents; \}/);
    expect(css).not.toMatch(/\.hero-portada \.(puertas|hero-otras|hero-note|built-on)[^{]*\{[^}]*order:/);
    expect(css).not.toContain("[data-cancelar-entrada]");
  });

  it("en un celular bajo el espacio entre título, línea y botón baja a 12 px como en la rama principal, y la grilla también", () => {
    const baja = bloque(/@media \(max-width: 700px\) and \(max-height: 740px\) \{/);
    expect(baja).toMatch(/\.hero-portada \.hero-copy \{ gap: 12px; \}/);
    expect(baja).toMatch(/\.hero-portada \{ gap: 12px; \}/);
  });

  it("la imagen del hero va arriba del título solo en celulares angostos y altos, y después de las puertas en los demás", () => {
    const base = bloque(/@media \(max-width: 700px\) \{\s*\.hero-portada \{ grid-template-columns: 1fr;/);
    expect(base).toMatch(/\.hero-portada \.hero-shot \{[^}]*order: 2/);
    // La imagen mide el ancho de la pantalla por 0,562: a más ancho baja más el botón principal. Con la cabecera en dos filas y el
    // título en dos renglones, el botón termina en unos 675 px a 520 de ancho, 755 a 650 y 790 a 700. Por eso el corte mira el
    // ancho y no solo el alto: hasta 520 px entra en una pantalla de 741 px, más ancho no.
    const alta = bloque(/@media \(max-width: 520px\) and \(min-height: 741px\) \{/);
    expect(alta).toMatch(/\.hero-portada \.hero-shot \{[^}]*order: -1/);
    expect(css).not.toMatch(/@media \(max-width: 700px\) and \(min-height: 741px\)/);
    // El título deja de ir a la altura de las pantallas bajas (740 px o menos): la imagen no baja el botón principal.
    const baja = bloque(/@media \(max-width: 700px\) and \(max-height: 740px\) \{/);
    expect(baja).not.toMatch(/hero-shot/);
  });

  it("el enlace de la imagen del hero repite la puerta de Mirá cómo es y no es una parada del teclado ni del lector de pantalla", () => {
    // Cambia de lugar según el ancho y el alto, así que su orden en pantalla no puede ser el del HTML: la puerta hace lo mismo
    // y va en su sitio. La imagen sigue siendo un enlace para el mouse y el dedo.
    const imagen = document.querySelector(".hero-shot");
    expect(imagen?.getAttribute("tabindex")).toBe("-1");
    expect(imagen?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".puerta-lista [data-entrar-ensayo]")).not.toBeNull();
  });

  it("los renglones de las puertas ocupan el ancho del contenido, a la izquierda, junto al título y el botón", () => {
    const b = bloque(/@media \(max-width: 859px\) \{\s*\.puertas/);
    expect(b).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
    expect(b).not.toMatch(/max-width: 520px|margin-inline: auto/);
    expect(css).not.toMatch(/@media \(min-width: 701px\) and \(max-width: 859px\) \{\s*\.puertas/);
  });

  it("en el tema oscuro, la llama y el candado del paso 02 llevan el color oscuro fijo sobre el amarillo", () => {
    const sello = document.querySelector(".paso-sello svg")!;
    const llama = sello.querySelector("g")!;
    expect(llama.getAttribute("fill")).toBe("#191919");
    const arco = [...sello.querySelectorAll("path")].find((p) => p.getAttribute("d")?.startsWith("M42 38v-4"))!;
    expect(arco.getAttribute("stroke")).toBe("#191919");
  });

  it("la tarjeta entera responde: el área del botón se estira a toda la puerta", () => {
    expect(css).toMatch(/\.puerta \{[^}]*position: relative/);
    expect(css).toMatch(/\.puerta \.puerta-a::after \{ content: ""; position: absolute; inset: 0; \}/);
  });

  it("en escritorio el botón de la puerta no se mueve al pasar el mouse: la tarjeta entera es su área", () => {
    // Un botón con transform se vuelve el bloque contenedor de su ::after y el área clicable se achica al botón: parpadeo.
    // La regla va al nivel de arriba (dos espacios de sangría, fuera de cualquier @media) y gana en especificidad a button.ghost:hover.
    const m = css.match(/^ {2}\.puerta \.puerta-a:hover:not\(:disabled\), \.puerta a\.puerta-a:hover \{([^}]*)\}/m);
    expect(m, "falta la regla que quita el transform del botón de la puerta").not.toBeNull();
    expect(m![1]).toMatch(/transform: none/);
  });

  it("lado a lado la imagen es baja y los botones entran en la primera pantalla", () => {
    expect(css).toMatch(/\.puerta-media \{[^}]*aspect-ratio: 21 \/ 9/);
  });

  it("la puerta de la lista no usa la ruleta y todas las imágenes vienen en par claro y oscuro", () => {
    const lista = document.querySelector(".puerta-lista")!;
    expect(lista.innerHTML).not.toContain("wheel");
    for (const img of lista.querySelectorAll<HTMLImageElement>("img")) expect(img.getAttribute("src")).toMatch(/portada\/pinata(-light)?\.webp/);
  });

  it("el texto de la tarjeta de ejemplo no baja de 16 px", () => {
    for (const sel of [".cp-nombres span", ".cp-rotulo", ".cp-premio span", ".cp-estado", ".cp-gente"]) {
      const regla = css.match(new RegExp(`${sel.replace(/\./g, "\\.")} \\{[^}]*font-size: (\\d+)px`))?.[1];
      expect(Number(regla), sel).toBeGreaterThanOrEqual(16);
    }
    expect(css).toMatch(/@media \(max-width: 359px\) \{ \.cp-nombres span \{ display: none; \} \}/);
  });

  it("la imagen del hero sigue el tema elegido con el mismo par claro y oscuro de las puertas", () => {
    const hero = document.querySelector(".hero-shot")!;
    const alts = [...hero.querySelectorAll<HTMLImageElement>("img.hero-alt")];
    expect(alts.map((i) => i.getAttribute("src"))).toEqual(["/juegos/race.webp", "/juegos/race-light.webp"]);
    for (const i of alts) {
      expect(i.getAttribute("loading")).toBe("lazy");
      expect(i.getAttribute("width")).toBe("900");
      expect(i.getAttribute("height")).toBe("506");
    }
    // La primera imagen no se difiere y sigue siendo la que se pide en la primera pantalla.
    expect(hero.querySelector("picture img")?.hasAttribute("loading")).toBe(false);
    expect(css).toMatch(/:root\[data-theme="dark"\] \.hero-shot picture \{ display: none; \}/);
    expect(css).toMatch(/:root\[data-theme="light"\] \.hero-shot picture \{ display: none; \}/);
  });

  it("el enlace de la campaña en Sortear se lee morado como los demás enlaces del panel", () => {
    expect(css).toMatch(/\.premio-campana a \{[^}]*color: var\(--purple-ink\)/);
  });
});
