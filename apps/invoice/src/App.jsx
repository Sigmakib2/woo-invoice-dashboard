import React, { useState, useEffect } from 'react';

const App = () => {
  const [invoiceData, setInvoiceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Replace with your logo path
  const logoSrc = 'https://example.com/logo.png';
  const baseUrl = 'https://example.workers.dev'; // Your API endpoint

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchInvoiceData = async () => {
      try {
        if (typeof window === 'undefined') return;

        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('id');
        if (!token) throw new Error('No invoice token/id in URL. Add `?id=YOUR_TOKEN`.');

        const apiUrl = `${baseUrl}/invoice?token=${encodeURIComponent(token)}`;
        const res = await fetch(apiUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`Server responded ${res.status}. Token may be invalid.`);

        const data = await res.json();
        if (data?.error) throw new Error(String(data.error));

        if (isMounted) {
          setInvoiceData(data);
          setLoading(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (isMounted) {
          setError(err.message || 'Unknown error');
          setLoading(false);
        }
      }
    };

    fetchInvoiceData();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  // Helpers
  const formatDate = (d) => {
    if (!d) return 'N/A';
    try {
      return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return d; }
  };

  const formatCurrency = (amount, currency) => {
    const cur = currency || 'BDT';
    const val = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(val);
    } catch { return `${cur} ${val.toFixed(2)}`; }
  };

  const statusStyles = (s) => {
    const k = s?.toLowerCase();
    if (k === 'completed') return 'bg-[#E6F4EA] text-[#255B2A]';
    if (k === 'processing') return 'bg-[#FFF3DA] text-[#735100]';
    if (k === 'pending' || k === 'on-hold') return 'bg-[#FFE7D6] text-[#8A3C19]';
    if (k === 'cancelled' || k === 'refunded') return 'bg-[#EEE8E6] text-[#6B4F4F]';
    return 'bg-[#E9F2FF] text-[#1E4B7A]';
  };

  const paymentStyles = (m) => {
    const k = m?.toLowerCase();
    if (k === 'cod' || k === 'cash on delivery') return 'bg-[#FFE7D6] text-[#8A3C19]';
    if (k === 'bkash' || k === 'nagad' || k === 'rocket') return 'bg-[#FCE3F2] text-[#7A2D5A]';
    if (k === 'card' || k === 'stripe') return 'bg-[#EDEBFF] text-[#3C2F8D]';
    if (k === 'paypal') return 'bg-[#E9F2FF] text-[#1E4B7A]';
    return 'bg-[#EEE8E6] text-[#6B4F4F]';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF7F1] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-4xl mx-auto p-12">
          <div className="text-center" role="status" aria-live="polite">
            <div className="w-12 h-12 border-4 border-[#F7B267]/40 border-t-[#F7B267] rounded-full animate-spin mx-auto mb-6" />
            <p className="text-lg font-semibold text-[#6B4F4F]">Loading invoice…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FFF7F1] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-2xl mx-auto p-10">
          <div className="text-center">
            <p className="text-xl font-extrabold text-[#8B3A3A] mb-2">Could not load the invoice</p>
            <p className="text-[#6B4F4F] font-medium">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const {
    order = {},
    billing_address = {},
    shipping_address = {},
    items = [],
    totals = {},
    payment = {},
  } = invoiceData || {};

  return (
    <div className="min-h-screen bg-[#FFF7F1] text-[#3B2F2F]">
      <div
        className="w-full max-w-4xl mx-auto border-2 border-[#E8DAD2] rounded-3xl
                   shadow-[0_8px_24px_rgba(107,79,79,0.08)] overflow-hidden bg-white print-border"
      >
        {/* Header */}
        <header className="bg-gradient-to-b from-[#f7f3f0] to-[#fff5ee] border-b border-[#F2DFD5]/80 px-6 lg:px-10 py-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <img src={logoSrc} alt="logo" className="h-14 w-auto" />

            </div>
            <div className="text-left lg:text-right">
              <h2 className="text-2xl lg:text-3xl font-extrabold tracking-wide text-[#6B4F4F]">Invoice</h2>
              <div className="mt-2 grid grid-cols-1 gap-1 text-sm">
                <div><span className="font-semibold text-[#8A6B5C]">Order #:</span> {order.order_number ?? '—'}</div>
                <div><span className="font-semibold text-[#8A6B5C]">Order Date:</span> {formatDate(order.created_at)}</div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#8A6B5C]">Status:</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${statusStyles(order.status)}`}>
                    {order.status ?? 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Addresses */}
        <section className="px-6 lg:px-10 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-[#F0E4DD] shadow-sm p-6">
            <h3 className="text-xs font-bold tracking-widest text-[#8A6B5C] mb-3">BILL TO</h3>
            <p className="text-lg font-extrabold">{billing_address.name ?? '—'}</p>
            <p>{billing_address.address_1 ?? '—'}</p>
            <p>{billing_address.city ?? '—'}{billing_address.postcode ? `, ${billing_address.postcode}` : ''}</p>
            <p>{billing_address.country === 'BD' ? 'Bangladesh' : billing_address.country || '—'}</p>
            {billing_address.email && <p>{billing_address.email}</p>}
            {billing_address.phone && <p>{billing_address.phone}</p>}
          </div>
          <div className="bg-white rounded-2xl border border-[#F0E4DD] shadow-sm p-6">
            <h3 className="text-xs font-bold tracking-widest text-[#8A6B5C] mb-3">SHIP TO</h3>
            <p className="text-lg font-extrabold">{shipping_address.name ?? billing_address.name ?? '—'}</p>
            <p>{shipping_address.address_1 ?? billing_address.address_1 ?? '—'}</p>
            <p>{shipping_address.city ?? billing_address.city ?? '—'}{shipping_address.postcode ? `, ${shipping_address.postcode}` : ''}</p>
            <p>{shipping_address.country === 'BD' ? 'Bangladesh' : shipping_address.country || billing_address.country || '—'}</p>
            {(shipping_address.phone || billing_address.phone) && <p>{shipping_address.phone || billing_address.phone}</p>}
          </div>
        </section>

        {/* Items */}
        <section className="px-6 lg:px-10 pb-8">
          <div className="bg-white rounded-2xl border border-[#F0E4DD] shadow-sm overflow-hidden">
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#FFF0E4] text-[#6B4F4F]">
                  <tr className="text-xs tracking-widest uppercase">
                    <th className="text-left p-4 font-bold">Item</th>
                    <th className="text-right p-4 font-bold">Qty</th>
                    <th className="text-right p-4 font-bold">Unit Price</th>
                    <th className="text-right p-4 font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id || item.sku || item.name} className="border-t border-[#F5ECE6] hover:bg-[#FFF7F1]">
                      <td className="p-4">
                        <a
                          href={item?.product_details?.permalink || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3"
                        >
                          <img
                            src={item?.image?.thumbnail || 'https://via.placeholder.com/64'}
                            alt={item?.name || 'Product image'}
                            className="w-14 h-14 rounded-xl object-cover border border-[#F0E4DD]"
                            loading="lazy"
                          />
                          <span className="font-semibold">{item?.name || 'Unnamed item'}</span>
                        </a>
                      </td>
                      <td className="text-right p-4">{item?.quantity ?? 0}</td>
                      <td className="text-right p-4">{formatCurrency(item?.price, totals?.currency)}</td>
                      <td className="text-right p-4 font-bold text-[#E87A5C]">
                        {formatCurrency(item?.total, totals?.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-[#F5ECE6]">
              {items.length === 0 && (
                <div className="p-4 text-sm text-[#6B4F4F]">No items found.</div>
              )}

              {items.map((item) => (
                <a
                  key={item.id || item.sku || item.name}
                  href={item?.product_details?.permalink || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 active:bg-[#FFF7F1]"
                >
                  <div className="flex gap-3">
                    <img
                      src={item?.image?.thumbnail || 'https://via.placeholder.com/64'}
                      alt={item?.name || 'Product image'}
                      className="w-16 h-16 rounded-xl object-cover border border-[#F0E4DD] flex-shrink-0"
                      loading="lazy"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-[#3B2F2F] mb-1 truncate">
                        {item?.name || 'Unnamed item'}
                      </h4>
                      <div className="text-xs text-[#6B4F4F] space-y-1">
                        <div className="flex justify-between">
                          <span>Qty</span><span className="font-semibold">{item?.quantity ?? 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Unit</span><span className="font-medium">{formatCurrency(item?.price, totals?.currency)}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-[#F5ECE6]">
                          <span className="font-semibold">Total</span>
                          <span className="font-extrabold text-[#E87A5C]">
                            {formatCurrency(item?.total, totals?.currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>


        {/* Summary */}
        <section className="px-6 lg:px-10 pb-8">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="bg-white rounded-2xl border border-[#F0E4DD] shadow-sm p-6 flex-1">
              <h3 className="text-xs font-bold tracking-widest text-[#8A6B5C] mb-3">PAYMENT METHOD</h3>
              <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-bold ${paymentStyles(payment?.method)}`}>
                {payment?.method ? (payment.method.toLowerCase() === 'cod' ? 'Cash on Delivery' : payment.method.toUpperCase()) : '—'}
              </span>
            </div>
            <div className="bg-white rounded-2xl border border-[#F0E4DD] shadow-sm p-6 flex-1 max-w-sm ml-auto">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals?.subtotal, totals?.currency)}</span></div>
                <div className="flex justify-between"><span>Shipping</span><span>{formatCurrency(totals?.shipping_total, totals?.currency)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>- {formatCurrency(totals?.discount_total, totals?.currency)}</span></div>
                <div className="h-px bg-[#F5ECE6]" />
                <div className="flex justify-between items-center">
                  <span className="text-xl font-extrabold">Total</span>
                  <span className="ml-5 text-2xl font-extrabold text-[#E87A5C]">{formatCurrency(totals?.total, totals?.currency)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Print Button */}
        <div className="px-6 lg:px-10 pb-8">
          <button onClick={() => window.print()} className="rounded-full px-4 py-2 text-sm font-semibold bg-[#F7B267] text-white hover:opacity-90 active:opacity-80">
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { background: white; }
          .print-border { border: 2px solid #E8DAD2 !important; }
          button { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default App;
