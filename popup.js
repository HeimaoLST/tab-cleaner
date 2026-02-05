const els = {
  preset: document.getElementById('preset'),
  decisionEngine: document.getElementById('decisionEngine'),
  dashscopeApiKey: document.getElementById('dashscopeApiKey'),
  btnBack: document.getElementById('btnBack'),
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
  ai_clean: {
    // AI Clean mode: no closing, only grouping decided by AI
    staleMinutesToConsider: 0,
    lowValueCloseThreshold: 1.0, // Never close (threshold above max score)
    minTabAgeMinutesForLowValueClose: 999999,
    frequentHostActivateCountForGrouping: 0,
    maxClosePerRun: 0,
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

async function getStoredApiKey() {
  const res = await send({ type: 'get_api_key' });
  return res?.apiKey || '';
}

async function saveApiKey(key) {
  await send({ type: 'set_api_key', apiKey: key });
}

function readSettingsFromUI() {
  const presetValue = String(els.preset?.value || 'balanced');
  const isAiClean = presetValue === 'ai_clean';

  const patch = {
    preset: presetValue,
    decisionEngine: isAiClean ? 'ai_clean' : String(els.decisionEngine?.value || 'rules'),
    keepPinned: els.keepPinned.checked,
  };

  if (!isAiClean) {
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
  }

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

function updateSettingsVisibility(isAiClean) {
  // Toggle body class for CSS-based visibility
  document.body.classList.toggle('ai-mode-active', isAiClean);

  // Show/hide Preview button in AI Clean mode (not needed)
  if (els.btnPreview) {
    els.btnPreview.style.display = isAiClean ? 'none' : '';
  }

  // Change Apply button text
  if (els.btnApply) {
    els.btnApply.textContent = isAiClean ? 'Clean' : 'Tidy now';
  }
}

function renderPlan(plan) {
  const s = plan?.stats;
  const isAiClean = plan?.settings?.preset === 'ai_clean';

  if (!s) {
    els.summary.textContent = '';
  } else {
    const debug = plan?.debug ?? {};
    const settings = plan?.settings ?? {};
    els.summary.innerHTML = [
      `<span class="pill">Tabs: ${escapeHtml(s.totalTabs)}</span>`,
      isAiClean
        ? `<span class="pill" style="border-color: var(--primary)">AI Clean Mode</span>`
        : `<span class="pill">Close: ${escapeHtml(s.toClose)}</span>`,
      `<span class="pill">Groups: ${escapeHtml(s.groups)}</span>`,
      `<span class="pill">Strategy: ${escapeHtml(debug.tabQueryStrategy ?? '-') }</span>`,
      isAiClean ? '' : `<span class="pill">Engine: ${escapeHtml(debug.decisionEngine ?? '-') }</span>`,
    ].filter(Boolean).join(' ');
  }

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];

  // For AI Clean mode, we don't show close candidates
  const closes = [];
  for (const a of actions) {
    if (a?.type !== 'close_tabs') continue;
    if (Array.isArray(a.items)) closes.push(...a.items);
  }

  const closeDetails = els.closeList?.closest('details');
  if (closeDetails && isAiClean) {
    closeDetails.style.display = 'none';
  } else if (closeDetails) {
    closeDetails.style.display = '';
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
    : `<div class="item"><div class="title">${isAiClean ? 'AI will suggest groups' : 'Nothing to group'}</div></div>`;
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
  const isAiClean = els.preset?.value === 'ai_clean';
  setStatus(isAiClean ? 'AI is thinking…' : 'Tidy now…');
  try {
    const patch = readSettingsFromUI();
    await send({ type: 'set_settings', patch });

    // Always generate a fresh plan to ensure settings are applied
    const planRes = await send({ type: 'plan' });
    if (!planRes?.ok) throw new Error(planRes?.error || 'plan_failed');
    window.__lastPlan = planRes.plan;

    // Show preview for non-AI modes
    if (!isAiClean) {
      renderPlan(planRes.plan);
      setStatus('Ready - review and click Tidy now');
    } else {
      // For AI mode, apply immediately
      const res = await send({ type: 'apply', plan: planRes.plan });
      if (!res?.ok) throw new Error(res?.error || 'apply_failed');
      renderPlan(res.after);
      setStatus('Done! Tabs grouped by AI.');
      window.__lastPlan = null;
    }
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
    // Load API key
    const storedApiKey = await getStoredApiKey();
    if (els.dashscopeApiKey) {
      els.dashscopeApiKey.value = storedApiKey;
      els.dashscopeApiKey.addEventListener('change', async () => {
        await saveApiKey(els.dashscopeApiKey.value);
      });
    }

    const res = await send({ type: 'get_settings' });
    if (!res?.ok) throw new Error(res?.error || 'get_settings_failed');
    applySettingsToUI(res.settings);

    const isAiClean = els.preset?.value === 'ai_clean';
    updateSettingsVisibility(isAiClean);

    if (isAiClean) {
      // For AI mode, apply immediately without preview
      await apply();
    } else {
      await preview();
    }
  } catch (e) {
    setStatus(String(e?.message || e), { error: true });
  } finally {
    setBusy(false);
  }
}

els.btnPreview.addEventListener('click', preview);
els.btnApply.addEventListener('click', apply);
els.btnUndo.addEventListener('click', undo);

// Back button - return to main menu
els.btnBack?.addEventListener('click', async () => {
  els.preset.value = 'balanced';
  updateSettingsVisibility(false);
  setStatus('Mode: balanced');
  await preview();
});

els.preset?.addEventListener('change', async () => {
  const name = String(els.preset.value || 'balanced');
  const isAiClean = name === 'ai_clean';

  if (!isAiClean) {
    applyPresetToUI(name);
  }

  updateSettingsVisibility(isAiClean);
  setStatus(`Mode: ${name}`);

  if (isAiClean) {
    // AI Clean mode - auto apply
    await apply();
  } else {
    await preview();
  }
});

init();
