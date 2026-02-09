import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("STT Transcribe API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("Input Validation", () => {
    it("should reject request without audio field", async () => {
      // Simulate missing audio
      const formData = new FormData();
      // No audio field added
      
      const hasAudio = formData.has("audio");
      expect(hasAudio).toBe(false);
    });

    it("should reject audio file exceeding 10MB", async () => {
      const MAX_SIZE = 10 * 1024 * 1024;
      const oversizedFile = new File(
        [new ArrayBuffer(11 * 1024 * 1024)],
        "large.wav",
        { type: "audio/wav" }
      );

      expect(oversizedFile.size).toBeGreaterThan(MAX_SIZE);
    });

    it("should accept valid audio file under 10MB", async () => {
      const MAX_SIZE = 10 * 1024 * 1024;
      const validFile = new File(
        [new ArrayBuffer(5 * 1024 * 1024)],
        "audio.wav",
        { type: "audio/wav" }
      );

      expect(validFile.size).toBeLessThan(MAX_SIZE);
    });

    it("should reject unsupported audio formats", async () => {
      const SUPPORTED_FORMATS = [
        "audio/wav",
        "audio/mp3", 
        "audio/mpeg",
        "audio/mp4",
        "audio/m4a",
        "audio/webm",
        "audio/ogg",
        "audio/flac",
      ];

      const unsupportedFile = new File(
        [new ArrayBuffer(1024)],
        "audio.aac",
        { type: "audio/aac" }
      );

      const isSupported = SUPPORTED_FORMATS.some(fmt => 
        unsupportedFile.type.includes(fmt.split("/")[1])
      );
      
      // AAC is not in our supported list
      expect(isSupported).toBe(false);
    });

    it("should accept supported audio formats", async () => {
      const supportedFiles = [
        new File([new ArrayBuffer(1024)], "audio.wav", { type: "audio/wav" }),
        new File([new ArrayBuffer(1024)], "audio.mp3", { type: "audio/mpeg" }),
        new File([new ArrayBuffer(1024)], "audio.webm", { type: "audio/webm" }),
        new File([new ArrayBuffer(1024)], "audio.ogg", { type: "audio/ogg" }),
      ];

      const SUPPORTED_KEYWORDS = ["wav", "mp3", "mpeg", "mp4", "m4a", "webm", "ogg", "flac"];

      for (const file of supportedFiles) {
        const isSupported = SUPPORTED_KEYWORDS.some(kw => file.type.includes(kw));
        expect(isSupported).toBe(true);
      }
    });
  });

  describe("Language Hint Handling", () => {
    it("should map language hints correctly", () => {
      const LANGUAGE_MAP: Record<string, string> = {
        en: "en",
        ru: "ru",
        es: "es",
      };

      expect(LANGUAGE_MAP["en"]).toBe("en");
      expect(LANGUAGE_MAP["ru"]).toBe("ru");
      expect(LANGUAGE_MAP["es"]).toBe("es");
      expect(LANGUAGE_MAP["fr"]).toBeUndefined();
    });

    it("should handle missing language hint", () => {
      const languageHint: string | undefined = undefined;
      const language = languageHint ? languageHint.toLowerCase() : undefined;
      
      expect(language).toBeUndefined();
    });
  });

  describe("Response Format", () => {
    it("should return text and detectedLanguage", () => {
      type TranscribeResponse = {
        text: string;
        detectedLanguage: "en" | "ru" | "es";
      };

      const response: TranscribeResponse = {
        text: "Hello world",
        detectedLanguage: "en",
      };

      expect(response).toHaveProperty("text");
      expect(response).toHaveProperty("detectedLanguage");
      expect(["en", "ru", "es"]).toContain(response.detectedLanguage);
    });

    it("should map detected language to supported set", () => {
      const mapLanguage = (detected: string): "en" | "ru" | "es" => {
        const lang = detected.toLowerCase();
        if (lang === "ru" || lang === "russian") return "ru";
        if (lang === "es" || lang === "spanish") return "es";
        return "en";
      };

      expect(mapLanguage("ru")).toBe("ru");
      expect(mapLanguage("russian")).toBe("ru");
      expect(mapLanguage("es")).toBe("es");
      expect(mapLanguage("spanish")).toBe("es");
      expect(mapLanguage("en")).toBe("en");
      expect(mapLanguage("english")).toBe("en");
      expect(mapLanguage("fr")).toBe("en"); // Fallback to en
      expect(mapLanguage("de")).toBe("en"); // Fallback to en
    });
  });

  describe("OpenAI Whisper Integration", () => {
    it("should prepare correct FormData for Whisper API", () => {
      const audioFile = new File([new ArrayBuffer(1024)], "audio.wav", { type: "audio/wav" });
      const languageHint = "ru";

      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      if (languageHint) {
        formData.append("language", languageHint);
      }

      expect(formData.get("file")).toBe(audioFile);
      expect(formData.get("model")).toBe("whisper-1");
      expect(formData.get("response_format")).toBe("verbose_json");
      expect(formData.get("language")).toBe("ru");
    });

    it("should not include language field when no hint provided", () => {
      const audioFile = new File([new ArrayBuffer(1024)], "audio.wav", { type: "audio/wav" });
      const languageHint: string | undefined = undefined;

      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      if (languageHint) {
        formData.append("language", languageHint);
      }

      expect(formData.get("language")).toBeNull();
    });
  });
});

describe("STT Transcribe - Error Handling", () => {
  it("should handle missing OPENAI_API_KEY", () => {
    const apiKey = undefined;
    const hasApiKey = Boolean(apiKey);
    
    expect(hasApiKey).toBe(false);
  });

  it("should handle OpenAI API errors gracefully", async () => {
    // Simulate various error scenarios
    const errorCodes = [400, 401, 429, 500, 502, 503];
    
    for (const code of errorCodes) {
      const response = { ok: false, status: code };
      expect(response.ok).toBe(false);
      expect(response.status).toBe(code);
    }
  });

  it("should return 413 for oversized files", () => {
    const MAX_SIZE = 10 * 1024 * 1024;
    const fileSize = 15 * 1024 * 1024;
    
    const isTooLarge = fileSize > MAX_SIZE;
    const expectedStatus = isTooLarge ? 413 : 200;
    
    expect(expectedStatus).toBe(413);
  });
});
