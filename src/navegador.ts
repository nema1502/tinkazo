/**
 * El navegador de una app (Instagram, Facebook, Messenger, LinkedIn, TikTok,
 * Line o una vista web de Android): Google no deja entrar desde ahí
 * ("disallowed_useragent"). La entrada ofrece el correo primero y una línea que
 * lo explica (wallet-ui.ts). Va aparte, sin la página, para poder probarlo.
 */
export function enNavegadorDeApp(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|BytedanceWebview|musical_ly|TikTok|\bLine\/|; wv\)/i.test(ua);
}
