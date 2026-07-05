// parsers.js — تجزیه فایل‌های مرجع (RIS, BibTeX) و تشخیص داپلیکیت هوشمند

// ===== RIS Parser (فرمت استاندارد خروجی Zotero / EndNote / PubMed / Scopus) =====
function parseRIS(text) {
  const records = text.split(/\r?\n(?=TY  -)/).filter(r => r.trim());
  const papers = [];

  records.forEach(rec => {
    const lines = rec.split(/\r?\n/);
    const p = { title: '', author: '', year: '', doi: '', journal: '', abstract: '', authors: [] };

    lines.forEach(line => {
      const m = line.match(/^([A-Z][A-Z0-9])  - (.*)$/);
      if (!m) return;
      const [, tag, val] = m;
      switch (tag) {
        case 'TI': case 'T1': p.title = val.trim(); break;
        case 'AU': case 'A1': p.authors.push(val.trim()); break;
        case 'PY': case 'Y1': p.year = (val.match(/\d{4}/) || [''])[0]; break;
        case 'DO': p.doi = val.trim().replace(/^https?:\/\/doi\.org\//, ''); break;
        case 'JO': case 'JF': case 'T2': if (!p.journal) p.journal = val.trim(); break;
        case 'AB': case 'N2': p.abstract = (p.abstract ? p.abstract + ' ' : '') + val.trim(); break;
      }
    });

    if (p.title) {
      p.author = p.authors.length ? (p.authors[0] + (p.authors.length > 1 ? ' et al.' : '')) : '';
      papers.push(p);
    }
  });

  return papers;
}

// ===== BibTeX Parser (خروجی Google Scholar / Zotero) =====
function parseBibTeX(text) {
  const entries = text.split(/@\w+\s*\{/).slice(1);
  const papers = [];

  entries.forEach(entry => {
    const fields = {};
    // استخراج field=value با پشتیبانی از {} تو در تو ساده
    const fieldRegex = /(\w+)\s*=\s*[{"]([^}"]*)[}"]/g;
    let m;
    while ((m = fieldRegex.exec(entry)) !== null) {
      fields[m[1].toLowerCase()] = m[2].trim();
    }

    if (fields.title) {
      papers.push({
        title: fields.title.replace(/[{}]/g, ''),
        author: fields.author ? fields.author.split(' and ')[0].trim() + (fields.author.includes(' and ') ? ' et al.' : '') : '',
        year: fields.year || '',
        doi: fields.doi || '',
        journal: fields.journal || fields.booktitle || '',
        abstract: fields.abstract || ''
      });
    }
  });

  return papers;
}

// ===== CSV Parser ساده (عنوان,نویسنده,سال,DOI,مجله) =====
function parseCSVImport(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];

  // تشخیص هدر
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('title') || firstLine.includes('عنوان') || firstLine.includes('doi');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map(line => {
    const cells = parseCSVLine(line);
    return {
      title: cells[0] || '',
      author: cells[1] || '',
      year: cells[2] || '',
      doi: cells[3] || '',
      journal: cells[4] || '',
      abstract: cells[5] || ''
    };
  }).filter(p => p.title);
}

function parseCSVLine(line) {
  const cells = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { cells.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells;
}

// ===== تشخیص فرمت خودکار =====
function detectAndParse(text) {
  const trimmed = text.trim();
  if (/^TY  -/m.test(trimmed)) return { format: 'RIS', papers: parseRIS(trimmed) };
  if (/^@\w+\s*\{/.test(trimmed)) return { format: 'BibTeX', papers: parseBibTeX(trimmed) };
  if (trimmed.includes(',') || trimmed.includes('|')) {
    if (trimmed.includes('|')) {
      // فرمت ساده pipe-delimited قبلی
      const papers = trimmed.split('\n').filter(l => l.trim()).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { title: parts[0] || '', author: parts[1] || '', year: parts[2] || '', doi: parts[3] || '', journal: parts[4] || '', abstract: '' };
      });
      return { format: 'Pipe-delimited', papers };
    }
    return { format: 'CSV', papers: parseCSVImport(trimmed) };
  }
  return { format: 'نامشخص', papers: [] };
}

// ===== تشخیص داپلیکیت هوشمند (DOI دقیق + عنوان فازی) =====
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// فاصله Levenshtein ساده برای تشخیص شباهت عنوان
function titleSimilarity(a, b) {
  const s1 = normalizeTitle(a), s2 = normalizeTitle(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1;

  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[a.length][b.length];
}

// چک داپلیکیت کامل: برمی‌گرداند { isDupe, isFuzzy, match }
function checkDuplicate(paper, existingPapers) {
  // ۱. تطابق دقیق DOI
  if (paper.doi) {
    const exact = existingPapers.find(p => p.doi && p.doi.toLowerCase() === paper.doi.toLowerCase());
    if (exact) return { isDupe: true, isFuzzy: false, match: exact, reason: 'DOI یکسان' };
  }

  // ۲. شباهت بالای عنوان (آستانه ۸۸٪) + همان سال در صورت وجود
  for (const existing of existingPapers) {
    const sim = titleSimilarity(paper.title, existing.title);
    if (sim >= 0.88) {
      const sameYear = !paper.year || !existing.year || paper.year === existing.year;
      if (sameYear) return { isDupe: true, isFuzzy: true, match: existing, reason: `شباهت عنوان ${Math.round(sim * 100)}٪` };
    }
  }

  return { isDupe: false, isFuzzy: false, match: null };
}

// ===== خروجی RIS (غنی‌شده — شامل وضعیت غربال‌گری، استدلال AI، لینک و منبع) =====
function papersToRIS(papers) {
  return papers.map(p => {
    const lines = ['TY  - JOUR'];
    if (p.title) lines.push(`TI  - ${p.title}`);
    if (p.author) lines.push(`AU  - ${p.author.replace(' et al.', '')}`);
    if (p.year) lines.push(`PY  - ${p.year}`);
    if (p.journal) lines.push(`JO  - ${p.journal}`);
    if (p.doi) lines.push(`DO  - ${p.doi}`);
    if (p.abstract) lines.push(`AB  - ${p.abstract}`);
    if (p.sourceUrl) lines.push(`UR  - ${p.sourceUrl}`);
    if (p.fullTextUrl) lines.push(`L1  - ${p.fullTextUrl}`);
    if (p.source) lines.push(`DB  - ${p.source}`);
    const statusLabels = { included: 'Included', excluded: 'Excluded', pending: 'Pending review', unscreened: 'Not screened' };
    const noteBits = [`Screening status: ${statusLabels[p.status] || p.status}`];
    if (p.aiReason) noteBits.push(`AI summary: ${p.aiReason}`);
    lines.push(`N1  - ${noteBits.join(' | ')}`);
    lines.push('ER  - ');
    return lines.join('\n');
  }).join('\n\n');
}

// ===== خروجی BibTeX =====
function papersToBibTeX(papers) {
  const slugify = (p, i) => {
    const authorPart = (p.author || 'unknown').split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '') || 'unknown';
    return `${authorPart}${p.year || ''}_${i}`.toLowerCase();
  };
  const esc = s => (s || '').replace(/[{}]/g, '');
  return papers.map((p, i) => {
    const fields = [];
    if (p.author) fields.push(`  author = {${esc(p.author.replace(' et al.', ''))}}`);
    if (p.title) fields.push(`  title = {${esc(p.title)}}`);
    if (p.journal) fields.push(`  journal = {${esc(p.journal)}}`);
    if (p.year) fields.push(`  year = {${p.year}}`);
    if (p.doi) fields.push(`  doi = {${p.doi}}`);
    if (p.sourceUrl) fields.push(`  url = {${p.sourceUrl}}`);
    if (p.abstract) fields.push(`  abstract = {${esc(p.abstract)}}`);
    return `@article{${slugify(p, i)},\n${fields.join(',\n')}\n}`;
  }).join('\n\n');
}
