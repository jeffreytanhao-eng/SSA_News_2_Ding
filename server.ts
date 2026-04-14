import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to fetch news via Google News RSS (since feedparser is Python-centric, we'll use a simple fetch + regex or a lightweight parser if available, but for now let's use a public RSS-to-JSON or just fetch the XML)
// Actually, since we are in a Node environment, we should use a Node-compatible RSS parser.
// I'll use 'rss-parser' instead of 'feedparser' (which is common in Python as requested, but this is a TS app).
// Wait, the user asked for Python in the prompt but the environment is Node/TS. 
// I will implement the logic in Node/TS as per the system instructions which prioritize the environment.

async function fetchNews(keyword: string) {
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://news.google.com/rss/search?q=${encodedKeyword}+when:24h&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  
  try {
    const response = await axios.get(url);
    const xml = response.data;
    
    // Simple regex-based extraction for RSS items to avoid adding too many heavy dependencies
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const content = match[1];
      const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
      const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
      const source = content.match(/<source[\s\S]*?>([\s\S]*?)<\/source>/)?.[1] || "";
      
      items.push({ title, link, pubDate, source });
    }
    
    return items;
  } catch (error) {
    console.error(`Error fetching news for ${keyword}:`, error);
    return [];
  }
}

async function generateContent(newsList: any[]) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const modelName = process.env.LLM_MODEL || "gemini-3-flash-preview";
  
  const prompt = `
作为一个资深自媒体主编，请对以下新闻进行点评，并写出一份吸引人的行业日报初稿。

新闻列表：
${newsList.map((n, i) => `${i + 1}. ${n.title} (来源: ${n.source})`).join("\n")}

要求：
1. 深度总结：用一句话提炼每条新闻的核心价值。
2. 创作建议：针对自媒体（如公众号、小红书）给出 3 个爆款切入点。
3. 初稿生成：整合成一篇约 300 字的“行业日报”风格初稿。
4. 格式：使用 Markdown。
`;

  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: prompt }] }],
    });
    return result.text;
  } catch (error) {
    console.error("Error generating content:", error);
    return "AI 内容生成失败。";
  }
}

async function sendToDingTalk(content: string) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    console.error("DINGTALK_WEBHOOK not configured");
    return { success: false, message: "Webhook not configured" };
  }

  const date = new Date().toLocaleDateString('zh-CN');
  const payload = {
    msgtype: "markdown",
    markdown: {
      title: `📅 ${date} 行业动态速递`,
      text: `## 📅 ${date} 行业动态速递\n\n${content}`
    }
  };

  try {
    await axios.post(webhook, payload);
    return { success: true };
  } catch (error) {
    console.error("Error sending to DingTalk:", error);
    return { success: false, error };
  }
}

// API Routes
app.get("/api/config", (req, res) => {
  res.json({
    hasWebhook: !!process.env.DINGTALK_WEBHOOK,
    keywords: process.env.KEYWORDS || ""
  });
});

app.post("/api/run-task", async (req, res) => {
  const keywords = (process.env.KEYWORDS || "AI技术").split(",").map(k => k.trim());
  let allNews: any[] = [];
  
  for (const keyword of keywords) {
    const news = await fetchNews(keyword);
    allNews = [...allNews, ...news];
  }

  // Deduplicate by title
  const uniqueNews = Array.from(new Map(allNews.map(item => [item.title, item])).values());
  
  const aiContent = await generateContent(uniqueNews);
  const result = await sendToDingTalk(aiContent);
  
  res.json({ success: result.success, newsCount: uniqueNews.length });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
