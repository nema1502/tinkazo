# Verificación de Marca

Código de producto: `07c8a2369ff577703a84e706df657736f89d0cab`, desde `6c583e98ee0864be13297297f7521097cc494b53`. Rama `guido/marca`, independiente de Celular. Sin cambios de producción, protocolo, juegos, Worker, icono original ni paleta.

## Resultado local observado

- `pnpm typecheck`: exit 0.
- `pnpm test --maxWorkers=2`: exit 0; 154 archivos, 3149 pruebas aprobadas y cuatro pruebas testnet opt-in omitidas. No son pruebas testnet aprobadas.
- `pnpm build`: exit 0; incluye `marca.html` y recursos descargables.
- `pnpm check:glosario`: exit 0, 15 archivos. Se mantienen dos usos de «avisar» para decidir y los avisos previos de Vite sobre __dirname y tutorial.
- WebKit normal: 12/12 vistas, ES/EN × claro/oscuro × 320/390/1280 px, sin excepciones, textos pendientes ni imágenes rotas; cero desborde horizontal, también con «Más» abierto.
- Se descargaron realmente SVG, PNG y sello de cada idioma; los bytes coinciden con los recursos públicos, abren como imágenes y rasterizan con píxeles transparentes y opacos. PNG 2048×2048, SVG 512×512, sellos 960×280.
- Copia mediante teclado y estado de error: portapapeles **simulado**; no acredita permisos del portapapeles del sistema.
- Diferencial del hook público de Vite: nueve páginas anteriores conservan exactamente el resultado ante el mismo idioma/tema. Historia conserva su diccionario reducido; portada sin diccionario duplicado.
- La evaluación nativa del alcance normalizado informó riesgo medio, `reviewDue=false`, `under_budget`: revisión propia requerida, sin verificador independiente. No se abrió una transacción de revisión nativa.

Entorno: Node 24.22.1, pnpm 12.14, Vite 8.3.0 y Vitest 5.0.1. Logs completos e identidades en `.evidence/marca/final-r2/`, `.evidence/marca/browser-r2/` y `.evidence/marca/browser-r2.log`; no son parte del sitio publicado.

## Capturas revisadas

Son emulación de viewport en navegador real, no dispositivos físicos.

| Idioma y tema | Vista | Captura |
|---|---:|---|
| ES claro | 320 px | [Celular](capturas/marca/es-light-320.png) |
| ES oscuro | 390 px | [Celular](capturas/marca/es-dark-390.png) |
| EN claro | 1280 px | [Escritorio](capturas/marca/en-light-1280.png) |
| EN oscuro | 1280 px | [Escritorio](capturas/marca/en-dark-1280.png) |

El aviso del sello está junto al recurso y limita su uso al sorteo con comprobante verificable: no certifica la preparación de la lista inicial. No se copiaron recursos ni identidad de puls3; su referencia devolvió HTTP 200 y se inspeccionó visualmente, pero su contenido esperado no estuvo disponible en `body.innerText`.

## Fallos preservados y límites

El primer auditor estricto encontró 1 px de desborde a 320 px. «Más» terminaba en 320,765625; Historia reproduce el problema previo. La corrección solo usa `pagina-marca` y dos reglas móviles locales, sin ocultar ni recortar contenido. El menú abierto/cerrado se verifica de nuevo. RED, intentos intermedios y corrida anterior de las puertas se conservan, separados de la evidencia final.

Chromium local no inicia con su sandbox requerido; no se desactivaron protecciones. El comprobador existente de páginas usa ese motor y su ejecución de CI sigue pendiente, no se presenta como aprobado localmente. WebKit sí se ejecutó. La vista previa de Vercel debe comprobarse después de crear el PR; no hay aceptación de esa vista previa todavía. No se probó hardware físico ni acceso real de proveedor.
