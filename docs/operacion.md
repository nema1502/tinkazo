# Operación del portero de mainnet en un evento

El portero de mainnet (`https://pm.tinkazo.app`) paga las comisiones de sellar y sortear solo a las cuentas de su libro: las que canjearon un cupón del evento y las que se admitieron a mano. Esta hoja es para quien opera el día del evento: qué preparar, qué mirar cada hora, con qué número se frena y cómo cortar.

Hay dos claves, distintas entre sí, y ninguna va en el repositorio, en un chat, en un comando ni en una captura:

- **La clave de operar** (`ADMIN_TOKEN`): mirar el estado, pausar y reanudar las altas, apagar y encender, cambiar el tope, exportar y anular una compra con QR que no se pagó. En los ejemplos es `$T`.
- **La clave de cupones** (`CUPONES_TOKEN`): crear y anular cupones y admitir cuentas. `scripts/cupones.mjs` la toma de `TINKAZO_CUPONES_TOKEN`.

```bash
export P=https://pm.tinkazo.app
curl -fsS -H "Authorization: Bearer $T" $P/v1/patrocinio/estado
```

## Antes del evento

1. **El portero comprobado, un día antes como mínimo.** `estado` dice `modo: "portero"` y `alerta: false`; `POST /v1/alta/estado` sin sesión da `401` con `motivo: "sesion"`; `/v1/patrocinio/cupo?cuenta=G...` dice `prendido: true`.
2. **Los créditos de Pollar.** El piso reserva el peor caso y cada tarjeta canjeada se come 165 de margen. Cuánto cargar: **300 + 165 × tarjetas + 15 × curiosos + 20 × reintentos + 40 × sorteos admitidos a mano**. Con 40 tarjetas, cien curiosos y unos 15 reintentos: **8.700**, más 40 por cada sorteo admitido a mano (con 5, 8.900). Con 30 tarjetas: unos 7.100 más lo admitido a mano. Con 7.000 entran unas 29 tarjetas. La carga la hace quien mantiene el proyecto, en el panel de Pollar, a más tardar el mediodía del día anterior. Cada ganador con cuenta nueva suma 30 al piso hasta que activa y le cuesta a Tinkazo unos 40 créditos al activarse y abrir la línea.
3. **La alerta de créditos bajos de Pollar** en piso + 165 × tarjetas por repartir, no en un número fijo.
4. **La cuenta que paga con 25 XLM o más.** Por debajo de 20 el portero da `alerta: true`. Se carga desde la cuenta fría, en tramos chicos: la cuenta que paga guarda solo lo del día.
5. **El tope general a 45 XLM** por 24 horas:
   `curl -fsS -X PUT -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"clave":"tope_general_stroops","valor":450000000}' $P/v1/patrocinio/ajustes`
6. **La cuenta de quien organiza, admitida con 3 a 5 sorteos.** Cada sorteo admitido suma 40 al piso; el resto se suma después del evento.
   `node scripts/cupones.mjs admitir --cuenta G... --sorteos 5 --dias 60 --ref organiza-pruebas`
7. **Dos lotes de cupones**, el del evento y uno de reserva, con los códigos y las tarjetas fuera del repositorio:
   `node scripts/cupones.mjs crear --lote <evento> --cantidad 30 --sorteos 3 --dias 60 --vence AAAA-MM-DD --salida <carpeta privada>`
   y lo mismo con `--lote <evento>-reserva --cantidad 10`. Imprimir al 100 %, a doble faz; las tarjetas van en sobre o boca abajo (una foto del QR lo canjea) y la reserva aparte.
8. **La regla de límite de Cloudflare**, una sola porque el plan gratis de la zona deja una: 60 pedidos en 10 segundos por dirección, con bloqueo de 10 segundos, para `POST /v1/patrocinio` en `p.tinkazo.app` y en `pm.tinkazo.app`, y para `POST /v1/alta/estado` y `POST /v1/alta/cupon` en `pm.tinkazo.app`. Todo el stand sale por la misma wifi: el bloqueo tiene que ser corto. `GET /v1/patrocinio/cupo` no pasa por esta regla: lo limita el propio portero, a 20.000 consultas por dirección y por hora (en la memoria de cada nodo), el mismo número que las altas. `POST /v1/patrocinio/pago` y `POST /v1/alta/premio` no pasan por esta regla: los limitan sus contadores propios por dirección y los topes del portero. **Antes de un evento con toda una sala por la misma wifi**, quien mantiene el proyecto sube la regla en el panel de Cloudflare a 1.000 pedidos en 10 segundos, o la apaga mientras dure, y anota el valor de antes: con el regalo cada persona pregunta `POST /v1/alta/estado` varias veces en el mismo minuto, y un bloqueo de la regla no lleva CORS, así que el sitio lo ve como un fallo de red y nadie de la sala puede activar ni sellar. Se comprueba con una ráfaga de 150 pedidos desde una sola conexión, que vuelven todos con `403` (el portero contesta `origen` sin contar ni escribir nada) y ninguno con `429`:
   `seq 150 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST $P/v1/alta/estado | sort | uniq -c`
9. **La vigilancia: el vigilante cada diez minutos y, de respaldo, la de GitHub por hora.** La alarma es el Worker `tinkazo-vigilante` (la sección El vigilante, más abajo), que avisa por correo y manda un resumen cada mañana. El de GitHub queda de respaldo porque dispara solo cerca del 10 % de las corridas programadas. El workflow `vigilar-portero.yml` mira `estado` cada hora y manda un correo cuando aparece un problema nuevo o uno que empeora (y una vez por día mientras siga el mismo). Su registro es público y no lleva cifras: dice qué problemas hay, y las cifras se miran en `estado`. Una corrida a mano o repetida falla siempre que haya un problema, aunque ya se haya avisado: sirve para comprobar que se arregló. Es el respaldo de la mirada a mano de abajo, no la alarma. Necesita el Environment `vigilancia` de GitHub, con las ramas elegidas y solo `main`, y la clave de operar cargada ahí como `PORTERO_MAINNET_ADMIN_TOKEN`, sin copia entre los secretos del repositorio. Los pasos están en [workers/patrocinio/README.md](../workers/patrocinio/README.md), en «La vigilancia del portero de mainnet».
10. **A la mañana, antes de abrir el stand**: `estado` y la cuenta de abajo con todas las tarjetas por repartir.

## Durante el evento, cada hora

Mirar `estado` y anotar la hora, `creditos`, `piso`, `margen`, `altasPausadas`, `alerta`, el saldo de la cuenta que paga (`balanceStroops`), `gasto24h` contra `topeGeneralStroops`, `altas24h` y `cuponesHoy`.

Con alguna forma de pago prendida, o con alguna pausa puesta, `estado` trae además el bloque `pagos` (la sección Los pagos de premios, los retiros y el alta de quien ganó, más abajo). Anotar `pagos.gasto24h` contra `pagos.topeStroops`, `pagos.premio.fallo24h` y `pagos.retiro.fallo24h` contra `pagos.rechazosPorDia`, `pagos.altaPremio.hoy` contra `pagos.altasPremioDia`, `firmasPagos` y `costosRetiro24h`.

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
| `pagos.gasto24h` pasa el 80 % de `pagos.topeStroops` | El portero va a dejar de pagar premios y retiros al llegar al tope de sus comisiones (el de los sellos es otro) | Subir el tope en caliente (hasta 10 XLM) o pausar la forma que más gasta |
| `pagos.premio.fallo24h` o `pagos.retiro.fallo24h` cerca de `pagos.rechazosPorDia` | Los pagos que la red rechazó al aplicarse se acercan al tope de esa forma: pasado, da `503 fondo` hasta que el día corra | Mirar el registro del Worker, pausar esa forma y ver por qué la red los rechaza (una línea sacada, un saldo gastado) |
| `faltaAltas` con `pagos-premio`, `retiros`, `costo-retiro`, `alta-premio`, `tablas-pagos` o `tablas-alta-premio` | Esa forma quedó apagada: variable mal escrita, sin su configuración o sin su tabla | Sin desplegar: lo demás, los sellos y los sorteos siguen. Avisar a quien mantiene el proyecto |

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
6. **Volver la regla de límite de Cloudflare a 60 pedidos en 10 segundos**, con el valor anotado antes, si se subió o se apagó para el evento. La misma ráfaga de Antes del evento tiene que mostrar algún `429`.

## Cómo cortar, de menos a más

1. **Pausar una forma de pago o el alta de quien ganó**: solo frena lo nuevo de esa forma, sin desplegar. Los sellos, los sorteos, los cupones y el reenvío de un pago ya reservado siguen. `forma` es `premio`, `retiro`, `alta-premio` o `todas`.
   `curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"forma":"retiro"}' $P/v1/admin/pagos/pausar`
2. **Pausar las altas**: nadie canjea un cupón nuevo; quien ya canjeó sigue sellando y sorteando. También frena el alta de quien ganó.
   `curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/admin/altas/pausar`
3. **Apagar el portero**: no paga nada; el sitio deja de ofrecer el patrocinio. Se vuelve con `/v1/patrocinio/encender`. Corta también los premios y los retiros: nunca vuelven a Pollar.
   `curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/patrocinio/apagar`
4. **El corte**: `ALTAS = "0"` en `[env.mainnet.vars]` de `workers/patrocinio/wrangler.toml` (y nada más cambiado) y desplegar desde `workers/patrocinio` con `npx wrangler@4.160.0 deploy --config wrangler.toml --env mainnet`. El portero de mainnet no le paga a nadie: ni sellos, ni sorteos, ni premios, ni retiros, ni da altas de quien ganó. No hace falta un commit nuevo ni esperar la CI. Pide desplegar y reinicia el objeto: durante el evento, solo si 1, 2 y 3 no alcanzan. Para volver: el `wrangler.toml` como estaba y desplegar de nuevo, igual.
5. **Si el Worker no contesta**: en el panel de Cloudflare, Workers, `tinkazo-patrocinio-mainnet`, quitar el dominio `pm.tinkazo.app`.

Lo sellado no se pierde: el resultado depende solo de la ronda y de la lista, así que se sortea cuando el portero vuelve.

## Los planes B, de mejor a peor

- **B1, el portero listo y la pantalla del cupón no.** El portero con el libro y la administración, y un build del sitio con `VITE_ALTA_LIBRE=1` y `VITE_ALTA` apagada (el build no sale con las dos; la publicación de producción lo deja pasar, y las páginas de lectura siguen diciendo que con un cupón el modo Oficial es gratis). Los equipos que pasan por la mesa le dictan su dirección a quien opera, que los admite con `cupones.mjs admitir`. Cualquiera que entre a Oficial y toque «Activar» cuesta 20 créditos; sellar sigue cerrado para quien no está en el libro.
- **B2, sin portero de mainnet.** Oficial solo con billetera propia; los equipos sortean gratis en Prueba. Las tarjetas se guardan para el próximo evento: se anula el lote y se crea otro con la fecha nueva.
- **B3, último recurso y solo con la palabra de quien mantiene el proyecto.** La regla de contrato de Pollar para `seal` y `draw` del contrato de mainnet, con solo los créditos del día cargados, porque no tiene tope por cuenta. Se borra al terminar.

## La venta de paquetes y la carga con QR: variables y rutas

Las dos nacen apagadas en `[env.mainnet.vars]` de `workers/patrocinio/wrangler.toml`. Se prenden cambiando variables y desplegando, con la palabra de quien mantiene el proyecto y nunca el día de un evento. La columna Hoy es lo que dice ese archivo.

| Variable | Hoy | Qué hace |
|---|---|---|
| `ALTAS_PAGO` | `"0"` | Con `"1"`, las órdenes nuevas. Pide `CUENTA_COBROS`. Con `"0"` las órdenes que ya existen se siguen leyendo y pagando. Mientras `ORDEN_USDC_PILOTO` no esté puesta y haya una lista del piloto puesta, la orden nueva pide la cuenta en la lista (`503 fuera-del-piloto`): la lista está puesta con cuentas en `COMPRAS_QR_PILOTO` y también, con la variable vacía, con una sola cuenta sumada con `cupones.mjs piloto`. Sin ninguna lista (la variable vacía y nadie sumado a mano), cualquier sesión puede pedir una orden: `"1"` no va sin la lista. Una orden nueva no nace por debajo del piso, de lo reservado por las compras cargadas y de `RESERVA_CARGA_CREDITOS` |
| `CUENTA_COBROS` | `"GDMIGGM2J7GL24JL3UB5DLSTMMWFP5XTE3SDTTDZSPUFH7VMKFINKAO6"` | La cuenta nueva que recibe los pagos. Si repite `CUENTA_PATROCINADORA` o `CUENTA_SORTEADORA`, el pago queda apagado, nadie lee sus pagos y el registro dice `error-config` con `faltaAltas: ["cuenta-cobros-repetida"]` |
| `PRECIOS` | `"alta:4:3:90,p10:10:10:365"` | El primer paquete, 3 sorteos por 4 USDC para 90 días, y 10 sorteos por 10 USDC para un año. Sin el de 50. Vacía, valen estos mismos |
| `SORTEO_SERVIDOR` | `"0"` | Sigue apagado: la persona firma su sorteo. Por eso `CREDITOS_POR_SORTEO` queda en `"40"` |
| `CARGAS` | `"0"` | Con `"1"`, la carga con QR, mientras las altas no estén pausadas y los créditos pasen el piso más la reserva |
| `RESERVA_CARGA_CREDITOS` | `"8400"` | Los créditos libres por encima del piso que tiene que haber para que la carga siga abierta, para que empiece una compra y para que nazca una orden nueva. La semana del evento va en 8400, lo que piden las tarjetas sin canjear: ninguna compra ni orden se come eso, y el canje de una tarjeta sí puede usarlo. El lunes vuelve a `"400"`. **Solo dígitos**, sin punto ni espacio: `"8400"`. Mal escrita (`"8.400"`, `"8 400"`, `"8,400"`) cierra la venta entera (ni orden nueva, ni carga, ni compra) y el estado dice `faltaAltas: ["reserva-carga-creditos"]`, también con la venta cerrada |
| `COMPRAS_QR` | `"0"` | Con `"1"`, la compra de un paquete pagando con QR. Pide además `ALTAS_PAGO` y `CARGAS` en `"1"`, `POLLAR_FONDEO` en `"inmediato"` y `RECARGO_QR` bien escrito. Con `"0"` no empieza ni carga ninguna compra nueva, y lo que ya está en camino se termina igual |
| `COMPRAS_QR_DIA` | `"0"` | Cuántas compras con QR se pueden empezar por día (UTC) entre todas las personas. Cuenta cada compra que se da, también un cambio de producto. Renovar la misma no cuenta. Además, cada persona empieza como mucho 3 por día. Con `"0"`, ninguna. **Solo dígitos**: mal escrita (`"6.0"`, `"seis"`) cierra la venta entera y el estado dice `faltaAltas: ["compras-qr-dia"]` |
| `COMPRAS_QR_PILOTO` | `""` | Las cuentas G del piloto, separadas por coma, además de las que se suman con `cupones.mjs piloto`. Vacía, nadie más que las sumadas a mano. Una mal escrita o mal copiada, o cualquier otra palabra, cierra la compra con QR entera (`503 compras-cerradas`, también para las sumadas a mano) y el estado dice `faltaAltas: ["compras-qr-piloto"]`. `"todos"` también la cierra, salvo que se pida además con `COMPRAS_QR_TODOS = "1"`: no va antes del evento. Mientras `ORDEN_USDC_PILOTO` no esté puesta, la lista vale también para la orden en dólares digitales: con cuentas en la variable, o con la variable vacía y una sola cuenta sumada a mano, una orden nueva pide la cuenta en la lista (la de la variable o una sumada a mano) y, si la variable está mal escrita, no nace para nadie (`503 fuera-del-piloto`). Con la variable vacía y nadie sumado a mano, la orden no mira la lista. Quien ya tiene una compra cargada saca su orden igual |
| `COMPRAS_QR_TODOS` | no está | Solo `"1"` deja que `"todos"` en `COMPRAS_QR_PILOTO` abra la compra con QR a cualquier cuenta. Es la confirmación explícita de abrir a todos |
| `ORDEN_USDC_PILOTO` | `""` | Las cuentas G del piloto de la orden en dólares digitales, separadas por coma. Vacía, la orden mira el piloto de la compra con QR. Una mal escrita o mal copiada, o cualquier otra palabra, cierra la orden nueva entera (`503 fuera-del-piloto`) y el estado dice `faltaAltas: ["orden-usdc-piloto"]`. `"todos"` también la cierra, salvo que se pida además con `ORDEN_USDC_TODOS = "1"`. Con una lista puesta, solo esas cuentas crean órdenes nuevas. Quien ya tiene una compra cargada saca su orden igual |
| `ORDEN_USDC_TODOS` | no está | Solo `"1"` deja que `"todos"` en `ORDEN_USDC_PILOTO` abra la orden a cualquier cuenta. Es la confirmación explícita de abrir la orden a todos |
| `CARGA_MINIMO_BS` | `"0"` | Lo mínimo en bolivianos de una carga, para que el sitio no cotice menos. `"0"` mientras no se sepa |
| `RECARGO_QR` | `"4:0.50"` | Lo que suma pagar con QR, en USDC: la primera vez de cada persona (su verificación y su primera carga) y las siguientes. Mal escrito, la compra con QR no se abre y el registro dice `faltaAltas: ["recargo-qr"]` |
| `PATROCINIO_PERMITIDO` | `"sponsor_transfer_cosigned,sponsor_trustlines"` | Las banderas del patrocinio de Pollar que la vigilancia acepta prendidas: las dos que pide la compra con QR, las líneas y los envíos de cuentas co-firmadas. Solo cambia lo que espera la vigilancia, no lo que paga el portero. Lo demás prendido sigue dando aviso. Vacía, se espera todo apagado. Vale solo con `CARGAS` o `COMPRAS_QR` en `"1"`: con la venta cerrada se espera todo apagado aunque la lista esté puesta, así que las banderas se prenden en Pollar después del despliegue que abre la venta y se apagan antes del que la cierra |

Antes de desplegar con `CUENTA_COBROS` cargada, mirar en la red principal que esa cuenta exista, tenga la línea del USDC de Circle (emisor `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`) autorizada y no sea ninguna de las cuentas del portero. Sin la línea, la app de quien paga rechaza el envío.

### Los dos despliegues: primero cerrado, después el piloto

| Variable | 1. Cerrado (el código nuevo) | 2. El piloto (dos cuentas) |
|---|---|---|
| `ALTAS_PAGO` | `"0"` | `"1"` |
| `CARGAS` | `"0"` | `"1"` |
| `COMPRAS_QR` | `"0"` | `"1"` |
| `COMPRAS_QR_DIA` | `"0"` | `"6"` (dos personas por 3 compras cada una) |
| `COMPRAS_QR_PILOTO` | `""` | las dos cuentas G, separadas por coma, copiadas de la app y sin espacios de más |
| `COMPRAS_QR_TODOS` | no va | no va |
| `ORDEN_USDC_TODOS` | no va | no va |
| `ORDEN_USDC_PILOTO` | no va | no va: sin ella, la orden mira el piloto de la compra con QR |
| `CUENTA_COBROS` | la cuenta de cobros | la misma |
| `RESERVA_CARGA_CREDITOS` | `"8400"` | `"8400"` |
| `RECARGO_QR` | `"4:0.50"` | `"4:0.50"` |
| `PATROCINIO_PERMITIDO` | la de la tabla (no vale con la venta cerrada) | la misma (vale) |

Todo lo demás queda como en la tabla de arriba. Después de cada despliegue, pasados 5 minutos, mirar `estado`: sin `faltaAltas`, y en el piloto con `reservasCompras` en 0 y `margenLibre` igual a `margen`. Si aparece `faltaAltas`, lo que nombra quedó cerrado: corregir la variable y desplegar otra vez. Con el piloto, el primer paquete por QR sale 8 dólares (4 del paquete y 4 de recargo) y el de diez, después, 10,50. La orden queda pagada desde el 95 % del precio del paquete más el recargo entero: 7,80 el primer paquete por QR y 10 el de diez con el recargo de 0,50. Una orden sin recargo, desde el 95 % de siempre.

**Las banderas del patrocinio de Pollar en el piloto.** Las dos de `PATROCINIO_PERMITIDO` (`sponsor_trustlines` y `sponsor_transfer_cosigned`) valen en Pollar para toda la app, no solo para las dos cuentas: el portero no puede limitarlas, y mientras estén prendidas cualquiera con la llave publicable puede gastar créditos por fuera del sitio. Por eso:

1. **Se prenden solo mientras una de las dos personas del piloto está comprando**, con el despliegue del piloto arriba: justo antes de que empiece su compra, en el panel de Pollar.
2. **Se apagan enseguida** que la compra terminó (el paquete se dio) o se cortó, aunque la otra persona vaya a comprar más tarde: para ella se prenden de nuevo.
3. **Nunca el día de un evento**, ni la víspera a la noche: ese día la venta no se abre.
4. Mientras están prendidas, mirar `estado` al empezar y al terminar: `firmasSinExplicar` tiene que seguir en 0 o cerca. Cada persona con una compra cargada explica hasta 9 firmas por día durante 7 días aunque no haga nada, así que el aviso de cobros sin explicar puede llegar tarde.
5. Con la venta cerrada la vigilancia espera todo apagado: si el aviso Patrocinio de la app prendido en Pollar llega con la venta cerrada, apagarlas ya.

**Créditos de más por cada compra cargada.** Una compra cargada reserva lo que se fijó al darla (530 el primer paquete) hasta que se paga o pasan 7 días, aunque la carga ya haya gastado parte. Con los créditos cargados justo para las tarjetas (la cuenta de Antes del evento), cada compra cargada sin pagar deja sin margen a unas 2 tarjetas. Durante el piloto, cargar en Pollar 400 créditos de más por cada compra cargada sin pagar (`recargosPendientes` en `estado`), o anularla con `compra anular` si nunca tuvo QR.

- **Pausar la venta sin desplegar**: `POST /v1/admin/ventas/pausar` con la clave de operar (y `reanudar` para volver). No empieza ninguna compra ni nace ninguna orden nueva, y lo que ya está en camino se termina. Cerrarla del todo es desplegar otra vez con las variables del despliegue 1.
- **Soltar las reservas**: `node scripts/cupones.mjs compra soltar --ref pausa-0001` (la ruta `POST /v1/admin/compras/soltar` `{ref}`, con la clave de operar) cierra de una vez todas las compras sin cargar (motivo `soltada`) y dice cuántas y cuántos créditos volvieron. Las cargadas no se tocan: tienen su dinero en camino. Una cargada se suelta de a una con `compra anular`, que suelta también su recargo. Una compra sin cargar suelta su reserva sola a la hora.
- **Volver a la versión anterior** desde el despliegue 1 se puede sin más pasos (el párrafo de abajo). Desde el piloto, la versión anterior no entiende lo que el piloto dejó escrito: toma como abiertas las órdenes cerradas, no conoce el recargo, sus rutas de la compra no existen y su exportación no trae las tablas de la compra. Los pasos, en este orden y sin saltear ninguno:
  1. **Exportar con la versión nueva**, fuera del repositorio: `curl -fsS -H "Authorization: Bearer $T" $P/v1/patrocinio/exportar -o antes-de-volver-AAAA-MM-DD.json`. Es la única que trae `compras_qr`, `compras_qr_ordenes`, `compras_piloto`, `compras_anulaciones` y `compras_avisos`.
  2. **Pausar la venta**: `POST /v1/admin/ventas/pausar` con la clave de operar. No empieza ninguna compra ni nace ninguna orden nueva.
  3. **Apagar las dos banderas del patrocinio en Pollar**, si estaban prendidas.
  4. **Soltar las compras sin cargar**: `node scripts/cupones.mjs compra soltar --ref volver-0001`.
  5. **Cada compra cargada, cobrada o anulada.** Si la persona ya pagó, esperar a que su orden quede pagada (`/v1/alta/pago` o `cupones.mjs pagada` si pagó por fuera). Si no, `node scripts/cupones.mjs compra anular --compra <número> --ref volver-0002`. Al final, `estado` tiene que decir `recargosPendientes: 0`.
  6. **Ninguna orden cerrada ni pago suelto sin resolver.** Exportar otra vez y mirar que ninguna orden tenga `metodo` en `devuelta` o `reemplazada` con `pagada` vacía (la versión anterior las completaría con un pago, una reemplazada sin el recargo), y que `cupones.mjs sueltos` no muestre ningún `repetido` ni `cerrada` sin devolver (la versión anterior no los asigna, solo se devuelven a mano). Si queda alguna orden así, **no se vuelve atrás**: se arregla con la versión nueva, que es la que la entiende.
  7. **Recién entonces, desplegar la versión anterior** con su `wrangler.toml`, y mirar `estado` a los 5 minutos. Las reservas de las compras dejan de contar para el piso. Si con la versión anterior llega un segundo pago a una orden ya pagada, da otro paquete: anotarlo y revisarlo en el próximo `sueltos`.

**Primero el código, con la venta cerrada.** El código de la venta se despliega con las variables del despliegue 1: no se vende, no se carga y ninguna compra con QR empieza, así que sellar, sortear y canjear cupones siguen como antes. Las rutas de la compra y del cupo de la carga contestan cerradas sin entrar al objeto. En ese mismo despliegue va `CUENTA_COBROS` con la cuenta nueva, comprobada como dice el párrafo de arriba. Al arrancar, el portero suma cinco tablas (`compras_qr`, que ya nace con su columna `avisada`, `compras_qr_ordenes`, `compras_piloto`, `compras_anulaciones` y `compras_avisos`) y una columna que acepta vacío en una tabla que ya existe (`ordenes.reemplazada`), que la versión anterior no lee. Lo prueba `arranque-datos-viejos.test.ts` con una exportación de ejemplo del esquema anterior. Si sumar esa columna fallara (la base llena, un error raro), el objeto no se cae: sellar, sortear y canjear siguen como antes, la venta queda cerrada aunque las variables la abran, el registro dice `error-config` con `faltaAltas: ["columnas-nuevas"]` y la columna, y el estado dice `faltaAltas: ["columnas-nuevas"]`. Lo prueba `columnas-fallidas.test.ts`. En ese caso no se abre la venta: se exporta, se mira el error del registro y se decide con quien mantiene el proyecto. **Volver a la versión anterior se puede mientras no haya órdenes cerradas.** Esa versión no conoce las órdenes que este código cierra sin pagar (`metodo` en `devuelta` o `reemplazada`) y las toma como abiertas: un pago que llegue con su nota la completaría. Con la venta cerrada no nace ninguna orden, así que alcanza con no usar `cerrar` ni `compra anular` hasta abrirla. Más adelante, antes de volver atrás, mirar en la exportación que ninguna orden tenga `metodo` en `devuelta` o `reemplazada`. La primera vez que el portero lea la cuenta de cobros, un pago que no sea USDC que ya tenga (por ejemplo, unos centavos de XLM de un desconocido) queda en los sueltos como `otro-activo`: no da nada, no toca ninguna orden y la vigilancia no mira los sueltos. Abrir la venta es el despliegue 2, con la lista de dos cuentas y nunca con `"todos"` antes del evento.

Las rutas nuevas:

- `GET /v1/carga/cupo` contesta `{"abierta": true}` o `{"abierta": false}`. Es abierta a cualquier origen y sin sesión, como el cupo, y ante cualquier duda contesta cerrada. Tampoco pasa por la regla de límite de Cloudflare: la limita el propio portero con su propio contador, al mismo número de consultas por dirección y por hora que el cupo.
- `POST /v1/admin/ordenes/cerrar` `{orden, ref}`, con la clave de cupones (`node scripts/cupones.mjs cerrar --orden ABCD2345 --ref devolucion-0002`), cierra una orden pagada a medias y dice cuánto devolver y a quién. **Primero se cierra y después se devuelve**: así un pago que llega en el medio no completa la orden con plata ya devuelta. Lee antes los pagos nuevos. Si la orden ya se completó contesta `409 orden-pagada` y no hay nada que devolver. Con Horizon caído contesta `502 red` y no cierra.
- Los pagos sueltos suman dos motivos: `repetido`, un pago a una orden ya pagada (no da otro paquete), y `cerrada`, un pago a una orden cerrada. Se devuelven a mano y se marcan con `devuelto`, o se asignan a otra orden abierta de la persona con `asignar`. A una orden pagada o cerrada no se asigna nada (`409 orden-pagada` u `orden-cerrada`).
- `POST /v1/alta/pago` de una orden cerrada contesta `410 orden-cerrada` después de leer los pagos nuevos, y `ordenes/pagada` no la marca (`409 orden-cerrada`).

### La compra con QR

- **El permiso de empezar**, `POST /v1/compra/empezar` `{producto}` con la sesión de la persona. Lo da con la compra con QR abierta, la persona en la lista del piloto, lugar en las compras del día (`COMPRAS_QR_DIA` entre todos y 3 por persona, contando cada cambio de producto) y créditos por encima del piso, de lo reservado por las compras en curso, de `RESERVA_CARGA_CREDITOS` y de lo que reserva esta compra (380 la primera vez de la persona o 150 las siguientes, más lo que promete el paquete). Una compra sin cargar reserva una hora: pasada la hora, avisar la carga contesta `409 permiso-vencido` y empezar la renueva. Cargada, reserva hasta 7 días desde el permiso o desde el aviso de carga, lo que sea más nuevo, o hasta pagarse o anularse. Lo reservado por las compras cargadas va encima del piso para todo lo nuevo: con los créditos justos, los canjes y las órdenes nuevas se pausan antes de comerse lo que necesita alguien con su dinero en camino. Lo de una compra sin cargar solo frena otras compras, nunca un canje.
- **El aviso de carga**, `POST /v1/compra/cargar` `{producto}`. El sitio lo manda antes de crear la orden de carga y no la crea sin un `200`. Desde ahí el recargo queda atado a la persona: toda orden suya lo lleva hasta que se pague, y sus órdenes sin pagar de antes se cierran (lo que llegue con su nota va a los sueltos como `cerrada`, para devolverlo o asignarlo a la orden con el recargo). Si una de esas órdenes sigue sin vencer, el aviso pregunta antes con `409 orden-abierta` (la persona pudo haberla pagado desde otra app) y la cierra solo si el sitio vuelve a avisar con `reemplazar: true`. Un pago que ya estaba en camino no se pierde: si entró a la red hasta 2 minutos después del cierre y llega al 95 %, la orden queda pagada igual y la bitácora dice `orden-honrada`. Lo mismo vale para las órdenes que cierra una anulación. Un aviso por vez: a menos de 3 minutos del último que dio el sí, otro aviso de la misma compra contesta `409 cargando`, así dos equipos de la misma persona no crean dos QR. Y como mucho 3 avisos que dan el sí por compra en 7 días: cada sí deja crear otra orden de carga y la reserva cuenta una sola. El cuarto contesta `409 tope-de-avisos`. La persona puede pagar su orden con el recargo por otro medio. Si nunca tuvo QR, la compra se anula con `compra anular`.
- **La persona anula su compra**, `POST /v1/compra/anular` `{producto}` con su sesión. El sitio lo pide cuando la orden de carga falló después del aviso y no hubo QR. Vale solo hasta 30 minutos después del último aviso que dio el sí, si ninguna orden suya recibió algo y como mucho dos veces por persona en 7 días (después, `409 tope-de-anulaciones`). Suelta la reserva y NO el recargo: la compra sigue y su recargo va en toda orden de la persona, así una carga terminada y después anulada no sale gratis. Para reintentar, empezar renueva esa misma compra. El recargo lo suelta solo quien opera, con `compra anular`. Pasados los 30 minutos contesta `409 plazo-vencido`. Después de anular, el sitio sigue viendo la compra abierta con su recargo (`compraQr.abierta` con `cargada: true` y `compraQr.recargoPendiente`): quien no llegó a cargar nada y después paga con dólares digitales de otra app paga también el recargo. Durante el piloto, mirar `recargosPendientes` en `estado` cada día y anular con `compra anular` la compra de quien nunca tuvo QR.
- **El permiso de terminar** vale mientras la compra cargada reserva: la orden de su producto sale aunque la venta esté pausada y sin mirar el piso. Pasado eso, la orden pasa por la pausa y el piso como cualquier otra. `ALTAS_PAGO = "0"` la frena igual: es el interruptor de emergencia, y entonces el dinero queda en la cuenta de la persona.
- **La lista del piloto**, con la clave de cupones: `node scripts/cupones.mjs piloto sumar --cuenta G...`, `piloto sacar --cuenta G...` y `piloto listar`. Sacar a alguien frena lo nuevo y no lo que ya tiene en camino. Por administración entran hasta 50 cuentas. Con `COMPRAS_QR_PILOTO` vacía, una sola cuenta sumada a mano ya pone la lista: desde ahí la orden en dólares digitales también pide estar en ella (`503 fuera-del-piloto`), y vuelve a no mirarla recién cuando se saca la última. Con `COMPRAS_QR_PILOTO = "todos"` y `COMPRAS_QR_TODOS = "1"` la lista no frena a nadie: `piloto listar` lo dice primero, y a una persona se la frena cambiando la variable.
- **Anular una compra que no se pagó**, `POST /v1/admin/compras/cerrar` `{compra, ref}` o `{usuario, ref}`, con la clave de operar: `node scripts/cupones.mjs compra anular --compra 12 --ref soporte-0001` (o `--usuario` con el id de la persona en Pollar). El número de la compra y el id salen de la exportación, tabla `compras_qr`. La herramienta toma la clave de `TINKAZO_OPERAR_TOKEN` o, si no está, de `ADMIN_TOKEN`. La compra queda cerrada con el motivo `anulada`: su recargo deja de ir en las órdenes de la persona, su reserva se suelta y sus órdenes sin pagar se cierran (lo que llegue con su nota va a los sueltos). Es la salida cuando la orden de carga falló después del aviso y nunca hubo QR, y la forma de soltar la reserva de una compra que quedó a medias. Si la compra tiene órdenes sin pagar, lee antes los pagos nuevos (con Horizon caído, `502 red` y no anula). Si una orden suya recibió algo, `409 orden-con-pago`: primero se resuelve ese pago con `sueltos`, `asignar` o `cerrar`. Ya pagada, `409 compra-pagada`. Otra vez es lo mismo (`repetido`).
- **Qué mirar en `estado`**: `reservasCompras` (lo reservado por las compras en curso) y `margenLibre` (el margen menos esas reservas: lo que de verdad queda para los canjes, y el número que va en la cuenta de Antes del evento mientras la venta esté abierta). Si aparece `faltaAltas`, una variable está mal escrita y lo suyo quedó cerrado. Si los créditos no cubren el piso más esas reservas, el vigilante avisa con su propio problema (Créditos de Pollar bajo las compras en curso), y el flujo de GitHub de respaldo también.

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
- **No prender los pagos de premios, los retiros ni el alta de quien ganó el día de un evento.** Prenderlos pide desplegar, y un despliegue reinicia el objeto.
- **No volver a una versión anterior del portero con pagos en el aire.** La versión de antes no ve las tablas nuevas, y un costo de retiro que no se leyó todavía se podría atar a una orden abierta. El orden para volver está en la sección de los pagos.
- **No vaciar `VITE_ALTA` en Vercel antes de revertir los textos.** Las páginas de lectura dicen que con un cupón de evento el modo Oficial es gratis, y la publicación de producción (`VERCEL_ENV=production`) no sale sin `VITE_ALTA=1` (`src/stellar/alta-build.ts`): con la variable vacía el build falla y queda la publicación anterior. Para quitar el acceso por cupón, primero se revierte el commit que puso esos textos y después se vacía la variable.
- **No publicar los textos del regalo antes de que el portero lo dé.** Las páginas que prometen los primeros 3 sorteos oficiales gratis se leen aunque el sitio abra en Prueba, y la publicación de producción no sale con esas frases sin `VITE_REGALO=1` (`src/alta-textos-con-cobro.ts`): el build falla y queda la publicación anterior. El orden: desplegar el portero con el regalo, probarlo con una cuenta nueva del equipo, poner `VITE_REGALO=1` en Production y después unir los textos.

## Los pagos de premios, los retiros y el alta de quien ganó

Además de los sellos y los sorteos, el portero de mainnet puede pagar la comisión de la red de dos pagos de dólares digitales y dar de alta a quien ganó un premio. Son tres cosas aparte, cada una con su variable en `[env.mainnet.vars]` de `workers/patrocinio/wrangler.toml`. Nacen apagadas y solo valen en la red principal y con `ALTAS = "1"`. Con las tres apagadas el portero hace lo de siempre: las rutas nuevas dan `404 no-existe` y `estado` y `cupo` no traen nada nuevo.

- **El pago de un premio** (`POST /v1/patrocinio/pago` con `{"forma":"premio","xdr":...}`). Quien organizó un sorteo le paga a quien ganó, desde su propia cuenta, con la nota `tk:premio:<sorteo>:<puesto>`. No lleva sesión: la firma de la cuenta que paga prueba quién es. El portero lo paga solo si esa cuenta está en su libro, el sorteo es suyo, ya se sorteó, el puesto existe, el sello lo pagó el portero, el `draw` de ese mismo sorteo también lo pagó el portero con ese sello (un sello respalda un solo sorteo: otro igual sellado por fuera no tiene premios por acá) y ese puesto no se pagó antes por esta ruta.
- **El retiro con su costo** (`forma: "retiro"`). Una persona saca dólares digitales de su cuenta a otra, y en la misma transacción paga el costo de `COSTO_RETIRO` a `CUENTA_COBROS`. Vale desde cualquier cuenta. El portero reconoce ese costo por la transacción que él mismo pagó: no cae a los pagos sueltos ni se confunde con una orden, y la nota de un retiro nunca se lee como la de una orden.
- **El alta de quien ganó** (`POST /v1/alta/premio`, con la sesión de Google de quien organiza y `{"sorteo","puesto","cuenta"}`). La cuenta de quien ganó entra al libro sin cupón y sin sorteos, solo para activarse y recibir su premio: no puede sellar ni sortear. El portero no puede saber quién ganó (el contrato guarda la huella de la lista, no las cuentas): lo nombra quien organiza, y lo único que se comprueba es que el sorteo sea suyo, esté sorteado, tenga ese puesto y que el portero haya pagado su sello y su `draw`, como en el pago de un premio. Una vez por sorteo y puesto. Mientras no se active, aparta 30 créditos del piso como cualquier alta, y si la cuenta ya existe en la red no hace falta nada (`no-hace-falta`).

La comisión de la red la paga la cuenta que paga los sellos, con un presupuesto de 24 horas aparte del de ellos: un abuso de pagos no deja sin sellos al evento, ni al revés. **Los pagos nunca vuelven a Pollar**: con el portero apagado o devuelto a Pollar, un premio o un retiro no sale (`503 apagado`) y el sitio lo dice. El alta de quien ganó no mira ese modo, como los cupones. El contrato de las dos rutas está en [workers/patrocinio/README.md](../workers/patrocinio/README.md).

| Variable | Hoy | Qué hace |
|---|---|---|
| `PAGOS_PREMIO` | `"0"` | Con `"1"`, el pago de un premio. Pide `ALTAS = "1"` y el contrato oficial. Sin `ALTAS`, `faltaAltas` dice `pagos-premio` y queda apagada |
| `RETIROS` | `"0"` | Con `"1"`, el retiro con su costo. Pide `ALTAS = "1"`, `CUENTA_COBROS` propia y `COSTO_RETIRO` bien escrito. Si falta algo, `faltaAltas` dice `retiros` o `costo-retiro` |
| `ALTAS_PREMIO` | `"0"` | Con `"1"`, el alta de quien ganó. Pide `ALTAS = "1"` y el contrato oficial. Sin `ALTAS`, `faltaAltas` dice `alta-premio` |
| `COSTO_RETIRO` | `"0.50"` | El costo exacto del retiro, en USDC con punto, de 0,01 a 5. Manda sobre el del sitio: si no son iguales, el portero rechaza todo retiro y nunca cobra de más. Vacío, en 0, en 6, con coma o con letras, el retiro no se prende y `faltaAltas` dice `costo-retiro` |
| `TOPE_PAGOS_STROOPS` | `"20000000"` | El presupuesto de las comisiones de los pagos en 24 horas: 2 XLM, aparte del de los sellos. **Solo dígitos** y hasta `"100000000"` (10 XLM): mal escrita apaga los pagos y `faltaAltas` dice `tope-pagos`, también con las formas apagadas |
| `PAGOS_RECHAZADOS_DIA` | `"20"` | Cuántos pagos de cada forma que la red rechazó al aplicarse (y que pagaron comisión) se aceptan en 24 horas entre todas las cuentas. Lo que está en el aire tiene su propio tope, en el código. **Solo dígitos** y hasta `"100"`: mal escrita apaga los pagos y `faltaAltas` dice `pagos-rechazos` |
| `ALTAS_PREMIO_DIA` | `"100"` | Cuántas altas de quien ganó se dan en 24 horas entre todos. **Solo dígitos** y hasta `"300"`: mal escrita apaga el alta y `faltaAltas` dice `altas-premio-dia` |

Los topes que se cambian pidiendo un despliegue (están en el código) y los que se mueven en caliente:

| Tope | Cuánto | Cómo se cambia |
|---|---|---|
| Comisiones de los pagos, en 24 horas | 2 XLM | `TOPE_PAGOS_STROOPS`, o en caliente hasta 10 XLM |
| Pagos rechazados por la red, por forma y entre todos, en 24 horas | 20 | `PAGOS_RECHAZADOS_DIA`, o en caliente hasta 100 |
| Altas de quien ganó entre todos, en 24 horas | 100 | `ALTAS_PREMIO_DIA`, o en caliente hasta 300 |
| Retiros por cuenta, en 24 horas | 10, y 2 los que la red rechazó | el código |
| Premios por quien organiza, en 24 horas | 60, y 5 los que la red rechazó | el código |
| Premios por sorteo | el menor entre los ganadores y 50 | el código |
| Premios que la red rechazó hacia una misma cuenta, en 24 horas | 2 | el código |
| Intentos que la red no tomó, por cuenta, en 24 horas | 10 | el código |
| Pagos de una cuenta que la red tomó y nunca entraron, en la última hora | 2 | el código |
| Lo que Horizon dice que fallaría, por cuenta y por hora | 20 | el código |
| Pagos en el aire por cuenta | 1 | el código |
| Pagos en el aire a la vez, por forma y entre todos (sin contar los que ya vencieron) | 60 | el código |
| Altas de quien ganó por sorteo, en 24 horas | el menor entre los ganadores y 50 (y 50 por sello del portero) | el código |
| Altas de quien ganó por quien organiza, en 24 horas | el menor entre 30 y una quinta parte del tope del día (20 con 100), y 3 cuando las del día pasaron las cuatro quintas partes | el código, y se mueve con el tope del día |
| Pedidos de pagos por dirección y por hora | 3.000 (una sala entera por la misma wifi activa, sella y sortea), con su propio contador | `POR_IP_POR_HORA` |

**Qué mirar en `estado`.** El bloque `pagos`, que aparece con alguna forma prendida, con algún pago o alta en el día o con alguna pausa: `premio`, `retiro` y `altaPremio`, cada uno con si está prendido y pausado y, además, `enElAire`, `ok24h` y `fallo24h` en los dos pagos y `hoy` y `cercaDelTope` en el alta (`true` cuando las altas del día llegaron al 80 por ciento de `altasPremioDia`: se sube el tope en caliente o se mira quién las pide, y la bitácora lo anota una vez con `alerta-altas-premio`), y también `gasto24h` contra `topeStroops`, `rechazosPorDia`, `altasPremioDia`, y `costosRetiro24h` y `cobradoRetiros24h`, que cuentan los costos de retiro que reconoció la cuenta de cobros. Aparte de `firmas` va `firmasPagos`: las firmas de Pollar que explican los premios y los retiros pagados a cuentas del libro, así `firmasSinExplicar` sigue midiendo solo lo que alguien firma por fuera. Si aparece `faltaAltas`, lo que nombra quedó apagado.

**Pausar y reanudar.** Cada forma se frena sin desplegar, con la clave de operar. `forma` es `premio`, `retiro`, `alta-premio` o `todas`, y la respuesta dice cuáles quedan pausadas. La pausa es un ajuste, no una variable: anda también con las variables apagadas y sobrevive a un despliegue. Frena lo nuevo (`503 apagado` con `detalle: "pausado"`) y deja pasar el reenvío de un pago ya reservado.

```bash
curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"forma":"retiro"}' $P/v1/admin/pagos/pausar
curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"forma":"retiro"}' $P/v1/admin/pagos/reanudar
```

**Subir un tope en caliente.** Con uno o más de `presupuestoXlm` (hasta 10), `rechazosPorDia` (hasta 100) y `altasPremioDia` (hasta 300). Más que su techo da `400 techo` y no escribe nada, tampoco de los otros campos. Contesta los topes que quedan y rige en el pedido siguiente. Queda en los ajustes: sobrevive a un despliegue.

```bash
curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"presupuestoXlm":4}' $P/v1/admin/pagos/tope
```

**Cómo se prenden.** Cambiando las variables y desplegando, con la palabra de quien mantiene el proyecto y nunca el día de un evento. Dos despliegues, los dos antes: primero el código con las tres en `"0"`, y al terminar todo pausado (`forma` en `todas`), y después las tres en `"1"`, todavía pausado hasta el ensayo. La pausa del primero sobrevive al segundo. Después del primero, ya pausado, `estado` trae el bloque `pagos` con las tres formas en `prendido: false` y `pausado: true`, sin `faltaAltas`, y `POST /v1/patrocinio/pago` y `POST /v1/alta/premio` dan `404 no-existe`. Después del segundo, las tres formas dicen `prendido: true` y `pausado: true`, `pagos.retiro.costo.usdc` dice `"0.50"`, `/cupo` trae el bloque `pagos` con `costoRetiro.monto` en 5000000 y las dos rutas contestan `503 apagado` con `detalle: "pausado"`. Antes de cada uno, el exporte de `/v1/patrocinio/exportar` fuera del repositorio. Los créditos: lo de Antes del evento más unos 40 por cada ganador que se espera con cuenta nueva.

**Si quien organiza no tiene la cuenta de Google.** Con una billetera propia no hay sesión y `POST /v1/alta/premio` no sirve. El respaldo es el de siempre, a mano por cada cuenta nueva que ganó, con un sorteo (suma 40 créditos más al piso):
`node scripts/cupones.mjs admitir --cuenta G... --sorteos 1 --dias 30 --ref premio-<sorteo>-<puesto>`

**Volver atrás.** Durante el evento, solo pausar: no se despliega. Para volver a una versión anterior, primero pausar las tres formas y esperar a que `pagos.premio.enElAire` y `pagos.retiro.enElAire` lleguen a 0 (hasta unos 15 minutos), correr `node scripts/cupones.mjs sueltos` para que ningún costo de retiro quede sin leer, guardar el exporte y recién entonces volver. La versión de antes no ve las tablas nuevas: un costo que leyera con la nota numérica de una orden abierta se ataría a esa orden, y eso no se reclasifica. Las altas de quien ganó siguen en el libro y la versión de antes las lee igual.

### El ensayo con plata de verdad

Solo se puede en la red principal. Hace falta una vista previa del sitio que pague premios y retiros con la cuenta de Google y deje activar a quien ganó, y tres cuentas: quien organiza (en el libro, con su línea de dólares digitales y 3 de ellos), **una cuenta de Google nueva que nunca entró al modo Oficial y sin cupón**, y una cuenta propia de destino para los retiros. Se empieza reanudando las tres formas (`forma` en `todas`).

1. **El alta de quien gana.** Quien organiza sella una lista de 2 entradas (la cuenta nueva y otra propia) con 2 ganadores, así la cuenta nueva sale seguro en un puesto, y sortea con el portero (un sorteo pagado por fuera no tiene altas ni premios por acá). Su panel llama a `POST /v1/alta/premio` con el puesto de la cuenta nueva: `200` con `admitida`. La cuenta nueva entra con `/?red=oficial&premio=1`: el paso ofrece Activar sin pedir cupón, activa, llega solo el pedido de la línea y Recibir un premio lo vota. En `estado`: `altas24h` sube uno, `pagos.altaPremio.hoy` queda en 1 y, ya activada, `firmas.activaciones` sube uno. La misma llamada otra vez da `repetido`. Con otra cuenta para el mismo puesto, `409 puesto-usado`.
2. **Premio de 3.** Quien organiza paga el puesto de la cuenta nueva. `200` con `PENDING` y después `ok`. En Horizon, `fee_account` es la cuenta que paga, `inner_transaction.hash` es el hash, la nota es la del premio y `fee_charged` ronda los 200. El comprobante dice Pagado. En `estado`: `pagos.premio.ok24h` en 1 y `firmasPagos.premios` en 1.
3. **El mismo sobre otra vez**: `200` con `DUPLICATE` y `ok`. Otro sobre para el mismo puesto: `409 puesto-usado` con el hash del primero.
4. **Retiro con la nota fija.** Quien ganó retira: llega 1 a la cuenta propia de destino y 0,50 va a cobros, con la nota `tkz-retiro`. En Horizon, los dos pagos van en una transacción que pagó la cuenta del portero. `node scripts/cupones.mjs sueltos` no muestra nada nuevo y `pagosSueltos` queda igual. En el exporte hay una fila en `pagos_sueltos` con `costo-retiro` y `cobrado`, y la de `retiros_cobrados`. **Lo más importante del ensayo**: anotar cuál de los dos hashes trae Horizon en el `transaction_hash` del pago a cobros y si trae `transaction.inner_transaction.hash`.
5. **Otro retiro de 1, con una nota numérica** (12345), a otra cuenta propia: también `costo-retiro`, y ninguna orden tocada.
6. **Un sobre armado a mano** (con un guion local, no con el sitio) con el costo en 0,49: `400 no-permitida` con `costo-monto` y nada en la red.
7. **Pausar el retiro** con la clave de operar: `503 apagado` con `detalle: "pausado"`. Reanudar.
8. **`estado` y el vigilante**: `firmasSinExplicar` no sube por estos pagos ni por la activación.

Mueve 3 dólares digitales entre cuentas propias (1 queda en cobros), unos cientos de stroops de XLM, una activación y unas siete firmas (unos 180 créditos). Si sale bien, se deja reanudado o pausado según decida quien mantiene el proyecto. Si la vista previa del sitio no está a tiempo, el paso 1 se hace con `curl` y el token de la sesión de quien organiza, copiado de la vista previa y sin escribirlo en ningún archivo, y la cuenta nueva se activa con la vista previa del paso.

## La campaña de una empresa

Es el sorteo de una empresa por QR: la empresa pone el premio, la gente se anota desde el celular con su cuenta de Google y quien organiza lo maneja desde un panel de la herramienta, que se abre con `?campana`. Junta cuatro piezas: el portero (comisiones, altas y pagos), el servicio de conteo, la sala de campaña (`workers/sala`, en `s.tinkazo.app`) y el sitio. Esta sección dice cómo se prepara, qué se despliega y en qué orden, qué se prueba antes, qué se hace el día y qué queda para después. Lo del portero (el pago de un premio, el retiro con su costo y el alta de quien ganó) no se repite: está en la sección anterior, Los pagos de premios, los retiros y el alta de quien ganó, y acá se enlaza. El contrato de la sala, ruta por ruta, está en [workers/sala/README.md](../workers/sala/README.md), en Las salas de campaña firmadas.

### El archivo de la campaña y su firma

La campaña es un archivo JSON que firma Tinkazo. La sala no crea nada que no venga firmado, y el sitio solo muestra lo que la sala le entrega tal como lo firmó.

- **Qué lleva.** Lo que leen `leerCampana` (`src/campana/modelo.ts`) y la sala (`leerTextoDeCampana`, `workers/sala/src/campana.ts`): `v` en 1, `evento` (de 3 a 40 letras minúsculas, números y guiones), `red` (`mainnet` o `testnet`), `estado`, `empresa` (nombre de hasta 40 letras, logo o `null`, color o `null`), `lugar` y `bases` en español y en inglés, `zona` horaria, `premios` (de 1 a 10 montos enteros escritos como texto, en unidades de siete decimales: `"10000000"` es un dólar digital y el mínimo es un centavo), las horas `abre_ms`, `cierra_ms`, `sorteo_ms` y `recibir_hasta_ms` (en ese orden, con `cierra_ms` igual o menor que `sorteo_ms`), `entrada` (`google` o `google-correo`), hasta 8 `pasos` (los pedidos de la empresa: una red social, un enlace o un texto), `anotadas` (un entero, en 0 al firmar) y `contrato`, `promo` y `comprobante` en `null`. Puede traer `organizadora`, una cuenta G: con ella, solo esa cuenta puede sellar la lista. El archivo se arma a mano, fuera del repositorio.
- **El plazo para recibir.** `recibir_hasta_ms` es un dato del archivo y nada lo hace cumplir: ni el sitio ni la sala cierran la entrada de quien ganó cuando pasa. Quien organiza decide qué hacer con un premio que no se recibió (ver Después del evento, más abajo).
- **Cómo se firma.** Con `scripts/campana-firmar.mjs`, desde la raíz del repositorio y con sus tres opciones:

```bash
# Una sola vez: guarda la llave privada en ese archivo y muestra solo la pública. No pisa un archivo que ya existe.
node scripts/campana-firmar.mjs --nueva-llave <archivo fuera del repositorio>
# Firma una campaña: escribe <campaña>.firmada.json al lado del archivo original.
node scripts/campana-firmar.mjs --llave <archivo de la llave> --campana <campaña.json>
# Un par de llaves descartable para probar la sala en local. No escribe ningún archivo.
node scripts/campana-firmar.mjs --nueva-llave-prueba
```

- **Dónde va cada llave.** La pública se escribe en `workers/sala/src/firma.ts` (`LLAVE_CAMPANAS_HEX`), y sin ella la sala contesta `503 sin-llave` y no crea ninguna campaña. La privada no se versiona, no se manda a ningún Worker y no se pega en un chat. El firmador se niega a escribirla dentro del repositorio, también por un enlace simbólico o desde una copia de trabajo, y se niega a dejar el archivo firmado ahí: quien tiene primero ese archivo crea la sala del evento y se queda con su token.
- **Lo que revisa antes de firmar.** Corre los dos lectores que después leen el archivo, el de la sala y el del sitio, y no firma nada que alguno rechace: dice cuál lo rechazaría y por qué campo. También exige que `cierra_ms` sea una hora futura.
- **Un evento, una sala viva.** Cada `evento` puede tener una sola sala a la vez, y el token de quien organiza vive en el navegador que la creó. Por eso se firman dos archivos con eventos distintos por cada evento real: si se pierde el token de uno, el otro sirve. La sala vive 24 horas desde que se crea, y se crean como mucho 20 por día.
- **Quién sella se decide antes de firmar.** Con `organizadora`, el panel no deja sellar con otra cuenta: pide entrar con la que termina en esas letras. Si igual llegara un sello de otra cuenta, la sala lo rechaza con `organizador-distinto`, y para entonces ese sello ya quedó en la red y gastó un sorteo. Un archivo sin `organizadora` deja sellar a cualquier cuenta.

### Qué se despliega, en qué orden y por qué

El código del sitio sube antes, con todas las banderas apagadas: así ya está publicado cuando la sala nueva exista, y con las banderas apagadas la campaña no se ve. Después va este orden, y cada paso se comprueba antes de seguir. Con gente adentro no se despliega el portero ni el sitio. La sala solo se despliega para los cortes 3 a 5 de Cómo cortar una campaña: la lista, las fases y la alarma están guardadas en el almacenamiento de la sala y sobreviven, y los celulares siguen preguntando solos y se ponen al día en menos de un minuto.

1. **El portero**, con los tres pagos desplegados apagados y pausados, y después prendidos y pausados. Es lo primero porque el sello y el sorteo de la campaña, el alta de quien ganó y los pagos pasan por él, y porque cada despliegue suyo reinicia su memoria. Se hace como dice Cómo se prenden, en la sección de los pagos: dos despliegues y un exporte antes de cada uno.
2. **El servicio de conteo** (`workers/enlaces`, en `c.tinkazo.app`). Va antes que las banderas del voto porque la lista cerrada de lo que cuenta incluye el error `cofirmaDistinta`, el que sale cuando el voto por contenido frena una firma. Un conteo anterior rechaza ese aviso entero y justo la falla que más importa no se vería.
3. **La sala** (`workers/sala`), con su secreto cargado y probada contra producción (más abajo). Va antes de las banderas del sitio porque con `VITE_CAMPANAS` la página del celular y el panel empiezan a hablar con ella. Si la campaña avisa por correo, en el ensayo se prueba con una cuenta propia y después se despliega la sala con `CORREO_GANADORAS = "1"`, antes de abrir la inscripción. Se comprueba que el estado público diga `"correo": true`. Si queda en `"0"`, el celular no promete el aviso y quien organiza avisa por sus canales.
4. **El sitio, con las banderas** de la campaña y de los pagos, y una publicación nueva: se leen al construir.

La sala y el conteo se despliegan cada uno desde su carpeta, con la sesión de `wrangler login` de la cuenta de Tinkazo y con la versión probada de wrangler que ya usa el portero: `npx wrangler@4.160.0 deploy`. Un despliegue reemplaza todas las variables por las del `wrangler.toml`: antes, anotar las que están arriba (`npx wrangler@4.160.0 deployments list` dice la versión y `versions view` sus variables) y compararlas con las del archivo, y no seguir si alguna se va o cambia sin que se espere.

**La regla de límite de Cloudflare.** La sala no tiene hoy una regla delante: la cubren sus propios topes (300 personas por sala, 300 altas por minuto y 300 rechazos por conexión). Sumarla pide ampliar la única regla de la zona con `s.tinkazo.app`, y lo decide quien mantiene el proyecto.

**Las variables de la sala**, en `[vars]` de `workers/sala/wrangler.toml`, y el secreto:

| Variable | Hoy | Qué hace |
|---|---|---|
| `POLLAR_SECRETO` | secreto | La misma llave secreta del portero de la red principal. Se carga con la sala ya desplegada, desde `workers/sala`, con `npx wrangler@4.160.0 secret put POLLAR_SECRETO`, por la entrada estándar y nunca escrita en un comando ni en pantalla. Sin ella, nadie se anota: la sala contesta `503 sin-pollar`. |
| `POLLAR_APP_ID` | el valor público de la app | El id de la app del proveedor de cuentas en la red principal, el mismo del portero. Una sesión de otra app da `403 otra-app`. |
| `RPC_MAINNET` | dos direcciones, separadas por coma | Donde la sala lee el sello y el resultado en la red principal. Los prueba en ese orden, con un tope de diez segundos cada uno. Si ninguno contesta, el sello o el resultado dan `502 red` y la sala conserva su fase. |
| `PASE` | `"1"` | Exige el pase del QR. Solo `"0"` lo apaga, y es una salida de emergencia (Cómo cortar, más abajo). |
| `SOLO_GOOGLE` | `"estricto"` | Deja entrar solo a quien el proveedor dice que es de Google. Cualquier otro valor, o ninguno, también es estricto. `"suave"` es una salida de emergencia que además deja entrar, y cuenta aparte, a quien el proveedor no dice por dónde entró. `"suave"` solo abre el alta de las personas: quien organiza, para activar o recuperar una campaña, sigue necesitando entrar con Google. Una vía que no es Google no entra en ningún modo. |
| `CORREO_GANADORAS` | `"1"` | El aviso por correo a quien gana nace apagado en el código y hoy está prendido. Solo `"1"` lo prende, y hace falta además `CORREO` (el enlace `[[send_email]]` del archivo), `CORREO_DE` (una dirección del dominio ya habilitado para el envío) y `POLLAR_SECRETO`. Si falta algo, la sala no reserva ni manda nada y su estado público dice `"correo": false`, y el celular no promete el aviso. |
| `VIDA_PRUEBA_MS` y `LLAVE_CAMPANAS_PRUEBA` | no están | Solo para probar en local. En una campaña solo valen para pedidos que llegan a `localhost`: en un Worker desplegado se ignoran, para que un valor olvidado no le corte la vida a la sala de un evento. |

**Las variables del sitio**, en Vercel, que se leen al construir. Se escriben sin salto de línea (con `printf`): varias solo prenden con un `1` exacto y se apagan sin aviso con cualquier otra cosa.

| Variable | Qué hace |
|---|---|
| `VITE_CAMPANAS` | Prende la campaña: el panel de quien organiza (`?campana`), la página del celular (`participar.html`), la entrada de quien ganó (`?premio=1`) y el aviso del sello a la sala. Vale `1` o `true`. Apagada, `participar.html` dice que las campañas no están abiertas. No tiene freno de valor: con otro valor queda apagada sin que el build avise. `?demo=campana` abre aunque esté apagada, así que no sirve para comprobarla. |
| `VITE_RAMPA` | `premios`: Tus dólares digitales deja ver el saldo y recibir un premio, y nada más. La entrada de quien ganó no abre con la rampa apagada. No va junto con `VITE_PAGO_CON_SALDO=1` ni `VITE_COMPRA_QR=1`: el build no sale. En este modo (y en `recibir` y con la rampa apagada), una cuenta de Google que puede guardar dinero no sella ni sortea mientras el voto por contenido no esté prendido: la puerta del premio, en el apartado de abajo. |
| `VITE_VOTO_POR_CONTENIDO` | `1`: en la red principal, el navegador de una cuenta de Google vota solo la transacción que armó la página. Es lo que levanta la puerta del premio. No va junto con `VITE_PAGO_CON_SALDO=1`, `VITE_COMPRA_QR=1`, `VITE_RAMPA=pollar` ni `VITE_RAMPA=recibir`, y un valor que no es `1` ni `0` frena el build. El build no lo ata al modo premios: sin el voto, en ese modo una cuenta de Google con la línea del dólar digital no sella ni sortea (la puerta del premio). |
| `VITE_PAGOS` | `1`: Pagar premio y el estado de cada pago. Solo `1` exacto. |
| `VITE_PAGAR_CON_GOOGLE` | `1`: quien organiza carga dólares digitales y paga el premio desde su cuenta de Google. Pide `VITE_RAMPA=premios`, `VITE_VOTO_POR_CONTENIDO=1`, `VITE_PAGOS=1` y `VITE_PATROCINIO_URL_MAINNET` con la dirección del portero oficial. |
| `VITE_PATROCINIO_URL_MAINNET` | La dirección del portero de la red principal: https, sin ruta ni consulta, y la oficial: con pagar con Google, el build no deja que mande lo firmado a otra. |
| `VITE_RETIRO_COSTO` y `VITE_RETIRO_CUENTA` | El costo del retiro y la cuenta que lo recibe. Van juntas. El build exige que la cuenta sea la `CUENTA_COBROS` del portero, letra por letra, y con el costo prendido exige también el voto y la dirección del portero. No compara el costo con `COSTO_RETIRO` del portero: se miran a ojo, y si no son iguales el portero rechaza todo retiro. En la publicación de producción, además, la respuesta de la portada sobre cuánto cuesta tiene que decir ya el costo, en el mismo commit que lo prende. |
| `VITE_PAGOS_CUENTAS` | Direcciones G, separadas por coma, de cuentas que pagan premios sin ser la que selló. Un pago mandado desde una de ellas con la nota `tk:premio:<sorteo>:<puesto>` figura como pagado en el comprobante. |

**Para una campaña con pagos**, las banderas del sitio van en dos lotes. Primero `VITE_CAMPANAS=1`, `VITE_PAGOS=1` y `VITE_RAMPA=premios`, sin `VITE_PAGO_CON_SALDO` ni `VITE_COMPRA_QR`: el build no sale con ellas junto al modo premios. Después `VITE_VOTO_POR_CONTENIDO=1`, `VITE_PAGAR_CON_GOOGLE=1`, `VITE_RETIRO_COSTO`, `VITE_RETIRO_CUENTA` (la cuenta de cobros) y `VITE_PAGOS_CUENTAS` (la billetera de respaldo). El segundo lote va en el mismo commit que cambia la respuesta `faq3a` de `index.html` por el texto de `src/costo-del-retiro-portada.ts`: la publicación de producción con el costo del retiro prendido no sale mientras la portada diga otra cosa, y tampoco sale con la venta abierta a todos (`VITE_VENTA_ABIERTA` junto con `VITE_ALTA_PAGO`), porque ese texto no se puede publicar así. Conviene hacer antes un build en seco con `VERCEL_ENV=production` y esas variables.

El detalle de qué combinaciones frena el build está en `src/stellar/premios-build.ts`. Si el build de una publicación falla por una de ellas, las banderas quedan puestas y frenan también la publicación siguiente, aunque sea un arreglo: se quitan las del lote enseguida, y recién después se lee el motivo. Y quitar `VITE_VOTO_POR_CONTENIDO` cuando ya hay cuentas que votaron la línea del dólar digital las deja sin poder sellar ni sortear: antes de sacarlo, pausar los pagos y avisar.

### Que el sello y el sorteo pasen por el portero

Para que haya premios y altas, el sello y el sorteo de la campaña tienen que pagarlos el portero. El pago de un premio y el alta de quien ganó solo valen si el portero pagó el sello de ese sorteo y el `draw` de ese mismo sorteo con ese sello: un sello respalda un solo sorteo, y uno igual sellado por fuera no tiene premios ni altas por acá (`403 no-es-nuestro`). Por eso la cuenta que sella tiene que estar en el libro del portero, con sorteos de sobra para el ensayo, para un sello que haya que repetir y para el evento (Antes del evento, punto 6). La campaña no sigue sin sello: si el sellado queda en el modo libre, el panel lo dice y pide sellar de nuevo.

### La prueba con dos cuentas y el ensayo con poca plata

Se hacen antes del evento, con una empresa inventada y otro evento firmado, en dos pasos.

**La prueba parcial.** Un archivo de ensayo con un premio de un dólar digital y el cierre a un par de horas. Con la cuenta que organiza conectada (la que dice el archivo, si trae `organizadora`):

1. Abrir `/?campana&red=oficial`, elegir el archivo, abrir la inscripción y mostrarla en grande. Recargar la pestaña con la inscripción abierta: tiene que volver a Abierta, con el mismo contador y sin pedir el archivo. Dejarla abierta unos 16 minutos: el QR se renueva solo. La compu tiene que estar enchufada y sin suspensión, porque sin un pase nuevo en 12 minutos el QR se retira.
2. Un celular con datos móviles, no con la wifi del lugar: escanear con la cámara, entrar con Google y anotarse. Es también la prueba del secreto de la sala, que no se puede probar con una sesión inventada: con una llave equivocada el proveedor contesta como con una sesión mala, y la sala dice `sesion` en los dos casos. Si ese celular dice que no pudo, mirar el secreto antes que nada.
3. Un segundo celular con otra cuenta de Google: el contador del panel sube a 2 en pocos segundos. Repetir la primera cuenta en el segundo celular: dice que ya estaba.
4. Una página del QR abierta más de 16 minutos antes de tocar Acepto: pide escanear de nuevo.
5. Abrir el enlace desde dentro de Instagram o de una app parecida: la página avisa que hay que abrirlo en el navegador.
6. **Confirmar que Google entra como Google.** El campo que dice por dónde entró la sesión (`authProvider`) y el valor que dice Google (`google`) están en una sola constante, `VIA_DE_LA_SESION` en `workers/patrocinio/src/pollar.ts`, y son una suposición hasta confirmarlos con una respuesta real: esta prueba es esa confirmación. Si un celular con Google dice Para este sorteo hay que entrar con Google, la constante es otra: se cambia, se sube y se vuelve a desplegar la sala. `suave` no lo arregla, solo cubre el campo que falta.

También se prueba la sala contra producción con `node probar.mjs https://s.tinkazo.app`, desde `workers/sala`: crea dos salas comunes que se cierran o vencen solas, y el bloque de campañas se saltea solo contra producción.

**El ensayo completo, con poca plata.** Otro archivo, con dos premios de dos dólares digitales cada uno y `organizadora` con la cuenta que va a sellar. Se empieza reanudando las tres formas (`forma` en `todas`, `/v1/admin/pagos/reanudar`) y mirando en `estado` que `pagos.premio`, `pagos.retiro` y `pagos.altaPremio` digan `prendido: true` y `pausado: false`: después del segundo despliegue el portero queda prendido y pausado, y pausado ni el panel da de alta a nadie ni Pagar premio ni el retiro andan (contestan `503 apagado`). La cuenta que paga necesita 4 dólares digitales para los dos premios. Hacen falta cuatro cuentas de Google a mano (la que organiza, una cuenta nueva que nunca entró al modo Oficial, otra y una para quitar) y dos cuentas propias, sin custodia y con la línea del dólar digital, para los retiros: nunca un exchange.

1. Abrir la inscripción y anotar las cuentas. Quitar a la que sobra con su motivo, ver que no pueda volver, y cerrar la lista. Con dos premios y dos personas, ganan las dos, y la cuenta nueva gana seguro.
2. Pasar la lista al sorteo y sellar. La campaña sella con la ronda a 90 segundos, para que quede margen para avisar a los celulares. Esperar, sortear y mirar que los celulares digan que ganaron.
3. El panel da de alta a cada ganadora en el portero. Para la cuenta nueva sale `admitida`, para una que ya existe en la red sale `no-hace-falta`, y para una que ya está en el libro, `ya-tiene-acceso`. Las tres están bien. Si falla, está el camino a mano de Si quien organiza no tiene la cuenta de Google.
4. En el celular de cada ganadora, para que las dos puedan retirar en el paso 7, entrar con `/?red=oficial&premio=1` (o con Recibir mi premio) y dejar la cuenta lista: la nueva se activa sin cupón y recibir un premio vota el pedido de la línea.
5. Cargar a quien organiza con el panel de pago: Cargar muestra la dirección y su QR, y Ya lo mandé actualiza el saldo. Pagar el premio de la cuenta nueva cuando su celular terminó de dejar la cuenta lista. Antes de firmar, mirar el monto.
6. Recargar la pestaña a propósito antes de pagar el otro premio y anotar qué queda en el panel. Pagar premio no vuelve, porque la pantalla del resultado no se retoma al recargar. Ese premio se paga desde la billetera de respaldo de `VITE_PAGOS_CUENTAS`, con la nota `tk:premio:<sorteo>:<puesto>`, y se mira que el comprobante diga Pagado.
7. El retiro: lo que se escribe es lo que sale de la cuenta, y lo que llega es eso menos el costo, y tiene que llegar al menos un dólar digital. Con el costo de 0,50, cada ganadora retira 1,50: llega 1 a una cuenta propia y 0,50 va a la de cobros. Una retira con la nota fija y la otra con una nota numérica. Antes, con la pausa del retiro puesta, probar uno: tiene que decir que no se puede y no mover nada. Después se reanuda el retiro.
8. Cortar la wifi de la compu y seguir con el punto de acceso de un celular: el panel se pone al día.

En cada paso, mirar `estado` del portero (la sección de los pagos explica sus renglones) y, al final, que el gasto de pagos esté muy por debajo del tope, que no haya fallos ni pagos en el aire y que `firmasSinExplicar` no haya subido por estos pagos ni por la activación.

### El día de la campaña

**Una hora antes.** La compu de quien organiza enchufada, sin suspensión ni protector de pantalla, con su propio perfil del navegador y con una segunda salida a internet probada (el punto de acceso de un celular), porque sellar y pagar tienen que poder hacerse por ella. Recargar el panel después de la última publicación del sitio y mirar que la sesión de Google siga viva. Mirar `estado` del portero (créditos, piso y margen: lo de Durante el evento), y que `curl -s -o /dev/null -w "%{http_code}\n" https://s.tinkazo.app/v1/sala/aaaaaaaa/campana` dé 404, no 500. A la cuenta que sella le tienen que quedar al menos dos sorteos (`/v1/patrocinio/cupo?cuenta=G...`), y la cuenta que paga el premio tiene que tener su línea del dólar digital y saldo para todos los premios, o cargarse desde el panel. Mirar también en `estado` que `pagos.premio`, `pagos.retiro` y `pagos.altaPremio` digan `prendido: true` y `pausado: false`. Si quien mantiene el proyecto decidió dejarlas pausadas después del ensayo, se reanudan (`/v1/admin/pagos/reanudar`, con `forma` en `todas`) antes de abrir la inscripción.

**El recorrido de quien organiza**, con una sola persona de apoyo para la gente y otra para el panel. La compu nunca queda sola.

1. Abrir `/?campana&red=oficial` con la cuenta que sella (si el archivo trae `organizadora`, el panel pide entrar con la cuenta que termina en las últimas letras de esa dirección), elegir el archivo firmado, mirar la vista previa y abrir la inscripción. Esa acción crea la sala.
2. Mostrar en grande. La pantalla grande no muestra ningún nombre: solo el QR, cuántas personas se anotaron y cuánto falta para que cierre. Se dice en voz alta: escaneá con la cámara, no desde Instagram. Si hace falta más tiempo, 15 minutos más.
3. Durante la inscripción, mirar el contador y la lista del panel. Quitar a quien no cumple, con su motivo: repetida, no está en el evento, lo pidió u otro. Salir es para siempre en esa sala. El botón Quitar está mientras la lista esté abierta o cerrada y todavía no se haya trabado para el sorteo: desde que se pasa a sellar, ya no aparece.
4. Cerrar la lista, con señal estable. El panel dice con cuántas personas cierra y pide confirmar, y los celulares pasan a La lista ya cerró. Desde ahí, Volver a abrir la lista la deshace, pero solo mientras la lista no esté trabada para el sorteo (en cuanto se pasa a sellar, el botón desaparece). Elegir otro archivo deja la sala y abre el selector de la campaña siguiente, y pregunta antes con una línea que dice qué se pierden los celulares: el aviso de la lista sellada o su resultado.
5. Con la lista cerrada, el panel la lee entera y la pasa solo al sorteo. El botón Pasar la lista al sorteo aparece cuando hay que retomarla (por ejemplo después de recargar) o cuando la sala no aceptó el sello y hay que sellar de nuevo. Si la lectura de la lista falló o se cortó la conexión, el botón dice Probar de nuevo y solo vuelve a leerla. Antes de que la pase, mirar que la sesión de Google siga viva: si pide entrar, se entra ahora, y nunca entre sortear y pagar, porque la vuelta de la ventana de Google recarga la página y se pierde el panel de pago de la pantalla.
6. Sellar la lista, con tiempo: la campaña sella con la ronda a 90 segundos. La sala comprueba el sello en la red y avisa a los celulares. Si la sala dice que no llegó a tiempo (`ronda-pasada`), se sella de nuevo, y eso gasta otro sorteo. Desde sellada, la sala no vuelve atrás.
7. Sortear y dejar la pestaña quieta. La sala guarda el resultado que lee de la red, no el que le diga el panel. Si el aviso falla, el panel ofrece Avisar a los celulares.
8. El panel pide el alta de cada ganadora al portero, y cada fila dice Puede recibir o No se pudo preparar, con Probar de nuevo cuando reintentar puede cambiar algo. Con un no final (`no-es-nuestro`, `sorteo-ajeno`, `puesto-usado` y los demás) no hay reintento y la línea pide avisar a Tinkazo. Si el alta de quien ganó estaba pausada, recargar el panel vuelve a preguntar. A cada una la acompaña una persona de apoyo a Recibir mi premio, en el mismo navegador, y si pide entrar, con Google y la misma cuenta, nunca con el correo, que da otra cuenta. Avisar a cada persona desde el panel.
9. Pagar. En la pantalla del resultado, Pagar premio, mirando el monto antes de firmar. Si la cuenta de quien ganó todavía no activó, el panel lo dice y ofrece avisarle. No cerrar ni recargar la pestaña hasta que todas las filas digan Pagado.

**Qué mirar durante el evento**, cada media hora:

- `estado` del portero, como en Durante el evento, y el bloque `pagos`. El margen, contando cada persona que todavía puede anotarse como un curioso (15) y cada ganadora con cuenta nueva como 40. Si el margen baja de eso, se carga otro tramo o se cierra la lista antes.
- **Los créditos del proveedor de cuentas y el tope de usuarios de su plan**, en el panel del proveedor. Cada cuenta nueva que entra con Google gasta créditos y ocupa un lugar del plan, se anote o no. Una sala admite 300 personas y el plan puede tener un tope más bajo: si quedan pocos lugares, se cierra la lista con quienes ya están antes de que alguien se quede afuera sin saber por qué.
- El panel: el contador, de dónde entraron (`vias`, que solo ve quien organiza) y, en el estado público de la sala, `"correo"`.

### Cómo cortar una campaña

De menos a más, y siempre sin desplegar el portero durante el evento:

1. **Cerrar la lista antes de hora**, con quienes ya están: Cerrar la lista en el panel. Es lo primero si algo falta, como créditos o lugares de usuarios.
2. **Pausar los pagos**, o solo la forma que falla, con `/v1/admin/pagos/pausar` (Cómo cortar, de menos a más, más arriba). Frena lo nuevo y deja pasar el reenvío de un pago ya reservado.
3. **El pase.** Si el pase deja afuera a gente, `PASE = "0"` en `[vars]` de `workers/sala/wrangler.toml` y desplegar solo la sala. El celular entra sin pase y el estado dice que vale siempre. Se vuelve a `"1"` después. Hay que dejar anotado de qué commit salió el último despliegue de la sala, para poder desplegar desde esa copia.
4. **`SOLO_GOOGLE = "suave"`**, solo si las sesiones de Google no dicen por dónde entraron y nadie puede anotarse. Abre solo el alta de las personas: quien organiza sigue necesitando Google para activar o recuperar una campaña.
5. **El correo**: `CORREO_GANADORAS = "0"` y desplegar la sala. Las marcas ya escritas no se tocan.

Las banderas del sitio se leen al construir: apagarlas pide una publicación nueva, así que no son un corte de emergencia.

### Qué no hacer

- **No desplegar el portero, ni volver a una versión anterior, durante el evento.** Un despliegue reinicia el objeto.
- **No recargar la pestaña de quien organiza en medio de un pago**, ni cerrarla, hasta que la fila diga Pagado. Un pago puede estar en el aire sin que la pestaña lo sepa, y mientras pueda entrar no se arma otro: queda en duda hasta que la red diga que no está. Una recarga además pierde la pantalla de pagar, que no se retoma: lo que falte se paga desde la billetera de respaldo.
- **No publicar el enlace del QR** en redes ni en un grupo. Deja de servir a los pocos minutos, a propósito: el pase cambia cada dos minutos y vale unos 14 a 16, y participa quien escanea el QR de la pantalla.
- **No cambiar el proveedor de cuentas en la semana del evento.** Ni el modo en que nace la billetera al entrar ni el fondeo, ni el campo con el que dice por dónde entró una sesión. La sala necesita que la cuenta ya exista cuando verifica la sesión (si no, `409 sin-billetera` y nadie se anota) y que el proveedor diga que es de Google.
- **No tocar una lista sellada.** Desde sellada no se quita a nadie, y la sala compara la huella de las cuentas con la del sello: otra lista da `lista-distinta`.
- **No elegir el archivo firmado en otra compu, en otro navegador ni en una ventana privada**, ni crear otra sala del mismo evento. El token vive en el navegador que creó la sala, y sin él el evento queda ocupado.
- **No mandar un pago de prueba con la nota de un premio de verdad.** La nota `tk:premio:<sorteo>:<puesto>` marca ese puesto como pagado.
- **No pagar por el portero desde otra cuenta que no sea la que organizó el sorteo.** El portero solo paga la comisión de un premio de un sorteo de la cuenta que lo organizó (`403 sorteo-ajeno`). La billetera de respaldo de `VITE_PAGOS_CUENTAS` paga por fuera del portero y se usa solo si se perdió la pestaña de pago.
- **No proyectar el panel de quien organiza**, que muestra los nombres de la lista. Lo que se proyecta es Mostrar en grande.

### Después de la campaña

La sala vive 24 horas desde que se crea, no desde el sorteo, y su alarma borra todo al vencer. Por eso conviene crearla el mismo día del evento, y el panel dice cuándo se borra la lista.

- **Lo que se pierde al borrarse la sala**: el panel de la campaña (la lista, el estado de cada alta, Avisar y Probar de nuevo) y la respuesta de la sala a los celulares. Un celular que ya supo que ganó lo sigue viendo durante 7 días, en ese mismo navegador, con Recibir mi premio. En otro equipo entra por `/?red=oficial&premio=1`, la entrada de quien ganó, que no depende de la sala. El sorteo, su comprobante y los pagos están en la red y no dependen de ella.
- **Lo que se hace a mano**:
  - Anotar las cuentas ganadoras y el enlace del comprobante mientras la sala vive: están en el panel y en el comprobante.
  - **El correo que no salió.** La sala no sabe a quién no le llegó (su registro guarda solo códigos, sin cuentas), y un envío que falla no se reintenta. Quien organiza escribe a cada ganadora por sus propios canales con `https://tinkazo.app/?red=oficial&premio=1`.
  - **El alta a mano.** Con la sala borrada, nadie puede pedir el alta de quien ganó desde el sitio, porque solo la pide el panel de la campaña. Si una quedó en No se pudo preparar, se da como en el respaldo de la sección de los pagos: `node scripts/cupones.mjs admitir --cuenta G... --sorteos 1 --dias 30 --ref premio-<sorteo>-<puesto>`. Es un alta común con un sorteo, no la del premio, y suma 40 créditos al piso.
  - **Pagar lo que falte.** Lo que falte se paga desde la billetera de respaldo de `VITE_PAGOS_CUENTAS`, con la nota del premio. La pantalla del resultado ya no está. El comprobante dice Pagado, Pendiente o, pasados 7 días del sorteo, Vencido por cada premio. Vencido es solo una etiqueta: no frena el pago y no tiene que ver con `recibir_hasta_ms`, que nada hace cumplir.
- **Si un premio no se recibe en el plazo.** Nada vence solo, y la etiqueta Vencido del comprobante no cambia eso: quien organiza decide. Si resuelve sortearlo de nuevo, hace otro sorteo con una lista nueva por el camino de siempre, y a la nueva ganadora hay que darle el alta a mano, avisarle y pagarle, porque ya no hay panel de campaña ni correo.
- **Bajar los topes** y sumar a mano los sorteos que falten a la cuenta que organiza, como en Después del evento.

## El cobro a las campañas de empresa

Una empresa que sortea premios en dólares digitales paga a Tinkazo un porcentaje del total de los premios, con un mínimo, **antes de abrir la inscripción**. Se suma a lo que la empresa carga (para repartir 120, carga 122,40) y nunca sale del premio. Participar sigue siendo gratis. Viaja por el camino del retiro: una transacción con dos pagos, el cobro menos el costo del retiro a la cuenta que cobra y el costo exacto a `CUENTA_COBROS`. Con el costo de 0,50 el **mínimo real es 1,50**, no 1: el retiro pide que lleguen al menos 1 dólar digital a su destino. Un premio de 1 paga 1,50 y se cargan 2,50.

**Las tres variables del build** (`.env.example`), que van juntas y nacen vacías. Sin las tres, el panel de quien organiza es el de siempre y no cambia ninguna pantalla:

| Variable | Forma | Qué es |
|---|---|---|
| `VITE_COMISION_PB` | entero de 1 a 1000 | Los puntos básicos del total de los premios. 200 es el 2 % |
| `VITE_COMISION_MINIMO` | dólares con punto y hasta 2 decimales | Lo menos que se cobra. No baja del costo del retiro más 1 |
| `VITE_COMISION_CUENTA` | dirección G | La cuenta de Tinkazo que recibe el cobro: común, solo para comisiones, con la línea del USDC de Circle autorizada. Nunca la de cobros ni otra del portero |

El build no sale con una sola o con dos de las tres, con la cuenta repetida, sin pagar con Google, sin el costo del retiro, con otro costo del retiro que el `COSTO_RETIRO` del portero, o con `RETIROS` apagado en `workers/patrocinio/wrangler.toml`. Con la comisión prendida deja `comision.json` en la carpeta publicada, con los datos públicos que usa el guion.

**Qué hace falta antes (no es código):**

1. El portero de la red principal con `RETIROS = "1"` y `PAGOS_PREMIO = "1"`: es un cambio en `workers/patrocinio/wrangler.toml` y un despliegue del portero, que pide la palabra de quien mantiene el proyecto. **Hoy `RETIROS` está en `"0"`: sin eso, el panel muestra el pago desde otra billetera como único camino.**
2. La cuenta que cobra, creada en la red principal con su línea del USDC de Circle. Sin la línea, el retiro da `no-recibe`.
3. Créditos de Pollar para la firma del retiro.

**Cómo sabe el panel que ya se pagó:** mira en Horizon los pagos del USDC de Circle de la cuenta de quien organiza a la cuenta que cobra, con la nota del evento (un número que sale del nombre del evento). Quien los pagó no importa: también cuenta un pago desde otra billetera, con la nota como número o como texto. Antes de mandar, una sola respuesta de la red tiene que mostrar la cuenta justo en la secuencia del pago y sin un pago con esa nota: así un nodo atrasado no deja salir un segundo pago. Con un pago que quizás salió, el panel dice que no sabe y no ofrece pagar hasta que la marca vence (360 s) y la mirada sea consistente.

**Reglas para el día:**

- **El evento de la campaña es único.** El pago se reconoce por el nombre del evento: el ensayo y la campaña del día llevan eventos distintos, y `campana-firmar.mjs` lo recuerda. Un evento repetido hereda los pagos de los últimos 30 días.
- **Recomendá pagar al cargar el archivo, antes del evento**, y no con la gente esperando. El panel crea la sala antes de cobrar (un archivo sin firma, un evento tomado o el cupo del día lleno no cobran nada) y la sala queda en esa compu: la inscripción se abre desde la compu que pagó.
- **El ensayo** es una campaña firmada en Oficial con un premio de 1, fuera del modo ensayo y del stand: paga 1,50, carga 2,50, llegan 1,00 a la cuenta que cobra y 0,50 a la de cobros.
- Antes de abrir: `node scripts/campana-comision.mjs <archivo> --portero <url> --sitio <url>` dice el monto, la nota, si ya está pagada, cada pago que cuenta (para devolver lo de más), si la cuenta que cobra existe con su línea, si el portero atiende retiros con ese costo y si la cuenta de quien organiza tiene los premios más el cobro. Sale con 0 pagada, 3 sin pagar, 2 sin poder mirar, 1 uso o desacuerdo con el sitio y 4 solo cálculo.
- **El plan B de los planes B:** vaciar las tres variables y volver a publicar deja el panel como hoy, y el guion confirma a mano si se pagó. Quien activa la campaña también puede pagar el cobro desde su propia billetera con el enlace y el código que imprime el guion: quién paga no importa y eso destraba el panel.
- Si se paga y la inscripción no llega a abrirse, hoy no hay una regla escrita de devolución: la decide quien dirige el proyecto.

## La venta de paquetes, día a día

Con el pago prendido (`ALTAS_PAGO = "1"` y `CUENTA_COBROS` cargada), quien entra con Google o con su correo en el modo Oficial puede comprar un paquete de sorteos oficiales. El portero no mueve plata: crea la orden, lee en Horizon lo que llega a `CUENTA_COBROS` y da los sorteos cuando el pago alcanza. Devolver lo hace a mano quien tiene la llave de `CUENTA_COBROS`. Las órdenes, los pagos sueltos y las devoluciones se atienden con la clave de cupones (`scripts/cupones.mjs`). Pausar la venta, con la clave de operar.

### Una orden

Nace cuando la persona toca el paquete en el sitio (`POST /v1/alta/orden`). Hay una abierta por persona y por producto: pedirla otra vez devuelve la misma.

| Campo | Qué es |
|---|---|
| `id` | 8 letras y números del alfabeto de los cupones, al azar (`ABCD2345`) |
| `nota` | `tk:o:` y el id. Es lo que la persona pone como nota de texto del pago. Se lee como un cupón: sin espacios ni guiones, en mayúsculas, la O por 0 y la I o la L por 1 |
| `memoId` | El mismo id como número. El sitio lo muestra plegado en Más detalles del panel de pago, con su Copiar, para quien paga desde un exchange que solo acepta notas numéricas |
| `producto`, `usdc`, `sorteos`, `dias` | Lo que se vende y su precio, fijos desde que nace la orden (los de `PRECIOS` ese día) |
| `destino` | `CUENTA_COBROS` |
| `vence` | 72 horas después de nacer. Si ya llegó una parte, se renueva con la misma nota hasta 30 días. Un pago que llega tarde igual vale |

La orden queda pagada cuando llega al menos el 95 % del monto (lo que `sueltos` llama `minimo`), en uno o en varios pagos con su nota, y en esa misma lectura da los sorteos: vencen a los `dias` de la orden, contados desde ese momento. No importa desde qué cuenta se paga.

En el exporte (`GET /v1/patrocinio/exportar`), la tabla `ordenes` suma `usuario` (el identificador de Pollar), `creada`, `pagada` (cuándo), `metodo` (`usdc` si se reconoció sola, `devuelta` si se cerró para devolver, `reemplazada` si la cerró el aviso de una compra con QR o una anulación) y `ref`. Cada pago atado a una orden está en `pagos`, con la cuenta que lo mandó (`de`) y su transacción (`tx`). Los montos de esas tablas van en diezmillonésimas: 4 USDC es `40000000`.

### La venta por unidad

Se prende con el producto por unidad solo, `PRECIOS = "sorteo:1:1:365"`, y con `ALTAS_PAGO = "1"`: 1 USDC por sorteo, de 5 a 50 por pago y de a 5, que valen un año. Sin `alta` ni `p10`, porque las páginas públicas dicen que cada sorteo se paga y vale un año, y con paquetes mezclados eso sería falso. Lo que eso apaga es a propósito: el primer paquete pago deja de ofrecerse (ya no hace falta, porque los primeros 3 sorteos se regalan al activar la cuenta) y la compra con QR queda sin producto hasta que se rehaga para vender por unidad. Mientras `PRECIOS` no traiga `sorteo`, todo sigue como arriba. La persona elige la cantidad en el sitio y el servidor arma el total. Lo que cambia para operar:

- **Lo que llega de menos se cuenta por dólar.** Una orden de 10 que recibe 9 da 9 sorteos en esa misma lectura y queda abierta con la misma nota: el dólar que falta la completa a 10. Desde el 95 % (9,50 de 10) da los 10. Por eso una orden por unidad pagada a medias casi nunca hay que devolverla: ya dio lo suyo. `cerrar` no la cierra si ya dio sorteos (`409 con-sorteos`). Si la persona pide la devolución de lo que no le dio sorteos, se resuelve a mano, con quien dirige el proyecto.
- **Lo que llega de más o dos veces se convierte en sorteos**, a 1 dólar cada uno y como mucho 50 por pago: 12,40 sobre una orden de 10 dan 12 sorteos y 0,40 quedan en sueltos como `sobrante`. Un segundo pago de 10 a la misma orden da 10 sorteos más. Un pago a una orden que la persona reemplazó al cambiar la cantidad también da sus sorteos. No se convierte (y va a sueltos como siempre) si la venta está pausada, si la persona no está en el piloto, si los créditos no pasan el piso o si Pollar no contestó en los últimos 10 minutos. Una orden cerrada para devolver nunca convierte. Si alguien prefiere la devolución de lo convertido y no lo usó, se le devuelve a mano y se anota.
- **En el exporte**, cada parte que dio una orden por unidad es un derecho con `ref` `orden:<id>:<operación>`, y cada conversión uno con `ref` `conv:<operación>`. En el registro de sucesos salen `orden-parte` y `orden-convertida`.
- **Nadie tiene que tocar Ya pagué.** Mientras haya órdenes vivas, la alarma del portero lee los pagos sola: cada 20 segundos en la primera media hora de la orden más nueva y después cada 5 minutos, hasta que vence. El pago se acredita aunque la persona haya cerrado la pantalla, y cuando vuelve ya tiene sus sorteos. En `estado`, el bloque `cobros` dice cuántas órdenes vivas hay (`ordenesVivas`), cuántos sorteos reservan en el piso las de la última media hora (`sorteosEnOrdenes`, a 40 créditos cada uno: si `margen` no los cubre, una orden nueva de otra persona espera), los pagos chicos del día (`pagosChicosHoy`), si la lectura va atrasada (`atrasado`, con muchas páginas por leer o Horizon caído), cuántas páginas leyó en el último minuto y cuándo terminó la última lectura. Si `atrasado` sigue en `true` más de unos minutos, mirar en el registro de sucesos `error-horizon` y `alarma-cobros`.

### Qué mirar cada día

1. `node scripts/cupones.mjs sueltos`. Lee antes los pagos nuevos y lista los pagos sueltos sin resolver y las órdenes pagadas a medias. Si dice que Horizon no contestó, lo que muestra es lo que ya se sabía.
2. `estado` (arriba): `pagosSueltos` (los que faltan resolver), `ventaPausada`, `creditos`, `piso` y `margen`. Un paquete pagado sube el piso 40 créditos por cada sorteo (`CREDITOS_POR_SORTEO`), y 30 más mientras la cuenta no se active (`CREDITOS_POR_ALTA`). Si `margen` no alcanza para un paquete, la orden nueva da `503 altas-pausadas` y el sitio dice que ese paquete no se vende ahora. Las órdenes que ya existen se siguen pagando.
3. La cuenta de cobros en un explorador (por ejemplo stellar.expert): su saldo de USDC tiene que ser lo cobrado menos lo devuelto.

### Los pagos sueltos

Un pago que llegó a `CUENTA_COBROS` y no se pudo atar a una orden, o la parte que sobró de uno. Nunca se pierde y nunca sirve dos veces. `sueltos` muestra de cada uno la operación, la cantidad y la moneda, el motivo, la nota, la orden si la tiene, la fecha, la cuenta que lo mandó y la transacción.

| Motivo | Qué pasó | Qué se hace |
|---|---|---|
| `sin-nota` | Llegó USDC sin nota | Si la persona escribe y se comprueba que es suyo (se le pide la cuenta desde la que pagó o el enlace de la transacción, y tiene que coincidir con lo que muestra `sueltos`), se asigna a su orden abierta. Si no, se devuelve |
| `nota-desconocida` | La nota no es de ninguna orden: mal escrita, o de otra cosa | Lo mismo que `sin-nota` |
| `repetido` | Llegó a una orden que ya estaba pagada, por ejemplo porque la app guardó la nota de la vez anterior | No da otro paquete. Si la persona lo pide, se asigna a otra orden abierta suya (la de un paquete para sumar, que ella pide en el sitio). Si no, se devuelve |
| `cerrada` | Llegó a una orden que se cerró para devolver | Se devuelve, o se asigna a la orden nueva de esa persona |
| `sobrante` | Lo que pasó del monto de una orden | Solo se devuelve |
| `otro-activo` | Llegó XLM, un USDC que no es el de Circle u otra moneda | Solo se devuelve, en la misma moneda |
| `costo-retiro` | El costo de un retiro que pagó el portero, reconocido por su transacción | Nada: es un cobro, no un suelto. Queda en `cobrado` y no se lista |

Un suelto de exactamente el costo de un retiro, que viene de una cuenta que hizo otro pago en la misma transacción, es el costo de un retiro y no se devuelve ni se asigna. Con el reconocimiento por la transacción no debería aparecer: si aparece, falló ese reconocimiento y se avisa.

Asignar: `node scripts/cupones.mjs asignar --operacion <operación> --orden <id>`. Ata el pago a una orden abierta. Si con eso llega al 95 %, la orden queda pagada y da sus sorteos, y lo que sobre vuelve a los sueltos como `sobrante`. A una orden pagada o cerrada no se asigna nada: contesta `409 orden-pagada` u `orden-cerrada` y el suelto queda como estaba.

**La regla para asignar a mano.** Un suelto se asigna solo con una de estas dos pruebas, nunca por lo que la persona cuente:

1. La constancia de retiro del exchange o de la app, con el hash de la transacción, y ese hash coincide con el `tx` que muestra `sueltos`.
2. Si no tiene el hash: el monto exacto, la hora al minuto y la cuenta de cobros a la que mandó, y las tres coinciden con el suelto.

Y solo a una orden de esa misma persona creada **antes** de la hora del pago. Con la venta por unidad prendida, el portero lo exige solo: una orden creada después del pago contesta `409 orden-posterior` y el suelto queda como estaba. Sin la venta por unidad se mira a mano, comparando la fecha del suelto con la `creada` de la orden en el exporte. **Ante la duda, se devuelve**: un pago devuelto a su cuenta nunca es una pérdida, uno asignado a quien no era sí.

Con la venta por unidad, además, un pago sin orden de menos de 0,50 USDC (o de menos de 1 unidad de otra moneda) no aparece en `sueltos`: es basura de quien manda centavos a cualquier cuenta. Solo se cuenta, en `estado`, como `cobros.pagosChicosHoy`. Si alguien dice que mandó menos de 0,50 por error, se mira la cuenta de cobros en un explorador y se decide a mano.

### Cómo se devuelve

Siempre en este orden, para que nada se devuelva dos veces ni una orden se complete con plata ya devuelta:

1. **Qué se devuelve.** Un pago suelto: la operación, la cantidad, la moneda y la cuenta `de`, de `sueltos`. Un pago a medias que la persona no va a completar: primero se cierra la orden con `node scripts/cupones.mjs cerrar --orden <id> --ref devolucion-0001`, que lee antes los pagos nuevos y dice cuánto devolver y a qué cuenta, pago por pago. Si contesta `409 orden-pagada`, se completó en el medio y no hay nada que devolver. Con `502 red`, Horizon no contestó y no se cerró: se prueba más tarde. Lo que llegue después con esa nota queda en sueltos como `cerrada`.
2. **A dónde.** A la cuenta `de`, salvo que sea la de un exchange (una cuenta que recibe de mucha gente y pide una nota de depósito). En ese caso se le pide por correo a la persona su dirección y su nota de depósito antes de mandar: sin esa nota el exchange no sabe de quién es y la devolución se pierde.
3. **Mandar.** Desde `CUENTA_COBROS`, la misma cantidad y la misma moneda, con la app donde está su llave y, si hace falta, la nota del exchange. La comisión sale de los XLM de esa cuenta: que no baje de 2 XLM.
4. **Marcar.** Un suelto: `node scripts/cupones.mjs devuelto --operacion <operación> --ref devolucion-0001`. Una orden cerrada no se marca: cerrarla ya la deja devuelta.
5. **Avisar.** Se le contesta a la persona con el enlace de la transacción.

La referencia (`--ref`) es lo que después explica el movimiento en el exporte: letras, números, puntos, guiones o guiones bajos, hasta 64, empezando por una letra o un número, y una distinta por devolución. Lo comprado y concedido no se devuelve, salvo que algo falle de nuestro lado (así lo dicen los términos).

### Pausar la venta

```bash
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/admin/ventas/pausar      # {"ventaPausada":true}
curl -fsS -X POST -H "Authorization: Bearer $T" $P/v1/admin/ventas/reanudar    # {"ventaPausada":false}
```

Frena las órdenes nuevas (`503 venta-pausada`), sin desplegar. Las órdenes abiertas se siguen pagando y los pagos se siguen reconociendo. Se pausa si algo no cierra en los números, si `margen` se acerca a cero y, la primera semana, al llegar a 30 paquetes vendidos, para mirar los números reales (firmas por sorteo y créditos gastados contra lo cobrado) antes de reanudar.

### La prueba con plata de verdad

El código del pago no se puede probar en la red de prueba: Horizon, el USDC de Circle y las rutas del pago son solo de la red principal. Antes de abrir la venta al público, alguien del proyecto compra el primer paquete con plata de verdad, con los dos despliegues ya hechos: el primero con `CUENTA_COBROS` cargada y `ALTAS_PAGO = "0"`, que tiene que dejar `sueltos` vacío y `pagosSueltos: 0` (si no, la cuenta tenía historia), y el segundo con `ALTAS_PAGO = "1"`.

Hace falta una vista previa del sitio con `VITE_ALTA=1`, `VITE_ALTA_PAGO=1` y `VITE_PATROCINIO_URL_MAINNET=https://pm.tinkazo.app`, un correo que nunca entró al modo Oficial (una cuenta no se activa dos veces) y unos 8 USDC en una app que deje escribir una nota de texto. En los pasos, M es el precio del primer paquete en `PRECIOS` y el mínimo es su 95 %: con 4 USDC, 3,80.

1. **Lo de antes.** Anotar de `estado` `creditos`, `piso`, `margen`, `pagosSueltos` (0) y `ventaPausada` (`false`), y el saldo de USDC de `CUENTA_COBROS` en un explorador.
2. **Los precios.** `curl -fsS $P/v1/alta/precios` dice `"pago": true`, con `alta` (monto, sorteos y días de `PRECIOS`) y los paquetes. `precios.html` de la vista previa muestra la misma lista.
3. **La orden.** Entrar con el correo nuevo en el modo Oficial. En Dejá tu cuenta lista, el botón del primer paquete dice el precio de `/precios`. Al tocarlo, el panel muestra la cuenta, el monto y la nota. Anotar el id (la nota sin `tk:o:`). La cuenta tiene que ser `CUENTA_COBROS`, el monto M, y la nota tiene que vencer a las 72 horas (en Más detalles).
4. **La misma orden.** Cerrar la pestaña y volver a entrar: sale la misma orden, con la misma nota.
5. **Un pago a medias.** Mandar 1 USDC con la nota escrita en minúsculas. Ya pagué dice que llegó 1 de M, y `sueltos` muestra la orden entre las pagadas a medias, con su mínimo.
6. **El resto.** Mandar lo que falta hasta el mínimo (con 4 USDC, 2,80) con la misma nota. La pantalla pasa sola a Recibimos tu pago, y Activar mi cuenta sigue como con un cupón. `/v1/patrocinio/cupo?cuenta=G…` dice `oficial.acceso: true` con los sorteos del paquete, y en `estado` el `piso` subió.
7. **Sin nota.** Mandar 0,10 USDC sin nota. `sueltos` lo muestra con motivo `sin-nota`. Devolverlo y marcarlo con `devuelto`. `pagosSueltos` vuelve a 0.
8. **Repetido.** Mandar 1 USDC con la nota de la orden ya pagada. `sueltos` lo muestra como `repetido`, con la orden, y el cupo no cambia. Devolverlo y marcarlo.
9. **Cerrar.** En el sitio, Sumar sorteos y el paquete para sumar: sale otra orden, con otra nota. Mandar 1 USDC con esa nota y cerrarla con `cerrar`, que dice que hay que devolver 1 USDC a la cuenta que pagó. Devolverlo. `POST /v1/alta/pago` de esa orden contesta `410 orden-cerrada`.
10. **Un sorteo.** Sellar una lista de 3 nombres y sortear con esa cuenta: el cupo baja uno.
11. **El registro.** Desde `workers/patrocinio`, `npx wrangler@4.160.0 tail --config wrangler.toml --env mainnet` durante la prueba: `alta-orden` (dos), `alta-pago` con `producto: "alta"`, `pago-suelto` con `sin-nota` y con `repetido`, `admin-suelto` (dos) y `admin-cerrada`. Ningún `error-config` ni `error-horizon`.
12. **La plata.** En el explorador, a `CUENTA_COBROS` entraron 5,90 USDC (con 4 de precio) y salieron 2,10. Quedan 3,80, lo cobrado por el paquete.
13. **El exporte.** `GET /v1/patrocinio/exportar`, guardado fuera del repositorio: la orden pagada con `metodo` `usdc`, la cerrada con `devuelta` y los dos sueltos con `estado` `devuelto`.

Se da por buena si cada paso dio lo dicho y el saldo de la cuenta de cobros coincide con lo cobrado. Si algo falla, se pausa la venta y se mira. Para apagarlo del todo, `ALTAS_PAGO = "0"` y desplegar: las órdenes que ya existen se siguen leyendo y pagando.

**Pagar con el saldo**, solo con `VITE_PAGO_CON_SALDO=1` en la vista previa. Con una cuenta de Google ya activada que tenga dólares digitales, Sumar sorteos dice cuánto hay en la cuenta y ofrece Pagar con mi saldo, y la confirmación dice el precio de la orden y a quién se paga. Después de pagar, en la consola del navegador no tiene que aparecer `[tinkazo] pago con saldo no aprobado` ni `no enviado`. En el explorador, la transacción va envuelta y la paga la cuenta del proveedor de la billetera, con una sola operación de pago desde la cuenta de la persona a `CUENTA_COBROS`, por el monto y con la nota de la orden. La pantalla pasa sola a Recibimos tu pago. Anotar cuántos créditos bajaron por ese pago. Si algo de esto falla, se vacía `VITE_PAGO_CON_SALDO` y se sube el sitio: el pago desde otra app sigue igual.

**El modo premios (`VITE_RAMPA=premios`).** Es del build. La ventana de los dólares digitales deja ver el saldo y recibir un premio, Mandar se niega en el código y una cuenta de Google o de correo en la red principal que ya puede guardar un premio (la línea del dólar digital de Circle, con cualquier saldo, o cualquier otra línea con saldo) no sella ni sortea: ofrece otra cuenta o una billetera propia. El XLM de una cuenta de Google sigue bajo el riesgo aceptado del 11 de noviembre y no entra en la puerta: cualquiera puede mandarle XLM a una cuenta sin su permiso (la dirección de quien organiza es pública desde que sella), y frenar por eso lo dejaría sin poder sellar ni sortear ese día. No va junto con la venta: el build no sale con `VITE_PAGO_CON_SALDO=1` ni con `VITE_COMPRA_QR=1`, y dice cuál de las dos sobra. Como la venta se abrió el 13 de noviembre de 2026, antes de agregar `VITE_RAMPA=premios` en Vercel hay que apagar esas dos banderas en la misma publicación, o el despliegue falla antes de armar nada (no rompe lo que ya está publicado). La regla de la línea suelta que avisa de un acceso extra se midió el 18 de noviembre de 2026 en una cuenta de Google real de la red principal: trae su sola llave (peso 1), umbrales en 0 y ningún otro firmante, así que el aviso no sale en una cuenta que nació con la activación. Es una sola cuenta: si algún día el aviso saliera en todas, leer otra en Horizon antes de seguir.

**La venta en piloto, en el sitio.** Las tres banderas de la venta (`VITE_ALTA_PAGO`, `VITE_PAGO_CON_SALDO` y `VITE_COMPRA_QR`) son del build y valen para todos los que abren ese build. Por eso, aunque estén prendidas, la venta está en piloto: se ve solo en un navegador que abrió el sitio con `?piloto=compra` en la dirección (queda guardado en ese navegador por seis horas y después vence solo, `?piloto=no` lo saca antes, y en los dos casos el parámetro sale de la dirección para que no pase a quien la copie). Un aparato que se usó para probar la compra no se usa para atender a otros mientras tenga la marca: antes, `?piloto=no`. Sin esa marca el sitio es el de las banderas apagadas: ni un botón, ni un texto, ni un pedido nuevo al portero, y `precios.html` y `terminos.html` quedan como hoy. Con la marca, Sumar sorteos aparece junto a la línea del cupo con cualquier cantidad de sorteos oficiales, no solo con 2 o menos. Quién compra de verdad lo sigue decidiendo el portero con su lista del piloto (`COMPRAS_QR_PILOTO` o `cupones.mjs piloto`): la marca del navegador no da permiso de nada. `VITE_VENTA_ABIERTA=1` saca el piloto y deja la venta a la vista para todos. No va antes de abrir la venta en el portero, y con ella la publicación de producción vuelve a pedir que las páginas digan la compra (`src/alta-textos-con-cobro.ts`). Todo esto vive en `src/stellar/venta-piloto.ts`, la única puerta por la que se leen las tres banderas.

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
   | `PORTERO_TOKEN_LECTURA` | Opcional, y solo después de que el portero ya la tenga: mirar «La clave de solo lectura del portero: en qué orden se carga», más abajo. Es la clave de solo lectura del portero (issue #219): abre apenas `GET /v1/patrocinio/estado`. El vigilante y el flujo de GitHub la usan si está cargada. Sin ella usan la de operar como siempre. `npx wrangler@4.160.0 secret put PORTERO_TOKEN_LECTURA` |
   | `PORTERO_ADMIN_TOKEN` | La clave de operar del portero de mainnet: el mismo valor que su `ADMIN_TOKEN` (el que el flujo de GitHub guarda como `PORTERO_MAINNET_ADMIN_TOKEN`). `npx wrangler@4.160.0 secret put PORTERO_ADMIN_TOKEN` |
   | `AVISAR_A` | La dirección verificada del paso 1. Si son varias, separadas por comas. `npx wrangler@4.160.0 secret put AVISAR_A` |
   | `TELEGRAM_BOT_TOKEN` | Opcional. El bot que se crea hablando con BotFather en Telegram. `npx wrangler@4.160.0 secret put TELEGRAM_BOT_TOKEN` |
   | `TELEGRAM_CHAT_ID` | Opcional. El número del chat al que escribe el bot (se le manda un mensaje al bot y se mira en `getUpdates`). `npx wrangler@4.160.0 secret put TELEGRAM_CHAT_ID` |

   Telegram queda apagado si falta cualquiera de los dos. La dirección de aviso no se escribe en el repositorio. Cada `secret put` publica una versión nueva del Worker en el momento.

### La clave de solo lectura del portero: en qué orden se carga

La clave de solo lectura (issue #219) deja que el vigilante y el flujo de GitHub miren `estado` sin tener la clave que puede apagar el portero. Son tres lugares y **el orden importa**: si el vigilante o GitHub tienen la clave antes de que el portero la conozca, el portero contesta `401` a cada vuelta y la vigilancia avisa de una caída que no existe: en el vigilante llega «Al vigilante le falta la clave del portero» y en GitHub el flujo dice que el portero no contestó bien. Hace falta la palabra de quien mantiene el proyecto, y no se hace antes de los eventos ni durante uno: cargar un secreto del portero publica una versión nueva del Worker en el momento.

1. **En el portero.** Desde `workers/patrocinio`, una clave nueva de 32 caracteres o más y **distinta** de la de operar (por ejemplo `openssl rand -hex 32`): `npx wrangler@4.160.0 secret put TOKEN_LECTURA --env mainnet`. Antes de seguir, comprobar con la clave nueva: `GET /v1/patrocinio/estado` tiene que dar `200`, y `POST /v1/patrocinio/apagar` tiene que dar `401` sin apagar nada. Si el `estado` da `401`, no seguir. En el registro del portero no tiene que aparecer `claves-iguales`.
2. **En el vigilante.** Desde `workers/vigilante`: `npx wrangler@4.160.0 secret put PORTERO_TOKEN_LECTURA`, con el mismo valor. Esperar la vuelta siguiente (diez minutos): la ruta pública tiene que seguir mostrando `salioBien: true`.
3. **En GitHub, al final.** El secreto `PORTERO_MAINNET_TOKEN_LECTURA`, en el Environment `vigilancia` (el mismo lugar donde está `PORTERO_MAINNET_ADMIN_TOKEN`). Después, lanzar una vez a mano `vigilar-portero.yml` desde `main` y mirar que lea `estado`.

Para volver atrás, en cualquier momento y sin tocar el portero: borrar `PORTERO_TOKEN_LECTURA` del vigilante (`npx wrangler@4.160.0 secret delete PORTERO_TOKEN_LECTURA`) y el secreto de GitHub. Los dos vuelven a usar la clave de operar, que sigue abriendo todo. Si el vigilante ya avisó que le falta la clave, a la vuelta siguiente llega el «Arreglado». Para sacar la clave de lectura del portero, primero se borra de los otros dos y al final del portero, en el orden contrario.

El mismo orden vale para el aviso de la red (issue #220): el portero va antes que el vigilante, porque el vigilante lee del portero la línea base en `GET /v1/patrocinio/linea-base`. Sin ella el paso de la red no mira nada y lo deja en el registro como `protocolo-sin-base`.

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
| **Créditos de Pollar bajo las compras en curso: cargá ya** | Los créditos no cubren el piso más lo que reservan las compras con QR en curso (`reservasCompras` en `estado`): los canjes de cupones y las compras nuevas ya se frenaron, y a quien tiene su dinero en camino le puede faltar un paso | Cargar créditos en el panel de Pollar ya. Una compra que quedó a medias se anula con `cupones.mjs compra anular` (más arriba, La compra con QR) y suelta su reserva |
| **Créditos de Pollar bajos: cargá hoy** | Sobran menos de 1.000 créditos encima del piso y de lo reservado por las compras con QR en curso | Cargar créditos antes de que bajen del piso |
| **No se pueden leer los créditos de Pollar** | Pollar no contesta. Diez minutos se usa el último saldo y después los canjes nuevos se pausan solos | Esperar unos minutos, mirar `estado` y, si sigue, avisar a Pollar |
| **A la cuenta que paga casi no le queda saldo** | Queda menos de la mitad del nivel de alerta: sin saldo no se puede sellar ni sortear | Cargar XLM ya desde la cuenta fría, un tramo de 20 a 40 |
| **La cuenta que paga tiene poco saldo** | Está por debajo del nivel de alerta | Cargar XLM desde la cuenta fría, un tramo de 20 a 40 |
| **No se puede leer el saldo de la cuenta que paga** | No se pudo leer la cuenta | Mirar `estado`. Si el saldo está bien, esperar a la próxima vuelta |
| **Las altas están pausadas** | Alguien las pausó a mano y nadie puede canjear un cupón nuevo | Si fue a propósito, nada. Si no, `reanudar` (más arriba) |
| **Cobros de Pollar sin explicar** | Pollar cobró firmas de cuentas de Google que el portero no puede explicar: alguien firma por fuera del sitio | Pausar las altas y mirar `estado` (más arriba, "Cómo cortar") |
| **No se pueden comparar los cobros de Pollar** | Pollar no contestó la lista de cobros | Mirar `estado` y esperar |
| **Patrocinio de la app prendido en Pollar** | Algo del patrocinio de la app en Pollar que no está en `PATROCINIO_PERMITIDO` del portero está prendido y gasta créditos sin que el portero lo cuente. Lo permitido prendido no avisa | Apagarlo en el panel de Pollar |
| **No se puede leer el patrocinio de Pollar** | Pollar no contestó | Mirar `estado` y el panel de Pollar |
| **Una variable del portero está mal escrita** | `estado` trae `faltaAltas` con el nombre de una variable mal escrita o de un secreto que falta (por ejemplo `recargo-qr`, `compras-qr-piloto`, `reserva-carga-creditos` o `compras-qr-dia`). Lo que depende de esa variable quedó cerrado, aunque se haya querido abrir: con `reserva-carga-creditos` o `compras-qr-dia`, la venta entera. Con `columnas-nuevas` no es una variable: al arrancar no se pudo sumar una columna nueva y la venta quedó cerrada. El portero sigue pagando sellos y sorteos | Corregir la variable en `wrangler.toml` (o cargar el secreto) y desplegar de nuevo. La tabla de variables está más arriba, en La compra con QR. Con `columnas-nuevas`, no desplegar de nuevo a ciegas: exportar, mirar el `error-config` del registro y decidir con quien mantiene el proyecto |
| **El portero no contesta** | Dos vueltas seguidas (unos 20 minutos) sin respuesta de `pm.tinkazo.app` | Panel de Cloudflare, Workers, `tinkazo-patrocinio-mainnet`, y su registro. Si Cloudflare tiene una falla, esperar. Lo sellado no se pierde |
| **El portero contesta algo que no se entiende** | La respuesta de `estado` no tiene la forma de siempre | Mirar `estado` y el registro del Worker del portero |
| **El vigilante mira el portero equivocado** | El que contesta no dice ser el de mainnet | Revisar `PORTERO_URL` en `workers/vigilante/wrangler.toml` |
| **Muchas cuentas nuevas en una hora** | Pollar abrió más cuentas en los últimos 60 minutos que el umbral (`CUENTAS_UMBRAL`, 200, o el cupo del evento). Avisa una vez por oleada y no repite durante 60 minutos. Alguien podría estar creando cuentas con un guion | Pausar las altas del portero no frena esto: frena el canje de cupones y el alta de quien ganó, pero las cuentas las crea Pollar cuando alguien entra con Google. Mirar en el panel de Pollar quién entró en esa hora y cuántos créditos bajaron (cada cuenta nueva gasta unos 15 créditos, y 100 créditos son 1 dólar). Si no es una ola de gente de un evento, avisar a quien mantiene el proyecto: lo único que corta la creación está en el panel de Pollar (la aplicación de mainnet deja de crear la billetera al entrar, o se le sacan los dominios permitidos) y frena también a quien entra de verdad, así que lo decide quien mantiene el proyecto y se anota el valor de antes. Quien ya tiene cuenta sigue sellando y sorteando |
| **Muchas activaciones en una hora** | Hoy no sale: el aviso por activaciones está apagado hasta confirmar el nombre de ese cobro contra una lectura real de Pollar. Si se prendiera, vale lo mismo que el de cuentas nuevas | Pausar las altas del portero no frena esto: frena el canje de cupones y el alta de quien ganó, pero las cuentas las crea Pollar cuando alguien entra con Google. Mirar en el panel de Pollar quién entró en esa hora y cuántos créditos bajaron (cada cuenta nueva gasta unos 15 créditos, y 100 créditos son 1 dólar). Si no es una ola de gente de un evento, avisar a quien mantiene el proyecto: lo único que corta la creación está en el panel de Pollar (la aplicación de mainnet deja de crear la billetera al entrar, o se le sacan los dominios permitidos) y frena también a quien entra de verdad, así que lo decide quien mantiene el proyecto y se anota el valor de antes. Quien ya tiene cuenta sigue sellando y sorteando |
| **Muchas cuentas nuevas y activaciones en una hora** | Los dos motivos a la vez. Hoy no sale, por lo mismo | Pausar las altas del portero no frena esto: frena el canje de cupones y el alta de quien ganó, pero las cuentas las crea Pollar cuando alguien entra con Google. Mirar en el panel de Pollar quién entró en esa hora y cuántos créditos bajaron (cada cuenta nueva gasta unos 15 créditos, y 100 créditos son 1 dólar). Si no es una ola de gente de un evento, avisar a quien mantiene el proyecto: lo único que corta la creación está en el panel de Pollar (la aplicación de mainnet deja de crear la billetera al entrar, o se le sacan los dominios permitidos) y frena también a quien entra de verdad, así que lo decide quien mantiene el proyecto y se anota el valor de antes. Quien ya tiene cuenta sigue sellando y sorteando |
| **No se están contando las cuentas nuevas** | El portero contesta, pero dos vueltas seguidas (unos 20 minutos) no pudo contar las cuentas nuevas con la consulta de uso de Pollar (tardó de más, falló o contestó algo que no se entiende). Mientras tanto una ola de cuentas no avisa | Mirar `estado` y las cuentas nuevas en el panel de Pollar. Si hay un evento, vigilar las altas a mano hasta que vuelva el conteo |
| **Al vigilante le falta la clave del portero** | No tiene la clave, o el portero ya no la acepta (rotada, o la de solo lectura se cargó en el vigilante antes que en el portero) | Si hay una clave de solo lectura cargada que el portero no conoce: borrarla del vigilante (`npx wrangler@4.160.0 secret delete PORTERO_TOKEN_LECTURA`) y seguir el orden de «La clave de solo lectura del portero: en qué orden se carga». Si no: cargar de nuevo la de operar, `npx wrangler@4.160.0 secret put PORTERO_ADMIN_TOKEN` |
| **La red de Stellar cambió de protocolo (testnet o mainnet)** | La red subió de versión de protocolo y por lo menos un parámetro de costo ya no es el de la línea base guardada en el portero. Sale una vez por cambio, por correo y por Telegram si está prendido, con el antes y el luego de cada parámetro. Cuenta como avisado si llegó por al menos un canal | Leer el correo. Si el cambio es esperado: `node scripts/vigilar-red.mjs --actualizar-base --red <la red>`, subir `scripts/vigilar-red.base.json` y volver a desplegar el portero con la línea nueva (con la palabra de quien mantiene el proyecto, y no durante un evento). Si no se esperaba, mirar los costos del sello y del sorteo en `estado` y en las herramientas de la red antes del próximo evento. Mientras no se actualice la base, el aviso no se repite |
| **La red de Stellar cambió los costos (testnet o mainnet)** | El protocolo es el mismo, pero cambió algún parámetro de costo de Soroban (lo que cuesta sellar y sortear) | Leer el correo y, si el cambio es esperado, actualizar la base con `node scripts/vigilar-red.mjs --actualizar-base --red <la red>` y desplegar el portero con la línea nueva. Si el costo subió mucho, avisar a quien carga el saldo de la cuenta que paga, porque la comisión por sello sube con él |

Si las cifras de un correo dicen al menos junto a los cobros sin explicar, la lista de cobros de Pollar vino llena y la cifra puede quedarse corta: ese día, mirar `estado` a mano cada hora. Si dicen que los créditos se leyeron hace unos minutos, Pollar no está contestando y el portero usa el último saldo que leyó (hasta diez minutos, después los canjes nuevos se pausan solos).

Si el vigilante no puede leer su KV, no manda nada ni escribe, para no repetir avisos ni perder los pendientes: deja `error-kv` en su registro y la hora de la ruta pública deja de avanzar. Mirar el panel de Cloudflare.

Si el correo no llega pero el vigilante anda, el aviso queda pendiente y se reintenta en cada vuelta durante 24 horas. El registro dice por qué (`error-envio`, con el código de Cloudflare).
