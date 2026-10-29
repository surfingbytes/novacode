// types
import type { GitCommit } from '@novacode/shared';

export function parseGitLog(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [hash, shortHash, author, date, subject] = line.split('\x1f');
    if (!hash) {
      continue;
    }
    commits.push({
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      author: author || '',
      date: date || '',
      subject: subject || ''
    });
  }
  return commits;
}
