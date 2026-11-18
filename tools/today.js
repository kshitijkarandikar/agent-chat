tool({
  name: "today",
  description: "Get today's date, the weekday and the current time on this computer.",
  inputs: {},
  run: async () => {
    const now = new Date();
    return {
      date: now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      time: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      iso_date: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0")
    };
  }
})
