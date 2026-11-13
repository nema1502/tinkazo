import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXTOS_COMPRA } from "./compra-textos";
import { T } from "./i18n";

/**
 * Los textos de la compra con el QR del banco (`compra-textos.ts`): la ventana Tu compra, la caja Tu primer paquete de
 * Dejá tu cuenta lista y sus fallas, en español y en inglés.
 *
 * Poco texto: un título de 6 palabras como mucho y una línea de 14 como mucho. Las palabras se cuentan separadas por
 * espacios, y una variable cuenta como una. Sin tecnicismos a la vista: el nombre de la moneda solo en el dato de Pagá
 * desde tu app, la cuenta de paso solo en lo plegado, y dólares (no dólares digitales) para los montos.
 */

const IDIOMAS = ["es", "en"] as const;
const CLAVES = Object.keys(TEXTOS_COMPRA.es);
const texto = (l: "es" | "en", k: string): string => String(TEXTOS_COMPRA[l][k] ?? T[l][k] ?? "");
const palabras = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const variables = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
const conClave = (re: RegExp, l: "es" | "en"): string[] => CLAVES.filter((k) => re.test((TEXTOS_COMPRA[l][k] as string).replace(/\{\w+\}/g, ""))).sort();

/** Los títulos de cada pantalla: 6 palabras como mucho. */
const TITULOS = [
  "compraVentana",
  "compraCajaTitulo",
  "compraPreparandoTitulo",
  "compraVerifTitulo",
  "compraIdTitulo",
  "cargaFormTitulo",
  "cargaSegipTitulo",
  "compraAltaTitulo",
  "compraPrepTitulo",
  "compraPrecioTitulo",
  "compraQrTitulo",
  "cargaYaPagasteTitulo",
  "compraEsperandoTitulo",
  "cargaEnCaminoTitulo",
  "compraAntesTitulo",
  "compraAntesTitulo1",
  "compraAprobarTitulo",
  "compraAprobarTituloSinN",
  "compraLlegoTitulo",
  "compraSaldoTitulo",
  "compraPagandoTitulo",
  "compraListoTitulo",
  "compraAppTitulo",
  "compraSinQrTitulo",
  "compraRevisionTitulo",
  "compraSegipNoTitulo",
  "compraRechazoTitulo",
  "compraQrVencioTitulo",
  "compraFrenadaTitulo",
  "compraMenosTitulo",
  "compraNoVendeTitulo",
  "compraPagoRaroTitulo",
  "compraRaroTitulo",
  "compraDesconocidoTitulo",
  "compraFalloTitulo",
  "compraOtraOrdenTitulo",
  "compraTopeDeQrTitulo",
  "compraSesionTitulo",
];

/** La única línea a la vista de cada pantalla, o el aviso de la caja: 14 palabras como mucho. */
const LINEAS = [
  "compraBajada",
  "compraCuentaLinea",
  "compraTeEspera",
  "compraSigueLinea",
  "compraEsperaAprobar",
  "compraLlegoAviso",
  "compraRevisionAviso",
  "compraRechazoAviso",
  "compraCerrarSesionAviso",
  "compraPreparandoLinea",
  "compraVerifLinea",
  "compraIdLinea",
  "compraIdEsperando",
  "cargaIdBloqueada",
  "compraIdVencida",
  "compraFormLinea",
  "cargaSegipTexto",
  "compraAltaLinea",
  "compraPrepLinea",
  "compraPrecioLinea",
  "compraPrecioLinea1",
  "compraPrecioLineaSinN",
  "compraPrecioVencio",
  "compraQrLinea",
  "compraQrLineaCel",
  "compraQrLineaIos",
  "compraQrGuardadoLinea",
  "compraTodaviaNoLinea",
  "compraQrFalta",
  "cargaYaPagasteTexto",
  "compraEsperandoLinea",
  "compraPagoTarda",
  "cargaFaltan",
  "compraFaltaPoco",
  "compraTardaMas",
  "compraAntesLinea",
  "compraAntesLinea1",
  "compraConfirmaPermisoCambio",
  "compraConfirmaCambio",
  "compraConfirmaPermisoEnvio",
  "compraConfirmaEnvio",
  "compraAprobarNoSalio",
  "compraLlegoLinea",
  "compraSaldoLinea",
  "compraPagandoLinea",
  "compraAppLinea",
  "compraSinQrLinea",
  "compraRevisionLinea",
  "compraSegipNo",
  "compraRechazoLinea",
  "compraQrVencioCerrada",
  "compraQrVencioAbierta",
  "compraFrenadaVos",
  "compraFrenadaPollar",
  "compraFrenadaTinkazo",
  "compraMenosLinea",
  "compraMenosLinea1",
  "compraNoVendeLinea",
  "compraSinRed",
  "compraPagoNoSalio",
  "compraPagoNoAlcanzo",
  "compraPagoSinPatrocinio",
  "compraPagoRaro",
  "compraPagoNoSeSabe",
  "compraPagoSinVer",
  "compraRaroLinea",
  "compraDesconocidoLinea",
  "compraFalloSinPago",
  "compraFalloSinVerPago",
  "compraFalloConPago",
  "cargaDevueltaSinMonto",
  "compraTopeDeQr",
  "compraOtraOrdenLinea",
  "compraNoVendeSinCarga",
  "compraSesionLinea",
];

/** Lo que va plegado en Más detalles: el único lugar donde se nombra la cuenta de paso. */
const PLEGADOS_DE_LA_CUENTA_DE_PASO = ["cargaAprobarEnvio", "cargaAprobarPermiso", "cargaAprobarPermisoEnvio", "cargaAprobarPermisoEnvioSinN", "cargaAprobarPermisoSinN", "compraAprobarTarde", "compraPrepMas"];

/** Los que ya existen en el diccionario y la compra usa tal cual: no se vuelven a definir. */
const DE_HOY = ["saldoVolverAMirar", "clProbarDeNuevo", "clActivarBoton", "clSeguir", "clErrRed", "clErrSesion", "clEntrarDeNuevo", "pagoListoQuedan", "pagoListoQueda1", "pagoYaPague", "pagoMonto", "pagoCuenta", "pagoCopiar", "pagoParaCuenta", "pagoVence", "cupoOfUsarCupon", "altaPrimerPaquete", "altaTexto", "acctClose"];

describe("los textos de la compra con QR", () => {
  it("están en los dos idiomas, con las mismas claves y sin ninguno vacío", () => {
    expect(CLAVES.length).toBeGreaterThan(100);
    expect(Object.keys(TEXTOS_COMPRA.en).sort()).toEqual([...CLAVES].sort());
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_COMPRA[l][k]?.trim(), `${l} ${k}`).toBeTruthy();
  });

  it("las claves nuevas son de la compra o de las pantallas de la carga que la compra reusa", () => {
    for (const k of CLAVES) expect(/^(compra|carga)[A-Z0-9]/.test(k), k).toBe(true);
  });

  it("los dos idiomas llevan los mismos datos entre llaves", () => {
    for (const k of CLAVES) expect(variables(TEXTOS_COMPRA.en[k] as string), k).toEqual(variables(TEXTOS_COMPRA.es[k] as string));
  });

  it("cada título tiene 6 palabras o menos, en los dos idiomas", () => {
    for (const k of TITULOS) for (const l of IDIOMAS) {
      expect(texto(l, k), `${l} ${k}`).not.toBe("");
      expect(palabras(texto(l, k)), `${l} ${k}: ${texto(l, k)}`).toBeLessThanOrEqual(6);
    }
  });

  it("cada línea tiene 14 palabras o menos, en los dos idiomas", () => {
    for (const k of LINEAS) for (const l of IDIOMAS) {
      expect(texto(l, k), `${l} ${k}`).not.toBe("");
      expect(palabras(texto(l, k)), `${l} ${k}: ${texto(l, k)}`).toBeLessThanOrEqual(14);
    }
  });

  it("sin comillas angulares, punto y coma, punto medio, rayas, flechas ni signos de exclamación", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_COMPRA[l][k], `${l} ${k}`).not.toMatch(/[«»‹›;·•—–―→←↑↓⇒⟶➜!¡]/);
  });

  it("USDC y Stellar solo en el dato de la moneda de Pagá desde tu app", () => {
    for (const l of IDIOMAS) expect(conClave(/\b(USDC|Stellar)\b/i, l), l).toEqual(["compraDatoMoneda"]);
  });

  it("memo, en español solo en el plegado que lo explica, y en inglés donde se nombra la nota", () => {
    expect(conClave(/\bmemo\b/i, "es")).toEqual(["compraNotaMemo"]);
    expect(conClave(/\bmemo\b/i, "en")).toEqual(["compraAppLinea", "compraNotaMemo", "compraNotaRotulo"]);
  });

  it("dólares digitales solo para el camino de pagar con ellos y en el plegado que explica qué es el saldo: para los montos, dólares", () => {
    // Pagar desde otra app sonaba a pagar desde otro banco: quien solo tiene banco lo tocaba y llegaba a una pantalla que
    // no puede usar. El camino se llama por lo que pide, dólares digitales, en el enlace que lleva a él y en su pantalla.
    const conDigitales = ["compraAppTitulo", "compraOtraApp", "compraRechazoLinea", "compraSaldoMas", "compraSinDolares", "compraSinQrLinea"];
    expect(conClave(/d[oó]lares digitales/i, "es")).toEqual(conDigitales);
    expect(conClave(/digital dollars/i, "en")).toEqual(conDigitales);
  });

  it("lo que la persona confirma con un toque se llama confirmación, nunca paso ni aprobar: pasos son los del camino de la llama", () => {
    expect(conClave(/aprob/i, "es")).toEqual([]);
    expect(conClave(/approv/i, "en")).toEqual([]);
    const deConfirmar = [
      "compraPrecioLinea", "compraPrecioLinea1", "compraPrecioLineaSinN", "compraAntesTitulo", "compraAntesTitulo1", "compraAntesLinea", "compraAntesLinea1",
      "compraAprobarTitulo", "compraAprobarTituloSinN", "compraDatoSiCerras", "compraDatoSiCerras1", "compraEsperaAprobar", "compraPodesCerrar", "cargaVerPrimerPaso",
    ];
    for (const k of deConfirmar) {
      expect(TEXTOS_COMPRA.es[k], k).not.toMatch(/\bpasos?\b/i);
      expect(TEXTOS_COMPRA.en[k], k).not.toMatch(/\bsteps?\b/i);
    }
  });

  it("la pestaña del navegador se dice página, y la casa de cambio se presenta antes de pedir nada", () => {
    expect(conClave(/pestaña/i, "es")).toEqual([]);
    expect(conClave(/\btabs?\b/i, "en")).toEqual([]);
    expect(TEXTOS_COMPRA.es.compraDatoCambia).toBe("Casa de cambio: Stereum");
  });

  it("la cuenta de paso solo en lo plegado, nunca a la vista", () => {
    expect(conClave(/cuenta de paso/i, "es")).toEqual(PLEGADOS_DE_LA_CUENTA_DE_PASO);
    expect(conClave(/pass-through account/i, "en")).toEqual(PLEGADOS_DE_LA_CUENTA_DE_PASO);
    for (const k of [...TITULOS, ...LINEAS]) expect(PLEGADOS_DE_LA_CUENTA_DE_PASO, k).not.toContain(k);
  });

  it("nunca token, hash, transacción, billetera, red, firma, KYC, blockchain, XLM ni drand", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_COMPRA.es[k], `es ${k}`).not.toMatch(/\b(token|hash|transacci[oó]n|billetera|wallet|red|redes|firma|firmar|KYC|blockchain|XLM|lumens?|drand|cripto)\b/i);
      expect(TEXTOS_COMPRA.en[k], `en ${k}`).not.toMatch(/\b(token|hash|transactions?|wallet|network|signature|sign it|KYC|blockchain|XLM|lumens?|drand|crypto)\b/i);
    }
  });

  it("nunca rifa, lotería, raffle, ticket, boleto ni apuesta", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_COMPRA[l][k], `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|lottery|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i);
  });

  it("no promete tiempos ni dice que la verificación es una sola vez o corta", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_COMPRA.es[k], `es ${k}`).not.toMatch(/es una sola vez|una sola vez por|cortos?\b|un minuto|la ley pide/i);
      expect(TEXTOS_COMPRA.en[k], `en ${k}`).not.toMatch(/one-time|only once per|short steps|a minute|one minute|the law/i);
    }
  });

  it("no promete plazos que dependen del banco o de otra empresa", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_COMPRA.es[k], `es ${k}`).not.toMatch(/en unos minutos|unos segundos|en un rato/i);
      expect(TEXTOS_COMPRA.en[k], `en ${k}`).not.toMatch(/a few seconds|tell you soon|in a while/i);
    }
  });

  it("Pollar se nombra junto con lo que es: la empresa que mueve el dinero", () => {
    for (const k of conClave(/\bPollar\b/, "es")) expect(TEXTOS_COMPRA.es[k], k).toMatch(/empresa/);
    for (const k of conClave(/\bPollar\b/, "en")) expect(TEXTOS_COMPRA.en[k], k).toMatch(/compan(y|ies)/);
  });

  it("el modo Oficial se llama Oficial en español y Live en inglés, y Prueba es Test", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_COMPRA.es[k], k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(TEXTOS_COMPRA.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });

  it("el español pasa el glosario de español neutral (la misma lista que pnpm check:glosario)", async () => {
    const ruta = "../scripts/lib/glosario.mjs";
    const lib = (await import(/* @vite-ignore */ ruta)) as {
      compilar: (g: unknown) => unknown[];
      buscarFaltas: (t: { texto: string; linea: number }[], e: unknown[], n?: string[]) => { estado: string; encontrada: string }[];
    };
    const glosario = JSON.parse(readFileSync("scripts/lib/glosario-neutral.json", "utf8")) as { nombresDeJuegos?: string[] };
    const entradas = lib.compilar(glosario);
    const faltas = CLAVES.flatMap((k, i) =>
      lib
        .buscarFaltas([{ texto: TEXTOS_COMPRA.es[k] as string, linea: i + 1 }], entradas, glosario.nombresDeJuegos ?? [])
        .filter((f) => f.estado !== "avisar")
        .map((f) => `${k}: ${f.encontrada}`),
    );
    expect(faltas).toEqual([]);
  });

  it("los Bs van antes del número, con el mismo formato en las dos lenguas", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_COMPRA[l][k], `${l} ${k}`).not.toMatch(/\}\s*Bs\b|\d\s*Bs\b/);
    for (const k of ["compraPrecioTitulo", "compraDatoMonto", "compraDatoTasa", "compraMinimo", "compraQrAlt"]) for (const l of IDIOMAS) expect(TEXTOS_COMPRA[l][k], `${l} ${k}`).toMatch(/Bs \{\w+\}/);
  });

  it("el correo de ayuda es el de Tinkazo y no hay otro", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) {
      const correos = (TEXTOS_COMPRA[l][k] as string).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
      for (const c of correos) expect(c, `${l} ${k}`).toBe("hola@tinkazo.app");
    }
  });
});

describe("cada pantalla dice su texto, palabra por palabra", () => {
  // Los textos acordados para cada pantalla de la compra, tal cual. Los que se reescribieron (un título que pasaba de 6
  // palabras, y frases con un toque en el sentido que el glosario de español neutral no deja) van en la prueba de abajo.
  const PLAN: Record<string, [string, string]> = {
    compraDatoPaquete: ["Para organizar: {sorteos}", "To run: {sorteos}"],
    compraDatoPrecio: ["Precio: {precio}", "Price: {precio}"],
    compraDatoSaldo: ["Tu saldo: {n} dólares", "Your balance: US${n}"],
    compraDatoQueda: ["Queda en tu saldo: unos {n} dólares", "Stays in your balance: about US${n}"],
    compraDatoSeUsan: ["Se usa lo que cargaste: {n} dólares", "From what you loaded: US${n}"],
    compraDatoVale: ["Precio válido hasta: {hora}", "Price valid until: {hora}"],
    compraDatoMonto: ["Monto: Bs {bs}", "Amount: Bs {bs}"],
    compraDatoVence: ["Vence: {hora}", "Expires: {hora}"],
    compraDatoNumero: ["Número de compra: {orden}", "Purchase number: {orden}"],
    compraDatoCambia: ["Casa de cambio: Stereum", "Currency exchange: Stereum"],
    compraDatoDonde: ["Tu dinero: {donde}", "Your money: {donde}"],
    compraDatoSiCerras: ["Si cerrás: volvé para confirmar {n} veces", "If you close: come back to confirm {n} times"],
    compraDatoSiCerras1: ["Si cerrás: volvé para confirmar una vez", "If you close: come back to confirm once"],
    compraDondeNada: ["no se movió nada", "nothing has moved"],
    compraDondeBanco: ["en tu banco, si todavía no pagaste", "in your bank, if you haven't paid yet"],
    compraDondeSaliendo: ["saliendo de tu banco hacia Stereum", "leaving your bank for Stereum"],
    compraDondeStereum: ["con Stereum, que lo pasa a dólares", "with Stereum, turning it into dollars"],
    compraDondePaso: ["en una cuenta tuya, esperando que confirmes", "in an account of yours, waiting for you to confirm"],
    compraDondeViaje: ["en camino a tu cuenta", "on its way to your account"],
    compraDondeCuenta: ["en tu cuenta, como saldo", "in your account, as balance"],
    compraDondeRevision: ["lo está revisando Pollar, la empresa que lo mueve", "Pollar, the company that moves it, is checking on it"],
    compraDondeTinkazo: ["en camino a Tinkazo", "on its way to Tinkazo"],
    compraDondeDevuelto: ["devuelto a tu banco", "returned to your bank"],
    compraNoEstoy: ["No estoy en Bolivia", "I'm not in Bolivia"],
    compraEstoy: ["Estoy en Bolivia", "I'm in Bolivia"],
    compraOtraApp: ["Pagar con dólares digitales", "Pay with digital dollars"],
    compraEscribinos: ["Escribir a Tinkazo", "Email Tinkazo"],
    compraPagarSaldo: ["Pagar {precio} con mi saldo", "Pay {precio} from my balance"],
    compraTerminar: ["Terminar mi compra", "Finish my purchase"],
    compraSeguirBoton: ["Seguir con mi compra", "Continue my purchase"],
    compraVentana: ["Tu compra", "Your purchase"],
    compraEtapaIdentidad: ["Tu identidad", "Your identity"],
    compraEtapaPago: ["Tu pago", "Your payment"],
    compraEtapaN: ["{etapa}: {n} de {total}", "{etapa}: {n} of {total}"],
    compraTodaviaNo: ["Todavía no pagué", "I haven't paid yet"],
    compraNoPague: ["No lo pagué, pedir otro QR", "I didn't pay, get a new QR"],
    compraMandar: ["Mandar mis dólares", "Send my dollars"],
    compraBajada: ["Para tu primer paquete: tu cuenta, tu identidad y el pago con QR.", "For your first pack: your account, your identity and the QR payment."],
    compraCuentaLinea: ["Después de activarla, verificás tu identidad y pagás con el QR de tu banco.", "After that, you verify your identity and pay with your bank's QR."],
    compraCuentaMas: [
      "La primera vez, Stereum, la empresa que cambia tus bolivianos, pide una foto de tu carnet y de tu cara. No tiene otro costo: va dentro del pago con QR de la primera vez.",
      "The first time, Stereum, the company that exchanges your bolivianos, asks for a photo of your ID card and your face. It has no other cost: it is part of the first QR payment.",
    ],
    compraCajaTitulo: ["Tu primer paquete", "Your first pack"],
    compraTeEspera: ["Tu compra te espera donde la dejaste.", "Your purchase is waiting where you left it."],
    compraSigueLinea: ["Tu compra sigue en camino.", "Your purchase is still on its way."],
    compraEsperaAprobar: ["Tu compra espera una confirmación tuya.", "Your purchase is waiting for your confirmation."],
    compraRevisionAviso: ["Tu verificación está en revisión.", "Your check is under review."],
    compraRechazoAviso: ["No pudimos verificar tu identidad.", "We couldn't verify your identity."],
    compraCerrarSesionAviso: ["Tenés una compra en camino. Para terminarla vas a confirmar que sos vos.", "You have a purchase on its way. To finish it, you'll confirm it's you."],
    compraPreparandoTitulo: ["Preparando tu compra", "Getting your purchase ready"],
    compraPreparandoLinea: ["Miramos qué falta para darte el precio.", "We're checking what's needed to give you the price."],
    compraVerifTitulo: ["Verificá tu identidad", "Verify your identity"],
    compraVerifLinea: ["Tené a mano tu carnet.", "Have your ID card ready."],
    cargaVerifEmpezar: ["Empezar", "Start"],
    compraVerifPasos: ["Son cuatro pasos: tu carnet y tu cara, unos datos, el SEGIP y tu alta con Stereum.", "Four steps: your ID card and face, a few details, SEGIP, and signing up with Stereum."],
    compraVerifDatos: [
      "Tus datos van a tres empresas. Pollar mueve tu dinero, Didit mira tu carnet y tu cara, y Stereum cambia tus bolivianos. Tinkazo no los guarda ni los usa.",
      "Your details go to three companies. Pollar moves your money, Didit checks your ID card and face, and Stereum exchanges your bolivianos. Tinkazo doesn't keep or use them.",
    ],
    cargaVerifGratis: ["Verificarte no tiene otro costo: va dentro del pago con QR de la primera vez.", "Verifying has no other cost: it is part of the first QR payment."],
    compraIdTitulo: ["Tu carnet y tu cara", "Your ID card and face"],
    compraIdLinea: ["Se abre otra página para tu carnet. Buscá buena luz y después volvé acá.", "Another page opens for your ID card. Find good light, then come back here."],
    cargaIdAbrir: ["Abrir la verificación", "Open the check"],
    compraIdEsperando: ["Esperando que termines en la otra página.", "Waiting for you to finish on the other page."],
    cargaIdYaTermine: ["Ya terminé", "I'm done"],
    cargaIdBloqueada: ["Tu navegador no dejó abrir la otra página. Tocá este enlace para abrirla.", "Your browser didn't let the other page open. Tap this link to open it."],
    cargaIdOtraVez: ["Empezar de nuevo", "Start again"],
    cargaFormTitulo: ["Unos datos tuyos", "A few details about you"],
    compraFormLinea: ["Los pide Stereum para darte de alta.", "Stereum needs them to sign you up."],
    cargaFormGuardar: ["Guardar y seguir", "Save and continue"],
    cargaSegipTitulo: ["Confirmá tus datos", "Confirm your details"],
    cargaSegipTexto: ["Así figuran en tu carnet. Se comparan con el SEGIP.", "This is how they appear on your ID card. They're checked with SEGIP."],
    cargaSegipOk: ["Confirmar mis datos", "Confirm my details"],
    compraAltaTitulo: ["Tu alta con Stereum", "Sign up with Stereum"],
    compraAltaLinea: ["Stereum, la casa de cambio, necesita estos datos para darte de alta.", "Stereum, the currency exchange, needs these details to sign you up."],
    cargaAltaOk: ["Darme de alta", "Sign me up"],
    compraAltaAcepto: ["Al tocar Darme de alta aceptás que Stereum reciba estos datos.", "By tapping Sign me up you agree that Stereum receives these details."],
    compraPrepTitulo: ["Falta preparar tu cuenta", "Get your account ready"],
    compraPrepLinea: ["Tus bolivianos llegan como dólares. Esto deja tu cuenta lista y no cobra nada.", "Your bolivianos arrive as dollars. This gets your account ready and costs nothing."],
    compraPrepBoton: ["Preparar mi cuenta", "Get my account ready"],
    compraPrepMas: ["Tus dólares pasan por una cuenta de paso que es tuya. Lo que sale de ahí lo confirmás vos.", "Your dollars go through a pass-through account that's yours. Whatever leaves it, you confirm."],
    compraPrecioTitulo: ["Pagás Bs {bs}", "You pay Bs {bs}"],
    compraPrecioLinea: ["Con el QR de tu banco. Después confirmás {n} veces acá.", "With your bank's QR. Then you confirm {n} times here."],
    compraVerQr: ["Ver el QR", "Show the QR"],
    compraComoSePaga: ["El pago con QR cubre lo que cuesta pasar tus bolivianos a dólares.", "The QR payment covers what it costs to turn your bolivianos into dollars."],
    compraMinimo: ["Lo mínimo para pagar con QR es Bs {min}.", "The minimum to pay by QR is Bs {min}."],
    compraPrecioVencio: ["El precio cambió. Este es el nuevo.", "The price changed. Here's the new one."],
    compraQrLinea: ["Escanealo con la app de tu banco y pagalo una sola vez.", "Scan it with your bank's app and pay it only once."],
    compraQrLineaCel: ["Guardá el QR, abrilo en la app de tu banco y pagalo una vez.", "Save the QR, open it in your bank's app and pay it once."],
    compraQrLineaIos: ["Mantené apretado el QR, guardalo en Fotos y pagalo en tu banco.", "Long-press the QR, save it to Photos and pay it in your bank."],
    compraQrFalta: ["El QR no llegó. No pagues nada y probá en un momento.", "The QR didn't arrive. Don't pay anything, and try again shortly."],
    cargaYaPague: ["Ya pagué", "I've paid"],
    cargaGuardarQr: ["Guardar el QR", "Save the QR"],
    cargaAbrirBanco: ["Abrir en la app de mi banco", "Open in my bank's app"],
    cargaYaPagasteTitulo: ["¿Ya pagaste este QR?", "Have you already paid this QR?"],
    cargaYaPagasteTexto: ["Si ya lo pagaste, no lo pagues de nuevo.", "If you already paid it, don't pay it again."],
    cargaSiPague: ["Sí, ya pagué", "Yes, I've paid"],
    cargaMostrarQr: ["Todavía no, mostrame el QR", "Not yet, show me the QR"],
    compraEsperandoTitulo: ["Esperando tu pago", "Waiting for your payment"],
    compraEsperandoLinea: ["Te mostramos acá cuando tu banco lo confirme. No pagues de nuevo.", "We'll show it here when your bank confirms it. Don't pay again."],
    compraPagoTarda: ["Tu banco todavía no avisó. Si pagaste, no pagues de nuevo.", "Your bank hasn't confirmed yet. If you paid, don't pay again."],
    compraPodesCerrar: ["Podés cerrar y volver más tarde. Tu compra te espera acá. Después te vamos a pedir unas confirmaciones.", "You can close this and come back later. Your purchase will be waiting here. Afterwards we'll ask you for a few confirmations."],
    cargaEnCaminoTitulo: ["Tu dinero está en camino", "Your money is on its way"],
    cargaFaltan: ["Faltan unos {m} minutos.", "About {m} minutes left."],
    compraTardaMas: ["Está tardando más de lo normal. Abajo dice dónde está tu dinero.", "It's taking longer than usual. Below is where your money is."],
    cargaEtapa1: ["Llega tu pago", "Your payment arrives"],
    compraEtapa2: ["Se pasa a dólares", "It turns into dollars"],
    cargaEtapa3: ["Llega a tu cuenta", "It reaches your account"],
    compraEtapa4: ["Se paga tu paquete", "Your pack gets paid"],
    compraAntesTitulo: ["Faltan {n} confirmaciones", "{n} confirmations left"],
    compraAntesLinea: ["Tocás Confirmar en cada una. Tinkazo revisa cada una antes de mostrártela.", "You tap Confirm on each. Tinkazo checks each one before showing it to you."],
    cargaVerPrimerPaso: ["Empezar a confirmar", "Start confirming"],
    compraAprobarTitulo: ["Confirmación {n} de {total}", "Confirmation {n} of {total}"],
    compraAprobarTituloSinN: ["Confirmá para seguir", "Confirm to continue"],
    cargaAprobarBtn: ["Confirmar", "Confirm"],
    compraAprobarNoSalio: ["No se pudo confirmar. Tu dinero sigue esperando a salvo.", "It couldn't be confirmed. Your money is still waiting safely."],
    compraLlegoTitulo: ["Llegó tu dinero", "Your money arrived"],
    compraLlegoMas: [
      "Tus bolivianos ya son dólares en tu cuenta. Con este toque se paga tu paquete. Si no lo tocás, quedan en tu saldo.",
      "Your bolivianos are now dollars in your account. This tap pays for your pack. If you don't tap it, they stay in your balance.",
    ],
    compraSaldoTitulo: ["Pagá con tu saldo", "Pay with your balance"],
    compraSaldoLinea: ["Tenés {saldo} dólares. Alcanza para este paquete.", "You have US${saldo}. That covers this pack."],
    compraSaldoMas: ["Tu saldo son dólares digitales en tu cuenta de Tinkazo. Son tuyos.", "Your balance is digital dollars in your Tinkazo account. They're yours."],
    compraPagandoTitulo: ["Pagando tu paquete", "Paying for your pack"],
    compraPagandoLinea: ["No cierres esta ventana.", "Don't close this window."],
    compraPagando: ["Pagando…", "Paying…"],
    compraListoTitulo: ["Ya podés organizar tus sorteos", "You can run your draws now"],
    cargaListo: ["Listo", "Done"],
    compraAppTitulo: ["Pagá con dólares digitales", "Pay with digital dollars"],
    compraAppLinea: ["Mandá exactamente este monto, con esta nota, desde tu app.", "Send exactly this amount, with this memo, from your app."],
    compraDatoMoneda: ["Moneda: USDC en Stellar", "Currency: USDC on Stellar"],
    compraNotaMemo: ["En tu app, la nota puede llamarse memo.", "Your app may call it a memo or a note."],
    compraSinDolares: ["¿No tenés dólares digitales? Pedile un cupón a quien organiza tu evento.", "Don't have digital dollars? Ask whoever runs your event for a coupon."],
    compraSinQrTitulo: ["Ahora no hay pago con QR", "QR payment isn't available now"],
    compraSinQrLinea: ["Probá más tarde, o pagá con dólares digitales.", "Try later, or pay with digital dollars."],
    compraRevisionTitulo: ["Tu verificación está en revisión", "Your check is under review"],
    compraRevisionLinea: ["A veces la mira una persona. Cuando vuelvas, te mostramos cómo quedó.", "Sometimes a person reviews it. We'll show you the result when you're back."],
    compraSegipNoTitulo: ["Tus datos están en revisión", "Your details are under review"],
    compraSegipNo: ["No coincidieron con el SEGIP. Te mostramos acá cómo quedó.", "They didn't match SEGIP. We'll show you the result here."],
    compraRechazoTitulo: ["No pudimos verificar tu identidad", "We couldn't verify your identity"],
    compraRechazoLinea: ["Podés usar un cupón de tu evento o pagar con dólares digitales.", "You can use a coupon from your event or pay with digital dollars."],
    compraQrVencioTitulo: ["Este QR venció", "This QR expired"],
    compraQrVencioCerrada: ["La compra se cerró sin tu pago. Si no pagaste, pedí otro.", "The purchase closed without your payment. If you didn't pay, get another one."],
    cargaQrNuevo: ["Pedir un QR nuevo", "Get a new QR"],
    compraQrVencioAbierta: ["Si ya pagaste, no pagues de nuevo. Lo vas a ver acá cuando llegue.", "If you already paid, don't pay again. You'll see it here when it arrives."],
    compraQrVencioAbiertaMas: ["Para que no pagues dos veces, no te damos otro QR hasta que esta compra se cierre.", "So you don't pay twice, we won't give you another QR until this purchase closes."],
    compraFrenadaTitulo: ["Tu compra está frenada", "Your purchase is on hold"],
    compraFrenadaPollar: ["La revisa Pollar, la empresa que mueve tu dinero. No tenés que hacer nada.", "Pollar, the company moving your money, is reviewing it. Nothing for you to do."],
    compraFrenadaTinkazo: ["Lo arreglamos nosotros. Tu dinero está a salvo, no tenés que hacer nada.", "We'll fix it. Your money is safe and you don't need to do anything."],
    compraAyuda: ["¿Necesitás ayuda? Escribinos a hola@tinkazo.app con tu número de compra.", "Need help? Email us at hola@tinkazo.app with your purchase number."],
    compraMenosTitulo: ["Llegó un poco menos", "A little less arrived"],
    compraMenosLinea: ["Te faltan {falta} dólares para este paquete.", "You're US${falta} short for this pack."],
    compraCargarFalta: ["Pagar lo que falta con QR", "Pay the rest by QR"],
    compraNoVendeTitulo: ["Este paquete no se vende ahora", "This pack isn't on sale now"],
    compraNoVendeLinea: ["Tu dinero quedó en tu saldo. Probá más tarde.", "Your money stayed in your balance. Try later."],
    compraSinRed: ["Sin conexión. Tu dinero sigue donde dice abajo.", "No connection. Your money is still where it says below."],
    compraPagoNoSalio: ["No se pudo pagar. Tu saldo sigue igual.", "The payment didn't go through. Your balance is unchanged."],
    compraPagoNoAlcanzo: ["Tu saldo no alcanzó. Lo miramos de nuevo.", "Your balance wasn't enough. We're checking it again."],
    compraPagoSinPatrocinio: ["Ahora no podemos terminar tu compra. Tu saldo sigue igual.", "We can't finish your purchase right now. Your balance is unchanged."],
    compraPagoRaroTitulo: ["No pagamos tu paquete", "We didn't pay for your pack"],
    compraPagoRaro: ["Algo no coincidía. Escribinos con tu número de compra.", "Something didn't match. Email us with your purchase number."],
    compraPagoNoSeSabe: ["Todavía no sabemos si tu pago salió. No lo repitas.", "We don't know yet if your payment went out. Don't repeat it."],
    compraPagoSinVer: ["Tu pago salió y todavía no lo vemos. No lo repitas.", "Your payment went out and we don't see it yet. Don't repeat it."],
    compraRaroTitulo: ["Frenamos esta confirmación", "We stopped this confirmation"],
    compraRaroLinea: ["No es la que esperábamos. Escribinos con tu número de compra.", "It's not the one we expected. Email us with your purchase number."],
    compraDesconocidoTitulo: ["Falta un paso que no mostramos", "There's a step we don't show"],
    compraDesconocidoLinea: ["No hicimos nada. Escribinos con tu número de compra.", "We didn't do anything. Email us with your purchase number."],
    compraFalloTitulo: ["Esta compra no se pudo hacer", "This purchase couldn't go through"],
    compraFalloSinPago: ["Se frenó antes de que pudieras pagar. No se movió nada.", "It stopped before you could pay. Nothing moved."],
    compraFalloSinVerPago: ["No vemos tu pago. Si pagaste, escribinos con el comprobante y lo buscamos.", "Payment not seen. If you paid, email us the receipt and we'll trace it."],
    compraFalloConPago: ["Tu pago llegó y la compra se frenó. Escribinos con tu número de compra.", "Your payment arrived and the purchase stopped. Email us with your purchase number."],
    cargaDevueltaSinMonto: ["Te devolvieron tu pago a tu banco.", "Your payment was returned to your bank."],
    compraOtraVez: ["Empezar de nuevo", "Start again"],
    compraRechazoMas: ["Para saber el motivo, escribinos a hola@tinkazo.app. Mientras, podés probar gratis en modo Prueba.", "To find out why, email us at hola@tinkazo.app. Meanwhile, you can try it free in Test mode."],
    compraDatoSeUsan1: ["Se usa lo que cargaste: 1 dólar", "From what you loaded: US$1"],
    cargaSegipComplemento: ["Complemento (por ejemplo 1A), si tu carnet tiene", "Complement (for example 1A), if your ID card has one"],
    compraPrecioLinea1: ["Con el QR de tu banco. Después confirmás una vez acá.", "With your bank's QR. Then you confirm once here."],
    compraPrecioLineaSinN: ["Con el QR de tu banco. Después vas a confirmar acá.", "With your bank's QR. Then you'll confirm here."],
    compraAntesLinea1: ["Tocás Confirmar una vez. Tinkazo la revisa antes de mostrártela.", "You tap Confirm once. Tinkazo checks it before showing it to you."],
    cargaAprobando: ["Confirmando…", "Confirming…"],
    compraAprobarTarde: ["Mientras tanto, tu dinero está en tu cuenta de paso, que es tuya. Si no confirmás ahora, espera ahí a salvo.", "Meanwhile, your money is in your pass-through account, which is yours. If you don't confirm now, it waits there safely."],
    compraLlegoLinea: ["Ya está en tu cuenta. Falta pagar tu paquete.", "It's in your account. Your pack is next."],
    compraDatoPaqueteDe: ["{sorteos}: {precio}", "{sorteos}: {precio}"],
    compraDatoRecargoPrimera: ["Pago con QR, la primera vez: {n} dólares", "QR payment, first time: US${n}"],
    compraDatoRecargoPrimera1: ["Pago con QR, la primera vez: 1 dólar", "QR payment, first time: US$1"],
    compraDatoRecargo: ["Pago con QR: {n} dólares", "QR payment: US${n}"],
    compraDatoRecargo1: ["Pago con QR: 1 dólar", "QR payment: US$1"],
    compraDatoTarda: ["Tarda en llegar: unos {m} minutos", "Arrives in: about {m} minutes"],
    compraDatoTardaPoco: ["Tarda en llegar: unos minutos", "Arrives in: a few minutes"],
    compraDondeCambiando: ["en una cuenta tuya, pasándose a dólares", "in an account of yours, turning into dollars"],
    compraDondeGuardado: ["en una cuenta tuya, a salvo", "in an account of yours, safe"],
    compraArmarSorteo: ["Armar mi primer sorteo", "Set up my first draw"],
    compraUnMomento: ["Un momento…", "One moment…"],
    compraComoSePagaPrimera: ["La primera vez, el pago con QR incluye verificar tu identidad.", "The first time, the QR payment includes verifying your identity."],
    compraQrGuardadoLinea: ["Quedó guardado. En tu banco, elegí pagar con QR y subí la imagen.", "Saved. In your bank's app, choose pay by QR and upload the image."],
    compraTodaviaNoLinea: ["Pagalo una sola vez. Después tocá Ya pagué.", "Pay it only once. Then tap I've paid."],
    compraAntesTitulo1: ["Falta una confirmación", "One confirmation left"],
    compraConfirmaPermisoCambio: ["Permiso para cambiar tus dólares por los que acepta tu cuenta de Tinkazo.", "Permission to switch your dollars for the kind your Tinkazo account accepts."],
    compraConfirmaCambio: ["Tus dólares se cambian por los que acepta tu cuenta de Tinkazo.", "Your dollars switch to the kind your Tinkazo account accepts."],
    compraConfirmaPermisoEnvio: ["Permiso para enviarlos a tu cuenta de Tinkazo.", "Permission to send them to your Tinkazo account."],
    compraConfirmaEnvio: ["Se envían a tu cuenta de Tinkazo.", "They're sent to your Tinkazo account."],
    compraTopeDeQr: ["Pediste varios QR para esta compra. Escribinos y la destrabamos.", "You asked for several QRs for this purchase. Email us to unlock it."],
    compraOtraOrdenTitulo: ["¿Ya pagaste desde otra app?", "Already paid from another app?"],
    compraOtraOrdenLinea: ["Si no pagaste desde otra app, seguí con el QR.", "If you didn't pay from another app, continue with the QR."],
    compraOtraOrdenNo: ["No pagué, ver el QR", "I didn't pay, show the QR"],
    compraOtraOrdenSi: ["Ya pagué desde otra app", "I already paid from another app"],
    // El precio dice el total y cuánto sale cada dólar a la vista: así se entienden los bolivianos del título.
    compraDatoTotal: ["Total: {n} dólares", "Total: US${n}"],
    compraDatoTotal1: ["Total: 1 dólar", "Total: US$1"],
    compraDatoTasa: ["Cada dólar: unos Bs {tasa}", "Each dollar: about Bs {tasa}"],
    // El tope de QR no es una caída: la compra pide ayuda a mano.
    compraTopeDeQrTitulo: ["Esta compra necesita ayuda", "This purchase needs help"],
    // Sin carga, la línea no repite el título del paquete que no se vende.
    compraNoVendeSinCarga: ["Lo que ya compraste sigue siendo tuyo. Probá más tarde.", "What you already bought is still yours. Try later."],
    // La sesión que se cerró dice eso en el título, y la línea lo que hay que hacer.
    compraSesionTitulo: ["Tu sesión se cerró", "Your session ended"],
    compraSesionLinea: ["Entrá de nuevo para seguir con tu compra.", "Sign in again to continue your purchase."],
  };

  it("cada uno, en español y en inglés", () => {
    for (const [k, [es, en]] of Object.entries(PLAN)) {
      expect(TEXTOS_COMPRA.es[k], k).toBe(es);
      expect(TEXTOS_COMPRA.en[k], k).toBe(en);
    }
  });

  it("los que se reescribieron por el largo o por el glosario, con el mismo sentido", () => {
    // «Pagá con el QR de tu banco» son 7 palabras, y el título va hasta 6.
    expect(TEXTOS_COMPRA.es.compraQrTitulo).toBe("Pagá el QR con tu banco");
    expect(TEXTOS_COMPRA.en.compraQrTitulo).toBe("Pay with your bank's QR");
    // «Un toque» sin «de» es la expresión de un momento que el glosario saca: se nombra el botón o se dice qué falta.
    // La línea de Llegó repetía el botón: ahora dice dónde está el dinero y qué falta.
    expect(TEXTOS_COMPRA.es.compraLlegoLinea).toBe("Ya está en tu cuenta. Falta pagar tu paquete.");
    expect(TEXTOS_COMPRA.en.compraLlegoLinea).toBe("It's in your account. Your pack is next.");
    expect(TEXTOS_COMPRA.es.compraLlegoAviso).toBe("Llegó tu dinero. Solo falta terminar tu compra.");
    expect(TEXTOS_COMPRA.en.compraLlegoAviso).toBe("Your money arrived. One tap left to finish.");
    expect(TEXTOS_COMPRA.es.compraFrenadaVos).toBe("Se arregla desde acá. Tocá Probar de nuevo.");
    expect(TEXTOS_COMPRA.en.compraFrenadaVos).toBe("You can fix it from here. Tap Try again.");
    expect(TEXTOS_COMPRA.es.compraDatoSiCerrasPagar).toBe("Si cerrás: al volver, tocás Terminar mi compra");
    expect(TEXTOS_COMPRA.en.compraDatoSiCerrasPagar).toBe("If you close: when you're back, tap Finish my purchase");
  });

  it("lo que se aprueba dice dólares, como el resto de la compra", () => {
    expect(TEXTOS_COMPRA.es.cargaAprobarPermiso).toBe("Dejar que el cambio use {n} dólares de tu cuenta de paso.");
    expect(TEXTOS_COMPRA.en.cargaAprobarPermiso).toBe("Let the exchange use US${n} from your pass-through account.");
    expect(TEXTOS_COMPRA.es.cargaAprobarEnvio).toBe("Pasar tus dólares de la cuenta de paso a tu cuenta de Tinkazo.");
  });
});

describe("no pisan otros textos", () => {
  it("ninguna clave se define en otro archivo de textos: el diccionario las junta y la última ganaría", () => {
    const archivos = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? archivos(join(dir, d.name)) : d.name.endsWith(".ts") && !d.name.endsWith(".test.ts") ? [join(dir, d.name)] : []));
    const otros = archivos("src").filter((a) => !a.replaceAll("\\", "/").endsWith("src/compra-textos.ts"));
    const fuentes = otros.map((a) => [a, readFileSync(a, "utf8")] as const);
    for (const k of CLAVES) {
      const definicion = new RegExp(`^\\s+"?${k}"?\\s*:`, "m");
      expect(fuentes.filter(([, s]) => definicion.test(s)).map(([a]) => a), k).toEqual([]);
    }
  });

  it("los de hoy que la compra usa tal cual existen en los dos idiomas y no se redefinen", () => {
    for (const k of DE_HOY) {
      expect(k in TEXTOS_COMPRA.es, k).toBe(false);
      for (const l of IDIOMAS) expect(typeof T[l][k] === "string" && (T[l][k] as string).trim() !== "", `${l} ${k}`).toBe(true);
    }
  });
});

describe("están en el diccionario del sitio", () => {
  it("cada clave llega a T en los dos idiomas con el mismo texto", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_COMPRA[l][k]);
  });
});
