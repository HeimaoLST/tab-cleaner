const els = {
  preset: document.getElementById('preset'),
  decisionEngine: document.getElementById('decisionEngine'),
  maxClosePerRun: document.getElementById('maxClosePerRun'),
  keepPinned: document.getElementById('keepPinned'),
  closeOldTempTabsMinutes: document.getElementById('closeOldTempTabsMinutes'),
  closeOldAuthTabsMinutes: document.getElementById('closeOldAuthTabsMinutes'),
  staleMinutesToConsider: document.getElementById('staleMinutesToConsider'),
  lowValueCloseThreshold: document.getElementById('lowValueCloseThreshold'),
  frequentHostActivateCountForGrouping: document.getElementById('frequentHostActivateCountForGrouping'),
  minTabAgeMinutesForLowValueClose: document.getElementById('minTabAgeMinutesForLowValueClose'),
  groupMinSize: document.getElementById('groupMinSize'),
  candidateLimit: document.getElementById('candidateLimit'),
  btnUndo: document.getElementById('btnUndo'),
  btnPreview: document.getElementById('btnPreview'),
  btnApply: document.getElementById('btnApply'),
  summary: document.getElementById('summary'),
  closeList: document.getElementById('closeList'),
  groupList: document.getElementById('groupList'),
  status: document.getElementById('status'),
};

const PRESETS = {
  safe: {
    staleMinutesToConsider: 120,
    lowValueCloseThreshold: 0.18,
    minTabAgeMinutesForLowValueClose: 60,
    frequentHostActivateCountForGrouping: 20,
    maxClosePerRun: 3,
    groupMinSize: 2,
  },
  balanced: {
    staleMinutesToConsider: 60,
    lowValueCloseThreshold: 0.22,
    minTabAgeMinutesForLowValueClose: 30,
    frequentHostActivateCountForGrouping: 12,
    maxClosePerRun: 5,
    groupMinSize: 2,
  },
  aggressive: {
    staleMinutesToConsider: 15,
    lowValueCloseThreshold: 0.35,
    minTabAgeMinutesForLowValueClose: 0,
    frequentHostActivateCountForGrouping: 3,
    maxClosePerRun: 10,
    groupMinSize: 2,
  },
};

function numberOrUndefined(inputEl) {
  if (!inputEl) return undefined;
  const raw = String(inputEl.value ?? '').trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function setStatus(text, { error = false } = {}) {
  els.status.textContent = text || '';
  els.status.classList.toggle('error', Boolean(error));
}

function setBusy(busy) {
  els.btnPreview.disabled = busy;
  els.btnApply.disabled = busy;
  if (els.btnUndo) els.btnUndo.disabled = busy;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function send(msg) {
  return await chrome.runtime.sendMessage(msg);
}

function readSettingsFromUI() {
  const patch = {
    preset: String(els.preset?.value || 'balanced'),
    decisionEngine: String(els.decisionEngine?.value || 'rules'),
    keepPinned: els.keepPinned.checked,
  };

  const maxClosePerRun = numberOrUndefined(els.maxClosePerRun);
  if (maxClosePerRun !== undefined) patch.maxClosePerRun = maxClosePerRun;

  const closeOldTempTabsMinutes = numberOrUndefined(els.closeOldTempTabsMinutes);
  if (closeOldTempTabsMinutes !== undefined) patch.closeOldTempTabsMinutes = closeOldTempTabsMinutes;

  const closeOldAuthTabsMinutes = numberOrUndefined(els.closeOldAuthTabsMinutes);
  if (closeOldAuthTabsMinutes !== undefined) patch.closeOldAuthTabsMinutes = closeOldAuthTabsMinutes;

  const staleMinutesToConsider = numberOrUndefined(els.staleMinutesToConsider);
  if (staleMinutesToConsider !== undefined) patch.staleMinutesToConsider = staleMinutesToConsider;

  const lowValueCloseThreshold = numberOrUndefined(els.lowValueCloseThreshold);
  if (lowValueCloseThreshold !== undefined) patch.lowValueCloseThreshold = lowValueCloseThreshold;

  const frequentHostActivateCountForGrouping = numberOrUndefined(els.frequentHostActivateCountForGrouping);
  if (frequentHostActivateCountForGrouping !== undefined)
    patch.frequentHostActivateCountForGrouping = frequentHostActivateCountForGrouping;

  const minTabAgeMinutesForLowValueClose = numberOrUndefined(els.minTabAgeMinutesForLowValueClose);
  if (minTabAgeMinutesForLowValueClose !== undefined)
    patch.minTabAgeMinutesForLowValueClose = minTabAgeMinutesForLowValueClose;

  const groupMinSize = numberOrUndefined(els.groupMinSize);
  if (groupMinSize !== undefined) patch.groupMinSize = groupMinSize;

  const candidateLimit = numberOrUndefined(els.candidateLimit);
  if (candidateLimit !== undefined) patch.candidateLimit = candidateLimit;

  return patch;
}

function applySettingsToUI(settings) {
  els.preset.value = String(settings.preset ?? 'balanced');
  if (els.decisionEngine) els.decisionEngine.value = String(settings.decisionEngine ?? 'rules');
  els.maxClosePerRun.value = String(settings.maxClosePerRun ?? 5);
  els.keepPinned.checked = Boolean(settings.keepPinned);
  els.closeOldTempTabsMinutes.value = String(settings.closeOldTempTabsMinutes ?? 10);
  els.closeOldAuthTabsMinutes.value = String(settings.closeOldAuthTabsMinutes ?? 20);
  els.staleMinutesToConsider.value = String(settings.staleMinutesToConsider ?? 60);
  els.lowValueCloseThreshold.value = String(settings.lowValueCloseThreshold ?? 0.22);
  els.frequentHostActivateCountForGrouping.value = String(settings.frequentHostActivateCountForGrouping ?? 12);
  els.minTabAgeMinutesForLowValueClose.value = String(settings.minTabAgeMinutesForLowValueClose ?? 30);
  els.groupMinSize.value = String(settings.groupMinSize ?? 2);
  if (els.candidateLimit) els.candidateLimit.value = String(settings.candidateLimit ?? 30);
}

function applyPresetToUI(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  els.preset.value = name;
  els.staleMinutesToConsider.value = String(preset.staleMinutesToConsider);
  els.lowValueCloseThreshold.value = String(preset.lowValueCloseThreshold);
  els.minTabAgeMinutesForLowValueClose.value = String(preset.minTabAgeMinutesForLowValueClose);
  els.frequentHostActivateCountForGrouping.value = String(preset.frequentHostActivateCountForGrouping);
  els.maxClosePerRun.value = String(preset.maxClosePerRun);
  els.groupMinSize.value = String(preset.groupMinSize);
}

function renderPlan(plan) {
  const s = plan?.stats;
  if (!s) {
    els.summary.textContent = '';
  } else {
    const debug = plan?.debug ?? {};
    const settings = plan?.settings ?? {};
    els.summary.innerHTML = [
      `<span class="pill">Tabs: ${escapeHtml(s.totalTabs)}</span>`,
      `<span class="pill">Close: ${escapeHtml(s.toClose)}</span>`,
      `<span class="pill">Groups: ${escapeHtml(s.groups)}</span>`,
      `<span class="pill">Strategy: ${escapeHtml(debug.tabQueryStrategy ?? '-') }</span>`,
      `<span class="pill">Engine: ${escapeHtml(debug.decisionEngine ?? '-') }</span>`,
      `<span class="pill">stale≥${escapeHtml(settings.staleMinutesToConsider ?? '-') }m</span>`,
      `<span class="pill">close&lt;${escapeHtml(settings.lowValueCloseThreshold ?? '-') }</span>`,
      `<span class="pill">host≥${escapeHtml(settings.frequentHostActivateCountForGrouping ?? '-') }</span>`,
      `<span class="pill">maxClose:${escapeHtml(settings.maxClosePerRun ?? '-') }</span>`,
    ].join(' ');
  }

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];

  const closes = [];
  for (const a of actions) {
    if (a?.type !== 'close_tabs') continue;
    if (Array.isArray(a.items)) closes.push(...a.items);
  }
  els.closeList.innerHTML = closes.length
    ? closes
        .slice(0, 30)
        .map(
          (c) => `
            <div class="item">
              <div class="top">
                <div class="title">${escapeHtml(c.title || '(no title)')}</div>
                <div class="reason">${escapeHtml(c.reason)}${
                  typeof c.score === 'number' ? ` · ${escapeHtml(c.score.toFixed(2))}` : ''
                }</div>
              </div>
              <div class="url">${escapeHtml(c.url || '')}</div>
              ${
                Array.isArray(c.explain) && c.explain.length
                  ? `<div class="url">${escapeHtml(c.explain.slice(0, 3).join(' · '))}</div>`
                  : ''
              }
            </div>
          `
        )
        .join('')
    : `<div class="item"><div class="title">Nothing to close</div></div>`;

  const groups = actions.filter((a) => a?.type === 'group_tabs');
  els.groupList.innerHTML = groups.length
    ? groups
        .map(
          (g) => `
            <div class="item">
              <div class="top">
                <div class="title">${escapeHtml(g.title)} (${escapeHtml(g.tabIds?.length ?? 0)})</div>
                <div class="reason">${escapeHtml(g.color)}</div>
              </div>
              <div class="url">${escapeHtml((g.sampleHosts ?? []).join(', '))}</div>
            </div>
          `
        )
        .join('')
    : `<div class="item"><div class="title">Nothing to group</div></div>`;
}

async function preview() {
  setBusy(true);
  setStatus('Previewing…');
  try {
    const patch = readSettingsFromUI();
    await send({ type: 'set_settings', patch });
    const res = await send({ type: 'plan' });
    if (!res?.ok) throw new Error(res?.error || 'plan_failed');
    renderPlan(res.plan);
    setStatus('Ready');
    window.__lastPlan = res.plan;
  } catch (e) {
    setStatus(String(e?.message || e), { error: true });
  } finally {
    setBusy(false);
  }
}

async function apply() {
  setBusy(true);
  setStatus('Tidying…');
  try {
    const patch = readSettingsFromUI();
    await send({ type: 'set_settings', patch });
    const plan = window.__lastPlan;
    const res = await send({ type: 'apply', plan });
    if (!res?.ok) throw new Error(res?.error || 'apply_failed');
    renderPlan(res.after);
    setStatus('Done');
    window.__lastPlan = null;
  } catch (e) {
    setStatus(String(e?.message || e), { error: true });
  } finally {
    setBusy(false);
  }
}

async function undo() {
  setBusy(true);
  setStatus('Undoing…');
  try {
    const res = await send({ type: 'undo_last_close' });
    if (!res?.ok) throw new Error(res?.error || 'undo_failed');
    setStatus(`Reopened ${res.reopened}/${res.had}`);
    await preview();
  } catch (e) {
    setStatus(String(e?.message || e), { error: true });
  } finally {
    setBusy(false);
  }
}

async function init() {
  setBusy(true);
  setStatus('Loading…');
  try {
    const res = await send({ type: 'get_settings' });
    if (!res?.ok) throw new Error(res?.error || 'get_settings_failed');
    applySettingsToUI(res.settings);
    await preview();
  } catch (e) {
    setStatus(String(e?.message || e), { error: true });
  } finally {
    setBusy(false);
  }
}

els.btnPreview.addEventListener('click', preview);
els.btnApply.addEventListener('click', apply);
els.btnUndo.addEventListener('click', undo);

els.preset?.addEventListener('change', async () => {
  const name = String(els.preset.value || 'balanced');
  applyPresetToUI(name);
  setStatus(`Mode: ${name}`);
});

init();
