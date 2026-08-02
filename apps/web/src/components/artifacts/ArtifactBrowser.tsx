// ────────────────────────────────────────────────────────────────
// ArtifactBrowser — Card grid of session artifacts
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useArtifacts } from '@/hooks/queries.js';
import { useDownloadArtifact } from '@/hooks/queries.js';
import {
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  File,
  Download,
  Loader2,
  PackageOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';

interface ArtifactBrowserProps {
  sessionId: string;
}

export function ArtifactBrowser({ sessionId }: ArtifactBrowserProps) {
  const { data: artifacts, isLoading, error } = useArtifacts(sessionId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-[var(--color-destructive)] dark:bg-red-900/10">
        Failed to load artifacts
      </div>
    );
  }

  if (!artifacts?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <PackageOpen className="h-8 w-8 text-[var(--color-muted-foreground)] opacity-50" />
        <p className="text-sm text-[var(--color-muted-foreground)]">No artifacts yet</p>
        <p className="text-xs text-[var(--color-muted-foreground)] opacity-70">
          Artifacts will appear here as the session generates files
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {artifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="flex flex-col rounded-lg border border-border bg-card p-4"
        >
          {/* Icon + Name */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-muted)]">
              {getFileIcon(artifact.mimeType)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                {artifact.name}
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {formatFileSize(artifact.size)} • {artifact.mimeType}
              </p>
            </div>
          </div>

          {/* Image preview */}
          {isImage(artifact.mimeType) && (
            <div className="mt-3 overflow-hidden rounded-md border border-[var(--color-border)]">
              <img
                src={`/api/artifacts/${artifact.id}/download`}
                alt={artifact.name}
                className="h-32 w-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          {/* Direction + Download */}
          <div className="mt-3 flex items-center justify-between">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                artifact.direction === 'outbound'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
              )}
            >
              {artifact.direction === 'outbound' ? 'Generated' : 'Uploaded'}
            </span>
            <ArtifactDownloadButton artifactId={artifact.id} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Download Button (isolated mutation state per artifact) ──

function ArtifactDownloadButton({ artifactId }: { artifactId: string }) {
  const downloadMutation = useDownloadArtifact();

  return (
    <button
      onClick={() => downloadMutation.mutate(artifactId)}
      disabled={downloadMutation.isPending}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-primary)] transition-colors hover:bg-[var(--color-accent)]"
    >
      {downloadMutation.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Download className="h-3 w-3" />
      )}
      Download
    </button>
  );
}

// ── Helpers ──

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <FileImage className="h-5 w-5 text-purple-500" />;
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html') || mimeType.includes('css'))
    return <FileCode className="h-5 w-5 text-blue-500" />;
  if (mimeType.startsWith('text/')) return <FileText className="h-5 w-5 text-green-500" />;
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip'))
    return <FileArchive className="h-5 w-5 text-yellow-500" />;
  return <File className="h-5 w-5 text-gray-500" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
