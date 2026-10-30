// ────────────────────────────────────────────────────────────────
// AddMcpServerDialog — add a project MCP server (F-projects-07): name,
// description, type HTTP / STDIO; HTTP needs a URL, STDIO a command (+ args).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState, type FormEvent } from 'react';
import { useCreateMcpServer } from '@/hooks/projectQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';

type ServerType = 'http' | 'stdio';

export function AddMcpServerDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateMcpServer();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serverType, setServerType] = useState<ServerType>('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');

  useEffect(() => {
    if (open) return;
    setName('');
    setDescription('');
    setServerType('http');
    setUrl('');
    setCommand('');
    setArgs('');
  }, [open]);

  const valid = Boolean(name.trim()) && (serverType === 'http' ? Boolean(url.trim()) : Boolean(command.trim()));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    create.mutate(
      {
        projectId,
        data: {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          serverType,
          ...(serverType === 'http'
            ? { url: url.trim() }
            : { command: command.trim(), args: args.split(' ').filter(Boolean) }),
        },
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => toast.error("Couldn't add the server", { description: err instanceof Error ? err.message : String(err) }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add MCP server">
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GitHub" autoFocus />
          </Field>
          <Field label="Description" optional>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-fg-2">Type</span>
            <SegmentedControl<ServerType>
              value={serverType}
              onValueChange={setServerType}
              label="Server type"
              className="self-start"
              items={[
                { value: 'http', label: 'HTTP' },
                { value: 'stdio', label: 'STDIO (local process)' },
              ]}
            />
          </div>
          {serverType === 'http' ? (
            <Field label="URL">
              <Input mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com" />
            </Field>
          ) : (
            <>
              <Field label="Command">
                <Input mono value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
              </Field>
              <Field label="Arguments" optional hint="Space-separated.">
                <Input mono value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-github" />
              </Field>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid} loading={create.isPending}>
            Add server
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
