import { type Lang, getLang } from "../idioma";

/**
 * Textos de la pantalla de quien ganó un premio de una campaña, en español y en
 * inglés. Todavía no se muestran en ninguna pantalla. Van aparte de `src/i18n.ts` y se leen directo de este módulo con `textoDelPremio`. Primero van todas las
 * claves en español y después todas en inglés, en el mismo orden. Todas empezan con pr.
 */

export const TEXTOS_PREMIOS: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    prGanoTitulo: "Ganaste",
    prGanoMonto: "{monto} dólares digitales",
    prRecibirBtn: "Recibir",
    prMirando: "Mirando tu premio en la red…",
    prActivando: "Abriendo la línea de tu cuenta…",
    prEnCaminoTitulo: "En camino",
    prEnCaminoLinea: "Tu premio está en camino a tu cuenta. Cuando llegue, lo ves en tu saldo.",
    prListoTitulo: "Listo",
    prListoLinea: "Ya está en tu cuenta: lo ves en tu saldo.",
    prListoEnlaceTx: "Ver la transacción",
    prVolvioTitulo: "Volvió a la empresa",
    prVolvioLinea: "El plazo para recibir se terminó y el premio volvió a la empresa. Hablá con quien organizó la campaña.",
    prPremiosTitulo: "Tus premios",
    prPremiosVacio: "Cuando una campaña te dé un premio, lo ves acá.",
    prEstadoRecibido: "Recibido",
    prEstadoPorRecibir: "Por recibir hasta {fecha}",
    prEstadoVolvio: "Volvió a la empresa",
    prSinPremioLinea: "No hay ningún premio a tu nombre todavía en esta campaña.",
    prOtraVez: "Probar otra vez",
    prVolverAMirar: "Volver a mirar",
    prErrRed: "Sin conexión con la red. Probá otra vez.",
    prErrRaro: "No pudimos leer tu premio en la red. Probá otra vez.",
    prLineaActivada: "Tu cuenta ya puede recibir: el premio se manda solo, está en camino.",
    prLineaEnviada: "Ya está pedido lo que abre la línea de tu cuenta. Esperá unos segundos y volvé a mirar.",
    prLineaHecho: "El proveedor está abriendo la línea de tu cuenta. Esperá un momento, la pantalla sigue sola.",
    prLineaEnCurso: "El proveedor ya está ocupado con tu cuenta. Esperá un momento y volvé a mirar.",
    prLineaNoAprobada: "No se aprobó el pedido, así que no se hizo nada. Probá de nuevo.",
    prLineaAhoraNo: "Ahora no se puede recibir. Tu cuenta está bien: probá más tarde.",
    prLineaNoCoincide: "El pedido no era el que la ventana esperaba, así que no se hizo nada. Probá de nuevo.",
    prLineaNoCoincideTope: "El proveedor no acepta el pedido en esta pestaña. No lo intentes de nuevo acá: escribinos a hola@tinkazo.app.",
    prLineaNoPatrocina: "Por ahora esta cuenta no puede abrir la línea. Probá más adelante o pedí el premio con otra cuenta.",
    prLineaSinXlm: "A tu cuenta le falta para pagar la comisión de abrir la línea. Sumale XLM y probá de nuevo.",
    prLineaOtraRed: "Tu cuenta está en otra red. Cambiala a la de la campaña y probá de nuevo.",
    prLineaNoSalio: "No se pudo abrir la línea. Probá de nuevo.",
    prLineaSinRed: "Sin conexión con la red. Probá otra vez.",
    prLineaNoCorre: "Esta cuenta se maneja desde la app de Tinkazo. Entrá desde ahí para recibir el premio.",
    prLineaApagada: "Acá no se puede abrir la línea con el proveedor. Entrá desde la app de Tinkazo.",
    prLineaCuentaCreandose: "Tu cuenta todavía se está creando. Esperá unos minutos y volvé a mirar.",
    prLineaProteger: "Tu cuenta todavía no está lista. Terminá de dejarla lista y volvé.",
  },
  en: {
    prGanoTitulo: "You won",
    prGanoMonto: "{monto} digital dollars",
    prRecibirBtn: "Receive",
    prMirando: "Looking for your prize on the network…",
    prActivando: "Opening your account line…",
    prEnCaminoTitulo: "On the way",
    prEnCaminoLinea: "Your prize is on its way to your account. When it arrives, you will see it in your balance.",
    prListoTitulo: "Done",
    prListoLinea: "It is already in your account: you will see it in your balance.",
    prListoEnlaceTx: "See the transaction",
    prVolvioTitulo: "It went back to the company",
    prVolvioLinea: "The deadline to receive it ended and the prize went back to the company. Talk to whoever organized the campaign.",
    prPremiosTitulo: "Your prizes",
    prPremiosVacio: "When a campaign gives you a prize, you will see it here.",
    prEstadoRecibido: "Received",
    prEstadoPorRecibir: "To receive until {fecha}",
    prEstadoVolvio: "It went back to the company",
    prSinPremioLinea: "There is no prize in your name yet in this campaign.",
    prOtraVez: "Try again",
    prVolverAMirar: "Check again",
    prErrRed: "No connection to the network. Try again.",
    prErrRaro: "We could not read your prize on the network. Try again.",
    prLineaActivada: "Your account can receive now: the prize is sent by itself, it is on the way.",
    prLineaEnviada: "What opens your account line was already asked. Wait a few seconds and check again.",
    prLineaHecho: "The provider is opening your account line. Wait a moment, the screen follows by itself.",
    prLineaEnCurso: "The provider is already busy with your account. Wait a moment and check again.",
    prLineaNoAprobada: "The request was not approved, so nothing was done. Try again.",
    prLineaAhoraNo: "It cannot be received right now. Your account is fine: try later.",
    prLineaNoCoincide: "The request was not the one the window expected, so nothing was done. Try again.",
    prLineaNoCoincideTope: "The provider does not accept the request in this tab. Do not try again here: write us at hola@tinkazo.app.",
    prLineaNoPatrocina: "For now this account cannot open its line. Try later or ask for the prize with another account.",
    prLineaSinXlm: "Your account is short to pay the fee to open the line. Add some XLM and try again.",
    prLineaOtraRed: "Your account is on another network. Switch it to the one of the campaign and try again.",
    prLineaNoSalio: "The line could not be opened. Try again.",
    prLineaSinRed: "No connection to the network. Try again.",
    prLineaNoCorre: "This account is managed from the Tinkazo app. Open it from there to receive the prize.",
    prLineaApagada: "Here the line cannot be opened with the provider. Open it from the Tinkazo app.",
    prLineaCuentaCreandose: "Your account is still being created. Wait a few minutes and come back to check.",
    prLineaProteger: "Your account is not ready yet. Finish getting it ready and come back.",
  },
};

/** Los {huecos} de un texto con lo que llevan, como el panel de la empresa. */
export const sustituir = (texto: string, vars: Record<string, string>): string =>
  texto.replace(/\{(\w+)\}/gu, (sinNombre, clave: string) => vars[clave] ?? sinNombre);

/** Para un resultado de la línea en llaves: prLineaNoPuedeAbrir, la clave que le corresponde. */
export const claveDelResultadoDeLaLinea = (resultado: string): string =>
  `prLinea${resultado.replace(/(?:^|-)([a-z])/gu, (_, c: string) => c.toUpperCase())}`;

/** La clave con el idioma de la pantalla, con los {huecos} que lleva, tal cual el panel de la empresa. */
export function textoDelPremio(clave: string, vars: Record<string, string> = {}): string {
  const idioma: Lang = getLang() === "en" ? "en" : "es";
  const base = TEXTOS_PREMIOS[idioma][clave] ?? TEXTOS_PREMIOS.es[clave] ?? clave;
  return sustituir(base, vars);
}
