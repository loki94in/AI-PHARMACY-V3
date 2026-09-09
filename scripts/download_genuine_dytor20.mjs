import fs from 'fs';
import path from 'path';

async function fetchAndSave() {
  const urlFront = 'https://cdn01.pharmeasy.in/dam/productsnowatermark/263724/dytor-20mg-strip-of-15-tablets-front-2-1756459937-non-watermarked.jpg';
  const urlBack = 'https://cdn01.pharmeasy.in/dam/productsnowatermark/263724/dytor-20mg-strip-of-15-tablets-back-7-1756459937-non-watermarked.jpg';

  const resFront = await fetch(urlFront, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const bufFront = Buffer.from(await resFront.arrayBuffer());

  const resBack = await fetch(urlBack, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const bufBack = Buffer.from(await resBack.arrayBuffer());

  console.log('Fetched Front size:', bufFront.length);
  console.log('Fetched Back size:', bufBack.length);

  const curFrontSize = fs.statSync('frontend/public/products/dytor-20mg-front.jpg').size;
  console.log('Current Front file size on disk:', curFrontSize);

  // Write genuine front and back to both frontend/public/products and uploads/products
  fs.writeFileSync('frontend/public/products/dytor-20mg-front.jpg', bufFront);
  fs.writeFileSync('uploads/products/dytor-20mg-front.jpg', bufFront);

  fs.writeFileSync('frontend/public/products/dytor-20mg-back.jpg', bufBack);
  fs.writeFileSync('uploads/products/dytor-20mg-back.jpg', bufBack);

  console.log('Successfully overwritten dytor-20mg-front.jpg and dytor-20mg-back.jpg with genuine Dytor 20 images!');
}
fetchAndSave();
