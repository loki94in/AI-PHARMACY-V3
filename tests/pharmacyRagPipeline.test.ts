import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { pharmacyRagService } from '../src/services/localAi/pharmacyRagService.js';
import { knowledgeBaseService } from '../src/services/localAi/knowledgeBaseService.js';
import { dbManager } from '../src/database/connection.js';

describe('Unified Pharmacy RAG Pipeline Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();

    // Ingest sample SOP for RAG testing
    await knowledgeBaseService.ingestDocument({
      sourceType: 'sop',
      sourceKey: 'SOP-RAG-TEST',
      title: 'Prescription Verification Standard',
      department: 'Clinical Pharmacy',
      applicableRole: 'all',
      version: '2.0',
      approvalStatus: 'approved',
      rawContent: `## Dosage Verification\nCheck active pharmaceutical salt and exact milligram strength before dispensing.`
    }, db);
  }, 30000);

  afterAll(async () => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('Criteria 1: Assembles evidence package combining SOP documents and live database facts', async () => {
    const liveFacts = {
      medicine: 'Augmentin 625 Duo',
      stock: 45,
      rack: 'Shelf A-3',
      mrp: 201.50
    };

    const evidence = await pharmacyRagService.assembleEvidence(
      'Dosage Verification Augmentin',
      'staff',
      liveFacts,
      db
    );

    expect(evidence.evidenceFound).toBe(true);
    expect(evidence.role).toBe('staff');
    expect(evidence.liveFacts.medicine).toBe('Augmentin 625 Duo');
    expect(evidence.citations.length).toBeGreaterThanOrEqual(1);

    const dbCitation = evidence.citations.find(c => c.sourceType === 'live_db');
    expect(dbCitation).toBeDefined();
    expect(dbCitation?.sourceTitle).toBe('Live Pharmacy Database');
  });

  test('Criteria 2: Formats combined RAG evidence cleanly for Qwen system prompt', async () => {
    const evidence = await pharmacyRagService.assembleEvidence(
      'Dosage Verification',
      'staff',
      { medicine: 'Dolo 650', stock: 120 },
      db
    );

    const formatted = pharmacyRagService.formatEvidenceForPrompt(evidence);
    expect(formatted).toContain('Verified Live Database Facts');
    expect(formatted).toContain('Dolo 650');
  });
});
