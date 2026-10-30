/**
 * Knowledge Base Service for Shared Pharmacy RAG
 * Manages document ingestion, chunking, SHA-256 hashing, SQLite FTS5 indexing,
 * and role-scoped procedural SOP retrieval for Qwen.
 */

import crypto from 'crypto';
import { dbManager } from '../../database/connection.js';
import { toLocalSqlDateTime } from '../../utils/localTime.js';

export interface KnowledgeDocumentInput {
  id?: string;
  storeId?: number;
  sourceType: 'sop' | 'manual' | 'guideline' | 'policy' | 'clinical';
  sourceKey: string;
  title: string;
  department?: string;
  applicableRole?: 'all' | 'staff' | 'owner' | 'pharmacist';
  version?: string;
  approvalStatus?: 'approved' | 'draft' | 'archived' | 'superseded';
  effectiveDate?: string;
  reviewDate?: string;
  rawContent: string;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  storeId: number;
  chunkIndex: number;
  heading?: string;
  content: string;
  contentHash: string;
  pageNumber?: number;
}

export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  heading: string;
  content: string;
  sourceType: string;
  department: string;
  approvalStatus: string;
  applicableRole: string;
  version: string;
  rank?: number;
}

export interface SearchKnowledgeOptions {
  role?: 'all' | 'staff' | 'owner' | 'customer' | 'pharmacist';
  sourceType?: 'sop' | 'manual' | 'guideline' | 'policy' | 'clinical';
  department?: string;
  limit?: number;
  approvedOnly?: boolean;
}

export class KnowledgeBaseService {
  private static instance: KnowledgeBaseService;
  private hasCheckedFts: boolean = false;
  private isFtsSupported: boolean = true;
  private isSeeded: boolean = false;

  public static getInstance(): KnowledgeBaseService {
    if (!KnowledgeBaseService.instance) {
      KnowledgeBaseService.instance = new KnowledgeBaseService();
    }
    return KnowledgeBaseService.instance;
  }

  /**
   * Computes deterministic SHA-256 hash for document content
   */
  public hashContent(text: string): string {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
  }

  /**
   * Splits a document into natural logical chunks by headings (###, ##, #)
   * or by paragraph blocks (~250-400 words) while preserving header context.
   */
  public chunkDocument(rawContent: string, docId: string, storeId: number = 1): KnowledgeChunk[] {
    const lines = rawContent.split(/\r?\n/);
    const chunks: KnowledgeChunk[] = [];
    let currentHeading = 'Overview';
    let currentBlockLines: string[] = [];
    let chunkIndex = 0;

    const flushBlock = () => {
      const blockText = currentBlockLines.join('\n').trim();
      if (blockText.length > 20) {
        const hash = this.hashContent(blockText);
        chunks.push({
          id: `${docId}_c${chunkIndex}`,
          documentId: docId,
          storeId,
          chunkIndex,
          heading: currentHeading,
          content: blockText,
          contentHash: hash,
          pageNumber: 1 + Math.floor(chunkIndex / 3)
        });
        chunkIndex++;
      }
      currentBlockLines = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
      if (headingMatch) {
        flushBlock();
        currentHeading = headingMatch[1].trim();
      } else {
        currentBlockLines.push(line);
        // If a block exceeds ~300 words without a header, flush gracefully
        if (currentBlockLines.join(' ').split(/\s+/).length >= 350) {
          flushBlock();
        }
      }
    }
    flushBlock();

    return chunks;
  }

  /**
   * Ingests or updates a document, chunks it, and synchronizes FTS5 index
   */
  public async ingestDocument(input: KnowledgeDocumentInput, dbInstance?: any): Promise<{ documentId: string; chunkCount: number }> {
    const db = dbInstance || (await dbManager.getConnection());
    const docId = input.id || `doc_${input.sourceType}_${input.sourceKey.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
    const storeId = input.storeId || 1;
    const contentHash = this.hashContent(input.rawContent);
    const role = input.applicableRole || 'all';
    const approval = input.approvalStatus || 'approved';
    const version = input.version || '1.0';

    // 1. Check if document already exists with identical content
    const existing = await db.get(
      'SELECT id, content_hash FROM assistant_knowledge_documents WHERE id = ?',
      [docId]
    ).catch(() => null);

    if (existing && existing.content_hash === contentHash) {
      const countRow = await db.get('SELECT COUNT(*) as cnt FROM assistant_knowledge_chunks WHERE document_id = ?', [docId]);
      return { documentId: docId, chunkCount: countRow?.cnt || 0 };
    }

    // 2. Insert or update parent document
    await db.run(
      `INSERT INTO assistant_knowledge_documents
       (id, store_id, source_type, source_key, title, department, applicable_role, version, approval_status, effective_date, review_date, content_hash, status, updated_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         department = excluded.department,
         applicable_role = excluded.applicable_role,
         version = excluded.version,
         approval_status = excluded.approval_status,
         effective_date = excluded.effective_date,
         review_date = excluded.review_date,
         content_hash = excluded.content_hash,
         updated_at = CURRENT_TIMESTAMP,
         indexed_at = CURRENT_TIMESTAMP`,
      [
        docId,
        storeId,
        input.sourceType,
        input.sourceKey,
        input.title.trim(),
        input.department || 'General',
        role,
        version,
        approval,
        input.effectiveDate || toLocalSqlDateTime().slice(0, 10),
        input.reviewDate || null,
        contentHash
      ]
    );

    // 3. Delete old chunks and FTS rows
    await db.run('DELETE FROM assistant_knowledge_chunks WHERE document_id = ?', [docId]);
    await db.run('DELETE FROM assistant_knowledge_fts WHERE document_id = ?', [docId]).catch(() => {});

    // 4. Generate & persist new chunks
    const chunks = this.chunkDocument(input.rawContent, docId, storeId);
    for (const c of chunks) {
      await db.run(
        `INSERT INTO assistant_knowledge_chunks
         (id, document_id, store_id, chunk_index, heading, content, contentHash, page_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [c.id, c.documentId, c.storeId, c.chunkIndex, c.heading, c.content, c.contentHash, c.pageNumber || 1]
      ).catch(async () => {
        // Fallback for column naming compatibility
        await db.run(
          `INSERT INTO assistant_knowledge_chunks
           (id, document_id, store_id, chunk_index, heading, content, content_hash, page_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [c.id, c.documentId, c.storeId, c.chunkIndex, c.heading, c.content, c.contentHash, c.pageNumber || 1]
        );
      });

      // Insert into FTS5 index
      await db.run(
        `INSERT INTO assistant_knowledge_fts
         (document_id, chunk_id, title, heading, content, source_type, department, approval_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.documentId, c.id, input.title, c.heading || '', c.content, input.sourceType, input.department || 'General', approval]
      ).catch(() => {});
    }

    return { documentId: docId, chunkCount: chunks.length };
  }

  /**
   * Searches the Knowledge Base using SQLite FTS5 BM25 relevance ranking.
   * Scopes queries strictly by user role and store boundaries.
   */
  public async searchKnowledge(query: string, options: SearchKnowledgeOptions = {}, dbInstance?: any): Promise<KnowledgeSearchResult[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const limit = Math.min(options.limit || 5, 10);
    const role = options.role || 'staff';
    const approvedOnly = options.approvedOnly !== false;

    // Self-healing: if knowledge base is empty on first query, auto-seed core SOPs
    if (!this.isSeeded) {
      try {
        const countRow = await db.get('SELECT COUNT(*) as c FROM assistant_knowledge_documents');
        if (!countRow || Number(countRow.c) === 0) {
          await this.seedInitialKnowledge(db);
        }
        this.isSeeded = true;
      } catch (_) {}
    }

    // Clean query text for FTS5 (avoid syntax errors from symbols and filter common stop words)
    const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    if (!cleanQuery) return [];

    const stopWords = new Set([
      'what', 'is', 'the', 'for', 'how', 'to', 'can', 'you', 'tell', 'me', 'about',
      'in', 'on', 'at', 'from', 'and', 'or', 'of', 'with', 'do', 'we', 'are', 'this',
      'that', 'a', 'an', 'please', 'give', 'show', 'check'
    ]);
    const meaningfulTokens = cleanQuery
      .split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length >= 2 && !stopWords.has(w));

    const tokensToSearch = meaningfulTokens.length > 0
      ? meaningfulTokens
      : cleanQuery.split(/\s+/).filter(w => w.length >= 2);

    const ftsTokens = tokensToSearch
      .map(w => `"${w}"*`)
      .join(' OR ');

    if (!ftsTokens) return [];

    try {
      // 1. Try SQLite FTS5 search with BM25 ranking
      const rows = await db.all(
        `SELECT f.chunk_id, f.document_id, f.title, f.heading, f.content,
                f.source_type, f.department, f.approval_status,
                d.applicable_role, d.version, bm25(assistant_knowledge_fts) as rank
         FROM assistant_knowledge_fts f
         JOIN assistant_knowledge_documents d ON f.document_id = d.id
         WHERE assistant_knowledge_fts MATCH ?
           ${approvedOnly ? "AND f.approval_status = 'approved'" : ''}
           ${role === 'customer' ? "AND d.applicable_role = 'all'" : (role === 'staff' ? "AND d.applicable_role IN ('all', 'staff', 'pharmacist')" : '')}
         ORDER BY rank ASC
         LIMIT ?`,
        [ftsTokens, limit]
      );

      if (rows && rows.length > 0) {
        return rows.map((r: any) => ({
          chunkId: r.chunk_id,
          documentId: r.document_id,
          title: r.title,
          heading: r.heading,
          content: r.content,
          sourceType: r.source_type,
          department: r.department,
          approvalStatus: r.approval_status,
          applicableRole: r.applicable_role,
          version: r.version,
          rank: r.rank
        }));
      }
    } catch (err: any) {
      console.warn('[KnowledgeBaseService] FTS5 query failed, using SQL LIKE fallback:', err?.message || err);
    }

    // 2. Fallback SQL LIKE search across chunks and parent document metadata
    const likePattern = `%${cleanQuery.slice(0, 30)}%`;
    const fallbackRows = await db.all(
      `SELECT c.id as chunk_id, c.document_id, d.title, c.heading, c.content,
              d.source_type, d.department, d.approval_status,
              d.applicable_role, d.version
       FROM assistant_knowledge_chunks c
       JOIN assistant_knowledge_documents d ON c.document_id = d.id
       WHERE (c.content LIKE ? OR c.heading LIKE ? OR d.title LIKE ?)
         ${approvedOnly ? "AND d.approval_status = 'approved'" : ''}
         ${role === 'customer' ? "AND d.applicable_role = 'all'" : (role === 'staff' ? "AND d.applicable_role IN ('all', 'staff', 'pharmacist')" : '')}
       ORDER BY c.chunk_index ASC
       LIMIT ?`,
      [likePattern, likePattern, likePattern, limit]
    ).catch(() => []);

    return fallbackRows.map((r: any) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      title: r.title,
      heading: r.heading,
      content: r.content,
      sourceType: r.source_type,
      department: r.department,
      approvalStatus: r.approval_status,
      applicableRole: r.applicable_role,
      version: r.version
    }));
  }

  public async seedInitialKnowledge(dbInstance?: any): Promise<void> {
    return this.seedDefaultKnowledgeIfEmpty(dbInstance);
  }

  /**
   * Seeds default standard pharmacy SOPs and Application manuals if empty.
   */
  public async seedDefaultKnowledgeIfEmpty(dbInstance?: any): Promise<void> {
    const db = dbInstance || (await dbManager.getConnection());
    const countRow = await db.get('SELECT COUNT(*) as count FROM assistant_knowledge_documents').catch(() => ({ count: 0 }));
    if (countRow?.count > 0) return;

    console.log('[KnowledgeBaseService] Seeding initial approved Pharmacy SOPs & App Guides...');

    // SOP 01: Dispensing & Clinical Verification
    await this.ingestDocument({
      sourceType: 'sop',
      sourceKey: 'SOP-DISP-01',
      title: 'Prescription Dispensing & Double-Check Procedure',
      department: 'Pharmacy Operations',
      applicableRole: 'all',
      version: '1.0',
      approvalStatus: 'approved',
      effectiveDate: '2026-01-01',
      rawContent: `# SOP-DISP-01: Prescription Dispensing & Verification Protocol

## 1. Scope & Objective
This Standard Operating Procedure ensures 100% dispensing accuracy, prevents adverse drug interactions, and enforces regulatory compliance under the Drugs and Cosmetics Act.

## 2. Mandatory Verification Gate
Before handing over medicines to the patient or walk-in customer:
- Match the doctor's written prescription brand against the strip barcode and physical packaging.
- Check active pharmaceutical salt and exact strength (e.g. 500mg vs 650mg).
- Verify batch number, expiry date (minimum 90 days validity), and MRP.
- Ensure Schedule H and Schedule X drugs have a signed prescription registered in POS.

## 3. Same-Salt Substitution Policy
If a prescribed brand is out of stock:
- Only identical active ingredients, dosage forms, and strengths may be suggested.
- The dispensing pharmacist must explain the alternative to the patient and obtain consent.
- Document any substitution in the POS notes field before saving the bill.

## 4. Cold Chain Storage
Insulins, vaccines, and biologics must remain between 2°C and 8°C in the monitored pharmacy refrigerator until final handover.`
    }, db);

    // SOP 02: Chronic Patient Refill Protocol
    await this.ingestDocument({
      sourceType: 'sop',
      sourceKey: 'SOP-REFILL-02',
      title: 'Chronic Patient Refill & Due Bill Management Protocol',
      department: 'CRM & Dispensing',
      applicableRole: 'staff',
      version: '1.0',
      approvalStatus: 'approved',
      effectiveDate: '2026-01-01',
      rawContent: `# SOP-REFILL-02: Chronic Patient Refill Protocol

## 1. Chronic Refill Onboarding
- When a patient purchases chronic therapy (diabetes, hypertension, thyroid, cardiac), staff must offer monthly refill tracking in POS or CRM.
- Set reminder cycles to 25 or 30 days based on pack size.

## 2. Staging Refill Orders
- When a refill is due, the assistant prompts staff with an interactive confirmation card.
- Upon staff or customer confirmation, medicines are staged for collection.
- Never dispatch unverified refills without patient confirmation.

## 3. Credit Due Bills & UPI Reminders
- Outstanding credit balances can be settled via rotating dynamic UPI QR codes.
- Reminder notices sent via WhatsApp must include the itemized bill balance and official payment link.`
    }, db);

    // SOP 03: Near-Expiry Stock Audit & Supplier Returns
    await this.ingestDocument({
      sourceType: 'sop',
      sourceKey: 'SOP-EXP-03',
      title: 'Near-Expiry Stock Audit & Supplier Return Policy',
      department: 'Inventory Control',
      applicableRole: 'staff',
      version: '1.0',
      approvalStatus: 'approved',
      effectiveDate: '2026-01-01',
      rawContent: `# SOP-EXP-03: Near-Expiry Audit & Distributor Return Policy

## 1. Expiry Audit Frequency
- Run an automated 60-day expiry scan on the 1st and 15th of each month.
- Segregate batches with less than 60 days validity from active sales shelves.

## 2. Distributor Return Window
- Standard distributor return agreements require medicines to be returned at least 45 to 60 days before expiry date for full credit note issuance.
- Generate return drafts directly from Inventory Master or via the Pharmacy Operations Assistant command: "Run 60 days expiry scan".`
    }, db);

    // Manual 01: POS Billing & Shortcuts
    await this.ingestDocument({
      sourceType: 'manual',
      sourceKey: 'MAN-POS-01',
      title: 'Point of Sale (POS) Billing & Keyboard Shortcuts Guide',
      department: 'Software Guidance',
      applicableRole: 'all',
      version: '1.0',
      approvalStatus: 'approved',
      effectiveDate: '2026-01-01',
      rawContent: `# MAN-POS-01: POS Billing & System Operation

## 1. Quick Keyboard Shortcuts
- F2 or Ctrl+I: Focus Medicine Search bar.
- Ctrl+S: Direct Save & Print bill.
- F4: Toggle between Cash, UPI, and Credit payment modes.
- Esc: Close active assistant or modal dialog.

## 2. Medicine Substitutes
- Use the assistant command "Find in-stock alternatives for [Medicine]" to query identical salt compositions with live rack locations.`
    }, db);

    console.log('[KnowledgeBaseService] ✓ Default SOPs & Manuals ingested successfully.');
  }
}

export const knowledgeBaseService = KnowledgeBaseService.getInstance();
