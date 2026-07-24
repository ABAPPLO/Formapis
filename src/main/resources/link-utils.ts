import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Generic symlink + ownership-marker utilities for resource distribution.
 *
 * This is a generalized extraction of the proven logic in
 * src/main/codex/codex-home-paths.ts (linkSystemCodexResource and its helpers),
 * with all Codex-specific behavior (AGENTS.md handling, managed-home concept)
 * removed. The marker mechanism lets us tell "a copy we made" apart from "a
 * file the user created", so re-syncing never clobbers user content.
 *
 * Strategy for linking a canonical source into a target location:
 *   1. If target already symlinks to source → done (idempotent).
 *   2. If target is absent → symlink source → target (Windows dirs use junction).
 *   3. If symlink fails (e.g. Windows file symlink without dev mode) → copy
 *      source → target and write an ownership marker so we can refresh later.
 *   4. If target exists and is NOT ours → leave it alone (foreign content).
 */

/** Marker subdirectory placed under the target's parent home. */
const MARKER_DIR_NAME = '.formapis-resource-copies'

type LinkOptions = {
  /** Prefer a copy over a symlink (use for environments where symlinks break). */
  preferCopy?: boolean
}

/**
 * Ensure `targetPath` reflects `sourcePath` via symlink (preferred) or copy.
 * Safe to call repeatedly (idempotent). Never overwrites content we don't own.
 */
export function linkResourceToTarget(
  sourcePath: string,
  targetPath: string,
  markerHome: string,
  entryKey: string,
  options: LinkOptions = {}
): 'linked' | 'copied' | 'foreign' | 'missing' {
  if (!existsSync(sourcePath)) {
    removeOwnedResource(targetPath, markerHome, entryKey, sourcePath)
    return 'missing'
  }

  if (targetAlreadyPointsToSource(targetPath, sourcePath)) {
    clearOwnershipMarker(markerHome, entryKey)
    if (!options.preferCopy || !removeSymlinkEntry(targetPath)) {
      return 'linked'
    }
  }

  const needsRefresh = isOwnedFallbackCopy(targetPath, markerHome, entryKey, sourcePath)
  if (pathEntryExists(targetPath) && !needsRefresh) {
    // Target exists and we have no ownership claim → treat as foreign user content.
    return 'foreign'
  }
  if (needsRefresh) {
    rmSync(targetPath, { recursive: true, force: true })
  }

  if (options.preferCopy) {
    copyAsOwnedFallback(sourcePath, targetPath, markerHome, entryKey)
    return 'copied'
  }

  try {
    const sourceStat = lstatSync(sourcePath)
    symlinkSync(
      sourcePath,
      targetPath,
      sourceStat.isDirectory() && process.platform === 'win32' ? 'junction' : undefined
    )
    clearOwnershipMarker(markerHome, entryKey)
    return 'linked'
  } catch {
    copyAsOwnedFallback(sourcePath, targetPath, markerHome, entryKey)
    return 'copied'
  }
}

/**
 * Remove a resource at targetPath if we own it (symlink to source, or a copy we
 * recorded). Foreign content is left untouched.
 */
export function removeOwnedResource(
  targetPath: string,
  markerHome: string,
  entryKey: string,
  sourcePath: string
): boolean {
  if (removeSymlinkedResourceIfOwned(targetPath, sourcePath)) {
    clearOwnershipMarker(markerHome, entryKey)
    return true
  }
  if (!isOwnedFallbackCopy(targetPath, markerHome, entryKey, sourcePath)) {
    return false
  }
  rmSync(targetPath, { recursive: true, force: true })
  clearOwnershipMarker(markerHome, entryKey)
  return true
}

// ─── copy fallback ──────────────────────────────────────────────────────────

function copyAsOwnedFallback(
  sourcePath: string,
  targetPath: string,
  markerHome: string,
  entryKey: string
): void {
  try {
    rmSync(targetPath, { recursive: true, force: true })
    cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true })
    writeOwnershipMarker(markerHome, entryKey, sourcePath)
  } catch (copyError) {
    try {
      rmSync(targetPath, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
    throw new Error(
      `Failed to mirror resource ${entryKey} (symlink and copy both failed): ${String(copyError)}`
    )
  }
}

// ─── ownership marker ───────────────────────────────────────────────────────

function getMarkerPath(markerHome: string, entryKey: string): string {
  return join(markerHome, MARKER_DIR_NAME, `${entryKey}.json`)
}

function writeOwnershipMarker(markerHome: string, entryKey: string, sourcePath: string): void {
  const markerPath = getMarkerPath(markerHome, entryKey)
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${JSON.stringify({ sourcePath }, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function readOwnershipSourcePath(markerHome: string, entryKey: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getMarkerPath(markerHome, entryKey), 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const sourcePath =
      'sourcePath' in parsed ? (parsed as { sourcePath?: unknown }).sourcePath : null
    return typeof sourcePath === 'string' ? sourcePath : null
  } catch {
    return null
  }
}

function clearOwnershipMarker(markerHome: string, entryKey: string): void {
  rmSync(getMarkerPath(markerHome, entryKey), { recursive: true, force: true })
}

function isOwnedFallbackCopy(
  targetPath: string,
  markerHome: string,
  entryKey: string,
  sourcePath: string
): boolean {
  if (readOwnershipSourcePath(markerHome, entryKey) !== sourcePath) {
    return false
  }
  try {
    return existsSync(targetPath) && !lstatSync(targetPath).isSymbolicLink()
  } catch {
    return false
  }
}

// ─── symlink inspection helpers ─────────────────────────────────────────────

function pathEntryExists(entryPath: string): boolean {
  try {
    lstatSync(entryPath)
    return true
  } catch {
    return false
  }
}

function targetAlreadyPointsToSource(targetPath: string, sourcePath: string): boolean {
  try {
    return (
      lstatSync(targetPath).isSymbolicLink() &&
      linkTargetsMatch(readlinkSync(targetPath), sourcePath)
    )
  } catch {
    return false
  }
}

function linkTargetsMatch(actualTarget: string, expectedTarget: string): boolean {
  if (process.platform !== 'win32') {
    return actualTarget === expectedTarget
  }
  return normalizeWindowsLinkTarget(actualTarget) === normalizeWindowsLinkTarget(expectedTarget)
}

function normalizeWindowsLinkTarget(linkTarget: string): string {
  return linkTarget.replace(/^\\\\\?\\/, '').toLowerCase()
}

function removeSymlinkedResourceIfOwned(targetPath: string, sourcePath: string): boolean {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) {
      return false
    }
    if (!linkTargetsMatch(readlinkSync(targetPath), sourcePath)) {
      return false
    }
    return removeSymlinkEntry(targetPath)
  } catch {
    return false
  }
}

function removeSymlinkEntry(targetPath: string): boolean {
  try {
    unlinkSync(targetPath)
    return true
  } catch {
    if (process.platform !== 'win32') {
      return false
    }
  }
  try {
    rmdirSync(targetPath)
    return true
  } catch {
    return false
  }
}

/** Inspect a target without mutating it: is it linked, copied, missing, or foreign? */
export function inspectLinkState(
  targetPath: string,
  markerHome: string,
  entryKey: string,
  sourcePath: string
): 'linked' | 'copied' | 'missing' | 'foreign' {
  if (!pathEntryExists(targetPath)) {
    return 'missing'
  }
  if (targetAlreadyPointsToSource(targetPath, sourcePath)) {
    return 'linked'
  }
  if (isOwnedFallbackCopy(targetPath, markerHome, entryKey, sourcePath)) {
    return 'copied'
  }
  return 'foreign'
}

/** Re-export statSync for callers that need file timestamps. */
export { statSync }
