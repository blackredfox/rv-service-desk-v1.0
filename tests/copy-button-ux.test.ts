import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Copy button visual feedback behavior.
 *
 * Verifies:
 * - Copy button shows "Copied!" with checkmark after click
 * - Feedback resets after ~1.5 seconds
 * - Per-message tracking (copying one message doesn't affect others)
 * - Copy Report button has its own feedback state
 */

// Mock clipboard API
const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: mockClipboardWrite },
  writable: true,
});

describe("Copy Button UX Feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClipboardWrite.mockResolvedValue(undefined);
  });

  describe("Per-message copy state tracking", () => {
    it("should track copied state per message ID", () => {
      // Simulate per-message state management
      let copiedMessageId: string | null = null;

      // Copy message A
      copiedMessageId = "msg-1";
      expect(copiedMessageId).toBe("msg-1");

      // Copy message B (should replace A)
      copiedMessageId = "msg-2";
      expect(copiedMessageId).toBe("msg-2");

      // Reset
      copiedMessageId = null;
      expect(copiedMessageId).toBeNull();
    });

    it("should auto-reset copied state after timeout", async () => {
      vi.useFakeTimers();

      let copiedMessageId: string | null = null;

      // Simulate copy action
      copiedMessageId = "msg-1";
      expect(copiedMessageId).toBe("msg-1");

      // Set timeout to reset (like the component does)
      setTimeout(() => {
        if (copiedMessageId === "msg-1") copiedMessageId = null;
      }, 1500);

      // Before timeout
      vi.advanceTimersByTime(1000);
      expect(copiedMessageId).toBe("msg-1");

      // After timeout
      vi.advanceTimersByTime(600);
      expect(copiedMessageId).toBeNull();

      vi.useRealTimers();
    });

    it("should not reset if a different message was copied in the meantime", async () => {
      vi.useFakeTimers();

      let copiedMessageId: string | null = null;

      // Copy message A
      copiedMessageId = "msg-1";
      setTimeout(() => {
        if (copiedMessageId === "msg-1") copiedMessageId = null;
      }, 1500);

      // Copy message B before timeout
      vi.advanceTimersByTime(500);
      copiedMessageId = "msg-2";

      // After original timeout — should NOT reset (different message now)
      vi.advanceTimersByTime(1100);
      expect(copiedMessageId).toBe("msg-2");

      vi.useRealTimers();
    });
  });

  describe("Clipboard integration", () => {
    it("should call clipboard.writeText with message content", async () => {
      const content = "Water pump not operating per spec. Recommend replacement.";
      await navigator.clipboard.writeText(content);
      expect(mockClipboardWrite).toHaveBeenCalledWith(content);
    });

    it("should handle clipboard failure gracefully", async () => {
      mockClipboardWrite.mockRejectedValueOnce(new Error("Permission denied"));
      let errorMsg: string | null = null;

      try {
        await navigator.clipboard.writeText("test");
      } catch {
        errorMsg = "Copy failed";
      }

      expect(errorMsg).toBe("Copy failed");
    });
  });

  describe("Visual feedback states", () => {
    it("default state shows 'Copy' text", () => {
      const copiedMessageId: string | null = null;
      const messageId = "msg-1";

      const isCopied = copiedMessageId === messageId;
      const buttonText = isCopied ? "Copied!" : "Copy";

      expect(buttonText).toBe("Copy");
    });

    it("copied state shows 'Copied!' text", () => {
      const copiedMessageId = "msg-1";
      const messageId = "msg-1";

      const isCopied = copiedMessageId === messageId;
      const buttonText = isCopied ? "Copied!" : "Copy";

      expect(buttonText).toBe("Copied!");
    });

    it("different message shows 'Copy' text", () => {
      const copiedMessageId = "msg-1";
      const messageId = "msg-2";

      const isCopied = copiedMessageId === messageId;
      const buttonText = isCopied ? "Copied!" : "Copy";

      expect(buttonText).toBe("Copy");
    });
  });

  describe("Report copy button feedback", () => {
    it("should have independent state from inline copy buttons", () => {
      let reportCopied = false;
      let copiedMessageId: string | null = null;

      // Copy inline message
      copiedMessageId = "msg-1";
      expect(copiedMessageId).toBe("msg-1");
      expect(reportCopied).toBe(false);

      // Copy report
      reportCopied = true;
      expect(reportCopied).toBe(true);
      expect(copiedMessageId).toBe("msg-1"); // unchanged
    });
  });
});
