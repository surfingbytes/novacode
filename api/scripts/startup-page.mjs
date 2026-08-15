#!/usr/bin/env node
/**
 * Tiny HTTP server bound at container start so nginx can proxy a progress page
 * instead of 502 while the entrypoint (chown / prisma / Node import) finishes.
 * Exits when STARTUP_READY_FILE appears (written by the API after listen).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

const PORT = parseInt(process.env.PORT || '3030', 10);
const HOST = '0.0.0.0';
const STATUS_FILE = process.env.STARTUP_STATUS_FILE || '/tmp/novacode-startup.json';
const READY_FILE = process.env.STARTUP_READY_FILE || '/tmp/novacode-ready';

const STEPS = [
  { id: 'boot', label: 'Starting' },
  { id: 'config', label: 'Prepare config volume' },
  { id: 'agents', label: 'Check agent tools' },
  { id: 'database', label: 'Apply database migrations' },
  { id: 'api', label: 'Start API' }
];

function readStatus() {
  try {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
    const progress = Number(parsed.progress);
    return {
      status: 'starting',
      step: typeof parsed.step === 'string' && parsed.step ? parsed.step : 'boot',
      detail:
        typeof parsed.detail === 'string' && parsed.detail
          ? parsed.detail
          : 'Starting Nova Code…',
      progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0
    };
  } catch {
    return {
      status: 'starting',
      step: 'boot',
      detail: 'Starting Nova Code…',
      progress: 5
    };
  }
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="15" />
  <title>Starting Nova Code</title>
  <style>
    :root {
      --bg: #0f0e0d;
      --surface: #171614;
      --card: #1d1b18;
      --primary: #8b85ff;
      --text: #f5f1ea;
      --muted: #a6a098;
      --line: rgba(255,248,235,0.08);
      --done: #7ec994;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      padding: 1.5rem;
      overflow: hidden;
    }
    .glow {
      pointer-events: none;
      position: fixed;
      inset: 0;
    }
    .glow::before, .glow::after {
      content: "";
      position: absolute;
      width: 500px;
      height: 500px;
      border-radius: 50%;
      background: rgba(139, 133, 255, 0.10);
      filter: blur(80px);
    }
    .glow::before { top: -12rem; right: -12rem; }
    .glow::after { bottom: -12rem; left: -12rem; }
    .card {
      position: relative;
      width: min(26rem, 100%);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 0.5rem;
      padding: 2rem;
    }
    .logo {
      display: block;
      width: 5.5rem;
      height: 5.5rem;
      margin: 0 auto 1rem;
      color: var(--primary);
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.25rem;
      font-weight: 600;
      text-align: center;
    }
    .sub {
      margin: 0 0 1.5rem;
      font-size: 0.875rem;
      color: var(--muted);
      text-align: center;
    }
    .bar {
      height: 0.4rem;
      background: var(--card);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 1.25rem;
    }
    .bar > span {
      display: block;
      height: 100%;
      width: 0%;
      background: var(--primary);
      border-radius: inherit;
      transition: width 0.35s ease;
    }
    .steps { list-style: none; margin: 0; padding: 0; }
    .steps li {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.4rem 0;
      font-size: 0.875rem;
      color: var(--muted);
    }
    .steps li.active { color: var(--text); font-weight: 500; }
    .steps li.done { color: var(--done); }
    .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      border: 1.5px solid currentColor;
      flex: none;
    }
    .steps li.active .dot {
      border-color: var(--primary);
      background: var(--primary);
      box-shadow: 0 0 0 3px rgba(139, 133, 255, 0.22);
    }
    .steps li.done .dot { background: var(--done); border-color: var(--done); }
    .detail {
      margin: 1.25rem 0 0;
      font-size: 0.8rem;
      color: var(--muted);
      text-align: center;
      min-height: 1.2em;
    }
    .spin {
      width: 1.1rem;
      height: 1.1rem;
      border: 2px solid var(--card);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin: 1.25rem auto 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="card">
    <svg class="logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Nova Code">
      <path d="M17 7.82959L18.6965 9.35641C20.239 10.7447 21.0103 11.4389 21.0103 12.3296C21.0103 13.2203 20.239 13.9145 18.6965 15.3028L17 16.8296" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M13.9868 5L12.9934 8.70743M11.8432 13L10.0132 19.8297" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M7.00005 7.82959L5.30358 9.35641C3.76102 10.7447 2.98975 11.4389 2.98975 12.3296C2.98975 13.2203 3.76102 13.9145 5.30358 15.3028L7.00005 16.8296" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <h1>Starting Nova Code</h1>
    <p class="sub">This page opens the app when the server is ready.</p>
    <div class="bar" aria-hidden="true"><span id="bar"></span></div>
    <ol class="steps" id="steps"></ol>
    <p class="detail" id="detail">Starting…</p>
    <div class="spin" aria-hidden="true"></div>
  </div>
  <script>
    const STEPS = ${JSON.stringify(STEPS)};
    const stepsEl = document.getElementById('steps');
    const barEl = document.getElementById('bar');
    const detailEl = document.getElementById('detail');
    STEPS.forEach((step) => {
      const li = document.createElement('li');
      li.dataset.id = step.id;
      li.innerHTML = '<span class="dot"></span><span>' + step.label + '</span>';
      stepsEl.appendChild(li);
    });
    function apply(data) {
      const ids = STEPS.map((s) => s.id);
      const current = Math.max(0, ids.indexOf(data.step));
      stepsEl.querySelectorAll('li').forEach((li, i) => {
        li.classList.toggle('done', i < current);
        li.classList.toggle('active', i === current);
      });
      barEl.style.width = Math.max(4, Number(data.progress) || 0) + '%';
      detailEl.textContent = data.detail || 'Starting…';
    }
    async function tick() {
      try {
        const health = await fetch('/api/health', { cache: 'no-store' });
        if (health.ok) {
          const body = await health.json();
          if (body.status === 'ok' || body.status === 'degraded') {
            location.reload();
            return;
          }
        }
      } catch (_) { /* handoff gap — keep polling */ }
      try {
        const res = await fetch('/api/startup', { cache: 'no-store' });
        if (res.ok) apply(await res.json());
      } catch (_) { /* still booting */ }
      setTimeout(tick, 400);
    }
    tick();
  </script>
</body>
</html>
`;

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-novacode-startup': '1'
  });
  res.end(json);
}

function sendHtml(res) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-novacode-startup': '1'
  });
  res.end(HTML);
}

try {
  unlinkSync(READY_FILE);
} catch {
  // first start
}

const server = createServer((req, res) => {
  const url = req.url?.split('?')[0] || '/';
  if (url === '/api/startup') {
    sendJson(res, 200, readStatus());
    return;
  }
  if (url === '/api/health') {
    // 503 so Docker HEALTHCHECK still waits for the real API
    sendJson(res, 503, readStatus());
    return;
  }
  sendHtml(res);
});

server.listen({ port: PORT, host: HOST, reusePort: true }, () => {
  process.stdout.write(`[startup-page] listening on ${HOST}:${PORT}\n`);
});

server.on('error', (err) => {
  process.stderr.write(`[startup-page] ${err.message}\n`);
  process.exit(1);
});

const watch = setInterval(() => {
  if (existsSync(READY_FILE)) {
    clearInterval(watch);
    server.close(() => process.exit(0));
  }
}, 100);
