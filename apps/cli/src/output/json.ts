// JSON output formatter — emits raw JSON to stdout for --json flag

export function outputJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function outputJsonStream(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}
