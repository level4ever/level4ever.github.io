// For addon-crosscheck.py: reads a JSON list of export strings on stdin,
// imports each with the website's importGuide and exports it again, and
// writes the new strings as a JSON list.

import { exportGuide, importGuide } from "../src/lib/guideString";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
}
const strings: string[] = JSON.parse(input);
const out = strings.map((text, i) => {
  const result = importGuide(text);
  if (!result.guide) {
    throw new Error(`string ${i + 1}: ${result.error}`);
  }
  // Strings from the addon always have a uid; a malformed one is dropped on import.
  result.guide.uid ??= "c0ffee";
  return exportGuide(result.guide);
});
process.stdout.write(JSON.stringify(out));
