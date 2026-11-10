import { normalizar } from "../buscar";
import { getLang, onLangChange, textos } from "../idioma";
import { type NetworkName, shortAddress, txUrl } from "../stellar/config";
import { type ActivoDePago, type EstadoDePago, esDireccionG, estadoDelPago, montoLegible, notaDelPremio } from "../stellar/pagos";
import type { BusquedaDePago, LectorDePagos } from "../stellar/pagos-red";
import { nombreDelEquipo } from "../equipos/etiquetas";
import { fechaLarga } from "./agrupar";

/**
 * El panel de ganadores: premio, quién ganó y cómo está el pago.
 *
 * Una fila por ganador, con su puesto, su nombre (o su cuenta acortada, cuando la lista son cuentas de Stellar) y el
 * estado de su premio, que sale de la red (`pagos-red.ts`): Pagado, Pendiente, Vencido a los 7 días del sorteo, o "sin
 * consulta" si la red no contestó. Una consulta al abrir y un botón "Actualizar". Con más de 10 ganadores, un buscador
 * por nombre y "Ver los N". En el celular cada fila es una tarjeta chica con el estado a la derecha.
 *
 * Lo comparten la pantalla del resultado (con el botón "Pagar premio" para quien organiza, que se le pasa en `pagar`) y
 * el comprobante (solo lectura). No decide nada del sorteo: los ganadores vienen ya calculados.
 *
 * Los textos se leen de `idioma.ts` (`textos`), así sirve igual en la herramienta, que tiene el diccionario entero, y en
 * verificar, que trae solo los suyos: las claves se nombran entre comillas para que el vite las ponga en esa página.
 */

/** Cuántas filas se ven sin pedir "Ver los N", y desde cuántas ganadores hay buscador. */
export const FILAS_A_LA_VISTA = 10;
/** Cuántas consultas a la red van a la vez. */
const CONSULTAS_A_LA_VEZ = 4;

export interface Ganador {
  /** El puesto del premio, desde 0 (el primero en salir). */
  puesto: number;
  /** Lo que dice la lista sellada en esa posición: un nombre, o una cuenta `G…`. */
  entrada: string;
}

/** Lo que hace falta para pagar una fila. */
export interface FilaPagable {
  puesto: number;
  cuenta: string;
  /** Cómo se la nombra a la persona: la etiqueta local o la cuenta acortada. */
  nombre: string;
  nota: string;
}

export interface OpcionesDeGanadores {
  red: NetworkName;
  /** El número del sorteo en el contrato (va en la nota del pago). */
  raffleId: string;
  premio: string;
  activo: ActivoDePago;
  ganadores: readonly Ganador[];
  /** Cuándo se sorteó (Unix, segundos): de acá se cuentan los 7 días. */
  sorteoEn: number;
  /** Los pagos anteriores a este instante (Unix, segundos) no cuentan para este sorteo. */
  desde: number;
  /** Las cuentas desde las que vale un pago. El panel lee el conjunto cada vez, así que se le pueden sumar. */
  pagadoras: ReadonlySet<string>;
  lector: LectorDePagos;
  ahora?: () => number;
  /** Cómo se llama una cuenta en este dispositivo, si se sabe (por ejemplo, el equipo que la registró). */
  etiquetaDe?: (cuenta: string) => string | undefined;
  /** Sin el título "Ganadores y premios": la página ya lo trae. */
  sinTitulo?: boolean;
  /**
   * Para quien organiza: arma el pago de una fila dentro de `caja`. Llama a `alTerminar` cuando el pago salió, para
   * que la fila vuelva a mirar la red. Sin esto, el panel es de solo lectura.
   */
  pagar?: (fila: FilaPagable, caja: HTMLElement, alTerminar: () => void) => void;
}

export interface PanelDeGanadores {
  /** Vuelve a mirar la red, para todas las filas. */
  actualizar(): Promise<void>;
  /** Cómo está cada premio ahora, por puesto. */
  estados(): ReadonlyMap<number, EstadoDeFila>;
}

export type EstadoDeFila = { tipo: "en-mano" } | { tipo: "cargando" } | EstadoDePago;

/** ¿Hay entre los ganadores alguna cuenta de Stellar? Sin una, no hay nada que pagar ni que seguir en la red. */
export const hayCuentas = (entradas: readonly string[]): boolean => entradas.some((e) => esDireccionG(e));

/**
 * Lo que este navegador sabe de cada cuenta, si algo lo guardó: el nombre del equipo que la registró. Sale de la misma
 * clave que escribe el registro de equipos (`equipos/etiquetas.ts`), no de una propia.
 */
export const etiquetaGuardada = (cuenta: string): string | undefined => nombreDelEquipo(cuenta);

/* ------------------------------------------------------------------- textos */

/** Un texto de la página en el idioma de ahora, con `{variable}` reemplazadas. */
function tx(clave: string, vars: Record<string, string | number> = {}): string {
  const v = textos(getLang())[clave];
  let s = typeof v === "string" ? v : clave;
  for (const [k, val] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(val));
  return s;
}
export { tx as textoDePagos };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/* -------------------------------------------------------------------- panel */

interface Fila {
  g: Ganador;
  cuenta: string | null;
  etiqueta: string;
  estado: EstadoDeFila;
  li: HTMLLIElement;
  quien: HTMLElement;
  est: HTMLElement;
  det: HTMLElement;
  caja: HTMLElement;
  /** "Pagar premio", si quien mira es quien organiza. */
  pagar?: HTMLButtonElement;
  /** Para buscar: el puesto, el nombre y la cuenta, sin tildes ni mayúsculas. */
  texto: string;
}

/** Los paneles vivos, para volver a escribirlos al cambiar de idioma. Los que ya no están en la página se sueltan. */
const vivos = new Set<() => void>();
/** Lo que cada raíz tiene registrado: si se vuelve a armar sobre la misma, la anterior se suelta. */
const deCadaRaiz = new WeakMap<HTMLElement, () => void>();
let oyendoIdioma = false;
export function alCambiarDeIdioma(repintar: () => void, raiz: HTMLElement): () => void {
  const f = (): void => {
    if (!raiz.isConnected) vivos.delete(f);
    else repintar();
  };
  const anterior = deCadaRaiz.get(raiz);
  if (anterior) vivos.delete(anterior);
  deCadaRaiz.set(raiz, f);
  vivos.add(f);
  if (!oyendoIdioma) {
    oyendoIdioma = true;
    onLangChange(() => vivos.forEach((fn) => fn()));
  }
  return f;
}

export function montarGanadores(raiz: HTMLElement, op: OpcionesDeGanadores): PanelDeGanadores {
  const ahora = op.ahora ?? ((): number => Math.floor(Date.now() / 1000));
  const etiquetaDe = op.etiquetaDe ?? etiquetaGuardada;
  raiz.replaceChildren();
  raiz.classList.add("gan");

  /* ---- las filas, creadas una vez: así un formulario abierto no se pierde cuando cambia un estado */
  const filas: Fila[] = op.ganadores.map((g) => {
    const cuenta = esDireccionG(g.entrada) ? g.entrada : null;
    const etiqueta = cuenta ? (etiquetaDe(cuenta) ?? "") : "";
    const li = el("li", "gan-fila");
    li.dataset.puesto = String(g.puesto);
    const n = el("span", "gan-n", `#${g.puesto + 1}`);
    const quien = el("span", "gan-quien");
    const est = el("span", "gan-est");
    const det = el("span", "gan-det");
    const caja = el("div", "gan-pago");
    li.append(n, quien, est, det, caja);
    const mostrado = cuenta ? (etiqueta || shortAddress(cuenta)) : g.entrada;
    return {
      g,
      cuenta,
      etiqueta,
      estado: cuenta ? { tipo: "cargando" } : { tipo: "en-mano" },
      li,
      quien,
      est,
      det,
      caja,
      texto: normalizar(`${g.puesto + 1} ${mostrado} ${cuenta ?? ""}`),
    };
  });
  const conCuenta = filas.filter((f) => f.cuenta !== null);

  /* ---- el armazón */
  const cab = el("div", "gan-cab");
  const titulo = el("h3", "gan-titulo");
  titulo.id = `gan-t-${op.raffleId}`;
  if (op.sinTitulo) titulo.hidden = true;
  const premio = el("p", "gan-premio");
  const resumen = el("p", "gan-resumen");
  resumen.setAttribute("role", "status");
  cab.append(titulo, premio, resumen);

  const barra = el("div", "gan-barra");
  const buscador = el("input", "gan-buscar");
  buscador.type = "search";
  buscador.autocomplete = "off";
  buscador.hidden = filas.length <= FILAS_A_LA_VISTA;
  const actualizarBtn = el("button", "ghost gan-actualizar");
  actualizarBtn.type = "button";
  barra.append(buscador, actualizarBtn);

  const lista = el("ol", "gan-lista");
  lista.setAttribute("aria-labelledby", titulo.id);
  for (const f of filas) lista.append(f.li);
  const nadie = el("p", "note gan-nadie");
  nadie.hidden = true;
  const verTodos = el("button", "ghost gan-vertodos");
  verTodos.type = "button";
  verTodos.hidden = filas.length <= FILAS_A_LA_VISTA;
  const nota = el("p", "note gan-nota");
  raiz.append(cab, barra, lista, nadie, verTodos, nota);

  let expandido = false;
  let actualizando = false;

  /* ---- lo que se ve de cada estado */
  function pintarFila(f: Fila): void {
    const s = f.estado;
    f.quien.replaceChildren();
    if (f.cuenta) {
      f.quien.append(el("b", "gan-nombre", f.etiqueta || shortAddress(f.cuenta)));
      if (f.etiqueta) f.quien.append(" ", el("span", "gan-cuenta mono", shortAddress(f.cuenta)));
      f.quien.title = f.cuenta;
    } else f.quien.append(el("b", "gan-nombre", f.g.entrada));

    f.est.className = `gan-est ${s.tipo}`;
    f.det.replaceChildren();
    switch (s.tipo) {
      case "en-mano":
        f.est.textContent = tx("pgEstEnMano");
        break;
      case "cargando":
        f.est.textContent = tx("pgConsultando");
        break;
      case "pagado": {
        f.est.textContent = tx("pgEstPagado");
        f.det.append(tx("pgDetPagado", { monto: montoLegible(s.monto), activo: op.activo.code, fecha: fechaLarga(s.cuando, getLang()) }), " ");
        const a = el("a", "gan-enlace", tx("pgVerPago"));
        a.href = txUrl(s.hash, op.red);
        a.target = "_blank";
        a.rel = "noopener";
        f.det.append(a);
        break;
      }
      case "pendiente":
        f.est.textContent = tx("pgEstPendiente");
        f.det.textContent = tx("pgDetPendiente", { fecha: fechaLarga(s.vence, getLang()) });
        break;
      case "vencido":
        f.est.textContent = tx("pgEstVencido");
        f.det.textContent = tx("pgDetVencido", { fecha: fechaLarga(s.vence, getLang()) });
        break;
      case "sin-consulta":
        f.est.textContent = tx("pgEstSinConsulta");
        f.det.textContent = tx("pgDetSinConsulta");
        break;
    }
    f.det.hidden = f.det.childNodes.length === 0;
    // Un premio que ya se pagó, o que todavía se está mirando, no se paga desde acá.
    if (f.pagar) {
      f.pagar.textContent = tx("pgPagar");
      f.pagar.hidden = s.tipo === "pagado" || s.tipo === "cargando";
    }
  }

  function pintarCabecera(): void {
    titulo.textContent = tx("pgTitulo");
    premio.textContent = op.premio ? tx("pgPremio", { premio: op.premio }) : "";
    premio.hidden = !op.premio;
    const pagados = conCuenta.filter((f) => f.estado.tipo === "pagado").length;
    resumen.textContent = conCuenta.length ? tx("pgResumen", { p: pagados, n: conCuenta.length }) : "";
    buscador.placeholder = tx("pgBuscar");
    buscador.setAttribute("aria-label", tx("pgBuscar"));
    actualizarBtn.textContent = actualizando ? tx("pgActualizando") : tx("pgActualizar");
    actualizarBtn.disabled = actualizando;
    actualizarBtn.hidden = conCuenta.length === 0;
    verTodos.textContent = expandido ? tx("pgVerMenos") : tx("pgVerTodos", { n: filas.length });
    nadie.textContent = tx("pgNadie");
    nota.textContent = conCuenta.length ? tx("pgNotaLeer") : "";
  }

  function pintarTodo(): void {
    pintarCabecera();
    for (const f of filas) pintarFila(f);
  }

  /** Cuáles filas se ven: las primeras diez, todas con "Ver los N", o las que coinciden con lo que se busca. */
  function aplicarVisibilidad(): void {
    const q = normalizar(buscador.value);
    let vistas = 0;
    filas.forEach((f, i) => {
      const dentro = q ? f.texto.includes(q) : expandido || i < FILAS_A_LA_VISTA;
      f.li.hidden = !dentro;
      if (dentro) vistas++;
    });
    nadie.hidden = !(q && vistas === 0);
    verTodos.hidden = filas.length <= FILAS_A_LA_VISTA || q !== "";
  }

  /* ---- la red */
  const busquedaDe = (f: Fila): BusquedaDePago => ({
    red: op.red,
    destino: f.cuenta as string,
    activo: op.activo,
    nota: notaDelPremio(op.raffleId, f.g.puesto),
    pagadoras: [...op.pagadoras],
    desde: op.desde,
  });

  async function consultar(f: Fila, forzar: boolean): Promise<void> {
    if (!f.cuenta) return;
    let busqueda: BusquedaDePago;
    try {
      busqueda = busquedaDe(f);
    } catch {
      f.estado = { tipo: "en-mano" };
      pintarFila(f);
      return;
    }
    let lectura;
    try {
      lectura = await op.lector(busqueda, forzar);
    } catch {
      lectura = { tipo: "sin-consulta" } as const;
    }
    f.estado = estadoDelPago(lectura, op.sorteoEn, ahora());
    pintarFila(f);
    pintarCabecera();
  }

  async function consultarTodas(forzar: boolean): Promise<void> {
    const pendientes = [...conCuenta];
    const trabajador = async (): Promise<void> => {
      for (let f = pendientes.shift(); f; f = pendientes.shift()) await consultar(f, forzar);
    };
    await Promise.all(Array.from({ length: Math.min(CONSULTAS_A_LA_VEZ, pendientes.length) }, trabajador));
  }

  async function actualizar(): Promise<void> {
    if (actualizando) return;
    actualizando = true;
    pintarCabecera();
    try {
      await consultarTodas(true);
    } finally {
      actualizando = false;
      pintarCabecera();
    }
  }

  /* ---- el botón "Pagar premio" de quien organiza */
  if (op.pagar) {
    for (const f of conCuenta) {
      const cuenta = f.cuenta as string;
      const btn = el("button", "ghost gan-pagar");
      btn.type = "button";
      f.pagar = btn;
      f.li.insertBefore(btn, f.caja);
      btn.addEventListener("click", () => {
        let nota: string;
        try {
          nota = notaDelPremio(op.raffleId, f.g.puesto);
        } catch {
          return;
        }
        op.pagar?.({ puesto: f.g.puesto, cuenta, nombre: f.etiqueta || shortAddress(cuenta), nota }, f.caja, () => {
          // El pago acaba de salir: la red lo muestra en unos segundos.
          setTimeout(() => void consultar(f, true), 2500);
        });
      });
    }
  }

  buscador.addEventListener("input", aplicarVisibilidad);
  verTodos.addEventListener("click", () => {
    expandido = !expandido;
    pintarCabecera();
    aplicarVisibilidad();
  });
  actualizarBtn.addEventListener("click", () => void actualizar());
  alCambiarDeIdioma(pintarTodo, raiz);

  pintarTodo();
  aplicarVisibilidad();
  // Una consulta al abrir; después, solo "Actualizar".
  void consultarTodas(false);

  return {
    actualizar,
    estados: () => new Map(filas.map((f) => [f.g.puesto, f.estado])),
  };
}
