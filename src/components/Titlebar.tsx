import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

export default function Titlebar() {
  const appWindow = getCurrentWindow();

  return (
    <div 
      data-tauri-drag-region 
      className="h-9 bg-[#0b0b0b] flex justify-between items-center select-none fixed top-0 left-0 right-0 z-[100] border-b border-white/5"
    >
      <div className="flex-1 flex items-center pl-4 pointer-events-none">
        <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">Packet Launcher</span>
      </div>
      
      <div className="flex h-full">
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
