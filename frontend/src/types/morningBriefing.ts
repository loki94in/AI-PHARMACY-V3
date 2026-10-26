/**
 * Types for the Morning Briefing & Reorder Hub Flow
 */

export interface BriefingItem {
  id: string | number;
  source_type: 'refill' | 'special_order' | 'online_order' | 'call_task';
  reference_id: string;
  customer_name: string;
  customer_phone: string;
  phone_status: 'usable' | 'missing' | 'invalid';
  channel_status: 'whatsapp_available' | 'whatsapp_unavailable' | 'no_usable_phone';
  title: string;
  subtitle: string;
  status: string;
  category_badge: string;
  priority: 'urgent' | 'high' | 'normal';
  details: Record<string, any>;
  created_at: string;
}

export interface MorningBriefingData {
  success: boolean;
  refills: {
    total: number;
    pending: number;
    partially_fulfilled: number;
    action_required: number;
    items: BriefingItem[];
  };
  special_orders: {
    total: number;
    customer_requests: number;
    procurement_needed: number;
    supplier_follow_up: number;
    items: BriefingItem[];
  };
  online_orders: {
    total: number;
    pending: number;
    awaiting_stock: number;
    not_delivered: number;
    items: BriefingItem[];
  };
  call_tasks: {
    total: number;
    pending_call: number;
    called: number;
    follow_up_required: number;
    items: BriefingItem[];
  };
  contact_review: {
    total: number;
    items: BriefingItem[];
  };
  generated_at: string;
}
