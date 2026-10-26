import { nameList } from "../../i18n";
import type { Story } from "../drama";
import type { Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas, Toma } from "./kit/tipos";
import { planRounds, type Question, type Round } from "./quien-plan";
import type { Escena } from "./quien";

/**
 * El show de De pie, puro: los pasos, el guion y cuándo corona.
 *
 * Vive aparte de la escena (`quien.ts`) para probarlo en Node. De la lista y
 * la ronda sale todo: cada pregunta con su revisión, su respuesta, el momento en
 * que se sientan las cartas y el que se reacomodan; lo que dice el relator y lo
 * que suena; adónde mira la cámara y cuándo se acerca. Nada de esto decide
 * quién gana: las preguntas se eligen sabiendo quién es (`quien-plan.ts`).
 */

/**
 * La sala se para y se da la regla (primera ronda); en las siguientes, la sala
 * ya sabe el ritmo: el reparto, la revisión y el aplauso son más cortos. Así
 * tres premios no pasan de la ventana de la duración.
 */
export const T_DEAL = 2.6;
export const T_NEXT = 1.2;
export const REVISAR = 2.6;
export const REVISAR_NEXT = 2.2;
/** Después de la respuesta, la sala se sienta; recién entonces las cartas se dan vuelta. */
export const SIT = 1.0;
export const FLIP = 0.55;
export const REGROUP = 0.6;
/** Con cuatro o menos de pie: el momento para que los vean, con el aplauso. */
export const FIN = 3.2;
export const FIN_NEXT = 2.4;
/** El empate de letras: la pantalla lo dice y confirma con las cartas. */
export const TIE_SAY = 1.2;
export const FINAL_HOLD = 0.5;
export const NEXT_GAP = 0.8;
/** Hasta cuántos de pie se hace el encuadre de los finalistas. */
export const FINALISTAS = 4;
/**
 * Cuando nadie se sienta (la pregunta de calentamiento, con dos o tres de pie),
 * los de pie dan un saltito en el momento en que se darían vuelta las cartas:
 * la pantalla confirma que siguen todos. Sin eso, con dos personas, de la
 * respuesta a la pregunta siguiente pasaban 4,2 s sin que se moviera nada
 * (auditor exigente, 22 de octubre de 2026). Lo que dura, y cuánto sube, en
 * fracción del alto de la carta.
 */
export const SALTO = 0.5;
export const SALTO_ALTO = 0.12;

export type Kind = "reparto" | "pregunta" | "finalistas" | "empate";

export interface Step {
  kind: Kind;
  round: number;
  /** El número de pregunta dentro de la ronda (0 para los demás pasos). */
  qi: number;
  /** Cuándo empieza el paso, cuándo se contesta, cuándo se sientan las cartas, cuándo se reacomodan y cuándo termina. */
  start: number;
  answer: number;
  flip: number;
  regroup: number;
  end: number;
}


/** El pulso de la revisión: el cartel late una vez por segundo, y el sonido, dos veces. */
export const TIC = 1.0;
export const TIC_SONIDO = 0.5;

/* ------------------------------------------------------------------ el plan */

/** Los nombres de los que quedan, en una línea ("A, B y C"). */
const etiquetaDe = (names: string[], idx: readonly number[]): string => nameList(idx.map((i) => names[i] ?? "").filter(Boolean));

/** Lo que el plan arma y la escena lee. */
export interface Datos {
  n: number;
  names: string[];
  prizes: number[];
  total: number;
  rounds: Round[];
  steps: Step[];
  /** Los pasos de preguntas de cada ronda, por número de pregunta. */
  pasosPregunta: Step[][];
  /** En qué momento se va cada carta de la ronda `ri`: el escalonado dentro de su pregunta. */
  goneAt: Map<number, number>[];
  story: Story;
}

/** Los que siguen de pie en la ronda `ri` al momento `t`. */
export function vivosEn(d: Datos, ri: number, t: number): number[] {
  const r = d.rounds[ri] as Round;
  const m = d.goneAt[ri] as Map<number, number>;
  return r.pool.filter((i) => !(m.has(i) && t >= (m.get(i) as number) + FLIP));
}

/** Los que siguen para el acomodo: cambian recién cuando la pregunta reacomoda. */
export function lugaresEn(d: Datos, ri: number, t: number): number[] {
  const r = d.rounds[ri] as Round;
  const pasos = d.steps.filter((s) => s.round === ri && (s.kind === "pregunta" || s.kind === "empate") && t >= s.regroup);
  const last = pasos.at(-1);
  if (!last) return r.pool;
  if (last.kind === "empate") return [r.winner];
  return (r.questions[last.qi] as Question).remaining;
}

/** El paso que está corriendo en `t`: el último que empezó. */
export function pasoEn(d: Datos, t: number): Step {
  let s = d.steps[0] as Step;
  for (const x of d.steps) if (x.start <= t) s = x;
  return s;
}

/**
 * El plan de De pie, puro: de la lista y la ronda salen los pasos, el guion y
 * cuándo corona. Nada de esto decide quién gana: las preguntas se eligen
 * sabiendo quién es (`quien-plan.ts`) y el kit solo cuenta lo que ya pasó.
 * El azar se gasta en el mismo orden de siempre: primero las preguntas, después
 * la historia, y las frases con variantes al decirse.
 */
export function planQuien(ctx: Contexto): Plan<Datos> {
  const names = ctx.nombres;
  const n = names.length;
  // Una ronda por premio, del último al primero, como en una premiación: la
  // ronda larga, con el suspenso de la última pregunta y el arco del director,
  // es la del primer premio. El cartel y el relator del final siguen con el
  // orden de `winners`. Con un solo premio no cambia nada.
  const prizes = ctx.ganadores.length ? [...ctx.ganadores].reverse() : [0];
  const total = prizes.length;
  const rounds = planRounds(names, prizes, ctx.rng);
  // El arco del director, para el último ganador: en el susto su carta se
  // medio sienta en la última pregunta y vuelve; en la tapada no se nombra a
  // los dos últimos y la cámara espera al final.
  const story = ctx.historia(Math.max(2, n), (prizes[total - 1] as number) % Math.max(2, n));

  const steps: Step[] = [];
  const guion: LineaGuion[] = [];
  const at = (t: number, l: Omit<LineaGuion, "t">): void => void guion.push({ t, ...l });
  const pasosPregunta: Step[][] = rounds.map(() => []);
  /** Lo que pasa, para la prueba del niño: empezó, alguien salió, quedaron los finalistas, ganó. */
  const eventos: { desde: number; tipo: "empezo" | "salio" | "adelante" | "gano"; quien?: number }[] = [{ desde: 0, tipo: "empezo" }];
  let tt = 0;

  /** Lo que se dice al contestar una pregunta: las cartas que se sientan. */
  const frase = (q: Question): string =>
    q.tipo === "letra" ? ctx.txt("cQuiSitL", q.valor, q.has)
      : q.tipo === "numero" ? ctx.txt("cQuiSitD", q.valor, q.has)
        : q.tipo === "mitad" ? ctx.txt("cQuiSitM", q.has)
          : q.tipo === "largo" ? ctx.txt("cQuiSitG", Number(q.valor), q.has)
            : ctx.txt("cQuiSitO", Number(q.valor), q.has);

  rounds.forEach((r, ri) => {
    const grand = ri === total - 1;
    const Q = r.questions.length;
    const reparto = ri === 0 ? T_DEAL : T_NEXT;
    steps.push({ kind: "reparto", round: ri, qi: 0, start: tt, answer: tt, flip: tt, regroup: tt, end: tt + reparto });
    at(tt, {
      texto: () => (ri === 0 ? ctx.txt("cQuiStart", n) : ctx.txt("cQuiNext", total - ri, total)),
      calor: ri === 0 ? 0.15 : 0.3 + 0.4 * (ri / Math.max(1, total - 1)),
      hacer: (k) => k.sonido.escalera([7, 8, 9, 7, 8, 9], 70),
    });
    if (ri === 0) at(tt + reparto - 1.3, { texto: () => ctx.txt("cQuiRules"), calor: 0.2 });
    // Un ruido bajo a mitad del reparto: las cartas que llegan, y no hay silencio de más hasta la primera pregunta.
    at(tt + reparto * 0.5, { hacer: (k) => k.sonido.tono(8, "fondo", { dur: 0.05, vol: 0.025 }) });
    tt += reparto;

    let antes = r.pool.length;
    let finDicho = false;
    r.questions.forEach((q, qi) => {
      // Cuanto más tarde la ronda, más tiempo para revisar: las primeras van rápido, las últimas, lento.
      const ultimas = qi >= Q - 2;
      const revisar = (ri === 0 ? REVISAR : REVISAR_NEXT) + (ultimas ? 0.4 : 0) + (grand && qi === Q - 1 ? 1.0 : 0);
      const s0 = tt;
      const answer = s0 + revisar;
      const flip = answer + SIT;
      const regroup = flip + FLIP + 0.1;
      const end = regroup + REGROUP;
      const paso: Step = { kind: "pregunta", round: ri, qi, start: s0, answer, flip, regroup, end };
      steps.push(paso);
      pasosPregunta[ri]?.push(paso);
      const esUltimaGrande = grand && qi === Q - 1;
      // Las cartas se sientan en `flip`: es cuando se ve la salida en el cuerpo.
      if (q.out.length) eventos.push({ desde: flip, tipo: "salio", quien: q.out[0] });
      // La tensión de la revisión queda apenas debajo de la de la respuesta: un salto
      // grande de tensión suelta el bombo y el platillo de la música, y acá no hace falta.
      const calor = 0.35 + 0.4 * (qi / Math.max(1, Q));
      at(s0, {
        texto: () => ctx.txt("cQuiRevisa", ri + qi),
        calor,
        hacer: (k) => k.sonido.tono(9, "evento", { dur: 0.1, vol: 0.04 }),
      });
      // El tic de la revisión: como un reloj de cocina, dos por segundo. Da el pulso
      // de la espera sin señalar a nadie (el sonido no depende del nombre). En la última
      // pregunta de la ronda grande se va frenando de a poco, como el foco de antes.
      // Cada tic sostiene la música en la tensión de la revisión, sin subirla: sin eso
      // se caía hasta el piso en cada espera y quedaban el bombo y el bajo solos, que
      // un parlante de proyector no reproduce (auditor de mezcla, 22 de octubre de
      // 2026: perdía 3,6 LU sin los graves de 150 Hz; ahora 3,2).
      let tic = s0 + TIC_SONIDO;
      let espacio = TIC_SONIDO;
      for (let j = 1; tic < answer - 0.2; j++) {
        at(tic, {
          hacer: (k) => {
            k.sonido.tic(j);
            k.calor(calor);
          },
        });
        espacio = esUltimaGrande ? espacio * 1.1 : espacio;
        tic += espacio;
      }
      const decisiva = esUltimaGrande;
      at(answer, {
        texto: () => {
          const f = frase(q);
          return q.out.length ? (q.has ? ctx.txt("cQuiYes", f, ri + qi) : ctx.txt("cQuiNo", f, ri + qi)) : ctx.txt("cQuiNone", q.has);
        },
        calor: 0.45 + 0.4 * (qi / Math.max(1, Q)),
        hacer: (k) => {
          const s = k.sonido;
          if (decisiva) {
            // La respuesta que decide no suena como las otras: cuerpo grave y
            // dos notas que suben, con la música recién cortada por el respiro.
            // No abre el remate: el remate queda para el cartel (auditor de
            // mezcla, 7 de octubre de 2026: −24 LU).
            s.tono(0, "climax", { dur: 0.6, vol: 0.09 });
            s.tono(q.has ? 10 : 8, "evento", { dur: 0.4, vol: 0.06 });
            s.despues(110, () => s.tono(q.has ? 12 : 10, "evento", { dur: 0.3, vol: 0.05 }));
          } else if (q.has) {
            s.tono(4, "evento", { dur: 0.12, vol: 0.05 });
            s.tono(7, "evento", { dur: 0.18, vol: 0.045 });
          } else {
            s.tono(3, "evento", { dur: 0.12, vol: 0.05 });
            s.tono(0, "evento", { dur: 0.18, vol: 0.045 });
          }
          for (let i = 0; i < Math.min(8, q.out.length); i++) s.despues(350 + i * 45, () => s.tono(10 - (i % 4), "fondo", { dur: 0.03, timbre: "square", vol: 0.02 }));
          k.cam.shake((2 + Math.min(4, q.out.length * 0.2)) * k.pantalla().k);
        },
      });
      // Las cartas que se sientan hacen un ruido corto al darse vuelta, y al reacomodarse otro más bajo: la
      // sala escucha cada paso, también cuando el pace estira el juego.
      // En la respuesta que decide no: el golpe de quien gana tiene que sonar solo (auditor de mezcla).
      if (!esUltimaGrande) {
        if (q.out.length) at(flip, { hacer: (k) => k.sonido.tono(6, "fondo", { dur: 0.05, vol: 0.025 }) });
        at(regroup, { hacer: (k) => k.sonido.tono(4, "fondo", { dur: 0.05, vol: 0.02 }) });
      }
      tt = end;
      // Cuando quedan cuatro o menos de pie, la sala los mira: "¡Finalistas, que los vean!".
      const quedan = q.remaining.length;
      if (!finDicho && quedan <= FINALISTAS && quedan > 1 && antes > FINALISTAS) {
        finDicho = true;
        const idx = [...q.remaining];
        eventos.push({ desde: tt, tipo: "adelante", quien: idx[0] });
        const fin = ri === 0 ? FIN : FIN_NEXT;
        steps.push({ kind: "finalistas", round: ri, qi: 0, start: tt, answer: tt, flip: tt, regroup: tt, end: tt + fin });
        at(tt, {
          texto: () => ctx.txt("cQuiFinal", etiquetaDe(names, idx)),
          calor: 0.8,
          hacer: (k) => {
            const s = k.sonido;
            s.tono(7, "evento", { dur: 0.12, vol: 0.05 });
            s.despues(120, () => s.tono(10, "evento", { dur: 0.12, vol: 0.05 }));
            s.despues(240, () => s.tono(12, "evento", { dur: 0.2, vol: 0.05 }));
          },
        });
        // El aplauso: unos clics cada medio segundo, que no suenan a melodía.
        for (let j = 1; j * 0.5 < fin - 0.6; j++) at(tt + j * 0.5, { hacer: (k) => k.sonido.tono(12, "fondo", { dur: 0.03, timbre: "square", vol: 0.02 }) });
        tt += fin;
      }
      antes = quedan;
    });

    if (r.ties.length) {
      const s0 = tt;
      const topes = r.empate === "tope";
      const answer = s0 + TIE_SAY;
      const flip = answer + 0.6;
      const regroup = flip + FLIP + 0.1;
      const end = regroup + REGROUP;
      steps.push({ kind: "empate", round: ri, qi: Q, start: s0, answer, flip, regroup, end });
      at(s0, {
        texto: () => ctx.txt(topes ? "cQuiTope" : "cQuiTie"),
        calor: 0.8,
        hacer: (k) => k.sonido.tono(0, "evento", { dur: 0.5, vol: 0.06 }),
      });
      tt = end;
    }
    if (!grand) {
      // El que gana un premio que no es el último se sienta con él: se lo dice la pantalla.
      const ultimo = steps[steps.length - 1];
      const cuando = ultimo ? ultimo.end - REGROUP * 0.5 : tt;
      at(cuando, { texto: () => ctx.txt("cQuiDone", names[r.winner] ?? "", total - ri), calor: 0.6 });
    }
    tt += grand ? FINAL_HOLD : NEXT_GAP;
  });
  const tCrown = tt;

  /**
   * La respuesta que decide: la última pregunta de la ronda del último premio.
   * La música se corta 0,4 s antes y queda en silencio hasta el cartel, que la
   * vuelve a abrir con el remate: la carta sola late sin música. Si esa ronda
   * termina en un empate no hay respuesta, y el respiro queda antes del cartel.
   */
  const decisivo = (pasosPregunta[total - 1] ?? []).at(-1);
  // En el susto, la carta de quien gana se medio sienta y vuelve: "¡Uy, casi se sienta!" va a mitad del amague.
  if (story.arc === "susto" && decisivo) at(decisivo.flip + 0.45, { texto: () => ctx.txt("cQuiAlmost", total - 1), calor: 0.95 });

  const goneAt: Map<number, number>[] = rounds.map((r, ri) => {
    const m = new Map<number, number>();
    const qs = pasosPregunta[ri] ?? [];
    r.questions.forEach((q, qi) => {
      const s = qs[qi];
      if (!s) return;
      q.out.forEach((idx, j) => m.set(idx, s.flip + (j / Math.max(1, q.out.length)) * Math.min(0.45, 0.04 * q.out.length + 0.15)));
    });
    const tie = steps.find((s) => s.kind === "empate" && s.round === ri);
    if (tie) r.ties.forEach((idx, j) => m.set(idx, tie.flip + j * 0.12));
    return m;
  });

  const desde = decisivo ? decisivo.start : Math.max(T_DEAL, tCrown - 4);
  const escenaDe = (k: Kit): Escena => k.escena as Escena;
  /** Una sola toma para todo el show: la sala, y con pocas cartas de pie, ellas (`aim`). */
  const toma: Toma = (k, t) => escenaDe(k).aim(t);
  const momentos: Momentos = {
    presentacion: { hasta: Math.min(T_DEAL, desde), toma },
    // La tensión sube con la última pregunta de la ronda grande: mira a las cartas de pie, nunca a una sola antes de la respuesta.
    tension: { desde, toma },
    foco: (k) => escenaDe(k).foco(),
    protegido: (k) => escenaDe(k).protegida(),
  };

  const gana = (rounds[total - 1] as Round).winner;
  eventos.push({ desde: tCrown, tipo: "gano", quien: gana });
  const datos: Datos = { n, names, prizes, total, rounds, steps, pasosPregunta, goneAt, story };
  // El único contador (`kit/marcador.ts`): cuántos siguen de pie en la ronda que corre, y 1 con el golpe.
  const marcador = (t: number): number => (t >= tCrown ? 1 : Math.max(1, vivosEn(datos, pasoEn(datos, t).round, t).length));
  // La prueba del niño: adelante es estar de pie; hacia el medio de la mesa; lo último que pasó.
  const respuestas = (t: number): Respuestas => {
    const vivos = vivosEn(datos, pasoEn(datos, t).round, t);
    const ult = [...eventos].filter((e) => e.desde <= t).at(-1) ?? (eventos[0] as (typeof eventos)[number]);
    return {
      adelante: { quienes: vivos.length ? vivos : [gana], lugar: "centro" },
      hacia: "centro",
      progreso: Math.min(1, t / tCrown),
      paso: { tipo: ult.tipo, quien: ult.quien, desde: ult.desde },
    };
  };

  return {
    duracion: tCrown,
    arco: story.arc,
    respiro: decisivo ? decisivo.answer : tCrown,
    sentido: "centro",
    marcador,
    respuestas,
    momentos,
    guion,
    marcas: { quien: `${n}x${total}`, preguntas: rounds.map((r) => r.questions.length).join(",") },
    datos,
  };
}
