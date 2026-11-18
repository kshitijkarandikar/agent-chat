tool({
  name: "btw_calculator",
  description: "Work out Dutch BTW (VAT) at 9% or 21%. Use it whenever the user asks about BTW on an amount.",
  inputs: {
    amount: { type: "number", description: "Amount in euros, for example 365.02" },
    rate: { type: "number", description: "BTW rate in percent: 9 or 21" },
    includes_btw: { type: "boolean", description: "true if the amount already includes BTW", optional: true }
  },
  run: async ({ amount, rate, includes_btw }) => {
    if (rate !== 9 && rate !== 21) return { error: "The rate must be 9 or 21" };
    const net = includes_btw ? amount / (1 + rate / 100) : amount;
    const btw = net * rate / 100;
    return { net: net.toFixed(2), btw: btw.toFixed(2), total: (net + btw).toFixed(2) };
  }
})
