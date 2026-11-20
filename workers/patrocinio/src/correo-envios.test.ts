/**
 * El correo de bienvenida desde la alarma, sin red ni reloj real: regalos de verdad (`/v1/alta/gratis` con el Pollar de
 * mentira, que también hace de ficha de la persona), un mensajero de mentira que anota lo que recibe y el reloj de la prueba.
 * Lo que se mira: cuándo sale, que salga una sola vez, los frenos (cuota, tope, viejos, cerrado) y que la dirección no quede
 * en ningún lado.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { T0, montarAltas } from "./altas-prueba";
import { AJUSTE_CORREO_CERRADO, AJUSTE_CORREO_DIA, AJUSTE_CORREO_HASTA } from "./config";
import type { ContenidoDelCorreo, Mensajero, ResultadoDelEnvio } from "./correo-bienvenida";
import {
  CUOTA_AGOTADA,
  ESPERA_CORREO_MS,
  EnviosDeBienvenida,
  POR_VUELTA,
  PRESUPUESTO_VUELTA_MS,
  REINTENTOS_FICHA,
  TOPE_PERSONA_MS,
  VOLVER_PRONTO_MS,
} from "./correo-envios";
import type { Pollar } from "./pollar";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
/** Un minuto después de la medianoche UTC del día siguiente a T0. */
const MANANA = Date.UTC(2026, 10, 15, 0, 1, 0);

/** Inventada: la dirección de la ficha de cada persona de la prueba. */
const correoDe = (usuario: string) => `${usuario}@correo.test`;

function montar(o: { responder?: (para: string) => Promise<ResultadoDelEnvio>; antesDeMandar?: () => void } = {}) {
  const m = montarAltas();
  const mandados: Array<{ para: string } & ContenidoDelCorreo> = [];
  const mensajero: Mensajero = {
    async mandar(para, contenido) {
      mandados.push({ para, ...contenido });
      o.antesDeMandar?.();
      return o.responder ? o.responder(para) : { ok: true };
    },
  };
  const envios = new EnviosDeBienvenida({
    cupos: m.cupos,
    altas: m.altas,
    ficha: (usuario) => (m.pollar as Pollar).fichaParaCorreo(usuario),
    mensajero,
    reloj: () => m.hora(),
    registrar: (e, d) => void m.anotado.push([e, d]),
  });
  // Como en el objeto: la marca arranca al prenderse, antes de cualquier regalo de la prueba.
  envios.arrancar();
  /** Una persona que entra, con su ficha, y recibe su regalo. */
  const regalo = async (usuario: string, ficha: Record<string, unknown> = {}) => {
    const p = m.persona(usuario);
    m.pm.fichas.set(usuario, { email: correoDe(usuario), first_name: "Quinua", ...ficha });
    const r = await m.gratis(p.token);
    expect(r.cuerpo.regalo).toBe("dado");
    return p;
  };
  const marca = () => m.cupos.ajuste(AJUSTE_CORREO_HASTA);
  return { m, envios, mandados, regalo, marca };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cuándo sale", () => {
  it("a los 19 minutos del regalo no sale y la vuelta dice cuándo toca, a los 21 sale", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.mover(19 * MINUTO);
    expect(await t.envios.vuelta()).toBe(T0 + ESPERA_CORREO_MS);
    expect(t.mandados).toHaveLength(0);
    t.m.mover(2 * MINUTO);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_uno")]);
  });

  it("lleva los sorteos y el vencimiento del regalo, a la dirección de la ficha, en los dos idiomas si la ficha no dice", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    const [c] = t.mandados;
    expect(c?.para).toBe(correoDe("usr_uno"));
    expect(c?.asunto).toBe("Tu cuenta oficial de Tinkazo está lista / Your Tinkazo Live account is ready");
    expect(c?.texto).toContain("Hola Quinua.");
    // T0 + 60 días: el 13 de enero de 2027.
    expect(c?.texto).toContain("Tenés 3 sorteos gratis hasta el 13 de enero de 2027.");
    expect(c?.texto).toContain("You have 3 free draws until January 13, 2027.");
  });

  it("con el idioma de la ficha, en ese idioma solo", async () => {
    const t = montar();
    await t.regalo("usr_uno", { language: "en-US" });
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    expect(t.mandados[0]?.asunto).toBe("Your Tinkazo Live account is ready");
    expect(t.mandados[0]?.texto).not.toContain("Hola");
  });

  it("quien recibió el regalo antes de prenderse el correo no lo recibe después", async () => {
    const m = montarAltas();
    const p = m.persona("usr_antes");
    m.pm.fichas.set("usr_antes", { email: correoDe("usr_antes") });
    await m.gratis(p.token);
    const mandar = vi.fn(async (): Promise<ResultadoDelEnvio> => ({ ok: true }));
    const ficha = (u: string) => (m.pollar as Pollar).datosParaCorreo(u);
    const reloj = () => m.hora();
    const envios = new EnviosDeBienvenida({ cupos: m.cupos, altas: m.altas, ficha, mensajero: { mandar }, reloj, registrar: () => {} });
    envios.arrancar();
    m.mover(21 * MINUTO);
    expect(await envios.vuelta()).toBeNull();
    expect(mandar).not.toHaveBeenCalled();
  });
});

describe("una sola vez por persona", () => {
  it("dos regalos dan dos correos, uno cada uno, aunque la alarma corra dos veces", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    await t.regalo("usr_dos");
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    await t.envios.vuelta();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_uno"), correoDe("usr_dos")]);
  });

  it("dos vueltas a la vez esperan la misma: nadie recibe dos correos", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.mover(21 * MINUTO);
    await Promise.all([t.envios.vuelta(), t.envios.vuelta()]);
    expect(t.mandados).toHaveLength(1);
  });

  it("recibir el regalo otra vez (ya) no suma otro correo", async () => {
    const t = montar();
    const p = await t.regalo("usr_uno");
    expect((await t.m.gratis(p.token)).cuerpo.regalo).toBe("ya");
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    expect(t.mandados).toHaveLength(1);
  });

  it("la marca avanza antes de mandar: con el envío en curso ya dice que esa persona se intentó", async () => {
    let marcaAlMandar: string | undefined;
    const t = montar({ antesDeMandar: () => void (marcaAlMandar = t.marca()) });
    await t.regalo("usr_uno");
    const antes = t.marca();
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    expect(marcaAlMandar).not.toBe(antes);
    expect(marcaAlMandar).toBe(t.marca());
  });
});

describe("los frenos", () => {
  it("la cuota de Cloudflare frena hasta el otro día sin mover la marca, y al otro día sale", async () => {
    let sinCuota = true;
    const t = montar({ responder: async () => (sinCuota ? { ok: false, codigo: CUOTA_AGOTADA } : { ok: true }) });
    await t.regalo("usr_uno");
    await t.regalo("usr_dos");
    const marca = t.marca();
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBe(MANANA);
    expect(t.marca()).toBe(marca);
    // El mismo día ya no se intenta a nadie más.
    t.m.mover(HORA);
    expect(await t.envios.vuelta()).toBe(MANANA);
    expect(t.mandados).toHaveLength(1);
    sinCuota = false;
    t.m.mover(MANANA - t.m.hora());
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_uno"), correoDe("usr_uno"), correoDe("usr_dos")]);
    expect(t.envios.resumen()).toMatchObject({ enviados: 2, frenosPorCuota: 2 });
  });

  it("pasado el tope del día, el resto sale al día siguiente", async () => {
    const t = montar();
    t.m.cupos.fijarAjuste(AJUSTE_CORREO_DIA, "1", T0);
    await t.regalo("usr_uno");
    await t.regalo("usr_dos");
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBe(MANANA);
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_uno")]);
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "tope" }]);
    t.m.mover(MANANA - t.m.hora());
    await t.envios.vuelta();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_uno"), correoDe("usr_dos")]);
  });

  it("el tope cuenta correos intentados, no regalos: sin dirección en la ficha no gasta el tope", async () => {
    const t = montar();
    t.m.cupos.fijarAjuste(AJUSTE_CORREO_DIA, "1", T0);
    await t.regalo("usr_uno", { email: "no es un correo" });
    await t.regalo("usr_dos");
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_dos")]);
    expect(t.envios.resumen()).toMatchObject({ enviados: 1, sinFicha: 1, hoy: { intentados: 1 } });
  });

  it("un regalo de más de 48 horas se saltea y se cuenta", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.mover(49 * HORA);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados).toHaveLength(0);
    expect(t.envios.resumen()).toMatchObject({ viejos: 1, enviados: 0 });
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "viejo" }]);
  });

  it("cerrado en caliente no llama a nadie y la marca no se mueve, y al reabrirlo sale", async () => {
    const t = montar();
    t.m.cupos.fijarAjuste(AJUSTE_CORREO_CERRADO, "1", T0);
    await t.regalo("usr_uno");
    const marca = t.marca();
    const llamadas = t.m.pm.llamadas.length;
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados).toHaveLength(0);
    expect(t.m.pm.llamadas).toHaveLength(llamadas);
    expect(t.marca()).toBe(marca);
    t.m.cupos.fijarAjuste(AJUSTE_CORREO_CERRADO, "0", t.m.hora());
    await t.envios.vuelta();
    expect(t.mandados).toHaveLength(1);
  });

  it("de a cinco por vuelta: con más, vuelve enseguida por el resto", async () => {
    const t = montar();
    for (let i = 0; i < POR_VUELTA + 2; i++) await t.regalo(`usr_${i}`);
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBe(t.m.hora() + VOLVER_PRONTO_MS);
    expect(t.mandados).toHaveLength(POR_VUELTA);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados).toHaveLength(POR_VUELTA + 2);
  });

  it("con sellos o pagos en el aire, una sola persona por vuelta", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    await t.regalo("usr_dos");
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta({ conAlgoEnElAire: true })).toBe(t.m.hora() + VOLVER_PRONTO_MS);
    expect(t.mandados).toHaveLength(1);
  });

  it("pasado el presupuesto de la vuelta no empieza otra persona", async () => {
    const t = montar({ antesDeMandar: () => void t.m.mover(PRESUPUESTO_VUELTA_MS) });
    await t.regalo("usr_uno");
    await t.regalo("usr_dos");
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBe(t.m.hora() + VOLVER_PRONTO_MS);
    expect(t.mandados).toHaveLength(1);
  });

  it("un envío que nunca termina se deja a su tope y la vuelta termina, sin volver a intentarlo", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = montar({ responder: () => new Promise<ResultadoDelEnvio>(() => {}) });
    await t.regalo("usr_uno");
    t.m.mover(21 * MINUTO);
    const vuelta = t.envios.vuelta();
    await vi.advanceTimersByTimeAsync(TOPE_PERSONA_MS);
    expect(await vuelta).toBeNull();
    expect(t.envios.resumen()).toMatchObject({ errores: 1 });
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "tiempo" }]);
    await t.envios.vuelta();
    expect(t.mandados).toHaveLength(1);
  });
});

describe("lo que falla no se reintenta", () => {
  it("sin dirección en la ficha no manda, no reintenta y sigue con la persona siguiente", async () => {
    const t = montar();
    await t.regalo("usr_uno", { email: "uno,dos@correo.test" });
    await t.regalo("usr_dos");
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    await t.envios.vuelta();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_dos")]);
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "sin-correo" }]);
  });

  it("con la ficha caída del todo no manda: a la sexta falla seguida se saltea y no se vuelve a mirar", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.pm.usersCaido = true;
    t.m.mover(21 * MINUTO);
    for (let i = 1; i < REINTENTOS_FICHA; i++) {
      const proxima = await t.envios.vuelta();
      expect(proxima, String(i)).toBe(t.m.hora() + VOLVER_PRONTO_MS * 2 ** (i - 1));
      t.m.mover((proxima as number) - t.m.hora());
    }
    expect(await t.envios.vuelta()).toBeNull();
    t.m.pm.usersCaido = false;
    await t.envios.vuelta();
    expect(t.mandados).toHaveLength(0);
    expect(t.envios.resumen()).toMatchObject({ sinFicha: 1, hoy: { intentados: 0 } });
  });

  it("un error de envío que no es la cuota queda anotado con su código y no se reintenta", async () => {
    const t = montar({ responder: async () => ({ ok: false, codigo: "E_SENDER_DOMAIN_NOT_AVAILABLE" }) });
    await t.regalo("usr_uno");
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    await t.envios.vuelta();
    expect(t.mandados).toHaveLength(1);
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "E_SENDER_DOMAIN_NOT_AVAILABLE" }]);
    expect(t.envios.resumen()).toMatchObject({ errores: 1, enviados: 0 });
  });
});

describe("una ficha caída un rato no le quita el correo a nadie", () => {
  /** Cuántas veces se buscó una ficha en Pollar. */
  const fichasPedidas = (t: ReturnType<typeof montar>) => t.m.pm.llamadas.filter((x) => x === "/v3/users").length;

  it("con la ficha caída no manda, no gasta el tope y la marca no se mueve: cuando vuelve, sale", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    const marca = t.marca();
    t.m.pm.usersCaido = true;
    t.m.mover(21 * MINUTO);
    expect(await t.envios.vuelta()).toBe(t.m.hora() + VOLVER_PRONTO_MS);
    expect(t.marca()).toBe(marca);
    expect(t.mandados).toHaveLength(0);
    expect(t.envios.resumen()).toMatchObject({ sinFicha: 0, errores: 0, hoy: { intentados: 0 } });
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "estado" }]);
    t.m.pm.usersCaido = false;
    t.m.mover(VOLVER_PRONTO_MS);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_uno")]);
    expect(t.envios.resumen()).toMatchObject({ enviados: 1, sinFicha: 0 });
  });

  it("antes de su hora no se vuelve a mirar, aunque la alarma corra antes por los sellos", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.pm.usersCaido = true;
    t.m.mover(21 * MINUTO);
    const proxima = await t.envios.vuelta();
    const pedidas = fichasPedidas(t);
    t.m.mover(VOLVER_PRONTO_MS - 1);
    expect(await t.envios.vuelta()).toBe(proxima);
    expect(fichasPedidas(t)).toBe(pedidas);
  });

  it("la persona salteada no traba la cola: la siguiente sale cuando la ficha vuelve", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    await t.regalo("usr_dos");
    t.m.pm.usersCaido = true;
    t.m.mover(21 * MINUTO);
    for (let i = 1; i < REINTENTOS_FICHA; i++) t.m.mover(((await t.envios.vuelta()) as number) - t.m.hora());
    // La sexta falla de la primera la saltea, y la segunda empieza su propia cuenta.
    expect(await t.envios.vuelta()).toBe(t.m.hora() + VOLVER_PRONTO_MS);
    t.m.pm.usersCaido = false;
    t.m.mover(VOLVER_PRONTO_MS);
    expect(await t.envios.vuelta()).toBeNull();
    expect(t.mandados.map((x) => x.para)).toEqual([correoDe("usr_dos")]);
    expect(t.envios.resumen()).toMatchObject({ enviados: 1, sinFicha: 1 });
  });
});

describe("la dirección no queda en ningún lado", () => {
  it("después de mandar, ni las tablas ni el registro tienen la dirección, el nombre ni el id de la persona", async () => {
    const t = montar();
    await t.regalo("usr_uno", { first_name: "Quinua" });
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    expect(t.mandados).toHaveLength(1);
    const tablas = JSON.stringify(t.m.cupos.exportar(true));
    expect(tablas).not.toContain(correoDe("usr_uno"));
    expect(tablas).not.toContain("Quinua");
    const registro = JSON.stringify(t.m.anotado);
    expect(registro).not.toContain(correoDe("usr_uno"));
    expect(registro).not.toContain("Quinua");
    expect(registro).not.toContain("usr_uno");
    expect(t.m.anotado).toContainEqual(["correo-bienvenida", { codigo: "enviado" }]);
    expect(JSON.stringify(t.envios.resumen())).not.toContain("usr_uno");
  });

  it("los ajustes del correo son solo cifras: la marca, el tope y lo de hoy", async () => {
    const t = montar();
    await t.regalo("usr_uno");
    t.m.mover(21 * MINUTO);
    await t.envios.vuelta();
    const ajustes = t.m.sql.exec("SELECT clave, valor FROM ajustes WHERE clave LIKE 'correo_%' ORDER BY clave").toArray();
    expect(ajustes).toEqual([
      { clave: "correo_bienvenida_hasta", valor: expect.stringMatching(/^\d+$/) },
      { clave: "correo_bienvenida_hoy", valor: JSON.stringify({ dia: "2026-11-14", intentados: 1, cuota: false }) },
    ]);
  });
});

describe("el aviso de la puerta al dar el regalo", () => {
  /** Una puerta que anota cada aviso, sin objeto ni alarma. */
  const conAviso = () => {
    const avisos: number[] = [];
    const m = montarAltas({}, { alRegalar: () => void avisos.push(m.hora()) });
    return { m, avisos };
  };

  it("con el regalo dado avisa una vez, y el repetido ya no avisa", async () => {
    const { m, avisos } = conAviso();
    const p = m.persona("usr_uno");
    expect((await m.gratis(p.token)).cuerpo.regalo).toBe("dado");
    expect((await m.gratis(p.token)).cuerpo.regalo).toBe("ya");
    expect(avisos).toEqual([T0]);
  });

  it("con el regalo lleno (cerrado en caliente) no avisa", async () => {
    const { m, avisos } = conAviso();
    m.cupos.fijarAjuste("bienvenida_cerrada", "1", T0);
    expect((await m.gratis(m.persona("usr_uno").token)).cuerpo.regalo).toBe("lleno");
    expect(avisos).toEqual([]);
  });

  it("con 403, 409 o 503 no avisa", async () => {
    const { m, avisos } = conAviso();
    m.pm.sesiones.set("tok_otraapp_xxxxxxxxxxxxxxxxxxxxxxxx", { usuario: "usr_otra", app: "app_de_otro" });
    expect((await m.gratis("tok_otraapp_xxxxxxxxxxxxxxxxxxxxxxxx")).estado).toBe(403);
    const uno = m.persona("usr_uno");
    await m.gratis(uno.token);
    const dos = m.persona("usr_dos", uno.cuenta);
    expect((await m.gratis(dos.token)).estado).toBe(409);
    m.cupos.fijarAjuste("altas_pausadas", "1", T0);
    expect((await m.gratis(m.persona("usr_tres").token)).estado).toBe(503);
    expect(avisos).toEqual([T0]);
  });

  it("un aviso que lanza no cambia la respuesta y queda anotado sin la persona", async () => {
    const sinAviso = montarAltas();
    const lanza = () => {
      throw new TypeError("sin alarma");
    };
    const conFalla = montarAltas({}, { alRegalar: lanza });
    const a = sinAviso.persona("usr_uno");
    const b = conFalla.persona("usr_uno", a.cuenta);
    expect(await conFalla.gratis(b.token)).toEqual(await sinAviso.gratis(a.token));
    expect(conFalla.anotado).toContainEqual(["error-interno", { donde: "al-regalar", error: "TypeError" }]);
  });
});

describe("el estado", () => {
  it("resume si está cerrado, el tope del día y los conteos, sin nada de las personas", async () => {
    const t = montar();
    expect(t.envios.resumen()).toEqual({
      prendido: true,
      cerrado: false,
      topeDia: 25,
      hoy: { intentados: 0, cuotaAgotada: false },
      enviados: 0,
      sinFicha: 0,
      errores: 0,
      viejos: 0,
      frenosPorTope: 0,
      frenosPorCuota: 0,
    });
    t.m.cupos.fijarAjuste(AJUSTE_CORREO_DIA, "5000", T0);
    expect(t.envios.resumen()).toMatchObject({ topeDia: 25 });
    t.m.cupos.fijarAjuste(AJUSTE_CORREO_DIA, "40", T0);
    expect(t.envios.resumen()).toMatchObject({ topeDia: 40 });
  });
});
