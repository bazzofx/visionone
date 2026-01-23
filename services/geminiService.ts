
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
    1. Quick summary 10-20 words of the event, make a judgement between False Positive, True Positive or Suspicious
    2. Key threat patterns observed (e.g., common attachment types, suspicious subjects).
    3. High-risk users or targets.
    4. Recommended immediate response actions for these specific events.
    
    Format the output using professional Markdown with clear headings. Use a serious, analytical tone.
    Use Markdown headings for main sections: # for title, ### or #### for subsections.
    Include bold labels for metadata (Date, Analyst, Severity),users, files, tools
    Add one blank line between list blocks and paragraphs.
    Keep three dashes --- to separate metadata from content, if present.
    Keep the formatting consistent throughout all sections.
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
