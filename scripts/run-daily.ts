import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

async function fetchNews(keyword: string) {
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://news.google.com/rss/search?q=${encodedKeyword}+when:24h&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  
  try {
    const response = await axios.get(url);
    const xml = response.data;
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const content = match[1];
      const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
      const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const source = content.match(/<source[\s\S]*?>([\s\S]*?)<\/source>/)?.[1] || "";
      items.push({ title, link, source });
    }
    return items;
  } catch (error) {
    console.error(`Error fetching news for ${keyword}:`, error);
    return [];
  }
}

async function generateContent(newsList: any[]) {
  const provider = process.env.AI_PROVIDER || "gemini";
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
    if (provider === "doubao" && process.env.DOUBAO_API_KEY) {
      const openai = new OpenAI({
        apiKey: process.env.DOUBAO_API_KEY,
        baseURL: process.env.DOUBAO_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3",
      });

      const response = await openai.chat.completions.create({
        model: process.env.DOUBAO_MODEL || "",
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
  } catch (error) {
    console.error("Error generating content:", error);
    return "AI 内容生成失败，请检查 API 配置。";
  }
}

async function sendToDingTalk(content: string) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) throw new Error("DINGTALK_WEBHOOK not configured");

  const date = new Date().toLocaleDateString('zh-CN');
  const payload = {
    msgtype: "markdown",
    markdown: {
      title: `📅 ${date} 行业动态速递`,
      text: `## 📅 ${date} 行业动态速递\n\n${content}`
    }
  };

  await axios.post(webhook, payload);
}

async function run() {
  console.log("Starting daily news task...");
  const keywords = (process.env.KEYWORDS || "AI技术").split(",").map(k => k.trim());
  let allNews: any[] = [];
  
  for (const keyword of keywords) {
    const news = await fetchNews(keyword);
    allNews = [...allNews, ...news];
  }

  const uniqueNews = Array.from(new Map(allNews.map(item => [item.title, item])).values());
  console.log(`Fetched ${uniqueNews.length} unique news items.`);
  
  const aiContent = await generateContent(uniqueNews);
  await sendToDingTalk(aiContent);
  console.log("Task completed successfully.");
}

run().catch(err => {
  console.error("Task failed:", err);
  process.exit(1);
});
