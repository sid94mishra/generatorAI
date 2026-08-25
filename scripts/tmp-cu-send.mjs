import fs from 'node:fs';
const [chatId, promptFile, mode] = process.argv.slice(2);
const prompt = fs.readFileSync(promptFile, 'utf8');
const fd = new FormData();
fd.append('prompt', prompt);
fd.append('mode', mode ?? 'auto');
const res = await fetch(`http://localhost:3100/api/chats/${chatId}/prompt`, { method: 'POST', body: fd });
console.log('status', res.status, await res.text());
