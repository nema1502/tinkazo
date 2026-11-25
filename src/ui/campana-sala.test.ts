// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El panel de quien organiza una campaña, con un DOM de mentira, una sala de mentira y un reloj que solo se mueve cuando
 * la prueba lo mueve: elegir el archivo, abrir la inscripción, el QR y su pase, la lista, quitar con motivo, cerrar y
 * retomar después de una recarga. Los textos que se comparan están escritos a mano: son lo que lee la persona.
 */

const h = vi.hoisted(() => ({ red: null as "testnet" | "mainnet" | null }));
// El modo de la pestaña, que las pruebas de "una campaña es del modo en que se abrió" cambian a mano.
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" && h.red ? h.red : Reflect.get(t, k)) }) };
});
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { type PasoDelPuente, ponerPaso } from "../campana/puente";
import { nadaSeAbreSolo } from "./cuenta-lista-flujo";
import { CLAVE_EVENTOS_ORG, CLAVE_INTENTOS_ORG, CLAVE_ORG, guardarOrg, leerOrg } from "../sala/campana-org";
import { montarPanelDeCampana } from "./campana-sala";
import {
  $,
  AHORA,
  SALA,
  TOKEN,
  type Mundo,
  type Panel,
  abrirInscripcion,
  alta,
  archivoDe,
  boton,
  botonDeFila,
  botones,
  bus,
  cerrarTodos,
  confirmarCierre,
  elegirArchivo,
  equipoDe,
  filaDe,
  filasDe,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
} from "./campana-sala-mundo";

const ponerRed = (m: Mundo, red: "testnet" | "mainnet"): void => {
  h.red = red;
  m.red = red;
};

beforeEach(() => {
  document.body.innerHTML = "";
  h.red = null;
});
afterEach(() => {
  cerrarTodos();
  vi.restoreAllMocks();
});

describe("elegir el archivo", () => {
  it("al elegir el archivo hay un enlace a crear-campana.html con su texto y no es un botón principal", () => {
    const p = nuevoPanel(mundo());
    const enlace = p.raiz.querySelector<HTMLAnchorElement>("a[href=\"/crear-campana.html\"]");
    expect(enlace?.textContent).toBe("¿Todavía no tenés tu campaña? Armala.");
    expect(enlace?.className).toBe("enlace");
    expect(p.raiz.querySelectorAll(".cpo-acciones .primary")).toHaveLength(1);
  });

  it("un archivo que no es JSON dice que no es una campaña y no crea nada", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, "esto no es un archivo de campaña");
    expect(texto(p, "#cpo-aviso")).toBe("Este archivo no es una campaña.");
    expect(m.creadas).toHaveLength(0);
  });

  it("un archivo sin texto o sin firma dice lo mismo", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, JSON.stringify({ firma: "F" }));
    expect(texto(p, "#cpo-aviso")).toBe("Este archivo no es una campaña.");
    await elegirArchivo(m, p, JSON.stringify({ texto: "{}" }));
    expect(texto(p, "#cpo-aviso")).toBe("Este archivo no es una campaña.");
  });

  it("un texto que no valida nombra el campo que dio el lector", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ zona: "Marte/Nada" }));
    expect(texto(p, "#cpo-aviso")).toBe("Revisá el campo zona.");
    expect(vistaDe(p)).toBe("elegir");
  });

  it("un archivo de la otra red pide cambiar de modo", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ red: "mainnet" }));
    expect(texto(p, "#cpo-aviso")).toBe("Es del modo oficial. Cambiá de modo.");
  });

  it("el modo se lee del campo del archivo y no de una palabra suelta del texto", async () => {
    const m = mundo();
    ponerRed(m, "mainnet");
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ red: "testnet", empresa: { nombre: "Mainnet Cafe", logo: null, color: "verde" } }));
    expect(texto(p, "#cpo-aviso")).toBe("Es del modo prueba. Cambiá de modo.");
  });

  it("premios distintos no se aceptan", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ premios: ["400000000", "500000000"] }));
    expect(texto(p, "#cpo-aviso")).toBe("Los premios deben ser iguales.");
  });

  it("una campaña que ya cerró dice que terminó", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ abre_ms: AHORA - 7_200_000, cierra_ms: AHORA - 3_600_000, sorteo_ms: AHORA }));
    expect(texto(p, "#cpo-aviso")).toBe("Esta campaña ya terminó.");
  });

  it("en el modo stand y en el ensayo pide salir primero", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    m.enStand = true;
    await elegirArchivo(m, p, archivoDe());
    expect(texto(p, "#cpo-aviso")).toBe("Salí del modo stand primero.");
    m.enStand = false;
    m.enEnsayo = true;
    await elegirArchivo(m, p, archivoDe());
    expect(texto(p, "#cpo-aviso")).toBe("Salí del ensayo primero.");
    expect(vistaDe(p)).toBe("elegir");
  });

  it("con la demostración el panel no se monta, y sin la bandera tampoco", () => {
    document.body.innerHTML = '<div id="origenes"></div>';
    const m = mundo();
    m.conDemo = true;
    montarPanelDeCampana(m.deps, true);
    expect(document.getElementById("cpo-panel")).toBeNull();
    m.conDemo = false;
    montarPanelDeCampana(m.deps, false);
    expect(document.getElementById("cpo-panel")).toBeNull();
    montarPanelDeCampana(m.deps, true);
    const panel = document.getElementById("cpo-panel");
    expect(panel?.nextElementSibling?.id).toBe("origenes");
  });

  it("la vista previa muestra el premio, la hora y los pedidos de la empresa", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    expect(vistaDe(p)).toBe("previa");
    expect(texto(p, "#cpo-h")).toBe("Sorteo de Alcancía Andina");
    expect(texto(p, "#cpo-linea")).toBe("Cierra a las 17:00. 3 pasos para anotarse.");
    expect(texto(p, "#cpo-premio")).toBe("40 dólares digitales");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("Elegir otro archivo vuelve a elegir sin haber creado nada", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
    expect(m.creadas).toHaveLength(0);
  });

  it("avisa en la vista previa si la campaña pide sellar con otra cuenta", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    const pide = Keypair.random().publicKey();
    m.cuenta = Keypair.random().publicKey();
    await elegirArchivo(m, p, archivoDe({ organizadora: pide }));
    expect(texto(p, "#cpo-aviso")).toBe(`Entrá con la cuenta que termina en ${pide.slice(-4)}.`);
    m.cuenta = pide;
    await elegirArchivo(m, p, archivoDe({ organizadora: pide }));
    expect(texto(p, "#cpo-aviso")).toBe("");
  });
});

describe("abrir la inscripción", () => {
  it("crea la sala, la guarda, la abre y pasa a abierta con su QR", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    expect(m.creadas).toHaveLength(1);
    expect(m.creadas[0]?.de).toEqual({
      evento: "evento-uno",
      red: "testnet",
      anterior: null,
      intento: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
    });
    expect(m.fases).toEqual([["abierta", null]]);
    const guardada = JSON.parse(m.almacen.getItem(CLAVE_ORG) ?? "{}") as { testnet?: { fase: string } };
    expect(guardada.testnet?.fase).toBe("abierta");
    expect(texto(p, "#cpo-h")).toBe("Abierta hasta las 17:00");
    expect($<HTMLImageElement>(p, "#cpo-qr-img").hidden).toBe(false);
    expect(m.qrs).toHaveLength(1);
  });

  it("guarda aparte el token de la sala del evento, y lo manda al crear otra del mismo evento", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    expect(JSON.parse(m.almacen.getItem(CLAVE_EVENTOS_ORG) ?? "[]")).toEqual([{ evento: "evento-uno", token: TOKEN }]);
    p.detener();
    m.almacen.removeItem(CLAVE_ORG);
    const otra = mundo({ almacen: m.almacen });
    const q = nuevoPanel(otra);
    await elegirArchivo(otra, q, archivoDe());
    boton(q, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(otra.creadas).toHaveLength(1));
    expect(otra.creadas[0]?.de.anterior).toBe(TOKEN);
  });

  it("cada falla al crear tiene su texto", async () => {
    const casos: [Mundo["respuestasAlCrear"][number], string][] = [
      ["firma", "Pedile a Tinkazo el archivo firmado."],
      ["ya-existe", "Ya se abrió. Pedile otro archivo a Tinkazo."],
      ["vencida", "Esta campaña ya terminó."],
      ["cupo-campanas", "Cupo de hoy lleno. Avisale a Tinkazo."],
      ["forma", "Este archivo no es una campaña."],
      ["origen", "Sin conexión. Probá de nuevo."],
      ["red", "Sin conexión. Probá de nuevo."],
    ];
    for (const [motivo, esperado] of casos) {
      const m = mundo();
      const p = nuevoPanel(m);
      await elegirArchivo(m, p, archivoDe());
      m.respuestasAlCrear.push(motivo);
      boton(p, "Abrir la inscripción").click();
      await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe(esperado));
      expect(vistaDe(p)).toBe("previa");
      expect(boton(p, "Abrir la inscripción").disabled).toBe(false);
      document.body.innerHTML = "";
    }
  });

  it("mientras abre, la fila dice la etapa y no queda un botón apagado", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    let soltarFase: () => void = () => undefined;
    const fase = m.deps.fase;
    m.deps.fase = async (s, f, c) => {
      await new Promise<void>((r) => {
        soltarFase = r;
      });
      return fase(s, f, c);
    };
    boton(p, "Abrir la inscripción").click();
    // Primero crea la sala, y recién después abre la inscripción.
    expect(texto(p, "#cpo-fila")).toBe("Creando la sala");
    expect(principales(p)).toEqual([]);
    await vi.waitFor(() => expect(texto(p, "#cpo-fila")).toBe("Abriendo la inscripción"));
    soltarFase();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("si la fase falla después de crear, el segundo toque no crea otra sala", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    m.respuestasAFase.push({ falla: "red", llega: false });
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo."));
    expect(boton(p, "Abrir la inscripción").disabled).toBe(false);
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas).toHaveLength(1);
    expect(m.fases).toHaveLength(2);
  });

  it("si la respuesta de abrir se perdió pero la sala sí abrió, sigue sin pedirlo de nuevo", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    m.respuestasAFase.push({ falla: "red", llega: true });
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.fases).toHaveLength(1);
  });

  it("si la respuesta de crear se perdió, el segundo toque repite el intento y recibe la misma sala", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    m.respuestasAlCrear.push("perdida");
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo."));
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas).toHaveLength(2);
    expect(m.creadas[0]?.de.intento).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(m.creadas[1]?.de.intento).toBe(m.creadas[0]?.de.intento);
  });

  it("si la respuesta de crear se perdió y la pestaña se recargó, el mismo archivo repite el intento guardado", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    m.respuestasAlCrear.push("perdida");
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo."));
    expect(m.almacen.getItem(CLAVE_INTENTOS_ORG)).toContain(m.creadas[0]?.de.intento);
    // Recargar: la memoria de la pantalla se pierde, el almacén queda.
    p.detener();
    const q = nuevoPanel(m);
    await elegirArchivo(m, q, archivoDe());
    boton(q, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(q)).toBe("abierta"));
    expect(m.creadas).toHaveLength(2);
    expect(m.creadas[1]?.de.intento).toBe(m.creadas[0]?.de.intento);
    // Con la sala creada y su token guardado, el intento ya no hace falta.
    expect(m.almacen.getItem(CLAVE_INTENTOS_ORG)).toBeNull();
  });

  it("con otro archivo el intento es otro", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe());
    m.respuestasAlCrear.push("red");
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo."));
    // Otro archivo de verdad: otra firma.
    await elegirArchivo(m, p, archivoDe().replace("F".repeat(86), "G".repeat(86)));
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas[1]?.de.intento).not.toBe(m.creadas[0]?.de.intento);
  });

  it("el QR lleva la sala, el pase, el modo y la clave, y nunca el token", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    const enlace = new URL(m.qrs[m.qrs.length - 1]?.texto ?? "");
    expect(enlace.origin + enlace.pathname).toBe("https://tinkazo.app/participar.html");
    expect(enlace.searchParams.get("c")).toBe("evento-uno");
    expect(enlace.searchParams.get("s")).toBe("AbCd1234");
    expect(enlace.searchParams.get("p")).toBe("PASE00000001");
    expect(enlace.searchParams.get("red")).toBe("prueba");
    expect(enlace.hash).toBe(`#${SALA.clave}`);
    expect(enlace.href).not.toContain(TOKEN);
  });

  it("el QR de una campaña oficial lleva el modo oficial", async () => {
    const m = mundo();
    ponerRed(m, "mainnet");
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ red: "mainnet" }));
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await suelta();
    expect(new URL(m.qrs[0]?.texto ?? "").searchParams.get("red")).toBe("oficial");
  });
});

describe("el pase del QR", () => {
  it("pide el QR de tamaño fijo y lo dibuja de nuevo al cambiar la ventana, sin esperar el próximo pase", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    expect(m.qrs).toHaveLength(1);
    expect(m.qrs[0]?.fijo).toBe(true);
    // Un zoom o una ventana que cambia de pantalla dispara varios avisos seguidos: sale un solo dibujo.
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    await m.correr(300);
    expect(m.qrs).toHaveLength(2);
    expect(m.qrs[1]).toEqual({ texto: m.qrs[0]?.texto, ancho: 300, fijo: true });
  });

  it("con el panel cerrado el cambio de ventana no dibuja nada", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    cerrarTodos();
    window.dispatchEvent(new Event("resize"));
    await m.correr(300);
    expect(m.qrs).toHaveLength(1);
  });

  it("no dibuja el QR mientras su recuadro está escondido y lo dibuja de nuevo al volver a verse", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(texto(p, "#cpo-n")).toBe("2"));
    expect(m.qrs).toHaveLength(1);
    boton(p, "Cerrar la lista").click();
    expect(vistaDe(p)).toBe("confirmar");
    expect($(p, "#cpo-qr").hidden).toBe(true);
    // El pase se renueva con el recuadro escondido: no hay dónde medir, así que no se dibuja nada.
    await m.correr(120_000);
    expect(m.pases).toBe(2);
    expect(m.qrs).toHaveLength(1);
    // Un cambio de ventana con el recuadro escondido tampoco dibuja.
    window.dispatchEvent(new Event("resize"));
    await m.correr(300);
    expect(m.qrs).toHaveLength(1);
    // Al volver a abierta el recuadro se ve y el QR se dibuja ahí, ya medido, con el enlace del pase nuevo.
    boton(p, "Seguir abierta").click();
    expect($(p, "#cpo-qr").hidden).toBe(false);
    expect(m.qrs).toHaveLength(2);
    expect(new URL(m.qrs[1]?.texto ?? "").searchParams.get("p")).toBe("PASE00000002");
    expect(m.qrs[1]?.fijo).toBe(true);
  });

  it("en el instante en que vence se pide otro y el QR cambia", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await m.correr(120_000);
    expect(m.pases).toBe(2);
    expect(m.qrs).toHaveLength(2);
    expect(new URL(m.qrs[1]?.texto ?? "").searchParams.get("p")).toBe("PASE00000002");
  });

  it("si no contesta, avisa, deja el QR de antes y prueba de nuevo a los 10 segundos", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    m.respuestasAlPase.push("red");
    await m.correr(120_000);
    expect(texto(p, "#cpo-conexion")).toBe("Sin conexión: el QR puede vencer.");
    expect($(p, "#cpo-conexion").hidden).toBe(false);
    expect(m.qrs).toHaveLength(1);
    expect($<HTMLImageElement>(p, "#cpo-qr-img").hidden).toBe(false);
    await m.correr(10_000);
    expect(m.pases).toBe(3);
    expect($(p, "#cpo-conexion").hidden).toBe(true);
    expect(m.qrs).toHaveLength(2);
  });

  it("con la hora de la compu atrasada o adelantada no pide un pase cada 5 segundos", async () => {
    const m = mundo();
    m.hastaDelPase = AHORA - 180_000;
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    const espera = Math.min(...m.esperasEn().map((x) => x - m.ahora));
    expect(espera).toBeGreaterThan(5_000);
    expect(espera).toBeLessThanOrEqual(120_000);
  });

  it("con la compu apenas adelantada la hora de la sala no salta un minuto: el pase vuelve a pedirse a los 5 segundos", async () => {
    const m = mundo();
    m.adelanto = 5_000;
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await m.correr(5_000);
    expect(m.pases).toBe(2);
    const espera = Math.min(...m.esperasEn().map((x) => x - m.ahora));
    expect(espera).toBeGreaterThan(100_000);
    expect(espera).toBeLessThanOrEqual(120_000);
  });

  it("si el pase vence con la pregunta de dejar la campaña abierta, al cancelar vuelve a renovarse", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Elegir otro archivo").click();
    await m.correr(120_000);
    expect(m.pases).toBe(1);
    boton(p, "Cancelar").click();
    await suelta();
    expect(m.pases).toBe(2);
    expect(m.qrs).toHaveLength(2);
    await m.correr(120_000);
    expect(m.pases).toBe(3);
  });

  it("si la sala rechaza el pase no insiste y dice que no acepta este panel", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    m.respuestasAlPase.push("rechazo");
    await m.correr(120_000);
    expect(m.pases).toBe(2);
    await m.correr(60_000);
    expect(m.pases).toBe(2);
    expect($(p, "#cpo-conexion").hidden).toBe(false);
    expect(texto(p, "#cpo-conexion")).toBe("La sala no acepta este panel. Elegí otro archivo.");
  });

  it("pasados 13 minutos sin un pase nuevo no queda ningún QR a la vista", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Mostrar en grande").click();
    const capa = document.querySelector<HTMLElement>(".campana-grande") as HTMLElement;
    expect(capa.querySelector<HTMLElement>(".cg-img")?.hidden).toBe(false);
    for (let i = 0; i < 200; i++) m.respuestasAlPase.push("red");
    await m.correr(13 * 60_000);
    expect($<HTMLImageElement>(p, "#cpo-qr-img").hidden).toBe(true);
    expect(texto(p, "#cpo-conexion")).toBe("Sin conexión. Reconectando…");
    expect(capa.querySelector<HTMLElement>(".cg-img")?.hidden).toBe(true);
    expect(capa.querySelector<HTMLElement>(".cg-sinqr")?.hidden).toBe(false);
    expect(capa.querySelector(".cg-sinqr")?.textContent).toBe("Sin conexión. Reconectando…");
  });

  it("sigue renovándose mientras se confirma el cierre y al volver a abierta", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(texto(p, "#cpo-n")).toBe("2"));
    boton(p, "Cerrar la lista").click();
    expect(vistaDe(p)).toBe("confirmar");
    await m.correr(120_000);
    expect(m.pases).toBe(2);
    boton(p, "Seguir abierta").click();
    await m.correr(14 * 60_000);
    expect(m.pases).toBe(9);
  });
});

describe("la lista", () => {
  it("un alta aparece arriba con su nombre y suma al contador", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Nora", "Ana"]));
    expect(texto(p, "#cpo-n")).toBe("2");
    expect(texto(p, "#cpo-n-etiqueta")).toBe("personas en la lista");
  });

  it("una consulta anterior a la quita no devuelve a quien ya salió", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Nora", "Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    botonDeFila(p, 1, "Cuenta repetida").click();
    await m.correr(5_000);
    expect(m.quitadas).toEqual([[1, "repetida"]]);
    expect(filasDe(p)).toEqual(["Nora"]);
    m.escucha().alEquipo?.(await equipoDe(m, 1, "Ana"));
    await suelta();
    expect(filasDe(p)).toEqual(["Nora"]);
    expect(texto(p, "#cpo-n")).toBe("1");
  });

  it("un nombre vacío dice Persona y su número", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 3, "");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Persona 3"]));
    expect(texto(p, "#cpo-n-etiqueta")).toBe("persona en la lista");
  });

  it("un dato que no se descifra queda como persona y no se quita solo", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    m.escucha().alEquipo?.({ n: 4, cuenta: "CUENTA4", d: "AAAA", estado: "aceptado", v: 4 });
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Persona 4"]));
    await m.correr(60_000);
    expect(m.quitadas).toHaveLength(0);
  });

  it("lo que marca el filtro no muestra el nombre hasta tocar Mostrar y la nota sale una vez", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Los pendejos");
    await alta(m, 2, "Los pendejos de abajo");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Para revisar", "Para revisar"]));
    expect(p.raiz.querySelectorAll("#cpo-nota")).toHaveLength(1);
    expect(texto(p, "#cpo-nota")).toBe("Un nombre tapado: mostralo o quitalo.");
    expect(p.raiz.textContent).not.toContain("pendejos");
    botonDeFila(p, 1, "Mostrar").click();
    expect(filasDe(p)).toEqual(["Para revisar", "Los pendejos"]);
  });

  it("quien sale desde otra pestaña se va y su espera se cancela", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    botonDeFila(p, 2, "Quitar").click();
    botonDeFila(p, 2, "Cuenta repetida").click();
    m.escucha().alEquipoQuitado?.(2);
    expect(filasDe(p)).toEqual(["Ana"]);
    await m.correr(5_000);
    expect(m.quitadas).toHaveLength(0);
  });
});

describe("quitar a alguien con su motivo", () => {
  it("espera 5 segundos y recién entonces se lo cuenta a la sala", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    expect(texto(p, "#cpo-ul .cpo-motivos p")).toBe("¿Por qué sale?");
    botonDeFila(p, 1, "Cuenta repetida").click();
    expect(filasDe(p)).toEqual(["Ana salió: cuenta repetida."]);
    expect(texto(p, "#cpo-n")).toBe("0");
    await m.correr(4_999);
    expect(m.quitadas).toHaveLength(0);
    await m.correr(1);
    expect(m.quitadas).toEqual([[1, "repetida"]]);
    expect(filasDe(p)).toEqual([]);
  });

  it("Deshacer antes de los 5 segundos no manda nada y la fila vuelve", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    botonDeFila(p, 1, "No está en el evento").click();
    botonDeFila(p, 1, "Deshacer").click();
    expect(filasDe(p)).toEqual(["Ana"]);
    await m.correr(10_000);
    expect(m.quitadas).toHaveLength(0);
  });

  it("Cancelar cierra la pregunta y no esconde a nadie", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Ana"]));
    botonDeFila(p, 1, "Quitar").click();
    botonDeFila(p, 1, "Cancelar").click();
    expect(filaDe(p, 1).querySelector(".cpo-motivos")).toBeNull();
  });

  it("la lista no se mueve mientras hay una pregunta abierta y el motivo cae sobre quien se tocó", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Nora", "Ana"]));
    botonDeFila(p, 2, "Quitar").click();
    await alta(m, 3, "Beto");
    await alta(m, 4, "Ana dos");
    await alta(m, 5, "Nora dos");
    await vi.waitFor(() => expect(texto(p, "#cpo-n")).toBe("5"));
    expect(filasDe(p)).toEqual(["Nora", "Ana"]);
    expect(filaDe(p, 2).querySelector(".cpo-motivos")).not.toBeNull();
    botonDeFila(p, 2, "Cuenta repetida").click();
    await m.correr(5_000);
    expect(m.quitadas).toEqual([[2, "repetida"]]);
    expect(filasDe(p)).toEqual(["Nora dos", "Ana dos", "Beto", "Ana"]);
  });

  it("si la respuesta se pierde la fila sigue escondida, se reintenta sola y no vuelve a aparecer", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    m.respuestasAQuitar.push({ falla: "red", llega: true });
    botonDeFila(p, 2, "Quitar").click();
    botonDeFila(p, 2, "Lo pidió").click();
    await m.correr(5_000);
    expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo.");
    expect(filasDe(p)).toEqual(["Nora salió: lo pidió.", "Ana"]);
    expect(botones(p).some((b) => b.textContent === "Deshacer")).toBe(false);
    await m.correr(3_000);
    expect(m.quitadas).toEqual([[2, "pidio"], [2, "pidio"]]);
    expect(filasDe(p)).toEqual(["Ana"]);
  });

  it("si una quita no llegó, cerrar espera: no cierra con alguien que se confirmó afuera", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await alta(m, 3, "Beto");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(3));
    botonDeFila(p, 3, "Quitar").click();
    botonDeFila(p, 3, "Otro").click();
    boton(p, "Cerrar la lista").click();
    expect(vistaDe(p)).toBe("confirmar");
    m.respuestasAQuitar.push({ falla: "red", llega: false });
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.fases.filter(([f]) => f === "cerrada")).toHaveLength(0);
    expect(texto(p, "#cpo-aviso")).toBe("Sin conexión. Probá de nuevo.");
  });

  it("una quita que se estaba por mandar sale antes del cierre", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await alta(m, 3, "Beto");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(3));
    botonDeFila(p, 3, "Quitar").click();
    botonDeFila(p, 3, "Cuenta repetida").click();
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    expect(m.quitadas).toEqual([[3, "repetida"]]);
    expect(m.fases[m.fases.length - 1]).toEqual(["cerrada", null]);
    expect(m.cerradas[m.cerradas.length - 1]?.filas.map((f) => f.n)).toEqual([2, 1]);
  });
});

describe("cerrar la lista", () => {
  it("antes de la hora la principal es mostrar en grande y después de la hora es cerrar, siempre una sola", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Elegir el archivo"]);
    await elegirArchivo(m, p, archivoDe());
    expect(principales(p)).toHaveLength(1);
    await abrirInscripcion(m, p);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Mostrar en grande"]);
    await m.correr(3 * 3_600_000 + 1_000);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cerrar la lista"]);
    expect(texto(p, "#cpo-h")).toBe("Ya es la hora de cerrar");
  });

  it("15 minutos más corre el cierre 15 minutos", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "15 minutos más").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Abierta hasta las 17:15"));
    expect(m.fases[m.fases.length - 1]).toEqual(["abierta", AHORA + 3 * 3_600_000 + 900_000]);
  });

  it("15 minutos más con el cierre ya pasado cuenta desde ahora", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await m.correr(3 * 3_600_000 + 20 * 60_000);
    boton(p, "15 minutos más").click();
    await vi.waitFor(() => expect(m.fases).toHaveLength(2));
    expect(m.fases[1]).toEqual(["abierta", m.ahora + 900_000]);
  });

  it("con una sola persona no cierra y lo dice", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(1));
    boton(p, "Cerrar la lista").click();
    expect(texto(p, "#cpo-aviso")).toBe("Hacen falta al menos dos personas.");
    expect(vistaDe(p)).toBe("abierta");
  });

  it("con dos pide confirmar, cierra, lo guarda y llama a alCerrar con las dos", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    expect(texto(p, "#cpo-h")).toBe("¿Cerrar la lista?");
    expect(texto(p, "#cpo-linea")).toBe("Nadie más va a poder anotarse.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cerrar con 2 personas"]);
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    expect(m.fases[m.fases.length - 1]).toEqual(["cerrada", null]);
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("cerrada");
    expect(m.cerradas[0]?.filas.map((f) => [f.n, f.nombre])).toEqual([[2, "Nora"], [1, "Ana"]]);
    expect(texto(p, "#cpo-h")).toBe("Lista cerrada");
    expect(principales(p)).toHaveLength(0);
  });

  it("con 150 personas anotándose, un toque en Cerrar la lista no cierra: pide confirmar", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    for (let n = 1; n <= 150; n++) await alta(m, n, `Persona ${n}`);
    await vi.waitFor(() => expect(texto(p, "#cpo-n")).toBe("150"));
    boton(p, "Cerrar la lista").click();
    await suelta();
    // Nada se cerró: la inscripción sigue abierta para quien escanee en este rato.
    expect(m.fases.filter(([f]) => f === "cerrada")).toHaveLength(0);
    expect(m.cerradas).toHaveLength(0);
    expect(vistaDe(p)).toBe("confirmar");
    expect(texto(p, "#cpo-h")).toBe("¿Cerrar la lista?");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cerrar con 150 personas"]);
    // Y se puede seguir abierta sin haber cerrado nada.
    boton(p, "Seguir abierta").click();
    expect(vistaDe(p)).toBe("abierta");
    expect(m.fases.filter(([f]) => f === "cerrada")).toHaveLength(0);
  });

  it("un doble toque no confirma el cierre sin querer", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    boton(p, "Cerrar con 2 personas").click();
    await suelta();
    expect(m.fases.filter(([f]) => f === "cerrada")).toHaveLength(0);
    expect(vistaDe(p)).toBe("confirmar");
  });

  it("al cerrar dice hasta cuándo queda guardada la lista y deja volver a abrir", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    // La consecuencia dicha en simple, sin susto: la lista queda guardada.
    expect(texto(p, "#cpo-linea")).toBe("Nadie más va a poder anotarse.");
    expect(texto(p, "#cpo-pie")).toBe("La lista queda guardada hasta el 22 de noviembre a las 14:00.");
    expect(texto(p, "#cpo-pie")).not.toContain("borra");
    boton(p, "Volver a abrir la lista").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.fases[m.fases.length - 1]?.[0]).toBe("abierta");
  });

  describe("volver a abrir una lista cerrada manda siempre una hora nueva", () => {
    async function cerrada(m: Mundo): Promise<ReturnType<typeof nuevoPanel>> {
      const p = nuevoPanel(m);
      await abrirInscripcion(m, p);
      await alta(m, 1, "Ana");
      await alta(m, 2, "Nora");
      await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
      boton(p, "Cerrar la lista").click();
      await confirmarCierre(m, p, "Cerrar con 2 personas");
      await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
      return p;
    }

    it("con el cierre todavía por venir, la hora es el cierre que tenía más quince minutos", async () => {
      const m = mundo();
      const p = await cerrada(m);
      boton(p, "Volver a abrir la lista").click();
      await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
      expect(m.fases[m.fases.length - 1]).toEqual(["abierta", AHORA + 3 * 3_600_000 + 900_000]);
    });

    it("con la hora de la sala atrasada también manda una hora, no un vacío que el servidor rechace", async () => {
      const m = mundo();
      m.hastaDelPase = AHORA - 600_000;
      const p = await cerrada(m);
      boton(p, "Volver a abrir la lista").click();
      await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
      const ultima = m.fases[m.fases.length - 1];
      expect(ultima?.[0]).toBe("abierta");
      expect(ultima?.[1]).toBe(AHORA + 3 * 3_600_000 + 900_000);
    });

    it("con el cierre ya vencido, la hora cuenta desde ahora", async () => {
      const m = mundo();
      const p = await cerrada(m);
      await m.correr(3 * 3_600_000 + 20 * 60_000);
      boton(p, "Volver a abrir la lista").click();
      await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
      expect(m.fases[m.fases.length - 1]).toEqual(["abierta", m.ahora + 900_000]);
    });

    it("con el cierre a casi doce horas no pide más de lo que la sala acepta", async () => {
      const m = mundo();
      const p = nuevoPanel(m);
      await abrirInscripcion(m, p);
      for (let i = 0; i < 36; i++) {
        boton(p, "15 minutos más").click();
        await vi.waitFor(() => expect(m.fases).toHaveLength(i + 2));
      }
      await alta(m, 1, "Ana");
      await alta(m, 2, "Nora");
      await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
      boton(p, "Cerrar la lista").click();
      await confirmarCierre(m, p, "Cerrar con 2 personas");
      await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
      boton(p, "Volver a abrir la lista").click();
      await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
      const hora = m.fases[m.fases.length - 1]?.[1];
      expect(typeof hora).toBe("number");
      expect(hora as number).toBeLessThanOrEqual(m.ahora + 12 * 3_600_000);
      expect(hora as number).toBeGreaterThanOrEqual(m.ahora + 60_000);
    });
  });

  it("si la respuesta del cierre se perdió pero la sala cerró, pasa a cerrada sin pedirlo otra vez", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    m.respuestasAFase.push({ falla: "red", llega: true });
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    expect(m.fases.filter(([f]) => f === "cerrada")).toHaveLength(1);
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
  });

  it("si la hora que se pidió no vale lo dice, y no dice que no hay conexión", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    m.respuestasAFase.push({ falla: "forma", llega: false });
    boton(p, "15 minutos más").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-aviso")).toBe("La hora no vale. Probá de nuevo."));
  });

  it("una alta que llega después del cierre entra en la lista que se pasa", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    m.paginas.push([await equipoDe(m, 3, "Beto")]);
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    expect(m.cerradas[0]?.filas.map((f) => f.n)).toEqual([3, 2, 1]);
    expect(texto(p, "#cpo-n")).toBe("3");
  });

  it("quitar a alguien con la lista cerrada vuelve a pasar la lista, con una fila menos", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    botonDeFila(p, 1, "Quitar").click();
    botonDeFila(p, 1, "Otro").click();
    await m.correr(5_000);
    expect(m.cerradas).toHaveLength(3);
    expect(m.cerradas[m.cerradas.length - 1]?.filas.map((f) => f.n)).toEqual([2]);
  });

  it("si la lista leída no coincide con el total de la sala, no la pasa y deja probar de nuevo", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    m.sala.enSala.add(99);
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    for (let i = 0; i < 6; i++) await m.correr(1_000);
    expect(m.cerradas).toHaveLength(0);
    expect(texto(p, "#cpo-linea")).toBe("No se pudo leer toda la lista.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
    m.paginas.push([await equipoDe(m, 99, "Beto")]);
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    expect(m.cerradas[0]?.filas).toHaveLength(3);
  });
});

describe("retomar después de recargar", () => {
  it("con la sala abierta guardada abre en la lista sin crear otra", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "abierta" });
    m.sala.fase = "abierta";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(m.creadas).toHaveLength(0);
    expect(m.escuchas).toBe(1);
    await vi.waitFor(() => expect(m.qrs).toHaveLength(1));
  });

  it("con la sala cerrada abre cerrada, con Pasar la lista al sorteo como única acción principal", async () => {
    const m = mundo();
    // Una sala cuya campaña no nombra a nadie queda a cargo de quien tenga el token, también sin sesión.
    guardarOrg(m.almacen, { sala: SALA, cuenta: null, fase: "cerrada" });
    m.sala.fase = "cerrada";
    m.paginas.push([await equipoDe(m, 1, "Ana"), await equipoDe(m, 2, "Nora")]);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    expect(texto(p, "#cpo-h")).toBe("Lista cerrada");
    expect(document.querySelectorAll(".primary")).toHaveLength(1);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pasar la lista al sorteo"]);
    expect(m.cerradas).toHaveLength(0);
    boton(p, "Pasar la lista al sorteo").click();
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    expect(m.cerradas[0]?.filas.map((f) => f.n)).toEqual([2, 1]);
    expect(principales(p)).toHaveLength(0);
  });

  it("con la sala todavía en lista abre en la vista previa", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "lista" });
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    expect(principales(p).map((b) => b.textContent)).toEqual(["Abrir la inscripción"]);
  });

  it("retomar con más de 200 personas vuelve a consultar hasta tener todas", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "abierta" });
    m.sala.fase = "abierta";
    const primera: Awaited<ReturnType<typeof equipoDe>>[] = [];
    const segunda: Awaited<ReturnType<typeof equipoDe>>[] = [];
    for (let n = 1; n <= 250; n++) (n <= 200 ? primera : segunda).push(await equipoDe(m, n, `P${n}`));
    m.paginas.push(primera, segunda);
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(texto(p, "#cpo-n")).toBe("250"), { timeout: 5_000 });
    expect(m.consultas).toBe(2);
  });

  it("una quita a medias se manda antes de pintar la lista", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    botonDeFila(p, 2, "Quitar").click();
    botonDeFila(p, 2, "Lo pidió").click();
    await m.correr(2_000);
    p.detener();
    document.body.innerHTML = "";
    const q = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(q)).toBe("abierta"));
    expect(m.quitadas).toEqual([[2, "pidio"]]);
  });

  it("lo que hay que revisar va arriba de la lista, donde el aviso lo señala", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Los pendejos");
    await alta(m, 2, "Ana");
    await alta(m, 3, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Para revisar", "Nora", "Ana"]));
  });

  it("lo que ya se dejó mostrar no vuelve a esconderse", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Los pendejos");
    await vi.waitFor(() => expect(filasDe(p)).toEqual(["Para revisar"]));
    botonDeFila(p, 1, "Mostrar").click();
    p.detener();
    document.body.innerHTML = "";
    const q = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(q)).toBe("abierta"));
    await alta(m, 1, "Los pendejos");
    await vi.waitFor(() => expect(filasDe(q)).toEqual(["Los pendejos"]));
  });

  it("cuando la sala se cierra o vence, el panel la olvida", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    m.respuestaAlEstado.push("no-existe");
    m.escucha().alCerrada?.();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(texto(p, "#cpo-aviso")).toBe("Esta lista ya no existe.");
    expect(m.almacen.getItem(CLAVE_ORG)).toBeNull();
    expect(boton(p, "Elegir el archivo")).toBeTruthy();
  });

  it("un cierre que la sala desmiente no borra lo que recuerda la compu", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    m.escucha().alCerrada?.();
    await suelta();
    expect(vistaDe(p)).toBe("abierta");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("abierta");
    expect(m.escuchas).toBe(2);
  });

  it("si la sala no contesta al retomar, conserva lo guardado y deja probar de nuevo", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "abierta" });
    m.sala.fase = "abierta";
    m.respuestaAlEstado.push("red");
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sin-red"));
    expect(texto(p, "#cpo-h")).toBe("Sin conexión");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
    expect(leerOrg(m.almacen, AHORA, "testnet", null)).not.toBeNull();
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("al volver la red reintenta solo, y al volver a la pestaña pide el pase de nuevo", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "abierta" });
    m.sala.fase = "abierta";
    m.respuestaAlEstado.push("red");
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sin-red"));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await vi.waitFor(() => expect(m.pases).toBe(1));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(m.pases).toBe(2));
    window.dispatchEvent(new Event("pageshow"));
    await vi.waitFor(() => expect(m.pases).toBe(3));
    p.detener();
    window.dispatchEvent(new Event("online"));
    await suelta();
    expect(m.pases).toBe(3);
  });
});

describe("una campaña de cada modo", () => {
  it("una sala guardada del otro modo no se borra ni estorba", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: { ...SALA, red: "mainnet" }, fase: "abierta" });
    const antes = m.almacen.getItem(CLAVE_ORG);
    const p = nuevoPanel(m);
    expect(vistaDe(p)).toBe("elegir");
    expect(texto(p, "#cpo-aviso")).toBe("Tu campaña sigue en el modo oficial.");
    expect(m.almacen.getItem(CLAVE_ORG)).toBe(antes);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Elegir el archivo"]);
    await abrirInscripcion(m, p);
    expect(leerOrg(m.almacen, AHORA, "mainnet", null)?.sala.red).toBe("mainnet");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("abierta");
  });

  it("con el sorteo ya hecho se puede elegir otro archivo y se abre otra sala", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    expect(texto(p, "#cpo-h")).toBe("El sorteo ya se hizo.");
    expect(principales(p)).toHaveLength(0);
    // Con el sorteo hecho y sin saber que el resultado llegó a los celulares, antes pregunta.
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(m.borradas).toBe(0);
    expect(leerOrg(m.almacen, AHORA, "testnet", null)).toBeNull();
    m.sala.fase = "lista";
    await abrirInscripcion(m, p);
    expect(m.creadas).toHaveLength(1);
  });

  it("con la lista sellada también se puede elegir otro archivo", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sellada" });
    m.sala.fase = "sellada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sellada"));
    expect(texto(p, "#cpo-h")).toBe("La lista ya está sellada.");
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
  });

  it("dejar una campaña abierta pide confirmar y no borra la sala", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Elegir otro archivo").click();
    expect(texto(p, "#cpo-h")).toBe("¿Dejar esta campaña?");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Sí, dejarla"]);
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("abierta");
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(m.borradas).toBe(0);
    expect(m.almacen.getItem(CLAVE_ORG)).toBeNull();
    expect(m.almacen.getItem(CLAVE_EVENTOS_ORG)).toContain(TOKEN);
  });

  it("dejar una sala que todavía no tuvo a nadie la borra para liberar el archivo", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "lista" });
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("previa"));
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(m.borradas).toBe(1);
  });
});

describe("dos pestañas", () => {
  it("la que retoma se queda con la sala y la otra lo dice y deja volver", async () => {
    const compartido = bus();
    const a = mundo({ canal: compartido.canal });
    const p = nuevoPanel(a);
    await abrirInscripcion(a, p);
    const b = mundo({ canal: compartido.canal, almacen: a.almacen });
    b.sala.fase = "abierta";
    const q = nuevoPanel(b);
    await vi.waitFor(() => expect(vistaDe(q)).toBe("abierta"));
    expect(vistaDe(p)).toBe("otra-pestana");
    expect(texto(p, "#cpo-h")).toBe("La campaña sigue en otra pestaña.");
    expect(principales(p).map((x) => x.textContent)).toEqual(["Usar esta pestaña"]);
    expect(a.paradas).toBeGreaterThan(0);
    a.sala.fase = "abierta";
    boton(p, "Usar esta pestaña").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    await vi.waitFor(() => expect(vistaDe(q)).toBe("otra-pestana"));
  });
});

describe("la pantalla grande", () => {
  it("es una sala, no tiene nombres, y se cierra con Escape", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Mostrar en grande").click();
    const capa = document.querySelector<HTMLElement>(".campana-grande") as HTMLElement;
    expect(capa.classList.contains("sala")).toBe(true);
    expect(capa.getAttribute("role")).toBe("dialog");
    expect(capa.getAttribute("aria-modal")).toBe("true");
    expect(capa.textContent).not.toContain("Ana");
    expect(capa.textContent).not.toContain("Nora");
    expect(capa.querySelector("h2")?.textContent).toBe("Sorteo de Alcancía Andina");
    expect(capa.querySelector(".cg-cartel")?.textContent).toBe("Escaneá con la cámara y anotate gratis");
    expect(capa.querySelector(".cg-numero")?.textContent).toBe("2");
    expect(nadaSeAbreSolo()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".campana-grande")).toBeNull();
    expect(nadaSeAbreSolo()).toBe(false);
  });

  it("al abrir, el foco no desplaza la capa y el QR queda a la vista desde arriba", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    const foco = vi.spyOn(HTMLElement.prototype, "focus");
    boton(p, "Mostrar en grande").click();
    const capa = document.querySelector<HTMLElement>(".campana-grande") as HTMLElement;
    expect(foco).toHaveBeenCalledWith({ preventScroll: true });
    expect(capa.scrollTop).toBe(0);
    foco.mockRestore();
  });

  it("dibuja el QR del tamaño en que se ve", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Mostrar en grande").click();
    expect(m.qrs[m.qrs.length - 1]?.ancho).toBe(643);
  });

  it("al cerrar la lista cambia el QR por Lista cerrada y deja el número enorme", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Mostrar en grande").click();
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(m.cerradas).toHaveLength(1));
    const capa = document.querySelector<HTMLElement>(".campana-grande") as HTMLElement;
    expect(capa.querySelector(".cg-cerro")?.textContent).toBe("Lista cerrada");
    expect(capa.querySelector<HTMLElement>(".cg-cerro")?.hidden).toBe(false);
    expect(capa.querySelector<HTMLElement>(".cg-img")?.hidden).toBe(true);
    expect(capa.querySelector(".cg-numero")?.textContent).toBe("2");
    expect(capa.textContent).not.toContain("cerró con");
  });

  it("la cuenta regresiva cambia cada segundo y no se repite junto a la hora", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await elegirArchivo(m, p, archivoDe({ cierra_ms: AHORA + 65_000 }));
    boton(p, "Abrir la inscripción").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    boton(p, "Mostrar en grande").click();
    const cierre = (): string => document.querySelector(".cg-cierre")?.textContent ?? "";
    expect(cierre()).toBe("Cierra en 1:05");
    await m.correr(1_000);
    expect(cierre()).toBe("Cierra en 1:04");
    await m.correr(70_000);
    expect(cierre()).toBe("Cierra a las 14:01");
  });

  it("con una hora o más de espera dice solo la hora de cierre", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Mostrar en grande").click();
    expect(document.querySelector(".cg-cierre")?.textContent).toBe("Cierra a las 17:00");
  });

  it("salir de la pantalla completa cierra la capa", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Mostrar en grande").click();
    let en: Element | null = document.querySelector(".campana-grande");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => en });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(document.querySelector(".campana-grande")).not.toBeNull();
    en = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(document.querySelector(".campana-grande")).toBeNull();
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("al cerrar, el foco vuelve a un botón del panel aunque el que abrió la capa ya no esté", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    const abrio = boton(p, "Mostrar en grande");
    abrio.click();
    // Un cambio de idioma rehace los botones del panel, como pasa al llegar la hora de cierre.
    m.idioma = "en";
    p.pintar();
    expect(abrio.isConnected).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".campana-grande")).toBeNull();
    expect(document.activeElement).toBe(principales(p)[0]);
    expect(principales(p)[0]?.isConnected).toBe(true);
  });

  it("Volver cierra la capa", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    boton(p, "Mostrar en grande").click();
    (document.querySelector(".cg-volver") as HTMLButtonElement).click();
    expect(document.querySelector(".campana-grande")).toBeNull();
  });
});

describe("lo demás del panel", () => {
  it("el token no aparece en la página, en la pantalla grande ni en la consola", async () => {
    const consola = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
    ];
    const m = mundo();
    const p = nuevoPanel(m);
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(1));
    boton(p, "Mostrar en grande").click();
    expect(p.raiz.outerHTML).not.toContain(TOKEN);
    expect(document.querySelector(".campana-grande")?.outerHTML).not.toContain(TOKEN);
    expect(m.almacen.getItem(CLAVE_ORG)).toContain(TOKEN);
    for (const c of consola) expect(c).not.toHaveBeenCalled();
  });

  it("en la vista de elegir el archivo, la línea dice qué hacer, en los dos idiomas", () => {
    const m = mundo();
    const p = nuevoPanel(m);
    expect(vistaDe(p)).toBe("elegir");
    expect(texto(p, "#cpo-linea")).toBe("Elegí el archivo de tu campaña.");
    m.idioma = "en";
    p.pintar();
    expect(texto(p, "#cpo-linea")).toBe("Choose your campaign file.");
  });

  it("cambiar el idioma repinta el panel", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    expect(boton(p, "Elegir el archivo")).toBeTruthy();
    m.idioma = "en";
    p.pintar();
    expect(boton(p, "Choose the file")).toBeTruthy();
    expect(texto(p, "#cpo-h")).toBe("Company campaign");
  });
});

describe("armar otra campaña con la lista ya cerrada o con avisos pendientes", () => {
  async function cerradaConDos(m: Mundo, p: Panel): Promise<void> {
    await abrirInscripcion(m, p);
    await alta(m, 1, "Ana");
    await alta(m, 2, "Nora");
    await vi.waitFor(() => expect(filasDe(p)).toHaveLength(2));
    boton(p, "Cerrar la lista").click();
    await confirmarCierre(m, p, "Cerrar con 2 personas");
    await vi.waitFor(() => expect(vistaDe(p)).toBe("cerrada"));
  }

  afterEach(() => ponerPaso({ paso: "nada" }));

  it("con la lista cerrada, un toque en Armar otra campaña pregunta y no olvida la sala", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await cerradaConDos(m, p);
    boton(p, "Armar otra campaña").click();
    // Un toque de más no deja a todas las personas sin su resultado: antes pregunta.
    expect(vistaDe(p)).toBe("olvidar");
    expect(texto(p, "#cpo-h")).toBe("¿Dejar esta campaña?");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Sí, dejarla"]);
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("cerrada");
    // Cancelar la deja como estaba.
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("cerrada");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("cerrada");
    expect(botones(p).map((b) => b.textContent)).toContain("Armar otra campaña");
  });

  it("al confirmar, olvida la campaña y abre el selector de archivo de la siguiente", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await cerradaConDos(m, p);
    const abrio = vi.spyOn($<HTMLInputElement>(p, "#cpo-archivo"), "click");
    boton(p, "Armar otra campaña").click();
    expect(abrio).not.toHaveBeenCalled();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(m.almacen.getItem(CLAVE_ORG)).toBeNull();
    expect(abrio).toHaveBeenCalledTimes(1);
  });

  it("si cancela, un Elegir el archivo posterior no abre el selector por la pregunta anterior", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await cerradaConDos(m, p);
    const abrio = vi.spyOn($<HTMLInputElement>(p, "#cpo-archivo"), "click");
    boton(p, "Armar otra campaña").click();
    boton(p, "Cancelar").click();
    // Deja la campaña por el otro camino de siempre: el selector no se abre solo.
    boton(p, "Volver a abrir la lista").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(abrio).not.toHaveBeenCalled();
  });

  it("si la pregunta de Armar otra campaña se abandona por otro camino, un Elegir otro archivo posterior no abre el selector solo", async () => {
    const compartido = bus();
    const a = mundo({ canal: compartido.canal });
    const p = nuevoPanel(a);
    await cerradaConDos(a, p);
    const abrio = vi.spyOn($<HTMLInputElement>(p, "#cpo-archivo"), "click");
    boton(p, "Armar otra campaña").click();
    expect(vistaDe(p)).toBe("olvidar");
    // Otra pestaña toma la campaña: la pregunta queda abandonada sin cancelarla ni confirmarla.
    const b = mundo({ canal: compartido.canal, almacen: a.almacen });
    b.sala.fase = "cerrada";
    nuevoPanel(b);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("otra-pestana"));
    a.sala.fase = "abierta";
    boton(p, "Usar esta pestaña").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    // Ahora deja la campaña por el camino de siempre.
    boton(p, "Elegir otro archivo").click();
    boton(p, "Sí, dejarla").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("elegir"));
    expect(abrio).not.toHaveBeenCalled();
  });

  it("con la pregunta abierta, el aviso del sello a los celulares pasa la campaña a sellada y cancelar la deja ahí", async () => {
    const m = mundo();
    const p = nuevoPanel(m);
    await cerradaConDos(m, p);
    boton(p, "Armar otra campaña").click();
    expect(vistaDe(p)).toBe("olvidar");
    // Mientras se pregunta, el sello termina de avisarse: la pregunta sigue en pantalla y lo que se recuerda ya es la lista sellada.
    ponerPaso({ paso: "avisada" });
    expect(vistaDe(p)).toBe("olvidar");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("sellada");
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("sellada");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("sellada");
  });

  it("con la pregunta abierta, el resultado guardado pasa la campaña a sorteada y cancelar la deja ahí", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sellada" });
    m.sala.fase = "sellada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sellada"));
    await suelta();
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    ponerPaso({ paso: "resultado", filas: [{ cuenta: "GUNO", nombre: "Ana", avisada: false, alta: "esperando" }], otraBilletera: false });
    expect(vistaDe(p)).toBe("olvidar");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("sorteada");
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("sorteada");
  });

  it("con la lista sellada y un aviso pendiente a los celulares, dejar la campaña pregunta", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sellada" });
    m.sala.fase = "sellada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sellada"));
    await suelta();
    ponerPaso({ paso: "no-avisamos" });
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("sellada");
    boton(p, "Cancelar").click();
    expect(vistaDe(p)).toBe("sellada");
  });

  it("con el sorteo hecho y el resultado todavía por mandar, también pregunta", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    await suelta();
    ponerPaso({ paso: "boton-resultado" });
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("olvidar");
  });

  it("con la lista sellada, dejar la campaña pregunta en cualquier paso, también con los celulares avisados del sello", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sellada" });
    m.sala.fase = "sellada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sellada"));
    await suelta();
    const pasos: PasoDelPuente[] = [
      { paso: "avisada" },
      { paso: "nada" },
      { paso: "lista-sellada", soltable: false },
      { paso: "sello-por-confirmar" },
      { paso: "ganadoras", n: 2 },
      { paso: "tarde" },
      { paso: "lista-cambio" },
      { paso: "otra-lista" },
    ];
    for (const paso of pasos) {
      ponerPaso(paso);
      boton(p, "Elegir otro archivo").click();
      expect(vistaDe(p), paso.paso).toBe("olvidar");
      boton(p, "Cancelar").click();
      expect(vistaDe(p), paso.paso).toBe("sellada");
    }
    expect(leerOrg(m.almacen, AHORA, "testnet", null)?.fase).toBe("sellada");
  });

  it("con el sorteo hecho, dejar la campaña pregunta en cualquier paso salvo con el resultado ya avisado o la sala borrada", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    await suelta();
    for (const paso of [{ paso: "avisada" }, { paso: "nada" }, { paso: "ganadoras", n: 1 }, { paso: "otro-sorteo" }] as const) {
      ponerPaso(paso);
      boton(p, "Elegir otro archivo").click();
      expect(vistaDe(p), paso.paso).toBe("olvidar");
      boton(p, "Cancelar").click();
      expect(vistaDe(p), paso.paso).toBe("sorteada");
    }
  });

  it("con el resultado ya avisado a todas, dejar la campaña sigue siendo de un toque", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    await suelta();
    ponerPaso({ paso: "resultado", filas: [{ cuenta: "GUNO", nombre: "Ana", avisada: true, alta: "esperando" }], otraBilletera: false });
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
  });

  it("con la sala ya borrada y el sorteo hecho, no hay nada que mandar y deja la campaña de un toque", async () => {
    const m = mundo();
    guardarOrg(m.almacen, { sala: SALA, fase: "sorteada" });
    m.sala.fase = "sorteada";
    const p = nuevoPanel(m);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("sorteada"));
    await suelta();
    ponerPaso({ paso: "sala-borrada" });
    boton(p, "Elegir otro archivo").click();
    expect(vistaDe(p)).toBe("elegir");
  });

});
