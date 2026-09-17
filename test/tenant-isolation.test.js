// Proves the core multi-tenant guarantee: a mechanic can never read, list,
// modify, or delete another mechanic's data. Every resource route is
// expected to return 404 (not 403) for another tenant's record — the app
// deliberately doesn't distinguish "exists but isn't yours" from "doesn't
// exist" in its responses, so a 403 would itself be an information leak.
//
// Run against a dedicated test database (see .env.test) — never the dev DB.
// Usage: npm test (see package.json), which loads .env.test via
// `node --env-file`.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let mechA, mechB; // { token, userId }

async function registerMechanic(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: 'Test Mechanic' });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token, userId: res.body.user.id, email };
}

function authed(req, token) {
  return req.set('Authorization', `Bearer ${token}`);
}

before(async () => {
  mechA = await registerMechanic(`tenant-a-${Date.now()}@test.internal`);
  mechB = await registerMechanic(`tenant-b-${Date.now()}@test.internal`);
});

after(async () => {
  // WorkOrderPartUsed.inventoryItemId is onDelete: Restrict (on purpose —
  // an in-use part can't be deleted via the API) while InventoryItem itself
  // cascades from User. Deleting the User directly can hit that Restrict
  // depending on Postgres's FK-resolution order (see schema.prisma). Delete
  // work orders first (cascades their subjects/parts_used) so no dangling
  // reference remains, then the user cascade is unambiguous.
  const userIds = [mechA.userId, mechB.userId];
  await prisma.workOrder.deleteMany({ where: { client: { mechanicId: { in: userIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('unauthenticated requests', () => {
  test('every protected resource list rejects a missing token', async () => {
    for (const path of ['/api/clients', '/api/vehicles', '/api/inventory/items', '/api/work-orders', '/api/invoices', '/api/shop-settings']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 401, `${path} should require auth`);
    }
  });
});

describe('Client isolation', () => {
  let clientA;

  before(async () => {
    const res = await authed(request(app).post('/api/clients'), mechA.token).send({ name: 'A Client', phone: '555-0001' });
    assert.equal(res.status, 201);
    clientA = res.body;
  });

  test("B's list never includes A's client", async () => {
    const res = await authed(request(app).get('/api/clients'), mechB.token);
    assert.equal(res.status, 200);
    assert.ok(!res.body.some((c) => c.id === clientA.id));
  });

  test("B can't GET A's client by id (404, not 403)", async () => {
    const res = await authed(request(app).get(`/api/clients/${clientA.id}`), mechB.token);
    assert.equal(res.status, 404);
  });

  test("B can't PATCH A's client", async () => {
    const res = await authed(request(app).patch(`/api/clients/${clientA.id}`), mechB.token).send({ name: 'Hijacked' });
    assert.equal(res.status, 404);
    const check = await authed(request(app).get(`/api/clients/${clientA.id}`), mechA.token);
    assert.equal(check.body.name, 'A Client', "A's client must be unmodified");
  });

  test("B can't DELETE A's client", async () => {
    const res = await authed(request(app).delete(`/api/clients/${clientA.id}`), mechB.token);
    assert.equal(res.status, 404);
    const check = await authed(request(app).get(`/api/clients/${clientA.id}`), mechA.token);
    assert.equal(check.status, 200, "A's client must still exist");
  });
});

describe('Vehicle isolation', () => {
  let clientA, vehicleA;

  before(async () => {
    clientA = (await authed(request(app).post('/api/clients'), mechA.token).send({ name: 'Veh Owner', phone: '555-0002' })).body;
    const res = await authed(request(app).post('/api/vehicles'), mechA.token).send({ client_id: clientA.id, make: 'Ford', model: 'F-150' });
    assert.equal(res.status, 201);
    vehicleA = res.body;
  });

  test("B's list never includes A's vehicle", async () => {
    const res = await authed(request(app).get('/api/vehicles'), mechB.token);
    assert.ok(!res.body.some((v) => v.id === vehicleA.id));
  });

  test("B can't GET/PATCH/DELETE A's vehicle", async () => {
    assert.equal((await authed(request(app).get(`/api/vehicles/${vehicleA.id}`), mechB.token)).status, 404);
    assert.equal((await authed(request(app).patch(`/api/vehicles/${vehicleA.id}`), mechB.token).send({ make: 'Hijacked' })).status, 404);
    assert.equal((await authed(request(app).delete(`/api/vehicles/${vehicleA.id}`), mechB.token)).status, 404);
  });

  test("B can't create a vehicle under A's client", async () => {
    const res = await authed(request(app).post('/api/vehicles'), mechB.token).send({ client_id: clientA.id, make: 'Sneaky', model: 'Vehicle' });
    assert.equal(res.status, 404, "creating under someone else's client_id must fail");
  });
});

describe('InventoryItem / InventoryCategory isolation', () => {
  let itemA, categoryA;

  before(async () => {
    categoryA = (await authed(request(app).post('/api/inventory/categories'), mechA.token).send({ name: 'A Category' })).body;
    itemA = (await authed(request(app).post('/api/inventory/items'), mechA.token).send({ name: 'A Part', stock: 5, cost: 10 })).body;
  });

  test("B's item/category lists never include A's", async () => {
    const items = await authed(request(app).get('/api/inventory/items'), mechB.token);
    const cats = await authed(request(app).get('/api/inventory/categories'), mechB.token);
    assert.ok(!items.body.some((i) => i.id === itemA.id));
    assert.ok(!cats.body.some((c) => c.id === categoryA.id));
  });

  test("B can't PATCH/DELETE A's item, or DELETE A's category", async () => {
    assert.equal((await authed(request(app).patch(`/api/inventory/items/${itemA.id}`), mechB.token).send({ cost: 999 })).status, 404);
    assert.equal((await authed(request(app).delete(`/api/inventory/items/${itemA.id}`), mechB.token)).status, 404);
    assert.equal((await authed(request(app).delete(`/api/inventory/categories/${categoryA.id}`), mechB.token)).status, 404);
  });

  test("B can't attach a vehicle's common_parts to A's inventory item (IDOR check)", async () => {
    const clientB = (await authed(request(app).post('/api/clients'), mechB.token).send({ name: 'B Client', phone: '555-0003' })).body;
    const res = await authed(request(app).post('/api/vehicles'), mechB.token).send({
      client_id: clientB.id,
      make: 'Honda',
      model: 'Civic',
      common_parts: [{ name: 'stolen ref', inventory_item_id: itemA.id }],
    });
    assert.equal(res.status, 400, "linking to another tenant's inventory item must be rejected");
  });
});

describe('WorkOrder isolation (incl. cross-tenant parts_used IDOR)', () => {
  let clientA, vehicleA, itemA, workOrderA;

  before(async () => {
    clientA = (await authed(request(app).post('/api/clients'), mechA.token).send({ name: 'WO Client', phone: '555-0004' })).body;
    vehicleA = (await authed(request(app).post('/api/vehicles'), mechA.token).send({ client_id: clientA.id, make: 'Toyota', model: 'Tacoma' })).body;
    itemA = (await authed(request(app).post('/api/inventory/items'), mechA.token).send({ name: 'WO Part', stock: 3, cost: 20 })).body;
    const res = await authed(request(app).post('/api/work-orders'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      subjects: [{ description: 'Brake job', parts_used: [{ inventory_item_id: itemA.id, quantity: 1 }] }],
    });
    assert.equal(res.status, 201);
    workOrderA = res.body;
  });

  test("B's list never includes A's work order", async () => {
    const res = await authed(request(app).get('/api/work-orders'), mechB.token);
    assert.ok(!res.body.some((w) => w.id === workOrderA.id));
  });

  test("B can't GET/PATCH/DELETE A's work order", async () => {
    assert.equal((await authed(request(app).get(`/api/work-orders/${workOrderA.id}`), mechB.token)).status, 404);
    assert.equal((await authed(request(app).patch(`/api/work-orders/${workOrderA.id}`), mechB.token).send({ status: 'Invoiced' })).status, 404);
    assert.equal((await authed(request(app).delete(`/api/work-orders/${workOrderA.id}`), mechB.token)).status, 404);
  });

  test("B can't reference A's inventory item in B's own work order", async () => {
    const clientB = (await authed(request(app).post('/api/clients'), mechB.token).send({ name: 'B Client 2', phone: '555-0005' })).body;
    const vehicleB = (await authed(request(app).post('/api/vehicles'), mechB.token).send({ client_id: clientB.id, make: 'Kia', model: 'Soul' })).body;
    const res = await authed(request(app).post('/api/work-orders'), mechB.token).send({
      client_id: clientB.id,
      vehicle_id: vehicleB.id,
      subjects: [{ description: 'sneaky', parts_used: [{ inventory_item_id: itemA.id, quantity: 1 }] }],
    });
    assert.equal(res.status, 400, "referencing another tenant's inventory item must be rejected");
  });

  test("A can't delete an inventory item that's actually in use on a work order", async () => {
    const res = await authed(request(app).delete(`/api/inventory/items/${itemA.id}`), mechA.token);
    assert.equal(res.status, 409, "a part referenced by work_order_parts_used must be rejected, not silently orphaned");
  });
});

describe('Invoice isolation', () => {
  let clientA, vehicleA, invoiceA;

  before(async () => {
    clientA = (await authed(request(app).post('/api/clients'), mechA.token).send({ name: 'Inv Client', phone: '555-0006' })).body;
    vehicleA = (await authed(request(app).post('/api/vehicles'), mechA.token).send({ client_id: clientA.id, make: 'Jeep', model: 'Wrangler' })).body;
    const res = await authed(request(app).post('/api/invoices'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      lines: [{ description: 'Labor', quantity: 1, unit_price: 50 }],
    });
    assert.equal(res.status, 201);
    invoiceA = res.body;
  });

  test("B's list never includes A's invoice", async () => {
    const res = await authed(request(app).get('/api/invoices'), mechB.token);
    assert.ok(!res.body.some((i) => i.id === invoiceA.id));
  });

  test("B can't GET/PATCH/DELETE A's invoice", async () => {
    assert.equal((await authed(request(app).get(`/api/invoices/${invoiceA.id}`), mechB.token)).status, 404);
    assert.equal((await authed(request(app).patch(`/api/invoices/${invoiceA.id}`), mechB.token).send({ status: 'paid' })).status, 404);
    assert.equal((await authed(request(app).delete(`/api/invoices/${invoiceA.id}`), mechB.token)).status, 404);
  });
});

describe('ShopSettings isolation', () => {
  before(async () => {
    const res = await authed(request(app).put('/api/shop-settings'), mechA.token).send({ shop_name: "A's Shop", tax_rate: 8.5 });
    assert.equal(res.status, 200);
  });

  test("B's GET /shop-settings never returns A's settings", async () => {
    const res = await authed(request(app).get('/api/shop-settings'), mechB.token);
    assert.equal(res.status, 200);
    // null (no row for B yet) — never A's shop_name.
    assert.notEqual(res.body?.shop_name, "A's Shop");
  });
});

describe('cross-tenant resource combination', () => {
  test("A can't create a work order mixing A's client with B's vehicle", async () => {
    const clientA = (await authed(request(app).post('/api/clients'), mechA.token).send({ name: 'Mix Client', phone: '555-0007' })).body;
    const clientB = (await authed(request(app).post('/api/clients'), mechB.token).send({ name: 'Mix Client B', phone: '555-0008' })).body;
    const vehicleB = (await authed(request(app).post('/api/vehicles'), mechB.token).send({ client_id: clientB.id, make: 'Mazda', model: 'CX-5' })).body;

    const res = await authed(request(app).post('/api/work-orders'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleB.id, // belongs to B, not to clientA
    });
    assert.equal(res.status, 404, "vehicle_id must belong to the given client_id, not just to the requesting mechanic");
  });
});

describe('Inventory stock adjustments from work orders', () => {
  let clientA, vehicleA, itemA;

  before(async () => {
    clientA = (await authed(request(app).post('/api/clients'), mechA.token).send({ name: 'Stock Client', phone: '555-0009' })).body;
    vehicleA = (await authed(request(app).post('/api/vehicles'), mechA.token).send({ client_id: clientA.id, make: 'Chevy', model: 'Silverado' })).body;
    itemA = (await authed(request(app).post('/api/inventory/items'), mechA.token).send({ name: 'Stock Part', stock: 10, cost: 5 })).body;
  });

  test('creating a work order decrements stock by the quantity used', async () => {
    const res = await authed(request(app).post('/api/work-orders'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      subjects: [{ description: 'Job 1', parts_used: [{ inventory_item_id: itemA.id, quantity: 3 }] }],
    });
    assert.equal(res.status, 201);
    const item = await authed(request(app).get('/api/inventory/items'), mechA.token);
    assert.equal(item.body.find((i) => i.id === itemA.id).stock, 7, '10 - 3 used = 7');

    // editing it to use a different quantity restores the old amount first,
    // then consumes the new one -- not just consuming the new amount on top
    const wo = res.body;
    const editRes = await authed(request(app).patch(`/api/work-orders/${wo.id}`), mechA.token).send({
      subjects: [{ description: 'Job 1 (revised)', parts_used: [{ inventory_item_id: itemA.id, quantity: 5 }] }],
    });
    assert.equal(editRes.status, 200);
    const afterEdit = await authed(request(app).get('/api/inventory/items'), mechA.token);
    assert.equal(afterEdit.body.find((i) => i.id === itemA.id).stock, 5, '7 + 3 restored - 5 newly used = 5');

    // deleting the work order restores the stock it was still holding
    const delRes = await authed(request(app).delete(`/api/work-orders/${wo.id}`), mechA.token);
    assert.equal(delRes.status, 204);
    const afterDelete = await authed(request(app).get('/api/inventory/items'), mechA.token);
    assert.equal(afterDelete.body.find((i) => i.id === itemA.id).stock, 10, '5 + 5 restored = back to the original 10');
  });

  test('a standalone invoice (no work order) decrements stock for its product lines', async () => {
    const stockAt = async () => (await authed(request(app).get('/api/inventory/items'), mechA.token)).body.find((i) => i.id === itemA.id).stock;

    const res = await authed(request(app).post('/api/invoices'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      lines: [{ description: 'Stock Part', quantity: 4, unit_price: 20, inventory_item_id: itemA.id }],
    });
    assert.equal(res.status, 201);
    assert.equal(await stockAt(), 6, '10 - 4 used = 6');

    // editing the quantity restores the old amount before consuming the new one
    const editRes = await authed(request(app).patch(`/api/invoices/${res.body.id}`), mechA.token).send({
      lines: [{ description: 'Stock Part', quantity: 2, unit_price: 20, inventory_item_id: itemA.id }],
    });
    assert.equal(editRes.status, 200);
    assert.equal(await stockAt(), 8, '6 + 4 restored - 2 newly used = 8');

    // deleting it restores what it was still holding
    const delRes = await authed(request(app).delete(`/api/invoices/${res.body.id}`), mechA.token);
    assert.equal(delRes.status, 204);
    assert.equal(await stockAt(), 10, '8 + 2 restored = back to the original 10');
  });

  test("an invoice generated FROM a work order doesn't double-decrement stock", async () => {
    const stockAt = async () => (await authed(request(app).get('/api/inventory/items'), mechA.token)).body.find((i) => i.id === itemA.id).stock;

    const woRes = await authed(request(app).post('/api/work-orders'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      subjects: [{ description: 'Job 2', parts_used: [{ inventory_item_id: itemA.id, quantity: 2 }] }],
    });
    assert.equal(woRes.status, 201);
    assert.equal(await stockAt(), 8, "work order alone: 10 - 2 = 8");

    // the invoice mirrors the same part/quantity (as InvoiceForm.jsx does
    // when generating one from a work order) -- stock must NOT drop again
    const invRes = await authed(request(app).post('/api/invoices'), mechA.token).send({
      work_order_id: woRes.body.id,
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      lines: [{ description: 'Stock Part', quantity: 2, unit_price: 20, inventory_item_id: itemA.id }],
    });
    assert.equal(invRes.status, 201);
    assert.equal(await stockAt(), 8, 'still 8 -- the invoice must not decrement again for a work-order-linked line');

    // editing that invoice's lines also must not touch stock
    const editRes = await authed(request(app).patch(`/api/invoices/${invRes.body.id}`), mechA.token).send({
      lines: [{ description: 'Stock Part', quantity: 5, unit_price: 20, inventory_item_id: itemA.id }],
    });
    assert.equal(editRes.status, 200);
    assert.equal(await stockAt(), 8, 'editing a work-order-linked invoice must not adjust stock either');

    // and deleting a work-order-linked invoice must not restore stock it
    // never actually held (that would inflate it)
    const delRes = await authed(request(app).delete(`/api/invoices/${invRes.body.id}`), mechA.token);
    assert.equal(delRes.status, 204);
    assert.equal(await stockAt(), 8, 'deleting the invoice must not restore stock -- it never decremented it');

    // cleanup: give the part back via the work order that's still open
    await authed(request(app).delete(`/api/work-orders/${woRes.body.id}`), mechA.token);
    assert.equal(await stockAt(), 10, 'sanity check: back to 10 once the work order itself is gone');
  });

  test("deleting a work order whose invoice survives doesn't let that orphaned invoice inflate stock later", async () => {
    const stockAt = async () => (await authed(request(app).get('/api/inventory/items'), mechA.token)).body.find((i) => i.id === itemA.id).stock;

    const woRes = await authed(request(app).post('/api/work-orders'), mechA.token).send({
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      subjects: [{ description: 'Job 3', parts_used: [{ inventory_item_id: itemA.id, quantity: 1 }] }],
    });
    const invRes = await authed(request(app).post('/api/invoices'), mechA.token).send({
      work_order_id: woRes.body.id,
      client_id: clientA.id,
      vehicle_id: vehicleA.id,
      lines: [{ description: 'Stock Part', quantity: 1, unit_price: 20, inventory_item_id: itemA.id }],
    });
    assert.equal(await stockAt(), 9, '10 - 1 = 9');

    // deleting the work order (not the invoice) restores its 1 unit --
    // Invoice.workOrderId -> null (onDelete: SetNull), but the invoice's
    // own stockAdjustedHere flag must stay false regardless
    await authed(request(app).delete(`/api/work-orders/${woRes.body.id}`), mechA.token);
    assert.equal(await stockAt(), 10, 'work order deletion alone restores the 1 unit');

    // now delete the orphaned invoice -- it must NOT restore stock again,
    // since it never decremented any itself
    const delRes = await authed(request(app).delete(`/api/invoices/${invRes.body.id}`), mechA.token);
    assert.equal(delRes.status, 204);
    assert.equal(await stockAt(), 10, "the orphaned invoice's own delete must not inflate stock past the original 10");
  });

  test("B can't create or edit an invoice line referencing A's inventory item (IDOR)", async () => {
    const clientB = (await authed(request(app).post('/api/clients'), mechB.token).send({ name: 'Stock Client B', phone: '555-0010' })).body;
    const vehicleB = (await authed(request(app).post('/api/vehicles'), mechB.token).send({ client_id: clientB.id, make: 'Ford', model: 'Ranger' })).body;

    const createRes = await authed(request(app).post('/api/invoices'), mechB.token).send({
      client_id: clientB.id,
      vehicle_id: vehicleB.id,
      lines: [{ description: 'sneaky', quantity: 1, unit_price: 10, inventory_item_id: itemA.id }],
    });
    assert.equal(createRes.status, 400, "referencing another tenant's inventory item must be rejected");

    const legitRes = await authed(request(app).post('/api/invoices'), mechB.token).send({
      client_id: clientB.id,
      vehicle_id: vehicleB.id,
      lines: [{ description: 'legit line', quantity: 1, unit_price: 10 }],
    });
    assert.equal(legitRes.status, 201);
    const editRes = await authed(request(app).patch(`/api/invoices/${legitRes.body.id}`), mechB.token).send({
      lines: [{ description: 'sneaky edit', quantity: 1, unit_price: 10, inventory_item_id: itemA.id }],
    });
    assert.equal(editRes.status, 400, "editing in a reference to another tenant's inventory item must also be rejected");
  });
});
