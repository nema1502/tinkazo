/**
 * Los textos de las páginas de lectura que cambian cuando el modo Oficial se abre con cupones de evento: quién paga la
 * comisión de la red en Oficial y qué guarda el servicio de Tinkazo al canjear un cupón. Solo en un build con
 * `VITE_ALTA=1` y con el modo Oficial a la vista (`i18n.ts` los pone encima del diccionario, después de los de
 * `i18n-modo-oficial.ts`): con la bandera apagada, que es la de hoy, las páginas dicen lo que decían.
 *
 * - `nextBody` (precios.html), `faq3a` (index.html), `cfCostoB` (como-funciona.html) y `tmPatrocinio` (terminos.html):
 *   en Oficial, con un cupón de evento la comisión la cubre Tinkazo; con la billetera propia, la paga quien entra.
 * - `tmMore1` (terminos.html): desde el primer canje, el servicio guarda el identificador de la cuenta de Pollar junto a
 *   la dirección pública, al evento del cupón y a los sorteos oficiales que quedan. Es el texto de hoy con una frase
 *   más al final.
 *
 * Igual que `alta-textos-precios.ts`, el texto del HTML de esas cuatro páginas (lo que se ve antes de que cargue el
 * JavaScript y lo que leen los buscadores) pasa a ser este en el mismo commit en que se prende la bandera en
 * producción. Hasta entonces `revision-textos.test.ts` y `seo.test.ts` comparan el HTML con el diccionario sin la
 * bandera, y no cambian.
 */
export const TEXTOS_CON_CUPON: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    nextBody:
      "Al cerrar la lista, se sella antes de que exista el número que decide, y cualquier cambio posterior se nota. El costo de sellar lo paga Tinkazo en el modo Prueba, y también en el modo Oficial si usás el cupón de tu evento; en el modo Oficial, quien entra con su propia billetera paga la comisión de la red, que es de centavos. En el modo Prueba, guardá el comprobante de tus sorteos, porque sirve para volver a comprobarlos aunque el registro se reinicie el 16 de diciembre de 2026.",
    faq3a:
      "Hoy Tinkazo no cobra nada. Los precios para quien organiza se publican muy pronto, y te avisamos antes de cobrar. Participar y comprobar son gratis siempre. En el modo Oficial, con el cupón de tu evento la comisión de la red la cubre Tinkazo; quien entra con su propia billetera la paga de su cuenta.",
    cfCostoB:
      'Grabar cada sorteo en la red tiene un costo. Lo cobra la red, no Tinkazo, y casi todo es renta de almacenamiento: cambia con el uso de la red. En el modo Prueba lo paga Tinkazo. En el modo Oficial lo paga Tinkazo si usás el cupón de tu evento, y quien entra con su propia billetera lo paga de su cuenta. Las cifras medidas, con su fecha, están en <a href="https://github.com/nema1502/tinkazo/blob/main/docs/deployments.md" target="_blank" rel="noopener">docs/deployments.md</a>.',
    tmPatrocinio:
      "En el modo Prueba, Tinkazo cubre la comisión que cobra la red por sellar y sortear. Puede haber un tope por cuenta y por mes; si se agota, se puede pagar con la propia cuenta o esperar a que vuelva. Si hay tope, para llevar la cuenta el servicio guarda cuántos sellos y sorteos hizo cada cuenta, sin nombres ni listas. En el modo Oficial, con el cupón de tu evento Tinkazo cubre esa comisión mientras te queden sorteos oficiales; quien entra con su propia billetera la paga de su cuenta.",
    tmMore1:
      "No hay publicidad ni rastreadores que te sigan de un sitio a otro, ni una base de datos de participantes que podamos leer. Durante un sorteo el sitio pide afuera el número que publica un faro público y, si tenés cuenta, lo que hace falta de la red Stellar, de Pollar y de nuestro servicio que cubre la comisión, que corre en Cloudflare: para cuidar el fondo que la paga, cuenta cuántos sellos hizo cada cuenta y no guarda nombres, listas ni direcciones IP. Al compartir o mostrar en grande, guarda en Cloudflare la copia del enlace corto. Si canjeás un cupón de evento, ese servicio confirma tu sesión con Pollar y guarda el identificador de tu cuenta de Pollar junto a tu dirección pública, al evento del cupón y a cuántos sorteos oficiales te quedan. No guarda tu correo, tu nombre, los datos de tu sesión ni el código del cupón, y los topes por dirección IP se cuentan en memoria, sin guardarla.",
  },
  en: {
    nextBody:
      "When you close the list, it is sealed before the number that decides exists, and any later change shows. Tinkazo pays the cost of sealing in Test mode, and in Live mode too if you use a coupon from your event; in Live mode, if you sign in with your own wallet, you pay the network's charge, which is a few cents. In Test mode, keep the receipts of your draws, because they let anyone check them again even after the record resets on December 16, 2026.",
    faq3a:
      "Tinkazo charges nothing for now. Pricing for organizers will be published very soon, and we'll tell you before we charge. Taking part and checking are always free. In Live mode, with a coupon from your event Tinkazo covers the network's charge; if you sign in with your own wallet, you pay it from your account.",
    cfCostoB:
      'Recording each draw on the network has a cost. The network charges it, not Tinkazo, and almost all of it is storage rent: it changes with how much the network is used. In Test mode Tinkazo pays it. In Live mode Tinkazo pays it if you use a coupon from your event, and if you sign in with your own wallet, you pay it from your account. The measured figures, with their dates, are in <a href="https://github.com/nema1502/tinkazo/blob/main/docs/deployments.md" target="_blank" rel="noopener">docs/deployments.md</a>.',
    tmPatrocinio:
      "In Test mode, Tinkazo covers the charge the network makes for sealing and drawing. There may be a cap per account per month; if it runs out, you can pay with your own account or wait for it to come back. If there is a cap, to keep count the service stores how many seals and draws each account has made, with no names or lists. In Live mode, with a coupon from your event Tinkazo covers that charge while you have Live draws left; if you sign in with your own wallet, you pay it from your account.",
    tmMore1:
      "No ads, no trackers that follow you from site to site, no database of participants we can read. During a draw the site fetches the number a public beacon publishes and, if you have an account, what it needs from the Stellar network, from Pollar and from our service that covers the network charge, which runs on Cloudflare: to protect the fund that pays it, it counts how many seals each account has made and stores no names, lists or IP addresses. When you share or show it big, it stores the short link's copy on Cloudflare. If you redeem an event coupon, that service checks your session with Pollar and stores your Pollar account's identifier along with your public address, the coupon's event and how many Live draws you have left. It doesn't store your email, your name, your session details or the coupon code, and the limits per IP address are counted in memory, without storing the address.",
  },
};
