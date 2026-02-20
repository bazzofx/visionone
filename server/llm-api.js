import express from 'express';
import { spawn } from 'child_process';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

// LLM Model Name
// const modelName = 'llama3.1:8b'
const modelName = 'mySOC-llama'

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



function formatPrompt_V1(detections, limit = 100) {
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
Provide a concise summary of a security event based on the provided log data. The final output must be a strictly formatted Markdown document.

Required Content:
Your response must include the following five sections, in order:

Quick Summary: A 10-20 word summary of the event, including a judgement of False Positive, True Positive, or Suspicious.

Key Threat Patterns and Indicators of Compromise: A bulleted list of observed threat patterns and specific IOCs (IPs, hashes, domains, tools).

High-Risk User Targets: A bulleted list of specific users or groups targeted.

Event Analysis: An in-depth narrative analysis of the logs, explaining how the events correlate to form the attack chain.

Recommended Immediate Response: A bulleted list of specific, actionable steps to contain and remediate the event.

CRITICAL FORMATTING INSTRUCTIONS:
You are to output your response exclusively using the Markdown structure defined below. Adherence to this exact format is mandatory. The tone must be strategic, urgent, concise, and analytical.

Output Format (Strictly Follow This Structure):

markdown
# Log Analysis Report: [Insert Brief Event Descriptor]

## 1. Quick Summary
**Judgement:** [False Positive / True Positive / Suspicious]
**Summary:** [10-20 word summary of the event]

---

## 2. Key Threat Patterns and Indicators of Compromise
*   **Pattern:** [Description of Tactic, Technique, or Procedure (TTP) observed]
*   **Pattern:** [Description of another TTP]
*   **IOC (IP):** [Malicious IP Address]
*   **IOC (Host):** [Compromised Hostname]
*   **IOC (File):** [Malicious Filename]
*   **IOC (Tool):** [Tool or Utility Used]

---

## 3. High Risk User Targets
*   **[Username]** - [Role/Department]
*   **[Username]** - [Role/Department]

---

## 4. Event Analysis
[Provide a detailed, paragraph-based analysis of the event. Correlate the timeline of events from different log sources (e.g., network, endpoint, authentication). Explain how the initial compromise, lateral movement, and potential impact unfolded based on the evidence. Use bold text for key artifacts like **usernames**, **IP addresses**, and **file names** to improve readability.]

---

## 5. Recommended Immediate Response
*   **Immediate Containment:** [Action 1, e.g., Isolate host WS-FIN-12 from the network.]
*   **Credential Reset:** [Action 2, e.g., Force password reset for affected user j.smith and audit for password reuse.]
*   **Block Indicator:** [Action 3, e.g., Block outbound traffic to IP 203.0.113.45 at the firewall.]
*   **Threat Hunting:** [Action 4, e.g., Search for execution of suspicious_script.ps1 on other assets`;
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
  
  // Take only the first N unique detections
  const logData = JSON.stringify(uniqueDetections.slice(0, limit), null, 2);
  
  // SIMPLIFIED PROMPT - just the data and minimal instruction
  return `Analyze these Trend Micro Vision One detections and provide a SOC report:

${logData}

Remember: Output ONLY the Markdown report with no additional text.`;
}

/**
 * Run Ollama and pipe output to variable
 */
// const modelName = 'codellama:7b-instruct'

async function runOllamaAndGetOutput_v1(prompt) {
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
        // Sends to FrontEnd Here ----------------------------------------------------------->
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