import express from 'express';
import {
  checkBackendUrlStatus,
  listBackendUrls,
  setBackendUrlEnabled,
} from '../services/backendUrlManager.service.js';
import { ok } from '../utils/responses.js';

const router = express.Router();

router.get('/urls', (_req, res) => {
  ok(res, listBackendUrls());
});

router.get('/urls/:key/enable', (req, res) => {
  try {
    ok(res, setBackendUrlEnabled(req.params.key, true, 'public_url_action'));
  } catch (err) {
    res.status(err.status || 400).json({
      status: false,
      code: err.status || 400,
      message: err.message || 'Unable to enable backend URL',
    });
  }
});

router.get('/urls/:key/disable', (req, res) => {
  try {
    setBackendUrlEnabled(req.params.key, false, 'public_url_action');
    res.status(404).json({
      status: false,
      code: 404,
      message: 'Not Found',
    });
  } catch (err) {
    res.status(err.status || 400).json({
      status: false,
      code: err.status || 400,
      message: err.message || 'Unable to disable backend URL',
    });
  }
});

router.get('/urls/:key/status', async (req, res) => {
  try {
    ok(res, await checkBackendUrlStatus(req.params.key, { force: true, actorId: 'public_url_action' }));
  } catch (err) {
    res.status(err.status || 400).json({
      status: false,
      code: err.status || 400,
      message: err.message || 'Unable to check backend URL status',
    });
  }
});

export default router;
