// ────────────────────────────────────────────────────────────────
// PathResolver — Centralized path validation and boundary enforcement
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export class PathEscapeError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly boundary: string,
  ) {
    super(`Path escape attempt: "${attemptedPath}" escapes boundary "${boundary}"`);
    this.name = 'PathEscapeError';
  }
}

export class SymlinkEscapeError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly realPath: string,
    public readonly boundary: string,
  ) {
    super(`Symlink escape: "${attemptedPath}" resolves to "${realPath}" outside boundary "${boundary}"`);
    this.name = 'SymlinkEscapeError';
  }
}

export class PathResolver {
  /**
   * Resolve a relative path within a workspace root, preventing escape.
   * Throws PathEscapeError if the resolved path is outside workspaceRoot.
   * Throws SymlinkEscapeError if symlinks escape the boundary.
   */
  async resolveWithinWorkspace(workspaceRoot: string, relativePath: string): Promise<string> {
    // Block absolute paths
    if (path.isAbsolute(relativePath)) {
      throw new PathEscapeError(relativePath, workspaceRoot);
    }

    // Resolve the logical path (removes ../, ./)
    const resolved = path.resolve(workspaceRoot, relativePath);

    // Check logical path is within boundary
    const normalizedRoot = path.resolve(workspaceRoot);
    if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
      throw new PathEscapeError(relativePath, workspaceRoot);
    }

    // Check REAL path (follows symlinks) to detect symlink escape
    try {
      const realPath = await fs.realpath(resolved);
      const realRoot = await fs.realpath(workspaceRoot);
      if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
        throw new SymlinkEscapeError(relativePath, realPath, workspaceRoot);
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // File doesn't exist yet (being created); validate parent directory
        const parentDir = path.dirname(resolved);
        if (await this.pathExists(parentDir)) {
          const realParent = await fs.realpath(parentDir);
          const realRoot = await fs.realpath(workspaceRoot);
          if (!realParent.startsWith(realRoot + path.sep) && realParent !== realRoot) {
            throw new SymlinkEscapeError(relativePath, realParent, workspaceRoot);
          }
        }
        return resolved;
      }
      // Re-throw PathEscapeError/SymlinkEscapeError
      if (err instanceof PathEscapeError || err instanceof SymlinkEscapeError) {
        throw err;
      }
      // For other FS errors, the path might still be unsafe; throw
      throw new PathEscapeError(relativePath, workspaceRoot);
    }

    return resolved;
  }

  /**
   * Synchronous logical-only boundary check (no symlink verification).
   * Use where async is not available or for pre-validation.
   */
  resolveWithinBoundarySync(boundary: string, relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new PathEscapeError(relativePath, boundary);
    }

    const resolved = path.resolve(boundary, relativePath);
    const normalizedBoundary = path.resolve(boundary);

    if (!resolved.startsWith(normalizedBoundary + path.sep) && resolved !== normalizedBoundary) {
      throw new PathEscapeError(relativePath, boundary);
    }

    return resolved;
  }

  /**
   * Check if a path is within allowed boundaries (synchronous, logical only).
   */
  isWithinBoundary(targetPath: string, boundary: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBoundary = path.resolve(boundary);
    return resolvedTarget.startsWith(resolvedBoundary + path.sep) || resolvedTarget === resolvedBoundary;
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
