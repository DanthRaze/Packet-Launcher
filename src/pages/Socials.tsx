import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Users, UserPlus, LogIn, LogOut, Shield, Clock, Gamepad, Star, Check, X, Send, MessageSquare } from "lucide-react";

const BACKEND_URL = "https://script.google.com/macros/s/AKfycby6VK3P4suZuA58VJA4QfuUBYtBLBxp7QaPREDNuYkuehFdZCVPai9N_MOeq3NdSUsq/exec";

interface UserData {
  Username: string;
  Playtime: number;
  NametagConfig: string;
  Status: string;
  Activity: string;
  ActivityDetails: string;
  Bio: string;
  PFP: string;
}

interface Friend {
  username: string;
  status: string;
  onlineStatus: string;
  activity: string;
  activityDetails: string;
  nametagConfig: string;
  bio: string;
  pfp: string;
}

interface ChatMessage {
  sender: string;
  receiver: string;
  msg: string;
  time: string;
}

const NAMETAG_EFFECTS = [
  "Shaking", "Waving", "Growing", "Skewing", "Fade", "Shimmer", "Glowing", "Outline", "Gradient", "Rainbow"
];

const BANNED_WORDS = ["fuck", "shit", "nigger", "faggot", "dick", "cunt", "asshole", "pussy", "bastard", "slut", "whore"];

const filterProfanity = (text: string) => {
  let filtered = text;
  BANNED_WORDS.forEach(word => {
    const reg = new RegExp(word, 'gi');
    filtered = filtered.replace(reg, '*'.repeat(word.length));
  });
  return filtered;
};

function SocialLoading({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-6 animate-pulse">
        <img src="https://i.imghippo.com/files/hfRa5982h.png" className="w-10 h-10 object-contain" alt="Logo" />
      </div>
      <h2 className="text-xl font-bold text-white tracking-tight mb-2">Social Hub</h2>
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent animate-pulse">{message}</p>
      <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden mt-8">
        <motion.div initial={{ x: "-100%" }} animate={{ x: "100%" }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }} className="w-full h-full bg-accent" />
      </div>
    </motion.div>
  );
}

function SocialIntro({ onComplete }: { onComplete: () => void }) {
  return (
    <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#0a0a0a]">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.8 }}
        className="flex flex-col items-center">
        <h1 className="text-5xl font-black text-white tracking-tighter mb-2 italic">PACKET <span className="text-accent">LAUNCHER</span></h1>
        <div className="h-[1px] w-full bg-white/10 mb-4" />
        <p className="text-sm font-bold uppercase tracking-[0.5em] text-white/40">S O C I A L S</p>
      </motion.div>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} onClick={onComplete}
        className="absolute bottom-10 text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors">
        Click to continue
      </motion.button>
    </motion.div>
  );
}

export default function Socials() {
  const [user, setUser] = useState<UserData | null>(() => {
    const saved = localStorage.getItem("packet_user");
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem("packet_user");
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState<"friends" | "requests" | "account">("friends");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<Friend[]>([]);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem("social_intro_enabled") !== "false");
  
  // Chat state
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Login/Signup state
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [addFriendName, setAddFriendName] = useState("");

  const fetchSocialData = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${BACKEND_URL}?action=getFriends&username=${user.Username}`);
      const data = await res.json();
      setFriends(data.friends || []);
      setRequests(data.friendRequests || []);
    } catch (e) {
      console.error("Failed to fetch social data", e);
    }
  };

  const fetchMessages = async () => {
    if (!user || !activeChat) return;
    try {
      const res = await fetch(`${BACKEND_URL}?action=getMessages&u1=${user.Username}&u2=${activeChat}`);
      const data = await res.json();
      setMessages(data);
    } catch {}
  };

  useEffect(() => {
    const handleUserUpdate = (e: any) => {
      setUser(e.detail);
    };
    window.addEventListener("user-updated" as any, handleUserUpdate);
    
    if (user) {
      fetchSocialData();
      const interval = setInterval(fetchSocialData, 30000);
      return () => {
        clearInterval(interval);
        window.removeEventListener("user-updated" as any, handleUserUpdate);
      };
    }
    return () => window.removeEventListener("user-updated" as any, handleUserUpdate);
  }, [user]);

  useEffect(() => {
    if (activeChat) {
      fetchMessages();
      const interval = setInterval(fetchMessages, 1000); // 1s refresh for chat
      return () => clearInterval(interval);
    }
  }, [activeChat]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAuth = async () => {
    setLoadingMsg(isLogin ? "Authenticating..." : "Creating Account...");
    setAuthError("");
    try {
      const action = isLogin ? "login" : "signup";
      const res = await fetch(`${BACKEND_URL}?action=${action}&username=${username}&password=${password}`);
      const data = await res.json();
      if (data.success) {
        if (isLogin) {
          setUser(data.user);
          localStorage.setItem("packet_user", JSON.stringify(data.user));
        } else {
          setIsLogin(true);
          setAuthError("Account created! Please login.");
        }
      } else {
        setAuthError(data.error || "Authentication failed");
      }
    } catch (e) {
      setAuthError("Network error. Try again.");
    }
    setLoadingMsg(null);
  };

  const sendFriendRequest = async () => {
    if (!user || !addFriendName) return;
    if (addFriendName.toLowerCase() === user.Username.toLowerCase()) {
      alert("You cannot friend yourself!");
      return;
    }
    setLoadingMsg("Sending Friend Request...");
    try {
      const res = await fetch(`${BACKEND_URL}?action=friendRequest&from=${user.Username}&to=${addFriendName}&op=send`);
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        setAddFriendName("");
        fetchSocialData();
      }
    } catch {}
    setLoadingMsg(null);
  };

  const respondToRequest = async (target: string, op: "accept" | "reject") => {
    if (!user) return;
    setLoadingMsg(op === "accept" ? "Accepting..." : "Rejecting...");
    try {
      await fetch(`${BACKEND_URL}?action=friendRequest&from=${target}&to=${user.Username}&op=${op}`);
      fetchSocialData();
    } catch {}
    setLoadingMsg(null);
  };

  const updateNametag = async (effect: string) => {
    if (!user || user.Playtime < 2880) return;
    setLoadingMsg("Updating Nametag...");
    const config = JSON.parse(user.NametagConfig || "{}");
    config[effect] = !config[effect];
    const newConfig = JSON.stringify(config);
    try {
      await fetch(`${BACKEND_URL}?action=updateNametag&username=${user.Username}&config=${encodeURIComponent(newConfig)}`);
      const updatedUser = { ...user, NametagConfig: newConfig };
      setUser(updatedUser);
      localStorage.setItem("packet_user", JSON.stringify(updatedUser));
    } catch {}
    setLoadingMsg(null);
  };

  const sendMessage = async () => {
    if (!user || !activeChat || !chatInput.trim()) return;
    const msg = chatInput;
    setChatInput("");
    try {
      await fetch(`${BACKEND_URL}?action=sendMessage&from=${user.Username}&to=${activeChat}&msg=${encodeURIComponent(msg)}`);
      fetchMessages();
    } catch {}
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("packet_user");
  };

  if (showIntro) return <SocialIntro onComplete={() => setShowIntro(false)} />;

  const updateProfile = async (bio: string, pfp: string) => {
    if (!user) return;
    const filteredBio = filterProfanity(bio);
    const filteredPfp = filterProfanity(pfp);
    setLoadingMsg("Updating profile...");
    try {
      const res = await fetch(`${BACKEND_URL}?action=updateProfile&username=${user.Username}&bio=${encodeURIComponent(filteredBio)}&pfp=${encodeURIComponent(filteredPfp)}`);
      const data = await res.json();
      if (data.success) {
        const updated = { ...user, Bio: filteredBio, PFP: filteredPfp };
        setUser(updated);
        localStorage.setItem("packet_user", JSON.stringify(updated));
      }
    } catch {}
    setLoadingMsg(null);
  };

  const getNametagStyles = (configStr: string) => {
    const config = JSON.parse(configStr || "{}");
    let classes = "";
    let style: any = {};
    let animations: string[] = [];

    if (config.Rainbow) classes += "rainbow-text ";
    if (config.Gradient) classes += "gradient-text ";
    if (config.Shimmer) classes += "shimmer-text ";
    if (config.Outline) style.textShadow = "1px 1px 0px #000, -1px -1px 0px #000, 1px -1px 0px #000, -1px 1px 0px #000";
    if (config.Glowing) style.filter = "drop-shadow(0 0 8px var(--accent))";
    
    if (config.Shaking) animations.push("shake 0.5s infinite");
    if (config.Waving) animations.push("wave 2s infinite ease-in-out");
    if (config.Growing) animations.push("grow 3s infinite ease-in-out");
    if (config.Fade) animations.push("fade 4s infinite alternate");
    if (config.Skewing) animations.push("skew 2.5s infinite alternate");

    if (animations.length > 0) style.animation = animations.join(", ");
    return { classes, style };
  };

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <AnimatePresence>{loadingMsg && <SocialLoading message={loadingMsg} />}</AnimatePresence>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 rounded-sm bg-[#111113] border border-white/5 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4 border border-accent/20">
              <Users className="text-accent" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-white">{isLogin ? "Welcome Back" : "Create Account"}</h1>
            <p className="text-sm text-white/40 mt-1">Connect with the Packet community</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-3 text-sm text-white outline-none focus:border-accent/50 transition-colors" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-3 text-sm text-white outline-none focus:border-accent/50 transition-colors" />
            </div>
            {authError && <p className="text-xs text-red-400 text-center">{authError}</p>}
            
            <button onClick={handleAuth} className="w-full bg-accent hover:bg-accent/90 text-white font-bold py-3 rounded-sm text-sm transition-all flex items-center justify-center gap-2">
              {isLogin ? <LogIn size={18} /> : <UserPlus size={18} />}
              {isLogin ? "Sign In" : "Create Account"}
            </button>

            <button onClick={() => setIsLogin(!isLogin)} className="w-full text-xs text-white/40 hover:text-white transition-colors py-2">
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full relative overflow-hidden">
      <AnimatePresence>{loadingMsg && <SocialLoading message={loadingMsg} />}</AnimatePresence>
      
      <div className="p-8 pb-0">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase mb-1 text-accent">Community</p>
            <h1 className="text-3xl font-bold text-white">Socials</h1>
          </div>
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 px-4 py-2 rounded-full">
            <div className="flex items-center gap-2 pr-4 border-r border-white/10">
              <Clock size={14} className="text-accent" />
              <span className="text-xs font-bold text-white">{(user.Playtime / 60).toFixed(1)}h Playtime</span>
            </div>
            <button onClick={handleLogout} className="text-xs font-bold text-white/40 hover:text-red-400 transition-colors flex items-center gap-2">
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-white/5">
          {[
            { id: "friends", label: "Friends", icon: Users },
            { id: "requests", label: "Requests", icon: UserPlus, count: requests.length },
            { id: "account", label: "Account", icon: User }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className={`relative px-6 py-3 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${activeTab === tab.id ? "text-white" : "text-white/40 hover:text-white/70"}`}>
              <tab.icon size={14} />
              {tab.label}
              {tab.count ? <span className="px-1.5 py-0.5 rounded-full bg-accent text-[10px] text-white ml-1">{tab.count}</span> : null}
              {activeTab === tab.id && <motion.div layoutId="socialTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 pt-6">
        <AnimatePresence mode="wait">
          {activeTab === "friends" && (
            <motion.div key="friends" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
              <div className="flex gap-3">
                <input type="text" placeholder="Add friend by username..." value={addFriendName} onChange={e => setAddFriendName(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-sm px-4 py-2 text-sm text-white outline-none focus:border-accent/50" />
                <button onClick={sendFriendRequest} className="bg-accent px-6 py-2 rounded-sm text-xs font-bold uppercase text-white hover:bg-accent/90 transition-all">Add Friend</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {friends.length === 0 ? (
                  <div className="col-span-full py-20 flex flex-col items-center text-white/20">
                    <Users size={48} className="mb-4 opacity-10" />
                    <p className="text-sm font-medium">No friends yet. Add someone to get started!</p>
                  </div>
                ) : friends.map(friend => (
                  <div key={friend.username} className="bg-[#111113] border border-white/5 p-4 rounded-sm hover:border-white/10 transition-all group relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 overflow-hidden">
                          <img src={friend.pfp || `https://mineskin.eu/avatar/${friend.username}`} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#111113] ${friend.onlineStatus === 'Online' ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-white truncate">{friend.username}</p>
                        <p className="text-[10px] text-white/40 font-medium uppercase tracking-wider">{friend.onlineStatus}</p>
                      </div>
                      <button onClick={() => setActiveChat(friend.username)} className="p-2 rounded-sm bg-white/5 hover:bg-accent/20 text-white/40 hover:text-accent transition-all">
                        <MessageSquare size={16} />
                      </button>
                    </div>
                    
                    {friend.onlineStatus === 'Online' && friend.activity && (
                      <div className="mt-4 p-3 rounded-sm bg-white/5 border border-white/5">
                        <div className="flex items-center gap-2 mb-1">
                          <Gamepad size={12} className="text-accent" />
                          <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{friend.activity}</span>
                        </div>
                        <p className="text-xs text-white/90 font-medium truncate">{friend.activityDetails}</p>
                      </div>
                    )}

                    {friend.bio && (
                      <p className="mt-4 text-[10px] text-white/30 italic leading-relaxed border-t border-white/5 pt-3 line-clamp-2">
                        "{friend.bio}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === "requests" && (
            <motion.div key="requests" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {requests.length === 0 ? (
                <div className="col-span-full py-20 flex flex-col items-center text-white/20">
                  <UserPlus size={48} className="mb-4 opacity-10" />
                  <p className="text-sm font-medium">No pending requests</p>
                </div>
              ) : requests.map(req => (
                <div key={req.username} className="bg-[#111113] border border-white/5 p-4 rounded-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 overflow-hidden">
                      <img src={req.pfp || `https://mineskin.eu/avatar/${req.username}`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-white truncate">{req.username}</p>
                      {req.bio && <p className="text-[9px] text-white/30 truncate max-w-[120px]">{req.bio}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => respondToRequest(req.username, 'accept')} className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 rounded-sm transition-colors"><Check size={18} /></button>
                    <button onClick={() => respondToRequest(req.username, 'reject')} className="p-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-sm transition-colors"><X size={18} /></button>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {activeTab === "account" && (
            <motion.div key="account" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="max-w-4xl space-y-8">
              <div className={`p-6 rounded-sm border ${user.Playtime >= 2880 ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-accent/5 border-accent/10'}`}>
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${user.Playtime >= 2880 ? 'bg-emerald-500/20 text-emerald-500' : 'bg-accent/20 text-accent'}`}>
                    <Shield size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Nametag Customization</h3>
                    <p className="text-xs text-white/40 mt-0.5">
                      {user.Playtime >= 2880 
                        ? "You've unlocked custom nametags! Your features will be visible to all Packet users." 
                        : `Play for 48 hours to unlock custom nametags. You need ${( (2880 - user.Playtime) / 60 ).toFixed(1)} more hours.`}
                    </p>
                  </div>
                </div>
                <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, (user.Playtime / 2880) * 100)}%` }}
                    className={`h-full ${user.Playtime >= 2880 ? 'bg-emerald-500' : 'bg-accent'}`} />
                </div>
              </div>

              <div className={`grid grid-cols-2 md:grid-cols-5 gap-3 ${user.Playtime < 2880 ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
                {NAMETAG_EFFECTS.map(effect => {
                  const config = JSON.parse(user.NametagConfig || "{}");
                  const isActive = config[effect];
                  return (
                    <button key={effect} onClick={() => updateNametag(effect)}
                      className={`p-4 rounded-sm border transition-all text-left group ${isActive ? 'bg-accent border-accent text-white' : 'bg-white/5 border-white/5 text-white/40 hover:border-white/20'}`}>
                      <Star size={16} className={`mb-3 ${isActive ? 'text-white' : 'text-accent'}`} />
                      <p className="text-xs font-bold uppercase tracking-widest">{effect}</p>
                      <div className={`mt-2 h-1 w-8 rounded-full ${isActive ? 'bg-white/40' : 'bg-white/5'}`} />
                    </button>
                  );
                })}
              </div>

              <div className="p-8 rounded-sm bg-[#111113] border border-white/5 flex flex-col items-center">
                <p className="text-xs font-bold text-white/20 uppercase tracking-[0.4em] mb-4">Preview</p>
                <div className="relative">
                  <div className="absolute -inset-4 bg-accent/20 blur-2xl rounded-full opacity-50" />
                  <div className="relative bg-white/5 border border-white/10 px-8 py-3 rounded-sm flex flex-col items-center">
                    <p className="text-[10px] font-bold text-accent uppercase tracking-widest mb-1">MCDev Lab</p>
                    <p className={`text-xl font-bold text-white tracking-tight ${getNametagStyles(user.NametagConfig).classes}`} 
                       style={getNametagStyles(user.NametagConfig).style}>{user.Username}</p>
                  </div>
                </div>
              </div>

              <div className="p-8 rounded-sm bg-[#111113] border border-white/5 space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Public Profile</h3>
                  <p className="text-xs text-white/40">Customize how others see you in the Social Hub.</p>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-accent uppercase tracking-widest mb-2">Biography</label>
                    <textarea value={user.Bio} onChange={e => setUser({...user, Bio: e.target.value})} onBlur={() => updateProfile(user.Bio, user.PFP)}
                      className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-3 text-sm text-white outline-none focus:border-accent/50 transition-colors h-24 resize-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-accent uppercase tracking-widest mb-2">Profile Picture URL</label>
                    <input type="text" value={user.PFP} onChange={e => setUser({...user, PFP: e.target.value})} onBlur={() => updateProfile(user.Bio, user.PFP)}
                      placeholder="https://example.com/image.png (Leave empty for MC Avatar)"
                      className="w-full bg-white/5 border border-white/10 rounded-sm px-4 py-3 text-sm text-white outline-none focus:border-accent/50 transition-colors" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeChat && (
          <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute top-0 right-0 w-80 h-full bg-[#0d0d0f] border-l border-white/5 shadow-2xl z-50 flex flex-col">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <img src={`https://mineskin.eu/avatar/${activeChat}`} className="w-8 h-8 rounded" alt="" />
                <p className="font-bold text-sm text-white">{activeChat}</p>
              </div>
              <button onClick={() => setActiveChat(null)} className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white"><X size={18} /></button>
            </div>
            
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-white/10">
                  <MessageSquare size={32} className="mb-2 opacity-10" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">No messages yet</p>
                </div>
              ) : messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.sender === user.Username ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-sm text-xs ${m.sender === user.Username ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-white/5 text-white/80 border border-white/5'}`}>
                    {m.msg}
                  </div>
                  <p className="text-[9px] text-white/20 mt-1 uppercase font-bold">{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-white/5 bg-white/[0.02]">
              <div className="flex gap-2">
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..." className="flex-1 bg-white/5 border border-white/10 rounded-sm px-3 py-2 text-xs text-white outline-none focus:border-accent/50" />
                <button onClick={sendMessage} className="p-2 bg-accent text-white rounded-sm hover:bg-accent/90 transition-all active:scale-95"><Send size={16} /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shake {
          0% { transform: translate(1px, 1px) rotate(0deg); }
          10% { transform: translate(-1px, -2px) rotate(-1deg); }
          20% { transform: translate(-3px, 0px) rotate(1deg); }
          30% { transform: translate(3px, 2px) rotate(0deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          50% { transform: translate(-1px, 2px) rotate(-1deg); }
          60% { transform: translate(-3px, 1px) rotate(0deg); }
          70% { transform: translate(3px, 1px) rotate(-1deg); }
          80% { transform: translate(-1px, -1px) rotate(1deg); }
          90% { transform: translate(1px, 2px) rotate(0deg); }
          100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        @keyframes wave {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes grow {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes fade {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }
        @keyframes skew {
          from { transform: skewX(-10deg); }
          to { transform: skewX(10deg); }
        }
        .rainbow-text {
          background: linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #8b00ff);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: rainbow 3s linear infinite;
        }
        @keyframes rainbow { to { background-position: 200% center; } }
        .shimmer-text {
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: rainbow 2s linear infinite;
        }
      `}} />
    </motion.div>
  );
}
