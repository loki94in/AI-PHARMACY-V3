import fs from 'fs';

async function ocr() {
  const Tesseract = await import('tesseract.js');
  const imgPath = 'frontend/public/products/dytor-20mg-front.jpg';
  const { data: { text } } = await Tesseract.default.recognize(imgPath, 'eng');
  console.log('--- OCR of dytor-20mg-front.jpg ---');
  console.log(text);

  const imgPathBack = 'frontend/public/products/dytor-20mg-back.jpg';
  const { data: { text: textBack } } = await Tesseract.default.recognize(imgPathBack, 'eng');
  console.log('--- OCR of dytor-20mg-back.jpg ---');
  console.log(textBack);

  const imgPath10 = 'frontend/public/products/dytor-10mg-side.jpg';
  const { data: { text: text10 } } = await Tesseract.default.recognize(imgPath10, 'eng');
  console.log('--- OCR of dytor-10mg-side.jpg ---');
  console.log(text10);
}
ocr();
