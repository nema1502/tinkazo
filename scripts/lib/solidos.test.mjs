import { test } from "vitest";
import assert from "node:assert/strict";
import { alturasSeCruzan, areaComun, contarCruces, encimado, encimadoCuerpos, medirVolcado } from "./solidos.mjs";
import * as carrera from "./solidos-carrera.mjs";
import { compararFijos, medirVolcadoCarrera } from "./solidos-navegador.mjs";

/**
 * La geometría del auditor de sólidos, con casos a mano: la elipse contra la caja, las alturas que se cruzan o no, el poste fino que da
 * cerca del 100 % y los permisos (el salto que no puede tocar y el choque que puede llegar a su máximo).
 */

const cuerpo = (mas = {}) => ({ x: 0, y: 0, atras: 10, adelante: 10, medio: 5, z0: 0, z1: 100, ...mas });

test("la caja contra la caja: el área común exacta", () => {
  assert.equal(areaComun(cuerpo(), { forma: "caja", x0: 5, x1: 25, y0: 0, y1: 10 }), 5 * 5);
  assert.equal(areaComun(cuerpo(), { forma: "caja", x0: 30, x1: 40, y0: 0, y1: 10 }), 0);
});

test("la elipse dentro de la caja da su área entera, y el encimado va por el más chico", () => {
  const s = { forma: "elipse", x: 0, y: 0, a: 4, b: 2, giro: 0, z0: 0, z1: 50 };
  assert.ok(Math.abs(areaComun(cuerpo(), s) - Math.PI * 8) < 0.05);
  // La elipse es más chica que el cuerpo: si está adentro, el encimado es 1.
  assert.ok(encimado(cuerpo(), s) > 0.99);
});

test("la elipse girada: la misma área dentro de una caja grande", () => {
  const grande = cuerpo({ atras: 50, adelante: 50, medio: 50 });
  const s = { forma: "elipse", x: 0, y: 0, a: 20, b: 5, giro: 0.7, z0: 0, z1: 50 };
  assert.ok(Math.abs(areaComun(grande, s) - Math.PI * 100) < 1.5);
});

test("el poste fino por el medio del cuerpo da cerca del 100 por ciento", () => {
  const poste = { forma: "caja", x0: -1, x1: 1, y0: -1, y1: 1, z0: 0, z1: 80 };
  assert.ok(encimado(cuerpo(), poste) > 0.99);
});

test("si las alturas no se cruzan, no hay encimado: el salto pasa por encima", () => {
  const roca = { forma: "elipse", x: 0, y: 0, a: 8, b: 4, giro: 0, z0: 0, z1: 30 };
  assert.equal(encimado(cuerpo({ z0: 30, z1: 130 }), roca), 0);
  assert.ok(encimado(cuerpo({ z0: 29, z1: 129 }), roca) > 0.9);
  assert.equal(alturasSeCruzan(30, 130, 0, 30), false);
  assert.equal(alturasSeCruzan(29, 129, 0, 30), true);
});

test("dos cuerpos: el encimado va por el más chico y respeta las alturas", () => {
  const a = cuerpo(), b = cuerpo({ x: 10 });
  assert.ok(Math.abs(encimadoCuerpos(a, b) - 0.5) < 1e-9);
  assert.equal(encimadoCuerpos(a, cuerpo({ x: 10, z0: 200, z1: 300 })), 0);
});

test("los cruces: un par que cambia de lado cuenta uno, y el mismo par sin cambiar no cuenta", () => {
  // Dos cuerpos que se dan vuelta entre los dos instantes: un cruce.
  assert.equal(contarCruces([0, 10], [10, 0]), 1);
  // Su espejo: los dos se mueven, pero el orden de lado queda como estaba.
  assert.equal(contarCruces([0, 10], [2, 12]), 0);
  // Tres cuerpos dados vuelta del todo: los tres pares cambiaron de lado.
  assert.equal(contarCruces([0, 10, 20], [20, 10, 0]), 3);
  // Dos a la misma altura en un instante no tienen un orden que se dé vuelta.
  assert.equal(contarCruces([0, 0], [5, -5]), 0);
});

test("los permisos: el salto no puede tocar y el choque tiene su máximo", () => {
  const v = {
    juego: "prueba", motor: "ninguno", plano: "mundo-2d-px",
    fijos: [{ id: "p1", tipo: "piedrita", forma: "elipse", x: 0, y: 0, a: 5, b: 3, giro: 0, z0: 0, z1: 20 }],
    cuadros: [
      { t: 1, cuerpos: [[7, 0, 0, 10, 10, 5, 0, 100, "corre"]], moviles: [] },
      { t: 2, cuerpos: [[7, 100, 0, 10, 10, 5, 0, 100, "corre"]], moviles: [] },
    ],
    permitidos: [{ cuerpo: 7, solido: "p1", desde: 0.5, hasta: 1.5, tipo: "salto" }],
    pares: ["cuerpo-fijo"],
    done: true,
  };
  const m = medirVolcado(v);
  // En t=1 el cuerpo está sobre la piedrita con permiso de salto: es una violación del permiso, no un encimado común.
  assert.equal(m.violacionesPermiso, 1);
  assert.ok(m.peorPermiso > 0.9);
  assert.equal(m.filas.get("cuerpo-piedrita")?.cuadros ?? 0, 0);
});

/**
 * El adaptador de la carrera con una pista armada a mano: la escena de mentira pone a cada llama donde dice `donde(p, i)` en el
 * cuadro `i` (a 60 por segundo desde la salida, en t = 0), con el dibujo en escala 1, así que cada cuerpo mide 74 de largo (36 atrás
 * y 38 adelante), 26 de ancho y 100 de alto. Sin carriles, sin tandas, sin vallas y sin echadas en la lista del portón: solo lo que
 * cada caso pone.
 */
function rondaDeMano({ gente, lanes = [], cae = new Map(), cuadros, tAbre = 100, donde, rocas = [], piedras = null, piedritas = null }) {
  const M = {
    CUERPO: 1, ENSANCHE: 1, RECTA: 1, LLAMA_HOCICO: 0, TAM3D: 1, ZC: 1, CARRIL_DURA: 1, altoPostePorton: () => 1,
    // Las piedras del cerro de mentira: la vista devuelve lo que diga `piedras(t)`, como la de la escena.
    ...(piedras ? { crearVistaObstaculos: () => ({ efectos: (t) => piedras(t) }) } : {}),
    // Las piedritas de mentira, sin descarte, y las patas de cada llama: de 20 atrás a 19 adelante y 13 de cada costado.
    ...(piedritas ? { sembrarPiedritas: () => piedritas, descartarPiedritas: (c) => c, cajaDePatas: (x, y) => ({ x0: x - 20, x1: x + 19, y0: y - 13, y1: y + 13 }) } : {}),
    formaDelGrupo: () => ({ forma: { esc: 1, filas: 1, y0: -1000, y1: 1000, yPie: () => 0 }, filaDeLugar: null }),
    carrilesDe: () => ({ y0: 0, y1: 0, n: 0, altoFila: 1, esc: 1 }),
    rocasDeHoy: () => rocas,
    crearTrayectorias: () => ({
      muestras: () => new Map(gente.map((p) => {
        const a = new Float64Array(cuadros * 4);
        for (let i = 0; i < cuadros; i++) {
          const { x, y, alza = 0 } = donde(p, i);
          a.set([x, y, alza, 1], i * 4);
        }
        return [p, a];
      })),
      posicion: () => ({ x: 0, y: 0, esc: 1 }),
      lugarEnGrupo: () => ({ x: 0, y: 0 }),
    }),
  };
  const d = {
    gente, lanes, tSalida: 0, tCrown: (cuadros - 1) / 60, tAbre, tCarriles: 1e9, tDeQ: () => 1e9, semillaRocas: piedritas ? 1 : undefined,
    tiempos: { cae, echadas: [] }, final: { obstaculos: [] }, tramos: [], tandas: [], distAbre: 0, dist: () => 0,
    orden: { entrePuestos: 0 },
  };
  return { M, d };
}

test("dos echadas encimadas un 20 % cuentan en echada-echada, y en ninguna otra fila", () => {
  // Las dos descansan desde la salida, en la misma x, corridas 20,8 de lado: de los 26 de ancho comparten 5,2, un 20 %.
  const cuerpoA = { x: 0, y: 0, atras: 36, adelante: 38, medio: 13, z0: 0, z1: 100 };
  assert.ok(Math.abs(encimadoCuerpos(cuerpoA, { ...cuerpoA, y: 20.8 }) - 0.2) < 1e-9);
  const { M, d } = rondaDeMano({ gente: [1, 2], cae: new Map([[1, 0], [2, 0]]), cuadros: 30, donde: (p) => ({ x: 0, y: p === 1 ? 0 : 20.8 }) });
  const filas = carrera.medirRondaSolidos(M, d, 1000, 600);
  assert.equal(filas["echada-echada"].cuadros, 30);
  assert.ok(Math.abs(filas["echada-echada"].peor - 0.2) < 1e-9);
  assert.equal(filas["echada-echada"].episodios, 1);
  for (const clave of ["llama-echada", "llama-llama en el grupo", "llama-llama al pasar a los carriles"]) assert.equal(filas[clave].cuadros, 0, clave);
});

test("echada-echada mira solo mientras dura el grupo, y la que corre contra la echada sigue en llama-echada", () => {
  // La 1 y la 2 descansan encimadas; la recta se abre a los 20 cuadros. La 3 corre por encima de la 1 todo el tiempo.
  const { M, d } = rondaDeMano({
    gente: [1, 2, 3], cae: new Map([[1, 0], [2, 0]]), cuadros: 30, tAbre: 20 / 60,
    donde: (p) => ({ x: 0, y: p === 2 ? 20.8 : 0 }),
  });
  const filas = carrera.medirRondaSolidos(M, d, 1000, 600);
  assert.equal(filas["echada-echada"].cuadros, 20);
  // llama-echada no cambia: la 3 contra la 1 y contra la 2, en los 30 cuadros (esa fila no se corta en la recta).
  assert.equal(filas["llama-echada"].cuadros, 60);
  assert.equal(filas["llama-echada"].episodios, 2);
});

test("un par encimado 90 cuadros seguidos es un episodio, y si se separa y vuelve, son dos", () => {
  // Dos que corren en la misma fila: juntas de 10 a 99, separadas el resto.
  const juntas = (i) => i >= 10 && i < 100;
  const una = rondaDeMano({ gente: [1, 2], cuadros: 150, donde: (p, i) => ({ x: p === 1 || juntas(i) ? 0 : 500, y: 0 }) });
  const f1 = carrera.medirRondaSolidos(una.M, una.d, 1000, 600)["llama-llama en el grupo"];
  assert.equal(f1.cuadros, 90);
  assert.equal(f1.episodios, 1);
  assert.equal(f1.largo, 90);
  // Las mismas, separadas en el cuadro 50: dos episodios, el más largo de 50 cuadros.
  const dos = rondaDeMano({ gente: [1, 2], cuadros: 150, donde: (p, i) => ({ x: p === 1 || (juntas(i) && i !== 50) ? 0 : 500, y: 0 }) });
  const f2 = carrera.medirRondaSolidos(dos.M, dos.d, 1000, 600)["llama-llama en el grupo"];
  assert.equal(f2.cuadros, 89);
  assert.equal(f2.episodios, 2);
  assert.equal(f2.largo, 49);
  // El que sigue abierto al terminar la ronda cuenta, con lo que duró hasta el último cuadro.
  const abierta = rondaDeMano({ gente: [1, 2], cuadros: 150, donde: (p, i) => ({ x: p === 1 || i >= 120 ? 0 : 500, y: 0 }) });
  const f3 = carrera.medirRondaSolidos(abierta.M, abierta.d, 1000, 600)["llama-llama en el grupo"];
  assert.equal(f3.episodios, 1);
  assert.equal(f3.largo, 30);
});

test("las rocas se miran toda la carrera: la echada quieta y la que todavía cruza el pedregal después de abrirse la recta", () => {
  // Se echa en la salida y queda quieta sobre una roca: a 1,2 s ya no se desliza, y sigue encima también después de que se abre la recta
  // (3 s): queda echada en el campo. Antes se dejaba de mirar al abrirse la recta, y el auditor con navegador encontró a una finalista
  // que todavía cruzaba el pedregal mientras pasaba a su carril, dentro de una roca.
  const roca = { tipo: "roca", x: 0, y: 0, a: 20, b: 8, giro: 0, alto: 30 };
  const { M, d } = rondaDeMano({ gente: [1], cae: new Map([[1, 0]]), cuadros: 240, tAbre: 3, donde: () => ({ x: 0, y: 0 }), rocas: [roca] });
  const filas = carrera.medirRondaSolidos(M, d, 1000, 600);
  assert.equal(filas["llama-roca"].cuadros, 240);
  assert.equal(filas["llama-roca"].episodios, 1);
  // Una que corre y pasa por encima de la roca recién después de abrirse la recta (a los 3,5 s).
  const tarde = rondaDeMano({ gente: [1], cuadros: 300, tAbre: 3, donde: (_, i) => ({ x: i < 210 ? -500 : 0, y: 0 }), rocas: [roca] });
  assert.equal(carrera.medirRondaSolidos(tarde.M, tarde.d, 1000, 600)["llama-roca"].cuadros, 90);
});

test("una piedra del cerro sobre una finalista cuenta en su fila, con la huella del motor que se mide", () => {
  // La finalista 1 corre quieta en x = 0 desde que se abre la recta; una piedra de radio 10 en el 3D (y 5 en el 2D) pica en x = 45 los
  // primeros 30 cuadros. La huella del 3D llega a 38 adelante: la piedra le entra 3 de sus 10 (un 9 % de su área). La del 2D llega a
  // 40 y la piedra del 2D empieza justo ahí: no se tocan.
  const piedra = { visible: true, x: 45, y: 0, yPiso: 0, alto: 10, r: 10, r2: 5, k: 1, cae: 1, rueda: 0.2, rebote: 0 };
  const piedras = (t) => (t < 30 / 60 - 1e-9 ? [{ tipo: "piedras", s: 0.5, x: 0, y: 0, y1: 0, ancho: 0, lado: 0, id: 0, piedras: [piedra, { ...piedra, visible: false }] }] : []);
  const ronda = () => rondaDeMano({ gente: [1], lanes: [1], cuadros: 60, tAbre: 0, donde: () => ({ x: 0, y: 0 }), piedras });
  const tres = carrera.medirRondaSolidos(ronda().M, ronda().d, 1000, 600)["llama-piedra del cerro"];
  assert.equal(tres.cuadros, 30);
  assert.equal(tres.episodios, 1);
  assert.ok(tres.peor > 0.05 && tres.peor < 0.15, `peor ${tres.peor}`);
  const dos = carrera.medirRondaSolidos(ronda().M, ronda().d, 1000, 600, 0, null, { motor: "2d" })["llama-piedra del cerro"];
  assert.equal(dos.cuadros, 0);
  // La huella del 2D también vale para los cuerpos: dos llamas a 60 una de otra se pisan un 19 % en el 3D (de 36 atrás a 38 adelante)
  // y un 9 % en el 2D (de 26 atrás a 40 adelante), que no llega al 10 %.
  const juntas = () => rondaDeMano({ gente: [1, 2], cuadros: 10, donde: (p) => ({ x: p === 1 ? 0 : 60, y: 0 }) });
  assert.equal(carrera.medirRondaSolidos(juntas().M, juntas().d, 1000, 600)["llama-llama en el grupo"].cuadros, 10);
  assert.equal(carrera.medirRondaSolidos(juntas().M, juntas().d, 1000, 600, 0, null, { motor: "2d" })["llama-llama en el grupo"].cuadros, 0);
});

test("la piedrita es un salto: las patas que la tocan sin ir por encima cuentan desde el primer roce, y el brinco que la pasa no", () => {
  // Una piedrita de 6 por 4 y 10 de alto en x = 100. La llama la cruza de x = 40 a x = 160 en 60 cuadros, a 2 por cuadro: sus patas (de 20
  // atrás a 19 adelante) la tocan con el origen entre x = 75 y x = 126, sin los bordes: de x = 76 a x = 124, 25 cuadros.
  const piedrita = { tipo: "piedrita", x: 100, y: 0, a: 6, b: 4, giro: 0, alto: 10, fila: 0 };
  const pasa = (alza) => rondaDeMano({ gente: [1], cuadros: 60, donde: (_, i) => ({ x: 40 + 2 * i, y: 0, alza: alza(40 + 2 * i) }), piedritas: [piedrita] });
  const pisa = pasa(() => 0);
  const f1 = carrera.medirRondaSolidos(pisa.M, pisa.d, 1000, 600)["llama-piedrita"];
  assert.equal(f1.cuadros, 25);
  assert.equal(f1.episodios, 1);
  // El brinco que la pasa con las patas a 10 o más mientras están encima: nada.
  const salta = pasa((x) => (x > 70 && x < 130 ? 12 : 0));
  assert.equal(carrera.medirRondaSolidos(salta.M, salta.d, 1000, 600)["llama-piedrita"].cuadros, 0);
  // Un brinco corto, que baja antes de terminar de pasarla: cuenta el roce, aunque sea apenas.
  const corto = pasa((x) => (x > 70 && x < 120 ? 12 : 0));
  assert.ok(carrera.medirRondaSolidos(corto.M, corto.d, 1000, 600)["llama-piedrita"].cuadros > 0);
});

test("con navegador: lo dibujado contra lo calculado, y lo que atraviesa en lo dibujado", () => {
  // Un 3D de mentira en escala 1: la huella de la llama va de 36 atrás a 38 adelante, 13 de cada costado y 100 de alto.
  const M = { TAM3D: 1, ZC: 1, TROPIEZO_CABEZA: 0.75, cajaDePatas: (x, y) => ({ x0: x - 20, x1: x + 19, y0: y - 13, y1: y + 13 }) };
  const roca = { tipo: "roca", x: 100, y: 0, a: 20, b: 10, giro: 0, z0: 0, z1: 30 };
  const piedrita = { tipo: "piedrita", x: 300, y: 0, a: 6, b: 4, giro: 0, z0: 0, z1: 10 };
  const cuadros = [
    { t: 1, llamas: [[1, 100, 0, 0, 1, null]], moviles: [] },
    { t: 2, llamas: [[1, 300, 0, 12, 1, "salto"]], moviles: [] },
    { t: 3, llamas: [[1, 300, 0, 0, 1, null]], moviles: [] },
    { t: 4, llamas: [[1, 600, 0, 0, 1, null]], moviles: [{ tipo: "piedra", x: 640, y: 0, a: 10, b: 10, giro: 0, z0: 0, z1: 20 }] },
  ];
  const v = { motor: "3d", fijosCalculados: [roca, piedrita], fijosDibujados: [{ ...roca, z1: 45 }, piedrita], tropiezo: null, cuadros };
  const m = medirVolcadoCarrera(M, v);
  // La llama encima de la roca (t = 1), sobre la piedrita sin saltar (t = 3; en t = 2 va por encima) y con la piedra del cerro adentro (t = 4).
  assert.equal(m.filas["llama-roca"].cuadros, 1);
  assert.equal(m.filas["llama-piedrita"].cuadros, 1);
  assert.equal(m.filas["llama-piedra del cerro"].cuadros, 1);
  // La roca dibujada una vez y media más alta que la calculada se ve; en el piso, igual.
  assert.equal(m.fijos.piso, 0);
  assert.ok(Math.abs(m.fijos.altoMax - 1.5) < 1e-9);
  assert.ok(Math.abs(compararFijos([roca], [{ ...roca, x: 100.4 }]).piso - 0.4) < 1e-9);
  assert.equal(compararFijos([roca], [{ ...roca, x: 110 }]).sinPareja, 1);
  // La víctima del tropiezo, en su ventana, puede golpear su piedrita (que se mueve) hasta el 35 %: no cuenta como pisarla.
  const tz = { quien: 1, piedrita: 0, t: 5, lado: 1 };
  const golpe = medirVolcadoCarrera(M, { motor: "3d", fijosCalculados: [], fijosDibujados: [], tropiezo: tz, cuadros: [{ t: 5.1, llamas: [[1, 300, 0, 0, 1, "malsalto"]], moviles: [{ ...piedrita, x: 322, movil: true }] }] });
  assert.equal(golpe.filas["llama-piedrita"].cuadros, 0);
});

test("las rocas y las matas por ronda: el promedio de cada pantalla", () => {
  // Lo que cuenta cada ronda sale de su lista.
  const { M, d } = rondaDeMano({
    gente: [1], cuadros: 2, donde: () => ({ x: 5000, y: 0 }),
    rocas: [{ tipo: "roca", x: 0, y: 0, a: 1, b: 1, giro: 0, alto: 1 }, { tipo: "mata", x: 9, y: 0, a: 1, b: 1, giro: 0, alto: 1 }, { tipo: "roca", x: 20, y: 0, a: 1, b: 1, giro: 0, alto: 1 }],
  });
  const info = {};
  carrera.medirRondaSolidos(M, d, 1000, 600, 0, info);
  // Y si la ronda tuvo tropiezo en una piedrita (esta, sin piedritas, no).
  assert.deepEqual(info, { rocas: 2, matas: 1, tropiezo: false });
  // Tres rondas en 1366x768 con 2, 4 y 6 rocas y una mata cada una, y una en 390x844 con 3 rocas y ninguna mata.
  const acumulado = new Map();
  carrera.sumarRocas(acumulado, "1366x768", { rocas: 2, matas: 1 });
  carrera.sumarRocas(acumulado, "390x844", { rocas: 3, matas: 0 });
  carrera.sumarRocas(acumulado, "1366x768", { rocas: 4, matas: 1 });
  carrera.sumarRocas(acumulado, "1366x768", { rocas: 6, matas: 1 });
  assert.deepEqual(carrera.rocasPorRonda(acumulado), [
    { pantalla: "1366x768", rondas: 3, rocas: 4, matas: 1 },
    { pantalla: "390x844", rondas: 1, rocas: 3, matas: 0 },
  ]);
});
