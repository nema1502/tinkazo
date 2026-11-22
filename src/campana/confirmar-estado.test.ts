import { describe, expect, it } from "vitest";
import { SIN_RESPUESTA } from "../ui/proteger-cuenta";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";
import {
  clasificarFallaAlConfirmar,
  clasificarFallaAlMandar,
  clasificarFallaDelDesbloqueo,
  CODIGO_VENCE_A_LOS_MS,
  DESBLOQUEO_TARDA_MS,
  ENVIOS_PERMITIDOS,
  enCurso,
  iniciar,
  limpiarElCodigo,
  marcaVigente,
  OTRO_CODIGO_A_LOS_MS,
  PAUSA_POR_MUCHOS_MS,
  PROMESA_VERIFICADA,
  puedePedir,
  SIN_SESION,
  siguiente,
  SPAM_A_LOS_MS,
  vistaDe,
  type Evento,
  type Tarjeta,
} from "./confirmar-estado";

const T0 = 1_000_000;
/** Las frases que invitan a confirmar y que siguen al desbloqueo: con la promesa apagada dicen solo lo que se sabe. */
const CLAVE_LINEA = PROMESA_VERIFICADA ? "ccLinea" : "ccLineaSolo";
const CLAVE_DESBLOQUEO_LISTO = PROMESA_VERIFICADA ? "ccDesbloqueoListo" : "ccDesbloqueoListoSolo";

/** Un error como los del kit: el código va en `code` y en el mensaje, y el detalle en el cuerpo. */
const errorDelKit = (code: string, body: Record<string, unknown> = {}): Error => Object.assign(new Error(code), { code, body });

/** Lleva la tarjeta por una lista de eventos, cada uno con su hora. */
function recorrer(t: Tarjeta, pasos: Array<[Evento, number]>): Tarjeta {
  return pasos.reduce((actual, [ev, ahora]) => siguiente(actual, ev, ahora), t);
}

const conCodigo = (t: Tarjeta = iniciar(T0, { ofreceDesbloqueo: false, recargado: false })): Tarjeta =>
  recorrer(t, [[{ tipo: "pedir-codigo" }, T0], [{ tipo: "codigo-mandado" }, T0 + 2_000]]);

describe("la tarjeta de confirmar el correo: lo que se ve en cada estado", () => {
  it("invita con una sola acción principal y el desbloqueo como secundaria solo si se ofrece", () => {
    const sin = vistaDe(iniciar(T0, { ofreceDesbloqueo: false, recargado: false }), T0);
    expect(sin.visible).toBe(true);
    expect(sin.linea).toBe(CLAVE_LINEA);
    expect(sin.principal).toEqual({ clave: "ccConfirmar", accion: "pedir", apagada: false, ocupada: false });
    expect(sin.secundaria).toBeNull();
    const con = vistaDe(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), T0);
    expect(con.principal?.clave).toBe("ccConfirmar");
    expect(con.secundaria).toEqual({ clave: "ccDesbloqueo", accion: "desbloquear" });
  });

  it("mandando apaga la principal y la deja con ruedita", () => {
    const t = siguiente(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), { tipo: "pedir-codigo" }, T0);
    const v = vistaDe(t, T0);
    expect(t.estado).toBe("mandando");
    expect(v.principal).toEqual({ clave: "ccMandando", accion: "pedir", apagada: true, ocupada: true });
    expect(v.secundaria).toBeNull();
    expect(v.linea).toBe(CLAVE_LINEA);
  });

  it("con el código mandado muestra el título, la línea con el correo, el campo y Confirmar apagada hasta cuatro caracteres", () => {
    const t = conCodigo();
    expect(t.estado).toBe("codigo");
    const vacio = vistaDe(t, T0 + 2_000, 0);
    expect(vacio.conCodigo).toBe(true);
    expect(vacio.linea).toBe("ccCodigoLinea");
    expect(vacio.principal).toEqual({ clave: "ccCodigoConfirmar", accion: "confirmar", apagada: true, ocupada: false });
    expect(vistaDe(t, T0 + 2_000, 3).principal?.apagada).toBe(true);
    expect(vistaDe(t, T0 + 2_000, 4).principal?.apagada).toBe(false);
  });

  it("el aviso de Spam llega a los 20 segundos del envío y no antes", () => {
    const t = conCodigo();
    expect(vistaDe(t, T0 + 2_000 + SPAM_A_LOS_MS - 1).spam).toBe(false);
    expect(vistaDe(t, T0 + 2_000 + SPAM_A_LOS_MS).spam).toBe(true);
  });

  it("Otro código baja desde 60 segundos y recién después aparece Mandar otro código", () => {
    const t = conCodigo();
    const al = (ms: number) => vistaDe(t, T0 + 2_000 + ms);
    expect(al(0).cuentaAtras).toBe(60);
    expect(al(0).secundaria).toBeNull();
    expect(al(30_500).cuentaAtras).toBe(30);
    expect(al(OTRO_CODIGO_A_LOS_MS - 1).cuentaAtras).toBe(1);
    expect(al(OTRO_CODIGO_A_LOS_MS).cuentaAtras).toBeNull();
    expect(al(OTRO_CODIGO_A_LOS_MS).secundaria).toEqual({ clave: "ccOtroCodigo", accion: "pedir" });
  });

  it("confirmando apaga todo y deja la principal con ruedita", () => {
    const t = siguiente(conCodigo(), { tipo: "confirmar" }, T0 + 9_000);
    const v = vistaDe(t, T0 + 9_000, 9);
    expect(t.estado).toBe("confirmando");
    expect(v.campoApagado).toBe(true);
    expect(v.principal).toEqual({ clave: "ccConfirmando", accion: "confirmar", apagada: true, ocupada: true });
    expect(v.secundaria).toBeNull();
    expect(v.cuentaAtras).toBeNull();
  });

  it("el desbloqueo apaga la principal y a los 8 segundos dice que espera la huella", () => {
    const t = siguiente(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), { tipo: "pedir-desbloqueo" }, T0);
    expect(t.estado).toBe("desbloqueo");
    expect(vistaDe(t, T0).principal).toEqual({ clave: "ccDesbloqueo", accion: "desbloquear", apagada: true, ocupada: true });
    expect(vistaDe(t, T0 + DESBLOQUEO_TARDA_MS - 1).linea).toBe(CLAVE_LINEA);
    expect(vistaDe(t, T0 + DESBLOQUEO_TARDA_MS).linea).toBe("ccEsperandoDesbloqueo");
  });

  it("si el desbloqueo no responde, a los 8 segundos la línea manda al correo y hay con qué hacerlo", () => {
    const t = siguiente(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), { tipo: "pedir-desbloqueo" }, T0);
    // Antes de los 8 segundos todavía se espera el cuadro del sistema: nada más para tocar.
    expect(vistaDe(t, T0 + DESBLOQUEO_TARDA_MS - 1).secundaria).toBeNull();
    expect(puedePedir(t, T0 + DESBLOQUEO_TARDA_MS - 1)).toBe(false);
    expect(siguiente(t, { tipo: "pedir-codigo" }, T0 + DESBLOQUEO_TARDA_MS - 1)).toBe(t);
    // Pasados, la línea habla del correo y aparece Confirmar mi correo como acción de texto, junto a la principal que espera.
    const v = vistaDe(t, T0 + DESBLOQUEO_TARDA_MS);
    expect(v.linea).toBe("ccEsperandoDesbloqueo");
    expect(v.principal).toEqual({ clave: "ccDesbloqueo", accion: "desbloquear", apagada: true, ocupada: true });
    expect(v.secundaria).toEqual({ clave: "ccConfirmar", accion: "pedir" });
    expect(puedePedir(t, T0 + DESBLOQUEO_TARDA_MS)).toBe(true);
    // Pedir el código desde ahí deja el desbloqueo atrás: manda, y si falla vuelve a la invitación.
    const mandando = siguiente(t, { tipo: "pedir-codigo" }, T0 + 9_000);
    expect(mandando.estado).toBe("mandando");
    expect(mandando.volverA).toBe("invita");
    expect(vistaDe(mandando, T0 + 9_000).linea).toBe(CLAVE_LINEA);
    expect(siguiente(mandando, { tipo: "fallo-al-mandar", falla: "red" }, T0 + 10_000).estado).toBe("invita");
    expect(siguiente(mandando, { tipo: "codigo-mandado" }, T0 + 10_000).estado).toBe("codigo");
  });

  it("un desbloqueo que contesta después de haber pedido el código no cambia nada", () => {
    const mandando = recorrer(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), [
      [{ tipo: "pedir-desbloqueo" }, T0],
      [{ tipo: "pedir-codigo" }, T0 + 9_000],
    ]);
    for (const tarde of [{ tipo: "desbloqueado" }, { tipo: "desbloqueo-cancelado" }, { tipo: "desbloqueo-no-permitido" }, { tipo: "fallo-del-desbloqueo", falla: "falla" }] as const) {
      expect(siguiente(mandando, tarde, T0 + 10_000), tarde.tipo).toBe(mandando);
    }
  });

  it("después del desbloqueo sigue pidiendo el correo y ya no ofrece el desbloqueo", () => {
    const t = recorrer(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), [
      [{ tipo: "pedir-desbloqueo" }, T0],
      [{ tipo: "desbloqueado" }, T0 + 1_000],
    ]);
    const v = vistaDe(t, T0 + 1_000);
    expect(t.estado).toBe("desbloqueado");
    expect(v.linea).toBe(CLAVE_DESBLOQUEO_LISTO);
    expect(v.principal).toEqual({ clave: "ccConfirmar", accion: "pedir", apagada: false, ocupada: false });
    expect(v.secundaria).toBeNull();
    // Pedir el código desde ahí sigue el camino de siempre.
    expect(siguiente(t, { tipo: "pedir-codigo" }, T0 + 2_000).estado).toBe("mandando");
  });

  it("si cierra el cuadro del desbloqueo vuelve a la invitación sin error, y si no lo deja abrir deja de ofrecerlo", () => {
    const base = recorrer(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), [[{ tipo: "pedir-desbloqueo" }, T0]]);
    const cancelado = siguiente(base, { tipo: "desbloqueo-cancelado" }, T0 + 1_000);
    expect(cancelado.estado).toBe("invita");
    expect(vistaDe(cancelado, T0 + 1_000).nota).toBeNull();
    expect(vistaDe(cancelado, T0 + 1_000).secundaria?.clave).toBe("ccDesbloqueo");
    const bloqueado = siguiente(base, { tipo: "desbloqueo-no-permitido" }, T0 + 1_000);
    expect(vistaDe(bloqueado, T0 + 1_000).nota).toBe("ccDesbloqueoBloqueado");
    expect(vistaDe(bloqueado, T0 + 1_000).secundaria).toBeNull();
    // Aunque una lectura nueva diga que se puede, el navegador ya dijo que acá no.
    expect(vistaDe(siguiente(bloqueado, { tipo: "lectura", ofreceDesbloqueo: true }, T0 + 2_000), T0 + 2_000).secundaria).toBeNull();
  });

  it("al terminar muestra la tilde con la frase de lo que se sabe, y a los 4 segundos la tarjeta se va", () => {
    const t = siguiente(siguiente(conCodigo(), { tipo: "confirmar" }, T0 + 9_000), { tipo: "confirmado", quedo: true }, T0 + 10_000);
    const v = vistaDe(t, T0 + 10_000);
    expect(t.estado).toBe("hecho");
    expect(v.tilde).toBe(true);
    expect(v.principal).toBeNull();
    expect(v.linea).toBe(PROMESA_VERIFICADA ? "ccConfirmado" : "ccConfirmadoSolo");
    const fuera = siguiente(t, { tipo: "terminar" }, T0 + 14_000);
    expect(fuera.estado).toBe("oculta");
    expect(vistaDe(fuera, T0 + 14_000).visible).toBe(false);
  });

  it("la promesa de entrar desde cualquier celular sigue apagada hasta que la prueba con dos navegadores pase", () => {
    expect(PROMESA_VERIFICADA).toBe(false);
  });

  it("con la promesa apagada ninguna línea de ningún estado dice que se entra desde otro celular o compu, en los dos idiomas", () => {
    const base = iniciar(T0, { ofreceDesbloqueo: true, recargado: false });
    const mandandoDesdeElDesbloqueo = siguiente(
      recorrer(base, [[{ tipo: "pedir-desbloqueo" }, T0], [{ tipo: "desbloqueado" }, T0 + 1_000]]),
      { tipo: "pedir-codigo" },
      T0 + 2_000,
    );
    const desbloqueo = siguiente(base, { tipo: "pedir-desbloqueo" }, T0);
    const estados: Array<[Tarjeta, number]> = [
      [base, T0],
      [siguiente(base, { tipo: "pedir-codigo" }, T0), T0],
      [mandandoDesdeElDesbloqueo, T0 + 2_000],
      [desbloqueo, T0],
      [desbloqueo, T0 + DESBLOQUEO_TARDA_MS],
      [recorrer(base, [[{ tipo: "pedir-desbloqueo" }, T0], [{ tipo: "desbloqueado" }, T0 + 1_000]]), T0 + 1_000],
      [conCodigo(), T0 + 2_000],
      [siguiente(siguiente(conCodigo(), { tipo: "confirmar" }, T0 + 9_000), { tipo: "confirmado", quedo: true }, T0 + 10_000), T0 + 10_000],
    ];
    const promete = /cualquier celular|cualquier compu|any phone|any computer|from another one|desde otro/i;
    for (const [t, ahora] of estados) {
      const clave = vistaDe(t, ahora).linea;
      expect(clave).not.toBeNull();
      for (const idioma of ["es", "en"] as const) {
        const frase = TEXTOS_CONFIRMAR[idioma][clave as string] ?? "";
        expect(frase, `${t.estado} en ${idioma}`).not.toBe("");
        // Prendida la promesa, las frases pueden prometerlo: esta prueba solo cuida el tiempo en que está apagada.
        if (!PROMESA_VERIFICADA) expect(promete.test(frase), `${t.estado} en ${idioma}: ${frase}`).toBe(false);
      }
    }
  });

  it("ningún estado visible tiene más de una acción principal", () => {
    const estados: Tarjeta[] = [
      iniciar(T0, { ofreceDesbloqueo: true, recargado: false }),
      siguiente(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), { tipo: "pedir-codigo" }, T0),
      conCodigo(),
      siguiente(conCodigo(), { tipo: "confirmar" }, T0 + 5_000),
      siguiente(iniciar(T0, { ofreceDesbloqueo: true, recargado: false }), { tipo: "pedir-desbloqueo" }, T0),
    ];
    for (const t of estados) {
      const v = vistaDe(t, T0 + 5_000, 9);
      expect(v.principal, t.estado).not.toBeNull();
      // La secundaria nunca repite la acción de la principal.
      if (v.secundaria) expect(v.secundaria.accion === v.principal?.accion && v.secundaria.clave === v.principal?.clave).toBe(false);
    }
  });
});

describe("los pedidos de código y sus topes", () => {
  it("un código no se puede volver a pedir hasta el minuto, salvo cuando dio viejo, vencido o equivocado", () => {
    const t = conCodigo();
    expect(puedePedir(t, T0 + 2_000 + OTRO_CODIGO_A_LOS_MS - 1)).toBe(false);
    expect(siguiente(t, { tipo: "pedir-codigo" }, T0 + 30_000)).toBe(t);
    expect(puedePedir(t, T0 + 2_000 + OTRO_CODIGO_A_LOS_MS)).toBe(true);
    const malo = siguiente(t, { tipo: "fallo-al-confirmar", falla: "codigo-malo" }, T0 + 20_000);
    expect(puedePedir(malo, T0 + 20_000)).toBe(true);
    expect(vistaDe(malo, T0 + 20_000).secundaria).toEqual({ clave: "ccOtroCodigo", accion: "pedir" });
  });

  it("tras reenviar la línea dice que sirve el código del correo más nuevo", () => {
    const primero = conCodigo();
    expect(vistaDe(primero, T0 + 3_000).usaElUltimo).toBe(false);
    const otro = recorrer(primero, [
      [{ tipo: "pedir-codigo" }, T0 + 70_000],
      [{ tipo: "codigo-mandado" }, T0 + 71_000],
    ]);
    expect(vistaDe(otro, T0 + 72_000).usaElUltimo).toBe(true);
    expect(otro.envios).toHaveLength(2);
  });

  it(`el sexto pedido en 15 minutos no sale: dice que fueron muchos y apaga la principal ${PAUSA_POR_MUCHOS_MS / 60_000} minutos`, () => {
    let t = iniciar(T0, { ofreceDesbloqueo: false, recargado: false });
    let ahora = T0;
    // Cinco pedidos, cada uno cuando el anterior ya cumplió su minuto.
    for (let n = 0; n < ENVIOS_PERMITIDOS; n += 1) {
      t = recorrer(t, [[{ tipo: "pedir-codigo" }, ahora], [{ tipo: "codigo-mandado" }, ahora + 500]]);
      ahora += OTRO_CODIGO_A_LOS_MS + 1_000;
    }
    expect(t.envios).toHaveLength(5);
    const sexto = siguiente(t, { tipo: "pedir-codigo" }, ahora);
    expect(sexto.estado).toBe("codigo");
    expect(sexto.envios).toHaveLength(5);
    const v = vistaDe(sexto, ahora);
    expect(v.nota).toBe("ccMuchos");
    expect(v.secundaria).toBeNull();
    expect(v.cuentaAtras).toBeNull();
    expect(puedePedir(sexto, ahora + PAUSA_POR_MUCHOS_MS - 1)).toBe(false);
    // Pasada la pausa el aviso se va y se puede pedir de nuevo (los envíos viejos ya salieron de la ventana de 15 minutos).
    expect(vistaDe(sexto, ahora + PAUSA_POR_MUCHOS_MS).nota).toBeNull();
    expect(puedePedir(sexto, ahora + PAUSA_POR_MUCHOS_MS)).toBe(true);
  });

  it("desde la invitación, el sexto pedido deja la principal apagada", () => {
    let t = iniciar(T0, { ofreceDesbloqueo: false, recargado: false });
    // Cinco envíos y una falla de confirmar que vuelve a la invitación, para pedir el sexto desde ahí.
    let ahora = T0;
    for (let n = 0; n < ENVIOS_PERMITIDOS; n += 1) {
      t = recorrer(t, [[{ tipo: "pedir-codigo" }, ahora], [{ tipo: "codigo-mandado" }, ahora + 500]]);
      t = siguiente(t, { tipo: "fallo-al-confirmar", falla: "sin-codigo" }, ahora + 800);
      expect(t.estado).toBe("invita");
      ahora += 2_000;
    }
    const sexto = siguiente(t, { tipo: "pedir-codigo" }, ahora);
    expect(sexto.estado).toBe("invita");
    expect(vistaDe(sexto, ahora).nota).toBe("ccMuchos");
    expect(vistaDe(sexto, ahora).principal?.apagada).toBe(true);
  });

  it("una falla al mandar vuelve al lugar de donde salió el pedido, con su nota", () => {
    const desdeInvita = recorrer(iniciar(T0, { ofreceDesbloqueo: false, recargado: false }), [
      [{ tipo: "pedir-codigo" }, T0],
      [{ tipo: "fallo-al-mandar", falla: "red" }, T0 + 1_000],
    ]);
    expect(desdeInvita.estado).toBe("invita");
    expect(vistaDe(desdeInvita, T0 + 1_000).nota).toBe("cpErrRed");
    expect(vistaDe(desdeInvita, T0 + 1_000).principal).toEqual({ clave: "ccConfirmar", accion: "pedir", apagada: false, ocupada: false });
    const desdeCodigo = recorrer(conCodigo(), [
      [{ tipo: "pedir-codigo" }, T0 + 70_000],
      [{ tipo: "fallo-al-mandar", falla: "falla" }, T0 + 71_000],
    ]);
    // El código anterior sigue sirviendo: se vuelve a donde se puede escribir.
    expect(desdeCodigo.estado).toBe("codigo");
    expect(vistaDe(desdeCodigo, T0 + 71_000).nota).toBe("ccFalla");
    const tarda = recorrer(iniciar(T0, { ofreceDesbloqueo: false, recargado: false }), [
      [{ tipo: "pedir-codigo" }, T0],
      [{ tipo: "fallo-al-mandar", falla: "tarda" }, T0 + 60_000],
    ]);
    expect(vistaDe(tarda, T0 + 60_000).nota).toBe("ccTarda");
    // Un código que sale después del tope cuenta igual: el correo llegó.
    const tarde = siguiente(tarda, { tipo: "codigo-mandado" }, T0 + 62_000);
    expect(tarde.estado).toBe("codigo");
    expect(tarde.mandadoEn).toBe(T0 + 62_000);
  });

  it("un servicio que dice muchos al mandar apaga la acción un rato", () => {
    const t = recorrer(iniciar(T0, { ofreceDesbloqueo: false, recargado: false }), [
      [{ tipo: "pedir-codigo" }, T0],
      [{ tipo: "fallo-al-mandar", falla: "muchos" }, T0 + 500],
    ]);
    expect(vistaDe(t, T0 + 500).nota).toBe("ccMuchos");
    expect(vistaDe(t, T0 + 500).principal?.apagada).toBe(true);
    expect(vistaDe(t, T0 + 500 + PAUSA_POR_MUCHOS_MS).principal?.apagada).toBe(false);
  });

  it("si la cuenta se está creando o el servicio no está, la tarjeta se oculta y no dice nada", () => {
    for (const falla of ["naciendo", "sin-servicio"] as const) {
      const t = recorrer(iniciar(T0, { ofreceDesbloqueo: false, recargado: false }), [
        [{ tipo: "pedir-codigo" }, T0],
        [{ tipo: "fallo-al-mandar", falla }, T0 + 500],
      ]);
      expect(t.estado, falla).toBe("oculta");
      expect(vistaDe(t, T0 + 500).visible, falla).toBe(false);
      expect(vistaDe(t, T0 + 500).nota, falla).toBeNull();
    }
  });
});

describe("lo que pasa cuando el código no sirve", () => {
  it("un código equivocado antes de los 5 minutos queda en el campo con su nota y deja pedir otro enseguida", () => {
    const t = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 20_000],
      [{ tipo: "fallo-al-confirmar", falla: "codigo-malo" }, T0 + 21_000],
    ]);
    const v = vistaDe(t, T0 + 21_000, 9);
    expect(t.estado).toBe("codigo");
    expect(v.nota).toBe("ccCodigoMalo");
    expect(v.conCodigo).toBe(true);
    expect(v.principal?.accion).toBe("confirmar");
    expect(v.secundaria?.clave).toBe("ccOtroCodigo");
  });

  it("pasados los 5 minutos del envío, un código que no sirve se dice vencido y la principal pasa a pedir otro", () => {
    const t = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 2_000 + CODIGO_VENCE_A_LOS_MS + 1],
      [{ tipo: "fallo-al-confirmar", falla: "codigo-malo" }, T0 + 2_000 + CODIGO_VENCE_A_LOS_MS + 2],
    ]);
    const v = vistaDe(t, T0 + 2_000 + CODIGO_VENCE_A_LOS_MS + 2);
    expect(t.estado).toBe("invita");
    expect(v.nota).toBe("ccCodigoVencido");
    expect(v.conCodigo).toBe(false);
    expect(v.principal).toEqual({ clave: "ccOtroCodigo", accion: "pedir", apagada: false, ocupada: false });
  });

  it("justo en los 5 minutos todavía cuenta como equivocado", () => {
    const t = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 2_000 + CODIGO_VENCE_A_LOS_MS],
      [{ tipo: "fallo-al-confirmar", falla: "codigo-malo" }, T0 + 2_000 + CODIGO_VENCE_A_LOS_MS],
    ]);
    expect(vistaDe(t, T0 + 2_000 + CODIGO_VENCE_A_LOS_MS).nota).toBe("ccCodigoMalo");
  });

  it("un código que la página ya no tiene se dice viejo, y recargado si la tarjeta abrió con la marca", () => {
    const viejo = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 9_000],
      [{ tipo: "fallo-al-confirmar", falla: "sin-codigo" }, T0 + 9_500],
    ]);
    expect(vistaDe(viejo, T0 + 9_500).nota).toBe("ccCodigoViejo");
    expect(vistaDe(viejo, T0 + 9_500).principal?.clave).toBe("ccOtroCodigo");
    const recargada = iniciar(T0, { ofreceDesbloqueo: false, recargado: true });
    const v = vistaDe(recargada, T0);
    expect(v.nota).toBe("ccCodigoRecargado");
    expect(v.principal).toEqual({ clave: "ccOtroCodigo", accion: "pedir", apagada: false, ocupada: false });
    // Con la tarjeta recargada, un código perdido sigue siendo el de la recarga.
    const sinCodigo = siguiente(recargada, { tipo: "fallo-al-confirmar", falla: "sin-codigo" }, T0 + 100);
    expect(sinCodigo.estado).toBe("invita");
  });

  it("el primer código tras una recarga sale con la línea del correo más nuevo, porque el anterior quedó en la bandeja", () => {
    const t = recorrer(iniciar(T0, { ofreceDesbloqueo: false, recargado: true }), [
      [{ tipo: "pedir-codigo" }, T0],
      [{ tipo: "codigo-mandado" }, T0 + 1_000],
    ]);
    expect(vistaDe(t, T0 + 1_000).usaElUltimo).toBe(true);
    expect(vistaDe(t, T0 + 1_000).nota).toBeNull();
  });

  it("una respuesta que dice que no quedó confirmada vuelve al campo con su nota", () => {
    const t = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 9_000],
      [{ tipo: "confirmado", quedo: false }, T0 + 10_000],
    ]);
    expect(t.estado).toBe("codigo");
    expect(vistaDe(t, T0 + 10_000, 9).nota).toBe("ccNoQuedo");
  });

  it("una respuesta tardía que dice que quedó confirmada cuenta igual", () => {
    const tarde = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 9_000],
      [{ tipo: "fallo-al-confirmar", falla: "tarda" }, T0 + 69_000],
      [{ tipo: "confirmado", quedo: true }, T0 + 70_000],
    ]);
    expect(tarde.estado).toBe("hecho");
  });

  it("sin conexión, tarda o falla: vuelve al campo con la nota y la principal encendida", () => {
    for (const [falla, nota] of [["red", "cpErrRed"], ["tarda", "ccTarda"], ["falla", "ccFalla"]] as const) {
      const t = recorrer(conCodigo(), [
        [{ tipo: "confirmar" }, T0 + 9_000],
        [{ tipo: "fallo-al-confirmar", falla }, T0 + 10_000],
      ]);
      const v = vistaDe(t, T0 + 10_000, 9);
      expect(t.estado, falla).toBe("codigo");
      expect(v.nota, falla).toBe(nota);
      expect(v.principal?.apagada, falla).toBe(false);
    }
  });

  it("si la cuenta se está creando al confirmar, la tarjeta se oculta sin decir que pida otro código", () => {
    const t = recorrer(conCodigo(), [
      [{ tipo: "confirmar" }, T0 + 9_000],
      [{ tipo: "fallo-al-confirmar", falla: "naciendo" }, T0 + 10_000],
    ]);
    expect(t.estado).toBe("oculta");
    expect(vistaDe(t, T0 + 10_000).nota).toBeNull();
  });

  it("ignora los eventos que no vienen al caso en cada estado", () => {
    const inicio = iniciar(T0, { ofreceDesbloqueo: false, recargado: false });
    expect(siguiente(inicio, { tipo: "confirmar" }, T0)).toBe(inicio);
    expect(siguiente(inicio, { tipo: "codigo-mandado" }, T0)).toBe(inicio);
    expect(siguiente(inicio, { tipo: "terminar" }, T0)).toBe(inicio);
    const oculta = siguiente(inicio, { tipo: "ocultar" }, T0);
    expect(siguiente(oculta, { tipo: "confirmado", quedo: true }, T0 + 1)).toBe(oculta);
    expect(siguiente(oculta, { tipo: "ocultar" }, T0 + 2)).toBe(oculta);
  });
});

describe("cómo se entiende lo que contesta el servicio de cuentas", () => {
  it("la cuenta sin billetera todavía es naciendo, al mandar y al confirmar", () => {
    const e = errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND", { reason: "this user has no Turnkey wallet" });
    expect(clasificarFallaAlMandar(e)).toBe("naciendo");
    expect(clasificarFallaAlConfirmar(e)).toBe("naciendo");
  });

  it("un código que la página no mandó es viejo, y no se confunde con la cuenta sin billetera", () => {
    const e = errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND", { reason: "no code was sent" });
    expect(clasificarFallaAlConfirmar(e)).toBe("sin-codigo");
    expect(clasificarFallaAlMandar(e)).toBe("falla");
  });

  it("el rechazo del servicio que habla del código es un código malo, y uno por límite es muchos", () => {
    const malo = errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 400, message: "the OTP code has either expired or is invalid" });
    expect(clasificarFallaAlConfirmar(malo)).toBe("codigo-malo");
    const limite = errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 429, message: "too many requests" });
    expect(clasificarFallaAlMandar(limite)).toBe("muchos");
    expect(clasificarFallaAlConfirmar(limite)).toBe("muchos");
    // Otro estado del servicio al mandar es una falla, no un problema de quien escribe.
    expect(clasificarFallaAlMandar(errorDelKit("SDK_COSIGN_TURNKEY_REJECTED", { turnkeyStatus: 500, message: "boom" }))).toBe("falla");
  });

  it("un código con el motivo de Pollar (inválido o vencido) también es un código malo", () => {
    expect(clasificarFallaAlConfirmar(errorDelKit("SDK_INVALID_OTP"))).toBe("codigo-malo");
    expect(clasificarFallaAlConfirmar(new Error("OTP EXPIRED"))).toBe("codigo-malo");
  });

  it("el servicio sin configurar, sin créditos o con un 402 oculta la tarjeta", () => {
    expect(clasificarFallaAlMandar(errorDelKit("SDK_COSIGN_NOT_CONFIGURED", { reason: "no Auth Proxy config" }))).toBe("sin-servicio");
    expect(clasificarFallaAlMandar(errorDelKit("SDK_CREDITS_INSUFFICIENT"))).toBe("sin-servicio");
    expect(clasificarFallaAlMandar(errorDelKit("SDK_ALGO", { status: 402 }))).toBe("sin-servicio");
    expect(clasificarFallaAlConfirmar(errorDelKit("SDK_COSIGN_NOT_CONFIGURED"))).toBe("sin-servicio");
  });

  it("una sesión cerrada o de otra cuenta no es de red ni se arregla repitiendo: oculta la tarjeta", () => {
    const sinSesion = new Error(SIN_SESION);
    expect(clasificarFallaAlMandar(sinSesion)).toBe("sin-sesion");
    expect(clasificarFallaAlConfirmar(sinSesion)).toBe("sin-sesion");
    expect(clasificarFallaDelDesbloqueo(sinSesion)).toBe("sin-sesion");
    // Sin conexión sigue siendo de red: no se llama a nadie.
    expect(clasificarFallaAlMandar(sinSesion, false)).toBe("red");
    const desdeInvita = iniciar(T0, { ofreceDesbloqueo: true, recargado: false });
    const alMandar = recorrer(desdeInvita, [[{ tipo: "pedir-codigo" }, T0], [{ tipo: "fallo-al-mandar", falla: "sin-sesion" }, T0 + 500]]);
    const alConfirmar = recorrer(conCodigo(), [[{ tipo: "confirmar" }, T0 + 5_000], [{ tipo: "fallo-al-confirmar", falla: "sin-sesion" }, T0 + 5_500]]);
    const alDesbloquear = recorrer(desdeInvita, [[{ tipo: "pedir-desbloqueo" }, T0], [{ tipo: "fallo-del-desbloqueo", falla: "sin-sesion" }, T0 + 500]]);
    for (const t of [alMandar, alConfirmar, alDesbloquear]) {
      expect(t.estado).toBe("oculta");
      expect(vistaDe(t, T0 + 6_000).visible).toBe(false);
      expect(vistaDe(t, T0 + 6_000).nota).toBeNull();
    }
  });

  it("sin conexión no se llama a nadie, un tope vencido tarda y un corte de la red es de red", () => {
    expect(clasificarFallaAlMandar(new Error("x"), false)).toBe("red");
    expect(clasificarFallaAlConfirmar(new Error("x"), false)).toBe("red");
    expect(clasificarFallaAlMandar(SIN_RESPUESTA)).toBe("tarda");
    expect(clasificarFallaAlConfirmar(SIN_RESPUESTA)).toBe("tarda");
    expect(clasificarFallaAlMandar(new TypeError("Failed to fetch"))).toBe("red");
    expect(clasificarFallaAlMandar(new Error("algo raro"))).toBe("falla");
    expect(clasificarFallaAlMandar(null)).toBe("falla");
  });

  it("las fallas del desbloqueo son de red, de tope o generales", () => {
    expect(clasificarFallaDelDesbloqueo(SIN_RESPUESTA)).toBe("tarda");
    expect(clasificarFallaDelDesbloqueo(new TypeError("Failed to fetch"))).toBe("red");
    expect(clasificarFallaDelDesbloqueo(new Error("otra cosa"))).toBe("falla");
  });
});

describe("la marca del código mandado y el campo", () => {
  it("la marca sirve mientras tenga menos de 5 minutos y nada más", () => {
    const ahora = T0 + 10_000_000;
    expect(marcaVigente(String(ahora - 1_000), ahora)).toBe(true);
    expect(marcaVigente(String(ahora - CODIGO_VENCE_A_LOS_MS + 1), ahora)).toBe(true);
    expect(marcaVigente(String(ahora - CODIGO_VENCE_A_LOS_MS), ahora)).toBe(false);
    expect(marcaVigente(null, ahora)).toBe(false);
    expect(marcaVigente("1", ahora)).toBe(false);
    expect(marcaVigente("hola", ahora)).toBe(false);
    expect(marcaVigente(String(ahora + 5_000), ahora)).toBe(false);
    expect(marcaVigente("", ahora)).toBe(false);
  });

  it("el código pegado pierde los espacios de más", () => {
    expect(limpiarElCodigo(" AB12 CD34 E ")).toBe("AB12CD34E");
    expect(limpiarElCodigo("AB\n12")).toBe("AB12");
  });
});

describe("cuándo una confirmación está en curso", () => {
  const nueva = (recargado = false): Tarjeta => iniciar(T0, { ofreceDesbloqueo: true, recargado });

  it("la tarjeta recién abierta no está en curso", () => {
    expect(enCurso(nueva())).toBe(false);
  });

  it("mandar el código, tenerlo en el campo, confirmar y usar el desbloqueo están en curso", () => {
    expect(enCurso(siguiente(nueva(), { tipo: "pedir-codigo" }, T0))).toBe(true);
    expect(enCurso(conCodigo())).toBe(true);
    expect(enCurso(siguiente(conCodigo(), { tipo: "confirmar" }, T0 + 5_000))).toBe(true);
    expect(enCurso(siguiente(nueva(), { tipo: "pedir-desbloqueo" }, T0))).toBe(true);
  });

  it("Listo se ve en curso, y cuando la tarjeta se va deja de estarlo", () => {
    const hecho = recorrer(conCodigo(), [[{ tipo: "confirmar" }, T0 + 5_000], [{ tipo: "confirmado", quedo: true }, T0 + 6_000]]);
    expect(hecho.estado).toBe("hecho");
    expect(enCurso(hecho)).toBe(true);
    expect(enCurso(siguiente(hecho, { tipo: "terminar" }, T0 + 10_000))).toBe(false);
  });

  it("la página recargada con un código mandado hace menos de cinco minutos abre en curso", () => {
    expect(enCurso(nueva(true))).toBe(true);
  });

  it("si mandar falla vuelve a la invitación y deja de estar en curso", () => {
    const fallo = recorrer(nueva(), [[{ tipo: "pedir-codigo" }, T0], [{ tipo: "fallo-al-mandar", falla: "red" }, T0 + 1_000]]);
    expect(fallo.estado).toBe("invita");
    expect(enCurso(fallo)).toBe(false);
  });

  it("tras el desbloqueo, sin haber mandado ningún código, no está en curso", () => {
    const listo = recorrer(nueva(), [[{ tipo: "pedir-desbloqueo" }, T0], [{ tipo: "desbloqueado" }, T0 + 1_000]]);
    expect(listo.estado).toBe("desbloqueado");
    expect(enCurso(listo)).toBe(false);
  });

  it("oculta no está en curso", () => {
    expect(enCurso(siguiente(nueva(), { tipo: "ocultar" }, T0))).toBe(false);
  });
});
