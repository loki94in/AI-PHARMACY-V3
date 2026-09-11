import { dbManager } from '../src/database/connection.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const db = await dbManager.getConnection();
  const row = await db.get('SELECT key, value FROM app_settings WHERE key = ?', ['gemini_api_key']);
  console.log('--- GEMINI API KEY STATUS ---');
  if (row && row.value && row.value.trim() !== '') {
    console.log('SQLite app_settings: FOUND! Key starts with:', row.value.substring(0, 8) + '... (length: ' + row.value.length + ')');
  } else {
    console.log('SQLite app_settings: NOT FOUND / EMPTY');
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '') {
    console.log('.env GEMINI_API_KEY: FOUND! Key starts with:', process.env.GEMINI_API_KEY.substring(0, 8) + '...');
  } else {
    console.log('.env GEMINI_API_KEY: NOT FOUND / EMPTY');
  }

  // Let's test the key against Google API if found
  const activeKey = (row && row.value) || process.env.GEMINI_API_KEY;
  if (activeKey) {
    console.log('\nTesting key against Google AI Studio...');
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey.trim()}`);
      if (res.ok) {
        const data = await res.json();
        console.log('VERIFICATION SUCCESS! Google returned 200 OK.');
        console.log('Available Models:', (data.models || []).map((m: any) => m.name.replace('models/', '')).slice(0, 5).join(', '));
      } else {
        const err = await res.json().catch(() => ({}));
        console.log('VERIFICATION FAILED! Status:', res.status, 'Error:', err.error?.message || res.statusText);
      }
    } catch (e: any) {
      console.log('Connection test failed:', e.message);
    }
  }
}

check().catch(console.error);
