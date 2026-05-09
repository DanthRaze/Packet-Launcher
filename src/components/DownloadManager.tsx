import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { Download, X, Minimize2 } from "lucide-react";

interface DownloadTask { id: string; name: string; downloaded: number; total: number; }

export default function DownloadManager() {
  const [tasks, setTasks] = useState<Record<string, DownloadTask>>({});
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let un: (() => void) | undefined;
    async function setup() {
      un = await listen<{ id: string; name: string; downloaded: number; total: number }>(
        "download_progress", ev => {
          setTasks(prev => {
            const t: DownloadTask = {
              id: ev.payload.id,
              name: ev.payload.name || prev[ev.payload.id]?.name || "Downloading...",
              downloaded: ev.payload.downloaded,
              total: ev.payload.total,
            };
            if (t.downloaded >= t.total && t.total > 0) {
              setTimeout(() => setTasks(c => { const n={...c}; delete n[ev.payload.id]; return n; }), 2500);
            }
            return { ...prev, [ev.payload.id]: t };
          });
          setVisible(true);
        }
      );
    }
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) setup();
    return () => { un?.(); };
  }, []);

  const active = Object.values(tasks);
  if (active.length === 0) return null;

  const fmt = (b: number) => b < 1048576 ? `${(b/1024).toFixed(0)} KB` : `${(b/1048576).toFixed(1)} MB`;

  // Minimised pill — sits next to status badge
  if (!visible) {
    return (
      <motion.button
        initial={{ scale: 0 }} animate={{ scale: 1 }}
        onClick={() => setVisible(true)}
        className="absolute bottom-6 z-50 flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer"
        style={{ right: "12rem", background: "var(--bg-card)", border: "1px solid var(--border-medium)", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}
        whileHover={{ borderColor: "var(--accent)" }}
      >
        <div className="relative">
          <Download size={13} style={{ color: "var(--accent)" }} />
          <span className="absolute -top-2 -right-2 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center bg-white text-black">{active.length}</span>
        </div>
        <span className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: "var(--text-secondary)" }}>Downloading</span>
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="absolute bottom-20 right-6 z-50 w-80 overflow-hidden"
      style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)", borderRadius: "8px", boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b divider" style={{ background: "var(--bg-card)" }}>
        <div className="flex items-center gap-2">
          <Download size={13} style={{ color: "var(--accent)" }} />
          <span className="text-xs font-bold tracking-widest uppercase text-white">Downloads</span>
          <span className="tag">{active.length}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setVisible(false)} style={{ color: "var(--text-muted)" }} className="hover:text-white transition-colors"><Minimize2 size={13} /></button>
          <button onClick={() => { setTasks({}); setVisible(false); }} className="hover:text-red-400 transition-colors" style={{ color: "var(--text-muted)" }}><X size={13} /></button>
        </div>
      </div>
      <div className="p-4 max-h-56 overflow-y-auto space-y-4" style={{ background: "var(--bg-primary)" }}>
        <AnimatePresence>
          {active.map(t => {
            const pct = t.total > 0 ? (t.downloaded / t.total) * 100 : 0;
            const done = pct >= 100;
            return (
              <motion.div key={t.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-sm font-semibold text-white truncate pr-4 max-w-[200px]">{t.name}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: done ? "#22c55e" : "var(--accent)" }}>{done ? "Done ✓" : `${pct.toFixed(0)}%`}</span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "var(--border-medium)" }}>
                  <motion.div className="h-full rounded-full progress-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  <span>{fmt(t.downloaded)}</span><span>{t.total > 0 ? fmt(t.total) : "—"}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
