/**
 * La prueba del niño, sin Chrome: qué se pregunta, cómo se arma lo que ve el
 * describidor y cómo juzga el juez. Lo usan `scripts/audit-nino.mjs` y sus pruebas.
 *
 * La regla (la del niño, en `docs/juegos.md`): una sola vara, la de alguien de 7
 * años o más. Cualquier cuadro del juego, sin leer el relator, muestra si ya ganó
 * alguien, cuánto falta, qué acaba de pasar, adónde mirar y lo propio de su forma
 * (quién va adelante, quiénes siguen, qué está señalado, quién tiene más). Quien
 * tiene 7 años lee nombres, así que las fotos llevan los nombres y no el subtítulo.
 *
 * **La forma.** Cada juego declara la suya (`carrera`, `de-pie`, `rueda`,
 * `acumulacion`) y la expone en `window.__nino.forma`. Cuatro preguntas son de
 * todos (`gano`, `falta`, `paso`, `mirar`) y una es propia de la forma (`propia`).
 *
 * **Las imágenes.** Por parada hay dos. La foto, una sola y con nombres, es para
 * `gano`, `falta` y `propia` (y `olor`). La tira, tres cuadros del mismo tamaño
 * (0,6 s antes, 0,3 s antes y el momento), es para `paso` y `mirar`: un chico
 * mira movimiento, y una foto quieta no lo muestra.
 *
 * **El arco.** El auditor para al 25 %, al 60 % y un segundo después del golpe, y
 * guarda la verdad del plan (`window.__nino.verdad()`). Una corrida de un tamaño
 * (un arco) pasa si:
 *   - al 25 %: `gano` = no y `mirar` bien;
 *   - al 60 %: `propia` bien y `falta` a 0,2 o menos;
 *   - al final: `gano` = si con el nombre bien y `paso` = gano.
 * Las demás respuestas se informan pero no deciden. Un `si` antes del golpe es
 * una falla grave: la presentación delata a quien gana. Una semilla pasa si pasan
 * sus dos tamaños; un juego pasa con 7 de cada 8 semillas (con 2 semillas, las 2).
 *
 * Las tolerancias son las de siempre: nombres sin tildes ni mayúsculas y con las
 * cinco primeras letras de cada palabra; `mirar` igual a la zona, sin decir también
 * el sentido contrario; `falta` a 0,2 o menos del progreso; `paso` por tipo, y con
 * nombre si lo hay. Acá no se llama a ninguna API.
 */
import { createHash } from "node:crypto";

/* ------------------------------------------------------------ qué se saca */

/** Los tres momentos: al 25 % y al 60 % de la duración, y un segundo después del golpe. */
export const PUNTOS = [
  { id: "p25", etiqueta: "al 25 %", fraccion: 0.25 },
  { id: "p60", etiqueta: "al 60 %", fraccion: 0.6 },
  { id: "fin", etiqueta: "1 s después del golpe", despues: 1 },
];

/** El proyector, oscuro, y el celular, claro. */
export const TAMANOS = [
  { id: "1080", ancho: 1920, alto: 1080, tema: "dark", celular: false },
  { id: "390", ancho: 390, alto: 844, tema: "light", celular: true },
];

/** Los cuadros de la tira: cuántos segundos antes del momento se saca cada uno. */
export const CUADROS_ATRAS = [0.6, 0.3, 0];

/** Las dos imágenes de cada parada. */
export const IMAGENES = ["foto", "tira"];

/** A qué hora del juego se para para cada punto, en segundos. */
export const horaDeParada = (punto, duracion) => (punto.fraccion !== undefined ? punto.fraccion * duracion : duracion + punto.despues);

/** Las horas de los tres cuadros de una parada, en segundos de juego (nunca antes de 0). */
export const horasDeLosCuadros = (punto, duracion) => CUADROS_ATRAS.map((atras) => Math.max(0, horaDeParada(punto, duracion) - atras));

/** Los juegos por su nombre de uso y por su id en el sitio. */
export const ALIAS = { ruleta: "wheel", carrera: "race" };
export const idDeJuego = (nombre) => ALIAS[nombre] ?? nombre;

/** 64 hex sembrados con el número de la corrida: la misma semilla da la misma ronda. */
export const semillaDe = (i) => createHash("sha256").update(`semilla-nino-${i}`).digest("hex");

/* ------------------------------------------------------------- las formas */

export const FORMAS = ["carrera", "de-pie", "rueda", "acumulacion"];

/**
 * La forma de cada juego, la que se decidió el 2 de noviembre de 2026 por la
 * pregunta que contestaría un chico mirando un cuadro. La declaran los juegos
 * (`kit/catalogo.ts` y los ganchos de la ruleta y la carrera); esta tabla es la
 * referencia de las pruebas y de los juegos que todavía no exponen `__nino`.
 */
export const FORMA_DECIDIDA = {
  race: "carrera",
  teleferico: "de-pie",
  rockets: "carrera",
  guajojo: "de-pie",
  toborochi: "de-pie",
  pinata: "de-pie",
  sapo: "de-pie",
  quien: "de-pie",
  trueque: "de-pie",
  wheel: "rueda",
  trompo: "de-pie",
  oruro: "de-pie",
  chovena: "de-pie",
};

/* --------------------------------------------------------- las preguntas */

/** Lo que se pregunta sobre cada imagen: la foto (con nombres) y la tira (tres cuadros). */
export const CLAVES_FOTO = ["gano", "falta", "propia"];
export const CLAVES_TIRA = ["paso", "mirar"];
export const CLAVES = ["gano", "falta", "paso", "mirar", "propia"];

export const DIRECCIONES = ["arriba", "abajo", "izquierda", "derecha", "centro", "alrededor"];
export const TIPOS_PASO = ["empezo", "salio", "adelante", "freno", "casi", "gano", "nada"];
/** Cuánto falta, en palabras, y a qué progreso (0 a 1) corresponde cada una. */
export const FALTA = { empieza: 0, mucho: 0.25, mitad: 0.5, poco: 0.75, termino: 1 };
export const TOLERANCIA_FALTA = 0.2;

const AVISO_TIRA = "La imagen son tres cuadros seguidos, de izquierda a derecha, con unos tres décimos de segundo entre uno y el siguiente: el de la derecha es el momento.";

/** La pregunta propia de cada forma. */
export const TEXTO_PROPIA = {
  carrera: "¿Quién va adelante? Escribí su nombre tal como se lee; si no se lee, \"no se ve\".",
  "de-pie": "¿Quiénes siguen en juego? Escribí dos nombres que se lean, separados por una coma.",
  rueda: "¿Qué nombre está señalado ahora? Escribí el nombre tal como se lee; si no se lee, \"no se ve\".",
  acumulacion: "¿Quién tiene más? Escribí su nombre tal como se lee; si no se lee, \"no se ve\".",
};

/** Lo mismo para todos los juegos, menos `propia`. El prompt fijo (`prompt-nino.md`) las repite. */
export const TEXTO_PREGUNTAS = {
  gano: "¿Ya se sabe quién ganó? Si no, escribí no. Si sí, escribí si, y en \"quien\" el nombre tal como se lee.",
  falta: "¿Cuánto falta para que termine? Una de: empieza, mucho, mitad, poco, termino.",
  paso: `${AVISO_TIRA} ¿Qué acaba de pasar? Una de: empezo, salio (salió alguien), adelante (alguien pasó adelante), freno (alguien se frenó o tropezó), casi (casi sale y volvió), gano, nada (nada nuevo). En "quien", el nombre de la persona si se lee.`,
  mirar: `${AVISO_TIRA} ¿Adónde hay que mirar para seguir lo que pasa? Una de: arriba, abajo, izquierda, derecha, centro, alrededor.`,
  propia: TEXTO_PROPIA,
  olor: "¿Esto parece un casino, una máquina tragamonedas o un juego de apuestas? Escribí si o no, y en \"vi\" tres palabras de por qué.",
};

/** El texto de una pregunta: la propia depende de la forma. */
export const textoDe = (clave, forma) => (clave === "propia" ? TEXTO_PROPIA[forma] : TEXTO_PREGUNTAS[clave]);

/** Lo que se pregunta de una imagen: `olor` va en todas las fotos (si va solo en una, es la última y se sabe). */
export const clavesDe = (imagen) => (imagen === "tira" ? CLAVES_TIRA : [...CLAVES_FOTO, "olor"]);

/* ------------------------------------------------------------ el lenguaje */

/** Sin tildes ni mayúsculas ni signos, con espacios simples. */
export function normalizar(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export const palabras = (s) => normalizar(s).split(" ").filter(Boolean);

/**
 * ¿Es el mismo nombre? Palabra por palabra, con las cinco primeras letras, y una
 * inicial («María Q.») alcanza. Dos personas con el mismo nombre no se distinguen:
 * quien juzga prueba con todas las que van adelante.
 */
export function coincideNombre(modelo, verdadero) {
  const m = palabras(modelo);
  const v = palabras(verdadero);
  if (!m.length || !v.length) return false;
  if (m.join(" ") === "no se ve") return false;
  const k = Math.min(m.length, v.length);
  for (let i = 0; i < k; i++) {
    const a = m[i].slice(0, 5);
    const b = v[i].slice(0, 5);
    if (!(b.startsWith(a) || a.startsWith(b))) return false;
  }
  return true;
}

const OPUESTO = { arriba: "abajo", abajo: "arriba", izquierda: "derecha", derecha: "izquierda" };

/** «Mirar» igual a la zona, o una parte de la diagonal; si dice también el sentido contrario, no. */
export function coincideMirar(modelo, verdad) {
  const dichas = DIRECCIONES.filter((d) => palabras(modelo).includes(d));
  if (!dichas.includes(verdad)) return false;
  return !(OPUESTO[verdad] && dichas.includes(OPUESTO[verdad]));
}

/** Cuánto falta, de 0 a 1, según la palabra del modelo; null si no dijo ninguna. */
export function valorFalta(modelo) {
  const w = palabras(modelo);
  if (w.some((x) => ["termino", "termina", "terminado", "fin"].includes(x))) return FALTA.termino;
  if (w.some((x) => ["empieza", "empezo", "empezando", "comienza"].includes(x))) return FALTA.empieza;
  for (const k of ["mucho", "mitad", "poco"]) if (w.includes(k)) return FALTA[k];
  return null;
}
export function coincideFalta(modelo, progreso) {
  const v = valorFalta(modelo);
  return v !== null && Math.abs(v - progreso) <= TOLERANCIA_FALTA + 1e-9;
}

/** El tipo de hecho que nombró el modelo; null si no nombró ninguno. */
export function tipoDePaso(modelo) {
  const w = palabras(modelo);
  return TIPOS_PASO.find((t) => w.includes(t)) ?? null;
}

/** El hecho por su tipo, y con el nombre si la foto lo tiene y la verdad lo pide. */
export function coincidePaso(modeloPaso, modeloQuien, verdad, nombres) {
  if (tipoDePaso(modeloPaso) !== verdad.tipo) return false;
  const pideNombre = verdad.quien !== undefined && verdad.tipo !== "nada" && verdad.tipo !== "empezo";
  return pideNombre ? coincideNombre(modeloQuien, nombres[verdad.quien] ?? "") : true;
}

/**
 * ¿Ya se sabe quién ganó? `"si"`, `"no"` o null si no contestó ninguna de las dos.
 * Si dice las dos («no, o sí»), vale la primera.
 */
export function veredictoGano(modelo) {
  const w = palabras(modelo);
  const si = w.indexOf("si");
  const no = w.indexOf("no");
  if (si < 0 && no < 0) return null;
  if (si < 0) return "no";
  if (no < 0) return "si";
  return si < no ? "si" : "no";
}

/** El nombre que dijo el modelo para el ganador: el campo «quien» o, si falta, lo que sigue al «si». */
export function nombreDelGanador(r) {
  if (palabras(r?.quien).length) return r.quien;
  const w = palabras(r?.gano);
  const i = w.indexOf("si");
  return i >= 0 ? w.slice(i + 1).join(" ") : "";
}

/** Los nombres de una respuesta de «quiénes siguen»: una lista, o un texto separado por comas, «y» o rayas. */
export function nombresDichos(modelo) {
  if (Array.isArray(modelo)) return modelo.map(String).filter((x) => palabras(x).length);
  return String(modelo ?? "")
    .split(/[,;\n/|]+|\s+y\s+|\s+e\s+|\s+and\s+/i)
    .map((x) => x.trim())
    .filter((x) => palabras(x).length);
}

/** Los puestos de la lista que gana al final: los que van adelante con el cartel y los ganadores del sorteo. */
const ganadoresDe = (c) => [...new Set([...(c.verdad?.adelante?.quienes ?? []), ...(Array.isArray(c.ganadores) ? c.ganadores.filter((x) => Number.isInteger(x)) : [])])];

/** ¿Está bien lo de «adelante»? Por el nombre de cualquiera de los que van adelante. */
export function coincideAdelante(modelo, verdad, nombres) {
  return verdad.adelante.quienes.some((i) => coincideNombre(modelo, nombres[i] ?? ""));
}

/**
 * La pregunta propia, por forma. Carrera, rueda y acumulación: un nombre entre los
 * que están adelante (en la rueda, el señalado; en la carrera, quien va adelante o
 * a un cuerpo). De pie: dos nombres distintos, los dos entre quienes siguen en
 * juego (si sigue uno solo, ese).
 */
export function coincidePropia(forma, modelo, verdad, nombres) {
  const quienes = verdad.adelante.quienes;
  if (forma !== "de-pie") return coincideAdelante(Array.isArray(modelo) ? modelo[0] : modelo, verdad, nombres);
  const dichos = nombresDichos(modelo).slice(0, Math.min(2, quienes.length));
  if (dichos.length < Math.min(2, quienes.length)) return false;
  const puestos = new Set();
  for (const d of dichos) {
    const i = quienes.find((q) => coincideNombre(d, nombres[q] ?? ""));
    if (i === undefined) return false;
    puestos.add(i);
  }
  return puestos.size === dichos.length;
}

/* ------------------------------------------------------------- el juez */

/**
 * Un momento (una parada): lo que contestó el modelo sobre la foto y sobre la tira,
 * contra la verdad. `aciertos` lleva todas las preguntas, para informar; `decide`
 * dice cuáles cuentan en este punto del arco y `pasa` si todas están bien.
 */
export function juzgarMomento({ foto, tira, c }) {
  const f = foto ?? {};
  const t = tira ?? {};
  const final = c.punto === "fin";
  const v = c.verdad;
  const nombres = c.nombres;
  const dijo = veredictoGano(f.gano);
  const quienGana = nombreDelGanador(f);
  const verdadPaso = final && v.paso.tipo !== "gano" ? { tipo: "gano", quien: v.paso.quien ?? ganadoresDe(c)[0] } : v.paso;
  const aciertos = {
    gano: final ? dijo === "si" && ganadoresDe(c).some((i) => coincideNombre(quienGana, nombres[i] ?? "")) : dijo === "no",
    falta: coincideFalta(f.falta, v.progreso),
    propia: coincidePropia(c.forma, f.propia, v, nombres),
    mirar: coincideMirar(t.mirar, v.adelante.lugar),
    paso: coincidePaso(t.paso, t.quien, verdadPaso, nombres),
  };
  const decide = final ? ["gano", "paso"] : c.punto === "p25" ? ["gano", "mirar"] : ["propia", "falta"];
  // Antes del golpe, decir «ya se sabe» es que la presentación delata a quien gana.
  const grave = !final && dijo === "si";
  const pasa = decide.every((k) => aciertos[k]) && !grave;
  return {
    aciertos,
    decide,
    pasa,
    grave,
    olor: f.olor === undefined ? null : veredictoGano(f.olor),
    respondida: foto != null && tira != null,
  };
}

/** Cuántas corridas hay que aprobar: siete de cada ocho. */
export const minimoDeCorridas = (semillas) => semillas - Math.floor(semillas / 8);

/**
 * El veredicto. `capturas` es el `verdad.json` (id → { semilla, tamano, punto, imagen, forma,
 * verdad, nombres, ganadores }), `respuestas` lo que escribió el describidor (id → respuesta) y
 * `desempate` lo del segundo describidor para las que fallaron: si está, decide él.
 *
 * Una corrida de un tamaño es un arco (tres momentos). Una semilla pasa si pasan sus
 * tamaños; el juego pasa con siete de cada ocho semillas.
 */
export function juzgar({ capturas, respuestas = {}, desempate = {} }) {
  const arcos = new Map();
  for (const [id, c] of Object.entries(capturas)) {
    const clave = `${c.semilla}|${c.tamano}|${c.punto}`;
    if (!arcos.has(clave)) arcos.set(clave, { c, ids: {} });
    arcos.get(clave).ids[c.imagen] = id;
  }
  const momentos = [...arcos.values()].map(({ c, ids }) => {
    const sacar = (usar, imagen) => (ids[imagen] === undefined ? null : usar[ids[imagen]] ?? null);
    let j = juzgarMomento({ foto: sacar(respuestas, "foto"), tira: sacar(respuestas, "tira"), c });
    let desempatado = false;
    if (!j.pasa) {
      const foto = sacar(desempate, "foto") ?? sacar(respuestas, "foto");
      const tira = sacar(desempate, "tira") ?? sacar(respuestas, "tira");
      if (sacar(desempate, "foto") != null || sacar(desempate, "tira") != null) {
        j = juzgarMomento({ foto, tira, c });
        desempatado = true;
      }
    }
    return { semilla: c.semilla, tamano: c.tamano, punto: c.punto, forma: c.forma, ids: Object.values(ids), desempatado, ...j };
  });
  const semillas = [...new Set(momentos.map((m) => m.semilla))].sort((a, b) => a - b);
  const tamanos = [...new Set(momentos.map((m) => m.tamano))];
  const arcosPorTamano = semillas.flatMap((s) =>
    tamanos.map((tamano) => {
      const de = momentos.filter((m) => m.semilla === s && m.tamano === tamano);
      return { semilla: s, tamano, pasa: de.length > 0 && de.every((m) => m.pasa), falla: de.filter((m) => !m.pasa).map((m) => m.punto) };
    }),
  );
  const corridas = semillas.map((s) => {
    const de = arcosPorTamano.filter((a) => a.semilla === s);
    return { semilla: s, pasa: de.every((a) => a.pasa), arcos: de.length, falla: de.filter((a) => !a.pasa).map((a) => `${a.tamano}: ${a.falla.join(", ")}`) };
  });
  const minimo = minimoDeCorridas(semillas.length);
  const pasan = corridas.filter((x) => x.pasa).length;
  const olores = momentos.map((m) => m.olor).filter((o) => o !== null);
  return {
    semillas: semillas.length,
    minimo,
    momentos,
    arcos: arcosPorTamano,
    corridas,
    pasan,
    graves: momentos.filter((m) => m.grave).length,
    sinRespuesta: momentos.filter((m) => !m.respondida).length,
    olor: { respondidas: olores.length, fotos: olores.length, aprobada: olores.length > 0 && olores.every((o) => o === "no"), conOlor: olores.filter((o) => o !== "no").length },
    pasa: semillas.length > 0 && pasan >= minimo,
  };
}

/**
 * Los dos controles juntos. La prueba está sana solo si el negativo (la carrera de
 * hoy) reprueba y el positivo (la ruleta) aprueba; si alguno se da vuelta, se
 * rompió la prueba y no el juego.
 */
export function juzgarControles({ negativo, positivo }) {
  const negativoReprueba = negativo.pasa === false;
  const positivoAprueba = positivo.pasa === true;
  const problemas = [];
  if (!negativoReprueba) problemas.push("el control negativo (la carrera de hoy) aprobó: la prueba deja pasar lo que no se entiende");
  if (!positivoAprueba) problemas.push("el control positivo (la ruleta) reprobó: la prueba rechaza lo que se entiende");
  return { sana: problemas.length === 0, negativoReprueba, positivoAprueba, problemas };
}

/* ------------------------------------------------- lo que ve el describidor */

/** Un nombre de archivo que no dice ni el juego ni el momento ni si es foto o tira. */
export const idDeCaptura = ({ juego, semilla, tamano, punto, imagen }) =>
  createHash("sha256").update(`nino|${juego}|${semilla}|${tamano}|${punto}|${imagen}`).digest("hex").slice(0, 10);

/** Las capturas en un orden que no es el del show: el describidor no debe ver la secuencia. */
export const mezclar = (ids) => [...ids].sort((a, b) => createHash("sha256").update(`orden|${a}`).digest("hex").localeCompare(createHash("sha256").update(`orden|${b}`).digest("hex")));

/**
 * El `preguntas.json`: solo ids, imágenes y preguntas, y qué imagen va con cuáles. Ni
 * el juego, ni la verdad, ni quién gana, ni cuál es la última (por eso `olor` se pregunta
 * en todas las fotos). `cuadros` dice si la imagen es una foto (1) o una tira (3).
 */
export function armarPreguntas(capturas) {
  const ids = mezclar(Object.keys(capturas));
  return {
    version: 2,
    prompt: "prompt-nino.md",
    respuesta: "respuestas-modelo.json",
    capturas: ids.map((id) => {
      const { imagen, forma } = capturas[id];
      return {
        id,
        imagen: `capturas/${id}.png`,
        cuadros: imagen === "tira" ? CUADROS_ATRAS.length : 1,
        preguntas: clavesDe(imagen).map((clave) => ({ clave, texto: textoDe(clave, forma) })),
      };
    }),
  };
}

/** Lo que el describidor devuelve por captura: las claves que no se preguntan de esa imagen van vacías. */
export const FORMATO_RESPUESTA = { gano: "", falta: "", paso: "", mirar: "", propia: "", olor: "", quien: "", vi: "" };

/** Una línea por momento para la consola. */
export const lineaDeMomento = (m) => {
  const bien = Object.entries(m.aciertos).map(([k, ok]) => `${k} ${ok ? "ok" : "mal"}${m.decide.includes(k) ? "*" : ""}`).join(" ");
  return `s${m.semilla} ${m.tamano} ${m.punto}: ${m.pasa ? "pasa" : "NO pasa"} (${bien})${m.grave ? " GRAVE: dijo que ya se sabía quién gana" : ""}${m.desempatado ? " (desempate)" : ""}${m.respondida ? "" : " sin respuesta"}`;
};
