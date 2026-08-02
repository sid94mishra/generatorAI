// ────────────────────────────────────────────────────────────────
// browser-host — Native Chromium WebContentsView manager for the
// GeneratorAI desktop app. Phase 2 of INTEGRATED_BROWSER_IMPLEMENTATION_PLAN.
//
// This is intentionally minimal: it owns a Map<workspaceId, WebContentsView>
// and positions each view as a floating child of the main BrowserWindow at
// coordinates supplied by the renderer via IPC. All expensive concerns
// (agent CDP attach, popup gating, cert overrides, per-workspace session
// partitioning) are deferred to Phase 3.
//
// Feature flag: only active when `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`.
// When inactive, `isEnabled()` returns false and none of the IPC handlers
// do anything — the SPA continues to use the server-Playwright screencast
// path, preserving parity with the web build.
// ────────────────────────────────────────────────────────────────

import { WebContentsView, session as electronSession } from 'electron';
import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { log } from './logger';
import { ScopedCdpProxy } from './cdp/ScopedCdpProxy';
import { getIpcToken } from './cdp/ipc-token';
import { getServerManager } from './server-manager';
import type {
  BrowserBounds,
  BrowserEmulationParams,
  BrowserPickResult,
  BrowserAnnotatePollResult,
  NativeBrowserDescriptor,
  NativeBrowserEvent,
} from '../shared/browser-ipc';

// The embedded server can still be starting (or restarting after a crash)
// when a browser tab activates, so the endpoint push gets a few tries
// before we give up and discard the proxy.
const CDP_ENDPOINT_PUSH_ATTEMPTS = 3;
const CDP_ENDPOINT_PUSH_BACKOFF_MS = [250, 1000];

// Well-known OAuth/SSO login-popup hosts. Deliberately a short, curated
// list of the providers agents actually hit in practice — not an attempt
// at exhaustive coverage. Add to this list rather than loosening the
// same-origin default.
const KNOWN_OAUTH_PROVIDER_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'github.com',
  'appleid.apple.com',
  'www.facebook.com',
  'facebook.com',
  'login.okta.com',
  'auth0.com',
];

function isKnownOAuthProvider(hostname: string): boolean {
  return KNOWN_OAUTH_PROVIDER_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

interface Session {
  /** Globally-unique tab id — the primary key for every host operation. */
  tabId: string;
  /** Owning workspace. Only the active tab of a workspace carries the
   *  durable `gai-<workspaceId>` discovery marker the server binds to. */
  workspaceId: string;
  view: WebContentsView;
  visible: boolean;
  lastBounds: BrowserBounds | null;
}

// ────────────────────────────────────────────────────────────────
// ANNOTATE_SCRIPT — idempotent, theme-aware in-page annotation overlay
// installed into the WebContentsView. Because the WCV paints on top of the
// SPA's DOM, the comment UI must live inside the page. Exposes
// `window.__GAI_ANNO` with start(theme)/stop/count/list/clear/remove/
// region/take. Pins glue to their target (element rect, or a page-anchored
// region) on scroll; each pin opens a draggable comment card with an "Add"
// button (no Done bar). The React chrome owns the count badge + comments
// popover (send one / send all / clear) — the in-page overlay has no bar.
// `take(keys)` serializes the requested notes AND removes them from the page
// so a sent note can never be added twice; main crops a screenshot per note.
// ────────────────────────────────────────────────────────────────
const ANNOTATE_SCRIPT = String.raw`(function(){
  if (window.__GAI_ANNO) { return; }
  var Z=2147482000, ACC='#2563eb', ACCT='#fff';
  var THEME={
    dark:{bg:'#0d1117',panel:'#161b22',text:'#e6edf3',sub:'#8b949e',border:'#30363d',input:'#010409',red:'#f85149',shadow:'rgba(1,4,9,.55)'},
    light:{bg:'#ffffff',panel:'#f6f8fa',text:'#1f2328',sub:'#57606a',border:'#d0d7de',input:'#ffffff',red:'#cf222e',shadow:'rgba(31,35,40,.18)'}
  };
  var C=THEME.dark;
  var state={active:false,items:[],seq:0,raf:0,openKey:null,pop:null,popItem:null,region:false};
  function classList(el){return (el.className&&typeof el.className==='string')?el.className.trim().split(/\s+/).filter(Boolean):[];}
  function esc(el){try{return (window.CSS&&CSS.escape)?CSS.escape(el):el;}catch(e){return el;}}
  function labelOf(el){var t=el.tagName.toLowerCase();var s=t;if(el.id)s+='#'+el.id;var c=classList(el);if(c.length)s+='.'+c.slice(0,3).join('.');return s;}
  function cssPath(el){var p=[];while(el&&el.nodeType===1&&p.length<12){var s=el.nodeName.toLowerCase();if(el.id){s+='#'+esc(el.id);p.unshift(s);break;}var c=classList(el).slice(0,3).map(function(x){return '.'+esc(x);}).join('');s+=c;var sib=el,n=1;while((sib=sib.previousElementSibling)){if(sib.nodeName===el.nodeName)n++;}s+=':nth-of-type('+n+')';p.unshift(s);el=el.parentElement;}return p.join(' > ');}
  function xp(el){var p=[];while(el&&el.nodeType===1){var i=1,sib=el.previousElementSibling;while(sib){if(sib.nodeName===el.nodeName)i++;sib=sib.previousElementSibling;}p.unshift(el.nodeName.toLowerCase()+'['+i+']');el=el.parentElement;}return '/'+p.join('/');}
  function styleOf(el){var cs=getComputedStyle(el);var o={};['display','position','box-sizing','width','height','margin','padding','border','border-radius','color','background-color','background','font-family','font-size','font-weight','line-height','text-align','flex-direction','justify-content','align-items','gap','opacity','z-index','overflow','box-shadow'].forEach(function(k){var v=cs.getPropertyValue(k);if(v&&v!=='none'&&v!=='normal'&&v!=='auto'&&v!=='0px'&&v!=='rgba(0, 0, 0, 0)')o[k]=v;});return o;}
  function isOurs(el){return !!(el&&el.closest&&el.closest('[data-gai]'));}
  var hi=document.createElement('div');hi.setAttribute('data-gai','hi');
  hi.style.cssText='position:fixed;z-index:'+(Z+1)+';pointer-events:none;outline:2px solid '+ACC+';background:rgba(37,99,235,0.12);display:none;border-radius:2px;';
  function ensureRoot(){if(!hi.parentNode)document.documentElement.appendChild(hi);}
  function pinPos(it){if(it.region){return {x:it.px-window.scrollX,y:it.py-window.scrollY,w:it.w,h:it.h};}var r=it.el.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};}
  function makePin(it){var pin=document.createElement('div');pin.setAttribute('data-gai','pin');pin.style.cssText='position:fixed;z-index:'+(Z+2)+';min-width:22px;height:22px;box-sizing:border-box;padding:0 5px;border-radius:11px 11px 11px 2px;background:'+ACC+';color:#fff;font:bold 11px system-ui;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);';pin.textContent=String(it.n);pin.onclick=function(e){e.stopPropagation();openPop(it.key);};document.documentElement.appendChild(pin);it.pin=pin;
    if(it.region){var box=document.createElement('div');box.setAttribute('data-gai','rbox');box.style.cssText='position:fixed;z-index:'+(Z+1)+';pointer-events:none;border:2px solid '+ACC+';background:rgba(37,99,235,0.08);border-radius:3px;';document.documentElement.appendChild(box);it.box=box;}
    markPin(it);}
  function markPin(it){if(it.pin)it.pin.style.background=(it.comment&&it.comment.trim())?'#1f883d':ACC;}
  function positionPin(it){var p=pinPos(it);if(it.pin){it.pin.style.left=Math.max(2,p.x)+'px';it.pin.style.top=Math.max(2,p.y-11)+'px';}if(it.box){it.box.style.left=p.x+'px';it.box.style.top=p.y+'px';it.box.style.width=p.w+'px';it.box.style.height=p.h+'px';}}
  function closePop(){if(state.pop){state.pop.remove();state.pop=null;state.popItem=null;state.openKey=null;}}
  function positionPop(){var it=state.popItem;if(!state.pop||!it)return;if(it.free){state.pop.style.left=it.free.x+'px';state.pop.style.top=it.free.y+'px';return;}var p=pinPos(it);var pw=290,ph=state.pop.offsetHeight||170;var px=p.x,py=p.y+p.h+8;if(px+pw>window.innerWidth-8)px=window.innerWidth-pw-8;if(py+ph>window.innerHeight-8)py=Math.max(8,p.y-ph-8);state.pop.style.left=Math.max(8,px)+'px';state.pop.style.top=Math.max(8,py)+'px';}
  function btn(txt,kind){var b=document.createElement('button');b.setAttribute('data-gai','x');b.textContent=txt;var base='border:0;border-radius:6px;padding:6px 12px;font:600 12px system-ui;cursor:pointer;';if(kind==='primary')b.style.cssText=base+'background:'+ACC+';color:'+ACCT+';';else if(kind==='danger')b.style.cssText='background:transparent;border:0;color:'+C.red+';cursor:pointer;font:12px system-ui;padding:6px 4px;';else b.style.cssText='background:transparent;border:0;color:'+C.sub+';cursor:pointer;font:12px system-ui;padding:6px 8px;';return b;}
  function openPop(key){closePop();var it=state.items.filter(function(x){return x.key===key;})[0];if(!it)return;state.openKey=key;
    var pop=document.createElement('div');pop.setAttribute('data-gai','pop');pop.style.cssText='position:fixed;z-index:'+(Z+4)+';width:290px;background:'+C.bg+';color:'+C.text+';border:1px solid '+C.border+';border-radius:10px;box-shadow:0 12px 36px '+C.shadow+';font:13px system-ui;overflow:hidden;';
    var hd=document.createElement('div');hd.setAttribute('data-gai','hd');hd.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:move;background:'+C.panel+';border-bottom:1px solid '+C.border+';';
    hd.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:'+ACC+';flex:0 0 auto"></span><span style="font:600 12px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">'+it.label+'</span>';
    var x=document.createElement('button');x.setAttribute('data-gai','x');x.textContent='\u2715';x.style.cssText='background:transparent;border:0;color:'+C.sub+';cursor:pointer;font-size:13px;';x.onclick=function(){closePop();};hd.appendChild(x);
    var bd=document.createElement('div');bd.style.cssText='padding:10px;';
    var meta=document.createElement('div');meta.style.cssText='font:11px system-ui;color:'+C.sub+';margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';meta.textContent=it.region?('Region '+Math.round(it.w)+'\u00d7'+Math.round(it.h)):(it.text?('\u201c'+it.text.slice(0,60)+'\u201d'):it.cssSelector);bd.appendChild(meta);
    var ta=document.createElement('textarea');ta.setAttribute('data-gai','ta');ta.value=it.comment||'';ta.placeholder='Describe the change you want\u2026';ta.style.cssText='width:100%;box-sizing:border-box;min-height:64px;resize:vertical;background:'+C.input+';color:'+C.text+';border:1px solid '+C.border+';border-radius:6px;padding:7px 9px;font:13px system-ui;outline:none;';ta.oninput=function(){it.comment=ta.value;markPin(it);};ta.onkeydown=function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();sendOne(it);}if(e.key==='Escape'){e.preventDefault();closePop();}};bd.appendChild(ta);
    var ft=document.createElement('div');ft.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:6px;';
    var del=btn('Delete','danger');del.onclick=function(){removeItem(it.key);};
    var right=document.createElement('div');right.style.cssText='display:flex;align-items:center;gap:6px;';
    var add=btn('Add','ghost');add.onclick=function(){saveClose(it);};
    var send=document.createElement('button');send.setAttribute('data-gai','x');send.title='Send this comment to chat';send.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-2px"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>Send';send.style.cssText='display:inline-flex;align-items:center;border:0;border-radius:6px;padding:6px 12px;font:600 12px system-ui;cursor:pointer;background:'+ACC+';color:'+ACCT+';';send.onclick=function(){sendOne(it);};
    right.appendChild(add);right.appendChild(send);
    ft.appendChild(del);ft.appendChild(right);bd.appendChild(ft);
    pop.appendChild(hd);pop.appendChild(bd);document.documentElement.appendChild(pop);state.pop=pop;state.popItem=it;positionPop();
    var dragging=false,ox=0,oy=0;hd.addEventListener('pointerdown',function(e){if(e.target===x)return;dragging=true;var rp=pop.getBoundingClientRect();ox=e.clientX-rp.left;oy=e.clientY-rp.top;try{hd.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});hd.addEventListener('pointermove',function(e){if(!dragging)return;it.free={x:Math.max(2,Math.min(window.innerWidth-40,e.clientX-ox)),y:Math.max(2,Math.min(window.innerHeight-40,e.clientY-oy))};pop.style.left=it.free.x+'px';pop.style.top=it.free.y+'px';});hd.addEventListener('pointerup',function(e){dragging=false;try{hd.releasePointerCapture(e.pointerId);}catch(_){}});
    setTimeout(function(){ta.focus();},0);}
  function saveClose(it){markPin(it);closePop();}
  function sendOne(it){if(!(it.comment&&it.comment.trim()))return;it.queued=true;markPin(it);closePop();}
  function regionVB(it){return {x:it.px-window.scrollX,y:it.py-window.scrollY,width:it.w,height:it.h};}
  function serialize(it){
    if(it.region){return {key:it.key,url:location.href,tag:'region',id:null,classes:[],label:it.label,text:'',cssSelector:'',xpath:'',outerHtml:'',computedStyle:{},comment:it.comment||'',boundingBox:regionVB(it)};}
    var p=pinPos(it);return {key:it.key,url:location.href,tag:it.el.tagName.toLowerCase(),id:it.el.id||null,classes:classList(it.el),label:it.label,text:it.text,cssSelector:it.cssSelector,xpath:it.xpath,outerHtml:(it.el.outerHTML||'').slice(0,20000),computedStyle:styleOf(it.el),comment:it.comment||'',boundingBox:{x:p.x,y:p.y,width:p.w,height:p.h}};}
  function removeItem(key){var i=-1;state.items.forEach(function(x,idx){if(x.key===key)i=idx;});if(i<0)return;var it=state.items[i];if(it.pin)it.pin.remove();if(it.box)it.box.remove();if(state.openKey===key)closePop();state.items.splice(i,1);renumber();}
  function renumber(){state.items.forEach(function(it,idx){it.n=idx+1;if(it.pin)it.pin.textContent=String(it.n);});}
  function addAt(el){if(!el||isOurs(el))return;var key='a'+(++state.seq);var it={key:key,el:el,n:state.items.length+1,comment:'',label:labelOf(el),text:(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,120),cssSelector:cssPath(el),xpath:xp(el)};state.items.push(it);makePin(it);positionPin(it);openPop(key);}
  function addRegion(vx,vy,w,h){var key='a'+(++state.seq);var it={key:key,region:true,n:state.items.length+1,comment:'',px:vx+window.scrollX,py:vy+window.scrollY,w:w,h:h,label:'region '+Math.round(w)+'\u00d7'+Math.round(h)};state.items.push(it);makePin(it);positionPin(it);openPop(key);}
  function onMove(e){if(!state.active||state.region)return;var el=e.target;if(!el||isOurs(el)){hi.style.display='none';return;}ensureRoot();var r=el.getBoundingClientRect();hi.style.display='block';hi.style.left=r.left+'px';hi.style.top=r.top+'px';hi.style.width=r.width+'px';hi.style.height=r.height+'px';}
  function onClick(e){if(!state.active||state.region)return;if(isOurs(e.target))return;e.preventDefault();e.stopPropagation();addAt(e.target);}
  function onKey(e){if(!state.active)return;if(e.key==='Escape'){if(state.pop)closePop();}}
  function loop(){state.raf=requestAnimationFrame(loop);state.items.forEach(positionPin);positionPop();}
  function startRegion(){if(!state.active)return;state.region=true;hi.style.display='none';
    var layer=document.createElement('div');layer.setAttribute('data-gai','rlayer');layer.style.cssText='position:fixed;inset:0;z-index:'+(Z+3)+';cursor:crosshair;background:rgba(0,0,0,0.04);';
    var sel=document.createElement('div');sel.style.cssText='position:fixed;border:2px solid '+ACC+';background:rgba(37,99,235,0.12);pointer-events:none;left:0;top:0;width:0;height:0;';layer.appendChild(sel);document.documentElement.appendChild(layer);
    var st=null;
    function md(e){e.preventDefault();st={x:e.clientX,y:e.clientY};sel.style.left=st.x+'px';sel.style.top=st.y+'px';sel.style.width='0';sel.style.height='0';}
    function mm(e){if(!st)return;var x=Math.min(st.x,e.clientX),y=Math.min(st.y,e.clientY);sel.style.left=x+'px';sel.style.top=y+'px';sel.style.width=Math.abs(e.clientX-st.x)+'px';sel.style.height=Math.abs(e.clientY-st.y)+'px';}
    function fin(){layer.remove();document.removeEventListener('keydown',esc,true);state.region=false;}
    function mu(e){if(!st){fin();return;}var x=Math.min(st.x,e.clientX),y=Math.min(st.y,e.clientY),w=Math.abs(e.clientX-st.x),h=Math.abs(e.clientY-st.y);fin();if(w>=6&&h>=6)addRegion(x,y,w,h);}
    function esc(e){if(e.key==='Escape'){fin();}}
    layer.addEventListener('mousedown',md,true);layer.addEventListener('mousemove',mm,true);layer.addEventListener('mouseup',mu,true);document.addEventListener('keydown',esc,true);}
  var api={
    start:function(theme){C=THEME[theme]||THEME.dark;if(state.active)return;state.active=true;ensureRoot();document.addEventListener('mousemove',onMove,true);document.addEventListener('click',onClick,true);document.addEventListener('keydown',onKey,true);if(!state.raf)loop();},
    setTheme:function(theme){C=THEME[theme]||THEME.dark;if(state.openKey){var k=state.openKey;openPop(k);}},
    stop:function(){state.active=false;state.region=false;document.removeEventListener('mousemove',onMove,true);document.removeEventListener('click',onClick,true);document.removeEventListener('keydown',onKey,true);hi.style.display='none';closePop();if(state.raf){cancelAnimationFrame(state.raf);state.raf=0;}},
    region:function(){startRegion();},
    count:function(){return state.items.length;},
    list:function(){return state.items.map(function(it){return {key:it.key,n:it.n,label:it.label,tag:it.region?'region':it.el.tagName.toLowerCase(),comment:it.comment||'',region:!!it.region};});},
    remove:function(key){removeItem(key);},
    clear:function(){state.items.slice().forEach(function(it){removeItem(it.key);});},
    open:function(key){openPop(key);},
    take:function(keys){var out=[],rm=[];state.items.forEach(function(it){var m=keys&&keys.length?(keys.indexOf(it.key)>=0):(it.comment&&it.comment.trim());if(m){out.push(serialize(it));rm.push(it.key);}});rm.forEach(removeItem);return out;},
    takeQueued:function(){var out=[],rm=[];state.items.forEach(function(it){if(it.queued&&it.comment&&it.comment.trim()){out.push(serialize(it));rm.push(it.key);}});rm.forEach(removeItem);return out;}
  };
  window.__GAI_ANNO=api;
})()`;

export class NativeBrowserHost extends EventEmitter {
  /** All browser tabs across all workspaces, keyed by tabId. */
  private sessions = new Map<string, Session>();
  private ownerWindow: BrowserWindow | null = null;
  /** The active (visible, agent-bound) tabId for each workspace. Only the
   *  active tab carries the `gai-<workspaceId>` discovery marker so the
   *  server-side ElectronBridgeAdapter always drives whichever tab the
   *  user is currently viewing ("follow the active tab"). */
  private activeTab = new Map<string, string>();
  /** Tabs with the in-page annotation overlay active (keyed by tabId).
   *  Used to re-inject the overlay after navigations wipe window scope. */
  private annotating = new Set<string>();
  /** Scoped CDP proxy for the currently-active tab of each workspace that
   *  has one running. Never more than one live proxy per workspace — see
   *  `ensureActiveProxy()`. Replaces the old app-wide `--remote-debugging-
   *  port` switch: each proxy exposes exactly one tab's webContents. */
  private cdpProxies = new Map<string, ScopedCdpProxy>();

  isEnabled(): boolean {
    return process.env['GENERATORAI_DESKTOP_NATIVE_BROWSER'] === '1';
  }

  attachOwnerWindow(win: BrowserWindow): void {
    // Idempotent: the IPC `create` handler re-attaches on every browser tab
    // create (the window may not have existed when registerIpc ran). Without
    // this guard each create adds another `closed` listener, tripping
    // EventEmitter's MaxListeners warning once >10 tabs are opened.
    if (this.ownerWindow === win) return;
    this.ownerWindow = win;
    // When the window is destroyed we drop everything.
    win.once('closed', () => {
      this.disposeAll();
      this.ownerWindow = null;
    });
  }

  create(tabId: string, workspaceId: string, active = false): NativeBrowserDescriptor {
    if (!this.isEnabled()) return this.blankDescriptor(tabId, workspaceId);
    if (!this.ownerWindow) throw new Error('[NativeBrowserHost] Owner window not attached yet');
    let sess = this.sessions.get(tabId);
    if (sess) {
      // Tab reuse (e.g. Start pressed again after a server-side stop).
      // Re-assert the discovery marker (active tab carries the durable
      // `gai-<workspaceId>` marker so the server adapter can find it).
      if (active) this.activeTab.set(workspaceId, tabId);
      this.applyMarker(sess);
      return this.describe(tabId);
    }

    // Per-TAB persistent partition so cookies + local storage survive across
    // sessions but stay isolated between tabs of the same workspace.
    const partition = `persist:browser-${tabId}`;
    const view = new WebContentsView({
      webPreferences: {
        session: electronSession.fromPartition(partition),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        // Prevent auto-focus stealing from the SPA during layout dance.
        // Focus flows through explicit IPC in a later phase.
        // (Electron typing: cast via Record; property exists at runtime.)
        ...( { focusOnNavigation: false } as Record<string, boolean> ),
      },
    });
    // Allow same-origin popups and a small set of well-known OAuth/SSO
    // providers (a login popup is the single most common legitimate popup
    // use case; everything else defaults to deny). Electron's default
    // child window has no URL bar at all — a popup's OS-native title bar
    // shows only its `document.title`, never the URL — so there's no
    // separate "origin-only address bar" to build; the safety property
    // ("never expose the full URL, which can carry tokens") is already
    // the platform default we're relying on here, not a custom UI.
    view.webContents.setWindowOpenHandler(({ url }) => {
      let targetHost = '';
      try { targetHost = new URL(url).hostname; } catch { return { action: 'deny' }; }
      let originHost = '';
      try { originHost = new URL(view.webContents.getURL()).hostname; } catch { /* about:blank on first popup — fall through to allowlist */ }
      if (originHost && targetHost === originHost) return { action: 'allow' };
      if (isKnownOAuthProvider(targetHost)) return { action: 'allow' };
      return { action: 'deny' };
    });
    view.webContents.on('did-create-window', (popupWindow) => {
      popupWindow.setMenuBarVisibility(false);
    });

    // Wire lifecycle events so the SPA can update its URL bar / status pill.
    // Every event carries both tabId (the addressed view) and workspaceId.
    const wc = view.webContents;
    // Chrome-like tab spinner: did-start-loading → spinner, did-stop-loading
    // → resolved (favicon/title). Emitted separately from navigation commits.
    wc.on('did-start-loading', () => {
      this.emit('loading-changed', { tabId, workspaceId, loading: true } as NativeBrowserEvent);
    });
    wc.on('did-stop-loading', () => {
      this.emit('loading-changed', { tabId, workspaceId, loading: false } as NativeBrowserEvent);
    });
    wc.on('did-navigate', (_e, url) => {
      this.emit('did-navigate', { tabId, workspaceId, url, isMainFrame: true } as NativeBrowserEvent);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      this.emit('did-navigate', { tabId, workspaceId, url, isMainFrame } as NativeBrowserEvent);
    });
    wc.on('did-finish-load', () => {
      // Re-assert the discovery marker after every load so the server-side
      // adapter can find this WCV even after it navigated away from the
      // `about:blank#gai-<id>` fragment. Active tabs get the workspace
      // marker; inactive tabs get their own tab marker.
      const s = this.sessions.get(tabId);
      if (s) this.applyMarker(s);
      // Navigations wipe the page's window scope, so re-install + re-activate
      // the annotation overlay when this tab is in annotate mode.
      if (this.annotating.has(tabId)) {
        wc.executeJavaScript(`${ANNOTATE_SCRIPT};window.__GAI_ANNO&&window.__GAI_ANNO.start()`, true).catch(() => undefined);
      }
      this.emit('did-finish-load', { tabId, workspaceId, url: wc.getURL() } as NativeBrowserEvent);
    });
    wc.on('did-fail-load', (_e, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED, benign
      this.emit('did-fail-load', { tabId, workspaceId, url, errorCode, errorDescription } as NativeBrowserEvent);
    });
    wc.on('page-title-updated', (_e, title) => {
      this.emit('title-updated', { tabId, workspaceId, title } as NativeBrowserEvent);
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.emit('favicon-updated', { tabId, workspaceId, favicon: favicons[0] } as NativeBrowserEvent);
    });

    this.ownerWindow.contentView.addChildView(view);
    // Start off-screen so we don't paint before the renderer sends bounds.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    sess = { tabId, workspaceId, view, visible: false, lastBounds: null };
    this.sessions.set(tabId, sess);
    // First tab of a workspace (or an explicit `active`) becomes the active
    // tab and inherits the workspace discovery marker.
    if (active || !this.activeTab.has(workspaceId)) this.activeTab.set(workspaceId, tabId);

    // Navigate to the marker URL BEFORE any real navigation so
    // `ElectronBridgeAdapter.discoverTargetPage()` can find this WCV via
    // `page.url()` scanning. The active tab uses the workspace fragment
    // (`#gai-<workspaceId>`) the server binds to; inactive tabs use a
    // per-tab fragment so they are never mistaken for the workspace target.
    const isActive = this.activeTab.get(workspaceId) === tabId;
    const frag = isActive ? `#gai-${workspaceId}` : `#gai-tab-${tabId}`;
    void wc.loadURL(`about:blank${frag}`).catch(() => undefined);

    log.info(`[NativeBrowserHost] created tab=${tabId} workspace=${workspaceId} active=${isActive} partition=${partition}`);
    void this.ensureActiveProxy(workspaceId);
    return this.describe(tabId);
  }

  /**
   * Ensure exactly one `ScopedCdpProxy` is running, scoped to the currently
   * active tab of `workspaceId` — never a sibling tab, never the app's main
   * window. Tears down any proxy left over from a previously-active tab of
   * this workspace first, then starts one for the new active tab if it
   * doesn't have one yet, and pushes the resulting `ws://` endpoint to the
   * embedded server so `ElectronBridgeAdapter` can reconnect to it.
   */
  private async ensureActiveProxy(workspaceId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const activeTabId = this.activeTab.get(workspaceId);
    if (!activeTabId) return;
    const sess = this.sessions.get(activeTabId);
    if (!sess) return;

    for (const [tabId, proxy] of this.cdpProxies) {
      const siblingSess = this.sessions.get(tabId);
      if (siblingSess && siblingSess.workspaceId === workspaceId && tabId !== activeTabId) {
        this.cdpProxies.delete(tabId);
        void proxy.stop().catch(() => undefined);
      }
    }

    if (this.cdpProxies.has(activeTabId)) return; // already proxying the active tab

    let proxy: ScopedCdpProxy | null = null;
    try {
      proxy = new ScopedCdpProxy(sess.view.webContents);
      const wsUrl = await proxy.start();
      this.cdpProxies.set(activeTabId, proxy);
      const pushed = await this.postCdpEndpoint(workspaceId, wsUrl);
      if (!pushed) {
        // The proxy is live but the server never learned its address, so
        // nothing can ever connect to it. Leaving it cached would strand a
        // listening socket AND make every later call sit through the
        // adapter's full discovery timeout waiting for an endpoint that is
        // never coming. Drop it instead so the next activation retries from
        // scratch.
        this.cdpProxies.delete(activeTabId);
        await proxy.stop().catch(() => undefined);
        log.warn(`[NativeBrowserHost] scoped CDP proxy discarded (endpoint push failed) tab=${activeTabId}`);
        return;
      }
      log.info(`[NativeBrowserHost] scoped CDP proxy started tab=${activeTabId} workspace=${workspaceId}`);
    } catch (err) {
      // start() can throw after the debugger was attached; make sure we do
      // not leave a half-open proxy behind on the failure path either.
      this.cdpProxies.delete(activeTabId);
      if (proxy) await proxy.stop().catch(() => undefined);
      log.warn('[NativeBrowserHost] failed to start scoped CDP proxy', err);
    }
  }

  /** Push (or clear, with `wsUrl: null`) a workspace's scoped CDP endpoint
   *  to the embedded server. Retries a few times because the server may
   *  still be coming up (or briefly restarting) when a tab activates.
   *  Returns whether the endpoint actually landed, so the caller can avoid
   *  keeping a proxy the server can never reach. A permanent failure just
   *  leaves the agent CDP path unavailable for this workspace, matching the
   *  old flag-off behavior — it never breaks the native WCV the user sees. */
  private async postCdpEndpoint(workspaceId: string, wsUrl: string | null): Promise<boolean> {
    const token = getIpcToken();
    if (!token) return false;
    for (let attempt = 0; attempt < CDP_ENDPOINT_PUSH_ATTEMPTS; attempt += 1) {
      // Re-read each attempt: a restarting server comes back on a new port.
      const base = getServerManager().url;
      if (base) {
        try {
          const res = await fetch(`${base}/internal/browser/cdp-endpoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ workspaceId, wsUrl }),
          });
          if (res.ok) return true;
          // 4xx means the request itself is wrong (bad token, bad body) —
          // retrying an identical request cannot fix that.
          if (res.status >= 400 && res.status < 500) {
            log.warn(`[NativeBrowserHost] cdp-endpoint push rejected: HTTP ${res.status}`);
            return false;
          }
          log.warn(`[NativeBrowserHost] cdp-endpoint push failed: HTTP ${res.status}`);
        } catch (err) {
          log.warn('[NativeBrowserHost] cdp-endpoint push failed', err);
        }
      }
      if (attempt < CDP_ENDPOINT_PUSH_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CDP_ENDPOINT_PUSH_BACKOFF_MS[attempt] ?? 1000));
      }
    }
    return false;
  }

  /**
   * Write the navigation-durable discovery marker into a tab's
   * `window.name`. The ACTIVE tab of a workspace carries `gai-<workspaceId>`
   * (the marker the server-side ElectronBridgeAdapter binds to); every other
   * tab carries `gai-tab-<tabId>` so it is never mistaken for the workspace
   * target. `window.name` survives same-tab cross-origin navigations, so the
   * out-of-process adapter can still find the right WCV after navigation.
   * Best-effort and idempotent: we only overwrite `window.name` when it is
   * empty or already one of our markers, so we never clobber a site value.
   */
  private applyMarker(sess: Session): void {
    const isActive = this.activeTab.get(sess.workspaceId) === sess.tabId;
    const marker = isActive ? `gai-${sess.workspaceId}` : `gai-tab-${sess.tabId}`;
    const js = `try{var m=${JSON.stringify(marker)};if(!window.name||/^gai-/.test(window.name))window.name=m;}catch(e){}`;
    // `true` = user gesture; harmless here. Fire-and-forget: discovery polls.
    sess.view.webContents.executeJavaScript(js, true).catch(() => undefined);
  }

  /**
   * Mark `tabId` as the active (visible, agent-bound) tab for its workspace.
   * Moves the durable `gai-<workspaceId>` discovery marker onto the newly
   * active tab and demotes every sibling tab to its own `gai-tab-<id>`
   * marker, so the server-side adapter re-binds to whatever the user is
   * viewing ("follow the active tab").
   */
  setActiveTab(workspaceId: string, tabId: string): void {
    if (!this.sessions.has(tabId)) return;
    this.activeTab.set(workspaceId, tabId);
    for (const s of this.sessions.values()) {
      if (s.workspaceId === workspaceId) this.applyMarker(s);
    }
    void this.ensureActiveProxy(workspaceId);
  }

  destroy(tabId: string): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const proxy = this.cdpProxies.get(tabId);
    if (proxy) {
      this.cdpProxies.delete(tabId);
      void proxy.stop().catch(() => undefined);
      if (this.activeTab.get(sess.workspaceId) === tabId) {
        void this.postCdpEndpoint(sess.workspaceId, null);
      }
    }
    try {
      if (this.ownerWindow && !this.ownerWindow.isDestroyed()) {
        this.ownerWindow.contentView.removeChildView(sess.view);
      }
    } catch { /* ignore */ }
    try {
      // Cast through unknown to invoke destroy() where Electron typings
      // vary between minor versions.
      const wc = sess.view.webContents as unknown as { destroy?: () => void; close?: () => void };
      if (typeof wc.close === 'function') wc.close();
      else if (typeof wc.destroy === 'function') wc.destroy();
    } catch { /* ignore */ }
    this.sessions.delete(tabId);
    this.annotating.delete(tabId);
    // If this was the workspace's active tab, drop the pointer so the next
    // create()/setActiveTab() promotes a sibling tab to carry the marker.
    if (this.activeTab.get(sess.workspaceId) === tabId) this.activeTab.delete(sess.workspaceId);
    log.info(`[NativeBrowserHost] destroyed tab=${tabId} workspace=${sess.workspaceId}`);
  }

  setBounds(tabId: string, bounds: BrowserBounds): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const w = Math.max(0, Math.round(bounds.width));
    const h = Math.max(0, Math.round(bounds.height));
    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));
    sess.lastBounds = { x, y, width: w, height: h };
    if (sess.visible) sess.view.setBounds({ x, y, width: w, height: h });
  }

  setVisible(tabId: string, visible: boolean): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    sess.visible = visible;
    if (!visible) {
      sess.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    } else if (sess.lastBounds) {
      sess.view.setBounds(sess.lastBounds);
    }
  }

  async navigate(tabId: string, url: string): Promise<NativeBrowserDescriptor> {
    const sess = this.sessions.get(tabId);
    if (!sess) throw new Error(`No browser tab ${tabId}`);
    // Only http(s) — mirror VSCode simple-browser's opener host allowlist
    // approach and refuse `file:`, `javascript:`, etc. for the SPA's URL bar.
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    await sess.view.webContents.loadURL(url).catch((err: unknown) => {
      log.warn('[NativeBrowserHost] loadURL failed', err);
    });
    return this.describe(tabId);
  }

  back(tabId: string): void {
    const sess = this.sessions.get(tabId);
    // Electron 33+ deprecated `webContents.goBack()` in favor of
    // `webContents.navigationHistory.goBack()`. Support both.
    const wc = sess?.view.webContents as unknown as {
      navigationHistory?: { goBack?: () => void };
      goBack?: () => void;
    };
    if (wc?.navigationHistory?.goBack) wc.navigationHistory.goBack();
    else if (typeof wc?.goBack === 'function') wc.goBack();
  }

  forward(tabId: string): void {
    const sess = this.sessions.get(tabId);
    const wc = sess?.view.webContents as unknown as {
      navigationHistory?: { goForward?: () => void };
      goForward?: () => void;
    };
    if (wc?.navigationHistory?.goForward) wc.navigationHistory.goForward();
    else if (typeof wc?.goForward === 'function') wc.goForward();
  }

  reload(tabId: string): void {
    const sess = this.sessions.get(tabId);
    sess?.view.webContents.reload();
  }

  async screenshot(tabId: string): Promise<string | null> {
    const sess = this.sessions.get(tabId);
    if (!sess) return null;
    try {
      const image = await sess.view.webContents.capturePage();
      return image.toDataURL();
    } catch (err) {
      log.warn('[NativeBrowserHost] capturePage failed', err);
      return null;
    }
  }

  /**
   * Apply Chromium device emulation to the workspace's WebContentsView
   * (the same primitive DevTools' "device toolbar" uses). Passing `null`
   * disables emulation and restores the real view metrics. This lets the
   * SPA offer responsive-design testing (mobile/tablet widths, DPR) without
   * resizing the actual native view rectangle.
   */
  setEmulation(tabId: string, params: BrowserEmulationParams | null): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const wc = sess.view.webContents;
    try {
      if (!params) {
        wc.disableDeviceEmulation();
        return;
      }
      const width = Math.max(1, Math.round(params.width));
      const height = Math.max(1, Math.round(params.height));
      wc.enableDeviceEmulation({
        screenPosition: params.mobile ? 'mobile' : 'desktop',
        screenSize: { width, height },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: params.deviceScaleFactor && params.deviceScaleFactor > 0 ? params.deviceScaleFactor : 0,
        viewSize: { width, height },
        scale: 1,
      });
    } catch (err) {
      log.warn('[NativeBrowserHost] setEmulation failed', err);
    }
  }

  /** Set the page zoom factor (1 = 100%). */
  setZoom(tabId: string, factor: number): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const clamped = Math.max(0.25, Math.min(5, factor || 1));
    try {
      sess.view.webContents.setZoomFactor(clamped);
    } catch (err) {
      log.warn('[NativeBrowserHost] setZoom failed', err);
    }
  }

  /**
   * Element picker for the native view (VS Code "select & attach to chat"
   * parity). Injects a self-contained overlay that highlights on hover and
   * shows a DevTools-style label (`div#id.class` + WxH). On click it resolves
   * with the element's identity, outer HTML and a curated set of computed CSS
   * declarations. We then capture a cropped screenshot of just that element's
   * box so the SPA can attach an image alongside the HTML/CSS — exactly like
   * VS Code's Simple Browser element attach. Runs via `executeJavaScript`
   * (returns the resolved Promise value), so it needs no CDP exposeFunction.
   * Resolves `null` if the user presses Escape.
   */
  async pickElement(tabId: string): Promise<BrowserPickResult | null> {
    const sess = this.sessions.get(tabId);
    if (!sess) return null;
    const wc = sess.view.webContents;
    const script = String.raw`(function(){return new Promise(function(resolve){
      var OV='__gai_pick_ov', TIP='__gai_pick_tip';
      function rm(id){var e=document.getElementById(id); if(e) e.remove();}
      rm(OV); rm(TIP);
      var ov=document.createElement('div'); ov.id=OV;
      ov.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;outline:2px solid #4c9aff;background:rgba(76,154,255,0.15);transition:all 40ms linear;';
      document.documentElement.appendChild(ov);
      var tip=document.createElement('div'); tip.id=TIP;
      tip.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;padding:4px 8px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117;color:#fff;border-radius:4px;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 10px rgba(0,0,0,0.4);';
      document.documentElement.appendChild(tip);
      var hover=null;
      function esc(el){try{return (window.CSS&&CSS.escape)?CSS.escape(el):el;}catch(e){return el;}}
      function classList(el){return (el.className&&typeof el.className==='string')?el.className.trim().split(/\s+/).filter(Boolean):[];}
      function label(el){var t=el.tagName.toLowerCase();var s=t;if(el.id)s+='#'+el.id;var c=classList(el);if(c.length)s+='.'+c.slice(0,3).join('.');return s;}
      function cssPath(el){var p=[];while(el&&el.nodeType===1&&p.length<12){var s=el.nodeName.toLowerCase();if(el.id){s+='#'+esc(el.id);p.unshift(s);break;}var c=classList(el).slice(0,3).map(function(x){return '.'+esc(x);}).join('');s+=c;var sib=el,n=1;while((sib=sib.previousElementSibling)){if(sib.nodeName===el.nodeName)n++;}s+=':nth-of-type('+n+')';p.unshift(s);el=el.parentElement;}return p.join(' > ');}
      function xp(el){var p=[];while(el&&el.nodeType===1){var i=1,sib=el.previousElementSibling;while(sib){if(sib.nodeName===el.nodeName)i++;sib=sib.previousElementSibling;}p.unshift(el.nodeName.toLowerCase()+'['+i+']');el=el.parentElement;}return '/'+p.join('/');}
      function style(el){var cs=getComputedStyle(el);var o={};['display','position','box-sizing','width','height','margin','padding','border','border-radius','color','background-color','background','font-family','font-size','font-weight','line-height','text-align','flex-direction','justify-content','align-items','gap','grid-template-columns','opacity','z-index','overflow','object-fit','box-shadow'].forEach(function(k){var v=cs.getPropertyValue(k);if(v&&v!=='none'&&v!=='normal'&&v!=='auto'&&v!=='0px'&&v!=='rgba(0, 0, 0, 0)')o[k]=v;});return o;}
      function mm(e){var el=e.target;if(!el||el===ov||el===tip)return;hover=el;var r=el.getBoundingClientRect();ov.style.left=r.left+'px';ov.style.top=r.top+'px';ov.style.width=r.width+'px';ov.style.height=r.height+'px';tip.textContent=label(el)+'  '+Math.round(r.width)+'\u00d7'+Math.round(r.height);var top=r.top-24;if(top<4)top=r.bottom+6;tip.style.left=Math.max(4,Math.min(window.innerWidth-320,r.left))+'px';tip.style.top=Math.max(4,top)+'px';}
      function cleanup(){document.removeEventListener('mousemove',mm,true);document.removeEventListener('click',clk,true);document.removeEventListener('keydown',key,true);rm(OV);rm(TIP);}
      function clk(e){e.preventDefault();e.stopPropagation();var el=(e.target instanceof Element)?e.target:hover;if(!el){cleanup();resolve(null);return;}var r=el.getBoundingClientRect();var out={url:location.href,tag:el.tagName.toLowerCase(),id:el.id||null,classes:classList(el),label:label(el),text:(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,300),cssSelector:cssPath(el),xpath:xp(el),outerHtml:(el.outerHTML||'').slice(0,20000),boundingBox:{x:r.left,y:r.top,width:r.width,height:r.height},computedStyle:style(el)};cleanup();resolve(out);}
      function key(e){if(e.key==='Escape'){cleanup();resolve(null);}}
      document.addEventListener('mousemove',mm,true);
      document.addEventListener('click',clk,true);
      document.addEventListener('keydown',key,true);
    });})()`;
    try {
      const result = (await wc.executeJavaScript(script, true)) as BrowserPickResult | null;
      if (!result) return null;
      // Capture a cropped screenshot of just the element's box so the SPA
      // can attach an image alongside the HTML/CSS (VS Code parity).
      try {
        const bb = result.boundingBox;
        if (bb && bb.width >= 1 && bb.height >= 1) {
          const image = await wc.capturePage({
            x: Math.max(0, Math.round(bb.x)),
            y: Math.max(0, Math.round(bb.y)),
            width: Math.max(1, Math.round(bb.width)),
            height: Math.max(1, Math.round(bb.height)),
          });
          result.screenshot = image.toDataURL();
        }
      } catch (err) {
        log.debug?.('[NativeBrowserHost] pick screenshot failed', err);
        result.screenshot = null;
      }
      return result;
    } catch (err) {
      log.warn('[NativeBrowserHost] pickElement failed', err);
      return null;
    }
  }

  /**
   * Region capture for the native view. Injects a drag-to-select overlay
   * that resolves with a viewport-relative rect, then captures just that
   * rectangle via `webContents.capturePage(rect)` and returns a PNG data
   * URL. Resolves `null` on Escape or a zero-size drag.
   */
  async captureRegion(tabId: string): Promise<string | null> {
    const sess = this.sessions.get(tabId);
    if (!sess) return null;
    const wc = sess.view.webContents;
    const dragScript = String.raw`(function(){return new Promise(function(resolve){
      var ID='__gai_cap_ov';
      var old=document.getElementById(ID); if(old) old.remove();
      var layer=document.createElement('div'); layer.id=ID;
      layer.style.cssText='position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.05);';
      var box=document.createElement('div');
      box.style.cssText='position:fixed;border:2px solid #22c55e;background:rgba(34,197,94,0.15);pointer-events:none;left:0;top:0;width:0;height:0;';
      layer.appendChild(box); document.documentElement.appendChild(layer);
      var start=null;
      function md(e){e.preventDefault();start={x:e.clientX,y:e.clientY};box.style.left=start.x+'px';box.style.top=start.y+'px';box.style.width='0px';box.style.height='0px';}
      function mm(e){if(!start)return;var x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY);box.style.left=x+'px';box.style.top=y+'px';box.style.width=Math.abs(e.clientX-start.x)+'px';box.style.height=Math.abs(e.clientY-start.y)+'px';}
      function done(rect){cleanup();resolve(rect);}
      function mu(e){if(!start){return;}var x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);if(w<6||h<6){done(null);}else{done({x:x,y:y,width:w,height:h});}}
      function key(e){if(e.key==='Escape')done(null);}
      function cleanup(){layer.removeEventListener('mousedown',md,true);layer.removeEventListener('mousemove',mm,true);layer.removeEventListener('mouseup',mu,true);document.removeEventListener('keydown',key,true);layer.remove();}
      layer.addEventListener('mousedown',md,true);
      layer.addEventListener('mousemove',mm,true);
      layer.addEventListener('mouseup',mu,true);
      document.addEventListener('keydown',key,true);
    });})()`;
    try {
      const rect = (await wc.executeJavaScript(dragScript, true)) as { x: number; y: number; width: number; height: number } | null;
      if (!rect) return null;
      const image = await wc.capturePage({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
      return image.toDataURL();
    } catch (err) {
      log.warn('[NativeBrowserHost] captureRegion failed', err);
      return null;
    }
  }

  // ── In-page annotation overlay (comment pins) ──────────────────
  //
  // Because the WebContentsView paints on top of the SPA's DOM, the review
  // UI cannot live in the workbench chrome and overlay the page — it must be
  // injected INTO the page. This overlay lets the user drop numbered comment
  // pins on elements (or a dragged region), type a note in a draggable card,
  // and press "Add" to keep it. The React chrome owns the count badge +
  // comments popover; sending drains via `annotateSend`, which removes the
  // sent notes from the page (so they can't be added twice) and crops a
  // screenshot per note. `annotatePoll` returns a lightweight list for the
  // count badge + popover.

  private async ensureAnnotate(wc: WebContentsView['webContents']): Promise<void> {
    await wc.executeJavaScript(`${ANNOTATE_SCRIPT};true`, true).catch(() => undefined);
  }

  private themeArg(theme?: string): string {
    return theme === 'light' ? "'light'" : "'dark'";
  }

  async annotateStart(tabId: string, theme?: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    this.annotating.add(tabId);
    await this.ensureAnnotate(sess.view.webContents);
    await sess.view.webContents
      .executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.start(${this.themeArg(theme)})`, true)
      .catch(() => undefined);
  }

  async annotateStop(tabId: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    this.annotating.delete(tabId);
    if (!sess) return;
    await sess.view.webContents.executeJavaScript('window.__GAI_ANNO&&window.__GAI_ANNO.stop()', true).catch(() => undefined);
  }

  async annotateRegion(tabId: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    await this.ensureAnnotate(sess.view.webContents);
    await sess.view.webContents.executeJavaScript('window.__GAI_ANNO&&window.__GAI_ANNO.region()', true).catch(() => undefined);
  }

  async annotateRemove(tabId: string, key: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess || typeof key !== 'string') return;
    await sess.view.webContents
      .executeJavaScript(`window.__GAI_ANNO&&window.__GAI_ANNO.remove(${JSON.stringify(key)})`, true)
      .catch(() => undefined);
  }

  async annotateClear(tabId: string): Promise<void> {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    await sess.view.webContents.executeJavaScript('window.__GAI_ANNO&&window.__GAI_ANNO.clear()', true).catch(() => undefined);
  }

  /**
   * Lightweight poll for the count badge + comments popover. Returns the
   * live list of notes AND drains any notes the user pressed the card's
   * "Send" button on (single-off sends) — cropping a screenshot per note —
   * so the SPA can attach them to chat without opening the list.
   */
  async annotatePoll(tabId: string): Promise<BrowserAnnotatePollResult> {
    const sess = this.sessions.get(tabId);
    if (!sess) return { total: 0, items: [], sent: [] };
    const wc = sess.view.webContents;
    try {
      if (this.annotating.has(tabId)) await this.ensureAnnotate(wc);
      const raw = (await wc.executeJavaScript(
        'window.__GAI_ANNO?(function(){var s=window.__GAI_ANNO.takeQueued();return {sent:s,total:window.__GAI_ANNO.count(),items:window.__GAI_ANNO.list()};})():{total:0,items:[],sent:[]}',
        true,
      )) as BrowserAnnotatePollResult;
      const sent = Array.isArray(raw?.sent) ? raw.sent : [];
      for (const item of sent) {
        try {
          const bb = item.boundingBox;
          if (bb && bb.width >= 1 && bb.height >= 1) {
            const image = await wc.capturePage({
              x: Math.max(0, Math.round(bb.x)),
              y: Math.max(0, Math.round(bb.y)),
              width: Math.max(1, Math.round(bb.width)),
              height: Math.max(1, Math.round(bb.height)),
            });
            item.screenshot = image.toDataURL();
          }
        } catch { item.screenshot = null; }
      }
      return { total: Number(raw?.total) || 0, items: Array.isArray(raw?.items) ? raw.items : [], sent };
    } catch {
      return { total: 0, items: [], sent: [] };
    }
  }

  /**
   * Drain the requested notes (or all commented notes when `keys` is empty),
   * crop a screenshot for each, remove them from the page, and return the
   * full serialized notes so the SPA can attach them to chat.
   */
  async annotateSend(tabId: string, keys?: string[]): Promise<BrowserPickResult[]> {
    const sess = this.sessions.get(tabId);
    if (!sess) return [];
    const wc = sess.view.webContents;
    let items: BrowserPickResult[];
    try {
      items = (await wc.executeJavaScript(
        `window.__GAI_ANNO?window.__GAI_ANNO.take(${JSON.stringify(Array.isArray(keys) ? keys : [])}):[]`,
        true,
      )) as BrowserPickResult[];
    } catch {
      return [];
    }
    if (!Array.isArray(items)) return [];
    for (const item of items) {
      try {
        const bb = item.boundingBox;
        if (bb && bb.width >= 1 && bb.height >= 1) {
          const image = await wc.capturePage({
            x: Math.max(0, Math.round(bb.x)),
            y: Math.max(0, Math.round(bb.y)),
            width: Math.max(1, Math.round(bb.width)),
            height: Math.max(1, Math.round(bb.height)),
          });
          item.screenshot = image.toDataURL();
        }
      } catch { item.screenshot = null; }
    }
    return items;
  }

  /**
   * Open Chromium DevTools for a workspace's WebContentsView. When a
   * `panel` is supplied (e.g. 'network') we best-effort switch the
   * DevTools frontend to that panel once it has booted. DevTools opens
   * in a detached window so it never overlaps the floating WCV.
   */
  openDevTools(tabId: string, panel?: string): void {
    const sess = this.sessions.get(tabId);
    if (!sess) return;
    const wc = sess.view.webContents;
    try {
      if (wc.isDevToolsOpened()) {
        if (panel) this.showDevToolsPanel(wc, panel);
        else wc.devToolsWebContents?.focus();
        return;
      }
      wc.openDevTools({ mode: 'detach' });
      if (panel) {
        wc.once('devtools-opened', () => this.showDevToolsPanel(wc, panel));
      }
      log.info(`[NativeBrowserHost] opened devtools tab=${tabId} panel=${panel ?? 'default'}`);
    } catch (err) {
      log.warn('[NativeBrowserHost] openDevTools failed', err);
    }
  }

  /**
   * Best-effort switch of the DevTools frontend to a named panel. The
   * DevTools window exposes different internal globals across Chromium
   * versions, so we try a few known entry points and swallow failures —
   * if none match, DevTools simply stays on its last-used panel.
   */
  private showDevToolsPanel(wc: WebContentsView['webContents'], panel: string): void {
    const dt = wc.devToolsWebContents;
    if (!dt) return;
    const script = `(() => { try {
      const id = ${JSON.stringify(panel)};
      const ui = globalThis.UI;
      if (ui?.viewManager?.showView) { ui.viewManager.showView(id); return true; }
      if (ui?.inspectorView?.showPanel) { ui.inspectorView.showPanel(id); return true; }
      return false;
    } catch { return false; } })()`;
    // Give the DevTools frontend a moment to finish booting before we
    // poke its internal view manager.
    setTimeout(() => { void dt.executeJavaScript(script).catch(() => undefined); }, 400);
  }

  describe(tabId: string): NativeBrowserDescriptor {
    const sess = this.sessions.get(tabId);
    if (!sess) return this.blankDescriptor(tabId, '');
    const wc = sess.view.webContents;
    const navUnknown = wc as unknown as {
      navigationHistory?: { canGoBack?: () => boolean; canGoForward?: () => boolean };
      canGoBack?: () => boolean;
      canGoForward?: () => boolean;
    };
    const canGoBack = navUnknown.navigationHistory?.canGoBack?.() ?? navUnknown.canGoBack?.() ?? false;
    const canGoForward = navUnknown.navigationHistory?.canGoForward?.() ?? navUnknown.canGoForward?.() ?? false;
    return {
      tabId,
      workspaceId: sess.workspaceId,
      currentUrl: wc.getURL() || null,
      title: wc.getTitle() || null,
      isLoading: wc.isLoading(),
      canGoBack,
      canGoForward,
      // Diagnostic only — never the real ws:// URL (it carries this tab's
      // proxy auth token). 'active' means a ScopedCdpProxy is currently
      // running for this tab; the server-side ElectronBridgeAdapter is the
      // only thing that actually connects to it.
      cdpEndpoint: this.cdpProxies.has(tabId) ? 'active' : null,
    };
  }

  disposeAll(): void {
    for (const wid of Array.from(this.sessions.keys())) {
      this.destroy(wid);
    }
  }

  private blankDescriptor(tabId: string, workspaceId: string): NativeBrowserDescriptor {
    return {
      tabId,
      workspaceId,
      currentUrl: null,
      title: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      cdpEndpoint: null,
    };
  }
}

let instance: NativeBrowserHost | null = null;
export function getNativeBrowserHost(): NativeBrowserHost {
  if (!instance) instance = new NativeBrowserHost();
  return instance;
}
