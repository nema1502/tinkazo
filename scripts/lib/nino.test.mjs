import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLAVES_FOTO,
  CLAVES_TIRA,
  CUADROS_ATRAS,
  FALTA,
  FORMAS,
  FORMA_DECIDIDA,
  IMAGENES,
  PUNTOS,
  TAMANOS,
  armarPreguntas,
  clavesDe,
  coincideFalta,
  coincideMirar,
  coincideNombre,
  coincidePaso,
  coincidePropia,
  gruposQueSiguen,
  decideEn,
  FORMAS_CON_UN_LUGAR,
  ZONAS_VECINAS,
  textoDe,
  zonaDeMirar,
  horaDeParada,
  horasDeLosCuadros,
  idDeCaptura,
  idDeJuego,
  juzgar,
  juzgarControles,
  juzgarMomento,
  minimoDeCorridas,
  mezclar,
  nombreDelGanador,
  nombresDichos,
  normalizar,
  tipoDePaso,
  valorFalta,
  veredictoGano,
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

  it("«mirar» acepta la zona o una vecina y rechaza la contraria", () => {
    expect(coincideMirar("derecha", "derecha")).toBe(true);
    expect(coincideMirar("derecha y arriba", "arriba")).toBe(true);
    expect(coincideMirar("izquierda", "derecha")).toBe(false);
    expect(coincideMirar("izquierda o derecha", "derecha")).toBe(false);
    expect(coincideMirar("no se ve", "derecha")).toBe(false);
    expect(coincideMirar("centro", "centro")).toBe(true);
  });

  it("«mirar» vale en la zona vecina: el centro toca a las cuatro y cada borde al centro y a los dos de los lados", () => {
    // Centro toca a las cuatro.
    for (const z of ["arriba", "abajo", "izquierda", "derecha"]) {
      expect(coincideMirar("centro", z), `centro con verdad ${z}`).toBe(true);
      expect(coincideMirar(z, "centro"), `${z} con verdad centro`).toBe(true);
    }
    // La derecha toca a centro, arriba y abajo; no a la izquierda.
    expect(ZONAS_VECINAS.derecha).toEqual(["centro", "arriba", "abajo"]);
    for (const z of ["centro", "arriba", "abajo"]) expect(coincideMirar(z, "derecha")).toBe(true);
    expect(coincideMirar("izquierda", "derecha")).toBe(false);
    // Arriba y abajo tocan a izquierda, derecha y centro; no entre sí.
    for (const z of ["centro", "izquierda", "derecha"]) {
      expect(coincideMirar(z, "arriba")).toBe(true);
      expect(coincideMirar(z, "abajo")).toBe(true);
    }
    expect(coincideMirar("abajo", "arriba")).toBe(false);
    expect(coincideMirar("arriba", "abajo")).toBe(false);
    // Decir también la zona contraria sigue sin valer, aunque la otra toque.
    expect(coincideMirar("centro y abajo", "arriba")).toBe(false);
    // «Alrededor» no es una zona: solo la rueda lo acepta, en el juez.
    expect(coincideMirar("alrededor", "centro")).toBe(false);
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
    expect(coincidePaso("salio", "Ana", salio, NOMBRES)).toBe(true);
    expect(coincidePaso("salio", "Carlos", salio, NOMBRES)).toBe(false);
    expect(coincidePaso("salio", "", salio, NOMBRES)).toBe(false);
    expect(coincidePaso("freno", "Ana", salio, NOMBRES)).toBe(false);
    expect(coincidePaso("nada", "", { tipo: "nada", desde: 1 }, NOMBRES)).toBe(true);
    expect(coincidePaso("empezo", "", { tipo: "empezo", desde: 0 }, NOMBRES)).toBe(true);
  });

  it("«gano» entiende sí y no, con tilde o sin ella, y toma la primera si dice las dos", () => {
    expect(veredictoGano("no")).toBe("no");
    expect(veredictoGano("No.")).toBe("no");
    expect(veredictoGano("si")).toBe("si");
    expect(veredictoGano("Sí")).toBe("si");
    expect(veredictoGano("no, todavía")).toBe("no");
    expect(veredictoGano("si, ganó Ana")).toBe("si");
    expect(veredictoGano("no o sí")).toBe("no");
    expect(veredictoGano("quizás")).toBeNull();
    expect(veredictoGano("")).toBeNull();
    expect(nombreDelGanador({ gano: "si", quien: "Ana Vargas" })).toBe("Ana Vargas");
    expect(nombreDelGanador({ gano: "si Ana Vargas", quien: "" })).toBe("ana vargas");
    expect(nombreDelGanador({ gano: "no", quien: "" })).toBe("");
  });

  it("«quiénes siguen» se lee de una lista o de un texto con comas, «y» o rayas", () => {
    expect(nombresDichos("Ana Vargas, Carlos Choque")).toEqual(["Ana Vargas", "Carlos Choque"]);
    expect(nombresDichos("Ana Vargas y Carlos Choque")).toEqual(["Ana Vargas", "Carlos Choque"]);
    expect(nombresDichos(["Ana", "", "Rosa"])).toEqual(["Ana", "Rosa"]);
    expect(nombresDichos("")).toEqual([]);
  });
});

/* ----------------------------------------------- las preguntas propias */

describe("la pregunta propia de cada forma", () => {
  const verdad = { adelante: { quienes: [0, 2, 5], lugar: "centro" } };

  it("carrera, rueda y acumulación: un nombre entre los que están adelante", () => {
    for (const forma of ["carrera", "rueda", "acumulacion"]) {
      expect(coincidePropia(forma, "María Quispe", verdad, NOMBRES), forma).toBe(true);
      expect(coincidePropia(forma, "Carlos Choque", verdad, NOMBRES), forma).toBe(false);
      expect(coincidePropia(forma, "no se ve", verdad, NOMBRES), forma).toBe(false);
    }
  });

  it("de pie: dos nombres distintos, los dos entre quienes siguen", () => {
    expect(coincidePropia("de-pie", "Ana Vargas, Zorro Zoe", verdad, NOMBRES)).toBe(true);
    expect(coincidePropia("de-pie", "Zorro Zoe y María Quispe", verdad, NOMBRES)).toBe(true);
    // Uno solo no alcanza, ni dos veces el mismo, ni uno que ya salió.
    expect(coincidePropia("de-pie", "Ana Vargas", verdad, NOMBRES)).toBe(false);
    expect(coincidePropia("de-pie", "Ana Vargas, Ana Vargas", verdad, NOMBRES)).toBe(false);
    expect(coincidePropia("de-pie", "Ana Vargas, Carlos Choque", verdad, NOMBRES)).toBe(false);
    expect(coincidePropia("de-pie", "no se ve", verdad, NOMBRES)).toBe(false);
  });

  it("de pie con uno solo en pie: alcanza con ese nombre", () => {
    const uno = { adelante: { quienes: [2], lugar: "centro" } };
    expect(coincidePropia("de-pie", "María Quispe", uno, NOMBRES)).toBe(true);
    expect(coincidePropia("de-pie", "Ana Vargas", uno, NOMBRES)).toBe(false);
  });

  describe("donde la pantalla muestra grupos, el nombre del grupo vale", () => {
    // Seis personas en tres grupos, por su puesto en la lista: 0 y 3 son Vicuñas, 1 y 4 Cóndores, 2 y 5 Tojos.
    const GRUPOS = ["Vicuñas", "Cóndores", "Tojos", "Vicuñas", "Cóndores", "Tojos"];
    const pie = (...quienes) => ({ adelante: { quienes, lugar: "centro" } });

    it("dos grupos distintos con alguien en juego aprueban, con las tolerancias de los nombres", () => {
      const v = pie(0, 1, 2);
      expect(coincidePropia("de-pie", "Vicuñas, Cóndores", v, NOMBRES, GRUPOS)).toBe(true);
      expect(coincidePropia("de-pie", "vicuñas y tojos", v, NOMBRES, GRUPOS)).toBe(true);
      expect(coincidePropia("de-pie", "Vicuna, Condor", v, NOMBRES, GRUPOS)).toBe(true);
    });

    it("un grupo y una persona que siguen son dos distintos; dos veces el mismo grupo, no", () => {
      const v = pie(0, 1, 2);
      expect(coincidePropia("de-pie", "Vicuñas, Carlos Choque", v, NOMBRES, GRUPOS)).toBe(true);
      expect(coincidePropia("de-pie", "Vicuñas, Vicuñas", v, NOMBRES, GRUPOS)).toBe(false);
    });

    it("un grupo sin nadie en juego no vale, ni uno que no existe", () => {
      const v = pie(0, 1);
      expect(coincidePropia("de-pie", "Vicuñas, Tojos", v, NOMBRES, GRUPOS)).toBe(false);
      expect(coincidePropia("de-pie", "Cóndores, Tatús", v, NOMBRES, GRUPOS)).toBe(false);
      expect(coincidePropia("de-pie", "no se ve", v, NOMBRES, GRUPOS)).toBe(false);
    });

    it("si todos los que siguen son de un solo grupo, alcanza con decir ese grupo", () => {
      const v = pie(0, 3);
      expect(gruposQueSiguen(v.adelante.quienes, GRUPOS)).toEqual(["Vicuñas"]);
      expect(coincidePropia("de-pie", "Vicuñas", v, NOMBRES, GRUPOS)).toBe(true);
      expect(coincidePropia("de-pie", "Cóndores", v, NOMBRES, GRUPOS)).toBe(false);
      // Con dos grupos en juego, uno solo no alcanza.
      expect(coincidePropia("de-pie", "Vicuñas", pie(0, 1), NOMBRES, GRUPOS)).toBe(false);
    });

    it("un «no se ve» de más no resta cuando el juego declara grupos, y sin grupos sigue restando", () => {
      expect(coincidePropia("de-pie", "Vicuñas, no se ve", pie(0, 3), NOMBRES, GRUPOS)).toBe(true);
      expect(coincidePropia("de-pie", "Vicuñas, no se ve", pie(0, 1), NOMBRES, GRUPOS)).toBe(false);
      expect(coincidePropia("de-pie", "Ana Vargas, no se ve", pie(0, 2, 5), NOMBRES)).toBe(false);
    });

    it("sin grupos declarados, un grupo no vale: el juez de siempre", () => {
      expect(coincidePropia("de-pie", "Vicuñas, Cóndores", pie(0, 1, 2), NOMBRES)).toBe(false);
      expect(coincidePropia("de-pie", "Vicuñas, Cóndores", pie(0, 1, 2), NOMBRES, null)).toBe(false);
      expect(gruposQueSiguen([0, 1], null)).toEqual([]);
    });

    it("las formas que no son de pie no cambian, tengan grupos o no", () => {
      expect(coincidePropia("carrera", "Vicuñas", pie(0), NOMBRES, GRUPOS)).toBe(false);
      expect(coincidePropia("carrera", "Ana Vargas", pie(0), NOMBRES, GRUPOS)).toBe(true);
    });

    it("el momento que llega con grupos usa los de su captura", () => {
      const c = { punto: "p60", forma: "de-pie", verdad: { ...pie(0, 1, 2), progreso: 0.5, progresoVisible: true, paso: { tipo: "salio", quien: 3, desde: 1 } }, nombres: NOMBRES, ganadores: [0], grupos: GRUPOS };
      const foto = { gano: "no", falta: "mitad", propia: "Vicuñas, Cóndores", olor: "no" };
      const tira = { paso: "salio", quien: "", mirar: "centro" };
      expect(juzgarMomento({ foto, tira, c }).aciertos.propia).toBe(true);
      expect(juzgarMomento({ foto, tira, c: { ...c, grupos: undefined } }).aciertos.propia).toBe(false);
    });

    it("la pregunta pide también el nombre del grupo solo en los juegos que declaran grupos", () => {
      const con = armarPreguntas({ x: { imagen: "foto", forma: "de-pie", grupos: GRUPOS } }).capturas[0].preguntas.find((q) => q.clave === "propia").texto;
      const sin = armarPreguntas({ x: { imagen: "foto", forma: "de-pie", grupos: null } }).capturas[0].preguntas.find((q) => q.clave === "propia").texto;
      expect(con).toMatch(/nombre del grupo/);
      expect(sin).not.toMatch(/grupo/);
      expect(con).toMatch(/dos nombres/);
    });
  });

  it("cada forma trae su pregunta, y los juegos decididos usan formas que existen", () => {
    expect(FORMAS).toEqual(["carrera", "de-pie", "rueda", "acumulacion"]);
    const textos = FORMAS.map((f) => armarPreguntas({ x: { imagen: "foto", forma: f } }).capturas[0].preguntas.find((q) => q.clave === "propia").texto);
    expect(new Set(textos).size).toBe(FORMAS.length);
    expect(textos[0]).toMatch(/va adelante/);
    expect(textos[1]).toMatch(/siguen en juego/);
    expect(textos[1]).toMatch(/dos nombres/);
    expect(textos[2]).toMatch(/señalado/);
    expect(textos[3]).toMatch(/tiene más/);
    for (const forma of Object.values(FORMA_DECIDIDA)) expect(FORMAS).toContain(forma);
  });

  it("la forma de cada juego es la que se decidió", () => {
    expect(FORMA_DECIDIDA).toMatchObject({
      race: "carrera", teleferico: "de-pie", rockets: "carrera",
      guajojo: "de-pie", toborochi: "de-pie", pinata: "de-pie", sapo: "de-pie", quien: "de-pie", trueque: "de-pie",
      wheel: "rueda", oruro: "de-pie",
      chovena: "de-pie",
      trompo: "de-pie",
    });
  });
});

/* ------------------------------------------------- una corrida inventada */

const PROGRESO = { p25: 0.25, p60: 0.6, fin: 1 };

/** La verdad de un juego que se mira hacia la derecha, con el ganador `s % 18` en la meta. Con 6 en pie al 60 %. */
function verdadDe(s, punto, forma, extra = {}) {
  const gana = s % 18;
  const siguen = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (i + s) % 18);
  const quienes = punto === "fin" ? [gana] : punto === "p60" && forma === "de-pie" ? siguen.slice(0, 4) : [gana];
  return {
    adelante: { quienes, lugar: "derecha" },
    hacia: "derecha",
    progreso: PROGRESO[punto],
    progresoVisible: true,
    ...extra,
    paso: punto === "fin" ? { tipo: "gano", quien: gana, desde: 20 } : punto === "p25" ? { tipo: "freno", quien: (s + 3) % 18, desde: 5 } : { tipo: "nada", desde: 5 },
  };
}

/** El `verdad.json` de una corrida con `semillas` semillas, los dos tamaños y las dos imágenes de cada parada. */
function armar(semillas, forma = "carrera", extra = {}) {
  const capturas = {};
  for (let s = 1; s <= semillas; s++) {
    for (const tam of TAMANOS) {
      for (const p of PUNTOS) {
        for (const imagen of IMAGENES) {
          const id = idDeCaptura({ juego: "wheel", semilla: s, tamano: tam.id, punto: p.id, imagen });
          capturas[id] = { semilla: s, tamano: tam.id, punto: p.id, imagen, forma, duracion: 20, nombres: NOMBRES, ganadores: [s % 18], verdad: verdadDe(s, p.id, forma, extra) };
        }
      }
    }
  }
  return capturas;
}

/** Lo que contestaría un describidor perfecto, para una imagen. */
function perfecta(c) {
  const v = c.verdad;
  const cerca = Object.entries(FALTA).sort((a, b) => Math.abs(a[1] - v.progreso) - Math.abs(b[1] - v.progreso))[0][0];
  const final = c.punto === "fin";
  const nombres = v.adelante.quienes.map((i) => NOMBRES[i]);
  if (c.imagen === "tira") {
    return { gano: "", falta: "", paso: v.paso.tipo, mirar: zonaDeMirar(v), propia: "", olor: "", quien: v.paso.quien !== undefined ? NOMBRES[v.paso.quien] : "", vi: "tres cuadros" };
  }
  return { gano: final ? "si" : "no", falta: cerca, paso: "", mirar: "", propia: c.forma === "de-pie" ? nombres.slice(0, 2).join(", ") : nombres[0], olor: "no", quien: final ? NOMBRES[v.adelante.quienes[0]] : "", vi: "una foto" };
}

/** Lo que contesta quien no entiende la carrera de hoy: no sabe si ganó alguien, no ve la meta ni cuánto falta. */
const confundida = () => ({ gano: "si", falta: "mucho", paso: "nada", mirar: "izquierda", propia: "no se ve", olor: "no", quien: "", vi: "veinte llamas quietas" });

const contestar = (capturas, f) => Object.fromEntries(Object.entries(capturas).map(([id, c]) => [id, f(c)]));

describe("el juez de un momento", () => {
  const de = (capturas, punto, imagen) => Object.values(capturas).find((c) => c.punto === punto && c.imagen === imagen && c.tamano === "1080");

  it("al 25 % decide solo «gano = no»; lo demás se informa pero no decide, ni «mirar»", () => {
    const capturas = armar(1);
    const c = de(capturas, "p25", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(capturas, "p25", "tira"));
    expect(juzgarMomento({ foto, tira, c })).toMatchObject({ pasa: true, decide: ["gano"] });
    expect(juzgarMomento({ foto: { ...foto, falta: "poco", propia: "no se ve" }, tira: { ...tira, paso: "nada" }, c }).pasa).toBe(true);
    // Al 25 % casi nada se mueve y nadie va adelante: «mirar» se informa y no decide.
    const mal = juzgarMomento({ foto, tira: { ...tira, mirar: "izquierda" }, c });
    expect(mal.pasa).toBe(true);
    expect(mal.aciertos.mirar).toBe(false);
    expect(juzgarMomento({ foto: { ...foto, gano: "quizás" }, tira, c }).pasa).toBe(false);
  });

  it("al 60 % deciden «propia», «mirar» y «falta» a 0,2 o menos si se ve cuánto falta", () => {
    const capturas = armar(1);
    const c = de(capturas, "p60", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(capturas, "p60", "tira"));
    expect(juzgarMomento({ foto, tira, c })).toMatchObject({ pasa: true, decide: ["propia", "mirar", "falta"] });
    expect(juzgarMomento({ foto: { ...foto, falta: "mucho" }, tira, c }).pasa).toBe(false);
    expect(juzgarMomento({ foto: { ...foto, propia: "Zorro Zoe" }, tira, c }).pasa).toBe(false);
    expect(juzgarMomento({ foto, tira: { ...tira, mirar: "izquierda" }, c }).pasa).toBe(false);
    // «paso» se informa, no decide.
    expect(juzgarMomento({ foto, tira: { ...tira, paso: "salio" }, c }).pasa).toBe(true);
  });

  it("donde no se ve cuánto falta (progresoVisible falso), «falta» se informa pero no decide", () => {
    const capturas = armar(1, "rueda", { progresoVisible: false });
    const c = de(capturas, "p60", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(capturas, "p60", "tira"));
    const j = juzgarMomento({ foto: { ...foto, falta: "mucho" }, tira, c });
    expect(j).toMatchObject({ pasa: true, decide: ["propia", "mirar"] });
    expect(j.aciertos.falta).toBe(false);
    expect(juzgarMomento({ foto, tira: { ...tira, mirar: "izquierda" }, c }).pasa).toBe(false);
    // Sin la clave (una verdad vieja), tampoco decide.
    expect(decideEn("p60", {}, "rueda")).toEqual(["propia", "mirar"]);
    expect(decideEn("p60", { progresoVisible: true }, "rueda")).toEqual(["propia", "mirar", "falta"]);
    expect(decideEn("p25", { progresoVisible: true }, "rueda")).toEqual(["gano"]);
    expect(decideEn("fin", { progresoVisible: true }, "rueda")).toEqual(["gano", "paso"]);
  });

  it("«mirar» es una zona de la pantalla: la de quien va adelante o, si nadie, la que declara el juego, o el centro", () => {
    expect(zonaDeMirar({ adelante: { quienes: [3], lugar: "abajo" }, zonaAccion: "arriba" })).toBe("abajo");
    expect(zonaDeMirar({ adelante: { quienes: [], lugar: "abajo" }, zonaAccion: "arriba" })).toBe("arriba");
    expect(zonaDeMirar({ adelante: { quienes: [], lugar: "abajo" } })).toBe("centro");
    // Una dirección de movimiento no es una zona: la verdad es la zona, y el que dice la contraria falla (la vecina vale).
    expect(coincideMirar("arriba", zonaDeMirar({ adelante: { quienes: [1], lugar: "abajo" }, hacia: "derecha" }))).toBe(false);
    expect(coincideMirar("derecha", zonaDeMirar({ adelante: { quienes: [1], lugar: "abajo" }, hacia: "derecha" }))).toBe(true);
  });

  it("en la rueda, que gira, «alrededor» también es mirar bien; en las demás formas no", () => {
    const rueda = armar(1, "rueda", { adelante: { quienes: [3], lugar: "abajo" } });
    const c = de(rueda, "p60", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(rueda, "p60", "tira"));
    expect(juzgarMomento({ foto, tira: { ...tira, mirar: "alrededor" }, c }).aciertos.mirar).toBe(true);
    expect(juzgarMomento({ foto, tira: { ...tira, mirar: "arriba" }, c }).aciertos.mirar).toBe(false);
    const carrera = armar(1, "carrera");
    const cc = de(carrera, "p60", "foto");
    expect(juzgarMomento({ foto: perfecta(cc), tira: { ...perfecta(de(carrera, "p60", "tira")), mirar: "alrededor" }, c: cc }).aciertos.mirar).toBe(false);
  });

  it("«mirar» solo decide en la carrera y en la rueda: en de pie y en acumulación se pregunta y se informa", () => {
    expect(decideEn("p60", { progresoVisible: true }, "carrera")).toEqual(["propia", "mirar", "falta"]);
    expect(decideEn("p60", { progresoVisible: true }, "rueda")).toEqual(["propia", "mirar", "falta"]);
    expect(decideEn("p60", { progresoVisible: true }, "de-pie")).toEqual(["propia", "falta"]);
    expect(decideEn("p60", { progresoVisible: true }, "acumulacion")).toEqual(["propia", "falta"]);
    expect(decideEn("p60", {}, "de-pie")).toEqual(["propia"]);
    expect(decideEn("p25", { progresoVisible: true }, "de-pie")).toEqual(["gano"]);
    expect(decideEn("fin", {}, "de-pie")).toEqual(["gano", "paso"]);
    for (const forma of ["carrera", "rueda"]) expect(FORMAS_CON_UN_LUGAR).toContain(forma);
    const dePie = armar(1, "de-pie");
    const c = de(dePie, "p60", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(dePie, "p60", "tira"));
    // Una tira que dice «izquierda» donde la verdad es «derecha» no hace fallar a un juego de pie…
    const j = juzgarMomento({ foto, tira: { ...tira, mirar: "izquierda" }, c });
    expect(j).toMatchObject({ pasa: true, decide: ["propia", "falta"] });
    expect(j.aciertos.mirar).toBe(false);
    // …y a una carrera, sí.
    const carrera = armar(1, "carrera");
    const cc = de(carrera, "p60", "foto");
    expect(juzgarMomento({ foto: perfecta(cc), tira: { ...perfecta(de(carrera, "p60", "tira")), mirar: "izquierda" }, c: cc }).pasa).toBe(false);
  });

  it("las preguntas piden una zona de la imagen, y el olor pregunta por cosas y no por sensaciones", () => {
    const mirar = textoDe("mirar", "carrera");
    expect(mirar).toContain("en qué parte de la imagen");
    expect(mirar).toContain("alrededor si gira");
    expect(mirar).not.toContain("adónde hay que mirar");
    const olor = textoDe("olor", "carrera");
    for (const cosa of ["dinero", "billetes", "fichas de casino", "cartas", "dados", "tragamonedas", "mesa de apuestas"]) expect(olor).toContain(cosa);
    expect(olor).not.toContain("parece");
    // Un nombre señalado en una tarjeta no es un ganador: una rueda que nombra al gajo no delata nada.
    expect(textoDe("gano", "rueda")).toContain("tiene que verse que ganó");
  });

  it("al final decide «gano = si» con el nombre bien y «paso = gano»", () => {
    const capturas = armar(1);
    const c = de(capturas, "fin", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(capturas, "fin", "tira"));
    expect(juzgarMomento({ foto, tira, c })).toMatchObject({ pasa: true, decide: ["gano", "paso"] });
    expect(juzgarMomento({ foto: { ...foto, gano: "no" }, tira, c }).pasa).toBe(false);
    expect(juzgarMomento({ foto: { ...foto, quien: "Zorro Zoe" }, tira, c }).pasa).toBe(false);
    expect(juzgarMomento({ foto: { ...foto, quien: "" }, tira, c }).pasa).toBe(false);
    expect(juzgarMomento({ foto, tira: { ...tira, paso: "nada" }, c }).pasa).toBe(false);
    // El nombre puede venir pegado al «si».
    expect(juzgarMomento({ foto: { ...foto, gano: `si ${NOMBRES[c.verdad.adelante.quienes[0]]}`, quien: "" }, tira, c }).pasa).toBe(true);
    // Falta, propia y mirar se informan, no deciden.
    expect(juzgarMomento({ foto: { ...foto, falta: "mucho", propia: "no se ve" }, tira, c }).pasa).toBe(true);
  });

  it("un «si» antes del golpe es una falla grave: la presentación delata a quien gana", () => {
    const capturas = armar(1);
    for (const punto of ["p25", "p60"]) {
      const c = de(capturas, punto, "foto");
      const delata = juzgarMomento({ foto: { ...perfecta(c), gano: "si", quien: "Ana Vargas" }, tira: perfecta(de(capturas, punto, "tira")), c });
      expect(delata, punto).toMatchObject({ pasa: false, grave: true });
    }
    const c = de(capturas, "p25", "foto");
    expect(juzgarMomento({ foto: { ...perfecta(c), gano: "no" }, tira: perfecta(de(capturas, "p25", "tira")), c }).grave).toBe(false);
  });

  it("sin respuesta de la foto o de la tira, el momento no pasa y se avisa", () => {
    const capturas = armar(1);
    const c = de(capturas, "p25", "foto");
    expect(juzgarMomento({ foto: perfecta(c), tira: null, c })).toMatchObject({ pasa: false, respondida: false });
    expect(juzgarMomento({ foto: null, tira: null, c })).toMatchObject({ pasa: false, respondida: false });
  });

  it("el juez también anda con una forma de pie: dos nombres al 60 %", () => {
    const capturas = armar(1, "de-pie");
    const c = de(capturas, "p60", "foto");
    const foto = perfecta(c);
    const tira = perfecta(de(capturas, "p60", "tira"));
    expect(foto.propia).toContain(",");
    expect(juzgarMomento({ foto, tira, c }).pasa).toBe(true);
    expect(juzgarMomento({ foto: { ...foto, propia: NOMBRES[c.verdad.adelante.quienes[0]] }, tira, c }).pasa).toBe(false);
  });

  it("el olor sale aparte: no entra en el veredicto del momento", () => {
    const capturas = armar(1);
    const c = de(capturas, "p25", "foto");
    const j = juzgarMomento({ foto: { ...perfecta(c), olor: "si, parece casino" }, tira: perfecta(de(capturas, "p25", "tira")), c });
    expect(j.olor).toBe("si");
    expect(j.pasa).toBe(true);
  });
});

describe("el juez de un juego", () => {
  it("un describidor perfecto lo aprueba, con las cinco formas de contestar", () => {
    for (const forma of FORMAS) {
      const capturas = armar(2, forma);
      const v = juzgar({ capturas, respuestas: contestar(capturas, perfecta) });
      expect(v.momentos, forma).toHaveLength(2 * 2 * 3);
      expect(v.arcos).toHaveLength(2 * 2);
      expect(v.pasa, forma).toBe(true);
      expect(v.pasan).toBe(2);
      expect(v.sinRespuesta).toBe(0);
      expect(v.graves).toBe(0);
      expect(v.olor).toMatchObject({ aprobada: true, conOlor: 0 });
    }
  });

  it("pide siete de cada ocho semillas, y con dos, las dos", () => {
    expect(minimoDeCorridas(8)).toBe(7);
    expect(minimoDeCorridas(16)).toBe(14);
    expect(minimoDeCorridas(2)).toBe(2);
    expect(minimoDeCorridas(1)).toBe(1);
    const capturas = armar(8);
    const rota = (cuantas) => {
      const respuestas = contestar(capturas, perfecta);
      for (const [id, c] of Object.entries(capturas)) if (c.semilla <= cuantas && c.punto === "fin" && c.imagen === "foto") respuestas[id] = confundida();
      return juzgar({ capturas, respuestas });
    };
    expect(rota(0).pasa).toBe(true);
    expect(rota(1)).toMatchObject({ pasa: true, pasan: 7 });
    expect(rota(2)).toMatchObject({ pasa: false, pasan: 6 });
  });

  it("una semilla falla si falla uno solo de sus dos tamaños", () => {
    const capturas = armar(2);
    const respuestas = contestar(capturas, perfecta);
    for (const [id, c] of Object.entries(capturas)) if (c.semilla === 1 && c.tamano === "390" && c.punto === "p60" && c.imagen === "foto") respuestas[id] = confundida();
    const v = juzgar({ capturas, respuestas });
    expect(v.corridas[0]).toMatchObject({ semilla: 1, pasa: false });
    expect(v.corridas[0].falla).toEqual(["390: p60"]);
    expect(v.arcos.filter((a) => a.semilla === 1 && a.pasa).map((a) => a.tamano)).toEqual(["1080"]);
    expect(v.pasan).toBe(1);
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
    const [id, c] = Object.entries(capturas).find(([, x]) => x.punto === "p25" && x.imagen === "foto");
    respuestas[id] = confundida();
    expect(juzgar({ capturas, respuestas }).pasa).toBe(false);
    const arreglada = juzgar({ capturas, respuestas, desempate: { [id]: perfecta(c) } });
    expect(arreglada.pasa).toBe(true);
    expect(arreglada.momentos.filter((m) => m.desempatado)).toHaveLength(1);
    const sigue = juzgar({ capturas, respuestas, desempate: { [id]: confundida() } });
    expect(sigue.pasa).toBe(false);
  });

  it("los «si» antes del golpe se cuentan como graves", () => {
    const capturas = armar(1);
    const respuestas = contestar(capturas, perfecta);
    for (const [id, c] of Object.entries(capturas)) if (c.punto === "p60" && c.imagen === "foto") respuestas[id] = { ...perfecta(c), gano: "si", quien: "Ana Vargas" };
    const v = juzgar({ capturas, respuestas });
    expect(v.graves).toBe(2);
    expect(v.pasa).toBe(false);
  });

  it("el olor: aprobada si todas dicen que no, y cuenta las que huelen", () => {
    const capturas = armar(1);
    const respuestas = contestar(capturas, perfecta);
    const [id, c] = Object.entries(capturas).find(([, x]) => x.punto === "p60" && x.imagen === "foto");
    respuestas[id] = { ...perfecta(c), olor: "sí, parece una tragamonedas" };
    const v = juzgar({ capturas, respuestas });
    expect(v.olor).toMatchObject({ aprobada: false, conOlor: 1 });
    expect(v.pasa).toBe(true);
  });
});

describe("los dos controles", () => {
  it("el negativo: con las respuestas de quien no entiende la carrera, la prueba la reprueba en todas las semillas", () => {
    const capturas = armar(8);
    const v = juzgar({ capturas, respuestas: contestar(capturas, confundida) });
    expect(v.pasa).toBe(false);
    expect(v.pasan).toBe(0);
    expect(v.momentos.filter((m) => m.pasa)).toHaveLength(0);
  });

  it("el positivo: un describidor perfecto aprueba la ruleta", () => {
    const capturas = armar(8, "rueda");
    expect(juzgar({ capturas, respuestas: contestar(capturas, perfecta) }).pasa).toBe(true);
  });

  it("acertar por casualidad un momento suelto no alcanza para aprobar una semilla", () => {
    const capturas = armar(2);
    const respuestas = contestar(capturas, confundida);
    for (const [id, c] of Object.entries(capturas)) if (c.semilla === 1 && c.tamano === "1080" && c.punto === "p25") respuestas[id] = perfecta(c);
    expect(juzgar({ capturas, respuestas }).pasan).toBe(0);
  });

  it("«prueba sana» solo si el negativo reprueba y el positivo aprueba; si uno se da vuelta, se dice cuál", () => {
    const negativo = { pasa: false };
    const positivo = { pasa: true };
    expect(juzgarControles({ negativo, positivo })).toMatchObject({ sana: true, problemas: [] });
    const roto1 = juzgarControles({ negativo: { pasa: true }, positivo });
    expect(roto1.sana).toBe(false);
    expect(roto1.problemas.join(" ")).toMatch(/negativo/);
    const roto2 = juzgarControles({ negativo, positivo: { pasa: false } });
    expect(roto2.sana).toBe(false);
    expect(roto2.problemas.join(" ")).toMatch(/positivo/);
    expect(juzgarControles({ negativo: { pasa: true }, positivo: { pasa: false } }).problemas).toHaveLength(2);
  });
});

describe("lo que ve el describidor", () => {
  const capturas = armar(2);
  const preguntas = armarPreguntas(capturas);
  const entradaDe = (id) => preguntas.capturas.find((c) => c.id === id);

  it("trae todas las imágenes: una foto y una tira por parada", () => {
    expect(preguntas.capturas).toHaveLength(Object.keys(capturas).length);
    expect(preguntas.capturas).toHaveLength(2 * 2 * 3 * 2);
  });

  it("la tira se pide para «paso» y «mirar», y la foto para las otras; ninguna repite", () => {
    for (const [id, c] of Object.entries(capturas)) {
      const claves = entradaDe(id).preguntas.map((q) => q.clave);
      if (c.imagen === "tira") {
        expect(claves, id).toEqual(["paso", "mirar"]);
        expect(entradaDe(id).cuadros).toBe(3);
      } else {
        expect(claves, id).toEqual(["gano", "falta", "propia", "olor"]);
        expect(entradaDe(id).cuadros).toBe(1);
      }
    }
    expect(CLAVES_TIRA).toEqual(["paso", "mirar"]);
    expect(CLAVES_FOTO).toEqual(["gano", "falta", "propia"]);
    expect(clavesDe("tira")).not.toContain("gano");
    expect(clavesDe("foto")).not.toContain("paso");
    expect(clavesDe("foto")).not.toContain("mirar");
  });

  it("la pregunta de la tira dice que son tres cuadros y en qué orden", () => {
    for (const c of preguntas.capturas.filter((x) => x.cuadros === 3)) for (const q of c.preguntas) expect(q.texto).toMatch(/tres cuadros.*izquierda a derecha/);
  });

  it("no dice el juego, ni quién gana, ni cuál es la última, ni el momento, ni el tamaño, ni la forma", () => {
    const texto = JSON.stringify(preguntas);
    for (const n of NOMBRES) expect(texto).not.toContain(n);
    for (const prohibida of ["wheel", "ruleta", "race", "carrera", "rueda", "de-pie", "acumulacion", "p25", "p60", "fin", "1080", "390", "final", "verdad", "progreso", "forma", "foto", "tira", "semilla"]) {
      expect(texto.replace(/"prompt":"prompt-nino.md"/g, ""), prohibida).not.toContain(`"${prohibida}"`);
    }
    for (const c of preguntas.capturas) {
      expect(c.imagen).toMatch(/^capturas\/[0-9a-f]{10}\.png$/);
      expect(Object.keys(c).sort()).toEqual(["cuadros", "id", "imagen", "preguntas"]);
    }
  });

  it("«olor» se pregunta en todas las fotos: si fuera solo en una, esa sería la última", () => {
    const fotos = preguntas.capturas.filter((c) => c.cuadros === 1);
    expect(fotos).toHaveLength(2 * 2 * 3);
    for (const f of fotos) expect(f.preguntas.map((q) => q.clave)).toContain("olor");
    for (const t of preguntas.capturas.filter((c) => c.cuadros === 3)) expect(t.preguntas.map((q) => q.clave)).not.toContain("olor");
  });

  it("los nombres de archivo son únicos y no dejan adivinar el orden del show", () => {
    const ids = preguntas.capturas.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toEqual(Object.keys(capturas));
    expect(mezclar(Object.keys(capturas))).toEqual(ids);
  });

  it("se pide el nombre, no la zona, y la propia cambia con la forma sin decir cuál es", () => {
    for (const c of preguntas.capturas.filter((x) => x.cuadros === 1)) {
      expect(c.preguntas[0].texto).toMatch(/nombre/);
      expect(c.preguntas.find((q) => q.clave === "propia").texto).toMatch(/nombre/);
    }
    const dePie = armarPreguntas(armar(1, "de-pie"));
    const propia = dePie.capturas.find((c) => c.cuadros === 1).preguntas.find((q) => q.clave === "propia").texto;
    expect(propia).toMatch(/siguen en juego/);
    expect(JSON.stringify(dePie)).not.toMatch(/de-pie/);
  });

  it("el prompt fijo trae las cinco preguntas, el formato y los archivos, y no habla de «hacia»", () => {
    const prompt = readFileSync(new URL("../prompt-nino.md", import.meta.url), "utf8");
    for (const clave of ["gano", "falta", "paso", "mirar", "propia", "olor", "quien", "vi"]) expect(prompt).toContain(`"${clave}"`);
    for (const archivo of ["preguntas.json", "respuestas-modelo.json"]) expect(prompt).toContain(archivo);
    for (const tipo of ["empezo", "salio", "adelante", "freno", "casi", "gano", "nada"]) expect(prompt).toContain(tipo);
    expect(prompt).toMatch(/tres cuadros/);
    expect(prompt).not.toMatch(/verdad\.json/);
    expect(prompt).not.toMatch(/hacia/i);
  });
});

describe("los momentos y los nombres", () => {
  it("se para al 25 % y al 60 % de la duración y un segundo después del golpe", () => {
    expect(PUNTOS.map((p) => horaDeParada(p, 20))).toEqual([5, 12, 21]);
  });

  it("los tres cuadros de la tira: 0,6 s antes, 0,3 s antes y el momento", () => {
    expect(CUADROS_ATRAS).toEqual([0.6, 0.3, 0]);
    expect(horasDeLosCuadros(PUNTOS[0], 20).map((x) => +x.toFixed(6))).toEqual([4.4, 4.7, 5]);
    expect(horasDeLosCuadros(PUNTOS[2], 20).map((x) => +x.toFixed(6))).toEqual([20.4, 20.7, 21]);
    // Nunca antes del arranque.
    expect(horasDeLosCuadros(PUNTOS[0], 1).every((x) => x >= 0)).toBe(true);
  });

  it("son dos tamaños; el celular va claro y el proyector oscuro", () => {
    expect(TAMANOS.map((t) => [t.ancho, t.alto, t.tema])).toEqual([[1920, 1080, "dark"], [390, 844, "light"]]);
  });

  it("la ruleta y la carrera se piden por su nombre de uso", () => {
    expect(idDeJuego("ruleta")).toBe("wheel");
    expect(idDeJuego("carrera")).toBe("race");
    expect(idDeJuego("quien")).toBe("quien");
  });
});
