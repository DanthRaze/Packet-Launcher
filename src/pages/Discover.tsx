import { useState, useEffect } from "react";
import { Search, Download, Gamepad, X } from "lucide-react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";

const TABS = [
  { id: "modpack", label: "Modpacks" },
  { id: "mod", label: "Mods" },
  { id: "resourcepack", label: "Resource Packs" },
  { id: "shader", label: "Shaders" },
  { id: "datapack", label: "Data Packs" },
  { id: "servers", label: "Servers" }
];

// Modrinth project type names (what the API actually uses)
const MODRINTH_TYPE: Record<string, string> = {
  modpack: "modpack",
  mod: "mod",
  resourcepack: "resourcepack",
  shader: "shader",
  datapack: "datapack",
};

interface ModrinthProject {
  project_id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  downloads: number;
  project_type: string;
}
interface InstanceMeta { name: string; instance_type: string; version: string; }

export default function Discover() {
  const [activeTab, setActiveTab] = useState("modpack");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ModrinthProject | null>(null);
  const [instances, setInstances] = useState<InstanceMeta[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [availableVersions, setAvailableVersions] = useState<any[]>([]);
  const [_selectedVersion, setSelectedVersion] = useState<any>(null);
  const [mcVersion, setMcVersion] = useState("1.21.4");
  const [allMcVersions, setAllMcVersions] = useState<string[]>([]);
  const [showDoubleConfirm, setShowDoubleConfirm] = useState(false);
  const [pinnedInstance, setPinnedInstance] = useState<string | null>(null);

  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      try {
        if (activeTab === "servers") {
          const data = ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__)
            ? await invoke<any>("fetch_servers")
            : await (await fetch("https://script.google.com/macros/s/AKfycby6dOIwEwKnwRYx_IwRe7s3jiMRzMDV84-Ot_0b45qBHG6KDvUzROhreQDvc9VZMizJ/exec?action=servers")).json();
          setResults(data.map((s: any) => ({
            project_id: s.IP,
            title: s.Name,
            description: s.ShortDescription,
            icon_url: s.IconURL,
            author: s.IP,
            downloads: 0,
            project_type: "server"
          })));
        } else {
          const type = MODRINTH_TYPE[activeTab];
          if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
            const data = await invoke<any>("modrinth_search", { query, projectType: type, limit: 12 });
            setResults(data.hits || []);
          } else {
            const facets = (type === "mod" || type === "modpack")
              ? [[`project_type:${type}`], ["categories:fabric"]]
              : [[`project_type:${type}`]];
            const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=12`;
            const res = await fetch(url);
            const data = await res.json();
            setResults(data.hits || []);
          }
        }
      } catch { setResults([]); }
      setLoading(false);
    };
    const t = setTimeout(fetch_, 500);
    return () => clearTimeout(t);
  }, [activeTab, query]);

  useEffect(() => {
    fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
      .then(r => r.json())
      .then(d => setAllMcVersions(d.versions.filter((v: any) => v.type === "release").map((v: any) => v.id)))
      .catch(() => setAllMcVersions(["1.21.4", "1.21.1", "1.20.4", "1.19.2", "1.18.2"]));
  }, []);

  const openModal = async (p: ModrinthProject) => {
    setSelected(p);
    setInstallError(null);
    setAvailableVersions([]);
    setSelectedVersion(null);
    setShowDoubleConfirm(false);
    
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      try {
        const insts = await invoke<InstanceMeta[]>("list_instances");
        setInstances(insts);
        if (insts.length > 0) {
          setSelectedInstance(insts[0].name);
          const pinned = insts.find((i: any) => i.pinned) || insts[0];
          setPinnedInstance(pinned.name);
        } else {
          setSelectedInstance("");
          setPinnedInstance(null);
        }
      } catch { 
        setInstances([]); 
        setPinnedInstance(null);
      }
    }

    try {
      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        const vers = await invoke<any>("modrinth_project_versions", { projectId: p.project_id });
        setAvailableVersions(vers);
      } else {
        const vRes = await fetch(`https://api.modrinth.com/v2/project/${p.project_id}/version`);
        const vers = await vRes.json();
        setAvailableVersions(vers);
      }
    } catch {}
  };

  const handlePlayServer = async () => {
    if (!pinnedInstance) {
      setInstallError("No pinned instance found. Please pin or create an instance first.");
      return;
    }
    if (!showDoubleConfirm) {
      setShowDoubleConfirm(true);
      return;
    }
    
    setInstalling(true);
    setInstallError(null);
    try {
      const ramStr = localStorage.getItem('allocated_ram') || '4';
      const ram = parseInt(ramStr, 10) || 4;
      const developerMode = localStorage.getItem('developer_mode') === 'true';
      
      if (selected) {
        const historyStr = localStorage.getItem("packet_quickplay");
        let history = [];
        try {
          if (historyStr) history = JSON.parse(historyStr);
        } catch {}
        
        history = history.filter((item: any) => item.type !== "multiplayer");
        
        history.unshift({
          name: selected.title,
          type: "multiplayer",
          ip: selected.project_id,
          icon: selected.icon_url || "https://img.icons8.com/color/96/minecraft-logo.png"
        });
        
        localStorage.setItem("packet_quickplay", JSON.stringify(history));
        window.dispatchEvent(new Event("quickplay-updated"));
      }

      await invoke("launch_instance", { 
        instanceName: pinnedInstance, 
        allocatedRamGb: ram, 
        developerMode,
        serverIp: selected?.project_id,
        quickplaySingleplayer: null
      });
      setSelected(null);
    } catch (e: any) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const handleInstall = async () => {
    if (!selected) return;
    setInstalling(true);
    setInstallError(null);

    try {
      const downloadId = `${selected.project_id}|${selected.title}`;
      let targetInstance = selectedInstance;
      let targetFolder = "mods";
      if (activeTab === "resourcepack") targetFolder = "resourcepacks";
      if (activeTab === "shader") targetFolder = "shaderpacks";

      let versionToInstall = null;
      if (activeTab === "modpack") {
        versionToInstall = availableVersions.find(v => v.game_versions.includes(mcVersion));
        if (!versionToInstall) {
          setInstallError(`This modpack does not support Minecraft ${mcVersion}`);
          setInstalling(false);
          return;
        }
      } else {
        const inst = instances.find(i => i.name === targetInstance);
        const instVer = inst?.version || "1.20.4";
        versionToInstall = availableVersions.find(v => v.game_versions.includes(instVer));
        if (!versionToInstall) {
          setInstallError(`This ${activeTab} does not support Minecraft ${instVer} (your instance version)`);
          setInstalling(false);
          return;
        }
      }

      if (!versionToInstall || !versionToInstall.files || versionToInstall.files.length === 0) {
        setInstallError("No downloadable files found for the compatible version.");
        setInstalling(false);
        return;
      }

      const file = versionToInstall.files[0];

      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        if (activeTab === "modpack") {
          targetInstance = selected.title.replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 40);
          
          // Use the new install_mr_pack function for modpacks
          await invoke("install_mr_pack", {
            url: file.url,
            instanceName: targetInstance,
            mcVersion: mcVersion,
            downloadId: downloadId,
            metadata: {
              name: selected.title,
              icon_url: selected.icon_url,
              description: selected.description
            }
          });
          window.dispatchEvent(new Event("instances-updated"));
        } else {
          // Use regular download_file for other content types
          invoke("download_file", {
            url: file.url,
            instanceName: targetInstance,
            targetFolder: targetFolder,
            filename: file.filename,
            downloadId: downloadId,
            metadata: {
              name: selected.title,
              icon_url: selected.icon_url,
              description: selected.description
            }
          }).catch(console.error);
        }
      } else {
        console.log("Would download:", file.url, "to", targetInstance, "/", targetFolder);
      }

      setSelected(null);
    } catch (e: any) {
      setInstallError(String(e));
    }
    setInstalling(false);
  };

  const fmt = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : `${(n/1000).toFixed(0)}k`;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className="flex flex-col h-full p-8" style={{ background: "transparent" }}>
      <div className="mb-6 relative z-10">
        <p className="text-[10px] font-bold tracking-[0.25em] uppercase mb-1 text-accent">Browse</p>
        <h1 className="text-3xl font-bold text-white">Discover</h1>
      </div>

      <div className="relative max-w-lg mb-6 z-10">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: "var(--text-muted)" }} />
        <input type="text" placeholder="Search Modrinth..." value={query} onChange={e => setQuery(e.target.value)}
          className="field w-full pl-11 pr-4 py-3 text-sm rounded-sm" />
      </div>

      {/* Tabs */}
      <div className="flex mb-6 border-b divider z-10">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="relative px-5 py-2.5 text-xs font-semibold tracking-widest uppercase transition-colors"
            style={{ color: activeTab === tab.id ? "white" : "var(--text-secondary)" }}>
            {tab.label}
            {activeTab === tab.id && (
              <motion.div layoutId="discoverTab" className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: "var(--accent-gradient)" }} />
            )}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto pr-2 pb-8 relative z-10">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 rounded-sm animate-pulse" style={{ background: "var(--bg-card)" }} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>No results found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map(p => (
              <div key={p.project_id} onClick={() => openModal(p)}
                className="card panel-hover p-4 flex gap-4 cursor-pointer group">
                <div className="w-14 h-14 shrink-0 overflow-hidden rounded-sm" style={{ background: "var(--bg-primary)" }}>
                  {p.icon_url
                    ? <img src={p.icon_url} alt={p.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>?</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-accent transition-colors">{p.title}</h3>
                  <p className="text-[11px] mb-1.5 truncate text-accent">by {p.author}</p>
                  <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{p.description}</p>
                  <div className="mt-2.5">
                    {activeTab === "servers" ? (
                      <span className="tag flex items-center gap-1 w-fit bg-accent/20 text-accent border-accent/20">
                        <Gamepad size={9} /> Featured Server
                      </span>
                    ) : (
                      <span className="tag flex items-center gap-1 w-fit">
                        <Download size={9} /> {fmt(p.downloads)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Install Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md p-7 relative"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)", borderRadius: "4px" }}>
            <button onClick={() => setSelected(null)} className="absolute top-4 right-4" style={{ color: "var(--text-muted)" }}><X size={18} /></button>

            <div className="flex items-center gap-4 mb-5">
              {selected.icon_url && <img src={selected.icon_url} className="w-14 h-14 rounded-sm shrink-0" alt="" />}
              <div>
                <h2 className="font-bold text-white text-lg leading-tight">{selected.title}</h2>
                <p className="text-xs mt-0.5 text-accent">by {selected.author}</p>
              </div>
            </div>

            {installError && (
              <div className="mb-4 p-3 text-xs rounded-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                {installError}
              </div>
            )}

            <div className="mb-6">
              {activeTab === "servers" ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-sm text-sm" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", color: "var(--text-primary)" }}>
                    <p className="font-bold text-green-400 mb-1 flex items-center gap-1.5">
                      <Gamepad size={14} /> Server Connection Ready
                    </p>
                    <p className="text-xs leading-relaxed text-muted">
                      This will launch your pinned instance <strong className="text-accent">{pinnedInstance || "None"}</strong> and automatically connect you to <strong className="text-white">{selected.project_id}</strong> on startup.
                    </p>
                  </div>
                  {showDoubleConfirm && (
                    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                      className="p-3.5 rounded-sm text-xs font-bold text-center uppercase tracking-widest text-white"
                      style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}>
                      ⚠️ Really Want to Play this Server?
                    </motion.div>
                  )}
                </div>
              ) : activeTab === "modpack" ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
                      Minecraft Version
                    </label>
                    <select value={mcVersion} onChange={e => setMcVersion(e.target.value)}
                      className="field w-full px-4 py-2.5 text-sm rounded-sm appearance-none">
                      {allMcVersions.map(v => (
                        <option key={v} value={v} style={{ background: "#141416" }}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="p-3 rounded-sm text-sm" style={{ background: "var(--accent-dim)", border: "1px solid rgba(139,92,246,0.2)", color: "var(--text-primary)" }}>
                    This modpack will create a <strong>new instance</strong>.
                  </div>
                </div>
              ) : (
                <>
                  <label className="block text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
                    Install to instance
                  </label>
                  {instances.length === 0 ? (
                    <p className="text-sm p-3" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                      No instances found. Create one in Instances first.
                    </p>
                  ) : (
                    <select value={selectedInstance} onChange={e => setSelectedInstance(e.target.value)}
                      className="field w-full px-4 py-2.5 text-sm rounded-sm appearance-none">
                      {instances.map(inst => (
                        <option key={inst.name} value={inst.name} style={{ background: "#141416" }}>
                          {inst.name} ({inst.version})
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>

            <button onClick={activeTab === "servers" ? handlePlayServer : handleInstall}
              disabled={installing || (activeTab !== "modpack" && activeTab !== "servers" && instances.length === 0) || (activeTab === "servers" && !pinnedInstance)}
              className="btn-accent w-full py-3.5 rounded-sm flex items-center justify-center gap-3 disabled:opacity-50">
              {installing ? (
                <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> {activeTab === "servers" ? "Launching Minecraft..." : "Installing..."}</>
              ) : activeTab === "servers" ? (
                <><Gamepad size={16} /> {showDoubleConfirm ? "Yes, Let's Play!" : "Play Server"}</>
              ) : (
                <><Download size={16} /> Install — Download will track in top right</>
              )}
            </button>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
