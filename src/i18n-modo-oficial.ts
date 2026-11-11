import deployments from "./stellar/deployments.json";

/**
 * Los textos que cambian cuando existe el modo Oficial. Mientras `deployments.json` no tenga contrato en la red real
 * (`mainnet: null`, que es producción hoy) el sitio dice lo que decía: no hay otro modo del cual distinguir "Prueba", y
 * "En el modo Prueba, guardá…" le haría pensar a quien lee que existe uno. `i18n.ts` los pone encima del diccionario
 * solo si hay modo Oficial; las claves de este archivo son las que ya existían, con el texto de hoy en `i18n.ts`.
 * Los textos que solo existen para el modo Oficial (la hoja, los avisos, la confirmación) están en `i18n.ts`.
 *
 * Cuando se agregue el contrato real, en el mismo commit, el texto del HTML de cinco páginas pasa a ser el de este
 * archivo (es lo que se ve antes de que cargue el JavaScript y lo que leen los buscadores):
 * - `precios.html`, el párrafo `data-i="nextBody"`;
 * - `terminos.html`, el punto `data-i="tmMore3"`;
 * - `sorteo-verificable.html`, el punto `data-i="verifN3"`;
 * - `como-funciona.html`, el punto `data-i-html="cfDura3"`;
 * - `seguridad.html`, el punto `data-i="sgLimit3"`.
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
    nextBody: "Al cerrar la lista, se sella antes de que exista el número que decide, y cualquier cambio posterior se nota. El costo de sellar lo paga Tinkazo. En el modo Prueba, guardá el comprobante de tus sorteos, porque sirve para volver a comprobarlos aunque el registro se reinicie el 16 de diciembre de 2026.",
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
  },
  en: {
    netTest: "Test",
    netTestHint: "For trying things calmly. Everything works the same and can be checked, but it is wiped on December 16.",
    netMainHint: "For the draws that count. The seal stays recorded on Stellar and anyone can redo the math with the receipt.",
    fundTag: "Test",
    fundBody: "Sealing needs a little. In Test it is test money: ask for it here and carry on.",
    fundFoot: "It's worth nothing: it only works in Test, for trying things out.",
    nextBody: "When you close the list, it is sealed before the number that decides exists, and any later change shows. Tinkazo pays the cost of sealing. In Test mode, keep the receipts of your draws, because they let anyone check them again even after the record resets on December 16, 2026.",
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
  },
};
