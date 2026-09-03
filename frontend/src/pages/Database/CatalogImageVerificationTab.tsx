import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, XCircle, RefreshCw, Eye, Trash2, Search,
  ShieldCheck, AlertTriangle, AlertCircle, ArrowRight, ArrowLeft,
  Upload, ZoomIn, X, ExternalLink, Database, Check
} from 'lucide-react';
import { api } from '../../services/api';
import type { CatalogImageItem, CatalogImageCounts } from '../../services/api';
import { toastEvent } from '../../services/events';

interface Props {
  initialFilter?: string;
}

export const CatalogImageVerificationTab: React.FC<Props> = ({ initialFilter = 'review' }) => {
  const [filter, setFilter] = useState<string>(initialFilter);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [images, setImages] = useState<CatalogImageItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<CatalogImageCounts>({
    total: 0,
    pending_review: 0,
    high_confidence: 0,
    approved: 0,
    rejected: 0,
    removed: 0
  });

  // Zoom / Inspection Modal
  const [inspectedImage, setInspectedImage] = useState<CatalogImageItem | null>(null);

  // Replace Modal
  const [replacingImage, setReplacingImage] = useState<CatalogImageItem | null>(null);
  const [customImagePath, setCustomImagePath] = useState('');
  const [customSourceUrl, setCustomSourceUrl] = useState('');

  // Reject Confirmation Modal
  const [rejectingImage, setRejectingImage] = useState<CatalogImageItem | null>(null);
  const [rejectReason, setRejectReason] = useState('Incorrect brand or packaging view');

  // Remove Confirmation Modal
  const [removingImage, setRemovingImage] = useState<CatalogImageItem | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load counts
  const loadCounts = useCallback(() => {
    api.getCatalogImageCounts()
      .then(res => {
        if (res.success && res.counts) {
          setCounts(res.counts);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch images list
  const loadImages = useCallback(() => {
    setLoading(true);
    api.getCatalogImages({
      status: filter === 'all' ? undefined : filter,
      search: debouncedSearch || undefined,
      page,
      limit: 18
    })
      .then(res => {
        if (res.success) {
          setImages(res.images || []);
          setTotalCount(res.totalCount || 0);
          setTotalPages(res.totalPages || 1);
        }
      })
      .catch(err => {
        toastEvent.trigger('Failed to load catalog images: ' + err.message, 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [filter, debouncedSearch, page]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // Keyboard navigation & shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'ArrowRight' && page < totalPages) {
        setPage(p => p + 1);
      } else if (e.key === 'ArrowLeft' && page > 1) {
        setPage(p => p - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [page, totalPages]);

  // Action Handlers
  const handleApprove = async (img: CatalogImageItem) => {
    try {
      const res = await api.approveCatalogImage(img.id);
      if (res.success) {
        toastEvent.trigger(`Approved image for ${img.product_name}`, 'success');
        // Optimistic update
        setImages(prev => prev.map(item => item.id === img.id ? { ...item, verification_status: 'APPROVED', is_active: 1 } : item));
        loadCounts();
        if (filter === 'review') {
          setImages(prev => prev.filter(item => item.id !== img.id));
        }
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to approve: ' + err.message, 'error');
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingImage) return;
    try {
      const res = await api.rejectCatalogImage(rejectingImage.id, rejectReason);
      if (res.success) {
        toastEvent.trigger(`Rejected image. Candidate excluded from future matches.`, 'info');
        setImages(prev => prev.filter(item => item.id !== rejectingImage.id));
        loadCounts();
        setRejectingImage(null);
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to reject: ' + err.message, 'error');
    }
  };

  const handleConfirmRemove = async () => {
    if (!removingImage) return;
    try {
      const res = await api.removeCatalogImage(removingImage.id);
      if (res.success) {
        toastEvent.trigger('Image removed from active catalogue', 'info');
        setImages(prev => prev.filter(item => item.id !== removingImage.id));
        loadCounts();
        setRemovingImage(null);
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to remove: ' + err.message, 'error');
    }
  };

  const handleConfirmReplace = async () => {
    if (!replacingImage || !customImagePath) return;
    try {
      const res = await api.replaceCatalogImage(replacingImage.id, {
        new_image_path: customImagePath,
        source_url: customSourceUrl || undefined
      });
      if (res.success) {
        toastEvent.trigger('Image replaced successfully', 'success');
        loadImages();
        loadCounts();
        setReplacingImage(null);
        setCustomImagePath('');
        setCustomSourceUrl('');
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to replace image: ' + err.message, 'error');
    }
  };

  const handleRedownload = async (img: CatalogImageItem) => {
    try {
      toastEvent.trigger(`Searching fresh candidate online for ${img.product_name}...`, 'info');
      const res = await api.redownloadCatalogImage(img.id);
      if (res.success) {
        toastEvent.trigger('Found and downloaded alternative candidate!', 'success');
        loadImages();
        loadCounts();
      } else {
        toastEvent.trigger(res.message || 'No alternative image found.', 'info');
      }
    } catch (err: any) {
      toastEvent.trigger('Re-download error: ' + err.message, 'error');
    }
  };

  const handleSyncState = async () => {
    setSyncing(true);
    try {
      const res = await api.syncCatalogImageState();
      if (res.success) {
        toastEvent.trigger(`Synced ${res.synced} existing downloaded catalog images into database!`, 'success');
        loadCounts();
        loadImages();
      }
    } catch (err: any) {
      toastEvent.trigger('Sync failed: ' + err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg text-text">
      {/* Top Header Bar */}
      <div className="p-4 border-b border-glass-border flex flex-col md:flex-row md:items-center justify-between gap-3 bg-bg2/50 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <ShieldCheck size={20} />
            </div>
            <h2 className="text-lg font-bold text-text">Catalogue Image Connection & AI Verification</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-extrabold border border-emerald-500/30">
              Active Protected
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Auto-verifies 99%–100% matches. Review ambiguous candidates, reject incorrect packaging, or trigger controlled re-downloads.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search Bar */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-muted" />
            <input
              type="text"
              placeholder="Search product, company, salt..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary w-52 md:w-64"
            />
          </div>

          {/* Sync Existing Scraped Button */}
          <button
            onClick={handleSyncState}
            disabled={syncing}
            className="px-3 py-1.5 bg-bg3 hover:bg-bg2 border border-glass-border rounded-xl text-xs font-semibold text-text flex items-center gap-1.5 transition-all cursor-pointer"
            title="Import and score all images currently on disk and state file"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin text-primary' : 'text-muted'} />
            <span>{syncing ? 'Syncing...' : 'Sync Image State'}</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs Pills */}
      <div className="px-4 py-2.5 border-b border-glass-border flex items-center gap-2 overflow-x-auto scrollbar-none bg-bg">
        {[
          { id: 'review', label: 'Needs Review', count: counts.pending_review, color: 'text-amber-400', badgeBg: 'bg-amber-500/20' },
          { id: 'high_confidence', label: 'High Confidence (≥99%)', count: counts.high_confidence, color: 'text-emerald-400', badgeBg: 'bg-emerald-500/20' },
          { id: 'approved', label: 'User Approved', count: counts.approved, color: 'text-sky-400', badgeBg: 'bg-sky-500/20' },
          { id: 'rejected', label: 'Rejected', count: counts.rejected, color: 'text-rose-400', badgeBg: 'bg-rose-500/20' },
          { id: 'all', label: 'All Images', count: counts.total, color: 'text-text', badgeBg: 'bg-bg3' },
        ].map(t => {
          const isActive = filter === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setFilter(t.id); setPage(1); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap border ${
                isActive
                  ? 'bg-primary/15 border-primary/40 text-text shadow-sm'
                  : 'bg-bg2 border-border text-muted hover:text-text hover:bg-bg3'
              }`}
            >
              <span>{t.label}</span>
              <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-black ${t.badgeBg} ${t.color}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Image Cards Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 flex-col gap-2">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <span className="text-xs text-muted font-medium">Scanning catalog image candidates...</span>
          </div>
        ) : images.length === 0 ? (
          <div className="flex items-center justify-center h-64 flex-col gap-3 text-center">
            <div className="p-3 rounded-2xl bg-bg3 border border-border text-muted">
              <Database size={28} />
            </div>
            <div>
              <p className="text-sm font-bold text-text">No Images Found in this Filter</p>
              <p className="text-xs text-muted mt-1 max-w-sm">
                Click &quot;Sync Image State&quot; above to connect existing downloaded product images, or adjust your search filter.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
            {images.map(img => {
              const isHigh = img.confidence_score >= 99;
              const isApproved = img.verification_status === 'APPROVED';
              const isRejected = img.verification_status === 'REJECTED';

              return (
                <div
                  key={img.id}
                  className="glass-panel border border-border rounded-2xl flex flex-col overflow-hidden hover:border-primary/40 transition-all shadow-sm group bg-bg2"
                >
                  {/* Image Container with Zoom Button */}
                  <div className="relative aspect-square bg-bg3/40 flex items-center justify-center p-2 overflow-hidden">
                    <img
                      src={img.image_path}
                      alt={img.product_name}
                      className="max-h-full max-w-full object-contain transition-transform group-hover:scale-105"
                      onError={(e: any) => {
                        e.currentTarget.style.display = 'none';
                        const p = e.currentTarget.parentElement;
                        if (p && !p.querySelector('.img-fallback')) {
                          const f = document.createElement('div');
                          f.className = 'img-fallback text-center p-3 text-xs text-muted font-mono';
                          f.innerText = 'Image not found: ' + img.image_path;
                          p.appendChild(f);
                        }
                      }}
                    />

                    {/* Zoom Icon */}
                    <button
                      onClick={() => setInspectedImage(img)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-bg/80 border border-border text-text hover:bg-bg2 transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                      title="Inspect full image"
                    >
                      <ZoomIn size={14} />
                    </button>

                    {/* Confidence / Status Chip */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1">
                      {isApproved ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-sky-600 text-white flex items-center gap-1 shadow">
                          <Check size={10} /> APPROVED
                        </span>
                      ) : isRejected ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-600 text-white flex items-center gap-1 shadow">
                          <XCircle size={10} /> REJECTED
                        </span>
                      ) : isHigh ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-600 text-white flex items-center gap-1 shadow">
                          <ShieldCheck size={10} /> {img.confidence_score}% VERIFIED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-600 text-white flex items-center gap-1 shadow">
                          <AlertTriangle size={10} /> {img.confidence_score}% REVIEW
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Product Details */}
                  <div className="p-3 flex-1 flex flex-col justify-between gap-2 border-t border-glass-border">
                    <div>
                      <h4 className="text-xs font-bold text-text line-clamp-1" title={img.product_name}>
                        {img.product_name}
                      </h4>
                      <p className="text-[11px] text-muted line-clamp-1 font-medium mt-0.5">
                        {img.company_name || img.manufacturer || 'General'}
                      </p>

                      {/* Generic & Strength */}
                      {(img.generic_name || img.strength) && (
                        <p className="text-[10px] text-muted/80 line-clamp-1 mt-0.5">
                          {img.generic_name} {img.strength ? `• ${img.strength}` : ''}
                        </p>
                      )}

                      {/* Matching Reason / Breakdown */}
                      {img.verification_reason && (
                        <p className="text-[10px] text-muted/70 bg-bg3/60 p-1.5 rounded-lg mt-1.5 line-clamp-2 leading-snug border border-border">
                          {img.verification_reason}
                        </p>
                      )}
                    </div>

                    {/* Action Controls */}
                    <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-glass-border">
                      {/* Approve Button */}
                      <button
                        onClick={() => handleApprove(img)}
                        disabled={isApproved}
                        className={`col-span-2 py-1.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                          isApproved
                            ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                        }`}
                        title="Approve this image as the active catalogue image"
                      >
                        <CheckCircle2 size={13} />
                        <span>{isApproved ? 'Approved' : 'Approve'}</span>
                      </button>

                      {/* Reject Button */}
                      <button
                        onClick={() => setRejectingImage(img)}
                        disabled={isRejected}
                        className={`py-1.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                          isRejected
                            ? 'bg-rose-600/20 text-rose-400 border border-rose-500/30'
                            : 'bg-red-600 hover:bg-red-500 text-white shadow'
                        }`}
                        title="Reject image and trigger auto-redownload (excludes this image)"
                      >
                        <XCircle size={13} />
                      </button>

                      {/* Replace Button */}
                      <button
                        onClick={() => setReplacingImage(img)}
                        className="py-1.5 px-2 bg-bg3 hover:bg-bg border border-border rounded-xl text-xs text-text font-bold flex items-center justify-center transition-all cursor-pointer"
                        title="Replace with another image file or link"
                      >
                        <Upload size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination & Keyboard Hint Footer */}
      <div className="p-3 border-t border-glass-border flex items-center justify-between bg-bg2/50 backdrop-blur-sm text-xs text-muted">
        <div className="flex items-center gap-3">
          <span>Page {page} of {totalPages} ({totalCount} items)</span>
          <span className="hidden sm:inline text-muted/60">• Use Arrow Keys [← / →] to navigate pages</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1 bg-bg3 border border-border rounded-lg text-xs font-semibold text-text disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 bg-bg3 border border-border rounded-lg text-xs font-semibold text-text disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {/* Inspection Modal */}
      {inspectedImage && (
        <div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-glass-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text">{inspectedImage.product_name}</h3>
                <p className="text-xs text-muted">{inspectedImage.company_name || 'Manufacturer Unspecified'}</p>
              </div>
              <button
                onClick={() => setInspectedImage(null)}
                className="p-1.5 rounded-lg bg-bg3 text-muted hover:text-text cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-4">
              <div className="bg-bg3/50 rounded-xl p-4 flex items-center justify-center max-w-md w-full aspect-square border border-border">
                <img
                  src={inspectedImage.image_path}
                  alt={inspectedImage.product_name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              <div className="w-full bg-bg3/60 p-3 rounded-xl border border-border space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Confidence Score:</span>
                  <span className="font-bold text-text">{inspectedImage.confidence_score}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Verification Status:</span>
                  <span className="font-bold text-primary">{inspectedImage.verification_status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">File Path:</span>
                  <span className="font-mono text-muted text-[11px] truncate max-w-xs">{inspectedImage.image_path}</span>
                </div>
                {inspectedImage.source_url && (
                  <div className="flex justify-between">
                    <span className="text-muted">Source URL:</span>
                    <a
                      href={inspectedImage.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      <span>Open Source CDN</span>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                )}
                {inspectedImage.verification_reason && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-muted block mb-1">Matching Rationale:</span>
                    <p className="text-text/90 leading-relaxed">{inspectedImage.verification_reason}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-glass-border flex justify-end gap-2 bg-bg">
              <button
                onClick={() => { handleApprove(inspectedImage); setInspectedImage(null); }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 size={14} />
                <span>Approve Image</span>
              </button>
              <button
                onClick={() => { setRejectingImage(inspectedImage); setInspectedImage(null); }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <XCircle size={14} />
                <span>Reject Image</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Confirmation Modal */}
      {rejectingImage && (
        <div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-4 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <XCircle size={20} />
              <h3 className="text-sm font-bold text-text">Reject Product Image</h3>
            </div>
            <p className="text-xs text-muted">
              Rejecting will deactivate this image and log it into the candidate exclusion database so it is <strong>never selected again</strong> for {rejectingImage.product_name}. A fresh candidate search will be initiated in the background.
            </p>

            <div>
              <label className="text-xs font-semibold text-text block mb-1">Reason for Rejection:</label>
              <input
                type="text"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                placeholder="e.g. Wrong dosage strength on packaging"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectingImage(null)}
                className="px-3 py-1.5 rounded-xl bg-bg3 text-xs font-semibold text-text hover:bg-bg border border-border cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <XCircle size={13} />
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Confirmation Modal */}
      {removingImage && (
        <div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-4 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-400">
              <Trash2 size={20} />
              <h3 className="text-sm font-bold text-text">Remove Image from Catalogue</h3>
            </div>
            <p className="text-xs text-muted">
              Remove active image for <strong>{removingImage.product_name}</strong>? The medicine record and stock valuation remain completely intact.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRemovingImage(null)}
                className="px-3 py-1.5 rounded-xl bg-bg3 text-xs font-semibold text-text hover:bg-bg border border-border cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemove}
                className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Confirm Removal</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Modal */}
      {replacingImage && (
        <div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl max-w-md w-full p-4 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-primary">
              <Upload size={20} />
              <h3 className="text-sm font-bold text-text">Replace Image</h3>
            </div>
            <p className="text-xs text-muted">
              Specify a local image path or URL for <strong>{replacingImage.product_name}</strong>. The medicine record and stock values remain strictly intact.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-text block mb-1">New Image Path or URL:</label>
                <input
                  type="text"
                  value={customImagePath}
                  onChange={e => setCustomImagePath(e.target.value)}
                  placeholder="/products/your-image.jpg"
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text block mb-1">Source Reference (optional):</label>
                <input
                  type="text"
                  value={customSourceUrl}
                  onChange={e => setCustomSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setReplacingImage(null)}
                className="px-3 py-1.5 rounded-xl bg-bg3 text-xs font-semibold text-text hover:bg-bg border border-border cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReplace}
                disabled={!customImagePath}
                className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <Check size={13} />
                <span>Save Replacement</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
