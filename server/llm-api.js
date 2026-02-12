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
function formatPrompt_old(detections) {
  const detectionText = detections.map((d, i) => {
    return `${i + 1}. ${d.description || d.name || 'Unknown'} - Severity: ${d.severity || 'medium'}, Confidence: ${d.confidence || '0%'}`;
  }).join('\n');

  console.log(`DEBUG Detection Text: ${detectionText}`)


  return `You are a security analyst. Analyze these security detections and provide a concise summary:

${detectionText}

Provide a brief analysis including:
1. Overall risk level (Low/Medium/High/Critical)
2. Key findings
3. Recommended actions

Keep it concise, 3-5 sentences maximum.`;
}

function formatPrompt(detections, limit = 100) {
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
  
  // Take only the first N unique detections and stringify as one line
  const logData = JSON.stringify(uniqueDetections.slice(0, limit));
  console.log(`DEBUG LOG DATA-----------------------:${logData}`)

  return `Act as a senior SOC analyst. Analyze the following Trend Micro Vision One detections:

${logData}

Objective:
    Provide a concise summary of:
    1. Quick summary 10-20 words of the event, make a judgement between False Positive, True Positive or Suspicious
    2. Key threat patterns observed and Indicators of compromised in a bullet list
    3. High-risk users or targets in a bullet list
    4. Indepth analysis of logs with explanation of how they correlate together
    5. Recommended immediate response actions for these specific events.
    
    Format Notes:
    Format the output using professional Markdown with clear headings. Use a serious, analytical tone.
    Use Markdown headings for main sections: # for title, ### or #### for subsections.
    Every Header should be on a new line followed by a # for the title
    Include bold labels for metadata (Date, Analyst, Severity),users, files, tools
    Add one blank line between list blocks and paragraphs.
    Keep three dashes --- to separate metadata from content, if present.
    Keep the formatting consistent throughout all sections.
    
    Format the output with professional Markdown headers. Tone: Strategic, Urgent, Concise.
    The answer must strictly follow the below format
    Format Style:

    # Title Log Analysis Report
    ## 1. Quick Summary
    Mmake a judgement between False Positive, True Positive or Suspicious
    Quick summary 10-20 words of the event
    ---
    ## 2. Key Threat Patterns and Indicators of Compromise
    ---
    ## 3. High Risk User Targets
    ---
    ## 4. Event Analysis
    ---
    ## 5. Recommended Immediate Response`;
}




/**
 * Run Ollama and pipe output to variable
 */
// const modelName = 'codellama:7b-instruct'
const modelName = 'llama3.1:8b'
async function runOllamaAndGetOutput(prompt) {
  console.log('[LLM API] Starting Ollama process...');
  
  return new Promise((resolve, reject) => {
    // Start ollama run without prompt argument - we'll pipe via stdin
    

    const ollama = spawn('ollama', ['run', modelName], {
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
      //console.log(`[LLM API] Received ${chunk.length} chars from Ollama`);
    });
    
    // PIPE: Collect stderr data (for debugging)
    ollama.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      // Ollama often outputs progress info to stderr, log only if it's an error
      if (chunk.toLowerCase().includes('error')) {
        console.error('[LLM API] Ollama stderr error:', chunk);
      } else {
       // console.log('[LLM API] Ollama progress:', chunk.substring(0, 50) + '...');
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