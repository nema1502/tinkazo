# La prueba del niño: el prompt del describidor

Este texto es fijo: es el mismo para todos los juegos (`audit-nino.mjs` lo copia a la carpeta de cada corrida). Lo lee el describidor, que **solo ve imágenes**: ni el código, ni el relator, ni el juego, ni la verdad. Describe un modelo barato; si una respuesta falla, la repite otro más fuerte y decide el segundo.

## Lo que hacés

1. Abrí `preguntas.json` de esta carpeta. No abras ningún otro archivo que no sea una de las imágenes que ahí figuran: nada de código, nada de otras carpetas, nada de listar la carpeta para ver qué más hay.
2. Por cada entrada, abrí su imagen (`imagen`) y contestá **solo las preguntas que ahí figuran** y **solo lo que se ve**. Cada imagen se contesta sola: no uses lo que viste en las otras.
3. Escribí `respuestas-modelo.json` en esta carpeta: un objeto con un `id` por entrada y, adentro, la respuesta de abajo. Todas las entradas, aunque no se vea nada.

## Lo que se ve

Es un sorteo animado en una sala. Gana una persona. No hay subtítulo, y la pantalla trae los nombres: contestá con nombres. La vara es la de alguien de 7 años: lee nombres, pero no lee frases largas.

Hay dos clases de imagen:

- **Una foto** (`cuadros` vale 1): un solo momento.
- **Una tira** (`cuadros` vale 3): tres cuadros seguidos, de izquierda a derecha, con unos tres décimos de segundo entre uno y el siguiente. El de la derecha es el momento; los otros dos te dicen qué se movió.

## Las preguntas

Cada entrada trae algunas de estas, con su texto exacto:

- **gano**: ¿ya se sabe quién ganó? Escribí `no`, o `si` y, en `quien`, el nombre tal como se lee. Un nombre señalado o en una tarjeta no alcanza: tiene que verse que ganó (un cartel de ganador, un festejo). Si dudás, escribí `no`.
- **falta**: ¿cuánto falta para que termine? Una de `empieza`, `mucho`, `mitad`, `poco` o `termino`.
- **paso** (tira): ¿qué acaba de pasar? Una de estas palabras, tal cual:
  - `empezo`: acaba de empezar.
  - `salio`: salió alguien.
  - `adelante`: alguien pasó adelante.
  - `freno`: alguien se frenó o tropezó.
  - `casi`: alguien casi sale y volvió.
  - `gano`: ya ganó alguien.
  - `nada`: nada nuevo.

  En `quien`, el nombre de la persona del hecho, si se lee; si no, vacío.
- **mirar** (tira): mirá el cuadro de la derecha, el momento, y decí **en qué parte de la imagen** está pasando lo importante ahora. Es una zona de la pantalla, no una dirección de movimiento: una de `arriba`, `abajo`, `izquierda`, `derecha`, `centro`, o `alrededor` si lo importante gira.
- **propia**: una pregunta sobre los nombres de la pantalla (quién va adelante, quiénes siguen, qué está señalado o quién tiene más). El texto de la entrada dice cuál es y cuántos nombres escribir; si lo que se ve son grupos (cabinas, comparsas) y no personas, el texto lo dice y vale el nombre del grupo. Si no se lee, `no se ve`.
- **olor**: ¿se ve dinero, billetes, monedas de apuesta, fichas de casino, cartas, dados, una máquina tragamonedas o una mesa de apuestas? Contestá por lo que hay dibujado, no por lo que te parece. `si` o `no`, y en `vi` qué viste.

## El formato de cada respuesta

Solo JSON, una respuesta por entrada, con estas ocho claves y ninguna más. Las claves que esa entrada no pregunta van vacías:

```json
{"gano":"","falta":"","paso":"","mirar":"","propia":"","olor":"","quien":"","vi":"12 palabras"}
```

`quien` es un nombre, el de la persona de la respuesta de esa entrada (el que ganó, o el del hecho). `vi` es lo que ves en doce palabras o menos, sin interpretar. El archivo entero:

```json
{
  "<id de la entrada>": {"gano":"…","falta":"…","paso":"","mirar":"","propia":"…","olor":"…","quien":"…","vi":"…"}
}
```

## Reglas

- Contestá lo que se ve, no lo que suponés. Si no se ve, escribilo: `no se ve`.
- Una palabra de la lista por pregunta (menos `propia` y `quien`, que son nombres).
- No adivines el juego ni quién tiene que ganar: no lo sabés.
- No leas nada fuera de `preguntas.json` y de las imágenes.
