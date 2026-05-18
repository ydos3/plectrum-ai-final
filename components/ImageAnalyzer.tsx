
import React, { useState, useRef, useEffect } from 'react';
import { analyzeImage } from '../services/geminiService';
import { Upload, Camera, FileText, Loader2, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react';

interface ImageAnalyzerProps {
  onCreateFromAnalysis: (content: string) => void;
  onBack?: () => void;
}

const ImageAnalyzer: React.FC<ImageAnalyzerProps> = ({ onCreateFromAnalysis, onBack }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let interval: number;
    if (isAnalyzing) {
        setProgress(0);
        interval = window.setInterval(() => {
            setProgress(prev => (prev < 90 ? prev + (Math.random() * 7) : prev));
        }, 600);
    }
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedImage) return;

    setIsAnalyzing(true);
    const prompt = "Analyze this image. If it is sheet music, handwritten lyrics, or a chord chart, extract the lyrics and chords into a text format where chords are in brackets like [C] placed inline with the lyrics. If it's something else, describe it musically.";
    
    try {
        const analysis = await analyzeImage(selectedImage, prompt);
        setProgress(100);
        setTimeout(() => {
            setResult(analysis);
            setIsAnalyzing(false);
        }, 500);
    } catch (err) {
        alert("Scanning failed. Please try a clearer photo.");
        setIsAnalyzing(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto px-4 py-6 md:p-6">
      <div className="flex flex-col items-center justify-start min-h-full max-w-3xl mx-auto w-full relative pb-10">
      {onBack && (
          <button onClick={onBack} className="absolute top-6 left-4 md:left-0 p-2 hover:bg-white/10 rounded-lg text-amber-200/60 hover:text-white transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
      )}

      <div className="w-full bg-[#1a0f0a] rounded-2xl shadow-xl overflow-hidden border border-[#5d4037]">
        <div className="p-6 border-b border-[#5d4037] bg-[#2d1b15]">
          <h2 className="text-2xl font-bold text-amber-100 mb-2">Smart Tab Scanner</h2>
          <p className="text-amber-500/60 text-sm">Upload a photo of handwritten notes or chord charts to digitize them instantly.</p>
        </div>

        <div className="p-5 md:p-8">
          {!selectedImage ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#5d4037] rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-[#2d1b15] hover:border-amber-600 transition-all group"
            >
              <div className="w-16 h-16 rounded-full bg-[#2d1b15] flex items-center justify-center mb-4 group-hover:bg-amber-600/20 group-hover:text-amber-500 transition-colors">
                <Camera className="w-8 h-8 text-amber-700 group-hover:text-amber-500" />
              </div>
              <h3 className="text-lg font-medium text-amber-100 mb-1">Upload Photo</h3>
              <p className="text-sm text-amber-900">Click to select or drop file here</p>
              <input 
                ref={fileInputRef} 
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleFileChange}
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="relative rounded-xl overflow-hidden bg-black h-[34vh] min-h-56 max-h-80 flex items-center justify-center shadow-inner border border-[#3e2723]">
                <img src={selectedImage} alt="Preview" className="max-h-full max-w-full object-contain" />
                <button 
                  onClick={() => { setSelectedImage(null); setResult(null); }}
                  className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-red-600 text-white rounded-full backdrop-blur transition-colors"
                >
                  <Upload className="w-4 h-4 rotate-45" />
                </button>
              </div>

              {!result && (
                <div className="space-y-4">
                  {isAnalyzing && (
                      <div className="space-y-2">
                        <div className="w-full bg-amber-950/40 rounded-full h-2.5 border border-amber-900/30 overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-amber-700 via-amber-500 to-amber-400 transition-all duration-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                        <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest text-center animate-pulse">
                            Processing Optical Notation...
                        </p>
                      </div>
                  )}
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="w-full py-4 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800/50 text-white rounded-xl font-bold text-lg shadow-lg shadow-amber-900/20 transition-all flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <FileText className="w-6 h-6" />
                        Scan & Convert
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 text-emerald-500 mb-2">
                <CheckCircle className="w-5 h-5" />
                <span className="font-bold">Scan Complete</span>
              </div>
              
              <div className="bg-[#0a0503] rounded-xl p-4 border border-[#3e2723] font-mono text-sm text-amber-200/80 max-h-[42vh] min-h-40 overflow-y-auto whitespace-pre-wrap shadow-inner custom-scrollbar">
                {result}
              </div>

              <button
                onClick={() => onCreateFromAnalysis(result)}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2"
              >
                Open in Composer
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default ImageAnalyzer;
