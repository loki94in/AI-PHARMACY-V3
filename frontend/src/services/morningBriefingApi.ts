import { apiClient } from './api';
import type { MorningBriefingData, BriefingItem } from '../types/morningBriefing';

export const morningBriefingApi = {
  async getMorningBriefing(): Promise<MorningBriefingData> {
    const res = await apiClient.get<MorningBriefingData>('/morning-briefing');
    return res.data;
  },

  async routeChannel(channel: 'whatsapp' | 'call_task', item: BriefingItem, customMessage?: string) {
    const res = await apiClient.post('/morning-briefing/route-channel', {
      channel,
      item: {
        ...item,
        message: customMessage
      }
    });
    return res.data;
  },

  async updateContact(data: {
    customer_name?: string;
    old_phone?: string;
    new_phone: string;
    reference_id?: string;
    source_type?: string;
  }) {
    const res = await apiClient.post('/morning-briefing/update-contact', data);
    return res.data;
  },

  async advanceCallOutcome(
    taskId: number,
    outcome: 'called' | 'customer_responded' | 'no_answer' | 'further_action_needed',
    payload?: {
      outcome_notes?: string;
      reschedule_date?: string;
      priority?: 'urgent' | 'high' | 'normal';
    }
  ) {
    const res = await apiClient.post('/morning-briefing/call-outcome', {
      task_id: taskId,
      outcome,
      ...(payload || {})
    });
    return res.data;
  }
};
