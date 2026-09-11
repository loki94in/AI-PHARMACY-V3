import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';

async function test() {
  const db = await dbManager.getConnection();
  const med = await db.get('SELECT * FROM medicines WHERE id = 281310');

  const cleanMedMfg = (med.manufacturer || '').toUpperCase().trim();
  const candHumMfg = 'LUPIN';
  const candBdMfg = 'BD GLIDE';

  const isBdAlias = (mfg: string) => mfg.includes('B D') || mfg.includes('BECTON') || mfg === 'BD' || mfg.includes('BD GLIDE');
  console.log('BD alias match for Huminsulin:', isBdAlias(cleanMedMfg) && isBdAlias(candHumMfg));
  console.log('BD alias match for BD Syringe:', isBdAlias(cleanMedMfg) && isBdAlias(candBdMfg));

  const isMedDevice = /\b(syringe|syrange|syr|needle|cannula|catheter|iv set|infusion set|lancet|scalp vein|surgical)\b/i.test(
    `${med.name} ${med.packaging || ''} ${med.item_type || ''}`
  );
  console.log('Med is device:', isMedDevice);

  process.exit(0);
}

test();
