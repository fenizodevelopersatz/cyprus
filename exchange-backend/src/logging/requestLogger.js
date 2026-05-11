import pinoHttp from 'pino-http';
import { createRequestId } from './logger.js';
import { httpLogger } from './loggers.js';
import { runWithRequestContext, setRequestContextValue } from './context.js';

function getRequestId(req, res) {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : createRequestId();
  res.setHeader('x-request-id', requestId);
  return requestId;
}

function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

export const requestLogger = pinoHttp({
  logger: httpLogger,
  genReqId(req, res) {
    return getRequestId(req, res);
  },
  quietReqLogger: true,
  quietResLogger: true,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps(req) {
    return {
      requestId: req.id,
      userId: getUserId(req),
      ip: req.ip,
      module: 'http',
    };
  },
  customSuccessMessage() {
    return 'request_completed';
  },
  customErrorMessage() {
    return 'request_failed';
  },
  serializers: {
    req(req) {
      return {
        requestId: req.id,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userId: getUserId(req),
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
    err(err) {
      return {
        type: err.name,
        message: err.message,
        stack: err.stack,
      };
    },
  },
  customReceivedObject(req) {
    return {
      event: 'request_started',
      requestId: req.id,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userId: getUserId(req),
      module: 'http',
    };
  },
  customSuccessObject(req, res, value) {
    return {
      ...value,
      event: 'request_completed',
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: res.responseTime,
      ip: req.ip,
      userId: getUserId(req),
      module: 'http',
    };
  },
  customErrorObject(req, res, err, value) {
    return {
      ...value,
      event: 'request_failed',
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: res.responseTime,
      ip: req.ip,
      userId: getUserId(req),
      module: 'http',
      err: {
        type: err.name,
        message: err.message,
        stack: err.stack,
      },
    };
  },
});

export function requestContextMiddleware(req, _res, next) {
  runWithRequestContext(
    {
      requestId: req.id,
      userId: getUserId(req),
    },
    () => {
      const baseReqLog = req.log || httpLogger;
      req.log = baseReqLog.child({
        module: 'http',
        requestId: req.id,
        userId: getUserId(req),
      });
      next();
    }
  );
}

export function bindRequestUserContext(req, _res, next) {
  const userId = getUserId(req);
  setRequestContextValue('userId', userId);
  if (req.log) {
    req.log = req.log.child({ userId });
  }
  next();
}
