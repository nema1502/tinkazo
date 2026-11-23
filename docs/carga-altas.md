# Ensayo de carga de una campaña con el proveedor simulado

Issue [#179](https://github.com/tinkazo/tinkazo/issues/179), S1 y S2: 150 altas desde un mismo grupo de conexión contra el servicio de pruebas, con el proveedor de cuentas simulado, y el proveedor cortado a propósito en medio de las altas. El guion vive en `scripts/carga-altas.mjs` y solo llama a la API del servicio: no cambia `src/campana`, `src/ui/campana-sala.ts` ni `workers/sala`.

## Correrlo

```bash
node scripts/carga-altas.mjs
```

Corrida completa: 150 altas desde una sola conexión, un corte del proveedor después de 100 altas buenas, 5 altas con el proveedor caído, las mismas 5 vueltas a intentar cuando vuelve, y al final dos reingresos (`200 ya`) y un alta con la sala cerrada (`409 cerrada`). Sale un relato por pantalla y, última línea, un JSON con los conteos por código. Sale con código 0 solo si todo cuadra: el total de la sala coincide con las altas buenas y el corte se recupera entero.

| Bandera | Defecto | Qué hace |
| --- | --- | --- |
| `--altas=N` | `150` | Cuántas altas nuevas personas. |
| `--proveedor-cae-en=N` | `100` | Cortar el proveedor después de N altas buenas (0 lo apaga). |
| `--en-corte=K` | `5` | Cuántas altas se intentan con el proveedor caído. |
| `--espera-ms=N` | `25` | Pausa entre altas; `0` va al toque. |
| `--ip=X` | `190.129.10.20` | La única conexión desde donde salen las altas. |

## Cómo está armado

Corre el Worker de las salas **de verdad** (`workers/sala/src/index.ts`), montado como lo monta el mundo de pruebas (`src/sala/mundo-sala.ts`):

- Un cargador de módulos de Node puenta dos cosas al Worker: `cloudflare:workers` sale de `src/sala/cloudflare-falso.ts` (el `DurableObject` mínimo de las pruebas; en un Worker desplegado no entra nunca), y cada módulo de TypeScript del checkout se baja con el transformador de rolldown, que vite ya trae instalado (el guion no agrega dependencias).
- El estado de los objetos de sala lleva un SQLite en memoria de Node, igual que en el mundo de pruebas.
- El proveedor de cuentas (Pollar) es un `fetch` de mentira que contesta `/v3/tokens/verify` y `/v3/users`, con una sesión inventada por persona y una marca `caido` para el corte.
- Las campañas, las personas y las altas salen de los helpers exportados por `src/sala/mundo-sala.ts` (`campanaAbierta`, `personaDePrueba`, `altaDe`), reutilizados tal cual: el guion no reescribe ni una regla del servicio.

Cada alta pasa por el manejador `fetch` del Worker con la misma forma de pedido que manda el celular real: `POST /v1/sala/<id>/campana/alta` con `Origin` del sitio y `CF-Connecting-IP`, el cuerpo `{token, d, llave, p}` y un token distinto por persona, que el proveedor simulado verifica igual que haría Pollar. El nombre va cifrado con la clave del QR (`cifrarNombre` de `src/sala/cifra.ts`), la misma forma que cifraría la página del celular. Todas las altas salen de una sola IP (`CF-Connecting-IP` fija), y como el servicio cuenta por grupo de conexión, en la corrida es un solo grupo.

**Por qué no va contra `wrangler dev`**: el guion usa un proveedor de cuentas simulado, y las sesiones (tokens) nacen y viven en ese simulador. Con `wrangler dev`, el Worker llama a Pollar de verdad; los tokens inventados contestarían `401 sesion` y el ensayo mediría otra cosa. El servicio de pruebas de este ensayo es el mismo Worker, pero con el proveedor de mentira en el mismo proceso.

## Qué códigos contesta el servicio

La tabla es la que traduce el cliente del celular (`src/sala/campana.ts`, `leerAlta`). El guion cuenta cada respuesta por código; la corrida de defecto ve los marcados con ●, los otros dependen del estado de la sala o del tope que se alcance.

| Respuesta | Qué significa | Qué hace el celular |
| --- | --- | --- |
| ● `201 {cuenta}` | Alta nueva aceptada. | Muestra «Listo». |
| ● `200 {cuenta, ya}` | Esta persona ya estaba anotada (reingreso de otro celular o toque repetido). | Muestra «Listo, ya estabas». |
| ● `502 {"error":"pollar"}` | El proveedor no contestó (aquí, el corte a propósito). | Familia `pollar`: reintenta a los 5, 10 y 20 segundos; si el proveedor vuelve, `201`; si no, el final es `proveedor`. |
| `429 {"error":"rapido"}` | Más de 300 altas por minuto en la sala (`CAMPANA_POR_MINUTO`). | Familia `rapido`: 10, 20 y 30 s, estirada hasta el cambio de minuto. |
| `429 {"error":"llena"}` | La sala llegó a 300 anotadas (`CAMPANA_MAX`). | Final `llena`. |
| `429 {"error":"cupo-conexion"}` | La conexión gastó su tope de la ventana (400 altas nuevas o 800 envíos en 10 min) o su tope de reingresos. | Final `wifi`, con `Retry-After`. |
| `429 {"error":"rechazos"}` | 300 rechazos de la conexión, o 5 de una misma ficha, en la ventana. | Final `espera`, con `Retry-After`. |
| `409 {"error":"cerrada"}` | La sala ya no está abierta. | Final `cerro`. |
| `409 {"error":"pase"}` | El pase del enlace no vale. Solo con `PASE` distinto de `0`: en el servicio de pruebas está apagado, y por eso la corrida no lo ve. | Final `pase`. |
| `409 {"error":"sin-billetera"}` | La sesión no tiene cuenta de Stellar y no se le pudo crear. | Familia `creando`: dos reintentos y final `cuentas`. |
| `409 {"error":"quitada"}` | La persona salió de la lista. | Final `quitada`. |
| `401 {"error":"sesion"}` | El token de la sesión no vale o venció. | Final `sesion`: entrar de nuevo. |
| `403 {"error":"otra-app"}` | La sesión es de otra app o de la red de prueba. | Final `otro`: entrar de nuevo. |
| `400 {"error":"forma"}` | El cuerpo no tiene la forma esperada (token vencido, `d` o `llave` con mala forma). | Final `sesion`. |

Con los topes de defecto, una corrida de 150 altas de a una **no toca ningún tope de ritmo**: caben 400 altas nuevas por conexión en cada ventana de 10 minutos y 300 por minuto en toda la sala. Para ver el `429 rapido` de verdad habría que mandar más de 300 altas por minuto (con `--espera-ms=0` y en paralelo, que este guion no hace: deja el ensayo de a una, como el evento real).

## El corte del proveedor (S2)

Con `--proveedor-cae-en=N`, después de la alta N el guion pone `caido` en el proveedor simulado y lo que pasa es lo que un corte de Pollar produciría:

- **Lo que ve el celular**: el alta contesta `502 {"error":"pollar"}`. El cliente del celular lo traduce en la familia `pollar` de reintentos (5 s, 10 s, 20 s, con un poco de azar): quien tocó ve «Mucha gente...» y espera. Si el proveedor vuelve, el toque repetido contesta `201` y la persona queda anotada. Si no vuelve, el final es el motivo `proveedor`: «El servicio del evento está caído». En la corrida del guion, las K altas del corte ven el `502` y, con el proveedor de vuelta, cada una repite el MISMO alta (misma sesión y mismo nombre cifrado, como hace el celular) y contesta `201`.
- **Lo que ve el stand**: el contador de la sala (`GET /v1/sala/<id>/campana/estado`) se detiene mientras el proveedor está caído — la corrida mide que queda exactamente en N — y sube de a K cuando las personas reintentan con el proveedor de vuelta. Nadie queda afuera por el corte: el estado final es el mismo que sin corte.

**Qué error exacto aparece**: con el proveedor caído el único código del corte es `502 {"error":"pollar"}` (el Worker traduce la respuesta no entendida del proveedor en `pollar`, y `pollar` vale 502). El `401 sesion` no aparece en este escenario: ese código sale de un token vencido o rechazado por el proveedor, no de un corte. El `503 sin-pollar` tampoco: es el Worker sin el secreto de Pollar, no el proveedor caído. Los pedidos rechazados con `pollar` no suman al tope de rechazos de la conexión: repetir no deja a nadie sin tope.

## La corrida del 23 de noviembre

De la corrida completa (150 altas, corte en 100, 5 en corte, 25 ms de paso):

- Altas buenas: **150 de 150**. Sin ninguna rechazada por `rapido`, por `llena` ni por `cupo-conexion`.
- Corte del proveedor: 5 altas con `502 pollar`, las 5 vueltas a intentar y las 5 contestadas `201`.
- Sondas: 2 reingresos con `200 ya`, 1 alta con la sala cerrada con `409 cerrada`.
- Total que ve el stand: **150** al final, con el contador quieto en 100 mientras duró el corte.
- Duración: unos 7,5 segundos (con la pausa de 25 ms entre altas; sin pausa, 158 pedidos en menos de 2 s).

Respuestas por código de esa corrida: `201 alta` 150, `502 pollar` 5, `200 ya` 2, `409 cerrada` 1.

## Lo que queda del dueño

- **S3**: la prueba con equipos físicos (un Android, un iPhone y el navegador de una app) contra una campaña de verdad.
- **S5**: la lista completa de lo que pasó y lo que no, con su captura o su transacción; el guion produce el fragmento automatizado, pero el ensayo con el proveedor de verdad y con la campaña del evento va a mano.
- **S4** (las capturas del proyector y del celular): es otra tarea del mismo issue, con el wrapper Chromium de la VPS, y no la cubre este guion.
- El corte de proveedor medido aquí es el del simulador; con Pollar de verdad las esperas y los reintentos son los mismos códigos (`502 pollar`), pero el ensayo final del 26 con el proveedor real queda entre las pruebas del dueño.
