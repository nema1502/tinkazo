// Prepara, SOLO EN TESTNET, la cuenta patrocinadora del portero con su llave acotada:
//
//   - la cuenta patrocinadora P, fondeada por el grifo de testnet;
//   - la llave fría F con peso 2 (la que mueve el dinero) y la llave del Worker W con peso 1;
//   - umbrales bajo 1, medio 2, alto 2, y la llave propia de P con peso 0.
//
// Un fee-bump pide el umbral bajo (alcanza con W). Un pago pide el medio y cambiar las llaves,
// el alto: W sola no puede sacar el dinero, solo quemarlo en comisiones hasta lo cargado.
//
// También crea S, una cuenta que hace de "billetera de fondos de Pollar" de prueba: las cuentas
// de prueba con 0 XLM las abre S, así el portero las reconoce como abiertas por nuestra app.
//
// Escribe, fuera de lo versionado:
//   .dev.vars     (las variables y el secreto del Worker para `wrangler dev`)
//   .prueba.json  (las llaves que necesita probar.mjs)
//   <privado>     (un resumen para guardar fuera del repositorio, solo si se pasa --privado)
//
// Uso:  node preparar-testnet.mjs [--rehacer] [--privado <ruta fuera del repositorio.md>]
// Las llaves de acá son de prueba: nunca se usan en otra red ni se reusan.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { FRASE, HORIZON, conGrifo, enviarYEsperar, servidor } from "./testnet.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rehacer = args.includes("--rehacer");
const privado = args.includes("--privado") ? args[args.indexOf("--privado") + 1] : null;
const dev = path.join(aqui, ".dev.vars");
const prueba = path.join(aqui, ".prueba.json");

if (fs.existsSync(dev) && !rehacer) {
  console.log(".dev.vars ya existe: no se rehace sin --rehacer (las llaves de testnet siguen valiendo).");
  process.exit(0);
}

const P = Keypair.random(); // la cuenta patrocinadora; su llave propia se anula al terminar
const F = Keypair.random(); // llave fría, peso 2
const W = Keypair.random(); // llave del Worker, peso 1
const S = Keypair.random(); // billetera de fondos de Pollar, de mentira

console.log("pidiendo fondos al grifo de testnet…");
await conGrifo(P);
await conGrifo(S);
await conGrifo(F);

const cuenta = await servidor.getAccount(P.publicKey());
const tx = new TransactionBuilder(cuenta, { fee: "1000", networkPassphrase: FRASE })
  .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: F.publicKey(), weight: 2 } }))
  .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: W.publicKey(), weight: 1 } }))
  .addOperation(Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 2 }))
  .setTimeout(120)
  .build();
tx.sign(P);
await enviarYEsperar(tx);

// Se comprueba lo que quedó escrito en la cadena, no lo que se mandó.
const leida = await (await fetch(`${HORIZON}/accounts/${P.publicKey()}`)).json();
const pesos = Object.fromEntries(leida.signers.map((f) => [f.key, f.weight]));
const t = leida.thresholds;
console.log("pesos en la cadena:", JSON.stringify(pesos), "umbrales:", JSON.stringify(t));
if (pesos[P.publicKey()] !== 0 || pesos[F.publicKey()] !== 2 || pesos[W.publicKey()] !== 1 || t.low_threshold !== 1 || t.med_threshold !== 2 || t.high_threshold !== 2) {
  throw new Error("la cuenta patrocinadora no quedó como se esperaba");
}

const adminToken = randomBytes(24).toString("hex");
fs.writeFileSync(
  dev,
  [
    "# SOLO TESTNET. Lo lee `wrangler dev`. No se versiona (está en .gitignore). Nunca usar estas llaves en otra red.",
    `CLAVE_PATROCINADOR=${W.secret()}`,
    `CUENTA_PATROCINADORA=${P.publicKey()}`,
    `ADMIN_TOKEN=${adminToken}`,
    `PATROCINADORES_APP=GAYWGZ4P5NHJU2UL7TGWSP6ZF5BYEBZ4WP7TZDBDZ3FXUN5DHGAMDGKU,${S.publicKey()}`,
    "",
  ].join("\n"),
);
fs.writeFileSync(prueba, JSON.stringify({ aviso: "SOLO TESTNET", patrocinadora: P.publicKey(), fria: F.secret(), worker: W.secret(), pollarDePrueba: S.secret(), adminToken }, null, 2));

const md = `# El portero en testnet: cuentas y llaves de prueba

**SOLO TESTNET, nunca reusar.** Creadas por \`workers/patrocinio/preparar-testnet.mjs\`. Estas llaves no valen nada y no se usan en ninguna otra red.

| | Cuenta | Llave secreta | Qué es |
|---|---|---|---|
| P | \`${P.publicKey()}\` | \`${P.secret()}\` | La cuenta patrocinadora. Su llave propia quedó con peso 0: no firma nada. |
| F | \`${F.publicKey()}\` | \`${F.secret()}\` | Llave fría, peso 2 sobre P. Mueve el dinero. |
| W | \`${W.publicKey()}\` | \`${W.secret()}\` | Llave del Worker, peso 1 sobre P. Solo puede firmar fee-bump. Va como secreto de \`wrangler dev\` (\`.dev.vars\`). |
| S | \`${S.publicKey()}\` | \`${S.secret()}\` | "Billetera de fondos de Pollar" de prueba: abre cuentas con 0 XLM y las patrocina. |

Umbrales de P: bajo 1, medio 2, alto 2.
\`ADMIN_TOKEN\` del Worker de prueba: \`${adminToken}\`

Creada el ${new Date().toISOString().slice(0, 10)}.
`;
if (privado) {
  try {
    fs.mkdirSync(path.dirname(privado), { recursive: true });
    fs.writeFileSync(privado, md);
    console.log("resumen guardado en", privado);
  } catch (e) {
    console.log("no se pudo guardar el resumen privado:", String(e));
  }
}
console.log("listo. P =", P.publicKey(), " W =", W.publicKey(), " F =", F.publicKey(), " S =", S.publicKey());
