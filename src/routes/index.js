import { Router } from 'express';
import authRoutes from './auth.routes.js';
import clientsRoutes from './clients.routes.js';
import vehiclesRoutes from './vehicles.routes.js';
import inventoryRoutes from './inventory.routes.js';
import workOrdersRoutes from './workOrders.routes.js';
import invoicesRoutes from './invoices.routes.js';
import shopSettingsRoutes from './shopSettings.routes.js';
import checkoutRoutes from './checkout.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import webhooksRoutes from './webhooks.routes.js';

const router = Router();

router.use('/auth', authRoutes);
// Public -- Lemon Squeezy calls this directly, it can't send a Bearer token.
// Authenticity is checked by HMAC signature inside the route itself, not by
// requireAuth.
router.use('/webhooks', webhooksRoutes);
// Authenticated but intentionally NOT behind requireActiveSubscription --
// both routes exist specifically for accounts that don't have one yet.
router.use('/checkout', checkoutRoutes);
router.use('/subscription', subscriptionRoutes);

router.use('/clients', clientsRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/work-orders', workOrdersRoutes);
router.use('/invoices', invoicesRoutes);
router.use('/shop-settings', shopSettingsRoutes);

export default router;
