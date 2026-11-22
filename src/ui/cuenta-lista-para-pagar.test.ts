import { describe, expect, it } from "vitest";
import { ACCESO_LIBRE, type EntradaVista, comoEntrada, portadaDe, vistaDe } from "./cuenta-lista-estado";

/**
 * El paso de dejar la cuenta lista abierto antes de pagar el servicio de una campaña de empresa (`para: "pago"`), sin DOM.
 * Se porta como la entrada (Seguir al final, sin Volver) y cambia solo lo que dice: al final, que ya se puede pagar desde esta
 * compu, sin la línea de los sorteos del regalo y sin la del primer sello. Antes del final es idéntico a la entrada, salvo que
 * nunca ofrece pasar a Prueba: quien va a pagar una campaña oficial no tiene nada que hacer ahí.
 */

const base: EntradaVista = {
  activacion: "falta",
  proteccion: "falta",
  correoConfirmado: false,
  tieneLlaves: false,
  unicoNavegador: true,
  corre: null,
  lento: false,
  falla: null,
  aviso: null,
  para: "pago",
  celular: true,
  hayDesbloqueo: true,
  desbloqueoFallo: false,
  eligioCorreo: false,
  correoSesion: "n•••@gmail.com",
  correoCuenta: "",
  entroConCorreo: false,
  codigo: null,
  codigoRecargado: false,
  campoOk: false,
  sinPedidoVeces: 0,
  puedePasarAPrueba: true,
  primerOficialPendiente: false,
};
const pago = (o: Partial<EntradaVista> = {}): EntradaVista => ({ ...base, ...o, para: "pago" });
const entrada = (o: Partial<EntradaVista> = {}): EntradaVista => ({ ...base, ...o, para: "entrada" });
const LISTA = { activacion: "lista", proteccion: "lista" } as const;

describe("el paso antes de pagar: el final", () => {
  it("termina en Seguir, no en Sellar, y no tiene Volver", () => {
    const vista = vistaDe(pago(LISTA));
    expect(vista.final).toBe(true);
    expect(vista.titulo).toBe("clListaTitulo");
    expect(vista.principal).toEqual({ accion: "seguir", clave: "clSeguir", apagado: false });
    expect(vista.volver).toBeNull();
    expect(comoEntrada("pago")).toBe(true);
  });

  it("dice que ya se puede pagar desde esta compu", () => {
    const vista = vistaDe(pago(LISTA));
    expect(vista.bajada).toBe("clPagoListo");
    expect(portadaDe(vista)).toEqual({ forma: "final", titulo: "clListaTitulo", linea: { clave: "clPagoListo" }, filas: [] });
  });

  it("no muestra la línea del primer sello aunque esté pendiente", () => {
    const vista = vistaDe(pago({ ...LISTA, primerOficialPendiente: true }));
    expect(vista.primerOficial).toBe(false);
    expect(portadaDe(vista).linea).toEqual({ clave: "clPagoListo" });
    // Con la entrada, esa misma cuenta sí la lleva.
    expect(vistaDe(entrada({ ...LISTA, primerOficialPendiente: true })).primerOficial).toBe(true);
  });

  it("no muestra la línea de los sorteos del regalo ni Practicar en Prueba", () => {
    const conRegalo = { ...ACCESO_LIBRE, sorteosDelRegalo: { quedan: 2, vence: null } };
    const sinRegalo = { ...ACCESO_LIBRE, sorteosDelRegalo: { quedan: 0, vence: null, lleno: true } };
    expect(vistaDe(entrada({ ...LISTA, acceso: conRegalo })).linea).toBeDefined();
    expect(vistaDe(pago({ ...LISTA, acceso: conRegalo })).linea).toBeUndefined();
    expect(vistaDe(entrada({ ...LISTA, acceso: sinRegalo })).practicar).toBeDefined();
    expect(vistaDe(pago({ ...LISTA, acceso: sinRegalo })).practicar).toBeUndefined();
    expect(portadaDe(vistaDe(pago({ ...LISTA, acceso: conRegalo }))).linea).toEqual({ clave: "clPagoListo" });
  });

  it("una sola acción principal", () => {
    const vista = vistaDe(pago(LISTA));
    const principales = [vista.principal, vista.practicar].filter((x) => x !== null && x !== undefined);
    expect(principales).toHaveLength(1);
  });
});

describe("el paso antes de pagar: antes del final", () => {
  const CASOS: [string, Partial<EntradaVista>][] = [
    ["sin nada hecho", {}],
    ["activada y sin proteger", { activacion: "lista" }],
    ["en una compu nueva", { activacion: "lista", proteccion: "aparato-nuevo", correoConfirmado: true }],
    ["sin forma de recuperarla", { activacion: "lista", proteccion: "sin-forma" }],
    ["activando", { corre: "activando" }],
  ];

  it.each(CASOS)("%s: lo mismo que con la entrada, sin la salida a Prueba", (_n, o) => {
    const a = vistaDe(pago(o));
    // La entrada que no puede pasar a Prueba es la referencia: lo demás (cajas, principal, volver) es idéntico.
    const b = vistaDe(entrada({ ...o, puedePasarAPrueba: false }));
    expect(a.final).toBe(false);
    expect(a.principal).toEqual(b.principal);
    expect(a.cajas).toEqual(b.cajas);
    expect(a.volver).toEqual(b.volver);
    expect(portadaDe(a)).toEqual(portadaDe(b));
    // Ni como principal ni como salida: la única salida que queda es Cerrar sesión.
    expect(a.principal?.accion).not.toBe("pasar-a-prueba");
    expect(a.salidas?.prueba).toBeNull();
    expect(a.salidas?.cerrar).toEqual({ apagado: false });
    expect(a.notas).toEqual([]);
  });

  it("con la cuenta sin forma de recuperarla, la principal no es Pasar a Prueba: queda la explicación y Cerrar sesión", () => {
    const vista = vistaDe(pago({ activacion: "lista", proteccion: "sin-forma", puedePasarAPrueba: true }));
    const caja = vista.cajas.find((c) => c.parte === "proteger");
    expect(caja?.titulo).toBe("clSinFormaTitulo");
    expect(vista.principal).toBeNull();
    expect(vista.salidas?.prueba).toBeNull();
    expect(vista.salidas?.cerrar).toEqual({ apagado: false });
    // Con la entrada, esa misma cuenta sí tiene Pasar a Prueba como principal: es solo del pago que no se ofrece.
    expect(vistaDe(entrada({ activacion: "lista", proteccion: "sin-forma" })).principal?.accion).toBe("pasar-a-prueba");
  });

  it("con la cuenta sin proteger en una compu nueva, lo que pide es proteger y no pagar", () => {
    const vista = vistaDe(pago({ activacion: "lista", proteccion: "aparato-nuevo", correoConfirmado: true }));
    expect(vista.cajas.find((c) => c.parte === "proteger")?.titulo).toBe("clAparatoTitulo");
    expect(vista.principal?.accion).not.toBe("seguir");
  });
});
