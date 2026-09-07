// AI Learning & Automation Command Center
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import {
  Brain,
  Database,
  Trash2,
  RefreshCw,
  CheckCircle2,
  X,
  Plus,
  Sparkles,
  Play,
  Stethoscope,
  Search,
  Check,
  Edit,
  GitMerge,
  Building2,
  AlertCircle,
  CheckSquare,
  ShieldCheck,
  Activity,
  ArrowRight,
  FileText,
  Bot
} from 'lucide-react';
import { api, apiClient, type PharmarackSentOrder } from '../../services/api';
import type { Doctor } from '../../types/api';
import { toastEvent } from '../../services/events';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDisplayDate } from '../../utils/date';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { isValid10DigitPhone } from '../../utils/phone';
import { broadcastContactDataChanged } from '../../utils/settingsSync';

interface LearningProfileSummary {
  distributor_id: number;
  distributor_name: string;
  distributor_email: string | null;
  distributor_phone: string | null;
  last_updated: string | null;
  files_count: number;
  last_file_name?: string | null;
  last_status: string | null;
  mapped_store_names?: string | null;
}

interface ProfileDetail {
  distributor: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    gstin?: string | null;
    address?: string | null;
    city?: string | null;
    dl_no?: string | null;
    state_code?: string | null;
  };
  profile: {
    distributor_id: number;
    file_mapping_rules: string | null;
    layout_type: string | null;
    success_count: number | null;
    last_success_at: string | null;
    last_updated: string | null;
  } | null;
  files: Array<{
    id: number;
    filename: string;
    file_path?: string | null;
    file_type: string | null;
    file_headers?: string | null;
    mapping_config?: string | null;
    status: string | null;
    created_at: string;
  }>;
}

interface OcrCorrection {
  id: number;
  ocr: string;
  correct: string;
  created_at: string;
}

type LocalDoctorRow = Doctor & {
  reg_number?: string | null;
  specialty?: string | null;
  speciality?: string | null;
  clinic?: string | null;
};

type LocalProfileDetailRow = ProfileDetail & { file_mapping_rules?: string | null };

interface LocalMappingTestResult {
  success?: boolean;
  mapped?: boolean;
  medicine?: { name?: string; mrp?: number | string | null; rate?: number | string | null; packaging?: string | null };
  error?: string;
}

interface LocalSentOrdersResponse {
  orders?: PharmarackSentOrder[];
}

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

let cachedDoctorsList: LocalDoctorRow[] = [];
let cachedProfiles: LearningProfileSummary[] = [];
let cachedOcrCorrections: OcrCorrection[] = [];
const cachedProfileDetailsMap: Record<number, LocalProfileDetailRow> = {};
const forgetCachedProfileDetails = (id: number) => { delete cachedProfileDetailsMap[id]; };

const VALID_LEARNING_TABS = ['clinical', 'doctors', 'distributors'];

const Learning: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isPageVisible = usePageActive();

  const normalizeTab = (t: string | null) => {
    if (!t) return 'clinical';
    const lower = t.toLowerCase();
    if (lower === 'distributor_layouts' || lower === 'distributors') return 'distributors';
    if (VALID_LEARNING_TABS.includes(lower)) return lower;
    return 'clinical';
  };

  const [activeTab, setActiveTab] = useState<string>(normalizeTab(searchParams.get('tab')));
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [globalSearch] = useState('');

  // Sandbox state
  const [testBrandInput, setTestBrandInput] = useState('');
  const [testResult, setTestResult] = useState<LocalMappingTestResult | null>(null);
  const [testingBrand, setTestingBrand] = useState(false);

  // Custom OCR Correction state
  const [newOcrRaw, setNewOcrRaw] = useState('');
  const [newOcrCorrected, setNewOcrCorrected] = useState('');
  const [ocrSearch, setOcrSearch] = useState('');

  // Doctor Form state
  const [docName, setDocName] = useState('');
  const [docReg, setDocReg] = useState('');
  const [docPhone, setDocPhone] = useState('');
  const [docSpecialty, setDocSpecialty] = useState('');
  const [docClinic, setDocClinic] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');

  // Retrain state
  const [retraining, setRetraining] = useState(false);

  // Merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [primaryMergeId, setPrimaryMergeId] = useState<number | null>(null);
  const [secondaryMergeId, setSecondaryMergeId] = useState<number | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Add Distributor modal state
  const [showAddDistributorModal, setShowAddDistributorModal] = useState(false);
  const [newDistName, setNewDistName] = useState('');
  const [newDistPhone, setNewDistPhone] = useState('');
  const [newDistEmail, setNewDistEmail] = useState('');
  const [newDistGstin, setNewDistGstin] = useState('');
  const [newDistAddress, setNewDistAddress] = useState('');
  const [isCreatingDistributor, setIsCreatingDistributor] = useState(false);
  const [shakeNewDistributorPhone, setShakeNewDistributorPhone] = useState(false);

  // Edit Distributor modal state
  const [editingDistributor, setEditingDistributor] = useState<{
    id: number;
    name: string;
    phone: string;
    email: string;
    mappingRulesStr: string;
  } | null>(null);
  const [isSavingDistributor, setIsSavingDistributor] = useState(false);
  const [shakeDistributorPhone, setShakeDistributorPhone] = useState(false);
  const [shakeDoctorPhone, setShakeDoctorPhone] = useState(false);

  // Edit Doctor modal state
  const [editingDoctor, setEditingDoctor] = useState<{
    id: number;
    name: string;
    reg_number: string;
    phone: string;
    specialty: string;
    clinic: string;
  } | null>(null);
  const [isSavingDoctor, setIsSavingDoctor] = useState(false);
  const [shakeEditDoctorPhone, setShakeEditDoctorPhone] = useState(false);

  // Universal Escape key dismissal for Learning modals
  useModalEscape(showAddDistributorModal, () => setShowAddDistributorModal(false));
  useModalEscape(showMergeModal, () => setShowMergeModal(false));
  useModalEscape(!!editingDistributor, () => setEditingDistributor(null));
  useModalEscape(!!editingDoctor, () => setEditingDoctor(null));

  const handleOpenEditDistributor = async (p: LearningProfileSummary) => {
    let mappingStr = '{}';
    try {
      if (cachedProfileDetailsMap[p.distributor_id]) {
        mappingStr = JSON.stringify(JSON.parse(cachedProfileDetailsMap[p.distributor_id].file_mapping_rules || '{}'), null, 2);
      } else {
        const res = await apiClient.get(`/learning/profiles/${p.distributor_id}`);
        if (res.data?.file_mapping_rules) {
          mappingStr = JSON.stringify(JSON.parse(res.data.file_mapping_rules), null, 2);
        }
      }
    } catch {
      mappingStr = '{}';
    }

    setEditingDistributor({
      id: p.distributor_id,
      name: p.distributor_name || '',
      phone: p.distributor_phone || '',
      email: p.distributor_email || '',
      mappingRulesStr: mappingStr
    });
  };

  const handleSaveDistributorDetails = async () => {
    if (!editingDistributor) return;
    if (editingDistributor.phone.trim() && !isValid10DigitPhone(editingDistributor.phone)) {
      setShakeDistributorPhone(true);
      setTimeout(() => setShakeDistributorPhone(false), 400);
      toastEvent.trigger('Distributor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }
    setIsSavingDistributor(true);
    try {
      await apiClient.put(`/distributors/${editingDistributor.id}`, {
        name: editingDistributor.name.trim(),
        phone: editingDistributor.phone.trim(),
        email: editingDistributor.email.trim()
      });

      if (editingDistributor.mappingRulesStr.trim()) {
        try {
          const parsedRules = JSON.parse(editingDistributor.mappingRulesStr);
          await apiClient.post(`/learning/profiles/${editingDistributor.id}/mapping`, {
            mappingRules: parsedRules
          });
        } catch {
          toastEvent.trigger('Invalid JSON format in OCR rules — contact details saved', 'info');
        }
      }

      toastEvent.trigger('Distributor details & OCR rules updated successfully!', 'success');
      setEditingDistributor(null);
      forgetCachedProfileDetails(editingDistributor.id);
      await broadcastContactDataChanged();
      refetchProfiles();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to update distributor: ' + (e.message || 'Server error'), 'error');
    } finally {
      setIsSavingDistributor(false);
    }
  };

  const handleDeleteDistributorProfile = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the distributor layout profile for "${name}"?\n\nThis will permanently remove the learned OCR mapping rules and distributor record.`)) {
      return;
    }
    try {
      await apiClient.delete(`/distributors/${id}`);
      forgetCachedProfileDetails(id);
      if (selectedProfileId === id) setSelectedProfileId(null);
      if (editingDistributor?.id === id) setEditingDistributor(null);
      toastEvent.trigger(`Distributor layout profile "${name}" deleted successfully!`, 'success');
      await broadcastContactDataChanged();
      refetchProfiles();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to delete distributor layout: ' + (e.message || 'Server error'), 'error');
    }
  };

  const handleCreateDistributor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDistName.trim()) {
      toastEvent.trigger('Distributor name is required', 'error');
      return;
    }
    if (newDistPhone.trim() && !isValid10DigitPhone(newDistPhone)) {
      setShakeNewDistributorPhone(true);
      setTimeout(() => setShakeNewDistributorPhone(false), 400);
      toastEvent.trigger('Distributor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }

    setIsCreatingDistributor(true);
    try {
      await apiClient.post('/distributors', {
        name: newDistName.trim(),
        phone: newDistPhone.trim(),
        email: newDistEmail.trim(),
        gstin: newDistGstin.trim(),
        address: newDistAddress.trim()
      });

      toastEvent.trigger(`Distributor "${newDistName.trim()}" registered successfully!`, 'success');
      setShowAddDistributorModal(false);
      setNewDistName('');
      setNewDistPhone('');
      setNewDistEmail('');
      setNewDistGstin('');
      setNewDistAddress('');
      await broadcastContactDataChanged();
      refetchProfiles();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to register distributor: ' + (e.message || 'Server error'), 'error');
    } finally {
      setIsCreatingDistributor(false);
    }
  };



  // Sync tab/profile selection from URL params (render-time adjustment)
  const [prevParams, setPrevParams] = useState(searchParams);
  if (prevParams !== searchParams) {
    setPrevParams(searchParams);
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setActiveTab(normalizeTab(tabParam));
    }
    const idParam = searchParams.get('id') || searchParams.get('distributor_id');
    if (idParam && !isNaN(Number(idParam))) {
      setSelectedProfileId(Number(idParam));
    }
  }

  const handleTabChange = (tabId: string) => {
    const paramValue = tabId === 'distributors' ? 'distributor_layouts' : tabId;
    setActiveTab(tabId);
    setSearchParams({ tab: paramValue });
  };

  const queryClient = useQueryClient();

  // Doctors Query with module caching — visibility-gated so a hidden kept-alive
  // Learning page never refetches the doctor directory on background stock writes.
  const { data: doctorsList = cachedDoctorsList, isLoading: loadingDoctors, refetch: refetchDoctors } = useApiQuery<LocalDoctorRow[]>(
    'crm-doctors',
    async () => {
      const res = await apiClient.get('/crm/doctors');
      const data = res.data || [];
      cachedDoctorsList = data;
      return data;
    },
    {
      enabled: isPageVisible,
      staleTime: 300000,
      refetchOnWindowFocus: false
    }
  );

  // Learning Stats
  const { data: stats, refetch: refetchStats } = useApiQuery<{ activeOcrCorrections: number; learnedRxCombos: number; lastRetrainedAt: string | null }>(
    'learning-stats',
    () => apiClient.get('/learning/stats').then(res => res.data),
    { enabled: isPageVisible, staleTime: 60000 }
  );

  // Custom OCR Corrections list with module caching
  const { data: corrections = cachedOcrCorrections, refetch: refetchCorrections } = useApiQuery<OcrCorrection[]>(
    'ocr-corrections',
    async () => {
      const res = await apiClient.get('/learning/corrections');
      const data = res.data || [];
      cachedOcrCorrections = data;
      return data;
    },
    { enabled: isPageVisible, staleTime: 60000 }
  );

  // Today's Pharmarack Sent Orders Query
  const { data: todaySentOrdersData } = useApiQuery<LocalSentOrdersResponse>(
    'learning-today-pharmarack-sent-orders',
    async () => {
      const res = await apiClient.get('/pharmarack/sent-orders');
      return res.data;
    },
    { enabled: isPageVisible && activeTab === 'distributors' }
  );
  const todaySentOrdersList: PharmarackSentOrder[] = todaySentOrdersData?.orders || [];

  // Profiles Query with module caching
  const { data: rawProfiles = cachedProfiles, isLoading: loadingProfiles, refetch: refetchProfiles } = useApiQuery<LearningProfileSummary[]>(
    'learning-profiles',
    async () => {
      const res = await apiClient.get('/learning/profiles');
      const data = Array.isArray(res.data)
        ? res.data
        : (Array.isArray(res.data?.profiles) ? res.data.profiles : []);
      cachedProfiles = data;
      return data;
    },
    {
      enabled: isPageVisible,
      staleTime: 120000,
      refetchOnWindowFocus: false
    }
  );

  useEffect(() => {
    // Gated by pageActive: hidden Learning never refetches on settings/
    // distributor events — the refresh runs when the page is next shown.
    if (!isPageVisible) return;
    const handleUpdate = () => {
      // Keep cachedProfiles intact during the refetch — wiping it first blanked
      // the hydrated list and defeated the cache-first fallback paint.
      Object.keys(cachedProfileDetailsMap).forEach((key) => delete cachedProfileDetailsMap[Number(key)]);
      refetchProfiles();
    };
    window.addEventListener('phone-numbers-updated', handleUpdate);
    window.addEventListener('distributors-updated', handleUpdate);
    window.addEventListener('settings-updated', handleUpdate);
    window.addEventListener('contacts-updated', handleUpdate);
    return () => {
      window.removeEventListener('phone-numbers-updated', handleUpdate);
      window.removeEventListener('distributors-updated', handleUpdate);
      window.removeEventListener('settings-updated', handleUpdate);
      window.removeEventListener('contacts-updated', handleUpdate);
    };
  }, [refetchProfiles, isPageVisible]);

  // Selected Profile detail query
  const { data: selectedProfileDetail } = useApiQuery<ProfileDetail | null>(
    ['learning-profile-detail', selectedProfileId],
    async () => {
      if (!selectedProfileId) return null;
      if (cachedProfileDetailsMap[selectedProfileId]) {
        return cachedProfileDetailsMap[selectedProfileId];
      }
      const res = await apiClient.get(`/learning/profiles/${selectedProfileId}`);
      const data = res.data || null;
      if (data) {
        cachedProfileDetailsMap[selectedProfileId] = data;
      }
      return data;
    },
    {
      enabled: !!selectedProfileId && isPageVisible
    }
  );

  // Retrain AI Model
  const handleRetrain = async () => {
    setRetraining(true);
    try {
      const res = await apiClient.post('/learning/retrain');
      toastEvent.trigger(res.data?.message || 'AI Clinical Model retrained successfully!', 'success');
      await queryClient.invalidateQueries({ queryKey: ['learning-stats'] });
      refetchStats();
    } catch (err) {
      const e = err as LocalApiError;
      try {
        const res2 = await apiClient.post('/learning/refresh-model');
        toastEvent.trigger(res2.data?.message || 'AI Clinical Model refreshed successfully!', 'success');
        await queryClient.invalidateQueries({ queryKey: ['learning-stats'] });
        refetchStats();
      } catch (err2) {
        const e2 = err2 as LocalApiError;
        toastEvent.trigger('Retraining failed: ' + (e2.response?.data?.error || e2.message || e.message || 'Server error'), 'error');
      }
    } finally {
      setRetraining(false);
    }
  };

  // Test Mapping Sandbox
  const handleTestMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testBrandInput.trim()) return;
    setTestingBrand(true);
    setTestResult(null);
    try {
      const data = await api.getLearnedMapping(testBrandInput.trim());
      setTestResult(data);
    } catch (err) {
      const e = err as LocalApiError;
      setTestResult({ success: false, error: e.message || 'No mapping found' });
    } finally {
      setTestingBrand(false);
    }
  };

  // Add OCR Correction Rule
  const handleAddCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOcrRaw.trim() || !newOcrCorrected.trim()) return;
    try {
      await apiClient.post('/learning/corrections', {
        raw_text: newOcrRaw.trim(),
        corrected_name: newOcrCorrected.trim()
      });
      toastEvent.trigger('OCR correction rule added', 'success');
      setNewOcrRaw('');
      setNewOcrCorrected('');
      refetchCorrections();
      refetchStats();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to add OCR rule: ' + e.message, 'error');
    }
  };

  // Delete OCR Correction Rule
  const handleDeleteCorrection = async (id: number) => {
    try {
      await apiClient.delete(`/learning/corrections/${id}`);
      toastEvent.trigger('OCR rule deleted', 'success');
      refetchCorrections();
      refetchStats();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to delete rule: ' + e.message, 'error');
    }
  };

  // Add Doctor
  const handleAddDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim()) return;
    if (docPhone.trim() && !isValid10DigitPhone(docPhone)) {
      setShakeDoctorPhone(true);
      setTimeout(() => setShakeDoctorPhone(false), 400);
      toastEvent.trigger('Doctor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }
    try {
      await apiClient.post('/crm/doctors', {
        name: docName.trim(),
        reg_number: docReg.trim(),
        phone: docPhone.trim(),
        specialty: docSpecialty.trim(),
        clinic: docClinic.trim()
      });
      toastEvent.trigger('Doctor registered successfully', 'success');
      setDocName('');
      setDocReg('');
      setDocPhone('');
      setDocSpecialty('');
      setDocClinic('');
      refetchDoctors();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to register doctor: ' + e.message, 'error');
    }
  };

  // Delete Doctor
  const handleDeleteDoctor = async (id: number) => {
    try {
      await apiClient.delete(`/crm/doctors/${id}`);
      toastEvent.trigger('Doctor removed from directory', 'success');
      refetchDoctors();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to remove doctor: ' + e.message, 'error');
    }
  };

  // Edit Doctor Handlers
  const handleOpenEditDoctor = (d: LocalDoctorRow) => {
    setEditingDoctor({
      id: d.id,
      name: d.name || '',
      reg_number: d.reg_number || d.reg_no || '',
      phone: d.phone || '',
      specialty: d.specialty || d.speciality || '',
      clinic: d.clinic || d.hospital || ''
    });
  };

  const handleSaveDoctorDetails = async () => {
    if (!editingDoctor) return;
    if (!editingDoctor.name.trim()) {
      toastEvent.trigger('Doctor name is required', 'error');
      return;
    }
    if (editingDoctor.phone.trim() && !isValid10DigitPhone(editingDoctor.phone)) {
      setShakeEditDoctorPhone(true);
      setTimeout(() => setShakeEditDoctorPhone(false), 400);
      toastEvent.trigger('Doctor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }

    setIsSavingDoctor(true);
    try {
      await apiClient.put(`/crm/doctors/${editingDoctor.id}`, {
        name: editingDoctor.name.trim(),
        reg_number: editingDoctor.reg_number.trim(),
        phone: editingDoctor.phone.trim(),
        specialty: editingDoctor.specialty.trim(),
        clinic: editingDoctor.clinic.trim()
      });
      toastEvent.trigger('Doctor details updated successfully', 'success');
      setEditingDoctor(null);
      refetchDoctors();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to update doctor: ' + (e.message || 'Server error'), 'error');
    } finally {
      setIsSavingDoctor(false);
    }
  };

  // Execute Profile Merge
  const handleMergeProfiles = async () => {
    if (!primaryMergeId || !secondaryMergeId || primaryMergeId === secondaryMergeId) {
      toastEvent.trigger('Select two distinct distributor profiles to merge', 'error');
      return;
    }
    setIsMerging(true);
    try {
      await apiClient.post('/learning/profiles/merge', {
        primaryId: primaryMergeId,
        secondaryIds: [secondaryMergeId]
      });
      toastEvent.trigger('Distributor profiles merged successfully!', 'success');
      setShowMergeModal(false);
      setPrimaryMergeId(null);
      setSecondaryMergeId(null);
      await broadcastContactDataChanged();
      refetchProfiles();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Merge failed: ' + (e.message || 'Server error'), 'error');
    } finally {
      setIsMerging(false);
    }
  };

  const correctionsArray = Array.isArray(corrections) ? corrections : [];
  const filteredCorrections = useMemo(() => {
    const q = ocrSearch.toLowerCase().trim();
    if (!q) return correctionsArray;
    return correctionsArray.filter(c =>
      (c.ocr && c.ocr.toLowerCase().includes(q)) ||
      (c.correct && c.correct.toLowerCase().includes(q))
    );
  }, [correctionsArray, ocrSearch]);

  const doctorsListArray = useMemo(() => (Array.isArray(doctorsList) ? doctorsList : []), [doctorsList]);
  const profilesList = useMemo(() => (Array.isArray(rawProfiles) ? rawProfiles : []), [rawProfiles]);

  // Filtered Doctors (memoized — re-runs only when the list or search term changes)
  const filteredDoctors = useMemo(() => doctorsListArray.filter((d) => {
    const q = (doctorSearch || globalSearch).toLowerCase().trim();
    if (!q) return true;
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.reg_number && d.reg_number.toLowerCase().includes(q)) ||
      (d.specialty && d.specialty.toLowerCase().includes(q)) ||
      (d.clinic && d.clinic.toLowerCase().includes(q))
    );
  }), [doctorsListArray, doctorSearch, globalSearch]);

  // Filtered Profiles (supports name, phone, email, mapped Pharmarack store names & normalized matching)
  const filteredProfiles = useMemo(() => profilesList.filter(p => {
    const q = (profileSearchQuery || globalSearch).toLowerCase().trim();
    if (!q) return true;
    const cleanQNorm = q.replace(/[^a-z0-9]/g, '');
    const cleanDistNorm = (p.distributor_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normQ = q.replace(/\(.*?\)/g, '').replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic|cosmetics|cosmatics/gi, '').replace(/[^a-z0-9]/g, '');
    const normDist = (p.distributor_name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic|cosmetics|cosmatics/gi, '').replace(/[^a-z0-9]/g, '');

    return (
      (p.distributor_name && p.distributor_name.toLowerCase().includes(q)) ||
      (p.distributor_email && p.distributor_email.toLowerCase().includes(q)) ||
      (p.distributor_phone && p.distributor_phone.toLowerCase().includes(q)) ||
      (p.mapped_store_names && p.mapped_store_names.toLowerCase().includes(q)) ||
      (cleanQNorm && cleanDistNorm && (cleanDistNorm.includes(cleanQNorm) || cleanQNorm.includes(cleanDistNorm))) ||
      (normQ && normDist && (normDist.includes(normQ) || normQ.includes(normDist)))
    );
  }), [profilesList, profileSearchQuery, globalSearch]);

  // Check if distributor has an active placed order today
  const hasOrderToday = (p: LearningProfileSummary) => {
    if (!todaySentOrdersList || todaySentOrdersList.length === 0) return false;
    const pName = (p.distributor_name || '').toLowerCase().trim();
    const pMapped = (p.mapped_store_names || '').toLowerCase();
    return todaySentOrdersList.some((o) => {
      if (o.store_id && o.store_id === p.distributor_id) return true;
      const sName = (o.store_name || '').toLowerCase().trim();
      if (!sName) return false;
      if (pName && (sName === pName || sName.includes(pName) || pName.includes(sName))) return true;
      if (pMapped && pMapped.includes(sName)) return true;
      return false;
    });
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-5 space-y-5 animate-fadeIn">
      {/* Navigation Bar Tabs & Retrain Control */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-glass-bg border border-glass-border p-2 rounded-2xl shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-1.5 p-1 bg-bg2 border border-border rounded-xl overflow-x-auto scrollbar-none">
          {[
            { id: 'clinical', label: 'Clinical AI & OCR Rules', icon: Brain, badge: correctionsArray.length },
            { id: 'doctors', label: 'Doctor Directory', icon: Stethoscope, badge: doctorsListArray.length },
            { id: 'distributors', label: 'Distributor OCR Layouts', icon: Database, badge: profilesList.length }
          ].map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleTabChange(t.id)}
                className={`flex items-center gap-2 px-3.5 py-2 font-bold text-xs sm:text-sm rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg text-text shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/60 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
                <span>{t.label}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-extrabold font-mono ${
                  isActive ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-bg3 text-muted border border-border/40'
                }`}>
                  {t.badge}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleRetrain}
          disabled={retraining}
          className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-sm hover:shadow active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={15} className={retraining ? 'animate-spin' : ''} />
          <span>{retraining ? 'Retraining Model...' : 'Retrain Model'}</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: Clinical AI & OCR Rules */}
      {/* ========================================================================= */}
      {activeTab === 'clinical' && (
        <div className="space-y-5">
          {/* Top 4 Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-sky/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Active OCR Rules</div>
                <div className="p-2.5 rounded-xl bg-sky/10 text-sky border border-sky/20">
                  <Brain size={20} />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-text font-mono tracking-tight">
                {stats?.activeOcrCorrections ?? correctionsArray.length}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky animate-pulse" />
                <span>Enforced in Camera & Bills</span>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-emerald-500/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Learned Rx Combos</div>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <Sparkles size={20} />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-text font-mono tracking-tight">
                {stats ? stats.learnedRxCombos : '—'}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Auto-suggested combos</span>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-primary/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Salt Mappings Baseline</div>
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <ShieldCheck size={20} />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-primary font-mono tracking-tight">
                Master Active
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Formulation cross-index</span>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-amber-500/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Last Clinical Retrain</div>
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <RefreshCw size={20} />
                </div>
              </div>
              <div className="text-sm sm:text-base font-black text-text truncate mt-1" title={stats?.lastRetrainedAt ? formatDisplayDate(stats.lastRetrainedAt) : 'Ready for training'}>
                {stats?.lastRetrainedAt ? formatDisplayDate(stats.lastRetrainedAt) : 'Ready for training'}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Continuous AI sync</span>
              </div>
            </div>
          </div>

          {/* 3-Column Dashboard Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left Column (1/3 Width): Add Rule & Brand Resolution Sandbox */}
            <div className="space-y-5">
              {/* Add Rule Form */}
              <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2 text-text font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <Plus size={15} />
                    </div>
                    <span>Define OCR Correction Rule</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-muted bg-bg2 px-2 py-0.5 rounded border border-border">Rule Builder</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Map distorted raw text scanned from camera/invoices to exact master medicine names.
                </p>

                <form onSubmit={handleAddCorrection} className="space-y-3 pt-1">
                  <div>
                    <label className="text-[11px] font-bold text-text block mb-1">Scanned Raw OCR Text *</label>
                    <input
                      type="text"
                      placeholder="e.g. D0L0 650, CROC1N, AZ1THR0"
                      value={newOcrRaw}
                      onChange={e => setNewOcrRaw(e.target.value)}
                      className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-text block mb-1">Corrected Master Medicine Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Dolo 650mg Tablet"
                      value={newOcrCorrected}
                      onChange={e => setNewOcrCorrected(e.target.value)}
                      className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-bold transition-all"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-primary text-white font-bold text-xs rounded-xl py-2.5 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-[0.98]"
                  >
                    <Plus size={14} /> Add Mapping Rule
                  </button>
                </form>
              </div>

              {/* Resolution Sandbox */}
              <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2 text-text font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                      <Sparkles size={15} />
                    </div>
                    <span>OCR Database Resolution Sandbox</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-muted bg-bg2 px-2 py-0.5 rounded border border-border">Testing Lab</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Test instant OCR fuzzy matching against database master catalog.
                </p>

                <form onSubmit={handleTestMapping} className="space-y-2.5">
                  <input
                    type="text"
                    placeholder="Enter raw text to test..."
                    value={testBrandInput}
                    onChange={e => setTestBrandInput(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono transition-all"
                  />
                  <button
                    type="submit"
                    disabled={testingBrand}
                    className="w-full py-2.5 bg-bg2 hover:bg-bg3 text-text border border-border font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98]"
                  >
                    {testingBrand ? <RefreshCw size={13} className="animate-spin text-primary" /> : <Play size={13} className="text-primary" />}
                    <span>Test Brand Resolution</span>
                  </button>
                </form>

                {testResult && (
                  <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 transition-all ${testResult.mapped ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                    {testResult.mapped ? (
                      <div>
                        <div className="font-bold flex items-center gap-1.5 text-emerald-500">
                          <CheckCircle2 size={14} /> Match Found:
                        </div>
                        <div className="text-xs font-black text-text mt-1">{testResult.medicine?.name}</div>
                        <div className="text-[10px] text-muted font-mono mt-1 flex flex-wrap gap-2">
                          <span className="bg-bg px-2 py-0.5 rounded border border-border">MRP: ₹{testResult.medicine?.mrp}</span>
                          <span className="bg-bg px-2 py-0.5 rounded border border-border">Rate: ₹{testResult.medicine?.rate}</span>
                          <span className="bg-bg px-2 py-0.5 rounded border border-border">Pack: {testResult.medicine?.packaging || 'Strip'}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-amber-500 font-medium">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{testResult.error || 'No automatic match found.'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel (2/3 Width): Active OCR Correction Rules Registry Table */}
            <div className="lg:col-span-2 bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <Database size={18} className="text-sky" />
                    <span>OCR Correction Registry Matrix</span>
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Active dictionary of raw OCR text mappings enforced across camera & OCR scans.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-2.5 text-muted" />
                    <input
                      type="text"
                      placeholder="Filter rules..."
                      value={ocrSearch}
                      onChange={e => setOcrSearch(e.target.value)}
                      className="bg-bg border border-border rounded-xl pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary w-40 sm:w-48"
                    />
                  </div>
                  <div className="text-xs font-mono font-bold bg-bg2 px-2.5 py-1.5 rounded-xl border border-border text-muted shrink-0">
                    {filteredCorrections.length} / {correctionsArray.length}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border flex-1 max-h-[560px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg2/90 backdrop-blur-sm text-muted font-bold uppercase text-[10px] tracking-wider border-b border-border sticky top-0 z-10">
                    <tr>
                      <th className="py-3 px-4">Raw Scanned OCR String</th>
                      <th className="py-3 px-4">Mapped Master Brand</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredCorrections.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-muted italic bg-bg2/20">
                          {ocrSearch ? 'No correction rules match your filter.' : 'No custom OCR correction rules configured. Add rules on the left panel.'}
                        </td>
                      </tr>
                    ) : (
                      filteredCorrections.map(c => (
                        <tr key={c.id} className="hover:bg-bg2/40 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-md text-xs inline-block">
                              {c.ocr}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold text-text">
                            <div className="flex items-center gap-2">
                              <ArrowRight size={13} className="text-muted/40 shrink-0" />
                              <span>{c.correct}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleDeleteCorrection(c.id)}
                              className="p-1.5 rounded-lg text-red hover:bg-red/10 transition-colors cursor-pointer border border-red/20"
                              title="Delete Rule"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: Doctor Directory */}
      {/* ========================================================================= */}
      {activeTab === 'doctors' && (
        <div className="space-y-5">
          {/* Top 4 Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-sky/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Registered Doctors</div>
                <div className="p-2.5 rounded-xl bg-sky/10 text-sky border border-sky/20">
                  <Stethoscope size={20} />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-text font-mono tracking-tight">
                {doctorsListArray.length}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky" />
                <span>Active practitioners</span>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-emerald-500/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Linked Hospitals / Clinics</div>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <Building2 size={20} />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-text font-mono tracking-tight">
                {new Set(doctorsListArray.map(d => d.clinic).filter(Boolean)).size || 1}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Affiliated centers</span>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-primary/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Valid Reg Numbers</div>
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <CheckSquare size={20} />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-primary font-mono tracking-tight">
                {doctorsListArray.filter(d => d.reg_number).length}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>MCI verified profiles</span>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-sm hover:border-amber-500/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted font-bold uppercase tracking-wider">Directory Status</div>
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <Activity size={20} />
                </div>
              </div>
              <div className="text-sm sm:text-base font-black text-emerald-500 mt-1 uppercase tracking-wider">
                {loadingDoctors ? 'Syncing…' : doctorsListArray.length > 0 ? 'Active & Synced' : 'Empty'}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Real-time prescription resolver</span>
              </div>
            </div>
          </div>

          {/* 3-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left Panel (1/3 Width): Register Doctor Form */}
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2 text-text font-bold text-sm">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                    <Stethoscope size={15} />
                  </div>
                  <span>Register Medical Practitioner</span>
                </div>
                <span className="text-[10px] uppercase font-bold text-muted bg-bg2 px-2 py-0.5 rounded border border-border">Profile</span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Add doctor credentials for prescription tracking and automatic doctor resolution.
              </p>

              <form onSubmit={handleAddDoctor} className="space-y-3 pt-1">
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Doctor Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Dr. A. K. Sharma"
                    value={docName}
                    onChange={e => setDocName(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-bold transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Reg / License No.</label>
                  <input
                    type="text"
                    placeholder="e.g. MCI-98765"
                    value={docReg}
                    onChange={e => setDocReg(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono transition-all"
                  />
                </div>
                <div>
                  <PhoneInputWithBadge
                    label="Phone Number"
                    value={docPhone}
                    onChange={val => setDocPhone(val)}
                    placeholder="10 digits"
                    shakeOnError={shakeDoctorPhone}
                    allowEmpty={true}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Specialty</label>
                  <input
                    type="text"
                    placeholder="e.g. Cardiologist, Physician"
                    value={docSpecialty}
                    onChange={e => setDocSpecialty(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Clinic / Hospital</label>
                  <input
                    type="text"
                    placeholder="e.g. City Care Hospital"
                    value={docClinic}
                    onChange={e => setDocClinic(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-white font-bold text-xs rounded-xl py-2.5 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-[0.98]"
                >
                  <Plus size={14} /> Register Doctor
                </button>
              </form>
            </div>

            {/* Right Panel (2/3 Width): Doctor Registry Grid */}
            <div className="lg:col-span-2 bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-sm space-y-4 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <Stethoscope size={18} className="text-sky" />
                    <span>Doctor Directory Registry</span>
                  </h3>
                  <p className="text-xs text-muted mt-0.5">Filter and manage registered doctors.</p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-64">
                    <Search size={14} className="absolute left-3 top-2.5 text-muted" />
                    <input
                      type="text"
                      placeholder="Search name, reg, specialty..."
                      value={doctorSearch}
                      onChange={e => setDoctorSearch(e.target.value)}
                      className="w-full bg-bg border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                  <div className="text-xs font-mono font-bold bg-bg2 px-2.5 py-2 rounded-xl border border-border text-muted shrink-0">
                    {filteredDoctors.length}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border flex-1 max-h-[560px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg2/90 backdrop-blur-sm text-muted font-bold uppercase text-[10px] tracking-wider border-b border-border sticky top-0 z-10">
                    <tr>
                      <th className="py-3 px-4">Doctor Name & Hospital</th>
                      <th className="py-3 px-4">Reg License #</th>
                      <th className="py-3 px-4">Specialty</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredDoctors.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-muted italic bg-bg2/20">
                          {loadingDoctors ? 'Loading doctor directory...' : 'No doctors found matching search query.'}
                        </td>
                      </tr>
                    ) : (
                      filteredDoctors.map((d) => (
                        <tr key={d.id} className="hover:bg-bg2/40 transition-colors">
                          <td className="py-3 px-4 font-bold text-text">
                            <div className="flex items-center gap-2">
                              <div className="p-1 rounded bg-sky/10 text-sky">
                                <Stethoscope size={13} />
                              </div>
                              <span>{d.name}</span>
                            </div>
                            {d.clinic && <div className="text-[10px] text-muted pl-6 font-normal mt-0.5">{d.clinic}</div>}
                          </td>
                          <td className="py-3 px-4 text-muted font-mono font-bold">{d.reg_number || '—'}</td>
                          <td className="py-3 px-4">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky/10 text-sky border border-sky/20 inline-block">
                              {d.specialty || 'General Physician'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-muted font-mono">{d.phone || '—'}</td>
                          <td className="py-3 px-4 text-right space-x-1.5">
                            <button
                              onClick={() => handleOpenEditDoctor(d)}
                              className="p-1.5 rounded-lg bg-bg2 text-muted hover:text-text border border-border cursor-pointer transition-colors"
                              title="Edit Credentials"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteDoctor(d.id)}
                              className="p-1.5 rounded-lg text-red hover:bg-red/10 border border-red/20 cursor-pointer transition-colors"
                              title="Remove Doctor"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: Distributor OCR Layout Profiles */}
      {/* ========================================================================= */}
      {activeTab === 'distributors' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-auto lg:h-[calc(100vh-165px)] lg:min-h-[600px]">
          {/* Left Panel: Search & Profiles List */}
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col h-full bg-glass-bg border border-glass-border rounded-2xl p-4 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-3.5 top-3 text-muted" />
                <input
                  type="text"
                  placeholder="Search distributor profiles..."
                  value={profileSearchQuery}
                  onChange={e => setProfileSearchQuery(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl pl-9 pr-3 py-2 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <button
                onClick={() => setShowAddDistributorModal(true)}
                className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm hover:bg-primary/90 active:scale-95"
                title="Add new distributor to database"
              >
                <Plus size={14} />
                <span className="hidden sm:inline">Add</span>
              </button>
              <button
                onClick={() => setShowMergeModal(true)}
                className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/20 text-amber-500 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95"
                title="Merge redundant distributor profiles"
              >
                <GitMerge size={14} />
                <span>Merge</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-2 scrollbar-thin mt-3">
              {filteredProfiles.length === 0 ? (
                <div className="bg-bg border border-border rounded-xl p-6 text-center text-muted text-xs">
                  {loadingProfiles ? 'Loading distributor profiles...' : 'No distributor profiles found.'}
                </div>
              ) : (
                filteredProfiles.map(p => {
                  const isSelected = selectedProfileId === p.distributor_id;
                  const isOrderedToday = hasOrderToday(p);
                  return (
                    <div
                      key={p.distributor_id}
                      onClick={() => setSelectedProfileId(p.distributor_id)}
                      className={`p-3 rounded-xl border transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? 'bg-primary/5 border-primary ring-1 ring-primary/25 shadow-sm'
                          : 'bg-bg border-border hover:border-primary/40 hover:bg-bg2/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary/20 text-primary' : 'bg-bg2 text-muted'}`}>
                            <Building2 size={14} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-xs text-text truncate">
                              {p.distributor_name}
                            </div>
                            <div className="text-[10px] text-muted flex items-center gap-1.5 flex-wrap">
                              <span>ID #{p.distributor_id}</span>
                              {p.mapped_store_names && (
                                <span className="text-[9px] font-semibold text-sky bg-sky/10 border border-sky/20 px-1.5 rounded truncate max-w-[130px]" title={`Mapped stores: ${p.mapped_store_names}`}>
                                  🔗 {p.mapped_store_names}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditDistributor(p);
                            }}
                            className="p-1 rounded-md text-muted hover:text-text hover:bg-bg2 transition-colors cursor-pointer"
                            title="Edit Layout & Rules"
                          >
                            <Edit size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDistributorProfile(p.distributor_id, p.distributor_name);
                            }}
                            className="p-1 rounded-md text-red hover:bg-red/10 border border-red/20 cursor-pointer transition-colors"
                            title="Delete Layout & Distributor"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted flex items-center justify-between border-t border-border/40 pt-2 mt-2">
                        <span className="truncate max-w-[120px]">{p.distributor_phone || 'No phone'}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isOrderedToday && (
                            <span className="px-2 py-0.5 rounded-full bg-sky/15 text-sky border border-sky/25 text-[10px] font-bold">
                              🛒 Active Today
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.files_count > 0
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                              : 'bg-bg3 text-muted border border-border'
                          }`}>
                            {p.files_count} {p.files_count === 1 ? 'file' : 'files'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Selected Profile Inspector or AI Layout Engine Overview */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col h-full bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-sm overflow-y-auto scrollbar-thin">
            {selectedProfileId && selectedProfileDetail ? (
              <div className="space-y-4 flex flex-col h-full">
                <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
                  <div className="font-bold text-text text-base flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                      <Building2 size={18} />
                    </div>
                    <div>
                      <div className="text-base font-bold text-text">
                        {selectedProfileDetail.distributor?.name || `Distributor #${selectedProfileId}`}
                      </div>
                      <div className="text-xs text-muted font-mono">
                        Distributor ID: #{selectedProfileId}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const p = profilesList.find(x => x.distributor_id === selectedProfileId);
                        if (p) handleOpenEditDistributor(p);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-bg2 hover:bg-bg3 text-text border border-border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                      title="Edit Distributor"
                    >
                      <Edit size={13} />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleDeleteDistributorProfile(selectedProfileId, selectedProfileDetail.distributor?.name || `Distributor #${selectedProfileId}`)}
                      className="px-3 py-1.5 rounded-xl bg-red/10 text-red hover:bg-red/20 border border-red/20 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                      title="Delete Distributor Layout Profile"
                    >
                      <Trash2 size={13} />
                      <span>Delete Layout</span>
                    </button>
                    <button
                      onClick={() => setSelectedProfileId(null)}
                      className="text-muted hover:text-text cursor-pointer p-1.5 rounded-lg hover:bg-bg2"
                      title="Close Inspector"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted shrink-0 bg-bg2 p-3 rounded-xl border border-border">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-text">Phone:</span>
                    <span>{selectedProfileDetail.distributor?.phone || 'Not set'}</span>
                  </div>
                  {selectedProfileDetail.distributor?.email && (
                    <div className="flex items-center gap-1.5 border-l border-border pl-3">
                      <span className="font-semibold text-text">Email:</span>
                      <span>{selectedProfileDetail.distributor.email}</span>
                    </div>
                  )}
                  {selectedProfileDetail.distributor?.gstin && (
                    <div className="flex items-center gap-1.5 border-l border-border pl-3 font-mono">
                      <span className="font-semibold text-text">GSTIN:</span>
                      <span>{selectedProfileDetail.distributor.gstin}</span>
                    </div>
                  )}
                </div>

                {(() => {
                  const successCount = selectedProfileDetail.profile?.success_count || 0;
                  const lastSuccess = selectedProfileDetail.profile?.last_success_at;
                  const learned = successCount > 0;
                  return (
                    <div className={`p-4 rounded-xl border shrink-0 transition-all ${learned ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                      <div className="flex items-center gap-2">
                        {learned ? (
                          <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle size={18} className="text-amber-500 shrink-0" />
                        )}
                        <div className={`font-bold text-sm ${learned ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {learned
                            ? `Bill layout learned — ${successCount} bill${successCount === 1 ? '' : 's'} read automatically`
                            : 'Not learned yet'}
                        </div>
                      </div>
                      <div className="text-xs text-muted mt-1.5 pl-6 leading-relaxed">
                        {learned
                          ? `Last processed: ${lastSuccess ? formatDisplayDate(lastSuccess) : 'recently'}. The app continuously parses this distributor's bills automatically with 100% column precision.`
                          : "The AI parser will learn this distributor's invoice layout automatically the next time a bill is uploaded — no manual template setup required."}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex-1 flex flex-col min-h-0 pt-2">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <div className="text-xs font-bold text-text uppercase tracking-wider">File History & Invoices</div>
                    <span className="text-xs text-muted font-mono font-bold">
                      {selectedProfileDetail.files?.length || 0} parsed
                    </span>
                  </div>
                  {selectedProfileDetail.files && selectedProfileDetail.files.length > 0 ? (
                    <div className="space-y-2 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                      {selectedProfileDetail.files.map(f => (
                        <div key={f.id} className="flex items-center justify-between text-xs bg-bg border border-border rounded-xl px-3.5 py-3 hover:border-primary/30 transition-all">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1.5 rounded-lg bg-bg2 text-muted">
                              <FileText size={14} />
                            </div>
                            <span className="text-text font-bold truncate max-w-[280px]">{f.filename}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-muted text-[11px]">{f.created_at ? formatDisplayDate(f.created_at) : ''}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              Parsed
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted italic p-8 bg-bg2/40 border border-border rounded-xl text-center flex-1 flex items-center justify-center">
                      No invoices recorded for this distributor yet. Upload a bill in Purchase Bills to trigger auto-learning.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Informative Overview When No Profile is Selected — Solves the Empty Space! */
              <div className="flex flex-col h-full justify-between space-y-6">
                {/* Hero Header */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5 text-primary">
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                      <Bot size={20} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-text">Distributor OCR Auto-Learning System</h3>
                      <p className="text-xs text-muted">Autonomous template induction for wholesale pharmaceutical invoices</p>
                    </div>
                  </div>
                </div>

                {/* 3 Core Workflow Pillars */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  <div className="bg-bg border border-border rounded-xl p-3.5 space-y-2 shadow-xs">
                    <div className="w-7 h-7 rounded-lg bg-sky/10 text-sky border border-sky/20 flex items-center justify-center font-bold text-xs">
                      1
                    </div>
                    <div className="font-bold text-text text-xs">Zero Manual Setup</div>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Simply upload an invoice PDF or image. Vision AI detects header columns (Item, Batch, Expiry, MRP, Rate, GST) dynamically.
                    </p>
                  </div>

                  <div className="bg-bg border border-border rounded-xl p-3.5 space-y-2 shadow-xs">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center font-bold text-xs">
                      2
                    </div>
                    <div className="font-bold text-text text-xs">Layout Fingerprinting</div>
                    <p className="text-[11px] text-muted leading-relaxed">
                      Upon confirmation, the coordinate matrix is stored against the supplier profile. Subsequent bills from this supplier parse in &lt;1 second.
                    </p>
                  </div>

                  <div className="bg-bg border border-border rounded-xl p-3.5 space-y-2 shadow-xs">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold text-xs">
                      3
                    </div>
                    <div className="font-bold text-text text-xs">Continuous Adaptation</div>
                    <p className="text-[11px] text-muted leading-relaxed">
                      If a supplier updates bill fonts or shifts tax columns, the adaptive learner updates coordinates without breaking catalog links.
                    </p>
                  </div>
                </div>

                {/* Real Live Metric Counters */}
                <div className="bg-bg2 border border-border rounded-xl p-4">
                  <div className="text-xs font-bold text-text uppercase tracking-wider mb-3">
                    Distributor Registry Status
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-bg p-3 rounded-lg border border-border">
                      <div className="text-[10px] text-muted font-bold uppercase">Total Suppliers</div>
                      <div className="text-xl font-black font-mono text-text mt-1">{profilesList.length}</div>
                    </div>
                    <div className="bg-bg p-3 rounded-lg border border-border">
                      <div className="text-[10px] text-muted font-bold uppercase">Layouts Learned</div>
                      <div className="text-xl font-black font-mono text-emerald-500 mt-1">
                        {profilesList.filter(p => p.files_count > 0).length}
                      </div>
                    </div>
                    <div className="bg-bg p-3 rounded-lg border border-border">
                      <div className="text-[10px] text-muted font-bold uppercase">Pending First Bill</div>
                      <div className="text-xl font-black font-mono text-amber-500 mt-1">
                        {profilesList.filter(p => p.files_count === 0).length}
                      </div>
                    </div>
                    <div className="bg-bg p-3 rounded-lg border border-border">
                      <div className="text-[10px] text-muted font-bold uppercase">Orders Today</div>
                      <div className="text-xl font-black font-mono text-sky mt-1">
                        {profilesList.filter(p => hasOrderToday(p)).length}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Call to action guidance */}
                <div className="p-3.5 rounded-xl border border-dashed border-border text-center text-xs text-muted">
                  👉 Click any distributor on the left list to view invoice file history, edit credentials, or inspect OCR rules.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD DISTRIBUTOR MODAL PORTAL */}
      {/* ========================================================================= */}
      {showAddDistributorModal && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl backdrop-blur-xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Building2 size={18} className="text-primary" />
                <span>Register New Distributor</span>
              </div>
              <button
                onClick={() => {
                  setShowAddDistributorModal(false);
                  setNewDistName('');
                  setNewDistPhone('');
                  setNewDistEmail('');
                  setNewDistGstin('');
                  setNewDistAddress('');
                }}
                className="text-muted hover:text-text cursor-pointer p-1"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted">
              Add distributor details directly to your database. This distributor will be immediately available across Purchase Bills, OCR Auto-Learning, and Pharmarack.
            </p>

            <form onSubmit={handleCreateDistributor} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-bold text-text block mb-1">
                  Distributor / Agency Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Pharma Distributors"
                  value={newDistName}
                  onChange={e => setNewDistName(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary font-bold"
                  required
                  autoFocus
                />
              </div>

              <div>
                <PhoneInputWithBadge
                  label="WhatsApp / Mobile Phone"
                  value={newDistPhone}
                  onChange={val => setNewDistPhone(val)}
                  placeholder="10 digits"
                  shakeOnError={shakeNewDistributorPhone}
                  allowEmpty={true}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. orders@distributor.com"
                    value={newDistEmail}
                    onChange={e => setNewDistEmail(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">
                    GSTIN / Party Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    value={newDistGstin}
                    onChange={e => setNewDistGstin(e.target.value.toUpperCase())}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary font-mono uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-text block mb-1">
                  Business Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shop 12, Wholesale Market, Mumbai"
                  value={newDistAddress}
                  onChange={e => setNewDistAddress(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddDistributorModal(false);
                    setNewDistName('');
                    setNewDistPhone('');
                    setNewDistEmail('');
                    setNewDistGstin('');
                    setNewDistAddress('');
                  }}
                  className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingDistributor || !newDistName.trim()}
                  className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
                >
                  {isCreatingDistributor ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>Save Distributor</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MERGE MODAL PORTAL */}
      {/* ========================================================================= */}
      {showMergeModal && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl backdrop-blur-xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <GitMerge size={18} className="text-amber-500" />
                <span>Merge Duplicate Distributor Profiles</span>
              </div>
              <button
                onClick={() => setShowMergeModal(false)}
                className="text-muted hover:text-text cursor-pointer p-1 rounded-lg hover:bg-bg2"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              Select the primary profile to retain and the secondary profile to merge into it.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Primary Profile (Keep)</label>
                <select
                  value={primaryMergeId || ''}
                  onChange={e => setPrimaryMergeId(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-bold"
                >
                  <option value="">Select Primary Distributor...</option>
                  {profilesList.map(p => (
                    <option key={p.distributor_id} value={p.distributor_id}>
                      {p.distributor_name} (#{p.distributor_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">Secondary Profile (Merge & Remove)</label>
                <select
                  value={secondaryMergeId || ''}
                  onChange={e => setSecondaryMergeId(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-bold"
                >
                  <option value="">Select Secondary Distributor...</option>
                  {profilesList.filter(p => p.distributor_id !== primaryMergeId).map(p => (
                    <option key={p.distributor_id} value={p.distributor_id}>
                      {p.distributor_name} (#{p.distributor_id})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                onClick={() => setShowMergeModal(false)}
                className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                onClick={handleMergeProfiles}
                disabled={isMerging || !primaryMergeId || !secondaryMergeId}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                {isMerging ? <RefreshCw size={14} className="animate-spin" /> : <GitMerge size={14} />}
                <span>Confirm Merge</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* EDIT DISTRIBUTOR MODAL PORTAL */}
      {/* ========================================================================= */}
      {editingDistributor && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl backdrop-blur-xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Edit size={18} className="text-primary" />
                <span>Edit Distributor Profile & OCR Rules</span>
              </div>
              <button
                onClick={() => setEditingDistributor(null)}
                className="text-muted hover:text-text cursor-pointer p-1 rounded-lg hover:bg-bg2"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Distributor Name *</label>
                <input
                  type="text"
                  value={editingDistributor.name}
                  onChange={e => setEditingDistributor({ ...editingDistributor, name: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PhoneInputWithBadge
                  label="Phone Number"
                  value={editingDistributor.phone}
                  onChange={val => setEditingDistributor({ ...editingDistributor, phone: val })}
                  shakeOnError={shakeDistributorPhone}
                  allowEmpty={true}
                />
                <div>
                  <label className="text-xs font-bold text-text block mb-1">Email Address</label>
                  <input
                    type="email"
                    value={editingDistributor.email}
                    onChange={e => setEditingDistributor({ ...editingDistributor, email: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">OCR Column Mapping Rules (JSON)</label>
                <textarea
                  rows={6}
                  value={editingDistributor.mappingRulesStr}
                  onChange={e => setEditingDistributor({ ...editingDistributor, mappingRulesStr: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl p-3 text-xs font-mono text-emerald-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 scrollbar-thin"
                  placeholder='{ "item_name": "Product", "quantity": "Qty", "mrp": "MRP" }'
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <button
                onClick={() => handleDeleteDistributorProfile(editingDistributor.id, editingDistributor.name)}
                className="px-3.5 py-2 rounded-xl bg-red/10 border border-red/20 text-red font-bold text-xs cursor-pointer hover:bg-red/20 flex items-center gap-1.5 transition-all active:scale-95"
                title="Delete Distributor Layout Profile"
              >
                <Trash2 size={14} />
                <span>Delete Layout</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingDistributor(null)}
                  className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDistributorDetails}
                  disabled={isSavingDistributor || !editingDistributor.name.trim()}
                  className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
                >
                  {isSavingDistributor ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>Save Changes</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* EDIT DOCTOR MODAL PORTAL */}
      {/* ========================================================================= */}
      {editingDoctor && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl backdrop-blur-xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Stethoscope size={18} className="text-primary" />
                <span>Edit Doctor Details & Credentials</span>
              </div>
              <button
                onClick={() => setEditingDoctor(null)}
                className="text-muted hover:text-text cursor-pointer p-1 rounded-lg hover:bg-bg2"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Doctor Full Name *</label>
                <input
                  type="text"
                  value={editingDoctor.name}
                  onChange={e => setEditingDoctor({ ...editingDoctor, name: e.target.value })}
                  placeholder="e.g. Dr. A. K. Sharma"
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-text block mb-1">Reg / License No.</label>
                  <input
                    type="text"
                    value={editingDoctor.reg_number}
                    onChange={e => setEditingDoctor({ ...editingDoctor, reg_number: e.target.value })}
                    placeholder="e.g. MCI-98765"
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text block mb-1">Specialty</label>
                  <input
                    type="text"
                    value={editingDoctor.specialty}
                    onChange={e => setEditingDoctor({ ...editingDoctor, specialty: e.target.value })}
                    placeholder="e.g. Cardiologist"
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <PhoneInputWithBadge
                  label="Phone Number"
                  value={editingDoctor.phone}
                  onChange={val => setEditingDoctor({ ...editingDoctor, phone: val })}
                  shakeOnError={shakeEditDoctorPhone}
                  allowEmpty={true}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">Clinic / Hospital Affiliation</label>
                <input
                  type="text"
                  value={editingDoctor.clinic}
                  onChange={e => setEditingDoctor({ ...editingDoctor, clinic: e.target.value })}
                  placeholder="e.g. City Care Hospital"
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                onClick={() => setEditingDoctor(null)}
                className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDoctorDetails}
                disabled={isSavingDoctor || !editingDoctor.name.trim()}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                {isSavingDoctor ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Learning;
