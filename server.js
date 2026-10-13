#!/usr/bin/env node
// BadCast - diffusion synchronisée d'un diaporama sur plusieurs écrans du réseau local.
// Aucune dépendance : nécessite seulement Node.js (>= 18).
//
//   node server.js                 -> démarre sur le port 8080
//   PORT=9000 INTERVAL=8 node server.js
//
// Pages servies :
//   /control  -> régie (PC maître)
//   /screen   -> affichage plein écran (PC des écrans)
//   /pres/... -> vos présentations HTML (remark/xaringan) synchronisées sur les écrans
//   /buvette  -> écran partagé : diaporama à gauche, classement en direct (CLASSEMENT_URL) à droite

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const IMAGES_DIR = path.resolve(process.env.IMAGES_DIR || path.join(ROOT, 'images'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRES_DIR = path.resolve(process.env.PRES_DIR || path.join(ROOT, 'presentation'));
const CLASSEMENT_URL = (process.env.CLASSEMENT_URL || '').trim();
const REMARK_CDN = /https?:\/\/remarkjs\.com\/downloads\/remark-latest\.min\.js/g;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// État du diaporama (le serveur est l'unique horloge : tous les écrans suivent)
// ---------------------------------------------------------------------------
const state = {
  images: [],
  index: 0,
  playing: true,
  interval: Math.max(1, Number(process.env.INTERVAL) || 10), // secondes
  transition: 'fade', // 'fade' | 'none'
  message: '', // bandeau texte optionnel affiché sur tous les écrans
  mode: 'images', // 'images' (diaporama du dossier images/) | 'deck' (présentation HTML)
  deck: null, // { url, slide } : présentation pilotée depuis le PC maître
};

let timer = null;
const clients = new Map(); // id -> { res, role, ip, since }
let nextClientId = 1;

function scanImages() {
  let files = [];
  try {
    files = fs.readdirSync(IMAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));
  } catch (err) {
    console.error(`Impossible de lire ${IMAGES_DIR} : ${err.message}`);
  }
  const changed = files.join('\n') !== state.images.join('\n');
  if (changed) {
    const current = state.images[state.index];
    state.images = files;
    const kept = files.indexOf(current);
    state.index = kept >= 0 ? kept : Math.min(state.index, Math.max(0, files.length - 1));
  }
  return changed;
}

function listDecks() {
  try {
    return fs.readdirSync(PRES_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.html?$/i.test(d.name))
      .map((d) => '/pres/' + encodeURIComponent(d.name))
      .sort();
  } catch {
    return [];
  }
}

function publicState() {
  const n = state.images.length;
  return {
    images: state.images.map((f) => '/images/' + encodeURIComponent(f)),
    names: state.images,
    index: state.index,
    next: n ? (state.index + 1) % n : 0,
    playing: state.playing,
    interval: state.interval,
    transition: state.transition,
    message: state.message,
    mode: state.mode,
    deck: state.deck,
    decks: listDecks(),
    serverTime: Date.now(),
    screens: [...clients.values()].filter((c) => c.role === 'screen').length,
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const c of clients.values()) c.res.write(payload);
}

function restartTimer() {
  clearInterval(timer);
  timer = null;
  if (state.mode === 'images' && state.playing && state.images.length > 1) {
    timer = setInterval(() => go(state.index + 1, false), state.interval * 1000);
  }
}

function go(index, resetTimer = true) {
  scanImages();
  const n = state.images.length;
  state.index = n ? ((index % n) + n) % n : 0;
  if (resetTimer) restartTimer();
  broadcast();
}

// ---------------------------------------------------------------------------
// Commandes (POST /api/control  body JSON : { action, ... })
// ---------------------------------------------------------------------------
function handleControl(cmd) {
  switch (cmd.action) {
    case 'next': go(state.index + 1); break;
    case 'prev': go(state.index - 1); break;
    case 'goto': go(Number(cmd.index) || 0); break;
    case 'play': state.playing = true; go(state.index); break;
    case 'pause': state.playing = false; go(state.index); break;
    case 'toggle': state.playing = !state.playing; go(state.index); break;
    case 'interval':
      state.interval = Math.min(3600, Math.max(1, Number(cmd.interval) || state.interval));
      go(state.index);
      break;
    case 'transition':
      state.transition = cmd.transition === 'none' ? 'none' : 'fade';
      broadcast();
      break;
    case 'message':
      state.message = String(cmd.message || '').slice(0, 300);
      broadcast();
      break;
    case 'deck': { // envoyé par une présentation ouverte en mode maître (?role=master)
      const url = String(cmd.url || '');
      if (!url.startsWith('/pres/')) throw new Error('URL de présentation invalide');
      state.mode = 'deck';
      state.deck = { url, slide: Math.max(0, parseInt(cmd.slide, 10) || 0) };
      restartTimer();
      broadcast();
      break;
    }
    case 'images': state.mode = 'images'; go(state.index); break;
    case 'rescan': scanImages(); go(state.index); break;
    case 'reload': // force le rechargement des pages écran
      for (const c of clients.values()) c.res.write('event: reload\ndata: {}\n\n');
      break;
    default:
      throw new Error('Action inconnue : ' + cmd.action);
  }
}

// ---------------------------------------------------------------------------
// Serveur HTTP
// ---------------------------------------------------------------------------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache ? 'public, max-age=3600' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// Sert une présentation HTML en y ajoutant le script de synchronisation
function serveDeck(res, file) {
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    // remark.js en local si le fichier est présent (gymnase sans Internet)
    if (fs.existsSync(path.join(PRES_DIR, 'remark-latest.min.js'))) {
      html = html.replace(REMARK_CDN, '/pres/remark-latest.min.js');
    }
    const tag = '<script src="/badcast-sync.js"></script>\n';
    const at = html.toLowerCase().lastIndexOf('</body>');
    html = at >= 0 ? html.slice(0, at) + tag + html.slice(at) : html + tag;
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(html);
  });
}

// Page buvette : on y inscrit l'URL du classement (variable CLASSEMENT_URL)
function serveBuvette(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'buvette.html'), 'utf8', (err, html) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    const value = JSON.stringify(CLASSEMENT_URL).replace(/</g, '\\u003c');
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(html.replace('__CLASSEMENT_URL__', value));
  });
}

// Empêche de sortir du dossier autorisé (../)
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

const server = http.createServer((req, res) => {
  // Autorise une autre page HTML (ex : celle déjà utilisée sur le PC maître) à piloter l'API
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url, 'http://x');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  // Flux temps réel (Server-Sent Events)
  if (pathname === '/events') {
    const id = nextClientId++;
    const role = url.searchParams.get('role') === 'control' ? 'control' : 'screen';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.set(id, { res, role, ip: req.socket.remoteAddress, since: Date.now() });
    console.log(`+ ${role} connecté (${req.socket.remoteAddress}) — ${clients.size} client(s)`);
    broadcast();
    req.on('close', () => {
      clients.delete(id);
      console.log(`- ${role} déconnecté (${req.socket.remoteAddress}) — ${clients.size} client(s)`);
      broadcast();
    });
    return;
  }

  if (pathname === '/api/state') return sendJSON(res, 200, publicState());

  if (pathname === '/api/control' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        handleControl(JSON.parse(body || '{}'));
        sendJSON(res, 200, publicState());
      } catch (err) {
        sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  if (pathname.startsWith('/pres/')) {
    const file = safeJoin(PRES_DIR, pathname.slice('/pres/'.length));
    if (!file) return res.writeHead(403), res.end();
    if (/\.html?$/i.test(file)) return serveDeck(res, file);
    return serveFile(res, file, false);
  }

  if (pathname.startsWith('/images/')) {
    const file = safeJoin(IMAGES_DIR, pathname.slice('/images/'.length));
    return file ? serveFile(res, file, true) : (res.writeHead(403), res.end());
  }

  if (pathname === '/buvette' || pathname === '/buvette.html') return serveBuvette(res);

  const routes = { '/': 'index.html', '/control': 'control.html', '/screen': 'screen.html' };
  const file = safeJoin(PUBLIC_DIR, routes[pathname] || pathname.slice(1));
  return file ? serveFile(res, file, false) : (res.writeHead(403), res.end());
});

// Ping régulier pour garder les connexions SSE ouvertes (proxys, Wi-Fi…)
setInterval(() => {
  for (const c of clients.values()) c.res.write(': ping\n\n');
}, 15000);

// Détection des images ajoutées/supprimées dans le dossier
setInterval(() => {
  if (scanImages()) {
    console.log(`Dossier images mis à jour : ${state.images.length} image(s)`);
    restartTimer();
    broadcast();
  }
}, 5000);

for (const dir of [IMAGES_DIR, PRES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
scanImages();
restartTimer();

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('');
  console.log('  BadCast démarré');
  console.log(`  Dossier images : ${IMAGES_DIR} (${state.images.length} image(s))`);
  console.log(`  Présentations  : ${PRES_DIR} (${listDecks().length} fichier(s) HTML)`);
  console.log(`  Classement     : ${CLASSEMENT_URL ? CLASSEMENT_URL.replace(/([?&]cle=)[^&]*/, '$1***') : 'non configuré (CLASSEMENT_URL)'}`);
  console.log('');
  for (const ip of ips.length ? ips : ['localhost']) {
    console.log(`  Régie  (PC maître) : http://${ip}:${PORT}/control`);
    console.log(`  Écrans (autres PC) : http://${ip}:${PORT}/screen`);
    console.log(`  Écran buvette      : http://${ip}:${PORT}/buvette`);
    for (const d of listDecks()) console.log(`  Présentation maître : http://${ip}:${PORT}${d}?role=master`);
    console.log('');
  }
});
