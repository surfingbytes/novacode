// @vitest-environment jsdom

// node_modules
import { describe, it, expect, vi, afterEach } from 'vitest';

// lib
import {
  buildHtmlPreviewDocument,
  normalizeWorkspacePath,
  resolvePreviewAssetPath,
  rewriteCssUrls,
  shouldLeavePreviewUrl,
  type FetchPreviewAsset
} from '@/lib/htmlPreview';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldLeavePreviewUrl', () => {
  it('leaves absolute and special schemes alone', () => {
    expect(shouldLeavePreviewUrl('https://fonts.googleapis.com/css')).toBe(true);
    expect(shouldLeavePreviewUrl('//cdn.example/x.js')).toBe(true);
    expect(shouldLeavePreviewUrl('data:text/plain,hi')).toBe(true);
    expect(shouldLeavePreviewUrl('blob:https://x/1')).toBe(true);
    expect(shouldLeavePreviewUrl('#section')).toBe(true);
    expect(shouldLeavePreviewUrl('mailto:a@b.c')).toBe(true);
  });

  it('rewrites relative and root-absolute paths', () => {
    expect(shouldLeavePreviewUrl('brand-marks.css')).toBe(false);
    expect(shouldLeavePreviewUrl('./x.js')).toBe(false);
    expect(shouldLeavePreviewUrl('../lib/a.js')).toBe(false);
    expect(shouldLeavePreviewUrl('/assets/app.css')).toBe(false);
  });
});

describe('resolvePreviewAssetPath', () => {
  it('resolves siblings against the HTML directory', () => {
    expect(resolvePreviewAssetPath('mockups/page.html', 'brand-marks.css')).toBe(
      'mockups/brand-marks.css'
    );
    expect(resolvePreviewAssetPath('mockups/page.html', './brand-marks.js')).toBe(
      'mockups/brand-marks.js'
    );
  });

  it('resolves parent and nested relative paths', () => {
    expect(resolvePreviewAssetPath('mockups/sub/page.html', '../brand.css')).toBe(
      'mockups/brand.css'
    );
    expect(resolvePreviewAssetPath('mockups/page.html', 'assets/index.css')).toBe(
      'mockups/assets/index.css'
    );
  });

  it('maps root-absolute paths to the workspace root', () => {
    expect(resolvePreviewAssetPath('mockups/page.html', '/assets/app.css')).toBe(
      'assets/app.css'
    );
  });

  it('rejects escapes above the workspace root', () => {
    expect(resolvePreviewAssetPath('page.html', '../secret.txt')).toBeNull();
    expect(normalizeWorkspacePath('a/../../b')).toBeNull();
  });

  it('strips query and hash', () => {
    expect(resolvePreviewAssetPath('mockups/page.html', 'x.css?v=1#a')).toBe(
      'mockups/x.css'
    );
  });
});

describe('buildHtmlPreviewDocument', () => {
  it('rewrites relative stylesheet and script tags to blob URLs', async () => {
    const fetchAsset: FetchPreviewAsset = vi.fn(async (path) => {
      if (path === 'mockups/brand-marks.css') {
        return { content: 'body{color:red}', encoding: 'utf8' as const };
      }
      if (path === 'mockups/brand-marks.js') {
        return { content: 'window.__ok=1', encoding: 'utf8' as const };
      }
      return null;
    });

    const html = `<!doctype html><html><head>
<link href="brand-marks.css" rel="stylesheet">
</head><body>
<script src="brand-marks.js"></script>
<script>document.body.dataset.ready="1"</script>
</body></html>`;

    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const result = await buildHtmlPreviewDocument(html, 'mockups/page.html', fetchAsset);
    try {
      expect(fetchAsset).toHaveBeenCalledWith('mockups/brand-marks.css');
      expect(fetchAsset).toHaveBeenCalledWith('mockups/brand-marks.js');

      const htmlBlob = [...createSpy.mock.calls]
        .map((call) => call[0])
        .reverse()
        .find((part): part is Blob => part instanceof Blob && part.type.includes('text/html'));
      expect(htmlBlob).toBeTruthy();
      const docHtml = await htmlBlob!.text();
      expect(docHtml).toMatch(/href="blob:[^"]+"/);
      expect(docHtml).toMatch(/src="blob:[^"]+"/);
      // Inline script moved to a blob src (no remaining inline body).
      expect(docHtml).not.toContain('document.body.dataset.ready');
      expect(result.objectUrls.length).toBeGreaterThanOrEqual(3);
      expect(result.documentUrl).toMatch(/^blob:/);
    } finally {
      for (const url of result.objectUrls) {
        URL.revokeObjectURL(url);
      }
    }
  });

  it('rewrites CSS url() against the stylesheet path', async () => {
    const objectUrls: string[] = [];
    const blobCache = new Map<string, string>();
    const fetchAsset: FetchPreviewAsset = vi.fn(async (path) => {
      if (path === 'mockups/assets/bg.png') {
        return { content: 'aaaa', encoding: 'base64' as const };
      }
      return null;
    });

    const rewritten = await rewriteCssUrls(
      'body{background:url(./assets/bg.png)}',
      'mockups/app.css',
      fetchAsset,
      objectUrls,
      blobCache
    );
    try {
      expect(fetchAsset).toHaveBeenCalledWith('mockups/assets/bg.png');
      expect(rewritten).toMatch(/url\("blob:[^"]+"\)/);
    } finally {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    }
  });
});
