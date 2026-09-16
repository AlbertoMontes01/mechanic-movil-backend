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
// credentials: true + an explicit (non-wildcard) origin — required for the
// httpOnly refresh-token cookie to be sent/received cross-origin.
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
