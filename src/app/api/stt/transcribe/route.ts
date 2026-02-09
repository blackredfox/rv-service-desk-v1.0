import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Maximum audio file size: 10MB
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

// Supported audio formats
const SUPPORTED_FORMATS = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
];

// Language hint mapping
const LANGUAGE_MAP: Record<string, string> = {
  en: "en",
  ru: "ru", 
  es: "es",
};

type TranscribeResponse = {
  text: string;
  detectedLanguage: "en" | "ru" | "es";
};

type OpenAITranscriptionResponse = {
  text: string;
  language?: string;
};

/**
 * POST /api/stt/transcribe
 * 
 * Transcribes audio to text using OpenAI Whisper.
 * Does NOT store audio - session only.
 * 
 * Request: multipart/form-data
 *   - audio: File (wav/mp3/m4a/webm/ogg/flac)
 *   - languageHint?: string (en|ru|es)
 * 
 * Response: { text: string, detectedLanguage: "en"|"ru"|"es" }
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData().catch(() => null);
    
    if (!formData) {
      return NextResponse.json(
        { error: "Invalid request. Expected multipart/form-data." },
        { status: 400 }
      );
    }

    // Get audio file
    const audioFile = formData.get("audio");
    
    if (!audioFile || !(audioFile instanceof File)) {
      return NextResponse.json(
        { error: "Missing required field: audio" },
        { status: 400 }
      );
    }

    // Validate file size
    if (audioFile.size > MAX_AUDIO_SIZE) {
      const sizeMB = (audioFile.size / 1024 / 1024).toFixed(1);
      return NextResponse.json(
        { error: `Audio file too large (${sizeMB}MB). Maximum is 10MB.` },
        { status: 413 }
      );
    }

    // Validate file type
    const mimeType = audioFile.type.toLowerCase();
    if (!SUPPORTED_FORMATS.some((fmt) => mimeType.includes(fmt.split("/")[1]))) {
      return NextResponse.json(
        { error: `Unsupported audio format: ${mimeType}. Supported: wav, mp3, m4a, webm, ogg, flac.` },
        { status: 400 }
      );
    }

    // Get optional language hint
    const languageHint = formData.get("languageHint");
    const language = typeof languageHint === "string" 
      ? LANGUAGE_MAP[languageHint.toLowerCase()] 
      : undefined;

    // Prepare form data for OpenAI
    const openAIFormData = new FormData();
    openAIFormData.append("file", audioFile);
    openAIFormData.append("model", "whisper-1");
    openAIFormData.append("response_format", "verbose_json");
    
    if (language) {
      openAIFormData.append("language", language);
    }

    console.log(`[STT API] Transcribing audio: size=${audioFile.size}, type=${mimeType}, languageHint=${language || "auto"}`);

    // Call OpenAI Whisper API
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: openAIFormData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[STT API] OpenAI error (${response.status}): ${errorText.slice(0, 500)}`);
      return NextResponse.json(
        { error: `Transcription failed: ${response.status}` },
        { status: 502 }
      );
    }

    const result = await response.json() as OpenAITranscriptionResponse;
    
    // Map detected language to our supported set
    const detectedLang = result.language?.toLowerCase() || "en";
    let detectedLanguage: "en" | "ru" | "es" = "en";
    
    if (detectedLang === "ru" || detectedLang === "russian") {
      detectedLanguage = "ru";
    } else if (detectedLang === "es" || detectedLang === "spanish") {
      detectedLanguage = "es";
    }

    console.log(`[STT API] Transcription complete: ${result.text.length} chars, language=${detectedLanguage}`);

    const responseBody: TranscribeResponse = {
      text: result.text || "",
      detectedLanguage,
    };

    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[STT API] Error: ${message}`);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
