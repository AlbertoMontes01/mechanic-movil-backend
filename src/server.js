import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apiRoutes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set — refusing to start (see .env.example)');
}

const app = express();

// Behind a reverse proxy in production (Hostinger, nginx, etc.) so
// req.ip/req.protocol and the rate limiter below see the real client IP
// from X-Forwarded-For instead of the proxy's own address.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`mechanic-movil-backend listening on :${port}`);
});
