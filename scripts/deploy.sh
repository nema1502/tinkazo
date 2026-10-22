#!/usr/bin/env bash
# Despliega el contrato tinkazo-raffle y registra el despliegue en docs/deployments.md.
#
# Uso:  scripts/deploy.sh <testnet|mainnet> [identidad] [--wasm archivo.wasm]
#   identidad: nombre de la identidad de stellar-cli (por defecto tinkazo-deployer).
#   --wasm:    despliega ese .wasm tal cual, sin compilar. Es el camino del .wasm
#              del release de GitHub (docs/deployments.md, «Verificar la
#              compilación»). En mainnet es obligatorio: un .wasm compilado en
#              otra máquina tiene otro hash y el contrato no quedaría verificado.
#
# Requisitos: stellar-cli 28+, una identidad de la CLI ya creada y fondeada, y
# para compilar (solo testnet sin --wasm) cargo con el target wasm32v1-none. La
# identidad vive en la configuración global de la CLI (~/.config/stellar) o en
# .stellar/ (ignorado por git). Nunca en el repo.
set -euo pipefail

uso() { echo "uso: $0 <testnet|mainnet> [identidad] [--wasm archivo.wasm]" >&2; exit 2; }

NETWORK=""
IDENTITY="tinkazo-deployer"
WASM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --wasm) [ $# -ge 2 ] || uso; WASM="$2"; shift 2 ;;
    --wasm=*) WASM="${1#--wasm=}"; shift ;;
    testnet|mainnet) NETWORK="$1"; shift ;;
    -*) echo "opción desconocida: $1" >&2; uso ;;
    *) IDENTITY="$1"; shift ;;
  esac
done
[ -n "$NETWORK" ] || uso

# La ruta del .wasm se resuelve antes de movernos a la raíz del repo.
if [ -n "$WASM" ]; then
  [ -f "$WASM" ] || { echo "no existe $WASM" >&2; exit 2; }
  WASM="$(cd "$(dirname "$WASM")" && pwd)/$(basename "$WASM")"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "$WASM" ]; then
  if [ "$NETWORK" = mainnet ]; then
    echo "En mainnet se despliega el .wasm del release de GitHub, no uno compilado acá:" >&2
    echo "otro compilador da otro hash y el contrato no quedaría verificado." >&2
    echo "Bajalo con: gh release download <tag del release> --pattern '*.wasm'" >&2
    uso
  fi
  echo "→ compilando"
  stellar contract build >/dev/null
  WASM="target/wasm32v1-none/release/tinkazo_raffle.wasm"
fi

WASM_HASH="$(sha256sum "$WASM" | cut -d' ' -f1)"
SIZE="$(wc -c < "$WASM")"
echo "  wasm: $SIZE bytes, sha256 $WASM_HASH"

# El commit que va a la tabla es el que compiló el .wasm. Si el .wasm trae la
# atestación de GitHub (SEP-55), sale de ahí; si no, es el commit de acá.
COMMIT="$(git rev-parse --short HEAD)"
if INFO="$(stellar contract info build --wasm "$WASM" 2>&1)"; then
  echo "→ atestación de GitHub encontrada (SEP-55)"
  BUILD_COMMIT="$(printf '%s\n' "$INFO" | grep -oE '\b[0-9a-f]{40}\b' | head -1 || true)"
  [ -n "$BUILD_COMMIT" ] && COMMIT="${BUILD_COMMIT:0:7}"
elif [ "$NETWORK" = mainnet ]; then
  printf '%s\n' "$INFO" >&2
  echo "Este .wasm no tiene una atestación de GitHub que lo una al repositorio: no se despliega en mainnet." >&2
  exit 1
fi

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

echo "→ comprobando que en la red está el mismo .wasm"
FETCHED="$(mktemp)"
stellar contract fetch --id "$CONTRACT_ID" --network "$NETWORK" --out-file "$FETCHED"
FETCHED_HASH="$(sha256sum "$FETCHED" | cut -d' ' -f1)"
rm -f "$FETCHED"
if [ "$FETCHED_HASH" != "$WASM_HASH" ]; then
  echo "La red tiene otro .wasm ($FETCHED_HASH) que el desplegado ($WASM_HASH)." >&2
  exit 1
fi

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
