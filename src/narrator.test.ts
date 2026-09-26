import { describe, expect, it } from "vitest";
import { forSpeech, shortVoiceName } from "./narrator";

describe("el relator", () => {
  it("dice en minúsculas lo que la pantalla grita en mayúsculas", () => {
    expect(forSpeech("¡QUEDAN DOS!")).toBe("¡quedan dos!");
    expect(forSpeech("¡SE SUELTA LA DE Rodrigo Peña!")).toBe("¡se suelta la de Rodrigo Peña!");
    expect(forSpeech("¡Se baja Ana!")).toBe("¡Se baja Ana!");
  });

  it("muestra el nombre de la voz sin los apellidos técnicos", () => {
    expect(shortVoiceName("Microsoft Marcelo Online (Natural) - Spanish (Bolivia)")).toBe("Marcelo - Spanish (Bolivia)");
    expect(shortVoiceName("Microsoft Helena - Spanish (Spain)")).toBe("Helena - Spanish (Spain)");
  });
});
