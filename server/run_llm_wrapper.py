#!/usr/bin/env python3
import sys
import subprocess
import json
import os

def main():
    # Read the prompt from command line or stdin
    if len(sys.argv) > 1:
        # Join all arguments as the prompt
        prompt = ' '.join(sys.argv[1:])
    else:
        # Try to read from stdin
        try:
            data = json.loads(sys.stdin.read())
            prompt = data.get('prompt', '')
        except:
            prompt = ''
    
    if not prompt:
        print("Error: No prompt provided", file=sys.stderr)
        sys.exit(1)
    
    # Get project root (2 directories up from this script)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.join(script_dir, '..', '..')
    
    # Build the command
    cmd = [
        'python', 'run_inference.py',
        '-m', 'models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf',
        '-p', prompt,
        '-n', '256',
        '-t', '4'
    ]
    
    print(f"Running command: {' '.join(cmd)}", file=sys.stderr)
    
    # Run the inference
    try:
        result = subprocess.run(
            cmd, 
            capture_output=True, 
            text=True, 
            timeout=180,
            cwd=project_root
        )
        
        # Clean up the output
        output = result.stdout.strip()
        
        # If output is empty but stderr has content, use that
        if not output and result.stderr:
            # Filter out the initialization messages
            lines = result.stderr.strip().split('\n')
            meaningful_lines = [line for line in lines if 'llama' not in line.lower() and 'AVX' not in line]
            output = '\n'.join(meaningful_lines)
        
        print(json.dumps({
            'success': result.returncode == 0,
            'output': output,
            'error': result.stderr,
            'code': result.returncode
        }))
        
    except subprocess.TimeoutExpired:
        print(json.dumps({
            'success': False,
            'output': '',
            'error': 'Timeout after 3 minutes',
            'code': 1
        }))
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': '',
            'error': str(e),
            'code': 1
        }))

if __name__ == '__main__':
    main()