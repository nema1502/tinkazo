# Cabecera en el celular

A 320, 360, 375 y 414 px, la cabecera cerrada conserva dos filas:

1. Logo, ES/EN y cuenta (silueta, ruedita o cara con ✓).
2. **Sortear**, Mis sorteos y Más (Draw, My draws y More en inglés).

No se achican las letras ni los blancos de toque de 44 × 44 px. Se reduce el aire entre piezas y el relleno lateral de la navegación. Sortear sigue siendo la única acción amarilla de navegación; no cambia la paleta ni la jerarquía del flujo. El correo sigue fuera de la cabecera, incluso cuando llega como nombre de la cuenta.

En estos anchos, la insignia de red incorrecta conserva el texto para lectores de pantalla y se representa junto a la cara mediante un borde naranja doble. La advertencia completa de red incorrecta sigue en la página y el panel de cuenta conserva la red. La cabecera no crea ni cambia mensajes de error.

**Más no cambia:** se cierra con otro toque, fuera de la lista, Escape (devolviendo el foco), al elegir un enlace y al pasar a escritorio. La geometría de escritorio y de las páginas de lectura se conserva.

## Cómo se comprueba

`node scripts/audit-flujo.mjs --base http://localhost:4173 --solo-anchos` mide la cabecera a 320, 360, 375 y 414 px, en español e inglés y en los dos temas: dos filas, sin scroll horizontal, blancos de toque de 44 px o más y nada pisado. `node scripts/audit-ui.mjs` mira la cabecera, el panel de cuenta y el selector, en escritorio y celular.

**Límite de la prueba:** son medidas en Chrome con pantalla emulada. Falta mirarla en un Android y un iPhone de verdad.
