function createValidationError(errors) {
  const error = new Error('Validation failed');
  error.status = 400;
  error.code = 'VALIDATION_FAILED';
  error.errors = errors;
  return error;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function parseNonNegativeNumber(value, field, errors) {
  if (value === null || value === undefined || value === '') {
    errors[field] = 'This field is required';
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors[field] = 'This field must be a valid number';
    return null;
  }

  if (parsed < 0) {
    errors[field] = 'This field must be greater than or equal to 0';
    return null;
  }

  return parsed;
}

function parseBooleanLike(value, field, errors) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  errors[field] = 'This field must be boolean';
  return null;
}

export function validateLevelManagementPayload(payload) {
  const errors = {};

  if (!payload || typeof payload !== 'object') {
    throw createValidationError({ payload: 'Request body is required' });
  }

  if (!Array.isArray(payload.levels) || payload.levels.length === 0) {
    errors.levels = 'levels must be a non-empty array';
  } else {
    payload.levels.forEach((level, index) => {
      const prefix = `levels_${index}`;
      if (!level || typeof level !== 'object') {
        errors[prefix] = 'Level row is invalid';
        return;
      }

      if (!level.levelCode || String(level.levelCode).trim() === '') {
        errors[`${prefix}_levelCode`] = 'levelCode is required';
      }
      if (isBlank(level.qualificationText)) {
        errors[`${prefix}_qualificationText`] = 'qualificationText is required';
      }

      const bonusPercent = parseNonNegativeNumber(level.bonusPercent, `${prefix}_bonusPercent`, errors);
      const promotionRewardUsdt = parseNonNegativeNumber(
        level.promotionRewardUsdt,
        `${prefix}_promotionRewardUsdt`,
        errors
      );
      const sortOrder = parseNonNegativeNumber(level.sortOrder, `${prefix}_sortOrder`, errors);
      const isEnabled = parseBooleanLike(level.isEnabled, `${prefix}_isEnabled`, errors);

      if (bonusPercent !== null) level.bonusPercent = bonusPercent;
      if (promotionRewardUsdt !== null) level.promotionRewardUsdt = promotionRewardUsdt;
      if (sortOrder !== null) level.sortOrder = Math.trunc(sortOrder);
      if (isEnabled !== null) level.isEnabled = isEnabled;
    });
  }

  const config = payload.config;
  if (!config || typeof config !== 'object') {
    errors.config = 'config is required';
  } else {
    const requiredTextFields = [
      'directReferralNote',
      'newUserRewardNote',
      'levelAchievementNote',
      'salaryRewardNote',
      'oneTimeRewardNote',
      'minimumDepositEligibilityNote',
    ];

    requiredTextFields.forEach((field) => {
      if (isBlank(config[field])) {
        errors[field] = `${field} is required`;
      }
    });

    const minimumEligibleDeposit = parseNonNegativeNumber(
      config.minimumEligibleDeposit,
      'minimumEligibleDeposit',
      errors
    );
    const directSponsorCommissionPercent = parseNonNegativeNumber(
      config.directSponsorCommissionPercent,
      'directSponsorCommissionPercent',
      errors
    );
    const joinedCommissionPercent = parseNonNegativeNumber(
      config.joinedCommissionPercent,
      'joinedCommissionPercent',
      errors
    );
    const isCommissionActive = parseBooleanLike(config.isCommissionActive, 'isCommissionActive', errors);

    if (minimumEligibleDeposit !== null) config.minimumEligibleDeposit = minimumEligibleDeposit;
    if (directSponsorCommissionPercent !== null) {
      config.directSponsorCommissionPercent = directSponsorCommissionPercent;
    }
    if (joinedCommissionPercent !== null) config.joinedCommissionPercent = joinedCommissionPercent;
    if (isCommissionActive !== null) config.isCommissionActive = isCommissionActive;
  }

  if (Object.keys(errors).length > 0) {
    throw createValidationError(errors);
  }

  return payload;
}
