import { describe, expect, it } from "vitest";
import { TEXTOS_CREAR_CAMPANA } from "../textos-crear";
import { basesAutomaticas, basesFinales, type DatosDeLasBases } from "./bases";
import { basesVacias, formularioInicial, reducir } from "./estado";

const dic = (idioma: "es" | "en", clave: string): string => TEXTOS_CREAR_CAMPANA[idioma][clave] ?? "";
const SORTEO = Date.UTC(2026, 10, 21, 22, 30);
const datos = (cambio: Partial<DatosDeLasBases> = {}): DatosDeLasBases => ({
  marca: "Alcancía Andina",
  ganan: 3,
  monto: 40,
  sorteoMs: SORTEO,
  zona: "America/La_Paz",
  conRedes: true,
  costo: { es: null, en: null },
  ...cambio,
});

describe("basesAutomaticas", () => {
  it("en español con 3 premios, con redes y sin costo de retirar", () => {
    expect(basesAutomaticas(datos(), dic).es).toBe(
      [
        "Participar es gratis y es una vez por persona, entrando con tu cuenta de Google.",
        "Para participar hay que estar en el evento. Seguir a Alcancía Andina en sus redes es un pedido y no cambia quién gana.",
        "Se sortean 3 premios de 40 dólares digitales entre todas las personas anotadas. El sorteo es a las 18:30 y cualquiera puede comprobar el resultado.",
        "El premio llega a tu cuenta de Tinkazo. Tenés 7 días para recibirlo. Si no lo recibís en ese plazo, el premio vuelve a Alcancía Andina.",
        "Recibir el premio es gratis.",
        "En la pantalla del evento se ve tu primer nombre y la inicial de tu apellido. Tu correo se usa solo para avisarte si ganás.",
        "Alcancía Andina pone los premios y responde por ellos. Tinkazo es la herramienta que hace el sorteo.",
        "La lista la sella la cuenta que organiza esta campaña, y solo vale el sello de la lista de personas anotadas que se ve en la pantalla. Un sello de otra cuenta o de otra lista no cuenta para esta campaña.",
      ].join("\n"),
    );
  });

  it("en inglés con un premio, sin redes y sin costo de retirar", () => {
    expect(basesAutomaticas(datos({ ganan: 1, conRedes: false }), dic).en).toBe(
      [
        "Taking part is free, once per person, signing in with your Google account.",
        "To take part you must be at the event.",
        "One prize of 40 digital dollars is drawn among everyone signed up. The draw is at 18:30 and anyone can check the result.",
        "The prize arrives in your Tinkazo account. You have 7 days to receive it. If you don't receive it in that time, the prize goes back to Alcancía Andina.",
        "Receiving the prize is free.",
        "The event screen shows your first name and the initial of your last name. Your email is used only to tell you if you win.",
        "Alcancía Andina provides the prizes and answers for them. Tinkazo is the tool that runs the draw.",
        "The list is sealed by the account that runs this campaign, and only a seal of the list of signed-up people shown on the screen counts. A seal from another account or of another list does not count for this campaign.",
      ].join("\n"),
    );
  });

  it("con costo de retirar el renglón 5 lo dice en cada idioma con su forma de escribir el monto", () => {
    const b = basesAutomaticas(datos({ costo: { es: "0,50", en: "0.50" } }), dic);
    expect(b.es.split("\n")[4]).toBe("Recibir el premio es gratis. Retirarlo de tu cuenta cuesta 0,50 dólares digitales por retiro.");
    expect(b.en.split("\n")[4]).toBe("Receiving the prize is free. Taking it out of your account costs 0.50 digital dollars per withdrawal.");
  });

  it("sin costo de retirar el renglón 5 dice solo que recibir es gratis", () => {
    expect(basesAutomaticas(datos(), dic).es.split("\n")[4]).toBe("Recibir el premio es gratis.");
  });

  it("el último renglón dice quién sella la lista, igual que los Términos, en los dos idiomas", () => {
    const b = basesAutomaticas(datos(), dic);
    expect(b.es.split("\n")[7]).toBe(dic("es", "ccBase8"));
    expect(b.en.split("\n")[7]).toBe(dic("en", "ccBase8"));
    expect(b.es).toContain("La lista la sella la cuenta que organiza esta campaña");
    expect(b.en).toContain("The list is sealed by the account that runs this campaign");
    // Dice lo que el servicio garantiza: un sello de otra cuenta o de otra lista no cuenta.
    expect(b.es).toContain("no cuenta para esta campaña");
    expect(b.en).toContain("does not count for this campaign");
  });

  it("cada idioma tiene los ocho renglones y entra en el tope del modelo", () => {
    const b = basesAutomaticas(datos({ marca: "x".repeat(40), costo: { es: "0,50", en: "0.50" } }), dic);
    expect(b.es.split("\n")).toHaveLength(8);
    expect(b.en.split("\n")).toHaveLength(8);
    expect(b.es.length).toBeLessThanOrEqual(6000);
    expect(b.en.length).toBeLessThanOrEqual(6000);
  });
});

describe("basesFinales", () => {
  const aut = basesAutomaticas(datos(), dic);
  const otras = basesAutomaticas(datos({ ganan: 5 }), dic);

  it("sin nada escrito son las automáticas y no están desfasadas", () => {
    expect(basesFinales(basesVacias(), aut)).toEqual({ bases: aut, desfasadas: false });
  });

  it("unas bases editadas se respetan aunque cambie el premio", () => {
    const f = reducir(formularioInicial("America/La_Paz", "k3f9"), { t: "bases", idioma: "es", valor: "Mis bases", automaticas: aut });
    expect(basesFinales(f.bases, otras).bases.es).toBe("Mis bases");
    expect(basesFinales(f.bases, otras).bases.en).toBe(otras.en);
  });

  it("cambiar el premio después de editar las marca como desfasadas", () => {
    const f = reducir(formularioInicial("America/La_Paz", "k3f9"), { t: "bases", idioma: "es", valor: "Mis bases", automaticas: aut });
    expect(basesFinales(f.bases, aut).desfasadas).toBe(false);
    expect(basesFinales(f.bases, otras).desfasadas).toBe(true);
  });

  it("volver a escribirlas las deja automáticas con el premio nuevo", () => {
    const f = reducir(
      reducir(formularioInicial("America/La_Paz", "k3f9"), { t: "bases", idioma: "es", valor: "Mis bases", automaticas: aut }),
      { t: "rehacer-bases" },
    );
    expect(basesFinales(f.bases, otras)).toEqual({ bases: otras, desfasadas: false });
  });

  it("dejarlas así quita el aviso y conserva lo escrito", () => {
    const f = reducir(
      reducir(formularioInicial("America/La_Paz", "k3f9"), { t: "bases", idioma: "es", valor: "Mis bases", automaticas: aut }),
      { t: "dejar-bases", automaticas: otras },
    );
    expect(basesFinales(f.bases, otras)).toEqual({ bases: { es: "Mis bases", en: otras.en }, desfasadas: false });
  });
});
