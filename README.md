# Tinkazo 🦙

**Sorteos que no se pueden arreglar.**

En Bolivia, un *tinkazo* es esa corazonada de que hoy tienes suerte. Tinkazo es una plataforma de sorteos para comunidades donde la suerte es divertida de ver (carrera de llamas, ruleta) e imposible de manipular: la lista de participantes se sella antes del sorteo y la aleatoriedad viene de un faro público que nadie controla.

🌐 **Demo en vivo:** [tinkazo.vercel.app](https://tinkazo.vercel.app)

![Tinkazo — carrera de llamas en modo estadio](docs/capturas/tinkazo-estadio.png)

## Cómo funciona

1. **Cargás la lista.** Pegás nombres o subís un CSV. Los participantes no necesitan cuenta ni wallet.
2. **Se sella la lista.** El navegador calcula el SHA-256 de la lista ordenada. Ese hash es el compromiso público: después de sellar, nadie puede agregar ni quitar gente sin que se note.
3. **Llega la semilla.** La aleatoriedad la aporta [drand](https://drand.love) (League of Entropy), un faro público y verificable. Ni el organizador ni Tinkazo pueden elegirla.
4. **El show.** El resultado ya está determinado por `hash(lista) + semilla`. La carrera de llamas o la ruleta son la presentación teatral, no el mecanismo.
5. **Cualquiera verifica.** Con el hash de la lista, la ronda de drand y el algoritmo (público y determinista) se recomputa el ganador desde cero.

Interfaz bilingüe ES / EN, modo claro y oscuro, modo estadio a pantalla completa con narrador, y QR de verificación para compartir con la sala.

## Estado del proyecto

Hoy Tinkazo es un **demo estático funcional**: un solo `index.html` autocontenido, sin build ni dependencias. El sellado y la verificación ocurren en el navegador.

El siguiente paso es llevar la capa de confianza a **Stellar**:

- Anclar el sello de la lista y el resultado del sorteo en un contrato Soroban, con timestamp inmutable en la red.
- Publicar cada sorteo como un registro consultable vía Stellar RPC, para que la verificación no dependa de que Tinkazo siga en línea.
- Wallet solo para el organizador (Freighter / Stellar Wallets Kit). Los participantes siguen entrando sin cuenta.
- Costos de centavos por sorteo, para que la verificación siga siendo gratis para las comunidades.

La idea original (concebida para el ideathon de Arkiv, agosto 2026) está en [docs/idea-original-arkiv.md](docs/idea-original-arkiv.md). El modelo de datos y las invariantes se mantienen; cambia la red que los ancla.

## Correr en local

No hace falta instalar nada. Abrí `index.html` en el navegador, o servilo con cualquier servidor estático:

```bash
npx serve .
```

## Estructura

```
index.html            Sitio completo: landing, juegos, sellado y verificación
docs/                 Idea original y capturas de pantalla
.claude/skills/       Kit de skills para construir en Stellar (ideas → PRD → arquitectura → Soroban → mainnet)
```

Las skills en `.claude/skills/` vienen de [Stellar-Elite-Bolivia](https://github.com/nema1502/Stellar-Elite-Bolivia) y guían el desarrollo con Claude Code: contratos Soroban, dApps con `@stellar/stellar-sdk`, estándares SEP/CAP, checklist de despliegue a mainnet y preparación para Stellar Community Fund. El punto de entrada es [`.claude/skills/SKILL_ROUTER.md`](.claude/skills/SKILL_ROUTER.md).

## Capturas

| Landing | Ruleta | Estadio |
|---|---|---|
| ![Landing](docs/capturas/tinkazo-light.png) | ![Ruleta](docs/capturas/tinkazo-ruleta.png) | ![Carrera](docs/capturas/tinkazo-carrera.png) |

## Contribuir

Es código libre. Issues y pull requests son bienvenidos. Si encontrás una forma de manipular un sorteo, abrí un issue: ese es exactamente el tipo de reporte que más nos sirve.

## Licencia

[MIT](LICENSE) © 2026 Nicolás Emir Mejía Agreda

---

## English summary

**Tinkazo** is a raffle platform for communities where luck is fun to watch (llama race, roulette) and impossible to rig. The participant list is sealed with SHA-256 before the draw, randomness comes from the public [drand](https://drand.love) beacon, and anyone can recompute the winner from the sealed list and the beacon round. The game on screen is the show; the math is the guarantee.

Today it is a single self-contained `index.html` with no build step. Next: anchoring the list seal and draw result on **Stellar** via a Soroban contract, so verification does not depend on Tinkazo staying online. Organizers use a wallet; participants never need one.

Live demo: [tinkazo.vercel.app](https://tinkazo.vercel.app) · Licensed under MIT.
