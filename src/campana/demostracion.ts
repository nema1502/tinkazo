/** Dependencias locales para recorrer todas las pantallas sin red, sin Google y sin guardar recuerdos. */

import type {
  AccionesDeLaCuenta,
  DepsDelCelular,
  EstadoPropio,
  Fase,
  ResultadoDelAlta,
  SesionDelCelular,
} from "./celular";
import { roundAt } from "../protocol/quicknet-hora";
import type { CuentaDelCelular, LecturaDelCelular } from "../stellar/wallet-pollar";
import type { Campana } from "./modelo";

type BaseDeDemostracion = Pick<
  DepsDelCelular,
  "tx" | "idioma" | "enApp" | "ahora" | "cada" | "visible" | "alVolver" | "vibrar" | "movimientoReducido"
>;

const CUENTA = `G${"A".repeat(55)}`;
const OTRA_CUENTA = `G${"B".repeat(55)}`;

/** Lo que dice la lectura de la cuenta en la demostración: solo el estado cambia, lo demás es de mentira. */
const lecturaDeMentira = (dicho: CuentaDelCelular): LecturaDelCelular => ({
  estado: dicho,
  protegida: dicho === "lista",
  correoDeLaSesionConfirmado: dicho === "lista",
  puedeMandar: dicho === "falta",
  correoTapado: dicho === "falta" ? "a•••@example.com" : null,
  limite: false,
});

/** Lo que hace la tarjeta de confirmar el correo en la demostración: todo sale bien, con una pausa corta, y nada se manda. */
const accionesDeMentira = (): AccionesDeLaCuenta => ({
  puedeDesbloqueo: async () => true,
  mandarCodigo: () => new Promise<void>((resolver) => void window.setTimeout(resolver, 700)),
  confirmarCodigo: () => new Promise((resolver) => void window.setTimeout(() => resolver(lecturaDeMentira("lista")), 700)),
  usarDesbloqueo: () => new Promise<boolean>((resolver) => void window.setTimeout(() => resolver(true), 700)),
  alCambiar: () => () => undefined,
});

/** Ganaste con cada estado de la cuenta, para ver su línea y su botón: ganaste-listo, ganaste-otro, ganaste-desbloqueo y ganaste-sinforma. */
const GANASTE_SEGUN_LA_CUENTA: Readonly<Record<string, CuentaDelCelular>> = {
  "ganaste-listo": "lista",
  "ganaste-otro": "otro-con-correo",
  "ganaste-desbloqueo": "otro-con-desbloqueo",
  "ganaste-sinforma": "sin-forma",
};

/** Cada estado pedido por la dirección prepara únicamente las respuestas que esa pantalla necesita. */
export function depsDeDemostracion(
  base: BaseDeDemostracion,
  campana: Campana,
  estado: string | null,
): DepsDelCelular {
  let total = campana.anotadas;
  // Con la lista sellada y la ronda a unos 50 segundos: la cuenta regresiva, y 20 segundos después de la hora, el resultado.
  // empieza-tarjeta suma la tarjeta de confirmar el correo, que pasa a ser un enlace de texto debajo de la cuenta.
  const conRonda = estado === "empieza" || estado === "empieza-tarjeta";
  const ronda = roundAt(Date.now() / 1000 + 50) + 1;
  const deLaRonda = (): { ronda: number; horaSala: number } | Record<string, never> => (conRonda ? { ronda, horaSala: Date.now() } : {});
  const conSesion = estado === "hola" || estado === "adentro" || estado === "sellada" || conRonda
    || estado === "ganaste" || estado === "avisado" || estado === "otra" || estado === "quitada"
    || estado === "libre" || estado === "naciendo" || estado === "sinforma" || estado === "sinforma-adentro" || estado === "confirmar"
    || (estado !== null && estado in GANASTE_SEGUN_LA_CUENTA);
  const sesion = conSesion ? { cuenta: CUENTA, nombre: "Ana P." } : null;
  const fase: Fase = estado === "lista"
    ? "lista"
    : estado === "cerrada"
      ? "cerrada"
      : estado === "sellada" || conRonda
        ? "sellada"
        : estado === "ganaste" || estado === "avisado" || estado === "otra" || estado === "quitada" || (estado !== null && estado in GANASTE_SEGUN_LA_CUENTA)
          ? "sorteada"
          : "abierta";
  const propio = (): EstadoPropio => ({
    fase,
    total,
    cierraMs: campana.cierraMs,
    anotada: estado !== "hola" && estado !== "sinforma",
    quitada: estado === "quitada" ? "evento" : undefined,
    gano: estado === "ganaste" || estado === "avisado" || (estado !== null && estado in GANASTE_SEGUN_LA_CUENTA),
    avisado: estado === "avisado",
    ...deLaRonda(),
  });
  // La espera de quien ya tiene su cuenta lista (libre), la de una cuenta que se está creando (naciendo: la primera lectura
  // todavía no sabe y la que sigue, a los 5 segundos, dice que está lista) y las de una cuenta que ya se usó en otro navegador:
  // el aviso de Hola (sinforma) y la línea de la espera (sinforma-adentro).
  let lecturas = 0;
  const cuenta = estado === "libre" || estado === "naciendo" || estado === "sinforma" || estado === "sinforma-adentro" || estado === "confirmar" || estado === "empieza-tarjeta"
    || (estado !== null && estado in GANASTE_SEGUN_LA_CUENTA)
    ? {
      ...(estado === "confirmar" || estado === "empieza-tarjeta" ? { confirmar: async () => accionesDeMentira() } : {}),
      leer: async (): Promise<LecturaDelCelular> => {
        lecturas += 1;
        if (estado === "confirmar" || estado === "empieza-tarjeta") return lecturaDeMentira("falta");
        if (estado !== null && estado in GANASTE_SEGUN_LA_CUENTA) return lecturaDeMentira(GANASTE_SEGUN_LA_CUENTA[estado] as CuentaDelCelular);
        if (estado === "sinforma" || estado === "sinforma-adentro") return lecturaDeMentira("sin-forma");
        return lecturaDeMentira(estado === "naciendo" && lecturas === 1 ? "naciendo" : "lista");
      },
    }
    : undefined;
  return {
    ...base,
    ...(cuenta ? { cuenta } : {}),
    enApp: base.enApp || estado === "app",
    campana,
    publico: async () => {
      if (estado === "sin-red") return "red";
      if (estado === "termino") return "terminada";
      const respuesta = {
        fase,
        total,
        cierraMs: campana.cierraMs,
        pase: estado === "pase" ? "vencido" as const : "vale" as const,
        correo: false,
        ...deLaRonda(),
      };
      total += 1;
      return respuesta;
    },
    sesion: async () => sesion,
    // El estado limite: el servicio de cuentas frena el ingreso por 20 segundos, para ver la línea con la cuenta que baja.
    entrar: () => new Promise<SesionDelCelular>((resolve, rechazar) => {
      window.setTimeout(() => {
        if (estado === "limite") rechazar(Object.assign(new Error("limite"), { segundos: 20 }));
        else resolve({ cuenta: CUENTA, nombre: "Ana P." });
      }, 500);
    }),
    anotar: () => new Promise<ResultadoDelAlta>((resolve) => {
      window.setTimeout(() => resolve({ ok: true, ya: false }), 1000);
    }),
    yo: async () => propio(),
    resultado: async () => ({
      ganadoras: [estado === "otra" ? OTRA_CUENTA : CUENTA],
      comprobante: "/verificar.html?demo=1",
    }),
    recibir: () => undefined,
    enlaceDelPremio: () => "https://tinkazo.app/?red=oficial&premio=1",
    salir: async () => undefined,
    costoDelRetiro: () => base.idioma() === "es" ? "0,50" : "0.50",
    enlace: () => "https://tinkazo.app/participar.html?demo=campana",
    memoria: null,
    sala: campana.evento,
  };
}
