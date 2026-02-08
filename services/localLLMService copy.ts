import { Detection } from "../types";

// Backend API URL - make sure this matches your server port
const API_BASE_URL = 'http://localhost:3001/api';

/**
 * Analyzes a batch of detections using the local LLM backend API.
 * Replaces Google Gemini API call with local BitNet inference.
 */
export const analyzeDetections = async (detections: Detection[]): Promise<string> => {
  console.log('[LOCAL LLM] Starting analysis with', detections.length, 'detections');
  
  if (!detections.length) return "No detections to analyze.";

  try {
    console.log('[LOCAL LLM] Sending request to backend API...');
    
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        detections: detections.slice(0, 1) // Send only sample for performance
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    console.log('[LOCAL LLM] Analysis completed successfully');
    return data.analysis || "No analysis returned from backend.";

  } catch (error: any) {
    console.error('[LOCAL LLM] Analysis Failure:', error);
    return `Analysis Failed: ${error.message}. Ensure the LLM backend server is running on port 3001.`;
  }
};