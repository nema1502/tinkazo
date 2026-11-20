import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACCESO_LIBRE, type AccesoEnLaVista, type EntradaVista, type Para, activarPermitido, faltaElAcceso, pagoInicial, portadaDe, puedeVolverDelCupon, vistaDe } from "./cuenta-lista-estado";

/**
 * Referencia de lo que ve quien organiza. Recorre los cuatro `para` de siempre, una muestra amplia de entradas y un juego de
 * accesos, y guarda en un archivo la huella de cada combinación: la vista, la portada, `puedeVolverDelCupon`,
 * `activarPermitido` y `faltaElAcceso`. El archivo se escribió antes de agregar el paso del premio y ningún cambio posterior
 * lo toca: si cambia una sola letra de lo que ve quien organiza, esta prueba lo dice.
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

const PAQUETE = { id: "alta", usdc: "3", sorteos: 3, dias: 90 } as const;
const servidor = (o: Partial<AccesoEnLaVista> = {}): AccesoEnLaVista => ({ ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno", ...o });
const ERROR = { clave: "altaErrServicio" };

const PARAS: Para[] = ["entrada", "entrada-con-lista", "sello", "sorteo"];

const ACCESOS: Array<[string, AccesoEnLaVista | undefined]> = [
  ["sin acceso dicho", undefined],
  ["libre", ACCESO_LIBRE],
  ["cerrado", { ...ACCESO_LIBRE, modo: "cerrado" }],
  ["servidor ninguno", servidor()],
  ["servidor revisando", servidor({ estado: "revisando" })],
  ["servidor con por cupon", servidor({ estado: "con", por: "cupon" })],
  ["servidor con por pago", servidor({ estado: "con", por: "pago" })],
  ["servidor con por admin", servidor({ estado: "con", por: "admin" })],
  ["servidor con pide cupon", servidor({ estado: "con", por: "cupon", pideCupon: true })],
  ["servidor con pide cupon canjeado", servidor({ estado: "con", por: "cupon", pideCupon: true, canjeado: 2 })],
  ["servidor error probar", servidor({ estado: "error", error: ERROR, arreglo: "probar" })],
  ["servidor error entrar", servidor({ estado: "error", error: { clave: "clErrSesion" }, arreglo: "entrar" })],
  ["servidor error ninguno", servidor({ estado: "error", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" })],
  ["servidor cadena", servidor({ estado: "con", por: "cupon", cadena: true, canjeado: 2 })],
  ["servidor falla tras canje", servidor({ estado: "con", por: "cupon", fallaTrasCanje: true, canjeado: 2 })],
  ["servidor escribiendo", servidor({ escribiendo: true, campoOk: true })],
  ["servidor cupon en mano", servidor({ cuponEnMano: "ABCD-1234-WXYZ" })],
  ["servidor pago ofrecer", servidor({ pago: pagoInicial("es", PAQUETE) })],
  ["servidor pago elegir", servidor({ pago: { ...pagoInicial("es", PAQUETE), fase: "elegir" } })],
  ["servidor pago ofrecer sin paquete", servidor({ pago: pagoInicial("en", null) })],
];

/** Una muestra amplia de entradas: cada estado con cada cosa que puede estar corriendo. */
function muestra(): EntradaVista[] {
  const out: EntradaVista[] = [];
  for (const activacion of ["lista", "falta", "preparando", "fallo", "no-se-sabe"] as const)
    for (const proteccion of ["lista", "falta", "aparato-nuevo", "sin-forma", "no-se-sabe"] as const)
      for (const corre of [null, "revisando", "activando", "esperando", "desbloqueo", "mandando", "confirmando", "canjeando", "cerrando"] as const)
        for (const celular of [true, false])
          for (const falla of [null, "red", "tope", "sesion", "codigo-malo", "desbloqueo"] as const)
            out.push({ ...base, activacion, proteccion, corre, celular, falla, correoConfirmado: true, codigo: falla === "codigo-malo" ? { a: "x", segundos: 3 } : null });
  // Lo que no depende de lo que corre: el primer sello pendiente, sin poder pasar a Prueba, sin correo ni llaves.
  for (const activacion of ["lista", "falta"] as const)
    for (const proteccion of ["lista", "falta", "aparato-nuevo"] as const)
      for (const primerOficialPendiente of [true, false])
        for (const puedePasarAPrueba of [true, false])
          for (const correoConfirmado of [true, false])
            out.push({ ...base, activacion, proteccion, primerOficialPendiente, puedePasarAPrueba, correoConfirmado, tieneLlaves: !correoConfirmado, codigoRecargado: !puedePasarAPrueba });
  return out;
}

function huella(para: Para, acceso: AccesoEnLaVista | undefined): string {
  const h = createHash("sha256");
  const entradas = muestra();
  for (const e0 of entradas) {
    const e: EntradaVista = { ...e0, para, ...(acceso ? { acceso } : {}) };
    const vista = vistaDe(e);
    h.update(JSON.stringify([vista, portadaDe(vista), puedeVolverDelCupon(e), activarPermitido(e), faltaElAcceso(e)]));
  }
  return `${entradas.length} ${h.digest("hex")}`;
}

describe("la referencia de lo que ve quien organiza", () => {
  it("las huellas de los cuatro para de siempre con cada acceso no cambian", async () => {
    const lineas: string[] = [];
    for (const para of PARAS) for (const [nombre, acceso] of ACCESOS) lineas.push(`${para} | ${nombre} | ${huella(para, acceso)}`);
    await expect(`${lineas.join("\n")}\n`).toMatchFileSnapshot("./__referencia__/cuenta-lista-organiza.txt");
  });
});
