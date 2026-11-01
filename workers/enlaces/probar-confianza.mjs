// Prueba HTTP con SQLite real en Wrangler LOCAL y estado aislado. Nunca producción.
import assert from 'node:assert/strict';
import deployments from '../../src/stellar/deployments.json' with { type: 'json' };
const base = process.argv[2] ?? 'http://localhost:8792';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Solo runtime local aislado');
const ref = { net: 'testnet', contract: deployments.testnet.contractId, id: '278' };
const hoy = new Date().toISOString().slice(0, 10);
const previo = n => new Date(Date.parse(`${hoy}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
// Rangos deterministas distintos: la caché de 5 minutos nunca oculta una suma.
async function leer(n) {
  const r = await fetch(`${base}/v1/conteos?desde=${previo(n)}&hasta=${hoy}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  return (await r.json()).filter(f => f.dia === hoy);
}
async function post(body, status = 204) {
  const r = await fetch(`${base}/v1/contar`, { method: 'POST', headers: { Origin: 'https://tinkazo.app', 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
  assert.equal(r.status, status, JSON.stringify(body));
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://tinkazo.app');
  if (status === 204) assert.equal(await r.text(), '');
}
const baseRows = await leer(0);
for (const body of [
  { e: 'proof_trust', p: { answer: 'yes' } },
  { e: 'proof_trust', p: { answer: 'maybe' }, ref },
  { e: 'proof_trust', p: { answer: 'yes', name: 'x' }, ref },
  { e: 'proof_trust', p: { answer: 'yes' }, ref: { ...ref, id: '0' } },
  { e: 'proof_trust', p: { answer: 'yes' }, ref: { ...ref, contract: 'C' + 'A'.repeat(55) } },
  { e: 'proof_trust', p: { answer: 'yes' }, ref: { ...ref, marker: 'x' } },
  { e: 'proof_trust', p: { answer: 'yes' }, ref, timestamp: 1 },
]) await post(body, 400);
for (const a of deployments.testnet.anteriores) {
  const anterior = { ...ref, contract: a.contractId, id: String(a.ultimoId) };
  await post({ e: 'proof_trust', p: { answer: 'yes' }, ref: { ...anterior, id: String(a.ultimoId + 1) } }, 400);
  for (const [e, p] of [['share', { channel: 'copy' }], ['proof_open', { via: 'qr' }], ['proof_verdict', { verdict: 'red' }]]) await post({ e, p, ref: anterior }, 400);
}
assert.deepEqual(await leer(1), baseRows, 'rechazos no cambian las sumas');
const validos = [];
for (const answer of ['yes', 'no', 'unsure']) validos.push({ e: 'proof_trust', p: { answer }, ref });
validos.push(validos[0]); // No promete idempotencia: una repetición válida suma otra vez.
for (const a of deployments.testnet.anteriores) validos.push({ e: 'proof_trust', p: { answer: 'unsure' }, ref: { ...ref, contract: a.contractId, id: String(a.ultimoId) } });
for (const [e, p] of [['share', { channel: 'copy' }], ['proof_open', { via: 'qr' }], ['proof_verdict', { verdict: 'red' }]]) validos.push({ e, p, ref });
for (const body of validos) await post(body);
const after = await leer(2);
const key = f => JSON.stringify([f.e, f.p, f.ref]);
const sums = rows => new Map(rows.map(f => [key(f), f.n]));
const beforeSums = sums(baseRows), actual = sums(after), expected = new Map(beforeSums);
for (const body of validos) expected.set(key(body), (expected.get(key(body)) ?? 0) + 1);
assert.deepEqual(actual, expected, 'cada POST válido suma exactamente uno, sin reescribir otros eventos');
for (const f of after.filter(f => f.e === 'proof_trust')) assert.deepEqual(Object.keys(f).sort(), ['dia', 'e', 'n', 'p', 'ref']);
const withTime = await fetch(`${base}/v1/conteos?desde=${hoy}T00:00:00Z&hasta=${hoy}`);
assert.equal(withTime.status, 400, 'GET sigue aceptando solo fechas');
console.log('OK confianza: rechazos sin suma, tres respuestas, anteriores y límites, duplicados, regresión de eventos y SQLite local');
