// autosearch.js — جستجوی خودکار: از عنوان/سوال پژوهش تا PICO، استراتژی، اجرای سرچ واقعی و ورود مقالات
//
// محدودیت واقعی و مهم: از داخل مرورگر (بدون بک‌اند) فقط دیتابیس‌هایی قابل اتصال خودکار هستند که
// رایگان، بدون نیاز به کلید سازمانی، و CORS-friendly باشند. این دو مورد هستند:
//   - PubMed/MEDLINE از طریق NCBI E-utilities (رایگان، بدون کلید، CORS باز)
//   - Semantic Scholar Graph API (رایگان، بدون کلید برای حجم کم، CORS باز)
// Scopus / Web of Science / Embase نیاز به کلید API نهادی + معمولاً پروکسی سمت سرور دارند
// (اکثراً CORS را برای فراخوانی مستقیم از مرورگر مسدود می‌کنند) — برای این‌ها لینک جستجوی دستی
// در تب «آپدیت دوره‌ای» تولید می‌شود، نه فراخوانی خودکار.

const AUTOSEARCH_STATE = { plan: null };

// ===== NCBI PubMed E-utilities =====
async function ncbiESearch(query, yearFrom, yearTo, retmax) {
  let url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&term=${encodeURIComponent(query)}`;
  if (yearFrom || yearTo) {
    url += `&datetype=pdat&mindate=${yearFrom || '1900'}&maxdate=${yearTo || new Date().getFullYear()}`;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`خطا در esearch پابمد (HTTP ${resp.status})`);
  const data = await resp.json();
  return data.esearchresult?.idlist || [];
}

async function ncbiEFetch(ids) {
  if (!ids.length) return [];
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&id=${ids.join(',')}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`خطا در efetch پابمد (HTTP ${resp.status})`);
  const xmlText = await resp.text();
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  const articles = Array.from(xml.querySelectorAll('PubmedArticle'));

  return articles.map(a => {
    const title = a.querySelector('ArticleTitle')?.textContent?.trim() || '';
    const abstract = Array.from(a.querySelectorAll('AbstractText')).map(el => el.textContent.trim()).join(' ');
    const journal = a.querySelector('Journal Title')?.textContent?.trim()
      || a.querySelector('ISOAbbreviation')?.textContent?.trim() || '';
    let year = a.querySelector('JournalIssue PubDate Year')?.textContent?.trim() || '';
    if (!year) {
      const medlineDate = a.querySelector('JournalIssue PubDate MedlineDate')?.textContent || '';
      year = (medlineDate.match(/\d{4}/) || [''])[0];
    }
    const authorEls = Array.from(a.querySelectorAll('AuthorList Author'));
    let author = '';
    if (authorEls.length) {
      const last = authorEls[0].querySelector('LastName')?.textContent || authorEls[0].querySelector('CollectiveName')?.textContent || '';
      author = last + (authorEls.length > 1 ? ' et al.' : '');
    }
    let doi = '';
    a.querySelectorAll('ArticleId').forEach(el => { if (el.getAttribute('IdType') === 'doi') doi = el.textContent.trim(); });
    const pmid = a.querySelector('PMID')?.textContent?.trim() || '';

    return {
      title, abstract, author, year, journal, doi,
      source: 'PubMed',
      sourceUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : ''
    };
  }).filter(p => p.title);
}

async function searchPubMed(query, yearFrom, yearTo, retmax) {
  const ids = await ncbiESearch(query, yearFrom, yearTo, retmax);
  const results = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    results.push(...await ncbiEFetch(batch));
    if (i + 100 < ids.length) await new Promise(r => setTimeout(r, 400)); // رعایت rate-limit بدون API key
  }
  return results;
}

// ===== Semantic Scholar Graph API =====
async function searchSemanticScholar(query, yearFrom, yearTo, limit) {
  let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,abstract,authors,year,venue,externalIds`;
  if (yearFrom || yearTo) url += `&year=${yearFrom || 1900}-${yearTo || new Date().getFullYear()}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('محدودیت نرخ Semantic Scholar — چند لحظه صبر کنید و دوباره امتحان کنید');
    throw new Error(`خطای Semantic Scholar (HTTP ${resp.status})`);
  }
  const data = await resp.json();
  return (data.data || []).map(p => ({
    title: p.title || '',
    abstract: p.abstract || '',
    author: p.authors?.length ? (p.authors[0].name + (p.authors.length > 1 ? ' et al.' : '')) : '',
    year: p.year ? String(p.year) : '',
    journal: p.venue || '',
    doi: p.externalIds?.DOI || '',
    source: 'Semantic Scholar',
    sourceUrl: p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ''
  })).filter(p => p.title);
}

// ===== AI: تولید PICO + استراتژی جستجو از روی عنوان =====
async function aiGenerateSearchPlan(title, notes, yearFrom, yearTo) {
  const systemPrompt = `شما متخصص طراحی سرچ استراتژی سیستماتیک رویو بر اساس روش‌شناسی Cochrane/PRISMA هستید.
بر اساس عنوان/سوال پژوهش و توضیحات تکمیلی، چارچوب PICO و یک استراتژی جستجوی واقعاً قابل‌اجرا طراحی کن.

خروجی را دقیقاً به فرمت JSON زیر بده، بدون هیچ متن یا markdown اضافه:
{
  "pico": {"population": "...", "intervention": "...", "comparison": "...", "outcome": "..."},
  "studyDesigns": ["RCT"],
  "mainConcepts": ["مفهوم ۱", "مفهوم ۲"],
  "pubmedQuery": "کوئری بولین آماده برای فیلد جستجوی PubMed، با [tiab] یا [MeSH] در صورت لزوم",
  "semanticScholarQuery": "عبارت جستجوی ساده کلیدواژه‌ای بدون بولین پیچیده",
  "inclusionCriteria": ["..."],
  "exclusionCriteria": ["..."],
  "notes": "هشدار یا نکته درباره محدودیت‌های این استراتژی پیشنهادی که پژوهشگر باید حتماً بررسی و اصلاح کند"
}`;

  const prompt = `عنوان/سوال پژوهش: ${title}
${notes ? `توضیحات تکمیلی پژوهشگر: ${notes}\n` : ''}${(yearFrom || yearTo) ? `بازه سال مدنظر: ${yearFrom || 'نامحدود'} تا ${yearTo || 'حال'}\n` : ''}
این سرچ استراتژی و PICO را طراحی کن.`;

  const raw = await callAI(prompt, systemPrompt, { task: 'auto_search_plan', maxTokens: 1200, temperature: 0.1 });
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

// ===== UI Orchestration =====
function escapeHtmlAS(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function generateSearchPlan() {
  const title = document.getElementById('asTitle').value.trim();
  const notes = document.getElementById('asNotes').value.trim();
  const yearFrom = document.getElementById('asYearFrom').value.trim();
  const yearTo = document.getElementById('asYearTo').value.trim();

  if (!title) { showToast('⚠ عنوان یا سوال پژوهش را وارد کنید', 'error'); return; }
  if (!STATE.activeProvider || !STATE.activeModel) {
    showToast('⚠ ابتدا از تنظیمات یک مدل AI انتخاب کنید', 'error');
    switchTab('settings');
    return;
  }

  const btn = document.getElementById('asPlanBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '⏳ در حال طراحی استراتژی...';

  try {
    const plan = await aiGenerateSearchPlan(title, notes, yearFrom, yearTo);
    AUTOSEARCH_STATE.plan = plan;
    renderSearchPlan(plan);
    showToast('✅ استراتژی پیشنهادی آماده شد — بررسی، ویرایش و تأیید کنید');
  } catch (err) {
    showToast(`❌ خطا در طراحی استراتژی: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderSearchPlan(plan) {
  const el = document.getElementById('asPlanResult');
  el.style.display = 'block';
  const pico = plan.pico || {};

  el.innerHTML = `
    <div class="card-title">استراتژی پیشنهادی — قبل از اجرا حتماً بررسی و در صورت نیاز ویرایش کنید</div>
    <div class="pico-grid" style="margin-bottom:10px">
      <div class="pico-field"><label><span class="pico-letter">P</span> جمعیت</label><input type="text" id="asPicoP" value="${escapeHtmlAS(pico.population)}"></div>
      <div class="pico-field"><label><span class="pico-letter">I</span> مداخله</label><input type="text" id="asPicoI" value="${escapeHtmlAS(pico.intervention)}"></div>
      <div class="pico-field"><label><span class="pico-letter">C</span> مقایسه</label><input type="text" id="asPicoC" value="${escapeHtmlAS(pico.comparison)}"></div>
      <div class="pico-field"><label><span class="pico-letter">O</span> پیامد</label><input type="text" id="asPicoO" value="${escapeHtmlAS(pico.outcome)}"></div>
    </div>
    <div class="field-group">
      <label>کوئری PubMed (قابل ویرایش)</label>
      <textarea id="asPubmedQuery" class="strategy-input" style="min-height:70px">${escapeHtmlAS(plan.pubmedQuery)}</textarea>
    </div>
    <div class="field-group">
      <label>کوئری Semantic Scholar (قابل ویرایش)</label>
      <input type="text" id="asS2Query" value="${escapeHtmlAS(plan.semanticScholarQuery)}">
    </div>
    ${plan.notes ? `<div class="parse-result" style="display:block">⚠ ${escapeHtmlAS(plan.notes)}</div>` : ''}
    <div class="strategy-actions" style="margin-top:10px">
      <button class="btn-primary" onclick="applyPlanAndSearch()">✅ تأیید + اجرای جستجو در PubMed و Semantic Scholar</button>
    </div>
    <p style="font-size:12px;color:var(--text3);margin-top:8px">
      جستجوی خودکار فقط روی PubMed و Semantic Scholar اجرا می‌شود (APIهای رایگان و بدون کلید).
      Scopus، Web of Science و Embase نیاز به اشتراک/کلید نهادی دارند و مرورگر معمولاً به آن‌ها مستقیماً
      دسترسی CORS ندارد — برای این‌ها به تب «آپدیت دوره‌ای» بروید تا لینک جستجوی آماده (بر اساس همین
      استراتژی) برایتان ساخته شود؛ نتیجه را دستی export و از تب «مقالات» → «Import دسته‌ای» وارد کنید.
    </p>
    <div id="asSearchStatus" class="parse-result" style="display:none"></div>
  `;
}

async function applyPlanAndSearch() {
  const plan = AUTOSEARCH_STATE.plan;
  if (!plan) return;

  const pico = {
    population: document.getElementById('asPicoP').value.trim(),
    intervention: document.getElementById('asPicoI').value.trim(),
    comparison: document.getElementById('asPicoC').value.trim(),
    outcome: document.getElementById('asPicoO').value.trim()
  };
  const pubmedQuery = document.getElementById('asPubmedQuery').value.trim();
  const s2Query = document.getElementById('asS2Query').value.trim();
  const yearFrom = document.getElementById('asYearFrom').value.trim();
  const yearTo = document.getElementById('asYearTo').value.trim();

  if (document.getElementById('picoP')) document.getElementById('picoP').value = pico.population;
  if (document.getElementById('picoI')) document.getElementById('picoI').value = pico.intervention;
  if (document.getElementById('picoC')) document.getElementById('picoC').value = pico.comparison;
  if (document.getElementById('picoO')) document.getElementById('picoO').value = pico.outcome;
  if (yearFrom && document.getElementById('yearFrom')) document.getElementById('yearFrom').value = yearFrom;
  if (yearTo && document.getElementById('yearTo')) document.getElementById('yearTo').value = yearTo;
  if (typeof saveStrategy === 'function') saveStrategy();

  const statusEl = document.getElementById('asSearchStatus');
  statusEl.style.display = 'block';
  statusEl.textContent = '⏳ در حال جستجو در PubMed...';

  let pubmedResults = [], s2Results = [];

  if (pubmedQuery) {
    try {
      pubmedResults = await searchPubMed(pubmedQuery, yearFrom, yearTo, 60);
    } catch (err) {
      showToast(`⚠ PubMed: ${err.message}`, 'error');
    }
  }

  statusEl.textContent = `✅ PubMed: ${pubmedResults.length} مقاله | ⏳ در حال جستجو در Semantic Scholar...`;

  if (s2Query) {
    try {
      s2Results = await searchSemanticScholar(s2Query, yearFrom, yearTo, 60);
    } catch (err) {
      showToast(`⚠ Semantic Scholar: ${err.message}`, 'error');
    }
  }

  const allResults = [...pubmedResults, ...s2Results];
  let added = 0, exactDupes = 0, fuzzyDupes = 0;

  allResults.forEach(p => {
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
      source: p.source,
      sourceUrl: p.sourceUrl || '',
      status: 'unscreened',
      screened: false,
      addedAt: new Date().toISOString()
    });
    added++;
  });

  saveToStorage();
  if (typeof updatePaperBadge === 'function') updatePaperBadge();
  if (typeof updateUnscreenedCount === 'function') updateUnscreenedCount();

  statusEl.textContent = `✅ تمام شد — PubMed: ${pubmedResults.length} | Semantic Scholar: ${s2Results.length} | افزوده‌شده به لیست: ${added} | داپلیکیت حذف‌شده: ${exactDupes + fuzzyDupes} (${exactDupes} دقیق بر اساس DOI + ${fuzzyDupes} احتمالی بر اساس شباهت عنوان)`;

  if (added > 0) {
    showToast(`✅ ${added} مقاله جدید اضافه شد — می‌توانید به غربال‌گری بروید`, 'success');
    switchTab('papers');
  } else {
    showToast('⚠ هیچ مقاله جدیدی پیدا نشد یا همه داپلیکیت بودند', 'error');
  }
}
