const fs = require('node:fs');
const path = require('node:path');
const groups = [
  ['guide','Start here'],['features','Features'],['clients','Clients & settings'],
  ['configuration','Configuration & examples'],['architecture','Architecture'],['design','Design system'],['reference','Technical reference'],
  ['operations','Operations & development'],['about','About these docs'],
];
const priority = ['introduction','quickstart','concepts','overview','index','modules'];
module.exports = {
  documentation: groups.filter(([dir])=>fs.existsSync(path.resolve('docs',dir))).map(([dir,label])=>({
    type:'category', label, collapsed:dir!=='guide',
    items:fs.readdirSync(path.resolve('docs',dir)).filter(f=>f.endsWith('.md')).sort((a,b)=>{
      const rank=f=>{const i=priority.indexOf(f.replace('.md',''));return i<0?100:i};
      return rank(a)-rank(b)||a.localeCompare(b);
    }).map(f=>`${dir}/${f.replace(/\.md$/,'')}`),
  })),
};
