import type { GitFile } from '@/classes/api';

export function gitFileKey(file: GitFile): string {
  return `${file.repo}::${file.file}`;
}

export function gitParseFileKey(key: string): { repo: string; file: string } {
  const sep = key.indexOf('::');
  if (sep < 0) return { repo: '', file: key };
  return { repo: key.slice(0, sep), file: key.slice(sep + 2) };
}

export function gitStatusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'M' || s === 'MM' || s === ' M' || s === 'M ')
    return 'bg-yellow-500/20 text-yellow-400';
  if (s === 'A' || s === 'A ') return 'bg-green-500/20 text-green-400';
  if (s === 'D' || s === ' D' || s === 'D ') return 'bg-red-500/20 text-red-400';
  if (s === 'R' || s.startsWith('R')) return 'bg-blue-500/20 text-blue-400';
  if (s === '??') return 'bg-text-muted/20 text-text-muted';
  return 'bg-text-muted/20 text-text-muted';
}

export function gitDiffRowClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-row--added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-row--removed';
  if (line.startsWith('@@')) return 'diff-row--hunk';
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  )
    return 'diff-row--meta';
  return '';
}

export function gitFormatCommitDate(iso: string): string {
  if (!iso) {
    return '';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString();
}
