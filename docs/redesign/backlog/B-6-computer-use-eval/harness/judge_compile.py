"""python3 -I judge_compile.py <label>... — writes judge/runs.json and judge/traces.json from results/<label>-*.json
and the verifier lines in results/<label>.log. Evidence only: no commentary."""
import json, os, re, sys

DIR = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(DIR, 'results')
runs, traces = [], {}
for label in sys.argv[1:]:
    log = open(os.path.join(RES, f'{label}.log')).read() if os.path.exists(os.path.join(RES, f'{label}.log')) else ''
    blocks = {m.group(1): m.group(2) for m in re.finditer(r'=== \S+ (\S+)\n(.*?)(?==== |BATCH-DONE|\Z)', log, re.S)}
    for f in sorted(os.listdir(RES)):
        if not (f.startswith(f'{label}-') and f.endswith('.json')):
            continue
        r = json.load(open(os.path.join(RES, f)))
        s = r['scenario']
        lines = [l for l in blocks.get(s, '').splitlines() if l.startswith(('PASS', 'FAIL', 'SCORE'))]
        score = next((l.split()[1] for l in lines if l.startswith('SCORE')), '?')
        head = next((json.loads(l) for l in blocks.get(s, '').splitlines() if l.startswith('{')), {})
        runs.append({
            'run': r['runId'], 'round': label, 'model': r['model'], 'scenario': s,
            'held_out': s.startswith('H'), 'seconds': r['seconds'], 'tool_calls': r['toolCalls'],
            'computer_calls': r['computerCalls'], 'failed_calls': r['failedCalls'],
            'context_tokens': r['tokens'], 'output_tokens': head.get('out'),
            'checks': score, 'check_lines': lines, 'reply': r.get('reply', ''),
        })
        traces[r['runId']] = [
            {'tool': c['tool'].replace('mcp__generatorai-tools__', ''), 'args': json.dumps(c.get('args'))[:600], 'result': str(c.get('result'))[:900]}
            for c in r['calls']
        ]
os.makedirs(os.path.join(DIR, 'judge'), exist_ok=True)
json.dump(runs, open(os.path.join(DIR, 'judge', 'runs.json'), 'w'), indent=1)
json.dump(traces, open(os.path.join(DIR, 'judge', 'traces.json'), 'w'), indent=1)
print(len(runs), 'runs')
