#!/usr/bin/env bash
# Despliega el contrato tinkazo-raffle y registra el despliegue en docs/deployments.md.
#
# Uso:  scripts/deploy.sh <testnet|mainnet> [identidad] [--wasm archivo.wasm]
#                         [--sha256 huella] [--id C…] [--ensayo]
#   identidad: nombre de la identidad de stellar-cli. En testnet, por defecto
#              tinkazo-deployer. En mainnet es obligatoria y no puede ser
#              tinkazo-deployer, que es la de la red de prueba.
#   --wasm:    despliega ese .wasm tal cual, sin compilar. Es el camino del .wasm
#              del release de GitHub (docs/deployments.md, «Verificar la
#              compilación»). En mainnet es obligatorio: un .wasm compilado en
#              otra máquina tiene otro hash y el contrato no quedaría verificado.
#   --sha256:  la huella esperada del .wasm (64 caracteres hexadecimales). Se
#              compara antes de llamar a stellar y, si no coincide, corta con 1.
#              En mainnet es obligatoria.
#   --id:      no despliega: toma ese contrato ya desplegado y sigue desde la
#              lectura, la comparación con la red y el registro. Sirve para
#              retomar un despliegue que se cortó después de «contrato: C…».
#   --ensayo:  valida las opciones, compara la huella, consulta la atestación,
#              la dirección de la identidad y el alias, e imprime la orden de
#              despliegue y la fila que escribiría. No compila, no despliega, no
#              invoca, no baja nada y no escribe nada. Necesita --wasm.
#
# Salidas: 0 bien, 1 algo no coincide o falló (también si quedó la marca de un
# despliegue sin registrar), 2 uso equivocado.
#
# Mientras despliega deja una marca en .despliegue/<red>.en-curso, y la
# borra recién al registrar la fila. Si un despliegue se corta (Ctrl+C, la
# ventana cerrada, el wifi), la marca impide desplegar otro sin --id hasta que
# alguien mire si el contrato se creó. En mainnet, al registrar, imprime también
# la entrada de src/stellar/deployments.json con la huella entera, para pegarla.
#
# Requisitos: stellar-cli 28+, una identidad de la CLI ya creada y fondeada, y
# para compilar (solo testnet sin --wasm) cargo con el target wasm32v1-none. La
# identidad vive en la configuración global de la CLI (~/.config/stellar) o en
# .stellar/ (ignorado por git). Nunca en el repo.
set -euo pipefail
# La red se elige solo por nombre (--network): si en esta consola quedaron estas
# variables de otra red, la CLI podría usarlas en vez de la red configurada.
unset STELLAR_RPC_URL STELLAR_NETWORK_PASSPHRASE STELLAR_NETWORK

USO="uso: $0 <testnet|mainnet> [identidad] [--wasm archivo.wasm] [--sha256 huella] [--id C…] [--ensayo]"
uso() { echo "$USO" >&2; exit 2; }

NETWORK=""
IDENTITY=""
WASM=""
SHA256=""
RESUME_ID=""
ENSAYO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wasm) [ $# -ge 2 ] || uso; WASM="$2"; shift 2 ;;
    --wasm=*) WASM="${1#--wasm=}"; shift ;;
    --sha256) [ $# -ge 2 ] || uso; SHA256="$2"; shift 2 ;;
    --sha256=*) SHA256="${1#--sha256=}"; shift ;;
    --id) [ $# -ge 2 ] || uso; RESUME_ID="$2"; shift 2 ;;
    --id=*) RESUME_ID="${1#--id=}"; shift ;;
    --ensayo) ENSAYO=1; shift ;;
    testnet|mainnet) NETWORK="$1"; shift ;;
    -*) echo "opción desconocida: $1" >&2; uso ;;
    *) IDENTITY="$1"; shift ;;
  esac
done
[ -n "$NETWORK" ] || uso

# La identidad es el nombre de una identidad de la CLI, nunca la llave: el guion la imprime.
if printf '%s' "$IDENTITY" | grep -qE '^S[A-Z2-7]{55}$|[[:space:]]'; then
  echo "La identidad tiene que ser el nombre de una identidad de la CLI (por ejemplo tinkazo-mainnet), no una llave secreta ni una frase." >&2
  exit 2
fi

if [ -z "$IDENTITY" ]; then
  if [ "$NETWORK" = mainnet ]; then
    echo "En mainnet hay que nombrar la identidad de la CLI que despliega, por ejemplo:" >&2
    echo "  $0 mainnet tinkazo-mainnet --wasm … --sha256 …" >&2
    uso
  fi
  IDENTITY="tinkazo-deployer"
elif [ "$NETWORK" = mainnet ] && [ "$IDENTITY" = tinkazo-deployer ]; then
  echo "tinkazo-deployer es la identidad de la red de prueba: en mainnet se despliega con otra." >&2
  uso
fi

if [ -n "$SHA256" ]; then
  printf '%s' "$SHA256" | grep -qE '^[0-9a-fA-F]{64}$' || { echo "--sha256 tiene que ser una huella de 64 caracteres hexadecimales: $SHA256" >&2; exit 2; }
  SHA256="$(printf '%s' "$SHA256" | tr '[:upper:]' '[:lower:]')"
elif [ "$NETWORK" = mainnet ]; then
  echo "En mainnet hay que pasar --sha256 con la huella del .wasm del release." >&2
  uso
fi

es_contrato() { printf '%s' "$1" | grep -qE '^C[A-Z2-7]{55}$'; }
if [ -n "$RESUME_ID" ] && ! es_contrato "$RESUME_ID"; then
  echo "--id tiene que ser la dirección de un contrato (C… de 56 caracteres): $RESUME_ID" >&2
  exit 2
fi

if [ "$ENSAYO" = 1 ] && [ -z "$WASM" ]; then
  echo "El ensayo no compila: pasá el .wasm con --wasm." >&2
  uso
fi

# La ruta del .wasm se resuelve antes de movernos a la raíz del repo.
if [ -n "$WASM" ]; then
  [ -f "$WASM" ] || { echo "no existe $WASM" >&2; exit 2; }
  WASM="$(cd "$(dirname "$WASM")" && pwd)/$(basename "$WASM")"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MARCA="$ROOT/.despliegue/$NETWORK.en-curso"

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

# La huella se compara antes de cualquier orden de stellar: con el archivo
# equivocado no se consulta ni se paga nada.
if [ -n "$SHA256" ]; then
  if [ "$WASM_HASH" != "$SHA256" ]; then
    echo "La huella del .wasm no es la esperada." >&2
    echo "  esperada: $SHA256" >&2
    echo "  archivo:  $WASM_HASH" >&2
    exit 1
  fi
  echo "  la huella coincide con la esperada"
fi

# Qué CLI corre: la versión queda a la vista en el ensayo y en el despliegue.
echo "  CLI: $(stellar --version 2>/dev/null | head -1 || true)"

# La fila la escribe python después de desplegar: si no anda, mejor saberlo antes de pagar.
if ! python -c 'import sys' </dev/null >/dev/null 2>&1; then
  echo "python no anda en esta consola (en Windows puede ser el acceso directo de la Tienda): hace falta para escribir la fila después de desplegar." >&2
  exit 1
fi

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

# Si quedó la marca de un despliegue que no llegó a registrarse, el contrato puede existir
# aunque el alias no lo sepa: no se despliega otro sin mirar.
if [ -z "$RESUME_ID" ] && [ -f "$MARCA" ]; then
  echo "Quedó la marca de un despliegue en $NETWORK que no llegó a registrarse ($MARCA):" >&2
  sed 's/^/  /' "$MARCA" >&2 || true
  echo "El contrato puede existir aunque el alias no lo sepa. Antes de desplegar otro, mirá:" >&2
  echo "  stellar contract alias show tinkazo-$NETWORK --network $NETWORK" >&2
  echo "  y las últimas operaciones de $DEPLOYER en Horizon o en stellar.expert" >&2
  echo "Si aparece un contrato creado recién, se retoma con --id C…. Si comprobaste que no se creó ninguno, borrá la marca: rm '$MARCA'" >&2
  exit 1
fi

# Si el alias ya apunta a un contrato, un despliegue anterior llegó a crearlo:
# otro despliegue dejaría dos. Solo frena si la orden imprime una dirección.
if [ "$NETWORK" = mainnet ] && [ -z "$RESUME_ID" ]; then
  ALIAS_OUT="$(stellar contract alias show "tinkazo-$NETWORK" --network "$NETWORK" 2>/dev/null || true)"
  ALIAS_ID="$(printf '%s\n' "$ALIAS_OUT" | grep -oE '\bC[A-Z2-7]{55}\b' | head -1 || true)"
  if [ -n "$ALIAS_ID" ]; then
    echo "El alias tinkazo-$NETWORK ya apunta al contrato $ALIAS_ID." >&2
    echo "No se despliega otro. Si el registro de ese contrato no quedó hecho, se termina con:" >&2
    echo "  $0 $NETWORK $IDENTITY --wasm '$WASM' --sha256 $WASM_HASH --id $ALIAS_ID" >&2
    exit 1
  fi
fi

DATE="$(date -u +%Y-%m-%d)"
# La huella va entera: la guardia de la CI compara la de src/stellar/deployments.json con esta.
fila() { echo "| $DATE | $NETWORK | \`$1\` | \`$WASM_HASH\` | $COMMIT | \`${DEPLOYER:0:6}…${DEPLOYER: -4}\` | $SIZE bytes |"; }
# La entrada de la red principal para src/stellar/deployments.json, lista para pegar en lugar de
# "mainnet": null. Si ya había un contrato vigente, ese pasa a anteriores (docs/deployments.md).
entrada_json() {
  [ "$NETWORK" = mainnet ] || return 0
  echo "  entrada para src/stellar/deployments.json (en lugar de \"mainnet\": null):"
  cat <<JSON
  "mainnet": {
    "contractId": "$1",
    "deployedAt": "$DATE",
    "wasmSha256": "$WASM_HASH",
    "maxWinners": 300,
    "rpcUrl": "https://mainnet.sorobanrpc.com",
    "networkPassphrase": "Public Global Stellar Network ; September 2015",
    "anteriores": []
  }
JSON
}

if [ "$ENSAYO" = 1 ]; then
  echo "→ ensayo: no se despliega, no se invoca, no se baja nada y no se escribe nada"
  if [ -n "$RESUME_ID" ]; then
    echo "  retomaría el contrato $RESUME_ID con $DEPLOYER"
    FILA_ID="$RESUME_ID"
  else
    echo "  desplegaría en $NETWORK con $DEPLOYER:"
    echo "  stellar contract deploy --wasm '$WASM' --source-account $IDENTITY --network $NETWORK --alias tinkazo-$NETWORK"
    FILA_ID="C…"
  fi
  # El ensayo no le pregunta nada a la red sobre esta cuenta: el saldo lo mira el prevuelo.
  echo "  la cuenta que despliega es $DEPLOYER: tiene que ser la misma que se pasó al prevuelo con --account"
  echo "  después leería next_id, bajaría el .wasm de la red y compararía su huella"
  echo "  fila para docs/deployments.md:"
  echo "  $(fila "$FILA_ID")"
  if es_contrato "$FILA_ID"; then entrada_json "$FILA_ID"; fi
  exit 0
fi

despliegue_fallido() {
  # La CLI guarda el alias recién cuando la transacción se confirmó: si el corte llegó mientras
  # esperaba, el contrato puede existir sin alias. Por eso se miran también las operaciones de la cuenta.
  if [ "$NETWORK" = mainnet ]; then HORIZON_URL="https://horizon.stellar.org"; EXPERT="public"; else HORIZON_URL="https://horizon-testnet.stellar.org"; EXPERT="testnet"; fi
  echo "El despliegue falló (el error está arriba). Antes de volver a correr nada, mirá si el contrato se creó igual." >&2
  echo "El alias puede no haberse guardado aunque el contrato exista, así que mirá las dos cosas:" >&2
  echo "  stellar contract alias show tinkazo-$NETWORK --network $NETWORK" >&2
  echo "  las últimas operaciones de $DEPLOYER: $HORIZON_URL/accounts/$DEPLOYER/operations?order=desc&limit=5" >&2
  echo "  (o https://stellar.expert/explorer/$EXPERT/account/$DEPLOYER)" >&2
  echo "Una transacción que todavía no se confirmó no aparece en las operaciones: si la CLI imprimió el hash de la transacción, buscalo, y esperá unos minutos (lo que dura la transacción) antes de dar por hecho que no entró." >&2
  echo "Si aparece un contrato creado recién, se retoma con --id C…; volver a correr sin --id crearía otro." >&2
  echo "Si comprobaste que no se creó ninguno, borrá la marca para poder desplegar: rm '$MARCA'" >&2
  exit 1
}

if [ -n "$RESUME_ID" ]; then
  CONTRACT_ID="$RESUME_ID"
  echo "→ retomando el contrato $CONTRACT_ID con $DEPLOYER"
else
  echo "→ desplegando en $NETWORK con $DEPLOYER"
  mkdir -p "$(dirname "$MARCA")"
  printf 'desde %s, %s con %s
' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NETWORK" "$DEPLOYER" > "$MARCA"
  # Un corte mientras la CLI espera la confirmación (Ctrl+C, la ventana cerrada) también deja la pista.
  trap despliegue_fallido INT TERM HUP
  # El error de la CLI sale por la pantalla; por la salida estándar llega la dirección.
  if ! CONTRACT_ID="$(stellar contract deploy \
    --wasm "$WASM" \
    --source-account "$IDENTITY" \
    --network "$NETWORK" \
    --alias "tinkazo-$NETWORK" | tail -1)"; then
    despliegue_fallido
  fi
  trap - INT TERM HUP
  if ! es_contrato "$CONTRACT_ID"; then
    [ -n "${CONTRACT_ID:-}" ] && echo "La CLI devolvió: $CONTRACT_ID" >&2
    despliegue_fallido
  fi
fi
echo "  contrato: $CONTRACT_ID"

# Desde acá el contrato existe: si algo falla, se retoma con --id y no se despliega otro.
SHA_RETOMAR="${SHA256:-$WASM_HASH}"
retomar() {
  echo "" >&2
  echo "Algo falló después de desplegar. El contrato $CONTRACT_ID ya existe: NO vuelvas a correr el guion sin --id." >&2
  echo "Para retomar desde la comprobación y el registro:" >&2
  echo "  $0 $NETWORK $IDENTITY --wasm '$WASM' --sha256 $SHA_RETOMAR --id $CONTRACT_ID" >&2
}
trap retomar ERR

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

ROW="$(fila "$CONTRACT_ID")"

# Si la tabla ya tiene una fila con este contrato (un registro que se terminó y se volvió a correr
# con --id), no se escribe otra.
if grep -qE "^\| [^|]+ \| $NETWORK \| \`$CONTRACT_ID\` \|" docs/deployments.md; then
  trap - ERR
  rm -f "$MARCA"
  echo "→ ya estaba registrado en docs/deployments.md: no se escribe otra fila."
  entrada_json "$CONTRACT_ID"
  echo "$CONTRACT_ID"
  exit 0
fi

# Reemplaza la fila "pendiente" de esa red o agrega una nueva al final de la tabla de despliegues.
python - "$ROW" "$NETWORK" <<'EOF'
import io, sys
row, net = sys.argv[1], sys.argv[2]
p = "docs/deployments.md"
lines = io.open(p, encoding="utf-8").read().split("\n")
out, done = [], False
for l in lines:
    # La fila "pendiente" de la tabla empieza con "· " (antes con "—"): se acepta cualquiera de las dos.
    if not done and (l.startswith("| — | " + net + " |") or l.startswith("| · | " + net + " |")):
        out.append(row); done = True
    else:
        out.append(l)
if not done:
    # insertar tras la última fila de la primera tabla
    first = next(i for i, l in enumerate(out) if l.startswith("| Fecha |"))
    j = first
    while j < len(out) and out[j].startswith("|"): j += 1
    out.insert(j, row)
io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out))
EOF

trap - ERR
rm -f "$MARCA"
echo "→ registrado en docs/deployments.md. Recordá actualizar src/stellar/deployments.json en el mismo commit."
entrada_json "$CONTRACT_ID"
echo "$CONTRACT_ID"
