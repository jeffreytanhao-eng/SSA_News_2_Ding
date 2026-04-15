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
  const userContext = process.env.USER_CONTEXT || "作为投资机构从业者，我需要结合关键词为机构做出每日分析";
  const focusMedia = process.env.FOCUS_MEDIA || "暂无特定关注媒体";
  const keywords = (process.env.KEYWORDS || "").split(",").map(k => k.trim()).filter(k => k);
  
  const prompt = `
作为一个资深自媒体主编，请从以下【新闻列表】中筛选出与【搜索关键词】高度相关的资讯。

【搜索关键词】：
${keywords.join(", ")}

【创作背景/基本信息】：
${userContext}

【重点关注媒体/公众号】：
${focusMedia}

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
