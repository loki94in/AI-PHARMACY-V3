import fs from 'fs';
import path from 'path';

const MODELS_DIR = path.resolve(process.cwd(), 'data', 'models');
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

const FILES = [
  {
    name: 'det_model.onnx',
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/detection/v3/det.onnx'
  },
  {
    name: 'rec_model.onnx',
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/rec.onnx'
  },
  {
    name: 'en_dict.txt',
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/dict.txt'
  }
];

async function downloadFile(item) {
  const destPath = path.join(MODELS_DIR, item.name);
  console.log(`📥 Downloading ${item.name} from Hugging Face...`);
  const res = await fetch(item.url);
  if (!res.ok) {
    throw new Error(`Failed to download ${item.name}: HTTP ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`✅ Saved ${item.name} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);
}

async function main() {
  console.log('===============================================================');
  console.log('📦 INSTALLING PADDLEOCR ONNX NEURAL MODELS INTO data/models/');
  console.log('===============================================================\n');

  for (const item of FILES) {
    await downloadFile(item);
  }

  console.log('\n🎉 All model files installed into data/models/ successfully!\n');
}

main().catch(err => {
  console.error('❌ Download failed:', err);
  process.exit(1);
});
