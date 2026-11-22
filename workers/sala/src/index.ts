/**
 * La sala de Tinkazo: que la gente de un stand escanee un QR, escriba su nombre
 * en el celular y lo vea aparecer en la pantalla grande. Para sumarse así no
 * hace falta nada: los nombres alimentan rondas de ejemplo (modo stand) y nunca
 * van a un sorteo sellado ni a un comprobante. La misma sala también lleva el
 * registro de equipos de un evento con cupones: ahí cada equipo entra con su
 * cuenta de Stellar, que es la que recibe el cupón y entra a la lista sellada.
 *
 *   POST   /v1/campana                     JSON {"texto","firma"} → 201 {"id", "token", "vence"}
 *                                           (reemplazar la sala de ese evento que se cerró o venció pide su token en Authorization)
 *   POST   /v1/activar                     JSON {"texto","sesion"} → 200 {"texto","firma","evento","organizadora"}
 *                                           (firma la campaña con la llave automática si la comisión del evento se pagó desde la
 *                                           cuenta de Google de quien organiza; ver `activar.ts`)
 *   POST   /v1/mis-campanas                JSON {"sesion"} → 200 {"campanas":[...]}   (Tus campañas: las de la cuenta de la sesión;
 *                                           solo con TUS_CAMPANAS en "1"; ver `tus-campanas.ts`)
 *   POST   /v1/campana/recuperar           JSON {"sesion","evento"} → 200 {"estado":"viva","id","token","vence","fase"} (toma la sala)
 *                                           o {"estado":"activada","texto","firma","anterior"?} (para crear la sala en esta compu)
 *   POST   /v1/sala                        → 201 {"id", "token", "vence"}   (solo desde los orígenes permitidos)
 *   POST   /v1/sala/<id>                   JSON {"d","h","llave"}: alta 201 {"n"}, corrección 200 {"n","r"}
 *                                          (una sala anterior a la forma 2 también acepta `d` solo en text/plain)
 *   GET    /v1/sala/<id>/nombres?desde=N   Authorization: Bearer <token>   → 200 [{"n","d","r"?}]
 *   DELETE /v1/sala/<id>/nombres/<n>       Authorization: Bearer <token>   → 204
 *   GET    /v1/sala/<id>/pantalla          WebSocket; el token va en el primer mensaje, no en la dirección
 *   DELETE /v1/sala/<id>                   Authorization: Bearer <token>   → 204 (cierra la sala y borra todo)
 *   GET    /<id>                           la página del celular (HTML, con su CSS y JS adentro)
 *
 * Los equipos de un evento (el registro con cuenta de `equipos.html` en el sitio):
 *   PUT    /v1/sala/<id>/config            Authorization: Bearer <token>   JSON {modo, evento, cuenta} → 204
 *   GET    /v1/sala/<id>/publico           sin token: cómo es el registro y cuántos equipos van → 200 {config, equipos}
 *                                           (en una sala de campaña contesta {config: null, equipos: 0})
 *   POST   /v1/sala/<id>/equipos           JSON {cuenta, d, llave}, con d cifrado con la clave del QR (solo desde el sitio) → 201 {n, estado}
 *                                           (una cuenta ya anotada solo se reescribe con la misma llave: si no, 409 {"error":"ajena"})
 *   GET    /v1/sala/<id>/equipos?desde=V   Authorization: Bearer <token>   → 200 [{n, cuenta, d, estado, v}]
 *   GET    /v1/sala/<id>/equipos/<cuenta>  sin token: en qué punto está ese equipo → 200 {n, estado}
 *                                           (en una sala de campaña contesta siempre 404, como si el equipo no estuviera)
 *   PUT    /v1/sala/<id>/equipos/<n>       Authorization: Bearer <token>   JSON {estado} → 204
 *   DELETE /v1/sala/<id>/equipos/<n>       Authorization: Bearer <token>   → 204
 *
 * Las salas de campaña, creadas solo con un archivo firmado por Tinkazo:
 *   GET    /v1/sala/<id>/campana           el texto firmado y su firma → 200 {"texto","firma"}
 *   GET    /v1/sala/<id>/campana/estado?p=P  sin token: fase, total, cierre, si el pase vale (siempre, con PASE en 0) y si hay aviso por correo;
 *                                           con la lista sellada o sorteada, también "sorteo" (el número) y "ronda" (la del sello, si se guardó);
 *                                           con el token de la sala: "tuya" (true si es el vigente, false si ya lo tomó otra compu).
 *                                           Sin pase y sin token se recuerda 2 segundos en el borde (cache.ts)
 *   GET    /v1/sala/<id>/campana/pase      Authorization: Bearer <token> → 200 {"p","hasta"}
 *   PUT    /v1/sala/<id>/campana/fase      Authorization: Bearer <token> JSON {"fase","cierraMs"?,"sorteo"?} → 204
 *   PUT    /v1/sala/<id>/campana/resultado Authorization: Bearer <token> JSON {"sorteo","comprobante"} → 204
 *                                           (con el correo prendido, además le avisa a quien ganó, sin que la respuesta lo espere)
 *   GET    /v1/sala/<id>/campana/resultado sin token → 200 {"sorteo","ganadoras","comprobante"} (se recuerda 2 segundos en el borde)
 *   POST   /v1/sala/<id>/campana/quitar    Authorization: Bearer <token> JSON {"n","motivo"} → 204
 *   POST   /v1/sala/<id>/campana/avisar    Authorization: Bearer <token> JSON {"cuenta"} → 204
 *   POST   /v1/sala/<id>/campana/alta      JSON {"token","d","llave","p"?} → 201 {"cuenta"} o 200 {"cuenta","ya"}
 *   POST   /v1/sala/<id>/campana/yo        JSON {"cuenta","llave"} → 200 {"fase","total","cierraMs","anotada"} más "sorteo" y "ronda" con la lista sellada o sorteada
 *
 * Un Durable Object por sala, con SQLite: guarda los nombres CIFRADOS (la clave
 * viaja en el fragmento del QR y nunca llega acá), sus huellas HMAC para no
 * repetirlos, la huella SHA-256 de la llave de cada celular para permitir solo
 * una alta y hasta cinco correcciones, la huella SHA-256 del token y la hora de
 * creación. Una corrección borra la fila vieja y la nueva recuerda en `r` los
 * números que reemplaza, para que la pantalla los quite también al consultar.
 * Una alarma al vencer su vida borra todo (10 h, o 24 h en una campaña). No guarda nombres en claro, la
 * llave del celular, ni direcciones IP, ni navegador, ni hora por persona (para
 * contar las salas que arma cada dirección guarda, a lo sumo una hora, una huella
 * con sal que no se devuelve a la dirección; para el tope de altas de equipos
 * por conexión, cada sala guarda una huella con una sal suya, que queda hasta
 * que se borra la sala (las ventanas de 10 minutos que ya pasaron se limpian con
 * cada envío), y de la llave del celular que anotó cada equipo guarda solo su
 * huella SHA-256). Los topes viven en el objeto, que es donde son exactos.
 *
 * El WebSocket hacia la pantalla usa la API de hibernación: un socket quieto
 * no cobra tiempo. Si se corta, la pantalla reconecta y consulta cada 3 s.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ES_ID,
  ES_TOKEN,
  MAX_CUERPO_CONFIG,
  MAX_CUERPO_EQUIPO,
  MAX_CUERPO_RONDA,
  MAX_CUERPO_NOMBRE,
  MAX_EQUIPOS,
  MAX_NOMBRES,
  MAX_SOCKETS,
  EQUIPOS_POR_MINUTO,
  NOMBRES_POR_MINUTO,
  PRESENTARSE_MS,
  SALAS_POR_DIA,
  SALAS_POR_IP_POR_HORA,
  SITIO,
  VIDA_MS,
  VentanaPorMinuto,
  diaUtc,
  equipoCifradoValido,
  esCuentaValida,
  esEstadoEquipo,
  grupoDeIp,
  horaUtc,
  intentarAlta,
  iguales,
  origenPermitido,
  validarConfigEquipos,
  validarRondaDeSala,
} from "./logica";
import type { EstadoDeLista, RondaDeSala } from "./logica";
import type { AltasPorHora, ConfigEquipos, EstadoEquipo } from "./logica";
import { paginaCelular } from "./pagina";
import { ES_LLAVE, anotarEquipo as anotarEnRegistro, crearTablasDeEquipos, quitarEquipo as quitarDelRegistro, siguienteVersion } from "./registro";
import type { Ejecutar } from "./registro";
import { FORMA_NOMBRES, anotarNombre, crearTablasDeNombres, leerNombres, type NombreDeSala } from "./nombres";
import {
  CAMPANA_POR_MINUTO,
  ES_PASE,
  FichasVerificadas,
  MAX_CUERPO_ALTA,
  MAX_CUERPO_CAMPANA,
  anotarPersona as anotarEnCampana,
  avisarGanadora as avisarEnCampana,
  cambioValido,
  cierreValido,
  confirmarEventoSql,
  contarRechazo,
  crearTablaDeEventos,
  crearTablasDeCampana,
  esFase,
  esMotivoDeSalida,
  estadoDeCelular as leerEstadoDeCelular,
  ganadorasGuardadas,
  grupoDeConexion,
  guardarResultado as guardarResultadoEnCampana,
  hastaDelPase,
  huellaDeFicha,
  huellaDeLlave,
  huellaDePersona,
  eventoYSorteoDelTexto,
  leerCampanaFirmada,
  leerDatosDeLista,
  marcarCorreoConfirmado,
  modoSoloGoogle,
  paseDe,
  paseValido,
  prealtaDeCampana,
  quitarPersona as quitarDeCampana,
  quitadasPorMotivo,
  cerrarAvisoPorCorreo,
  reingresoDeCampana,
  reservarAvisosPorCorreo,
  reservarEventoSql,
  salaDelIntentoSql,
  selloPublico,
  sellar as sellarEnCampana,
  soltarEventoSql,
  ventanaDelPase,
  viaPermitida,
  vidaDeCampana,
} from "./campana";
import type { CampanaFirmada, EstadoDeCelular, Fase, MotivoDeSalida, ReemplazoDeSala, ReservaDeEvento } from "./campana";
import { activacionesDeCampana, anotarAltaDeCampana } from "./vigilancia-campana";
import { leerSorteoEnLaRed } from "./cadena";
import { CABECERA_DE_CACHE, esCacheable, esSinResultado, guardar as guardarEnLaCache, leerGuardada } from "./cache";
import {
  avisarPorCorreo,
  correoDeTomaPrendido,
  correoPrendido,
  datosDeLaCampana,
  enlaceDeRecibir,
  horaDeLaToma,
  llamarAlProveedor,
  marcaDeCorreoPrendida,
  mensajeroDeCloudflare,
  textoDelCorreoDeToma,
  versionDelCorreo,
} from "./correo";
import type { AvisoDeLaSala, EnlaceDeCorreo } from "./correo";
import type { SelloEnLaRed } from "./cadena";
import { crearSalaDeCampana } from "./creacion";
import { llaveDeCampanas, llavePublicaAuto } from "./firma";
import type { VariablesDeLlaveAuto } from "./firma";
import { MAX_CUERPO_ACTIVAR, activarCampana, configDeActivar } from "./activar";
import type { VariablesDeActivar } from "./activar";
import {
  anotarActivacion,
  anotarBarrido,
  antesDeActivar,
  antesDeCuenta,
  barrerSalasViejas,
  campanaDeLaCuenta,
  campanasDeLaCuenta,
  confirmarToma,
  contarRechazoDeActivar,
  contarRechazoDeCuenta,
  crearTablasDeActivar,
  cupoDeCuenta,
  duenaDelEvento,
  eventoLibre,
  guardarCampanaDeCuenta,
  marcarEventoSellado,
  pendientesDeBarrido,
  prepararToma,
  reescribirHuellaDeEvento,
  reservarCorreoDeToma,
  tomarNota,
  topeDeCuenta,
} from "./activar-cupos";
import type {
  AntesDeActivar,
  CampanaParaGuardar,
  FichaDeCampana,
  FilaDeLaLista,
  PreparacionDeToma,
  PuertoDeBarrido,
  TipoDeTope,
} from "./activar-cupos";
import {
  MAX_CUERPO_TUS_CAMPANAS,
  leerPedidoDeTus,
  listarCampanas,
  recuperarCampana,
  tusCampanasPrendido,
} from "./tus-campanas";
import type { AvisoDeToma, DepsDeTus, ResumenDeSala } from "./tus-campanas";
import { Pollar, formaDeToken, pollarDe } from "../../patrocinio/src/pollar";
import deployments from "../../../src/stellar/deployments.json";

export interface Env extends VariablesDeActivar, VariablesDeLlaveAuto {
  SALA: DurableObjectNamespace<Sala>;
  /** Un solo objeto, "cupos": cuenta las salas nuevas por dirección y por día. */
  CUPOS: DurableObjectNamespace<Cupos>;
  /** Solo para probar la alarma en local: `wrangler dev --var VIDA_PRUEBA_MS:3000`. En producción no existe. */
  VIDA_PRUEBA_MS?: string;
  /**
   * Solo en un Worker local, con VIDA_PRUEBA_MS puesta: otra llave pública de campañas, para probar sin la de verdad.
   * Vale únicamente para pedidos que llegan a localhost o a 127.0.0.1: en un Worker desplegado se ignora (ver `llaveDeCampanas`).
   */
  LLAVE_CAMPANAS_PRUEBA?: string;
  /** La misma llave secreta del portero de la red principal. Se carga con `wrangler secret put`, nunca en el archivo. */
  POLLAR_SECRETO?: string;
  /** El id público de la app del proveedor de cuentas en la red principal. */
  POLLAR_APP_ID?: string;
  /** En "0" se apaga la exigencia del pase, solo como salida de emergencia el día del evento. */
  PASE?: string;
  /**
   * Solo entra quien el proveedor dice, exactamente, que es de Google. El valor "suave" es un interruptor de emergencia:
   * también deja entrar (y cuenta aparte) a quien el proveedor no dice por dónde entró. Cualquier otro valor es estricto.
   */
  SOLO_GOOGLE?: string;
  /** Los RPC de la red principal, separados por comas. Se prueban en ese orden. */
  RPC_MAINNET?: string;
  /** El enlace de envío de correo de Cloudflare (`[[send_email]]`). Sin él, no se manda nada y nada falla. */
  CORREO?: EnlaceDeCorreo;
  /** La dirección del dominio habilitado desde la que se manda. Sin ella, no se manda nada. */
  CORREO_DE?: string;
  /** El interruptor: solo con "1" la sala le avisa por correo a quien gana. Por defecto "0". */
  CORREO_GANADORAS?: string;
  /** Las rutas de Tus campañas (listar y usar en esta compu): solo con "1" atienden. Cambiarla es publicar otra vez. */
  TUS_CAMPANAS?: string;
  /** El aviso por correo de cada toma de una campaña: solo con "1" (y con el correo prendido). Nace apagado. */
  CORREO_TOMA?: string;
  /** La versión del correo a quien gana que se manda a todas: solo "2" elige la B. Cualquier otro valor es la A. */
  CORREO_VERSION?: string;
  /** La marca de correo confirmado que manda el celular: solo con "1" la sala la acepta. Nace apagada. */
  CORREO_MARCA?: string;
}

/** Solo códigos fijos del proveedor: nunca una sesión, un id, un nombre, un correo ni una cuenta. */
function registrar(evento: string, datos: Record<string, string | number> = {}): void {
  console.log(JSON.stringify({ evento, datos }));
}

let pollar: Pollar | null | undefined;
/** Uno por aislamiento: su memoria de 60 segundos sirve para los reintentos del mismo celular. */
function pollarDeLaSala(env: Env): Pollar | null {
  if (pollar === undefined) {
    pollar = pollarDe({
      secreto: env.POLLAR_SECRETO,
      appId: env.POLLAR_APP_ID ?? null,
      fetch: (u, i) => fetch(u, i),
      registrar,
    });
  }
  return pollar;
}

const ALFABETO = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Un id de 8 caracteres de base 62, sin sesgo: se descartan los bytes de 248 en adelante. */
function nuevoId(): string {
  let id = "";
  while (id.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && id.length < 8) id += ALFABETO[b % 62];
    }
  }
  return id;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cors(origen: string | null, metodos: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origenPermitido(origen) && origen ? origen : SITIO,
    "Access-Control-Allow-Methods": metodos,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    // Sin esto el navegador, desde otro origen, no deja leer cuánto esperar (el celular esperaría siempre lo fijo) ni la hora
    // de la sala (`Date`), que el sitio usa como respaldo de su reloj.
    "Access-Control-Expose-Headers": "Retry-After, Date",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(cuerpo: unknown, estado: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra },
  });
}

/* ------------------------------------------------------------------ los cupos */

type Permiso = { ok: true } | { ok: false; motivo: "cupo-ip" | "cupo-dia" };

/**
 * Cuántas salas se crean: 30 por dirección y por hora y 400 por día en total,
 * las dos cuentas en el SQLite de este objeto, para que dormirse o reiniciarse
 * no las ponga en cero (una cuenta en memoria dejaba a un script pedir otras 30
 * salas cada vez que el objeto se dormía, hasta agotar el día).
 *
 * La dirección no se guarda: el grupo es una huella SHA-256 de la dirección más
 * una sal al azar de esa hora, cortada a 16 caracteres. La sal y las altas de
 * las horas que pasaron se borran en cada alta nueva, así que a lo sumo una
 * hora queda una huella que no se puede devolver a una dirección. Es un objeto
 * aparte para que el tope del día sea uno solo.
 *
 * Sobre el binding de límite de pedidos de Cloudflare (`[[ratelimits]]`): solo
 * admite ventanas de 10 o 60 segundos y sus conteos son aproximados, por
 * ubicación. No puede decir 30 por hora ni 400 por día, así que no se usa
 * para esto; los topes exactos viven acá y en cada sala.
 */
export class Cupos extends DurableObject<Env> {
  private readonly sql: Ejecutar = (consulta, ...parametros) => this.ctx.storage.sql.exec(consulta, ...parametros).toArray() as never;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cuotas (dia TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS altas (grupo TEXT NOT NULL, hora INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (grupo, hora))");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sal (hora INTEGER PRIMARY KEY, v TEXT NOT NULL)");
    // La sal del día para las huellas de las cuentas que activan campañas, y los topes de la activación (`activar-cupos.ts`).
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sal_dia (dia TEXT PRIMARY KEY, v TEXT NOT NULL)");
    // La tabla de eventos (con sus columnas nuevas) y las de Tus campañas nacen con el objeto, no la primera vez que alguien las usa.
    crearTablaDeEventos(this.sql);
    crearTablasDeActivar(this.sql);
  }

  /** La sal de esta hora: se inventa la primera vez que se pide. */
  private salDeLaHora(hora: number): string {
    const sql = this.ctx.storage.sql;
    let sal = sql.exec<{ v: string }>("SELECT v FROM sal WHERE hora = ?", hora).toArray()[0]?.v;
    if (!sal) {
      sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      sql.exec("INSERT INTO sal (hora, v) VALUES (?, ?)", hora, sal);
    }
    return sal;
  }

  /** La huella de la dirección en esta hora: la sal se inventa la primera vez que se pide. */
  private async huella(ip: string, hora: number): Promise<string> {
    const sal = this.salDeLaHora(hora);
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${grupoDeIp(ip)}|${sal}`));
    return Array.from(new Uint8Array(h).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** La huella de una sesión (su token) con la sal de esta hora: sirve para contar repeticiones y no deja el token guardado. */
  private async huellaDeSesion(token: string, hora: number): Promise<string> {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ficha|${this.salDeLaHora(hora)}|${token}`));
    return Array.from(new Uint8Array(h).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** La huella de una cuenta con la sal del día: los topes diarios no guardan la cuenta y se borran al día siguiente. */
  private async huellaDeCuenta(cuenta: string, dia: string): Promise<string> {
    const sql = this.ctx.storage.sql;
    let sal = sql.exec<{ v: string }>("SELECT v FROM sal_dia WHERE dia = ?", dia).toArray()[0]?.v;
    if (!sal) {
      sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      sql.exec("INSERT INTO sal_dia (dia, v) VALUES (?, ?)", dia, sal);
      sql.exec("DELETE FROM sal_dia WHERE dia < ?", dia);
    }
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cuenta|${sal}|${cuenta}`));
    return Array.from(new Uint8Array(h).subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** Lo que se mira antes de llamar al proveedor de cuentas en una activación: ver `antesDeActivar`. */
  async activarAntes(ip: string, token: string): Promise<AntesDeActivar> {
    const ahora = Date.now();
    const hora = horaUtc(ahora);
    return antesDeActivar(this.sql, { grupo: await this.huella(ip, hora), ficha: await this.huellaDeSesion(token, hora), ahora });
  }

  /** Una sesión que el proveedor rechazó en una activación. */
  async activarRechazo(ip: string, token: string): Promise<void> {
    const ahora = Date.now();
    const hora = horaUtc(ahora);
    contarRechazoDeActivar(this.sql, { grupo: await this.huella(ip, hora), ficha: await this.huellaDeSesion(token, hora), ahora });
  }

  /**
   * Lo que se mira antes de llamar al proveedor en las rutas de Tus campañas: los rechazos y el ritmo propio de la conexión.
   * Una sesión conocida no suma al ritmo (ver `antesDeCuenta`).
   */
  async cuentaAntes(ip: string, token: string, conocida: boolean): Promise<AntesDeActivar> {
    const ahora = Date.now();
    const hora = horaUtc(ahora);
    return antesDeCuenta(this.sql, { grupo: await this.huella(ip, hora), ficha: await this.huellaDeSesion(token, hora), conocida, ahora });
  }

  /** Una sesión que el proveedor rechazó en las rutas de Tus campañas: la conexión suma aparte de activar (`contarRechazoDeCuenta`). */
  async cuentaRechazo(ip: string, token: string): Promise<void> {
    const ahora = Date.now();
    const hora = horaUtc(ahora);
    contarRechazoDeCuenta(this.sql, { grupo: await this.huella(ip, hora), ficha: await this.huellaDeSesion(token, hora), ahora });
  }

  /** Cuenta un listado o una toma de esta cuenta, ya verificada: 30 listados y 10 tomas cada 10 minutos. */
  async cuentaTope(cuenta: string, tipo: TipoDeTope): Promise<{ ok: true } | { ok: false; esperaS: number }> {
    return topeDeCuenta(this.sql, { tipo, cuenta, ahora: Date.now() });
  }

  /** Si a esta cuenta le cabe activar este evento hoy (5 campañas distintas por día). */
  async activarCuenta(cuenta: string, evento: string): Promise<{ ok: true } | { ok: false; esperaS: number }> {
    const ahora = Date.now();
    const dia = diaUtc(ahora);
    return cupoDeCuenta(this.sql, { cuenta: await this.huellaDeCuenta(cuenta, dia), evento, dia, ahora });
  }

  /** Anota que esta cuenta activó este evento hoy. */
  async activarAnotar(cuenta: string, evento: string): Promise<void> {
    const dia = diaUtc(Date.now());
    anotarActivacion(this.sql, { cuenta: await this.huellaDeCuenta(cuenta, dia), evento, dia });
  }

  /** Si el evento no tiene otra dueña que esta cuenta (ver `eventoLibre`). */
  async eventoLibre(cuenta: string, evento: string): Promise<boolean> {
    return eventoLibre(this.sql, { cuenta, evento, ahora: Date.now() });
  }

  /** La dueña del evento, o null si nadie lo tiene. */
  async duenaDelEvento(evento: string): Promise<string | null> {
    return duenaDelEvento(this.sql, evento);
  }

  /** Guarda la campaña de una cuenta para Tus campañas. Dice `ajeno` si el evento ya es de otra. */
  async guardarCampana(c: Omit<CampanaParaGuardar, "ahora">): Promise<{ ok: true } | { ok: false; motivo: "ajeno" }> {
    return guardarCampanaDeCuenta(this.sql, { ...c, ahora: Date.now() });
  }

  /** El primer paso de pasar una campaña a otra compu: dueña, pausa de 60 segundos y generación nueva (ver `prepararToma`). */
  async prepararToma(cuenta: string, evento: string, huellaNueva: string): Promise<PreparacionDeToma> {
    return prepararToma(this.sql, { cuenta, evento, huellaNueva, ahora: Date.now() });
  }

  /** El último paso: el evento guarda la huella del token nuevo si esta generación sigue siendo la última. */
  async confirmarToma(evento: string, gen: number): Promise<boolean> {
    return confirmarToma(this.sql, { evento, gen });
  }

  /** Las campañas de la cuenta para Tus campañas, sin lo que no sale del servidor (ver `campanasDeLaCuenta`). */
  async campanasDeCuenta(cuenta: string): Promise<FilaDeLaLista[]> {
    return campanasDeLaCuenta(this.sql, { cuenta, ahora: Date.now() });
  }

  /** La campaña de la cuenta con este evento, o null si no la tiene o la dueña del evento es otra (ver `campanaDeLaCuenta`). */
  async campanaDeCuenta(cuenta: string, evento: string): Promise<FichaDeCampana | null> {
    return campanaDeLaCuenta(this.sql, { cuenta, evento, ahora: Date.now() });
  }

  /** Cambia la huella del token de la sala muerta de un evento, para que su dueña la reemplace con el mismo archivo. */
  async reescribirHuella(evento: string, sala: string, huella: string): Promise<boolean> {
    return reescribirHuellaDeEvento(this.sql, { evento, sala, huella });
  }

  /** Si toca mandar el aviso por correo de esta toma: uno por campaña cada 10 minutos. */
  async reservarCorreoDeToma(evento: string): Promise<boolean> {
    return reservarCorreoDeToma(this.sql, { evento, ahora: Date.now() });
  }

  /** Anota que el evento se selló: no se reabre ni se reemplaza (ver `marcarEventoSellado`). */
  async marcarSellado(evento: string, sorteoMs: number): Promise<void> {
    marcarEventoSellado(this.sql, { evento, sorteoMs, ahora: Date.now() });
  }

  /** Las salas anteriores a la dueña que todavía no se miraron: hasta 10 por pedido. */
  async pendientesDeBarrido(): Promise<{ evento: string; sala: string }[]> {
    return pendientesDeBarrido(this.sql);
  }

  /** Lo que se vio al mirar una sala vieja (ver `anotarBarrido`). */
  async anotarBarrido(evento: string, sala: string, campana: { texto: string; firma: string; sellada?: boolean } | null): Promise<void> {
    anotarBarrido(this.sql, { evento, sala, campana, ahora: Date.now() });
  }

  /** Toma la nota de la comisión para este evento: un pago sirve a un solo evento (ver `tomarNota`). */
  async activarNota(nota: string, evento: string): Promise<boolean> {
    return tomarNota(this.sql, { nota, evento, ahora: Date.now() });
  }

  async permitir(ip: string): Promise<Permiso> {
    const ahora = Date.now();
    const dia = diaUtc(ahora);
    const sql = this.ctx.storage.sql;
    const hoy = sql.exec<{ n: number }>("SELECT n FROM cuotas WHERE dia = ?", dia).toArray()[0]?.n ?? 0;
    if (hoy >= SALAS_POR_DIA) return { ok: false, motivo: "cupo-dia" };
    const grupo = await this.huella(ip, horaUtc(ahora));
    const altas: AltasPorHora = {
      leer: (g, h) => sql.exec<{ n: number }>("SELECT n FROM altas WHERE grupo = ? AND hora = ?", g, h).toArray()[0]?.n ?? 0,
      sumar: (g, h) => void sql.exec("INSERT INTO altas (grupo, hora, n) VALUES (?, ?, 1) ON CONFLICT(grupo, hora) DO UPDATE SET n = n + 1", g, h),
      olvidarAntes: (h) => {
        sql.exec("DELETE FROM altas WHERE hora < ?", h);
        sql.exec("DELETE FROM sal WHERE hora < ?", h);
      },
    };
    if (!intentarAlta(altas, grupo, ahora, SALAS_POR_IP_POR_HORA)) return { ok: false, motivo: "cupo-ip" };
    sql.exec("INSERT INTO cuotas (dia, n) VALUES (?, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1", dia);
    if (hoy === 0) sql.exec("DELETE FROM cuotas WHERE dia < ?", diaUtc(ahora - 3 * 86_400_000));
    return { ok: true };
  }

  /**
   * Reserva el evento de una campaña firmada, con su propio cupo fuera de las salas de todos los días. `reemplazo` es la
   * sala que tenía el evento, que quien llama comprobó que ya no existe, con la huella del token de esa sala que presentó:
   * así el evento se vuelve a usar con el mismo archivo, pero solo en manos de quien lo organizaba.
   */
  async reservarCampana(evento: string, reemplazo: ReemplazoDeSala | null): Promise<ReservaDeEvento> {
    return reservarEventoSql(this.sql, evento, Date.now(), reemplazo);
  }

  /**
   * Confirma la reserva con el id de la sala ya creada y la huella de su token. Recién entonces cuenta para el cupo del día.
   * La cuenta que nombra el archivo firmado pasa a ser la dueña del evento y su campaña entra a Tus campañas: así también
   * quedan las campañas firmadas a mano y las activadas antes de que existiera la lista.
   */
  async confirmarCampana(evento: string, reserva: string, sala: string, huella: string, c: CampanaFirmada): Promise<boolean> {
    const ahora = Date.now();
    const confirmada = confirmarEventoSql(this.sql, evento, { reserva, sala, huella, ahora, organizadora: c.organizadora });
    if (confirmada && c.organizadora !== null) {
      const datos = leerDatosDeLista(c.texto);
      if (datos.ok) {
        try {
          guardarCampanaDeCuenta(this.sql, {
            cuenta: c.organizadora,
            evento,
            texto: c.texto,
            firma: c.firma,
            empresa: datos.empresa,
            zona: datos.zona,
            abreMs: datos.abreMs,
            cierraMs: datos.cierraMs,
            sorteoMs: datos.sorteoMs,
            ahora,
          });
        } catch {
          // La sala ya existe y su permiso está confirmado: que la lista no la pueda anotar no la tumba. Pasa, por ejemplo, si
          // otra cuenta ya tenía una fila de este evento escrita a mano.
          registrar("lista-sin-fila", { codigo: "conflicto" });
        }
      }
    }
    return confirmada;
  }

  /** La sala confirmada del evento si su token tiene esa huella: el pedido repetido de quien no recibió la respuesta. */
  async salaDelIntento(evento: string, huella: string): Promise<{ sala: string; enMs: number } | null> {
    return salaDelIntentoSql(this.sql, evento, huella);
  }

  /** Deshace la reserva si la sala no llegó a crearse. */
  async soltarCampana(evento: string, reserva: string): Promise<void> {
    soltarEventoSql(this.sql, evento, reserva);
  }
}

/* ------------------------------------------------------------------- la sala */

interface Presentacion {
  /** El socket ya mostró el token. */
  ok: boolean;
  /** Cuándo se conectó, para soltar a los que no se presentan. */
  desde: number;
}

/** Lo que el Worker le pide a la sala, por RPC. */
export type Resultado<T = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      motivo:
        | "no-existe"
        | "token"
        | "sellada"
        | "vieja"
        | "llena"
        | "rapido"
        | "sin-registro"
        | "ajena"
        | "forma"
        | "repetido"
        | "correcciones"
        | "campana"
        | "transicion"
        | "cerrada"
        | "pase"
        | "quitada"
        | "fase"
        | "lista-distinta"
        | "ganadores-distintos"
        | "organizador-distinto"
        | "ronda-pasada"
        | "distinto"
        | "sin-resultado"
        | "no-esta"
        | "no-gano";
    }
  | { ok: false; motivo: "cupo-conexion" | "rechazos"; esperaS: number };

export class Sala extends DurableObject<Env> {
  private porMinuto = new VentanaPorMinuto(NOMBRES_POR_MINUTO);
  /** Las altas de equipos, aparte de los nombres: unos no pueden dejar afuera a los otros (`EQUIPOS_POR_MINUTO`). */
  private equiposPorMinuto = new VentanaPorMinuto(EQUIPOS_POR_MINUTO);
  /** Las personas verificadas de una campaña tienen su propio ritmo, independiente de los otros registros. */
  private campanaPorMinuto = new VentanaPorMinuto(CAMPANA_POR_MINUTO);
  /** Las fichas que el proveedor dio por buenas hace menos de un minuto: evita llamarlo de nuevo por la misma. Solo en memoria. */
  private fichasVerificadas = new FichasVerificadas();
  private readonly sql: Ejecutar = (consulta, ...parametros) => this.ctx.storage.sql.exec(consulta, ...parametros).toArray() as never;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Un ping de la pantalla se contesta solo, sin despertar al objeto: un socket quieto no cobra.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /**
   * Las tablas nacen al crear la sala, nunca al despertar: cualquiera puede pedir un id al azar, y crearlas
   * ahí dejaría un objeto vacío por cada pedido, sin alarma que lo borre. `deleteAll()` se las lleva también.
   */
  private crearTablas(): void {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sala (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    crearTablasDeNombres(this.sql);
    this.crearTablaDeEquipos();
  }

  /**
   * Los equipos: la cuenta va en claro (es pública y es lo que identifica al equipo); el nombre y los integrantes, cifrados.
   * `v` sube con cada cambio, para que la pantalla que consulta pida solo lo que cambió. Las salas que ya existían antes
   * de esto la crean la primera vez que se las configura. Las tablas y las reglas del alta viven en `registro.ts`.
   */
  private crearTablaDeEquipos(): void {
    crearTablasDeEquipos(this.sql);
  }

  /** Sin tablas no hay sala: nunca se creó, o ya se cerró. */
  private dato(k: string): string | null {
    try {
      return this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM sala WHERE k = ?", k).toArray()[0]?.v ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Si el token es el de la sala. La huella se lee DESPUÉS de esperar el SHA-256 y se compara en el mismo tramo sin esperas:
   * un pedido que esperaba con el token viejo mientras otra compu tomaba la campaña ya no pasa, porque mira la huella de
   * después de la toma.
   */
  private async tokenValido(token: string): Promise<boolean> {
    if (!ES_TOKEN.test(token)) return false;
    const calculada = await sha256Hex(token);
    const huella = this.dato("huella");
    return !!huella && iguales(huella, calculada);
  }

  private esCampana(): boolean {
    return this.dato("campana") !== null;
  }

  /** La red queda dentro del texto firmado: no la puede cambiar un pedido posterior. */
  private red(): "mainnet" | "testnet" | null {
    const texto = this.dato("campana");
    if (texto === null) return null;
    try {
      const datos: unknown = JSON.parse(texto);
      if (!datos || typeof datos !== "object") return null;
      const red = (datos as Record<string, unknown>).red;
      return red === "mainnet" || red === "testnet" ? red : null;
    } catch {
      return null;
    }
  }

  /** Crea la sala. Una sola vez: un id ya usado devuelve false. */
  async crear(huella: string, vida: number = VIDA_MS): Promise<boolean> {
    if (this.dato("huella")) return false;
    const ahora = Date.now();
    this.crearTablas();
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('huella', ?), ('creada', ?), ('forma', ?)", huella, String(ahora), FORMA_NOMBRES);
    await this.ctx.storage.setAlarm(ahora + vida);
    return true;
  }

  /** Crea una sala de campaña con el texto que ya pasó la firma, una sola vez por id. */
  async crearCampana(huella: string, c: CampanaFirmada, vida: number): Promise<boolean> {
    if (this.dato("huella")) return false;
    const ahora = Date.now();
    this.crearTablas();
    crearTablasDeCampana(this.sql);
    const secreto = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    this.ctx.storage.sql.exec(
      "INSERT INTO sala (k, v) VALUES ('huella', ?), ('creada', ?), ('forma', 'campana'), " +
        "('campana', ?), ('firma', ?), ('evento', ?), ('fase', 'lista'), ('pase', ?), ('cierra', ?), ('sorteo', ?)",
      huella,
      String(ahora),
      c.texto,
      c.firma,
      c.evento,
      secreto,
      String(c.cierraMs),
      String(c.sorteoMs),
    );
    // Lo firmado que el sello de la red tiene que cumplir: cuántos premios y, si la campaña la nombra, quién sella.
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('premios', ?)", String(c.premios));
    if (c.organizadora !== null) {
      this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('organizadora', ?)", c.organizadora);
    }
    await this.ctx.storage.setAlarm(ahora + vida);
    return true;
  }

  /** Si la sala existe. Una sala cerrada, vencida o que nunca se creó no tiene nada guardado. */
  async viva(): Promise<boolean> {
    return this.dato("huella") !== null;
  }

  /**
   * Lo que Tus campañas necesita de la sala: si vive y, de ser así, su fase, cuántas personas hay y la cuenta que nombra su
   * texto firmado. Barato (dos lecturas y un conteo) y de solo lectura. Lo pide el Worker, que decide qué le muestra a cada
   * cuenta: nunca devuelve el texto, la firma, el id ni el token.
   */
  async resumenDeCampana(): Promise<ResumenDeSala> {
    if (!this.dato("huella") || !this.esCampana()) return { viva: false };
    const fase = this.dato("fase");
    if (!esFase(fase)) return { viva: false };
    const total = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM equipos").one().c;
    return { viva: true, fase, total, organizadora: this.dato("organizadora") };
  }

  /** El archivo público de la campaña, exactamente como fue firmado. */
  async campana(): Promise<Resultado<{ texto: string; firma: string }>> {
    const texto = this.dato("campana");
    const firma = this.dato("firma");
    if (texto === null || firma === null) return { ok: false, motivo: "no-existe" };
    return { ok: true, texto, firma };
  }

  /** Lo público de la fase, con el pase presentado por quien consulta. Los contadores por vía piden el token. */
  async estadoDeCampana(
    p: string | null,
    exigirPase: boolean,
    token: string | null = null,
  ): Promise<
    Resultado<{
      fase: Fase;
      total: number;
      cierraMs: number;
      pase: "vale" | "vencido";
      quitadas: Record<MotivoDeSalida, number>;
      vias?: { google: number; sinDato: number };
      tuya?: boolean;
      sorteo?: string;
      ronda?: number;
    }>
  > {
    if (!this.esCampana()) return { ok: false, motivo: "no-existe" };
    const fase = this.dato("fase");
    if (!esFase(fase)) return { ok: false, motivo: "no-existe" };
    const total = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM equipos").one().c;
    const cierraMs = Number(this.dato("cierra"));
    // Con el pase apagado (PASE en 0) el alta lo acepta siempre: el estado también dice que vale, para no frenar al celular.
    const vale = !exigirPase || (p !== null && (await paseValido(this.dato("pase") ?? "", p, Date.now())));
    const conToken = token !== null && token !== "" && (await this.tokenValido(token));
    const vias = conToken
      ? { google: Number(this.dato("via-google") ?? 0), sinDato: Number(this.dato("via-sin-dato") ?? 0) }
      : undefined;
    return {
      ok: true,
      fase,
      total,
      cierraMs,
      pase: vale ? "vale" : "vencido",
      quitadas: quitadasPorMotivo(this.sql),
      ...(vias ? { vias } : {}),
      // Solo si llegó un token: así la compu que perdió la campaña lo sabe ya en su primer retomar. Sin token no se dice nada.
      ...(token !== null && token !== "" ? { tuya: conToken } : {}),
      // El número del sorteo y la ronda, solo con la lista sellada o sorteada.
      ...selloPublico(this.sql, fase),
    };
  }

  /**
   * Las comprobaciones anteriores a la llamada externa, con todas las esperas resueltas primero: fase, pase y los topes de
   * rechazos. Si la ficha es de una sesión que ya se verificó hace menos de un minuto y su persona ya está anotada, es un
   * reingreso: se resuelve acá, sin llamar al proveedor (`cuenta` trae su cuenta). Si no, `cuenta` es null y sigue la
   * verificación. Las reglas viven en `prealtaDeCampana`, que se prueba en Node.
   */
  async prealta(
    ip: string,
    p: string | null,
    exigirPase: boolean,
    token: string,
    llave: string,
    d?: string,
  ): Promise<Resultado<{ cuenta: string | null }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const ahora = Date.now();
    const grupo = await grupoDeConexion(this.sql, ip);
    const ficha = await huellaDeFicha(this.sql, token);
    const huella = await huellaDeLlave(llave);
    const paseVale = !exigirPase || (await paseValido(this.dato("pase") ?? "", p, ahora));
    const r = prealtaDeCampana(this.sql, this.fichasVerificadas, {
      grupo,
      ficha,
      llave: huella,
      paseVale,
      ahora,
      ...(d !== undefined ? { d } : {}),
    });
    if (r.ok && r.nombre) this.avisarNombre(r.cuenta, r.nombre);
    return r.ok ? { ok: true, cuenta: r.cuenta } : r;
  }

  /** Le dice a la pantalla que el nombre de una persona ya anotada cambió (volvió a escanear con la clave nueva). */
  private avisarNombre(cuenta: string | null, nombre: { n: number; v: number; d: string; estado: string }): void {
    if (cuenta === null) return;
    this.avisar({ t: "equipo", v: nombre.v, n: nombre.n, cuenta, d: nombre.d, estado: nombre.estado });
  }

  /**
   * Una sesión que el proveedor rechazó. La ficha siempre cuenta; la conexión, solo la primera vez que se ve esa ficha
   * (repetirla no cuesta otra llamada), así una persona no deja afuera a las demás. Los rechazos de antes de llamar
   * (forma, pase, fase) no pasan por acá.
   */
  async rechazo(ip: string, token: string): Promise<Resultado> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const grupo = await grupoDeConexion(this.sql, ip);
    const ficha = await huellaDeFicha(this.sql, token);
    contarRechazo(this.sql, grupo, ficha, Date.now());
    return { ok: true };
  }

  /**
   * El reingreso de una persona ya verificada, antes de buscar una cuenta que no hace falta consultar. Cada persona tiene su
   * propio tope por hora: pasado, da `cupo-conexion` y no toca nada.
   */
  async yaEsta(
    usuario: string,
    llave: string,
    ip: string,
    token: string,
    vence: number,
    d?: string,
  ): Promise<Resultado<{ cuenta: string | null }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const persona = await huellaDePersona(this.sql, usuario);
    const huella = await huellaDeLlave(llave);
    const grupo = await grupoDeConexion(this.sql, ip);
    const ficha = await huellaDeFicha(this.sql, token);
    const ahora = Date.now();
    const r = reingresoDeCampana(this.sql, this.fichasVerificadas, {
      persona,
      llave: huella,
      grupo,
      ahora,
      ficha,
      vence,
      ...(d !== undefined ? { d } : {}),
    });
    if (r === null) return { ok: true, cuenta: null };
    if (!r.ok) return r;
    if (r.nombre) this.avisarNombre(r.cuenta, r.nombre);
    return { ok: true, cuenta: r.cuenta };
  }

  /** El alta verificada: primero todas las esperas y después un único bloque de lecturas y escrituras SQL. */
  async anotarPersona(alta: {
    usuario: string;
    cuenta: string;
    d: string;
    llave: string;
    ip: string;
    p: string | null;
    exigirPase: boolean;
    via: "google" | "sin-dato";
    token: string;
    vence: number;
  }): Promise<Resultado<{ cuenta: string; ya: boolean; v: number; n: number }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const ahora = Date.now();
    const persona = await huellaDePersona(this.sql, alta.usuario);
    const llave = await huellaDeLlave(alta.llave);
    const grupo = await grupoDeConexion(this.sql, alta.ip);
    const ficha = await huellaDeFicha(this.sql, alta.token);
    if (alta.exigirPase && !(await paseValido(this.dato("pase") ?? "", alta.p, ahora))) {
      return { ok: false, motivo: "pase" };
    }
    const r = anotarEnCampana(
      this.sql,
      { persona, cuenta: alta.cuenta, d: alta.d, llave, grupo, ahora, via: alta.via },
      () => this.campanaPorMinuto.intentar(ahora),
    );
    // Quien salió con su motivo también queda recordada: si repite el alta con la misma sesión, la sala le contesta sin
    // volver a llamar al proveedor (`prealtaDeCampana`).
    if (!r.ok && r.motivo === "quitada") this.fichasVerificadas.recordar(ficha, persona, ahora, alta.vence);
    if (!r.ok) return r;
    this.fichasVerificadas.recordar(ficha, persona, ahora, alta.vence);
    if (!r.ya) {
      // La vigilancia de firmas: cada alta nueva es una activación explicada del día. Lo que se guarda es la cantidad,
      // nunca el token, el id de la persona, la cuenta ni el nombre.
      anotarAltaDeCampana(this.sql, diaUtc(ahora));
      this.avisar({ t: "equipo", v: r.v, n: r.n, cuenta: r.cuenta, d: alta.d, estado: "aceptado" });
    } else if (r.nombre) this.avisarNombre(r.cuenta, { n: r.n, v: r.v, ...r.nombre });
    return { ok: true, cuenta: r.cuenta, ya: r.ya, v: r.v, n: r.n };
  }

  /** Saca a una persona antes del sello y avisa a la pantalla con el mensaje que ya entiende. */
  async quitarPersona(token: string, n: number, motivo: MotivoDeSalida): Promise<Resultado> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const r = quitarDeCampana(this.sql, n, motivo);
    if (!r.ok) return r;
    this.avisar({ t: "equipo-quitado", n });
    return { ok: true };
  }

  /** Marca el aviso para una ganadora. El celular lo consulta con su propia llave. */
  async avisarGanadora(token: string, cuenta: string): Promise<Resultado> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    return avisarEnCampana(this.sql, cuenta);
  }

  /** El celular pregunta por sí mismo con su llave; la respuesta nunca incluye su número de anotación. */
  async estadoDeCelular(cuenta: string, llave: string, confirmo = false): Promise<Resultado<EstadoDeCelular>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const huella = await huellaDeLlave(llave);
    // La marca de correo confirmado: solo si el Worker la acepta, con la llave del propio celular y si hay algo nuevo que escribir.
    if (confirmo && marcaDeCorreoPrendida(this.env)) marcarCorreoConfirmado(this.sql, cuenta, huella);
    return { ok: true, ...leerEstadoDeCelular(this.sql, cuenta, huella) };
  }

  /** Cuántas altas de campaña explican firmas, por día: solo cifras, sin ningún dato de persona. Lo lee la vigilancia. */
  async activacionesDeCampana(): Promise<Resultado<Record<string, number>>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    return { ok: true, ...activacionesDeCampana(this.sql) };
  }

  /** El pase que la pantalla presenta al entrar con Google; solo lo renueva quien tiene el token. */
  async paseDeLaPantalla(token: string): Promise<Resultado<{ p: string; hasta: number }>> {
    if (!this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const ahora = Date.now();
    const p = await paseDe(this.dato("pase") ?? "", ventanaDelPase(ahora));
    return { ok: true, p, hasta: hastaDelPase(ahora) };
  }

  /**
   * Pasa la campaña a otra compu: cambia el token por el de la huella nueva y cierra la pantalla que estaba presentada. SIN
   * ninguna espera entre leer y escribir. Solo la cuenta que nombra el texto firmado de la sala puede (una sala firmada a mano
   * sin cuenta queda en manos de quien tiene el token, como siempre), una sala sellada no se toma, y la generación tiene que ser
   * mayor que la de la última toma: con dos a la vez gana la mayor, lleguen en el orden que lleguen.
   */
  async cambiarToken(
    cuenta: string,
    huellaNueva: string,
    gen: number,
  ): Promise<Resultado<{ fase: Fase; vence: number }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!/^[0-9a-f]{64}$/.test(huellaNueva) || !Number.isSafeInteger(gen) || gen < 1) return { ok: false, motivo: "forma" };
    const organizadora = this.dato("organizadora");
    if (organizadora === null || !iguales(organizadora, cuenta)) return { ok: false, motivo: "no-existe" };
    const fase = this.dato("fase");
    if (!esFase(fase)) return { ok: false, motivo: "no-existe" };
    if (fase === "sellada") return { ok: false, motivo: "sellada" };
    if (!(gen > Number(this.dato("gen") ?? 0))) return { ok: false, motivo: "vieja" };
    this.ctx.storage.sql.exec(
      "INSERT INTO sala (k, v) VALUES ('huella', ?), ('gen', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      huellaNueva,
      String(gen),
    );
    // La pantalla que estaba presentada deja de valer: su token ya no es el de la sala.
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Presentacion | null)?.ok) {
        try {
          ws.close(4001, "tomada");
        } catch {
          /* ya cerrado */
        }
      }
    }
    return { ok: true, fase, vence: (await this.ctx.storage.getAlarm()) ?? Date.now() };
  }

  /** Cambia la fase dentro de las transiciones permitidas y conserva el cierre si no se manda uno nuevo. */
  async ponerFase(token: string, fase: Fase, cierraMs: number | null): Promise<Resultado> {
    if (!this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const actual = this.dato("fase");
    if (!esFase(actual)) return { ok: false, motivo: "no-existe" };
    if (fase === "sellada" || !cambioValido(actual, fase)) return { ok: false, motivo: "transicion" };
    let cierre = Number(this.dato("cierra"));
    if (cierraMs !== null && fase === "abierta") {
      if (!cierreValido(cierraMs, Date.now())) return { ok: false, motivo: "forma" };
      cierre = cierraMs;
      this.ctx.storage.sql.exec(
        "INSERT INTO sala (k, v) VALUES ('cierra', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        String(cierre),
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO sala (k, v) VALUES ('fase', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      fase,
    );
    this.avisar({ t: "fase", fase, cierraMs: cierre });
    return { ok: true };
  }

  /**
   * Sella solo con los datos que el Worker ya leyó del contrato; la decisión y la escritura no tienen esperas. La hora se
   * toma acá, después de la última espera: la ronda del sello tiene que estar todavía por salir en el momento de sellar.
   */
  async sellarCampana(
    token: string,
    sorteo: string,
    sello: SelloEnLaRed,
  ): Promise<Resultado<{ evento: string | null; sorteoMs: number | null }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const r = sellarEnCampana(this.sql, sorteo, sello, Date.now());
    if (!r.ok) return r;
    this.avisar({ t: "fase", fase: "sellada" });
    // El evento y la hora del sorteo salen del texto firmado, nunca de la clave `sorteo`, que ahora guarda el número del sorteo.
    const delTexto = eventoYSorteoDelTexto(this.dato("campana"));
    return { ok: true, evento: delTexto?.evento ?? null, sorteoMs: delTexto?.sorteoMs ?? null };
  }

  /** Guarda las cuentas que la propia sala traduce desde los índices leídos en la red. */
  async guardarResultadoDeCampana(
    token: string,
    datos: { sorteo: string; ganadores: readonly number[]; numWinners: number; comprobante: string },
  ): Promise<Resultado<{ primera: boolean; correo: AvisoDeLaSala }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const r = guardarResultadoEnCampana(this.sql, datos);
    if (!r.ok) return r;
    this.avisar({ t: "fase", fase: "sorteada" });
    // Las cuentas a las que se les escribe las reserva la propia sala, de lo que guardó, en este mismo bloque sin esperas.
    // Con el correo apagado no reserva nada, así que un interruptor que se prende después todavía puede avisar.
    // Cada una sale con la versión del correo que le toca: la B para todas con CORREO_VERSION en "2", o para quien mandó su marca
    // de correo confirmado si la marca está prendida. Sin nada de eso, la A, que es cierta siempre.
    const paraTodas = versionDelCorreo(this.env) === "2";
    const cuentas = correoPrendido(this.env)
      ? reservarAvisosPorCorreo(this.sql, Date.now(), { marca: marcaDeCorreoPrendida(this.env) }).map((c) =>
          paraTodas ? { ...c, confirmo: true as const } : c,
        )
      : [];
    const campana = cuentas.length > 0 ? datosDeLaCampana(this.dato("campana")) : { empresa: "", premios: [] };
    return { ...r, correo: { cuentas, ...campana } };
  }

  /**
   * Deja la marca de una cuenta en "hecha" cuando su aviso por correo ya se intentó. Solo la llama el Worker, nunca un
   * pedido de afuera, y solo cambia una reserva que ya existe: no crea marcas ni guarda nada de la persona.
   */
  async cerrarAvisoDeCorreo(cuenta: string): Promise<void> {
    if (!esCuentaValida(cuenta)) return;
    cerrarAvisoPorCorreo(this.sql, cuenta);
  }

  /** El resultado público del evento. Antes del sorteo se distingue de una sala que no existe. */
  async resultadoDeCampana(): Promise<
    Resultado<{ sorteo: string; ganadoras: string[]; comprobante: string }>
  > {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const ganadoras = ganadorasGuardadas(this.sql);
    const sorteo = this.dato("sorteo");
    const comprobante = this.dato("comprobante");
    if (ganadoras.length === 0 || sorteo === null || comprobante === null) {
      return { ok: false, motivo: "sin-resultado" };
    }
    return { ok: true, sorteo, ganadoras, comprobante };
  }

  /** El Worker necesita la red antes de consultar el contrato; este dato no modifica la sala. */
  async redDeCampana(): Promise<Resultado<{ red: "mainnet" | "testnet" }>> {
    if (!this.dato("huella") || !this.esCampana()) return { ok: false, motivo: "no-existe" };
    const red = this.red();
    if (red === null) return { ok: false, motivo: "no-existe" };
    return { ok: true, red };
  }

  /** Un alta o una corrección. Las reglas y el SQL viven en `nombres.ts`, que se prueba en Node. */
  async sumar(cuerpo: string): Promise<Resultado<{ n: number; creada: boolean; r?: number[] }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // En campaña solo se anota por el alta con sesión verificada: el token no abre otra puerta ni saca a nadie sin motivo.
    if (this.esCampana()) return { ok: false, motivo: "campana" };
    // Cerrada la lista no entra nadie más (juegos interactivos): la respuesta sería «cerrada» de todos modos.
    if (this.estadoDeLista() === "cerrada") return { ok: false, motivo: "cerrada" };
    const r = await anotarNombre(this.sql, cuerpo, this.dato("forma") === FORMA_NOMBRES, () => this.porMinuto.intentar(Date.now()));
    if (!r.ok) return r;
    for (const aviso of r.avisos) this.avisar(aviso);
    return r;
  }

  /** Los nombres de `desde` en adelante, para quien tiene el token: la pantalla que se recargó, o que consulta cada 3 s. */
  async leer(token: string, desde: number): Promise<Resultado<{ nombres: NombreDeSala[] }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    return { ok: true, nombres: leerNombres(this.sql, desde, this.dato("forma") === FORMA_NOMBRES) };
  }

  /** Saca un nombre, también del objeto. */
  async quitar(token: string, n: number): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    this.ctx.storage.sql.exec("DELETE FROM nombres WHERE n = ?", n);
    this.avisar({ t: "quitado", n });
    return { ok: true };
  }

  /** El estado de la lista: «abierta» si nunca se cerró. */
  private estadoDeLista(): EstadoDeLista {
    return this.dato("estado") === "cerrada" ? "cerrada" : "abierta";
  }

  /** La ronda compartida que decide, o `null` si la pantalla todavía no la mandó. */
  private ronda(): RondaDeSala | null {
    const crudo = this.dato("ronda");
    if (!crudo) return null;
    try {
      return validarRondaDeSala(JSON.parse(crudo));
    } catch {
      return null;
    }
  }

  /** La configuración del registro de equipos, o null si todavía no se armó. */
  private config(): ConfigEquipos | null {
    const crudo = this.dato("config");
    if (!crudo) return null;
    try {
      return validarConfigEquipos(JSON.parse(crudo));
    } catch {
      return null;
    }
  }

  /** Quien organiza arma (o rearma) el registro: con qué modo y con qué cuenta del evento. */
  async configurar(token: string, config: ConfigEquipos): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // En campaña solo se anota por el alta con sesión verificada: el token no abre otra puerta ni saca a nadie sin motivo.
    if (this.esCampana()) return { ok: false, motivo: "campana" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    this.crearTablaDeEquipos();
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('config', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(config));
    return { ok: true };
  }

  /** Lo que ve cualquiera con el enlace: cómo es el registro y cuántos equipos van. Nada de nombres. */
  async publico(): Promise<Resultado<{ config: ConfigEquipos | null; equipos: number }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // Una campaña contesta como una sala sin registro de equipos: lo suyo se lee por `campana/estado`, que es público a propósito.
    if (this.esCampana()) return { ok: true, config: null, equipos: 0 };
    let equipos = 0;
    try {
      equipos = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM equipos").one().c;
    } catch {
      /* sala anterior a los equipos */
    }
    return { ok: true, config: this.config(), equipos };
  }

  private siguienteVersion(): number {
    return siguienteVersion(this.sql);
  }

  /**
   * Un equipo de un celular. La misma cuenta otra vez, con la misma llave, cambia los datos del equipo, no lo duplica:
   * conserva su número y su estado. Con otra llave (o sin ella) se rechaza y lo que estaba queda igual.
   */
  async anotarEquipo(cuenta: string, d: string, llave: string, ip: string): Promise<Resultado<{ n: number; estado: EstadoEquipo }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // En campaña solo se anota por el alta con sesión verificada: el token no abre otra puerta ni saca a nadie sin motivo.
    if (this.esCampana()) return { ok: false, motivo: "campana" };
    const config = this.config();
    if (!config) return { ok: false, motivo: "sin-registro" };
    const r = await anotarEnRegistro(this.sql, { cuenta, d, llave, ip, ahora: Date.now(), modo: config.modo }, () => this.equiposPorMinuto.intentar(Date.now()));
    if (!r.ok) return r;
    this.avisar({ t: "equipo", v: r.v, n: r.n, cuenta, d, estado: r.estado });
    return { ok: true, n: r.n, estado: r.estado };
  }

  /** Los equipos que cambiaron desde la versión `desde`, para quien tiene el token. */
  async leerEquipos(token: string, desde: number): Promise<Resultado<{ equipos: { n: number; cuenta: string; d: string; estado: string; v: number }[] }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    let equipos: { n: number; cuenta: string; d: string; estado: string; v: number }[] = [];
    try {
      equipos = this.ctx.storage.sql
        .exec<{ n: number; cuenta: string; d: string; estado: string; v: number }>("SELECT n, cuenta, d, estado, v FROM equipos WHERE v > ? ORDER BY v LIMIT ?", desde, MAX_EQUIPOS)
        .toArray();
    } catch {
      /* sala anterior a los equipos */
    }
    return { ok: true, equipos };
  }

  /** En qué punto está el equipo de esta cuenta. Lo pregunta el celular de su encargado. */
  async equipoDe(cuenta: string): Promise<Resultado<{ n: number; estado: string }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // En una campaña las anotadas son personas: con solo el id de la sala no se dice nada de nadie, ni que está ni su número.
    // Contesta igual que una sala sin ese equipo. Cada celular consulta lo suyo por `campana/yo`, con su llave.
    if (this.esCampana()) return { ok: false, motivo: "no-existe" };
    let fila: { n: number; estado: string } | undefined;
    try {
      fila = this.ctx.storage.sql.exec<{ n: number; estado: string }>("SELECT n, estado FROM equipos WHERE cuenta = ?", cuenta).toArray()[0];
    } catch {
      /* sala anterior a los equipos */
    }
    return fila ? { ok: true, n: fila.n, estado: fila.estado } : { ok: false, motivo: "no-existe" };
  }

  /** Quien organiza cambia el punto en que está un equipo: lo ve el celular de su encargado. */
  async cambiarEstado(token: string, n: number, estado: EstadoEquipo): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // En campaña solo se anota por el alta con sesión verificada: el token no abre otra puerta ni saca a nadie sin motivo.
    if (this.esCampana()) return { ok: false, motivo: "campana" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    const sql = this.ctx.storage.sql;
    let fila: { cuenta: string; d: string } | undefined;
    try {
      fila = sql.exec<{ cuenta: string; d: string }>("SELECT cuenta, d FROM equipos WHERE n = ?", n).toArray()[0];
    } catch {
      /* sala anterior a los equipos */
    }
    if (!fila) return { ok: false, motivo: "no-existe" };
    const v = this.siguienteVersion();
    sql.exec("UPDATE equipos SET estado = ?, v = ? WHERE n = ?", estado, v, n);
    this.avisar({ t: "equipo", v, n, cuenta: fila.cuenta, d: fila.d, estado });
    return { ok: true };
  }

  /** Saca un equipo, también del objeto. */
  async quitarEquipo(token: string, n: number): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    // En campaña solo se anota por el alta con sesión verificada: el token no abre otra puerta ni saca a nadie sin motivo.
    if (this.esCampana()) return { ok: false, motivo: "campana" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    try {
      quitarDelRegistro(this.sql, n);
    } catch {
      /* sala anterior a los equipos */
    }
    this.avisar({ t: "equipo-quitado", n });
    return { ok: true };
  }

  /**
   * La pantalla comparte la ronda que decide (la del sello, o la de ejemplo del stand): los celulares
   * la leen por `GET /vivo` y calculan su resultado personal. Se puede volver a mandar (la pantalla
   * re-sella): la última es la que vale.
   */
  async fijarRonda(token: string, ronda: RondaDeSala): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('ronda', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify(ronda));
    this.avisar({ t: "ronda", ...ronda });
    return { ok: true };
  }

  /** Quien organiza cierra la lista desde la pantalla: no entra nadie más, y los celulares lo ven. */
  async cerrarLista(token: string): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    if (this.estadoDeLista() === "cerrada") return { ok: true };
    this.ctx.storage.sql.exec("INSERT INTO sala (k, v) VALUES ('estado', 'cerrada') ON CONFLICT(k) DO UPDATE SET v = excluded.v");
    this.avisar({ t: "lista-cerrada" });
    return { ok: true };
  }

  /**
   * Lo que mira el celular del participante, sin token: la lista cifrada, el estado y la ronda compartida. `ns` son los
   * números que siguen en la sala: el celular que ya vio uno que falta sabe que lo quitaron, y su lista queda igual a
   * la que se sella.
   */
  async vivo(
    desde: number,
  ): Promise<Resultado<{ hay: number; estado: EstadoDeLista; ronda: RondaDeSala | null; ns: number[]; nombres: { n: number; d: string }[] }>> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    const nombres = this.ctx.storage.sql
      .exec<{ n: number; d: string }>("SELECT n, d FROM nombres WHERE n > ? ORDER BY n LIMIT ?", desde, MAX_NOMBRES)
      .toArray();
    const ns = this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM nombres ORDER BY n").toArray().map((f) => f.n);
    return { ok: true, hay: ns.length, estado: this.estadoDeLista(), ronda: this.ronda(), ns, nombres };
  }

  /** Cierra la sala: avisa a la pantalla, suelta los sockets y borra todo, la alarma también. */
  async cerrar(token: string): Promise<Resultado> {
    if (!this.dato("huella")) return { ok: false, motivo: "no-existe" };
    if (!(await this.tokenValido(token))) return { ok: false, motivo: "token" };
    await this.borrarTodo("cerrada");
    return { ok: true };
  }

  private async borrarTodo(motivo: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, motivo);
      } catch {
        /* ya cerrado */
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Al vencer la vida de la sala no queda nada: 10 h en una sala común y 24 h en una campaña. */
  override async alarm(): Promise<void> {
    await this.borrarTodo("vencida");
  }

  /** Manda un mensaje a la pantalla presentada. */
  private avisar(m: object): void {
    const texto = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Presentacion | null)?.ok) {
        try {
          ws.send(texto);
        } catch {
          /* el socket se cae solo */
        }
      }
    }
  }

  /** La pantalla abre un WebSocket. El token no va en la dirección: va en el primer mensaje. */
  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Se esperaba un WebSocket.", { status: 426 });
    if (!this.dato("huella")) return new Response("No existe.", { status: 404 });
    const ahora = Date.now();
    const abiertos = this.ctx.getWebSockets();
    if (abiertos.length >= MAX_SOCKETS) {
      // Hay lugar si alguno lleva callado más de lo que se permite sin presentarse.
      let libre = false;
      for (const ws of abiertos) {
        const p = ws.deserializeAttachment() as Presentacion | null;
        if (!p?.ok && ahora - (p?.desde ?? 0) > PRESENTARSE_MS) {
          ws.close(4408, "sin presentarse");
          libre = true;
        }
      }
      if (!libre) return new Response("Demasiadas conexiones.", { status: 429 });
    }
    const [cliente, servidor] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(servidor);
    servidor.serializeAttachment({ ok: false, desde: ahora } satisfies Presentacion);
    return new Response(null, { status: 101, webSocket: cliente });
  }

  override async webSocketMessage(ws: WebSocket, mensaje: ArrayBuffer | string): Promise<void> {
    let m: { t?: unknown; token?: unknown } = {};
    try {
      m = JSON.parse(typeof mensaje === "string" ? mensaje : new TextDecoder().decode(mensaje)) as typeof m;
    } catch {
      /* no es JSON */
    }
    const estado = ws.deserializeAttachment() as Presentacion | null;
    if (m.t === "hola" && typeof m.token === "string" && (await this.tokenValido(m.token))) {
      // Una sola pantalla a la vez: la que se presenta desplaza a la anterior.
      for (const otro of this.ctx.getWebSockets()) {
        if (otro !== ws && (otro.deserializeAttachment() as Presentacion | null)?.ok) otro.close(4000, "reemplazada");
      }
      ws.serializeAttachment({ ok: true, desde: estado?.desde ?? Date.now() } satisfies Presentacion);
      const hay = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM nombres").one().c;
      // La pantalla que se recarga se pone al día: cuántos van, el estado de la lista y la ronda compartida (si ya se mandó).
      ws.send(JSON.stringify({ t: "listo", hay, estado: this.estadoDeLista(), ronda: this.ronda() }));
      return;
    }
    // Cualquier otra cosa antes de presentarse es un error; después, no se espera nada.
    if (!estado?.ok) ws.close(4401, "token");
  }

  override async webSocketClose(ws: WebSocket, codigo: number, razon: string): Promise<void> {
    try {
      ws.close(codigo >= 1000 && codigo < 5000 && codigo !== 1005 && codigo !== 1006 ? codigo : 1000, razon);
    } catch {
      /* ya cerrado */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      /* ya cerrado */
    }
  }
}

/* --------------------------------------------------------------- el Worker */

const CABECERAS_PAGINA = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  // Solo lo suyo: ningún otro origen, ni de imágenes, ni de scripts, ni de conexiones.
  "Content-Security-Policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function bearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
}

const ES_SORTEO = /^[0-9]{1,20}$/;

/** Los puntos de entrada de la red de la campaña, en el orden en que se prueban. */
/**
 * Busca el correo de las cuentas que la sala reservó y les manda el aviso. Todo se traga: lo que falla deja solo un código
 * fijo en el registro, nunca un correo, un nombre ni una cuenta.
 */
async function avisarGanadorasPorCorreo(
  env: Env,
  red: "mainnet" | "testnet",
  aviso: AvisoDeLaSala,
  terminada: (cuenta: string) => Promise<void>,
): Promise<void> {
  try {
    if (!correoPrendido(env) || !env.CORREO || !env.CORREO_DE || !env.POLLAR_SECRETO) return;
    await avisarPorCorreo({
      aviso,
      enlace: enlaceDeRecibir(red),
      llamar: llamarAlProveedor(env.POLLAR_SECRETO, (u, i) => fetch(u, i)),
      mensajero: mensajeroDeCloudflare(env.CORREO, env.CORREO_DE, registrar),
      registrar,
      terminada,
    });
  } catch {
    registrar("correo-envio", { codigo: "inesperado" });
  }
}

/**
 * Le avisa por correo a quien organiza que su campaña se abrió en otra compu. Todo se traga: lo que falla deja solo un código
 * fijo en el registro, nunca la dirección, el nombre ni la cuenta. Sale aparte de la respuesta y solo con el aviso prendido.
 */
async function avisarTomaPorCorreo(env: Env, sesion: string, aviso: AvisoDeToma): Promise<void> {
  try {
    if (!correoDeTomaPrendido(env) || !env.CORREO || !env.CORREO_DE) return;
    const proveedor = pollarDeLaSala(env);
    if (!proveedor) return;
    // La sesión que acaba de pasar la verificación sigue en la memoria del proveedor: no vuelve a llamar a nadie.
    const quien = await proveedor.verificar(sesion);
    if (!quien.ok) {
      registrar("correo-toma", { codigo: "sesion" });
      return;
    }
    const persona = await proveedor.datosParaCorreo(quien.usuario);
    if (!persona) {
      registrar("correo-toma", { codigo: "sin-ficha" });
      return;
    }
    const idioma = persona.idioma ?? "es";
    const contenido = textoDelCorreoDeToma(idioma, {
      nombre: persona.nombre,
      empresa: aviso.empresa,
      hora: horaDeLaToma(aviso.ahora, aviso.zona, idioma),
    });
    const salio = await mensajeroDeCloudflare(env.CORREO, env.CORREO_DE, registrar).mandar(persona.correo, contenido);
    registrar("correo-toma", { codigo: salio ? "enviado" : "no-salio" });
  } catch {
    registrar("correo-toma", { codigo: "inesperado" });
  }
}

/** Lo que las rutas de Tus campañas le piden al resto del Worker, armado con los objetos de verdad. */
function depsDeTus(env: Env, ip: string, ahora: number): DepsDeTus {
  const cupos = env.CUPOS.get(env.CUPOS.idFromName("cupos"));
  return {
    verificar: {
      ip,
      ahora,
      proveedor: pollarDeLaSala(env),
      topes: {
        antes: (conexion, ficha, conocida) => cupos.cuentaAntes(conexion, ficha, conocida),
        rechazo: (conexion, ficha) => cupos.cuentaRechazo(conexion, ficha),
        tope: (cuenta, tipo) => cupos.cuentaTope(cuenta, tipo),
      },
    },
    cupos: {
      campanasDeCuenta: (cuenta) => cupos.campanasDeCuenta(cuenta),
      campanaDeCuenta: (cuenta, evento) => cupos.campanaDeCuenta(cuenta, evento),
      prepararToma: (cuenta, evento, huella) => cupos.prepararToma(cuenta, evento, huella),
      confirmarToma: (evento, gen) => cupos.confirmarToma(evento, gen),
      reescribirHuella: (evento, sala, huella) => cupos.reescribirHuella(evento, sala, huella),
      reservarCorreoDeToma: (evento) => cupos.reservarCorreoDeToma(evento),
    },
    sala: (id) => env.SALA.get(env.SALA.idFromName(id)),
    // Antes de leer, se mira de quién son las salas anteriores a la dueña (hasta 10 por pedido).
    barrer: () => barrerSalasViejas(puertoDeBarrido(env, cupos)),
    nuevoToken: () => base64url(crypto.getRandomValues(new Uint8Array(16))),
    huellaDe: sha256Hex,
    avisoDeTomaPrendido: correoDeTomaPrendido(env),
  };
}

function rpcsDe(env: Env, red: "mainnet" | "testnet"): string[] {
  if (red === "testnet") return [deployments.testnet.rpcUrl];
  return (env.RPC_MAINNET ?? "")
    .split(",")
    .map((rpc) => rpc.trim())
    .filter((rpc) => rpc.length > 0);
}

/** El barrido de las salas anteriores a la dueña: pregunta el archivo público de cada una (`Sala.campana`) y anota lo que vio. */
function puertoDeBarrido(env: Env, cupos: Pick<Cupos, "pendientesDeBarrido" | "anotarBarrido">): PuertoDeBarrido {
  return {
    pendientes: () => cupos.pendientesDeBarrido(),
    campana: async (sala) => {
      const objeto = env.SALA.get(env.SALA.idFromName(sala));
      const r = await objeto.campana();
      if (!r.ok) return null;
      const resumen = await objeto.resumenDeCampana();
      return { texto: r.texto, firma: r.firma, sellada: resumen.viva && (resumen.fase === "sellada" || resumen.fase === "sorteada") };
    },
    anotar: (evento, sala, campana) => cupos.anotarBarrido(evento, sala, campana),
  };
}

/** El cuerpo de un pedido como JSON, o `null` si no es JSON o pasa del tope. */
async function leerJson(req: Request, tope: number): Promise<unknown> {
  const largo = Number(req.headers.get("Content-Length") ?? "NaN");
  if (!Number.isFinite(largo) || largo <= 0 || largo > tope) return null;
  try {
    return JSON.parse(await req.text());
  } catch {
    return null;
  }
}

const MOTIVOS: Record<string, number> = {
  "no-existe": 404,
  token: 403,
  llena: 429,
  rapido: 429,
  "sin-registro": 409,
  ajena: 409,
  repetido: 409,
  correcciones: 429,
  "cupo-conexion": 429,
  campana: 409,
  transicion: 409,
  cerrada: 409,
  pase: 409,
  quitada: 409,
  fase: 409,
  "lista-distinta": 409,
  "ganadores-distintos": 409,
  "organizador-distinto": 409,
  "ronda-pasada": 409,
  "sin-sorteo": 409,
  distinto: 409,
  "no-esta": 404,
  "no-gano": 400,
  "sin-billetera": 409,
  rechazos: 429,
  sesion: 401,
  "otra-app": 403,
  "solo-google": 403,
  pollar: 502,
  "sin-pollar": 503,
};

function falla(r: { motivo: string; esperaS?: number }, h: Record<string, string>): Response {
  const espera = r.motivo === "cupo-conexion" || r.motivo === "rechazos";
  const extra =
    r.motivo === "rapido"
      ? { ...h, "Retry-After": "30" }
      : espera
        ? { ...h, "Retry-After": String(r.esperaS ?? 600) }
        : h;
  return json({ error: r.motivo }, MOTIVOS[r.motivo] ?? 400, extra);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origen = req.headers.get("Origin");
    const partes = url.pathname.split("/").filter(Boolean);
    const salaDe = (id: string) => env.SALA.get(env.SALA.idFromName(id));

    // Tus campañas: la lista de una cuenta y usar una en esta compu. Toda respuesta lleva los permisos de origen, también los
    // rechazos: sin ellos el navegador los ve como una falla de red y no puede leer el motivo.
    const listar = partes[0] === "v1" && partes[1] === "mis-campanas" && partes.length === 2;
    const recuperar = partes[0] === "v1" && partes[1] === "campana" && partes[2] === "recuperar" && partes.length === 3;
    if (listar || recuperar) {
      const h = cors(origen, "POST, OPTIONS");
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
      if (req.method !== "POST") return json({ error: "no-existe" }, 404, h);
      if (!tusCampanasPrendido(env)) return json({ error: "apagada" }, 503, h);
      if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
      // Usar en esta compu va atado al aviso por correo de la toma, que es la defensa de quien perdió su sesión: si el aviso no
      // puede salir (su interruptor, el correo a quien gana, el remitente, el enlace de correo o la llave del proveedor), contesta
      // apagada y lo deja dicho con un código fijo. La lista de la cuenta sigue.
      if (recuperar && !correoDeTomaPrendido(env)) {
        registrar("tus-campanas", { codigo: "sin-correo-de-toma" });
        return json({ error: "apagada" }, 503, h);
      }
      const pedido = leerPedidoDeTus(await leerJson(req, MAX_CUERPO_TUS_CAMPANAS), recuperar);
      const responder = (r: { estado: number; cuerpo: Record<string, unknown>; esperaS?: number }): Response =>
        json(r.cuerpo, r.estado, r.esperaS === undefined ? h : { ...h, "Retry-After": String(r.esperaS) });
      if (!pedido.ok) return responder(pedido.respuesta);
      try {
        const deps = depsDeTus(env, req.headers.get("CF-Connecting-IP") ?? "sin-ip", Date.now());
        if (listar) return responder(await listarCampanas(pedido.sesion, deps));
        const r = await recuperarCampana(pedido.sesion, pedido.evento ?? "", deps);
        if (r.aviso) ctx.waitUntil(avisarTomaPorCorreo(env, pedido.sesion, r.aviso));
        return responder(r.respuesta);
      } catch {
        registrar("tus-campanas", { codigo: "inesperado" });
        return json({ error: "ocupado" }, 503, h);
      }
    }

    // Una campaña nace solo con el texto firmado por Tinkazo. Su cupo no gasta el de las salas comunes.
    if (partes[0] === "v1" && partes[1] === "campana" && partes.length === 2) {
      const h = cors(origen, "POST, OPTIONS");
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
      if (req.method !== "POST") return json({ error: "no-existe" }, 404, h);
      if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
      // Vale la llave de siempre y, si el Worker tiene el secreto de la activación automática, la que sale de él.
      const llaves = [llaveDeCampanas(env, req.url), llavePublicaAuto(env)].filter((llave): llave is string => llave !== null);
      if (llaves.length === 0) return json({ error: "sin-llave" }, 503, h);
      const cuerpo = await leerJson(req, MAX_CUERPO_CAMPANA);
      const c = leerCampanaFirmada(cuerpo, llaves, Date.now());
      if (!c.ok) {
        const estado = c.motivo === "forma" ? 400 : c.motivo === "firma" ? 403 : 409;
        return json({ error: c.motivo }, estado, h);
      }
      const vida = vidaDeCampana(env, req.url);
      // El token lo puede traer quien organiza (`intento`): así, si la respuesta se pierde, repetir el pedido devuelve la misma sala.
      const propuesto = (cuerpo as { intento?: unknown } | null)?.intento;
      const propio = typeof propuesto === "string" && ES_TOKEN.test(propuesto);
      const token = propio ? propuesto : base64url(crypto.getRandomValues(new Uint8Array(16)));
      // Para reemplazar la sala de este evento que se cerró o venció, quien organizaba presenta el token de esa sala.
      const previo = bearer(req);
      const anterior = ES_TOKEN.test(previo) ? previo : null;
      // El permiso del evento se confirma recién con la sala creada, y se deshace si la creación falla (`creacion.ts`).
      const creada = await crearSalaDeCampana({
        cupos: env.CUPOS.get(env.CUPOS.idFromName("cupos")),
        salas: {
          viva: (sala) => salaDe(sala).viva(),
          crearCampana: (sala, huella, campana, duracion) => salaDe(sala).crearCampana(huella, campana, duracion),
          cerrar: (sala, clave) => salaDe(sala).cerrar(clave),
        },
        c,
        vida,
        token,
        propio,
        anterior,
        huellaDe: sha256Hex,
        nuevoId,
      });
      if (!creada.ok) {
        // Con la sala viva solo se dice que ya existe: el token de quien organiza es de quien la creó.
        const estado = creada.motivo === "ya-existe" ? 409 : creada.motivo === "ocupado" ? 503 : 429;
        const extra = creada.motivo === "cupo-campanas" ? { ...h, "Retry-After": "86400" } : h;
        return json({ error: creada.motivo }, estado, extra);
      }
      return json({ id: creada.id, token, vence: (creada.creadaEn ?? Date.now()) + vida }, 201, h);
    }

    // Activar una campaña al pagar: la sala firma sola si la comisión del evento se pagó desde la cuenta de quien organiza.
    if (partes[0] === "v1" && partes[1] === "activar" && partes.length === 2) {
      const h = cors(origen, "POST, OPTIONS");
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
      if (req.method !== "POST") return json({ error: "no-existe" }, 404, h);
      if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
      if (configDeActivar(env) === null) return json({ error: "apagada" }, 503, h);
      const cuerpo = await leerJson(req, MAX_CUERPO_ACTIVAR);
      const cupos = env.CUPOS.get(env.CUPOS.idFromName("cupos"));
      const r = await activarCampana(cuerpo, {
        env,
        ahora: Date.now(),
        ip: req.headers.get("CF-Connecting-IP") ?? "sin-ip",
        f: (u, i) => fetch(u, i),
        proveedor: pollarDeLaSala(env),
        topes: {
          antes: (ip, ficha) => cupos.activarAntes(ip, ficha),
          rechazo: (ip, ficha) => cupos.activarRechazo(ip, ficha),
          cuenta: (cuenta, evento) => cupos.activarCuenta(cuenta, evento),
          anotar: (cuenta, evento) => cupos.activarAnotar(cuenta, evento),
          nota: (nota, evento) => cupos.activarNota(nota, evento),
          // Antes de decir de quién es un evento, se mira de quién son las salas anteriores a la dueña (hasta 10 por pedido).
          eventoLibre: async (cuenta, evento) => {
            await barrerSalasViejas(puertoDeBarrido(env, cupos));
            return cupos.eventoLibre(cuenta, evento);
          },
          guardarCampana: (campana) => cupos.guardarCampana(campana),
        },
        registrar,
      });
      return json(r.cuerpo, r.estado, r.esperaS === undefined ? h : { ...h, "Retry-After": String(r.esperaS) });
    }

    if (partes[0] === "v1" && partes[1] === "sala") {
      const id = partes[2];
      const metodos = "GET, POST, PUT, DELETE, OPTIONS";
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origen, metodos) });
      const h = cors(origen, metodos);

      // Crear una sala: solo desde el sitio.
      if (partes.length === 2 && req.method === "POST") {
        if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
        const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
        const permiso = await env.CUPOS.get(env.CUPOS.idFromName("cupos")).permitir(ip);
        if (!permiso.ok) return json({ error: permiso.motivo }, 429, { ...h, "Retry-After": permiso.motivo === "cupo-ip" ? "3600" : "86400" });
        const token = base64url(crypto.getRandomValues(new Uint8Array(16)));
        const prueba = Number(env.VIDA_PRUEBA_MS);
        const vida = Number.isFinite(prueba) && prueba >= 1000 && prueba < VIDA_MS ? prueba : VIDA_MS;
        for (let intento = 0; intento < 5; intento++) {
          const nuevo = nuevoId();
          if (await salaDe(nuevo).crear(await sha256Hex(token), vida)) return json({ id: nuevo, token, vence: Date.now() + vida }, 201, h);
        }
        return json({ error: "ocupado" }, 503, h);
      }

      if (!id || !ES_ID.test(id)) return json({ error: "no-existe" }, 404, h);

      // Un nombre cifrado, desde el celular (la página de abajo, del mismo origen).
      if (partes.length === 3 && req.method === "POST") {
        const largo = Number(req.headers.get("Content-Length") ?? "NaN");
        if (!Number.isFinite(largo)) return json({ error: "largo" }, 411, h);
        if (largo <= 0 || largo > MAX_CUERPO_NOMBRE) return json({ error: "tamaño" }, 413, h);
        const r = await salaDe(id).sumar(await req.text());
        return r.ok ? json({ n: r.n, ...(r.r ? { r: r.r } : {}) }, r.creada ? 201 : 200, h) : falla(r, h);
      }

      // Cerrar la sala.
      if (partes.length === 3 && req.method === "DELETE") {
        const r = await salaDe(id).cerrar(bearer(req));
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // Los nombres, para la pantalla que se recargó o que consulta cada 3 s.
      if (partes.length === 4 && partes[3] === "nombres" && req.method === "GET") {
        const desde = Math.max(0, Math.floor(Number(url.searchParams.get("desde") ?? "0")) || 0);
        const r = await salaDe(id).leer(bearer(req), desde);
        return r.ok ? json(r.nombres, 200, h) : falla(r, h);
      }

      // Quitar un nombre.
      if (partes.length === 5 && partes[3] === "nombres" && req.method === "DELETE") {
        const n = Number(partes[4]);
        if (!Number.isInteger(n) || n < 1) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).quitar(bearer(req), n);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // Los equipos: el registro con cuenta. Quien organiza lo configura; el celular de cada encargado anota su equipo.
      if (partes[3] === "config" && partes.length === 4 && req.method === "PUT") {
        const cuerpo = await leerJson(req, MAX_CUERPO_CONFIG);
        const config = cuerpo === null ? null : validarConfigEquipos(cuerpo);
        if (!config) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).configurar(bearer(req), config);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }
      if (partes[3] === "publico" && partes.length === 4 && req.method === "GET") {
        const r = await salaDe(id).publico();
        return r.ok ? json({ config: r.config, equipos: r.equipos }, 200, h) : falla(r, h);
      }

      // El archivo firmado es público. El pase nuevo y los cambios de fase piden el token de quien organiza.
      if (partes[3] === "campana" && partes.length === 4 && req.method === "GET") {
        const r = await salaDe(id).campana();
        return r.ok ? json({ texto: r.texto, firma: r.firma }, 200, h) : falla(r, h);
      }
      if (partes[3] === "campana" && partes[4] === "estado" && partes.length === 5 && req.method === "GET") {
        const presentado = url.searchParams.get("p");
        const p = presentado === null || ES_PASE.test(presentado) ? presentado : "";
        const token = bearer(req);
        // Sin pase y sin token es lo mismo para todos: se recuerda unos segundos en el borde (ver cache.ts).
        const deLaCache = esCacheable(url, token);
        if (deLaCache) {
          const guardada = await leerGuardada(url);
          if (guardada) return json(guardada.cuerpo, guardada.estado, { ...h, "Cache-Control": CABECERA_DE_CACHE });
        }
        const r = await salaDe(id).estadoDeCampana(p, env.PASE !== "0", token || null);
        if (!r.ok) {
          const sinSala = falla(r, h);
          if (deLaCache) ctx.waitUntil(guardarEnLaCache(url, sinSala.status, { error: r.motivo }));
          return sinSala;
        }
        const cuerpoDeEstado = {
          fase: r.fase,
          total: r.total,
          cierraMs: r.cierraMs,
          pase: r.pase,
          quitadas: r.quitadas,
          // Si la sala le avisa por correo a quien gana: la pantalla de quien se anota lo dice solo si es verdad.
          correo: correoPrendido(env),
          ...(r.vias ? { vias: r.vias } : {}),
          // `tuya` solo llega si el pedido trajo un token, y entonces la respuesta nunca se guarda en la caché.
          ...(r.tuya !== undefined ? { tuya: r.tuya } : {}),
          // El número del sorteo y la ronda, solo con la lista sellada o sorteada.
          ...(r.sorteo !== undefined ? { sorteo: r.sorteo } : {}),
          ...(r.ronda !== undefined ? { ronda: r.ronda } : {}),
        };
        if (!deLaCache) return json(cuerpoDeEstado, 200, h);
        ctx.waitUntil(guardarEnLaCache(url, 200, cuerpoDeEstado));
        return json(cuerpoDeEstado, 200, { ...h, "Cache-Control": CABECERA_DE_CACHE });
      }
      if (partes[3] === "campana" && partes[4] === "pase" && partes.length === 5 && req.method === "GET") {
        const r = await salaDe(id).paseDeLaPantalla(bearer(req));
        return r.ok ? json({ p: r.p, hasta: r.hasta }, 200, h) : falla(r, h);
      }
      if (partes[3] === "campana" && partes[4] === "fase" && partes.length === 5 && req.method === "PUT") {
        const cuerpo = (await leerJson(req, 200)) as {
          fase?: unknown;
          cierraMs?: unknown;
          sorteo?: unknown;
        } | null;
        const cierra = cuerpo?.cierraMs;
        if (!cuerpo || !esFase(cuerpo.fase) || (cierra !== undefined && typeof cierra !== "number")) {
          return json({ error: "forma" }, 400, h);
        }
        if (cuerpo.fase === "sellada") {
          if (typeof cuerpo.sorteo !== "string" || !ES_SORTEO.test(cuerpo.sorteo)) {
            return json({ error: "forma" }, 400, h);
          }
          const sala = salaDe(id);
          const deRed = await sala.redDeCampana();
          if (!deRed.ok) return json({ error: deRed.motivo }, 404, h);
          const leido = await leerSorteoEnLaRed(deRed.red, cuerpo.sorteo, rpcsDe(env, deRed.red), fetch);
          if (leido === "red") return json({ error: "red" }, 502, h);
          if (leido.sello === null) return json({ error: "sin-sorteo" }, 409, h);
          const r = await sala.sellarCampana(bearer(req), cuerpo.sorteo, leido.sello);
          if (!r.ok) {
            const estado = r.motivo === "no-existe" ? 404 : r.motivo === "token" ? 403 : 409;
            return json({ error: r.motivo }, estado, h);
          }
          // Un evento sellado no se reabre: queda anotado. Si la anotación falla, el sello ya es válido y no se le quita.
          if (r.evento !== null && r.sorteoMs !== null) {
            try {
              await env.CUPOS.get(env.CUPOS.idFromName("cupos")).marcarSellado(r.evento, r.sorteoMs);
            } catch {
              registrar("sellado-sin-marca", { codigo: "cupos" });
            }
          }
          return new Response(null, { status: 204, headers: h });
        }
        const r = await salaDe(id).ponerFase(bearer(req), cuerpo.fase, typeof cierra === "number" ? cierra : null);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // El resultado nunca se toma del pedido: el Worker lee los índices del contrato y la sala pone las cuentas.
      if (partes[3] === "campana" && partes[4] === "resultado" && partes.length === 5 && req.method === "PUT") {
        const cuerpo = (await leerJson(req, 24_000)) as {
          sorteo?: unknown;
          comprobante?: unknown;
        } | null;
        if (
          !cuerpo ||
          typeof cuerpo.sorteo !== "string" ||
          !ES_SORTEO.test(cuerpo.sorteo) ||
          typeof cuerpo.comprobante !== "string" ||
          !cuerpo.comprobante.startsWith("/verificar.html") ||
          cuerpo.comprobante.length > 24_000
        ) {
          return json({ error: "forma" }, 400, h);
        }
        const sala = salaDe(id);
        const deRed = await sala.redDeCampana();
        if (!deRed.ok) return json({ error: deRed.motivo }, 404, h);
        const leido = await leerSorteoEnLaRed(deRed.red, cuerpo.sorteo, rpcsDe(env, deRed.red), fetch);
        if (leido === "red") return json({ error: "red" }, 502, h);
        if (leido.sello === null || leido.ganadores === null) {
          return json({ error: "sin-resultado" }, 409, h);
        }
        const r = await sala.guardarResultadoDeCampana(bearer(req), {
          sorteo: cuerpo.sorteo,
          ganadores: leido.ganadores,
          numWinners: leido.sello.numWinners,
          comprobante: cuerpo.comprobante,
        });
        if (!r.ok) {
          const estado = r.motivo === "no-existe" ? 404 : r.motivo === "token" ? 403 : 409;
          return json({ error: r.motivo }, estado, h);
        }
        // El aviso por correo sale aparte: la respuesta no lo espera, y si falla el resultado ya quedó guardado.
        if (r.correo.cuentas.length > 0) {
          const terminada = (cuenta: string): Promise<void> => sala.cerrarAvisoDeCorreo(cuenta);
          ctx.waitUntil(avisarGanadorasPorCorreo(env, deRed.red, r.correo, terminada));
        }
        return new Response(null, { status: 204, headers: h });
      }
      if (partes[3] === "campana" && partes[4] === "resultado" && partes.length === 5 && req.method === "GET") {
        // Es público y es igual para todos: con cientos de celulares preguntando a la vez, el borde lo recuerda unos segundos.
        // Lo que todavía no existe (`sin-resultado`) nunca se recuerda ni en el borde ni en el navegador: es lo único que cambia
        // en el momento del resultado, y quien organiza lo lee apenas la sala lo guarda. Un 404 de ese tipo guardado le taparía
        // las ganadoras y el aviso de premio justo después de que la sala dijo que sí.
        const guardada = await leerGuardada(url);
        if (guardada && !esSinResultado(guardada)) {
          return json(guardada.cuerpo, guardada.estado, { ...h, "Cache-Control": CABECERA_DE_CACHE });
        }
        const r = await salaDe(id).resultadoDeCampana();
        if (!r.ok) {
          const cuerpoSinResultado = { error: r.motivo };
          if (r.motivo === "sin-resultado") return json(cuerpoSinResultado, 404, { ...h, "Cache-Control": "no-store" });
          ctx.waitUntil(guardarEnLaCache(url, 404, cuerpoSinResultado));
          return json(cuerpoSinResultado, 404, { ...h, "Cache-Control": CABECERA_DE_CACHE });
        }
        const cuerpoDelResultado = { sorteo: r.sorteo, ganadoras: r.ganadoras, comprobante: r.comprobante };
        ctx.waitUntil(guardarEnLaCache(url, 200, cuerpoDelResultado));
        return json(cuerpoDelResultado, 200, { ...h, "Cache-Control": CABECERA_DE_CACHE });
      }

      // Quitar deja constancia del motivo y avisar marca a una ganadora. Las dos escrituras piden el token.
      if (partes[3] === "campana" && partes[4] === "quitar" && partes.length === 5 && req.method === "POST") {
        const cuerpo = (await leerJson(req, 200)) as { n?: unknown; motivo?: unknown } | null;
        if (
          !cuerpo ||
          typeof cuerpo.n !== "number" ||
          !Number.isSafeInteger(cuerpo.n) ||
          cuerpo.n < 1 ||
          !esMotivoDeSalida(cuerpo.motivo)
        ) {
          return json({ error: "forma" }, 400, h);
        }
        const r = await salaDe(id).quitarPersona(bearer(req), cuerpo.n, cuerpo.motivo);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }
      if (partes[3] === "campana" && partes[4] === "avisar" && partes.length === 5 && req.method === "POST") {
        const cuerpo = (await leerJson(req, 200)) as { cuenta?: unknown } | null;
        if (!cuerpo || !esCuentaValida(cuerpo.cuenta)) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).avisarGanadora(bearer(req), cuerpo.cuenta);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // La sesión se verifica acá, fuera del objeto: una espera de red dentro dejaría entrar otros pedidos en el medio.
      if (partes[3] === "campana" && partes[4] === "alta" && partes.length === 5 && req.method === "POST") {
        if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
        const cuerpo = (await leerJson(req, MAX_CUERPO_ALTA)) as {
          token?: unknown;
          d?: unknown;
          llave?: unknown;
          p?: unknown;
        } | null;
        if (!cuerpo) return json({ error: "forma" }, 400, h);
        const token = cuerpo.token;
        const d = cuerpo.d;
        const llave = cuerpo.llave;
        if (
          !formaDeToken(token, Date.now()) ||
          !equipoCifradoValido(d) ||
          typeof llave !== "string" ||
          !ES_LLAVE.test(llave)
        ) {
          return json({ error: "forma" }, 400, h);
        }
        let p: string | null = null;
        if (cuerpo.p !== undefined && cuerpo.p !== null) {
          if (typeof cuerpo.p !== "string" || !ES_PASE.test(cuerpo.p)) return json({ error: "forma" }, 400, h);
          p = cuerpo.p;
        }
        const exigirPase = env.PASE !== "0";
        if (exigirPase && p === null) return falla({ motivo: "pase" }, h);
        const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
        const sala = salaDe(id);
        // Antes de llamar al proveedor: fase, pase, topes de rechazos y, si la ficha ya se verificó hace poco, el reingreso.
        const antes = await sala.prealta(ip, p, exigirPase, token, llave, d);
        if (!antes.ok) return falla(antes, h);
        if (antes.cuenta !== null) return json({ cuenta: antes.cuenta, ya: true }, 200, h);
        const proveedor = pollarDeLaSala(env);
        if (!proveedor) return falla({ motivo: "sin-pollar" }, h);
        const sesion = await proveedor.verificar(token);
        if (!sesion.ok) {
          if (sesion.motivo === "pollar") return falla({ motivo: "pollar" }, h);
          await sala.rechazo(ip, token);
          return falla({ motivo: sesion.motivo }, h);
        }
        // Solo entra quien el proveedor dice que es de Google. El modo suave es solo un interruptor de emergencia.
        const via = viaPermitida(sesion.via, modoSoloGoogle(env.SOLO_GOOGLE));
        if (!via.ok) {
          await sala.rechazo(ip, token);
          return falla({ motivo: "solo-google" }, h);
        }
        const anterior = await sala.yaEsta(sesion.usuario, llave, ip, token, sesion.vence, d);
        if (!anterior.ok) return falla(anterior, h);
        if (anterior.cuenta !== null) return json({ cuenta: anterior.cuenta, ya: true }, 200, h);
        let cuenta = sesion.cuenta;
        if (cuenta === null) {
          const billetera = await proveedor.billeteraDe(sesion.usuario);
          if (!billetera.ok) return falla({ motivo: "pollar" }, h);
          if (billetera.cuenta === null) {
            // Costó dos llamadas al proveedor: cuenta como un rechazo de esa ficha, así repetirla no lo llama sin límite.
            await sala.rechazo(ip, token);
            return falla({ motivo: "sin-billetera" }, h);
          }
          cuenta = billetera.cuenta;
        }
        const r = await sala.anotarPersona({
          usuario: sesion.usuario,
          cuenta,
          d,
          llave,
          ip,
          p,
          exigirPase,
          via: via.via,
          token,
          vence: sesion.vence,
        });
        if (!r.ok) return falla(r, h);
        return r.ya ? json({ cuenta: r.cuenta, ya: true }, 200, h) : json({ cuenta: r.cuenta }, 201, h);
      }

      // Consulta de solo lectura: no exige origen, pero sin la llave del celular no dice si la cuenta está anotada.
      if (partes[3] === "campana" && partes[4] === "yo" && partes.length === 5 && req.method === "POST") {
        const cuerpo = (await leerJson(req, 300)) as { cuenta?: unknown; llave?: unknown; c?: unknown } | null;
        if (!cuerpo || !esCuentaValida(cuerpo.cuenta) || typeof cuerpo.llave !== "string" || !ES_LLAVE.test(cuerpo.llave)) {
          return json({ error: "forma" }, 400, h);
        }
        // La marca de correo confirmado deja de ser una lectura: con la marca prendida pide un origen del sitio. Apagada, se ignora.
        let confirmo = false;
        if (cuerpo.c !== undefined && marcaDeCorreoPrendida(env)) {
          if (cuerpo.c !== true) return json({ error: "forma" }, 400, h);
          if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
          confirmo = true;
        }
        const r = await salaDe(id).estadoDeCelular(cuerpo.cuenta, cuerpo.llave, confirmo);
        return r.ok
          ? json(
              {
                fase: r.fase,
                total: r.total,
                cierraMs: r.cierraMs,
                anotada: r.anotada,
                ...(r.sorteo !== undefined ? { sorteo: r.sorteo } : {}),
                ...(r.ronda !== undefined ? { ronda: r.ronda } : {}),
                ...(r.quitada ? { quitada: r.quitada } : {}),
                ...(r.gano !== undefined ? { gano: r.gano } : {}),
                ...(r.puesto !== undefined ? { puesto: r.puesto } : {}),
                ...(r.avisado ? { avisado: true } : {}),
              },
              200,
              h,
            )
          : falla(r, h);
      }

      if (partes[3] === "equipos") {
        if (partes.length === 4 && req.method === "POST") {
          if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
          const cuerpo = (await leerJson(req, MAX_CUERPO_EQUIPO)) as { cuenta?: unknown; d?: unknown; llave?: unknown } | null;
          if (!cuerpo || typeof cuerpo.cuenta !== "string" || !esCuentaValida(cuerpo.cuenta) || !equipoCifradoValido(cuerpo.d)) return json({ error: "forma" }, 400, h);
          // La llave del celular: sin ella no hay forma de probar después que es el mismo celular.
          if (typeof cuerpo.llave !== "string" || !ES_LLAVE.test(cuerpo.llave)) return json({ error: "forma" }, 400, h);
          const r = await salaDe(id).anotarEquipo(cuerpo.cuenta, cuerpo.d, cuerpo.llave, req.headers.get("CF-Connecting-IP") ?? "sin-ip");
          return r.ok ? json({ n: r.n, estado: r.estado }, 201, h) : falla(r, h);
        }
        if (partes.length === 4 && req.method === "GET") {
          const desde = Math.max(0, Math.floor(Number(url.searchParams.get("desde") ?? "0")) || 0);
          const r = await salaDe(id).leerEquipos(bearer(req), desde);
          return r.ok ? json(r.equipos, 200, h) : falla(r, h);
        }
        const quien = partes[4] ?? "";
        if (partes.length === 5 && req.method === "GET" && esCuentaValida(quien)) {
          const r = await salaDe(id).equipoDe(quien);
          return r.ok ? json({ n: r.n, estado: r.estado }, 200, h) : falla(r, h);
        }
        if (partes.length === 5 && (req.method === "PUT" || req.method === "DELETE")) {
          const n = Number(quien);
          if (!Number.isInteger(n) || n < 1) return json({ error: "forma" }, 400, h);
          if (req.method === "DELETE") {
            const r = await salaDe(id).quitarEquipo(bearer(req), n);
            return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
          }
          const cuerpo = (await leerJson(req, 200)) as { estado?: unknown } | null;
          if (!cuerpo || !esEstadoEquipo(cuerpo.estado)) return json({ error: "forma" }, 400, h);
          const r = await salaDe(id).cambiarEstado(bearer(req), n, cuerpo.estado);
          return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
        }
      }

      // La ronda compartida: la pantalla (con el token) fija qué ronda decide y con qué lista.
      if (partes.length === 4 && partes[3] === "ronda" && req.method === "PUT") {
        const cuerpo = await leerJson(req, MAX_CUERPO_RONDA);
        const ronda = cuerpo === null ? null : validarRondaDeSala(cuerpo);
        if (!ronda) return json({ error: "forma" }, 400, h);
        const r = await salaDe(id).fijarRonda(bearer(req), ronda);
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // Cerrar la lista: con el token, desde la pantalla. Después ya no entra nadie.
      if (partes.length === 4 && partes[3] === "cierre" && req.method === "POST") {
        const r = await salaDe(id).cerrarLista(bearer(req));
        return r.ok ? new Response(null, { status: 204, headers: h }) : falla(r, h);
      }

      // Lo que mira el celular del participante cada 3 s: la lista cifrada (la clave viaja en el QR), el estado y la ronda.
      if (partes.length === 4 && partes[3] === "vivo" && req.method === "GET") {
        const desde = Math.max(0, Math.floor(Number(url.searchParams.get("desde") ?? "0")) || 0);
        const r = await salaDe(id).vivo(desde);
        return r.ok ? json({ hay: r.hay, estado: r.estado, ronda: r.ronda, ns: r.ns, nombres: r.nombres }, 200, h) : falla(r, h);
      }

      // La pantalla abre su WebSocket. Los navegadores mandan el origen: solo el sitio.
      if (partes.length === 4 && partes[3] === "pantalla" && req.method === "GET") {
        if (origen && !origenPermitido(origen)) return json({ error: "origen" }, 403, h);
        return salaDe(id).fetch(req);
      }
      return json({ error: "no-existe" }, 404, h);
    }

    // La página del celular: s.tinkazo.app/<id>. No toca la sala: la pregunta la hace la página al sumar.
    if (req.method === "GET" && partes.length === 1 && partes[0] && ES_ID.test(partes[0])) {
      return new Response(paginaCelular(), { headers: CABECERAS_PAGINA });
    }
    if (req.method === "GET" && partes.length === 0) return Response.redirect(SITIO, 302);
    return new Response("No existe.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
} satisfies ExportedHandler<Env>;
