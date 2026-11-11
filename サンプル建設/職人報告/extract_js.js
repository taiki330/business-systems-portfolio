const fs = require('fs');
const html = fs.readFileSync('../是正報告書システム/Index.html', 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let extracted = '';
let currentLine = 1;

const lines = html.split('\n');

while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (scriptContent.includes('<?!=')) {
        // Skip bootstrap script
        continue;
    }
    extracted += scriptContent + '\n';
}

fs.writeFileSync('extracted.js', extracted);
console.log('done extracted.js');
