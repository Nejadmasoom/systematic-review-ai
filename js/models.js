// models.js — تعریف مدل‌های هر provider

const MODELS = {
  openai: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      desc: 'بهترین مدل OpenAI برای تحلیل علمی',
      badges: ['best'],
      recommended: true,
      provider: 'openai'
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      desc: 'سریع‌تر و ارزان‌تر، دقت خوب',
      badges: ['fast'],
      provider: 'openai'
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      desc: 'Context window بزرگ ۱۲۸K',
      badges: [],
      provider: 'openai'
    },
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      desc: 'از طریق OpenAI API — عالی برای رویو',
      badges: ['best'],
      recommended: true,
      provider: 'openai'
    },
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6',
      desc: 'قوی‌ترین کلاد — تحلیل عمیق علمی',
      badges: ['best'],
      provider: 'openai'
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      desc: 'سریع و مقرون‌به‌صرفه',
      badges: ['fast'],
      provider: 'openai'
    },
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      desc: 'از طریق OpenAI API',
      badges: ['fast'],
      provider: 'openai'
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      desc: 'Context بزرگ ۱M token',
      badges: [],
      provider: 'openai'
    }
  ],

  gemini: [
    {
      id: 'gemini-2.0-flash-exp',
      name: 'Gemini 2.0 Flash',
      desc: 'جدیدترین — سریع و دقیق',
      badges: ['best', 'free'],
      recommended: true,
      provider: 'gemini'
    },
    {
      id: 'gemini-1.5-pro-latest',
      name: 'Gemini 1.5 Pro',
      desc: 'Context window یک میلیون توکن',
      badges: ['free'],
      provider: 'gemini'
    },
    {
      id: 'gemini-1.5-flash-latest',
      name: 'Gemini 1.5 Flash',
      desc: 'سریع‌ترین مدل Gemini',
      badges: ['fast', 'free'],
      provider: 'gemini'
    },
    {
      id: 'gemini-1.5-flash-8b-latest',
      name: 'Gemini 1.5 Flash 8B',
      desc: 'سبک‌ترین — ارزان‌ترین',
      badges: ['fast', 'free'],
      provider: 'gemini'
    }
  ],

  groq: [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      desc: '⭐ پیشنهاد برای سیستماتیک رویو — دقیق و رایگان',
      badges: ['best', 'free'],
      recommended: true,
      provider: 'groq'
    },
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      desc: 'بسیار سریع — برای پیش‌غربال‌گری دسته‌ای',
      badges: ['fast', 'free'],
      provider: 'groq'
    },
    {
      id: 'mixtral-8x7b-32768',
      name: 'Mixtral 8x7B',
      desc: 'Context window 32K — عالی برای abstract های طولانی',
      badges: ['free'],
      provider: 'groq'
    },
    {
      id: 'gemma2-9b-it',
      name: 'Gemma 2 9B',
      desc: 'مدل گوگل روی Groq',
      badges: ['free'],
      provider: 'groq'
    },
    {
      id: 'deepseek-r1-distill-llama-70b',
      name: 'DeepSeek R1 Distill 70B',
      desc: 'مدل استدلال — برای قضاوت دقیق معیارها',
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
    { id: 6, text: 'snowballing از منابع مقالات انجام شد', done: false },
    { id: 7, text: 'داپلیکیت‌ها با DOI حذف شدند', done: false },
    { id: 8, text: 'غربال عنوان/چکیده انجام شد', done: false },
    { id: 9, text: 'تاریخ جستجو ثبت شد', done: false }
  ]
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
    }).join('');

    return `
      <div class="model-item ${isSelected ? 'selected' : ''}" onclick="selectModel('${provider}', '${m.id}')">
        <div style="flex:1">
          <div class="model-item-name">${m.name}</div>
          <div class="model-item-desc">${m.desc}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${badgeHTML}</div>
      </div>
    `;
  }).join('');
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
