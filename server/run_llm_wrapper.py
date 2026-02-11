#!/usr/bin/env python3
"""
Simple Ollama Wrapper
run_llm_wrapper.py
"""
import sys
import subprocess
import json
import os

def run_ollama(prompt, model="codellama:7b-instruct"):
    """Run Ollama with the given prompt"""
    # Clean the prompt
    prompt = prompt.strip()
    if not prompt:
        return {
            'success': False,
            'output': '',
            'error': 'Empty prompt',
            'code': 1
        }
    
    # Build command
    cmd = ['ollama', 'run', model, prompt]
    
    try:
        # Run with timeout
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout
        )
        
        return {
            'success': result.returncode == 0,
            'output': result.stdout.strip(),
            'error': result.stderr.strip(),
            'code': result.returncode
        }
        
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'output': '',
            'error': 'Timeout after 2 minutes',
            'code': 1
        }
    except FileNotFoundError:
        return {
            'success': False,
            'output': '',
            'error': 'ollama command not found',
            'code': 127
        }
    except Exception as e:
        return {
            'success': False,
            'output': '',
            'error': str(e),
            'code': 1
        }

def main():
    # Read prompt from command line or stdin
    if len(sys.argv) > 1:
        prompt = ' '.join(sys.argv[1:])
    else:
        # Read from stdin
        prompt = sys.stdin.read().strip()
    
    if not prompt:
        print(json.dumps({
            'success': False,
            'output': '',
            'error': 'No prompt provided',
            'code': 1
        }))
        sys.exit(1)
    
    # Run Ollama
    result = run_ollama(prompt)
    
    # Output as JSON
    print(json.dumps(result))

if __name__ == '__main__':
    main()