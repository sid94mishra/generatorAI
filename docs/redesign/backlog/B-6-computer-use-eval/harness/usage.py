"""python3 -I usage.py <chatId> — token use of a GeneratorAI chat's Claude session, from the provider transcript."""
import glob, json, os, sys
chat = sys.argv[1]
files = [f for f in glob.glob(os.path.expanduser(f'~/.claude/projects/*{chat}*/*.jsonl'))]
tot = {'turns': 0, 'input': 0, 'cache_read': 0, 'cache_write': 0, 'output': 0}
for f in files:
    for line in open(f):
        try: d = json.loads(line)
        except Exception: continue
        u = (d.get('message') or {}).get('usage') if d.get('type') == 'assistant' else None
        if not u: continue
        tot['turns'] += 1
        tot['input'] += u.get('input_tokens') or 0
        tot['cache_read'] += u.get('cache_read_input_tokens') or 0
        tot['cache_write'] += u.get('cache_creation_input_tokens') or 0
        tot['output'] += u.get('output_tokens') or 0
if tot['turns'] == 0:
    # Codex: its rollout log records the working directory, which carries the chat id; the last token_count is cumulative.
    import time
    cutoff = time.time() - 3 * 86400
    for f in glob.glob(os.path.expanduser('~/.codex/sessions/**/rollout-*.jsonl'), recursive=True):
        if os.path.getmtime(f) < cutoff: continue
        text = open(f, errors='replace').read()
        head = text.split('\n', 1)[0]
        # The session_meta line records this session's cwd, which carries the chat id; other lines may quote other chats.
        if chat not in head: continue
        last = None; turns = 0
        for line in text.splitlines():
            if '"token_count"' not in line: continue
            try: d = json.loads(line)
            except Exception: continue
            info = (d.get('payload') or {}).get('info') or d.get('info')
            if info and info.get('total_token_usage'):
                last = info['total_token_usage']; turns += 1
        if last:
            tot = {'turns': turns, 'input': last.get('input_tokens', 0) - last.get('cached_input_tokens', 0),
                   'cache_read': last.get('cached_input_tokens', 0), 'cache_write': last.get('cache_write_input_tokens', 0),
                   'output': last.get('output_tokens', 0), 'provider': 'codex'}
tot['context_total'] = tot['input'] + tot['cache_read'] + tot['cache_write']
print(json.dumps(tot))
