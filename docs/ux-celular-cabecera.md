# Cabecera en el celular

A 320, 360, 375 y 414 px, la cabecera cerrada conserva dos filas:

1. Logo, ES/EN y cuenta (silueta, ruedita o cara con ✓).
2. **Sortear**, Mis sorteos y Más (Draw, My draws y More en inglés).

No se achican las letras ni los blancos de toque de 44 × 44 px. Se reduce el aire entre piezas y el relleno lateral de la navegación. Sortear sigue siendo la única acción amarilla de navegación; no cambia la paleta ni la jerarquía del flujo. El correo sigue fuera de la cabecera, incluso cuando llega como nombre de la cuenta.

En estos anchos, la insignia de red incorrecta conserva el texto para lectores de pantalla y se representa junto a la cara mediante un borde naranja doble. La advertencia completa de red incorrecta sigue en la página y el panel de cuenta conserva la red. La cabecera no crea ni cambia mensajes de error.

**Más no cambia:** se cierra con otro toque, fuera de la lista, Escape (devolviendo el foco), al elegir un enlace y al pasar a escritorio. La geometría de escritorio y de las páginas de lectura se conserva.

## Comprobación reproducible

Con Vite local ya iniciado y Playwright instalado (sin modificar dependencias):

```bash
PLAYWRIGHT_PATH=/home/agent/.npm/_npx/6bcb61ec6d5aea22/node_modules/playwright/index.mjs \
CHROME=/home/agent/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
CDP_PORT=9611 exclusive e2e-tinkazo-celular-header -- heavy -- \
node scripts/audit-celular-header.mjs \
  --base http://127.0.0.1:5173 \
  --out .evidence/celular/header/recheck \
  --screenshots docs/capturas/celular/header/recheck \
  --source REFERENCIA
```

- `PLAYWRIGHT_PATH`: módulo de una instalación existente; sin esta variable se importa `playwright` normalmente.
- `--widths`: por defecto `320,360,375,414,1024,1440`, todos a 844 px de alto. El criterio táctil de 44 × 44 se exige en los cuatro anchos de celular.
- `--compare-css ARCHIVO_BASE`: compara además la geometría pública de 1024 y 1440 px con una copia aislada del CSS anterior y su agrupación original de idioma/cuenta. El auditor no consulta Git. La copia se prepara fuera del checkout; no se copian dependencias.
- `--out`: JSON con comprobaciones, medidas, fallos, referencia declarada y SHA-256 de los archivos de cabecera. Sale con 0 si todo pasa y 1 si hay fallos.
- `--screenshots`: seis capturas representativas de 320 px por corrida; el JSON conserva todos los casos. Ambas rutas deben estar bajo las carpetas de esta unidad.
- `--help`: uso y opciones. Requiere el servidor Vite porque importa los módulos TypeScript de producción.

Se abre un contexto limpio por página/ancho/idioma/tema. Se carga la aplicación real (`/`) y una página de lectura (`/juegos.html`), en ES/EN y claro/oscuro. Los cinco estados son fixtures de presentación: sin cuenta, conectando, retomando, dentro y red incorrecta. Usan `estadoCuenta` y `crearChip` de producción; no duplican la normalización ni el HTML del chip. En lectura se inyectan también estados transitorios como comprobación de resistencia: la página normalmente solo muestra fuera/dentro.

Se comprueban filas y orden, rectángulos, solapamientos, centros alcanzables, blancos de toque, scroll horizontal, correo ausente y los cinco cierres del menú. No se autentica ni firma nada y se bloquean solicitudes externas. Las recargas HMR se desactivan durante la medición para que otra unidad no interrumpa la captura.

## Evidencia de esta unidad

- Base de fuente: `e05a802c6bf6932962d766bdcb7b4e276be33c28`. Antes de editar HTML/CSS: `.evidence/celular/header/before/`, 552 comprobaciones, **100 fallos**, salida 1. Se confirmó H1: a 320 px el logo queda solo y la cabecera crece a tres filas (197 px); además, el botón Más excede el borde derecho en español. Conectando/retomando dejan una pieza de 42 px de ancho. La insignia de red incorrecta agrega una fila en los anchos móviles.
- Después: `.evidence/celular/header/final/`, **632 comprobaciones, 0 fallos**, salida 0. Incluye 80 comparaciones idénticas de geometría con el CSS base en escritorio/lectura. Los cierres de Más ya funcionaban antes y siguen funcionando: `src/ui/menu.ts` queda intacto, como `cuenta-chip.ts`.
- Capturas representativas: `docs/capturas/celular/header/before/` y `docs/capturas/celular/header/final/`. Los registros separan stdout, stderr y código de salida. `summary.json` conserva identidad de fuente y medidas por caso.
- Se conservan también `after/` (corrida interrumpida por recarga mientras otra unidad escribía) y `green/` (552 comprobaciones sin fallos antes de agregar la comparación diferencial).

**Límite de la prueba:** Chromium 153 headless, viewport emulado; no Android/iPhone físico ni Safari real. Los estados de cuenta son sintéticos en la aplicación real, no sesiones autenticadas con proveedores. Esta prueba demuestra la cabecera, no los flujos de ingreso, sello, espera o pantalla completa, que corresponden a la otra unidad y a la verificación integral. La corrección solo cambia HTML/CSS: una prueba de texto fuente o jsdom no demuestra el reflujo; la prueba determinista aplicable es este auditor de navegador.
