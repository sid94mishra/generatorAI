/* Document Studio — widget logic.
 * Plain classic script (no bundler) — vendor libs attach PDFLib / docx /
 * PptxGenJS / XLSX as globals; loaded before this file in studio.html.
 */
(function () {
  'use strict';

  // ───────────────────────── utilities ─────────────────────────
  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
  const post = (type, extra) => window.parent.postMessage(Object.assign({ type }, extra || {}), '*');
  const nowTs = () => Date.now();

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function sanitizeFilename(name) {
    return (name || 'document').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'document';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  const TYPE_META = {
    pdf: { label: 'PDF', icon: iconDoc(), addLabel: 'block' },
    docx: { label: 'Word', icon: iconWord(), addLabel: 'block' },
    pptx: { label: 'PowerPoint', icon: iconSlide(), addLabel: 'slide' },
    xlsx: { label: 'Excel', icon: iconGrid(), addLabel: 'sheet' },
  };

  // ───────────────────────── default seed ─────────────────────────
  function defaultDoc(type) {
    if (type === 'pdf' || type === 'docx') {
      return {
        title: type === 'pdf' ? 'Untitled PDF' : 'Untitled Document',
        blocks: [
          { id: uid('b'), type: 'heading', level: 1, text: type === 'pdf' ? 'Untitled PDF' : 'Untitled Document' },
          { id: uid('b'), type: 'paragraph', text: 'Start writing here, or ask the agent to draft this document for you.' },
        ],
      };
    }
    if (type === 'pptx') {
      return {
        title: 'Untitled Presentation',
        slides: [
          {
            id: uid('s'),
            title: 'Slide 1',
            elements: [
              { id: uid('e'), type: 'title', text: 'Untitled Presentation' },
              { id: uid('e'), type: 'body', text: 'Click to edit, or ask the agent to design this deck.' },
            ],
          },
        ],
      };
    }
    // xlsx
    const rows = [
      ['Column A', 'Column B', 'Column C', 'Column D'],
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '', ''],
    ];
    return { title: 'Untitled Workbook', sheets: [{ id: uid('sh'), name: 'Sheet1', rows, headerRow: true }] };
  }

  function defaultState() {
    return {
      activeType: 'docx',
      documents: {
        pdf: defaultDoc('pdf'),
        docx: defaultDoc('docx'),
        pptx: defaultDoc('pptx'),
        xlsx: defaultDoc('xlsx'),
      },
      activity: [{ id: uid('a'), ts: nowTs(), who: 'agent', message: 'Document Studio ready. Ask me to draft a PDF, Word doc, slide deck, or spreadsheet.' }],
    };
  }

  // ───────────────────────── state + commit ─────────────────────────
  let state = defaultState();
  let selectedSlideId = null;
  let selectedSheetId = null;
  let viewMode = 'edit'; // 'edit' | 'preview'
  let addMenuOpen = false;

  function activeDoc() {
    return state.documents[state.activeType];
  }

  /** Every mutation goes through here: deep-clone -> mutate -> post the WHOLE
   * state (never a partial patch, so a sibling field can never be silently
   * dropped) -> re-render. */
  function commitState(mutator, logEntry) {
    const draft = deepClone(state);
    mutator(draft);
    if (logEntry) {
      draft.activity = draft.activity.concat([{ id: uid('a'), ts: nowTs(), who: logEntry.who || 'user', message: logEntry.message }]);
    }
    state = draft;
    post('widget:state', { state });
    render();
  }

  function deepClone(v) {
    if (typeof structuredClone === 'function') return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function applyState(next) {
    if (next && typeof next === 'object' && next.documents) {
      state = next;
    }
    // Keep local selections in range.
    const doc = activeDoc();
    if (state.activeType === 'pptx' && doc && doc.slides && doc.slides.length) {
      if (!doc.slides.find((s) => s.id === selectedSlideId)) selectedSlideId = doc.slides[0].id;
    }
    if (state.activeType === 'xlsx' && doc && doc.sheets && doc.sheets.length) {
      if (!doc.sheets.find((s) => s.id === selectedSheetId)) selectedSheetId = doc.sheets[0].id;
    }
    render();
  }

  // ───────────────────────── actions (agent + user share these) ─────────────────────────
  const Actions = {
    setActiveType({ docType }) {
      requireType(docType);
      commitState((d) => { d.activeType = docType; });
    },
    setTitle({ docType, title }) {
      requireType(docType);
      if (typeof title !== 'string' || !title.trim()) throw new Error('title must be a non-empty string');
      commitState((d) => { d.documents[docType].title = title.trim(); },
        { who: 'agent', message: `Renamed ${TYPE_META[docType].label} to "${title.trim()}".` });
    },
    addNote({ text }) {
      if (!text || !String(text).trim()) throw new Error('text is required');
      commitState(() => {}, { who: 'agent', message: String(text).trim() });
    },

    // Flow documents (pdf/docx) ---------------------------------------
    addBlock({ docType, block, index }) {
      requireFlowType(docType);
      const b = normalizeBlock(block);
      commitState((d) => {
        const blocks = d.documents[docType].blocks;
        const at = clampIndex(index, blocks.length);
        blocks.splice(at, 0, b);
      }, { who: 'agent', message: `Added a ${b.type} block to ${TYPE_META[docType].label}.` });
      return { id: b.id };
    },
    updateBlock({ docType, blockId, patch }) {
      requireFlowType(docType);
      const doc = state.documents[docType];
      const block = doc.blocks.find((b) => b.id === blockId);
      if (!block) throw new Error(`no block with id "${blockId}" in ${docType}`);
      commitState((d) => {
        const b = d.documents[docType].blocks.find((x) => x.id === blockId);
        Object.assign(b, patch);
      }, { who: 'agent', message: `Updated a ${block.type} block in ${TYPE_META[docType].label}.` });
    },
    removeBlock({ docType, blockId }) {
      requireFlowType(docType);
      const doc = state.documents[docType];
      if (!doc.blocks.find((b) => b.id === blockId)) throw new Error(`no block with id "${blockId}" in ${docType}`);
      commitState((d) => {
        d.documents[docType].blocks = d.documents[docType].blocks.filter((b) => b.id !== blockId);
      }, { who: 'agent', message: `Removed a block from ${TYPE_META[docType].label}.` });
    },
    reorderBlock({ docType, blockId, toIndex }) {
      requireFlowType(docType);
      const doc = state.documents[docType];
      if (!doc.blocks.find((b) => b.id === blockId)) throw new Error(`no block with id "${blockId}" in ${docType}`);
      commitState((d) => {
        const blocks = d.documents[docType].blocks;
        const from = blocks.findIndex((b) => b.id === blockId);
        const [item] = blocks.splice(from, 1);
        blocks.splice(clampIndex(toIndex, blocks.length), 0, item);
      });
    },

    // Slides (pptx) -----------------------------------------------------
    addSlide({ index, title }) {
      const slide = { id: uid('s'), title: title || 'Slide', elements: [] };
      commitState((d) => {
        const at = clampIndex(index, d.documents.pptx.slides.length);
        d.documents.pptx.slides.splice(at, 0, slide);
      }, { who: 'agent', message: 'Added a slide.' });
      selectedSlideId = slide.id;
      return { id: slide.id };
    },
    updateSlide({ slideId, patch }) {
      const slide = state.documents.pptx.slides.find((s) => s.id === slideId);
      if (!slide) throw new Error(`no slide with id "${slideId}"`);
      commitState((d) => {
        Object.assign(d.documents.pptx.slides.find((s) => s.id === slideId), patch);
      });
    },
    removeSlide({ slideId }) {
      const slides = state.documents.pptx.slides;
      if (!slides.find((s) => s.id === slideId)) throw new Error(`no slide with id "${slideId}"`);
      if (slides.length <= 1) throw new Error('cannot remove the last remaining slide');
      commitState((d) => {
        d.documents.pptx.slides = d.documents.pptx.slides.filter((s) => s.id !== slideId);
      }, { who: 'agent', message: 'Removed a slide.' });
    },
    reorderSlide({ slideId, toIndex }) {
      const slides = state.documents.pptx.slides;
      if (!slides.find((s) => s.id === slideId)) throw new Error(`no slide with id "${slideId}"`);
      commitState((d) => {
        const arr = d.documents.pptx.slides;
        const from = arr.findIndex((s) => s.id === slideId);
        const [item] = arr.splice(from, 1);
        arr.splice(clampIndex(toIndex, arr.length), 0, item);
      });
    },
    addSlideElement({ slideId, element, index }) {
      const slide = state.documents.pptx.slides.find((s) => s.id === slideId);
      if (!slide) throw new Error(`no slide with id "${slideId}"`);
      const el = normalizeSlideElement(element);
      commitState((d) => {
        const s = d.documents.pptx.slides.find((x) => x.id === slideId);
        s.elements.splice(clampIndex(index, s.elements.length), 0, el);
      }, { who: 'agent', message: `Added a ${el.type} element to a slide.` });
      return { id: el.id };
    },
    updateSlideElement({ slideId, elementId, patch }) {
      const slide = state.documents.pptx.slides.find((s) => s.id === slideId);
      if (!slide) throw new Error(`no slide with id "${slideId}"`);
      const el = slide.elements.find((e) => e.id === elementId);
      if (!el) throw new Error(`no element with id "${elementId}" on slide "${slideId}"`);
      commitState((d) => {
        const s = d.documents.pptx.slides.find((x) => x.id === slideId);
        Object.assign(s.elements.find((e) => e.id === elementId), patch);
      });
    },
    removeSlideElement({ slideId, elementId }) {
      const slide = state.documents.pptx.slides.find((s) => s.id === slideId);
      if (!slide) throw new Error(`no slide with id "${slideId}"`);
      if (!slide.elements.find((e) => e.id === elementId)) throw new Error(`no element with id "${elementId}"`);
      commitState((d) => {
        const s = d.documents.pptx.slides.find((x) => x.id === slideId);
        s.elements = s.elements.filter((e) => e.id !== elementId);
      });
    },

    // Sheets (xlsx) -------------------------------------------------------
    addSheet({ name }) {
      const sheet = { id: uid('sh'), name: name || `Sheet${state.documents.xlsx.sheets.length + 1}`, rows: [['', '', '', '']], headerRow: false };
      commitState((d) => { d.documents.xlsx.sheets.push(sheet); }, { who: 'agent', message: `Added sheet "${sheet.name}".` });
      selectedSheetId = sheet.id;
      return { id: sheet.id };
    },
    removeSheet({ sheetId }) {
      const sheets = state.documents.xlsx.sheets;
      if (!sheets.find((s) => s.id === sheetId)) throw new Error(`no sheet with id "${sheetId}"`);
      if (sheets.length <= 1) throw new Error('cannot remove the last remaining sheet');
      commitState((d) => { d.documents.xlsx.sheets = d.documents.xlsx.sheets.filter((s) => s.id !== sheetId); },
        { who: 'agent', message: 'Removed a sheet.' });
    },
    setCell({ sheetId, row, col, value }) {
      const sheet = state.documents.xlsx.sheets.find((s) => s.id === sheetId);
      if (!sheet) throw new Error(`no sheet with id "${sheetId}"`);
      if (row < 0 || col < 0) throw new Error('row/col must be >= 0');
      commitState((d) => {
        const s = d.documents.xlsx.sheets.find((x) => x.id === sheetId);
        while (s.rows.length <= row) s.rows.push([]);
        const r = s.rows[row];
        while (r.length <= col) r.push('');
        r[col] = String(value);
      });
    },
    setSheetRows({ sheetId, rows, headerRow }) {
      const sheet = state.documents.xlsx.sheets.find((s) => s.id === sheetId);
      if (!sheet) throw new Error(`no sheet with id "${sheetId}"`);
      if (!Array.isArray(rows)) throw new Error('rows must be a 2D array');
      commitState((d) => {
        const s = d.documents.xlsx.sheets.find((x) => x.id === sheetId);
        s.rows = rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : []));
        if (typeof headerRow === 'boolean') s.headerRow = headerRow;
      }, { who: 'agent', message: `Populated sheet "${sheet.name}" with ${rows.length} rows.` });
    },

    exportDocument({ docType }) {
      requireType(docType);
      return exportDocument(docType).then((info) => {
        commitState(() => {}, { who: 'agent', message: `Exported ${info.filename} (${formatBytes(info.sizeBytes)}).` });
        return info;
      });
    },
  };

  function requireType(t) {
    if (!TYPE_META[t]) throw new Error(`unknown docType "${t}"`);
  }
  function requireFlowType(t) {
    if (t !== 'pdf' && t !== 'docx') throw new Error(`docType must be "pdf" or "docx", got "${t}"`);
  }
  function clampIndex(i, len) {
    if (typeof i !== 'number' || Number.isNaN(i)) return len;
    return Math.max(0, Math.min(len, Math.round(i)));
  }
  function normalizeBlock(block) {
    if (!block || !block.type) throw new Error('block.type is required');
    const id = uid('b');
    if (block.type === 'heading') return { id, type: 'heading', level: block.level && block.level >= 1 && block.level <= 3 ? block.level : 1, text: block.text || 'Heading' };
    if (block.type === 'paragraph') return { id, type: 'paragraph', text: block.text || '' };
    if (block.type === 'bullets') return { id, type: 'bullets', items: Array.isArray(block.items) && block.items.length ? block.items.map(String) : [''] };
    if (block.type === 'table') return { id, type: 'table', header: !!block.header, rows: Array.isArray(block.rows) && block.rows.length ? block.rows.map((r) => r.map(String)) : [['', ''], ['', '']] };
    if (block.type === 'divider') return { id, type: 'divider' };
    throw new Error(`unknown block type "${block.type}"`);
  }
  function normalizeSlideElement(el) {
    if (!el || !el.type) throw new Error('element.type is required');
    const id = uid('e');
    if (el.type === 'title') return { id, type: 'title', text: el.text || 'Title' };
    if (el.type === 'body') return { id, type: 'body', text: el.text || '' };
    if (el.type === 'bullets') return { id, type: 'bullets', items: Array.isArray(el.items) && el.items.length ? el.items.map(String) : [''] };
    if (el.type === 'table') return { id, type: 'table', rows: Array.isArray(el.rows) && el.rows.length ? el.rows.map((r) => r.map(String)) : [['', ''], ['', '']] };
    throw new Error(`unknown element type "${el.type}"`);
  }
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // ───────────────────────── icons (inline SVG, no external assets) ─────────────────────────
  function svg(paths, extra) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${paths}</svg>`;
  }
  function iconDoc() { return svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'); }
  function iconWord() { return svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m8 13 1.5 5L11 14l1.5 4L14 13"/>'); }
  function iconSlide() { return svg('<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>'); }
  function iconGrid() { return svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'); }
  function iconHeading() { return svg('<path d="M6 4v16M18 4v16M6 12h12"/>'); }
  function iconParagraph() { return svg('<path d="M4 6h16M4 12h16M4 18h10"/>'); }
  function iconBullets() { return svg('<circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/><path d="M10 6h10M10 12h10M10 18h10"/>'); }
  function iconTable() { return svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M9 4v16"/>'); }
  function iconDivider() { return svg('<path d="M4 12h16"/>'); }
  function iconTrash() { return svg('<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>'); }
  function iconUp() { return svg('<path d="m6 15 6-6 6 6"/>'); }
  function iconDown() { return svg('<path d="m6 9 6 6 6-6"/>'); }
  function iconPlus() { return svg('<path d="M12 5v14M5 12h14"/>'); }
  function iconEmpty() { return svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 'width="34" height="34"'); }

  // ───────────────────────── rendering ─────────────────────────
  function render() {
    renderTypeTabs();
    renderTitle();
    renderOutline();
    renderCanvas();
    renderActivity();
    post('widget:resize', { height: document.body.scrollHeight });
  }

  function renderTypeTabs() {
    const el = document.getElementById('typeTabs');
    el.innerHTML = Object.keys(TYPE_META).map((t) => {
      const m = TYPE_META[t];
      return `<button class="type-tab${t === state.activeType ? ' active' : ''}" data-type="${t}">${m.icon}${m.label}</button>`;
    }).join('');
    document.getElementById('addBtnLabel').textContent = 'Add ' + (state.activeType === 'pptx' ? 'slide' : state.activeType === 'xlsx' ? 'sheet' : 'block');
    document.getElementById('outlineLabel').textContent = state.activeType === 'pptx' ? 'Slides' : state.activeType === 'xlsx' ? 'Sheets' : 'Outline';
  }

  function renderTitle() {
    const input = document.getElementById('titleInput');
    const t = activeDoc().title;
    if (document.activeElement !== input) input.value = t;
  }

  // ---- Outline ----
  function renderOutline() {
    const list = document.getElementById('outlineList');
    const doc = activeDoc();
    if (state.activeType === 'pdf' || state.activeType === 'docx') {
      list.innerHTML = doc.blocks.map((b, i) => outlineRow(b.id, i, blockIcon(b), blockLabel(b))).join('') || emptyOutline('No blocks yet');
    } else if (state.activeType === 'pptx') {
      if (!doc.slides.find((s) => s.id === selectedSlideId)) selectedSlideId = doc.slides[0] && doc.slides[0].id;
      list.innerHTML = doc.slides.map((s, i) => outlineRow(s.id, i, iconSlide(), s.title || `Slide ${i + 1}`, s.id === selectedSlideId)).join('') || emptyOutline('No slides yet');
    } else {
      if (!doc.sheets.find((s) => s.id === selectedSheetId)) selectedSheetId = doc.sheets[0] && doc.sheets[0].id;
      list.innerHTML = doc.sheets.map((s, i) => outlineRow(s.id, i, iconGrid(), s.name, s.id === selectedSheetId)).join('') || emptyOutline('No sheets yet');
    }
  }
  function emptyOutline(msg) { return `<div class="activity-empty">${escapeHtml(msg)}</div>`; }
  function outlineRow(id, i, icon, label, active) {
    return `<div class="outline-item${active ? ' active' : ''}" data-outline-id="${id}">
      <span class="idx">${i + 1}</span>
      <span class="kind-dot" style="display:none"></span>
      ${icon}
      <span class="label">${escapeHtml(label)}</span>
      <span class="row-actions">
        <button class="icon-btn" data-act="up" title="Move up">${iconUp()}</button>
        <button class="icon-btn" data-act="down" title="Move down">${iconDown()}</button>
        <button class="icon-btn" data-act="del" title="Delete">${iconTrash()}</button>
      </span>
    </div>`;
  }
  function blockIcon(b) {
    return { heading: iconHeading(), paragraph: iconParagraph(), bullets: iconBullets(), table: iconTable(), divider: iconDivider() }[b.type] || iconParagraph();
  }
  function blockLabel(b) {
    if (b.type === 'heading') return b.text || 'Heading';
    if (b.type === 'paragraph') return b.text || 'Paragraph';
    if (b.type === 'bullets') return (b.items[0] || 'Bulleted list');
    if (b.type === 'table') return `Table (${b.rows.length}×${(b.rows[0] || []).length})`;
    return 'Divider';
  }

  // ---- Canvas ----
  function renderCanvas() {
    const wrap = document.getElementById('canvas');
    const doc = activeDoc();
    const preview = viewMode === 'preview';
    if (state.activeType === 'pdf' || state.activeType === 'docx') {
      wrap.innerHTML = `<div class="page" data-preview="${preview}">` + doc.blocks.map((b) => renderBlock(b, preview)).join('') +
        (doc.blocks.length === 0 ? emptyCanvas('This document is empty. Add a block, or ask the agent to draft it.') : '') + `</div>`;
    } else if (state.activeType === 'pptx') {
      renderSlideCanvas(wrap, doc, preview);
    } else {
      renderSheetCanvas(wrap, doc, preview);
    }
  }
  function emptyCanvas(msg) {
    return `<div class="canvas-empty">${iconEmpty()}<div>${escapeHtml(msg)}</div></div>`;
  }

  function renderBlock(b, preview) {
    const editable = !preview;
    const toolbar = `<div class="block-toolbar">
        <button class="icon-btn" data-act="up" title="Move up">${iconUp()}</button>
        <button class="icon-btn" data-act="down" title="Move down">${iconDown()}</button>
        <button class="icon-btn" data-act="del" title="Delete">${iconTrash()}</button>
      </div>`;
    let inner = '';
    if (b.type === 'heading') {
      const tag = 'h' + b.level;
      inner = `<${tag} class="content" data-field="text" contenteditable="${editable}">${escapeHtml(b.text)}</${tag}>`;
    } else if (b.type === 'paragraph') {
      inner = `<p class="content" data-field="text" contenteditable="${editable}">${escapeHtml(b.text)}</p>`;
    } else if (b.type === 'bullets') {
      inner = `<ul class="content" data-field="items" contenteditable="${editable}">` + b.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('') + `</ul>`;
    } else if (b.type === 'table') {
      inner = renderTableHtml(b.rows, b.header, editable) +
        (editable ? `<div style="display:flex;gap:6px;margin-top:6px;">
          <button class="btn small ghost" data-table-act="add-row">+ Row</button>
          <button class="btn small ghost" data-table-act="add-col">+ Column</button>
        </div>` : '');
    } else if (b.type === 'divider') {
      inner = `<hr class="divider-line" />`;
    }
    return `<div class="block" data-block-id="${b.id}" data-block-type="${b.type}">${editable ? toolbar : ''}${inner}</div>`;
  }

  function renderTableHtml(rows, headerOn, editable) {
    return `<table class="content">` + rows.map((r, ri) => `<tr class="${headerOn && ri === 0 ? 'header-row' : ''}">` +
      r.map((c, ci) => `<td contenteditable="${editable}" data-r="${ri}" data-c="${ci}">${escapeHtml(c)}</td>`).join('') + `</tr>`).join('') + `</table>`;
  }

  // ---- Slides ----
  function renderSlideCanvas(wrap, doc, preview) {
    const slide = doc.slides.find((s) => s.id === selectedSlideId) || doc.slides[0];
    if (!slide) { wrap.innerHTML = emptyCanvas('No slides yet. Add one, or ask the agent to design the deck.'); return; }
    const editable = !preview;
    wrap.innerHTML = `<div class="slide-stage">
      <div class="slide-frame" data-slide-id="${slide.id}">
        ${slide.elements.map((el) => renderSlideElement(el, editable)).join('') || emptyCanvas('This slide is empty.')}
      </div>
      ${editable ? `<div style="display:flex;gap:6px;margin-top:12px;">
        <div class="add-menu-wrap" style="flex:1;">
          <button class="btn small" id="addElBtn" style="width:100%;justify-content:center;">${iconPlus()} Add element</button>
          <div class="add-menu" id="addElMenu"></div>
        </div>
      </div>` : ''}
    </div>`;
  }
  function renderSlideElement(el, editable) {
    const toolbar = `<div class="block-toolbar"><button class="icon-btn" data-act="del" title="Delete">${iconTrash()}</button></div>`;
    let inner = '';
    if (el.type === 'title') inner = `<div class="title-el content" data-field="text" contenteditable="${editable}">${escapeHtml(el.text)}</div>`;
    else if (el.type === 'body') inner = `<div class="body-el content" data-field="text" contenteditable="${editable}">${escapeHtml(el.text)}</div>`;
    else if (el.type === 'bullets') inner = `<ul class="bullets-el content" data-field="items" contenteditable="${editable}">` + el.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('') + `</ul>`;
    else if (el.type === 'table') inner = renderTableHtml(el.rows, false, editable);
    return `<div class="slide-el" data-el-id="${el.id}" data-el-type="${el.type}">${editable ? toolbar : ''}${inner}</div>`;
  }

  // ---- Sheets ----
  function renderSheetCanvas(wrap, doc, preview) {
    const sheet = doc.sheets.find((s) => s.id === selectedSheetId) || doc.sheets[0];
    if (!sheet) { wrap.innerHTML = emptyCanvas('No sheets yet.'); return; }
    const editable = !preview;
    const colCount = Math.max(4, ...sheet.rows.map((r) => r.length));
    const colLetters = Array.from({ length: colCount }, (_, i) => colLetter(i));
    let html = `<div class="sheet-wrap" style="width:100%;">
      <div class="grid-scroll"><table class="grid">
        <tr><th class="rownum"></th>${colLetters.map((l) => `<th>${l}</th>`).join('')}</tr>
        ${sheet.rows.map((r, ri) => `<tr class="${sheet.headerRow && ri === 0 ? 'header-active' : ''}">
          <td class="rownum">${ri + 1}</td>
          ${colLetters.map((_, ci) => `<td class="cell" contenteditable="${editable}" data-r="${ri}" data-c="${ci}">${escapeHtml((r || [])[ci] || '')}</td>`).join('')}
        </tr>`).join('')}
      </table></div>
      ${editable ? `<div style="display:flex; gap:6px; padding:8px 10px;">
        <button class="btn small ghost" data-sheet-act="add-row">+ Row</button>
        <button class="btn small ghost" data-sheet-act="add-col">+ Column</button>
      </div>` : ''}
      <div class="sheet-tabs" id="sheetTabs">
        ${doc.sheets.map((s) => `<div class="sheet-tab${s.id === sheet.id ? ' active' : ''}" data-sheet-id="${s.id}">${escapeHtml(s.name)}</div>`).join('')}
        <button class="icon-btn" id="addSheetTabBtn" title="Add sheet">${iconPlus()}</button>
      </div>
    </div>`;
    wrap.innerHTML = html;
  }
  function colLetter(i) {
    let s = '';
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); }
    return s;
  }

  // ---- Activity ----
  function renderActivity() {
    const list = document.getElementById('activityList');
    if (!state.activity || !state.activity.length) { list.innerHTML = emptyOutline('No activity yet.'); return; }
    const items = state.activity.slice(-60).slice().reverse();
    list.innerHTML = items.map((a) => `<div class="activity-item ${a.who}">
        <div class="who">${a.who === 'agent' ? '● Agent' : '● You'}<span class="ts">${formatTime(a.ts)}</span></div>
        <div class="msg">${escapeHtml(a.message)}</div>
      </div>`).join('');
  }
  function formatTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  }

  // ───────────────────────── event wiring ─────────────────────────
  document.getElementById('typeTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.type-tab');
    if (!btn) return;
    Actions.setActiveType({ docType: btn.dataset.type });
  });

  document.getElementById('viewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    viewMode = btn.dataset.view;
    document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b === btn));
    renderCanvas();
  });
  document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === viewMode));

  const titleInput = document.getElementById('titleInput');
  titleInput.addEventListener('blur', () => {
    const v = titleInput.value.trim();
    if (v && v !== activeDoc().title) Actions.setTitle({ docType: state.activeType, title: v });
  });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

  document.getElementById('exportBtn').addEventListener('click', () => {
    Actions.exportDocument({ docType: state.activeType }).then((info) => {
      toast(`Downloaded ${info.filename}`);
    }).catch((err) => toast('Export failed: ' + err.message));
  });

  // Add-menu (blocks / slides / sheets depending on active type)
  const addBtn = document.getElementById('addBtn');
  const addMenu = document.getElementById('addMenu');
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addMenuOpen = !addMenuOpen;
    renderAddMenu();
    addMenu.classList.toggle('open', addMenuOpen);
  });
  document.addEventListener('click', () => { addMenuOpen = false; addMenu.classList.remove('open'); });
  function renderAddMenu() {
    if (state.activeType === 'pdf' || state.activeType === 'docx') {
      addMenu.innerHTML = [
        ['heading', iconHeading(), 'Heading'],
        ['paragraph', iconParagraph(), 'Paragraph'],
        ['bullets', iconBullets(), 'Bulleted list'],
        ['table', iconTable(), 'Table'],
        ['divider', iconDivider(), 'Divider'],
      ].map(([type, icon, label]) => `<button data-block-type="${type}">${icon}${label}</button>`).join('');
    } else if (state.activeType === 'pptx') {
      addMenu.innerHTML = `<button data-slide-add="1">${iconPlus()}New slide</button>`;
    } else {
      addMenu.innerHTML = `<button data-sheet-add="1">${iconPlus()}New sheet</button>`;
    }
  }
  addMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.blockType) {
      Actions.addBlock({ docType: state.activeType, block: defaultBlockFor(b.dataset.blockType) });
    } else if (b.dataset.slideAdd) {
      Actions.addSlide({});
    } else if (b.dataset.sheetAdd) {
      Actions.addSheet({});
    }
  });
  function defaultBlockFor(type) {
    if (type === 'heading') return { type: 'heading', level: 2, text: 'New heading' };
    if (type === 'paragraph') return { type: 'paragraph', text: 'New paragraph.' };
    if (type === 'bullets') return { type: 'bullets', items: ['First item'] };
    if (type === 'table') return { type: 'table', header: true, rows: [['Column 1', 'Column 2'], ['', '']] };
    return { type: 'divider' };
  }

  // Outline row interactions (select / move / delete)
  document.getElementById('outlineList').addEventListener('click', (e) => {
    const actBtn = e.target.closest('button[data-act]');
    const row = e.target.closest('.outline-item');
    if (!row) return;
    const id = row.dataset.outlineId;
    if (actBtn) {
      e.stopPropagation();
      handleOutlineAction(id, actBtn.dataset.act);
      return;
    }
    if (state.activeType === 'pptx') { selectedSlideId = id; renderOutline(); renderCanvas(); }
    else if (state.activeType === 'xlsx') { selectedSheetId = id; renderOutline(); renderCanvas(); }
    else { scrollToBlock(id); }
  });
  function scrollToBlock(id) {
    const el = document.querySelector(`.block[data-block-id="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function handleOutlineAction(id, act) {
    const t = state.activeType;
    if (t === 'pdf' || t === 'docx') {
      const blocks = activeDoc().blocks;
      const idx = blocks.findIndex((b) => b.id === id);
      if (act === 'del') Actions.removeBlock({ docType: t, blockId: id });
      else if (act === 'up' && idx > 0) Actions.reorderBlock({ docType: t, blockId: id, toIndex: idx - 1 });
      else if (act === 'down' && idx < blocks.length - 1) Actions.reorderBlock({ docType: t, blockId: id, toIndex: idx + 1 });
    } else if (t === 'pptx') {
      const slides = activeDoc().slides;
      const idx = slides.findIndex((s) => s.id === id);
      if (act === 'del' && slides.length > 1) Actions.removeSlide({ slideId: id });
      else if (act === 'up' && idx > 0) Actions.reorderSlide({ slideId: id, toIndex: idx - 1 });
      else if (act === 'down' && idx < slides.length - 1) Actions.reorderSlide({ slideId: id, toIndex: idx + 1 });
    } else {
      const sheets = activeDoc().sheets;
      if (act === 'del' && sheets.length > 1) Actions.removeSheet({ sheetId: id });
    }
  }

  // Canvas interactions: delegate for blocks, slide elements, sheet cells.
  const canvasWrap = document.getElementById('canvasWrap');
  canvasWrap.addEventListener('click', (e) => {
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      const blockEl = actBtn.closest('.block');
      const slideEl = actBtn.closest('.slide-el');
      if (blockEl) handleBlockToolbar(blockEl.dataset.blockId, actBtn.dataset.act);
      else if (slideEl) handleSlideElToolbar(slideEl.dataset.elId, actBtn.dataset.act);
      return;
    }
    const rowAdd = e.target.closest('button[data-table-act]');
    if (rowAdd) {
      const blockEl = rowAdd.closest('.block');
      if (blockEl) handleTableGrow(blockEl.dataset.blockId, rowAdd.dataset.tableAct);
    }
    const sheetAdd = e.target.closest('button[data-sheet-act]');
    if (sheetAdd) handleSheetGrow(sheetAdd.dataset.sheetAct);
    const sheetTab = e.target.closest('.sheet-tab');
    if (sheetTab) { selectedSheetId = sheetTab.dataset.sheetId; renderOutline(); renderCanvas(); }
    const addSheetTabBtn = e.target.closest('#addSheetTabBtn');
    if (addSheetTabBtn) Actions.addSheet({});
    const addElBtn = e.target.closest('#addElBtn');
    if (addElBtn) {
      e.stopPropagation();
      const menu = document.getElementById('addElMenu');
      menu.innerHTML = [
        ['title', 'Title'], ['body', 'Body text'], ['bullets', 'Bulleted list'], ['table', 'Table'],
      ].map(([type, label]) => `<button data-el-type="${type}">${label}</button>`).join('');
      menu.classList.toggle('open');
    }
    const elTypeBtn = e.target.closest('#addElMenu button');
    if (elTypeBtn) {
      const slide = activeDoc().slides.find((s) => s.id === selectedSlideId);
      Actions.addSlideElement({ slideId: slide.id, element: defaultElementFor(elTypeBtn.dataset.elType) });
      document.getElementById('addElMenu').classList.remove('open');
    }
  });
  function defaultElementFor(type) {
    if (type === 'title') return { type: 'title', text: 'New title' };
    if (type === 'body') return { type: 'body', text: 'New text' };
    if (type === 'bullets') return { type: 'bullets', items: ['First point'] };
    return { type: 'table', rows: [['Column 1', 'Column 2'], ['', '']] };
  }
  function handleBlockToolbar(blockId, act) {
    const blocks = activeDoc().blocks;
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (act === 'del') Actions.removeBlock({ docType: state.activeType, blockId });
    else if (act === 'up' && idx > 0) Actions.reorderBlock({ docType: state.activeType, blockId, toIndex: idx - 1 });
    else if (act === 'down' && idx < blocks.length - 1) Actions.reorderBlock({ docType: state.activeType, blockId, toIndex: idx + 1 });
  }
  function handleSlideElToolbar(elId, act) {
    if (act === 'del') Actions.removeSlideElement({ slideId: selectedSlideId, elementId: elId });
  }
  function handleTableGrow(blockId, act) {
    const block = activeDoc().blocks.find((b) => b.id === blockId);
    const rows = block.rows.map((r) => r.slice());
    if (act === 'add-row') rows.push(new Array(rows[0].length).fill(''));
    else rows.forEach((r) => r.push(''));
    Actions.updateBlock({ docType: state.activeType, blockId, patch: { rows } });
  }
  function handleSheetGrow(act) {
    const sheet = activeDoc().sheets.find((s) => s.id === selectedSheetId);
    const rows = sheet.rows.map((r) => r.slice());
    if (act === 'add-row') rows.push(new Array(Math.max(4, rows[0] ? rows[0].length : 4)).fill(''));
    else rows.forEach((r) => r.push(''));
    Actions.setSheetRows({ sheetId: sheet.id, rows });
  }

  // Commit contenteditable text on blur (never on keystroke — re-rendering
  // mid-type would reset the caret position).
  canvasWrap.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el.matches('[contenteditable="true"]')) return;
    const blockEl = el.closest('.block');
    const slideEl = el.closest('.slide-el');
    const cell = el.matches('td.cell') ? el : null;
    if (blockEl) commitBlockField(blockEl, el);
    else if (slideEl) commitSlideElField(slideEl, el);
    else if (cell) commitSheetCell(cell);
    else if (el.closest('table.content')) commitTableCell(el);
  });
  function commitBlockField(blockEl, fieldEl) {
    const blockId = blockEl.dataset.blockId;
    const block = activeDoc().blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (fieldEl.dataset.field === 'text') {
      const text = fieldEl.textContent;
      if (text !== block.text) Actions.updateBlock({ docType: state.activeType, blockId, patch: { text } });
    } else if (fieldEl.dataset.field === 'items') {
      const items = Array.from(fieldEl.querySelectorAll('li')).map((li) => li.textContent);
      Actions.updateBlock({ docType: state.activeType, blockId, patch: { items: items.length ? items : [''] } });
    }
  }
  function commitSlideElField(slideEl, fieldEl) {
    const elId = slideEl.dataset.elId;
    const slide = activeDoc().slides.find((s) => s.id === selectedSlideId);
    const el = slide && slide.elements.find((x) => x.id === elId);
    if (!el) return;
    if (fieldEl.dataset.field === 'text') {
      if (fieldEl.textContent !== el.text) Actions.updateSlideElement({ slideId: slide.id, elementId: elId, patch: { text: fieldEl.textContent } });
    } else if (fieldEl.dataset.field === 'items') {
      const items = Array.from(fieldEl.querySelectorAll('li')).map((li) => li.textContent);
      Actions.updateSlideElement({ slideId: slide.id, elementId: elId, patch: { items: items.length ? items : [''] } });
    }
  }
  function commitTableCell(cellEl) {
    const blockEl = cellEl.closest('.block');
    const slideEl = cellEl.closest('.slide-el');
    const r = Number(cellEl.dataset.r), c = Number(cellEl.dataset.c);
    if (blockEl) {
      const block = activeDoc().blocks.find((b) => b.id === blockEl.dataset.blockId);
      const rows = block.rows.map((row) => row.slice());
      rows[r][c] = cellEl.textContent;
      Actions.updateBlock({ docType: state.activeType, blockId: block.id, patch: { rows } });
    } else if (slideEl) {
      const slide = activeDoc().slides.find((s) => s.id === selectedSlideId);
      const el = slide.elements.find((x) => x.id === slideEl.dataset.elId);
      const rows = el.rows.map((row) => row.slice());
      rows[r][c] = cellEl.textContent;
      Actions.updateSlideElement({ slideId: slide.id, elementId: el.id, patch: { rows } });
    }
  }
  function commitSheetCell(cellEl) {
    const r = Number(cellEl.dataset.r), c = Number(cellEl.dataset.c);
    const sheet = activeDoc().sheets.find((s) => s.id === selectedSheetId);
    Actions.setCell({ sheetId: sheet.id, row: r, col: c, value: cellEl.textContent });
  }

  // Bulleted-list keyboard handling (Enter = new item, Backspace on empty = remove).
  // NOTE: keydown's e.target on a contenteditable region is always the
  // contenteditable ROOT (the <ul>), never the individual <li> the caret is
  // actually in — that only comes from the Selection API.
  canvasWrap.addEventListener('keydown', (e) => {
    const list = e.target.closest('ul.content');
    if (!list) return;
    const li = currentLi(list);
    if (e.key === 'Enter') {
      e.preventDefault();
      const newLi = document.createElement('li');
      newLi.textContent = '';
      if (li) li.after(newLi); else list.appendChild(newLi);
      placeCaret(newLi);
    } else if (e.key === 'Backspace' && li && !li.textContent && list.children.length > 1) {
      e.preventDefault();
      const prev = li.previousElementSibling;
      li.remove();
      if (prev) placeCaret(prev, true);
    }
  });
  function currentLi(list) {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    const node = sel.anchorNode;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return el ? el.closest('li') : null;
  }
  function placeCaret(el, atEnd) {
    // A plain <li> isn't independently focusable — the enclosing
    // contenteditable <ul> keeps DOM focus throughout; only the Selection
    // Range needs to move. Calling el.focus() here is a silent no-op at
    // best, so don't rely on it.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Feedback box
  const feedbackText = document.getElementById('feedbackText');
  document.getElementById('askBtn').addEventListener('click', () => {
    const v = feedbackText.value.trim();
    if (!v) return;
    post('widget:followup-prompt', { text: v });
    commitState(() => {}, { who: 'user', message: v });
    feedbackText.value = '';
    toast('Sent to the agent');
  });
  document.getElementById('noteBtn').addEventListener('click', () => {
    const v = feedbackText.value.trim();
    if (!v) return;
    post('widget:context', { content: v });
    commitState(() => {}, { who: 'user', message: v + ' (note)' });
    feedbackText.value = '';
    toast('Saved for their next reply');
  });

  // ───────────────────────── export (real files via vendored libs) ─────────────────────────
  function exportDocument(docType) {
    if (docType === 'pdf') return exportPdf(state.documents.pdf);
    if (docType === 'docx') return exportDocx(state.documents.docx);
    if (docType === 'pptx') return exportPptx(state.documents.pptx);
    return exportXlsx(state.documents.xlsx);
  }

  async function exportPdf(doc) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const margin = 56, pageW = 612, pageH = 792, contentW = pageW - margin * 2;
    let page = pdf.addPage([pageW, pageH]);
    let y = pageH - margin;

    function ensureSpace(h) {
      if (y - h < margin) { page = pdf.addPage([pageW, pageH]); y = pageH - margin; }
    }
    function wrapText(text, f, size, maxW) {
      const words = String(text || '').split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      for (const w of words) {
        const candidate = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(candidate, size) > maxW && line) { lines.push(line); line = w; }
        else line = candidate;
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }
    function drawParagraphLines(lines, f, size, lh, indent) {
      for (const line of lines) {
        ensureSpace(lh);
        page.drawText(line, { x: margin + (indent || 0), y: y - lh + (lh - size), size, font: f, color: rgb(0.11, 0.13, 0.15) });
        y -= lh;
      }
    }

    for (const b of doc.blocks) {
      if (b.type === 'heading') {
        const size = b.level === 1 ? 20 : b.level === 2 ? 16 : 13;
        ensureSpace(size + 16);
        y -= 10;
        const lines = wrapText(b.text, bold, size, contentW);
        drawParagraphLines(lines, bold, size, size + 4, 0);
        y -= 4;
      } else if (b.type === 'paragraph') {
        const lines = wrapText(b.text, font, 11, contentW);
        drawParagraphLines(lines, font, 11, 15, 0);
        y -= 6;
      } else if (b.type === 'bullets') {
        for (const item of b.items) {
          const lines = wrapText(item, font, 11, contentW - 16);
          lines.forEach((line, li) => {
            ensureSpace(15);
            page.drawText((li === 0 ? '•  ' : '   ') + line, { x: margin, y: y - 15 + 4, size: 11, font, color: rgb(0.11, 0.13, 0.15) });
            y -= 15;
          });
        }
        y -= 4;
      } else if (b.type === 'table') {
        const cols = (b.rows[0] || []).length || 1;
        const colW = contentW / cols;
        const rowH = 22;
        ensureSpace(rowH * b.rows.length > pageH - margin * 2 ? pageH : rowH);
        for (let ri = 0; ri < b.rows.length; ri++) {
          ensureSpace(rowH);
          const rowTop = y;
          for (let ci = 0; ci < cols; ci++) {
            const cellText = (b.rows[ri][ci] || '').toString();
            const cx = margin + ci * colW;
            page.drawRectangle({ x: cx, y: rowTop - rowH, width: colW, height: rowH, borderColor: rgb(0.8, 0.82, 0.85), borderWidth: 1, color: b.header && ri === 0 ? rgb(0.95, 0.95, 0.97) : undefined });
            const clipped = wrapText(cellText, font, 9.5, colW - 12)[0] || '';
            page.drawText(clipped, { x: cx + 6, y: rowTop - rowH + 8, size: 9.5, font: b.header && ri === 0 ? bold : font, color: rgb(0.11, 0.13, 0.15) });
          }
          y -= rowH;
        }
        y -= 8;
      } else if (b.type === 'divider') {
        ensureSpace(14);
        page.drawLine({ start: { x: margin, y: y - 6 }, end: { x: margin + contentW, y: y - 6 }, thickness: 1, color: rgb(0.8, 0.82, 0.85) });
        y -= 14;
      }
    }

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const filename = sanitizeFilename(doc.title) + '.pdf';
    downloadBlob(blob, filename);
    return { filename, sizeBytes: blob.size };
  }

  async function exportDocx(doc) {
    const { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, Packer, BorderStyle, WidthType } = window.docx;
    const levelMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
    const children = [];
    for (const b of doc.blocks) {
      if (b.type === 'heading') {
        children.push(new Paragraph({ heading: levelMap[b.level] || HeadingLevel.HEADING_1, children: [new TextRun(b.text || '')], spacing: { before: 200, after: 100 } }));
      } else if (b.type === 'paragraph') {
        children.push(new Paragraph({ children: [new TextRun(b.text || '')], spacing: { after: 160 } }));
      } else if (b.type === 'bullets') {
        for (const item of b.items) children.push(new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 60 } }));
      } else if (b.type === 'table') {
        const rows = b.rows.map((r, ri) => new TableRow({
          children: r.map((cellText) => new TableCell({
            width: { size: Math.floor(9000 / r.length), type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: String(cellText || ''), bold: b.header && ri === 0 })] })],
          })),
        }));
        children.push(new Table({ rows, width: { size: 9000, type: WidthType.DXA } }));
        children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
      } else if (b.type === 'divider') {
        children.push(new Paragraph({ text: '', border: { bottom: { color: '999999', space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { after: 160 } }));
      }
    }
    const document = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(document);
    const filename = sanitizeFilename(doc.title) + '.docx';
    downloadBlob(blob, filename);
    return { filename, sizeBytes: blob.size };
  }

  async function exportPptx(doc) {
    const pptx = new window.PptxGenJS();
    pptx.defineLayout({ name: 'GA_16x9', width: 10, height: 5.63 });
    pptx.layout = 'GA_16x9';
    for (const slide of doc.slides) {
      const s = pptx.addSlide();
      let y = 0.4;
      for (const el of slide.elements) {
        if (el.type === 'title') { s.addText(el.text || '', { x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 28, bold: true, fontFace: 'Arial' }); y = 1.4; }
        else if (el.type === 'body') { const h = 0.4 + 0.3 * Math.ceil((el.text || '').length / 70); s.addText(el.text || '', { x: 0.5, y, w: 9, h, fontSize: 15, fontFace: 'Arial' }); y += h + 0.15; }
        else if (el.type === 'bullets') {
          const items = el.items.map((t) => ({ text: t, options: { bullet: true, breakLine: true } }));
          const h = 0.35 * el.items.length + 0.2;
          s.addText(items, { x: 0.5, y, w: 9, h, fontSize: 15, fontFace: 'Arial' });
          y += h + 0.15;
        } else if (el.type === 'table') {
          const rows = el.rows.map((r) => r.map((c) => ({ text: c, options: { fontSize: 12 } })));
          const h = 0.35 * el.rows.length;
          s.addTable(rows, { x: 0.5, y, w: 9, h, fontSize: 12, border: { type: 'solid', color: 'CCCCCC', pt: 1 } });
          y += h + 0.15;
        }
      }
    }
    const blob = await pptx.write({ outputType: 'blob' });
    const filename = sanitizeFilename(doc.title) + '.pptx';
    downloadBlob(blob, filename);
    return { filename, sizeBytes: blob.size };
  }

  async function exportXlsx(doc) {
    const wb = window.XLSX.utils.book_new();
    for (const sheet of doc.sheets) {
      const ws = window.XLSX.utils.aoa_to_sheet(sheet.rows);
      window.XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').slice(0, 31));
    }
    const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/octet-stream' });
    const filename = sanitizeFilename(doc.title) + '.xlsx';
    downloadBlob(blob, filename);
    return { filename, sizeBytes: blob.size };
  }

  // ───────────────────────── host bridge (widget:hello is mandatory) ─────────────────────────
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'widget:init') {
      applyState(m.state && m.state.documents ? m.state : state);
      post('widget:ready');
    } else if (m.type === 'widget:state') {
      applyState(m.state);
    } else if (m.type === 'widget:invoke') {
      handleInvoke(m);
    } else if (m.type === 'widget:teardown') {
      post('widget:state', { state });
      post('widget:teardown-ack', { teardownId: m.teardownId });
    }
  });

  function handleInvoke(m) {
    const { invokeId, action, args } = m;
    try {
      const fn = Actions[action];
      if (!fn) throw new Error(`unknown action "${action}"`);
      const result = fn(args || {});
      Promise.resolve(result).then((r) => post('widget:invoke-result', { invokeId, result: r || { ok: true } }))
        .catch((err) => post('widget:invoke-result', { invokeId, error: String((err && err.message) || err) }));
    } catch (err) {
      post('widget:invoke-result', { invokeId, error: String((err && err.message) || err) });
    }
  }

  // Boot — MUST be unconditional at top level, or the host never sends
  // widget:init and nothing ever renders. Wrapped so a render bug can never
  // block the handshake itself.
  try {
    render();
  } catch (err) {
    console.error('[Document Studio] initial render failed', err);
  }
  post('widget:hello');
})();
