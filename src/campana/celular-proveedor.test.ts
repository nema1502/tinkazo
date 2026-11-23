// @vitest-environment jsdom
/**
 * Lo que la página del celular le pide al proveedor de cuentas. Después de anotarse, nada: se suelta su cliente. Quien ya
 * estaba anotada y recarga no retoma su sesión. Y cuando el servicio frena el ingreso por límite, la página lo dice con la
 * verdad y con una cuenta que baja.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DepsDelCelular } from "./celular";
import { AHORA, CUENTA, SESION, asentar, lectura, lecturasDe, pasar as pasarElReloj, prepararCelular, propio } from "./celular-falso";
import { guardarMemoria } from "./memoria";
import { TEXTOS_LIMITE } from "./limite";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";

// La tarjeta se baja con import(): con el módulo ya cargado, la espera de la prueba son unos pocos turnos.
await import("./confirmar");
await import("./limite");
await import("./recordada");

/** Las partes que la página baja con import() (la cuenta recordada, la línea del límite) llegan en unos turnos: se esperan. */
const asentarTodo = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  await asentar();
};
const pasar = async (ms: number): Promise<void> => {
  await pasarElReloj(ms);
  await asentarTodo();
};
const preparar = async (cambios: Parameters<typeof prepararCelular>[0] = {}) => {
  const mundo = await prepararCelular(cambios, true);
  await asentarTodo();
  return mundo;
};
const apoyoDeAdentro = (raiz: HTMLElement): string => raiz.querySelector("#cmp-adentro .cmp-der > .cmp-apoyo")?.textContent ?? "";
const es = TEXTOS_CAMPANA.es;

/** Un almacén de mentira para la memoria de la campaña (lo que guarda `localStorage`). */
function almacen(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (n) => [...datos.keys()][n] ?? null,
    removeItem: (clave) => void datos.delete(clave),
    setItem: (clave, valor) => void datos.set(clave, valor),
  };
}

const recuerdoDe = (memoria: Storage, fase: "abierta" | "sorteada" = "abierta", resultado: "gano" | null = null): void =>
  guardarMemoria(memoria, "evento-ejemplo", { cuenta: CUENTA, fase, resultado, comprobante: null, guardado: AHORA });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("después de anotarse, ni un pedido más al proveedor", () => {
  it("al quedar anotada con la cuenta lista, suelta la sesión una sola vez", async () => {
    const soltarSesion = vi.fn();
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("lista")) }, soltarSesion });
    // En Hola todavía no: antes de anotarse la sesión hace falta (el token de la alta).
    expect(soltarSesion).not.toHaveBeenCalled();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await pasar(50);
    expect(mundo.raiz.querySelector("#cmp-adentro h1")?.textContent).toBe(es.cpAdentro);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    await pasar(5 * 60_000);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
  });

  it("quien ya estaba anotada también la suelta cuando la cuenta está lista", async () => {
    const soltarSesion = vi.fn();
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("otro-con-correo")) }, soltarSesion });
    expect(soltarSesion).toHaveBeenCalledTimes(1);
  });

  it("sin cómo soltarla (la demostración) no hace nada y no se rompe", async () => {
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("lista")) } });
    expect(apoyoDeAdentro(mundo.raiz)).toBe(es.cpDejaAbiertaLibre);
  });

  it("mientras la cuenta se está creando y la lectura vuelve a intentar, la mantiene, y la suelta cuando se sabe", async () => {
    const soltarSesion = vi.fn();
    const leer = lecturasDe(lectura("naciendo"), lectura("lista"));
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer }, soltarSesion });
    await pasar(4_999);
    expect(soltarSesion).not.toHaveBeenCalled();
    await pasar(1);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
  });

  it("agotados los reintentos sin saber, la suelta igual: no se queda pidiendo para siempre", async () => {
    const soltarSesion = vi.fn();
    const leer = lecturasDe(lectura("no-se-sabe"));
    await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer }, soltarSesion });
    await pasar(60 * 60_000);
    expect(leer).toHaveBeenCalledTimes(13);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
  });

  it("con la tarjeta a la vista pero quieta la suelta, no la suelta con un código en juego, y la suelta cuando la tarjeta se va", async () => {
    const soltarSesion = vi.fn();
    const acciones = {
      puedeDesbloqueo: vi.fn(async () => false),
      mandarCodigo: vi.fn(async () => undefined),
      confirmarCodigo: vi.fn(async () => lectura("lista", { protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true })),
      usarDesbloqueo: vi.fn(async () => true),
      alCambiar: vi.fn(() => () => undefined),
    };
    const cada: DepsDelCelular["cada"] = (f, ms) => {
      const reloj = setInterval(f, ms);
      return () => clearInterval(reloj);
    };
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio(),
      cada,
      cuenta: { leer: lecturasDe(lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" })), confirmar: async () => acciones },
      soltarSesion,
    });
    await pasar(3_000);
    const tarjeta = mundo.raiz.querySelector("#cmp-cuenta") as HTMLElement;
    const boton = (): HTMLButtonElement => tarjeta.querySelector(".primary") as HTMLButtonElement;
    expect(tarjeta.hidden).toBe(false);
    // La tarjeta sin tocar no usa al proveedor: casi toda cuenta nueva la tiene así durante toda la espera.
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    await pasar(5 * 60_000);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    boton().click();
    await pasar(100);
    const campo = tarjeta.querySelector("input") as HTMLInputElement;
    campo.value = "ABCDEFGHI";
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    boton().click();
    await pasar(100);
    expect(acciones.confirmarCodigo).toHaveBeenCalledTimes(1);
    // Con la confirmación en curso (el código mandado, el Listo) la sesión sigue armada: no se suelta otra vez todavía.
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    // Pasado el Listo, la tarjeta se va y la sesión se suelta de nuevo.
    await pasar(5_000);
    expect(tarjeta.hidden).toBe(true);
    expect(soltarSesion).toHaveBeenCalledTimes(2);
  });

  it("un código mandado y no confirmado mantiene la sesión armada: el código vive en memoria dentro de ella", async () => {
    const soltarSesion = vi.fn();
    const acciones = {
      puedeDesbloqueo: vi.fn(async () => false),
      mandarCodigo: vi.fn(async () => undefined),
      confirmarCodigo: vi.fn(async () => lectura("lista")),
      usarDesbloqueo: vi.fn(async () => true),
      alCambiar: vi.fn(() => () => undefined),
    };
    const cada: DepsDelCelular["cada"] = (f, ms) => {
      const reloj = setInterval(f, ms);
      return () => clearInterval(reloj);
    };
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio(),
      cada,
      cuenta: { leer: lecturasDe(lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" })), confirmar: async () => acciones },
      soltarSesion,
    });
    await pasar(3_000);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    (mundo.raiz.querySelector("#cmp-cuenta .primary") as HTMLButtonElement).click();
    await pasar(100);
    expect(acciones.mandarCodigo).toHaveBeenCalledTimes(1);
    // Con el código mandado, durante diez minutos: ni un solo soltar más.
    await pasar(10 * 60_000);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
  });

  it("un código que tarda más que la espera mantiene la sesión armada hasta que contesta: el código que llega tarde sirve", async () => {
    const soltarSesion = vi.fn();
    let contestar: () => void = () => undefined;
    const acciones = {
      puedeDesbloqueo: vi.fn(async () => false),
      mandarCodigo: vi.fn(() => new Promise<void>((r) => {
        contestar = r;
      })),
      confirmarCodigo: vi.fn(async () => lectura("lista", { protegida: true, correoDeLaSesionConfirmado: true, puedeMandar: true })),
      usarDesbloqueo: vi.fn(async () => true),
      alCambiar: vi.fn(() => () => undefined),
    };
    const cada: DepsDelCelular["cada"] = (f, ms) => {
      const reloj = setInterval(f, ms);
      return () => clearInterval(reloj);
    };
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio(),
      cada,
      cuenta: { leer: lecturasDe(lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" })), confirmar: async () => acciones },
      soltarSesion,
    });
    await pasar(3_000);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    (mundo.raiz.querySelector("#cmp-cuenta .primary") as HTMLButtonElement).click();
    await pasar(100);
    expect(acciones.mandarCodigo).toHaveBeenCalledTimes(1);
    // Pasada la espera la tarjeta dice que tarda, pero el pedido sigue en vuelo: el código pendiente vive en la sesión.
    await pasar(61_000);
    expect(mundo.raiz.querySelector("#cmp-cuenta .cmp-cuenta-nota")?.textContent).toBe(TEXTOS_CONFIRMAR.es.ccTarda);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    // El código sale tarde: la tarjeta lo acepta y la sesión sigue armada para confirmarlo.
    contestar();
    await pasar(100);
    expect(mundo.raiz.querySelector("#cmp-cuenta .cmp-cuenta-t")?.textContent).toBe(TEXTOS_CONFIRMAR.es.ccCodigoT);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
  });

  it("un pedido de la tarjeta que tarda y después falla deja soltar la sesión cuando contesta", async () => {
    const soltarSesion = vi.fn();
    let fallar: (e: Error) => void = () => undefined;
    const acciones = {
      puedeDesbloqueo: vi.fn(async () => false),
      mandarCodigo: vi.fn(() => new Promise<void>((_, rechazar) => {
        fallar = rechazar;
      })),
      confirmarCodigo: vi.fn(async () => lectura("lista")),
      usarDesbloqueo: vi.fn(async () => true),
      alCambiar: vi.fn(() => () => undefined),
    };
    const cada: DepsDelCelular["cada"] = (f, ms) => {
      const reloj = setInterval(f, ms);
      return () => clearInterval(reloj);
    };
    const mundo = await preparar({
      sesion: async () => SESION,
      yo: async () => propio(),
      cada,
      cuenta: { leer: lecturasDe(lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" })), confirmar: async () => acciones },
      soltarSesion,
    });
    await pasar(3_000);
    (mundo.raiz.querySelector("#cmp-cuenta .primary") as HTMLButtonElement).click();
    await pasar(61_100);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    fallar(new Error("rota"));
    await pasar(100);
    expect(soltarSesion).toHaveBeenCalledTimes(2);
  });

  it("en Ganaste, sin saber cómo está la cuenta, la lee al llegar y no otra vez en cada consulta del minuto", async () => {
    const leer = lecturasDe(lectura("no-se-sabe"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer }, soltarSesion: vi.fn() });
    await pasar(60 * 60_000);
    expect(leer).toHaveBeenCalledTimes(13);
    mundo.deps.yo = async () => ({ ...propio("sorteada"), gano: true });
    await mundo.disparar(15_000);
    await pasar(50);
    expect(mundo.raiz.querySelector("#cmp-estado h1")?.textContent).toBe(es.cpGanaste);
    expect(leer).toHaveBeenCalledTimes(14);
    // Ganaste sigue consultando cada minuto (puede haber otro premio), pero eso no vuelve a armar la sesión del proveedor.
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await mundo.disparar(60_000);
      await pasar(50);
    }
    expect(leer).toHaveBeenCalledTimes(14);
  });

  it("al llegar a Ganaste sin saber cómo está la cuenta la vuelve a pedir, y después la suelta de nuevo", async () => {
    const soltarSesion = vi.fn();
    const leer = lecturasDe(...Array.from({ length: 13 }, () => lectura("no-se-sabe")), lectura("otro-con-correo"));
    const mundo = await preparar({ sesion: async () => SESION, yo: async () => propio(), cuenta: { leer }, soltarSesion });
    await pasar(60 * 60_000);
    expect(soltarSesion).toHaveBeenCalledTimes(1);
    mundo.deps.yo = async () => ({ ...propio("sorteada"), gano: true });
    await mundo.disparar(15_000);
    await pasar(50);
    expect(leer).toHaveBeenCalledTimes(14);
    expect(soltarSesion).toHaveBeenCalledTimes(2);
  });
});

describe("quien ya está anotada y recarga no retoma la sesión del proveedor", () => {
  it("no pide la sesión ni lee la cuenta: la espera sale con lo que recuerda este navegador", async () => {
    const memoria = almacen();
    recuerdoDe(memoria);
    const sesion = vi.fn(async () => SESION);
    const leer = lecturasDe(lectura("lista"));
    const yo = vi.fn(async () => propio());
    const mundo = await preparar({ memoria, sesion, yo, cuenta: { leer } });
    expect(sesion).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
    expect(yo).toHaveBeenCalled();
    expect(mundo.raiz.querySelector("#cmp-adentro h1")).not.toBeNull();
    await pasar(10 * 60_000);
    expect(sesion).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
  });

  it("lo que se supo de la cuenta antes de recargar se recuerda en la pestaña y no se vuelve a preguntar", async () => {
    const memoria = almacen();
    const primera = await preparar({ memoria, sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("otro-con-correo")) } });
    expect(apoyoDeAdentro(primera.raiz)).toBe(es.cpDejaAbiertaLibre);
    primera.vista.desmontar();
    // La recarga: la pestaña es la misma (sessionStorage), el almacén de la campaña también.
    const leer = lecturasDe(lectura("sin-forma"));
    const sesion = vi.fn(async () => SESION);
    const segunda = await preparar({ memoria, sesion, yo: async () => propio(), cuenta: { leer } });
    expect(sesion).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
    expect(apoyoDeAdentro(segunda.raiz)).toBe(es.cpDejaAbiertaLibre);
  });

  it("lo recordado no se guarda con la cuenta sin saberse ni con el correo entero", async () => {
    const memoria = almacen();
    await preparar({ memoria, sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("naciendo")) } });
    expect(sessionStorage.getItem("tinkazo.cmp.cuenta.evento-ejemplo")).toBeNull();
    sessionStorage.clear();
    // Otra visita, sin recuerdo de la campaña: se retoma la sesión y se lee.
    await preparar({ memoria: almacen(), sesion: async () => SESION, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("falta", { puedeMandar: true, correoTapado: "a•••@ejemplo.com" })) } });
    const guardado = sessionStorage.getItem("tinkazo.cmp.cuenta.evento-ejemplo") ?? "";
    expect(guardado).toContain("falta");
    expect(guardado).not.toMatch(/@ejemplo\.com$/u);
    expect(guardado).not.toContain("token");
  });

  it("al llegar a Ganaste sin saber cómo está la cuenta la lee una vez: es cuando hace falta", async () => {
    const memoria = almacen();
    recuerdoDe(memoria, "sorteada", "gano");
    const leer = lecturasDe(lectura("otro-con-correo"));
    const sesion = vi.fn(async () => SESION);
    await preparar({ memoria, sesion, yo: async () => ({ ...propio("sorteada"), gano: true }), cuenta: { leer } });
    expect(sesion).not.toHaveBeenCalled();
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("al llegar a Ganaste sabiendo cómo está la cuenta, por lo que recordaba, no lee nada", async () => {
    const memoria = almacen();
    recuerdoDe(memoria, "sorteada", "gano");
    sessionStorage.setItem("tinkazo.cmp.cuenta.evento-ejemplo", JSON.stringify({ c: CUENTA, e: "otro-con-correo", p: false, k: false, m: true, t: null }));
    const leer = lecturasDe(lectura("sin-forma"));
    await preparar({ memoria, yo: async () => ({ ...propio("sorteada"), gano: true }), cuenta: { leer } });
    expect(leer).not.toHaveBeenCalled();
  });

  it("con la tarjeta quieta de lo recordado, volver a la pestaña o recuperar la conexión no retoma la sesión", async () => {
    const memoria = almacen();
    recuerdoDe(memoria);
    sessionStorage.setItem("tinkazo.cmp.cuenta.evento-ejemplo", JSON.stringify({ c: CUENTA, e: "falta", p: false, k: false, m: true, t: "a•••@ejemplo.com" }));
    let aviso: (origen?: "canal" | "kit" | "vista") => void = () => undefined;
    const acciones = {
      puedeDesbloqueo: vi.fn(async () => false),
      mandarCodigo: vi.fn(async () => undefined),
      confirmarCodigo: vi.fn(async () => lectura("lista")),
      usarDesbloqueo: vi.fn(async () => true),
      alCambiar: vi.fn((cb: (origen?: "canal" | "kit" | "vista") => void) => {
        aviso = cb;
        return () => undefined;
      }),
    };
    const leer = lecturasDe(lectura("falta", { puedeMandar: true }));
    const mundo = await preparar({ memoria, yo: async () => propio(), cuenta: { leer, confirmar: async () => acciones } });
    await pasar(100);
    expect((mundo.raiz.querySelector("#cmp-cuenta") as HTMLElement).hidden).toBe(false);
    // La primera vuelta a la pestaña después de recargar, y las siguientes: ninguna lee la cuenta.
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      aviso("vista");
      await pasar(90_000);
    }
    expect(leer).not.toHaveBeenCalled();
  });

  it("un recuerdo de otra cuenta o roto no se usa", async () => {
    const memoria = almacen();
    recuerdoDe(memoria);
    for (const crudo of [JSON.stringify({ c: `G${"B".repeat(55)}`, e: "lista" }), JSON.stringify({ c: CUENTA, e: "inventado" }), "{roto"]) {
      sessionStorage.setItem("tinkazo.cmp.cuenta.evento-ejemplo", crudo);
      const mundo = await preparar({ memoria, yo: async () => propio(), cuenta: { leer: lecturasDe(lectura("lista")) } });
      expect(apoyoDeAdentro(mundo.raiz), crudo).toBe(es.cpDejaAbierta);
      mundo.vista.desmontar();
    }
  });

  it("sin almacenamiento en la pestaña la página igual abre", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const memoria = almacen();
    recuerdoDe(memoria);
    const mundo = await preparar({ memoria, yo: async () => propio() });
    expect(mundo.raiz.querySelector("#cmp-adentro h1")).not.toBeNull();
  });

  it("cerrar sesión olvida lo recordado", async () => {
    const mundo = await preparar({ sesion: async () => SESION, cuenta: { leer: lecturasDe(lectura("lista")) } });
    expect(sessionStorage.getItem("tinkazo.cmp.cuenta.evento-ejemplo")).not.toBeNull();
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .cmp-otra-cuenta")?.click();
    await pasar(50);
    expect(sessionStorage.getItem("tinkazo.cmp.cuenta.evento-ejemplo")).toBeNull();
  });
});

describe("cuando el servicio de cuentas frena el ingreso por límite", () => {
  const limite = (segundos: number): Error => Object.assign(new Error("limite"), { segundos });
  const error = (raiz: HTMLElement): HTMLElement => raiz.querySelector("#cmp-saber .cmp-error") as HTMLElement;
  const entrar = (raiz: HTMLElement): HTMLButtonElement => raiz.querySelector("#cmp-saber .primary") as HTMLButtonElement;

  it("dice la verdad con la cuenta que baja y apaga el botón hasta que se libera", async () => {
    const entrarConGoogle = vi.fn(async () => {
      throw limite(10);
    });
    const mundo = await preparar({ entrar: entrarConGoogle });
    entrar(mundo.raiz).click();
    await pasar(10);
    expect(error(mundo.raiz).hidden).toBe(false);
    expect(error(mundo.raiz).textContent).toBe("Hay mucha gente entrando. Probá en 10 segundos.");
    expect(error(mundo.raiz).textContent).not.toContain("crear tu cuenta");
    expect(entrar(mundo.raiz).disabled).toBe(true);
    await pasar(4_000);
    expect(error(mundo.raiz).textContent).toBe("Hay mucha gente entrando. Probá en 6 segundos.");
    expect(entrar(mundo.raiz).disabled).toBe(true);
    await pasar(5_000);
    expect(error(mundo.raiz).textContent).toBe(TEXTOS_LIMITE.es.lmEspera1);
    await pasar(1_000);
    expect(error(mundo.raiz).hidden).toBe(true);
    expect(entrar(mundo.raiz).disabled).toBe(false);
  });

  it("abrir la ventana de Google sigue pidiendo un toque: al liberarse no se abre sola", async () => {
    const entrarConGoogle = vi.fn(async () => {
      throw limite(3);
    });
    const mundo = await preparar({ entrar: entrarConGoogle });
    entrar(mundo.raiz).click();
    await pasar(5_000);
    expect(entrarConGoogle).toHaveBeenCalledTimes(1);
    expect(entrar(mundo.raiz).disabled).toBe(false);
    await pasar(60_000);
    expect(entrarConGoogle).toHaveBeenCalledTimes(1);
  });

  it("la línea se anuncia una sola vez: los números que bajan no se leen cada segundo", async () => {
    const mundo = await preparar({ entrar: async () => {
      throw limite(5);
    } });
    entrar(mundo.raiz).click();
    await pasar(10);
    expect(error(mundo.raiz).getAttribute("role")).toBe("status");
    await pasar(2_000);
    expect(error(mundo.raiz).getAttribute("role")).toBeNull();
  });

  it("si la pantalla se pinta de nuevo con la cuenta regresiva en marcha, sigue donde estaba", async () => {
    const mundo = await preparar({ entrar: async () => {
      throw limite(10);
    } });
    entrar(mundo.raiz).click();
    await pasar(4_000);
    mundo.vista.pintar();
    await asentarTodo();
    expect(error(mundo.raiz).textContent).toBe("Hay mucha gente entrando. Probá en 6 segundos.");
    expect(entrar(mundo.raiz).disabled).toBe(true);
    await pasar(6_000);
    expect(entrar(mundo.raiz).disabled).toBe(false);
  });

  it("sin los segundos usa una espera corta y en inglés dice lo mismo", async () => {
    const mundo = await preparar({ entrar: async () => {
      throw new Error("limite");
    } });
    entrar(mundo.raiz).click();
    await pasar(10);
    expect(error(mundo.raiz).textContent).toBe("Hay mucha gente entrando. Probá en 30 segundos.");
    expect(TEXTOS_LIMITE.en.lmEspera).toBe("Lots of people are signing in. Try again in {n} seconds.");
  });

  it("otras fallas siguen como estaban y no llevan cuenta regresiva", async () => {
    const mundo = await preparar({ entrar: async () => {
      throw new Error("google");
    } });
    entrar(mundo.raiz).click();
    await pasar(10);
    expect(error(mundo.raiz).textContent).toBe(es.cpErrGoogle);
    expect(entrar(mundo.raiz).disabled).toBe(false);
  });

  it("en Hola, si la alta se frena por límite, lo dice con los segundos y el botón sigue a mano", async () => {
    const anotar: DepsDelCelular["anotar"] = vi.fn(async () => ({ ok: false as const, motivo: "limite" as const, segundos: 20 }));
    const mundo = await preparar({ sesion: async () => SESION, anotar });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await pasar(50);
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-error")?.textContent).toBe("Hay mucha gente entrando. Probá en 20 segundos.");
    expect(mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.disabled).toBe(false);
  });

  it("pasado el límite, la línea de Hola se va sola al pintar de nuevo", async () => {
    const anotar: DepsDelCelular["anotar"] = vi.fn(async () => ({ ok: false as const, motivo: "limite" as const, segundos: 5 }));
    const mundo = await preparar({ sesion: async () => SESION, anotar });
    mundo.raiz.querySelector<HTMLButtonElement>("#cmp-hola .primary")?.click();
    await pasar(50);
    await pasar(6_000);
    mundo.vista.pintar();
    expect(mundo.raiz.querySelector("#cmp-hola .cmp-error")).toBeNull();
  });
});
