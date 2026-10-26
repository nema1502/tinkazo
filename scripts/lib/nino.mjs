/**
 * La prueba del niño, sin Chrome: qué se pregunta, cómo se arma lo que ve el
 * describidor y cómo juzga el juez. Lo usan `scripts/audit-nino.mjs` y sus pruebas.
 *
 * La regla (la del niño, en `docs/juegos.md`): cualquier cuadro del
 * juego, sin leer, dice quién va adelante, hacia dónde van, cuánto falta y qué
 * acaba de pasar. El auditor saca fotos sin subtítulo al 25 % y al 60 % del show y
 * un segundo después del golpe, con letras (la edad de 9) y sin ninguna (la de 5),
 * y guarda aparte la verdad del plan (`window.__nino.verdad()`). Un modelo que no
 * ve más que la foto las describe; el juez compara. Acá no se llama a ninguna API.
 *
 * Las tolerancias son las de la regla: nombres sin tildes ni mayúsculas y con las
 * cinco primeras letras de cada palabra; sin letras, por zona; «hacia» igual, sin
 * decir también el sentido contrario; «falta» a 0,2 o menos del progreso; «paso»
 * por tipo, y con nombre si lo hay. Una foto pasa con 3 de 4; en la final no cuenta
 * «hacia» y las otras tres son obligatorias. Una corrida (una semilla) pasa si pasan
 * todas sus fotos en las dos edades; un juego pasa con 7 de cada 8 corridas.
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

/** Con letras es la edad de 9 (lee nombres); sin letras, la de 5 (no lee nada). */
export const VARIANTES = [
  { id: "letras", edad: 9, sinLetras: false },
  { id: "sin", edad: 5, sinLetras: true },
];

/** A qué hora del juego se para para cada punto, en segundos. */
export const horaDeParada = (punto, duracion) => (punto.fraccion !== undefined ? punto.fraccion * duracion : duracion + punto.despues);

/** Los juegos por su nombre de uso y por su id en el sitio. */
export const ALIAS = { ruleta: "wheel", carrera: "race" };
export const idDeJuego = (nombre) => ALIAS[nombre] ?? nombre;

/** 64 hex sembrados con el número de la corrida: la misma semilla da la misma ronda. */
export const semillaDe = (i) => createHash("sha256").update(`semilla-nino-${i}`).digest("hex");

/* --------------------------------------------------------- las preguntas */

export const CLAVES = ["adelante", "hacia", "falta", "paso"];
export const LUGARES = ["arriba", "abajo", "izquierda", "derecha", "centro"];
export const DIRECCIONES = [...LUGARES, "alrededor"];
export const TIPOS_PASO = ["empezo", "salio", "adelante", "freno", "casi", "gano", "nada"];
/** Cuánto falta, en palabras, y a qué progreso (0 a 1) corresponde cada una. */
export const FALTA = { empieza: 0, mucho: 0.25, mitad: 0.5, poco: 0.75, termino: 1 };
export const TOLERANCIA_FALTA = 0.2;

/** Lo mismo para los diez juegos, con letras y sin letras. El prompt fijo (`prompt-nino.md`) las repite. */
export const TEXTO_PREGUNTAS = {
  letras: {
    adelante: "¿Quién va ganando? Escribí su nombre tal como se lee; si no se lee, \"no se ve\".",
    hacia: "¿Hacia dónde van, o adónde hay que mirar para saber quién gana? Una de: derecha, izquierda, arriba, abajo, centro, alrededor.",
    falta: "¿Cuánto falta para que termine? Una de: empieza, mucho, mitad, poco, termino.",
    paso: "¿Qué acaba de pasar? Una de: empezo, salio (salió alguien), adelante (alguien pasó adelante), freno (alguien se frenó o tropezó), casi (casi sale y volvió), gano, nada (nada nuevo). En \"quien\", el nombre de la persona si se lee.",
  },
  sin: {
    adelante: "¿Quién va ganando? No hay letras: decí en qué zona de la pantalla está. Una de: arriba, abajo, izquierda, derecha, centro.",
    hacia: "¿Hacia dónde van, o adónde hay que mirar para saber quién gana? Una de: derecha, izquierda, arriba, abajo, centro, alrededor.",
    falta: "¿Cuánto falta para que termine? Una de: empieza, mucho, mitad, poco, termino.",
    paso: "¿Qué acaba de pasar? Una de: empezo, salio (salió alguien), adelante (alguien pasó adelante), freno (alguien se frenó o tropezó), casi (casi sale y volvió), gano, nada (nada nuevo). \"quien\" va vacío: no hay nombres.",
  },
};

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

/**
 * En qué zona dijo el modelo que está: la exacta. Puede nombrar dos (cuando está
 * en el borde de una y de otra), no más: decir todas las zonas no es contestar.
 * La verdad no sale del plan: la mide el juego donde cae en la pantalla.
 */
export function coincideLugar(modelo, verdad) {
  const zonas = LUGARES.filter((z) => palabras(modelo).includes(z));
  return zonas.length >= 1 && zonas.length <= 2 && zonas.includes(verdad);
}

const OPUESTO = { arriba: "abajo", abajo: "arriba", izquierda: "derecha", derecha: "izquierda" };

/** «Hacia» igual, o una parte de la diagonal; si dice también el sentido contrario, no. */
export function coincideHacia(modelo, verdad) {
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
export function coincidePaso(modeloPaso, modeloQuien, verdad, nombres, conLetras) {
  if (tipoDePaso(modeloPaso) !== verdad.tipo) return false;
  const pideNombre = conLetras && verdad.quien !== undefined && verdad.tipo !== "nada" && verdad.tipo !== "empezo";
  return pideNombre ? coincideNombre(modeloQuien, nombres[verdad.quien] ?? "") : true;
}

/** ¿Está bien lo de «adelante»? Con letras, por el nombre de cualquiera de los que van adelante; sin letras, por la zona. */
export function coincideAdelante(modelo, verdad, nombres, conLetras) {
  if (conLetras) return verdad.adelante.quienes.some((i) => coincideNombre(modelo, nombres[i] ?? ""));
  return coincideLugar(modelo, verdad.adelante.lugar);
}

/* ------------------------------------------------------------- el juez */

/**
 * Una foto: cuántas de las cuatro contestó bien el modelo. Pasa con 3; en la
 * final «hacia» no cuenta y las otras tres son obligatorias.
 */
export function juzgarFoto({ respuesta, verdad, nombres, conLetras, final }) {
  const r = respuesta ?? {};
  const aciertos = {
    adelante: coincideAdelante(r.adelante, verdad, nombres, conLetras),
    hacia: coincideHacia(r.hacia, verdad.hacia),
    falta: coincideFalta(r.falta, verdad.progreso),
    paso: coincidePaso(r.paso, r.quien, verdad.paso, nombres, conLetras),
  };
  const contadas = final ? CLAVES.filter((k) => k !== "hacia") : CLAVES;
  const buenos = contadas.filter((k) => aciertos[k]).length;
  return { aciertos, buenos, total: contadas.length, pasa: buenos >= 3, respondida: respuesta != null };
}

/** Cuántas corridas hay que aprobar: siete de cada ocho. */
export const minimoDeCorridas = (semillas) => semillas - Math.floor(semillas / 8);

/**
 * El veredicto. `capturas` es el `verdad.json` (id → { semilla, tamano, punto, variante,
 * verdad, nombres }), `respuestas` lo que escribió el describidor (id → respuesta) y
 * `desempate` lo del segundo describidor para las que fallaron: si está, decide él.
 */
export function juzgar({ capturas, respuestas = {}, desempate = {} }) {
  const fotos = Object.entries(capturas).map(([id, c]) => {
    const conLetras = c.variante === "letras";
    const final = c.punto === "fin";
    const base = { verdad: c.verdad, nombres: c.nombres, conLetras, final };
    let j = juzgarFoto({ ...base, respuesta: respuestas[id] });
    let desempatada = false;
    if (!j.pasa && desempate[id] != null) {
      j = juzgarFoto({ ...base, respuesta: desempate[id] });
      desempatada = true;
    }
    return { id, semilla: c.semilla, tamano: c.tamano, punto: c.punto, variante: c.variante, desempatada, ...j };
  });
  const semillas = [...new Set(fotos.map((f) => f.semilla))].sort((a, b) => a - b);
  const variantes = [...new Set(fotos.map((f) => f.variante))];
  const corridas = semillas.map((s) => {
    const de = fotos.filter((f) => f.semilla === s);
    const edades = Object.fromEntries(variantes.map((v) => [v, de.filter((f) => f.variante === v).every((f) => f.pasa)]));
    return { semilla: s, pasa: Object.values(edades).every(Boolean), edades, fotos: de.length, falla: de.filter((f) => !f.pasa).map((f) => f.id) };
  });
  const minimo = minimoDeCorridas(semillas.length);
  const porEdad = Object.fromEntries(variantes.map((v) => [v, corridas.filter((c) => c.edades[v]).length]));
  const pasan = corridas.filter((c) => c.pasa).length;
  return {
    semillas: semillas.length,
    minimo,
    fotos,
    corridas,
    porEdad,
    pasan,
    sinRespuesta: fotos.filter((f) => !f.respondida).length,
    pasa: semillas.length > 0 && pasan >= minimo,
  };
}

/* ------------------------------------------------- lo que ve el describidor */

/** Un nombre de archivo que no dice ni el juego ni el momento. */
export const idDeCaptura = ({ juego, semilla, tamano, punto, variante }) =>
  createHash("sha256").update(`nino|${juego}|${semilla}|${tamano}|${punto}|${variante}`).digest("hex").slice(0, 10);

/** Las capturas en un orden que no es el del show: el describidor no debe ver la secuencia. */
export const mezclar = (ids) => [...ids].sort((a, b) => createHash("sha256").update(`orden|${a}`).digest("hex").localeCompare(createHash("sha256").update(`orden|${b}`).digest("hex")));

/** El `preguntas.json`: solo ids, fotos y preguntas. Ni el juego, ni la verdad, ni quién gana, ni cuál es la última. */
export function armarPreguntas(capturas) {
  const ids = mezclar(Object.keys(capturas));
  return {
    version: 1,
    prompt: "prompt-nino.md",
    respuesta: "respuestas-modelo.json",
    capturas: ids.map((id) => {
      const variante = capturas[id].variante;
      return {
        id,
        imagen: `capturas/${id}.png`,
        variante,
        preguntas: CLAVES.map((clave) => ({ clave, texto: TEXTO_PREGUNTAS[variante][clave] })),
      };
    }),
  };
}

/** Lo que el describidor devuelve por captura. */
export const FORMATO_RESPUESTA = { adelante: "", hacia: "", falta: "", paso: "", quien: "", vi: "" };

/** Una línea por foto para la consola. */
export const lineaDeFoto = (f) => `${f.id} s${f.semilla} ${f.tamano} ${f.punto} ${f.variante}: ${f.buenos}/${f.total}${f.pasa ? "" : " ✗"}${f.desempatada ? " (desempate)" : ""}${f.respondida ? "" : " sin respuesta"}`;
