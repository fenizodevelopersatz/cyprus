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

router.use(requireLogViewerAuth);

router.get('/files', async (_req, res) => {
  const groups = await Promise.all(LOG_ROOTS.map((root) => walkLogFiles(root)));
  const files = groups
    .flat()
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  return res.json({ files });
});

router.get('/files/:id/download', async (req, res) => {
  const decoded = decodeId(req.params.id);
  if (!decoded) {
    return res.status(400).json({ message: 'Invalid log file id' });
  }

  const stats = await fs.stat(decoded.absolutePath);
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

  const stats = await fs.stat(decoded.absolutePath);
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
