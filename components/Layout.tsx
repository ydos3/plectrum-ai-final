
import React, { useState, useEffect } from 'react';
import { MessageSquare, Image as ImageIcon, PlusCircle, Search, Menu, X, BookOpen, LogOut, User as UserIcon, Guitar, Globe, Video, HelpCircle, ChevronRight, ChevronLeft, Sparkles, Hand, Users } from 'lucide-react';
import { cloudSyncEnabled } from '../services/authClient';
import { ViewState, User, AppLanguage } from '../types';
import { playLogoChord, playNavChord } from '../services/audioService';
import { logout } from '../services/authService';
import PlectrumLogo from './PlectrumLogo';
import FloatingAssistant from './FloatingAssistant';
import CloudSyncPanel from './CloudSyncPanel';
import { warmUpHandTracker } from '../services/handTracking';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  changeView: (view: ViewState) => void;
  user: User | null;
  selectedLanguage: AppLanguage;
  onLanguageChange: (lang: AppLanguage) => void;
  showTour: boolean;
  onCloseTour: () => void;
}

const SUPPORTED_LANGUAGES: AppLanguage[] = [
  'English', 'Hindi', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Urdu', 'Gujarati', 'Kannada', 'Malayalam', 'Odia', 'Punjabi', 'Assamese', 'Maithili'
];

interface TourStep {
  title: string;
  text: string;
  view?: ViewState;
  highlightId?: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const Layout: React.FC<LayoutProps> = ({ children, currentView, changeView, user, selectedLanguage, onLanguageChange, showTour, onCloseTour }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isStrumming, setIsStrumming] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  // Account/settings drawer (language, cloud sign-in, sign out, legal) collapsed
  // by default so the nav features get the space and are always visible.
  const [showSettings, setShowSettings] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('plectrum_nav_collapsed') === '1'; } catch { return false; }
  });

  const toggleNavCollapsed = () => setNavCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('plectrum_nav_collapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  // Tour State
  const [tourStep, setTourStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const TOUR_STEPS: TourStep[] = [
    {
      title: "Yo, Welcome to Plectrum",
      text: "I'm Bes, your AI roadie and luthier. I'm here to help you cook up some hits. Let's take a quick spin around the studio.",
      position: 'center'
    },
    {
      title: "The Lab (Composer)",
      text: "This is where the magic happens. Type a song name, or tap the Magic Mic to just say what you want to play.",
      view: 'EDITOR',
      highlightId: 'tour-composer-tools',
      position: 'bottom'
    },
    {
      title: "Mashup Mode",
      text: "Feeling adventurous? Type 'Song A, Song B' and we'll fuse them into a brand new track. No cap.",
      view: 'EDITOR',
      highlightId: 'tour-magic-input',
      position: 'bottom'
    },
    {
      title: "Practice Room",
      text: "Record your sessions privately. The camera stays off until you hit record. Perfect your craft before you stream it.",
      view: 'PRACTICE_ROOM',
      highlightId: 'tour-record-btn',
      position: 'top'
    },
    {
      title: "Fretboard Logic",
      text: "Visual learner? See exactly where to put your fingers for any chord or scale on this interactive neck.",
      view: 'FRETBOARD_LAB',
      highlightId: 'tour-fretboard',
      position: 'bottom'
    },
    {
      title: "Chord Quiz",
      text: "Train your ears. Listen to the chord and guess the shape. It's like the gym for your musical hearing.",
      view: 'CHORD_TRAINER',
      position: 'center'
    },
    {
      title: "Tab Scanner",
      text: "Got handwritten notes on a napkin? Snap a pic, and I'll digitize them into playable tabs instantly.",
      view: 'ANALYZER',
      position: 'center'
    },
    {
      title: "The Vault (Library)",
      text: "All your saved masterpieces live here. Search, edit, or print them out for the gig.",
      view: 'LIBRARY',
      position: 'center'
    }
  ];

  useEffect(() => {
    if (showTour) {
      const step = TOUR_STEPS[tourStep];

      // Switch View if needed
      if (step.view && step.view !== currentView) {
        changeView(step.view);
      }

      // Find Highlight Element
      if (step.highlightId) {
        // Slight delay to allow render
        setTimeout(() => {
          const el = document.getElementById(step.highlightId!);
          if (el) {
            setHighlightRect(el.getBoundingClientRect());
          } else {
            setHighlightRect(null);
          }
        }, 600);
      } else {
        setHighlightRect(null);
      }
    }
  }, [tourStep, showTour, currentView]);

  const handleNextTourStep = () => {
    if (tourStep < TOUR_STEPS.length - 1) {
      setTourStep(prev => prev + 1);
    } else {
      onCloseTour();
      setTourStep(0);
    }
  };

  const handleLogoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsStrumming(true);
    playLogoChord();
    setTimeout(() => setIsStrumming(false), 300);
  };

  const handleLogout = () => {
    logout();
    window.location.reload();
  };

  const NavItem = ({ view, icon: Icon, label, soundIndex, id, onIntent }: { view: ViewState, icon: any, label: string, soundIndex: number, id?: string, onIntent?: () => void }) => {
    return (
      <button
        id={id}
        onClick={(e) => {
          e.stopPropagation();
          playNavChord(soundIndex);
          changeView(view);
          setIsMobileMenuOpen(false);
        }}
        // Prefetch heavy assets on intent (hover / touch / keyboard focus) so the
        // destination is warm by the time it opens — e.g. Air Strum's hand model.
        onMouseEnter={onIntent}
        onFocus={onIntent}
        onTouchStart={onIntent}
        className={`flex items-center w-full px-4 py-3 mb-2 rounded-lg group transition-all duration-300 relative ${currentView === view
            ? 'bg-gradient-to-r from-amber-700/90 to-amber-800/80 text-amber-50 shadow-lg border border-amber-600/50 translate-x-1'
            : 'text-amber-200/60 hover:bg-amber-900/40 hover:text-amber-100 hover:translate-x-1'
          }`}
      >
        <Icon className={`w-5 h-5 mr-3 transition-transform group-hover:scale-110 ${currentView === view ? 'text-amber-300' : 'text-amber-600'}`} />
        <span className="font-medium tracking-wide font-sans">{label}</span>
      </button>
    );
  };

  const isImmersiveMode = currentView === 'PRACTICE_ROOM';

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#0a0503]">
      {/* Collapsed-sidebar expand handle (desktop) */}
      {!isImmersiveMode && navCollapsed && (
        <button
          onClick={toggleNavCollapsed}
          aria-label="Expand sidebar"
          title="Expand menu"
          className="hidden md:flex fixed top-4 left-4 z-40 w-10 h-10 items-center justify-center rounded-xl bg-[#2d1b15]/90 border border-[#5d4037] text-amber-300 hover:text-white hover:bg-[#3e2723] shadow-xl backdrop-blur"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Sidebar - Desktop (Hidden in Practice Room / when collapsed) */}
      {!isImmersiveMode && !navCollapsed && (
        <aside className="hidden md:flex flex-col w-72 border-r border-[#5d4037] bg-[#2d1b15] shadow-2xl relative z-20 shrink-0">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-20 pointer-events-none"></div>

          {/* Collapse toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleNavCollapsed(); }}
            aria-label="Collapse sidebar"
            title="Collapse menu"
            className="absolute top-3 right-3 z-30 w-8 h-8 flex items-center justify-center rounded-lg text-amber-500/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* Logo Section — compact row so the nav gets the vertical space */}
          <div className="flex items-center gap-2.5 px-4 py-3 pr-11 border-b border-[#5d4037] relative z-10 bg-[#1a0f0a]/60 cursor-pointer group select-none" onClick={handleLogoClick}>
            <PlectrumLogo className={`w-9 h-9 shrink-0 transition-transform duration-100 ${isStrumming ? 'scale-95 rotate-1' : 'group-hover:scale-110'}`} animate={isStrumming} />
            <h1 className="font-cursive text-3xl text-amber-100 leading-none text-shadow-lg">Plectrum</h1>
          </div>

          <nav className="flex-1 px-4 py-4 overflow-y-auto relative z-10 custom-scrollbar">
            <div className="mb-5">
              <h3 className="px-4 text-[10px] font-black text-amber-800 uppercase tracking-widest mb-2.5 flex items-center gap-2 font-display">
                <span className="w-6 h-[1px] bg-amber-800/50"></span>
                Collections
              </h3>
              <NavItem id="nav-library" view="LIBRARY" icon={Search} label="Song Library" soundIndex={0} />
              <NavItem id="nav-composer" view="EDITOR" icon={PlusCircle} label="Composer" soundIndex={1} />
            </div>

            <div className="mb-5">
              <h3 className="px-4 text-[10px] font-black text-amber-800 uppercase tracking-widest mb-2.5 flex items-center gap-2 font-display">
                <span className="w-6 h-[1px] bg-amber-800/50"></span>
                Studio
              </h3>
              <NavItem id="nav-practice" view="PRACTICE_ROOM" icon={Video} label="Practice Room" soundIndex={3} />
              <NavItem id="nav-fretboard" view="FRETBOARD_LAB" icon={Guitar} label="Fretboard Lab" soundIndex={2} />
              <NavItem id="nav-airstrum" view="AIR_STRUM" icon={Hand} label="Air Strum" soundIndex={2} onIntent={warmUpHandTracker} />
              <NavItem view="CHORD_TRAINER" icon={BookOpen} label="Chord Quiz" soundIndex={3} />
              <NavItem view="ANALYZER" icon={ImageIcon} label="Tab Scanner" soundIndex={0} />
              <NavItem view="CHAT" icon={MessageSquare} label="Bes (Guide)" soundIndex={1} />
              {cloudSyncEnabled() && <NavItem view="CONNECTIONS" icon={Users} label="Connections" soundIndex={2} />}
            </div>
          </nav>

          <div className="border-t border-[#5d4037] relative z-10 bg-[#1a0f0a]/50">
            {/* Account row — always visible (just the name); taps to expand settings. */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowSettings(s => !s); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
              aria-expanded={showSettings}
              title={showSettings ? 'Hide account & settings' : 'Account & settings'}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-600 to-amber-800 border border-amber-900/50 flex items-center justify-center shrink-0">
                <UserIcon className="w-4 h-4 text-amber-100" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-100 truncate">{user?.name || 'Guest'}</p>
                <p className="text-[9px] text-amber-500/80 truncate font-medium">Account &amp; settings</p>
              </div>
              <ChevronRight className={`w-4 h-4 text-amber-500/70 shrink-0 transition-transform ${showSettings ? '-rotate-90' : 'rotate-90'}`} />
            </button>

            {/* Collapsible drawer: language, cloud sign-in/sync, sign out, legal. */}
            {showSettings && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[#5d4037]/50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                {/* Language Selector */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowLangMenu(!showLangMenu); }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#3e2723] text-amber-200 text-xs font-bold border border-[#5d4037]"
                  >
                    <div className="flex items-center gap-2">
                      <Globe className="w-3 h-3" /> {selectedLanguage}
                    </div>
                    <div className="text-[9px] text-amber-500">▼</div>
                  </button>

                  {showLangMenu && (
                    <div className="absolute bottom-full left-0 w-full bg-[#1a0f0a] border border-[#5d4037] rounded-lg max-h-48 overflow-y-auto shadow-xl z-50 mb-1">
                      {SUPPORTED_LANGUAGES.map(lang => (
                        <button
                          key={lang}
                          onClick={() => { onLanguageChange(lang); setShowLangMenu(false); }}
                          className="w-full text-left px-3 py-2 text-xs text-amber-200 hover:bg-[#2d1b15] hover:text-white"
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optional cloud sync — renders nothing unless VITE_CLOUD_SYNC is on. */}
                <CloudSyncPanel />

                <button onClick={(e) => { e.stopPropagation(); handleLogout(); }} className="w-full flex items-center justify-center gap-2 text-xs text-amber-600 hover:text-red-400 transition-colors">
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-amber-700/80 no-global-click">
                  <a href="/terms/" className="hover:text-amber-300 transition-colors">Terms</a>
                  <a href="/privacy/" className="hover:text-amber-300 transition-colors">Privacy</a>
                  <a href="/copyright/" className="hover:text-amber-300 transition-colors">Copyright</a>
                  <a href="/ai-disclosure/" className="hover:text-amber-300 transition-colors">AI Disclosure</a>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Mobile Header (Hidden in Practice Room) */}
      {!isImmersiveMode && (
        <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#3e2723] border-b border-[#5d4037] flex items-center justify-between px-4 z-50 shadow-lg">
          <div className="flex items-center gap-2 text-amber-500 overflow-visible px-2" onClick={handleLogoClick}>
            <PlectrumLogo className="w-8 h-8" />
            <span className="font-cursive text-3xl text-amber-100 pb-1 px-1">Plectrum</span>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(true); }} className="text-amber-400 p-2">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-[#2d1b15]/98 backdrop-blur-md md:hidden flex flex-col p-6 animate-in slide-in-from-right duration-300 overflow-y-auto">
          <div className="flex justify-end mb-8">
            <button onClick={() => setIsMobileMenuOpen(false)} className="text-amber-400 p-2">
              <X className="w-8 h-8" />
            </button>
          </div>

          <div className="mb-6">
            <label className="text-[10px] uppercase font-bold text-amber-600 mb-2 block">App Language</label>
            <select
              value={selectedLanguage}
              onChange={(e) => onLanguageChange(e.target.value as AppLanguage)}
              className="w-full bg-[#1a0f0a] text-amber-100 p-3 rounded-lg border border-[#5d4037] outline-none"
            >
              {SUPPORTED_LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>

          <nav className="space-y-3">
            <NavItem view="LIBRARY" icon={Search} label="Song Library" soundIndex={0} />
            <NavItem view="EDITOR" icon={PlusCircle} label="Composer" soundIndex={1} />
            <NavItem view="PRACTICE_ROOM" icon={Video} label="Practice Room" soundIndex={3} />
            <NavItem view="FRETBOARD_LAB" icon={Guitar} label="Fretboard Lab" soundIndex={2} />
            <NavItem view="AIR_STRUM" icon={Hand} label="Air Strum" soundIndex={2} onIntent={warmUpHandTracker} />
            <NavItem view="CHORD_TRAINER" icon={BookOpen} label="Chord Quiz" soundIndex={3} />
            <NavItem view="ANALYZER" icon={ImageIcon} label="Tab Scanner" soundIndex={0} />
            <NavItem view="CHAT" icon={MessageSquare} label="Bes (Guide)" soundIndex={1} />
            {cloudSyncEnabled() && <NavItem view="CONNECTIONS" icon={Users} label="Connections" soundIndex={2} />}
            <button onClick={handleLogout} className="w-full py-4 text-amber-500 flex items-center justify-center gap-2 border-t border-amber-900/50 mt-8">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-4 text-[11px] text-amber-700 no-global-click">
              <a href="/terms/" className="hover:text-amber-300">Terms</a>
              <a href="/privacy/" className="hover:text-amber-300">Privacy</a>
              <a href="/copyright/" className="hover:text-amber-300">Copyright</a>
              <a href="/ai-disclosure/" className="hover:text-amber-300">AI Disclosure</a>
            </div>
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className={`flex-1 overflow-auto relative ${!isImmersiveMode ? 'md:static pt-16 md:pt-0' : ''} bg-[#3e2723]/30 h-full w-full`}>
        {/* Top Right Logo Watermark - Only visible in Library */}
        <div className={`absolute top-4 right-4 z-40 hidden md:block transition-all duration-300 cursor-pointer pointer-events-none ${currentView === 'LIBRARY' ? 'opacity-80 hover:opacity-100' : 'opacity-0 scale-90'}`}>
          <PlectrumLogo className="w-10 h-10" />
        </div>
        {children}
      </main>

      {/* Floating Assistant - draggable, translucent, logo icon + voice.
          Hidden in Fretboard Lab, Practice Room and Air Strum. */}
      {currentView !== 'CHAT' && currentView !== 'FRETBOARD_LAB' && currentView !== 'PRACTICE_ROOM' && currentView !== 'AIR_STRUM' && !showTour && (
        <FloatingAssistant
          onOpen={() => changeView('CHAT')}
          onVoice={() => {
            try { sessionStorage.setItem('plectrum_chat_autolisten', '1'); } catch { /* ignore */ }
            changeView('CHAT');
          }}
        />
      )}

      {/* Tour Guide - Bottom Right Cloud */}
      {showTour && (
        <div className="fixed inset-0 z-[100] pointer-events-none">
          {/* Spotlight Highlighting */}
          {highlightRect && (
            <div
              className="absolute border-4 border-indigo-500/80 rounded-xl shadow-[0_0_30px_rgba(99,102,241,0.6)] animate-pulse transition-all duration-500 z-[101] pointer-events-none box-content"
              style={{
                top: highlightRect.top - 8,
                left: highlightRect.left - 8,
                width: highlightRect.width + 16,
                height: highlightRect.height + 16,
              }}
            />
          )}

          {/* Bes 'Cloud' Bubble - Bottom Right */}
          <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8 w-[90vw] md:w-96 pointer-events-auto animate-in slide-in-from-bottom-5 fade-in duration-500">
            <div className="bg-[#1a0f0a]/95 backdrop-blur-xl border-2 border-amber-500 p-6 rounded-3xl shadow-[0_0_50px_rgba(245,158,11,0.3)] relative">
              {/* Decorative Tail */}
              <div className="absolute -bottom-2 right-10 w-6 h-6 bg-[#1a0f0a] border-r-2 border-b-2 border-amber-500 rotate-45 transform"></div>

              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-600 to-amber-800 shrink-0 flex items-center justify-center border-2 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.5)]">
                  <Sparkles className="w-8 h-8 text-white animate-pulse" />
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-amber-100 mb-2 text-base font-display tracking-wide uppercase text-shadow-sm">{TOUR_STEPS[tourStep].title}</h3>
                  <p className="text-sm text-amber-200/90 leading-relaxed font-medium">
                    {TOUR_STEPS[tourStep].text}
                  </p>
                </div>
              </div>

              <div className="flex justify-between items-center mt-5 pt-4 border-t border-amber-900/30">
                {/* Dots */}
                <div className="flex gap-1.5">
                  {TOUR_STEPS.map((_, idx) => (
                    <div key={idx} className={`w-2 h-2 rounded-full ${idx === tourStep ? 'bg-amber-500 shadow-[0_0_10px_orange]' : 'bg-amber-900/50'} transition-all`}></div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => { onCloseTour(); setTourStep(0); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 hover:bg-amber-900/10 transition-colors"
                  >
                    SKIP
                  </button>
                  <button
                    onClick={handleNextTourStep}
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-xs font-bold shadow-lg transition-transform hover:scale-105 flex items-center gap-1 border border-amber-500/20 uppercase tracking-widest"
                  >
                    {tourStep === TOUR_STEPS.length - 1 ? "LET'S JAM" : "NEXT"} <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
