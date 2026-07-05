// app.js — منطق اصلی برنامه

// ===== Init =====
function renderOnboardingBanner() {
  const el = document.getElementById('onboardingBanner');
  if (!el) return;
  if (STATE.activeProvider && STATE.activeModel) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="onboard-banner">
      <svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M9 6v3.5M9 12.3v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <div class="onboard-banner-text"><strong>برای شروع، یک مدل AI انتخاب کنید.</strong> با Groq (رایگان و سریع) یا Gemini (رایگان) شروع کنید — چند دقیقه طول می‌کشد.</div>
      <button class="btn-primary btn-sm" onclick="switchTab('settings')">رفتن به تنظیمات</button>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  initModelLists();
  initNavigation();
  loadFromStorage();
  renderUpdateTab();
  renderPapers();
  renderExport();
  renderTokenLog();
  updateUnscreenedCount();
  renderOnboardingBanner();
});

function initModelLists() {
  renderModelList('openai');
  renderModelList('gemini');
  renderModelList('groq');
}

// ===== Navigation =====
function initNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });

  document.querySelectorAll('.db-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.db-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

const tabTitles = {
  autosearch: 'جستجوی خودکار',
  strategy: 'استراتژی جستجو',
  screen: 'غربال‌گری AI',
  papers: 'مدیریت مقالات',
  update: 'آپدیت دوره‌ای',
  export: 'خروجی',
  settings: 'تنظیمات API'
};

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`tab-${name}`);
  if (panel) panel.classList.add('active');
  document.getElementById('topbarTitle').textContent = tabTitles[name] || name;

  if (name === 'screen') updateUnscreenedCount();
  if (name === 'papers') renderPapers();
  if (name === 'update') renderUpdateTab();
  if (name === 'export') renderExport();

  // بستن sidebar موبایل
  document.getElementById('sidebar').classList.remove('open');
}

// ===== Strategy =====
async function parseStrategy() {
  const text = document.getElementById('strategyInput').value.trim();
  if (!text) { showToast('⚠ متن سرچ استراتژی را وارد کنید', 'error'); return; }

  const activeDb = document.querySelector('.db-tab.active')?.dataset.db || 'custom';
  const resultEl = document.getElementById('parseResult');
  resultEl.style.display = 'block';
  resultEl.className = 'parse-result loading';
  resultEl.innerHTML = '<span class="spinner"></span> در حال تحلیل سرچ استراتژی با AI...';

  try {
    const raw = await aiParseStrategy(text, activeDb);
    let parsed;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('خروجی AI قابل تجزیه نبود. مدل دیگری امتحان کنید.');
    }

    STATE.strategy.parsed = parsed;
    STATE.strategy.keywords = [
      ...(parsed.keywords?.main || []).map(k => ({ value: k, type: 'main' })),
      ...(parsed.keywords?.synonyms || []).map(k => ({ value: k, type: 'synonym' })),
      ...(parsed.keywords?.mesh || []).map(k => ({ value: k, type: 'mesh' }))
    ];

    if (parsed.filters?.years?.from) document.getElementById('yearFrom').value = parsed.filters.years.from;
    if (parsed.filters?.years?.to) document.getElementById('yearTo').value = parsed.filters.years.to;

    resultEl.className = 'parse-result success';
    resultEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;color:var(--green)">
        ✅ <strong>سرچ استراتژی با موفقیت تحلیل شد</strong>
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:1.8">
        <div><strong>مفاهیم اصلی:</strong> ${(parsed.mainConcepts || []).join(' | ')}</div>
        <div><strong>ساختار Boolean:</strong> ${parsed.booleanStructure || 'نامشخص'}</div>
        <div><strong>پیچیدگی:</strong> ${parsed.complexity || 'نامشخص'}</div>
        ${parsed.notes ? `<div style="margin-top:6px;color:var(--amber)">⚠ ${parsed.notes}</div>` : ''}
      </div>
    `;

    renderParsedKeywords(parsed);
    saveToStorage();
    showToast('✅ سرچ استراتژی parse شد', 'success');
  } catch (err) {
    resultEl.className = 'parse-result error';
    resultEl.innerHTML = `<span style="color:var(--red)">❌ خطا: ${err.message}</span>`;
    showToast(`❌ ${err.message}`, 'error');
  }
}

function renderParsedKeywords(parsed) {
  const container = document.getElementById('parsedKeywords');
  const groups = document.getElementById('kwGroups');
  container.style.display = 'block';

  const sections = [
    { label: 'کلیدواژه اصلی', items: parsed.keywords?.main || [], type: 'main' },
    { label: 'MeSH Terms', items: parsed.keywords?.mesh || [], type: 'mesh' },
    { label: 'مترادف‌ها', items: parsed.keywords?.synonyms || [], type: 'synonym' },
    { label: 'فیلدهای جستجو', items: parsed.filters?.fields || [], type: '' },
    { label: 'نوع مطالعه', items: parsed.filters?.studyTypes || [], type: '' }
  ].filter(s => s.items.length);

  groups.innerHTML = sections.map(s => `
    <div class="kw-group">
      <div class="kw-group-label">${s.label}</div>
      <div class="kw-tags">
        ${s.items.map(k => `<span class="kw-tag ${s.type}">${k}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

function clearStrategy() {
  document.getElementById('strategyInput').value = '';
  document.getElementById('parseResult').style.display = 'none';
  document.getElementById('parsedKeywords').style.display = 'none';
}

function saveStrategy() {
  const pico = {
    population: document.getElementById('picoP').value.trim(),
    intervention: document.getElementById('picoI').value.trim(),
    comparison: document.getElementById('picoC').value.trim(),
    outcome: document.getElementById('picoO').value.trim()
  };
  const studyDesigns = Array.from(document.querySelectorAll('#studyDesignChips .chip.active')).map(c => c.textContent);

  // ساخت معیارهای ورود از PICO به‌صورت خودکار
  const picoInclusion = [];
  if (pico.population) picoInclusion.push({ type: 'population', value: pico.population });
  if (pico.intervention) picoInclusion.push({ type: 'intervention', value: pico.intervention });
  if (pico.comparison) picoInclusion.push({ type: 'comparison', value: pico.comparison });
  if (pico.outcome) picoInclusion.push({ type: 'outcome', value: pico.outcome });
  if (studyDesigns.length) picoInclusion.push({ type: 'study_type', value: studyDesigns.join(', ') });

  const customInclusion = getCriteriaRows('inclusionFields');
  const exclusion = getCriteriaRows('exclusionFields');
  const yearFrom = document.getElementById('yearFrom').value;
  const yearTo = document.getElementById('yearTo').value;
  const languages = Array.from(document.querySelectorAll('#tab-strategy .lang-chips .chip.active')).map(c => c.textContent);

  STATE.strategy = {
    ...STATE.strategy,
    pico,
    studyDesigns,
    inclusion: [...picoInclusion, ...customInclusion],
    exclusion,
    yearFrom: yearFrom ? parseInt(yearFrom) : null,
    yearTo: yearTo ? parseInt(yearTo) : null,
    languages
  };

  // اعتبارسنجی: هشدار اگر هیچ معیاری تعریف نشده
  if (!STATE.strategy.inclusion.length) {
    showToast('⚠ بدون معیار ورود، غربال‌گری AI دقیق نخواهد بود — حداقل P و I را پر کنید', 'error');
    return;
  }

  saveToStorage();
  showToast('✅ استراتژی ذخیره شد', 'success');
}

function getCriteriaRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .criteria-row`)).map(row => ({
    type: row.querySelector('.criteria-type')?.value || 'custom',
    value: row.querySelector('.criteria-value')?.value || ''
  })).filter(c => c.value.trim());
}

function addCriteria(type) {
  const containerId = type === 'inclusion' ? 'inclusionFields' : 'exclusionFields';
  const container = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = 'criteria-row';
  div.innerHTML = `
    <select class="criteria-type">
      <option value="study_type">نوع مطالعه</option>
      <option value="population">جمعیت</option>
      <option value="intervention">مداخله</option>
      <option value="outcome">پیامد</option>
      <option value="language">زبان</option>
      <option value="year">سال</option>
      <option value="custom">سفارشی</option>
    </select>
    <input type="text" class="criteria-value" placeholder="مقدار...">
    <button class="criteria-remove" onclick="removeCriteria(this)">×</button>
  `;
  container.appendChild(div);
}

function removeCriteria(btn) {
  btn.closest('.criteria-row').remove();
}

function toggleChip(el) {
  el.classList.toggle('active');
}

// ===== Screening =====
async function screenPaper() {
  const title = document.getElementById('screenTitle').value.trim();
  if (!title) { showToast('⚠ عنوان مقاله الزامی است', 'error'); return; }

  const paper = {
    title,
    abstract: document.getElementById('screenAbstract').value.trim(),
    author: document.getElementById('screenAuthor').value.trim(),
    doi: document.getElementById('screenDoi').value.trim(),
    year: document.getElementById('screenYear').value.trim(),
    journal: document.getElementById('screenJournal').value.trim()
  };

  // چک داپلیکیت (DOI دقیق یا شباهت بالای عنوان)
  const dupeCheck = checkDuplicate(paper, STATE.papers);
  if (dupeCheck.isDupe) {
    showToast(`⚠ داپلیکیت ${dupeCheck.isFuzzy ? 'احتمالی' : ''}: ${dupeCheck.reason}`, 'error');
    return;
  }

  const resultPlaceholder = document.getElementById('resultPlaceholder');
  const resultContent = document.getElementById('resultContent');
  resultPlaceholder.style.display = 'block';
  resultPlaceholder.innerHTML = '<span class="spinner" style="width:32px;height:32px;border-width:3px"></span><p style="margin-top:12px;color:var(--text3)">در حال غربال‌گری با AI...</p>';
  resultContent.style.display = 'none';

  try {
    const raw = await aiScreenPaper(paper, STATE.strategy);
    let result;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = applyConfidenceGate(JSON.parse(cleaned));
    } catch {
      throw new Error('پاسخ AI قابل تجزیه نبود');
    }

    paper.status = result.decision || 'pending';
    paper.aiReason = result.summary || '';
    paper.aiResult = result;
    paper.id = Date.now();
    paper.addedAt = new Date().toISOString();
    paper.screened = true;

    STATE.papers.push(paper);
    saveToStorage();
    updatePaperBadge();

    // نمایش نتیجه
    resultPlaceholder.style.display = 'none';
    resultContent.style.display = 'block';
    resultContent.innerHTML = buildResultHTML(result, paper);

    showToast(
      result.decision === 'included' ? '✅ مقاله شامل شد' :
      result.decision === 'excluded' ? '❌ مقاله خارج شد' :
      '⏳ نیاز به بررسی بیشتر',
      result.decision === 'included' ? 'success' : 'error'
    );

  } catch (err) {
    resultPlaceholder.innerHTML = `<div style="color:var(--red)">❌ ${err.message}</div>`;
    showToast(`❌ ${err.message}`, 'error');
  }
}

function buildResultHTML(result, paper) {
  const decisionMap = {
    included: { icon: '✅', text: 'شامل شده', class: 'included' },
    excluded: { icon: '❌', text: 'خارج شده', class: 'excluded' },
    pending: { icon: '⏳', text: 'نیاز به بررسی', class: 'pending' }
  };
  const d = decisionMap[result.decision] || decisionMap.pending;
  const confMap = { high: 'بالا', medium: 'متوسط', low: 'پایین' };

  const criteriaHTML = (result.criteriaCheck || []).map(c => {
    const icons = { pass: '✅', fail: '❌', unknown: '❓' };
    const cls = { pass: 'check-pass', fail: 'check-fail', unknown: 'check-unk' };
    return `
      <div class="criteria-check-item">
        <span class="${cls[c.status]}">${icons[c.status]}</span>
        <span><strong>${c.criterion}</strong> — ${c.reason}</span>
      </div>
    `;
  }).join('');

  const findingsHTML = (result.keyFindings || []).map(f =>
    `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:12px">• ${f}</div>`
  ).join('');

  const metaBits = [
    paper.author,
    paper.year,
    paper.journal,
    paper.doi ? `DOI: ${paper.doi}` : '',
    paper.source ? `منبع: ${paper.source}` : ''
  ].filter(Boolean).join(' • ');

  // خلاصه کامل مقاله (عنوان + چکیده + سایر مشخصات) — تا تصمیم‌گیرنده مجبور نباشد اسکرول کند
  const paperSummaryHTML = `
    <div class="paper-summary-box">
      <div class="ps-title">${paper.title}</div>
      ${metaBits ? `<div class="ps-meta">${metaBits}</div>` : ''}
      ${paper.abstract ? `<div class="ps-abstract">${paper.abstract}</div>` : `<div class="ps-abstract" style="opacity:.6">(چکیده‌ای ثبت نشده — تصمیم فقط بر اساس عنوان است)</div>`}
      ${paper.sourceUrl ? `<div style="margin-top:8px"><a href="${paper.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent2);font-size:12px">مشاهده مقاله اصلی ↗</a></div>` : ''}
    </div>
  `;

  return `
    ${paperSummaryHTML}
    <div class="verdict-box ${d.class}">
      <div class="verdict-icon">${d.icon}</div>
      <div class="verdict-text">
        <div class="verdict-decision">${d.text}</div>
        <div class="verdict-conf">اطمینان: ${confMap[result.confidence] || result.confidence} (${result.confidenceScore || '?'}%)</div>
        <div style="font-size:13px;margin-top:4px;color:var(--text2)">${result.summary || ''}</div>
      </div>
    </div>

    ${result.reasoning ? `
    <div class="reasoning-section">
      <div class="reasoning-title">استدلال AI:</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.7;background:var(--bg3);padding:10px;border-radius:6px">${result.reasoning}</div>
    </div>` : ''}

    ${criteriaHTML ? `
    <div class="criteria-check" style="margin-top:12px">
      <div class="criteria-check-title">بررسی معیارها:</div>
      ${criteriaHTML}
    </div>` : ''}

    ${findingsHTML ? `
    <div style="margin-top:12px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:6px">یافته‌های کلیدی:</div>
      ${findingsHTML}
    </div>` : ''}

    <div class="result-actions">
      <button class="btn-primary" style="flex:1" onclick="changeStatus(${paper.id}, 'included')">✅ تأیید ورود</button>
      <button class="btn-ghost" style="flex:1" onclick="changeStatus(${paper.id}, 'excluded')">❌ خروج</button>
      <button class="btn-ghost" onclick="changeStatus(${paper.id}, 'pending')">⏳ در بررسی</button>
    </div>
  `;
}

function addManual() {
  const title = document.getElementById('screenTitle').value.trim();
  if (!title) { showToast('⚠ عنوان الزامی است', 'error'); return; }

  const paper = {
    id: Date.now(),
    title,
    abstract: document.getElementById('screenAbstract').value.trim(),
    author: document.getElementById('screenAuthor').value.trim(),
    doi: document.getElementById('screenDoi').value.trim(),
    year: document.getElementById('screenYear').value.trim(),
    journal: document.getElementById('screenJournal').value.trim(),
    status: 'unscreened',
    screened: false,
    addedAt: new Date().toISOString()
  };

  const dupeCheck = checkDuplicate(paper, STATE.papers);
  if (dupeCheck.isDupe) {
    showToast(`⚠ داپلیکیت ${dupeCheck.isFuzzy ? 'احتمالی' : ''}: ${dupeCheck.reason}`, 'error');
    return;
  }

  STATE.papers.push(paper);
  logPrismaIdentified('other', 1);
  saveToStorage();
  updatePaperBadge();
  clearScreenForm();
  showToast('📄 مقاله افزوده شد');
}

function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('batchInput').value = e.target.result;
    parseBatch();
  };
  reader.readAsText(file);
}

function parseBatch() {
  const text = document.getElementById('batchInput').value.trim();
  if (!text) { showToast('⚠ ابتدا فایل را آپلود یا متن را paste کنید', 'error'); return; }

  const { format, papers: parsedPapers } = detectAndParse(text);
  const badge = document.getElementById('batchFormatBadge');
  badge.style.display = 'inline-block';
  badge.textContent = `فرمت تشخیص داده‌شده: ${format}`;

  if (!parsedPapers.length) {
    showToast('⚠ هیچ مقاله‌ای از این متن استخراج نشد — فرمت را بررسی کنید', 'error');
    return;
  }

  let added = 0, exactDupes = 0, fuzzyDupes = 0;

  parsedPapers.forEach(p => {
    const dupeCheck = checkDuplicate(p, STATE.papers);
    if (dupeCheck.isDupe) {
      if (dupeCheck.isFuzzy) fuzzyDupes++; else exactDupes++;
      return;
    }
    STATE.papers.push({
      id: Date.now() + Math.random(),
      title: p.title,
      author: p.author || '',
      year: p.year || '',
      doi: p.doi || '',
      journal: p.journal || '',
      abstract: p.abstract || '',
      status: 'unscreened',
      screened: false,
      addedAt: new Date().toISOString()
    });
    added++;
  });

  logPrismaIdentified('other', parsedPapers.length);
  logPrismaDuplicates(exactDupes + fuzzyDupes);
  saveToStorage();
  updatePaperBadge();
  document.getElementById('batchInput').value = '';

  let msg = `✅ ${added} مقاله وارد شد`;
  if (exactDupes) msg += ` | ${exactDupes} داپلیکیت دقیق (DOI) نادیده گرفته شد`;
  if (fuzzyDupes) msg += ` | ${fuzzyDupes} داپلیکیت احتمالی (شباهت عنوان) نادیده گرفته شد`;
  showToast(msg, 'success');
  updateUnscreenedCount();
  if (document.getElementById('tab-papers').classList.contains('active')) renderPapers();
}

async function batchScreenAll() {
  if (!STATE.activeProvider || !STATE.activeModel) {
    showToast('⚠ ابتدا از تنظیمات API یک مدل انتخاب کنید', 'error');
    switchTab('settings');
    return;
  }
  if (!STATE.strategy.inclusion.length) {
    showToast('⚠ ابتدا معیارهای ورود (PICO) را در تب استراتژی ذخیره کنید', 'error');
    switchTab('strategy');
    return;
  }

  const unscreened = STATE.papers.filter(p => p.status === 'unscreened');
  if (!unscreened.length) { showToast('✅ همه مقالات قبلاً غربال شده‌اند', 'success'); return; }

  const btn = document.getElementById('batchScreenBtn');
  const progressWrap = document.getElementById('batchProgress');
  const fill = document.getElementById('batchProgressFill');
  const text = document.getElementById('batchProgressText');

  btn.disabled = true;
  btn.textContent = 'در حال غربال‌گری...';
  progressWrap.style.display = 'block';

  const estimatedSec = Math.round((unscreened.length * (FREE_TIER_DELAY_MS[STATE.activeProvider] || 500)) / 1000);
  text.textContent = `شروع — تخمین زمان: حدود ${estimatedSec} ثانیه`;

  let includedCount = 0, excludedCount = 0, pendingCount = 0, errorCount = 0;

  await screenPapersBatch(
    unscreened,
    STATE.strategy,
    (current, total, title) => {
      fill.style.width = `${Math.round((current / total) * 100)}%`;
      text.textContent = `${current} از ${total} — ${title.slice(0, 50)}${title.length > 50 ? '…' : ''}`;
    },
    (paper, res) => {
      if (res.error) errorCount++;
      else if (paper.status === 'included') includedCount++;
      else if (paper.status === 'excluded') excludedCount++;
      else pendingCount++;
      saveToStorage();
      updatePaperBadge();
      updateUnscreenedCount();
      if (document.getElementById('tab-papers').classList.contains('active')) renderPapers();
    }
  );

  btn.disabled = false;
  btn.textContent = 'شروع غربال‌گری دسته‌ای';
  text.textContent = `✅ تمام شد — شامل: ${includedCount} | خارج: ${excludedCount} | در بررسی: ${pendingCount}${errorCount ? ` | خطا: ${errorCount}` : ''}`;
  showToast(`✅ غربال‌گری دسته‌ای تمام شد (${unscreened.length} مقاله)`, 'success');
  renderPapers();
}

function updateUnscreenedCount() {
  const n = STATE.papers.filter(p => p.status === 'unscreened').length;
  const el = document.getElementById('unscreenedCount');
  if (el) el.textContent = `${n.toLocaleString('fa-IR')} مقاله در انتظار غربال‌گری`;
}

function clearScreenForm() {
  ['screenTitle','screenAbstract','screenAuthor','screenDoi','screenYear','screenJournal'].forEach(id => {
    document.getElementById(id).value = '';
  });
}

// ===== Papers List =====
function renderPapers() {
  const filter = document.getElementById('paperSearch')?.value?.toLowerCase() || '';
  const statusFilter = document.getElementById('paperFilter')?.value || 'all';

  let filtered = STATE.papers.filter(p => {
    const matchText = (p.title + p.author + p.doi + p.journal).toLowerCase().includes(filter);
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchText && matchStatus;
  });

  const tbody = document.getElementById('papersBody');
  const empty = document.getElementById('papersEmpty');

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = filtered.map(p => `
      <tr>
        <td class="paper-title-cell">
          <div class="title" title="کلیک برای مشاهده جزئیات کامل" style="cursor:pointer" onclick="openPaperDetail(${p.id})">${p.title}${p.source ? `<span class="source-badge">${p.source}</span>` : ''}</div>
          ${p.doi ? `<div class="doi">${p.doi}</div>` : ''}
        </td>
        <td>${p.author || '—'}</td>
        <td>${p.year || '—'}</td>
        <td><span class="status-badge ${p.status}">${statusLabel(p.status)}</span></td>
        <td><div class="ai-reason" title="${p.aiReason || ''}">${p.aiReason || '—'}</div></td>
        <td>
          <div class="action-btns">
            <button class="action-btn" onclick="openPaperDetail(${p.id})" title="جزئیات کامل (عنوان، چکیده، تاریخ و استدلال AI)">👁</button>
            <button class="action-btn" onclick="changeStatus(${p.id}, 'included')" title="شامل">✅</button>
            <button class="action-btn" onclick="changeStatus(${p.id}, 'excluded')" title="خارج">❌</button>
            <button class="action-btn" onclick="changeStatus(${p.id}, 'pending')" title="در بررسی">⏳</button>
            <button class="action-btn del" onclick="deletePaper(${p.id})" title="حذف">🗑</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  renderPaperStats();
  updatePaperBadge();
}

function statusLabel(s) {
  return { included: 'شامل', excluded: 'خارج', pending: 'در بررسی', unscreened: 'غربال نشده' }[s] || s;
}

function renderPaperStats() {
  const total = STATE.papers.length;
  const included = STATE.papers.filter(p => p.status === 'included').length;
  const excluded = STATE.papers.filter(p => p.status === 'excluded').length;
  const pending = STATE.papers.filter(p => p.status === 'pending').length;
  const unscreened = STATE.papers.filter(p => p.status === 'unscreened').length;

  document.getElementById('paperStats').innerHTML = `
    <div class="stat-pill">کل: <span>${total}</span></div>
    <div class="stat-pill" style="color:var(--green)">شامل: <span>${included}</span></div>
    <div class="stat-pill" style="color:var(--red)">خارج: <span>${excluded}</span></div>
    <div class="stat-pill" style="color:var(--amber)">در بررسی: <span>${pending}</span></div>
    <div class="stat-pill" style="color:var(--text3)">غربال نشده: <span>${unscreened}</span></div>
  `;
}

function changeStatus(id, status) {
  const paper = STATE.papers.find(p => p.id === id);
  if (paper) {
    paper.status = status;
    saveToStorage();
    renderPapers();
    showToast(`✅ وضعیت به "${statusLabel(status)}" تغییر یافت`);
  }
}

function deletePaper(id) {
  if (!confirm('این مقاله حذف شود؟')) return;
  STATE.papers = STATE.papers.filter(p => p.id !== id);
  saveToStorage();
  renderPapers();
}

function updatePaperBadge() {
  const badge = document.getElementById('papersBadge');
  const n = STATE.papers.length;
  badge.style.display = n > 0 ? 'inline-block' : 'none';
  badge.textContent = n;
  updateUnscreenedCount();
}

// ===== جزئیات کامل مقاله (برای تصمیم دستی دقیق) =====
function openPaperDetail(id) {
  const p = STATE.papers.find(x => x.id === id);
  if (!p) return;

  const r = p.aiResult;
  const confMap = { high: 'بالا', medium: 'متوسط', low: 'پایین' };
  const picoLabels = { population: 'جمعیت (P)', intervention: 'مداخله (I)', comparison: 'مقایسه (C)', outcome: 'پیامد (O)' };
  const matchLabels = { match: '✅ مطابق', mismatch: '❌ نامطابق', unclear: '❓ نامشخص', 'n/a': '— ندارد' };

  const metaChips = [
    p.author ? `نویسنده: ${p.author}` : '',
    p.year ? `سال: ${p.year}` : '',
    p.journal ? `مجله: ${p.journal}` : '',
    p.doi ? `DOI: ${p.doi}` : '',
    p.source ? `منبع: ${p.source}` : '',
    `وضعیت: ${statusLabel(p.status)}`
  ].filter(Boolean).map(t => `<span>${t}</span>`).join('');

  const picoHTML = r?.picoMatch ? `
    <div class="modal-section">
      <div class="modal-section-title">تطابق PICO</div>
      ${Object.entries(r.picoMatch).map(([k, v]) => `<div style="font-size:12.5px;padding:3px 0">${picoLabels[k] || k}: ${matchLabels[v] || v}</div>`).join('')}
    </div>` : '';

  const criteriaHTML = (r?.criteriaCheck || []).map(c => {
    const icons = { pass: '✅', fail: '❌', unknown: '❓' };
    return `<div style="font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--border)">${icons[c.status] || '❓'} <strong>${c.criterion}</strong> — ${c.reason}</div>`;
  }).join('');

  document.getElementById('paperDetailContent').innerHTML = `
    <div class="modal-title">${p.title}</div>
    <div class="modal-meta-row">${metaChips}</div>

    <div class="modal-section">
      <div class="modal-section-title">چکیده</div>
      <div class="modal-abstract">${p.abstract || '(چکیده‌ای برای این مقاله ثبت نشده)'}</div>
    </div>

    ${p.sourceUrl ? `<div class="modal-section"><a href="${p.sourceUrl}" target="_blank" rel="noopener" style="color:var(--accent2);font-size:13px">مشاهده مقاله اصلی ↗</a></div>` : ''}

    ${r ? `
    <div class="modal-section">
      <div class="modal-section-title">نتیجه غربال‌گری AI</div>
      <div style="font-size:13px">تصمیم: <strong>${statusLabel(r.decision)}</strong> — اطمینان: ${confMap[r.confidence] || r.confidence || '—'} (${r.confidenceScore ?? '?'}%)</div>
      ${r.summary ? `<div style="font-size:12.5px;color:var(--text2);margin-top:4px">${r.summary}</div>` : ''}
    </div>
    ${r.reasoning ? `
    <div class="modal-section">
      <div class="modal-section-title">استدلال کامل AI</div>
      <div style="font-size:12.5px;color:var(--text2);line-height:1.8;background:var(--bg3);padding:10px;border-radius:8px">${r.reasoning}</div>
    </div>` : ''}
    ${picoHTML}
    ${criteriaHTML ? `<div class="modal-section"><div class="modal-section-title">بررسی معیارها</div>${criteriaHTML}</div>` : ''}
    ` : `<div class="modal-section" style="color:var(--text3);font-size:12.5px">این مقاله هنوز با AI غربال نشده است.</div>`}

    <div class="result-actions" style="margin-top:16px">
      <button class="btn-primary" style="flex:1" onclick="changeStatus(${p.id}, 'included'); closePaperDetail();">✅ تأیید ورود</button>
      <button class="btn-ghost" style="flex:1" onclick="changeStatus(${p.id}, 'excluded'); closePaperDetail();">❌ خروج</button>
      <button class="btn-ghost" onclick="changeStatus(${p.id}, 'pending'); closePaperDetail();">⏳ در بررسی</button>
    </div>
  `;

  document.getElementById('paperDetailModal').style.display = 'flex';
}

function closePaperDetail() {
  document.getElementById('paperDetailModal').style.display = 'none';
}

// ===== Update Tab =====
function renderUpdateTab() {
  renderSearchLinks();
  renderChecklist();
  const saved = localStorage.getItem('lastSearchDate');
  if (saved) {
    document.getElementById('lastSearchDate').value = saved;
    updateLastSearchInfo(saved);
  }
}

function setToday() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('lastSearchDate').value = today;
  localStorage.setItem('lastSearchDate', today);
  updateLastSearchInfo(today);
  showToast('✅ تاریخ امروز ثبت شد', 'success');
}

document.addEventListener('change', e => {
  if (e.target.id === 'lastSearchDate') {
    localStorage.setItem('lastSearchDate', e.target.value);
    updateLastSearchInfo(e.target.value);
  }
});

function updateLastSearchInfo(dateStr) {
  if (!dateStr) return;
  const date = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  const info = document.getElementById('lastSearchInfo');
  info.innerHTML = days === 0 ? '✅ امروز آپدیت شده' :
    days < 30 ? `⚠ ${days} روز پیش جستجو شده` :
    `❌ ${days} روز پیش — نیاز به آپدیت دارد`;
  info.style.color = days === 0 ? 'var(--green)' : days < 30 ? 'var(--amber)' : 'var(--red)';
}

function renderSearchLinks() {
  const kws = STATE.strategy.keywords.length > 0
    ? STATE.strategy.keywords.slice(0, 5).map(k => k.value)
    : ['your', 'search', 'terms'];

  const query = encodeURIComponent(kws.join(' OR '));
  const yearFrom = STATE.strategy.yearFrom || '';

  const links = [
    { name: 'Google Scholar', free: false, url: `https://scholar.google.com/scholar?q=${query}${yearFrom ? '&as_ylo='+yearFrom : ''}` },
    { name: 'PubMed / MEDLINE', free: true, url: `https://pubmed.ncbi.nlm.nih.gov/?term=${query}${yearFrom ? '&filter=years.'+yearFrom+'-3000' : ''}` },
    { name: 'Semantic Scholar', free: true, url: `https://www.semanticscholar.org/search?q=${kws.join('+')}&sort=Relevance` },
    { name: 'Europe PMC', free: true, url: `https://europepmc.org/search?query=${query}${yearFrom ? '&dateFrom='+yearFrom+'-01-01' : ''}` },
    { name: 'CORE (Open Access)', free: true, url: `https://core.ac.uk/search?q=${query}` },
    { name: 'OpenAlex', free: true, url: `https://openalex.org/works?search=${query}` }
  ];

  document.getElementById('searchLinks').innerHTML = links.map(l => `
    <div class="search-link-item">
      <div class="search-link-name">${l.name}</div>
      ${l.free ? '<span class="search-link-free">رایگان</span>' : ''}
      <a href="${l.url}" target="_blank" class="search-link-a">باز کن ↗</a>
    </div>
  `).join('');
}

function renderChecklist() {
  const done = STATE.checklist.filter(c => c.done).length;
  const pct = Math.round(done / STATE.checklist.length * 100);

  document.getElementById('updateChecklist').innerHTML = `
    <div style="margin-bottom:8px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:4px">${done}/${STATE.checklist.length} مرحله — ${pct}%</div>
      <div style="height:4px;background:var(--bg3);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s;border-radius:2px"></div>
      </div>
    </div>
    ${STATE.checklist.map(c => `
      <div class="checklist-item ${c.done ? 'done' : ''}" onclick="toggleChecklistItem(${c.id})">
        <input type="checkbox" ${c.done ? 'checked' : ''} onclick="toggleChecklistItem(${c.id});event.stopPropagation()">
        ${c.text}
      </div>
    `).join('')}
  `;
}

function toggleChecklistItem(id) {
  const item = STATE.checklist.find(c => c.id === id);
  if (item) { item.done = !item.done; saveToStorage(); renderChecklist(); }
}

// ===== Export =====
function renderExport() {
  renderPrismaFlow();
  renderStrategyReport();
}

function renderPrismaFlow() {
  const total = STATE.papers.length;
  const included = STATE.papers.filter(p => p.status === 'included').length;
  const excluded = STATE.papers.filter(p => p.status === 'excluded').length;
  const pending = STATE.papers.filter(p => p.status === 'pending').length;
  const unscreened = STATE.papers.filter(p => p.status === 'unscreened').length;
  const screened = total - unscreened;

  const prisma = STATE.prisma || { identifiedBySource: {}, identifiedOther: 0, duplicatesRemoved: 0 };
  const bySource = Object.entries(prisma.identifiedBySource || {});
  const identifiedRaw = bySource.reduce((s, [, c]) => s + c, 0) + (prisma.identifiedOther || 0);
  const duplicatesRemoved = prisma.duplicatesRemoved || 0;

  const svg = buildPrismaSVG({
    bySource, identifiedOther: prisma.identifiedOther || 0, identifiedRaw, duplicatesRemoved,
    total, screened, excluded, included, pending
  });
  document.getElementById('prismaFlow').innerHTML = svg;
}

function buildPrismaSVG({ bySource, identifiedOther, identifiedRaw, duplicatesRemoved, total, screened, excluded, included, pending }) {
  const W = 400, boxW = 320, x = (W - boxW) / 2;
  const sideBoxW = 150;
  const fullW = W + sideBoxW + 24;
  let y = 16;
  const boxes = [];
  const arrows = [];

  function box(label, value, color, sub, extraH) {
    const h = 56 + (extraH || 0);
    boxes.push(`
      <rect x="${x}" y="${y}" width="${boxW}" height="${h}" rx="8" fill="var(--bg3)" stroke="${color}" stroke-width="1.6"/>
      <text x="${x + 14}" y="${y + 20}" font-size="11.5" fill="var(--text2)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">${label}</text>
      <text x="${x + 14}" y="${y + 41}" font-size="17" font-weight="700" fill="var(--text)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">${value}</text>
      ${sub ? `<text x="${x + 14}" y="${y + h - 8}" font-size="10.5" fill="var(--text3)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">${sub}</text>` : ''}
    `);
    const startY = y;
    y += h;
    return startY;
  }

  function arrow(gap) {
    const g = gap || 34;
    arrows.push(`<line x1="${W/2}" y1="${y}" x2="${W/2}" y2="${y + g - 6}" stroke="var(--border2)" stroke-width="1.6" marker-end="url(#arrowhead)"/>`);
    y += g;
  }

  // === مرحله شناسایی — تفکیک واقعی به‌ازای هر دیتابیس (نه یک عدد جعلی) ===
  const sourceLines = bySource.map(([name, count]) => `${name}: ${count}`);
  if (identifiedOther) sourceLines.push(`دستی/Import: ${identifiedOther}`);
  const sourceSub = sourceLines.length ? sourceLines.join(' • ') : 'هنوز جستجویی ثبت نشده';
  box('شناسایی (Identification) — مجموع خام از همه منابع', identifiedRaw, 'var(--accent)', sourceSub, sourceLines.length ? 18 : 0);
  arrow();

  const dedupY = y;
  box('منحصر‌به‌فرد پس از حذف داپلیکیت', total, 'var(--accent)', `${duplicatesRemoved} داپلیکیت حذف شد`);
  arrow();

  const screeningY = y;
  box('غربال‌گری عنوان/چکیده انجام‌شده', screened, 'var(--text3)', `از ${total} رکورد منحصربه‌فرد`);
  arrow();
  box('شامل نهایی (Included)', included, 'var(--green)', 'مقاله در رویو نهایی');

  const totalH = y + 10;
  const sideBoxX = x + boxW + 24;

  const dupSide = duplicatesRemoved ? `
    <line x1="${x + boxW}" y1="${dedupY + 28}" x2="${sideBoxX}" y2="${dedupY + 28}" stroke="var(--amber)" stroke-width="1.4" marker-end="url(#arrowhead-amber)"/>
    <rect x="${sideBoxX}" y="${dedupY}" width="${sideBoxW}" height="56" rx="8" fill="var(--amber-bg)" stroke="var(--amber)" stroke-width="1.4"/>
    <text x="${sideBoxX + 10}" y="${dedupY + 21}" font-size="10.5" fill="var(--amber)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">داپلیکیت حذف‌شده</text>
    <text x="${sideBoxX + 10}" y="${dedupY + 42}" font-size="16" font-weight="700" fill="var(--amber)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">${duplicatesRemoved}</text>
  ` : '';

  const sideExclude = `
    <line x1="${x + boxW}" y1="${screeningY + 28}" x2="${sideBoxX}" y2="${screeningY + 28}" stroke="var(--red)" stroke-width="1.4" marker-end="url(#arrowhead-red)"/>
    <rect x="${sideBoxX}" y="${screeningY}" width="${sideBoxW}" height="56" rx="8" fill="var(--red-bg)" stroke="var(--red)" stroke-width="1.4"/>
    <text x="${sideBoxX + 10}" y="${screeningY + 21}" font-size="10.5" fill="var(--red)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">خارج شده (Excluded)</text>
    <text x="${sideBoxX + 10}" y="${screeningY + 42}" font-size="16" font-weight="700" fill="var(--red)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">${excluded}</text>
  `;

  const pendingBadge = pending ? `
    <rect x="${sideBoxX}" y="${screeningY + 66}" width="${sideBoxW}" height="56" rx="8" fill="var(--amber-bg)" stroke="var(--amber)" stroke-width="1.4"/>
    <text x="${sideBoxX + 10}" y="${screeningY + 87}" font-size="10.5" fill="var(--amber)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">در انتظار بررسی</text>
    <text x="${sideBoxX + 10}" y="${screeningY + 108}" font-size="16" font-weight="700" fill="var(--amber)" font-family="Vazirmatn, sans-serif" text-anchor="start" direction="ltr">${pending}</text>
  ` : '';

  return `
    <svg viewBox="0 0 ${fullW} ${totalH}" xmlns="http://www.w3.org/2000/svg" direction="ltr" style="width:100%;height:auto;direction:ltr" id="prismaSvgEl">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--border2)"/></marker>
        <marker id="arrowhead-red" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--red)"/></marker>
        <marker id="arrowhead-amber" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--amber)"/></marker>
      </defs>
      ${boxes.join('')}
      ${arrows.join('')}
      ${dupSide}
      ${sideExclude}
      ${pendingBadge}
    </svg>
  `;
}

function downloadPrismaSVG() {
  const svgEl = document.getElementById('prismaSvgEl');
  if (!svgEl) { showToast('⚠ ابتدا گزارش را تولید کنید', 'error'); return; }
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // جایگزینی CSS var با رنگ ثابت برای سازگاری بهتر فایل خروجی
  const colorMap = { '--bg3':'#1c1c26','--text2':'#9090a8','--text':'#e8e8f0','--text3':'#5a5a72','--accent':'#6366f1','--border2':'#2a2a38','--green':'#22c55e','--green-bg':'#0f2318','--red':'#ef4444','--red-bg':'#2a1414','--amber':'#f59e0b','--amber-bg':'#2a2110' };
  let svgString = clone.outerHTML;
  Object.entries(colorMap).forEach(([k,v]) => { svgString = svgString.replaceAll(`var(${k})`, v); });
  svgString = `<svg xmlns="http://www.w3.org/2000/svg"${svgString.slice(4)}`;

  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'prisma_flow_diagram.svg';
  a.click();
  showToast('✅ نمودار PRISMA دانلود شد', 'success');
}

function renderStrategyReport() {
  const s = STATE.strategy;
  const kws = s.keywords.map(k => k.value).join(', ') || 'تعریف نشده';
  const inc = s.inclusion.map(c => `- [${c.type}] ${c.value}`).join('\n') || 'تعریف نشده';
  const exc = s.exclusion.map(c => `- [${c.type}] ${c.value}`).join('\n') || 'تعریف نشده';

  const prisma = STATE.prisma || { identifiedBySource: {}, identifiedOther: 0, duplicatesRemoved: 0 };
  const dbLines = Object.entries(prisma.identifiedBySource || {}).map(([name, count]) => `- ${name}: ${count} رکورد`);
  if (prisma.identifiedOther) dbLines.push(`- افزوده‌شده دستی / Import: ${prisma.identifiedOther} رکورد`);
  const dbSection = dbLines.length ? dbLines.join('\n') : '(هنوز جستجوی خودکاری ثبت نشده)';

  document.getElementById('strategyReport').textContent =
`Search Strategy Report
Generated: ${new Date().toLocaleDateString('fa-IR')}

=== Keywords ===
${kws}

=== Databases Actually Searched (real counts, logged automatically) ===
${dbSection}
Duplicates removed: ${prisma.duplicatesRemoved || 0}

Note: Scopus / Web of Science / Embase require institutional API keys and were not
queried automatically by this tool (browser-side CORS restrictions) — check the
"آپدیت دوره‌ای" tab for ready-made manual search links for these databases.

=== Date Range ===
${s.yearFrom || 'no limit'} to ${s.yearTo || 'present'}

=== Languages ===
${(s.languages || ['English']).join(', ')}

=== Inclusion Criteria ===
${inc}

=== Exclusion Criteria ===
${exc}

=== Results ===
Total unique records screened: ${STATE.papers.length}
Included: ${STATE.papers.filter(p=>p.status==='included').length}
Excluded: ${STATE.papers.filter(p=>p.status==='excluded').length}
Pending: ${STATE.papers.filter(p=>p.status==='pending').length}`;
}

function copyReport() {
  const text = document.getElementById('strategyReport').textContent;
  const prisma = document.getElementById('prismaFlow').innerText;
  navigator.clipboard.writeText(`${prisma}\n\n${text}`).then(() => {
    showToast('✅ کپی شد', 'success');
  });
}

function copyStrategy() {
  navigator.clipboard.writeText(document.getElementById('strategyReport').textContent).then(() => {
    showToast('✅ استراتژی کپی شد', 'success');
  });
}

function exportCSV() {
  if (!STATE.papers.length) { showToast('⚠ مقاله‌ای وجود ندارد', 'error'); return; }

  const header = ['عنوان', 'نویسنده', 'سال', 'مجله', 'DOI', 'وضعیت', 'دلیل AI', 'تاریخ افزودن'];
  const rows = STATE.papers.map(p => [
    p.title, p.author, p.year, p.journal, p.doi,
    statusLabel(p.status), p.aiReason || '',
    p.addedAt ? new Date(p.addedAt).toLocaleDateString('fa-IR') : ''
  ]);

  const csv = [header, ...rows]
    .map(r => r.map(c => `"${(c || '').toString().replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `systematic_review_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  showToast('✅ فایل CSV دانلود شد', 'success');
}

function exportRIS() {
  if (!STATE.papers.length) { showToast('⚠ مقاله‌ای وجود ندارد', 'error'); return; }
  const ris = papersToRIS(STATE.papers);
  const blob = new Blob([ris], { type: 'application/x-research-info-systems' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `systematic_review_${new Date().toISOString().split('T')[0]}.ris`;
  a.click();
  showToast('✅ فایل RIS دانلود شد — قابل وارد کردن در Zotero/EndNote', 'success');
}

function exportBibTeX() {
  if (!STATE.papers.length) { showToast('⚠ مقاله‌ای وجود ندارد', 'error'); return; }
  const bib = papersToBibTeX(STATE.papers);
  const blob = new Blob([bib], { type: 'application/x-bibtex' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `systematic_review_${new Date().toISOString().split('T')[0]}.bib`;
  a.click();
  showToast('✅ فایل BibTeX دانلود شد', 'success');
}

// ===== خروجی Excel واقعی (چند شیت: همه مقالات + شامل‌شده‌ها + آمار PRISMA) با SheetJS =====
function exportExcel() {
  if (!STATE.papers.length) { showToast('⚠ مقاله‌ای وجود ندارد', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('❌ کتابخانه Excel لود نشد — اتصال اینترنت را چک کنید', 'error'); return; }

  const rowOf = p => ({
    'عنوان': p.title || '',
    'نویسنده': p.author || '',
    'سال': p.year || '',
    'مجله': p.journal || '',
    'DOI': p.doi || '',
    'منبع': p.source || '',
    'وضعیت': statusLabel(p.status),
    'اطمینان AI': p.aiResult?.confidence ? `${p.aiResult.confidence} (${p.aiResult.confidenceScore ?? '?'}%)` : '',
    'خلاصه دلیل AI': p.aiReason || '',
    'استدلال کامل AI': p.aiResult?.reasoning || '',
    'چکیده': p.abstract || '',
    'لینک': p.sourceUrl || '',
    'تاریخ افزوده‌شدن': p.addedAt ? new Date(p.addedAt).toLocaleDateString('fa-IR') : ''
  });

  const wb = XLSX.utils.book_new();

  // شیت ۱: همه مقالات
  const wsAll = XLSX.utils.json_to_sheet(STATE.papers.map(rowOf));
  wsAll['!cols'] = [{ wch: 45 }, { wch: 18 }, { wch: 8 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 35 }, { wch: 45 }, { wch: 50 }, { wch: 25 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsAll, 'همه مقالات');

  // شیت‌های تفکیکی بر اساس وضعیت
  ['included', 'excluded', 'pending'].forEach(status => {
    const rows = STATE.papers.filter(p => p.status === status).map(rowOf);
    if (rows.length) {
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = wsAll['!cols'];
      XLSX.utils.book_append_sheet(wb, ws, statusLabel(status));
    }
  });

  // شیت آمار PRISMA
  const prisma = STATE.prisma || { identifiedBySource: {}, identifiedOther: 0, duplicatesRemoved: 0 };
  const prismaRows = Object.entries(prisma.identifiedBySource || {}).map(([source, count]) => ({ 'منبع': source, 'تعداد شناسایی‌شده': count }));
  if (prisma.identifiedOther) prismaRows.push({ 'منبع': 'دستی / Import', 'تعداد شناسایی‌شده': prisma.identifiedOther });
  prismaRows.push({ 'منبع': '— جمع کل شناسایی‌شده —', 'تعداد شناسایی‌شده': prismaRows.reduce((s, r) => s + r['تعداد شناسایی‌شده'], 0) });
  prismaRows.push({ 'منبع': 'داپلیکیت حذف‌شده', 'تعداد شناسایی‌شده': prisma.duplicatesRemoved || 0 });
  prismaRows.push({ 'منبع': 'منحصر‌به‌فرد برای غربال‌گری', 'تعداد شناسایی‌شده': STATE.papers.length });
  prismaRows.push({ 'منبع': 'شامل نهایی', 'تعداد شناسایی‌شده': STATE.papers.filter(p => p.status === 'included').length });
  prismaRows.push({ 'منبع': 'خارج‌شده', 'تعداد شناسایی‌شده': STATE.papers.filter(p => p.status === 'excluded').length });
  const wsPrisma = XLSX.utils.json_to_sheet(prismaRows);
  wsPrisma['!cols'] = [{ wch: 32 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsPrisma, 'آمار PRISMA');

  XLSX.writeFile(wb, `systematic_review_${new Date().toISOString().split('T')[0]}.xlsx`);
  showToast('✅ فایل Excel با چند شیت دانلود شد', 'success');
}

// ===== Toast =====
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.className = 'toast', 3000);
}
