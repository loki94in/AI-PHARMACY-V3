import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, ScanLine, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiClient } from '../services/api';
import { useModalEscape } from '../services/keyboardShortcuts';

export interface LocalScanMedicineInfo {
  potentialName?: string;
  brandName?: string;
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
  initialMode?: 'medicine' | 'prescription';
}

const AICamera: React.FC<AICameraProps> = ({ onScanResult, onClose, initialMode = 'medicine' }) => {
  useModalEscape(true, onClose);
  const [scanMode, setScanMode] = useState<'medicine' | 'prescription'>(initialMode);
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
  const [reviewResult, setReviewResult] = useState<{
    fullResult: LocalScanResult;
    originalName: string;
  } | null>(null);
  const [editedName, setEditedName] = useState<string>('');

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
    setReviewResult(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    // Viewfinder cropping: crop center 75% region to eliminate countertop clutter & background text
    const cropW = Math.round(vWidth * 0.75);
    const cropH = Math.round(vHeight * 0.75);
    const cropX = Math.round((vWidth - cropW) / 2);
    const cropY = Math.round((vHeight - cropH) / 2);

    canvas.width = cropW;
    canvas.height = cropH;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    
    context.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const base64Image = canvas.toDataURL('image/jpeg', 0.85);

    try {
      if (scanMode === 'prescription') {
        const response = await apiClient.post('/prescriptions/scan', {
          imageBase64: base64Image,
          source: 'pos'
        });
        if (response.data && (response.data.scan || response.data.items || response.data.scanId)) {
          const items = response.data.items || response.data.scan?.items || [];
          const matchedNames: string[] = items
            .map((it: { matched_medicine_name?: string; brandHint?: string; brandName?: string; name?: string; line_text?: string; rawText?: string }) =>
              it.brandHint || it.matched_medicine_name || it.brandName || it.name || it.line_text || it.rawText
            )
            .filter((name: string | undefined): name is string => Boolean(name));
          const fullResult: LocalScanResult = {
            text: items.map((it: { rawText?: string; line_text?: string; brandHint?: string }) => it.rawText || it.line_text || it.brandHint || '').join('\n'),
            confidence: response.data.confidence || response.data.scan?.confidence || 0.85,
            capturedImage: base64Image,
            matches: matchedNames,
            medicineInfo: {
              potentialName: matchedNames[0] || 'Prescription Items',
              genericName: items[0]?.dosageForm || items[0]?.dosage_group,
              strengthConfirmed: items.length > 0,
              confirmationNote: `${items.length} items parsed from prescription`
            }
          };
          setVerificationFeedback({
            confirmed: items.length > 0,
            name: `${items.length} Items Detected`,
            note: matchedNames.slice(0, 3).join(', '),
            result: fullResult
          });
          setTimeout(() => {
            onScanResult(fullResult);
          }, 800);
          return;
        }
      }

      // Default medicine box/strip OCR endpoint: POST /api/aicamera/analyze
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

        // Human-in-the-Loop Review step: allows pharmacist to inspect or edit the clean medicine name
        setEditedName(candidateName);
        setReviewResult({
          fullResult,
          originalName: candidateName
        });
      }
    } catch (err) {
      const e = err as LocalApiError;
      setError(e.response?.data?.error || 'Failed to process image');
    } finally {
      setProcessing(false);
    }
  };

  const handleApprove = () => {
    if (!reviewResult) return;
    const { fullResult, originalName } = reviewResult;
    const finalName = editedName.trim() || originalName;

    // If the pharmacist manually corrected the name, teach the AI engine
    if (finalName.toLowerCase() !== originalName.toLowerCase() && fullResult.text) {
      apiClient.post('/aicamera/learn', {
        ocrText: fullResult.text,
        correctName: finalName
      }).catch(err => console.warn('Failed to submit learning correction:', err));
    }

    // Apply the confirmed clean name to the result object
    if (!fullResult.medicineInfo) fullResult.medicineInfo = {};
    fullResult.medicineInfo.potentialName = finalName;
    fullResult.medicineInfo.brandName = finalName;
    if (Array.isArray(fullResult.matches)) {
      fullResult.matches[0] = finalName;
    } else {
      fullResult.matches = [finalName];
    }

    onScanResult(fullResult);
  };

  const handleRetake = () => {
    setReviewResult(null);
    setVerificationFeedback(null);
    setError(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-camera flex items-center justify-center p-4 bg-bg/85 backdrop-blur-sm fade-in">
      <div className="bg-bg2 border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold flex items-center gap-2 text-text">
              <Camera className="text-primary" /> AI Scanner
            </h3>
            <div className="flex items-center gap-1 bg-bg p-1 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => { setScanMode('medicine'); setReviewResult(null); }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                  scanMode === 'medicine' ? 'bg-primary text-white' : 'text-muted hover:text-text'
                }`}
              >
                Box/Strip
              </button>
              <button
                type="button"
                onClick={() => { setScanMode('prescription'); setReviewResult(null); }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                  scanMode === 'prescription' ? 'bg-primary text-white' : 'text-muted hover:text-text'
                }`}
              >
                Prescription
              </button>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close camera" title="Close camera" className="p-2 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-colors cursor-pointer">
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
          
          {/* Scanning Viewfinder Overlay */}
          <div className="absolute inset-0 pointer-events-none border-2 border-primary/40 m-6 rounded-2xl flex flex-col items-center justify-center gap-3 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
            {processing && (
              <div className="flex flex-col items-center bg-bg2/90 p-4 rounded-xl backdrop-blur border border-border">
                <Loader2 className="animate-spin text-primary mb-2" size={32} />
                <span className="font-semibold text-text animate-pulse">Scanning Packaging & Strength...</span>
              </div>
            )}

            {/* Verification Status Badge (brief visual indicator) */}
            {verificationFeedback && !reviewResult && (
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
        
        {/* Human-in-the-Loop Review Panel vs Capture Button */}
        {reviewResult ? (
          <div className="p-4 bg-bg2 border-t border-border flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {reviewResult.fullResult.medicineInfo?.strengthConfirmed || reviewResult.fullResult.medicineInfo?.volumeConfirmed ? (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-green bg-green/15 border border-green/30 px-2.5 py-0.5 rounded-lg">
                    <ShieldCheck size={14} /> Packaging Verified
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-amber-500 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-lg">
                    <AlertTriangle size={14} /> Review Medicine Name
                  </span>
                )}
                {reviewResult.fullResult.medicineInfo?.confirmationNote && (
                  <span className="text-xs text-muted truncate max-w-sm">
                    {reviewResult.fullResult.medicineInfo.confirmationNote}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted">Press Enter ↵ to Approve</span>
            </div>

            {/* Editable Medicine Name Input */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted flex items-center justify-between">
                <span>Medicine Name (Clean Trade Brand):</span>
                <span className="text-[11px] text-muted">Editable if OCR had a typo</span>
              </label>
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApprove();
                  }
                }}
                autoFocus
                placeholder="Enter clean medicine name..."
                className="w-full px-3 py-2 bg-bg border border-border focus:border-primary focus:ring-1 focus:ring-primary rounded-xl text-text font-bold text-base outline-none transition-all shadow-inner"
              />
            </div>

            {/* Detected Metadata Tags */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {reviewResult.fullResult.medicineInfo?.dosageForm && (
                <span className="px-2 py-0.5 bg-bg3 border border-border rounded-md text-text">
                  Form: <strong>{reviewResult.fullResult.medicineInfo.dosageForm}</strong>
                </span>
              )}
              {reviewResult.fullResult.medicineInfo?.strength && (
                <span className="px-2 py-0.5 bg-bg3 border border-border rounded-md text-text">
                  Strength: <strong>{reviewResult.fullResult.medicineInfo.strength}</strong>
                </span>
              )}
              {reviewResult.fullResult.medicineInfo?.batchNumber && (
                <span className="px-2 py-0.5 bg-bg3 border border-border rounded-md text-text">
                  Batch: <strong>{reviewResult.fullResult.medicineInfo.batchNumber}</strong>
                </span>
              )}
              {reviewResult.fullResult.medicineInfo?.expiryDate && (
                <span className="px-2 py-0.5 bg-bg3 border border-border rounded-md text-text">
                  Exp: <strong>{reviewResult.fullResult.medicineInfo.expiryDate}</strong>
                </span>
              )}
              {reviewResult.fullResult.medicineInfo?.mrp && (
                <span className="px-2 py-0.5 bg-bg3 border border-border rounded-md text-text">
                  MRP: <strong>₹{reviewResult.fullResult.medicineInfo.mrp}</strong>
                </span>
              )}
              {reviewResult.fullResult.medicineInfo?.manufacturer && (
                <span className="px-2 py-0.5 bg-bg3 border border-border rounded-md text-muted truncate max-w-[180px]">
                  Mfr: {reviewResult.fullResult.medicineInfo.manufacturer}
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
              <button
                type="button"
                onClick={handleRetake}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text bg-bg3 hover:bg-bg border border-border transition-colors cursor-pointer"
              >
                Retake Photo
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-green hover:bg-emerald-600 transition-all shadow-md cursor-pointer hover:-translate-y-px"
              >
                <ShieldCheck size={16} /> Approve & Add to Cart
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 bg-bg3/50 flex justify-center border-t border-border">
            <button 
              onClick={captureAndAnalyze} 
              disabled={processing || !!error}
              className={`
                flex items-center gap-2 px-8 py-3.5 rounded-full font-bold text-base transition-all
                ${processing || !!error 
                  ? 'bg-muted/20 text-muted cursor-not-allowed' 
                  : 'bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:scale-105 active:scale-95 cursor-pointer'}
              `}
            >
              {processing ? <Loader2 className="animate-spin" /> : <ScanLine />}
              {processing ? 'Processing OCR...' : 'Capture & Analyze'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default AICamera;
