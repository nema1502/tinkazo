import { describe, expect, it } from "vitest";
import {
  ACCESO_LIBRE,
  type AccesoEnLaVista,
  type EntradaVista,
  type Para,
  activarPermitido,
  faltaElAcceso,
  pagoInicial,
  portadaDe,
  vistaDe,
} from "./cuenta-lista-estado";

/**
 * El paso de quien ganó un premio (`para: "premio"`), sin DOM. Dos cosas que no se rompen:
 * - que la entrada del premio no salte el acceso: con el servidor mandando, una cuenta sin activar y sin el acceso
 *   confirmado no se activa nunca, con ningún `para`;
 * - que a quien organiza no le cambie nada: lo cubre la referencia (`cuenta-lista-referencia.test.ts`), y acá se prueba
 *   que el premio no se cuele en lo que ve.
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
  para: "entrada",
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
const PARAS: Para[] = ["entrada", "entrada-con-lista", "sello", "sorteo", "premio"];
const PAQUETE = { id: "alta", usdc: "3", sorteos: 3, dias: 90 } as const;
const premio = (o: Partial<EntradaVista> = {}, acceso?: AccesoEnLaVista): EntradaVista => ({
  ...base,
  ...o,
  para: "premio",
  ...(acceso ? { acceso } : {}),
});
const v = (o: Partial<EntradaVista> = {}, acceso?: AccesoEnLaVista) => vistaDe(premio(o, acceso));
const servidor = (o: Partial<AccesoEnLaVista> = {}): AccesoEnLaVista => ({ ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", ...o });

/** Todas las acciones que la vista ofrece: la principal y los secundarios de cada caja. */
const acciones = (vista: ReturnType<typeof vistaDe>): string[] => [
  ...(vista.principal ? [vista.principal.accion] : []),
  ...vista.cajas.flatMap((c) => c.secundarios.map((s) => s.accion)),
];

/** Las entradas con la cuenta sin activar o a medio activar, con lo que puede estar corriendo. */
function sinActivar(para: Para, acceso: AccesoEnLaVista): EntradaVista[] {
  const out: EntradaVista[] = [];
  for (const activacion of ["falta", "preparando", "fallo", "no-se-sabe"] as const)
    for (const proteccion of ["lista", "falta", "aparato-nuevo", "sin-forma", "no-se-sabe"] as const)
      for (const corre of [null, "revisando", "activando", "esperando", "canjeando"] as const)
        for (const falla of [null, "red", "sesion", "tope"] as const)
          out.push({ ...base, para, activacion, proteccion, corre, falla, correoConfirmado: true, acceso });
  return out;
}

describe("el paso del premio: lo que ve mientras faltan pasos", () => {
  it.each([
    ["con la cuenta activada y sin proteger", { activacion: "lista" as const }],
    ["con los dos pasos pendientes y el acceso confirmado", { activacion: "falta" as const }],
    ["con solo proteger, en una compu nueva", { activacion: "lista" as const, proteccion: "aparato-nuevo" as const, correoConfirmado: true }],
  ])("%s, la portada es la misma que con la entrada", (_n, o) => {
    const acceso = servidor({ estado: "con", por: "premio" });
    const conPremio = portadaDe(v(o, acceso));
    const conEntrada = portadaDe(vistaDe({ ...base, ...o, para: "entrada", acceso }));
    expect(conPremio.forma).toBe(conEntrada.forma);
    expect(conPremio.titulo).toBe(conEntrada.titulo);
    expect(conPremio.linea).toEqual(conEntrada.linea);
    expect(conPremio.filas.map((c) => c.parte)).toEqual(conEntrada.filas.map((c) => c.parte));
  });

  it("ninguna salida lleva a Prueba, y Cerrar sesión siempre está", () => {
    const casos = [
      v(),
      v({}, servidor({ estado: "con", por: "premio" })),
      v({ activacion: "lista", proteccion: "sin-forma" }),
      v({ activacion: "lista", proteccion: "sin-forma", puedePasarAPrueba: false }),
      v({}, { ...ACCESO_LIBRE, modo: "cerrado" }),
      v({}, servidor()),
      v({}, servidor({ estado: "error", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" })),
    ];
    for (const vista of casos) {
      expect(vista.salidas?.prueba).toBeNull();
      expect(vista.salidas?.cerrar).toEqual({ apagado: false });
      expect(vista.notas).toEqual([]);
      expect(acciones(vista)).not.toContain("pasar-a-prueba");
    }
  });

  it("con el servidor mandando, la cuenta lista y un cupón pedido, no hay Volver del cupón", () => {
    const vista = v({ activacion: "lista", proteccion: "lista" }, servidor({ estado: "con", por: "cupon", pideCupon: true }));
    expect(vista.volver).toBeNull();
  });
});

describe("el paso del premio: el final", () => {
  const final = (o: Partial<EntradaVista> = {}) => v({ activacion: "lista", proteccion: "lista", ...o });

  it("el título de siempre, la línea del premio, Seguir y sin Volver", () => {
    const vista = final();
    expect(vista.final).toBe(true);
    expect(vista.titulo).toBe("clListaTitulo");
    expect(vista.principal).toEqual({ accion: "seguir", clave: "clSeguir", apagado: false });
    expect(vista.volver).toBeNull();
    expect(portadaDe(vista)).toEqual({ forma: "final", titulo: "clListaTitulo", linea: { clave: "clPremioListo" }, filas: [] });
  });

  it("el primer sello no se confirma aunque esté pendiente", () => {
    const vista = final({ primerOficialPendiente: true });
    expect(vista.primerOficial).toBe(false);
    expect(portadaDe(vista).linea).toEqual({ clave: "clPremioListo" });
  });

  it("para quien organiza, el final sigue sin línea propia", () => {
    for (const para of ["entrada", "entrada-con-lista", "sello", "sorteo"] as const) {
      const vista = vistaDe({ ...base, activacion: "lista", proteccion: "lista", para });
      expect(vista.bajada, para).toBe("");
      expect(portadaDe(vista).linea?.clave, para).not.toBe("clPremioListo");
    }
  });
});

describe("el paso del premio: sin el acceso, espera", () => {
  const SIN_ACCESO: Array<[string, AccesoEnLaVista]> = [
    ["servidor sin acceso", servidor()],
    ["servidor que no contestó", servidor({ estado: "error", error: { clave: "altaErrServicio" }, arreglo: "probar" })],
    ["servidor sin acceso y con la compra a la venta", servidor({ pago: pagoInicial("es", PAQUETE) })],
    ["servidor sin acceso y con un cupón en mano", servidor({ cuponEnMano: "K7M2-9QXA-4HTR" })],
  ];

  it.each(SIN_ACCESO)("%s: la espera, con volver a preguntar y nada de cupón, compra ni Prueba", (_n, acceso) => {
    const vista = v({}, acceso);
    const portada = portadaDe(vista);
    expect(portada.forma).toBe("uno");
    expect(portada.titulo).toBe("clPremioEsperaTitulo");
    expect(portada.linea).toEqual({ clave: "clPremioEspera" });
    expect(vista.principal).toEqual({ accion: "leer-acceso", clave: "clProbarDeNuevo", apagado: false });
    expect(vista.cajas.some((c) => c.campo === "cupon")).toBe(false);
    for (const a of ["tengo-cupon", "comprar", "usar-cupon", "otro-cupon", "pasar-a-prueba", "activar"]) expect(acciones(vista)).not.toContain(a);
    expect(activarPermitido(premio({}, acceso))).toBe(false);
  });

  it("con la sesión cerrada, la principal es entrar de nuevo", () => {
    const vista = v({}, servidor({ estado: "error", error: { clave: "clErrSesion" }, arreglo: "entrar" }));
    expect(vista.principal?.accion).toBe("entrar-de-nuevo");
    expect(acciones(vista)).not.toContain("activar");
  });

  it("con el acceso en otra cuenta, se dice con su texto y no queda principal", () => {
    const vista = v({}, servidor({ estado: "error", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" }));
    expect(vista.principal).toBeNull();
    expect(vista.cajas[0]?.error?.map((x) => x.clave)).toEqual(["altaErrCuentaDeOtro"]);
  });

  it("mientras el servidor contesta, se ve la forma de revisar", () => {
    const vista = v({}, servidor({ estado: "revisando" }));
    expect(portadaDe(vista).forma).toBe("revisando");
    expect(vista.principal).toMatchObject({ accion: "leer-acceso", apagado: true, ocupado: true });
  });

  it("para quien organiza, la misma entrada sigue con la caja del cupón", () => {
    const vista = vistaDe({ ...base, acceso: servidor() });
    expect(vista.cajas[0]?.titulo).toBe("clActivarTitulo");
    expect(vista.principal?.accion).toBe("tengo-cupon");
  });
});

describe("el paso del premio: el acceso premio activa la cuenta", () => {
  it.each([["premio"], ["entrada"], ["entrada-con-lista"], ["sello"], ["sorteo"]] as const)(
    "con el acceso premio confirmado y la cuenta sin activar, con para %s, ofrece Activar mi cuenta",
    (para) => {
      const entrada: EntradaVista = { ...base, para, acceso: servidor({ estado: "con", por: "premio" }) };
      const vista = vistaDe(entrada);
      expect(vista.principal).toEqual({ accion: "activar", clave: "clActivarBoton", apagado: false });
      expect(activarPermitido(entrada)).toBe(true);
      expect(faltaElAcceso(entrada)).toBe(false);
    },
  );

  it("con el acceso premio y pidiendo cupón, para premio no se pide cupón", () => {
    const entrada = premio({}, servidor({ estado: "con", por: "premio", pideCupon: true }));
    expect(faltaElAcceso(entrada)).toBe(false);
    expect(vistaDe(entrada).principal?.accion).toBe("activar");
  });

  it("con la cuenta ya activada y cero sorteos, sigue con proteger sin pedir sorteos ni cupón ni compra", () => {
    const vista = v({ activacion: "lista" }, servidor());
    expect(vista.cajas.map((c) => c.titulo)).not.toContain("altaTituloSorteos");
    expect(vista.cajas.map((c) => [c.parte, c.estado, c.abierta])).toEqual([
      ["activar", "lista", false],
      ["proteger", "falta", true],
    ]);
    for (const a of ["tengo-cupon", "comprar", "usar-cupon", "activar"]) expect(acciones(vista)).not.toContain(a);
    const protegida = v({ activacion: "lista", proteccion: "lista" }, servidor());
    expect(protegida.final).toBe(true);
  });

  it("con la cuenta activada, para entrada y el servidor sin acceso, todo sigue como hoy", () => {
    const vista = vistaDe({ ...base, activacion: "lista", acceso: servidor() });
    expect(vista.cajas[0]?.titulo).toBe("altaTituloSorteos");
    expect(vista.principal?.accion).toBe("tengo-cupon");
  });
});

describe("con el premio, en toda la muestra, nunca hay salida a Prueba", () => {
  const ACCESOS: AccesoEnLaVista[] = [
    ACCESO_LIBRE,
    { ...ACCESO_LIBRE, modo: "cerrado" },
    servidor(),
    servidor({ estado: "revisando" }),
    servidor({ estado: "con", por: "premio" }),
    servidor({ estado: "con", por: "cupon", pideCupon: true }),
    servidor({ estado: "error", error: { clave: "altaErrServicio" }, arreglo: "probar" }),
    servidor({ pago: pagoInicial("es", PAQUETE) }),
  ];

  it("la salida a Prueba no está, Cerrar sesión sí, y ninguna acción lleva a Prueba", () => {
    for (const acceso of ACCESOS)
      for (const activacion of ["lista", "falta", "fallo"] as const)
        for (const proteccion of ["falta", "aparato-nuevo", "sin-forma"] as const)
          for (const puedePasarAPrueba of [true, false]) {
            const vista = vistaDe({ ...base, para: "premio", activacion, proteccion, puedePasarAPrueba, correoConfirmado: true, acceso });
            const dato = JSON.stringify({ activacion, proteccion, puedePasarAPrueba, acceso });
            expect(vista.salidas?.prueba, dato).toBeNull();
            expect(vista.salidas?.cerrar.apagado, dato).toBe(false);
            expect(vista.notas, dato).toEqual([]);
            expect(acciones(vista), dato).not.toContain("pasar-a-prueba");
          }
  });
});

describe("la entrada del premio no salta el acceso", () => {
  const SIN_CONFIRMAR: Array<[string, AccesoEnLaVista]> = [
    ["ninguno", servidor()],
    ["revisando", servidor({ estado: "revisando" })],
    ["error y probar", servidor({ estado: "error", error: { clave: "altaErrServicio" }, arreglo: "probar" })],
    ["error y entrar", servidor({ estado: "error", error: { clave: "clErrSesion" }, arreglo: "entrar" })],
    ["error en otra cuenta", servidor({ estado: "error", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" })],
  ];

  it.each(PARAS.flatMap((p) => SIN_CONFIRMAR.map(([n, a]) => [p, n, a] as const)))(
    "con para %s y el servidor en %s, nada activa una cuenta sin activar",
    (para, _n, acceso) => {
      for (const e of sinActivar(para, acceso)) {
        const vista = vistaDe(e);
        expect(acciones(vista), JSON.stringify(e)).not.toContain("activar");
        expect(activarPermitido(e), JSON.stringify(e)).toBe(false);
      }
    },
  );

  it("el control: con el acceso confirmado, la tabla sí ofrece Activar en los cinco para", () => {
    // Si esto no pasara, la tabla de arriba no distinguiría el código bueno del roto.
    for (const para of PARAS) {
      const e: EntradaVista = { ...base, para, acceso: servidor({ estado: "con", por: "premio" }) };
      expect(faltaElAcceso(e), para).toBe(false);
      expect(vistaDe(e).principal?.accion, para).toBe("activar");
      expect(activarPermitido(e), para).toBe(true);
    }
  });

  it("sin el acceso confirmado, faltaElAcceso es verdadero con la cuenta sin activar en los cinco para", () => {
    for (const para of PARAS) expect(faltaElAcceso({ ...base, para, acceso: servidor() }), para).toBe(true);
  });
});
