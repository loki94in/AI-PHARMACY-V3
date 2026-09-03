import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Search,
  RefreshCw,
  Eye,
  History,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Check,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowRight,
  Plus
} from 'lucide-react';
import { api, type CatalogImageItem } from '../../services/api';

export const STANDARD_SLOTS = [
  { id: 'combined', label: '⭐ Combined', badge: '2-in-1', desc: 'Front & Back side-by-side (Primary)' },
  { id: 'front', label: 'Front Side', badge: 'Front', desc: 'Brand name & strength face' },
  { id: 'back', label: 'Back Side', badge: 'Back', desc: 'Composition, salts & license' },
  { id: 'box', label: 'Outer Box', badge: 'Box', desc: 'Carton box packaging' },
  { id: 'tablet', label: 'Tablet / Pill', badge: 'Pill', desc: 'Bare tablet or syrup unit' },
];

export const REASON_OPTIONS = [
  {
    code: 'NEED_BACKSIDE',
    title: 'Need Backside Image',
    subtitle: 'Keep current image as Front, and find the rear packaging/composition.',
    badge: '📸 Keep Front + Add Back',
    badgeColor: 'text-sky bg-sky/10 border-sky/30',
    icon: Layers
  },
  {
    code: 'NEED_FRONT',
    title: 'Need Front Side Image',
    subtitle: 'Current image is Back or Box; save it as rear and search for main front face.',
    badge: '🖼️ Save Back + Find Front',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    icon: Eye
  },
  {
    code: 'NEED_COMBINED',
    title: 'Need Combined Front + Back',
    subtitle: 'Search for a 2-in-1 composite picture showing both sides together.',
    badge: '🔲 2-in-1 Composite',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    icon: Sparkles
  },
  {
    code: 'WRONG_VARIANT',
    title: 'Category / Brand Right, Wrong Variant',
    subtitle: 'Right medicine brand, but wrong strength (e.g. 500mg vs 650mg), flavor, or count.',
    badge: '🔄 Wrong Variant',
    badgeColor: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    icon: AlertTriangle
  },
  {
    code: 'WRONG_PRODUCT',
    title: 'Wrong Product Entirely',
    subtitle: 'Completely incorrect medicine or irrelevant image. Blacklists this URL/hash.',
    badge: '❌ Wrong Product',
    badgeColor: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    icon: XCircle
  },
  {
    code: 'POOR_QUALITY',
    title: 'Poor Quality / Blurry / Cut-off',
    subtitle: 'Image is low-resolution, out of focus, or packaging is truncated.',
    badge: '⚠️ Low Quality',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    icon: AlertTriangle
  },
  {
    code: 'OLD_PACKAGING',
    title: 'Old / Outdated Packaging Artwork',
    subtitle: 'Manufacturer has redesigned packaging; find updated box/strip design.',
    badge: '🏷️ Old Artwork',
    badgeColor: 'text-muted bg-bg3 border-border',
    icon: RotateCcw
  },
  {
    code: 'CUSTOM',
    title: 'Custom Reason / Note',
    subtitle: 'Specify custom reviewer notes for the audit trail.',
    badge: '✍️ Custom',
    badgeColor: 'text-sky bg-sky/10 border-sky/30',
    icon: Sparkles
  },
];

interface StatsState {
  pending: number;
  incorrect: number;
  corrected: number;
  verified: number;
  skipped: number;
  total: number;
  accuracyPercent: number;
  verifiedToday: number;
  correctedToday: number;
}

interface CandidateItem {
  id: string;
  name: string;
  manufacturer: string;
  imageUrl: string;
  source: string;
  confidenceScore: number;
  verificationStatus: string;
  reason: string;
  signals?: any;
}

export default function ImageCorrectionCenter() {
  // Queue & Navigation State
  const [images, setImages] = useState<CatalogImageItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  
  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'unresolved' | 'pending' | 'incorrect' | 'skipped'>('unresolved');
  const [page, setPage] = useState<number>(1);

  // Stats
  const [stats, setStats] = useState<StatsState>({
    pending: 0,
    incorrect: 0,
    corrected: 0,
    verified: 0,
    skipped: 0,
    total: 0,
    accuracyPercent: 100,
    verifiedToday: 0,
    correctedToday: 0,
  });

  // Multi-Angle Gallery State
  const [galleryImages, setGalleryImages] = useState<CatalogImageItem[]>([]);
  const [activePreviewImage, setActivePreviewImage] = useState<CatalogImageItem | null>(null);

  // Candidate Search & Replacement Modal State
  const [searchModalOpen, setSearchModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [candidateLoading, setCandidateLoading] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateItem | null>(null);
  const [candidateTargetSlot, setCandidateTargetSlot] = useState<string>('combined');
  const [candidateKeepExisting, setCandidateKeepExisting] = useState<boolean>(false);

  // Reason Dropdown Modal State
  const [reasonModalOpen, setReasonModalOpen] = useState<boolean>(false);
  const [selectedReasonCode, setSelectedReasonCode] = useState<string>('NEED_BACKSIDE');
  const [customReasonText, setCustomReasonText] = useState<string>('');

  // History Drawer State
  const [historyModalOpen, setHistoryModalOpen] = useState<boolean>(false);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Feedback Notification
  const [bannerMsg, setBannerMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Fullscreen image preview
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  const showBanner = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setBannerMsg({ text, type });
    setTimeout(() => {
      setBannerMsg(prev => (prev?.text === text ? null : prev));
    }, 3500);
  };

  // 1. Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await api.getCorrectionStats();
      if (res.success && res.stats) {
        setStats(res.stats);
      }
    } catch (err: any) {
      console.error('[ImageCorrection] Failed to fetch stats:', err);
    }
  }, []);

  // 2. Fetch Queue
  const fetchQueue = useCallback(async (resetIndex = false) => {
    setLoading(true);
    try {
      const res = await api.getCorrectionQueue({
        category: selectedCategory === 'All Categories' ? undefined : selectedCategory,
        search: searchTerm.trim() || undefined,
        status: statusFilter,
        page,
        limit: 30
      });

      if (res.success) {
        setImages(res.images || []);
        setTotalCount(res.totalCount || 0);
        setCategories(res.categories || []);
        if (resetIndex) {
          setCurrentIndex(0);
        } else if (res.images && currentIndex >= res.images.length) {
          setCurrentIndex(Math.max(0, res.images.length - 1));
        }
      }
    } catch (err: any) {
      console.error('[ImageCorrection] Failed to fetch queue:', err);
      showBanner('Failed to load image queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchTerm, statusFilter, page, currentIndex]);

  useEffect(() => {
    fetchStats();
    fetchQueue(true);
  }, [selectedCategory, statusFilter, page]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchQueue(true);
    }, 400);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const currentItem = useMemo(() => {
    if (!images || images.length === 0) return null;
    return images[currentIndex] || null;
  }, [images, currentIndex]);

  const displayedImage: CatalogImageItem | null = activePreviewImage || currentItem;

  // Fetch medicine gallery when currentItem changes
  const fetchGallery = useCallback(async (medicineId: number) => {
    try {
      const res = await api.getMedicineImageGallery(medicineId);
      if (res.success) {
        setGalleryImages(res.images || []);
      }
    } catch (_err) {}
  }, []);

  useEffect(() => {
    setActivePreviewImage(null);
    if (currentItem?.medicine_id) {
      fetchGallery(currentItem.medicine_id);
    } else {
      setGalleryImages([]);
    }
  }, [currentItem?.id, currentItem?.medicine_id, fetchGallery]);

  // Navigate queue items
  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else if (page * 30 < totalCount) {
      setPage(p => p + 1);
      setCurrentIndex(0);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    } else if (page > 1) {
      setPage(p => p - 1);
      setCurrentIndex(29);
    }
  };

  // Action: Mark Correct
  const handleMarkCorrect = async (slotType?: string) => {
    if (!currentItem || actionLoading) return;
    setActionLoading(true);
    try {
      const targetType = slotType || displayedImage?.image_type || 'combined';
      const isPrimary = targetType === 'combined';
      const targetId = displayedImage?.id ?? currentItem.id;
      const res = await api.markImageCorrect(targetId, 'admin', targetType, isPrimary);
      if (res.success) {
        showBanner(`Verified (${targetType}): ${currentItem.product_name}`, 'success');
        // Remove locally from queue without page reload (Section 7, 22)
        setImages(prev => prev.filter(item => item.id !== currentItem.id));
        setTotalCount(prev => Math.max(0, prev - 1));
        fetchStats();
      }
    } catch (err: any) {
      showBanner(err.message || 'Failed to mark correct', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Open Reason Dropdown Modal
  const handleOpenReasonModal = () => {
    if (!currentItem || actionLoading) return;
    setSelectedReasonCode('NEED_BACKSIDE');
    setCustomReasonText('');
    setReasonModalOpen(true);
  };

  // Action: Confirm Rejection or Smart Angle from Modal
  const handleConfirmReason = async () => {
    if (!currentItem || actionLoading) return;
    setActionLoading(true);
    try {
      const selectedOpt = REASON_OPTIONS.find(r => r.code === selectedReasonCode);
      const reasonText = selectedReasonCode === 'CUSTOM'
        ? (customReasonText.trim() || 'Custom review flag')
        : (selectedOpt?.title || 'Incorrect image');

      const targetId = displayedImage?.id ?? currentItem.id;
      const res = await api.markImageIncorrect(targetId, reasonText, 'admin', selectedReasonCode);
      if (res.success) {
        setReasonModalOpen(false);
        fetchStats();

        if (res.action === 'search_candidate') {
          showBanner(res.message || 'Saved! Searching for requested angle...', 'success');
          if (currentItem.medicine_id) fetchGallery(currentItem.medicine_id);
          const targetSlot = res.targetType || 'back';
          setCandidateTargetSlot(targetSlot);
          setCandidateKeepExisting(true);
          const query = `${currentItem.product_name || currentItem.medicine_name || ''} ${targetSlot === 'back' ? 'back blister' : ''}`.trim();
          setSearchQuery(query);
          setCandidates([]);
          setSelectedCandidate(null);
          setSearchModalOpen(true);
          performCandidateSearch(query, targetSlot);
        } else {
          showBanner(`Flagged incorrect: ${reasonText}`, 'info');
          setImages(prev => prev.map(item => item.id === currentItem.id ? { ...item, verification_status: 'INCORRECT' } : item));
          setCandidateTargetSlot(currentItem.image_type || 'combined');
          setCandidateKeepExisting(false);
          openCandidateSearch(currentItem.image_type || 'combined', false);
        }
      }
    } catch (err: any) {
      showBanner(err.message || 'Failed to process flag', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Skip
  const handleSkip = async (hours = 24) => {
    if (!currentItem || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await api.skipImage(currentItem.id, hours, `Skipped for ${hours}h by agent`, 'admin');
      if (res.success) {
        showBanner(`Skipped for ${hours} hours`, 'info');
        // Remove temporarily from queue
        setImages(prev => prev.filter(item => item.id !== currentItem.id));
        setTotalCount(prev => Math.max(0, prev - 1));
        fetchStats();
      }
    } catch (err: any) {
      showBanner(err.message || 'Failed to skip image', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Open Candidate Search Modal
  const openCandidateSearch = (slot = 'combined', keepExisting = false) => {
    if (!currentItem) return;
    setCandidateTargetSlot(slot);
    setCandidateKeepExisting(keepExisting);
    const query = `${currentItem.product_name || currentItem.medicine_name || ''} ${slot === 'back' ? 'back blister' : ''}`.trim();
    setSearchQuery(query);
    setCandidates([]);
    setSelectedCandidate(null);
    setSearchModalOpen(true);
    performCandidateSearch(query, slot);
  };

  // Action: Perform Search
  const performCandidateSearch = async (queryText?: string, slot?: string) => {
    if (!currentItem) return;
    setCandidateLoading(true);
    try {
      const q = queryText !== undefined ? queryText : searchQuery;
      const targetSlot = slot || candidateTargetSlot;
      const res = await api.searchCandidateImages(currentItem.id, q, targetSlot);
      if (res.success) {
        setCandidates(res.candidates || []);
        if (res.candidates && res.candidates.length > 0) {
          setSelectedCandidate(res.candidates[0]);
        }
      }
    } catch (err: any) {
      showBanner(err.message || 'Candidate search failed', 'error');
    } finally {
      setCandidateLoading(false);
    }
  };

  // Action: Replace with Candidate
  const handleReplaceCandidate = async () => {
    if (!currentItem || !selectedCandidate || actionLoading) return;
    setActionLoading(true);
    try {
      const targetSlot = candidateTargetSlot || 'combined';
      const isPrimary = targetSlot === 'combined';
      const res = await api.replaceWithCandidate(currentItem.id, {
        candidate_url: selectedCandidate.imageUrl,
        candidate_title: selectedCandidate.name,
        verified_by: 'admin',
        image_type: targetSlot,
        is_primary: isPrimary,
        keep_existing: candidateKeepExisting
      });
      if (res.success) {
        showBanner(candidateKeepExisting ? `Added ${targetSlot} image!` : 'Image updated and verified!', 'success');
        setSearchModalOpen(false);
        if (currentItem.medicine_id) fetchGallery(currentItem.medicine_id);
        if (!candidateKeepExisting) {
          setImages(prev => prev.filter(item => item.id !== currentItem.id));
          setTotalCount(prev => Math.max(0, prev - 1));
        }
        fetchStats();
      }
    } catch (err: any) {
      showBanner(err.message || 'Replacement failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Open History
  const openHistory = async () => {
    if (!currentItem) return;
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const res = await api.getImageHistory(currentItem.id);
      if (res.success) {
        setHistoryList(res.history || []);
      }
    } catch (err: any) {
      showBanner('Failed to load history', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  // Action: Reopen Image
  const handleReopen = async (imageId: number) => {
    try {
      const res = await api.reopenImage(imageId, 'admin');
      if (res.success) {
        showBanner('Image reopened for review', 'info');
        fetchStats();
        fetchQueue();
        setHistoryModalOpen(false);
      }
    } catch (err: any) {
      showBanner('Failed to reopen image', 'error');
    }
  };

  // Keyboard Shortcuts (Section 13)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when user is actively typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        return;
      }

      if (searchModalOpen || historyModalOpen || fullscreenImage || reasonModalOpen) {
        if (e.key === 'Escape') {
          setSearchModalOpen(false);
          setHistoryModalOpen(false);
          setFullscreenImage(null);
          setReasonModalOpen(false);
        }
        return;
      }

      switch (e.key.toUpperCase()) {
        case 'C':
          e.preventDefault();
          handleMarkCorrect();
          break;
        case 'X':
          e.preventDefault();
          handleOpenReasonModal();
          break;
        case 'S':
          e.preventDefault();
          handleSkip(24);
          break;
        case 'N':
        case 'ARROW_RIGHT':
          e.preventDefault();
          handleNext();
          break;
        case 'P':
        case 'ARROW_LEFT':
          e.preventDefault();
          handlePrev();
          break;
        case 'R':
          e.preventDefault();
          openCandidateSearch();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentItem, actionLoading, searchModalOpen, historyModalOpen, fullscreenImage, images, currentIndex]);

  return (
    <div className="flex flex-col h-full bg-bg text-text overflow-hidden">
      {/* Toast Banner */}
      {bannerMsg && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 border transition-all animate-in fade-in slide-in-from-top-2 ${
            bannerMsg.type === 'success'
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : bannerMsg.type === 'error'
              ? 'bg-red-600 border-red-500 text-white'
              : 'bg-sky-600 border-sky-500 text-white'
          }`}
        >
          {bannerMsg.type === 'success' && <CheckCircle size={16} />}
          {bannerMsg.type === 'error' && <XCircle size={16} />}
          {bannerMsg.type === 'info' && <Sparkles size={16} />}
          <span>{bannerMsg.text}</span>
        </div>
      )}

      {/* Top Header: Title & Live Metrics Dashboard (Section 6, 27) */}
      <div className="px-6 py-4 border-b border-border bg-bg2/40 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky/10 border border-sky/20 text-sky">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-wide text-text leading-tight">
                IMAGE CORRECTION CENTER
              </h1>
              <p className="text-[11px] text-muted font-medium">
                Persistent Catalog Image Verification & Candidate Replacement Workflow
              </p>
            </div>
          </div>
        </div>

        {/* Quality Metrics Strip */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="px-3 py-1.5 rounded-xl bg-bg3/60 border border-border flex flex-col items-center min-w-[70px]">
            <span className="text-[10px] uppercase font-bold text-amber-500 tracking-wider">Pending</span>
            <span className="text-sm font-black text-text">{stats.pending.toLocaleString()}</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-bg3/60 border border-border flex flex-col items-center min-w-[70px]">
            <span className="text-[10px] uppercase font-bold text-rose-500 tracking-wider">Incorrect</span>
            <span className="text-sm font-black text-text">{stats.incorrect.toLocaleString()}</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-bg3/60 border border-border flex flex-col items-center min-w-[70px]">
            <span className="text-[10px] uppercase font-bold text-sky tracking-wider">Corrected</span>
            <span className="text-sm font-black text-text">{stats.corrected.toLocaleString()}</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-bg3/60 border border-border flex flex-col items-center min-w-[70px]">
            <span className="text-[10px] uppercase font-bold text-green tracking-wider">Verified</span>
            <span className="text-sm font-black text-text">{stats.verified.toLocaleString()}</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-bg3/60 border border-border flex flex-col items-center min-w-[70px]">
            <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Skipped</span>
            <span className="text-sm font-black text-text">{stats.skipped.toLocaleString()}</span>
          </div>

          <div className="px-3.5 py-1.5 rounded-xl bg-gradient-to-br from-emerald-500/15 to-sky-500/15 border border-emerald-500/30 flex flex-col items-center min-w-[85px]">
            <span className="text-[10px] uppercase font-black text-emerald-400 tracking-wider">Accuracy</span>
            <span className="text-sm font-black text-text">{stats.accuracyPercent}%</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar: Categories, Statuses, Search & Pagination */}
      <div className="px-6 py-2.5 border-b border-border bg-bg/50 backdrop-blur flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Category Pills (Section 12) */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full scrollbar-none">
          {categories.map(cat => {
            const isSelected = selectedCategory === cat.category;
            return (
              <button
                key={cat.category}
                onClick={() => {
                  setSelectedCategory(cat.category);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-bg2 hover:bg-bg3 text-muted hover:text-text border border-border'
                }`}
              >
                <span>{cat.category}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${isSelected ? 'bg-primary text-white' : 'bg-bg3 text-muted'}`}>
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Status Controls */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-48 sm:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search product, brand..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-bg2 border border-border text-xs text-text placeholder:text-muted focus:outline-none focus:border-sky/50 transition-colors"
            />
          </div>

          {/* Status Mode Select */}
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-bg2 border border-border text-xs font-medium text-text focus:outline-none cursor-pointer"
          >
            <option value="unresolved">Unresolved Queue</option>
            <option value="pending">Pending Only</option>
            <option value="incorrect">Incorrect Flagged</option>
            <option value="skipped">Skipped (Cooling)</option>
          </select>

          <button
            onClick={() => {
              fetchStats();
              fetchQueue();
            }}
            title="Refresh Queue"
            className="p-1.5 rounded-xl bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Review Workspace */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col justify-between">
        {loading && images.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-9 h-9 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <span className="text-xs text-muted font-bold tracking-widest uppercase">Loading Queue...</span>
          </div>
        ) : !currentItem ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle size={32} />
            </div>
            <div>
              <h3 className="text-base font-black text-text">Queue Clear!</h3>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                All images in this filter have been verified or resolved. No pending or incorrect items remain to review.
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedCategory('All Categories');
                setStatusFilter('unresolved');
                setSearchTerm('');
              }}
              className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="max-w-4xl w-full mx-auto flex flex-col gap-5">
            {/* Queue Position Tracker & Hotkeys Header */}
            <div className="flex items-center justify-between text-xs font-medium text-muted">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-bg2 border border-border font-bold text-text">
                  Item {currentIndex + 1} of {images.length}
                </span>
                <span>({totalCount} total in queue)</span>
              </div>

              {/* Keyboard Shortcuts Hint Bar (Section 13) */}
              <div className="hidden sm:flex items-center gap-2 text-[11px]">
                <span className="text-muted">Shortcuts:</span>
                <span className="px-1.5 py-0.5 rounded bg-bg2 border border-border text-emerald-400 font-bold">C</span> Verify
                <span className="px-1.5 py-0.5 rounded bg-bg2 border border-border text-rose-400 font-bold">X</span> Incorrect
                <span className="px-1.5 py-0.5 rounded bg-bg2 border border-border text-amber-400 font-bold">S</span> Skip
                <span className="px-1.5 py-0.5 rounded bg-bg2 border border-border text-sky font-bold">R</span> Replace
                <span className="px-1.5 py-0.5 rounded bg-bg2 border border-border text-muted font-bold">N / P</span> Next/Prev
              </div>
            </div>

            {/* 5-Slot Angle Navigation Strip */}
            <div className="flex items-center gap-2 p-2.5 rounded-2xl border border-border bg-bg2/60 backdrop-blur-xl shadow-md overflow-x-auto">
              <div className="flex items-center gap-1.5 pl-1 pr-3 border-r border-border shrink-0">
                <Layers size={15} className="text-sky" />
                <span className="text-[11px] font-bold text-text uppercase tracking-wider">Angles:</span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                {STANDARD_SLOTS.map(slot => {
                  const matched = galleryImages.find(g => (g.image_type || 'combined') === slot.id && g.is_active === 1)
                    || (currentItem && (currentItem.image_type || 'combined') === slot.id ? currentItem : null);
                  const isSelected = activePreviewImage 
                    ? (activePreviewImage.id === matched?.id || (!matched && (activePreviewImage.image_type || 'combined') === slot.id))
                    : (!activePreviewImage && (currentItem?.image_type || 'combined') === slot.id);

                  return (
                    <button
                      key={slot.id}
                      onClick={() => {
                        if (matched) {
                          setActivePreviewImage(matched);
                        } else {
                          openCandidateSearch(slot.id, true);
                        }
                      }}
                      title={slot.desc}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
                        isSelected
                          ? 'bg-primary text-white shadow-md ring-1 ring-primary'
                          : matched
                          ? 'bg-bg hover:bg-bg3 border border-emerald-500/30 text-emerald-400'
                          : 'bg-bg hover:bg-bg3 border border-dashed border-border text-muted hover:text-text'
                      }`}
                    >
                      <span>{slot.label}</span>
                      {matched ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-bold flex items-center gap-1">
                          <Check size={10} /> Active
                        </span>
                      ) : (
                        <span className="text-[10px] opacity-70 flex items-center gap-0.5">
                          <Plus size={10} /> Add
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Primary Review Card (Section 6) */}
            <div className="rounded-2xl border border-border bg-bg2/60 backdrop-blur-xl shadow-xl overflow-hidden flex flex-col md:flex-row">
              {/* Left Column: Image Viewport */}
              <div className="md:w-5/12 bg-bg3/40 border-b md:border-b-0 md:border-r border-border p-6 flex flex-col items-center justify-center relative group min-h-[300px]">
                {displayedImage?.image_path ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <img
                      src={displayedImage.image_path}
                      alt={displayedImage.product_name || currentItem.product_name}
                      className="max-h-64 max-w-full object-contain rounded-xl drop-shadow-md cursor-pointer transition-transform duration-300 group-hover:scale-105"
                      onClick={() => setFullscreenImage(displayedImage.image_path)}
                      onError={(e: any) => {
                        e.target.style.display = 'none';
                        const fb = e.target.nextSibling;
                        if (fb) fb.style.display = 'flex';
                      }}
                    />
                    <div
                      style={{ display: 'none' }}
                      className="w-full h-48 rounded-xl border border-dashed border-border bg-bg2 flex flex-col items-center justify-center text-muted p-4 text-center"
                    >
                      <AlertTriangle size={28} className="text-amber-500 mb-2" />
                      <span className="text-xs font-bold text-text">Image failed to load</span>
                      <span className="text-[10px] mt-1">Source file may be missing or broken</span>
                    </div>

                    <button
                      onClick={() => setFullscreenImage(displayedImage.image_path)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-bg/80 border border-border text-muted hover:text-text opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Zoom Image"
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="w-full h-48 rounded-xl border border-dashed border-border bg-bg2 flex flex-col items-center justify-center text-muted p-4 text-center">
                    <AlertTriangle size={32} className="text-rose-500 mb-2" />
                    <span className="text-xs font-bold text-text">No image associated</span>
                    <span className="text-[10px] mt-1">Product requires candidate search & assignment</span>
                  </div>
                )}

                {/* Status & Angle Floating Tag */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] font-bold">
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      displayedImage?.verification_status === 'INCORRECT'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        : displayedImage?.verification_status === 'APPROVED' || displayedImage?.verification_status === 'CORRECTED'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    }`}
                  >
                    SLOT: {(displayedImage?.image_type || 'combined').toUpperCase()} • {displayedImage?.verification_status || 'PENDING'}
                  </span>

                  <span className="px-2 py-0.5 rounded-full bg-bg border border-border text-muted">
                    Score: {displayedImage?.confidence_score || currentItem.confidence_score}%
                  </span>
                </div>
              </div>

              {/* Right Column: Product Master Details & Action Deck */}
              <div className="md:w-7/12 p-6 flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  {/* Title & Brand */}
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky">
                      {currentItem.manufacturer || currentItem.company_name || 'Generic Pharma'}
                    </span>
                    <h2 className="text-lg sm:text-xl font-black text-text mt-0.5 leading-snug">
                      {currentItem.medicine_name || currentItem.product_name}
                    </h2>
                    {currentItem.generic_name && (
                      <p className="text-xs text-muted font-medium mt-1">
                        Salt: <span className="text-text font-semibold">{currentItem.generic_name}</span>
                      </p>
                    )}
                  </div>

                  {/* Specification Grid */}
                  <div className="grid grid-cols-2 gap-2.5 pt-2 text-xs">
                    <div className="p-2 rounded-xl bg-bg border border-border">
                      <span className="text-[10px] text-muted block uppercase font-bold">Strength</span>
                      <span className="font-semibold text-text">{currentItem.strength || 'N/A'}</span>
                    </div>

                    <div className="p-2 rounded-xl bg-bg border border-border">
                      <span className="text-[10px] text-muted block uppercase font-bold">Packaging / Form</span>
                      <span className="font-semibold text-text">{currentItem.packaging || 'Standard'}</span>
                    </div>

                    <div className="p-2 rounded-xl bg-bg border border-border">
                      <span className="text-[10px] text-muted block uppercase font-bold">MRP</span>
                      <span className="font-semibold text-text">
                        {currentItem.mrp ? `₹${currentItem.mrp}` : 'Unpriced'}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-bg border border-border">
                      <span className="text-[10px] text-muted block uppercase font-bold">Source Engine</span>
                      <span className="font-semibold text-text uppercase text-[11px]">{currentItem.image_source || 'Pharmeasy'}</span>
                    </div>
                  </div>

                  {/* Previous Status / Reason Note if flagged */}
                  {currentItem.verification_reason && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                      <span className="font-bold">Flagged Reason: </span>
                      {currentItem.verification_reason}
                    </div>
                  )}

                  {currentItem.previous_image_url && (
                    <div className="text-[11px] text-muted flex items-center gap-1.5">
                      <RotateCcw size={12} className="text-sky" />
                      <span>Replaced previously from: </span>
                      <code className="px-1 py-0.5 rounded bg-bg border border-border text-[10px] font-mono">
                        {currentItem.previous_image_url.split('/').pop()}
                      </code>
                    </div>
                  )}
                </div>

                {/* Instant Actions Deck (Section 7, 8, 13) */}
                <div className="pt-4 border-t border-border space-y-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    {/* [ C ] CORRECT */}
                    <button
                      onClick={() => handleMarkCorrect()}
                      disabled={actionLoading}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md hover:shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle size={15} />
                      <span>Correct [C]</span>
                    </button>

                    {/* [ X ] INCORRECT -> Opens Reason Dropdown Modal */}
                    <button
                      onClick={handleOpenReasonModal}
                      disabled={actionLoading}
                      className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md hover:shadow-red-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <XCircle size={15} />
                      <span>Incorrect [X]</span>
                    </button>

                    {/* [ S ] SKIP */}
                    <button
                      onClick={() => handleSkip(24)}
                      disabled={actionLoading}
                      className="px-4 py-2.5 rounded-xl bg-bg3 hover:bg-bg3/80 text-text border border-border font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Clock size={15} className="text-muted" />
                      <span>Skip [S]</span>
                    </button>
                  </div>

                  {/* Secondary Actions: Search Candidates & History */}
                  <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                    <button
                      onClick={() => openCandidateSearch()}
                      disabled={actionLoading}
                      className="px-3.5 py-2 rounded-xl bg-sky/10 hover:bg-sky/20 border border-sky/30 text-sky font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Search size={14} />
                      <span>Find Alternative Candidate [R]</span>
                    </button>

                    <button
                      onClick={openHistory}
                      className="px-3.5 py-2 rounded-xl bg-bg hover:bg-bg3 border border-border text-muted hover:text-text font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <History size={14} />
                      <span>Audit Trail</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Stepper Bar */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0 && page === 1}
                className="px-3.5 py-1.5 rounded-xl bg-bg2 border border-border text-xs font-bold text-text hover:bg-bg3 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
                <span>Previous [P]</span>
              </button>

              <div className="flex items-center gap-1 text-xs font-medium text-muted">
                <span>Navigate card by card or use keyboard hotkeys</span>
              </div>

              <button
                onClick={handleNext}
                disabled={currentIndex === images.length - 1 && page * 30 >= totalCount}
                className="px-3.5 py-1.5 rounded-xl bg-bg2 border border-border text-xs font-bold text-text hover:bg-bg3 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Next [N]</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Candidate Search & Image Replacement Modal (Section 8, 9, 10) */}
      {searchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-bg2 border border-border rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-text">Candidate Image Search & Preview</h3>
                <p className="text-xs text-muted">Review web images, inspect confidence scores, and replace</p>
              </div>
              <button
                onClick={() => setSearchModalOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Search Input Bar */}
            <div className="p-4 border-b border-border bg-bg/40 flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && performCandidateSearch()}
                  placeholder="Type product name, brand, strength to search..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted focus:outline-none focus:border-sky/50"
                />
              </div>
              <button
                onClick={() => performCandidateSearch()}
                disabled={candidateLoading}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs hover:bg-primary/90 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={14} className={candidateLoading ? 'animate-spin' : ''} />
                <span>Search</span>
              </button>
            </div>

            {/* Candidates Body */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
              {candidateLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 gap-2 text-muted">
                  <RefreshCw size={24} className="animate-spin text-sky" />
                  <span className="text-xs font-semibold">Querying candidate images...</span>
                </div>
              ) : candidates.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 gap-2 text-center text-muted">
                  <AlertTriangle size={28} className="text-amber-500" />
                  <span className="text-xs font-bold text-text">No alternative candidate images found</span>
                  <span className="text-[11px] max-w-xs">
                    Try refining your search keyword above with just the core medicine name.
                  </span>
                </div>
              ) : (
                <>
                  {/* Left Column: Candidate List Grid */}
                  <div className="md:w-1/2 space-y-3 overflow-y-auto max-h-[500px] pr-1">
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider block">
                      Candidates ({candidates.length})
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      {candidates.map((cand, idx) => {
                        const isSelected = selectedCandidate?.id === cand.id;
                        return (
                          <div
                            key={cand.id || idx}
                            onClick={() => setSelectedCandidate(cand)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col items-center text-center ${
                              isSelected
                                ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary'
                                : 'border-border bg-bg hover:bg-bg3/60'
                            }`}
                          >
                            <img
                              src={cand.imageUrl}
                              alt={cand.name}
                              className="h-28 w-28 object-contain rounded-lg mb-2 bg-bg3/50 p-1"
                            />
                            <span className="text-xs font-bold text-text line-clamp-2">{cand.name}</span>
                            <span className="text-[10px] text-muted line-clamp-1 mt-0.5">{cand.manufacturer}</span>
                            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold">
                              <span className="px-1.5 py-0.5 rounded bg-bg3 text-sky">
                                {cand.confidenceScore}% match
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Selected Candidate vs Current Comparison */}
                  <div className="md:w-1/2 p-4 rounded-xl bg-bg border border-border flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-3">
                        Preview & Compare
                      </span>

                      {selectedCandidate ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 text-center">
                            <div className="p-3 rounded-xl bg-bg2 border border-border flex flex-col items-center">
                              <span className="text-[10px] uppercase font-bold text-muted mb-1">Current Image</span>
                              {currentItem?.image_path ? (
                                <img
                                  src={currentItem.image_path}
                                  alt="Current"
                                  className="h-28 w-28 object-contain rounded-lg"
                                />
                              ) : (
                                <div className="h-28 w-28 rounded-lg border border-dashed border-border flex items-center justify-center text-[10px] text-muted">
                                  No image
                                </div>
                              )}
                            </div>

                            <div className="p-3 rounded-xl bg-primary/5 border border-primary/30 flex flex-col items-center">
                              <span className="text-[10px] uppercase font-bold text-sky mb-1">New Candidate</span>
                              <img
                                src={selectedCandidate.imageUrl}
                                alt="Selected"
                                className="h-28 w-28 object-contain rounded-lg"
                              />
                            </div>
                          </div>

                          <div className="space-y-2 text-xs">
                            <div>
                              <span className="text-[10px] text-muted uppercase font-bold block">Candidate Title</span>
                              <span className="font-bold text-text">{selectedCandidate.name}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-muted uppercase font-bold block">Manufacturer</span>
                              <span className="text-text">{selectedCandidate.manufacturer}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-muted uppercase font-bold block">Match Verification</span>
                              <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{selectedCandidate.reason}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-muted py-8 text-xs">Select a candidate on the left to preview</div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-border mt-4">
                      <button
                        onClick={handleReplaceCandidate}
                        disabled={!selectedCandidate || actionLoading}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg hover:shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        <Check size={16} />
                        <span>
                          {candidateKeepExisting
                            ? `Add as ${(candidateTargetSlot || 'back').toUpperCase()} Angle (Keep Front)`
                            : `Use This Image & Mark Verified`}
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Rejection & Reason Dropdown Modal */}
      {reasonModalOpen && currentItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-bg2 border border-border rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-text">Select Rejection / Review Reason</h3>
                <p className="text-xs text-muted truncate max-w-md">
                  {currentItem.product_name || currentItem.medicine_name}
                </p>
              </div>
              <button
                onClick={() => setReasonModalOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Modal Body: Options List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
                Choose reason for flagging or requesting angle:
              </span>
              <div className="space-y-2">
                {REASON_OPTIONS.map(opt => {
                  const isSelected = selectedReasonCode === opt.code;
                  const Icon = opt.icon;
                  return (
                    <div
                      key={opt.code}
                      onClick={() => setSelectedReasonCode(opt.code)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                        isSelected
                          ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                          : 'border-border bg-bg hover:bg-bg3/60'
                      }`}
                    >
                      <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${isSelected ? 'bg-primary text-white' : 'bg-bg2 text-muted'}`}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-text">
                            {opt.title}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${opt.badgeColor}`}>
                            {opt.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
                          {opt.subtitle}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Custom Reason Text Box */}
              {selectedReasonCode === 'CUSTOM' && (
                <div className="pt-2 animate-in fade-in">
                  <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1">
                    Describe custom reason:
                  </label>
                  <textarea
                    value={customReasonText}
                    onChange={e => setCustomReasonText(e.target.value)}
                    placeholder="Enter specific note or reason for this image..."
                    rows={2}
                    className="w-full p-2.5 rounded-xl bg-bg border border-border text-xs text-text placeholder:text-muted focus:outline-none focus:border-sky/50"
                  />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border bg-bg/40 flex items-center justify-between gap-3">
              <button
                onClick={() => setReasonModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-bg border border-border text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmReason}
                disabled={actionLoading}
                className="px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-xs shadow-md hover:bg-primary/90 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Check size={15} />
                <span>
                  {selectedReasonCode === 'NEED_BACKSIDE'
                    ? 'Keep Front & Search Backside'
                    : selectedReasonCode === 'NEED_FRONT'
                    ? 'Save Back & Search Front'
                    : 'Confirm Flag & Search Alternative'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Audit Drawer (Section 18) */}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-bg2 border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-text">Image Review Audit Trail</h3>
                <p className="text-xs text-muted">Complete lifecycle and manual verification history</p>
              </div>
              <button
                onClick={() => setHistoryModalOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted">
                  <RefreshCw size={24} className="animate-spin text-sky" />
                  <span className="text-xs font-semibold">Loading audit logs...</span>
                </div>
              ) : historyList.length === 0 ? (
                <div className="text-center py-12 text-muted text-xs">
                  No previous modifications recorded for this product.
                </div>
              ) : (
                <div className="space-y-4">
                  {historyList.map((entry, idx) => (
                    <div key={entry.id || idx} className="p-3.5 rounded-xl bg-bg border border-border space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded-full bg-sky/10 border border-sky/20 text-sky font-bold text-[10px]">
                          {entry.action}
                        </span>
                        <span className="text-[10px] text-muted">
                          {new Date(entry.performed_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="text-text flex items-center gap-2">
                        <span className="text-muted">Status Transition: </span>
                        <span className="font-semibold text-rose-400">{entry.previous_status || 'NONE'}</span>
                        <ArrowRight size={12} className="text-muted" />
                        <span className="font-semibold text-emerald-400">{entry.new_status}</span>
                      </div>

                      {entry.reason && (
                        <p className="text-[11px] text-muted bg-bg2 p-2 rounded-lg">
                          <span className="font-semibold text-text">Reason: </span>
                          {entry.reason}
                        </p>
                      )}

                      <div className="text-[10px] text-muted flex items-center justify-between pt-1">
                        <span>Agent: {entry.performed_by || 'admin'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reopen Action in Footer for Admins (Section 26) */}
            {currentItem && (
              <div className="p-4 border-t border-border bg-bg/40 flex items-center justify-between">
                <span className="text-[11px] text-muted">Need quality re-check on this item?</span>
                <button
                  onClick={() => handleReopen(currentItem.id)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw size={13} />
                  <span>Reopen for Review</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 cursor-pointer"
          onClick={() => setFullscreenImage(null)}
        >
          <div className="relative max-w-2xl max-h-[85vh] bg-bg rounded-2xl p-4 border border-border shadow-2xl">
            <img
              src={fullscreenImage}
              alt="Fullscreen Preview"
              className="max-h-[75vh] w-auto mx-auto object-contain"
            />
            <span className="text-center block text-xs text-muted font-semibold mt-2">
              Click anywhere to close preview
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
