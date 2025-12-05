# AI-Council (Colossus & Odysseus)

A dual-platform AI chat interface designed to explore different AI personas and interaction modes. This repository contains two distinct applications: a **Desktop** client for local inference servers and a **Mobile** client that runs LLMs entirely in the browser.

## 🌟 Features

### 🖥️ Desktop Client (Colossus)

The Desktop client is designed for power users running local models via tools like **LM Studio**.

- **Local Inference:** Connects to local API servers (default: `localhost:1234`) to use your preferred models.
- **Dynamic Personas:** Switch between various AI personalities (e.g., _POSITIV_, _NEGATIV_, _WITZIG_) defined in `data/personas.json`.
- **Session Management:** Create, rename, and delete chat sessions with persistent storage.
- **Rich Text Support:** Full Markdown rendering and syntax highlighting for code blocks.
- **Customizable:** Easily add new models and personas via JSON configuration.

### 📱 Mobile Client (Odysseus)

The Mobile client is a standalone web application that brings powerful AI to your phone without needing a backend server.

- **In-Browser AI:** Powered by **WebLLM**, it runs `Llama-3.2-3B` directly in your browser using WebGPU.
- **Thinking Mode:** Enables Chain-of-Thought reasoning for complex problem solving.
- **Zero Setup:** No server required – just open the page and chat.

## 🚀 Getting Started

### Desktop Version

1. **Prerequisite:** Install and run [LM Studio](https://lmstudio.ai/) (or any OpenAI-compatible local server).
2. Start the server on port `1234`.
3. Open `Desktop/index.html` in your web browser.
4. Select a model and start chatting!

### Mobile Version

1. Open `Mobile/index.html` in a modern web browser (Chrome, Edge, or Arc recommended for WebGPU support).
2. **First Run:** Allow the application to download the model weights (approx. 2-3GB). This is stored locally in your browser cache.
3. Once initialized, you can chat offline.

## 🛠️ Configuration

### Adding Personas (Desktop)

You can define new AI characters by editing `Desktop/data/personas.json`:

```json
{
  "name": "MY_PERSONA",
  "modelId": "model-id-here",
  "prompt": "You are a helpful assistant...",
  "color": "#ff00ff"
}
```

## 🏗️ Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript
- **AI Engine (Mobile):** [WebLLM](https://webllm.mlc.ai/) (@mlc-ai/web-llm)
- **Styling:** FontAwesome, Highlight.js, Marked.js

---

_Created by Mrbabo27_
