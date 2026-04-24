import { EPub } from 'epub2';
import { convert } from 'html-to-text';

async function test() {
  const epub = await EPub.createAsync('./test.epub');
  let text = '';
  for (const chapter of epub.flow) {
    const chapterText = await epub.getChapterAsync(chapter.id);
    text += convert(chapterText) + '\n\n';
  }
  console.log(text.substring(0, 100));
}
test().catch(console.error);
