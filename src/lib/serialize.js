// Wire format matches the original Base44 entity shapes (snake_case, plus
// created_date/updated_date) so the existing frontend pages need minimal
// changes when their api client stops pointing at Base44 and starts
// pointing at this backend. Internally Prisma stays camelCase — these
// functions are the one place that translates between the two.

export function serializeClient(c) {
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    phone: c.phone,
    email: c.email,
    created_date: c.createdAt,
    updated_date: c.updatedAt,
  };
}

export function serializeVehicle(v) {
  return {
    id: v.id,
    client_id: v.clientId,
    vehicle_type: v.vehicleType,
    vin: v.vin,
    vin_last8: v.vin ? v.vin.slice(-8) : null,
    year: v.year,
    make: v.make,
    model: v.model,
    unit_number: v.unitNumber,
    plate: v.plate,
    odometer: v.odometer,
    engine_hours: v.engineHours,
    common_parts: (v.commonParts || [])
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ name: p.name, value: p.value, inventory_item_id: p.inventoryItemId })),
    created_date: v.createdAt,
    updated_date: v.updatedAt,
  };
}

export function serializeInventoryCategory(c) {
  return {
    id: c.id,
    name: c.name,
    created_date: c.createdAt,
    updated_date: c.updatedAt,
  };
}

export function serializeInventoryItem(i) {
  return {
    id: i.id,
    part_number: i.partNumber,
    name: i.name,
    stock: i.stock,
    cost: Number(i.cost),
    price: Number(i.price),
    track_stock: i.trackStock,
    category: i.category?.name ?? null,
    created_date: i.createdAt,
    updated_date: i.updatedAt,
  };
}

const STATUS_TO_WIRE = {
  Draft: 'Draft',
  InProgress: 'In Progress',
  ReadyToInvoice: 'Ready to Invoice',
  Invoiced: 'Invoiced',
};
const STATUS_FROM_WIRE = Object.fromEntries(Object.entries(STATUS_TO_WIRE).map(([k, v]) => [v, k]));

export function workOrderStatusToWire(status) {
  return STATUS_TO_WIRE[status] ?? status;
}
export function workOrderStatusFromWire(status) {
  return STATUS_FROM_WIRE[status] ?? status;
}

export function serializeWorkOrder(w) {
  return {
    id: w.id,
    client_id: w.clientId,
    vehicle_id: w.vehicleId,
    technician_name: w.technicianName,
    status: workOrderStatusToWire(w.status),
    date: w.date ? w.date.toISOString().slice(0, 10) : null,
    general_notes: w.generalNotes,
    subjects: (w.subjects || [])
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        description: s.description,
        note: s.note,
        parts_used: (s.partsUsed || []).map((p) => ({
          inventory_item_id: p.inventoryItemId,
          part_number: p.inventoryItem?.partNumber ?? null,
          name: p.inventoryItem?.name ?? null,
          quantity: p.quantity,
        })),
      })),
    created_date: w.createdAt,
    updated_date: w.updatedAt,
  };
}

export function serializeInvoice(inv) {
  return {
    id: inv.id,
    work_order_id: inv.workOrderId,
    client_id: inv.clientId,
    vehicle_id: inv.vehicleId,
    invoice_number: inv.invoiceNumber,
    date: inv.date ? inv.date.toISOString().slice(0, 10) : null,
    status: inv.status,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    lines: (inv.lines || [])
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: Number(l.unitPrice),
        total: Number(l.total),
      })),
    created_date: inv.createdAt,
    updated_date: inv.updatedAt,
  };
}

export function serializeShopSettings(s) {
  if (!s) return null;
  return {
    id: s.id,
    shop_name: s.shopName,
    logo_url: s.logoUrl,
    phone: s.phone,
    address: s.address,
    tax_rate: Number(s.taxRate),
    created_date: s.createdAt,
    updated_date: s.updatedAt,
  };
}
