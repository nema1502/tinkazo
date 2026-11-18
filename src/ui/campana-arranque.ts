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
 * Lo que la herramienta hace con las campañas, detrás de su bandera (`main.ts`): la pestaña que deja la ventana de Google
 * y la entrada de quien ganó.
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
  if (premio) arrancarPremio(depsReales());
}
