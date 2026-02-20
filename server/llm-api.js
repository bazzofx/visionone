import express from 'express';
import { spawn } from 'child_process';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

// LLM Model Name
// const modelName = 'llama3.1:8b'
const modelName = 'mySOC3-llama'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_WINDOWS = os.platform() === 'win32';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

console.log(`[LLM API] Starting on Windows: ${IS_WINDOWS}`);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', platform: os.platform() });
});

/**
 * Main analysis endpoint - FIXED VERSION
 * Takes detections, sends to Ollama, returns analysis to frontend
 */
app.post('/api/analyze', async (req, res) => {
  console.log('[LLM API] /analyze called');
  
  try {
    const { detections } = req.body;
    console.log(`DEBUG detection: ${detections}`)
    if (!detections || !Array.isArray(detections)) {
      return res.status(400).json({ error: 'Missing detections array' });
    }

    // Format the detections into a proper prompt
    const prompt = formatPrompt(detections);
    console.log('[LLM API] Sending prompt to Ollama (first 5000 chars):', prompt.substring(0, 5000) + '...');
    console.log(`DEBUG PROMPT: ${prompt}`)
    // Run Ollama and get the output
    const analysis = await runOllamaAndGetOutput(prompt);
    
    console.log('[LLM API] Analysis complete, sending to frontend');
    
    // Send the response back to frontend
    res.json({
      success: true,
      analysis: analysis,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[LLM API] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      analysis: null 
    });
  }
});

/**
 * Format detections into a prompt for CodeLlama
 */

function formatPrompt(detections, limit = 200) {
  // Take only the first N detections and stringify as one line
  const uniqueDetections = [];
  const seenProcessNames = new Set();
  
  for (const detection of detections) {
    const processName = detection.processName || detection.processFilePath || '';
    if (!seenProcessNames.has(processName)) {
      seenProcessNames.add(processName);
      uniqueDetections.push(detection);
    }
  }
  
  // Take only the first N unique detections
  const logData = JSON.stringify(uniqueDetections.slice(0, limit), null, 2);
  
  // SIMPLIFIED PROMPT - just the data and minimal instruction
  return `Analyze these Trend Micro Vision One detections and provide a SOC report:

${logData}

Remember: Output ONLY the Markdown report with no additional text.`;
}



async function runOllamaAndGetOutput(prompt) {
  console.log('[LLM API] Starting Ollama process...');
  
  return new Promise((resolve, reject) => {
    // Add parameters to enforce strict formatting
    const ollama = spawn('ollama', [
      'run',
      modelName
    ], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let errorOutput = '';
    
    // Write the prompt to stdin
    ollama.stdin.write(prompt);
    ollama.stdin.end();
    
    // Collect stdout data
    ollama.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
    });
    
    // Collect stderr data
    ollama.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
    });
    
    // Process complete
    ollama.on('close', (code) => {
      console.log(`[LLM API] Ollama process closed with code ${code}`);
      
      if (code === 0) {
        // Clean up the output
        let cleanOutput = output
          .replace(/\x1B\[\d+m/g, '') // Remove ANSI color codes
          .trim();
        
        // Additional cleaning to ensure format
        // Remove any text before the first header
        const headerIndex = cleanOutput.indexOf('# Log Analysis Report');
        if (headerIndex > 0) {
          cleanOutput = cleanOutput.substring(headerIndex);
        }
        
        // Remove any trailing text after the last bullet
        const lastBulletIndex = cleanOutput.lastIndexOf('*');
        if (lastBulletIndex > 0) {
          // Find the end of the line containing the last bullet
          const endOfLine = cleanOutput.indexOf('\n', lastBulletIndex);
          if (endOfLine > 0) {
            cleanOutput = cleanOutput.substring(0, endOfLine + 1);
          }
        }
        
        console.log(`[LLM API] Successfully got ${cleanOutput.length} chars of output`);
        resolve(cleanOutput);
      } else {
        const error = errorOutput || `Process exited with code ${code}`;
        console.error('[LLM API] Ollama failed:', error);
        reject(new Error(error));
      }
    });
    
    // Handle process spawn errors
    ollama.on('error', (err) => {
      console.error('[LLM API] Failed to spawn Ollama:', err);
      reject(new Error(`Failed to start Ollama: ${err.message}`));
    });
    
    // Timeout after 220 seconds
    setTimeout(() => {
      if (ollama.exitCode === null) {
        console.log('[LLM API] Ollama timeout - killing process');
        ollama.kill('SIGKILL');
        reject(new Error('Ollama timeout after 220 seconds'));
      }
    }, 220000);
  });
}

/**
 * Test endpoint to verify Ollama is working
 */
app.get('/api/test-ollama', async (req, res) => {
  try {
    const output = await runOllamaAndGetOutput("Say 'Hello, Ollama is working!' in one sentence.");
    res.json({ 
      success: true, 
      output: output,
      message: 'Ollama is working correctly'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[LLM API] Server running on http://localhost:${PORT}`);
  console.log(`[LLM API] Platform: ${os.platform()}`);
  console.log(`[LLM API] Ollama model: ${model}`);
  console.log(`\n[LLM API] Available endpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/analyze - Main analysis endpoint`);
  console.log(`  GET  http://localhost:${PORT}/api/test-ollama - Test Ollama connection`);
  console.log(`  GET  http://localhost:${PORT}/api/health - Health check`);
});