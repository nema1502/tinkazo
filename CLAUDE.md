# Tinkazo — guía para el proyecto

## Qué es

Sorteos verificables para comunidades. La lista se sella con SHA-256 antes de que exista la semilla; la semilla es una ronda futura de drand quicknet cuya firma BLS verifica un contrato Soroban en Stellar; la selección es determinista y cualquiera la recomputa. El show (carrera de llamas, ruleta) es presentación, no mecanismo.

Sitio en producción: https://tinkazo.vercel.app (hoy el demo v1, un solo `index.html`).

## Documentos que mandan

- [docs/protocolo.md](docs/protocolo.md) — especificación normativa del sorteo (v2). Si el código difiere, el código está mal.
- [docs/architecture.md](docs/architecture.md) — decisiones técnicas, patrones y estructura.
- [docs/prd.md](docs/prd.md) — requisitos (FR/NFR) y alcance.
- [docs/epics.md](docs/epics.md) — historias con criterios de aceptación y estado.
- [docs/deployments.md](docs/deployments.md) — direcciones del contrato por red y costos medidos.
- [docs/vectors.json](docs/vectors.json) — vectores de prueba compartidos por Rust y TypeScript.

## Reglas del repositorio

- **Es público.** Nunca commitear `.env*`, `.vercel/`, `.stellar/` (identidades de la CLI con semillas), tokens ni llaves. Las llaves publicables (Pollar `pub_…`) van en `.env.local` igual.
- **Idioma.** Documentación, commits e issues en español. Identificadores de código en inglés. La interfaz es bilingüe: toda cadena visible nueva va en `es` y `en` en el mismo cambio.
- **Determinismo.** La lógica del sorteo vive solo en `contracts/raffle/src/{drand,select}.rs` y `src/protocol/*`. Ambas implementaciones deben pasar `docs/vectors.json`.
- **Modo libre siempre funciona.** Sin wallet ni red de Stellar el sitio sigue sorteando (sellado local + quicknet verificado en el navegador).
- **Errores del contrato son ABI.** Nunca renumerar `Error`. Nuevos eventos son nuevas variantes.
- **Sin atribuciones automáticas** en commits ni PRs.

## Comandos

```bash
# Contrato (Rust 1.98, target wasm32v1-none, soroban-sdk 27, stellar-cli 28)
cargo test --workspace
cargo build --release --target wasm32v1-none -p tinkazo-raffle
stellar contract build            # equivalente, con optimización

# Frontend (pnpm 11, Vite 8, TypeScript 7) — a partir de la historia 2.1
pnpm install
pnpm dev
pnpm test
pnpm build
```

En la máquina del autor (Windows sin MSVC) el toolchain es `stable-x86_64-pc-windows-gnu`; `cargo` está en `~/.cargo/bin` y `stellar.exe` en `C:\Program Files (x86)\Stellar CLI\`.

## Skills

`.claude/skills/` trae el kit de Stellar-Elite-Bolivia (stellar.new + BMAD). Entrada: [`SKILL_ROUTER.md`](.claude/skills/SKILL_ROUTER.md). La configuración en `.stellar-build/bmm/config.yaml` apunta los artefactos de planificación a `docs/` y las historias a `docs/stories/`. Para implementar una historia: `dev-story` con la historia de `docs/epics.md`; para contratos, `smart-contracts`; para el frontend, `dapp`; antes de mainnet, `deploy-stellar-mainnet`.

## Estructura

```
index.html          Sitio v1 (entrada de Vite tras la historia 2.1)
src/                Frontend TypeScript (protocol/, stellar/, games/, ui/)
contracts/raffle/   Contrato Soroban tinkazo-raffle (lib, drand, select, test)
docs/               PRD, arquitectura, protocolo, épicas, despliegues, vectores, capturas
.claude/skills/     Skills para construir en Stellar
.github/workflows/  CI
```
