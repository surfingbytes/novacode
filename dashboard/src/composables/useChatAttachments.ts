/**
 * Composer attachments — uploads files to the session and keeps the pending list.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, ref } from 'vue';

// classes
import { apiErrorMessage, sessionsApi } from '@/classes/api';

// types
import type { PendingAttachment } from '@/components/chat/ChatComposer.vue';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseChatAttachmentsOptions {
  sessionId: () => string;
  /** Shown in the chat error banner when an upload fails. */
  onUploadError: (message: string) => void;
}

export function useChatAttachments(options: UseChatAttachmentsOptions) {
  // -------------------------------------------------- Refs --------------------------------------------------
  const pendingImages = ref<PendingAttachment[]>([]);
  /** Concurrent uploads in flight — send stays disabled until all of them settle. */
  const uploadsInFlight = ref(0);
  const bUploadingImage = computed(() => uploadsInFlight.value > 0);

  // -------------------------------------------------- Methods --------------------------------------------------
  function uploadAttachmentFile(file: File): void {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      const canPreviewLocally =
        /^(image\/(png|jpeg|gif|webp))$/i.test(file.type) ||
        /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      const sessionId = options.sessionId();
      uploadsInFlight.value += 1;
      try {
        const mimeType = file.type || 'application/octet-stream';
        const { data } = await sessionsApi.uploadImage(sessionId, base64, mimeType, file.name);
        // The composer moved to another session meanwhile: it must not get this file.
        if (options.sessionId() !== sessionId) return;
        // Server may convert HEIC→JPEG; trust the stored filename for previewability.
        const isImage = /\.(png|jpe?g|gif|webp)$/i.test(data.filename);
        pendingImages.value.push({
          filename: data.filename,
          displayName: file.name,
          dataUrl: isImage
            ? canPreviewLocally
              ? dataUrl
              : sessionsApi.imageUrl(sessionId, data.filename)
            : '',
          serverPath: data.path,
          isImage
        });
      } catch (error) {
        if (options.sessionId() !== sessionId) return;
        options.onUploadError(apiErrorMessage(error, 'Failed to upload file'));
      } finally {
        uploadsInFlight.value -= 1;
      }
    };
    reader.readAsDataURL(file);
  }

  function onUploadFiles(files: File[]): void {
    for (const file of files) {
      uploadAttachmentFile(file);
    }
  }

  return {
    // data
    pendingImages,
    bUploadingImage,
    // methods
    uploadAttachmentFile,
    onUploadFiles
  };
}
