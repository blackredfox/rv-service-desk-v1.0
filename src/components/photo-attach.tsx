"use client";

import { useRef, useCallback } from "react";
import { analytics } from "@/lib/client-analytics";

export type PhotoAttachment = {
  id: string;
  dataUrl: string;
  fileName: string;
};

type Props = {
  attachment: PhotoAttachment | null;
  onAttach: (attachment: PhotoAttachment) => void;
  onRemove: () => void;
  disabled?: boolean;
  caseId?: string | null;
};

const MAX_SIZE = 1024; // Max dimension for resize
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

async function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // Only resize if larger than MAX_SIZE
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = (height / width) * MAX_SIZE;
            width = MAX_SIZE;
          } else {
            width = (width / height) * MAX_SIZE;
            height = MAX_SIZE;
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
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function PhotoAttachButton({ attachment, onAttach, onRemove, disabled, caseId }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so same file can be selected again
      if (inputRef.current) inputRef.current.value = "";

      if (file.size > MAX_FILE_SIZE) {
        alert("Image too large. Maximum size is 5MB.");
        return;
      }

      try {
        const dataUrl = await resizeImage(file);
        onAttach({
          id: `photo_${Date.now()}`,
          dataUrl,
          fileName: file.name,
        });
        void analytics.photoAttached(caseId ?? undefined);
      } catch {
        alert("Failed to process image. Please try another.");
      }
    },
    [onAttach, caseId]
  );

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={disabled || !!attachment}
        className="hidden"
        data-testid="photo-input"
        aria-label="Attach photo"
      />

      {!attachment ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach photo"
          data-testid="photo-attach-button"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <CameraIcon />
        </button>
      ) : (
        <div
          data-testid="photo-preview-chip"
          className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <img
            src={attachment.dataUrl}
            alt="Attached"
            className="h-8 w-8 rounded object-cover"
          />
          <span className="max-w-[80px] truncate text-xs text-zinc-600 dark:text-zinc-400">
            {attachment.fileName}
          </span>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove photo"
            data-testid="photo-remove-button"
            className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
          >
            <XIcon />
          </button>
        </div>
      )}
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
