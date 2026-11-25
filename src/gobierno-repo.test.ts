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

describe("formularios de issue", () => {
  type Formulario = { archivo: string; claves: Record<string, string>; labels: string[]; campos: { type: string; id?: string }[] };

  /**
   * Lee el subconjunto de YAML que usan los formularios: claves de primer nivel, `labels` en
   * una línea y los campos de `body`, cada uno con `type` y, a veces, `id`. No hay un lector de
   * YAML entre las dependencias y no se suma uno por esto.
   */
  const leerFormulario = (archivo: string): Formulario => {
    const claves: Record<string, string> = {};
    const campos: { type: string; id?: string }[] = [];
    let labels: string[] = [];
    let enBody = false;
    for (const linea of leer(`.github/ISSUE_TEMPLATE/${archivo}`).split("\n")) {
      const clave = /^([a-z_]+):\s*(.*)$/.exec(linea);
      if (clave) {
        enBody = clave[1] === "body";
        claves[clave[1]!] = clave[2]!;
        if (clave[1] === "labels") labels = JSON.parse(clave[2]!) as string[];
        continue;
      }
      if (!enBody) continue;
      const campo = /^ {2}- type:\s*(\S+)\s*$/.exec(linea);
      if (campo) campos.push({ type: campo[1]! });
      const id = /^ {4}id:\s*(\S+)\s*$/.exec(linea);
      if (id && campos.length > 0) campos[campos.length - 1]!.id = id[1]!;
    }
    return { archivo, claves, labels, campos };
  };

  const archivos = ["falla.yml", "mejora.yml", "trabajo.yml"];
  const formularios = archivos.map(leerFormulario);
  const TIPOS = new Set(["markdown", "input", "textarea", "dropdown", "checkboxes"]);
  // Si el repositorio versiona su lista de etiquetas, esa manda. Si no, valen las que GitHub trae
  // en todo repositorio.
  const ARCHIVO_DE_ETIQUETAS = ".github/labels.yml";
  const ETIQUETAS_DE_GITHUB = new Set(
    existe(ARCHIVO_DE_ETIQUETAS)
      ? [...leer(ARCHIVO_DE_ETIQUETAS).matchAll(/^- name:\s*"?([^"\n]+?)"?\s*$/gm)].map((m) => m[1]!)
      : ["bug", "enhancement", "documentation", "question"],
  );

  it("la prueba cubre todos los formularios del directorio", () => {
    const hay = readdirSync(raiz(".github/ISSUE_TEMPLATE")).filter((n) => n.endsWith(".yml") && n !== "config.yml");
    expect(hay.sort()).toEqual([...archivos].sort());
  });

  it.each(formularios)("$archivo tiene name, description y body con campos", (f) => {
    expect(f.claves["name"]).toBeTruthy();
    expect(f.claves["description"]).toBeTruthy();
    expect("body" in f.claves).toBe(true);
    expect(f.campos.length).toBeGreaterThan(0);
  });

  it.each(formularios)("$archivo usa solo tipos de campo válidos", (f) => {
    expect(f.campos.filter((c) => !TIPOS.has(c.type))).toEqual([]);
  });

  it.each(formularios)("$archivo no repite ningún id", (f) => {
    const ids = f.campos.flatMap((c) => (c.id ? [c.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    // Todo campo que se rellena lleva id: solo el texto fijo puede no tenerlo.
    expect(f.campos.filter((c) => c.type !== "markdown" && !c.id)).toEqual([]);
  });

  it.each(formularios)("$archivo solo pone etiquetas que existen", (f) => {
    expect(f.labels.filter((e) => !ETIQUETAS_DE_GITHUB.has(e))).toEqual([]);
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
   * comentario. Un valor entre comillas tiene que cerrarlas. El contenido de un bloque con barra
   * vertical o mayor que se saltea.
   */
  const problemasDeSintaxis = (archivo: string): string[] => {
    const problemas: string[] = [];
    let sangriaDeBloque: number | null = null;
    leer(`.github/ISSUE_TEMPLATE/${archivo}`)
      .split("\n")
      .forEach((linea, i) => {
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
        } else if (valor.startsWith("[") || valor.startsWith("{")) {
          try {
            JSON.parse(valor);
          } catch {
            problemas.push(`${donde} lista o mapa de una línea que no se lee`);
          }
        } else {
          if (/: /.test(valor) || /:$/.test(valor)) problemas.push(`${donde} dos puntos dentro de un valor plano`);
          if (/ #/.test(valor)) problemas.push(`${donde} almohadilla dentro de un valor plano`);
          if (/^[@`%*&!?]/.test(valor)) problemas.push(`${donde} un valor plano no puede empezar con ${valor[0]}`);
        }
      });
    return problemas;
  };

  const todos = readdirSync(raiz(".github/ISSUE_TEMPLATE")).filter((n) => n.endsWith(".yml"));

  it("hay archivos que revisar", () => {
    expect(todos.length).toBeGreaterThan(1);
  });

  it.each(todos.map((archivo) => ({ archivo })))("$archivo no tiene valores planos que rompan el YAML", ({ archivo }) => {
    expect(problemasDeSintaxis(archivo)).toEqual([]);
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

  it("cada enlace lleva a un archivo del repositorio que existe o a una página del sitio", () => {
    expect(enlaces.length).toBeGreaterThan(0);
    for (const e of enlaces) {
      const archivo = e.url.startsWith(`${REPO}/blob/main/`) ? e.url.slice(`${REPO}/blob/main/`.length) : null;
      if (archivo) expect(existe(archivo), e.url).toBe(true);
      else expect(e.url.startsWith("https://tinkazo.app/"), e.url).toBe(true);
    }
  });

  it("el correo que ofrece es el único permitido", () => {
    const correos = new Set([...config.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0]));
    expect([...correos].filter((c) => c !== "hola@tinkazo.app")).toEqual([]);
  });
});
