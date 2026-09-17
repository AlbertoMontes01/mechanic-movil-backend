import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import apiRoutes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set — refusing to start (see .env.example)');
}

export const app = express();

// Behind a reverse proxy in production (Hostinger, nginx, etc.) so
// req.ip/req.protocol and the rate limiter see the real client IP from
// X-Forwarded-For instead of the proxy's own address.
app.set('trust proxy', 1);

app.use(helmet());
// credentials: true + an explicit (non-wildcard) allowlist — required for the
// httpOnly refresh-token cookie to be sent/received cross-origin. A comma-
// separated CORS_ORIGIN lets the apex and www variants of the same site
// both count as trusted (the browser treats them as different origins).
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

// Shop logos are served from a different origin than the frontend
// (app./api. subdomains, or api.pitstop.systems vs pitstop.systems) --
// helmet's default Cross-Origin-Resource-Policy: same-origin would block
// the browser from actually rendering them as <img> there, so relax it
// for just this path. These are logo images meant to appear on
// customer-facing invoice PDFs, not sensitive data, so that's fine.
app.use(
  '/uploads',
  helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
  express.static('uploads')
);

app.use('/api', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
