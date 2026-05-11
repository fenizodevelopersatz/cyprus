export function sendSuccess(res, message, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function sendError(res, message, statusCode = 400, errors = undefined) {
  const payload = {
    success: false,
    message,
  };

  if (errors && Object.keys(errors).length > 0) {
    payload.errors = errors;
  }

  return res.status(statusCode).json(payload);
}
