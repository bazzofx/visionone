import { Detection } from "../types";

// Backend API URL - make sure this matches your server port
const API_BASE_URL = 'http://localhost:3001/api';

/**
 * Analyzes a batch of detections using the local LLM backend API.
 * Replaces Google Gemini API call with local BitNet inference.
 */
export const analyzeDetections = async (detections: Detection[]): Promise<string> => {
  console.log('[LOCAL LLM] Starting analysis with', detections?.length || 0, 'detections');
  
  if (!detections || detections.length === 0) {
    return "No detections to analyze.";
  }

  try {
    console.log('[LOCAL LLM] Sending to: http://localhost:3001/api/analyze');
    
    const response = await fetch('http://localhost:3001/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        detections: detections.slice(0, 3) // Use only 3 for testing
      })
    });

    console.log('[LOCAL LLM] Response status:', response.status);
    console.log('[LOCAL LLM] Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('[LOCAL LLM] Raw response text:', responseText);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    const data = JSON.parse(responseText);
    console.log('[LOCAL LLM] Parsed response data:', data);
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    console.log('[LOCAL LLM] Analysis received, length:', data.analysis?.length || 0);
    return data.analysis || "No analysis text returned.";

  } catch (error: any) {
    console.error('[LOCAL LLM] Full error:', error);
    return `Analysis Failed: ${error.message}`;
  }
};