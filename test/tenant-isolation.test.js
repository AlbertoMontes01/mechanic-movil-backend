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

  test("B can't PATCH A's item or DELETE A's category", async () => {
    assert.equal((await authed(request(app).patch(`/api/inventory/items/${itemA.id}`), mechB.token).send({ cost: 999 })).status, 404);
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
