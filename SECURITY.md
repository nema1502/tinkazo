> **English:** to report a security issue, email hola@tinkazo.app (please don't open a public issue); in scope are the raffle contract, the protocol, the site and the links Worker; we acknowledge within 3 days and there are no cash bounties. Known and accepted risks: [docs/threat-model.en.md](docs/threat-model.en.md).

# Política de seguridad

Si encontraste una falla en Tinkazo, gracias por avisarnos antes de contarla.

## Cómo reportar

Escribí a **hola@tinkazo.app** con el asunto «Seguridad». No abras un issue ni un pull request público con el detalle: ahí lo ve cualquiera antes de que esté arreglado.

Contanos qué encontraste, los pasos para reproducirlo (la dirección del contrato o el sorteo, si hace falta) y qué creés que se puede lograr con eso. Una prueba chica vale más que un informe largo. Si hay datos de otras personas, no los incluyas.

## Qué está en alcance

- **El contrato** `tinkazo-raffle` ([contracts/raffle](contracts/raffle); las direcciones, en [docs/deployments.md](docs/deployments.md)): cómo guarda el sello, cómo verifica la firma de drand y cómo elige a los ganadores.
- **El protocolo** ([docs/protocolo.md](docs/protocolo.md), [src/protocol](src/protocol) y [docs/vectors.json](docs/vectors.json)): cualquier forma de sesgar un resultado, de sortear con una lista distinta de la sellada o de lograr que la verificación diga «verde» cuando no corresponde.
- **El sitio** (tinkazo.app, con las páginas de verificación y de eventos): inyección de código, filtración de listas o de la clave de un comprobante, manipulación de lo que muestra la verificación.
- **El Worker de enlaces** (`c.tinkazo.app`, [workers/enlaces](workers/enlaces)): leer o borrar enlaces ajenos, saltarse el origen o los cupos.

## Qué no

- Phishing, y sitios o dominios de terceros que imitan a Tinkazo (el nuestro es tinkazo.app): avisanos igual, pero no es una falla de nuestro código.
- Ingeniería social contra personas del equipo o de la comunidad.
- Fallas de servicios de terceros (drand, la red de Stellar y sus RPC, Pollar, Vercel, Cloudflare, GitHub): reportalas a ellos.
- Saturar el servicio con volumen, y lo que el [modelo de amenazas](docs/amenazas.md) ya reconoce como límite o riesgo aceptado (por ejemplo, que los cupos del Worker se puedan gastar).

## Qué podés esperar de nosotros

- En **3 días** te confirmamos que lo recibimos.
- En **7 días** te decimos si lo consideramos una vulnerabilidad y qué tan grave.
- En **30 días** lo arreglamos, o te explicamos por qué no y qué sigue. El contrato no se puede actualizar: si la falla está en el desplegado, el arreglo es un contrato nuevo en otra dirección, con aviso en el sitio, y puede llevar más; te mantenemos al tanto.

No pagamos recompensas en dinero. Si querés, te nombramos como quien la encontró cuando publiquemos el arreglo. Pedimos que no la hagas pública hasta que esté arreglada o hayamos avisado a quienes afecta, y que pruebes en testnet o con sorteos tuyos, sin acceder a datos de otras personas ni tumbar el servicio.

Lo que Tinkazo asume, lo que acepta y lo que dice que no cubre: [docs/amenazas.md](docs/amenazas.md) ([resumen en inglés](docs/threat-model.en.md)) y la [página de seguridad](https://tinkazo.app/seguridad.html).
