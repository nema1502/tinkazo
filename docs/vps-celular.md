# Revisar Celular en la VPS

La instancia de revisión es la aplicación **tinkazo-web** del proyecto **Tinkazo** en Dokploy. **Tinkazo Studio es otro software y no se modifica.** La rama de origen es `guido/celular`; el PR a `main` permanece abierto, sin integrar.

## Empaquetado

`Dockerfile` construye el sitio con Node24 y pnpm11, usando el lockfile congelado y `pnpm build`. La imagen final solo recibe `dist/` y la configuración de Nginx: no incluye Node, fuentes, Git ni archivos `.env`. `.dockerignore` excluye dependencias locales, registros, capturas y herramientas de agente.

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

El despliegue se hace únicamente mediante Dokploy MCP; después se verifica el estado, la respuesta del sitio y la cabecera en navegador. La verificación independiente y los resultados del despliegue se agregarán al observarse: todavía no se dan por aprobados.
