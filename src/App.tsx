import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Newspaper, 
  Send, 
  Settings, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  Calendar,
  Sparkles
} from "lucide-react";

export default function App() {
  const [config, setConfig] = useState<{ hasWebhook: boolean; keywords: string }>({
    hasWebhook: false,
    keywords: ""
  });
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error("Failed to fetch config", err);
    }
  };

  const runTask = async () => {
    setStatus("running");
    setMessage("正在抓取新闻并生成 AI 简报...");
    try {
      const res = await fetch("/api/run-task", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setStatus("success");
        setMessage(`成功推送！共处理了 ${data.newsCount} 条新闻。`);
        setLastRun(new Date().toLocaleTimeString());
      } else {
        setStatus("error");
        setMessage("推送失败，请检查 Webhook 配置。");
      }
    } catch (err) {
      setStatus("error");
      setMessage("运行出错，请稍后重试。");
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a] font-sans selection:bg-[#5A5A40] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#1a1a1a]/10 bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1a1a1a] rounded-xl flex items-center justify-center text-white">
              <Newspaper size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">News2Ding</h1>
              <p className="text-xs text-[#1a1a1a]/50 font-medium uppercase tracking-widest">Daily News Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={fetchConfig}
              className="p-2 hover:bg-[#1a1a1a]/5 rounded-full transition-colors"
              title="刷新配置"
            >
              <RefreshCw size={20} className={status === "running" ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main Action Card */}
          <div className="md:col-span-2 space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-[32px] p-8 shadow-sm border border-[#1a1a1a]/5 relative overflow-hidden"
            >
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={18} className="text-[#5A5A40]" />
                  <span className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]">AI Powered Automation</span>
                </div>
                <h2 className="text-3xl font-serif font-medium mb-4">开启今日新闻简报</h2>
                <p className="text-[#1a1a1a]/60 mb-8 leading-relaxed">
                  点击下方按钮，系统将自动抓取过去 24 小时内关于 <span className="font-bold text-[#1a1a1a]">“{config.keywords || "加载中..."}”</span> 的最新动态，并通过 AI 生成深度总结与创作建议，最后推送到您的钉钉群。
                </p>

                <button
                  onClick={runTask}
                  disabled={status === "running" || !config.hasWebhook}
                  className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 text-lg font-medium transition-all transform active:scale-[0.98] ${
                    status === "running" 
                      ? "bg-[#1a1a1a]/10 text-[#1a1a1a]/40 cursor-not-allowed" 
                      : !config.hasWebhook
                      ? "bg-red-50 text-red-600 border border-red-100 cursor-not-allowed"
                      : "bg-[#1a1a1a] text-white hover:bg-[#1a1a1a]/90 shadow-lg shadow-[#1a1a1a]/10"
                  }`}
                >
                  {status === "running" ? (
                    <>
                      <RefreshCw size={20} className="animate-spin" />
                      正在处理中...
                    </>
                  ) : (
                    <>
                      <Send size={20} />
                      立即执行推送任务
                    </>
                  )}
                </button>

                {!config.hasWebhook && (
                  <p className="mt-4 text-sm text-red-500 flex items-center gap-1.5 justify-center">
                    <AlertCircle size={14} />
                    未检测到 DINGTALK_WEBHOOK 环境变量，请先配置。
                  </p>
                )}
              </div>

              {/* Decorative Background Element */}
              <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-[#f5f5f0] rounded-full blur-3xl opacity-50" />
            </motion.div>

            {/* Status Feedback */}
            <AnimatePresence mode="wait">
              {status !== "idle" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`rounded-2xl p-4 flex items-start gap-3 ${
                    status === "success" ? "bg-green-50 text-green-700 border border-green-100" :
                    status === "error" ? "bg-red-50 text-red-700 border border-red-100" :
                    "bg-blue-50 text-blue-700 border border-blue-100"
                  }`}
                >
                  {status === "success" ? <CheckCircle2 size={20} className="shrink-0 mt-0.5" /> :
                   status === "error" ? <AlertCircle size={20} className="shrink-0 mt-0.5" /> :
                   <RefreshCw size={20} className="shrink-0 mt-0.5 animate-spin" />}
                  <div>
                    <p className="font-medium">{message}</p>
                    {lastRun && status === "success" && (
                      <p className="text-xs mt-1 opacity-70">上次成功运行: {lastRun}</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar / Info */}
          <div className="space-y-6">
            <div className="bg-white rounded-[24px] p-6 shadow-sm border border-[#1a1a1a]/5">
              <div className="flex items-center gap-2 mb-4">
                <Settings size={18} className="text-[#1a1a1a]/40" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-[#1a1a1a]/40">当前配置</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-[#1a1a1a]/50 block mb-1">关注关键字</label>
                  <div className="flex flex-wrap gap-2">
                    {(config.keywords || "无").split(",").map((k, i) => (
                      <span key={i} className="px-2.5 py-1 bg-[#f5f5f0] rounded-lg text-sm font-medium">
                        {k.trim()}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1a1a1a]/50 block mb-1">推送通道</label>
                  <div className="flex items-center gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full ${config.hasWebhook ? "bg-green-500" : "bg-red-500"}`} />
                    {config.hasWebhook ? "钉钉机器人 (已就绪)" : "未配置 Webhook"}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#5A5A40] rounded-[24px] p-6 text-white shadow-lg shadow-[#5A5A40]/20">
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={18} className="opacity-60" />
                <h3 className="text-sm font-bold uppercase tracking-widest opacity-60">自动化建议</h3>
              </div>
              <p className="text-sm leading-relaxed opacity-90 mb-4">
                本工具已集成 GitHub Actions 配置。您可以在仓库的 <code className="bg-white/10 px-1 rounded">.github/workflows</code> 目录下找到定时任务配置。
              </p>
              <a 
                href="https://github.com/features/actions" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs font-bold flex items-center gap-1 hover:underline"
              >
                了解更多 <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-[#1a1a1a]/5 text-center">
        <p className="text-sm text-[#1a1a1a]/40">
          News2Ding &copy; 2024 • 自动化新闻与自媒体助手
        </p>
      </footer>
    </div>
  );
}
