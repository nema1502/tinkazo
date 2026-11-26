// @vitest-environment jsdom
/**
 * La página del celular en una campaña de personas (anotarse sin billetera): entra con el botón de Google, ve su nombre y los
 * pedidos de quien organiza en Hola, se anota con un toque en Acepto y vuelve a estar adentro por la llave del celular. Con un
 * Google de mentira: nada llama a ningún servicio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asentar, prepararCelular, propio, publico, type Mundo } from "./celular-falso";
import type { BotonDeGoogle, DepsDelCelular, ResultadoDelAlta, SesionDelCelular } from "./celular";
import { guardarMemoria, leerMemoria, SIN_CUENTA } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

const AHORA = Date.UTC(2026, 10, 21, 18);
const SALA = "evento-ejemplo";
const LINEA = "p1:aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ANA: SesionDelCelular = { cuenta: SIN_CUENTA, nombre: "Ana P." };

function almacenFalso(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (n) => [...datos.keys()][n] ?? null,
    removeItem: (clave) => {
      datos.delete(clave);
    },
    setItem: (clave, valor) => {
      datos.set(clave, valor);
    },
  };
}

/** El botón de Google de mentira: un botón común que, al tocarlo, entrega la sesión de quien entró (o la falla que se le diga). */
function googleFalso() {
  const montajes: HTMLElement[] = [];
  const sacados: HTMLElement[] = [];
  const esperas: (string | undefined)[] = [];
  let entrada: (sesion: SesionDelCelular) => void = () => undefined;
  let falla: (motivo: "ventana" | "cerrada" | "google" | "cuentas" | "limite") => void = () => undefined;
  const google: BotonDeGoogle = {
    montar: (contenedor, alEntrar, alFallar, espera) => {
      esperas.push(espera);
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "google-falso";
      boton.textContent = "Continuar con Google";
      boton.addEventListener("click", () => alEntrar(ANA));
      contenedor.append(boton);
      montajes.push(contenedor);
      entrada = alEntrar;
      falla = alFallar;
      return () => {
        sacados.push(contenedor);
        contenedor.replaceChildren();
      };
    },
  };
  return {
    google,
    montajes,
    sacados,
    esperas,
    entrar: () => entrada(ANA),
    fallar: (motivo: "ventana" | "cerrada" | "google" | "cuentas" | "limite") => falla(motivo),
  };
}

const texto = (mundo: Mundo, selector: string): string | undefined => mundo.raiz.querySelector(selector)?.textContent ?? undefined;

/** Entra con Google y toca Acepto y me anoto en Hola. */
async function entrarYAceptar(mundo: Mundo, g: ReturnType<typeof googleFalso>): Promise<void> {
  g.entrar();
  await asentar();
  mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
  await asentar();
}

async function montarPersona(cambios: Partial<DepsDelCelular> = {}, memoria: Storage | null = almacenFalso()) {
  const g = googleFalso();
  const anotar = vi.fn(async (): Promise<ResultadoDelAlta> => ({ ok: true, ya: false }));
  const entrar = vi.fn(async (): Promise<SesionDelCelular> => {
    throw new Error("no se usa");
  });
  const mundo = await prepararCelular({ persona: { google: g.google }, anotar, entrar, memoria, ...cambios });
  return { mundo, g, anotar, entrar, memoria };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("una campaña de personas: la previa", () => {
  it("ofrece el botón de Google y no el de Entrar de siempre", async () => {
    const { mundo, g, entrar } = await montarPersona();
    expect(g.montajes).toHaveLength(1);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-google .google-falso")).not.toBeNull();
    expect(mundo.raiz.querySelector("#cmp-saber button.primary")).toBeNull();
    expect(entrar).not.toHaveBeenCalled();
  });

  it("le pide al botón una línea provisoria, en el idioma de la página, para que el lugar no quede en blanco mientras Google baja", async () => {
    const { g } = await montarPersona();
    expect(g.esperas).toEqual(["Un momento…"]);
    // Y la línea existe en las dos lenguas.
    expect(TEXTOS_CAMPANA.en.cpCargando).toBe("One moment…");
  });

  it("dice con palabras simples que no se crea ninguna cuenta", async () => {
    const { mundo } = await montarPersona();
    expect(texto(mundo, "#cmp-saber .cmp-apoyo")).toBe("Con Google confirmamos que sos vos. No te creamos ninguna cuenta.");
    const reglas = texto(mundo, "#cmp-saber .cmp-reglas") ?? "";
    expect(reglas).toContain("te entrega el premio después del sorteo");
    expect(reglas).toContain("un código que no dice quién sos");
    expect(reglas).not.toContain("tu cuenta de Tinkazo");
  });

  it("al entrar con Google muestra Hola con el nombre y no anota hasta que toca Acepto y me anoto", async () => {
    const { mundo, g, anotar } = await montarPersona();
    g.entrar();
    await asentar();
    expect(anotar).not.toHaveBeenCalled();
    expect(texto(mundo, "#cmp-hola h1")).toBe("Hola, Ana P.");
    expect(texto(mundo, "#cmp-hola .cmp-izq .cmp-apoyo")).toBe("Así salís en la pantalla del stand.");
    expect(texto(mundo, "#cmp-hola .cmp-accion .primary")).toBe("Acepto y me anoto");
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(anotar.mock.calls[0]).toEqual(["Ana P.", expect.any(Function)]);
    expect(texto(mundo, "#cmp-adentro h1")).toBe("Ya estás adentro");
  });

  it("los pedidos de quien organiza se ven en Hola antes de anotarse", async () => {
    const { mundo, g, anotar } = await montarPersona();
    g.entrar();
    await asentar();
    expect(texto(mundo, "#cmp-hola .cmp-der h2")).toBe("Lo que pide Alcancía Andina");
    expect(mundo.raiz.querySelectorAll("#cmp-hola .cmp-paso")).toHaveLength(3);
    expect(anotar).not.toHaveBeenCalled();
  });

  it("No soy Ana vuelve a la previa con el botón de Google, sin anotar a nadie", async () => {
    const { mundo, g, anotar } = await montarPersona();
    g.entrar();
    await asentar();
    const otra = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-otra-cuenta");
    expect(otra?.textContent).toBe("No soy Ana P.");
    otra?.click();
    await asentar();
    expect(anotar).not.toHaveBeenCalled();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(true);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-google .google-falso")).not.toBeNull();
    expect(g.montajes).toHaveLength(2);
  });

  it("recuerda que está adentro sin guardar ninguna cuenta", async () => {
    const { mundo, g, memoria } = await montarPersona({ sala: SALA });
    await entrarYAceptar(mundo, g);
    const recuerdo = leerMemoria(memoria, SALA, AHORA);
    expect(recuerdo?.cuenta).toBe(SIN_CUENTA);
    expect(recuerdo?.fase).toBe("abierta");
    expect(memoria?.getItem(`tinkazo.campana.${SALA}`) ?? "").not.toMatch(/G[A-Z2-7]{55}/u);
  });

  it("mientras se anota muestra Anotando y el botón no responde", async () => {
    let terminar: (r: ResultadoDelAlta) => void = () => undefined;
    const anotar = vi.fn(() => new Promise<ResultadoDelAlta>((resolver) => {
      terminar = resolver;
    }));
    const { mundo, g } = await montarPersona({ anotar });
    await entrarYAceptar(mundo, g);
    const boton = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary");
    expect(boton?.textContent).toBe("Anotando…");
    expect(boton?.disabled).toBe(true);
    terminar({ ok: true, ya: false });
    await asentar();
    expect(texto(mundo, "#cmp-adentro h1")).toBe("Ya estás adentro");
  });

  it("quien ya estaba en la lista (otro celular) ve Ya estabas en la lista", async () => {
    const { mundo, g } = await montarPersona({ anotar: vi.fn(async () => ({ ok: true, ya: true }) as const) });
    await entrarYAceptar(mundo, g);
    expect(texto(mundo, "#cmp-adentro h1")).toBe("Ya estabas en la lista");
  });

  it("si el alta falla, lo dice en Hola y el mismo botón sirve para probar de nuevo", async () => {
    const anotar = vi.fn()
      .mockResolvedValueOnce({ ok: false, motivo: "wifi" } satisfies ResultadoDelAlta)
      .mockResolvedValueOnce({ ok: true, ya: false } satisfies ResultadoDelAlta);
    const { mundo, g } = await montarPersona({ anotar });
    await entrarYAceptar(mundo, g);
    expect(texto(mundo, "#cmp-hola .cmp-error")).toContain("wifi");
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(2);
    expect(texto(mundo, "#cmp-adentro h1")).toBe("Ya estás adentro");
  });

  it("un token que la sala rechaza dice que hay que entrar de nuevo y el botón principal lleva a Google", async () => {
    const { mundo, g } = await montarPersona({ anotar: vi.fn(async () => ({ ok: false, motivo: "sesion" }) as const) });
    await entrarYAceptar(mundo, g);
    expect(texto(mundo, "#cmp-hola .cmp-error")).toBe("No pudimos confirmar tu entrada con Google. Entrá de nuevo.");
    const otra = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary");
    expect(otra?.textContent).toBe("Usar otra cuenta");
    otra?.click();
    await asentar();
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-google .google-falso")).not.toBeNull();
  });

  it("con la sala sin el modo prendido lo dice sin romperse", async () => {
    const { mundo, g } = await montarPersona({ anotar: vi.fn(async () => ({ ok: false, motivo: "apagada" }) as const) });
    await entrarYAceptar(mundo, g);
    expect(texto(mundo, "#cmp-hola .cmp-error")).toBe("Este sorteo todavía no se puede abrir desde acá. Avisale a quien atiende el stand.");
  });

  it("cuando Google no entrega la identidad, lo dice y deja un solo botón: probar de nuevo, que arma el de Google otra vez", async () => {
    const { mundo, g } = await montarPersona();
    g.fallar("google");
    await asentar();
    expect(texto(mundo, "#cmp-saber .cmp-error")).toBe("No pudimos entrar con Google. Probá de nuevo en un momento.");
    expect(mundo.raiz.querySelector(".google-falso")).toBeNull();
    const otra = mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber .cmp-google button.primary");
    expect(otra?.textContent).toBe("Probar de nuevo");
    otra?.click();
    await asentar();
    expect(g.montajes).toHaveLength(2);
    expect(mundo.raiz.querySelector(".google-falso")).not.toBeNull();
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-saber .cmp-error")?.hidden).toBe(true);
    expect(mundo.raiz.querySelector("#cmp-saber .cmp-google button.primary")).toBeNull();
  });

  it("un pase vencido o la lista cerrada llevan a su pantalla, como siempre", async () => {
    const pase = await montarPersona({ anotar: vi.fn(async () => ({ ok: false, motivo: "pase" }) as const) });
    await entrarYAceptar(pase.mundo, pase.g);
    expect(texto(pase.mundo, "#cmp-estado")).toContain("Este QR ya cambió");
    document.body.innerHTML = "";
    const cerrada = await montarPersona({ anotar: vi.fn(async () => ({ ok: false, motivo: "cerro" }) as const) });
    await entrarYAceptar(cerrada.mundo, cerrada.g);
    expect(texto(cerrada.mundo, "#cmp-estado")).toContain("La inscripción ya cerró");
  });

  it("el botón de Google no se arma de nuevo cuando solo cambia el número de personas", async () => {
    let total = 37;
    const { mundo, g } = await montarPersona({ publico: async () => ({ ...publico(), total }) });
    expect(g.montajes).toHaveLength(1);
    total = 52;
    await mundo.disparar(15_000);
    expect(g.montajes).toHaveLength(1);
    expect(g.sacados).toHaveLength(0);
    expect(texto(mundo, "#cmp-saber .cmp-contador")).toBe("52 personas ya se anotaron");
  });

  it("al volver a abrir el enlace ya anotada no pide Google: la reconoce la llave del celular", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA });
    const yo = vi.fn(async () => propio());
    const { mundo, g } = await montarPersona({ yo, sala: SALA }, memoria);
    expect(g.montajes).toHaveLength(0);
    expect(texto(mundo, "#cmp-adentro h1")).toBe("Ya estabas en la lista");
    expect(yo).toHaveBeenCalled();
  });
});

describe("una campaña de personas: el resultado", () => {
  const sorteada = (gano: boolean): Partial<DepsDelCelular> => ({
    sala: SALA,
    publico: async () => ({ ...publico(), fase: "sorteada" }),
    yo: async () => ({ ...propio("sorteada"), gano }),
    resultado: async () => ({ ganadoras: [LINEA], comprobante: "/verificar.html?demo=1" }),
  });
  const adentro = (): Storage => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA });
    return memoria;
  };

  it("quien ganó ve Ganaste, y Recibir mi premio lleva a la pantalla de la entrega con quien organiza", async () => {
    const recibir = vi.fn();
    const { mundo } = await montarPersona({ ...sorteada(true), recibir }, adentro());
    expect(texto(mundo, "#cmp-estado h1")).toBe("Ganaste");
    expect(texto(mundo, "#cmp-estado .cmp-apoyo")).toBe("Tocá el botón para ver cómo recibirlo.");
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-estado .primary")?.click();
    await asentar();
    expect(texto(mundo, "#cmp-estado h1")).toBe("Tu premio te lo da quien organiza");
    expect(texto(mundo, "#cmp-estado .cmp-apoyo")).toBe("Acercate a quien atiende el stand y mostrale esta pantalla.");
    expect(mundo.raiz.querySelector("#cmp-estado button")).toBeNull();
    expect(recibir).not.toHaveBeenCalled();
  });

  it("quien no ganó ve que salió otra persona, con la forma de siempre", async () => {
    const { mundo } = await montarPersona(sorteada(false), adentro());
    expect(texto(mundo, "#cmp-estado h1")).toBe("Esta vez salió otra persona");
    expect(texto(mundo, "#cmp-estado .cmp-apoyo")).toBe("Gracias por participar.");
  });

  it("si la llave de este celular ya no es la de la fila, no dice que salió otra persona ni lo recuerda", async () => {
    // La misma persona se anotó desde otro celular y la sala le dio ese lugar: este celular no sabe si ganó.
    const memoria = adentro();
    const { mundo, g } = await montarPersona(
      { ...sorteada(false), yo: async () => ({ ...propio("sorteada"), anotada: false }) },
      memoria,
    );
    const pantalla = texto(mundo, "#cmp-estado") ?? "";
    expect(pantalla).toContain(TEXTOS_CAMPANA.es.cpSorteado);
    expect(pantalla).not.toContain("otra persona");
    expect(pantalla).not.toContain("Ganaste");
    expect(g.montajes).toHaveLength(0);
    // Lo que queda recordado no es un resultado: al volver a abrir el enlace tampoco dice que no ganó.
    expect(leerMemoria(memoria, SALA, AHORA)?.resultado ?? null).toBeNull();
  });

  it("si la sala no dice si ganó, aunque la llave sea la de la fila, tampoco dice que salió otra persona", async () => {
    const { mundo } = await montarPersona({ ...sorteada(false), yo: async () => ({ ...propio("sorteada"), anotada: true }) }, adentro());
    expect(texto(mundo, "#cmp-estado") ?? "").not.toContain("otra persona");
    expect(texto(mundo, "#cmp-estado") ?? "").toContain(TEXTOS_CAMPANA.es.cpSorteado);
  });

  it("quien ya vio Ganaste no pierde su pantalla porque la llave de este celular dejó de ser la de la fila", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });
    const { mundo } = await montarPersona(
      { ...sorteada(true), yo: async () => ({ ...propio("sorteada"), anotada: false }) },
      memoria,
    );
    expect(texto(mundo, "#cmp-estado h1")).toBe("Ganaste");
    expect(leerMemoria(memoria, SALA, AHORA)?.resultado).toBe("gano");
  });

  it("quien ganó y vuelve a abrir el enlace ve de nuevo Ganaste por lo que recuerda, sin pedir Google", async () => {
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: SIN_CUENTA, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });
    const { mundo, g } = await montarPersona({ ...sorteada(true) }, memoria);
    expect(g.montajes).toHaveLength(0);
    expect(texto(mundo, "#cmp-estado h1")).toBe("Ganaste");
  });
});

describe("una campaña de siempre, sin la entrada de personas, es la de siempre", () => {
  it("la previa ofrece Entrar con Google, con la nota de la cuenta y sin ningún lugar para el botón de Google del sitio", async () => {
    const mundo = await prepararCelular();
    expect(texto(mundo, "#cmp-saber button.primary")).toBe("Entrar con Google");
    expect(texto(mundo, "#cmp-saber .cmp-apoyo")).toBe("Te creamos una cuenta de Tinkazo.");
    expect(mundo.raiz.querySelector(".cmp-google")).toBeNull();
    const reglas = texto(mundo, "#cmp-saber .cmp-reglas") ?? "";
    expect(reglas).toContain("te manda el premio a tu cuenta de Tinkazo");
    expect(reglas).not.toContain("un código que no dice quién sos");
  });

  it("entrar lleva a Hola y el alta espera el toque en Acepto, como siempre", async () => {
    const anotar = vi.fn(async (): Promise<ResultadoDelAlta> => ({ ok: true, ya: false }));
    const mundo = await prepararCelular({ anotar });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-saber button.primary")?.click();
    await asentar();
    expect(texto(mundo, "#cmp-hola h1")).toContain("Hola");
    expect(anotar).not.toHaveBeenCalled();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-accion .primary")?.click();
    await asentar();
    expect(anotar).toHaveBeenCalledTimes(1);
  });

  it("Ganaste dice lo de siempre y Recibir mi premio va a recibir", async () => {
    const recibir = vi.fn();
    const memoria = almacenFalso();
    guardarMemoria(memoria, SALA, { cuenta: `G${"A".repeat(55)}`, fase: "sorteada", resultado: "gano", comprobante: null, guardado: AHORA });
    const mundo = await prepararCelular({
      memoria,
      recibir,
      sala: SALA,
      publico: async () => ({ ...publico(), fase: "sorteada" }),
      yo: async () => ({ ...propio("sorteada"), gano: true }),
    });
    expect(texto(mundo, "#cmp-estado .cmp-apoyo")).toBe("Para recibirlo, dejá tu cuenta lista. Vas a necesitar abrir tu correo.");
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-estado .primary")?.click();
    await asentar();
    expect(recibir).toHaveBeenCalledTimes(1);
    expect(texto(mundo, "#cmp-estado h1")).toBe("Ganaste");
  });
});
