import type { Lang } from "../idioma";

/**
 * Los textos de la página de prueba, en español y en inglés. El mismo conjunto de claves en las dos lenguas: el tipo lo exige.
 * Cada pantalla tiene un título, una línea y como mucho un botón principal y un enlace secundario. Donde cambia según el
 * aparato hay dos textos (`Cel` y `Compu`). Las líneas pueden traer `<strong>`: son constantes de acá, nunca texto de afuera.
 */
const ES = {
  aviso: "Es una prueba. Nada de acá vale plata.",

  cargandoTitulo: "Preparando la prueba",
  cargandoLinea: "Un momento.",

  inicioTitulo: "Probá tu llave sin contraseña",
  inicioLineaCel: "Tu teléfono la guarda y la abre con tu huella, tu cara o tu clave. Con ella sellás una lista y sorteás.",
  inicioLineaCompu: "Tu computadora la guarda y la abre con tu huella, tu cara o tu PIN. Con ella sellás una lista y sorteás.",
  inicioPrincipal: "Crear mi llave",
  inicioSecundario: "Ya tengo mi llave",

  yaHayLlaveTitulo: "Ya tenés una llave acá",
  yaHayLlaveLinea: "Usala para entrar a tu cuenta de prueba.",
  yaHayLlavePrincipal: "Usar mi llave",
  yaHayLlaveSecundario: "Crear otra llave",

  sinLlavesTitulo: "Este navegador no guarda llaves",
  sinLlavesLinea: "Abrí esta página en Chrome o Safari, o en otro aparato.",
  sinLlavesPrincipal: "Copiar el enlace",

  enAppTitulo: "Mejor en el navegador",
  enAppLinea: "Algunas apps no dejan crear llaves. Si falla, tocá los tres puntos y elegí <strong>Abrir en el navegador</strong>.",
  enAppPrincipal: "Probar acá",
  enAppSecundario: "Copiar el enlace",

  sinBloqueoTitulo: "Falta el bloqueo de pantalla",
  sinBloqueoLinea: "La llave se abre con tu huella, tu cara o un PIN. Ponelo en los ajustes del teléfono y volvé.",
  sinBloqueoPrincipal: "Ya lo puse",
  sinBloqueoSecundario: "Probar igual",

  miraTituloCel: "Mirá tu teléfono",
  miraTituloCompu: "Mirá tu pantalla",
  miraCrearLinea: "Te pide tu huella, tu cara o tu clave para crear la llave.",
  miraSellarLinea: "Tu llave aprueba la lista.",
  entrandoLinea: "Elegí la que dice <strong>Llave de prueba de Tinkazo</strong>.",

  armandoTitulo: "Armando tu cuenta",
  armandoLinea: "Tarda unos segundos.",

  cuentaListaTitulo: "Tu cuenta está lista",
  cuentaListaLinea: "Ahora sellá una lista de ejemplo con Ana, Nora y Beto. Tu llave la aprueba.",
  cuentaListaPrincipal: "Sellar la lista",

  sellandoTitulo: "Sellando la lista",
  sellandoLinea: "Tarda unos segundos.",

  esperandoTitulo: "La lista quedó sellada",
  esperandoLinea: "Dejá esta pantalla abierta. El sorteo sale solo en un par de minutos.",
  esperandoSecundario: "Ver el comprobante",

  listoTitulo: "Salió {nombre}",
  listoLinea: "Cualquiera puede comprobarlo. Abajo está lo que costó cada paso.",
  listoPrincipal: "Comprobar el sorteo",
  listoSecundario: "Hacer otro sorteo",

  buscandoTitulo: "Buscando tu cuenta",
  buscandoLinea: "Tarda unos segundos.",

  noApareceTitulo: "No encontramos tu cuenta",
  noApareceLinea: "No pudimos llegar a ella ahora. Probá de nuevo en un momento.",
  noAparecePrincipal: "Probar de nuevo",
  noApareceSecundario: "Crear otra llave",

  sinCuentaTitulo: "No encontramos una cuenta con esta llave",
  sinCuentaLinea: "Elegí la que dice <strong>Llave de prueba de Tinkazo</strong>. Si la creaste hace más de una semana, ya terminó y podés crear otra.",
  sinCuentaPrincipal: "Probar de nuevo",
  sinCuentaSecundario: "Crear otra llave",

  vencidaTitulo: "Esta cuenta de prueba ya terminó",
  vencidaLinea: "Las cuentas de esta prueba duran una semana. Podés crear una nueva.",
  vencidaPrincipal: "Crear otra llave",

  noSeComproboTitulo: "No pudimos comprobar esta cuenta",
  noSeComproboLinea: "Por cuidado no la usamos. Podés crear una llave nueva.",
  noSeComproboPrincipal: "Crear otra llave",

  canceladaLinea: "No se usó la llave. Probá de nuevo cuando quieras.",

  sinFondosTitulo: "La prueba no pudo arrancar",
  sinFondosLinea: "El servicio que paga la prueba no contestó. Probá en unos minutos.",
  sinFondosPrincipal: "Probar de nuevo",

  cuentaSinArmarTitulo: "Tu llave está, falta la cuenta",
  cuentaSinArmarLinea: "Probá de nuevo. No te va a pedir el desbloqueo.",
  cuentaSinArmarPrincipal: "Probar de nuevo",

  lentoTitulo: "Esto está tardando",
  lentoLinea: "Puede que haya salido igual. Tocá para mirar.",
  lentoPrincipal: "Mirar de nuevo",

  noSeArmoTitulo: "No se pudo armar la cuenta",
  noSeArmoLinea: "No se gastó nada tuyo. Probá de nuevo.",
  noSeArmoPrincipal: "Probar de nuevo",

  noSeSelloTitulo: "No se pudo sellar",
  noSeSelloLinea: "No se grabó nada. Probá de nuevo.",
  noSeSelloPrincipal: "Probar de nuevo",

  sorteoTrabadoTitulo: "El sorteo no salió todavía",
  sorteoTrabadoLinea: "Se puede probar las veces que haga falta.",
  sorteoTrabadoPrincipal: "Sortear ahora",
  sorteoTrabadoSecundario: "Ver el comprobante",

  fallaTitulo: "Algo no anduvo",
  fallaLinea: "Probá de nuevo desde el principio.",
  fallaPrincipal: "Empezar de nuevo",

  noEsAcaTitulo: "Esta prueba no está acá",
  noEsAcaLinea: "Se abre solo en las versiones de prueba del sitio.",
  noEsAcaPrincipal: "Ir a Tinkazo",

  costosTitulo: "Lo que costó cada paso",
  costosCrear: "Crear la cuenta",
  costosSellar: "Sellar",
  costosSortear: "Sortear",
  costosNota: "Cifras de la red de prueba. No son el precio de la red principal.",
  costosTotal: "Total",
  costosInclusion: "Inclusión",
  costosRecursos: "Recursos",
  costosAlquiler: "Alquiler",
  costosInstrucciones: "Instrucciones",
  costosBytes: "Bytes escritos",
  costosSinDatos: "Sin datos de este paso.",
  fallaCodigo: "Código de la falla",
  enlaceCopiado: "Enlace copiado.",
  nombreDeLaLlave: "Llave de prueba de Tinkazo",
} as const;

export type ClaveDePrueba = keyof typeof ES;

const EN: Record<ClaveDePrueba, string> = {
  aviso: "This is a test. Nothing here is worth money.",

  cargandoTitulo: "Getting the test ready",
  cargandoLinea: "One moment.",

  inicioTitulo: "Try your key with no password",
  inicioLineaCel: "Your phone keeps it and opens it with your fingerprint, face or screen lock. You use it to seal a list and run a draw.",
  inicioLineaCompu: "Your computer keeps it and opens it with your fingerprint, face or PIN. You use it to seal a list and run a draw.",
  inicioPrincipal: "Create my key",
  inicioSecundario: "I already have my key",

  yaHayLlaveTitulo: "You already have a key here",
  yaHayLlaveLinea: "Use it to open your test account.",
  yaHayLlavePrincipal: "Use my key",
  yaHayLlaveSecundario: "Create another key",

  sinLlavesTitulo: "This browser can't keep keys",
  sinLlavesLinea: "Open this page in Chrome or Safari, or on another device.",
  sinLlavesPrincipal: "Copy the link",

  enAppTitulo: "Better in the browser",
  enAppLinea: "Some apps don't allow keys. If it fails, tap the three dots and choose <strong>Open in browser</strong>.",
  enAppPrincipal: "Try here",
  enAppSecundario: "Copy the link",

  sinBloqueoTitulo: "Screen lock needed",
  sinBloqueoLinea: "The key opens with your fingerprint, face or a PIN. Turn one on in your phone settings and come back.",
  sinBloqueoPrincipal: "Done",
  sinBloqueoSecundario: "Try anyway",

  miraTituloCel: "Check your phone",
  miraTituloCompu: "Check your screen",
  miraCrearLinea: "It asks for your fingerprint, face or screen lock to create the key.",
  miraSellarLinea: "Your key approves the list.",
  entrandoLinea: "Choose the one called <strong>Tinkazo test key</strong>.",

  armandoTitulo: "Setting up your account",
  armandoLinea: "It takes a few seconds.",

  cuentaListaTitulo: "Your account is ready",
  cuentaListaLinea: "Now seal a sample list with Ana, Nora and Beto. Your key approves it.",
  cuentaListaPrincipal: "Seal the list",

  sellandoTitulo: "Sealing the list",
  sellandoLinea: "It takes a few seconds.",

  esperandoTitulo: "The list is sealed",
  esperandoLinea: "Keep this screen open. The draw runs by itself in a couple of minutes.",
  esperandoSecundario: "See the receipt",

  listoTitulo: "{nombre} was drawn",
  listoLinea: "Anyone can check it. What each step cost is below.",
  listoPrincipal: "Check the draw",
  listoSecundario: "Run another draw",

  buscandoTitulo: "Finding your account",
  buscandoLinea: "It takes a few seconds.",

  noApareceTitulo: "We couldn't find your account",
  noApareceLinea: "We couldn't reach it right now. Try again in a moment.",
  noAparecePrincipal: "Try again",
  noApareceSecundario: "Create another key",

  sinCuentaTitulo: "We couldn't find an account for this key",
  sinCuentaLinea: "Pick the one called <strong>Tinkazo test key</strong>. If you created it more than a week ago, it has ended and you can create another.",
  sinCuentaPrincipal: "Try again",
  sinCuentaSecundario: "Create another key",

  vencidaTitulo: "This test account has ended",
  vencidaLinea: "Accounts in this test last one week. You can create a new one.",
  vencidaPrincipal: "Create another key",

  noSeComproboTitulo: "We couldn't check this account",
  noSeComproboLinea: "To be safe we didn't use it. You can create a new key.",
  noSeComproboPrincipal: "Create another key",

  canceladaLinea: "The key wasn't used. Try again whenever you want.",

  sinFondosTitulo: "The test couldn't start",
  sinFondosLinea: "The service that pays for the test didn't answer. Try again in a few minutes.",
  sinFondosPrincipal: "Try again",

  cuentaSinArmarTitulo: "Your key is there, the account isn't yet",
  cuentaSinArmarLinea: "Try again. It won't ask you to unlock.",
  cuentaSinArmarPrincipal: "Try again",

  lentoTitulo: "This is taking a while",
  lentoLinea: "It may have worked anyway. Tap to check.",
  lentoPrincipal: "Check again",

  noSeArmoTitulo: "The account couldn't be set up",
  noSeArmoLinea: "Nothing of yours was spent. Try again.",
  noSeArmoPrincipal: "Try again",

  noSeSelloTitulo: "The list couldn't be sealed",
  noSeSelloLinea: "Nothing was saved. Try again.",
  noSeSelloPrincipal: "Try again",

  sorteoTrabadoTitulo: "The draw hasn't run yet",
  sorteoTrabadoLinea: "You can try as many times as needed.",
  sorteoTrabadoPrincipal: "Run the draw now",
  sorteoTrabadoSecundario: "See the receipt",

  fallaTitulo: "Something went wrong",
  fallaLinea: "Try again from the start.",
  fallaPrincipal: "Start over",

  noEsAcaTitulo: "This test isn't here",
  noEsAcaLinea: "It only opens in the site's test versions.",
  noEsAcaPrincipal: "Go to Tinkazo",

  costosTitulo: "What each step cost",
  costosCrear: "Create the account",
  costosSellar: "Seal",
  costosSortear: "Draw",
  costosNota: "Test network figures. They are not the main network price.",
  costosTotal: "Total",
  costosInclusion: "Inclusion",
  costosRecursos: "Resources",
  costosAlquiler: "Rent",
  costosInstrucciones: "Instructions",
  costosBytes: "Bytes written",
  costosSinDatos: "No data for this step.",
  fallaCodigo: "Failure code",
  enlaceCopiado: "Link copied.",
  nombreDeLaLlave: "Tinkazo test key",
};

export const TEXTOS: Record<Lang, Record<ClaveDePrueba, string>> = { es: ES, en: EN };

/** El texto de una clave en una lengua. */
export function texto(lang: Lang, clave: ClaveDePrueba): string {
  return TEXTOS[lang][clave];
}
