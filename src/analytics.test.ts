import { describe, expect, it } from "vitest";
import { beforeSend, cleanUrl, shouldCount } from "./analytics";

describe("contar visitas", () => {
  it("los nombres del comprobante nunca salen: se corta todo después de la ruta", () => {
    const comprobante = "https://tinkazo.app/verificar.html#v=2&n=Mar%C3%ADa%20Quispe%0AJorge%20Mamani";
    expect(cleanUrl(comprobante)).toBe("https://tinkazo.app/verificar.html");
    expect(cleanUrl("https://tinkazo.app/lista.html?x=1#Ana%20Vargas")).toBe("https://tinkazo.app/lista.html");
    expect(cleanUrl("https://tinkazo.app/?demo=race&lang=en#sortear")).toBe("https://tinkazo.app/");
  });

  it("un enlace corto se cuenta sin su id ni su clave", () => {
    expect(cleanUrl("https://tinkazo.app/c/Ab3dE6gH#AAAAAAAAAAAAAAAAAAAAAA")).toBe("https://tinkazo.app/c/");
    expect(cleanUrl("https://tinkazo.app/c/Ab3dE6gH?lang=en")).toBe("https://tinkazo.app/c/");
  });

  it("si la dirección no se puede leer, la visita no se cuenta", () => {
    expect(cleanUrl("no es una dirección")).toBe("");
    expect(beforeSend({ type: "pageview", url: "::" })).toBeNull();
  });

  it("el filtro deja el resto de la visita como estaba", () => {
    const v = beforeSend({ type: "pageview", url: "https://tinkazo.app/verificar.html#Mar%C3%ADa", payload: undefined });
    expect(v).toEqual({ type: "pageview", url: "https://tinkazo.app/verificar.html", payload: undefined });
  });

  it("solo en tinkazo.app, y nunca si el navegador pide que no lo sigan", () => {
    const libre = { doNotTrack: null };
    expect(shouldCount({ hostname: "tinkazo.app" }, libre)).toBe(true);
    expect(shouldCount({ hostname: "localhost" }, libre)).toBe(false);
    expect(shouldCount({ hostname: "tinkazo.vercel.app" }, libre)).toBe(false);
    expect(shouldCount({ hostname: "tinkazo-git-main-spartans.vercel.app" }, libre)).toBe(false);
    expect(shouldCount({ hostname: "tinkazo.app" }, { doNotTrack: "1" })).toBe(false);
    expect(shouldCount({ hostname: "tinkazo.app" }, { doNotTrack: null, globalPrivacyControl: true })).toBe(false);
  });
});
