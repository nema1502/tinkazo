import deployments from "./stellar/deployments.json";

/**
 * Los textos que cambian cuando existe el modo Oficial. Mientras `deployments.json` no tenga contrato en la red real
 * (`mainnet: null`, que es producción hoy) el sitio dice lo que decía: no hay otro modo del cual distinguir "Prueba", y
 * "En el modo Prueba, guardá…" le haría pensar a quien lee que existe uno. `i18n.ts` los pone encima del diccionario
 * solo si hay modo Oficial; las claves de este archivo son las que ya existían, con el texto de hoy en `i18n.ts`.
 * Los textos que solo existen para el modo Oficial (la hoja, los avisos, la confirmación) están en `i18n.ts`.
 *
 * Cuando se agregue el contrato real, en el mismo commit, el texto del HTML de seis páginas pasa a ser el de este
 * archivo (es lo que se ve antes de que cargue el JavaScript y lo que leen los buscadores):
 * - `index.html`, la respuesta `data-i="faq3a"`;
 * - `precios.html`, el párrafo `data-i="nextBody"`;
 * - `terminos.html`, los puntos `data-i="tmMore3"`, `data-i="tmMore4"` y `data-i="tmPatrocinio"` y el párrafo
 *   `data-i="tmQ4B"`;
 * - `sorteo-verificable.html`, el punto `data-i="verifN3"`;
 * - `como-funciona.html`, el punto `data-i-html="cfDura3"`, el párrafo `data-i-html="cfCostoB"` y la celda
 *   `data-i="cfG4b"`;
 * - `seguridad.html`, el punto `data-i="sgLimit3"`.
 * Quién paga la comisión de la red cambia con el modo (`nextBody`, `faq3a`, `cfCostoB` y `tmPatrocinio`): en Prueba
 * la cubre Tinkazo; en Oficial, la cubre Tinkazo con el cupón de un evento y quien entra con su propia billetera la paga
 * de su cuenta. Con el cupón también cambian `prNote` (`precios.html`: con un cupón de tu evento el modo Oficial es
 * gratis) y `tmMore1` (`terminos.html`: qué guarda el servicio al canjear un cupón y qué no). El HTML de esas cuatro
 * páginas trae los mismos textos. Como los ve cualquiera que abra el sitio, la publicación de producción exige el
 * acceso por cupón en el build (`VITE_ALTA=1`, ver `stellar/alta-build.ts`).
 * `revision-textos.test.ts` falla hasta que estén, y dice cuál falta, pero solo mira `data-i`: el de `cfDura3`, que es
 * `data-i-html`, lo avisa `seo.test.ts`. Las claves de la ventana de entrar (`loginTestnet` y las `guest…`) no están
 * en ningún HTML. Las pruebas que dependen de estos textos (`revision-textos.test.ts`, `i18n.test.ts`,
 * `ui/compartir.test.ts` y `evento-modo.test.ts`) ya los toman del diccionario o miran `HAY_MODO_OFICIAL`: no hay
 * que tocarlas.
 */

/**
 * Si la lista oficial ya tiene contrato en la red real. Es la misma regla que `hayModoOficial` de
 * `stellar/config.ts`, leída directo de la lista para que el diccionario no dependa de la configuración entera.
 */
export const HAY_MODO_OFICIAL: boolean = !!(deployments as unknown as { mainnet?: { contractId?: string } | null }).mainnet?.contractId;

export const TEXTOS_MODO_OFICIAL: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    netTest: "Prueba",
    netTestHint: "Para probar con calma. Funciona igual y se puede comprobar, pero se borra el 16 de diciembre.",
    netMainHint: "Para los sorteos que cuentan. El sello queda registrado en Stellar y cualquiera puede rehacer la cuenta con el comprobante.",
    fundTag: "Prueba",
    fundBody: "Para sellar hace falta un poquito. En Prueba es dinero de prueba: pedila acá y seguís.",
    fundFoot: "No vale nada: solo sirve en Prueba, para probar.",
    nextBody: "Al cerrar la lista, se sella antes de que exista el número que decide, y cualquier cambio posterior se nota. El costo de sellar lo paga Tinkazo en el modo Prueba, y también en el modo Oficial si usás el cupón de tu evento. En el modo Oficial, quien entra con su propia billetera paga la comisión de la red, que es de centavos. En el modo Prueba, guardá el comprobante de tus sorteos, porque sirve para volver a comprobarlos aunque el registro se reinicie el 16 de diciembre de 2026.",
    faq3a: "Hoy Tinkazo no cobra nada. Los precios para quien organiza se publican muy pronto, y te avisamos antes de cobrar. Participar y comprobar son gratis siempre. En el modo Oficial, con el cupón de tu evento Tinkazo cubre la comisión de la red. Quien entra con su propia billetera la paga de su cuenta.",
    cfCostoB: 'Grabar cada sorteo en la red tiene un costo. Lo cobra la red, no Tinkazo, y casi todo es renta de almacenamiento: cambia con el uso de la red. En el modo Prueba lo paga Tinkazo. En el modo Oficial lo paga Tinkazo si usás el cupón de tu evento, y quien entra con su propia billetera lo paga de su cuenta. Las cifras medidas, con su fecha, están en <a href="https://github.com/nema1502/tinkazo/blob/main/docs/deployments.md" target="_blank" rel="noopener">docs/deployments.md</a>.',
    tmPatrocinio: "En el modo Prueba, Tinkazo cubre la comisión que cobra la red por sellar y sortear. Puede haber un tope por cuenta y por mes. Si se agota, se puede pagar con la propia cuenta o esperar a que vuelva. Si hay tope, para llevar la cuenta el servicio guarda cuántos sellos y sorteos hizo cada cuenta, sin nombres ni listas. En el modo Oficial, con el cupón de tu evento Tinkazo cubre esa comisión mientras te queden sorteos oficiales. Quien entra con su propia billetera la paga de su cuenta.",
    tmMore1: "No hay publicidad ni rastreadores que te sigan de un sitio a otro, ni una base de datos de participantes que podamos leer. Durante un sorteo el sitio pide afuera el número que publica un faro público y, si tenés cuenta, lo que hace falta de la red Stellar, de Pollar y de nuestro servicio que cubre la comisión, que corre en Cloudflare. Para cuidar el fondo que la paga, ese servicio anota los sellos de cada cuenta, con la hora y la huella de la lista. No guarda la lista, nombres ni direcciones IP. Al compartir o mostrar en grande, se guarda en Cloudflare una copia cifrada del comprobante, que incluye la lista. La clave va solo en el enlace y no nos llega, así que no podemos leerla. Si canjeás un cupón de evento, ese servicio confirma tu sesión con Pollar y guarda el identificador que Pollar le da a tu cuenta, tu dirección pública, el evento y una huella del cupón, la hora del canje y cuántos sorteos oficiales te quedan. No guarda tu correo, tu nombre, la llave de tu sesión ni el código del cupón. Los topes por dirección IP se cuentan en memoria, y la dirección nunca se escribe en disco ni en registros.",
    prNote: "El modo Prueba es gratis. El modo Oficial también, con el cupón de tu evento. Participar en un sorteo y comprobarlo es gratis, siempre.",
    verifN3: "En el modo Prueba, guardá el comprobante de tus sorteos: sirve para volver a comprobarlos aunque el registro se reinicie el 16 de diciembre de 2026.",
    tmMore3: "Tinkazo es código abierto (MIT) y se ofrece tal cual, sin garantías. En el modo Prueba, guardá el comprobante de tus sorteos, que sirve para volver a comprobarlos aunque el registro se reinicie el 16 de diciembre de 2026. Si algo falla a mitad de un sorteo, cualquiera lo rehace con la lista y el número del sorteo: para eso están las reglas, escritas paso a paso.",
    vFinishNoWallet: "Para finalizarlo hace falta Freighter o la cuenta de prueba del modo Prueba.",
    vVerdictOkChainDetailTest: "Lo rehicimos acá y coincide con lo que quedó grabado en el contrato. Está en el modo Prueba, que se borra entero el 16 de diciembre de 2026: hasta entonces, cualquiera puede leer ese registro.",
    vVerdictMissingDetail: "Las cuentas cierran, pero el contrato no tiene registrado este sorteo. Puede ser un sorteo del modo Prueba ya borrado (ese modo se borra entero el 16 de diciembre de 2026), un registro archivado o un número que no existe. Para comprobarlo en el historial de Stellar hace falta el código de la transacción del sello, y los enlaces más antiguos no lo traen. Sin ese registro, nadie atestigua que esta sea la lista sellada.",
    vVerdictOkHistoryDetailTest: "{m}; se comprobó con su historial público de Stellar: el sello es del {f} (código {c}) y el número público salió después. Lo rehicimos acá y da el mismo nombre, así que nadie pudo elegir el resultado. El número de sorteo que trae el enlace no se puede comprobar por este camino: el sorteo se reconoce por esa fecha y ese código. Está en el modo Prueba, que se borra entero el 16 de diciembre de 2026.",
    evDetalleOkTest: "Todos cuadran con lo que quedó sellado en Stellar: la lista, el número público y el ganador. Están en el modo Prueba, que se borra entero el 16 de diciembre de 2026.",
    fotoPrueba: "Prueba",
    acctNetTest: "Prueba",
    acctNetMain: "Oficial",
    cfDura3: "<b>El modo Prueba:</b> sus sorteos van a la red de prueba, que Stellar borra entera el 16 de diciembre de 2026, con los sellos y sus horas. Tu comprobante sigue sirviendo para rehacer la cuenta, pero nadie podrá confirmar la hora del sello. Los del modo Oficial van a la red principal, que Stellar no reinicia.",
    sgLimit3: "Lo que el contrato guarda tiene alquiler: si nadie lo extiende, la entrada se archiva y deja de leerse hasta que alguien la restaure pagando. Y los sorteos del modo Prueba están en la red de prueba, que Stellar borra entera el 16 de diciembre de 2026: ahí sí se pierde el registro y el veredicto deja de ser verde.",
    loginTestnet: "Prueba",
    guestHint: "El navegador te arma una cuenta del modo Prueba y le pone fondos de prueba. No instalás nada.",
    guestReady: "Cuenta de prueba lista y con fondos de prueba.",
    guestTestnetOnly: "La cuenta de prueba solo funciona en el modo Prueba.",
    cfG4b: "Con Google, Pollar (en el modo Oficial, con Turnkey); con Freighter, tu extensión; con la cuenta de prueba, tu navegador",
    tmMore4: "Vigentes desde el 11 de noviembre de 2026, cuando sumamos el modo Oficial y, en ese modo, la llave de las cuentas que entran con Google pasó a protegerla Turnkey. Antes se habían sumado el servicio que cubre la comisión y cuenta los sellos de cada cuenta, el conteo sin saber quién es de los pasos del sorteo, el logo de la comunidad, el formulario para opinar y las rondas de ejemplo de los stands. Si cambian, cambia esta página, con su fecha.",
    tmQ4B: "Si conectás una cuenta, su dirección pública queda registrada como la de quien organizó el sorteo: es pública a propósito, para que cada sorteo tenga dueño. Si entrás con Google, Pollar recibe tu nombre, tu correo y tu foto, y se ocupa de la llave de tu cuenta: en el modo Prueba la guarda Pollar, y en el Oficial la protege Turnkey, el servicio de llaves que usa Pollar. Tinkazo nunca la ve. En este navegador quedan tus preferencias, como el idioma, el sonido y el ritmo del show; el historial de tus sorteos con sus listas, que se borra desde el sitio; la lista que estás armando, solo en esa pestaña y hasta que la sellás; los enlaces cortos que armaste o abriste acá; tu logo, si subiste uno; y la llave de la cuenta de prueba si la usás.",
  },
  en: {
    netTest: "Test",
    netTestHint: "For trying things calmly. Everything works the same and can be checked, but it is wiped on December 16.",
    netMainHint: "For the draws that count. The seal stays recorded on Stellar and anyone can redo the math with the receipt.",
    fundTag: "Test",
    fundBody: "Sealing needs a little. In Test it is test money: ask for it here and carry on.",
    fundFoot: "It's worth nothing: it only works in Test, for trying things out.",
    nextBody: "When you close the list, it is sealed before the number that decides exists, and any later change shows. Tinkazo pays the cost of sealing in Test mode, and in Live mode too if you use a coupon from your event. In Live mode, if you sign in with your own wallet, you pay the network's charge, which is a few cents. In Test mode, keep the receipts of your draws, because they let anyone check them again even after the record resets on December 16, 2026.",
    faq3a: "Tinkazo charges nothing for now. Pricing for organizers will be published very soon, and we'll tell you before we charge. Taking part and checking are always free. In Live mode, with a coupon from your event Tinkazo covers the network's charge. If you sign in with your own wallet, you pay it from your account.",
    cfCostoB: 'Recording each draw on the network has a cost. The network charges it, not Tinkazo, and almost all of it is storage rent: it changes with how much the network is used. In Test mode Tinkazo pays it. In Live mode Tinkazo pays it if you use a coupon from your event, and if you sign in with your own wallet, you pay it from your account. The measured figures, with their dates, are in <a href="https://github.com/nema1502/tinkazo/blob/main/docs/deployments.md" target="_blank" rel="noopener">docs/deployments.md</a>.',
    tmPatrocinio: "In Test mode, Tinkazo covers the charge the network makes for sealing and drawing. There may be a cap per account per month. If it runs out, you can pay with your own account or wait for it to come back. If there is a cap, to keep count the service stores how many seals and draws each account has made, with no names or lists. In Live mode, with a coupon from your event Tinkazo covers that charge while you have Live draws left. If you sign in with your own wallet, you pay it from your account.",
    tmMore1: "No ads, no trackers that follow you from site to site, no database of participants we can read. During a draw the site fetches the number a public beacon publishes and, if you have an account, what it needs from the Stellar network, from Pollar and from our service that covers the network charge, which runs on Cloudflare. To protect the fund that pays it, that service records each account's seals, with the time and the fingerprint of the list. It doesn't store the list, names or IP addresses. When you share or show it big, an encrypted copy of the receipt, which includes the list, is stored on Cloudflare. The key travels only in the link and never reaches us, so we can't read it. If you redeem an event coupon, that service checks your session with Pollar and stores the identifier Pollar gives your account, your public address, the event and a fingerprint of the coupon, the time you redeemed it and how many Live draws you have left. It doesn't store your email, your name, your session key or the coupon code. The limits per IP address are counted in memory, and the address is never written to disk or to logs.",
    prNote: "Test mode is free. So is Live mode, with a coupon from your event. Joining a draw and checking it is always free.",
    verifN3: "In Test mode, keep the receipt of your draws: it lets anyone check them again even after the record resets on December 16, 2026.",
    tmMore3: "Tinkazo is open source (MIT) and provided as is, without warranty. In Test mode, keep the receipt of your draws, because it lets anyone check them again even after the record resets on December 16, 2026. If something breaks in the middle of a draw, anyone can run it again with the list and the draw number: that is what the written, step-by-step rules are for.",
    vFinishNoWallet: "Finishing it needs Freighter, or the test account from Test mode.",
    vVerdictOkChainDetailTest: "We ran it again here and it matches what the contract recorded. It is in Test mode, which gets wiped on December 16, 2026: until then, anyone can read that record.",
    vVerdictMissingDetail: "The math adds up, but the contract has no record of this draw. It may be a draw from Test mode that was already wiped (that mode gets wiped on December 16, 2026), an archived record or a number that doesn't exist. To check it against Stellar's history you need the code of the seal transaction, and older links don't carry it. Without that record, nobody vouches that this is the sealed list.",
    vVerdictOkHistoryDetailTest: "{m}; it was checked against its public history on Stellar: the seal is from {f} (code {c}) and the public number came out after it. We ran it again here and got the same name, so nobody could pick the result. The draw number in the link can't be checked this way: the draw is recognized by that date and that code. It is in Test mode, which gets wiped on December 16, 2026.",
    evDetalleOkTest: "All of them match what was sealed on Stellar: the list, the public number and the winner. They are in Test mode, which gets wiped on December 16, 2026.",
    fotoPrueba: "Test",
    acctNetTest: "Test",
    acctNetMain: "Live",
    cfDura3: "<b>Test mode:</b> its draws go to the test network, which Stellar wipes on December 16, 2026, seals and their times included. Your receipt still lets anyone redo the math, but nobody will be able to confirm the seal time. Live mode draws go to the main network, which Stellar does not reset.",
    sgLimit3: "What the contract stores pays rent: if nobody extends it, the entry is archived and stops being readable until someone pays to restore it. And Test mode draws are on the test network, which Stellar wipes on December 16, 2026: there the record is lost and the verdict is no longer green.",
    loginTestnet: "Test",
    guestHint: "The browser makes you a Test mode account and funds it with test money. Nothing to install.",
    guestReady: "Test account ready, with test money.",
    guestTestnetOnly: "The test account only works in Test mode.",
    cfG4b: "With Google, Pollar (in Live mode, through Turnkey); with Freighter, your extension; with the test account, your browser",
    tmMore4: "In effect since November 11, 2026, when we added Live mode and, in that mode, the key of accounts that sign in with Google became protected by Turnkey. Before that came the service that covers the network charge and counts each account's seals, counting the steps of a draw without knowing who takes them, the community logo, the feedback form and the sample rounds for booths. If they change, this page changes, with its date.",
    tmQ4B: "If you connect an account, its public address is recorded as the organizer of the draw: public on purpose, so every draw has an owner. If you sign in with Google, Pollar receives your name, email and photo, and takes care of your account's key: in Test mode Pollar holds it, and in Live mode it is protected by Turnkey, the key service Pollar uses. Tinkazo never sees it. This device keeps your preferences, like language, sound and the show's pace; the history of your draws with their lists, which you can delete from the site; the list you're putting together, only in that tab and until you seal it; the short links you made or opened here; your logo, if you uploaded one; and the key of the test account if you use it.",
  },
};
