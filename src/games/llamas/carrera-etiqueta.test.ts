import type { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { planNombres } from "../nombres";
import { armarEtiqueta, ponerEtiqueta, type AspectoFicha, type Etiqueta, type EstiloFicha } from "./carrera-etiqueta";
import { FUNDIDO_NOMBRE, formaEn, nivelesDe, type NivelesCarrera } from "./carrera-nombre-nivel";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";

/**
 * Lo que dibuja la ficha de nombre de la carrera, con piezas de mentira en lugar de PixiJS:
 *
 * - (a) en la hora `t` la ficha muestra lo mismo llegando cuadro por cuadro, saltando directo a `t` y yendo hacia atrás;
 * - (c) ningún nombre aparece ni desaparece de un cuadro al siguiente: cada texto cambia su opacidad de a poco (un fundido);
 * - (d) mientras nada cambia la ficha no escribe nada en PixiJS, y nunca crea objetos después de armarse.
 */

vi.setConfig({ testTimeout: 600_000 });

const TAMANOS = [8, 18, 60];
const SEMILLAS = [1, 2, 3];
const FPS = 60;

/** Las escrituras en las piezas de mentira y cuántas piezas se crearon. */
const cuenta = { piezas: 0, escrituras: 0 };

class FalsoContenedor {
  hijos: unknown[] = [];
  visible = true;
  alpha = 1;
  posicion: [number, number] = [0, 0];
  position = { set: (x: number, y: number): void => void ((this.posicion = [x, y]), cuenta.escrituras++) };
  constructor() {
    cuenta.piezas++;
  }
  addChild(...h: unknown[]): void {
    this.hijos.push(...h);
  }
}

class FalsoGrafico {
  /** Lo último que se dibujó, como texto. */
  dibujo: string[] = [];
  constructor() {
    cuenta.piezas++;
  }
  clear(): this {
    cuenta.escrituras++;
    this.dibujo = [];
    return this;
  }
  roundRect(x: number, y: number, w: number, h: number, r: number): this {
    this.dibujo.push(`rect ${[x, y, w, h, r].map((v) => v.toFixed(6)).join(" ")}`);
    return this;
  }
  fill(f: unknown): this {
    this.dibujo.push(`fill ${JSON.stringify(f)}`);
    return this;
  }
  stroke(f: unknown): this {
    this.dibujo.push(`stroke ${JSON.stringify(f)}`);
    return this;
  }
}

class FalsoTexto {
  private _text = "";
  private _alpha = 1;
  private _visible = true;
  anchor = { set: (): void => undefined };
  position = { set: (): void => void cuenta.escrituras++ };
  private estilo: Record<string, unknown> = { fontSize: 20 };
  /** Cada escritura de estilo cuenta, aunque sea el mismo valor (PixiJS rearma el borde con cada objeto nuevo). */
  style = new Proxy(this.estilo, {
    set: (o, k, v): boolean => {
      cuenta.escrituras++;
      o[k as string] = v;
      return true;
    },
  });
  constructor() {
    cuenta.piezas++;
  }
  get text(): string {
    return this._text;
  }
  set text(v: string) {
    // Como PixiJS: el mismo texto no hace nada.
    if (v === this._text) return;
    cuenta.escrituras++;
    this._text = v;
  }
  get alpha(): number {
    return this._alpha;
  }
  set alpha(v: number) {
    cuenta.escrituras++;
    this._alpha = v;
  }
  get visible(): boolean {
    return this._visible;
  }
  set visible(v: boolean) {
    cuenta.escrituras++;
    this._visible = v;
  }
  /** Un ancho de mentira, fijo para cada texto y letra. */
  get width(): number {
    return [...this._text].length * (this.estilo.fontSize as number) * 0.55;
  }
}

const aspecto: AspectoFicha = {
  tinta: 0x1b1b26, amarillo: 0xffc629, crema: 0xfff6e0, echada: 0x2c2c38, fichaAlfa: 0.82, fichaEchadaAlfa: 0.95,
  contorno: (fs) => ({ color: 0x1b1b26, width: Math.max(3, fs / 4), join: "round" }),
};

function nuevaEtiqueta(): Etiqueta {
  return armarEtiqueta({
    raiz: new FalsoContenedor() as unknown as Container,
    fondo: new FalsoGrafico() as unknown as Graphics,
    texto: new FalsoTexto() as unknown as Text,
    sale: new FalsoTexto() as unknown as Text,
    rotulo: new FalsoContenedor() as unknown as Container,
    rotuloTexto: new FalsoTexto() as unknown as Text,
    rotuloFondo: new FalsoGrafico() as unknown as Graphics,
  });
}

interface Show {
  d: Datos;
  niv: NivelesCarrera;
  formas: (readonly string[])[];
  /** Las horas de los cuadros, a 60 por segundo, hasta un poco después de la meta. */
  ts: number[];
  /** Las que tienen ficha en la carrera. */
  quienes: number[];
}

function showDe(n: number, s: number, nueva = false): Show {
  const d = planCarrera(ctxDe(n, s), { nueva }).datos;
  return {
    d,
    niv: nivelesDe(d),
    formas: planNombres(d.names).formas,
    ts: Array.from({ length: Math.ceil((d.tCrown + 1) * FPS) }, (_, i) => i / FPS),
    quienes: d.gente.length ? d.gente : d.lanes,
  };
}

/** Lo que el cuadro de la hora `t` le pide a la ficha de `q` (lo mismo que arma `carrera.ts`). */
function pedido(sh: Show, q: number, t: number): { s: string; sale: string; mezcla: number; estilo: EstiloFicha } {
  const cae = sh.d.tiempos.cae.get(q) ?? Infinity;
  const echada = t >= cae;
  const fn = formaEn(sh.niv, t, echada ? cae : Infinity);
  const texto = (nivel: number): string => sh.formas[q]?.[nivel - 1] ?? sh.d.names[q] ?? "";
  const estilo: EstiloFicha = echada ? "echada" : sh.d.duena(t) === q && t < sh.d.tCrown - 3 ? "lider" : "normal";
  return { s: texto(fn.a), sale: fn.mezcla < 1 ? texto(fn.de) : "", mezcla: fn.mezcla, estilo };
}

/** Pone la ficha de `q` en la hora `t` y devuelve lo que se ve: cada texto visible con su opacidad, y el fondo. */
function dibujar(sh: Show, e: Etiqueta, q: number, t: number): { textos: Map<string, number>; fondo: string } {
  const p = pedido(sh, q, t);
  ponerEtiqueta(e, p.s, p.sale, p.mezcla, 20, p.estilo, aspecto, null);
  const textos = new Map<string, number>();
  for (const tx of [e.sale, e.texto]) if (tx.visible && tx.alpha > 0) textos.set(tx.text, (textos.get(tx.text) ?? 0) + tx.alpha);
  return { textos, fondo: (e.fondo as unknown as FalsoGrafico).dibujo.join(";") };
}

const comoTexto = (x: { textos: Map<string, number>; fondo: string }): string =>
  `${[...x.textos].map(([s, a]) => `${s}@${a.toFixed(9)}`).join(" + ")} | ${x.fondo}`;

describe("la ficha de nombre, pura", () => {
  for (const nueva of [false, true]) {
    for (const n of TAMANOS) {
      it(`${nueva ? "nueva" : "de siempre"}, ${n} personas: cuadro por cuadro, saltando y hacia atrás se ve lo mismo; ningún nombre cambia de golpe`, () => {
        for (const s of nueva ? SEMILLAS.slice(0, 1) : SEMILLAS) {
          const sh = showDe(n, s, nueva);
          const { ts } = sh;
          // Saltando directo: cada décimo cuadro y todos los de alrededor de cada cambio de forma (de todas y de cada echada).
          const saltos = new Set<number>(ts.map((_, i) => i).filter((i) => i % 10 === 0));
          const cerca = [...sh.niv.cambios.map((c) => c.t), ...sh.d.tiempos.echadas.map((e) => e.t)];
          for (const h of cerca) for (let j = -2; j <= FUNDIDO_NOMBRE * FPS + 2; j++) saltos.add(Math.round(h * FPS) + j);
          for (const q of sh.quienes) {
            const e = nuevaEtiqueta();
            const seguido = ts.map((t) => dibujar(sh, e, q, t));
            // (c) Entre dos cuadros seguidos ningún texto cambia su opacidad más de lo que permite un fundido: no aparece ni se va de golpe.
            for (let i = 1; i < seguido.length; i++) {
              const a = (seguido[i - 1] as { textos: Map<string, number> }).textos, b = (seguido[i] as { textos: Map<string, number> }).textos;
              for (const txt of new Set([...a.keys(), ...b.keys()])) {
                const salto = Math.abs((b.get(txt) ?? 0) - (a.get(txt) ?? 0));
                expect(salto, `${n} personas, semilla ${s}, ficha ${q} («${txt}»), t=${(ts[i] as number).toFixed(3)}`).toBeLessThan(0.1);
              }
            }
            const esperado = seguido.map(comoTexto);
            // (a) Hacia atrás, desde el final, con otra ficha.
            const f2 = nuevaEtiqueta();
            const atras = [...ts].reverse().map((t) => comoTexto(dibujar(sh, f2, q, t))).reverse();
            expect(atras).toEqual(esperado);
            // (a) Saltando directo a cada hora, con una ficha nueva.
            for (const i of saltos) {
              if (i < 0 || i >= ts.length) continue;
              expect(comoTexto(dibujar(sh, nuevaEtiqueta(), q, ts[i] as number)), `${n} personas, semilla ${s}, ficha ${q}, t=${(ts[i] as number).toFixed(3)}`).toBe(esperado[i]);
            }
            // (a) Y con la misma ficha, de una hora cualquiera a otra: dos caminos a la misma hora.
            const f3 = nuevaEtiqueta();
            for (let k = 0; k < 60; k++) {
              const i = (k * 7919 + q * 31) % ts.length;
              expect(comoTexto(dibujar(sh, f3, q, ts[i] as number))).toBe(esperado[i]);
            }
          }
        }
      });
    }
  }

  it("con 18 personas el cambio de forma de todas se ve: a mitad del fundido están los dos nombres", () => {
    const sh = showDe(18, 1);
    expect(sh.niv.cambios.length).toBe(2);
    for (const c of sh.niv.cambios) {
      const t = c.t + FUNDIDO_NOMBRE / 2;
      let ambos = 0;
      for (const q of sh.quienes) {
        if ((sh.d.tiempos.cae.get(q) ?? Infinity) <= c.t) continue;
        const { textos } = dibujar(sh, nuevaEtiqueta(), q, t);
        if (textos.size === 2) ambos++;
      }
      // Todas las que siguen en carrera y cuyo nombre cambia de forma, a la vez y fundiéndose.
      expect(ambos).toBeGreaterThan(3);
    }
  });

  it("(d) mientras nada cambia la ficha no escribe en PixiJS, y nunca crea piezas después de armarse", () => {
    for (const n of TAMANOS) {
      const sh = showDe(n, 2);
      for (const q of sh.quienes) {
        const e = nuevaEtiqueta();
        const piezas = cuenta.piezas;
        let antes = "";
        let quietos = 0, conEscrituras = 0, cambios = 0;
        for (const t of sh.ts) {
          const p = pedido(sh, q, t);
          const pide = `${p.s}|${p.sale}|${p.mezcla}|${p.estilo}`;
          const e0 = cuenta.escrituras;
          ponerEtiqueta(e, p.s, p.sale, p.mezcla, 20, p.estilo, aspecto, null);
          const escribio = cuenta.escrituras > e0;
          if (pide === antes) {
            quietos++;
            // Lo mismo que el cuadro anterior: ni un texto, ni un estilo, ni el fondo.
            expect(escribio, `${n} personas, ficha ${q}, t=${t.toFixed(3)}`).toBe(false);
          } else cambios++;
          if (escribio) conEscrituras++;
          antes = pide;
        }
        expect(cuenta.piezas).toBe(piezas);
        // En régimen no se escribe: solo en los cuadros en que cambió lo que se pide (un fundido, un estilo).
        expect(conEscrituras).toBeLessThanOrEqual(cambios);
        expect(quietos).toBeGreaterThan(sh.ts.length * 0.8);
      }
    }
  });

  it("el fondo pasa del ancho del nombre que se va al del que llega, sin saltar", () => {
    const e = nuevaEtiqueta();
    const anchos: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const m = i / 30;
      ponerEtiqueta(e, "Ana Vargas", "Ana V.", m, 20, "normal", aspecto, null);
      anchos.push(e.w);
    }
    ponerEtiqueta(e, "Ana Vargas", "", 1, 20, "normal", aspecto, null);
    anchos.push(e.w);
    for (let i = 1; i < anchos.length; i++) expect(anchos[i] as number).toBeGreaterThanOrEqual((anchos[i - 1] as number) - 1e-9);
    expect(anchos[anchos.length - 1]).toBeCloseTo(anchos[anchos.length - 2] as number, 9);
  });
});
