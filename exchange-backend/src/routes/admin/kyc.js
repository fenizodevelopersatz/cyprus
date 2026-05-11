import express from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { v } from '../../middleware/validate.js';
import {
  getKycDocumentPreviewForAdmin,
  getKycQueueSidebarSummary,
  listKycRequests,
  getKycRequestDetail,
  reviewKycRequest,
} from '../../services/kycService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

function toPreviewPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  try {
    const resolved = new URL(raw);
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
}

function withAdminPreviewUrls(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.documents)) return payload;
  return {
    ...payload,
    documents: payload.documents.map((doc) => ({
      ...doc,
      previewUrl: toPreviewPath(`/admin/kyc/documents/${encodeURIComponent(String(doc.id))}/preview`),
    })),
  };
}

router.get('/requests', guard, async (req, res) => {
  try {
    const result = await listKycRequests({
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
      search: req.query.search,
    });
    ok(res, result);
  } catch (err) {
    fail(res, err.message || 'Unable to load requests', err.status || 400);
  }
});

router.get('/summary', guard, async (_req, res) => {
  try {
    const result = await getKycQueueSidebarSummary();
    ok(res, result);
  } catch (err) {
    fail(res, err.message || 'Unable to load KYC sidebar summary', err.status || 400);
  }
});

router.get('/requests/:id', guard, async (req, res) => {
  try {
    const result = await getKycRequestDetail(req.params.id);
    ok(res, withAdminPreviewUrls(result));
  } catch (err) {
    fail(res, err.message || 'Unable to load request', err.status || 400);
  }
});

router.get('/documents/:id/preview', guard, async (req, res) => {
  try {
    const file = await getKycDocumentPreviewForAdmin(req.params.id);
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

const decisionValidator = v.celebrate({
  [v.Segments.BODY]: v.Joi.object({
    notes: v.Joi.string().max(1000).allow(null, '').optional(),
  }).unknown(false),
});

router.post('/requests/:id/approve', guard, decisionValidator, async (req, res) => {
  try {
    const result = await reviewKycRequest(req.user.id, req.params.id, {
      approved: true,
      notes: req.body?.notes,
    });
    ok(res, withAdminPreviewUrls(result));
  } catch (err) {
    fail(res, err.message || 'Unable to approve request', err.status || 400);
  }
});

router.post('/requests/:id/decline', guard, decisionValidator, async (req, res) => {
  try {
    const result = await reviewKycRequest(req.user.id, req.params.id, {
      approved: false,
      notes: req.body?.notes,
    });
    ok(res, withAdminPreviewUrls(result));
  } catch (err) {
    fail(res, err.message || 'Unable to decline request', err.status || 400);
  }
});

export default router;

