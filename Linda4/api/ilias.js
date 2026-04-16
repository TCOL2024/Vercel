const ILIAS_TARGET_HOST = 'ihk-campus-oldenburg.de';
const ILIAS_TARGET_ORIGIN = `https://${ILIAS_TARGET_HOST}`;
const ILIAS_SEARCH_URL = String(process.env.ILIAS_SEARCH_URL || '').trim();
const ILIAS_SEARCH_PATH = String(process.env.ILIAS_SEARCH_PATH || '/search').trim();
const ILIAS_CONNECT_URL = String(process.env.ILIAS_CONNECT_URL || '').trim();
const ILIAS_API_TOKEN = String(process.env.ILIAS_API_TOKEN || '').trim();
const ILIAS_SESSION_COOKIE = String(process.env.ILIAS_SESSION_COOKIE || '').trim();

function parseJsonSafe(value, fallback = {}) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultiline(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readBodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return parseJsonSafe(req.body.toString('utf8'), {});
  if (typeof req.body === 'string') return parseJsonSafe(req.body, {});
  return {};
}

function getAction(req) {
  if (req?.query?.action) return String(req.query.action).toLowerCase();
  try {
    const u = new URL(req.url || '', 'http://localhost');
    return String(u.searchParams.get('action') || 'status').toLowerCase();
  } catch (_) {
    return 'status';
  }
}

function getRequestOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

function sanitizeReturnTo(req, value) {
  const origin = getRequestOrigin(req);
  if (!origin) return '/';
  const raw = normalizeText(value);
  if (!raw) return '/';
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return '/';
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch (_) {
    return '/';
  }
}

function buildCampusUrl(raw, fallbackPath = '/') {
  const fallback = String(fallbackPath || '/').trim() || '/';
  const safeFallback = fallback.startsWith('/') ? fallback : `/${fallback}`;
  if (!raw) return new URL(safeFallback, ILIAS_TARGET_ORIGIN);
  const cleaned = normalizeText(raw);
  if (!cleaned) return new URL(safeFallback, ILIAS_TARGET_ORIGIN);
  try {
    const inUrl = new URL(cleaned, ILIAS_TARGET_ORIGIN);
    const outUrl = new URL(ILIAS_TARGET_ORIGIN);
    outUrl.pathname = inUrl.pathname || safeFallback;
    outUrl.search = inUrl.search || '';
    outUrl.hash = inUrl.hash || '';
    return outUrl;
  } catch (_) {
    const asPath = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
    return new URL(asPath, ILIAS_TARGET_ORIGIN);
  }
}

function isConfigured() {
  return Boolean(ILIAS_TARGET_ORIGIN);
}

function hasAuth() {
  return Boolean(ILIAS_API_TOKEN || ILIAS_SESSION_COOKIE);
}

function resolveSearchUrl() {
  return buildCampusUrl(ILIAS_SEARCH_URL || ILIAS_SEARCH_PATH || '/search', '/search');
}

function resolveConnectUrl(req) {
  const returnToRaw = req?.query?.returnTo;
  const returnToPath = sanitizeReturnTo(req, returnToRaw);
  const origin = getRequestOrigin(req);

  const base = buildCampusUrl(ILIAS_CONNECT_URL || '/login', '/login').toString();
  let u;
  try {
    u = new URL(base);
  } catch (_) {
    return '';
  }

  const returnToAbsolute = origin ? `${origin}${returnToPath}` : '';
  if (returnToAbsolute) {
    if (!u.searchParams.has('returnTo')) u.searchParams.set('returnTo', returnToAbsolute);
    if (!u.searchParams.has('redirect_uri')) u.searchParams.set('redirect_uri', returnToAbsolute);
  }
  return u.toString();
}

function pickHits(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.sources)) return payload.sources;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.hits)) return payload.hits;
  if (payload.data && typeof payload.data === 'object') return pickHits(payload.data);
  return [];
}

function normalizeHit(item, fallbackQuery = '') {
  if (!item || typeof item !== 'object') return null;
  const title = normalizeText(
    item.title ||
    item.name ||
    item.document ||
    item.filename ||
    item.file ||
    item.label ||
    'ILIAS-Dokument'
  );
  const url = normalizeText(item.url || item.link || item.href || item.download_url || '');
  const excerpt = normalizeMultiline(
    item.excerpt ||
    item.snippet ||
    item.chunk ||
    item.content ||
    item.text ||
    item.preview ||
    ''
  ).slice(0, 1400);
  const section = normalizeText(
    item.section ||
    item.path ||
    item.location ||
    item.folder ||
    item.chapter ||
    ''
  );
  const page = normalizeText(item.page || item.pageNumber || item.seite || '');
  const confidence = Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null;
  const noteBits = ['ILIAS'];
  if (section) noteBits.push(section);
  if (fallbackQuery) noteBits.push(`Suchbezug: ${fallbackQuery.slice(0, 120)}`);

  if (!title && !url && !excerpt) return null;
  return {
    title: title || 'ILIAS-Dokument',
    url,
    excerpt,
    section,
    page,
    note: noteBits.join(' | '),
    confidence
  };
}

async function handleStatus(req, res) {
  const configured = isConfigured();
  const connected = hasAuth();
  const loginUrl = resolveConnectUrl(req);
  const ok = configured && connected;
  const message = !configured
    ? 'ILIAS-Connector ist noch nicht konfiguriert.'
    : (connected
        ? 'ILIAS-Suche ist bereit.'
        : 'ILIAS-Connector ist konfiguriert, aber es fehlt eine gueltige Anmeldung.');
  res.status(200).json({
    ok,
    configured,
    connected,
    target_origin: ILIAS_TARGET_ORIGIN,
    login_url: loginUrl,
    message,
    ts: new Date().toISOString()
  });
}

async function handleConnect(req, res) {
  const url = resolveConnectUrl(req);
  if (!url) {
    res.status(503).json({
      error: 'ILIAS-Login ist nicht konfiguriert.',
      target_origin: ILIAS_TARGET_ORIGIN,
      configured: false,
      connected: false
    });
    return;
  }
  res.status(302);
  res.setHeader('location', url);
  res.end();
}

async function handleSearch(req, res) {
  if (!isConfigured()) {
    res.status(503).json({
      error: 'ILIAS-Suche ist nicht konfiguriert.',
      target_origin: ILIAS_TARGET_ORIGIN,
      configured: false,
      connected: false,
      login_required: false,
      login_url: resolveConnectUrl(req)
    });
    return;
  }
  if (!hasAuth()) {
    res.status(401).json({
      error: 'ILIAS-Anmeldung erforderlich.',
      target_origin: ILIAS_TARGET_ORIGIN,
      configured: true,
      connected: false,
      login_required: true,
      login_url: resolveConnectUrl(req)
    });
    return;
  }

  const body = readBodyObject(req);
  const query = normalizeText(body.query || body.question || body.q || '');
  const courseId = normalizeText(body.courseId || body.course_id || '');
  const topK = Math.max(1, Math.min(8, Number(body.topK || body.top_k || 4)));
  if (!query) {
    res.status(400).json({ error: 'query ist erforderlich.' });
    return;
  }

  const searchUrl = resolveSearchUrl();
  const headers = { 'content-type': 'application/json' };
  if (ILIAS_API_TOKEN) headers.authorization = `Bearer ${ILIAS_API_TOKEN}`;
  if (ILIAS_SESSION_COOKIE) headers.cookie = ILIAS_SESSION_COOKIE;

  const upstreamRes = await fetch(searchUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      courseId,
      topK
    })
  });
  const raw = await upstreamRes.text();
  const parsed = parseJsonSafe(raw, {});

  if (!upstreamRes.ok) {
    const detail = normalizeText(parsed?.error || parsed?.message || raw);
    if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      res.status(401).json({
        error: detail || 'ILIAS-Anmeldung abgelaufen.',
        target_origin: ILIAS_TARGET_ORIGIN,
        configured: true,
        connected: false,
        login_required: true,
        login_url: resolveConnectUrl(req)
      });
      return;
    }
    res.status(502).json({
      error: detail || `ILIAS-Suche fehlgeschlagen (HTTP ${upstreamRes.status}).`,
      target_origin: ILIAS_TARGET_ORIGIN,
      configured: true,
      connected: true,
      login_required: false
    });
    return;
  }

  const normalizedHits = pickHits(parsed)
    .map((item) => normalizeHit(item, query))
    .filter(Boolean)
    .slice(0, topK);
  const chunks = normalizedHits
    .map((hit, idx) => ({
      rank: idx + 1,
      title: hit.title,
      location: hit.section || '',
      page: hit.page || '',
      excerpt: String(hit.excerpt || '').slice(0, 900),
      url: hit.url || ''
    }))
    .filter((chunk) => chunk.excerpt || chunk.url);

  res.status(200).json({
    ok: true,
    configured: true,
    connected: true,
    target_origin: ILIAS_TARGET_ORIGIN,
    login_required: false,
    login_url: resolveConnectUrl(req),
    message: normalizedHits.length
      ? `ILIAS-Treffer gefunden: ${normalizedHits.length}`
      : 'Keine ILIAS-Treffer gefunden.',
    course_id: courseId || '',
    query,
    sources: normalizedHits,
    chunks,
    ts: new Date().toISOString()
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const action = getAction(req);
    if (action === 'connect') {
      await handleConnect(req, res);
      return;
    }
    if (action === 'search') {
      await handleSearch(req, res);
      return;
    }
    await handleStatus(req, res);
  } catch (err) {
    res.status(500).json({
      error: normalizeText(err?.message || 'ILIAS-Adapter Fehler'),
      target_origin: ILIAS_TARGET_ORIGIN,
      configured: isConfigured(),
      connected: hasAuth(),
      login_required: !hasAuth(),
      login_url: resolveConnectUrl(req),
      ts: new Date().toISOString()
    });
  }
};
