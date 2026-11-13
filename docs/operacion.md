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

## La venta de paquetes y la carga con QR: variables y rutas

Las dos nacen apagadas en `[env.mainnet.vars]` de `workers/patrocinio/wrangler.toml`. Se prenden cambiando variables y desplegando, con la palabra de quien mantiene el proyecto y nunca el día de un evento. La columna Hoy es lo que dice ese archivo.

| Variable | Hoy | Qué hace |
|---|---|---|
| `ALTAS_PAGO` | `"0"` | Con `"1"`, las órdenes nuevas. Pide `CUENTA_COBROS`. Con `"0"` las órdenes que ya existen se siguen leyendo y pagando. Mientras haya una lista del piloto puesta, la orden nueva pide la cuenta en la lista (`503 fuera-del-piloto`): la lista está puesta con cuentas en `COMPRAS_QR_PILOTO` y también, con la variable vacía, con una sola cuenta sumada con `cupones.mjs piloto`. Sin ninguna lista (la variable vacía y nadie sumado a mano), cualquier sesión puede pedir una orden: `"1"` no va sin la lista. Una orden nueva no nace por debajo del piso, de lo reservado por las compras cargadas y de `RESERVA_CARGA_CREDITOS` |
| `CUENTA_COBROS` | `"GDMIGGM2J7GL24JL3UB5DLSTMMWFP5XTE3SDTTDZSPUFH7VMKFINKAO6"` | La cuenta nueva que recibe los pagos. Si repite `CUENTA_PATROCINADORA` o `CUENTA_SORTEADORA`, el pago queda apagado, nadie lee sus pagos y el registro dice `error-config` con `faltaAltas: ["cuenta-cobros-repetida"]` |
| `PRECIOS` | `"alta:4:3:90,p10:10:10:365"` | El primer paquete, 3 sorteos por 4 USDC para 90 días, y 10 sorteos por 10 USDC para un año. Sin el de 50. Vacía, valen estos mismos |
| `SORTEO_SERVIDOR` | `"0"` | Sigue apagado: la persona firma su sorteo. Por eso `CREDITOS_POR_SORTEO` queda en `"40"` |
| `CARGAS` | `"0"` | Con `"1"`, la carga con QR, mientras las altas no estén pausadas y los créditos pasen el piso más la reserva |
| `RESERVA_CARGA_CREDITOS` | `"8400"` | Los créditos libres por encima del piso que tiene que haber para que la carga siga abierta, para que empiece una compra y para que nazca una orden nueva. La semana del evento va en 8400, lo que piden las tarjetas sin canjear: ninguna compra ni orden se come eso, y el canje de una tarjeta sí puede usarlo. El lunes vuelve a `"400"`. **Solo dígitos**, sin punto ni espacio: `"8400"`. Mal escrita (`"8.400"`, `"8 400"`, `"8,400"`) cierra la venta entera (ni orden nueva, ni carga, ni compra) y el estado dice `faltaAltas: ["reserva-carga-creditos"]`, también con la venta cerrada |
| `COMPRAS_QR` | `"0"` | Con `"1"`, la compra de un paquete pagando con QR. Pide además `ALTAS_PAGO` y `CARGAS` en `"1"`, `POLLAR_FONDEO` en `"inmediato"` y `RECARGO_QR` bien escrito. Con `"0"` no empieza ni carga ninguna compra nueva, y lo que ya está en camino se termina igual |
| `COMPRAS_QR_DIA` | `"0"` | Cuántas compras con QR se pueden empezar por día (UTC) entre todas las personas. Cuenta cada compra que se da, también un cambio de producto. Renovar la misma no cuenta. Además, cada persona empieza como mucho 3 por día. Con `"0"`, ninguna. **Solo dígitos**: mal escrita (`"6.0"`, `"seis"`) cierra la venta entera y el estado dice `faltaAltas: ["compras-qr-dia"]` |
| `COMPRAS_QR_PILOTO` | `""` | Las cuentas G del piloto, separadas por coma, además de las que se suman con `cupones.mjs piloto`. Vacía, nadie más que las sumadas a mano. Una mal escrita o mal copiada, o cualquier otra palabra, cierra la compra con QR entera (`503 compras-cerradas`, también para las sumadas a mano) y el estado dice `faltaAltas: ["compras-qr-piloto"]`. `"todos"` también la cierra, salvo que se pida además con `COMPRAS_QR_TODOS = "1"`: no va antes del evento. La lista vale también para la orden en dólares digitales: con cuentas en la variable, o con la variable vacía y una sola cuenta sumada a mano, una orden nueva pide la cuenta en la lista (la de la variable o una sumada a mano) y, si la variable está mal escrita, no nace para nadie (`503 fuera-del-piloto`). Con la variable vacía y nadie sumado a mano, la orden no mira la lista. Quien ya tiene una compra cargada saca su orden igual |
| `COMPRAS_QR_TODOS` | no está | Solo `"1"` deja que `"todos"` en `COMPRAS_QR_PILOTO` abra la compra con QR a cualquier cuenta. Es la confirmación explícita de abrir a todos |
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
- **No vaciar `VITE_ALTA` en Vercel antes de revertir los textos.** Las páginas de lectura dicen que con un cupón de evento el modo Oficial es gratis, y la publicación de producción (`VERCEL_ENV=production`) no sale sin `VITE_ALTA=1` (`src/stellar/alta-build.ts`): con la variable vacía el build falla y queda la publicación anterior. Para quitar el acceso por cupón, primero se revierte el commit que puso esos textos y después se vacía la variable.

## La venta de paquetes, día a día

Con el pago prendido (`ALTAS_PAGO = "1"` y `CUENTA_COBROS` cargada), quien entra con Google o con su correo en el modo Oficial puede comprar un paquete de sorteos oficiales. El portero no mueve plata: crea la orden, lee en Horizon lo que llega a `CUENTA_COBROS` y da los sorteos cuando el pago alcanza. Devolver lo hace a mano quien tiene la llave de `CUENTA_COBROS`. Las órdenes, los pagos sueltos y las devoluciones se atienden con la clave de cupones (`scripts/cupones.mjs`). Pausar la venta, con la clave de operar.

### Una orden

Nace cuando la persona toca el paquete en el sitio (`POST /v1/alta/orden`). Hay una abierta por persona y por producto: pedirla otra vez devuelve la misma.

| Campo | Qué es |
|---|---|
| `id` | 8 letras y números del alfabeto de los cupones, al azar (`ABCD2345`) |
| `nota` | `tk:o:` y el id. Es lo que la persona pone como nota de texto del pago. Se lee como un cupón: sin espacios ni guiones, en mayúsculas, la O por 0 y la I o la L por 1 |
| `memoId` | El mismo id como número, para un exchange que solo acepta notas numéricas. El sitio no la muestra: se da por correo a quien la pida |
| `producto`, `usdc`, `sorteos`, `dias` | Lo que se vende y su precio, fijos desde que nace la orden (los de `PRECIOS` ese día) |
| `destino` | `CUENTA_COBROS` |
| `vence` | 72 horas después de nacer. Si ya llegó una parte, se renueva con la misma nota hasta 30 días. Un pago que llega tarde igual vale |

La orden queda pagada cuando llega al menos el 95 % del monto (lo que `sueltos` llama `minimo`), en uno o en varios pagos con su nota, y en esa misma lectura da los sorteos: vencen a los `dias` de la orden, contados desde ese momento. No importa desde qué cuenta se paga.

En el exporte (`GET /v1/patrocinio/exportar`), la tabla `ordenes` suma `usuario` (el identificador de Pollar), `creada`, `pagada` (cuándo), `metodo` (`usdc` si se reconoció sola, `devuelta` si se cerró para devolver, `reemplazada` si la cerró el aviso de una compra con QR o una anulación) y `ref`. Cada pago atado a una orden está en `pagos`, con la cuenta que lo mandó (`de`) y su transacción (`tx`). Los montos de esas tablas van en diezmillonésimas: 4 USDC es `40000000`.

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

Asignar: `node scripts/cupones.mjs asignar --operacion <operación> --orden <id>`. Ata el pago a una orden abierta. Si con eso llega al 95 %, la orden queda pagada y da sus sorteos, y lo que sobre vuelve a los sueltos como `sobrante`. A una orden pagada o cerrada no se asigna nada: contesta `409 orden-pagada` u `orden-cerrada` y el suelto queda como estaba.

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
| **Al vigilante le falta la clave del portero** | No tiene la clave de operar, o el portero ya no la acepta (rotada) | Cargarla de nuevo: `npx wrangler@4.160.0 secret put PORTERO_ADMIN_TOKEN` |

Si las cifras de un correo dicen al menos junto a los cobros sin explicar, la lista de cobros de Pollar vino llena y la cifra puede quedarse corta: ese día, mirar `estado` a mano cada hora. Si dicen que los créditos se leyeron hace unos minutos, Pollar no está contestando y el portero usa el último saldo que leyó (hasta diez minutos, después los canjes nuevos se pausan solos).

Si el vigilante no puede leer su KV, no manda nada ni escribe, para no repetir avisos ni perder los pendientes: deja `error-kv` en su registro y la hora de la ruta pública deja de avanzar. Mirar el panel de Cloudflare.

Si el correo no llega pero el vigilante anda, el aviso queda pendiente y se reintenta en cada vuelta durante 24 horas. El registro dice por qué (`error-envio`, con el código de Cloudflare).
