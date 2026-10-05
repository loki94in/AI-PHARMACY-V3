import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users, Repeat2, Phone, MessageSquare, ClipboardList,
  Globe, Bell, MessageCircle,
  ListOrdered,
} from 'lucide-react';
import { api } from '../../services/api';
import { CallTaskBoard, CallTaskBadge } from '../../components/CallTaskBoard';
import { IncompleteOrders24hCard } from '../../components/IncompleteOrders24hCard';
import { EnquiriesSection } from './EnquiriesSection';
import { RefillsSection } from './RefillsSection';
import { SpecialOrdersSection } from './SpecialOrdersSection';
import { CustomerCreditSection } from './CustomerCreditSection';
import { DistributorMessagesSection } from './DistributorMessagesSection';
import { WhatsAppSection } from './WhatsAppSection';
import { DistributorPrioritySection } from './DistributorPrioritySection';

const PortalAccountsManager = React.lazy(() => import('../../components/PortalAccountsManager').then(m => ({ default: m.PortalAccountsManager })));

const TABS = [
  { key: 'refills', label: 'Refills', icon: <Repeat2 size={15} /> },
  { key: 'distributor_priority', label: 'Distributor Priority', icon: <ListOrdered size={15} /> },
  { key: 'call_tasks', label: 'Call Reminders', icon: <Phone size={15} /> },
  { key: 'enquiries', label: 'Enquiries', icon: <MessageSquare size={15} /> },
  { key: 'special_orders', label: 'Special Requests', icon: <ClipboardList size={15} /> },
  { key: 'credit', label: 'Customer Credit', icon: <Users size={15} /> },
  { key: 'portal_logins', label: 'Web Logins & PINs', icon: <Globe size={15} /> },
  { key: 'messages', label: 'Distributor Messages', icon: <Bell size={15} /> },
  { key: 'whatsapp', label: 'WhatsApp Business', icon: <MessageCircle size={15} /> },
];

const CRM: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'refills';

  const setTab = (key: string) => setSearchParams({ tab: key });

  useEffect(() => {
    // Proactively pre-warm WhatsApp client for instant customer message & payment reminder dispatch
    api.prewarmWhatsApp().catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Compact Unified Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-3 px-4 shadow-sm shrink-0">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Users size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-text leading-none">CRM &amp; Customer Hub</h1>
            <p className="text-[11px] text-muted mt-0.5">Patient refills, special shortage orders, customer credit &amp; WhatsApp</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg2 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-xs rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                }`}
              >
                <span className={isActive ? 'text-primary' : 'text-muted'}>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.key === 'call_tasks' && <CallTaskBadge />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 24-Hour Fulfillment Watch Briefing Card */}
      <IncompleteOrders24hCard />

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'refills' && <RefillsSection />}
        {activeTab === 'distributor_priority' && <DistributorPrioritySection />}
        {activeTab === 'call_tasks' && (
          <div className="p-4 h-full overflow-y-auto bg-bg2 rounded-2xl border border-border">
            <CallTaskBoard />
          </div>
        )}
        {activeTab === 'enquiries' && <EnquiriesSection />}
        {activeTab === 'special_orders' && <SpecialOrdersSection />}
        {activeTab === 'credit' && <CustomerCreditSection />}
        {activeTab === 'portal_logins' && (
          <React.Suspense fallback={<div className="p-8 text-center text-muted">Loading Portal Accounts...</div>}>
            <PortalAccountsManager />
          </React.Suspense>
        )}
        {activeTab === 'messages' && <DistributorMessagesSection />}
        {activeTab === 'whatsapp' && <WhatsAppSection />}
      </div>
    </div>
  );
};

export default CRM;
