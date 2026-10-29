// node_modules
import { ref, watch } from 'vue';
import type { Ref } from 'vue';

// classes
import { filesApi } from '@/classes/api';
import { buildHtmlPreviewDocument } from '@/lib/htmlPreview';
import { fileContentBytes, mimeForPath } from './filePaths';

type UseFilePreviewsOptions = {
  getWorkspaceId: () => string;
  selectedPath: Ref<string | null>;
  fileContent: Ref<string>;
  fileEncoding: Ref<'utf8' | 'base64'>;
  bIsImageFile: Readonly<Ref<boolean>>;
  bHtmlPreview: Readonly<Ref<boolean>>;
};

/** Blob URLs backing the image preview and the sandboxed HTML preview of the open file. */
export function useFilePreviews(options: UseFilePreviewsOptions) {
  const { selectedPath, fileContent, fileEncoding, bIsImageFile, bHtmlPreview } = options;
  const imageObjectUrl = ref<string | null>(null);
  const htmlPreviewObjectUrl = ref<string | null>(null);
  /** All blob URLs created for the current HTML preview (document + assets). */
  const htmlPreviewObjectUrls = ref<string[]>([]);
  let htmlPreviewBuildId = 0;

  // Build/revoke the blob URL backing the image preview.
  watch([fileContent, fileEncoding, selectedPath], () => {
    if (imageObjectUrl.value) {
      URL.revokeObjectURL(imageObjectUrl.value);
      imageObjectUrl.value = null;
    }
    if (bIsImageFile.value && fileContent.value) {
      const blob = new Blob([fileContentBytes(fileContent.value, fileEncoding.value)], {
        type: mimeForPath(selectedPath.value ?? '')
      });
      imageObjectUrl.value = URL.createObjectURL(blob);
    }
  });

  // Sandboxed HTML preview: rewrite relative assets to blob URLs, then load the
  // document blob in an iframe with allow-scripts (no allow-same-origin) so
  // mockup JS can run without touching the app origin / token storage.
  function revokeHtmlPreviewUrls(): void {
    for (const url of htmlPreviewObjectUrls.value) {
      URL.revokeObjectURL(url);
    }
    htmlPreviewObjectUrls.value = [];
    htmlPreviewObjectUrl.value = null;
  }

  watch([fileContent, fileEncoding, selectedPath, bHtmlPreview], () => {
    const buildId = ++htmlPreviewBuildId;
    revokeHtmlPreviewUrls();
    if (!bHtmlPreview.value || fileEncoding.value !== 'utf8' || fileContent.value === '') {
      return;
    }
    const htmlPath = selectedPath.value;
    if (!htmlPath) {
      return;
    }
    const html = fileContent.value;
    const workspaceId = options.getWorkspaceId();
    void (async () => {
      try {
        const result = await buildHtmlPreviewDocument(html, htmlPath, async (path) => {
          try {
            const response = await filesApi.read(workspaceId, path);
            return { content: response.data.content, encoding: response.data.encoding };
          } catch {
            return null;
          }
        });
        if (buildId !== htmlPreviewBuildId) {
          for (const url of result.objectUrls) {
            URL.revokeObjectURL(url);
          }
          return;
        }
        htmlPreviewObjectUrls.value = result.objectUrls;
        htmlPreviewObjectUrl.value = result.documentUrl;
      } catch {
        if (buildId === htmlPreviewBuildId) {
          revokeHtmlPreviewUrls();
        }
      }
    })();
  });

  /** Revokes every preview URL and drops any in-flight HTML preview build. */
  function disposePreviews(): void {
    if (imageObjectUrl.value) {
      URL.revokeObjectURL(imageObjectUrl.value);
      imageObjectUrl.value = null;
    }
    htmlPreviewBuildId += 1;
    revokeHtmlPreviewUrls();
  }

  return { imageObjectUrl, htmlPreviewObjectUrl, disposePreviews };
}
