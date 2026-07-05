// autosearch.js — جستجوی خودکار: از عنوان/سوال پژوهش تا PICO، استراتژی، اجرای سرچ واقعی در چند دیتابیس، و ورود مقالات
//
// محدودیت واقعی و مهم: از داخل مرورگر (بدون بک‌اند) فقط دیتابیس‌هایی قابل اتصال خودکار هستند که
// رایگان، بدون نیاز به کلید سازمانی، و CORS-friendly باشند. این شش مورد هستند و همه به‌صورت خودکار
// و موازی-با-تأخیر جستجو می‌شوند تا نیاز به چک دستی هرکدام از بین برود:
//   1. PubMed/MEDLINE — از طریق NCBI E-utilities (رایگان، بدون کلید)
//   2. Europe PMC — پوشش MEDLINE + PMC + Preprints + Patents (رایگان، بدون کلید) — پوشش گسترده‌تر از PubMed تنها
//   3. Semantic Scholar — پوشش میان‌رشته‌ای وسیع + citation graph (رایگان، بدون کلید)
//   4. OpenAlex — بزرگ‌ترین ایندکس باز جهان (>250M رکورد، جانشین باز Scopus/WoS برای بسیاری از کاربردها)
//   5. Crossref — رجیستری اصلی DOI ناشران (خوب برای مقالات خیلی جدید که هنوز در ایندکس‌های دیگر نیستند)
//   6. ClinicalTrials.gov — رجیستری کارآزمایی‌ها (برای رویوهای RCT-محور، جهت کاهش publication bias)
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

// ===== Europe PMC REST API (پوشش MEDLINE + PMC + Preprints + Patents) =====
async function searchEuropePMC(query, yearFrom, yearTo, pageSize) {
  let q = query;
  if (yearFrom || yearTo) q += ` AND PUB_YEAR:[${yearFrom || 1900} TO ${yearTo || new Date().getFullYear()}]`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=${pageSize}&resultType=core`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`خطای Europe PMC (HTTP ${resp.status})`);
  const data = await resp.json();
  return (data.resultList?.result || []).map(p => ({
    title: p.title || '',
    abstract: p.abstractText || '',
    author: p.authorString ? p.authorString.split(',')[0].trim() + (p.authorString.includes(',') ? ' et al.' : '') : '',
    year: p.pubYear || '',
    journal: p.journalInfo?.journal?.title || '',
    doi: p.doi || '',
    source: 'Europe PMC',
    sourceUrl: p.doi ? `https://doi.org/${p.doi}` : (p.pmid ? `https://europepmc.org/article/MED/${p.pmid}` : '')
  })).filter(p => p.title);
}

// ===== OpenAlex (بزرگ‌ترین ایندکس باز — جایگزین رایگان با پوشش نزدیک به Scopus/WoS) =====
async function searchOpenAlex(query, yearFrom, yearTo, perPage) {
  let filters = [];
  if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`);
  if (yearTo) filters.push(`to_publication_date:${yearTo}-12-31`);
  const filterStr = filters.length ? `&filter=${filters.join(',')}` : '';
  // mailto پارامتر پیشنهادی OpenAlex برای "polite pool" (صف سریع‌تر) - ایمیل واقعی لازم نیست کار کند
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}${filterStr}&per_page=${perPage}&mailto=systematicreview@example.com`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`خطای OpenAlex (HTTP ${resp.status})`);
  const data = await resp.json();
  return (data.results || []).map(p => {
    // OpenAlex چکیده را به‌صورت inverted index می‌دهد، باید بازسازی شود
    let abstract = '';
    if (p.abstract_inverted_index) {
      const positions = [];
      for (const [word, idxs] of Object.entries(p.abstract_inverted_index)) {
        idxs.forEach(i => positions[i] = word);
      }
      abstract = positions.join(' ');
    }
    return {
      title: p.title || p.display_name || '',
      abstract,
      author: p.authorships?.length ? (p.authorships[0].author?.display_name || '') + (p.authorships.length > 1 ? ' et al.' : '') : '',
      year: p.publication_year ? String(p.publication_year) : '',
      journal: p.primary_location?.source?.display_name || p.host_venue?.display_name || '',
      doi: p.doi ? p.doi.replace('https://doi.org/', '') : '',
      source: 'OpenAlex',
      sourceUrl: p.doi || p.id || ''
    };
  }).filter(p => p.title);
}

// ===== Crossref (رجیستری DOI ناشران — خوب برای مقالات بسیار جدید) =====
async function searchCrossref(query, yearFrom, yearTo, rows) {
  let url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${rows}&mailto=systematicreview@example.com`;
  if (yearFrom) url += `&filter=from-pub-date:${yearFrom}-01-01`;
  if (yearTo) url += `${yearFrom ? ',' : '&filter='}until-pub-date:${yearTo}-12-31`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`خطای Crossref (HTTP ${resp.status})`);
  const data = await resp.json();
  return (data.message?.items || []).map(p => ({
    title: Array.isArray(p.title) ? (p.title[0] || '') : (p.title || ''),
    abstract: (p.abstract || '').replace(/<[^>]+>/g, ''), // Crossref گاهی abstract با تگ JATS می‌دهد
    author: p.author?.length ? (p.author[0].family || p.author[0].name || '') + (p.author.length > 1 ? ' et al.' : '') : '',
    year: p['published']?.['date-parts']?.[0]?.[0] ? String(p['published']['date-parts'][0][0]) : '',
    journal: Array.isArray(p['container-title']) ? (p['container-title'][0] || '') : '',
    doi: p.DOI || '',
    source: 'Crossref',
    sourceUrl: p.DOI ? `https://doi.org/${p.DOI}` : ''
  })).filter(p => p.title);
}

// ===== ClinicalTrials.gov v2 API (رجیستری کارآزمایی‌ها — رایگان، بدون کلید) =====
// برای رویوهایی که RCT محور هستند، چک‌کردن رجیستری کارآزمایی‌ها (نه فقط مقالات منتشرشده) طبق
// روش‌شناسی Cochrane الزامی است — چون خیلی از کارآزمایی‌ها هرگز منتشر نمی‌شوند (publication bias)
// و رجیستری تنها راه شناسایی آن‌هاست.
async function searchClinicalTrials(query, yearFrom, yearTo, pageSize) {
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=${pageSize}&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`خطای ClinicalTrials.gov (HTTP ${resp.status})`);
  const data = await resp.json();
  return (data.studies || []).map(s => {
    const p = s.protocolSection || {};
    const id = p.identificationModule || {};
    const status = p.statusModule || {};
    const desc = p.descriptionModule || {};
    const design = p.designModule || {};
    const startYear = (status.startDateStruct?.date || '').match(/\d{4}/)?.[0] || '';
    if (yearFrom && startYear && Number(startYear) < Number(yearFrom)) return null;
    if (yearTo && startYear && Number(startYear) > Number(yearTo)) return null;
    return {
      title: id.briefTitle || '',
      abstract: desc.briefSummary || '',
      author: (p.sponsorCollaboratorsModule?.leadSponsor?.name) || '',
      year: startYear,
      journal: `ClinicalTrials.gov (${(design.phases || []).join('/') || 'ثبت کارآزمایی'})`,
      doi: '',
      source: 'ClinicalTrials.gov',
      sourceUrl: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : ''
    };
  }).filter(p => p && p.title);
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
  "generalQuery": "عبارت جستجوی کلیدواژه‌ای ساده و گسترده (بدون بولین) که برای Europe PMC، OpenAlex و Crossref هم مناسب باشد — باید مفاهیم اصلی PICO را با فاصله پشت سر هم بیاورد",
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

// ===== Snowballing (استناددهی پیشرو/پسرو) با OpenAlex =====
// روش استاندارد Cochrane برای افزایش پوشش: از مقالات نهایی «شامل‌شده»، هم منابعشان (backward)
// و هم مقالاتی که به آن‌ها استناد کرده‌اند (forward) را پیدا می‌کنیم.
async function findOpenAlexWorkByDoi(doi) {
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '');
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?mailto=systematicreview@example.com`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return await resp.json();
}

function openAlexWorkToPaper(w) {
  let abstract = '';
  if (w.abstract_inverted_index) {
    const positions = [];
    for (const [word, idxs] of Object.entries(w.abstract_inverted_index)) idxs.forEach(i => positions[i] = word);
    abstract = positions.join(' ');
  }
  return {
    title: w.title || w.display_name || '',
    abstract,
    author: w.authorships?.length ? (w.authorships[0].author?.display_name || '') + (w.authorships.length > 1 ? ' et al.' : '') : '',
    year: w.publication_year ? String(w.publication_year) : '',
    journal: w.primary_location?.source?.display_name || '',
    doi: w.doi ? w.doi.replace('https://doi.org/', '') : '',
    source: 'Snowballing',
    sourceUrl: w.doi || w.id || ''
  };
}

async function runSnowballing() {
  const included = STATE.papers.filter(p => p.status === 'included' && p.doi);
  if (!included.length) {
    showToast('⚠ هیچ مقاله‌ی شامل‌شده‌ای با DOI برای شروع snowballing پیدا نشد', 'error');
    return;
  }

  const btn = document.getElementById('snowballBtn');
  const statusEl = document.getElementById('snowballStatus');
  btn.disabled = true;
  statusEl.style.display = 'block';

  const limitedList = included.slice(0, 25); // محدودیت منطقی برای جلوگیری از تعداد درخواست بیش‌ازحد
  const candidates = [];
  let processedCount = 0;

  for (const paper of limitedList) {
    processedCount++;
    statusEl.textContent = `⏳ (${processedCount}/${limitedList.length}) در حال بررسی منابع و استنادها برای: ${paper.title.slice(0, 50)}...`;

    try {
      const work = await findOpenAlexWorkByDoi(paper.doi);
      if (!work) continue;

      // Backward: منابع همین مقاله (تا ۲۵ مورد اول)
      const refIds = (work.referenced_works || []).slice(0, 25).map(id => id.replace('https://openalex.org/', ''));
      if (refIds.length) {
        const refUrl = `https://api.openalex.org/works?filter=openalex_id:${refIds.join('|')}&per_page=${refIds.length}&mailto=systematicreview@example.com`;
        const refResp = await fetch(refUrl);
        if (refResp.ok) {
          const refData = await refResp.json();
          (refData.results || []).forEach(w => candidates.push(openAlexWorkToPaper(w)));
        }
      }

      await new Promise(r => setTimeout(r, 300));

      // Forward: مقالاتی که به این مقاله استناد کرده‌اند (تا ۲۵ مورد اول)
      if (work.cited_by_api_url) {
        const fwdResp = await fetch(`${work.cited_by_api_url}&per_page=25&mailto=systematicreview@example.com`);
        if (fwdResp.ok) {
          const fwdData = await fwdResp.json();
          (fwdData.results || []).forEach(w => candidates.push(openAlexWorkToPaper(w)));
        }
      }
    } catch (err) {
      // یک مقاله خطا داد، رد شو و بقیه را ادامه بده
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // ادغام + حذف داپلیکیت
  let added = 0, dupes = 0;
  candidates.forEach(p => {
    if (!p.title) return;
    const dupeCheck = checkDuplicate(p, STATE.papers);
    if (dupeCheck.isDupe) { dupes++; return; }
    STATE.papers.push({
      id: Date.now() + Math.random(),
      title: p.title, author: p.author || '', year: p.year || '', doi: p.doi || '',
      journal: p.journal || '', abstract: p.abstract || '', source: p.source, sourceUrl: p.sourceUrl || '',
      status: 'unscreened', screened: false, addedAt: new Date().toISOString()
    });
    added++;
  });

  logPrismaIdentified('Snowballing', candidates.length);
  saveToStorage();
  if (typeof updatePaperBadge === 'function') updatePaperBadge();
  if (typeof updateUnscreenedCount === 'function') updateUnscreenedCount();

  statusEl.textContent = `✅ تمام شد — از ${limitedList.length} مقاله شامل‌شده، ${candidates.length} کاندید پیدا شد | ${added} مقاله جدید اضافه شد | ${dupes} داپلیکیت بود`;
  btn.disabled = false;

  if (added > 0) {
    showToast(`✅ ${added} مقاله جدید از snowballing اضافه شد — به تب غربال‌گری بروید`, 'success');
  } else {
    showToast('⚠ کاندید جدیدی (غیر داپلیکیت) پیدا نشد', 'error');
  }
}

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
      <label>کوئری PubMed / Europe PMC (بولین دقیق — قابل ویرایش)</label>
      <textarea id="asPubmedQuery" class="strategy-input" style="min-height:70px">${escapeHtmlAS(plan.pubmedQuery)}</textarea>
    </div>
    <div class="field-group">
      <label>کوئری Semantic Scholar (کلیدواژه‌ای ساده — قابل ویرایش)</label>
      <input type="text" id="asS2Query" value="${escapeHtmlAS(plan.semanticScholarQuery)}">
    </div>
    <div class="field-group">
      <label>کوئری عمومی برای OpenAlex / Crossref (کلیدواژه‌ای گسترده — قابل ویرایش)</label>
      <input type="text" id="asGeneralQuery" value="${escapeHtmlAS(plan.generalQuery || plan.semanticScholarQuery)}">
    </div>
    ${plan.notes ? `<div class="parse-result" style="display:block">⚠ ${escapeHtmlAS(plan.notes)}</div>` : ''}
    <div class="strategy-actions" style="margin-top:10px">
      <button class="btn-primary" onclick="applyPlanAndSearch()">✅ تأیید + اجرای جستجو در ۶ دیتابیس</button>
    </div>
    <p style="font-size:12px;color:var(--text3);margin-top:8px">
      جستجوی خودکار روی <strong>۶ دیتابیس رایگان</strong> اجرا می‌شود: PubMed، Europe PMC، Semantic Scholar،
      OpenAlex، Crossref و ClinicalTrials.gov (رجیستری کارآزمایی‌ها — مهم برای کاهش publication bias در
      رویوهای RCT-محور). این ترکیب بخش زیادی از پوششی که معمولاً از Scopus/Web of Science گرفته می‌شود
      را هم پوشش می‌دهد، هرچند معادل کامل آن‌ها نیست (پایین‌تر توضیح داده شده). Scopus، Web of Science و
      Embase همچنان نیاز به اشتراک/کلید نهادی دارند — برای این‌ها به تب «آپدیت دوره‌ای» بروید تا لینک
      جستجوی آماده ساخته شود؛ نتیجه را دستی export و از تب «مقالات» → «Import دسته‌ای» وارد کنید.
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
  const generalQuery = document.getElementById('asGeneralQuery').value.trim() || s2Query;
  const yearFrom = document.getElementById('asYearFrom').value.trim();
  const yearTo = document.getElementById('asYearTo').value.trim();

  // همگام‌سازی با فرم اصلی استراتژی/PICO در تب «استراتژی جستجو»
  if (document.getElementById('picoP')) document.getElementById('picoP').value = pico.population;
  if (document.getElementById('picoI')) document.getElementById('picoI').value = pico.intervention;
  if (document.getElementById('picoC')) document.getElementById('picoC').value = pico.comparison;
  if (document.getElementById('picoO')) document.getElementById('picoO').value = pico.outcome;
  if (yearFrom && document.getElementById('yearFrom')) document.getElementById('yearFrom').value = yearFrom;
  if (yearTo && document.getElementById('yearTo')) document.getElementById('yearTo').value = yearTo;
  if (typeof saveStrategy === 'function') saveStrategy();

  const statusEl = document.getElementById('asSearchStatus');
  statusEl.style.display = 'block';

  // پنج دیتابیس، هرکدام با کوئری مناسب خودش. اجرای متوالی (نه موازی) عمداً است تا
  // به rate-limit هیچ‌کدام از سرویس‌های رایگان نخوریم.
  const jobs = [
    { name: 'PubMed', run: () => pubmedQuery ? searchPubMed(pubmedQuery, yearFrom, yearTo, 150) : Promise.resolve([]) },
    { name: 'Europe PMC', run: () => pubmedQuery ? searchEuropePMC(pubmedQuery, yearFrom, yearTo, 150) : Promise.resolve([]) },
    { name: 'Semantic Scholar', run: () => s2Query ? searchSemanticScholar(s2Query, yearFrom, yearTo, 100) : Promise.resolve([]) },
    { name: 'OpenAlex', run: () => generalQuery ? searchOpenAlex(generalQuery, yearFrom, yearTo, 200) : Promise.resolve([]) },
    { name: 'Crossref', run: () => generalQuery ? searchCrossref(generalQuery, yearFrom, yearTo, 150) : Promise.resolve([]) },
    { name: 'ClinicalTrials.gov', run: () => generalQuery ? searchClinicalTrials(generalQuery, yearFrom, yearTo, 100) : Promise.resolve([]) }
  ];

  const resultsBySource = {};
  const errorsBySource = {};

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    statusEl.innerHTML = renderSourceProgress(resultsBySource, errorsBySource, job.name);
    try {
      resultsBySource[job.name] = await job.run();
    } catch (err) {
      errorsBySource[job.name] = err.message;
      resultsBySource[job.name] = [];
    }
    if (i < jobs.length - 1) await new Promise(r => setTimeout(r, 600)); // فاصله بین دیتابیس‌ها، احترام به rate-limit عمومی
  }

  statusEl.innerHTML = renderSourceProgress(resultsBySource, errorsBySource, null);

  // ثبت تعداد خام هر منبع برای نمودار PRISMA (قبل از حذف داپلیکیت)
  Object.entries(resultsBySource).forEach(([source, list]) => logPrismaIdentified(source, list.length));

  // ادغام + حذف داپلیکیت (DOI دقیق + شباهت فازی عنوان) با استفاده از منطق موجود در parsers.js
  const allResults = Object.values(resultsBySource).flat();

  // ===== چک Recall: آیا مقالات شناخته‌شده واقعاً پیدا شدند؟ (روش relative recall) =====
  const knownDoisRaw = (document.getElementById('asKnownDois')?.value || '').trim();
  let recallCheckHTML = '';
  if (knownDoisRaw) {
    const normalizeDoi = d => (d || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    const knownDois = knownDoisRaw.split('\n').map(normalizeDoi).filter(Boolean);
    const foundDois = new Set(allResults.map(p => normalizeDoi(p.doi)).filter(Boolean));
    const missing = knownDois.filter(d => !foundDois.has(d));
    recallCheckHTML = missing.length
      ? `<div class="parse-result error" style="margin-top:10px">⚠ چک Recall: ${missing.length} از ${knownDois.length} مقاله‌ی شناخته‌شده توسط استراتژی شما پیدا نشد: <br><code style="font-size:11px">${missing.join('<br>')}</code><br>این یعنی احتمالاً کوئری‌ها بیش‌ازحد محدودند — کلیدواژه‌ها یا فیلترهای سال/زبان را بازبینی کنید.</div>`
      : `<div class="parse-result success" style="margin-top:10px">✅ چک Recall: هر ${knownDois.length} مقاله‌ی شناخته‌شده توسط استراتژی شما پیدا شد.</div>`;
  }

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

  logPrismaDuplicates(exactDupes + fuzzyDupes);
  saveToStorage();

  statusEl.innerHTML = renderSourceProgress(resultsBySource, errorsBySource, null, {
    added, dupes: exactDupes + fuzzyDupes, exactDupes, fuzzyDupes
  }) + recallCheckHTML;

  if (added > 0) {
    showToast(`✅ ${added} مقاله جدید اضافه شد — می‌توانید به غربال‌گری بروید`, 'success');
    switchTab('papers');
  } else if (allResults.length > 0) {
    showToast('⚠ همه نتایج داپلیکیت بودند، مقاله جدیدی اضافه نشد', 'error');
  } else {
    showToast('⚠ هیچ نتیجه‌ای پیدا نشد — کوئری‌ها را بازبینی کنید', 'error');
  }
}

function renderSourceProgress(resultsBySource, errorsBySource, loadingNow, summary) {
  const allNames = ['PubMed', 'Europe PMC', 'Semantic Scholar', 'OpenAlex', 'Crossref', 'ClinicalTrials.gov'];
  const items = allNames.map(name => {
    if (loadingNow === name) return `<div class="sb-item">⏳ ${name}...</div>`;
    if (errorsBySource[name]) return `<div class="sb-item" style="color:var(--red)">❌ ${name}: خطا</div>`;
    if (resultsBySource[name] !== undefined) return `<div class="sb-item">✅ ${name}: ${resultsBySource[name].length}</div>`;
    return `<div class="sb-item" style="opacity:.5">${name}: در صف</div>`;
  }).join('');

  const summaryHTML = summary
    ? `<div style="margin-top:10px;font-size:13px"><strong>${summary.added}</strong> مقاله جدید اضافه شد | <strong>${summary.dupes}</strong> داپلیکیت حذف شد (${summary.exactDupes} دقیق بر اساس DOI + ${summary.fuzzyDupes} احتمالی بر اساس شباهت عنوان)</div>`
    : '';

  return `<div class="source-breakdown">${items}</div>${summaryHTML}`;
}
