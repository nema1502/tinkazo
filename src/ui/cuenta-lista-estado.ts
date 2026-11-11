import type { EstadoDeActivacion, EstadoDeProteccionOficial } from "../stellar/wallet-pollar";

/**
 * Qué muestra el paso «Dejá tu cuenta lista» en cada momento, sin DOM ni textos: solo claves del diccionario.
 *
 * `cuenta-lista.ts` junta lo que sabe (cómo está la cuenta, qué está corriendo, el último error, en qué aparato se
 * está) y le pide la vista a `vistaDe`; después la pinta. Así las reglas que importan se prueban en una tabla
 * (`cuenta-lista-estado.test.ts`):
 *
 * - una sola acción principal, y nunca la del final si las dos partes no están listas;
 * - con otro celular u otra compu, confirmar que es la persona va primero, y por correo;
 * - en la compu la principal de proteger es el correo, y en el celular con desbloqueo, el desbloqueo;
 * - las dos salidas («Pasar a Prueba» y «Cerrar sesión») a la vista hasta el final, y nunca apagadas por algo que corre;
 * - en la red principal, «Activar» solo con el acceso confirmado por el servidor (un cupón, un pago o un alta a mano), o
 *   en el build del plan B1 (`VITE_ALTA_LIBRE=1`): cada activación le cuesta a Tinkazo. Sin el acceso, la parte 1 es la
 *   caja del cupón, aunque la cuenta ya esté activada y protegida.
 */

/**
 * De dónde sale el permiso de activar (W3 del cobro por uso).
 * - `libre`: como siempre. Fuera de la red principal (donde el paso ni se abre) y en el build del plan B1.
 * - `cerrado`: la red principal sin el acceso por cupón en el build. No hay a quién preguntarle, así que no se activa.
 * - `servidor`: la red principal con el acceso por cupón. Se activa solo con el acceso que confirma el servidor.
 */
export type ModoDelAcceso = "libre" | "cerrado" | "servidor";

/** Lo que el paso sabe del acceso al modo Oficial y del cupón. Sin esto, `libre`: el paso de siempre. */
export interface AccesoEnLaVista {
  modo: ModoDelAcceso;
  /** Con servidor: preguntándole, sin acceso, con acceso, o no contestó. */
  estado: "revisando" | "ninguno" | "con" | "error";
  /** Por qué tiene acceso: cambia el texto de la activación. */
  por: "cupon" | "pago" | "admin" | null;
  /** Se abrió para usar un cupón aunque ya tenga acceso (se quedó sin sorteos oficiales). */
  pideCupon: boolean;
  /** El cupón listo para usar (el del enlace, o el que se escribió), como se muestra, o `null`. */
  cuponEnMano: string | null;
  /** Se ve el campo para escribir el cupón. */
  escribiendo: boolean;
  /** Lo escrito en el campo es un cupón entero (12 letras y números). */
  campoOk: boolean;
  /** El último error del servidor (al preguntar el acceso o al canjear), con sus datos. */
  error: Texto | null;
  /** Qué arregla ese error: volver a probar, entrar de nuevo, o nada desde acá (se revisa a mano). */
  arreglo: "probar" | "entrar" | "ninguno";
  /** El cupón ya se canjeó en este paso: cuántos sorteos oficiales trajo. `null` si no se canjeó. */
  canjeado: number | null;
  /** Corre lo que sigue al canje: esperar el pedido de crear la cuenta, activarla y volver a preguntar. */
  cadena: boolean;
  /** Algo de lo que sigue al canje no salió: el cupón quedó en la cuenta y se puede seguir sin volver a canjearlo. */
  fallaTrasCanje: boolean;
}

/** Para qué se abrió el paso: al entrar, al entrar con una lista lista, antes de sellar o antes de sortear. */
export type Para = "entrada" | "entrada-con-lista" | "sello" | "sorteo";

export type Parte = "activar" | "proteger";

/** Lo que está corriendo ahora. `esperando`: el voto salió y la cuenta todavía no aparece. `canjeando`: el cupón. */
export type Corre = "revisando" | "activando" | "esperando" | "desbloqueo" | "mandando" | "confirmando" | "cerrando" | "canjeando" | null;

/** El último error, en palabras del paso. */
export type Falla =
  // De la cuenta o de la activación.
  | "red"
  | "tarda"
  | "fallo"
  | "tope"
  | "rara"
  | "sin-pedido"
  | "sin-pedido-fin"
  | "servicio"
  | "sesion"
  // De proteger o de confirmar este navegador.
  | "desbloqueo"
  | "desbloqueo-bloqueado"
  | "codigo-malo"
  | "codigo-vencido"
  | "codigo-viejo"
  | "correo-fallo"
  | "correo-malo"
  | "prot-tarda"
  | "prot-no-quedo"
  | "prot-red";

const FALLAS_DE_PROTEGER: ReadonlySet<Falla> = new Set<Falla>(["desbloqueo", "desbloqueo-bloqueado", "codigo-malo", "codigo-vencido", "codigo-viejo", "correo-fallo", "correo-malo", "prot-tarda", "prot-no-quedo", "prot-red"]);

export type Accion =
  | "activar"
  /** «Probar de nuevo»: solo lee cómo está la cuenta. Nunca vota: votar sale solo de «Activar mi cuenta». */
  | "leer"
  | "desbloqueo"
  | "mandar-codigo"
  | "mandar-a-mano"
  | "confirmar-codigo"
  | "otro-codigo"
  | "otro-correo"
  | "salir-y-entrar"
  | "entrar-de-nuevo"
  | "pasar-a-prueba"
  | "seguir"
  | "sellar"
  | "sortear"
  | "volver"
  /** «Tengo un cupón»: abre el campo. */
  | "tengo-cupon"
  /** «Activar con mi cupón» (o «Usar un cupón», con la cuenta ya activada): canjea y sigue. */
  | "usar-cupon"
  /** «Usar otro cupón»: el campo, con el que había guardado a un lado. */
  | "otro-cupon"
  /** «Volver» desde el campo del cupón. */
  | "volver-cupon"
  /** «Probar de nuevo» cuando no se supo el acceso: solo vuelve a preguntar. */
  | "leer-acceso"
  /** «Probar de nuevo» después del canje: sigue desde lo que no salió, sin volver a canjear. */
  | "seguir-cupon";

/** Un texto: la clave y lo que va en sus huecos (`{mail}`, `{s}`). */
export interface Texto {
  clave: string;
  vars?: Record<string, string>;
}

export interface Boton extends Texto {
  accion: Accion;
  apagado: boolean;
  /** Apagado porque esto mismo está corriendo («Activando tu cuenta…»), no porque falta algo (el código sin escribir). */
  ocupado?: boolean;
}

/** Lo secundario dentro de una caja: un botón con borde, o uno de texto subrayado, con una raya antes si va. */
export interface Secundario extends Boton {
  forma: "boton" | "texto";
  raya?: string;
  /** Un renglón debajo del botón que dice qué es (el desbloqueo: qué se usa y que Tinkazo no lo ve). */
  ayuda?: Texto;
}

export type EstadoDeCaja = "falta" | "espera" | "revisando" | "haciendo" | "lista" | "no-salio";

export interface CajaVista {
  parte: Parte;
  numero: 1 | 2;
  estado: EstadoDeCaja;
  titulo: string;
  /** La palabra del estado («Falta», «Listo»). Vacía mientras algo corre en la caja: lo dice la principal apagada. */
  palabra: string;
  abierta: boolean;
  /** Los párrafos de la caja abierta, en orden. */
  textos: Texto[];
  /** Una nota que no es una falla (el navegador no deja abrir el desbloqueo, el código de antes de recargar). */
  nota: Texto | null;
  /** El error de esta caja, con `role="alert"`. */
  error: Texto[] | null;
  /** El campo que va en la caja: el correo escrito a mano, el código o el cupón. */
  campo: "correo" | "codigo" | "cupon" | null;
  secundarios: Secundario[];
  /** Corre algo en esta caja (`aria-busy`). */
  ocupada: boolean;
  /** Lo que va al final de la caja, debajo de todo (`altaNoTengo`). */
  cierre?: Texto[];
}

export interface Vista {
  final: boolean;
  titulo: string;
  bajada: string;
  cajas: CajaVista[];
  principal: Boton | null;
  /** «Volver», al final, cuando el paso se abrió para sellar o sortear. */
  volver: Boton | null;
  /** El texto de la confirmación del primer sello en Oficial, arriba de la principal del final. */
  primerOficial: boolean;
  /** La línea de estado del pie (`role="status"`). */
  estado: Texto | null;
  notas: string[];
  /** Las dos salidas. Sin ellas, al final. `prueba` falta cuando «Pasar a Prueba» ya es la principal. */
  salidas: { prueba: { apagado: boolean } | null; cerrar: { apagado: boolean } } | null;
}

export interface EntradaVista {
  activacion: EstadoDeActivacion;
  proteccion: EstadoDeProteccionOficial;
  correoConfirmado: boolean;
  tieneLlaves: boolean;
  unicoNavegador: boolean;
  corre: Corre;
  /** Lo que corre lleva más de ocho segundos. */
  lento: boolean;
  falla: Falla | null;
  /** Lo que se acaba de lograr, para la línea de estado («Tu cuenta quedó activada…»). */
  aviso: string | null;
  para: Para;
  celular: boolean;
  /** Este navegador puede usar el desbloqueo del celular o de la compu. */
  hayDesbloqueo: boolean;
  /** El desbloqueo ya falló una vez (no por cerrar el cuadro): el correo pasa a ser lo principal. */
  desbloqueoFallo: boolean;
  /** La persona tocó «Usar otro correo»: se ve el campo. */
  eligioCorreo: boolean;
  /** El correo de la sesión, ya tapado («n•••@gmail.com»), o vacío. */
  correoSesion: string;
  /** El correo confirmado de la cuenta, ya tapado, o vacío. */
  correoCuenta: string;
  /** Entró con su correo (no con Google): el código para proteger es otro. */
  entroConCorreo: boolean;
  /** Se mandó un código: a dónde (como se muestra) y hace cuántos segundos. */
  codigo: { a: string; segundos: number } | null;
  /** La página se recargó con un código mandado: ese ya no sirve. */
  codigoRecargado: boolean;
  /** Lo escrito en el campo tiene forma (un correo, o un código de 4 o más). */
  campoOk: boolean;
  /** Cuántas veces no apareció el pedido de crear la cuenta. */
  sinPedidoVeces: number;
  puedePasarAPrueba: boolean;
  /** Este navegador todavía no confirmó su primer sello en Oficial. */
  primerOficialPendiente: boolean;
  /** El acceso al modo Oficial (el cobro por uso). Sin decirlo, `libre`: el paso de siempre. */
  acceso?: AccesoEnLaVista;
}

/** El acceso de siempre: activar no pide nada. */
export const ACCESO_LIBRE: Readonly<AccesoEnLaVista> = Object.freeze({
  modo: "libre",
  estado: "con",
  por: null,
  pideCupon: false,
  cuponEnMano: null,
  escribiendo: false,
  campoOk: false,
  error: null,
  arreglo: "probar",
  canjeado: null,
  cadena: false,
  fallaTrasCanje: false,
});

const accesoDe = (e: Pick<EntradaVista, "acceso">): AccesoEnLaVista => e.acceso ?? ACCESO_LIBRE;

/**
 * Falta el acceso: la parte 1 es la caja del cupón, o lo que pasa con él. Con servidor y sin acceso confirmado, aunque
 * la cuenta ya esté activada y protegida; y también si el paso se abrió para usar un cupón y todavía no se usó.
 */
export function faltaElAcceso(e: Pick<EntradaVista, "acceso" | "corre">): boolean {
  const a = accesoDe(e);
  if (a.modo !== "servidor") return false;
  if (a.fallaTrasCanje || a.cadena || e.corre === "canjeando") return true;
  return a.estado !== "con" || (a.pideCupon && a.canjeado === null);
}

/**
 * El paso se abrió para usar un cupón («Se te acabaron», la caja de la red) con la cuenta ya activada y protegida: no hay
 * nada a medias, así que se puede volver a la página con «Volver» (y con Escape). Mientras se canjea, o con lo que sigue
 * al canje en marcha, no. Al entrar tampoco: ahí no se abre para un cupón.
 */
export function puedeVolverDelCupon(e: Pick<EntradaVista, "acceso" | "corre" | "activacion" | "proteccion" | "para">): boolean {
  const a = accesoDe(e);
  return a.modo === "servidor" && a.pideCupon && !a.cadena && e.corre !== "canjeando" && e.activacion === "lista" && e.proteccion === "lista" && e.para !== "entrada";
}

/** «Activar» se puede ofrecer: como siempre, o con el acceso confirmado por el servidor. Nunca en `cerrado`. */
export function activarPermitido(e: Pick<EntradaVista, "acceso" | "corre">): boolean {
  const a = accesoDe(e);
  if (a.modo === "libre") return true;
  return a.modo === "servidor" && a.estado === "con" && !faltaElAcceso(e);
}

/** Los segundos que se espera para ofrecer otro código, y para decir que mire en Spam. */
export const OTRO_CODIGO_S = 30;
export const SPAM_S = 20;

/** La parte 1 está lista con la cuenta activada y, si lo pide el cobro por uso, con el acceso. */
const listaLa = (e: EntradaVista, p: Parte): boolean => (p === "activar" ? e.activacion === "lista" && !faltaElAcceso(e) : e.proteccion === "lista");

/** Sin forma de recuperar la cuenta desde acá: ni proteger ni confirmar este navegador. */
const sinForma = (e: EntradaVista): boolean => e.proteccion === "sin-forma" || (e.proteccion === "aparato-nuevo" && !e.correoConfirmado && !e.tieneLlaves);

/** El orden de las cajas: con otro celular u otra compu, confirmar que es la persona va primero. */
export function ordenDe(e: Pick<EntradaVista, "proteccion">): Parte[] {
  return e.proteccion === "aparato-nuevo" || e.proteccion === "sin-forma" ? ["proteger", "activar"] : ["activar", "proteger"];
}

const cel = (e: EntradaVista, clave: string): string => `${clave}${e.celular ? "Cel" : "Compu"}`;

const boton = (accion: Accion, clave: string, apagado = false, vars?: Record<string, string>): Boton => (vars ? { accion, clave, apagado, vars } : { accion, clave, apagado });

/** La principal mientras corre lo suyo: apagada, y con la ruedita que dice que se está haciendo. */
const ocupado = (accion: Accion, clave: string): Boton => ({ accion, clave, apagado: true, ocupado: true });

/** Lo que hace la principal cuando una falla de la activación no tiene otro arreglo. */
function principalDeLaFalla(f: Falla): Boton {
  if (f === "tope" || f === "sin-pedido-fin") return boton("salir-y-entrar", "clSalirYEntrar");
  if (f === "sesion") return boton("entrar-de-nuevo", "clEntrarDeNuevo");
  return boton("leer", "clProbarDeNuevo");
}

const TEXTO_DE_LA_FALLA: Record<Falla, string[]> = {
  red: ["clErrRed"],
  tarda: ["clErrTarda"],
  fallo: ["clErrFallo"],
  tope: ["clErrTope"],
  rara: ["clErrRara", "clContacto"],
  "sin-pedido": ["clErrSinPedido"],
  "sin-pedido-fin": ["clErrSinPedidoFin"],
  servicio: ["clErrServicio"],
  sesion: ["clErrSesion"],
  desbloqueo: ["clDesbloqueoFalla"],
  "desbloqueo-bloqueado": ["protPasskeyBloqueada"],
  "codigo-malo": ["protBadCode"],
  "codigo-vencido": ["clCodigoVencido"],
  "codigo-viejo": ["clCodigoViejo"],
  "correo-fallo": ["protFalla"],
  "correo-malo": ["protBadMail"],
  "prot-tarda": ["protTarda"],
  "prot-no-quedo": ["protNoQuedo"],
  "prot-red": ["clErrRed"],
};

const textos = (claves: string[]): Texto[] => claves.map((clave) => ({ clave }));

interface Armado {
  caja: CajaVista;
  principal: Boton | null;
}

function cajaVacia(parte: Parte, numero: 1 | 2): CajaVista {
  return {
    parte,
    numero,
    estado: "espera",
    titulo: parte === "activar" ? "clActivarTitulo" : "clProtegerTitulo",
    palabra: "clEstadoEspera",
    abierta: false,
    textos: [],
    nota: null,
    error: null,
    campo: null,
    secundarios: [],
    ocupada: false,
  };
}

/** Lo que dice la caja de activar: con el acceso del cobro por uso, por qué no se paga nada. */
function textoDeActivar(e: EntradaVista): string {
  const a = accesoDe(e);
  if (a.modo !== "servidor") return "clActivarTexto";
  return a.por === "cupon" ? "altaActivarCupon" : a.por === "pago" ? "altaActivarPago" : "clActivarTexto";
}

/** La caja de activar cuando es la que toca. */
function activarActual(e: EntradaVista, caja: CajaVista): Armado {
  const lead = textoDeActivar(e);
  if (e.falla === "sesion" || (e.falla && !FALLAS_DE_PROTEGER.has(e.falla))) {
    const f = e.falla;
    return { caja: { ...caja, estado: "no-salio", palabra: "clEstadoNoSalio", abierta: true, error: textos(TEXTO_DE_LA_FALLA[f]) }, principal: principalDeLaFalla(f) };
  }
  if (e.corre === "activando" || e.corre === "esperando") {
    return {
      caja: { ...caja, estado: "haciendo", palabra: "", abierta: true, textos: textos([lead]), ocupada: true },
      principal: ocupado("activar", "clActivarHaciendo"),
    };
  }
  if (e.corre === "revisando" || e.activacion === "preparando") {
    return { caja: { ...caja, estado: "revisando", palabra: "", ocupada: true }, principal: ocupado("leer", "clRevisando") };
  }
  if (e.activacion === "fallo") return { caja: { ...caja, estado: "no-salio", palabra: "clEstadoNoSalio", abierta: true, error: textos(["clErrFallo"]) }, principal: boton("leer", "clProbarDeNuevo") };
  if (e.activacion === "no-se-sabe") return { caja: { ...caja, estado: "no-salio", palabra: "clEstadoNoSalio", abierta: true, error: textos(["clErrRed"]) }, principal: boton("leer", "clProbarDeNuevo") };
  return { caja: { ...caja, estado: "falta", palabra: "clEstadoFalta", abierta: true, textos: textos([lead]) }, principal: boton("activar", "clActivarBoton", e.corre !== null) };
}

/**
 * La parte 1 en la red principal sin el acceso por cupón en el build: no hay a quién preguntarle, así que no se activa.
 * Se dice lo cierto (ahora no se pueden activar cuentas nuevas) y la principal es «Pasar a Prueba», si se puede.
 */
function cerradoActual(e: EntradaVista, caja: CajaVista): Armado {
  if (e.falla === "sesion") return { caja: { ...caja, estado: "no-salio", palabra: "clEstadoNoSalio", abierta: true, error: textos(["clErrSesion"]) }, principal: principalDeLaFalla("sesion") };
  return {
    caja: { ...caja, estado: "falta", palabra: "clEstadoFalta", abierta: true, textos: textos(["clErrServicio"]) },
    principal: e.puedePasarAPrueba ? boton("pasar-a-prueba", "modeSwitchToTest") : null,
  };
}

/** La principal de un error del servidor que no se arregla probando de nuevo. */
function principalDelArreglo(e: EntradaVista, arreglo: AccesoEnLaVista["arreglo"], probar: Boton): Boton | null {
  if (arreglo === "entrar") return boton("entrar-de-nuevo", "clEntrarDeNuevo");
  if (arreglo === "ninguno") return e.puedePasarAPrueba ? boton("pasar-a-prueba", "modeSwitchToTest") : null;
  return probar;
}

/**
 * La parte 1 cuando falta el acceso: la caja del cupón (W7). Una sola principal en cada fila:
 * - con un cupón en mano, «Activar con mi cupón» (y «Usar otro cupón» de texto);
 * - sin cupón, «Tengo un cupón», que abre el campo;
 * - escribiendo, «Activar con mi cupón», apagada hasta que haya 12 letras y números (y «Volver» de texto);
 * - con la cuenta ya activada, lo mismo con `altaYaActivada`, y la principal dice «Usar un cupón».
 * Debajo, siempre `altaNoTengo`. Las filas del pago no se muestran: el pago todavía no está.
 */
function accesoActual(e: EntradaVista, caja: CajaVista): Armado {
  const a = accesoDe(e);
  const activada = e.activacion === "lista";
  const base: CajaVista = { ...caja, titulo: activada ? "altaTituloSorteos" : "clActivarTitulo", abierta: true };
  const usar = activada ? "cupoOfUsarCupon" : "altaActivarConCupon";
  const cierre = textos(["altaNoTengo"]);
  if (e.falla === "sesion") return { caja: { ...base, estado: "no-salio", palabra: "clEstadoNoSalio", error: textos(["clErrSesion"]) }, principal: principalDeLaFalla("sesion") };
  // Algo después del canje no salió: el cupón quedó en la cuenta, y «Probar de nuevo» sigue desde ahí.
  if (a.fallaTrasCanje) return { caja: { ...base, estado: "no-salio", palabra: "clEstadoNoSalio", error: textos(["altaCuponGuardado"]) }, principal: boton("seguir-cupon", "clProbarDeNuevo") };
  // Lo que sigue al canje: esperar el pedido, activar y volver a preguntar.
  if (a.cadena) {
    const n = a.canjeado ?? 0;
    const t: Texto[] = !activada && n > 0 ? [n === 1 ? { clave: "altaCuponOk1" } : { clave: "altaCuponOk", vars: { n: String(n) } }] : [];
    return { caja: { ...base, estado: "haciendo", palabra: "", textos: t, ocupada: true }, principal: ocupado("usar-cupon", e.corre === "revisando" ? "clRevisando" : "clActivarHaciendo") };
  }
  if (a.estado === "revisando" || (e.corre === "revisando" && e.activacion !== "lista")) {
    return { caja: { ...base, estado: "revisando", palabra: "", abierta: false, ocupada: true }, principal: ocupado("leer-acceso", "clRevisando") };
  }
  if (a.estado === "error") {
    const err = a.error ? [a.error] : textos(["altaErrServicio"]);
    return { caja: { ...base, estado: "no-salio", palabra: "clEstadoNoSalio", error: err }, principal: principalDelArreglo(e, a.arreglo, boton("leer-acceso", "clProbarDeNuevo")) };
  }
  const canjeando = e.corre === "canjeando";
  const error = a.error ? [a.error] : null;
  const estado: EstadoDeCaja = canjeando ? "haciendo" : error ? "no-salio" : "falta";
  const palabra = canjeando ? "" : error ? "clEstadoNoSalio" : "clEstadoFalta";
  // Con un error a la vista, el motivo va antes que la explicación de siempre: en un celular chico no entran los dos.
  const lead: Texto[] = error ? [] : [{ clave: activada ? "altaYaActivada" : "altaTexto" }];
  const conArreglo = (p: Boton): Boton | null => (canjeando ? p : principalDelArreglo(e, a.arreglo, p));
  if (a.escribiendo) {
    return {
      // Con «Volver» a la página a la vista, el campo no repite otro «Volver».
      caja: { ...base, estado, palabra, error, campo: "cupon", ocupada: canjeando, secundarios: puedeVolverDelCupon(e) ? [] : [{ ...boton("volver-cupon", "clVolver", canjeando), forma: "texto" }], cierre },
      principal: canjeando ? ocupado("usar-cupon", "altaRevisando") : conArreglo(boton("usar-cupon", usar, !a.campoOk)),
    };
  }
  if (a.cuponEnMano) {
    return {
      caja: {
        ...base,
        estado,
        palabra,
        textos: [...lead, { clave: "altaCuponListo", vars: { codigo: a.cuponEnMano } }],
        error,
        ocupada: canjeando,
        secundarios: [{ ...boton("otro-cupon", "altaOtroCupon", canjeando), forma: "texto" }],
        cierre,
      },
      principal: canjeando ? ocupado("usar-cupon", "altaRevisando") : conArreglo(boton("usar-cupon", usar)),
    };
  }
  return { caja: { ...base, estado, palabra, textos: lead, error, cierre }, principal: conArreglo(boton("tengo-cupon", "altaTengoCupon")) };
}

/** La caja de proteger (o de confirmar este navegador) cuando es la que toca. */
function protegerActual(e: EntradaVista, caja: CajaVista): Armado {
  const aparato = e.proteccion === "aparato-nuevo";
  const base: CajaVista = { ...caja, titulo: aparato ? "clAparatoTitulo" : "clProtegerTitulo", abierta: true };
  // La sesión se cerró: nada de lo de acá sirve sin entrar de nuevo.
  if (e.falla === "sesion") return { caja: { ...base, estado: "no-salio", palabra: "clEstadoNoSalio", error: textos(["clErrSesion"]) }, principal: principalDeLaFalla("sesion") };
  if (e.corre === "revisando") return { caja: { ...base, estado: "revisando", palabra: "", abierta: false, ocupada: true }, principal: ocupado("leer", "clRevisando") };
  if (sinForma(e)) {
    return {
      caja: { ...base, titulo: "clProtegerTitulo", estado: "falta", palabra: "clEstadoFalta", textos: textos(["clSinForma", "clSinFormaPista", "clContacto"]) },
      principal: e.puedePasarAPrueba ? boton("pasar-a-prueba", "modeSwitchToTest") : null,
    };
  }
  if (e.proteccion === "no-se-sabe") {
    return { caja: { ...base, estado: "no-salio", palabra: "clEstadoNoSalio", error: textos(["clErrRed"]) }, principal: boton("leer", "clProbarDeNuevo") };
  }
  const falla = e.falla && FALLAS_DE_PROTEGER.has(e.falla) ? e.falla : null;
  const esNota = falla === "desbloqueo-bloqueado";
  const errorDeLaCaja = falla && !esNota ? textos(TEXTO_DE_LA_FALLA[falla]) : null;
  const nota: Texto | null = esNota ? { clave: "protPasskeyBloqueada" } : null;
  const palabraFalta = errorDeLaCaja ? "clEstadoNoSalio" : "clEstadoFalta";
  const estadoFalta: EstadoDeCaja = errorDeLaCaja ? "no-salio" : "falta";
  const desbloqueoClave = cel(e, "clDesbloqueo");
  // El desbloqueo se ofrece si el navegador lo tiene; para confirmar este navegador, además, la cuenta tiene que tener
  // una llave guardada (el desbloqueo de otro celular no sirve acá en una compu).
  const ofreceDesbloqueo = e.hayDesbloqueo && (!aparato || e.tieneLlaves);
  // El desbloqueo nunca aparece sin decir qué es: debajo de su botón, o en la caja si su botón es la principal del pie.
  const ayudaDesbloqueo: Texto = { clave: cel(e, "clDesbloqueoAyuda") };
  const desbloqueoSecundario = (): Secundario => ({ ...boton("desbloqueo", desbloqueoClave), forma: "boton", raya: "clOSiPreferis", ayuda: ayudaDesbloqueo });

  if (e.corre === "desbloqueo" || e.corre === "confirmando") {
    return {
      caja: { ...base, titulo: e.codigo ? "protCodeTitulo" : base.titulo, estado: "haciendo", palabra: "", ocupada: true, campo: e.codigo && e.corre === "confirmando" ? "codigo" : null },
      principal: ocupado(e.corre === "desbloqueo" ? "desbloqueo" : "confirmar-codigo", aparato ? "clEstadoConfirmando" : "protHaciendo"),
    };
  }

  // Con el código mandado: el campo del código y «Confirmar».
  if (e.codigo) {
    const t: Texto[] = [{ clave: "protCodeLead", vars: { mail: e.codigo.a } }, { clave: "clCorreoLlega" }];
    if (e.entroConCorreo && !aparato) t.push({ clave: "clCorreoOtroCodigo" });
    if (e.codigo.segundos >= SPAM_S) t.push({ clave: "clCorreoSpam" });
    const falta = Math.max(0, OTRO_CODIGO_S - e.codigo.segundos);
    const vencio = falla === "codigo-vencido" || falla === "codigo-viejo";
    const sec: Secundario[] = [];
    if (!vencio) sec.push({ ...(falta > 0 ? boton("otro-codigo", "clOtroCodigoEn", true, { s: String(falta) }) : boton("otro-codigo", "protOtroCodigo", e.corre === "mandando")), forma: "boton" });
    if (!aparato) sec.push({ ...boton("otro-correo", "protOtroCorreo"), forma: "texto" });
    if (ofreceDesbloqueo) sec.push(desbloqueoSecundario());
    return {
      caja: { ...base, titulo: "protCodeTitulo", estado: estadoFalta, palabra: palabraFalta, textos: t, error: errorDeLaCaja, nota, campo: vencio ? null : "codigo", secundarios: sec },
      principal: vencio ? (e.corre === "mandando" ? ocupado("otro-codigo", "protEnviando") : boton("otro-codigo", "protOtroCodigo")) : boton("confirmar-codigo", "protCodeGo", !e.campoOk),
    };
  }

  const mandando = e.corre === "mandando";
  const notaRecarga: Texto | null = e.codigoRecargado ? { clave: "clCodigoRecargado" } : nota;

  // Otro celular u otra compu: siempre el correo de la cuenta primero.
  if (aparato) {
    const t = textos([cel(e, "clAparatoTexto"), cel(e, "clAparatoAjeno")]);
    if (!e.correoConfirmado) {
      // Sin correo, solo con una llave guardada.
      return { caja: { ...base, estado: estadoFalta, palabra: palabraFalta, textos: [...t, ayudaDesbloqueo], error: errorDeLaCaja, nota: notaRecarga }, principal: boton("desbloqueo", desbloqueoClave) };
    }
    const sec: Secundario[] = ofreceDesbloqueo && e.celular ? [desbloqueoSecundario()] : [];
    const mandar = mandando ? ocupado("mandar-codigo", "protEnviando") : e.correoCuenta ? boton("mandar-codigo", "clMandarA", false, { mail: e.correoCuenta }) : boton("mandar-codigo", "clMandarATuCorreo");
    return { caja: { ...base, estado: estadoFalta, palabra: palabraFalta, textos: t, error: errorDeLaCaja, nota: notaRecarga, secundarios: sec }, principal: mandar };
  }

  // La cuenta nueva: proteger con el desbloqueo o con un código al correo.
  const t = textos([cel(e, "clProtegerTexto")]);
  const aMano = e.eligioCorreo || !e.correoSesion;
  const mandarSesion = (): Boton => (mandando ? ocupado("mandar-codigo", "protEnviando") : boton("mandar-codigo", "clMandarA", false, { mail: e.correoSesion }));
  const mandarAMano = (): Boton => (mandando ? ocupado("mandar-a-mano", "protEnviando") : boton("mandar-a-mano", "protMailGo", !e.campoOk));
  const desbloqueoPrimero = e.celular && ofreceDesbloqueo && !e.desbloqueoFallo && !e.eligioCorreo && !e.codigoRecargado;
  if (desbloqueoPrimero) {
    const sec: Secundario[] = [aMano ? { ...mandarAMano(), forma: "boton", raya: "clCorreoO" } : { ...mandarSesion(), forma: "boton", raya: "clCorreoO" }];
    return {
      caja: { ...base, estado: estadoFalta, palabra: palabraFalta, textos: [...t, ayudaDesbloqueo], error: errorDeLaCaja, nota, campo: aMano ? "correo" : null, secundarios: sec },
      principal: boton("desbloqueo", desbloqueoClave, mandando),
    };
  }
  // «Mandar el código a otro correo» y no «Usar otro correo»: acá todavía no se leyó a qué correo va el de la principal.
  const sec: Secundario[] = [];
  if (!aMano) sec.push({ ...boton("otro-correo", "clOtroCorreo"), forma: "texto" });
  if (ofreceDesbloqueo) sec.push(desbloqueoSecundario());
  return {
    caja: { ...base, estado: estadoFalta, palabra: palabraFalta, textos: t, error: errorDeLaCaja, nota: notaRecarga, campo: aMano ? "correo" : null, secundarios: sec },
    principal: aMano ? mandarAMano() : mandarSesion(),
  };
}

/**
 * La línea de estado del pie. Mientras se revisa la cuenta o el acceso (una lectura del servidor puede durar hasta unos
 * 17 segundos), a los 8 segundos avisa que tarda, con el mismo texto que la activación: «Puede tardar unos segundos más.»
 * no habla de activar, y sin ese aviso la persona ve solo el botón ocupado.
 */
function lineaDeEstado(e: EntradaVista): Texto | null {
  if (e.corre === "activando") return { clave: e.lento ? "clActivarLento" : "clActivarHaciendo" };
  if (e.corre === "esperando") return { clave: "clActivarLento" };
  if (e.corre === "desbloqueo" && e.lento) return { clave: "clEsperandoDesbloqueo" };
  if (e.corre === "cerrando") return { clave: "clCerrando" };
  if (e.corre === "canjeando") return { clave: "altaRevisando" };
  if (e.lento && (e.corre === "revisando" || accesoDe(e).estado === "revisando")) return { clave: "clActivarLento" };
  return e.aviso ? { clave: e.aviso } : null;
}

/** La parte 1 cuando es la que toca: la caja del cupón si falta el acceso, cerrada sin a quién preguntar, o activar. */
function parte1Actual(e: EntradaVista, caja: CajaVista): Armado {
  const a = accesoDe(e);
  if (faltaElAcceso(e)) return accesoActual(e, caja);
  if (a.modo === "cerrado" && e.activacion !== "lista") return cerradoActual(e, caja);
  return activarActual(e, caja);
}

/** La vista del paso para lo que se sabe ahora. */
export function vistaDe(e: EntradaVista): Vista {
  const orden = ordenDe(e);
  const final = listaLa(e, "activar") && listaLa(e, "proteger");
  const actual = orden.find((p) => !listaLa(e, p)) ?? null;
  let principal: Boton | null = null;
  const cajas = orden.map((parte, i) => {
    const vacia = cajaVacia(parte, (i + 1) as 1 | 2);
    if (parte === "proteger" && e.proteccion === "aparato-nuevo") vacia.titulo = "clAparatoTitulo";
    if (parte === "activar" && e.activacion === "lista" && faltaElAcceso(e)) vacia.titulo = "altaTituloSorteos";
    if (listaLa(e, parte)) return { ...vacia, estado: "lista" as const, palabra: "clEstadoListo" };
    if (parte !== actual) return vacia;
    const armado = parte === "activar" ? parte1Actual(e, vacia) : protegerActual(e, vacia);
    principal = armado.principal;
    return armado.caja;
  });

  if (final) {
    const conLista = e.para === "entrada-con-lista" || e.para === "sello";
    const p = e.para === "entrada" ? boton("seguir", "clSeguir") : e.para === "sorteo" ? boton("sortear", "draw") : boton("sellar", "freeze");
    return {
      final: true,
      titulo: "clListaTitulo",
      bajada: "clListaTexto",
      cajas,
      principal: e.corre === "cerrando" ? { ...p, apagado: true } : p,
      volver: e.para === "entrada" ? null : boton("volver", "clVolver"),
      primerOficial: conLista && e.primerOficialPendiente,
      estado: lineaDeEstado(e),
      notas: [],
      salidas: null,
    };
  }

  // Cerrando sesión, la principal espera: la salida ya está en marcha.
  const p = principal as Boton | null;
  const principalFinal = p && e.corre === "cerrando" ? { ...p, apagado: true } : p;
  const notas: string[] = [];
  if (e.proteccion === "falta" && e.unicoNavegador) notas.push(cel(e, "clSalirAviso"));
  notas.push(e.puedePasarAPrueba ? "clAPruebaNota" : "modeSwitchBlocked");
  // Con la cuenta activada y protegida, lo único que falta es el acceso: no son «dos pasos».
  const soloElAcceso = faltaElAcceso(e) && e.activacion === "lista" && e.proteccion === "lista";
  return {
    final: false,
    titulo: "clTitulo",
    bajada: soloElAcceso ? "altaBajadaUnPaso" : "clBajada",
    cajas,
    principal: principalFinal,
    volver: puedeVolverDelCupon(e) ? boton("volver", "clVolver") : null,
    primerOficial: false,
    estado: lineaDeEstado(e),
    notas,
    salidas: {
      prueba: principalFinal?.accion === "pasar-a-prueba" ? null : { apagado: !e.puedePasarAPrueba },
      cerrar: { apagado: e.corre === "cerrando" },
    },
  };
}
