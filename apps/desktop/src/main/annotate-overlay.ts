// ────────────────────────────────────────────────────────────────
// The in-page selection overlay for browser comments (D-140, D-145).
//
// The page only SELECTS: the comment itself is written in the app, in the
// browser's Comments panel, with the same form as a Changes review comment.
// (The WebContentsView paints over the app's DOM, so anything anchored to the
// page — the hover outline, the pins — must live inside it; a text field
// inside a third-party page is the one thing that must not, because it fights
// the page for focus and keys.)
//
//   • Select mode (the toolbar's ↖): hover outlines the element under the
//     pointer with a `tag#id.class W×H` chip; a click selects it, a drag of
//     ≥ 8px selects an area. Either becomes the DRAFT — a dashed pin the app
//     opens the comment form for. Another click while a draft is open moves
//     the draft (what the user typed is kept). Esc drops the draft, or leaves
//     select mode when there is none.
//   • Saved comments are numbered pins glued to their element (or area).
//     Leaving select mode keeps them visible; the page works normally again.
//
// The page's own handlers never see a click, drag or context menu in select
// mode. Colours come from the app theme (`annotationPalette`, 06 §4.4),
// validated in main and interpolated with JSON.stringify — never raw.
//
// API (`window.__GAI_ANNO`): start(palette) · setPalette · stop · list · poll() →
// {items, pending, picked, exit} · save(key, comment, intent) · cancel(key) ·
// remove(key) · clear · open(key) · focus(key) → rect · unfocus · take(keys).
// ────────────────────────────────────────────────────────────────

import type { AnnotationPalette } from './annotation-palette';

export function annotateOverlayScript(defaults: Readonly<AnnotationPalette>): string {
  return String.raw`(function(){
  if (window.__GAI_ANNO) { return; }
  var Z=2147482000;
  var C=${JSON.stringify(defaults)};
  var SANS='-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
  var MONO='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  function rgba(h,a){return 'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')';}
  var S={active:false,items:[],seq:0,raf:0,draft:null,down:null,drag:false,exit:false,focused:null,flash:null,flashUntil:0};

  // ── element facts ────────────────────────────────────────────
  function classList(el){return (el.className&&typeof el.className==='string')?el.className.trim().split(/\s+/).filter(Boolean):[];}
  function esc(v){try{return (window.CSS&&CSS.escape)?CSS.escape(v):v;}catch(e){return v;}}
  function labelOf(el){var s=el.tagName.toLowerCase();if(el.id)s+='#'+el.id;var c=classList(el);if(c.length)s+='.'+c.slice(0,2).join('.');return s;}
  function cssPath(el){var p=[];while(el&&el.nodeType===1&&p.length<12){var s=el.nodeName.toLowerCase();if(el.id){s+='#'+esc(el.id);p.unshift(s);break;}s+=classList(el).slice(0,3).map(function(x){return '.'+esc(x);}).join('');var sib=el,n=1;while((sib=sib.previousElementSibling)){if(sib.nodeName===el.nodeName)n++;}s+=':nth-of-type('+n+')';p.unshift(s);el=el.parentElement;}return p.join(' > ');}
  function xp(el){var p=[];while(el&&el.nodeType===1){var i=1,sib=el.previousElementSibling;while(sib){if(sib.nodeName===el.nodeName)i++;sib=sib.previousElementSibling;}p.unshift(el.nodeName.toLowerCase()+'['+i+']');el=el.parentElement;}return '/'+p.join('/');}
  function styleOf(el){var cs=getComputedStyle(el);var o={};['display','position','width','height','margin','padding','border','border-radius','color','background-color','font-family','font-size','font-weight','line-height','text-align','flex-direction','justify-content','align-items','gap','opacity','box-shadow'].forEach(function(k){var v=cs.getPropertyValue(k);if(v&&v!=='none'&&v!=='normal'&&v!=='auto'&&v!=='0px'&&v!=='rgba(0, 0, 0, 0)')o[k]=v;});return o;}
  function textOf(el){return (el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,160);}
  function isOurs(el){return !!(el&&el.closest&&el.closest('[data-gai]'));}
  function mk(tag,role,css){var e=document.createElement(tag);e.setAttribute('data-gai',role);if(css)e.style.cssText=css;return e;}

  // ── hover outline + label chip, drag band ────────────────────
  var hi=mk('div','hi','position:fixed;z-index:'+(Z+1)+';pointer-events:none;display:none;border-radius:3px;box-sizing:border-box;');
  var chip=mk('div','chip','position:fixed;z-index:'+(Z+5)+';pointer-events:none;display:none;padding:2px 6px;border-radius:4px;font:500 11px/16px '+MONO+';white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis;');
  var band=mk('div','band','position:fixed;z-index:'+(Z+3)+';pointer-events:none;display:none;border-radius:3px;box-sizing:border-box;');
  function ensureRoot(){[hi,chip,band].forEach(function(n){if(!n.parentNode)document.documentElement.appendChild(n);});}
  function paintChrome(){hi.style.border='2px solid '+C.accent;hi.style.background=rgba(C.accent,0.10);chip.style.background=C.accent;chip.style.color=C.onAccent;band.style.border='2px dashed '+C.accent;band.style.background=rgba(C.accent,0.10);}
  function hideHover(){hi.style.display='none';chip.style.display='none';}
  function showHover(el){var r=el.getBoundingClientRect();if(r.width<1&&r.height<1){hideHover();return;}ensureRoot();hi.style.display='block';hi.style.left=r.left+'px';hi.style.top=r.top+'px';hi.style.width=r.width+'px';hi.style.height=r.height+'px';
    chip.textContent=labelOf(el)+'  '+Math.round(r.width)+'×'+Math.round(r.height);chip.style.display='block';var cy=r.top-22;if(cy<2)cy=Math.min(window.innerHeight-20,r.bottom+4);chip.style.left=Math.max(2,Math.min(r.left,window.innerWidth-chip.offsetWidth-4))+'px';chip.style.top=cy+'px';}

  // ── pins ─────────────────────────────────────────────────────
  function rectOf(it){if(it.region)return {x:it.px-window.scrollX,y:it.py-window.scrollY,w:it.w,h:it.h};var r=it.el.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};}
  function makePin(it){var pin=mk('div','pin','position:fixed;z-index:'+(Z+2)+';min-width:22px;height:22px;box-sizing:border-box;padding:0 6px;border-radius:11px 11px 11px 3px;font:600 11px/22px '+SANS+';text-align:center;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.35);');
    document.documentElement.appendChild(pin);it.pin=pin;var box=mk('div','box','position:fixed;z-index:'+(Z+1)+';pointer-events:none;border-radius:3px;box-sizing:border-box;display:none;');document.documentElement.appendChild(box);it.box=box;paintPin(it);}
  function paintPin(it){if(!it.pin)return;var draft=!it.saved;it.pin.textContent=draft?'+':String(it.n);it.pin.style.background=draft?C.bg:C.accent;it.pin.style.color=draft?C.accent:C.onAccent;it.pin.style.border=draft?('2px dashed '+C.accent):'0';
    if(it.box){it.box.style.border=(draft?'2px dashed ':'2px solid ')+C.accent;it.box.style.background=rgba(C.accent,draft?0.10:0.06);}}
  function boxShown(it){return !it.saved||it.region||S.focused===it||(S.flash===it&&Date.now()<S.flashUntil);}
  function offscreen(p){return p.y+p.h<0||p.y>window.innerHeight||p.x+p.w<0||p.x>window.innerWidth;}
  function placePin(it){var p=rectOf(it);var hidden=(S.focused&&S.focused!==it)||offscreen(p);if(it.pin){it.pin.style.display=hidden?'none':'block';it.pin.style.left=Math.max(2,Math.min(window.innerWidth-26,p.x-4))+'px';it.pin.style.top=Math.max(2,p.y-14)+'px';}
    if(it.box){it.box.style.display=(!hidden&&boxShown(it))?'block':'none';it.box.style.left=p.x+'px';it.box.style.top=p.y+'px';it.box.style.width=p.w+'px';it.box.style.height=p.h+'px';}}
  function saved(){return S.items.filter(function(it){return it.saved;});}
  function renumber(){saved().forEach(function(it,i){it.n=i+1;paintPin(it);});}
  function drop(it){if(it.pin)it.pin.remove();if(it.box)it.box.remove();S.items=S.items.filter(function(x){return x!==it;});if(S.draft===it)S.draft=null;renumber();}
  function find(key){return S.items.filter(function(x){return x.key===key;})[0];}

  // ── picking: click an element, or drag an area ───────────────
  function describeEl(it,el){it.region=false;it.el=el;it.label=labelOf(el);it.text=textOf(el);it.cssSelector=cssPath(el);it.xpath=xp(el);}
  function describeArea(it,x,y,w,h){it.region=true;it.el=null;it.px=x+window.scrollX;it.py=y+window.scrollY;it.w=w;it.h=h;it.label='area '+Math.round(w)+'×'+Math.round(h);it.text='';}
  function draftFor(){if(S.draft)return S.draft;var it={key:'a'+(++S.seq),saved:false,comment:'',intent:'fix'};S.items.push(it);makePin(it);S.draft=it;return it;}
  function swallow(e){if(!S.active||isOurs(e.target))return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}
  function onDown(e){if(!S.active||e.button!==0||isOurs(e.target))return;swallow(e);S.down={x:e.clientX,y:e.clientY,el:e.target};}
  function onMove(e){if(!S.active)return;if(S.down){var dx=e.clientX-S.down.x,dy=e.clientY-S.down.y;if(!S.drag&&(Math.abs(dx)>6||Math.abs(dy)>6)){S.drag=true;hideHover();}if(S.drag){ensureRoot();var x=Math.min(S.down.x,e.clientX),y=Math.min(S.down.y,e.clientY);band.style.display='block';band.style.left=x+'px';band.style.top=y+'px';band.style.width=Math.abs(dx)+'px';band.style.height=Math.abs(dy)+'px';}return;}
    var el=e.target;if(!el||isOurs(el)||el===document.documentElement||el===document.body){hideHover();return;}showHover(el);}
  function onUp(e){if(!S.active||!S.down)return;swallow(e);var d=S.down,dragged=S.drag;S.down=null;S.drag=false;band.style.display='none';
    if(dragged){var x=Math.min(d.x,e.clientX),y=Math.min(d.y,e.clientY),w=Math.abs(e.clientX-d.x),h=Math.abs(e.clientY-d.y);if(w>=8&&h>=8){var a=draftFor();describeArea(a,x,y,w,h);paintPin(a);placePin(a);S.picked=true;}return;}
    var el=d.el;if(el&&el.nodeType===1&&el!==document.documentElement&&el!==document.body){var it=draftFor();describeEl(it,el);paintPin(it);placePin(it);S.picked=true;}}
  function onKey(e){if(!S.active||e.key!=='Escape')return;e.preventDefault();e.stopPropagation();if(S.draft){drop(S.draft);}else{S.exit=true;}}
  var BLOCK=['click','dblclick','auxclick','contextmenu','mousedown','mouseup','submit','dragstart','selectstart'];
  function loop(){S.raf=requestAnimationFrame(loop);S.items.forEach(placePin);}
  function listen(on){var f=on?'addEventListener':'removeEventListener';document[f]('pointerdown',onDown,true);document[f]('pointermove',onMove,true);document[f]('pointerup',onUp,true);document[f]('keydown',onKey,true);BLOCK.forEach(function(t){document[f](t,swallow,true);});}
  function reveal(it){if(it.region){window.scrollTo({left:window.scrollX,top:Math.max(0,it.py-window.innerHeight/2+it.h/2),behavior:'instant'});}else{try{it.el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});}catch(e){it.el.scrollIntoView();}}}

  // ── serialisation ────────────────────────────────────────────
  function summary(it){return {key:it.key,n:it.saved?it.n:0,label:it.label,tag:it.region?'area':it.el.tagName.toLowerCase(),comment:it.comment||'',intent:it.intent||'fix',region:!!it.region,text:it.region?'':(it.text||'')};}
  function serialize(it){var p=rectOf(it);var vb={x:p.x,y:p.y,width:p.w,height:p.h};var base={key:it.key,n:it.n,url:location.href,title:document.title,comment:it.comment||'',intent:it.intent||'fix',boundingBox:vb,viewport:{width:window.innerWidth,height:window.innerHeight}};
    if(it.region)return Object.assign(base,{tag:'area',id:null,classes:[],label:it.label,text:'',cssSelector:'',xpath:'',outerHtml:'',computedStyle:{}});
    return Object.assign(base,{tag:it.el.tagName.toLowerCase(),id:it.el.id||null,classes:classList(it.el),label:it.label,text:it.text,cssSelector:it.cssSelector,xpath:it.xpath,outerHtml:(it.el.outerHTML||'').slice(0,8000),computedStyle:styleOf(it.el)});}

  window.__GAI_ANNO={
    start:function(p){if(p)C=p;paintChrome();S.items.forEach(paintPin);if(S.active)return;S.active=true;S.exit=false;ensureRoot();listen(true);if(!S.raf)loop();},
    setPalette:function(p){if(p)C=p;paintChrome();S.items.forEach(paintPin);},
    stop:function(){if(!S.active)return;S.active=false;S.down=null;S.drag=false;band.style.display='none';hideHover();if(S.draft)drop(S.draft);listen(false);S.items.forEach(placePin);},
    list:function(){return saved().map(summary);},
    poll:function(){var r={items:saved().map(summary),pending:S.draft?summary(S.draft):null,picked:!!S.picked,exit:S.exit};S.exit=false;S.picked=false;return r;},
    save:function(key,comment,intent){var it=find(key);if(!it||!comment)return false;it.comment=String(comment).slice(0,4000);it.intent=intent||it.intent||'fix';if(!it.saved){it.saved=true;S.draft=null;}renumber();placePin(it);return true;},
    cancel:function(key){var it=find(key);if(it&&!it.saved)drop(it);},
    remove:function(key){var it=find(key);if(it)drop(it);},
    clear:function(){S.items.slice().forEach(drop);},
    open:function(key){var it=find(key);if(!it)return;reveal(it);S.flash=it;S.flashUntil=Date.now()+1600;},
    focus:function(key){var it=find(key);if(!it)return null;hideHover();reveal(it);S.focused=it;S.items.forEach(placePin);var p=rectOf(it);var pad=32;
      var x=Math.max(0,p.x-pad),y=Math.max(0,p.y-pad-14),r=Math.min(window.innerWidth,p.x+p.w+pad),b=Math.min(window.innerHeight,p.y+p.h+pad);return {x:x,y:y,width:Math.max(1,r-x),height:Math.max(1,b-y)};},
    unfocus:function(){S.focused=null;S.items.forEach(placePin);},
    take:function(keys){var out=[];saved().forEach(function(it){if(!keys||!keys.length||keys.indexOf(it.key)>=0)out.push(serialize(it));});out.forEach(function(o){var it=find(o.key);if(it)drop(it);});return out;}
  };
})()`;
}
