import { describe, expect, it } from "vitest";
import { ACCESO_LIBRE, type AccesoEnLaVista, type EntradaVista, activarPermitido, faltaElAcceso, vistaDe } from "./cuenta-lista-estado";

/**
 * «Dejá tu cuenta lista» con el cobro por uso del modo Oficial (W3 y W7), sin DOM. Lo que no se negocia:
 * - en la red principal, «Activar» existe solo con el acceso confirmado por el servidor (o en el build del plan B1);
 * - sin el acceso, la parte 1 es la caja del cupón, aunque la cuenta ya esté activada y protegida;
 * - una sola principal en cada fila, y las salidas a la vista en todas;
 * - nada del pago a la vista.
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
const SERVIDOR: AccesoEnLaVista = { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno" };
const conAcceso = (o: Partial<AccesoEnLaVista> = {}): AccesoEnLaVista => ({ ...SERVIDOR, ...o });
const v = (o: Partial<EntradaVista> = {}, a: Partial<AccesoEnLaVista> = {}) => vistaDe({ ...base, ...o, acceso: conAcceso(a) });
const CUPON = "K7M2-9QXA-4HTR";

/** Todas las acciones a la vista: la principal y las de las cajas. */
const acciones = (vista: ReturnType<typeof vistaDe>): string[] => [vista.principal?.accion ?? "", ...vista.cajas.flatMap((c) => c.secundarios.map((s) => s.accion))].filter(Boolean);

/** Una muestra amplia: cada estado de la cuenta, con cada cosa que corre y cada forma del acceso. */
function todas(): EntradaVista[] {
  const out: EntradaVista[] = [];
  const accesos: Partial<AccesoEnLaVista>[] = [
    { estado: "revisando" },
    { estado: "ninguno" },
    { estado: "ninguno", cuponEnMano: CUPON },
    { estado: "ninguno", escribiendo: true },
    { estado: "ninguno", escribiendo: true, campoOk: true },
    { estado: "ninguno", escribiendo: true, campoOk: true, error: { clave: "altaErrNoExiste" } },
    { estado: "ninguno", cuponEnMano: CUPON, error: { clave: "altaErrServicio" } },
    { estado: "ninguno", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" },
    { estado: "ninguno", error: { clave: "clErrSesion" }, arreglo: "entrar" },
    { estado: "error", error: { clave: "altaErrServicio" } },
    { estado: "error", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" },
    { estado: "con", canjeado: 3, cadena: true },
    { estado: "con", canjeado: 3, fallaTrasCanje: true },
    { estado: "con", por: "cupon" },
    { estado: "con", por: "admin", pideCupon: true },
    { estado: "con", por: "cupon", pideCupon: true, escribiendo: true },
  ];
  for (const activacion of ["lista", "falta", "preparando", "fallo", "no-se-sabe"] as const)
    for (const proteccion of ["lista", "falta", "aparato-nuevo", "sin-forma"] as const)
      for (const corre of [null, "revisando", "activando", "canjeando"] as const)
        for (const puedePasarAPrueba of [true, false])
          for (const a of accesos) out.push({ ...base, activacion, proteccion, corre, puedePasarAPrueba, correoConfirmado: true, acceso: conAcceso(a) });
  return out;
}

describe("W3: activar falla cerrado en la red principal", () => {
  it("sin acceso confirmado, ninguna fila ofrece «Activar»: ni de principal ni de secundaria", () => {
    for (const e of todas()) {
      // Con el acceso confirmado y nada del cupón pendiente, «Activar» puede estar: es lo que se pide.
      if (e.acceso?.estado === "con" && !faltaElAcceso(e)) continue;
      expect(acciones(vistaDe(e)), JSON.stringify(e)).not.toContain("activar");
    }
  });

  it("sin el acceso por cupón en el build (cerrado), tampoco: nunca hay «Activar»", () => {
    for (const activacion of ["falta", "preparando", "fallo", "no-se-sabe", "lista"] as const)
      for (const corre of [null, "revisando", "activando"] as const)
        for (const puedePasarAPrueba of [true, false]) {
          const e: EntradaVista = { ...base, activacion, corre, puedePasarAPrueba, acceso: { ...ACCESO_LIBRE, modo: "cerrado" } };
          expect(acciones(vistaDe(e)), JSON.stringify(e)).not.toContain("activar");
          expect(activarPermitido(e)).toBe(false);
        }
  });

  it("cerrado dice algo cierto (ahora no se activan cuentas nuevas) y deja las salidas: «Pasar a Prueba» de principal", () => {
    const vista = vistaDe({ ...base, acceso: { ...ACCESO_LIBRE, modo: "cerrado" } });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["clErrServicio"]);
    expect(vista.cajas[0]?.abierta).toBe(true);
    expect(vista.principal?.accion).toBe("pasar-a-prueba");
    expect(vista.salidas?.cerrar.apagado).toBe(false);
    // Desde el sorteo, sin poder cambiar de modo: ninguna principal que no haga nada, y «Cerrar sesión» a la vista.
    const bloqueado = vistaDe({ ...base, puedePasarAPrueba: false, acceso: { ...ACCESO_LIBRE, modo: "cerrado" } });
    expect(bloqueado.principal).toBeNull();
    expect(bloqueado.salidas?.prueba).toEqual({ apagado: true });
    expect(bloqueado.salidas?.cerrar.apagado).toBe(false);
  });

  it("cerrado y con la cuenta ya activada, la parte 1 está lista: proteger sigue como siempre", () => {
    const vista = vistaDe({ ...base, activacion: "lista", acceso: { ...ACCESO_LIBRE, modo: "cerrado" } });
    expect(vista.cajas[0]?.estado).toBe("lista");
    expect(vista.cajas[1]?.abierta).toBe(true);
  });

  it("con el acceso confirmado, «Activar mi cuenta» vuelve, con el texto de por qué no se paga", () => {
    expect(v({}, { estado: "con", por: "cupon" }).principal).toMatchObject({ accion: "activar", clave: "clActivarBoton", apagado: false });
    expect(v({}, { estado: "con", por: "cupon" }).cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaActivarCupon"]);
    expect(v({}, { estado: "con", por: "pago" }).cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaActivarPago"]);
    expect(v({}, { estado: "con", por: "admin" }).cajas[0]?.textos.map((x) => x.clave)).toEqual(["clActivarTexto"]);
    expect(activarPermitido({ corre: null, acceso: conAcceso({ estado: "con", por: "cupon" }) })).toBe(true);
  });

  it("libre (fuera de la red principal, o el plan B1) es el paso de siempre", () => {
    const vista = vistaDe({ ...base, acceso: { ...ACCESO_LIBRE } });
    expect(vista.principal).toMatchObject({ accion: "activar", clave: "clActivarBoton" });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["clActivarTexto"]);
    expect(vistaDe({ ...base, acceso: { ...ACCESO_LIBRE } })).toEqual(vistaDe(base));
  });
});

describe("W7: la caja del acceso es la parte 1", () => {
  it("una sola principal en cada fila, como mucho una caja abierta, y nunca el final sin el acceso", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      expect(vista.cajas.filter((c) => c.abierta).length, JSON.stringify(e)).toBeLessThanOrEqual(1);
      if (faltaElAcceso(e)) {
        expect(vista.final, JSON.stringify(e)).toBe(false);
        expect(vista.cajas.find((c) => c.parte === "activar")?.estado, JSON.stringify(e)).not.toBe("lista");
      }
    }
  });

  it("las salidas están a la vista en todas las filas sin el acceso, y nunca apagadas por algo que corre", () => {
    for (const e of todas()) {
      if (!faltaElAcceso(e)) continue;
      const vista = vistaDe(e);
      expect(vista.salidas, JSON.stringify(e)).not.toBeNull();
      expect(vista.salidas?.cerrar.apagado).toBe(false);
      if (vista.salidas?.prueba) expect(vista.salidas.prueba.apagado).toBe(!e.puedePasarAPrueba);
      else expect(vista.principal?.accion).toBe("pasar-a-prueba");
    }
  });

  it("nada del pago a la vista: ni «3 sorteos oficiales por 2 dólares» ni sus textos", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      const claves = [vista.principal?.clave, vista.bajada, ...vista.cajas.flatMap((c) => [c.titulo, ...c.textos.map((x) => x.clave), ...(c.cierre ?? []).map((x) => x.clave), ...(c.error ?? []).map((x) => x.clave), ...c.secundarios.map((s) => s.clave)])];
      for (const k of claves) expect(String(k), JSON.stringify(e)).not.toMatch(/^(altaPrimerPaquete|pago|cupoOfSumar|clBajadaConPago)/);
    }
  });

  it("hay un cupón: «Activar con mi cupón», con el cupón a la vista y «Usar otro cupón» de texto", () => {
    const vista = v({}, { cuponEnMano: CUPON });
    const caja = vista.cajas[0];
    expect(caja?.titulo).toBe("clActivarTitulo");
    expect(caja?.textos).toEqual([{ clave: "altaTexto" }, { clave: "altaCuponListo", vars: { codigo: CUPON } }]);
    expect(vista.principal).toMatchObject({ accion: "usar-cupon", clave: "altaActivarConCupon", apagado: false });
    expect(caja?.secundarios).toHaveLength(1);
    expect(caja?.secundarios[0]).toMatchObject({ accion: "otro-cupon", clave: "altaOtroCupon", forma: "texto" });
    expect(caja?.cierre?.map((x) => x.clave)).toEqual(["altaNoTengo"]);
  });

  it("sin cupón (y sin pago): «Tengo un cupón», que abre el campo", () => {
    const vista = v();
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaTexto"]);
    expect(vista.principal).toMatchObject({ accion: "tengo-cupon", clave: "altaTengoCupon", apagado: false });
    expect(vista.cajas[0]?.secundarios).toEqual([]);
    expect(vista.cajas[0]?.cierre?.map((x) => x.clave)).toEqual(["altaNoTengo"]);
    expect(vista.cajas[0]?.campo).toBeNull();
  });

  it("escribiendo: el campo, «Activar con mi cupón» apagada hasta 12 letras y números, y «Volver» de texto", () => {
    const vacio = v({}, { escribiendo: true });
    expect(vacio.cajas[0]?.campo).toBe("cupon");
    expect(vacio.principal).toMatchObject({ accion: "usar-cupon", clave: "altaActivarConCupon", apagado: true });
    expect(vacio.principal?.ocupado).toBeFalsy();
    expect(vacio.cajas[0]?.secundarios.map((s) => [s.accion, s.clave, s.forma])).toEqual([["volver-cupon", "clVolver", "texto"]]);
    expect(vacio.cajas[0]?.cierre?.map((x) => x.clave)).toEqual(["altaNoTengo"]);
    expect(v({}, { escribiendo: true, campoOk: true }).principal).toMatchObject({ accion: "usar-cupon", apagado: false });
  });

  it("revisando el cupón: la principal gira y dice «Revisando tu cupón…», y lo demás de la caja se apaga", () => {
    for (const a of [{ cuponEnMano: CUPON }, { escribiendo: true, campoOk: true }]) {
      const vista = v({ corre: "canjeando" }, a);
      expect(vista.principal).toMatchObject({ clave: "altaRevisando", apagado: true, ocupado: true });
      expect(vista.cajas[0]?.ocupada).toBe(true);
      expect(vista.cajas[0]?.palabra).toBe("");
      expect(vista.cajas[0]?.secundarios.every((s) => s.apagado)).toBe(true);
      expect(vista.salidas?.cerrar.apagado).toBe(false);
      expect(vista.estado?.clave).toBe("altaRevisando");
    }
  });

  it.each([
    ["altaErrNoExiste"],
    ["altaErrVencido"],
    ["altaErrAnulado"],
    ["altaErrUsado"],
    ["altaErrLote"],
    ["altaErrIntentos"],
    ["altaErrServicio"],
    ["altaErrForma"],
  ])("un error del canje (%s) se dice en la caja, y la principal vuelve a probar", (clave) => {
    const vista = v({}, { escribiendo: true, campoOk: true, error: { clave } });
    expect(vista.cajas[0]?.estado).toBe("no-salio");
    expect(vista.cajas[0]?.error?.map((x) => x.clave)).toEqual([clave]);
    expect(vista.principal).toMatchObject({ accion: "usar-cupon", apagado: false });
  });

  it("la cuenta que no coincide con su acceso no se arregla probando: «Pasar a Prueba»; sin sesión, «Entrar de nuevo»", () => {
    expect(v({}, { cuponEnMano: CUPON, error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" }).principal?.accion).toBe("pasar-a-prueba");
    expect(v({}, { cuponEnMano: CUPON, error: { clave: "clErrSesion" }, arreglo: "entrar" }).principal?.accion).toBe("entrar-de-nuevo");
    expect(v({}, { estado: "error", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" }).principal?.accion).toBe("pasar-a-prueba");
  });

  it("si no se pudo saber el acceso: «No salió», el motivo y «Probar de nuevo», que solo vuelve a preguntar", () => {
    const vista = v({}, { estado: "error", error: { clave: "altaErrServicio" } });
    expect(vista.cajas[0]?.estado).toBe("no-salio");
    expect(vista.cajas[0]?.error?.map((x) => x.clave)).toEqual(["altaErrServicio"]);
    expect(vista.principal).toMatchObject({ accion: "leer-acceso", clave: "clProbarDeNuevo" });
  });

  it("mientras se pregunta el acceso, la principal gira y no se puede tocar nada de la caja", () => {
    const vista = v({}, { estado: "revisando" });
    expect(vista.principal).toMatchObject({ clave: "clRevisando", apagado: true, ocupado: true });
    expect(vista.cajas[0]?.estado).toBe("revisando");
  });

  it("mientras se pregunta el acceso: sin aviso al principio, y a los 8 segundos dice que puede tardar", () => {
    expect(v({}, { estado: "revisando" }).estado).toBeNull();
    expect(v({ lento: true }, { estado: "revisando" }).estado?.clave).toBe("clActivarLento");
    // Con el acceso ya sabido (o con el error a la vista), `lento` solo no dice nada.
    expect(v({ lento: true }, { estado: "ninguno" }).estado).toBeNull();
    expect(v({ lento: true }, { estado: "error", error: { clave: "altaErrServicio" } }).estado).toBeNull();
  });

  it("después del canje: «Activando tu cuenta…» con lo que trae el cupón, y la principal girando", () => {
    const vista = v({ corre: "activando" }, { estado: "con", canjeado: 3, cadena: true });
    expect(vista.cajas[0]?.textos).toEqual([{ clave: "altaCuponOk", vars: { n: "3" } }]);
    expect(vista.principal).toMatchObject({ clave: "clActivarHaciendo", apagado: true, ocupado: true });
    expect(v({ corre: "activando" }, { estado: "con", canjeado: 1, cadena: true }).cajas[0]?.textos).toEqual([{ clave: "altaCuponOk1" }]);
  });

  it("si algo falla después del canje: `altaCuponGuardado` y «Probar de nuevo», que sigue sin volver a canjear", () => {
    const vista = v({}, { estado: "con", canjeado: 3, fallaTrasCanje: true });
    expect(vista.cajas[0]?.estado).toBe("no-salio");
    expect(vista.cajas[0]?.error?.map((x) => x.clave)).toEqual(["altaCuponGuardado"]);
    expect(vista.principal).toMatchObject({ accion: "seguir-cupon", clave: "clProbarDeNuevo", apagado: false });
    expect(acciones(vista)).not.toContain("usar-cupon");
  });

  it("ya activada y protegida, sin acceso: la caja del acceso igual, con `altaYaActivada`, y no el final", () => {
    const vista = v({ activacion: "lista", proteccion: "lista" });
    expect(vista.final).toBe(false);
    expect(vista.bajada).toBe("altaBajadaUnPaso");
    const caja = vista.cajas[0];
    expect(caja?.titulo).toBe("altaTituloSorteos");
    expect(caja?.abierta).toBe(true);
    expect(caja?.textos.map((x) => x.clave)).toEqual(["altaYaActivada"]);
    expect(vista.principal).toMatchObject({ accion: "tengo-cupon", clave: "altaTengoCupon" });
    expect(vista.cajas[1]?.estado).toBe("lista");
    // Con un cupón en mano, la principal no habla de activar: la cuenta ya lo está.
    expect(v({ activacion: "lista", proteccion: "lista" }, { cuponEnMano: CUPON }).principal).toMatchObject({ accion: "usar-cupon", clave: "cupoOfUsarCupon" });
  });

  it("ya activada y sin proteger, sin acceso: primero el acceso, y proteger espera", () => {
    const vista = v({ activacion: "lista", proteccion: "falta" });
    expect(vista.cajas.map((c) => [c.parte, c.estado])).toEqual([
      ["activar", "falta"],
      ["proteger", "espera"],
    ]);
    expect(vista.bajada).toBe("clBajada");
  });

  it("abierto para usar un cupón con acceso y sin sorteos: la caja hasta que se canjee; después, el final", () => {
    const pide = v({ activacion: "lista", proteccion: "lista", para: "sello" }, { estado: "con", por: "cupon", pideCupon: true, escribiendo: true });
    expect(pide.final).toBe(false);
    expect(pide.cajas[0]?.campo).toBe("cupon");
    const listo = v({ activacion: "lista", proteccion: "lista", para: "sello" }, { estado: "con", por: "cupon", pideCupon: false, canjeado: 3 });
    expect(listo.final).toBe(true);
    expect(listo.principal?.accion).toBe("sellar");
  });

  it("con el acceso y la cuenta lista, el final de siempre", () => {
    expect(v({ activacion: "lista", proteccion: "lista" }, { estado: "con", por: "cupon" }).final).toBe(true);
  });

  it("otro celular u otra compu: confirmar que es la persona va primero, y el acceso después", () => {
    const vista = v({ activacion: "lista", proteccion: "aparato-nuevo", correoConfirmado: true });
    expect(vista.cajas.map((c) => [c.parte, c.titulo, c.estado])).toEqual([
      ["proteger", "clAparatoTitulo", "falta"],
      ["activar", "altaTituloSorteos", "espera"],
    ]);
  });
});

describe("«Usar un cupón» con la cuenta ya lista", () => {
  it("se puede volver a la página: «Volver» cierra el paso, y el campo no repite otro «Volver»", () => {
    for (const para of ["sello", "sorteo"] as const)
      for (const estado of ["con", "ninguno"] as const)
        for (const a of [{ escribiendo: true }, { escribiendo: true, campoOk: true }, { escribiendo: true, error: { clave: "altaErrNoExiste" } }, { cuponEnMano: CUPON }, {}] as Partial<AccesoEnLaVista>[]) {
          const vista = v({ activacion: "lista", proteccion: "lista", para }, { estado, por: estado === "con" ? "cupon" : null, pideCupon: true, ...a });
          const quien = JSON.stringify({ para, estado, a });
          expect(vista.final, quien).toBe(false);
          expect(vista.volver, quien).toMatchObject({ accion: "volver", clave: "clVolver" });
          expect(acciones(vista), quien).not.toContain("volver-cupon");
          // Las salidas de siempre siguen ahí.
          expect(vista.salidas?.cerrar.apagado, quien).toBe(false);
        }
  });

  it("con la cuenta a medias, sin haber pedido un cupón, al entrar o mientras se canjea, sigue sin «Volver»", () => {
    const pide = { estado: "con", pideCupon: true, escribiendo: true } as Partial<AccesoEnLaVista>;
    expect(v({ activacion: "falta", proteccion: "lista", para: "sello" }, pide).volver).toBeNull();
    expect(v({ activacion: "lista", proteccion: "falta", para: "sello" }, pide).volver).toBeNull();
    expect(v({ activacion: "lista", proteccion: "lista", para: "sello" }, { estado: "ninguno" }).volver).toBeNull();
    expect(v({ activacion: "lista", proteccion: "lista", para: "sello" }, { estado: "ninguno", escribiendo: true }).volver).toBeNull();
    expect(v({ activacion: "lista", proteccion: "lista", para: "entrada" }, pide).volver).toBeNull();
    expect(v({ activacion: "lista", proteccion: "lista", para: "sello", corre: "canjeando" }, pide).volver).toBeNull();
    expect(v({ activacion: "lista", proteccion: "lista", para: "sello" }, { ...pide, canjeado: 3, cadena: true }).volver).toBeNull();
    // Sin «Volver», el campo conserva el suyo, que vuelve a «Tengo un cupón».
    expect(acciones(v({ activacion: "lista", proteccion: "lista", para: "sello" }, { estado: "ninguno", escribiendo: true }))).toContain("volver-cupon");
  });
});

