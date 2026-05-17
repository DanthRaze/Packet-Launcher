import { useState, useEffect } from "react";
import { ReactSkinview3d } from "react-skinview3d";
import { Upload, Check, AlertCircle, FileUp, Search, User } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { motion, AnimatePresence } from "framer-motion";

export default function Skins() {
  const [skinUrl, setSkinUrl] = useState("https://mineskin.eu/skin/steve");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "loading", msg: string } | null>(null);
  const [skinData, setSkinData] = useState<Uint8Array | null>(null);
  const [username, setUsername] = useState("");
  const [customSkinUrl, setCustomSkinUrl] = useState("");

  useEffect(() => {
    const loadDefaultSkin = async () => {
      try {
        const p = await invoke<any>("refresh_saved_profile");
        if (p?.username) {
          setSkinUrl(`https://mineskin.eu/skin/${p.username}?t=${Date.now()}`);
          return;
        }
      } catch {}

      const savedUser = localStorage.getItem("packet_user");
      if (savedUser) {
        try {
          const user = JSON.parse(savedUser);
          if (user.skinUrl) {
            setSkinUrl(`${user.skinUrl}${user.skinUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
          } else if (user.PFP) {
            setSkinUrl(`${user.PFP}${user.PFP.includes('?') ? '&' : '?'}t=${Date.now()}`);
          } else if (user.Username) {
            setSkinUrl(`https://mineskin.eu/skin/${user.Username}?t=${Date.now()}`);
          }
        } catch {}
      }
    };
    loadDefaultSkin();
  }, []);

  const handleFileSelection = async (path: string) => {
    console.log("Handling file selection for path:", path);
    try {
      const data = await readFile(path);
      console.log("File read successfully, data length:", data.length);
      setSkinData(data);
      // Create a preview URL
      const blob = new Blob([data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      setSkinUrl(url);
      console.log("Skin file loaded successfully");
      setStatus(null);
    } catch (e) {
      console.error("Failed to read skin file:", e);
      setStatus({ type: "error", msg: "Failed to read skin file." });
    }
  };

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['png'] }]
    });
    if (selected && !Array.isArray(selected)) {
      handleFileSelection(selected);
    }
  };

  const fetchByUsername = async () => {
    if (!username.trim()) return;
    console.log("Fetching skin for username:", username.trim());
    setStatus({ type: "loading", msg: "Fetching skin..." });
    const url = `https://mineskin.eu/skin/${username.trim()}`;
    try {
      console.log("Fetching from URL:", url);
      const res = await fetch(url);
      console.log("Response status:", res.status);
      if (!res.ok) throw new Error("User not found");
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      setSkinData(new Uint8Array(arrayBuffer));
      const skinWithTime = url + "?t=" + Date.now();
      setSkinUrl(skinWithTime);
      setStatus({ type: "success", msg: `Skin for ${username} loaded!` });
      console.log("Skin loaded successfully for:", username);

      const userStr = localStorage.getItem("packet_user");
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          user.Username = username.trim();
          user.skinUrl = skinWithTime;
          localStorage.setItem("packet_user", JSON.stringify(user));
          window.dispatchEvent(new CustomEvent("user-updated", { detail: user }));
        } catch {}
      }
    } catch (e) {
      console.error("Failed to fetch skin:", e);
      setStatus({ type: "error", msg: "Could not find skin for that username." });
    }
  };

  const fetchByUrl = async () => {
    if (!customSkinUrl.trim()) return;
    console.log("Fetching skin from URL:", customSkinUrl.trim());
    setStatus({ type: "loading", msg: "Loading skin from URL..." });
    try {
      const res = await fetch(customSkinUrl.trim());
      console.log("URL fetch response status:", res.status);
      if (!res.ok) throw new Error("Failed to fetch skin from URL");
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      setSkinData(new Uint8Array(arrayBuffer));
      const skinWithTime = customSkinUrl.trim() + "?t=" + Date.now();
      setSkinUrl(skinWithTime);
      setStatus({ type: "success", msg: "Skin loaded from URL!" });
      setCustomSkinUrl("");
      console.log("Skin loaded successfully from URL");

      const userStr = localStorage.getItem("packet_user");
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          user.skinUrl = skinWithTime;
          localStorage.setItem("packet_user", JSON.stringify(user));
          window.dispatchEvent(new CustomEvent("user-updated", { detail: user }));
        } catch {}
      }
    } catch (e) {
      console.error("Failed to fetch skin from URL:", e);
      setStatus({ type: "error", msg: "Could not load skin from that URL." });
    }
  };

  const upload = async () => {
    if (!skinData) return;
    setStatus({ type: "loading", msg: "Uploading to Minecraft services..." });
    try {
      await invoke("upload_skin", { data: Array.from(skinData) });
      setStatus({ type: "success", msg: "Skin applied successfully!" });
      const p = await invoke<any>("get_saved_profile");
      if (p?.skin_url) setSkinUrl(p.skin_url + "?t=" + Date.now());
      setSkinData(null);
      window.dispatchEvent(new CustomEvent("profile-updated", { detail: p }));

      const userStr = localStorage.getItem("packet_user");
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          user.skinUrl = skinUrl;
          localStorage.setItem("packet_user", JSON.stringify(user));
          window.dispatchEvent(new CustomEvent("user-updated", { detail: user }));
        } catch {}
      }
    } catch (e) {
      // Even if official upload fails, if they are community user we still save it!
      const userStr = localStorage.getItem("packet_user");
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          user.skinUrl = skinUrl;
          localStorage.setItem("packet_user", JSON.stringify(user));
          window.dispatchEvent(new CustomEvent("user-updated", { detail: user }));
          setStatus({ type: "success", msg: "Skin applied locally to your launcher profile!" });
          setSkinData(null);
          return;
        } catch {}
      }
      setStatus({ type: "error", msg: String(e) });
    }
  };

  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-10 h-full flex flex-col max-w-6xl mx-auto overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <p className="text-[10px] font-bold tracking-[0.3em] uppercase mb-1 text-accent">Identity</p>
        <h1 className="text-4xl font-bold text-white">Skin Library</h1>
        <p className="text-sm mt-2 text-muted">Drag a file, browse, or fetch by username.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 flex-1">
        {/* Preview Area */}
        <div className="card bg-panel flex items-center justify-center relative overflow-hidden min-h-[500px]">
          <div className="absolute inset-0 bg-accent/5" />
          <div className="relative z-10 scale-125">
            <ReactSkinview3d
              skinUrl={skinUrl}
              height="400"
              width="300"
              onReady={({ viewer }: any) => { 
                viewer.autoRotate = true; 
                viewer.autoRotateSpeed = 0.8; 
                // Skip specific animations for now to prevent crashes if skinview3d isn't global
              }}
            />
          </div>
          <div className="absolute bottom-6 left-6 right-6 p-4 rounded-sm bg-black/40 backdrop-blur-md border divider flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent">Preview</p>
              <p className="text-xs font-semibold text-white">Classic Style</p>
            </div>
            <div className="flex gap-2">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
               <span className="text-[10px] font-bold uppercase text-white/50">Active View</span>
            </div>
          </div>
        </div>

        {/* Controls Area */}
        <div className="flex flex-col gap-6">
          {/* URL Skin Import */}
          <div className="p-6 rounded-sm bg-white/[0.02] border divider">
            <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Import by URL</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input 
                  type="text" 
                  value={customSkinUrl}
                  onChange={e => setCustomSkinUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && fetchByUrl()}
                  placeholder="Enter skin URL (e.g., https://example.com/skin.png)" 
                  className="field w-full px-4 py-2.5 text-sm rounded-sm" 
                />
              </div>
              <button onClick={fetchByUrl} className="btn-ghost px-4 rounded-sm flex items-center gap-2 text-xs font-bold uppercase">
                <Search size={14} /> Import
              </button>
            </div>
          </div>

          {/* Username Fetch */}
          <div className="p-6 rounded-sm bg-white/[0.02] border divider">
            <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Fetch by Username</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                <input 
                  type="text" 
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && fetchByUsername()}
                  placeholder="e.g. 5tralex" 
                  className="field w-full pl-10 pr-4 py-2.5 text-sm rounded-sm" 
                />
              </div>
              <button onClick={fetchByUsername} className="btn-ghost px-4 rounded-sm flex items-center gap-2 text-xs font-bold uppercase">
                <Search size={14} /> Fetch
              </button>
            </div>
          </div>

          
          {/* Upload Area */}
          <div 
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (e) => { 
              e.preventDefault(); 
              setIsDragging(false); 
              const file = e.dataTransfer.files[0]; 
              if (file && (file as any).path) handleFileSelection((file as any).path); 
            }}
            onClick={pickFile}
            className={`flex-1 min-h-[200px] border-2 border-dashed rounded-sm flex flex-col items-center justify-center p-8 transition-all cursor-pointer ${isDragging ? "border-accent bg-accent/5" : "border-white/10 hover:border-white/20 bg-white/[0.02]"}`}
          >
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all ${isDragging ? "bg-accent text-white" : "bg-panel text-muted"}`}>
              <FileUp size={24} />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">{skinData ? "Ready to Apply" : "Drop Skin File"}</h3>
            <p className="text-[11px] text-muted text-center">or click to browse your computer</p>
          </div>

          <div className="space-y-4">
            <AnimatePresence>
              {status && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`p-4 rounded-sm flex items-center gap-3 border ${status.type === "success" ? "bg-green-500/10 border-green-500/20 text-green-400" : status.type === "error" ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-accent/10 border-accent/20 text-accent"}`}>
                  {status.type === "success" && <Check size={18} />}
                  {status.type === "error" && <AlertCircle size={18} />}
                  {status.type === "loading" && <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />}
                  <span className="text-xs font-semibold">{status.msg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              disabled={!skinData || status?.type === "loading"}
              onClick={upload}
              className="btn-accent w-full py-4 rounded-sm font-bold tracking-widest uppercase flex items-center justify-center gap-3 disabled:opacity-30">
              <Upload size={18} />
              Apply to Minecraft Account
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
