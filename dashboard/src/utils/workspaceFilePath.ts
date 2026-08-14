/**
 * Turn a tool-call path (absolute or relative) into a workspace-relative path
 * the files API will accept, or null when the string is not a file path.
 */

export function toWorkspaceRelativePath(
  filePath: string,
  workspacePath: string
): string | null {
  const trimmed = filePath.trim().replace(/\\/g, '/');
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('*') || trimmed.startsWith('"') || trimmed.includes(' → ')) {
    return null;
  }
  const firstToken = trimmed.split(/\s+/)[0] ?? trimmed;
  const candidate = firstToken.replace(/^\.\//, '');
  const workspace = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');

  if (workspace && (candidate === workspace || candidate === `${workspace}/`)) {
    return null;
  }
  if (workspace && candidate.startsWith(`${workspace}/`)) {
    return candidate.slice(workspace.length + 1);
  }
  if (candidate.startsWith('/')) {
    if (!workspace) {
      return null;
    }
    const marker = `/${workspace.split('/').filter(Boolean).at(-1)}/`;
    const markerIndex = candidate.indexOf(marker);
    if (markerIndex >= 0) {
      return candidate.slice(markerIndex + marker.length);
    }
    return null;
  }
  if (!candidate.includes('/') && !/\.\w+$/.test(candidate)) {
    return null;
  }
  return candidate;
}

export function ancestorDirectoryPaths(path: string): string[] {
  if (!path.includes('/')) {
    return [];
  }
  return path
    .split('/')
    .slice(0, -1)
    .reduce<string[]>((result, _, index, parts) => {
      result.push(parts.slice(0, index + 1).join('/'));
      return result;
    }, []);
}
