import { useState, useEffect } from "react";
import { ReactSkinview3d } from "react-skinview3d";
import { Play, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";

interface NewsItem { id: string; title: string; shortDescription: string; longDescription?: string; image: string; }
interface Profile { username: string; skin_url: string; uuid: string; }

export default function Home() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pinnedInstance, setPinnedInstance] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfileAndPinned = async () => {
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      try {
        const p = await invoke<Profile | null>("get_saved_profile");
        if (p) setProfile(p);
        const insts = await invoke<any[]>("list_instances");
        const pinned = insts.find(i => i.pinned);
        if (pinned) setPinnedInstance(pinned.name);
        else if (insts.length > 0) setPinnedInstance(insts[0].name);
      } catch {}
    }
  };

  useEffect(() => {
    loadProfileAndPinned();
    // News
    const URL = "https://script.google.com/macros/s/AKfycby6VK3P4suZuA58VJA4QfuUBYtBLBxp7QaPREDNuYkuehFdZCVPai9N_MOeq3NdSUsq/exec";
    fetch(`${URL}?action=news`)
      .then(r => r.json())
      .then(d => { setNews(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleLaunch = async () => {
    if (!pinnedInstance) {
      setError("No instances found. Create one in Instances first.");
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const ramStr = localStorage.getItem('allocated_ram') || '4';
      const ram = parseInt(ramStr, 10) || 4;
      await invoke("launch_instance", { instanceName: pinnedInstance, allocatedRamGb: ram });
    } catch (e: any) {
      setError(String(e));
    }
    setLaunching(false);
  };

  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);

  // Skin URL: use Crafatar with UUID if logged in, else Steve
  const skinUrl = profile?.skin_url || "https://mineskin.eu/skin/steve";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="relative w-full h-full flex overflow-hidden" style={{ background: "transparent" }}>

      {/* Background art */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <motion.div initial={{ scale: 1.08, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1.8, ease: "easeOut" }}
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url("https://www.minecraft.net/content/dam/games/minecraft/key-art/1.21-Update-Key-Art.jpg")', filter: "grayscale(30%) brightness(0.2)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(110deg, var(--bg-primary) 30%, rgba(10,10,10,0.85) 60%, transparent)" }} />
        <div className="absolute bottom-0 left-0 right-0 h-40" style={{ background: "linear-gradient(to top, var(--bg-primary), transparent)" }} />
      </div>

      {/* Left — Skin + launch */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-6">
        {error && (
          <div className="absolute top-10 px-4 py-2 rounded-sm bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center gap-3">
             {error}
             <button onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-center">
          <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: "var(--text-secondary)" }}>Welcome back</p>
          <h1 className="text-3xl font-bold text-white">{profile?.username || "Explorer"}</h1>
          {pinnedInstance && (
            <p className="text-[10px] font-bold text-accent uppercase tracking-widest mt-2">Ready to play: {pinnedInstance}</p>
          )}
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="relative">
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-28 h-5 rounded-full blur-xl" style={{ background: "var(--accent)", opacity: 0.35 }} />
          <ReactSkinview3d
            skinUrl={skinUrl}
            height="320"
            width="240"
            onReady={({ viewer }: any) => { viewer.autoRotate = true; viewer.autoRotateSpeed = 0.5; }}
          />
        </motion.div>

        <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          onClick={handleLaunch} disabled={launching}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          className="btn-accent group relative flex items-center gap-4 px-14 py-4 overflow-hidden rounded-sm"
          style={{ boxShadow: "0 4px 30px var(--accent-glow)" }}>
          <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
          {launching ? (
            <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Play size={20} className="text-white" fill="white" />
          )}
          <span className="text-white font-bold text-xl tracking-[0.25em] uppercase">
            {launching ? "Starting" : "Launch"}
          </span>
        </motion.button>
      </div>

      {/* Right — News */}
      <motion.aside initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 }}
        className="relative z-10 w-80 flex flex-col overflow-hidden"
        style={{ background: "rgba(17,17,19,0.9)", borderLeft: "1px solid var(--border-subtle)", backdropFilter: "blur(12px)" }}>
        <div className="px-6 py-5 border-b divider">
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase mb-0.5 text-accent">Latest</p>
          <h2 className="font-bold text-white text-lg">Intel Feed</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <AnimatePresence>
            {loading ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 rounded-sm animate-pulse" style={{ background: "var(--bg-card)" }} />
            )) : news.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
                onClick={() => setSelectedNews(item)}
                className="group cursor-pointer overflow-hidden rounded-sm"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                <div className="relative h-28 overflow-hidden">
                  <div className="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-500"
                    style={{ backgroundImage: `url(${item.image})`, filter: "brightness(0.7)" }} />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 60%)" }} />
                </div>
                <div className="px-4 py-3 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-white truncate group-hover:text-accent transition-colors">{item.title}</h3>
                    <p className="text-xs mt-0.5 line-clamp-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{item.shortDescription}</p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.aside>

      {/* News Modal */}
      <AnimatePresence>
        {selectedNews && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedNews(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-sm relative flex flex-col"
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)" }}
              onClick={e => e.stopPropagation()}>
              <button onClick={() => setSelectedNews(null)} className="absolute top-4 right-4 z-20 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                <X size={20} />
              </button>
              <div className="relative h-72 shrink-0">
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${selectedNews.image})` }} />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--bg-panel), transparent)" }} />
              </div>
              <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
                <p className="text-[10px] font-bold tracking-[0.3em] uppercase mb-1 text-accent">News Detail</p>
                <h2 className="text-3xl font-bold text-white mb-6 leading-tight">{selectedNews.title}</h2>
                <div className="prose prose-invert max-w-none">
                  <p className="text-lg font-medium leading-relaxed mb-6" style={{ color: "var(--text-primary)" }}>{selectedNews.shortDescription}</p>
                  <p className="text-base leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                    {selectedNews.longDescription || "No further details available for this news item."}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

