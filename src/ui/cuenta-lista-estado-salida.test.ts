import { describe, expect, it } from "vitest";
import type { OrdenDePago } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import {
  ACCESO_LIBRE,
  type AccesoEnLaVista,
  type Boton,
  type CajaVista,
  type EntradaVista,
  type Vista,
  esperaDelPaso,
  pagoInicial,
  portadaDe,
  vistaDe,
} from "./cuenta-lista-estado";

/**
 * La salida de una espera larga en «Dejá tu cuenta lista», sin DOM. Cuando algo del paso gira y pasó el tiempo, la caja
 * que gira ofrece una salida y el pie dice que tarda. Lo que gira no cambia: la principal sigue igual y nada se quita.
 * Sin nada que gire, la vista no cambia, y con la cuenta ya activada, confirmar, el desbloqueo y el pago no hay salida.
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

const CUPON = "K7M2-9QXA-4HTR";
const ALTA: ProductoALaVenta = { id: "alta", usdc: "3", sorteos: 3, dias: 90 };
const ID = "ABCD2345";
const ORDEN: OrdenDePago = {
  id: ID,
  producto: "alta",
  usdc: "2.5",
  sorteos: 3,
  destino: "GDESTINOCUENTADECOBROSDEPRUEBAXXXXXXXXXXXXXXXXXXXXXXXXX",
  nota: `tk:o:${ID}`,
  memoId: memoIdDe(ID) as string,
  enlace: "web+stellar:pay?destination=GDESTINO",
  vence: Date.UTC(2026, 10, 14, 15, 0),
};
const SERVIDOR: AccesoEnLaVista = { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno" };
const conAcceso = (o: Partial<AccesoEnLaVista> = {}): AccesoEnLaVista => ({ ...SERVIDOR, ...o });
const BIENVENIDA = { estado: "lista", sorteos: 3 } as const;

/** Una muestra amplia: cada estado de la cuenta con cada cosa que corre y cada forma del acceso al servidor. */
function todas(): EntradaVista[] {
  const out: EntradaVista[] = [];
  const accesos: (AccesoEnLaVista | undefined)[] = [
    undefined,
    conAcceso({ estado: "revisando" }),
    conAcceso({ estado: "ninguno" }),
    conAcceso({ estado: "ninguno", bienvenida: BIENVENIDA }),
    conAcceso({ estado: "ninguno", cuponEnMano: CUPON }),
    conAcceso({ estado: "ninguno", escribiendo: true, campoOk: true }),
    conAcceso({ estado: "con", por: "cupon", canjeado: 3, cadena: true }),
    conAcceso({ estado: "con", por: "admin", canjeado: 3, cadena: true, delRegalo: true, bienvenida: BIENVENIDA }),
    conAcceso({ estado: "con", por: "cupon", canjeado: 3, fallaTrasCanje: true }),
    conAcceso({ estado: "con", por: "cupon" }),
    conAcceso({ estado: "con", por: "cupon", pideCupon: true, escribiendo: true, campoOk: true }),
    conAcceso({ estado: "con", por: "cupon", pideCupon: true, cuponEnMano: CUPON }),
    conAcceso({ estado: "error", error: { clave: "altaErrServicio" } }),
    conAcceso({ estado: "con", por: "pago", pago: { ...pagoInicial("es", ALTA), fase: "pidiendo" } }),
    conAcceso({ estado: "ninguno", pago: { ...pagoInicial("es", ALTA), fase: "pagando", orden: ORDEN, buscando: true } }),
  ];
  for (const para of ["entrada", "premio"] as const)
    for (const activacion of ["lista", "falta", "preparando", "fallo", "no-se-sabe"] as const)
      for (const proteccion of ["lista", "falta", "aparato-nuevo", "sin-forma", "no-se-sabe"] as const)
        for (const corre of [null, "revisando", "activando", "esperando", "desbloqueo", "mandando", "confirmando", "cerrando", "canjeando", "reclamando"] as const)
          for (const celular of [true, false])
            for (const codigo of [null, { a: "x", segundos: 3 }])
              for (const acceso of accesos)
                out.push({ ...base, para, activacion, proteccion, corre, celular, codigo, correoConfirmado: true, ...(acceso ? { acceso } : {}) });
  return out;
}

const MUESTRA = todas();
const con = (e: EntradaVista, demora: "recargar" | "pedido"): Vista => vistaDe({ ...e, demora });
const secundarios = (v: Vista): Boton[] => v.cajas.flatMap((c) => c.secundarios);
const cajaConSalida = (v: Vista, accion: string): CajaVista | undefined => v.cajas.find((c) => c.secundarios.some((s) => s.accion === accion));

describe("la salida de una espera larga", () => {
  it("V1: toda espera del paso termina en una caja con su salida prendida, y el pie dice que tarda", () => {
    let vistas = 0;
    for (const e of MUESTRA) {
      const sin = vistaDe(e);
      if (!esperaDelPaso(e, sin)) continue;
      vistas++;
      for (const [demora, accion, clave] of [
        ["recargar", "recargar", "loginRecargar"],
        ["pedido", "pedido-de-nuevo", "clProbarDeNuevo"],
      ] as const) {
        const v = con(e, demora);
        const caja = cajaConSalida(v, accion);
        const ctx = `${demora} ${JSON.stringify(e)}`;
        expect(caja, ctx).toBeDefined();
        const salida = caja?.secundarios.at(-1);
        expect(salida, ctx).toMatchObject({ accion, clave, apagado: false, forma: "boton" });
        expect(caja?.abierta, ctx).toBe(true);
        expect(caja?.sola, ctx).toBe(true);
        expect(portadaDe(v).filas, ctx).toContain(caja);
        expect(portadaDe(v).forma, ctx).toBe("uno");
        expect(v.estado?.clave, ctx).toBe("clErrTarda");
        // Una sola salida en toda la vista.
        expect(secundarios(v).filter((s) => s.accion === accion), ctx).toHaveLength(1);
      }
    }
    // La muestra de verdad tiene esperas: si no, la prueba no prueba nada.
    expect(vistas).toBeGreaterThan(100);
  });

  it("V2: la principal sigue igual, nada se quita y cerrar sesión no aparece", () => {
    for (const e of MUESTRA) {
      const sin = vistaDe(e);
      if (!esperaDelPaso(e, sin)) continue;
      for (const demora of ["recargar", "pedido"] as const) {
        const v = con(e, demora);
        const ctx = `${demora} ${JSON.stringify(e)}`;
        expect(v.principal, ctx).toEqual(sin.principal);
        expect(v.titulo).toBe(sin.titulo);
        expect(v.volver, ctx).toEqual(sin.volver);
        expect(v.salidas, ctx).toEqual(sin.salidas);
        expect(v.notas).toEqual(sin.notas);
        expect(v.final).toBe(false);
        expect(v.cajas, ctx).toHaveLength(sin.cajas.length);
        v.cajas.forEach((c, i) => {
          const antes = sin.cajas[i] as CajaVista;
          const salio = c.secundarios.some((s) => s.accion === "recargar" || s.accion === "pedido-de-nuevo");
          // Los secundarios de antes siguen en el mismo orden, y la salida va al final.
          expect(c.secundarios.slice(0, antes.secundarios.length), ctx).toEqual(antes.secundarios);
          expect(c.secundarios.length, ctx).toBe(antes.secundarios.length + (salio ? 1 : 0));
          expect(c.textos, ctx).toEqual(antes.textos);
          expect(c.nota, ctx).toEqual(antes.nota);
          expect(c.error, ctx).toEqual(antes.error);
          expect(c.titulo, ctx).toBe(antes.titulo);
          expect(c.ocupada, ctx).toBe(antes.ocupada);
          if (!salio) expect(c, ctx).toEqual(antes);
        });
        const acciones = [v.principal?.accion, ...secundarios(v).map((s) => s.accion)];
        const antes = [sin.principal?.accion, ...secundarios(sin).map((s) => s.accion)];
        for (const a of ["salir-y-entrar", "entrar-de-nuevo"] as const) if (!antes.includes(a)) expect(acciones, ctx).not.toContain(a);
      }
    }
  });

  it("V3: sin nada que gire con salida, la vista no cambia", () => {
    let sinEspera = 0;
    for (const e of MUESTRA) {
      const sin = vistaDe(e);
      if (esperaDelPaso(e, sin)) continue;
      sinEspera++;
      for (const demora of ["recargar", "pedido"] as const) expect(con(e, demora), `${demora} ${JSON.stringify(e)}`).toEqual(sin);
    }
    expect(sinEspera).toBeGreaterThan(1000);
  });

  it("V4: las excepciones no tienen salida", () => {
    const sinSalida = (o: Partial<EntradaVista>, acceso?: AccesoEnLaVista): void => {
      const e: EntradaVista = { ...base, ...o, ...(acceso ? { acceso } : {}) };
      const v = vistaDe(e);
      // Algo gira de verdad en cada caso: la excepción es la regla, no que no haya nada.
      expect(v.principal?.ocupado === true || secundarios(v).some((s) => s.ocupado), JSON.stringify(e)).toBe(true);
      expect(esperaDelPaso(e, v), JSON.stringify(e)).toBe(false);
      expect(con(e, "recargar"), JSON.stringify(e)).toEqual(v);
    };
    // Con la cuenta ya activada: el canje de un cupón, la lectura final de la cadena y la lectura del acceso.
    sinSalida({ activacion: "lista", corre: "canjeando" }, conAcceso({ estado: "con", por: "cupon", pideCupon: true, cuponEnMano: CUPON }));
    sinSalida({ activacion: "lista", corre: "canjeando" }, conAcceso({ estado: "con", por: "cupon", pideCupon: true, escribiendo: true, campoOk: true }));
    sinSalida({ activacion: "lista", corre: "revisando" }, conAcceso({ estado: "con", por: "cupon", canjeado: 3, cadena: true }));
    sinSalida({ activacion: "lista", corre: "revisando" }, conAcceso({ estado: "revisando", pideCupon: true }));
    // Confirmar el código y el desbloqueo: su propio tope de un minuto termina con su botón.
    sinSalida({ activacion: "lista", corre: "confirmando", codigo: { a: "n•••@gmail.com", segundos: 12 }, campoOk: true });
    sinSalida({ activacion: "lista", corre: "desbloqueo" });
    // El pago.
    sinSalida({ activacion: "falta" }, conAcceso({ pago: { ...pagoInicial("es", ALTA), fase: "pidiendo" } }));
    sinSalida({ activacion: "falta" }, conAcceso({ pago: { ...pagoInicial("es", ALTA), fase: "pagando", orden: ORDEN, buscando: true } }));
  });

  it("V4: las dos listas de acciones no se juntan: mandar el código no depende de la cuenta activada", () => {
    // Con la cuenta ya activada, mandar el código sí tiene salida: es lo único que gira en el paso.
    const e: EntradaVista = { ...base, activacion: "lista", corre: "mandando" };
    expect(esperaDelPaso(e, vistaDe(e))).toBe(true);
  });

  it("V5: cerrando la sesión no recibe la salida", () => {
    const acceso = conAcceso({ estado: "con", por: "cupon", canjeado: 3, cadena: true });
    for (const o of [{ corre: "cerrando" as const }, { corre: "cerrando" as const, activacion: "preparando" as const }]) {
      const e: EntradaVista = { ...base, ...o, acceso };
      expect(esperaDelPaso(e, vistaDe(e))).toBe(false);
      expect(con(e, "recargar")).toEqual(vistaDe(e));
    }
  });

  it("V6: mandar el código recibe la salida en la caja de proteger, venga lo que gire de la principal o del secundario", () => {
    const proteger = { activacion: "lista" as const, corre: "mandando" as const };
    const casos: Partial<EntradaVista>[] = [
      // El correo de la sesión, en la compu y en el celular sin desbloqueo.
      { ...proteger, celular: false },
      { ...proteger, hayDesbloqueo: false },
      // A mano, otro celular y un código que venció.
      { ...proteger, celular: false, eligioCorreo: true, campoOk: true },
      { ...proteger, proteccion: "aparato-nuevo", correoConfirmado: true, correoCuenta: "n•••@gmail.com" },
      { ...proteger, codigo: { a: "n•••@gmail.com", segundos: 12 }, falla: "codigo-vencido" },
      // El desbloqueo va primero y lo que gira es el secundario de texto.
      { ...proteger, celular: true, hayDesbloqueo: true },
    ];
    for (const o of casos) {
      const e: EntradaVista = { ...base, ...o };
      const sin = vistaDe(e);
      expect(esperaDelPaso(e, sin), JSON.stringify(o)).toBe(true);
      const v = con(e, "recargar");
      expect(cajaConSalida(v, "recargar")?.parte, JSON.stringify(o)).toBe("proteger");
    }
    // Con el código ya mandado y Confirmar a la mano, nada gira: no hay salida.
    const sinGirar: EntradaVista = { ...base, ...proteger, corre: null, codigo: { a: "n•••@gmail.com", segundos: 40 }, campoOk: true };
    expect(esperaDelPaso(sinGirar, vistaDe(sinGirar))).toBe(false);
    const otroCodigo: EntradaVista = { ...base, ...proteger, codigo: { a: "n•••@gmail.com", segundos: 40 }, campoOk: true };
    expect(esperaDelPaso(otroCodigo, vistaDe(otroCodigo))).toBe(false);
  });

  it("V6: el camino directo, el del regalo y el del cupón la reciben mientras la cuenta no existe", () => {
    const casos: [Partial<EntradaVista>, AccesoEnLaVista | undefined][] = [
      [{ corre: "revisando" }, undefined],
      [{ corre: "activando" }, undefined],
      [{ corre: "esperando" }, undefined],
      [{ activacion: "preparando" }, undefined],
      [{ corre: "reclamando" }, conAcceso({ bienvenida: BIENVENIDA })],
      [{ corre: "canjeando" }, conAcceso({ cuponEnMano: CUPON })],
      [{ corre: "canjeando" }, conAcceso({ escribiendo: true, campoOk: true })],
      [{ corre: "activando" }, conAcceso({ estado: "con", por: "cupon", canjeado: 3, cadena: true })],
      [{ corre: "revisando" }, conAcceso({ estado: "con", por: "cupon", canjeado: 3, cadena: true })],
      [{ corre: "revisando", para: "premio" }, conAcceso({ estado: "revisando" })],
      [{ corre: "revisando" }, conAcceso({ estado: "revisando" })],
    ];
    for (const [o, acceso] of casos) {
      const e: EntradaVista = { ...base, ...o, ...(acceso ? { acceso } : {}) };
      const ctx = JSON.stringify(e);
      expect(esperaDelPaso(e, vistaDe(e)), ctx).toBe(true);
      expect(cajaConSalida(con(e, "recargar"), "recargar")?.parte, ctx).toBe("activar");
    }
  });
});
