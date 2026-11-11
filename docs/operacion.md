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
9. **La vigilancia por hora, con su clave en el Environment.** El workflow `vigilar-portero.yml` mira `estado` cada hora y manda un correo cuando aparece un problema nuevo o uno que empeora (y una vez por día mientras siga el mismo). Su registro es público y no lleva cifras: dice qué problemas hay, y las cifras se miran en `estado`. Una corrida a mano o repetida falla siempre que haya un problema, aunque ya se haya avisado: sirve para comprobar que se arregló. Es el respaldo de la mirada a mano de abajo, no la alarma. Necesita el Environment `vigilancia` de GitHub, con las ramas elegidas y solo `main`, y la clave de operar cargada ahí como `PORTERO_MAINNET_ADMIN_TOKEN`, sin copia entre los secretos del repositorio. Los pasos están en [workers/patrocinio/README.md](../workers/patrocinio/README.md), en «La vigilancia del portero de mainnet».
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

Durante el evento no se toca Pollar ni ninguna bandera del sitio o del portero.

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

- **B1, el portero listo y la pantalla del cupón no.** El portero con el libro y la administración, y un build del sitio con `VITE_ALTA_LIBRE=1` y `VITE_ALTA` apagada (el build no sale con las dos). Los equipos que pasan por la mesa le dictan su dirección a quien opera, que los admite con `cupones.mjs admitir`. Cualquiera que entre a Oficial y toque «Activar» cuesta 20 créditos; sellar sigue cerrado para quien no está en el libro.
- **B2, sin portero de mainnet.** Oficial solo con billetera propia; los equipos sortean gratis en Prueba. Las tarjetas se guardan para el próximo evento: se anula el lote y se crea otro con la fecha nueva.
- **B3, último recurso y solo con la palabra de quien mantiene el proyecto.** La regla de contrato de Pollar para `seal` y `draw` del contrato de mainnet, con solo los créditos del día cargados, porque no tiene tope por cuenta. Se borra al terminar.

## Qué no hacer

- **No desplegar durante el evento.** Un despliegue reinicia el objeto: la memoria de sesiones y los contadores de intentos vuelven a cero y todos pasan a ser «nuevos».
- **No rotar `CUPON_SECRETO` con cupones vivos.** Cambiarlo anula todos los cupones que no se canjearon.
- **No dejar iguales la clave de operar y la de cupones.** Si son iguales, lo de cupones no se atiende (`503 claves-iguales`).
- **No pegar una clave en un comando, un chat o una captura.** Van en variables de entorno.
- **No desplegar sin `--env mainnet` ni sin `--config wrangler.toml`.** Sin `--env` se despliega el portero de Prueba en `p.tinkazo.app`; sin `--config`, wrangler puede tomar otro `wrangler.json` que encuentre hacia arriba. Y siempre con la versión probada de wrangler (4.160.0), no la última del día.
- **No cargar toda la plata en la cuenta que paga.** La llave del Worker solo puede gastar comisiones, pero hasta lo cargado.
- **No dejar las tarjetas boca arriba ni sacarles foto.**
