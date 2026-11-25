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
| `GET /v1/sala/<id>/vivo?desde=N` | Sin token, lo que mira el celular del participante cada 3 s: `{"hay","estado","ronda","ns","nombres"}`. Los nombres siguen cifrados (la clave viaja en el QR); el estado es `abierta` o `cerrada`, la ronda es la compartida, o `null`, y `ns` son los números que siguen en la sala, para que el celular sepa a quién quitaron | |

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
| `GET /v1/sala/<id>/campana/estado?p=P` | Devuelve `{"fase","total","cierraMs","pase","quitadas","correo"}`. Con la lista sellada o sorteada suma `"sorteo"` (el número) y `"ronda"` (la del sello, si la sala la guardó). Con un token suma `"tuya"`: verdadero si es el vigente, falso si otra compu ya tomó la campaña | Sin token. Sin pase y sin token se recuerda 2 segundos en el borde |
| `GET /v1/sala/<id>/campana/pase` | Devuelve `{"p","hasta"}` para la pantalla | Con el token |
| `PUT /v1/sala/<id>/campana/fase` | JSON `{"fase","cierraMs"?}`. Cambia la fase y avisa por el socket | Con el token. Hasta 200 bytes. `204` |
| `PUT /v1/sala/<id>/campana/resultado` | Comprueba el resultado en la red y guarda las ganadoras. `204` | Con el token |
| `GET /v1/sala/<id>/campana/resultado` | Devuelve `{"sorteo","ganadoras","comprobante"}`, o `404` mientras no hay | Sin token. Se recuerda 2 segundos en el borde |
| `POST /v1/sala/<id>/campana/quitar` | JSON `{"n","motivo"}`: saca a una persona antes del sello. `204` | Con el token. Hasta 200 bytes |
| `POST /v1/sala/<id>/campana/avisar` | JSON `{"cuenta"}`: avisa a una ganadora después del sorteo. `204` | Con el token. Hasta 200 bytes |
| `POST /v1/sala/<id>/campana/alta` | Sesión, datos cifrados, llave y pase. `201`, o `200` si ya estaba. Si ya estaba y la lista todavía acepta altas, el nombre cifrado de su fila pasa al nuevo (con la clave de la compu nueva) y sube su versión | Desde el sitio. Hasta 6.000 bytes |
| `POST /v1/sala/<id>/campana/yo` | `{"cuenta","llave"}`: fase, total, cierre y si ese celular está anotado. Con la lista sellada o sorteada suma `"sorteo"` y `"ronda"`, como el estado | Solo lectura. Hasta 300 bytes. Con `"c": true` y la marca prendida (ver abajo) deja de ser lectura y pide un origen del sitio |

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
5. Solo entra quien el proveedor dice que es de Google, escrito como lo escriba (una lista de lo permitido): cualquier otra vía, o un
   campo que no viene, da `403 solo-google` y deja una línea `via-rechazada` en el registro (ver `SOLO_GOOGLE`). En el modo suave, que es un interruptor de emergencia, entra además quien no dice
   por dónde entró y se cuenta aparte.
6. Si la persona ya estaba, reconoce su nueva llave y contesta `200 {"cuenta","ya":true}` sin duplicarla. Cada persona
   tiene su propio tope de 6 reingresos por hora: pasado, contesta `429 {"error":"cupo-conexion"}` con `Retry-After` y no toca nada.
7. Si la sesión no trae cuenta, la consulta al proveedor; una falla da `502 pollar` y la ausencia da `409 sin-billetera`, que
   cuenta como un rechazo de esa ficha (costó dos llamadas) y no como un rechazo de la conexión: la misma sesión sin billetera
   se consulta como mucho 5 veces en diez minutos. El celular no tiene que reintentar más que eso con la misma sesión.
8. Vuelve a comprobar fase y pase, y anota en un bloque sin esperas. Un alta nueva contesta `201 {"cuenta"}`.

Hay una persona por cuenta y una cuenta por persona. Se guardan la huella HMAC-SHA256 del id del proveedor con una sal de la
sala y la huella SHA-256 de la llave del celular. El token, el id, el nombre y el correo no se guardan, no se escriben en la
consola y no vuelven en las respuestas. Las altas nuevas tienen un tope de 300 por minuto en la sala. Por conexión y cada diez
minutos, los topes son 800 envíos verificados y 300 sesiones rechazadas por el proveedor. Las que esperan su cuenta
(`409 sin-billetera`) no cuentan para la conexión: la sesión es buena, solo falta su cuenta, y con cuentas nuevas detrás de la
misma wifi llenarían ese tope sin ningún abuso. Esas sí cuentan para su ficha. Una ficha (la
sesión, guardada solo como huella con sal) suma una sola vez a ese tope de la conexión, y por sí sola puede ser rechazada
5 veces en diez minutos: la sexta ni llega al proveedor. Así una persona que repite una ficha mala no deja afuera a las demás.
Quien salió con su motivo y repite su alta tampoco suma a los envíos de la conexión. Una sala admite 300 personas.

Lo que acota el camino de `409 sin-billetera`, que no tiene tope propio por conexión: cada ficha puede esperar su cuenta
5 veces por ventana (la sexta ni llega al proveedor), y cada ficha distinta es una sesión válida de esta aplicación, que cuesta
un ingreso real con Google, limitado por el proveedor por dirección de red. Además la cuenta de cada persona se crea sola en
segundos, y desde entonces esa sesión ya no puede dar `sin-billetera`. No se sumó un contador por conexión para este camino.

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
  entrar solo a quien el proveedor dice que es de Google, escrito como lo escriba. `suave` es un interruptor de emergencia: también deja
  entrar, y cuenta aparte, a quien el proveedor no dice por dónde entró. Una vía que no es Google no entra en ningún modo.
  El nombre del campo del verify (`authProvider`) y el valor que dice Google (`google`) están en una sola constante,
  `VIA_DE_LA_SESION` en `workers/patrocinio/src/pollar.ts`. Se compara sin importar mayúsculas ni espacios alrededor
  (`google`, `GOOGLE` y `Google` valen), pero lo que escribe el verify con una cuenta de Google todavía no se midió con una
  respuesta real. Si no coincide, en modo estricto no entra nadie.
  Cada rechazo por la vía deja una línea en el registro, `{"evento":"via-rechazada","datos":{"valor","modo"}}`, con lo que mandó el
  proveedor (sin espacios al principio ni al final, minúsculas, solo letras, números y `.` `-` `_` `:`, hasta 32 caracteres, con `~`
  al final si al limpiarlo se perdió algo, o `sin-campo`, `no-es-texto` o `vacio`) y nada de la persona: ni cuenta, ni correo, ni
  sesión, ni dirección de red. Se mira con `npx wrangler@4.160.0 tail --config wrangler.toml --search via-rechazada`. Esta regla
  vive en el módulo del proveedor de cuentas, que la sala empaqueta: para que valga hay que desplegar solo la sala. El portero no
  la lee y recibe el cambio en su próximo despliegue normal. Si el valor que aparece no es `google`, no se cambia nada en vivo
  sin la palabra de quien mantiene el proyecto, y el arreglo es la constante `VIA_DE_LA_SESION`.

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

### Campañas de personas: anotarse sin billetera

Quien solo se anota en una campaña no necesita una billetera. Una campaña lo pide con `"identidad": "persona"` en su texto
firmado. Sin el campo, o con `"cuenta"`, la campaña es la de siempre y ninguna ruta cambia. Cualquier otro valor no se firma ni
se acepta (`400 forma`): así un error de tipeo no convierte en silencio una campaña de personas en una de cuentas.

Nacen apagadas. Hacen falta dos variables en `wrangler.toml`: `DIFERIDA` en `"1"` y un `GOOGLE_CLIENT_ID` (el identificador de
cliente de Google de Tinkazo, que es público). Si falta una, crear una campaña de personas da `503 personas-apagadas`, activarla
al pagar da `400 forma` con el campo `identidad`, y el alta de una ya creada da `503 personas-apagadas`. La consulta propia sigue
andando (es de solo lectura): apagar el modo en pleno evento no deja a quien ya se anotó sin saber si ganó.
La sala guarda el modo en la clave `identidad` de la sala, solo en esas campañas.

- **El alta** es `POST /v1/sala/<id>/campana/alta` con `{"google","d","llave","p"?}`. `google` es el token de identidad que
  entrega el botón de Google, y la sala lo verifica sola con `identidad-google.ts`: firma contra las llaves públicas de Google,
  emisor, audiencia igual al `GOOGLE_CLIENT_ID`, caducidad y correo verificado. No le pregunta nada al proveedor de cuentas y
  nunca contesta `sin-billetera`. Valen los mismos topes, el mismo pase del QR, el mismo cupo, la misma fase y el mismo cierre por
  hora que en una campaña de cuentas. Un token rechazado da `401 sesion` y suma solo a los rechazos de su ficha: la verificación es
  local y no cuesta una llamada, así que los rechazos nunca suman al tope de la conexión, que es de todo el salón detrás de la
  misma red. Un token bien firmado por Google pero hecho para otra aplicación (el `GOOGLE_CLIENT_ID` de la sala no es el del
  sitio) da `503 personas-configuracion`, no suma a ningún tope y el celular dice que el sorteo no abre desde ahí. Google sin
  contestar da `502 google` y no suma. Si Google no contesta, las llaves ya recordadas siguen sirviendo hasta seis horas después
  de su vencimiento. La respuesta es `201 {"anotada":true}` o, si la misma cuenta de Google ya
  estaba, `200 {"anotada":true,"ya":true}`: no lleva la línea de la persona ni nada que la identifique.
- **Una entrada por persona.** La misma cuenta de Google no se anota dos veces en la misma campaña, tampoco desde otro celular:
  la sala la reconoce por su línea, el celular nuevo pasa a ser el suyo y recibe `ya`.
- **Lo que se sella.** En la fila de la lista va la línea de la persona (`linea-persona.ts`, ver `docs/premios.md`) en la misma
  columna donde una campaña de cuentas guarda su cuenta. La lista sale igual que siempre: sin repetidas, ordenada como texto,
  una línea por fila. Quitar a alguien, cerrar, sellar, sortear y el resultado andan igual, y el resultado nombra a quienes
  ganaron por su línea. Quien organiza marca el aviso de una ganadora por su línea (`campana/avisar` con `{"cuenta":"p1:..."}`),
  y la sala solo acepta una línea en una campaña de personas.
- **Saber si estoy anotada.** El celular no tiene cuenta que mandar: `POST campana/yo` con `{"llave"}` sola. La sala busca la fila
  que anotó esa llave y contesta lo mismo que con una cuenta y su llave. Quien no tiene la llave de una fila no ve nada de esa
  fila. En una campaña de cuentas, un pedido sin `cuenta` sigue siendo `400 forma`. En una sala que no existe (cerrada o vencida)
  el alta y la consulta propia dan `404 no-existe`, como las rutas de cuentas.
- **Comprobación antes de un evento.** `GET /v1/personas/estado` contesta `{"prendido","cliente"}`: si las dos variables están
  puestas y cuál es el `GOOGLE_CLIENT_ID` de la sala. Tiene que ser el mismo que `VITE_GOOGLE_CLIENT_ID` del sitio: si no, nadie
  entra. El identificador es público.
- **Lo que no se guarda.** Ni el correo, ni el identificador de Google, ni el token quedan en una tabla, en una respuesta pública
  o en el registro: del token solo sale la línea, que viene de un HMAC con la sal de la sala. El registro lleva el motivo de un
  rechazo (`google-rechazado`), nunca el token.
- **El correo a quien gana no se manda** en estas campañas, y el estado público lo dice con `"correo": false`. La línea no dice a
  quién escribir y la sala no guarda ningún dato que lo diga. Avisar por correo, y el reclamo del premio, son de otra etapa.
- **Límite de este modo, a resolver antes de prenderlo en un evento con premios.** Quien gana y cierra la página no recibe ningún
  aviso: se entera solo si su celular sigue abierto y consulta con su llave, o si quien organiza lo ve en su pantalla. Además la
  línea sale de la sal de la sala, y esa sal se borra con ella a las 24 horas de crearla: pasado ese plazo nada permite volver de
  una línea ganadora a una persona. Avisar a quien ya cerró la página exige guardar un dato que lleve de vuelta a la persona,
  aunque sea cifrado y hasta el fin del reclamo, y eso choca con la regla de no guardar nada que la identifique. Reclamar el premio
  exige además que la sala siga viva mientras dure el reclamo. Esta etapa no hace ninguna de las dos cosas a propósito. Mientras no
  se decida cómo se entera quien gana, `DIFERIDA` queda en `"0"` en los eventos con premios.
- **El interruptor apagado en medio de un evento** no toca lo que ya está anotado: la sala sigue mostrando el estado, el panel de
  quien organiza sigue cerrando, sellando y guardando el resultado. Solo dejan de andar el alta y la consulta propia.

La prueba `src/sala/campana-paridad-cuenta.test.ts` compara cada ruta de una campaña de cuentas, con sus cabeceras y su cuerpo,
contra un archivo grabado con la sala de antes de este modo. `src/sala/campana-persona.test.ts` prueba el modo nuevo.

### Activar una campaña al pagar (`POST /v1/activar`)

Hasta ahora una campaña solo nacía si Tinkazo firmaba su archivo a mano con la llave de siempre. La activación al pagar deja que
cualquier cuenta de Google arme la suya: la sala firma **sola**, con una segunda llave (automática), cuando comprueba en la red que la
comisión del evento se pagó desde la cuenta de quien organiza. La llave de siempre sigue valiendo igual, y `POST /v1/campana`
acepta lo que firme cualquiera de las dos (la pública de la segunda se deriva en el momento del secreto: no se escribe en el código).

Pedido, desde un origen permitido, JSON de hasta 24.000 bytes con `Content-Length`:
`{"texto": <el JSON de la campaña>, "sesion": <la sesión de quien organiza>}`. Contesta `200`
`{"texto","firma","evento","organizadora"}`: `texto` es el JSON compacto que se firmó y `firma` es Ed25519 en hexadecimal (128
caracteres). `POST /v1/campana` acepta esa firma, y también la de siempre en base64url. Ed25519 es determinista: repetir el mismo
pedido da la misma firma.

El orden va de lo más barato a lo más caro y nada se firma con la duda:

1. Apagada (`503 apagada`) si `ACTIVAR_AL_PAGAR` no es `"1"` o si la comisión está mal escrita; sin llave (`503 sin-llave`) si falta
   `CAMPANAS_LLAVE_AUTO` (o está mal escrita) o `SALA_SECRETO`.
2. El texto, con el mismo lector que usa la sala al crear (`leerTextoDeCampana`), y además: red principal (`400 red` si no),
   entrada `google`, estado `abierta`, `anotadas` en 0, `contrato`, `promo` y `comprobante` en `null`, `organizadora` escrita, de 1 a
   10 premios del mismo monto (cada uno de 1 a 10.000 dólares digitales, en centavos justos), cierre dentro de los próximos 7
   días, sorteo entre el cierre y un día después, y un nombre de empresa sin la palabra Tinkazo (sin mayúsculas, acentos, signos,
   letras anchas o parecidas ni cifras en lugar de letras). Estas reglas viven en `src/campana/reglas-de-activar.ts`, que el panel
   también mira antes de cobrar. Si no, `400 {"error":"forma","campo"}`.
3. Los topes: los de rechazos por conexión (300) y por sesión (5) de la lista de la sala, 60 pedidos por conexión cada 10 minutos
   y 5 campañas distintas por cuenta y por día (`429` con `Retry-After`: `rechazos`, `cupo-conexion`, `cupo-cuenta`). Repetir un
   evento que ya se activó hoy no gasta lugar. Viven en el objeto `Cupos`: ni la sesión ni la dirección se guardan en claro, y los
   topes diarios de la activación guardan la cuenta como huella con sal del día.
4. La sesión, con el mismo código del alta de quien participa (`pollar.ts`): `401 sesion` (cuenta como rechazo), `403 no-google`
   (siempre en modo estricto, aunque `SOLO_GOOGLE` diga `suave`; también cuenta como rechazo), `403 organizadora` si la cuenta de
   la sesión no es la que nombra el archivo, `502 red` si el proveedor no contesta y `503 sin-pollar` si falta `POLLAR_SECRETO`.
   Estos pasos viven en `verificarQuienOrganiza` (`activar.ts`), que usan también las rutas de Tus campañas.
4b. El evento tiene una sola dueña (ver Tus campañas, abajo): si ya es de otra cuenta, `409 {"error":"evento-ajeno"}` sin mirar
   la red.
5. El pago, en Horizon de la red principal (solo lectura, sin llave, 8 segundos por pedido y 1 MB por respuesta), en la historia
   de la cuenta de la sesión (la de Tinkazo la puede llenar cualquiera con pagos chicos): pagos de USDC de Circle a
   `COMISION_CUENTA`, exitosos, de una transacción con nota `id` igual a la nota del evento (`notaDeLaComision`), que salgan de
   la cuenta de la sesión y de los últimos 30 días. Se suman. Pagada cuando la suma llega a la comisión menos el costo del retiro
   (`umbralPagado`). Mira hasta 3 páginas de 200; si Horizon no contesta o quedan páginas sin mirar antes de llegar al umbral,
   `502 red` y no firma. Sin pagar, `402 {"error":"no-pagada","falta","nota"}`, con `falta` en stroops (lo que falta para el
   umbral).
6. Los fondos: el saldo de USDC de Circle de la cuenta tiene que ser al menos el total de los premios, si no
   `402 {"error":"sin-fondos","falta"}`.
7. La nota: la primera activación pagada se queda con la nota de su evento por 31 días. Otro evento con la misma nota (dos
   nombres con la misma huella) no se activa con ese pago: `402 no-pagada`.
8. El acceso: la sala le pide al portero (`PORTERO_URL`) `POST /v1/alta/organizadora` con la cabecera `x-sala-secreto` y
   `{"cuenta","evento"}`. Es idempotente. Con el tope del día del portero lleno (`429 cupo`), `429 cupo-portero` con
   `Retry-After` hasta que se libera el lugar más viejo. Si no contesta o rechaza de otra forma (también con `409 evento-usado`,
   cuando ese evento ya le dio acceso a otra cuenta), `502 acceso` y no firma.
9. La firma y, antes de contestar, guardar la campaña de la cuenta para Tus campañas (`503 ocupado` si la escritura falla: activar
   de nuevo es gratis).

La pregunta del panel antes de cobrar es el mismo pedido con el cuerpo vacío (`{}`): no mira la red, ni el proveedor, ni gasta
un tope. Con todo listo contesta `400 {"error":"forma","campo":"texto"}`. Antes de eso dice `503 apagada` o `503 sin-llave` como
arriba, y `503 sin-portero` si el portero no la atiende con su secreto: la sala le manda `{}` a `/v1/alta/organizadora` y espera
`400 forma`, que no escribe nada (apagado contesta `503`, con otro secreto `401`, y el de antes no tiene la ruta). Que sí atiende
se recuerda un minuto. Con cualquier otra respuesta el panel no ofrece pagar.

Las cuentas, los montos, el emisor y la nota se calculan con las funciones puras del sitio (`src/campana/comision.ts`,
`src/stellar/comision-config.ts`, `src/stellar/retiro-config.ts`), importadas con ruta relativa y no copiadas: el panel y la sala
dan siempre el mismo monto y la misma nota.

Variables en `wrangler.toml`: `ACTIVAR_AL_PAGAR = "1"`, `COMISION_PB = "200"`, `COMISION_MINIMO = "1.50"`, `COSTO_RETIRO = "0.50"`,
`COMISION_CUENTA` (en el archivo está vacía y la activación queda apagada: al desplegar se escribe la de `VITE_COMISION_CUENTA`
del sitio) y `PORTERO_URL = "https://pm.tinkazo.app"`. Secretos, con `npx wrangler@4 secret put`: `CAMPANAS_LLAVE_AUTO` (la llave
privada Ed25519 de la activación automática, 32 bytes en hexadecimal), `SALA_SECRETO` (el mismo secreto que carga el portero, de 32 caracteres o más) y
`POLLAR_SECRETO` (ya existe). Quien tenga la llave automática puede firmar campañas: vive solo como secreto de Cloudflare, y lo único que la
mueve es una comisión pagada.

### Tus campañas: lo que el servidor guarda de cada cuenta

Desde esta versión el objeto `Cupos` guarda, por cuenta de quien organiza y por evento, el texto firmado de su campaña y su
firma, para que la misma cuenta la encuentre desde cualquier navegador. Es un dato nuevo y se dice por escrito:

- **La cuenta va en claro.** El texto firmado ya la trae escrita, así que una huella no escondería nada. Se guarda hasta 30 días
  después de la hora del sorteo que dice ese texto, también antes de que exista la sala, y como mucho 50 campañas por cuenta (al
  guardar la 51 se borra la de sorteo más cercano). No se guarda cuándo se listó ni desde dónde: las direcciones siguen como
  siempre, con sal de la hora, y la sesión nunca se guarda.
- **Tablas** (todas con `CREATE ... IF NOT EXISTS` en el constructor de `Cupos`, sobre datos que ya existen): `campanas_de_cuenta`
  (una fila por cuenta y evento, con índice único por evento: un evento tiene una sola cuenta), `eventos_sellados` (el evento que
  ya se selló no se reabre ni se reemplaza, tampoco con el token de su sala; vive hasta 30 días después del sorteo del texto
  firmado, no de la clave `sorteo` de la sala), `tomas` y `cuenta_ritmo`. A `eventos_campana` se le suman, con
  `ALTER TABLE ... ADD COLUMN` solo si faltan, `duena` (la cuenta que nombra el texto firmado de la sala) y `revisada`.
- **Quién es la dueña de un evento:** `eventos_campana.duena` y, si todavía no hay sala, la cuenta que activó primero.
  Activar contesta `409 evento-ajeno` si el evento es de otra cuenta. Al crear una sala con un archivo que nombra a su cuenta,
  esa cuenta pasa a ser la dueña y su campaña entra a la lista (cubre lo firmado a mano).
- **El barrido.** Las campañas creadas antes de que hubiera dueña no la tienen: en cada pedido de activar, el Worker mira hasta 10
  salas así (`Sala.campana()`, el archivo público) y, si la sala vive y su texto nombra una cuenta, la anota como dueña y la
  agrega a la lista. Si esa sala ya estaba sellada, anota también su evento como sellado: así, aunque se cierre después, el evento
  no se reabre ni se reemplaza (lo comprobó `prueba-local/almacen-viejo.mjs`). Mientras una sala sin dueña no se revisó, su evento
  cuenta como ajeno. Una sala muerta sin dueña queda como estaba: nadie la recupera.
- **Topes de las rutas de la lista** (`verificarCuentaDeCampanas`): sin forma de sesión de tres partes (la sesión del proveedor
  es un JWT) no se cuenta nada ni se llama a nadie (`401 sesion`), así un vecino de la misma conexión con textos inventados no
  llena los topes de las empresas; un grupo de ritmo propio por conexión de 300 pedidos cada 10 minutos que no gasta el de activar
  y que una sesión ya conocida por el proveedor no suma; los rechazos de la conexión con el tope de siempre (300), pero contados
  aparte de los de activar (`contarRechazoDeCuenta`): lo que se rechaza en una ruta no frena a la otra; y, ya verificada la
  cuenta, 30 listados y 10 tomas por cuenta cada 10 minutos (`429 cupo-cuenta`).
- **Pasar la campaña a otra compu (la toma)** es un cambio de token sin carreras, en tres pasos que las rutas de la lista
  encadenan: `Cupos.prepararToma` (en un solo bloque: vuelve a comprobar la dueña, respeta una pausa de 60 segundos entre dos tomas
  de la misma campaña y anota una generación nueva con la huella del token nuevo), `Sala.cambiarToken` (sin esperas entre leer y
  escribir: solo la cuenta que nombra el texto firmado de la sala, no una sala sellada, y solo con una generación mayor que la
  última; cierra con `4001 tomada` los sockets presentados y dice la fase y cuándo vence la sala) y `Cupos.confirmarToma` (guarda la
  huella en el evento solo si esa generación sigue siendo la última). Con dos tomas a la vez, la sala y el evento terminan con la
  misma huella, la de la generación mayor. Para que un pedido que esperaba con el token viejo no pase después de una toma, la sala
  lee la huella DESPUÉS de esperar el SHA-256 y compara en el mismo tramo sin esperas. Desde la toma el token viejo no vale en
  ninguna ruta (pase, fase, quitar, avisar, nombres, equipos, sellada, resultado, cierre ni el socket).

### Listar las campañas de una cuenta (`POST /v1/mis-campanas`)

Es lo que lee Tus campañas para mostrarle a quien organiza lo que activó o abrió desde otro navegador. Atiende solo con la variable `TUS_CAMPANAS` en `"1"`: si no, contesta `503 {"error":"apagada"}`. Cambiarla es publicar otra vez, con el mismo corte de sockets, así que no es un botón para un evento en curso. **Toda respuesta lleva los permisos de origen**, también los rechazos y los `404` propios de la ruta: sin ellos el navegador los ve como una falla de red y no puede leer el motivo.

Pedido: `{"sesion": "<token de la sesión de Google>"}`, de hasta 6.000 bytes. La cuenta sale siempre del proveedor de cuentas, nunca del pedido, y solo entra quien el proveedor dice que entró por Google. Antes de llamar a nadie, una sesión sin forma de sesión de tres partes es `401 sesion` y no gasta ningún cupo.

Respuesta `200`:

```json
{ "campanas": [ { "evento": "feria-sc-28nov-ab12", "empresa": "Nombre de la empresa", "zona": "America/La_Paz",
                  "abreMs": 1764340200000, "cierraMs": 1764351000000, "sorteoMs": 1764352800000,
                  "estado": "viva", "fase": "abierta", "total": 37 } ] }
```

El `estado` se calcula en este orden y la sala viva siempre gana:

1. `viva`: el evento tiene una sala que vive y su organizadora es la cuenta de la sesión. Trae su `fase` y `total` (cuántas personas hay), también en `sorteada`.
2. `terminada`: el evento se selló, o no hay sala viva y el cierre ya pasó.
3. `activada`: no hay sala viva y el cierre está por delante.

Una sala viva que nombra a otra cuenta, o a ninguna, no sale en la lista. Una fila cuyo evento tiene otra dueña tampoco. Primero van las `viva`, después las `activada` por hora de apertura y al final las `terminada`, las más nuevas primero, hasta 20. La respuesta **nunca** trae el texto firmado, la firma, el id de la sala ni su token. Una cuenta sin campañas y una que nunca existió reciben lo mismo: `{"campanas":[]}`. Antes de leer, el Worker mira hasta 10 salas anteriores a la dueña (el barrido), así la campaña creada antes de esta versión aparece sin que su panel vuelva a consultar.

| Estado | Cuerpo | Cuándo |
| --- | --- | --- |
| `400` | `{"error":"forma","campo":"cuerpo"\|"sesion"}` | Sin JSON o sin `sesion` de texto |
| `401` | `{"error":"sesion"}` | Sin forma de sesión de tres partes (no se cuenta), o el proveedor no la reconoce (se cuenta un rechazo, aparte de los de activar) |
| `403` | `{"error":"origen"}` o `{"error":"no-google"}` | Fuera del sitio, o no entró por Google |
| `409` | `{"error":"sin-billetera"}` | La sesión no tiene cuenta |
| `429` | `{"error":"rechazos"\|"cupo-conexion"\|"cupo-cuenta"}` y `Retry-After` | Topes de la conexión o de la cuenta (30 listados cada 10 minutos) |
| `502` | `{"error":"red"}` | El proveedor no contesta |
| `503` | `{"error":"apagada"\|"sin-pollar"\|"ocupado"}` | Interruptor apagado, sin proveedor, o una falla inesperada del servidor |

### Usar una campaña en esta compu (`POST /v1/campana/recuperar`)

Con el mismo interruptor, los mismos permisos de origen y la misma verificación que la lista (el tope por cuenta es de 10 tomas cada 10 minutos). Pedido: `{"sesion", "evento"}`, con el evento con la forma de siempre (`400 {"error":"forma","campo":"evento"}` si no). Busca la campaña de la cuenta con ese evento y la mira por dentro:

| La campaña está | Respuesta |
| --- | --- |
| Sin sala, o con una reserva vieja que nunca se confirmó | `200 {"estado":"activada","texto","firma"}`, o `409 {"error":"terminada"}` si el evento se selló o el cierre pasó. El sitio crea la sala por el camino de siempre |
| Con una reserva reciente (se está creando la sala) | `409 {"error":"ocupado"}` |
| Con una sala viva | La toma: `200 {"estado":"viva","id","token","vence","fase"}`. El token anterior deja de valer |
| Con una sala viva en `sellada` | `409 {"error":"sellada"}`. Una sala sellada no se toma: su sorteo se hace en la compu donde se selló |
| Con una sala muerta, el cierre por delante y la dueña igual | `200 {"estado":"activada","texto","firma","anterior"}`: `anterior` es el token con el que `POST /v1/campana` reemplaza esa sala sin pedir el viejo |
| Con una sala muerta y el evento sellado o el cierre pasado | `409 {"error":"terminada"}` |
| Con una sala muerta cuya dueña no es la cuenta (o no dejó dueña) | `404 {"error":"no-existe"}` |

**`404 no-existe`** es la misma respuesta para una campaña de otra cuenta, un evento que no existe y uno que ya venció: no se puede usar para averiguar nada. Un evento sellado no se reabre por ningún camino, tampoco con el token de su sala vieja. Además: `429 {"error":"pausa"}` con `Retry-After` si pasaron menos de 60 segundos desde la toma anterior de esa campaña, y `409 {"error":"ocupado"}` si la toma perdió contra otra.

**La toma, sin carreras**, en tres pasos: `Cupos.prepararToma` (dueña, pausa, generación), `Sala.cambiarToken` (sin esperas entre leer y escribir) y `Cupos.confirmarToma`. Si la sala murió en el medio, se sigue por la rama de la sala muerta. Si la sala dice que no existe pero sigue viva, nombra a otra cuenta: `404`, y el token no cambia. Repetir el pedido es inofensivo: hace otro token y el anterior también queda sin efecto, pasada la pausa. La clave que descifra los nombres nunca pasa por el servidor: quien toma la campaña inventa una nueva en su navegador.

**Aviso por correo de cada toma.** Con una sala viva y una toma buena, el Worker le escribe a la cuenta de la sesión (sin que la respuesta lo espere): "Tu campaña de la empresa se abrió con tu cuenta en otra compu a las 11:00", con la hora en la zona de la campaña. Como mucho uno por campaña cada 10 minutos. Es la defensa de quien perdió su sesión: quien robe la sesión puede tomar la campaña, pero no sellar ni pagar. Pide `CORREO_TOMA = "1"` además de todo lo que pide el correo a quien gana, y **va prendido en `wrangler.toml` junto con `TUS_CAMPANAS`: las dos rutas y este aviso se publican en la misma publicación**. Sin el aviso, quien robe una sesión de Google puede tomar la campaña de una empresa (cerrar la lista, quitar gente, borrar la sala) sin que la dueña se entere. Si todavía no se aprobó mandar ese correo, se publican las dos variables en `"0"` y se prenden juntas después, para no pagar dos cortes de sockets. No guarda la dirección ni el nombre, y el registro lleva solo un código fijo (`correo-toma`). **Usar en esta compu no atiende sin el aviso:** con `TUS_CAMPANAS` prendida y el aviso sin poder salir (falta `CORREO_TOMA`, `CORREO_GANADORAS`, `CORREO_DE`, el enlace `CORREO` o `POLLAR_SECRETO`), `POST /v1/campana/recuperar` contesta `503 {"error":"apagada"}` y el registro dice `{"evento":"tus-campanas","datos":{"codigo":"sin-correo-de-toma"}}`. La lista de la cuenta sigue.

### Lo público del momento del resultado

- **El número del sorteo y la ronda** salen en el estado y en la consulta propia solo con la lista `sellada` o `sorteada`. Antes del sello la clave `sorteo` de la sala guarda la hora del sorteo, no el número, y no se manda en ninguna otra fase. La ronda del sello se escribe junto con el sello (clave `ronda_sello`). Una sala sellada antes de esta versión trae el número y no la ronda: el celular hace lo de siempre.
- **`tuya`** solo llega si el pedido trajo un token. Es lo que le dice a una compu, ya en su primer pedido, que otra tomó la campaña.
- **La caché del borde** (`cache.ts`): `GET campana/estado` sin pase y sin token, y `GET campana/resultado`, se recuerdan 2 segundos con la caché de Cloudflare de ese mismo dominio. Se guarda solo el estado y el cuerpo, nunca las cabeceras de origen (cada pedido recibe las suyas), solo 200 y 404, y con el camino como clave: un parámetro inventado no la esquiva. El `404 sin-resultado` (todavía no hay resultado) no se guarda nunca, ni en el borde ni en el navegador (`Cache-Control: no-store`): es lo que cambia justo cuando quien organiza lo lee. Un pedido con pase o con token ni se sirve de ahí ni se guarda. Sin la caché (Node, o un entorno que no la tiene) todo sigue como siempre. La respuesta puede atrasar dos segundos un cambio de fase, nunca adelantarlo.
- **El reingreso** de quien ya estaba anotada reemplaza el nombre cifrado de su fila por el que trae el alta nuevo, y le avisa a la pantalla. Es lo que le devuelve su nombre a quien vuelve a escanear el QR cuando la campaña pasó a otra compu y su clave es otra. Mientras la fase no acepte altas solo cambia la llave del celular, como antes. La clave que descifra los nombres nunca llega al servidor.

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
- **Dos versiones del pedido y la ayuda.** La **versión 1** es cierta siempre: la cuenta reconoce el navegador y no el aparato, así
  que pide abrir el enlace en el mismo celular o compu, y en el mismo navegador, donde la persona se anotó, y ofrece responder el
  correo si no puede. La **versión 2** dice que se abre desde cualquier aparato y que otro aparato pide un código al correo: solo es
  cierta si la cuenta quedó protegida y el correo es el de la sesión. La variable `CORREO_VERSION` elige la de todas: solo el valor
  exacto `"2"` es la 2, cualquier otro es la 1. **No se prende** hasta que anotarse deje la cuenta protegida para todas las personas
  y no quede ninguna campaña viva con gente anotada antes de ese cambio, porque el servidor no sabe quién protegió su cuenta.
- **La marca de correo confirmado** (`CORREO_MARCA`, nace en `"0"`): el celular puede sumar `"c": true` a la consulta propia (`campana/yo`)
  cuando su correo de la sesión está confirmado. Con la marca prendida, la sala la acepta solo con la llave del propio celular y un
  origen del sitio, escribe una sola vez por cuenta (`confirmo:<cuenta>`) y a esa cuenta le sale la versión 2 aunque la general sea la 1.
  Apagada, se ignora: ni da error ni escribe. Si alguien la manda sin ser verdad, solo cambia el texto de su propio correo.

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

### Tus campañas y la toma, en el motor real

Las rutas de Tus campañas piden una sesión que el proveedor de cuentas verifica por la red, y el sello se lee de la red de Stellar.
Para probarlas sin salir de la máquina, `prueba-local/` levanta el Worker con `wrangler dev` y le pone una puerta de entrada de
prueba (`entrada.mjs`): reexporta los mismos objetos y el mismo `fetch`, y solo imita lo de afuera. El proveedor contesta las
sesiones que la prueba registra, el RPC contesta el sello que la prueba arma, y cualquier otra salida a internet se rechaza y se
anota (la prueba comprueba que no salió nada). La configuración sale de `wrangler.toml` sin la cuenta ni el dominio. Los secretos
son inventados en cada corrida y las llaves de firma salen al azar. Nada de esto se despliega: el despliegue usa `src/index.ts`.

```bash
node workers/sala/prueba-local/correr.mjs              # lo de Tus campañas: unos 3 minutos
node workers/sala/prueba-local/correr.mjs --completo   # la prueba de siempre y además lo de Tus campañas: unos 6 minutos
node workers/sala/prueba-local/almacen-viejo.mjs --desde <rama o commit>   # el código de ahora sobre un almacén hecho por esa versión
```

`correr.mjs` cubre la toma, el cierre 4001 de la pantalla vieja (y que una conexión sin presentar no se toca), el token viejo en
cada ruta, el `vence`, la pausa de 60 segundos, los topes por cuenta, la sellada que no se toma, el sellado que no se reemplaza,
la sala muerta que se recupera con `anterior`, la sala sin organizadora, la caché de 2 segundos y dos carreras (toma contra toma
y toma contra sello). `almacen-viejo.mjs` saca con `git archive` el código de la versión que se le pide con `--desde` (la que
hay publicada), crea campañas con él, las deja en disco y arranca el código de ahora sobre ese mismo almacén: comprueba el `ALTER TABLE` y el `PRAGMA table_info` del motor real, el barrido, la toma sobre filas viejas, que una
sellada de antes no se reabre y que un segundo arranque no repite el `ALTER`.

Hace falta un wrangler a mano. Se busca en `WRANGLER_JS`, en `node_modules` del repositorio y, por último, en la memoria de npx de
la máquina (se corre con `node`, sin instalar nada global). Si no hay, `npx wrangler@4 --version` una vez lo deja en esa memoria.
El almacén y las salidas quedan en `.wrangler/prueba-local/`, que git ignora.

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

### Publicar Tus campañas (la sala con las rutas nuevas)

Publicar necesita la palabra expresa del dueño. Ventana: sin ninguna campaña en `abierta`, `cerrada` o `sellada`, y antes del próximo evento.

1. **El sitio primero.** Contra el servidor de hoy, el sitio nuevo se porta bien: una vez por pestaña le pregunta a la sala si tiene Tus campañas (`POST /v1/mis-campanas` con `{}` y exige `400 forma` con permisos de origen) y, si no la tiene, no muestra las líneas, los enlaces ni los botones de Tus campañas. Una pestaña abierta antes del sitio nuevo necesita recargar.
2. **Las variables de `wrangler.toml`, todas a la vez.** `TUS_CAMPANAS = "1"` y `CORREO_TOMA = "1"` van juntas (ver arriba). `CORREO_VERSION = "1"` (el correo a quien gana, versión siempre cierta), `CORREO_MARCA = "0"` (la marca de correo confirmado, apagada) y `CORREO_GANADORAS = "1"`. Ningún secreto nuevo. Esta rama trae además la caché de 2 segundos de `cache.ts`, que no tiene variable: se publica con el código.
3. **Antes de publicar, la privacidad.** La página de términos (`terminos.html`, en español y en inglés) y `docs/architecture.md` (D-26) dicen que el servidor guarda la cuenta de quien organiza junto con el texto firmado de su campaña hasta 30 días después del sorteo, también antes de que exista la sala. Salen con el sitio, que va primero. No se publica el servidor si esos textos no están en producción.
4. **Sin gastar nada.** `pnpm test`; `node workers/sala/prueba-local/correr.mjs --completo`; `node workers/sala/prueba-local/almacen-viejo.mjs --desde <lo publicado>`; y `npx wrangler@4 deploy --dry-run`.
5. **Publicar y comprobar.** `npx wrangler@4 deploy` desde esta carpeta reinicia los objetos y corta los sockets de las pantallas, que reconectan o sondean. Después: el estado de la campaña de hoy contesta como antes; `POST /v1/mis-campanas` con `{}` da `400 forma` y con una sesión sin forma de sesión de tres partes da `401` sin llamar a nadie; una sesión de tres partes y falsa da `401 sesion` (prueba que `Cupos` arrancó con las tablas nuevas); `POST /v1/activar` con `{}` da `400 forma`. La caché: dos `GET campana/estado` seguidos sin pase ni token (el segundo trae `Cache-Control: public, max-age=2`), que con token no se guarde, y que `GET campana/resultado` sin resultado conteste `404` con `no-store` y apenas haya resultado conteste `200`. Una sola prueba real con la sesión del dueño: listar. Esa prueba es también la que confirma que la sesión del proveedor tiene tres partes, que `formaDeToken` todavía no da por sabido: si contesta `401 sesion`, Tus campañas no anda para nadie, la publicación no se da por buena y se vuelve atrás (paso 7).
6. **El correo de la toma, de verdad, antes de dar por buena la publicación.** Con la cuenta del dueño y una campaña de prueba con la sala abierta, Usar en esta compu desde otro navegador (o una ventana privada): tiene que llegar a la casilla de esa cuenta el correo "Tu campaña de ... se abrió en otra compu", con la hora de la campaña. Si contesta `503 apagada`, o el correo no llega en unos minutos, mirar el registro con `npx wrangler@4 tail` (`tus-campanas` con `sin-correo-de-toma`, o `correo-toma` con su código) y no dar por buena la publicación hasta que llegue.
7. **Volver atrás** (`npx wrangler@4 rollback`) deja huecos, y se dicen: el código viejo ignora `eventos_sellados`, así que un evento ya sellado se puede reabrir con el token de su sala mientras tanto; lo que se tomó no se devuelve (la compu que perdió su token por una toma no lo recupera, y un token entregado sigue valiendo porque la huella quedó escrita); y una pestaña que ya preguntó que la sala tenía Tus campañas ofrece Usar en esta compu contra una ruta que ya no existe hasta que recargue (la falla se dice en la misma tarjeta, no se pierde nada). Apagar con `TUS_CAMPANAS = "0"` también es publicar otra vez, con el mismo corte de sockets: no se hace con una campaña abierta.

Corre en el plan gratis de Workers. Cada dirección puede crear pocas salas por hora (`Cupos`), y si alguna vez hiciera falta cuidar el cupo diario de la cuenta, la regla de límite de Cloudflare delante de `s.tinkazo.app` es lo que sirve.
