declare module 'ahocorasick' {
  export type AhoCorasickMatch = [number, string[]];

  export default class AhoCorasick {
    constructor(keywords: string[]);
    search(text: string): AhoCorasickMatch[];
  }
}
