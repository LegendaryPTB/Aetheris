import express from "express";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/chat", async (req, res) => {
    try {
      const { model, messages } = req.body;
      
      if (!model || !messages) {
        return res.status(400).json({ error: "Model and messages are required" });
      }

      if (model.startsWith("gpt-")) {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set. Please add it to the Secrets panel.");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
          model,
          messages,
        });
        res.json({ text: response.choices[0].message.content });
      } else if (model.startsWith("claude-")) {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Please add it to the Secrets panel.");
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        
        // Extract system message if present, as Anthropic handles it separately
        const systemMessage = messages.find((m: any) => m.role === 'system')?.content || "";
        const userMessages = messages.filter((m: any) => m.role !== 'system').map((m: any) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        }));

        const response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: systemMessage,
          messages: userMessages,
        });
        
        const textContent = response.content.find(c => c.type === 'text');
        res.json({ text: textContent ? (textContent as any).text : '' });
      } else if (model.startsWith("grok-")) {
        if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not set. Please add it to the Secrets panel.");
        const xai = new OpenAI({ 
          apiKey: process.env.XAI_API_KEY,
          baseURL: "https://api.x.ai/v1"
        });
        const response = await xai.chat.completions.create({
          model,
          messages,
        });
        res.json({ text: response.choices[0].message.content });
      } else {
        res.status(400).json({ error: "Unsupported model" });
      }
    } catch (error: any) {
      console.error("Chat API Error:", error);
      
      let errorMessage = error.message || "Internal Server Error";
      let statusCode = 500;

      if (error.status === 401 || error.message?.includes('401')) {
        statusCode = 401;
        if (model.startsWith('gpt-')) {
          errorMessage = "Invalid OpenAI API Key. Please check your OPENAI_API_KEY in the Secrets panel.";
        } else if (model.startsWith('claude-')) {
          errorMessage = "Invalid Anthropic API Key. Please check your ANTHROPIC_API_KEY in the Secrets panel.";
        } else if (model.startsWith('grok-')) {
          errorMessage = "Invalid xAI API Key. Please check your XAI_API_KEY in the Secrets panel.";
        }
      }

      res.status(statusCode).json({ error: errorMessage });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
