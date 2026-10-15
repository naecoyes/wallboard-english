// Vocabulary belongs to the displayed paragraph, in order of appearance.
const COMMON = new Set('a an the i you he she it we they me my our your their this that these those is am are was were be been being have has had do does did will would can could should may might must and or but so if as at by for from in into of on to with not no its'.split(' '));
export function paragraphVocabulary(text, dictionary) {
  const seen = new Set();
  const result = [];
  for (const raw of text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []) {
    const word = raw.toLowerCase().replace(/’/g, "'");
    if (seen.has(word) || COMMON.has(word)) continue;
    seen.add(word);
    const entry = dictionary[word];
    if (!entry) continue;
    result.push([word, entry[0], entry[1].replace(/\\n/g, '\n')]);
  }
  return result;
}
