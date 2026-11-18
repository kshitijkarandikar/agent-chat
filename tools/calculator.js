tool({
  name: "calculator",
  description: "Do exact maths. Always use this for calculations instead of working them out yourself.",
  inputs: {
    expression: { type: "string", description: "A maths expression using numbers and + - * / ( ), for example (240 * 17) / 100" }
  },
  run: async ({ expression }) => {
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return { error: "Only numbers, + - * / and brackets are allowed. Use a dot for decimals." };
    }
    const result = Function('"use strict"; return (' + expression + ')')();
    return { expression, result: Math.round(result * 1e6) / 1e6 };
  }
})
