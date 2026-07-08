
import React, { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../services/geminiService';
import { ChatMessage } from '../types';
import { Send, Sparkles, Loader2, X, Mic, Volume2, VolumeX } from 'lucide-react';
import { startListening, stopListening, speak, stopSpeaking } from '../services/speechService';

interface AIChatProps {
    onClose?: () => void;
}

const AIChat: React.FC<AIChatProps> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: `Greetings. I am Bes. Need help choosing a song? Want to generate lyrics? Or looking for practice tips? I am here to guide your guitar journey.`,
      timestamp: Date.now()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceRepliesRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Convert to simplified history for service
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const responseText = await sendChatMessage(userMsg.text, history);

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, botMsg]);
      // Read Bes's reply aloud when voice replies are enabled.
      if (voiceRepliesRef.current) speak(responseText, 1.0);
    } catch (error) {
      console.error("Chat error", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Voice input: dictate a question, then auto-send it.
  const handleVoiceInput = () => {
    if (isListening) {
      stopListening();
      setIsListening(false);
      return;
    }
    startListening(
      'en-US',
      (transcript) => { setInput(transcript); handleSend(transcript); },
      () => setIsListening(false),
      () => setIsListening(true),
      () => setIsListening(false),
    );
  };

  const toggleVoiceReplies = () => {
    setVoiceReplies(prev => {
      const next = !prev;
      voiceRepliesRef.current = next;
      if (!next) stopSpeaking();
      return next;
    });
  };

  // Auto-start listening when opened via the assistant's voice shortcut,
  // and always clean up speech resources on unmount.
  useEffect(() => {
    let autoListen = false;
    try {
      autoListen = sessionStorage.getItem('plectrum_chat_autolisten') === '1';
      if (autoListen) sessionStorage.removeItem('plectrum_chat_autolisten');
    } catch { /* ignore */ }
    if (autoListen) handleVoiceInput();
    return () => { stopListening(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderMessageContent = (text: string, isUser: boolean) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.trim();
      
      // Handle Lists (bullets)
      if (trimmed.match(/^[-*]\s/)) {
         const content = trimmed.replace(/^[-*]\s/, '');
         return (
             <div key={i} className="flex items-start gap-2 ml-1 mb-1">
                 <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 opacity-80 ${isUser ? 'bg-white' : 'bg-amber-500'}`} />
                 <span className="leading-relaxed">{renderInlineStyles(content, isUser)}</span>
             </div>
         );
      }
      
      // Handle Numbered Lists
      if (trimmed.match(/^\d+\.\s/)) {
        const match = trimmed.match(/^(\d+)\.\s(.*)/);
        if (match) {
            return (
                <div key={i} className="flex items-start gap-2 ml-1 mb-1">
                    <span className={`font-bold mt-0.5 text-xs ${isUser ? 'text-indigo-200' : 'text-amber-500'}`}>{match[1]}.</span>
                    <span className="leading-relaxed">{renderInlineStyles(match[2], isUser)}</span>
                </div>
            );
        }
      }
      
      // Handle Headers
      if (trimmed.startsWith('###')) {
          return <h4 key={i} className={`text-sm font-bold mt-3 mb-1 uppercase tracking-wider ${isUser ? 'text-white' : 'text-amber-200'}`}>{renderInlineStyles(trimmed.replace(/^###\s+/, ''), isUser)}</h4>;
      }
      if (trimmed.startsWith('##')) {
          return <h3 key={i} className={`text-base font-bold mt-4 mb-2 ${isUser ? 'text-white' : 'text-amber-100'}`}>{renderInlineStyles(trimmed.replace(/^##\s+/, ''), isUser)}</h3>;
      }

      // Empty lines
      if (!trimmed) return <div key={i} className="h-2" />;

      // Standard Lines
      return <div key={i} className={`mb-1 leading-relaxed ${isUser ? 'text-indigo-50' : 'text-amber-100'}`}>{renderInlineStyles(line, isUser)}</div>;
    });
  };

  const renderInlineStyles = (text: string, isUser: boolean) => {
      // Split by bold syntax (**text**)
      const parts = text.split(/(\*\*.*?\*\*)/g);
      return parts.map((part, index) => {
          if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={index} className={isUser ? "font-bold text-white border-b border-white/20" : "font-bold text-amber-400"}>{part.slice(2, -2)}</strong>;
          }
          // Simple Italic (*text*)
          const subParts = part.split(/(\*.*?\*)/g);
          return subParts.map((sub, subIndex) => {
              if (sub.startsWith('*') && sub.endsWith('*') && sub.length > 2) {
                  return <em key={`${index}-${subIndex}`} className={isUser ? "italic text-indigo-200" : "italic text-amber-200/70"}>{sub.slice(1, -1)}</em>;
              }
              return sub;
          });
      });
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 md:p-6">
      <div className="bg-slate-800 rounded-2xl shadow-xl flex-1 flex flex-col overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="p-4 border-b border-slate-700 bg-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center border-2 border-amber-400/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
                <h2 className="text-white font-bold text-lg font-display tracking-wide">Bes</h2>
                <p className="text-xs text-amber-400/80">Deity of Music • AI Luthier</p>
            </div>
          </div>
          {onClose && (
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
              </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-900/50">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div 
                className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-br-none shadow-lg shadow-indigo-500/10' 
                    : 'bg-[#2d1b15] text-amber-100 rounded-bl-none border border-[#5d4037] shadow-lg'
                }`}
              >
                <div className="text-sm">
                    {renderMessageContent(msg.text, msg.role === 'user')}
                </div>
                <div className={`text-[10px] mt-2 opacity-50 text-right ${msg.role === 'user' ? 'text-indigo-100' : 'text-amber-400'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-[#2d1b15] rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2 border border-[#5d4037]">
                <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                <span className="text-xs text-amber-500/80">Bes is listening...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 bg-slate-800 border-t border-slate-700">
          <div className="flex items-center gap-2">
            {/* Voice input (dictate a question) */}
            <button
              onClick={handleVoiceInput}
              aria-label={isListening ? 'Stop listening' : 'Ask with your voice'}
              title={isListening ? 'Listening… tap to stop' : 'Ask with your voice'}
              className={`shrink-0 p-3 rounded-xl border transition-colors shadow-lg ${
                isListening
                  ? 'bg-red-600 border-red-400 text-white animate-pulse'
                  : 'bg-slate-900 border-slate-700 text-amber-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Mic className="w-5 h-5" />
            </button>
            {/* Speak replies toggle */}
            <button
              onClick={toggleVoiceReplies}
              aria-label={voiceReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
              title={voiceReplies ? 'Spoken replies on' : 'Spoken replies off'}
              className={`shrink-0 p-3 rounded-xl border transition-colors shadow-lg ${
                voiceReplies
                  ? 'bg-amber-600 border-amber-400 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {voiceReplies ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={isListening ? 'Listening…' : 'Ask Bes about chords, lyrics, or musical wisdom...'}
                className="w-full bg-slate-900 border border-slate-700 text-white pl-4 pr-12 py-3 rounded-xl focus:ring-2 focus:ring-amber-500/50 focus:border-transparent outline-none transition-all placeholder-slate-500"
              />
              <button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim()}
                className="absolute right-2 top-2 p-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors shadow-lg"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChat;
