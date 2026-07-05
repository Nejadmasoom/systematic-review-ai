// api.js — مدیریت تمام API calls

async function callAI(prompt, systemPrompt = '', options = {}) {
  if (!STATE.activeProvider || !STATE.activeModel) {
    throw new Error('ابتدا از تنظیمات API یک مدل انتخاب کنید');
  }

  const key = STATE.apiKeys[STATE.activeProvider];
  if (!key) {
    throw new Error(`کلید API برای ${STATE.activeProvider} وارد نشده`);
  }

  const startTime = Date.now();
  let result;

  try {
    if (STATE.activeProvider === 'gemini') {
      result = await callGemini(prompt, systemPrompt, key, options);
    } else {
      // OpenAI-compatible (openai + groq)
      result = await callOpenAICompat(prompt, systemPrompt, key, options);
    }
  } catch (err) {
    logToken({ error: err.message, model: STATE.activeModel, time: Date.now() - startTime });
    throw err;
  }

  // ثبت مصرف توکن
  const usage = result.usage || {};
  const inputT = usage.prompt_tokens || usage.input_tokens || 0;
  const outputT = usage.completion_tokens || usage.output_tokens || 0;

  STATE.tokenUsage.input += inputT;
  STATE.tokenUsage.output += outputT;
  STATE.tokenUsage.total += (inputT + outputT);
  STATE.tokenUsage.calls++;

  logToken({
    model: STATE.activeModel,
    input: inputT,
    output: outputT,
    total: inputT + outputT,
    time: Date.now() - startTime,
    task: options.task || 'درخواست'
  });

  updateTokenDisplay();
  saveToStorage();

  return result.content;
}

// ===== fetch با retry خودکار روی 429 (رعایت دقیق rate limit به‌جای حدس زدن) =====
async function fetchWithRetry(url, opts, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    const resp = await fetch(url, opts);
    if (resp.status !== 429 || attempt >= maxRetries) return resp;
    attempt++;

    let waitMs = 2500 * attempt; // fallback نمایی اگر هدر نبود
    const retryAfter = resp.headers.get('retry-after');
    if (retryAfter && !isNaN(parseFloat(retryAfter))) {
      waitMs = Math.ceil(parseFloat(retryAfter) * 1000) + 250;
    } else {
      try {
        const body = await resp.clone().json();
        const msg = body?.error?.message || '';
        const match = msg.match(/try again in ([\d.]+)s/i);
        if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 250;
      } catch (e) { /* بدنه JSON نبود، از fallback نمایی استفاده کن */ }
    }
    await new Promise(r => setTimeout(r, waitMs));
  }
}

async function callOpenAICompat(prompt, systemPrompt, key, options = {}) {
  const baseUrl = STATE.baseUrls.openai || 'https://api.openai.com/v1';
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const isGroq = STATE.activeProvider === 'groq';
  const groqBase = 'https://api.groq.com/openai/v1';
  const finalUrl = isGroq ? `${groqBase}/chat/completions` : url;

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: STATE.activeModel,
    messages,
    max_tokens: options.maxTokens || 2000,
    temperature: options.temperature ?? 0.1
  };

  const resp = await fetchWithRetry(finalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 429) throw new Error(`محدودیت نرخ (rate limit) — ${err.error?.message || 'حتی بعد از چند تلاش مجدد هم رد نشد، کمی صبر کنید'}`);
    throw new Error(err.error?.message || `خطای HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage
  };
}

async function callGemini(prompt, systemPrompt, key, options = {}) {
  const modelId = STATE.activeModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`;

  const contents = [{ role: 'user', parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }] }];

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: options.maxTokens || 2000,
      temperature: options.temperature ?? 0.1
    }
  };

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 429) throw new Error(`محدودیت نرخ (rate limit) — ${err.error?.message || 'حتی بعد از چند تلاش مجدد هم رد نشد، کمی صبر کنید'}`);
    throw new Error(err.error?.message || `خطای HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};

  return {
    content: text,
    usage: {
      prompt_tokens: usage.promptTokenCount || 0,
      completion_tokens: usage.candidatesTokenCount || 0
    }
  };
}

// ===== Parse Search Strategy =====
async function aiParseStrategy(strategyText, dbType) {
  const dbNames = {
    pubmed: 'PubMed/MEDLINE',
    scopus: 'Scopus',
    wos: 'Web of Science',
    embase: 'Embase',
    custom: 'سفارشی'
  };

  const systemPrompt = `شما یک متخصص مطالعات سیستماتیک هستید. وظیفه شما تحلیل دقیق سرچ استراتژی‌های علمی و استخراج اجزای آن‌هاست.

خروجی را دقیقاً به فرمت JSON زیر بده و هیچ متن دیگری اضافه نکن:
{
  "mainConcepts": ["مفهوم اصلی ۱", "مفهوم اصلی ۲"],
  "keywords": {
    "main": ["کلیدواژه اصلی ۱", "کلیدواژه اصلی ۲"],
    "synonyms": ["مترادف ۱", "مترادف ۲"],
    "mesh": ["MeSH term 1", "MeSH term 2"],
    "excluded": ["کلیدواژه خروج ۱"]
  },
  "booleanStructure": "توضیح ساختار AND/OR/NOT",
  "filters": {
    "studyTypes": ["نوع مطالعه ۱"],
    "years": {"from": null, "to": null},
    "languages": ["زبان ۱"],
    "fields": ["فیلد جستجو مثل Title, Abstract"]
  },
  "searchableQuery": "خلاصه قابل جستجو برای Google Scholar",
  "complexity": "ساده/متوسط/پیچیده",
  "notes": "نکات مهم یا هشدارها"
}`;

  const prompt = `دیتابیس: ${dbNames[dbType] || dbType}

سرچ استراتژی:
${strategyText}

این سرچ استراتژی را parse و تحلیل کن.`;

  return await callAI(prompt, systemPrompt, { task: 'parse_strategy', maxTokens: 1500 });
}

// ===== Screen Paper =====
// ===== محافظت از Recall: طبق مطالعات اعتبارسنجی واقعی (مثلاً Research Synthesis Methods 2025)،
// تصمیم "excluded" یک مدل AI به‌تنهایی می‌تواند حساسیت (sensitivity) فقط ۵۶ تا ۷۷ درصد داشته باشد —
// یعنی تا ۴۵٪ از مقالات واقعاً مرتبط را ممکن است به‌اشتباه exclude کند. برای جلوگیری از این خطر،
// هر تصمیم "excluded" که اطمینان AI پایین‌تر از آستانه باشد، به‌جای حذف قطعی به "pending" تبدیل
// می‌شود تا حتماً یک انسان آن را ببیند (مطابق توصیه Cochrane برای عدم اتکای کامل به یک لایه غربال‌گری).
function applyConfidenceGate(result) {
  if (result.decision === 'excluded') {
    const scoreOk = typeof result.confidenceScore === 'number' ? result.confidenceScore >= 85 : false;
    if (result.confidence !== 'high' || !scoreOk) {
      result.decision = 'pending';
      result.gated = true;
      result.summary = `[⚠ نیاز به بررسی انسانی — اطمینان AI برای exclude قطعی کافی نبود] ${result.summary || ''}`;
    }
  }
  return result;
}

async function aiScreenPaper(paper, strategy) {
  const inclusionList = strategy.inclusion.map(c => `- [${c.type}] ${c.value}`).join('\n');
  const exclusionList = strategy.exclusion.map(c => `- [${c.type}] ${c.value}`).join('\n');
  const keywords = strategy.keywords.map(k => k.value).join(', ');
  const pico = strategy.pico || {};

  const picoBlock = (pico.population || pico.intervention || pico.outcome) ? `
=== چارچوب PICO تعریف‌شده توسط پژوهشگر ===
P (جمعیت هدف): ${pico.population || 'تعریف نشده'}
I (مداخله/مواجهه): ${pico.intervention || 'تعریف نشده'}
C (مقایسه): ${pico.comparison || 'بدون محدودیت'}
O (پیامد): ${pico.outcome || 'تعریف نشده'}
نوع‌های مطالعه مجاز: ${(strategy.studyDesigns || []).join(', ') || 'بدون محدودیت'}
` : '';

  const systemPrompt = `شما یک متخصص systematic review با تجربه در روش‌شناسی Cochrane و PRISMA هستید. وظیفه شما غربال‌گری دقیق مقالات بر اساس چارچوب PICO/PECO و معیارهای مشخص‌شده است.

قوانین سخت‌گیرانه (این‌ها را زیر پا نگذارید):
1. اگر جمعیت مطالعه (P) به‌وضوح با جمعیت هدف مطابقت ندارد → excluded
2. اگر مداخله/مواجهه (I) ذکرنشده یا متفاوت است، اما عنوان/چکیده برای قضاوت قطعی کافی نیست → pending (هرگز حدس نزنید)
3. هرگز یک معیار را "احتمالاً مطابقت دارد" در نظر نگیرید مگر شواهد متنی صریح در عنوان یا چکیده وجود داشته باشد
4. اگر چکیده خالی است، فقط بر اساس عنوان قضاوت کنید و این محدودیت را در reasoning ذکر کنید، و در صورت ابهام pending بدهید
5. استدلال خود را برای هر معیار به‌صورت جداگانه و مبتنی بر شواهد متن ارائه دهید

خروجی را دقیقاً به فرمت JSON زیر بده، بدون هیچ متن یا markdown اضافه:
{
  "decision": "included" | "excluded" | "pending",
  "confidence": "high" | "medium" | "low",
  "confidenceScore": 85,
  "summary": "خلاصه یک‌جمله‌ای دلیل تصمیم",
  "picoMatch": {
    "population": "match" | "mismatch" | "unclear",
    "intervention": "match" | "mismatch" | "unclear",
    "comparison": "match" | "mismatch" | "unclear" | "n/a",
    "outcome": "match" | "mismatch" | "unclear"
  },
  "criteriaCheck": [
    {"criterion": "نام معیار", "type": "inclusion" | "exclusion", "status": "pass" | "fail" | "unknown", "reason": "توضیح کوتاه مبتنی بر متن"}
  ],
  "reasoning": "استدلال کامل و دقیق شما با ارجاع به جملات خاص از چکیده",
  "keyFindings": ["یافته کلیدی ۱", "یافته کلیدی ۲"],
  "exclusionReasons": ["دلیل خروج ۱"]
}`;

  const yearRange = strategy.yearFrom || strategy.yearTo
    ? `بازه سال: ${strategy.yearFrom || 'نامحدود'} تا ${strategy.yearTo || 'حال'}`
    : '';

  const prompt = `${picoBlock}
=== معیارهای ورود اضافه ===
${inclusionList || 'معیار خاصی تعریف نشده'}

=== معیارهای خروج ===
${exclusionList || 'معیار خاصی تعریف نشده'}

=== کلیدواژه‌های مرتبط ===
${keywords || 'نامشخص'}
${yearRange}
زبان‌های مجاز: ${strategy.languages?.join(', ') || 'همه'}

=== مقاله برای بررسی ===
عنوان: ${paper.title}
نویسنده: ${paper.author || 'نامشخص'}
سال: ${paper.year || 'نامشخص'}
مجله: ${paper.journal || 'نامشخص'}
چکیده: ${paper.abstract || '(چکیده ارائه نشده — فقط بر اساس عنوان قضاوت کن و این محدودیت را ذکر کن)'}

با دقت و بر اساس شواهد متنی این مقاله را ارزیابی کن. اگر شواهد کافی نیست، pending بده.`;

  return await callAI(prompt, systemPrompt, { task: 'screen_paper', maxTokens: 1500, temperature: 0.05 });
}

// ===== Batch Screening با محدودیت نرخ برای پلن‌های رایگان =====
// این اعداد بر اساس محدودیت واقعی free-tier هر provider تنظیم شده‌اند (تیر ۱۴۰۵):
// Groq free tier معمولاً حدود ۳۰ req/min برای اکثر مدل‌ها دارد → با کمی حاشیه امن، ۲.۵ ثانیه فاصله می‌گذاریم.
const FREE_TIER_DELAY_MS = { groq: 2500, gemini: 4500, openai: 300 };

async function screenPapersBatch(papers, strategy, onProgress, onPaperDone) {
  let delay = FREE_TIER_DELAY_MS[STATE.activeProvider] || 500;
  const results = [];

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    onProgress(i + 1, papers.length, paper.title, delay);

    let attempt = 0;
    let succeeded = false;

    while (!succeeded) {
      try {
        const raw = await aiScreenPaper(paper, strategy);
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = applyConfidenceGate(JSON.parse(cleaned));
        paper.status = result.decision || 'pending';
        paper.aiReason = result.summary || '';
        paper.aiResult = result;
        paper.screened = true;
        results.push({ paper, result, error: null });
        succeeded = true;
      } catch (err) {
        const isRateLimit = /rate limit|429|quota/i.test(err.message);
        attempt++;
        if (isRateLimit && attempt <= 3) {
          // فاصله بین درخواست‌های بعدی را برای بقیه‌ی صف هم بیشتر کن تا دیگر به لیمیت نخوریم
          delay = Math.min(delay * 1.8, 20000);
          onProgress(i + 1, papers.length, `⏳ محدودیت نرخ خورد — افزایش فاصله به ${(delay / 1000).toFixed(1)} ثانیه، تلاش مجدد ${attempt}/3...`, delay);
          await new Promise(r => setTimeout(r, delay));
          continue; // همین مقاله را دوباره امتحان کن
        }
        paper.status = 'unscreened';
        paper.aiReason = `خطا: ${err.message}`;
        results.push({ paper, result: null, error: err.message });
        succeeded = true; // از حلقه خارج شو، این مقاله رو نگه‌داشتیم برای بعد
      }
    }

    onPaperDone(paper, results[results.length - 1]);

    if (i < papers.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}

// ===== Test Connection =====
async function testConnection(provider) {
  const statusEl = document.getElementById(`status${capitalize(provider)}`);
  statusEl.textContent = '⏳ در حال اتصال...';
  statusEl.className = 'provider-status loading';

  const key = document.getElementById(`key${capitalize(provider)}`).value.trim();
  if (!key) {
    statusEl.textContent = '⚠ کلید وارد نشده';
    statusEl.className = 'provider-status err';
    return;
  }

  // موقتاً کلید را ذخیره
  const prevKey = STATE.apiKeys[provider];
  const prevProvider = STATE.activeProvider;
  const prevModel = STATE.activeModel;

  STATE.apiKeys[provider] = key;

  // یک مدل ساده برای تست انتخاب کن
  const testModels = { openai: 'gpt-5.4-nano', gemini: 'gemini-3.1-flash-lite', groq: 'openai/gpt-oss-20b' };
  STATE.activeProvider = provider;
  STATE.activeModel = testModels[provider];

  try {
    const result = await callAI('سلام. فقط "تأیید شد" بنویس.', '', { maxTokens: 20 });
    statusEl.textContent = '✅ اتصال موفق';
    statusEl.className = 'provider-status ok';
    STATE.apiKeys[provider] = key;
    showToast(`✅ اتصال به ${provider} برقرار شد`, 'success');

    // ذخیره key
    if (provider === 'openai') {
      const baseVal = document.getElementById('baseOpenai').value.trim();
      STATE.baseUrls.openai = baseVal || 'https://api.openai.com/v1';
    }
    saveToStorage();

    // اگر مدلی از قبل انتخاب نبود، پیشنهاد بهترین مدل
    if (!prevProvider) {
      const recommended = MODELS[provider].find(m => m.recommended);
      if (recommended) selectModel(provider, recommended.id);
    } else {
      STATE.activeProvider = prevProvider;
      STATE.activeModel = prevModel;
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    statusEl.className = 'provider-status err';
    STATE.apiKeys[provider] = prevKey;
    STATE.activeProvider = prevProvider;
    STATE.activeModel = prevModel;
    showToast(`❌ خطا: ${err.message}`, 'error');
  }
}

// ===== Token Display =====
function updateTokenDisplay() {
  const f = n => n.toLocaleString('fa-IR');
  document.getElementById('tsInput').textContent = f(STATE.tokenUsage.input);
  document.getElementById('tsOutput').textContent = f(STATE.tokenUsage.output);
  document.getElementById('tsTotal').textContent = f(STATE.tokenUsage.total);
  document.getElementById('tsCalls').textContent = f(STATE.tokenUsage.calls);

  if (STATE.tokenUsage.total > 0) {
    document.getElementById('tokenMini').style.display = 'block';
    document.getElementById('tokenMiniVal').textContent = f(STATE.tokenUsage.total);
  }
}

function logToken(entry) {
  STATE.tokenLog.unshift(entry);
  if (STATE.tokenLog.length > 100) STATE.tokenLog = STATE.tokenLog.slice(0, 100);
  renderTokenLog();
}

function renderTokenLog() {
  const container = document.getElementById('tokenLog');
  if (!STATE.tokenLog.length) {
    container.innerHTML = '<div class="log-empty">هنوز درخواستی ارسال نشده</div>';
    return;
  }

  const f = n => (n || 0).toLocaleString('fa-IR');
  container.innerHTML = STATE.tokenLog.map(entry => {
    if (entry.error) {
      return `<div class="log-item"><span class="log-time">${new Date().toLocaleTimeString('fa-IR')}</span><span style="color:var(--red)">${entry.error}</span></div>`;
    }
    const time = new Date().toLocaleTimeString('fa-IR');
    return `
      <div class="log-item">
        <span class="log-time">${time}</span>
        <span class="log-model">${entry.model}</span>
        <span style="color:var(--text2);font-size:11px">${entry.task || ''}</span>
        <span class="log-tokens">${f(entry.total)} توکن (ورودی: ${f(entry.input)} | خروجی: ${f(entry.output)})</span>
        <span style="color:var(--text3);font-size:11px">${entry.time}ms</span>
      </div>
    `;
  }).join('');
}

function clearTokenLog() {
  STATE.tokenLog = [];
  STATE.tokenUsage = { input: 0, output: 0, total: 0, calls: 0 };
  updateTokenDisplay();
  renderTokenLog();
  saveToStorage();
}

function toggleKey(inputId) {
  const inp = document.getElementById(inputId);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}
