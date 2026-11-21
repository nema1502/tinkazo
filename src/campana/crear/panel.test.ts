// @vitest-environment jsdom
/** La página para armar campañas por dentro: los seis pasos, la vista, el guardado y la descarga, con todo inyectado. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comisionDelArmado } from "./costo";
import { validarCampanaParaFirmar } from "../../sala/validar-campana";
import { network } from "../../stellar/config";
import { TEXTOS_CAMPANA } from "../textos";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import type { MensajeDeVista } from "../vista-protocolo";
import { armarCampana } from "./armar";
import { basesAutomaticas } from "./bases";
import { CLAVE_DE_GUARDADO, formularioInicial, type FormularioDeCampana } from "./estado";
import { instanteDe } from "./horas";
import { accionesDelFinal, escalaDelCelular, montarCreador, pestanaDelPaso, type Creador, type DepsDelCreador } from "./panel";

const AHORA = Date.UTC(2026, 10, 18, 15, 0);
const LA_PAZ = "America/La_Paz";
const h = vi.hoisted(() => ({ lang: "es" as "es" | "en" }));

const palabra = (idioma: "es" | "en", clave: string): string =>
  TEXTOS_CREAR_CAMPANA[idioma][clave] ?? TEXTOS_CAMPANA[idioma][clave] ?? (clave === "navMas" ? "Más" : clave);

interface Mundo {
  raiz: HTMLElement;
  creador: Creador;
  deps: DepsDelCreador;
  bajadas: Array<{ nombre: string; texto: string }>;
  mensajes: MensajeDeVista[];
  compartidos: File[];
}

let montados: Creador[] = [];

function crear(cambios: Partial<DepsDelCreador> = {}): Mundo {
  document.body.innerHTML = '<span id="cmp-ejemplo" hidden></span><main id="ccp"></main>';
  const raiz = document.querySelector<HTMLElement>("#ccp") as HTMLElement;
  const bajadas: Mundo["bajadas"] = [];
  const compartidos: File[] = [];
  const deps: DepsDelCreador = {
    tx: (clave) => palabra(h.lang, clave),
    dic: (idioma, clave) => palabra(idioma, clave),
    idioma: () => h.lang,
    ahora: () => AHORA,
    zona: LA_PAZ,
    almacen: localStorage,
    demo: false,
    sufijo: () => "k3f9",
    achicar: vi.fn(async () => ({ tipo: "image/png" as const, datos: "AAAA" })),
    leerArchivo: async (archivo) => (archivo as File & { contenido: string }).contenido,
    validar: async (texto, ahora) => validarCampanaParaFirmar(texto, ahora),
    descargar: (nombre, texto) => bajadas.push({ nombre, texto }),
    compartir: null,
    costo: () => null,
    origen: location.origin,
    tema: null,
    cuadro: (f) => f(),
    esperar: (f, ms) => {
      const temporizador = window.setTimeout(f, ms);
      return () => window.clearTimeout(temporizador);
    },
    escala: () => () => undefined,
    ...cambios,
  };
  const creador = montarCreador(raiz, deps);
  montados.push(creador);
  const mensajes: MensajeDeVista[] = [];
  const marco = document.querySelector<HTMLIFrameElement>("#ccp-vista");
  if (marco?.contentWindow) {
    vi.spyOn(marco.contentWindow, "postMessage").mockImplementation((mensaje: unknown) => {
      mensajes.push(mensaje as MensajeDeVista);
    });
  }
  return { raiz, creador, deps, bajadas, mensajes, compartidos };
}

const q = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector) as T;
const existe = (selector: string): boolean => document.querySelector(selector) !== null;
const clic = (id: string): void => q(`#${id}`).click();
const texto = (selector: string): string => q(selector).textContent ?? "";

function escribir(id: string, valor: string): void {
  const campo = q<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  campo.value = valor;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function cambiarValor(id: string, valor: string): void {
  const campo = q<HTMLInputElement>(`#${id}`);
  campo.value = valor;
  campo.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Elige un archivo en un campo de archivos, con su texto a mano para que la prueba no dependa de Blob.text. */
function elegirArchivo(id: string, contenido: string, nombre = "campana.json", tipo = "application/json"): void {
  const campo = q<HTMLInputElement>(`#${id}`);
  const archivo = Object.assign(new File([contenido], nombre, { type: tipo }), { contenido });
  Object.defineProperty(campo, "files", { value: [archivo], configurable: true });
  campo.dispatchEvent(new Event("change", { bubbles: true }));
}

/** La vista avisa que está lista y recibe el estado de ahora, como en el navegador. */
function listo(): void {
  const marco = q<HTMLIFrameElement>("#ccp-vista");
  window.dispatchEvent(new MessageEvent("message", { data: { t: "tinkazo:vista-lista" }, origin: location.origin, source: marco.contentWindow }));
}

async function asentar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const titulo = (): string => texto("#ccp-titulo");
const linea = (): string => texto(".ccp-lineas");

/** Llena los cinco pasos y deja la página en el sexto. */
function llenarHastaElFinal(): void {
  escribir("ccp-nombre", "Alcancía Andina");
  clic("ccp-seguir");
  clic("ccp-monto-40");
  clic("ccp-ganan-mas");
  clic("ccp-ganan-mas");
  clic("ccp-seguir");
  clic("ccp-manana");
  escribir("ccp-lugar", "Hackathon");
  clic("ccp-seguir");
  clic("ccp-seguir");
  clic("ccp-seguir");
}

/** Un formulario completo, como lo guarda esta página, para que arranque en el paso que se pida. */
function guardado(cambio: Partial<FormularioDeCampana> = {}): FormularioDeCampana {
  return {
    ...formularioInicial(LA_PAZ, "k3f9"),
    nombre: "Alcancía Andina",
    monto: 40,
    ganan: 3,
    fecha: "2026-11-21",
    lugar: "Hackathon",
    paso: 6,
    visitado: 6,
    ...cambio,
  };
}

function sembrar(f: FormularioDeCampana): void {
  localStorage.setItem(CLAVE_DE_GUARDADO, JSON.stringify(f));
}

function archivoDe(f: FormularioDeCampana): Record<string, unknown> {
  const dic = (idioma: "es" | "en", clave: string): string => palabra(idioma, clave);
  const bases = basesAutomaticas(
    {
      marca: f.nombre,
      ganan: f.ganan,
      monto: f.monto ?? 40,
      sorteoMs: instanteDe(f.fecha, f.sorteo, f.zona) ?? 0,
      zona: f.zona,
      conRedes: f.pasos.length > 0,
      costo: { es: null, en: null },
    },
    dic,
  );
  return armarCampana(f, { bases });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  localStorage.clear();
  h.lang = "es";
});
afterEach(() => {
  for (const c of montados) c.desmontar();
  montados = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("los pasos", () => {
  it("cada paso tiene un solo botón principal", () => {
    crear();
    llenarHastaElFinal();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      clic(`ccp-ir-${n}`);
      expect(document.querySelectorAll("button.primary"), `paso ${n}`).toHaveLength(1);
      expect(document.querySelector(".ccp-paso-de")?.textContent).toBe(`${n} de 6`);
    }
  });

  it("empieza en el paso 1 con su título y sin nada elegido", () => {
    crear();
    expect(titulo()).toBe("Tu marca");
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("");
  });

  it("seguir con algo que falta dice qué falta en una línea y no avanza", () => {
    crear();
    clic("ccp-seguir");
    expect(linea()).toBe("Escribí el nombre de tu marca.");
    expect(titulo()).toBe("Tu marca");
    expect(document.activeElement?.id).toBe("ccp-nombre");
  });

  it("los pasos visitados se pueden tocar y los otros no", () => {
    crear();
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    expect(q<HTMLButtonElement>("#ccp-ir-1").disabled).toBe(false);
    expect(q<HTMLButtonElement>("#ccp-ir-2").disabled).toBe(false);
    expect(q<HTMLButtonElement>("#ccp-ir-3").disabled).toBe(true);
    expect(q("#ccp-ir-2").getAttribute("aria-current")).toBe("step");
    clic("ccp-ir-1");
    expect(titulo()).toBe("Tu marca");
  });

  it("el paso 2 tiene un solo premio de hasta 500 con botones y el resumen en grande", () => {
    crear();
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-monto-500");
    expect(texto("#ccp-premio")).toBe("500 dólares digitales");
    clic("ccp-ganan-mas");
    clic("ccp-monto-40");
    expect(texto("#ccp-premio")).toBe("2 premios de 40 dólares digitales");
    expect(texto(".ccp-total")).toBe("En total 80 dólares digitales (2 por 40)");
  });

  it("otro monto arranca en el último elegido y sube con saltos que crecen", () => {
    crear();
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-monto-200");
    clic("ccp-otro");
    expect(texto("#ccp-otro-numero")).toBe("200");
    for (let i = 0; i < 6; i += 1) clic("ccp-otro-mas");
    expect(texto("#ccp-premio")).toBe("500 dólares digitales");
  });

  it("sin monto el resumen va de muestra y seguir pide elegirlo", () => {
    crear();
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    expect(q("#ccp-premio").classList.contains("ccp-muestra")).toBe(true);
    clic("ccp-seguir");
    expect(linea()).toBe("Elegí cuánto se lleva cada persona.");
  });

  it("el paso 3 muestra siempre la zona de las horas", () => {
    crear();
    escribir("ccp-nombre", "Alcancía Andina");
    clic("ccp-seguir");
    clic("ccp-monto-40");
    clic("ccp-seguir");
    expect(document.body.textContent).toContain("Horas de La Paz");
  });

  it("elegir hoy con la hora de abrir ya pasada la pone sola y lo avisa sin error", () => {
    crear();
    sembrar(guardado({ paso: 3, fecha: "" }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    clic("ccp-hoy");
    expect(q<HTMLInputElement>("#ccp-abre").value).toBe("11:05");
    expect(q<HTMLInputElement>("#ccp-cierra").value).toBe("19:05");
    expect(linea()).toBe("La hora de abrir ya pasó. La pusimos a las 11:05.");
    expect(existe(".ccp-lineas .ccp-error")).toBe(false);
    expect(q(".ccp-lineas").getAttribute("aria-live")).toBe("polite");
  });

  it("un sorteo que cruza la medianoche se puede cargar y marca +1 día", () => {
    crear();
    sembrar(guardado({ paso: 3, fecha: "2026-11-21" }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    cambiarValor("ccp-abre", "22:00");
    cambiarValor("ccp-cierra", "01:00");
    cambiarValor("ccp-sorteo", "01:30");
    expect(document.querySelectorAll(".ccp-mas-un-dia")).toHaveLength(2);
    clic("ccp-seguir");
    expect(titulo()).toBe("Tus redes");
  });

  it("un cierre a 22 horas de abrir lo dice debajo de las horas, no en la barra, y no pone +1 día en ese campo", () => {
    crear();
    sembrar(guardado({ paso: 3, fecha: "2026-11-21", abre: "20:00", cierra: "18:00", sorteo: "18:30" }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    clic("ccp-seguir");
    expect(titulo()).toBe("Cuándo");
    expect(texto(".ccp-error-hora")).toBe("Cerrá dentro de las 12 horas de abrir.");
    expect(q(".ccp-error-hora").getAttribute("role")).toBe("alert");
    expect(linea()).toBe("");
    expect(q("#ccp-cierra").getAttribute("aria-invalid")).toBe("true");
    expect(q("#ccp-cierra").parentElement?.querySelector(".ccp-mas-un-dia")).toBeNull();
    expect(q("#ccp-sorteo").parentElement?.querySelector(".ccp-mas-un-dia")).not.toBeNull();
  });

  it("el error de hora se va en cuanto se cambia una hora", () => {
    crear();
    sembrar(guardado({ paso: 3, fecha: "2026-11-21", abre: "20:00", cierra: "18:00", sorteo: "18:30" }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    clic("ccp-seguir");
    cambiarValor("ccp-cierra", "23:00");
    expect(existe(".ccp-error-hora")).toBe(false);
    expect(q("#ccp-cierra").getAttribute("aria-invalid")).toBeNull();
  });

  it("las redes que ya tienen su pedido se marcan apretadas y la fila nueva recibe el foco y se lleva a la vista", () => {
    const llevadas: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element): void {
      llevadas.push(this);
    };
    crear();
    sembrar(guardado({ paso: 4 }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    expect(q("#ccp-sumar-instagram").getAttribute("aria-pressed")).toBe("false");
    clic("ccp-sumar-instagram");
    expect(q("#ccp-sumar-instagram").getAttribute("aria-pressed")).toBe("true");
    expect(q("#ccp-sumar-tiktok").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement?.id).toBe("ccp-pedido-0");
    expect(llevadas.some((e) => e.tagName === "LI")).toBe(true);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("el mensaje de un enlace malo se lleva a la vista", () => {
    const llevadas: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element): void {
      llevadas.push(this);
    };
    crear();
    sembrar(guardado({ paso: 4 }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    clic("ccp-sumar-instagram");
    escribir("ccp-pedido-0", "https://www.tiktok.com/@alcancia");
    llevadas.length = 0;
    q("#ccp-pedido-0").dispatchEvent(new Event("blur"));
    expect(llevadas.map((e) => e.textContent)).toContain("Este enlace no es de Instagram.");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("Términos está en el menú de arriba, porque el pie de la página no se muestra", () => {
    crear();
    expect(q<HTMLAnchorElement>("#ccp-terminos").getAttribute("href")).toBe("/terminos.html");
  });

  it("el paso 4 pide el enlace o quitar la fila y dice si el enlace es de otra red", () => {
    crear();
    sembrar(guardado({ paso: 4 }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    clic("ccp-sumar-instagram");
    clic("ccp-seguir");
    expect(linea()).toBe("Pegá el enlace o quitá esta fila.");
    escribir("ccp-pedido-0", "https://www.tiktok.com/@alcancia");
    q("#ccp-pedido-0").dispatchEvent(new Event("blur"));
    expect(texto(".ccp-fila-aviso")).toBe("Este enlace no es de Instagram.");
    escribir("ccp-pedido-0", "@alcancia");
    expect(q<HTMLAnchorElement>(".ccp-probar").href).toBe("https://www.instagram.com/alcancia");
  });

  it("un pedido escrito en un solo idioma deja seguir", () => {
    crear();
    sembrar(guardado({ paso: 4 }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    clic("ccp-sumar-texto");
    escribir("ccp-pedido-0", "Subir una foto");
    clic("ccp-seguir");
    expect(titulo()).toBe("Las bases");
    expect(montados[0]?.formulario().pasos[0]?.texto).toEqual({ es: "Subir una foto", en: "Subir una foto" });
  });

  it("al entrar al paso 5 las bases ya están abiertas, sin otro toque, y se pasan de idioma con las pestañas", () => {
    crear();
    sembrar(guardado({ paso: 5 }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    expect(titulo()).toBe("Las bases");
    expect(existe("#ccp-leer-bases")).toBe(false);
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("Participar es gratis");
    clic("ccp-bases-en");
    expect(q<HTMLTextAreaElement>("#ccp-bases").value).toContain("Taking part is free");
  });

  it("cambiar el premio después de editar las bases lo dice y deja elegir", () => {
    crear();
    sembrar(guardado({ paso: 5 }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    escribir("ccp-bases", "Mis bases");
    clic("ccp-ir-2");
    clic("ccp-ganan-mas");
    clic("ccp-ir-5");
    expect(existe("#ccp-rehacer")).toBe(true);
    clic("ccp-seguir");
    expect(linea()).toBe("Cambiaste datos de antes y las bases no.");
    clic("ccp-rehacer");
    expect(existe("#ccp-rehacer")).toBe(false);
  });

  it("el logo que no se puede achicar lo dice en una línea", async () => {
    crear({ achicar: vi.fn(async () => null) });
    elegirArchivo("ccp-logo-archivo", "x", "logo.png", "image/png");
    await asentar();
    expect(texto(".ccp-logo-estado")).toBe("No pudimos achicar esta imagen. Probá con otra.");
  });

  it("un logo que se achica se ve sobre dos fondos y Con fondo blanco lo vuelve a dibujar sobre blanco", async () => {
    const achicar = vi.fn(async () => ({ tipo: "image/png" as const, datos: "AAAA" }));
    crear({ achicar });
    elegirArchivo("ccp-logo-archivo", "x", "logo.png", "image/png");
    await asentar();
    expect(document.querySelectorAll(".ccp-logo-miniatura")).toHaveLength(2);
    clic("ccp-logo-blanco");
    await asentar();
    expect(achicar).toHaveBeenLastCalledWith(expect.anything(), { blanco: true });
    expect(q("#ccp-logo-blanco").getAttribute("aria-pressed")).toBe("true");
    clic("ccp-logo-quitar");
    expect(existe(".ccp-logo-miniatura")).toBe(false);
  });
});

describe("la vista en vivo", () => {
  it("escribir el nombre manda a la vista una campaña con ese nombre", () => {
    const m = crear();
    escribir("ccp-nombre", "Nora Café");
    const ultimo = m.mensajes[m.mensajes.length - 1];
    expect((ultimo?.campana.empresa as { nombre: string }).nombre).toBe("Nora Café");
    expect(ultimo?.muestras.nombre).toBe(false);
    expect(ultimo?.idioma).toBe("es");
  });

  it("con datos que faltan manda los de muestra", () => {
    const m = crear();
    listo();
    const primero = m.mensajes[m.mensajes.length - 1];
    expect(primero?.muestras).toEqual({ nombre: true, premio: true, lugar: true, horas: true });
    expect((primero?.campana.empresa as { nombre: string }).nombre).toBe("Tu marca");
  });

  it("cuando la vista avisa que está lista le manda el estado de ahora", () => {
    const m = crear();
    const marco = q<HTMLIFrameElement>("#ccp-vista");
    m.mensajes.length = 0;
    window.dispatchEvent(new MessageEvent("message", { data: { t: "tinkazo:vista-lista" }, origin: location.origin, source: marco.contentWindow }));
    expect(m.mensajes).toHaveLength(1);
    m.mensajes.length = 0;
    window.dispatchEvent(new MessageEvent("message", { data: { t: "tinkazo:vista-lista" }, origin: location.origin, source: window }));
    expect(m.mensajes).toHaveLength(0);
  });

  it("elegir otra pestaña manda la pantalla de esa pestaña y festeja solo al tocar Ganó", () => {
    const m = crear();
    clic("ccp-tab-adentro");
    expect(m.mensajes[m.mensajes.length - 1]).toMatchObject({ pantalla: "adentro", festejar: false });
    clic("ccp-tab-ganaste");
    expect(m.mensajes[m.mensajes.length - 1]).toMatchObject({ pantalla: "ganaste", festejar: true });
    escribir("ccp-nombre", "Nora Café");
    expect(m.mensajes[m.mensajes.length - 1]).toMatchObject({ pantalla: "ganaste", festejar: false });
  });

  it("al entrar al paso 4 el mensaje a la vista lleva la pantalla hola", () => {
    const m = crear();
    sembrar(guardado({ paso: 3 }));
    montados[0]?.desmontar();
    montados = [];
    const n = crear();
    clic("ccp-seguir");
    expect(titulo()).toBe("Tus redes");
    expect(n.mensajes[n.mensajes.length - 1]?.pantalla).toBe("hola");
    expect(m.mensajes).toHaveLength(0);
  });

  it("una pestaña elegida a mano queda hasta cambiar de paso", () => {
    crear();
    sembrar(guardado({ paso: 4 }));
    montados[0]?.desmontar();
    montados = [];
    const n = crear();
    clic("ccp-tab-adentro");
    clic("ccp-sumar-instagram");
    expect(n.mensajes[n.mensajes.length - 1]?.pantalla).toBe("adentro");
    clic("ccp-quitar-0");
    expect(n.mensajes[n.mensajes.length - 1]?.pantalla).toBe("adentro");
    clic("ccp-seguir");
    expect(n.mensajes[n.mensajes.length - 1]?.pantalla).toBe("previa");
    clic("ccp-ir-4");
    expect(n.mensajes[n.mensajes.length - 1]?.pantalla).toBe("hola");
  });

  it("en el paso 5 la vista abre sola el plegado de reglas", () => {
    crear();
    sembrar(guardado({ paso: 5 }));
    montados[0]?.desmontar();
    montados = [];
    const n = crear();
    listo();
    expect(n.mensajes[n.mensajes.length - 1]).toMatchObject({ pantalla: "previa", reglasAbiertas: true });
    clic("ccp-ir-3");
    expect(n.mensajes[n.mensajes.length - 1]?.reglasAbiertas).toBe(false);
  });

  it("en el celular Ver cómo queda abre la vista a pantalla completa y Volver la cierra", () => {
    crear();
    clic("ccp-ver-vista");
    expect(q(".ccp-vista").classList.contains("ccp-vista-abierta")).toBe(true);
    q<HTMLButtonElement>(".ccp-volver").click();
    expect(q(".ccp-vista").classList.contains("ccp-vista-abierta")).toBe(false);
  });

  it("al abrir la vista el foco pasa a Volver a los pasos y la vista es un diálogo", () => {
    crear();
    q<HTMLButtonElement>("#ccp-ver-vista").focus();
    clic("ccp-ver-vista");
    expect(document.activeElement).toBe(q(".ccp-volver"));
    expect(q(".ccp-vista").getAttribute("role")).toBe("dialog");
    expect(q(".ccp-vista").getAttribute("aria-modal")).toBe("true");
    expect(q(".ccp-vista").getAttribute("aria-label")).toBe("Cómo lo ve tu gente");
  });

  it("con la vista abierta la columna de los pasos queda inerte, y al cerrar vuelve a andar", () => {
    crear();
    clic("ccp-ver-vista");
    expect(q(".ccp-col").hasAttribute("inert")).toBe(true);
    q<HTMLButtonElement>(".ccp-volver").click();
    expect(q(".ccp-col").hasAttribute("inert")).toBe(false);
    expect(q(".ccp-vista").hasAttribute("role")).toBe(false);
  });

  it("Escape cierra la vista y el foco vuelve a Ver cómo queda", () => {
    crear();
    clic("ccp-ver-vista");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(q(".ccp-vista").classList.contains("ccp-vista-abierta")).toBe(false);
    expect(document.activeElement).toBe(q("#ccp-ver-vista"));
  });

  it("Escape con la vista cerrada no hace nada", () => {
    crear();
    q<HTMLButtonElement>("#ccp-seguir").focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(q("#ccp-seguir"));
  });

  it("con la vista abierta Tab no sale de ella: del último botón vuelve al primero", () => {
    crear();
    clic("ccp-ver-vista");
    q<HTMLButtonElement>("#ccp-tab-ganaste").focus();
    const tecla = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(tecla);
    expect(tecla.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q(".ccp-volver"));
  });

  it("con la vista abierta Mayús y Tab desde el primer botón va al último", () => {
    crear();
    clic("ccp-ver-vista");
    const tecla = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(tecla);
    expect(tecla.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q("#ccp-tab-ganaste"));
  });

  it("tocar una pestaña de la vista deja el foco en esa pestaña", () => {
    crear();
    clic("ccp-ver-vista");
    q<HTMLButtonElement>("#ccp-tab-ganaste").focus();
    clic("ccp-tab-ganaste");
    expect(document.activeElement?.id).toBe("ccp-tab-ganaste");
  });

  it("las cuatro pestañas tienen su nombre y la de ahora está apretada", () => {
    crear();
    expect([...document.querySelectorAll(".ccp-pestana")].map((b) => b.textContent)).toEqual(["Al escanear", "Los pedidos", "Ya anotada", "Ganó"]);
    expect(q("#ccp-tab-previa").getAttribute("aria-pressed")).toBe("true");
  });

  it("al montar no le manda nada a la vista: espera a que avise que está lista", () => {
    const m = crear();
    expect(m.mensajes).toHaveLength(0);
  });

  it("el marco recibe la escala que mide la página", () => {
    const medir = vi.fn((_caja: HTMLElement, alCambiar: (e: number) => void) => {
      alCambiar(0.8);
      return () => undefined;
    });
    crear({ escala: medir });
    expect(q(".ccp-caja").style.getPropertyValue("--ccp-escala")).toBe("0.8");
  });
});

describe("guardar lo cargado", () => {
  it("recargar no pierde lo cargado", () => {
    crear();
    escribir("ccp-nombre", "Nora Café");
    vi.advanceTimersByTime(400);
    montados[0]?.desmontar();
    montados = [];
    crear();
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("Nora Café");
  });

  it("con un pagehide dentro de los 300 ms, el texto queda guardado", () => {
    crear();
    escribir("ccp-nombre", "Nora Café");
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).toContain("Nora Café");
  });

  it("cuando la pestaña pasa a oculta también se guarda lo pendiente", () => {
    crear();
    escribir("ccp-nombre", "Nora Café");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).toContain("Nora Café");
  });

  it("empezar de nuevo pide un sí y lo borra", () => {
    crear();
    escribir("ccp-nombre", "Nora Café");
    vi.advanceTimersByTime(400);
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).not.toBeNull();
    clic("ccp-empezar");
    expect(texto(".ccp-confirmar")).toContain("¿Borrar todo lo cargado?");
    clic("ccp-si-borrar");
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("");
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).toBeNull();
    vi.advanceTimersByTime(400);
    expect(localStorage.getItem(CLAVE_DE_GUARDADO)).toBeNull();
  });

  it("cancelar no borra nada", () => {
    crear();
    escribir("ccp-nombre", "Nora Café");
    clic("ccp-empezar");
    q<HTMLButtonElement>(".ccp-confirmar button:last-child").click();
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("Nora Café");
  });

  it("con la demostración no se lee ni se escribe nada en el navegador", () => {
    const almacen = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    crear({ demo: true, almacen });
    expect(titulo()).toBe("Tu marca");
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("Alcancía Andina");
    escribir("ccp-nombre", "Otra marca");
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(1000);
    expect(almacen.getItem).not.toHaveBeenCalled();
    expect(almacen.setItem).not.toHaveBeenCalled();
  });

  it("un almacenamiento que falla no impide usar la página", () => {
    const almacen = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    crear({ almacen });
    escribir("ccp-nombre", "Nora Café");
    window.dispatchEvent(new Event("pagehide"));
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("Nora Café");
  });
});

describe("abrir una campaña", () => {
  it("abrir una campaña que ya tengo la carga en los pasos", async () => {
    crear();
    elegirArchivo("ccp-abrir-archivo", JSON.stringify(archivoDe(guardado())));
    await asentar();
    expect(titulo()).toBe("Tu marca");
    expect(q<HTMLInputElement>("#ccp-nombre").value).toBe("Alcancía Andina");
    expect(q("#ccp-ir-6").hasAttribute("disabled")).toBe(false);
  });

  it("abrir algo que no es una campaña lo dice en una línea", async () => {
    crear();
    elegirArchivo("ccp-abrir-archivo", "esto no es una campaña");
    await asentar();
    expect(linea()).toBe("Esta no es una campaña de Tinkazo.");
  });

  it("abrir un borrador incompleto lo carga en su paso", async () => {
    crear();
    elegirArchivo("ccp-abrir-archivo", JSON.stringify(guardado({ paso: 2, visitado: 2, monto: null, fecha: "", lugar: "" })), "campana-k3f9.txt", "text/plain");
    await asentar();
    expect(titulo()).toBe("El premio");
    expect(q("#ccp-ir-3").hasAttribute("disabled")).toBe(true);
  });

  it("el campo de archivos acepta json y txt", () => {
    crear();
    expect(q<HTMLInputElement>("#ccp-abrir-archivo").accept).toBe(".json,.txt,application/json,text/plain");
  });

  it("Bajar lo que llevo baja el formulario como texto", () => {
    const m = crear();
    escribir("ccp-nombre", "Nora Café");
    clic("ccp-bajar-borrador");
    expect(m.bajadas[0]?.nombre).toBe("campana-k3f9.txt");
    expect(JSON.parse(m.bajadas[0]?.texto ?? "{}")).toMatchObject({ nombre: "Nora Café", sufijo: "k3f9" });
  });

  it("con el formulario vacío el paso 1 ofrece abrir una campaña, y con algo cargado ya no", () => {
    crear();
    expect(existe("#ccp-ya-tengo")).toBe(true);
    escribir("ccp-nombre", "Nora Café");
    clic("ccp-seguir");
    clic("ccp-ir-1");
    expect(existe("#ccp-ya-tengo")).toBe(false);
  });
});

describe("el último paso", () => {
  it("se llama Mandala a Tinkazo y dice que todavía no está activa", () => {
    crear();
    llenarHastaElFinal();
    expect(titulo()).toBe("Mandala a Tinkazo");
    expect(linea()).toBe("Todavía no está activa. Mandala antes de las 10:00 y te la activamos.");
  });

  it("el resumen no repite la línea de que no está activa: es la única de la barra", () => {
    crear();
    llenarHastaElFinal();
    expect(document.querySelector(".ccp-cuerpo")?.textContent).not.toContain("Todavía no está activa");
    expect(document.querySelectorAll(".ccp-lineas p")).toHaveLength(1);
  });

  it("Descargar va solo en su fila, y Ver cómo queda va dentro del paso y no en la barra", () => {
    crear();
    llenarHastaElFinal();
    const fila = q(".ccp-botones");
    expect([...fila.children].map((b) => b.id)).toEqual(["ccp-descargar"]);
    expect(existe(".ccp-accion #ccp-ver-vista")).toBe(false);
    expect(existe(".ccp-cuerpo #ccp-ver-vista")).toBe(true);
  });

  it("antes del último paso Seguir va primero y Ver cómo queda debajo", () => {
    crear();
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-seguir", "ccp-ver-vista"]);
  });

  it("con el cobro el resumen muestra los premios, el servicio de esta campaña y el total a poner", () => {
    crear({ comision: comisionDelArmado({ pb: 200n, minimo: 15_000_000n }) });
    llenarHastaElFinal();
    const premio = [...document.querySelectorAll(".ccp-resumen")][1]?.textContent ?? "";
    expect(premio).toContain("En total 120 dólares digitales (3 por 40)");
    expect(premio).toContain("Servicio de Tinkazo: 2,40 dólares digitales");
    expect(premio).toContain("Total a poner: 122,40 dólares digitales");
  });

  it("sin cobro no hay renglón del servicio ni de total a poner", () => {
    crear();
    llenarHastaElFinal();
    expect(document.body.textContent).not.toContain("Servicio de Tinkazo");
    expect(document.body.textContent).not.toContain("Total a poner");
  });

  it("muestra el resumen en cuatro renglones con el total que pone la empresa", () => {
    crear();
    llenarHastaElFinal();
    const renglones = [...document.querySelectorAll(".ccp-resumen")].map((r) => r.textContent);
    expect(renglones).toHaveLength(4);
    expect(renglones[0]).toBe("Alcancía Andina");
    expect(renglones[1]).toContain("3 premios de 40 dólares digitales");
    expect(renglones[1]).toContain("En total 120 dólares digitales (3 por 40)");
    expect(renglones[3]).toBe("Hackathon. Sin pedidos.");
  });

  it("descargar baja evento.json, mainnet, y su texto pasa el validador", async () => {
    expect(network.name).toBe("testnet");
    const m = crear();
    llenarHastaElFinal();
    clic("ccp-descargar");
    await asentar();
    expect(m.bajadas).toHaveLength(1);
    const bajada = m.bajadas[0];
    expect(bajada?.nombre).toBe("alcancia-andina-k3f9-2026-11-19-1000.json");
    const archivo = JSON.parse(bajada?.texto ?? "{}") as Record<string, unknown>;
    expect(archivo.red).toBe("mainnet");
    expect(validarCampanaParaFirmar(JSON.stringify(archivo), AHORA)).toEqual({ ok: true });
    expect(linea()).toBe("Listo. Mandásela a Tinkazo para que la active.");
    expect(linea()).not.toContain(".json");
  });

  it("antes de bajar el principal es Descargar, y después pasa a ser Compartir", async () => {
    const compartidos: File[] = [];
    crear({
      compartir: {
        puede: () => true,
        enviar: async (archivo) => {
          compartidos.push(archivo);
          return true;
        },
      },
    });
    llenarHastaElFinal();
    expect(q("#ccp-descargar").classList.contains("primary")).toBe(true);
    expect(q("#ccp-compartir").classList.contains("primary")).toBe(false);
    clic("ccp-descargar");
    await asentar();
    expect(q("#ccp-compartir").classList.contains("primary")).toBe(true);
    expect(q("#ccp-descargar").classList.contains("primary")).toBe(false);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
    clic("ccp-compartir");
    await asentar();
    expect(compartidos).toHaveLength(1);
    expect(compartidos[0]?.type).toBe("text/plain");
    expect(compartidos[0]?.name).toBe("alcancia-andina-k3f9-2026-11-19-1000.txt");
  });

  it("después de bajar, aunque el navegador sepa compartir, el correo sigue a mano", async () => {
    crear({ compartir: { puede: () => true, enviar: async () => true } });
    llenarHastaElFinal();
    expect(existe("#ccp-correo")).toBe(false);
    clic("ccp-descargar");
    await asentar();
    expect(existe("#ccp-correo")).toBe(true);
    expect([...q(".ccp-botones").children].map((b) => b.id)).toEqual(["ccp-compartir", "ccp-descargar"]);
  });

  it("sin compartir muestra hola@tinkazo.app con el asunto y el cuerpo", () => {
    crear();
    llenarHastaElFinal();
    const correo = q<HTMLAnchorElement>("#ccp-correo");
    expect(correo.textContent).toBe("O mandala a hola@tinkazo.app");
    expect(correo.getAttribute("href")).toBe(
      `mailto:hola@tinkazo.app?subject=${encodeURIComponent("Campaña alcancia-andina-k3f9-2026-11-19-1000")}` +
        `&body=${encodeURIComponent("Hola, quiero activar mi campaña. Adjunto la que bajé de la página.")}`,
    );
    expect(existe("#ccp-compartir")).toBe(false);
  });

  it("dice hasta cuándo mandarla, con el evento cerca", () => {
    crear();
    sembrar(guardado({ fecha: "2026-11-19", abre: "10:00", cierra: "18:00", sorteo: "18:30" }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    expect(linea()).toBe("Todavía no está activa. Mandala antes de las 10:00 y te la activamos.");
  });

  it("y lo dice igual con el evento lejos, con la hora de abrir de ese día", () => {
    crear();
    sembrar(guardado({ fecha: "2026-11-25", abre: "09:00", cierra: "17:00", sorteo: "17:30" }));
    montados[0]?.desmontar();
    montados = [];
    crear();
    expect(linea()).toBe("Todavía no está activa. Mandala antes de las 09:00 y te la activamos.");
  });

  it("descargar con algo que falta lleva a ese paso con su línea", async () => {
    crear();
    sembrar(guardado({ lugar: "" }));
    montados[0]?.desmontar();
    montados = [];
    const m = crear();
    clic("ccp-descargar");
    await asentar();
    expect(titulo()).toBe("Cuándo");
    expect(linea()).toBe("Escribí el lugar o el evento.");
    expect(m.bajadas).toHaveLength(0);
  });

  it("un fallo del validador lleva al paso que corresponde sin nombrar el campo", async () => {
    crear();
    sembrar(guardado());
    montados[0]?.desmontar();
    montados = [];
    const m = crear({ validar: async () => ({ ok: false, quien: "sitio", campo: "premios", motivo: "inválido" }) });
    clic("ccp-descargar");
    await asentar();
    expect(titulo()).toBe("El premio");
    expect(linea()).toBe("Falta algo en el paso 2.");
    expect(linea()).not.toContain("premios");
    expect(m.bajadas).toHaveLength(0);
  });

  it("un campo del armado que no es de ningún paso se queda en el último con un mensaje simple", async () => {
    crear();
    sembrar(guardado());
    montados[0]?.desmontar();
    montados = [];
    crear({ validar: async () => ({ ok: false, quien: "sala", campo: "estado", motivo: "forma" }) });
    clic("ccp-descargar");
    await asentar();
    expect(titulo()).toBe("Mandala a Tinkazo");
    expect(linea()).toBe("Algo no salió. Probá de nuevo.");
  });

  it("una campaña activada que se abre y no cambia se baja tal como estaba, con su firma", async () => {
    const original = archivoDe(guardado());
    const texto1 = JSON.stringify(original);
    const m = crear();
    elegirArchivo("ccp-abrir-archivo", JSON.stringify({ texto: texto1, firma: "FIRMA" }));
    await asentar();
    clic("ccp-ir-6");
    expect(linea()).not.toContain("Cambiaste una campaña activada");
    clic("ccp-descargar");
    await asentar();
    expect(JSON.parse(m.bajadas[0]?.texto ?? "{}")).toEqual({ texto: texto1, firma: "FIRMA" });
  });

  it("una campaña activada que se cambia dice que hay que activarla de nuevo y se baja sin firma", async () => {
    const m = crear();
    elegirArchivo("ccp-abrir-archivo", JSON.stringify({ texto: JSON.stringify(archivoDe(guardado())), firma: "FIRMA" }));
    await asentar();
    clic("ccp-ir-3");
    escribir("ccp-lugar", "Otro lugar");
    clic("ccp-ir-6");
    expect(linea()).toContain("Cambiaste una campaña activada. Hay que activarla de nuevo.");
    clic("ccp-descargar");
    await asentar();
    const bajado = JSON.parse(m.bajadas[0]?.texto ?? "{}") as Record<string, unknown>;
    expect("firma" in bajado).toBe(false);
    expect((bajado.lugar as { es: string }).es).toBe("Otro lugar");
  });
});

describe("los textos y los idiomas", () => {
  it("los textos visibles de los seis pasos en los dos idiomas no tienen punto y coma, comillas, raya larga, punto medio ni exclamación", () => {
    for (const idioma of ["es", "en"] as const) {
      h.lang = idioma;
      localStorage.clear();
      crear();
      llenarHastaElFinal();
      for (const n of [1, 2, 3, 4, 5, 6]) {
        clic(`ccp-ir-${n}`);
        const visible = document.querySelector(".ccp")?.textContent ?? "";
        expect(visible, `${idioma} paso ${n}`).not.toMatch(/[;«»—–·!"]/u);
      }
      montados.pop()?.desmontar();
    }
  });

  it("al cambiar el idioma todo se dibuja de nuevo y la vista recibe el idioma", () => {
    const m = crear();
    h.lang = "en";
    m.creador.pintar();
    expect(titulo()).toBe("Your brand");
    expect(m.mensajes[m.mensajes.length - 1]?.idioma).toBe("en");
    expect(texto("#ccp-seguir")).toBe("Next");
  });
});

describe("las piezas puras de la página", () => {
  it("accionesDelFinal pone un solo principal en cada caso y Activar sería el principal", () => {
    const casos = [
      { compartir: true, activar: false, descargada: false },
      { compartir: true, activar: false, descargada: true },
      { compartir: false, activar: false, descargada: false },
      { compartir: false, activar: false, descargada: true },
      { compartir: true, activar: true, descargada: true },
    ];
    for (const c of casos) expect(accionesDelFinal(c).filter((a) => a.principal)).toHaveLength(1);
    expect(accionesDelFinal({ compartir: true, activar: true, descargada: false })[0]).toEqual({ id: "activar", principal: true });
    expect(accionesDelFinal({ compartir: false, activar: false, descargada: false })).toEqual([
      { id: "descargar", principal: true },
      { id: "correo", principal: false },
    ]);
    expect(accionesDelFinal({ compartir: true, activar: false, descargada: true })).toEqual([
      { id: "compartir", principal: true },
      { id: "descargar", principal: false },
      { id: "correo", principal: false },
    ]);
  });

  it("cada paso elige su pestaña de la vista", () => {
    expect([1, 2, 3, 5, 6].map((n) => pestanaDelPaso(n as 1 | 2 | 3 | 5 | 6).pantalla)).toEqual(["previa", "previa", "previa", "previa", "previa"]);
    expect(pestanaDelPaso(4)).toEqual({ pantalla: "hola", reglasAbiertas: false });
    expect(pestanaDelPaso(5).reglasAbiertas).toBe(true);
  });

  it("la escala del celular cabe en la caja y no pasa de 1,25", () => {
    expect(escalaDelCelular(390, 844)).toBe(1);
    expect(escalaDelCelular(546, 640)).toBeCloseTo(640 / 844, 5);
    expect(escalaDelCelular(2000, 3000)).toBe(1.25);
    expect(escalaDelCelular(0, 500)).toBe(1);
  });
});
