import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Tesseract from 'tesseract.js';
import AdmZip from 'adm-zip';
import cron from 'node-cron';
import { Jimp } from 'jimp';
import { getAppDataDir } from '../config/index.js';
import { runHeavyJob } from '../utils/backgroundJobLane.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_UPLOAD_DIR = path.resolve(getAppDataDir(), 'uploads');
const TEMP_DIR = path.join(BASE_UPLOAD_DIR, 'temp');
const IMPORTANT_DIR = path.join(BASE_UPLOAD_DIR, 'important');

// Ensure directories exist
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(IMPORTANT_DIR)) fs.mkdirSync(IMPORTANT_DIR, { recursive: true });

export class ImageArchiveService {
  // Common Schedule H1, Narcotic, and Sleeping Pill keywords in India
  private restrictedKeywords = [
    'schedule h1', 'schedule h', 'narcotic', 'psychotropic',
    'alprazolam', 'diazepam', 'lorazepam', 'clonazepam', 'nitrazepam',
    'tramadol', 'codeine', 'zolpidem', 'buprenorphine', 'fentanyl',
    'morphine', 'ketamine', 'phenobarbital', 'midazolam'
  ];

  /**
   * Initializes the Cron Jobs for automatic cleanup and archiving.
   */
  public initJobs() {
    // Run every day at 1:00 AM to clean temp files older than 6 months (180 days)
    cron.schedule('0 1 * * *', () => {
      console.log('Running daily cleanup job for temporary images...');
      void runHeavyJob('image_archive_temp_cleanup', async () => this.cleanTemporaryImages(180));
    });

    // Run on the 1st of every month at 2:00 AM to zip the previous month's important files
    cron.schedule('0 2 1 * *', () => {
      console.log('Running monthly archiving job for important images...');
      void runHeavyJob('image_archive_monthly_zip', async () => this.zipMonthlyImportantImages());
    });

    // Run every day at 2:30 AM to purge payment screenshots older than 90 days for delivered orders
    cron.schedule('30 2 * * *', () => {
      console.log('Running daily retention purge job for 90-day payment screenshots...');
      void runHeavyJob('payment_receipts_retention_purge', async () => this.purgeExpiredPaymentScreenshots(90));
    });

    console.log('Image Archive Service background jobs initialized.');
  }

  /**
   * Uses AI OCR to classify an image. If it contains restricted keywords, it moves it to the important folder.
   * Returns true if marked important, false otherwise.
   */
  public async processAndRouteImage(filePath: string): Promise<string | null> {
    try {
      if (!fs.existsSync(filePath)) return null;

      // Use Tesseract to read text from the image
      console.log(`Analyzing image with AI (OCR): ${filePath}`);
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
      const lowerText = text.toLowerCase();

      // Check against restricted guidelines
      const isRestricted = this.restrictedKeywords.some(kw => lowerText.includes(kw));

      const fileName = path.basename(filePath);
      
      let targetPath: string;
      if (isRestricted) {
        // Move to important folder organized by current YYYY-MM
        const date = new Date();
        const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const targetDir = path.join(IMPORTANT_DIR, monthFolder);
        
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        targetPath = path.join(targetDir, fileName);
      } else {
        // Move to temp folder
        targetPath = path.join(TEMP_DIR, fileName);
      }

      // Compress and save to target path, then delete original if they are different
      try {
        const image = await Jimp.read(filePath);
        if (image.width > 800) {
          image.resize({ w: 800 });
        }
        const compressedBuffer = await image.getBuffer('image/jpeg');
        await fs.promises.writeFile(targetPath, compressedBuffer);
        if (filePath !== targetPath) {
          fs.unlinkSync(filePath);
        }
      } catch (compressErr) {
        console.error('Failed to compress routed image with Jimp, renaming instead:', compressErr);
        if (filePath !== targetPath) {
          fs.renameSync(filePath, targetPath);
        }
      }

      if (isRestricted) {
        console.log(`[AI Auto-Detect] Image flagged as H1/Narcotic and compressed/moved to: ${targetPath}`);
      } else {
        console.log(`[AI Auto-Detect] Image marked as temporary and compressed/stored in: ${targetPath}`);
      }
      return targetPath;

    } catch (err) {
      console.error('Error in processAndRouteImage:', err);
      // Default to temp if OCR fails
      const targetPath = path.join(TEMP_DIR, path.basename(filePath));
      try {
        const image = await Jimp.read(filePath);
        if (image.width > 800) {
          image.resize({ w: 800 });
        }
        const compressedBuffer = await image.getBuffer('image/jpeg');
        await fs.promises.writeFile(targetPath, compressedBuffer);
        if (filePath !== targetPath) {
          fs.unlinkSync(filePath);
        }
      } catch (compressErr) {
        if (filePath !== targetPath) {
          fs.renameSync(filePath, targetPath);
        }
      }
      return targetPath;
    }
  }

  /**
   * Manually flag a file as important and move it to the correct folder
   */
  public markAsImportant(fileName: string): boolean {
    const tempPath = path.join(TEMP_DIR, fileName);
    if (!fs.existsSync(tempPath)) return false;

    const date = new Date();
    const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const targetDir = path.join(IMPORTANT_DIR, monthFolder);
    
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    fs.renameSync(tempPath, path.join(targetDir, fileName));
    return true;
  }

  /**
   * Deletes files in the temp folder older than specific days (default 180 days = ~6 months)
   */
  public cleanTemporaryImages(daysOld: number = 180) {
    try {
      const now = Date.now();
      const cutoff = now - (daysOld * 24 * 60 * 60 * 1000);

      const files = fs.readdirSync(TEMP_DIR);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      
      console.log(`Cleanup complete. Deleted ${deletedCount} temporary images older than ${daysOld} days.`);
    } catch (err) {
      console.error('Error during temp cleanup:', err);
    }
  }

  /**
   * Zips the previous month's important folder and deletes the raw folder
   */
  public zipMonthlyImportantImages() {
    try {
      // Determine previous month
      const date = new Date();
      date.setMonth(date.getMonth() - 1);
      const prevMonthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const targetDir = path.join(IMPORTANT_DIR, prevMonthFolder);
      if (!fs.existsSync(targetDir)) {
        console.log(`No important folder found for ${prevMonthFolder} to zip.`);
        return;
      }

      const zipName = `H1_Rx_Archive_${prevMonthFolder}.zip`;
      const zipPath = path.join(IMPORTANT_DIR, zipName);

      const zip = new AdmZip();
      zip.addLocalFolder(targetDir);
      zip.writeZip(zipPath);

      console.log(`Successfully created archive: ${zipPath}`);

      // Delete the uncompressed folder
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`Deleted raw folder to save space: ${targetDir}`);
    } catch (err) {
      console.error('Error during monthly zipping:', err);
    }
  }

  /**
   * Purges payment screenshot files older than specific days (default 90)
   * ONLY for orders that are delivered/fulfilled and return-window closed.
   */
  public async purgeExpiredPaymentScreenshots(daysOld: number = 90): Promise<{ purgedCount: number; freedBytes: number; candidateCount: number }> {
    let purgedCount = 0;
    let freedBytes = 0;
    try {
      const { dbManager } = await import('../database/connection.js');
      const db = await dbManager.getConnection();

      // Query candidate orders that have a payment screenshot, are older than cutoff,
      // and whose order lifecycle is completely finished
      const candidates = await db.all<Array<{ id: number; payment_screenshot_path: string; created_at: string }>>(`
        SELECT id, payment_screenshot_path, created_at
        FROM special_orders
        WHERE payment_screenshot_path IS NOT NULL
          AND (
            delivery_status = 'delivered' 
            OR status IN ('Fulfilled', 'Delivered')
          )
          AND (return_status IS NULL OR return_status = 'expired')
          AND payment_status IN ('CONFIRMED', 'PAYMENT_CONFIRMED', 'VERIFIED')
          AND created_at <= datetime('now', '-' || ? || ' days')
      `, [daysOld]);

      if (!candidates || candidates.length === 0) {
        return { purgedCount: 0, freedBytes: 0, candidateCount: 0 };
      }

      const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
      const inboundDir = path.resolve(getAppDataDir(), 'data', 'inbound_media');

      for (const row of candidates) {
        if (!row.payment_screenshot_path) continue;
        const normalized = row.payment_screenshot_path.replace(/\\/g, '/');
        const filename = normalized.split('/').pop();
        if (!filename) continue;

        const possiblePaths = [
          path.resolve(uploadsDir, filename),
          path.resolve(inboundDir, filename),
          path.resolve(row.payment_screenshot_path)
        ];

        for (const p of possiblePaths) {
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            try {
              const sz = fs.statSync(p).size;
              fs.unlinkSync(p);
              freedBytes += sz;
              break;
            } catch (unlinkErr) {
              console.warn(`[ImageArchiveService] Could not unlink ${p}:`, unlinkErr);
            }
          }
        }

        await db.run(
          `UPDATE special_orders 
           SET payment_screenshot_path = NULL, 
               updated_at = datetime('now') 
           WHERE id = ?`,
          [row.id]
        );

        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'payment_screenshot_retention_purge', ?, 'system', CURRENT_TIMESTAMP)`,
          [
            row.id,
            `Payment screenshot was purged per ${daysOld}-day retention policy (order delivered & return window closed). Freed from disk.`
          ]
        ).catch(() => {});

        purgedCount++;
      }

      console.log(`[ImageArchiveService] Retention purge complete: ${purgedCount} screenshots purged, ${(freedBytes / 1024 / 1024).toFixed(2)} MB freed.`);
      return { purgedCount, freedBytes, candidateCount: candidates.length };
    } catch (err) {
      console.error('[ImageArchiveService] Error during payment screenshot retention purge:', err);
      return { purgedCount, freedBytes, candidateCount: 0 };
    }
  }

  /**
   * Returns storage stats for payment screenshots: total files, total MB, and eligible for 90-day purge.
   */
  public async getPaymentScreenshotStorageStats(daysOld: number = 90): Promise<{
    totalFiles: number;
    totalSizeBytes: number;
    eligibleCount: number;
    eligibleSizeBytes: number;
  }> {
    let totalFiles = 0;
    let totalSizeBytes = 0;
    let eligibleCount = 0;
    let eligibleSizeBytes = 0;

    try {
      const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
          if (file.startsWith('payment_proof_')) {
            const p = path.join(uploadsDir, file);
            if (fs.statSync(p).isFile()) {
              totalFiles++;
              totalSizeBytes += fs.statSync(p).size;
            }
          }
        }
      }

      const { dbManager } = await import('../database/connection.js');
      const db = await dbManager.getConnection();
      const eligibleRows = await db.all<Array<{ id: number; payment_screenshot_path: string }>>(`
        SELECT id, payment_screenshot_path
        FROM special_orders
        WHERE payment_screenshot_path IS NOT NULL
          AND (
            delivery_status = 'delivered' 
            OR status IN ('Fulfilled', 'Delivered')
          )
          AND (return_status IS NULL OR return_status = 'expired')
          AND payment_status IN ('CONFIRMED', 'PAYMENT_CONFIRMED', 'VERIFIED')
          AND created_at <= datetime('now', '-' || ? || ' days')
      `, [daysOld]);

      eligibleCount = eligibleRows ? eligibleRows.length : 0;
      if (eligibleRows && eligibleRows.length > 0) {
        for (const row of eligibleRows) {
          if (!row.payment_screenshot_path) continue;
          const filename = row.payment_screenshot_path.replace(/\\/g, '/').split('/').pop();
          if (!filename) continue;
          const p = path.resolve(uploadsDir, filename);
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            eligibleSizeBytes += fs.statSync(p).size;
          }
        }
      }
    } catch (err) {
      console.warn('[ImageArchiveService] Failed to calculate storage stats:', err);
    }

    return { totalFiles, totalSizeBytes, eligibleCount, eligibleSizeBytes };
  }
}

export const imageArchiveService = new ImageArchiveService();
