// models.js — تعریف مدل‌های هر provider

// ⚠️ این لیست در تیر ۱۴۰۵ (ژوئیه ۲۰۲۶) به‌روزرسانی شد. مدل‌های هر provider مدام تغییر می‌کنند —
// اگر مدلی خطای 404 / decommissioned داد، به مستندات رسمی provider مراجعه کنید:
// OpenAI: platform.openai.com/docs/models | Gemini: ai.google.dev/gemini-api/docs/models | Groq: console.groq.com/docs/models
const MODELS = {
  // نکته مهم: این کلید API فقط برای OpenAI واقعی کار می‌کند مگر Base URL را روی یک پروکسی
  // OpenAI-compatible (مثل OpenRouter) تغییر دهید. مدل‌های Claude/Gemini مستقیماً از طریق
  // endpoint رسمی OpenAI قابل فراخوانی نیستند و از این لیست حذف شدند تا خطای گمراه‌کننده ندهند.
  openai: [
    {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      desc: 'پرچمدار فعلی OpenAI — بهترین دقت برای استدلال و تحلیل علمی پیچیده',
      badges: ['best'],
      recommended: true,
      provider: 'openai'
    },
    {
      id: 'gpt-5.4-mini',
      name: 'GPT-5.4 Mini',
      desc: 'سریع‌تر و ارزان‌تر — دقت خوب برای غربال‌گری حجم بالا',
      badges: ['fast'],
      provider: 'openai'
    },
    {
      id: 'gpt-5.4-nano',
      name: 'GPT-5.4 Nano',
      desc: 'سبک‌ترین و ارزان‌ترین — مناسب پیش‌غربال‌گری سریع',
      badges: ['fast'],
      provider: 'openai'
    }
  ],

  gemini: [
    {
      id: 'gemini-3.1-pro',
      name: 'Gemini 3.1 Pro',
      desc: 'قوی‌ترین مدل استدلال گوگل — Context یک میلیون توکن، مناسب تحلیل عمیق',
      badges: ['best'],
      recommended: true,
      provider: 'gemini'
    },
    {
      id: 'gemini-3.5-flash',
      name: 'Gemini 3.5 Flash',
      desc: 'کیفیت نزدیک به Pro با سرعت و هزینه بسیار پایین‌تر — عالی برای غربال‌گری دسته‌ای',
      badges: ['fast', 'best'],
      provider: 'gemini'
    },
    {
      id: 'gemini-3.1-flash-lite',
      name: 'Gemini 3.1 Flash-Lite',
      desc: 'ارزان‌ترین و سریع‌ترین مدل — برای حجم بسیار بالای مقالات',
      badges: ['fast', 'free'],
      provider: 'gemini'
    }
  ],

  groq: [
    {
      id: 'openai/gpt-oss-120b',
      name: 'GPT-OSS 120B (Groq)',
      desc: '⭐ جایگزین رسمی Llama 3.3 70B (deprecated) — دقیق، رایگان و مناسب سیستماتیک رویو',
      badges: ['best', 'free'],
      recommended: true,
      provider: 'groq'
    },
    {
      id: 'openai/gpt-oss-20b',
      name: 'GPT-OSS 20B (Groq)',
      desc: 'جایگزین رسمی Llama 3.1 8B Instant (deprecated) — بسیار سریع برای پیش‌غربال‌گری',
      badges: ['fast', 'free'],
      provider: 'groq'
    },
    {
      id: 'qwen/qwen3.6-27b',
      name: 'Qwen 3.6 27B (Groq)',
      desc: 'مدل استدلال — مناسب قضاوت دقیق معیارهای PICO در موارد مبهم',
      badges: ['free'],
      provider: 'groq'
    },
    {
      id: 'moonshotai/kimi-k2-instruct-0905',
      name: 'Kimi K2 Instruct',
      desc: 'Context window بزرگ — مناسب چکیده‌ها و متون طولانی',
      badges: ['free'],
      provider: 'groq'
    }
  ]
};

// وضعیت فعلی برنامه
const STATE = {
  activeProvider: null,
  activeModel: null,
  apiKeys: { openai: '', gemini: '', groq: '' },
  baseUrls: { openai: 'https://api.openai.com/v1' },
  tokenUsage: { input: 0, output: 0, total: 0, calls: 0 },
  tokenLog: [],
  papers: [],
  strategy: {
    keywords: [],
    parsed: null,
    pico: { population: '', intervention: '', comparison: '', outcome: '' },
    studyDesigns: [],
    inclusion: [],
    exclusion: [],
    yearFrom: null,
    yearTo: null,
    languages: ['English']
  },
  checklist: [
    { id: 1, text: 'Google Scholar با کلیدواژه‌های اصلی جستجو شد', done: false },
    { id: 2, text: 'PubMed / MEDLINE چک شد', done: false },
    { id: 3, text: 'Scopus بررسی شد', done: false },
    { id: 4, text: 'Web of Science چک شد', done: false },
    { id: 5, text: 'Semantic Scholar بررسی شد', done: false },
    { id: 6, text: 'ClinicalTrials.gov برای کارآزمایی‌های ثبت‌شده/منتشرنشده چک شد', done: false },
    { id: 7, text: 'چک Recall با چند مقاله شناخته‌شده انجام شد (استراتژی همه را پیدا کرد؟)', done: false },
    { id: 8, text: 'snowballing از منابع مقالات انجام شد', done: false },
    { id: 9, text: 'داپلیکیت‌ها با DOI حذف شدند', done: false },
    { id: 10, text: 'غربال عنوان/چکیده انجام شد (با بررسی انسانی موارد pending)', done: false },
    { id: 11, text: 'تاریخ جستجو ثبت شد', done: false }
  ],
  // ثبت دقیق منشأ رکوردها برای نمودار PRISMA واقعی (نه فقط شمارش نهایی بعد از dedup)
  prisma: {
    identifiedBySource: {}, // { 'PubMed': 42, 'OpenAlex': 118, ... } — مجموع تجمعی، قبل از حذف داپلیکیت
    identifiedOther: 0,     // مقالات افزوده‌شده دستی یا از طریق Import دسته‌ای (خارج از جستجوی خودکار)
    duplicatesRemoved: 0
  }
};

function renderModelList(provider) {
  const container = document.getElementById(`models${capitalize(provider)}`);
  if (!container) return;

  container.innerHTML = MODELS[provider].map(m => {
    const isSelected = STATE.activeProvider === provider && STATE.activeModel === m.id;
    const badgeHTML = m.badges.map(b => {
      const labels = { best: '⭐ بهترین', fast: '⚡ سریع', free: '🆓 رایگان' };
      const classes = { best: 'badge-best', fast: 'badge-fast', free: 'badge-free' };
      return `<span class="model-item-badge ${classes[b]}">${labels[b]}</span>`;
    }).join('') + (m.deprecated ? `<span class="model-item-badge badge-deprecated">⚠ روی سرور یافت نشد</span>` : '');

    return `
      <div class="model-item ${isSelected ? 'selected' : ''} ${m.deprecated ? 'is-deprecated' : ''}" onclick="selectModel('${provider}', '${m.id}')" title="${m.deprecated ? 'این مدل با آخرین لیست دریافت‌شده از سرور مطابقت نداشت — احتمالاً منسوخ شده یا نام آن تغییر کرده' : ''}">
        <div style="flex:1">
          <div class="model-item-name">${m.name}</div>
          <div class="model-item-desc">${m.desc}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${badgeHTML}</div>
      </div>
    `;
  }).join('');
}

// ===== بررسی زنده لیست مدل‌ها با provider (رفع قطعی مشکل "مطمئن نیستم منسوخ شده یا نه") =====
const LIVE_MODELS = { openai: null, gemini: null, groq: null };

function modelMatchesLive(modelId, liveIds) {
  return liveIds.some(id => id === modelId || id.startsWith(modelId) || modelId.startsWith(id));
}

async function refreshModelsFromServer(provider) {
  const keyInput = document.getElementById(`key${capitalize(provider)}`);
  const key = (keyInput?.value || STATE.apiKeys[provider] || '').trim();
  if (!key) { showToast('⚠ اول کلید API را در همین کارت وارد کنید', 'error'); return; }

  const btn = document.getElementById(`refreshModels${capitalize(provider)}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ در حال دریافت از سرور...'; }

  try {
    let liveIds = [];

    if (provider === 'gemini') {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      liveIds = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace('models/', ''));

    } else if (provider === 'groq') {
      const resp = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      liveIds = (data.data || []).map(m => m.id);

    } else if (provider === 'openai') {
      const baseUrl = (document.getElementById('baseOpenai')?.value || '').trim() || 'https://api.openai.com/v1';
      const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${key}` } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      liveIds = (data.data || []).map(m => m.id);
    }

    if (!liveIds.length) throw new Error('سرور لیست خالی برگرداند');

    LIVE_MODELS[provider] = liveIds;
    MODELS[provider].forEach(m => { m.deprecated = !modelMatchesLive(m.id, liveIds); });
    renderModelList(provider);

    const deprecatedCount = MODELS[provider].filter(m => m.deprecated).length;
    if (deprecatedCount > 0) {
      showToast(`⚠ ${deprecatedCount} مدل با سرور مطابقت نداشت (احتمالاً منسوخ) — با نشان قرمز مشخص شد`, 'error');
    } else {
      showToast(`✅ همه مدل‌های لیست‌شده روی سرور ${provider} فعال هستند`, 'success');
    }
  } catch (err) {
    showToast(`❌ عدم دریافت لیست از سرور: ${err.message} (ممکن است کلید نامعتبر یا CORS مسدود باشد)`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 بررسی زنده لیست مدل‌ها از سرور'; }
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function selectModel(provider, modelId) {
  STATE.activeProvider = provider;
  STATE.activeModel = modelId;

  // آپدیت UI
  document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
  const allItems = document.querySelectorAll(`#models${capitalize(provider)} .model-item`);
  allItems.forEach(el => {
    if (el.querySelector('.model-item-name').textContent ===
        MODELS[provider].find(m => m.id === modelId)?.name) {
      el.classList.add('selected');
    }
  });

  // provider card highlight
  document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`[data-provider="${provider}"]`)?.classList.add('selected');

  // topbar
  const model = MODELS[provider].find(m => m.id === modelId);
  document.getElementById('modelIndicatorText').textContent = model?.name || modelId;
  document.querySelector('.model-dot').classList.add('active');

  saveToStorage();
  showToast(`✅ مدل ${model?.name} انتخاب شد`);
  if (typeof renderOnboardingBanner === 'function') renderOnboardingBanner();
}

// ثبت تعداد رکورد شناسایی‌شده از یک منبع (قبل از حذف داپلیکیت) — برای نمودار PRISMA دقیق
function logPrismaIdentified(source, count) {
  if (!STATE.prisma) STATE.prisma = { identifiedBySource: {}, identifiedOther: 0, duplicatesRemoved: 0 };
  if (!count) return;
  if (source === 'other') {
    STATE.prisma.identifiedOther = (STATE.prisma.identifiedOther || 0) + count;
  } else {
    STATE.prisma.identifiedBySource[source] = (STATE.prisma.identifiedBySource[source] || 0) + count;
  }
}
function logPrismaDuplicates(count) {
  if (!STATE.prisma) STATE.prisma = { identifiedBySource: {}, identifiedOther: 0, duplicatesRemoved: 0 };
  STATE.prisma.duplicatesRemoved = (STATE.prisma.duplicatesRemoved || 0) + (count || 0);
}

function saveToStorage() {
  try {
    localStorage.setItem('sysreview_state', JSON.stringify({
      activeProvider: STATE.activeProvider,
      activeModel: STATE.activeModel,
      apiKeys: STATE.apiKeys,
      baseUrls: STATE.baseUrls,
      papers: STATE.papers,
      strategy: STATE.strategy,
      checklist: STATE.checklist,
      prisma: STATE.prisma,
      tokenUsage: STATE.tokenUsage
    }));
  } catch(e) {}
}

function loadFromStorage() {
  try {
    const saved = localStorage.getItem('sysreview_state');
    if (!saved) return;
    const data = JSON.parse(saved);
    Object.assign(STATE, data);

    // بازگرداندن کلیدها
    if (STATE.apiKeys.openai) document.getElementById('keyOpenai').value = STATE.apiKeys.openai;
    if (STATE.apiKeys.gemini) document.getElementById('keyGemini').value = STATE.apiKeys.gemini;
    if (STATE.apiKeys.groq) document.getElementById('keyGroq').value = STATE.apiKeys.groq;
    if (STATE.baseUrls.openai && STATE.baseUrls.openai !== 'https://api.openai.com/v1') {
      document.getElementById('baseOpenai').value = STATE.baseUrls.openai;
    }

    // بازگرداندن مدل
    if (STATE.activeProvider && STATE.activeModel) {
      selectModel(STATE.activeProvider, STATE.activeModel);
    }

    // بازگرداندن PICO
    if (STATE.strategy?.pico) {
      const p = STATE.strategy.pico;
      if (document.getElementById('picoP')) document.getElementById('picoP').value = p.population || '';
      if (document.getElementById('picoI')) document.getElementById('picoI').value = p.intervention || '';
      if (document.getElementById('picoC')) document.getElementById('picoC').value = p.comparison || '';
      if (document.getElementById('picoO')) document.getElementById('picoO').value = p.outcome || '';
    }
    if (STATE.strategy?.studyDesigns?.length) {
      document.querySelectorAll('#studyDesignChips .chip').forEach(c => {
        c.classList.toggle('active', STATE.strategy.studyDesigns.includes(c.textContent));
      });
    }
    if (STATE.strategy?.yearFrom) document.getElementById('yearFrom').value = STATE.strategy.yearFrom;
    if (STATE.strategy?.yearTo) document.getElementById('yearTo').value = STATE.strategy.yearTo;

    // آپدیت توکن
    updateTokenDisplay();
  } catch(e) {}
}
