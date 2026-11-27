// @vitest-environment jsdom
/**
 * Una campaña de personas, con la lista ya cerrada o el sorteo hecho, y un celular que solo guarda su llave (sin recuerdo): la
 * consulta propia puede quedar sin respuesta con 150 celulares en la misma conexión. La página no pinta una pantalla final por
 * una sola falla: repite la consulta con el ritmo de siempre y con tope, y agotados los intentos deja Probar de nuevo. Lo mismo
 * vale para quien quedó en Hola o en la previa y la lista se cerró mientras miraba. Con una sala de mentira: nada llama a ningún
 * servicio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA, asentar, prepararCelular, propio, publico, type Mundo } from "./celular-falso";
import { INTENTOS_POR_LA_LLAVE, type BotonDeGoogle, type DepsDelCelular, type EstadoPropio, type Fase, type SesionDelCelular } from "./celular";
import { SIN_CUENTA } from "./memoria";
import { TEXTOS_CAMPANA } from "./textos";

const SALA = "evento-ejemplo";
const CODIGO = "4821";
const ANA: SesionDelCelular = { cuenta: SIN_CUENTA, nombre: "Ana P." };
const ES = TEXTOS_CAMPANA.es;

type Respuesta = EstadoPropio | "red" | "terminada";

/** Un botón de Google que entra cuando la prueba lo pide. */
function googleFalso(): { google: BotonDeGoogle; entrar: () => void } {
  let entrada: (sesion: SesionDelCelular) => void = () => undefined;
  return {
    google: {
      montar: (contenedor, alEntrar) => {
        const boton = document.createElement("button");
        boton.className = "google-falso";
        contenedor.append(boton);
        entrada = alEntrar;
        return () => contenedor.replaceChildren();
      },
    },
    entrar: () => entrada(ANA),
  };
}

/** Una sala que contesta lo propio con lo que diga la lista, una respuesta por pedido, y repite la última. */
function salaFalsa(fase: Fase, ...respuestas: Respuesta[]) {
  const estado = { fase, respuestas, pedidos: 0 };
  const yo = vi.fn(async (): Promise<Respuesta> => {
    const n = estado.pedidos;
    estado.pedidos += 1;
    return estado.respuestas[Math.min(n, estado.respuestas.length - 1)] as Respuesta;
  });
  return { estado, yo, publico: async () => ({ ...publico(), fase: estado.fase }) };
}

async function montar(sala: ReturnType<typeof salaFalsa>, cambios: Partial<DepsDelCelular> = {}) {
  const g = googleFalso();
  const mundo = await prepararCelular({
    persona: { google: g.google },
    sala: SALA,
    llaveGuardada: () => true,
    publico: sala.publico,
    yo: sala.yo,
    resultado: async () => ({ ganadoras: ["p1:aaaaaaaaaaaaaaaaaaaaaaaaaa"], comprobante: null }),
    ...cambios,
  });
  await asentar();
  return { mundo, g };
}

/** Pasa el turno de la consulta de siempre y deja que la página termine lo que pidió. */
async function turno(mundo: Mundo): Promise<void> {
  await mundo.disparar(15_000);
  await asentar();
  await asentar();
}

const dice = (mundo: Mundo): string => mundo.raiz.querySelector("#cmp-estado")?.textContent ?? "";
const titulo = (mundo: Mundo, seccion: string): string | undefined => mundo.raiz.querySelector(`${seccion} h1`)?.textContent ?? undefined;
const boton = (mundo: Mundo): HTMLButtonElement | null => mundo.raiz.querySelector<HTMLButtonElement>("#cmp-estado button");
const ganadora = (): EstadoPropio => ({ ...propio("sorteada"), gano: true, codigo: CODIGO });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("al abrir el enlace solo con la llave del celular, si la consulta propia queda sin respuesta", () => {
  it("con la lista cerrada no dice que la inscripción cerró: repite sola y, cuando la sala contesta, muestra que sigue en la lista", async () => {
    const sala = salaFalsa("cerrada", "red", propio("cerrada"));
    const { mundo } = await montar(sala);
    expect(sala.yo).toHaveBeenCalledTimes(1);
    expect(dice(mundo)).not.toContain(ES.cpCerro);
    expect(boton(mundo)).toBeNull();
    await turno(mundo);
    expect(sala.yo).toHaveBeenCalledTimes(2);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estabas en la lista");
  });

  it("con el sorteo hecho no manda a preguntar en el stand: quien ganó ve Ganaste con su código en cuanto la sala contesta", async () => {
    const sala = salaFalsa("sorteada", "red", "red", ganadora());
    const { mundo } = await montar(sala);
    expect(dice(mundo)).not.toContain(ES.cpSorteado);
    await turno(mundo);
    expect(dice(mundo)).not.toContain(ES.cpSorteado);
    await turno(mundo);
    expect(titulo(mundo, "#cmp-estado")).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-codigo")?.textContent).toBe(CODIGO);
  });

  it("los intentos tienen tope: agotados, queda la pantalla de siempre con Probar de nuevo y la página deja de pedir sola", async () => {
    const sala = salaFalsa("sorteada", "red");
    const { mundo } = await montar(sala);
    for (let intento = 1; intento < INTENTOS_POR_LA_LLAVE; intento += 1) {
      expect(sala.yo).toHaveBeenCalledTimes(intento);
      expect(dice(mundo)).toBe("");
      await turno(mundo);
    }
    expect(sala.yo).toHaveBeenCalledTimes(INTENTOS_POR_LA_LLAVE);
    expect(dice(mundo)).toContain(ES.cpSorteado);
    expect(dice(mundo)).toContain(ES.cpPreguntaEnStand);
    expect(dice(mundo)).not.toContain("otra persona");
    expect(boton(mundo)?.textContent).toBe(ES.cpProbarDeNuevo);
    expect(mundo.raiz.querySelectorAll("#cmp-estado .cmp-accion .primary")).toHaveLength(1);
    await turno(mundo);
    await mundo.disparar(60_000);
    expect(sala.yo).toHaveBeenCalledTimes(INTENTOS_POR_LA_LLAVE);
  });

  it("Probar de nuevo vuelve a consultar: si la sala contesta, quien ganó ve Ganaste, y si no, la pantalla queda con su botón", async () => {
    const sala = salaFalsa("sorteada", "red");
    const { mundo } = await montar(sala);
    for (let intento = 1; intento < INTENTOS_POR_LA_LLAVE; intento += 1) await turno(mundo);
    boton(mundo)?.click();
    await asentar();
    await asentar();
    expect(sala.yo).toHaveBeenCalledTimes(INTENTOS_POR_LA_LLAVE + 1);
    expect(boton(mundo)?.textContent).toBe(ES.cpProbarDeNuevo);
    sala.estado.respuestas = [ganadora()];
    boton(mundo)?.click();
    await asentar();
    await asentar();
    expect(titulo(mundo, "#cmp-estado")).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-codigo")?.textContent).toBe(CODIGO);
    expect(boton(mundo)).toBeNull();
  });

  it("con la pantalla de Probar de nuevo a la vista, volver a la pestaña consulta una vez", async () => {
    const sala = salaFalsa("cerrada", "red");
    const { mundo } = await montar(sala);
    for (let intento = 1; intento < INTENTOS_POR_LA_LLAVE; intento += 1) await turno(mundo);
    expect(dice(mundo)).toContain(ES.cpCerro);
    sala.estado.respuestas = [propio("cerrada")];
    await mundo.volver();
    await asentar();
    expect(sala.yo).toHaveBeenCalledTimes(INTENTOS_POR_LA_LLAVE + 1);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estabas en la lista");
  });

  it("mientras repite, cambiar el idioma no borra la espera de la carga que estaba a la vista", async () => {
    const sala = salaFalsa("cerrada", "red");
    const { mundo } = await montar(sala);
    const espera = mundo.raiz.querySelector<HTMLElement>("#cmp-estado") as HTMLElement;
    espera.textContent = ES.cpCargando;
    mundo.vista.pintar();
    expect(espera.hidden).toBe(false);
    expect(espera.textContent).toBe(ES.cpCargando);
  });

  it("si al abrir no había conexión, Probar de nuevo consulta también por la llave y quien ganó ve Ganaste", async () => {
    const sala = salaFalsa("sorteada", ganadora());
    let hayRed = false;
    const { mundo } = await montar(sala, { publico: async () => (hayRed ? { ...publico(), fase: "sorteada" } : "red") });
    expect(dice(mundo)).toContain(ES.cpSinRed);
    expect(sala.yo).not.toHaveBeenCalled();
    hayRed = true;
    boton(mundo)?.click();
    await asentar();
    await asentar();
    expect(titulo(mundo, "#cmp-estado")).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-codigo")?.textContent).toBe(CODIGO);
  });

  it("con la pestaña escondida no pide nada", async () => {
    const sala = salaFalsa("cerrada", "red");
    const { mundo } = await montar(sala);
    mundo.ponerVisible(false);
    await turno(mundo);
    expect(sala.yo).toHaveBeenCalledTimes(1);
  });

  it("el botón sale también en inglés, sin textos nuevos", async () => {
    const sala = salaFalsa("cerrada", "red");
    const { mundo } = await montar(sala, { idioma: () => "en", tx: (clave) => TEXTOS_CAMPANA.en[clave as keyof typeof TEXTOS_CAMPANA.en] ?? clave });
    for (let intento = 1; intento < INTENTOS_POR_LA_LLAVE; intento += 1) await turno(mundo);
    expect(dice(mundo)).toContain(TEXTOS_CAMPANA.en.cpCerro);
    expect(boton(mundo)?.textContent).toBe("Try again");
  });

  it("si la sala contesta que esa llave no está en la lista, la pantalla de siempre sale sin botón y sin más pedidos", async () => {
    const sala = salaFalsa("sorteada", "red", { ...propio("sorteada"), anotada: false });
    const { mundo } = await montar(sala);
    await turno(mundo);
    expect(dice(mundo)).toContain(ES.cpPreguntaEnStand);
    expect(boton(mundo)).toBeNull();
    await turno(mundo);
    expect(sala.yo).toHaveBeenCalledTimes(2);
  });
});

describe("quien quedó en Hola o en la previa con la llave guardada, cuando la lista deja de estar abierta", () => {
  it("desde la previa, antes de decir que la inscripción cerró pregunta por la llave: quien ya estaba anotada ve que sigue en la lista", async () => {
    const sala = salaFalsa("abierta", propio("cerrada"));
    const { mundo } = await montar(sala);
    expect(mundo.raiz.querySelector(".google-falso")).not.toBeNull();
    expect(sala.yo).not.toHaveBeenCalled();
    sala.estado.fase = "cerrada";
    await turno(mundo);
    expect(sala.yo).toHaveBeenCalledTimes(1);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estabas en la lista");
    expect(dice(mundo)).not.toContain(ES.cpCerro);
  });

  it("desde Hola, con el sorteo ya hecho, quien ganó ve Ganaste con su código", async () => {
    const sala = salaFalsa("abierta", ganadora());
    const { mundo, g } = await montar(sala);
    g.entrar();
    await asentar();
    expect(titulo(mundo, "#cmp-hola")).toBe("Hola, Ana P.");
    sala.estado.fase = "sorteada";
    await turno(mundo);
    expect(titulo(mundo, "#cmp-estado")).toBe("Ganaste");
    expect(mundo.raiz.querySelector("#cmp-estado .cmp-codigo")?.textContent).toBe(CODIGO);
  });

  it("si esa consulta queda sin respuesta, no pinta la pantalla final: la repite en el turno siguiente", async () => {
    const sala = salaFalsa("abierta", "red", propio("cerrada"));
    const { mundo, g } = await montar(sala);
    g.entrar();
    await asentar();
    sala.estado.fase = "cerrada";
    await turno(mundo);
    expect(sala.yo).toHaveBeenCalledTimes(1);
    expect(dice(mundo)).not.toContain(ES.cpCerro);
    expect(mundo.raiz.querySelector<HTMLElement>("#cmp-hola")?.hidden).toBe(false);
    await turno(mundo);
    expect(titulo(mundo, "#cmp-adentro")).toBe("Ya estás adentro");
  });

  it("agotados los intentos, la lista cerrada se dice con Probar de nuevo", async () => {
    const sala = salaFalsa("abierta", "red");
    const { mundo } = await montar(sala);
    sala.estado.fase = "cerrada";
    for (let intento = 1; intento <= INTENTOS_POR_LA_LLAVE; intento += 1) await turno(mundo);
    expect(sala.yo).toHaveBeenCalledTimes(INTENTOS_POR_LA_LLAVE);
    expect(dice(mundo)).toContain(ES.cpCerro);
    expect(boton(mundo)?.textContent).toBe(ES.cpProbarDeNuevo);
  });

  it("sin la llave no pregunta nada: la lista cerrada se dice como siempre, sin botón", async () => {
    const sala = salaFalsa("abierta", propio("cerrada"));
    const { mundo } = await montar(sala, { llaveGuardada: () => false });
    sala.estado.fase = "cerrada";
    await turno(mundo);
    expect(sala.yo).not.toHaveBeenCalled();
    expect(dice(mundo)).toContain(ES.cpCerro);
    expect(boton(mundo)).toBeNull();
  });
});

describe("una campaña de cuentas no cambia", () => {
  it("la lista que se cierra con la previa a la vista se dice como siempre, sin consultar lo propio y sin botón", async () => {
    const sala = salaFalsa("abierta", "red");
    const mundo = await prepararCelular({ sala: SALA, publico: sala.publico, yo: sala.yo, llaveGuardada: () => true });
    sala.estado.fase = "cerrada";
    await turno(mundo);
    expect(sala.yo).not.toHaveBeenCalled();
    expect(dice(mundo)).toContain(ES.cpCerro);
    expect(boton(mundo)).toBeNull();
  });

  it("al abrir con el sorteo hecho y sin sesión dice que ya se hizo, sin consultar lo propio y sin botón de reintento", async () => {
    const sala = salaFalsa("sorteada", "red");
    const mundo = await prepararCelular({ sala: SALA, publico: sala.publico, yo: sala.yo, llaveGuardada: () => true, resultado: async () => ({ ganadoras: [], comprobante: null }) });
    await turno(mundo);
    expect(sala.yo).not.toHaveBeenCalled();
    expect(dice(mundo)).toContain(ES.cpSorteado);
    expect(boton(mundo)).toBeNull();
  });
});
