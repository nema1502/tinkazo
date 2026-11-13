import { banderasDeVenta, entornoDelBuild, ventaAbiertaATodos } from "./stellar/venta-piloto";

/**
 * Lo que dicen las páginas públicas el día que se prende la compra de sorteos oficiales (`VITE_ALTA_PAGO`), con el
 * mismo patrón que los textos con cupón: el diccionario cambia solo en un build con la compra prendida, y el HTML de
 * cada página (lo que se ve antes de que cargue el JavaScript y lo que leen los buscadores) pasa a decir esto en el
 * mismo commit que la prende en producción. Hasta ese commit el HTML dice lo de hoy, y la publicación de producción con
 * la compra prendida no sale (`problemasDeLasPaginasConCobro`, que mira `vite.config.ts`).
 *
 * Tres partes:
 *
 * - `textosConCobro()`: las claves que ya existen y cambian con la compra. Ninguna promete que es gratis para siempre
 *   ni que los precios se publican pronto, y todas dicen que con un paquete de sorteos oficiales también cubre la
 *   comisión Tinkazo. `tmMore4` (la fecha de los términos) entra solo con `FECHA_DEL_COBRO` puesta.
 * - `TEXTOS_COBRO`: las claves nuevas, que están siempre en el diccionario y se ven solo con la compra: la lista de
 *   precios de `precios.html` y lo que se compra en `terminos.html`. En el HTML van adentro de un
 *   `<template data-con-cobro>`, que `paginas-cobro.ts` pone en la página solo con la compra prendida.
 * - `ESTATICOS_CON_COBRO`: lo que no pasa por el diccionario (los datos para buscadores y la vista previa al compartir).
 *
 * Ningún texto tiene un precio: los montos salen siempre del servidor (`/v1/alta/precios`), los mismos que usa el panel
 * de la compra (`stellar/alta-oferta.ts`). Importa solo la puerta del piloto (`stellar/venta-piloto.ts`), que no importa
 * nada: lo lee también `vite.config.ts`.
 *
 * Con la venta en piloto (sin `VITE_VENTA_ABIERTA=1`), el diccionario cambia solo en una pestaña con la marca del
 * piloto, y el HTML queda el de hoy: nadie sin la marca ve la compra.
 *
 * El commit que prende la compra en producción, en este orden:
 * 1. `FECHA_DEL_COBRO` con el día en que se prende (AAAA-MM-DD).
 * 2. En el HTML, cada `<template data-con-cobro>` se cambia por lo que tiene adentro, cada clave de `textosConCobro()`
 *    lleva su texto nuevo en español, y van los textos de `ESTATICOS_CON_COBRO` donde dicen.
 * 3. Los textos de `textosConCobro()` pasan al diccionario (`i18n.ts` o `i18n-modo-oficial.ts`) y este archivo queda
 *    con las claves nuevas. Las pruebas que fijan los textos de antes cambian a conciencia.
 * 4. La publicación de producción pasa a pedir `VITE_ALTA_PAGO=1` y `VITE_VENTA_ABIERTA=1`, como hoy pide
 *    `VITE_ALTA=1` para los textos con cupón. Para volver atrás, primero se revierte ese commit y después se vacían las
 *    variables.
 */

/**
 * El día en que se prende la compra, que es desde cuando valen los términos con la compra. `null` mientras no se sabe:
 * la fecha de los términos queda la de hoy y la publicación de producción con la compra no sale.
 */
export const FECHA_DEL_COBRO: string | null = null;

type Textos = { es: Record<string, string>; en: Record<string, string> };

/**
 * La compra está a la vista: `VITE_ALTA=1` con la dirección del portero de la red principal, y la compra prendida
 * (`VITE_ALTA_PAGO=1`, que se lee en la puerta del piloto). Sin entorno, el de este sitio en esta pestaña: con la venta
 * en piloto, solo con su marca. Es lo mismo que `banderasDeAlta(env, "mainnet").pago` de `stellar/alta-config.ts`, sin
 * importarlo: este archivo lo lee también `vite.config.ts`, y el diccionario no tiene que depender de la configuración
 * de la billetera.
 */
export function cobroEnElBuild(env?: Record<string, unknown>): boolean {
  const e = env ?? entornoDelBuild();
  const portero = typeof e.VITE_PATROCINIO_URL_MAINNET === "string" && e.VITE_PATROCINIO_URL_MAINNET.trim().replace(/\/+$/, "") !== "";
  return e.VITE_ALTA === "1" && portero && banderasDeVenta(env).pago;
}

const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** La fecha de los términos, como se lee: «18 de noviembre de 2026», «November 18, 2026». `null` si no es AAAA-MM-DD. */
export function fechaDeLosTerminos(fecha: string | null): { es: string; en: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha ?? "");
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return { es: `${d} de ${MESES_ES[mes - 1]} de ${a}`, en: `${MESES_EN[mes - 1]} ${d}, ${a}` };
}

const DEPLOYMENTS = '<a href="https://github.com/nema1502/tinkazo/blob/main/docs/deployments.md" target="_blank" rel="noopener">docs/deployments.md</a>';

/** Las claves que ya existen y cambian con la compra prendida. */
const CON_COBRO: Textos = {
  es: {
    prNote: "El modo Prueba es gratis. En el modo Oficial, usás el cupón de tu evento o comprás sorteos oficiales. Participar en un sorteo y comprobarlo es gratis, siempre.",
    descPrecios: "El modo Prueba es gratis. En el modo Oficial, el cupón de tu evento o un paquete de sorteos oficiales. Participar y comprobar es gratis, siempre.",
    faq3a:
      "Participar y comprobar son gratis siempre. Para quien organiza, el modo Prueba es gratis. En el modo Oficial, con el cupón de tu evento o un paquete de sorteos oficiales, Tinkazo cubre la comisión de la red. Quien entra con su propia billetera la paga de su cuenta. Los precios están en la página Precios.",
    rulF3B:
      "Participar y comprobar un sorteo es gratis, siempre. Para quien sortea, el modo Prueba es gratis. En el modo Oficial se usa el cupón de tu evento o un paquete de sorteos oficiales, con los precios en la página Precios.",
    nextBody:
      "Al cerrar la lista, se sella antes de que exista el número que decide, y cualquier cambio posterior se nota. El costo de sellar lo paga Tinkazo en el modo Prueba, y también en el modo Oficial si usás el cupón de tu evento o un paquete de sorteos oficiales. En el modo Oficial, quien entra con su propia billetera paga la comisión de la red, que es de centavos. En el modo Prueba, guardá el comprobante de tus sorteos, porque sirve para volver a comprobarlos aunque el registro se reinicie el 16 de diciembre de 2026.",
    cfCostoB: `Grabar cada sorteo en la red tiene un costo. Lo cobra la red, no Tinkazo, y casi todo es renta de almacenamiento: cambia con el uso de la red. En el modo Prueba lo paga Tinkazo. En el modo Oficial lo paga Tinkazo si usás el cupón de tu evento o un paquete de sorteos oficiales, y quien entra con su propia billetera lo paga de su cuenta. Las cifras medidas, con su fecha, están en ${DEPLOYMENTS}.`,
    tmPatrocinio:
      "En el modo Prueba, Tinkazo cubre la comisión que cobra la red por sellar y sortear. Puede haber un tope por cuenta y por mes. Si se agota, se puede pagar con la propia cuenta o esperar a que vuelva. Si hay tope, para llevar la cuenta el servicio guarda cuántos sellos y sorteos hizo cada cuenta, sin nombres ni listas. En el modo Oficial, con el cupón de tu evento o un paquete de sorteos oficiales, Tinkazo cubre esa comisión mientras te queden sorteos oficiales. Quien entra con su propia billetera la paga de su cuenta.",
  },
  en: {
    prNote: "Test mode is free. In Live mode, you use a coupon from your event or buy Live draws. Joining a draw and checking it is always free.",
    descPrecios: "Test mode is free. In Live mode, a coupon from your event or a pack of Live draws. Taking part and checking a draw is always free.",
    faq3a:
      "Taking part and checking are always free. For organizers, Test mode is free. In Live mode, with a coupon from your event or a pack of Live draws, Tinkazo covers the network's charge. If you sign in with your own wallet, you pay it from your account. Prices are on the Pricing page.",
    rulF3B:
      "Taking part in a draw and checking it is always free. For whoever runs the draw, Test mode is free. Live mode takes a coupon from your event or a pack of Live draws, with prices on the Pricing page.",
    nextBody:
      "When you close the list, it is sealed before the number that decides exists, and any later change shows. Tinkazo pays the cost of sealing in Test mode, and in Live mode too if you use a coupon from your event or a pack of Live draws. In Live mode, if you sign in with your own wallet, you pay the network's charge, which is a few cents. In Test mode, keep the receipts of your draws, because they let anyone check them again even after the record resets on December 16, 2026.",
    cfCostoB: `Recording each draw on the network has a cost. The network charges it, not Tinkazo, and almost all of it is storage rent: it changes with how much the network is used. In Test mode Tinkazo pays it. In Live mode Tinkazo pays it if you use a coupon from your event or a pack of Live draws, and if you sign in with your own wallet, you pay it from your account. The measured figures, with their dates, are in ${DEPLOYMENTS}.`,
    tmPatrocinio:
      "In Test mode, Tinkazo covers the charge the network makes for sealing and drawing. There may be a cap per account per month. If it runs out, you can pay with your own account or wait for it to come back. If there is a cap, to keep count the service stores how many seals and draws each account has made, with no names or lists. In Live mode, with a coupon from your event or a pack of Live draws, Tinkazo covers that charge while you have Live draws left. If you sign in with your own wallet, you pay it from your account.",
  },
};

/** La fecha de los términos con la compra: la de hoy pasa a ser la anterior. `{fecha}` es `FECHA_DEL_COBRO`. */
const VIGENCIA: { es: { tmMore4: string }; en: { tmMore4: string } } = {
  es: {
    tmMore4:
      "Vigentes desde el {fecha}, cuando sumamos la compra de sorteos oficiales. El 11 de noviembre de 2026 habíamos sumado el modo Oficial y, en ese modo, la llave de las cuentas que entran con Google pasó a protegerla Turnkey. Antes se habían sumado el servicio que cubre la comisión y cuenta los sellos de cada cuenta, el conteo sin saber quién es de los pasos del sorteo, el logo de la comunidad, el formulario para opinar y las rondas de ejemplo de los stands. Si cambian, cambia esta página, con su fecha.",
  },
  en: {
    tmMore4:
      "In effect since {fecha}, when we added buying Live draws. On November 11, 2026 we had added Live mode and, in that mode, the key of accounts that sign in with Google became protected by Turnkey. Before that came the service that covers the network charge and counts each account's seals, counting the steps of a draw without knowing who takes them, the community logo, the feedback form and the sample rounds for booths. If they change, this page changes, with its date.",
  },
};

/**
 * Las claves que cambian con la compra prendida, para ponerlas encima del diccionario. Con `fecha` (AAAA-MM-DD) suma la
 * fecha de los términos; sin ella, los términos siguen con la de hoy.
 */
export function textosConCobro(fecha: string | null = FECHA_DEL_COBRO): Textos {
  const f = fechaDeLosTerminos(fecha);
  return {
    es: { ...CON_COBRO.es, ...(f ? { tmMore4: VIGENCIA.es.tmMore4.replace("{fecha}", f.es) } : {}) },
    en: { ...CON_COBRO.en, ...(f ? { tmMore4: VIGENCIA.en.tmMore4.replace("{fecha}", f.en) } : {}) },
  };
}

/**
 * Las claves nuevas de la compra, siempre en el diccionario. Se ven solo con la compra prendida: van en los
 * `<template data-con-cobro>` de `precios.html` y `terminos.html` y en la lista que arma `paginas-cobro.ts`.
 * En la lista, el monto y los sorteos de cada fila salen del servidor (`{sorteos}`, `{precio}`, `{dias}`).
 */
export const TEXTOS_COBRO: Textos = {
  es: {
    // precios.html: un título, una sola línea y la lista que da el servidor.
    prPaqT: "Sorteos oficiales",
    prPaqAyuda: "Se compran desde tu cuenta, en el modo Oficial.",
    prPaqPrecio: "{sorteos} por {precio}",
    prPaqDias: "Para usar en {dias} días.",
    prPaqDia1: "Para usar en 1 día.",
    prPaqNada: "Ahora no hay paquetes a la venta.",
    prPaqSinRespuesta: "Ahora no podemos mostrar los precios. Probá de nuevo más tarde.",
    prPaqTerminos: "Qué comprás y cómo pedir una devolución",
    // Con la compra con QR a la vista: lo que se suma pagando con QR, con los dos montos del servidor (`recargoQr`).
    prPaqQr: "Pagando con el QR de tu banco, en bolivianos, se suman {primera} la primera vez y {siguientes} las siguientes. La primera vez incluye verificar tu identidad.",
    // terminos.html: qué se compra, a la vista, y lo demás plegado.
    tmCompraT: "Si comprás sorteos oficiales",
    tmCompraB:
      "Lo que comprás son sorteos oficiales, para sellar en el modo Oficial. Antes de pagar, cada paquete dice cuántos trae y por cuántos días valen, contados desde que llega tu pago. El primero también activa tu cuenta. No son saldo: no se retiran, no se transfieren y no se cambian por dinero. Participar en un sorteo sigue siendo gratis, siempre.",
    tmCompraEscribir: 'Para pedir una devolución o preguntar por un pago, escribinos a <a href="mailto:hola@tinkazo.app">hola@tinkazo.app</a> con la nota o el número de tu compra.',
    tmCompraMas: "Pagos, devoluciones y datos",
    tmCompraPago:
      "Pagás en dólares digitales (USDC), con los datos que te da la pantalla de pago, o con el QR de tu banco, en bolivianos. Pagando con QR se suma lo que cuesta ese pago, y la pantalla lo dice antes de pagar: la primera vez es más, porque incluye verificar tu identidad. La compra queda hecha cuando llega al menos el 95 % del precio del paquete, porque algunas apps descuentan su comisión, y si pagaste con QR, también lo que se suma por el QR. Podemos cambiar los precios o pausar la venta, y lo que ya compraste se respeta, con sus días.",
    tmCompraDevolver:
      "Si mandaste de más, sin la nota o dos veces, o si dejaste un pago a medias que no vas a completar, te lo devolvemos a la cuenta desde la que pagaste. Si pagaste desde un exchange, te pedimos los datos para que llegue. Lo que ya compraste no se devuelve, salvo que algo falle de nuestro lado.",
    tmCompraDatos:
      "Al comprar, nuestro servicio guarda tu compra (el paquete, el monto, la nota y cuándo vence) junto al identificador que Pollar le da a tu cuenta. De cada pago que llega guarda el monto, la cuenta desde la que se mandó y cuándo, para reconocerlo y poder devolverlo. Esos pagos quedan en Stellar, que es público. Si pagás con QR, para verificar tu identidad y cambiar tus bolivianos, tu carnet, una foto de tu cara y tus datos van a Pollar, la empresa que mueve tu dinero, a Didit, que mira tu carnet y tu cara, y a Stereum, la casa de cambio. Tinkazo no los guarda ni los usa. De esa compra, nuestro servicio guarda el paquete, lo que se suma por el QR y en qué paso está.",
  },
  en: {
    prPaqT: "Live draws",
    prPaqAyuda: "You buy them from your account, in Live mode.",
    prPaqPrecio: "{sorteos} for {precio}",
    prPaqDias: "To use within {dias} days.",
    prPaqDia1: "To use within 1 day.",
    prPaqNada: "No packs are on sale right now.",
    prPaqSinRespuesta: "We can't show the prices right now. Try again later.",
    prPaqTerminos: "What you buy and how to ask for a refund",
    prPaqQr: "Paying with your bank's QR, in bolivianos, adds {primera} the first time and {siguientes} after that. The first time includes verifying your identity.",
    tmCompraT: "If you buy Live draws",
    tmCompraB:
      "What you buy are Live draws, to seal in Live mode. Before you pay, each pack says how many it has and for how many days they last, counted from when your payment arrives. The first one also activates your account. They aren't a balance: they can't be withdrawn, transferred or exchanged for money. Joining a draw is still always free.",
    tmCompraEscribir: 'To ask for a refund or about a payment, write to us at <a href="mailto:hola@tinkazo.app">hola@tinkazo.app</a> with the memo or the number of your purchase.',
    tmCompraMas: "Payments, refunds and data",
    tmCompraPago:
      "You pay in digital dollars (USDC), with the details the payment screen gives you, or with your bank's QR, in bolivianos. Paying by QR adds what that payment costs, and the screen shows it before you pay: the first time it is more, because it includes verifying your identity. The purchase is done once at least 95% of the pack price arrives, because some apps take a fee, plus, if you paid by QR, what the QR adds. We may change prices or pause sales, and what you already bought is kept, with its days.",
    tmCompraDevolver:
      "If you sent too much, sent it without the memo or paid twice, or if you left a payment half done that you won't complete, we send it back to the account you paid from. If you paid from an exchange, we'll ask for the details so it arrives. What you already bought isn't refunded, unless something fails on our side.",
    tmCompraDatos:
      "When you buy, our service stores your purchase (the pack, the amount, the memo and when it expires) with the identifier Pollar gives your account. For each payment that arrives it stores the amount, the account it came from and when, to recognize it and be able to refund it. Those payments are on Stellar, which is public. If you pay by QR, to verify your identity and exchange your bolivianos, your ID card, a photo of your face and your details go to Pollar, the company that moves your money, to Didit, which checks your ID card and face, and to Stereum, the currency exchange. Tinkazo doesn't keep or use them. For that purchase, our service stores the pack, what the QR adds and which step it is at.",
  },
};

/**
 * Lo que no pasa por el diccionario y cambia con la compra: los datos para buscadores y la vista previa al compartir.
 * Cada página de la lista tiene que traer sus textos en el commit que prende la compra.
 */
export const ESTATICOS_CON_COBRO: Readonly<Record<string, readonly string[]>> = {
  // `disambiguatingDescription` de la organización y de la aplicación, en los datos estructurados.
  "index.html": ["Herramienta para elegir con justicia en eventos y clases. No vende participaciones: participar es gratis, siempre."],
  // La descripción en español (la de `descPrecios`) y la de la vista previa al compartir, en inglés.
  "precios.html": [CON_COBRO.es.descPrecios as string, "Taking part and checking a result are free, always. Test mode is free, and Live mode takes a coupon from your event or a pack of Live draws."],
};

/**
 * Lo que dicen hoy las páginas y deja de ser cierto con la compra: que es gratis para todos, que los precios se
 * publican pronto, que avisamos antes de cobrar y que no se venden paquetes. La nota del logo («te avisamos antes de
 * cobrarlos») habla de los planes que todavía no existen, y sigue valiendo.
 */
export const FRASES_SIN_COBRO: readonly RegExp[] = [
  /muy pronto/,
  /very soon/i,
  /antes de cobrar(?!los)/,
  /before we charge/i,
  /ni paquetes de sorteos/,
  /Hoy (Tinkazo )?es gratis|Hoy Tinkazo no cobra/,
  /Today Tinkazo is free|Tinkazo is free today|free for everyone today|charges nothing for now/i,
];

/**
 * Lo que frena la publicación de producción con la compra abierta para todos: que el HTML todavía diga lo de antes.
 * Recibe el entorno del build (`VITE_*` y `VERCEL_ENV`) y las páginas de la raíz (nombre y HTML). Vacío: puede salir.
 * Fuera de producción, con la compra apagada o con la venta en piloto (sin `VITE_VENTA_ABIERTA=1`), nunca frena: las
 * vistas previas sirven para la prueba de la compra, y en piloto nadie sin la marca ve la compra.
 */
export function problemasDeLasPaginasConCobro(env: Record<string, string | undefined>, paginas: Readonly<Record<string, string>>, fecha: string | null = FECHA_DEL_COBRO): string[] {
  if (env.VERCEL_ENV !== "production" || env.VITE_ALTA !== "1" || !banderasDeVenta(env).pago || !ventaAbiertaATodos(env)) return [];
  const problemas: string[] = [];
  if (!fechaDeLosTerminos(fecha)) problemas.push("Falta FECHA_DEL_COBRO en src/alta-textos-con-cobro.ts: los términos con la compra dicen desde qué día valen.");
  const nuevos = textosConCobro(fecha).es;
  for (const [pagina, html] of Object.entries(paginas)) {
    if (/<template\b[^>]*\bdata-con-cobro\b/.test(html)) problemas.push(`${pagina} todavía trae lo de la compra adentro de <template data-con-cobro>: se saca del template en el mismo commit que prende la compra.`);
    for (const [clave, texto] of Object.entries(nuevos)) {
      for (const atributo of ["data-i", "data-i-html"]) {
        if (html.includes(`${atributo}="${clave}"`) && !html.includes(`${atributo}="${clave}">${texto}<`)) problemas.push(`${pagina}: ${atributo}="${clave}" tiene que traer el texto de textosConCobro().`);
      }
    }
    for (const frase of FRASES_SIN_COBRO) if (frase.test(html)) problemas.push(`${pagina} todavía dice algo que deja de ser cierto con la compra (${frase.source}).`);
    for (const texto of ESTATICOS_CON_COBRO[pagina] ?? []) if (!html.includes(texto)) problemas.push(`${pagina} no trae el texto de ESTATICOS_CON_COBRO: ${texto.slice(0, 60)}`);
  }
  return problemas;
}
