# La prueba del niño: el prompt del describidor

Este texto es fijo: es el mismo para todos los juegos (`audit-nino.mjs` lo copia a la carpeta de cada corrida). Lo lee el describidor, que **solo ve fotos**: ni el código, ni el relator, ni el juego, ni la verdad. Describe un modelo barato; si una foto falla, la repite otro más fuerte y decide el segundo.

## Lo que hacés

1. Abrí `preguntas.json` de esta carpeta. No abras ningún otro archivo que no sea una de las imágenes que ahí figuran: nada de código, nada de otras carpetas, nada de listar la carpeta para ver qué más hay.
2. Por cada captura, abrí su imagen (`imagen`) y contestá **solo lo que se ve** en esa foto. Cada foto se contesta sola: no uses lo que viste en las otras.
3. Escribí `respuestas-modelo.json` en esta carpeta: un objeto con un `id` por captura y, adentro, la respuesta de abajo. Todas las capturas, aunque no se vea nada.

## Lo que se ve

Es la foto de un sorteo animado en una sala. Gana una persona. La foto no tiene subtítulo, y la pantalla trae los nombres: contestá con nombres. La vara es la de alguien de 7 años: lee nombres, pero no lee frases largas.

## Las cuatro preguntas

1. **adelante**: ¿quién va ganando? Su nombre tal como se lee. Si no se lee, `no se ve`.
2. **hacia**: ¿hacia dónde van, o adónde hay que mirar para saber quién gana? Una de `derecha`, `izquierda`, `arriba`, `abajo`, `centro` o `alrededor`.
3. **falta**: ¿cuánto falta para que termine? Una de `empieza`, `mucho`, `mitad`, `poco` o `termino`.
4. **paso**: ¿qué acaba de pasar? Una de estas palabras, tal cual:
   - `empezo`: acaba de empezar.
   - `salio`: salió alguien.
   - `adelante`: alguien pasó adelante.
   - `freno`: alguien se frenó o tropezó.
   - `casi`: alguien casi sale y volvió.
   - `gano`: ya ganó alguien.
   - `nada`: nada nuevo.

   En `quien`, el nombre de la persona del hecho, si se lee; si no, vacío.

## El formato de cada respuesta

Solo JSON, una respuesta por captura, con estas seis claves y ninguna más:

```json
{"adelante":"","hacia":"","falta":"","paso":"","quien":"","vi":"12 palabras"}
```

`vi` es lo que ves en doce palabras o menos, sin interpretar. El archivo entero:

```json
{
  "<id de la captura>": {"adelante":"…","hacia":"…","falta":"…","paso":"…","quien":"…","vi":"…"}
}
```

## Reglas

- Contestá lo que se ve, no lo que supones. Si no se ve, escribilo: `no se ve`.
- Una palabra de la lista por pregunta (menos `adelante`, que es un nombre).
- No adivines el juego ni quién tiene que ganar: no lo sabés.
- No leas nada fuera de `preguntas.json` y de las imágenes.
