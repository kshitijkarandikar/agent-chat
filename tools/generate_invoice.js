tool({
  name: "generate_invoice",
  description: "Creates a downloadable HTML invoice for a provided service using a predefined template. Use this when the user wants to bill a client or send an invoice.",
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
  run: async (inputs, { readTemplate, fillTemplate, resourceDataUrl, saveFile }) => {
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

    // Read the base HTML template from the resources folder
    let template = "";
    try {
      template = readTemplate("invoice.html");
    } catch (e) {
      return { error: "Could not read invoice.html template. Ensure it exists in resources/templates/." };
    }

    // Prepare the data to insert into the template
    const lineItemsHtml = `
        <tr>
          <td>${service_description}</td>
          <td style="text-align: right;">${amount.toFixed(2)} ${currency}</td>
        </tr>
        <tr class="total-row">
          <td></td>
          <td style="text-align: right;">Total: ${amount.toFixed(2)} ${currency}</td>
        </tr>
    `;

    const templateData = {
      sender_name: sender_name || "Your Company",
      invoice_id: invoiceId,
      date: new Date().toLocaleDateString('en-GB'),
      due_date: dueDateDisplay,
      client_name: client_name,
      client_email: client_email,
      items: lineItemsHtml
    };

    // Fill the template with the data.
    // fillTemplate safely replaces {{key}} placeholders.
    // We assume the template uses {{sender_name}}, {{invoice_id}}, etc.
    // If the template uses specific variable names, adjust templateData keys accordingly.
    const htmlContent = fillTemplate(template, templateData);

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
