// Deleting a Client or Vehicle cascades (onDelete: Cascade in
// schema.prisma) straight through to their WorkOrders and Invoices at the
// database level -- which bypasses each of those resources' own DELETE
// route entirely, including the stock-restore logic those routes run
// (see workOrders.routes.js / invoices.routes.js). Without this, deleting
// a client or vehicle that had jobs logged against it would silently leave
// whatever parts they used permanently decremented, with no record left to
// even see it happened.
//
// Call this INSIDE the same transaction as the cascade delete, before it,
// scoped to exactly what's about to be cascaded away.
export function sumQuantitiesByItem(entries, idKey, qtyKey) {
  const totals = new Map();
  for (const e of entries) {
    const id = e[idKey];
    if (!id) continue;
    const qty = e[qtyKey] ?? 1;
    totals.set(id, (totals.get(id) || 0) + qty);
  }
  return totals;
}

export async function adjustStock(tx, quantitiesByItem, sign) {
  for (const [inventoryItemId, qty] of quantitiesByItem) {
    await tx.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { stock: { increment: sign * qty } },
    });
  }
}

export async function restoreStockForCascadedDeletes(tx, { workOrderWhere, invoiceWhere }) {
  const workOrders = await tx.workOrder.findMany({
    where: workOrderWhere,
    include: { subjects: { include: { partsUsed: true } } },
  });
  const woQty = sumQuantitiesByItem(
    workOrders.flatMap((w) => w.subjects.flatMap((s) => s.partsUsed)),
    'inventoryItemId',
    'quantity'
  );
  await adjustStock(tx, woQty, +1);

  // Only invoices that decremented stock themselves (stockAdjustedHere) --
  // one tied to a work order never did, that work order's own restore
  // above already covers it (see invoices.routes.js for why this flag
  // exists instead of just checking work_order_id).
  const invoices = await tx.invoice.findMany({
    where: { ...invoiceWhere, stockAdjustedHere: true },
    include: { lines: true },
  });
  const invQty = sumQuantitiesByItem(invoices.flatMap((i) => i.lines), 'inventoryItemId', 'quantity');
  await adjustStock(tx, invQty, +1);
}
