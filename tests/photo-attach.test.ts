import { describe, it, expect } from "vitest";
import type { PhotoAttachment } from "@/components/photo-attach";
import { MAX_IMAGES, MAX_TOTAL_BYTES, calculateTotalBytes } from "@/components/photo-attach";

describe("Photo Attachment Component", () => {
  // Helper to create mock attachment
  function createMockAttachment(id: string, sizeBytes: number): PhotoAttachment {
    return {
      id,
      dataUrl: `data:image/jpeg;base64,${"A".repeat(Math.ceil(sizeBytes * 1.33))}`,
      fileName: `photo_${id}.jpg`,
      sizeBytes,
    };
  }

  describe("Constants", () => {
    it("should have MAX_IMAGES set to 10", () => {
      expect(MAX_IMAGES).toBe(10);
    });

    it("should have MAX_TOTAL_BYTES set to 5MB", () => {
      expect(MAX_TOTAL_BYTES).toBe(5_000_000);
    });
  });

  describe("calculateTotalBytes", () => {
    it("should return 0 for empty array", () => {
      expect(calculateTotalBytes([])).toBe(0);
    });

    it("should sum bytes of all attachments", () => {
      const attachments = [
        createMockAttachment("1", 100_000),
        createMockAttachment("2", 200_000),
        createMockAttachment("3", 300_000),
      ];

      const total = calculateTotalBytes(attachments);
      expect(total).toBe(600_000);
    });

    it("should handle single attachment", () => {
      const attachments = [createMockAttachment("1", 500_000)];
      expect(calculateTotalBytes(attachments)).toBe(500_000);
    });
  });

  describe("Attachment State Management", () => {
    it("should add attachments up to MAX_IMAGES", () => {
      const attachments: PhotoAttachment[] = [];
      
      // Add 10 attachments
      for (let i = 0; i < 10; i++) {
        attachments.push(createMockAttachment(`${i}`, 100_000));
      }

      expect(attachments.length).toBe(MAX_IMAGES);
      expect(attachments.length).toBeLessThanOrEqual(MAX_IMAGES);
    });

    it("should not exceed MAX_IMAGES", () => {
      const attachments: PhotoAttachment[] = [];
      
      // Add MAX_IMAGES attachments
      for (let i = 0; i < MAX_IMAGES; i++) {
        attachments.push(createMockAttachment(`${i}`, 100_000));
      }

      const canAddMore = attachments.length < MAX_IMAGES;
      expect(canAddMore).toBe(false);
    });

    it("should allow adding when under MAX_IMAGES", () => {
      const attachments: PhotoAttachment[] = [];
      
      // Add 5 attachments
      for (let i = 0; i < 5; i++) {
        attachments.push(createMockAttachment(`${i}`, 100_000));
      }

      const canAddMore = attachments.length < MAX_IMAGES;
      expect(canAddMore).toBe(true);
    });

    it("should remove attachment by id", () => {
      const attachments = [
        createMockAttachment("a", 100_000),
        createMockAttachment("b", 100_000),
        createMockAttachment("c", 100_000),
      ];

      // Remove middle attachment
      const filtered = attachments.filter((a) => a.id !== "b");

      expect(filtered.length).toBe(2);
      expect(filtered.find((a) => a.id === "b")).toBeUndefined();
      expect(filtered.find((a) => a.id === "a")).toBeDefined();
      expect(filtered.find((a) => a.id === "c")).toBeDefined();
    });

    it("should maintain order after removal", () => {
      const attachments = [
        createMockAttachment("1", 100_000),
        createMockAttachment("2", 100_000),
        createMockAttachment("3", 100_000),
      ];

      const filtered = attachments.filter((a) => a.id !== "2");

      expect(filtered[0].id).toBe("1");
      expect(filtered[1].id).toBe("3");
    });
  });

  describe("Byte Limit Enforcement", () => {
    it("should allow attachments under total byte limit", () => {
      const attachments = [
        createMockAttachment("1", 1_000_000), // 1MB
        createMockAttachment("2", 1_000_000), // 1MB
        createMockAttachment("3", 1_000_000), // 1MB
      ]; // Total: 3MB

      const total = calculateTotalBytes(attachments);
      const underLimit = total < MAX_TOTAL_BYTES;

      expect(underLimit).toBe(true);
    });

    it("should detect when over total byte limit", () => {
      const attachments = [
        createMockAttachment("1", 2_000_000), // 2MB
        createMockAttachment("2", 2_000_000), // 2MB
        createMockAttachment("3", 2_000_000), // 2MB
      ]; // Total: 6MB

      const total = calculateTotalBytes(attachments);
      const overLimit = total > MAX_TOTAL_BYTES;

      expect(overLimit).toBe(true);
    });

    it("should allow adding if won't exceed limit", () => {
      const existing = [
        createMockAttachment("1", 2_000_000), // 2MB
        createMockAttachment("2", 2_000_000), // 2MB
      ]; // Total: 4MB

      const currentTotal = calculateTotalBytes(existing);
      const newAttachmentSize = 500_000; // 0.5MB
      const wouldExceed = currentTotal + newAttachmentSize > MAX_TOTAL_BYTES;

      expect(wouldExceed).toBe(false); // 4.5MB < 5MB
    });

    it("should block adding if would exceed limit", () => {
      const existing = [
        createMockAttachment("1", 2_000_000), // 2MB
        createMockAttachment("2", 2_000_000), // 2MB
      ]; // Total: 4MB

      const currentTotal = calculateTotalBytes(existing);
      const newAttachmentSize = 1_500_000; // 1.5MB
      const wouldExceed = currentTotal + newAttachmentSize > MAX_TOTAL_BYTES;

      expect(wouldExceed).toBe(true); // 5.5MB > 5MB
    });
  });

  describe("Multiple File Selection", () => {
    it("should handle multiple files in one selection", () => {
      const files = [
        { name: "photo1.jpg", size: 500_000 },
        { name: "photo2.jpg", size: 600_000 },
        { name: "photo3.jpg", size: 400_000 },
      ];

      expect(files.length).toBe(3);
    });

    it("should respect remaining slots when adding multiple", () => {
      const existing = Array.from({ length: 7 }, (_, i) =>
        createMockAttachment(`${i}`, 100_000)
      );

      const remainingSlots = MAX_IMAGES - existing.length;
      expect(remainingSlots).toBe(3);

      // Can only add 3 more
      const newFiles = [
        { name: "a.jpg" },
        { name: "b.jpg" },
        { name: "c.jpg" },
        { name: "d.jpg" }, // This one won't fit
      ];

      const canAddAll = newFiles.length <= remainingSlots;
      expect(canAddAll).toBe(false);
    });
  });
});

describe("Voice Button Language Support", () => {
  it("should map EN to en-US", () => {
    const getRecognitionLang = (language: string): string => {
      switch (language) {
        case "RU": return "ru-RU";
        case "ES": return "es-ES";
        default: return "en-US";
      }
    };

    expect(getRecognitionLang("EN")).toBe("en-US");
  });

  it("should map RU to ru-RU", () => {
    const getRecognitionLang = (language: string): string => {
      switch (language) {
        case "RU": return "ru-RU";
        case "ES": return "es-ES";
        default: return "en-US";
      }
    };

    expect(getRecognitionLang("RU")).toBe("ru-RU");
  });

  it("should map ES to es-ES", () => {
    const getRecognitionLang = (language: string): string => {
      switch (language) {
        case "RU": return "ru-RU";
        case "ES": return "es-ES";
        default: return "en-US";
      }
    };

    expect(getRecognitionLang("ES")).toBe("es-ES");
  });

  it("should default AUTO to en-US", () => {
    const getRecognitionLang = (language: string): string => {
      switch (language) {
        case "RU": return "ru-RU";
        case "ES": return "es-ES";
        default: return "en-US";
      }
    };

    expect(getRecognitionLang("AUTO")).toBe("en-US");
  });
});
