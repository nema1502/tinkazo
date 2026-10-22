import { texto as t } from "./idioma";
import type { Proof } from "./protocol/proof";
import { roundTime } from "./protocol/quicknet";
import type { Motivo, Revision } from "./protocol/verificacion";

/**
 * Cómo se cuenta lo que dio `revisarComprobante`, en verificar y en evento.
 *
 * El titular y su explicación van sin tecnicismos: los lee quien escaneó el QR.
 * El detalle técnico (qué contrato, qué huella, qué ronda) va aparte, para
 * plegarlo: está para quien lo busca.
 */

/** El titular y la explicación de un veredicto rojo, por lo más grave que falló. Son claves de texto. */
export function porQueNoCuadra(r: Pick<Revision, "motivos">): { titulo: string; detalle: string } {
  const m: Motivo | undefined = r.motivos[0];
  switch (m) {
    case "contrato-ajeno":
    case "codigo-ajeno":
      return { titulo: "vVerdictNotOfficial", detalle: "vVerdictNotOfficialDetail" };
    case "contrato-retirado":
      return { titulo: "vVerdictNotOfficial", detalle: "vRetiredDetail" };
    case "ancla-deforme":
      return { titulo: "vVerdictBad", detalle: "vAnchorBroken" };
    case "numero-inexistente":
      return { titulo: "vVerdictBad", detalle: "vChainNeverDetail" };
    case "lista-deforme":
    case "lista-cambiada":
      return { titulo: "vVerdictBad", detalle: "vListChanged" };
    case "cantidad":
      return { titulo: "vVerdictBad", detalle: "vCountChanged" };
    case "ronda":
      return { titulo: "vVerdictBad", detalle: "vRoundChanged" };
    case "ronda-temprana":
      return { titulo: "vVerdictBad", detalle: "vRoundEarly" };
    case "firma":
      return { titulo: "vVerdictBad", detalle: "vBadSignature" };
    case "firma-registro":
    case "semilla":
      return { titulo: "vVerdictBad", detalle: "vSeedChanged" };
    case "ganadores":
      return { titulo: "vVerdictBad", detalle: "vMismatch" };
    default:
      return { titulo: "vVerdictBad", detalle: "vRecordOdd" };
  }
}

const llenar = (clave: string, valores: Record<string, string | number>): string =>
  Object.entries(valores).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t(clave));

/** El detalle técnico de lo que no cuadró: una línea por motivo, de lo más grave a lo menos. */
export function detalleTecnico(r: Revision, p: Proof): string[] {
  const sello = r.registro?.sello ?? null;
  const resultado = r.registro?.resultado ?? null;
  const raya = "—";
  return r.motivos.map((m) => {
    switch (m) {
      case "contrato-ajeno":
        return llenar("vTechContratoAjeno", { red: String(p.net ?? raya), c: String(p.contract ?? raya) });
      case "codigo-ajeno":
        return llenar("vTechCodigoAjeno", {
          c: String(p.contract ?? raya),
          w: r.registro?.wasm ?? raya,
          o: r.ancla.tipo === "oficial" ? r.ancla.contrato.wasmSha256 : raya,
        });
      case "contrato-retirado":
        return llenar("vTechContratoRetirado", {
          c: String(p.contract ?? raya),
          n: r.ancla.tipo === "oficial" ? (r.ancla.contrato.ultimoId ?? raya) : raya,
          id: String(p.id ?? raya),
        });
      case "ancla-deforme":
        return t("vTechAnclaDeforme");
      case "numero-inexistente":
        return llenar("vTechNumeroInexistente", { n: r.registro?.siguiente ?? raya, id: String(p.id ?? raya) });
      case "lista-deforme":
        return t("vTechListaDeforme");
      case "lista-cambiada":
        return llenar("vTechListaCambiada", { a: sello?.listHash ?? raya, b: r.huella });
      case "cantidad":
        return llenar("vTechCantidad", { a: sello?.count ?? raya, b: r.nombres.length });
      case "ronda":
        return llenar("vTechRonda", { a: sello?.round ?? raya, b: String(p.round) });
      case "ronda-temprana":
        return llenar("vTechRondaTemprana", {
          r: sello?.round ?? raya,
          s: sello ? roundTime(sello.round) - sello.sealedAt : raya,
        });
      case "firma":
        return llenar("vTechFirma", { r: r.ronda });
      case "firma-registro":
        return llenar("vTechFirmaRegistro", { r: r.ronda });
      case "semilla":
        return llenar("vTechSemilla", { a: resultado?.randomness ?? raya, b: r.semilla ?? raya });
      case "ganadores":
        return llenar("vTechGanadores", { a: resultado ? resultado.winners.join(", ") : raya, b: r.ganadores.join(", ") });
      default:
        return t("vTechRegistro");
    }
  });
}
