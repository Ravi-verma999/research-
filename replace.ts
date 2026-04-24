import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

// Fix weird class replacements
content = content.replace(/rounded-sm-none/g, 'rounded-none');
content = content.replace(/rounded-sm-br-sm/g, 'rounded-br-sm');
content = content.replace(/rounded-sm-tl-sm/g, 'rounded-tl-sm');
content = content.replace(/rounded-sm-full/g, 'rounded-full');

// Make it more vibrant blue/cyan
content = content.replace(/cyan-500/g, 'cyan-400');
content = content.replace(/cyan-600/g, 'cyan-500');

fs.writeFileSync('src/App.tsx', content);
console.log('Class names fixed');
