/**
 * Component: BillReceipt
 *
 * On-screen GST invoice for one saved bill, laid out like the paper
 * invoice (shop header, GSTIN / D.L. no., patient and doctor, one row per
 * batch, taxable / CGST / SGST / round off, bill amount). Used on the
 * receipt screen after billing and in the Bill History dialog.
 *
 * Expects the bill shape returned by:
 *   POST /api/v1/kendras/:id/bill
 *   GET  /api/v1/kendras/:id/bills
 */

import {
  SHOP_TITLE, formatPlain, formatBillDateTime, invoiceRows, invoiceTitle,
} from '../../utils/billing'

function Line({ label, value, strong = false }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? 'font-extrabold text-base pt-1' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function BillReceipt({ bill }) {
  const shop = bill.kendra ?? {}
  const { date, time } = formatBillDateTime(bill.billed_at)
  const half = (Number(bill.gst_percentage) || 0) / 2
  const rows = invoiceRows(bill)

  return (
    <div
      data-testid="bill-receipt"
      className="border border-slate-400 text-slate-900 text-xs bg-white"
    >
      <p className="text-center font-bold py-1 border-b border-slate-400 tracking-wide">
        {invoiceTitle(bill)}
      </p>

      <div className="flex flex-col sm:flex-row justify-between gap-3 p-3 border-b border-slate-400">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold leading-tight">{SHOP_TITLE}</h2>
          {shop.name && <p className="mt-1">{shop.name}</p>}
          {shop.address && <p>{shop.address}</p>}
          {shop.phone && <p>PH : {shop.phone}</p>}
        </div>
        <dl className="shrink-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 content-start">
          {shop.gstin && (<><dt className="font-bold">GSTIN</dt><dd>: {shop.gstin}</dd></>)}
          {shop.drug_license_no && (<><dt className="font-bold">D.L.NO.</dt><dd>: {shop.drug_license_no}</dd></>)}
          <dt>Bill No</dt><dd>: <b>{bill.bill_number}</b></dd>
          <dt>Bill Date</dt><dd>: {date}</dd>
          <dt>Time</dt><dd>: {time}</dd>
        </dl>
      </div>

      <div className="flex justify-between gap-3 px-3 py-1.5 border-b border-slate-400 font-bold">
        <span>
          Patient : {(bill.customer_name || '').toUpperCase()}
          {bill.customer_phone && <span className="font-normal"> ({bill.customer_phone})</span>}
        </span>
        {bill.doctor_name && <span>Dr: {bill.doctor_name.toUpperCase()}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <thead>
            <tr className="text-left border-b border-slate-400">
              <th className="px-2 py-1.5">Mfr.</th>
              <th className="px-2 py-1.5">Item Name</th>
              <th className="px-2 py-1.5">GST</th>
              <th className="px-2 py-1.5">Pkg</th>
              <th className="px-2 py-1.5">Batch</th>
              <th className="px-2 py-1.5">Exp</th>
              <th className="px-2 py-1.5 text-right">Mrp.</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-2 py-1">{r.mfr}</td>
                <td className="px-2 py-1 uppercase">{r.name}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.gst} %</td>
                <td className="px-2 py-1 uppercase whitespace-nowrap">{r.pack}</td>
                <td className="px-2 py-1 uppercase">{r.batch}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.exp}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatPlain(r.mrp)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.qty}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatPlain(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 p-3 mt-3 border-t border-slate-400">
        <dl className="flex flex-col gap-0.5">
          <Line label="Total (MRP)" value={formatPlain(bill.subtotal)} />
          {bill.discount > 0 && <Line label="Discount" value={`- ${formatPlain(bill.discount)}`} />}
          <Line label="Taxable" value={formatPlain(bill.taxable_value)} />
          <Line label={`CGST ${half}%`} value={formatPlain(bill.cgst)} />
          <Line label={`SGST ${half}%`} value={formatPlain(bill.sgst)} />
          <Line label="Round Off" value={formatPlain(bill.round_off)} />
        </dl>
        <dl>
          <Line strong label="Bill Amount :" value={formatPlain(bill.total_amount)} />
        </dl>
      </div>

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-3 py-2 border-t border-slate-400 font-bold">
        <span>Billed By : {(bill.billed_by_name || '').toUpperCase()}</span>
        <span>Pharmacist:</span>
        <span>For {SHOP_TITLE}</span>
      </div>
    </div>
  )
}

export default BillReceipt