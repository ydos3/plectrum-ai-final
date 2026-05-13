
import React, { useState, useEffect, useRef } from 'react';
import { Song, AppLanguage, SkillLevel } from '../types';
import { saveSong, getSongs } from '../services/storageService';
import { generateSongFromTitle, getSongRecommendations, getSearchSuggestions } from '../services/geminiService';
import { startListening, stopListening } from '../services/speechService';
import { extractYouTubeVideoId } from '../services/youtubeService';
import { Save, ArrowLeft, Mic, Sparkles, Wand2, Loader2, Merge, Link as LinkIcon, Clock, ChevronDown, ChevronUp, Search, Music, PlayCircle, X, Split, Zap, ExternalLink } from 'lucide-react';

interface SongEditorProps {
    songToEdit?: Song;
    onSave: () => void;
    onCancel: () => void;
    initialContent?: string;
    selectedLanguage?: AppLanguage;
    userSkillLevel?: SkillLevel;
}

// Expanded, rotating quote library
const MUSICIAN_QUOTES = [
    { text: "The guitar is a small orchestra. It is every instrument in one.", author: "Andrés Segovia" },
    { text: "One good thing about music, when it hits you, you feel no pain.", author: "Bob Marley" },
    { text: "Notes are the same, it's how you put them together.", author: "Steve Vai" },
    { text: "Music is the divine way to tell beautiful, poetic things to the heart.", author: "Pablo Casals" },
    { text: "Sometimes you want to give up the guitar, you'll hate the guitar. But if you stick with it, you're gonna be rewarded.", author: "Jimi Hendrix" },
    { text: "I don't play the guitar for a living. I play the guitar to live.", author: "Unknown" },
    { text: "The beautiful thing about learning is that nobody can take it away from you.", author: "B.B. King" },
    { text: "Music expresses that which cannot be said and on which it is impossible to be silent.", author: "Victor Hugo" },
    { text: "If you hit a wrong note, it's the next note that you play that determines if it's good or bad.", author: "Miles Davis" },
    { text: "The guitar is your first wing. It's assigned and designed to unfold your vision and imagination.", author: "Carlos Santana" },
    { text: "It’s not about the notes you play, it’s about the notes you don’t play.", author: "Miles Davis" },
    { text: "To play a wrong note is insignificant; to play without passion is inexcusable.", author: "Ludwig van Beethoven" }
];

type PracticeSkillLevel = 'Beginner' | 'Intermediate' | 'Advanced';

const normalizeSkillLevel = (level?: SkillLevel): PracticeSkillLevel => (
    level === 'Beginner' || level === 'Intermediate' ? level : 'Advanced'
);

const SongEditor: React.FC<SongEditorProps> = ({ songToEdit, onSave, onCancel, initialContent, selectedLanguage = 'English' as AppLanguage, userSkillLevel }) => {
    // Metadata State
    const [title, setTitle] = useState(songToEdit?.title || '');
    const [artist, setArtist] = useState(songToEdit?.artist || '');
    const [movie, setMovie] = useState(songToEdit?.movie || '');
    const [releaseDate, setReleaseDate] = useState(songToEdit?.releaseDate || '');

    // Musical State
    const [content, setContent] = useState(songToEdit?.content || initialContent || '');
    const [key, setKey] = useState(songToEdit?.key || '');
    const [capo, setCapo] = useState<number | string>(songToEdit?.capo || '');
    const [rhythm, setRhythm] = useState(songToEdit?.strummingPattern || '');
    const [recommendedKey, setRecommendedKey] = useState(songToEdit?.recommendedKey || '');
    const [difficulty, setDifficulty] = useState(songToEdit?.difficulty || '');
    const [practiceTips, setPracticeTips] = useState<string[]>(songToEdit?.practiceTips || []);
    const [chordSimplifications, setChordSimplifications] = useState(songToEdit?.chordSimplifications || []);
    const [karaokeUrl, setKaraokeUrl] = useState(songToEdit?.karaokeUrl || '');
    const [timedLyrics, setTimedLyrics] = useState<Song['timedLyrics']>(songToEdit?.timedLyrics);
    const [showPreviewPlayer, setShowPreviewPlayer] = useState(false);

    // UI State
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showMashupModal, setShowMashupModal] = useState(false);

    const formatTime = (secs?: number) => {
        if (!secs) return '';
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const [durationStr, setDurationStr] = useState(formatTime(songToEdit?.duration));

    // AI State
    const [isAiListening, setIsAiListening] = useState(false);
    const [isAiProcessing, setIsAiProcessing] = useState(false);

    // Professional Loader State
    const [progress, setProgress] = useState(0);
    const [currentQuote, setCurrentQuote] = useState(MUSICIAN_QUOTES[0]);

    const [showMagicTools, setShowMagicTools] = useState(true);
    const [magicInput, setMagicInput] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestionsDropdown, setShowSuggestionsDropdown] = useState(false);
    const [practiceSkillLevel, setPracticeSkillLevel] = useState<PracticeSkillLevel>(() => normalizeSkillLevel(userSkillLevel));

    // New Mashup State
    const [mashupDetected, setMashupDetected] = useState(false);
    const [showMashupConfirm, setShowMashupConfirm] = useState(false);

    const recognitionRef = useRef<any>(null);

    const youtubePreviewId = extractYouTubeVideoId(karaokeUrl);

    // RESET LOGIC
    useEffect(() => {
        if (!songToEdit) {
            setTitle('');
            setArtist('');
            setContent(initialContent || '');
            setKey('');
            setCapo('');
            setRhythm('');
            setRecommendedKey('');
            setDifficulty('');
            setPracticeTips([]);
            setChordSimplifications([]);
            setDurationStr('');
            setKaraokeUrl('');
            setTimedLyrics(undefined);
        } else {
            setTitle(songToEdit.title);
            setArtist(songToEdit.artist);
            setContent(songToEdit.content);
            setKey(songToEdit.key || '');
            setCapo(songToEdit.capo || '');
            setRhythm(songToEdit.strummingPattern || '');
            setRecommendedKey(songToEdit.recommendedKey || '');
            setDifficulty(songToEdit.difficulty || '');
            setPracticeTips(songToEdit.practiceTips || []);
            setChordSimplifications(songToEdit.chordSimplifications || []);
            setDurationStr(formatTime(songToEdit.duration));
            setKaraokeUrl(songToEdit.karaokeUrl || '');
            setTimedLyrics(songToEdit.timedLyrics);
            setLanguageFallbackMessage('');
        }
    }, [songToEdit, initialContent]);

    useEffect(() => {
        if (!songToEdit) setPracticeSkillLevel(normalizeSkillLevel(userSkillLevel));
    }, [userSkillLevel, songToEdit]);

    // SMART SUGGESTIONS: Learn from user history or Type-ahead
    useEffect(() => {
        if (magicInput.length === 0) {
            // Load default history recommendations
            const loadHistoryRecs = async () => {
                const mySongs = getSongs();
                const recentTitles = mySongs.slice(0, 5).map(s => s.title);
                const recs = await getSongRecommendations(recentTitles, selectedLanguage);
                setSuggestions(recs);
            };
            loadHistoryRecs();
        } else {
            // Increased debounce to 600ms for STABILITY
            const delayDebounceFn = setTimeout(async () => {
                if (magicInput.length > 2 && !mashupDetected) {
                    const results = await getSearchSuggestions(magicInput);
                    if (results.length > 0) {
                        setSuggestions(results);
                        setShowSuggestionsDropdown(true);
                    }
                }
            }, 600);

            return () => clearTimeout(delayDebounceFn);
        }
    }, [magicInput, selectedLanguage, mashupDetected]);

    // AUTO MASHUP DETECTION (Visual Only)
    useEffect(() => {
        if (magicInput.includes(',') || magicInput.toLowerCase().includes(' vs ')) {
            setMashupDetected(true);
        } else {
            setMashupDetected(false);
        }
    }, [magicInput]);

    // LOADING SIMULATION LOGIC
    useEffect(() => {
        let interval: number;
        if (isAiProcessing) {
            setProgress(0);
            // Randomly select a new quote each time processing starts
            setCurrentQuote(MUSICIAN_QUOTES[Math.floor(Math.random() * MUSICIAN_QUOTES.length)]);

            interval = window.setInterval(() => {
                setProgress(prev => {
                    if (prev >= 96) return prev;
                    const increment = Math.max(0.2, (98 - prev) / 40);
                    return prev + increment;
                });
            }, 50);
        }
        return () => clearInterval(interval);
    }, [isAiProcessing]);

    const getLoadingStatus = (p: number) => {
        if (p < 15) return "Finding the song...";
        if (p < 30) return "Checking the best match...";
        if (p < 50) return "Preparing the chart...";
        if (p < 70) return "Harmonizing Chords with AI...";
        if (p < 85) return "Calculating Fret Positions...";
        if (p < 95) return "Lining up the sections...";
        return "Final polish...";
    };

    const handleApplyAiResult = (data: any, fromCache: boolean = false) => {
        if (data) {
            // Data received successfully


            setProgress(100);
            setTimeout(() => {
                setTitle(data.title || title);
                setArtist(data.artist || artist);
                setContent(data.content || content);
                setKey(data.key || key);
                if (typeof data.capo === 'number') setCapo(data.capo);
                setRhythm(data.strummingPattern || rhythm);
                setRecommendedKey(data.recommendedKey || data.easierKey || recommendedKey);
                setDifficulty(data.difficulty || practiceSkillLevel);
                setPracticeTips(Array.isArray(data.practiceTips) ? data.practiceTips : []);
                setChordSimplifications(Array.isArray(data.chordSimplifications) ? data.chordSimplifications : []);
                if (data.movie) setMovie(data.movie);
                if (data.releaseDate) setReleaseDate(data.releaseDate);
                if (data.karaokeUrl) setKaraokeUrl(data.karaokeUrl);
                if (data.duration) setDurationStr(formatTime(data.duration));
                setTimedLyrics(Array.isArray(data.timedLyrics) ? data.timedLyrics : undefined);
                setShowMagicTools(false);
                setIsAiProcessing(false);
                setShowMashupModal(false);
                setShowMashupConfirm(false);
                setMashupDetected(false);
                setMagicInput('');
            }, 600);
        } else {
            alert("AI generation failed to find this song. Please try a different title or check spelling.");
            setIsAiProcessing(false);
        }
    };

    const parseDuration = (str: string): number => {
        const parts = str.split(':');
        if (parts.length === 2) {
            return (parseInt(parts[0]) * 60) + parseInt(parts[1]);
        }
        return parseInt(str) || 0;
    };

    const handleVoiceGenerate = () => {
        if (isAiListening) {
            stopListening();
            setIsAiListening(false);
            return;
        }

        const success = startListening(
            'en-US',
            (query) => {
                setIsAiListening(false);
                if (query) {
                    setMagicInput(query);
                    setTimeout(() => {
                        if (query.includes(',') || query.includes(' vs ')) {
                            setShowMashupConfirm(true);
                        } else {
                            runQuickPrompt(query);
                        }
                    }, 100);
                }
            },
            (error) => {
                console.error('Speech error', error);
                setIsAiListening(false);
                alert('Failed to start voice recognition. Please check microphone permissions.');
            },
            () => setIsAiListening(true),
            () => setIsAiListening(false)
        );

        if (!success) {
            alert('Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
        }
    };

    const runQuickPrompt = async (prompt: string, forceMashup: boolean = false) => {
        if (!prompt.trim()) return;

        setIsAiProcessing(true);
        const isBarre = prompt.toLowerCase().includes('barre');
        const isOpen = prompt.toLowerCase().includes('open');
        const suffix = isBarre ? " (Use Barre Chords)" : isOpen ? " (Use Open Chords)" : "";

        let finalPrompt = prompt + suffix;
        if (forceMashup) {
            finalPrompt = `Mashup of these songs: ${prompt}`;
        }

        let songData;
        try {
            songData = await generateSongFromTitle(finalPrompt, selectedLanguage as AppLanguage, practiceSkillLevel);
            handleApplyAiResult(songData);
        } catch (error: any) {
            alert(`AI Generation Failed:\n${error?.message || error}`);
            setIsAiProcessing(false);
        }
    };

    const handleManualGenerate = async () => {
        if (!magicInput) return;

        // MASHUP INTERCEPTOR
        if (magicInput.includes(',') || magicInput.toLowerCase().includes(' vs ')) {
            setShowMashupConfirm(true);
            return;
        }

        runQuickPrompt(magicInput);
        setShowSuggestionsDropdown(false);
    };

    const handleMashupPrompt = async () => {
        if (!magicInput.trim()) return;
        setIsAiProcessing(true);
        const query = `Mashup of "${title}" and "${magicInput}"`;
        let songData;
        try {
            songData = await generateSongFromTitle(query, selectedLanguage as AppLanguage, practiceSkillLevel);
            handleApplyAiResult(songData);
        } catch (error: any) {
            alert(`Mashup Generation Failed:\n${error?.message || error}`);
            setIsAiProcessing(false);
        }
    };

    const handleDirectMashup = () => {
        setShowMashupConfirm(false);
        runQuickPrompt(magicInput, true);
    };

    const handleMakeEasier = () => {
        const base = title || magicInput;
        if (!base.trim()) {
            alert('Search or enter a song first, then I can simplify it.');
            return;
        }
        setPracticeSkillLevel('Beginner');
        runQuickPrompt(`${base} - make this song easier for a beginner using open chords and capo suggestions`);
    };

    const handleSave = () => {
        if (!title || !content) {
            alert('Title and content required');
            return;
        }
        const newSong: Song = {
            id: songToEdit?.id || Date.now().toString(),
            title,
            artist: artist || 'Unknown',
            movie,
            releaseDate,
            content,
            key,
            recommendedKey,
            capo: Number(capo) || 0,
            strummingPattern: rhythm,
            difficulty: difficulty || practiceSkillLevel,
            practiceTips,
            chordSimplifications,
            karaokeUrl: karaokeUrl,
            language: selectedLanguage,
            timedLyrics,
            duration: parseDuration(durationStr),
            createdAt: songToEdit?.createdAt || Date.now(),
        };
        saveSong(newSong);
        onSave();
    };

    return (
        <div className="h-full flex flex-col bg-[#2d1b15] relative font-sans text-amber-100">

            {/* PROFESSIONAL AI STUDIO LOADER */}
            {isAiProcessing && (
                <div className="absolute inset-0 z-[100] bg-[#2d1b15]/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
                    <style>{`
                  @keyframes vibrateString {
                      0% { transform: translateX(0); }
                      20% { transform: translateX(-1px); }
                      40% { transform: translateX(1px); }
                      60% { transform: translateX(-0.5px); }
                      80% { transform: translateX(0.5px); }
                      100% { transform: translateX(0); }
                  }
                  .string-vibrate { animation: vibrateString 0.08s linear infinite; }
                  @keyframes glitterFlow {
                      0% { background-position: 0% 50%; }
                      100% { background-position: 200% 50%; }
                  }
              `}</style>

                    <div className="max-w-2xl w-full flex flex-col items-center relative">
                        <div className="mb-16 text-center animate-in slide-in-from-top-8 duration-700">
                            <div className="text-3xl font-cursive text-amber-500/80 mb-4 opacity-50">"</div>
                            <p className="text-xl md:text-2xl font-serif text-amber-100 italic leading-relaxed px-4 drop-shadow-md">
                                {currentQuote.text}
                            </p>
                            <p className="text-amber-500 mt-4 font-bold uppercase tracking-[0.2em] text-xs">— {currentQuote.author}</p>
                        </div>

                        {/* Guitar Strings Visualizer */}
                        <div className="h-64 w-64 flex justify-between items-center relative mb-12 mx-auto">
                            {/* String 6 (Low E) - Thickest */}
                            <div className="h-full w-[4px] bg-gradient-to-b from-amber-700 via-yellow-100 to-amber-700 rounded-full shadow-lg string-vibrate" style={{ animationDuration: '0.12s' }}></div>
                            <div className="h-full w-[3.2px] bg-gradient-to-b from-amber-700 via-yellow-100 to-amber-700 rounded-full shadow-lg string-vibrate" style={{ animationDuration: '0.11s', animationDelay: '0.02s' }}></div>
                            <div className="h-full w-[2.5px] bg-gradient-to-b from-amber-700 via-yellow-100 to-amber-700 rounded-full shadow-md string-vibrate" style={{ animationDuration: '0.10s', animationDelay: '0.05s' }}></div>
                            <div className="h-full w-[1.8px] bg-gradient-to-b from-slate-400 via-white to-slate-400 rounded-full shadow-md string-vibrate" style={{ animationDuration: '0.09s', animationDelay: '0.01s' }}></div>
                            <div className="h-full w-[1.2px] bg-gradient-to-b from-slate-400 via-white to-slate-400 rounded-full shadow-sm string-vibrate" style={{ animationDuration: '0.08s', animationDelay: '0.04s' }}></div>
                            <div className="h-full w-[0.8px] bg-gradient-to-b from-slate-400 via-white to-slate-400 rounded-full shadow-sm string-vibrate" style={{ animationDuration: '0.07s', animationDelay: '0.06s' }}></div>
                            <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full animate-pulse"></div>
                        </div>

                        <div className="w-full max-w-lg space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <span className="text-amber-500 font-mono text-xs font-bold uppercase tracking-widest animate-pulse">
                                    {getLoadingStatus(progress)}
                                </span>
                                <span className="text-amber-200/50 font-mono text-xs">{Math.floor(progress)}%</span>
                            </div>

                            <div className="h-2 w-full bg-[#1a0f0a] rounded-full overflow-hidden border border-[#5d4037] shadow-inner relative">
                                <div
                                    className="h-full absolute top-0 left-0 bg-gradient-to-r from-amber-700 via-amber-500 to-amber-200 transition-all ease-linear"
                                    style={{
                                        width: `${progress}%`,
                                        boxShadow: '0 0 20px rgba(245, 158, 11, 0.5)'
                                    }}
                                >
                                    <div
                                        className="absolute inset-0 opacity-70"
                                        style={{
                                            backgroundImage: 'url("https://www.transparenttextures.com/patterns/stardust.png")',
                                            backgroundSize: '200px',
                                            animation: 'glitterFlow 2s linear infinite'
                                        }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-[#5d4037] bg-[#1a0f0a]/50 backdrop-blur-md z-10 shrink-0 shadow-md">
                <div className="flex items-center gap-2 md:gap-4">
                    <button onClick={onCancel} className="p-2 hover:bg-white/10 rounded-lg text-amber-200/60 hover:text-white transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-amber-600 to-amber-800 rounded-lg flex items-center justify-center shadow-lg border border-[#5d4037]">
                            <Music className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-amber-100 leading-tight font-display">{songToEdit ? 'Edit Composition' : 'New Composition'}</h2>
                            <p className="text-[10px] text-amber-500 uppercase tracking-wider font-bold">Studio Mode</p>
                        </div>
                    </div>
                </div>

                <div id="tour-composer-tools" className="flex items-center gap-2 md:gap-3">
                    <button onClick={() => setShowMashupModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-xs md:text-sm bg-[#3e2723] text-amber-200 border border-[#5d4037] hover:bg-[#4e342e] hover:text-white transition-all shadow-sm">
                        <Merge className="w-4 h-4" /> <span className="hidden md:inline">Mashup</span>
                    </button>
                    <button onClick={() => setShowMagicTools(!showMagicTools)} className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-xs md:text-sm transition-all shadow-sm ${showMagicTools ? 'bg-amber-600 text-white shadow-amber-500/30' : 'bg-[#3e2723] text-amber-400 hover:text-white border border-[#5d4037]'}`}>
                        <Wand2 className="w-4 h-4" /> <span className="hidden md:inline">AI Tools</span>
                    </button>

                    {/* MAGIC MIC BUTTON */}
                    <button
                        onClick={handleVoiceGenerate}
                        disabled={isAiProcessing}
                        className={`relative flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs md:text-sm border transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] group overflow-hidden ${isAiListening ? 'bg-red-600 text-white border-red-400 animate-pulse' : 'bg-gradient-to-r from-red-900 to-slate-900 text-white border-red-500/50 hover:border-red-400 hover:scale-105'}`}
                    >
                        <div className="relative flex items-center gap-2 z-10">
                            <div className="bg-white/20 p-1 rounded-full">
                                <Mic className="w-4 h-4 text-white fill-current" />
                            </div>
                            <span className="hidden md:inline">{isAiListening ? 'Listening...' : 'Voice Composer'}</span>
                        </div>
                        {!isAiListening && <div className="absolute inset-0 bg-red-500/20 blur-lg group-hover:bg-red-500/40 transition-all"></div>}
                    </button>

                    <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-lg font-bold shadow-lg shadow-amber-900/30 text-xs md:text-sm transition-all transform hover:-translate-y-0.5">
                        <Save className="w-4 h-4" /> Save
                    </button>
                </div>
            </div>

            {/* AI Toolbar */}
            {showMagicTools && (
                <div className="bg-[#1a0f0a]/90 p-6 border-b border-[#5d4037] shrink-0 animate-in slide-in-from-top-2 shadow-2xl relative z-30 backdrop-blur-xl">
                    <div id="tour-magic-input" className="flex flex-col gap-4 max-w-3xl mx-auto relative">
                        <div className="relative shadow-lg rounded-full group">
                            <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 w-6 h-6 text-amber-500/50 group-focus-within:text-amber-500 transition-colors" />
                            <input
                                value={magicInput}
                                onChange={e => { setMagicInput(e.target.value); setShowSuggestionsDropdown(true); }}
                                onFocus={() => setShowSuggestionsDropdown(true)}
                                onBlur={() => setTimeout(() => setShowSuggestionsDropdown(false), 200)}
                                onKeyDown={e => e.key === 'Enter' && handleManualGenerate()}
                                placeholder="Type song name (e.g. 'Wonderwall') or lyrics..."
                                className="w-full bg-[#0a0503] border border-[#5d4037] rounded-full pl-14 pr-32 py-4 text-amber-100 focus:ring-2 focus:ring-amber-500/50 outline-none placeholder-amber-900/40 transition-all font-medium text-lg shadow-inner"
                                autoComplete="off"
                            />
                            <button onClick={handleManualGenerate} className="absolute right-2 top-2 bottom-2 px-6 bg-amber-600 hover:bg-amber-500 text-white rounded-full font-bold text-sm transition-colors shadow-lg">
                                Generate
                            </button>
                        </div>

                        {/* MASHUP DETECTOR PROMPT */}
                        {mashupDetected && (
                            <div
                                onClick={handleDirectMashup}
                                className="bg-indigo-900/40 border border-indigo-500/50 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-indigo-900/60 transition-colors animate-in fade-in slide-in-from-top-2"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center animate-pulse">
                                        <Merge className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-indigo-200">Multiple Songs Detected!</h4>
                                        <p className="text-[10px] text-indigo-300/60">Do you want to create a mashup of "{magicInput}"?</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg shadow-lg">
                                    <Sparkles className="w-3 h-3" /> Create Mashup
                                </div>
                            </div>
                        )}

                        {/* Google Style Suggestions Dropdown */}
                        {showSuggestionsDropdown && suggestions.length > 0 && !mashupDetected && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a0f0a] border border-[#5d4037] rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.8)] overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 divide-y divide-[#2d1b15]">
                                <div className="px-6 py-3 bg-[#120b08] text-[10px] uppercase font-bold text-amber-500/50 tracking-widest border-b border-[#2d1b15]">
                                    {magicInput.length > 0 ? "Search Suggestions" : "Recommended for you"}
                                </div>
                                {suggestions.map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { setMagicInput(s); runQuickPrompt(s); }}
                                        className="w-full text-left px-6 py-4 hover:bg-[#2d1b15] flex items-center gap-4 transition-colors group"
                                    >
                                        <Search className="w-4 h-4 text-amber-700 group-hover:text-amber-500 transition-colors" />
                                        <span className="text-amber-200 group-hover:text-white font-medium text-base">{s}</span>
                                        <span className="ml-auto text-[10px] text-amber-900 group-hover:text-amber-500 uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Create Tab</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* MASHUP CONFIRMATION MODAL (Intercepts Generate Click) */}
            {showMashupConfirm && (
                <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
                    <div className="bg-[#1a0f0a] border-2 border-indigo-500 rounded-3xl p-8 max-w-lg w-full shadow-[0_0_60px_rgba(79,70,229,0.3)] text-center">
                        <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl animate-bounce">
                            <Merge className="w-10 h-10 text-white" />
                        </div>
                        <h3 className="text-2xl font-black text-white mb-2 font-display">Wait a sec...</h3>
                        <p className="text-indigo-200 mb-8 font-medium">
                            I see multiple tracks in your request: <br />
                            <span className="text-white font-bold italic">"{magicInput}"</span>
                        </p>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={handleDirectMashup}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
                            >
                                <Sparkles className="w-5 h-5" /> YES, Create a Mashup!
                            </button>
                            <button
                                onClick={() => { setShowMashupConfirm(false); runQuickPrompt(magicInput); }}
                                className="w-full py-3 bg-[#2d1b15] hover:bg-[#3e2723] text-amber-200/60 rounded-xl font-bold text-sm border border-[#5d4037]"
                            >
                                No, just regular generation
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showMashupModal && (
                <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#2d1b15] border border-[#5d4037] p-6 rounded-2xl w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-amber-100 mb-4 flex items-center gap-2"><Merge className="w-5 h-5 text-amber-500" /> Mashup Studio</h3>
                        <p className="text-sm text-amber-200/60 mb-4">Combine <strong>{title || "Current Song"}</strong> with another track.</p>
                        <input
                            value={magicInput}
                            onChange={e => setMagicInput(e.target.value)}
                            placeholder="Enter second song name..."
                            className="w-full bg-[#0f0a08] border border-[#5d4037] rounded-lg p-3 text-amber-100 mb-4 outline-none focus:border-amber-500"
                        />
                        <div className="flex gap-3">
                            <button onClick={() => setShowMashupModal(false)} className="flex-1 py-3 rounded-lg bg-[#3e2723] text-amber-200 font-bold hover:bg-[#4e342e] transition-colors border border-[#5d4037]">Cancel</button>
                            <button onClick={handleMashupPrompt} className="flex-1 py-3 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-500 shadow-lg shadow-amber-900/30 transition-colors">Create Mashup</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* Sidebar Controls */}
                <div className="w-full md:w-80 bg-[#1a0f0a]/50 border-r border-[#5d4037] p-5 space-y-5 overflow-y-auto shrink-0 md:h-full h-auto border-b md:border-b-0 max-h-[40vh] md:max-h-full">
                    <div>
                        <label className="text-[10px] uppercase font-bold text-amber-500 mb-1 block tracking-wider">Track Metadata</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-[#0f0a08]/40 border border-[#5d4037] focus:border-amber-500 text-amber-100 p-2.5 rounded-lg mb-2 placeholder-amber-900/50 outline-none transition-colors font-bold text-lg font-display" placeholder="Song Title" />
                        <input value={artist} onChange={e => setArtist(e.target.value)} className="w-full bg-[#0f0a08]/40 border border-[#5d4037] focus:border-amber-500 text-amber-100 p-2.5 rounded-lg mb-2 placeholder-amber-900/50 outline-none transition-colors" placeholder="Artist Name" />
                    </div>

                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="w-full flex items-center justify-between text-xs font-bold text-amber-500 hover:text-white bg-white/5 p-3 rounded-lg border border-white/5 transition-all hover:bg-white/10"
                    >
                        <span>Technical Details</span>
                        {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {showAdvanced && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 border-l-2 border-amber-500/20 pl-3">
                            <div>
                                <div className="flex gap-2 mb-2">
                                    <div className="flex-1">
                                        <label className="text-[10px] uppercase font-bold text-amber-500 mb-1 block">Movie</label>
                                        <input value={movie} onChange={e => setMovie(e.target.value)} className="w-full bg-[#0f0a08]/40 border border-[#5d4037] text-amber-100 p-2 rounded text-xs outline-none" placeholder="Source" />
                                    </div>
                                    <div className="w-32">
                                        <label className="text-[10px] uppercase font-bold text-amber-500 mb-1 block">Year</label>
                                        <input type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} className="w-full bg-[#0f0a08]/40 border border-[#5d4037] text-amber-100 p-2 rounded text-xs outline-none" />
                                    </div>
                                </div>

                                <label className="text-[10px] uppercase font-bold text-amber-500 mb-1 block">Duration</label>
                                <div className="flex items-center gap-2 bg-[#0f0a08]/40 border border-[#5d4037] rounded px-2 mb-2">
                                    <Clock className="w-4 h-4 text-amber-500" />
                                    <input value={durationStr} onChange={e => setDurationStr(e.target.value)} className="w-full bg-transparent text-amber-100 p-2 outline-none text-xs" placeholder="03:30" />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase font-bold text-amber-500 mb-1 block">Musical Key & Capo</label>
                                <div className="flex gap-2 mb-2">
                                    <input value={key} onChange={e => setKey(e.target.value)} className="w-2/3 bg-[#0f0a08]/40 border border-[#5d4037] text-amber-100 p-2 rounded outline-none" placeholder="e.g. Am" />
                                    <div className="w-1/3 relative">
                                        <span className="absolute right-2 top-2 text-[10px] text-amber-500 pointer-events-none font-bold">CAPO</span>
                                        <input type="number" value={capo} onChange={e => setCapo(e.target.value)} className="w-full bg-[#0f0a08]/40 border border-[#5d4037] text-amber-100 p-2 rounded outline-none" placeholder="0" />
                                    </div>
                                </div>
                                <input value={rhythm} onChange={e => setRhythm(e.target.value)} className="w-full bg-[#0f0a08]/40 border border-[#5d4037] text-amber-100 p-2 rounded outline-none" placeholder="Strum: D-DU-UDU" />
                            </div>

                            <div>
                                <label className="text-[10px] uppercase font-bold text-amber-500 mb-1 block">Official Video URL</label>
                                <div className="flex items-center gap-2 bg-[#0f0a08]/40 border border-[#5d4037] rounded px-2">
                                    <LinkIcon className="w-4 h-4 text-amber-500" />
                                    <input value={karaokeUrl} onChange={e => setKaraokeUrl(e.target.value)} className="w-full bg-transparent text-amber-100 p-2 outline-none text-xs" placeholder="YouTube URL..." />
                                    {karaokeUrl && (
                                        <>
                                            <button onClick={() => setShowPreviewPlayer(!showPreviewPlayer)} className="text-amber-500 hover:text-white" title="Preview">
                                                <PlayCircle className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => window.open(karaokeUrl, '_blank')} className="text-amber-500 hover:text-white" title="Open External">
                                                <ExternalLink className="w-4 h-4" />
                                            </button>
                                        </>
                                    )}
                                </div>
                                <p className="text-[9px] text-amber-900/60 mt-1">This link is for metadata reference. The Karaoke Player will search for a karaoke version automatically.</p>
                            </div>
                        </div>
                    )}
                    {/* Mini Preview Player for Composer */}
                    {showPreviewPlayer && karaokeUrl && youtubePreviewId && (
                        <div className="mt-4 rounded-xl overflow-hidden border border-[#5d4037] shadow-lg aspect-video relative animate-in zoom-in">
                            <button onClick={() => setShowPreviewPlayer(false)} className="absolute top-2 right-2 p-1 bg-black/60 text-white rounded-full z-10"><X className="w-4 h-4" /></button>
                            <iframe
                                className="w-full h-full"
                                src={`https://www.youtube.com/embed/${youtubePreviewId}?autoplay=0&origin=${window.location.origin}`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                            ></iframe>
                        </div>
                    )}
                    {showPreviewPlayer && karaokeUrl && !youtubePreviewId && (
                        <div className="mt-4 rounded-xl border border-amber-700/50 bg-black/30 p-3 text-xs text-amber-300">
                            Could not read a YouTube video ID from this URL.
                        </div>
                    )}
                </div>

                {/* Main Editor Area */}
                <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="flex-1 bg-transparent text-amber-50 font-mono p-4 md:p-8 resize-none outline-none text-base md:text-lg h-full overflow-y-auto leading-relaxed placeholder-amber-900/40 selection:bg-amber-500/30 font-hand"
                    placeholder="Type lyrics here... use [brackets] for chords like [Am] or [G]."
                    style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}
                />
            </div>
        </div>
    );
};

export default SongEditor;
