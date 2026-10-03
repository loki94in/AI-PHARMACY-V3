import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageCircle, Mail, Bell, Search, RefreshCw, MessageSquare } from 'lucide-react';
import type { AutomationLog } from './crmTypes';
import { formatTs } from './crmTypes';
import { apiClient } from '../../services/api';
import { toastEvent, whatsappQueueEvent, automationHubEvent } from '../../services/events';

let cachedDistributorLogs: AutomationLog[] = [];

export const DistributorMessagesSection: React.FC = () => {
  const [logs, setLogs] = useState<AutomationLog[]>(cachedDistributorLogs);
  const [loading, setLoading] = useState(cachedDistributorLogs.length === 0);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [retrying, setRetrying] = useState<number | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (term: string) => {
    setSearch(term);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(term);
    }, 300);
  };

  const load = useCallback(async () => {
    if (cachedDistributorLogs.length === 0) {
      setLoading(true);
    }
    try {
      const r = await apiClient.get('/automation/notifications', {
        params: {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: debouncedSearch || undefined,
          limit: 200
        }
      });
      const list = Array.isArray(r.data) ? r.data : [];
      cachedDistributorLogs = list;
      setLogs(list);
    } catch { toastEvent.trigger('Failed to load messages', 'error', '/crm'); }
    finally { setLoading(false); }
  }, [typeFilter, statusFilter, debouncedSearch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- module-cache hydration loader, filter-reactive
    load();
  }, [load]);

  const handleRetry = async (id: number) => {
    setRetrying(id);
    try {
      await apiClient.post(`/automation/notifications/${id}/retry`);
      toastEvent.trigger('Message queued for retry', 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
      automationHubEvent.triggerUpdated();
      await load();
    } catch { toastEvent.trigger('Retry failed', 'error', '/crm'); }
    finally { setRetrying(null); }
  };

  const statusColor = (s: string) => {
    if (s === 'sent') return 'bg-green-500/15 text-green-400';
    if (s === 'failed') return 'bg-red-500/15 text-red-400';
    if (s === 'pending') return 'bg-yellow-500/15 text-yellow-400';
    return 'bg-muted/10 text-muted';
  };

  const typeIcon = (t: string) => {
    if (t?.includes('whatsapp')) return <MessageCircle size={13} className="text-green-400" />;
    if (t?.includes('email')) return <Mail size={13} className="text-blue-400" />;
    return <Bell size={13} className="text-muted" />;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search recipient or message…"
            className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none"
        >
          <option value="all">All Types</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="refill">Refill</option>
        </select>
        <button onClick={load} className="p-2 bg-bg2 border border-border rounded-lg hover:bg-bg3 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} />
        </button>
        <span className="text-xs text-muted ml-auto">{logs.length} messages</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-muted text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted gap-2">
            <MessageSquare size={32} className="opacity-30" />
            <p className="text-sm">No messages found</p>
          </div>
        )}
        {!loading && logs.length > 0 && (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 bg-bg2 border border-border rounded-xl px-4 py-3 hover:border-primary/20 transition-colors">
                <div className="mt-0.5">{typeIcon(log.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-text truncate">{log.recipient || '—'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor(log.status)}`}>
                      {log.status}
                    </span>
                    <span className="text-[10px] text-muted">{log.type}</span>
                  </div>
                  <p className="text-xs text-muted truncate">{log.message}</p>
                  {log.error && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">↳ {log.error}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="text-[10px] text-muted whitespace-nowrap">
                    {log.created_at ? formatTs(log.created_at) : '—'}
                  </span>
                  {log.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(log.id)}
                      disabled={retrying === log.id}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 bg-primary/10 border border-primary/30 text-primary rounded-md hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={9} className={retrying === log.id ? 'animate-spin' : ''} />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
