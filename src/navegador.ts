/**
 * El navegador de una app (Instagram, Facebook, Messenger, LinkedIn, TikTok,
 * Snapchat, Pinterest, WeChat, Telegram, la app de Google en iPhone, Line o una
 * vista web de Android): Google no deja entrar desde ahí. WhatsApp y X abren
 * la vista del navegador del sistema, donde la entrada sí está permitida.
 * Va aparte, sin la página, para poder probarlo.
 */
export function enNavegadorDeApp(ua: string): boolean {
  const aplicaciones = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|BytedanceWebview|musical_ly|TikTok/iu;
  const otras = /Snapchat|Pinterest|MicroMessenger|Telegram|\bGSA\/|\bLine\/|; wv\)/iu;
  return aplicaciones.test(ua) || otras.test(ua);
}
