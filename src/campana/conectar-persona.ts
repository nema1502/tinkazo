/**
 * Conecta las pantallas del celular (`DepsDelCelular`) con lo de verdad en una campaña de personas: la sala, el botón de Google
 * del sitio y la llave de este celular. Hace lo mismo que `conectar.ts` para las campañas de cuentas, sin billetera: la persona
 * entra con Google, la página le manda su token de identidad a la sala y la sala la anota por su línea. No se carga el kit del
 * proveedor de cuentas ni se espera ninguna cuenta.
 *
 * Reglas que se cumplen acá:
 *  - El token de Google vive solo en esta función, en una variable, hasta que el alta sale bien o la sala lo rechaza. No se
 *    guarda, no se escribe en la consola ni en ningún error.
 *  - Lo único que el celular recuerda es la llave de este aparato y el recuerdo de siempre (`memoria.ts`), sin cuenta. Quien
 *    vuelve a abrir el enlace ve que está adentro por esa llave, sin entrar de nuevo.
 *  - Con 150 celulares a la vez, las consultas se desparraman en el tiempo y los reintentos del alta tienen tope.
 *  - El permiso para guardar el perfil (`perfil: true`) viaja en el alta solo si la pantalla le dijo a la persona qué se guarda.
 *    Eso pide dos cosas: que esta página se construyó para guardarlo (`permisoDePerfil`) y que la sala, en su estado público,
 *    dijo que lo guarda. Sin eso la pantalla dice lo de siempre y el cuerpo del alta es el de siempre, letra por letra: una
 *    página vieja en la memoria de un celular, o una sala apagada, nunca hacen guardar nada ni prometen que se guarda.
 */

import { cifrarEquipo } from "../equipos/datos";
import { hayLlaveDelCelular, llaveDelCelular, olvidarLlaveDelCelular } from "../equipos/celular";
import { estadoPublico, type DependenciasDeCampana, type SosiegoDelAlta } from "../sala/campana";
import {
  anotarPersonaEnCampana,
  miEstadoDePersona,
  resultadoDeCampanaDePersona,
  type CuerpoDeAltaDePersona,
} from "../sala/celular-persona";
import type { NetworkName } from "../stellar/config";
import type { DepsDelCelular, EstadoPublico, ResultadoDelAlta } from "./celular";
import type { Campana } from "./modelo";
import { nombreDeLaCredencial, type BotonDeGoogleDeVerdad } from "./google";
import {
  almacenEnMemoria,
  CONSULTA_ESTIRADA_MS,
  ESPERA_DE_LA_PRIMERA_MS,
  type BaseDelCelular,
} from "./conectar";
import { SIN_CUENTA } from "./memoria";
import { claveConPerfil, permisoDePerfil } from "./persona-bandera";

export interface PiezasDeLaPersona {
  base: BaseDelCelular;
  campana: Campana;
  servicio: string;
  sala: string;
  /** La clave del QR, que cifra el nombre. Viene del fragmento de la dirección y no sale de la página. */
  clave: string;
  /** El pase del QR, o null si el enlace no lo trae. */
  pase: string | null;
  /** El botón de Google del sitio. */
  google: BotonDeGoogleDeVerdad;
  /** Donde vive la memoria del celular (`localStorage`), o null si el navegador lo bloquea. */
  memoria: Storage | null;
  red: NetworkName;
  /** Si el navegador dice que no hay conexión: sin ella no se manda nada. */
  enLinea: () => boolean;
  /** El enlace de esta página. */
  enlace: () => string;
  /** Un solo alta a la vez por celular, aunque haya dos pestañas. */
  bloquear?: <T>(nombre: string, trabajo: () => Promise<T>) => Promise<T>;
  /** Para pedir sin la red de verdad. */
  dep?: DependenciasDeCampana;
}

const esperar = (ms: number): Promise<void> =>
  new Promise((resolver) => {
    setTimeout(resolver, ms);
  });

/** Las dependencias del celular de una campaña de personas, con lo de verdad. */
export function depsDePersona(p: PiezasDeLaPersona): DepsDelCelular {
  const dep: DependenciasDeCampana = p.dep ?? {};
  const ahora = dep.ahora ?? ((): number => Date.now());
  const azar = dep.azar ?? Math.random;
  const almacenDeLlaves = p.memoria ?? almacenEnMemoria();
  const sosiego: SosiegoDelAlta = { finalDeFamiliaEn: null };
  const bloquear = p.bloquear ?? (<T>(_nombre: string, trabajo: () => Promise<T>): Promise<T> => trabajo());
  /** El token de identidad que entregó Google, hasta que el alta sale bien o la sala lo rechaza. */
  let credencial: string | null = null;
  let primeraConsulta = true;
  /** Si la sala dijo, en su última consulta, que guarda el perfil. Mientras no lo diga, la pantalla no promete nada. */
  let salaGuardaPerfil = false;
  /** Si la última vez que la pantalla pidió la nota junto al botón de Google fue con el texto que dice que se guarda. */
  let notaConPerfil = false;
  /** La llave se lee de nuevo cada vez: con dos pestañas abiertas, las dos usan la que quedó guardada. */
  const llave = (): string => llaveDelCelular(p.sala, almacenDeLlaves);

  async function consultarPublico(): Promise<EstadoPublico | "red" | "terminada"> {
    let r = await estadoPublico(p.servicio, p.sala, p.pase, dep);
    if (primeraConsulta) {
      primeraConsulta = false;
      if (r === "red") {
        await esperar(ESPERA_DE_LA_PRIMERA_MS);
        r = await estadoPublico(p.servicio, p.sala, p.pase, dep);
      }
    }
    if (r !== "red" && r !== "terminada") salaGuardaPerfil = r.perfil === true;
    return r;
  }

  async function anotarEnLaSala(
    nombre: string | null,
    alReintentar: (motivo: "mucha" | "creando") => void,
    inicio: number,
  ): Promise<ResultadoDelAlta> {
    if (!p.enLinea()) return { ok: false, motivo: "red" };
    const google = credencial;
    // Sin el token no hay con qué anotarse: se entra de nuevo con el botón.
    if (google === null) return { ok: false, motivo: "sesion" };
    const d = await cifrarEquipo(p.clave, { nombre: nombre ?? "", integrantes: [] });
    const cuerpo: CuerpoDeAltaDePersona = {
      google,
      d,
      llave: llave(),
      p: p.pase,
      // El permiso va con el pedido, y solo si la pantalla dijo qué se guarda: sitio construido para guardar, sala que lo confirmó y
      // nota pintada con ese texto. Sin él queda sin definir y no viaja.
      perfil: notaConPerfil ? permisoDePerfil() : undefined,
    };
    const opciones = { inicio, sosiego };
    let r = await anotarPersonaEnCampana(p.servicio, p.sala, cuerpo, dep, alReintentar, opciones);
    // La sala pudo anotarla y perderse la respuesta. Lo que contesta la llave del celular no prueba nada: ese celular pudo
    // anotar antes a otra persona. Se repite el mismo alta, que la sala reconoce por la persona del token y contesta `ya`.
    // Sigue dentro del tope del toque: pasado ese tiempo es un solo pedido.
    if (!r.ok && (r.motivo === "red" || r.motivo === "proveedor")) {
      const otra = await anotarPersonaEnCampana(p.servicio, p.sala, cuerpo, dep, alReintentar, opciones);
      if (otra.ok || otra.motivo === "sesion") r = otra;
    }
    if (r.ok) {
      credencial = null;
      return { ok: true, ya: r.ya };
    }
    // Un token que la sala rechazó no sirve para repetir: hay que entrar de nuevo.
    if (r.motivo === "sesion") credencial = null;
    return { ok: false, motivo: r.motivo };
  }

  return {
    ...p.base,
    // Los dos textos que dicen qué se guarda cambian por los del perfil si esta página se construyó para guardarlo Y la sala dijo que
    // lo guarda. Acá y no en la pantalla: la entrada de la página del celular tiene un tope de peso y esto solo lo necesita una
    // campaña de personas.
    tx: (clave) => {
      const c = salaGuardaPerfil ? claveConPerfil(clave) : clave;
      if (clave === "cpEntrarNotaPersona") notaConPerfil = c !== clave;
      return p.base.tx(c);
    },
    // Las consultas de cada 15 segundos pasan a 30, y cada celular elige su propio ritmo: no pegan todos en el mismo segundo.
    cada: (f, ms, modo) => p.base.cada(f, modo === "exacta" ? ms : Math.round((modo === "azar" || ms !== 15_000 ? ms : CONSULTA_ESTIRADA_MS) * (0.8 + azar() * 0.4))),
    campana: p.campana,
    publico: consultarPublico,
    // Sin cuenta no hay sesión que retomar: quien ya se anotó se reconoce por la llave de este celular.
    sesion: async () => null,
    // La entrada es el botón de Google (`persona.google`): esto no se usa y no abre ninguna ventana.
    entrar: () => Promise.reject(new Error("google")),
    persona: {
      google: {
        montar: (contenedor, alEntrar, alFallar, textoDeEspera) =>
          p.google.montar(
            contenedor,
            (token) => {
              credencial = token;
              alEntrar({ cuenta: SIN_CUENTA, nombre: nombreDeLaCredencial(token) });
            },
            alFallar,
            textoDeEspera,
          ),
      },
    },
    // El toque se cuenta desde que este celular tiene el candado: esperar a que otra pestaña termine no gasta el tiempo del toque.
    anotar: (nombre, alReintentar) =>
      bloquear(`tinkazo.campana.alta.${p.sala}`, () => anotarEnLaSala(nombre, alReintentar, ahora())),
    yo: () => miEstadoDePersona(p.servicio, p.sala, llave(), dep),
    llaveGuardada: () => hayLlaveDelCelular(p.sala, almacenDeLlaves),
    azar,
    resultado: async () => {
      const r = await resultadoDeCampanaDePersona(p.servicio, p.sala, dep);
      return r === "terminada" ? "red" : r;
    },
    // En una campaña de personas el premio se entrega en mano: la página no ofrece recibir nada.
    recibir: () => undefined,
    // Quien dice que este celular no es suyo suelta también su llave: la próxima persona no hereda lo que anotó la anterior.
    salir: async () => {
      credencial = null;
      olvidarLlaveDelCelular(p.sala, almacenDeLlaves);
    },
    // Sin cuenta que mover no hay costo de retiro que decir.
    costoDelRetiro: () => null,
    enlace: p.enlace,
    memoria: p.memoria,
    sala: p.sala,
  };
}
