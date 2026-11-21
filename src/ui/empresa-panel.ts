/**
 * Entrada de empresa.html: el panel de la empresa aliada, para que cada empresa
 * arme y ajuste sus campañas sola, con clics y nada más: su cuenta y su saldo,
 * los eventos con botones y calendario, los premios con botones, los pasos como
 * tarjetas, la vista previa del celular en los dos idiomas, y publicar y
 * depositar con su billetera. La lógica vive en `src/empresa/`, pura y con sus
 * pruebas; este archivo solo dibuja y reparte lo que pasa, como
 * `src/crear-campana.ts` hace con el creador.
 */

import { freighterWallet } from "../stellar/wallet";
import type { WalletAdapter } from "../stellar/wallet-lite";
import { network } from "../stellar/config";
import { passphraseDe } from "../stellar/oficiales";
import { notaDeLaComision } from "../campana/comision";
import { comisionDelBuild } from "../stellar/comision-config";
import { zonaDelNavegador } from "../campana/crear/horas";
import { aprobarYEnviar, LAB_FIRMAR } from "../equipos/envio";
import { getLang, initialLang, onLangChange, setLang } from "../idioma";
import "../pagina";
import "../version-nueva";
import {
  DEPARTAMENTOS,
  HORAS_DE_CIERRE,
  MAXIMO_DE_EVENTOS,
  OTRA_CIUDAD,
  diasDelCalendario,
  eventosIniciales,
  lugarTexto,
  reducirEventos,
  type EventoDeEmpresa,
} from "../empresa/eventos";
import type { PremiosDelPanel } from "../empresa/premios";
import { costosDeLaCampana, premiosIniciales, reducirPremios, textoDeDolares } from "../empresa/premios";
import type { PasoDeEmpresa } from "../empresa/pasos";
import { TIPOS_EN_ORDEN, pasosIniciales, reducirPasos } from "../empresa/pasos";
import { vistaDelCelular } from "../empresa/vista";
import { enlaceDeLaEmpresa, leerEnlaceDeLaEmpresa } from "../empresa/enlace";
import type { SaldoDeLaEmpresa } from "../empresa/saldo";
import { leAlcanza, saldoDeLaEmpresa } from "../empresa/saldo";
import { nombreDeLaEmpresa, publicarLaCampana, sufijoNuevo } from "../empresa/publicar";
import { datosParaStellarLab, prepararElDeposito, type PreparacionDelDeposito } from "../empresa/deposito";
import { MONTOS_DEL_PAGO, estadoDelInforme } from "../empresa/informe";
import { TEXTOS_EMPRESA } from "../empresa/textos";
import { stripInvisibles } from "../invisibles";

/* ------------------------------------------------------------------ textos */

type Huecos = Record<string, string | number>;

/** El texto de una clave del panel, en el idioma de la página, con sus huecos puestos. */
function tx(clave: string, huecos: Huecos = {}): string {
  const idioma = getLang() === "en" ? TEXTOS_EMPRESA.en : TEXTOS_EMPRESA.es;
  const base = idioma[clave] ?? TEXTOS_EMPRESA.es[clave] ?? clave;
  return base.replace(/\{([a-z]+)\}/gu, (_, k: string) => String(huecos[k] ?? ""));
}

/* --------------------------------------------------------------- ayuda de DOM */

const porId = (id: string): HTMLElement | null => document.getElementById(id);

function limpiar(nodo: HTMLElement): void {
  for (const n of [...nodo.childNodes]) n.remove();
}

function hijo(padre: HTMLElement, etiqueta: string, clase?: string): HTMLElement {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  padre.append(n);
  return n;
}

function boton(padre: HTMLElement, id: string, clave: string, huecos: Huecos = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.textContent = tx(clave, huecos);
  padre.append(b);
  return b;
}

function texto(nodo: HTMLElement, clave: string, huecos: Huecos = {}): void {
  nodo.textContent = tx(clave, huecos);
}

function etiqueta(padre: HTMLElement, clave: string, huecos: Huecos = {}): HTMLElement {
  const e = hijo(padre, "span", "epi-etiqueta");
  texto(e, clave, huecos);
  return e;
}

/** baja un texto como archivo, como en `src/crear-campana.ts`. */
function bajarTexto(nombre: string, contenido: string): void {
  const direccion = URL.createObjectURL(new Blob([contenido], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = direccion;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(direccion), 10_000);
}

function diaLegible(fecha: string): string {
  const ms = Date.parse(`${fecha}T12:00:00Z`);
  if (Number.isNaN(ms)) return fecha;
  const idioma = getLang() === "en" ? "en-US" : "es-BO";
  return new Intl.DateTimeFormat(idioma, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(ms));
}

/* ------------------------------------------------------------------- estado */

const zona = zonaDelNavegador();
const cobro = comisionDelBuild({ ...(import.meta.env as Record<string, unknown>) });

interface EstadoDelPanel {
  cuenta: string;
  saldo: SaldoDeLaEmpresa | null;
  saldoEnVuelo: boolean;
  eventos: EventoDeEmpresa[];
  premios: PremiosDelPanel;
  pasos: PasoDeEmpresa[];
  sufijo: string;
  publicada: { texto: string; evento: string; clave: string } | null;
  deposito: PreparacionDelDeposito | null;
  orgMonto: number | null;
  orgCuenta: string;
}

const estado: EstadoDelPanel = {
  cuenta: "",
  saldo: null,
  saldoEnVuelo: false,
  eventos: eventosIniciales(),
  premios: premiosIniciales(),
  pasos: pasosIniciales(),
  sufijo: sufijoNuevo(),
  publicada: null,
  deposito: null,
  orgMonto: null,
  orgCuenta: "",
};

/** La billetera solo paga si la cuenta que firmó es la del panel. */
const cuentaQuePaga = (): WalletAdapter | null => (freighterWallet.address !== null && freighterWallet.address === estado.cuenta ? freighterWallet : null);

const CLAVE_DE_GUARDADO = "tinkazo.empresa.panel.v1";

function guardarBorrador(): void {
  try {
    if (!estado.publicada) {
      localStorage.removeItem(CLAVE_DE_GUARDADO);
      return;
    }
    localStorage.setItem(CLAVE_DE_GUARDADO, JSON.stringify(estado.publicada));
  } catch {
    /* el navegador no deja: la campaña se queda en esta pestaña */
  }
}

function leerBorrador(): EstadoDelPanel["publicada"] {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_DE_GUARDADO) ?? "null") as unknown;
    if (
      typeof crudo === "object" && crudo !== null &&
      typeof (crudo as Record<string, unknown>).texto === "string" &&
      typeof (crudo as Record<string, unknown>).evento === "string" &&
      typeof (crudo as Record<string, unknown>).clave === "string"
    ) {
      return crudo as { texto: string; evento: string; clave: string };
    }
  } catch {
    /* nada guardado */
  }
  return null;
}

/** Lo que cuesta lo que el panel tiene elegido, o null si todavía falta elegir el monto. */
function costos(): { premios: bigint; comision: bigint; total: bigint } | null {
  if (estado.premios.monto === null) return null;
  return costosDeLaCampana(
    { monto: estado.premios.monto, ganan: estado.premios.ganan },
    cobro ? { pb: cobro.pb, minimo: cobro.minimo } : null,
  );
}

/* ------------------------------------------------------------- la cuenta y el saldo */

function conectarBilletera(): void {
  void (async () => {
    try {
      estado.cuenta = (await freighterWallet.connect()) || "";
    } catch {
      estado.cuenta = "";
    }
    await mirarElSaldo();
  })();
}

async function mirarElSaldo(): Promise<void> {
  if (!estado.cuenta) return;
  estado.saldoEnVuelo = true;
  pintarSaldo();
  estado.saldo = await saldoDeLaEmpresa(network.name, estado.cuenta, {});
  estado.saldoEnVuelo = false;
  pintarSaldo();
}

function pintarSaldo(): void {
  const caja = porId("epi-saldo");
  if (!caja) return;
  limpiar(caja);
  const linea = hijo(caja, "p", "epi-estado");
  const s = estado.saldo;
  if (estado.saldoEnVuelo) texto(linea, "epiMirando");
  else if (!s) texto(linea, "epiSinRed");
  else if (s.tipo === "sin-red") texto(linea, "epiSinRed");
  else if (s.tipo === "sin-cuenta") texto(linea, "epiSinCuenta");
  else if (s.tipo === "sin-linea") texto(linea, "epiSinLinea");
  else {
    const total = costos();
    if (!total) {
      texto(linea, "epiSinSaldo");
    } else {
      const alcanza = leAlcanza(s.saldo, total.total);
      texto(
        linea,
        alcanza.tipo === "alcanza" ? "epiSaldoAlcanza" : "epiSaldoFalta",
        alcanza.tipo === "alcanza"
          ? { saldo: textoDeDolares(s.saldo), total: textoDeDolares(total.total) }
          : { saldo: textoDeDolares(s.saldo), total: textoDeDolares(total.total), falta: textoDeDolares(alcanza.falta) },
      );
      linea.classList.add(alcanza.tipo === "alcanza" ? "epi-bien" : "epi-falta");
    }
  }
  if (estado.cuenta) {
    const fin = hijo(caja, "p", "epi-cuenta-mostrada");
    fin.textContent = tx("epiCuentaPegada", { fin: estado.cuenta.slice(-4) });
  }
}

/* ----------------------------------------------------------------- los eventos */

function pintarEventos(): void {
  const caja = porId("epi-eventos");
  if (!caja) return;
  limpiar(caja);
  const dias = diasDelCalendario(Date.now(), zona);
  estado.eventos.forEach((e, i) => {
    const tarjeta = hijo(caja, "div", "epi-tarjeta");
    const filaUno = hijo(tarjeta, "div", "epi-fila");
    etiqueta(filaUno, "epiEventoNo", { n: i + 1 });
    const quitar = boton(filaUno, `epi-evento-quitar-${i}`, "epiQuitarEvento");
    quitar.hidden = estado.eventos.length <= 1;
    quitar.onclick = () => {
      estado.eventos = reducirEventos(estado.eventos, { tipo: "quitar", n: i });
      pintarEventos();
    };

    const filaCiudad = hijo(tarjeta, "div", "epi-fila");
    etiqueta(filaCiudad, "epiCiudad");
    const ciudad = document.createElement("select");
    ciudad.id = `epi-evento-ciudad-${i}`;
    for (const d of [...DEPARTAMENTOS, OTRA_CIUDAD]) {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d === OTRA_CIUDAD ? tx("epiCiudadOtra") : d;
      if (e.ciudad === d) o.selected = true;
      ciudad.append(o);
    }
    ciudad.onchange = () => {
      estado.eventos = reducirEventos(estado.eventos, { tipo: "ciudad", n: i, v: ciudad.value });
      pintarEventos();
    };
    filaCiudad.append(ciudad);

    const filaLugar = hijo(tarjeta, "div", "epi-fila");
    etiqueta(filaLugar, "epiLugar");
    const lugar = document.createElement("input");
    lugar.id = `epi-evento-lugar-${i}`;
    lugar.type = "text";
    lugar.value = e.lugar;
    lugar.placeholder = tx("epiLugarPh");
    lugar.oninput = () => {
      estado.eventos = reducirEventos(estado.eventos, { tipo: "lugar", n: i, v: lugar.value });
      void pintarVista();
    };
    filaLugar.append(lugar);

    const filaDia = hijo(tarjeta, "div", "epi-fila");
    etiqueta(filaDia, "epiDia");
    for (const d of dias) {
      const b = boton(filaDia, `epi-evento-dia-${i}-${d}`, "epiDiaHoy");
      b.textContent = d;
      b.classList.toggle("on", e.dia === d);
      b.onclick = () => {
        estado.eventos = reducirEventos(estado.eventos, { tipo: "dia", n: i, v: d });
        pintarEventos();
        void pintarVista();
      };
    }

    const filaCierre = hijo(tarjeta, "div", "epi-fila");
    etiqueta(filaCierre, "epiCierre");
    const cierre = document.createElement("select");
    cierre.id = `epi-evento-cierre-${i}`;
    for (const h of HORAS_DE_CIERRE) {
      const o = document.createElement("option");
      o.value = h;
      o.textContent = h;
      if (e.cierre === h) o.selected = true;
      cierre.append(o);
    }
    cierre.onchange = () => {
      estado.eventos = reducirEventos(estado.eventos, { tipo: "cierre", n: i, v: cierre.value });
    };
    filaCierre.append(cierre);

    const filaCupo = hijo(tarjeta, "div", "epi-fila");
    etiqueta(filaCupo, "epiCupo");
    boton(filaCupo, `epi-evento-cupo-menos-${i}`, "epiMenos").onclick = () => {
      estado.eventos = reducirEventos(estado.eventos, { tipo: "cupo-menos", n: i });
      pintarEventos();
    };
    const cuento = hijo(filaCupo, "span", "epi-contador");
    cuento.textContent = tx("epiCupoPersonas", { cupo: e.cupo });
    boton(filaCupo, `epi-evento-cupo-mas-${i}`, "epiMas").onclick = () => {
      estado.eventos = reducirEventos(estado.eventos, { tipo: "cupo-mas", n: i });
      pintarEventos();
    };
  });
  const pw = porId("epi-evento-agregar");
  if (pw) pw.hidden = estado.eventos.length >= MAXIMO_DE_EVENTOS;
}

/* ------------------------------------------------------------------ los premios */

function pintarPremios(): void {
  const caja = porId("epi-premios");
  if (!caja) return;
  limpiar(caja);
  const p = estado.premios;

  const filaGanan = hijo(caja, "div", "epi-fila");
  etiqueta(filaGanan, "epiGananTitulo");
  boton(filaGanan, "epi-ganan-menos", "epiMenos").onclick = () => {
    estado.premios = reducirPremios(estado.premios, { tipo: "ganan-menos" });
    pintarPremios();
  };
  const ganan = hijo(filaGanan, "span", "epi-contador");
  ganan.textContent = tx("epiGananPersonas", { ganan: p.ganan });
  boton(filaGanan, "epi-ganan-mas", "epiMas").onclick = () => {
    estado.premios = reducirPremios(estado.premios, { tipo: "ganan-mas" });
    pintarPremios();
  };

  const filaMonto = hijo(caja, "div", "epi-fila");
  etiqueta(filaMonto, "epiMontoTitulo");
  boton(filaMonto, "epi-monto-menos", "epiMenos").onclick = () => {
    estado.premios = reducirPremios(estado.premios, { tipo: "monto-menos" });
    pintarPremios();
  };
  const monto = hijo(filaMonto, "span", "epi-contador");
  monto.textContent = p.monto === null ? tx("epiSinMonto") : tx("epiMontoDolares", { monto: p.monto });
  boton(filaMonto, "epi-monto-mas", "epiMas").onclick = () => {
    estado.premios = reducirPremios(estado.premios, { tipo: "monto-mas" });
    pintarPremios();
  };

  const filaTotal = hijo(caja, "div", "epi-totales");
  const c = costos();
  if (c) {
    const renglon = (clave: string, stroops: bigint): void => {
      const tr = hijo(filaTotal, "div", "epi-fila-total");
      etiqueta(tr, clave);
      hijo(tr, "span").textContent = tx("epiMontoDolares", { monto: textoDeDolares(stroops) });
    };
    renglon("epiTotalesPremios", c.premios);
    if (c.comision > 0n) renglon("epiTotalesServicio", c.comision);
    else texto(hijo(filaTotal, "p", "epi-nota"), "epiSinCobro");
    const tr = hijo(filaTotal, "div", "epi-fila-total epi-total-grande");
    etiqueta(tr, "epiTotalesTotal");
    hijo(tr, "span").textContent = tx("epiMontoDolares", { monto: textoDeDolares(c.total) });
  }
  pintarSaldo();
}

/* ---------------------------------------------------------- los pasos como tarjetas */

function pintarPasos(): void {
  const caja = porId("epi-pasos");
  if (!caja) return;
  limpiar(caja);
  estado.pasos.forEach((paso, i) => {
    const tarjeta = hijo(caja, "div", "epi-tarjeta");
    const fila = hijo(tarjeta, "div", "epi-fila");
    const tipo = document.createElement("select");
    tipo.id = `epi-paso-tipo-${i}`;
    for (const t of TIPOS_EN_ORDEN) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t === "enlace" ? tx("epiTipoEnlace") : t === "x" ? "X" : t.charAt(0).toUpperCase() + t.slice(1);
      if (paso.tipo === t) o.selected = true;
      tipo.append(o);
    }
    tipo.onchange = () => {
      estado.pasos = reducirPasos(estado.pasos, [
        { tipo: "quitar", n: i },
        { tipo: "agregar", tipoDePaso: tipo.value as PasoDeEmpresa["tipo"] },
      ]);
      pintarPasos();
    };
    fila.append(tipo);
    boton(fila, `epi-paso-subir-${i}`, "epiPasoSubir").onclick = () => {
      estado.pasos = reducirPasos(estado.pasos, { tipo: "subir", n: i });
      pintarPasos();
    };
    boton(fila, `epi-paso-bajar-${i}`, "epiPasoBajar").onclick = () => {
      estado.pasos = reducirPasos(estado.pasos, { tipo: "bajar", n: i });
      pintarPasos();
    };
    boton(fila, `epi-paso-quitar-${i}`, "epiPasoQuitar").onclick = () => {
      estado.pasos = reducirPasos(estado.pasos, { tipo: "quitar", n: i });
      pintarPasos();
    };
    const url = hijo(tarjeta, "div", "epi-fila");
    etiqueta(url, "epiPasoUrl");
    const campo = document.createElement("input");
    campo.id = `epi-paso-url-${i}`;
    campo.type = "url";
    campo.value = paso.url;
    campo.placeholder = tx("epiPasoUrlPh");
    campo.onchange = () => {
      estado.pasos = reducirPasos(estado.pasos, { tipo: "url", n: i, url: campo.value });
      pintarPasos();
      void pintarVista();
    };
    url.append(campo);
    const salida = hijo(tarjeta, "div", "epi-fila");
    etiqueta(salida, paso.url !== "" ? "epiPasoUrlVale" : "epiPasoUrlMal");
    if (paso.url !== "") hijo(salida, "p", "epi-cita").textContent = `${paso.texto.es} · ${paso.texto.en}`;
  });
  const pw = porId("epi-paso-agregar");
  if (pw) pw.hidden = estado.pasos.length >= 8;
}

/* ----------------------------------------------------------- la vista del celular */

function pintarVista(): void {
  const cajaEs = porId("epi-vista-es");
  const cajaEn = porId("epi-vista-en");
  if (!cajaEs || !cajaEn) return;
  void cajaEn;
  const campo = porId("epi-nombre") as HTMLInputElement | null;
  const nombre = nombreDeLaEmpresa(campo?.value ?? "");
  const c = costos();
  const conPremio = estado.premios.monto === null ? null : tx("epiVistaPremioGana", { monto: estado.premios.monto, ganan: estado.premios.ganan });
  const primera = estado.eventos.find((e) => e.dia !== null);
  const datos = (): Parameters<typeof vistaDelCelular>[0] => ({
    empresa: nombre,
    cuando: primera?.dia ? diaLegible(primera.dia) : null,
    lugar: primera ? lugarTexto(primera) || null : null,
    cierre: primera?.cierre ?? null,
    premio: conPremio,
    premios: c ? tx("epiMontoDolares", { monto: textoDeDolares(c.premios) }) : null,
    pasos: estado.pasos.map((p) => ({ texto: p.texto })),
  });
  const pintar = (caja: HTMLElement, idioma: "es" | "en"): void => {
    limpiar(caja);
    const lineas = vistaDelCelular(datos(), idioma);
    if (idioma === "es" && nombre === "") {
      texto(caja, "epiVistaVacio");
      return;
    }
    const lista = hijo(caja, "ol", "epi-vista-lista");
    for (const l of lineas) hijo(lista, "li").textContent = l;
  };
  pintar(cajaEs, "es");
  pintar(cajaEn, "en");
}

/* --------------------------------------------------------------------- publicar */

function pintarPublicar(): void {
  const caja = porId("epi-publicada");
  if (!caja) return;
  limpiar(caja);
  if (!estado.publicada) return;
  const linea = hijo(caja, "p", "epi-estado epi-bien");
  texto(linea, "epiPublicada");
  const enlace = enlaceDeLaEmpresa(estado.publicada.evento, estado.publicada.clave, location.origin);
  const a = hijo(caja, "a", "epi-enlace") as HTMLAnchorElement;
  a.textContent = enlace;
  a.href = enlace;
  boton(caja, "epi-bajar", "epiPublicarBajar").onclick = () =>
    bajarTexto(`${estado.publicada?.evento ?? "campana"}.json`, estado.publicada?.texto ?? "");
}

function nombreValido(): string {
  const campo = porId("epi-nombre") as HTMLInputElement | null;
  const valor = nombreDeLaEmpresa(campo?.value ?? "");
  if (campo) campo.value = valor;
  return valor;
}

async function publicar(): Promise<void> {
  const aviso = porId("epi-publicar-aviso");
  if (aviso) aviso.textContent = tx("epiPublicando");
  const creada = publicarLaCampana(
    {
      nombre: nombreValido(),
      eventos: estado.eventos,
      premios: estado.premios,
      pasos: estado.pasos,
      sufijo: estado.sufijo,
    },
    network.name,
    zona,
    Date.now(),
  );
  if (!creada.ok) {
    if (aviso) aviso.textContent = tx(creada.motivo === "nombre" ? "epiFaltaNombre" : creada.motivo === "premios" ? "epiFaltaPremios" : "epiFaltaHoras");
    return;
  }
  estado.publicada = { texto: creada.texto, evento: creada.evento, clave: creada.clave };
  estado.sufijo = sufijoNuevo();
  guardarBorrador();
  if (aviso) aviso.textContent = "";
  pintarPublicar();
  pintarInforme();
  await prepararElDepositoDeLaCampana();
}

/* -------------------------------------------------------------------- depositar */

async function prepararElDepositoDeLaCampana(): Promise<void> {
  if (!estado.publicada || !cobro) return;
  const c = costos();
  if (!c) return;
  estado.deposito = await prepararElDeposito(
    {
      red: network.name,
      origen: estado.cuenta,
      destino: cobro.cuenta,
      monto: c.total,
      nota: notaDeLaComision(estado.publicada.evento),
    },
    {},
  );
  pintarDeposito();
}

function pintarDeposito(): void {
  const caja = porId("epi-deposito-caja");
  if (!caja) return;
  limpiar(caja);
  if (!estado.publicada) return;
  const c = costos();
  if (!c) return;
  const d = estado.deposito;
  if (!d) {
    texto(hijo(caja, "p", "epi-estado"), cobro ? "epiMirando" : "epiSinCobro");
    return;
  }
  if (!d.ok) {
    const linea = hijo(caja, "p", "epi-estado epi-falta");
    texto(linea, d.motivo === "origen-sin-saldo" ? "epiFaltaSaldo" : "epiDepositoFallo", d.saldo ? { saldo: d.saldo } : {});
    return;
  }
  texto(hijo(caja, "p", "epi-estado"), "epiListoParaFirmar", { total: d.monto });
  const fila = hijo(caja, "div", "epi-fila");
  boton(fila, "epi-firmar", "epiDepositar", { total: textoDeDolares(c.total) }).onclick = () => void firmarElDeposito(d.xdr);
  boton(fila, "epi-lab", "epiFirmarLab").onclick = () => {
    window.open(datosParaStellarLab(d.xdr, estado.cuenta, network.name).url, "_blank", "noopener");
  };
}

async function firmarElDeposito(xdr: string): Promise<void> {
  const caja = porId("epi-deposito-caja");
  if (!caja) return;
  const r = await aprobarYEnviar(xdr, estado.cuenta, { billetera: cuentaQuePaga(), passphrase: passphraseDe(network.name) });
  limpiar(caja);
  const linea = hijo(caja, "p", "epi-estado");
  if (r.tipo === "enviado") texto(linea, "epiDepositoBien");
  else if (r.tipo === "a-mano") {
    texto(linea, "epiSinBilletera");
    const lab = hijo(caja, "a", "epi-enlace") as HTMLAnchorElement;
    lab.href = `${LAB_FIRMAR}?tx=${encodeURIComponent(r.xdr)}`;
    lab.textContent = tx("epiFirmarLab");
  } else if (r.tipo === "fallo" && r.motivo === "otra-red") texto(linea, "epiBilleteraOtraRed");
  else if (r.tipo === "fallo" && r.motivo === "cancelada") texto(linea, "epiBilleteraCancelo");
  else texto(linea, "epiDepositoFallo");
}

/* ---------------------------------------------------------------------- informe */

function pintarInforme(): void {
  const caja = porId("epi-informe");
  if (!caja) return;
  limpiar(caja);
  if (!estado.publicada) {
    texto(hijo(caja, "p", "epi-nota"), "epiInformeSinCampana");
    pintarOrganizador();
    return;
  }
  try {
    const campana = JSON.parse(estado.publicada.texto) as unknown;
    const crudo = campana as { estado?: unknown; anotadas?: unknown };
    const informe = estadoDelInforme({
      estado: String(crudo.estado ?? "borrador"),
      anotadas: Number(crudo.anotadas ?? 0),
      ganadoras: ganadorasDe(campana),
    });
    if (informe.tipo === "sin-campana") texto(hijo(caja, "p", "epi-nota"), "epiInformeSinCampana");
    else if (informe.tipo === "parcial-abierto" || informe.tipo === "parcial-cerrado") {
      texto(hijo(caja, "p", "epi-nota"), "epiInformeParciales", { anotadas: informe.anotadas, cupo: estado.eventos[0]?.cupo ?? 0 });
    } else {
      texto(hijo(caja, "p", "epi-nota"), "epiInformeParciales", { anotadas: informe.anotadas, cupo: estado.eventos[0]?.cupo ?? 0 });
      texto(hijo(caja, "p", "epi-subtitulo"), "epiInformeGanadores");
      const lista = hijo(caja, "ol", "epi-vista-lista");
      for (const g of informe.ganadoras) {
        hijo(lista, "li").textContent = `${g.nombre} — ${g.pagada ? tx("epiInformePagada") : tx("epiInformePendiente")}`;
      }
    }
  } catch {
    texto(hijo(caja, "p", "epi-nota"), "epiInformeSinCampana");
  }
  pintarOrganizador();
}

/** Las ganadoras que la campaña publique después traerá; una campaña recién publicada no trae ninguna. */
function ganadorasDe(campana: unknown): { cuenta: string; nombre: string; premia: boolean; pagada: boolean }[] {
  if (typeof campana !== "object" || campana === null) return [];
  const ganadoras = (campana as { ganadoras?: unknown }).ganadoras;
  if (!Array.isArray(ganadoras)) return [];
  return ganadoras
    .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
    .map((g) => ({
      cuenta: String(g.cuenta ?? ""),
      nombre: String(g.nombre ?? ""),
      premia: g.premia !== false,
      pagada: g.pagada === true,
    }));
}

/* ------------------------------------------------------ el pago a quien organizó */

function pintarOrganizador(): void {
  const caja = porId("epi-organizador");
  if (!caja) return;
  limpiar(caja);
  const fila = hijo(caja, "div", "epi-fila");
  etiqueta(fila, "epiOrganizadorCuenta");
  const campo = document.createElement("input");
  campo.id = "epi-org-cuenta";
  campo.type = "text";
  campo.value = estado.orgCuenta;
  campo.oninput = () => {
    estado.orgCuenta = stripInvisibles(campo.value).trim();
  };
  fila.append(campo);
  const filaMonto = hijo(caja, "div", "epi-fila");
  for (const m of MONTOS_DEL_PAGO) {
    const b = boton(filaMonto, `epi-org-${m}`, "epiMontoDolares", { monto: m });
    b.classList.toggle("on", estado.orgMonto === m);
    b.onclick = () => {
      estado.orgMonto = m;
      pintarOrganizador();
    };
  }
  if (estado.orgMonto !== null) {
    boton(caja, "epi-pagar", "epiPagar", { monto: estado.orgMonto }).onclick = () =>
      void pagarAlOrganizador(BigInt(estado.orgMonto ?? 0));
  }
}

async function pagarAlOrganizador(monto: bigint): Promise<void> {
  const caja = porId("epi-organizador");
  if (!caja || !estado.publicada || monto <= 0n || estado.orgCuenta === "") return;
  const linea = hijo(caja, "p", "epi-estado");
  texto(linea, "epiPagando");
  const preparado = await prepararElDeposito(
    {
      red: network.name,
      origen: estado.cuenta,
      destino: estado.orgCuenta,
      monto,
      nota: notaDeLaComision(estado.publicada.evento),
    },
    {},
  );
  if (!preparado.ok) {
    texto(linea, "epiDepositoFallo");
    return;
  }
  const r = await aprobarYEnviar(preparado.xdr, estado.cuenta, {
    billetera: cuentaQuePaga(),
    passphrase: passphraseDe(network.name),
  });
  pintarOrganizador();
  const fuera = hijo(caja, "p", "epi-estado");
  texto(
    fuera,
    r.tipo === "enviado"
      ? "epiPagoBien"
      : r.tipo === "fallo" && r.motivo === "otra-red"
        ? "epiBilleteraOtraRed"
        : r.tipo === "fallo" && r.motivo === "cancelada"
          ? "epiBilleteraCancelo"
          : "epiDepositoFallo",
  );
}

/* ------------------------------------------------------------ el armado de la página */

const TITULOS_DE_LA_PAGINA = [
  ["epi-titulo", "epiTitulo"],
  ["epi-intro", "epiIntro"],
  ["epi-cuenta-titulo", "epiCuentaTitulo"],
  ["epi-cuenta-linea", "epiCuentaLinea"],
  ["epi-cuenta-pegar", "epiCuentaPegar"],
  ["epi-cuenta-billetera", "epiConectar"],
  ["epi-nombre-titulo", "epiNombreTitulo"],
  ["epi-eventos-titulo", "epiEventosTitulo"],
  ["epi-eventos-linea", "epiEventosLinea"],
  ["epi-premios-titulo", "epiPremiosTitulo"],
  ["epi-premios-linea", "epiPremiosLinea"],
  ["epi-pasos-titulo", "epiPasosTitulo"],
  ["epi-pasos-linea", "epiPasosLinea"],
  ["epi-vista-titulo", "epiVistaTitulo"],
  ["epi-vista-linea", "epiVistaLinea"],
  ["epi-vista-es-titulo", "epiVistaEs"],
  ["epi-vista-en-titulo", "epiVistaEn"],
  ["epi-evento-agregar", "epiAgregarEvento"],
  ["epi-paso-agregar", "epiPasoAgregar"],
  ["epi-publicar", "epiPublicar"],
  ["epi-publicar-titulo", "epiPublicarTitulo"],
  ["epi-publicar-linea", "epiPublicarLinea"],
  ["epi-informe-titulo", "epiInformeTitulo"],
  ["epi-organizador-titulo", "epiOrganizadorTitulo"],
  ["epi-organizador-linea", "epiOrganizadorLinea"],
  ["epi-pie", "epiPieSobre"],
] as const;

function pintar(): void {
  for (const [id, clave] of TITULOS_DE_LA_PAGINA) {
    const n = porId(id);
    if (n) texto(n, clave);
  }
  const campo = porId("epi-cuenta") as HTMLInputElement | null;
  if (campo) {
    campo.value = estado.cuenta;
    campo.onchange = () => void (async () => {
      estado.cuenta = stripInvisibles(campo.value).trim();
      await mirarElSaldo();
    })();
  }
  const pegar = porId("epi-cuenta-pegar");
  if (pegar) pegar.onclick = () => void (async () => {
    try {
      estado.cuenta = (await navigator.clipboard.readText()).trim();
      if (campo) campo.value = estado.cuenta;
    } catch {
      /* sin permiso: queda lo escrito a mano */
    }
    await mirarElSaldo();
  })();
  const usarBilletera = porId("epi-cuenta-billetera");
  if (usarBilletera) usarBilletera.onclick = () => void conectarBilletera();
  const agregar = porId("epi-evento-agregar");
  if (agregar) agregar.onclick = () => {
    estado.eventos = reducirEventos(estado.eventos, { tipo: "agregar" });
    pintarEventos();
  };
  const pasoAgregar = porId("epi-paso-agregar");
  if (pasoAgregar) pasoAgregar.onclick = () => {
    estado.pasos = reducirPasos(estado.pasos, { tipo: "agregar", tipoDePaso: "instagram" });
    pintarPasos();
  };
  const publicarBoton = porId("epi-publicar");
  if (publicarBoton) publicarBoton.onclick = () => void publicar();
  const nombre = porId("epi-nombre") as HTMLInputElement | null;
  if (nombre) nombre.oninput = () => void pintarVista();
  pintarEventos();
  pintarPremios();
  pintarPasos();
  pintarVista();
  pintarPublicar();
  pintarInforme();
}

/* ------------------------------------------------------------------- el arranque */

function arranque(): void {
  setLang(initialLang());
  const enlace = leerEnlaceDeLaEmpresa(location.search, location.hash);
  const guardada = leerBorrador();
  if (guardada && (!enlace || enlace.evento === guardada.evento)) estado.publicada = guardada;
  pintar();
  onLangChange(() => pintar());
}

arranque();
