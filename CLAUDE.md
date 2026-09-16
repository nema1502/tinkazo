# Tinkazo — guía para el proyecto

## Qué es

Sorteos verificables para comunidades. Hoy es un sitio estático (`index.html` único, sin build) desplegado en Vercel en https://tinkazo.vercel.app. El objetivo es anclar el sello de la lista y el resultado en Stellar (Soroban).

## Reglas del repositorio

- **Es público.** Nunca commitear `.env*`, `.vercel/`, tokens ni llaves privadas. La única llave que vive en el código es la publishable key de Clerk, que es pública por diseño.
- **Idioma.** Documentación, commits e issues en español. La interfaz es bilingüe ES / EN: todo texto visible nuevo va en ambos idiomas (diccionario `T` en `index.html`).
- **Sin dependencias en el demo estático.** Mientras el sitio sea un solo archivo, se queda sin build y sin `node_modules`. Cuando llegue la integración con Stellar se decide el stack con `create-architecture`.
- **La verificación es gratis siempre.** Cualquier cambio en el algoritmo del sorteo debe seguir siendo determinista y recomputable por un tercero con la lista sellada y la ronda de drand.

## Skills

`.claude/skills/` trae el kit de Stellar-Elite-Bolivia. Empezar por [`SKILL_ROUTER.md`](.claude/skills/SKILL_ROUTER.md): mapea frases a skills por fase (idea, planificación, arquitectura, implementación, review, lanzamiento). Los artefactos entre fases van en `.stellar-new/` en la raíz del repo.

## Estructura

```
index.html      Sitio completo
docs/           Idea original (Arkiv) y capturas
.claude/skills  Skills para construir en Stellar
```
