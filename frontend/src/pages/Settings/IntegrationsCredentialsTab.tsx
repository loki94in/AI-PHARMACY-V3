import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { Save, RefreshCw, Zap, RotateCcw, AlertTriangle, Send, CheckCircle2, MessageCircle, Mail, Smartphone, Check, Eye, CreditCard, ShoppingCart, Layers, Sparkles, ExternalLink, Globe, Copy, Phone, Cloud } from 'lucide-react';

export function IntegrationsCredentialsTab({ rawSettings, refetchSettings, isVisible }: { rawSettings: Record<string, string>; refetchSettings: () => void; isVisible: boolean }) {
  const [waPreferredSystem, setWaPreferredSystem] = useState(rawSettings.whatsapp_preferred_system || 'web');
  const [waBusinessToken, setWaBusinessToken] = useState(rawSettings.wa_business_access_token || '');
  const [waBusinessPhoneId, setWaBusinessPhoneId] = useState(rawSettings.wa_business_phone_number_id || '');
  const [emailInvoiceRecipient, setEmailInvoiceRecipient] = useState<string>(() => {
    if (rawSettings.notify_owner_on_email_whatsapp === '0') return 'none';
    return rawSettings.email_invoice_whatsapp_recipient || 'both';
  });
  
  const [telegramEnabled, setTelegramEnabled] = useState(rawSettings.telegram_enabled === 'true');
  const [telegramToken, setTelegramToken] = useState(rawSettings.telegram_token || '');
  const [telegramChatId, setTelegramChatId] = useState(rawSettings.telegram_chat_id || '');

  const [gmailUser, setGmailUser] = useState(rawSettings.gmail_user || '');
  const [gmailPass, setGmailPass] = useState(rawSettings.gmail_pass || '');

  const [pharmarackUser, setPharmarackUser] = useState(rawSettings.pharmarack_username || '');
  const [pharmarackPass, setPharmarackPass] = useState(rawSettings.pharmarack_password || '');
  const [pharmarackRefreshing, setPharmarackRefreshing] = useState(false);
  const [reorderWindowMonths, setReorderWindowMonths] = useState(rawSettings.pharmarack_reorder_window_months || '2');
  const [waIdleSleepMin, setWaIdleSleepMin] = useState(rawSettings.whatsapp_idle_sleep_min || '0');
  const [combinePharmarackSearch, setCombinePharmarackSearch] = useState(rawSettings.combine_pharmarack_pharmacy_search !== 'false');
  const [autoAddToLiveCart, setAutoAddToLiveCart] = useState(rawSettings.auto_add_to_live_cart !== 'false');
  const [geminiApiKey, setGeminiApiKey] = useState(rawSettings.gemini_api_key || '');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<{ type: 'success' | 'error' | 'idle'; message?: string }>({
    type: rawSettings.gemini_api_key ? 'success' : 'idle',
    message: rawSettings.gemini_api_key ? 'API Key saved and active in settings' : undefined
  });

  const [activeSubTab, setActiveSubTab] = useState<'all' | 'pharmarack' | 'whatsapp' | 'telegram' | 'gmail' | 'gemini' | 'cloudflare' | 'payments'>('all');
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const integrationSubTabs = [
    { id: 'all', label: 'All Services', icon: Layers },
    { id: 'pharmarack', label: 'Pharmarack B2B', icon: Zap },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'telegram', label: 'Telegram Bot', icon: Send },
    { id: 'gmail', label: 'Gmail Scanner', icon: Mail },
    { id: 'gemini', label: 'Gemini AI Vision', icon: Sparkles },
    { id: 'cloudflare', label: 'Cloudflare Tunnel', icon: Globe },
    { id: 'payments', label: 'UPI QR Payments', icon: CreditCard },
  ];

  // 3-UPI QR Code System & Delivery Feature Flag (§13, §15)
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [paymentQrs, setPaymentQrs] = useState<Array<{ id: string; label: string; payee_name: string; upi_id: string; is_active: boolean }>>([
    { id: 'QR_1', label: 'Pharmacy Counter UPI (QR 1)', payee_name: 'AI Pharmacy Counter 1', upi_id: 'aipharmacy1@upi', is_active: true },
    { id: 'QR_2', label: 'Pharmacy Counter UPI (QR 2)', payee_name: 'AI Pharmacy Counter 2', upi_id: 'aipharmacy2@upi', is_active: true },
    { id: 'QR_3', label: 'Pharmacy Counter UPI (QR 3)', payee_name: 'AI Pharmacy Counter 3', upi_id: 'aipharmacy3@upi', is_active: true }
  ]);

  useEffect(() => {
    api.getDeliveryConfig().then(res => {
      if (res?.success) setDeliveryEnabled(res.delivery_enabled);
    }).catch(() => {});

    api.getPaymentQrs().then(res => {
      if (res?.success && Array.isArray(res.configs) && res.configs.length > 0) {
        setPaymentQrs(res.configs);
      }
    }).catch(() => {});
  }, []);

  // Cloudflare Tunnel State
  const [cfAutostart, setCfAutostart] = useState(
    rawSettings.cloudflare_tunnel_autostart === '1' || rawSettings.cloudflare_tunnel_autostart === 'true'
  );
  const [cfToken, setCfToken] = useState(rawSettings.cloudflare_tunnel_token || '');
  const [cfCustomDomain, setCfCustomDomain] = useState(rawSettings.cloudflare_tunnel_custom_domain || '');
  const [showCfToken, setShowCfToken] = useState(false);
  const [cfTunnelStatus, setCfTunnelStatus] = useState<import('../../services/api').TunnelStatusResponse | null>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchCfStatus = useCallback(async () => {
    try {
      const res = await api.getTunnelStatus();
      if (res?.success) {
        setCfTunnelStatus(res);
      }
    } catch (err) {
      console.error('Failed to get tunnel status:', err);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      fetchCfStatus();
      const handleStatus = () => fetchCfStatus();
      window.addEventListener('sse-tunnel-status-changed', handleStatus);
      return () => {
        window.removeEventListener('sse-tunnel-status-changed', handleStatus);
      };
    }
  }, [isVisible, fetchCfStatus]);

  const handleToggleTunnel = async () => {
    setCfLoading(true);
    try {
      if (cfTunnelStatus?.isRunning) {
        await api.stopTunnel();
        toastEvent.trigger('Cloudflare Tunnel stopped', 'info');
      } else {
        await api.startTunnel();
        toastEvent.trigger('Starting Cloudflare Tunnel...', 'info');
      }
      setTimeout(fetchCfStatus, 1500);
    } catch (err: any) {
      toastEvent.trigger('Tunnel operation failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setCfLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (cfTunnelStatus?.url) {
      const storeUrl = `${cfTunnelStatus.url}/portal`;
      navigator.clipboard.writeText(storeUrl);
      setCopiedLink(true);
      toastEvent.trigger('Store portal link copied to clipboard!', 'success');
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // WhatsApp Web QR & Status — P1 "events, not timers": event-driven via SSE push / focus.
  // Polls ONLY while actively awaiting a QR scan after explicit user connection.
  const [waStatus, setWaStatus] = useState<{ status: string; qr?: string; message?: string }>({ status: 'UNKNOWN' });
  const fetchWaStatus = useCallback(async () => {
    if (!isVisible) return;
    try {
      const res = await api.getWhatsAppStatus();
      if (res) {
        setWaStatus({
          status: (res as any).status || (res.isReady ? 'READY' : 'DISCONNECTED'),
          qr: res.qrUrl || undefined,
          message: res.message
        });
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp status:', err);
    }
  }, [isVisible]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSE/focus-driven WA status subscription
    fetchWaStatus();
    const handleSse = () => fetchWaStatus();
    window.addEventListener('sse-wa-status-changed', handleSse);
    window.addEventListener('focus', handleSse);
    return () => {
      window.removeEventListener('sse-wa-status-changed', handleSse);
      window.removeEventListener('focus', handleSse);
    };
  }, [fetchWaStatus]);

  useEffect(() => {
    // Poll ONLY while actively connecting (user initiated connection and QR code is standing by)
    const isActivelyConnecting = waStatus.status === 'CONNECTING' || waStatus.status === 'SCAN_QR';
    if (!isActivelyConnecting || !isVisible) return;
    const interval = setInterval(fetchWaStatus, 3000);
    return () => clearInterval(interval);
  }, [waStatus.status, isVisible, fetchWaStatus]);

  // Telegram status: fetched on mount / focus / setting change (zero unnecessary polling timers)
  const { data: telegramStatus } = useApiQuery<{ isReady: boolean }>(
    'telegram-status',
    () => apiClient.get('/settings/telegram-status').then(res => res.data),
    { enabled: isVisible && telegramEnabled }
  );

  const handleResetIntegrations = () => {
    setWaPreferredSystem(rawSettings.whatsapp_preferred_system || 'web');
    setWaBusinessToken(rawSettings.wa_business_access_token || '');
    setWaBusinessPhoneId(rawSettings.wa_business_phone_number_id || '');
    setEmailInvoiceRecipient(rawSettings.notify_owner_on_email_whatsapp === '0' ? 'none' : (rawSettings.email_invoice_whatsapp_recipient || 'both'));
    setTelegramEnabled(rawSettings.telegram_enabled === 'true');
    setTelegramToken(rawSettings.telegram_token || '');
    setTelegramChatId(rawSettings.telegram_chat_id || '');
    setGmailUser(rawSettings.gmail_user || '');
    setGmailPass(rawSettings.gmail_pass || '');
    setPharmarackUser(rawSettings.pharmarack_username || '');
    setPharmarackPass(rawSettings.pharmarack_password || '');
    setReorderWindowMonths(rawSettings.pharmarack_reorder_window_months || '2');
    setWaIdleSleepMin(rawSettings.whatsapp_idle_sleep_min || '0');
    setCombinePharmarackSearch(rawSettings.combine_pharmarack_pharmacy_search !== 'false');
    setAutoAddToLiveCart(rawSettings.auto_add_to_live_cart !== 'false');
    setGeminiApiKey(rawSettings.gemini_api_key || '');
    setCfAutostart(rawSettings.cloudflare_tunnel_autostart === '1' || rawSettings.cloudflare_tunnel_autostart === 'true');
    setCfToken(rawSettings.cloudflare_tunnel_token || '');
    setCfCustomDomain(rawSettings.cloudflare_tunnel_custom_domain || '');
    toastEvent.trigger('All integration credentials reset to saved parameters', 'info');
  };

  const handleSaveGeminiKeyOnly = async () => {
    if (!geminiApiKey || geminiApiKey.trim() === '') {
      toastEvent.trigger('Please enter a Gemini API Key to save', 'error');
      return;
    }
    setSavingGemini(true);
    try {
      await apiClient.post('/settings/save-single', { key: 'gemini_api_key', value: geminiApiKey.trim() });
      toastEvent.trigger('Google Gemini API Key saved to database!', 'success');
      setGeminiStatus({ type: 'success', message: 'API Key successfully saved and active' });
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Save failed';
      toastEvent.trigger('Failed to save API Key: ' + msg, 'error');
      setGeminiStatus({ type: 'error', message: 'Save error: ' + msg });
    } finally {
      setSavingGemini(false);
    }
  };

  const handleTestGeminiKey = async () => {
    if (!geminiApiKey || geminiApiKey.trim() === '') {
      toastEvent.trigger('Please enter a Gemini API Key to test', 'error');
      return;
    }
    setTestingGemini(true);
    setGeminiStatus({ type: 'idle' });
    try {
      const res = await apiClient.post('/settings/test-gemini-key', { apiKey: geminiApiKey.trim() });
      if (res.data?.success) {
        // Auto-save key to database when verified
        await apiClient.post('/settings/save-single', { key: 'gemini_api_key', value: geminiApiKey.trim() });
        refetchSettings();
        const msg = res.data.message || 'Google Gemini API key verified and connected successfully!';
        toastEvent.trigger(msg, 'success');
        setGeminiStatus({ type: 'success', message: msg });
      } else {
        const errMsg = res.data?.error || 'Google rejected the API key';
        toastEvent.trigger(errMsg, 'error');
        setGeminiStatus({ type: 'error', message: errMsg });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Connection test failed';
      toastEvent.trigger('Gemini API Key error: ' + msg, 'error');
      setGeminiStatus({ type: 'error', message: msg });
    } finally {
      setTestingGemini(false);
    }
  };

  // Dedicated Card-Level Save & Reset Handlers
  const handleSavePharmarackOnly = async () => {
    setSavingSection('pharmarack');
    try {
      const payload: Record<string, string> = {
        pharmarack_username: pharmarackUser,
        pharmarack_password: pharmarackPass,
        pharmarack_mode: 'Live',
        pharmarack_reorder_window_months: reorderWindowMonths,
        combine_pharmarack_pharmacy_search: combinePharmarackSearch ? 'true' : 'false',
        auto_add_to_live_cart: autoAddToLiveCart ? 'true' : 'false'
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Pharmarack B2B credentials and settings saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Pharmarack credentials';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetPharmarackOnly = () => {
    setPharmarackUser(rawSettings.pharmarack_username || '');
    setPharmarackPass(rawSettings.pharmarack_password || '');
    setReorderWindowMonths(rawSettings.pharmarack_reorder_window_months || '2');
    setCombinePharmarackSearch(rawSettings.combine_pharmarack_pharmacy_search !== 'false');
    setAutoAddToLiveCart(rawSettings.auto_add_to_live_cart !== 'false');
    toastEvent.trigger('Pharmarack credentials reset to saved parameters', 'info');
  };

  const handleSaveGmailOnly = async () => {
    setSavingSection('gmail');
    try {
      const payload: Record<string, string> = {
        gmail_user: gmailUser,
        gmail_pass: gmailPass
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Gmail scanner credentials saved successfully!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Gmail credentials';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetGmailOnly = () => {
    setGmailUser(rawSettings.gmail_user || '');
    setGmailPass(rawSettings.gmail_pass || '');
    toastEvent.trigger('Gmail credentials reset to saved parameters', 'info');
  };

  const handleSaveTelegramOnly = async () => {
    setSavingSection('telegram');
    try {
      const payload: Record<string, string> = {
        telegram_enabled: telegramEnabled ? 'true' : 'false',
        telegram_token: telegramToken,
        telegram_chat_id: telegramChatId
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Telegram bot configuration saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Telegram settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetTelegramOnly = () => {
    setTelegramEnabled(rawSettings.telegram_enabled === 'true');
    setTelegramToken(rawSettings.telegram_token || '');
    setTelegramChatId(rawSettings.telegram_chat_id || '');
    toastEvent.trigger('Telegram settings reset to saved parameters', 'info');
  };

  const handleSaveWhatsappOnly = async () => {
    setSavingSection('whatsapp');
    try {
      const payload: Record<string, string> = {
        whatsapp_preferred_system: waPreferredSystem,
        wa_business_access_token: waBusinessToken,
        wa_business_phone_number_id: waBusinessPhoneId,
        whatsapp_idle_sleep_min: waIdleSleepMin,
        email_invoice_whatsapp_recipient: emailInvoiceRecipient,
        notify_owner_on_email_whatsapp: emailInvoiceRecipient === 'none' ? '0' : '1'
      };
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('WhatsApp configuration saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save WhatsApp settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetWhatsappOnly = () => {
    setWaPreferredSystem(rawSettings.whatsapp_preferred_system || 'web');
    setWaBusinessToken(rawSettings.wa_business_access_token || '');
    setWaBusinessPhoneId(rawSettings.wa_business_phone_number_id || '');
    setWaIdleSleepMin(rawSettings.whatsapp_idle_sleep_min || '0');
    setEmailInvoiceRecipient(rawSettings.notify_owner_on_email_whatsapp === '0' ? 'none' : (rawSettings.email_invoice_whatsapp_recipient || 'both'));
    toastEvent.trigger('WhatsApp configuration reset to saved parameters', 'info');
  };

  const handleSaveCloudflareOnly = async () => {
    setSavingSection('cloudflare');
    try {
      const payload: Record<string, string> = {
        cloudflare_tunnel_autostart: cfAutostart ? '1' : '0',
        cloudflare_tunnel_token: cfToken.trim(),
        cloudflare_tunnel_custom_domain: cfCustomDomain.trim()
      };
      await apiClient.post('/settings/save', payload);
      await api.configureTunnel({
        token: cfToken.trim(),
        customDomain: cfCustomDomain.trim(),
        autostart: cfAutostart
      }).catch(() => {});
      toastEvent.trigger('Cloudflare Tunnel configuration saved!', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save Cloudflare settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetCloudflareOnly = () => {
    setCfAutostart(rawSettings.cloudflare_tunnel_autostart === '1' || rawSettings.cloudflare_tunnel_autostart === 'true');
    setCfToken(rawSettings.cloudflare_tunnel_token || '');
    setCfCustomDomain(rawSettings.cloudflare_tunnel_custom_domain || '');
    toastEvent.trigger('Cloudflare Tunnel settings reset to saved parameters', 'info');
  };

  const handleSavePaymentQrsOnly = async () => {
    setSavingSection('payments');
    try {
      await Promise.all([
        api.savePaymentQrs(paymentQrs),
        api.saveDeliveryConfig(deliveryEnabled)
      ]);
      toastEvent.trigger('Online payments and QR code configuration saved!', 'success');
      refetchSettings();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to save payment QR settings';
      toastEvent.trigger(msg, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetPaymentQrsOnly = async () => {
    try {
      const res = await api.getPaymentQrs();
      if (res?.success && Array.isArray(res.configs) && res.configs.length > 0) {
        setPaymentQrs(res.configs);
      }
      const delRes = await api.getDeliveryConfig();
      if (delRes?.success) setDeliveryEnabled(delRes.delivery_enabled);
      toastEvent.trigger('Payment QR parameters reset to saved state', 'info');
    } catch {
      toastEvent.trigger('Failed to reset payment QR parameters', 'error');
    }
  };

  const handleSaveIntegrations = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        whatsapp_preferred_system: waPreferredSystem,
        wa_business_access_token: waBusinessToken,
        wa_business_phone_number_id: waBusinessPhoneId,
        email_invoice_whatsapp_recipient: emailInvoiceRecipient,
        notify_owner_on_email_whatsapp: emailInvoiceRecipient === 'none' ? '0' : '1',
        telegram_enabled: telegramEnabled ? 'true' : 'false',
        telegram_token: telegramToken,
        telegram_chat_id: telegramChatId,
        gmail_user: gmailUser,
        gmail_pass: gmailPass,
        pharmarack_username: pharmarackUser,
        pharmarack_password: pharmarackPass,
        pharmarack_mode: 'Live',
        pharmarack_reorder_window_months: reorderWindowMonths,
        whatsapp_idle_sleep_min: waIdleSleepMin,
        combine_pharmarack_pharmacy_search: combinePharmarackSearch ? 'true' : 'false',
        gemini_api_key: geminiApiKey,
        cloudflare_tunnel_autostart: cfAutostart ? '1' : '0',
        cloudflare_tunnel_token: cfToken.trim(),
        cloudflare_tunnel_custom_domain: cfCustomDomain.trim()
      };

      await apiClient.post('/settings/save', payload);
      await Promise.all([
        api.savePaymentQrs(paymentQrs),
        api.saveDeliveryConfig(deliveryEnabled),
        api.configureTunnel({
          token: cfToken.trim(),
          customDomain: cfCustomDomain.trim(),
          autostart: cfAutostart
        }).catch(() => {})
      ]);
      toastEvent.trigger('Integrations, 3-QR pool & API credentials saved successfully', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save integration settings: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveIntegrationsRef = useRef(handleSaveIntegrations);
  handleSaveIntegrationsRef.current = handleSaveIntegrations;

  useEffect(() => {
    return shortcutEvent.subscribeSave(() => {
      void handleSaveIntegrationsRef.current();
    });
  }, []);

  const handleToggleCombineSearch = async (val: boolean) => {
    setCombinePharmarackSearch(val);
    try {
      await apiClient.post('/settings', { key: 'combine_pharmarack_pharmacy_search', value: val ? 'true' : 'false' });
      toastEvent.trigger(`Combine Pharmarack & Pharmacy search ${val ? 'enabled' : 'disabled'}`, 'success');
      refetchSettings();
    } catch {
      toastEvent.trigger('Failed to update setting', 'error');
    }
  };

  const handleToggleAutoAddToCart = async (val: boolean) => {
    setAutoAddToLiveCart(val);
    try {
      await apiClient.post('/settings', { key: 'auto_add_to_live_cart', value: val ? 'true' : 'false' });
      toastEvent.trigger(`Auto Add to Live Cart ${val ? 'enabled' : 'disabled'}`, 'success');
      refetchSettings();
    } catch {
      toastEvent.trigger('Failed to update Auto Add to Live Cart setting', 'error');
    }
  };

  const handleTriggerPharmarackRefresh = async () => {
    setPharmarackRefreshing(true);
    try {
      const res = await apiClient.post('/pharmarack/trigger-reauth');
      if (res.data?.success) {
        toastEvent.trigger('Pharmarack live B2B session refreshed successfully', 'success');
        refetchSettings();
      } else {
        toastEvent.trigger(res.data?.message || 'Session expired. Click "Open Login Window" to complete authentication.', 'info');
      }
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Pharmarack session refresh error: ' + e.message, 'error');
    } finally {
      setPharmarackRefreshing(false);
    }
  };

  const handleLaunchPharmarackLogin = async () => {
    try {
      toastEvent.trigger('Opening Pharmarack Login window in Chrome...', 'info');
      await api.launchPharmarackLoginWindow();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e?.response?.data?.error || 'Failed to launch login window', 'error');
    }
  };

  const handleReorderWindowChange = async (months: string) => {
    setReorderWindowMonths(months);
    try {
      await apiClient.post('/settings', { key: 'pharmarack_reorder_window_months', value: months });
      toastEvent.trigger(`Reorder lookback window set to ${months} months`, 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save reorder window: ' + e.message, 'error');
    }
  };

  return (
    <form onSubmit={handleSaveIntegrations} className="space-y-6">
      {/* Sub-navigation Filter Bar for Fast Navigation */}
      <div className="flex items-center gap-1.5 p-1.5 bg-bg3/40 border border-border rounded-xl overflow-x-auto scrollbar-none shadow-xs">
        {integrationSubTabs.map((sub) => {
          const Icon = sub.icon;
          const isActive = activeSubTab === sub.id;
          return (
            <button
              key={sub.id}
              type="button"
              onClick={() => setActiveSubTab(sub.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-muted hover:text-text hover:bg-bg3/80'
              }`}
            >
              <Icon size={14} />
              <span>{sub.label}</span>
            </button>
          );
        })}
      </div>

      {/* WhatsApp Section */}
      {(activeSubTab === 'all' || activeSubTab === 'whatsapp') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <MessageCircle size={16} /> WhatsApp Messaging Infrastructure
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              waPreferredSystem === 'web'
                ? waStatus.status === 'READY'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : waStatus.status === 'SLEEPING'
                    ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : waBusinessToken
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-bg border border-border text-muted'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                waPreferredSystem === 'web' && waStatus.status === 'READY' ? 'bg-emerald-400 animate-pulse' : 'bg-muted'
              }`} />
              {waPreferredSystem === 'web' ? `Web Status: ${waStatus.status}` : waBusinessToken ? 'Cloud API Configured' : 'Not Configured'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-text uppercase">WhatsApp Automated System</h3>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">Preferred Integration System</label>
                <select
                  value={waPreferredSystem}
                  onChange={(e) => setWaPreferredSystem(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                >
                  <option value="web">Automated WhatsApp Web (Headless Chrome QR)</option>
                  <option value="business">Official WhatsApp Business Cloud API</option>
                </select>
              </div>

              {waPreferredSystem === 'web' && (
                <div className="p-3 bg-bg rounded-xl border border-border space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-text">Web Status:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      waStatus.status === 'READY'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : waStatus.status === 'SLEEPING'
                          ? 'bg-sky-500/20 text-sky-400'
                          : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {waStatus.status}
                    </span>
                  </div>
                  {waStatus.status === 'SLEEPING' && (
                    <p className="text-[11px] text-muted">
                      Browser closed to save memory. It wakes automatically when you send a message.
                    </p>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1" htmlFor="wa-idle-sleep-min">
                      Sleep browser after idle (minutes)
                    </label>
                    <input
                      id="wa-idle-sleep-min"
                      type="number"
                      min={0}
                      max={480}
                      value={waIdleSleepMin}
                      onChange={(e) => setWaIdleSleepMin(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                      placeholder="0"
                    />
                    <p className="text-[10px] text-muted mt-1">
                      0 = Never sleep (stays awake 24/7 so customer incoming messages &amp; replies are never missed). &gt;0 frees ~250–400 MB RAM while idle.
                    </p>
                  </div>
                  {waStatus.qr && (
                    <div className="flex flex-col items-center py-2 rounded-lg" style={{ backgroundColor: '#ffffff' }}>
                      <img src={waStatus.qr} alt="WhatsApp Web QR Code" className="w-32 h-32" />
                      <span className="text-[10px] text-gray-700 font-semibold mt-1">Scan with WhatsApp on phone</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-text uppercase">Meta WhatsApp Business API Keys</h3>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={waBusinessPhoneId}
                  onChange={(e) => setWaBusinessPhoneId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  placeholder="Meta Phone Number ID"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">System User Access Token</label>
                <input
                  type="password"
                  value={waBusinessToken}
                  onChange={(e) => setWaBusinessToken(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  placeholder="Permanent Bearer Token"
                />
              </div>
            </div>

            {/* Email Invoice WhatsApp Alert Recipient Management */}
            <div className="md:col-span-2 bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-text uppercase flex items-center gap-2">
                    <Mail size={14} className="text-primary" /> Invoice Email WhatsApp Notifications
                  </h3>
                  <p className="text-[11px] text-muted mt-0.5">
                    Choose which phone number(s) receive automatic WhatsApp alerts when distributor invoice emails are received.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
                {[
                  {
                    id: 'both',
                    label: 'Both Numbers',
                    desc: 'Store & Owner',
                    phone: [rawSettings.shop_phone || rawSettings.phone, rawSettings.owner_whatsapp_number].filter(Boolean).join(' + ') || 'Both configured'
                  },
                  {
                    id: 'pharmacy',
                    label: 'Pharmacy / Counter',
                    desc: 'Store Phone',
                    phone: rawSettings.shop_phone || rawSettings.phone || 'Not configured'
                  },
                  {
                    id: 'owner',
                    label: 'Owner WhatsApp',
                    desc: 'Owner Mobile',
                    phone: rawSettings.owner_whatsapp_number || 'Not configured'
                  },
                  {
                    id: 'none',
                    label: 'Disabled',
                    desc: 'No Alerts',
                    phone: 'Turned off'
                  }
                ].map((opt) => {
                  const isSelected = emailInvoiceRecipient === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEmailInvoiceRecipient(opt.id)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-primary/10 border-primary shadow-sm text-text'
                          : 'bg-bg2/60 border-border text-muted hover:text-text hover:bg-bg2'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">{opt.label}</span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-bg"></span>}
                        </span>
                      </div>
                      <div className="mt-2 text-[10px] text-muted truncate">
                        <span className="font-mono">{opt.phone}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* WhatsApp Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Saves preferred messaging route, Meta Cloud API credentials, idle sleep, and recipient settings
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetWhatsappOnly}
                disabled={savingSection === 'whatsapp'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSaveWhatsappOnly}
                disabled={savingSection === 'whatsapp'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'whatsapp' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save WhatsApp Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Bot */}
      {(activeSubTab === 'all' || activeSubTab === 'telegram') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Send size={16} /> Telegram Alert Bot &amp; Prescription Receiver
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              telegramEnabled && telegramStatus?.isReady
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : telegramToken
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                  : 'bg-bg border border-border text-muted'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${telegramEnabled && telegramStatus?.isReady ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
              {telegramEnabled && telegramStatus?.isReady ? 'Bot Online & Listening' : telegramToken ? 'Credentials Saved' : 'Not Configured'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 md:col-span-3">
              <input
                type="checkbox"
                id="tgEnabled"
                checked={telegramEnabled}
                onChange={(e) => setTelegramEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="tgEnabled" className="text-xs font-bold text-text cursor-pointer">
                Enable Automated Telegram Bot Notifications &amp; Photo Ingestion
              </label>
              {telegramEnabled && (
                <span className={`ml-auto px-2.5 py-1 rounded text-[10px] font-bold ${
                  telegramStatus?.isReady ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400'
                }`}>
                  {telegramStatus?.isReady ? 'BOT ONLINE & LISTENING' : 'BOT DISCONNECTED'}
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Telegram Bot Token</label>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Target Chat / Channel ID</label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                placeholder="-100123456789"
              />
            </div>
          </div>

          {/* Telegram Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Used to receive photo prescriptions and broadcast urgent low-stock or expiry alerts
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetTelegramOnly}
                disabled={savingSection === 'telegram'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSaveTelegramOnly}
                disabled={savingSection === 'telegram'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'telegram' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Telegram Credentials</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gmail / Email */}
      {(activeSubTab === 'all' || activeSubTab === 'gmail') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Mail size={16} /> Gmail / IMAP Mail Order Scanner Credentials
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              gmailUser && gmailPass
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-bg border border-border text-muted'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${gmailUser && gmailPass ? 'bg-emerald-400' : 'bg-muted'}`} />
              {gmailUser && gmailPass ? 'Credentials Configured' : 'Credentials Not Set'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">IMAP Gmail Account Address</label>
              <input
                type="email"
                value={gmailUser}
                onChange={(e) => setGmailUser(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="store.distributor.invoices@gmail.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Google App Password (16-character secret)</label>
              <input
                type="password"
                value={gmailPass}
                onChange={(e) => setGmailPass(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                placeholder="abcd efgh ijkl mnop"
              />
            </div>
          </div>

          {/* Gmail Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Used by automatic background worker to scan distributor invoices &amp; purchase confirmations
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetGmailOnly}
                disabled={savingSection === 'gmail'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSaveGmailOnly}
                disabled={savingSection === 'gmail'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'gmail' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Gmail Credentials</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pharmarack B2B */}
      {(activeSubTab === 'all' || activeSubTab === 'pharmarack') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Zap size={16} /> Pharmarack B2B Live Ordering Credentials
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              pharmarackUser && pharmarackPass
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pharmarackUser && pharmarackPass ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {pharmarackUser && pharmarackPass ? 'Live B2B Configured' : 'Credentials Missing'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Username / Phone</label>
              <input
                type="text"
                value={pharmarackUser}
                onChange={(e) => setPharmarackUser(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Mobile / Username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Password</label>
              <input
                type="password"
                value={pharmarackPass}
                onChange={(e) => setPharmarackPass(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Account Password"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={handleTriggerPharmarackRefresh}
                disabled={pharmarackRefreshing}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
                title="Attempt silent token refresh from saved Chrome session profile"
              >
                <RefreshCw size={14} className={pharmarackRefreshing ? 'animate-spin' : ''} />
                <span>Refresh Session</span>
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={handleLaunchPharmarackLogin}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/80 transition-all cursor-pointer shadow-sm"
                title="Open Chrome window with auto-filled credentials to enter OTP"
              >
                <Smartphone size={14} />
                <span>Open Login (OTP)</span>
              </button>
            </div>
          </div>

          {/* Dedicated Pharmarack Save & Reset Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                pharmarackUser && pharmarackPass
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${pharmarackUser && pharmarackPass ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {pharmarackUser && pharmarackPass ? 'Credentials Configured' : 'Credentials Missing'}
              </span>
              <span className="text-[11px] text-muted">
                Auto-fill login will use these credentials when launching Chrome
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetPharmarackOnly}
                disabled={savingSection === 'pharmarack'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSavePharmarackOnly}
                disabled={savingSection === 'pharmarack'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'pharmarack' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Pharmarack Credentials</span>
              </button>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-semibold text-text mb-1">Reorder Suggestions Lookback Window</label>
            <select
              value={reorderWindowMonths}
              onChange={(e) => handleReorderWindowChange(e.target.value)}
              className="w-full md:w-1/3 px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            >
              <option value="2">2 months</option>
              <option value="4">4 months</option>
              <option value="6">6 months</option>
              <option value="8">8 months</option>
            </select>
            <p className="text-[11px] text-muted mt-1">
              How far back sales/purchase history is weighed for restock suggestions and the &quot;Ordered Recently&quot; list in the Reorder Hub. Changing this recomputes suggestions in the background.
            </p>
          </div>

          {/* Combine Pharmarack & Local Pharmacy Search Toggle */}
          <div className="bg-bg3/30 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Layers size={14} className="text-primary" /> Combine Pharmarack &amp; Local Pharmacy Search
              </span>
              <p className="text-[11px] text-muted max-w-xl">
                When Pharmarack is offline, disconnected, or has no results, automatically search your local pharmacy purchase history and inventory. Displays each distributor&apos;s specific PTR, MRP, packaging, and stock in the exact same card dropdown.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="combinePharmarackSearchToggle"
                checked={combinePharmarackSearch}
                onChange={(e) => handleToggleCombineSearch(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="combinePharmarackSearchToggle" className="text-xs font-semibold text-text cursor-pointer">
                {combinePharmarackSearch ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>

          {/* Auto Add to Live Cart Toggle */}
          <div className="bg-bg3/30 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <ShoppingCart size={14} className="text-primary" /> Auto Add to Live Cart
              </span>
              <p className="text-[11px] text-muted max-w-xl">
                When enabled, confirmed customer orders are automatically added into your Pharmarack Live Cart. When disabled, requests are staged for your manual review and addition.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoAddToLiveCartToggle"
                checked={autoAddToLiveCart}
                onChange={(e) => handleToggleAutoAddToCart(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="autoAddToLiveCartToggle" className="text-xs font-semibold text-text cursor-pointer">
                {autoAddToLiveCart ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Google Gemini AI Vision Credentials */}
      {(activeSubTab === 'all' || activeSubTab === 'gemini') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Sparkles size={16} /> Google Gemini AI Vision (Prescription &amp; Purchase OCR)
            </h2>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-sky hover:underline font-semibold"
            >
              <span>Get Free Key (Google AI Studio)</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary mt-0.5">
                <Sparkles size={18} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xs font-bold text-text">Cloud Vision AI Assistant</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky/10 text-sky border border-sky/20">
                    1,500 Scans/Day Free
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    No Credit Card Required
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-1 leading-relaxed">
                  Empowers automatic cloud fallback for illegible cursive doctor handwriting and complex purchase invoice line items.
                  Your app runs the <strong>Local Offline Scanner first</strong> (3.6s, ₹0 cost), and seamlessly calls Gemini whenever an API key is configured.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
              <div className="sm:col-span-8">
                <label className="block text-xs font-semibold text-text mb-1">
                  Google Gemini API Key
                </label>
                <div className="relative">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                    placeholder="AIzaSy..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer p-1"
                    title={showGeminiKey ? 'Hide key' : 'Show key'}
                  >
                    <Eye size={14} />
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleSaveGeminiKeyOnly}
                  disabled={savingGemini || !geminiApiKey}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Save API key directly to database"
                >
                  {savingGemini ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>{savingGemini ? 'Saving...' : 'Save Key'}</span>
                </button>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleTestGeminiKey}
                  disabled={testingGemini || !geminiApiKey}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Verify API key with Google AI Studio and auto-save"
                >
                  <RefreshCw size={14} className={testingGemini ? 'animate-spin' : ''} />
                  <span>{testingGemini ? 'Testing...' : 'Test & Verify'}</span>
                </button>
              </div>
            </div>

            {/* Live Status Feedback Banner */}
            {geminiStatus.type !== 'idle' && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 transition-all ${
                geminiStatus.type === 'success'
                  ? 'bg-primary/10 border-primary/20 text-primary'
                  : 'bg-bg3 border-border text-text'
              }`}>
                {geminiStatus.type === 'success' ? (
                  <CheckCircle2 size={16} className="text-primary shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="text-muted shrink-0" />
                )}
                <span className="font-semibold">{geminiStatus.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cloudflare Tunnel & Live Online Store Section */}
      {(activeSubTab === 'all' || activeSubTab === 'cloudflare') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Globe size={16} /> Cloudflare Tunnel — Zero-Cost Online Store
            </h2>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 self-start sm:self-auto">
              $0 Cloud Bills • Unlimited Local Storage • Auto HTTPS
            </span>
          </div>

          <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text">Tunnel Service Status:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    cfTunnelStatus?.isRunning
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-bg border border-border text-muted'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${cfTunnelStatus?.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                    {cfTunnelStatus?.isRunning ? 'LIVE & ACCESSIBLE' : 'OFFLINE'}
                  </span>
                </div>
                <p className="text-[11px] text-muted">
                  Securely tunnels patient store traffic and product images from this computer to the public internet via Cloudflare edge network.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleToggleTunnel}
                  disabled={cfLoading}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm ${
                    cfTunnelStatus?.isRunning
                      ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                >
                  {cfLoading ? <RefreshCw size={13} className="animate-spin" /> : <Globe size={13} />}
                  <span>{cfLoading ? 'Processing...' : cfTunnelStatus?.isRunning ? 'Stop Tunnel' : 'Start Tunnel'}</span>
                </button>

                {cfTunnelStatus?.url && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="flex items-center gap-1.5 px-3 py-2 bg-bg border border-border text-text hover:text-primary rounded-xl text-xs font-medium transition-all cursor-pointer"
                      title="Copy patient store link"
                    >
                      {copiedLink ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      <span>{copiedLink ? 'Copied' : 'Copy Store Link'}</span>
                    </button>
                    <a
                      href={`${cfTunnelStatus.url}/portal`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 bg-bg border border-border text-text hover:text-primary rounded-xl text-xs font-medium transition-all"
                    >
                      <ExternalLink size={13} />
                      <span>Open Store</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            {cfTunnelStatus?.url && (
              <div className="p-3 bg-bg border border-emerald-500/20 rounded-xl flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-semibold text-text shrink-0">Live URL:</span>
                  <span className="font-mono text-primary truncate select-all">{cfTunnelStatus.url}/portal</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                  Encrypted HTTPS
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="cfAutostartToggle"
                    checked={cfAutostart}
                    onChange={(e) => setCfAutostart(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="cfAutostartToggle" className="text-xs font-bold text-text cursor-pointer">
                    Auto-start Tunnel on Server Boot
                  </label>
                </div>
                <p className="text-[11px] text-muted pl-6">
                  When enabled, Cloudflare Tunnel starts automatically whenever you run the pharmacy application.
                </p>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-text">
                  Custom Domain (Optional)
                </label>
                <input
                  type="text"
                  value={cfCustomDomain}
                  onChange={(e) => setCfCustomDomain(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  placeholder="e.g. store.mypharmacy.com"
                />
                <p className="text-[10px] text-muted">
                  Leave empty for automatic free <code className="text-primary">trycloudflare.com</code> address.
                </p>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="block text-xs font-bold text-text">
                  Cloudflare Tunnel Token (Optional - Required for Custom Permanent Domains)
                </label>
                <div className="relative">
                  <input
                    type={showCfToken ? 'text' : 'password'}
                    value={cfToken}
                    onChange={(e) => setCfToken(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                    placeholder="eyJhIjoi... (from Cloudflare Zero Trust Dashboard)"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCfToken(!showCfToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer p-1"
                    title={showCfToken ? 'Hide token' : 'Show token'}
                  >
                    <Eye size={14} />
                  </button>
                </div>
                <p className="text-[10px] text-muted">
                  If you have your own domain on Cloudflare Zero Trust, paste your tunnel run token here. If empty, the app runs in Quick Tunnel mode with zero configuration needed.
                </p>
              </div>
            </div>

            {/* Cloudflare Card Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg border border-border rounded-xl p-3 mt-2">
              <span className="text-[11px] text-muted">
                Saves autostart preference, custom domain, and Cloudflare token
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetCloudflareOnly}
                  disabled={savingSection === 'cloudflare'}
                  className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw size={13} />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveCloudflareOnly}
                  disabled={savingSection === 'cloudflare'}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {savingSection === 'cloudflare' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  <span>Save Tunnel Settings</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3-UPI QR Rotation Pool & Fulfillment (§13, §15) */}
      {(activeSubTab === 'all' || activeSubTab === 'payments') && (
        <div className="bg-bg2 border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <CreditCard size={16} /> Online Customer Payments &amp; Fulfillment (3-QR Pool)
            </h2>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 self-start sm:self-auto">
              Strict Alternating Rotation (QR N ≠ Previous QR)
            </span>
          </div>

          {/* Feature Flag: Home Delivery vs In-Store Pickup */}
          <div className="bg-bg3/30 border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-text block">Enable Home Delivery Checkout</span>
              <p className="text-[11px] text-muted max-w-xl">
                When disabled, customer online checkout operates strictly in <strong>In-Store Pickup Only</strong> mode.
                The customer address schema and database records remain fully preserved for future re-activation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enableDeliveryToggle"
                checked={deliveryEnabled}
                onChange={(e) => setDeliveryEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="enableDeliveryToggle" className="text-xs font-semibold text-text cursor-pointer">
                {deliveryEnabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>
          </div>

          {/* 3 QR Code Configuration Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {paymentQrs.map((qr, idx) => (
              <div key={qr.id} className="bg-bg3/25 border border-border rounded-xl p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-primary/10 text-primary text-[10px] font-black flex items-center justify-center border border-primary/20">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-text">{qr.id} Slot</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qr.is_active}
                      onChange={(e) => {
                        const updated = [...paymentQrs];
                        updated[idx] = { ...updated[idx], is_active: e.target.checked };
                        setPaymentQrs(updated);
                      }}
                      className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
                    />
                    <span>Active</span>
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">Display Label</label>
                  <input
                    type="text"
                    value={qr.label}
                    onChange={(e) => {
                      const updated = [...paymentQrs];
                      updated[idx] = { ...updated[idx], label: e.target.value };
                      setPaymentQrs(updated);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">Payee Name (as in bank)</label>
                  <input
                    type="text"
                    value={qr.payee_name}
                    onChange={(e) => {
                      const updated = [...paymentQrs];
                      updated[idx] = { ...updated[idx], payee_name: e.target.value };
                      setPaymentQrs(updated);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">UPI ID / VPA</label>
                  <input
                    type="text"
                    value={qr.upi_id}
                    onChange={(e) => {
                      const updated = [...paymentQrs];
                      updated[idx] = { ...updated[idx], upi_id: e.target.value };
                      setPaymentQrs(updated);
                    }}
                    placeholder="name@upi"
                    className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none font-mono"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Payment QR Card Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 border border-border rounded-xl p-3 mt-3">
            <span className="text-[11px] text-muted">
              Saves delivery checkout mode and active 3-QR rotation pool configurations
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetPaymentQrsOnly}
                disabled={savingSection === 'payments'}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleSavePaymentQrsOnly}
                disabled={savingSection === 'payments'}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {savingSection === 'payments' ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Save Payment &amp; QR Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Bottom Master Save & Reset Bar */}
      <div className="sticky bottom-0 bg-bg/95 border border-border p-3.5 rounded-2xl shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 mt-6 z-20">
        <div className="flex items-center gap-2 text-xs text-muted">
          <CheckCircle2 size={16} className="text-primary shrink-0" />
          <span>
            {activeSubTab === 'all'
              ? 'Bulk Action: Save or reset all 7 service credentials simultaneously'
              : `Bulk Action: Save or reset all credentials across all integrations`}
          </span>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={handleResetIntegrations}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer disabled:opacity-50"
          >
            <RotateCcw size={14} />
            <span>Reset All Changes</span>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Save All Integrations &amp; Credentials</span>
          </button>
        </div>
      </div>
    </form>
  );
}



// ==========================================
// SUB-TAB 5: DATA & BACKUPS
// ==========================================

