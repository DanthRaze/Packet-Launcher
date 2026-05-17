import { useState, useEffect, useRef } from "react";
import { ReactSkinview3d } from "react-skinview3d";
import { Play, ChevronRight, X, Gamepad, Folder } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";

interface NewsItem { id: string; title: string; shortDescription: string; longDescription?: string; image: string; }
interface Profile { username: string; skin_url: string; uuid: string; }
interface QuickPlayItem {
  name: string;
  type: "singleplayer" | "multiplayer";
  ip?: string;
  worldName?: string;
  icon: string;
}

export default function Home() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [packetUser, setPacketUser] = useState<any | null>(null);
  const [pinnedInstance, setPinnedInstance] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realWorlds, setRealWorlds] = useState<string[]>([]);
  const realWorldsRef = useRef<string[]>([]);
  const [quickPlayItems, setQuickPlayItems] = useState<QuickPlayItem[]>([]);
  const [quickPlayConfirm, setQuickPlayConfirm] = useState<QuickPlayItem | null>(null);

  const loadQuickPlayItems = (worldsList: string[]) => {
    const saved = localStorage.getItem("packet_quickplay");
    let items: QuickPlayItem[] = [];
    if (saved) {
      try { items = JSON.parse(saved); } catch {}
    }
    
    let servers = items.filter(i => i.type === "multiplayer");
    
    let worlds: QuickPlayItem[] = [];
    if (worldsList && worldsList.length > 0) {
      worlds = worldsList.map(w => {
        const existing = items.find(ex => ex.type === "singleplayer" && ex.worldName === w);
        return existing || {
          name: w,
          type: "singleplayer",
          worldName: w,
          icon: "https://img.icons8.com/color/96/minecraft-dirt-block.png"
        };
      });
      
      worlds.sort((a, b) => {
        const idxA = items.findIndex(ex => ex.type === "singleplayer" && ex.worldName === a.worldName);
        const idxB = items.findIndex(ex => ex.type === "singleplayer" && ex.worldName === b.worldName);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
    }
    
    const finalItems = [
      ...worlds.slice(0, 2),
      ...servers.slice(0, 1)
    ];
    setQuickPlayItems(finalItems);
  };

  const loadProfileAndPinned = async () => {
    const savedUser = localStorage.getItem("packet_user");
    if (savedUser) {
      try { setPacketUser(JSON.parse(savedUser)); } catch {}
    } else {
      setPacketUser(null);
    }

    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      try {
        const p = await invoke<Profile | null>("refresh_saved_profile");
        if (p) setProfile(p);
        const insts = await invoke<any[]>("list_instances");
        const pinned = insts.find(i => i.pinned);
        let activeInst = null;
        if (pinned) {
          setPinnedInstance(pinned.name);
          activeInst = pinned.name;
        } else if (insts.length > 0) {
          setPinnedInstance(insts[0].name);
          activeInst = insts[0].name;
        }

        if (activeInst) {
          try {
            const wList = await invoke<string[]>("list_singleplayer_worlds", { instanceName: activeInst });
            setRealWorlds(wList);
            realWorldsRef.current = wList;
            loadQuickPlayItems(wList);
          } catch {
            loadQuickPlayItems([]);
          }
        } else {
          loadQuickPlayItems([]);
        }
      } catch {
        loadQuickPlayItems([]);
      }
    } else {
      loadQuickPlayItems([]);
    }
  };

  useEffect(() => {
    loadProfileAndPinned();
    // News
    const URL = "https://script.google.com/macros/s/AKfycby6dOIwEwKnwRYx_IwRe7s3jiMRzMDV84-Ot_0b45qBHG6KDvUzROhreQDvc9VZMizJ/exec";
    fetch(`${URL}?action=news`)
      .then(r => r.json())
      .then(d => { setNews(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));

    // Listen for global launch status
    const handleLaunchStatus = (e: any) => {
      if (e.detail?.status) {
        const status = e.detail.status;
        setIsLaunching(status === "Launching" || status === "Loading");
        setIsRunning(status === "Running");
        // Handle Stopped status to reset states
        if (status === "Stopped") {
          setIsLaunching(false);
          setIsRunning(false);
        }
      }
    };
    window.addEventListener("tauri://launch_status", handleLaunchStatus);

    // Check initial state
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("is_game_running").then((running: unknown) => {
          const isRunning = running as boolean;
          setIsRunning(isRunning);
          setIsLaunching(false);
        }).catch(() => {});
      });
    }

    const handleProfileUpdate = (e: any) => {
      if (e.detail) setProfile(e.detail);
      else loadProfileAndPinned();
    };
    window.addEventListener("profile-updated" as any, handleProfileUpdate);

    const handleUserUpdate = (e: any) => {
      if (e.detail) {
        setPacketUser(e.detail);
      } else {
        setPacketUser(null);
      }
    };
    window.addEventListener("user-updated" as any, handleUserUpdate);

    const handleQuickplayUpdate = () => {
      loadQuickPlayItems(realWorldsRef.current);
    };
    window.addEventListener("quickplay-updated" as any, handleQuickplayUpdate);

    const intervalId = setInterval(() => {
      loadProfileAndPinned();
    }, 600000); // 10 minutes

    return () => {
      window.removeEventListener("tauri://launch_status", handleLaunchStatus);
      window.removeEventListener("profile-updated" as any, handleProfileUpdate);
      window.removeEventListener("user-updated" as any, handleUserUpdate);
      window.removeEventListener("quickplay-updated" as any, handleQuickplayUpdate);
      clearInterval(intervalId);
    };
  }, []);

  const handleLaunch = async () => {
    if (!pinnedInstance) {
      setError("No instances found. Create one in Instances first.");
      return;
    }
    
    if (isRunningState) {
      try {
        await invoke("stop_game");
      } catch (e: any) {
        setError(String(e));
      }
      return;
    }
    
    setError(null);
    try {
      const ramStr = localStorage.getItem('allocated_ram') || '4';
      const ram = parseInt(ramStr, 10) || 4;
      const developerMode = localStorage.getItem('developer_mode') === 'true';
      await invoke("launch_instance", { 
        instanceName: pinnedInstance, 
        allocatedRamGb: ram, 
        developerMode,
        serverIp: null,
        quickplaySingleplayer: null
      });
    } catch (e: any) {
      setError(String(e));
    }
  };

  const isLaunchingState = isLaunching;
  const isRunningState = isRunning;

  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);

  // Skin URL: use Crafatar with UUID if logged in, else Steve
  const [skinUrl, setSkinUrl] = useState("https://mineskin.eu/skin/steve");

  useEffect(() => {
    if (profile?.username) {
      setSkinUrl(`https://mineskin.eu/skin/${profile.username}?t=${Date.now()}`);
    } else if (packetUser?.Username) {
      setSkinUrl(`https://mineskin.eu/skin/${packetUser.Username}?t=${Date.now()}`);
    } else if (packetUser?.skinUrl) {
      setSkinUrl(`${packetUser.skinUrl}${packetUser.skinUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
    } else if (packetUser?.PFP) {
      setSkinUrl(`${packetUser.PFP}${packetUser.PFP.includes('?') ? '&' : '?'}t=${Date.now()}`);
    } else {
      setSkinUrl("https://mineskin.eu/skin/steve");
    }
  }, [profile, packetUser]);

  const handleQuickPlayLaunch = async (item: QuickPlayItem) => {
    if (!pinnedInstance) {
      setError("No instances found. Create one in Instances first.");
      return;
    }
    
    if (isRunningState) {
      try {
        await invoke("stop_game");
      } catch (e: any) {
        setError(String(e));
      }
      return;
    }

    setError(null);
    setIsLaunching(true);
    setQuickPlayConfirm(null);
    try {
      const ramStr = localStorage.getItem('allocated_ram') || '4';
      const ram = parseInt(ramStr, 10) || 4;
      const developerMode = localStorage.getItem('developer_mode') === 'true';
      
      const saved = localStorage.getItem("packet_quickplay");
      let history: QuickPlayItem[] = [];
      try { if (saved) history = JSON.parse(saved); } catch {}
      history = history.filter(h => !(h.type === item.type && (h.worldName === item.worldName || h.ip === item.ip)));
      history.unshift(item);
      localStorage.setItem("packet_quickplay", JSON.stringify(history));
      loadQuickPlayItems(realWorlds);

      await invoke("launch_instance", { 
        instanceName: pinnedInstance, 
        allocatedRamGb: ram, 
        developerMode,
        serverIp: item.type === "multiplayer" ? item.ip : null,
        quickplaySingleplayer: item.type === "singleplayer" ? item.worldName : null
      });
    } catch (e: any) {
      setError(String(e));
    } finally {
      setIsLaunching(false);
    }
  };

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
          <h1 className="text-3xl font-bold text-white">{profile?.username || packetUser?.Username || "Explorer"}</h1>
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
          onClick={handleLaunch} disabled={isLaunchingState || isRunningState}
          whileHover={!(isLaunchingState || isRunningState) ? { scale: 1.03 } : undefined} whileTap={!(isLaunchingState || isRunningState) ? { scale: 0.97 } : undefined}
          className={`group relative flex items-center gap-4 px-14 py-4 overflow-hidden rounded-sm transition-all ${
            isLaunchingState
              ? "bg-yellow-600 cursor-not-allowed text-white"
              : isRunningState
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "btn-accent"
          }`}
          style={!(isLaunchingState || isRunningState) ? { boxShadow: "0 4px 30px var(--accent-glow)" } : undefined}>
          {!(isLaunchingState || isRunningState) && (
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
          )}
          {isLaunchingState ? (
            <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : isRunningState ? (
            <X size={20} className="text-white" />
          ) : (
            <Play size={20} className="text-white" fill="white" />
          )}
          <span className="font-bold text-xl tracking-[0.25em] uppercase">
            {isLaunchingState ? "Starting" : isRunningState ? "Stop" : "Launch"}
          </span>
        </motion.button>

        {/* Quick Play Panel */}
        {quickPlayItems.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="mt-2 w-full max-w-lg px-5 py-3.5 rounded-sm border divider bg-white/[0.01] backdrop-blur-md">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[10px] font-bold tracking-[0.25em] uppercase text-muted flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Quick Play
              </h3>
              <span className="text-[9px] font-semibold text-white/30 uppercase tracking-widest">Recent Activity</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {quickPlayItems.map((item, idx) => (
                <motion.div
                  key={idx}
                  whileHover={{ scale: 1.03, borderColor: "var(--accent)" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setQuickPlayConfirm(item)}
                  className="group cursor-pointer p-3 rounded-sm border divider bg-panel/30 hover:bg-accent/5 transition-all flex flex-col justify-between min-h-[90px] relative overflow-hidden"
                >
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play size={10} className="text-accent" fill="var(--accent)" />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <img src={item.icon} alt="" className="w-6 h-6 object-contain shrink-0 filter brightness-110 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate leading-snug group-hover:text-accent transition-colors">{item.name}</p>
                      <p className="text-[9px] text-muted truncate mt-0.5 uppercase tracking-wider font-semibold">
                        {item.type === "multiplayer" ? "Server" : "World"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-white/40 font-semibold truncate leading-none">
                    {item.type === "multiplayer" ? item.ip : "Local File"}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
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

      {/* Quick Play Confirm Modal */}
      <AnimatePresence>
        {quickPlayConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setQuickPlayConfirm(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm p-6 rounded-sm relative text-center"
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)" }}
              onClick={e => e.stopPropagation()}>
              
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent/10 border border-accent/25 flex items-center justify-center">
                {quickPlayConfirm.type === "multiplayer" ? (
                  <Gamepad size={28} className="text-accent" />
                ) : (
                  <Folder size={28} className="text-accent" />
                )}
              </div>

              <h2 className="text-xl font-bold text-white mb-2">
                {quickPlayConfirm.type === "multiplayer" ? "Quick Connect Server" : "Quick Launch World"}
              </h2>
              
              <p className="text-xs text-muted mb-6 px-4 leading-relaxed">
                Really Want to Play <strong className="text-white">{quickPlayConfirm.name}</strong>? 
                This will automatically load your pinned instance <strong className="text-accent">{pinnedInstance || "None"}</strong> and jump directly in!
              </p>

              <div className="flex gap-3">
                <button onClick={() => setQuickPlayConfirm(null)} className="btn-ghost flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-sm">
                  Cancel
                </button>
                <button onClick={() => handleQuickPlayLaunch(quickPlayConfirm)} className="btn-accent flex-1 py-3 text-xs font-bold uppercase tracking-wider rounded-sm flex items-center justify-center gap-2">
                  <Play size={12} fill="white" /> Let's Play!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

