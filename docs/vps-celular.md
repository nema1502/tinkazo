# Revisar Celular en la VPS

La instancia de revisión es la aplicación **tinkazo-web** del proyecto **Tinkazo** en Dokploy. **Tinkazo Studio es otro software y no se modifica.** La rama de origen es `guido/celular`; el PR a `main` permanece abierto, sin integrar.

## Empaquetado

`Dockerfile` construye el sitio con Node24 y pnpm11, usando el lockfile congelado y `pnpm build`. La imagen final solo recibe `dist/` y la configuración de Nginx: no incluye Node, árbol de fuentes, Git ni archivos `.env`. La distribución sí contiene los source maps existentes de Vite, con código embebido (`sourcemap: true` ya estaba en `main`); este cambio no modifica esa política. `.dockerignore` excluye dependencias locales, registros, capturas y archivos auxiliares del entorno de trabajo.

Nginx sirve las entradas multipágina y los assets. `/c/<id>` sirve `c.html` conservando la URL y `X-Robots-Tag: noindex`; no modifica el Worker ni el protocolo del enlace. Un asset inexistente devuelve404, no HTML.

## Instancia y cambio autorizado

- Aplicación Dokploy: `wKzcRd7M3bEUloe4arJi5` (`tinkazo-web-kxcmff`).
- Repositorio: `https://github.com/nema1502/tinkazo.git`.
- Dominio existente: `https://tinkazo-web-kxcmff-93505b-31-97-78-167.sslip.io`.
- Origen anterior: rama `Guido`; nuevo origen solicitado: `guido/celular`.
- Se conservan dominio, puerto80, una réplica y el resto de la configuración. No se modifican Studio, bases de datos ni servicios compartidos.

## Verificación previa al cambio

- RED: `docker build --check .` falló con código1 por ausencia de `Dockerfile`.
- GREEN: `heavy -- docker build --progress=plain --label agent=1 --tag agent-tinkazo-celular:check .` terminó con código0 en41s; `nginx -t` aprobado.
- Imagen de prueba: `sha256:cdad1d2ccdaefbc1349a52cda36309105ed20d9215c6dbd9069d4151845f60b3`.
- Smoke en contenedor propio con puerto aleatorio:18 comprobaciones,0 fallos, exit0. Incluye entradas multipágina, rewrite exacto de `c.html` con noindex, JavaScript con MIME correcto, asset inexistente404 y navegador real Chromium1440/WebKit320. A320 la cabecera mantiene dos filas, sin desborde y con controles de al menos44×44px.
- El contenedor de prueba se eliminó al terminar. Registros completos locales: `.evidence/celular/vps/`.

El despliegue se hace únicamente mediante Dokploy MCP; después se verifica el estado, la respuesta del sitio y la cabecera en navegador. La verificación independiente aprobó S9–S11 dentro del alcance de empaquetado: hashes de fuente e imagen exactos, configuración Nginx válida y contenedores aislados sin árbol de fuentes, Git, `.env` ni runtime Node/pnpm. El primer probe que rechazaba mapas falló (exit1); se conservó y se corrigió el criterio para respetar los99 source maps preexistentes. El probe de runtime corregido pasó (exit0); también pasó el spot del coordinador (`nginx -t`).

Seguimiento no bloqueante: el caché de `/juegos/*` no replica la política específica de Vercel; no afecta rutas ni el funcionamiento y no se amplía esta unidad para ajustarlo. La preview de Vercel está protegida por login y no se acepta visualmente sin acceso.

## Despliegue observado

- Rama configurada y confirmada en Dokploy: `guido/celular`; commit desplegado: `61bbf122c786798102e6a9af0596a42b36b2e96f`.
- Deployment `BPaD-UdvhpjeW_KlI34On`: estado **done**. Dominio, puerto y configuración restante preservados; solo cambió `customGitBranch`.
- [Instancia para revisar](https://tinkazo-web-kxcmff-93505b-31-97-78-167.sslip.io): HTTP200; JavaScript `/assets/index-Bkh-4dnY.js` con SHA-256 `c5fe158cd8d8b932d2d6f9b3031260e994b2208f19bb10235152fea895a534cb`, idéntico a la imagen probada.
- Smoke sobre la URL pública: **18 comprobaciones,0 fallos, exit0**. Incluye rutas, rewrite/noindex, assets y navegadores reales Chromium1440 y WebKit emulando320px. No hay excepciones de página; a320 se mantienen dos filas y objetivos táctiles ≥44×44px, sin desborde.
- Capturas: [WebKit320](capturas/celular/vps/webkit-320.png) / [Chromium1440](capturas/celular/vps/chromium-1440.png).
- **No se integró el PR, no se cambió `main` por esta tarea y no se modificó Tinkazo Studio.** Las comprobaciones no autentican proveedores ni escriben en cadena.

La CI de sitio del commit61bbf12 falló por una palabra del texto operativo de este documento que el guard editorial del repositorio prohíbe. Se reprodujo localmente el fallo de `src/seo.test.ts` (exit1) y se corrigió solo esa redacción, sin cambiar el guard ni la aplicación. El diagnóstico inicial se conserva en `.evidence/celular/vps/ci-61bbf12-failure.log`; esa corrida no se presenta como aprobada. El archivo focalizado `src/seo.test.ts` volvió a verde:142 pruebas aprobadas, exit0. La suite completa posterior también pasó:157 archivos,3155 pruebas aprobadas y4 omitidas opt-in de testnet, exit0. La nueva CI se observará sobre el commit de corrección; la corrida inicialmente fallida sigue preservada.
