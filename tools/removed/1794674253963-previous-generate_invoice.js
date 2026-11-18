tool({
  name: "generate_invoice",
  description: "Creates a downloadable HTML invoice for a provided service. Use this when the user wants to bill a client or send an invoice.",
  inputs: {
    client_name: { type: "string", description: "The name of the client paying the invoice" },
    client_email: { type: "string", description: "The contact email for the client" },
    sender_name: { type: "string", description: "Your company or name" },
    service_description: { type: "string", description: "Brief description of the service provided" },
    amount: { type: "number", description: "The total amount to bill, including VAT" },
    currency: { type: "string", description: "Currency code (e.g., EUR, USD)", optional: true },
    due_date: { type: "string", description: "Due date in YYYY-MM-DD format", optional: true }
  },
  needs: [],
  ask_first: true,
  run: async (inputs) => {
    const {
      client_name,
      client_email,
      sender_name,
      service_description,
      amount,
      currency,
      due_date
    } = inputs;

    // Default to EUR if not provided
    if (!currency) currency = "EUR";
    
    // Generate a unique ID based on time
    const invoiceId = "INV-" + Date.now();
    
    // Format the date for display
    const dueDateDisplay = due_date 
      ? new Date(due_date).toLocaleDateString('en-GB')
      : "N/A";

    // Build the HTML string. We use template literals to insert variables.
    const htmlContent = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
          .header { display: flex; justify-content: space-between; margin-bottom: 30px; }
          .invoice-details { text-align: right; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background-color: #f4f4f4; padding: 12px; text-align: left; border-bottom: 2px solid #ddd; }
          td { padding: 12px; border-bottom: 1px solid #ddd; }
          .total-row { font-weight: bold; background-color: #f9f9f9; }
          .footer { margin-top: 50px; font-size: 12px; color: #888; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>${sender_name || "Your Company"}</div>
            <p>Invoice #${invoiceId}</p>
          </div>
          <div class="invoice-details">
            <p>Due Date: ${dueDateDisplay}</p>
            <p>Date: ${new Date().toLocaleDateString('en-GB')}</p>
          </div>
        </div>
        <h3>Billed To:</h3>
        <p>
          <strong>${client_name}</strong><br>
          ${client_email}
        </p>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${service_description}</td>
              <td style="text-align: right;">${amount.toFixed(2)} ${currency}</td>
            </tr>
            <tr class="total-row">
              <td></td>
              <td style="text-align: right;">Total: ${amount.toFixed(2)} ${currency}</td>
            </tr>
          </tbody>
        </table>
        <div class="footer">
          Thank you for your business.
        </div>
      </body>
      </html>
    `;

    // Save the file. The app will show this as a download link in the chat.
    const fileName = `invoice_${invoiceId}.html`;
    saveFile(fileName, htmlContent);

    return { 
      success: true, 
      message: `Invoice ${invoiceId} generated and saved as ${fileName}.`,
      file_name: fileName 
    };
  }
})
