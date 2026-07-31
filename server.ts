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

function parseRssXml(xml: string, lang: 'zh' | 'en' = 'zh') {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null && items.length < 30) {
    const content = match[1];
    let title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
    title = title
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
      
    let link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    link = link.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    
    let pubDateStr = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    pubDateStr = pubDateStr.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    
    let source = content.match(/<source[\s\S]*?>([\s\S]*?)<\/source>/)?.[1] || "";
    source = source.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    
    if (!source) {
      const titleParts = title.split(/\s+[-|]\s+/);
      if (titleParts.length > 1) {
        source = titleParts.pop() || "";
        title = titleParts.join(" - ");
      } else {
        try {
          const urlObj = new URL(link);
          source = urlObj.hostname.replace('www.', '');
        } catch (e) {
          source = "News Source";
        }
      }
    }
    
    const pubDate = new Date(pubDateStr);
    const now = new Date();
    const isRecent = !isNaN(pubDate.getTime()) && (now.getTime() - pubDate.getTime()) < 50 * 60 * 60 * 1000;
    
    if (isRecent && items.length < 15) {
      items.push({ title, link, pubDate: pubDateStr, timestamp: pubDate.getTime(), source, lang });
    }
  }
  return items;
}

async function fetchNews(keyword: string, lang: 'zh' | 'en' = 'zh') {
  const encodedKeyword = encodeURIComponent(keyword);
  const googleUrl = lang === 'zh' 
    ? `https://news.google.com/rss/search?q=${encodedKeyword}+when:2d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
    : `https://news.google.com/rss/search?q=${encodedKeyword}+when:2d&hl=en-US&gl=US&ceid=US:en`;
  
  // 1. Try Google News RSS directly
  try {
    const response = await axios.get(googleUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': lang === 'zh' ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    const xml = response.data;
    const items = parseRssXml(xml, lang);
    if (items.length > 0) {
      console.log(`[Google Direct] Successfully fetched ${items.length} items for ${keyword} (${lang})`);
      return items;
    }
  } catch (error: any) {
    console.warn(`[Google Direct] Failed for ${keyword} (${lang}): ${error.message || error}. Trying Google News RSS via rss2json...`);
  }

  // 2. Try Google News RSS via rss2json converter proxy to bypass Google News 503 limits on cloud hosts
  try {
    const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleUrl)}`;
    const response = await axios.get(rss2jsonUrl, { timeout: 10000 });
    if (response.data && response.data.status === 'ok' && Array.isArray(response.data.items)) {
      const items: any[] = [];
      const now = new Date();
      for (const item of response.data.items) {
        let title = item.title || "";
        let link = item.link || "";
        let pubDateStr = item.pubDate || "";
        let source = item.author || "";
        
        if (!source) {
          const titleParts = title.split(/\s+[-|]\s+/);
          if (titleParts.length > 1) {
            source = titleParts.pop() || "";
            title = titleParts.join(" - ");
          } else {
            try {
              const urlObj = new URL(link);
              source = urlObj.hostname.replace('www.', '');
            } catch (e) {
              source = "Google News";
            }
          }
        }

        const pubDate = new Date(pubDateStr);
        const isRecent = !isNaN(pubDate.getTime()) && (now.getTime() - pubDate.getTime()) < 50 * 60 * 60 * 1000;
        
        if (isRecent && items.length < 15) {
          items.push({
            title,
            link,
            pubDate: pubDateStr,
            timestamp: pubDate.getTime(),
            source: source.trim(),
            lang
          });
        }
      }
      
      if (items.length > 0) {
        console.log(`[Google rss2json] Successfully fetched ${items.length} items for ${keyword} (${lang})`);
        return items;
      }
    }
  } catch (error: any) {
    console.warn(`[Google rss2json] Failed for ${keyword} (${lang}): ${error.message || error}. Trying Yahoo News RSS fallback...`);
  }

  // 3. Fallback to Yahoo News Search RSS
  try {
    const yahooUrl = `https://news.search.yahoo.com/rss?p=${encodedKeyword}`;
    const response = await axios.get(yahooUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': lang === 'zh' ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9'
      }
    });
    const xml = response.data;
    const items = parseRssXml(xml, lang);
    console.log(`[Yahoo Fallback] Successfully fetched ${items.length} items from Yahoo News RSS fallback for ${keyword} (${lang})`);
    return items;
  } catch (yahooError: any) {
    console.error(`[Yahoo Fallback] Failed for ${keyword} (${lang}):`, yahooError.message || yahooError);
  }

  return [];
}

async function generateContent(newsList: any[], userContext: string = "", focusMedia: string = "", keywords: string[] = []) {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const now = new Date();
  const currentTimeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  function buildPrompt(list: any[], maxOutputItems: number) {
    return `
作为一个资深自媒体主编，请从以下【新闻列表】中筛选出与【搜索关键词】高度相关的资讯。

【当前时间】：${currentTimeStr} (北京时间)
【搜索关键词】：${keywords.join(", ")}
【创作背景】：${userContext || "作为投资机构从业者，我需要结合关键词为机构做出每日分析"}
【重点关注媒体】：${focusMedia || "SpaceNews, Sputnik News, Via Satellite, 卫星与网络, Space Daily"}

【新闻列表】：
${list.map((n, i) => `[ID: ${i}] [语言: ${n.lang === 'en' ? '英文' : '中文'}] 标题: ${n.title} | 来源: ${n.source} | 发布时间: ${n.pubDate} | 链接: ${n.link}`).join("\n")}

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
5. **质量优先**：最多不超过 12 条。如果资讯相关度不高，推送条数可以少于 12 条。
6. **补充说明**：如果最终筛选出的资讯不足 12 条，请在文末增加一行描述：“注：今日未发现更多符合关键词高度相关的优质资讯。”

【输出格式要求（全对齐版）】：
请针对筛选出的新闻，严格按照以下“全对齐”列表格式输出（使用 Markdown）：

### 📍 [序号] [中文简报题目]
- **来源**：[来源] | [发布时间] | [原文语言]
- **直达**：[👉 点击查看文章详情]([链接地址])
- **核心摘要**：[简明扼要地总结文章核心内容，字数控制在 150 字以内]
- **创作思路**：[简述对投资机构的参考价值及创作建议，字数要求与“核心摘要”保持相近，控制在 150 字左右]
[仅在来源可疑时显示：⚠️ **可靠性提醒**：xxx]

---
注意：每条资讯后必须紧跟分割线 \`---\`。如果没有任何资讯，请仅回复：“今日未发现优质资讯。”
`;
  }

  console.log("Using Provider:", provider);

  try {
    if (provider === "doubao" && process.env.DOUBAO_API_KEY) {
      const rawEndpoint = process.env.DOUBAO_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3";
      
      // Clean and normalize Endpoint URL to prevent double '/api/api/v3' or erroneous suffixes
      const sanitizeEndpoint = (urlStr: string) => {
        let ep = urlStr.trim();
        ep = ep.replace(/\/chat(\/completions)?\/?$/i, "").replace(/\/+$/, "");
        if (ep.endsWith("/api/v3")) return ep;
        if (ep.endsWith("/api")) return ep + "/v3";
        if (ep.endsWith("/v3")) return ep.replace(/\/v3$/, "/api/v3");
        if (ep.includes("volces.com") || ep.includes("volcengineapi.com")) return ep + "/api/v3";
        return ep;
      };

      const customEndpoint = sanitizeEndpoint(rawEndpoint);

      console.log(`[Doubao Config] Base Endpoint URL resolved to: ${customEndpoint}`);

      // We define potential endpoints to attempt sequentially for bypassing localized block/throttle issues in Github Actions or Cloud hosts (US/EU regions)
      const endpointOptions = [
        customEndpoint,
        "https://ark.cn-beijing.volces.com/api/v3", // Mainland domestic endpoint
        "https://ark.ap-southeast-1.volces.com/api/v3" // Volcengine's AP-Southeast (Singapore) endpoint for international cloud hosts / GitHub Actions
      ];

      // Remove duplicate endpoints while preserving priority order
      const uniqueEndpoints = Array.from(new Set(endpointOptions.filter(Boolean)));

      let lastError: any = null;
      
      // We will try up to 3 attempts, scaling down prompt size and using alternative endpoints on failure/timeout
      const attempts = [
        { inputLimit: 20, maxOutput: 8, timeout: 60000 },
        { inputLimit: 12, maxOutput: 5, timeout: 45000 },
        { inputLimit: 8, maxOutput: 3, timeout: 30000 }
      ];

      for (let i = 0; i < attempts.length; i++) {
        const { inputLimit, maxOutput, timeout } = attempts[i];
        const slicedNews = newsList.slice(0, inputLimit);
        const currentPrompt = buildPrompt(slicedNews, maxOutput);

        // Within this attempt, try the endpoints starting from the prioritized list
        for (const activeEndpoint of uniqueEndpoints) {
          console.log(`[Doubao LLM] Attempt ${i + 1}/${attempts.length} using ${activeEndpoint} (Input Limit: ${slicedNews.length}, Max Output: ${maxOutput}, Timeout: ${timeout / 1000}s)`);
          
          try {
            const openai = new OpenAI({
              apiKey: process.env.DOUBAO_API_KEY.trim(),
              baseURL: activeEndpoint,
              timeout: timeout,
              maxRetries: 0 // Prevent client internal retries from hanging, so we can pivot fast
            });

            const response = await openai.chat.completions.create({
              model: (process.env.DOUBAO_MODEL || "").trim(),
              messages: [{ role: "user", content: currentPrompt }],
            }, {
              timeout: timeout
            });

            const content = response.choices[0].message.content;
            if (content && content.trim().length > 0) {
              console.log(`[Doubao LLM] Successfully generated content on Attempt ${i + 1} with endpoint ${activeEndpoint}!`);
              return content;
            }
          } catch (error: any) {
            lastError = error;
            console.warn(`[Doubao LLM] Attempt ${i + 1} with ${activeEndpoint} failed: ${error.message || error}.`);
          }
        }

        if (i < attempts.length - 1) {
          console.warn("Retrying next attempt with reduced prompt size and optimized limits to prevent timeout...");
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // Fallback to Gemini if Doubao fails and Gemini Key is configured
      if (process.env.GEMINI_API_KEY) {
        console.warn("[Doubao LLM] All Doubao attempts failed. Attempting fallback to Gemini API...");
        try {
          const defaultPrompt = buildPrompt(newsList.slice(0, 15), 6);
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim() });
          const modelName = process.env.LLM_MODEL || "gemini-2.5-flash";
          const result = await ai.models.generateContent({
            model: modelName,
            contents: [{ parts: [{ text: defaultPrompt }] }],
          });
          if (result.text) {
            console.log("[Gemini Fallback] Successfully generated content using Gemini Fallback!");
            return result.text;
          }
        } catch (geminiError: any) {
          console.error("[Gemini Fallback] Gemini fallback also failed:", geminiError);
        }
      }

      throw lastError || new Error("Failed to generate content after all attempts and endpoints");
    } else {
      // Fallback to Gemini if configured, or if Doubao is disabled
      const defaultPrompt = buildPrompt(newsList.slice(0, 20), 8);
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const modelName = process.env.LLM_MODEL || "gemini-2.5-flash";
      console.log(`[Gemini LLM] Attempting content generation with model: ${modelName}`);
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text: defaultPrompt }] }],
      });
      return result.text || "今日未发现优质资讯。";
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
let currentKeywords = (process.env.KEYWORDS || "太空态势感知, 太空碎片, 太空垃圾, 卫星碰撞预警, 太空飞行安全").split(",").map(k => k.trim()).filter(k => k);

// API Routes
app.get("/api/config", (req, res) => {
  res.json({
    hasWebhook: !!process.env.DINGTALK_WEBHOOK,
    keywords: currentKeywords.join(", "),
    focusMedia: process.env.FOCUS_MEDIA || "SpaceNews, Sputnik News, Via Satellite, 卫星与网络, Space Daily"
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
  
  // Mapping of Chinese keywords to English for broader search
  const keywordMap: Record<string, string> = {
    "太空态势感知": "Space Situational Awareness",
    "太空碎片": "Space Debris",
    "太空垃圾": "Space Junk",
    "卫星碰撞预警": "Satellite Collision Warning",
    "太空飞行安全": "Space Flight Safety",
    "太空军": "Space Force"
  };

  for (const keyword of keywords) {
    // Fetch Chinese news
    const zhNews = await fetchNews(keyword, 'zh');
    allNews = [...allNews, ...zhNews];

    // Fetch English news using translated keyword if available
    const enKeyword = keywordMap[keyword] || keyword;
    const enNews = await fetchNews(enKeyword, 'en');
    allNews = [...allNews, ...enNews];
  }

  // Deduplicate by title
  const uniqueNews = Array.from(new Map(allNews.map(item => [item.title, item])).values());
  
  // Sort by timestamp descending (newest first)
  uniqueNews.sort((a, b) => {
    const tA = a.timestamp || 0;
    const tB = b.timestamp || 0;
    return tB - tA;
  });

  // Limit to top 30 items to keep prompt size optimized and prevent LLM timeouts
  const topNews = uniqueNews.slice(0, 30);
  console.log(`Web Run Task: Fetched ${uniqueNews.length} unique news items (CN + EN). Sending top ${topNews.length} to AI.`);
  
  const aiContent = await generateContent(topNews, context, focusMedia, keywords);
  const result = await sendToDingTalk(aiContent);
  
  res.json({ 
    success: result.success && !aiContent.startsWith("AI 内容生成失败"), 
    newsCount: uniqueNews.length, 
    message: result.message || (aiContent.startsWith("AI 内容生成失败") ? aiContent : "推送成功") 
  });
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
