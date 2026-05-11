import { errorLogger } from './loggers.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = Number(err?.status || err?.statusCode || (err?.joi ? 400 : 500));
  const log = req.log || errorLogger;

  log.error(
    {
      err,
      requestId: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode,
      ip: req.ip,
      userId: req.user?.id || null,
      module: 'error',
    },
    'unhandled_error'
  );

  if (err?.joi) {
    return res.status(400).json({ status: false, code: 400, message: err.joi.message });
  }

  return res.status(statusCode).json({
    status: false,
    code: statusCode,
    message: err?.message || 'Server error',
  });
}
