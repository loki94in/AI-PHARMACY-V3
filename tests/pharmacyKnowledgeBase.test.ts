import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { knowledgeBaseService } from '../src/services/localAi/knowledgeBaseService.js';
import { dbManager } from '../src/database/connection.js';

describe('Pharmacy Knowledge Base & SOP Ingestion Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();
  }, 30000);

  afterAll(async () => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('Criteria 1: Content hashing is deterministic and handles whitespace', () => {
    const hash1 = knowledgeBaseService.hashContent('Prescription Dispensing Procedure');
    const hash2 = knowledgeBaseService.hashContent('  Prescription Dispensing Procedure  \n');
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex length
  });

  test('Criteria 2: Document chunking splits by headings and preserves sections', () => {
    const markdown = `# Title\n\n## Section 1\nContent for section 1 with verified procedural steps.\n\n## Section 2\nContent for section 2 with cold storage instructions.`;
    const chunks = knowledgeBaseService.chunkDocument(markdown, 'doc_test_1');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].heading).toBe('Section 1');
    expect(chunks[0].content).toContain('Content for section 1');
    expect(chunks[1].heading).toBe('Section 2');
    expect(chunks[1].content).toContain('Content for section 2');
  });

  test('Criteria 3: Ingests approved SOP document and updates chunk database', async () => {
    const result = await knowledgeBaseService.ingestDocument({
      sourceType: 'sop',
      sourceKey: 'SOP-TEST-01',
      title: 'Automated Test Dispensing Protocol',
      department: 'Pharmacy Operations',
      applicableRole: 'all',
      version: '1.2',
      approvalStatus: 'approved',
      rawContent: `# SOP-TEST-01: Cold Chain Protocol\n\n## Refrigerator Temperature\nInsulins must be kept strictly between 2C and 8C.`
    }, db);

    expect(result.documentId).toBeDefined();
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);

    const docRow = await db.get('SELECT * FROM assistant_knowledge_documents WHERE id = ?', [result.documentId]);
    expect(docRow).toBeDefined();
    expect(docRow.title).toBe('Automated Test Dispensing Protocol');
    expect(docRow.version).toBe('1.2');
    expect(docRow.approval_status).toBe('approved');
  });

  test('Criteria 4: Full-text search retrieves approved SOP by keyword with role scoping', async () => {
    const results = await knowledgeBaseService.searchKnowledge('Cold Chain Refrigerator Temperature', {
      role: 'staff',
      approvedOnly: true
    }, db);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find(r => r.title === 'Automated Test Dispensing Protocol');
    expect(match).toBeDefined();
    expect(match?.content).toContain('between 2C and 8C');
  });

  test('Criteria 5: Customer role filter isolates internal staff-only SOPs', async () => {
    // Ingest staff-only policy
    await knowledgeBaseService.ingestDocument({
      sourceType: 'policy',
      sourceKey: 'POLICY-INTERNAL-01',
      title: 'Staff Shift Handover Rules',
      applicableRole: 'staff',
      approvalStatus: 'approved',
      rawContent: `## Cash Register Handover\nCashier must balance drawer before handover.`
    }, db);

    // Customer query must NOT return staff-only document
    const customerResults = await knowledgeBaseService.searchKnowledge('Cash Register Handover', {
      role: 'customer'
    }, db);

    const leak = customerResults.find(r => r.title === 'Staff Shift Handover Rules');
    expect(leak).toBeUndefined();
  });
});
