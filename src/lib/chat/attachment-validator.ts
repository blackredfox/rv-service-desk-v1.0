/**
 * Attachment validation for chat API.
 *
 * Responsibility: Validate image attachments (count, size, format).
 * Does NOT own: flow control, diagnostic logic.
 */

// Attachment validation constants
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_ATTACHMENT_BYTES = 6_000_000; // 6MB server-side (slightly higher than client)

export type Attachment = {
  type: "image";
  dataUrl: string;
};

export type AttachmentValidationResult = {
  valid: boolean;
  error?: string;
  totalBytes?: number;
};

/**
 * Validate attachments array.
 */
export function validateAttachments(attachments: Attachment[] | undefined): AttachmentValidationResult {
  if (!attachments || attachments.length === 0) {
    return { valid: true, totalBytes: 0 };
  }

  // Check count
  if (attachments.length > MAX_ATTACHMENTS) {
    return {
      valid: false,
      error: `Maximum ${MAX_ATTACHMENTS} images allowed per message. Received ${attachments.length}.`,
    };
  }

  let totalBytes = 0;

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];

    // Check type
    if (attachment.type !== "image") {
      return { valid: false, error: `Attachment ${i + 1} has invalid type: ${attachment.type}` };
    }

    // Check dataUrl format
    if (!attachment.dataUrl || typeof attachment.dataUrl !== "string") {
      return { valid: false, error: `Attachment ${i + 1} has invalid dataUrl` };
    }

    if (!attachment.dataUrl.startsWith("data:image/")) {
      return { valid: false, error: `Attachment ${i + 1} is not a valid image (must be image/*)` };
    }

    // Calculate approximate byte size
    const base64Data = attachment.dataUrl.split(",")[1] || "";
    const sizeBytes = Math.ceil(base64Data.length * 0.75);
    totalBytes += sizeBytes;
  }

  // Check total size
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    const maxMB = (MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `Total attachment size (${totalMB}MB) exceeds limit (${maxMB}MB)`,
    };
  }

  return { valid: true, totalBytes };
}

/**
 * Filter raw attachments to valid image attachments.
 */
export function filterValidAttachments(rawAttachments: Attachment[] | undefined): Attachment[] | undefined {
  return rawAttachments?.filter(
    (a) => a.type === "image" && a.dataUrl && a.dataUrl.startsWith("data:image/")
  );
}

/**
 * Build vision enforcement instruction for the model.
 */
export function buildVisionInstruction(attachmentCount: number): string {
  if (attachmentCount === 0) return "";

  const plural = attachmentCount > 1 ? "s" : "";
  return `

VISION INPUT: ${attachmentCount} image${plural} attached.

CRITICAL VISION RULES:
- You MUST describe what you ACTUALLY SEE in the image${plural}.
- Start your response with a brief summary of visible observations from the image${plural}.
- Do NOT invent, guess, or hallucinate any details not visible in the image${plural}.
- Do NOT make up serial numbers, part numbers, readings, or measurements unless clearly visible.
- If an image is unclear, blurry, too dark, or does not show relevant information, state this explicitly and request a clearer photo.
- Use observations from images as additional diagnostic evidence alongside technician's verbal reports.
- If the image shows damage, wear, or abnormal conditions, describe them using neutral technical language.

After your visual observations, continue with the appropriate diagnostic mode response.
`;
}
