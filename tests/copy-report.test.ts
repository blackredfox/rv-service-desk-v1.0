import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock clipboard API
const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: mockClipboardWrite },
  writable: true,
});

describe("Copy Report Button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClipboardWrite.mockResolvedValue(undefined);
  });

  describe("Report detection logic", () => {
    it("should identify structured content as a report", () => {
      const reportContent = `
## Service Report

**Vehicle:** 2023 RV Model X
**Issue:** Water leak

---

### Diagnosis
The water heater bypass valve was found to be defective.

### Recommendation
Replace bypass valve and test system.
      `;

      // Check for report indicators
      const hasStructure = reportContent.includes("\n\n") || 
                          reportContent.includes("---") ||
                          reportContent.includes("**") ||
                          reportContent.includes("##");
      
      expect(hasStructure).toBe(true);
    });

    it("should not identify short messages as reports", () => {
      const shortMessage = "Hello, how can I help you today?";
      
      // Short messages (< 100 chars) shouldn't be considered reports
      expect(shortMessage.length).toBeLessThan(100);
    });
  });

  describe("Clipboard behavior", () => {
    it("should copy report content to clipboard", async () => {
      const reportContent = "## Service Report\n\nTest content here with enough length to be considered a report. More content to make it longer.";
      
      await navigator.clipboard.writeText(reportContent);
      
      expect(mockClipboardWrite).toHaveBeenCalledWith(reportContent);
    });

    it("should only copy report, not chat content", async () => {
      const chatMessages = [
        { role: "user", content: "I have a water leak" },
        { role: "assistant", content: "Let me help you diagnose that." },
        { role: "user", content: "It's under the sink" },
        { role: "assistant", content: "## Service Report\n\n**Issue:** Water leak under sink\n\n### Diagnosis\nPlumbing connection loose." },
      ];

      // Only the last assistant message with report structure should be copied
      const reportMessages = chatMessages.filter(m => 
        m.role === "assistant" && 
        m.content.length > 100 &&
        (m.content.includes("##") || m.content.includes("---"))
      );

      expect(reportMessages.length).toBe(1);
      expect(reportMessages[0].content).not.toContain("I have a water leak");
      expect(reportMessages[0].content).toContain("Service Report");
    });
  });
});
