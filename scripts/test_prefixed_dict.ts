import { PaddleOcrService } from 'paddleocr';
import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import { getAppDataDir } from '../src/config/index.js';
import { Jimp } from 'jimp';

const MODELS_DIR = path.resolve(getAppDataDir(), 'data', 'models');
const detPath = path.join(MODELS_DIR, 'det_model.onnx');
const recPath = path.join(MODELS_DIR, 'rec_model.onnx');
const dictPath = path.join(MODELS_DIR, 'en_dict.txt');

async function testWithBlankPrefixed() {
  const detBuffer = fs.readFileSync(detPath).buffer;
  const recBuffer = fs.readFileSync(recPath).buffer;
  const dictRaw = fs.readFileSync(dictPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.replace('\r', ''));

  // PaddleOCR recognition outputs 0 as blank token and character index as 1..N
  // en_dict.txt has 0..9, A..Z starting from line 1.
  // When dict starts with '', index 1 correctly maps to dict[1] which is line 1 ('0').
  const dictPrefixed = ['', ...dictRaw];

  const config = {
    ort,
    detection: {
      modelBuffer: detBuffer,
      maxSideLength: 720
    },
    recognition: {
      modelBuffer: recBuffer,
      charactersDictionary: dictPrefixed
    }
  };

  const ocrService = await PaddleOcrService.createInstance(config as any);
  const imgPath = "C:/Users/ratna/.gemini/antigravity-ide/brain/eef017aa-fc36-4577-95f9-c1f461900253/.user_uploaded/media_1789823524409.jpg";
  
  const jimpImage = await Jimp.read(imgPath);
  const { width, height, data } = jimpImage.bitmap;

  const results = await ocrService.recognize({
    width,
    height,
    data: new Uint8Array(data)
  });

  const processed = ocrService.processRecognition(results);
  console.log("=== DECODED WITH PREFIXED DICT ===");
  console.log(processed.text);
  console.log("=== LINES ===");
  processed.lines.forEach((l: any) => console.log(l.map((w: any) => w.text).join(' ')));
}

testWithBlankPrefixed().catch(console.error);
