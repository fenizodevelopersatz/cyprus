import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..');
const APP_PATH = path.join(SRC_ROOT, 'app.js');
const ROUTES_ROOT = path.join(SRC_ROOT, 'routes');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'all'];

function normalizeRoutePath(...parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => String(part).trim())
    .join('/');

  const normalized = joined
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');

  return normalized.startsWith('/') ? normalized || '/' : `/${normalized}`;
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function resolveImportPath(importPath) {
  const withExtension = importPath.endsWith('.js') ? importPath : `${importPath}.js`;
  return path.resolve(SRC_ROOT, withExtension.replace(/^\.\//, ''));
}

function discoverRouteImports(appSource) {
  const imports = new Map();
  const importPattern = /import\s+([A-Za-z0-9_$]+)\s+from\s+['"](\.\/routes\/[^'"]+)['"]/g;
  let match;

  while ((match = importPattern.exec(appSource)) !== null) {
    imports.set(match[1], resolveImportPath(match[2]));
  }

  return imports;
}

function discoverMounts(appSource, imports) {
  const mounts = [];
  const mountPattern = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_$]+)/g;
  let match;

  while ((match = mountPattern.exec(appSource)) !== null) {
    const [, basePath, routerName] = match;
    const filePath = imports.get(routerName);
    if (filePath) mounts.push({ basePath, routerName, filePath });
  }

  return mounts;
}

function discoverRouterEndpoints(filePath, basePath) {
  const source = readText(filePath);
  const endpoints = [];
  const routePattern = new RegExp(`router\\.(${HTTP_METHODS.join('|')})\\(\\s*['"\`]([^'"\`]*)['"\`]`, 'gi');
  let match;

  while ((match = routePattern.exec(source)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: normalizeRoutePath(basePath, match[2]),
      routeFile: path.relative(ROUTES_ROOT, filePath).replace(/\\/g, '/'),
    });
  }

  return endpoints;
}

function discoverAppEndpoints(appSource) {
  const endpoints = [];
  const appRoutePattern = new RegExp(`app\\.(${HTTP_METHODS.join('|')})\\(\\s*['"\`]([^'"\`]*)['"\`]`, 'gi');
  let match;

  while ((match = appRoutePattern.exec(appSource)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: normalizeRoutePath(match[2]),
      routeFile: 'app.js',
    });
  }

  return endpoints;
}

function uniqueEndpoints(endpoints) {
  const seen = new Set();
  return endpoints
    .filter((endpoint) => {
      const key = `${endpoint.method} ${endpoint.path} ${endpoint.routeFile}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      if (a.method !== b.method) return a.method.localeCompare(b.method);
      return a.routeFile.localeCompare(b.routeFile);
    });
}

export function discoverApiEndpoints() {
  const appSource = readText(APP_PATH);
  const imports = discoverRouteImports(appSource);
  const mounts = discoverMounts(appSource, imports);
  const http = [
    ...discoverAppEndpoints(appSource),
    ...mounts.flatMap((mount) => discoverRouterEndpoints(mount.filePath, mount.basePath)),
  ];

  return {
    http: uniqueEndpoints(http),
    websockets: [
      { path: '/ws/exchange', protocol: 'websocket' },
      { path: '/ws/portfolio', protocol: 'websocket' },
      { path: '/ws/wallet', protocol: 'websocket' },
      { path: '/ws/admin/dashboard', protocol: 'websocket' },
    ],
    socketIo: [
      { path: '/socket.io', namespace: '/' },
      { path: '/socket.io', namespace: '/exchange' },
    ],
  };
}
