// ────────────────────────────────────────────────────────────────
// InspectorScript — content script injected into the target page via CDP
// `Page.addScriptToEvaluateOnNewDocument`. Provides an inspector overlay
// that highlights hovered elements and POSTs the selection back to the
// server via a Playwright `context.exposeFunction`.
//
// Kept as a plain string constant so we can concatenate + escape safely.
// ────────────────────────────────────────────────────────────────

export const INSPECTOR_SCRIPT = String.raw`
(function() {
  'use strict';
  if (window.__generatoraiInspectorInstalled) return;
  window.__generatoraiInspectorInstalled = true;

  var STATE = { enabled: false, hoverEl: null, overlay: null, tooltip: null };

  function ensureOverlay() {
    if (STATE.overlay) return;
    var overlay = document.createElement('div');
    overlay.setAttribute('data-generatorai-inspector', 'overlay');
    overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0',
      'pointer-events:none', 'z-index:2147483647',
      'outline:2px solid #4c9aff', 'background:rgba(76,154,255,0.15)',
      'transition:all 60ms linear'
    ].join(';');
    document.documentElement.appendChild(overlay);

    var tooltip = document.createElement('div');
    tooltip.setAttribute('data-generatorai-inspector', 'tooltip');
    tooltip.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'padding:4px 8px',
      'font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'background:#0d1117', 'color:#fff', 'border-radius:4px',
      'pointer-events:none', 'z-index:2147483647',
      'max-width:60vw', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
      'box-shadow:0 2px 8px rgba(0,0,0,0.35)'
    ].join(';');
    document.documentElement.appendChild(tooltip);

    STATE.overlay = overlay;
    STATE.tooltip = tooltip;
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 12) {
      var selector = el.nodeName.toLowerCase();
      if (el.id) { selector += '#' + CSS.escape(el.id); parts.unshift(selector); break; }
      if (el.className && typeof el.className === 'string') {
        var cls = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(function(c){return '.' + CSS.escape(c);}).join('');
        selector += cls;
      }
      var sib = el, nth = 1;
      while ((sib = sib.previousElementSibling)) { if (sib.nodeName === el.nodeName) nth++; }
      selector += ':nth-of-type(' + nth + ')';
      parts.unshift(selector);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function xpath(el) {
    if (!(el instanceof Element)) return '';
    var parts = [];
    while (el && el.nodeType === 1) {
      var idx = 1;
      var sib = el.previousElementSibling;
      while (sib) { if (sib.nodeName === el.nodeName) idx++; sib = sib.previousElementSibling; }
      parts.unshift(el.nodeName.toLowerCase() + '[' + idx + ']');
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }

  function highlight(el) {
    ensureOverlay();
    if (!el || !STATE.overlay) return;
    var r = el.getBoundingClientRect();
    STATE.overlay.style.left = r.left + 'px';
    STATE.overlay.style.top = r.top + 'px';
    STATE.overlay.style.width = r.width + 'px';
    STATE.overlay.style.height = r.height + 'px';
    STATE.overlay.style.display = 'block';
    if (STATE.tooltip) {
      var tag = el.tagName.toLowerCase();
      var idStr = el.id ? '#' + el.id : '';
      var clsStr = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
      STATE.tooltip.textContent = tag + idStr + clsStr;
      STATE.tooltip.style.left = Math.min(window.innerWidth - 300, r.left) + 'px';
      STATE.tooltip.style.top = Math.max(0, r.top - 24) + 'px';
      STATE.tooltip.style.display = 'block';
    }
  }

  function hide() {
    if (STATE.overlay) STATE.overlay.style.display = 'none';
    if (STATE.tooltip) STATE.tooltip.style.display = 'none';
  }

  function onMouseMove(e) {
    if (!STATE.enabled) return;
    var el = e.target;
    if (!el || el === STATE.hoverEl) return;
    STATE.hoverEl = el;
    highlight(el);
  }

  function summarizeComputedStyle(el) {
    var cs = window.getComputedStyle(el);
    var out = {};
    var keys = ['display','position','font-family','font-size','color','background-color','padding','margin','border','width','height','opacity','z-index'];
    for (var i = 0; i < keys.length; i++) { out[keys[i]] = cs.getPropertyValue(keys[i]); }
    return out;
  }

  function onClickCapture(e) {
    if (!STATE.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!(el instanceof Element)) return;
    var rect = el.getBoundingClientRect();
    var payload = {
      url: location.href,
      cssSelector: cssPath(el),
      xpath: xpath(el),
      outerHtml: (el.outerHTML || '').slice(0, 20000),
      computedStyle: summarizeComputedStyle(el),
      boundingBox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      ts: Date.now()
    };
    try {
      var post = window.__generatoraiInspectorPost;
      if (typeof post === 'function') post(payload);
    } catch (err) { /* ignore */ }
    // Auto-disable after one capture (feels right for a "pick element" UX).
    setEnabled(false);
  }

  function setEnabled(v) {
    STATE.enabled = !!v;
    if (v) {
      ensureOverlay();
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClickCapture, true);
    } else {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClickCapture, true);
      hide();
    }
  }

  window.__generatoraiInspectorEnable = setEnabled;
})();
`;
