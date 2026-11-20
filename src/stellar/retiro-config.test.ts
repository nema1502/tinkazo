import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { esDireccionG } from "./direccion-g";
import { esDireccionG as esDireccionGDePagos } from "./pagos";
import {
  STROOPS_POR_DOLAR,
  TOPE_DEL_COSTO,
  costoDelRetiro,
  cuentaDeCobrosDelPortero,
  cuentaDelRetiro,
  leerElCosto,
  leerLaCuenta,
  montoEnPalabras,
  montoEnTexto,
} from "./retiro-config";

/**
 * La configuración del costo del retiro: el monto fijo y la cuenta que lo recibe, leídos del entorno del build. Sin la
 * cuenta no se cobra nada. Todo con entornos armados a mano, sin red.
 */

/** Cuentas de verdad de testnet (públicas), con su final de control en regla. */
const CUENTA = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const OTRA = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
/** La misma cuenta con la última letra cambiada: ya no cuadra su final de control. */
const CON_ERROR = `${CUENTA.slice(0, 55)}${CUENTA[55] === "A" ? "B" : "A"}`;

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

describe("el costo", () => {
  it("0.50 da 5.000.000 stroops exactos", () => {
    expect(leerElCosto("0.50")).toEqual({ tipo: "valido", stroops: 5_000_000n });
    expect(costoDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: CUENTA })).toBe(5_000_000n);
  });

  it("lee los siete decimales sin redondear", () => {
    expect(leerElCosto("0.0000001")).toEqual({ tipo: "valido", stroops: 1n });
    expect(leerElCosto("1.2345678")).toEqual({ tipo: "valido", stroops: 12_345_678n });
    expect(leerElCosto("1.23456789")).toEqual({ tipo: "mal-escrito" });
    expect(leerElCosto("1.234567")).toEqual({ tipo: "valido", stroops: 12_345_670n });
  });

  it("un entero sin decimales vale tantos dólares", () => {
    expect(leerElCosto("1")).toEqual({ tipo: "valido", stroops: STROOPS_POR_DOLAR });
    expect(leerElCosto("5")).toEqual({ tipo: "valido", stroops: TOPE_DEL_COSTO });
  });

  it("los espacios de las puntas no cuentan", () => {
    expect(leerElCosto("  0.50 ")).toEqual({ tipo: "valido", stroops: 5_000_000n });
  });

  it("sin poner o en blanco queda vacío", () => {
    expect(leerElCosto(undefined)).toEqual({ tipo: "vacio" });
    expect(leerElCosto("")).toEqual({ tipo: "vacio" });
    expect(leerElCosto("   ")).toEqual({ tipo: "vacio" });
  });

  it("con coma, letras, signo, punto suelto o más de 7 decimales está mal escrito", () => {
    for (const mal of ["0,50", "abc", "-1", "+1", ".5", "5.", "1e2", "0x10", "0.50 USDC", "$0.50", "0.12345678", "1.2.3", "1 2"]) {
      expect(leerElCosto(mal), mal).toEqual({ tipo: "mal-escrito" });
    }
  });

  it("un valor que no es texto está mal escrito", () => {
    expect(leerElCosto(5)).toEqual({ tipo: "mal-escrito" });
    expect(leerElCosto(true)).toEqual({ tipo: "mal-escrito" });
  });

  it("arriba de 5 dólares es un error de escritura", () => {
    expect(leerElCosto("5.0000001")).toEqual({ tipo: "sobre-el-tope" });
    expect(leerElCosto("50")).toEqual({ tipo: "sobre-el-tope" });
    expect(leerElCosto("999")).toEqual({ tipo: "sobre-el-tope" });
  });

  it("más de tres cifras enteras está mal escrito", () => {
    expect(leerElCosto("1000")).toEqual({ tipo: "mal-escrito" });
  });

  it("el tope son 5 dólares", () => {
    expect(TOPE_DEL_COSTO).toBe(50_000_000n);
  });
});

describe("la cuenta que lo recibe", () => {
  it("una dirección G de verdad vale", () => {
    expect(leerLaCuenta(CUENTA)).toEqual({ tipo: "valida", cuenta: CUENTA });
    expect(cuentaDelRetiro({ VITE_RETIRO_CUENTA: CUENTA })).toBe(CUENTA);
  });

  it("los espacios de las puntas no cuentan", () => {
    expect(cuentaDelRetiro({ VITE_RETIRO_CUENTA: ` ${CUENTA} ` })).toBe(CUENTA);
  });

  it("sin poner o en blanco queda vacía", () => {
    expect(leerLaCuenta(undefined)).toEqual({ tipo: "vacia" });
    expect(leerLaCuenta("")).toEqual({ tipo: "vacia" });
    expect(cuentaDelRetiro({})).toBeNull();
  });

  it("con una letra cambiada, o con otra cosa, es inválida", () => {
    for (const mala of [CON_ERROR, CUENTA.slice(0, 55), `${CUENTA}A`, "hola", CUENTA.toLowerCase(), `C${CUENTA.slice(1)}`]) {
      expect(leerLaCuenta(mala), mala).toEqual({ tipo: "invalida" });
      expect(cuentaDelRetiro({ VITE_RETIRO_CUENTA: mala }), mala).toBeNull();
    }
  });

  it("una dirección de contrato no es una cuenta", () => {
    expect(leerLaCuenta("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75")).toEqual({ tipo: "invalida" });
  });

  it("la comprobación es la misma de siempre: pagos.ts vuelve a exportar la de direccion-g.ts", () => {
    expect(esDireccionGDePagos).toBe(esDireccionG);
    expect(esDireccionG(OTRA)).toBe(true);
    expect(esDireccionG(CON_ERROR)).toBe(false);
  });
});

describe("cuánto se cobra", () => {
  it("con el costo y la cuenta, el monto en stroops", () => {
    expect(costoDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: CUENTA })).toBe(5_000_000n);
    expect(costoDelRetiro({ VITE_RETIRO_COSTO: "1.25", VITE_RETIRO_CUENTA: OTRA })).toBe(12_500_000n);
  });

  it("sin la cuenta no se cobra nada", () => {
    expect(costoDelRetiro({ VITE_RETIRO_COSTO: "0.50" })).toBeNull();
    expect(costoDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: "" })).toBeNull();
  });

  it("con la cuenta inválida no se cobra nada", () => {
    expect(costoDelRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: CON_ERROR })).toBeNull();
  });

  it("con el costo en cero o vacío no se cobra nada", () => {
    for (const costo of ["0", "0.0", "0.0000000", "", undefined]) {
      expect(costoDelRetiro({ VITE_RETIRO_COSTO: costo, VITE_RETIRO_CUENTA: CUENTA }), String(costo)).toBeNull();
    }
  });

  it("con el costo mal escrito o arriba del tope no se cobra nada", () => {
    for (const costo of ["0,50", "abc", "-1", "6", "0.12345678"]) {
      expect(costoDelRetiro({ VITE_RETIRO_COSTO: costo, VITE_RETIRO_CUENTA: CUENTA }), costo).toBeNull();
    }
  });

  it("sin nada puesto, no se cobra nada", () => {
    expect(costoDelRetiro({})).toBeNull();
  });
});

describe("el monto como se escribe", () => {
  it("50 centavos son 0,50 en español y 0.50 en inglés", () => {
    expect(montoEnTexto(5_000_000n, "es")).toBe("0,50");
    expect(montoEnTexto(5_000_000n, "en")).toBe("0.50");
  });

  it("siempre lleva dos decimales como mínimo", () => {
    expect(montoEnTexto(STROOPS_POR_DOLAR, "es")).toBe("1,00");
    expect(montoEnTexto(10_000_000n * 5n, "en")).toBe("5.00");
  });

  it("lleva los decimales que haga falta hasta siete", () => {
    expect(montoEnTexto(12_500_000n, "es")).toBe("1,25");
    expect(montoEnTexto(5_000_001n, "en")).toBe("0.5000001");
    expect(montoEnTexto(1n, "es")).toBe("0,0000001");
  });
});

describe("el monto dicho de palabra", () => {
  it("menos de un dólar y de centavos justos se dice en centavos", () => {
    expect(montoEnPalabras(5_000_000n, "es")).toBe("50 centavos");
    expect(montoEnPalabras(5_000_000n, "en")).toBe("50 cents");
  });

  it("un solo centavo va en singular", () => {
    expect(montoEnPalabras(100_000n, "es")).toBe("1 centavo");
    expect(montoEnPalabras(100_000n, "en")).toBe("1 cent");
  });

  it("de un dólar para arriba se dice el monto con su unidad", () => {
    expect(montoEnPalabras(12_500_000n, "es")).toBe("1,25 dólares digitales");
    expect(montoEnPalabras(12_500_000n, "en")).toBe("1.25 digital dollars");
    expect(montoEnPalabras(STROOPS_POR_DOLAR, "es")).toBe("1,00 dólares digitales");
  });

  it("menos de un dólar y con fracciones de centavo se dice el monto con su unidad", () => {
    expect(montoEnPalabras(5_050_000n, "es")).toBe("0,505 dólares digitales");
    expect(montoEnPalabras(1n, "en")).toBe("0.0000001 digital dollars");
  });
});

describe("la cuenta de cobros del portero", () => {
  const TOML = [
    "[vars]",
    'CUENTA_COBROS = "GAAAA"',
    "",
    "[[env.mainnet.migrations]]",
    'tag = "v1"',
    "",
    "[env.mainnet.vars]",
    'RED = "mainnet"',
    "# CUENTA_COBROS = comentada",
    `CUENTA_COBROS = "${CUENTA}"   # la de cobros`,
    "",
    "[env.testnet.vars]",
    'CUENTA_COBROS = "GBBBB"',
  ].join("\n");

  it("lee la de la sección de la red principal, y no la de otra sección", () => {
    expect(cuentaDeCobrosDelPortero(TOML)).toBe(CUENTA);
  });

  it("lee el archivo con fin de línea de Windows", () => {
    expect(cuentaDeCobrosDelPortero(TOML.replace(/\n/g, "\r\n"))).toBe(CUENTA);
  });

  it("vacía o sin la sección, es null", () => {
    expect(cuentaDeCobrosDelPortero('[env.mainnet.vars]\nCUENTA_COBROS = ""')).toBeNull();
    expect(cuentaDeCobrosDelPortero('[vars]\nCUENTA_COBROS = "GAAAA"')).toBeNull();
    expect(cuentaDeCobrosDelPortero("")).toBeNull();
  });

  it("la del archivo de verdad es una dirección G válida", () => {
    const real = cuentaDeCobrosDelPortero(readFileSync(join(RAIZ, "workers", "patrocinio", "wrangler.toml"), "utf8"));
    expect(esDireccionG(real)).toBe(true);
  });
});

describe("la dirección de cobros no está escrita en el código del sitio", () => {
  function fuentesDelSitio(dir: string): string[] {
    const fuera: string[] = [];
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) fuera.push(...fuentesDelSitio(ruta));
      else if (/\.ts$/.test(nombre) && !/\.test\.ts$/.test(nombre)) fuera.push(ruta);
    }
    return fuera;
  }

  it("ninguna fuente de src/ que no sea una prueba la trae: sale solo de VITE_RETIRO_CUENTA", () => {
    const cobros = cuentaDeCobrosDelPortero(readFileSync(join(RAIZ, "workers", "patrocinio", "wrangler.toml"), "utf8"));
    expect(cobros).not.toBeNull();
    const conLaCuenta = fuentesDelSitio(join(RAIZ, "src"))
      .filter((ruta) => readFileSync(ruta, "utf8").includes(cobros as string))
      .map((ruta) => ruta.slice(RAIZ.length).split(sep).join("/"));
    expect(conLaCuenta).toEqual([]);
  });
});

describe(".env.example", () => {
  const lineas = readFileSync(join(RAIZ, ".env.example"), "utf8").split(/\r?\n/);

  it.each(["VITE_RETIRO_COSTO", "VITE_RETIRO_CUENTA"])("trae %s vacía y con su comentario encima", (nombre) => {
    const i = lineas.indexOf(`${nombre}=`);
    expect(i, nombre).toBeGreaterThan(0);
    expect(lineas[i - 1], nombre).toMatch(/^#/);
  });

  it("no trae ninguna dirección ni monto escrito en las variables", () => {
    for (const l of lineas.filter((x) => /^VITE_RETIRO_/.test(x))) expect(l).toMatch(/^VITE_RETIRO_[A-Z]+=$/);
  });
});
