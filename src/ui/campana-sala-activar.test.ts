// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Activar una campaña desde un borrador sin firma: el panel cobra, y con el cobro pagado le pide a la sala que firme, crea la
 * sala y abre la inscripción, sin que nadie firme a mano. Con el mundo de mentira de siempre y la sala, el cobro y la sesión
 * también de mentira. Sin red y sin reloj real. Los textos que se comparan están escritos a mano: son lo que lee la persona.
 */

vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CLAVE_DEL_BORRADOR } from "../campana/borrador";
import { CENTAVO } from "../campana/comision";
import type { LecturaDeComision } from "../campana/comision-red";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { type MotivoDeActivar, type ResultadoDeActivar, guardarOrg } from "../sala/campana-org";
import type { ConfigDeComision } from "../stellar/comision-config";
import type { DepsDeComision, PedidoDePagoDeComision, ResultadoDelPagoDeComision } from "./campana-comision";
import {
  $,
  AHORA,
  SALA,
  type Mundo,
  type Panel,
  boton,
  botones,
  campanaDeArchivo,
  cerrarTodos,
  elegirArchivo,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  texto,
  vistaDe,
} from "./campana-sala-mundo";
import { cabeAbrirYa } from "./campana-sala";

const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const ORIGEN = cuentaDePrueba(5);
const CONFIG: ConfigDeComision = { pb: 200n, minimo: d(1.5), cuenta: cuentaDePrueba(2), costo: d(0.5), cobros: cuentaDePrueba(1) };
const FIRMA = "F".repeat(86);

/** Una campaña de 120 sin firma y sin nadie anotada: lo que deja crear-campana.html. */
const borradorDe = (cambios: Record<string, unknown> = {}): string =>
  JSON.stringify(campanaDeArchivo({ premios: ["1200000000"], anotadas: 0, ...cambios }));

interface Mundillo {
  m: Mundo;
  /** Lo que se hizo, en orden: pagar, activar, entrar. */
  hecho: string[];
  pedidos: PedidoDePagoDeComision[];
  activaciones: { texto: string; sesion: string }[];
  cargas: string[];
  alCerrarLaCarga: (() => void) | null;
  /** Lo que contesta la sala a activar, en orden. Sin nada, firma. */
  respuestas: ResultadoDeActivar[];
  /** Si no es null, activar espera a que la prueba lo suelte. */
  espera: Promise<void> | null;
  irA: string[];
  red: LecturaDeComision;
  saldo: bigint;
  resultado: ResultadoDelPagoDeComision;
  sesion: string | null;
}

/** El mundo con la cuenta de Google entrada, el cobro y la activación de mentira. */
function armar(cambios: Partial<Pick<Mundillo, "red" | "saldo" | "sesion" | "resultado">> = {}): Mundillo {
  const m = mundo();
  m.cuenta = ORIGEN;
  m.deps.cambiarDeCuenta = () => void m.cuenta;
  const x: Mundillo = {
    m,
    hecho: [],
    pedidos: [],
    activaciones: [],
    cargas: [],
    alCerrarLaCarga: null,
    respuestas: [],
    espera: null,
    irA: [],
    red: { tipo: "no-pagada", suma: 0n },
    saldo: d(150),
    resultado: { tipo: "listo", hash: "a".repeat(64) },
    sesion: "token-de-prueba",
    ...cambios,
  };
  const deps: DepsDeComision = {
    comision: () => CONFIG,
    billetera: async () => "google",
    mirarRed: async () => x.red,
    saldo: async () => x.saldo,
    portero: async () => "atiende",
    pagar: async (p) => {
      x.hecho.push("pagar");
      x.pedidos.push(p);
      p.alMandar("1001", "b".repeat(64));
      x.red = { tipo: "pagada", suma: p.sale };
      return x.resultado;
    },
    confirmar: async () => null,
    puedeVolverALista: async () => true,
    cargar: (cuenta, alCerrar) => {
      x.cargas.push(cuenta);
      x.alCerrarLaCarga = alCerrar;
    },
    candado: (_nombre, f) => f(),
  };
  m.deps.comision = deps;
  m.deps.sesion = async () => x.sesion;
  m.deps.activar = async (p) => {
    x.hecho.push("activar");
    x.activaciones.push(p);
    if (x.espera) await x.espera;
    const dada = x.respuestas.shift();
    if (dada) return dada;
    const datos = JSON.parse(p.texto) as { evento: string; organizadora: string };
    return { ok: true, archivo: { texto: p.texto, firma: FIRMA }, evento: datos.evento, organizadora: datos.organizadora };
  };
  m.deps.ir = (direccion) => void x.irA.push(direccion);
  return x;
}

const falla = (motivo: MotivoDeActivar, campo?: string): ResultadoDeActivar => (campo === undefined ? { ok: false, motivo } : { ok: false, motivo, campo });
const botonesDe = (p: Panel): string[] => botones(p).map((b) => (b.textContent ?? "").trim());
const guardado = (m: Mundo): string | null => m.almacen.getItem(CLAVE_DEL_BORRADOR);

/** Elige el borrador como se elige un archivo. */
async function eligiendo(x: Mundillo, p: Panel, contenido = borradorDe()): Promise<void> {
  await elegirArchivo(x.m, p, contenido);
  await suelta(8);
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cerrarTodos();
  vi.restoreAllMocks();
});

describe("un borrador sin firma", () => {
  it("se elige como un archivo, no crea ninguna sala y pide cargar lo que falta", async () => {
    const x = armar({ saldo: 0n });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(vistaDe(p)).toBe("previa");
    expect(texto(p, "#cpo-h")).toBe("Cargá 122,40 dólares digitales");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cargar dólares digitales"]);
    expect(x.m.creadas).toEqual([]);
    expect(x.activaciones).toEqual([]);
  });

  it("escribe el premio con dos decimales, igual que todos los demás montos de plata del panel", async () => {
    const x = armar({ saldo: 0n });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Cargá 122,40 dólares digitales");
    expect(texto(p, "#cpo-premio")).toBe("120,00 dólares digitales");
  });

  it("no ofrece pagar desde otra billetera: el pago tiene que salir de la cuenta de Google", async () => {
    const x = armar({ saldo: 0n });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
  });

  it("sin cuenta entrada dice que entre con Google y no muestra el pago a mano", async () => {
    const x = armar();
    x.m.cuenta = null;
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    // Sin sesión el título nombra la campaña y la línea dice lo que sigue y lo que cuesta.
    expect(texto(p, "#cpo-h")).toBe("La campaña de Alcancía Andina está lista");
    expect(texto(p, "#cpo-linea")).toBe("Entrá con Google y poné 122,40 dólares digitales: 120,00 de premio y 2,40 del servicio.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
    expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
  });

  it("con una cuenta que entró con correo dice que hace falta Google y nunca ofrece cargar ni pagar", async () => {
    for (const saldo of [0n, d(150)]) {
      const x = armar({ saldo });
      x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), billetera: async () => "correo" };
      document.body.innerHTML = "";
      const p = nuevoPanel(x.m);
      await eligiendo(x, p);
      expect(texto(p, "#cpo-h")).toBe("Hace falta una cuenta de Google");
      expect(texto(p, "#cpo-linea")).toBe("Entrá con Google para activar tu campaña.");
      expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
      expect(botonesDe(p).join("|")).not.toMatch(/Pagar|Cargar/);
      expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
      expect(x.hecho).toEqual([]);
      cerrarTodos();
    }
  });

  it("con una cuenta de correo, Entrar con Google va directo a Google y no a la ventana con el correo", async () => {
    const x = armar();
    const entradas: string[] = [];
    x.m.deps.entrar = () => void entradas.push("google");
    x.m.deps.cambiarDeCuenta = () => void entradas.push("ventana");
    x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), billetera: async () => "correo" };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Hace falta una cuenta de Google");
    expect(principales(p)[0]?.querySelector(".g-ico")).toBeNull();
    boton(p, "Entrar con Google").click();
    expect(entradas).toEqual(["google"]);
  });

  it("con una cuenta de correo, el botón de Google lleva la G cuando Google entra directo", async () => {
    const x = armar();
    x.m.deps.entraConGoogle = () => true;
    x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), billetera: async () => "correo" };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(principales(p)[0]?.querySelector(".g-ico")).not.toBeNull();
  });

  it("con la cuenta de Google sí ofrece cargar y pagar", async () => {
    const sinSaldo = armar({ saldo: 0n });
    const p = nuevoPanel(sinSaldo.m);
    await eligiendo(sinSaldo, p);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cargar dólares digitales"]);
    cerrarTodos();
    document.body.innerHTML = "";
    const conSaldo = armar();
    const q = nuevoPanel(conSaldo.m);
    await eligiendo(conSaldo, q);
    expect(principales(q).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
  });

  it("con el servicio sin atender dice que pruebe más tarde y no manda a otra billetera", async () => {
    const x = armar();
    x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), portero: async () => "no" };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-linea")).toBe("Tu cuenta no puede pagar ahora. Probá más tarde.");
    expect($<HTMLElement>(p, "#cpo-comision")).toBeNull();
  });

  it("la cuenta de quien organiza no viaja en el borrador: si traía otra, se descarta", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    await eligiendo(x, p, borradorDe({ organizadora: cuentaDePrueba(9) }));
    boton(p, "Pagar 2,40").click();
    await suelta(10);
    const enviado = JSON.parse(x.activaciones[0]?.texto ?? "{}") as { organizadora?: string };
    expect(enviado.organizadora).toBe(ORIGEN);
  });

  it("uno de otra red, ya anotado o con contrato no se acepta antes de cobrar", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    await eligiendo(x, p, borradorDe({ anotadas: 3 }));
    expect(vistaDe(p)).toBe("elegir");
    expect(texto(p, "#cpo-aviso")).toBe("Revisá el campo anotadas.");
    await eligiendo(x, p, borradorDe({ contrato: "CABC" }));
    expect(vistaDe(p)).toBe("elegir");
  });

  it("premios distintos o con un monto fuera de 1 a 10.000 no se aceptan", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    await eligiendo(x, p, borradorDe({ premios: ["1200000000", "600000000"] }));
    expect(texto(p, "#cpo-aviso")).toBe("Los premios deben ser iguales.");
    await eligiendo(x, p, borradorDe({ premios: ["100010000000000"] }));
    expect(texto(p, "#cpo-aviso")).toBe("Revisá el campo premios.");
    expect(vistaDe(p)).toBe("elegir");
  });

  it("lo que la sala no firmaría no se cobra: cierre a más de una semana, sorteo lejos del cierre o un nombre que imita", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const dia = 86_400_000;
    const lejos = AHORA + 8 * dia;
    await eligiendo(x, p, borradorDe({ abre_ms: lejos, cierra_ms: lejos + 3_600_000, sorteo_ms: lejos + 7_200_000, recibir_hasta_ms: lejos + 9 * dia }));
    expect(vistaDe(p)).toBe("elegir");
    expect(texto(p, "#cpo-aviso")).toBe("Se activa hasta una semana antes del cierre. Volvé más cerca de la fecha.");
    const c = campanaDeArchivo();
    await eligiendo(x, p, borradorDe({ sorteo_ms: (c.cierra_ms as number) + dia + 1, recibir_hasta_ms: (c.cierra_ms as number) + 9 * dia }));
    expect(texto(p, "#cpo-aviso")).toBe("El sorteo tiene que ser hasta un día después del cierre.");
    await eligiendo(x, p, borradorDe({ empresa: { nombre: "T1nkaz0", logo: null, color: "verde" } }));
    expect(texto(p, "#cpo-aviso")).toBe("El nombre de la empresa no puede decir Tinkazo.");
    expect(vistaDe(p)).toBe("elegir");
    expect(x.pedidos).toEqual([]);
    expect(x.activaciones).toEqual([]);
  });

  it("uno que cierra a más de una semana se guarda para volver más cerca de la fecha", async () => {
    const x = armar();
    const lejos = AHORA + 8 * 86_400_000;
    const crudo = borradorDe({ abre_ms: lejos, cierra_ms: lejos + 3_600_000, sorteo_ms: lejos + 7_200_000, recibir_hasta_ms: lejos + 9 * 86_400_000 });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    const p = nuevoPanel(x.m);
    await suelta(10);
    expect(texto(p, "#cpo-aviso")).toBe("Se activa hasta una semana antes del cierre. Volvé más cerca de la fecha.");
    expect(guardado(x.m)).toBe(crudo);
    // Se puede dejar desde ahí mismo: borra el borrador y vuelve a la portada.
    boton(p, "Dejar esta campaña").click();
    await suelta(4);
    expect(guardado(x.m)).toBeNull();
    expect(x.irA).toEqual(["/"]);
  });

  it("sin el cobro prendido un archivo sin firma sigue siendo un archivo que no es una campaña", async () => {
    const x = armar();
    x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), comision: () => null };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(vistaDe(p)).toBe("elegir");
    expect(texto(p, "#cpo-aviso")).toBe("Este archivo no es una campaña.");
  });
});

describe("pagar y activarse sola", () => {
  it("al pagar pide a la sala que firme, crea la sala con lo que firmó y abre la inscripción", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.hecho).toEqual(["pagar", "activar"]);
    expect(x.activaciones).toHaveLength(1);
    expect(x.activaciones[0]?.sesion).toBe("token-de-prueba");
    const enviado = JSON.parse(x.activaciones[0]?.texto ?? "{}") as { organizadora?: string; evento?: string };
    expect(enviado.organizadora).toBe(ORIGEN);
    expect(x.m.creadas).toHaveLength(1);
    expect(x.m.creadas[0]?.archivo).toEqual({ texto: x.activaciones[0]?.texto, firma: FIRMA });
    expect(x.m.fases[0]?.[0]).toBe("abierta");
  });

  it("la sala se crea después de cobrar y nunca antes", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(x.m.creadas).toEqual([]);
    const crear = x.m.deps.crear;
    x.m.deps.crear = async (a, de) => {
      x.hecho.push("crear");
      return crear(a, de);
    };
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.hecho).toEqual(["pagar", "activar", "crear"]);
  });

  it("con la apertura a días, queda activada sin crear la sala y la crea seis horas antes de abrir", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const abre = AHORA + 2 * 86_400_000;
    const crudo = borradorDe({ abre_ms: abre, cierra_ms: abre + 3_600_000, sorteo_ms: abre + 7_200_000, recibir_hasta_ms: abre + 9 * 86_400_000 });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    expect(texto(p, "#cpo-linea")).toMatch(/^Volvé el .+ desde las .+ para abrir la inscripción\.$/u);
    expect(x.activaciones).toHaveLength(1);
    expect(x.m.creadas).toEqual([]);
    expect(principales(p).map((b) => [b.textContent, b.disabled])).toEqual([["Abrir la inscripción", true]]);
    expect(botonesDe(p).some((t) => t.startsWith("Pagar"))).toBe(false);
    // El borrador sigue guardado: al volver otro día se retoma.
    expect(guardado(x.m)).not.toBeNull();
    await x.m.correr(2 * 86_400_000 - 6 * 3_600_000);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones).toHaveLength(2);
    expect(x.m.creadas).toHaveLength(1);
    expect(x.hecho).toEqual(["pagar", "activar", "activar"]);
  });

  /** Una campaña que abre en 8 horas y sortea en 10: falta para la hora, pero el sorteo entra en la vida de la sala. */
  const borradorDeHoyMasTarde = (): string => {
    const abre = AHORA + 8 * 3_600_000;
    return borradorDe({ abre_ms: abre, cierra_ms: abre + 3_600_000, sorteo_ms: abre + 7_200_000, recibir_hasta_ms: abre + 9 * 86_400_000 });
  };

  it("con la apertura lejos pero el sorteo dentro del día, la inscripción se puede abrir ya con un toque", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const crudo = borradorDeHoyMasTarde();
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    expect(texto(p, "#cpo-linea")).toMatch(/^Abrila ahora, o volvé el .+ desde las .+\.$/u);
    expect(principales(p).map((b) => [b.textContent, b.disabled])).toEqual([["Abrir la inscripción ahora", false]]);
    // Sin el toque no se crea nada: la sala sigue esperando su hora.
    expect(x.m.creadas).toEqual([]);
    boton(p, "Abrir la inscripción ahora").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones).toHaveLength(2);
    expect(x.m.creadas).toHaveLength(1);
    expect(x.m.fases[0]?.[0]).toBe("abierta");
    // Abrir ya no cobra de nuevo: un solo pago, y después solo activar.
    expect(x.hecho).toEqual(["pagar", "activar", "activar"]);
    expect(botonesDe(p).some((t) => t.startsWith("Pagar"))).toBe(false);
  });

  it("si la sala falla al abrir ya, probar de nuevo abre igual y no vuelve a la espera", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const crudo = borradorDeHoyMasTarde();
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    x.respuestas.push({ ok: false, motivo: "sin-respuesta" });
    boton(p, "Abrir la inscripción ahora").click();
    await vi.waitFor(() => expect(botonesDe(p)).toContain("Probar de nuevo"));
    expect(x.m.creadas).toEqual([]);
    expect(botonesDe(p).some((t) => t.startsWith("Pagar"))).toBe(false);
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.m.creadas).toHaveLength(1);
    expect(x.hecho).toEqual(["pagar", "activar", "activar", "activar"]);
  });

  it("el botón Abrir pasa solo a Abrir la inscripción ahora al cruzar la hora en que ya cabe, sin tocar nada", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const hora = 3_600_000;
    // Abre en 30 horas y sortea en 32: abrirla ya cabe recién 18 horas antes del sorteo, o sea dentro de 14 horas.
    const abre = AHORA + 30 * hora;
    const crudo = borradorDe({ abre_ms: abre, cierra_ms: abre + hora, sorteo_ms: abre + 2 * hora, recibir_hasta_ms: abre + 9 * 86_400_000 });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    expect(principales(p).map((b) => [b.textContent, b.disabled])).toEqual([["Abrir la inscripción", true]]);
    await x.m.correr(14 * hora - 60_000);
    expect(principales(p).map((b) => [b.textContent, b.disabled])).toEqual([["Abrir la inscripción", true]]);
    await x.m.correr(2 * 60_000);
    expect(principales(p).map((b) => [b.textContent, b.disabled])).toEqual([["Abrir la inscripción ahora", false]]);
    expect(x.m.creadas).toEqual([]);
  });

  it("si la sala falla al abrir ya por la red, vuelve a probar sola a la hora de abrir", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const crudo = borradorDeHoyMasTarde();
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    x.respuestas.push({ ok: false, motivo: "sin-respuesta" });
    boton(p, "Abrir la inscripción ahora").click();
    await vi.waitFor(() => expect(botonesDe(p)).toContain("Probar de nuevo"));
    expect(x.activaciones).toHaveLength(2);
    // La inscripción abre en 8 horas y la sala se crea 6 antes: a las 2 horas, sin tocar nada.
    await x.m.correr(2 * 3_600_000 - 60_000);
    expect(x.activaciones).toHaveLength(2);
    await x.m.correr(2 * 60_000);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones).toHaveLength(3);
    expect(x.m.creadas).toHaveLength(1);
    // Una sola vez pagado.
    expect(x.hecho).toEqual(["pagar", "activar", "activar", "activar"]);
  });

  it("los reintentos solos son pocos: a la tercera vez que falla, queda el botón", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    const crudo = borradorDeHoyMasTarde();
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    for (let i = 0; i < 8; i++) x.respuestas.push({ ok: false, motivo: "red" });
    boton(p, "Abrir la inscripción ahora").click();
    await vi.waitFor(() => expect(x.activaciones).toHaveLength(2));
    await x.m.correr(3 * 3_600_000);
    await x.m.correr(5 * 60_000);
    await x.m.correr(24 * 3_600_000);
    // La primera activación, el toque y tres vueltas solas: nada más.
    expect(x.activaciones).toHaveLength(5);
    expect(vistaDe(p)).toBe("previa");
    expect(botonesDe(p)).toContain("Probar de nuevo");
  });

  it("lo que pide una acción de la persona no se reintenta solo", async () => {
    for (const motivo of ["sesion", "sin-fondos", "no-google", "limite"] as const) {
      document.body.innerHTML = "";
      const x = armar();
      const p = nuevoPanel(x.m);
      const crudo = borradorDeHoyMasTarde();
      x.m.almacen.setItem(CLAVE_DEL_BORRADOR, crudo);
      await eligiendo(x, p, crudo);
      boton(p, "Pagar 2,40").click();
      await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
      x.respuestas.push({ ok: false, motivo });
      boton(p, "Abrir la inscripción ahora").click();
      await vi.waitFor(() => expect(x.activaciones).toHaveLength(2));
      await suelta(6);
      await x.m.correr(12 * 3_600_000);
      expect(x.activaciones, motivo).toHaveLength(2);
      expect(vistaDe(p), motivo).toBe("previa");
      cerrarTodos();
    }
  });

  it("abrir ya se ofrece solo si a la sala le quedan seis horas después del sorteo", () => {
    const hora = 3_600_000;
    expect(cabeAbrirYa(AHORA + 18 * hora, AHORA)).toBe(true);
    expect(cabeAbrirYa(AHORA + 18 * hora + 1, AHORA)).toBe(false);
    expect(cabeAbrirYa(AHORA + 2 * 86_400_000, AHORA)).toBe(false);
  });

  it("ya pagado, se activa solo al elegir el borrador y no pide pagar", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.hecho).toEqual(["activar"]);
  });

  it("al quedar abierta saca el borrador: no vuelve a aparecer", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    const p = nuevoPanel(x.m);
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    await eligiendo(x, p);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(guardado(x.m)).toBeNull();
  });

  it("mientras activa dice que activa, deja un solo botón apagado y no ofrece pagar ni dejarla", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    let soltar: () => void = () => undefined;
    x.espera = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Activando tu campaña");
    expect(texto(p, "#cpo-linea")).toBe("Ya pagaste. No pagues de nuevo.");
    // El premio grande dice lo mismo que los demás montos: 120,00 y no 120.
    expect(texto(p, "#cpo-premio")).toBe("120,00 dólares digitales");
    // El botón apagado cede su lugar a la fila viva, que dice la etapa.
    expect(botonesDe(p)).toEqual([]);
    expect(texto(p, "#cpo-fila")).toBe("Activando");
    soltar();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("después de activar, la fila dice cada etapa en orden: Creando la sala y Abriendo la inscripción", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    let soltarCrear: () => void = () => undefined;
    let soltarFase: () => void = () => undefined;
    const crear = x.m.deps.crear;
    const fase = x.m.deps.fase;
    x.m.deps.crear = async (a, b) => {
      await new Promise<void>((r) => {
        soltarCrear = r;
      });
      return crear(a, b);
    };
    x.m.deps.fase = async (s, f, c) => {
      await new Promise<void>((r) => {
        soltarFase = r;
      });
      return fase(s, f, c);
    };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    await vi.waitFor(() => expect(texto(p, "#cpo-fila")).toBe("Creando la sala"));
    expect(principales(p)).toEqual([]);
    expect(x.hecho).toEqual(["activar"]);
    soltarCrear();
    await vi.waitFor(() => expect(texto(p, "#cpo-fila")).toBe("Abriendo la inscripción"));
    expect(principales(p)).toEqual([]);
    soltarFase();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(texto(p, "#cpo-fila")).toBe("");
  });

  it("al pasar de Activando a Creando la sala y a Abriendo, el panel no salta: mismo título, mismo modo y sin enlace para soltarla", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    let soltarCrear: () => void = () => undefined;
    let soltarFase: () => void = () => undefined;
    const crear = x.m.deps.crear;
    const fase = x.m.deps.fase;
    x.m.deps.crear = async (a, b) => {
      await new Promise<void>((r) => {
        soltarCrear = r;
      });
      return crear(a, b);
    };
    x.m.deps.fase = async (s, f, c) => {
      await new Promise<void>((r) => {
        soltarFase = r;
      });
      return fase(s, f, c);
    };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    const igual = (fila: string): void => {
      expect(texto(p, "#cpo-fila")).toBe(fila);
      expect(texto(p, "#cpo-h")).toBe("Activando tu campaña");
      expect(texto(p, "#cpo-linea")).toBe("Ya pagaste. No pagues de nuevo.");
      expect(p.raiz.hasAttribute("data-borrador")).toBe(true);
      expect(texto(p, "#cpo-marca")).toBe("Servicio pagado");
      // Ni Elegir otro archivo ni Dejar esta campaña: la campaña ya se pagó.
      expect(botonesDe(p)).toEqual([]);
    };
    await vi.waitFor(() => expect(texto(p, "#cpo-fila")).toBe("Creando la sala"));
    igual("Creando la sala");
    soltarCrear();
    await vi.waitFor(() => expect(texto(p, "#cpo-fila")).toBe("Abriendo la inscripción"));
    igual("Abriendo la inscripción");
    soltarFase();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(p.raiz.hasAttribute("data-borrador")).toBe(false);
  });

  it("si la sala no se puede crear, el panel deja el modo del borrador y dice por qué", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    x.m.deps.crear = async () => ({ ok: false, motivo: "red" });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    await vi.waitFor(() => expect(texto(p, "#cpo-fila")).toBe(""));
    expect(vistaDe(p)).toBe("previa");
    expect(p.raiz.hasAttribute("data-borrador")).toBe(false);
    expect(texto(p, "#cpo-aviso").length).toBeGreaterThan(0);
  });

  it("no pide activar dos veces aunque el cobro avise más de una vez", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    let soltar: () => void = () => undefined;
    x.espera = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: ORIGEN }));
    await suelta(8);
    soltar();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones).toHaveLength(1);
  });
});

describe("antes de cobrar, la sala dice si puede activar", () => {
  it("si no puede, lo dice, no ofrece pagar y deja probar de nuevo, que sí ofrece pagar cuando ya puede", async () => {
    const x = armar();
    let puede = false;
    let preguntas = 0;
    x.m.deps.salaLista = async () => {
      preguntas++;
      return puede;
    };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Todavía no se puede activar");
    expect(texto(p, "#cpo-linea")).toBe("Probá de nuevo en un rato. Todavía no se cobró nada.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
    expect(botonesDe(p).some((t) => t.startsWith("Pagar"))).toBe(false);
    puede = true;
    boton(p, "Probar de nuevo").click();
    await suelta(8);
    expect(preguntas).toBe(2);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.hecho).toEqual(["pagar", "activar"]);
  });

  it("mientras pregunta la fila dice que revisa, sin botón apagado, y no ofrece pagar", async () => {
    const x = armar();
    let responder: (si: boolean) => void = () => undefined;
    x.m.deps.salaLista = () => new Promise<boolean>((r) => (responder = r));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Un momento…");
    expect(texto(p, "#cpo-fila")).toBe("Revisando que todo esté listo");
    expect(principales(p)).toEqual([]);
    expect(botonesDe(p).some((t) => t.startsWith("Pagar"))).toBe(false);
    responder(true);
    await suelta(8);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
  });

  it("si la pregunta falla, es un no", async () => {
    const x = armar();
    x.m.deps.salaLista = async () => {
      throw new Error("sin red");
    };
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Todavía no se puede activar");
    expect(x.hecho).toEqual([]);
  });

  it("ya pagado, no se frena: se activa como siempre", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) } });
    x.m.deps.salaLista = async () => false;
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.hecho).toEqual(["activar"]);
  });
});

describe("cuando la sala dice que no", () => {
  const pagado = (): Mundillo => armar({ red: { tipo: "pagada", suma: d(1.9) } });

  it("no pagada: lo dice en una línea y deja volver a mirar, que vuelve a pedir", async () => {
    const x = pagado();
    x.respuestas.push(falla("no-pagada"));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Todavía no vemos tu pago");
    expect(texto(p, "#cpo-linea")).toBe("Puede tardar un minuto. No pagues de nuevo.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Volver a mirar"]);
    boton(p, "Volver a mirar").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones).toHaveLength(2);
    expect(x.hecho).not.toContain("pagar");
  });

  it("no pagada: la marca de Servicio pagado no contradice el título", async () => {
    const x = pagado();
    x.respuestas.push(falla("no-pagada"));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect($<HTMLElement>(p, "#cpo-marca").hidden).toBe(true);
  });

  it("sin fondos: la marca de Servicio pagado sigue a la vista, porque el servicio sí se pagó", async () => {
    const x = pagado();
    x.respuestas.push(falla("sin-fondos"));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect($<HTMLElement>(p, "#cpo-marca").hidden).toBe(false);
  });

  it.each<[MotivoDeActivar, string, string]>([
    ["red", "No pudimos activarla", "Tu pago está a salvo. Probá de nuevo."],
    ["acceso", "No pudimos activarla", "Tu pago está a salvo. Probá de nuevo."],
    ["sin-respuesta", "Sin conexión", "Tu pago está a salvo. Probá de nuevo."],
    ["limite", "Demasiados intentos", "Probá de nuevo en un rato. Tu pago está a salvo."],
    ["apagada", "Todavía no se puede activar", "Probá de nuevo en un rato. Tu pago está a salvo."],
    ["sin-llave", "Todavía no se puede activar", "Probá de nuevo en un rato. Tu pago está a salvo."],
    ["sin-pollar", "Todavía no se puede activar", "Probá de nuevo en un rato. Tu pago está a salvo."],
  ])("%s: título, línea y Probar de nuevo, que vuelve a pedir", async (motivo, titulo, linea) => {
    const x = pagado();
    x.respuestas.push(falla(motivo));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe(titulo);
    expect(texto(p, "#cpo-linea")).toBe(linea);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Probar de nuevo"]);
    boton(p, "Probar de nuevo").click();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
  });

  it("sin fondos: ofrece cargar y, al cerrar la ventana, vuelve a pedir sola", async () => {
    const x = pagado();
    x.respuestas.push(falla("sin-fondos"));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Faltan dólares en tu cuenta");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Cargar dólares digitales"]);
    boton(p, "Cargar dólares digitales").click();
    expect(x.cargas).toEqual([ORIGEN]);
    expect(x.activaciones).toHaveLength(1);
    x.alCerrarLaCarga?.();
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones).toHaveLength(2);
  });

  it.each<MotivoDeActivar>(["sesion", "organizadora", "no-google"])("%s: ofrece entrar con Google", async (motivo) => {
    const x = pagado();
    x.respuestas.push(falla(motivo));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
  });

  it.each<MotivoDeActivar>(["sesion", "organizadora", "no-google"])("%s: Entrar con Google va directo a Google, sin la ventana con el correo", async (motivo) => {
    const x = pagado();
    x.respuestas.push(falla(motivo));
    const entradas: string[] = [];
    x.m.deps.entrar = () => void entradas.push("google");
    x.m.deps.cambiarDeCuenta = () => void entradas.push("ventana");
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    boton(p, "Entrar con Google").click();
    expect(entradas).toEqual(["google"]);
  });

  it("sin token de sesión no pide nada a la sala y ofrece entrar de nuevo", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) }, sesion: null });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(x.activaciones).toEqual([]);
    expect(texto(p, "#cpo-h")).toBe("Entrá de nuevo con Google");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
  });

  it("al entrar con otra sesión vuelve a pedir sola", async () => {
    const x = armar({ red: { tipo: "pagada", suma: d(1.9) }, sesion: null });
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    x.sesion = "token-nuevo";
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: ORIGEN }));
    await vi.waitFor(() => expect(vistaDe(p)).toBe("abierta"));
    expect(x.activaciones[0]?.sesion).toBe("token-nuevo");
  });

  it("forma con su campo: dice qué revisar y lleva a armarla de nuevo, sin dejar el borrador", async () => {
    const x = pagado();
    x.respuestas.push(falla("forma", "premios"));
    const p = nuevoPanel(x.m);
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    await eligiendo(x, p);
    expect(texto(p, "#cpo-h")).toBe("Revisá tu campaña");
    expect(texto(p, "#cpo-linea")).toBe("Revisá el campo premios.");
    boton(p, "Armarla de nuevo").click();
    expect(x.irA).toEqual(["/crear-campana.html"]);
    expect(guardado(x.m)).toBeNull();
  });

  it("solo en el modo oficial: lo dice y lleva a armarla de nuevo", async () => {
    const x = pagado();
    x.respuestas.push(falla("red-principal"));
    const p = nuevoPanel(x.m);
    await eligiendo(x, p);
    expect(texto(p, "#cpo-linea")).toBe("Solo se activa en el modo oficial.");
  });

  it("en ningún error se ofrece pagar de nuevo", async () => {
    const motivos: MotivoDeActivar[] = ["no-pagada", "red", "sin-fondos", "sesion", "no-google", "organizadora", "forma", "limite", "apagada", "sin-respuesta"];
    for (const motivo of motivos) {
      const x = pagado();
      x.respuestas.push(falla(motivo));
      document.body.innerHTML = "";
      const p = nuevoPanel(x.m);
      await eligiendo(x, p);
      expect(botonesDe(p).join("|"), motivo).not.toMatch(/Pagar/);
      expect(x.hecho, motivo).not.toContain("pagar");
      cerrarTodos();
    }
  });
});

describe("retomar un borrador", () => {
  it("el que dejó crear-campana.html se retoma solo al abrir el panel", async () => {
    const x = armar({ saldo: 0n });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    const p = nuevoPanel(x.m);
    await suelta(10);
    expect(vistaDe(p)).toBe("previa");
    expect(texto(p, "#cpo-h")).toBe("Cargá 122,40 dólares digitales");
  });

  it("uno vencido o que no sirve se saca y se dice por qué", async () => {
    const x = armar();
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe({ cierra_ms: AHORA - 1000 }));
    const p = nuevoPanel(x.m);
    await suelta(10);
    expect(vistaDe(p)).toBe("elegir");
    expect(guardado(x.m)).toBeNull();
    expect(texto(p, "#cpo-aviso")).not.toBe("");
  });

  it("uno que no es JSON se saca sin romper nada", async () => {
    const x = armar();
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, "no soy json");
    const p = nuevoPanel(x.m);
    await suelta(10);
    expect(vistaDe(p)).toBe("elegir");
    expect(guardado(x.m)).toBeNull();
  });

  it("con el cobro apagado no mira el borrador ni lo toca", async () => {
    const x = armar();
    x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), comision: () => null };
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    const p = nuevoPanel(x.m);
    await suelta(10);
    expect(vistaDe(p)).toBe("elegir");
    expect(guardado(x.m)).not.toBeNull();
  });

  it("con una sala guardada del mismo evento manda la sala y el borrador se saca", async () => {
    const x = armar();
    x.m.red = "testnet";
    guardarOrg(x.m.almacen, { sala: { ...SALA, vence: AHORA + 86_400_000 }, fase: "abierta" });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    nuevoPanel(x.m);
    await suelta(10);
    expect(guardado(x.m)).toBeNull();
  });

  it("con una sala guardada de otra campaña, el borrador se queda esperando", async () => {
    const x = armar();
    guardarOrg(x.m.almacen, { sala: { ...SALA, vence: AHORA + 86_400_000 }, fase: "abierta" });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe({ evento: "otra-campana-2" }));
    nuevoPanel(x.m);
    await suelta(10);
    expect(guardado(x.m)).not.toBeNull();
  });

  it("Dejar esta campaña deja el borrador y no vuelve", async () => {
    const x = armar({ saldo: 0n });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    const p = nuevoPanel(x.m);
    await suelta(10);
    boton(p, "Dejar esta campaña").click();
    await suelta(4);
    expect(vistaDe(p)).toBe("elegir");
    expect(guardado(x.m)).toBeNull();
  });

  it("Dejar esta campaña vuelve a la portada: no le pide un archivo a quien nunca tuvo uno", async () => {
    const x = armar({ saldo: 0n });
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    const p = nuevoPanel(x.m);
    await suelta(10);
    boton(p, "Dejar esta campaña").click();
    await suelta(4);
    expect(guardado(x.m)).toBeNull();
    expect(x.irA).toEqual(["/"]);
  });

  it("sin borrador guardado, la vista de elegir no ofrece dejar nada", async () => {
    const x = armar();
    const p = nuevoPanel(x.m);
    await suelta(10);
    expect(vistaDe(p)).toBe("elegir");
    expect(botonesDe(p)).not.toContain("Dejar esta campaña");
  });
});

describe("los textos de la activación", () => {
  const CLAVES = Object.keys(TEXTOS_SALA_CAMPANA.es).filter((k) => k.startsWith("cpoAc"));

  it("hay claves nuevas y las dos listas las tienen", () => {
    expect(CLAVES.length).toBeGreaterThan(15);
    for (const k of CLAVES) expect(TEXTOS_SALA_CAMPANA.en[k], k).toBeTruthy();
  });

  it("ninguna lleva punto y coma, comillas, raya larga, exclamaciones, fee ni palabras de azar ni técnicas", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const t = TEXTOS_SALA_CAMPANA[idioma][k] ?? "";
        expect(t, `${idioma}.${k}`).not.toMatch(/[;«»"“”—–·¡!]/u);
        expect(t, `${idioma}.${k}`).not.toMatch(/\b(?:fee|raffle|lottery|ticket|bet|rifa|boleto|apuesta|lotería)\b|comisi[oó]n/iu);
        expect(t, `${idioma}.${k}`).not.toMatch(/\b(?:memo|red|firma|hash|transacci[oó]n|network|signature|transaction|blockchain|token)\b/iu);
      }
    }
  });
});

describe("la campaña por activar, sin sesión", () => {
  /** Sin nadie adentro: la billetera no es la de Google y el panel ofrece entrar. */
  function sinSesion(): { x: Mundillo; entradas: string[] } {
    const x = armar();
    x.m.cuenta = null;
    const entradas: string[] = [];
    x.m.deps.entrar = () => void entradas.push("entrar");
    x.m.deps.cambiarDeCuenta = () => void entradas.push("ventana");
    x.m.deps.comision = { ...(x.m.deps.comision as DepsDeComision), billetera: async () => (x.m.cuenta === null ? "otra" : "google") };
    x.m.almacen.setItem(CLAVE_DEL_BORRADOR, borradorDe());
    return { x, entradas };
  }

  it("la nombra, dice lo que sigue y lo que cuesta, y deja un solo botón principal y Dejar esta campaña", async () => {
    const { x } = sinSesion();
    const p = nuevoPanel(x.m);
    await suelta(10);
    const empresa = (JSON.parse(borradorDe()) as { empresa: { nombre: string } }).empresa.nombre;
    expect(texto(p, "#cpo-h")).toBe(`La campaña de ${empresa} está lista`);
    expect(texto(p, "#cpo-linea")).toBe("Entrá con Google y poné 122,40 dólares digitales: 120,00 de premio y 2,40 del servicio.");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Entrar con Google"]);
    expect(botonesDe(p)).toEqual(["Entrar con Google", "Dejar esta campaña"]);
    expect(p.raiz.hasAttribute("data-borrador")).toBe(true);
    // El título ya la nombra: arriba no se repite.
    expect($<HTMLElement>(p, "#cpo-de")?.hidden ?? true).toBe(true);
  });

  it("Entrar con Google usa el ingreso de la portada, no la ventana de siempre", async () => {
    const { x, entradas } = sinSesion();
    const p = nuevoPanel(x.m);
    await suelta(10);
    boton(p, "Entrar con Google").click();
    expect(entradas).toEqual(["entrar"]);
  });

  it("el botón de entrar lleva la G de Google cuando entra directo a Google, y no si no", async () => {
    for (const conGoogle of [true, false]) {
      document.body.innerHTML = "";
      const { x } = sinSesion();
      x.m.deps.entraConGoogle = () => conGoogle;
      const p = nuevoPanel(x.m);
      await suelta(10);
      const [entrar] = principales(p);
      expect(entrar?.textContent).toBe("Entrar con Google");
      expect(entrar?.querySelector(".g-ico") !== null).toBe(conGoogle);
      // El otro botón no lleva G.
      expect(p.raiz.querySelectorAll(".cpo-acciones .g-ico")).toHaveLength(conGoogle ? 1 : 0);
      cerrarTodos();
    }
  });

  it("al entrar, el título deja de pedir que entre y pide el pago", async () => {
    const { x } = sinSesion();
    const p = nuevoPanel(x.m);
    await suelta(10);
    x.m.cuenta = ORIGEN;
    document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: ORIGEN }));
    await suelta(10);
    expect(texto(p, "#cpo-h")).toBe("Pagá 2,40 a Tinkazo");
    expect(principales(p).map((b) => b.textContent)).toEqual(["Pagar 2,40"]);
    // De quién es la campaña sigue a la vista, arriba del título.
    const empresa = (JSON.parse(borradorDe()) as { empresa: { nombre: string } }).empresa.nombre;
    expect(texto(p, "#cpo-de")).toBe(`La campaña de ${empresa}`);
    expect($<HTMLElement>(p, "#cpo-de")?.hidden).toBe(false);
  });
});

describe("la campaña activada antes de tiempo, con Tus campañas", () => {
  const conApertura = async (conTus: boolean, salaConLaFuncion: boolean | null = true): Promise<string> => {
    const x = armar();
    x.m.red = "mainnet";
    if (conTus) {
      x.m.deps.tus = {
        alAbrir: () => false,
        disponible: async () => salaConLaFuncion,
        listar: async () => ({ ok: true, campanas: [] }),
        recuperar: async () => ({ ok: false, motivo: "red" }),
        armarSorteo: async () => true,
        ayuda: () => "mailto:ayuda@prueba.test",
      };
    }
    const p = nuevoPanel(x.m);
    const abre = AHORA + 2 * 86_400_000;
    const crudo = borradorDe({ abre_ms: abre, cierra_ms: abre + 3_600_000, sorteo_ms: abre + 7_200_000, recibir_hasta_ms: abre + 9 * 86_400_000 });
    await eligiendo(x, p, crudo);
    boton(p, "Pagar 2,40").click();
    await vi.waitFor(() => expect(texto(p, "#cpo-h")).toBe("Tu campaña ya está activada"));
    return texto(p, "#cpo-linea");
  };

  it("la línea suma cómo seguir en otra compu", async () => {
    expect(await conApertura(true)).toMatch(/^Volvé el .+ desde las .+ para abrir la inscripción. En otra compu, entrá con esta misma cuenta y tocá Tus campañas.$/u);
  });

  it("sin Tus campañas es la línea de siempre", async () => {
    expect(await conApertura(false)).toMatch(/^Volvé el .+ desde las .+ para abrir la inscripción.$/u);
  });

  it("con una sala que todavía no tiene la función, o que no contestó, no promete Tus campañas", async () => {
    expect(await conApertura(true, false)).toMatch(/^Volvé el .+ desde las .+ para abrir la inscripción.$/u);
    expect(await conApertura(true, null)).toMatch(/^Volvé el .+ desde las .+ para abrir la inscripción.$/u);
  });
});
