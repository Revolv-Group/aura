/**
 * Voice Service — Whisper STT + OpenAI TTS
 *
 * Handles voice message transcription and text-to-speech generation
 * for Telegram voice message support (Jarvis-style interaction).
 *
 * STT: OpenAI Whisper via OpenRouter
 * TTS: OpenAI TTS via direct API
 */

import { logger } from "../logger";

// ============================================================================
// SPEECH-TO-TEXT (Whisper)
// ============================================================================

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe a voice message from a URL (e.g. Telegram file link).
 * Downloads the audio, sends to Whisper API.
 */
export async function transcribeAudio(
  audioUrl: string,
  language?: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or OPENROUTER_API_KEY required for voice transcription");
  }

  // Download audio file
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio: ${audioResponse.status}`);
  }

  const audioBuffer = await audioResponse.arrayBuffer();
  const audioBlob = new Blob([audioBuffer], { type: "audio/ogg" });

  // Build form data for Whisper API
  const formData = new FormData();
  formData.append("file", audioBlob, "voice.ogg");
  formData.append("model", "whisper-1");
  if (language) {
    formData.append("language", language);
  }

  // Use OpenAI directly for Whisper (OpenRouter doesn't proxy Whisper)
  const whisperUrl = process.env.OPENAI_API_KEY
    ? "https://api.openai.com/v1/audio/transcriptions"
    : "https://openrouter.ai/api/v1/audio/transcriptions";

  const whisperKey = process.env.OPENAI_API_KEY || apiKey;

  const response = await fetch(whisperUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${whisperKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  logger.debug(
    { textLength: result.text?.length, language: result.language },
    "Voice transcribed"
  );

  return {
    text: result.text,
    language: result.language,
    duration: result.duration,
  };
}

// ============================================================================
// TEXT-TO-SPEECH
// ============================================================================

export interface TTSResult {
  audioBuffer: Buffer;
  contentType: string;
}

/**
 * Convert text to speech using OpenAI TTS.
 * Returns audio buffer ready to send as voice message.
 */
export async function textToSpeech(
  text: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "onyx"
): Promise<TTSResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or OPENROUTER_API_KEY required for TTS");
  }

  // Truncate long text (TTS has a 4096 char limit)
  const maxChars = 4000;
  const truncatedText = text.length > maxChars
    ? text.slice(0, maxChars) + "..."
    : text;

  const ttsUrl = process.env.OPENAI_API_KEY
    ? "https://api.openai.com/v1/audio/speech"
    : "https://openrouter.ai/api/v1/audio/speech";

  const ttsKey = process.env.OPENAI_API_KEY || apiKey;

  const response = await fetch(ttsUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ttsKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: truncatedText,
      voice,
      response_format: "opus", // Good for Telegram voice messages
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS API error ${response.status}: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  logger.debug(
    { textLength: text.length, voice, audioSize: arrayBuffer.byteLength },
    "TTS generated"
  );

  return {
    audioBuffer: Buffer.from(arrayBuffer),
    contentType: "audio/opus",
  };
}

/**
 * Check if voice services are available
 */
export function isVoiceAvailable(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
}
