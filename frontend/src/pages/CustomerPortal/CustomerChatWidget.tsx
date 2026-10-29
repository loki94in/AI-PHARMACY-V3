import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, Bot, User, Check, AlertCircle, Sparkles, RefreshCw, Clock, ShieldAlert } from 'lucide-react';

interface ChatTurn {
  id?: number;
  sender: 'customer' | 'assistant' | 'pharmacist' | 'system';
  messageText: string;
  toolCalls?: Record<string, any>[];
  createdAt?: string;
}

interface CustomerChatWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  phone?: string;
  customerId?: number | null;
  customerName?: string;
  token?: string;
}

export function CustomerChatWidget({
  isOpen,
  onClose,
  phone = '',
  customerId = null,
  customerName = 'Customer',
  token = ''
}: CustomerChatWidgetProps) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<{ type: string; summary: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, phone]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = async () => {
    const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
    if (!cleanPhone && !token) return;

    try {
      const url = `/api/customer-portal/customer/chat/history?phone=${encodeURIComponent(cleanPhone)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.turns && Array.isArray(data.turns)) {
          setMessages(data.turns);
        }
        if (data.session?.contextData?.pendingProposal) {
          setPendingProposal(data.session.contextData.pendingProposal);
        } else {
          setPendingProposal(null);
        }
      }
    } catch (err) {
      console.warn('Failed to load chat history:', err);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const msg = (textToSend || inputText).trim();
    if (!msg || loading) return;

    const userTurn: ChatTurn = {
      sender: 'customer',
      messageText: msg,
      createdAt: new Date().toISOString()
    };

    setMessages(prev => [...prev, userTurn]);
    if (!textToSend) setInputText('');
    setLoading(true);

    try {
      const res = await fetch('/api/customer-portal/customer/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          phone: (phone || '').replace(/\D/g, '').slice(-10),
          customer_id: customerId,
          token,
          message: msg
        })
      });

      if (res.ok) {
        const data = await res.json();
        const assistantTurn: ChatTurn = {
          sender: 'assistant',
          messageText: data.replyText || 'Thank you for your message.',
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantTurn]);

        if (data.proposedAction) {
          setPendingProposal(data.proposedAction);
        } else {
          setPendingProposal(null);
        }
      } else {
        const errTurn: ChatTurn = {
          sender: 'system',
          messageText: 'Could not connect to the pharmacy assistant. Please try again or call our store.',
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, errTurn]);
      }
    } catch (err) {
      const errTurn: ChatTurn = {
        sender: 'system',
        messageText: 'Network connection issue. Please check your connection.',
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errTurn]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 sm:right-6 sm:bottom-6 sm:inset-y-auto sm:w-[420px] sm:h-[620px] bg-bg2 border border-border shadow-2xl rounded-none sm:rounded-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-bg border-b border-border p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-text">Pharmacy AI Assistant</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
            </div>
            <p className="text-[11px] text-muted">Context-aware · Refills · Availability · Timings</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg hover:bg-bg3 flex items-center justify-center text-muted hover:text-text transition-colors"
          title="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-bg/50">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-muted">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Hello {customerName}!</p>
              <p className="text-xs text-muted mt-1 max-w-[240px]">
                I can help check your medicine refills, look up store hours, or check catalog stock and prices.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center mt-2">
              <button
                onClick={() => handleSendMessage('Do I have any refills due?')}
                className="text-[11px] px-2.5 py-1 rounded-full bg-bg border border-border hover:border-primary/40 text-text transition-colors"
              >
                💊 Check refills
              </button>
              <button
                onClick={() => handleSendMessage('What are your store hours?')}
                className="text-[11px] px-2.5 py-1 rounded-full bg-bg border border-border hover:border-primary/40 text-text transition-colors"
              >
                🕒 Store timings
              </button>
              <button
                onClick={() => handleSendMessage('Connect me to a pharmacist')}
                className="text-[11px] px-2.5 py-1 rounded-full bg-bg border border-border hover:border-primary/40 text-text transition-colors"
              >
                👩‍⚕️ Talk to pharmacist
              </button>
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isCustomer = m.sender === 'customer';
            const isSystem = m.sender === 'system';

            if (isSystem) {
              return (
                <div key={idx} className="flex justify-center my-2">
                  <span className="text-[11px] text-muted bg-bg border border-border rounded-lg px-2.5 py-1">
                    {m.messageText}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={idx}
                className={`flex gap-2.5 ${isCustomer ? 'justify-end' : 'justify-start'}`}
              >
                {!isCustomer && (
                  <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                    isCustomer
                      ? 'bg-primary text-white rounded-br-xs shadow-xs'
                      : 'bg-bg border border-border text-text rounded-bl-xs shadow-xs whitespace-pre-line'
                  }`}
                >
                  {m.messageText}
                </div>
                {isCustomer && (
                  <div className="w-7 h-7 rounded-lg bg-bg border border-border text-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Rule 6 Confirmation Action Card */}
        {pendingProposal && (
          <div className="bg-bg border border-primary/30 rounded-xl p-3 shadow-xs space-y-2 mt-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Check className="w-3.5 h-3.5" />
              <span>Confirmation Requested:</span>
            </div>
            <p className="text-xs text-text">{pendingProposal.summary}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleSendMessage('Yes, confirm')}
                disabled={loading}
                className="flex-1 py-1.5 px-3 rounded-lg bg-primary text-white font-semibold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Yes, Confirm</span>
              </button>
              <button
                onClick={() => handleSendMessage('No, cancel')}
                disabled={loading}
                className="py-1.5 px-3 rounded-lg bg-bg border border-border text-muted hover:text-text text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex gap-2.5 items-center text-muted text-xs">
            <div className="w-7 h-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-bg border border-border rounded-xl px-3 py-2 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field */}
      <div className="bg-bg border-t border-border p-3">
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex gap-2 items-center"
        >
          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-bg2 border border-border rounded-xl px-3.5 py-2 text-xs text-text placeholder:text-muted focus:outline-hidden focus:border-primary transition-colors"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!inputText.trim() || loading}
            className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-muted text-center mt-1.5">
          Emergency? Dial <span className="text-red-500 font-bold">108</span> or <span className="text-red-500 font-bold">112</span> immediately.
        </p>
      </div>
    </div>
  );
}

