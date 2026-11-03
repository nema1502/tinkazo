#!/usr/bin/env node
// Solo lectura de la API pública; nunca envía opiniones.
import { consultar } from './lib/conteos-confianza.mjs';
const HELP = `Uso: node scripts/conteos-confianza.mjs --desde AAAA-MM-DD --hasta AAAA-MM-DD [--api URL]
Período inclusivo UTC con fechas reales explícitas. Ventanas disjuntas de hasta 92 días.
--api URL  API de lectura (por defecto https://c.tinkazo.app/v1/conteos).
--help     Mostrar esta ayuda sin consultar.
Solo subdivide HTTP 413 con error muchas. Cualquier otro error cancela toda la salida.
El día actual puede tener hasta 5 minutos de retraso por caché.
Los totales son respuestas recibidas en el período, no participantes únicos.
`;
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) process.stdout.write(HELP);
  else {
    const opts = {};
    for (let i = 0; i < args.length; i += 2) {
      const k = args[i];
      if (!['--desde', '--hasta', '--api'].includes(k) || !args[i + 1] || Object.hasOwn(opts, k)) throw Error('Argumentos inválidos; usá --help');
      opts[k] = args[i + 1];
    }
    const out = await consultar(opts['--desde'], opts['--hasta'], opts['--api']);
    process.stdout.write(out);
  }
} catch (e) {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exitCode = 1;
}
