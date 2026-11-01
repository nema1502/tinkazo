import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import deployments from '../../src/stellar/deployments.json' with { type: 'json' };
const ref = { net: 'testnet', contract: deployments.testnet.contractId, id: '278' };
async function cli(args, handler = (_q, res) => res.end('[]')) {
  const requests = [];
  const server = createServer((req, res) => { const q = new URL(req.url, 'http://local').searchParams; requests.push(Object.fromEntries(q)); handler(q, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const child = spawn(process.execPath, ['scripts/conteos-confianza.mjs', ...args, '--api', `http://127.0.0.1:${server.address().port}/v1/conteos`]);
    let stdout = '', stderr = '';
    child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
    const code = await new Promise(r => child.on('close', r));
    return { code, stdout, stderr, requests };
  } finally { await new Promise(r => server.close(r)); }
}
const period = ['--desde', '2026-01-01', '--hasta', '2026-04-03'];
test('help y fechas explícitas reales, sin consultas ni salida parcial', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0); assert.match(help.stdout, /inclusivo UTC/); assert.equal(help.stderr, ''); assert.deepEqual(help.requests, []);
  for (const args of [[], ['--desde', '2026-02-30', '--hasta', '2026-03-01'], ['--desde', '2026-03-01', '--hasta', '2026-02-28'], ['--desde', '2026-01-01T00:00:00Z', '--hasta', '2026-01-01']]) {
    const r = await cli(args); assert.equal(r.code, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /Error:/); assert.deepEqual(r.requests, []);
  }
});
test('ventanas inclusivas disjuntas de 92 días y suma tres respuestas, no personas', async () => {
  const r = await cli(period, (q, res) => res.end(JSON.stringify(['yes', 'no', 'unsure'].map(answer => ({ dia: q.get('desde'), e: 'proof_trust', p: { answer }, ref, n: 2 })))));
  assert.equal(r.code, 0); assert.equal(r.stderr, '');
  assert.deepEqual(r.requests, [{ desde: '2026-01-01', hasta: '2026-04-02' }, { desde: '2026-04-03', hasta: '2026-04-03' }]);
  assert.match(r.stdout, /testnet.*278.*4\t4\t4\t12/); assert.match(r.stdout, /5 minutos/); assert.doesNotMatch(r.stdout, /personas|histórico/);
});
test('subdivide SOLO 413 muchas; un día saturado falla', async () => {
  const r = await cli(['--desde', '2026-01-01', '--hasta', '2026-01-04'], (q, res) => {
    if (q.get('desde') === '2026-01-01' && q.get('hasta') === '2026-01-04') { res.statusCode = 413; res.end('{"error":"muchas"}'); } else res.end('[]');
  });
  assert.equal(r.code, 0); assert.equal(r.stderr, '');
  assert.deepEqual(r.requests, [{ desde: '2026-01-01', hasta: '2026-01-04' }, { desde: '2026-01-01', hasta: '2026-01-02' }, { desde: '2026-01-03', hasta: '2026-01-04' }]);
  for (const [status, body] of [[429, '{"error":"cupo-ip"}'], [500, '{}'], [413, '{"error":"tamaño"}'], [200, '{}'], [200, '[{"dia":"2026-01-01","e":"proof_trust","p":{"answer":"maybe"},"n":1}]']]) {
    const bad = await cli(period, (_q, res) => { res.statusCode = status; res.end(body); });
    assert.equal(bad.code, 1); assert.equal(bad.stdout, ''); assert.match(bad.stderr, /Error:/); assert.equal(bad.requests.length, 1);
  }
  const full = await cli(['--desde', '2026-01-01', '--hasta', '2026-01-01'], (_q, res) => { res.statusCode = 413; res.end('{"error":"muchas"}'); });
  assert.equal(full.code, 1); assert.equal(full.stdout, ''); assert.equal(full.requests.length, 1);
});
test('error posterior no imprime totales incompletos', async () => {
  let n = 0;
  const r = await cli(period, (q, res) => {
    if (++n === 2) { res.statusCode = 429; res.end('{}'); }
    else res.end(JSON.stringify([{ dia: q.get('desde'), e: 'proof_trust', p: { answer: 'yes' }, ref, n: 10 }]));
  });
  assert.equal(r.code, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /HTTP 429/); assert.equal(r.requests.length, 2);
});
