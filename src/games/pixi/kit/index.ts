/**
 * El kit de juegos de Tinkazo.
 *
 * Un juego es un plan puro (de la lista y la ronda, qué pasa y cuándo), una
 * escena y un cuadro. El kit pone lo demás: el montaje, la cámara con sus cinco
 * arcos, los nombres legibles, el foco de quien gana, los subtítulos con cola, el
 * sonido afinado y el cierre. `docs/juegos.md`, "Cómo nace un juego".
 *
 *     import { crearJuego, planoEntero, planoSobre, PRIORIDAD } from "./kit";
 *     export const miJuegoPixi = crearJuego<Datos, Escena>({ id: "mijuego", plan, arma, cuadro });
 */
export { crearJuego } from "./crear";
export { PRIORIDAD, problemasDeLinea, validarGuion } from "./guion";
export { SABOR, POR_DEFECTO, avance, cronograma, faseEn, guardarMeta, planoEntero, planoSobre, problemasDeMomentos, resolverToma, tapaAlGanador } from "./director";
export { compensarZoom, enFilaAparte, estaPegado, minimoPx, nivelParaLugar, nivelPorCantidad, nivelesDe, nombreDeSalida, nombreLegible, pegarAlCuerpo, planNombres, tamanoLetra, unidadDe } from "./nombres";
export { marcadorPorSalidas, medidasMarcador, problemasDeMarcador } from "./marcador";
export { lugarDe, problemasDeRespuestas } from "./respuestas";
export { cuantasCaben, figurasDe, tamanoMinimoFigura } from "./figuras";
export { crearSonido, problemasDeTono } from "./sonido";
export { azarDe, hashDe, sembrar } from "./azar";
export { leyendaEn, problemasDeLeyenda } from "./leyenda";
export { CHIP_SCALE, CREAM, INK, YELLOW } from "./anfitrion";
export type { Anfitrion, Enfoque, Estadio, Musica } from "./anfitrion";
export type { Fase, Sabor, Cronograma, Pantalla } from "./director";
export type { Figura, ModoFiguras } from "./figuras";
export type { Leyenda } from "./leyenda";
export type { Lugar, Respuestas, TipoPaso } from "./respuestas";
export type { Rol, Nivel, PlanNombres } from "./nombres";
export type { Categoria, Sonido, Voz } from "./sonido";
export type {
  Baliza, Camara, Caja, Contexto, DefJuego, FocoPunto, Idioma, Kit, Lanzador, LineaGuion, Momentos, Plan, PlanoToma, Textos, Toma, Vista, Zona,
} from "./tipos";
