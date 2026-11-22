// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tus campañas y Usar en esta compu en el panel de quien organiza: la lista de la cuenta que se pide con la dirección del panel
 * o al tocar Ver tus campañas, lo que dice cada fila, tomar una campaña con la sala abierta (clave nueva, filas anteriores con su
 * número) o activada (sin vista previa), y cada falla en la misma tarjeta. Con una sala de mentira que contesta lo que se le diga.
 * Los textos que se comparan están escritos a mano: son lo que lee la persona.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { fechaTexto, horaTexto } from "../campana/formato";
import { ponerPaso, reiniciarElPuente } from "../campana/puente";
import { cifrarEquipo } from "../equipos/datos";
import type { CampanaDeCuenta, FaseDeSala, MotivoDeRecuperar, ResultadoDeMisCampanas, ResultadoDeRecuperar } from "../sala/campana-org";
import { guardarOrg, leerOrg, tokenDeEvento } from "../sala/campana-org";
import { cabeAbrirYa, desdeCuandoSePuedePreparar } from "./campana-sala";
import {
  $,
  AHORA,
  CLAVE,
  SALA,
  TOKEN,
  type Mundo,
  type Panel,
  abrirInscripcion,
  alta,
  archivoDe,
  boton,
  botones,
  cerrarTodos,
  elegirArchivo,
  filasDe,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
} from "./campana-sala-mundo";

const CUENTA = cuentaDePrueba(5);
const OTRA = cuentaDePrueba(6);
const EVENTO = "evento-uno";
const TOKEN_NUEVO = "N".repeat(22);
const TOKEN_ANTERIOR = "A".repeat(22);
const HORA = 3_600_000;

const fila = (cambios: Partial<CampanaDeCuenta> = {}): CampanaDeCuenta => ({
  evento: EVENTO,
  empresa: "Alcancía Andina",
  zona: "America/La_Paz",
  abreMs: AHORA + 3 * HORA,
  cierraMs: AHORA + 6 * HORA,
  sorteoMs: AHORA + 7 * HORA,
  estado: "activada",
  ...cambios,
});
const viva = (fase: FaseDeSala, cambios: Partial<CampanaDeCuenta> = {}): CampanaDeCuenta => fila({ estado: "viva", fase, total: 5, ...cambios });
const terminada = (cambios: Partial<CampanaDeCuenta> = {}): CampanaDeCuenta => fila({ evento: "vieja-k3f9", empresa: "Café Sucre", estado: "terminada", sorteoMs: AHORA - 20 * HORA, ...cambios });

const vivaDeLaSala = (fase: FaseDeSala = "abierta"): ResultadoDeRecuperar => ({
  ok: true,
  estado: "viva",
  sala: { id: "AbCd1234", token: TOKEN_NUEVO, vence: AHORA + 86_400_000, servicio: "https://s.tinkazo.app" },
  fase,
});
const activadaDeLaSala = (anterior: string | null = null): ResultadoDeRecuperar => ({ ok: true, estado: "activada", archivo: JSON.parse(archivoDe()) as { texto: string; firma: string }, anterior });
const noSale = (motivo: MotivoDeRecuperar): ResultadoDeRecuperar => ({ ok: false, motivo });

interface Mundillo {
  m: Mundo;
  /** Las sesiones con que se pidió la lista. */
  listas: string[];
  /** Lo que se pidió usar acá: la sesión y el evento. */
  usadas: [string, string][];
  /** Las salas que armaron lo recordado de un sorteo ya hecho. */
  sorteos: { evento: string; cuenta: string }[];
  entradas: number;
  /** Lo que contesta la lista. */
  lista: ResultadoDeMisCampanas;
  /** Lo que contesta usar acá, en orden. Sin nada, la sala abierta. */
  respuestas: ResultadoDeRecuperar[];
  /** Si no es null, usar acá espera a que la prueba lo suelte. */
  espera: Promise<void> | null;
  /** Si es false, el panel no se abrió desde la dirección de quien organiza. */
  conDireccion: boolean;
  sesion: string | null;
  /** Lo que contesta la sala cuando se le pregunta si tiene Tus campañas: sí, no, o no contestó. */
  hay: boolean | null;
  /** Cuántas veces se le preguntó. */
  preguntas: number;
}

/** El mundo en el modo oficial, con la cuenta entrada y las dos rutas de mentira. */
function armar(cambios: Partial<Pick<Mundillo, "lista" | "conDireccion" | "sesion" | "hay">> = {}): Mundillo {
  const m = mundo();
  m.red = "mainnet";
  m.cuenta = CUENTA;
  const x: Mundillo = { m, listas: [], usadas: [], sorteos: [], entradas: 0, lista: { ok: true, campanas: [] }, respuestas: [], espera: null, conDireccion: true, sesion: "sesion-de-prueba", hay: true, preguntas: 0, ...cambios };
  m.deps.sesion = async () => x.sesion;
  m.deps.entrar = () => void x.entradas++;
  m.deps.tus = {
    alAbrir: () => x.conDireccion,
    disponible: async () => {
      x.preguntas++;
      return x.hay;
    },
    listar: async (sesion) => {
      x.listas.push(sesion);
      return x.lista;
    },
    recuperar: async (sesion, evento) => {
      x.usadas.push([sesion, evento]);
      if (x.espera) await x.espera;
      return x.respuestas.shift() ?? vivaDeLaSala();
    },
    armarSorteo: async (sala, cuenta) => {
      x.sorteos.push({ evento: sala.evento, cuenta });
      return true;
    },
    ayuda: (asunto) => "mailto:ayuda@prueba.test?subject=" + encodeURIComponent(asunto),
  };
  return x;
}

/**
 * Las filas de Tus campañas. El botón principal de la primera que se puede usar está en la barra de abajo, siempre a la vista, y
 * la fila lo cuenta como suyo (lleva la marca `cpo-tus-primera`): así cada fila lee lo mismo que ofrece, esté donde esté el botón.
 */
const filasTus = (p: Panel): { empresa: string; linea: string; botones: string[]; ayuda: string | null }[] =>
  [...p.raiz.querySelectorAll<HTMLElement>("#cpo-tus > li.cpo-tus-fila")].map((li) => ({
    empresa: li.querySelector(".cpo-tus-nombre")?.textContent ?? "",
    linea: li.querySelector(".cpo-linea")?.textContent ?? "",
    botones: [
      ...(li.classList.contains("cpo-tus-primera") ? principales(p).map((b) => `primary:${(b.textContent ?? "").trim()}`) : []),
      ...[...li.querySelectorAll("button")].map((b) => `${b.className}:${(b.textContent ?? "").trim()}`),
    ],
    ayuda: li.querySelector("a")?.getAttribute("href") ?? null,
  }));
const textosDeBotones = (p: Panel): string[] => botones(p).map((b) => (b.textContent ?? "").trim());

/** Abre el panel y espera a que llegue la lista que se pide sola. */
async function abrir(x: Mundillo): Promise<Panel> {
  const p = nuevoPanel(x.m);
  await suelta(8);
  return p;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cerrarTodos();
  reiniciarElPuente();
  vi.restoreAllMocks();
});

describe("cuándo se pide la lista", () => {
  it("con la dirección del panel y la sesión se pide sola, una vez, y muestra la vista nueva con una sola acción principal", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("abierta")] } });
    const p = await abrir(x);
    expect(x.listas).toEqual(["sesion-de-prueba"]);
    expect(vistaDe(p)).toBe("tus");
    expect(texto(p, "#cpo-h")).toBe("Tus campañas");
    expect(texto(p, "#cpo-linea")).toBe("Elegí la que vas a usar en esta compu.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Usar en esta compu"]);
  });

  it("al llegar la sesión se vuelve a mirar, pero la misma cuenta no se pide dos veces en la pestaña", async () => {
    const x = armar({ lista: { ok: true, campanas: [] } });
    const p = await abrir(x);
    expect(x.listas).toHaveLength(1);
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
    await suelta(8);
    expect(x.listas).toHaveLength(1);
    expect(vistaDe(p)).toBe("elegir");
  });

  it("sin sesión no se pide nada, y al llegar la sesión se pide", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    x.m.cuenta = null;
    const p = await abrir(x);
    expect(x.listas).toEqual([]);
    expect(vistaDe(p)).toBe("elegir");
    x.m.cuenta = CUENTA;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
    await suelta(8);
    expect(vistaDe(p)).toBe("tus");
    expect(x.listas).toHaveLength(1);
  });

  it("en el modo Prueba no hay nada que pedir ni el enlace para pedirlo", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    x.m.red = "testnet";
    const p = await abrir(x);
    expect(x.listas).toEqual([]);
    expect(textosDeBotones(p)).not.toContain("Ver tus campañas");
  });

  it("sin la dirección del panel no se pide sola, y el enlace Ver tus campañas la pide", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] }, conDireccion: false });
    const p = await abrir(x);
    expect(x.listas).toEqual([]);
    expect(vistaDe(p)).toBe("elegir");
    boton(p, "Ver tus campañas").click();
    await suelta(8);
    expect(x.listas).toHaveLength(1);
    expect(vistaDe(p)).toBe("tus");
  });

  it("con la campaña de esta compu a la vista no se pide la lista", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista", { evento: "otra-k3f9" })] } });
    // Esta compu ya tiene su campaña abierta: al cargar la página la sala guardada manda y la lista no se pide.
    guardarOrg(x.m.almacen, { sala: { ...SALA, red: "mainnet" }, fase: "abierta", cuenta: CUENTA });
    x.m.sala.viva = true;
    x.m.sala.fase = "abierta";
    const p = nuevoPanel(x.m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await suelta(8);
    expect(x.listas).toEqual([]);
    expect(vistaDe(p)).toBe("abierta");
  });

  it("sin sesión, Ver tus campañas pide entrar con Google, y entrar trae la lista", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] }, conDireccion: false });
    x.m.cuenta = null;
    const p = await abrir(x);
    boton(p, "Ver tus campañas").click();
    await suelta(4);
    expect(vistaDe(p)).toBe("tus");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
    expect(texto(p, "#cpo-h")).toBe("Tus campañas");
    expect(x.listas).toEqual([]);
    boton(p, "Entrar con Google").click();
    expect(x.entradas).toBe(1);
    x.m.cuenta = CUENTA;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
    await suelta(8);
    expect(x.listas).toHaveLength(1);
    expect(filasTus(p)).toHaveLength(1);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Usar en esta compu"]);
  });

  it("si entra otra cuenta, las filas de la anterior salen de la vista y se pide la de la nueva", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    const p = await abrir(x);
    expect(vistaDe(p)).toBe("tus");
    x.lista = { ok: true, campanas: [] };
    x.m.cuenta = OTRA;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: OTRA }));
    await suelta(8);
    expect(vistaDe(p)).toBe("elegir");
    expect(filasTus(p)).toEqual([]);
    expect(x.listas).toHaveLength(2);
  });
});

describe("la sala que todavía no tiene Tus campañas", () => {
  it("no se pide la lista, no hay enlace ni mensaje, y se le pregunta una sola vez por pestaña", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("abierta")] }, hay: false });
    const p = await abrir(x);
    expect(x.preguntas).toBe(1);
    expect(x.listas).toEqual([]);
    expect(vistaDe(p)).toBe("elegir");
    expect(textosDeBotones(p)).not.toContain("Ver tus campañas");
    expect(texto(p, "#cpo-aviso")).toBe("");
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
    await suelta(8);
    expect(x.preguntas).toBe(1);
    expect(x.listas).toEqual([]);
  });

  it("si la sala no contestó, no se ofrece nada y se vuelve a preguntar cuando hace falta", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("abierta")] }, hay: null });
    const p = await abrir(x);
    expect(x.listas).toEqual([]);
    expect(textosDeBotones(p)).not.toContain("Ver tus campañas");
    // Contesta la próxima vez: entra la sesión y la lista se pide sola.
    x.hay = true;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: CUENTA }));
    await suelta(8);
    expect(x.preguntas).toBe(2);
    expect(vistaDe(p)).toBe("tus");
  });

  it("con la sala que sí la tiene, el enlace sale y la lista se pide aunque llegue antes que la respuesta", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    const p = await abrir(x);
    expect(x.preguntas).toBe(1);
    expect(vistaDe(p)).toBe("tus");
  });
});

describe("una lista que no sirve deja la vista de siempre", () => {
  const vistaDeSiempre = (p: Panel): void => {
    expect(vistaDe(p)).toBe("elegir");
    expect(texto(p, "#cpo-h")).toBe("Campaña de una empresa");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Elegir el archivo"]);
    expect(textosDeBotones(p)).toContain("Ver tus campañas");
  };

  it("la lista vacía, y la que trae solo campañas terminadas", async () => {
    for (const campanas of [[], [terminada()], [fila({ cierraMs: AHORA - HORA })]]) {
      document.body.innerHTML = "";
      cerrarTodos();
      const x = armar({ lista: { ok: true, campanas } });
      const p = await abrir(x);
      vistaDeSiempre(p);
      expect(texto(p, "#cpo-aviso")).toBe("");
    }
  });

  it("cada falla, sin ningún error a la vista cuando se pidió sola", async () => {
    for (const motivo of ["sin-funcion", "sesion", "no-google", "sin-billetera", "limite", "forma"] as const) {
      document.body.innerHTML = "";
      cerrarTodos();
      const x = armar({ lista: { ok: false, motivo } });
      const p = await abrir(x);
      vistaDeSiempre(p);
      expect(texto(p, "#cpo-aviso")).toBe("");
    }
  });

  it("tras la falla de Ver tus campañas el enlace sigue ahí para probar de nuevo, y a la segunda sale la lista", async () => {
    const x = armar({ lista: { ok: false, motivo: "sin-funcion" }, conDireccion: false });
    const p = await abrir(x);
    boton(p, "Ver tus campañas").click();
    await suelta(8);
    expect(texto(p, "#cpo-aviso")).toBe("No pudimos mirar tus campañas. Probá de nuevo.");
    expect(textosDeBotones(p)).toContain("Ver tus campañas");
    x.lista = { ok: true, campanas: [viva("abierta")] };
    boton(p, "Ver tus campañas").click();
    await suelta(8);
    expect(vistaDe(p)).toBe("tus");
    expect(texto(p, "#cpo-aviso")).toBe("");
  });

  it("una lista que lanza no rompe nada", async () => {
    const x = armar();
    x.m.deps.tus = { ...(x.m.deps.tus as NonNullable<typeof x.m.deps.tus>), listar: async () => Promise.reject(new TypeError("Failed to fetch")) };
    const p = await abrir(x);
    vistaDeSiempre(p);
  });

  it("lo que pide quien toca Ver tus campañas se contesta con una línea y no con un error sin salida", async () => {
    const casos: [ResultadoDeMisCampanas, string][] = [
      [{ ok: true, campanas: [] }, "Por ahora no hay campañas para mostrar."],
      [{ ok: true, campanas: [terminada()] }, "Por ahora no hay campañas para mostrar."],
      // Una falla nunca se dice como que no hay campañas: la empresa podría creer que la perdió y armar y pagar otra.
      [{ ok: false, motivo: "sin-funcion" }, "No pudimos mirar tus campañas. Probá de nuevo."],
      [{ ok: false, motivo: "no-google" }, "No pudimos mirar tus campañas. Probá de nuevo."],
      [{ ok: false, motivo: "sin-billetera" }, "No pudimos mirar tus campañas. Probá de nuevo."],
      [{ ok: false, motivo: "forma" }, "No pudimos mirar tus campañas. Probá de nuevo."],
      [{ ok: false, motivo: "sesion" }, "Tu sesión venció."],
      [{ ok: false, motivo: "limite" }, "Sin conexión. Probá de nuevo."],
    ];
    for (const [lista, dicho] of casos) {
      document.body.innerHTML = "";
      cerrarTodos();
      const x = armar({ lista, conDireccion: false });
      const p = await abrir(x);
      boton(p, "Ver tus campañas").click();
      await suelta(8);
      vistaDeSiempre(p);
      expect(texto(p, "#cpo-aviso")).toBe(dicho);
    }
  });
});

describe("lo que dice cada fila", () => {
  it.each<[string, CampanaDeCuenta, string, boolean]>([
    ["lista para abrir", viva("lista"), "Lista para abrir la inscripción.", true],
    ["abierta con una persona", viva("abierta", { total: 1 }), "Inscripción abierta. 1 persona en la lista.", true],
    ["abierta con varias", viva("abierta", { total: 37 }), "Inscripción abierta. 37 personas en la lista.", true],
    ["cerrada", viva("cerrada"), "Lista cerrada. Falta sellarla.", true],
    ["sellada", viva("sellada"), "Se sortea en la compu donde se selló.", false],
    ["sorteada", viva("sorteada"), "Ya se sorteó. Avisá a quien ganó.", true],
  ])("%s", async (_n, campana, linea, conBoton) => {
    const x = armar({ lista: { ok: true, campanas: [campana, terminada()] } });
    const p = await abrir(x);
    const filas = filasTus(p);
    expect(filas.map((f) => [f.empresa, f.linea])).toEqual([
      ["Alcancía Andina", linea],
      ["Café Sucre", expect.stringMatching(/^Terminó el .+\.$/u) as unknown as string],
    ]);
    expect(filas[0]?.botones).toEqual(conBoton ? ["primary:Usar en esta compu"] : []);
    expect(filas[1]?.botones).toEqual([]);
    // Siempre hay una sola acción principal: si ninguna fila se puede usar, lo es Hacer otro sorteo.
    expect(principales(p).map((b) => b.textContent)).toEqual([conBoton ? "Usar en esta compu" : "Hacer otro sorteo"]);
  });

  it("la sellada ofrece Pedir ayuda, con el nombre de la empresa en el asunto", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("sellada")] } });
    const p = await abrir(x);
    expect(filasTus(p)[0]?.ayuda).toBe("mailto:ayuda@prueba.test?subject=" + encodeURIComponent("Ayuda con la campaña de Alcancía Andina"));
    expect(p.raiz.querySelector("#cpo-tus a")?.textContent).toBe("Pedir ayuda");
  });

  it("la primera fila que se puede usar lleva el botón principal y las demás el secundario, con como mucho tres filas", async () => {
    const campanas = [
      viva("sellada", { evento: "uno-k3f9", empresa: "Uno" }),
      viva("lista", { evento: "dos-k3f9", empresa: "Dos" }),
      fila({ evento: "tres-k3f9", empresa: "Tres" }),
      fila({ evento: "cuatro-k3f9", empresa: "Cuatro", abreMs: AHORA + 4 * HORA }),
    ];
    const x = armar({ lista: { ok: true, campanas } });
    const p = await abrir(x);
    expect(filasTus(p).map((f) => [f.empresa, f.botones])).toEqual([
      ["Uno", []],
      // Con más de una que se puede usar, el botón de la barra dice de cuál habla.
      ["Dos", ["primary:Usar Dos en esta compu"]],
      ["Tres", ["ghost:Usar en esta compu"]],
    ]);
    expect(principales(p)).toHaveLength(1);
    expect(p.raiz.querySelector("#cpo-tus .cpo-tus-primera .cpo-tus-nombre")?.textContent).toBe("Dos");
  });

  it("ordena la que tiene su sala abierta primero, después las activadas por la hora de abrir y al final las terminadas", async () => {
    const campanas = [
      terminada(),
      fila({ evento: "tarde-k3f9", empresa: "Tarde", abreMs: AHORA + 5 * HORA }),
      fila({ evento: "pronto-k3f9", empresa: "Pronto", abreMs: AHORA + 2 * HORA }),
      viva("lista", { evento: "viva-k3f9", empresa: "Viva" }),
    ];
    const x = armar({ lista: { ok: true, campanas } });
    const p = await abrir(x);
    expect(filasTus(p).map((f) => f.empresa)).toEqual(["Viva", "Pronto", "Tarde"]);
  });

  it("una activada que ya se puede preparar dice cuándo abre", async () => {
    const abre = AHORA + 3 * HORA;
    const x = armar({ lista: { ok: true, campanas: [fila({ abreMs: abre })] } });
    const p = await abrir(x);
    const dia = fechaTexto(abre, "America/La_Paz", "es");
    const hora = horaTexto(abre, "America/La_Paz", "es");
    expect(filasTus(p)[0]?.linea).toBe(`Abre el ${dia} a las ${hora}.`);
    expect(filasTus(p)[0]?.botones).toEqual(["primary:Usar en esta compu"]);
  });

  it("la hora del texto y la del botón son una sola: en la frontera, un milisegundo antes no hay botón y a la hora sí", async () => {
    const sorteoMs = AHORA + 30 * HORA;
    const desde = desdeCuandoSePuedePreparar(sorteoMs);
    expect(cabeAbrirYa(sorteoMs, desde - 1)).toBe(false);
    expect(cabeAbrirYa(sorteoMs, desde)).toBe(true);
    const campana = fila({ sorteoMs, abreMs: sorteoMs - 2 * HORA, cierraMs: sorteoMs - HORA });
    const antes = armar({ lista: { ok: true, campanas: [campana] } });
    antes.m.ahora = desde - 1;
    const p = await abrir(antes);
    const dia = fechaTexto(desde, "America/La_Paz", "es");
    const hora = horaTexto(desde, "America/La_Paz", "es");
    expect(filasTus(p)[0]?.linea).toBe(`Se puede preparar desde el ${dia} a las ${hora}.`);
    expect(filasTus(p)[0]?.botones).toEqual([]);
    cerrarTodos();
    document.body.innerHTML = "";
    const justo = armar({ lista: { ok: true, campanas: [campana] } });
    justo.m.ahora = desde;
    const q = await abrir(justo);
    expect(filasTus(q)[0]?.botones).toEqual(["primary:Usar en esta compu"]);
    expect(filasTus(q)[0]?.linea).toMatch(/^Abre el /u);
  });

  it("en inglés las filas, la línea y los botones salen en inglés", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("abierta", { total: 2 }), terminada()] } });
    x.m.idioma = "en";
    const p = await abrir(x);
    expect(texto(p, "#cpo-h")).toBe("Your campaigns");
    expect(texto(p, "#cpo-linea")).toBe("Pick the one you'll use on this computer.");
    expect(filasTus(p)[0]?.linea).toBe("Sign-ups open. 2 people on the list.");
    expect(filasTus(p)[0]?.botones).toEqual(["primary:Use on this computer"]);
    expect(textosDeBotones(p)).toContain("Run another draw");
  });

  it("Hacer otro sorteo lleva a la vista de elegir el archivo, y Ver tus campañas vuelve a pedir la lista", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("sellada")] } });
    const p = await abrir(x);
    boton(p, "Hacer otro sorteo").click();
    expect(vistaDe(p)).toBe("elegir");
    expect(filasTus(p)).toEqual([]);
    boton(p, "Ver tus campañas").click();
    await suelta(8);
    expect(vistaDe(p)).toBe("tus");
    expect(x.listas).toHaveLength(2);
  });
});

describe("usar en esta compu con la sala abierta", () => {
  it("con la lista lista se usa directo, sin preguntar", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    x.respuestas.push(vivaDeLaSala("lista"));
    x.m.sala.viva = true;
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    expect(x.usadas).toEqual([["sesion-de-prueba", EVENTO]]);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  async function conAbiertaEnOtraCompu(): Promise<{ x: Mundillo; p: Panel }> {
    const x = armar({ lista: { ok: true, campanas: [viva("abierta", { total: 2 })] } });
    x.m.sala.viva = true;
    x.m.sala.fase = "abierta";
    x.m.sala.enSala.add(1);
    x.m.sala.enSala.add(2);
    const p = await abrir(x);
    return { x, p };
  }

  it("con la inscripción abierta pregunta antes, con un título, una línea y dos botones, y Cancelar vuelve a la lista", async () => {
    const { x, p } = await conAbiertaEnOtraCompu();
    boton(p, "Usar en esta compu").click();
    expect(vistaDe(p)).toBe("seguir");
    expect(texto(p, "#cpo-h")).toBe("¿Usar la campaña en esta compu?");
    expect(texto(p, "#cpo-linea")).toBe("La otra compu deja de manejarla.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Sí, usarla aquí"]);
    expect(textosDeBotones(p)).toEqual(["Sí, usarla aquí", "Cancelar"]);
    expect(x.usadas).toEqual([]);
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("tus");
    expect(filasTus(p)).toHaveLength(1);
    expect(x.usadas).toEqual([]);
  });

  it("también pregunta con la lista cerrada, y al confirmar se toma: la clave de los nombres es nueva y el QR la lleva", async () => {
    const { x, p } = await conAbiertaEnOtraCompu();
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await suelta(6);
    expect(x.usadas).toEqual([["sesion-de-prueba", EVENTO]]);
    const memoria = leerOrg(x.m.almacen, x.m.ahora, "mainnet", CUENTA);
    expect(memoria?.sala.token).toBe(TOKEN_NUEVO);
    expect(memoria?.sala.id).toBe("AbCd1234");
    expect(memoria?.cuenta).toBe(CUENTA);
    expect(memoria?.recuperada).toBe(true);
    expect(memoria?.sala.clave).not.toBe(CLAVE);
    expect(tokenDeEvento(x.m.almacen, EVENTO, CUENTA)).toBe(TOKEN_NUEVO);
    const enlace = x.m.qrs.at(-1)?.texto ?? "";
    expect(enlace.split("#")[1]).toBe(memoria?.sala.clave);
    expect(enlace).toContain("s=AbCd1234");
    expect(JSON.stringify(x.m.qrs)).not.toContain(TOKEN_NUEVO);
    // Con la lista cerrada la pregunta es la misma.
  });

  it("con la lista cerrada también pregunta", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("cerrada")] } });
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    expect(vistaDe(p)).toBe("seguir");
  });

  it("las personas anotadas antes salen con su número y la línea lo dice, y quien vuelve a escanear el QR nuevo aparece con su nombre", async () => {
    const { x, p } = await conAbiertaEnOtraCompu();
    // Las dos anotadas antes de la toma cifraron su nombre con la clave de la compu anterior.
    const viejo = await cifrarEquipo(CLAVE, { nombre: "Ana", integrantes: [] });
    x.m.paginas.push([
      { n: 1, cuenta: "CUENTA1", d: viejo, estado: "aceptado", v: 1 },
      { n: 2, cuenta: "CUENTA2", d: viejo, estado: "aceptado", v: 2 },
    ]);
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Persona 2", "Persona 1"]));
    expect(texto(p, "#cpo-antes")).toBe("Quienes se anotaron antes salen con su número. Si escanean el QR de nuevo, aparece su nombre.");
    // La línea no empuja la acción principal: va debajo del QR, con la lista, y la línea de arriba queda vacía.
    expect($(p, "#cpo-lista #cpo-antes")).not.toBeNull();
    expect(texto(p, "#cpo-linea")).toBe("");
    expect(texto(p, "#cpo-n")).toBe("2");
    // La primera vuelve a escanear el QR nuevo: su nombre llega cifrado con la clave nueva y la fila cambia.
    const claveNueva = leerOrg(x.m.almacen, x.m.ahora, "mainnet", CUENTA)?.sala.clave ?? "";
    const nuevo = await cifrarEquipo(claveNueva, { nombre: "Ana", integrantes: [] });
    x.m.escucha().alEquipo?.({ n: 1, cuenta: "CUENTA1", d: nuevo, estado: "aceptado", v: 5 });
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Persona 2", "Ana"]));
    expect(texto(p, "#cpo-antes")).toBe("Quienes se anotaron antes salen con su número. Si escanean el QR de nuevo, aparece su nombre.");
    // Quien entra después con el QR nuevo aparece con su nombre desde el principio, y cuando ya nadie queda sin nombre la línea se va.
    const otro = await cifrarEquipo(claveNueva, { nombre: "Nora", integrantes: [] });
    x.m.escucha().alEquipo?.({ n: 2, cuenta: "CUENTA2", d: otro, estado: "aceptado", v: 6 });
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Nora", "Ana"]));
    expect(texto(p, "#cpo-antes")).toBe("");
  });

  it("en inglés la línea de quienes se anotaron antes sale en inglés", async () => {
    const { x, p } = await conAbiertaEnOtraCompu();
    x.m.idioma = "en";
    p.pintar();
    const viejo = await cifrarEquipo(CLAVE, { nombre: "Ana", integrantes: [] });
    x.m.paginas.push([{ n: 1, cuenta: "CUENTA1", d: viejo, estado: "aceptado", v: 1 }]);
    boton(p, "Use on this computer").click();
    boton(p, "Yes, use it here").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await vi.waitFor(() => expect(texto(p, "#cpo-antes")).toBe("People who signed up earlier show with their number. If they scan the QR again, their name appears."));
  });

  it("con la lista cerrada la línea es la primera frase sola", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("cerrada", { total: 1 })] } });
    x.respuestas.push(vivaDeLaSala("cerrada"));
    x.m.sala.viva = true;
    x.m.sala.fase = "cerrada";
    x.m.sala.enSala.add(1);
    const viejo = await cifrarEquipo(CLAVE, { nombre: "Ana", integrantes: [] });
    x.m.paginas.push([{ n: 1, cuenta: "CUENTA1", d: viejo, estado: "aceptado", v: 1 }]);
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    await vi.waitFor(() => expect(texto(p, "#cpo-antes")).toBe("Quienes se anotaron antes salen con su número."));
  });

  it("mientras se toma, ningún otro toque actúa", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista"), fila({ evento: "otra-k3f9", empresa: "Otra" })] } });
    let soltar: () => void = () => undefined;
    x.espera = new Promise<void>((r) => (soltar = r));
    const p = await abrir(x);
    // La principal de la primera está en la barra de abajo, y la de la segunda en su fila.
    const delaBarra = principales(p)[0] as HTMLButtonElement;
    const deLaFila = p.raiz.querySelector<HTMLButtonElement>("#cpo-tus button[data-evento]") as HTMLButtonElement;
    expect(delaBarra.textContent).toBe("Usar Alcancía Andina en esta compu");
    delaBarra.click();
    await suelta(4);
    expect((principales(p)[0] as HTMLButtonElement).disabled).toBe(true);
    expect(p.raiz.querySelector<HTMLButtonElement>("#cpo-tus button[data-evento]")?.disabled).toBe(true);
    deLaFila.click();
    await suelta(4);
    expect(x.usadas).toHaveLength(1);
    soltar();
    await suelta(8);
    expect(x.usadas).toHaveLength(1);
  });

  it("si la sesión no se puede pedir, dice que venció y no toca la sala", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    const p = await abrir(x);
    x.sesion = null;
    boton(p, "Usar en esta compu").click();
    await suelta(8);
    expect(vistaDe(p)).toBe("tus");
    expect(filasTus(p)[0]?.linea).toBe("Tu sesión venció.");
    expect(x.usadas).toEqual([]);
  });
});

describe("usar en esta compu con la sala sorteada", () => {
  it("arma lo que recuerda esta compu del sorteo antes de mostrar la campaña, y la memoria queda guardada con la cuenta", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("sorteada")] } });
    x.respuestas.push(vivaDeLaSala("sorteada"));
    x.m.sala.viva = true;
    x.m.sala.fase = "cerrada";
    const p = await abrir(x);
    x.m.respuestaAlEstado.push({ fase: "sorteada", total: 5, cierraMs: AHORA });
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    expect(x.sorteos).toEqual([{ evento: EVENTO, cuenta: CUENTA }]);
    expect(leerOrg(x.m.almacen, x.m.ahora, "mainnet", CUENTA)?.fase).toBe("sorteada");
  });
});

describe("usar en esta compu con la campaña activada y sin sala", () => {
  async function conActivada(anterior: string | null): Promise<{ x: Mundillo; p: Panel }> {
    const x = armar({ lista: { ok: true, campanas: [fila()] } });
    x.respuestas.push(activadaDeLaSala(anterior));
    const p = await abrir(x);
    return { x, p };
  }

  it("crea la sala sin vista previa y llega a Abrir la inscripción, sin pedir otro pago", async () => {
    const { x, p } = await conActivada(null);
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    await suelta(4);
    expect(x.m.creadas).toHaveLength(1);
    expect(x.m.creadas[0]?.de.anterior).toBeNull();
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
    expect(textosDeBotones(p).some((t) => /Pagar|Cargar/u.test(t))).toBe(false);
    expect(x.m.fases).toEqual([]);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.m.fases[0]?.[0]).toBe("abierta");
  });

  it("con el token anterior de una sala que murió sin sellar, crea la sala con ese token", async () => {
    const { x, p } = await conActivada(TOKEN_ANTERIOR);
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    expect(x.m.creadas[0]?.de.anterior).toBe(TOKEN_ANTERIOR);
    // Con la sala creada, lo que se recuerda del evento es el token de la sala nueva.
    expect(tokenDeEvento(x.m.almacen, EVENTO, CUENTA)).toBe(TOKEN);
  });

  it("nunca muestra lo que cobra Tinkazo mientras se crea la sala", async () => {
    const { x, p } = await conActivada(null);
    // Al crear la sala la pantalla es la de espera: no está la vista previa con lo que cobra Tinkazo.
    const vistaAlCrear: string[] = [];
    const crear = x.m.deps.crear;
    x.m.deps.crear = async (a, de) => {
      vistaAlCrear.push(vistaDe(p));
      return crear(a, de);
    };
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    await suelta(4);
    expect(vistaAlCrear).toEqual(["cargando"]);
    expect(x.m.creadas).toHaveLength(1);
  });

  it("un archivo que ya venció se dice en la fila y no deja nada a medias", async () => {
    const x = armar({ lista: { ok: true, campanas: [fila()] } });
    x.m.ahora = AHORA;
    const vencida = JSON.parse(archivoDe({ cierra_ms: AHORA - 1000, sorteo_ms: AHORA + 1000, abre_ms: AHORA - 2000 })) as { texto: string; firma: string };
    x.respuestas.push({ ok: true, estado: "activada", archivo: vencida, anterior: null });
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(filasTus(p)[0]?.linea).toBe("Esta campaña ya terminó."));
    expect(vistaDe(p)).toBe("tus");
    expect(x.m.creadas).toEqual([]);
  });
});

describe("cuando no se puede usar acá", () => {
  async function fallando(motivo: MotivoDeRecuperar, campana = viva("lista")): Promise<{ x: Mundillo; p: Panel }> {
    const x = armar({ lista: { ok: true, campanas: [campana] } });
    x.respuestas.push(noSale(motivo));
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    // Con la inscripción abierta o la lista cerrada se pregunta antes de usarla.
    if (vistaDe(p) === "seguir") boton(p, "Sí, usarla aquí").click();
    await suelta(8);
    return { x, p };
  }

  it("terminada dice que ya terminó, sin botón", async () => {
    const { p } = await fallando("terminada");
    expect(vistaDe(p)).toBe("tus");
    expect(texto(p, "#cpo-h")).toBe("Tus campañas");
    expect(filasTus(p)[0]).toMatchObject({ linea: "Esta campaña ya terminó.", botones: [] });
  });

  it("sellada vuelve a pintar la fila como sellada, con su ayuda", async () => {
    const { p } = await fallando("sellada");
    expect(filasTus(p)[0]?.linea).toBe("Se sortea en la compu donde se selló.");
    expect(filasTus(p)[0]?.botones).toEqual([]);
    expect(p.raiz.querySelector("#cpo-tus a")?.textContent).toBe("Pedir ayuda");
  });

  it.each<[MotivoDeRecuperar]>([["limite"]])("%s dice que pruebe en un rato y deja el botón", async (motivo) => {
    const { p } = await fallando(motivo);
    expect(filasTus(p)[0]).toMatchObject({ linea: "Probá de nuevo en un rato. Tu pago está a salvo.", botones: ["primary:Usar en esta compu"] });
  });

  it("la sesión vencida lo dice con su línea", async () => {
    const { p } = await fallando("sesion");
    expect(filasTus(p)[0]?.linea).toBe("Tu sesión venció.");
  });

  it("la campaña que ya no existe lo dice y no deja botón", async () => {
    const { p } = await fallando("no-existe");
    expect(filasTus(p)[0]).toMatchObject({ linea: "Esta lista ya no existe.", botones: [] });
  });

  it.each<[MotivoDeRecuperar]>([["red"], ["sin-funcion"], ["ocupado"], ["forma"], ["no-google"], ["sin-billetera"]])("%s dice que no se pudo abrir y ofrece probar de nuevo, sin volver a preguntar", async (motivo) => {
    const { x, p } = await fallando(motivo, viva("abierta"));
    // La confirmación de una campaña abierta ya se dio: tras la falla se reintenta con un toque.
    expect(vistaDe(p)).toBe("tus");
    expect(filasTus(p)[0]).toMatchObject({ linea: "No pudimos abrirla aquí. Probá de nuevo.", botones: ["primary:Probar de nuevo"] });
    x.respuestas.push(vivaDeLaSala("abierta"));
    x.m.sala.viva = true;
    x.m.sala.fase = "abierta";
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("una falla de la confirmación vuelve a la lista con el motivo en la fila", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("abierta")] } });
    x.respuestas.push(noSale("terminada"));
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await suelta(8);
    expect(vistaDe(p)).toBe("tus");
    expect(filasTus(p)[0]?.linea).toBe("Esta campaña ya terminó.");
  });

  it("si leer el archivo lanza, la fila lo dice y el botón vuelve a andar", async () => {
    const x = armar({ lista: { ok: true, campanas: [fila()] } });
    x.respuestas.push(activadaDeLaSala(null));
    x.m.deps.validar = async () => Promise.reject(new Error("sin lector"));
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(filasTus(p)[0]?.linea).toBe("No pudimos abrirla aquí. Probá de nuevo."));
    expect(vistaDe(p)).toBe("tus");
    expect(filasTus(p)[0]?.botones).toEqual(["primary:Probar de nuevo"]);
    expect(x.m.creadas).toEqual([]);
  });

  it("si al tomar la sala no se puede leerla, la campaña no se pierde: queda guardada y se ofrece probar de nuevo", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    x.m.deps.campanaDeSala = async () => Promise.reject(new Error("sin red"));
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sin-red"));
    expect(leerOrg(x.m.almacen, x.m.ahora, "mainnet", CUENTA)?.sala.token).toBe(TOKEN_NUEVO);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
  });

  it("si la sala lanza, no rompe: se dice que no se pudo", async () => {
    const x = armar({ lista: { ok: true, campanas: [viva("lista")] } });
    x.m.deps.tus = { ...(x.m.deps.tus as NonNullable<typeof x.m.deps.tus>), recuperar: async () => Promise.reject(new TypeError("Failed to fetch")) };
    const p = await abrir(x);
    boton(p, "Usar en esta compu").click();
    await suelta(8);
    expect(filasTus(p)[0]?.linea).toBe("No pudimos abrirla aquí. Probá de nuevo.");
  });
});

describe("un evento que ya tiene sala, al abrir el archivo", () => {
  async function conSalaAjena(x: Mundillo): Promise<Panel> {
    const p = await abrir(x);
    x.m.sala.viva = true;
    x.m.sala.intento = "de-otra-compu";
    await elegirArchivo(x.m, p, archivoDe());
    expect(vistaDe(p)).toBe("previa");
    return p;
  }

  it("con la sesión ofrece usar la campaña acá en lugar de mandar a pedir otro archivo", async () => {
    const x = armar();
    const p = await conSalaAjena(x);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("seguir"));
    expect(texto(p, "#cpo-h")).toBe("¿Usar la campaña en esta compu?");
    expect(texto(p, "#cpo-aviso")).toBe("");
    expect(texto(p, "#cpo-linea")).toBe("La otra compu deja de manejarla.");
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("previa");
    expect(texto(p, "#cpo-aviso")).toBe("");
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("seguir"));
    x.m.sala.fase = "abierta";
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.usadas).toEqual([["sesion-de-prueba", EVENTO]]);
  });

  it("sin la sesión sigue como siempre: dice que se pida otro archivo", async () => {
    const x = armar();
    const p = await conSalaAjena(x);
    x.m.cuenta = null;
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Ya se abrió. Pedile otro archivo a Tinkazo."));
    expect(vistaDe(p)).toBe("previa");
  });

  it("en el modo Prueba sigue como siempre", async () => {
    const x = armar();
    x.m.red = "testnet";
    const p = await conSalaAjena(x);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Ya se abrió. Pedile otro archivo a Tinkazo."));
  });
});

describe("la campaña que tomó otra compu", () => {
  async function tomada(x: Mundillo): Promise<Panel> {
    const p = nuevoPanel(x.m);
    await abrirInscripcion(x.m, p);
    x.m.respuestasAlPase.push("token");
    await x.m.correr(120_000);
    expect(vistaDe(p)).toBe("tomada");
    return p;
  }

  it("con la cuenta conectada ofrece Usar en esta compu y deja Dejar esta campaña como enlace", async () => {
    const x = armar({ conDireccion: false });
    const p = await tomada(x);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Usar en esta compu"]);
    expect(textosDeBotones(p)).toContain("Dejar esta campaña");
    expect(botones(p).find((b) => b.textContent === "Dejar esta campaña")?.className).toBe("enlace");
  });

  it("con la inscripción abierta pregunta, y al confirmar toma la campaña de nuevo con un token nuevo", async () => {
    const x = armar({ conDireccion: false });
    const p = await tomada(x);
    x.respuestas.push(vivaDeLaSala("abierta"));
    boton(p, "Usar en esta compu").click();
    expect(vistaDe(p)).toBe("seguir");
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("tomada");
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(leerOrg(x.m.almacen, x.m.ahora, "mainnet", CUENTA)?.sala.token).toBe(TOKEN_NUEVO);
  });

  it("si no se puede, lo dice en la misma pantalla y deja Dejar esta campaña", async () => {
    const x = armar({ conDireccion: false });
    const p = await tomada(x);
    x.respuestas.push(noSale("red"));
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("No pudimos abrirla aquí. Probá de nuevo."));
    expect(vistaDe(p)).toBe("tomada");
    expect(texto(p, "#cpo-h")).toBe("Tu campaña sigue en otra compu");
    expect(textosDeBotones(p)).toContain("Dejar esta campaña");
  });

  it("con una sala que todavía no tiene Tus campañas, el único botón es Dejar esta campaña: no hay un Usar que nunca puede funcionar", async () => {
    const x = armar({ conDireccion: false, hay: false });
    const p = await tomada(x);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Dejar esta campaña"]);
    expect(textosDeBotones(p)).toEqual(["Dejar esta campaña"]);
    expect(x.usadas).toEqual([]);
  });

  it("si la sala no había contestado, la pantalla de tomada vuelve a preguntar y ofrece Usar cuando contesta que sí", async () => {
    const x = armar({ conDireccion: false, hay: null });
    const p = nuevoPanel(x.m);
    await abrirInscripcion(x.m, p);
    x.hay = true;
    x.m.respuestasAlPase.push("token");
    await x.m.correr(120_000);
    await suelta(8);
    expect(vistaDe(p)).toBe("tomada");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Usar en esta compu"]);
  });

  it("si al tocar Usar la sala dice que no tiene la función, lo dice y deja Dejar esta campaña como única salida", async () => {
    const x = armar({ conDireccion: false });
    const p = await tomada(x);
    x.respuestas.push(noSale("sin-funcion"));
    boton(p, "Usar en esta compu").click();
    boton(p, "Sí, usarla aquí").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Todavía no se puede usar desde otra compu."));
    expect(vistaDe(p)).toBe("tomada");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Dejar esta campaña"]);
    expect(textosDeBotones(p)).toEqual(["Dejar esta campaña"]);
    expect(x.usadas).toHaveLength(1);
  });

  it("sin la cuenta conectada, o en Prueba, el único botón es Dejar esta campaña, como antes", async () => {
    const x = armar({ conDireccion: false });
    x.m.red = "testnet";
    const p = await tomada(x);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Dejar esta campaña"]);
    expect(textosDeBotones(p)).toEqual(["Dejar esta campaña"]);
  });
});

describe("sin Tus campañas el panel es el de siempre", () => {
  it("sin las dependencias no hay enlace, no se pide nada y la pantalla de tomada tiene un solo botón", async () => {
    const m = mundo();
    m.red = "mainnet";
    m.cuenta = CUENTA;
    const p = nuevoPanel(m);
    await suelta(8);
    expect(vistaDe(p)).toBe("elegir");
    expect(textosDeBotones(p)).not.toContain("Ver tus campañas");
    expect($(p, "#cpo-tus")).toBeNull();
    ponerPaso({ paso: "nada" });
  });
});
