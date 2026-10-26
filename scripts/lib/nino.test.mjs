import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FALTA,
  PUNTOS,
  TAMANOS,
  VARIANTES,
  armarPreguntas,
  coincideFalta,
  coincideHacia,
  coincideLugar,
  coincideNombre,
  coincidePaso,
  horaDeParada,
  idDeCaptura,
  idDeJuego,
  juzgar,
  juzgarFoto,
  minimoDeCorridas,
  mezclar,
  normalizar,
  tipoDePaso,
  valorFalta,
} from "./nino.mjs";

const NOMBRES = [
  "Ana Vargas", "Carlos Choque", "María Quispe", "José Luis Mamani", "Elena Condori", "Zorro Zoe",
  "Miguel Arce", "Sofía Aguilar", "Luis Flores", "Rosa Mendoza", "Pedro Limachi", "Lucía Gutiérrez",
  "Diego Rojas", "Camila Torrez", "Mateo Salvatierra", "Valeria Ríos", "Andrés Paz", "Julia Cruz",
];

describe("el lenguaje del juez", () => {
  it("normaliza sin tildes, mayúsculas ni signos", () => {
    expect(normalizar("  María-José Q.  ")).toBe("maria jose q");
    expect(normalizar("¡Ñandú!")).toBe("nandu");
  });

  it("los nombres coinciden por las cinco primeras letras de cada palabra", () => {
    expect(coincideNombre("maria quispe", "María Quispe")).toBe(true);
    expect(coincideNombre("María Q.", "María Quispe")).toBe(true);
    expect(coincideNombre("Maria", "María Quispe")).toBe(true);
    expect(coincideNombre("Maximiliano_Alex", "Maximiliano Alexander Constantino")).toBe(true);
    expect(coincideNombre("Ana", "Carlos Choque")).toBe(false);
    expect(coincideNombre("Carlos Mamani", "Carlos Choque")).toBe(false);
    expect(coincideNombre("no se ve", "Ana Vargas")).toBe(false);
    expect(coincideNombre("", "Ana Vargas")).toBe(false);
  });

  it("dos personas con el mismo nombre no se distinguen: se numera y el modelo no suele leer el número", () => {
    expect(coincideNombre("Ana Vargas", "Ana Vargas 2")).toBe(true);
  });

  it("las zonas son exactas; se pueden nombrar dos, no todas", () => {
    expect(coincideLugar("arriba", "arriba")).toBe(true);
    expect(coincideLugar("más bien arriba", "arriba")).toBe(true);
    expect(coincideLugar("arriba y centro", "centro")).toBe(true);
    expect(coincideLugar("izquierda", "derecha")).toBe(false);
    expect(coincideLugar("centro", "arriba")).toBe(false);
    expect(coincideLugar("arriba", "centro")).toBe(false);
    expect(coincideLugar("arriba abajo izquierda derecha centro", "arriba")).toBe(false);
    expect(coincideLugar("no se ve", "arriba")).toBe(false);
  });

  it("«hacia» acepta una parte de la diagonal y rechaza el sentido contrario", () => {
    expect(coincideHacia("derecha", "derecha")).toBe(true);
    expect(coincideHacia("derecha y arriba", "arriba")).toBe(true);
    expect(coincideHacia("izquierda", "derecha")).toBe(false);
    expect(coincideHacia("izquierda o derecha", "derecha")).toBe(false);
    expect(coincideHacia("no se ve", "derecha")).toBe(false);
  });

  it("«falta» acierta a 0,2 o menos del progreso", () => {
    expect(valorFalta("mitad")).toBe(0.5);
    expect(valorFalta("Terminó")).toBe(1);
    expect(valorFalta("empieza")).toBe(0);
    expect(valorFalta("no sé")).toBeNull();
    expect(coincideFalta("mitad", 0.45)).toBe(true);
    expect(coincideFalta("mucho", 0.44)).toBe(true);
    expect(coincideFalta("mucho", 0.5)).toBe(false);
    expect(coincideFalta("poco", 0.6)).toBe(true);
    expect(coincideFalta("poco", 0.5)).toBe(false);
    expect(coincideFalta("termino", 1)).toBe(true);
    expect(coincideFalta("", 0.5)).toBe(false);
  });

  it("«paso» se entiende por el tipo y, con letras, por el nombre si lo hay", () => {
    expect(tipoDePaso("se frenó o tropezó")).toBe("freno");
    expect(tipoDePaso("salió alguien")).toBe("salio");
    expect(tipoDePaso("pasó adelante")).toBe("adelante");
    expect(tipoDePaso("nada nuevo")).toBe("nada");
    expect(tipoDePaso("gano")).toBe("gano");
    expect(tipoDePaso("???")).toBeNull();
    const salio = { tipo: "salio", quien: 0, desde: 4 };
    expect(coincidePaso("salio", "Ana", salio, NOMBRES, true)).toBe(true);
    expect(coincidePaso("salio", "Carlos", salio, NOMBRES, true)).toBe(false);
    expect(coincidePaso("salio", "", salio, NOMBRES, true)).toBe(false);
    expect(coincidePaso("salio", "", salio, NOMBRES, false)).toBe(true);
    expect(coincidePaso("freno", "Ana", salio, NOMBRES, true)).toBe(false);
    expect(coincidePaso("nada", "", { tipo: "nada", desde: 1 }, NOMBRES, true)).toBe(true);
    expect(coincidePaso("empezo", "", { tipo: "empezo", desde: 0 }, NOMBRES, true)).toBe(true);
  });
});

/* ------------------------------------------------- una corrida inventada */

const PROGRESO = { p25: 0.25, p60: 0.6, fin: 1 };

/** La verdad de un juego que va hacia la derecha, con el ganador `s % 18` en la meta. */
function verdadDe(s, punto) {
  const gana = s % 18;
  return {
    adelante: { quienes: [gana], lugar: "derecha" },
    hacia: "derecha",
    progreso: PROGRESO[punto],
    paso: punto === "fin" ? { tipo: "gano", quien: gana, desde: 20 } : punto === "p25" ? { tipo: "freno", quien: (s + 3) % 18, desde: 5 } : { tipo: "nada", desde: 5 },
  };
}

/** El `verdad.json` de una corrida con `semillas` semillas, las dos pantallas y las dos edades. */
function armar(semillas) {
  const capturas = {};
  for (let s = 1; s <= semillas; s++) {
    for (const tam of TAMANOS) {
      for (const p of PUNTOS) {
        for (const v of VARIANTES) {
          const id = idDeCaptura({ juego: "wheel", semilla: s, tamano: tam.id, punto: p.id, variante: v.id });
          capturas[id] = { semilla: s, tamano: tam.id, punto: p.id, variante: v.id, nombres: NOMBRES, verdad: verdadDe(s, p.id) };
        }
      }
    }
  }
  return capturas;
}

/** Lo que contestaría un describidor perfecto. */
function perfecta(c) {
  const v = c.verdad;
  const conLetras = c.variante === "letras";
  const cerca = Object.entries(FALTA).sort((a, b) => Math.abs(a[1] - v.progreso) - Math.abs(b[1] - v.progreso))[0][0];
  return {
    adelante: conLetras ? NOMBRES[v.adelante.quienes[0]] : v.adelante.lugar,
    hacia: v.hacia,
    falta: cerca,
    paso: v.paso.tipo,
    quien: conLetras && v.paso.quien !== undefined ? NOMBRES[v.paso.quien] : "",
    vi: "ve todo",
  };
}

/** Lo que contesta quien no entiende la carrera de hoy: no ve la meta ni el sentido y no sabe cuánto falta. */
const confundida = () => ({ adelante: "no se ve", hacia: "izquierda", falta: "mucho", paso: "nada", quien: "", vi: "veinte llamas quietas" });

const contestar = (capturas, f) => Object.fromEntries(Object.entries(capturas).map(([id, c]) => [id, f(c)]));

describe("el juez de una foto", () => {
  const c = Object.values(armar(1)).find((x) => x.punto === "p25" && x.variante === "letras");
  const p = perfecta(c);

  it("pasa con 3 de 4 y no con 2", () => {
    const j = (r) => juzgarFoto({ respuesta: r, verdad: c.verdad, nombres: NOMBRES, conLetras: true, final: false });
    expect(j(p)).toMatchObject({ buenos: 4, total: 4, pasa: true });
    expect(j({ ...p, hacia: "izquierda" })).toMatchObject({ buenos: 3, pasa: true });
    expect(j({ ...p, hacia: "izquierda", falta: "poco" })).toMatchObject({ buenos: 2, pasa: false });
    expect(j(null)).toMatchObject({ buenos: 0, pasa: false, respondida: false });
  });

  it("en la final «hacia» no cuenta y las otras tres son obligatorias", () => {
    const f = Object.values(armar(1)).find((x) => x.punto === "fin" && x.variante === "letras");
    const r = perfecta(f);
    const j = (x) => juzgarFoto({ respuesta: x, verdad: f.verdad, nombres: NOMBRES, conLetras: true, final: true });
    expect(j(r)).toMatchObject({ buenos: 3, total: 3, pasa: true });
    expect(j({ ...r, hacia: "centro" })).toMatchObject({ buenos: 3, total: 3, pasa: true });
    expect(j({ ...r, adelante: "Ana Vargas 99" })).toMatchObject({ pasa: false });
    expect(j({ ...r, falta: "mucho" })).toMatchObject({ buenos: 2, pasa: false });
  });
});

describe("el juez de un juego", () => {
  it("un describidor perfecto lo aprueba, con las dos edades", () => {
    const capturas = armar(2);
    const v = juzgar({ capturas, respuestas: contestar(capturas, perfecta) });
    expect(v.fotos).toHaveLength(2 * 2 * 3 * 2);
    expect(v.pasa).toBe(true);
    expect(v.pasan).toBe(2);
    expect(v.porEdad).toEqual({ letras: 2, sin: 2 });
    expect(v.sinRespuesta).toBe(0);
  });

  it("pide siete de cada ocho corridas", () => {
    expect(minimoDeCorridas(8)).toBe(7);
    expect(minimoDeCorridas(16)).toBe(14);
    expect(minimoDeCorridas(2)).toBe(2);
    expect(minimoDeCorridas(1)).toBe(1);
    const capturas = armar(8);
    const rota = (cuantas) => {
      const respuestas = contestar(capturas, perfecta);
      for (const [id, c] of Object.entries(capturas)) if (c.semilla <= cuantas && c.punto === "fin") respuestas[id] = confundida();
      return juzgar({ capturas, respuestas });
    };
    expect(rota(0).pasa).toBe(true);
    expect(rota(1)).toMatchObject({ pasa: true, pasan: 7 });
    expect(rota(2)).toMatchObject({ pasa: false, pasan: 6 });
  });

  it("una corrida falla si falla una sola edad", () => {
    const capturas = armar(2);
    const respuestas = contestar(capturas, perfecta);
    for (const [id, c] of Object.entries(capturas)) if (c.semilla === 1 && c.variante === "sin" && c.punto === "p60") respuestas[id] = confundida();
    const v = juzgar({ capturas, respuestas });
    expect(v.corridas[0]).toMatchObject({ semilla: 1, pasa: false, edades: { letras: true, sin: false } });
    expect(v.porEdad).toEqual({ letras: 2, sin: 1 });
    expect(v.pasa).toBe(false);
  });

  it("lo que falta por responder cuenta como falla y se avisa", () => {
    const capturas = armar(1);
    const respuestas = contestar(capturas, perfecta);
    delete respuestas[Object.keys(capturas)[0]];
    const v = juzgar({ capturas, respuestas });
    expect(v.sinRespuesta).toBe(1);
    expect(v.pasa).toBe(false);
  });

  it("la que falla se repite con otro describidor, y decide el segundo", () => {
    const capturas = armar(1);
    const respuestas = contestar(capturas, perfecta);
    const [id] = Object.keys(capturas);
    respuestas[id] = confundida();
    expect(juzgar({ capturas, respuestas }).pasa).toBe(false);
    const arreglada = juzgar({ capturas, respuestas, desempate: { [id]: perfecta(capturas[id]) } });
    expect(arreglada.pasa).toBe(true);
    expect(arreglada.fotos.find((f) => f.id === id)).toMatchObject({ desempatada: true, pasa: true });
    const sigue = juzgar({ capturas, respuestas, desempate: { [id]: confundida() } });
    expect(sigue.pasa).toBe(false);
  });
});

describe("el caso de control: la carrera que no se entendía", () => {
  it("con las respuestas de quien no la entiende, la prueba la reprueba en todas las corridas", () => {
    const capturas = armar(8);
    const v = juzgar({ capturas, respuestas: contestar(capturas, confundida) });
    expect(v.pasa).toBe(false);
    expect(v.pasan).toBe(0);
    expect(v.porEdad).toEqual({ letras: 0, sin: 0 });
    // Ni una foto pasa: no ve quién gana, ni el sentido, ni cuánto falta.
    expect(v.fotos.filter((f) => f.pasa)).toHaveLength(0);
  });

  it("si la prueba la aprobara, la prueba está mal: un describidor perfecto la aprueba", () => {
    const capturas = armar(8);
    expect(juzgar({ capturas, respuestas: contestar(capturas, perfecta) }).pasa).toBe(true);
  });

  it("acertar por casualidad una foto suelta no alcanza para aprobar una corrida", () => {
    const capturas = armar(2);
    const respuestas = contestar(capturas, confundida);
    const [id] = Object.keys(capturas);
    respuestas[id] = perfecta(capturas[id]);
    expect(juzgar({ capturas, respuestas }).pasan).toBe(0);
  });
});

describe("lo que ve el describidor", () => {
  const capturas = armar(2);
  const preguntas = armar && armarPreguntas(capturas);

  it("trae todas las capturas con las cuatro preguntas, igual para todas", () => {
    expect(preguntas.capturas).toHaveLength(Object.keys(capturas).length);
    for (const c of preguntas.capturas) expect(c.preguntas.map((q) => q.clave)).toEqual(["adelante", "hacia", "falta", "paso"]);
  });

  it("no dice el juego, ni quién gana, ni cuál foto es la última, ni el momento ni el tamaño", () => {
    const texto = JSON.stringify(preguntas);
    for (const n of NOMBRES) expect(texto).not.toContain(n);
    for (const prohibida of ["wheel", "ruleta", "race", "carrera", "p25", "p60", "fin", "1080", "390", "final", "verdad", "progreso"]) {
      expect(texto.replace(/"prompt":"prompt-nino.md"/g, ""), prohibida).not.toContain(`"${prohibida}"`);
    }
    for (const c of preguntas.capturas) expect(c.imagen).toMatch(/^capturas\/[0-9a-f]{10}\.png$/);
  });

  it("los nombres de archivo son únicos y no dejan adivinar el orden del show", () => {
    const ids = preguntas.capturas.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toEqual(Object.keys(capturas));
    expect(mezclar(Object.keys(capturas))).toEqual(ids);
  });

  it("a la edad de 5 se le pide la zona, no el nombre", () => {
    const sin = preguntas.capturas.find((c) => c.variante === "sin");
    expect(sin.preguntas[0].texto).toMatch(/zona/);
    const con = preguntas.capturas.find((c) => c.variante === "letras");
    expect(con.preguntas[0].texto).toMatch(/nombre/);
  });

  it("el prompt fijo trae las cuatro preguntas, el formato y los archivos", () => {
    const prompt = readFileSync(new URL("../prompt-nino.md", import.meta.url), "utf8");
    for (const clave of ["adelante", "hacia", "falta", "paso", "quien", "vi"]) expect(prompt).toContain(`"${clave}"`);
    for (const archivo of ["preguntas.json", "respuestas-modelo.json"]) expect(prompt).toContain(archivo);
    for (const tipo of ["empezo", "salio", "adelante", "freno", "casi", "gano", "nada"]) expect(prompt).toContain(tipo);
    expect(prompt).not.toMatch(/verdad\.json/);
  });
});

describe("los momentos y los nombres", () => {
  it("se para al 25 % y al 60 % de la duración y un segundo después del golpe", () => {
    expect(PUNTOS.map((p) => horaDeParada(p, 20))).toEqual([5, 12, 21]);
  });

  it("son dos tamaños y dos edades; el celular va claro y el proyector oscuro", () => {
    expect(TAMANOS.map((t) => [t.ancho, t.alto, t.tema])).toEqual([[1920, 1080, "dark"], [390, 844, "light"]]);
    expect(VARIANTES.map((v) => v.edad)).toEqual([9, 5]);
  });

  it("la ruleta y la carrera se piden por su nombre de uso", () => {
    expect(idDeJuego("ruleta")).toBe("wheel");
    expect(idDeJuego("carrera")).toBe("race");
    expect(idDeJuego("quien")).toBe("quien");
  });
});
