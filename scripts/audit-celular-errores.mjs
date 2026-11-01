// Auditor acotado: adaptadores externos de mentira, controles y módulos UI reales.
if (process.argv.includes('--help')) {
  console.log('Uso: node scripts/audit-celular-errores.mjs [--before] [--preserve]\nRequiere Vite local en http://127.0.0.1:5173. PLAYWRIGHT_PATH permite usar una instalación existente; CHROME selecciona Chromium y CDP_PORT su puerto. CELULAR_SOURCE apunta a una copia base aislada. --before identifica capturas previas; --preserve evalúa solo los casos conservados. No autentica ni escribe en cadena. Evidencia: .evidence/celular/errores/ y docs/capturas/celular/errores/.');
  process.exit(0);
}
// Permite usar una instalación existente sin agregar dependencias al proyecto.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { transformWithOxc } from 'vite';
const source = process.env.CELULAR_SOURCE;
const fase = source ? 'baseline' : process.argv.includes('--before') ? 'before' : 'after';
const out = '.evidence/celular/errores';
const capturas = 'docs/capturas/celular/errores';
await mkdir(out, { recursive: true }); await mkdir(capturas, { recursive: true });
const vectors = JSON.parse(await readFile('docs/vectors.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${process.env.CDP_PORT || 9612}`] });
const resultados = [];
const check = (caso, ok, detalle) => { resultados.push({ caso, ok: !!ok, detalle }); console.log(`${ok ? 'PASS' : 'FAIL'} ${caso}: ${JSON.stringify(detalle)}`); };
const wallet = `export const WALLET_ERRORS={notInstalled:'not-installed',rejected:'wallet-rejected',friendbot:'friendbot-failed',guestTestnetOnly:'guest-testnet-only',popupBlocked:'popup-blocked',popupClosed:'popup-closed',popupNoSession:'popup-no-session'};
export const freighterInstalled=async()=>false, guestAvailable=()=>false, guestStored=()=>false, freighterAllowed=async()=>false, setActiveWallet=()=>{}, activeWallet=()=>null, xlmBalance=async()=>10;
export const freighterWallet={restore:async()=>null};`;
async function pagina(lang = 'es', width = 375, tema = 'dark', carga = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  let falloInicial = carga;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5173') return route.abort();
    if (url.pathname === '/src/stellar/wallet-lite.ts') {
      if (falloInicial) { falloInicial=false; return route.abort('failed'); }
      return route.fulfill({ contentType: 'text/javascript', body: wallet });
    }
    if (url.pathname === '/src/stellar/wallet-pollar.ts') return route.fulfill({ contentType: 'text/javascript', body: `export const pollarConfigured=()=>true, submitsItself=()=>true, precargarSdk=()=>{}; export const pollarWallet={restore:async()=>null,hayMarca:()=>false,connect:async()=>{throw new Error(window.causa||'boom')},sendEmailCode:async()=>{if(window.causa)throw new Error(window.causa)}, verifyEmailCode:async()=>{throw new Error(window.causa||'boom')}};` });
    if (url.pathname === '/src/ui/anchor.ts') return route.fulfill({ contentType: 'text/javascript', body: `export const anchorErrorText=async()=>'',clienteListo=async()=>{},precalentarSello=()=>{},hideTxStatus=()=>{},margenParaAprobar=async()=>0,precargarParaElSorteo=()=>{},resolverSelloEnLaRed=async()=>{throw Error('no writes')},sealOnChain=async()=>{throw Error('no writes')},selloSinGrabar=()=>false,showTxStatus=()=>{},stepLabel=()=>'',limpiarDetalle=()=>{};
export const drawOnChain=async()=>{window.envios=(window.envios||0)+1;throw Error('Error(Contract, #'+(window.caso==='notFound'?1:2)+')')}; export const readDraw=async()=>window.registrado?{winners:[1],randomness:'ab'.repeat(32)}:null;
export const existenciaDelSorteo=async()=>window.ausente?'ausente':'desconocida';
export const escribirError=async(el,e)=>{el.textContent=e.message.includes('#1')?'No encontramos ese sorteo en Stellar. Sellá la lista de nuevo.':'Ese sorteo ya tiene ganador. Lo encontrás en Mis sorteos.'};` });
    if (url.pathname === '/src/protocol/firma.ts') return route.fulfill({ contentType: 'text/javascript', body: 'export const prepararFirma=()=>{},verifyRoundAsync=async()=>true;' });
    // La ronda real del vector, sin consultar relays ni escribir en cadena.
    if (url.pathname === '/src/protocol/quicknet.ts') {
      const response = await route.fetch(); const source = await response.text();
      return route.fulfill({ response, body: source.replace(/export async function fetchRound\([\s\S]*?\n}/, `export async function fetchRound(){return ${JSON.stringify(vectors.quicknet)}}`) });
    }
    if(source && ['/src/ui/wallet-ui.ts','/src/ui/draw.ts','/src/ui/siguiente.ts','/src/ui/espera.ts','/src/i18n.ts'].includes(url.pathname)) {
      const codigo=await readFile(source+url.pathname,'utf8');
      // Vite agrega las extensiones en el código servido; igualamos esa resolución
      // para que la copia use los mismos adaptadores y la misma instancia de estado.
      const imports=codigo.replace(/((?:from\s*|import\s*\()\s*["'])(\.\.?\/[^"']+)(["'])/g,(_,antes,ruta,fin)=>antes+ruta+(/\.[a-z]+$/i.test(ruta)?'':'.ts')+fin);
      const {code}=await transformWithOxc(imports,url.pathname,{lang:'ts',target:'esnext'});
      return route.fulfill({contentType:'text/javascript',body:'import.meta.env={DEV:true};\n'+code});
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:5173/?instant=1&lang=${lang}&theme=${tema}#sortear`);
  await page.waitForSelector('#wallet-box .cuenta-chip');
  return { page, context };
}
async function picker(page) { await page.locator('#wallet-box .cuenta-chip').click(); await page.waitForSelector('.login'); }
async function preparar(page, caso, registrado = false, ausente = false) {
  await page.evaluate(async ({ caso, registrado, ausente, round }) => {
    window.caso=caso;window.registrado=registrado;window.ausente=ausente;
    const { resumeFrozen }=await import('/src/ui/freeze.ts');
    const { listHash }=await import('/src/protocol/canonical.ts');
    const { bytesToHex }=await import('/src/protocol/quicknet.ts');
    const names=['Ana','Beto','Carla'];
    resumeFrozen({ names,listHash:bytesToHex(listHash(names)),sealedAt:1,prize:'Termo',round,numWinners:1,id:'42' });
  }, { caso, registrado, ausente, round: vectors.quicknet.round });
}
try {
  // E1: rechazo antes de que exista el diálogo. No queda una promesa sin atender.
  {
    const {page,context}=await pagina('es',320,'dark',true); const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#ta').fill('Ana\nBeto\nCarla');
    await page.locator('#wallet-box .cuenta-chip').click(); await page.waitForTimeout(700);
    check('E1 selector',await page.locator('.wallet-notice button').count()>0,{errores:errors,texto:await page.locator('.wallet-notice').allTextContents()});
    await page.screenshot({path:`${capturas}/${fase}-E1.png`});
    if(fase==='after') {
      await page.locator('.wallet-notice button').first().click(); await page.waitForSelector('.login');
      check('E1 reintento abre selector',await page.locator('.login').count()===1,await page.locator('.wallet-notice').allTextContents());
      check('E1 conserva lista al recargar',await page.locator('#ta').inputValue()===['Ana','Beto','Carla'].join('\n'),'borrador retomado');
    }
    await context.close();
  }
  for(const lang of ['es','en']) {
    const {page,context}=await pagina(lang); await picker(page);
    await page.locator('.login-google').click(); await page.waitForTimeout(300);
    check(`E2 ${lang}`,await page.locator('.wallet-notice button').count()>0,await page.locator('.wallet-notice').allTextContents());
    await page.screenshot({path:`${capturas}/${fase}-E2-${lang}.png`});
    if(fase==='after') {
      if(lang==='es') { await page.waitForTimeout(7200); check('E2 error persiste',await page.locator('.wallet-notice').count()===1,'más de siete segundos'); }
      await page.locator('.wallet-notice button').first().click();
      check(`E2 otra vía ${lang}`,await page.locator('.login').count()===1&&await page.locator('#login-mail').evaluate(el=>el===document.activeElement),'sin duplicar ventanas');
      for(const causa of ['popup-blocked','popup-closed','Failed to fetch']) {
        await page.evaluate(c=>window.causa=c,causa);await page.locator('.login-google').click();await page.waitForTimeout(150);
        const texto=await page.locator('.wallet-notice').innerText();
        check(`E2 conocido ${causa} ${lang}`,causa==='Failed to fetch'?/conex|connect/i.test(texto):/Google|window|ventana/.test(texto),texto);
        await page.locator('.wallet-notice button').last().click();
      }
    }
    await page.evaluate(()=>window.causa='boom'); await page.locator('#login-mail').fill('persona@example.org'); await page.locator('.login-go').click();
    // Espera la finalización de este envío: un texto vacío no es una recuperación.
    await page.waitForFunction(() => !document.querySelector('.login-go')?.disabled && !document.querySelector('.login-err')?.hidden && document.querySelector('.login-err')?.textContent?.trim());
    const envio=await page.locator('.login-err').innerText();
    check(`E3 envío neutral ${lang}`,envio.trim().length>0&&!/Revisá el correo|Check the address/.test(envio),envio);
    await page.evaluate(()=>window.causa=''); await page.locator('.login-go').click(); await page.waitForSelector('#login-code');
    for(const causa of ['EMAIL_CODE_INVALID','EMAIL_CODE_EXPIRED','boom','Failed to fetch']) {
      await page.evaluate(c=>window.causa=c,causa); await page.locator('#login-code').fill('123456'); await page.locator('.login-go').click();
      await page.waitForFunction(() => !document.querySelector('.login-go')?.disabled && !document.querySelector('.login-err')?.hidden && document.querySelector('.login-err')?.textContent?.trim());
      const texto=await page.locator('.login-err').innerText();
      check(`E3 ${causa} ${lang}`,causa==='boom'? /otra|another|correo|email/.test(texto) : causa==='Failed to fetch'? /conex|connect/i.test(texto) : causa==='EMAIL_CODE_INVALID'? /último|latest/.test(texto):/venció|expired/.test(texto),texto);
    }
    check(`sin mailto ${lang}`,await page.locator('.login a[href^="mailto:"]').count()===0,'ejemplo de correo es texto');
    await page.screenshot({path:`${capturas}/${fase}-E3-${lang}.png`}); await context.close();
  }
  for(const [caso,registrado,ausente] of [['alreadyDrawn',true,false],['alreadyDrawn',false,false],['notFound',false,true],['notFound',false,false]]) {
    const {page,context}=await pagina(); await preparar(page,caso,registrado,ausente);
    await page.locator('#btn-draw').click(); await page.waitForTimeout(1600);
    const texto=await page.locator('#btn-draw').innerText();
    check(`E4 ${caso} registrado=${registrado} ausente=${ausente}`, registrado?await page.locator('#winner-box').isVisible():ausente?/prepar/i.test(texto):/consult/i.test(texto),{boton:texto,status:await page.locator('#draw-status').innerText()});
    await page.screenshot({path:`${capturas}/${fase}-E4-${caso}-${registrado}-${ausente}.png`});
    if(fase==='after'&&registrado) check('resultado registrado sin selección nueva',await page.locator('.winner-name').innerText()==='Beto','índice registrado 1');
    if(fase==='after'&&!registrado&&!ausente) {
      await page.locator('#btn-draw').click(); await page.waitForURL('**/verificar.html#**');
      const comprobante=await page.evaluate(async()=>{const {decodeProof}=await import('/src/protocol/proof.ts');return decodeProof(location.hash);});
      check(`consulta exacta ${caso}`,comprobante.id==='42'&&comprobante.net==='testnet'&&!!comprobante.contract&&comprobante.names.join(',')==='Ana,Beto,Carla',comprobante);
    }
    await context.close();
  }
  if(fase==='after') for(const [index,width] of [320,360,375,414].entries()) for(const lang of ['es','en']) {
    const tema=index%2?'light':'dark';
    for(const superficie of ['barra','espera']) {
      const {page,context}=await pagina(lang,width,tema); await preparar(page,'notFound',false,true);
      if(superficie==='barra') {
        await page.evaluate(()=>scrollTo(0,0));
        await page.locator('#siguiente.on').waitFor(); await page.locator('#sig-btn').click();
      } else {
        await page.evaluate(async()=>{
          const m=await import('/src/ui/espera.ts');
          m.mostrarEspera(()=>5,{sortear:()=>document.getElementById('btn-draw').click(),aMano:()=>false,graba:true,juegos:()=>[],elegirJuego:()=>{}});
          m.nacioElNumero();
        });
      }
      const accion=superficie==='espera'?page.locator('.espera-accion'):page.locator('#btn-draw');
      await accion.waitFor(); await page.waitForTimeout(300);
      const texto=await accion.innerText();
      check(`E4 ${superficie} ${width} ${lang} ${tema}`,/prepar/i.test(texto),texto);
      const botones=await page.evaluate(()=>[...document.querySelectorAll('#btn-draw,#sig-btn,.espera-accion')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}).map(b=>({texto:b.textContent,alto:b.getBoundingClientRect().height})));
      check(`una principal táctil ${superficie} ${width} ${lang}`,botones.length===1&&botones[0].alto>=44,botones);
      if(index===0) await page.screenshot({path:`${capturas}/${fase}-${superficie}-${lang}.png`});
      await accion.click(); await page.waitForTimeout(400);
      const estado=await page.evaluate(async()=>{const {app}=await import('/src/state.ts');return {frozen:app.frozen,lista:document.getElementById('ta').value,premio:document.getElementById('prize').value,nw:document.getElementById('nw').value,envios:window.envios,espera:!!document.querySelector('.espera')};});
      check(`preparar conserva datos y no sella ${superficie} ${width} ${lang}`,estado.frozen===null&&estado.lista===['Ana','Beto','Carla'].join('\n')&&estado.premio==='Termo'&&estado.nw==='1'&&estado.envios===1&&!estado.espera,estado);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(`${out}/${fase}.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),diff:execFileSync('git',['diff','--','src/ui','src/i18n.ts'],{encoding:'utf8'}),resultados},null,2));
}
const preservacion=process.argv.includes('--preserve');
process.exitCode=resultados.filter(r=>!preservacion||/EMAIL_CODE_INVALID|EMAIL_CODE_EXPIRED|sin mailto|E4 alreadyDrawn registrado=true/.test(r.caso)).every(r=>r.ok)?0:1;
