// @vitest-environment jsdom
/** Pruebas de la entrada de participar.html con la sala, Google, el idioma y el reloj de mentira. */

import { webcrypto } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFalso, type Llamada, type Paso } from "../sala/fetch-falso";
import { network } from "../stellar/config";
import { pollarIntentKey } from "../stellar/pollar-config";

const CUENTA = `G${"A".repeat(55)}`;
const CLAVE = "abcdefghijklmnopqrstuv";
const PASE = "ABCDEFGHIJKL";
const TOKEN = `tok_${"q".repeat(30)}`;
const ENLACE = `?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}#${CLAVE}`;

const h = vi.hoisted(() => ({
  lang: "es" as "es" | "en",
  activa: true,
  enApp: false,
  hayPollar: false,
  cambiarIdioma: null as null | (() => void),
  oyentes: 0,
  precargar: vi.fn(),
  billetera: {
    address: null as string | null,
    label: "Google",
    restore: vi.fn(),
    connect: vi.fn(),
    profile: vi.fn(),
    disconnect: vi.fn(),
    tokenDeSesion: vi.fn(),
  },
}));

vi.mock("../pagina", () => ({}));
vi.mock("../version-nueva", () => ({}));
vi.mock("./campana.css", () => ({}));
vi.mock("./vista-previa.css", () => ({}));
vi.mock("../navegador", () => ({ enNavegadorDeApp: () => h.enApp }));
vi.mock("./bandera", () => ({ campanasActivo: () => h.activa }));
vi.mock("../stellar/wallet-pollar", () => ({
  ENTRADA_BLOQUEADA: "popup-blocked",
  ENTRADA_CERRADA: "popup-closed",
  ENTRADA_SIN_SESION: "popup-nosession",
  pollarWallet: h.billetera,
  precargarSdk: h.precargar,
}));
vi.mock("../stellar/pollar-config", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("../stellar/pollar-config")>()),
  hasPollarKey: () => h.hayPollar,
}));
vi.mock("../idioma", async () => {
  const { TEXTOS_CAMPANA } = await import("./textos");
  return {
    getLang: () => h.lang,
    initialLang: () => h.lang,
    onLangChange: (fn: () => void) => {
      h.cambiarIdioma = fn;
      h.oyentes += 1;
    },
    setLang: (lang: "es" | "en") => {
      h.lang = lang;
    },
    texto: (clave: string) => TEXTOS_CAMPANA[h.lang][clave] ?? clave,
  };
});

const html = readFileSync("participar.html", "utf8");
const main = (/<header[\s\S]*<\/header>/.exec(html)?.[0] ?? "") + (/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "");
const AHORA = Date.UTC(2026, 10, 15, 18, 0);
const memoriaOriginal = Object.getOwnPropertyDescriptor(window, "localStorage");
const esperaReal = globalThis.setTimeout;

/** La campaña como la guarda la sala, con el texto firmado adentro. */
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
const envuelta = (c: unknown = campanaCruda()): Paso => ({ estado: 200, cuerpo: { texto: JSON.stringify(c), firma: "f" } });
const estadoDeSala = (cambios: Record<string, unknown> = {}): Paso => ({
  estado: 200,
  cuerpo: { fase: "abierta", total: 37, cierraMs: AHORA + 3_600_000, pase: "vale", quitadas: {}, ...cambios },
});
const yoDeSala = (anotada: boolean): Paso => ({
  estado: 200,
  cuerpo: { fase: "abierta", total: 37, cierraMs: AHORA + 3_600_000, anotada },
});
const noEsta: Paso = { estado: 404, cuerpo: { error: "no-existe" } };

let llamadas: Llamada[] = [];

/** Pone una sala de mentira detrás del `fetch` global. */
function ponerSala(guion: Record<string, Paso[]>): void {
  const sala = fetchFalso(guion);
  llamadas = sala.llamadas;
  vi.stubGlobal("fetch", sala.f);
}

/** Da respiros reales, para el cifrado y la lectura de las respuestas, y deja correr el reloj falso. */
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

function cambiarAIngles(): void {
  h.lang = "en";
  h.cambiarIdioma?.();
}

const texto = (selector: string): string | undefined => document.querySelector(selector)?.textContent ?? undefined;

/** La marca que deja una entrada anterior con Google en este navegador: sin ella la página no busca ninguna sesión. */
const ponerMarcaDeGoogle = (): void => localStorage.setItem(pollarIntentKey(network.name), "google");

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  vi.stubGlobal("crypto", webcrypto);
  document.body.innerHTML = main;
  h.lang = "es";
  h.activa = true;
  h.enApp = false;
  h.hayPollar = false;
  h.cambiarIdioma = null;
  h.oyentes = 0;
  h.precargar.mockReset();
  h.billetera.address = null;
  h.billetera.label = "Google";
  h.billetera.restore.mockReset().mockResolvedValue(null);
  h.billetera.connect.mockReset().mockResolvedValue(CUENTA);
  h.billetera.profile.mockReset().mockReturnValue({ name: "Ana Pérez", mail: "ana@example.org" });
  h.billetera.disconnect.mockReset().mockResolvedValue(undefined);
  h.billetera.tokenDeSesion.mockReset().mockResolvedValue(TOKEN);
  localStorage.clear();
  sessionStorage.clear();
  llamadas = [];
  ponerSala({ campana: [envuelta()], estado: [estadoDeSala()], yo: [yoDeSala(false)], resultado: [noEsta] });
});

afterEach(() => {
  if (memoriaOriginal) Object.defineProperty(window, "localStorage", memoriaOriginal);
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("participar.html: antes de la sala", () => {
  it("con la bandera apagada muestra el aviso y lo traduce sin pedir nada", async () => {
    h.activa = false;
    await abrir();
    expect(texto("#cmp-estado")).toBe("Las campañas de empresas todavía no están abiertas.");
    expect(llamadas).toHaveLength(0);
    cambiarAIngles();
    expect(texto("#cmp-estado")).toBe("Company campaigns aren't open yet.");
  });

  it("con la bandera apagada no se toca la billetera de Google ni se escribe la llave del celular", async () => {
    h.activa = false;
    h.hayPollar = true;
    await abrir();
    expect(llamadas).toHaveLength(0);
    expect(h.precargar).not.toHaveBeenCalled();
    expect(h.billetera.restore).not.toHaveBeenCalled();
    expect(localStorage.getItem("tinkazo.equipo.llaves")).toBeNull();
  });

  it("la demostración no pide nada, no toca la billetera y no escribe la llave del celular", async () => {
    h.hayPollar = true;
    await abrir("?demo=campana&estado=hola");
    await asentar(2_000);
    expect(llamadas).toHaveLength(0);
    expect(h.precargar).not.toHaveBeenCalled();
    expect(h.billetera.restore).not.toHaveBeenCalled();
    expect(h.billetera.connect).not.toHaveBeenCalled();
    expect(localStorage.getItem("tinkazo.equipo.llaves")).toBeNull();
  });

  it("un enlace sin evento válido muestra que la campaña no existe, sin pedir nada", async () => {
    await abrir("?c=NO");
    expect(llamadas).toHaveLength(0);
    expect(texto("#cmp-estado")).toBe("Este QR no es el del stand o la campaña ya terminó.");
  });

  it("un enlace sin s muestra que la campaña no existe, sin pedir nada", async () => {
    await abrir(`?c=evento-ejemplo&p=${PASE}#${CLAVE}`);
    expect(llamadas).toHaveLength(0);
    expect(texto("#cmp-estado")).toBe("Este QR no es el del stand o la campaña ya terminó.");
  });

  it("un enlace sin clave muestra que la campaña no existe, sin pedir nada", async () => {
    await abrir(`?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}`);
    expect(llamadas).toHaveLength(0);
    expect(texto("#cmp-estado")).toBe("Este QR no es el del stand o la campaña ya terminó.");
  });

  it("una sala sin campaña muestra su mensaje y lo traduce", async () => {
    ponerSala({ campana: [noEsta] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("Este QR no es el del stand o la campaña ya terminó.");
    cambiarAIngles();
    expect(texto("#cmp-estado")).toBe("This isn't the booth QR, or the campaign is over.");
  });

  it("una campaña de la red principal con la página en la de prueba muestra cpMal", async () => {
    ponerSala({ campana: [envuelta(campanaCruda({ red: "mainnet" }))] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("No pudimos mostrar esta campaña. Avisale a quien atiende el stand.");
    expect(document.querySelector("#cmp-estado button")).toBeNull();
  });

  it("una configuración inválida muestra su mensaje sin reintento", async () => {
    ponerSala({ campana: [envuelta({ v: 2 })] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("No pudimos mostrar esta campaña. Avisale a quien atiende el stand.");
    expect(document.querySelector("#cmp-estado button")).toBeNull();
  });

  it("mientras carga muestra el indicador y lo traduce", async () => {
    ponerSala({ campana: ["colgado"] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("Un momento…");
    cambiarAIngles();
    expect(texto("#cmp-estado")).toBe("One moment…");
  });

  it("sin la sala al cargar muestra Probar de nuevo, vuelve a pedir y no suma oyentes", async () => {
    ponerSala({ campana: [{ estado: 500, texto: "caído" }] });
    await abrir();
    await asentar(3_100);
    const boton = document.querySelector<HTMLButtonElement>("#cmp-estado button");
    expect(texto("#cmp-estado")).toContain("No hay conexión");
    expect(boton?.textContent).toBe("Probar de nuevo");
    const antes = llamadas.length;
    boton?.click();
    await asentar(3_100);
    expect(llamadas.length).toBeGreaterThan(antes);
    expect(h.oyentes).toBe(1);
    cambiarAIngles();
    expect(document.querySelector("#cmp-estado button")?.textContent).toBe("Try again");
  });

  it("una primera carga que falla y una segunda buena pintan la campaña sin pasar por sin conexión", async () => {
    ponerSala({ campana: [{ estado: 500, texto: "caído" }, envuelta()], estado: [estadoDeSala()] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("Un momento…");
    await asentar(3_100, 8);
    expect(texto("#cmp-estado")).not.toContain("No hay conexión");
    expect(texto("h1")).toBe("Sorteo de Alcancía Andina");
  });
});

describe("participar.html: con la sala", () => {
  it("pinta la campaña con el contador de la sala y no el del archivo", async () => {
    ponerSala({ campana: [envuelta(campanaCruda({ anotadas: 12 }))], estado: [estadoDeSala({ total: 37 })] });
    await abrir();
    expect(texto("h1")).toBe("Sorteo de Alcancía Andina");
    expect(texto("#cmp-saber .cmp-contador")).toBe("37 personas ya se anotaron");
  });

  it("pide la campaña y el estado a la sala del enlace, con el pase y sin la clave", async () => {
    await abrir();
    expect(llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/ABCDEFGH/campana");
    expect(llamadas.find((l) => l.ruta === "estado")?.url).toBe(`https://s.tinkazo.app/v1/sala/ABCDEFGH/campana/estado?p=${PASE}`);
    expect(llamadas.some((l) => l.url.includes(CLAVE))).toBe(false);
  });

  it("con el pase vencido y nunca anotada muestra que el QR cambió", async () => {
    ponerSala({ campana: [envuelta()], estado: [estadoDeSala({ pase: "vencido" })] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("Este QR ya cambió. Escaneá el que está en la pantalla del stand.");
  });

  it("la sala que ya no existe y un recuerdo de que ganó muestran Recibir mi premio", async () => {
    ponerSala({ campana: [noEsta] });
    localStorage.setItem(
      "tinkazo.campana.ABCDEFGH",
      JSON.stringify({ cuenta: CUENTA, fase: "sorteada", resultado: "gano", comprobante: "/verificar.html?id=7", guardado: AHORA }),
    );
    await abrir();
    expect(texto("#cmp-estado .cmp-grande")).toBe("Este sorteo ya terminó");
    expect(texto("#cmp-estado .primary")).toBe("Recibir mi premio");
    cambiarAIngles();
    expect(texto("#cmp-estado .primary")).not.toBe("Recibir mi premio");
  });

  it("la sala que ya no existe y un recuerdo con comprobante muestran Ver cómo se eligió", async () => {
    ponerSala({ campana: [noEsta] });
    localStorage.setItem(
      "tinkazo.campana.ABCDEFGH",
      JSON.stringify({ cuenta: CUENTA, fase: "sorteada", resultado: "otra", comprobante: "/verificar.html?id=7", guardado: AHORA }),
    );
    await abrir();
    const enlace = document.querySelector<HTMLAnchorElement>("#cmp-estado a.primary");
    expect(enlace?.textContent).toBe("Ver cómo se eligió");
    expect(enlace?.getAttribute("href")).toBe("/verificar.html?id=7");
  });

  it("la sala que ya no existe sin ningún recuerdo muestra que el QR no es del stand", async () => {
    ponerSala({ campana: [noEsta] });
    await abrir();
    expect(texto("#cmp-estado")).toBe("Este QR no es el del stand o la campaña ya terminó.");
  });

  it("con la llave del proveedor y fuera de una aplicación baja Google enseguida, sin esperar un momento ocioso", async () => {
    h.hayPollar = true;
    await abrir();
    expect(h.precargar).toHaveBeenCalledTimes(1);
  });

  it("dentro de una aplicación no baja Google y avisa que se abra en el navegador", async () => {
    h.hayPollar = true;
    h.enApp = true;
    await abrir();
    expect(h.precargar).not.toHaveBeenCalled();
    expect(texto("#cmp-saber")).toContain("Chrome o Safari");
  });

  it("sin la llave del proveedor no baja Google ni muestra el aviso de la aplicación", async () => {
    h.hayPollar = false;
    h.enApp = true;
    await abrir();
    expect(h.precargar).not.toHaveBeenCalled();
    expect(texto("#cmp-saber")).not.toContain("Chrome o Safari");
  });

  it("una sesión que retoma Google lleva a Hola con el nombre corto", async () => {
    ponerMarcaDeGoogle();
    h.billetera.restore.mockResolvedValue(CUENTA);
    await abrir();
    expect(texto("#cmp-hola h1")).toBe("Hola, Ana P.");
  });

  it("sin la marca de una entrada anterior la campaña se ve enseguida y no se busca ninguna sesión", async () => {
    h.hayPollar = true;
    h.billetera.restore.mockResolvedValue(CUENTA);
    await abrir();
    expect(h.billetera.restore).not.toHaveBeenCalled();
    expect(texto("#cmp-saber h1")).toBe("Sorteo de Alcancía Andina");
  });

  it("no importa wallet-ui ni cuenta-lista con import estático", () => {
    const vistos = new Set<string>();
    const pendientes = [resolve("src/participar.ts")];
    const especificadores: string[] = [];
    const resolver = (desde: string, especificador: string): string | null => {
      const base = resolve(dirname(desde), especificador);
      for (const candidato of [base, `${base}.ts`, resolve(base, "index.ts")]) {
        if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
      }
      return null;
    };
    while (pendientes.length > 0) {
      const archivo = pendientes.pop() as string;
      if (vistos.has(archivo) || !archivo.endsWith(".ts")) continue;
      vistos.add(archivo);
      const codigo = readFileSync(archivo, "utf8");
      const importaciones = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gmu;
      for (const coincidencia of codigo.matchAll(importaciones)) {
        const especificador = coincidencia[1] ?? "";
        especificadores.push(especificador);
        if (!especificador.startsWith(".")) continue;
        const resuelto = resolver(archivo, especificador);
        if (resuelto) pendientes.push(resuelto);
      }
    }
    expect(vistos.size).toBeGreaterThan(5);
    expect(especificadores.filter((e) => /wallet-ui|cuenta-lista/u.test(e))).toEqual([]);
    expect(especificadores.filter((e) => /wallet-pollar$/u.test(e))).toEqual([]);
  });
});

describe("participar.html: anotarse", () => {
  async function anotarse(): Promise<void> {
    ponerMarcaDeGoogle();
    h.billetera.restore.mockResolvedValue(CUENTA);
    ponerSala({
      campana: [envuelta()],
      estado: [estadoDeSala()],
      yo: [yoDeSala(false)],
      alta: [{ estado: 201, cuerpo: { cuenta: CUENTA } }],
    });
    await abrir();
    document.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await asentar(0, 10);
  }

  it("una persona que se anota queda adentro", async () => {
    await anotarse();
    expect(texto("#cmp-adentro h1")).toBe("Ya estás adentro");
    expect(llamadas.filter((l) => l.ruta === "alta")).toHaveLength(1);
  });

  it("la dirección no se reescribe: la sala, el pase y la clave siguen ahí", async () => {
    await anotarse();
    expect(location.search).toBe(`?c=evento-ejemplo&s=ABCDEFGH&p=${PASE}`);
    expect(location.hash).toBe(`#${CLAVE}`);
  });

  it("después de anotarse, nada guardado contiene la clave, el pase ni el token", async () => {
    await anotarse();
    const guardado: string[] = [];
    for (const almacen of [localStorage, sessionStorage]) {
      for (let i = 0; i < almacen.length; i += 1) {
        const k = almacen.key(i) ?? "";
        guardado.push(k, almacen.getItem(k) ?? "");
      }
    }
    expect(guardado.length).toBeGreaterThan(0);
    for (const valor of guardado) {
      expect(valor).not.toContain(CLAVE);
      expect(valor).not.toContain(PASE);
      expect(valor).not.toContain(TOKEN);
    }
  });

  it("ninguna dirección pedida contiene la clave ni el token, y el token solo viaja en el cuerpo del alta", async () => {
    await anotarse();
    for (const llamada of llamadas) {
      expect(llamada.url).not.toContain(CLAVE);
      expect(llamada.url).not.toContain(TOKEN);
      expect(String(llamada.init.body ?? "")).not.toContain(CLAVE);
      if (llamada.ruta !== "alta") expect(String(llamada.init.body ?? "")).not.toContain(TOKEN);
    }
    expect(String(llamadas.find((l) => l.ruta === "alta")?.init.body)).toContain(TOKEN);
  });

  it("el alta no manda cabeceras propias", async () => {
    await anotarse();
    const alta = llamadas.find((l) => l.ruta === "alta");
    expect(alta?.init.headers).toBeUndefined();
  });
});

describe("participar.html: la demostración", () => {
  it("abre aunque el almacenamiento lance un error, con la etiqueta de ejemplo a la vista", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("almacenamiento bloqueado", "SecurityError");
      },
    });
    await abrir("?demo=campana");
    expect(texto("h1")).toBe("Sorteo de Alcancía Andina");
    expect(document.querySelector<HTMLElement>("header #cmp-ejemplo")?.hidden).toBe(false);
    expect(texto("#cmp-estado")).toBe("");
  });

  it("con una campaña real la etiqueta de ejemplo queda oculta", async () => {
    await abrir();
    expect(document.querySelector<HTMLElement>("header #cmp-ejemplo")?.hidden).toBe(true);
  });

  it("entra a Hola y cambia de idioma sin red", async () => {
    await abrir("?demo=campana&estado=hola");
    expect(texto("#cmp-hola h1")).toBe("Hola, Ana P.");
    expect(texto("#cmp-hola .primary")).toBe("Acepto y me anoto");
    cambiarAIngles();
    expect(texto("#cmp-hola h1")).toBe("Hi, Ana P.");
    expect(texto("#cmp-hola .primary")).toBe("I accept, sign me up");
    expect(llamadas).toHaveLength(0);
  });

  it("prepara la pantalla pedida por la dirección", async () => {
    await abrir("?demo=campana&estado=ganaste");
    expect(texto("#cmp-estado h1")).toBe("Ganaste");
    expect(texto("#cmp-estado .primary")).toBe("Recibir mi premio");
  });
});

describe("participar.html: el modo vista", () => {
  const donde = Object.getOwnPropertyDescriptor(window, "parent");
  afterEach(() => {
    if (donde) Object.defineProperty(window, "parent", donde);
  });

  /** Una ventana de arriba de verdad para jsdom: un marco con su propia ventana. */
  function ponerMarco(): Window {
    const marco = document.createElement("iframe");
    document.body.append(marco);
    const arriba = marco.contentWindow as Window;
    vi.spyOn(arriba, "postMessage");
    Object.defineProperty(window, "parent", { value: arriba, configurable: true });
    return arriba;
  }

  const mensaje = (): Record<string, unknown> => ({
    t: "tinkazo:vista-de-campana",
    campana: campanaCruda({ red: "mainnet", abre_ms: AHORA - 3_600_000, cierra_ms: AHORA + 3_600_000, sorteo_ms: AHORA + 7_200_000, recibir_hasta_ms: AHORA + 864_000_000 }),
    pantalla: "previa",
    idioma: "es",
    muestras: { nombre: false, premio: false, lugar: false, horas: false },
    festejar: false,
    reglasAbiertas: false,
  });

  it("con vista=previa fuera de un marco la página sigue como siempre y dice que la campaña no está", async () => {
    await abrir("?vista=previa");
    expect(document.body.classList.contains("cmp-vista")).toBe(false);
    expect(texto("#cmp-estado")).toBe("Este QR no es el del stand o la campaña ya terminó.");
  });

  it("con vista=previa dentro de un marco avisa que está lista, no pide nada y monta lo que le mandan", async () => {
    const arriba = ponerMarco();
    await abrir("?vista=previa");
    expect(arriba.postMessage).toHaveBeenCalledWith({ t: "tinkazo:vista-lista" }, location.origin);
    expect(document.body.classList.contains("cmp-vista")).toBe(true);
    window.dispatchEvent(new MessageEvent("message", { data: mensaje(), origin: location.origin, source: arriba }));
    await asentar();
    expect(texto("#cmp-saber h1")).toBe("Sorteo de Alcancía Andina");
    expect(llamadas).toHaveLength(0);
  });

  it("un mensaje que no viene de la ventana de arriba no monta nada", async () => {
    const arriba = ponerMarco();
    await abrir("?vista=previa");
    window.dispatchEvent(new MessageEvent("message", { data: mensaje(), origin: location.origin, source: window }));
    await asentar();
    expect(texto("#cmp-saber h1") ?? "").toBe("");
    expect(arriba.postMessage).toHaveBeenCalledTimes(1);
  });

  it("después de la primera campaña, cambiar el idioma repinta el celular y no vuelve a decir Cargando", async () => {
    const arriba = ponerMarco();
    await abrir("?vista=previa");
    window.dispatchEvent(new MessageEvent("message", { data: mensaje(), origin: location.origin, source: arriba }));
    await asentar();
    cambiarAIngles();
    await asentar();
    expect(texto("#cmp-saber h1")).toBe("Alcancía Andina draw");
    expect(document.body.textContent).not.toContain("One moment");
  });
});
