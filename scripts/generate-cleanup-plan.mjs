import fs from 'fs';

const graph = JSON.parse(fs.readFileSync('.understand-anything/knowledge-graph.json', 'utf8'));

// Filter only files from the graph
const files = graph.nodes
  .filter(n => n.id.startsWith('file:') || n.type === 'file' || n.type === 'config' || n.type === 'document' || n.type === 'service' || n.type === 'test')
  .map(n => n.id.replace(/^(file|config|document|service|test):/, ''))
  .filter(f => !f.endsWith('.md')) // exclude markdown documentation for code cleanup
  .sort();

// Deduplicate
const uniqueFiles = [...new Set(files)];

const chunkCount = 50;
let markdown = `# Global Code Cleanup Implementation Plan\n\n`;
markdown += `## Objective\n`;
markdown += `Fix any dead code, duplicate logic, unused components, and unnecessary complexity in the app. Manually check each and every file, don't skip any file, and check for unnecessary dependencies. NO AGENT WILL ASSUME OR SKIP ANY FILE.\n\n`;
markdown += `## Total Files to Manually Check: ${uniqueFiles.length}\n\n`;

for (let i = 0; i < uniqueFiles.length; i += chunkCount) {
  const chunk = uniqueFiles.slice(i, i + chunkCount);
  markdown += `### Chunk ${Math.floor(i / chunkCount) + 1} (Files ${i + 1} to ${i + chunk.length})\n`;
  markdown += `**Agent Assigned:** [ ]\n`;
  markdown += `**Status:** [ ] Not Started / [ ] In Progress / [ ] Completed\n\n`;
  for (const file of chunk) {
    markdown += `- [ ] \`${file}\`\n`;
  }
  markdown += `\n`;
}

markdown += `## Unnecessary Dependencies Check\n`;
markdown += `- [ ] Audit \`package.json\`\n`;
markdown += `- [ ] Audit \`frontend/package.json\` (if exists)\n`;
markdown += `- [ ] Audit \`website/package.json\` (if exists)\n`;
markdown += `- [ ] Audit \`pharmacy-mobile/package.json\` (if exists)\n\n`;
markdown += `## Final Verification\n`;
markdown += `- [ ] Run build \`npm run build\` (or equivalent)\n`;
markdown += `- [ ] Run performance guardrails \`npm run guardrails\`\n`;
markdown += `- [ ] Run quick update \`node scripts/quick-update.mjs\`\n`;

fs.writeFileSync('GLOBAL_CODE_CLEANUP_IMPLEMENTATION_PLAN.md', markdown);
console.log(`Implementation plan created with ${uniqueFiles.length} files.`);
