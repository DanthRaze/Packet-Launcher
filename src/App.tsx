import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import { Home, Compass, LayoutGrid, Settings as SettingsIcon, Star, User, MessageSquare } from "lucide-react";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { motion, AnimatePresence } from "framer-motion";
import { PartyPopper, X } from "lucide-react";
import InstanceDetails from "./components/InstanceDetails";
import { setAccentVars } from "./utils/theme";
import "./App.css";

import Titlebar from "./components/Titlebar";
import DownloadManager from "./components/DownloadManager";
import HomePage from "./pages/Home.tsx";
import DiscoverPage from "./pages/Discover.tsx";
import InstancesPage from "./pages/Instances.tsx";
import SkinsPage from "./pages/Skins.tsx";
import SocialsPage from "./pages/Socials.tsx";
import SettingsPage from "./pages/Settings.tsx";


const BACKEND_URL = "https://script.google.com/macros/s/AKfycby6dOIwEwKnwRYx_IwRe7s3jiMRzMDV84-Ot_0b45qBHG6KDvUzROhreQDvc9VZMizJ/exec";

interface InstanceMeta { name: string; instance_type: string; version: string; last_played: string; favourite: boolean; }

function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [currentTip] = useState(() => {
    const tips = [
      "Press F3 + G to show chunk borders in-game.",
      "Shift-click the 'Launch' button to open the instance folder.",
      "Check the 'Skins' tab to customize your look before playing.",
      "Did you know? Packet Launcher uses 40% less RAM than the official one.",
      "Hold Shift while clicking a chest to quick-move items.",
      "Join our Discord to get early access to new themes!",
      "You can drag and drop .zip files to import instances.",
      "Pressing F3 + H shows advanced tooltips and item durability.",
      "MCDev Lab: Building the future of Minecraft utilities.",
      "Packet Launcher supports Microsoft OAuth for secure login."
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  });

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0a0a0a]"
    >
      {/* Animated Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] animate-pulse" />

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center"
      >
        <div className="w-24 h-24 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 shadow-2xl backdrop-blur-xl">
          <img src="https://i.imghippo.com/files/hfRa5982h.png" className="w-16 h-16 object-contain" alt="Logo" />
        </div>

        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Packet Launcher</h1>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-[1px] w-8 bg-white/20" />
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent">Powered by MCDev Lab</p>
          <div className="h-[1px] w-8 bg-white/20" />
        </div>

        {/* Randomized Hint/Tip */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-[11px] text-white/40 italic mb-8 max-w-[250px] text-center leading-relaxed"
        >
          <span className="text-accent/60 not-italic font-bold mr-1">TIP:</span> {currentTip}
        </motion.p>

        {/* Loading bar */}
        <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden mb-12">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="w-full h-full bg-accent shadow-[0_0_15px_var(--accent)]"
          />
        </div>

        {/* Discord Link */}
        <motion.a
          href="https://discord.gg/wkbhNwZsTM"
          target="_blank"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-accent/30 transition-all group"
        >
          <MessageSquare size={18} className="text-accent group-hover:scale-110 transition-transform" />
          <span className="text-xs font-bold uppercase tracking-widest text-white/70 group-hover:text-white">Join MCDev Lab</span>
        </motion.a>
      </motion.div>

      <motion.button
        onClick={onComplete}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-10 text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
      >
        Click to skip
      </motion.button>
    </motion.div>
  );
}

const staticNav = [
  { name: "Home", path: "/", icon: Home },
  { name: "Discover", path: "/discover", icon: Compass },
  { name: "Skins", path: "/skins", icon: User },
  { name: "Socials", path: "/socials", icon: MessageSquare },
  { name: "Instances", path: "/instances", icon: LayoutGrid },
];

function Sidebar() {
  const location = useLocation();
  const [favourites, setFavourites] = useState<InstanceMeta[]>([]);

  useEffect(() => {
    const isTauri = '__TAURI__' in window || (window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      invoke<InstanceMeta[]>("list_instances").then(insts => setFavourites(insts.filter(i => i.favourite))).catch(() => { });
    }
    const handler = () => {
      if (isTauri) {
        invoke<InstanceMeta[]>("list_instances").then(insts => setFavourites(insts.filter(i => i.favourite))).catch(() => { });
      }
    };
    window.addEventListener("instances-updated", handler);
    return () => window.removeEventListener("instances-updated", handler);
  }, []);

  const NavItem = ({ path, icon: Icon, name }: { path: string; icon: any; name: string }) => {
    const isActive = location.pathname === path;
    return (
      <NavLink to={path} className="relative block outline-none rounded-sm overflow-hidden">
        {isActive && <motion.div layoutId="activeNav" className="absolute inset-0 nav-active" initial={false} transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
        <div className="relative flex items-center gap-3 px-3 py-2.5" style={{ color: isActive ? "white" : "var(--text-secondary)" }}>
          <Icon size={18} style={{ color: isActive ? "var(--accent)" : "inherit" }} />
          <span className="hidden xl:block font-semibold text-sm">{name}</span>
        </div>
      </NavLink>
    );
  };

  return (
    <div className="w-[72px] xl:w-60 flex flex-col justify-between h-full z-40 relative shrink-0"
      style={{ background: "var(--bg-secondary)", borderRight: "1px solid var(--border-subtle)" }}>
      <div>
        {/* Logo */}
        <div className="h-16 flex items-center px-4 xl:px-6 gap-3 border-b divider">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)" }}>
            <img src="https://i.imghippo.com/files/hfRa5982h.png" alt="Packet" className="w-6 h-6 object-contain" />
          </div>
          <div className="hidden xl:block">
            <p className="font-bold text-sm text-white leading-none">Packet</p>
            <p className="text-[10px] font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>Minecraft Launcher</p>
          </div>
        </div>

        {/* Static nav */}
        <nav className="mt-3 px-2 xl:px-3 flex flex-col gap-0.5">
          {staticNav.map(item => <NavItem key={item.name} {...item} />)}
        </nav>

        {/* Favourites */}
        {favourites.length > 0 && (
          <div className="mt-4 px-2 xl:px-3">
            <p className="hidden xl:block text-[10px] font-bold tracking-widest uppercase px-3 mb-2" style={{ color: "var(--text-muted)" }}>Favourites</p>
            {favourites.map(inst => (
              <button key={inst.name}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("open-instance-details", { detail: { name: inst.name } }));
                }}
                className="relative w-full block outline-none rounded-sm overflow-hidden group text-left">
                <div className="relative flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors" style={{ color: "var(--text-secondary)" }}>
                  <Star size={15} style={{ color: "var(--accent)" }} fill="var(--accent)" />
                  <span className="hidden xl:block text-xs font-semibold truncate">{inst.name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="px-2 xl:px-3 mb-4 border-t divider pt-3">
        <NavItem path="/settings" icon={SettingsIcon} name="Settings" />
      </div>
    </div>
  );
}

function StatusBadge({ isGameRunning, isLaunching, onStopGame }: { isGameRunning: boolean; isLaunching: boolean; onStopGame: () => void }) {
  const getStatusText = () => {
    if (isLaunching) return "Starting";
    if (isGameRunning) return "Running";
    return "No Instances Running";
  };

  const getStatusColor = () => {
    if (isLaunching) return "bg-yellow-500";
    if (isGameRunning) return "bg-emerald-500";
    return "bg-red-500";
  };

  return (
    <div className="absolute bottom-6 right-6 z-40 flex items-center gap-2">
      {/* Download pill (only shown when minimised) */}
      <div id="download-anchor" />
      <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-medium)", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
        <span className="relative flex h-2 w-2">
          <span className={`relative inline-flex rounded-full h-2 w-2 ${getStatusColor()} ${isLaunching ? "animate-pulse" : ""}`} />
        </span>
        <span className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: "var(--text-secondary)" }}>
          {getStatusText()}
        </span>
        {isGameRunning && (
          <button
            onClick={onStopGame}
            className="ml-2 p-1 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
            title="Stop Game"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<HomePage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/instances" element={<InstancesPage />} />
        <Route path="/skins" element={<SkinsPage />} />
        <Route path="/socials" element={<SocialsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  const [detailsInstance, setDetailsInstance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpdateWelcome, setShowUpdateWelcome] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    // Initial splash screen timer
    const timer = setTimeout(() => setIsLoading(false), 3500);

    const handleOpenDetails = (e: any) => {
      if (e.detail && e.detail.name) setDetailsInstance(e.detail.name);
    };
    window.addEventListener("open-instance-details" as any, handleOpenDetails);

    // Listen for launch status updates
    const handleLaunchStatus = (e: any) => {
      console.log("Received launch_status event:", e.detail);
      if (e.detail && e.detail.status) {
        console.log("Updating status to:", e.detail.status);
        const status = e.detail.status;
        setIsGameRunning(status === "Running");
        setIsLaunching(status === "Launching" || status === "Loading");
      }
    };
    window.addEventListener("tauri://launch_status", handleLaunchStatus);

    // Check if game is already running on app start
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("is_game_running").then((running: unknown) => {
          const isRunning = running as boolean;
          setIsGameRunning(isRunning);
          setIsLaunching(false);
        }).catch(() => { });
      });
    }

    return () => {
      window.removeEventListener("open-instance-details" as any, handleOpenDetails);
      window.removeEventListener("tauri://launch_status", handleLaunchStatus);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const hex = localStorage.getItem('accent_color') || '#8b5cf6';
    const gradient = localStorage.getItem('accent_gradient') || 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
    setAccentVars(hex, gradient);

    async function checkUpdates() {
      if (localStorage.getItem('auto_update_enabled') === 'false') return;
      try { const u = await check(); if (u) { await u.downloadAndInstall(); await relaunch(); } } catch { }
    }

    async function initVersion() {
      if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
        const version = await getVersion();
        setCurrentVersion(version);
        const lastSeen = localStorage.getItem('last_seen_version');
        if (lastSeen && lastSeen !== version) {
          setShowUpdateWelcome(true);
        }
        localStorage.setItem('last_seen_version', version);
      }
    }

    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      checkUpdates();
      initVersion();
    }
  }, []);


  // Playtime Heartbeat and Activity tracking
  useEffect(() => {
    const heartbeat = async () => {
      const savedUser = localStorage.getItem("packet_user");
      if (!savedUser) return;
      try {
        const user = JSON.parse(savedUser);
        if (!user.Username) return;
        const res = await fetch(`${BACKEND_URL}?action=heartbeat&username=${user.Username}`);
        const data = await res.json();
        if (data.success) {
          const updated = { ...user, Playtime: data.playtime };
          localStorage.setItem("packet_user", JSON.stringify(updated));
          window.dispatchEvent(new CustomEvent("user-updated", { detail: updated }));
        }
      } catch (e) {
        console.error("Heartbeat error:", e);
      }
    };
    const interval = setInterval(heartbeat, 60000);
    return () => clearInterval(interval);
  }, []);

  // Discord RPC dynamic updates
  useEffect(() => {
    const enabled = localStorage.getItem("discord_rpc_enabled") !== "false";

    if (!enabled) return;

    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
      invoke("set_discord_rpc", { enabled: true }).catch(console.error);
    }
  }, []);

  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen overflow-hidden font-sans pt-9" style={{ background: "var(--bg-primary)" }}>
        <AnimatePresence>
          {isLoading && <SplashScreen onComplete={() => setIsLoading(false)} />}
        </AnimatePresence>

        {/* Subtle grid overlay */}
        <div className="grid-bg" />
        <Titlebar isGameRunning={isGameRunning} />
        <div className="flex flex-1 overflow-hidden relative z-10">
          <Sidebar />
          <div className="flex-1 relative overflow-hidden" style={{ background: "transparent" }}>
            <DownloadManager />
            <AnimatedRoutes />
            {(isGameRunning || isLaunching) && (
              <StatusBadge
                isGameRunning={isGameRunning}
                isLaunching={isLaunching}
                onStopGame={() => {
                  if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) {
                    invoke("stop_game").catch(() => { });
                  }
                }}
              />
            )}

            <AnimatePresence>
              {showUpdateWelcome && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] w-[320px] p-6 rounded-2xl bg-[#111] border border-accent/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl"
                >
                  <div className="absolute top-4 right-4 text-white/20 hover:text-white cursor-pointer transition-colors" onClick={() => setShowUpdateWelcome(false)}>
                    <X size={16} />
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center mb-4">
                    <PartyPopper className="text-accent" size={24} />
                  </div>
                  <h2 className="text-lg font-bold text-white mb-1">Updated Successfully!</h2>
                  <p className="text-sm text-white/60 mb-6">Welcome to Packet Launcher <span className="text-accent font-bold">v{currentVersion}</span>. Enjoy the new features!</p>
                  <button
                    onClick={() => setShowUpdateWelcome(false)}
                    className="w-full py-3 rounded-lg bg-accent text-white text-xs font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Let's Play
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {detailsInstance && (
                <InstanceDetails
                  instanceName={detailsInstance}
                  onClose={() => setDetailsInstance(null)}
                  onDelete={() => {
                    window.dispatchEvent(new Event("instances-updated"));
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
