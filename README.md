# Flux-AI Desktop (Colossus)

This is the **Desktop** branch of Flux-AI. It contains the desktop client designed for local inference servers.

> **Looking for the Mobile version?**
> Switch to the `Mobile` branch to access the standalone in-browser client (Odysseus).

## 🌟 Features

### 🖥️ Desktop Client (Colossus)

The Desktop client is designed for power users running local models via tools like **LM Studio**.

- **Local Inference:** Connects to local API servers (default: `localhost:1234`) to use your preferred models.
- **Dynamic Personas:** Switch between various AI personalities (e.g., _POSITIV_, _NEGATIV_, _WITZIG_) defined in `data/personas.json`.
- **Session Management:** Create, rename, and delete chat sessions with persistent storage.
- **Rich Text Support:** Full Markdown rendering and syntax highlighting for code blocks.
- **Customizable:** Easily add new models and personas via JSON configuration.

## 🚀 Getting Started

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
