"use client";

import { useRef, useCallback, useState } from "react";
import { analytics } from "@/lib/client-analytics";

export type PhotoAttachment = {
  id: string;
  dataUrl: string;
  fileName: string;
  sizeBytes: number;
};

type Props = {
  attachments: PhotoAttachment[];
  onAttach: (attachment: PhotoAttachment) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  caseId?: string | null;
};

// Configuration constants
export const MAX_IMAGES = 10;
export const MAX_DIM = 1024;
export const JPEG_QUALITY = 0.75;
export const MAX_TOTAL_BYTES = 5_000_000; // 5MB total

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file before compression

function shouldShowMobileSourceMenu(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
}

/**
 * Resize and compress image to meet payload limits
 */
async function resizeImage(file: File): Promise<{ dataUrl: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // Only resize if larger than MAX_DIM
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = (height / width) * MAX_DIM;
            width = MAX_DIM;
          } else {
            width = (width / height) * MAX_DIM;
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        
        // Calculate approximate byte size (base64 is ~4/3 of binary size)
        const base64Data = dataUrl.split(",")[1] || "";
        const sizeBytes = Math.ceil(base64Data.length * 0.75);
        
        resolve({ dataUrl, sizeBytes });
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Calculate total size of all attachments
 */
export function calculateTotalBytes(attachments: PhotoAttachment[]): number {
  return attachments.reduce((sum, a) => sum + a.sizeBytes, 0);
}

export function PhotoAttachButton({ attachments, onAttach, disabled, caseId }: Props) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const desktopInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  const currentTotalBytes = calculateTotalBytes(attachments);
  const canAddMore = attachments.length < MAX_IMAGES && currentTotalBytes < MAX_TOTAL_BYTES;

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      // Reset input so same files can be selected again
      e.target.value = "";

      // Check if adding these files would exceed limit
      const remainingSlots = MAX_IMAGES - attachments.length;
      if (files.length > remainingSlots) {
        alert(`You can only attach ${remainingSlots} more image${remainingSlots === 1 ? "" : "s"}. Maximum is ${MAX_IMAGES}.`);
        return;
      }

      let runningTotal = currentTotalBytes;

      for (const file of files) {
        // Check file size before processing
        if (file.size > MAX_FILE_SIZE) {
          alert(`Image "${file.name}" is too large. Maximum size is 10MB per image.`);
          continue;
        }

        try {
          const { dataUrl, sizeBytes } = await resizeImage(file);
          
          // Check if adding this image would exceed total limit
          if (runningTotal + sizeBytes > MAX_TOTAL_BYTES) {
            alert(`Adding "${file.name}" would exceed the 5MB total limit. Please remove some images first.`);
            break;
          }

          runningTotal += sizeBytes;

          onAttach({
            id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dataUrl,
            fileName: file.name,
            sizeBytes,
          });
          
          void analytics.photoAttached(caseId ?? undefined);
        } catch {
          alert(`Failed to process image "${file.name}". Please try another.`);
        }
      }
    },
    [attachments.length, currentTotalBytes, onAttach, caseId]
  );

  const handleAttachClick = useCallback(() => {
    if (disabled || !canAddMore) return;

    if (shouldShowMobileSourceMenu()) {
      setSourceMenuOpen(true);
      return;
    }

    desktopInputRef.current?.click();
  }, [disabled, canAddMore]);

  const openCamera = useCallback(() => {
    setSourceMenuOpen(false);
    cameraInputRef.current?.click();
  }, []);

  const openLibrary = useCallback(() => {
    setSourceMenuOpen(false);
    libraryInputRef.current?.click();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={disabled || !canAddMore}
        className="hidden"
        data-testid="photo-camera-input"
        aria-label="Take photo"
      />

      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={handleFileChange}
        disabled={disabled || !canAddMore}
        className="hidden"
        data-testid="photo-library-input"
        aria-label="Choose photos from library"
      />

      <input
        ref={desktopInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={handleFileChange}
        disabled={disabled || !canAddMore}
        className="hidden"
        data-testid="photo-desktop-input"
        aria-label="Attach photos"
      />

      {/* Attach button */}
      <button
        type="button"
        onClick={handleAttachClick}
        disabled={disabled || !canAddMore}
        aria-label={canAddMore ? "Attach photos" : `Maximum ${MAX_IMAGES} photos reached`}
        title={canAddMore ? "Attach photos (up to 10)" : `Maximum ${MAX_IMAGES} photos reached`}
        data-testid="photo-attach-button"
        className="relative flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        <CameraIcon />
        {attachments.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            {attachments.length}
          </span>
        )}
      </button>

      {sourceMenuOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/30 p-3"
          data-testid="photo-source-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Choose photo source"
          onClick={() => setSourceMenuOpen(false)}
        >
          <div
            className="safe-area-bottom w-full rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              data-testid="photo-source-camera-button"
              onClick={openCamera}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              <span>Take photo</span>
              <CameraIcon />
            </button>
            <button
              type="button"
              data-testid="photo-source-library-button"
              onClick={openLibrary}
              className="mt-1 flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              <span>Choose from library</span>
              <PhotoIcon />
            </button>
            <button
              type="button"
              data-testid="photo-source-cancel-button"
              onClick={() => setSourceMenuOpen(false)}
              className="mt-2 flex w-full items-center justify-center rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Preview grid for attached photos
 */
export function PhotoPreviewGrid({
  attachments,
  onRemove,
  disabled,
}: {
  attachments: PhotoAttachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  if (attachments.length === 0) return null;

  const totalBytes = calculateTotalBytes(attachments);
  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

  return (
    <div className="max-w-full space-y-2 overflow-hidden" data-testid="photo-preview-grid">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="shrink-0" data-testid="photo-preview-count">{attachments.length}/{MAX_IMAGES} photos</span>
        <span className="truncate" data-testid="photo-preview-size">{totalMB} MB / 5 MB</span>
      </div>
      
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            data-testid={`photo-preview-${attachment.id}`}
            className="group relative shrink-0"
          >
            <img
              src={attachment.dataUrl}
              alt={attachment.fileName}
              className="h-16 w-16 rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
            />
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              disabled={disabled}
              aria-label={`Remove ${attachment.fileName}`}
              data-testid={`photo-remove-${attachment.id}`}
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-white opacity-100 transition-opacity hover:bg-zinc-700 disabled:cursor-not-allowed sm:opacity-0 sm:group-hover:opacity-100 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <XIcon />
            </button>
            <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 text-[10px] text-white">
              {attachment.fileName}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}
