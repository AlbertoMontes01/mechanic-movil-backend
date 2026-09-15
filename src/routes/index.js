import { Router } from 'express';
import authRoutes from './auth.routes.js';
import clientsRoutes from './clients.routes.js';
import vehiclesRoutes from './vehicles.routes.js';
import inventoryRoutes from './inventory.routes.js';
import workOrdersRoutes from './workOrders.routes.js';
import invoicesRoutes from './invoices.routes.js';
import shopSettingsRoutes from './shopSettings.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/clients', clientsRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/work-orders', workOrdersRoutes);
router.use('/invoices', invoicesRoutes);
router.use('/shop-settings', shopSettingsRoutes);

export default router;
