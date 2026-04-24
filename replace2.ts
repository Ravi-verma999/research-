import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/#80808012/g, '#00e5ff10');

// Fix text coloring for headers and user vs agent
content = content.replace("bg-cyan-400 text-black", "bg-cyan-400 text-black shadow-[0_0_15px_rgba(0,229,255,0.4)]");

fs.writeFileSync('src/App.tsx', content);
