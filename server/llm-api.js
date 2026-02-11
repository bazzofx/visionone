import express from 'express';
import { spawn } from 'child_process';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

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
    
    if (!detections || !Array.isArray(detections)) {
      return res.status(400).json({ error: 'Missing detections array' });
    }

    // Format the detections into a proper prompt
    const prompt = formatPrompt(detections);
    console.log('[LLM API] Sending prompt to Ollama (first 100 chars):', prompt.substring(0, 100) + '...');
    
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
function formatPrompt(detections) {
  const detectionText = detections.map((d, i) => {
    return `${i + 1}. ${d.description || d.name || 'Unknown'} - Severity: ${d.severity || 'medium'}, Confidence: ${d.confidence || '0%'}`;
  }).join('\n');

  return `You are a security analyst. Analyze these security detections and provide a concise summary:

${detectionText}

Provide a brief analysis including:
1. Overall risk level (Low/Medium/High/Critical)
2. Key findings
3. Recommended actions

Keep it concise, 3-5 sentences maximum.`;
}

/**
 * Run Ollama and pipe output to variable
 */
async function runOllamaAndGetOutput(prompt) {
  console.log('[LLM API] Starting Ollama process...');
  
  return new Promise((resolve, reject) => {
    // Start ollama run without prompt argument - we'll pipe via stdin
    const ollama = spawn('ollama', ['run', 'codellama:7b-instruct'], {
      shell: false, // Don't use shell for better control
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] // Enable stdin piping
    });
    
    let output = '';
    let errorOutput = '';
    
    // PIPE: Write the prompt to stdin
    ollama.stdin.write(prompt);
    ollama.stdin.end(); // Signal we're done writing
    
    // PIPE: Collect stdout data (this is the model's response)
    ollama.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(`[LLM API] Received ${chunk.length} chars from Ollama`);
    });
    
    // PIPE: Collect stderr data (for debugging)
    ollama.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      // Ollama often outputs progress info to stderr, log only if it's an error
      if (chunk.toLowerCase().includes('error')) {
        console.error('[LLM API] Ollama stderr error:', chunk);
      } else {
        console.log('[LLM API] Ollama progress:', chunk.substring(0, 50) + '...');
      }
    });
    
    // Process complete - output is ready to send to frontend
    ollama.on('close', (code) => {
      console.log(`[LLM API] Ollama process closed with code ${code}`);
      
      if (code === 0) {
        // Clean up the output (remove any ANSI codes, trim whitespace)
        const cleanOutput = output
          .replace(/\x1B\[\d+m/g, '') // Remove ANSI color codes
          .replace(/\r?\n|\r/g, ' ')   // Replace newlines with spaces
          .trim();
        
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
      reject(new Error(`Failed to start Ollama: ${err.message}. Make sure Ollama is installed and codellama:7b-instruct is pulled.`));
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      if (ollama.exitCode === null) {
        console.log('[LLM API] Ollama timeout - killing process');
        ollama.kill('SIGKILL');
        reject(new Error('Ollama timeout after 60 seconds'));
      }
    }, 60000);
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
  console.log(`[LLM API] Ollama model: codellama:7b-instruct`);
  console.log(`\n[LLM API] Available endpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/analyze - Main analysis endpoint`);
  console.log(`  GET  http://localhost:${PORT}/api/test-ollama - Test Ollama connection`);
  console.log(`  GET  http://localhost:${PORT}/api/health - Health check`);
});