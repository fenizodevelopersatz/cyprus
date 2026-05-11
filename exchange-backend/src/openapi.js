// src/openapi.js
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'NovaX API', version: '0.1.0' },
    servers: [{ url: process.env.APP_BASE_DOMAIN }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    // IMPORTANT: tags must be an array of objects with name
    tags: [
      { name: 'Auth',    description: 'Authentication & sessions' },
      { name: 'User',    description: 'Profile & password' },
      { name: 'KYC',     description: 'Verification flow' },
      { name: 'Account', description: 'Wallets & activity' },
      { name: 'Markets', description: 'Market data' },
      { name: 'Dashboard', description: 'Home widgets & summaries' },
      { name: 'Spot',    description: 'Spot trading' },
      { name: 'Swap',    description: 'Quotes & executions' },
      { name: 'Paper',   description: 'Paper trading' },
      { name: 'Futures', description: 'Perp contracts & account' },
      { name: 'P2P',     description: 'Peer-to-peer desk' },
    ],
  },
  apis: [path.join(__dirname, 'routes/*.js')],
};

export const swaggerSpec = swaggerJSDoc(options);

// Optional: harden in case any upstream adds bad tags later
if (!Array.isArray(swaggerSpec.tags)) swaggerSpec.tags = [];
swaggerSpec.tags = swaggerSpec.tags.filter((t) => t && t.name);

export function mountDocs(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/docs.json', (_req, res) => res.json(swaggerSpec));
}
