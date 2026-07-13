// Extract plain text from a .docx (e.g. a Teams meeting transcript).
// Usage: node scripts/extract-docx.mjs <file.docx> [more.docx ...]
// Prints each document's text to stdout, one paragraph per line, preceded by
// `# file:` / `# created:` / `# modified:` metadata header lines.
import { readFileSync } from 'node:fs';
import { readZip, decodeXmlEntities } from './zip-util.mjs';

function docxText(zip) {
  const xml = zip.get('word/document.xml').toString('utf8');
  const lines = [];
  for (const rawPara of xml.split('</w:p>')) {
    // Drop paragraph/run property blocks so tab-stop definitions inside
    // <w:pPr> are not mistaken for literal tabs.
    const p = rawPara
      .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, '')
      .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '');
    let text = '';
    const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
    let m;
    while ((m = tokenRe.exec(p))) {
      if (m[1] !== undefined) text += decodeXmlEntities(m[1]);
      else if (m[0].startsWith('<w:tab')) text += '\t';
      else text += '\n';
    }
    lines.push(text);
  }
  // Collapse runs of blank lines to a single one.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function coreProps(zip) {
  const entry = zip.get('docProps/core.xml');
  if (!entry) return {};
  const xml = entry.toString('utf8');
  const grab = (tag) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
    return m ? m[1] : '';
  };
  return { created: grab('dcterms:created'), modified: grab('dcterms:modified'), title: grab('dc:title') };
}

for (const file of process.argv.slice(2)) {
  const zip = readZip(readFileSync(file));
  const meta = coreProps(zip);
  console.log(`# file: ${file}`);
  if (meta.title) console.log(`# title: ${meta.title}`);
  if (meta.created) console.log(`# created: ${meta.created}`);
  if (meta.modified) console.log(`# modified: ${meta.modified}`);
  console.log(docxText(zip));
  console.log('\n===== END OF DOCUMENT =====\n');
}
