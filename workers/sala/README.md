# La sala del stand

Un Worker de Cloudflare en `s.tinkazo.app` para que la gente de un stand escanee un QR, escriba su nombre o apodo en el celular y lo vea aparecer en la pantalla grande. **Solo alimenta rondas de ejemplo** (el modo stand del sitio): esos nombres nunca van a un sorteo sellado ni a un comprobante. La única excepción son los **equipos de un evento** (ver [más abajo](#los-equipos-de-un-evento-registro-con-cuenta)): ahí lo que va a la lista sellada es la cuenta pública del equipo, que se anota con su consentimiento; el nombre del equipo y los de sus integrantes siguen cifrados y no salen de la sala.

Es un script aparte (`tinkazo-sala`) del de los enlaces (`tinkazo-enlaces`, en `workers/enlaces`), en la misma cuenta: un error de despliegue acá no puede tumbar los enlaces de los comprobantes. La cuenta, en cambio, comparte los 100.000 pedidos por día del plan gratis (ver [Plan y gasto](#plan-y-gasto)).

- **Lo que guarda son bytes cifrados.** El navegador de la pantalla genera una clave (AES-GCM, 16 bytes) y la pone en el QR, después del `#`: `s.tinkazo.app/<id>#<clave>`. El fragmento no llega a ningún servidor. El celular cifra el nombre con esa clave antes de mandarlo, así que el servicio no puede leerlo.
- **No guarda** nombres en claro, la clave del QR, la llave del celular, direcciones IP, navegador ni hora por persona. En las salas nuevas guarda una huella HMAC de cada nombre normalizado, calculada con una llave derivada de la clave del QR para rechazar repetidos sin poder probar candidatos, y solo la huella SHA-256 de la llave al azar del celular para reconocer sus correcciones. El celular sí recuerda localmente su llave y el nombre con que quedó, por sala y durante 12 horas como máximo. El token de la pantalla se guarda solo como huella SHA-256. Para contar las salas que arma cada dirección guarda, a lo sumo una hora, una huella de la dirección con una sal de esa hora (no se puede devolver a la dirección). Para el tope de altas de equipos por conexión, cada sala guarda una huella del grupo de dirección con una sal suya: queda hasta que se borra la sala, y las ventanas de 10 minutos que ya pasaron se limpian con cada envío.
- **Se borra solo:** una alarma a las 10 horas de creada hace `deleteAll()`; antes, «Cerrar la sala» hace lo mismo. Los nombres cifrados quedan en el objeto hasta entonces (no 5 minutos): una compu que se cuelga en una feria no puede perder la lista, y el servicio sigue sin poder leerlos.
- **Quitar un nombre** con un toque lo saca también del objeto.
- **El filtro de palabras corre en la pantalla** (`src/sala/filtro.ts`), no acá: ningún servidor lee los nombres. Lo que coincide queda en «Para revisar».

## La API

| Pedido | Qué hace | Límite |
| --- | --- | --- |
| `POST /v1/sala` | Crea la sala: `201 {"id", "token", "vence"}`. Solo desde `tinkazo.app`, `www`, las vistas de Vercel y `localhost` | 30 por dirección y por hora, 400 por día en total |
| `POST /v1/sala/<id>` | JSON `{"d","h","llave"}`: el nombre cifrado (base64url, de 30 a 256 bytes), su huella de 32 bytes y la llave del celular de 16 bytes, las dos en base64url sin relleno. `201 {"n"}` al anotarse; `200 {"n","r"}` al corregir. Cuerpo de hasta 700 bytes | 400 por sala; 240 por minuto por sala; cinco correcciones por celular |
| `GET /v1/sala/<id>/nombres?desde=N` | Los nombres cifrados desde `N`: `[{"n","d","r"?}]`. `r` trae los números que reemplaza una corrección. Con `Authorization: Bearer <token>`. Lo usa la pantalla al recargarse y, si el WebSocket se cae, cada 3 s | |
| `DELETE /v1/sala/<id>/nombres/<n>` | Saca un nombre. Con el token | |
| `GET /v1/sala/<id>/pantalla` | WebSocket hacia la pantalla. El token va en el primer mensaje (`{"t":"hola","token"}`), no en la dirección. Una pantalla a la vez: la que se presenta desplaza a la anterior (cierre 4000). Un token malo cierra con 4401 | hasta 6 sockets sin presentarse |
| `DELETE /v1/sala/<id>` | Cierra la sala y borra todo. Con el token | |
| `GET /<id>` | La página del celular: un HTML con su CSS y su JS adentro, en español y en inglés. Sin bajar el sitio, sin depender de Vercel y sin CORS | |

Mensajes del socket hacia la pantalla: `{"t":"listo","hay":N,"estado":...,"ronda":...}`, `{"t":"nombre","n","d","r"?}`, `{"t":"quitado","n"}`, `{"t":"ronda",...}` y `{"t":"lista-cerrada"}`. Un `ping` de texto se contesta solo con `pong` sin despertar al objeto.

### Una alta por celular y nombres únicos

En una sala de la **forma 2**, el alta exige `h` y `llave`; sin alguno contesta `400 {"error":"forma"}`. La primera vez entra con `201`. Si otro celular ya anotó el mismo nombre, sin distinguir mayúsculas, espacios de más ni caracteres invisibles, contesta `409 {"error":"repetido"}` y no cambia nada. La huella se calcula como HMAC-SHA-256 del nombre normalizado en UTF-8, con una llave que es SHA-256 de `Tinkazo/sala/huella-de-nombre/v1` más los 16 bytes de la clave del QR. Otra sala tiene otra clave y, por tanto, otras huellas.

Si la llave ya tiene una fila, el alta es una **corrección**: borra el número viejo e inserta uno nuevo, con `200`. La respuesta, el mensaje del socket y la consulta traen en `r` todos los números que ese celular tuvo antes. La pantalla quita primero esos números y después suma el nombre nuevo, incluso si perdió el WebSocket. Hay hasta cinco correcciones con cambio de nombre; la sexta contesta `429 {"error":"correcciones"}`. Volver a mandar el mismo nombre conserva el número, contesta `200`, no emite mensajes y no gasta una corrección. Si quien organiza quita la fila, se borran también las huellas y ese celular puede anotarse otra vez.

Al recargar, el celular muestra con qué nombre se anotó desde ese navegador, pero no afirma que el nombre siga en la pantalla: quien organiza pudo quitarlo o la sala pudo terminar. Es una decisión deliberada no consultar a la sala por ese estado, para no agregar una consulta que diga quién está anotado. El texto pide corregir el nombre o avisar a quien atiende si la persona no se ve.

Una sala creada antes de este cambio no tiene la marca `forma = 2` ni las columnas nuevas. Mientras viva (diez horas como máximo), acepta tanto el `text/plain` anterior con `d` solo como el JSON nuevo, del que usa únicamente `d`, y mantiene las reglas viejas: no reconoce al celular ni rechaza repetidos. No se migra su tabla.

### El flujo interactivo (juegos interactivos)

Además del stand, la misma sala sirve para que la gente viva el sorteo desde su celular (juegos interactivos, tipo Kahoot): la pantalla comparte la ronda que decide, cierra la lista y cada celular calcula su resultado personal.

| Pedido | Qué hace | Límite |
| --- | --- | --- |
| `PUT /v1/sala/<id>/ronda` | La pantalla comparte la ronda que decide: `{"r","randomness","listHash","k"}` (el número de 32 bytes en hex, la huella de la lista sellada y cuántos ganadores). Con el token. `204`. Se puede volver a mandar: la última es la que vale | 300 bytes |
| `POST /v1/sala/<id>/cierre` | Quien organiza cierra la lista desde la pantalla: con el token, `204`. Después ya no entra nadie (`409 {"error":"cerrada"}`) | |
| `GET /v1/sala/<id>/vivo?desde=N` | Sin token, lo que mira el celular del participante cada 3 s: `{"hay","estado","ronda","nombres"}`. Los nombres siguen cifrados (la clave viaja en el QR); el estado es `abierta` o `cerrada` y la ronda es la compartida, o `null` | |

Mensajes nuevos del socket hacia la pantalla: `{"t":"ronda","r","randomness","listHash","k"}` (la pantalla la volvió a compartir) y `{"t":"lista-cerrada"}`. Al presentarse, el `listo` trae además `estado` y `ronda`, así que la pantalla que se recarga se pone al día sin pedir nada más.

La privacidad no cambia: este servicio sigue sin poder leer nombres (solo bytes cifrados), y la ronda compartida no publica la lista: la huella y el número alcanzan para que cada celular, que ya descifró la lista con la clave del QR, calcule los ganadores con el mismo `select` del protocolo y vea si le tocó. La lista del celular tiene que ser exactamente la que se selló: si la huella no cuadra, la vista no afirma nada.


### Los equipos de un evento (registro con cuenta)

La misma sala sirve para que los equipos de un evento (Space Apps y parecidos) se anoten con su cuenta de Stellar desde el celular de su encargado: la página `equipos.html` del sitio (no la de este Worker) abre el QR, y habla con estos pedidos desde `tinkazo.app`. Detrás de la bandera `VITE_EQUIPOS` del sitio; el Worker no sabe de banderas: sin registro armado, nadie puede anotar nada (`409`).

| Pedido | Qué hace | Límite |
| --- | --- | --- |
| `PUT /v1/sala/<id>/config` | Quien organiza arma el registro: `{"modo","evento","cuenta"}`. `modo` es `cupon` (el equipo queda anotado y recibe el cupón gratis) o `sorteo` (pide participar, quien organiza lo acepta y tiene que haber hecho un sorteo con su cuenta). Con el token. `204` | 1.000 bytes |
| `GET /v1/sala/<id>/publico` | Sin token: `{"config","equipos"}` (cuántos hay). Es lo que lee la página del celular antes de pedir nada | |
| `POST /v1/sala/<id>/equipos` | `{"cuenta","d","llave"}`: la cuenta `G…` en claro (es pública), los datos del equipo cifrados con la clave del QR (de 30 a 1.100 bytes) y la llave del celular (ver abajo). Solo desde el sitio. `201 {"n","estado"}`; con la misma cuenta y la misma llave cambia los datos y conserva el número y el estado; con otra llave, `409 {"error":"ajena"}` y no cambia nada. Sin llave o con una mal formada, `400` | 200 por sala; 120 por minuto por sala, con una ventana propia e independiente de la de nombres; por conexión, 60 equipos nuevos y 300 envíos cada 10 minutos (`429 {"error":"cupo-conexion"}` con `Retry-After`) |
| `GET /v1/sala/<id>/equipos?desde=V` | Con el token: los equipos que cambiaron desde la versión `V` (`[{"n","cuenta","d","estado","v"}]`). `v` sube con cada alta o cambio de estado | |
| `GET /v1/sala/<id>/equipos/<cuenta>` | Sin token: `{"n","estado"}` de ese equipo, o `404`. Lo pregunta el celular del encargado cada 15 s mientras la página está a la vista | |
| `PUT /v1/sala/<id>/equipos/<n>` | Con el token: `{"estado"}`, uno de `solicitud`, `aceptado`, `sorteo`, `cupon`. `204` | |
| `DELETE /v1/sala/<id>/equipos/<n>` | Con el token: saca un equipo. `204` | |

Mensajes nuevos del socket: `{"t":"equipo","v","n","cuenta","d","estado"}` (alta o cambio) y `{"t":"equipo-quitado","n"}`. El nombre del equipo y los de sus integrantes nunca llegan en claro: la cuenta es lo único que este servicio ve de un equipo. Una sala creada antes de este cambio no tiene la tabla de equipos; se crea al configurar el registro. Se borra con la sala (10 horas, o «Cerrar la sala»).

#### La llave del celular: nadie pisa el registro de otro equipo

La dirección de una cuenta es pública (se ve en la pantalla y en la red), así que no alcanza para decidir quién puede cambiar los datos de un equipo. En la primera alta, la página del celular inventa una llave (16 bytes al azar, en base64url, `llaveDelCelular` en `src/equipos/celular.ts`), la guarda en ese navegador (una por sala, las últimas ocho) **antes** de mandarla, y la manda con el alta. La sala guarda solo su huella SHA-256 junto al equipo (`workers/sala/src/registro.ts`) y nunca la devuelve.

- Para volver a mandar esa cuenta (corregir los nombres, reintentar después de un corte) hay que presentar la misma llave. Sin ella, `409 {"error":"ajena"}`, el equipo queda como estaba y la pantalla no recibe nada.
- El celular que recarga la página o vuelve más tarde tiene la llave en su navegador: ve su estado (eso no pide llave: `GET /equipos/<cuenta>` es público, como la cuenta) y puede corregir sus datos.
- Un equipo que perdió el celular o borró el navegador ve «Esta cuenta ya está anotada desde otro celular. Pedile a quien organiza que la quite de la lista y volvé a anotarte.». Quien organiza lo quita con su token (`DELETE /equipos/<n>`, el botón «Quitar» de su pantalla): la fila se va con la huella y la cuenta queda libre para anotarse desde cualquier celular.

#### El tope por conexión

Las altas y los envíos de equipos se cuentan por grupo de dirección (la IPv4 entera, o el bloque /64 en IPv6) en ventanas fijas de 10 minutos: **60 equipos nuevos y 300 envíos** (altas, correcciones e intentos rechazados) por ventana. Es generoso a propósito: en un evento decenas de celulares salen por la misma red del lugar, y con esto 40 equipos detrás de una sola dirección se anotan y corrigen varias veces en diez minutos sin tocarlo, mientras que una sola conexión no llena los 200 lugares en dos minutos (a lo sumo 120, si cruza el cambio de ventana). El tope de envíos se mira antes que el de 120 por minuto de la sala, así que una sola conexión tampoco lo gasta para todos. La dirección no se guarda: cada sala tiene una sal al azar y guarda una huella del grupo con sus cuentas de la ventana en curso (las ventanas que pasaron se borran en cada envío), y todo se borra con la sala.

Lo que no frena: alguien con muchas direcciones distintas (eso es la regla de Cloudflare de [Muchas direcciones](#muchas-direcciones)), ni que alguien anote primero una cuenta ajena que todavía no se anotó (eso lo resuelve comprobar que quien anota controla la cuenta, aparte de esto). Quien organiza puede quitar cualquier equipo.

#### Versiones que van juntas

Este protocolo (`llave` en el alta, `ajena` y `cupo-conexion`) pide subir **juntos** el Worker y el sitio de esta misma versión. El Worker publicado hasta ahora es anterior al registro de equipos (con él, el registro del sitio no abre), así que no hay celulares viejos que cuidar. Un sitio anterior a este cambio no puede anotar equipos contra el Worker nuevo (`400`, por falta de llave), y un Worker con equipos pero sin este cambio aceptaría el alta del sitio nuevo sin protegerla (ignora la llave). Se despliega el Worker y en seguida el sitio, antes de abrir un registro. La tabla `equipos` nace con la columna de la huella; una sala armada con un Worker anterior a este cambio que tuviera la tabla sin esa columna no puede anotar equipos (se cierra y se arma otra).

Qué significa cada estado y cuándo lo cambia la pantalla de quien organiza (con lo que lee de la cadena: los pagos de la cuenta del evento y los sellos del contrato por organizador) está en `src/equipos/estado.ts`.

**Los topes viven en los objetos, porque ahí son exactos:** 400 nombres por sala (exacto, en SQLite) y 240 por minuto (en memoria: si el objeto se desaloja a mitad de un minuto, ese minuto cabe otra ventana entera; solo frena el ritmo, el de 400 no se reinicia); 30 salas por dirección por hora (en IPv6, por bloque /64) y 400 por día en un objeto aparte (`Cupos`), los dos en su SQLite: dormirse o reiniciarse no los pone en cero. El límite es por sala y no por dirección porque todo un recinto puede salir por una sola IP. Son 30 por hora porque en un evento todo el recinto sale por una sola conexión.

### Las salas de campaña firmadas

Una sala de campaña nace con un solo `POST /v1/campana`, desde un origen permitido y con un cuerpo de hasta 90.000 bytes:
`{"texto","firma"}`. El texto es el archivo completo de la campaña y la firma es Ed25519, en base64url. El Worker comprueba
la firma antes de leer el JSON. Después revisa que tenga `v: 1`, un `evento` válido, la red `mainnet` o `testnet`,
`cierra_ms` y `sorteo_ms` enteros positivos y `premios`, de uno a diez montos enteros en texto. Puede traer `organizadora`, la
cuenta de Stellar que tiene que sellar: sin ella, sella cualquier cuenta. La firma tiene una sola escritura posible: una firma
con los bits sobrantes del final distintos de cero no es canónica y no verifica. Un cierre pasado contesta
`409 {"error":"vencida"}`. Sin llave pública configurada, no se crea ninguna campaña y contesta `503 {"error":"sin-llave"}`.

| Pedido | Qué hace | Límite o permiso |
| --- | --- | --- |
| `POST /v1/campana` | Crea la sala: `201 {"id","token","vence"}` | Una sala viva por evento y 20 creadas por día UTC, fuera del cupo general |
| `GET /v1/sala/<id>/campana` | Devuelve `{"texto","firma"}`, exactamente como llegaron | Sin token |
| `GET /v1/sala/<id>/campana/estado?p=P` | Devuelve `{"fase","total","cierraMs","pase","quitadas","correo"}` | Sin token |
| `GET /v1/sala/<id>/campana/pase` | Devuelve `{"p","hasta"}` para la pantalla | Con el token |
| `PUT /v1/sala/<id>/campana/fase` | JSON `{"fase","cierraMs"?}`. Cambia la fase y avisa por el socket | Con el token. Hasta 200 bytes. `204` |
| `PUT /v1/sala/<id>/campana/resultado` | Comprueba el resultado en la red y guarda las ganadoras. `204` | Con el token |
| `GET /v1/sala/<id>/campana/resultado` | Devuelve `{"sorteo","ganadoras","comprobante"}` | Sin token |
| `POST /v1/sala/<id>/campana/quitar` | JSON `{"n","motivo"}`: saca a una persona antes del sello. `204` | Con el token. Hasta 200 bytes |
| `POST /v1/sala/<id>/campana/avisar` | JSON `{"cuenta"}`: avisa a una ganadora después del sorteo. `204` | Con el token. Hasta 200 bytes |
| `POST /v1/sala/<id>/campana/alta` | Sesión, datos cifrados, llave y pase. `201`, o `200` si ya estaba | Desde el sitio. Hasta 6.000 bytes |
| `POST /v1/sala/<id>/campana/yo` | `{"cuenta","llave"}`: fase, total, cierre y si ese celular está anotado | Solo lectura. Hasta 300 bytes |

El permiso del evento se da en dos tiempos en el objeto de cupos: se reserva antes de crear la sala y se confirma, con el id de
la sala, recién cuando quedó creada. Si la creación falla (`503 {"error":"ocupado"}`, un corte), la reserva se suelta y el mismo
archivo firmado se puede mandar de nuevo. Una reserva que nadie confirmó se da por abandonada al minuto. Mientras la sala del
evento vive, un segundo pedido con el mismo archivo contesta `409 {"error":"ya-existe"}` sin crear otra sala y sin dar el
token. Si la reserva nunca llegó a confirmarse, el mismo archivo vuelve a servir pasado el minuto. Si la sala se cerró o venció,
el mismo archivo firmado vuelve a servir solo con `Authorization: Bearer <token de esa sala>`: el archivo es público desde que
la sala existe (`GET campana`), y sin ese token cualquiera que lo copió se quedaría con el evento y con un token nuevo apenas
quien organiza cierra. Sin el token, o con otro, contesta el mismo `409 {"error":"ya-existe"}`. Si el token se perdió con la
sala, hace falta otro archivo con otro `evento`. El cupo de 20 por día cuenta solo las salas que de verdad se crearon, aunque
después se cierren; si ya están las 20, contesta `429 {"error":"cupo-campanas"}` con `Retry-After: 86400`. La sala vive
**24 horas** y su alarma borra todo al vencer. Un ensayo con el mismo evento ya no quema el evento del sábado: alcanza con cerrar
la sala del ensayo y crear la nueva con su token.

Las fases posibles son `lista`, `abierta`, `cerrada`, `sellada` y `sorteada`. Quien organiza puede abrir una lista, cerrar una
campaña abierta, volver a abrirla o correr el cierre mientras está abierta. Un cierre nuevo tiene que quedar entre un minuto y
doce horas desde el pedido. `sorteada` llega solo con el resultado.

Para pasar de `cerrada` a `sellada`, la misma ruta recibe `{"fase":"sellada","sorteo":"42"}`. El número es texto de
una a veinte cifras. El Worker lee en el contrato oficial la instancia y el sello, comprueba que la instancia corra el
`.wasm` oficial y calcula la huella de las cuentas anotadas, sin repetidas y ordenadas como texto. La lista sellada queda
guardada en ese mismo orden. El sello tiene que estar atado a lo que Tinkazo firmó: la cantidad de ganadoras del sello es la
cantidad de `premios` del archivo (`409 {"error":"ganadores-distintos"}`), quien selló es la cuenta de `organizadora` si la
campaña la nombra (`409 {"error":"organizador-distinto"}`) y la huella es la de las anotadas que no fueron quitadas, ordenadas
por cuenta. Si la cantidad de cuentas o la huella no coincide, contesta `409 {"error":"lista-distinta"}`. Además, la ronda de
drand del sello tiene que salir por lo menos tres segundos después del pedido y el sorteo no puede estar hecho: si no, contesta
`409 {"error":"ronda-pasada"}`. Sin esto, quien tiene el token podría sellar varias veces la misma lista, esperar las semillas y
avisar a la sala solo el sello que le conviene. El contrato exige 30 segundos al sellar y el panel sella con 45 o más, así que
el panel tiene que avisar a la sala apenas confirma el sello, sin esperar el sorteo. En cualquiera de estos casos no cambia la
fase y se puede reintentar (con un sello nuevo, si la ronda ya pasó). Si el sorteo no existe, contesta
`409 {"error":"sin-sorteo"}`.

Si ningún RPC contesta de forma válida, el sellado o el resultado contesta `502 {"error":"red"}` y la sala conserva su fase.
El panel no anuncia un cambio que no ocurrió: mantiene el paso anterior y permite reintentar. En la red principal se prueban,
en orden, las direcciones de `RPC_MAINNET`; en la de prueba se usa el RPC de `src/stellar/deployments.json`. Cada intento
tiene un tope de diez segundos y se hace en el Worker, nunca dentro del objeto persistente.

`PUT /v1/sala/<id>/campana/resultado` recibe `{"sorteo","comprobante"}`. El comprobante empieza con `/verificar.html`.
El Worker vuelve a leer el contrato: no acepta cuentas ni índices ganadores del cuerpo. La sala comprueba el número del
sorteo, la cantidad y los índices, y traduce los puestos con su propia lista sellada. Sin sello o sin resultado en la red,
contesta `409 {"error":"sin-resultado"}`. Una diferencia con lo ya sellado o sorteado da `409 {"error":"distinto"}`.
Repetir el mismo resultado solo actualiza el comprobante, para sumar después el enlace con la transacción del sorteo.

`GET /v1/sala/<id>/campana/resultado` es público. Antes del resultado contesta `404 {"error":"sin-resultado"}`, distinto
del `404 {"error":"no-existe"}` de una sala que no existe. Así el celular sabe que debe seguir esperando.

Quitar se puede únicamente con la fase `abierta` o `cerrada`. El motivo es `repetida`, `evento`, `pidio` u `otro`.
La salida es para siempre en esa sala: ni la misma persona con otra cuenta ni otra persona con esa cuenta pueden volver a entrar.
Con la lista ya sellada contesta `409 {"error":"fase"}`. Si el número no está, contesta `404 {"error":"no-esta"}`.
El estado público suma `quitadas`, con cuántas personas salieron por cada motivo. Nunca publica quiénes salieron.

Avisar exige la fase `sorteada` y una cuenta que figure entre las ganadoras. En otro caso contesta
`400 {"error":"no-gano"}`. Repetir el aviso contesta `204` y conserva una sola marca por cuenta.

El pase cambia cada dos minutos. Se calcula con HMAC-SHA256 sobre `pase|<ventana>` y un secreto al azar propio de la sala, y se
muestran los primeros 9 bytes en base64url. El estado acepta la ventana actual y las siete anteriores, entre 14 y 16 minutos.
En una sala de campaña, el alta común de nombres, la configuración y las escrituras comunes de equipos contestan
`409 {"error":"campana"}`: las personas entran únicamente por el alta con la sesión verificada. Las lecturas heredadas que no
piden token no dicen nada de nadie: `GET /v1/sala/<id>/equipos/<cuenta>` contesta siempre `404 {"error":"no-existe"}`, como una
sala común donde ese equipo no está, y `GET /v1/sala/<id>/publico` contesta `{"config":null,"equipos":0}`. Cada celular
consulta lo suyo por `campana/yo`, con su llave. Con el token de quien organiza, `GET equipos?desde=V` sigue trayendo las
anotadas para el panel.

#### El alta con la sesión verificada

`POST /v1/sala/<id>/campana/alta` recibe `{"token","d","llave","p"?}`. La cuenta nunca se toma del cuerpo. El alta sigue
este orden:

1. Exige un origen permitido y revisa la forma de todos los campos antes de llamar a cualquier servicio.
2. Si `PASE` no es `0`, exige el pase y lo comprueba junto con la fase y los topes de rechazos de la ficha y de la conexión. Lo que
   se rechaza en este paso o antes (forma, pase, fase) no gasta el tope de la conexión: no cuesta una llamada al proveedor.
   Si la ficha es la de una sesión que el proveedor dio por buena hace menos de un minuto y su persona ya estaba anotada, es un
   reingreso y se resuelve acá, sin llamar al proveedor. Si esa persona salió con su motivo, contesta `409 quitada` también
   acá, sin llamar al proveedor.
3. Comprueba que exista la configuración del proveedor y verifica la sesión fuera del objeto persistente.
4. Una falla del proveedor da `502 pollar`; una sesión inválida da `401 sesion` y una de otra app da `403 otra-app`.
5. Solo entra quien el proveedor dice, exactamente, que es de Google (una lista de lo permitido): cualquier otra vía, o un
   campo que no viene, da `403 solo-google`. En el modo suave, que es un interruptor de emergencia, entra además quien no dice
   por dónde entró y se cuenta aparte.
6. Si la persona ya estaba, reconoce su nueva llave y contesta `200 {"cuenta","ya":true}` sin duplicarla. Cada persona
   tiene su propio tope de 6 reingresos por hora: pasado, contesta `429 {"error":"cupo-conexion"}` con `Retry-After` y no toca nada.
7. Si la sesión no trae cuenta, la consulta al proveedor; una falla da `502 pollar` y la ausencia da `409 sin-billetera`, que
   cuenta como un rechazo de esa ficha (costó dos llamadas): la misma sesión sin billetera se consulta como mucho 5 veces en
   diez minutos. El celular no tiene que reintentar más que eso con la misma sesión.
8. Vuelve a comprobar fase y pase, y anota en un bloque sin esperas. Un alta nueva contesta `201 {"cuenta"}`.

Hay una persona por cuenta y una cuenta por persona. Se guardan la huella HMAC-SHA256 del id del proveedor con una sal de la
sala y la huella SHA-256 de la llave del celular. El token, el id, el nombre y el correo no se guardan, no se escriben en la
consola y no vuelven en las respuestas. Las altas nuevas tienen un tope de 300 por minuto en la sala. Por conexión y cada diez
minutos, los topes son 400 personas nuevas, 800 envíos verificados y 300 sesiones rechazadas por el proveedor. Una ficha (la
sesión, guardada solo como huella con sal) suma una sola vez a ese tope de la conexión, y por sí sola puede ser rechazada
5 veces en diez minutos: la sexta ni llega al proveedor. Así una persona que repite una ficha mala no deja afuera a las demás.
Quien salió con su motivo y repite su alta tampoco suma a los envíos de la conexión. Una sala admite 300 personas.

Lo que estos topes no frenan: quien manda 300 fichas distintas y falsas desde la misma conexión del recinto en diez minutos
agota el tope de rechazos de esa conexión, y las personas nuevas de esa conexión esperan hasta que termine la ventana. Cada una
de esas fichas costó una llamada al proveedor, que es lo que el tope protege. La regla de límite de Cloudflare delante de
`s.tinkazo.app` (ver la sección Muchas direcciones) es la otra defensa.

`POST /v1/sala/<id>/campana/yo` no exige origen porque no escribe nada. Con la cuenta y la llave correctas devuelve
`anotada: true`; con otra llave devuelve lo público y `anotada: false`. Nunca devuelve el número de anotación.
Si quitaron a esa persona, su propia llave le permite ver `quitada` con el motivo. Con la fase `sorteada`, quien ganó
recibe `gano: true` y su `puesto` desde cero, y otra cuenta anotada recibe `gano: false`. Después del aviso recibe
`avisado: true`. Sin la llave correcta no se devuelve ninguno de esos datos privados.

El estado público de la campaña incluye `quitadas` con o sin token. Con `Authorization: Bearer <token>` suma además
`vias: {"google","sinDato"}` para quien organiza.

La configuración no secreta vive en `wrangler.toml`:

- `POLLAR_APP_ID`: el id público de la app de la red principal, el mismo que usa el portero.
- `RPC_MAINNET`: los RPC de la red principal, separados por comas. La sala los prueba en orden al sellar y al guardar.
- `PASE`: `1` exige el pase del QR. `0` lo apaga únicamente como salida de emergencia durante el evento.
- `SOLO_GOOGLE`: `estricto` (el valor del repositorio y el que vale si la variable falta o trae cualquier otra cosa) deja
  entrar solo a quien el proveedor dice, exactamente, que es de Google. `suave` es un interruptor de emergencia: también deja
  entrar, y cuenta aparte, a quien el proveedor no dice por dónde entró. Una vía que no es Google no entra en ningún modo.
  El nombre del campo del verify (`authProvider`) y el valor que dice Google (`google`) están en una sola constante,
  `VIA_DE_LA_SESION` en `workers/patrocinio/src/pollar.ts`, y son una suposición hasta confirmarlos con una respuesta real.
  Si no coinciden, en modo estricto no entra nadie.

`POLLAR_SECRETO` es la misma llave secreta del portero de la red principal y no se escribe en el repositorio. Se carga desde
esta carpeta con:

```bash
npx wrangler@4 secret put POLLAR_SECRETO
```

La llave privada de verdad se genera con `scripts/campana-firmar.mjs`, vive fuera del repositorio y nunca se manda al Worker.
El comando para generarla no escribe dentro del repositorio ni pisa un archivo existente. La pública se escribe en
`workers/sala/src/firma.ts`. Desde la raíz del repositorio:

```bash
node scripts/campana-firmar.mjs --nueva-llave <archivo-fuera-del-repositorio>
node scripts/campana-firmar.mjs --llave <archivo-fuera-del-repositorio> --campana <campaña.json>
```

El segundo comando escribe `<campaña>.firmada.json` al lado del archivo original, con el texto normalizado y su firma. Ese
archivo también tiene que quedar fuera del repositorio, y el comando se niega a firmar si iba a caer adentro: quien lo tiene
primero crea la sala del evento y se queda con su token. Antes de
firmar corre los mismos lectores que después leen el archivo, el de la sala y el del sitio: no firma nada que alguno de los dos
vaya a rechazar (un `sorteo_ms` que falta, un enlace de red que no es de esa red, unas bases vacías). Tampoco deja escribir la
llave privada dentro del repositorio, ni en la copia principal cuando se corre desde una copia de trabajo anidada, ni por un
enlace simbólico o una junction.

### El aviso por correo a quien gana

Al guardar el resultado, la sala puede escribirle un correo corto a cada cuenta ganadora, con el enlace para recibir su premio
(`https://tinkazo.app/?red=oficial&premio=1`, o `red=prueba` si la campaña es de la red de prueba). Es la entrada de quien ganó, la
misma de Recibir mi premio del celular: no lleva la sala, el pase ni la clave, así que sigue andando cuando la sala ya se borró.
En la red de prueba el sitio no abre esa entrada: el correo de una campaña de prueba sirve solo para ver que llega.
**Nace apagado.** Hace falta todo esto junto: `CORREO_GANADORAS = "1"`, el enlace de envío `CORREO`, un `CORREO_DE` con forma de correo y `POLLAR_SECRETO`. Si falta
algo, la sala no reserva nada, no busca ni manda, y el estado público dice `"correo": false`. Con todo puesto dice
`"correo": true`, y el sitio muestra su línea de aviso solo en ese caso.

Cómo funciona:

- Las cuentas a las que se escribe las reserva la propia sala, del resultado que guardó (el que salió de la red), nunca del
  pedido, y como mucho tantas como premios firmó la campaña. Quien tiene el token no puede elegir a quién se le escribe ni
  usar la sala para saber si una cuenta tiene correo: la respuesta del resultado sigue siendo `204` sin cuerpo.
- La reserva es una marca `correo:<cuenta>` en la tabla `sala`, escrita antes de buscar y de mandar, con su hora. Cuando el
  intento de esa cuenta termina, salga bien o mal, la marca pasa a "hecha" y esa cuenta no se vuelve a avisar: dos pedidos a la
  vez o un resultado repetido no mandan dos correos. Una reserva que nunca terminó (el trabajo en segundo plano se cortó o el
  Worker se reinició) vuelve a reservarse pasados dos minutos, la próxima vez que llegue el resultado.
- El correo se busca en el proveedor de cuentas (`GET /v3/users?q=<cuenta>&limit=200`) y solo sirve la fila que es exactamente
  esa cuenta: su `wallet_public_key` o una billetera de Stellar de su lista `wallets` (la principal puede ser de otra cadena).
  Con cero filas, con más de una o sin un correo con forma de correo, no se manda.
- El envío corre con `ctx.waitUntil`: la respuesta no lo espera, y si la búsqueda o el envío fallan el resultado igual quedó
  guardado. Como Cloudflare corta ese trabajo unos 30 segundos después de la respuesta, las cuentas se avisan de a cinco a la vez,
  cada una con su tope de 10 segundos, y no empieza ninguna cuenta nueva pasados 10 segundos. Un envío que falla no se reintenta:
  quien gana se entera también por su celular, por la pantalla y por el aviso del stand.
- El correo, el nombre y el id del proveedor se usan una sola vez. No se guardan, no se escriben en el registro ni en un error
  y no vuelven en ninguna respuesta. El registro lleva solo códigos fijos (`correo-busqueda`, `correo-envio`, `correo-fin`).
- Sale en el idioma de la fila (español salvo que diga inglés) con el nombre y el premio de la campaña. El nombre de la empresa,
  el de la persona y el premio van escapados en el HTML y sin saltos de línea en el asunto.

Para prenderlo:

1. En el panel de Cloudflare, Compute, Email Service, Email Sending, Onboard Domain: habilitar el envío para `tinkazo.app`.
   Agrega tres registros en un subdominio propio del envío, no toca los del correo que ya recibe el dominio y tarda de 5 a 15
   minutos. No hay comando para esto. El dominio ya rechaza la suplantación, y el envío firma con el dominio, así que la pasa.
2. Desplegar el Worker con el enlace `[[send_email]]` (ya está en `wrangler.toml`). `POLLAR_SECRETO` ya existe.
3. Probar con una cuenta propia en un ensayo, y recién entonces poner `CORREO_GANADORAS = "1"` en `wrangler.toml` y desplegar.
   Antes de habilitar el dominio, `send` falla con `E_SENDER_DOMAIN_NOT_AVAILABLE` o `E_EMAIL_SENDING_NOT_READY`: se registra
   el código y no pasa nada más. La cuota diaria de una cuenta nueva es baja (`E_DAILY_LIMIT_EXCEEDED`): un evento chico cabe.

Para apagarlo: `CORREO_GANADORAS = "0"` y desplegar de nuevo. El estado público vuelve a decir `"correo": false` y la sala deja
de reservar cuentas. Las marcas que ya se escribieron no se tocan.

### Muchas direcciones

Los topes de los objetos frenan a una dirección y a una sala, no a quien reparte sus pedidos entre muchas direcciones. Esa defensa es una regla de límite de pedidos de Cloudflare (WAF) delante de `s.tinkazo.app`, que se pone al desplegar y no vive en este código.

### Sobre el binding de límite de pedidos

Cloudflare tiene un binding `[[ratelimits]]`, pero solo admite ventanas de 10 o 60 segundos y sus conteos son aproximados, por ubicación. No puede decir 30 por hora ni 400 por día, así que **no se usa** para esto. La documentación que leí el 1-nov-2026 no dice si corre en el plan gratis. Si hiciera falta cuidar la cuenta de un abuso de pedidos, la regla de límite de Cloudflare (WAF) delante de `s.tinkazo.app` es lo que sirve, y es la misma decisión que sigue pendiente para el contador.

## Plan y gasto

Corre con `wrangler dev` y entra en el plan gratis: Durable Objects con SQLite (100.000 pedidos, 5 millones de filas leídas y 100.000 escritas por día en la cuenta; 13.000 GB-s de duración). Con WebSocket con hibernación un socket quieto no cobra tiempo; los mensajes entrantes cuentan 20 a 1 contra los pedidos, y los salientes no se cobran.

Cuentas de una feria (estimaciones, no medidas): 300 nombres son unos 300 pedidos más la pantalla. La consulta de respaldo (cada 3 s) solo corre mientras el socket está caído: una pantalla con el socket caído 1 hora son 1.200 pedidos. **Lo que sí hay que decidir:** un pedido rechazado también cuenta, y un abuso con scripts podría gastar el mismo cupo que abre los comprobantes. Antes de usarlo en un evento: Workers Paid (US$5 por mes) o una regla de límite delante de `s.tinkazo.app`. **Nada de esto pide el plan de US$5 para probarse.**

## Probar

```bash
# En local (workerd, sin tocar Cloudflare). VIDA_PRUEBA_MS acorta la vida de la sala. La prueba principal tarda más de un minuto,
# así que la sala tiene que vivir más que eso: diez minutos.
npx wrangler@4 dev --port 8792 --var VIDA_PRUEBA_MS:600000
node probar.mjs http://127.0.0.1:8792            # unos 50 chequeos (con la llave de cada celular y el tope por conexión); crea tres salas y no deja ninguna
node probar.mjs http://127.0.0.1:8792 --cupos    # el tope de 30 salas por hora (queda guardado: para repetirlo, otra carpeta con --persist-to o esperar una hora)
node probar.mjs http://127.0.0.1:8792 --tope     # 400 nombres por sala: unos dos minutos
# La alarma que borra la sala sola se prueba aparte, con una vida corta (conviene un Worker nuevo, por el cupo de salas por hora):
npx wrangler@4 dev --port 8792 --var VIDA_PRUEBA_MS:4000
node probar.mjs http://127.0.0.1:8792 --alarma
```

De punta a punta, con Chrome (desde la raíz del repo): `pnpm build && pnpm preview --port 4391`, `wrangler dev --port 8792 --var VIDA_PRUEBA_MS:600000` y `CDP_PORT=9733 node scripts/probar-sala.mjs --base http://localhost:4391 --sala http://127.0.0.1:8792`. El sitio solo acepta otro servicio con `?sala=` y desde `localhost`.

`VIDA_PRUEBA_MS` solo existe si se pasa con `--var`; en producción no está y la vida es de 10 horas, o de 24 en una campaña.
En una campaña, además, solo acorta la vida si el pedido llega a `localhost` o a `127.0.0.1`, como la llave de prueba: un valor
olvidado en el Worker desplegado no le corta la vida a la sala de un evento.

El bloque 6c de `probar.mjs` prueba las campañas solo cuando recibe la llave privada de prueba. Para generar un par descartable,
desde la raíz del repositorio, `node scripts/campana-firmar.mjs --nueva-llave-prueba`. Después, con la pública en el Worker local
y la privada en la prueba:

```bash
npx wrangler@4 dev --var VIDA_PRUEBA_MS:600000 --var LLAVE_CAMPANAS_PRUEBA:<pública>
CAMPANA_LLAVE_PRUEBA=<privada> node probar.mjs http://127.0.0.1:8792
```

La llave de prueba se usa únicamente cuando también está puesta `VIDA_PRUEBA_MS` y el pedido llega a `localhost` o a
`127.0.0.1`, el servidor de desarrollo. En un Worker desplegado se ignora aunque las dos variables estén puestas. Sin
`CAMPANA_LLAVE_PRUEBA`, el bloque 6c se saltea y lo avisa. Contra `s.tinkazo.app` no corre ni siquiera con la variable puesta:
allá solo vale la llave pública de verdad.

## Limitaciones conocidas de esta versión

- En una ronda de ejemplo, el cartel final dice «Salió», pero las tarjetas de los juegos y parte del relato todavía dicen «Gana». Es solo presentación; no cambia nada de lo que se elige.
- El filtro de palabras (`src/sala/filtro.ts`) es una lista corta y corre en la pantalla: no atrapa todo, alguien tiene que mirarla.
- En las salas nuevas, el servicio rechaza los nombres repetidos. En las que hayan quedado abiertas de la versión anterior, las variantes siguen marcadas como repetidas y se descartan en la lista canónica de la ronda.

## Desplegar y encender

Para esta actualización de la sala de nombres, hay que publicar **primero el sitio y después el Worker**. Un sitio viejo que haya quedado consultando sin WebSocket puede mostrar el nombre anterior junto al corregido contra el servicio nuevo. Recargar esa pantalla lo resuelve, y publicar en ese orden evita la combinación.

Con el sitio ya publicado, los pasos del Worker son:

```bash
# 1. El Worker, desde esta carpeta, con la sesión de wrangler login de la cuenta de Tinkazo.
#    s.tinkazo.app es un dominio propio del Worker: el despliegue crea el registro DNS y el certificado.
npx wrangler@4 deploy
# 2. Probarlo contra producción (crea dos salas y las cierra o vencen solas):
node probar.mjs https://s.tinkazo.app
```

Corre en el plan gratis de Workers. Cada dirección puede crear pocas salas por hora (`Cupos`), y si alguna vez hiciera falta cuidar el cupo diario de la cuenta, la regla de límite de Cloudflare delante de `s.tinkazo.app` es lo que sirve.
