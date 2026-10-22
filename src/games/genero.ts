/**
 * Con qué ropa baila cada uno, cuando el baile tiene ropa de hombre y ropa de
 * mujer: sale del nombre, no del lugar en la lista.
 *
 * Con la ropa repartida por puesto, en la Chovena "Carlos" bailaba de tipoy y
 * "Elena" de sombrero, y en ropa indígena tradicional eso se lee como burla (lo
 * encontró la revisión visual, 5 de octubre de 2026). En La Entrada pasa lo
 * mismo con la pollera de las cholitas.
 *
 * Una lista de nombres comunes y la terminación. Lo que no se puede clasificar
 * vuelve `null`, y cada juego decide: la Chovena lo usa para completar la
 * rueda alternada, La Entrada lo viste con el traje de siempre. Es solo dibujo:
 * no toca quién gana.
 */
const MUJERES = new Set(("maria ana lucia elena sofia valeria camila paola daniela carmen rosa juana patricia laura andrea " +
  "gabriela carla fernanda isabel veronica claudia monica silvia sandra natalia alejandra adriana beatriz lorena cecilia " +
  "teresa martha marta julia raquel ruth rut noemi miriam lourdes ines pilar rocio consuelo amparo mercedes dolores " +
  "soledad luz gladys nelly jazmin abigail ximena jimena mariela marisol yesenia wendy evelyn ingrid karen kelly nicole " +
  "michelle stephanie estefania milagros belen carolina catalina florencia agustina antonella valentina martina renata " +
  "emilia isabella guadalupe maribel noelia roxana tatiana vanessa viviana zulema esther edith judith elizabeth " +
  "lizeth jhoselin yovana susana silvana tania rosario margarita cristina angela erika diana fabiola liliana yolanda " +
  "cielo socorro charo").split(" "));
const HOMBRES = new Set(("jorge carlos diego pablo rodrigo miguel andres franco oscar juan jose luis pedro mario fernando " +
  "ricardo roberto sergio javier alejandro daniel david eduardo gustavo hugo ivan jaime julio marco marcos mauricio nicolas " +
  "raul rene victor wilson freddy jhonny edwin edgar alvaro boris cristian christian gonzalo gerardo hector ignacio " +
  "joaquin kevin leonardo manuel martin matias orlando rafael ramiro ruben samuel santiago sebastian tomas vladimir " +
  "walter william willy adrian antonio armando arturo benjamin bruno cesar emilio enrique esteban felipe francisco gabriel " +
  "guillermo jesus jonathan josue marcelo mateo omar patricio rolando teodoro vicente elias isaac moises noel alex " +
  "alexander angel dario efrain eloy ernesto fabian fidel grover henry jhon johnny lucas luca nestor ronald rudy simon " +
  "yerko limbert nelson wilfredo alfredo alberto").split(" "));

export const generoDe = (nombre: string): "f" | "m" | null => {
  const primero = (nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/)[0] ?? "").replace(/[^a-z]/g, "");
  if (MUJERES.has(primero)) return "f";
  if (HOMBRES.has(primero)) return "m";
  if (primero.length > 2 && primero.endsWith("a")) return "f";
  if (primero.length > 2 && primero.endsWith("o")) return "m";
  return null;
};
