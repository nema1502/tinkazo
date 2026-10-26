// Los nombres de los tipos de costo de Soroban (`ContractCostType`), en el orden del XDR.
//
// `contract_cost_params_cpu_instructions` y `contract_cost_params_memory_bytes` son listas con un
// elemento por tipo de costo, y el aviso del detector las nombra por posición: `[9]` es
// `computeEd25519PubKey`. El runner de GitHub no tiene node_modules, así que la lista va fija acá.
// El protocolo 29 tiene 86 tipos (del 0 al 85); un índice que no está en la lista se
// imprime como número, igual que antes de que existiera.
//
// Para regenerarla con el SDK instalado (hace falta cuando la red suma tipos, por ejemplo con un
// protocolo nuevo; `tipos-de-costo.test.mjs` compara cada nombre con el SDK y avisa si no coincide):
//   node -e "const {xdr}=require('@stellar/stellar-sdk'); for(let i=0;i<200;i++){try{console.log(i, xdr.ContractCostType.fromValue(i).name)}catch{break}}"
// Esta salió de @stellar/stellar-sdk 17.3.0, que ya conoce 9 tipos más (del 86 al 94: los `mlDsa…` y los
// `verifyMlDsa…`) que la red todavía no tiene.

export const COST_TYPE_NAMES = [
  "wasmInsnExec", "memAlloc", "memCpy", "memCmp", "dispatchHostFunction", // 0-4
  "visitObject", "valSer", "valDeser", "computeSha256Hash", "computeEd25519PubKey", // 5-9
  "verifyEd25519Sig", "vmInstantiation", "vmCachedInstantiation", "invokeVmFunction", "computeKeccak256Hash", // 10-14
  "decodeEcdsaCurve256Sig", "recoverEcdsaSecp256k1Key", "int256AddSub", "int256Mul", "int256Div", // 15-19
  "int256Pow", "int256Shift", "chaCha20DrawBytes", "parseWasmInstructions", "parseWasmFunctions", // 20-24
  "parseWasmGlobals", "parseWasmTableEntries", "parseWasmTypes", "parseWasmDataSegments", "parseWasmElemSegments", // 25-29
  "parseWasmImports", "parseWasmExports", "parseWasmDataSegmentBytes", "instantiateWasmInstructions", "instantiateWasmFunctions", // 30-34
  "instantiateWasmGlobals", "instantiateWasmTableEntries", "instantiateWasmTypes", "instantiateWasmDataSegments", "instantiateWasmElemSegments", // 35-39
  "instantiateWasmImports", "instantiateWasmExports", "instantiateWasmDataSegmentBytes", "sec1DecodePointUncompressed", "verifyEcdsaSecp256r1Sig", // 40-44
  "bls12381EncodeFp", "bls12381DecodeFp", "bls12381G1CheckPointOnCurve", "bls12381G1CheckPointInSubgroup", "bls12381G2CheckPointOnCurve", // 45-49
  "bls12381G2CheckPointInSubgroup", "bls12381G1ProjectiveToAffine", "bls12381G2ProjectiveToAffine", "bls12381G1Add", "bls12381G1Mul", // 50-54
  "bls12381G1Msm", "bls12381MapFpToG1", "bls12381HashToG1", "bls12381G2Add", "bls12381G2Mul", // 55-59
  "bls12381G2Msm", "bls12381MapFp2ToG2", "bls12381HashToG2", "bls12381Pairing", "bls12381FrFromU256", // 60-64
  "bls12381FrToU256", "bls12381FrAddSub", "bls12381FrMul", "bls12381FrPow", "bls12381FrInv", // 65-69
  "bn254EncodeFp", "bn254DecodeFp", "bn254G1CheckPointOnCurve", "bn254G2CheckPointOnCurve", "bn254G2CheckPointInSubgroup", // 70-74
  "bn254G1ProjectiveToAffine", "bn254G1Add", "bn254G1Mul", "bn254Pairing", "bn254FrFromU256", // 75-79
  "bn254FrToU256", "bn254FrAddSub", "bn254FrMul", "bn254FrPow", "bn254FrInv", // 80-84
  "bn254G1Msm", // 85
];

/** El nombre del tipo de costo en esa posición, o `undefined` si la lista no lo conoce. */
export const costTypeName = (index) => COST_TYPE_NAMES[index];
