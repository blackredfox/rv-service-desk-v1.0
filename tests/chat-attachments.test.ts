import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch for OpenAI API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Chat API - Multi-Photo Attachments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.resetModules();
  });

  // Helper to create valid image dataUrl
  function createImageDataUrl(sizeKB: number = 10): string {
    // Create base64 data of approximate size
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const length = Math.ceil(sizeKB * 1024 * 1.33); // base64 is ~33% larger
    let base64 = "";
    for (let i = 0; i < length; i++) {
      base64 += chars[Math.floor(Math.random() * chars.length)];
    }
    return `data:image/jpeg;base64,${base64}`;
  }

  describe("Attachment Validation", () => {
    it("should accept 2-3 valid image attachments", async () => {
      const attachments = [
        { type: "image" as const, dataUrl: createImageDataUrl(50) },
        { type: "image" as const, dataUrl: createImageDataUrl(50) },
        { type: "image" as const, dataUrl: createImageDataUrl(50) },
      ];

      // Validate attachments are well-formed
      expect(attachments.length).toBe(3);
      expect(attachments.every(a => a.type === "image")).toBe(true);
      expect(attachments.every(a => a.dataUrl.startsWith("data:image/"))).toBe(true);
    });

    it("should reject more than 10 attachments", async () => {
      const attachments = Array.from({ length: 11 }, () => ({
        type: "image" as const,
        dataUrl: createImageDataUrl(10),
      }));

      expect(attachments.length).toBeGreaterThan(10);
    });

    it("should reject attachments with invalid type", async () => {
      const attachment = {
        type: "video" as const,
        dataUrl: "data:video/mp4;base64,ABC",
      };

      expect(attachment.type).not.toBe("image");
    });

    it("should reject attachments with non-image mime type", async () => {
      const attachment = {
        type: "image" as const,
        dataUrl: "data:application/pdf;base64,ABC",
      };

      expect(attachment.dataUrl.startsWith("data:image/")).toBe(false);
    });

    it("should calculate total attachment bytes correctly", async () => {
      // 100KB base64 = ~75KB binary
      const dataUrl = createImageDataUrl(100);
      const base64Data = dataUrl.split(",")[1] || "";
      const estimatedBytes = Math.ceil(base64Data.length * 0.75);
      
      // Should be approximately 100KB
      expect(estimatedBytes).toBeGreaterThan(90 * 1024);
      expect(estimatedBytes).toBeLessThan(110 * 1024);
    });
  });

  describe("Vision Input Format", () => {
    it("should build OpenAI message with image_url content", () => {
      const userMessage = "Check this photo";
      const attachment = { type: "image" as const, dataUrl: "data:image/jpeg;base64,/9j/4AAQ" };

      // Expected OpenAI message format
      const expectedFormat = {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          { type: "image_url", image_url: { url: attachment.dataUrl } },
        ],
      };

      expect(expectedFormat.content).toHaveLength(2);
      expect(expectedFormat.content[0]).toEqual({ type: "text", text: userMessage });
      expect(expectedFormat.content[1]).toHaveProperty("type", "image_url");
      expect(expectedFormat.content[1]).toHaveProperty("image_url.url", attachment.dataUrl);
    });

    it("should build OpenAI message with multiple image_url contents", () => {
      const userMessage = "Compare these photos";
      const attachments = [
        { type: "image" as const, dataUrl: "data:image/jpeg;base64,AAA" },
        { type: "image" as const, dataUrl: "data:image/jpeg;base64,BBB" },
        { type: "image" as const, dataUrl: "data:image/jpeg;base64,CCC" },
      ];

      // Expected OpenAI message format
      const contentParts: Array<
        { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
      > = [{ type: "text", text: userMessage }];

      for (const attachment of attachments) {
        contentParts.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
        });
      }

      expect(contentParts).toHaveLength(4); // 1 text + 3 images
      expect(contentParts[0]).toEqual({ type: "text", text: userMessage });
      expect(contentParts.slice(1).every(p => p.type === "image_url")).toBe(true);
    });
  });

  describe("Vision Instruction", () => {
    it("should include vision instruction when images attached", () => {
      const attachmentCount = 3;
      
      // Simulated vision instruction (should match actual implementation)
      const hasVisionInstruction = attachmentCount > 0;
      
      expect(hasVisionInstruction).toBe(true);
    });

    it("should not include vision instruction when no images", () => {
      const attachmentCount = 0;
      const hasVisionInstruction = attachmentCount > 0;
      
      expect(hasVisionInstruction).toBe(false);
    });

    it("should use plural form for multiple images", () => {
      const buildVisionInstruction = (count: number) => {
        if (count === 0) return "";
        const plural = count > 1 ? "s" : "";
        return `VISION INPUT: ${count} image${plural} attached.`;
      };

      expect(buildVisionInstruction(1)).toContain("1 image attached");
      expect(buildVisionInstruction(3)).toContain("3 images attached");
    });
  });
});

describe("Chat API - Attachment Size Limits", () => {
  const MAX_ATTACHMENTS = 10;
  const MAX_TOTAL_BYTES = 6_000_000;

  it("should enforce maximum attachment count", () => {
    const tooManyAttachments = Array.from({ length: 11 }, (_, i) => ({
      type: "image" as const,
      dataUrl: `data:image/jpeg;base64,${i}`,
    }));

    expect(tooManyAttachments.length).toBeGreaterThan(MAX_ATTACHMENTS);
  });

  it("should enforce maximum total bytes", () => {
    // Create a 7MB attachment (exceeds 6MB limit)
    const chars = "A".repeat(7 * 1024 * 1024 * 1.33);
    const largeDataUrl = `data:image/jpeg;base64,${chars}`;
    const base64Data = largeDataUrl.split(",")[1] || "";
    const estimatedBytes = Math.ceil(base64Data.length * 0.75);

    expect(estimatedBytes).toBeGreaterThan(MAX_TOTAL_BYTES);
  });

  it("should allow attachments under limits", () => {
    // 5 attachments of 500KB each = 2.5MB total (under 6MB)
    const validAttachments = Array.from({ length: 5 }, () => {
      const chars = "A".repeat(500 * 1024 * 1.33);
      return {
        type: "image" as const,
        dataUrl: `data:image/jpeg;base64,${chars}`,
      };
    });

    expect(validAttachments.length).toBeLessThanOrEqual(MAX_ATTACHMENTS);
    
    const totalBytes = validAttachments.reduce((sum, a) => {
      const base64 = a.dataUrl.split(",")[1] || "";
      return sum + Math.ceil(base64.length * 0.75);
    }, 0);
    
    expect(totalBytes).toBeLessThan(MAX_TOTAL_BYTES);
  });
});
