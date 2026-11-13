/**
 * La venta de paquetes del modo Oficial, cuando el servicio la frena sola.
 *
 * El portero pausa un paquete cuando lo que deja baja de su piso, o todos cuando lo vendido sin usar llega a su techo
 * (`GET /v1/alta/precios` suma `pausado` a cada producto, y `POST /v1/alta/orden` contesta `503 venta-pausada`). Lo ya
 * comprado no cambia: una orden abierta se sigue pagando, y los sorteos ya dados siguen siendo de la persona. Esto
 * dice qué se ve; la pantalla de la compra lo pinta (la de la cuenta, en la rama del cobro).
 *
 * Ante la duda no se vende: un producto que dice `pausado` con cualquier cosa que no sea `false` cuenta como pausado.
 * Un portero que todavía no manda `pausado` deja todo como hoy.
 */

/** Si este producto de `/v1/alta/precios` está pausado. Sin el campo, no (el portero de hoy). */
export function productoPausado(p: unknown): boolean {
  if (!p || typeof p !== "object" || !("pausado" in p)) return false;
  return (p as { pausado: unknown }).pausado !== false;
}

/** El rótulo del precio de un producto: el precio, o "Por ahora no disponible" si está pausado. */
export function rotuloDelPrecio(p: unknown, precio: string, decir: (clave: string) => string): string {
  return productoPausado(p) ? decir("precioPausado") : precio;
}

/** Los motivos del servidor de la venta que tienen su texto acá, para sumarlos a los de la cuenta. */
export const CLAVES_DE_LA_VENTA: Readonly<Record<string, string>> = {
  "venta-pausada": "pagoPausado",
};

/** La clave del texto de un no de la orden de compra, o `null` si no es de la venta frenada. */
export function claveDeLaOrden(estado: number, cuerpo: unknown): string | null {
  const motivo = cuerpo && typeof cuerpo === "object" ? (cuerpo as { motivo?: unknown }).motivo : undefined;
  return estado === 503 && typeof motivo === "string" ? (CLAVES_DE_LA_VENTA[motivo] ?? null) : null;
}
