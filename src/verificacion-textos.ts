import { texto as t } from "./idioma";
import { hashDeTx, type Proof } from "./protocol/proof";
import { roundTime } from "./protocol/quicknet";
import { camposDistintos, type Motivo, type Revision } from "./protocol/verificacion";
import { txUrl } from "./stellar/config";
import type { SelloDelHistorial } from "./stellar/historial";

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
    case "sello-invalido":
      return { titulo: "vVerdictBad", detalle: "vHistInvalidDetail" };
    case "historial-distinto":
      return { titulo: "vVerdictBad", detalle: "vHistDistinctDetail" };
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

/**
 * La clave del texto que cuenta, en lenguaje simple, por qué el historial no pudo confirmar un
 * sorteo que el estado del contrato ya no tiene (`falta: "sin-historial"`). Ninguna de estas razones
 * dice que el sorteo no exista: una fuente que no contesta, o que ya no guarda algo tan antiguo, no prueba nada.
 */
export function porQueSinHistorial(r: Pick<Revision, "historial">): string {
  const h = r.historial;
  if (!h || h.ok) return "vHistWhyDown";
  switch (h.error) {
    case "fuera-de-ventana":
      return "vHistWhyWindow";
    case "no-encontrada":
      return "vHistWhyNone";
    case "respuesta-invalida":
      return "vHistWhyOdd";
    default:
      return "vHistWhyDown";
  }
}

/**
 * El código corto de un sello leído del historial: los primeros ocho caracteres del hash de su
 * transacción (la interior, si un fee-bump la envolvió, así que es el mismo cite el hash que cite).
 * Con el sello del historial el número del sorteo no se comprueba, y esto es lo que lo identifica,
 * junto con la fecha en que cerró.
 */
export const codigoDelSello = (h: Pick<SelloDelHistorial, "hashInterior">): string => h.hashInterior.slice(0, 8);

/** El detalle técnico de lo que no cuadró: una línea por motivo, de lo más grave a lo menos. */
export function detalleTecnico(r: Revision, p: Proof): string[] {
  const sello = r.registro?.sello ?? null;
  const resultado = r.registro?.resultado ?? null;
  const raya = "—";
  // El sello contra el que se comprobó: el del estado del contrato o, si ya no está, el de su transacción.
  const h = r.historial?.ok ? r.historial.sello : null;
  const visto = sello
    ? { listHash: sello.listHash, count: sello.count, round: sello.round, sealedAt: sello.sealedAt }
    : r.fuente === "historial" && h
      ? { listHash: h.listHash, count: h.count, round: h.round, sealedAt: h.closedAt }
      : null;
  const tx = String(p.stx ?? raya);
  const rechazo = r.historial && !r.historial.ok ? r.historial : null;
  return r.motivos.map((m) => {
    switch (m) {
      case "contrato-ajeno":
        // Con el ancla oficial, lo ajeno es el contrato de la transacción que cita el enlace.
        return r.ancla.tipo === "oficial"
          ? llenar("vTechHistorialContratoAjeno", { tx })
          : llenar("vTechContratoAjeno", { red: String(p.net ?? raya), c: String(p.contract ?? raya) });
      case "codigo-ajeno":
        return llenar("vTechCodigoAjeno", {
          c: String(p.contract ?? raya),
          w: r.registro?.wasm ?? raya,
          o: r.ancla.tipo === "oficial" ? r.ancla.contrato.wasmSha256 : raya,
        });
      case "contrato-retirado":
        return rechazo?.retirado
          ? llenar("vTechHistorialRetirado", {
              tx,
              c: String(p.contract ?? raya),
              u: r.ancla.tipo === "oficial" ? (r.ancla.contrato.ultimoLedger ?? raya) : raya,
            })
          : llenar("vTechContratoRetirado", {
              c: String(p.contract ?? raya),
              n: r.ancla.tipo === "oficial" ? (r.ancla.contrato.ultimoId ?? raya) : raya,
              id: String(p.id ?? raya),
            });
      case "sello-invalido":
        return llenar(rechazo?.error === "fallida" ? "vTechSelloFallo" : "vTechSelloOtra", { tx });
      case "historial-distinto":
        if (h && sello && r.ancla.tipo === "oficial") {
          return llenar("vTechHistorialDistinto", { tx, campos: camposDistintos(sello, h, r.ancla.contrato.contractId).join(", ") || raya });
        }
        return llenar("vTechHistorialOtroContrato", { tx, a: h?.contractId ?? raya, b: String(p.contract ?? raya) });
      case "ancla-deforme":
        return t("vTechAnclaDeforme");
      case "numero-inexistente":
        return llenar("vTechNumeroInexistente", { n: r.registro?.siguiente ?? raya, id: String(p.id ?? raya) });
      case "lista-deforme":
        return t("vTechListaDeforme");
      case "lista-cambiada":
        return llenar("vTechListaCambiada", { a: visto?.listHash ?? raya, b: r.huella });
      case "cantidad":
        return llenar("vTechCantidad", { a: visto?.count ?? raya, b: r.nombres.length });
      case "ronda":
        return llenar("vTechRonda", { a: visto?.round ?? raya, b: String(p.round) });
      case "ronda-temprana":
        return llenar("vTechRondaTemprana", {
          r: visto?.round ?? raya,
          s: visto ? roundTime(visto.round) - visto.sealedAt : raya,
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

/**
 * Por qué el sello salió del historial y no de la memoria rápida de la red (el estado del contrato):
 * ya no está (se archivó) o no se pudo leer ahora (`registro` nulo). Es la primera frase del verde por historial.
 */
export const porQueDelHistorial = (r: Pick<Revision, "registro">): string => (r.registro ? "vHistMemoriaArchivada" : "vHistMemoriaSinLeer");

/**
 * Dónde mirar cuando el historial no pudo confirmar el sello y el comprobante lo cita: la transacción en un
 * explorador y cómo comprobarla con los archivos de historia de Stellar, sin pasar por Tinkazo. Vacío si no
 * hay nada que citar o si el resultado no es "no confirmado" por falta de lectura. Plegado debajo del veredicto.
 */
export function detalleSinHistorial(r: Pick<Revision, "ancla" | "veredicto" | "falta">, p: Pick<Proof, "stx">): string[] {
  const stx = hashDeTx(p.stx);
  if (!stx || r.ancla.tipo !== "oficial" || r.veredicto !== "sin-red") return [];
  if (r.falta !== "sin-historial" && r.falta !== "sin-cadena") return [];
  const red = r.ancla.contrato.red;
  return [llenar("vTechSinHistorial", { tx: stx, url: txUrl(stx, red), red })];
}

/**
 * Lo técnico de un verde que salió del historial de transacciones: de qué
 * transacción, en qué ledger y a qué hora cerró, el número que trae el comprobante
 * (que por este camino no se comprueba) y lo que ese camino no revisa.
 * Plegado debajo del veredicto, para quien lo busca. Vacío si el sello no vino del historial.
 */
export function detalleDelHistorial(r: Revision, p?: Pick<Proof, "id">): string[] {
  if (r.fuente !== "historial" || !r.historial?.ok) return [];
  const h = r.historial.sello;
  return [
    llenar("vTechHistorial", { tx: h.hash, l: h.ledger, t: new Date(h.closedAt * 1000).toISOString(), c: h.contractId, o: h.organizer }),
    ...(p?.id ? [llenar("vTechNumeroDelComprobante", { n: p.id })] : []),
    t("vTechHistorialLimite"),
    t("vTechHistorialFuente"),
  ];
}
