import path from 'path';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { db } from '../db.js';
import { cfg } from '../config.js';
import { sendKycSubmissionEmail, sendKycApprovedEmail } from './mailService.js';
import { getUserContact, toAbsoluteProfilePhotoUrl } from './userService.js';

const STORAGE_ROOT = path.resolve('storage', 'kyc');
const IDENTITY_TYPES = new Set(['passport', 'driverslicense', 'drivers_license', 'nationalid', 'national_id', 'identitycard', 'identity_card']);
const PROOF_TYPES = new Set(['proof_of_address', 'proofaddress', 'utilitybill', 'utility_bill', 'bankstatement', 'bank_statement']);
const ENHANCED_TYPES = new Set(['enhanced_verification', 'enhancedverification', 'video_verification', 'videoverification']);
const REQUIRED_KYC_DOCUMENT_TYPES = ['passport', 'driversLicense', 'residence'];
const REQUIRED_PROFILE_BASICS_FIELDS = [
  'first_name',
  'last_name',
  'username',
  'mobile_number',
  'country',
  'state',
  'city',
  'postal_code',
  'date_of_birth',
  'gender',
  'address_line_1',
  'profile_photo',
];

const STATUS_MAP = {
  pending: 'IN_REVIEW',
  in_review: 'IN_REVIEW',
  queue: 'IN_REVIEW',
  approved: 'APPROVED',
  verified: 'APPROVED',
  completed: 'APPROVED',
  rejected: 'REJECTED',
  failed: 'REJECTED',
};

const REQUEST_STATUS_FILTERS = {
  IN_REVIEW: ['pending', 'in_review', 'queue', 'PENDING', 'IN_REVIEW'],
  APPROVED: ['approved', 'APPROVED', 'verified', 'completed'],
  REJECTED: ['rejected', 'REJECTED', 'failed'],
};

export const kycAdminEmitter = new EventEmitter();

async function ensureStorageDir() {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

function normalizeDocType(input) {
  return String(input || '').toLowerCase().replace(/[\s_-]/g, '');
}

function categorizeDocument(type) {
  const normalized = normalizeDocType(type);
  if (IDENTITY_TYPES.has(normalized)) return 'IDENTITY';
  if (PROOF_TYPES.has(normalized)) return 'PROOF';
  if (ENHANCED_TYPES.has(normalized)) return 'ENHANCED';
  return 'OTHER';
}

function normalizeStatus(raw, fallback = 'IN_REVIEW') {
  if (!raw) return fallback;
  const normalized = STATUS_MAP[String(raw).toLowerCase()];
  if (normalized) return normalized;
  const upper = String(raw).toUpperCase();
  if (['IN_REVIEW', 'APPROVED', 'REJECTED', 'PENDING'].includes(upper)) return upper;
  return fallback;
}

function parseDocumentsField(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function canonicalKycDocumentType(type) {
  const normalized = normalizeDocType(type);
  if (!normalized) return '';
  if (normalized.includes('passport')) return 'passport';
  if (normalized.includes('driver')) return 'driversLicense';
  if (normalized.includes('residence') || normalized.includes('proofofaddress') || normalized.includes('utilitybill') || normalized.includes('bankstatement')) {
    return 'residence';
  }
  return normalized;
}

function groupLatestDocumentsByType(documents) {
  const map = new Map();
  for (const doc of documents) {
    const key = normalizeDocType(doc.type);
    if (!key || map.has(key)) continue;
    map.set(key, doc);
  }
  return map;
}

function mapDocumentRow(row) {
  const previewPath = `/api/kyc/documents/${row.id}/preview`;
  const storagePath = `/api/storage/kyc/${row.stored_filename}`;
  return {
    id: row.id,
    submissionId: row.submission_id,
    type: row.document_type,
    filename: row.original_filename,
    storedFilename: row.stored_filename,
    mimeType: row.mime_type,
    size: row.size,
    status: normalizeStatus(row.status),
    uploadedAt: row.created_at,
    updatedAt: row.updated_at,
    notes: row.notes || null,
    isSecondary: !!row.is_secondary,
    previewUrl: `${cfg.api.baseUrl}${previewPath}`,
    storageUrl: `${cfg.api.baseUrl}${storagePath}`,
  };
}

function buildStep(base, override) {
  return {
    code: base.code,
    title: base.title,
    description: base.description,
    status: override?.status || 'PENDING',
    completedAt: override?.completedAt || null,
  };
}

function mapKycRequestRow(row) {
  const documents = parseDocumentsField(row.documents);
  return {
    id: row.id,
    userId: row.user_id,
    submissionId: row.submission_id,
    status: normalizeStatus(row.status),
    rawStatus: row.status,
    resubmissionRequired: !!row.resubmission_required,
    notes: row.notes || null,
    reviewerId: row.reviewer_id || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentCount: documents.length,
    user: {
      id: row.user_id,
      email: row.email || null,
      displayName: row.display_name || null,
      profilePhoto: toAbsoluteProfilePhotoUrl(row.profile_photo),
      country: row.country || null,
      kycLevel: row.kyc_level || 0,
    },
  };
}

function deriveStepFromDocs(docs) {
  if (!docs.length) return { status: 'PENDING', completedAt: null };
  const latest = docs[0];
  return {
    status: normalizeStatus(latest.status),
    completedAt: latest.updated_at || latest.created_at || null,
  };
}

function hasProfileFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function getProfileBasicsProgress(profile, user) {
  const missingFields = REQUIRED_PROFILE_BASICS_FIELDS.filter((field) => !hasProfileFieldValue(profile?.[field]));
  return {
    complete: missingFields.length === 0,
    missingFields,
    completedAt: profile?.updated_at || user?.updated_at || user?.created_at || null,
  };
}

function baseKycRequestQuery() {
  return db('kyc_requests as r')
    .join('users as u', 'u.id', 'r.user_id')
    .leftJoin('user_profiles as p', 'p.user_id', 'u.id');
}

export async function getKycStatus(userId) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new Error('USER_NOT_FOUND');

  const [latestRequest, docRows, profile] = await Promise.all([
    db('kyc_requests').where({ user_id: userId }).orderBy('created_at', 'desc').first(),
    db('kyc_documents').where({ user_id: userId }).orderBy('created_at', 'desc'),
    db('user_profiles').where({ user_id: userId }).first(),
  ]);

  const documents = docRows.map(mapDocumentRow);
  const latestDocumentsByType = groupLatestDocumentsByType(documents);
  const latestDocuments = Array.from(latestDocumentsByType.values());
  const identityDocs = documents.filter((doc) => categorizeDocument(doc.type) === 'IDENTITY');
  const proofDocs = documents.filter((doc) => categorizeDocument(doc.type) === 'PROOF');
  const enhancedDocs = documents.filter((doc) => categorizeDocument(doc.type) === 'ENHANCED');
  const profileBasics = getProfileBasicsProgress(profile, user);

  const stepsBase = [
    {
      code: 'ACCOUNT_CREATED',
      title: 'Account Created',
      description: 'Basic profile completed and email verified.',
    },
    {
      code: 'IDENTITY_SUBMITTED',
      title: 'Identity Submitted',
      description: 'Government ID under review by compliance.',
    },
    {
      code: 'PROOF_OF_ADDRESS',
      title: 'Proof of Address',
      description: 'Upload a recent utility bill or bank statement.',
    },
    {
      code: 'ENHANCED_VERIFICATION',
      title: 'Enhanced Verification',
      description: 'Video verification for higher limits.',
    },
  ];

  const steps = [
    buildStep(stepsBase[0], { status: profileBasics.complete ? 'APPROVED' : 'PENDING', completedAt: profileBasics.complete ? profileBasics.completedAt : null }),
    buildStep(stepsBase[1], deriveStepFromDocs(identityDocs)),
    buildStep(stepsBase[2], deriveStepFromDocs(proofDocs)),
    buildStep(stepsBase[3], deriveStepFromDocs(enhancedDocs)),
  ];

  if (latestRequest?.status) {
    const normalized = normalizeStatus(latestRequest.status);
    if (normalized === 'APPROVED') {
      steps[1].status = steps[1].status === 'PENDING' ? 'APPROVED' : steps[1].status;
      steps[1].completedAt = steps[1].completedAt || latestRequest.reviewed_at || latestRequest.updated_at;
    }
  }

  let overallStatus = 'PENDING';
  if (latestRequest) {
    overallStatus = normalizeStatus(latestRequest.status, 'IN_REVIEW');
  } else if (identityDocs.length || proofDocs.length || enhancedDocs.length) {
    overallStatus = 'IN_REVIEW';
  }

  const resubmissionRequired = !!(latestRequest?.resubmission_required || latestRequest?.status === 'rejected');
  const kycVerified = !!user.kyc_verified;
  const approvedDocumentTypes = new Set(
    latestDocuments
      .filter((doc) => normalizeStatus(doc.status) === 'APPROVED')
      .map((doc) => canonicalKycDocumentType(doc.type))
      .filter(Boolean)
  );
  const pendingDocumentTypes = new Set(
    latestDocuments
      .filter((doc) => normalizeStatus(doc.status) === 'IN_REVIEW')
      .map((doc) => canonicalKycDocumentType(doc.type))
      .filter(Boolean)
  );
  const rejectedDocumentTypes = new Set(
    latestDocuments
      .filter((doc) => normalizeStatus(doc.status) === 'REJECTED')
      .map((doc) => canonicalKycDocumentType(doc.type))
      .filter(Boolean)
  );
  const hasAnySubmission = documents.length > 0;
  const hasPendingReview = pendingDocumentTypes.size > 0;
  const hasApprovedDocuments = approvedDocumentTypes.size > 0;
  const allowedDocumentTypes = REQUIRED_KYC_DOCUMENT_TYPES.filter((type) => {
    if (approvedDocumentTypes.has(type)) return false;
    if (pendingDocumentTypes.has(type)) return false;
    return true;
  });
  const canSubmitDocuments = allowedDocumentTypes.length > 0;
  let uploadBlockedReason = null;
  if (approvedDocumentTypes.size >= REQUIRED_KYC_DOCUMENT_TYPES.length) {
    uploadBlockedReason = 'KYC already approved.';
  } else if (!canSubmitDocuments) {
    uploadBlockedReason = hasPendingReview
      ? 'This document type is already pending approval or approved.'
      : hasApprovedDocuments || hasAnySubmission
        ? 'Approved documents are already on file for the selected type.'
        : 'No document types are currently available for upload.';
  }

  return {
    userId,
    overallStatus,
    tier: user.kyc_level || 0,
    steps,
    documents,
    notes: latestRequest?.notes || null,
    resubmissionRequired,
    kycVerified,
    profileBasicsComplete: profileBasics.complete,
    missingProfileFields: profileBasics.missingFields,
    canSubmitDocuments,
    allowedDocumentTypes,
    uploadBlockedReason,
  };
}

export async function getKycHistory(userId) {
  const rows = await db('kyc_activity')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    message: row.message,
    metadata: row.metadata ? (() => {
      try {
        return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      } catch {
        return row.metadata;
      }
    })() : null,
    createdAt: row.created_at,
  }));
}

export async function getKycDocumentPreview(documentId, userId) {
  const id = Number(documentId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('INVALID_DOCUMENT_ID');
    err.status = 400;
    throw err;
  }

  const row = await db('kyc_documents')
    .where({ id, user_id: userId })
    .first();

  if (!row) {
    const err = new Error('DOCUMENT_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const absolutePath = path.join(STORAGE_ROOT, row.stored_filename);
  return {
    absolutePath,
    filename: row.original_filename || row.stored_filename,
    mimeType: row.mime_type || 'application/octet-stream',
  };
}

export async function getKycDocumentPreviewForAdmin(documentId) {
  const id = Number(documentId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('INVALID_DOCUMENT_ID');
    err.status = 400;
    throw err;
  }

  const row = await db('kyc_documents')
    .where({ id })
    .first();

  if (!row) {
    const err = new Error('DOCUMENT_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const absolutePath = path.join(STORAGE_ROOT, row.stored_filename);
  return {
    absolutePath,
    filename: row.original_filename || row.stored_filename,
    mimeType: row.mime_type || 'application/octet-stream',
  };
}

export async function listKycRequests({ status, search, page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeSize = Math.min(Math.max(Number(pageSize) || 25, 1), 200);
  const normalized = status ? normalizeStatus(status, null) : null;
  const normalizedKey = normalized === 'PENDING' ? 'IN_REVIEW' : normalized;
  const query = baseKycRequestQuery();
  if (normalizedKey && REQUEST_STATUS_FILTERS[normalizedKey]) {
    query.whereIn('r.status', REQUEST_STATUS_FILTERS[normalizedKey]);
  }
  if (search) {
    const term = String(search).trim();
    if (term) {
      query.where((builder) => {
        builder.whereILike('u.email', `%${term}%`);
        builder.orWhereILike('p.display_name', `%${term}%`);
        builder.orWhereILike('r.submission_id', `%${term}%`);
      });
    }
  }

  const totalRow = await query.clone().count({ count: '*' }).first();
  const total = Number(totalRow?.count || 0);
  const rows = await query
    .clone()
    .orderBy('r.created_at', 'desc')
    .limit(safeSize)
    .offset((safePage - 1) * safeSize)
    .select(
      'r.*',
      'u.email',
      'u.country',
      'u.kyc_level',
      'p.display_name',
      'p.profile_photo'
    );

  return {
    meta: {
      page: safePage,
      pageSize: safeSize,
      total,
      totalPages: Math.ceil(total / safeSize),
    },
    items: rows.map(mapKycRequestRow),
  };
}

export async function getKycRequestDetail(requestId) {
  const id = Number(requestId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('INVALID_REQUEST_ID');
    err.status = 400;
    throw err;
  }
  const row = await baseKycRequestQuery()
    .where('r.id', id)
    .select(
      'r.*',
      'u.email',
      'u.country',
      'u.kyc_level',
      'p.display_name',
      'p.profile_photo'
    )
    .first();
  if (!row) {
    const err = new Error('REQUEST_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  const documents = await db('kyc_documents')
    .where({ submission_id: row.submission_id })
    .orderBy('created_at', 'asc');
  const activity = await getKycHistory(row.user_id);
  return {
    ...mapKycRequestRow(row),
    documents: documents.map(mapDocumentRow),
    activity,
  };
}

export async function reviewKycRequest(reviewerId, requestId, { approved = true, notes } = {}) {
  const id = Number(requestId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('INVALID_REQUEST_ID');
    err.status = 400;
    throw err;
  }
  const request = await db('kyc_requests').where({ id }).first();
  if (!request) {
    const err = new Error('REQUEST_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  await verifyKyc(reviewerId, request.user_id, approved, notes, { requestId: id });
  return getKycRequestDetail(id);
}

async function persistDocument(userId, submissionId, documentType, file, { notes, isSecondary }) {
  if (!file) return null;
  await ensureStorageDir();
  const sanitizedName = file.originalname?.replace(/\s+/g, '_') || `${documentType}-${Date.now()}`;
  const storedFilename = `${submissionId}-${isSecondary ? 'secondary' : 'primary'}-${sanitizedName}`;
  const outputPath = path.join(STORAGE_ROOT, storedFilename);
  await fs.writeFile(outputPath, file.buffer);

  const [id] = await db('kyc_documents').insert({
    submission_id: submissionId,
    user_id: userId,
    document_type: documentType,
    original_filename: file.originalname,
    stored_filename: storedFilename,
    mime_type: file.mimetype,
    size: file.size,
    status: 'IN_REVIEW',
    notes: notes || null,
    is_secondary: !!isSecondary,
  });

  return {
    id,
    submission_id: submissionId,
    document_type: documentType,
    original_filename: file.originalname,
    stored_filename: storedFilename,
    storage_url: `${cfg.api.baseUrl}/api/storage/kyc/${storedFilename}`,
    preview_url: `${cfg.api.baseUrl}/api/kyc/documents/${id}/preview`,
  };
}

export async function getKycQueueSidebarSummary() {
  const rows = await baseKycRequestQuery()
    .where((builder) => {
      builder.whereIn('r.status', REQUEST_STATUS_FILTERS.IN_REVIEW).orWhereNull('r.status');
    })
    .orderBy('r.created_at', 'desc')
    .select(
      'r.id',
      'r.created_at',
      'r.updated_at',
      'r.status',
      'r.user_id',
      'u.email',
      'p.display_name'
    );

  return {
    pendingCount: rows.length,
    latestSubmittedAt: rows[0]?.created_at ?? null,
    items: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: normalizeStatus(row.status, 'IN_REVIEW'),
      email: row.email || null,
      displayName: row.display_name || null,
    })),
  };
}

export async function submitKycDocuments(userId, { documentType, primary, secondary, notes }) {
  if (!documentType) throw new Error('DOCUMENT_TYPE_REQUIRED');
  if (!primary) throw new Error('PRIMARY_DOCUMENT_REQUIRED');

  const status = await getKycStatus(userId);
  const normalizedDocumentType = normalizeDocType(documentType);
  const allowedDocumentTypes = (status.allowedDocumentTypes || []).map((item) => normalizeDocType(item));
  if (!status.canSubmitDocuments) {
    throw new Error(status.uploadBlockedReason || 'KYC_UPLOAD_BLOCKED');
  }
  if (!allowedDocumentTypes.includes(normalizedDocumentType)) {
    throw new Error('DOCUMENT_TYPE_NOT_ALLOWED_FOR_REUPLOAD');
  }

  const submissionId = uuidv4();
  const filesMetadata = [];

  const primaryMeta = await persistDocument(userId, submissionId, documentType, primary, { notes, isSecondary: false });
  if (primaryMeta) filesMetadata.push(primaryMeta);
  if (secondary) {
    const secondaryMeta = await persistDocument(userId, submissionId, documentType, secondary, { notes, isSecondary: true });
    if (secondaryMeta) filesMetadata.push(secondaryMeta);
  }

  await db('kyc_requests').insert({
    user_id: userId,
    status: 'pending',
    documents: JSON.stringify(filesMetadata),
    submission_id: submissionId,
    resubmission_required: false,
    notes: null,
    created_at: new Date(),
    updated_at: new Date(),
  });

  kycAdminEmitter.emit('kyc:queue-updated', {
    type: 'submitted',
    userId,
    submissionId,
    createdAt: new Date().toISOString(),
  });

  await db('kyc_activity').insert({
    user_id: userId,
    event: 'DOCUMENT_SUBMITTED',
    message: `Submitted ${documentType} documents`,
    metadata: JSON.stringify({ submissionId, type: documentType, secondary: !!secondary }),
    created_at: new Date(),
    updated_at: new Date(),
  });

  await db('users')
    .where({ id: userId })
    .update({ kyc_verified: 0, updated_at: new Date() });

  try {
    const contact = await getUserContact(userId);
    if (contact?.email) {
      await sendKycSubmissionEmail({
        to: contact.email,
        name: contact.name,
        submittedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[mail] kyc submission email failed', err.message);
  }

  return {
    submissionId,
    status: 'IN_REVIEW',
    message: 'Queued for review',
  };
}

export async function verifyKyc(adminId, targetUserId, approved = true, notes, { requestId } = {}) {
  const user = await db('users').where({ id: targetUserId }).first();
  if (!user) throw new Error('USER_NOT_FOUND');
  let requestQuery = db('kyc_requests').where({ user_id: targetUserId });
  if (requestId) {
    requestQuery = requestQuery.andWhere({ id: requestId });
  }
  const latestRequest = await requestQuery.orderBy('created_at', 'desc').first();

  if (!latestRequest) {
    const err = new Error('NO_KYC_REQUEST');
    err.status = 404;
    throw err;
  }

  const status = approved ? 'approved' : 'rejected';
  await db('kyc_requests')
    .where({ id: latestRequest.id })
    .update({
      status,
      reviewer_id: adminId,
      reviewed_at: new Date(),
      resubmission_required: approved ? false : true,
      notes: notes || null,
      updated_at: new Date(),
    });

  await db('kyc_documents')
    .where({ submission_id: latestRequest.submission_id })
    .update({
      status: approved ? 'APPROVED' : 'REJECTED',
      reviewer_id: adminId,
      reviewed_at: new Date(),
      updated_at: new Date(),
    });

  await db('users')
    .where({ id: targetUserId })
    .update({
      kyc_verified: approved ? 1 : 0,
      kyc_level: approved ? Math.max(1, user.kyc_level || 0) : user.kyc_level || 0,
      updated_at: new Date(),
    });

  await db('kyc_activity').insert({
    user_id: targetUserId,
    event: approved ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
    message: approved ? 'Documents approved by compliance' : 'Documents rejected by compliance',
    metadata: JSON.stringify({ submissionId: latestRequest.submission_id, reviewerId: adminId, notes }),
    created_at: new Date(),
    updated_at: new Date(),
  });

  kycAdminEmitter.emit('kyc:queue-updated', {
    type: approved ? 'approved' : 'rejected',
    userId: targetUserId,
    requestId: latestRequest.id,
    reviewedAt: new Date().toISOString(),
  });

  if (approved) {
    try {
      const contact = await getUserContact(targetUserId);
      if (contact?.email) {
        await sendKycApprovedEmail({
          to: contact.email,
          name: contact.name,
          submittedAt: latestRequest.created_at || new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[mail] kyc approval email failed', err.message);
    }
  }
}
