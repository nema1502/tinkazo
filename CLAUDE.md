# Tinkazo: guía para el proyecto

## Qué es

Sorteos verificables para comunidades. La lista se sella con SHA-256 antes de que exista la semilla; la semilla es una ronda futura de drand quicknet cuya firma BLS verifica un contrato Soroban en Stellar; la selección es determinista y cualquiera la recomputa. El show es presentación, no mecanismo: seis juegos, y ninguno decide nada.

Sitio en producción: https://tinkazo.vercel.app

## Documentos que mandan

- [docs/protocolo.md](docs/protocolo.md), especificación normativa del sorteo (v2). Si el código difiere, el código está mal.
- [docs/architecture.md](docs/architecture.md), decisiones técnicas, patrones y estructura.
- [docs/prd.md](docs/prd.md), requisitos (FR/NFR) y alcance.
- [docs/epics.md](docs/epics.md), historias con criterios de aceptación y estado.
- [docs/deployments.md](docs/deployments.md), direcciones del contrato por red y costos medidos.
- [docs/juegos.md](docs/juegos.md), el contrato que cumple todo juego y las 15 comprobaciones del auditor.
- [docs/marca.md](docs/marca.md), paleta con los contrastes medidos, tipografía y cómo se escribe.
- [docs/vectors.json](docs/vectors.json), vectores de prueba compartidos por Rust y TypeScript.

## Reglas del repositorio

- **Es público.** Nunca commitear `.env*`, `.vercel/`, `.stellar/` (identidades de la CLI con semillas), tokens ni llaves. Las llaves publicables (Pollar `pub_…`) van en `.env.local` igual.
- **Idioma.** Documentación, commits e issues en español. Identificadores de código en inglés. La interfaz es bilingüe: toda cadena visible nueva va en `es` y `en` en el mismo cambio.
- **Determinismo.** La lógica del sorteo vive solo en `contracts/raffle/src/{drand,select}.rs` y `src/protocol/*`. Ambas implementaciones deben pasar `docs/vectors.json`.
- **Se entra con cuenta.** Desde el 20 de septiembre de 2026 hay que conectar una cuenta para sortear: así todos los sorteos nacen atribuibles y verificables. El código del modo libre sigue ahí y se usa de respaldo cuando la cuenta conectada no puede pagar la comisión. Los participantes siguen sin necesitar nada.
- **Errores del contrato son ABI.** Nunca renumerar `Error`. Nuevos eventos son nuevas variantes.
- **Sin atribuciones automáticas** en commits ni PRs.

## Comandos

```bash
# Contrato (Rust 1.98, target wasm32v1-none, soroban-sdk 27, stellar-cli 28)
cargo test --workspace
cargo build --release --target wasm32v1-none -p tinkazo-raffle
stellar contract build            # equivalente, con optimización

# Frontend (pnpm 11, Vite 8, TypeScript 7)
pnpm install
pnpm dev            # http://localhost:5173
pnpm typecheck
pnpm test           # Vitest: protocolo v2 contra docs/vectors.json
pnpm build          # tsc --noEmit + vite build → dist/

# Smoke test del sitio construido con Chrome headless (DevTools, sin dependencias)
pnpm preview &      # sirve dist/ en :4173
node scripts/smoke.mjs "http://localhost:4173/?demo=wheel&instant=1&lead=3"
```

Parámetros de URL útiles: `?lang=en`, `?theme=light|dark`, `?demo=stellar|ledger|pasanaku|race|rockets|wheel` (carga el ejemplo, sella y sortea), `?instant=1` (sin animaciones), `?lead=N` (segundos hasta la ronda objetivo, mínimo 3; solo modo libre), `?pose=1` (escena fija del estadio).

```bash
# Auditor de juegos: 15 comprobaciones por juego, contra drand de verdad
node scripts/audit-game.mjs <juego> --base http://localhost:4173

# Auditor de sonido: engancha los osciladores y mide afinación, registro,
# volumen, huecos de silencio y golpes repetidos. Sin oídos.
node scripts/audit-sound.mjs todos --base http://localhost:4173

# Auditor de interfaz: cabecera, panel de cuenta y selector, en escritorio y
# celular, en los dos temas. Imágenes rotas, texto cortado, contraste,
# blancos de toque y scroll horizontal.
node scripts/audit-ui.mjs --base http://localhost:4173

# Las fuentes de las tarjetas de historia siguen vivas
pnpm check:lore

# Las páginas de lectura (juegos, historia, seguridad, precios): imágenes,
# traducciones, celular, temas y blancos de toque. Corre también en la CI.
pnpm check:paginas

# Cuántos días le quedan al contrato antes de que la red archive sus datos.
# Sale con error por debajo de 30 días; --dias N cambia el umbral.
pnpm check:renta
```

En la máquina del autor (Windows sin MSVC) el toolchain es `stable-x86_64-pc-windows-gnu`; `cargo` está en `~/.cargo/bin` y `stellar.exe` en `C:\Program Files (x86)\Stellar CLI\`.

## Skills

`.claude/skills/` trae el kit de Stellar-Elite-Bolivia (stellar.new + BMAD). Entrada: [`SKILL_ROUTER.md`](.claude/skills/SKILL_ROUTER.md). La configuración en `.stellar-build/bmm/config.yaml` apunta los artefactos de planificación a `docs/` y las historias a `docs/stories/`. Para implementar una historia: `dev-story` con la historia de `docs/epics.md`; para contratos, `smart-contracts`; para el frontend, `dapp`; antes de mainnet, `deploy-stellar-mainnet`.

## Estructura

```
index.html          Entrada de Vite (markup del sitio)
juegos.html         Los seis juegos, con la captura del estadio de cada uno
historia.html       De dónde salen el nombre, la llama y el aguayo
seguridad.html      Qué impide el protocolo, el ataque abierto y los límites
precios.html        Qué cuesta y cómo funciona por dentro
public/             juegos/*.webp, sitemap.xml y robots.txt
verificar.html      Página de verificación, solo lectura
src/                Frontend TypeScript: main, i18n, state, narrator, protocol/, stellar/, ui/, games/
src/games/overlay.ts  Andamiaje de los juegos: estadio, azar sembrado, chips, saltar, desmontaje
scripts/            deploy.sh (contrato), smoke.mjs (sitio), audit-game.mjs, check-lore.mjs
contracts/raffle/   Contrato Soroban tinkazo-raffle (lib, drand, select, test)
docs/               PRD, arquitectura, protocolo, épicas, despliegues, vectores, capturas
.claude/skills/     Skills para construir en Stellar
.github/workflows/  CI
```
