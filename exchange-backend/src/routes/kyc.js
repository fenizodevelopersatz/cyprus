import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { ok, fail } from '../utils/responses.js';
import {
  getKycStatus,
  getKycHistory,
  getKycDocumentPreview,
  submitKycDocuments,
  verifyKyc,
} from '../services/kycService.js';

const ALLOWED_KYC_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const ALLOWED_KYC_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_KYC_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

function isAllowedKycFile(file) {
  if (!file) return false;
  const mimeType = String(file.mimetype || '').trim().toLowerCase();
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  return ALLOWED_KYC_MIME_TYPES.has(mimeType) || ALLOWED_KYC_EXTENSIONS.has(extension);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_KYC_IMAGE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedKycFile(file)) return cb(null, true);
    const error = new Error('ONLY_JPG_JPEG_PNG_ALLOWED');
    error.status = 400;
    return cb(error);
  },
});

const router = express.Router();

function toAbsoluteUrl(req, value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${req.protocol}://${req.get('host')}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function withAbsolutePreviewUrls(req, payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.documents)) return payload;
  return {
    ...payload,
    documents: payload.documents.map((doc) => ({
      ...doc,
      previewUrl: doc?.previewUrl ? toAbsoluteUrl(req, doc.previewUrl) : doc?.previewUrl,
    })),
  };
}

/**
 * @openapi
 * tags:
 *   - name: KYC
 *     description: Verification flow
 */

/**
 * @openapi
 * /api/kyc/status:
 *   get:
 *     summary: Get KYC status
 *     security:
 *       - bearerAuth: []
 *     tags: [KYC]
 *     responses:
 *       200:
 *         description: Current KYC status
 */
router.get('/status', requireAuth, async (req, res) => {
  ok(res, withAbsolutePreviewUrls(req, await getKycStatus(req.user.id)));
});

/**
 * @openapi
 * /api/kyc/history:
 *   get:
 *     summary: KYC activity history
 *     security:
 *       - bearerAuth: []
 *     tags: [KYC]
 *     responses:
 *       200:
 *         description: Activity list
 */
router.get('/history', requireAuth, async (req, res) => {
  ok(res, await getKycHistory(req.user.id));
});

router.get('/documents/:id/preview', requireAuth, async (req, res) => {
  try {
    const file = await getKycDocumentPreview(req.params.id, req.user.id);
    if (!fs.existsSync(file.absolutePath)) {
      return fail(res, 'DOCUMENT_FILE_NOT_FOUND', 404);
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(file.filename)}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    return res.sendFile(file.absolutePath);
  } catch (err) {
    return fail(res, err.message || 'Unable to preview document', err.status || 400);
  }
});

/**
 * @openapi
 * /api/kyc/documents:
 *   post:
 *     summary: Submit KYC documents
 *     security:
 *       - bearerAuth: []
 *     tags: [KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [documentType, primary]
 *             properties:
 *               documentType:
 *                 type: string
 *                 example: passport
 *               primary:
 *                 type: string
 *                 format: binary
 *               secondary:
 *                 type: string
 *                 format: binary
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Submission accepted
 */
router.post(
  '/documents',
  requireAuth,
  upload.fields([
    { name: 'primary', maxCount: 1 },
    { name: 'secondary', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { documentType, notes, dateOfBirth } = req.body || {};
      const files = req.files || {};
      const primary = Array.isArray(files.primary) ? files.primary[0] : null;
      const secondary = Array.isArray(files.secondary) ? files.secondary[0] : null;
      const response = await submitKycDocuments(req.user.id, {
        documentType,
        primary,
        secondary,
        notes,
        dateOfBirth,
      });
      ok(res, response, 201);
    } catch (err) {
      const message = err.message || 'Unable to submit documents';
      const status =
        ['DOCUMENT_TYPE_REQUIRED', 'PRIMARY_DOCUMENT_REQUIRED', 'SECONDARY_DOCUMENT_REQUIRED', 'ONLY_JPG_JPEG_PNG_ALLOWED', 'INVALID_IMAGE_FILE'].includes(err.message)
          ? 400
          : err.code === 'LIMIT_FILE_SIZE'
            ? 400
            : 502;
      const responseMessage =
        err.message === 'ONLY_JPG_JPEG_PNG_ALLOWED'
          ? 'Only JPG, JPEG, and PNG images are allowed.'
          : err.message === 'SECONDARY_DOCUMENT_REQUIRED'
            ? 'Secondary image is required for this document type.'
            : err.message === 'INVALID_IMAGE_FILE'
              ? 'Uploaded image is invalid or empty.'
          : err.code === 'LIMIT_FILE_SIZE'
            ? 'Maximum file size is 10 MB.'
            : message;
      fail(res, responseMessage, status);
    }
  }
);

/**
 * @openapi
 * /api/kyc/verify:
 *   post:
 *     summary: Verify KYC (Admin only)
 *     security:
 *       - bearerAuth: []
 *     tags: [KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: integer
 *               approved:
 *                 type: boolean
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification updated
 */
router.post('/verify', requireAuth, requireRole('admin'), async (req, res) => {
  const { userId, approved = true, notes } = req.body || {};
  if (!userId) return fail(res, 'userId is required', 400);
  try {
    await verifyKyc(req.user.id, Number(userId), !!approved, notes);
    ok(res, { verified: !!approved });
  } catch (err) {
    fail(res, err.message || 'Unable to update verification', err.status || 400);
  }
});

export default router;
