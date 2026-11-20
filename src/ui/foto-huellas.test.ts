// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Foto } from "./foto";

/**
 * Lo que no puede cambiar al darle lugar a la lista de ganadores en la foto del juego, fijado con la huella de su registro
 * de llamadas al lienzo, tomada antes de tocar el armado:
 *
 * - la foto de siempre (sin `fondo`), con siete, doce y cincuenta ganadores, un orden de turnos, sin QR, sin sello y en
 *   inglés. La foto de siempre comparte con la del juego las funciones de "Escaneá" y de lo de abajo: si una cambia, esta
 *   huella se mueve;
 * - la foto del juego con un ganador, que el diálogo no cambia: nombre corto, nombre y apellido con premio, nombre de 28
 *   letras, premio de 60 letras, sin sello, con logo y en inglés.
 *
 * Cada huella se toma con dos lienzos: el de mentira que mide once píxeles por letra (el de `foto-logo.test.ts`) y uno que
 * mide según el tamaño y el peso de la letra, como el del navegador. Con el primero, "Escaneá para comprobarlo" entra en un
 * renglón de 64 px, algo que el navegador nunca hace: el segundo recorre las ramas de varios renglones.
 */

const h = vi.hoisted(() => ({
  fondo: vi.fn((c: CanvasRenderingContext2D, juego: string, _w: number, _h: number): boolean => {
    if (juego !== "race") return false;
    c.fillStyle = "#123456";
    c.fillRect(0, 0, 1, 1);
    return true;
  }),
}));
vi.mock("./foto-fondos", () => ({ pintarFondoJuego: (c: CanvasRenderingContext2D, j: string, w: number, a: number) => h.fondo(c, j, w, a) }));

type Registro = string[];
type Medida = "once" | "letra";

function cualquiera(): unknown {
  const coso: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === "width" || p === "height" ? 10 : p === Symbol.toPrimitive ? () => 0 : coso),
    apply: () => coso,
  });
  return coso;
}

function lienzoFalso(registro: Registro, medida: Medida): HTMLCanvasElement {
  const estado: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(estado, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === "measureText")
        return (s: string) => {
          if (medida === "once") return { width: 11 * String(s).length };
          const font = String(t.font ?? "");
          const tam = Number(/(\d+)px/.exec(font)?.[1] ?? 10);
          return { width: Array.from(String(s)).length * tam * (/monospace/.test(font) ? 0.6 : /^(900|800)/.test(font) ? 0.65 : 0.6) };
        };
      return (...a: unknown[]) => {
        registro.push(`${String(p)}(${a.map((x) => (typeof x === "object" && x ? "[obj]" : String(x))).join(",")})`);
        return cualquiera();
      };
    },
    set: (t, p, v) => {
      registro.push(`set ${String(p)}=${String(v)}`);
      t[p] = v;
      return true;
    },
  });
  return { width: 0, height: 0, getContext: () => ctx, toBlob: (f: (b: Blob | null) => void) => f(null) } as unknown as HTMLCanvasElement;
}

const foto = (extra: Partial<Foto> = {}): Foto => ({
  rotulo: "Sorteo #278, red de prueba, 21 de octubre de 2026",
  titulo: "Ganó",
  personas: ["Beto"],
  lineas: ["Salió entre 12 personas"],
  mas: "y {n} más",
  enlace: "https://tinkazo.app/c/AbCdEfGh#" + "A".repeat(22),
  escanear: "Escaneá para comprobarlo",
  sinQr: "El enlace va en el mensaje",
  ...extra,
});

const varios = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);

let registro: Registro;
let medida: Medida;
beforeEach(() => {
  registro = [];
  medida = "once";
  h.fondo.mockClear();
  vi.resetModules();
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { createElement: (t: string) => (t === "canvas" ? lienzoFalso(registro, medida) : cualquiera()) });
  vi.stubGlobal("createImageBitmap", async () => ({ width: 128, height: 64, close: () => undefined }));
});
afterEach(() => vi.unstubAllGlobals());

/** La huella de la foto con el lienzo que mide como se dice. Cada llamada baja el módulo de nuevo: nada queda en memoria. */
async function huella(f: Foto, m: Medida): Promise<string> {
  medida = m;
  registro.length = 0;
  vi.resetModules();
  const { dibujarFoto } = await import("./foto");
  await dibujarFoto(f);
  return createHash("sha256").update(registro.join("\n")).digest("hex");
}

/** Para tomar las huellas: IMPRIMIR_HUELLAS=1 las muestra en lugar de compararlas. */
const imprimir = process.env["IMPRIMIR_HUELLAS"] === "1";
async function fijar(nombre: string, f: Foto, esperadas: { once: string; letra: string }): Promise<void> {
  for (const m of ["once", "letra"] as const) {
    const real = await huella(f, m);
    if (imprimir) appendFileSync(process.env["HUELLAS_SALIDA"] ?? "huellas.txt", `${nombre} | ${m} | ${real}
`);
    else expect(real, `${nombre} (${m})`).toBe(esperadas[m]);
  }
}

describe("la foto de siempre, llamada por llamada, sin importar cuántos ganadores", () => {
  const casos: Array<[string, Foto, { once: string; letra: string }]> = [
    ["siete ganadores", foto({ titulo: "Ganaron", personas: varios(7), lineas: ["Premio: Polera", "Salieron entre 60 personas"] }), { once: "ff6365bca1f88580df143e7f126d60b74f9024cff89793ac95a08fa250461808", letra: "7f2d82b8af21cd7b932411a6b317f76be07f76abd3f9a9f4247f6d5b6ce3fd21" }],
    ["doce ganadores", foto({ titulo: "Ganaron", personas: varios(12), lineas: ["Premio: Polera", "Salieron entre 60 personas"] }), { once: "a82215d3e38f024d6e444cb026906c4326e4958a359218ec19a7109bbdf0e368", letra: "dd1ad729fbb27e587e7577869dadfb187b4927d455cd165c3250683e70d932b3" }],
    ["cincuenta ganadores", foto({ titulo: "Ganaron", personas: varios(50), lineas: ["Salieron entre 300 personas"] }), { once: "9e2577d474b05e2a467316d2d124f304f59ab8e00fdc82e0a6cec75af9d37ba6", letra: "55e40e8c7a833470379b92b584985af4fc5aab3f45038297c878ac4c3300d890" }],
    [
      "un orden de turnos de dieciocho",
      foto({ titulo: "Orden de turnos", personas: varios(18), lineas: ["Turnos de limpieza", "18 personas, turnos del 1 al 18"] }),
      { once: "56db22eb9508b919d026ad1614bc7a478aa958c1709060b1068f6402b8136439", letra: "b31977a0e26e604fc95270d2c5633fb95dfeda3979707dc33d67c75a84945b92" },
    ],
    [
      "sin QR, el enlace no entra",
      foto({ titulo: "Ganaron", personas: varios(5), enlace: "https://tinkazo.app/verificar.html#" + "x".repeat(4000), lineas: ["Salieron entre 80 personas"] }),
      { once: "9a26039e50c41b02a3002b2c2d1bb1af8bce3435c4ef09b5068cc2cddd778aff", letra: "bdfb7733d7302d39e02bb993bdce5b3f87f8f0083907438d47893f0853a15c38" },
    ],
    [
      "sin sello: Escaneá para ver la lista y la cuenta",
      foto({ titulo: "Ganaron", personas: varios(5), escanear: "Escaneá para ver la lista y la cuenta", lineas: ["Salieron entre 80 personas", "Sin sello: no se puede comprobar."] }),
      { once: "3c4047745cf85a3acaa5a82dabe75e73ba12352df68caf16ab7beefafc500d38", letra: "21156fe6a078d2c24b256390e2b72a97fcbfea5d56ec1785b701d182ed269632" },
    ],
    [
      "en inglés",
      foto({ titulo: "Winners", personas: varios(9), mas: "and {n} more", escanear: "Scan to check it", lineas: ["Prize: Polera", "Drawn from 60 people"] }),
      { once: "9c4ea34bc7705cbc0142dfb1c715b503890797309e2a790a00be6cc4d65c9f88", letra: "42870fd7a17bdfe4ffac33d56f16772e196ace7f917084485f18a0d240b24fc4" },
    ],
    [
      "en inglés, sin sello",
      foto({ titulo: "Winners", personas: varios(4), mas: "and {n} more", escanear: "Scan to see the list and the math", lineas: ["Drawn from 60 people", "No seal: it can't be checked."] }),
      { once: "a1a4658384dbc114f6a72e329be1ca4f04846765a15b4689d3d6ed485fdfcd7b", letra: "25ae23f780ad44bbeacbf16b3a9801963d82887b35ea0a70aa0e79b542f18dc6" },
    ],
  ];
  it.each(casos)("%s", async (nombre, f, esperadas) => {
    await fijar(nombre, f, esperadas);
    // Con `fondo` indefinido es la misma foto.
    expect(await huella({ ...f, fondo: undefined }, "letra")).toBe(await huella(f, "letra"));
  });
});

describe("la foto del juego con un ganador: la que el diálogo ya da, sin cambios", () => {
  const juego = (extra: Partial<Foto> = {}): Foto => foto({ fondo: "race", ...extra });
  const casos: Array<[string, Foto, { once: string; letra: string }]> = [
    ["un nombre corto", juego(), { once: "dfb993276dea0bc98ce06b66c71b9916f9613797160772cfc13286523a5e3d44", letra: "8e540e3f0e4a532123e77e39d77c0729cb5dd64d964ec4d3b0774164a9a6567a" }],
    ["nombre y apellido con premio", juego({ personas: ["Ana Quispe"], lineas: ["Se lleva: Auriculares", "Salió entre 48 personas"] }), { once: "e4c32f71a417a00021e4a53123bbec4c54539d9869037e17af2aa96d203e2d30", letra: "5855e55a0025625bb97bd76c1651fd7529cbdbd70e6e1d46c3f0b577d87a2c1b" }],
    [
      "un nombre de 28 letras con premio",
      juego({ personas: ["Guadalupe Villavicencio Mamani"], lineas: ["Se lleva: Polera", "Salió entre 120 personas"] }),
      { once: "523176f4e6d2dfe2e79c920b7e096521efdb1b9006b4bcf087cf9292177ac5e8", letra: "780cbb96c77e55e2ee33aec3358c9a345ff38c529cd8c6e87f926c5658151a38" },
    ],
    [
      "un premio de 60 letras",
      juego({ personas: ["Beto Choque"], lineas: ["Se lleva: " + "Una mochila de aguayo y dos entradas para el concierto".slice(0, 50), "Salió entre 85 personas"] }),
      { once: "7ae29c000ef55ba7c1e714e90e5c3007d086ff99eac0b076f4f094e851c5e576", letra: "0e610378dd9a8064358e1fb816407b4a2568604cf727377a974d722bab6bb065" },
    ],
    [
      "sin sello",
      juego({ personas: ["Ana Quispe"], escanear: "Escaneá para ver la lista y la cuenta", lineas: ["Se lleva: Polera", "Salió entre 30 personas", "Sin sello: no se puede comprobar."] }),
      { once: "e81c6538b61943248dde0501eddb94a8daa765a7e35db49009d75c2b693282cb", letra: "2f0f89a37ca264252b694791eac409904ef589920368929496fd5f69c66d7ec3" },
    ],
    [
      "en inglés",
      juego({ titulo: "Winner", personas: ["Ana Quispe"], escanear: "Scan to check it", lineas: ["Wins: Headphones", "Drawn from 48 people"] }),
      { once: "e1e8a50b02182ed789a00382e8d2d63463a62bbfed004dae422319bb3e85ad00", letra: "0b227414d488c3643c6316b276fddd5abcc21fa20673f621fac2a90f4d6378b2" },
    ],
    [
      "sin QR: el enlace no entra",
      juego({ personas: ["Ana Quispe"], enlace: "https://tinkazo.app/verificar.html#" + "x".repeat(4000), lineas: ["Salió entre 48 personas"] }),
      { once: "d21c8c4a3f405e82b720fed3819abde19837b42830000895c6dc7046b0cd67c6", letra: "236de46dc45cc837145edcfbfc4fe3cbcaaad2e3088466008e13667b8f03939d" },
    ],
  ];
  it.each(casos)("%s", async (nombre, f, esperadas) => {
    await fijar(nombre, f, esperadas);
  });

  it("con logo", async () => {
    const { LOGO_DE_PRUEBA } = await import("../logo-guardado");
    await fijar("con logo", juego({ personas: ["Ana Quispe"], logo: LOGO_DE_PRUEBA, hecho: "Hecho con Tinkazo", lineas: ["Se lleva: Polera", "Salió entre 30 personas"] }), { once: "5c4986f43f56969db4b8c52d49295dcc2da1373087de8aa06a5b1b8a8bb01996", letra: "292be63ae2febefc19b37ec1c9ae2d17494166630f1f251224457ea78698f196" });
  });
});
