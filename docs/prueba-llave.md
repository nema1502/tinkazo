# Prueba de la llave

Una prueba, solo en la red de prueba, de que una persona puede crear una llave con el desbloqueo de su aparato, sellar una lista con ella y sortear, sin contraseña, sin billetera y sin que Tinkazo guarde nada suyo. Issue 301.

## Qué es y qué mide

La persona crea una llave (una passkey) con su huella, su cara o la clave de su aparato. De esa llave nace una cuenta de contrato en la red de prueba, con la llave como único firmante: Tinkazo no queda como firmante ni como administrador. Con esa cuenta se sella una lista de ejemplo en el contrato vigente de la red de prueba (`docs/deployments.md`) y, cuando nace la ronda, se sortea.

Paga todo una cuenta descartable que se crea en el navegador y fondea el grifo de la red de prueba. No hay servidor nuestro, ni retransmisor, ni llaves nuestras. La llave solo firma la entrada de autorización de `seal`.

La prueba mide, en cada paso (crear la cuenta, sellar, sortear), lo que cobró la red y lo que escribió, leído de lo que contesta la red y sin estimar nada: total, inclusión, recursos, alquiler, instrucciones y bytes escritos. Las cifras son de la red de prueba. No son el precio de la red principal: en la red de prueba las entradas nacen con la vida mínima (120.960 ledgers) y no con los 2.073.600 publicados para la principal. Lo que se traslada son los bytes y las entradas, no los XLM.

## Lo que hay que saber del kit

La prueba usa el kit de cuentas inteligentes de Stellar (`smart-account-kit`, versión exacta en `package.json`) sobre las cuentas de contrato de OpenZeppelin v0.8.0. El propio kit dice en su README y en su política de seguridad que no tiene una auditoría independiente de terceros y que sus fallas pueden causar transacciones no autorizadas o la pérdida del acceso. Por eso esto es solo una prueba en la red de prueba, con listas de ejemplo y nada de valor.

El desplegador compartido que trae el kit tiene una llave pública: cualquiera puede cambiarle los firmantes. La prueba lo mira antes de cada recorrido (`scripts/lib/previo-llave.mjs`) y no sigue si cambió.

## Dónde vive

- La página está en `prueba/llave/index.html`, en una carpeta y no en la raíz a propósito: ninguna comprobación de las páginas del sitio la recorre.
- El código está en `src/prueba-llave/`. Nada del sitio de hoy lo importa (`src/prueba-llave/aislamiento.test.ts`).
- Solo `puente-kit.ts` importa el kit. Entre el kit, que trae su propio SDK de Stellar, y el resto de la prueba, que usa el del sitio, solo pasan cadenas base64.

## Cómo se arma y cómo se abre

La página solo entra al armado con `VITE_PRUEBA_LLAVE=1` y además en una vista previa de Vercel (`VERCEL_ENV=preview`) o en la revisión automática de GitHub. En producción no entra nunca, y si alguien pone la variable en una publicación de producción, la construcción falla. Sin la variable, el armado falla si algún trozo trae algo de la prueba.

En ejecución, la página solo carga el kit en una lista cerrada de anfitriones: `localhost`, `127.0.0.1` y el alias de rama de una vista previa. En cualquier otro (el sitio, sus subdominios, la dirección de producción de Vercel, el alias de la rama principal y las direcciones únicas de cada despliegue) muestra que la prueba no está ahí y no baja el kit.

`pnpm dev` no sirve para esta página: el plugin es solo de armado. Se prueba con el armado y la vista previa:

```bash
VITE_PRUEBA_LLAVE=1 GITHUB_ACTIONS=true pnpm build
pnpm preview
# http://localhost:4173/prueba/llave/
```

Una vista previa de la rama de la prueba no se promueve a producción. Si por error se promoviera sin reconstruir, la lista de anfitriones la deja sin funcionar en producción.

La llave queda atada al anfitrión exacto donde se creó. En una vista previa y en `localhost` conviven las llaves de la prueba con las de recuperación del sitio, y el selector del aparato puede mostrar las dos: la pantalla dice cuál elegir. Conviene probar en el teléfono en un anfitrión que no use la recuperación.

## La revisión automática

- `ci.yml`, trabajo de calidad (el que exige la rama principal): después del armado del sitio, `scripts/check-sin-prueba-de-llave.mjs dist` comprueba que no trae nada de la prueba. Después se arma con la prueba (`dist-llave`) y `--presente` comprueba que trae la página, el kit y las marcas: es el control de que la revisión no está vacía.
- `scripts/lib/sin-prueba-de-llave.test.mjs` corre en `pnpm test` con rutas de la forma real del almacén de pnpm, con barras y con contrabarras.
- `prueba-llave.yml`, aparte y sin frenar nada: corre el recorrido automático de verdad contra la red de prueba, con Chrome sin pantalla y un autenticador virtual, y deja `medidas-llave.json` como artefacto durante 14 días. Depende del grifo, de la red de prueba, del servicio de azar público y de un índice ajeno, y por eso puede fallar sin que el sitio tenga nada roto.

El recorrido sale con 0 si dio bien, con 1 si la prueba falló y con 2 si no se pudo medir (la red de prueba cambió o el grifo, la red o el servicio de azar no contestaron). El paso de otro aparato, que borra lo guardado en la página y entra con la llave que quedó en el autenticador, nunca cambia el código de salida: depende de un índice que puede ir atrasado.

## Desacuerdo abierto: el borrado de la red de prueba

El sitio dice en varias cadenas y pruebas que la red de prueba se borra el 16 de diciembre de 2026. La documentación oficial de Stellar sobre las redes (sección del reinicio de datos de la red de prueba) dice, leída el 25 de noviembre de 2026, que no hay más reinicios previstos para 2026. La página de esta prueba no nombra fechas de borrado, y esta prueba no toca el texto del sitio: queda para decidir cuál vale.

## Fecha de la última corrida buena

Todavía no hubo una corrida buena del recorrido contra la red de prueba. Se anota acá, a mano, con la fecha, cuando la haya.

## Lo que no entra

La red principal y sus direcciones, el proveedor de cuentas, el portero y el servicio de patrocinio, premios y dólares digitales, fondear la cuenta de contrato, llaves secundarias, firmantes nuevos, políticas, recuperar en otro aparato sin el índice, extender la vida del código compartido y cambiar el sitio de hoy o su verificación.
