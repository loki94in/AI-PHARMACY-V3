/**
 * Unified Pharmacy RAG Service
 * Combines retrieved SOPs/manuals from KnowledgeBaseService with live authoritative
 * SQLite database facts from pharmacyToolRegistry & pharmacyKnowledgeRetriever into
 * one structured, validated evidence bundle for Qwen synthesis.
 */

import { knowledgeBaseService, type KnowledgeSearchResult } from './knowledgeBaseService.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import { dbManager } from '../../database/connection.js';
import { toLocalSqlDateTime } from '../../utils/localTime.js';

export interface RagSourceCitation {
  sourceTitle: string;
  section?: string;
  version?: string;
  sourceType: 'sop' | 'manual' | 'guideline' | 'live_db' | 'policy';
  timestamp: string;
}

export interface PharmacyRagEvidencePackage {
  query: string;
  role: 'all' | 'staff' | 'owner' | 'customer' | 'pharmacist';
  storeId: number;
  documents: Array<{
    documentId: string;
    title: string;
    section: string;
    version: string;
    content: string;
  }>;
  liveFacts: Record<string, any>;
  citations: RagSourceCitation[];
  evidenceFound: boolean;
}

export class PharmacyRagService {
  private static instance: PharmacyRagService;

  public static getInstance(): PharmacyRagService {
    if (!PharmacyRagService.instance) {
      PharmacyRagService.instance = new PharmacyRagService();
    }
    return PharmacyRagService.instance;
  }

  /**
   * Builds an evidence bundle combining full-text knowledge documents and live SQLite records.
   */
  public async assembleEvidence(
    query: string,
    role: 'all' | 'staff' | 'owner' | 'customer' | 'pharmacist' = 'staff',
    contextFacts: Record<string, any> = {},
    dbInstance?: any
  ): Promise<PharmacyRagEvidencePackage> {
    const db = dbInstance || (await dbManager.getConnection());
    const nowIso = toLocalSqlDateTime();

    // 1. Retrieve procedural knowledge & SOP documents
    const searchDocs: KnowledgeSearchResult[] = await knowledgeBaseService.searchKnowledge(
      query,
      { role, approvedOnly: true, limit: 3 },
      db
    );

    const documents = searchDocs.map(d => ({
      documentId: d.documentId,
      title: d.title,
      section: d.heading || 'General',
      version: d.version || '1.0',
      content: d.content
    }));

    const citations: RagSourceCitation[] = searchDocs.map(d => ({
      sourceTitle: d.title,
      section: d.heading || undefined,
      version: d.version || '1.0',
      sourceType: (d.sourceType as any) || 'sop',
      timestamp: nowIso
    }));

    // 2. Authoritative live facts from context or live retrieval
    const liveFacts: Record<string, any> = { ...contextFacts };

    // If contextFacts contain live medicine or shop facts, attach citations
    if (Object.keys(contextFacts).length > 0) {
      citations.push({
        sourceTitle: 'Live Pharmacy Database',
        section: 'Authoritative Inventory & Ledger',
        sourceType: 'live_db',
        timestamp: nowIso
      });
    }

    const evidenceFound = documents.length > 0 || Object.keys(liveFacts).length > 0;

    return {
      query,
      role,
      storeId: 1,
      documents,
      liveFacts,
      citations,
      evidenceFound
    };
  }

  /**
   * Helper to format RAG evidence into concise prompt text for Qwen
   */
  public formatEvidenceForPrompt(evidence: PharmacyRagEvidencePackage): string {
    const parts: string[] = [];

    if (evidence.documents.length > 0) {
      parts.push('=== Procedural SOPs & Guidelines ===');
      evidence.documents.forEach((d, i) => {
        parts.push(`[${i + 1}] ${d.title} (v${d.version}, Section: ${d.section}):\n${d.content}\n`);
      });
    }

    if (Object.keys(evidence.liveFacts).length > 0) {
      parts.push('=== Verified Live Database Facts ===');
      parts.push(JSON.stringify(evidence.liveFacts, null, 2));
    }

    return parts.join('\n\n');
  }
}

export const pharmacyRagService = PharmacyRagService.getInstance();
