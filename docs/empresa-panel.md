# El panel de la empresa aliada (`empresa.html`)

La issue #183 pide que cada empresa pueda armar y ajustar sus campañas sola.
Esta pieza es el panel de la empresa: una página nueva, su módulo de campañas
(`src/empresa/`), sus textos propios y su depósito firmado con la billetera.
La lógica es pura y con pruebas; `src/ui/empresa-panel.ts` solo dibuja, igual
que `src/crear-campana.ts` dibuja el creador.

## Cómo se usa

1. La empresa abre `empresa.html`, pega su dirección de Stellar o conecta su
   billetera (Freighter, el mismo adaptador que el resto del sitio)
   y ve su saldo con `mirarCuenta` (`src/stellar/usdc-cuenta.ts`), con la
   respuesta de si le alcanza para lo que pide su campaña.
2. Arma su campaña con clics: los eventos (ciudad con los nueve departamentos
   de Bolivia y otra, lugar, día de un calendario de quince días, hora de
   cierre en pasos de 15 minutos, cupo con botones de más y menos), los
   premios (1 a 10 ganadores, montos recorriendo la escalera de botones) y
   los pasos como tarjetas: pega el enlace de su perfil y el texto sale
   escrito en español y en inglés; subir, bajar y quitar.
3. La vista previa del celular muestra la campaña en los dos idiomas,
   dibujada en esta página y no en la pieza de la pantalla previa (#172), que
   no se toca.
4. Publicar arma el JSON v1 de la campaña (la misma forma que valida
   `leerCampana` de `src/campana/modelo.ts`), lo baja como archivo y muestra
   el enlace privado del panel: `empresa.html?c=<evento>#<clave>`, con la
   clave en el fragmento, como los demás enlaces privados del sitio. El
   borrador queda en el navegador bajo `tinkazo.empresa.panel.v1`.
5. Depositar arma un pago clásico del total (premios + servicio, con la
   misma cuenta de `comisionDelBuild` que el panel de la portada cobra) con
   la nota numérica del evento (`notaDeLaComision`) y lo firma con la
   billetera siguiendo el patrón de `src/equipos/envio.ts`: con Freighter
   sale solo; con Pollar o sin billetera, la página entrega el código para
   firmarlo en Stellar Lab.
6. El informe del evento y el pago a quien organizó: el informe lee el estado
   de la campaña publicada (parcial, hecho, con las ganadoras y si se les
   pagó) y el pago se elige con botones (5, 10, 20 o 50 dólares) hacia la
   cuenta que se pega, por el mismo camino de la firma.

Ninguna entrada numérica pide escribir números: cupo, montos y pagos van por
botones; el día viene del calendario y la hora de un selector de pasos de
quince minutos. El nombre, el lugar y los enlaces se pegan o se escriben, y
nada más: eso es texto y no obliga a saber sintaxis.

## Módulos

| Archivo | Qué hay |
| --- | --- |
| `src/empresa/textos.ts` | Los textos del panel en `es` y `en`, aparte de `src/i18n.ts` (decisión para no cruzar con la pieza del celular) |
| `src/empresa/eventos.ts` | Los eventos: departamentos, calendario, cierre en pasos de 15 minutos, cupo con botones |
| `src/empresa/premios.ts` | Ganadores 1..10, montos con botones, total con el servicio (`comisionDe`) |
| `src/empresa/pasos.ts` | Las tarjetas de pasos: tipo, enlace validado con `leerUrl`, texto generado en los dos idiomas, orden con subir/bajar/quitar |
| `src/empresa/vista.ts` | Lo que la vista previa muestra, en los dos idiomas |
| `src/empresa/saldo.ts` | El saldo con `mirarCuenta` y la respuesta de si le alcanza |
| `src/empresa/enlace.ts` | El enlace privado: `?c=<evento>#<clave>` |
| `src/empresa/publicar.ts` | El armado y la validación del JSON v1 y el enlace privado |
| `src/empresa/deposito.ts` | El pago clásico, su nota, su preparación en la red y la firma con el patrón de `src/equipos/envio.ts` |
| `src/empresa/informe.ts` | El estado del informe y el pago a quien organizó |
| `src/ui/empresa-panel.ts` | La página: dibuja y reparte, sin lógica propia |

## Falta para cerrar (fuera de esta tarea)

- Registrar `empresa.html` como entrada del build en `vite.config.ts`
  (`rollupOptions.input`) y, si se quiere auditarla en cada revisión visual,
  sumarla a `PAGINAS` de `scripts/check-paginas.mjs`. Ninguno de los dos está
  en las superficies de esta tarea.
- Conectar la publicación con el servicio de campañas y el informe con sus
  resultados reales (ganadoras y pagos que salen del sorteo): hoy las piezas
  se arman, se validan con `leerCampana` y se guardan en el navegador, y el
  informe lee esa campaña.
