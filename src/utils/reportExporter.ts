import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { Response } from 'express';

/**
 * Generate a beautifully styled Excel spreadsheet binary buffer.
 * Supports auto-fitting columns, title merging, and formatting.
 */
export function exportToExcel(
  title: string,
  headers: string[],
  keys: string[],
  rows: any[]
): Buffer {
  const wsData = [
    [title],
    [], // Blank spacing
    headers,
    ...rows.map(row => keys.map(k => {
      const val = row[k];
      return val !== undefined && val !== null ? val : '—';
    }))
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Merge title banner cell A1 to N1 (header width)
  const colsCount = Math.max(headers.length, 1);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colsCount - 1 } }];

  // Auto-fit column widths
  const maxLengths = headers.map((h, i) => {
    let max = h.length;
    rows.forEach(row => {
      const val = String(row[keys[i]] || '');
      if (val.length > max) max = val.length;
    });
    return { wch: Math.min(Math.max(max + 4, 10), 40) }; // bounding column widths
  });
  ws['!cols'] = maxLengths;

  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Generate a beautifully styled, branded PDF report output directly to the response stream.
 * Features letterhead, alternating row fills, page numbers, variable column widths, and proper cell wrapping.
 */
export function exportToPdf(
  res: Response,
  title: string,
  headers: string[],
  keys: string[],
  rows: any[],
  alignMap?: Record<string, 'left' | 'center' | 'right'>,
  columnWidths?: number[],
  splitPerPage: boolean = false
): void {
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  doc.pipe(res);

  const tableWidth = 512; // 612 page width - 100 margin
  const startX = 50;
  const rowHeight = 22;
  const itemsPerPageLimit = 30;

  // Calculates x coordinate and width for a column index
  const getColXAndWidth = (index: number) => {
    let x = startX;
    let width = tableWidth / headers.length;
    if (columnWidths && columnWidths.length === headers.length) {
      width = columnWidths[index];
      for (let i = 0; i < index; i++) {
        x += columnWidths[i];
      }
    } else {
      x += index * width;
    }
    return { x, width };
  };

  // Branding Page Header
  const drawPageHeader = (pageTitle: string, batchIndex?: number, totalBatches?: number) => {
    doc.font('Helvetica');
    doc.fillColor('#1e293b');
    doc.fontSize(16).text('AI PHARMACY OS', { align: 'left' });
    doc.fontSize(8).fillColor('#64748b').text('Smart Retail & Inventory Management System', { align: 'left' });
    doc.moveDown(0.2);

    // Decorative rule line
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(startX, doc.y).lineTo(startX + tableWidth, doc.y).stroke();
    doc.moveDown(0.6);

    let displayTitle = pageTitle;
    if (splitPerPage && batchIndex !== undefined && totalBatches !== undefined) {
      const startItem = batchIndex * itemsPerPageLimit + 1;
      const endItem = Math.min((batchIndex + 1) * itemsPerPageLimit, rows.length);
      displayTitle = `${pageTitle} — Part ${batchIndex + 1} of ${totalBatches} (Items ${startItem} to ${endItem})`;
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text(displayTitle, { align: 'center' });
    doc.font('Helvetica'); // Reset back to standard font
    doc.moveDown(0.8);
  };

  const totalBatches = splitPerPage ? Math.ceil(rows.length / itemsPerPageLimit) || 1 : 1;
  let currentBatch = 0;

  drawPageHeader(title, currentBatch, totalBatches);

  // Draw Table Headers
  let currentY = doc.y;
  doc.rect(startX, currentY, tableWidth, rowHeight).fill('#1e293b');
  
  doc.fontSize(8).fillColor('#ffffff');
  headers.forEach((header, index) => {
    const { x, width } = getColXAndWidth(index);
    const align = alignMap?.[keys[index]] || 'left';
    doc.text(header, x + 5, currentY + 7, { width: width - 10, align, lineBreak: false });
  });

  currentY += rowHeight;

  // Draw Rows
  rows.forEach((row, rowIndex) => {
    const isNewBatchBoundary = splitPerPage && rowIndex > 0 && rowIndex % itemsPerPageLimit === 0;

    // If row exceeds page height boundary OR splitPerPage batch boundary is hit (30 items per batch/page)
    if (currentY + rowHeight > 720 || isNewBatchBoundary) {
      doc.addPage();
      if (isNewBatchBoundary) {
        currentBatch++;
      }
      drawPageHeader(title, currentBatch, totalBatches);

      // Re-draw Table Headers on new page
      currentY = doc.y;
      doc.rect(startX, currentY, tableWidth, rowHeight).fill('#1e293b');
      doc.fontSize(8).fillColor('#ffffff');
      headers.forEach((header, index) => {
        const { x, width } = getColXAndWidth(index);
        const align = alignMap?.[keys[index]] || 'left';
        doc.text(header, x + 5, currentY + 7, { width: width - 10, align, lineBreak: false });
      });
      currentY += rowHeight;
    }

    // Alternating shaded background rows
    if (rowIndex % 2 === 1) {
      doc.rect(startX, currentY, tableWidth, rowHeight).fill('#f8fafc');
    }

    doc.fontSize(7.5).fillColor('#334155');
    headers.forEach((_, colIndex) => {
      const { x, width } = getColXAndWidth(colIndex);
      const key = keys[colIndex];
      let val = row[key] !== undefined && row[key] !== null ? String(row[key]) : '—';

      // Smart currency formatting
      if (key === 'total_amount' || key === 'amount' || key === 'value' || key === 'cost_price' || key === 'mrp') {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          val = `₹${numVal.toFixed(2)}`;
        }
      }

      const align = alignMap?.[key] || 'left';
      doc.text(val, x + 5, currentY + 7, { width: width - 10, align, ellipsis: true });
    });

    // Horizontal border line
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, currentY + rowHeight).lineTo(startX + tableWidth, currentY + rowHeight).stroke();
    currentY += rowHeight;
  });

  // Footer & Page number ranges
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, 740).lineTo(startX + tableWidth, 740).stroke();
    doc.fontSize(7).fillColor('#64748b');
    doc.text(
      `Page ${i + 1} of ${range.count}`,
      startX,
      745,
      { align: 'center', width: tableWidth }
    );
    doc.text(
      `Generated on: ${new Date().toLocaleString()}`,
      startX,
      745,
      { align: 'right', width: tableWidth }
    );
  }

  doc.end();
}

/**
 * Generate a standard CSV string from headers, keys, and row objects.
 * Handles double quote escaping.
 */
export function exportToCsv(
  headers: string[],
  keys: string[],
  rows: any[]
): string {
  const headerLine = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');
  const rowLines = rows.map(row => 
    keys.map(k => {
      const val = row[k];
      const strVal = val !== undefined && val !== null ? String(val) : '';
      const cleaned = strVal.replace(/"/g, '""');
      // Prevent Excel from removing leading zeros and popping up conversion warnings
      if (/^0\d+$/.test(strVal)) {
        return `="${cleaned}"`;
      }
      return `"${cleaned}"`;
    }).join(',')
  );
  return [headerLine, ...rowLines].join('\n');
}

/**
 * Classifies a medicine into SOLID, LIQUID, or OTHER based on dosage_form and name.
 */
export function detectItemDosageForm(dosageForm?: string | null, name?: string | null): 'SOLID' | 'LIQUID' | 'OTHER' {
  if (dosageForm) {
    const f = dosageForm.trim().toUpperCase();
    if (f.includes('TAB') || f.includes('CAP') || f.includes('STRIP') || f.includes('PILL') || f.includes('BOLUS')) {
      return 'SOLID';
    }
    if (f.includes('SYRUP') || f.includes('SUSP') || f.includes('LIQ') || f.includes('DROP') || f.includes('SOL') || f.includes('TONIC') || f.includes('ELIXIR')) {
      return 'LIQUID';
    }
  }
  if (name) {
    const n = name.toUpperCase();
    if (/\b(TAB|TABLET|TABLETS|CAP|CAPSULE|CAPSULES)\b/.test(n)) return 'SOLID';
    if (/\b(SYRUP|SUSP|SUSPENSION|DROPS|SOLUTION|LIQUID)\b/.test(n)) return 'LIQUID';
  }
  return 'OTHER';
}

export interface ShelfRemovalItem {
  id: number;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  mrp?: number;
  rack_location?: string;
  dosage_form?: string;
  manufacturer?: string;
}

export interface ShelfRemovalOptions {
  storeName?: string;
  sortBy?: 'alphabetical' | 'company' | 'rack' | 'expiry_date';
  dosageFilter?: 'all' | 'solid' | 'liquid';
  subtitle?: string;
}

/**
 * Generates an operational shelf-removal pick-list PDF with physical checkboxes,
 * clear grouping headers, rack locations, and batch info.
 */
export function exportShelfRemovalPdf(
  destination: NodeJS.WritableStream,
  items: ShelfRemovalItem[],
  options: ShelfRemovalOptions = {}
): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: 40, bufferPages: true, size: 'A4' });
  doc.pipe(destination);

  const tableWidth = 515; // 595 A4 width - 80 margins
  const startX = 40;
  const rowHeight = 20;

  const storeName = options.storeName || 'AI PHARMACY';
  const sortBy = options.sortBy || 'alphabetical';
  const subtitle = options.subtitle || 'Near-Expiry Stock Shelf Removal Pick-Sheet';

  // Columns: Checkbox, Rack, Medicine Name, Form, Batch, Expiry, Qty, MRP
  const colWidths = [24, 48, 168, 50, 70, 48, 38, 69];
  const colHeaders = ['[ ]', 'Rack', 'Medicine Name', 'Form', 'Batch No', 'Exp', 'Qty', 'MRP'];

  const getColX = (colIdx: number) => {
    let x = startX;
    for (let i = 0; i < colIdx; i++) {
      x += colWidths[i];
    }
    return x;
  };

  const drawPageHeader = () => {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(storeName.toUpperCase(), startX, 35, { align: 'left' });
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text('SHELF REMOVAL PICK-LIST · NEAR-EXPIRY AUDIT', startX, 52, { align: 'left' });

    // Decorative line
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(startX, 66).lineTo(startX + tableWidth, 66).stroke();

    // Summary banner
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b').text(subtitle, startX, 72, { align: 'left' });
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(
      `Total Items: ${items.length}  |  Arranged By: ${sortBy.toUpperCase()}  |  Dosage: ${(options.dosageFilter || 'ALL').toUpperCase()}`,
      startX,
      72,
      { align: 'right', width: tableWidth }
    );

    // Table Header row
    const headerY = 88;
    doc.rect(startX, headerY, tableWidth, rowHeight).fill('#1e293b');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');

    colHeaders.forEach((h, idx) => {
      const x = getColX(idx);
      const w = colWidths[idx];
      const align = idx === 0 || idx === 5 || idx === 6 ? 'center' : idx === 7 ? 'right' : 'left';
      doc.text(h, x + 3, headerY + 6, { width: w - 6, align, lineBreak: false });
    });

    return headerY + rowHeight;
  };

  let currentY = drawPageHeader();

  // Helper for new page
  const ensureSpace = (neededHeight: number) => {
    if (currentY + neededHeight > 780) {
      doc.addPage();
      currentY = drawPageHeader();
    }
  };

  // Group items if needed
  let lastGroupKey = '';

  items.forEach((item, index) => {
    let groupKey = '';
    if (sortBy === 'company') {
      groupKey = (item.manufacturer || 'General / Other Manufacturers').trim();
    } else if (sortBy === 'rack') {
      groupKey = (item.rack_location || 'Unassigned Shelf / Rack').trim();
    } else if (sortBy === 'alphabetical') {
      const firstChar = (item.medicine_name || '').trim().charAt(0).toUpperCase();
      groupKey = /^[A-Z]$/.test(firstChar) ? firstChar : '#';
    }

    // Draw Group Section Header if changed
    if (groupKey && groupKey !== lastGroupKey) {
      lastGroupKey = groupKey;
      ensureSpace(24);

      doc.rect(startX, currentY, tableWidth, 16).fill('#f1f5f9');
      doc.strokeColor('#cbd5e1').lineWidth(0.5).rect(startX, currentY, tableWidth, 16).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0369a1');

      const bannerText = sortBy === 'alphabetical'
        ? `SECTION [ ${groupKey} ]`
        : sortBy === 'company'
        ? `COMPANY: ${groupKey.toUpperCase()}`
        : `SHELF / RACK: ${groupKey.toUpperCase()}`;

      doc.text(bannerText, startX + 6, currentY + 4, { width: tableWidth - 12, lineBreak: false });
      currentY += 16;
    }

    ensureSpace(rowHeight);

    // Alternating row background
    if (index % 2 === 1) {
      doc.rect(startX, currentY, tableWidth, rowHeight).fill('#fafafa');
    }

    // 1. Draw physical square checkbox [ ]
    const boxSize = 9;
    const boxX = getColX(0) + (colWidths[0] - boxSize) / 2;
    const boxY = currentY + (rowHeight - boxSize) / 2;
    doc.rect(boxX, boxY, boxSize, boxSize).lineWidth(0.8).strokeColor('#64748b').stroke();

    // 2. Rack
    doc.font('Helvetica').fontSize(7).fillColor('#475569');
    doc.text(item.rack_location || '—', getColX(1) + 2, currentY + 6, { width: colWidths[1] - 4, lineBreak: false, ellipsis: true });

    // 3. Medicine Name
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text(item.medicine_name || '—', getColX(2) + 2, currentY + 6, { width: colWidths[2] - 4, lineBreak: false, ellipsis: true });

    // 4. Form
    doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
    const formLabel = (item.dosage_form || detectItemDosageForm(item.dosage_form, item.medicine_name)).toUpperCase();
    doc.text(formLabel, getColX(3) + 2, currentY + 6, { width: colWidths[3] - 4, lineBreak: false, ellipsis: true });

    // 5. Batch No
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text(item.batch_no || '—', getColX(4) + 2, currentY + 6, { width: colWidths[4] - 4, lineBreak: false, ellipsis: true });

    // 6. Expiry Date
    const expStr = item.expiry_date
      ? new Date(item.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' })
      : '—';
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#b91c1c');
    doc.text(expStr, getColX(5) + 2, currentY + 6, { width: colWidths[5] - 4, align: 'center', lineBreak: false });

    // 7. Quantity
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text(String(item.quantity ?? 0), getColX(6) + 2, currentY + 6, { width: colWidths[6] - 4, align: 'center', lineBreak: false });

    // 8. MRP
    doc.font('Helvetica').fontSize(7).fillColor('#334155');
    const mrpStr = item.mrp ? `₹${Number(item.mrp).toFixed(2)}` : '—';
    doc.text(mrpStr, getColX(7) + 2, currentY + 6, { width: colWidths[7] - 6, align: 'right', lineBreak: false });

    // Row bottom separator line
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(startX, currentY + rowHeight).lineTo(startX + tableWidth, currentY + rowHeight).stroke();
    currentY += rowHeight;
  });

  // Footer on all buffered pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, 805).lineTo(startX + tableWidth, 805).stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text(`Sheet ${i + 1} of ${range.count} · Tick [✓] checkbox as items are removed from shelf`, startX, 810, { width: tableWidth, align: 'left' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, startX, 810, { width: tableWidth, align: 'right' });
  }

  doc.end();
  return doc;
}

