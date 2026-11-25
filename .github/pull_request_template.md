<!-- Escribí en español. Borrá los comentarios y las secciones que no apliquen. -->

## Qué cambia

<!-- Dos o tres líneas, desde quien usa lo que se arregla o se agrega. -->

## Por qué

<!-- El problema real que resuelve. -->

## Issue

<!-- Closes #N solo si el issue queda hecho entero. Si queda algo pendiente, Refs #N. -->

Refs #

## Zona

- [ ] Frente
- [ ] Servicios
- [ ] Dirección (se preguntó antes en el issue)

## Cómo se comprobó

- [ ] `pnpm typecheck`, `pnpm test` y `pnpm build` en verde
- [ ] Cada texto visible nuevo está en español y en inglés
- [ ] Si toca texto que lee la gente: `pnpm check:escritura`, `pnpm check:glosario` y `pnpm audit:palabras`
- [ ] Si toca un juego, la batería de ese juego
- [ ] Si toca las páginas de lectura, `pnpm check:paginas`
- [ ] Si toca el contrato, `cargo test --workspace`

<!-- Pegá acá lo que corriste y lo que dio. -->

## Capturas

<!-- Solo si cambia algo que se ve: escritorio y celular, tema claro y oscuro. Sin nombres ni correos de personas reales. -->

## Qué despliega o configura al unirse

<!-- Escribí Nada si no hay nada. Si hay un servicio, un secreto, una variable o un orden de despliegue, decilo acá. Unir a main no despliega ningún servicio. -->

Nada.

## Antes de pedir la revisión

- [ ] La rama sale de `main` al día y el pedido apunta a `main`
- [ ] No subí secretos, archivos `.env`, exportaciones de invitados ni datos de personas
- [ ] No toqué zonas de otra persona sin preguntar en el issue
