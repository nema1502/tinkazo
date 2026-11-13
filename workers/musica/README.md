# La música de los juegos

Un Worker de Cloudflare en `m.tinkazo.app` que entrega las camas musicales de los juegos **solo al sitio**. Los bytes pueden salir de dos lugares, con el mismo código y la misma puerta:

- **Camino B, el de hoy: archivos propios del Worker** (Workers Static Assets, gratis). Las camas están en `workers/musica/camas/`, una carpeta que **nunca se versiona** (`.gitignore`), y se despliegan junto con el Worker. Config: `wrangler.toml`. No necesita R2.
- **Camino A, cuando R2 esté habilitado en la cuenta: un bucket** (`tinkazo-musica`). Config: `wrangler.r2.toml`.

Los dos despliegan el mismo Worker (`tinkazo-musica`): el último que se despliega manda. Con `run_worker_first = true` el código corre antes que los archivos, así la puerta por `Origin` se aplica siempre; sin eso, Cloudflare entregaría los mp3 a quien sepa la dirección. Eso cuenta cada pedido contra los 100.000 diarios del plan gratis de Workers, que para música de un sitio sobra.

Es un script aparte (`tinkazo-musica`) de los enlaces, la sala y el portero, en la misma cuenta: un error de despliegue acá no tumba nada de eso.

## Por qué no está en el repositorio

Las camas se generaron con una herramienta de música de pago, a nombre de una persona. Sus términos prohíben armar una colección de salidas puesta a disposición de terceros, y una carpeta de mp3 en un repositorio público con licencia MIT se parece mucho a eso. Por eso **la música no se versiona**: en el repositorio solo está este Worker (que no tiene ningún archivo), el guion de subida y el módulo del sitio que dice de dónde baja (`src/sonidos/musica-remota.ts`). Los efectos de sonido son otra cosa y sí viajan con el repositorio.

Si el servicio no contesta, el sitio sigue con la música de siempre, sin error ni hueco.

## Qué hace

| Pedido | Respuesta |
| --- | --- |
| `GET /<juego>.mp3` con `Origin: https://tinkazo.app` (o `https://www.tinkazo.app`) | `200` con el archivo. También acepta `Range` (`206`) |
| `HEAD /<juego>.mp3` con ese origen | Las mismas cabeceras, sin cuerpo |
| Lo mismo sin `Origin`, o con otro | `403` con una línea en español que dice que la música es del sitio |
| Un archivo que no está en el bucket | `404` |
| Cualquier otra ruta | `404` |
| Cualquier otro método | `405` |

Cabeceras de una respuesta buena: `Content-Type: audio/mpeg`, `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges: bytes`, `Access-Control-Allow-Origin` con el origen que pidió, y `Vary: Origin` para que ningún caché mezcle respuestas de orígenes distintos. Un `403` lleva `Cache-Control: no-store`.

No hay listado ni subida por HTTP. Los archivos se suben con `wrangler r2 object put` o se copian a `camas/` (ver `subir.mjs`).

**Qué es y qué no es esta puerta.** La cabecera `Origin` la mandan los navegadores y la puede escribir cualquiera con `curl`: esto impide que otra página enlace nuestra música o que el sitio de alguien la sirva, y que un buscador la indexe como colección, pero no es un secreto. Lo que cuida el espíritu de los términos es que no hay lista, que el servicio no es una descarga y que el sitio la usa como parte de un juego.

## Los archivos

Diez camas, con nombres fijos: `race`, `chovena`, `trompo`, `pinata`, `oruro`, `wheel`, `teleferico`, `sapo`, `guajojo` y `toborochi`, cada una `<juego>.mp3`. Pesan unos 280 KB cada una (2,75 MB en total), muy por debajo de los límites de los dos caminos (R2 gratis: 10 GB y 10 millones de lecturas por mes, sin costo de salida; archivos propios del Worker: 20.000 archivos de hasta 25 MiB).

**Camino B (hoy).** Copiar las diez a `camas/` y desplegar; el despliegue las lleva con el Worker:

```bash
node subir.mjs --desde <carpeta con los mp3> --copiar --seco   # revisa y muestra, no copia nada
node subir.mjs --desde <carpeta con los mp3> --copiar          # copia a camas/
```

**Camino A (con R2).** Subir (o reemplazar) todas, desde esta carpeta y con la sesión de `wrangler login` de la cuenta de Tinkazo:

```bash
node subir.mjs --desde <carpeta con los mp3> --seco   # revisa y muestra, no toca la nube
node subir.mjs --desde <carpeta con los mp3>          # sube de verdad
```

La carpeta también puede venir en la variable `MUSICA_DIR`. Si falta un archivo o no parece un mp3, el guion falla antes de copiar o subir ninguno. Para una sola en R2:

```bash
npx wrangler@4 r2 object put tinkazo-musica/race.mp3 --file <ruta>/race.mp3 --content-type audio/mpeg --remote
```

Como los archivos se sirven con `immutable` durante un año, **si una cama cambia hay que cambiarle el nombre** (o sumar una versión en `musica-remota.ts`): los navegadores no la van a volver a pedir.

## Desplegar

Lo despliega quien mantiene el proyecto. Las comprobaciones del final valen para los dos caminos.

**Camino B, archivos propios (no pide R2):**

```bash
# 1. Copiar las camas a camas/ (fuera del repositorio).
node subir.mjs --desde <carpeta con los mp3> --copiar
# 2. El Worker, con las camas adentro. m.tinkazo.app es un dominio propio del Worker:
#    el despliegue crea el registro DNS y el certificado.
npx wrangler@4 deploy
```

**Camino A, R2 (cuando esté habilitado en el panel de Cloudflare):**

```bash
# 1. El bucket (una vez).
npx wrangler@4 r2 bucket create tinkazo-musica
# 2. Los archivos.
node subir.mjs --desde <carpeta con los mp3>
# 3. El Worker con el config de R2.
npx wrangler@4 deploy -c wrangler.r2.toml
```

**Revisar contra producción:** con origen del sitio, sin origen y con otro.

```bash
curl -sI -H "Origin: https://tinkazo.app" https://m.tinkazo.app/race.mp3   # 200, audio/mpeg
curl -sI https://m.tinkazo.app/race.mp3                                     # 403
curl -sI -H "Origin: https://otra.com" https://m.tinkazo.app/race.mp3       # 403
```

Corre en el plan gratis de Workers. Para pasar del B al A, no hace falta tocar el sitio: se sube a R2 y se despliega con `-c wrangler.r2.toml`.

## Probar

```bash
# Las pruebas de unidad (una R2 de mentira), desde la raíz del repositorio:
pnpm exec vitest run --maxWorkers=3 workers/musica src/sonidos

# El Worker de verdad, en local (workerd, sin tocar la nube). Camino B, con camas/ ya copiada:
npx wrangler@4 dev --port 8794
curl -si -H "Origin: https://tinkazo.app" http://127.0.0.1:8794/race.mp3 | head
curl -s -D - -o /dev/null -H "Origin: https://tinkazo.app" -H "Range: bytes=0-99" http://127.0.0.1:8794/race.mp3   # 206

# Camino A, con una R2 local:
npx wrangler@4 r2 object put tinkazo-musica/race.mp3 --file <ruta>/race.mp3 --content-type audio/mpeg --local --persist-to .wrangler/estado -c wrangler.r2.toml
npx wrangler@4 dev -c wrangler.r2.toml --port 8794 --persist-to .wrangler/estado
```

La lógica está en `src/logica.ts` y no importa nada de Cloudflare: recibe una fuente de bytes (`get`/`head`), que es un bucket de R2 o, con `fuenteDeAssets`, el binding `ASSETS`. Las pruebas corren el mismo contrato con las dos. `src/index.ts` elige la fuente. Con archivos propios, los tramos (`Range`) y el tamaño los calcula el Worker, porque `ASSETS` no los entrega bien en local.

## Del lado del sitio

`src/sonidos/musica-remota.ts` devuelve `https://m.tinkazo.app/<juego>.mp3` solo cuando el sitio corre en `tinkazo.app` o `www.tinkazo.app` y el navegador no pide ahorrar datos. En cualquier otro lado (localhost, las vistas de Vercel, una copia del sitio) devuelve `null` y el sonido sigue con los osciladores.

### Las pistas por secciones

El mismo servicio entrega las pistas de música por secciones (`src/sonidos/pistas.ts` y `src/sonidos/pistas-enganche.ts`): cada juego con pista tiene cinco archivos, `<juego>-<version>-<seccion>.mp3` (entrada, cuerpo, subida, golpe y festejo), que se piden con la misma puerta por `Origin`. El JSON de cada pista (el pulso, los bordes y las ganancias, sin audio) sí va en el repositorio, en `src/sonidos/pistas/<juego>.json`, y se suma en `src/sonidos/pistas-lista.ts`. Esa lista trae solo las pistas que ya se escucharon dentro del juego (hoy, la carrera): el interruptor es uno solo para todos los juegos, así que una pista en la lista suena apenas se prende. Las demás están armadas en la misma carpeta y no se importan hasta que alguien las escuche. Los nombres no pueden pasar de 32 caracteres y, como los archivos se sirven inmutables, una pista que cambia lleva otra versión.

Las pistas se prenden con la bandera de construcción `VITE_MUSICA=pistas` o con `?musica=pistas` en la dirección, y se apagan con `?musica=sintetizada`; sin nada de eso suena la música de osciladores. Si un archivo no llega o no decodifica, también. `subir.mjs` todavía sube solo los diez nombres fijos de las camas: para subir pistas hay que ampliarlo.

## El kit para creadores (`/kit/`)

El mismo Worker entrega, **sin puerta por `Origin`**, el kit para quien quiera hacer videos de Tinkazo (TikTok, Reels, Shorts): los clips verticales de cada juego (cada uno con su versión `-bucle`), el logo animado de entrada y de salida, las placas, los guiones y los subtítulos. Es público a propósito: hecho para bajarlo.

| Pedido | Respuesta |
| --- | --- |
| `GET /kit/<archivo>` (nombre simple: minúsculas, números, guiones y puntos; `mp4`, `webm`, `mov`, `png`, `jpg`, `webp`, `svg`, `srt`, `txt`, `zip` o `json`) | `200` (o `206` con `Range`), con `Content-Disposition: attachment`, `Access-Control-Allow-Origin: *` y `Cache-Control: public, max-age=3600` |
| `HEAD /kit/<archivo>` | Las mismas cabeceras, sin cuerpo |
| `GET /kit/lista.json` | Lo que hay: nombre, tamaño y tipo de cada archivo (lo arma `subir-kit.mjs`) |
| Un archivo que no está, o una ruta que no es de un archivo del kit | `404` |
| Cualquier otro método | `405` |

La lógica está en `src/kit.ts` (se prueba en `src/kit.test.ts`). Los videos **no se versionan**: se graban con `scripts/marca/videos/` en una carpeta privada y se suben con `subir-kit.mjs`. Hasta que quien mantiene el proyecto los apruebe no se sube nada, y la página `marca.html` no muestra los enlaces (`KIT_PUBLICADO` en `src/marca-creadores.ts` está en `false`).

**Camino B (hoy, sin R2):** los archivos van a `camas/kit/` (ignorada por git, cada uno hasta 25 MiB) y se despliegan con el Worker.

```bash
node subir-kit.mjs --desde <carpeta con el kit> --copiar --seco   # revisa y muestra, no copia nada
node subir-kit.mjs --desde <carpeta con el kit> --copiar          # copia a camas/kit/ y arma lista.json
npx wrangler@4 deploy
```

**Camino A (con R2):** un bucket aparte, `tinkazo-kit`, con los archivos en la raíz.

```bash
npx wrangler@4 r2 bucket create tinkazo-kit
node subir-kit.mjs --desde <carpeta con el kit>                   # sube de verdad (--seco para revisar)
npx wrangler@4 deploy -c wrangler.r2.toml
```

**Revisar contra producción:**

```bash
curl -sI https://m.tinkazo.app/kit/tinkazo-ruleta-9x16.mp4          # 200, video/mp4, attachment, sin Origin
curl -s  https://m.tinkazo.app/kit/lista.json
curl -s -o /dev/null -w "%{http_code}\n" https://m.tinkazo.app/kit/  # 404: no hay listado
```

Un archivo del kit que cambia conviene que cambie de nombre (`-v2`): el caché de una hora basta para correcciones, no para reemplazos grandes.
