/**
 * Scramjet Proxy — Local-style Server (red-portal approach)
 * ==========================================================
 * Pure node:http — no Fastify, no Express.
 * Handles:
 *   • Static files from public/
 *   • /scram/   → scramjet npm package files
 *   • /libcurl/ → libcurl-transport npm package files
 *   • /baremux/ → bare-mux npm package files
 *   • WebSocket upgrade → wisp at /wisp/
 *   • /health   → JSON health check (Render / load-balancer)
 *
 * Reads PORT from env (Render sets this automatically).
 */

import { createServer }  from 'node:http';
import { fileURLToPath } from 'node:url';
import { hostname }      from 'node:os';
import path              from 'node:path';
import fs                from 'node:fs';

import { server as wisp, logging } from '@mercuryworkshop/wisp-js/server';
import { scramjetPath }             from '@mercuryworkshop/scramjet/path';
import { libcurlPath }              from '@mercuryworkshop/libcurl-transport';
import { baremuxPath }              from '@mercuryworkshop/bare-mux/node';

/* ── Paths ─────────────────────────────────────────────────────── */
const publicPath = fileURLToPath(new URL('../public/', import.meta.url));

/* ── Config ─────────────────────────────────────────────────────── */
const PORT = parseInt(process.env.PORT || '8080', 10);

/* ── Wisp setup ─────────────────────────────────────────────────── */
logging.set_level(logging.NONE);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  dns_servers: ['1.1.1.3', '1.0.0.3'],
});

/* ── MIME map ───────────────────────────────────────────────────── */
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.htm':   'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.cjs':   'application/javascript; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.wasm':  'application/wasm',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.txt':   'text/plain; charset=utf-8',
  '.xml':   'application/xml',
  '.mp4':   'video/mp4',
  '.webm':  'video/webm',
  '.mp3':   'audio/mpeg',
  '.ogg':   'audio/ogg',
  '.wav':   'audio/wav',
};

/* ── Headers ────────────────────────────────────────────────────── */
function baseHeaders(extra = {}) {
  return {
    'Cross-Origin-Opener-Policy':   'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin':   '*',
    'Access-Control-Allow-Methods':  'GET, POST, OPTIONS, HEAD, PUT, PATCH, DELETE',
    'Access-Control-Allow-Headers':  '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age':        '86400',
    'X-Frame-Options': 'ALLOWALL',
    'Vary': 'Origin',
    ...extra,
  };
}

/* ── Static file helper ─────────────────────────────────────────── */
function serveFile(res, filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain' }));
      res.end('Not found');
      return;
    }
    res.writeHead(200, baseHeaders({ 'Content-Type': mime }));
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveUnder(res, rootDir, subPath) {
  const safe = path.normalize(subPath).replace(/^(\.\.[\\/])+/, '');
  const full = path.join(rootDir, safe);
  if (!full.startsWith(rootDir)) {
    res.writeHead(403, baseHeaders({ 'Content-Type': 'text/plain' }));
    res.end('Forbidden');
    return;
  }
  serveFile(res, full);
}

/* ── Prefix routes (npm package assets) ────────────────────────── */
const PREFIX_ROUTES = [
  { prefix: '/scram/',   root: scramjetPath },
  { prefix: '/libcurl/', root: libcurlPath  },
  { prefix: '/baremux/', root: baremuxPath  },
];

/* ── HTTP server ────────────────────────────────────────────────── */
const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    pathname = '/';
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, baseHeaders());
    res.end();
    return;
  }

  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, baseHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  for (const { prefix, root } of PREFIX_ROUTES) {
    if (pathname.startsWith(prefix)) {
      serveUnder(res, root, pathname.slice(prefix.length) || '/');
      return;
    }
  }

  const safe = path.normalize(pathname).replace(/^(\.\.[\\/])+/, '');
  const full = path.join(publicPath, safe === '/' ? 'index.html' : safe);

  if (!full.startsWith(publicPath)) {
    res.writeHead(403, baseHeaders({ 'Content-Type': 'text/plain' }));
    res.end('Forbidden');
    return;
  }

  fs.stat(full, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      serveFile(res, path.join(publicPath, 'index.html'));
    } else {
      serveFile(res, full);
    }
  });
});

/* ── WebSocket upgrade → wisp ───────────────────────────────────── */
server.on('upgrade', (req, socket, head) => {
  if (req.url.endsWith('/wisp/')) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

/* ── Start ──────────────────────────────────────────────────────── */
server.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║      Scramjet Proxy — Local Server       ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  🌐  http://localhost:${addr.port}`);
  console.log(`  🌐  http://${hostname()}:${addr.port}`);
  console.log(`  🔌  wisp: ws://localhost:${addr.port}/wisp/`);
  console.log(`  💚  health: http://localhost:${addr.port}/health`);
  console.log('');
});

function shutdown() {
  console.log('\n  Shutting down…');
  server.close(() => process.exit(0));
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
