> **English:** to report a security issue, email hola@tinkazo.app with the subject "Security". Please do not open a public issue. In scope are the draw contract (`tinkazo-raffle`), the protocol, the site, the services in `workers/` (reading, changing or deleting other people's data, or getting a service to pay or sign something it should not) and the code in this repository. If we do not answer, you decide how and when to disclose it. We do not offer cash bounties and we do not commit to response times. Known and accepted risks are in [docs/threat-model.en.md](docs/threat-model.en.md).

# Política de seguridad

Si encontraste una falla en Tinkazo, gracias por avisarnos antes de contarla.

## Cómo avisar

Escribí a **hola@tinkazo.app** con el asunto "Seguridad".

No abras un issue ni un pedido público con el detalle: ahí lo ve cualquiera antes de que esté arreglado.

Contanos qué encontraste, los pasos para reproducirlo (la dirección del contrato o el sorteo, si hace falta) y qué creés que se puede lograr con eso. Una prueba chica vale más que un informe largo. Si hay datos de otras personas, no los incluyas.

## Qué está en alcance

- **El contrato** `tinkazo-raffle` ([contracts/raffle](contracts/raffle), con las direcciones en [docs/deployments.md](docs/deployments.md)): cómo guarda el sello, cómo verifica la firma de drand y cómo elige a los ganadores.
- **El protocolo** ([docs/protocolo.md](docs/protocolo.md), [src/protocol](src/protocol) y [docs/vectors.json](docs/vectors.json)): cualquier forma de sesgar un resultado, de sortear con una lista distinta de la sellada o de lograr que la verificación diga verde cuando no corresponde.
- **El sitio** (tinkazo.app, con las páginas de verificación y de eventos): inyección de código, filtración de listas o de la clave de un comprobante, manipulación de lo que muestra la verificación.
- **Los servicios** de [workers](workers), como el de enlaces (`c.tinkazo.app`): leer, cambiar o borrar datos ajenos, y lograr que un servicio pague o firme algo que no corresponde.
- **El código de este repositorio**: secretos subidos por error y flujos de GitHub Actions que se puedan abusar.

## Qué no

- Phishing, y sitios o dominios de terceros que imitan a Tinkazo (el nuestro es tinkazo.app). Avisanos igual, pero no es una falla de nuestro código.
- Ingeniería social contra personas del equipo o de la comunidad.
- Fallas de servicios de terceros (drand, la red de Stellar y sus RPC, Pollar, Vercel, Cloudflare, GitHub). Reportalas a ellos.
- Saturar el servicio con volumen, y lo que el [modelo de amenazas](docs/amenazas.md) ya reconoce como límite o riesgo aceptado. Por ejemplo, que los cupos de un servicio se puedan gastar y que la comprobación de origen no frene a un guion.

## Qué podés esperar de nosotros

Intentamos leer cada aviso y responder, pero no podemos asegurarlo. Somos un equipo chico y no fijamos plazos. Si no tuviste respuesta, volvé a escribir.

El contrato no se puede actualizar. Si la falla está en el contrato desplegado, el arreglo es un contrato nuevo en otra dirección, con aviso en el sitio, y puede llevar más tiempo. Si podemos, te avisamos del avance.

No ofrecemos recompensas en dinero. Cuando publiquemos el arreglo podemos nombrarte como quien lo encontró, si lo querés.

Te pedimos que nos des tiempo para arreglarla o para avisar a quienes afecta antes de hacerla pública. Si no te contestamos, vos decidís cómo y cuándo contarla.

También te pedimos que pruebes en la red de prueba o con sorteos tuyos, sin entrar a datos de otras personas ni tumbar el servicio.

Lo que Tinkazo asume, lo que acepta y lo que dice que no cubre: [docs/amenazas.md](docs/amenazas.md) ([resumen en inglés](docs/threat-model.en.md)) y la [página de seguridad](https://tinkazo.app/seguridad.html).
