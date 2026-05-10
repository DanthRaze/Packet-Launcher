import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Square as StopIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export default function Titlebar({ isGameRunning }: { isGameRunning: boolean }) {
  const appWindow = getCurrentWindow();

  const handleStop = async () => {
    try {
      await invoke("stop_game");
    } catch (e) {
      console.error("Failed to stop game:", e);
    }
  };

  return (
    <div 
      data-tauri-drag-region 
      className="h-9 bg-[#0b0b0b] flex justify-between items-center select-none fixed top-0 left-0 right-0 z-[100] border-b border-white/5"
    >
      <div className="flex-1 flex items-center pl-4 pointer-events-none">
        <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">Packet Launcher</span>
      </div>
      
      <div className="flex h-full">
        {isGameRunning && (
          <button
            onClick={handleStop}
            className="h-full px-3 flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold tracking-wider uppercase transition-colors"
            title="Stop Game"
          >
            <StopIcon size={10} fill="white" /> Stop
          </button>
        )}
        <div 
          className="w-12 h-full flex justify-center items-center hover:bg-white/10 transition-colors cursor-pointer text-gray-400 hover:text-white"
          onClick={() => appWindow.minimize()}
        >
          <Minus size={16} />
        </div>
        <div 
          className="w-12 h-full flex justify-center items-center hover:bg-white/10 transition-colors cursor-pointer text-gray-400 hover:text-white"
          onClick={() => appWindow.toggleMaximize()}
        >
          <Square size={14} />
        </div>
        <div 
          className="w-12 h-full flex justify-center items-center hover:bg-red-500 hover:text-white transition-colors cursor-pointer text-gray-400"
          onClick={() => appWindow.close()}
        >
          <X size={18} />
        </div>
      </div>
    </div>
  );
}
