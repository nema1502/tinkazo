import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lo que dicen en público la guía de contribución, la política de seguridad, la plantilla
 * de pedido y los formularios de issue tiene que ser cierto. Estas pruebas leen los archivos
 * como texto y cuidan hechos: que lo nombrado exista, que lo prometido se pueda cumplir y que
 * dos textos no se contradigan. No fijan frases.
 */
const raiz = (ruta: string): URL => new URL(`../${ruta}`, import.meta.url);
const existe = (ruta: string): boolean => existsSync(raiz(ruta));
const leer = (ruta: string): string => readFileSync(raiz(ruta), "utf8").split(String.fromCharCode(13)).join("");

const contribuir = leer("CONTRIBUTING.md");
const seguridad = leer("SECURITY.md");
const plantilla = leer(".github/pull_request_template.md");
const config = leer(".github/ISSUE_TEMPLATE/config.yml");
const ci = leer(".github/workflows/ci.yml");
const paquete = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };

const URL_REPARTO = "https://github.com/nema1502/tinkazo/issues/277";
const REPO = "https://github.com/nema1502/tinkazo";
const SITIO = "https://tinkazo.app/";

/** Los enlaces relativos de un Markdown, sin el ancla. */
const enlacesRelativos = (texto: string): string[] =>
  [...texto.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)].map((m) => m[1]!.split("#")[0]!);

/** El texto entre un encabezado de segundo nivel y el siguiente. */
const seccion = (texto: string, titulo: string): string => {
  const desde = texto.indexOf(`## ${titulo}`);
  expect(desde).toBeGreaterThanOrEqual(0);
  const resto = texto.slice(desde + titulo.length + 3);
  const hasta = resto.search(/\n## /);
  return hasta === -1 ? resto : resto.slice(0, hasta);
};

const archivosDeFormularios = (): string[] => readdirSync(raiz(".github/ISSUE_TEMPLATE")).filter((n) => n.endsWith(".yml"));

describe("CONTRIBUTING.md", () => {
  it("el ejemplo de commit cumple el límite de 72 caracteres que pide", () => {
    const ejemplo = /Por ejemplo: `([^`]+)`/.exec(contribuir);
    expect(ejemplo).not.toBeNull();
    expect([...ejemplo![1]!].length).toBeLessThanOrEqual(72);
  });

  it("cada comando de pnpm que nombra existe en package.json", () => {
    const nombrados = [...contribuir.matchAll(/pnpm ([a-z][\w:-]*)/g)].map((m) => m[1]!);
    const propios = new Set(["install"]);
    const faltan = nombrados.filter((n) => !propios.has(n) && !(n in paquete.scripts));
    expect(nombrados.length).toBeGreaterThan(0);
    expect(faltan).toEqual([]);
  });

  it("cada guion de scripts/ que nombra existe", () => {
    const nombrados = [...contribuir.matchAll(/node (scripts\/[\w.-]+)/g)].map((m) => m[1]!);
    expect(nombrados.filter((r) => !existe(r))).toEqual([]);
  });

  it("los enlaces relativos apuntan a archivos que existen", () => {
    const enlaces = enlacesRelativos(contribuir);
    expect(enlaces.length).toBeGreaterThan(0);
    expect(enlaces.filter((r) => !existe(r))).toEqual([]);
  });

  it("enlaza el reparto del trabajo con su dirección completa", () => {
    expect(contribuir).toContain(URL_REPARTO);
  });

  it("las comprobaciones que exige para unir existen en la integración continua", () => {
    const exigidas = [...seccion(contribuir, "La revisión automática").matchAll(/^- La comprobación `([^`]+)`/gm)].map((m) => m[1]!);
    expect(exigidas.length).toBeGreaterThan(0);
    expect(exigidas.filter((nombre) => !ci.includes(`name: ${nombre}`))).toEqual([]);
  });

  it("la plantilla de pedido nombra comandos y guiones que existen", () => {
    const comandos = [...plantilla.matchAll(/pnpm ([a-z][\w:-]*)/g)].map((m) => m[1]!);
    expect(comandos.filter((n) => n !== "install" && !(n in paquete.scripts))).toEqual([]);
    const guiones = [...plantilla.matchAll(/node (scripts\/[\w.-]+)/g)].map((m) => m[1]!);
    expect(guiones.filter((r) => !existe(r))).toEqual([]);
  });

  it("los textos públicos solo ofrecen el correo permitido", () => {
    const textos = [contribuir, seguridad, plantilla];
    const correos = new Set(textos.flatMap((t) => [...t.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0])));
    expect([...correos].filter((c) => c !== "hola@tinkazo.app")).toEqual([]);
  });
});

describe("SECURITY.md", () => {
  const alcance = seccion(seguridad, "Qué está en alcance");
  const resumenIngles = seguridad.split("\n")[0]!;

  it("los enlaces relativos apuntan a archivos que existen", () => {
    const enlaces = enlacesRelativos(seguridad);
    expect(enlaces.length).toBeGreaterThan(0);
    expect(enlaces.filter((r) => !existe(r))).toEqual([]);
  });

  it("no trae cifras de plazo ni montos", () => {
    expect(seguridad).not.toMatch(/\b\d+\s*(días|dias|horas|semanas|days|hours|weeks)\b/i);
    expect(seguridad).not.toMatch(/\b(recompensa|premio|bounty) de\b/i);
    expect(seguridad).not.toMatch(/[$€]\s*\d|\d\s*(USD|USDC|XLM|dólares|bolivianos)\b/i);
  });

  it("cada carpeta y archivo que pone en alcance existe", () => {
    // Lo que la política nombra como alcance son rutas del repositorio: tienen que existir.
    const rutas = [...alcance.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)].map((m) => m[1]!.split("#")[0]!);
    expect(rutas.length).toBeGreaterThan(0);
    expect(rutas.filter((r) => !existe(r))).toEqual([]);
  });

  it("el resumen en inglés enlaza un documento que existe", () => {
    const enlaces = enlacesRelativos(resumenIngles);
    expect(enlaces.length).toBeGreaterThan(0);
    expect(enlaces.filter((r) => !existe(r))).toEqual([]);
  });
});

/** Un campo de un formulario de issue, con lo que la prueba necesita mirar. */
type Campo = { type: string; id?: string; label?: string; value?: string; opciones: string[] };
type Formulario = { archivo: string; error?: string; claves: Record<string, string>; labels: string[]; campos: Campo[] };

const TIPOS = new Set(["markdown", "input", "textarea", "dropdown", "checkboxes"]);

const sinComillas = (valor: string): string => {
  const t = valor.trim();
  const entre = t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")));
  return entre ? t.slice(1, -1) : t;
};

/** Una lista de una línea, con o sin comillas: `[bug, enhancement]` o `["bug", "enhancement"]`. */
const listaDeUnaLinea = (valor: string): string[] =>
  valor
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map(sinComillas)
    .filter((x) => x !== "");

/**
 * Lee el subconjunto de YAML que usan los formularios: claves de primer nivel, `labels` en una
 * línea y los campos de `body`, cada uno con `type`, `id`, `label`, `value` (el texto fijo de un
 * markdown) y `options`. No hay un lector de YAML entre las dependencias y no se suma uno por
 * esto. Lo que no sabe leer lanza un error: quien llama lo convierte en la falla de ese archivo.
 */
const leerFormularioDeTexto = (archivo: string, texto: string): Formulario => {
  const claves: Record<string, string> = {};
  const campos: Campo[] = [];
  let labels: string[] = [];
  let enBody = false;
  let enOpciones = false;
  const lineas = texto.split("\n");
  const sangria = (l: string): number => l.length - l.trimStart().length;
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!;
    const clave = /^([a-z_]+):\s*(.*)$/.exec(linea);
    if (clave) {
      enBody = clave[1] === "body";
      enOpciones = false;
      claves[clave[1]!] = clave[2]!;
      if (clave[1] === "labels") {
        const valor = clave[2]!.trim();
        if (valor === "" || (valor.startsWith("[") && !valor.endsWith("]"))) {
          throw new Error(`labels no está en una línea: ${valor || "vacío"}`);
        }
        labels = listaDeUnaLinea(valor);
      }
      continue;
    }
    if (!enBody) continue;
    const campo = /^ {2}- type:\s*(\S+)\s*$/.exec(linea);
    if (campo) {
      campos.push({ type: campo[1]!, opciones: [] });
      enOpciones = false;
      continue;
    }
    const actual = campos[campos.length - 1];
    if (!actual) continue;
    const id = /^ {4}id:\s*(\S+)\s*$/.exec(linea);
    if (id) {
      actual.id = id[1]!;
      continue;
    }
    const etiqueta = /^ {6}label:\s*(.*)$/.exec(linea);
    if (etiqueta) {
      actual.label = sinComillas(etiqueta[1]!);
      enOpciones = false;
      continue;
    }
    const valor = /^ {6}value:\s*(.*)$/.exec(linea);
    if (valor) {
      enOpciones = false;
      if (/^[|>][+-]?$/.test(valor[1]!.trim())) {
        const partes: string[] = [];
        while (i + 1 < lineas.length && (lineas[i + 1]!.trim() === "" || sangria(lineas[i + 1]!) > 6)) {
          partes.push(lineas[++i]!.trim());
        }
        actual.value = partes.join(" ").trim();
      } else {
        actual.value = sinComillas(valor[1]!);
      }
      continue;
    }
    if (/^ {6}options:\s*$/.test(linea)) {
      enOpciones = true;
      continue;
    }
    if (enOpciones) {
      const opcion = /^ {8}- (.*)$/.exec(linea);
      if (opcion) {
        const conEtiqueta = /^label:\s*(.*)$/.exec(opcion[1]!);
        actual.opciones.push(sinComillas(conEtiqueta ? conEtiqueta[1]! : opcion[1]!));
      } else if (linea.trim() !== "" && sangria(linea) <= 6) {
        enOpciones = false;
      }
    }
  }
  return { archivo, claves, labels, campos };
};

/** Lo lee o, si no puede, devuelve el motivo para que falle solo el caso de ese archivo. */
const leerSeguro = (archivo: string, texto: () => string): Formulario => {
  try {
    return leerFormularioDeTexto(archivo, texto());
  } catch (e) {
    return { archivo, error: (e as Error).message, claves: {}, labels: [], campos: [] };
  }
};

const leerFormulario = (archivo: string): Formulario => leerSeguro(archivo, () => leer(`.github/ISSUE_TEMPLATE/${archivo}`));

/** Todo lo que está mal en la estructura de un formulario. Vacío si está bien armado. */
const problemasDeEstructura = (f: Formulario): string[] => {
  const p: string[] = [];
  const en = (mensaje: string): number => p.push(`${f.archivo}: ${mensaje}`);
  if (f.error) {
    en(`no se pudo leer (${f.error})`);
    return p;
  }
  if (!f.claves["name"]) en("falta name");
  if (!f.claves["description"]) en("falta description");
  if (!("body" in f.claves) || f.campos.length === 0) en("falta body con campos");
  const ids: string[] = [];
  f.campos.forEach((c, n) => {
    const donde = `campo ${n + 1} (${c.type})`;
    if (!TIPOS.has(c.type)) en(`${donde} tiene un tipo inválido`);
    if (c.type === "markdown") {
      if (!c.value) en(`${donde} no tiene value`);
      return;
    }
    if (!c.id) en(`${donde} no tiene id`);
    else if (ids.includes(c.id)) en(`${donde} repite el id ${c.id}`);
    else ids.push(c.id);
    if (!c.label) en(`${donde} no tiene label`);
    if (c.type === "dropdown" || c.type === "checkboxes") {
      if (c.opciones.length === 0) en(`${donde} no tiene opciones`);
      if (c.opciones.some((o) => o === "")) en(`${donde} tiene una opción vacía`);
      if (new Set(c.opciones).size !== c.opciones.length) en(`${donde} repite una opción`);
    }
  });
  return p;
};

describe("lector de formularios", () => {
  const ejemplo = (labels: string): string =>
    [
      "name: Algo",
      "description: Un formulario",
      labels,
      "body:",
      "  - type: markdown",
      "    attributes:",
      "      value: |",
      "        Gracias por avisar.",
      "        Otra línea.",
      "  - type: dropdown",
      "    id: zona",
      "    attributes:",
      '      label: "Zona"',
      "      options:",
      "        - Frente",
      "        - 'Servicios'",
      "    validations:",
      "      required: true",
      "  - type: checkboxes",
      "    id: cuidado",
      "    attributes:",
      "      label: Antes de enviar",
      "      options:",
      "        - label: Sin secretos",
      "          required: true",
      "",
    ].join("\n");

  it.each([
    { forma: "sin comillas", linea: "labels: [bug, enhancement]" },
    { forma: "con comillas dobles", linea: 'labels: ["bug", "enhancement"]' },
    { forma: "con comillas simples", linea: "labels: ['bug', 'enhancement']" },
    { forma: "mezcladas", linea: "labels: [bug, \"enhancement\"]" },
  ])("lee las etiquetas de una línea $forma", ({ linea }) => {
    expect(leerFormularioDeTexto("x.yml", ejemplo(linea)).labels).toEqual(["bug", "enhancement"]);
  });

  it("lee el texto fijo, la etiqueta y las opciones de cada campo", () => {
    const f = leerFormularioDeTexto("x.yml", ejemplo("labels: [bug]"));
    expect(f.campos.map((c) => c.type)).toEqual(["markdown", "dropdown", "checkboxes"]);
    expect(f.campos[0]!.value).toBe("Gracias por avisar. Otra línea.");
    expect(f.campos[1]!.label).toBe("Zona");
    expect(f.campos[1]!.opciones).toEqual(["Frente", "Servicios"]);
    expect(f.campos[2]!.opciones).toEqual(["Sin secretos"]);
    expect(problemasDeEstructura(f)).toEqual([]);
  });

  it("un formulario que no se puede leer falla con el nombre del archivo y no tumba lo demás", () => {
    const textos = ["name: A\nlabels: [bug\nbody:\n", "name: A\nlabels:\n  - bug\nbody:\n"];
    for (const texto of textos) {
      const f = leerSeguro("roto.yml", () => texto);
      expect(f.error).toBeTruthy();
      expect(problemasDeEstructura(f).join("\n")).toContain("roto.yml: no se pudo leer");
    }
  });
});

describe("estructura de los formularios de issue", () => {
  const buenoBase = (): Formulario => ({
    archivo: "memoria.yml",
    claves: { name: "Algo", description: "Un formulario", body: "" },
    labels: ["bug"],
    campos: [
      { type: "markdown", value: "Gracias", opciones: [] },
      { type: "textarea", id: "que-pasa", label: "Qué pasa", opciones: [] },
      { type: "dropdown", id: "zona", label: "Zona", opciones: ["Frente", "Servicios"] },
      { type: "checkboxes", id: "cuidado", label: "Antes de enviar", opciones: ["Sin secretos"] },
    ],
  });

  it("el formulario de ejemplo no tiene problemas", () => {
    expect(problemasDeEstructura(buenoBase())).toEqual([]);
  });

  const rotos: { caso: string; romper: (f: Formulario) => void; dice: string }[] = [
    { caso: "sin name", romper: (f) => void (f.claves["name"] = ""), dice: "falta name" },
    { caso: "sin description", romper: (f) => void delete f.claves["description"], dice: "falta description" },
    {
      caso: "sin body",
      romper: (f) => {
        delete f.claves["body"];
        f.campos = [];
      },
      dice: "falta body",
    },
    { caso: "con un tipo desconocido", romper: (f) => void (f.campos[1]!.type = "select"), dice: "tipo inválido" },
    { caso: "con un id repetido", romper: (f) => void (f.campos[2]!.id = "que-pasa"), dice: "repite el id que-pasa" },
    { caso: "con un campo sin id", romper: (f) => void delete f.campos[1]!.id, dice: "no tiene id" },
    { caso: "con un campo sin label", romper: (f) => void delete f.campos[1]!.label, dice: "no tiene label" },
    { caso: "con un label vacío", romper: (f) => void (f.campos[2]!.label = ""), dice: "no tiene label" },
    { caso: "con un markdown sin value", romper: (f) => void (f.campos[0]!.value = ""), dice: "no tiene value" },
    { caso: "con un dropdown sin opciones", romper: (f) => void (f.campos[2]!.opciones = []), dice: "no tiene opciones" },
    { caso: "con un checkboxes sin opciones", romper: (f) => void (f.campos[3]!.opciones = []), dice: "no tiene opciones" },
    { caso: "con una opción vacía", romper: (f) => void (f.campos[2]!.opciones = ["Frente", ""]), dice: "opción vacía" },
    { caso: "con una opción repetida", romper: (f) => void (f.campos[2]!.opciones = ["Frente", "Frente"]), dice: "repite una opción" },
    { caso: "que no se pudo leer", romper: (f) => void (f.error = "labels vacío"), dice: "no se pudo leer" },
  ];

  it.each(rotos)("rechaza un formulario $caso", ({ romper, dice }) => {
    const f = buenoBase();
    romper(f);
    const problemas = problemasDeEstructura(f);
    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.join("\n")).toContain(dice);
    expect(problemas.join("\n")).toContain("memoria.yml");
  });
});

describe("formularios de issue", () => {
  const archivos = ["falla.yml", "mejora.yml", "trabajo.yml"];
  const formularios = archivos.map(leerFormulario);
  // Las etiquetas que el repositorio usa de verdad (gh label list). Se actualiza a mano cuando se
  // crea o se borra una. Si algún día el repositorio versiona su lista, esa manda.
  const ARCHIVO_DE_ETIQUETAS = ".github/labels.yml";
  const ETIQUETAS_DEL_REPOSITORIO = [
    "accessibility",
    "bug",
    "documentation",
    "duplicate",
    "enhancement",
    "good first issue",
    "help wanted",
    "invalid",
    "question",
    "wontfix",
    "type:feature",
    "prioridad",
    "zona:frente",
    "zona:dirección",
    "zona:servicios",
    "en integración",
    "espera otra rama",
  ];
  const ETIQUETAS = new Set(
    existe(ARCHIVO_DE_ETIQUETAS)
      ? [...leer(ARCHIVO_DE_ETIQUETAS).matchAll(/^- name:\s*"?([^"\n]+?)"?\s*$/gm)].map((m) => m[1]!)
      : ETIQUETAS_DEL_REPOSITORIO,
  );

  it("la prueba cubre todos los formularios del directorio", () => {
    const hay = archivosDeFormularios().filter((n) => n !== "config.yml");
    expect(hay.sort()).toEqual([...archivos].sort());
  });

  it.each(formularios)("$archivo se puede leer y está bien armado", (f) => {
    expect(problemasDeEstructura(f)).toEqual([]);
  });

  it.each(formularios)("$archivo solo pone etiquetas que existen", (f) => {
    expect(f.labels.filter((e) => !ETIQUETAS.has(e))).toEqual([]);
  });

  it("el formulario del equipo enlaza el reparto con su dirección completa", () => {
    expect(leer(".github/ISSUE_TEMPLATE/trabajo.yml")).toContain(URL_REPARTO);
  });
});

describe("sintaxis de los YAML de .github/ISSUE_TEMPLATE", () => {
  /**
   * Busca valores que un lector de YAML rechaza o entiende distinto. No reemplaza a un lector
   * completo: revisa lo que en estos archivos ya falló una vez. En un valor plano, dos puntos
   * seguidos de un espacio abren otro mapeo y un espacio antes de la almohadilla empieza un
   * comentario. Un valor entre comillas tiene que cerrarlas y una lista o un mapa de una línea
   * tiene que cerrar su corchete o su llave. El contenido de un bloque con barra vertical o mayor
   * que se saltea.
   */
  const problemasDeSintaxis = (archivo: string, texto: string): string[] => {
    const problemas: string[] = [];
    let sangriaDeBloque: number | null = null;
    texto.split("\n").forEach((linea, i) => {
      const sangria = linea.length - linea.trimStart().length;
      if (sangriaDeBloque !== null) {
        if (linea.trim() === "" || sangria > sangriaDeBloque) return;
        sangriaDeBloque = null;
      }
      if (/\t/.test(linea.slice(0, sangria))) problemas.push(`${archivo}:${i + 1} sangría con tabulador`);
      const m = /^(\s*)(- )?([A-Za-z_][\w-]*):(?: +(.*))?$/.exec(linea);
      if (!m) return;
      const valor = (m[4] ?? "").trim();
      const donde = `${archivo}:${i + 1}`;
      if (/^[|>]/.test(valor)) {
        sangriaDeBloque = m[1]!.length + (m[2] ? 2 : 0);
      } else if (valor.startsWith('"')) {
        if (valor.length < 2 || !valor.endsWith('"')) problemas.push(`${donde} comillas sin cerrar`);
      } else if (valor.startsWith("'")) {
        if (valor.length < 2 || !valor.endsWith("'")) problemas.push(`${donde} comillas sin cerrar`);
      } else if (valor.startsWith("[")) {
        if (!valor.endsWith("]")) problemas.push(`${donde} lista de una línea sin cerrar`);
      } else if (valor.startsWith("{")) {
        if (!valor.endsWith("}")) problemas.push(`${donde} mapa de una línea sin cerrar`);
      } else {
        if (/: /.test(valor) || /:$/.test(valor)) problemas.push(`${donde} dos puntos dentro de un valor plano`);
        if (/ #/.test(valor)) problemas.push(`${donde} almohadilla dentro de un valor plano`);
        if (/^[@`%*&!?]/.test(valor)) problemas.push(`${donde} un valor plano no puede empezar con ${valor[0]}`);
      }
    });
    return problemas;
  };

  it("acepta una lista de una línea con o sin comillas y rechaza la que no cierra", () => {
    expect(problemasDeSintaxis("x.yml", "labels: [bug, enhancement]")).toEqual([]);
    expect(problemasDeSintaxis("x.yml", 'labels: ["bug", "enhancement"]')).toEqual([]);
    expect(problemasDeSintaxis("x.yml", "labels: [bug, enhancement").join("\n")).toContain("sin cerrar");
  });

  it("rechaza dos puntos dentro de un valor plano", () => {
    expect(problemasDeSintaxis("x.yml", "description: Una cosa: otra").join("\n")).toContain("dos puntos");
  });

  const todos = archivosDeFormularios();

  it("hay archivos que revisar", () => {
    expect(todos.length).toBeGreaterThan(1);
  });

  it.each(todos.map((archivo) => ({ archivo })))("$archivo no tiene valores planos que rompan el YAML", ({ archivo }) => {
    expect(problemasDeSintaxis(archivo, leer(`.github/ISSUE_TEMPLATE/${archivo}`))).toEqual([]);
  });
});

describe("config.yml", () => {
  const enlaces = [...config.matchAll(/name: (.+)\n\s+url: (\S+)\n\s+about: (.+)/g)].map((m) => ({
    nombre: m[1]!,
    url: m[2]!,
    texto: m[3]!,
  }));

  it("el enlace de seguridad lleva a la política del repositorio, que existe", () => {
    const seguridadEnlace = enlaces.find((e) => /seguridad/i.test(e.nombre));
    expect(seguridadEnlace).toBeDefined();
    expect(seguridadEnlace!.url).toBe(`${REPO}/blob/main/SECURITY.md`);
    expect(existe("SECURITY.md")).toBe(true);
  });

  it("cada enlace lleva a un archivo del repositorio que existe o a una página del sitio que existe", () => {
    expect(enlaces.length).toBeGreaterThan(0);
    for (const e of enlaces) {
      if (e.url.startsWith(`${REPO}/blob/main/`)) {
        expect(existe(e.url.slice(`${REPO}/blob/main/`.length)), e.url).toBe(true);
      } else {
        expect(e.url.startsWith(SITIO), e.url).toBe(true);
        // Las páginas del sitio son los .html de la raíz del repositorio. La raíz sola vale.
        const pagina = e.url.slice(SITIO.length).split(/[?#]/)[0]!;
        expect(pagina, e.url).toMatch(/^[\w-]+\.html$/);
        expect(existe(pagina), e.url).toBe(true);
      }
    }
  });

  it("el correo que ofrece es el único permitido", () => {
    const correos = new Set([...config.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0]));
    expect([...correos].filter((c) => c !== "hola@tinkazo.app")).toEqual([]);
  });
});
