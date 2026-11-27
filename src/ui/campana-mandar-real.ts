/**
 * Lo de verdad de mandar un premio desde el resultado de una campaña de personas con premios en dólares (`campana-sala.ts` lo
 * usa en `depsReales`, y lo baja recién cuando hay un resultado así a la vista): si esta sesión puede mandar, y abrir Mandar mis
 * dólares digitales con el premio ya puesto.
 *
 * De acá no sale ningún envío: solo se abre la ventana, que es donde quien organiza pega la dirección y confirma. Antes de
 * abrirla se mira que no haya otro envío en camino, porque la billetera guarda una sola marca por navegador y un segundo envío
 * heredaría el resultado del primero.
 */
import { network } from "../stellar/config";
import { depsDeComisionReales } from "./campana-comision-real";
import type { DepsDeMandarPremio } from "./campana-sala";

/**
 * La cuenta con que se puede mandar desde el panel, o `null` si esta sesión no puede: solo en la red principal, con Mandar
 * permitido en el sitio y con una cuenta de Google que vota a mano. Es la misma mirada que hace el cobro de la campaña
 * (`billetera` en `campana-comision-real.ts`): una cuenta que entró con correo o una billetera propia no mandan desde acá.
 */
async function cuentaQueManda(): Promise<string | null> {
  if (network.name !== "mainnet") return null;
  const [{ mandarPermitido }, { activeWallet }] = await Promise.all([import("./mandar-usdc"), import("../stellar/wallet-lite")]);
  if (!mandarPermitido()) return null;
  if ((await depsDeComisionReales().billetera()) !== "google") return null;
  return activeWallet()?.address ?? null;
}

export function mandarPremioReal(): DepsDeMandarPremio {
  return {
    puede: async () => (await cuentaQueManda().catch(() => null)) !== null,
    abrir: async ({ llega, para }) => {
      const [mandar, pollar, { saldoDeLaCuenta }] = await Promise.all([import("./mandar-usdc"), import("../stellar/wallet-pollar"), import("./pagar-premio")]);
      // Primero la marca: con un envío que todavía puede entrar no se abre nada, ni se lee el saldo.
      const viva = pollar.leerMarcaDeLaCuenta(pollar.MARCA_DEL_RETIRO);
      if (viva !== null && viva * 1000 > Date.now()) return "ocupada";
      const cuenta = await cuentaQueManda().catch(() => null);
      if (cuenta === null) return "sin-lectura";
      // El saldo se lee ahora y no se supone: la ventana decide con él si el premio se puede mandar o cuánto falta.
      const saldo = await saldoDeLaCuenta(network.name, cuenta);
      if (saldo === null) return "sin-lectura";
      mandar.abrirMandar({ address: cuenta, saldo, llega, para });
      return "abierta";
    },
  };
}
