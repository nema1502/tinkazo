import { PROOF_VERSION, proofUrl, type Proof } from "../protocol/proof";
import { RED_DE_PRUEBA } from "./red";

/**
 * El comprobante de la prueba: el mismo formato de siempre, en la red de prueba y con el contrato de la prueba. Sin firma
 * de la ronda sirve para el enlace que se ofrece mientras se espera el sorteo.
 */
export function armarComprobante(o: {
  nombres: string[];
  ronda: number;
  id: bigint;
  firma48Hex?: string;
  hashSello: string;
  hashSorteo?: string;
  selladoEn: number;
}): Proof {
  return {
    v: PROOF_VERSION,
    names: o.nombres,
    round: o.ronda,
    sealedAt: o.selladoEn,
    net: "testnet",
    contract: RED_DE_PRUEBA.contrato,
    id: o.id.toString(),
    ...(o.firma48Hex ? { signature: o.firma48Hex } : {}),
    stx: o.hashSello,
    ...(o.hashSorteo ? { dtx: o.hashSorteo } : {}),
  };
}

/** El enlace a la página de verificación del mismo sitio. */
export function enlaceDeComprobante(p: Proof, base: string = location.origin): Promise<string> {
  return proofUrl(p, base);
}
