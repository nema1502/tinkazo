import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import type { OrdenDePago } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import { ACCESO_LIBRE, type AccesoEnLaVista, type EntradaVista, type PagoEnLaVista, type Vista, activarPermitido, faltaElAcceso, pagoInicial, vistaDe } from "./cuenta-lista-estado";
import { MEDIOS_DE_PAGO, type MedioDePago } from "./pago-vista";

/**
 * «Dejá tu cuenta lista» con la compra del primer paquete (las filas del pago), sin DOM. Lo que no se negocia:
 * - una sola principal en cada fila, y las salidas a la vista en todas;
 * - el pago nunca da «Activar»: el acceso lo confirma el servidor, y recién ahí;
 * - nunca un botón de comprar si el servidor no vende ese paquete ahora, ni un texto que ofrezca comprar sin su botón;
 * - la cuenta, el monto y la nota que se muestran son los de la orden, tal cual: ninguno se arma acá;
 * - solo medios de pago automáticos: nada que dependa de que alguien confirme el pago a mano, y con un solo medio no se
 *   pregunta cómo pagar;
 * - sin la compra en el build (sin `pago`), el paso de siempre.
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
const CUPON = "K7M2-9QXA-4HTR";
/** Dos medios, para ver la pregunta: hoy hay uno solo y la pregunta no aparece. */
const DOS: readonly MedioDePago[] = [...MEDIOS_DE_PAGO, { id: "otro", clave: "pagoMedioApp" }];

const SERVIDOR: AccesoEnLaVista = { ...ACCESO_LIBRE, modo: "servidor", estado: "ninguno" };
const pago = (o: Partial<PagoEnLaVista> = {}): PagoEnLaVista => ({ ...pagoInicial("es", ALTA), ...o });
const v = (o: Partial<EntradaVista> = {}, a: Partial<AccesoEnLaVista> = {}, p: Partial<PagoEnLaVista> | null = {}): Vista =>
  vistaDe({ ...base, ...o, acceso: { ...SERVIDOR, ...a, ...(p === null ? {} : { pago: pago(p) }) } });

const acciones = (vista: Vista): string[] => [vista.principal?.accion ?? "", ...vista.cajas.flatMap((c) => c.secundarios.map((s) => s.accion))].filter(Boolean);
const claves = (vista: Vista): string[] =>
  [
    vista.principal?.clave,
    vista.bajada,
    vista.estado?.clave,
    ...vista.cajas.flatMap((c) => [
      c.titulo,
      ...c.textos.map((x) => x.clave),
      c.nota?.clave,
      ...(c.cierre ?? []).map((x) => x.clave),
      ...(c.detalles ?? []).map((x) => x.clave),
      ...(c.pago?.detalles ?? []).map((x) => x.clave),
      ...(c.error ?? []).map((x) => x.clave),
      ...c.secundarios.map((s) => s.clave),
    ]),
  ].filter(
    (x): x is string => typeof x === "string",
  );

/** Todas las fases y marcas del pago, con y sin el producto a la venta, con y sin error. */
function pagos(): Partial<PagoEnLaVista>[] {
  const out: Partial<PagoEnLaVista>[] = [];
  for (const alta of [ALTA, null])
    for (const medios of [MEDIOS_DE_PAGO, DOS])
    for (const fase of ["ofrecer", "elegir", "pidiendo", "pagando"] as const)
      for (const orden of fase === "pagando" ? [ORDEN, null] : [null])
        for (const marcas of [{}, { buscando: true }, { noVisto: true }, { tarda: true }, { tarda: true, noLlego: true }, { falta: { recibido: "1", total: "2.5" } }, { vencida: true }, { vencida: true, falta: { recibido: "1", total: "2.5" } }] as Partial<PagoEnLaVista>[])
          for (const [error, arreglo] of [
            [null, "probar"],
            [{ clave: "pagoErrRed" }, "probar"],
            [{ clave: "pagoPausado" }, "probar"],
            [{ clave: "clErrSesion" }, "entrar"],
            [{ clave: "altaErrCuentaDeOtro" }, "ninguno"],
          ] as const)
            out.push({ alta, medios, fase, orden, ...marcas, error, arreglo });
  return out;
}

function todas(): EntradaVista[] {
  const out: EntradaVista[] = [];
  const accesos: Partial<AccesoEnLaVista>[] = [{ estado: "ninguno" }, { estado: "ninguno", cuponEnMano: CUPON }, { estado: "ninguno", escribiendo: true }, { estado: "revisando" }, { estado: "error", error: { clave: "altaErrServicio" } }, { estado: "con", por: "pago" }, { estado: "con", por: "cupon", pideCupon: true }];
  for (const activacion of ["lista", "falta"] as const)
    for (const proteccion of ["lista", "falta"] as const)
      for (const puedePasarAPrueba of [true, false])
        for (const a of accesos) for (const p of pagos()) out.push({ ...base, activacion, proteccion, puedePasarAPrueba, acceso: { ...SERVIDOR, ...a, pago: pago(p) } });
  return out;
}

describe("sin la compra en el build, el paso de siempre", () => {
  it("sin `pago`, cada fila es la de hoy", () => {
    for (const a of [{ estado: "ninguno" }, { estado: "ninguno", cuponEnMano: CUPON }, { estado: "ninguno", escribiendo: true }, { estado: "con", por: "cupon" }] as Partial<AccesoEnLaVista>[])
      for (const activacion of ["lista", "falta"] as const) {
        const sin = vistaDe({ ...base, activacion, acceso: { ...SERVIDOR, ...a } });
        expect(claves(sin).some((k) => /^(pago|altaPrimerPaquete|cupoOfSumar|clBajadaConPago)/.test(k)), JSON.stringify(a)).toBe(false);
        expect(acciones(sin)).not.toContain("comprar");
      }
    expect(v({}, {}, null).principal).toMatchObject({ accion: "tengo-cupon", clave: "altaTengoCupon" });
  });
});

describe("las reglas de todas las filas", () => {
  it("una sola principal, como mucho una caja abierta, las salidas a la vista y nunca el final sin el acceso", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      const quien = JSON.stringify(e.acceso);
      expect(vista.cajas.filter((c) => c.abierta).length, quien).toBeLessThanOrEqual(1);
      // La principal no se repite como secundaria (un medio de pago es otro botón aunque la acción sea la misma).
      if (vista.principal) expect(vista.cajas.flatMap((c) => c.secundarios).some((s) => s.accion === vista.principal?.accion && s.medio === vista.principal?.medio), quien).toBe(false);
      if (!faltaElAcceso(e)) continue;
      expect(vista.final, quien).toBe(false);
      expect(vista.salidas, quien).not.toBeNull();
      expect(vista.salidas?.cerrar.apagado, quien).toBe(false);
      if (vista.salidas?.prueba) expect(vista.salidas.prueba.apagado, quien).toBe(!e.puedePasarAPrueba);
      else expect(vista.principal?.accion, quien).toBe("pasar-a-prueba");
    }
  });

  it("el pago nunca da «Activar»: sin el acceso confirmado por el servidor, ninguna fila lo ofrece", () => {
    for (const e of todas()) {
      if (e.acceso?.estado === "con" && !faltaElAcceso(e)) continue;
      expect(acciones(vistaDe(e)), JSON.stringify(e.acceso)).not.toContain("activar");
      expect(activarPermitido(e), JSON.stringify(e.acceso)).toBe(e.acceso?.estado === "con" && !faltaElAcceso(e));
    }
  });

  it("sin el primer paquete a la venta no hay botón de comprar, ni un texto que ofrezca comprar", () => {
    for (const e of todas()) {
      if (e.acceso?.pago?.alta) continue;
      const vista = vistaDe(e);
      expect(acciones(vista), JSON.stringify(e.acceso)).not.toContain("comprar");
      // Lo que nombra un paquete o sumar sorteos, sin su botón, no aparece: solo las filas de una compra ya empezada.
      if (e.acceso?.pago?.fase === "ofrecer") for (const k of claves(vista)) expect(k, JSON.stringify(e.acceso)).not.toMatch(/^(altaPrimerPaquete|altaTexto$|altaYaActivada$|clBajadaConPago)/);
    }
  });

  it("los datos de pago que se muestran son los de la orden, tal cual, y sin orden no se muestra ninguno", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      for (const c of vista.cajas) {
        if (!c.pago) continue;
        const o = e.acceso?.pago?.orden as OrdenDePago;
        expect(o, JSON.stringify(e.acceso)).toBeTruthy();
        expect(c.pago).toMatchObject({ destino: o.destino, usdc: o.usdc, nota: o.nota, enlace: o.enlace, vence: o.vence });
      }
      if (!e.acceso?.pago?.orden) expect(vista.cajas.some((c) => c.pago), JSON.stringify(e.acceso)).toBe(false);
    }
  });

  it("cada texto y cada botón de las filas del pago existe en los dos idiomas", () => {
    const vistas = new Set<string>();
    for (const e of todas()) for (const k of claves(vistaDe(e))) vistas.add(k);
    for (const k of vistas) for (const l of ["es", "en"] as const) expect(typeof T[l][k] === "string" && (T[l][k] as string).trim() !== "", `${l} ${k}`).toBe(true);
  });

  it("ningún botón de las filas del pago nombra una moneda, una red, una nota técnica ni una transacción", () => {
    for (const e of todas()) {
      const vista = vistaDe(e);
      const botones = [vista.principal, ...vista.cajas.flatMap((c) => c.secundarios)].filter((b) => b !== null && b !== undefined);
      for (const b of botones) for (const l of ["es", "en"] as const) expect(String(T[l][b.clave]), `${l} ${b.clave}`).not.toMatch(/\b(USDC|XLM|Stellar|memo|token|hash|transacci[oó]n|transaction|blockchain|exchange)\b/i);
    }
  });
});

describe("las filas, una por una", () => {
  it("sin cupón y con el primer paquete a la venta: comprarlo es la principal, con el precio del servidor; el cupón, la secundaria", () => {
    const vista = v();
    const caja = vista.cajas[0];
    expect(vista.principal).toMatchObject({ accion: "comprar", clave: "altaPrimerPaquete", apagado: false, vars: { sorteos: "3 sorteos oficiales", precio: "3 dólares" } });
    // Poco texto: una sola línea a la vista; que la cuenta queda activada y qué hacer sin cupón, plegados.
    expect(caja?.textos.map((x) => x.clave)).toEqual(["altaTexto"]);
    expect(caja?.secundarios.map((s) => [s.accion, s.clave, s.forma])).toEqual([["tengo-cupon", "altaTengoCupon", "boton"]]);
    expect(caja?.cierre ?? []).toEqual([]);
    expect(caja?.detalles?.map((x) => x.clave)).toEqual(["altaPrimerPaqueteNota", "altaNoTengo"]);
    // En inglés, con los números del servidor.
    expect(v({}, {}, { idioma: "en", alta: { ...ALTA, usdc: "9.5", sorteos: 10 } }).principal?.vars).toEqual({ sorteos: "10 Live draws", precio: "US$9.50" });
  });

  it("ya activada y sin acceso, lo mismo con `altaYaActivada`, sin la nota de la activación", () => {
    const vista = v({ activacion: "lista", proteccion: "lista" });
    expect(vista.principal).toMatchObject({ accion: "comprar", clave: "altaPrimerPaquete" });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaYaActivada"]);
  });

  it("sin el primer paquete a la venta (apagado, pausado o sin respuesta): «Tengo un cupón», con los textos sin compra", () => {
    const vista = v({}, {}, { alta: null });
    expect(vista.principal).toMatchObject({ accion: "tengo-cupon", clave: "altaTengoCupon" });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaTextoSinVenta"]);
    expect(v({ activacion: "lista", proteccion: "lista" }, {}, { alta: null }).cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaYaActivadaSinVenta"]);
    // Si la compra se frenó en el servidor al pedirla, se dice por qué.
    const pausado = v({}, {}, { alta: null, error: { clave: "pagoPausado" } });
    expect(pausado.cajas[0]?.error?.map((x) => x.clave)).toEqual(["pagoPausado"]);
    expect(pausado.principal).toMatchObject({ accion: "tengo-cupon" });
  });

  it("con un cupón en mano, el cupón: nada de comprar", () => {
    const vista = v({}, { cuponEnMano: CUPON });
    expect(vista.principal).toMatchObject({ accion: "usar-cupon", clave: "altaActivarConCupon" });
    expect(acciones(vista)).not.toContain("comprar");
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaTextoSinVenta", "altaCuponListo"]);
  });

  it("con acceso y sin sorteos (abierto para usar un cupón), el cupón: el primer paquete no es para quien ya tiene acceso", () => {
    const vista = v({ activacion: "lista", proteccion: "lista", para: "sello" }, { estado: "con", por: "cupon", pideCupon: true, escribiendo: true });
    expect(acciones(vista)).not.toContain("comprar");
    expect(vista.cajas[0]?.campo).toBe("cupon");
  });

  it("hoy hay un solo medio de pago, y es automático: la transferencia que el servidor reconoce sola por su nota", () => {
    expect(MEDIOS_DE_PAGO.map((m) => m.id)).toEqual(["app"]);
    expect(pagoInicial("es", ALTA).medios).toEqual(MEDIOS_DE_PAGO);
  });

  it("con más de un medio, la pregunta: el primero de principal, los demás al lado, y «Volver»", () => {
    const vista = v({}, {}, { medios: DOS, fase: "elegir" });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["pagoComoPagar"]);
    expect(vista.principal).toMatchObject({ accion: "pago-medio", medio: "app", clave: "pagoMedioApp" });
    expect(vista.cajas[0]?.secundarios.map((s) => [s.accion, s.medio ?? null, s.forma])).toEqual([
      ["pago-medio", "otro", "boton"],
      ["volver-pago", null, "texto"],
    ]);
    expect(vista.bajada).toBe("clBajadaConPago");
  });

  it("ninguna fila manda a escribir para pagar ni ofrece un QR del banco: nada depende de que alguien confirme a mano", () => {
    const vedado = /bolivianos|QR del banco|te pasamos un QR|send you a QR|bank/i;
    for (const e of todas()) {
      const vista = vistaDe(e);
      for (const k of claves(vista)) for (const l of ["es", "en"] as const) expect(String(T[l][k]), `${l} ${k}`).not.toMatch(vedado);
      expect(acciones(vista), JSON.stringify(e.acceso)).not.toContain("pago-no");
    }
  });

  it("pidiendo la orden: la principal gira y dice que se prepara el pago", () => {
    const vista = v({}, {}, { fase: "pidiendo" });
    expect(vista.principal).toMatchObject({ accion: "pago-medio", clave: "pagoPreparando", apagado: true, ocupado: true });
    expect(vista.cajas[0]?.ocupada).toBe(true);
    expect(vista.cajas[0]?.pago ?? null).toBeNull();
  });

  it("si pedir la orden no salió: el motivo en la caja de la compra, y el paquete de principal vuelve a pedirla", () => {
    const vista = v({}, {}, { fase: "ofrecer", error: { clave: "pagoErrRed" } });
    expect(vista.cajas[0]?.estado).toBe("no-salio");
    expect(vista.cajas[0]?.error?.map((x) => x.clave)).toEqual(["pagoErrRed"]);
    expect(vista.principal).toMatchObject({ accion: "comprar", clave: "altaPrimerPaquete" });
    expect(v({}, {}, { fase: "ofrecer", error: { clave: "clErrSesion" }, arreglo: "entrar" }).principal?.accion).toBe("entrar-de-nuevo");
    expect(v({}, {}, { fase: "ofrecer", error: { clave: "altaErrCuentaDeOtro" }, arreglo: "ninguno" }).principal?.accion).toBe("pasar-a-prueba");
  });

  it("pagando sin la orden en mano no inventa nada: vuelve a la caja de la compra", () => {
    const vista = v({}, {}, { fase: "pagando", orden: null });
    expect(vista.principal).toMatchObject({ accion: "comprar" });
    expect(vista.cajas[0]?.pago ?? null).toBeNull();
  });

  it("pagando: a dónde, cuánto y con qué nota, de la orden, con una sola línea a la vista; «Ya pagué» de principal, el cupón y «Volver» de texto", () => {
    const vista = v({}, {}, { fase: "pagando", orden: ORDEN });
    const caja = vista.cajas[0];
    // Lo que no hace falta para pagar va plegado en Más detalles, dentro del panel.
    const detalles = [{ clave: "pagoParaCuenta", vars: { correo: "n•••@gmail.com" } }, { clave: "pagoVence", vars: { fecha: "14 de noviembre" } }, { clave: "compraNotaMemo" }, { clave: "compraSinDolares" }];
    const corta = `${ORDEN.destino.slice(0, 4)}…${ORDEN.destino.slice(-4)}`;
    expect(caja?.pago).toEqual({ correo: "n•••@gmail.com", destino: ORDEN.destino, cuentaCorta: corta, usdc: "2.5", monto: "2,50", nota: ORDEN.nota, enlace: ORDEN.enlace, vence: ORDEN.vence, detalles });
    expect(caja?.titulo).toBe("pagoTitulo");
    expect(caja?.textos).toEqual([{ clave: "compraAppLinea" }]);
    expect(vista.principal).toMatchObject({ accion: "ya-pague", clave: "pagoYaPague", apagado: false });
    expect(caja?.secundarios.map((s) => [s.accion, s.clave, s.forma])).toEqual([
      ["tengo-cupon", "altaTengoCupon", "texto"],
      ["volver-pago", "clVolver", "texto"],
    ]);
    expect(caja?.cierre ?? []).toEqual([]);
    expect(caja?.nota).toBeNull();
    // En inglés, la fecha y el monto en inglés.
    const en = v({}, {}, { idioma: "en", fase: "pagando", orden: ORDEN });
    expect(en.cajas[0]?.pago?.monto).toBe("2.50");
    expect(en.cajas[0]?.pago?.detalles.find((x) => x.clave === "pagoVence")?.vars).toEqual({ fecha: "November 14" });
    // Sin el correo de la sesión, no se inventa uno.
    expect(v({ correoSesion: "" }, {}, { fase: "pagando", orden: ORDEN }).cajas[0]?.pago?.detalles.map((x) => x.clave)).not.toContain("pagoParaCuenta");
  });

  it("buscando el pago: la principal gira y dice «Buscando tu pago…»; después de mirar sin verlo, que se sigue mirando", () => {
    const busca = v({}, {}, { fase: "pagando", orden: ORDEN, buscando: true });
    expect(busca.principal).toMatchObject({ accion: "ya-pague", clave: "pagoBuscando", apagado: true, ocupado: true });
    expect(busca.estado?.clave).toBe("pagoBuscando");
    expect(busca.cajas[0]?.pago?.nota).toBe(ORDEN.nota);
    expect(v({}, {}, { fase: "pagando", orden: ORDEN, buscando: true, noVisto: true }).cajas[0]?.nota?.clave).toBe("pagoNoLlego");
  });

  it("a los 5 minutos: que algunas apps tardan, y «No llegó», que recién ahí dice lo de la red equivocada", () => {
    const tarda = v({}, {}, { fase: "pagando", orden: ORDEN, tarda: true, noVisto: true });
    expect(tarda.cajas[0]?.nota?.clave).toBe("pagoTarda");
    expect(tarda.principal).toMatchObject({ accion: "ya-pague", clave: "pagoYaPague" });
    // Lo que pasó reemplaza a la línea de cómo pagar: una sola a la vista.
    expect(tarda.cajas[0]?.textos).toEqual([]);
    expect(tarda.cajas[0]?.secundarios.map((s) => [s.accion, s.forma])).toEqual([
      ["tengo-cupon", "texto"],
      ["no-llego", "texto"],
      ["volver-pago", "texto"],
    ]);
    const noLlego = v({}, {}, { fase: "pagando", orden: ORDEN, tarda: true, noLlego: true });
    expect(noLlego.cajas[0]?.nota?.clave).toBe("pagoRedEquivocada");
    expect(acciones(noLlego)).not.toContain("no-llego");
    // Antes de los 5 minutos no se habla de la red.
    for (const p of [{}, { buscando: true }, { noVisto: true }] as Partial<PagoEnLaVista>[]) {
      expect(claves(v({}, {}, { fase: "pagando", orden: ORDEN, ...p }))).not.toContain("pagoRedEquivocada");
      expect(acciones(v({}, {}, { fase: "pagando", orden: ORDEN, ...p }))).not.toContain("no-llego");
    }
  });

  it("llegó de menos: cuánto llegó de cuánto, con lo que dice el servidor", () => {
    const vista = v({}, {}, { fase: "pagando", orden: ORDEN, falta: { recibido: "1.5", total: "2.5" } });
    expect(vista.cajas[0]?.nota).toEqual({ clave: "pagoFalta", vars: { recibido: "1,50", total: "2,50" } });
    expect(vista.cajas[0]?.pago?.nota).toBe(ORDEN.nota);
    expect(vista.principal).toMatchObject({ accion: "ya-pague" });
  });

  it("si mirar el pago no salió: el motivo, y «Probar de nuevo» vuelve a mirar", () => {
    const vista = v({}, {}, { fase: "pagando", orden: ORDEN, error: { clave: "pagoErrRed" } });
    expect(vista.cajas[0]?.estado).toBe("no-salio");
    expect(vista.cajas[0]?.error?.map((x) => x.clave)).toEqual(["pagoErrRed"]);
    expect(vista.principal).toMatchObject({ accion: "ya-pague", clave: "clProbarDeNuevo" });
  });

  it("la orden venció sin nada pagado: no se muestra para pagar; «Pedir una nota nueva», y «Ya pagué» por si pagó", () => {
    const vista = v({}, {}, { fase: "pagando", orden: ORDEN, vencida: true });
    expect(vista.cajas[0]?.pago ?? null).toBeNull();
    expect(vista.cajas[0]?.textos).toEqual([{ clave: "pagoVencida", vars: { fecha: "14 de noviembre" } }]);
    expect(vista.principal).toMatchObject({ accion: "otra-nota", clave: "pagoOtraNota" });
    expect(vista.cajas[0]?.secundarios.map((s) => [s.accion, s.forma])).toEqual([
      ["ya-pague", "texto"],
      ["volver-pago", "texto"],
    ]);
    expect(v({}, {}, { fase: "pagando", orden: ORDEN, vencida: true, buscando: true }).principal).toMatchObject({ accion: "ya-pague", ocupado: true });
    // Vencida pero con algo pagado: el servidor la renueva con la misma nota, así que se sigue mostrando para completar.
    expect(v({}, {}, { fase: "pagando", orden: ORDEN, vencida: true, falta: { recibido: "1", total: "2.5" } }).cajas[0]?.pago?.nota).toBe(ORDEN.nota);
  });

  it("«Tengo un cupón» desde el pago abre el campo, y su «Volver» deja todo como estaba", () => {
    const vista = v({}, { escribiendo: true }, { fase: "pagando", orden: ORDEN });
    expect(vista.cajas[0]?.campo).toBe("cupon");
    expect(vista.principal).toMatchObject({ accion: "usar-cupon" });
    expect(vista.cajas[0]?.pago ?? null).toBeNull();
  });

  it("pago recibido: el servidor da el acceso, y es «Activar mi cuenta» con «Ya pagaste tu primer paquete»", () => {
    const vista = v({}, { estado: "con", por: "pago" }, { fase: "pagando", orden: ORDEN });
    expect(vista.principal).toMatchObject({ accion: "activar", clave: "clActivarBoton" });
    expect(vista.cajas[0]?.textos.map((x) => x.clave)).toEqual(["altaActivarPago"]);
    expect(vista.cajas[0]?.pago ?? null).toBeNull();
  });

  it("mientras se revisa el acceso, o si no se supo, lo del pago espera: lo de siempre", () => {
    expect(v({}, { estado: "revisando" }, { fase: "pagando", orden: ORDEN }).principal).toMatchObject({ clave: "clRevisando", ocupado: true });
    expect(v({}, { estado: "error", error: { clave: "altaErrServicio" } }, { fase: "pagando", orden: ORDEN }).principal).toMatchObject({ accion: "leer-acceso" });
  });
});
