// ────────────────────────────────────────────────────────────────
// The in-page Annotate overlay (D-140), injected into a native browser tab.
//
// The WebContentsView paints on top of the app's DOM, so anything anchored to
// the page — the hover highlight, pins, the comment card — has to live INSIDE
// the page. Everything else (the comment list, Send) is React, in the dock's
// tray under the view.
//
// Interaction, the way Codex / Cursor / Agentation do it:
//   • hover   — outline + a label chip (`button.cta · 120×40`)
//   • click   — select that element; drag (≥ 6px) — select an area
//   • either opens an anchored card: "What should change?"
//       ↵ Add comment · ⇧↵ new line · ⌘/Ctrl↵ add and send · Esc cancel
//   • a pin (numbered) stays only once a comment is added — Cancel leaves nothing
//   • a pin reopens its card to edit or delete
//   • Esc with no card open asks the host to leave Annotate mode
//   • leaving the mode hides pins (the page is usable again); comments stay
//
// The page's own handlers never see a click, drag or context menu while the
// mode is on. Colours come from the app theme (`annotationPalette`, 06 §4.4),
// validated in main and interpolated with JSON.stringify — never raw.
//
// API (`window.__GAI_ANNO`): start(palette) · setPalette · stop · list ·
// remove(key) · clear · open(key) · focus(key) → rect · unfocus · take(keys)
// · poll() → {items, exit, sendAll}.
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
  var S={active:false,items:[],seq:0,raf:0,card:null,cardItem:null,down:null,drag:null,exit:false,sendAll:false,focused:null};

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
  function host(){return document.body||document.documentElement;}

  // ── hover highlight + label chip ─────────────────────────────
  var hi=mk('div','hi','position:fixed;z-index:'+(Z+1)+';pointer-events:none;display:none;border-radius:3px;box-sizing:border-box;');
  var chip=mk('div','chip','position:fixed;z-index:'+(Z+5)+';pointer-events:none;display:none;padding:2px 6px;border-radius:4px;font:500 11px/16px '+MONO+';white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis;');
  var band=mk('div','band','position:fixed;z-index:'+(Z+3)+';pointer-events:none;display:none;border-radius:3px;box-sizing:border-box;');
  function ensureRoot(){[hi,chip,band].forEach(function(n){if(!n.parentNode)document.documentElement.appendChild(n);});}
  function paintChrome(){hi.style.border='2px solid '+C.accent;hi.style.background=rgba(C.accent,0.10);chip.style.background=C.accent;chip.style.color=C.onAccent;band.style.border='2px dashed '+C.accent;band.style.background=rgba(C.accent,0.10);}
  function hideHover(){hi.style.display='none';chip.style.display='none';}
  function showHover(el){var r=el.getBoundingClientRect();if(r.width<1&&r.height<1){hideHover();return;}hi.style.display='block';hi.style.left=r.left+'px';hi.style.top=r.top+'px';hi.style.width=r.width+'px';hi.style.height=r.height+'px';
    chip.textContent=labelOf(el)+'  '+Math.round(r.width)+'×'+Math.round(r.height);chip.style.display='block';var cy=r.top-22;if(cy<2)cy=Math.min(window.innerHeight-20,r.bottom+4);chip.style.left=Math.max(2,Math.min(r.left,window.innerWidth-chip.offsetWidth-4))+'px';chip.style.top=cy+'px';}

  // ── pins ─────────────────────────────────────────────────────
  function rectOf(it){if(it.region)return {x:it.px-window.scrollX,y:it.py-window.scrollY,w:it.w,h:it.h};var r=it.el.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};}
  function makePin(it){var pin=mk('div','pin','position:fixed;z-index:'+(Z+2)+';min-width:22px;height:22px;box-sizing:border-box;padding:0 6px;border-radius:11px 11px 11px 3px;font:600 11px/22px '+SANS+';text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);');pin.textContent=String(it.n);
    pin.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(S.active)openCard(it);},true);document.documentElement.appendChild(pin);it.pin=pin;
    var box=mk('div','box','position:fixed;z-index:'+(Z+1)+';pointer-events:none;border-radius:3px;box-sizing:border-box;display:none;');document.documentElement.appendChild(box);it.box=box;paintPin(it);}
  function paintPin(it){if(!it.pin)return;var draft=!it.saved;it.pin.style.background=draft?C.bg:C.accent;it.pin.style.color=draft?C.accent:C.onAccent;it.pin.style.border=draft?('2px solid '+C.accent):'0';if(it.box){it.box.style.border='2px solid '+C.accent;it.box.style.background=rgba(C.accent,it.region?0.08:0.06);}}
  function showBox(it){return it.region||S.cardItem===it||S.focused===it;}
  function placePin(it){var p=rectOf(it);var vis=S.active||S.focused===it;var off=(S.focused&&S.focused!==it);if(it.pin){it.pin.style.display=(vis&&!off)?'block':'none';it.pin.style.left=Math.max(2,Math.min(window.innerWidth-26,p.x-4))+'px';it.pin.style.top=Math.max(2,p.y-14)+'px';}
    if(it.box){it.box.style.display=(vis&&!off&&showBox(it))?'block':'none';it.box.style.left=p.x+'px';it.box.style.top=p.y+'px';it.box.style.width=p.w+'px';it.box.style.height=p.h+'px';}}
  function renumber(){S.items.forEach(function(it,i){it.n=i+1;if(it.pin)it.pin.textContent=String(it.n);});if(S.cardItem&&S.card){var n=S.card.querySelector('[data-gai="cn"]');if(n)n.textContent=String(S.cardItem.n);}}
  function removeItem(key){var i=-1;S.items.forEach(function(x,idx){if(x.key===key)i=idx;});if(i<0)return;var it=S.items[i];if(S.cardItem===it)closeCard();if(it.pin)it.pin.remove();if(it.box)it.box.remove();S.items.splice(i,1);renumber();}

  // ── the comment card ─────────────────────────────────────────
  function button(label,kind){var b=mk('button','btn','height:28px;padding:0 12px;border-radius:6px;font:500 12px '+SANS+';cursor:pointer;');b.type='button';b.textContent=label;
    if(kind==='primary'){b.style.background=C.accent;b.style.color=C.onAccent;b.style.border='0';}
    else if(kind==='danger'){b.style.background='transparent';b.style.color=C.danger;b.style.border='0';b.style.padding='0 6px';}
    else {b.style.background='transparent';b.style.color=C.text;b.style.border='1px solid '+C.border;}
    return b;}
  function kbd(t){return '<span style="display:inline-block;min-width:14px;padding:0 4px;border:1px solid '+C.border+';border-radius:4px;font:500 10px/15px '+MONO+';color:'+C.sub+';text-align:center">'+t+'</span>';}
  function closeCard(){var it=S.cardItem;if(S.card){S.card.remove();}S.card=null;S.cardItem=null;if(it&&!it.saved)removeItem(it.key);else if(it)placePin(it);}
  function placeCard(){var it=S.cardItem;if(!S.card||!it)return;var p=rectOf(it);var cw=S.card.offsetWidth||300,ch=S.card.offsetHeight||170;var x=p.x,y=p.y+p.h+10;
    if(y+ch>window.innerHeight-8){y=p.y-ch-10;}if(y<8){y=Math.max(8,Math.min(window.innerHeight-ch-8,p.y+12));x=p.x+p.w+10;if(x+cw>window.innerWidth-8)x=p.x-cw-10;}
    S.card.style.left=Math.max(8,Math.min(window.innerWidth-cw-8,x))+'px';S.card.style.top=Math.max(8,y)+'px';}
  var MAC=/Mac|iPhone|iPad/.test(navigator.platform||'');
  function openCard(it){if(S.card){var prev=S.cardItem;S.card.remove();S.card=null;S.cardItem=null;if(prev&&prev!==it&&!prev.saved)removeItem(prev.key);}
    S.cardItem=it;hideHover();
    var card=mk('div','card','position:fixed;z-index:'+(Z+4)+';width:300px;box-sizing:border-box;background:'+C.bg+';color:'+C.text+';border:1px solid '+C.border+';border-radius:10px;box-shadow:0 12px 32px '+C.shadow+';font:13px/1.4 '+SANS+';overflow:hidden;');
    var hd=mk('div','hd','display:flex;align-items:center;gap:8px;padding:10px 12px 0;');
    hd.innerHTML='<span data-gai="cn" style="flex:0 0 auto;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px 10px 10px 3px;background:'+C.accent+';color:'+C.onAccent+';font:600 11px/20px '+SANS+';text-align:center">'+it.n+'</span>'
      +'<span style="flex:1;min-width:0;font:500 12px '+MONO+';color:'+C.sub+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>';
    hd.lastChild.textContent=it.region?('Area '+Math.round(it.w)+'×'+Math.round(it.h)):it.label;
    var bd=mk('div','bd','padding:8px 12px 12px;');
    if(!it.region&&it.text){var q=mk('div','q','margin:0 0 8px;font:12px '+SANS+';color:'+C.sub+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');q.textContent='“'+it.text.slice(0,80)+'”';bd.appendChild(q);}
    var ta=mk('textarea','ta','display:block;width:100%;box-sizing:border-box;min-height:64px;max-height:180px;resize:vertical;margin:0;background:'+C.input+';color:'+C.text+';border:1px solid '+C.border+';border-radius:6px;padding:7px 9px;font:13px/1.45 '+SANS+';outline:none;');
    ta.placeholder=it.region?'What should change in this area?':'What should change here?';ta.value=it.comment||'';
    ta.addEventListener('focus',function(){ta.style.borderColor=C.accent;});ta.addEventListener('blur',function(){ta.style.borderColor=C.border;});
    var ft=mk('div','ft','display:flex;align-items:center;gap:8px;margin-top:10px;');
    var hint=mk('div','hint','flex:1;min-width:0;font:11px '+SANS+';color:'+C.sub+';white-space:nowrap;overflow:hidden;');hint.innerHTML=kbd('↵')+' add &nbsp;'+kbd(MAC?'⌘↵':'Ctrl ↵')+' send';
    var left=it.saved?button('Delete','danger'):null;
    var cancel=button(it.saved?'Close':'Cancel','ghost');var save=button(it.saved?'Save':'Comment','primary');
    function commit(sendNow){var v=ta.value.trim();if(!v){ta.focus();ta.style.borderColor=C.danger;return;}it.comment=v;it.saved=true;paintPin(it);if(sendNow)S.sendAll=true;S.card.remove();S.card=null;S.cardItem=null;placePin(it);}
    save.addEventListener('click',function(e){e.stopPropagation();commit(false);});
    cancel.addEventListener('click',function(e){e.stopPropagation();closeCard();});
    if(left)left.addEventListener('click',function(e){e.stopPropagation();removeItem(it.key);});
    ta.addEventListener('keydown',function(e){e.stopPropagation();if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();commit(true);return;}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commit(false);return;}if(e.key==='Escape'){e.preventDefault();closeCard();}});
    ta.addEventListener('input',function(){ta.style.borderColor=C.accent;});
    if(left)ft.appendChild(left);ft.appendChild(hint);ft.appendChild(cancel);ft.appendChild(save);
    bd.appendChild(ta);bd.appendChild(ft);card.appendChild(hd);card.appendChild(bd);
    ['pointerdown','mousedown','mouseup','click','dblclick','contextmenu','wheel'].forEach(function(t){card.addEventListener(t,function(e){e.stopPropagation();},false);});
    document.documentElement.appendChild(card);S.card=card;placePin(it);placeCard();setTimeout(function(){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);},0);}

  // ── picking: click an element, or drag an area ───────────────
  function draft(it){S.items.push(it);it.n=S.items.length;makePin(it);placePin(it);openCard(it);}
  function addElement(el){draft({key:'a'+(++S.seq),el:el,comment:'',saved:false,label:labelOf(el),text:textOf(el),cssSelector:cssPath(el),xpath:xp(el)});}
  function addArea(x,y,w,h){draft({key:'a'+(++S.seq),region:true,comment:'',saved:false,px:x+window.scrollX,py:y+window.scrollY,w:w,h:h,label:'area '+Math.round(w)+'×'+Math.round(h)});}
  function swallow(e){if(!S.active||isOurs(e.target))return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}
  function onDown(e){if(!S.active||e.button!==0||isOurs(e.target))return;swallow(e);if(S.card){var it=S.cardItem;if(it&&!it.saved&&!(S.card.querySelector('textarea').value.trim())){closeCard();}else if(it&&!it.saved){S.card.querySelector('textarea').focus();return;}else{closeCard();}}S.down={x:e.clientX,y:e.clientY,el:e.target};}
  function onMove(e){if(!S.active)return;if(S.down){var dx=e.clientX-S.down.x,dy=e.clientY-S.down.y;if(!S.drag&&(Math.abs(dx)>6||Math.abs(dy)>6)){S.drag=true;hideHover();}if(S.drag){ensureRoot();var x=Math.min(S.down.x,e.clientX),y=Math.min(S.down.y,e.clientY);band.style.display='block';band.style.left=x+'px';band.style.top=y+'px';band.style.width=Math.abs(dx)+'px';band.style.height=Math.abs(dy)+'px';}return;}
    if(S.card)return;var el=e.target;if(!el||isOurs(el)||el===document.documentElement||el===document.body){hideHover();return;}ensureRoot();showHover(el);}
  function onUp(e){if(!S.active||!S.down)return;swallow(e);var d=S.down,dragged=S.drag;S.down=null;S.drag=false;band.style.display='none';
    if(dragged){var x=Math.min(d.x,e.clientX),y=Math.min(d.y,e.clientY),w=Math.abs(e.clientX-d.x),h=Math.abs(e.clientY-d.y);if(w>=8&&h>=8)addArea(x,y,w,h);return;}
    var el=d.el;if(el&&el.nodeType===1&&el!==document.documentElement&&el!==document.body)addElement(el);}
  function onKey(e){if(!S.active)return;if(e.key==='Escape'){if(S.card)return;e.preventDefault();S.exit=true;}}
  var BLOCK=['click','dblclick','auxclick','contextmenu','mousedown','mouseup','submit','dragstart','selectstart'];
  function loop(){S.raf=requestAnimationFrame(loop);S.items.forEach(placePin);placeCard();}
  function listen(on){var f=on?'addEventListener':'removeEventListener';document[f]('pointerdown',onDown,true);document[f]('pointermove',onMove,true);document[f]('pointerup',onUp,true);document[f]('keydown',onKey,true);BLOCK.forEach(function(t){document[f](t,swallow,true);});}

  // ── serialisation ────────────────────────────────────────────
  function serialize(it){var p=rectOf(it);var vb={x:p.x,y:p.y,width:p.w,height:p.h};
    if(it.region)return {key:it.key,n:it.n,url:location.href,title:document.title,tag:'area',id:null,classes:[],label:it.label,text:'',cssSelector:'',xpath:'',outerHtml:'',computedStyle:{},comment:it.comment||'',boundingBox:vb,viewport:{width:window.innerWidth,height:window.innerHeight}};
    return {key:it.key,n:it.n,url:location.href,title:document.title,tag:it.el.tagName.toLowerCase(),id:it.el.id||null,classes:classList(it.el),label:it.label,text:it.text,cssSelector:it.cssSelector,xpath:it.xpath,outerHtml:(it.el.outerHTML||'').slice(0,8000),computedStyle:styleOf(it.el),comment:it.comment||'',boundingBox:vb,viewport:{width:window.innerWidth,height:window.innerHeight}};}
  function saved(){return S.items.filter(function(it){return it.saved;});}
  function find(key){return S.items.filter(function(x){return x.key===key;})[0];}
  function reveal(it){if(it.region){window.scrollTo({left:window.scrollX,top:Math.max(0,it.py-window.innerHeight/2+it.h/2),behavior:'instant'});}else{try{it.el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});}catch(e){it.el.scrollIntoView();}}}

  window.__GAI_ANNO={
    start:function(p){if(p)C=p;paintChrome();S.items.forEach(paintPin);if(S.active)return;S.active=true;S.exit=false;ensureRoot();listen(true);if(!S.raf)loop();},
    setPalette:function(p){if(p)C=p;paintChrome();S.items.forEach(paintPin);},
    stop:function(){if(!S.active)return;S.active=false;S.down=null;S.drag=false;band.style.display='none';hideHover();if(S.card)closeCard();listen(false);S.items.forEach(placePin);},
    list:function(){return saved().map(function(it){return {key:it.key,n:it.n,label:it.label,tag:it.region?'area':it.el.tagName.toLowerCase(),comment:it.comment,region:!!it.region,text:it.region?'':(it.text||'')};});},
    remove:function(key){removeItem(key);},
    clear:function(){S.items.slice().forEach(function(it){removeItem(it.key);});},
    open:function(key){var it=find(key);if(!it)return;reveal(it);if(S.active)openCard(it);},
    focus:function(key){var it=find(key);if(!it)return null;if(S.card){var c=S.cardItem;S.card.remove();S.card=null;S.cardItem=null;if(c&&!c.saved)removeItem(c.key);}hideHover();reveal(it);S.focused=it;S.items.forEach(placePin);var p=rectOf(it);var pad=32;
      var x=Math.max(0,p.x-pad),y=Math.max(0,p.y-pad-14),r=Math.min(window.innerWidth,p.x+p.w+pad),b=Math.min(window.innerHeight,p.y+p.h+pad);return {x:x,y:y,width:Math.max(1,r-x),height:Math.max(1,b-y)};},
    unfocus:function(){S.focused=null;S.items.forEach(placePin);},
    take:function(keys){var out=[];saved().forEach(function(it){if(!keys||!keys.length||keys.indexOf(it.key)>=0)out.push(serialize(it));});out.forEach(function(o){removeItem(o.key);});return out;},
    poll:function(){var r={items:this.list(),exit:S.exit,sendAll:S.sendAll};S.exit=false;S.sendAll=false;return r;}
  };
})()`;
}
