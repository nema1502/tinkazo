/**
 * El stand de una campaña: la pantalla del evento que muestra el QR a pantalla completa y la lista que crece.
 *
 * Se abre con el enlace del stand: el evento en la dirección (`?c=<evento>&s=<sala>`) y el token del stand
 * después del `#`. Antes de abrir comprueba en la red que el premio esté depositado (el saldo de la cuenta
 * que organizó alcanza al total de los premios) y que la billetera conectada sea la de esa cuenta. Si falta
 * algo, lo dice y no abre: sin el premio o con otra billetera no hay evento.
 *
 * Al abrir genera la clave del QR (la que cifra los nombres de la lista y viaja solo en el fragmento), la
 * guarda en ese navegador para no perderla si se recarga, y pide el pase del QR. El pase de la sala ya rota
 * en ventanas de dos minutos (`VENTANA_PASE_MS` del servicio), así que el stand lo vuelve a pedir cuando
 * vence su ventana y el QR se vuelve a pintar recién cuando cambia el código.
 *
 * La lista se lee cada 5 segundos con el token y se descifra en la pantalla; lo que marca el filtro y los
 * nombres repetidos quedan en «Para revisar». Quitar pide el motivo con botones y cerrar pide confirmar
 * (`stand-campana-pantalla.ts`). Todo detrás de `VITE_CAMPANAS` (`campana/bandera.ts`).
 */

import { type Campana, leerCampana } from "../campana/modelo";
import { totalDePremios } from "../campana/comision";
import { montoTexto, horaTexto } from "../campana/formato";
import { descifrarEquipo, revisarEquipo } from "../equipos/datos";
import { esCuentaValida } from "../../workers/sala/src/logica";
import {
  type FallaDeSala,
  type MotivoDeSalida,
  estadoConToken,
  leerCampanaDeSala,
  leerOrganizadora,
  pedirPase,
  ponerFase,
  quitarConMotivo,
} from "../sala/campana-org";
import { generarClave } from "../sala/cifra";
import type { EquipoDeSala, Sala } from "../sala/cliente";
import { servicioDeSala } from "../sala/cliente";
import { activeWallet } from "../stellar/wallet-lite";
import { onLangChange } from "../i18n";
import { getLang, type Lang } from "../idioma";
import { pintarQr } from "./qr";
import { crearPantallaDeCampana, type PantallaDeCampana } from "./stand-campana-pantalla";
import { TEXTOS_STAND_CAMPANA } from "./stand-campana-textos";
import { leAlcanza, saldoDeLaCuenta, type EstadoDeSaldo } from "./stand-campana-saldo";

export type { EstadoDeSaldo };

/** El enlace del stand: el evento y la sala en la dirección, el token del stand en el fragmento. */
export interface EnlaceDelStand {
  evento: string;
  sala: string;
  token: string;
}

/** Una fila de la vista: el nombre en claro (`""` si no se pudo descifrar) y si espera revisión. */
export interface FilaDelStand {
  n: number;
  nombre: string;
  revisar: boolean;
}

/** Lo que la pantalla del stand (el proyector) muestra cuando ya abrió. */
export interface DatosDelProyector {
  /** El nombre de la empresa. */
  titulo: string;
  /** El logo de la empresa tal como lo firmó la campaña, o `null` si no tiene. */
  logo: { tipo: string; datos: string } | null;
  /** El premio, ya con el formato y la unidad que se lee. */
  premio: string;
  /** La hora de cierre como se lee, o `null` si la sala no la dice. */
  cierre: string | null;
  /** Cuántas personas van, con lo que la sala dice. */
  van: string;
  /** El enlace del celular con el pase de ahora y la clave después del `#`, o `null` sin pase. */
  enlace: string | null;
  /** Los nombres en claro, listos para la vista. */
  filas: FilaDelStand[];
  /** Lo que marca el filtro y los nombres repetidos: quedan en «Para revisar». */
  revisar: FilaDelStand[];
  /** La inscripción ya está cerrada: el QR deja de salir. */
  cerrado: boolean;
  /** La sala no contestó: se avisa y se conserva lo que había. */
  caido: boolean;
  /** Un aviso puntual que no se resuelve solo (una quita o un cierre que la sala rechazó), o el de la sala caída. */
  aviso: string | null;
}

/** Lo que el modelo le avisa a la pantalla después de cada paso. */
export type AvisoDelStand =
  | { vista: "chequeando" }
  | { vista: "fallo"; texto: string }
  | { vista: "abierta"; datos: DatosDelProyector };

/** Lo que entra por inyección: la red, el reloj, la billetera, el saldo, el almacenamiento y la pantalla. */
export interface DepsDelStandDeCampana {
  ahora: () => number;
  /** Timers inyectados: las pruebas los mueven a mano (`deps.cada`). */
  cada: (f: () => void, ms: number) => () => void;
  /** El `fetch` para la sala; sin decirlo, el del navegador. */
  fetch?: typeof fetch;
  /** Pinta el QR en un `img` (patrón `src/ui/qr.ts`). */
  qr: (img: HTMLImageElement, enlace: string, lado: number) => Promise<void>;
  /** La cuenta de la billetera conectada, o `null`. */
  cuenta: () => string | null;
  /** El saldo de una cuenta en la red, con sus estados sin lanzar. */
  saldo: (red: "mainnet" | "testnet", cuenta: string) => Promise<EstadoDeSaldo>;
  idioma: () => Lang;
  /** El texto de una clave del módulo de textos del stand. */
  tx: (clave: string) => string;
  /** Donde se guarda la clave del QR entre recargas. */
  almacen: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** El origen del sitio, para el enlace del celular. */
  origen: () => string;
  /** El servicio de salas, para los pedidos con el token. */
  servicio: string;
  /** A quién le avisa el modelo (la pantalla). */
  notificar: (aviso: AvisoDelStand) => void;
}

export interface StandDeCampana {
  /** La clave del QR activa, o `null` mientras no abrió. */
  clave: () => string | null;
  /** Quita a una persona con su motivo. La sala guarda el motivo; la lista se ajusta con la lectura que sigue. */
  quitar: (n: number, motivo: MotivoDeSalida) => Promise<true | FallaDeSala>;
  /** Cierra la inscripción en la sala (la fase queda cerrada). */
  cerrar: () => Promise<true | FallaDeSala>;
  /** Vuelve a componer los textos (el idioma cambió). */
  repintar: () => void;
  /** Apaga los timers al irse la página. */
  parar: () => void;
}

/* ------------------------------------------------------------ constantes */

/** Cada cuánto se lee la lista. */
const LISTA_CADA_MS = 5_000;
/** Con qué frecuencia se mira si el pase vence (la ventana de la sala es de dos minutos). */
const PASE_CADA_MS = 1_000;
/** Cuánto antes de la ventana se pide el pase nuevo. */
const ADELANTO_PASE_MS = 30_000;
/** Si el pase no llega, se prueba otra vez después de esto. */
const REINTENTO_PASE_MS = 10_000;
/** Cuántas vueltas de 200 filas se leen como mucho: una campaña admite 300 personas. */
const VUELTAS_DE_LECTURA = 10;
/** La sala vive unas 12 horas; el `vence` de la sala interna solo ordena la lectura. */
const VIDA_ESTIMADA_MS = 12 * 3_600_000;

const ES_EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;
const ES_SALA = /^[0-9A-Za-z]{8}$/u;
const ES_TOKEN = /^[A-Za-z0-9_-]{22}$/u;
const ES_CLAVE = /^[A-Za-z0-9_-]{22}$/u;
const esEntero = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** Lee el enlace del stand de la dirección: el evento y la sala en la búsqueda, el token del stand después del `#`. */
export function leerEnlaceDelStand(search: string, hash: string): EnlaceDelStand | null {
  const p = new URLSearchParams(search);
  const evento = p.get("c") ?? "";
  const sala = p.get("s") ?? "";
  const token = hash.replace(/^#/, "");
  if (!ES_EVENTO.test(evento) || !ES_SALA.test(sala) || !ES_TOKEN.test(token)) return null;
  return { evento, sala, token };
}

/**
 * La lista de la vista a partir de los nombres descifrados (`null` es lo que no se pudo descifrar). El orden
 * va por el número de la sala; un nombre que repite uno que ya está queda en «Para revisar», lo mismo que el
 * mirado por el filtro (`revisados`). La comparación no distingue mayúsculas, tildes ni espacios de más. Un
 * nombre que salió ilegible o que el filtro descarta no entra: se muestra con su número (`""`).
 */
export function filasDelStand(nombres: Map<number, string | null>, revisados: ReadonlySet<number> = new Set()): FilaDelStand[] {
  const vistas = new Set<string>();
  return [...nombres.keys()]
    .sort((a, b) => a - b)
    .map((n) => {
      const crudo = nombres.get(n) ?? "";
      if (crudo === "") return { n, nombre: "", revisar: false };
      const k = crudo.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
      const revisar = revisados.has(n) || vistas.has(k);
      vistas.add(k);
      return { n, nombre: crudo, revisar };
    });
}

/** La clave del QR de una sala, guardada en el navegador: sobrevive a la recarga de esta pestaña. */
export const CLAVE_DEL_STAND = (sala: string): string => `tinkazo.stand-campana.${sala}`;

/* ------------------------------------------------------------ el modelo */

export function crearStandDeCampana(enlace: EnlaceDelStand, deps: DepsDelStandDeCampana): StandDeCampana {
  const tx = (clave: string): string => deps.tx(clave);
  const dia = (falta: bigint): string => `${montoTexto(falta, deps.idioma())} ${tx("sdcDolares")}`;
  /** La sala interna: el token va en los pedidos con `Bearer`; la clave es la del stand. */
  const sala: Sala = { id: enlace.sala, token: enlace.token, clave: "", vence: deps.ahora() + VIDA_ESTIMADA_MS, servicio: deps.servicio };
  const conRed = { fetch: deps.fetch };

  let campana: Campana | null = null;
  let aviso: AvisoDelStand = { vista: "chequeando" };
  let clave: string | null = null;
  let pase: { p: string; hasta: number } | null = null;
  let paseEnCurso = false;
  /** Hasta cuándo no se vuelve a pedir el pase (una falla de la red, o la sala que repite el mismo). */
  let paseEspera = 0;
  let total = 0;
  let cierraMs: number | null = null;
  let cerrado = false;
  let caido = false;
  /** Un aviso puntual que la próxima lectura buena se lleva. */
  let puntual: string | null = null;
  /** El dato cifrado de cada fila, para descifrar solo lo que cambió. */
  const datos = new Map<number, string>();
  /** El nombre en claro de cada fila: `""` si salió ilegible o si el filtro lo descarta. */
  const nombres = new Map<number, string | null>();
  /** Las filas que el filtro marcó: quedan en «Para revisar» hasta que la sala la deje. */
  const revisados = new Set<number>();
  let leyendo = false;
  const pararCada: (() => void)[] = [];

  /** Vuelve a componer los datos y le avisa a la pantalla. */
  const notificar = (): void => {
    if (aviso.vista === "abierta" && campana !== null) aviso = { vista: "abierta", datos: datosDelProyector(campana) };
    deps.notificar(aviso);
  };

  const fallar = (texto: string): void => {
    aviso = { vista: "fallo", texto };
    deps.notificar(aviso);
  };

  const textoDeFallaDeSala = (f: FallaDeSala): string => (f === "red" ? tx("sdcSinRed") : tx("sdcSala"));

  /** La comprobación del enlace del stand antes de abrir: depósito y operadora, o el motivo exacto. */
  async function abrir(): Promise<void> {
    const lectura = await leerCampanaDeSala(sala, conRed);
    if (typeof lectura === "string") return fallar(textoDeFallaDeSala(lectura));
    campana = lectura;
    if (campana.evento !== enlace.evento) return fallar(tx("sdcOtraCampana"));
    const org = await leerOrganizadora(sala, conRed);
    // La cuenta que organizó es un texto con forma de cuenta; lo demás es una falla de la llamada.
    const organizadora = typeof org === "string" && esCuentaValida(org) ? org : null;
    if (organizadora === null) return fallar(org === "red" ? tx("sdcSinRed") : org === null ? tx("sdcSinOperadora") : tx("sdcSala"));
    const quien = deps.cuenta();
    if (quien === null) return fallar(tx("sdcSinWallet"));
    if (quien !== organizadora) return fallar(tx("sdcOtraOperadora").replace("{fin}", organizadora.slice(-4)));
    const saldo = await deps.saldo(campana.red, organizadora);
    if (saldo.tipo === "sin-red") return fallar(tx("sdcSinRed"));
    if (saldo.tipo === "sin-cuenta") return fallar(tx("sdcSinCuenta"));
    if (saldo.tipo === "sin-linea") return fallar(tx("sdcSinLinea"));
    const veredicto = leAlcanza(saldo.saldo, totalDePremios(campana.premios));
    if (veredicto.tipo === "falta") return fallar(tx("sdcFalta").replace("{falta}", dia(veredicto.falta)));
    // La clave: la que ya estaba guardada en este navegador, o una nueva que queda guardada.
    clave = leerClaveGuardada() ?? generarClave();
    guardarClaveGuardada(clave);
    aviso = { vista: "abierta", datos: datosDelProyector(campana) };
    deps.notificar(aviso);
    void leer();
    void mantenerPase();
    pararCada.push(deps.cada(() => void leer(), LISTA_CADA_MS));
    pararCada.push(deps.cada(() => void mantenerPase(), PASE_CADA_MS));
  }

  function leerClaveGuardada(): string | null {
    if (!deps.almacen) return null;
    try {
      const crudo = deps.almacen.getItem(CLAVE_DEL_STAND(enlace.sala));
      return crudo !== null && ES_CLAVE.test(crudo) ? crudo : null;
    } catch {
      return null;
    }
  }

  function guardarClaveGuardada(nueva: string): void {
    if (!deps.almacen) return;
    try {
      deps.almacen.setItem(CLAVE_DEL_STAND(enlace.sala), nueva);
    } catch {
      /* sin lugar: el stand anda igual, solo que una recarga vuelve a generar la clave */
    }
  }

  /** El enlace del celular: el evento, la sala, el pase y la red antes del `#`, y la clave después. Nunca el token. */
  function enlaceDelQr(c: Campana): string | null {
    if (!clave || !pase || cerrado) return null;
    const p = new URLSearchParams({ c: c.evento, s: sala.id, p: pase.p, red: c.red === "mainnet" ? "oficial" : "prueba" });
    return `${deps.origen()}/participar.html?${p.toString()}#${clave}`;
  }

  function datosDelProyector(c: Campana): DatosDelProyector {
    const idioma = deps.idioma();
    const filtradas = filasDelStand(nombres, revisados);
    function van(): string {
      if (total === 0) return tx("sdcVanNadie");
      if (total === 1) return tx("sdcVanUna");
      return tx("sdcVanN").replace("{n}", String(total));
    }
    return {
      titulo: c.empresa.nombre,
      logo: c.empresa.logo,
      premio: tx("sdcPremio").replace("{premio}", `${montoTexto(totalDePremios(c.premios), idioma)} ${tx("sdcDolares")}`),
      cierre: cierraMs === null ? null : tx("sdcCierre").replace("{hora}", horaTexto(cierraMs, c.zona, idioma)),
      van: van(),
      enlace: enlaceDelQr(c),
      filas: filtradas.filter((f) => !f.revisar),
      revisar: filtradas.filter((f) => f.revisar),
      cerrado,
      caido,
      aviso: puntual ?? (caido ? tx("sdcCaido") : null),
    };
  }

  /* --- el pase y la lista --- */

  /** Pide el pase cuando la ventana está por vencer: el QR se repinta solo cuando el código cambia. */
  async function mantenerPase(): Promise<void> {
    if (!campana || cerrado || paseEnCurso) return;
    const ahora = deps.ahora();
    if (ahora < paseEspera) return;
    if (pase !== null && ahora + ADELANTO_PASE_MS < pase.hasta) return;
    paseEnCurso = true;
    const r = await pedirPase(sala, conRed);
    paseEnCurso = false;
    if (typeof r === "string") {
      paseEspera = ahora + REINTENTO_PASE_MS;
      notificar();
      return;
    }
    if (pase !== null && pase.p === r.p) {
      // La sala repite el pase mientras la ventana no cruza: no lo pide de vuelta cada segundo.
      paseEspera = Math.max(paseEspera, ahora + 60_000);
      return;
    }
    paseEspera = 0;
    pase = { p: r.p, hasta: r.hasta };
    notificar();
  }

  async function leer(): Promise<void> {
    if (leyendo || !campana) return;
    leyendo = true;
    try {
      const estado = await estadoConToken(sala, conRed);
      if (typeof estado === "string") return caer();
      cerrado = estado.fase !== "lista" && estado.fase !== "abierta";
      total = estado.total;
      cierraMs = estado.cierraMs;
      const filas = await leerFilas();
      if (filas === null) return caer();
      caido = false;
      puntual = null;
      // Las filas que ya no están (se las quitó) salen de la vista.
      const vivas = new Set(filas.map((f) => f.n));
      for (const n of [...datos.keys()]) {
        if (!vivas.has(n)) {
          datos.delete(n);
          nombres.delete(n);
          revisados.delete(n);
        }
      }
      for (const f of filas) {
        if (datos.get(f.n) === f.d) continue;
        datos.set(f.n, f.d);
        await nombreDe(f.n, f.d);
      }
      notificar();
    } finally {
      leyendo = false;
    }
  }

  function caer(): void {
    caido = true;
    notificar();
  }

  /** Marca el nombre en claro del dato cifrado del celular, y si el filtro lo manda a «Para revisar». */
  async function nombreDe(n: number, d: string): Promise<void> {
    if (!clave) return;
    const e = await descifrarEquipo(clave, d).catch(() => null);
    if (e === null) {
      nombres.set(n, "");
      revisados.delete(n);
      return;
    }
    const r = revisarEquipo(e);
    if (r === null) {
      nombres.set(n, "");
      revisados.delete(n);
      return;
    }
    nombres.set(n, r.equipo.nombre);
    if (r.revisar) revisados.add(n);
    else revisados.delete(n);
  }

  /** Una vuelta de la lista del servicio, de a 200 filas, con el token. `null` si algo no se entendió. */
  async function leerFilas(): Promise<EquipoDeSala[] | null> {
    const filas: EquipoDeSala[] = [];
    let desde = 0;
    for (let vuelta = 0; vuelta < VUELTAS_DE_LECTURA; vuelta += 1) {
      let r: Response;
      try {
        r = await (deps.fetch ?? fetch)(`${sala.servicio}/v1/sala/${sala.id}/equipos?desde=${desde}`, {
          headers: { Authorization: `Bearer ${sala.token}` },
        });
      } catch {
        return null;
      }
      if (!r.ok) return null;
      const crudo = (await r.json().catch(() => null)) as unknown;
      if (!Array.isArray(crudo)) return null;
      const buenas: EquipoDeSala[] = [];
      for (const x of crudo as unknown[]) {
        const fila = filaValida(x);
        if (!fila) return null;
        buenas.push(fila);
      }
      filas.push(...buenas);
      desde = buenas.reduce((max, f) => Math.max(max, f.v), desde);
      if (buenas.length === 0) return filas;
    }
    return null;
  }

  /** Una fila de `GET equipos` tal como la sirve la sala, o `null` si no tiene la forma. */
  function filaValida(x: unknown): EquipoDeSala | null {
    if (!esObjeto(x)) return null;
    if (!esEntero(x.n) || x.n < 1 || !esEntero(x.v) || x.v < 0) return null;
    if (typeof x.d !== "string" || typeof x.estado !== "string" || !esCuentaValida(x.cuenta)) return null;
    return { n: x.n, cuenta: x.cuenta, d: x.d, estado: x.estado, v: x.v };
  }

  /* --- lo que se toca --- */

  const quitar = async (n: number, motivo: MotivoDeSalida): Promise<true | FallaDeSala> => {
    const r = await quitarConMotivo(sala, n, motivo, conRed);
    if (r === true) {
      datos.delete(n);
      nombres.delete(n);
      revisados.delete(n);
      notificar();
    } else {
      puntual = tx("sdcQuitarFalla");
      notificar();
    }
    return r;
  };

  const cerrar = async (): Promise<true | FallaDeSala> => {
    const r = await ponerFase(sala, "cerrada", null, conRed);
    if (r === true) {
      cerrado = true;
      puntual = null;
    } else {
      puntual = tx("sdcNoCerro");
    }
    notificar();
    return r;
  };

  const parar = (): void => {
    for (const p of pararCada) p();
    pararCada.length = 0;
  };

  void abrir();
  return {
    clave: () => clave,
    quitar,
    cerrar,
    repintar: () => notificar(),
    parar,
  };
}

/* ------------------------------------------------------------ lo que usa el stand en el navegador */

/**
 * Monta el stand con las dependencias de verdad: el enlace de la dirección, el reloj del navegador, la
 * billetera conectada, el saldo de la red, la clave guardada en `localStorage` y la pantalla del proyector.
 * Devuelve `null` si la dirección no trae un enlace de stand: en ese caso la página sigue como siempre.
 */
export function abrirElStandDeCampana(
  enlace: EnlaceDelStand | null = leerEnlaceDelStand(location.search, location.hash),
): StandDeCampana | null {
  if (!enlace) return null;
  const idioma = (): Lang => getLang();
  const tx = (clave: string): string => TEXTOS_STAND_CAMPANA[idioma()][clave] ?? "";
  const pantalla: { actual: PantallaDeCampana | null } = { actual: null };
  const stand = crearStandDeCampana(enlace, {
    ahora: () => Date.now(),
    cada: (f, ms) => {
      const id = window.setInterval(f, ms);
      return () => window.clearInterval(id);
    },
    qr: async (img, e, lado) => {
      await pintarQr(img, e, lado);
    },
    cuenta: () => activeWallet()?.address ?? null,
    saldo: (red, cuenta) => saldoDeLaCuenta(red, cuenta),
    idioma,
    tx,
    almacen: almacenDelNavegador(),
    origen: () => location.origin,
    servicio: servicioDeSala(),
    notificar: (aviso) => pantalla.actual?.pintar(aviso),
  });
  pantalla.actual = crearPantallaDeCampana({
    tx,
    idioma,
    qr: async (img, e, lado) => {
      await pintarQr(img, e, lado);
    },
    alQuitar: (n, motivo) => void stand.quitar(n, motivo),
    alCerrar: () => void stand.cerrar(),
  });
  // La construcción del modelo ya avisó su primera vista antes de que la pantalla exista: va de nuevo.
  stand.repintar();
  // El idioma de la página cambia: el stand compone sus textos de nuevo.
  onLangChange(() => stand.repintar());
  // Al irse la página, se apagan los timers del stand.
  addEventListener("pagehide", () => stand.parar());
  document.body.append(pantalla.actual.raiz);
  return stand;
}

/** El almacenamiento del navegador, o `null` cuando el navegador lo bloquea. */
function almacenDelNavegador(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
