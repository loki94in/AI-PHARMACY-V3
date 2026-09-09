import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, ScanLine, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiClient } from '../services/api';
import { useModalEscape } from '../services/keyboardShortcuts';

export interface LocalScanMedicineInfo {
  potentialName?: string;
  batchNumber?: string;
  expiryDate?: string;
  mrp?: number;
  costPrice?: number;
  packaging?: string;
  dosageForm?: string;
  strength?: string;
  manufacturer?: string;
  apiName?: string;
  genericName?: string;
  strengthConfirmed?: boolean;
  strengthConflict?: boolean;
  modifierConflict?: boolean;
  volumeConfirmed?: boolean;
  confirmationNote?: string;
}

export interface LocalScanResult {
  text?: string;
  confidence?: number;
  capturedImage?: string;
  medicineInfo?: LocalScanMedicineInfo;
  matches?: string[];
  fallbackUsed?: boolean;
}

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

interface AICameraProps {
  onScanResult: (result: LocalScanResult) => void;
  onClose: () => void;
}

const AICamera: React.FC<AICameraProps> = ({ onScanResult, onClose }) => {
  useModalEscape(true, onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<{
    confirmed: boolean;
    name: string;
    strength?: string;
    note?: string;
    result: LocalScanResult;
  } | null>(null);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(mediaStream);
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setError('Could not access camera. Please allow permissions.');
      console.error(err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async camera permission/device init
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setProcessing(true);
    setError(null);
    setVerificationFeedback(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);

    try {
      // Endpoint from the backend: POST /api/aicamera/analyze
      const response = await apiClient.post('/aicamera/analyze', { image: base64Image });
      if (response.data) {
        const fullResult: LocalScanResult = { ...response.data, capturedImage: base64Image };
        const medInfo = fullResult.medicineInfo || {};
        const isConfirmed = medInfo.strengthConfirmed === true || medInfo.volumeConfirmed === true;
        const candidateName = medInfo.potentialName || (fullResult.matches && fullResult.matches[0]) || 'Detected Medicine';

        setVerificationFeedback({
          confirmed: isConfirmed,
          name: candidateName,
          strength: medInfo.strength,
          note: medInfo.confirmationNote,
          result: fullResult
        });

        // Fast auto-dispatch if confirmed, or brief pause for visual safety feedback
        setTimeout(() => {
          onScanResult(fullResult);
        }, isConfirmed ? 600 : 1200);
      }
    } catch (err) {
      const e = err as LocalApiError;
      setError(e.response?.data?.error || 'Failed to process image');
    } finally {
      setProcessing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-camera flex items-center justify-center p-4 bg-bg/85 backdrop-blur-sm fade-in">
      <div className="bg-bg2 border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50">
          <h3 className="text-lg font-bold flex items-center gap-2 text-text">
            <Camera className="text-primary" /> AI Prescription & Product Scanner
          </h3>
          <button onClick={onClose} aria-label="Close camera" title="Close camera" className="p-2 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="relative aspect-video bg-bg flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="text-red p-4 text-center">{error}</div>
          ) : (
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
          )}
          
          {/* Scanning Overlay */}
          <div className="absolute inset-0 pointer-events-none border-2 border-primary/30 m-8 rounded-xl flex flex-col items-center justify-center gap-3">
            {processing && (
              <div className="flex flex-col items-center bg-bg2/90 p-4 rounded-xl backdrop-blur border border-border">
                <Loader2 className="animate-spin text-primary mb-2" size={32} />
                <span className="font-semibold text-text animate-pulse">Scanning Packaging & Strength...</span>
              </div>
            )}

            {/* Verification Status Badge */}
            {verificationFeedback && (
              <div className={`
                pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl border backdrop-blur shadow-lg animate-in zoom-in-95 duration-200
                ${verificationFeedback.confirmed 
                  ? 'bg-green/15 border-green/40 text-green' 
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-500'}
              `}>
                {verificationFeedback.confirmed ? (
                  <ShieldCheck size={22} className="shrink-0 text-green" />
                ) : (
                  <AlertTriangle size={22} className="shrink-0 text-amber-500" />
                )}
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold leading-tight">
                    {verificationFeedback.confirmed ? 'Packaging Verified' : 'Check Packaging'}
                  </span>
                  <span className="text-xs opacity-90 leading-tight">
                    {verificationFeedback.name} {verificationFeedback.strength ? `(${verificationFeedback.strength})` : ''}
                  </span>
                </div>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
        
        <div className="p-6 bg-bg3/50 flex justify-center border-t border-border">
          <button 
            onClick={captureAndAnalyze} 
            disabled={processing || !!error}
            className={`
              flex items-center gap-2 px-8 py-4 rounded-full font-bold text-lg transition-all
              ${processing || !!error 
                ? 'bg-muted/20 text-muted cursor-not-allowed' 
                : 'bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:scale-105 active:scale-95'}
            `}
          >
            {processing ? <Loader2 className="animate-spin" /> : <ScanLine />}
            {processing ? 'Processing OCR...' : 'Capture & Analyze'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AICamera;
