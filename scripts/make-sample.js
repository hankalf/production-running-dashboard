/* Generates sample/sample-schedule.xlsx — a realistic production schedule
 * for today, handy for trying the dashboard out. Run: npm run sample */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const pad2 = (n) => String(n).padStart(2, '0');
const today = new Date();
const dateStr = `${pad2(today.getDate())}/${pad2(today.getMonth() + 1)}/${today.getFullYear()}`;

const rows = [
  ['Date', 'Machine', 'Start', 'End', 'Product', 'Order #', 'Qty', 'Allergens', 'Notes'],
  [dateStr, 'Machine 1', '06:00', '10:00', 'Chocolate Digestives 400g', 'PO-10231', 12000, 'Gluten, Milk', ''],
  [dateStr, 'Machine 1', '10:30', '14:30', 'Chocolate Digestives 250g', 'PO-10232', 9000, 'Gluten, Milk', 'Changeover 30 min'],
  [dateStr, 'Machine 1', '15:00', '22:00', 'Dark Choc Digestives 400g', 'PO-10233', 15000, 'Gluten', ''],
  [dateStr, 'Machine 2', '06:00', '12:00', 'Oat Crunch 300g', 'PO-10240', 18000, 'None', ''],
  [dateStr, 'Machine 2', '12:30', '18:00', 'Oat Crunch Multipack', 'PO-10241', 7500, '', 'New film reel'],
  [dateStr, 'Machine 2', '18:30', '22:00', 'Peanut Crunch 500g', 'PO-10242', 6000, 'Peanuts', 'Deep clean after run'],
  [dateStr, 'Machine 3', '07:00', '11:00', 'Ginger Nuts 250g', 'PO-10250', 10000, 'Gluten', ''],
  [dateStr, 'Machine 3', '11:30', '15:30', 'Hazelnut Cookies 500g', 'PO-10251', 16000, 'Tree nuts, Gluten', ''],
  [dateStr, 'Machine 3', '16:00', '21:00', 'Mixed Selection Tin', 'PO-10252', 4000, 'None', 'Priority order'],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Schedule');

const outDir = path.join(__dirname, '..', 'sample');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'sample-schedule.xlsx');
XLSX.writeFile(wb, out);
console.log('Wrote ' + out);
