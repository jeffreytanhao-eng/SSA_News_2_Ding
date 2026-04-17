import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// Version: 3.2.0 - Mobile Optimized (Concise Cards)
async function fetchNews(keyword: string, lang: 'zh' | 'en' = 'zh') {
  const encodedKeyword = encodeURIComponent(keyword);
  const url = lang === 'zh' 
    ? `https://news.google.com/rss/search?q=${encodedKeyword}+when:2d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
    : `https://news.google.com/rss/search?q=${encodedKeyword}+when:2d&hl=en-US&gl=US&ceid=US:en`;
  
  try {
    const response = await axios.get(url, { timeout: 15000 });
    const xml = response.data;
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null && items.length < 30) {
      const content = match[1];
      const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
      const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const pubDateStr = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
      const source = content.match(/<source[\s\S]*?>([\s\S]*?)<\/source>/)?.[1] || "";
      
      const pubDate = new Date(pubDateStr);
      const now = new Date();
      const isRecent = !isNaN(pubDate.getTime()) && (now.getTime() - pubDate.getTime()) < 50 * 60 * 60 * 1000;
      
      if (isRecent && items.length < 15) {
        items.push({ title, link, pubDate: pubDateStr, source, lang });
      }
    }
    return items;
  } catch (error) {
    console.error(`Error fetching ${lang} news for ${keyword}:`, error);
    return [];
  }
}

async function generateContent(newsList: any[]) {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const userContext = process.env.USER_CONTEXT || "作为投资机构从业者，我需要结合关键词为机构做出每日分析";
  const focusMedia = process.env.FOCUS_MEDIA || "SpaceNews, Sputnik News, Via Satellite, 卫星与网络, Space Daily";
  const keywordsStr = process.env.KEYWORDS || "太空态势感知, 太空碎片, 太空垃圾, 卫星碰撞预警, 太空飞行安全";
  const keywords = keywordsStr.split(",").map(k => k.trim()).filter(k => k);
  
  const now = new Date();
  const currentTimeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const prompt = `
作为一个资深自媒体主编，请从以下【新闻列表】中筛选出与【搜索关键词】高度相关的资讯。

【当前时间】：${currentTimeStr} (北京时间)
【搜索关键词】：${keywords.join(", ")}
【创作背景】：${userContext}
【重点关注媒体】：${focusMedia}

【新闻列表】：
${newsList.map((n, i) => `[ID: ${i}] [语言: ${n.lang === 'en' ? '英文' : '中文'}] 标题: ${n.title} | 来源: ${n.source} | 发布时间: ${n.pubDate} | 链接: ${n.link}`).join("\n")}

【筛选准则（重要）】：
1. **时效性校验（最高优先级）**：今天是 ${currentTimeStr}。
   - **绝对剔除**：请严格剔除发布时间早于 48 小时前的资讯。
   - **内容溯源**：即使【发布时间】显示为近期，如果新闻内容描述的是很久以前发生的事件（例如：SpaceX 的 Stargaze 服务实际上是 2024 年或更早的新闻），或者你通过常识判断该资讯是陈旧的重复发布，**必须绝对剔除**。
   - **虚假日期识别**：警惕那些通过重新发布来“刷屏”的低质量新闻网站，它们往往会给旧新闻打上新日期。
2. **语义相关性校验**：确保新闻内容与【搜索关键词】的核心语义相关。
   - **包含广义关联**：请识别近义词、专业术语及科学背景下的关联。
   - **航天领域特例**：例如，“卫星托管/找回/测控”属于“太空态势感知”；“星际物体碎片/陨石监测”在安全预警背景下与“太空碎片”相关。
   - **剔除无关领域**：仍需剔除完全无关的领域（如：地面生活垃圾处理、普通民航飞行安全）。
3. **来源质量评估与交叉验证**：
   - **降级处理**：对于知名度低、经常重发旧闻或内容质量差的网站（如 ekhbary.com, mixvale.com 等），应降低其入选权重。
   - **孤证识别**：如果某条重要资讯仅由上述低质网站报道，且在【新闻列表】中找不到其他主流媒体（如 SpaceNews, Sputnik, Via Satellite, 卫星与网络, 新华网等）的交叉验证，必须在输出中添加可靠性提示。
4. **多语言处理**：
   - 对于标记为【英文】的资讯，请将其标题、概要、分析等所有输出内容**翻译为高质量中文**。
   - 在输出的“概要”栏目中，必须明确标注“原文语言：英文”。
5. **质量优先**：最多不超过 8 条。如果资讯相关度不高，推送条数可以少于 8 条。
6. **补充说明**：如果最终筛选出的资讯不足 8 条，请在文末增加一行描述：“注：今日未发现更多符合关键词高度相关的优质资讯。”

【输出格式要求（手机适配版）】：
请针对筛选出的新闻，严格按照以下手机优先的格式输出，追求极致简洁（使用 Markdown）：

### 📍 [序号] [中文简报题目]
**来源**：[来源] | [发布时间] | [原文语言]
**直达**：[👉 点击查看文章详情]([链接地址])
> **核心摘要**：[极简总结内容，控制在 100 字以内]
> **价值/思路**：[简述对机构价值及创作建议，控制在 100 字以内]
[仅在来源可疑时显示：⚠️ **可靠性提醒**：xxx]

---
注意：每条资讯后必须紧跟分割线 \`---\`。如果没有任何资讯，请仅回复：“今日未发现优质资讯。”
`;

  console.log("Using Provider:", provider);
  console.log("--- DEBUG PROMPT START ---");
  console.log(prompt.substring(0, 500) + "...");
  console.log("--- DEBUG PROMPT END ---");

  try {
    if (provider === "doubao" && process.env.DOUBAO_API_KEY) {
      const openai = new OpenAI({
        apiKey: process.env.DOUBAO_API_KEY.trim(),
        baseURL: process.env.DOUBAO_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3",
      });

      const response = await openai.chat.completions.create({
        model: (process.env.DOUBAO_MODEL || "").trim(),
        messages: [{ role: "user", content: prompt }],
      });

      return response.choices[0].message.content;
    } else {
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
    return `AI 内容生成失败: ${error.message}`;
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
  console.log("=========================================");
  console.log("PRODUCTION VERSION: v3.2.0 (Mobile Opt)");
  console.log("EXECUTION TIME:", new Date().toISOString());
  console.log("=========================================");
  
  const keywordsStr = process.env.KEYWORDS || "太空态势感知, 太空碎片, 太空垃圾, 卫星碰撞预警, 太空飞行安全";
  const keywords = keywordsStr.split(",").map(k => k.trim()).filter(k => k);
  
  // Mapping of Chinese keywords to English for broader search
  const keywordMap: Record<string, string> = {
    "太空态势感知": "Space Situational Awareness",
    "太空碎片": "Space Debris",
    "太空垃圾": "Space Junk",
    "卫星碰撞预警": "Satellite Collision Warning",
    "太空飞行安全": "Space Flight Safety"
  };

  console.log("Target Keywords:", keywords);
  let allNews: any[] = [];
  
  for (const keyword of keywords) {
    // Fetch Chinese news
    const zhNews = await fetchNews(keyword, 'zh');
    allNews = [...allNews, ...zhNews];

    // Fetch English news using translated keyword if available
    const enKeyword = keywordMap[keyword] || keyword;
    const enNews = await fetchNews(enKeyword, 'en');
    allNews = [...allNews, ...enNews];
  }

  const uniqueNews = Array.from(new Map(allNews.map(item => [item.title, item])).values());
  console.log(`Fetched ${uniqueNews.length} unique news items (CN + EN).`);
  
  const aiContent = await generateContent(uniqueNews);
  await sendToDingTalk(aiContent);
  console.log("Task completed successfully.");
}

run().catch(err => {
  console.error("Task failed:", err);
  process.exit(1);
});
