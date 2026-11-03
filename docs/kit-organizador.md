# Kit del organizador

La guía para quien organiza un sorteo en su evento vive en `/sorteo-para-meetup.html`: no hay otra página ni otro flujo. Se muestra en el idioma elegido (es o en) y trae, al final, las tarjetas para las mesas.

## Imprimir

- **Imprimir guía A4** imprime los cinco pasos con la marca arriba. La tabla de "Si algo falla" y las bases no se cortan, los enlaces se leen impresos, y los botones y los detalles técnicos de la página no salen en el papel.
- **Imprimir dos tarjetas A4** imprime solo las tarjetas: dos por hoja, cada una con los dos idiomas y el QR. Elegir papel A4 vertical, escala 100 %, márgenes de 10 mm y sin encabezado ni pie del navegador. Al cerrar la impresión la página vuelve al modo normal.
- Cada tarjeta mide 190 x 135 mm, con la frase principal a 24 pt, el texto a 17 pt y el QR de 35 mm. Falta comprobar la lectura a un metro con papel de verdad.

## El QR

El QR es un archivo fijo, `public/kit-organizador/comprobacion.svg`, igual para todos los eventos. Abre `https://tinkazo.app/sorteo-para-meetup.html#comprobacion`, la sección "Por qué se puede comprobar" de la misma página. No lleva datos de ningún evento. Es negro sobre blanco, con corrección Q y cuatro módulos blancos de margen, y se generó con `qrcode-generator`, que ya está en el proyecto. Si cambia la dirección, hay que generarlo de nuevo y revisar `src/kit-organizador.test.ts`, que lo decodifica.

## Los botones que nombra la guía

La guía cita los botones de la app entre «» y tienen que decir lo mismo que la interfaz (`src/i18n.ts`). Si se renombra un botón, se cambia también en la guía, en español y en inglés.

## Fuentes de lo que dice la guía sobre otras herramientas

No se probaron con una cuenta ni con un aparato; salen de la ayuda oficial de cada una.

| Tema | Fuente | Límite |
| --- | --- | --- |
| Bajar el CSV de invitados de Luma | help.luma.com, "Download guest CSV" | Luma manda un código por correo; los nombres de sus botones cambian con el idioma |
| Avisos de Luma | help.luma.com, "Sending or scheduling event blasts" | Hasta siete días después del evento; en la web, "Advanced" para pegar el mensaje completo |
| Transmitir desde Chrome | support.google.com/chromecast, "Cast from Chrome" | Es el menú de Chrome en computadora, no el del celular |
| Espejar en Android | support.google.com/chromecast, "Cast your Android screen" | Depende del receptor y de la marca del celular |
| AirPlay y cable en iPhone | support.apple.com | Depende del receptor y del adaptador |
| Margen blanco del QR | qrcode.com (Denso Wave) | Cuatro módulos |

Que el cable HDMI sea la ruta que menos falla no está verificado con aparatos.

## Qué se comprueba

```sh
pnpm exec vitest run src/kit-organizador.test.ts src/seo.test.ts
pnpm check:paginas
```

Las pruebas leen el HTML que se publica: botones de impresión, las dos tarjetas con los dos idiomas, las cinco secciones con su índice, y el QR decodificado de forma independiente.
