/**
 * CallTaskBoard.tsx
 *
 * Displays patients who could not be reached via WhatsApp and need a phone call.
 * Rendered as a panel/tab inside CRM and Refills pages.
 * Features:
 * - List of pending call tasks (refill + credit)
 * - Mark as called (checkbox) with quick outcome selection
 * - Reschedule to a future date
 * - Dismiss / cancel
 * - Real-time badge count via SSE call_tasks_updated event
 */

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../services/api';
import { Phone, CheckCircle, Clock, X, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface CallTask {
  id: number;
  task_type: 'refill' | 'credit';
  patient_name: string;
  patient_phone: string;
  reference_id: string | null;
  details_json: string | null;
  status: 'pending' | 'completed' | 'rescheduled' | 'dismissed';
  call_outcome: string | null;
  reschedule_date: string | null;
  notes: string | null;
  owner_wa_sent: number;
  created_at: string;
  updated_at: string;
}

interface CallTaskBoardProps {
  filter?: 'all' | 'refill' | 'credit';
  compact?: boolean;
}

async function fetchCallTasks(status = 'pending', type = 'all'): Promise<{ tasks: CallTask[]; total: number }> {
  const params = new URLSearchParams({ status, limit: '100' });
  if (type !== 'all') params.append('type', type);
  const res = await apiClient.get(`/call-tasks?${params}`);
  return res.data;
}

async function fetchCallTaskCount(): Promise<{ count: number }> {
  const res = await apiClient.get('/call-tasks/count');
  return res.data;
}

export function CallTaskBadge() {
  const { data } = useQuery({
    queryKey: ['call-tasks-count'],
    queryFn: fetchCallTaskCount,
    staleTime: 30000,
  });
  const count = data?.count ?? 0;
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-orange-500 text-white min-w-[18px]">
      {count}
    </span>
  );
}

export function CallTaskBoard({ filter = 'all', compact = false }: CallTaskBoardProps) {
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [outcomeId, setOutcomeId] = useState<number | null>(null);
  const [outcome, setOutcome] = useState('');
  const [confirmDismissId, setConfirmDismissId] = useState<number | null>(null);

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ['call-tasks', 'pending', filter],
    queryFn: () => fetchCallTasks('pending', filter),
    staleTime: 30000,
  });

  const { data: completedData } = useQuery({
    queryKey: ['call-tasks', 'completed', filter],
    queryFn: () => fetchCallTasks('completed', filter),
    enabled: showCompleted,
    staleTime: 30000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['call-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['call-tasks-count'] });
  };

  const completeMutation = useMutation({
    mutationFn: ({ id, call_outcome, notes }: { id: number; call_outcome: string; notes?: string }) =>
      apiClient.patch(`/call-tasks/${id}/complete`, { call_outcome, notes }),
    onSuccess: () => { invalidate(); setOutcomeId(null); setOutcome(''); },
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, reschedule_date }: { id: number; reschedule_date: string }) =>
      apiClient.patch(`/call-tasks/${id}/reschedule`, { reschedule_date }),
    onSuccess: () => { invalidate(); setRescheduleId(null); setRescheduleDate(''); },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiClient.patch(`/call-tasks/${id}/dismiss`),
    onSuccess: invalidate,
  });

  const tasks = pendingData?.tasks ?? [];
  const completedTasks = completedData?.tasks ?? [];

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const getDetails = (task: CallTask): string => {
    try {
      const j = JSON.parse(task.details_json || '{}');
      return j.details || j.message?.slice(0, 120) || '';
    } catch { return ''; }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted text-xs p-4">
        <RefreshCw size={14} className="animate-spin" /> Loading call tasks...
      </div>
    );
  }

  if (tasks.length === 0 && !compact) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted">
        <CheckCircle size={32} className="text-green-500/50" />
        <p className="text-xs">No pending call tasks. All patients have been reached!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id} className="p-3 rounded-xl bg-bg3/40 border border-orange-400/20 space-y-2">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${task.task_type === 'refill' ? 'bg-sky-500' : 'bg-amber-500'}`}>
                    {task.task_type === 'refill' ? 'R' : 'C'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text truncate">{task.patient_name}</p>
                    <a
                      href={`tel:${task.patient_phone}`}
                      className="text-[11px] text-sky-500 hover:text-sky-400 flex items-center gap-1 transition-colors"
                    >
                      <Phone size={10} />
                      {task.patient_phone}
                    </a>
                  </div>
                </div>
                <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${task.task_type === 'refill' ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {task.task_type}
                </span>
              </div>

              {/* Details */}
              {getDetails(task) && (
                <p className="text-[11px] text-muted line-clamp-2">{getDetails(task)}</p>
              )}
              <p className="text-[10px] text-muted/60">{formatDate(task.created_at)}</p>

              {/* Outcome inline form */}
              {outcomeId === task.id ? (
                <div className="space-y-1.5">
                  <select
                    id={`outcome-select-${task.id}`}
                    value={outcome}
                    onChange={e => setOutcome(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  >
                    <option value="">Select outcome...</option>
                    <option value="confirmed">✅ Confirmed — Coming to collect</option>
                    <option value="promised_payment">💰 Promised Payment</option>
                    <option value="partial_paid">💸 Partial Payment Received</option>
                    <option value="no_answer">📵 No Answer — Try Again Later</option>
                    <option value="not_needed">❌ Not Needed Anymore</option>
                    <option value="other">🗒️ Other</option>
                  </select>
                  <div className="flex gap-1.5">
                    <button
                      id={`mark-called-confirm-${task.id}`}
                      onClick={() => completeMutation.mutate({ id: task.id, call_outcome: outcome || 'called' })}
                      disabled={completeMutation.isPending}
                      className="flex-1 px-2 py-1 text-xs rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-50"
                    >
                      {completeMutation.isPending ? '...' : 'Save Outcome'}
                    </button>
                    <button onClick={() => setOutcomeId(null)} className="px-2 py-1 text-xs rounded-lg bg-bg3 text-muted hover:text-text transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : rescheduleId === task.id ? (
                <div className="space-y-1.5">
                  <input
                    id={`reschedule-date-${task.id}`}
                    type="date"
                    value={rescheduleDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={e => setRescheduleDate(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  />
                  <div className="flex gap-1.5">
                    <button
                      id={`reschedule-confirm-${task.id}`}
                      onClick={() => rescheduleMutation.mutate({ id: task.id, reschedule_date: rescheduleDate })}
                      disabled={!rescheduleDate || rescheduleMutation.isPending}
                      className="flex-1 px-2 py-1 text-xs rounded-lg bg-sky-600 text-white hover:bg-sky-500 transition-colors disabled:opacity-50"
                    >
                      {rescheduleMutation.isPending ? '...' : 'Set Reminder Date'}
                    </button>
                    <button onClick={() => setRescheduleId(null)} className="px-2 py-1 text-xs rounded-lg bg-bg3 text-muted hover:text-text transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    id={`mark-called-${task.id}`}
                    onClick={() => setOutcomeId(task.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors border border-green-600/30"
                  >
                    <CheckCircle size={10} /> Called
                  </button>
                  <button
                    id={`reschedule-btn-${task.id}`}
                    onClick={() => setRescheduleId(task.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-sky-600/20 text-sky-400 hover:bg-sky-600/30 transition-colors border border-sky-600/30"
                  >
                    <Clock size={10} /> Remind Later
                  </button>
                  {confirmDismissId === task.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        id={`dismiss-confirm-${task.id}`}
                        onClick={() => { dismissMutation.mutate(task.id); setConfirmDismissId(null); }}
                        className="px-2 py-0.5 text-[11px] rounded bg-red-600/30 text-red-400 hover:bg-red-600/40 border border-red-500/30"
                      >
                        Confirm Dismiss?
                      </button>
                      <button
                        onClick={() => setConfirmDismissId(null)}
                        className="px-1.5 py-0.5 text-[11px] rounded bg-bg3 text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      id={`dismiss-btn-${task.id}`}
                      onClick={() => setConfirmDismissId(task.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-bg3 text-muted hover:text-text transition-colors"
                    >
                      <X size={10} /> Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Show completed toggle */}
      {!compact && (
        <button
          id="toggle-completed-calls"
          onClick={() => setShowCompleted(v => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted hover:text-text transition-colors py-1"
        >
          {showCompleted ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showCompleted ? 'Hide' : 'Show'} completed calls
          {completedTasks.length > 0 && showCompleted && (
            <span className="text-[10px] text-muted/60">({completedTasks.length})</span>
          )}
        </button>
      )}

      {showCompleted && completedTasks.length > 0 && (
        <div className="space-y-1.5 opacity-60">
          {completedTasks.slice(0, 10).map(task => (
            <div key={task.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg3/20 border border-border/40">
              <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted truncate">{task.patient_name} ({task.patient_phone})</p>
                {task.call_outcome && <p className="text-[10px] text-muted/60">{task.call_outcome}</p>}
              </div>
              <span className="text-[10px] text-muted/50">{formatDate(task.updated_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}