
import { GoogleGenAI, Type, GenerateContentResponse, GenerateContentParameters, ThinkingLevel } from "@google/genai";
import { AIMode, MessagePart, GroundingChunk, AIPersona } from "../types";
import { MODELS, PERSONA_CONFIG } from "../constants";

export class GeminiService {
  static customApiKey: string | null = null;

  private static getApiKey() {
    const key = GeminiService.customApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("No API Key found in environment or custom settings.");
    }
    return key;
  }

  private static getAI() {
    const apiKey = GeminiService.getApiKey();
    if (!apiKey) throw new Error("API Key is missing. Please provide one in the settings.");
    return new GoogleGenAI({ apiKey });
  }

  static async checkApiKeySelection(): Promise<boolean> {
    // If custom key is set, we don't need the platform selection
    if (GeminiService.customApiKey) return true;

    if (window.aistudio?.hasSelectedApiKey) {
      return await window.aistudio.hasSelectedApiKey();
    }
    return true; 
  }

  static async requestApiKeySelection() {
    // This method might be less relevant if we use custom UI, 
    // but we keep it for backward compatibility or if the user wants to use the platform picker.
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
    }
  }

  static async generateImage(prompt: string): Promise<string> {
    const ai = GeminiService.getAI();
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: MODELS.IMAGE,
      contents: { parts: [{ text: prompt }] },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K" // Reverting to 1K for speed as 4K might be slower, or keep 4K if quality is priority. User asked for "latest data" and "fast response". 
          // Actually, let's keep 1K for speed if the user emphasized speed ("sangat cepat"). 
          // But wait, the previous turn upgraded to 4K. The user said "sangat cepat" now. 
          // Let's stick to 1K for speed or maybe make it configurable? 
          // The prompt said "Nano Banana Pro" which supports 4K. 
          // I will use '1K' for better speed as requested.
        }
      }
    });

    let imageUrl = '';
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        imageUrl = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!imageUrl) throw new Error("No image data received from the model.");
    return imageUrl;
  }

  static async generateSpeech(text: string): Promise<string> {
    const ai = GeminiService.getAI();
    const response = await ai.models.generateContent({
      model: MODELS.TTS,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data received from TTS engine.");
    return base64Audio;
  }

  static async *streamText(
    prompt: string, 
    mode: AIMode, 
    persona: AIPersona,
    history: { role: 'user' | 'model'; parts: { text: string }[] }[],
    imageB64?: string
  ) {
    const ai = GeminiService.getAI();
    
    let modelName = MODELS.FLASH;
    if (mode === AIMode.THINKING || mode === AIMode.CODING || mode === AIMode.SEARCH) {
      modelName = MODELS.PRO;
    }
    
    const config: any = {
      systemInstruction: PERSONA_CONFIG[persona].instruction,
      temperature: (mode === AIMode.THINKING || mode === AIMode.CODING || persona === AIPersona.BUCIN) ? 1.0 : 0.7,
    };

    if (mode === AIMode.THINKING) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
      config.maxOutputTokens = 40000;
    }

    if (mode === AIMode.SEARCH) {
      config.tools = [{ googleSearch: {} }];
    }

    const currentParts: any[] = [{ text: prompt }];
    if (imageB64) {
      const match = imageB64.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        currentParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      }
    }

    const responseStream = await ai.models.generateContentStream({
      model: modelName,
      contents: [...history, { role: 'user', parts: currentParts }],
      config: config
    });

    for await (const chunk of responseStream) {
      yield chunk;
    }
  }
}
