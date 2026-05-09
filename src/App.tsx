import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import { Home, Compass, LayoutGrid, Settings as SettingsIcon, Star, User } from "lucide-react";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import InstanceDetails from "./components/InstanceDetails";
import "./App.css";

import Titlebar from "./components/Titlebar";
import DownloadManager from "./components/DownloadManager";
import HomePage from "./pages/Home.tsx";
import DiscoverPage from "./pages/Discover.tsx";
import InstancesPage from "./pages/Instances.tsx";
import SkinsPage from "./pages/Skins.tsx";
import SettingsPage from "./pages/Settings.tsx";
import { MessageSquare } from "lucide-react";

interface InstanceMeta { name: string; instance_type: string; version: string; last_played: string; favourite: boolean; }

function SplashScreen({ onComplete }: { onComplete: () => void }) {
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
        <div className="flex items-center gap-2 mb-8">
          <div className="h-[1px] w-8 bg-white/20" />
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent">Powered by MCDev Lab</p>
          <div className="h-[1px] w-8 bg-white/20" />
        </div>

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
  { name: "Instances", path: "/instances", icon: LayoutGrid },
];

function Sidebar() {
  const location = useLocation();
  const [favourites, setFavourites] = useState<InstanceMeta[]>([]);

  useEffect(() => {
    const isTauri = '__TAURI__' in window || (window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      invoke<InstanceMeta[]>("list_instances").then(insts => setFavourites(insts.filter(i => i.favourite))).catch(() => {});
    }
    const handler = () => {
      if (isTauri) {
        invoke<InstanceMeta[]>("list_instances").then(insts => setFavourites(insts.filter(i => i.favourite))).catch(() => {});
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

function StatusBadge() {
  return (
    <div className="absolute bottom-6 right-6 z-40 flex items-center gap-2">
      {/* Download pill (only shown when minimised) */}
      <div id="download-anchor" />
      <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-medium)", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: "var(--text-secondary)" }}>
          System Ready
        </span>
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
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AnimatePresence>
  );
}

function setAccentVars(hex: string, gradient: string) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-gradient', gradient);
  // parse hex → rgba for dim/glow
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.12)`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.28)`);
  // update grid color
  document.documentElement.style.setProperty('--grid-color', `rgba(${r},${g},${b},0.07)`);
}

function App() {
  const [detailsInstance, setDetailsInstance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initial splash screen timer
    const timer = setTimeout(() => setIsLoading(false), 3500);

    const handleOpenDetails = (e: any) => {
      if (e.detail && e.detail.name) setDetailsInstance(e.detail.name);
    };
    window.addEventListener("open-instance-details" as any, handleOpenDetails);
    return () => {
      window.removeEventListener("open-instance-details" as any, handleOpenDetails);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const hex = localStorage.getItem('accent_color') || '#8b5cf6';
    const gradient = localStorage.getItem('accent_gradient') || 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
    setAccentVars(hex, gradient);

    async function checkUpdates() {
      if (localStorage.getItem('auto_update_enabled') === 'false') return;
      try { const u = await check(); if (u) { await u.downloadAndInstall(); await relaunch(); } } catch {}
    }
    if ('__TAURI__' in window || (window as any).__TAURI_INTERNALS__) checkUpdates();
  }, []);

  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen overflow-hidden font-sans pt-9" style={{ background: "var(--bg-primary)" }}>
        <AnimatePresence>
          {isLoading && <SplashScreen onComplete={() => setIsLoading(false)} />}
        </AnimatePresence>

        {/* Subtle grid overlay */}
        <div className="grid-bg" />
        <Titlebar />
        <div className="flex flex-1 overflow-hidden relative z-10">
          <Sidebar />
          <div className="flex-1 relative overflow-hidden" style={{ background: "transparent" }}>
            <StatusBadge />
            <DownloadManager />
            <AnimatedRoutes />
            
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
export { setAccentVars };
