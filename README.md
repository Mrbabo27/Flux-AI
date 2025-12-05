# Flux-AI Mobile (Odysseus)

This is the **Mobile** branch of Flux-AI. It contains the standalone web application designed for in-browser inference.
# Flux-AI Desktop (Colossus)

This is the **Desktop** branch of Flux-AI. It contains the desktop client designed for local inference servers.

> **Looking for the Mobile version?**
> Switch to the `Mobile` branch to access the standalone in-browser client (Odysseus).

> **Looking for the Desktop version?**
> Switch to the `Desktop` branch to access the local inference client (Colossus).

## 🌟 Features

## 🚀 Getting Started

1. Open `Mobile/index.html` in a modern web browser (Chrome, Edge, or Arc recommended for WebGPU support).
2. **First Run:** Allow the application to download the model weights (approx. 2-3GB). This is stored locally in your browser cache.
3. Once initialized, you can chat offline.
1. **Prerequisite:** Install and run [LM Studio](https://lmstudio.ai/) (or any OpenAI-compatible local server).
2. Start the server on port `1234`.
3. Open `Desktop/index.html` in your web browser.
4. Select a model and start chatting!

## 🛠️ Configuration

### Adding Personas

You can define new AI characters by editing `Desktop/data/personas.json`:

```json
{
  "name": "MY_PERSONA",
  "modelId": "model-id-here",
  "prompt": "You are a helpful assistant...",
}
```
