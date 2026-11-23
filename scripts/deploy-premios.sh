#!/usr/bin/env bash
# Despliega el contrato tinkazo-premios y registra el despliegue en docs/deployments.md.
#
# Uso:
#   scripts/deploy-premios.sh <testnet|mainnet> --wasm archivo.wasm \
#     --raffle C… --treasury G… --fee-bps N --tokens C…,C… --allow-in-kind true|false \
#     [--identity nombre] [--sha256 hash] [--dry-run]
#
# El contrato custodia fondos, no tiene administrador ni actualización, y lo que se le
# pasa al constructor queda fijo para siempre: un error obliga a desplegar otra instancia.
# Por eso el constructor no tiene valores por defecto y todo se valida antes de tocar la red.
#
#   - Los cinco argumentos del constructor son obligatorios y explícitos. En especial
#     --allow-in-kind: la CLI de Stellar toma `--allow_in_kind` SIN valor como verdadero, y
#     ese descuido habilitaría el modo especie. Acá hay que escribir true o false, y a la
#     CLI siempre se le pasa el valor explícito.
#   - Las direcciones se comprueban con su dígito de control (con la CLI, sin red), la
#     comisión va de 0 a 1000 puntos básicos y los tokens son entre 1 y 8, sin repetidos.
#   - El .wasm tiene que ser el de este contrato: se lee su interfaz (sin red) y el
#     constructor tiene que tener exactamente esos cinco argumentos, en ese orden.
#   - La red se comprueba por la passphrase que tiene configurada la CLI: «testnet» y
#     «mainnet» tienen que ser lo que dicen, porque las reglas de abajo dependen del nombre.
#   - En mainnet, además:
#       * el .wasm es el del release de GitHub, tal cual. Se verifica su atestación (SEP-55)
#         contra este repositorio y contra .github/workflows/release-premios.yml; uno
#         compilado en otra máquina tiene otro hash y el contrato no quedaría verificado;
#       * los tokens son del conjunto conocido (USDC con su emisor y XLM nativo), cuyas
#         direcciones se recalculan con la CLI, sin red. Para aceptar otro hay que editar
#         este guion, a propósito;
#       * --allow-in-kind tiene que ser false (decisión de esta versión);
#       * --identity es obligatoria y no puede ser tinkazo-deployer, que es la identidad de
#         la red de prueba (la misma regla que scripts/deploy.sh);
#       * hay que repetir el sha256 del .wasm con --sha256, para no desplegar sin haberlo
#         mirado. El --dry-run imprime el que corresponde.
#
# --dry-run hace todas esas comprobaciones, calcula el sha256 del .wasm e imprime el
# comando exacto que correría, sin subir nada. (No se usa `deploy -- --help` para ver los
# argumentos: sube el .wasm a la red y cuesta XLM. Se ven con
# `stellar contract info interface --wasm archivo.wasm`.)
#
# Sin --dry-run, antes de subir comprueba que el contrato del sorteo responda (next_id); después
# despliega, lee get_config y compara los cinco valores con lo pedido, baja el .wasm de la red y
# compara su hash, y recién entonces registra el despliegue en docs/deployments.md. Si algo no
# coincide sale con error y no registra nada.
#
# Requisitos: stellar-cli 28 o más, una identidad de la CLI ya creada y fondeada (vive en
# ~/.config/stellar o en .stellar/, nunca en el repo), y en mainnet la CLI de GitHub (gh)
# con la sesión iniciada. La red «mainnet» de la CLI tiene que estar configurada:
#   stellar network add mainnet --rpc-url https://mainnet.sorobanrpc.com \
#     --network-passphrase "Public Global Stellar Network ; September 2015"
#
# Es un guion de bash (Git Bash en Windows, Linux o macOS). Los tokens van separados por
# comas, sin JSON: el guion arma el arreglo JSON que pide la CLI. Desde PowerShell, la
# lista va entre comillas simples (--tokens 'C…,C…'); sin ellas PowerShell la parte en dos.
# Si se escribe a mano el comando de la CLI en PowerShell 5.1, las comillas dobles de
# adentro del JSON se pierden: hay que escaparlas (--tokens '[\"C…\",\"C…\"]') o pasar un
# archivo (--tokens-file-path tokens.json).
set -euo pipefail
export LC_ALL=C

# ---------------------------------------------------------------- lo que este guion sabe
REPO_OFICIAL="nema1502/tinkazo"
FIRMANTE_DEL_BUILD="stellar-expert/soroban-build-workflow"
WORKFLOW_DE_RELEASE=".github/workflows/release-premios.yml"
REF_DE_RELEASE="refs/tags/premios-v"
PASSPHRASE_MAINNET="Public Global Stellar Network ; September 2015"
PASSPHRASE_TESTNET="Test SDF Network ; September 2015"

# Tokens que acepta una instancia de mainnet. Se recalculan con `stellar contract id asset`.
USDC_EMISOR="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
USDC_MAINNET="CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
XLM_MAINNET="CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"

# Decisión de esta versión: el modo especie queda apagado en mainnet. Cambiarlo es una
# decisión, no un descuido: se edita acá, a propósito.
MAINNET_ADMITE_ESPECIE=false

# Los límites del constructor (contracts/premios/src/lib.rs: MAX_FEE_BPS y MAX_TOKENS).
MAX_FEE_BPS=1000
MAX_TOKENS=8

# La firma del constructor que este guion sabe pasar, tal como la imprime
# `stellar contract info interface`, sin espacios ni saltos de línea.
CONSTRUCTOR_ESPERADO='fn__constructor(env:soroban_sdk::Env,raffle:soroban_sdk::Address,treasury:soroban_sdk::Address,fee_bps:u32,tokens:soroban_sdk::Vec<soroban_sdk::Address>,allow_in_kind:bool)'

# ---------------------------------------------------------------- salida
if { [ -t 2 ] || [ -n "${CLICOLOR_FORCE:-}" ]; } && [ -z "${NO_COLOR:-}" ]; then
  ROJO=$'\033[1;31m'; VERDE=$'\033[32m'; AMARILLO=$'\033[33m'; FIN=$'\033[0m'
else
  ROJO=""; VERDE=""; AMARILLO=""; FIN=""
fi
paso()   { printf '→ %s\n' "$*"; }
ok()     { printf '  %sok%s %s\n' "$VERDE" "$FIN" "$*"; }
nota()   { printf '  %s\n' "$*"; }
aviso()  { printf '%s%s%s\n' "$AMARILLO" "$*" "$FIN" >&2; }
error()  { printf '%s%s%s\n' "$ROJO" "$*" "$FIN" >&2; }
# fallar "motivo" ["línea de ayuda" ...]: sale con 1.
fallar() { local l; error "ERROR: $1"; shift; for l in "$@"; do error "  $l"; done; exit 1; }

USO="uso: $0 <testnet|mainnet> --wasm archivo.wasm --raffle C… --treasury G… --fee-bps N
          --tokens C…,C… --allow-in-kind true|false [--identity nombre] [--sha256 hash] [--dry-run]"
# uso_error "motivo" ["línea de ayuda" ...]: error de uso, sale con 2.
uso_error() { local l; error "ERROR: $1"; shift; for l in "$@"; do error "  $l"; done; error "$USO"; exit 2; }
explicacion_especie() {
  error "  --allow-in-kind es obligatorio y lleva un valor explícito: true o false."
  error "  La CLI de Stellar toma --allow_in_kind sin valor como verdadero, y ese descuido habilitaría el"
  error "  modo especie en un contrato que no se puede corregir. Por eso acá no hay valor por defecto."
}
explicacion_wasm() {
  error "  En mainnet se despliega el .wasm del release de GitHub, tal cual, no uno compilado acá:"
  error "  otro compilador da otro hash y el contrato no quedaría verificado. Bajalo con:"
  error "    gh release download <tag del release> --repo $REPO_OFICIAL --pattern '*.wasm'"
}

# ---------------------------------------------------------------- argumentos
NETWORK=""; WASM=""; RAFFLE=""; TREASURY=""; FEE_BPS=""; TOKENS=""; ALLOW=""
IDENTITY="tinkazo-deployer"; SHA_PEDIDO=""; DRY_RUN=0
DADOS=" "

falta_valor() {
  local detalle="a $1 le falta el valor${2:+ (llegó «$2»)}"
  if [ "$1" = "--allow-in-kind" ]; then
    error "ERROR: $detalle"; explicacion_especie; error "$USO"; exit 2
  fi
  uso_error "$detalle"
}

asignar() {  # asignar <opción> <valor>
  local op="$1" valor="$2"
  case "$DADOS" in *" $op "*) uso_error "$op está repetida" ;; esac
  case "$valor" in ''|--*) falta_valor "$op" "$valor" ;; esac
  DADOS="$DADOS$op "
  case "$op" in
    --wasm) WASM="$valor" ;;
    --raffle) RAFFLE="$valor" ;;
    --treasury) TREASURY="$valor" ;;
    --fee-bps) FEE_BPS="$valor" ;;
    --tokens) TOKENS="$valor" ;;
    --allow-in-kind) ALLOW="$valor" ;;
    --identity) IDENTITY="$valor" ;;
    --sha256) SHA_PEDIDO="$valor" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    testnet|mainnet)
      [ -z "$NETWORK" ] || uso_error "la red está repetida"
      NETWORK="$1"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) printf '%s\n' "$USO"; sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    --wasm|--raffle|--treasury|--fee-bps|--tokens|--allow-in-kind|--identity|--sha256)
      [ $# -ge 2 ] || falta_valor "$1"
      asignar "$1" "$2"; shift 2 ;;
    --wasm=*|--raffle=*|--treasury=*|--fee-bps=*|--tokens=*|--allow-in-kind=*|--identity=*|--sha256=*)
      asignar "${1%%=*}" "${1#*=}"; shift ;;
    --fee_bps*|--allow_in_kind*)
      uso_error "opción desconocida: $1" "Acá las opciones llevan guion medio: --fee-bps y --allow-in-kind." ;;
    *) uso_error "argumento desconocido: $1" ;;
  esac
done

[ -n "$NETWORK" ] || uso_error "falta la red: testnet o mainnet"

faltan=()
[ -n "$WASM" ] || faltan+=("--wasm")
[ -n "$RAFFLE" ] || faltan+=("--raffle")
[ -n "$TREASURY" ] || faltan+=("--treasury")
[ -n "$FEE_BPS" ] || faltan+=("--fee-bps")
[ -n "$TOKENS" ] || faltan+=("--tokens")
[ -n "$ALLOW" ] || faltan+=("--allow-in-kind")
if [ ${#faltan[@]} -gt 0 ]; then
  error "ERROR: faltan argumentos obligatorios: ${faltan[*]}"
  case " ${faltan[*]} " in *" --allow-in-kind "*) explicacion_especie ;; esac
  case " ${faltan[*]} " in *" --wasm "*) if [ "$NETWORK" = mainnet ]; then explicacion_wasm; fi ;; esac
  error "$USO"
  exit 2
fi

# ---------------------------------------------------------------- formatos (sin tocar nada)
es_cuenta()   { [[ "$1" =~ ^G[A-Z2-7]{55}$ ]]; }
es_contrato() { [[ "$1" =~ ^C[A-Z2-7]{55}$ ]]; }

es_contrato "$RAFFLE" || uso_error "--raffle no es una dirección de contrato: $RAFFLE" "Son 56 caracteres y empieza con C."
es_cuenta "$TREASURY" || uso_error "--treasury no es una dirección de cuenta: $TREASURY" "Son 56 caracteres y empieza con G."

[[ "$FEE_BPS" =~ ^(0|[1-9][0-9]{0,3})$ ]] \
  || uso_error "--fee-bps tiene que ser un entero entre 0 y $MAX_FEE_BPS, sin signo ni ceros a la izquierda: $FEE_BPS"
[ "$FEE_BPS" -le "$MAX_FEE_BPS" ] \
  || uso_error "--fee-bps $FEE_BPS pasa el máximo de $MAX_FEE_BPS puntos básicos (10 %)" "El constructor lo rechaza con el error 19 (BadConfig)."

[[ "$TOKENS" =~ ^C[A-Z2-7]{55}(,C[A-Z2-7]{55})*$ ]] \
  || uso_error "--tokens tiene que ser una lista de direcciones de contrato C… separadas por comas, sin espacios" \
       "En PowerShell va entre comillas simples: --tokens 'C…,C…'." "Recibido: $TOKENS"
IFS=',' read -r -a LISTA_TOKENS <<< "$TOKENS"
[ ${#LISTA_TOKENS[@]} -le "$MAX_TOKENS" ] \
  || uso_error "--tokens tiene ${#LISTA_TOKENS[@]} direcciones y el máximo es $MAX_TOKENS"
for ((i = 0; i < ${#LISTA_TOKENS[@]}; i++)); do
  for ((j = i + 1; j < ${#LISTA_TOKENS[@]}; j++)); do
    [ "${LISTA_TOKENS[i]}" != "${LISTA_TOKENS[j]}" ] \
      || uso_error "--tokens repite una dirección: ${LISTA_TOKENS[i]}" "El constructor rechaza los repetidos con el error 19 (BadConfig)."
  done
done

case "$ALLOW" in
  true|false) ;;
  *) error "ERROR: --allow-in-kind vale «$ALLOW» y solo puede ser true o false"; explicacion_especie; error "$USO"; exit 2 ;;
esac

# --identity es el NOMBRE de una identidad de la CLI. La CLI acepta también una clave secreta en ese
# lugar: si alguien la pega (o una frase semilla), se rechaza sin repetirla, porque los mensajes de
# error terminan en pantallas y en logs. Las llaves viven en la CLI y nunca van en la línea de comandos.
if [[ "$IDENTITY" =~ ^S[A-Z2-7]{55}$ ]] || ! [[ "$IDENTITY" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
  uso_error "--identity es el nombre de una identidad de la CLI (se ven con \`stellar keys ls\`), no una clave ni una frase." \
    "Se rechazó sin mostrarlo."
fi

if [ -n "$SHA_PEDIDO" ]; then
  SHA_PEDIDO="$(printf '%s' "$SHA_PEDIDO" | tr 'A-F' 'a-f')"
  [[ "$SHA_PEDIDO" =~ ^[0-9a-f]{12,64}$ ]] \
    || uso_error "--sha256 son entre 12 y 64 dígitos hexadecimales (el sha256 del .wasm o su comienzo)"
fi

# ---------------------------------------------------------------- reglas de mainnet
if [ "$NETWORK" = mainnet ]; then
  case "$DADOS" in
    *" --identity "*) ;;
    *) uso_error "en mainnet --identity es obligatoria." \
         "Sin ella se usaría tinkazo-deployer, que es la identidad de la red de prueba." ;;
  esac
  [ "$IDENTITY" != tinkazo-deployer ] \
    || uso_error "tinkazo-deployer es la identidad de la red de prueba: en mainnet se despliega con otra."
  if [ "$ALLOW" = true ] && [ "$MAINNET_ADMITE_ESPECIE" != true ]; then
    fallar "en mainnet esta versión se despliega con --allow-in-kind false." \
      "El modo especie queda apagado para siempre en la instancia de mainnet: es una decisión de esta versión." \
      "Habilitarlo es una decisión, no un descuido: se hace editando MAINNET_ADMITE_ESPECIE en este guion, a propósito."
  fi
  for t in "${LISTA_TOKENS[@]}"; do
    if [ "$t" != "$USDC_MAINNET" ] && [ "$t" != "$XLM_MAINNET" ]; then
      fallar "el token $t no está en el conjunto conocido de mainnet." \
        "En mainnet solo se aceptan USDC (emisor $USDC_EMISOR) = $USDC_MAINNET" \
        "y XLM nativo = $XLM_MAINNET." \
        "Los tokens quedan fijos para siempre. Aceptar otro es una decisión: se edita la lista en este guion, a propósito," \
        "y se comprueba su dirección con \`stellar contract id asset\` antes de agregarla."
    fi
  done
fi

# ---------------------------------------------------------------- herramientas y .wasm
# Estas variables podrían llevar el comando a otra red que la que se nombró. Se ignoran:
# la red es siempre la de --network, la que se comprobó por su passphrase.
for v in STELLAR_NETWORK STELLAR_RPC_URL STELLAR_NETWORK_PASSPHRASE; do
  if [ -n "${!v:-}" ]; then
    aviso "Aviso: $v está definida en el entorno. Se ignora: este guion usa la red «$NETWORK» de la CLI."
    unset "$v"
  fi
done

command -v stellar >/dev/null 2>&1 || fallar "no encuentro la CLI de Stellar (stellar) en el PATH."
command -v awk >/dev/null 2>&1 || fallar "no encuentro awk."

sha256_de() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPORALES=()
limpiar() { local f; for f in ${TEMPORALES[@]+"${TEMPORALES[@]}"}; do rm -f "$f"; done; }
trap limpiar EXIT

WASM="${WASM//\\//}"
[ -f "$WASM" ] || fallar "no existe el archivo $WASM"
[ -s "$WASM" ] || fallar "$WASM está vacío"
[ "$(od -An -tx1 -N4 "$WASM" | tr -d ' \n')" = "0061736d" ] || fallar "$WASM no es un .wasm (no empieza con la firma 0061736d)"
WASM="$(cd "$(dirname "$WASM")" && pwd)/$(basename "$WASM")"
WASM_HASH="$(sha256_de "$WASM")"
SIZE="$(wc -c < "$WASM" | tr -d ' ')"

paso "comprobando los argumentos y el .wasm (sin red)"
nota ".wasm: $SIZE bytes, sha256 $WASM_HASH"

if [ -n "$SHA_PEDIDO" ]; then
  case "$WASM_HASH" in
    "$SHA_PEDIDO"*) ok "--sha256 coincide con el del .wasm" ;;
    *) fallar "--sha256 $SHA_PEDIDO no es el del .wasm ($WASM_HASH)." "Compará con el del release de GitHub y con el del ensayo antes de seguir." ;;
  esac
fi

# Las direcciones, con su dígito de control. La CLI las valida sin red.
direccion_valida() { stellar xdr encode --type ScAddress "\"$1\"" >/dev/null 2>&1; }
direccion_valida "$RAFFLE" || fallar "--raffle no es una dirección válida (el dígito de control no cierra): $RAFFLE"
direccion_valida "$TREASURY" || fallar "--treasury no es una dirección válida (el dígito de control no cierra): $TREASURY"
for t in "${LISTA_TOKENS[@]}"; do
  direccion_valida "$t" || fallar "un token de --tokens no es una dirección válida (el dígito de control no cierra): $t"
done
ok "las direcciones tienen el dígito de control bien"

# El .wasm tiene que ser el de este contrato, con este constructor.
if ! INTERFAZ="$(stellar contract info interface --wasm "$WASM" 2>/dev/null)"; then
  fallar "no pude leer la interfaz de $WASM con la CLI: ¿es un contrato de Soroban?"
fi
CONSTRUCTOR="$(printf '%s\n' "$INTERFAZ" | tr -d '\r' | awk '/fn __constructor\(/ { dentro = 1 } dentro { print } dentro && /\);/ { exit }' \
  | tr -d ' \n')"
CONSTRUCTOR="${CONSTRUCTOR/,)/)}"
CONSTRUCTOR="${CONSTRUCTOR%;}"
if [ "$CONSTRUCTOR" != "$CONSTRUCTOR_ESPERADO" ]; then
  fallar "este .wasm no es el contrato de premios que este guion sabe desplegar." \
    "Su constructor es: ${CONSTRUCTOR:-(no tiene)}" \
    "Se esperaba:       $CONSTRUCTOR_ESPERADO"
fi
ok "el constructor del .wasm tiene los cinco argumentos esperados"
BINVER="$(stellar contract info meta --wasm "$WASM" 2>/dev/null | tr -d '\r' | sed -n 's/.*binver: *//p' | head -1 || true)"
nota "contrato tinkazo-premios, binver ${BINVER:-desconocida}"

# La red, por su passphrase.
RED_CONFIG="$(stellar network ls --long 2>/dev/null | tr -d '\r' | awk -v red="$NETWORK" '
  /^Name: /                                 { nombre = substr($0, 7); next }
  nombre == red && /^RPC url: /             { rpc = substr($0, 10) }
  nombre == red && /^Network passphrase: /  { pass = substr($0, 21) }
  END                                       { printf "%s|%s", pass, rpc }')"
PASSPHRASE_CLI="${RED_CONFIG%%|*}"
RPC_CLI="${RED_CONFIG#*|}"
if [ "$NETWORK" = mainnet ]; then PASSPHRASE_ESPERADA="$PASSPHRASE_MAINNET"; else PASSPHRASE_ESPERADA="$PASSPHRASE_TESTNET"; fi
if [ "$PASSPHRASE_CLI" != "$PASSPHRASE_ESPERADA" ]; then
  fallar "la red «$NETWORK» de la CLI no es la que dice ser." \
    "Passphrase en la CLI: ${PASSPHRASE_CLI:-(la red no está configurada)}" \
    "Passphrase esperada:  $PASSPHRASE_ESPERADA" \
    "Se ve con \`stellar network ls --long\` y se corrige con \`stellar network add $NETWORK ...\`."
fi
if [ "$NETWORK" = mainnet ]; then
  case "$RPC_CLI" in
    ''|*"Bring Your Own"*) fallar "la red mainnet de la CLI no tiene un RPC configurado." \
      "stellar network add mainnet --rpc-url https://mainnet.sorobanrpc.com --network-passphrase \"$PASSPHRASE_MAINNET\"" ;;
  esac
fi
ok "la red $NETWORK de la CLI tiene la passphrase correcta (${RPC_CLI})"

# La cuenta que firma. Solo se lee su dirección pública.
if ! DEPLOYER="$(stellar keys address "$IDENTITY" 2>/dev/null)" || ! es_cuenta "$DEPLOYER"; then
  fallar "la CLI no tiene una identidad llamada «$IDENTITY»." "Se ven con \`stellar keys ls\`; se elige con --identity."
fi
ok "cuenta de despliegue: $DEPLOYER (identidad $IDENTITY)"

# ---------------------------------------------------------------- atestación del .wasm
sin_color() { sed -e $'s/\033\\[[0-9;]*[A-Za-z]//g' -e 's/\r$//'; }
campo_atestacion() { printf '%s\n' "$PLANO_ATESTACION" | sed -n "s/^[[:space:]]*$1:[[:space:]]*//p" | head -1; }

VERIFICADO_POR_GH=0
ERROR_GH=""
if command -v gh >/dev/null 2>&1; then
  if ERROR_GH="$(gh attestation verify "$WASM" --repo "$REPO_OFICIAL" --signer-repo "$FIRMANTE_DEL_BUILD" \
      --deny-self-hosted-runners 2>&1)"; then
    VERIFICADO_POR_GH=1
  fi
fi
INFO_BUILD=""
HAY_INFO_BUILD=0
if INFO_BUILD="$(stellar contract info build --wasm "$WASM" 2>&1)"; then HAY_INFO_BUILD=1; fi
PLANO_ATESTACION="$(printf '%s\n' "$INFO_BUILD" | sin_color)"
A_REPO="$(campo_atestacion Repository)"
A_REF="$(campo_atestacion Ref)"
A_RUTA="$(campo_atestacion Path)"
A_COMMIT="$(campo_atestacion 'Git Commit')"

COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo desconocido)"
ORIGEN_COMMIT="el de este árbol de trabajo, sin atestación"
if [ "$NETWORK" = mainnet ]; then
  command -v gh >/dev/null 2>&1 || fallar "en mainnet hace falta la CLI de GitHub (gh) para verificar la atestación del .wasm." \
    "Instalala (https://cli.github.com) e iniciá sesión con \`gh auth login\`."
  [ "$VERIFICADO_POR_GH" = 1 ] || fallar "gh no pudo verificar la atestación de GitHub de este .wasm contra $REPO_OFICIAL." \
    "Tiene que ser el .wasm que armó el release (workflow $WORKFLOW_DE_RELEASE), tal cual." "$ERROR_GH"
  [ "$HAY_INFO_BUILD" = 1 ] || fallar "la CLI no pudo leer los datos de la atestación (¿límite de pedidos de la API de GitHub?). Reintentá en unos minutos." \
    "$(printf '%s\n' "$PLANO_ATESTACION" | head -3)"
  [ "$A_REPO" = "https://github.com/$REPO_OFICIAL" ] \
    || fallar "la atestación es de otro repositorio: ${A_REPO:-(no dice)}" "Se esperaba https://github.com/$REPO_OFICIAL"
  case "$A_REF" in
    "$REF_DE_RELEASE"*) ;;
    *) fallar "la atestación no viene de un tag de release de premios: ${A_REF:-(no dice)}" \
         "Se esperaba un tag que empiece con ${REF_DE_RELEASE#refs/tags/}." ;;
  esac
  [ "$A_RUTA" = "$WORKFLOW_DE_RELEASE" ] \
    || fallar "la atestación no viene de $WORKFLOW_DE_RELEASE: ${A_RUTA:-(no dice)}"
  [[ "$A_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fallar "la atestación no trae un commit válido: ${A_COMMIT:-(no dice)}"
  COMMIT="${A_COMMIT:0:7}"
  ORIGEN_COMMIT="atestación de GitHub: $A_REF, $A_RUTA"
  ok "atestación de GitHub verificada contra $REPO_OFICIAL (commit $A_COMMIT, $A_REF)"
elif [ "$VERIFICADO_POR_GH" = 1 ] && [ "$HAY_INFO_BUILD" = 1 ] && [[ "$A_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  COMMIT="${A_COMMIT:0:7}"
  ORIGEN_COMMIT="atestación de GitHub: ${A_REF:-?}, ${A_RUTA:-?}"
  ok "atestación de GitHub verificada (commit $A_COMMIT, ${A_REF:-?})"
else
  aviso "  Este .wasm no tiene una atestación de GitHub que lo una a $REPO_OFICIAL: en testnet se acepta, en mainnet no."
fi

# ---------------------------------------------------------------- mainnet: los tokens, recalculados
if [ "$NETWORK" = mainnet ]; then
  CALCULADO_XLM="$(stellar contract id asset --asset native --network mainnet 2>/dev/null | tr -d '\r' | tail -1 || true)"
  CALCULADO_USDC="$(stellar contract id asset --asset "USDC:$USDC_EMISOR" --network mainnet 2>/dev/null | tr -d '\r' | tail -1 || true)"
  [ "$CALCULADO_XLM" = "$XLM_MAINNET" ] \
    || fallar "la dirección de XLM de este guion no coincide con el cálculo de la CLI." "Guion: $XLM_MAINNET" "CLI:   ${CALCULADO_XLM:-(sin respuesta)}"
  [ "$CALCULADO_USDC" = "$USDC_MAINNET" ] \
    || fallar "la dirección de USDC de este guion no coincide con el cálculo de la CLI." "Guion: $USDC_MAINNET" "CLI:   ${CALCULADO_USDC:-(sin respuesta)}"
  ok "las direcciones de USDC y XLM coinciden con el cálculo de la CLI"
fi

# ---------------------------------------------------------------- el comando
TOKENS_JSON='['
for t in "${LISTA_TOKENS[@]}"; do TOKENS_JSON="$TOKENS_JSON\"$t\","; done
TOKENS_JSON="${TOKENS_JSON%,}]"

# Siempre el valor explícito de --allow_in_kind. Sin valor, la CLI lo toma como verdadero.
COMANDO=(stellar contract deploy
  --wasm "$WASM"
  --source-account "$IDENTITY"
  --network "$NETWORK"
  --
  --raffle "$RAFFLE"
  --treasury "$TREASURY"
  --fee_bps "$FEE_BPS"
  --tokens "$TOKENS_JSON"
  --allow_in_kind "$ALLOW")

citar() {  # una palabra lista para pegar en bash
  local comilla="'" escapada="'\\''"
  case "$1" in
    ''|*[!A-Za-z0-9_./:=@%+,-]*) printf "'%s'" "${1//$comilla/$escapada}" ;;
    *) printf '%s' "$1" ;;
  esac
}
mostrar_comando() {
  local a texto=""
  for a in "$@"; do
    case "$a" in
      --)    texto+=" \\"$'\n'"    --" ;;
      --?*)  texto+=" \\"$'\n'"    $(citar "$a")" ;;
      *)     texto+=" $(citar "$a")" ;;
    esac
  done
  printf '%s\n' "${texto# }"
}

etiqueta_token() {
  if [ "$NETWORK" = mainnet ] && [ "$1" = "$USDC_MAINNET" ]; then printf '%s (USDC, emisor %s)' "$1" "$USDC_EMISOR"
  elif [ "$NETWORK" = mainnet ] && [ "$1" = "$XLM_MAINNET" ]; then printf '%s (XLM nativo)' "$1"
  else printf '%s' "$1"; fi
}

echo
if [ "$DRY_RUN" = 1 ]; then echo "Despliegue de tinkazo-premios en $NETWORK (--dry-run)"; else echo "Despliegue de tinkazo-premios en $NETWORK"; fi
[ "$NETWORK" != mainnet ] || error "  ESTO ES MAINNET: se gastan fondos reales y el contrato no se puede corregir ni actualizar."
printf '  %-15s %s\n' "cuenta:" "$DEPLOYER (identidad $IDENTITY)"
printf '  %-15s %s\n' ".wasm:" "$WASM"
printf '  %-15s %s\n' "bytes:" "$SIZE"
printf '  %-15s %s\n' "sha256:" "$WASM_HASH"
printf '  %-15s %s\n' "commit:" "$COMMIT ($ORIGEN_COMMIT)"
echo "  Constructor (queda fijo para siempre):"
printf '    %-14s %s\n' "raffle:" "$RAFFLE"
printf '    %-14s %s\n' "treasury:" "$TREASURY"
printf '    %-14s %s\n' "fee_bps:" "$FEE_BPS"
for t in "${LISTA_TOKENS[@]}"; do printf '    %-14s %s\n' "token:" "$(etiqueta_token "$t")"; done
printf '    %-14s %s\n' "allow_in_kind:" "$ALLOW"
echo

if [ "$DRY_RUN" = 1 ]; then
  echo "Comando que correría (--dry-run: no se subió nada, ni a la red ni a docs/deployments.md):"
  echo
  mostrar_comando "${COMANDO[@]}"
  echo
  if [ "$NETWORK" = mainnet ]; then
    echo "Para desplegar de verdad: el mismo comando sin --dry-run y con --sha256 ${WASM_HASH:0:12}"
  else
    echo "Para desplegar de verdad: el mismo comando sin --dry-run."
  fi
  echo "Antes de subir, el despliegue de verdad comprueba que el contrato del sorteo responda (next_id)."
  echo "Si se pega el comando en PowerShell 5.1, las comillas dobles del JSON de --tokens se pierden:"
  echo "hay que escaparlas (\\\") o pasar el JSON en un archivo con --tokens-file-path."
  exit 0
fi

if [ "$NETWORK" = mainnet ] && [ -z "$SHA_PEDIDO" ]; then
  fallar "mainnet pide confirmar el .wasm: agregá --sha256 ${WASM_HASH:0:12}" \
    "Son los primeros 12 caracteres del sha256 de arriba. Compará antes con el del release de GitHub" \
    "y con el del .wasm que corrió en el ensayo de testnet: tienen que ser el mismo archivo."
fi

# ---------------------------------------------------------------- despliegue
# El contrato del sorteo se fija para siempre: una dirección con el dígito de control bien pero que
# no sea el sorteo (o que no exista en esta red) dejaría un contrato de premios que nunca puede sellar.
# La configuración que lee get_config después no lo notaría, porque sería lo que se pidió.
paso "comprobando que el contrato del sorteo responde en $NETWORK"
if ! RESPUESTA_SORTEO="$(stellar contract invoke --id "$RAFFLE" --source-account "$IDENTITY" --network "$NETWORK" --send=no -- next_id 2>&1)" \
   || ! [[ "$(printf '%s' "$RESPUESTA_SORTEO" | tr -d '\r' | tail -1 | tr -d '" ')" =~ ^[0-9]+$ ]]; then
  fallar "el contrato del sorteo $RAFFLE no responde a next_id en $NETWORK." \
    "Tiene que ser la dirección de tinkazo-raffle en esta red (docs/deployments.md). No se subió nada." \
    "$(printf '%s\n' "$RESPUESTA_SORTEO" | tr -d '\r' | tail -3)"
fi
ok "el sorteo responde (next_id $(printf '%s' "$RESPUESTA_SORTEO" | tr -d '\r' | tail -1 | tr -d '" '))"

paso "desplegando en $NETWORK con $DEPLOYER"
if ! SALIDA="$("${COMANDO[@]}")"; then
  fallar "la CLI no pudo desplegar (el motivo está arriba)."
fi
CONTRACT_ID="$(printf '%s\n' "$SALIDA" | tr -d '\r' | tail -1)"
if ! es_contrato "$CONTRACT_ID"; then
  fallar "no entendí la salida de la CLI: se esperaba la dirección del contrato en la última línea." "$SALIDA"
fi
nota "contrato: $CONTRACT_ID"

# NO USAR: el contrato se creó pero no es lo pedido. El constructor no se puede corregir.
contrato_malo() {
  error ""
  error "NO USAR ESTE CONTRATO: $CONTRACT_ID"
  local l; for l in "$@"; do error "  $l"; done
  error "  El constructor se fija una sola vez y no se puede corregir: hay que desplegar otra instancia con los"
  error "  argumentos correctos. Esta no se registró en docs/deployments.md."
  exit 1
}

# Justo después de desplegar, un RPC que reparte la carga entre nodos puede ir un ledger atrasado y
# no ver todavía el contrato: las lecturas se reintentan unos segundos antes de darlo por malo.
con_reintentos() {  # con_reintentos <intentos> <función>
  local intentos="$1" i; shift
  for ((i = 1; i <= intentos; i++)); do
    if "$@"; then return 0; fi
    if [ "$i" -lt "$intentos" ]; then sleep "${ESPERA_REINTENTO:-5}"; fi
  done
  return 1
}
leer_config() { CONFIG="$(stellar contract invoke --id "$CONTRACT_ID" --source-account "$IDENTITY" --network "$NETWORK" --send=no -- get_config)"; }
bajar_wasm() { stellar contract fetch --id "$CONTRACT_ID" --network "$NETWORK" --out-file "$BAJADO" >/dev/null; }

paso "leyendo get_config y comparando los cinco valores con lo pedido"
if ! con_reintentos 4 leer_config; then
  contrato_malo "No pude leer get_config del contrato recién creado (cuatro intentos)."
fi
nota "get_config: $(printf '%s' "$CONFIG" | tr -d '\r\n')"
PLANO="$(printf '%s' "$CONFIG" | tr -d ' \t\r\n')"
LEIDO_RAFFLE="$(printf '%s' "$PLANO" | sed -nE 's/.*"raffle":"([^"]*)".*/\1/p')"
LEIDO_TREASURY="$(printf '%s' "$PLANO" | sed -nE 's/.*"treasury":"([^"]*)".*/\1/p')"
LEIDO_FEE="$(printf '%s' "$PLANO" | sed -nE 's/.*"fee_bps":"?([0-9]+)"?.*/\1/p')"
LEIDO_TOKENS="$(printf '%s' "$PLANO" | sed -nE 's/.*"tokens":\[([^]]*)\].*/\1/p' | tr -d '"')"
LEIDO_ALLOW="$(printf '%s' "$PLANO" | sed -nE 's/.*"allow_in_kind":(true|false).*/\1/p')"

DIFERENCIAS=()
comparar() {  # comparar <campo> <pedido> <leído>
  if [ "$2" = "$3" ]; then
    ok "$1: $2"
  else
    error "  MAL $1: pedido «$2», en la red «${3:-no se pudo leer}»"
    DIFERENCIAS+=("$1: pedido «$2», en la red «${3:-no se pudo leer}»")
  fi
}
comparar raffle "$RAFFLE" "$LEIDO_RAFFLE"
comparar treasury "$TREASURY" "$LEIDO_TREASURY"
comparar fee_bps "$FEE_BPS" "$LEIDO_FEE"
comparar tokens "$TOKENS" "$LEIDO_TOKENS"
comparar allow_in_kind "$ALLOW" "$LEIDO_ALLOW"
if [ ${#DIFERENCIAS[@]} -gt 0 ]; then
  contrato_malo "La configuración que quedó en la red no es la pedida:" "${DIFERENCIAS[@]}"
fi

paso "comprobando que en la red está el mismo .wasm"
BAJADO="$(mktemp)"; TEMPORALES+=("$BAJADO")
if ! con_reintentos 4 bajar_wasm; then
  contrato_malo "No pude bajar el .wasm del contrato para compararlo (cuatro intentos)."
fi
HASH_EN_LA_RED="$(sha256_de "$BAJADO")"
if [ "$HASH_EN_LA_RED" != "$WASM_HASH" ]; then
  contrato_malo "La red tiene otro .wasm que el desplegado." "En la red: $HASH_EN_LA_RED" "Archivo:   $WASM_HASH"
fi
ok "sha256 en la red: $HASH_EN_LA_RED"

# ---------------------------------------------------------------- registro
FECHA="$(date -u +%Y-%m-%d)"
NOTAS="$SIZE bytes; tinkazo-premios ${BINVER:-sin binver}. Constructor: sorteo \`$RAFFLE\`, tesorería \`$TREASURY\`, fee_bps $FEE_BPS, tokens"
for t in "${LISTA_TOKENS[@]}"; do NOTAS="$NOTAS \`$t\`"; done
NOTAS="$NOTAS, allow_in_kind $ALLOW."
FILA="| $FECHA | $NETWORK | \`$CONTRACT_ID\` | \`$WASM_HASH\` | $COMMIT | \`${DEPLOYER:0:6}…${DEPLOYER: -4}\` | $NOTAS |"

# Reemplaza la fila «pendiente» de esa red o agrega una al final de la tabla de la sección
# «Contrato de premios». Si la sección no existe, la crea al final del archivo.
registrar_en_docs() {
  local doc="$ROOT/docs/deployments.md" tmp rc=0
  [ -f "$doc" ] || return 1
  tmp="$(mktemp)"; TEMPORALES+=("$tmp")
  # BINMODE=3: el gawk de Windows (Git Bash) lee en modo texto y descartaría los \r de un documento
  # con finales de línea CRLF; así los conserva. En los demás awk es una variable sin uso.
  FILA="$1" RED="$NETWORK" awk -v BINMODE=3 '
    BEGIN { fila = ENVIRON["FILA"]; red = ENVIRON["RED"]; n = 0 }
    { linea[++n] = $0 }
    END {
      cr = (n > 0 && linea[1] ~ /\r$/) ? "\r" : ""
      ini = 0
      for (i = 1; i <= n; i++) if (index(linea[i], "## Contrato de premios") == 1) { ini = i; break }
      if (ini == 0) {
        for (i = 1; i <= n; i++) print linea[i]
        if (n > 0 && linea[n] != "" && linea[n] != cr) print cr
        print "## Contrato de premios (`tinkazo-premios`)" cr
        print cr
        print "| Fecha | Red | Dirección del contrato | WASM (sha256) | Commit | Cuenta de despliegue | Notas |" cr
        print "|---|---|---|---|---|---|---|" cr
        print fila cr
        exit 0
      }
      fin = n + 1
      for (i = ini + 1; i <= n; i++) if (linea[i] ~ /^## /) { fin = i; break }
      cab = 0
      for (i = ini + 1; i < fin; i++) if (linea[i] ~ /^\| Fecha \|/) { cab = i; break }
      if (cab == 0) exit 3
      ult = cab
      while (ult + 1 < fin && linea[ult + 1] ~ /^\|/) ult++
      pos = 0
      for (i = cab + 2; i <= ult; i++) if (linea[i] ~ ("^\\| [^ |]+ \\| " red " \\| pendiente")) { pos = i; break }
      for (i = 1; i <= n; i++) {
        if (pos > 0 && i == pos) print fila cr
        else print linea[i]
        if (pos == 0 && i == ult) print fila cr
      }
    }' "$doc" > "$tmp" || rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  cat "$tmp" > "$doc"
}

if registrar_en_docs "$FILA"; then
  paso "registrado en docs/deployments.md (sección «Contrato de premios»): revisá el cambio y commitealo."
else
  aviso "No pude registrar el despliegue en docs/deployments.md. Agregá esta fila a mano a la tabla de «Contrato de premios»:"
  aviso "$FILA"
fi

# ---------------------------------------------------------------- aviso operativo
cat <<AVISO

Antes de usar el contrato:
  1. El primer \`create\` después del despliegue paga la renta del código y de la instancia
     (unos 16 XLM en mainnet, estimado, y unos 45 en testnet, medido). Lo tiene que firmar
     una cuenta de Tinkazo con saldo y con un tope de fee que lo cubra (la simulación pide
     alrededor de un 15 % más de lo que termina cobrando), no la cuenta de quien crea la
     promoción: una billetera con tope de fee fallaría, o pagaría sin saberlo la renta de todas.
  2. \`settle\` lo corre siempre el servicio, no quien gana: con varios premios cuesta cerca de
     1 XLM y supera el tope de 1 XLM de algunas billeteras.
  3. \`extend\` al menos una vez por mes, mientras haya una promoción sin cerrar o fondos en el
     contrato (también una comisión que espera en \`collect_fee\`):
       stellar contract invoke --id $CONTRACT_ID --source-account <operación> --network $NETWORK -- extend --promo_id <id>
     Si pasa más tiempo, las entradas se archivan: se restauran con \`stellar contract restore\`.

AVISO
echo "$CONTRACT_ID"
