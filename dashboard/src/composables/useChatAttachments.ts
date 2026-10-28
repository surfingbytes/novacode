/**
 * Composer attachments — uploads files to the session and keeps the pending list.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { ref } from 'vue';

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
  const bUploadingImage = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  function uploadAttachmentFile(file: File): void {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      const canPreviewLocally =
        /^(image\/(png|jpeg|gif|webp))$/i.test(file.type) ||
        /\.(png|jpe?g|gif|webp)$/i.test(file.name);
      bUploadingImage.value = true;
      try {
        const mimeType = file.type || 'application/octet-stream';
        const { data } = await sessionsApi.uploadImage(
          options.sessionId(),
          base64,
          mimeType,
          file.name
        );
        // Server may convert HEIC→JPEG; trust the stored filename for previewability.
        const isImage = /\.(png|jpe?g|gif|webp)$/i.test(data.filename);
        pendingImages.value.push({
          filename: data.filename,
          displayName: file.name,
          dataUrl: isImage
            ? canPreviewLocally
              ? dataUrl
              : sessionsApi.imageUrl(options.sessionId(), data.filename)
            : '',
          serverPath: data.path,
          isImage
        });
      } catch (error) {
        options.onUploadError(apiErrorMessage(error, 'Failed to upload file'));
      } finally {
        bUploadingImage.value = false;
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

export type UseChatAttachments = ReturnType<typeof useChatAttachments>;
