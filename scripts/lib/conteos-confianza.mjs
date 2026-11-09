const DIA = 86_400_000;
const fecha = ms => new Date(ms).toISOString().slice(0, 10);
function dia(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error('Se requieren fechas reales explícitas AAAA-MM-DD');
  const n = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(n) || fecha(n) !== s) throw Error('Fecha UTC inválida');
  return n;
}
const objeto = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function validar(filas, desde, hasta) {
  if (!Array.isArray(filas) || filas.length > 5000) throw Error('Respuesta de API inválida');
  for (const f of filas) {
    if (!objeto(f) || Object.keys(f).some(k => !['dia', 'e', 'p', 'ref', 'n'].includes(k)) ||
        typeof f.e !== 'string' || !objeto(f.p) || !Number.isSafeInteger(f.n) || f.n < 1 ||
        dia(f.dia) < desde || dia(f.dia) > hasta) throw Error('Fila de API inválida');
    if (f.e !== 'proof_trust') continue;
    const r = f.ref;
    if (Object.keys(f.p).length !== 1 || !['yes', 'no', 'unsure'].includes(f.p.answer) ||
        !objeto(r) || Object.keys(r).length !== 3 || !['mainnet', 'testnet'].includes(r.net) ||
        !/^C[A-Z2-7]{55}$/.test(r.contract) || typeof r.id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(r.id) ||
        BigInt(r.id) > 18446744073709551615n) throw Error('Respuesta de confianza inválida');
  }
  return filas;
}
/** Construye toda la salida en memoria: si falla un tramo no publica totales parciales. */
export async function consultar(desde, hasta, api = 'https://c.tinkazo.app/v1/conteos') {
  const d = dia(desde), h = dia(hasta);
  if (d > h) throw Error('Período UTC invertido');
  const endpoint = new URL(api);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('URL de API inválida');
  const filas = [];
  async function tramo(a, b) {
    const url = new URL(endpoint);
    url.searchParams.set('desde', fecha(a)); url.searchParams.set('hasta', fecha(b));
    const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) });
    const body = await r.json();
    if (r.status === 413 && body?.error === 'muchas') {
      if (a === b) throw Error(`Demasiadas filas en ${fecha(a)}; no se puede subdividir por hora`);
      const mitad = a + Math.floor((b - a) / DIA / 2) * DIA;
      await tramo(a, mitad); await tramo(mitad + DIA, b); return;
    }
    if (r.status !== 200) throw Error(`HTTP ${r.status}; consulta cancelada`);
    filas.push(...validar(body, a, b));
  }
  for (let a = d; a <= h; a += 92 * DIA) await tramo(a, Math.min(a + 91 * DIA, h));
  const totales = new Map();
  for (const f of filas.filter(f => f.e === 'proof_trust')) {
    const key = `${f.ref.net}\t${f.ref.contract}\t${f.ref.id}`;
    const t = totales.get(key) ?? { yes: 0, no: 0, unsure: 0, total: 0 };
    t[f.p.answer] += f.n; t.total += f.n;
    if (!Number.isSafeInteger(t.total)) throw Error('Total fuera de rango seguro');
    totales.set(key, t);
  }
  return `Respuestas recibidas del ${desde} al ${hasta}, ambos días incluidos\n` +
    'red\tcontrato\tnúmero\tSí\tNo\tNo sé\trecibidas\n' +
    [...totales].sort(([a], [b]) => a.localeCompare(b)).map(([k, t]) => `${k}\t${t.yes}\t${t.no}\t${t.unsure}\t${t.total}\n`).join('') +
    'El día actual puede tener hasta 5 minutos de retraso por caché. Cobertura: solo el período solicitado.\n';
}
