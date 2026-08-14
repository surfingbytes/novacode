/** Client-side field checks used by create/edit forms before submit. */

export function requiredTrimmed(value: string, label: string): string | undefined {
  if (!value.trim()) {
    return `${label} is required`;
  }
  return undefined;
}

/**
 * Workspace paths are stored relative to `/data-root`. Reject empty values and
 * `..` segments that would walk above that root.
 */
export function workspacePathError(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) {
    return 'Path is required';
  }
  if (trimmed.includes('\0')) {
    return 'Path contains invalid characters';
  }
  const relative = trimmed.replace(/^\/+/, '');
  let depth = 0;
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      depth -= 1;
      if (depth < 0) {
        return 'Path must stay inside /data-root';
      }
      continue;
    }
    depth += 1;
  }
  return undefined;
}

export function optionalEmailError(email: string): string | undefined {
  const trimmed = email.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'Enter a valid email address';
  }
  return undefined;
}

export function passwordLengthError(password: string, min = 8): string | undefined {
  if (password.length > 0 && password.length < min) {
    return `Password must be at least ${min} characters`;
  }
  return undefined;
}
