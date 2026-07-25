
import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import Layout from './components/Layout';
import SongList from './components/SongList';
// Heavy views are code-split so the initial load is small and first paint is
// fast. Each loads on demand when its view is opened.
const SongEditor = lazy(() => import('./components/SongEditor'));
const Teleprompter = lazy(() => import('./components/Teleprompter'));
const AIChat = lazy(() => import('./components/AIChat'));
const ImageAnalyzer = lazy(() => import('./components/ImageAnalyzer'));
const ChordTrainer = lazy(() => import('./components/ChordTrainer'));
const FretboardLab = lazy(() => import('./components/FretboardLab'));
const Connections = lazy(() => import('./components/Connections'));
const AirJam = lazy(() => import('./components/AirJam'));
const PracticeRoom = lazy(() => import('./components/PracticeRoom'));
// Air Strum bundles a camera + motion loop; lazy-load so it never touches the
// initial bundle or requests the camera on the homepage.
const AirStrum = lazy(() => import('./components/AirStrum'));
import { Song, ViewState, User, AppLanguage, SkillLevel } from './types';
import { getCurrentUser, login } from './services/authService';
import { playNextGlobalLoopChord, resumeAudio } from './services/audioService';
import { getSongs, setActiveUser } from './services/storageService';
import { startAutoSync } from './services/cloudSync';
import { ArrowRight, Clock, Thermometer } from 'lucide-react';
import PlectrumLogo from './components/PlectrumLogo';
import { Star, Music2, Crown } from 'lucide-react';

const SUPPORTED_LANGUAGES: AppLanguage[] = [
    'English', 'Hindi', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Urdu', 'Gujarati', 'Kannada', 'Malayalam', 'Odia', 'Punjabi', 'Assamese', 'Maithili'
];

const QUOTES = [
    "The world is quiet. Make it loud.",
    "Pick up where you left off.",
    "Every chord tells a story. What's yours?",
    "The guitar is the most complete instrument.",
    "Your fingers remember what your mind forgets."
];

// Active navigation state lives in sessionStorage so it survives in-session
// navigation and refreshes, but is cleared when the app/tab is fully closed.
// This gives us a clean "fresh launch → home" while still restoring state on
// refresh. Durable preferences (language, song library) stay in localStorage.
const SESSION_STATE_KEY = 'plectrum_session_state_v1';
// Legacy localStorage key that used to force stale deep-route resume on cold
// launch. We proactively clear it so old installs stop trapping users.
const LEGACY_APP_STATE_KEY = 'plectrum_app_state_v2';

type PersistedAppState = {
    currentView?: ViewState;
    selectedSongId?: string;
    scannedContent?: string;
    showTour?: boolean;
};

type AppHistoryState = {
    plectrumApp?: true;
    currentView?: ViewState;
    selectedSongId?: string;
    scannedContent?: string;
};

const readSessionAppState = (): PersistedAppState => {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_STATE_KEY) || '{}');
    } catch {
        return {};
    }
};

// Only the teleprompter strictly needs a song. Practice Room opens with an empty
// state (pick/search a track from inside), so it must be reachable song-less.
const viewNeedsSong = (view?: ViewState) => (
    view === 'TELEPROMPTER'
);

const isAppHistoryState = (state: unknown): state is AppHistoryState => (
    !!state && typeof state === 'object' && (state as AppHistoryState).plectrumApp === true
);

const App: React.FC = () => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(() => {
        const saved = localStorage.getItem('plectrum_language');
        return (saved as AppLanguage) || 'English';
    });

    const [currentView, setCurrentView] = useState<ViewState>('AUTH');
    const [selectedSong, setSelectedSong] = useState<Song | undefined>(undefined);
    const [scannedContent, setScannedContent] = useState<string | undefined>(undefined);

    // Auth State
    const [authStep, setAuthStep] = useState<'LANDING' | 'NAME' | 'SKILL' | 'LANGUAGE'>('LANDING');
    const [authName, setAuthName] = useState('');
    const [authEmail, setAuthEmail] = useState('');
    const [authSkill, setAuthSkill] = useState<SkillLevel | null>(null);

    // Environment State
    const [currentTime, setCurrentTime] = useState(new Date());
    const [showTour, setShowTour] = useState(false);
    const [quoteIndex, setQuoteIndex] = useState(0);
    const [studioName, setStudioName] = useState('Global Studio');
    const currentViewRef = useRef(currentView);
    const selectedSongRef = useRef<Song | undefined>(selectedSong);
    const scannedContentRef = useRef<string | undefined>(scannedContent);
    const historyReadyRef = useRef(false);

    useEffect(() => {
        currentViewRef.current = currentView;
        selectedSongRef.current = selectedSong;
        scannedContentRef.current = scannedContent;
    }, [currentView, selectedSong, scannedContent]);

    const buildHistoryState = useCallback((
        view: ViewState,
        song?: Song,
        content?: string
    ): AppHistoryState => ({
        plectrumApp: true,
        currentView: view,
        selectedSongId: song?.id,
        scannedContent: content,
    }), []);

    const applyRouteState = useCallback((routeState: AppHistoryState | PersistedAppState) => {
        const view = routeState.currentView && routeState.currentView !== 'AUTH'
            ? routeState.currentView
            : 'LIBRARY';
        const songs = getSongs();
        const restoredSong = routeState.selectedSongId
            ? songs.find(song => String(song.id) === String(routeState.selectedSongId))
            : undefined;
        const restoredView = viewNeedsSong(view) && !restoredSong ? 'LIBRARY' : view;

        setSelectedSong(restoredSong);
        setScannedContent(routeState.scannedContent);
        setCurrentView(restoredView);
    }, []);

    const writeHistoryState = useCallback((
        mode: 'push' | 'replace',
        view: ViewState,
        song?: Song,
        content?: string
    ) => {
        if (typeof window === 'undefined') return;
        const state = buildHistoryState(view, song, content);
        const url = window.location.pathname + window.location.search + window.location.hash;
        if (mode === 'push') {
            window.history.pushState(state, '', url);
        } else {
            window.history.replaceState(state, '', url);
        }
    }, [buildHistoryState]);

    const navigateTo = useCallback((
        view: ViewState,
        options: {
            song?: Song;
            scanned?: string;
            push?: boolean;
            clearEditorState?: boolean;
        } = {}
    ) => {
        const shouldClearEditorState = options.clearEditorState ?? view === 'EDITOR';
        const nextSong = shouldClearEditorState
            ? undefined
            : options.song ?? selectedSongRef.current;
        const nextScanned = shouldClearEditorState
            ? undefined
            : options.scanned ?? scannedContentRef.current;
        const nextView = viewNeedsSong(view) && !nextSong ? 'LIBRARY' : view;

        setSelectedSong(nextSong);
        setScannedContent(nextScanned);
        setCurrentView(nextView);
        if (historyReadyRef.current) {
            writeHistoryState(options.push === false ? 'replace' : 'push', nextView, nextSong, nextScanned);
        }
    }, [writeHistoryState]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        const quoteTimer = setInterval(() => setQuoteIndex(prev => (prev + 1) % QUOTES.length), 8000);

        // Try to infer precise location
        const fetchLocation = async () => {
            try {
                // Try IP geolocation first
                const res = await fetch('https://ipapi.co/json/');
                if (res.ok) {
                    const data = await res.json();
                    if (data.city) {
                        setStudioName(`${data.city} Studio`);
                        return;
                    }
                }
            } catch (e) {
                console.log("IP Geo failed, falling back to timezone");
            }

            // Fallback to Timezone
            try {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (tz && tz.includes('/')) {
                    const city = tz.split('/')[1].replace(/_/g, ' ');
                    setStudioName(`${city} Studio`);
                }
            } catch (e) {
                setStudioName('Global Studio');
            }
        };

        fetchLocation();

        // Clear the legacy localStorage-backed route so old installs never
        // resume onto a stale deep page after a full close/reopen.
        try { localStorage.removeItem(LEGACY_APP_STATE_KEY); } catch { /* ignore */ }

        // Auth Check
        const user = getCurrentUser();
        if (user) {
            // Point the library at this account BEFORE loading songs so the right
            // per-email history is restored.
            setActiveUser(user.email);
            // sessionStorage is empty on a genuine fresh launch (app fully
            // closed) → we intentionally land on the home library. On an
            // in-session refresh it still holds the last active view.
            const sessionState = readSessionAppState();
            const isFreshLaunch = !sessionStorage.getItem(SESSION_STATE_KEY);
            const songs = getSongs();
            const restoredSong = sessionState.selectedSongId
                ? songs.find(song => String(song.id) === String(sessionState.selectedSongId))
                : undefined;
            const restoredView = !isFreshLaunch && sessionState.currentView && sessionState.currentView !== 'AUTH'
                ? sessionState.currentView
                : 'LIBRARY';

            setCurrentUser(user);
            setSelectedSong(restoredSong);
            setScannedContent(sessionState.scannedContent);
            setShowTour(!isFreshLaunch && Boolean(sessionState.showTour));
            const safeRestoredView = viewNeedsSong(restoredView) && !restoredSong ? 'LIBRARY' : restoredView;
            setCurrentView(safeRestoredView);
            writeHistoryState('replace', safeRestoredView, restoredSong, sessionState.scannedContent);
            historyReadyRef.current = true;
        } else {
            setCurrentView('AUTH');
            setAuthStep('LANDING');
            writeHistoryState('replace', 'AUTH');
            historyReadyRef.current = true;
        }

        return () => {
            clearInterval(timer);
            clearInterval(quoteTimer);
        }
    }, [writeHistoryState]);

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (isAppHistoryState(event.state)) {
                applyRouteState(event.state);
                return;
            }

            const sessionState = readSessionAppState();
            applyRouteState(sessionState);
            writeHistoryState(
                'replace',
                currentViewRef.current || 'LIBRARY',
                selectedSongRef.current,
                scannedContentRef.current
            );
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [applyRouteState, writeHistoryState]);

    useEffect(() => {
        if (!currentUser) return;
        const stateToPersist: PersistedAppState = {
            currentView,
            selectedSongId: selectedSong?.id,
            scannedContent,
            showTour
        };
        try {
            sessionStorage.setItem(SESSION_STATE_KEY, JSON.stringify(stateToPersist));
        } catch { /* storage may be unavailable in private mode */ }
    }, [currentUser, currentView, selectedSong?.id, scannedContent, showTour]);

    const handleLanguageChange = (lang: AppLanguage) => {
        setSelectedLanguage(lang);
        localStorage.setItem('plectrum_language', lang);
    };

    const handleChangeView = (view: ViewState) => {
        navigateTo(view);
    };

    const handleGlobalClick = (e: React.MouseEvent | React.TouchEvent) => {
        resumeAudio();
        if (currentView === 'FRETBOARD_LAB' || currentView === 'PRACTICE_ROOM') return;
        const target = e.target as HTMLElement;
        if (
            target.tagName === 'BUTTON' ||
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.closest('button') ||
            target.closest('.no-global-click')
        ) {
            return;
        }
        playNextGlobalLoopChord();
    };

    const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

    const handleNameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (authName.trim().length > 0 && isValidEmail(authEmail)) {
            setAuthStep('SKILL');
        }
    };

    const handleSkillSelect = (skill: SkillLevel) => {
        setAuthSkill(skill);
        setAuthStep('LANGUAGE');
    };

    const handleLanguageSelect = async (lang: AppLanguage) => {
        handleLanguageChange(lang);
        if (authSkill) {
            const user = await login(authName, authSkill, authEmail);
            // Point the library at this account so their saved history is restored
            // (and existing local songs migrate into the account on first login).
            setActiveUser(user.email);
            setCurrentUser(user);
            navigateTo('LIBRARY', { push: false });
            setShowTour(true);
        }
    };

    // Wire automatic cloud sync once (no-op unless VITE_CLOUD_SYNC + signed in).
    // Every edit then pushes on a debounce and pulls on load — no manual Save/Sync.
    useEffect(() => { startAutoSync(); }, []);

    const goBack = () => navigateTo('LIBRARY', { push: false, clearEditorState: false });

    return (
        <div onClick={handleGlobalClick} onTouchStart={handleGlobalClick} className="h-[100dvh] w-full relative overflow-hidden bg-[#1a0f0a]">
            {currentView === 'AUTH' ? (
                <div className="h-full w-full flex flex-col relative font-sans overflow-hidden">
                    {/* Background Aesthetics */}
                    <div className="fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-30 pointer-events-none"></div>
                    <div className="fixed inset-0 bg-gradient-to-b from-[#4a2c20] via-[#2d1b15] to-[#0f0705] opacity-95 pointer-events-none"></div>

                    {/* Main Content Area */}
                    <div className="relative w-full h-full flex flex-col z-20">

                        {authStep === 'LANDING' && (
                            <>
                                {/* Environment Widget */}
                                <div className="relative md:absolute md:top-6 md:right-6 md:z-50 w-full md:w-auto px-6 pt-4 md:p-0 flex justify-center md:justify-end">
                                    <div className="landing-status-panel bg-[#1a0f0a]/80 md:bg-black/30 backdrop-blur-md rounded-2xl border border-amber-900/30 p-3 px-5 shadow-xl flex items-center justify-between gap-6 text-amber-200/80">
                                        <div className="flex flex-col items-start">
                                            <div className="flex items-center gap-2 text-[10px] md:text-xs font-bold uppercase tracking-wider text-amber-500">
                                                <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" /> {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            <div className="text-sm font-bold text-amber-100">{studioName}</div>
                                        </div>
                                        <div className="flex flex-col items-end text-xs font-medium">
                                            <div className="flex items-center gap-1.5"><Thermometer className="w-3 h-3 md:w-3.5 md:h-3.5 text-amber-500" /> Online</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Center Content */}
                                <div className="flex-1 flex flex-col items-center justify-center w-full max-w-7xl mx-auto px-6 md:pb-10">
                                    <div className="flex flex-col items-center justify-center mb-8 md:mb-12 scale-90 md:scale-100 transform transition-transform">
                                        <div className="mb-6 relative group cursor-pointer hover:scale-105 transition-transform duration-500">
                                            <div className="absolute inset-0 bg-amber-500/20 blur-[60px] rounded-full animate-pulse"></div>
                                            <PlectrumLogo className="w-28 h-28 md:w-36 md:h-36 lg:w-40 lg:h-40 relative z-10" animate={true} />
                                        </div>

                                        <h1 className="font-cursive text-6xl md:text-7xl lg:text-7xl xl:text-8xl text-amber-100 mb-3 drop-shadow-[0_4px_25px_rgba(0,0,0,0.6)] text-center leading-tight">
                                            Plectrum
                                        </h1>

                                        <p className="flex flex-col items-center gap-1 text-xs md:text-sm text-amber-500 font-bold uppercase tracking-[0.34em] opacity-80 text-center">
                                            <span>By the guitarist</span>
                                            <span>For the guitarist</span>
                                        </p>
                                    </div>

                                    <div className="landing-action-panel text-center space-y-6 md:space-y-8">
                                        <div className="min-h-12 md:min-h-14 flex items-center justify-center">
                                            <p className="text-amber-100/90 font-cursive text-xl md:text-2xl lg:text-3xl px-4 max-w-full text-center leading-snug drop-shadow-md opacity-90" key={quoteIndex}>
                                                "{QUOTES[quoteIndex]}"
                                            </p>
                                        </div>

                                        <button
                                            onClick={() => setAuthStep('NAME')}
                                            className="w-full py-4 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-2xl font-bold text-lg md:text-xl shadow-[0_10px_50px_rgba(217,119,6,0.4)] transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-4 border border-amber-500/20 font-display tracking-widest"
                                        >
                                            Enter Studio <ArrowRight className="w-5 h-5 md:w-6 md:h-6" />
                                        </button>

                                    </div>
                                </div>
                            </>
                        )}

                        {authStep !== 'LANDING' && (
                            <div className="w-full max-w-2xl mx-auto animate-in slide-in-from-right fade-in duration-300 flex-1 flex flex-col justify-center h-full px-6">
                                <div className="text-center mb-6 md:mb-8 flex flex-col items-center shrink-0">
                                    <button onClick={() => setAuthStep('LANDING')} className="mb-4 md:mb-6 text-amber-500/50 hover:text-amber-500 transition-colors flex items-center gap-2 text-xs md:text-sm uppercase tracking-widest font-bold">
                                        <ArrowRight className="w-4 h-4 rotate-180" /> Back
                                    </button>
                                    <PlectrumLogo className="w-16 h-16 md:w-20 md:h-20 mb-4" />
                                </div>

                                <div className="bg-[#2d1b15]/90 backdrop-blur-xl p-6 md:p-8 rounded-3xl border border-[#5d4037] shadow-2xl flex-shrink-0">
                                    {authStep === 'NAME' && (
                                        <form onSubmit={handleNameSubmit} className="space-y-6 md:space-y-8">
                                            <div className="text-center">
                                                <h2 className="text-2xl md:text-4xl font-bold text-white font-display mb-2">Artist Profile</h2>
                                                <p className="text-amber-500/80 text-xs md:text-sm">Sign in with your email so your songs &amp; history are saved.</p>
                                            </div>
                                            <input
                                                autoFocus
                                                value={authName}
                                                onChange={e => setAuthName(e.target.value)}
                                                placeholder="Stage Name"
                                                className="w-full bg-[#1a0f0a] border-b-2 border-[#5d4037] focus:border-amber-500 p-4 md:p-5 text-xl md:text-2xl text-center text-amber-100 outline-none transition-colors placeholder-amber-900/50 rounded-t-2xl font-display"
                                            />
                                            <input
                                                type="email"
                                                inputMode="email"
                                                autoComplete="email"
                                                value={authEmail}
                                                onChange={e => setAuthEmail(e.target.value)}
                                                placeholder="you@example.com"
                                                className="w-full bg-[#1a0f0a] border-b-2 border-[#5d4037] focus:border-amber-500 p-4 md:p-5 text-lg md:text-xl text-center text-amber-100 outline-none transition-colors placeholder-amber-900/50 font-sans"
                                            />
                                            <button
                                                type="submit"
                                                disabled={!authName.trim() || !isValidEmail(authEmail)}
                                                className="w-full py-3 md:py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white font-bold rounded-xl shadow-lg font-display tracking-wider text-base md:text-lg disabled:opacity-50"
                                            >
                                                Continue
                                            </button>
                                        </form>
                                    )}

                                    {authStep === 'SKILL' && (
                                        <div className="space-y-4 md:space-y-6">
                                            <div className="text-center mb-4 md:mb-6">
                                                <h2 className="text-2xl md:text-3xl font-bold text-white font-display">Skill Level</h2>
                                            </div>
                                            <div className="grid gap-3 md:gap-4">
                                                {[
                                                    { id: 'Beginner', icon: Star, desc: "Building the foundation." },
                                                    { id: 'Intermediate', icon: Music2, desc: "Exploring theory & riffs." },
                                                    { id: 'Professional', icon: Crown, desc: "Virtuoso." }
                                                ].map((item) => (
                                                    <button
                                                        key={item.id}
                                                        onClick={() => handleSkillSelect(item.id as SkillLevel)}
                                                        className="p-4 md:p-5 rounded-2xl bg-[#1a0f0a] border border-[#5d4037] hover:border-amber-500 hover:bg-[#3e2723] transition-all text-left flex items-center gap-4 group"
                                                    >
                                                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-amber-900/30 flex items-center justify-center group-hover:bg-amber-600 text-amber-600 group-hover:text-white transition-colors shrink-0">
                                                            <item.icon className="w-5 h-5 md:w-6 md:h-6" />
                                                        </div>
                                                        <div>
                                                            <span className="font-bold text-amber-100 group-hover:text-white text-base md:text-lg block font-display">{item.id}</span>
                                                            <span className="text-[10px] md:text-xs text-amber-500/60 group-hover:text-amber-200 uppercase tracking-wide">{item.desc}</span>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {authStep === 'LANGUAGE' && (
                                        <div className="space-y-4 md:space-y-6">
                                            <div className="text-center">
                                                <h2 className="text-2xl md:text-3xl font-bold text-white font-display">Language</h2>
                                                <p className="text-amber-500/60 text-xs md:text-sm mt-1">Select your preferred region</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 max-h-48 md:max-h-64 overflow-y-auto custom-scrollbar pr-1">
                                                {SUPPORTED_LANGUAGES.map(lang => (
                                                    <button
                                                        key={lang}
                                                        onClick={() => handleLanguageSelect(lang)}
                                                        className="p-3 md:p-4 rounded-xl bg-[#1a0f0a] border border-[#5d4037] hover:bg-amber-800 text-amber-200 hover:text-white text-xs md:text-sm font-bold transition-all font-display hover:scale-[1.02]"
                                                    >
                                                        {lang}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="absolute bottom-3 left-0 right-0 z-30 flex flex-wrap justify-center gap-3 px-4 text-[10px] text-amber-200/45 no-global-click">
                        <a href="/terms/" className="hover:text-amber-200 transition-colors">Terms</a>
                        <a href="/privacy/" className="hover:text-amber-200 transition-colors">Privacy</a>
                        <a href="/copyright/" className="hover:text-amber-200 transition-colors">Copyright</a>
                        <a href="/ai-disclosure/" className="hover:text-amber-200 transition-colors">AI Disclosure</a>
                    </div>
                </div>
            ) : (
                <Layout
                    currentView={currentView}
                    changeView={handleChangeView}
                    user={currentUser}
                    selectedLanguage={selectedLanguage}
                    onLanguageChange={handleLanguageChange}
                    showTour={showTour}
                    onCloseTour={() => setShowTour(false)}
                >
                    {currentView === 'LIBRARY' && (
                        <SongList
                            onEdit={(s) => navigateTo('EDITOR', { song: s, clearEditorState: false })}
                            onPlay={(s) => navigateTo('TELEPROMPTER', { song: s, clearEditorState: false })}
                            onOpenLab={(s) => navigateTo('FRETBOARD_LAB', { song: s, clearEditorState: false })}
                            onOpenPractice={(s) => navigateTo('PRACTICE_ROOM', { song: s, clearEditorState: false })}
                            onCreateNew={() => navigateTo('EDITOR', { clearEditorState: true })}
                        />
                    )}
                    <Suspense fallback={<div className="h-full w-full flex items-center justify-center text-amber-500/70 text-sm">Loading…</div>}>
                        {currentView === 'EDITOR' && <SongEditor songToEdit={selectedSong} onSave={goBack} onCancel={goBack} initialContent={scannedContent} selectedLanguage={selectedLanguage} userSkillLevel={currentUser?.skillLevel} />}
                        {currentView === 'TELEPROMPTER' && selectedSong && <Teleprompter song={selectedSong} onClose={goBack} />}
                        {currentView === 'CHAT' && <AIChat onClose={goBack} />}
                        {currentView === 'ANALYZER' && <ImageAnalyzer onCreateFromAnalysis={(c) => navigateTo('EDITOR', { scanned: c, clearEditorState: false })} onBack={goBack} />}
                        {currentView === 'CHORD_TRAINER' && <ChordTrainer onBack={goBack} />}
                        {currentView === 'FRETBOARD_LAB' && <FretboardLab initialSong={selectedSong} onBack={goBack} />}
                        {currentView === 'AIR_STRUM' && <AirStrum onBack={goBack} />}
                        {currentView === 'AIR_JAM' && <AirJam onBack={goBack} />}
                        {currentView === 'CONNECTIONS' && <Connections onBack={goBack} />}
                        {currentView === 'PRACTICE_ROOM' && (
                            selectedSong
                                ? <PracticeRoom isTourMode={showTour} onBack={goBack} initialSong={selectedSong} />
                                : <PracticeRoom isTourMode={showTour} initialSong={selectedSong} onBack={goBack} />
                        )}
                    </Suspense>
                </Layout>
            )}
        </div>
    );
};

export default App;
