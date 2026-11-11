import { describe, expect, it } from "vitest";
import { type EntradaVista, type Para, vistaDe } from "./cuenta-lista-estado";

/**
 * Qué muestra «Dejá tu cuenta lista» en cada estado (`vistaDe`), sin DOM. Las reglas que no se negocian: una sola acción
 * principal, nunca la del final sin las dos partes listas, las salidas a la vista y nunca apagadas por algo que corre,
 * otro celular u otra compu confirma primero y por correo, y en la compu la principal de proteger es el correo.
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
const v = (o: Partial<EntradaVista> = {}) => vistaDe({ ...base, ...o });
const FINAL = new Set(["seguir", "sellar", "sortear"]);

/** Una muestra amplia de entradas: cada estado con cada cosa que puede estar corriendo. */
function todas(): EntradaVista[] {
  const out: EntradaVista[] = [];
  for (const activacion of ["lista", "falta", "preparando", "fallo", "no-se-sabe"] as const)
    for (const proteccion of ["lista", "falta", "aparato-nuevo", "sin-forma", "no-se-sabe"] as const)
      for (const corre of [null, "revisando", "activando", "esperando", "desbloqueo", "mandando", "confirmando"] as const)
        for (const celular of [true, false])
          for (const falla of [null, "red", "tope", "codigo-malo", "desbloqueo"] as const)
            out.push({ ...base, activacion, proteccion, corre, celular, falla, correoConfirmado: true, codigo: falla === "codigo-malo" ? { a: "x", segundos: 3 } : null });
  return out;
}

describe("vistaDe: lo que vale siempre", () => {
  it("hay como mucho una principal, y la del final solo con las dos partes listas", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      const lista = e.activacion === "lista" && e.proteccion === "lista";
      if (vista.principal && FINAL.has(vista.principal.accion)) expect(lista, JSON.stringify(e)).toBe(true);
      if (!lista) expect(vista.final).toBe(false);
      // Como mucho una caja abierta.
      expect(vista.cajas.filter((c) => c.abierta).length).toBeLessThanOrEqual(1);
    }
  });

  it("las salidas están a la vista hasta el final y nunca se apagan por algo que corre", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      if (vista.final) {
        expect(vista.salidas).toBeNull();
        continue;
      }
      expect(vista.salidas).not.toBeNull();
      expect(vista.salidas?.cerrar.apagado).toBe(false);
      // «Pasar a Prueba» está, o es la principal.
      if (vista.salidas?.prueba) expect(vista.salidas.prueba.apagado).toBe(false);
      else expect(vista.principal?.accion).toBe("pasar-a-prueba");
    }
  });

  it("nunca hay «Ahora no», ni una acción que cierre y siga en Oficial sin la cuenta lista", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      if (vista.final) continue;
      expect(vista.volver).toBeNull();
      const acciones = [vista.principal?.accion, ...vista.cajas.flatMap((c) => c.secundarios.map((s) => s.accion))];
      for (const a of acciones) expect(["seguir", "sellar", "sortear", "volver"]).not.toContain(a);
    }
  });
});

describe("vistaDe: activar", () => {
  it("cuenta nueva: activar primero y abierta, proteger después y cerrada", () => {
    const vista = v();
    expect(vista.cajas.map((c) => [c.parte, c.estado, c.abierta])).toEqual([
      ["activar", "falta", true],
      ["proteger", "espera", false],
    ]);
    expect(vista.principal).toMatchObject({ accion: "activar", clave: "clActivarBoton", apagado: false });
    expect(vista.titulo).toBe("clTitulo");
  });

  it("mientras activa: la principal apagada dice lo que pasa, y a los 8 segundos que puede tardar", () => {
    expect(v({ corre: "activando" }).principal).toMatchObject({ clave: "clActivarHaciendo", apagado: true });
    expect(v({ corre: "activando" }).estado?.clave).toBe("clActivarHaciendo");
    expect(v({ corre: "activando", lento: true }).estado?.clave).toBe("clActivarLento");
  });

  it("mientras algo corre en una caja, la caja no repite la palabra: lo dice la principal apagada", () => {
    const ocupadas = [
      v({ corre: "activando" }),
      v({ corre: "revisando" }),
      v({ activacion: "preparando" }),
      v({ activacion: "lista", corre: "desbloqueo", celular: true, hayDesbloqueo: true }),
      v({ activacion: "lista", corre: "confirmando", codigo: { a: "n•••@gmail.com", segundos: 3 }, campoOk: true }),
    ];
    for (const vista of ocupadas) {
      const caja = vista.cajas.find((c) => c.ocupada);
      expect(caja?.palabra).toBe("");
      expect(vista.principal?.apagado).toBe(true);
      expect(vista.principal?.ocupado).toBe(true);
    }
    // Sin nada corriendo, cada caja dice su palabra.
    expect(v().cajas.map((c) => c.palabra)).toEqual(["clEstadoFalta", "clEstadoEspera"]);
  });

  it("apagada porque corre lo suyo no es lo mismo que apagada porque falta escribir", () => {
    // Corre: «Activando…», «Mandando…».
    expect(v({ corre: "activando" }).principal?.ocupado).toBe(true);
    expect(v({ activacion: "lista", celular: false, corre: "mandando" }).principal).toMatchObject({ clave: "protEnviando", apagado: true, ocupado: true });
    // Falta escribir: «Confirmar» sin el código, «Mandarme un código» sin el correo.
    const sinCodigo = v({ activacion: "lista", celular: false, codigo: { a: "n•••@gmail.com", segundos: 3 } }).principal;
    expect(sinCodigo).toMatchObject({ clave: "protCodeGo", apagado: true });
    expect(sinCodigo?.ocupado).toBeFalsy();
    expect(v({ activacion: "lista", hayDesbloqueo: false, correoSesion: "" }).principal?.ocupado).toBeFalsy();
    // Prendida, nunca ocupada.
    for (const e of todas()) {
      const p = vistaDe(e).principal;
      if (p && !p.apagado) expect(p.ocupado, JSON.stringify(e)).toBeFalsy();
    }
  });

  it("revisando o preparando: «Revisando…» y la principal apagada", () => {
    for (const e of [{ corre: "revisando" as const }, { activacion: "preparando" as const }]) {
      const vista = v(e);
      expect(vista.cajas[0]?.estado).toBe("revisando");
      expect(vista.principal).toMatchObject({ clave: "clRevisando", apagado: true });
    }
  });

  it.each([
    ["red", "clErrRed", "leer"],
    ["tarda", "clErrTarda", "leer"],
    ["fallo", "clErrFallo", "leer"],
    ["rara", "clErrRara", "leer"],
    ["servicio", "clErrServicio", "leer"],
    ["sin-pedido", "clErrSinPedido", "leer"],
    ["tope", "clErrTope", "salir-y-entrar"],
    ["sin-pedido-fin", "clErrSinPedidoFin", "salir-y-entrar"],
    ["sesion", "clErrSesion", "entrar-de-nuevo"],
  ] as const)("con la falla %s: «No salió», su mensaje y su arreglo", (falla, clave, accion) => {
    const vista = v({ falla });
    expect(vista.cajas[0]?.estado).toBe("no-salio");
    expect(vista.cajas[0]?.error?.[0]?.clave).toBe(clave);
    expect(vista.principal?.accion).toBe(accion);
  });

  it("«Probar de nuevo» solo lee: nunca es la acción de votar", () => {
    for (const falla of ["red", "tarda", "fallo", "rara", "servicio", "sin-pedido"] as const) expect(v({ falla }).principal?.accion).toBe("leer");
  });

  it("lo que dijo «rara» lleva el contacto", () => {
    expect(v({ falla: "rara" }).cajas[0]?.error?.map((x) => x.clave)).toEqual(["clErrRara", "clContacto"]);
  });
});

describe("vistaDe: proteger", () => {
  const protegerVista = (o: Partial<EntradaVista> = {}) => v({ activacion: "lista", ...o });

  it("en el celular con desbloqueo, la principal es el desbloqueo y el correo va abajo", () => {
    const vista = protegerVista();
    expect(vista.principal).toMatchObject({ accion: "desbloqueo", clave: "clDesbloqueoCel" });
    const caja = vista.cajas[1];
    expect(caja?.textos.map((x) => x.clave)).toEqual(["clProtegerTextoCel", "clDesbloqueoAyudaCel"]);
    expect(caja?.secundarios[0]).toMatchObject({ accion: "mandar-codigo", clave: "clMandarA", vars: { mail: "n•••@gmail.com" }, raya: "clCorreoO" });
  });

  it("en la compu, la principal es el correo y el desbloqueo va como secundario", () => {
    const vista = protegerVista({ celular: false });
    expect(vista.principal).toMatchObject({ accion: "mandar-codigo", clave: "clMandarA" });
    const sec = vista.cajas[1]?.secundarios ?? [];
    expect(sec.map((s) => s.accion)).toEqual(["otro-correo", "desbloqueo"]);
    // «Mandar el código a otro correo»: todavía no se leyó a qué correo va la principal.
    expect(sec[0]).toMatchObject({ clave: "clOtroCorreo", forma: "texto" });
    // El desbloqueo dice qué es, debajo de su botón.
    expect(sec[1]).toMatchObject({ clave: "clDesbloqueoCompu", raya: "clOSiPreferis", ayuda: { clave: "clDesbloqueoAyudaCompu" } });
    expect(vista.cajas[1]?.textos.map((x) => x.clave)).toEqual(["clProtegerTextoCompu"]);
  });

  it("el desbloqueo nunca aparece sin decir qué es", () => {
    for (const e of todas()) {
      for (const hayDesbloqueo of [true, false])
        for (const tieneLlaves of [true, false]) {
          const vista = vistaDe({ ...e, hayDesbloqueo, tieneLlaves });
          for (const caja of vista.cajas) {
            const ayudaEnLaCaja = caja.textos.some((x) => x.clave.startsWith("clDesbloqueoAyuda"));
            for (const s of caja.secundarios.filter((x) => x.accion === "desbloqueo")) expect(s.ayuda?.clave, JSON.stringify(e)).toMatch(/^clDesbloqueoAyuda/);
            if (caja.abierta && vista.principal?.accion === "desbloqueo" && !vista.principal.apagado) expect(ayudaEnLaCaja, JSON.stringify(e)).toBe(true);
          }
        }
    }
    // Con el código mandado, también.
    const codigo = v({ activacion: "lista", celular: false, codigo: { a: "n•••@gmail.com", segundos: 3 } });
    expect(codigo.cajas[1]?.secundarios.find((s) => s.accion === "desbloqueo")?.ayuda?.clave).toBe("clDesbloqueoAyudaCompu");
  });

  it("si el desbloqueo falló, el correo pasa a ser lo principal", () => {
    const vista = protegerVista({ desbloqueoFallo: true, falla: "desbloqueo" });
    expect(vista.principal?.accion).toBe("mandar-codigo");
    expect(vista.cajas[1]?.error?.[0]?.clave).toBe("clDesbloqueoFalla");
    expect(vista.cajas[1]?.estado).toBe("no-salio");
  });

  it("si el navegador no deja abrir el desbloqueo, una nota (no un error) y el correo primero", () => {
    const vista = protegerVista({ desbloqueoFallo: true, falla: "desbloqueo-bloqueado" });
    expect(vista.cajas[1]?.nota?.clave).toBe("protPasskeyBloqueada");
    expect(vista.cajas[1]?.error).toBeNull();
    expect(vista.principal?.accion).toBe("mandar-codigo");
  });

  it("sin desbloqueo, el correo; sin correo en la sesión, el campo y «Mandarme un código» apagado hasta que tenga forma", () => {
    expect(protegerVista({ hayDesbloqueo: false }).principal?.accion).toBe("mandar-codigo");
    const sinCorreo = protegerVista({ hayDesbloqueo: false, correoSesion: "" });
    expect(sinCorreo.cajas[1]?.campo).toBe("correo");
    expect(sinCorreo.principal).toMatchObject({ accion: "mandar-a-mano", clave: "protMailGo", apagado: true });
    expect(protegerVista({ hayDesbloqueo: false, correoSesion: "", campoOk: true }).principal?.apagado).toBe(false);
  });

  it("«Usar otro correo» cambia el botón por el campo", () => {
    const vista = protegerVista({ celular: false, eligioCorreo: true, campoOk: true });
    expect(vista.cajas[1]?.campo).toBe("correo");
    expect(vista.principal?.accion).toBe("mandar-a-mano");
    expect(vista.cajas[1]?.secundarios.map((s) => s.accion)).not.toContain("otro-correo");
  });

  it("con el código mandado: «Mirá tu correo», el campo, «Confirmar» apagado con menos de 4, y otro código recién a los 30 segundos", () => {
    const a = protegerVista({ celular: false, codigo: { a: "n•••@gmail.com", segundos: 5 } });
    expect(a.cajas[1]?.titulo).toBe("protCodeTitulo");
    expect(a.cajas[1]?.campo).toBe("codigo");
    expect(a.principal).toMatchObject({ accion: "confirmar-codigo", clave: "protCodeGo", apagado: true });
    expect(a.cajas[1]?.secundarios[0]).toMatchObject({ accion: "otro-codigo", clave: "clOtroCodigoEn", vars: { s: "25" }, apagado: true });
    expect(a.cajas[1]?.textos.map((x) => x.clave)).toEqual(["protCodeLead", "clCorreoLlega"]);
    const b = protegerVista({ celular: false, codigo: { a: "x", segundos: 21 }, campoOk: true });
    expect(b.cajas[1]?.textos.map((x) => x.clave)).toContain("clCorreoSpam");
    expect(b.principal?.apagado).toBe(false);
    const c = protegerVista({ celular: false, codigo: { a: "x", segundos: 31 } });
    expect(c.cajas[1]?.secundarios[0]).toMatchObject({ accion: "otro-codigo", clave: "protOtroCodigo", apagado: false });
  });

  it("si entró con su correo, se aclara que es otro código", () => {
    const vista = protegerVista({ entroConCorreo: true, codigo: { a: "x", segundos: 1 } });
    expect(vista.cajas[1]?.textos.map((x) => x.clave)).toContain("clCorreoOtroCodigo");
  });

  it("el código vencido o de antes de recargar: la principal pide otro", () => {
    for (const falla of ["codigo-vencido", "codigo-viejo"] as const) {
      const vista = protegerVista({ codigo: { a: "x", segundos: 40 }, falla });
      expect(vista.principal).toMatchObject({ accion: "otro-codigo", clave: "protOtroCodigo" });
    }
    const malo = protegerVista({ codigo: { a: "x", segundos: 3 }, falla: "codigo-malo", campoOk: true });
    expect(malo.principal?.accion).toBe("confirmar-codigo");
    expect(malo.cajas[1]?.error?.[0]?.clave).toBe("protBadCode");
  });

  it("la página se recargó con un código mandado: lo dice y ofrece mandar otro", () => {
    const vista = protegerVista({ codigoRecargado: true });
    expect(vista.cajas[1]?.nota?.clave).toBe("clCodigoRecargado");
    expect(vista.principal?.accion).toBe("mandar-codigo");
  });

  it("la nota de salir sin proteger solo si falta proteger y este es el único navegador", () => {
    expect(protegerVista().notas).toEqual(["clSalirAvisoCel", "clAPruebaNota"]);
    expect(protegerVista({ celular: false }).notas[0]).toBe("clSalirAvisoCompu");
    expect(protegerVista({ unicoNavegador: false }).notas).toEqual(["clAPruebaNota"]);
  });
});

describe("vistaDe: otro celular u otra compu", () => {
  const aparato = (o: Partial<EntradaVista> = {}) => v({ proteccion: "aparato-nuevo", correoConfirmado: true, correoCuenta: "c•••@mail.com", unicoNavegador: false, ...o });

  it("confirmar que es la persona va primero, y activar después", () => {
    const vista = aparato();
    expect(vista.cajas.map((c) => [c.parte, c.numero, c.estado])).toEqual([
      ["proteger", 1, "falta"],
      ["activar", 2, "espera"],
    ]);
    expect(vista.cajas[0]?.titulo).toBe("clAparatoTitulo");
  });

  it("siempre por el correo de la cuenta, también en el celular con desbloqueo", () => {
    const vista = aparato({ tieneLlaves: true });
    expect(vista.principal).toMatchObject({ accion: "mandar-codigo", clave: "clMandarA", vars: { mail: "c•••@mail.com" } });
    expect(vista.cajas[0]?.secundarios.map((s) => s.accion)).toEqual(["desbloqueo"]);
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["clAparatoTextoCel", "clAparatoAjenoCel"]);
    // Sin llaves guardadas, el desbloqueo no se ofrece: no hay con qué.
    expect(aparato({ tieneLlaves: false }).cajas[0]?.secundarios).toEqual([]);
    // Sin campo para escribir otro correo.
    expect(aparato().cajas[0]?.campo).toBeNull();
  });

  it("con la cuenta ya activada, después de confirmar no queda nada", () => {
    expect(aparato({ activacion: "lista", proteccion: "lista" }).final).toBe(true);
  });
});

describe("vistaDe: sin forma desde acá", () => {
  it("dice qué hacer, y la principal es «Pasar a Prueba» (o ninguna si no se puede)", () => {
    const vista = v({ activacion: "lista", proteccion: "sin-forma", unicoNavegador: false });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["clSinForma", "clSinFormaPista", "clContacto"]);
    expect(vista.principal?.accion).toBe("pasar-a-prueba");
    expect(vista.salidas?.prueba).toBeNull();
    const bloqueado = v({ activacion: "lista", proteccion: "sin-forma", puedePasarAPrueba: false });
    expect(bloqueado.principal).toBeNull();
    expect(bloqueado.salidas?.prueba).toEqual({ apagado: true });
  });
});

describe("vistaDe: las salidas", () => {
  it("desde el sorteo, «Pasar a Prueba» a la vista pero apagado, con la nota de por qué", () => {
    const vista = v({ puedePasarAPrueba: false, para: "sorteo" });
    expect(vista.salidas?.prueba).toEqual({ apagado: true });
    expect(vista.notas).toContain("modeSwitchBlocked");
    expect(vista.salidas?.cerrar.apagado).toBe(false);
  });

  it("mientras corre algo, las salidas siguen prendidas", () => {
    for (const corre of ["activando", "esperando", "desbloqueo", "mandando", "confirmando", "revisando"] as const) {
      const vista = v({ corre, activacion: corre === "activando" || corre === "esperando" ? "falta" : "lista" });
      expect(vista.salidas?.prueba?.apagado, corre).toBe(false);
      expect(vista.salidas?.cerrar.apagado, corre).toBe(false);
    }
  });
});

describe("vistaDe: el final", () => {
  it.each([
    ["entrada", "seguir", "clSeguir", false],
    ["entrada-con-lista", "sellar", "freeze", true],
    ["sello", "sellar", "freeze", true],
    ["sorteo", "sortear", "draw", true],
  ] as const)("abierto para %s: la principal es %s y %s «Volver»", (para, accion, clave, conVolver) => {
    const vista = v({ activacion: "lista", proteccion: "lista", para: para as Para });
    expect(vista.final).toBe(true);
    expect(vista.titulo).toBe("clListaTitulo");
    expect(vista.bajada).toBe("clListaTexto");
    expect(vista.principal).toMatchObject({ accion, clave, apagado: false });
    expect(!!vista.volver).toBe(conVolver);
    expect(vista.notas).toEqual([]);
    expect(vista.cajas.every((c) => c.estado === "lista" && !c.abierta)).toBe(true);
  });

  it("la confirmación del primer sello va arriba de «Sellar la lista» si hace falta, y nunca para el sorteo", () => {
    expect(v({ activacion: "lista", proteccion: "lista", para: "sello", primerOficialPendiente: true }).primerOficial).toBe(true);
    expect(v({ activacion: "lista", proteccion: "lista", para: "entrada-con-lista", primerOficialPendiente: true }).primerOficial).toBe(true);
    expect(v({ activacion: "lista", proteccion: "lista", para: "sorteo", primerOficialPendiente: true }).primerOficial).toBe(false);
    expect(v({ activacion: "lista", proteccion: "lista", para: "sello", primerOficialPendiente: false }).primerOficial).toBe(false);
  });
});
