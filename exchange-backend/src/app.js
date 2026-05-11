import 'express-async-errors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { celebrateErrors } from './middleware/validate.js';
import { errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import userRoutes from './routes/user.js';
import usersRoutes from './routes/users.js';
import kycRoutes from './routes/kyc.js';
import accountRoutes from './routes/account.js';
import walletRoutes from './routes/wallet.js';
import portfolioRoutes from './routes/portfolio.js';
import ordersRoutes from './routes/orders.js';
import marketsRoutes from './routes/markets.js';
import spotRoutes from './routes/spot.js';
import swapRoutes from './routes/swap.js';
import paperRoutes from './routes/paper.js';
import futuresRoutes from './routes/futures.js';
import adminFuturesRoutes from './routes/admin/futures.js';
import adminWalletRoutes from './routes/admin/wallet.js';
import adminSessionRoutes from './routes/admin/session.js';
import adminDashboardRoutes from './routes/admin/dashboard.js';
import adminUsersRoutes from './routes/admin/users.js';
import adminMarketsRoutes from './routes/admin/markets.js';
import adminSettingsRoutes from './routes/admin/settings.js';
import adminKycRoutes from './routes/admin/kyc.js';
import adminOrdersRoutes from './routes/admin/orders.js';
import adminAssetsRoutes from './routes/admin/assets.js';
import adminInternalRoutes from './routes/admin/internal.js';
import adminSignalPackageRoutes from './routes/admin/signalPackages.js';
import adminControlSettingsRoutes from './routes/admin/controlSettings.js';
import adminCommissionRoutes from './routes/admin/commission.js';
import adminLevelManagementRoutes from './routes/adminLevelManagement.routes.js';
import contentRoutes from './routes/content.js';
import p2pRoutes from './routes/p2p.js';
import exchangeRoutes from './routes/exchange.js';
import dashboardRoutes from './routes/dashboard.js';
import referralsRoutes from './routes/referrals.js';
import stakingRoutes from './routes/staking.js';
import adminStakingRoutes from './routes/admin/staking.js';
import adminSipRoutes from './routes/admin/sip.js';
import webhooksRoutes from './routes/webhooks.js';
import sipRoutes from './routes/sip.js';
import fundingRoutes from './routes/funding.js';
import devMlmTestRoutes from './routes/devMlmTest.js';

import { swaggerSpec, mountDocs } from './openapi.js';
import { db } from './db.js';
import { appLogger } from './logging/loggers.js';
import { requestContextMiddleware, requestLogger } from './logging/requestLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const PROFILE_STORAGE_DIR = path.resolve(APP_ROOT, 'storage', 'profile');
const SITE_STORAGE_DIR = path.resolve(APP_ROOT, 'storage', 'site');
const KYC_STORAGE_DIR = path.resolve(APP_ROOT, 'storage', 'kyc');

const DEFAULT_ALLOWLIST = [  
  'http://localhost:5173',
  'https://q29l3cr9-5173.inc1.devtunnels.ms',
  '*'
];

const ALLOWLIST = String(process.env.CORS_ALLOWLIST || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
if (ALLOWLIST.length === 0) {
  ALLOWLIST.push(...DEFAULT_ALLOWLIST);
}
const ALLOW_ALL = String(process.env.CORS_ALLOW_ALL || '').toLowerCase() === 'true' || ALLOWLIST.includes('*');
function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOW_ALL) return true;
  try {
    const url = new URL(origin);
    return ALLOWLIST.some((rule) => {
      if (!rule) return false;
      if (rule === '*') return true;
      if (rule.startsWith('*.')) {
        const domain = rule.slice(2);
        return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
      }
      if (rule.startsWith('http://') || rule.startsWith('https://')) {
        return origin === rule;
      }
      return url.hostname === rule;
    });
  } catch {
    return false;
  }
}

const ALLOW_CREDENTIALS =
  String(process.env.CORS_ALLOW_CREDENTIALS || 'true').toLowerCase() === 'true';

appLogger.info({
  event: 'cors_configured',
  allowAll: ALLOW_ALL,
  allowCredentials: ALLOW_CREDENTIALS,
  allowlist: ALLOWLIST,
});

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  let allowOrigin = null;

  if (origin) {
    if (ALLOW_ALL || isOriginAllowed(origin)) {
      allowOrigin = origin;
    } else {
      return res.status(403).json({
        error: 'CORS origin not allowed',
        origin,
        allowlist: ALLOWLIST
      });
    }
  } else if (ALLOW_ALL) {
    allowOrigin = '*';
  }

  if (!allowOrigin && !origin) {
    return next();
  }

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  if (allowOrigin !== '*' && ALLOW_CREDENTIALS) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(corsMiddleware);
  app.use(requestLogger);
  app.use(requestContextMiddleware);

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use('/webhooks', webhooksRoutes);
  app.use(express.json());

  app.use('/auth', authRoutes);
  app.use('/user', userRoutes);
  app.use('/api/user', userRoutes);
  app.use('/users', usersRoutes);
  app.use('/kyc', kycRoutes);
  app.use('/api/kyc', kycRoutes);
  app.use('/account', accountRoutes);
  app.use('/wallet', walletRoutes);
  app.use('/portfolio', portfolioRoutes);
  app.use('/api/portfolio', portfolioRoutes);
  app.use('/orders', ordersRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/markets', marketsRoutes);
  app.use('/content', contentRoutes);
  app.use('/spot', spotRoutes);
  app.use('/swap', swapRoutes);
  app.use('/paper', paperRoutes);
  app.use('/futures', futuresRoutes);
  app.use('/admin', adminSessionRoutes);
  app.use('/admin', adminDashboardRoutes);
  app.use('/admin/users', adminUsersRoutes);
  app.use('/admin/markets', adminMarketsRoutes);
  app.use('/admin/orders', adminOrdersRoutes);
  app.use('/admin/assets', adminAssetsRoutes);
  app.use('/admin', adminInternalRoutes);
  app.use('/admin/package-settings', adminSignalPackageRoutes);
  app.use('/admin', adminControlSettingsRoutes);
  app.use('/admin', adminCommissionRoutes);
  app.use('/api/admin', adminControlSettingsRoutes);
  app.use('/api/admin', adminCommissionRoutes);
  app.use('/admin', adminLevelManagementRoutes);
  app.use('/api/admin', adminLevelManagementRoutes);
  app.use('/admin/futures', adminFuturesRoutes);
  app.use('/admin/staking', adminStakingRoutes);
  app.use('/admin/sip', adminSipRoutes);
  app.use('/admin/wallet', adminWalletRoutes);
  app.use('/admin/settings', adminSettingsRoutes);
  app.use('/admin/kyc', adminKycRoutes);
  app.use('/p2p', p2pRoutes);
  app.use('/api/exchange', exchangeRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/dashboard', dashboardRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/referrals', referralsRoutes);
  app.use('/staking', stakingRoutes);
  app.use('/api/staking', stakingRoutes);
  app.use('/sip', sipRoutes);
  app.use('/api/sip', sipRoutes);
  app.use('/api/funding', fundingRoutes);
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    app.use('/api/dev/mlm-test', devMlmTestRoutes);
  }

  // Serve profile images with route-level CORS/CORP headers so <img> works across devtunnels.
  app.use(
    '/api/storage/profile',
    express.static(PROFILE_STORAGE_DIR, {
      fallthrough: false,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');

        const origin = res.req?.headers?.origin;
        if (origin && isOriginAllowed(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Vary', 'Origin');
        }

        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      },
    })
  );

  app.use(
    '/api/storage/site',
    express.static(SITE_STORAGE_DIR, {
      fallthrough: false,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.svg'
                  ? 'image/svg+xml'
                  : ext === '.ico'
                    ? 'image/x-icon'
                    : 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');

        const origin = res.req?.headers?.origin;
        if (origin && isOriginAllowed(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Vary', 'Origin');
        }

        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      },
    })
  );

  app.get('/api/storage/kyc/:filename', requireAuth, async (req, res) => {
    try {
      const filename = String(req.params.filename || '').trim();
      if (!filename) {
        return res.status(400).json({ message: 'Invalid filename' });
      }

      const document = await db('kyc_documents')
        .where({ stored_filename: filename })
        .first('user_id', 'stored_filename', 'original_filename', 'mime_type');

      if (!document) {
        return res.status(404).json({ message: 'Document not found' });
      }

      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      const isAdmin = roles.includes('admin');
      if (!isAdmin && Number(document.user_id) !== Number(req.user?.id)) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const absolutePath = path.join(KYC_STORAGE_DIR, document.stored_filename);
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ message: 'Document file not found' });
      }

      res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(document.original_filename || document.stored_filename)}"`);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');

      const origin = req.headers.origin;
      if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      }

      return res.sendFile(absolutePath);
    } catch (err) {
      return res.status(500).json({ message: err.message || 'Unable to load KYC document' });
    }
  });

  mountDocs(app);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.get('/', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'fenizo-exchange',
      docs: '/docs',
      health: '/__health',
    });
  });

  app.get('/__health', (req, res) => res.json({ ok: true }));

  app.use(celebrateErrors());
  app.use(errorHandler);

  app.set('db', db);
  return app;
}
