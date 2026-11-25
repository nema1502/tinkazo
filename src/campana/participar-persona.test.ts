// @vitest-environment jsdom
/**
 * participar.html con una campaña de personas (anotarse sin billetera): lo que carga, lo que pide y lo que no. Con la sala,
 * Google y el reloj de mentira. Lo central: con una campaña de siempre, o con el sitio construido sin la entrada nueva, la
 * página es la de hoy y nunca se pide el guion de Google.
 */

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFalso, type Llamada, type Paso } from "../sala/fetch-falso";

const CLAVE = "abcdefghijklmnopqrstuv";
const PASE = "ABCDEFGHIJKL";
const ENLACE = `?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}#${CLAVE}`;
const CLIENTE = "cliente-de-prueba.apps.example.org";
const SALA = "ABCDEFGH";

const h = vi.hoisted(() => ({
  lang: "es" as "es" | "en",
  enApp: false,
  hayPollar: true,
  /** Cuántas veces se evaluó el módulo de la billetera: con una campaña de personas, ninguna. */
  billeteraCargada: 0,
  precargar: vi.fn(),
}));

vi.mock("../pagina", () => ({}));
vi.mock("../version-nueva", () => ({}));
vi.mock("./campana.css", () => ({}));
vi.mock("./vista-previa.css", () => ({}));
vi.mock("../navegador", () => ({ enNavegadorDeApp: () => h.enApp }));
vi.mock("./bandera", () => ({ campanasActivo: () => true }));
vi.mock("../stellar/wallet-pollar", () => {
  h.billeteraCargada += 1;
  return {
    ENTRADA_BLOQUEADA: "popup-blocked",
    ENTRADA_CERRADA: "popup-closed",
    ENTRADA_SIN_SESION: "popup-nosession",
    pollarWallet: { address: null, label: "Google", restore: vi.fn(async () => null), profile: vi.fn(() => null), connect: vi.fn() },
    precargarSdk: h.precargar,
  };
});
vi.mock("../stellar/pollar-config", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("../stellar/pollar-config")>()),
  hasPollarKey: () => h.hayPollar,
}));
vi.mock("../idioma", async () => {
  const { TEXTOS_CAMPANA } = await import("./textos");
  return {
    getLang: () => h.lang,
    initialLang: () => h.lang,
    onLangChange: () => undefined,
    setLang: (lang: "es" | "en") => {
      h.lang = lang;
    },
    texto: (clave: string) => TEXTOS_CAMPANA[h.lang][clave] ?? clave,
  };
});

const html = readFileSync("participar.html", "utf8");
const main = (/<header[\s\S]*<\/header>/.exec(html)?.[0] ?? "") + (/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "");
const AHORA = Date.UTC(2026, 10, 15, 18, 0);
const esperaReal = globalThis.setTimeout;

const campanaCruda = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  evento: "evento-ejemplo",
  red: "testnet",
  estado: "abierta",
  empresa: { nombre: "Alcancía Andina", logo: null, color: "verde" },
  lugar: { es: "Hackathon", en: "Hackathon" },
  zona: "America/La_Paz",
  premios: ["400000000"],
  abre_ms: 1,
  cierra_ms: 2,
  sorteo_ms: 3,
  recibir_hasta_ms: 4,
  entrada: "google",
  pasos: [],
  bases: { es: "Bases", en: "Rules" },
  anotadas: 0,
  contrato: null,
  promo: null,
  comprobante: null,
  ...cambios,
});
const envuelta = (c: unknown): Paso => ({ estado: 200, cuerpo: { texto: JSON.stringify(c), firma: "f" } });
const estadoDeSala = (): Paso => ({
  estado: 200,
  cuerpo: { fase: "abierta", total: 37, cierraMs: AHORA + 3_600_000, pase: "vale", quitadas: {}, correo: false },
});
const yoDeSala = (anotada: boolean): Paso => ({ estado: 200, cuerpo: { fase: "abierta", total: 37, cierraMs: AHORA + 3_600_000, anotada } });
const noEsta: Paso = { estado: 404, cuerpo: { error: "no-existe" } };

/** Un token de identidad con el nombre de Ana adentro. Solo se lee el nombre: nadie lo verifica acá. */
const tokenDeAna = (): string => {
  const parte = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${parte({ alg: "RS256" })}.${parte({ name: "Ana Pérez", email: "ana@example.org", sub: "123" })}.firma`;
};

let llamadas: Llamada[] = [];
let guiones: HTMLScriptElement[] = [];
let respuestaDeGoogle: ((r: { credential?: string }) => void) | null = null;
const gis = {
  initialize: vi.fn((cfg: { callback: (r: { credential?: string }) => void }) => {
    respuestaDeGoogle = cfg.callback;
  }),
  renderButton: vi.fn((contenedor: HTMLElement) => {
    const boton = document.createElement("div");
    boton.className = "gis-falso";
    contenedor.append(boton);
  }),
};

function ponerSala(guion: Record<string, Paso[]>): void {
  const sala = fetchFalso(guion);
  llamadas = sala.llamadas;
  vi.stubGlobal("fetch", sala.f);
}

/** Intercepta el guion de Google: lo anota y, como un navegador, lo da por bajado dejando la API de Google a mano. */
function ponerGuionDeGoogle(): void {
  vi.spyOn(document.head, "append").mockImplementation((...nodos: (Node | string)[]) => {
    for (const nodo of nodos) {
      if (!(nodo instanceof HTMLScriptElement)) continue;
      guiones.push(nodo);
      queueMicrotask(() => {
        (window as unknown as { google: unknown }).google = { accounts: { id: gis } };
        nodo.dispatchEvent(new Event("load"));
      });
    }
  });
}

async function asentar(ms = 0, vueltas = 6): Promise<void> {
  for (let vuelta = 0; vuelta < vueltas; vuelta += 1) {
    await new Promise<void>((resolver) => {
      esperaReal(resolver, 3);
    });
    await vi.advanceTimersByTimeAsync(vuelta === 0 ? ms : 0);
  }
}

async function abrir(direccion = ENLACE): Promise<void> {
  window.history.replaceState(null, "", `/participar.html${direccion}`);
  await import("../participar");
  await asentar();
}

const texto = (selector: string): string | undefined => document.querySelector(selector)?.textContent ?? undefined;
const cuerpoDe = (ruta: string, n = 0): Record<string, unknown> =>
  JSON.parse(String(llamadas.filter((l) => l.ruta === ruta)[n]?.init.body ?? "{}")) as Record<string, unknown>;

const PERSONA = envuelta(campanaCruda({ identidad: "persona" }));

/** Google entrega la identidad y la persona toca Acepto y me anoto en Hola. */
async function entrarYAceptar(token = tokenDeAna()): Promise<void> {
  respuestaDeGoogle?.({ credential: token });
  await asentar();
  document.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
  await asentar();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", CLIENTE);
  document.body.innerHTML = main;
  h.lang = "es";
  h.enApp = false;
  h.hayPollar = true;
  h.billeteraCargada = 0;
  h.precargar.mockReset();
  gis.initialize.mockClear();
  gis.renderButton.mockClear();
  respuestaDeGoogle = null;
  guiones = [];
  delete (window as unknown as { google?: unknown }).google;
  localStorage.clear();
  sessionStorage.clear();
  ponerGuionDeGoogle();
  ponerSala({
    campana: [PERSONA],
    estado: [estadoDeSala()],
    yo: [yoDeSala(false)],
    alta: [{ estado: 201, cuerpo: { anotada: true } }],
    resultado: [noEsta],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("participar.html: una campaña de personas", () => {
  it("baja el guion oficial de Google, arma el botón con el cliente del sitio y no toca la billetera", async () => {
    await abrir();
    expect(guiones.map((g) => g.src)).toEqual(["https://accounts.google.com/gsi/client"]);
    expect(gis.initialize).toHaveBeenCalledTimes(1);
    expect(gis.initialize.mock.calls[0]?.[0]).toMatchObject({ client_id: CLIENTE, auto_select: false });
    expect(gis.renderButton).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#cmp-saber .cmp-google .gis-falso")).not.toBeNull();
    expect(h.billeteraCargada).toBe(0);
    expect(h.precargar).not.toHaveBeenCalled();
    expect(texto("h1")).toBe("Sorteo de Alcancía Andina");
  });

  it("al entrar con Google manda el token a la sala y queda adentro, sin cuenta en ningún lado", async () => {
    await abrir();
    const token = tokenDeAna();
    await entrarYAceptar(token);
    const alta = cuerpoDe("alta");
    expect(alta.google).toBe(token);
    expect(alta).not.toHaveProperty("token");
    expect(alta).not.toHaveProperty("cuenta");
    expect(alta.p).toBe(PASE);
    expect(texto("#cmp-adentro h1")).toBe("Ya estás adentro");
    expect(h.billeteraCargada).toBe(0);
    const recuerdo = JSON.parse(localStorage.getItem(`tinkazo.campana.${SALA}`) ?? "{}") as Record<string, unknown>;
    expect(recuerdo.cuenta).toBe("persona");
    // Del token no queda nada en el navegador.
    const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(guardado).not.toContain(token);
    expect(guardado).not.toContain("ana@example.org");
  });

  it("al entrar con Google no anota todavía: Hola muestra el nombre y los pedidos de la empresa", async () => {
    ponerSala({
      campana: [envuelta(campanaCruda({
        identidad: "persona",
        pasos: [
          { tipo: "instagram", url: "https://www.instagram.com/alcancia", texto: { es: "", en: "" } },
          { tipo: "texto", url: null, texto: { es: "Dejá tu nombre en el stand", en: "Leave your name at the booth" } },
        ],
      }))],
      estado: [estadoDeSala()],
      yo: [yoDeSala(false)],
      alta: [{ estado: 201, cuerpo: { anotada: true } }],
      resultado: [noEsta],
    });
    await abrir();
    respuestaDeGoogle?.({ credential: tokenDeAna() });
    await asentar();
    expect(llamadas.some((l) => l.ruta === "alta")).toBe(false);
    expect(texto("#cmp-hola h1")).toBe("Hola, Ana P.");
    expect(texto("#cmp-hola .cmp-der h2")).toBe("Lo que pide Alcancía Andina");
    expect(document.querySelectorAll("#cmp-hola .cmp-paso")).toHaveLength(2);
    expect(texto("#cmp-hola .cmp-otra-cuenta")).toBe("No soy Ana P.");
    document.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
    await asentar();
    expect(llamadas.filter((l) => l.ruta === "alta")).toHaveLength(1);
  });

  it("el nombre cifrado del alta es el del perfil y no sale en claro", async () => {
    await abrir();
    await entrarYAceptar();
    const cuerpo = String(llamadas.find((l) => l.ruta === "alta")?.init.body ?? "");
    expect(cuerpo).not.toContain("Ana");
    expect(cuerpo).not.toContain(CLAVE);
  });

  it("al recargar ya anotada se reconoce por la llave del celular: ni guion de Google ni billetera", async () => {
    await abrir();
    await entrarYAceptar();
    const llaveDelAlta = cuerpoDe("alta").llave;
    // La página se vuelve a abrir: el navegador conserva su memoria, la sala dice que está anotada.
    vi.resetModules();
    guiones = [];
    gis.initialize.mockClear();
    document.body.innerHTML = main;
    ponerSala({ campana: [PERSONA], estado: [estadoDeSala()], yo: [yoDeSala(true)], resultado: [noEsta] });
    await abrir();
    expect(guiones).toHaveLength(0);
    expect(gis.initialize).not.toHaveBeenCalled();
    expect(texto("#cmp-adentro h1")).toBe("Ya estabas en la lista");
    const yo = cuerpoDe("yo");
    expect(yo).toEqual({ llave: llaveDelAlta });
    expect(h.billeteraCargada).toBe(0);
  });

  it("la consulta propia va con la llave sola, sin cuenta", async () => {
    await abrir();
    await entrarYAceptar();
    await asentar(20_000);
    for (const n of llamadas.filter((l) => l.ruta === "yo").keys()) {
      expect(Object.keys(cuerpoDe("yo", n))).toEqual(["llave"]);
    }
  });

  it("con Google que no entrega nada lo dice y deja probar de nuevo", async () => {
    await abrir();
    respuestaDeGoogle?.({});
    await asentar();
    expect(texto("#cmp-saber .cmp-error")).toBe("No pudimos entrar con Google. Probá de nuevo en un momento.");
    expect(texto("#cmp-saber .cmp-google button.primary")).toBe("Probar de nuevo");
    expect(llamadas.some((l) => l.ruta === "alta")).toBe(false);
  });

  it("sin el guion de Google (bloqueado o sin red) lo dice sin romperse", async () => {
    vi.restoreAllMocks();
    vi.spyOn(document.head, "append").mockImplementation((...nodos: (Node | string)[]) => {
      for (const nodo of nodos) if (nodo instanceof HTMLScriptElement) queueMicrotask(() => nodo.dispatchEvent(new Event("error")));
    });
    await abrir();
    expect(texto("#cmp-saber .cmp-error")).toBe("No pudimos entrar con Google. Probá de nuevo en un momento.");
    expect(texto("#cmp-saber .cmp-google button.primary")).toBe("Probar de nuevo");
  });

  it("en el navegador de una aplicación pide abrir el enlace en otro navegador y no baja el guion de Google", async () => {
    h.enApp = true;
    await abrir();
    expect(texto("#cmp-saber .cmp-en-app")).toBe("Para entrar con Google, abrí este enlace en Chrome o Safari.");
    expect(guiones).toHaveLength(0);
  });

  it("la sala que ya no existe y un recuerdo de que ganó dicen que el premio se entrega con quien organiza", async () => {
    ponerSala({ campana: [noEsta] });
    localStorage.setItem(
      `tinkazo.campana.${SALA}`,
      JSON.stringify({ cuenta: "persona", fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA }),
    );
    await abrir();
    expect(texto("#cmp-estado .cmp-grande")).toBe("Tu premio te lo da quien organiza");
    expect(document.querySelector("#cmp-estado .primary")).toBeNull();
    expect(guiones).toHaveLength(0);
  });
});

describe("participar.html: una campaña de personas en un sitio sin la entrada nueva", () => {
  it("con el interruptor apagado dice que todavía no se puede abrir, sin guion de Google ni más pedidos que la campaña", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "");
    await abrir();
    expect(texto("#cmp-estado")).toBe("Este sorteo todavía no se puede abrir desde acá. Avisale a quien atiende el stand.");
    expect(guiones).toHaveLength(0);
    expect(llamadas.map((l) => l.ruta)).toEqual(["campana"]);
    expect(h.billeteraCargada).toBe(0);
  });

  it("con el interruptor en otro valor que 1 también queda apagado", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "true");
    await abrir();
    expect(texto("#cmp-estado")).toContain("todavía no se puede abrir");
    expect(guiones).toHaveLength(0);
  });

  it("con el interruptor en 1 pero sin identificador de cliente de Google tampoco abre", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    await abrir();
    expect(texto("#cmp-estado")).toContain("todavía no se puede abrir");
    expect(guiones).toHaveLength(0);
  });

  it("el aviso se traduce al inglés", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "");
    h.lang = "en";
    await abrir();
    expect(texto("#cmp-estado")).toBe("This draw can't be opened from here yet. Let the people at the booth know.");
  });
});

describe("participar.html: una campaña de siempre no cambia", () => {
  beforeEach(() => {
    ponerSala({ campana: [envuelta(campanaCruda())], estado: [estadoDeSala()], yo: [yoDeSala(false)], resultado: [noEsta] });
  });

  it("con las banderas nuevas prendidas no pide el guion de Google y ofrece el Entrar de siempre", async () => {
    await abrir();
    expect(guiones).toHaveLength(0);
    expect(gis.initialize).not.toHaveBeenCalled();
    expect(document.querySelector(".cmp-google")).toBeNull();
    expect(texto("#cmp-saber button.primary")).toBe("Entrar con Google");
    expect(texto("#cmp-saber .cmp-apoyo")).toBe("Te creamos una cuenta de Tinkazo.");
    // La billetera se precarga como hoy.
    expect(h.precargar).toHaveBeenCalledTimes(1);
  });

  it("con las banderas apagadas es lo mismo", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    await abrir();
    expect(guiones).toHaveLength(0);
    expect(texto("#cmp-saber button.primary")).toBe("Entrar con Google");
    expect(h.precargar).toHaveBeenCalledTimes(1);
  });

  it("una campaña que dice cuenta en su identidad es la de siempre", async () => {
    ponerSala({ campana: [envuelta(campanaCruda({ identidad: "cuenta" }))], estado: [estadoDeSala()], yo: [yoDeSala(false)] });
    await abrir();
    expect(guiones).toHaveLength(0);
    expect(texto("#cmp-saber button.primary")).toBe("Entrar con Google");
  });

  it("una identidad que no existe no se muestra: la campaña no se abre", async () => {
    ponerSala({ campana: [envuelta(campanaCruda({ identidad: "otra" }))] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("No pudimos mostrar esta campaña. Avisale a quien atiende el stand.");
    expect(guiones).toHaveLength(0);
  });
});
