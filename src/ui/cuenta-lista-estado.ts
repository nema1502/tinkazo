import { type OrdenDePago, fechaDeAlta } from "../stellar/alta-api";
import { type ProductoALaVenta, varsDelProducto } from "../stellar/alta-oferta";
import type { MotivoDelPago } from "../stellar/pago-con-saldo";
import type { EstadoDeActivacion, EstadoDeProteccionOficial } from "../stellar/wallet-pollar";
import { type FaseDelSaldo, type SaldoCorto, lineaDelSaldo, textoDelCorto, vistaDelSaldo } from "./pago-saldo";
import { MEDIOS_DE_PAGO, type MedioDePago, type PanelDePago, lineaDelPago, panelDe, vencidaSinPagar } from "./pago-vista";

export type { PanelDePago } from "./pago-vista";

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
 *   caja del cupón, aunque la cuenta ya esté activada y protegida;
 * - con la compra en el build (`acceso.pago`), las filas del pago: comprar el primer paquete solo si el servidor lo vende
 *   ahora, y la cuenta, el monto y la nota que se muestran son los de la orden, tal cual. Pagar nunca da «Activar»: eso
 *   lo da el acceso que confirma el servidor. Solo medios automáticos (`pago-vista.ts`): con uno solo no se pregunta cómo
 *   pagar. Sin `acceso.pago`, el paso de siempre;
 * - con `para: "premio"` (quien ganó) no hay cupón, compra, sorteos ni Pasar a Prueba: el acceso solo se mira para activar
 *   una cuenta sin activar, y sin él la parte 1 espera (`premioActual`);
 * - con el regalo de quien entra con su cuenta (`acceso.bienvenida`, solo si el servidor lo ofrece), la principal de la
 *   caja del acceso es «Activar mi cuenta», que lo pide y sigue la cadena del cupón (`regaloActual`). Sin el regalo, la
 *   caja de siempre.
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
  /**
   * Por qué tiene acceso, como lo dijo el servidor: cambia el texto de la activación (con `admin`, `premio` y `gratis`, el
   * de siempre). Un alta nacida del regalo llega como `admin`, y `gratis` se acepta si llega: nada depende de ese valor.
   */
  por: "cupon" | "pago" | "admin" | "premio" | "gratis" | null;
  /**
   * El acceso de este paso lo trajo el regalo de quien entra (no un cupón): lo que sigue y lo que falla no nombran ningún
   * cupón. Lo marca el paso al pedir el regalo, no el nombre del acceso que conteste el servidor.
   */
  delRegalo?: boolean;
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
  /** La compra del primer paquete, solo con la compra prendida en el build. Sin esto, ninguna fila del pago. */
  pago?: PagoEnLaVista;
  /**
   * El regalo de quien entra con su cuenta, como lo dijo el servidor: `lista` se puede recibir, `llena` hoy no se da.
   * Sin esto (el servicio de antes, o ya lo recibió), la caja de siempre.
   */
  bienvenida?: { estado: "lista" | "llena"; sorteos: number };
  /**
   * Los sorteos oficiales que dejó el regalo recibido en este paso, para la línea del final: cuántos quedan y, si se
   * sabe, cuándo vencen (la fecha ya dicha en el idioma de la persona). Sin esto, el final de siempre. Con `lleno`, el
   * servidor activó la cuenta pero el regalo no pasó: sin sorteos, el final lo dice (`altaBienvenidaLlena`).
   */
  sorteosDelRegalo?: { quedan: number; vence: { fecha: string; cuantos: number } | null; lleno?: boolean };
  /**
   * Los sorteos oficiales que el servidor dijo que tiene la cuenta al abrir el paso, con acceso: así el final de una cuenta
   * ya activada (el regalo se recibió en otro momento) también dice cuántos le quedan. Sin esto, o con el regalo recibido acá
   * (que manda), el final de siempre.
   */
  cupo?: { quedan: number; vence: { fecha: string; cuantos: number } | null };
}

/**
 * Dónde está la compra del primer paquete:
 * - `ofrecer`: la caja del acceso, con el paquete de principal si el servidor lo vende (y, si pedir la orden no salió,
 *   el motivo);
 * - `elegir`: cómo pagar, solo con más de un medio (hoy hay uno y no se pregunta);
 * - `pidiendo`: se le pide la orden al servidor;
 * - `pagando`: la orden en mano, para pagarla.
 */
export type FaseDelPago = "ofrecer" | "elegir" | "pidiendo" | "pagando";

/** Lo que el paso sabe de la compra del primer paquete. */
export interface PagoEnLaVista {
  /** El idioma en que se dicen los precios, los montos y las fechas. */
  idioma: "es" | "en";
  /** El primer paquete, si el servidor lo vende ahora (`alta-oferta.ts`). `null`: no se ofrece comprar. */
  alta: ProductoALaVenta | null;
  /** Los medios de pago que se ofrecen (`MEDIOS_DE_PAGO`). */
  medios: readonly MedioDePago[];
  fase: FaseDelPago;
  /** La orden, entera y comprobada (`alta-api.ts`, `orden`): de acá, y de ningún otro lado, salen la cuenta, el monto y la nota. */
  orden: OrdenDePago | null;
  /** Lo que llegó y lo que hace falta, si llegó algo y no alcanza (lo dice el servidor). */
  falta: { recibido: string; total: string } | null;
  /** Se está mirando si llegó, después de «Ya pagué». */
  buscando: boolean;
  /** Ya se miró y no llegó nada. */
  noVisto: boolean;
  /** Pasaron los 5 minutos mirando. */
  tarda: boolean;
  /** Tocó «No llegó». */
  noLlego: boolean;
  /** La orden venció. */
  vencida: boolean;
  /** El último error de la orden o del pago, con sus datos. */
  error: Texto | null;
  /** Qué arregla ese error: volver a probar, entrar de nuevo, o nada desde acá. */
  arreglo: "probar" | "entrar" | "ninguno";
  /** El medio con que se paga: `app` (los datos para pagar, el de siempre) o `saldo`. Sin decirlo, `app`. */
  medio?: string;
  /** Pagar con el saldo de la cuenta (`pago-saldo.ts`): solo si el paso lo recibió. Sin esto, como siempre. */
  conSaldo?: SaldoDeLaCompra | null;
  /** Se ofrece Estoy en Bolivia en el panel: la compra con QR en el build y disponible para esta cuenta. */
  cambio?: boolean;
}

/** Lo que el paso sabe del saldo de la cuenta para pagar el primer paquete. */
export interface SaldoDeLaCompra {
  /** El saldo leído, con siete decimales, o `null` si no hay (o no se pudo leer). */
  saldo: string | null;
  /** Hay saldo y no alcanza: lo que hay y lo que falta, para el renglón del panel. */
  corto: SaldoCorto | null;
  fase: FaseDelSaldo;
  /** No se sabe si salió el pago con el saldo: no se ofrece pagar de nuevo. */
  incierto: boolean;
  motivo: MotivoDelPago | null;
}

/** La compra al empezar: nada pedido, y el primer paquete si se vende. */
export function pagoInicial(idioma: "es" | "en", alta: ProductoALaVenta | null, medios: readonly MedioDePago[] = MEDIOS_DE_PAGO): PagoEnLaVista {
  return { idioma, alta, medios, fase: "ofrecer", orden: null, falta: null, buscando: false, noVisto: false, tarda: false, noLlego: false, vencida: false, error: null, arreglo: "probar" };
}

/** Para qué se abrió el paso: al entrar, al entrar con una lista lista, antes de sellar, antes de sortear o para recibir un premio. */
export type Para = "entrada" | "entrada-con-lista" | "sello" | "sorteo" | "premio";

/** El paso del premio se porta como el de la entrada (Seguir al final, sin Volver, sin cupón) y cambia solo lo que dice. */
export const comoEntrada = (p: Para): boolean => p === "entrada" || p === "premio";

export type Parte = "activar" | "proteger";

/**
 * Lo que está corriendo ahora. `esperando`: el voto salió y la cuenta todavía no aparece. `canjeando`: el cupón.
 * `reclamando`: el pedido del regalo, antes de lo que sigue (la misma cadena que el cupón).
 */
export type Corre =
  | "revisando"
  | "activando"
  | "esperando"
  | "desbloqueo"
  | "mandando"
  | "confirmando"
  | "cerrando"
  | "canjeando"
  | "reclamando"
  | null;

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
  /** «Sortear en Prueba»: pasa a Prueba y entra solo con la cuenta de prueba, con la lista intacta. */
  | "practicar"
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
  /** «Activar mi cuenta» con el regalo a la vista: lo pide al servidor y sigue la cadena del cupón. */
  | "reclamar"
  /** «Volver» desde el campo del cupón. */
  | "volver-cupon"
  /** «Probar de nuevo» cuando no se supo el acceso: solo vuelve a preguntar. */
  | "leer-acceso"
  /** «Probar de nuevo» después del canje: sigue desde lo que no salió, sin volver a canjear. */
  | "seguir-cupon"
  /** «3 sorteos oficiales por 3 dólares»: con un solo medio de pago pide la orden; con más, pregunta cómo pagar. */
  | "comprar"
  /** Un medio de pago (el del botón, `medio`): pide la orden con ese medio. */
  | "pago-medio"
  /** Estoy en Bolivia, en el panel de pagar desde otra app: recuerda el medio y lleva al QR del banco. */
  | "estoy-en-bolivia"
  /** «Pagar con mi saldo»: pide la orden para pagarla con el saldo de la cuenta. */
  | "pago-saldo"
  /** La confirmación propia del pago con el saldo: paga esa orden, una vez. */
  | "saldo-pagar"
  /** Desde el pago con el saldo, los datos para pagar desde otra app (la misma orden). */
  | "saldo-otro-medio"
  /** «Ya pagué»: pregunta por el pago, y sigue mirando (y «Probar de nuevo» si no se pudo mirar). */
  | "ya-pague"
  /** «No llegó», a los 5 minutos: dice lo de la red equivocada. */
  | "no-llego"
  /** «Pedir una nota nueva»: la orden venció; se pide de nuevo. */
  | "otra-nota"
  /** «Volver» desde el pago: a la caja del acceso. */
  | "volver-pago";

/** Un texto: la clave y lo que va en sus huecos (`{mail}`, `{s}`). */
export interface Texto {
  clave: string;
  vars?: Record<string, string>;
  /** Otro texto que sigue en la misma línea, separado por un espacio («Te quedan 3 sorteos oficiales. Vencen el…»). */
  luego?: Texto;
}

export interface Boton extends Texto {
  accion: Accion;
  apagado: boolean;
  /** El medio de pago del botón, en «pago-medio». */
  medio?: string;
  /** Apagado porque esto mismo está corriendo («Activando tu cuenta…»), no porque falta algo (el código sin escribir). */
  ocupado?: boolean;
}

/** Lo secundario dentro de una caja: un botón con borde, o uno de texto subrayado. */
export interface Secundario extends Boton {
  forma: "boton" | "texto";
  /** La explicación del desbloqueo, plegada hasta que la persona la pida. */
  ayuda?: Texto;
}

export type EstadoDeCaja = "falta" | "espera" | "revisando" | "haciendo" | "lista" | "no-salio";

export interface CajaVista {
  parte: Parte;
  numero: 1 | 2;
  estado: EstadoDeCaja;
  titulo: string;
  abierta: boolean;
  /** La caja pide la pantalla para ella sola, aunque la otra parte todavía falte. */
  sola?: true;
  /** La explicación del desbloqueo cuando su botón es la principal, plegada hasta que la persona la pida. */
  ayuda?: Texto;
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
  /**
   * Lo que va plegado en Más detalles, al final de la caja: en las filas de la compra, lo que no hace falta para el
   * paso siguiente (poco texto a la vista: una sola línea por estado).
   */
  detalles?: Texto[];
  /** Los datos para pagar, de la orden: solo en la fila de pagar. Lo plegado del pago va dentro del panel. */
  pago?: PanelDePago | null;
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
  /** La línea propia del final cuando la cuenta quedó lista con el regalo: cuántos sorteos quedan y cuándo vencen. */
  linea?: Texto;
  /**
   * El enlace chico «Sortear en Prueba» del final, cuando la cuenta quedó activada sin el regalo y sin sorteos: en
   * Prueba se puede sortear ya, sin esperar. Sin el cambio de modo, no va.
   */
  practicar?: Boton;
  /** La línea de estado del pie (`role="status"`). */
  estado: Texto | null;
  notas: string[];
  /** Las dos salidas. Sin ellas, al final. `prueba` falta cuando «Pasar a Prueba» ya es la principal. */
  salidas: { prueba: { apagado: boolean } | null; cerrar: { apagado: boolean } } | null;
}

/** La forma de la pantalla que le toca a una vista, ya decidida sin DOM. */
export interface Portada {
  forma: "final" | "revisando" | "uno" | "dos";
  titulo: string;
  linea: Texto | null;
  /** Las cajas que se dibujan: la actual en `uno`, las dos pendientes en `dos`, ninguna en las otras formas. */
  filas: CajaVista[];
}

/**
 * Decide cuánto se ve sin cambiar el orden ni el estado del paso. Mientras se revisa no se adivina cuánto falta. Con una
 * sola parte pendiente se muestra solo esa; con dos, dos renglones breves. Un campo, un error, una nota o una caja que
 * pide estar sola llevan siempre a la forma de un solo paso, aunque la otra parte todavía falte.
 */
export function portadaDe(v: Vista): Portada {
  if (v.final) {
    // La línea del final: la propia de la vista (la del premio), la del primer sello, o el aviso de la compu o el celular
    // que no es tuyo, que va debajo del título como la línea de los demás estados (en el pie empujaría el botón). Una sola.
    const aviso = v.estado && v.estado.clave.startsWith("clAparatoListo") ? v.estado : null;
    // Con el regalo recién recibido, la línea dice cuántos sorteos quedan y cuándo vencen (salvo el aviso del aparato,
    // que importa más). Sin el regalo, como siempre.
    const delRegalo = v.linea ? (aviso ?? v.linea) : null;
    const linea: Texto | null = v.bajada ? { clave: v.bajada } : delRegalo ?? (v.primerOficial ? { clave: "clPrimerSello" } : aviso);
    return { forma: "final", titulo: v.titulo, linea, filas: [] };
  }
  if (v.cajas.some((c) => c.estado === "revisando")) {
    return { forma: "revisando", titulo: "clTitulo", linea: null, filas: [] };
  }
  const pendientes = v.cajas.filter((c) => c.estado !== "lista");
  const actual = v.cajas.find((c) => c.abierta) ?? pendientes[0] ?? v.cajas[0];
  if (!actual) return { forma: "revisando", titulo: "clTitulo", linea: null, filas: [] };
  const sola = pendientes.length <= 1 || actual.campo !== null || !!actual.error?.length || actual.nota !== null || actual.sola === true;
  if (sola) {
    // Con un error a la vista, la primera línea de la caja sigue ahí: el error va debajo y no la reemplaza.
    const linea = actual.textos[0] ?? null;
    return { forma: "uno", titulo: actual.titulo, linea, filas: [actual] };
  }
  return { forma: "dos", titulo: "clTitulo", linea: v.bajada ? { clave: v.bajada } : null, filas: pendientes };
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
 * la cuenta ya esté activada y protegida; y también si el paso se abrió para usar un cupón y todavía no se usó. Con
 * `premio`, el acceso solo cuenta para activar una cuenta que todavía no existe en la red: ya activada no se le piden
 * sorteos, cupón ni compra. Sin `para`, como siempre.
 */
export function faltaElAcceso(e: Pick<EntradaVista, "acceso" | "corre"> & Partial<Pick<EntradaVista, "para" | "activacion">>): boolean {
  const a = accesoDe(e);
  if (a.modo !== "servidor") return false;
  // Quien ganó no canjea ni compra: sin la cuenta activada, solo el acceso que confirma el servidor la deja activar.
  if (e.para === "premio") return e.activacion !== "lista" && a.estado !== "con";
  if (a.fallaTrasCanje || a.cadena || e.corre === "canjeando" || e.corre === "reclamando") return true;
  return a.estado !== "con" || (a.pideCupon && a.canjeado === null);
}

/**
 * El paso se abrió para usar un cupón («Se te acabaron», la caja de la red) con la cuenta ya activada y protegida: no hay
 * nada a medias, así que se puede volver a la página con «Volver» (y con Escape). Mientras se canjea, o con lo que sigue
 * al canje en marcha, no. Al entrar tampoco: ahí no se abre para un cupón.
 */
export function puedeVolverDelCupon(e: Pick<EntradaVista, "acceso" | "corre" | "activacion" | "proteccion" | "para">): boolean {
  const a = accesoDe(e);
  if (a.modo !== "servidor" || !a.pideCupon || a.cadena || e.corre === "canjeando") return false;
  return e.activacion === "lista" && e.proteccion === "lista" && !comoEntrada(e.para);
}

/** «Activar» se puede ofrecer: como siempre, o con el acceso confirmado por el servidor. Nunca en `cerrado`. */
export function activarPermitido(e: Pick<EntradaVista, "acceso" | "corre"> & Partial<Pick<EntradaVista, "para" | "activacion">>): boolean {
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
  rara: ["clErrRara"],
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
    return { caja: { ...caja, estado: "no-salio", abierta: true, error: textos(TEXTO_DE_LA_FALLA[f]) }, principal: principalDeLaFalla(f) };
  }
  if (e.corre === "activando" || e.corre === "esperando") {
    return {
      caja: { ...caja, estado: "haciendo", abierta: true, textos: textos([lead]), ocupada: true },
      principal: ocupado("activar", "clActivarHaciendo"),
    };
  }
  if (e.corre === "revisando" || e.activacion === "preparando") {
    return { caja: { ...caja, estado: "revisando", ocupada: true }, principal: ocupado("leer", "clRevisando") };
  }
  if (e.activacion === "fallo") {
    return { caja: { ...caja, estado: "no-salio", abierta: true, error: textos(["clErrFallo"]) }, principal: boton("leer", "clProbarDeNuevo") };
  }
  if (e.activacion === "no-se-sabe") {
    return { caja: { ...caja, estado: "no-salio", abierta: true, error: textos(["clErrRed"]) }, principal: boton("leer", "clProbarDeNuevo") };
  }
  return {
    caja: { ...caja, estado: "falta", abierta: true, textos: textos([lead]) },
    principal: boton("activar", "clActivarBoton", e.corre !== null),
  };
}

/**
 * La parte 1 en la red principal sin el acceso por cupón en el build: no hay a quién preguntarle, así que no se activa.
 * Se dice lo cierto (ahora no se pueden activar cuentas nuevas) y la principal es «Pasar a Prueba», si se puede.
 */
function cerradoActual(e: EntradaVista, caja: CajaVista): Armado {
  if (e.falla === "sesion") {
    return { caja: { ...caja, estado: "no-salio", abierta: true, error: textos(["clErrSesion"]) }, principal: principalDeLaFalla("sesion") };
  }
  return {
    caja: { ...caja, estado: "no-salio", abierta: true, sola: true, error: textos(["clErrServicio"]) },
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
 * Debajo, siempre `altaNoTengo`. Con la compra en el build (`acceso.pago`): sin cupón y con el primer paquete a la venta,
 * la principal es comprarlo y «Tengo un cupón» pasa a secundaria; sin nada a la venta, la de siempre con el texto sin
 * compra; y con la compra empezada, sus filas (`filaDelPago`).
 */
function accesoActual(e: EntradaVista, caja: CajaVista): Armado {
  const a = accesoDe(e);
  const activada = e.activacion === "lista";
  const base: CajaVista = { ...caja, titulo: activada ? "altaTituloSorteos" : "clActivarTitulo", abierta: true };
  const usar = activada ? "cupoOfUsarCupon" : "altaActivarConCupon";
  const cierre = textos(["altaNoTengo"]);
  if (e.falla === "sesion") {
    return { caja: { ...base, estado: "no-salio", error: textos(["clErrSesion"]) }, principal: principalDeLaFalla("sesion") };
  }
  // Algo después del canje no salió: el cupón quedó en la cuenta, y «Probar de nuevo» sigue desde ahí.
  if (a.fallaTrasCanje) {
    // Con el regalo no hay cupón que nombrar: lo que no salió es activar la cuenta.
    const clave = a.delRegalo ? "clErrFallo" : "altaCuponGuardado";
    return { caja: { ...base, estado: "no-salio", error: textos([clave]) }, principal: boton("seguir-cupon", "clProbarDeNuevo") };
  }
  // Lo que sigue al canje: esperar el pedido, activar y volver a preguntar.
  if (a.cadena) {
    const n = a.canjeado ?? 0;
    // Lo que trajo el cupón. Con el regalo no hay cupón que nombrar: solo el botón que dice que se está activando.
    const delCupon = !activada && n > 0 && !a.delRegalo;
    const t: Texto[] = delCupon ? [n === 1 ? { clave: "altaCuponOk1" } : { clave: "altaCuponOk", vars: { n: String(n) } }] : [];
    const principal = ocupado("usar-cupon", e.corre === "revisando" ? "clRevisando" : "clActivarHaciendo");
    return { caja: { ...base, estado: "haciendo", sola: true, textos: t, ocupada: true }, principal };
  }
  if (a.estado === "revisando" || (e.corre === "revisando" && e.activacion !== "lista")) {
    return { caja: { ...base, estado: "revisando", abierta: false, ocupada: true }, principal: ocupado("leer-acceso", "clRevisando") };
  }
  if (a.estado === "error") {
    const err = a.error ? [a.error] : textos(["altaErrServicio"]);
    const principal = principalDelArreglo(e, a.arreglo, boton("leer-acceso", "clProbarDeNuevo"));
    return { caja: { ...base, estado: "no-salio", error: err }, principal };
  }
  // La compra del primer paquete: solo sin acceso (quien ya tiene acceso no compra el primero) y con la compra en el build.
  const pago = a.pago && a.estado === "ninguno" && !a.pideCupon ? a.pago : null;
  // Con la compra empezada, su fila; «Tengo un cupón» desde ahí abre el campo, y su «Volver» vuelve a la compra. Pagando
  // sin la orden en mano no hay qué mostrar: la caja de la compra, sin inventar nada.
  if (pago && pago.fase !== "ofrecer" && !(pago.fase === "pagando" && !pago.orden) && !a.escribiendo) return filaDelPago(e, base, pago);
  const canjeando = e.corre === "canjeando";
  const error = a.error ? [a.error] : null;
  const estado: EstadoDeCaja = canjeando ? "haciendo" : error ? "no-salio" : "falta";
  // Con la compra en el build, el texto que nombra un paquete va solo con el botón de comprarlo; si no, el de sin compra.
  const sinVenta = a.pago ? "SinVenta" : "";
  // Con un error a la vista, el motivo va antes que la explicación de siempre: en un celular chico no entran los dos.
  const lead: Texto[] = error ? [] : [{ clave: `${activada ? "altaYaActivada" : "altaTexto"}${sinVenta}` }];
  const conArreglo = (p: Boton): Boton | null => (canjeando ? p : principalDelArreglo(e, a.arreglo, p));
  if (a.escribiendo) {
    return {
      // Con «Volver» a la página a la vista, el campo no repite otro «Volver».
      caja: {
        ...base,
        estado,
        error,
        campo: "cupon",
        ocupada: canjeando,
        secundarios: puedeVolverDelCupon(e) ? [] : [{ ...boton("volver-cupon", "clVolver", canjeando), forma: "texto" }],
        cierre,
      },
      principal: canjeando ? ocupado("usar-cupon", "altaRevisando") : conArreglo(boton("usar-cupon", usar, !a.campoOk)),
    };
  }
  if (a.cuponEnMano) {
    return {
      caja: {
        ...base,
        estado,
        sola: true,
        textos: [{ clave: "altaCuponListo", vars: { codigo: a.cuponEnMano } }],
        error,
        ocupada: canjeando,
        secundarios: [{ ...boton("otro-cupon", "altaOtroCupon", canjeando), forma: "texto" }],
        cierre,
      },
      principal: canjeando ? ocupado("usar-cupon", "altaRevisando") : conArreglo(boton("usar-cupon", usar)),
    };
  }
  // El regalo de quien entra con su cuenta, sin cupón en mano: «Activar mi cuenta» lo pide y sigue como el cupón.
  if (a.bienvenida && a.estado === "ninguno" && !a.pideCupon) return regaloActual(e, base, a.bienvenida);
  // Sin cupón y con el primer paquete a la venta: comprarlo es la principal, con el precio del servidor, y el cupón al lado.
  // Poco texto: a la vista, una sola línea (o el error); que la cuenta queda activada y qué hacer sin cupón, plegados.
  if (pago?.alta) {
    const errores = error ?? (pago.error ? [pago.error] : null);
    const textosCompra: Texto[] = errores ? [] : [{ clave: activada ? "altaYaActivada" : "altaTexto" }];
    const detalles: Texto[] = [...(activada ? [] : [{ clave: "altaPrimerPaqueteNota" }]), ...cierre];
    const comprar = boton("comprar", "altaPrimerPaquete", false, varsDelProducto(pago.alta, pago.idioma));
    return {
      caja: {
        ...base,
        estado: errores ? "no-salio" : "falta",
        textos: textosCompra,
        error: errores,
        secundarios: [{ ...boton("tengo-cupon", "altaTengoCupon"), forma: "boton" }],
        cierre: [],
        detalles,
      },
      principal: principalDelArreglo(e, error ? a.arreglo : pago.arreglo, comprar),
    };
  }
  // Sin cupón y sin nada a la venta: «Tengo un cupón». Si la compra se frenó al pedirla, se dice por qué, y ese motivo es
  // la única línea a la vista: qué hacer sin cupón queda plegado en Más detalles.
  const errores = error ?? (pago?.error ? [pago.error] : null);
  const frenada = !!errores && !error;
  const sinCompra = frenada
    ? { estado: "no-salio" as const, textos: [] as Texto[], cierre: [] as Texto[], detalles: cierre }
    : { estado, textos: lead, cierre };
  return { caja: { ...base, ...sinCompra, error: errores }, principal: conArreglo(boton("tengo-cupon", "altaTengoCupon")) };
}

/**
 * La caja del regalo: un título, una línea y un botón. La línea dice cuántos sorteos trae (`lista`) o que hoy ya se
 * entregaron y que se pueden recibir más tarde (`llena`, también con el regalo cerrado a propósito). La principal es
 * «Activar mi cuenta» en los dos casos: con `llena` la cuenta se activa igual, y el regalo se puede recibir después.
 * «Tengo un cupón» queda como salida chica. Con un error, el motivo en lugar de la
 * línea y la principal según lo que lo arregla (sin red, la misma: probar de nuevo).
 */
function regaloActual(e: EntradaVista, base: CajaVista, b: NonNullable<AccesoEnLaVista["bienvenida"]>): Armado {
  const a = accesoDe(e);
  const reclamando = e.corre === "reclamando";
  const error = a.error ? [a.error] : null;
  // Con `llena`, la misma línea dice que el regalo se puede recibir más tarde: la cuenta se activa igual ahora.
  const llena: Texto = { clave: "altaBienvenidaLlena", luego: { clave: "altaBienvenidaMasTarde" } };
  const linea: Texto = b.estado === "lista" ? { clave: "altaBienvenida", vars: { n: String(b.sorteos) } } : llena;
  const activar = boton("reclamar", "clActivarBoton", e.corre !== null);
  return {
    caja: {
      ...base,
      estado: reclamando ? "haciendo" : error ? "no-salio" : "falta",
      // Sola: la línea del regalo se ve aunque falte proteger, como la del cupón en mano.
      sola: true,
      textos: error ? [] : [linea],
      error,
      ocupada: reclamando,
      secundarios: [{ ...boton("tengo-cupon", "altaTengoCupon", reclamando), forma: "texto" }],
    },
    principal: reclamando ? ocupado("reclamar", "clActivarHaciendo") : principalDelArreglo(e, a.arreglo, activar),
  };
}

/**
 * La línea del final cuando la cuenta quedó lista con el regalo: cuántos sorteos oficiales quedan y, si se sabe, cuándo
 * vencen, con las mismas claves y las mismas reglas del singular que la línea del cupo (`cupo-oficial.ts`).
 */
function lineaDelRegalo(s: NonNullable<AccesoEnLaVista["sorteosDelRegalo"]>, gratis = false): Texto {
  // «Gratis» solo cuando todo lo que tiene la cuenta es el regalo recibido: con sorteos de antes no se sabe de cuáles se habla.
  const quedan: Texto = gratis
    ? s.quedan === 1 ? { clave: "cupoOfRegalo1" } : { clave: "cupoOfRegalo", vars: { n: String(s.quedan) } }
    : s.quedan === 1 ? { clave: "cupoOfQueda1" } : { clave: "cupoOfQuedan", vars: { n: String(s.quedan) } };
  const v = s.vence;
  if (!v || !(v.cuantos > 0) || !v.fecha) return quedan;
  const todos = v.cuantos >= s.quedan;
  const clave = todos ? (s.quedan === 1 ? "cupoOfVenceSolo" : "cupoOfVencenTodos") : v.cuantos === 1 ? "cupoOfVence1" : "cupoOfVencen";
  return { ...quedan, luego: { clave, vars: { n: String(v.cuantos), fecha: v.fecha } } };
}

/**
 * Las filas de la compra ya empezada (cómo pagar, pidiendo la orden y pagando), con el título del paquete. Una sola
 * principal en cada una; las salidas, como siempre, en el pie. Lo que se muestra para pagar sale entero de la orden.
 * Poco texto: una sola línea a la vista (cómo pagar, lo que pasó con el pago o el error), los datos con su rótulo, y lo
 * demás plegado en Más detalles, dentro del panel.
 */
function filaDelPago(e: EntradaVista, caja: CajaVista, p: PagoEnLaVista): Armado {
  const base: CajaVista = { ...caja, titulo: "pagoTitulo", sola: true };
  const error = p.error ? [p.error] : null;
  const estado: EstadoDeCaja = error ? "no-salio" : "falta";
  const volver: Secundario = { ...boton("volver-pago", "clVolver"), forma: "texto" };
  const conArreglo = (b: Boton): Boton | null => principalDelArreglo(e, p.arreglo, b);
  const medio = (m: MedioDePago): Boton => (m.id === "saldo" ? boton("pago-saldo", m.clave) : { ...boton("pago-medio", m.clave), medio: m.id });
  if (p.fase === "pidiendo") return { caja: { ...base, estado: "haciendo", ocupada: true }, principal: ocupado("pago-medio", "pagoPreparando") };
  const o = p.orden;
  const saldo = p.conSaldo?.saldo ?? null;
  if (p.fase === "elegir" || !o) {
    const [primero, ...otros] = p.medios;
    // Con el saldo entre los medios, la línea dice cuánto hay: con eso se entiende qué se está eligiendo.
    const linea: Texto = saldo && p.medios.some((m) => m.id === "saldo") ? lineaDelSaldo(saldo, p.idioma) : { clave: "pagoComoPagar" };
    return {
      caja: { ...base, estado: "falta", textos: [linea], secundarios: [...otros.map((m): Secundario => ({ ...medio(m), forma: "boton" })), volver] },
      principal: primero ? medio(primero) : null,
    };
  }
  // Con el saldo: la confirmación propia, el pago y después lo que diga el servidor (`pago-saldo.ts`).
  if (p.medio === "saldo" && saldo && p.conSaldo) {
    const c = p.conSaldo;
    const mirando = c.fase === "mirando" || c.incierto;
    const s = vistaDelSaldo({ idioma: p.idioma, saldo, fase: c.fase, incierto: c.incierto, motivo: c.motivo, buscando: p.buscando, tarda: p.tarda, errorDelSondeo: mirando ? p.error : null }, o);
    const a = (b: { accion: string; clave: string; vars?: Record<string, string>; apagado: boolean; ocupado?: boolean }): Boton => ({ ...b, accion: b.accion as Accion });
    const corriendo = c.fase === "pagando" || p.buscando;
    const err = s.error ? [s.error] : null;
    return {
      caja: {
        ...base,
        estado: err ? "no-salio" : corriendo ? "haciendo" : "falta",
        textos: s.textos,
        error: err,
        ocupada: corriendo,
        // Mientras se paga no se cambia nada. Después, Volver (y el otro medio, si todavía se puede).
        secundarios: c.fase === "pagando" ? [] : [...s.secundarios.map((b): Secundario => ({ ...a(b), forma: "texto" })), volver],
        cierre: [],
        pago: null,
      },
      principal: a(s.principal),
    };
  }
  const fecha = fechaDeAlta(o.vence, p.idioma);
  const buscando = ocupado("ya-pague", "pagoBuscando");
  // Vencida sin nada pagado: no se muestra para pagar (una nota vencida no se usa), pero «Ya pagué» queda por si pagó.
  if (vencidaSinPagar(p)) {
    return {
      caja: {
        ...base,
        estado,
        textos: error ? [] : [{ clave: "pagoVencida", vars: { fecha } }],
        error,
        ocupada: p.buscando,
        secundarios: p.buscando ? [volver] : [{ ...boton("ya-pague", "pagoYaPague"), forma: "texto" }, volver],
      },
      principal: p.buscando ? buscando : conArreglo(boton("otra-nota", "pagoOtraNota")),
    };
  }
  const corto = p.conSaldo?.corto ?? null;
  const panel: PanelDePago = panelDe(o, e.correoSesion, p.idioma, corto ? textoDelCorto(corto, p.idioma) : null, !!p.cambio, p.noLlego);
  // Mientras se paga, el cupón y las salidas van de texto: lo que pesa a la vista son los datos y Ya pagué.
  const secundarios: Secundario[] = [{ ...boton("tengo-cupon", "altaTengoCupon"), forma: "texto" }];
  if (p.tarda && !p.noLlego && !p.buscando) secundarios.push({ ...boton("no-llego", "pagoNoLlegoBoton"), forma: "texto" });
  secundarios.push(volver);
  const linea = lineaDelPago(p, !!error);
  return {
    caja: { ...base, estado, textos: linea.textos, nota: linea.nota, error, ocupada: p.buscando, secundarios, cierre: [], pago: panel },
    principal: p.buscando ? buscando : conArreglo(boton("ya-pague", error ? "clProbarDeNuevo" : "pagoYaPague")),
  };
}

/** La caja de proteger (o de confirmar este navegador) cuando es la que toca. */
function protegerActual(e: EntradaVista, caja: CajaVista): Armado {
  const aparato = e.proteccion === "aparato-nuevo";
  const base: CajaVista = { ...caja, titulo: aparato ? "clAparatoTitulo" : "clProtegerTitulo", abierta: true };
  // La sesión se cerró: nada de lo de acá sirve sin entrar de nuevo.
  if (e.falla === "sesion") {
    return { caja: { ...base, estado: "no-salio", error: textos(["clErrSesion"]) }, principal: principalDeLaFalla("sesion") };
  }
  if (e.corre === "revisando") {
    return { caja: { ...base, estado: "revisando", abierta: false, ocupada: true }, principal: ocupado("leer", "clRevisando") };
  }
  if (sinForma(e)) {
    return {
      caja: {
        ...base,
        titulo: "clSinFormaTitulo",
        estado: "falta",
        sola: true,
        textos: textos(["clSinForma"]),
        detalles: textos(["clSinFormaPista", "clContacto"]),
      },
      principal: e.puedePasarAPrueba ? boton("pasar-a-prueba", "modeSwitchToTest") : null,
    };
  }
  if (e.proteccion === "no-se-sabe") {
    return { caja: { ...base, estado: "no-salio", error: textos(["clErrRed"]) }, principal: boton("leer", "clProbarDeNuevo") };
  }
  const falla = e.falla && FALLAS_DE_PROTEGER.has(e.falla) ? e.falla : null;
  const esNota = falla === "desbloqueo-bloqueado";
  const errorDeLaCaja = falla && !esNota ? textos(TEXTO_DE_LA_FALLA[falla]) : null;
  const nota: Texto | null = esNota ? { clave: "protPasskeyBloqueada" } : null;
  const estadoFalta: EstadoDeCaja = errorDeLaCaja ? "no-salio" : "falta";
  const desbloqueoClave = cel(e, "clDesbloqueo");
  // El desbloqueo se ofrece si el navegador lo tiene; para confirmar este navegador, además, la cuenta tiene que tener
  // una llave guardada (el desbloqueo de otro celular no sirve acá en una compu).
  const ofreceDesbloqueo = e.hayDesbloqueo && (!aparato || e.tieneLlaves);
  // El desbloqueo siempre ofrece su explicación plegada: en su botón, o en la caja si es la principal del pie.
  const ayudaDesbloqueo: Texto = { clave: cel(e, "clDesbloqueoAyuda") };
  const desbloqueoSecundario = (): Secundario => ({ ...boton("desbloqueo", desbloqueoClave), forma: "texto", ayuda: ayudaDesbloqueo });

  if (e.corre === "desbloqueo" || e.corre === "confirmando") {
    return {
      caja: {
        ...base,
        titulo: e.codigo ? "protCodeTitulo" : base.titulo,
        estado: "haciendo",
        ocupada: true,
        campo: e.codigo && e.corre === "confirmando" ? "codigo" : null,
      },
      principal: ocupado(e.corre === "desbloqueo" ? "desbloqueo" : "confirmar-codigo", aparato ? "clEstadoConfirmando" : "protHaciendo"),
    };
  }

  // Con el código mandado: el campo del código y «Confirmar».
  if (e.codigo) {
    const t: Texto[] = [{ clave: "protCodeLead", vars: { mail: e.codigo.a } }];
    if (e.codigo.segundos >= SPAM_S) t.push({ clave: "clCorreoSpam" });
    const falta = Math.max(0, OTRO_CODIGO_S - e.codigo.segundos);
    const vencio = falla === "codigo-vencido" || falla === "codigo-viejo";
    // Con un código que no sirvió, la salida (otro código, el desbloqueo) se ve enseguida: no hay por qué esperar.
    const pideOtro = vencio || falla === "codigo-malo";
    const conSalidas = pideOtro || e.codigo.segundos >= SPAM_S;
    const sec: Secundario[] = [];
    // Sin error, otro código y el desbloqueo aparecen junto al aviso de Spam, no desde el segundo cero.
    if (!vencio && conSalidas) {
      const otro = falta > 0
        ? boton("otro-codigo", "clOtroCodigoEn", true, { s: String(falta) })
        : boton("otro-codigo", "protOtroCodigo", e.corre === "mandando");
      sec.push({ ...otro, forma: "texto" });
    }
    if (!aparato) sec.push({ ...boton("otro-correo", "protOtroCorreo"), forma: "texto" });
    if (ofreceDesbloqueo && conSalidas) sec.push(desbloqueoSecundario());
    return {
      caja: {
        ...base,
        titulo: "protCodeTitulo",
        estado: estadoFalta,
        textos: t,
        error: errorDeLaCaja,
        nota,
        campo: vencio ? null : "codigo",
        secundarios: sec,
      },
      principal: vencio
        ? e.corre === "mandando" ? ocupado("otro-codigo", "protEnviando") : boton("otro-codigo", "protOtroCodigo")
        : boton("confirmar-codigo", "protCodeGo", !e.campoOk),
    };
  }

  const mandando = e.corre === "mandando";
  const notaRecarga: Texto | null = e.codigoRecargado ? { clave: "clCodigoRecargado" } : nota;

  // Otro celular u otra compu: siempre el correo de la cuenta primero.
  if (aparato) {
    const t = textos([cel(e, "clAparatoTexto")]);
    if (!e.correoConfirmado) {
      // Sin correo, solo con una llave guardada.
      const caja: CajaVista = {
        ...base,
        estado: estadoFalta,
        sola: true,
        textos: t,
        ayuda: ayudaDesbloqueo,
        error: errorDeLaCaja,
        nota: notaRecarga,
      };
      return { caja, principal: boton("desbloqueo", desbloqueoClave) };
    }
    const sec: Secundario[] = ofreceDesbloqueo && e.celular ? [desbloqueoSecundario()] : [];
    const mandar = mandando
      ? ocupado("mandar-codigo", "protEnviando")
      : e.correoCuenta
        ? boton("mandar-codigo", "clMandarA", false, { mail: e.correoCuenta })
        : boton("mandar-codigo", "clMandarATuCorreo");
    return { caja: { ...base, estado: estadoFalta, textos: t, error: errorDeLaCaja, nota: notaRecarga, secundarios: sec }, principal: mandar };
  }

  // La cuenta nueva: proteger con el desbloqueo o con un código al correo.
  const t = textos([cel(e, "clProtegerTexto")]);
  const aMano = e.eligioCorreo || !e.correoSesion;
  const mandarSesion = (): Boton => (mandando
    ? ocupado("mandar-codigo", "protEnviando")
    : boton("mandar-codigo", "clMandarA", false, { mail: e.correoSesion }));
  const mandarAMano = (): Boton => (mandando ? ocupado("mandar-a-mano", "protEnviando") : boton("mandar-a-mano", "protMailGo", !e.campoOk));
  const desbloqueoPrimero = e.celular && ofreceDesbloqueo && !e.desbloqueoFallo && !e.eligioCorreo && !e.codigoRecargado;
  if (desbloqueoPrimero) {
    const sec: Secundario[] = [aMano ? { ...mandarAMano(), forma: "texto" } : { ...mandarSesion(), forma: "texto" }];
    return {
      caja: {
        ...base,
        estado: estadoFalta,
        textos: t,
        ayuda: ayudaDesbloqueo,
        error: errorDeLaCaja,
        nota,
        campo: aMano ? "correo" : null,
        secundarios: sec,
      },
      principal: boton("desbloqueo", desbloqueoClave, mandando),
    };
  }
  // «Mandar el código a otro correo» y no «Usar otro correo»: acá todavía no se leyó a qué correo va el de la principal.
  const sec: Secundario[] = [];
  if (!aMano) sec.push({ ...boton("otro-correo", "clOtroCorreo"), forma: "texto" });
  if (ofreceDesbloqueo) sec.push(desbloqueoSecundario());
  return {
    caja: { ...base, estado: estadoFalta, textos: t, error: errorDeLaCaja, nota: notaRecarga, campo: aMano ? "correo" : null, secundarios: sec },
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
  if (e.corre === "reclamando") return { clave: "clActivarHaciendo" };
  if (e.lento && (e.corre === "revisando" || accesoDe(e).estado === "revisando")) return { clave: "clActivarLento" };
  const pago = accesoDe(e).pago;
  if (pago?.buscando && pago.fase === "pagando" && faltaElAcceso(e)) return { clave: "pagoBuscando" };
  return e.aviso ? { clave: e.aviso } : null;
}

/**
 * La parte 1 de quien ganó, con la cuenta sin activar y sin el acceso confirmado: espera a que su premio quede a su nombre.
 * Sin cupón, sin compra y sin Pasar a Prueba. La principal solo vuelve a preguntar el acceso, nunca activa.
 */
function premioActual(e: EntradaVista, caja: CajaVista): Armado {
  const a = accesoDe(e);
  const base: CajaVista = { ...caja, titulo: "clPremioEsperaTitulo", abierta: true, sola: true };
  // La sesión se cerró: lo único que sirve es entrar de nuevo.
  if (e.falla === "sesion" || (a.estado === "error" && a.arreglo === "entrar")) {
    const err = textos(["clErrSesion"]);
    return { caja: { ...base, titulo: "clActivarTitulo", estado: "no-salio", error: err }, principal: principalDeLaFalla("sesion") };
  }
  if (a.estado === "revisando" || e.corre === "revisando") {
    return { caja: { ...base, estado: "revisando", abierta: false, ocupada: true }, principal: ocupado("leer-acceso", "clRevisando") };
  }
  // El acceso quedó en otra cuenta: probar de nuevo no lo arregla. Se dice con su texto y queda solo Cerrar sesión.
  if (a.estado === "error" && a.arreglo === "ninguno") {
    const err = a.error ? [a.error] : textos(["clPremioEspera"]);
    return { caja: { ...base, titulo: "clActivarTitulo", estado: "no-salio", error: err }, principal: null };
  }
  // Sin acceso todavía (quien organiza no la nombró) o el servicio no contestó: la espera, con Probar de nuevo.
  return { caja: { ...base, estado: "falta", textos: textos(["clPremioEspera"]) }, principal: boton("leer-acceso", "clProbarDeNuevo") };
}

/** La parte 1 cuando es la que toca: la caja del cupón si falta el acceso, cerrada sin a quién preguntar, o activar. */
function parte1Actual(e: EntradaVista, caja: CajaVista): Armado {
  const a = accesoDe(e);
  if (faltaElAcceso(e)) return e.para === "premio" ? premioActual(e, caja) : accesoActual(e, caja);
  if (a.modo === "cerrado" && e.activacion !== "lista") return cerradoActual(e, caja);
  return activarActual(e, caja);
}

/** La vista del paso para lo que se sabe ahora. */
export function vistaDe(entrada: EntradaVista): Vista {
  // Quien vino a recibir un premio no tiene nada que hacer en Prueba: ninguna caja lo ofrece y no hay salida a Prueba.
  const premio = entrada.para === "premio";
  const e: EntradaVista = premio ? { ...entrada, puedePasarAPrueba: false } : entrada;
  const orden = ordenDe(e);
  const final = listaLa(e, "activar") && listaLa(e, "proteger");
  const actual = orden.find((p) => !listaLa(e, p)) ?? null;
  let principal: Boton | null = null;
  const cajas = orden.map((parte, i) => {
    const vacia = cajaVacia(parte, (i + 1) as 1 | 2);
    if (parte === "proteger" && e.proteccion === "aparato-nuevo") vacia.titulo = "clAparatoTitulo";
    if (parte === "activar" && e.activacion === "lista" && faltaElAcceso(e)) vacia.titulo = "altaTituloSorteos";
    if (listaLa(e, parte)) return { ...vacia, estado: "lista" as const };
    if (parte !== actual) return vacia;
    const armado = parte === "activar" ? parte1Actual(e, vacia) : protegerActual(e, vacia);
    principal = armado.principal;
    return armado.caja;
  });

  if (final) {
    const conLista = e.para === "entrada-con-lista" || e.para === "sello";
    const p = comoEntrada(e.para) ? boton("seguir", "clSeguir") : e.para === "sorteo" ? boton("sortear", "draw") : boton("sellar", "freeze");
    const acceso = accesoDe(e);
    const delRegalo = acceso.sorteosDelRegalo;
    // El regalo recibido en este paso, y nada más en la cuenta: eso son sorteos gratis.
    const gratis = acceso.delRegalo === true && delRegalo !== undefined && acceso.canjeado !== null && acceso.canjeado === delRegalo.quedan;
    // Con sorteos, cuántos quedan. La cuenta activada sin el regalo y sin sorteos lo dice, así no se entera al sellar, y
    // que se pueden recibir más tarde. Mientras tanto, el enlace chico para practicar en Prueba.
    const sinElRegalo = delRegalo?.lleno === true && delRegalo.quedan === 0;
    const conSorteos = delRegalo && delRegalo.quedan > 0 ? lineaDelRegalo(delRegalo, gratis) : null;
    // La cuenta que ya estaba activada: lo que dijo el servidor al abrir el paso.
    const delCupo = !delRegalo && acceso.cupo && acceso.cupo.quedan > 0 ? lineaDelRegalo(acceso.cupo) : null;
    const llena: Texto = { clave: "altaBienvenidaLlena", luego: { clave: "altaBienvenidaMasTarde" } };
    const linea = premio ? null : !delRegalo ? delCupo : sinElRegalo ? llena : conSorteos;
    // Con el nombre de «Se te acabaron», que lleva a lo mismo: «Practicar sin cuenta» diría lo contrario del título.
    const practicar = !premio && sinElRegalo && e.puedePasarAPrueba ? boton("practicar", "pagoSortearEnPrueba", e.corre === "cerrando") : null;
    return {
      ...(linea ? { linea } : {}),
      ...(practicar ? { practicar } : {}),
      final: true,
      titulo: "clListaTitulo",
      // Con el premio, la línea dice para qué quedó lista. Para quien organiza, como siempre, sin línea propia.
      bajada: premio ? "clPremioListo" : "",
      cajas,
      principal: e.corre === "cerrando" ? { ...p, apagado: true } : p,
      volver: comoEntrada(e.para) ? null : boton("volver", "clVolver"),
      // La confirmación del primer sello es de quien organiza: con `premio`, nunca (por eso acá queda `=== "entrada"`).
      primerOficial: (conLista || e.para === "entrada") && e.primerOficialPendiente,
      estado: lineaDeEstado(e),
      notas: [],
      salidas: null,
    };
  }

  // Cerrando sesión, la principal espera: la salida ya está en marcha.
  const p = principal as Boton | null;
  const principalFinal = p && e.corre === "cerrando" ? { ...p, apagado: true } : p;
  const notas: string[] = e.puedePasarAPrueba || premio ? [] : ["modeSwitchBlocked"];
  return {
    final: false,
    titulo: "clTitulo",
    bajada: "clBajada",
    cajas,
    principal: principalFinal,
    volver: puedeVolverDelCupon(e) ? boton("volver", "clVolver") : null,
    primerOficial: false,
    estado: lineaDeEstado(e),
    notas,
    salidas: {
      prueba: premio || principalFinal?.accion === "pasar-a-prueba" ? null : { apagado: !e.puedePasarAPrueba },
      cerrar: { apagado: e.corre === "cerrando" },
    },
  };
}
