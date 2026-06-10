import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const LOG_ROOTS = [
  { key: 'logs', label: 'Logs', dir: path.resolve(APP_ROOT, 'logs') },
  { key: 'storage', label: 'Storage', dir: path.resolve(APP_ROOT, 'storage') },
];
const RPC_LOG_FILES = {
  status: { rootKey: 'storage', relativePath: 'rpc-status.json' },
  transactions: { rootKey: 'storage', relativePath: 'backend-url-transactions.jsonl' },
  issues: { rootKey: 'storage', relativePath: 'backend-url-issues.jsonl' },
  errors: { rootKey: 'logs', relativePath: 'rpc-errors.log' },
};
const KNOWN_LOG_FILES = {
  app: { rootKey: 'logs', relativePath: 'app.log' },
  appToday: { rootKey: 'logs', relativePath: `app-${new Date().toISOString().slice(0, 10)}.log` },
  email: { rootKey: 'storage', relativePath: 'mail-send-log.jsonl' },
  rpcStatus: { rootKey: 'storage', relativePath: 'rpc-status.json' },
  rpcTransactions: { rootKey: 'storage', relativePath: 'backend-url-transactions.jsonl' },
  rpcIssues: { rootKey: 'storage', relativePath: 'backend-url-issues.jsonl' },
  rpcErrors: { rootKey: 'logs', relativePath: 'rpc-errors.log' },
  backendRegistry: { rootKey: 'storage', relativePath: 'backend-url-registry.json' },
};
const ALLOWED_EXTENSIONS = new Set(['.log', '.json', '.jsonl']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TAIL_BYTES = 512 * 1024;

function requireLogViewerAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Log Viewer"');
    return res.status(401).json({ message: 'Log viewer authentication required' });
  }

  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const separator = decoded.indexOf(':');
  const username = separator >= 0 ? decoded.slice(0, separator) : decoded;
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';
  const expectedUser = process.env.LOG_VIEWER_USER || 'admin';
  const expectedPassword = process.env.LOG_VIEWER_PASSWORD || '123456';

  if (username !== expectedUser || password !== expectedPassword) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  return next();
}

function encodeId(rootKey, relativePath) {
  return Buffer.from(`${rootKey}:${relativePath}`, 'utf8')
    .toString('base64url');
}

function decodeId(id) {
  const decoded = Buffer.from(String(id || ''), 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  const rootKey = decoded.slice(0, separator);
  const relativePath = decoded.slice(separator + 1);
  const root = LOG_ROOTS.find((item) => item.key === rootKey);
  if (!root || !relativePath || path.isAbsolute(relativePath)) return null;

  const absolutePath = path.resolve(root.dir, relativePath);
  const rootDir = path.resolve(root.dir);
  if (absolutePath !== rootDir && !absolutePath.startsWith(`${rootDir}${path.sep}`)) return null;

  return { root, relativePath, absolutePath };
}

async function walkLogFiles(root, currentDir = root.dir, baseDir = root.dir) {
  let entries = [];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkLogFiles(root, absolutePath, baseDir));
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) continue;

    const stats = await fs.stat(absolutePath);
    const relativePath = path.relative(baseDir, absolutePath);
    files.push({
      id: encodeId(root.key, relativePath),
      name: entry.name,
      path: relativePath.replaceAll(path.sep, '/'),
      group: root.label,
      extension,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }

  return files;
}

async function getKnownLogFiles() {
  const files = [];
  for (const file of Object.values(KNOWN_LOG_FILES)) {
    const decoded = decodeId(encodeId(file.rootKey, file.relativePath));
    if (!decoded) continue;

    const extension = path.extname(decoded.relativePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) continue;

    try {
      const stats = await fs.stat(decoded.absolutePath);
      files.push({
        id: encodeId(file.rootKey, file.relativePath),
        name: path.basename(decoded.absolutePath),
        path: decoded.relativePath.replaceAll(path.sep, '/'),
        group: decoded.root.label,
        extension,
        size: stats.isFile() ? stats.size : 0,
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      files.push({
        id: encodeId(file.rootKey, file.relativePath),
        name: path.basename(decoded.absolutePath),
        path: decoded.relativePath.replaceAll(path.sep, '/'),
        group: decoded.root.label,
        extension,
        size: 0,
        modifiedAt: new Date(0).toISOString(),
      });
    }
  }
  return files;
}

async function readTailText(absolutePath, tailBytes = DEFAULT_TAIL_BYTES) {
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) return '';
  const bytes = Math.min(Math.max(tailBytes, 4096), MAX_FILE_BYTES, stats.size);
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, Math.max(0, stats.size - bytes));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function countMatches(content, pattern) {
  if (!content) return 0;
  return content.split(/\r?\n/).filter((line) => pattern.test(line)).length;
}

async function buildLogSummary() {
  const knownFiles = await getKnownLogFiles();
  const summaries = [];
  const patterns = {
    errors: /error|failed|failure|exception|timeout|rejected/i,
    warnings: /warn|warning|rate limit|too many/i,
    rpc: /rpc|blockchain|eth_blocknumber|startup_failed|connected/i,
    mail: /mail|email|smtp|messageid/i,
    deposits: /deposit|funding/i,
    withdrawals: /withdraw|sweep|gas|treasury/i,
  };

  for (const file of knownFiles) {
    const decoded = decodeId(file.id);
    if (!decoded) continue;
    let content = '';
    try {
      content = await readTailText(decoded.absolutePath);
    } catch {
      content = '';
    }
    summaries.push({
      ...file,
      counts: Object.fromEntries(
        Object.entries(patterns).map(([key, pattern]) => [key, countMatches(content, pattern)])
      ),
    });
  }

  const totals = summaries.reduce(
    (acc, item) => {
      for (const [key, value] of Object.entries(item.counts)) {
        acc[key] = (acc[key] || 0) + Number(value || 0);
      }
      return acc;
    },
    {}
  );

  return { files: summaries, totals };
}

router.use(requireLogViewerAuth);

router.get('/files', async (_req, res) => {
  const groups = await Promise.all([...LOG_ROOTS.map((root) => walkLogFiles(root)), getKnownLogFiles()]);
  const byId = new Map();
  for (const file of groups.flat()) {
    byId.set(file.id, file);
  }
  const files = Array.from(byId.values())
    .flat()
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  return res.json({ files });
});

router.get('/summary', async (_req, res) => {
  return res.json(await buildLogSummary());
});

router.get('/rpc', async (_req, res) => {
  const files = Object.entries(RPC_LOG_FILES).map(([key, file]) => ({
    key,
    id: encodeId(file.rootKey, file.relativePath),
    path: file.relativePath,
    group: file.rootKey === 'storage' ? 'Storage' : 'Logs',
  }));

  return res.json({ files });
});

router.get('/rpc/:key', async (req, res) => {
  const target = RPC_LOG_FILES[String(req.params.key || '').trim().toLowerCase()];
  if (!target) {
    return res.status(404).json({ message: 'RPC log file not found' });
  }

  const decoded = decodeId(encodeId(target.rootKey, target.relativePath));
  if (!decoded) {
    return res.status(400).json({ message: 'Invalid RPC log file' });
  }

  try {
    const stats = await fs.stat(decoded.absolutePath);
    if (!stats.isFile()) {
      return res.status(404).json({ message: 'RPC log file not found' });
    }

    const tailBytes = Math.min(DEFAULT_TAIL_BYTES, stats.size);
    const handle = await fs.open(decoded.absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(tailBytes);
      await handle.read(buffer, 0, tailBytes, Math.max(0, stats.size - tailBytes));
      return res.json({
        file: {
          key: req.params.key,
          name: path.basename(decoded.absolutePath),
          path: decoded.relativePath.replaceAll(path.sep, '/'),
          group: decoded.root.label,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          truncated: stats.size > tailBytes,
        },
        content: buffer.toString('utf8'),
      });
    } finally {
      await handle.close();
    }
  } catch {
    return res.status(404).json({ message: 'RPC log file not found' });
  }
});

router.get('/files/:id/download', async (req, res) => {
  const decoded = decodeId(req.params.id);
  if (!decoded) {
    return res.status(400).json({ message: 'Invalid log file id' });
  }

  let stats;
  try {
    stats = await fs.stat(decoded.absolutePath);
  } catch {
    return res.status(404).json({ message: 'Log file not found' });
  }
  if (!stats.isFile()) {
    return res.status(404).json({ message: 'Log file not found' });
  }

  const extension = path.extname(decoded.absolutePath).toLowerCase();
  const contentType =
    extension === '.json'
      ? 'application/json; charset=utf-8'
      : extension === '.jsonl'
        ? 'application/x-ndjson; charset=utf-8'
        : 'text/plain; charset=utf-8';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(stats.size));
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(decoded.absolutePath)}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(decoded.absolutePath);
});

router.get('/files/:id', async (req, res) => {
  const decoded = decodeId(req.params.id);
  if (!decoded) {
    return res.status(400).json({ message: 'Invalid log file id' });
  }

  let stats;
  try {
    stats = await fs.stat(decoded.absolutePath);
  } catch {
    return res.json({
      file: {
        id: req.params.id,
        name: path.basename(decoded.absolutePath),
        path: decoded.relativePath.replaceAll(path.sep, '/'),
        group: decoded.root.label,
        size: 0,
        modifiedAt: new Date(0).toISOString(),
        truncated: false,
      },
      content: '',
    });
  }
  if (!stats.isFile()) {
    return res.status(404).json({ message: 'Log file not found' });
  }

  const tailBytes = Math.min(
    Math.max(Number(req.query.tailBytes || DEFAULT_TAIL_BYTES), 4096),
    MAX_FILE_BYTES,
    stats.size
  );
  const handle = await fs.open(decoded.absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(tailBytes);
    await handle.read(buffer, 0, tailBytes, Math.max(0, stats.size - tailBytes));
    return res.json({
      file: {
        id: req.params.id,
        name: path.basename(decoded.absolutePath),
        path: decoded.relativePath.replaceAll(path.sep, '/'),
        group: decoded.root.label,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        truncated: stats.size > tailBytes,
      },
      content: buffer.toString('utf8'),
    });
  } finally {
    await handle.close();
  }
});

export default router;
