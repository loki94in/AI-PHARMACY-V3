import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CheckCircle2, XCircle, RefreshCw, Eye, Trash2, Search,
  ShieldCheck, AlertTriangle, AlertCircle, ArrowRight, ArrowLeft,
  Upload, ZoomIn, ZoomOut, Maximize2, RotateCw, X, ExternalLink,
  Database, Check, Sparkles, Wrench, Activity, Camera, Package,
  Pill, Layers, ChevronRight, ChevronLeft, Plus, Download, Filter,
  History, Undo2, ArrowLeftRight, Columns, LayoutGrid
} from 'lucide-react';
import { api } from '../../services/api';
import type { CatalogImageItem, CatalogImageCounts } from '../../services/api';
import { toastEvent } from '../../services/events';

interface Props {
  initialFilter?: string;
}

export interface StandardSlot {
  id: string;
  label: string;
  shortLabel: string;
  badge: string;
  desc: string;
  icon: React.FC<{ size?: number; className?: string }>;
}

export const STANDARD_SLOTS: StandardSlot[] = [
  { id: 'combined', label: '⭐ Combined (2-in-1)', shortLabel: 'Combined', badge: '⭐ 2-in-1', desc: 'Dual-sided composite packaging (Primary)', icon: Layers },
  { id: 'front', label: '📸 Front Face', shortLabel: 'Front', badge: 'Front', desc: 'Brand name & strength face', icon: Eye },
  { id: 'back', label: '📸 Back / Blister', shortLabel: 'Back', badge: 'Back', desc: 'Active salts, batch & expiry composition', icon: Camera },
  { id: 'box', label: '📦 Outer Box', shortLabel: 'Box', badge: 'Box', desc: 'Carton distributor packaging', icon: Package },
  { id: 'tablet', label: '💊 Tablet / Pill', shortLabel: 'Pill', badge: 'Pill', desc: 'Physical formulation close-up', icon: Pill },
];

export const REASON_OPTIONS = [
  {
    code: 'NEED_BACKSIDE',
    title: 'Need Backside Image',
    subtitle: 'Keep current image as Front, and search for the rear composition / blister.',
    badge: '📸 Keep Front + Add Back',
    badgeColor: 'text-sky bg-sky/10 border-sky/30',
  },
  {
    code: 'NEED_FRONT',
    title: 'Need Front Side Image',
    subtitle: 'Current image is Back or Box; save it as rear and search for main front face.',
    badge: '🖼️ Save Back + Find Front',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  {
    code: 'NEED_COMBINED',
    title: 'Need Combined Front + Back',
    subtitle: 'Search for a 2-in-1 composite picture showing both sides together.',
    badge: '🔲 2-in-1 Composite',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
  {
    code: 'WRONG_VARIANT',
    title: 'Wrong Strength / Variant',
    subtitle: 'Right medicine brand, but wrong strength (e.g. 500mg vs 650mg), flavor, or count.',
    badge: '🔄 Wrong Variant',
    badgeColor: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  },
  {
    code: 'WRONG_PRODUCT',
    title: 'Wrong Product Entirely',
    subtitle: 'Completely incorrect medicine or irrelevant image. Blacklists this URL/hash.',
    badge: '❌ Wrong Product',
    badgeColor: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  },
  {
    code: 'POOR_QUALITY',
    title: 'Poor Quality / Blurry / Cut-off',
    subtitle: 'Image is low-resolution, out of focus, or packaging is truncated.',
    badge: '⚠️ Low Quality',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  {
    code: 'OLD_PACKAGING',
    title: 'Old / Outdated Artwork',
    subtitle: 'Manufacturer has redesigned packaging; find updated box/strip design.',
    badge: '🏷️ Old Artwork',
    badgeColor: 'text-muted bg-bg3 border-border',
  },
  {
    code: 'CUSTOM',
    title: 'Custom Reviewer Note',
    subtitle: 'Specify custom notes for the AI redownload and audit trail.',
    badge: '✍️ Custom',
    badgeColor: 'text-sky bg-sky/10 border-sky/30',
  },
];

interface LastActionRecord {
  type: 'APPROVE' | 'REJECT' | 'INCORRECT' | 'REPLACE';
  imageId: number;
  medicineId: number;
  medicineName: string;
  prevStatus: string;
  imageType?: string;
  isPrimary?: boolean;
}

export const CatalogImageVerificationTab: React.FC<Props> = ({ initialFilter = 'review' }) => {
  // Main view state
  const [filter, setFilter] = useState<string>(initialFilter);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
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

  // Workspace View Mode: '4grid' = 2x2 All 4 Slots, 'dual' = Front & Back Side-by-Side Comparison
  const [workspaceLayout, setWorkspaceLayout] = useState<'4grid' | 'dual'>('4grid');

  // Online candidate drawer state
  const [candidateTrayOpen, setCandidateTrayOpen] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [targetSlotForCandidate, setTargetSlotForCandidate] = useState<string>('combined');

  // Fullscreen Pan-Zoom Lightbox State
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxActiveSlot, setLightboxActiveSlot] = useState<string>('combined');
  const [lightboxDualView, setLightboxDualView] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Custom Replace Modal
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

  // History Drawer State
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTargetItem, setHistoryTargetItem] = useState<CatalogImageItem | null>(null);

  // Last Action Record for Instant Undo
  const [lastAction, setLastAction] = useState<LastActionRecord | null>(null);

  // Health Audit & Auto Actions
  const [auditReport, setAuditReport] = useState<any | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [autoApproving, setAutoApproving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [scanning, setScanning] = useState(false);

  // View mode: 'grid' = split-pane workspace, 'review' = WhatsApp flashcard one-by-one flow
  const [viewMode, setViewMode] = useState<'grid' | 'review'>('grid');

  // Flashcard review queue state
  const [reviewQueue, setReviewQueue] = useState<CatalogImageItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [fcActiveSlot, setFcActiveSlot] = useState<string>('combined');
  const [fcDualCompare, setFcDualCompare] = useState(false);
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

  // Fetch all multi-angle slots for the active medicine
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

  // Map active gallery images to slots
  const slotMap = useMemo(() => {
    const map: Record<string, CatalogImageItem | null> = {
      combined: null,
      front: null,
      back: null,
      box: null,
      tablet: null
    };

    activeGallery.forEach(img => {
      const type = (img.image_type || 'combined').toLowerCase();
      if (type === 'front') map.front = img;
      else if (type.includes('back')) map.back = img;
      else if (type.includes('box')) map.box = img;
      else if (type.includes('tablet') || type.includes('pill') || type.includes('side')) map.tablet = img;
      else if (!map.combined) map.combined = img;
    });

    // Fallback: if combined is empty, check if selected medicine primary fits
    if (!map.combined && selectedMedicine) {
      map.combined = selectedMedicine;
    }
    // If front is empty but we have a combined image with high confidence, show reference
    if (!map.front && map.combined) {
      map.front = map.combined;
    }

    return map;
  }, [activeGallery, selectedMedicine]);

  // Helper to open the full-screen Pan-Zoom Lightbox
  const openLightbox = (slotId = 'combined', isDual = false) => {
    setLightboxActiveSlot(slotId);
    setLightboxDualView(isDual);
    setZoomLevel(1);
    setRotation(0);
    setPanOffset({ x: 0, y: 0 });
    setLightboxOpen(true);
  };

  // Lightbox Zoom Controls
  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.3, 4));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.3, 0.6));
  const handleResetZoom = () => {
    setZoomLevel(1);
    setRotation(0);
    setPanOffset({ x: 0, y: 0 });
  };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  // Mouse pan handlers for zoom
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || zoomLevel <= 1) return;
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  // Instant Undo Handler
  const handleUndo = async () => {
    if (!lastAction) return;
    try {
      await api.reopenImage(lastAction.imageId, 'admin');
      toastEvent.trigger(`Undid last action on ${lastAction.medicineName}. Restored for review.`, 'info');
      setLastAction(null);
      loadCounts();
      if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
      loadMedicines();
      if (viewMode === 'review' && reviewIndex > 0) {
        setReviewIndex(prev => Math.max(0, prev - 1));
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to undo: ' + err.message, 'error');
    }
  };

  // Actions
  const handleApproveAll = async () => {
    if (!selectedMedicine) return;
    const medName = selectedMedicine.medicine_name || selectedMedicine.product_name;
    try {
      let approvedCount = 0;
      const imagesToApprove = activeGallery.length > 0 ? activeGallery : [selectedMedicine];
      let lastApprovedId = selectedMedicine.id;
      for (const img of imagesToApprove) {
        if (img.id && img.verification_status !== 'APPROVED') {
          await api.markImageCorrect(img.id, 'admin', img.image_type, Boolean(img.is_primary));
          lastApprovedId = img.id;
          approvedCount++;
        }
      }
      setLastAction({
        type: 'APPROVE',
        imageId: lastApprovedId,
        medicineId: selectedMedicine.medicine_id,
        medicineName: medName,
        prevStatus: selectedMedicine.verification_status || 'PENDING_REVIEW'
      });
      toastEvent.trigger(`Approved ${approvedCount || 1} packaging view(s) for ${medName}`, 'success');
      loadCounts();
      fetchMedicineGallery(selectedMedicine.medicine_id);
      loadMedicines();
    } catch (err: any) {
      toastEvent.trigger('Failed to approve images: ' + err.message, 'error');
    }
  };

  const handleApproveSlot = async (slotId: string) => {
    const item = slotMap[slotId] || selectedMedicine;
    if (!item?.id) return;
    const medName = selectedMedicine?.medicine_name || selectedMedicine?.product_name || 'Medicine';
    try {
      await api.markImageCorrect(item.id, 'admin', slotId, slotId === 'combined');
      setLastAction({
        type: 'APPROVE',
        imageId: item.id,
        medicineId: item.medicine_id,
        medicineName: medName,
        prevStatus: item.verification_status || 'PENDING_REVIEW',
        imageType: slotId
      });
      toastEvent.trigger(`Approved ${slotId.toUpperCase()} view for ${medName}`, 'success');
      loadCounts();
      if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
      loadMedicines();
    } catch (err: any) {
      toastEvent.trigger('Failed to approve slot: ' + err.message, 'error');
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
          toastEvent.trigger('No online candidates found. Try custom URL or upload.', 'info');
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
      const selectedOpt = REASON_OPTIONS.find(r => r.code === incorrectReasonCode);
      const reasonText = incorrectReasonCode === 'CUSTOM'
        ? (customIncorrectNote.trim() || 'Custom review flag')
        : (selectedOpt?.title || 'Incorrect image');

      const res = await api.markImageIncorrect(
        incorrectModalItem.id,
        reasonText,
        'admin',
        incorrectReasonCode
      );
      if (res.success) {
        setLastAction({
          type: 'INCORRECT',
          imageId: incorrectModalItem.id,
          medicineId: incorrectModalItem.medicine_id,
          medicineName: incorrectModalItem.medicine_name || incorrectModalItem.product_name,
          prevStatus: incorrectModalItem.verification_status || 'PENDING_REVIEW'
        });

        toastEvent.trigger('Marked incorrect: ' + reasonText, 'info');
        loadCounts();
        if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
        loadMedicines();
        setIncorrectModalItem(null);

        // If user picked NEED_BACKSIDE, automatically launch candidate search for back angle
        if (incorrectReasonCode === 'NEED_BACKSIDE' || res.action === 'search_candidate') {
          handleSearchCandidates('back');
        }
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
        setLastAction({
          type: 'REJECT',
          imageId: rejectingImage.id,
          medicineId: rejectingImage.medicine_id,
          medicineName: rejectingImage.medicine_name || rejectingImage.product_name,
          prevStatus: rejectingImage.verification_status || 'PENDING_REVIEW'
        });
        toastEvent.trigger(`Rejected image. Excluded from matches.`, 'info');
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

  const handleOpenHistory = async (item: CatalogImageItem) => {
    setHistoryTargetItem(item);
    setHistoryDrawerOpen(true);
    setHistoryLoading(true);
    try {
      const res = await api.getImageHistory(item.id);
      if (res.success) {
        setHistoryList(res.history || []);
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to load history: ' + err.message, 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleReopenFromHistory = async (imageId: number) => {
    try {
      await api.reopenImage(imageId, 'admin');
      toastEvent.trigger('Reopened image for QC review.', 'success');
      setHistoryDrawerOpen(false);
      loadCounts();
      if (selectedMedicine) fetchMedicineGallery(selectedMedicine.medicine_id);
      loadMedicines();
    } catch (err: any) {
      toastEvent.trigger('Failed to reopen: ' + err.message, 'error');
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

  const handleScanLocal = async () => {
    setScanning(true);
    try {
      const res = await api.scanLocalImages();
      if (res.success) {
        toastEvent.trigger(
          `Scan done: ${res.matched} auto-matched, ${res.pending_review} need review, ${res.unmatched} unmatched, ${res.skipped} already linked.`,
          'success'
        );
        loadCounts();
        loadMedicines();
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
        setFcActiveSlot('combined');
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to load review queue', 'error');
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const enterReviewMode = () => {
    setViewMode('review');
    loadReviewQueue();
  };

  const advanceFlashcard = () => {
    setFcEdits({});
    setFcEditingField(null);
    setFcActiveSlot('combined');
    setReviewIndex(prev => prev + 1);
  };

  const handleFcApprove = async () => {
    const item = reviewQueue[reviewIndex];
    if (!item) return;
    setFcApproving(true);
    const medName = fcEdits.name ?? item.medicine_name ?? item.product_name ?? 'Medicine';
    const medicineEdits: { name?: string; manufacturer?: string; mrp?: number } = {};
    if (fcEdits.name !== undefined && fcEdits.name !== item.medicine_name) medicineEdits.name = fcEdits.name;
    if (fcEdits.manufacturer !== undefined && fcEdits.manufacturer !== item.company_name) medicineEdits.manufacturer = fcEdits.manufacturer;
    if (fcEdits.mrp !== undefined && fcEdits.mrp !== String(item.mrp)) medicineEdits.mrp = parseFloat(fcEdits.mrp);

    setLastAction({
      type: 'APPROVE',
      imageId: item.id,
      medicineId: item.medicine_id,
      medicineName: medName,
      prevStatus: item.verification_status || 'PENDING_REVIEW'
    });

    advanceFlashcard();
    try {
      await api.approveCatalogImage(item.id, 'pharmacist', Object.keys(medicineEdits).length > 0 ? medicineEdits : undefined);
      loadCounts();
    } catch (err: any) {
      toastEvent.trigger('Approve failed: ' + err.message, 'error');
    } finally {
      setFcApproving(false);
    }
  };

  const handleFcReject = async () => {
    const item = reviewQueue[reviewIndex];
    if (!item) return;
    setFcRejecting(true);
    const medName = item.medicine_name ?? item.product_name ?? 'Medicine';
    setLastAction({
      type: 'REJECT',
      imageId: item.id,
      medicineId: item.medicine_id,
      medicineName: medName,
      prevStatus: item.verification_status || 'PENDING_REVIEW'
    });
    advanceFlashcard();
    try {
      await api.rejectCatalogImage(item.id, 'Incorrect product image', 'pharmacist');
      loadCounts();
    } catch (err: any) {
      toastEvent.trigger('Reject failed: ' + err.message, 'error');
    } finally {
      setFcRejecting(false);
    }
  };

  const handleFcSkip = () => {
    advanceFlashcard();
  };

  const handleFcPrev = () => {
    if (reviewIndex > 0) {
      setFcEdits({});
      setFcEditingField(null);
      setReviewIndex(prev => prev - 1);
    }
  };

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (lightboxOpen) {
        if (e.key === 'Escape') setLightboxOpen(false);
        else if (e.key === '+' || e.key === '=') handleZoomIn();
        else if (e.key === '-' || e.key === '_') handleZoomOut();
        else if (e.key === '0') handleResetZoom();
        else if (e.key === 'r' || e.key === 'R') handleRotate();
        else if (e.key === 'ArrowRight') handleNextMedicine();
        else if (e.key === 'ArrowLeft') handlePrevMedicine();
        return;
      }

      if (viewMode === 'review') {
        if (e.key === 'a' || e.key === 'A') handleFcApprove();
        else if (e.key === 'x' || e.key === 'Delete') handleFcReject();
        else if (e.key === 's' || e.key === 'S') handleFcSkip();
        else if (e.key === 'z' || e.key === 'Z') openLightbox(fcActiveSlot, fcDualCompare);
        else if (e.key === '1') setFcActiveSlot('combined');
        else if (e.key === '2') setFcActiveSlot('front');
        else if (e.key === '3') setFcActiveSlot('back');
        else if (e.key === '4') setFcActiveSlot('box');
        else if (e.key === 'ArrowLeft') handleFcPrev();
      } else {
        if (e.key === 'ArrowRight') handleNextMedicine();
        else if (e.key === 'ArrowLeft') handlePrevMedicine();
        else if (e.key === 'z' || e.key === 'Z') openLightbox('combined', workspaceLayout === 'dual');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, viewMode, reviewIndex, fcActiveSlot, fcDualCompare, workspaceLayout, selectedMedicineId]);

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
            4-Angle Packaging Suite & Dual Front+Back Inspector. Compare, zoom, and verify product artwork in real-time.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Undo Action Pill (Appears if last action occurred) */}
          {lastAction && (
            <button
              onClick={handleUndo}
              className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded-xl text-xs font-bold text-amber-400 flex items-center gap-1.5 transition-all cursor-pointer animate-in fade-in"
              title={`Undo ${lastAction.type} for ${lastAction.medicineName}`}
            >
              <Undo2 size={13} />
              <span>Undo Last ({lastAction.type})</span>
            </button>
          )}

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

          {/* Auto-Match All */}
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
            title={viewMode === 'review' ? 'Exit flashcard review mode' : 'Enter rapid one-by-one review mode'}
          >
            <Eye size={13} />
            <span>{viewMode === 'review' ? 'Exit Review' : 'Rapid Review'}</span>
            {counts.pending_review > 0 && viewMode !== 'review' && (
              <span className="bg-amber-500 text-white rounded-full px-1.5 py-0 text-[10px] font-black">{counts.pending_review}</span>
            )}
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* FLASHCARD RAPID REVIEW MODE (WhatsApp Flow) */}
      {/* ============================================================ */}
      {viewMode === 'review' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {reviewLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw size={28} className="animate-spin text-primary" />
              <span className="ml-3 text-muted text-sm font-semibold">Loading review queue…</span>
            </div>
          ) : reviewIndex >= reviewQueue.length ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
              <CheckCircle2 size={48} className="text-emerald-400" />
              <h3 className="text-xl font-black text-text">All Caught Up!</h3>
              <p className="text-sm text-muted max-w-xs">No pending items remaining in review queue. Run Auto-Match All to scan new images.</p>
              <button onClick={() => setViewMode('grid')} className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold transition-all hover:opacity-90">
                Back to Split-Pane Grid
              </button>
            </div>
          ) : (() => {
            const item = reviewQueue[reviewIndex];
            const activeImage = fcActiveSlot === 'back' && slotMap.back?.image_path ? slotMap.back.image_path : item.image_path;
            const imgUrl = activeImage
              ? (activeImage.startsWith('http') ? activeImage : `/${activeImage.replace(/\\/g, '/')}`)
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
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text">⚡ Rapid Inspection Queue</span>
                      <span className="text-[10px] text-muted px-2 py-0.5 rounded bg-bg3 border border-border">
                        Shortcuts: [A] Approve • [X] Reject • [S] Skip • [Z] Zoom • [1-4] Angles
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {reviewIndex > 0 && (
                        <button
                          onClick={handleFcPrev}
                          className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <ChevronLeft size={13} />
                          <span>Prev Item</span>
                        </button>
                      )}
                      <span className="text-xs text-muted font-medium">{remaining} remaining of {reviewQueue.length}</span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-bg3 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Main Flashcard Body */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                  {/* Left: Expansive Image Canvas */}
                  <div className="md:w-3/5 flex flex-col bg-bg p-5 border-r border-border overflow-hidden relative">
                    {/* Angle Switcher Strip */}
                    <div className="flex items-center justify-between gap-2 pb-3 shrink-0">
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {STANDARD_SLOTS.map(s => {
                          const isSlotActive = fcActiveSlot === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => setFcActiveSlot(s.id)}
                              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                isSlotActive
                                  ? 'bg-primary text-white shadow-sm'
                                  : 'bg-bg2 text-muted hover:text-text border border-border'
                              }`}
                            >
                              <span>{s.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        onClick={() => openLightbox(fcActiveSlot, fcDualCompare)}
                        className="px-3 py-1 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-xs font-bold text-sky flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <Maximize2 size={13} />
                        <span>Fullscreen Lightbox [Z]</span>
                      </button>
                    </div>

                    {/* Image Area */}
                    <div
                      className="flex-1 rounded-2xl bg-bg2/40 border border-border/70 flex items-center justify-center p-4 overflow-hidden relative group cursor-zoom-in"
                      onClick={() => openLightbox(fcActiveSlot, false)}
                    >
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={displayName}
                          className="max-h-full max-w-full object-contain drop-shadow-md group-hover:scale-105 transition-transform duration-300"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-muted">
                          <Camera size={48} className="opacity-30" />
                          <span className="text-sm font-semibold">No image preview for {fcActiveSlot}</span>
                        </div>
                      )}

                      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-bg2/90 backdrop-blur-md px-3 py-1 rounded-xl border border-border text-xs font-bold text-text flex items-center gap-1.5 pointer-events-none">
                        <ZoomIn size={13} className="text-primary" />
                        <span>Click to Zoom</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Medicine Details & Instant Edit */}
                  <div className="md:w-2/5 flex flex-col p-6 bg-bg2 overflow-y-auto justify-between">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted uppercase font-bold tracking-widest">Matched Product Details</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          (item.confidence_score || 0) >= 85 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                          (item.confidence_score || 0) >= 60 ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                          'bg-red-500/10 text-red-400 border-red-500/30'
                        }`}>
                          {item.confidence_score ?? '—'}% Match Confidence
                        </span>
                      </div>

                      {/* Name field */}
                      <div>
                        <label className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-1">Medicine Name</label>
                        {fcEditingField === 'name' ? (
                          <input
                            id="fc-edit-name"
                            autoFocus
                            type="text"
                            value={displayName}
                            onChange={e => setFcEdits(p => ({ ...p, name: e.target.value }))}
                            onBlur={() => setFcEditingField(null)}
                            onKeyDown={e => e.key === 'Enter' && setFcEditingField(null)}
                            className="w-full bg-bg border border-primary rounded-xl px-3 py-2 text-sm font-bold text-text outline-none shadow-xs"
                          />
                        ) : (
                          <div
                            onClick={() => setFcEditingField('name')}
                            className="flex items-center gap-2 group cursor-text px-3 py-2 rounded-xl bg-bg border border-border hover:border-primary/50 transition-all"
                          >
                            <span className="text-sm font-black text-text flex-1">{displayName}</span>
                            <span className="text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">✏️ Edit</span>
                          </div>
                        )}
                      </div>

                      {/* Manufacturer field */}
                      <div>
                        <label className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-1">Manufacturer</label>
                        {fcEditingField === 'manufacturer' ? (
                          <input
                            id="fc-edit-manufacturer"
                            autoFocus
                            type="text"
                            value={displayMfr}
                            onChange={e => setFcEdits(p => ({ ...p, manufacturer: e.target.value }))}
                            onBlur={() => setFcEditingField(null)}
                            onKeyDown={e => e.key === 'Enter' && setFcEditingField(null)}
                            className="w-full bg-bg border border-primary rounded-xl px-3 py-2 text-xs text-text outline-none shadow-xs"
                          />
                        ) : (
                          <div
                            onClick={() => setFcEditingField('manufacturer')}
                            className="flex items-center gap-2 group cursor-text px-3 py-2 rounded-xl bg-bg border border-border hover:border-primary/50 transition-all"
                          >
                            <span className="text-xs text-text font-semibold flex-1">{displayMfr}</span>
                            <span className="text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">✏️ Edit</span>
                          </div>
                        )}
                      </div>

                      {/* MRP field */}
                      <div>
                        <label className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-1">MRP (₹)</label>
                        {fcEditingField === 'mrp' ? (
                          <input
                            id="fc-edit-mrp"
                            autoFocus
                            type="number"
                            value={displayMrp}
                            onChange={e => setFcEdits(p => ({ ...p, mrp: e.target.value }))}
                            onBlur={() => setFcEditingField(null)}
                            onKeyDown={e => e.key === 'Enter' && setFcEditingField(null)}
                            className="w-full bg-bg border border-primary rounded-xl px-3 py-2 text-xs text-text outline-none shadow-xs"
                          />
                        ) : (
                          <div
                            onClick={() => setFcEditingField('mrp')}
                            className="flex items-center gap-2 group cursor-text px-3 py-2 rounded-xl bg-bg border border-border hover:border-primary/50 transition-all"
                          >
                            <span className="text-xs font-bold text-text flex-1">₹{displayMrp}</span>
                            <span className="text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">✏️ Edit</span>
                          </div>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="text-xs text-muted space-y-1.5 pt-2 border-t border-border">
                        {item.generic_name && (
                          <div>Salt Composition: <span className="text-text font-mono text-[11px]">{item.generic_name}</span></div>
                        )}
                        <div>Category: <span className="text-text font-medium">{item.category || 'General'}</span></div>
                        <div>Source: <span className="text-text font-medium">{item.match_source || item.image_source || 'Catalog'}</span></div>
                      </div>
                    </div>

                    {/* Secondary Actions */}
                    <div className="pt-4 border-t border-border space-y-2">
                      <button
                        onClick={() => {
                          setIncorrectModalItem(item);
                          setIncorrectReasonCode('NEED_BACKSIDE');
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <AlertTriangle size={13} />
                        <span>Need Backside / Mark Incorrect</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Fixed Action Bar */}
                <div className="shrink-0 border-t border-border bg-bg2 px-6 py-4 flex items-center justify-center gap-3">
                  <button
                    id="fc-approve-btn"
                    onClick={handleFcApprove}
                    disabled={fcApproving}
                    className="flex items-center gap-2 px-7 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition-all shadow-md cursor-pointer"
                  >
                    <Check size={16} />
                    <span>{fcApproving ? 'Saving…' : 'Approve & Next [A]'}</span>
                  </button>

                  <button
                    id="fc-skip-btn"
                    onClick={handleFcSkip}
                    className="flex items-center gap-2 px-5 py-2.5 bg-bg border border-border hover:bg-bg3 text-muted hover:text-text rounded-xl text-sm font-semibold transition-all cursor-pointer"
                  >
                    <ChevronRight size={16} />
                    <span>Skip [S]</span>
                  </button>

                  <button
                    id="fc-reject-btn"
                    onClick={handleFcReject}
                    disabled={fcRejecting}
                    className="flex items-center gap-2 px-6 py-2.5 bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/40 text-rose-400 rounded-xl text-sm font-bold transition-all cursor-pointer"
                  >
                    <XCircle size={16} />
                    <span>{fcRejecting ? 'Saving…' : 'Reject [X]'}</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ============================================================ */}
      {/* WHATSAPP WEB SPLIT-PANE WORKSPACE (Grid Mode) */}
      {/* ============================================================ */}
      {viewMode === 'grid' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* LEFT PANE: WhatsApp-style Medicine Inbox (~380px) */}
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
                  const isHigh = (med.confidence_score || 0) >= 90;

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

          {/* RIGHT PANE: Active Product Workspace */}
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-bg">
            {!selectedMedicine ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted space-y-3">
                <div className="w-16 h-16 rounded-3xl bg-bg2 border border-border flex items-center justify-center text-primary/60">
                  <ShieldCheck size={32} />
                </div>
                <h3 className="text-base font-bold text-text">Select a Medicine to Inspect</h3>
                <p className="text-xs max-w-md">
                  Click any product from the left inbox to view all multi-angle views, zoom into packaging details, or search online candidates.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Medicine Header Banner */}
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

                  {/* Navigation Arrows & History */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleOpenHistory(selectedMedicine)}
                      className="px-3 py-1.5 rounded-xl bg-bg hover:bg-bg3 border border-border text-xs font-bold text-text flex items-center gap-1.5 cursor-pointer shadow-xs"
                      title="View modification & audit logs"
                    >
                      <History size={13} className="text-sky" />
                      <span>Audit Logs</span>
                    </button>

                    <div className="flex items-center gap-1 border-l border-border pl-2">
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
                </div>

                {/* Dedicated Action & View-Mode Bar */}
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

                    {/* Mark Incorrect / Need Angle */}
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

                  {/* Workspace View Layout Switcher */}
                  <div className="flex items-center gap-1 bg-bg p-0.5 rounded-xl border border-border">
                    <button
                      onClick={() => setWorkspaceLayout('4grid')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                        workspaceLayout === '4grid' ? 'bg-primary text-white shadow-xs' : 'text-muted hover:text-text'
                      }`}
                      title="4-Slot Packaging Grid"
                    >
                      <LayoutGrid size={13} />
                      <span>4-Grid</span>
                    </button>

                    <button
                      onClick={() => setWorkspaceLayout('dual')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                        workspaceLayout === 'dual' ? 'bg-primary text-white shadow-xs' : 'text-muted hover:text-text'
                      }`}
                      title="Side-by-Side Front & Back Comparison"
                    >
                      <Columns size={13} />
                      <span>Front & Back Dual</span>
                    </button>
                  </div>
                </div>

                {/* Central Scrollable Workspace */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                  {/* DUAL FRONT & BACK SIDE-BY-SIDE VIEW */}
                  {workspaceLayout === 'dual' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                          <ArrowLeftRight size={13} className="text-sky" />
                          <span>Side-by-Side Front Face vs Back Composition Face</span>
                        </span>
                        <button
                          onClick={() => openLightbox('combined', true)}
                          className="text-xs font-bold text-sky hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Maximize2 size={12} />
                          <span>Inspect Both in Fullscreen Lightbox</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* FRONT FACE CARD */}
                        {(() => {
                          const item = slotMap.front || slotMap.combined;
                          const hasImage = Boolean(item && item.image_path);
                          return (
                            <div className="bg-bg2 border border-border rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between">
                              <div className="p-3 border-b border-border bg-bg3/30 flex items-center justify-between">
                                <span className="text-xs font-bold text-text flex items-center gap-1.5">
                                  <Eye size={14} className="text-sky" />
                                  <span>Front Side (Brand & Strength)</span>
                                </span>
                                {item?.verification_status === 'APPROVED' ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">Approved</span>
                                ) : (
                                  <button
                                    onClick={() => handleApproveSlot('front')}
                                    className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold cursor-pointer"
                                  >
                                    Approve Front
                                  </button>
                                )}
                              </div>

                              <div
                                className="relative h-72 bg-bg flex items-center justify-center p-4 cursor-zoom-in group"
                                onClick={() => openLightbox('front', false)}
                              >
                                {hasImage ? (
                                  <img
                                    src={item!.image_path}
                                    alt="Front Face"
                                    className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                                  />
                                ) : (
                                  <div className="flex flex-col items-center gap-2 text-muted">
                                    <Eye size={36} className="opacity-30" />
                                    <span className="text-xs font-semibold">No Front Face Available</span>
                                  </div>
                                )}
                              </div>

                              <div className="p-3 bg-bg2 border-t border-border flex items-center justify-between text-xs">
                                <button
                                  onClick={() => openLightbox('front', false)}
                                  className="font-bold text-sky hover:underline cursor-pointer flex items-center gap-1"
                                >
                                  <ZoomIn size={13} />
                                  <span>Fullscreen Zoom</span>
                                </button>
                                <button
                                  onClick={() => handleSearchCandidates('front')}
                                  className="font-bold text-text hover:text-primary cursor-pointer flex items-center gap-1"
                                >
                                  <RefreshCw size={12} />
                                  <span>Find Front Image</span>
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                        {/* BACK COMPOSITION / BLISTER CARD */}
                        {(() => {
                          const item = slotMap.back;
                          const hasImage = Boolean(item && item.image_path);
                          return (
                            <div className="bg-bg2 border border-border rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between">
                              <div className="p-3 border-b border-border bg-bg3/30 flex items-center justify-between">
                                <span className="text-xs font-bold text-text flex items-center gap-1.5">
                                  <Camera size={14} className="text-amber-400" />
                                  <span>Back Side (Salts, Batch & Expiry)</span>
                                </span>
                                {hasImage ? (
                                  item!.verification_status === 'APPROVED' ? (
                                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">Approved</span>
                                  ) : (
                                    <button
                                      onClick={() => handleApproveSlot('back')}
                                      className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold cursor-pointer"
                                    >
                                      Approve Back
                                    </button>
                                  )
                                ) : (
                                  <span className="text-[10px] text-amber-400 font-bold">Missing Angle</span>
                                )}
                              </div>

                              <div
                                className="relative h-72 bg-bg flex items-center justify-center p-4 cursor-zoom-in group"
                                onClick={() => hasImage ? openLightbox('back', false) : handleSearchCandidates('back')}
                              >
                                {hasImage ? (
                                  <img
                                    src={item!.image_path}
                                    alt="Back Composition"
                                    className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
                                  />
                                ) : (
                                  <div className="flex flex-col items-center gap-2 text-muted text-center p-4">
                                    <Camera size={36} className="opacity-30 text-amber-400" />
                                    <span className="text-xs font-semibold text-text">No Back / Blister Image Yet</span>
                                    <p className="text-[11px] text-muted max-w-xs">Need to verify active salts or batch markings? Click below to search online candidates.</p>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleSearchCandidates('back'); }}
                                      className="mt-2 px-3 py-1.5 rounded-xl bg-primary text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm hover:opacity-90"
                                    >
                                      <Plus size={13} />
                                      <span>Find Backside Image</span>
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="p-3 bg-bg2 border-t border-border flex items-center justify-between text-xs">
                                {hasImage ? (
                                  <>
                                    <button
                                      onClick={() => openLightbox('back', false)}
                                      className="font-bold text-sky hover:underline cursor-pointer flex items-center gap-1"
                                    >
                                      <ZoomIn size={13} />
                                      <span>Fullscreen Zoom</span>
                                    </button>
                                    <button
                                      onClick={() => handleSearchCandidates('back')}
                                      className="font-bold text-text hover:text-primary cursor-pointer flex items-center gap-1"
                                    >
                                      <RefreshCw size={12} />
                                      <span>Replace Back View</span>
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-muted text-[11px]">Click 'Find Backside Image' to pull blister packaging</span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    /* 4-SLOT PACKAGING GRID */
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
                              <div
                                className="relative w-full h-52 bg-bg flex items-center justify-center p-3 overflow-hidden border-b border-border cursor-zoom-in"
                                onClick={() => hasImage ? openLightbox(slot.id, false) : handleSearchCandidates(slot.id)}
                              >
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

                                {/* Hover Overlay Tools */}
                                {hasImage && (
                                  <div className="absolute inset-0 bg-bg3/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-20">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); openLightbox(slot.id, false); }}
                                      className="p-2 rounded-xl bg-bg/95 border border-border text-text hover:text-primary shadow-lg transition-transform hover:scale-110 cursor-pointer"
                                      title="Inspect full image in zoom lightbox [Z]"
                                    >
                                      <ZoomIn size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleSearchCandidates(slot.id); }}
                                      className="p-2 rounded-xl bg-bg/95 border border-border text-text hover:text-sky shadow-lg transition-transform hover:scale-110 cursor-pointer"
                                      title="Re-fetch alternative candidates online"
                                    >
                                      <RefreshCw size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setReplacingSlot({ slotId: slot.id, imageId: item!.id }); }}
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
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openLightbox(slot.id, false)}
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
                  )}

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
        </div>
      )}

      {/* ============================================================ */}
      {/* EXPANSIVE FULLSCREEN PAN-ZOOM LIGHTBOX (Fixes Small Box Issue) */}
      {/* ============================================================ */}
      {lightboxOpen && selectedMedicine && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-xl flex flex-col overflow-hidden animate-in fade-in"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Top Floating Control Header */}
          <div className="px-6 py-3.5 bg-bg2/90 backdrop-blur-md border-b border-border flex items-center justify-between gap-4 shrink-0 z-20">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-1.5 rounded-xl bg-primary/20 text-primary">
                <ZoomIn size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-black text-text truncate">
                    {selectedMedicine.medicine_name || selectedMedicine.product_name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-sky/10 border border-sky/30 text-[10px] font-bold text-sky uppercase">
                    {lightboxActiveSlot.toUpperCase()}
                  </span>
                  {lightboxDualView && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-400">
                      Front & Back Dual Mode
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted truncate">
                  Mfg: <strong className="text-text">{selectedMedicine.manufacturer || selectedMedicine.company_name}</strong>
                  {selectedMedicine.generic_name && <span> • Salt: {selectedMedicine.generic_name}</span>}
                </p>
              </div>
            </div>

            {/* Interactive Zoom & Rotate Toolbar */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center bg-bg rounded-xl border border-border p-1 gap-1">
                <button
                  onClick={handleZoomOut}
                  className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text cursor-pointer"
                  title="Zoom Out (-)"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="text-[11px] font-mono font-bold px-2 text-text">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text cursor-pointer"
                  title="Zoom In (+)"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  onClick={handleRotate}
                  className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text cursor-pointer"
                  title="Rotate 90° (R)"
                >
                  <RotateCw size={14} />
                </button>
                <button
                  onClick={handleResetZoom}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted hover:text-text hover:bg-bg3 cursor-pointer"
                  title="Reset (0)"
                >
                  Reset
                </button>
              </div>

              {/* Dual Compare Toggle inside Lightbox */}
              <button
                onClick={() => setLightboxDualView(prev => !prev)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                  lightboxDualView
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                    : 'bg-bg text-muted hover:text-text border-border'
                }`}
              >
                <Columns size={13} />
                <span>Dual View</span>
              </button>

              {/* Close Button */}
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-2 rounded-xl bg-bg hover:bg-bg3 border border-border text-muted hover:text-text cursor-pointer"
                title="Close Lightbox (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Expansive Canvas (Full Viewport) */}
          <div
            className="flex-1 overflow-hidden relative flex items-center justify-center p-4 select-none"
            onMouseDown={handleMouseDown}
          >
            {lightboxDualView ? (
              /* DUAL SIDE-BY-SIDE EXPANSIVE VIEW */
              <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 gap-6 p-4">
                {/* Front Face Canvas */}
                <div className="h-full bg-bg2/40 border border-border/80 rounded-3xl p-4 flex flex-col justify-between overflow-hidden">
                  <div className="flex items-center justify-between text-xs font-bold text-sky">
                    <span>Front Side (Brand Packaging)</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                    <img
                      src={slotMap.front?.image_path || slotMap.combined?.image_path || ''}
                      alt="Front Side"
                      className="max-h-full max-w-full object-contain drop-shadow-2xl"
                      style={{
                        transform: `scale(${zoomLevel}) rotate(${rotation}deg) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                        cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default'
                      }}
                    />
                  </div>
                </div>

                {/* Back Composition Canvas */}
                <div className="h-full bg-bg2/40 border border-border/80 rounded-3xl p-4 flex flex-col justify-between overflow-hidden">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                    <span>Back Side (Composition, Batch & Salts)</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                    {slotMap.back?.image_path ? (
                      <img
                        src={slotMap.back.image_path}
                        alt="Back Side"
                        className="max-h-full max-w-full object-contain drop-shadow-2xl"
                        style={{
                          transform: `scale(${zoomLevel}) rotate(${rotation}deg) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                          cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default'
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-muted text-center">
                        <Camera size={48} className="opacity-30 text-amber-400" />
                        <span className="text-sm font-semibold">No Back Side Packaging Yet</span>
                        <button
                          onClick={() => { setLightboxOpen(false); handleSearchCandidates('back'); }}
                          className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs shadow-md"
                        >
                          Find Backside Image
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* SINGLE MAXIMIZED HIGH-RES IMAGE */
              <div className="w-full h-full flex items-center justify-center p-4">
                {(() => {
                  const targetItem = slotMap[lightboxActiveSlot] || selectedMedicine;
                  const imgSrc = targetItem?.image_path;
                  return imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={selectedMedicine.medicine_name}
                      className="max-h-full max-w-full object-contain drop-shadow-2xl transition-transform duration-75"
                      style={{
                        transform: `scale(${zoomLevel}) rotate(${rotation}deg) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                        cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default'
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-muted">
                      <Camera size={56} className="opacity-30" />
                      <span className="text-base font-semibold">No image available in {lightboxActiveSlot} slot</span>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Bottom Floating Angle Bar & Actions */}
          <div className="px-6 py-4 bg-bg2/90 backdrop-blur-md border-t border-border flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 z-20">
            {/* Angle Selector Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {STANDARD_SLOTS.map(s => {
                const isSlotActive = lightboxActiveSlot === s.id && !lightboxDualView;
                const hasImg = Boolean(slotMap[s.id]?.image_path);
                return (
                  <button
                    key={s.id}
                    onClick={() => { setLightboxActiveSlot(s.id); setLightboxDualView(false); }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      isSlotActive
                        ? 'bg-primary text-white shadow-md'
                        : hasImg
                        ? 'bg-bg text-text hover:bg-bg3 border border-border'
                        : 'bg-bg/50 text-muted border border-dashed border-border/70'
                    }`}
                  >
                    <span>{s.label}</span>
                    {hasImg && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                  </button>
                );
              })}
            </div>

            {/* Direct Lightbox Actions */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={() => { handleApproveAll(); setLightboxOpen(false); }}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
              >
                <CheckCircle2 size={15} />
                <span>Approve All Packaging</span>
              </button>

              <button
                onClick={() => {
                  setLightboxOpen(false);
                  setIncorrectModalItem(slotMap[lightboxActiveSlot] || selectedMedicine);
                  setIncorrectReasonCode('NEED_BACKSIDE');
                }}
                className="px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <AlertTriangle size={14} />
                <span>Need Back / Mark Incorrect</span>
              </button>

              <button
                onClick={() => {
                  setLightboxOpen(false);
                  setRejectingImage(slotMap[lightboxActiveSlot] || selectedMedicine);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/40 text-rose-400 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <XCircle size={14} />
                <span>Reject Image</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MARK INCORRECT REASON MODAL (Full Reason Options) */}
      {/* ============================================================ */}
      {incorrectModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={20} />
              <h3 className="text-sm font-bold text-text">Mark Image Incorrect / Missing Angle</h3>
            </div>
            <p className="text-xs text-muted">
              Select the reason why this image requires correction. The AI pipeline will blacklist bad candidates and automatically search for the requested angle.
            </p>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {REASON_OPTIONS.map(opt => (
                <label
                  key={opt.code}
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
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
                    className="accent-primary mt-0.5"
                  />
                  <div>
                    <span className="text-text block font-semibold">{opt.title}</span>
                    <span className="text-[11px] text-muted block font-normal">{opt.subtitle}</span>
                  </div>
                </label>
              ))}
            </div>

            {incorrectReasonCode === 'CUSTOM' && (
              <div>
                <label className="text-xs font-semibold text-text block mb-1">Custom Review Note:</label>
                <textarea
                  rows={2}
                  value={customIncorrectNote}
                  onChange={e => setCustomIncorrectNote(e.target.value)}
                  placeholder="Explain why this image is incorrect..."
                  className="w-full p-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            )}

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

      {/* ============================================================ */}
      {/* AUDIT LOG HISTORY DRAWER */}
      {/* ============================================================ */}
      {historyDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-bg2 border-l border-border h-full flex flex-col p-5 shadow-2xl animate-in slide-in-from-right">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <History size={16} className="text-sky" />
                <h3 className="text-sm font-bold text-text">Modification Audit Logs</h3>
              </div>
              <button
                onClick={() => setHistoryDrawerOpen(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {historyLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-muted">
                  <RefreshCw size={20} className="animate-spin text-sky" />
                  <span>Loading audit logs...</span>
                </div>
              ) : historyList.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted">
                  No modification audit logs recorded for this product yet.
                </div>
              ) : (
                historyList.map((entry, idx) => (
                  <div key={entry.id || idx} className="p-3 bg-bg border border-border rounded-xl space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-sky/10 text-sky font-bold text-[10px]">
                        {entry.action}
                      </span>
                      <span className="text-[10px] text-muted">
                        {new Date(entry.performed_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-text text-xs">
                      <span className="text-muted">Transition:</span>
                      <span className="font-semibold text-rose-400">{entry.previous_status || 'NONE'}</span>
                      <ArrowRight size={11} className="text-muted" />
                      <span className="font-semibold text-emerald-400">{entry.new_status}</span>
                    </div>

                    {entry.reason && (
                      <p className="text-[11px] text-muted bg-bg2 p-2 rounded-lg">
                        <strong className="text-text">Reason: </strong> {entry.reason}
                      </p>
                    )}

                    <div className="text-[10px] text-muted flex items-center justify-between pt-1">
                      <span>Agent: {entry.performed_by || 'admin'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {historyTargetItem && (
              <div className="pt-3 border-t border-border flex justify-between items-center">
                <span className="text-[11px] text-muted">Mistaken action?</span>
                <button
                  onClick={() => handleReopenFromHistory(historyTargetItem.id)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Undo2 size={13} />
                  <span>Reopen for Review</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* REJECT CONFIRMATION MODAL */}
      {/* ============================================================ */}
      {rejectingImage && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <XCircle size={20} />
              <h3 className="text-sm font-bold text-text">Reject Product Image</h3>
            </div>
            <p className="text-xs text-muted">
              Rejecting will exclude this image candidate from matches and schedule a fresh redownload.
            </p>

            <div>
              <label className="text-xs font-semibold text-text block mb-1">Rejection Reason:</label>
              <input
                type="text"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setRejectingImage(null)}
                className="px-4 py-2 rounded-xl bg-bg border border-border text-muted hover:text-text text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs cursor-pointer shadow"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* REPLACE IMAGE MODAL */}
      {/* ============================================================ */}
      {replacingSlot && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
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
