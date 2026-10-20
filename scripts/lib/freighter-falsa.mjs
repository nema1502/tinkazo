/**
 * Una Freighter de mentira, para los auditores.
 *
 * La librería de Freighter le habla a la extensión del navegador por
 * `window.postMessage`: manda `FREIGHTER_EXTERNAL_MSG_REQUEST` con un tipo y
 * espera un `FREIGHTER_EXTERNAL_MSG_RESPONSE` con el mismo identificador (que
 * la extensión escribe `messagedId`, con la errata). Con esto en la página
 * (`Page.addScriptToEvaluateOnNewDocument`), "Wallet · Freighter" aparece como
 * instalada, conecta con una dirección fija y el saldo de Horizon para esa
 * cuenta es "no existe todavía". Así se llega al paso de fondos de la ventana
 * de ingreso por el camino de verdad, sin extensión, sin permisos y sin red.
 *
 * No firma nada: no sirve para sellar. Solo para mirar ventanas.
 */

/** Una cuenta válida que no existe en la red: la del ejemplo de la documentación de Stellar. */
export const CUENTA_FALSA = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/** El código para `Page.addScriptToEvaluateOnNewDocument`. `saldo` es lo que contesta Horizon: `null` para "no existe" (404). */
export function freighterFalsa({ address = CUENTA_FALSA, saldo = null } = {}) {
  const horizon =
    saldo === null
      ? `new Response('{}', { status: 404 })`
      : `new Response(JSON.stringify({ balances: [{ asset_type: 'native', balance: '${saldo}' }] }), { status: 200 })`;
  return `(() => {
    window.freighter = true;
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (ev.source !== window || !d || d.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
      const r = (p) => window.postMessage({ source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: d.messageId, ...p }, location.origin);
      if (d.type === 'REQUEST_ACCESS' || d.type === 'REQUEST_PUBLIC_KEY') r({ publicKey: '${address}' });
      else if (d.type === 'REQUEST_ALLOWED_STATUS') r({ isAllowed: true });
      else if (d.type === 'REQUEST_CONNECTION_STATUS') r({ isConnected: true });
      else if (d.type === 'REQUEST_NETWORK_DETAILS' || d.type === 'REQUEST_NETWORK') {
        const passphrase = 'Test SDF Network ; September 2015';
        r({ network: 'TESTNET', networkPassphrase: passphrase, networkDetails: { network: 'TESTNET', networkName: 'Test Net', networkUrl: 'https://horizon-testnet.stellar.org', networkPassphrase: passphrase } });
      }
    });
    const f = window.fetch;
    window.fetch = (u, o) => {
      const s = String((u && u.url) || u);
      if (/horizon-testnet\\.stellar\\.org\\/accounts\\//.test(s)) return Promise.resolve(${horizon});
      return f.call(window, u, o);
    };
  })();`;
}
