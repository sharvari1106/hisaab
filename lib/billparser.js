// Turns OCR / pasted supplier-bill text into item lines.
// Typical line:  "SURF XL EZY WSH 1KG     10    95.00    950.00"
//                 ^ item text (sizes stay attached)  ^qty ^rate  ^amount
const SKIP = /^(total|sub ?total|grand|gst|cgst|sgst|igst|tax|invoice|bill|date|thank|amount|net|round|discount|qty|item|sl\.?|s\.no|particulars|gstin|phone|ph:|mob)/i;
const NUM = /^\d{1,7}(?:[.,]\d{1,2})?$/;

export function parseBillText(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[|₹]/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 4 || SKIP.test(line)) continue;

    const tokens = line.split(' ');
    const numbers = [];
    while (tokens.length && NUM.test(tokens[tokens.length - 1]) && numbers.length < 3) {
      numbers.unshift(parseFloat(tokens.pop().replace(',', '.')));
    }
    if (!numbers.length) continue; // headers like the supplier's name have no quantity/rate
    // drop a leading serial number like "1." or "12)"
    if (tokens.length > 1 && /^\d{1,3}[.)]?$/.test(tokens[0])) tokens.shift();
    const item = tokens.join(' ').trim();
    if (!/[a-z]{2,}/i.test(item)) continue;

    let qty = null;
    let rate = null;
    if (numbers.length === 3) [qty, rate] = numbers;           // qty rate amount
    else if (numbers.length === 2) [qty, rate] = numbers;      // qty rate
    else if (numbers.length === 1) {
      if (Number.isInteger(numbers[0]) && numbers[0] <= 500) qty = numbers[0];
      else rate = numbers[0];
    }
    if (qty !== null && (!Number.isInteger(qty) || qty <= 0)) {
      // looks like "rate amount" instead - swap guess
      rate = rate ?? qty;
      qty = null;
    }
    lines.push({ raw: raw.trim(), item, qty: qty ?? 1, rate });
    if (lines.length >= 60) break;
  }
  return lines;
}
