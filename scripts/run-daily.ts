import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

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

// Version: 3.5.0 - Perfect Alignment (Bullet Style + Length Balance)
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

  // 3. Fallback to Yahoo News Search RSS to bypass Google News 503 limits
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

async function generateContent(newsList: any[]) {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const userContext = process.env.USER_CONTEXT || "作为投资机构从业者，我需要结合关键词为机构做出每日分析";
  const focusMedia = process.env.FOCUS_MEDIA || "SpaceNews, Sputnik News, Via Satellite, 卫星与网络, Space Daily";
  const keywordsStr = process.env.KEYWORDS || "太空态势感知, 太空碎片, 太空垃圾, 卫星碰撞预警, 太空飞行安全，太空军";
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

  console.log("Using Provider:", provider);
  console.log("--- DEBUG PROMPT START ---");
  console.log(prompt.substring(0, 500) + "...");
  console.log("--- DEBUG PROMPT END ---");

  try {
    if (provider === "doubao" && process.env.DOUBAO_API_KEY) {
      const openai = new OpenAI({
        apiKey: process.env.DOUBAO_API_KEY.trim(),
        baseURL: process.env.DOUBAO_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3",
        timeout: 120000 // Increase default timeout to 120 seconds to prevent API Connection timeouts
      });

      const response = await openai.chat.completions.create({
        model: (process.env.DOUBAO_MODEL || "").trim(),
        messages: [{ role: "user", content: prompt }],
      }, {
        timeout: 120000 // Explicitly set request timeout option to 120 seconds
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
  console.log("PRODUCTION VERSION: v3.5.0 (Aligned)");
  console.log("EXECUTION TIME:", new Date().toISOString());
  console.log("=========================================");
  
  const keywordsStr = process.env.KEYWORDS || "太空态势感知, 太空碎片, 太空垃圾, 卫星碰撞预警, 太空飞行安全, 太空军";
  const keywords = keywordsStr.split(",").map(k => k.trim()).filter(k => k);
  
  // Mapping of Chinese keywords to English for broader search
  const keywordMap: Record<string, string> = {
    "太空态势感知": "Space Situational Awareness",
    "太空碎片": "Space Debris",
    "太空垃圾": "Space Junk",
    "卫星碰撞预警": "Satellite Collision Warning",
    "太空飞行安全": "Space Flight Safety",
    "太空军": "Space Force"
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
  
  // Sort by timestamp descending (newest first) to prioritize freshest news
  uniqueNews.sort((a, b) => {
    const tA = a.timestamp || 0;
    const tB = b.timestamp || 0;
    return tB - tA;
  });
  
  // Limit to top 30 items to keep prompt size optimized and prevent LLM timeouts
  const topNews = uniqueNews.slice(0, 30);
  console.log(`Fetched ${uniqueNews.length} unique news items (CN + EN). Sending top ${topNews.length} sorted by date to AI.`);
  
  const aiContent = await generateContent(topNews);
  await sendToDingTalk(aiContent);
  
  // If the AI call failed, throw an error at the end so the GitHub Action is marked as failed,
  // while still ensuring the notification was sent to DingTalk first.
  if (aiContent.startsWith("AI 内容生成失败")) {
    throw new Error(aiContent);
  }
  
  console.log("Task completed successfully.");
}

run().catch(err => {
  console.error("Task failed:", err);
  process.exit(1);
});
