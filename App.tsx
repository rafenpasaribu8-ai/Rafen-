
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AIMode, Message, ChatSession, MessagePart, AIPersona } from './types';
import { IconBolt, IconBrain, IconSearch, IconImage, IconCode, IconSend, IconPlus, IconTrash, IconHistory, IconClip, IconX, IconSpeaker, IconCopy, IconCheck, IconPlay, IconSquare, IconKey } from './components/Icons';
import { GeminiService } from './services/geminiService';
import { APP_NAME, PERSONA_CONFIG } from './constants';

// Audio Helpers
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [mode, setMode] = useState<AIMode>(AIMode.FAST);
  const [persona, setPersona] = useState<AIPersona>(AIPersona.NETRAL);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSpeakingId, setIsSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentGreeting, setCurrentGreeting] = useState('');
  
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [customApiKey, setCustomApiKey] = useState('');
  
  // Preview states
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRequestedRef = useRef<boolean>(false);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const config = PERSONA_CONFIG[persona];

  useEffect(() => {
    const greetings = PERSONA_CONFIG[persona].greetings;
    setCurrentGreeting(greetings[Math.floor(Math.random() * greetings.length)]);
  }, [persona]);

  useEffect(() => {
    const saved = localStorage.getItem('gemini_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSessions(parsed);
        if (parsed.length > 0) setActiveSessionId(parsed[0].id);
      } catch (e) { console.error(e); }
    }
    const savedKey = localStorage.getItem('custom_gemini_api_key');
    if (savedKey) {
      setCustomApiKey(savedKey);
      GeminiService.customApiKey = savedKey;
    }
  }, []);

  const handleSaveApiKey = () => {
    GeminiService.customApiKey = customApiKey;
    localStorage.setItem('custom_gemini_api_key', customApiKey);
    setIsApiKeyModalOpen(false);
  };

  useEffect(() => {
    localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
  }, [sessions]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeSession?.messages, isLoading]);

  const createNewSession = () => {
    if (activeSession && activeSession.messages.length === 0) return;
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: persona === AIPersona.BUCIN ? 'Kenangan Manis ❤️' : 'Percakapan Baru',
      messages: [],
      createdAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setSelectedImage(null);
    setInputText('');
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Hapus history chat ini?")) return;
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
  };

  const clearCurrentChat = () => {
    if (!activeSessionId) return;
    if (!window.confirm("Bersihkan pesan di chat ini?")) return;
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [] } : s));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setSelectedImage(event.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePlayTTS = async (messageId: string, text: string) => {
    if (isSpeakingId === messageId) {
      currentSourceRef.current?.stop();
      setIsSpeakingId(null);
      return;
    }
    try {
      setIsSpeakingId(messageId);
      const base64Audio = await GeminiService.generateSpeech(text);
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const ctx = audioContextRef.current;
      const bytes = decode(base64Audio);
      const audioBuffer = await decodeAudioData(bytes, ctx, 24000, 1);
      if (currentSourceRef.current) currentSourceRef.current.stop();
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsSpeakingId(null);
      currentSourceRef.current = source;
      source.start();
    } catch (err) {
      console.error(err);
      setIsSpeakingId(null);
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handlePreviewCode = (code: string, lang: string) => {
    let finalCode = code;
    // If it's just JS, wrap it in basic HTML
    if (lang === 'javascript' || lang === 'js') {
      finalCode = `<html><body><script>${code}<\/script></body></html>`;
    } else if (lang === 'css') {
      finalCode = `<html><head><style>${code}</style></head><body><h1>CSS Preview Mode</h1></body></html>`;
    }
    setPreviewCode(finalCode);
    setIsPreviewOpen(true);
  };

  const handleStopGenerating = () => {
    abortRequestedRef.current = true;
    setIsLoading(false);
  };

  const renderMessageContent = (msgId: string, text: string, msgMode?: AIMode) => {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<div key={lastIndex} className="whitespace-pre-wrap">{text.substring(lastIndex, match.index)}</div>);
      }
      const lang = match[1] || 'code';
      const code = match[2].trim();
      const codeId = `${msgId}-code-${match.index}`;
      
      const isRunnable = ['html', 'javascript', 'js', 'css', 'react', 'jsx', 'tsx'].includes(lang.toLowerCase());
      
      parts.push(
        <div key={match.index} className="my-6 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl group/code">
          <div className="flex items-center justify-between px-5 py-3 bg-zinc-900/80 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 ml-2">{lang}</span>
            </div>
            <div className="flex items-center gap-2">
              {msgMode === AIMode.CODING && isRunnable && (
                <button 
                  onClick={() => handlePreviewCode(code, lang)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-blue-400 hover:text-white hover:bg-blue-600/20 transition-all border border-transparent hover:border-blue-500/30"
                >
                  <IconPlay className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold">Pertinjau</span>
                </button>
              )}
              <button 
                onClick={() => handleCopyText(codeId, code)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${copiedId === codeId ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
              >
                {copiedId === codeId ? <><IconCheck className="w-3.5 h-3.5" /> <span className="text-[10px] font-bold">Copied</span></> : <><IconCopy className="w-3.5 h-3.5" /> <span className="text-[10px] font-bold">Copy</span></>}
              </button>
            </div>
          </div>
          <div className="p-5 overflow-x-auto mono text-[13px] leading-relaxed text-blue-300">
            <pre><code>{code}</code></pre>
          </div>
        </div>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(<div key={lastIndex} className="whitespace-pre-wrap">{text.substring(lastIndex)}</div>);
    }

    return parts;
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !selectedImage) || isLoading) return;

    if (mode === AIMode.THINKING || mode === AIMode.CODING || mode === AIMode.IMAGE) {
      const isKeySelected = await GeminiService.checkApiKeySelection();
      if (!isKeySelected) await GeminiService.requestApiKeySelection();
    }

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: persona === AIPersona.BUCIN ? 'Kenangan Manis ❤️' : (inputText.slice(0, 30) || 'Image Analysis'),
        messages: [],
        createdAt: Date.now(),
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      currentSessionId = newSession.id;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      parts: [...(selectedImage ? [{ image: selectedImage }] : []), { text: inputText }],
      mode,
    };

    setSessions(prev => prev.map(s => 
      s.id === currentSessionId 
        ? { ...s, messages: [...s.messages, userMessage], title: s.messages.length === 0 ? (persona === AIPersona.BUCIN ? 'Cintaku ❤️' : (inputText.slice(0, 30) || 'Pesan Baru')) : s.title } 
        : s
    ));

    const promptText = inputText || (persona === AIPersona.BUCIN ? "Sayang, lihat ini... Brigita mau kamu liat..." : "Jelaskan gambar ini.");
    const imageToSubmit = selectedImage;
    setInputText('');
    setSelectedImage(null);
    setIsLoading(true);
    abortRequestedRef.current = false;

    try {
      if (mode === AIMode.IMAGE) {
        const imageUrl = await GeminiService.generateImage(promptText);
        const modelMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          parts: [{ text: persona === AIPersona.BUCIN ? "Spesial untukmu, Matahariku Terkasih! Brigita buatkan ini setulus hati cuma buat kamu... ❤️✨🌹" : "Generasi Gambar Berhasil:" , image: imageUrl }],
          mode,
          persona
        };
        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, modelMessage] } : s));
      } else {
        const history = activeSession?.messages.map(m => ({
          role: m.role,
          parts: m.parts.filter(p => p.text).map(p => ({ text: p.text! }))
        })) || [];

        const stream = GeminiService.streamText(promptText, mode, persona, history, imageToSubmit || undefined);
        const modelMessageId = (Date.now() + 1).toString();
        const modelMessage: Message = {
          id: modelMessageId,
          role: 'model',
          parts: [{ text: '' }],
          mode,
          persona,
          isThinking: mode === AIMode.THINKING,
          groundingLinks: []
        };

        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, modelMessage] } : s));

        let fullText = '';
        let displayedText = '';
        let groundingChunks: any[] = [];
        let isStreamActive = true;

        // Typing effect speed: Netral is fast (1ms), Brigita is medium (20ms)
        const typingDelay = 0; // Instant speed for all models

        // Function to run typing effect
        const runTypingEffect = async () => {
          while ((isStreamActive || displayedText.length < fullText.length) && !abortRequestedRef.current) {
            if (displayedText.length < fullText.length) {
              // Reveal characters faster by taking a larger chunk
              const remaining = fullText.length - displayedText.length;
              const step = remaining > 50 ? 20 : (remaining > 20 ? 10 : 5); 
              displayedText += fullText.slice(displayedText.length, displayedText.length + step);
              
              setSessions(prev => prev.map(s => 
                s.id === currentSessionId ? {
                  ...s,
                  messages: s.messages.map(m => m.id === modelMessageId ? {
                    ...m,
                    parts: [{ text: displayedText }],
                    groundingLinks: groundingChunks,
                    isThinking: false,
                  } : m)
                } : s
              ));
              // Use requestAnimationFrame for smoother updates instead of setTimeout if possible, 
              // but here we just use a minimal delay or 0.
              await new Promise(resolve => setTimeout(resolve, 0));
            } else {
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
        };

        const typingPromise = runTypingEffect();

        for await (const chunk of stream) {
          if (abortRequestedRef.current) break;
          if (chunk.text) fullText += chunk.text;
          const grounding = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (grounding) groundingChunks = [...groundingChunks, ...grounding];
        }

        isStreamActive = false;
        await typingPromise;
      }
    } catch (error: any) {
      if (abortRequestedRef.current) return;
      console.error(error);
      const errorStr = error.message || "";
      const is403 = errorStr.includes("403") || errorStr.includes("PERMISSION_DENIED");
      const is429 = errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED") || errorStr.includes("quota");
      
      let friendlyError = errorStr;
      if (is403) {
        friendlyError = "Akses ditolak. Silakan hubungkan API Key Anda melalui menu di pojok kanan atas.";
        setIsApiKeyModalOpen(true);
      }
      if (is429) {
        friendlyError = "Batas penggunaan (kuota) terlampaui. Hal ini biasanya terjadi karena penggunaan API gratis yang terbatas. Silakan periksa kuota Anda di Google Cloud Console atau ganti ke API Key dari proyek berbayar melalui ikon kunci di pojok kanan atas.";
        setIsApiKeyModalOpen(true);
      }

      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'model',
        parts: [{ 
          text: (persona === AIPersona.BUCIN ? "Sayang... Maaf ya sirkuit Brigita lagi lelah (Quota Terlampaui). Kamu bisa ganti API Key di atas ya biar kita bisa lanjut ngobrol... ❤️" : "Terjadi kesalahan: ") + friendlyError
        }],
      };
      
      setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [...s.messages, errorMessage] } : s));
    } finally {
      setIsLoading(false);
      abortRequestedRef.current = false;
    }
  };

  return (
    <div className={`flex h-screen overflow-hidden text-zinc-200 selection:bg-rose-500/30 selection:text-white transition-colors duration-500`} style={{ backgroundColor: config.theme.bg }}>
      <style>{`
        @keyframes rgb-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes floating {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
          100% { transform: translateY(0px); }
        }
        @keyframes brain-pulse {
          0% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.2); opacity: 1; filter: drop-shadow(0 0 15px #3b82f6); }
          100% { transform: scale(1); opacity: 0.8; }
        }
        @keyframes heart-pulse {
          0% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.3); opacity: 1; filter: drop-shadow(0 0 20px #f43f5e); }
          100% { transform: scale(1); opacity: 0.8; }
        }
        .animate-rgb-text {
          background: linear-gradient(90deg, #ff00ea, #00d2ff, #00ff95, #ffcc00, #ff00ea);
          background-size: 300% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: rgb-flow 5s linear infinite;
        }
        .animate-floating {
          animation: floating 4s ease-in-out infinite;
        }
        .animate-brain {
          animation: brain-pulse 2s ease-in-out infinite;
        }
        .animate-heart {
          animation: heart-pulse 1.5s ease-in-out infinite;
        }
        .ai-logo-glow {
          box-shadow: 0 0 50px ${config.theme.glow};
        }
        .typing-indicator span {
          height: 8px; width: 8px; float: left; margin: 0 1px;
          background-color: ${persona === AIPersona.BUCIN ? '#f43f5e' : '#3b82f6'};
          display: block; border-radius: 50%; opacity: 0.4;
        }
        .typing-indicator span:nth-of-type(1) { animation: bounce 1s infinite; }
        .typing-indicator span:nth-of-type(2) { animation: bounce 1s infinite 0.2s; }
        .typing-indicator span:nth-of-type(3) { animation: bounce 1s infinite 0.4s; }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .greeting-glow {
          text-shadow: 0 0 30px ${persona === AIPersona.BUCIN ? 'rgba(244, 63, 94, 0.6)' : 'rgba(59, 130, 246, 0.6)'};
        }
        .greeting-container {
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .bucin-bubble {
          border-image: linear-gradient(to right, #f43f5e, #ec4899) 1;
        }
      `}</style>

      <aside className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-zinc-950/80 backdrop-blur-xl border-r border-zinc-900 transition-all duration-300 flex flex-col overflow-hidden z-20`}>
        <div className="p-3 flex flex-col h-full">
          <button onClick={createNewSession} className="flex items-center gap-2 w-full p-3 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-all mb-6 text-xs font-bold group shadow-lg">
            <IconPlus className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform" /> {persona === AIPersona.BUCIN ? 'Kenangan Baru ❤️' : 'Chat Baru'}
          </button>
          <div className="flex-1 overflow-y-auto space-y-1 no-scrollbar">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3 px-2">{persona === AIPersona.BUCIN ? 'Memory Cinta Kita' : 'History Intelligence'}</p>
            {sessions.map(s => (
              <button key={s.id} onClick={() => setActiveSessionId(s.id)} className={`group flex items-center justify-between gap-3 w-full p-2.5 rounded-lg text-xs text-left transition-all ${activeSessionId === s.id ? 'bg-zinc-800/80 text-white shadow-lg border border-zinc-700/50' : 'hover:bg-zinc-900/50 text-zinc-500 hover:text-zinc-300'}`}>
                <span className="truncate flex-1 font-medium">{s.title}</span>
                <IconTrash className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 hover:text-red-500" onClick={(e) => deleteSession(s.id, e)} />
              </button>
            ))}
          </div>
          <div className="mt-auto pt-3 border-t border-zinc-900 flex items-center gap-2.5">
             <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${config.theme.welcomeGradient} flex items-center justify-center text-[10px] font-black shadow-lg`}>RA</div>
             <div className="text-[10px]">
                <p className="font-bold text-white uppercase tracking-tighter">RAFEN AI</p>
                <p className={`text-${config.theme.accent} font-mono font-bold uppercase`}>{config.name} Engine</p>
             </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] blur-[120px] rounded-full pointer-events-none -z-10 transition-colors duration-1000" style={{ backgroundColor: `${config.theme.glow}` }} />

        <header className="h-14 border-b border-zinc-900 flex items-center justify-between px-4 bg-zinc-950/20 backdrop-blur-2xl z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-500 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/></svg>
            </button>
            <div className="flex items-center gap-2">
              <span className="font-black text-xl tracking-tighter animate-rgb-text">{APP_NAME}</span>
              <div className="h-3 w-px bg-zinc-800 mx-1" />
              
              <div className="flex items-center gap-1 bg-zinc-900/50 p-0.5 rounded-lg border border-zinc-800">
                {[AIPersona.NETRAL, AIPersona.BUCIN].map(p => (
                  <button
                    key={p}
                    onClick={() => setPersona(p)}
                    className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${persona === p ? `bg-${PERSONA_CONFIG[p].theme.primary} text-white shadow-lg` : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {PERSONA_CONFIG[p].name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsApiKeyModalOpen(true)} 
              className="group relative p-2 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-500 hover:text-amber-400 transition-all shadow-lg overflow-hidden" 
              title="Masukan API Key (Opsional)"
            >
              <div className="absolute inset-0 bg-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <IconKey className="w-4 h-4 relative z-10 group-hover:scale-110 transition-transform" />
              <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-amber-500 rounded-full border border-zinc-950 animate-pulse" />
            </button>
            <button onClick={createNewSession} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold bg-white text-black hover:bg-zinc-200 rounded-lg transition-all shadow-xl"><IconPlus className="w-3.5 h-3.5" /> Baru</button>
            {activeSession && activeSession.messages.length > 0 && (
               <button onClick={clearCurrentChat} className="p-2 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 rounded-lg transition-all border border-transparent hover:border-red-500/20"><IconTrash className="w-3.5 h-3.5" /></button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 space-y-6 max-w-3xl mx-auto w-full pt-8 pb-36 relative no-scrollbar">
          {!activeSession || activeSession.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-8">
              <div className="relative group animate-floating">
                <div className={`absolute -inset-8 opacity-40 blur-[60px] rounded-full animate-pulse transition-colors duration-1000`} style={{ backgroundColor: config.theme.glow }} />
                <div className={`w-20 h-20 rounded-[1.5rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-2xl relative z-10 ai-logo-glow overflow-hidden transition-all duration-700 ${persona === AIPersona.BUCIN ? 'scale-110 border-rose-500/30' : ''}`}>
                   <div className={`absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-purple-500/10 ${persona === AIPersona.BUCIN ? 'from-rose-500/20 to-pink-500/20' : ''}`} />
                   {persona === AIPersona.BUCIN ? (
                     <div className="animate-heart text-3xl">❤️</div>
                   ) : (
                     <span className="text-3xl font-black italic tracking-tighter animate-rgb-text">AI</span>
                   )}
                </div>
              </div>
              <div className="space-y-4 max-w-3xl px-4 greeting-container">
                <h1 className="text-2xl sm:text-4xl font-black tracking-tighter animate-rgb-text mb-4">{persona === AIPersona.BUCIN ? 'Brigita <3' : APP_NAME}</h1>
                <div className="relative inline-block">
                   <div className={`absolute -inset-6 bg-gradient-to-r ${persona === AIPersona.BUCIN ? 'from-rose-500/30 to-pink-500/30' : 'from-blue-500/30 to-indigo-500/30'} blur-2xl opacity-40 rounded-full animate-pulse`} />
                   <p key={currentGreeting} className={`relative text-white text-xl sm:text-3xl font-bold tracking-tight leading-snug animate-in fade-in slide-in-from-bottom-8 duration-1000 greeting-glow ${persona === AIPersona.BUCIN ? 'font-greeting-bucin text-rose-100' : 'font-greeting-netral uppercase tracking-widest text-zinc-100'}`}>
                     {currentGreeting}
                   </p>
                </div>
                <div className={`h-0.5 w-24 bg-gradient-to-r from-transparent ${persona === AIPersona.BUCIN ? 'via-rose-900/40' : 'via-zinc-800'} to-transparent mx-auto mt-8 opacity-60`} />
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
            {activeSession.messages.map((msg, i) => (
              <motion.div 
                key={msg.id} 
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`relative max-w-[90%] sm:max-w-[85%] rounded-[1.25rem] p-3.5 sm:p-4 ${msg.role === 'user' ? 'bg-[#18181b] text-white shadow-2xl border border-zinc-800' : (persona === AIPersona.BUCIN ? 'bg-rose-950/20 backdrop-blur-md border border-rose-500/20 shadow-[0_0_30px_rgba(244,63,94,0.1)]' : 'bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 shadow-xl')} space-y-2.5 group/msg`}>
                  
                  {/* Action Buttons */}
                  <div className="absolute -top-2.5 right-3 flex gap-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    {msg.role === 'model' && (
                      <button 
                        onClick={() => handlePlayTTS(msg.id, msg.parts.map(p => p.text || '').join(' '))} 
                        className={`p-1.5 rounded-lg transition-all ${isSpeakingId === msg.id ? 'bg-blue-600 text-white animate-pulse' : 'bg-zinc-800 text-zinc-400 hover:text-white'} border border-zinc-700 shadow-2xl`}
                        title="Dengarkan Suara"
                      >
                        <IconSpeaker className="w-3 h-3" />
                      </button>
                    )}
                    <button 
                      onClick={() => handleCopyText(msg.id, msg.parts.map(p => p.text || '').join(' '))} 
                      className={`p-1.5 rounded-lg transition-all border border-zinc-700 shadow-2xl ${copiedId === msg.id ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'} shadow-2xl transition-all`}
                      title="Salin Pesan"
                    >
                      {copiedId === msg.id ? <IconCheck className="w-3 h-3" /> : <IconCopy className="w-3 h-3" />}
                    </button>
                  </div>

                  {msg.isThinking && (
                    <div className="flex flex-col gap-2.5 py-1">
                       <div className="flex items-center gap-2.5 bg-blue-500/10 border border-blue-500/20 px-3.5 py-2 rounded-lg">
                        <div className="p-1 bg-blue-500/20 rounded-md animate-brain">
                           <IconBrain className="w-4 h-4 text-blue-400" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-blue-400 text-[9px] font-black uppercase tracking-widest">RAFEN DeepThinking Protocol</span>
                          <span className="text-zinc-500 text-[7px] font-bold uppercase tracking-widest">Sirkuit Neural Aktif...</span>
                        </div>
                      </div>
                      <div className="typing-indicator scale-75 origin-left ml-2"><span></span><span></span><span></span></div>
                    </div>
                  )}
                  {msg.parts.map((part, idx) => (
                    <div key={idx} className="space-y-2.5">
                      {part.image && (
                        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black shadow-2xl">
                          <img src={part.image} alt="Generated" className="w-full h-auto object-contain hover:scale-105 transition-transform duration-1000" />
                        </div>
                      )}
                      {part.text && (
                        <div className={`prose prose-invert max-w-none leading-relaxed text-[13px] font-medium selection:bg-rose-500/40 ${persona === AIPersona.BUCIN && msg.role === 'model' ? 'text-rose-100 font-serif' : 'text-zinc-200'}`}>
                          {renderMessageContent(msg.id, part.text, msg.mode)}
                        </div>
                      )}
                    </div>
                  ))}
                  {msg.groundingLinks && msg.groundingLinks.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-zinc-800/50 space-y-2">
                      <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5"><IconSearch className="w-3 h-3" /> Intelligence Sources</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.groundingLinks.map((link, idx) => link.web && (
                          <a key={idx} href={link.web.uri} target="_blank" rel="noreferrer" className="text-[10px] bg-zinc-900 hover:bg-zinc-800 text-blue-400 px-2.5 py-1 rounded-lg border border-zinc-800 transition-all font-bold shadow-sm">{link.web.title || new URL(link.web.uri).hostname}</a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            </AnimatePresence>
          )}
          
          {isLoading && !activeSession?.messages[activeSession.messages.length - 1]?.isThinking && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className={`${persona === AIPersona.BUCIN ? 'bg-rose-950/20 border-rose-500/20' : 'bg-zinc-900/40 border-zinc-800/50'} backdrop-blur-md border rounded-[1.5rem] p-5 space-y-2`}>
                 <div className="flex items-center gap-2.5 text-zinc-400 text-[9px] font-black uppercase tracking-widest">
                    {persona === AIPersona.BUCIN ? (
                       <div className="animate-heart text-base">❤️</div>
                    ) : (
                       <IconBrain className="w-4 h-4 text-blue-400/50" />
                    )}
                    <span>{persona === AIPersona.BUCIN ? "Brigita sedang ngetik buat kamu... ❤️" : "Sedang berpikir..."}</span>
                 </div>
                 <div className="typing-indicator scale-75 origin-left">
                    <span></span>
                    <span></span>
                    <span></span>
                 </div>
              </div>
            </motion.div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* API Key Modal */}
        {isApiKeyModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-md bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg text-white">Custom API Key</h3>
                <button onClick={() => setIsApiKeyModalOpen(false)} className="text-zinc-500 hover:text-white"><IconX className="w-5 h-5" /></button>
              </div>
              <p className="text-xs text-zinc-400">Masukkan Gemini API Key Anda sendiri untuk melewati batasan kuota gratis. Key ini akan disimpan secara lokal di browser Anda.</p>
              <input 
                type="password" 
                value={customApiKey} 
                onChange={(e) => setCustomApiKey(e.target.value)} 
                placeholder="Paste your API Key here..." 
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              />
              <div className="flex gap-3 pt-2">
                <button onClick={() => setIsApiKeyModalOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all">Batal</button>
                <button onClick={handleSaveApiKey} className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-all shadow-lg">Simpan Key</button>
              </div>
              <div className="pt-4 border-t border-zinc-800 text-center">
                <button onClick={() => { GeminiService.requestApiKeySelection(); setIsApiKeyModalOpen(false); }} className="text-[10px] text-zinc-500 hover:text-blue-400 underline">Atau gunakan Google AI Studio Selector</button>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {isPreviewOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-10 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full h-full max-w-6xl bg-zinc-900 rounded-[2rem] border border-zinc-800 shadow-[0_0_100px_rgba(59,130,246,0.3)] overflow-hidden flex flex-col relative">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/20 rounded-xl text-blue-400">
                    <IconPlay className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg uppercase tracking-widest animate-rgb-text">Live Preview Engine</h3>
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em]">RAFEN AI Sandbox • v1.2</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-3 bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 rounded-xl transition-all border border-zinc-700 shadow-xl"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 bg-white relative">
                 <iframe 
                    title="Code Preview"
                    srcDoc={previewCode || ''}
                    sandbox="allow-scripts"
                    className="w-full h-full border-none"
                 />
              </div>
              <div className="px-6 py-3 bg-zinc-950 text-center border-t border-zinc-800">
                 <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.5em]">Mode Pertinjau Aktif • Kode dijalankan dalam sandbox aman</p>
              </div>
            </div>
          </div>
        )}

        <div className="fixed bottom-0 left-0 right-0 lg:left-64 p-4 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent pointer-events-none z-10">
          <div className="max-w-4xl mx-auto pointer-events-auto space-y-4">
            <div className="flex justify-center">
              <div className="flex items-center gap-1.5 bg-zinc-950/80 backdrop-blur-3xl p-1 rounded-xl border border-zinc-800/50 shadow-2xl overflow-x-auto no-scrollbar">
                {[
                  { id: AIMode.FAST, icon: IconBolt, label: 'Fast' },
                  { id: AIMode.THINKING, icon: IconBrain, label: 'Deep' },
                  { id: AIMode.SEARCH, icon: IconSearch, label: 'Search' },
                  { id: AIMode.IMAGE, icon: IconImage, label: 'Nano Pro' },
                  { id: AIMode.CODING, icon: IconCode, label: 'Coding' },
                ].map(m => (
                  <button key={m.id} onClick={() => setMode(m.id)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all duration-300 ${mode === m.id ? 'bg-zinc-900 text-blue-400 shadow-xl border border-zinc-800 scale-105' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}>
                    <m.icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative group">
              <div className={`absolute -inset-0.5 bg-gradient-to-r ${mode === AIMode.THINKING ? 'from-blue-600 to-indigo-600' : mode === AIMode.IMAGE ? 'from-purple-600 to-pink-600' : mode === AIMode.CODING ? 'from-emerald-600 to-cyan-500' : (persona === AIPersona.BUCIN ? 'from-rose-500 to-pink-500' : 'from-zinc-800 to-zinc-700')} rounded-2xl blur-xl opacity-20 group-focus-within:opacity-50 transition duration-700`}></div>
              <div className={`relative bg-zinc-950/80 border ${persona === AIPersona.BUCIN ? 'border-rose-500/30 shadow-[0_0_50px_rgba(244,63,94,0.2)]' : 'border-zinc-800'} rounded-2xl shadow-2xl overflow-hidden focus-within:border-zinc-700 transition-all backdrop-blur-3xl`}>
                {selectedImage && (
                  <div className="px-4 pt-4 pb-0">
                    <div className={`relative w-20 h-20 rounded-xl overflow-hidden border ${persona === AIPersona.BUCIN ? 'border-rose-500/30' : 'border-zinc-800'} group/img shadow-2xl`}>
                      <img src={selectedImage} className="w-full h-full object-cover" />
                      <button onClick={() => setSelectedImage(null)} className="absolute top-1 right-1 bg-black/60 p-1 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity"><IconX className="w-2.5 h-2.5 text-white" /></button>
                    </div>
                  </div>
                )}
                <div className="flex items-end gap-2 p-2 pl-4">
                  <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
                  <button onClick={() => fileInputRef.current?.click()} className={`p-3 text-zinc-500 hover:text-blue-400 hover:bg-zinc-900 rounded-xl transition-all ${persona === AIPersona.BUCIN ? 'hover:text-rose-400' : ''}`}><IconClip className="w-4 h-4" /></button>
                  <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={mode === AIMode.IMAGE ? "Gambarkan mahakarya dengan Nano Banana Pro 4K..." : persona === AIPersona.BUCIN ? "Katakan apa saja, Sayangku... Brigita dengerin kok... ❤️" : "Tanyakan apa saja..."} className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-200 placeholder-zinc-700 py-3 resize-none max-h-32 min-h-[44px] text-[14px] font-medium" rows={1} style={{ height: 'auto', minHeight: '44px' }} />
                  
                  {isLoading ? (
                    <button 
                      onClick={handleStopGenerating} 
                      className={`p-3 rounded-xl transition-all flex items-center justify-center min-w-[48px] shadow-2xl bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-500/20 group/stop`}
                      title="Berhenti Mengirim"
                    >
                      <IconSquare className="w-4 h-4 group-hover/stop:scale-110 transition-transform" />
                    </button>
                  ) : (
                    <button 
                      onClick={handleSendMessage} 
                      disabled={(!inputText.trim() && !selectedImage)} 
                      className={`p-3 rounded-xl transition-all flex items-center justify-center min-w-[48px] shadow-2xl ${(!inputText.trim() && !selectedImage) ? 'text-zinc-700 bg-zinc-900' : (persona === AIPersona.BUCIN ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-white text-black hover:bg-zinc-200')} active:scale-95`}
                    >
                      <IconSend className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="text-center text-[9px] text-zinc-700 font-black uppercase tracking-[0.4em] pb-1">{APP_NAME} ULTRA ENGINE • v4.2 • {config.name} Mode active</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
