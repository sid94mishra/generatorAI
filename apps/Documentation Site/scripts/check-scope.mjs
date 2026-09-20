import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(site,'../..');
const baseline=JSON.parse(fs.readFileSync(path.join(site,'audit/scope-baseline.json'),'utf8'));
const changes=[];
for(const [file,hash] of Object.entries(baseline)){
 const p=path.join(root,file);
 if(!fs.existsSync(p)||crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==hash)changes.push(file);
}
console.log(JSON.stringify({checked:Object.keys(baseline).length,changedOutsideSite:changes},null,2));
if(changes.length) process.exitCode=1;
