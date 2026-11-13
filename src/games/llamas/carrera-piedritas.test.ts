import { describe, expect, it, vi } from "vitest";
import { carrilesDe, formaDe, LLAMA_HOCICO } from "./carrera-forma";
import { CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { cajaDePatas, crucesDe, descartarPiedritas, elegirTropiezo, medidasSalto, paresDelTropiezo, patasSobre, PIEDRITA_ALTO, piedritaEn, sembrarPiedritas, SALTO_AIRE, TROPIEZO_CABEZA, TROPIEZO_PROB, victimaDelTropiezo, type Cruce, type EntradaTropiezo, type Tropiezo } from "./carrera-piedritas";
import { ctxDe } from "./carrera-prueba";
import { finDeLaSiembra, sembrarRocas, type Roca } from "./carrera-rocas";
import { RECTA, planCarrera, type Datos } from "./carrera-show";
import { crearTrayectorias, type Trayectorias } from "./carrera-trayectorias";
import { TAM3D, ZC } from "./carrera-3d-mapa";

/**
 * La piedrita que se salta: cada llama del grupo que llega a la piedrita de su fila la salta una vez, de 0,5 a 0,7 s en el aire (M6), con
 * las patas por encima de la piedra todo el cruce; nadie más la pisa; y todo sale igual llamado directo, cuadro a cuadro o saltando.
 */

vi.setConfig({ testTimeout: 180_000 });

/**
 * La escena sin Pixi, con la siembra de la escena: las rocas, las piedritas (se tiran si alguien las pisa sin saltar) y, con `conTropiezo`,
 * el tropiezo, elegido como lo elige la escena.
 */
function armar(d: Datos, W: number, H: number, conTropiezo = false): { tr: Trayectorias; rocas: Roca[]; piedritas: Roca[]; candidatas: Roca[]; tropiezo: Tropiezo | null; cruces: Cruce[]; altoFila: number } {
  const u = W < H ? Math.min(W / 420, H / 900) : H / 720;
  const P = { w: W, h: H, u, retrato: W < H, top: 60 * u, bottom: H - 90 * u };
  const forma = formaDe(P, Math.max(1, d.gente.length), 16 * u, 110 * u);
  const cuerpo = CUERPO * ENSANCHE * RECTA * W;
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const carr = carrilesDe(P, d.lanes.length, 16 * u);
  const F0 = -(60 * u + LLAMA_HOCICO * forma.esc);
  const Xs = F0 + d.distAbre * W;
  let piedritas: Roca[] = [];
  let tropiezo: Tropiezo | null = null;
  const tr = crearTrayectorias(d, {
    F0, Xs, ancho: W, cuerpo, forma, carr, caminata: null,
    get piedritas() {
      return piedritas;
    },
    get tropiezo() {
      return tropiezo;
    },
  });
  const xDeT = (t: number): number => F0 + d.dist(t) * W;
  const zonas = d.tramos.map((tramo, i) => ({ desde: i === 0 ? 0 : xDeT(tramo.t0), hasta: xDeT(tramo.t1), tipo: tramo.terreno }));
  const velocidades = d.tramos.map((tramo, i) => ((zonas[i]?.hasta ?? 0) - (zonas[i]?.desde ?? 0)) / Math.max(1e-9, tramo.t1 - tramo.t0));
  const candidatas = sembrarPiedritas({
    semilla: d.semillaRocas, zonas, velocidades, filasY: Array.from({ length: forma.filas }, (_, f) => forma.yPie(f)),
    esc: forma.esc, cuerpo, profundidad: forma.profundidad,
  });
  const filasY = Array.from({ length: forma.filas }, (_, f) => forma.yPie(f));
  const rocas = sembrarRocas({
    semilla: d.semillaRocas, zonas, filasY, y0: forma.y0, y1: forma.y1,
    huella: { atras: 36 * forma.esc * TAM3D, adelante: 38 * forma.esc * TAM3D, medio: (13 * forma.esc * TAM3D) / ZC, alto: 100 * forma.esc * TAM3D },
    cuerpo, esc: forma.esc, muestras: tr.muestras(d.tSalida, finDeLaSiembra(d), 1 / 30), echadas: d.tiempos.echadas.map((e) => ({ quien: e.quien, t: e.t })),
  });
  piedritas = candidatas;
  const conBrincos = tr.muestras(d.tSalida, finDeLaSiembra(d), 1 / 30);
  piedritas = descartarPiedritas(candidatas, conBrincos);
  const cruces = crucesDe(piedritas, conBrincos, d.tSalida, 1 / 30);
  if (conTropiezo) tropiezo = elegirTropiezo({ semilla: d.semillaRocas, piedritas, rocas, altoFila: forma.altoFila, muestras: conBrincos, desde: d.tSalida, paso: 1 / 30, victima: victimaDelTropiezo(entradaTropiezo(d)) }, cruces);
  return { tr, rocas, piedritas, candidatas, tropiezo, cruces, altoFila: forma.altoFila };
}

/** Lo que el tropiezo lee del plan: la semilla, los tramos, la gente y cuándo se echa cada una. Nada de la pantalla. */
const entradaTropiezo = (d: Datos): EntradaTropiezo => ({ semilla: d.semillaRocas, tramos: d.tramos, gente: d.gente, cae: (p) => d.tiempos.cae.get(p) ?? Infinity });

describe("la piedrita que se salta", () => {
  it("con 18 personas en 1366x768: cada llama de la fila que llega a su piedrita la salta una vez, con las patas por encima, y en el aire de 0,5 a 0,7 s en la mediana", () => {
    let saltos = 0, conPiedritas = 0;
    const aires: number[] = [];
    for (let semilla = 1; semilla <= 8; semilla++) {
      const d = planCarrera(ctxDe(18, semilla)).datos;
      const { tr, piedritas } = armar(d, 1366, 768);
      if (!piedritas.length) continue;
      conPiedritas++;
      for (const r of piedritas) {
        expect(r.alto).toBeCloseTo(PIEDRITA_ALTO * 100 * (tr.posicion(d.gente[0] as number, d.tSalida).esc * TAM3D), 6);
        for (const p of d.gente) {
          if (tr.filaDe(p) !== r.fila) continue;
          // Las horas en que sus patas están sobre la piedrita, y las del brinco.
          let enAire = 0, brincos = 0, antes = false, toco = 0, cruza = false;
          for (let t = d.tSalida; t < d.tAbre; t += 1 / 120) {
            const pos = tr.posicion(p, t);
            const alza = pos.alza ?? 0;
            const sobre = Math.abs(pos.x - r.x) < 3 * medidasSalto(pos.esc, r.a).largo && alza > 0;
            if (sobre) enAire += 1 / 120;
            if (sobre && !antes) brincos++;
            antes = sobre;
            if (patasSobre(cajaDePatas(pos.x, pos.y, pos.esc), r)) {
              cruza = true;
              if (alza < r.alto) toco++;
            }
          }
          if (!cruza) continue;
          saltos++;
          expect(toco, `semilla ${semilla}, llama ${p}: patas sobre la piedrita sin estar por encima`).toBe(0);
          expect(brincos, `semilla ${semilla}, llama ${p}`).toBe(1);
          // El brinco es función del lugar: la que va más despacio que el grupo (porque se queda atrás) pasa más tiempo en el aire.
          expect(enAire, `semilla ${semilla}, llama ${p}: segundos en el aire`).toBeGreaterThanOrEqual(0.4);
          expect(enAire, `semilla ${semilla}, llama ${p}: segundos en el aire`).toBeLessThanOrEqual(0.95);
          aires.push(enAire);
        }
      }
    }
    expect(conPiedritas).toBeGreaterThan(0);
    expect(saltos).toBeGreaterThan(20);
    // M6 de la dirección: de 0,5 a 0,7 s en el aire, en la mediana de todos los brincos.
    const mediana = [...aires].sort((a, b) => a - b)[Math.floor(aires.length / 2)] as number;
    expect(mediana).toBeGreaterThanOrEqual(SALTO_AIRE[0] + 0.05);
    expect(mediana).toBeLessThanOrEqual(SALTO_AIRE[1] - 0.05);
  });

  for (const [W, H] of [[1366, 768], [1920, 1080], [844, 390], [390, 844]] as const) {
    it(`en ${W}x${H}, con 18 y 30: nadie pisa una piedrita sin estar por encima, en ningún cuadro`, () => {
      for (const n of [18, 30]) {
        for (let semilla = 1; semilla <= 6; semilla++) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const { tr, piedritas } = armar(d, W, H);
          for (let t = d.tSalida; t < d.tAbre; t += 1 / 60) {
            for (const p of new Set([...d.gente, ...d.lanes])) {
              const pos = tr.posicion(p, t);
              for (const r of piedritas) {
                if ((pos.alza ?? 0) >= r.alto) continue;
                expect(patasSobre(cajaDePatas(pos.x, pos.y, pos.esc), r), `${n} personas, semilla ${semilla}, llama ${p} a los ${t.toFixed(2)} s`).toBe(false);
              }
            }
          }
        }
      }
    });
  }

  it("la siembra es pura: la misma entrada da la misma lista, una por fila y tramo de piedras, en el medio de la fila", () => {
    const d = planCarrera(ctxDe(18, 3)).datos;
    const a = armar(d, 1366, 768), b = armar(d, 1366, 768);
    expect(a.candidatas).toEqual(b.candidatas);
    expect(a.piedritas).toEqual(b.piedritas);
    const tramos = d.tramos.filter((t) => t.terreno === "piedras").length;
    const filas = new Set(a.candidatas.map((r) => r.fila));
    if (tramos) expect(a.candidatas.length).toBe(tramos * filas.size);
    // Más piedritas que las que se tiran: casi todas quedan.
    expect(a.piedritas.length).toBeGreaterThanOrEqual(a.candidatas.length - 2);
  });

  it("en un celular parado el brinco duraría demasiado: ese tramo no lleva piedritas", () => {
    let alguna = 0;
    for (let semilla = 1; semilla <= 6; semilla++) alguna += armar(planCarrera(ctxDe(18, semilla)).datos, 390, 844).candidatas.length;
    expect(alguna).toBe(0);
  });
  it("el tropiezo: a una se le engancha la pata, la piedrita sale despedida y nadie más la pisa; la que tropieza no pierde lugar", () => {
    let conPiedritas = 0, tropiezos = 0;
    for (const n of [18, 30]) {
      for (let semilla = 1; semilla <= 20; semilla++) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const con = armar(d, 1366, 768, true);
        if (!con.cruces.length) continue;
        conPiedritas++;
        const tz = con.tropiezo;
        if (!tz) continue;
        tropiezos++;
        const sin = armar(d, 1366, 768, false);
        const r = con.piedritas[tz.piedrita] as Roca;
        // La víctima es una de las que cruzan esa piedrita, y la piedrita sale hacia un costado.
        expect(con.cruces.some((c) => c.quien === tz.quien && c.piedrita === tz.piedrita)).toBe(true);
        expect(Math.abs(tz.lado)).toBe(1);
        // Si la víctima corre corrida de la línea de su fila (en su subfila), la piedrita sale hacia el otro lado, lejos de sus patas.
        const yv = con.tr.posicion(tz.quien, tz.t).y;
        if (Math.abs(yv - r.y) > 1e-6) expect(tz.lado, `${n} personas, semilla ${semilla}`).toBe(-Math.sign(yv - r.y));
        let golpe = 0;
        for (let t = tz.t - 1; t < tz.t + 2.5; t += 1 / 60) {
          // No pierde lugar: el mismo piso que sin tropiezo.
          const a = con.tr.posicion(tz.quien, t), b = sin.tr.posicion(tz.quien, t);
          expect(a.x, `${n} personas, semilla ${semilla}, a los ${t.toFixed(2)} s`).toBeCloseTo(b.x, 9);
          expect(a.y).toBeCloseTo(b.y, 9);
          const pr = piedritaEn(r, tz, tz.piedrita, t, con.altoFila);
          const movida = { ...r, x: pr.x, y: pr.y };
          for (const q of new Set([...d.gente, ...d.lanes])) {
            const pos = con.tr.posicion(q, t);
            if ((pos.alza ?? 0) >= r.alto || !patasSobre(cajaDePatas(pos.x, pos.y, pos.esc), movida)) continue;
            // Solo la víctima, en su tropezón, y apenas un golpe.
            expect(q === tz.quien && t > tz.t - 0.2 && t < tz.t + TROPIEZO_CABEZA, `${n} personas, semilla ${semilla}: la llama ${q} pisa la piedrita a los ${t.toFixed(2)} s`).toBe(true);
            golpe++;
          }
          // En su ventana trastabilla con la cabeza baja (la postura de la valla mal saltada) y no le alcanza el brinco.
          if (t > tz.t && t < tz.t + 0.5) {
            expect(a.momento?.kind).toBe("malsalto");
            expect(a.alza ?? 0).toBeLessThan(r.alto);
          }
        }
        expect(golpe, `${n} personas, semilla ${semilla}: cuadros de golpe`).toBeLessThanOrEqual(8);
      }
    }
    // En 6 de cada 10 carreras con piedritas, con lo que se pierde cuando ningún costado sirve y, con la marcha pareja, cuando la víctima se
    // echa antes de llegar a su piedrita (se sortea entre las que corren al empezar el tramo): en estas carreras se ve en 3 de cada 10.
    expect(tropiezos / conPiedritas, `${tropiezos} de ${conPiedritas}`).toBeGreaterThan(0.2);
    expect(tropiezos / conPiedritas, `${tropiezos} de ${conPiedritas}`).toBeLessThan(0.8);
  });

  it("quién tropieza y en qué tramo sale de la semilla y del plan: la misma semilla muestra a la misma llama en cada pantalla, o a ninguna, y cambiar el tamaño no la vuelve a elegir", () => {
    let conDos = 0, conTropiezo = 0;
    for (const n of [18, 30]) {
      for (let semilla = 1; semilla <= 30; semilla++) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const vistos: { pantalla: string; quien: number; tramo: number | undefined }[] = [];
        // Las pantallas de un proyector, una laptop y un celular acostado y parado (el parado no lleva piedritas). Abrir en una y pasar a otra
        // rehace la siembra con la geometría nueva: da lo mismo que abrir en la otra.
        for (const [W, H] of [[1920, 1080], [1366, 768], [844, 390], [390, 844]] as const) {
          const { tropiezo, piedritas } = armar(d, W, H, true);
          if (!tropiezo) continue;
          vistos.push({ pantalla: `${W}x${H}`, quien: tropiezo.quien, tramo: piedritas[tropiezo.piedrita]?.tramo });
          // La víctima se sortea entre las que corren al empezar el tramo: si tropieza, va de pie (se echa después, o nunca).
          expect(d.tiempos.cae.get(tropiezo.quien) ?? Infinity, `${n} personas, semilla ${semilla}, ${W}x${H}`).toBeGreaterThan(tropiezo.t);
        }
        conTropiezo += vistos.length;
        if (vistos.length >= 2) conDos++;
        const unicos = new Set(vistos.map((v) => `${v.quien} en el tramo ${v.tramo}`));
        expect(unicos.size, `${n} personas, semilla ${semilla}: ${JSON.stringify(vistos)}`).toBeLessThanOrEqual(1);
        // Y es la del plan, en su tramo de piedras.
        const v = victimaDelTropiezo(entradaTropiezo(d));
        for (const x of vistos) expect({ quien: x.quien, tramo: x.tramo }).toEqual({ quien: v?.quien, tramo: v?.tramo });
      }
    }
    expect(conTropiezo).toBeGreaterThan(20);
    expect(conDos).toBeGreaterThan(10);
  });

  // Tres tramos y diez en el grupo: la 7 se echa a la mitad del segundo tramo de piedras, la 8 y la 9 a la mitad del primero.
  const tramosAMano = [
    { t0: 0, t1: 4, terreno: "piedras" },
    { t0: 4, t1: 8, terreno: "barro" },
    { t0: 8, t1: 12, terreno: "piedras" },
  ];
  const caeAMano = (p: number): number => (p === 7 ? 10 : p >= 8 ? 2 : Infinity);
  const genteAMano = Array.from({ length: 10 }, (_, p) => p);

  it("la víctima del tropiezo sale pareja entre las que siguen en pie al empezar cada tramo de piedras, en 6 de cada 10 carreras, sin mirar a nadie", () => {
    const e = (semilla: number): EntradaTropiezo => ({ semilla, tramos: tramosAMano, gente: genteAMano, cae: caeAMano });
    expect(paresDelTropiezo(e(1), true)).toHaveLength(10 + 8);
    const cuenta = new Map<string, number>();
    let con = 0;
    const N = 20_000;
    for (let s = 1; s <= N; s++) {
      const v = victimaDelTropiezo(e(s * 2654435761), true);
      if (!v) continue;
      con++;
      const k = `${v.quien}|${v.tramo}`;
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
      expect(Math.abs(v.lado)).toBe(1);
    }
    expect(Math.abs(con / N - TROPIEZO_PROB)).toBeLessThan(0.015);
    // Dieciocho pares: las diez en el primer tramo (todas largan en pie) y la 0 a la 7 en el segundo (la 7 se echa recién a la mitad).
    expect(cuenta.size).toBe(18);
    for (const [k, c] of cuenta) expect(Math.abs(c / con - 1 / 18), k).toBeLessThan(0.012);
    // Sin tramos de piedras, nadie.
    expect(victimaDelTropiezo({ semilla: 5, tramos: [{ t0: 0, t1: 4, terreno: "barro" }], gente: genteAMano, cae: caeAMano }, true)).toBeNull();
    // Y la marcha pareja es lo que vale si no se dice.
    expect(paresDelTropiezo(e(1))).toEqual(paresDelTropiezo(e(1), true));
  });

  it("con la marcha pareja entra la que se echa a la mitad del tramo; con la carrera de antes, solo las que siguen en pie al terminarlo", () => {
    const e: EntradaTropiezo = { semilla: 1, tramos: tramosAMano, gente: genteAMano, cae: caeAMano };
    const con = paresDelTropiezo(e, true).map(([p, t]) => `${p}|${t}`);
    const antes = paresDelTropiezo(e, false).map(([p, t]) => `${p}|${t}`);
    for (const par of ["7|2", "8|0", "9|0"]) {
      expect(con, par).toContain(par);
      expect(antes, par).not.toContain(par);
    }
    // La de antes: la 0 a la 6 en los dos tramos y la 7 en el primero, quince pares.
    expect(antes).toHaveLength(15);
    // La que ya estaba echada al empezar un tramo no entra en ninguna de las dos: la 8 y la 9 en el segundo.
    expect(con).not.toContain("8|2");
    expect(con).not.toContain("9|2");
  });

  it("si la víctima se echa antes de llegar a su piedrita no la cruza, y no hay tropiezo: no se muestra a otra", () => {
    // Una piedrita en el primer tramo, que la 1 cruza corriendo. La 8 es la víctima del plan pero se echó antes de llegar: no tiene cruce.
    const piedritas: Roca[] = [{ tipo: "piedrita", x: 500, y: 300, a: 6, b: 4, giro: 0, alto: 6, fila: 0, tramo: 0 }];
    const cruces: Cruce[] = [{ quien: 1, piedrita: 0, t: 1 }];
    const base = { semilla: 1, piedritas, rocas: [] as Roca[], altoFila: 40, muestras: new Map<number, Float64Array>(), desde: 0, paso: 1 / 30 };
    expect(elegirTropiezo({ ...base, victima: { quien: 8, tramo: 0, lado: 1 } }, cruces)).toBeNull();
    // La 1, que sí la cruza, tropieza.
    expect(elegirTropiezo({ ...base, victima: { quien: 1, tramo: 0, lado: 1 } }, cruces)).toEqual({ quien: 1, piedrita: 0, t: 1, lado: 1 });
  });

  it("el tropiezo no mira quién gana: la ganadora tropieza tantas veces como le toca entre las que siguen en pie en los tramos de piedras", () => {
    let veces = 0, esperado = 0, varianza = 0, carreras = 0;
    for (let semilla = 1; semilla <= 300; semilla++) {
      const d = planCarrera(ctxDe(18, semilla)).datos;
      const { tropiezo } = armar(d, 1366, 768, true);
      if (!tropiezo) continue;
      carreras++;
      // Dado que hubo tropiezo, a la ganadora le toca en la proporción de sus pares (llama, tramo de piedras) del plan.
      const pares = paresDelTropiezo(entradaTropiezo(d));
      const p = pares.filter(([q]) => q === d.campeona).length / pares.length;
      esperado += p;
      varianza += p * (1 - p);
      if (tropiezo.quien === d.campeona) veces++;
    }
    expect(carreras).toBeGreaterThan(80);
    expect(Math.abs(veces - esperado), `tropezó ${veces} veces, se esperaban ${esperado.toFixed(1)}`).toBeLessThanOrEqual(3 * Math.sqrt(varianza));
  });
  for (const [W, H] of [[390, 844], [1366, 768]] as const) {
    it(`en ${W}x${H}: ninguna llama queda dentro de una roca ni de una mata en toda la carrera, también la que cruza el pedregal después de abrirse la recta`, () => {
      const toques: string[] = [];
      for (const n of [18, 30]) {
        for (let semilla = 1; semilla <= 8; semilla++) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const { tr, rocas } = armar(d, W, H);
          if (!rocas.length) continue;
          for (let t = d.tSalida; t < Math.min(d.tCrown, d.tAbre + 10); t += 1 / 30) {
            for (const p of new Set([...d.gente, ...d.lanes])) {
              const pos = tr.posicion(p, t);
              const k = pos.esc * TAM3D;
              const x0 = pos.x - 36 * k, x1 = pos.x + 38 * k, y0 = pos.y - (13 * k) / ZC, y1 = pos.y + (13 * k) / ZC;
              for (const r of rocas) {
                if (r.x + r.a < x0 || r.x - r.a > x1) continue;
                const px = Math.max(x0, Math.min(r.x, x1)), py = Math.max(y0, Math.min(r.y, y1));
                if (((px - r.x) / r.a) ** 2 + ((py - r.y) / r.b) ** 2 < 1) toques.push(`${n} personas, semilla ${semilla}: la llama ${p} en una ${r.tipo} a los ${t.toFixed(2)} s (la recta se abre a los ${d.tAbre.toFixed(2)})`);
              }
            }
          }
        }
      }
      expect(toques.slice(0, 6), `${toques.length} cuadros`).toEqual([]);
    });
  }
});
