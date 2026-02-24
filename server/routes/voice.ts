/**
 * Voice API Routes
 *
 * REST endpoints for voice interaction (desktop assistant, mobile, web):
 * - POST /api/voice/transcribe — Audio → text (Whisper)
 * - POST /api/voice/speak — Text → audio (TTS)
 * - POST /api/voice/chat — Audio in → process → audio + text out (full Jarvis loop)
 * - GET /api/voice/status — Voice service availability
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../logger";

const router = Router();

/**
 * GET /api/voice/status
 * Check voice service availability
 */
router.get("/status", async (_req: Request, res: Response) => {
  const { isVoiceAvailable } = await import("../voice/voice-service");

  res.json({
    available: isVoiceAvailable(),
    stt: !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY),
    tts: !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY),
    model: {
      stt: "whisper-1",
      tts: "tts-1",
    },
  });
});

/**
 * POST /api/voice/transcribe
 * Transcribe audio from URL or uploaded file
 * Body: { audioUrl: string, language?: string }
 */
router.post("/transcribe", async (req: Request, res: Response) => {
  try {
    const { transcribeAudio } = await import("../voice/voice-service");
    const { audioUrl, language } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: "audioUrl is required" });
    }

    const result = await transcribeAudio(audioUrl, language);
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, "Transcription failed");
    res.status(500).json({ error: "Transcription failed", message: error.message });
  }
});

/**
 * POST /api/voice/speak
 * Convert text to speech
 * Body: { text: string, voice?: string }
 */
router.post("/speak", async (req: Request, res: Response) => {
  try {
    const { textToSpeech } = await import("../voice/voice-service");
    const { text, voice } = req.body;

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const result = await textToSpeech(text, voice || "onyx");

    res.set("Content-Type", "audio/opus");
    res.set("Content-Length", result.audioBuffer.length.toString());
    res.send(result.audioBuffer);
  } catch (error: any) {
    logger.error({ error: error.message }, "TTS failed");
    res.status(500).json({ error: "TTS failed", message: error.message });
  }
});

/**
 * POST /api/voice/chat
 * Full voice chat loop: audio URL → transcribe → agent → TTS response
 * Body: { audioUrl: string, agentSlug?: string, language?: string }
 * Returns: { transcription, response, audioUrl? }
 */
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { transcribeAudio, textToSpeech, isVoiceAvailable } = await import("../voice/voice-service");
    const { processIncomingMessage } = await import("../channels/channel-manager");

    const { audioUrl, agentSlug, language } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: "audioUrl is required" });
    }

    // Step 1: Transcribe
    const transcription = await transcribeAudio(audioUrl, language);

    if (!transcription.text || transcription.text.trim().length === 0) {
      return res.json({
        transcription: "",
        response: "I couldn't understand the audio. Please try again.",
        hasAudio: false,
      });
    }

    // Step 2: Route to agent
    const userText = agentSlug
      ? `@${agentSlug} ${transcription.text}`
      : transcription.text;

    const agentResponse = await processIncomingMessage({
      channelMessageId: `voice-${Date.now()}`,
      platform: "web",
      senderId: "voice-user",
      senderName: "Voice User",
      chatId: "voice-session",
      text: userText,
      messageType: "voice",
      timestamp: new Date(),
      metadata: { voice: true, duration: transcription.duration },
    });

    // Step 3: Generate TTS (if available and response is short enough)
    let audioBase64: string | null = null;
    if (isVoiceAvailable() && agentResponse.length < 4000) {
      try {
        const tts = await textToSpeech(agentResponse);
        audioBase64 = tts.audioBuffer.toString("base64");
      } catch {
        // TTS failed, text-only response
      }
    }

    res.json({
      transcription: transcription.text,
      response: agentResponse,
      hasAudio: !!audioBase64,
      audio: audioBase64,
      audioFormat: "opus",
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Voice chat failed");
    res.status(500).json({ error: "Voice chat failed", message: error.message });
  }
});

export default router;
