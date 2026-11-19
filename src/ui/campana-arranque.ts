import { hayCampanaActiva } from "../campana/en-curso";
import { t } from "../i18n";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import { atenderVentanaDeGoogle, cerrarVentana, pintarCapa } from "./campana-ventana";
import { callarPasoEnEstaCarga, esperarAQuienGano, nadaSeAbreSolo, permitirPasoDelPremio } from "./cuenta-lista-flujo";
import { type DepsDelPremio, arrancarPremio } from "./premio-entrada";
import { pideElPremioAqui } from "./premio-pide";
import { currentSession } from "./wallet-ui";

/** Quien entra desde la portada marca que va a sortear (`wallet-ui.ts`): quien ganó no, así que se borra esa marca. */
function olvidarQueVaASortear(): void {
  try {
    sessionStorage.removeItem("tinkazo.abrir");
  } catch {
    /* sin almacenamiento, no hay marca */
  }
}

/** Lo que la entrada del premio le pide a la página. */
function depsReales(): DepsDelPremio {
  return {
    pideElPremio: pideElPremioAqui,
    cuentaDeLaSesion: () => currentSession()?.address ?? null,
    // Con `capture`, esta escucha corre antes que la de `main.ts`: la portada se queda, con la ventana del saldo encima.
    alEntrar: (f) => {
      const alCambiar = (ev: Event): void => {
        const cuenta = (ev as CustomEvent<string | null>).detail ?? null;
        if (cuenta) olvidarQueVaASortear();
        f(cuenta);
      };
      document.addEventListener("tinkazo:sesion", alCambiar, { capture: true });
    },
    nadaSeAbreSolo,
    esperarla: esperarAQuienGano,
    permitir: permitirPasoDelPremio,
    abrir: (cuenta) => void import("./saldo").then((m) => m.abrirSaldo({ address: cuenta })).catch(() => avisarQueNoCargo()),
    quitarDeLaDireccion: () => {
      try {
        const u = new URL(location.href);
        u.searchParams.delete("premio");
        history.replaceState(history.state, "", u.toString());
      } catch {
        /* sin historial, la dirección queda como está */
      }
    },
  };
}

/**
 * Lo que la herramienta hace con las campañas, detrás de su bandera (`main.ts`): la pestaña que deja la ventana de Google,
 * la entrada de quien ganó y el sorteo de una empresa. Esto último no depende de `?campana`: el aviso de un sello pendiente
 * se retoma al cargar la página (también después de volver de la ventana de Google, que recarga la página sin ese
 * parámetro), y el panel de quien organiza se monta con `?campana` o cuando esta compu tiene una sala de campaña activa.
 * Sin ninguna de las dos cosas, la herramienta es la de siempre.
 */
export function arrancar(): void {
  const premio = new URLSearchParams(location.search).get("premio") === "1";
  let sesion: Storage | null = null;
  try {
    sesion = sessionStorage;
  } catch {
    sesion = null;
  }
  const atendida = atenderVentanaDeGoogle({
    sesion,
    ahora: Date.now(),
    pideElPremio: premio,
    pintar: pintarCapa,
    cerrar: cerrarVentana,
    callar: callarPasoEnEstaCarga,
    tx: t,
  });
  if (atendida) return;
  if (premio) return arrancarPremio(depsReales());
  // Las escuchas del sello se registran ya, con el módulo bajado: ninguna se baja recién en el momento del evento.
  void import("./campana-resultado-real").then((m) => m.arrancarElPuente()).catch(() => undefined);
  if (new URLSearchParams(location.search).has("campana") || hayCampanaActiva()) {
    void import("./campana-sala").then((m) => m.montarPanelDeCampana()).catch(() => undefined);
  }
}
