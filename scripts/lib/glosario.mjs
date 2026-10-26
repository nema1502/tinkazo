/**
 * Las piezas del revisor de español neutral (`scripts/check-glosario.mjs`),
 * sin leer ni escribir nada: reciben texto y devuelven hallazgos, para probarlas
 * sin tocar el repo.
 *
 * La regla (la de la tarea del barrido de letra, 25 de octubre de 2026): el
 * sitio mantiene el voseo y los nombres culturales de los juegos; lo que se
 * pide neutral es el vocabulario cotidiano, el que un hispanohablante de otro
 * país no entiende o lee raro. La lista vive en `glosario-neutral.json`.
 */

/**
 * Los textos entre comillas de un archivo de código, con su línea, sin los
 * comentarios ni los nombres de variables. Lo de adentro de `${…}` se saltea.
 */
export function literalesDe(fuente) {
  const out = [];
  const n = fuente.length;
  let i = 0;
  let linea = 1;
  while (i < n) {
    const c = fuente[i];
    if (c === "\n") {
      linea++;
      i++;
    } else if (c === "/" && fuente[i + 1] === "/") {
      while (i < n && fuente[i] !== "\n") i++;
    } else if (c === "/" && fuente[i + 1] === "*") {
      i += 2;
      while (i < n && !(fuente[i] === "*" && fuente[i + 1] === "/")) {
        if (fuente[i] === "\n") linea++;
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'") {
      const ini = linea;
      let txt = "";
      i++;
      while (i < n && fuente[i] !== c && fuente[i] !== "\n") {
        if (fuente[i] === "\\") {
          txt += fuente[i + 1] ?? "";
          i += 2;
        } else txt += fuente[i++];
      }
      i++;
      out.push({ texto: txt, linea: ini });
    } else if (c === "`") {
      const ini = linea;
      let txt = "";
      i++;
      while (i < n && fuente[i] !== "`") {
        if (fuente[i] === "\\") {
          txt += fuente[i + 1] ?? "";
          i += 2;
        } else if (fuente[i] === "$" && fuente[i + 1] === "{") {
          let prof = 1;
          i += 2;
          txt += " ";
          while (i < n && prof > 0) {
            if (fuente[i] === "{") prof++;
            else if (fuente[i] === "}") prof--;
            else if (fuente[i] === "\n") linea++;
            i++;
          }
        } else {
          if (fuente[i] === "\n") linea++;
          txt += fuente[i++];
        }
      }
      i++;
      out.push({ texto: txt, linea: ini });
    } else i++;
  }
  return out;
}

const blanquear = (m) => m.replace(/[^\n]/g, " ");

/**
 * Lo que se lee de un HTML: el texto entre etiquetas y los atributos que se
 * muestran o se leen en voz alta (`alt`, `title`, `aria-label`, `placeholder`,
 * `content`). Sin scripts, estilos ni comentarios, y con las líneas de siempre.
 */
export function textosDeHtml(html) {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, blanquear)
    .replace(/<script[\s\S]*?<\/script>/gi, blanquear)
    .replace(/<style[\s\S]*?<\/style>/gi, blanquear);
  const lineaDe = (idx) => s.slice(0, idx).split("\n").length;
  const out = [];
  for (const m of s.matchAll(/\b(?:alt|title|aria-label|placeholder|content)="([^"]*)"/gi)) {
    out.push({ texto: m[1], linea: lineaDe(m.index ?? 0) });
  }
  const suelto = s.replace(/<[^>]*>/g, blanquear);
  suelto.split("\n").forEach((texto, i) => {
    if (texto.trim()) out.push({ texto, linea: i + 1 });
  });
  return out;
}

/** Cada entrada del glosario, con su expresión: la palabra entera, con o sin tilde, sin distinguir mayúsculas. */
export function compilar(glosario) {
  return glosario.entradas.map((e) => ({
    ...e,
    estado: e.estado ?? "activa",
    re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${e.evitar})(?![\\p{L}\\p{N}_])`, "giu"),
  }));
}

/**
 * Los hallazgos de una lista de textos. Los nombres de los juegos se borran
 * antes de mirar: "Chovena" o "La Entrada" son palabras de acá y se quedan.
 */
export function buscarFaltas(textos, entradas, nombresDeJuegos = []) {
  const faltas = [];
  const nombres = [...nombresDeJuegos].sort((a, b) => b.length - a.length);
  for (const { texto, linea } of textos) {
    let t = texto;
    for (const nombre of nombres) t = t.split(nombre).join(" ".repeat(nombre.length));
    for (const e of entradas) {
      for (const m of t.matchAll(e.re)) {
        const ini = Math.max(0, (m.index ?? 0) - 24);
        faltas.push({
          linea,
          encontrada: m[0],
          alternativa: e.alternativa,
          tipo: e.tipo ?? "",
          estado: e.estado,
          fragmento: texto.slice(ini, (m.index ?? 0) + m[0].length + 24).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return faltas;
}
