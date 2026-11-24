/**
 * El navegador de una app (Instagram, Facebook, Messenger, LinkedIn, TikTok,
 * Snapchat, Pinterest, WeChat, Telegram, la app de Google en iPhone, Line o una
 * vista web de Android): Google no deja entrar desde ahí. WhatsApp y X abren la
 * vista del navegador del sistema, donde la entrada sí está permitida — por
 * confirmar en un iPhone real (el dueño prueba el enlace desde WhatsApp y desde
 * X y corrige este comentario con lo que vea).
 * Va aparte, sin la página, para poder probarlo.
 */
export function enNavegadorDeApp(
  ua: string,
  pantallaDeInicio: boolean = typeof navigator !== "undefined" && (navigator as { standalone?: boolean }).standalone === true,
): boolean {
  // Tinkazo instalado en la pantalla de inicio de un iPhone corre sin la marca Safari/ y se tomaría por la vista web de una
  // app. No lo es: es el sitio mismo, así que Google se ofrece como siempre.
  if (pantallaDeInicio) return false;
  const aplicaciones = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|BytedanceWebview|musical_ly|TikTok/iu;
  const otras = /Snapchat|Pinterest|MicroMessenger|Telegram|\bGSA\/|\bLine\/|; wv\)/iu;
  if (aplicaciones.test(ua) || otras.test(ua)) return true;

  // En iPhone, las vistas web de apps que no se nombran en el texto también
  // chocan con Google. Pero los navegadores que sí se identifican y donde
  // Google deja entrar (Chrome: CriOS, Firefox: FxiOS, Edge: EdgiOS y la
  // familia «…iOS/», Ópera Touch: OPT) traen Safari/ sin Version/, así que van
  // antes de la regla y no cuentan como de app.
  if (/\biPhone\b/iu.test(ua)) {
    if (/\b(?:[a-z0-9]+iOS|OPT)\//iu.test(ua)) return false;
    // Una vista web de iPhone: trae AppleWebKit sin Safari/, o trae Safari/ y
    // sin Version/. Safari de verdad trae ambas marcas.
    const conWebKit = /AppleWebKit/iu.test(ua);
    const conSafari = /Safari\//iu.test(ua);
    const conVersion = /Version\//iu.test(ua);
    if (conWebKit && (!conSafari || !conVersion)) return true;
  }
  return false;
}
