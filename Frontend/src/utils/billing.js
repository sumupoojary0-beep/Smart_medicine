/**
 * Billing helpers shared by the Billing page, Bill History page and the
 * printable GST invoice.
 *
 * Maths follows an Indian MRP-inclusive invoice: the MRP already contains
 * GST, so tax is taken OUT of the amount (not added on top).
 */

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi',  label: 'UPI' },
  { value: 'card', label: 'Card' },
]

export const GST_OPTIONS = [0, 5, 12, 18]
export const DEFAULT_GST = 5

export const SHOP_TITLE = 'Pradhan Mantri Bhartiya Janaushadhi Kendra'
export const MFR_CODE = 'PMB'

export function paymentLabel(value) {
  return PAYMENT_METHODS.find((p) => p.value === value)?.label ?? 'Cash'
}

/** 1234.5 -> "₹1,234.50" (Indian digit grouping, always 2 decimals). */
export function formatINR(value) {
  const n = Number(value) || 0
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** 639.4 -> "639.40" (plain number, as printed on the invoice). */
export function formatPlain(value) {
  return (Number(value) || 0).toFixed(2)
}

const cents = (n) => Math.round((Number(n) || 0) * 100)

/**
 * Live preview of the invoice totals. The server recalculates the same
 * numbers when the bill is saved, and its figures are the ones printed.
 *
 * lines: [{ price, quantity }]
 */
export function computeTotals(lines, discount, gstPercentage) {
  const subtotalC = lines.reduce((sum, l) => sum + cents(l.price) * (Number(l.quantity) || 0), 0)
  const discountC = Math.max(cents(discount), 0)
  const netC = subtotalC - discountC
  const rate = Number(gstPercentage) || 0

  const taxableC = netC > 0 ? Math.round((netC * 100) / (100 + rate)) : 0
  const gstC = netC > 0 ? netC - taxableC : 0
  const cgstC = Math.round(gstC / 2)
  const sgstC = gstC - cgstC
  const totalC = netC > 0 ? Math.round(netC / 100) * 100 : 0

  return {
    subtotal: subtotalC / 100,
    discount: discountC / 100,
    taxable: taxableC / 100,
    cgst: cgstC / 100,
    sgst: sgstC / 100,
    gstAmount: gstC / 100,
    roundOff: netC > 0 ? (totalC - netC) / 100 : 0,
    total: totalC / 100,
    discountTooHigh: discountC > subtotalC,
  }
}

// The API sends UTC; older responses may omit the trailing "Z".
function asDate(value) {
  const s = String(value)
  return new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`)
}

/** "2027-12-31T00:00:00" -> "12/27" */
export function formatExpiry(value) {
  if (!value) return '-'
  const d = asDate(value)
  if (Number.isNaN(d.getTime())) return '-'
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0')
  return `${mm}/${yy}`
}

/** Date "03-08-2026" and time "12:53 pm", in Indian time. */
export function formatBillDateTime(value) {
  const d = asDate(value)
  const date = d
    .toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-')
  const time = d
    .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
  return { date, time }
}

/**
 * One invoice row per batch used, like pharmacy billing software:
 * Mfr | Item | GST | Pkg | Batch | Exp | MRP | Qty | Amount
 */
export function invoiceRows(bill) {
  const rows = []
  bill.items.forEach((item) => {
    const batches = item.batches_used ?? []
    const name = item.item_name || item.medicine_name
    if (batches.length === 0) {
      rows.push({
        key: `${item.pmbi_code}-0`, mfr: MFR_CODE, name, gst: bill.gst_percentage,
        pack: item.pack_size ?? '', batch: '-', exp: '-',
        mrp: item.unit_price, qty: item.quantity, amount: item.line_total,
      })
      return
    }
    batches.forEach((b, i) => {
      rows.push({
        key: `${item.pmbi_code}-${i}`, mfr: MFR_CODE, name, gst: bill.gst_percentage,
        pack: item.pack_size ?? '', batch: b.batch_number, exp: formatExpiry(b.expiry_date),
        mrp: item.unit_price, qty: b.quantity_deducted,
        amount: Math.round(item.unit_price * 100 * b.quantity_deducted) / 100,
      })
    })
  })
  return rows
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

export function invoiceTitle(bill) {
  return `GST ${paymentLabel(bill.payment_method).toUpperCase()} INVOICE`
}

/**
 * Open a clean, print-ready GST invoice in a new window and print it.
 * Only the invoice is printed, not the app around it.
 */
export function printBill(bill) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false

  const shop = bill.kendra ?? {}
  const { date, time } = formatBillDateTime(bill.billed_at)
  const half = (Number(bill.gst_percentage) || 0) / 2

  const rows = invoiceRows(bill)
    .map((r) => `<tr>
      <td>${esc(r.mfr)}</td><td>${esc(String(r.name).toUpperCase())}</td>
      <td>${esc(r.gst)} %</td><td>${esc(String(r.pack).toUpperCase())}</td>
      <td>${esc(String(r.batch).toUpperCase())}</td><td>${esc(r.exp)}</td>
      <td class="r">${formatPlain(r.mrp)}</td><td class="r">${esc(r.qty)}</td>
      <td class="r">${formatPlain(r.amount)}</td></tr>`)
    .join('')

  const totalRow = (label, value, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${label}</td><td class="r">${esc(value)}</td></tr>`

  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>Bill ${esc(bill.bill_number)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:14px}
  .box{border:1px solid #000}
  .title{text-align:center;font-weight:bold;padding:3px 0;border-bottom:1px solid #000}
  .head{display:flex;justify-content:space-between;gap:12px;padding:8px;border-bottom:1px solid #000}
  .head h1{font-size:15px;margin:0 0 4px}
  .head p{margin:1px 0}
  .head > div{flex:1;min-width:0}
  .meta{flex-shrink:0}
  .meta td{padding:1px 8px 1px 0;white-space:nowrap}
  .pt{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #000;font-weight:bold}
  table.items{width:100%;border-collapse:collapse}
  table.items th{text-align:left;padding:4px 6px;border-bottom:1px solid #000}
  table.items td{padding:3px 6px}
  .r{text-align:right;white-space:nowrap}
  .fill{min-height:70px}
  .totals{display:flex;justify-content:space-between;align-items:flex-end;padding:8px;border-top:1px solid #000}
  .totals table td{padding:1px 14px 1px 0}
  .totals .strong td{font-weight:bold;font-size:15px;padding-top:6px}
  .foot{display:flex;justify-content:space-between;padding:6px 8px;border-top:1px solid #000;font-weight:bold}
  .note{text-align:center;margin-top:6px}
</style></head><body>
<div class="box">
  <div class="title">${esc(invoiceTitle(bill))}</div>
  <div class="head">
    <div>
      <h1>${esc(SHOP_TITLE)}</h1>
      <p>${esc(shop.name || '')}</p>
      <p>${esc(shop.address || '')}</p>
      ${shop.phone ? `<p>PH : ${esc(shop.phone)}</p>` : ''}
    </div>
    <table class="meta">
      ${shop.gstin ? `<tr><td><b>GSTIN</b></td><td>: ${esc(shop.gstin)}</td></tr>` : ''}
      ${shop.drug_license_no ? `<tr><td><b>D.L.NO.</b></td><td>: ${esc(shop.drug_license_no)}</td></tr>` : ''}
      <tr><td>Bill No</td><td>: <b>${esc(bill.bill_number)}</b></td></tr>
      <tr><td>Bill Date</td><td>: ${esc(date)}</td></tr>
      <tr><td>Time</td><td>: ${esc(time)}</td></tr>
    </table>
  </div>
  <div class="pt">
    <span>Patient : ${esc(String(bill.customer_name || '').toUpperCase())}${bill.customer_phone ? ` (${esc(bill.customer_phone)})` : ''}</span>
    <span>${bill.doctor_name ? `Dr: ${esc(String(bill.doctor_name).toUpperCase())}` : ''}</span>
  </div>
  <table class="items">
    <thead><tr><th>Mfr.</th><th>Item Name</th><th>GST</th><th>Pkg</th><th>Batch</th><th>Exp</th>
      <th class="r">Mrp.</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="fill"></div>
  <div class="totals">
    <table>
      ${totalRow('Total (MRP)', formatPlain(bill.subtotal))}
      ${bill.discount > 0 ? totalRow('Discount', `- ${formatPlain(bill.discount)}`) : ''}
      ${totalRow('Taxable', formatPlain(bill.taxable_value))}
      ${totalRow(`CGST ${half}%`, formatPlain(bill.cgst))}
      ${totalRow(`SGST ${half}%`, formatPlain(bill.sgst))}
      ${totalRow('Round Off', formatPlain(bill.round_off))}
    </table>
    <table>${totalRow('Bill Amount :', formatPlain(bill.total_amount), true)}</table>
  </div>
  <div class="foot">
    <span>Billed By : ${esc(String(bill.billed_by_name || '').toUpperCase())}</span>
    <span>Pharmacist:</span>
    <span>For ${esc(SHOP_TITLE)}</span>
  </div>
</div>
<p class="note">NO REFUND OR EXCHANGE OF ITEMS ONCE SOLD.</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`)
  w.document.close()
  return true
}