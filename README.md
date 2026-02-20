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

6. Install BackEnd API, `cd server` then `npm install`
7. Run BackEnd API: `node server/llm-api.js`
> If you are running the googleGemin API you do not need to run the back-end local Api server.



## Running BackEnd Local Api Server
If you decide to use BitNet, make sure BitNet LLM is installed and you run run the node llm-api.js inside the virtual environment

```
cd server
node llm-api.js
```

# Set up custom ModelFile
We are using a custom instruction model file with the ollama, this is so we can better control the temperature and other aspects of our model.

## Creating Modelfile
We have the model file located on `server/Modelfile` we will ned to generate the custom model with it.
On the file we are using the `phi3:mini` so we need to have that installed on our computer first using the `ollama cli`

## Creating the Modelfile
Once you have the correct model you want to use, the default is `phi3:mini` but you can change on the Modelfile to a different one

```
ollama create mySOC-llama -f Modelfile
```
