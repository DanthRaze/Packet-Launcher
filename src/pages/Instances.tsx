import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { Star, Play, X, Plus, Package, Folder, Trash2, Pin, Cpu, Settings } from "lucide-react";


interface InstanceMeta { name: string; instance_type: string; version: string; last_played: string; favourite: boolean; pinned?: boolean; }
interface MCVersion { id: string; type: string; }

const TYPE_COLORS: Record<string, string> = { Vanilla: "#22c55e", Fabric: "#93c5fd" };

export default function Instances() {
  const [instances, setInstances] = useState<InstanceMeta[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("Vanilla");
  const [newVersion, setNewVersion] = useState("");
  const [versions, setVersions] = useState<MCVersion[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<string | null>(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchingInstance, setLaunchingInstance] = useState<string | null>(null);
  const [runningInstance, setRunningInstance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; instance: InstanceMeta | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showLaunchPopup, setShowLaunchPopup] = useState(false);

  const load = async () => {
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      try { setInstances(await invoke<InstanceMeta[]>("list_instances")); } catch {}
    }
  };

  useEffect(() => { 
    load();
    window.addEventListener("instances-updated", load);
    
    // Listen for launch status updates
    const handleLaunchStatus = (e: any) => {
      console.log("Instances page received launch_status:", e.detail);
      if (e.detail && e.detail.status) {
        const status = e.detail.status;
        const isRunning = status === "Running";
        setIsGameRunning(isRunning);
        setIsLaunching(status === "Launching" || status === "Loading" ? true : false);
        setLaunchingInstance(status === "Launching" || status === "Loading" ? e.detail.instance_name : null);
        setRunningInstance(isRunning ? e.detail.instance_name : null);
        // Handle Stopped status to reset states
        if (status === "Stopped") {
          setIsGameRunning(false);
          setIsLaunching(false);
          setLaunchingInstance(null);
          setRunningInstance(null);
        }
      }
    };
    window.addEventListener("tauri://launch_status", handleLaunchStatus);
    
    // Check if game is already running - delayed to ensure Tauri is ready
    const checkInitial = async () => {
      try {
        const running = await invoke("is_game_running");
        setIsGameRunning(running as boolean);
      } catch (e) {
        console.log("is_game_running not available yet");
      }
    };
    const timer = setTimeout(checkInitial, 500);
    
    return () => {
      window.removeEventListener("instances-updated", load);
      window.removeEventListener("tauri://launch_status", handleLaunchStatus);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  const loadVersions = async () => {
    setVersionsLoading(true);
    try {
      const res = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const data = await res.json();
      const allVersions: MCVersion[] = data.versions || [];
      setVersions(allVersions);
      // Default to latest release
      const first = allVersions.find(v => v.type === "release");
      if (first) setNewVersion(first.id);
      else if (allVersions.length > 0) setNewVersion(allVersions[0].id);
    } catch {
      // Fallback versions if offline
      const fallback: MCVersion[] = [
        { id: "1.21.4", type: "release" },
        { id: "1.21.1", type: "release" },
        { id: "1.20.4", type: "release" },
      ];
      setVersions(fallback);
      setNewVersion(fallback[0].id);
    }
    setVersionsLoading(false);
  };

  const openDialog = () => {
    setNewName("");
    setNewType("Vanilla");
    setNewVersion("");
    setError(null);
    setShowDialog(true);
    loadVersions();
  };

  const filteredVersions = versions.filter(v => showSnapshots ? true : v.type === "release");

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { setError("Please enter an instance name."); return; }
    if (!newVersion) { setError("Please wait for versions to load."); return; }

    setCreating(true);
    setError(null);
    setCreateProgress("Creating folder structure...");

    try {
      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        await invoke("create_instance", { name, instanceType: newType, version: newVersion });
      } else {
        // Browser dev fallback - simulate
        await new Promise(r => setTimeout(r, 500));
      }
      setCreateProgress("Instance created successfully!");
      await new Promise(r => setTimeout(r, 600));
      setShowDialog(false);
      setNewName("");
      setCreateProgress(null);
      load();
      window.dispatchEvent(new Event("instances-updated"));
    } catch (e: any) {
      setError(String(e));
      setCreateProgress(null);
    }
    setCreating(false);
  };

  const handleFavourite = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      await invoke("toggle_favourite", { name });
      load();
      window.dispatchEvent(new Event("instances-updated"));
    }
  };

  const handleLaunch = async (name: string) => {
    // If this specific instance is running, stop it
    if (runningInstance === name) {
      await handleStop();
      return;
    }
    
    // Prevent launching if ANY game is already running
    if (isGameRunning) {
      setError("Another instance is already running. Stop it first.");
      return;
    }
    
    // Show launch popup immediately
    setShowLaunchPopup(true);
    setTimeout(() => setShowLaunchPopup(false), 2000); // Hide after 2 seconds
    
    setError(null);
    try {
      const ramStr = localStorage.getItem('allocated_ram') || '4';
      const ram = parseInt(ramStr, 10) || 4;
      const developerMode = localStorage.getItem('developer_mode') === 'true';

      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        await invoke("launch_instance", { instanceName: name, allocatedRamGb: ram, developerMode });
      } else {
        setError("Launch requires the desktop app (npm run tauri dev)");
      }
    } catch (e: any) {
      setError(String(e));
    }
    // Don't clear launching here - the event listener will update it when status changes
  };

  const handleStop = async () => {
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      try {
        await invoke("stop_game");
      } catch (e: any) {
        setError(String(e));
      }
    }
  };

  
  const handleContextMenuStop = async (instance: InstanceMeta) => {
    if (instance.name === runningInstance) {
      await handleStop();
    }
    setContextMenu({ x: 0, y: 0, instance: null });
  };

  const handleOpenFolder = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await invoke("open_instance_folder", { name });
  };

  const handleDelete = async (name: string) => {
    try {
      await invoke("delete_instance", { name });
      load();
      window.dispatchEvent(new Event("instances-updated"));
      setConfirmDelete(null);
    } catch (e) { setError(String(e)); }
  };

  const handlePin = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      await invoke("set_pinned_instance", { name });
      load();
      window.dispatchEvent(new Event("instances-updated"));
    }
  };

  const handleContextMenu = (e: React.MouseEvent, instance: InstanceMeta) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, instance });
  };

  return (
    <motion.div className="flex flex-col h-screen p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {error && (
        <div className="mb-4 p-3 text-sm rounded-sm relative z-10 flex items-start justify-between gap-3"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0"><X size={14} /></button>
        </div>
      )}

      {/* Header with Create Instance button */}
      {instances.length > 0 && (
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white">Instances</h1>
          <button onClick={openDialog} className="btn-accent px-4 py-2 rounded-sm flex items-center gap-2">
            <Plus size={14} /> Create Instance
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-8 relative z-10">
        {instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-16">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-medium)" }}>
              <Package size={28} style={{ color: "var(--text-muted)" }} />
            </div>
            <p className="font-semibold text-sm" style={{ color: "var(--text-secondary)" }}>No instances yet</p>
            <p className="text-xs text-center max-w-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Create your first instance to start playing, or install a modpack from Discover.
            </p>
            <button onClick={openDialog} className="btn-accent px-6 py-2.5 rounded-sm flex items-center gap-2 mt-2">
              <Plus size={14} /> Create Instance
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {instances.map((inst, i) => (
              <motion.div key={inst.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                onContextMenu={(e) => handleContextMenu(e, inst)}
                onClick={() => window.dispatchEvent(new CustomEvent("open-instance-details", { detail: { name: inst.name } }))}
                transition={{ delay: i * 0.04 }} className="card panel-hover p-5 flex flex-col group cursor-pointer">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-sm flex items-center justify-center overflow-hidden"
                    style={{ background: "var(--bg-primary)" }}>
                    <img src="https://i.imghippo.com/files/hfRa5982h.png" alt="" className="w-8 h-8 object-contain" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); handleOpenFolder(inst.name); }} className="p-1.5 rounded-sm hover:bg-white/10 text-muted hover:text-white transition-colors" title="Open Folder">
                      <Folder size={14} />
                    </button>
                    <button onClick={e => handleFavourite(inst.name, e)} className="transition-all hover:scale-110" title="Favourite">
                      <Star size={16} style={{ color: inst.favourite ? "var(--accent)" : "var(--text-muted)", fill: inst.favourite ? "var(--accent)" : "none" }} />
                    </button>
                    {inst.pinned && <Pin size={14} className="text-accent" fill="var(--accent)" />}
                    <span className="tag text-[9px]" style={{ color: TYPE_COLORS[inst.instance_type] || "var(--accent)", borderColor: "transparent", background: `${TYPE_COLORS[inst.instance_type] || "var(--accent)"}18` }}>
                      {inst.instance_type}
                    </span>
                  </div>
                </div>
                <h3 className="font-semibold text-sm text-white mb-1 truncate group-hover:text-accent transition-colors">{inst.name}</h3>
                <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>{inst.version}</p>
                <div className="mt-auto pt-4 border-t divider flex items-center justify-between">
                  <div className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <Cpu size={11} />
                    <span className="text-[10px] font-medium uppercase tracking-wider">{inst.last_played}</span>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleLaunch(inst.name); }} disabled={isGameRunning || isLaunching}
                    className={`${(isGameRunning || isLaunching) ? "bg-gray-600 cursor-not-allowed" : runningInstance === inst.name ? "bg-red-500 hover:bg-red-600" : "btn-accent"} flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] transition-colors text-white`}>
                    {isLaunching && launchingInstance === inst.name ? (
                      <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    ) : runningInstance === inst.name ? (
                      <X size={10} />
                    ) : isGameRunning ? (
                      <div className="w-3 h-3 rounded-full border border-gray-400" />
                    ) : (
                      <Play size={10} fill="white" />
                    )}
                    {isLaunching && launchingInstance === inst.name ? "Starting" : runningInstance === inst.name ? "Stop" : isGameRunning ? "Busy" : "Play"}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[100] w-44 py-1.5 rounded-sm shadow-2xl border divider"
            style={{ top: contextMenu.y, left: contextMenu.x, background: "var(--bg-panel)" }}>
            <button onClick={() => { 
              window.dispatchEvent(new CustomEvent("open-instance-details", { detail: { name: contextMenu.instance?.name || "" } }));
              setContextMenu(null); 
            }}
              className="w-full px-4 py-2 text-left text-xs font-semibold hover:bg-white/5 flex items-center gap-3 transition-colors">
              <Settings size={14} className="text-accent" /> View Details
            </button>
            <button onClick={() => { if (contextMenu.instance) { handlePin(contextMenu.instance.name); } setContextMenu(null); }}
              className="w-full px-4 py-2 text-left text-xs font-semibold hover:bg-white/5 flex items-center gap-3 transition-colors">
              <Pin size={14} className="text-accent" /> {contextMenu.instance?.pinned ? "Unpin" : "Pin"} Instance
            </button>
            <button onClick={(e) => { if (contextMenu.instance) { handleFavourite(contextMenu.instance.name, e); } setContextMenu(null); }}
              className="w-full px-4 py-2 text-left text-xs font-semibold hover:bg-white/5 flex items-center gap-3 transition-colors">
              <Star size={14} style={{ color: contextMenu.instance?.favourite ? "var(--accent)" : "var(--text-muted)", fill: contextMenu.instance?.favourite ? "var(--accent)" : "none" }} />
              {contextMenu.instance?.favourite ? "Remove from Favourites" : "Add to Favourites"}
            </button>
            {runningInstance === contextMenu.instance?.name && (
              <button onClick={() => { if (contextMenu.instance) { handleContextMenuStop(contextMenu.instance); } }}
                className="w-full px-4 py-2 text-left text-xs font-semibold hover:bg-white/5 flex items-center gap-3 transition-colors text-red-400">
                <X size={14} /> Stop Instance
              </button>
            )}
            <button onClick={() => { if (contextMenu.instance) { setConfirmDelete(contextMenu.instance.name); } setContextMenu(null); }}
              className="w-full px-4 py-2 text-left text-xs font-semibold hover:bg-red-500/10 flex items-center gap-3 transition-colors text-red-400">
              <Trash2 size={14} /> Delete Instance
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm p-8 rounded-sm bg-panel border divider shadow-2xl relative" style={{ background: "var(--bg-panel)" }}>
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                  <Trash2 size={28} className="text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Delete Instance?</h3>
                <p className="text-sm text-secondary mb-8 leading-relaxed">
                  Are you sure you want to delete <span className="text-white font-bold">"{confirmDelete}"</span>? This will permanently remove all mods, worlds, and settings.
                </p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setConfirmDelete(null)} className="btn-ghost flex-1 py-3 rounded-sm">Cancel</button>
                  <button onClick={() => handleDelete(confirmDelete)} className="bg-red-600 hover:bg-red-700 text-white font-bold flex-1 py-3 rounded-sm transition-colors">Delete</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Launch Popup */}
      <AnimatePresence>
        {showLaunchPopup && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed top-8 left-1/2 transform -translate-x-1/2 z-[120] px-6 py-4 rounded-sm shadow-2xl border divider"
            style={{ background: "var(--bg-panel)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                <Play size={16} className="text-green-500" fill="white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Launching Instance</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Starting Minecraft...</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md p-7 relative"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)", borderRadius: "4px" }}>

            {!creating && (
              <button onClick={() => setShowDialog(false)} className="absolute top-4 right-4" style={{ color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            )}

            <p className="text-[10px] font-bold tracking-[0.25em] uppercase mb-1 text-accent">Create</p>
            <h2 className="text-xl font-bold text-white mb-6">New Instance</h2>

            {error && (
              <div className="mb-4 p-3 text-xs rounded-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                {error}
              </div>
            )}

            {/* Creating progress overlay */}
            {creating && createProgress && (
              <div className="mb-4 p-3 text-xs rounded-sm flex items-center gap-3"
                style={{ background: "var(--accent-dim)", border: "1px solid rgba(139,92,246,0.2)" }}>
                <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
                <span className="text-white">{createProgress}</span>
              </div>
            )}

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreate()}
                  disabled={creating}
                  className="field w-full px-4 py-3 text-sm rounded-sm disabled:opacity-50"
                  placeholder="My Survival World" autoFocus />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>Mod Loader</label>
                <div className="grid grid-cols-4 gap-2">
                  {["Vanilla", "Fabric"].map(t => (
                    <button key={t} onClick={() => setNewType(t)} disabled={creating}
                      className="py-2.5 text-xs font-bold uppercase tracking-widest rounded-sm transition-all"
                      style={{
                        background: newType === t ? "var(--accent-gradient)" : "var(--bg-card)",
                        color: newType === t ? "white" : "var(--text-secondary)",
                        border: `1px solid ${newType === t ? "transparent" : "var(--border-medium)"}`,
                      }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Version</label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium select-none" style={{ color: "var(--text-secondary)" }}>
                    <div onClick={() => setShowSnapshots(s => !s)}
                      className="relative rounded-full transition-colors"
                      style={{ width: "28px", height: "16px", background: showSnapshots ? "var(--accent)" : "var(--border-medium)", cursor: "pointer" }}>
                      <motion.span animate={{ x: showSnapshots ? 13 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow pointer-events-none"
                        style={{ left: 0 }} />
                    </div>
                    Snapshots
                  </label>
                </div>

                {versionsLoading ? (
                  <div className="field w-full px-4 py-3 text-sm rounded-sm flex items-center gap-3" style={{ color: "var(--text-muted)" }}>
                    <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
                    Fetching versions from Mojang...
                  </div>
                ) : (
                  <div className="relative">
                    <select value={newVersion} onChange={e => setNewVersion(e.target.value)} disabled={creating}
                      className="field w-full px-4 py-3 text-sm rounded-sm appearance-none cursor-pointer"
                      style={{ paddingRight: "2.5rem" }}>
                      {filteredVersions.map(v => (
                        <option key={v.id} value={v.id} style={{ background: "#141416" }}>
                          {v.id}{v.type !== "release" ? ` (${v.type})` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs" style={{ color: "var(--text-muted)" }}>▾</div>
                  </div>
                )}
              </div>
            </div>

            <button onClick={handleCreate} disabled={creating || versionsLoading || !newVersion}
              className="btn-accent w-full py-3.5 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {creating ? (
                <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Creating...</>
              ) : (
                <><Plus size={16} /> Create Instance</>
              )}
            </button>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
