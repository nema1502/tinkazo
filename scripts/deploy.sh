#!/usr/bin/env bash
# Despliega el contrato tinkazo-raffle y registra el despliegue en docs/deployments.md.
#
# Uso:  scripts/deploy.sh <testnet|mainnet> [identidad]
#   identidad: nombre de la identidad de stellar-cli (por defecto tinkazo-deployer).
#
# Requisitos: cargo con el target wasm32v1-none, stellar-cli 28+, una identidad
# de la CLI ya creada y fondeada. La identidad vive en la configuración global de
# la CLI (~/.config/stellar) o en .stellar/ (ignorado por git). Nunca en el repo.
set -euo pipefail

NETWORK="${1:-}"
IDENTITY="${2:-tinkazo-deployer}"
case "$NETWORK" in
  testnet|mainnet) ;;
  *) echo "uso: $0 <testnet|mainnet> [identidad]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WASM="target/wasm32v1-none/release/tinkazo_raffle.wasm"

echo "→ compilando"
stellar contract build >/dev/null
WASM_HASH="$(sha256sum "$WASM" | cut -d' ' -f1)"
SIZE="$(wc -c < "$WASM")"
echo "  wasm: $SIZE bytes, sha256 $WASM_HASH"

DEPLOYER="$(stellar keys address "$IDENTITY")"
echo "→ desplegando en $NETWORK con $DEPLOYER"
CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$IDENTITY" \
  --network "$NETWORK" \
  --alias "tinkazo-$NETWORK" 2>/dev/null | tail -1)"
echo "  contrato: $CONTRACT_ID"

echo "→ verificando lectura"
stellar contract invoke --id "$CONTRACT_ID" --source-account "$IDENTITY" --network "$NETWORK" --send=no -- next_id >/dev/null

COMMIT="$(git rev-parse --short HEAD)"
DATE="$(date -u +%Y-%m-%d)"
ROW="| $DATE | $NETWORK | \`$CONTRACT_ID\` | \`${WASM_HASH:0:16}…\` | $COMMIT | \`${DEPLOYER:0:6}…${DEPLOYER: -4}\` | $SIZE bytes |"

# Reemplaza la fila "pendiente" de esa red o agrega una nueva al final de la tabla de despliegues.
python - "$ROW" "$NETWORK" <<'EOF'
import io, sys
row, net = sys.argv[1], sys.argv[2]
p = "docs/deployments.md"
lines = io.open(p, encoding="utf-8").read().split("\n")
out, done = [], False
for l in lines:
    if not done and l.startswith("| — | " + net + " |"):
        out.append(row); done = True
    else:
        out.append(l)
if not done:
    # insertar tras la última fila de la primera tabla
    idx = next(i for i, l in enumerate(out) if l.startswith("## Costos"))
    j = idx
    while j > 0 and not out[j - 1].startswith("|"): j -= 1
    out.insert(j, row)
io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out))
EOF

echo "→ registrado en docs/deployments.md. Recordá actualizar src/stellar/deployments.json en el mismo commit."
echo "$CONTRACT_ID"
