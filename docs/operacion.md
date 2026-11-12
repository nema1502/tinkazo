# Operación del portero de mainnet en un evento

El portero de mainnet (`https://pm.tinkazo.app`) paga las comisiones de sellar y sortear solo a las cuentas de su libro: las que canjearon un cupón del evento y las que se admitieron a mano. Esta hoja es para quien opera el día del evento: qué preparar, qué mirar cada hora, con qué número se frena y cómo cortar.

Hay dos claves, distintas entre sí, y ninguna va en el repositorio, en un chat, en un comando ni en una captura:

- **La clave de operar** (`ADMIN_TOKEN`): mirar el estado, pausar y reanudar las altas, apagar y encender, cambiar el tope, exportar. En los ejemplos es `$T`.
- **La clave de cupones** (`CUPONES_TOKEN`): crear y anular cupones y admitir cuentas. `scripts/cupones.mjs` la toma de `TINKAZO_CUPONES_TOKEN`.

```bash
export P=https://pm.tinkazo.app
curl -fsS -H "Authorization: Bearer $T" $P/v1/patrocinio/estado
```

## Antes del evento

1. **El portero comprobado, un día antes como mínimo.** `estado` dice `modo: "portero"` y `alerta: false`; `POST /v1/alta/estado` sin sesión da `401` con `motivo: "sesion"`; `/v1/patrocinio/cupo?cuenta=G...` dice `prendido: true`.
2. **Los créditos de Pollar.** El piso reserva el peor caso y cada tarjeta canjeada se come 165 de margen. Cuánto cargar: **300 + 165 × tarjetas + 15 × curiosos + 20 × reintentos + 40 × sorteos admitidos a mano**. Con 40 tarjetas, cien curiosos y unos 15 reintentos: **8.700**, más 40 por cada sorteo admitido a mano (con 5, 8.900). Con 30 tarjetas: unos 7.100 más lo admitido a mano. Con 7.000 entran unas 29 tarjetas. La carga la hace quien mantiene el proyecto, en el panel de Pollar, a más tardar el mediodía del día anterior.
3. **La alerta de créditos bajos de Pollar** en piso + 165 × tarjetas por repartir, no en un número fijo.
4. **La cuenta que paga con 25 XLM o más.** Por debajo de 20 el portero da `alerta: true`. Se carga desde la cuenta fría, en tramos chicos: la cuenta que paga guarda solo lo del día.
5. **El tope general a 45 XLM** por 24 horas:
   `curl -fsS -X PUT -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"clave":"tope_general_stroops","valor":450000000}' $P/v1/patrocinio/ajustes`
6. **La cuenta de quien organiza, admitida con 3 a 5 sorteos.** Cada sorteo admitido suma 40 al piso; el resto se suma después del evento.
   `node scripts/cupones.mjs admitir --cuenta G... --sorteos 5 --dias 60 --ref organiza-pruebas`
7. **Dos lotes de cupones**, el del evento y uno de reserva, con los códigos y las tarjetas fuera del repositorio:
   `node scripts/cupones.mjs crear --lote <evento> --cantidad 30 --sorteos 3 --dias 60 --vence AAAA-MM-DD --salida <carpeta privada>`
   y lo mismo con `--lote <evento>-reserva --cantidad 10`. Imprimir al 100 %, a doble faz; las tarjetas van en sobre o boca abajo (una foto del QR lo canjea) y la reserva aparte.
8. **La regla de límite de Cloudflare**, una sola porque el plan gratis de la zona deja una: 60 pedidos en 10 segundos por dirección, con bloqueo de 10 segundos, para `POST /v1/patrocinio` en `p.tinkazo.app` y en `pm.tinkazo.app`, y para `POST /v1/alta/estado` y `POST /v1/alta/cupon` en `pm.tinkazo.app`. Todo el stand sale por la misma wifi: el bloqueo tiene que ser corto. `GET /v1/patrocinio/cupo` no pasa por esta regla: lo limita el propio portero, a 3.000 consultas por dirección y por hora (en la memoria de cada nodo).
9. **La vigilancia: el vigilante cada diez minutos y, de respaldo, la de GitHub por hora.** La alarma es el Worker `tinkazo-vigilante` (la sección El vigilante, más abajo), que avisa por correo y manda un resumen cada mañana. El de GitHub queda de respaldo porque dispara solo cerca del 10 % de las corridas programadas. El workflow `vigilar-portero.yml` mira `estado` cada hora y manda un correo cuando aparece un problema nuevo o uno que empeora (y una vez por día mientras siga el mismo). Su registro es público y no lleva cifras: dice qué problemas hay, y las cifras se miran en `estado`. Una corrida a mano o repetida falla siempre que haya un problema, aunque ya se haya avisado: sirve para comprobar que se arregló. Es el respaldo de la mirada a mano de abajo, no la alarma. Necesita el Environment `vigilancia` de GitHub, con las ramas elegidas y solo `main`, y la clave de operar cargada ahí como `PORTERO_MAINNET_ADMIN_TOKEN`, sin copia entre los secretos del repositorio. Los pasos están en [workers/patrocinio/README.md](../workers/patrocinio/README.md), en «La vigilancia del portero de mainnet».
10. **A la mañana, antes de abrir el stand**: `estado` y la cuenta de abajo con todas las tarjetas por repartir.

## Durante el evento, cada hora

Mirar `estado` y anotar la hora, `creditos`, `piso`, `margen`, `altasPausadas`, `alerta`, el saldo de la cuenta que paga (`balanceStroops`), `gasto24h` contra `topeGeneralStroops`, `altas24h` y `cuponesHoy`.

**La cuenta: `margen` tiene que ser al menos 165 × tarjetas sin canjear + 15 × curiosos esperados + 20 × reintentos esperados.**

| Qué se ve | Qué quiere decir | Qué se hace |
|---|---|---|
| `margen` por debajo de la cuenta | No alcanza para todas las tarjetas que faltan | Cargar créditos, o dejar de repartir tarjetas |
| `altasPausadas: true` o `margen` cerca de 0 | Los canjes nuevos se pausan (el cupón no se gasta, pero esa persona no sortea hoy) | Cargar créditos; si fue a mano, `reanudar` |
| `alerta: true` | La cuenta que paga tiene menos de 20 XLM, o no se pudo leer | Cargar XLM desde la cuenta fría, un tramo de 20 a 40 |
| `gasto24h` pasa el 80 % de `topeGeneralStroops` | El portero va a dejar de pagar al llegar al tope | Subir el tope (hasta 100 XLM) o frenar |
| `creditos: null` | Pollar no contesta. Diez minutos se usa el último saldo; después, los canjes nuevos se pausan solos | Esperar y avisar. Quien ya canjeó sigue sellando |
| `cuponesHoy` sube sin tarjetas repartidas | Alguien está usando códigos que no se dieron (una foto de la pila) | `pausar` y anular el lote |
| `error-config` o `error-interno` en el registro del Worker | Algo de configuración o del objeto | `pausar` y revisar, sin desplegar |

```bash
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/admin/altas/pausar      # {"pausadas":true}
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/admin/altas/reanudar    # {"pausadas":false}
node scripts/cupones.mjs estado --lote <evento>
```

**Si a alguien le sale que su acceso está en otra cuenta** («No pudimos unir esta cuenta con tu acceso al modo Oficial»). Solo pasa si Pollar le cambia la billetera a una persona después de que canjeó: su acceso quedó atado a la cuenta de antes. En el registro del Worker se ve como `{"evento":"error-alta","motivo":"cuenta-de-otro"}`, sin la cuenta ni la persona. Para mirarlo en vivo, desde `workers/patrocinio`: `npx wrangler@4.160.0 tail --config wrangler.toml --env mainnet` (sin `--env mainnet` se mira el servicio de la red de pruebas), o en el panel de Cloudflare, los registros de `tinkazo-patrocinio-mainnet`. Si no aparece, lo notó el propio sitio y se sigue igual. Qué hacer, en este orden:

1. **Que la persona pruebe sellar** con la cuenta con la que entró.
2. **Si se abre «Dejá tu cuenta lista» pidiendo activar o proteger la cuenta, no se admite a mano.** No lo destraba: el paso sigue viendo el acceso atado a la cuenta de antes y no se puede completar, y la cuenta admitida aparta créditos sin servir (cada sorteo admitido suma 40 al piso). Esa persona sigue en el modo Prueba, que es gratis.
3. **Solo si el sello sale porque a esa cuenta no le quedan sorteos o todavía no tiene acceso** («Se te acabaron…» o «Tu cuenta todavía no tiene acceso al modo Oficial…»), se admite a mano la cuenta que muestra su sitio (el panel de la cuenta la deja copiar), con los sorteos del cupón, los días del lote del evento y una referencia del stand que no se repita: `node scripts/cupones.mjs admitir --cuenta G... --sorteos 3 --dias 60 --ref <evento>-stand-1`. Después se prueba sellar de nuevo: el sello mira el cupo de esa cuenta, no el aviso del paso «Dejá tu cuenta lista», así que alcanza aunque el aviso siga a la vista (se vuelve a la página y se toca «Sellar la lista»).

Durante el evento no se toca Pollar ni ninguna bandera del sitio o del portero, salvo el plan B del ingreso (más abajo).

## Después del evento

1. **Anular la reserva que no se usó**: `node scripts/cupones.mjs anular --lote <evento>-reserva`. Lo ya canjeado sigue valiendo.
2. **El estado de cada lote**, para el informe: `node scripts/cupones.mjs estado --lote <evento> --json`.
3. **Exportar todo**, fuera del repositorio:
   `curl -fsS -H "Authorization: Bearer $T" $P/v1/patrocinio/exportar -o exporte-AAAA-MM-DD.json`
4. **Bajar el tope general** a 15 XLM y sumar a mano los sorteos que falten a la cuenta de quien organiza.
5. Anotar créditos y XLM gastados contra lo cargado.

## Cómo cortar, de menos a más

1. **Pausar las altas**: nadie canjea un cupón nuevo; quien ya canjeó sigue sellando y sorteando.
   `curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/admin/altas/pausar`
2. **Apagar el portero**: no paga nada; el sitio deja de ofrecer el patrocinio. Se vuelve con `/v1/patrocinio/encender`.
   `curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/patrocinio/apagar`
3. **El corte**: `ALTAS = "0"` en `[env.mainnet.vars]` de `workers/patrocinio/wrangler.toml` (y nada más cambiado) y desplegar desde `workers/patrocinio` con `npx wrangler@4.160.0 deploy --config wrangler.toml --env mainnet`. El portero de mainnet no le paga a nadie. No hace falta un commit nuevo ni esperar la CI. Pide desplegar y reinicia el objeto: durante el evento, solo si 1 y 2 no alcanzan. Para volver: el `wrangler.toml` como estaba y desplegar de nuevo, igual.
4. **Si el Worker no contesta**: en el panel de Cloudflare, Workers, `tinkazo-patrocinio-mainnet`, quitar el dominio `pm.tinkazo.app`.

Lo sellado no se pierde: el resultado depende solo de la ronda y de la lista, así que se sortea cuando el portero vuelve.

## Los planes B, de mejor a peor

- **B1, el portero listo y la pantalla del cupón no.** El portero con el libro y la administración, y un build del sitio con `VITE_ALTA_LIBRE=1` y `VITE_ALTA` apagada (el build no sale con las dos; la publicación de producción lo deja pasar, y las páginas de lectura siguen diciendo que con un cupón el modo Oficial es gratis). Los equipos que pasan por la mesa le dictan su dirección a quien opera, que los admite con `cupones.mjs admitir`. Cualquiera que entre a Oficial y toque «Activar» cuesta 20 créditos; sellar sigue cerrado para quien no está en el libro.
- **B2, sin portero de mainnet.** Oficial solo con billetera propia; los equipos sortean gratis en Prueba. Las tarjetas se guardan para el próximo evento: se anula el lote y se crea otro con la fecha nueva.
- **B3, último recurso y solo con la palabra de quien mantiene el proyecto.** La regla de contrato de Pollar para `seal` y `draw` del contrato de mainnet, con solo los créditos del día cargados, porque no tiene tope por cuenta. Se borra al terminar.

## Si el proveedor de cuentas corta el ingreso: el plan B del ingreso

- **Qué es.** `VITE_INGRESO_PLAN_B` es una bandera del build, apagada por defecto. Con `1` y solo en el modo Prueba, cuando entrar con Google o con un correo falla por algo que no es de la persona (Pollar contesta con error, tarda de más o no deja crear la cuenta), el aviso suma el botón Sortear sin cuenta. Lleva al modo libre: la lista se cierra en el navegador, no queda sello en Stellar, el sorteo no aparece en Mis sorteos y el comprobante dice que falta un testigo. En Oficial nunca aparece, y siempre lo elige la persona.
- **Cuándo se prende.** Solo si durante un evento el ingreso falla para varias personas a la vez (por ejemplo, al llegar al tope de cuentas del plan de Pollar) y reintentar no lo arregla. En Vercel, la variable `VITE_INGRESO_PLAN_B=1` en Production y una publicación nueva: se lee al construir, así que el cambio llega con la publicación y no al instante.
- **Cómo se apaga.** Vaciar la variable (o poner `0`) y publicar de nuevo. Con la bandera apagada la elección ya hecha deja de valer y el botón de sellar vuelve a pedir la cuenta.

## Qué no hacer

- **No desplegar durante el evento.** Un despliegue reinicia el objeto: la memoria de sesiones y los contadores de intentos vuelven a cero y todos pasan a ser «nuevos».
- **No rotar `CUPON_SECRETO` con cupones vivos.** Cambiarlo anula todos los cupones que no se canjearon.
- **No dejar iguales la clave de operar y la de cupones.** Si son iguales, lo de cupones no se atiende (`503 claves-iguales`).
- **No pegar una clave en un comando, un chat o una captura.** Van en variables de entorno.
- **No desplegar sin `--env mainnet` ni sin `--config wrangler.toml`.** Sin `--env` se despliega el portero de Prueba en `p.tinkazo.app`; sin `--config`, wrangler puede tomar otro `wrangler.json` que encuentre hacia arriba. Y siempre con la versión probada de wrangler (4.160.0), no la última del día.
- **No cargar toda la plata en la cuenta que paga.** La llave del Worker solo puede gastar comisiones, pero hasta lo cargado.
- **No dejar las tarjetas boca arriba ni sacarles foto.**
- **No vaciar `VITE_ALTA` en Vercel antes de revertir los textos.** Las páginas de lectura dicen que con un cupón de evento el modo Oficial es gratis, y la publicación de producción (`VERCEL_ENV=production`) no sale sin `VITE_ALTA=1` (`src/stellar/alta-build.ts`): con la variable vacía el build falla y queda la publicación anterior. Para quitar el acceso por cupón, primero se revierte el commit que puso esos textos y después se vacía la variable.

## El vigilante

El vigilante (`workers/vigilante`, en `vigilante.tinkazo.app`) es un Worker propio y aparte del portero: un error ahí no lo tumba. Cada diez minutos le pide `estado` al portero de mainnet y, si hay algo, avisa por correo, con las cifras (los créditos, el piso, el margen, el saldo de la cuenta que paga) y qué hacer. Usa la misma revisión que el flujo de GitHub (`scripts/lib/revision-portero.mjs`), que queda de respaldo. Todo el detalle de cómo funciona está en [workers/vigilante/README.md](../workers/vigilante/README.md).

### Cómo se despliega

Hace falta la palabra de quien mantiene el proyecto. Desplegar el vigilante no toca ni reinicia el portero, así que se puede hacer el día de un evento. Los comandos salen desde `workers/vigilante`, con la versión probada de wrangler.

1. **Una dirección que reciba los avisos, verificada en la cuenta de Cloudflare.** En el panel: Email, Email Routing, Destination addresses. Se agrega la dirección y se toca el enlace del correo de verificación que llega. Cloudflare solo deja mandar a direcciones ya verificadas de la cuenta. El ruteo de correo de `tinkazo.app` ya está prendido (hoy hay direcciones que reenvían): solo comprobar que sigue prendido (Email Routing, Overview), porque de ese dominio sale el remitente. **No se toca ningún registro del dominio**, ni los de correo ni ningún otro: el vigilante no necesita ninguno nuevo.
2. **El espacio de KV, ya hecho.** Está creado y su id (que no es un secreto) ya está en `wrangler.toml`: no hay que crear nada ni pegar ningún marcador. Solo si se arma el vigilante de nuevo en otra cuenta se repite el comando, y se pega el id nuevo en `wrangler.toml`:
   `npx wrangler@4.160.0 kv namespace create MEMORIA`
3. **Desplegar**: `npx wrangler@4.160.0 deploy --config wrangler.toml`. Crea el dominio `vigilante.tinkazo.app` y el reloj de diez minutos. Hasta que estén los secretos (el paso siguiente) el vigilante corre sin hacer nada y deja `error-config` en su registro: es lo esperado. No se pierde ningún aviso, porque sin a quién avisar no se da nada por avisado.
4. **Los secretos, uno por uno.** Cada comando pide el valor en la terminal: no se escribe en el comando.

   | Secreto | De dónde sale |
   |---|---|
   | `PORTERO_ADMIN_TOKEN` | La clave de operar del portero de mainnet: el mismo valor que su `ADMIN_TOKEN` (el que el flujo de GitHub guarda como `PORTERO_MAINNET_ADMIN_TOKEN`). `npx wrangler@4.160.0 secret put PORTERO_ADMIN_TOKEN` |
   | `AVISAR_A` | La dirección verificada del paso 1. Si son varias, separadas por comas. `npx wrangler@4.160.0 secret put AVISAR_A` |
   | `TELEGRAM_BOT_TOKEN` | Opcional. El bot que se crea hablando con BotFather en Telegram. `npx wrangler@4.160.0 secret put TELEGRAM_BOT_TOKEN` |
   | `TELEGRAM_CHAT_ID` | Opcional. El número del chat al que escribe el bot (se le manda un mensaje al bot y se mira en `getUpdates`). `npx wrangler@4.160.0 secret put TELEGRAM_CHAT_ID` |

   Telegram queda apagado si falta cualquiera de los dos. La dirección de aviso no se escribe en el repositorio. Cada `secret put` publica una versión nueva del Worker en el momento.

### Cómo se prueba que anda

1. **Mirar la ruta pública**: `curl -fsS https://vigilante.tinkazo.app/` devuelve `{"servicio":"tinkazo-vigilante","ultimaVuelta":"...","salioBien":true}`. La hora tiene que tener menos de 15 minutos (la ruta guarda lo que lee por 60 segundos, así que una vuelta nueva puede tardar hasta un minuto en verse). `salioBien: false` quiere decir que la última vuelta no pudo mirar al portero, que falta una configuración o que quedó un aviso sin mandar: mirar el registro con `npx wrangler@4.160.0 tail --config wrangler.toml` (los eventos `error-config`, `error-envio` y `portero-sin-respuesta`, sin secretos). La ruta no muestra ninguna cifra ni problema.
2. **Forzar un aviso**. La ruta no recibe la clave de operar: recibe la clave de prueba, un derivado que no deja ver la clave (el HMAC-SHA-256 del texto fijo `tinkazo-vigilante/prueba/v1` con la clave de operar como llave, en hexadecimal). Se calcula en la terminal sin imprimirla y se manda:
   `TP=$(T="$T" node -e 'process.stdout.write(require("node:crypto").createHmac("sha256", process.env.T.trim()).update("tinkazo-vigilante/prueba/v1").digest("hex"))')`
   `curl -fsS -X POST -H "Authorization: Bearer $TP" https://vigilante.tinkazo.app/prueba`
   Con la clave de operar cruda contesta `403`. Llega un correo "Prueba del vigilante: el aviso llega", con las cifras de ahora, y la respuesta dice `{"correo":"enviado",...}`. Si dice `error`, trae el `codigo` de Cloudflare: `E_RECIPIENT_NOT_ALLOWED` (la dirección no está verificada en la cuenta), `E_SENDER_NOT_VERIFIED` o `E_SENDER_DOMAIN_NOT_AVAILABLE` (el dominio del remitente), `E_DAILY_LIMIT_EXCEEDED` (se pasó el tope diario), `CORREO_TIEMPO` (el correo tardó más de 15 segundos). No cambia lo que el vigilante tiene recordado. Entre una prueba y la siguiente tienen que pasar 60 segundos: si no, contesta `429` con cuánto esperar.
   Ese tope es por instancia del Worker y vuelve a cero con cada despliegue: es un resguardo contra un descuido, y lo que cuida la ruta es la clave.
3. **Los registros de invocación, en los dos Workers**: mirar en el panel (Workers, Observability) si los registros de invocación guardan en claro la cabecera `Authorization` o si dicen `REDACTED`. En `tinkazo-patrocinio-mainnet`, en un pedido de `GET /v1/patrocinio/estado`: lleva la clave de operar cada diez minutos (el vigilante), cada hora (el flujo de GitHub) y en cada herramienta de operar. En `tinkazo-vigilante`, en el `POST /prueba` del primer despliegue, que todavía llevó la clave de operar cruda (los registros duran 7 días). Si dice `REDACTED`, anotarlo acá y no hay nada más que hacer. Si sale en claro, después del evento y no antes: apagar esos registros con `invocation_logs = false` en `[observability.logs]` de los dos (en el portero, dentro de `[env.mainnet]`), y rotar la clave de operar en los cuatro lugares (el portero, el Environment `vigilancia` de GitHub, el secreto del vigilante y el archivo de secretos de quien opera). Cambiar el código no borra lo que ya quedó registrado. El vigilante sigue escribiendo su propio registro, sin secretos.
4. **El resumen de la primera vuelta**: apenas desplegado, la primera vuelta manda un resumen. Es una segunda prueba.
5. **Cada mañana a las 8 (hora de Bolivia, las 12:00 UTC) llega un resumen**: todo bien o no, con las cifras. Es la señal de vida. **Si un día no llega, el vigilante se cayó**: mirar la ruta pública y el registro.
6. **El día de un evento**, pedir el resumen más seguido: `RESUMEN_CADA_HORAS = "3"` en `[vars]` de `workers/vigilante/wrangler.toml` y desplegar solo el vigilante. Después del evento vuelve a `"24"`.
7. **Para frenar los avisos** sin borrar nada: `crons = []` en `[triggers]` y desplegar. Para volver, `crons = ["*/10 * * * *"]`.

### Qué hacer con cada aviso

El asunto es lo que se ve en la pantalla bloqueada del celular. Cada correo trae además el "Qué hacer" de su problema y las cifras de ahora. Un problema se avisa una vez, de nuevo si empeora, y como recordatorio ("Sigue: ...") si pasan 23 horas sin arreglarse. Cuando se arregla llega un correo corto que empieza con "Arreglado".

| Asunto | Qué quiere decir | Qué se hace |
|---|---|---|
| **El portero está apagado: nadie puede sellar** | Alguien lo apagó (`/v1/patrocinio/apagar` o `APAGADO = "1"`) y no paga ningún sello ni sorteo | Si fue a propósito, nada. Si no, encenderlo con `/v1/patrocinio/encender` (más arriba, "Cómo cortar") |
| **El portero no paga: lo pasaron a Pollar** | Alguien le devolvió las comisiones a Pollar (`/v1/patrocinio/pollar`): el portero no paga nada | Si no fue a propósito, `encender`. Si es el plan B3, que la regla del contrato esté prendida en Pollar: sin ella nadie sella |
| **No se puede leer si el portero paga** | `estado` no trae `modo`, o trae algo que no es `portero`, `apagado` ni `pollar` | Mirar `estado`: `modo` tiene que decir `portero` |
| **El portero no tiene la llave: nadie puede sellar** | `estado` dice `llave: null`: falta el secreto `CLAVE_PATROCINADOR` del portero o no se pudo leer, y no paga nada | Cargarlo de nuevo, con la palabra de quien mantiene el proyecto: desde `workers/patrocinio`, `npx wrangler@4.160.0 secret put CLAVE_PATROCINADOR --env mainnet --config wrangler.toml` |
| **Créditos de Pollar bajo el piso: cargá ya** | Los canjes de cupones nuevos ya se frenaron | Cargar créditos en el panel de Pollar, según la cuenta de "Antes del evento" |
| **Créditos de Pollar bajos: cargá hoy** | Sobran menos de 1.000 créditos encima del piso | Cargar créditos antes de que bajen del piso |
| **No se pueden leer los créditos de Pollar** | Pollar no contesta. Diez minutos se usa el último saldo y después los canjes nuevos se pausan solos | Esperar unos minutos, mirar `estado` y, si sigue, avisar a Pollar |
| **A la cuenta que paga casi no le queda saldo** | Queda menos de la mitad del nivel de alerta: sin saldo no se puede sellar ni sortear | Cargar XLM ya desde la cuenta fría, un tramo de 20 a 40 |
| **La cuenta que paga tiene poco saldo** | Está por debajo del nivel de alerta | Cargar XLM desde la cuenta fría, un tramo de 20 a 40 |
| **No se puede leer el saldo de la cuenta que paga** | No se pudo leer la cuenta | Mirar `estado`. Si el saldo está bien, esperar a la próxima vuelta |
| **Las altas están pausadas** | Alguien las pausó a mano y nadie puede canjear un cupón nuevo | Si fue a propósito, nada. Si no, `reanudar` (más arriba) |
| **Cobros de Pollar sin explicar** | Pollar cobró firmas de cuentas de Google que el portero no puede explicar: alguien firma por fuera del sitio | Pausar las altas y mirar `estado` (más arriba, "Cómo cortar") |
| **No se pueden comparar los cobros de Pollar** | Pollar no contestó la lista de cobros | Mirar `estado` y esperar |
| **Patrocinio de la app prendido en Pollar** | Algo del patrocinio de la app en Pollar está prendido y gasta créditos sin que el portero lo cuente | Apagarlo en el panel de Pollar |
| **No se puede leer el patrocinio de Pollar** | Pollar no contestó | Mirar `estado` y el panel de Pollar |
| **El portero no contesta** | Dos vueltas seguidas (unos 20 minutos) sin respuesta de `pm.tinkazo.app` | Panel de Cloudflare, Workers, `tinkazo-patrocinio-mainnet`, y su registro. Si Cloudflare tiene una falla, esperar. Lo sellado no se pierde |
| **El portero contesta algo que no se entiende** | La respuesta de `estado` no tiene la forma de siempre | Mirar `estado` y el registro del Worker del portero |
| **El vigilante mira el portero equivocado** | El que contesta no dice ser el de mainnet | Revisar `PORTERO_URL` en `workers/vigilante/wrangler.toml` |
| **Al vigilante le falta la clave del portero** | No tiene la clave de operar, o el portero ya no la acepta (rotada) | Cargarla de nuevo: `npx wrangler@4.160.0 secret put PORTERO_ADMIN_TOKEN` |

Si las cifras de un correo dicen al menos junto a los cobros sin explicar, la lista de cobros de Pollar vino llena y la cifra puede quedarse corta: ese día, mirar `estado` a mano cada hora. Si dicen que los créditos se leyeron hace unos minutos, Pollar no está contestando y el portero usa el último saldo que leyó (hasta diez minutos, después los canjes nuevos se pausan solos).

Si el vigilante no puede leer su KV, no manda nada ni escribe, para no repetir avisos ni perder los pendientes: deja `error-kv` en su registro y la hora de la ruta pública deja de avanzar. Mirar el panel de Cloudflare.

Si el correo no llega pero el vigilante anda, el aviso queda pendiente y se reintenta en cada vuelta durante 24 horas. El registro dice por qué (`error-envio`, con el código de Cloudflare).
