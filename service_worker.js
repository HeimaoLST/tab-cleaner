const DEFAULT_SETTINGS = {
  preset: 'balanced',
  decisionEngine: 'rules', // 'rules' | 'ai_stub'
  candidateLimit: 30,
  keepPinned: true,
  closeOldTempTabsMinutes: 10,
  closeOldAuthTabsMinutes: 20,
  staleMinutesToConsider: 60,
  recencyHalfLifeMinutes: 240,
  lowValueCloseThreshold: 0.22,
  minTabAgeMinutesForLowValueClose: 30,
  // Safety valve: never close more than N tabs in one run.
  maxClosePerRun: 5,
  protectedHosts: [
    'mail.google.com',
    'app.slack.com',
    'docs.google.com',
    'github.com',
    // Feishu: keep by default (adjust if you use a different domain)
    'feishu.cn',
    'larksuite.com',
  ],
  groupMinSize: 2,
  frequentHostActivateCountForGrouping: 12,
  alwaysGroupHosts: [
    'youtube.com',
    'youtu.be',
    'x.com',
    'twitter.com',
    'github.com',
    'docs.google.com',
    'notion.so',
  ],
};

async function getDashscopeApiKey() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.dashscopeApiKey]);
  return data[STORAGE_KEYS.dashscopeApiKey] || '';
}

async function callQwenForGrouping(tabs, apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('API key not configured');
  }

  // Sanitize API key - remove any non-ASCII characters
  const cleanApiKey = apiKey.replace(/[^\x20-\x7E]/g, '').trim();
  if (!cleanApiKey) {
    throw new Error('API key contains invalid characters');
  }

  const tabInfo = tabs
    .filter((t) => t?.id && t?.url && (t.url.startsWith('http://') || t.url.startsWith('https://')))
    .map((t) => ({
      id: t.id,
      title: (t.title || 'Untitled').replace(/[^\x20-\x7E\x80-\xFF]/g, '').substring(0, 200),
      url: t.url,
      hostname: new URL(t.url).hostname,
    }));

  if (tabInfo.length < 2) {
    return [];
  }

  // Use English-only prompt to avoid encoding issues
  const prompt = `You are a tab organization assistant. Analyze browser tabs and suggest groups.

Rules:
1. Group tabs that are related or about the same topic/project
2. Use simple group names based on domain or topic
3. Each group must have at least 2 tabs
4. Return ONLY groups, NO closing
5. Group same-domain tabs together (GitHub, YouTube, etc.)

Tabs to analyze:
${JSON.stringify(tabInfo, null, 2)}

Respond with JSON array:
[
  {"title": "Group Name", "color": "blue|green|yellow|red|pink|purple|cyan|orange|grey", "tabIds": [1, 2, 3]}
]

JSON array only, no other text.`;

  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cleanApiKey,
      },
      body: JSON.stringify({
        model: 'qwen-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.choices?.[0]?.message?.content) {
      const content = data.choices[0].message.content;
      // Extract JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const groups = JSON.parse(jsonMatch[0]);
        return Array.isArray(groups) ? groups : [];
      }
      return [];
    }

    return [];
  } catch (error) {
    console.error('[TabTidy] Qwen API error:', error);
    throw error;
  }
}

console.log('[TabTidy] service worker loaded', new Date().toISOString());

const STORAGE_KEYS = {
  hostStats: 'hostStats_v1',
  tabMeta: 'tabMeta_v1',
  lastClosed: 'lastClosed_v1',
  dashscopeApiKey: 'dashscopeApiKey_v1',
};

let _cacheLoaded = false;
let _hostStats = {}; // { [host: string]: { activateCount: number, lastActivatedAt: number, lastSeenAt: number } }
let _tabMeta = {}; // { [tabId: string]: { createdAt: number, activatedCount: number, lastActivatedAt: number, host: string | null } }
let _pendingWrite = null;
let _writeTimer = null;

async function loadCacheOnce() {
  if (_cacheLoaded) return;
  const data = await chrome.storage.local.get([STORAGE_KEYS.hostStats, STORAGE_KEYS.tabMeta]);
  _hostStats = data[STORAGE_KEYS.hostStats] ?? {};
  _tabMeta = data[STORAGE_KEYS.tabMeta] ?? {};
  _cacheLoaded = true;
}

function schedulePersist() {
  _pendingWrite = {
    [STORAGE_KEYS.hostStats]: _hostStats,
    [STORAGE_KEYS.tabMeta]: _tabMeta,
  };
  if (_writeTimer) return;
  _writeTimer = setTimeout(async () => {
    const payload = _pendingWrite;
    _pendingWrite = null;
    _writeTimer = null;
    if (!payload) return;
    try {
      await chrome.storage.local.set(payload);
    } catch {
      // ignore
    }
  }, 800);
}

const GROUPS = [
  { title: 'YouTube', color: 'red', hosts: ['youtube.com', 'youtu.be'] },
  { title: 'X', color: 'blue', hosts: ['x.com', 'twitter.com'] },
  { title: 'GitHub', color: 'green', hosts: ['github.com'] },
  { title: 'Docs', color: 'cyan', hosts: ['docs.google.com', 'notion.so'] },
];

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'spm',
  'scid',
]);

function nowMs() {
  return Date.now();
}

function minutesAgoMs(minutes) {
  return minutes * 60_000;
}

function safeUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostForTab(tab) {
  const u = safeUrl(tab.url || tab.pendingUrl);
  return u?.hostname?.toLowerCase() ?? null;
}

function normalizeHost(host) {
  if (!host) return null;
  const h = host.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function stableHostTitle(host) {
  const h = normalizeHost(host);
  return h ?? 'Unknown';
}

function colorForHost(host) {
  const h = normalizeHost(host) ?? '';
  let hash = 0;
  for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) >>> 0;
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  return colors[hash % colors.length];
}

function normalizeUrl(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.toString();
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
  }
  // keep path & remaining params
  return u.toString();
}

function isChromeDownloadsTab(tab) {
  const url = tab.url || tab.pendingUrl || '';
  return url.startsWith('chrome://downloads');
}

function isInternalOrProtected(tab, settings) {
  const url = tab.url || tab.pendingUrl || '';
  const lower = url.toLowerCase();

  // Keep internal pages safe (except downloads which we may close via explicit rule).
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:')
  ) {
    return !isChromeDownloadsTab(tab);
  }

  const host = normalizeHost(hostForTab(tab));
  if (!host) return false;

  for (const h of settings.protectedHosts ?? []) {
    const ph = normalizeHost(h);
    if (!ph) continue;
    if (host === ph) return true;
    if (host.endsWith(`.${ph}`)) return true;
  }

  return false;
}

function buildCandidateSet(tabs, settings) {
  const tNow = nowMs();
  const close = [];
  const closeTabIds = new Set();
  const candidates = (tabs ?? []).filter((t) => typeof t?.id === 'number');

  const limit = Math.max(0, Number(settings.candidateLimit ?? DEFAULT_SETTINGS.candidateLimit) || 0);

  for (const tab of candidates) {
    if (isProtected(tab, settings)) continue;
    if (isInternalOrProtected(tab, settings)) continue;

    const age = tabAgeMs(tab, tNow);
    const { score, explain } = computeValueScore(tab, settings, tNow);
    const host = normalizeHost(hostForTab(tab));

    const createdAt = tabCreatedAt(tab, tNow);
    const tabAgeMinutes = (tNow - createdAt) / 60000;
    const inactiveMinutes = age / 60000;

    const base = {
      tabId: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      host,
      score,
      explain,
      inactiveMinutes: Math.round(inactiveMinutes),
      tabAgeMinutes: Math.round(tabAgeMinutes),
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
      groupId: typeof tab.groupId === 'number' ? tab.groupId : null,
    };

    if (isChromeDownloadsTab(tab) && age > minutesAgoMs(settings.closeOldTempTabsMinutes)) {
      close.push({ ...base, reason: 'downloads' });
      closeTabIds.add(tab.id);
      continue;
    }

    if (isLikelyDownloadLanding(tab) && age > minutesAgoMs(settings.closeOldTempTabsMinutes)) {
      close.push({ ...base, reason: 'download/temporary' });
      closeTabIds.add(tab.id);
      continue;
    }

    if (isTempBlank(tab) && age > minutesAgoMs(2)) {
      close.push({ ...base, reason: 'blank' });
      closeTabIds.add(tab.id);
      continue;
    }

    if (isLikelyAuthOrRedirect(tab) && age > minutesAgoMs(settings.closeOldAuthTabsMinutes)) {
      close.push({ ...base, reason: 'auth/redirect' });
      closeTabIds.add(tab.id);
      continue;
    }

    const isStaleEnough = inactiveMinutes >= settings.staleMinutesToConsider;
    const isOldEnough = tabAgeMinutes >= settings.minTabAgeMinutesForLowValueClose;
    if (isStaleEnough && isOldEnough && score < settings.lowValueCloseThreshold) {
      close.push({ ...base, reason: 'low_value' });
      closeTabIds.add(tab.id);
      continue;
    }
  }

  // Duplicates (normalized URL), keep most recently accessed.
  const byNorm = new Map();
  for (const tab of candidates) {
    if (isProtected(tab, settings)) continue;
    if (isInternalOrProtected(tab, settings)) continue;
    if (closeTabIds.has(tab.id)) continue;
    const norm = normalizeUrl(tab.url || tab.pendingUrl);
    if (!norm) continue;
    const arr = byNorm.get(norm) ?? [];
    arr.push(tab);
    byNorm.set(norm, arr);
  }

  for (const arr of byNorm.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const keep = arr[0];
    for (const tab of arr.slice(1)) {
      if (isProtected(tab, settings)) continue;
      if (isInternalOrProtected(tab, settings)) continue;
      const { score, explain } = computeValueScore(tab, settings, tNow);
      const host = normalizeHost(hostForTab(tab));
      close.push({
        tabId: tab.id,
        reason: `duplicate_of:${keep.id}`,
        title: tab.title ?? '',
        url: tab.url ?? '',
        host,
        score,
        explain,
        inactiveMinutes: Math.round(tabAgeMs(tab, tNow) / 60000),
        tabAgeMinutes: Math.round((tNow - tabCreatedAt(tab, tNow)) / 60000),
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        groupId: typeof tab.groupId === 'number' ? tab.groupId : null,
        keepTabId: keep.id,
      });
      closeTabIds.add(tab.id);
    }
  }

  if (limit > 0 && close.length > limit) {
    close.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
    close.splice(limit);
  }

  // Grouping candidates.
  const groupBuckets = new Map();
  for (const tab of candidates) {
    if (closeTabIds.has(tab.id)) continue;
    if (settings.keepPinned && tab.pinned) continue;
    if (tab.active) continue;
    if (typeof tab.groupId === 'number' && tab.groupId !== -1) continue;
    if (isInternalOrProtected(tab, settings)) continue;

    const host = normalizeHost(hostForTab(tab));
    if (!host) continue;

    const def = groupDefForHost(host);
    if (def) {
      const key = `def:${def.title}`;
      const entry = groupBuckets.get(key) ?? {
        title: def.title,
        color: def.color,
        tabIds: [],
        hosts: new Set(),
      };
      entry.tabIds.push(tab.id);
      entry.hosts.add(host);
      groupBuckets.set(key, entry);
      continue;
    }

    const hostActs = hostActivatedCount(host);
    const shouldGroupHost =
      settings.alwaysGroupHosts.includes(host) || hostActs >= settings.frequentHostActivateCountForGrouping;
    if (!shouldGroupHost) continue;
    const key = `host:${host}`;
    const entry = groupBuckets.get(key) ?? {
      title: stableHostTitle(host),
      color: colorForHost(host),
      tabIds: [],
      hosts: new Set(),
    };
    entry.tabIds.push(tab.id);
    entry.hosts.add(host);
    groupBuckets.set(key, entry);
  }

  const groupCandidates = [];
  for (const g of groupBuckets.values()) {
    const tabIds = [...new Set(g.tabIds)];
    if (tabIds.length < 2) continue;
    groupCandidates.push({
      title: g.title,
      color: g.color,
      tabIds,
      sampleHosts: [...g.hosts].slice(0, 5),
      hostCount: g.hosts.size,
    });
  }
  groupCandidates.sort((a, b) => a.title.localeCompare(b.title));

  return {
    totalTabs: candidates.length,
    closeCandidates: close,
    groupCandidates,
  };
}

function isLikelyDownloadLanding(tab) {
  const url = tab.url || tab.pendingUrl || '';
  const title = (tab.title || '').toLowerCase();
  const u = safeUrl(url);

  if (u && (u.protocol === 'http:' || u.protocol === 'https:')) {
    const path = (u.pathname || '').toLowerCase();
    const full = url.toLowerCase();
    if (/\b(download|export|redirect)\b/.test(path) || /\b(download|export)\b/.test(full)) return true;
  }

  if (/\b(download|export|success|thank)\b/.test(title)) return true;
  // Minimal Chinese keywords (lowercasing doesn't change these)
  if (title.includes('下载') || title.includes('导出') || title.includes('已完成')) return true;
  return false;
}

function isLikelyAuthOrRedirect(tab) {
  const url = tab.url || tab.pendingUrl || '';
  const u = safeUrl(url);
  const host = u?.hostname?.toLowerCase() ?? '';
  const path = (u?.pathname ?? '').toLowerCase();
  const full = (url || '').toLowerCase();

  if (host === 'accounts.google.com') return true;
  if (/(\boauth\b|\bsso\b|\bsignin\b|\blogin\b|\bcallback\b|\bredirect\b)/.test(path)) return true;
  if (/(\boauth\b|\bsso\b|\bsignin\b|\blogin\b|\bcallback\b|\bredirect\b)/.test(full)) return true;
  return false;
}

function isTempBlank(tab) {
  const url = (tab.url || tab.pendingUrl || '').toLowerCase();
  return url === 'about:blank';
}

function tabAgeMs(tab, tNow) {
  const last = typeof tab.lastAccessed === 'number' ? tab.lastAccessed : tNow;
  return Math.max(0, tNow - last);
}

function isProtected(tab, settings) {
  if (settings.keepPinned && tab.pinned) return true;
  if (tab.active) return true;
  return false;
}

function groupDefForHost(host) {
  if (!host) return null;
  const h = normalizeHost(host);
  for (const def of GROUPS) {
    if (def.hosts.includes(host) || def.hosts.includes(h)) return def;
  }
  return null;
}

function getHostStat(host) {
  const h = normalizeHost(host);
  if (!h) return null;
  return _hostStats[h] ?? null;
}

function bumpHostSeen(host, tNow) {
  const h = normalizeHost(host);
  if (!h) return;
  const s = _hostStats[h] ?? { activateCount: 0, lastActivatedAt: 0, lastSeenAt: 0 };
  s.lastSeenAt = Math.max(s.lastSeenAt || 0, tNow);
  _hostStats[h] = s;
}

function bumpHostActivated(host, tNow) {
  const h = normalizeHost(host);
  if (!h) return;
  const s = _hostStats[h] ?? { activateCount: 0, lastActivatedAt: 0, lastSeenAt: 0 };
  s.activateCount = (s.activateCount || 0) + 1;
  s.lastActivatedAt = Math.max(s.lastActivatedAt || 0, tNow);
  s.lastSeenAt = Math.max(s.lastSeenAt || 0, tNow);
  _hostStats[h] = s;
}

function ensureTabMeta(tabId, tNow) {
  const key = String(tabId);
  const m = _tabMeta[key] ?? { createdAt: tNow, activatedCount: 0, lastActivatedAt: 0, host: null };
  if (!m.createdAt) m.createdAt = tNow;
  _tabMeta[key] = m;
  return m;
}

function setTabHost(tabId, host, tNow) {
  const m = ensureTabMeta(tabId, tNow);
  const h = normalizeHost(host);
  m.host = h;
  _tabMeta[String(tabId)] = m;
  if (h) bumpHostSeen(h, tNow);
}

function bumpTabActivated(tabId, host, tNow) {
  const m = ensureTabMeta(tabId, tNow);
  m.activatedCount = (m.activatedCount || 0) + 1;
  m.lastActivatedAt = Math.max(m.lastActivatedAt || 0, tNow);
  if (host) m.host = normalizeHost(host);
  _tabMeta[String(tabId)] = m;
  if (host) bumpHostActivated(host, tNow);
}

function tabCreatedAt(tab, tNow) {
  const m = _tabMeta[String(tab.id)] ?? null;
  if (m?.createdAt) return m.createdAt;
  if (typeof tab.lastAccessed === 'number') return tab.lastAccessed;
  return tNow;
}

function tabActivatedCount(tab) {
  const m = _tabMeta[String(tab.id)] ?? null;
  return m?.activatedCount ?? 0;
}

function hostActivatedCount(host) {
  const s = getHostStat(host);
  return s?.activateCount ?? 0;
}

function expDecayScore(ageMs, halfLifeMinutes) {
  const hl = Math.max(1, Number(halfLifeMinutes) || 1) * 60_000;
  // exp(-ln2 * t/halfLife)
  return Math.exp((-0.69314718056 * Math.max(0, ageMs)) / hl);
}

function freqScore(count, scale) {
  const c = Math.max(0, Number(count) || 0);
  const s = Math.max(1, Number(scale) || 1);
  return 1 - Math.exp(-c / s);
}

function computeValueScore(tab, settings, tNow) {
  const inactiveMs = tabAgeMs(tab, tNow);
  const host = normalizeHost(hostForTab(tab));
  const hostActs = hostActivatedCount(host);
  const tabActs = tabActivatedCount(tab);

  const recency = expDecayScore(inactiveMs, settings.recencyHalfLifeMinutes);
  const hostFreq = freqScore(hostActs, 12);
  const tabFreq = freqScore(tabActs, 4);

  const score = 0.58 * recency + 0.32 * hostFreq + 0.1 * tabFreq;

  const explain = [];
  explain.push(`inactive_minutes:${Math.round(inactiveMs / 60000)}`);
  if (host) explain.push(`host:${host}`);
  explain.push(`host_activations:${hostActs}`);
  explain.push(`tab_activations:${tabActs}`);
  explain.push(`score:${score.toFixed(3)}`);

  return { score, explain, host };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

async function setSettings(patch) {
  const current = await getSettings();
  await chrome.storage.sync.set({ settings: { ...current, ...patch } });
}

function buildPlanRules(tabs, settings) {
  const { totalTabs, closeCandidates, groupCandidates } = buildCandidateSet(tabs, settings);

  const groups = [];
  for (const g of groupCandidates) {
    const shouldAlwaysGroup = (g.sampleHosts ?? []).some((h) => settings.alwaysGroupHosts.includes(h));
    if (!shouldAlwaysGroup && g.tabIds.length < settings.groupMinSize) continue;
    if (g.tabIds.length < 2) continue;
    groups.push(g);
  }

  const actions = [];
  if (closeCandidates.length) {
    actions.push({
      type: 'close_tabs',
      tabIds: closeCandidates.map((c) => c.tabId),
      items: closeCandidates,
    });
  }
  for (const g of groups) {
    actions.push({
      type: 'group_tabs',
      title: g.title,
      color: g.color,
      collapsed: false,
      tabIds: g.tabIds,
      sampleHosts: g.sampleHosts,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    settings,
    stats: {
      totalTabs,
      toClose: closeCandidates.length,
      groups: groups.length,
      toGroupTabs: groups.reduce((acc, g) => acc + g.tabIds.length, 0),
      actions: actions.length,
    },
    actions,
  };
}

function buildPlanAiStub(tabs, settings) {
  // Placeholder for real LLM: we still do rules-based decisions, but through the
  // candidate-set interface so we can swap the decision step later.
  const { totalTabs, closeCandidates, groupCandidates } = buildCandidateSet(tabs, settings);

  // Stub decision: same gating as rules.
  const groups = [];
  for (const g of groupCandidates) {
    const shouldAlwaysGroup = (g.sampleHosts ?? []).some((h) => settings.alwaysGroupHosts.includes(h));
    if (!shouldAlwaysGroup && g.tabIds.length < settings.groupMinSize) continue;
    if (g.tabIds.length < 2) continue;
    groups.push(g);
  }

  const actions = [];
  if (closeCandidates.length) {
    actions.push({ type: 'close_tabs', tabIds: closeCandidates.map((c) => c.tabId), items: closeCandidates });
  }
  for (const g of groups) {
    actions.push({
      type: 'group_tabs',
      title: g.title,
      color: g.color,
      collapsed: false,
      tabIds: g.tabIds,
      sampleHosts: g.sampleHosts,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    settings,
    stats: {
      totalTabs,
      toClose: closeCandidates.length,
      groups: groups.length,
      toGroupTabs: groups.reduce((acc, g) => acc + g.tabIds.length, 0),
      actions: actions.length,
    },
    actions,
    candidates: {
      close: closeCandidates.length,
      group: groupCandidates.length,
      limit: Math.max(0, Number(settings.candidateLimit ?? DEFAULT_SETTINGS.candidateLimit) || 0),
    },
  };
}

function buildPlan(tabs, settings) {
  const engine = String(settings.decisionEngine ?? DEFAULT_SETTINGS.decisionEngine);
  if (engine === 'ai_stub') return buildPlanAiStub(tabs, settings);
  if (engine === 'ai_clean') return buildPlanAiClean(tabs, settings);
  return buildPlanRules(tabs, settings);
}

async function buildPlanAiClean(tabs, settings) {
  const tNow = nowMs();
  const apiKey = await getDashscopeApiKey();

  const validTabs = (tabs ?? []).filter((t) => {
    if (typeof t?.id !== 'number') return false;
    if (t.active) return false;
    if (settings.keepPinned && t.pinned) return false;
    if (isInternalOrProtected(t, settings)) return false;
    return true;
  });

  let groups = [];
  let aiError = null;

  if (apiKey && validTabs.length >= 2) {
    try {
      groups = await callQwenForGrouping(validTabs, apiKey);
    } catch (e) {
      aiError = String(e?.message || e);
    }
  }

  const actions = [];

  for (const g of groups) {
    if (!g?.title || !Array.isArray(g?.tabIds)) continue;

    const validTabIds = g.tabIds.filter((id) => typeof id === 'number');

    if (validTabIds.length < 2) continue;

    // Determine color
    let color = g.color || 'blue';
    const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    if (!validColors.includes(color)) color = 'blue';

    actions.push({
      type: 'group_tabs',
      title: String(g.title).substring(0, 100),
      color,
      collapsed: false,
      tabIds: validTabIds,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    settings: {
      ...settings,
      preset: 'ai_clean',
    },
    stats: {
      totalTabs: tabs?.length || 0,
      toClose: 0,
      groups: actions.filter((a) => a.type === 'group_tabs').length,
      toGroupTabs: actions
        .filter((a) => a.type === 'group_tabs')
        .reduce((acc, g) => acc + (g.tabIds?.length || 0), 0),
      actions: actions.length,
    },
    actions,
    ai: {
      enabled: !!apiKey,
      error: aiError,
      tabCount: validTabs.length,
    },
    debug: {
      decisionEngine: 'ai_clean',
      tabCount: tabs?.length || 0,
      aiEnabled: !!apiKey,
      aiError,
    },
  };
}

async function planForCurrentWindow() {
  await loadCacheOnce();
  const settings = await getSettings();
  const { tabs, strategy } = await getTargetTabsForPlanning();
  bootstrapFromTabs(tabs);
  const plan = buildPlan(tabs, settings);
  const tabsWithUrl = (tabs ?? []).filter((t) => Boolean(t?.url || t?.pendingUrl)).length;
  const tabsWithHost = (tabs ?? []).filter((t) => Boolean(hostForTab(t))).length;
  plan.debug = {
    ...(plan.debug ?? {}),
    tabQueryStrategy: strategy,
    tabCount: tabs.length,
    tabsWithUrl,
    tabsWithoutUrl: tabs.length - tabsWithUrl,
    tabsWithHost,
    tabsWithoutHost: tabs.length - tabsWithHost,
    hostStatsCount: Object.keys(_hostStats ?? {}).length,
    tabMetaCount: Object.keys(_tabMeta ?? {}).length,
    decisionEngine: String(settings.decisionEngine ?? DEFAULT_SETTINGS.decisionEngine),
  };
  return plan;
}

async function getTargetTabsForPlanning() {
  // In MV3 service worker context, `currentWindow: true` / `lastFocusedWindow: true`
  // can sometimes return an empty list depending on focus state.
  // Strategy:
  // 1) Try currentWindow
  // 2) Try lastFocusedWindow
  // 3) Pick the most recently accessed active tab across windows, then query by its windowId
  // 4) Fallback: query all tabs
  try {
    const t1 = await chrome.tabs.query({ currentWindow: true });
    if (t1?.length) return { tabs: t1, strategy: 'currentWindow' };
  } catch {
    // ignore
  }

  try {
    const t2 = await chrome.tabs.query({ lastFocusedWindow: true });
    if (t2?.length) return { tabs: t2, strategy: 'lastFocusedWindow' };
  } catch {
    // ignore
  }

  try {
    const activeTabs = await chrome.tabs.query({ active: true });
    const chosen = (activeTabs ?? [])
      .filter((t) => typeof t.windowId === 'number')
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    if (chosen) {
      const t3 = await chrome.tabs.query({ windowId: chosen.windowId });
      if (t3?.length) return { tabs: t3, strategy: `activeWindow:${chosen.windowId}` };
    }
  } catch {
    // ignore
  }

  const t4 = await chrome.tabs.query({});
  return { tabs: t4 ?? [], strategy: 'allTabs' };
}

function bootstrapFromTabs(tabs) {
  const tNow = nowMs();
  for (const tab of tabs ?? []) {
    if (typeof tab?.id !== 'number') continue;
    ensureTabMeta(tab.id, tNow);
    const host = hostForTab(tab);
    if (host) setTabHost(tab.id, host, tNow);
  }
  schedulePersist();
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') return { actions: [] };
  if (Array.isArray(plan.actions)) return plan;

  // Back-compat: older plan format.
  const actions = [];
  const closeItems = Array.isArray(plan.close) ? plan.close : [];
  if (closeItems.length) {
    actions.push({
      type: 'close_tabs',
      tabIds: closeItems.map((c) => c.tabId),
      items: closeItems,
    });
  }
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  for (const g of groups) {
    actions.push({
      type: 'group_tabs',
      title: g.title,
      color: g.color,
      collapsed: false,
      tabIds: g.tabIds,
      sampleHosts: g.sampleHosts,
    });
  }
  return { ...plan, actions, schemaVersion: 1 };
}

async function applyPlan(plan) {
  await loadCacheOnce();
  const normalized = normalizePlan(plan);
  const actions = Array.isArray(normalized.actions) ? normalized.actions : [];

  const effectiveSettings = {
    ...(await getSettings()),
    ...(normalized?.settings ?? {}),
  };

  // For AI Clean mode, skip all close actions
  const isAiClean = effectiveSettings.preset === 'ai_clean';
  const maxClosePerRun = isAiClean ? 0 : Math.max(0, Number(effectiveSettings.maxClosePerRun ?? DEFAULT_SETTINGS.maxClosePerRun) || 0);

  // Close first to reduce noise.
  const closeCandidates = [];
  for (const a of actions) {
    if (a?.type !== 'close_tabs') continue;
    // Skip closing in AI Clean mode
    if (isAiClean) continue;
    const items = Array.isArray(a.items) ? a.items : [];
    if (items.length) {
      for (const it of items) {
        if (typeof it?.tabId !== 'number') continue;
        closeCandidates.push({
          tabId: it.tabId,
          score: typeof it.score === 'number' ? it.score : null,
          reason: it.reason ?? null,
          url: it.url ?? null,
        });
      }
    } else {
      const ids = Array.isArray(a.tabIds) ? a.tabIds : [];
      for (const id of ids) if (typeof id === 'number') closeCandidates.push({ tabId: id, score: null, reason: null, url: null });
    }
  }

  const uniqueById = new Map();
  for (const c of closeCandidates) {
    if (!uniqueById.has(c.tabId)) uniqueById.set(c.tabId, c);
  }

  const uniqueClose = [...uniqueById.values()];
  uniqueClose.sort((a, b) => {
    const as = a.score ?? 999;
    const bs = b.score ?? 999;
    if (as !== bs) return as - bs;
    return String(a.reason ?? '').localeCompare(String(b.reason ?? ''));
  });

  const toClose = maxClosePerRun > 0 ? uniqueClose.slice(0, maxClosePerRun) : uniqueClose;

  // Validator: AI cannot override these.
  const validatedClose = [];
  for (const c of toClose) {
    try {
      const tab = await chrome.tabs.get(c.tabId);
      if (tab?.active) continue;
      if (tab?.pinned) continue;
      if (isInternalOrProtected(tab, effectiveSettings)) continue;
      validatedClose.push({ ...c, url: c.url ?? tab.url ?? null });
    } catch {
      // ignore
    }
  }

  const uniqueCloseIds = validatedClose.map((c) => c.tabId);

  if (uniqueCloseIds.length) {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.lastClosed]: {
          at: nowMs(),
          tabIds: uniqueCloseIds,
          urls: validatedClose.map((c) => c.url).filter((u) => typeof u === 'string' && u.length < 2000),
          dropped: uniqueClose.length - validatedClose.length,
        },
      });
    } catch {
      // ignore
    }
    try {
      await chrome.tabs.remove(uniqueCloseIds);
    } catch {
      // ignore (tabs may already be gone)
    }
  }

  // Group remaining tabs.
  for (const a of actions) {
    if (a?.type !== 'group_tabs') continue;
    const rawIds = Array.isArray(a.tabIds) ? a.tabIds.filter((id) => typeof id === 'number') : [];

    const tabIds = [];
    for (const id of rawIds) {
      try {
        const tab = await chrome.tabs.get(id);
        if (tab?.active) continue;
        if (tab?.pinned) continue;
        if (isInternalOrProtected(tab, effectiveSettings)) continue;
        tabIds.push(id);
      } catch {
        // ignore
      }
    }
    if (tabIds.length < 2) continue;

    // Best-effort: move them to end so they become adjacent.
    try {
      await chrome.tabs.move(tabIds, { index: -1 });
    } catch {
      // ignore
    }

    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: a.title,
        color: a.color,
        collapsed: Boolean(a.collapsed),
      });
    } catch {
      // ignore (tabs might be in multiple windows, closed, or pinned edge-cases)
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await loadCacheOnce();
    if (msg?.type === 'debug_dump') {
      const plan = await planForCurrentWindow();
      sendResponse({
        ok: true,
        plan,
        hostStats: _hostStats,
        tabMeta: _tabMeta,
      });
      return;
    }
    if (msg?.type === 'undo_last_close') {
      const data = await chrome.storage.local.get([STORAGE_KEYS.lastClosed]);
      const last = data[STORAGE_KEYS.lastClosed] ?? null;
      const urls = Array.isArray(last?.urls) ? last.urls : [];
      let reopened = 0;
      for (const url of urls.slice(0, 25)) {
        try {
          await chrome.tabs.create({ url, active: false });
          reopened += 1;
        } catch {
          // ignore
        }
      }
      sendResponse({ ok: true, reopened, had: urls.length, at: last?.at ?? null, dropped: last?.dropped ?? 0 });
      return;
    }
    if (msg?.type === 'get_settings') {
      sendResponse({ ok: true, settings: await getSettings() });
      return;
    }
    if (msg?.type === 'set_settings') {
      await setSettings(msg.patch ?? {});
      sendResponse({ ok: true, settings: await getSettings() });
      return;
    }
    if (msg?.type === 'set_api_key') {
      const key = msg?.apiKey ?? '';
      if (key) {
        await chrome.storage.local.set({ [STORAGE_KEYS.dashscopeApiKey]: key });
      } else {
        await chrome.storage.local.remove([STORAGE_KEYS.dashscopeApiKey]);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'get_api_key') {
      const key = await getDashscopeApiKey();
      sendResponse({ ok: true, apiKey: key });
      return;
    }
    if (msg?.type === 'plan') {
      const plan = await planForCurrentWindow();
      sendResponse({ ok: true, plan });
      return;
    }
    if (msg?.type === 'apply') {
      const plan = msg.plan ?? (await planForCurrentWindow());
      await applyPlan(plan);
      const after = await planForCurrentWindow();
      sendResponse({ ok: true, after });
      return;
    }
    sendResponse({ ok: false, error: 'unknown_message' });
  })();

  return true;
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await loadCacheOnce();
  const tNow = nowMs();
  if (typeof tab.id !== 'number') return;
  ensureTabMeta(tab.id, tNow);
  const host = hostForTab(tab);
  if (host) setTabHost(tab.id, host, tNow);
  schedulePersist();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await loadCacheOnce();
  const tNow = nowMs();
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const host = hostForTab(tab);
    bumpTabActivated(activeInfo.tabId, host, tNow);
    schedulePersist();
  } catch {
    // ignore
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await loadCacheOnce();
  const tNow = nowMs();
  if (changeInfo.url || changeInfo.status === 'complete') {
    const host = hostForTab(tab);
    if (host) {
      setTabHost(tabId, host, tNow);
      schedulePersist();
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadCacheOnce();
  const key = String(tabId);
  if (_tabMeta[key]) {
    delete _tabMeta[key];
    schedulePersist();
  }
});
