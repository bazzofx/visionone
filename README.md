# Trend Vision Done + LLM

**Prerequisites:**  
- Node.js

**Optional:** 
- BitNetLLM(If you want local LLM Analysis, FREE using CPU) 
- Google Gemini (Easy set up, just need API Key)

---

1. Install dependencies:
   `npm install`
2. Set the `VITE_TREND_API_KEY=` in [.env.local](.env.local) 
3. Set the `VITE_GEMINI_API_KEY=` in [.env.local](.env.local)
The  Google Gemini API is no longer the default option, and s not been utilized. To use it again change from app.tsx `import { analyzeDetections }` to import `geminiService` instead of `localLLmService`.
4. Install [BitNet LLM](https://github.com/microsoft/BitNet) if you rather have local LLM. Vice versa, if you do not want to use the BitNet, and want to use the Google Gemini API instead, you will need to change the `import { analyzeDetections }` from `localLLMService` to `geminiService`
5. Run the app:
   `npm run dev`

6. Activate Virtual Env: `venv/script/activate`
7. Run BackEnd API: `node server/llm-api.js`
> If you are running the googleGemin API you do not need to run the back-end local Api server.



## Running BackEnd Local Api Server
Make sure BitNet LLM is installed and you run run the node llm-api.js inside the virtual environment

```
cd server
node llm-api.js
```



## Dependency Microsoft BitNet LLM
> Obs: You need to have BitNet LLM installed already and be available 2 folders behind ../../
In another words, we need to be able to run the below first before we can deploy the local LLM
### BitNet LLM (once installed)
```
python run_inference.py -m models/BitNet-b1.58-2B-4T/ggml-model-i2_s.gguf -p "You are a cybersecurity analyst specializing" -n 256 -t 4

#use the option -cnv to run in conversation mode,this is useful to have interactive chat mode from the terminal
```

## Installing Microsoft BitNet LLM
Follow the guide on the official Github

On Windows/Linux you will need to install the below
### Extra Installations
### cmake 
[Download Cmake](https://cmake.org/download/)
- Add to %PATH%
- Re-open Terminal
- `cmake --version`

### clang
[Download Clang](https://github.com/llvm/llvm-project/releases)
- Add to %PATH%
- Re-open Terminal
- `clang --version`

### Visual Studio Clang
Open Visual Studio Community Edition > Modify > then install the below:
- C++ Clang tools for Windows


## Other Fixes done when instaling BitNet
### ✔️ Necessary changes to Fix Errors on Compile

Find the following line in src/ggml-bitnet-mad.cpp (around line 811):
```
int8_t * y_col = y + col * by;
```
And Change it to:
```
const int8_t * y_col = y + col * by
```

----

Add `#include <chrono>` to the very top of the file, first import 
to all 
- `common.cpp files`
- `log.cpp`
- `imatrix.cpp` 
- `perplexity.cpp`

