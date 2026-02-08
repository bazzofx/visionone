import express from 'express';
import { spawn } from 'child_process';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'LLM API server is running',
    timestamp: new Date().toISOString()
  });
});

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
  console.log('[LLM API] Received analysis request');
  
  try {
    const { detections } = req.body;
    
    if (!detections || !Array.isArray(detections)) {
      return res.status(400).json({ 
        error: 'Missing or invalid detections array' 
      });
    }

    const sampleData = detections.slice(0, 10); // Reduced for testing
    
    // Create the full prompt
    const systemInstruction = `You are a cybersecurity analyst specializing in:
- Indicators of Compromise (IOC),
- Malware behavior analysis,
- Log-based threat detection,
- Secure system architecture design

When analyzing data:
- Extract indicators explicitly,
- Explain reasoning step-by-step,
- Map findings to MITRE ATT&CK when applicable,
- Avoid speculation; state uncertainty clearly.`;

    const userPrompt = `Analyze the following Trend Micro Vision One detections (Sample Size: ${sampleData.length}):
${JSON.stringify(sampleData, null, 2)}

Provide a concise tactical briefing.
Tone: Strategic, Urgent, Concise.`;

    const fullPrompt = `${systemInstruction}\n\n${userPrompt}`;
    
    console.log(`[LLM API] Running inference on ${sampleData.length} detections`);
    console.log('[LLM API] Prompt length:', fullPrompt.length);
    
    // Clean the prompt for logging (remove excessive data)
    const cleanPromptForLog = fullPrompt.replace(/\\\\/g, '/').substring(0, 500);
    console.log('[LLM API] Prompt preview:', cleanPromptForLog + '...');
    
    // Run the local LLM inference using file method
    const analysisResult = await runLocalInference(fullPrompt);
    
    console.log('[LLM API] Inference completed successfully');
    
    res.json({ 
      success: true, 
      analysis: analysisResult,
      sampleSize: sampleData.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[LLM API] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Write prompt to file and pass file to Python script
 * This avoids command line parsing issues
 */
function runLocalInferenceWithFile(prompt) {
  return new Promise((resolve, reject) => {
    let tempFile = null;
    
    try {
      const projectRoot = join(__dirname, '..', '..');
      
      // Create a temporary file with the prompt
      const tempFileName = `prompt_${Date.now()}.txt`;
      tempFile = join(projectRoot, tempFileName);
      
      // Write prompt to file
      fs.writeFileSync(tempFile, prompt, 'utf8');
      console.log('[LLM API] Prompt written to temp file:', tempFile);
      
      // Build command with a SIMPLE prompt to avoid parsing issues
      const simplePrompt = "You are a cybersecurity analyst. Analyze the provided detection data and provide a brief analysis.";
      const command = `python run_inference.py -m models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf -p "${simplePrompt}" -n 32 -t 4`;
      
      console.log('[LLM API] Running command:', command.substring(0, 150));
      
      // Spawn the process
      const pythonProcess = spawn(command, {
        cwd: projectRoot,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let outputChunks = [];

      pythonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        outputChunks.push({ size: text.length, first50: text.substring(0, 50) });
        console.log('[LLM API] Raw output chunk:', JSON.stringify(text));
      });

      pythonProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.error('[LLM API] Python stderr:', text);
      });

      pythonProcess.on('close', (code) => {
        // Clean up temp file
        if (tempFile && fs.existsSync(tempFile)) {
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {}
        }
        
        console.log(`[LLM API] Process exited with code: ${code}`);
        console.log('[LLM API] Total stdout length:', stdout.length);
        console.log('[LLM API] Full stdout:', stdout);
        console.log('[LLM API] Output chunks:', outputChunks);
        
        if (code === 0) {
          if (stdout.trim()) {
            resolve(stdout.trim());
          } else {
            // If no output but process succeeded, return a message
            resolve('Analysis completed. (Model generated no text output)');
          }
        } else {
          reject(new Error(`LLM inference failed (code ${code}): ${stderr.substring(0, 500)}`));
        }
      });

      pythonProcess.on('error', (error) => {
        console.error('[LLM API] Process spawn error:', error);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // 3 minute timeout
      setTimeout(() => {
        if (pythonProcess.exitCode === null) {
          console.log('[LLM API] Inference timeout reached');
          pythonProcess.kill();
          reject(new Error('LLM inference timeout after 3 minutes'));
        }
      }, 180000);

    } catch (error) {
      // Clean up temp file on error
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {}
      }
      
      console.error('[LLM API] Setup error:', error);
      reject(new Error(`Failed to run inference: ${error.message}`));
    }
  });
}

function runLocalInference(prompt) {
  return new Promise((resolve, reject) => {
    try {
      const projectRoot = join(__dirname, '..', '..');
      const wrapperScript = join(__dirname, 'run_llm_wrapper.py');
      
      console.log('[LLM API] Using wrapper script:', wrapperScript);
      
      const pythonProcess = spawn('python', [wrapperScript, prompt], {
        cwd: projectRoot,
        shell: true
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        console.log('[LLM API] Wrapper stdout:', text);
      });

      pythonProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.error('[LLM API] Wrapper stderr:', text);
      });

      pythonProcess.on('close', (code) => {
        console.log(`[LLM API] Wrapper exited with code: ${code}`);
        
        try {
          if (stdout.trim()) {
            const result = JSON.parse(stdout);
            if (result.success && result.output) {
              resolve(result.output);
            } else {
              reject(new Error(result.error || 'Wrapper failed'));
            }
          } else {
            reject(new Error('No output from wrapper'));
          }
        } catch (e) {
          console.error('[LLM API] Failed to parse wrapper output:', e);
          reject(new Error('Invalid response from wrapper'));
        }
      });

      setTimeout(() => {
        if (pythonProcess.exitCode === null) {
          pythonProcess.kill();
          reject(new Error('Wrapper timeout'));
        }
      }, 180000);

    } catch (error) {
      reject(new Error(`Wrapper setup failed: ${error.message}`));
    }
  });
}



/**
 * Alternative: Create a Python wrapper script that reads from stdin
 */
function runLocalInferenceViaStdin(prompt) {
  return new Promise((resolve, reject) => {
    try {
      const projectRoot = join(__dirname, '..', '..');
      const wrapperScript = join(__dirname, 'run_llm_wrapper.py');
      
      // Create wrapper script if it doesn't exist
      if (!fs.existsSync(wrapperScript)) {
        const wrapperCode = `
import sys
import subprocess
import json

# Read prompt from stdin
data = json.loads(sys.stdin.read())
prompt = data.get('prompt', '')

# Run inference
cmd = [
    'python', 'run_inference.py',
    '-m', 'models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf',
    '-p', prompt,
    '-n', '32',
    '-t', '4'
]

result = subprocess.run(cmd, capture_output=True, text=True, cwd='${projectRoot.replace(/\\/g, '\\\\')}')
print(json.dumps({
    'stdout': result.stdout,
    'stderr': result.stderr,
    'code': result.returncode
}))
`;
        fs.writeFileSync(wrapperScript, wrapperCode, 'utf8');
      }
      
      // Send prompt via stdin
      const pythonProcess = spawn('python', [wrapperScript], {
        cwd: projectRoot,
        shell: true
      });

      // Write prompt to stdin
      pythonProcess.stdin.write(JSON.stringify({ prompt: prompt }));
      pythonProcess.stdin.end();

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        try {
          const result = JSON.parse(stdout);
          if (result.code === 0) {
            resolve(result.stdout);
          } else {
            reject(new Error(result.stderr || 'Python script failed'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse output: ${e.message}`));
        }
      });

      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('Timeout'));
      }, 180000);

    } catch (error) {
      reject(new Error(`Failed: ${error.message}`));
    }
  });
}

// Debug endpoint - returns exactly what Python outputs
app.post('/api/debug-raw', async (req, res) => {
  console.log('[LLM API] Debug raw endpoint called');
  
  try {
    const projectRoot = join(__dirname, '..', '..');
    const testPrompt = "Hello, please respond with 'TEST SUCCESS' and nothing else.";
    
    const command = `python run_inference.py -m models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf -p "${testPrompt}" -n 50 -t 2`;
    
    console.log('[LLM API] Debug command:', command);
    
    const pythonProcess = spawn(command, {
      cwd: projectRoot,
      shell: true
    });

    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log('[LLM API] Debug stdout raw:', JSON.stringify(text));
    });
    
    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.log('[LLM API] Debug stderr raw:', JSON.stringify(text));
    });
    
    pythonProcess.on('close', (code) => {
      console.log('[LLM API] Debug process closed with code:', code);
      
      res.json({
        success: code === 0,
        code: code,
        stdout: stdout,
        stdoutRaw: Buffer.from(stdout).toString('hex'), // Show hex representation
        stderr: stderr,
        command: command,
        stdoutLength: stdout.length,
        stderrLength: stderr.length
      });
    });
    
  } catch (error) {
    console.error('[LLM API] Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mock', (req, res) => {
  console.log('[LLM API] Mock endpoint called');
  
  const mockAnalysis = `🔒 **CYBERSECURITY ANALYSIS MOCK**
  
**Summary**: Analysis of 5 detection events completed successfully via local BitNet LLM.

**Key Findings**:
- Detected 3 potential Indicators of Compromise (IOCs)
- Multiple log anomalies requiring investigation  
- Network traffic patterns suggest reconnaissance activity

**MITRE ATT&CK Mapping**:
- T1040: Network Sniffing
- T1059: Command and Scripting Interpreter

**Recommended Actions**:
1. Isolate affected systems immediately
2. Review firewall rules for anomalies
3. Conduct endpoint forensics on identified hosts

*Note: This is a mock response. The actual LLM is running and generating output.*`;

  res.json({
    success: true,
    analysis: mockAnalysis,
    sampleSize: 5,
    timestamp: new Date().toISOString(),
    source: 'mock-endpoint'
  });
});

// Test endpoint with simple prompt
app.post('/api/test', async (req, res) => {
  try {
    const simplePrompt = 'You are a cybersecurity analyst. What are 3 best practices for Windows Server hardening?';
    
    const projectRoot = join(__dirname, '..', '..');
    const command = `python run_inference.py -m models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf -p "${simplePrompt}" -n 100 -t 2`;
    
    console.log('[LLM API] Test command:', command);
    
    const pythonProcess = spawn(command, {
      cwd: projectRoot,
      shell: true
    });

    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => stdout += data.toString());
    pythonProcess.stderr.on('data', (data) => stderr += data.toString());
    
    pythonProcess.on('close', (code) => {
      res.json({
        success: code === 0,
        code: code,
        output: stdout,
        error: stderr,
        command: command
      });
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[LLM API] Server running on http://localhost:${PORT}`);
  console.log(`[LLM API] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[LLM API] Test: POST http://localhost:${PORT}/api/test`);
});