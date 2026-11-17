/**
 * Si una página de lectura tiene que cargar lo de la compra (`paginas-cobro.ts`). Va aparte y chico a propósito: lo
 * importa `pagina.ts` en todas las páginas, y lo de la compra se baja con `import()` solo donde hace falta.
 *
 * - Con la compra prendida en el build y un `<template data-con-cobro>` en la página: sí, para ponerlo y llenar la
 *   lista de precios.
 * - Con la lista ya en el HTML (`data-paquetes`, después del commit que prende la compra): sí, siempre. Con la compra
 *   apagada dice que no hay paquetes a la venta, en vez de dejar la lista vacía.
 * - Si no, no se baja nada: es lo de hoy.
 */
export function cargaElCobro(doc: Pick<Document, "querySelector">, pago: boolean): boolean {
  return (pago && doc.querySelector("template[data-con-cobro]") !== null) || doc.querySelector("[data-paquetes]") !== null;
}
