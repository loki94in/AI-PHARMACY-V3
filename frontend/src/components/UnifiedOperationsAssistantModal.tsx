import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Send,
  Bot,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Phone,
  MessageSquare,
  FileText,
  Package,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check,
  Ban
} from 'lucide-react';
import { apiClient } from '../services/api';
import { toastEvent } from '../services/events';

interface ProposedAction {
  id: string;
  actionType: string;
  description: string;
  payload: Record<string, any>;
  requiresConfirmation: boolean;
  status: 'PENDING_CONFIRMATION' | 'EXECUTED' | 'CANCELLED' | 'FAILED';
  createdAt: string;
}

interface AssistantCardItem {
  id: string | number;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: 'green' | 'amber' | 'red' | 'blue' | 'gray';
  details?: Record<string, any>;
  actionUrl?: string;
}

interface AssistantMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  actionType?: string;
  cards?: AssistantCardItem[];
  proposedAction?: ProposedAction;
  suggestedFollowUps?: string[];
  timestamp: string;
}

interface UnifiedOperationsAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_SUGGESTIONS = [
  'Show due refills',
  'List pending call tasks',
  'What WhatsApp messages need replies?',
  'Check customer enquiries',
  'Review recent OCR scans',
  'Stock check for Paracetamol 650'
];

export const UnifiedOperationsAssistantModal: React.FC<UnifiedOperationsAssistantModalProps> = ({
  isOpen,
  onClose
}) => {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Namaste! I am your Unified Pharmacy Operations Assistant. I can assist with refills, call tasks, enquiries, WhatsApp communications, OCR checks, and inventory lookup in English, Hindi, Marathi, or Hinglish. How can I help you today?',
      suggestedFollowUps: QUICK_SUGGESTIONS,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => `staff-${Date.now()}`);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<{ healthy: boolean; localAi: boolean } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Fetch assistant status
      apiClient.get('/assistant/status')
        .then((res: any) => {
          if (res.data?.success) {
            setStatusInfo({
              healthy: !!res.data.data.localAiServerHealthy,
              localAi: !!res.data.data.localAiConfigured
            });
          }
        })
        .catch(() => setStatusInfo(null));
    }
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSendMessage = useCallback(async (msgText?: string) => {
    const textToSend = (msgText || inputMessage).trim();
    if (!textToSend || isLoading) return;

    const userMsg: AssistantMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!msgText) setInputMessage('');
    setIsLoading(true);

    try {
      const res = await apiClient.post('/assistant/chat', {
        message: textToSend,
        sessionId,
        role: 'staff'
      });

      if (res.data?.success && res.data.data) {
        const d = res.data.data;
        const assistantMsg: AssistantMessage = {
          id: `asst-${Date.now()}`,
          sender: 'assistant',
          text: d.reply,
          actionType: d.actionType,
          cards: d.cards,
          proposedAction: d.proposedAction,
          suggestedFollowUps: d.suggestedFollowUps,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        throw new Error(res.data?.error || 'Invalid server response');
      }
    } catch (err: any) {
      const errorMsg: AssistantMessage = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: `Sorry, an error occurred while processing your request: ${err.message || 'Server error'}. Please try again.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [inputMessage, isLoading, sessionId]);

  const handleConfirmAction = async (proposalId: string) => {
    setConfirmingId(proposalId);
    try {
      const res = await apiClient.post('/assistant/confirm', {
        proposalId,
        sessionId
      });

      if (res.data?.success) {
        setMessages(prev =>
          prev.map(m => {
            if (m.proposedAction?.id === proposalId) {
              return {
                ...m,
                proposedAction: { ...m.proposedAction, status: 'EXECUTED' }
              };
            }
            return m;
          })
        );

        // Add execution feedback
        const confirmMsg: AssistantMessage = {
          id: `exec-${Date.now()}`,
          sender: 'assistant',
          text: `✅ ${res.data.message || 'Action executed successfully.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, confirmMsg]);
      } else {
        throw new Error(res.data?.error || 'Execution failed');
      }
    } catch (err: any) {
      toastEvent.trigger(`Action confirmation failed: ${err?.message || 'Error'}`, 'error');
    } finally {
      setConfirmingId(null);
    }
  };

  const handleCancelAction = async (proposalId: string) => {
    try {
      await apiClient.post('/assistant/cancel', {
        proposalId,
        sessionId
      });

      setMessages(prev =>
        prev.map(m => {
          if (m.proposedAction?.id === proposalId) {
            return {
              ...m,
              proposedAction: { ...m.proposedAction, status: 'CANCELLED' }
            };
          }
          return m;
        })
      );

      const cancelMsg: AssistantMessage = {
        id: `canc-${Date.now()}`,
        sender: 'assistant',
        text: 'Action was cancelled. No changes were made to pharmacy records.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, cancelMsg]);
    } catch (err: any) {
      console.warn('Cancel error:', err);
    }
  };

  const handleClearContext = async () => {
    try {
      await apiClient.post('/assistant/clear-session', { sessionId });
      setMessages([
        {
          id: `welcome-${Date.now()}`,
          sender: 'assistant',
          text: 'Conversation history reset. All operational services are ready. How can I assist you?',
          suggestedFollowUps: QUICK_SUGGESTIONS,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } catch (err) {
      console.warn('Failed to clear session:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-none animate-in fade-in duration-150">
      <div className="bg-bg2 border border-border rounded-2xl w-full max-w-3xl h-[85vh] max-h-[780px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-16 px-5 border-b border-border bg-bg flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Bot size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text">Pharmacy Operations Assistant</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/15 text-primary border border-primary/20 uppercase tracking-wider">
                  Unified AI
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <ShieldCheck size={12} className="text-emerald-500" />
                  Grounded & Safe
                </span>
                <span>•</span>
                <span>Role: Staff Operations</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusInfo?.healthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {statusInfo?.healthy ? 'Local Engine Online' : 'Standard Pipeline'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearContext}
              title="Reset conversation memory"
              className="px-2.5 py-1.5 rounded-xl border border-border text-muted hover:text-text hover:bg-bg3 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw size={13} />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assistant"
              className="p-2 rounded-xl text-muted hover:text-text hover:bg-bg3 border border-transparent hover:border-border transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-bg2">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-1.5 mb-1 text-[11px] text-muted px-1">
                {msg.sender === 'assistant' ? (
                  <>
                    <Sparkles size={11} className="text-primary" />
                    <span className="font-semibold text-text">Assistant</span>
                  </>
                ) : (
                  <span className="font-semibold text-text">You</span>
                )}
                <span>•</span>
                <span>{msg.timestamp}</span>
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-primary text-white rounded-tr-none shadow-sm'
                    : 'bg-bg border border-border text-text rounded-tl-none shadow-xs'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.text}</div>

                {/* Structured Cards (if any) */}
                {msg.cards && msg.cards.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border/60">
                    {msg.cards.map(card => {
                      const badgeBg =
                        card.badgeColor === 'green'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : card.badgeColor === 'red'
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20'
                          : card.badgeColor === 'amber'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20'
                          : card.badgeColor === 'blue'
                          ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20'
                          : 'bg-bg3 text-muted border-border';

                      return (
                        <div
                          key={card.id}
                          className="p-2.5 rounded-xl bg-bg2 border border-border/80 flex flex-col justify-between text-xs hover:border-primary/40 transition-colors"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <span className="font-bold text-text truncate">{card.title}</span>
                              {card.badge && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeBg}`}>
                                  {card.badge}
                                </span>
                              )}
                            </div>
                            {card.subtitle && (
                              <p className="text-muted text-[11px] mb-1.5 leading-snug">{card.subtitle}</p>
                            )}
                          </div>
                          {card.actionUrl && (
                            <a
                              href={card.actionUrl}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline mt-1"
                            >
                              Open record <ArrowRight size={10} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Consequential Action Proposal Card (Rule 6 Gate) */}
                {msg.proposedAction && (
                  <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider text-[10px]">
                        <AlertCircle size={13} />
                        Confirmation Required (Rule 6)
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 font-semibold text-amber-600 dark:text-amber-400">
                        {msg.proposedAction.status}
                      </span>
                    </div>
                    <p className="font-semibold text-text mb-2.5">{msg.proposedAction.description}</p>

                    {msg.proposedAction.status === 'PENDING_CONFIRMATION' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={confirmingId === msg.proposedAction.id}
                          onClick={() => handleConfirmAction(msg.proposedAction!.id)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {confirmingId === msg.proposedAction.id ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          Approve & Execute
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelAction(msg.proposedAction!.id)}
                          className="px-3 py-1.5 rounded-lg bg-bg border border-border text-muted hover:text-text hover:bg-bg3 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Ban size={12} />
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Suggested Follow-Ups */}
                {msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-wrap gap-1.5">
                    {msg.suggestedFollowUps.map((suggestion, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => handleSendMessage(suggestion)}
                        className="px-2.5 py-1 rounded-full bg-bg2 hover:bg-bg3 border border-border text-[11px] text-muted hover:text-text transition-all cursor-pointer text-left"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5 mb-1 text-[11px] text-muted px-1">
                <Sparkles size={11} className="text-primary" />
                <span className="font-semibold text-text">Assistant</span>
              </div>
              <div className="bg-bg border border-border rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2 text-xs text-muted">
                <RefreshCw size={13} className="animate-spin text-primary" />
                <span>Consulting verified pharmacy records & local model...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 sm:p-4 bg-bg border-t border-border shrink-0">
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              placeholder="Type an operations request in English, हिंदी, मराठी, Hinglish..."
              className="flex-1 bg-bg2 border border-border focus:border-primary rounded-xl px-4 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || isLoading}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-sm flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Send size={15} />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
          <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-muted">
            <span>Press Enter to send • Offline Qwen3-1.7B engine</span>
            <span className="hidden sm:inline">ESC to close • Ctrl+Space to toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
};
export default UnifiedOperationsAssistantModal;
