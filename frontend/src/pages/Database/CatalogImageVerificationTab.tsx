import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle2, XCircle, RefreshCw, Eye, Trash2, Search,
  ShieldCheck, AlertTriangle, AlertCircle, ArrowRight, ArrowLeft,
  Upload, ZoomIn, X, ExternalLink, Database, Check, Sparkles, Wrench, Activity,
  Camera, Package, Pill, Layers, ChevronRight, ChevronLeft, Plus, Download, Filter
} from 'lucide-react';
import { api } from '../../services/api';
import type { CatalogImageItem, CatalogImageCounts } from '../../services/api';
import { toastEvent } from '../../services/events';

interface Props {
  initialFilter?: string;
}

interface StandardSlot {
  id: string;
  label: string;
  shortLabel: string;
  badge: string;
  desc: string;
  icon: React.FC<{ size?: number; className?: string }>;
}

const STANDARD_SLOTS: StandardSlot[] = [
  { id: 'combined', label: 'Front & Back (Combined)', shortLabel: 'Combined', badge: '⭐ 2-in-1', desc: 'Dual-sided composite packaging', icon: Layers },
  { id: 'back', label: 'Back / Blister View', shortLabel: 'Back', badge: '📸 Reverse', desc: 'Active salts, batch & expiry', icon: Camera },
  { id: 'box', label: 'Packaging Box', shortLabel: 'Box', badge: '📦 Carton', desc: 'Outer distributor packaging carton', icon: Package },
  { id: 'tablet', label: 'Tablet / Pill', shortLabel: 'Pill', badge: '💊 Dosage', desc: 'Physical formulation close-up', icon: Pill },
];

export const CatalogImageVerificationTab: React.FC<Props> = ({ initialFilter = 'review' }) => {
  // Main view state
  const [filter, setFilter] = useState<string>(initialFilter);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [medicines, setMedicines] = useState<CatalogImageItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<CatalogImageCounts>({
    total: 0,
    pending_review: 0,
    high_confidence: 0,
    approved: 0,
    rejected: 0,
    removed: 0,
    missing_angles: 0
  });

  // Active medicine in right detail pane
  const [selectedMedicineId, setSelectedMedicineId] = useState<number | null>(null);
  const [activeGallery, setActiveGallery] = useState<CatalogImageItem[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);

  // Online candidate drawer state
  const [candidateTrayOpen, setCandidateTrayOpen] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [targetSlotForCandidate, setTargetSlotForCandidate] = useState<string>('combined');

  // Modals
  const [inspectedImage, setInspectedImage] = useState<{ url: string; label: string; item?: CatalogImageItem } | null>(null);
  const [replacingSlot, setReplacingSlot] = useState<{ slotId: string; imageId?: number } | null>(null);
  const [customImagePath, setCustomImagePath] = useState('');
  const [customSourceUrl, setCustomSourceUrl] = useState('');

  // Mark Incorrect Modal
  const [incorrectModalItem, setIncorrectModalItem] = useState<CatalogImageItem | null>(null);
  const [incorrectReasonCode, setIncorrectReasonCode] = useState('NEED_BACKSIDE');
  const [customIncorrectNote, setCustomIncorrectNote] = useState('');

  // Reject Confirmation Modal
  const [rejectingImage, setRejectingImage] = useState<CatalogImageItem | null>(null);
  const [rejectReason, setRejectReason] = useState('Incorrect brand or packaging view');

  // Health Audit & Repair States
  const [auditReport, setAuditReport] = useState<any | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [autoApproving, setAutoApproving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [scanning, setScanning] = useState(false);

  // View mode: 'grid' = existing split-pane, 'review' = flashcard one-by-one
  const [viewMode, setViewMode] = useState<'grid' | 'review'>('grid');

  // Flashcard review queue state
  const [reviewQueue, setReviewQueue] = useState<CatalogImageItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  // Inline edit state for the current flashcard item
  const [fcEdits, setFcEdits] = useState<{ name?: string; manufacturer?: string; mrp?: string }>({});
  const [fcEditingField, setFcEditingField] = useState<string | null>(null);
  const [fcApproving, setFcApproving] = useState(false);
  const [fcRejecting, setFcRejecting] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load status counts
  const loadCounts = useCallback(() => {
    api.getCatalogImageCounts()
      .then(res => {
        if (res.success && res.counts) {
          setCounts(res.counts);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch unique medicine list for left pane
  const loadMedicines = useCallback(() => {
    setLoading(true);
    api.getCatalogImages({
      status: filter === 'all' ? undefined : filter,
      search: debouncedSearch || undefined,
      group_by_medicine: true,
      page,
      limit: 30
    })
      .then(res => {
        if (res.success) {
          const list = res.images || [];
          setMedicines(list);
          setTotalCount(res.totalCount || 0);
          setTotalPages(res.totalPages || 1);

          // Auto-select first medicine if none is selected
          if (list.length > 0) {
            if (!selectedMedicineId || !list.some(m => m.medicine_id === selectedMedicineId)) {
              setSelectedMedicineId(list[0].medicine_id);
            }
          } else {
            setSelectedMedicineId(null);
            setActiveGallery([]);
          }
        }
      })
      .catch(err => {
        toastEvent.trigger('Failed to load catalog images: ' + err.message, 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [filter, debouncedSearch, page, selectedMedicineId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    loadMedicines();
  }, [filter, debouncedSearch, page]);

  // Fetch all 4 multi-angle slots for the active medicine
  const fetchMedicineGallery = useCallback(async (medicineId: number) => {
    setLoadingGallery(true);
    try {
      const res = await api.getMedicineImageGallery(medicineId);
      if (res.success) {
        setActiveGallery(res.images || []);
      }
    } catch (err: any) {
      console.error('[CatalogImageVerificationTab] Failed to fetch gallery:', err);
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  useEffect(() => {
    if (selectedMedicineId) {
      fetchMedicineGallery(selectedMedicineId);
      setCandidateTrayOpen(false);
      setCandidates([]);
    }
  }, [selectedMedicineId, fetchMedicineGallery]);

  // Derived selected medicine object
  const selectedMedicine = useMemo(() => {
    return medicines.find(m => m.medicine_id === selectedMedicineId) || medicines[0] || null;
  }, [medicines, selectedMedicineId]);

  // Map active gallery images to standard 4 slots
  const slotMap = useMemo(() => {
    const map: Record<string, CatalogImageItem | null> = {
      combined: null,
      back: null,
      box: null,
      tablet: null
    };

    activeGallery.forEach(img => {
      const type = (img.image_type || 'combined').toLowerCase();
      if (type.includes('back')) map.back = img;
      else if (type.includes('box')) map.box = img;
      else if (type.includes('tablet') || type.includes('pill') || type.includes('side')) map.tablet = img;
      else if (!map.combined) map.combined = img;
    });

    // If combined is empty, check if selected medicine primary image fits
    if (!map.combined && selectedMedicine) {
      map.combined = selectedMedicine;
    }

    return map;
  }, [activeGallery, selectedMedicine]);

  // Actions
  const handleApproveAll = async () => {
    if (!selectedMedicine) return;
    try {
      let approvedCount = 0;
      const imagesToApprove = activeGallery.length > 0 ? activeGallery : [selectedMedicine];
      for (const img of imagesToApprove) {
        if (img.id && img.verification_status !== 'APPROVED') {
          await api.markImageCorrect(img.id, 'admin', img.image_type, Boolean(img.is_primary));
          approvedCount++;
        }
      }
      toastEvent.trigger(`Approved all ${approvedCount || 1} valid packaging views for ${selectedMedicine.medicine_name || selectedMedicine.product_name}`, 'success');
      loadCounts();
      fetchMedicineGallery(selectedMedicine.medicine_id);
      loadMedicines();
    } catch (err: any) {
      toastEvent.trigger('Failed to approve images: ' + err.message, 'error');
    }
  };

  const handleSearchCandidates = async (slotId: string) => {
    if (!selectedMedicine) return;
    setTargetSlotForCandidate(slotId);
    setCandidateTrayOpen(true);
    setSearchingCandidates(true);
    try {
      const query = selectedMedicine.medicine_name || selectedMedicine.product_name;
      const refId = slotMap[slotId]?.id || selectedMedicine.id;
      const res = await api.searchCandidateImages(refId, query, slotId);
      if (res.success && res.candidates) {
        setCandidates(res.candidates);
        if (res.candidates.length === 0) {
          toastEvent.trigger('No new online candidates found. Try custom URL or upload.', 'info');
        }
      }
    } catch (err: any) {
      toastEvent.trigger('Search candidates error: ' + err.message, 'error');
    } finally {
      setSearchingCandidates(false);
    }
  };

  const handleAssignCandidate = async (candidate: any, slotId: string) => {
    if (!selectedMedicine) return;
    try {
      const targetImg = slotMap[slotId] || selectedMedicine;
      const res = await api.replaceWithCandidate(targetImg.id, {
        candidate_url: candidate.imageUrl,
        candidate_title: candidate.name,
        verified_by: 'admin',
        image_type: slotId,
        is_primary: slotId === 'combined',
        keep_existing: slotId !== 'combined'
      });
      if (res.success) {
        toastEvent.trigger(`Assigned candidate to ${slotId.toUpperCase()} slot!`, 'success');
        fetchMedicineGallery(selectedMedicine.medicine_id);
        loadCounts();
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to assign candidate: ' + err.message, 'error');
    }
  };

  const handleConfirmIncorrect = async () => {
    if (!incorrectModalItem) return;
    try {
      const res = await api.markImageIncorrect(
        incorrectModalItem.id,
        customIncorrectNote || incorrectReasonCode,
        'admin',
        incorrectReasonCode
      );
      if (res.success) {
        toastEvent.trigger('Marked incorrect. Candidate logged and redownload scheduled.', 'info');
        loadCounts();
        if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
        loadMedicines();
        setIncorrectModalItem(null);
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to mark incorrect: ' + err.message, 'error');
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingImage) return;
    try {
      const res = await api.rejectCatalogImage(rejectingImage.id, rejectReason);
      if (res.success) {
        toastEvent.trigger(`Rejected image. Candidate excluded from future matches.`, 'info');
        loadCounts();
        if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
        loadMedicines();
        setRejectingImage(null);
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to reject: ' + err.message, 'error');
    }
  };

  const handleConfirmReplace = async () => {
    if (!replacingSlot || !customImagePath) return;
    try {
      const targetId = replacingSlot.imageId || selectedMedicine?.id;
      if (!targetId) return;
      const res = await api.replaceCatalogImage(targetId, {
        new_image_path: customImagePath,
        source_url: customSourceUrl || undefined
      });
      if (res.success) {
        toastEvent.trigger('Image replaced successfully', 'success');
        if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
        loadCounts();
        setReplacingSlot(null);
        setCustomImagePath('');
        setCustomSourceUrl('');
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to replace: ' + err.message, 'error');
    }
  };

  const handleNextMedicine = () => {
    const currentIndex = medicines.findIndex(m => m.medicine_id === selectedMedicineId);
    if (currentIndex >= 0 && currentIndex < medicines.length - 1) {
      setSelectedMedicineId(medicines[currentIndex + 1].medicine_id);
    } else if (page < totalPages) {
      setPage(p => p + 1);
    }
  };

  const handlePrevMedicine = () => {
    const currentIndex = medicines.findIndex(m => m.medicine_id === selectedMedicineId);
    if (currentIndex > 0) {
      setSelectedMedicineId(medicines[currentIndex - 1].medicine_id);
    } else if (page > 1) {
      setPage(p => p - 1);
    }
  };

  // Top header actions
  const handleAuditHealth = async () => {
    setAuditing(true);
    try {
      const res = await api.auditCatalogImages();
      if (res.success) {
        setAuditReport(res);
        toastEvent.trigger(`Audit Complete: ${res.summary.healthyActive} healthy active images.`, 'info');
        loadCounts();
      }
    } catch (err: any) {
      toastEvent.trigger('Audit failed: ' + err.message, 'error');
    } finally {
      setAuditing(false);
    }
  };

  const handleAutoApprove = async () => {
    setAutoApproving(true);
    try {
      const res = await api.autoApproveCatalogImages();
      if (res.success) {
        toastEvent.trigger(res.message || `Auto-approved ${res.approved} high-confidence images!`, 'success');
        loadCounts();
        loadMedicines();
      }
    } catch (err: any) {
      toastEvent.trigger('Auto-approve failed: ' + err.message, 'error');
    } finally {
      setAutoApproving(false);
    }
  };

  const handleRepairMissing = async () => {
    setRepairing(true);
    try {
      const res = await api.repairMissingCatalogImages(50);
      if (res.success) {
        toastEvent.trigger(res.message || `Repaired ${res.repaired} missing images!`, 'success');
        loadCounts();
        loadMedicines();
      }
    } catch (err: any) {
      toastEvent.trigger('Repair failed: ' + err.message, 'error');
    } finally {
      setRepairing(false);
    }
  };

  // Scan local uploads/products/ and auto-match filenames
  const handleScanLocal = async () => {
    setScanning(true);
    try {
      const res = await api.scanLocalImages();
      if (res.success) {
        toastEvent.trigger(
          `✅ Scan done: ${res.matched} auto-matched, ${res.pending_review} need review, ${res.unmatched} unmatched, ${res.skipped} already linked.`,
          'success'
        );
        loadCounts();
        loadMedicines();
        // If review mode is open, reload the queue
        if (viewMode === 'review') loadReviewQueue();
      }
    } catch (err: any) {
      toastEvent.trigger('Scan failed: ' + err.message, 'error');
    } finally {
      setScanning(false);
    }
  };

  // Load PENDING_REVIEW items into the flashcard queue
  const loadReviewQueue = useCallback(async () => {
    setReviewLoading(true);
    try {
      const res = await api.getCatalogImages({ status: 'PENDING_REVIEW', group_by_medicine: false, limit: 200 });
      if (res.success) {
        setReviewQueue(res.images || []);
        setReviewIndex(0);
        setFcEdits({});
        setFcEditingField(null);
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to load review queue', 'error');
    } finally {
      setReviewLoading(false);
    }
  }, []);

  // Enter review mode
  const enterReviewMode = () => {
    setViewMode('review');
    loadReviewQueue();
  };

  // Advance to next flashcard item
  const advanceFlashcard = () => {
    setFcEdits({});
    setFcEditingField(null);
    setReviewIndex(prev => prev + 1);
  };

  // Flashcard: Approve current item (with optional medicine edits)
  const handleFcApprove = async () => {
    const item = reviewQueue[reviewIndex];
    if (!item) return;
    setFcApproving(true);
    const medicineEdits: { name?: string; manufacturer?: string; mrp?: number } = {};
    if (fcEdits.name !== undefined && fcEdits.name !== item.medicine_name) medicineEdits.name = fcEdits.name;
    if (fcEdits.manufacturer !== undefined && fcEdits.manufacturer !== item.company_name) medicineEdits.manufacturer = fcEdits.manufacturer;
    if (fcEdits.mrp !== undefined && fcEdits.mrp !== String(item.mrp)) medicineEdits.mrp = parseFloat(fcEdits.mrp);
    // Advance UI immediately — save fires in background
    advanceFlashcard();
    try {
      await api.approveCatalogImage(item.id, 'pharmacist', Object.keys(medicineEdits).length > 0 ? medicineEdits : undefined);
      loadCounts();
    } catch (err: any) {
      toastEvent.trigger('Approve failed silently: ' + err.message, 'error');
    } finally {
      setFcApproving(false);
    }
  };

  // Flashcard: Reject current item
  const handleFcReject = async () => {
    const item = reviewQueue[reviewIndex];
    if (!item) return;
    setFcRejecting(true);
    // Advance UI immediately
    advanceFlashcard();
    try {
      await api.rejectCatalogImage(item.id, 'Incorrect product image', 'pharmacist');
      loadCounts();
    } catch (err: any) {
      toastEvent.trigger('Reject failed silently: ' + err.message, 'error');
    } finally {
      setFcRejecting(false);
    }
  };

  // Flashcard: Skip (keep in queue)
  const handleFcSkip = () => {
    advanceFlashcard();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg text-text">
      {/* Top Console Navigation Bar */}
      <div className="px-5 py-3 border-b border-border bg-bg2 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <ShieldCheck size={18} />
            </div>
            <h2 className="text-base font-black text-text tracking-tight">Catalogue Image Connection & AI Verification</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30">
              WhatsApp Verification Mode
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            4-angle packaging suite. Select a medicine to view all images simultaneously, trigger inline re-fetching, and approve in 1 click.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Audit Image Health */}
          <button
            onClick={handleAuditHealth}
            disabled={auditing}
            className="px-3 py-1.5 bg-bg border border-border hover:bg-bg3 rounded-xl text-xs font-semibold text-text flex items-center gap-1.5 transition-all cursor-pointer"
            title="Scan database and physical folders to audit health"
          >
            <Activity size={13} className={auditing ? 'animate-spin text-primary' : 'text-emerald-400'} />
            <span>{auditing ? 'Auditing...' : 'Audit Health'}</span>
          </button>

          {/* Auto-Approve High Confidence */}
          <button
            onClick={handleAutoApprove}
            disabled={autoApproving}
            className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-xs font-bold text-emerald-400 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Auto-approve all pending images with confidence >= 80%"
          >
            <Sparkles size={13} className={autoApproving ? 'animate-spin' : ''} />
            <span>{autoApproving ? 'Approving...' : 'Auto-Approve (≥80%)'}</span>
          </button>

          {/* Repair Missing */}
          <button
            onClick={handleRepairMissing}
            disabled={repairing}
            className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-xl text-xs font-bold text-primary flex items-center gap-1.5 transition-all cursor-pointer"
            title="Re-download missing images from verified pharma repositories"
          >
            <Wrench size={13} className={repairing ? 'animate-spin' : ''} />
            <span>{repairing ? 'Repairing...' : 'Repair Missing'}</span>
          </button>

          {/* Auto-Match All — filename-based auto-link */}
          <button
            id="catalog-scan-local-btn"
            onClick={handleScanLocal}
            disabled={scanning}
            className="px-3 py-1.5 bg-sky/10 hover:bg-sky/20 border border-sky/30 rounded-xl text-xs font-bold text-sky flex items-center gap-1.5 transition-all cursor-pointer"
            title="Parse filenames in uploads/products/ and auto-link to medicines"
          >
            <Download size={13} className={scanning ? 'animate-spin' : ''} />
            <span>{scanning ? 'Scanning...' : 'Auto-Match All'}</span>
          </button>

          {/* Review Mode toggle */}
          <button
            id="catalog-review-mode-btn"
            onClick={viewMode === 'review' ? () => setViewMode('grid') : enterReviewMode}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
              viewMode === 'review'
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'bg-bg border-border hover:bg-bg3 text-text'
            }`}
            title={viewMode === 'review' ? 'Exit flashcard review mode' : 'Enter one-by-one flashcard review mode'}
          >
            <Eye size={13} />
            <span>{viewMode === 'review' ? 'Exit Review' : 'Review Mode'}</span>
            {counts.pending_review > 0 && viewMode !== 'review' && (
              <span className="bg-amber-500 text-white rounded-full px-1.5 py-0 text-[10px] font-black">{counts.pending_review}</span>
            )}
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* FLASHCARD REVIEW MODE */}
      {/* ============================================================ */}
      {viewMode === 'review' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {reviewLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw size={28} className="animate-spin text-primary" />
              <span className="ml-3 text-muted text-sm">Loading review queue…</span>
            </div>
          ) : reviewIndex >= reviewQueue.length ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
              <CheckCircle2 size={48} className="text-emerald-400" />
              <h3 className="text-xl font-black text-text">All Done!</h3>
              <p className="text-sm text-muted max-w-xs">No more images in the review queue. Run Auto-Match All to scan new images.</p>
              <button onClick={() => setViewMode('grid')} className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold transition-all hover:opacity-90">Back to Grid</button>
            </div>
          ) : (() => {
            const item = reviewQueue[reviewIndex];
            const imgUrl = item.image_path
              ? (item.image_path.startsWith('http') ? item.image_path : `/${item.image_path.replace(/\\/g, '/')}`)
              : null;
            const remaining = reviewQueue.length - reviewIndex;
            const done = reviewIndex;
            const pct = Math.round((done / reviewQueue.length) * 100);
            const displayName = fcEdits.name ?? item.medicine_name ?? item.product_name ?? '—';
            const displayMfr  = fcEdits.manufacturer ?? item.company_name ?? '—';
            const displayMrp  = fcEdits.mrp ?? (item.mrp != null ? String(item.mrp) : '—');

            return (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Progress bar */}
                <div className="px-6 pt-3 pb-2 border-b border-border bg-bg2 shrink-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-text">⚠️ Review Queue</span>
                    <span className="text-xs text-muted">{remaining} remaining of {reviewQueue.length}</span>
                  </div>
                  <div className="w-full h-1.5 bg-bg3 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Main card: image LEFT, details RIGHT */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

                  {/* Left: image preview */}
                  <div className="md:w-1/2 flex items-center justify-center bg-bg p-6 border-r border-border">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={displayName}
                        className="max-h-full max-w-full object-contain rounded-xl shadow-lg cursor-zoom-in"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-muted">
                        <Camera size={48} className="opacity-30" />
                        <span className="text-sm">No image preview</span>
                      </div>
                    )}
                  </div>

                  {/* Right: medicine details with inline edit */}
                  <div className="md:w-1/2 flex flex-col p-6 bg-bg2 overflow-y-auto">
                    <p className="text-[10px] text-muted uppercase font-bold tracking-widest mb-4">Matched To</p>

                    {/* Name field */}
                    <div className="mb-4">
                      <label className="text-[10px] text-muted font-semibold uppercase tracking-wider block mb-1">Medicine Name</label>
                      {fcEditingField === 'name' ? (
                        <input
                          id="fc-edit-name"
                          autoFocus
                          type="text"
                          value={displayName}
                          onChange={e => setFcEdits(p => ({ ...p, name: e.target.value }))}
                          onBlur={() => setFcEditingField(null)}
                          onKeyDown={e => e.key === 'Enter' && setFcEditingField(null)}
                          className="w-full bg-bg border border-primary rounded-lg px-3 py-2 text-sm font-semibold text-text outline-none"
                        />
                      ) : (
                        <div
                          onClick={() => setFcEditingField('name')}
                          className="flex items-center gap-2 group cursor-text px-3 py-2 rounded-lg hover:bg-bg3 border border-transparent hover:border-border transition-all"
                        >
                          <span className="text-sm font-bold text-text flex-1">{displayName}</span>
                          <span className="text-muted opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                        </div>
                      )}
                    </div>

                    {/* Manufacturer field */}
                    <div className="mb-4">
                      <label className="text-[10px] text-muted font-semibold uppercase tracking-wider block mb-1">Manufacturer</label>
                      {fcEditingField === 'manufacturer' ? (
                        <input
                          id="fc-edit-manufacturer"
                          autoFocus
                          type="text"
                          value={displayMfr}
                          onChange={e => setFcEdits(p => ({ ...p, manufacturer: e.target.value }))}
                          onBlur={() => setFcEditingField(null)}
                          onKeyDown={e => e.key === 'Enter' && setFcEditingField(null)}
                          className="w-full bg-bg border border-primary rounded-lg px-3 py-2 text-sm text-text outline-none"
                        />
                      ) : (
                        <div
                          onClick={() => setFcEditingField('manufacturer')}
                          className="flex items-center gap-2 group cursor-text px-3 py-2 rounded-lg hover:bg-bg3 border border-transparent hover:border-border transition-all"
                        >
                          <span className="text-sm text-text flex-1">{displayMfr}</span>
                          <span className="text-muted opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                        </div>
                      )}
                    </div>

                    {/* MRP field */}
                    <div className="mb-4">
                      <label className="text-[10px] text-muted font-semibold uppercase tracking-wider block mb-1">MRP (₹)</label>
                      {fcEditingField === 'mrp' ? (
                        <input
                          id="fc-edit-mrp"
                          autoFocus
                          type="number"
                          value={displayMrp}
                          onChange={e => setFcEdits(p => ({ ...p, mrp: e.target.value }))}
                          onBlur={() => setFcEditingField(null)}
                          onKeyDown={e => e.key === 'Enter' && setFcEditingField(null)}
                          className="w-full bg-bg border border-primary rounded-lg px-3 py-2 text-sm text-text outline-none"
                        />
                      ) : (
                        <div
                          onClick={() => setFcEditingField('mrp')}
                          className="flex items-center gap-2 group cursor-text px-3 py-2 rounded-lg hover:bg-bg3 border border-transparent hover:border-border transition-all"
                        >
                          <span className="text-sm text-text flex-1">₹{displayMrp}</span>
                          <span className="text-muted opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="text-xs text-muted space-y-1 mt-2">
                      {item.category && <div>Category: <span className="text-text font-medium">{item.category}</span></div>}
                      <div>Confidence: <span className={`font-bold ${
                        (item.confidence_score || 0) >= 85 ? 'text-emerald-400' :
                        (item.confidence_score || 0) >= 60 ? 'text-amber-400' : 'text-red-400'
                      }`}>{item.confidence_score ?? '—'}%</span></div>
                      <div>Image Type: <span className="text-text font-medium capitalize">{item.image_type || 'combined'}</span></div>
                      <div>Source: <span className="text-text font-medium">{item.match_source || item.image_source || '—'}</span></div>
                    </div>

                    {/* Inline edit tip */}
                    <p className="text-[10px] text-muted mt-4 italic">💡 Click any field to edit. Changes save when you Approve.</p>
                  </div>
                </div>

                {/* Action bar */}
                <div className="shrink-0 border-t border-border bg-bg2 px-6 py-4 flex items-center justify-center gap-4">
                  <button
                    id="fc-approve-btn"
                    onClick={handleFcApprove}
                    disabled={fcApproving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-500/20"
                  >
                    <Check size={16} />
                    {fcApproving ? 'Saving…' : 'Approve & Next'}
                  </button>
                  <button
                    id="fc-skip-btn"
                    onClick={handleFcSkip}
                    className="flex items-center gap-2 px-5 py-2.5 bg-bg border border-border hover:bg-bg3 text-muted rounded-xl text-sm font-semibold transition-all"
                  >
                    <ChevronRight size={16} />
                    Skip
                  </button>
                  <button
                    id="fc-reject-btn"
                    onClick={handleFcReject}
                    disabled={fcRejecting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-semibold transition-all"
                  >
                    <XCircle size={16} />
                    {fcRejecting ? 'Saving…' : 'Reject & Next'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* WhatsApp Web Split-Pane Body (Grid Mode) */}
      {viewMode === 'grid' && <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* LEFT PANE: WhatsApp-style Medicine List (~380px) */}
        <div className="w-full md:w-96 border-r border-border bg-bg2 flex flex-col shrink-0 h-full overflow-hidden">
          {/* Search Box */}
          <div className="p-3 border-b border-border space-y-2.5 bg-bg2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search medicine, company, salt..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-bg border border-border rounded-xl text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary shadow-xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-2.5 text-muted hover:text-text cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* WhatsApp Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => { setFilter('all'); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  filter === 'all'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-bg text-muted hover:text-text border border-border'
                }`}
              >
                <span>All</span>
                <span className="text-[10px] opacity-80">({counts.total})</span>
              </button>

              <button
                onClick={() => { setFilter('review'); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  filter === 'review' || filter === 'pending'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-bg text-muted hover:text-amber-400 border border-border'
                }`}
              >
                <span>Needs Review</span>
                <span className="text-[10px] opacity-80">({counts.pending_review})</span>
              </button>

              <button
                onClick={() => { setFilter('missing_angles'); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  filter === 'missing_angles'
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-bg text-muted hover:text-sky-400 border border-border'
                }`}
              >
                <span>Missing Angles</span>
                <span className="text-[10px] opacity-80">({counts.missing_angles || 0})</span>
              </button>

              <button
                onClick={() => { setFilter('approved'); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  filter === 'approved'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-bg text-muted hover:text-emerald-400 border border-border'
                }`}
              >
                <span>Approved</span>
                <span className="text-[10px] opacity-80">({counts.approved})</span>
              </button>

              <button
                onClick={() => { setFilter('rejected'); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  filter === 'rejected'
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'bg-bg text-muted hover:text-red-400 border border-border'
                }`}
              >
                <span>Rejected</span>
                <span className="text-[10px] opacity-80">({counts.rejected})</span>
              </button>
            </div>
          </div>

          {/* Medicines Scrollable List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/60">
            {loading ? (
              <div className="p-8 flex flex-col items-center justify-center gap-2 text-muted text-xs">
                <RefreshCw size={18} className="animate-spin text-primary" />
                <span>Loading catalogue inbox...</span>
              </div>
            ) : medicines.length === 0 ? (
              <div className="p-8 text-center text-muted space-y-1.5 text-xs">
                <Pill size={24} className="mx-auto text-muted/40" />
                <p className="font-bold text-text">No medicines match this filter</p>
                <p className="text-[11px]">Try switching filter chips or clearing the search term.</p>
              </div>
            ) : (
              medicines.map(med => {
                const isSelected = med.medicine_id === selectedMedicineId;
                const angleCount = typeof med.angle_count === 'number' ? med.angle_count : (med.is_active ? 1 : 0);
                const isApproved = med.verification_status === 'APPROVED';
                const isHigh = med.confidence_score >= 90;

                return (
                  <div
                    key={`${med.medicine_id}-${med.id}`}
                    onClick={() => setSelectedMedicineId(med.medicine_id)}
                    className={`p-3 flex items-center gap-3 cursor-pointer transition-colors relative ${
                      isSelected
                        ? 'bg-primary/10 border-l-4 border-primary'
                        : 'hover:bg-bg3/50'
                    }`}
                  >
                    {/* Thumbnail Avatar */}
                    <div className="w-12 h-12 rounded-xl bg-bg border border-border overflow-hidden flex items-center justify-center shrink-0 relative">
                      {med.image_path ? (
                        <img
                          src={med.image_path}
                          alt={med.product_name}
                          className="w-full h-full object-contain p-0.5"
                          onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <Pill size={18} className="text-muted/40" />
                      )}
                      {/* Mini Angle Indicator Dot */}
                      <span className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-bg ${
                        angleCount >= 3 ? 'bg-emerald-400' : angleCount >= 2 ? 'bg-sky-400' : 'bg-amber-400'
                      }`} />
                    </div>

                    {/* Text Details */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <h4 className={`text-xs font-bold truncate ${isSelected ? 'text-primary' : 'text-text'}`}>
                          {med.medicine_name || med.product_name}
                        </h4>
                        {/* Status Chip */}
                        {isApproved ? (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold shrink-0">
                            Approved
                          </span>
                        ) : isHigh ? (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400 font-bold shrink-0">
                            {med.confidence_score}%
                          </span>
                        ) : (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold shrink-0">
                            Review
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-muted truncate">
                        {med.manufacturer || med.company_name || 'General'}
                        {med.generic_name ? ` • ${med.generic_name}` : ''}
                      </p>

                      <div className="flex items-center justify-between text-[10px] text-muted pt-0.5">
                        <span className="font-semibold flex items-center gap-1">
                          <Camera size={10} className="text-sky-400" />
                          <span>{angleCount}/4 Angles</span>
                        </span>
                        {med.packaging && (
                          <span className="truncate max-w-[90px]">{med.packaging}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* List Pagination Footer */}
          <div className="p-2.5 border-t border-border bg-bg2 flex items-center justify-between text-xs text-muted">
            <span className="text-[11px]">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded-lg bg-bg border border-border hover:bg-bg3 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded-lg bg-bg border border-border hover:bg-bg3 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Active Medicine Detail & 4-Angle Workspace */}
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-bg">
          {!selectedMedicine ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-bg2 border border-border flex items-center justify-center text-primary/60">
                <ShieldCheck size={32} />
              </div>
              <h3 className="text-base font-bold text-text">Select a Medicine to Inspect All 4 Angles</h3>
              <p className="text-xs max-w-md">
                Click any product from the left inbox to view the complete multi-angle suite, verify composition details, and approve or fetch candidates.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Medicine Header Info Banner */}
              <div className="p-4 border-b border-border bg-bg2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-black text-text leading-tight">
                      {selectedMedicine.medicine_name || selectedMedicine.product_name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-md bg-bg border border-border text-[10px] font-bold text-sky uppercase">
                      {selectedMedicine.category || 'General'}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    Mfg: <strong className="text-text font-semibold">{selectedMedicine.manufacturer || selectedMedicine.company_name || 'Unspecified'}</strong>
                    {selectedMedicine.generic_name && (
                      <span> • Salt: <span className="font-mono text-text/90">{selectedMedicine.generic_name}</span></span>
                    )}
                    {selectedMedicine.packaging && <span> • Pack: {selectedMedicine.packaging}</span>}
                  </p>
                </div>

                {/* Navigation Arrows between medicines */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handlePrevMedicine}
                    className="p-1.5 rounded-xl bg-bg hover:bg-bg3 border border-border text-text cursor-pointer transition-colors"
                    title="Previous medicine (Arrow Left)"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    onClick={handleNextMedicine}
                    className="p-1.5 rounded-xl bg-bg hover:bg-bg3 border border-border text-text cursor-pointer transition-colors"
                    title="Next medicine (Arrow Right)"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>

              {/* Dedicated Quick-Action Bar */}
              <div className="px-4 py-2.5 border-b border-border bg-bg3/30 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
                <div className="flex items-center gap-2">
                  {/* Approve All Button */}
                  <button
                    onClick={handleApproveAll}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    title="Approve and activate all valid packaging views for this medicine"
                  >
                    <CheckCircle2 size={14} />
                    <span>Approve All Valid</span>
                  </button>

                  {/* Re-Fetch Candidates Online */}
                  <button
                    onClick={() => handleSearchCandidates('combined')}
                    disabled={searchingCandidates}
                    className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    title="Search online repositories (PharmEasy, 1mg) for fresh candidate packaging"
                  >
                    <RefreshCw size={13} className={searchingCandidates ? 'animate-spin' : ''} />
                    <span>Re-Fetch Online Candidates</span>
                  </button>

                  {/* Mark Incorrect */}
                  <button
                    onClick={() => {
                      setIncorrectModalItem(slotMap.combined || selectedMedicine);
                      setIncorrectReasonCode('NEED_BACKSIDE');
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Mark image incorrect and schedule smart candidate redownload"
                  >
                    <AlertTriangle size={13} />
                    <span>Mark Incorrect / Need Angle</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Skip / Next */}
                  <button
                    onClick={handleNextMedicine}
                    className="px-3 py-1.5 rounded-xl bg-bg hover:bg-bg3 border border-border text-xs font-semibold text-text flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>Skip to Next</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              {/* Central Scrollable Workspace: 2x2 Media Grid + Inline Candidates Drawer */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* 2x2 MULTI-ANGLE MEDIA GRID */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                      <Camera size={13} className="text-sky" />
                      <span>Standard Multi-Angle Packaging Suite (4 Slots)</span>
                    </span>
                    <span className="text-xs text-muted">
                      Active Images: <strong className="text-primary">{activeGallery.length}</strong> / 4
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {STANDARD_SLOTS.map(slot => {
                      const item = slotMap[slot.id];
                      const Icon = slot.icon;
                      const hasImage = Boolean(item && item.image_path);

                      return (
                        <div
                          key={slot.id}
                          className={`bg-bg2 border rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between transition-all group ${
                            hasImage ? 'border-border hover:border-primary/40' : 'border-dashed border-border/80 bg-bg3/20'
                          }`}
                        >
                          {/* Image Box */}
                          <div className="relative w-full h-52 bg-bg flex items-center justify-center p-3 overflow-hidden border-b border-border">
                            {hasImage ? (
                              <img
                                src={item!.image_path}
                                alt={slot.label}
                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                                onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-2 text-muted/50 p-4 text-center">
                                <Icon size={28} />
                                <span className="text-xs font-semibold text-muted">No {slot.shortLabel} View Yet</span>
                                <p className="text-[10px] text-muted/70 max-w-[180px]">{slot.desc}</p>
                              </div>
                            )}

                            {/* Slot Tag & Badge */}
                            <div className="absolute top-2 left-2 flex flex-col gap-1 z-10 pointer-events-none">
                              <span className="px-2 py-0.5 rounded-md bg-bg2/95 backdrop-blur-md border border-border text-[10px] font-bold text-text shadow-xs flex items-center gap-1">
                                <Icon size={11} className="text-sky" />
                                <span>{slot.label}</span>
                              </span>
                              {item?.confidence_score && (
                                <span className="px-1.5 py-0.5 rounded bg-sky/20 border border-sky/40 text-[9px] font-bold text-sky w-fit">
                                  {item.confidence_score}% Match
                                </span>
                              )}
                            </div>

                            {/* Status Pill on Top Right */}
                            {hasImage && (
                              <div className="absolute top-2 right-2 z-10 pointer-events-none">
                                {item!.verification_status === 'APPROVED' ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold shadow-xs flex items-center gap-0.5">
                                    <Check size={9} /> Approved
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-sky-600 text-white text-[9px] font-bold shadow-xs">
                                    Active
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Hover Overlay Tools (Populated) */}
                            {hasImage && (
                              <div className="absolute inset-0 bg-bg3/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-20">
                                <button
                                  type="button"
                                  onClick={() => setInspectedImage({ url: item!.image_path, label: slot.label, item: item! })}
                                  className="p-2 rounded-xl bg-bg/95 border border-border text-text hover:text-primary shadow-lg transition-transform hover:scale-110 cursor-pointer"
                                  title="Inspect full image in zoom lightbox"
                                >
                                  <ZoomIn size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSearchCandidates(slot.id)}
                                  className="p-2 rounded-xl bg-bg/95 border border-border text-text hover:text-sky shadow-lg transition-transform hover:scale-110 cursor-pointer"
                                  title="Re-fetch alternative candidates online for this angle"
                                >
                                  <RefreshCw size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setReplacingSlot({ slotId: slot.id, imageId: item!.id })}
                                  className="p-2 rounded-xl bg-bg/95 border border-border text-text hover:text-emerald-400 shadow-lg transition-transform hover:scale-110 cursor-pointer"
                                  title="Replace with custom image path or URL"
                                >
                                  <Upload size={16} />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Slot Bottom Controls */}
                          <div className="p-2.5 bg-bg2 flex items-center justify-between text-xs">
                            <span className="text-[11px] text-muted font-medium truncate max-w-[180px]">
                              {hasImage ? (item!.image_path || '').split('/').pop() : slot.badge}
                            </span>

                            {hasImage ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setInspectedImage({ url: item!.image_path, label: slot.label, item: item! })}
                                  className="text-[11px] font-bold text-sky hover:underline cursor-pointer"
                                >
                                  Zoom
                                </button>
                                <span className="text-muted/40">•</span>
                                <button
                                  type="button"
                                  onClick={() => handleSearchCandidates(slot.id)}
                                  className="text-[11px] font-bold text-text hover:text-primary cursor-pointer"
                                >
                                  Search
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSearchCandidates(slot.id)}
                                className="px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <Plus size={12} />
                                <span>Add {slot.shortLabel}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* INLINE ONLINE CANDIDATES DRAWER */}
                {candidateTrayOpen && (
                  <div className="p-4 rounded-2xl bg-bg2 border border-sky/40 space-y-3 shadow-md animate-in slide-in-from-bottom-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-sky" />
                        <h4 className="text-xs font-bold text-text">
                          Online Candidates for {selectedMedicine.medicine_name || selectedMedicine.product_name}
                          <span className="text-muted font-normal ml-1">
                            (Target Slot: <strong className="text-sky uppercase">{targetSlotForCandidate}</strong>)
                          </span>
                        </h4>
                      </div>
                      <button
                        onClick={() => setCandidateTrayOpen(false)}
                        className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 cursor-pointer"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    {searchingCandidates ? (
                      <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-muted">
                        <RefreshCw size={18} className="animate-spin text-sky" />
                        <span>Querying verified pharmaceutical repositories...</span>
                      </div>
                    ) : candidates.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted">
                        No online candidates found matching "{selectedMedicine.medicine_name}". You can use the Replace button to enter a direct packaging URL.
                      </div>
                    ) : (
                      <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
                        {candidates.map((cand, idx) => (
                          <div
                            key={cand.id || idx}
                            className="w-56 bg-bg border border-border rounded-xl p-2.5 flex flex-col justify-between gap-2 shrink-0 hover:border-primary/50 transition-all shadow-xs"
                          >
                            <div className="space-y-2">
                              {/* Candidate Image */}
                              <div className="relative w-full h-32 bg-bg3/30 rounded-lg overflow-hidden flex items-center justify-center p-1 border border-border/60">
                                <img
                                  src={cand.imageUrl}
                                  alt={cand.name}
                                  className="max-h-full max-w-full object-contain"
                                  onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                                />
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-sky-600 text-white text-[9px] font-bold">
                                  {cand.confidenceScore}% Match
                                </span>
                              </div>

                              <div>
                                <h5 className="text-[11px] font-bold text-text line-clamp-2 leading-tight" title={cand.name}>
                                  {cand.name}
                                </h5>
                                <p className="text-[10px] text-muted truncate mt-0.5">
                                  {cand.manufacturer || cand.source}
                                </p>
                              </div>
                            </div>

                            {/* 1-Click Slot Assignment Buttons */}
                            <div className="pt-2 border-t border-border space-y-1">
                              <button
                                onClick={() => handleAssignCandidate(cand, targetSlotForCandidate)}
                                className="w-full py-1.5 rounded-lg bg-primary text-white text-[10px] font-bold flex items-center justify-center gap-1 shadow-xs hover:opacity-90 cursor-pointer"
                              >
                                <Check size={11} />
                                <span>Assign to {targetSlotForCandidate.toUpperCase()}</span>
                              </button>
                              <div className="grid grid-cols-3 gap-1 text-[9px]">
                                {STANDARD_SLOTS.filter(s => s.id !== targetSlotForCandidate).map(s => (
                                  <button
                                    key={s.id}
                                    onClick={() => handleAssignCandidate(cand, s.id)}
                                    className="py-1 rounded bg-bg2 hover:bg-bg3 border border-border text-muted hover:text-text font-semibold truncate cursor-pointer"
                                    title={`Assign to ${s.label}`}
                                  >
                                    {s.shortLabel}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* LIGHTBOX ZOOM MODAL */}
      {inspectedImage && (
        <div
          className="fixed inset-0 z-50 bg-bg3/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setInspectedImage(null)}
        >
          <div
            className="bg-bg2 border border-border rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-sky uppercase">
                  {inspectedImage.label}
                </span>
                <h3 className="text-sm font-black text-text mt-0.5">
                  {selectedMedicine?.medicine_name || selectedMedicine?.product_name}
                </h3>
              </div>
              <button
                onClick={() => setInspectedImage(null)}
                className="p-1.5 rounded-lg bg-bg3 text-muted hover:text-text cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-4">
              <div className="bg-bg rounded-2xl p-4 flex items-center justify-center max-w-lg w-full aspect-square border border-border">
                <img
                  src={inspectedImage.url}
                  alt={inspectedImage.label}
                  className="max-h-full max-w-full object-contain drop-shadow-md"
                />
              </div>

              {inspectedImage.item && (
                <div className="w-full bg-bg3/50 p-3 rounded-xl border border-border space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">Verification Status:</span>
                    <span className="font-bold text-primary">{inspectedImage.item.verification_status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Confidence Score:</span>
                    <span className="font-bold text-text">{inspectedImage.item.confidence_score}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">File Path:</span>
                    <span className="font-mono text-muted text-[11px] truncate max-w-xs">{inspectedImage.item.image_path}</span>
                  </div>
                  {inspectedImage.item.verification_reason && (
                    <div className="pt-2 border-t border-border">
                      <span className="text-muted block text-[11px] mb-0.5">Verification Rationale:</span>
                      <p className="text-text/90 leading-relaxed text-[11px]">{inspectedImage.item.verification_reason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border flex justify-end gap-2 bg-bg">
              <button
                onClick={() => setInspectedImage(null)}
                className="px-4 py-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-text font-bold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MARK INCORRECT REASON MODAL */}
      {incorrectModalItem && (
        <div className="fixed inset-0 z-50 bg-bg3/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={20} />
              <h3 className="text-sm font-bold text-text">Mark Image Incorrect / Missing Angle</h3>
            </div>
            <p className="text-xs text-muted">
              Select the reason why this image requires correction. The AI pipeline will exclude this candidate and schedule a targeted search.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-text block">Correction Reason:</label>
              {[
                { code: 'NEED_BACKSIDE', label: 'Need Backside Image (Keep front, find reverse blister)' },
                { code: 'WRONG_BRAND', label: 'Incorrect Brand / Wrong Medicine' },
                { code: 'BLURRY_IMAGE', label: 'Blurry / Poor Resolution Packaging' },
                { code: 'WRONG_STRENGTH', label: 'Different Strength / Concentration' },
                { code: 'WRONG_FORM', label: 'Wrong Dosage Form (Tablet vs Syrup/Gel)' }
              ].map(opt => (
                <label
                  key={opt.code}
                  className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                    incorrectReasonCode === opt.code
                      ? 'border-primary bg-primary/10 text-text font-bold'
                      : 'border-border bg-bg text-muted hover:text-text'
                  }`}
                >
                  <input
                    type="radio"
                    name="reason_code"
                    value={opt.code}
                    checked={incorrectReasonCode === opt.code}
                    onChange={() => setIncorrectReasonCode(opt.code)}
                    className="accent-primary"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setIncorrectModalItem(null)}
                className="px-4 py-2 rounded-xl bg-bg border border-border text-muted hover:text-text text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmIncorrect}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs cursor-pointer shadow"
              >
                Confirm Correction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REPLACE IMAGE MODAL */}
      {replacingSlot && (
        <div className="fixed inset-0 z-50 bg-bg3/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">
                Replace {replacingSlot.slotId.toUpperCase()} Packaging Image
              </h3>
              <button onClick={() => setReplacingSlot(null)} className="text-muted hover:text-text cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted block mb-1">New Image Path or URL:</label>
                <input
                  type="text"
                  placeholder="/products/my-new-image.jpg or https://..."
                  value={customImagePath}
                  onChange={e => setCustomImagePath(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-muted block mb-1">Source URL (optional):</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={customSourceUrl}
                  onChange={e => setCustomSourceUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-text font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setReplacingSlot(null)}
                className="px-4 py-2 rounded-xl bg-bg border border-border text-muted hover:text-text text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReplace}
                disabled={!customImagePath}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs disabled:opacity-40 cursor-pointer shadow"
              >
                Save Replacement
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

