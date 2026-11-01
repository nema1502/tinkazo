// UI simulada: no envía opiniones a producción ni evita guardas del emisor real.
// Servidor Vite propiedad del padre, sin adquirir de nuevo su lock.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import deployments from '../src/stellar/deployments.json' with { type: 'json' };
const { webkit } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const base = process.env.BASE_URL ?? 'http://localhost:5186';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Solo Vite local');
const out = resolve('docs/capturas/confianza-resultado');
await mkdir(out, { recursive: true });
const browser = await webkit.launch();
const evidence = [];
try {
  // Integración de verificar: revisión real con dependencias de red/firma simuladas.
  // La configuración real permanece apagada. Solo el montaje recibe un servicio ficticio.
  for (const mode of ['red', 'incomplete', 'previous', 'outside']) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.calls = 0;
      window.fixtureService = { disponible: () => true, confirmada: () => false, enviar: async () => { window.calls++; return 'recibida'; } };
    });
    await page.route('**/src/ui/confianza.ts*', async route => {
      if (new URL(route.request().url()).searchParams.has('fixture')) return route.continue();
      await route.fulfill({ contentType: 'application/javascript', body: `
        import { montarConfianza as montar } from '/src/ui/confianza.ts?fixture';
        import { validarRefConfianza } from '/workers/enlaces/src/conteo.ts';
        export function montarConfianza(box, ref) {
          const service = { ...window.fixtureService, disponible: r => !!validarRefConfianza(r) };
          montar(box, ref, service);
        }` });
    });
    await page.route('**/src/protocol/verificacion.ts*', async route => {
      if (new URL(route.request().url()).searchParams.has('fixture')) return route.continue();
      await route.fulfill({ contentType: 'application/javascript', body: `
        export * from '/src/protocol/verificacion.ts?fixture';
        import { revisarComprobante as revisar } from '/src/protocol/verificacion.ts?fixture';
        export async function revisarComprobante(proof) {
          window.attemptStarted = true;
          await new Promise(r => setTimeout(r, 750));
          const revision = await revisar(proof, {
            verificarFirma: async () => false,
            traerFirma: async () => { throw Error('SIMULACIÓN sin faro'); },
            leerRegistro: async () => { throw Error('SIMULACIÓN sin cadena'); }
          }, { k: 1 });
          window.fixtureVerdict = revision.veredicto;
          return revision;
        }` });
    });
    const anterior = deployments.testnet.anteriores[0];
    const proof = { v: 2, names: ['SIM A', 'SIM B'], round: 1000, net: 'testnet',
      contract: ['previous', 'outside'].includes(mode) ? anterior.contractId : deployments.testnet.contractId,
      id: mode === 'outside' ? String(anterior.ultimoId + 1) : mode === 'previous' ? String(anterior.ultimoId) : '278',
      ...(mode === 'incomplete' ? {} : { signature: '00'.repeat(48) }) };
    const hash = 'r' + Buffer.from(JSON.stringify(proof)).toString('base64url');
    await page.goto(`${base}/verificar.html#${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.attemptStarted === true);
    assert.equal(await page.locator('#confianza').isVisible(), false, 'no pregunta durante la revisión');
    await page.waitForFunction(() => !!window.fixtureVerdict);
    if (mode === 'outside') assert.equal(await page.locator('#confianza').isVisible(), false, 'anterior fuera de límite no pregunta');
    else {
      await page.locator('#confianza fieldset').waitFor();
      assert.equal(await page.locator('#sec-result').isVisible(), false, 'pregunta fuera del resultado oculto');
      const verdict = await page.locator('#verdict').innerText();
      await page.locator('#confianza input').first().check();
      await page.locator('#confianza button').click();
      await page.locator('#confianza-estado').filter({ hasText: /Gracias|Thank you/ }).waitFor();
      assert.equal(await page.locator('#verdict').innerText(), verdict, 'opinión no cambia el veredicto');
    }
    evidence.push({ integration: mode, simulation: true, verdict: await page.evaluate(() => window.fixtureVerdict), result: 'OK' });
    console.log(`OK integración simulada: ${mode}`);
    await page.close();
  }
  for (const width of [1280, 390]) for (const lang of ['es', 'en']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: lang });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/verificar.html?lang=${lang}&theme=${theme}`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#confianza').isVisible(), false, 'servicio real apagado, sin formulario');
    await page.evaluate(async () => {
      const { montarConfianza } = await import('/src/ui/confianza.ts');
      const ref = { net: 'testnet', contract: 'simulada', id: '1' };
      window.calls = 0;
      window.mode = 'recibida';
      const service = {
        disponible: () => true, confirmada: () => false,
        enviar: async () => { window.calls++; await new Promise(r => setTimeout(r, 250)); return window.mode; },
      };
      const label = document.createElement('p'); label.textContent = 'SIMULACIÓN UI · no se envían opiniones';
      document.querySelector('#confianza').before(label);
      montarConfianza(document.querySelector('#confianza'), ref, service);
      montarConfianza(document.querySelector('#confianza'), ref, service);
    });
    await page.getByRole('group', { name: lang === 'es' ? '¿Confiaste en el resultado?' : 'Did you trust the result?' }).waitFor();
    const group = page.locator('#confianza fieldset');
    assert.equal(await group.getByRole('radio').count(), 3);
    assert.equal(await group.locator(':checked').count(), 0);
    assert.equal(await page.locator('#sec-result #confianza').count(), 0);
    await group.scrollIntoViewIfNeeded();
    const snap = await group.ariaSnapshot();
    const file = `${width}-${lang}-${theme}`;
    await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
    await writeFile(`${out}/${file}.aria.txt`, snap);
    await group.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => window.calls), 0, 'flechas no envían');
    assert.equal(await group.locator(':checked').count(), 1);
    // Cambiar idioma no envía ni registra otro listener, conserva la selección.
    await page.locator(lang === 'es' ? '#l-en' : '#l-es').click();
    assert.equal(await page.evaluate(() => window.calls), 0);
    assert.equal(await group.locator(':checked').count(), 1);
    await page.locator(lang === 'es' ? '#l-es' : '#l-en').click();
    if (width === 390) await page.evaluate(() => { window.mode = 'incierta'; });
    await group.getByRole('button').click();
    // Un segundo submit programático mientras está pendiente tampoco envía.
    await page.locator('#confianza form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.calls), 1);
    if (width === 390) {
      assert.match(await page.locator('#confianza-estado').innerText(), lang === 'es' ? /dos veces/ : /twice/);
      assert.match(await group.getByRole('button').innerText(), lang === 'es' ? /dos veces/ : /twice/);
      await page.screenshot({ path: `${out}/${file}-incierta.png`, fullPage: true });
      await page.evaluate(() => { window.mode = 'recibida'; });
      await group.getByRole('button').click();
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => window.calls), 2);
    }
    await page.getByRole('status').filter({ hasText: lang === 'es' ? 'Respuesta recibida. Gracias' : 'Response received. Thank you' }).waitFor();
    assert.equal(await group.getByRole('button').isDisabled(), true);
    assert.deepEqual(errors, []);
    evidence.push({ width, lang, theme, simulation: true, group: snap, result: 'OK' });
    console.log(`OK simulación ${file}: radios, teclado, idioma, doble envío, confirmación`);
    await page.close();
  }
  await mkdir('.evidence/confianza-resultado', { recursive: true });
  await writeFile('.evidence/confianza-resultado/browser.json', JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
