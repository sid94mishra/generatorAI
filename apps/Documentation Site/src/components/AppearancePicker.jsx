import React, {useEffect, useRef, useState} from 'react';
import palettes from '../theme-data/palettes.json';

export default function AppearancePicker({mobile}) {
  const [palette,setPalette]=useState(palettes.defaultTheme);
  const [accent,setAccent]=useState('blue');
  const details=useRef(null);
  useEffect(()=>{
    const sync=()=>{setPalette(document.documentElement.dataset.palette||palettes.defaultTheme);setAccent(document.documentElement.dataset.accent||'blue');};
    const close=e=>{if(details.current&&!details.current.contains(e.target))details.current.open=false;};
    const escape=e=>{if(e.key==='Escape'&&details.current?.open){details.current.open=false;details.current.querySelector('summary').focus();}};
    sync();window.addEventListener('docs-appearance',sync);document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('docs-appearance',sync);document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[]);
  function change(key,value){
    document.documentElement.dataset[key]=value;
    try{localStorage.setItem(`generatorai:docs:${key}`,value);}catch{}
    window.dispatchEvent(new Event('docs-appearance'));
  }
  if(mobile)return null;
  return <details className="docs-appearance" ref={details}>
    <summary aria-label="Documentation appearance" title="Theme and accent"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.6 1.6 0 0 1 1-2.8h2a4 4 0 0 0 4-4A8.5 8.5 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="10" cy="6.5" r=".7"/><circle cx="15" cy="7.5" r=".7"/></svg></summary>
    <div className="appearance-panel">
      <strong>Appearance</strong><p>The same palettes as GeneratorAI.</p>
      <label>Theme<select aria-label="Documentation palette" value={palette} onChange={e=>change('palette',e.target.value)}>{Array.from(new Set(palettes.themes.map(t=>t.group))).map(group=><optgroup key={group} label={group==='reading'?'Low glare':group}>{palettes.themes.filter(t=>t.group===group).map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}</select></label>
      <label>Accent<select aria-label="Documentation accent" value={accent} onChange={e=>change('accent',e.target.value)}>{palettes.accents.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <p>Use the light/dark control to change mode. Preferences stay in this documentation site.</p>
    </div>
  </details>;
}
