import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
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

async function generateContent(newsList: any[], userContext: string = "", focusMedia: string = "", keywords: string[] = []) {
  const provider = process.env.AI_PROVIDER || "gemini";
  const prompt = `
作为一个资深自媒体主编，请从以下【新闻列表】中筛选出与【搜索关键词】高度相关的资讯。

【搜索关键词】：
${keywords.join(", ")}

【创作背景/基本信息】：
${userContext || "作为投资机构从业者，我需要结合关键词为机构做出每日分析"}

【重点关注媒体/公众号】：
${focusMedia || "暂无特定关注媒体"}

【新闻列表】：
${newsList.map((n, i) => `[ID: ${i}] 标题: ${n.title} | 来源: ${n.source} | 时间: ${n.pubDate} | 链接: ${n.link}`).join("\n")}

【筛选准则（重要）】：
1. **语义相关性校验**：确保新闻内容与【搜索关键词】的核心语义相关。请注意包含近义词、专业术语或科学背景下的关联（例如：“太空碎片”、“星际物体碎片”与“太空垃圾”是高度相关的）。但仍需剔除完全无关的领域（如：地面生活垃圾处理）。
2. **质量优先**：最多不超过 5 条。如果资讯相关度不高，推送条数可以少于 5 条。
3. **补充说明**：如果最终筛选出的资讯不足 5 条，请在文末增加一行描述：“注：今日未发现更多符合关键词高度相关的优质资讯。”

【输出格式要求】：
请针对筛选出的新闻，严格按照以下格式逐一输出（使用 Markdown）：

### [序号] [简要题目]
- **概要**：[简要题目] | [来源] | [发布时间]
- **原始链接**：[链接地址]
- **简要分析与建议**：
  - **主要内容**：[简述文章主要内容]
  - **需求契合点**：[解释其与关键词的相关性及对投资机构的价值]
  - **创作思路**：[建议的文案主题与大概思路，字数控制在 200 字以内]

---
注意：如果没有任何高度相关的资讯，请仅回复：“今日未发现与关键词高度相关的优质资讯。”
`;

  try {
    if (provider === "doubao" && process.env.DOUBAO_API_KEY) {
      const endpoint = (process.env.DOUBAO_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3").trim();
      
      // Basic URL validation to prevent TypeError
      if (!endpoint.startsWith("http")) {
        throw new Error(`无效的 Endpoint URL: ${endpoint}`);
      }

      const openai = new OpenAI({
        apiKey: process.env.DOUBAO_API_KEY.trim(),
        baseURL: endpoint,
      });

      const response = await openai.chat.completions.create({
        model: (process.env.DOUBAO_MODEL || "").trim(),
        messages: [{ role: "user", content: prompt }],
      });

      return response.choices[0].message.content;
    } else {
      // Fallback to Gemini
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const modelName = process.env.LLM_MODEL || "gemini-3-flash-preview";
      
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: prompt }] }],
      });
      return result.text;
    }
  } catch (error: any) {
    console.error("Error generating content:", error);
    const errorMsg = error.response?.data?.error?.message || error.message || "未知错误";
    return `AI 内容生成失败: ${errorMsg}。请检查 API 配置（Provider: ${provider}, Model: ${process.env.DOUBAO_MODEL || '未设置'}）`;
  }
}

async function sendToDingTalk(content: string) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    console.error("DINGTALK_WEBHOOK not configured");
    return { success: false, message: "未配置 DINGTALK_WEBHOOK 环境变量" };
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
    const response = await axios.post(webhook, payload);
    // DingTalk returns 200 even if it fails, need to check errcode
    if (response.data && response.data.errcode !== 0) {
      console.error("DingTalk API Error:", response.data);
      return { 
        success: false, 
        message: `钉钉推送失败: [${response.data.errcode}] ${response.data.errmsg}` 
      };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Network Error sending to DingTalk:", error);
    return { success: false, message: `网络错误: ${error.message}` };
  }
}

// In-memory storage for keywords, initialized from env
let currentKeywords = (process.env.KEYWORDS || "AI技术, 自动驾驶, 半导体").split(",").map(k => k.trim()).filter(k => k);

// API Routes
app.get("/api/config", (req, res) => {
  res.json({
    hasWebhook: !!process.env.DINGTALK_WEBHOOK,
    keywords: currentKeywords.join(", ")
  });
});

app.post("/api/config/keywords", (req, res) => {
  const { keywords } = req.body;
  if (Array.isArray(keywords)) {
    currentKeywords = keywords.map(k => k.trim()).filter(k => k);
    res.json({ success: true, keywords: currentKeywords });
  } else {
    res.status(400).json({ success: false, message: "Invalid keywords format" });
  }
});

app.post("/api/run-task", async (req, res) => {
  const { context, focusMedia } = req.body;
  const keywords = currentKeywords;
  let allNews: any[] = [];
  
  for (const keyword of keywords) {
    const news = await fetchNews(keyword);
    allNews = [...allNews, ...news];
  }

  // Deduplicate by title
  const uniqueNews = Array.from(new Map(allNews.map(item => [item.title, item])).values());
  
  const aiContent = await generateContent(uniqueNews, context, focusMedia, keywords);
  const result = await sendToDingTalk(aiContent);
  
  res.json({ success: result.success, newsCount: uniqueNews.length, message: result.message });
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
