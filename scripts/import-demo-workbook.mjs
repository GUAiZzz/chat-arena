import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { normalizeRows, suggestMapping } from "../shared/data-adapter.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(process.argv[2] || path.join(root, "..", "闲聊偏好数据-for搭建Arena.xlsx"));
const outputPath = path.join(root, "fixtures", "demo-dataset.js");

const vendor = await fs.readFile(path.join(root, "public", "vendor", "xlsx.full.min.js"), "utf8");
const context = vm.createContext({ console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder });
vm.runInContext(vendor, context, { filename: "xlsx.full.min.js" });

const workbook = context.XLSX.read(await fs.readFile(sourcePath), { type: "buffer" });
const sheetName = workbook.SheetNames[0];
const rows = context.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true, blankrows: false });
if (!rows.length) throw new Error("源工作簿没有可用数据。");

const { mapping } = suggestMapping(Object.keys(rows[0]));
const normalized = normalizeRows(rows, mapping);
if (normalized.errors.length) throw new Error(normalized.errors.map((item) => item.message).join("\n"));

const samples = normalized.samples.map((sample) => ({
  id: `local-${sample.source_uid}`,
  ...sample
}));
const header = [
  "// Generated from the supplied chat preference workbook.",
  `// Source: ${path.basename(sourcePath)} · sheet: ${sheetName}`,
  `// ${normalized.summary.total_rows} raw rows, ${samples.length} unique demo cases, ${normalized.summary.excluded_duplicate_rows} duplicate excluded.`,
  "// Run `npm run demo:import -- /absolute/path/to/workbook.xlsx` to refresh.",
  ""
].join("\n");

await fs.writeFile(outputPath, `${header}export const demoSummary = ${JSON.stringify(normalized.summary, null, 2)};\n\nexport const demoSamples = ${JSON.stringify(samples, null, 2)};\n`, "utf8");
console.log(`Imported ${samples.length} unique cases from ${path.basename(sourcePath)} (${sheetName}).`);
