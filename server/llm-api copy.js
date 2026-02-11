import express from 'express';
import { spawn, execSync } from 'child_process';
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

// SIMPLE test - NO JSON, just raw output
app.get('/api/test-simple', async (req, res) => {
  console.log('[LLM API] Test endpoint called');
  
  try {
    const result = await runOllamaSimple("Say hello");
    res.json({ success: true, output: result });
  } catch (error) {
    console.error('[LLM API] Test error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Test with different methods
app.get('/api/test-method/:method', (req, res) => {
  const method = req.params.method;
  console.log(`[LLM API] Testing with method: ${method}`);
  
  const prompt = "What is 2+2? Answer in one word.";
  
  if (method === 'spawn') {
    // Method 1: Direct spawn
    const process = spawn('ollama', ['run', 'codellama:7b-instruct', prompt]);
    handleProcess(process, res);
  } else if (method === 'shell') {
    // Method 2: Shell with quotes
    const process = spawn(`ollama run codellama:7b-instruct "${prompt}"`, {
      shell: true
    });
    handleProcess(process, res);
  } else if (method === 'cmd') {
    // Method 3: For Windows - use cmd.exe
    const process = spawn('cmd.exe', ['/c', 'ollama run codellama:7b-instruct "' + prompt + '"']);
    handleProcess(process, res);
  } else {
    res.json({ error: 'Unknown method' });
  }
});

function handleProcess(process, res) {
  let output = '';
  let error = '';
  
  process.stdout.on('data', (data) => {
    output += data.toString();
    console.log('[LLM API] Output:', data.toString());
  });
  
  process.stderr.on('data', (data) => {
    error += data.toString();
    console.log('[LLM API] Stderr:', data.toString());
  });
  
  process.on('close', (code) => {
    console.log(`[LLM API] Process closed with code: ${code}`);
    res.json({ code, output, error, success: code === 0 });
  });
  
  setTimeout(() => {
    if (process.exitCode === null) {
      process.kill();
      res.json({ timeout: true, output, error });
    }
  }, 30000);
}

// Main analysis endpoint - WORKING VERSION
app.post('/api/analyze', async (req, res) => {
  console.log('[LLM API] /analyze called');
  
  try {
    const { detections } = req.body;
    
    if (!detections || !Array.isArray(detections)) {
      return res.status(400).json({ error: 'Missing detections array' });
    }
    
    // Use a VERY simple prompt for testing
    const simplePrompt = "Analyze this: Suspicious process execution detected. Risk level?";
    
    console.log('[LLM API] Using simple prompt:', simplePrompt);
    
    const result = await runOllamaSimple(simplePrompt);
    
    res.json({
      success: true,
      analysis: result,
      note: 'Using test prompt',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[LLM API] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SIMPLE Ollama runner that WORKS
async function runOllamaSimple(prompt) {
  console.log(`[LLM API] runOllamaSimple with: "${prompt.substring(0, 50)}..."`);
  
  return new Promise((resolve, reject) => {
    // On Windows, we need to handle quotes differently
    const command = IS_WINDOWS 
      ? `ollama run codellama:7b-instruct "${prompt.replace(/"/g, '\\"')}"`
      : `ollama run codellama:7b-instruct '${prompt.replace(/'/g, "\\'")}'`;
    
    console.log(`[LLM API] Running: ${command.substring(0, 100)}...`);
    
    const process = spawn(command, {
      shell: true,
      windowsHide: true
    });
    
    let output = '';
    let error = '';
    
    process.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[LLM API] Got ${text.length} chars of output`);
    });
    
    process.stderr.on('data', (data) => {
      const text = data.toString();
      error += text;
      console.log('[LLM API] Stderr:', text);
    });
    
    process.on('close', (code) => {
      console.log(`[LLM API] Process closed. Code: ${code}, Output length: ${output.length}`);
      
      if (code === 0 && output) {
        resolve(output.trim());
      } else {
        reject(new Error(`Failed (code ${code}): ${error || 'No output'}`));
      }
    });
    
    process.on('error', (err) => {
      console.error('[LLM API] Process error:', err);
      reject(err);
    });
    
    setTimeout(() => {
      if (process.exitCode === null) {
        console.log('[LLM API] Timeout - killing process');
        process.kill('SIGKILL');
        reject(new Error('Timeout after 30 seconds'));
      }
    }, 30000);
  });
}

// Check system info
app.get('/api/system', (req, res) => {
  res.json({
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
    freeMem: Math.round(os.freemem() / 1024 / 1024 / 1024) + 'GB',
    nodeVersion: process.version
  });
});

// Test if we can even spawn a simple command
app.get('/api/test-spawn', (req, res) => {
  console.log('[LLM API] Testing basic spawn...');
  
  const process = spawn('echo', ['hello world'], { shell: true });
  
  let output = '';
  process.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  process.on('close', (code) => {
    res.json({ 
      success: code === 0, 
      output, 
      code,
      message: 'Basic spawn test'
    });
  });
});

app.listen(PORT, () => {
  console.log(`[LLM API] Server running on http://localhost:${PORT}`);
  console.log(`[LLM API] Platform: ${os.platform()}`);
  console.log(`[LLM API] Test endpoints:`);
  console.log(`  GET  http://localhost:${PORT}/api/test-simple`);
  console.log(`  GET  http://localhost:${PORT}/api/test-method/spawn`);
  console.log(`  GET  http://localhost:${PORT}/api/test-method/shell`);
  console.log(`  GET  http://localhost:${PORT}/api/system`);
  console.log(`  POST http://localhost:${PORT}/api/analyze`);
});