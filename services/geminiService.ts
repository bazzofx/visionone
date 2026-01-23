
import { GoogleGenAI, Type } from "@google/genai";
import { Detection } from "../types";
const googleApiKey = import.meta.env.VITE_GEMINI_API_KEY
export const analyzeDetections = async (detections: Detection[]): Promise<string> => {
  if (!detections.length) return "No detections to analyze.";
  
  const ai = new GoogleGenAI({ apiKey: googleApiKey || '' });
  
  const prompt = `
    Act as a senior SOC analyst. Analyze the following Trend Micro Vision One detections:
    ${JSON.stringify(detections.slice(0, 10))}
    
    Provide a concise summary of:
    1. Key threat patterns observed (e.g., common attachment types, suspicious subjects).
    2. High-risk users or targets.
    3. Recommended immediate response actions for these specific events.
    
    Format the output using professional Markdown with clear headings. Use a serious, analytical tone.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    return response.text || "Unable to generate analysis.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Failed to analyze threats using AI.";
  }
};
