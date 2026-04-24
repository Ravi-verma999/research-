import * as cheerio from 'cheerio';
async function test() {
  const q = "bug bounty tips";
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: any[] = [];
  $('.result').each((i, el) => {
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const url = $(el).find('.result__url').attr('href');
    if (title && snippet) results.push({title, description: snippet, url});
  });
  console.log(results);
}
test();
