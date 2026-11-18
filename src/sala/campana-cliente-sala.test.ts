import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cifrarEquipo } from "../equipos/datos";
import {
  TOPE_ALTA_MS,
  TOPE_PEDIDO_MS,
  anotarmeEnCampana,
  estadoPublico,
  miEstado,
  resultadoDeCampana,
  type CuerpoDeAlta,
  type DependenciasDeCampana,
  type SosiegoDelAlta,
} from "./campana";
import { generarClave } from "./cifra";
import { BASE_LOCAL, campanaAbierta, montarMundo, personaDePrueba, type MundoDeSala, type SalaDeCampana } from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/**
 * El cliente del celular contra el servicio de la sala entero, en Node: una diferencia entre lo que el cliente espera y lo
 * que el servicio contesta rompe una prueba acá y no el día del evento.
 */
const AHORA = Date.UTC(2026, 10, 21, 15, 0, 0);

let mundo: MundoDeSala;
let sala: SalaDeCampana;
let clave: string;
let pedidos: { metodo: string; tipo: string | null }[];

/** El `fetch` del navegador, llevado al servicio: arma el pedido con origen, largo y tipo como lo haría el navegador. */
function fetchDelServicio(): typeof fetch {
  return async (url, init) => {
    const u = new URL(String(url));
    const cuerpo = typeof init?.body === "string" ? init.body : undefined;
    const respuesta = await mundo.pedir(`${u.pathname}${u.search}`, {
      metodo: init?.method ?? "GET",
      ...(cuerpo === undefined ? {} : { cuerpo: JSON.parse(cuerpo) as unknown }),
      cabeceras: { "CF-Connecting-IP": "190.129.10.20" },
      base: u.origin,
    });
    pedidos.push({ metodo: init?.method ?? "GET", tipo: new Headers(init?.headers).get("Content-Type") });
    return respuesta;
  };
}

async function montar(extra: Record<string, string> = {}): Promise<void> {
  mundo = await montarMundo(extra);
  sala = await campanaAbierta(mundo, AHORA);
  clave = generarClave();
  pedidos = [];
}

async function cuerpoDe(token: string, llave: string, p: string | null = null): Promise<CuerpoDeAlta> {
  return { token, d: await cifrarEquipo(clave, { nombre: "Ana", integrantes: [] }), llave, p };
}

const dep = (): { fetch: typeof fetch; azar: () => number } => ({ fetch: fetchDelServicio(), azar: () => 0.5 });

/**
 * Lo mismo, pero las esperas entre reintentos pasan al instante: los topes de cada pedido nunca vencen y las esperas se
 * cumplen sin reloj. El reloj de las fechas sí sigue siendo el falso de la prueba.
 */
const sinEsperas = (): DependenciasDeCampana => ({
  fetch: fetchDelServicio(),
  azar: () => 0.5,
  setTimeout: ((f: () => void, ms?: number) => {
    if (ms !== TOPE_ALTA_MS && ms !== TOPE_PEDIDO_MS) queueMicrotask(f);
    return 0;
  }) as unknown as typeof setTimeout,
  clearTimeout: (() => undefined) as typeof clearTimeout,
});

/** Corre una alta con el reloj de verdad de los timers apagado: ninguna de estas respuestas necesita esperar. */
const anotar = (cuerpo: CuerpoDeAlta) => anotarmeEnCampana(BASE_LOCAL, sala.id, cuerpo, dep());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("el cliente contra el servicio de verdad", () => {
  it("un alta nueva da ok y la segunda con la misma sesión da ya", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 1);
    const primera = await anotar(await cuerpoDe(persona.token, persona.llave));
    expect(primera).toEqual({ ok: true, cuenta: persona.cuenta, ya: false });
    const segunda = await anotar(await cuerpoDe(persona.token, persona.llave));
    expect(segunda).toEqual({ ok: true, cuenta: persona.cuenta, ya: true });
  });

  it("el alta viaja sin cabecera de tipo y el servicio la acepta igual", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 1);
    await anotar(await cuerpoDe(persona.token, persona.llave));
    expect(pedidos).toEqual([{ metodo: "POST", tipo: null }]);
  });

  it("una sesión de correo da solo-google", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 2, { authProvider: "email" });
    expect(await anotar(await cuerpoDe(persona.token, persona.llave))).toEqual({ ok: false, motivo: "solo-google" });
  });

  it("una sesión que el proveedor no conoce da sesion", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 3);
    mundo.proveedor.sesiones.delete(persona.token);
    expect(await anotar(await cuerpoDe(persona.token, persona.llave))).toEqual({ ok: false, motivo: "sesion" });
  });

  it("una sesión de la red de prueba da otro y no sesion, porque entrar de nuevo no lo arregla", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 4, { network: "testnet" });
    expect(await anotar(await cuerpoDe(persona.token, persona.llave))).toEqual({ ok: false, motivo: "otro" });
  });

  it("con el pase exigido y sin p el alta da pase", async () => {
    await montar({ PASE: "1" });
    const persona = personaDePrueba(mundo, 5);
    expect(await anotar(await cuerpoDe(persona.token, persona.llave))).toEqual({ ok: false, motivo: "pase" });
  });

  it("con el pase exigido y el pase de la sala el alta entra", async () => {
    await montar({ PASE: "1" });
    const vigente = (await (await mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, {
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    })).json()) as { p: string };
    const persona = personaDePrueba(mundo, 6);
    expect(await anotar(await cuerpoDe(persona.token, persona.llave, vigente.p))).toMatchObject({ ok: true, ya: false });
  });

  it("una sesión sin cuenta lista gasta tres de los cinco rechazos de la ficha en un toque y dice cuentas, nunca wifi", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 8, { wallet: null });
    mundo.proveedor.billeteras.set(persona.usuario, null);
    const sosiego: SosiegoDelAlta = { finalDeFamiliaEn: null };
    const cuerpo = await cuerpoDe(persona.token, persona.llave);
    const toque = () => anotarmeEnCampana(BASE_LOCAL, sala.id, cuerpo, sinEsperas(), () => undefined, { sosiego });
    expect(await toque()).toEqual({ ok: false, motivo: "cuentas" });
    expect(mundo.proveedor.llamadas["/v3/users"]).toBe(3);
    // El segundo toque, dentro del sosiego, hace un solo pedido y llega a cuatro.
    expect(await toque()).toEqual({ ok: false, motivo: "cuentas" });
    expect(mundo.proveedor.llamadas["/v3/users"]).toBe(4);
    // El tercero, pasado el sosiego, gasta el quinto y recibe el tope de la ficha: sigue siendo la cuenta que no se creó.
    vi.setSystemTime(AHORA + 61_000);
    expect(await toque()).toEqual({ ok: false, motivo: "cuentas", porRechazos: true });
    expect(mundo.proveedor.llamadas["/v3/users"]).toBe(5);
  });

  it("el tope de intentos de la ficha, sin nada antes, se dice como espera y no como wifi", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 9, { wallet: null });
    mundo.proveedor.billeteras.set(persona.usuario, null);
    const cuerpo = await cuerpoDe(persona.token, persona.llave);
    // Con el sosiego puesto cada toque hace un solo pedido: cinco toques son los cinco rechazos que deja la sala.
    const sosegada = (): { sosiego: SosiegoDelAlta } => ({ sosiego: { finalDeFamiliaEn: AHORA } });
    for (let i = 0; i < 5; i += 1) {
      await anotarmeEnCampana(BASE_LOCAL, sala.id, cuerpo, sinEsperas(), () => undefined, sosegada());
    }
    const sexto = await anotarmeEnCampana(BASE_LOCAL, sala.id, cuerpo, sinEsperas(), () => undefined, sosegada());
    expect(sexto).toEqual({ ok: false, motivo: "espera", porRechazos: true });
  });

  it("estadoPublico acepta lo que contesta el servicio, con y sin pase", async () => {
    await montar({ PASE: "1" });
    const vigente = (await (await mundo.pedir(`/v1/sala/${sala.id}/campana/pase`, {
      cabeceras: { Authorization: `Bearer ${sala.token}` },
    })).json()) as { p: string };
    const conPase = await estadoPublico(BASE_LOCAL, sala.id, vigente.p, dep());
    expect(conPase).toMatchObject({ fase: "abierta", total: 0, pase: "vale" });
    expect(await estadoPublico(BASE_LOCAL, sala.id, "AAAAAAAAAAAA", dep())).toMatchObject({ pase: "vencido" });
    expect(await estadoPublico(BASE_LOCAL, sala.id, null, dep())).toMatchObject({ fase: "abierta", total: 0 });
  });

  it("estadoPublico de una sala que no existe da terminada", async () => {
    await montar();
    expect(await estadoPublico(BASE_LOCAL, "ZZZZZZZZ", null, dep())).toBe("terminada");
  });

  it("miEstado con la llave correcta dice anotada y con otra no", async () => {
    await montar();
    const persona = personaDePrueba(mundo, 7);
    await anotar(await cuerpoDe(persona.token, persona.llave));
    expect(await miEstado(BASE_LOCAL, sala.id, persona.cuenta, persona.llave, dep())).toMatchObject({ fase: "abierta", total: 1, anotada: true });
    expect(await miEstado(BASE_LOCAL, sala.id, persona.cuenta, "otra".padEnd(22, "y"), dep())).toMatchObject({ anotada: false });
  });

  it("resultadoDeCampana antes del sorteo da null", async () => {
    await montar();
    expect(await resultadoDeCampana(BASE_LOCAL, sala.id, dep())).toBeNull();
  });

  it("una sala que no es de campaña o no existe contesta algo que el cliente entiende como terminada", async () => {
    await montar();
    expect(await resultadoDeCampana(BASE_LOCAL, "ZZZZZZZZ", dep())).toBe("terminada");
  });

  it.todo("con PASE en 0 y un p viejo, estadoPublico no da vencido (necesita que la ruta estado mire la variable PASE)");
  it.todo("con PASE prendido y sin p, estadoPublico da vencido y no sin (necesita el mismo cambio en la ruta estado)");
});
