export interface GitLogCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export function parseGitLog(stdout: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
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
