import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Folder, Trash2, Package, Layers, Image, Code } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface ContentMeta {
  filename: string;
  name: string;
  icon_url?: string;
  description?: string;
}

interface InstanceDetailsProps {
  instanceName: string;
  onClose: () => void;
  onDelete: () => void;
}

const TABS = [
  { id: "mods", label: "Mods", icon: Package },
  { id: "resourcepacks", label: "Resources", icon: Layers },
  { id: "shaderpacks", label: "Shaders", icon: Image },
  { id: "datapacks", label: "Data Packs", icon: Code },
];

export default function InstanceDetails({ instanceName, onClose, onDelete }: InstanceDetailsProps) {
  const [activeTab, setActiveTab] = useState("mods");
  const [contents, setContents] = useState<ContentMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const loadContents = async () => {
    setLoading(true);
    try {
      const res = await invoke<ContentMeta[]>("list_instance_contents", { name: instanceName, folder: activeTab });
      setContents(res);
    } catch (e) {
      console.error(e);
      setContents([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadContents();
  }, [instanceName, activeTab]);

  const handleDeleteInstance = async () => {
    try {
      await invoke("delete_instance", { name: instanceName });
      onDelete();
      onClose();
      window.dispatchEvent(new Event("instances-updated"));
    } catch (e) {
      alert(String(e));
    }
  };

  const handleOpenFolder = async () => {
    await invoke("open_instance_folder", { name: instanceName });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-4xl h-[80vh] overflow-hidden rounded-sm relative flex flex-col"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border-medium)" }}
        onClick={e => e.stopPropagation()}>
        
        {/* Delete Confirmation Overlay */}
        <AnimatePresence>
          {showConfirmDelete && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[70] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                  <Trash2 size={28} className="text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Delete Instance?</h3>
                <p className="text-sm text-secondary mb-8 leading-relaxed">
                  Are you sure you want to delete <span className="text-white font-bold">"{instanceName}"</span>? This will permanently remove all mods, worlds, and settings.
                </p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowConfirmDelete(false)} className="btn-ghost flex-1 py-3 rounded-sm">Cancel</button>
                  <button onClick={handleDeleteInstance} className="bg-red-600 hover:bg-red-700 text-white font-bold flex-1 py-3 rounded-sm transition-colors">Delete</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="p-6 border-b divider flex items-center justify-between bg-card-subtle">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-sm bg-primary flex items-center justify-center overflow-hidden" style={{ background: "var(--bg-primary)" }}>
              <img src="https://i.imghippo.com/files/hfRa5982h.png" alt="" className="w-8 h-8 object-contain" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">{instanceName}</h2>
              <p className="text-xs text-accent font-medium tracking-widest uppercase">Instance Details</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleOpenFolder} className="btn-ghost px-4 py-2 rounded-sm flex items-center gap-2 text-xs">
              <Folder size={14} /> Open Folder
            </button>
            <button onClick={() => setShowConfirmDelete(true)} className="px-4 py-2 rounded-sm flex items-center gap-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 size={14} /> Delete
            </button>
            <button onClick={onClose} className="p-2 text-muted hover:text-white transition-colors ml-2">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-48 border-r divider flex flex-col p-3 gap-1 bg-black/20">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-sm text-sm font-semibold transition-all ${activeTab === tab.id ? "bg-accent text-white" : "text-secondary hover:bg-white/5"}`}>
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* List Area */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-black/10">
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-sm animate-pulse bg-white/5" />)}
              </div>
            ) : contents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50 grayscale">
                <Package size={48} className="mb-4 text-muted" />
                <p className="text-sm font-medium">No {activeTab} found</p>
                <p className="text-xs mt-1">Install them from the Discover tab</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {contents.map((item, i) => (
                  <motion.div key={item.filename} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-4 p-3 rounded-sm bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] transition-colors group">
                    <div className="w-10 h-10 shrink-0 rounded-sm overflow-hidden bg-black/40 flex items-center justify-center">
                      {item.icon_url ? (
                        <img src={item.icon_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package size={18} className="text-muted" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm text-white truncate">{item.name}</h3>
                      <p className="text-xs text-muted truncate mt-0.5">{item.description || item.filename}</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                       <span className="text-[10px] font-bold text-accent uppercase tracking-widest px-2 py-1 bg-accent/10 rounded">Active</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
