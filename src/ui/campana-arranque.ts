import { hayCampanaActiva } from "../campana/en-curso";
import { t } from "../i18n";
import { avisarQueNoCargo } from "./aviso-no-cargo";
import { atenderVentanaDeGoogle, cerrarVentana, pintarCapa } from "./campana-ventana";
import { callarPasoEnEstaCarga, esperarAQuienGano, nadaSeAbreSolo, permitirPasoDelPremio } from "./cuenta-lista-flujo";
import { type DepsDelPremio, arrancarPremio } from "./premio-entrada";
import { pideElPremioAqui } from "./premio-pide";
import { hayModoOficial, network } from "../stellar/config";
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
 * parámetro), y el panel de quien organiza se monta con `?campana`, cuando esta compu tiene una sala de campaña activa o
 * cuando este navegador guarda una campaña por activar (`borrador.ts`). Sin ninguna de las tres, la herramienta es la de siempre.
 *
 * La campaña por activar se ve hasta que se activa o se deja: en el modo oficial, la página abre la herramienta con el
 * panel y nada más, con o sin sesión, al recargar, al tocar Sortear y al volver mañana. Al entrar con Google la página
 * queda abierta y recibe la sesión (la ventana de Google es otra pestaña), y si se recarga el borrador sigue guardado: los
 * dos casos caen acá. En Prueba no se activa: un aviso lleva a la campaña en el modo oficial (`campana-pendiente.ts`).
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
  const params = new URLSearchParams(location.search);
  // Una demostración no es la campaña de nadie: la campaña por activar no se pone encima de ella.
  const porActivar = !["demo", "pose", "instant"].some((k) => params.has(k)) && hayBorrador();
  const enOficial = network.name === "mainnet";
  const avisa = porActivar && !enOficial && hayModoOficial;
  if (avisa) void import("./campana-pendiente").then((m) => m.avisarEnPrueba()).catch(() => undefined);
  const conCampana = params.has("campana");
  // Quien organiza ve su campaña sin tocar nada, con o sin sesión: la dirección del panel y una campaña por activar abren la
  // herramienta. En Prueba con un borrador no: el aviso de la portada lleva a la campaña en el modo oficial.
  if (!avisa && (conCampana || (porActivar && enOficial))) abrirLaHerramienta();
  if (conCampana || hayCampanaActiva() || (porActivar && enOficial)) {
    // El panel baja aparte y tarda unos cuadros: hasta que existe, la página marca que viene y el editor del sorteo común no se pinta
    // (`campana-sala.css`). La marca se saca en cuanto el panel está o no se pudo montar, para que el editor nunca quede escondido.
    const viene = !params.has("demo");
    if (viene) document.documentElement.dataset.campana = "";
    void import("./campana-sala")
      .then((m) => m.montarPanelDeCampana())
      .catch(() => undefined)
      .finally(() => {
        if (viene) delete document.documentElement.dataset.campana;
      });
  }
}

/** La clave de `borrador.ts`, escrita acá para no bajar ese módulo a quien no armó ninguna campaña (la prueba las ata). */
export const CLAVE_DEL_BORRADOR_AQUI = "tinkazo.campana.borrador";

/**
 * Si este navegador guarda una campaña por activar: la deja crear-campana.html al tocar Activar mi campaña. Solo cuenta un
 * borrador que se lee como campaña (con su evento y el nombre de la empresa): uno roto o de otra versión no cambia nada.
 */
export function hayBorrador(): boolean {
  try {
    const crudo = localStorage.getItem(CLAVE_DEL_BORRADOR_AQUI);
    if (crudo === null || crudo === "" || crudo.length > 200_000) return false;
    const x: unknown = JSON.parse(crudo);
    if (typeof x !== "object" || x === null) return false;
    const { evento, empresa } = x as { evento?: unknown; empresa?: unknown };
    const nombre = typeof empresa === "object" && empresa !== null ? (empresa as { nombre?: unknown }).nombre : undefined;
    return typeof evento === "string" && evento !== "" && typeof nombre === "string" && nombre.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * La página abre la herramienta, donde vive el panel: la portada de siempre competía con él. Es el mismo camino que Sortear
 * del menú (`#sortear`, que `main.ts` atiende con el evento del fragmento). Solo desde la dirección sin fragmento (la que deja
 * crear-campana.html, el logo o el menú): `#mis-sorteos` o `#portada` se respetan.
 */
function abrirLaHerramienta(): void {
  if (location.hash !== "") return;
  try {
    history.replaceState(history.state, "", `${location.pathname}${location.search}#sortear`);
    dispatchEvent(new Event("hashchange"));
  } catch {
    /* sin historial, la portada sigue y el menú lleva a la campaña */
  }
}
