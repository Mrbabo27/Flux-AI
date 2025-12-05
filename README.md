# ⚡ Flux-AI

AI-Powered Chat Experience with two versions optimized for different use cases.

## 📱 Mobile Version (Odysseus)

The Mobile version is a standalone web application designed for in-browser AI inference.

**Features:**
- In-browser AI powered by WebLLM
- Runs Llama-3.2-3B directly in your browser using WebGPU
- Thinking Mode for complex problem solving
- Zero setup - no server required
- Works offline after initial model download (~2-3GB)

**Getting Started:**
1. Switch to the [`Mobile`](https://github.com/Mrbabo27/Flux-AI/tree/Mobile) branch
2. Open `index.html` in a modern web browser (Chrome, Edge, or Arc recommended for WebGPU support)
3. Allow the application to download model weights on first run
4. Start chatting!

## 🖥️ Desktop Version (Colossus)

The Desktop version is a client designed to work with local inference servers.

**Features:**
- Works with LM Studio or any OpenAI-compatible local server
- Custom personas support
- More powerful models
- Full control over your AI infrastructure

**Getting Started:**
1. Switch to the [`Desktop`](https://github.com/Mrbabo27/Flux-AI/tree/Desktop) branch
2. Install and run [LM Studio](https://lmstudio.ai/)
3. Start the server on port `1234`
4. Open `index.html` in your web browser
5. Select a model and start chatting!

## 🚀 Quick Access

Visit the [landing page](https://mrbabo27.github.io/Flux-AI/) to choose between Mobile and Desktop versions.

## 📋 Repository Structure

This repository uses branches to separate the two versions:
- **`main`** branch: Landing page and documentation
- **`Mobile`** branch: Standalone in-browser client
- **`Desktop`** branch: Local inference server client
