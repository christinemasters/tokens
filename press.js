document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#press-form");
  const status = document.querySelector("#press-form-status");
  const copyButton = document.querySelector("[data-copy-command]");
  const command = "curl -fsSL https://allthetokenswehaveleft.com/press.txt";

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const data = new FormData(form);
      const type = String(data.get("type") || "press");
      const aliases = {
        press: "press",
        reviews: "reviews",
        rights: "rights",
        events: "events",
        info: "info"
      };
      const labels = {
        press: "Press inquiry",
        reviews: "Review inquiry",
        rights: "Rights inquiry",
        events: "Event inquiry",
        info: "Source inquiry"
      };
      const destination = `${aliases[type] || "press"}@allthetokenswehaveleft.com`;
      const name = String(data.get("name") || "").trim();
      const email = String(data.get("email") || "").trim();
      const outlet = String(data.get("outlet") || "").trim();
      const deadline = String(data.get("deadline") || "").trim();
      const message = String(data.get("message") || "").trim();
      const subject = `[${labels[type] || "Press inquiry"}] ${outlet || name}`;
      const body = [
        `Name: ${name}`,
        `Email: ${email}`,
        `Outlet or organization: ${outlet || "Not provided"}`,
        `Deadline: ${deadline || "Not provided"}`,
        "",
        message
      ].join("\n");

      status.textContent = `Opening an email draft to ${destination}.`;
      window.location.href = `mailto:${destination}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(command);
        copyButton.textContent = "Copied";
      } catch {
        copyButton.textContent = "Select text";
      }
    });
  }
});
