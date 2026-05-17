import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { setAccentVars } from "../utils/theme";
import { Settings as SettingsIcon, Terminal, Download, Globe, MessageSquare, RefreshCw, DownloadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

const SOLID_COLORS = [
  { name: "Purple", hex: "#8b5cf6", gradient: "linear-gradient(135deg, #8b5cf6, #7c3aed)" },
  { name: "Crimson", hex: "#e11d48", gradient: "linear-gradient(135deg, #e11d48, #9f1239)" },
  { name: "Cyan", hex: "#06b6d4", gradient: "linear-gradient(135deg, #06b6d4, #0ea5e9)" },
  { name: "Lime", hex: "#84cc16", gradient: "linear-gradient(135deg, #84cc16, #22c55e)" },
  { name: "Orange", hex: "#f97316", gradient: "linear-gradient(135deg, #f97316, #ef4444)" },
];
const GRADIENTS = [
  { name: "Aurora", hex: "#8b5cf6", gradient: "linear-gradient(135deg, #8b5cf6, #ec4899)" },
  { name: "Ocean", hex: "#06b6d4", gradient: "linear-gradient(135deg, #06b6d4, #3b82f6)" },
  { name: "Flame", hex: "#f97316", gradient: "linear-gradient(135deg, #fbbf24, #ef4444)" },
  { name: "Matrix", hex: "#22c55e", gradient: "linear-gradient(135deg, #22c55e, #06b6d4)" },
  { name: "Gold Rush", hex: "#eab308", gradient: "linear-gradient(135deg, #eab308, #f97316)" },
];

const TABS = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "advanced", label: "Advanced", icon: Terminal },
  { id: "resources", label: "Resources", icon: Download },
  { id: "social", label: "Social Hub", icon: MessageSquare },
  { id: "discord", label: "Discord", icon: Globe },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState("general");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [activeGradient, setActiveGradient] = useState("linear-gradient(135deg, #8b5cf6, #7c3aed)");
  const [systemRam, setSystemRam] = useState(8);
  const [ram, setRam] = useState(4);
  const [_authStatus, setAuthStatus] = useState<"out" | "loading" | "in">("out");
  const [profile, setProfile] = useState<{ username: string; skin_url: string } | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Advanced settings
  const [javaArgs, setJavaArgs] = useState("-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions");
  const [envVars, setEnvVars] = useState("");
  const [preLaunch, setPreLaunch] = useState("");
  const [wrapper, setWrapper] = useState("");
  const [postExit, setPostExit] = useState("");
  const [developerMode, setDeveloperMode] = useState(false);
  const [developerUsername, setDeveloperUsername] = useState("Developer");

  // Debounced save functions
  const debouncedSaveJavaArgs = useCallback((value: string) => {
    const timer = setTimeout(() => localStorage.setItem('java_args', value), 100);
    return () => clearTimeout(timer);
  }, []);

  const debouncedSaveEnvVars = useCallback((value: string) => {
    const timer = setTimeout(() => localStorage.setItem('env_vars', value), 100);
    return () => clearTimeout(timer);
  }, []);

  const debouncedSavePreLaunch = useCallback((value: string) => {
    const timer = setTimeout(() => localStorage.setItem('pre_launch', value), 100);
    return () => clearTimeout(timer);
  }, []);

  const debouncedSaveWrapper = useCallback((value: string) => {
    const timer = setTimeout(() => localStorage.setItem('wrapper', value), 100);
    return () => clearTimeout(timer);
  }, []);

  const debouncedSavePostExit = useCallback((value: string) => {
    const timer = setTimeout(() => localStorage.setItem('post_exit', value), 100);
    return () => clearTimeout(timer);
  }, []);

  const debouncedSaveDevUsername = useCallback((value: string) => {
    const timer = setTimeout(() => localStorage.setItem('developer_username', value), 100);
    return () => clearTimeout(timer);
  }, []);

  // Resource settings
  const [maxDownloads, setMaxDownloads] = useState(5);
  const [maxWrites, setMaxWrites] = useState(25);
  const [purging, setPurging] = useState(false);

  // Discord
  const [discordRpc, setDiscordRpc] = useState(true);

  // Social
  const [socialIntro, setSocialIntro] = useState(true);

  // Updates
  const [currentVersion, setCurrentVersion] = useState("0.0.0");
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // Load existing settings
    const s = localStorage.getItem('auto_update_enabled');
    if (s !== null) setAutoUpdate(s === 'true');
    const g = localStorage.getItem('accent_gradient');
    if (g) setActiveGradient(g);
    const r = localStorage.getItem('allocated_ram');
    if (r) setRam(parseInt(r));
    
    // Advanced
    setJavaArgs(localStorage.getItem('java_args') || "-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions");
    setEnvVars(localStorage.getItem('env_vars') || "");
    setPreLaunch(localStorage.getItem('pre_launch') || "");
    setWrapper(localStorage.getItem('wrapper') || "");
    setPostExit(localStorage.getItem('post_exit') || "");
    setDeveloperMode(localStorage.getItem('developer_mode') === 'true');
    setDeveloperUsername(localStorage.getItem('developer_username') || "Developer");

    // Resources
    setMaxDownloads(Number(localStorage.getItem('max_downloads')) || 5);
    setMaxWrites(Number(localStorage.getItem('max_writes')) || 25);
    
    // Discord
    const drpc = localStorage.getItem('discord_rpc') !== 'false';
    setDiscordRpc(drpc);

    // Social
    setSocialIntro(localStorage.getItem('social_intro_enabled') !== 'false');

    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      invoke<number>("get_system_memory").then(m => setSystemRam(m > 0 ? m : 8)).catch(() => {});
      invoke<{ username: string; skin_url: string; uuid: string; access_token: string } | null>("get_saved_profile")
        .then(p => { if (p) { setProfile(p); setAuthStatus("in"); } })
        .catch(() => {});
      if (drpc) invoke("set_discord_rpc", { enabled: true }).catch(console.error);
      getVersion().then(setCurrentVersion).catch(() => {});
    }

    const handleProfileUpdate = (e: any) => {
      if (e.detail) {
        setProfile(e.detail);
        setAuthStatus("in");
      }
    };
    window.addEventListener("profile-updated" as any, handleProfileUpdate);

    return () => window.removeEventListener("profile-updated" as any, handleProfileUpdate);
  }, []);

  const handleCheckUpdates = async () => {
    setIsChecking(true);
    setUpdateError(null);
    setUpdateInfo(null);
    try {
      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        const update = await check();
        setUpdateInfo(update);
      } else {
        setUpdateError("Updates only available in the desktop app");
      }
    } catch (e: any) {
      setUpdateError(String(e));
    } finally {
      setIsChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo) return;
    setIsUpdating(true);
    try {
      await updateInfo.downloadAndInstall();
      await relaunch();
    } catch (e: any) {
      setUpdateError(String(e));
      setIsUpdating(false);
    }
  };



  const applyAccent = (hex: string, gradient: string) => {
    setActiveGradient(gradient);
    setAccentVars(hex, gradient);
    localStorage.setItem('accent_color', hex);
    localStorage.setItem('accent_gradient', gradient);
  };

  const handleLogin = async () => {
    setAuthStatus("loading");
    setLoginError(null);
    try {
      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        const p = await invoke<{ username: string; skin_url: string }>("start_microsoft_oauth");
        setProfile(p);
        setAuthStatus("in");
      } else {
        setLoginError("Login requires the desktop app");
        setAuthStatus("out");
      }
    } catch (e: any) {
      setLoginError(String(e));
      setAuthStatus("out");
    }
  };

  // Helper to show error
  const ErrorDisplay = () => loginError ? (
    <div className="mb-4 p-3 text-xs rounded-sm bg-red-500/10 border border-red-500/30 text-red-400">
      {loginError}
    </div>
  ) : null;

  const handleLogout = async () => {
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      await invoke("delete_saved_profile").catch(() => {});
    }
    setProfile(null);
    setAuthStatus("out");
    setLoginError(null);
    window.dispatchEvent(new Event("profile-cleared"));
  };

  const purgeCache = async () => {
    setPurging(true);
    try {
      await invoke("purge_cache");
      alert("Cache purged successfully!");
    } catch (e) {
      alert("Purge failed: " + e);
    }
    setPurging(false);
  };

  const toggleDiscord = async () => {
    const next = !discordRpc;
    setDiscordRpc(next);
    localStorage.setItem('discord_rpc', String(next));
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      invoke("set_discord_rpc", { enabled: next }).catch(console.error);
    }
  };

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <section className="p-6 relative z-10" style={{ background: "var(--bg-panel)", border: "1px solid var(--border-subtle)" }}>
      <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-5 pb-4 border-b divider" style={{ color: "var(--text-secondary)" }}>{label}</p>
      {children}
    </section>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-10 pb-6">
        <p className="text-[10px] font-bold tracking-[0.25em] uppercase mb-1 text-accent">Configuration</p>
        <h1 className="text-4xl font-bold text-white mb-8">Settings</h1>

        {/* Tabs */}
        <div className="flex gap-1 border-b divider">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2.5 px-6 py-3.5 text-xs font-bold uppercase tracking-widest transition-all relative ${activeTab === t.id ? "text-white" : "text-muted hover:text-secondary"}`}>
              <t.icon size={14} />
              {t.label}
              {activeTab === t.id && <motion.div layoutId="settingTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-10 pb-20 custom-scrollbar">
        <div className="max-w-4xl space-y-6">
          <ErrorDisplay />
          <AnimatePresence mode="wait">
            {activeTab === "general" && (
              <motion.div key="general" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Section label="Appearance">
                  <p className="font-semibold text-xs text-white mb-4 uppercase tracking-wider">Accent Palette</p>
                  <div className="grid grid-cols-5 gap-3">
                    {[...SOLID_COLORS, ...GRADIENTS].map(c => (
                      <button key={c.name} onClick={() => applyAccent(c.hex, c.gradient)} title={c.name}
                        className="w-10 h-10 rounded-sm transition-all border-2"
                        style={{ background: c.gradient, borderColor: activeGradient === c.gradient ? "white" : "transparent" }} />
                    ))}
                  </div>
                </Section>

                <Section label="Account">
                   <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-sm bg-primary/20 border divider flex items-center justify-center overflow-hidden">
                        <img src={profile ? `https://mineskin.eu/armor/body/${profile.username}` : "https://mineskin.eu/armor/body/steve"} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{profile?.username || "Guest"}</p>
                      <button onClick={profile ? handleLogout : handleLogin} className="text-[10px] font-bold uppercase text-accent hover:underline mt-1">
                        {profile ? "Sign Out" : "Sign In with MS"}
                      </button>
                    </div>
                   </div>
                </Section>

                <Section label="Global RAM">
                  <div className="flex justify-between mb-3">
                    <span className="text-xs font-bold text-secondary">Allocation</span>
                    <span className="text-xs font-bold text-accent">{ram} GB</span>
                  </div>
                  <input type="range" min={1} max={systemRam} step={1} value={ram}
                    onChange={e => { const v = Number(e.target.value); setRam(v); localStorage.setItem('allocated_ram', String(v)); }}
                    className="w-full h-1.5 appearance-none rounded-full bg-white/5"
                    style={{ accentColor: "var(--accent)" }} />
                </Section>

                <Section label="Updates">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-white uppercase tracking-wider">Auto-Check</p>
                        <p className="text-[10px] text-muted mt-0.5">Check for updates on launch</p>
                      </div>
                      <button onClick={() => { const n = !autoUpdate; setAutoUpdate(n); localStorage.setItem('auto_update_enabled', String(n)); }}
                        className={`w-10 h-5 rounded-full relative transition-colors ${autoUpdate ? "bg-accent" : "bg-white/10"}`}>
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${autoUpdate ? "left-6" : "left-1"}`} />
                      </button>
                    </div>

                    <div className="p-4 rounded-sm bg-white/5 border divider space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold text-muted uppercase tracking-[0.2em] mb-1">Current Version</p>
                          <p className="text-sm font-bold text-white">v{currentVersion}</p>
                        </div>
                        <button 
                          onClick={handleCheckUpdates}
                          disabled={isChecking || isUpdating}
                          className="flex items-center gap-2 px-4 py-2 rounded-sm bg-accent/10 hover:bg-accent/20 text-accent text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                        >
                          <RefreshCw size={14} className={isChecking ? "animate-spin" : ""} />
                          {isChecking ? "Checking..." : "Check for Updates"}
                        </button>
                      </div>

                      {updateError && (
                        <div className="flex items-center gap-2 p-3 text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 rounded-sm">
                          <AlertCircle size={14} />
                          {updateError}
                        </div>
                      )}

                      {updateInfo ? (
                        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="pt-4 border-t divider space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[10px] font-bold text-accent uppercase tracking-widest mb-1">Update Available</p>
                              <p className="text-lg font-bold text-white">v{updateInfo.version}</p>
                            </div>
                            <button 
                              onClick={handleInstallUpdate}
                              disabled={isUpdating}
                              className="flex items-center gap-2 px-6 py-2.5 rounded-sm bg-accent text-white text-[10px] font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                            >
                              <DownloadCloud size={16} />
                              {isUpdating ? "Installing..." : "Install & Restart"}
                            </button>
                          </div>
                          {updateInfo.body && (
                            <div className="p-3 bg-black/20 rounded-sm">
                              <p className="text-[10px] font-bold text-muted uppercase mb-1">Release Notes</p>
                              <p className="text-xs text-secondary leading-relaxed">{updateInfo.body}</p>
                            </div>
                          )}
                        </motion.div>
                      ) : !isChecking && !updateError && (
                         <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-bold uppercase tracking-widest pt-2">
                           <CheckCircle2 size={14} />
                           You are on the latest version
                         </div>
                      )}
                    </div>
                  </div>
                </Section>
              </motion.div>
            )}

            {activeTab === "advanced" && (
              <motion.div key="advanced" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
                <Section label="Java Runtime Options">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-2">JVM Arguments</label>
                      <textarea value={javaArgs} onChange={e => { setJavaArgs(e.target.value); debouncedSaveJavaArgs(e.target.value); }}
                        className="field w-full h-24 p-4 text-xs font-mono rounded-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Environmental Variables (key=val;key2=val2)</label>
                      <input type="text" value={envVars} onChange={e => { setEnvVars(e.target.value); debouncedSaveEnvVars(e.target.value); }}
                        className="field w-full p-3 text-xs font-mono rounded-sm" />
                    </div>
                  </div>
                </Section>


                <Section label="Developer Mode">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-2">
                      <div>
                        <p className="text-sm font-bold text-white">Enable Developer Mode</p>
                        <p className="text-xs text-muted mt-0.5">Allow launching instances without authentication for testing</p>
                      </div>
                      <button onClick={() => {
                        const next = !developerMode;
                        setDeveloperMode(next);
                        localStorage.setItem('developer_mode', String(next));
                      }}
                        className={`w-10 h-5 rounded-full relative transition-colors ${developerMode ? "bg-accent" : "bg-white/10"}`}>
                         <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${developerMode ? "left-6" : "left-1"}`} />
                       </button>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Developer Username</label>
                      <input 
                        type="text" 
                        value={developerUsername} 
                        onChange={async (e) => { 
                          setDeveloperUsername(e.target.value); 
                          debouncedSaveDevUsername(e.target.value);
                          // Also save to backend for game to use
                          if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
                            try {
                              await invoke("save_developer_username", { username: e.target.value });
                            } catch (err) {
                              console.error("Failed to save developer username:", err);
                            }
                          }
                        }}
                        disabled={!developerMode}
                        placeholder="Developer" 
                        className="field w-full p-3 text-[10px] rounded-sm focus:outline-none focus:ring-2 focus:ring-accent/50" 
                      />
                      <p className="text-xs text-muted mt-1">Custom username when Developer Mode is enabled</p>
                    </div>
                  </div>
                </Section>

                <Section label="Instance Hooks">
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="text-[9px] font-bold text-muted uppercase block mb-1.5">Pre-Launch</label>
                        <input type="text" value={preLaunch} onChange={e => { setPreLaunch(e.target.value); debouncedSavePreLaunch(e.target.value); }} className="field w-full p-3 text-[10px] rounded-sm" placeholder="path/to/script" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted uppercase block mb-1.5">Wrapper</label>
                        <input type="text" value={wrapper} onChange={e => { setWrapper(e.target.value); debouncedSaveWrapper(e.target.value); }} className="field w-full p-3 text-[10px] rounded-sm" placeholder="e.g. primusrun" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted uppercase block mb-1.5">Post-Exit</label>
                        <input type="text" value={postExit} onChange={e => { setPostExit(e.target.value); debouncedSavePostExit(e.target.value); }} className="field w-full p-3 text-[10px] rounded-sm" placeholder="path/to/script" />
                      </div>
                   </div>
                </Section>
              </motion.div>
            )}

            {activeTab === "resources" && (
              <motion.div key="resources" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
                <Section label="Download Engine">
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-xs font-bold text-white uppercase tracking-wider">Concurrent Downloads</label>
                        <span className="text-xs font-bold text-accent">{maxDownloads}</span>
                      </div>
                      <input type="range" min={1} max={10} step={1} value={maxDownloads}
                        onChange={e => { setMaxDownloads(Number(e.target.value)); localStorage.setItem('max_downloads', e.target.value); }}
                        className="w-full h-1.5 appearance-none rounded-full bg-white/5" style={{ accentColor: "var(--accent)" }} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-xs font-bold text-white uppercase tracking-wider">Concurrent Disk Writes</label>
                        <span className="text-xs font-bold text-accent">{maxWrites}</span>
                      </div>
                      <input type="range" min={1} max={50} step={1} value={maxWrites}
                        onChange={e => { setMaxWrites(Number(e.target.value)); localStorage.setItem('max_writes', e.target.value); }}
                        className="w-full h-1.5 appearance-none rounded-full bg-white/5" style={{ accentColor: "var(--accent)" }} />
                    </div>
                  </div>
                </Section>

                <Section label="Maintenance">
                   <div className="flex items-center justify-between p-4 rounded-sm bg-red-500/5 border border-red-500/10">
                     <div>
                       <p className="text-sm font-bold text-white">Purge System Cache</p>
                       <p className="text-[10px] text-red-400 mt-0.5">Clears versions, libraries, and temporary files.</p>
                     </div>
                     <button onClick={purgeCache} disabled={purging}
                      className="px-6 py-2 rounded-sm bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold uppercase transition-colors">
                       {purging ? "Purging..." : "Purge Cache"}
                     </button>
                   </div>
                </Section>
              </motion.div>
            )}

            {activeTab === "discord" && (
              <motion.div key="discord" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
                <Section label="Discord Integration">
                  <div className="flex items-center justify-between p-2">
                    <div>
                      <p className="text-sm font-bold text-white">Discord Rich Presence</p>
                      <p className="text-xs text-muted mt-0.5">Show your status as "Playing Packet Launcher"</p>
                    </div>
                    <button onClick={toggleDiscord}
                      className={`w-10 h-5 rounded-full relative transition-colors ${discordRpc ? "bg-accent" : "bg-white/10"}`}>
                       <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${discordRpc ? "left-6" : "left-1"}`} />
                     </button>
                  </div>
                </Section>
              </motion.div>
            )}

            {activeTab === "social" && (
              <motion.div key="social" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
                <Section label="Social Hub Experience">
                  <div className="flex items-center justify-between p-2">
                    <div>
                      <p className="text-sm font-bold text-white">Social Page Intro</p>
                      <p className="text-xs text-muted mt-0.5">Show "Packet Launcher -- Socials" animation on enter</p>
                    </div>
                    <button onClick={() => {
                      const next = !socialIntro;
                      setSocialIntro(next);
                      localStorage.setItem('social_intro_enabled', String(next));
                    }}
                      className={`w-10 h-5 rounded-full relative transition-colors ${socialIntro ? "bg-accent" : "bg-white/10"}`}>
                       <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${socialIntro ? "left-6" : "left-1"}`} />
                     </button>
                  </div>
                </Section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
