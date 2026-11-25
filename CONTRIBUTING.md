# Cómo se trabaja en Tinkazo

Gracias por querer ayudar. Esta guía dice cómo se propone un cambio, cómo se revisa y qué no se sube nunca. El reparto del trabajo entre quienes tienen permiso de escritura está fijado en el [issue 277](https://github.com/nema1502/tinkazo/issues/277).

Si lo que encontraste es una falla de seguridad, no abras un issue. Seguí [SECURITY.md](SECURITY.md).

## Antes de empezar

1. Buscá si ya hay un issue o un pedido sobre lo mismo. Si lo hay, comentá ahí en vez de abrir otro.
2. Si no lo hay, abrí un issue con el formulario que corresponda y esperá una respuesta antes de escribir mucho código. Un cambio que nadie pidió puede quedar sin unir, y es una pena que pase después de horas de trabajo.
3. Un issue tiene un solo dueño, la persona asignada. Para tomar uno de otra persona, preguntá en el issue y esperá la respuesta. Sin respuesta no se empieza.
4. Un pedido por issue, y chico. Si el issue es grande, se parte en issues antes de empezar.

## Las zonas

Quienes tienen escritura se reparten el trabajo por zonas. La dirección pone en cada issue la etiqueta de su zona (`zona:frente`, `zona:servicios` o `zona:dirección`) al clasificarlo, así que un issue nuevo puede esperarla un tiempo.

| Zona | Qué incluye | Se pregunta antes de tocar |
|---|---|---|
| Frente | Las páginas de lectura y de sorteo, la portada, los juegos de `src/games/`, la interfaz de `src/ui/`, el armado de campañas, las imágenes de `public/juegos/` y lo que suena | Ningún audio nuevo se prende sin que alguien lo escuche. `public/marca/coleccion` no se toca |
| Servicios | Los servicios de `workers/`, la integración continua, las dependencias, los datos de la cadena y los guiones de datos de `scripts/` | El despliegue de un servicio, los flujos con secretos y `release.yml` |
| Dirección | El protocolo y el contrato, lo que se sella, el ingreso con cuenta, la plata, los secretos, `vercel.json` y la producción | Todo esto se pregunta antes en el issue |

La lista completa de carpetas y archivos de cada zona está en el issue 277.

## Ramas

- La rama nace de `main` al día y el pedido apunta a `main`. No se apilan pedidos sobre otra rama.
- El nombre dice de qué trata y, si corresponde, el número del issue, por ejemplo `arregla-cierre-de-sala-231`.
- Si `main` avanzó mientras trabajabas, traé los cambios a tu rama antes de pedir la revisión. La rama principal exige estar al día.

## Commits

- En español, con tildes, y con una primera línea de 72 caracteres o menos que dice qué cambia desde quien usa lo que se arregla o se agrega. Por ejemplo: `La sala deja de gastar el tope de conexión con quienes esperan`.
- Un commit por idea. Si un arreglo toca algo que el issue no pide, va en su propio commit.
- Cada commit lleva tu autoría. Si la dirección necesita arreglar algo de tu pedido antes de unirlo, lo hace en commits aparte y no reescribe los tuyos. Si un pedido se une con squash, el commit que queda lleva la autoría de quien abrió el pedido.
- Los mensajes no llevan líneas de coautoría ni de atribución.

## El pedido

- Abrilo en borrador mientras trabajás y pasalo a listo cuando lo que corriste está en verde.
- Apunta a `main` y trae la plantilla completa: qué cambia, por qué, a qué issue se refiere, cómo se comprobó y qué despliega o configura al unirse.
- Cada pedido trae sus pruebas.
- Si el pedido no cumple todo el issue, escribí `Refs #N`. Escribí `Closes #N` solo cuando el issue queda hecho entero.
- Si cambia algo que se ve, traé capturas en escritorio y en celular, en los dos temas.
- Unir un pedido a `main` publica el sitio en tinkazo.app de inmediato, así que se revisa como si ya estuviera en vivo. Los servicios de `workers/` y el contrato no se despliegan solos. Lo que despliega un servicio, cambia un secreto o toca producción se coordina antes con la dirección, en el issue.

## Qué se corre antes de pedir la revisión

Hace falta Node 24 y pnpm 11. El contrato usa la versión de Rust que fija `rust-toolchain.toml`.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Según lo que tocaste:

- Texto que lee la gente: `pnpm check:escritura`, `pnpm check:glosario` y `pnpm audit:palabras`.
- Las páginas de lectura: `pnpm check:paginas` contra el sitio construido.
- Lo que se ve: `node scripts/audit-ui.mjs` contra el sitio construido.
- Un juego: la batería de ese juego, explicada en [docs/juegos.md](docs/juegos.md).
- El contrato: `cargo test --workspace`.
- El protocolo: el sitio y el contrato tienen que pasar los mismos vectores de [docs/vectors.json](docs/vectors.json), y los códigos de error del contrato no se renumeran nunca.

## La revisión automática

Cada pedido corre la integración continua. Para unir a `main` se exigen:

- La comprobación `Sitio (Vite + TypeScript)`, que resume las pruebas, los tipos, la construcción y las comprobaciones de las páginas.
- La comprobación `Contratos Soroban`.
- Que tu rama esté al día con `main`.

Si una comprobación falla, el pedido no se une. Mirá el registro, arreglá y volvé a subir. Si la falla parece ajena a tu cambio, decilo en el pedido.

Los pedidos desde una copia propia del repositorio esperan que la dirección apruebe cada corrida de la revisión automática antes de empezar. Es normal.

## Cómo se revisa y se une

La dirección revisa cada pedido y lo une con su permiso de administración, con rebase o con squash y nunca con un commit de unión, para que la historia de `main` quede lineal. Lo que frena la unión son las comprobaciones de arriba.

Si hace falta arreglar algo de tu pedido, la dirección lo hace en commits aparte sobre tu rama. A veces junta varios pedidos en un paquete para integrarlos juntos, y conserva la autoría de cada uno. En ese caso el issue lleva la etiqueta `en integración` y nadie más lo toma.

## Qué no se sube nunca

El repositorio es público. Nunca van:

- Archivos `.env` ni sus variantes (se permite `.env.example`), la carpeta `.vercel/` ni la carpeta `.stellar/`, que guarda las identidades de la línea de comandos con sus semillas.
- Llaves privadas, semillas, tokens ni contraseñas.
- Exportaciones de invitados (los CSV de un evento u otros), listas reales de personas, enlaces de comprobantes de sorteos con personas reales (llevan la lista) ni capturas que muestren nombres o correos reales.
- Nombres de personas en documentos o en código. Para un ejemplo, usá nombres inventados.

Si subiste un secreto por error, avisá enseguida a la dirección. Borrarlo en otro commit no alcanza: el valor hay que cambiarlo.

## Cómo se escribe

- Documentación, commits e issues, en español. Los identificadores de código, en inglés.
- La interfaz es bilingüe: todo texto visible nuevo va en español y en inglés en el mismo cambio.
- En lo que lee la gente no van comillas angulares ni punto y coma.
- Se dice sorteo, en inglés draw. Participar en un sorteo es gratis, siempre: ningún cambio puede hacer que participar cueste o pida comprar algo.
- La lógica del sorteo vive solo en `contracts/raffle/src/` y en `src/protocol/`. El show es presentación y no decide nada.

El estilo con más detalle está en [docs/marca.md](docs/marca.md) y [docs/ux.md](docs/ux.md).

## Licencia

Al enviar un cambio aceptás que se publique bajo la [licencia MIT](LICENSE) del proyecto.

## Dónde preguntar

En el issue o en el pedido, para lo que toca al código. Para cualquier otra cosa, a hola@tinkazo.app.
