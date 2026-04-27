/**
 * ClipAI — Servidor proxy local
 * Resolve o problema de CORS entre o frontend e as APIs da Shotstack e Anthropic.
 *
 * Como rodar:
 *   1. npm install
 *   2. node server.js
 *   3. Abra http://localhost:3000 no navegador
 */

const http         = require('http');
const https        = require('https');
const fs           = require('fs');
const path         = require('path');
const { URL }      = require('url');

// ── Chaves de API ─────────────────────────────────────────────────────
const SHOTSTACK_KEY_SANDBOX    = 'lYp5mzFKLVSXXUNCHzDQUxODsZ8z35DAQ7LKRC7U';
const SHOTSTACK_KEY_PRODUCTION = 'qEnjPGEFME1I178omfJXiGcj7Wj05eHY1bzczpah';
const SHOTSTACK_ENV            = 'stage'; // 'stage' = sandbox | 'v1' = produção
const SHOTSTACK_KEY            = SHOTSTACK_ENV === 'stage' ? SHOTSTACK_KEY_SANDBOX : SHOTSTACK_KEY_PRODUCTION;
const SHOTSTACK_BASE           = `https://api.shotstack.io/${SHOTSTACK_ENV}`;
const SHOTSTACK_INGEST         = `https://api.shotstack.io/ingest/${SHOTSTACK_ENV}`;

const PORT = 3000;

// ── CORS headers ──────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key');
}

// ── Lê o body da requisição como Buffer ───────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Faz uma requisição HTTPS e retorna { status, headers, body } ──────
function httpsRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: { ...headers }
    };
    if (body && body.length) opts.headers['Content-Length'] = body.length;

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Serve o arquivo HTML do frontend ─────────────────────────────────
function serveHTML(res) {
  const htmlPath = path.join(__dirname, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    res.writeHead(404); res.end('index.html não encontrado'); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(htmlPath));
}

// ── Roteador principal ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight CORS
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url;

  // ── Serve frontend ──────────────────────────────────────────────────
  if (url === '/' || url === '/index.html') { serveHTML(res); return; }

  // ── Proxy: Claude / Anthropic ───────────────────────────────────────
  if (url === '/api/claude') {
    try {
      const body = await readBody(req);
      const upstream = await httpsRequest('POST', 'https://api.anthropic.com/v1/messages', {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        // O frontend (Claude artifact) passa a chave via header Authorization
        // O server apenas a repassa — nunca armazena
        'x-api-key': req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ','') || '',
      }, body);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.body);
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: Shotstack — Render ───────────────────────────────────────
  if (url === '/api/shotstack/render' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const upstream = await httpsRequest('POST', `${SHOTSTACK_BASE}/render`, {
        'Content-Type': 'application/json',
        'x-api-key': SHOTSTACK_KEY,
      }, body);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.body);
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: Shotstack — Poll status do render ────────────────────────
  if (url.startsWith('/api/shotstack/render/') && req.method === 'GET') {
    const renderId = url.split('/api/shotstack/render/')[1];
    try {
      const upstream = await httpsRequest('GET', `${SHOTSTACK_BASE}/render/${renderId}`, {
        'x-api-key': SHOTSTACK_KEY,
      });
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.body);
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: Shotstack — Criar source (ingest) ────────────────────────
  if (url === '/api/shotstack/source' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const upstream = await httpsRequest('POST', `${SHOTSTACK_INGEST}/sources`, {
        'Content-Type': 'application/json',
        'x-api-key': SHOTSTACK_KEY,
      }, body);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.body);
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: Shotstack — Upload binário (PUT para URL assinada) ────────
  // O frontend manda o binário aqui, e o server faz o PUT para a S3 URL
  if (url.startsWith('/api/shotstack/upload') && req.method === 'POST') {
    try {
      const targetUrl = decodeURIComponent(url.split('/api/shotstack/upload?url=')[1] || '');
      if (!targetUrl) { res.writeHead(400); res.end('url param obrigatória'); return; }
      const body    = await readBody(req);
      const ctype   = req.headers['x-file-type'] || 'video/mp4';
      const upstream = await httpsRequest('PUT', targetUrl, {
        'Content-Type': ctype,
        'Content-Length': body.length,
      }, body);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: upstream.status < 300 }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: Shotstack — Poll source (espera ficar ready) ─────────────
  if (url.startsWith('/api/shotstack/source/') && req.method === 'GET') {
    const sourceId = url.split('/api/shotstack/source/')[1];
    try {
      const upstream = await httpsRequest('GET', `${SHOTSTACK_INGEST}/sources/${sourceId}`, {
        'x-api-key': SHOTSTACK_KEY,
      });
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.body);
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Rota não encontrada');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║        ClipAI — Servidor ativo        ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log(`  🟢 Abra no navegador: http://localhost:${PORT}`);
  console.log(`  🔑 Shotstack ENV: ${SHOTSTACK_ENV}`);
  console.log('  ⏹  Para parar: Ctrl+C');
  console.log('');
});
