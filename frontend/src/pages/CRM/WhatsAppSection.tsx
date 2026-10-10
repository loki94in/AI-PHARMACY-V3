import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  RefreshCw, Send, MessageSquare, Phone,
  Search, MessageCircle, Check, Package,
  ExternalLink, LogOut, Zap, Copy, X, Trash2, Pill
} from 'lucide-react';
import { apiClient, api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { MedicineVisualReferenceModal } from '../../components/MedicineVisualReferenceModal';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';
import { withSilentRetry, formatTs, type LocalApiError } from './crmTypes';

interface OcrParsedPayload {
  items?: Array<{ name?: string; medicine_name?: string; text?: string }>;
  text?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP SECTION — embedded web.whatsapp.com iframe
// ═══════════════════════════════════════════════════════════════════════════════

function formatPhoneNumber(numStr?: string): string {
  if (!numStr) return '';
  const digits = numStr.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length > 13) {
    return '';
  }
  return numStr.includes('+') ? numStr : `+${numStr}`;
}

function resolveChatDisplay(chat: WaChatItem): { title: string; subtitle: string } {
  const rawId = chat.id || '';
  const isLid = rawId.endsWith('@lid');
  const cleanPhone = formatPhoneNumber(chat.resolvedNumber || (isLid ? '' : rawId.split('@')[0]));

  const rawName = (chat.name || '').trim();
  const isNameDigitsOnly = /^\d+$/.test(rawName.replace(/\D/g, '')) && rawName.replace(/\D/g, '').length >= 8;
  const isNameLid = rawName.includes('@lid');

  if (rawName && !isNameDigitsOnly && !isNameLid) {
    return {
      title: rawName,
      subtitle: cleanPhone || (isLid ? '' : chat.resolvedNumber || rawId.split('@')[0])
    };
  }

  if (cleanPhone) {
    return {
      title: cleanPhone,
      subtitle: 'WhatsApp Contact'
    };
  }

  return {
    title: rawName || chat.resolvedNumber || rawId.split('@')[0],
    subtitle: ''
  };
}

interface WaChatItem {
  id: string;
  name: string;
  unreadCount: number;
  timestamp?: number;
  isGroup?: boolean;
  lastMessage?: string | null;
  resolvedNumber?: string;
  sessionMode?: 'auto' | 'manual';
  sessionStatus?: 'idle' | 'active' | 'waiting' | 'unanswered' | 'ended';
  isUnansweredOver5Min?: boolean;
  manualActiveUntil?: number;
  language?: 'en' | 'hi' | 'mr';
}

interface WaMessageItem {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  type?: string;
  hasMedia?: boolean;
  scannedResult?: string | null;
}

interface WaMessageTemplate {
  id: number;
  name: string;
  category: string;
  body: string;
}

let cachedWaChats: WaChatItem[] = [];
let cachedWaTemplates: WaMessageTemplate[] = [];

export const WhatsAppSection: React.FC = () => {
  const [chats, setChats] = useState<WaChatItem[]>(cachedWaChats);
  const [loadingChats, setLoadingChats] = useState(false);
  const [search, setSearch] = useState('');
  const [activeChat, setActiveChat] = useState<WaChatItem | null>(null);

  const [messages, setMessages] = useState<WaMessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ filename: string; mimetype: string; data: string } | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string>('');
  const [templates, setTemplates] = useState<WaMessageTemplate[]>(cachedWaTemplates);
  const [showTemplatePopover, setShowTemplatePopover] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [scanningOcrId, setScanningOcrId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [deletingWaMsgId, setDeletingWaMsgId] = useState<string | null>(null);
  // OCR results keyed by message ID (populated from DB via scannedResult or SSE)
  const [ocrResults, setOcrResults] = useState<Record<string, string>>({});

  const handleStartNewChat = (rawNumber: string) => {
    const cleanDigits = sanitizePhoneInput(rawNumber);
    if (!cleanDigits || !isValid10DigitPhone(cleanDigits)) {
      toastEvent.trigger('Please enter a valid 10-digit Indian mobile number (starts with 6–9).', 'error', '/crm');
      return;
    }
    const digits = `91${cleanDigits}`;
    const chatId = `${digits}@c.us`;
    const newChatObj: WaChatItem = {
      id: chatId,
      name: formatPhoneNumber(digits),
      unreadCount: 0,
      timestamp: Math.floor(Date.now() / 1000),
      resolvedNumber: digits,
      lastMessage: ''
    };

    setChats(prev => {
      if (prev.some(c => c.id === chatId || c.resolvedNumber === digits)) return prev;
      return [newChatObj, ...prev];
    });
    setActiveChat(newChatObj);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setSearch('');
  };

  // Resizable panel width state (persisted in localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('crm_sidebar_width');
    return saved ? parseInt(saved, 10) : 340;
  });
  const [isDragging, setIsDragging] = useState(false);

  // Mouse move handler for resizing sidebar
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = Math.min(Math.max(e.clientX - 260, 240), 550);
      setSidebarWidth(newWidth);
      localStorage.setItem('crm_sidebar_width', String(newWidth));
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Template form state
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [tmplName, setTmplName] = useState('');
  const [tmplCategory, setTmplCategory] = useState('General');
  const [tmplBody, setTmplBody] = useState('');
  const [savingTmpl, setSavingTmpl] = useState(false);
  const [showVisualRefModal, setShowVisualRefModal] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref so SSE handler always sees the latest activeChat without stale closure
  const activeChatRef = useRef<WaChatItem | null>(null);
  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  // Load WhatsApp status + QR code
  const checkStatus = useCallback(async () => {
    try {
      const res = await apiClient.get<{ isReady: boolean; qrUrl?: string; message?: string; initializing?: boolean }>('/messaging/qr');
      setIsReady(res.data.isReady);
      setQrUrl(res.data.qrUrl || null);
      setQrMessage(res.data.message || '');
      setInitializing(!!res.data.initializing);
    } catch {
      setIsReady(false);
      setQrUrl(null);
      setInitializing(false);
    }
  }, []);

  // Fetch Chat List
  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await withSilentRetry(() => apiClient.get<WaChatItem[]>('/messaging/chats'));
      const list = Array.isArray(res.data) ? res.data : [];
      cachedWaChats = list;
      setChats(list);
    } catch {
      toastEvent.trigger('Failed to load WhatsApp chats', 'error', '/crm');
    } finally {
      setLoadingChats(false);
    }
  }, []);

  // Fetch Message Templates
  const loadTemplates = useCallback(async () => {
    try {
      const res = await apiClient.get<WaMessageTemplate[]>('/messaging/templates');
      const list = Array.isArray(res.data) ? res.data : [];
      cachedWaTemplates = list;
      setTemplates(list);
    } catch (err) {
      console.error('Failed to load message templates:', err);
    }
  }, []);

  const statusPollActive = usePageActive();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- engine status bootstrap seeds states
    checkStatus();
    loadTemplates();
  }, [checkStatus, loadTemplates]);

  // Gate chat list behind WhatsApp ready — avoids cold-boot false-failure toasts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chat fetch gated on readiness
    if (isReady) loadChats();
  }, [isReady, loadChats]);

  useEffect(() => {
    if (!statusPollActive) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- visibility-gated status poll bootstrap
    checkStatus();
    if (isReady) loadChats();
  }, [checkStatus, loadChats, isReady, statusPollActive]);

  const messagePollActive = usePageActive();

  // Load Thread Messages when activeChat changes (Every BOOT/mount)
  useEffect(() => {
    if (!activeChat) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale thread on close
      setMessages([]);
      setOcrResults({});
      return;
    }

    const loadMessages = (isInitial = false) => {
      if (isInitial) setLoadingMessages(true);
      apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChat.id)}/messages?limit=500`)
        .then(res => {
          const msgs = Array.isArray(res.data) ? res.data : [];
          setMessages(prev => {
            const optimisticMsgs = prev.filter(m => m.id.startsWith('optimistic_'));
            if (optimisticMsgs.length === 0) return msgs;

            const fetchedBodies = new Set(msgs.map(m => m.body));
            const pendingOptimistic = optimisticMsgs.filter(m => !fetchedBodies.has(m.body));
            return [...msgs, ...pendingOptimistic];
          });
          // Populate ocrResults map from pre-existing DB scans
          const preloaded: Record<string, string> = {};
          for (const msg of msgs) {
            if (msg.scannedResult) {
              try {
                const parsed = JSON.parse(msg.scannedResult);
                const label = (parsed as OcrParsedPayload)?.items?.map((i: { name?: string; medicine_name?: string; text?: string }) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                  || parsed?.text?.substring(0, 120);
                if (label) preloaded[msg.id] = label;
              } catch { /* ignore malformed JSON */ }
            }
          }
          setOcrResults(preloaded);
          if (isInitial) setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        })
        .catch(() => { if (isInitial) toastEvent.trigger('Failed to load message history', 'error', '/crm'); })
        .finally(() => { if (isInitial) setLoadingMessages(false); });
    };

    loadMessages(true);
  }, [activeChat, messagePollActive]);

function isSameChat(chat: WaChatItem, targetChatId: string, resolvedNum?: string): boolean {
  if (!chat) return false;
  if (chat.id === targetChatId) return true;
  if (chat.resolvedNumber && targetChatId.includes(chat.resolvedNumber)) return true;
  if (resolvedNum && (chat.id.includes(resolvedNum) || chat.resolvedNumber === resolvedNum)) return true;

  const chatDigits = (chat.resolvedNumber || chat.id).replace(/\D/g, '').slice(-10);
  const targetDigits = ((resolvedNum || targetChatId) || '').replace(/\D/g, '').slice(-10);

  if (chatDigits && targetDigits && chatDigits.length >= 7 && chatDigits === targetDigits) {
    return true;
  }
  return false;
}

  // SSE events via the single global listener (useGlobalSseInvalidation) —
  // no page-owned EventSource, so switching chats never reconnects the stream.
  useEffect(() => {
    const onWaNewMessage = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (!data?.payload) return;
      try {
        const newMsg: WaMessageItem = data.payload.message;
        const chatId: string = data.payload.chat_id;
        const resolvedNumber: string = data.payload.resolved_number;

        // Use ref to avoid stale closure on activeChat
        const currentChat = activeChatRef.current;
        if (currentChat && isSameChat(currentChat, chatId, resolvedNumber)) {
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
        // Refresh chats list preview
        loadChats();
      } catch (err) {
        console.error('SSE wa_new_message handling error:', err);
      }
    };

    const onOcrScanComplete = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (!data) return;
      // OCR result arrived from background scan — update pill badge in chat
      const { msgId, ocrResult } = data.payload || {};
      if (msgId && ocrResult) {
        try {
          const label = (ocrResult as OcrParsedPayload)?.items?.map((i: { name?: string; medicine_name?: string; text?: string }) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
            || ocrResult?.text?.substring(0, 120);
          if (label) setOcrResults(prev => ({ ...prev, [msgId]: label }));
        } catch { /* ignore */ }
      }
    };

    const onAuthFailure = () => setIsReady(false);

    window.addEventListener('sse-wa-new-message', onWaNewMessage);
    window.addEventListener('sse-ocr-scan-complete', onOcrScanComplete);
    window.addEventListener('sse-auth-failure', onAuthFailure);
    return () => {
      window.removeEventListener('sse-wa-new-message', onWaNewMessage);
      window.removeEventListener('sse-ocr-scan-complete', onOcrScanComplete);
      window.removeEventListener('sse-auth-failure', onAuthFailure);
    };
  }, [loadChats]);

  // Universal Escape key dismissal for WhatsApp modals
  useModalEscape(showManageModal, () => setShowManageModal(false));
  useModalEscape(showNewChatModal, () => {
    setShowNewChatModal(false);
    setNewChatNumber('');
  });

  // Handle Send Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChat) return;
    if (!composerText.trim() && !attachedFile) return;

    const recipient = activeChat.resolvedNumber || activeChat.id.split('@')[0];
    const textToSend = composerText.trim();
    setSending(true);

    // Optimistic update: show the message immediately in the thread
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticMsg: WaMessageItem = {
      id: optimisticId,
      body: attachedFile ? `[Document] ${attachedFile.filename}` : textToSend,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      type: attachedFile ? 'document' : 'text',
      hasMedia: !!attachedFile,
      scannedResult: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);

    // Clear composer immediately for better UX
    setComposerText('');
    setAttachedFile(null);

    try {
      await apiClient.post('/messaging/send', {
        number: recipient,
        message: textToSend,
        file: attachedFile || undefined
      });
      toastEvent.trigger('Message sent via WhatsApp', 'success', '/crm');
      // Refresh chat list immediately so the new or updated chat shows up with preview
      loadChats();
      // Reconcile optimistic message with DB record after short delay
      setTimeout(() => {
        if (activeChatRef.current) {
          apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChatRef.current.id)}/messages?limit=500`)
            .then(res => {
              if (Array.isArray(res.data) && res.data.length > 0) {
                setMessages(res.data);
                setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
              }
            })
            .catch(() => {});
        }
      }, 400);
    } catch (err) {
      // Remove optimistic message on failure so user knows the send failed
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to send message', 'error', '/crm');
    } finally {
      setSending(false);
    }
  };

  // Handle File Select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setAttachedFile({
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        data: base64Data
      });
    };
    reader.readAsDataURL(file);
  };

  // Handle Save Template (Create / Edit)
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tmplName.trim() || !tmplBody.trim()) {
      toastEvent.trigger('Name and content are required', 'error');
      return;
    }
    setSavingTmpl(true);
    try {
      if (editingTemplateId) {
        await apiClient.put(`/messaging/templates/${editingTemplateId}`, {
          name: tmplName,
          category: tmplCategory,
          body: tmplBody
        });
        toastEvent.trigger('Template updated', 'success');
      } else {
        await apiClient.post('/messaging/templates', {
          name: tmplName,
          category: tmplCategory,
          body: tmplBody
        });
        toastEvent.trigger('Template created', 'success');
      }
      setTmplName('');
      setTmplCategory('General');
      setTmplBody('');
      setEditingTemplateId(null);
      await loadTemplates();
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to save template', 'error');
    } finally {
      setSavingTmpl(false);
    }
  };

  // Delete Template
  const handleDeleteTemplate = async (id: number) => {
    try {
      await apiClient.delete(`/messaging/templates/${id}`);
      toastEvent.trigger('Template deleted', 'success');
      await loadTemplates();
    } catch {
      toastEvent.trigger('Failed to delete template', 'error');
    }
  };

  // Edit Template
  const handleStartEditTemplate = (t: WaMessageTemplate) => {
    setEditingTemplateId(t.id);
    setTmplName(t.name);
    setTmplCategory(t.category || 'General');
    setTmplBody(t.body);
  };

  // Filtered Chats
  const filteredChats = chats.filter(c => {
    const query = search.toLowerCase().trim();
    if (!query) return true;
    return (
      (c.name && c.name.toLowerCase().includes(query)) ||
      (c.resolvedNumber && c.resolvedNumber.includes(query)) ||
      (c.id && c.id.includes(query))
    );
  });

  return (
    <div className="w-full h-full flex flex-col gap-3">
      {/* Top Controls: Engine Status & Action Controls */}
      <div className="flex items-center justify-between gap-3 bg-bg2 p-2.5 rounded-2xl border border-border shadow-sm shrink-0">
        <div className="flex items-center gap-2 select-none">
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-sm font-bold flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live WhatsApp CRM Engine</span>
          </div>
          <span className="text-xs text-muted hidden sm:inline">
            Drag panel handle to customize width (auto-saved)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 text-sm font-bold transition-all active:scale-95"
            title="Start new chat with any phone number"
          >
            <MessageSquare size={15} />
            <span>New Chat</span>
          </button>

          <button
            onClick={() => setShowManageModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 border border-border text-text hover:text-primary text-sm font-bold transition-all active:scale-95"
            title="Manage Message Templates"
          >
            <Zap size={15} className="text-primary" />
            <span>Manage Templates</span>
          </button>

          <button
            onClick={async () => {
              try {
                toastEvent.trigger('Launching live WhatsApp Web Chrome window...', 'info');
                await apiClient.post('/messaging/login-window');
              } catch (err) {
                toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to launch WhatsApp window', 'error');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-all shadow-sm active:scale-95"
            title="Open native live Google Chrome window logged into WhatsApp Web"
          >
            <ExternalLink size={15} />
            <span>Open Live Chrome Window</span>
          </button>

          <button
            onClick={async () => {
              try {
                toastEvent.trigger('Logging out of WhatsApp & clearing session data...', 'info');
                await apiClient.post('/messaging/logout');
                toastEvent.trigger('WhatsApp logged out successfully. You can now scan a new QR code.', 'success');
                checkStatus();
              } catch (err) {
                toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to log out of WhatsApp', 'error');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-sm font-bold transition-all active:scale-95"
            title="Log out and clear all stored WhatsApp login data"
          >
            <LogOut size={15} />
            <span>Logout WhatsApp</span>
          </button>
        </div>
      </div>

      {/* ── WhatsApp Not-Connected: full QR setup screen ── */}
      {!isReady ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 bg-bg2 border border-border rounded-2xl">
          <div className="text-center space-y-1">
            <h2 className="text-sm font-bold text-text flex items-center justify-center gap-2">
              <MessageCircle size={18} className="text-emerald-400" />
              {initializing ? 'Connecting WhatsApp Session...' : 'Connect WhatsApp'}
            </h2>
            <p className="text-xs text-muted max-w-xs">
              {qrMessage || (initializing
                ? 'Restoring saved WhatsApp session... Your chats will load automatically in a moment.'
                : 'Scan the QR code below or click Connect WhatsApp to link your device.')}
            </p>
          </div>

          {/* QR Code or Connecting Spinner */}
          {qrUrl ? (
            <div className="p-4 bg-bg rounded-2xl shadow-lg border border-border">
              <img src={qrUrl} alt="WhatsApp QR Code" className="w-56 h-56" />
            </div>
          ) : initializing ? (
            <div className="w-64 h-64 bg-bg3 border border-border rounded-2xl flex flex-col items-center justify-center gap-3 text-muted">
              <RefreshCw size={28} className="animate-spin text-emerald-400" />
              <p className="text-xs font-semibold text-text">Auto-connecting saved session...</p>
              <p className="text-[10px] text-muted text-center px-4">Launching background WhatsApp engine with existing session data</p>
            </div>
          ) : (
            <div className="w-64 h-64 bg-bg3 border border-border rounded-2xl flex flex-col items-center justify-center gap-3 text-muted">
              <MessageCircle size={36} className="text-emerald-400/60" />
              <p className="text-xs font-medium text-muted">WhatsApp not connected</p>
              <button
                onClick={async () => {
                  try {
                    setInitializing(true);
                    toastEvent.trigger('Initializing WhatsApp connection...', 'info');
                    await apiClient.post('/messaging/connect');
                    checkStatus();
                  } catch (err) {
                    setInitializing(false);
                    toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to connect WhatsApp', 'error');
                  }
                }}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 mt-1"
              >
                <MessageCircle size={14} /> Connect WhatsApp
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={async () => {
                try {
                  setInitializing(true);
                  await apiClient.post('/messaging/connect');
                  checkStatus();
                } catch (err) {
                  setInitializing(false);
                  toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to connect', 'error');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-bg3 border border-border rounded-xl text-xs font-bold text-text hover:bg-bg transition-all active:scale-95"
            >
              <RefreshCw size={13} /> {qrUrl ? 'Refresh QR' : 'Connect / Generate QR'}
            </button>
            <button
              onClick={async () => {
                try {
                  toastEvent.trigger('Launching WhatsApp login window…', 'info');
                  await apiClient.post('/messaging/login-window');
                } catch (err) {
                  toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to launch login window', 'error');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
            >
              <ExternalLink size={13} /> Open Live Chrome Window
            </button>
            <button
              onClick={async () => {
                try {
                  toastEvent.trigger('Clearing stored WhatsApp session data...', 'info');
                  await apiClient.post('/messaging/logout');
                  toastEvent.trigger('WhatsApp session cleared successfully.', 'success');
                  checkStatus();
                } catch (err) {
                  toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to clear WhatsApp session', 'error');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 rounded-xl text-xs font-bold transition-all active:scale-95"
            >
              <LogOut size={13} /> Logout / Clear Session Data
            </button>
          </div>

          <p className="text-[10px] text-muted text-center max-w-xs">
            Open WhatsApp on your phone → Linked Devices → Link a Device → scan the QR above.
          </p>
        </div>
      ) : (
      /* ── Main Interface: Resizable Native Chat Panel ── */
      <div className="flex-1 min-h-0 flex bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Left: Chat List Panel (Resizable Width) */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-border flex flex-col bg-bg3/40 min-h-0 shrink-0 select-none"
        >
          <div className="p-3 border-b border-border flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search chats..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={loadChats}
              disabled={loadingChats}
              className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-all active:scale-95 disabled:opacity-50"
              title="Refresh chat list"
            >
              <RefreshCw size={14} className={loadingChats ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {loadingChats && chats.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">Loading chats...</div>
            ) : filteredChats.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted flex flex-col items-center gap-3">
                <span>No WhatsApp chats found.</span>
                {search.replace(/\D/g, '').length >= 7 && (
                  <button
                    onClick={() => handleStartNewChat(search)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    <MessageSquare size={13} />
                    <span>Start Chat with {search.trim()}</span>
                  </button>
                )}
              </div>
            ) : (
              filteredChats.map(c => {
                const isActive = activeChat?.id === c.id;
                const display = resolveChatDisplay(c);
                const initial = display.title.charAt(0).toUpperCase();

                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveChat(c)}
                    className={`p-3 flex items-start gap-3 cursor-pointer transition-all hover:bg-bg/60 ${
                      isActive ? 'bg-primary/10 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary border border-primary/30 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-text truncate">{display.title}</h4>
                        {c.timestamp && (
                          <span className="text-[10px] text-muted">{formatTs(c.timestamp)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-[11px] text-muted truncate flex-1">
                          {display.subtitle ? `${display.subtitle} • ` : ''}{c.lastMessage || 'No messages yet'}
                        </p>
                        {c.sessionMode === 'manual' && (
                          c.isUnansweredOver5Min ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex-shrink-0 animate-pulse">
                              ⚠️ &gt;5m
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 flex-shrink-0">
                              👤 Manual
                            </span>
                          )
                        )}
                        {c.language && c.language !== 'en' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex-shrink-0">
                            {c.language === 'mr' ? 'मराठी' : 'हिंदी'}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-primary text-white font-bold text-[10px]">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Resizable Divider Handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
          className="w-1.5 hover:w-2 bg-border/40 hover:bg-primary/60 cursor-col-resize transition-all shrink-0 select-none flex items-center justify-center group"
          title="Drag to resize WhatsApp panel (auto-saved)"
        >
          <div className="w-0.5 h-6 bg-muted/40 group-hover:bg-primary rounded-full transition-colors" />
        </div>

        {/* Right: Active Chat Thread & Composer */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {activeChat ? (
            <>
              {/* Thread Header */}
              {(() => {
                const activeDisplay = resolveChatDisplay(activeChat);
                return (
                  <div className="p-3 border-b border-border bg-bg2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/30">
                        {activeDisplay.title.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-text">
                          {activeDisplay.title}
                        </h3>
                        {activeDisplay.subtitle && (
                          <p className="text-[10px] text-muted">
                            {activeDisplay.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Human-in-the-loop: Language selector */}
                      <div className="flex items-center gap-1 bg-bg2 px-2 py-0.5 rounded border border-border text-[11px]">
                        <span className="text-muted text-[10px]">Lang:</span>
                        <select
                          value={activeChat.language || 'en'}
                          onChange={async (e) => {
                            const newLang = e.target.value as 'en' | 'hi' | 'mr';
                            try {
                              await api.updateChatLanguage(activeChat.id, newLang);
                              setActiveChat(prev => prev ? { ...prev, language: newLang } : null);
                              setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, language: newLang } : c));
                              toastEvent.trigger(`Chat language updated to ${newLang === 'mr' ? 'मराठी (Marathi)' : newLang === 'hi' ? 'हिंदी (Hindi)' : 'English'}`, 'success', '/crm');
                            } catch (_) {
                              toastEvent.trigger('Failed to update language', 'error', '/crm');
                            }
                          }}
                          className="bg-transparent text-text text-[11px] font-semibold focus:outline-none cursor-pointer"
                          title="Customer WhatsApp Language (AI Bot will reply in this language)"
                        >
                          <option value="en" className="bg-bg text-text">EN (English)</option>
                          <option value="hi" className="bg-bg text-text">HI (हिंदी)</option>
                          <option value="mr" className="bg-bg text-text">MR (मराठी)</option>
                        </select>
                      </div>
                      {activeChat.sessionMode === 'manual' && (
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border ${
                            activeChat.isUnansweredOver5Min
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse'
                              : 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {activeChat.isUnansweredOver5Min ? 'Patient Waiting (>5m)' : 'Human Active (AI Paused)'}
                          </span>
                          <button
                            onClick={async () => {
                              try {
                                await api.resolveWhatsappSession(activeChat.id);
                                setActiveChat(prev => prev ? { ...prev, sessionMode: 'auto', sessionStatus: 'ended', isUnansweredOver5Min: false } : null);
                                setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, sessionMode: 'auto', sessionStatus: 'ended', isUnansweredOver5Min: false } : c));
                                toastEvent.trigger('Session resolved. AI returned to standby.', 'success', '/crm');
                              } catch (_) {
                                toastEvent.trigger('Failed to resolve session', 'error', '/crm');
                              }
                            }}
                            className="px-2 py-1 rounded bg-bg text-text hover:bg-bg3 border border-border text-[11px] font-medium transition-colors flex items-center gap-1"
                            title="End manual takeover and return chat to AI standby"
                          >
                            <Check size={12} className="text-emerald-400" />
                            Resolve Session
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Thread Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-bg/50">
                {loadingMessages ? (
                  <div className="p-8 text-center text-xs text-muted">Loading message history...</div>
                ) : messages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">No messages in this chat.</div>
                ) : (
                  messages.map(m => {
                    const isOut = m.fromMe;
                    const isVoiceNote = m.type === 'ptt' || m.type === 'audio' || m.type === 'audioMessage';
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`group relative max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm select-text ${
                            isOut
                              ? 'bg-primary text-white rounded-br-none'
                              : 'bg-bg2 border border-border text-text rounded-bl-none'
                          }`}
                        >
                          {/* Copy Button */}
                          {m.body && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(m.body);
                                setCopiedMsgId(m.id);
                                toastEvent.trigger('Message copied to clipboard', 'success');
                                setTimeout(() => setCopiedMsgId(null), 2000);
                              }}
                              className={`absolute top-1.5 p-1 rounded-md transition-all ${
                                isVoiceNote && !isOut ? 'right-7' : 'right-1.5'
                              } ${
                                isOut
                                  ? 'bg-bg3/30 text-text hover:bg-bg3/50'
                                  : 'bg-bg3/80 text-muted hover:text-text hover:bg-bg3'
                              }`}
                              title="Copy message text"
                            >
                              {copiedMsgId === m.id ? (
                                <Check size={11} className="text-emerald-400" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          )}

                          {/* Delete Button — received voice notes only (removes the LOCAL cached copy) */}
                          {isVoiceNote && !isOut && (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!activeChat || deletingWaMsgId === m.id) return;
                                setDeletingWaMsgId(m.id);
                                try {
                                  await api.deleteWhatsappMessage(activeChat.id, m.id);
                                  setMessages(prev => prev.filter(x => x.id !== m.id));
                                  toastEvent.trigger('Voice note removed from inbox (sender\'s copy is untouched)', 'success');
                                } catch (err: unknown) {
                                  const apiErr = err as LocalApiError;
                                  toastEvent.trigger(apiErr?.response?.data?.error || apiErr?.message || 'Failed to delete voice note', 'error');
                                } finally {
                                  setDeletingWaMsgId(null);
                                }
                              }}
                              disabled={deletingWaMsgId === m.id}
                              className="absolute top-1.5 right-1.5 p-1 rounded-md transition-all bg-bg3/80 text-muted hover:text-red hover:bg-bg3"
                              title="Delete this voice note from the local inbox cache"
                            >
                              {deletingWaMsgId === m.id ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                            </button>
                          )}

                          <div className="whitespace-pre-wrap break-words pr-5 select-text">{m.body}</div>
                          {/* OCR medicine result pill — shown when scan result exists */}
                          {ocrResults[m.id] && (
                            <div className="mt-2 pt-1.5 border-t border-border/40 select-text flex items-center justify-between gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-400 text-[10px] font-semibold select-text">
                                💊 {ocrResults[m.id]}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(ocrResults[m.id]);
                                  toastEvent.trigger('OCR medicine text copied', 'success');
                                }}
                                className="p-1 text-[10px] text-teal-400 hover:underline flex items-center gap-0.5"
                                title="Copy OCR text"
                              >
                                <Copy size={9} /> Copy
                              </button>
                            </div>
                          )}
                          {m.hasMedia && (
                            <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-[10px]">
                              {isVoiceNote ? (
                                <span className="text-muted flex items-center gap-1">🎤 Voice note (no transcription)</span>
                              ) : (
                                <>
                                  <span className="text-muted flex items-center gap-1">📁 Media Attachment</span>
                                  <button
                                    onClick={async () => {
                                      setScanningOcrId(m.id);
                                      try {
                                        toastEvent.trigger('Queuing OCR prescription scan...', 'info');
                                        await apiClient.post(
                                          `/messaging/chats/${encodeURIComponent(activeChat!.id)}/messages/${encodeURIComponent(m.id)}/scan`
                                        );
                                        toastEvent.trigger('OCR scan queued – result will appear shortly', 'success', '/crm');
                                      } catch {
                                        toastEvent.trigger('Failed to queue prescription scan', 'error');
                                      } finally {
                                        setScanningOcrId(null);
                                      }
                                    }}
                                    disabled={scanningOcrId === m.id}
                                    className="px-2 py-0.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-bold transition-all flex items-center gap-1"
                                  >
                                    <span>{scanningOcrId === m.id ? 'Scanning OCR...' : '🔍 OCR Scan Prescription'}</span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          <div
                            className={`text-[9px] mt-1 text-right ${
                              isOut ? 'text-muted opacity-80' : 'text-muted'
                            }`}
                          >
                            {formatTs(m.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Attached File Bar */}
              {attachedFile && (
                <div className="px-4 py-2 bg-primary/10 border-t border-primary/20 flex items-center justify-between text-xs text-primary">
                  <div className="flex items-center gap-2 truncate">
                    <Package size={14} />
                    <span className="font-bold truncate">{attachedFile.filename}</span>
                  </div>
                  <button
                    onClick={() => setAttachedFile(null)}
                    className="p-1 hover:text-text transition-all"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Composer & Quick Templates Popover */}
              <div className="p-3 border-t border-border bg-bg2 relative">
                {/* Templates Popover */}
                {showTemplatePopover && (
                  <div className="absolute bottom-16 left-3 w-80 max-h-64 bg-bg2 border border-border rounded-2xl shadow-xl z-20 flex flex-col overflow-hidden">
                    <div className="p-2.5 border-b border-border bg-bg3 flex items-center justify-between text-xs font-bold text-text">
                      <span>Quick Message Templates</span>
                      <button
                        onClick={() => {
                          setShowTemplatePopover(false);
                          setShowManageModal(true);
                        }}
                        className="text-[10px] text-primary hover:underline"
                      >
                        Manage
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 divide-y divide-border/40">
                      {templates.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted">No templates found.</div>
                      ) : (
                        templates.map(t => (
                          <div
                            key={t.id}
                            onClick={() => {
                              setComposerText(prev => (prev ? `${prev}\n${t.body}` : t.body));
                              setShowTemplatePopover(false);
                            }}
                            className="p-2 hover:bg-bg3 rounded-xl cursor-pointer transition-all"
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-text">
                              <span>{t.name}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                                {t.category || 'General'}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted truncate mt-0.5">{t.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplatePopover(prev => !prev)}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-primary transition-all active:scale-95 text-xs font-bold flex items-center gap-1"
                    title="Quick Templates"
                  >
                    <Zap size={14} />
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-all active:scale-95"
                    title="Attach file"
                  >
                    <Package size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowVisualRefModal(true)}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-emerald-500 transition-all active:scale-95"
                    title="Send Medicine Visual Reference"
                  >
                    <Pill size={14} />
                  </button>

                  <input
                    type="text"
                    placeholder="Type WhatsApp message..."
                    value={composerText}
                    onChange={e => setComposerText(e.target.value)}
                    className="flex-1 px-4 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                  />

                  <button
                    type="submit"
                    disabled={sending || (!composerText.trim() && !attachedFile)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                  >
                    <Send size={13} />
                    <span>{sending ? 'Sending...' : 'Send'}</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                <MessageCircle size={24} />
              </div>
              <p className="text-xs">Select a WhatsApp chat from the list to view history &amp; send messages.</p>
            </div>
          )}
        </div>
      </div>
      )} {/* end isReady ternary */}

      {/* Medicine Visual Reference Modal */}
      {showVisualRefModal && activeChat && (
        <MedicineVisualReferenceModal
          isOpen={showVisualRefModal}
          onClose={() => setShowVisualRefModal(false)}
          recipientPhone={activeChat.resolvedNumber || activeChat.id.split('@')[0]}
          recipientName={activeChat.name !== activeChat.id.split('@')[0] ? activeChat.name : undefined}
          onSuccess={() => {
            loadChats();
            if (activeChatRef.current) {
              apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChatRef.current.id)}/messages?limit=500`)
                .then(res => {
                  if (Array.isArray(res.data) && res.data.length > 0) {
                    setMessages(res.data);
                    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                  }
                });
            }
          }}
        />
      )}

      {/* Template Manager Modal */}
      {showManageModal && (
        <div className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-lg h-[75vh] min-h-[480px] max-h-[680px] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.12)] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <span>Manage Quick Message Templates</span>
              </h3>
              <button
                onClick={() => setShowManageModal(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1 min-h-0">
              {/* Form */}
              <form onSubmit={handleSaveTemplate} className="p-3 bg-bg3/50 border border-border rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase">Template Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Refill Notice"
                      value={tmplName}
                      onChange={e => setTmplName(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase">Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Patients / General"
                      value={tmplCategory}
                      onChange={e => setTmplCategory(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-muted uppercase">Message Body</label>
                  <textarea
                    rows={3}
                    placeholder="Type template message text..."
                    value={tmplBody}
                    onChange={e => setTmplBody(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  {editingTemplateId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTemplateId(null);
                        setTmplName('');
                        setTmplCategory('General');
                        setTmplBody('');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted hover:bg-bg3"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingTmpl}
                    className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {savingTmpl ? 'Saving...' : editingTemplateId ? 'Update Template' : 'Add Template'}
                  </button>
                </div>
              </form>

              {/* Template List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-text uppercase tracking-wider">Existing Templates</h4>
                <div className="space-y-2">
                  {templates.map(t => (
                    <div
                      key={t.id}
                      className="p-3 bg-bg border border-border rounded-xl flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-text">{t.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                            {t.category || 'General'}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 whitespace-pre-wrap">{t.body}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleStartEditTemplate(t)}
                          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-bg3"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="p-1.5 rounded-lg text-muted hover:text-rose-400 hover:bg-bg3"
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-sm overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.12)] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <MessageSquare size={16} className="text-emerald-400" />
                <span>Start New WhatsApp Chat</span>
              </h3>
              <button
                onClick={() => { setShowNewChatModal(false); setNewChatNumber(''); }}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newChatNumber.trim()) handleStartNewChat(newChatNumber);
              }}
              className="p-4 space-y-3"
            >
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Mobile / WhatsApp Number</label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210 or 919876543210"
                  value={newChatNumber}
                  onChange={e => setNewChatNumber(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowNewChatModal(false); setNewChatNumber(''); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-muted hover:bg-bg3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChatNumber.trim()}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-50"
                >
                  Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
