import { describe, expect, it } from "vitest";
import { enNavegadorDeApp } from "./navegador";

describe("el navegador de una app, donde Google no deja entrar", () => {
  it.each([
    ["Instagram en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; es_BO)"],
    ["Facebook en Android", "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]"],
    ["Messenger en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/455.0.0;]"],
    ["LinkedIn", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6000"],
    ["TikTok", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 trill_340 BytedanceWebview/d8a21c6 musical_ly_2023"],
    ["una vista web de Android", "Mozilla/5.0 (Linux; Android 12; moto g(60); wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36"],
    ["Snapchat", "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Snapchat/12.80.0"],
    ["Pinterest", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Pinterest/12.1"],
    ["WeChat", "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.47"],
    ["Telegram", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Telegram/10.12"],
    ["la aplicación de Google en iPhone", "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 GSA/303.0"],
    ["una vista web de iPhone sin nombre", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"],
    ["una vista web de iPhone con Safari/ y sin Version/", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1"],
  ])("%s: sí", (_, ua) => {
    expect(enNavegadorDeApp(ua)).toBe(true);
  });

  it.each([
    ["Chrome en Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"],
    ["Safari en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"],
    ["Chrome en Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"],
    ["Firefox en Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"],
    ["Samsung Internet", "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36"],
    ["Chrome en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1"],
    ["Firefox en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/129.0.0 Mobile/15E148 Safari/605.1.15"],
    ["Edge en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 EdgiOS/116.2503.47 Mobile/15E148 Safari/604.1"],
    ["Brave en iPhone, de la familia «iOS/»", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BraveiOS/1.63.168 Mobile/15E148 Safari/604.1"],
    ["Ópera Touch en iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPT/4.2 Mobile/15E148 Safari/604.1"],
    ["Safari en Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"],
  ])("%s: no", (_, ua) => {
    expect(enNavegadorDeApp(ua)).toBe(false);
  });

  it("Tinkazo instalado en la pantalla de inicio del iPhone no cuenta como app", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(enNavegadorDeApp(ua, false)).toBe(true);
    expect(enNavegadorDeApp(ua, true)).toBe(false);
  });
});
